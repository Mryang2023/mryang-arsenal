package com.arsenal.archify;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;

/**
 * 选型 IR → 交付用 HTML 的渲染服务。
 *
 * <h2>它为什么长这样</h2>
 *
 * 版式引擎不在本仓库里 —— 它是「扳手AI.Archify」技能自带的一套 Node 渲染器
 * （13.5k 行 ESM，读自己的 HTML 模板、自己算标签遮罩与折线净空）。
 * 浏览器跑不了它，而前端是 {@code output: 'export'} 的纯静态站，
 * 所以「页面里点一下就出图」这件事，必须有一个能跑 Node 的地方 —— 就是这里。
 *
 * 本类只做三件事：把 IR 落成文件、按约定调它的命令行、把结果翻译回结构化对象。
 * <b>它不参与画图。</b>版式的对错归对方，我们只保证喂进去的是事实。
 *
 * <h2>安全上守着的几条</h2>
 *
 * 这是一个「接收 JSON、在服务器上起子进程」的接口，属于出事概率最高的那一类，所以：
 * <ol>
 *   <li><b>不走 shell。</b>{@link ProcessBuilder} 传参数数组，没有 {@code sh -c}，
 *       没有字符串拼接 —— 参数里出现什么都只是参数。</li>
 *   <li><b>拒收要联网抓取的商标。</b>对方的渲染器支持 {@code brand: {url, sha256}} 这种
 *       「钉住抓取」形态，渲染时会真的去请求那个 URL（它自己有 SSRF 防护，但那是它的防线）。
 *       我们的适配器只产出内置商标 id，对象形态对我们是零收益、纯风险，直接拒。<b>见
 *       {@link #rejectRemoteBrands}</b>。</li>
 *   <li><b>不替它开私有地址闸门</b>：显式移除 {@code WRENCH_AI_BRAND_ALLOW_PRIVATE}，
 *       免得父进程环境里恰好有这个变量。</li>
 *   <li><b>有超时，且杀得掉</b>：{@code waitFor} 超时后 {@code destroyForcibly}，
 *       不让一个卡死的子进程把 Tomcat 的工作线程咬住。</li>
 *   <li><b>有大小上限，且临时目录必清</b>：一次请求一个临时目录，{@code finally} 里删。</li>
 * </ol>
 *
 * <h2>输出重定向到文件，而不是管道</h2>
 *
 * 子进程的 stdout 是一份 JSON 收据、stderr 是给人看的日志，两者不能混
 * （合并后 JSON 就解析不了了）。用文件而不是管道还顺手解决两件事：
 * 没有管道缓冲区写满导致的死锁，以及 Windows 控制台代码页不会把中文糊掉 ——
 * 我们按 UTF-8 读文件，拿到的就是它写下的字节。
 */
@Service
public class ArchifyService {

    private static final Logger log = LoggerFactory.getLogger(ArchifyService.class);

    /** 目前只用架构图。workflow / sequence / dataflow / lifecycle 本项目不产出。 */
    private static final String DIAGRAM_TYPE = "architecture";

    /** 允许的构图检查档位。配置写错时应当当场拒掉，而不是原样传给对方。 */
    private static final List<String> QUALITIES = List.of("standard", "showcase");

    /** 诊断条目上限 —— 一张坏图能报几十条，全塞进响应只会把有用那几条淹掉。 */
    private static final int MAX_DIAGNOSTICS = 20;

    /** 找 node 的兜底位置。本机实测存在，但不保证每台机器都有 —— 见 {@link #resolveNode}。 */
    private static final String[] NODE_FALLBACKS = {
            "C:/Program Files/nodejs/node.exe",
            "/usr/local/bin/node",
            "/usr/bin/node",
    };

    private final ObjectMapper mapper;

    private final String configuredNode;
    private final String cliPath;
    private final String quality;
    private final long timeoutSeconds;
    private final long maxSpecBytes;
    private final Path workRoot;

    /** node 的解析结果。<b>只缓存成功</b>：人可能刚装上 node，缓存失败会让人以为装错了。 */
    private volatile NodeResolution cachedNode;

    public ArchifyService(
            ObjectMapper mapper,
            @Value("${arsenal.archify.node:}") String configuredNode,
            @Value("${arsenal.archify.cli:}") String cliPath,
            @Value("${arsenal.archify.quality:showcase}") String quality,
            @Value("${arsenal.archify.timeout-seconds:60}") long timeoutSeconds,
            @Value("${arsenal.archify.max-spec-bytes:1048576}") long maxSpecBytes) {

        this.mapper = mapper;
        this.configuredNode = configuredNode == null ? "" : configuredNode.trim();
        this.cliPath = cliPath == null ? "" : cliPath.trim();
        this.timeoutSeconds = timeoutSeconds <= 0 ? 60 : timeoutSeconds;
        this.maxSpecBytes = maxSpecBytes <= 0 ? 1048576 : maxSpecBytes;
        this.workRoot = Paths.get(System.getProperty("java.io.tmpdir", "."));

        String q = quality == null ? "" : quality.trim().toLowerCase(Locale.ROOT);
        if (!QUALITIES.contains(q)) {
            throw new IllegalStateException(
                    "arsenal.archify.quality 只能是 " + String.join(" / ", QUALITIES) + "，当前是「" + quality + "」");
        }
        this.quality = q;
    }

    // ──────────────────────────────────────────────── 可用性

    /**
     * 当前这台机器能不能出图。
     *
     * <p>页面上「直接生成」按钮的亮灭就由它决定，所以它必须<b>说真话</b>：
     * 不能因为「理论上装了就能用」而报可用 —— 那种乐观最后会变成用户点一下、
     * 等几十秒、拿一个 500。
     *
     * <p>cli 文件每次现查（人可能刚装好技能），node 的解析结果缓存。
     */
    public Probe probe() {
        NodeResolution node = resolveNode();
        boolean cliExists = !cliPath.isEmpty() && Files.isRegularFile(Paths.get(cliPath));

        if (node.binary() == null) {
            return new Probe(false, ArchifyUnavailableException.NODE_MISSING,
                    "这台机器上找不到可用的 node，通用绘图器需要它才能出图。"
                            + "装一个 Node.js，或把 arsenal.archify.node 指到 node 可执行文件"
                            + "（环境变量 ARSENAL_ARCHIFY_NODE）。",
                    null, null, cliPath, cliExists, quality, timeoutSeconds, maxSpecBytes);
        }
        if (!cliExists) {
            return new Probe(false, ArchifyUnavailableException.NOT_INSTALLED,
                    "没装「扳手AI.Archify」技能（找不到 " + cliPath + "）。"
                            + "在技能市场里装它，或把 arsenal.archify.cli 指到已有的 wrench-ai.mjs"
                            + "（环境变量 ARSENAL_ARCHIFY_CLI）。装好之前，仍可下载 IR JSON，"
                            + "拿到有 Node 的机器上自己渲染。",
                    node.binary(), node.version(), cliPath, false, quality, timeoutSeconds, maxSpecBytes);
        }
        return new Probe(true, null, null, node.binary(), node.version(), cliPath, true,
                quality, timeoutSeconds, maxSpecBytes);
    }

    /**
     * 按 PATH → 兜底路径的顺序找一个能用的 node。
     *
     * <p>为什么不只认 PATH：本机 Spring Boot 由脚本拉起，进程的 PATH 里往往没有 node
     * （开发机上 node 是 nvm / 版本管理器塞进交互式 shell 的）。反过来只认固定路径也不行，
     * Linux 上没这个路径。两个都试，并且把<b>最终用了哪一个</b>报出去 ——
     * 「到底在用哪个 node」这件事，出问题时是第一个要回答的。
     */
    private NodeResolution resolveNode() {
        NodeResolution cached = cachedNode;
        if (cached != null) {
            return cached;
        }
        synchronized (this) {
            if (cachedNode != null) {
                return cachedNode;
            }
            List<String> candidates = new ArrayList<>();
            if (!configuredNode.isEmpty()) {
                candidates.add(configuredNode);
            }
            candidates.add("node");
            candidates.addAll(List.of(NODE_FALLBACKS));

            for (String candidate : candidates) {
                String version = nodeVersion(candidate);
                if (version != null) {
                    NodeResolution resolved = new NodeResolution(candidate, version);
                    cachedNode = resolved;
                    log.info("通用绘图器将使用 node：{}（{}）", candidate, version);
                    return resolved;
                }
            }
            log.info("找不到可用的 node，通用绘图器不可用。试过：{}", String.join(" / ", candidates));
            return new NodeResolution(null, null);
        }
    }

    /** 跑 {@code <candidate> --version}；拿不到版本就当这个候选不可用。 */
    private String nodeVersion(String candidate) {
        try {
            Process p = new ProcessBuilder(candidate, "--version").redirectErrorStream(true).start();
            if (!p.waitFor(5, TimeUnit.SECONDS)) {
                p.destroyForcibly();
                return null;
            }
            if (p.exitValue() != 0) {
                return null;
            }
            String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
            return out.isEmpty() ? null : out;
        } catch (IOException | InterruptedException e) {
            if (e instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            return null;
        }
    }

    // ──────────────────────────────────────────────── 出图

    /**
     * 渲染一张图。
     *
     * <p><b>图没画出来不算接口失败。</b>对方校验不过时，它给的是十几条可核对的诊断
     * （哪条线、差几像素、怎么改），那是这次调用最有价值的东西 —— 包成 4xx/5xx
     * 只会让调用方为了读诊断去解析错误体。所以：环境问题抛异常，
     * 画图失败正常返回 {@code delivered: false} + 诊断。
     */
    public DeliverOutcome deliver(JsonNode spec) {
        if (spec == null || !spec.isObject()) {
            throw new IllegalArgumentException("请求体必须是一个 IR JSON 对象（架构中间表示）");
        }

        // 先把请求本身的问题问完，再看这台机器能不能干活。
        //
        // 顺序是有意的：这样「这个请求不合规」的判定与机器装没装技能无关 ——
        // 一台没装技能的机器上也照样拒收要联网抓取的商标，拒收行为不会因为
        // 环境变化而消失（少一道防线的地方，恰恰是最容易被忽略的地方）。
        // 同时它也让这条规矩可测：见 .verify/ArchifyProbe.java。
        rejectRemoteBrands(spec, "");

        Probe probe = probe();
        if (!probe.available()) {
            throw new ArchifyUnavailableException(probe.code(), probe.reason());
        }

        byte[] specBytes;
        try {
            specBytes = mapper.writerWithDefaultPrettyPrinter().writeValueAsBytes(spec);
        } catch (IOException e) {
            throw new IllegalArgumentException("IR 无法序列化：" + e.getMessage(), e);
        }
        if (specBytes.length > maxSpecBytes) {
            throw new IllegalArgumentException(
                    "IR 太大（" + specBytes.length + " 字节，上限 " + maxSpecBytes + "）");
        }

        Path dir = null;
        long started = System.nanoTime();
        try {
            dir = Files.createTempDirectory(workRoot, "arsenal-archify-");
            Path in = dir.resolve("spec.json");
            Path out = dir.resolve("artifact.html");
            Path stdout = dir.resolve("stdout.log");
            Path stderr = dir.resolve("stderr.log");
            Files.write(in, specBytes);

            List<String> argv = List.of(
                    probe.nodeBinary(), cliPath, "deliver", DIAGRAM_TYPE,
                    in.toString(), out.toString(), "--quality", quality, "--json");

            Exec exec = run(argv, dir, stdout, stderr);
            long elapsed = (System.nanoTime() - started) / 1_000_000L;

            if (exec.stdout().isBlank()) {
                throw new ArchifyUnavailableException(ArchifyUnavailableException.EXEC_FAILED,
                        "通用绘图器没吐出结果（退出码 " + exec.exitCode() + "）。"
                                + "它自己的报错：" + head(exec.stderr(), 3));
            }

            JsonNode receipt;
            try {
                receipt = mapper.readTree(exec.stdout());
            } catch (IOException e) {
                throw new ArchifyUnavailableException(ArchifyUnavailableException.EXEC_FAILED,
                        "通用绘图器吐出的不是 JSON（退出码 " + exec.exitCode() + "）：" + head(exec.stdout(), 2), e);
            }

            if (!receipt.path("ok").asBoolean(false)) {
                return DeliverOutcome.failed(
                        summarize(receipt, exec.stdout()), diagnosticsOf(receipt),
                        sha256(specBytes), specBytes.length, elapsed);
            }

            String html = Files.readString(out, StandardCharsets.UTF_8);
            return DeliverOutcome.delivered(html, receiptOf(receipt), diagnosticsOf(receipt),
                    specBytes.length, elapsed);

        } catch (IOException e) {
            throw new ArchifyUnavailableException(ArchifyUnavailableException.EXEC_FAILED,
                    "渲染中途失败：" + e.getMessage(), e);
        } finally {
            deleteTree(dir);
        }
    }

    /**
     * 拒收「钉住抓取」形态的商标 —— 也就是任何 {@code brand} 是<b>对象</b>的节点。
     *
     * <p>对方的渲染器支持 {@code brand: {url, sha256}}，渲染时会带着 digest 去请求那个 URL
     * 验证标识没变。它自己做了 SSRF 防护（限 http(s)、限标准端口、拒私有地址），
     * 但那是它的防线，不该变成我们的接口替陌生人发请求的理由。
     *
     * <p>而我们的适配器只会产出内置商标 id（一个字符串），对象形态对我们零收益。
     * 这类「我们永远不用、但一旦出现就危险」的输入，正确的处理是拒收，不是消毒。
     *
     * <p>递归整棵树而不是只看 {@code components}：对方今天只认节点上的 brand，
     * 明天的 schema 多认一处，这种检查就会静默失守。
     */
    private void rejectRemoteBrands(JsonNode node, String path) {
        if (node.isObject()) {
            node.fields().forEachRemaining(field -> {
                String here = path + "/" + field.getKey();
                if ("brand".equals(field.getKey()) && field.getValue().isObject()) {
                    throw new IllegalArgumentException(
                            "IR 里的 brand 只允许是内置商标 id（字符串）。"
                                    + "位置 " + here + " 是一个对象 —— 那会让服务器去请求 IR 里写的网址。"
                                    + "适配器不会产出这种形态；如果你在改 IR，请改用内置 id。");
                }
                rejectRemoteBrands(field.getValue(), here);
            });
        } else if (node.isArray()) {
            for (int i = 0; i < node.size(); i++) {
                rejectRemoteBrands(node.get(i), path + "/" + i);
            }
        }
    }

    /**
     * 起子进程并等它。stdout / stderr 各自重定向到文件。
     *
     * <p>参数是数组、不是字符串 —— 这条防线决定了「IR 文件名里带分号」这种问题
     * 根本不成立（文件名是我们生成的 UUID，但防线不该建立在「输入恰好干净」上）。
     */
    private Exec run(List<String> argv, Path cwd, Path stdoutFile, Path stderrFile) throws IOException {
        ProcessBuilder pb = new ProcessBuilder(argv);
        pb.directory(cwd.toFile());
        pb.redirectOutput(stdoutFile.toFile());
        pb.redirectError(stderrFile.toFile());

        // 显式摘掉对方的「允许私有地址」闸门。父进程环境里若恰好有人设了它，
        // 就会把我们上面那条拒收对象的规矩从另一侧绕过去。
        pb.environment().remove("WRENCH_AI_BRAND_ALLOW_PRIVATE");

        Process p = pb.start();
        boolean finished;
        try {
            finished = p.waitFor(timeoutSeconds, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            p.destroyForcibly();
            Thread.currentThread().interrupt();
            throw new ArchifyUnavailableException(ArchifyUnavailableException.EXEC_FAILED,
                    "等待渲染时被中断");
        }
        if (!finished) {
            p.destroyForcibly();
            try {
                // 给它几秒退干净再往下走。等不到也无所谓 —— 已经发过强杀信号了，
                // 再等下去只是把请求拖得更久。
                p.waitFor(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
            throw new ArchifyUnavailableException(ArchifyUnavailableException.TIMEOUT,
                    "渲染超过 " + timeoutSeconds + " 秒被中止。实测一次约 1.6 秒，"
                            + "跑到超时通常意味着它卡住了 —— 先手工跑一遍 "
                            + "render 那条命令看它停在哪。");
        }
        return new Exec(p.exitValue(), readIfExists(stdoutFile), readIfExists(stderrFile));
    }

    // ──────────────────────────────────────────────── 收据翻译

    private Receipt receiptOf(JsonNode receipt) {
        JsonNode spec = receipt.path("specification");
        JsonNode artifact = receipt.path("artifact");
        JsonNode validation = receipt.path("validation");
        return new Receipt(
                validation.path("checksPassed").asInt(0),
                validation.path("checkCount").asInt(0),
                validation.path("compositionProfile").asText(""),
                validation.path("compositionStatus").asText(""),
                validation.path("errors").asInt(0),
                validation.path("warnings").asInt(0),
                spec.path("sha256").asText(""),
                spec.path("bytes").asLong(0),
                artifact.path("sha256").asText(""),
                artifact.path("bytes").asLong(0));
    }

    /** 失败时优先用它的 {@code error} 一句话；没有就给诊断里的前几条。 */
    private String summarize(JsonNode receipt, String rawStdout) {
        String error = receipt.path("error").asText("");
        if (!error.isBlank()) {
            return head(error, 4);
        }
        String diagnostics = head(rawStdout, 3);
        return diagnostics.isBlank() ? "通用绘图器判定这张图不合格，但没有给出说明" : diagnostics;
    }

    private List<Diagnostic> diagnosticsOf(JsonNode receipt) {
        JsonNode list = receipt.path("diagnostics");
        if (!list.isArray()) {
            return List.of();
        }
        List<Diagnostic> out = new ArrayList<>();
        for (JsonNode d : list) {
            if (out.size() >= MAX_DIAGNOSTICS) {
                break;
            }
            out.add(new Diagnostic(
                    d.path("code").asText(""),
                    d.path("severity").asText(""),
                    d.path("message").asText("")));
        }
        return out;
    }

    // ──────────────────────────────────────────────── 小工具

    private static String readIfExists(Path p) {
        try {
            return Files.exists(p) ? Files.readString(p, StandardCharsets.UTF_8) : "";
        } catch (IOException e) {
            return "";
        }
    }

    /** 取前 n 行。报错给一屏就够，几十行堆栈塞进响应体只会让人不看。 */
    private static String head(String text, int n) {
        if (text == null || text.isBlank()) {
            return "";
        }
        String[] lines = text.strip().split("\n", -1);
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < Math.min(n, lines.length); i++) {
            if (i > 0) {
                b.append('\n');
            }
            b.append(lines[i].stripTrailing());
        }
        return b.toString();
    }

    private static String sha256(byte[] bytes) {
        try {
            java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
            return java.util.HexFormat.of().formatHex(md.digest(bytes));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException("JDK 没有 SHA-256 —— 这不可能发生", e);
        }
    }

    /** 删临时目录。清理失败不影响本次结果，但要说一声 —— 静默留垃圾比报错难查。 */
    private static void deleteTree(Path dir) {
        if (dir == null) {
            return;
        }
        try (Stream<Path> walk = Files.walk(dir)) {
            walk.sorted(Comparator.reverseOrder()).forEach(p -> {
                try {
                    Files.deleteIfExists(p);
                } catch (IOException ignored) {
                    // 单个文件删不掉就留着，最后由操作系统清临时目录
                }
            });
        } catch (IOException e) {
            log.warn("临时目录清理失败（不影响本次结果）：{}", dir);
        }
    }

    // ──────────────────────────────────────────────── 数据形状

    /** 可用性探测结果。字段名就是给前端和 MCP 看的，别改。 */
    public record Probe(
            boolean available,
            String code,
            String reason,
            String nodeBinary,
            String nodeVersion,
            String cliPath,
            boolean cliExists,
            String quality,
            long timeoutSeconds,
            long maxSpecBytes
    ) {
    }

    /** 一次出图的结果。{@code delivered=false} 时 {@code html} 为 null，看 {@code diagnostics}。 */
    public record DeliverOutcome(
            boolean delivered,
            String error,
            String html,
            Receipt receipt,
            List<Diagnostic> diagnostics,
            String specSha256,
            long specBytes,
            long elapsedMs
    ) {
        static DeliverOutcome delivered(String html, Receipt receipt, List<Diagnostic> diagnostics,
                                        long specBytes, long elapsedMs) {
            return new DeliverOutcome(true, null, html, receipt, diagnostics,
                    receipt.specSha256(), specBytes, elapsedMs);
        }

        static DeliverOutcome failed(String error, List<Diagnostic> diagnostics,
                                     String specSha256, long specBytes, long elapsedMs) {
            return new DeliverOutcome(false, error, null, null, diagnostics,
                    specSha256, specBytes, elapsedMs);
        }
    }

    /** 对方的校验收据。九项检查、错误数、以及两边内容的 sha256。 */
    public record Receipt(
            int checksPassed,
            int checkCount,
            String profile,
            String status,
            int errors,
            int warnings,
            String specSha256,
            long reportedSpecBytes,
            String artifactSha256,
            long artifactBytes
    ) {
    }

    public record Diagnostic(String code, String severity, String message) {
    }

    private record NodeResolution(String binary, String version) {
    }

    private record Exec(int exitCode, String stdout, String stderr) {
    }
}
