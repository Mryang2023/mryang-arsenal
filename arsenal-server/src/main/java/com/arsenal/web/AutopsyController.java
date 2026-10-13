package com.arsenal.web;

import com.arsenal.autopsy.AutopsyService;
import com.arsenal.scan.SourceResolver;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * 项目体检接口。
 *
 * <p>与 {@code POST /api/scan/facts} 同形（请求体 {@code {"source":{"kind":"path"|"git","value":"…"}}}），
 * 因为两者面对的是同一个问题：给一个项目地址，把结论拿回来。
 * 差别只在后端：facts 出架构事实，inspect 出三档体检结论（P0 必修 / P1 该改 / 观察项）+ 覆盖率。
 *
 * <p><b>入参校验一律在 Controller 里做。</b>本仓 {@code GlobalExceptionHandler} 会把
 * 404/405/415 吃成 500（既有行为，不是本接口引入的），所以不能指望框架层给出可读的
 * 参数错误 —— 缺字段、kind 不认识、空值都在这里显式抛 {@link IllegalArgumentException}。
 *
 * <p>安全：这条链路会让服务器去读用户给的路径。路径解析与「真实路径必须落在根内」
 * 由 {@link SourceResolver} 与 {@code ScanGuard} 承担（与扫描同一套，不在这里重写一遍）；
 * 报告里只有目录名，没有绝对路径。
 */
@RestController
@RequestMapping("/api/autopsy")
public class AutopsyController {

    private final AutopsyService service;

    public AutopsyController(AutopsyService service) {
        this.service = service;
    }

    /**
     * 体检一个本地目录或一个 https git 地址。
     *
     * <p>zip 不走这里：上传链路是 multipart（{@code /api/scan/upload}），
     * 与本接口的 JSON 请求体不是一回事，混在一条 switch 里迟早要加第三个分支。
     *
     * <p>{@code try(source)} 的清理在 {@link AutopsyService#inspect} 内部 ——
     * 临时目录必须在「源码已读进内存」之后、报告返回之前删掉，
     * 放在这里的话 service 已经用完了（且重复 close 是空操作，但语义会分家）。
     */
    @PostMapping("/inspect")
    public ApiResponse<JsonNode> inspect(@RequestBody JsonNode body) {
        JsonNode source = body == null ? null : body.get("source");
        if (source == null || !source.isObject()) {
            throw new IllegalArgumentException("请求体缺少 source：{\"source\":{\"kind\":\"path|git\",\"value\":\"…\"}}");
        }
        String kind = source.path("kind").asText("");
        String value = source.path("value").asText("");
        if (value.isBlank()) {
            throw new IllegalArgumentException("source.value 是空的 —— 给一个本地目录或 https git 地址");
        }
        SourceResolver resolved = switch (kind) {
            case "path" -> SourceResolver.fromPath(value);
            case "git" -> SourceResolver.fromGit(value);
            default -> throw new IllegalArgumentException(
                    "source.kind 只支持 path / git，收到的是「" + kind + "」（zip 请走 /api/scan/upload）");
        };
        return ApiResponse.ok(service.inspect(resolved));
    }

    /**
     * 活体解剖：把项目真跑一次，把运行时事实原样带回来。
     *
     * <p><b>本接口不做对账。</b>它只调 {@link com.arsenal.autopsy.RuntimeProbe} 摊事实，
     * 「对不对」在前端 {@code src/lib/runtime-recon.ts} 判 —— 判定逻辑只有一份实现。
     *
     * <p><b>为什么不跑在用户给的目录里</b>：采集要编译（写 {@code target/classes}）。
     * 扫描那一层的不变量是「不写被扫描的仓库」，活体解剖要破例，于是先把源码
     * 复制到一个临时工作副本里跑 —— 用户的目录一个字节都不动，跑完副本删掉。
     *
     * <p><b>同步 + 硬上限</b>：一次采集最多 {@code wallClockMs}（默认 90s）。
     * 超时由 {@link com.arsenal.autopsy.RunSandbox} 杀进程树，返回已经采到的部分并标
     * {@code partial}。不搞异步轮询 —— 那一层一旦加上，就没人能说清「这次结果对应哪次采集」。
     */
    @PostMapping("/run")
    public ApiResponse<JsonNode> run(@RequestBody JsonNode body) {
        JsonNode source = body == null ? null : body.get("source");
        if (source == null || !source.isObject()) {
            throw new IllegalArgumentException("请求体缺少 source：{\"source\":{\"kind\":\"path|git\",\"value\":\"…\"}}");
        }
        String kind = source.path("kind").asText("");
        String value = source.path("value").asText("");
        if (value.isBlank()) {
            throw new IllegalArgumentException("source.value 是空的");
        }
        // 主类名由前端从 facts.code.entryPoints[] 里挑好传进来 ——
        // 后端不猜「该跑哪个类」，猜错了的表现是「起不来」，与项目真的起不来无从区分。
        String mainClass = body.path("mainClass").asText("");
        String runtime = body.path("runtime").asText("spring-boot");
        long wall = body.path("wallClockMs").asLong(90_000L);
        if (wall <= 0 || wall > 300_000L) {
            throw new IllegalArgumentException("wallClockMs 必须落在 (0, 300000]，收到 " + wall);
        }

        SourceResolver resolved = switch (kind) {
            case "path" -> SourceResolver.fromPath(value);
            case "git" -> SourceResolver.fromGit(value);
            default -> throw new IllegalArgumentException(
                    "source.kind 只支持 path / git，收到的是「" + kind + "」");
        };

        Path work = null;
        try {
            work = toWorkCopy(resolved.root());
            ObjectNode out = com.arsenal.autopsy.RuntimeProbe.probe(
                    work, mainClass, runtime, wall, m2Repo(), MAPPER);
            return ApiResponse.ok(out);
        } catch (IOException e) {
            throw new IllegalArgumentException("建工作副本失败：" + e.getMessage());
        } finally {
            resolved.close();
            if (work != null) deleteQuietly(work.getParent());
        }
    }

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static Path m2Repo() {
        String fromEnv = System.getenv("M2_REPO");
        if (fromEnv != null && !fromEnv.isBlank()) return Path.of(fromEnv);
        return Path.of(System.getProperty("user.home", ".")).resolve(".m2").resolve("repository");
    }

    /**
     * 复制一份到临时目录再跑。副本上限 2 万个文件 / 500MB ——
     * 复制用户的整个仓库是有代价的，超了就明说，不许默默复制一半然后报「编译不过」。
     */
    private static Path toWorkCopy(Path src) throws IOException {
        Path parent = Files.createTempDirectory("arsenal-run-");
        Path dst = parent.resolve(src.getFileName() == null ? "project" : src.getFileName().toString());
        final int[] count = {0};
        final long[] bytes = {0L};
        try (var walk = Files.walk(src)) {
            for (Path p : (Iterable<Path>) walk::iterator) {
                if (com.arsenal.scan.ScanGuard.skipDir(p.getFileName().toString())) continue;
                Path target = dst.resolve(src.relativize(p).toString());
                if (Files.isDirectory(p)) {
                    Files.createDirectories(target);
                } else if (Files.isRegularFile(p)) {
                    if (++count[0] > 20_000) throw new IOException("文件数超过 2 万，拒绝建工作副本");
                    long size = Files.size(p);
                    bytes[0] += size;
                    if (bytes[0] > 500L * 1024 * 1024) throw new IOException("总体积超过 500MB，拒绝建工作副本");
                    Files.createDirectories(target.getParent());
                    Files.copy(p, target);
                }
            }
        } catch (java.util.NoSuchElementException ignored) {
            // Files.walk 在目录被外部改动时会抛这个；副本能建多少算多少
        }
        return dst;
    }

    private static void deleteQuietly(Path dir) {
        try (var walk = Files.walk(dir)) {
            walk.sorted(java.util.Comparator.reverseOrder()).forEach(p -> {
                try {
                    Files.deleteIfExists(p);
                } catch (IOException ignored) {
                    // 删不掉也绝不影响返回值：副本是临时的，最坏是留个残骸
                }
            });
        } catch (IOException ignored) {
            // 同上
        }
    }
}
