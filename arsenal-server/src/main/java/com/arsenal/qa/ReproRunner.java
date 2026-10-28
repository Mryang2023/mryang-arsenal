package com.arsenal.qa;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.function.Predicate;

import com.arsenal.autopsy.RunSandbox;
import com.arsenal.autopsy.RuntimeClasspath;

/**
 * 复现测试的执行器 —— 把一段测试源码变成「跑红了没有」这个事实。
 *
 * <p><b>它不判定</b>。判定在 {@link ReproVerdict}（纯逻辑、无 IO）。这里只做四件事：
 * 写文件 → 编译 → 跑 N 次 → 每次交一份 {@link ReproVerdict.Run} 回去。
 * 分开的理由和本仓其他判据层一样：能直接验证的纯逻辑不该藏在副作用里。
 *
 * ─────────────────────────────────────────────────────────────
 * 三条安全/正确性上的硬约定：
 *
 * ① **只在工作副本里写。** 用户的目录一个字节都不动 —— 测试源码写到
 *    {@code <工作副本>/src/test/java/...}，跑完随副本一起删。
 *    这一条与 {@code /api/autopsy/run} 同一套纪律（{@link RunSandbox}）。
 *
 * ② <b>不拼 shell。</b>javac / java 都是 {@code List<String>} 数组参数，
 *    路径里有空格或引号都不会变成命令注入 —— 本仓在 {@code SourceResolver}
 *    与 {@code RunSandbox} 上已经各补过一次，不做第三次。
 *
 * ③ <b>用户源码本来就编不过时，如实说「没跑」而不是「没复现」。</b>
 *    javac 失败不是「测试绿了」，它什么都不能说明。这种情况进
 *    {@link ReproVerdict#NOT_RUN}，reason 里带上 javac 的第一处错误。
 */
public final class ReproRunner {

    private ReproRunner() {
    }

    /** 一次编译 + 一次运行的预算。编译用户全量源码本身就慢，墙钟给得比测试宽。 */
    public static final long COMPILE_WALL_MS = 180_000L;
    public static final long TEST_WALL_MS = 60_000L;
    /** 默认跑几次取复现率。1 次分不出「稳定复现」与「碰巧红」。 */
    public static final int DEFAULT_ATTEMPTS = 3;

    private static final String BEGIN = "ARSENAL-REPRO-BEGIN";
    private static final String END = "ARSENAL-REPRO-END";

    /** 一段待跑的复现测试。 */
    public record Draft(String fqcn, String source) {
    }

    public record Result(ReproVerdict.Judgement judgement, String compileError, long compileMs,
                         List<String> testClasspath) {
    }

    /**
     * 编译并跑。
     *
     * @param workCopy  被检项目的**工作副本**（用户的原目录绝不能传进来）
     * @param m2Repo    本地仓库
     * @param draft     测试源码
     * @param attempts  跑几次
     */
    public static Result run(Path workCopy, Path m2Repo, Draft draft, int attempts) {
        String cp;
        try {
            cp = testClasspath(workCopy, m2Repo);
        } catch (RuntimeException e) {
            return fail("组装测试 classpath 失败：" + e.getMessage(), List.of());
        }
        List<String> jars = jarList(cp);

        Path testFile;
        try {
            testFile = writeTest(workCopy, draft);
        } catch (IOException | RuntimeException e) {
            return fail("复现测试写不进工作副本：" + e.getMessage(), jars);
        }

        Path out = workCopy.resolve("target").resolve("arsenal-repro");
        long compileMs;
        String compileError = "";
        try {
            Files.createDirectories(out);
        } catch (IOException e) {
            return fail("建输出目录失败：" + e.getMessage(), jars);
        }

        // ── 启动器先编出来 ──
        // 它是 classpath 资源（服务端不编译期依赖 JUnit），落进工作副本再 javac。
        // 少了 junit jar 时**就是这里**失败 —— 而失败被记成 NOT_RUN，不是「没复现」。
        Path launcherSrc;
        try {
            launcherSrc = extractLauncher(out);
        } catch (IOException | RuntimeException e) {
            return fail("取不到复现启动器源码（classpath 资源缺失）：" + e.getMessage(), jars);
        }
        Path launcherArg = out.resolve("launcher.txt");
        try {
            Files.writeString(launcherArg, "\"" + launcherSrc + "\"\r\n", StandardCharsets.UTF_8);
        } catch (IOException e) {
            return fail("写启动器参数文件失败：" + e.getMessage(), jars);
        }
        long l0 = System.currentTimeMillis();
        RunSandbox.Outcome lc = exec(m2Repo, workCopy, List.of(
                "-nowarn", "-proc:none", "-encoding", "UTF-8",
                "-cp", cp, "-d", out.toString(), "@" + launcherArg), COMPILE_WALL_MS);
        if (!"ok".equals(lc.status()) || lc.exitCode() != 0) {
            String why = firstMeaningfulLine(lc.stdout() + "\n" + lc.stderr());
            return fail("复现启动器编译不过 —— 说明 .m2 里缺 junit-platform-launcher / jupiter-engine 之一："
                    + why, jars);
        }
        long launcherMs = System.currentTimeMillis() - l0;

        List<Path> sources = new ArrayList<>();
        Path mainJava = workCopy.resolve("src/main/java");
        if (Files.isDirectory(mainJava)) {
            try (var st = Files.walk(mainJava)) {
                st.filter(p -> p.toString().endsWith(".java")).forEach(sources::add);
            } catch (IOException e) {
                return fail("列用户源码失败：" + e.getMessage(), jars);
            }
        }
        sources.add(testFile);

        // @argfile：源码一多命令行就超 Windows 32K 限制，javac 会直接拒绝而不是截断。
        // 这里落一个临时参数文件，跑完删（它在工作副本里，随副本一起没）。
        Path argFile;
        try {
            StringBuilder sb = new StringBuilder();
            for (Path p : sources) {
                sb.append('"').append(p.toString()).append("\r\n");
            }
            Files.writeString(argFile = out.resolve("sources.txt"), sb.toString(), StandardCharsets.UTF_8);
        } catch (IOException e) {
            return fail("写 javac 参数文件失败：" + e.getMessage(), jars);
        }
        List<String> javacFinal = List.of(
                "-nowarn", "-proc:none", "-encoding", "UTF-8",
                "-cp", cp, "-d", out.toString(), "@" + argFile);

        long t0 = System.currentTimeMillis();
        RunSandbox.Outcome c = exec(m2Repo, workCopy, javacFinal, COMPILE_WALL_MS);
        compileMs = launcherMs + (System.currentTimeMillis() - t0);

        if (!"ok".equals(c.status()) || c.exitCode() != 0) {
            compileError = firstMeaningfulLine(c.stdout() + "\n" + c.stderr());
            if (!"ok".equals(c.status())) {
                compileError = c.reason() + (compileError.isBlank() ? "" : "；" + compileError);
            }
            return new Result(
                    new ReproVerdict.Judgement(ReproVerdict.NOT_RUN,
                            "复现测试没编译过，这次什么都不能说明（不是「没复现」）：" + compileError,
                            0, 0, null, ""),
                    compileError, compileMs, jars);
        }

        List<ReproVerdict.Run> runs = new ArrayList<>();
        for (int i = 0; i < Math.max(1, attempts); i++) {
            runs.add(runOnce(m2Repo, workCopy, draft.fqcn(), cp, out));
        }
        return new Result(ReproVerdict.judge(runs), "", compileMs, jars);
    }

    private static ReproVerdict.Run runOnce(Path m2Repo, Path workCopy, String fqcn,
                                            String cp, Path out) {
        List<String> argv = new ArrayList<>(List.of(
                "-Dfile.encoding=UTF-8",
                "-cp", cp + java.io.File.pathSeparator + out,
                LAUNCHER_FQCN, fqcn));
        RunSandbox.Outcome o = exec(m2Repo, workCopy, argv, TEST_WALL_MS);
        if ("refused".equals(o.status())) {
            return ReproVerdict.Run.notRun("沙箱拒了这一次执行：" + o.reason());
        }
        if ("error".equals(o.status())) {
            return ReproVerdict.Run.notRun("起不来：" + o.reason());
        }
        if ("timeout".equals(o.status())) {
            return ReproVerdict.Run.notRun("跑超时（超过 " + (TEST_WALL_MS / 1000) + "s），这次不计入分母");
        }
        return new ReproVerdict.Run(true, o.exitCode(), o.stdout(), o.stderr(),
                "ok".equals(o.status()) ? "" : o.reason());
    }

    /** 组装 classpath：用户自己的运行期 jar + junit/platform 那几个。<b>不含本仓 classes</b> —— 启动器是现编的。 */
    static String testClasspath(Path workCopy, Path m2Repo) {
        Set<String> parts = new LinkedHashSet<>();
        RuntimeClasspath.Resolved user = RuntimeClasspath.resolve(workCopy, m2Repo);
        parts.addAll(user.jars());
        for (String spec : JUNIT_SPECS) {
            Path jar = findJar(m2Repo, spec);
            if (jar != null) {
                parts.add(jar.toString());
            }
        }
        StringBuilder sb = new StringBuilder();
        for (String p : parts) {
            if (sb.length() > 0) {
                sb.append(java.io.File.pathSeparatorChar);
            }
            sb.append(p);
        }
        return sb.toString();
    }

    /** 少任何一个都跑不起来 —— 缺谁要能一眼看出来，所以清单写死在这里而不去猜版本。 */
    private static final List<String> JUNIT_SPECS = List.of(
            "org/junit/jupiter/junit-jupiter-api",
            "org/junit/jupiter/junit-jupiter-engine",
            "org/junit/platform/junit-platform-commons",
            "org/junit/platform/junit-platform-engine",
            "org/junit/platform/junit-platform-launcher",
            "org/opentest4j/opentest4j",
            "org/apiguardian/apiguardian-api");

    /** 启动器的全限定名。与资源文件里的 package + 类名保持一致 —— 改一处必须改两处。 */
    static final String LAUNCHER_FQCN = "com.arsenal.qa.ReproTestLauncher";
    private static final String LAUNCHER_RESOURCE = "qa/ReproTestLauncher.java";

    /**
     * 把启动器源码从 classpath 资源取出来落盘。
     *
     * <p>它必须落进<b>工作副本</b>而不是临时目录的随机路径：javac 出来的 .class
     * 与源文件包名要对得上，而我们要跑的 classpath 只含工作副本里的产物。
     */
    private static Path extractLauncher(Path out) throws IOException {
        try (var in = ReproRunner.class.getClassLoader().getResourceAsStream(LAUNCHER_RESOURCE)) {
            if (in == null) {
                throw new IOException("classpath 里没有 " + LAUNCHER_RESOURCE
                        + "（打包时漏了 src/main/resources/qa）");
            }
            Path src = out.resolve("launcher-src").resolve("ReproTestLauncher.java");
            Files.createDirectories(src.getParent());
            Files.writeString(src, new String(in.readAllBytes(), StandardCharsets.UTF_8), StandardCharsets.UTF_8);
            return src;
        }
    }

    /** 找一个 groupPath/artifact 下**最新的那个版本** —— .m2 里常有好几版，猜版本会猜错。 */
    private static Path findJar(Path m2Repo, String groupPath) {
        Path dir = m2Repo.resolve(groupPath);
        if (!Files.isDirectory(dir)) {
            return null;
        }
        Path best = null;
        try (var st = Files.list(dir)) {
            for (Path v : st.toList()) {
                if (!Files.isDirectory(v)) {
                    continue;
                }
                try (var files = Files.list(v)) {
                    for (Path f : files.toList()) {
                        String n = f.getFileName().toString();
                        if (n.endsWith(".jar") && !n.contains("sources") && !n.contains("javadoc")) {
                            if (best == null || v.getFileName().toString().compareTo(best.getParent().getFileName().toString()) > 0) {
                                best = f;
                            }
                        }
                    }
                }
            }
        } catch (IOException e) {
            return null;
        }
        return best;
    }

    private static Path writeTest(Path workCopy, Draft draft) throws IOException {
        // fqcn 来自模型输出（且模型输入含被检项目源码，可能被提示注入）。绝对路径 / UNC /
        // 盘符 / .. 都会经 Path.resolve 原样生效，把文件写到工作副本之外 —— 与
        // CaseRunnerService 对 mainClass 的校验保持同一条正则，写入点最后把关。
        if (draft.fqcn() == null
                || !draft.fqcn().matches("[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)+")) {
            throw new IllegalArgumentException("测试类全限定名不合法：" + draft.fqcn());
        }
        String rel = draft.fqcn().replace('.', '/') + ".java";
        Path p = workCopy.resolve("src/test/java").resolve(rel);
        Files.createDirectories(p.getParent());
        Files.writeString(p, draft.source(), StandardCharsets.UTF_8);
        return p;
    }

    private static RunSandbox.Outcome exec(Path m2Repo, Path workCopy, List<String> argv, long wallMs) {
        RunSandbox.Command cmd = new RunSandbox.Command(workCopy, ".",
                argv, java.util.Map.of("M2_REPO", m2Repo.toString()), wallMs, RunSandbox.DEFAULT_MAX_OUTPUT_BYTES);
        Predicate<RunSandbox.Live> until = live -> !live.alive() && live.elapsedMs() > 300;
        return RunSandbox.run(cmd, until);
    }

    private static String firstMeaningfulLine(String s) {
        for (String line : s.split("\n")) {
            String t = line.strip();
            if (t.isEmpty()) {
                continue;
            }
            if (t.startsWith("ARSENAL-REPRO-")) {
                continue;
            }
            if (t.contains("error:") || t.contains("错误:")) {
                return t.length() > 300 ? t.substring(0, 300) + "…" : t;
            }
        }
        for (String line : s.split("\n")) {
            String t = line.strip();
            if (!t.isEmpty()) {
                return t.length() > 300 ? t.substring(0, 300) + "…" : t;
            }
        }
        return "(javac 没给出任何输出)";
    }

    private static List<String> jarList(String cp) {
        return List.of(cp.split(java.util.regex.Pattern.quote(java.io.File.pathSeparator)));
    }

    private static Result fail(String reason, List<String> jars) {
        return new Result(new ReproVerdict.Judgement(ReproVerdict.NOT_RUN, reason, 0, 0, null, ""),
                reason, 0L, jars);
    }

    /** 哨兵常量暴露给调用方做自检（断言层会核对启动器与解析器用的是同一对字符串）。 */
    public static String beginMarker() {
        return BEGIN;
    }

    public static String endMarker() {
        return END;
    }
}
