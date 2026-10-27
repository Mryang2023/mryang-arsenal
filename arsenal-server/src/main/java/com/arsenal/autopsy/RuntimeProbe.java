package com.arsenal.autopsy;

import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 运行时采集器 —— 把项目真跑一次，把看到的摊平。
 *
 * <p><b>本类只摊事实，不下结论。</b>
 * 「起了几个服务」「端口和静态声明对不对」「health 是不是 UP」这些判定在
 * {@code arsenal-web/src/lib/runtime-recon.ts} —— 本仓硬约定：判定逻辑只有一份实现（TS）。
 * 这里做的事情只有一件：起进程、看它说了什么、问它一句 health、然后把它杀掉。
 *
 * <p><b>三条不许含糊的纪律</b>：
 * <ol>
 *   <li><b>采不到就是未执行 + 原因。</b>{@code status} 是 {@code not-executed} 时
 *       {@code reason} 必须非空且说人话。绝不允许「没采到」被写成「没问题」。</li>
 *   <li><b>没有 actuator 就叫「无 health 端点」，不叫「健康」。</b>
 *       classpath 里没有 actuator 就不去探，并在 {@code health.note} 里写清楚。</li>
 *   <li><b>采完即杀。</b>杀进程由 {@link RunSandbox} 保证，本类不做第二次实现。</li>
 * </ol>
 *
 * <p><b>两个入口，一份实现</b>：{@code POST /api/autopsy/run} 与 {@link #main}（给断言层用）
 * 都只调 {@link #probe}。之所以要 CLI 入口：断言不能依赖 3011 后端活着 ——
 * 后端没起来就验不了沙箱，等于把最该守的安全红线交给一个不可控的前置条件。
 */
public final class RuntimeProbe {

    /** 本棒只支持这一种 runtime。别的（node-start / main）明确报不支持，不许含糊说「跑过了」 */
    public static final String SUPPORTED_RUNTIME = "spring-boot";

    /** 末尾留这么多行日志当证据：够看清「它最后在干什么」 */
    private static final int TAIL_LINES = 50;
    /** ERROR / Exception / Caused by 最多留这么多条 */
    private static final int ERROR_LINES = 20;

    /**
     * 端口行。<b>Boot 3 与 Boot 4 的措辞不一样，必须两种都认</b>：
     * <ul>
     *   <li>Boot 3：{@code Tomcat started on port(s): 8080 (http)} —— 有冒号、有 (s)</li>
     *   <li>Boot 4.1：{@code Tomcat started on port 60364 (http) with context path '/'} —— 无冒号</li>
     * </ul>
     * 只认其中一种的结果：升级 Boot 之后端口永远解析不出来，而现象是「端口为 0」，
     * 与「真的解析失败」长得一模一样 —— 这是本仓最忌讳的静默失败。
     */
    private static final Pattern PORT_LINE = Pattern.compile(
            "Tomcat started on port\\(?s?\\)?:?\\s+(\\d+)");

    private static final Pattern ERROR_LINE = Pattern.compile(
            "ERROR|Exception|Caused by|APPLICATION FAILED TO START");

    private RuntimeProbe() {
    }

    /**
     * @param projectDir 被解剖项目的根目录（应为工作副本，不是用户原始目录）
     * @param mainClass  全限定主类名，来自 {@code facts.code.entryPoints[].className} + package
     * @param runtime    {@code facts.code.entryPoints[].runtime}
     * @param wallClockMs 墙钟上限
     * @param m2Repo     本地 Maven 仓库
     */
    public static ObjectNode probe(Path projectDir, String mainClass, String runtime,
                                   long wallClockMs, Path m2Repo, ObjectMapper mapper) {
        return probe(projectDir, mainClass, runtime, wallClockMs, m2Repo, mapper, ".");
    }

    /**
     * @param relativeWorkDir 相对项目根的工作目录 —— **它是安全闸门的一个入口，不是便利参数。**
     *        多模块项目要从模块目录里跑（{@code order-service}），而 {@code ../../etc}
     *        这种会被 {@link RunSandbox} 拒掉。留这个参数就是为了让它能被断言验到。
     */
    public static ObjectNode probe(Path projectDir, String mainClass, String runtime,
                                   long wallClockMs, Path m2Repo, ObjectMapper mapper,
                                   String relativeWorkDir) {
        ObjectNode out = mapper.createObjectNode();
        out.put("workDir", relativeWorkDir == null ? "." : relativeWorkDir);
        out.put("runtime", runtime == null ? "" : runtime);
        out.put("mainClass", mainClass == null ? "" : mainClass);
        out.put("wallClockMs", wallClockMs);
        ArrayNode steps = out.putArray("steps");

        if (!SUPPORTED_RUNTIME.equals(runtime)) {
            out.put("status", "not-executed");
            out.put("reason", "本棒只支持 runtime=spring-boot 的入口，收到的是「"
                    + runtime + "」—— 不是「跑过了」，是这一路还没做");
            out.put("supported", false);
            return out;
        }
        out.put("supported", true);
        if (mainClass == null || mainClass.isBlank()) {
            out.put("status", "not-executed");
            out.put("reason", "静态事实里没有主类名（package 或 className 为空）—— 不知道该跑哪个类，"
                    + "猜一个去跑等于伪造运行时事实");
            return out;
        }

        // ── 1. 解析类路径 ──────────────────────────────────────
        long t0 = System.currentTimeMillis();
        RuntimeClasspath.Resolved cp = RuntimeClasspath.resolve(projectDir, m2Repo);
        addStep(steps, "resolve-classpath", cp.jars().isEmpty() ? "failed" : "ok",
                System.currentTimeMillis() - t0,
                cp.jars().size() + " 个 jar，Boot " + cp.bootVersion()
                        + (cp.note().isEmpty() ? "" : "；" + cp.note()));
        out.put("bootVersion", cp.bootVersion());
        ArrayNode missing = out.putArray("missingDeps");
        cp.missing().forEach(missing::add);
        if (cp.jars().isEmpty()) {
            out.put("status", "not-executed");
            out.put("reason", "依赖解析不出来，起不来：" + cp.note());
            return out;
        }

        Path jdkBin = Path.of(System.getProperty("java.home", "")).resolve("bin");
        Path javac = pickExe(jdkBin, "javac");
        Path java = pickExe(jdkBin, "java");
        if (javac == null || java == null) {
            out.put("status", "not-executed");
            out.put("reason", "当前运行的是 JRE 而不是 JDK，找不到 javac/java —— 不能编译就不能真跑，"
                    + "这条如实记为未执行");
            return out;
        }

        // ── 2. 编译 ───────────────────────────────────────────
        Path classes = projectDir.resolve("target").resolve("classes");
        List<String> sources = new ArrayList<>();
        try {
            Files.createDirectories(classes);
            try (var walk = Files.walk(projectDir.resolve("src"))) {
                walk.filter(p -> p.toString().endsWith(".java"))
                        .filter(Files::isRegularFile)
                        .forEach(p -> sources.add(p.toString()));
            }
        } catch (IOException e) {
            sources.clear();
        }
        if (sources.isEmpty()) {
            out.put("status", "not-executed");
            out.put("reason", "项目里找不到任何 .java 源文件 —— 没有东西可编译，也就没有东西可跑");
            return out;
        }

        List<String> javacArgv = new ArrayList<>();
        javacArgv.add(javac.toString());
        javacArgv.add("-encoding");
        javacArgv.add("UTF-8");
        javacArgv.add("-nowarn");
        javacArgv.add("-d");
        javacArgv.add(classes.toString());
        javacArgv.add("-cp");
        javacArgv.add(String.join(";", cp.jars()));
        javacArgv.addAll(sources);

        long t1 = System.currentTimeMillis();
        RunSandbox.Outcome compiled = RunSandbox.run(
                RunSandbox.Command.of(projectDir, ".", javacArgv), null);
        addStep(steps, "compile", "ok".equals(compiled.status()) && compiled.exitCode() == 0 ? "ok" : "failed",
                System.currentTimeMillis() - t1,
                "javac " + sources.size() + " 个源文件，退出码 " + compiled.exitCode()
                        + ("ok".equals(compiled.status()) ? "" : "（" + compiled.reason() + "）"));
        if (compiled.exitCode() != 0) {
            out.put("status", "not-executed");
            out.put("reason", "编译不过 —— " + shortErrors(compiled.stderr(), compiled.stdout()));
            out.set("log", logNode(mapper, compiled, TAIL_LINES, ERROR_LINES));
            return out;
        }

        // ── 3. 起进程 + 采 health ─────────────────────────────
        String cpAll = classes + ";" + String.join(";", cp.jars());
        List<String> runArgv = List.of(java.toString(), "-Dfile.encoding=UTF-8", "-cp", cpAll,
                mainClass, "--server.port=0");

        boolean hasActuator = cp.jars().stream().anyMatch(j -> j.contains("spring-boot-actuator"));
        AtomicReference<String> seenPort = new AtomicReference<>(null);
        AtomicReference<int[]> healthStatus = new AtomicReference<>(null);
        AtomicReference<String> healthBody = new AtomicReference<>(null);

        long t2 = System.currentTimeMillis();
        // health 只能在进程还活着的时候问 —— RunSandbox 一判定「够了该停了」就杀进程树，
        // 所以这一步发生在 until 回调里。回调里做的是「取一个 HTTP 响应」，不是下结论。
        RunSandbox.Outcome ran = RunSandbox.run(
                new RunSandbox.Command(projectDir,
                        relativeWorkDir == null ? "." : relativeWorkDir, runArgv, Map.of(),
                        wallClockMs, RunSandbox.DEFAULT_MAX_OUTPUT_BYTES),
                live -> {
                    if (!live.alive()) return true;
                    String p = firstPort(live.stdoutLines());
                    if (p == null) p = firstPort(live.stderrLines());
                    if (p == null) return false;
                    seenPort.set(p);
                    if (!hasActuator) {
                        return true;
                    }
                    if (healthStatus.get() == null) {
                        HttpResponse<String> resp = getHealth(p);
                        healthStatus.set(new int[]{resp == null ? -1 : resp.statusCode()});
                        healthBody.set(resp == null ? null : resp.body());
                    }
                    return true;
                });
        addStep(steps, "run", ran.status(), System.currentTimeMillis() - t2,
                "墙钟上限 " + wallClockMs + "ms，实际 " + ran.elapsedMs() + "ms，退出码 " + ran.exitCode());

        out.set("process", mapper.createObjectNode()
                .put("status", ran.status())
                .put("stoppedBy", ran.stoppedBy())
                .put("exitCode", ran.exitCode())
                .put("elapsedMs", ran.elapsedMs())
                .put("truncated", ran.truncated())
                .put("reason", ran.reason() == null ? "" : ran.reason()));
        out.set("log", logNode(mapper, ran, TAIL_LINES, ERROR_LINES));

        ObjectNode portNode = out.putObject("port");
        String port = seenPort.get();
        if (port != null) {
            String[] ev = portEvidence(ran, port);
            portNode.put("value", Integer.parseInt(port));
            portNode.put("source", "startup-log");
            ObjectNode e = portNode.putObject("evidence");
            e.put("stream", ev[0]);
            e.put("line", Integer.parseInt(ev[1]));
            e.put("text", ev[2]);
        } else {
            portNode.putNull("value");
            portNode.put("source", "none");
            portNode.put("note", "启动日志里没有出现端口行 —— 没解析到就是没解析到，不给一个假的端口");
        }

        ObjectNode health = out.putObject("health");
        health.put("endpoint", "/actuator/health");
        if (!hasActuator) {
            health.put("probed", false);
            health.put("note", "classpath 里没有 spring-boot-actuator —— 这是「无 health 端点」，不是「健康」");
        } else if (healthStatus.get() == null) {
            health.put("probed", false);
            health.put("note", "没探到 health：进程在报端口之前就结束了，或墙钟到点也没起来");
        } else {
            int st = healthStatus.get()[0];
            health.put("probed", true);
            health.put("httpStatus", st);
            health.put("body", healthBody.get() == null ? "" : healthBody.get());
            if (st < 0) health.put("note", "health 请求没拿到响应（连接被拒 / 超时）");
        }

        boolean started = port != null;
        if (started) {
            out.put("status", "executed");
            out.put("reason", "");
        } else if ("timeout".equals(ran.status())) {
            out.put("status", "not-executed");
            out.put("reason", "墙钟 " + wallClockMs + "ms 内没起来，进程树已杀 —— 这是「起不来」，不是「起来了但没端口」");
        } else {
            out.put("status", "not-executed");
            // 先说哪几个构件降了版，再贴异常原文。否则读到的永远是 Spring 内部的
            // condition 报错，看不出「其实是要的那版没装、退到了 3.x 混进 4.1.1 家族」
            // ——2026-10-27 r9 实测的误导路径（登记为 B-7 时把它当成了「缺 4 个构件」）。
            String mixed = cp.missing().stream()
                    .filter(m -> m.contains("退到"))
                    .reduce((a, b) -> a + " / " + b)
                    .map(s -> "类路径里有降版构件 [" + s + "]，混版起跑")
                    .orElse("");
            out.put("reason", "起不来：" + (mixed.isEmpty() ? "" : mixed + "；")
                    + shortErrors(ran.stderr(), ran.stdout()));
        }
        return out;
    }

    // ── 事实摊平 ──────────────────────────────────────────────

    private static ObjectNode logNode(ObjectMapper mapper, RunSandbox.Outcome o, int tail, int errs) {
        ObjectNode node = mapper.createObjectNode();
        node.put("stdoutLines", countLines(o.stdout()));
        node.put("stderrLines", countLines(o.stderr()));

        ArrayNode tailArr = node.putArray("tail");
        int total = countLines(o.stdout());
        int from = Math.max(1, total - tail + 1);
        String[] so = split(o.stdout());
        for (int i = from - 1; i < so.length && tailArr.size() < tail; i++) {
            ObjectNode l = tailArr.addObject();
            l.put("n", i + 1);
            l.put("stream", "stdout");
            l.put("text", trim(so[i]));
        }
        ArrayNode errArr = node.putArray("errors");
        for (int i = 0; i < so.length && errArr.size() < errs; i++) {
            if (ERROR_LINE.matcher(so[i]).find()) {
                ObjectNode l = errArr.addObject();
                l.put("n", i + 1);
                l.put("stream", "stdout");
                l.put("text", trim(so[i]));
            }
        }
        String[] se = split(o.stderr());
        for (int i = 0; i < se.length && errArr.size() < errs; i++) {
            if (!se[i].isBlank()) {
                ObjectNode l = errArr.addObject();
                l.put("n", i + 1);
                l.put("stream", "stderr");
                l.put("text", trim(se[i]));
            }
        }
        return node;
    }

    private static String[] split(String s) {
        return s == null || s.isEmpty() ? new String[0] : s.split("\n", -1);
    }

    private static int countLines(String s) {
        String[] a = split(s);
        if (a.length == 0) return 0;
        if (a.length == 1 && a[0].isEmpty()) return 0;
        return a[a.length - 1].isEmpty() ? a.length - 1 : a.length;
    }

    private static String trim(String s) {
        return s.length() > 400 ? s.substring(0, 400) + "…[行被截断]" : s;
    }

    private static String firstPort(List<String> lines) {
        for (String l : lines) {
            Matcher m = PORT_LINE.matcher(l);
            if (m.find()) {
                String p = m.group(1);
                // "Tomcat initialized with port 0" 不是监听端口，0 也不是。
                if (!"0".equals(p)) return p;
            }
        }
        return null;
    }

    /** 找出这一行在哪个流、第几行 —— 证据必须有坐标，否则前端那句「日志第 N 行」无从核对 */
    private static String[] portEvidence(RunSandbox.Outcome o, String port) {
        String[] so = split(o.stdout());
        for (int i = 0; i < so.length; i++) {
            if (so[i].contains("Tomcat started on port") && so[i].contains(port)) {
                return new String[]{"stdout", String.valueOf(i + 1), trim(so[i])};
            }
        }
        String[] se = split(o.stderr());
        for (int i = 0; i < se.length; i++) {
            if (se[i].contains("Tomcat started on port") && se[i].contains(port)) {
                return new String[]{"stderr", String.valueOf(i + 1), trim(se[i])};
            }
        }
        return new String[]{"stdout", "0", ""};
    }

    private static HttpResponse<String> getHealth(String port) {
        try {
            HttpClient c = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(3))
                    .followRedirects(HttpClient.Redirect.NEVER)
                    .build();
            HttpRequest req = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/actuator/health"))
                    .timeout(Duration.ofSeconds(4))
                    .GET()
                    .build();
            return c.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * 从编译/启动输出里摘一句人话解释「为什么起不来」。
     *
     * <p><b>这里最容易出的静默失败</b>：只按 {@code ERROR|Exception} 去找。
     * javac 的中文报错是「需要';'」「不是语句」，一个 ERROR 字样都没有 ——
     * 结果 reason 变成「日志里没有明确的错误行」，而 stderr 里明明有四行编译错误。
     * 「起不来」配上「说不清为什么」，与「没事发生」长得一模一样，是本项目最忌讳的那种失败。
     * 所以正则捞不到时，<b>退到原样摘前三行 stderr</b>。
     */
    private static String shortErrors(String stderr, String stdout) {
        StringBuilder sb = new StringBuilder();
        for (String l : split(stderr)) {
            if (ERROR_LINE.matcher(l).find() && sb.length() < 300) sb.append(l.trim()).append(" / ");
        }
        if (sb.length() == 0) {
            String[] so = split(stdout);
            for (int i = so.length - 1; i >= 0 && sb.length() < 300; i--) {
                if (ERROR_LINE.matcher(so[i]).find()) sb.append(so[i].trim()).append(" / ");
            }
        }
        if (sb.length() == 0) {
            int taken = 0;
            for (String l : split(stderr)) {
                if (l.isBlank() || l.startsWith("Note:")) continue;
                sb.append(l.trim()).append(" / ");
                if (++taken >= 3) break;
            }
        }
        String s = sb.toString();
        return s.isEmpty() ? "起不来，且进程没有留下任何可读的错误输出（stderr 为空）" : s;
    }

    private static Path pickExe(Path jdkBin, String name) {
        Path exe = jdkBin.resolve(name + ".exe");
        if (Files.isRegularFile(exe)) return exe;
        Path plain = jdkBin.resolve(name);
        return Files.isRegularFile(plain) ? plain : null;
    }

    private static void addStep(ArrayNode steps, String name, String status, long ms, String detail) {
        ObjectNode n = steps.addObject();
        n.put("name", name);
        n.put("status", status);
        n.put("ms", ms);
        n.put("detail", detail == null ? "" : detail);
    }

    /**
     * CLI 入口：{@code java -cp <server classes+deps> com.arsenal.autopsy.RuntimeProbe <项目目录> <主类名> [runtime] [墙钟ms]}
     *
     * <p>存在理由见类注释：断言不能依赖 3011 活着。与 HTTP 端点共用 {@link #probe}，不是第二份实现。
     */
    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.out.println("{\"status\":\"not-executed\",\"reason\":\"用法：RuntimeProbe <项目目录> <主类名> [runtime] [墙钟ms]\"}");
            return;
        }
        Path dir = Path.of(args[0]).toAbsolutePath().normalize();
        String mainClass = args[1];
        String runtime = args.length > 2 ? args[2] : SUPPORTED_RUNTIME;
        long wall = args.length > 3 ? Long.parseLong(args[3]) : RunSandbox.DEFAULT_WALL_CLOCK_MS;
        String workDir = args.length > 4 ? args[4] : ".";
        Path m2 = Path.of(System.getenv().getOrDefault("M2_REPO",
                System.getProperty("user.home") + "/.m2/repository"));
        ObjectMapper mapper = new ObjectMapper();
        ObjectNode node = probe(dir, mainClass, runtime, wall, m2, mapper, workDir);
        System.out.println(mapper.writeValueAsString(node));
    }
}
