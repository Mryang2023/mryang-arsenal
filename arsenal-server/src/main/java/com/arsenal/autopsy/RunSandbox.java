package com.arsenal.autopsy;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;

/**
 * 跑别人代码的沙箱 —— **活体解剖这一跃唯一的安全边界。**
 *
 * <p>解剖台过去只「读」{@link com.arsenal.scan.ScanGuard} 那一层：不执行被扫仓库里的任何东西，
 * 写法形成 LicenseActivationServer 也解不出=<b>没有了。</b>
 * 活体解剖要把项目<b>真跑起来</b>，那条不变量就从「不执行」降级为「在约束里执行」——
 * 所以约束本身必须是硬的、可读的、有断言守着的。本类就是那一层。
 *
 * <p><b>七条硬约束</b>（每条都对应下面一段实现，改这个文件前先读完）：
 * <ol>
 *   <li><b>数组参数，绝不拼 shell</b> —— {@code cmd.argv} 原样交给 {@link ProcessBuilder}。
 *       用户路径里带空格 / 分号 / 反引号 / {@code && rm -rf} 都只会被当成一个普通参数，
 *       不会被执行。<b>本类里出现任何 {@code "cmd /c"} 或字符串拼接出的命令行都是事故。</b></li>
 *   <li><b>可执行文件白名单</b> —— 第一个参数必须是「工作副本内」或「当前 JDK 的 bin 下」的
 *       可执行文件。别的系统命令（{@code powershell} / {@code bash} / 用户塞进来的脚本）
 *       一律直接拒，进程根本不许起。</li>
 *   <li><b>路径逃逸</b> —— 工作目录 realPath 必须落在根的 realPath 内（复用
 *       {@link com.arsenal.scan.ScanGuard#isInside} 的同一套语义：
 *       只做字符串判断挡不住软链接，必须 toRealPath）。</li>
 *   <li><b>环境变量白名单</b> —— 先 {@code clear()} 再逐个放行。宿主进程的
 *       token / 密码 / CI 凭据不会因为「顺手继承」就漏进被解剖的进程里。</li>
 *   <li><b>墙钟上限</b> —— 默认 90s。到点没等到停下来的信号就杀进程树，
 *       返回 {@code timeout} + 已经采到的部分。</li>
 *   <li><b>输出上限</b> —— stdout / stderr 各 1MB，超出截断并置 {@code truncated}。
 *       一个死循环打印的 Boot 应用不该把服务端内存吃光。</li>
 *   <li><b>采完即杀</b> —— 无论正常结束、超时、还是中途出错，都会
 *       {@code finally} 杀整棵进程树。<b>跑完必须无残留</b>，这条有断言。</li>
 * </ol>
 *
 * <p><b>本类不做任何判断。</b>它只回答「这个进程怎么跑起来的、跑了多久、说了什么、怎么死的」。
 * 「起了几个服务」「端口对不对」「health 是不是 UP」这些结论在 TS 侧
 * （{@code arsenal-web/src/lib/runtime-recon.ts}）—— 本仓硬约定：判定逻辑只有一份实现。
 */
public final class RunSandbox {

    /** 墙钟上限：单次活体采集最多 90 秒。超过就是 timeout，不许「再等一会儿」 */
    public static final long DEFAULT_WALL_CLOCK_MS = 90_000L;
    /** 单股输出上限 1MB。超了截断，绝不让日志无限长住进内存 */
    public static final int DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

    /** 截断标记：出现在输出流里，前端/断言据此知道「后面还有，但被截了」 */
    public static final String TRUNCATED_MARK = "\n…[TRUNCATED]…\n";

    /**
     * 允许透传给子进程的环境变量。刻意极小 —— 宿主环境里有什么我们并不知道，
     * 白名单的意思是「说不清为什么要传的一律不传」。
     */
    private static final Set<String> ENV_WHITELIST = Set.of(
            "PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC",
            "TEMP", "TMP", "TMPDIR",
            "JAVA_HOME", "JDK_HOME", "M2_REPO",
            "LANG", "LC_ALL", "TZ",
            "TERM", "HOME", "USERPROFILE",
            "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "OS");

    private RunSandbox() {
    }

    /**
     * 一次沙箱执行的入参。全部不可空，构造时不校验 —— 校验在 {@link #run} 里集中做，
     * 免得「校验分散在两处，改了一处另一处静默放松」。
     */
    public record Command(
            /** 被解剖项目的根目录（已拷为本仓的工作副本） */
            Path root,
            /** 相对 root 的工作目录；"罃" 表示就是 root 自身。写 {@code ../..} 会被闸门拦下 */
            String relativeWorkDir,
            /** 数组形式的可执行文件 + 参数，绝不拼字符串 */
            List<String> argv,
            /** 额外环境变量（仍然要过白名单） */
            Map<String, String> extraEnv,
            long wallClockMs,
            int maxOutputBytes
    ) {

        public static Command of(Path root, String relativeWorkDir, List<String> argv) {
            return new Command(root, relativeWorkDir, argv, Map.of(),
                    DEFAULT_WALL_CLOCK_MS, DEFAULT_MAX_OUTPUT_BYTES);
        }
    }

    /** 跑的过程中能看到的实时切片，交给调用方决定「够了该停了」 */
    public record Live(
            List<String> stdoutLines,
            List<String> stderrLines,
            long elapsedMs,
            boolean alive
    ) {
    }

    /**
     * 执行结果。
     *
     * <p>{@code status} 的四态必须分清 —— 「没跑」和「跑了没成功」不许长得一样：
     * <ul>
     *   <li>{@code ok} —— 进程按预期停下，{@code exitCode} 是真实退出码</li>
     *   <li>{@code timeout} —— 墙钟到了，进程树已杀；{@code output} 里有杀之前采到的东西</li>
     *   <li>{@code refused} —— 入参没过安全闸门，<b>进程一个都没起</b>（这是最安静的一种失败，
     *       也是最容易被误读成「没问题」的一种，所以单独一个状态）</li>
     *   <li>{@code error} —— 起进程本身失败了（可执行文件不存在 / IO 错误）</li>
     * </ul>
     * 只要 {@code status != "ok"}，{@code reason} <b>必须</b>非空。
     */
    public record Outcome(
            String status,
            /**
             * 进程是怎么停的。<b>这个字段存在的理由</b>：Spring Boot 起来了就不会自己退，
             * 它最后是「被我们杀掉的」—— 退出码因此是 1（Windows 上强杀即 1）。
             * 只写 {@code status=ok} + {@code exitCode=1} 会让人以为它崩了；
             * 写上 {@code stoppedBy=signal} 才说清「是我们让它停的」。
             * 「它自己退的」和「我们杀的」绝不能长得一样。
             */
            String stoppedBy,
            int exitCode,
            String stdout,
            String stderr,
            boolean truncated,
            long elapsedMs,
            String reason
    ) {

        /** 进程是怎么停的取值 */
        public static final String STOPPED_EXITED = "exited";
        public static final String STOPPED_SIGNAL = "signal";
        public static final String STOPPED_TIMEOUT = "timeout";

        public static Outcome refused(String reason) {
            return new Outcome("refused", STOPPED_EXITED, -1, "", "", false, 0L, reason);
        }
    }

    /**
     * 起一个进程，直到 {@code until} 说停（或墙钟到点），然后杀掉整棵进程树。
     *
     * <p>{@code until} 存在的理由：Spring Boot 启动成功之后会一直活着等请求，
     * 等它自己退出是等不来的。所以「什么时候算采够了」必须由调用方根据输出判断 ——
     * 采集器看有没有出现 {@code Tomcat started} / {@code Started XxxApplication}，
     * 编译器只看进程是否结束。<b>判断在调用方，兜底（超时/杀树）在这里。</b>
     *
     * @return 永不为空的 {@link Outcome}；不出异常。恶意入参也只会得到 {@code refused}
     */
    public static Outcome run(Command cmd, Predicate<Live> until) {
        List<String> problems = validate(cmd);
        if (!problems.isEmpty()) {
            return Outcome.refused(String.join("；", problems));
        }

        Path workDir;
        try {
            workDir = resolveInside(cmd.root(), cmd.relativeWorkDir());
        } catch (Exception e) {
            return Outcome.refused("工作目录不可用：" + e.getMessage());
        }

        ProcessBuilder pb = new ProcessBuilder(new ArrayList<>(cmd.argv()));
        pb.directory(workDir.toFile());
        // 被解剖的进程不许读宿主的 stdin：给了它一个把手，就可能把采集会话挂住。
        // 用 PIPE 并在 start 之后立刻关掉（DISCARD 只能用于输出流，喂给 redirectInput 会抛
        // "Redirect invalid for reading" —— 这个坑踩过一次，别改回去）。
        pb.redirectInput(ProcessBuilder.Redirect.PIPE);
        Map<String, String> env = pb.environment();
        env.clear();
        for (Map.Entry<String, String> e : System.getenv().entrySet()) {
            if (ENV_WHITELIST.contains(e.getKey().toUpperCase(Locale.ROOT))) {
                env.put(e.getKey(), e.getValue());
            }
        }
        for (Map.Entry<String, String> e : cmd.extraEnv().entrySet()) {
            String key = e.getKey().toUpperCase(Locale.ROOT);
            if (!ENV_WHITELIST.contains(key)) {
                return Outcome.refused("环境变量不在白名单里：「" + e.getKey()
                        + "」—— 宿主进程的环境变量不透传给被解剖的项目");
            }
            env.put(e.getKey(), e.getValue());
        }

        long startedAt = System.nanoTime();
        Process proc = null;
        ExecutorService pump = null;
        try {
            proc = pb.start();
            Process handle = proc;
            try {
                handle.getOutputStream().close();
            } catch (IOException closeIgnored) {
                // 关不掉 stdin 也要继续：被解剖的进程多数不读 stdin
            }

            Collector stdout = new Collector(cmd.maxOutputBytes());
            Collector stderr = new Collector(cmd.maxOutputBytes());
            pump = Executors.newFixedThreadPool(2, r -> {
                Thread t = new Thread(r, "arsenal-run-pump");
                t.setDaemon(true);
                return t;
            });
            pump.submit(() -> drain(handle.getInputStream(), stdout));
            pump.submit(() -> drain(handle.getErrorStream(), stderr));

            long deadline = System.currentTimeMillis() + cmd.wallClockMs();
            while (System.currentTimeMillis() < deadline) {
                Live live = new Live(stdout.snapshot(), stderr.snapshot(), elapsedMs(startedAt), handle.isAlive());
                if (until == null ? !handle.isAlive() : until.test(live)) {
                    boolean wasAlive = handle.isAlive();
                    if (wasAlive) killTree(handle);
                    awaitExit(handle);
                    String stopped = wasAlive ? Outcome.STOPPED_SIGNAL : Outcome.STOPPED_EXITED;
                    return finish(startedAt, handle, stdout, stderr, "ok", stopped, "");
                }
                if (!handle.isAlive()) {
                    break;
                }
                Thread.sleep(120L);
            }
            boolean dead = !handle.isAlive();
            if (!dead) {
                killTree(handle);
                awaitExit(handle);
                return finish(startedAt, handle, stdout, stderr, "timeout", Outcome.STOPPED_TIMEOUT,
                        "墙钟 " + cmd.wallClockMs() + "ms 到了还没等到停止信号 —— 进程树已杀。"
                                + "已经采到的部分照实返回（它被标记为 timeout，不是「成功」）");
            }
            return finish(startedAt, handle, stdout, stderr, "ok", Outcome.STOPPED_EXITED, "");
        } catch (IOException e) {
            if (proc != null) killTree(proc);
            return new Outcome("error", Outcome.STOPPED_EXITED, -1, "", "", false, elapsedMs(startedAt),
                    "起不来进程：" + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            if (proc != null) {
                killTree(proc);
                awaitExit(proc);
            }
            return new Outcome("error", Outcome.STOPPED_SIGNAL, -1, "", "", false, elapsedMs(startedAt),
                    "采集被中断 —— 进程树已杀");
        } finally {
            if (pump != null) pump.shutdownNow();
            if (proc != null && proc.isAlive()) {
                killTree(proc);
                awaitExit(proc);
            }
        }
    }

    // ── 闸门 ────────────────────────────────────────────────────

    /**
     * 入参校验。返回空列表表示放行；每一条都被原样塞进 {@code refused} 的 reason ——
     * 「拒绝得让人看不懂」和「静默放行」是同一种坏。
     */
    private static List<String> validate(Command cmd) {
        List<String> bad = new ArrayList<>();
        if (cmd == null) return List.of("命令为空");
        if (cmd.root() == null || !Files.isDirectory(cmd.root())) {
            bad.add("根目录不存在或不是目录");
        }
        if (cmd.argv() == null || cmd.argv().isEmpty()) {
            bad.add("命令行为空（至少要有一个可执行文件）");
            return bad;
        }
        for (int i = 0; i < cmd.argv().size(); i++) {
            if (cmd.argv().get(i) == null) bad.add("命令行第 " + (i + 1) + " 项是 null");
        }
        if (!bad.isEmpty()) return bad;

        // 可执行文件白名单：要么在工作副本内，要么是当前 JDK 的 bin 下。
        // 这条卡死了「借 java 的壳去跑 powershell」这类变体。
        String exeRaw = cmd.argv().get(0);
        try {
            Path exe = Path.of(exeRaw).toAbsolutePath().normalize();
            if (!allowedExecutable(cmd.root(), exe)) {
                bad.add("可执行文件不在允许范围内：「" + Path.of(exeRaw).getFileName()
                        + "」—— 只允许被解剖项目里的文件，或当前 JDK 的 bin 下的工具");
            }
        } catch (Exception e) {
            bad.add("可执行文件路径不合法：「" + exeRaw + "」");
        }
        if (cmd.wallClockMs() <= 0 || cmd.wallClockMs() > 300_000L) {
            bad.add("墙钟上限必须落在 (0, 300000]ms，收到 " + cmd.wallClockMs());
        }
        if (cmd.maxOutputBytes() < 1024) {
            bad.add("输出上限不能小于 1KB（收到 " + cmd.maxOutputBytes() + " 字节）");
        }
        return bad;
    }

    private static boolean allowedExecutable(Path root, Path exe) {
        try {
            Path abs = exe.toAbsolutePath().normalize();
            if (isInside(root, abs)) return true;
            String home = System.getProperty("java.home", "");
            if (home.isBlank()) return false;
            Path jdk = Path.of(home).toAbsolutePath().normalize();
            if (!Files.isDirectory(jdk)) return false;
            Path realExe = Files.exists(abs) ? abs.toRealPath() : abs;
            return realExe.startsWith(jdk.toRealPath());
        } catch (Exception e) {
            return false;
        }
    }

    /** 与 ScanGuard.isInside 同语义：realPath 必须落在 realRoot 内。解析失败一律按出圈处理 */
    private static boolean isInside(Path root, Path candidate) {
        try {
            Path realRoot = root.toRealPath();
            Path real = Files.exists(candidate) ? candidate.toRealPath()
                    : candidate.toAbsolutePath().normalize();
            return real.startsWith(realRoot);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * 解析工作目录。{@code ../..} 这类逃逸在这里被拦 —— 先看 realPath 落在不在根内，
     * 而不是先看字符串里有没有 ".."（后者会被 {@code a/../..} 骗过去）。
     */
    private static Path resolveInside(Path root, String relative) throws IOException {
        Path realRoot = root.toRealPath();
        Path target = realRoot;
        if (relative != null && !relative.isBlank() && !relative.equals(".")) {
            target = realRoot.resolve(relative).normalize();
        }
        if (!Files.isDirectory(target)) {
            throw new IOException("工作目录「" + relative + "」不是目录");
        }
        Path realTarget = target.toRealPath();
        if (!realTarget.startsWith(realRoot)) {
            throw new IOException("工作目录「" + relative + "」解析后落在被解剖项目之外 —— 拒绝执行");
        }
        return realTarget;
    }

    // ── 输出采集 ────────────────────────────────────────────────

    /** 一边接受 bytes 一边记账，过上限就不再存。 */
    private static final class Collector {
        private final int cap;
        private final StringBuilder buf = new StringBuilder();
        private int bytes;
        private volatile boolean truncated;

        Collector(int cap) {
            this.cap = cap;
        }

        synchronized void append(String s) {
            bytes += s.getBytes(StandardCharsets.UTF_8).length;
            if (buf.length() < cap) {
                buf.append(s);
                if (buf.length() >= cap) {
                    buf.append(TRUNCATED_MARK);
                    truncated = true;
                }
            } else {
                truncated = true;
            }
        }

        synchronized List<String> snapshot() {
            String text = buf.toString();
            if (text.isEmpty()) return Collections.emptyList();
            List<String> lines = new ArrayList<>();
            text.lines().forEach(lines::add);
            return Collections.unmodifiableList(new ArrayList<>(lines));
        }

        String text() {
            return buf.toString();
        }

        boolean truncated() {
            return truncated;
        }
    }

    private static void drain(InputStream in, Collector sink) {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) {
                sink.append(line + "\n");
            }
        } catch (IOException e) {
            // 进程被杀时流会断，这是预期路径，不是错误
        }
    }

    // ── 进程树 ──────────────────────────────────────────────────

    /**
     * 杀整棵进程树。只 destroy 子进程不够 —— mvn/java 会再 fork 孙子，
     * 留一个活着的，端口就还占着，「跑完无残留」那条断言就是假的。
     */
    private static void killTree(Process proc) {
        try {
            ProcessHandle h = proc.toHandle();
            h.descendants().forEach(ProcessHandle::destroyForcibly);
            h.destroyForcibly();
        } catch (Exception ignored) {
            // 杀不掉也不能让采集本身失败；调用方另有「无残留」断言兜着
        }
    }

    private static void awaitExit(Process proc) {
        try {
            if (!proc.waitFor(3, TimeUnit.SECONDS)) {
                killTree(proc);
                proc.waitFor(3, TimeUnit.SECONDS);
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static long elapsedMs(long startedAt) {
        return (System.nanoTime() - startedAt) / 1_000_000L;
    }

    private static Outcome finish(long startedAt, Process proc, Collector out, Collector err,
                                  String status, String stoppedBy, String reason) {
        int code;
        try {
            code = proc.exitValue();
        } catch (IllegalThreadStateException notDeadYet) {
            // 走到这里说明杀树没杀干净。退出码报 -2 而不是编一个 0 ——
            // 「进程还活着」和「进程正常退出」绝不能长得一样。
            code = -2;
        }
        return new Outcome(status, stoppedBy, code, out.text(), err.text(),
                out.truncated() || err.truncated(), elapsedMs(startedAt), reason);
    }
}
