import com.arsenal.archify.ArchifyService;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.stream.Stream;

/**
 * 出图服务探针（后端侧）。
 *
 * <p>这个文件不在 src/main/java 下 —— 它不是产品代码，是校验工具，
 * 所以 compile-check.sh 不编译它，只有 archify-probe.sh 会。与 ParityProbe 同一个套路。
 *
 * <h2>它验的和前端那层不是同一件事</h2>
 *
 * <p>{@code arsenal-web/.verify/archify-check.ts} 验的是「IR 画出来合格吗」——
 * 它直接调对方的命令行。这里验的是「<b>我们的服务</b>能不能把它跑起来」：
 * 找不找得到 node、临时文件写没写对、子进程的输出有没有被正确翻译回来、
 * 超时与清理有没有兜住。两条路都通，页面上那颗按钮才真的能用。
 *
 * <h2>为什么也喂坏数据</h2>
 *
 * <p>只测「好的能过」等于只测了一半：一个永远返回成功的实现也能过。
 * 所以这里另外喂三样东西 —— 坏几何（必须如实报诊断，不是抛异常）、
 * 对象形态的商标（必须当场拒收）、非对象请求体（必须拒）。
 * 以及一条容易被忽略的：跑完之后临时目录里不许留东西。
 *
 * <p>IR 由调用方传入，不在这里生成 —— 与 ParityProbe 相同的理由：
 * 探针自己造一份输入，就等于在验「探针造的那份」，而不是前端真正产出的那份。
 *
 * <p>用法：{@code java -cp <classes>;<deps> ArchifyProbe <outDir> <spec.json> [more.json ...]}
 */
public final class ArchifyProbe {

    private ArchifyProbe() {
    }

    private static final String TMP_PREFIX = "arsenal-archify-";

    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.err.println("用法: ArchifyProbe <outDir> <spec.json> [more.json ...]");
            System.exit(2);
        }
        Path outDir = Path.of(args[0]).toAbsolutePath().normalize();
        List<Path> specs = new ArrayList<>();
        for (int i = 1; i < args.length; i++) {
            specs.add(Path.of(args[i]).toAbsolutePath().normalize());
        }
        Files.createDirectories(outDir);

        ObjectMapper mapper = new ObjectMapper();

        // 配置与 application.yml 的默认值一致。探针绕过 Spring，所以这份映射要自己维护 ——
        // 两处不一致的表现是「服务里能用、探针里说不可用」，反过来更糟。
        String cli = envOr("ARSENAL_ARCHIFY_CLI",
                System.getProperty("user.home") + "/.workbuddy/skills/wrench-ai/bin/wrench-ai.mjs");
        String node = envOr("ARSENAL_ARCHIFY_NODE", "");

        ArchifyService service = new ArchifyService(mapper, node, cli, "showcase", 60, 1048576);

        ObjectNode result = mapper.createObjectNode();
        ArchifyService.Probe probe = service.probe();
        result.put("available", probe.available());
        result.put("code", probe.code());
        result.put("reason", probe.reason());
        result.put("nodeBinary", probe.nodeBinary());
        result.put("nodeVersion", probe.nodeVersion());
        result.put("cliPath", probe.cliPath());
        result.put("quality", probe.quality());

        System.out.println("可用性 : " + (probe.available() ? "可以出图" : "不可用（" + probe.code() + "）"));
        if (probe.available()) {
            System.out.println("node   : " + probe.nodeBinary() + "  " + probe.nodeVersion());
            System.out.println("cli    : " + probe.cliPath());
        } else {
            System.out.println("原因   : " + probe.reason());
        }
        System.out.println();

        // 环境类断言**不看这台机器装了没有** —— 它们模拟的是「没装」，
        // 恰恰是别的机器上最常见的那种情况。只在这台机器上跑一遍真实渲染，
        // 就永远测不到「没装时页面会怎样」。
        ObjectNode environment = result.putObject("environment");
        runEnvironmentGuards(mapper, probe.cliPath(), environment);
        System.out.println("环境   : " + summarizeEnvironment(environment));
        System.out.println();

        ArrayNode cases = result.putArray("cases");
        if (probe.available()) {
            for (Path spec : specs) {
                ObjectNode one = runOne(service, mapper, spec);
                cases.add(one);
                System.out.println(String.format("  %-28s %s  %s",
                        one.path("name").asText(),
                        one.path("delivered").asBoolean() ? "出图" : "失败",
                        one.path("delivered").asBoolean()
                                ? one.path("checkCount").asInt() + " 项检查 / " + one.path("errors").asInt()
                                  + " 错 · " + one.path("htmlBytes").asLong() + " 字节 · "
                                  + one.path("elapsedMs").asLong() + " ms"
                                : one.path("diagnostics").asInt() + " 条诊断"));
            }
        }

        ObjectNode guards = result.putObject("guards");
        if (probe.available() && !specs.isEmpty()) {
            runGuards(service, mapper, specs.get(0), guards);
        } else {
            guards.put("skipped", true);
        }

        System.out.println();
        System.out.println("护栏   : " + summarizeGuards(guards));

        Path receipt = outDir.resolve("archify-probe.json");
        Files.writeString(receipt, mapper.writerWithDefaultPrettyPrinter().writeValueAsString(result) + "\n",
                StandardCharsets.UTF_8);
        System.out.println("收据   : " + receipt);
    }

    // ──────────────────────────────────────────────── 环境类断言

    /**
     * 模拟「技能没装 / node 指错 / 配置写错」三种环境问题。
     *
     * <p>这几条不依赖本机装没装技能，所以每次都会跑。它们守的是一句话：
     * <b>跑不了就说清楚跑不了</b>。页面上那颗按钮的亮灭全看这个判定，
     * 一个「始终报可用」的实现会让用户点一下、等几十秒、拿一个 503 ——
     * 那比直接说「没装」糟得多。
     */
    private static void runEnvironmentGuards(ObjectMapper mapper, String realCli, ObjectNode env) {
        // ① 技能路径不存在 → 必须报 NOT_INSTALLED，且说明里要有「怎么装」的抓手
        ArchifyService noCli = new ArchifyService(mapper, "", "/definitely/not/here/wrench-ai.mjs",
                "showcase", 60, 1048576);
        ArchifyService.Probe p1 = noCli.probe();
        env.put("missingCliAvailable", p1.available());
        env.put("missingCliCode", p1.code());
        env.put("missingCliSaysHowToFix", p1.reason() != null && p1.reason().contains("ARSENAL_ARCHIFY_CLI"));
        env.put("missingCliDeliverThrows", throwsUnavailable(() -> noCli.deliver(mapper.createObjectNode())));

        // ② node 指到一个不存在的东西 → 应当继续按 PATH / 常见位置找，
        //    而不是直接判定不可用。开发机上 node 常由版本管理器塞进交互式 shell，
        //    服务进程的 PATH 里没有 —— 这条链断了，功能就是「有时能用有时不能用」。
        if (realCli != null && !realCli.isBlank() && Files.isRegularFile(Path.of(realCli))) {
            ArchifyService bogusNode = new ArchifyService(mapper, "definitely-not-a-node-binary-xyz",
                    realCli, "showcase", 60, 1048576);
            ArchifyService.Probe p2 = bogusNode.probe();
            env.put("bogusNodeFallsBack", p2.available());
            env.put("bogusNodeResolvedTo", p2.nodeBinary());
        } else {
            env.put("bogusNodeFallsBack", "skipped");
        }

        // ③ quality 配置写错 → 起服务时就该炸，而不是把一个非法值原样传给对方
        boolean rejected;
        try {
            new ArchifyService(mapper, "", realCli, "bogus-profile", 60, 1048576);
            rejected = false;
        } catch (IllegalStateException e) {
            rejected = true;
        }
        env.put("badQualityRejected", rejected);
    }

    private static boolean throwsUnavailable(Runnable action) {
        try {
            action.run();
            return false;
        } catch (com.arsenal.archify.ArchifyUnavailableException e) {
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    private static String summarizeEnvironment(ObjectNode env) {
        List<String> parts = new ArrayList<>();
        boolean ok1 = !env.path("missingCliAvailable").asBoolean(true)
                && com.arsenal.archify.ArchifyUnavailableException.NOT_INSTALLED.equals(env.path("missingCliCode").asText(null))
                && env.path("missingCliSaysHowToFix").asBoolean()
                && env.path("missingCliDeliverThrows").asBoolean();
        parts.add(ok1 ? "没装技能如实报 ✗可用 ✓" : "没装技能的判定 ✗");
        if (env.has("bogusNodeResolvedTo")) {
            parts.add(env.path("bogusNodeFallsBack").asBoolean()
                    ? "node 配置写错能回落 ✓（落到 " + env.path("bogusNodeResolvedTo").asText() + "）"
                    : "node 配置写错后没回落 ✗");
        }
        parts.add(env.path("badQualityRejected").asBoolean() ? "坏档位配置当场拒 ✓" : "坏档位配置被放过 ✗");
        return String.join("  ", parts);
    }

    // ──────────────────────────────────────────────── 正例

    private static ObjectNode runOne(ArchifyService service, ObjectMapper mapper, Path spec) throws Exception {
        JsonNode ir = mapper.readTree(Files.readString(spec, StandardCharsets.UTF_8));
        ArchifyService.DeliverOutcome o = service.deliver(ir);

        ObjectNode c = mapper.createObjectNode();
        c.put("name", spec.getFileName().toString());
        c.put("delivered", o.delivered());
        c.put("elapsedMs", o.elapsedMs());
        c.put("specBytes", o.specBytes());
        c.put("diagnostics", o.diagnostics().size());
        c.put("error", o.error());

        ArchifyService.Receipt r = o.receipt();
        if (r != null) {
            c.put("checksPassed", r.checksPassed());
            c.put("checkCount", r.checkCount());
            c.put("errors", r.errors());
            c.put("warnings", r.warnings());
            c.put("profile", r.profile());
            c.put("status", r.status());
            c.put("artifactBytes", r.artifactBytes());
            c.put("specSha256", r.specSha256());
            c.put("artifactSha256", r.artifactSha256());
        }

        if (o.html() == null) {
            c.put("htmlBytes", 0);
            c.put("htmlLooksLikeDocument", false);
            c.put("artifactShaMatches", false);
        } else {
            byte[] bytes = o.html().getBytes(StandardCharsets.UTF_8);
            c.put("htmlBytes", bytes.length);
            String lead = o.html().stripLeading().toLowerCase();
            c.put("htmlLooksLikeDocument", lead.startsWith("<!doctype") || lead.startsWith("<html"));
            // 复算产物 sha256 并跟收据里的比。
            // 对不上只可能是一件事：文件里的字节和我们按 UTF-8 读回来的字符串不是一回事
            // （编码猜错、或中途做了换行转换）。这个错在浏览器里的表现是「图上一堆问号」，
            // 而在这里它是可断言的。
            c.put("artifactShaMatches", r != null && sha256(bytes).equals(r.artifactSha256()));
        }
        return c;
    }

    // ──────────────────────────────────────────────── 反例与护栏

    private static void runGuards(ArchifyService service, ObjectMapper mapper, Path spec, ObjectNode guards)
            throws Exception {
        JsonNode base = mapper.readTree(Files.readString(spec, StandardCharsets.UTF_8));

        // ① 请求体不是对象 —— 必须当场拒，不能走到子进程
        guards.put("nonObjectRejected", rejectsArgument(() -> service.deliver(mapper.createArrayNode())));

        // ② 带 URL 的商标对象 —— 这是唯一能让对方在渲染时发网络请求的形态，必须拒收。
        //    真实风险不是「图会画错」，是服务器替陌生人发了一次请求。
        guards.put("objectBrandRejected", rejectsArgument(() -> {
            JsonNode mutated = base.deepCopy();
            JsonNode first = mutated.path("components").get(0);
            if (first instanceof ObjectNode obj) {
                obj.set("brand", mapper.createObjectNode()
                        .put("url", "https://example.com/logo.svg")
                        .put("sha256", "deadbeef"));
            }
            service.deliver(mutated);
        }));

        // ③ 坏几何 —— 这里的期望相反：不许抛异常，要如实回一份带诊断的失败结果。
        //    图没画出来是业务结果，调用方要的正是那十几条「哪条线差几像素」。
        JsonNode components = base.path("components");
        if (components.isArray() && components.size() >= 2) {
            JsonNode broken = base.deepCopy();
            ArrayNode comps = (ArrayNode) broken.path("components");
            ((ObjectNode) comps.get(0)).set("pos", mapper.createArrayNode().add(10).add(10));
            ((ObjectNode) comps.get(1)).set("pos", mapper.createArrayNode().add(11).add(11));

            ArchifyService.DeliverOutcome bad = service.deliver(broken);
            guards.put("badGeometryDelivered", bad.delivered());
            guards.put("badGeometryDiagnostics", bad.diagnostics().size());
            guards.put("badGeometryHasError", bad.error() != null && !bad.error().isBlank());
            guards.put("badGeometryHtmlEmpty", bad.html() == null);
        } else {
            guards.put("badGeometrySkipped", "样本不足两个组件");
        }

        // ④ 临时目录必须清干净。发请求不出错、但每次留一个几百 KB 的目录，
        //    是要跑几天才被人发现的漏水 —— 所以它在这里是一条断言。
        guards.put("tempDirsLeft", countTempDirs());
    }

    private static int countTempDirs() throws Exception {
        Path tmp = Path.of(System.getProperty("java.io.tmpdir", "."));
        try (Stream<Path> list = Files.list(tmp)) {
            return (int) list.filter(p -> p.getFileName().toString().startsWith(TMP_PREFIX)).count();
        }
    }

    private static boolean rejectsArgument(Runnable action) {
        try {
            action.run();
            return false;
        } catch (IllegalArgumentException e) {
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    private static String summarizeGuards(ObjectNode guards) {
        if (guards.path("skipped").asBoolean(false)) {
            return "未跑（环境不可用）";
        }
        List<String> parts = new ArrayList<>();
        parts.add(guards.path("nonObjectRejected").asBoolean() ? "非对象拒收 ✓" : "非对象拒收 ✗");
        parts.add(guards.path("objectBrandRejected").asBoolean() ? "联网商标拒收 ✓" : "联网商标拒收 ✗");
        if (guards.has("badGeometryDelivered")) {
            boolean ok = !guards.path("badGeometryDelivered").asBoolean()
                    && guards.path("badGeometryDiagnostics").asInt() > 0;
            parts.add((ok ? "坏几何如实报诊断 ✓" : "坏几何如实报诊断 ✗")
                    + "（" + guards.path("badGeometryDiagnostics").asInt() + " 条）");
        }
        int left = guards.path("tempDirsLeft").asInt(-1);
        parts.add((left == 0 ? "临时目录已清 ✓" : "残留 " + left + " 个临时目录 ✗"));
        return String.join("  ", parts);
    }

    // ──────────────────────────────────────────────── 小工具

    private static String envOr(String name, String fallback) {
        String v = System.getenv(name);
        return (v == null || v.isBlank()) ? fallback : v;
    }

    private static String sha256(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }
}
