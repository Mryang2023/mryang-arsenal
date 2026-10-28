package com.arsenal.cases;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * 案例执行引擎。
 *
 * <p>把用户提交的 Java 源文件，用独立的 JDK 21 子进程编译并运行，捕获 stdout/stderr/退出码。
 * 每请求一个临时工作目录，跑完即删；运行超时强杀。整个过程与主服务进程隔离，
 * 单服务挂了不影响规则/校验链路（也避免用户代码直接在主 JVM 里搞破坏）。
 *
 * <p>安全边界（个人工具定位，不做多租户隔离）：
 * - 运行在子进程里，带 {@code -Xmx} 上限；
 * - 输出有体量上限，超了截断（仍继续排空管道避免子进程阻塞）；
 * - 超时 {@code destroyForcibly}；
 * - 不接公网、不持久化用户代码。要更强的沙箱请自行在容器/专用机器上跑。
 */
@Service
public class CaseRunnerService {

    private static final Logger log = LoggerFactory.getLogger(CaseRunnerService.class);

    private final JdkResolver jdk;
    private final long runTimeoutMs;
    private final long compileTimeoutMs;
    private final long maxOutputBytes;
    private final int maxFiles;
    private final long maxSourceBytes;
    private final String maxHeap;
    private final Path workRoot;

    public CaseRunnerService(
            @Value("${arsenal.cases.jdk-home:}") String jdkHome,
            @Value("${arsenal.cases.run-timeout-ms:30000}") long runTimeoutMs,
            @Value("${arsenal.cases.compile-timeout-ms:30000}") long compileTimeoutMs,
            @Value("${arsenal.cases.max-output-bytes:524288}") long maxOutputBytes,
            @Value("${arsenal.cases.max-files:50}") int maxFiles,
            @Value("${arsenal.cases.max-source-bytes:200000}") long maxSourceBytes,
            @Value("${arsenal.cases.max-heap:256m}") String maxHeap,
            @Value("${arsenal.cases.work-dir:}") String workDir) {
        this.jdk = new JdkResolver(jdkHome);
        this.runTimeoutMs = runTimeoutMs;
        this.compileTimeoutMs = compileTimeoutMs;
        this.maxOutputBytes = maxOutputBytes;
        this.maxFiles = maxFiles;
        this.maxSourceBytes = maxSourceBytes;
        this.maxHeap = maxHeap;
        this.workRoot = (workDir == null || workDir.isBlank())
                ? Path.of(System.getProperty("java.io.tmpdir"))
                : Path.of(workDir);
    }

    public String jdkVersion() {
        return jdk.version();
    }

    public String javaHome() {
        return jdk.javaHome().toString();
    }

    public String javaCmd() {
        return jdk.javaCmd();
    }

    public String javacCmd() {
        return jdk.javacCmd();
    }

    public CaseRunResult run(CaseRunRequest req) {
        validate(req);

        Path dir = newWorkDir();
        try {
            writeSources(dir, req.getFiles());
            CaseRunResult compiled = compile(dir, req);
            if (!compiled.compiled()) {
                return compiled;
            }
            return execute(dir, req);
        } finally {
            deleteDir(dir);
        }
    }

    // ── 校验 ───────────────────────────────────────────────
    private void validate(CaseRunRequest req) {
        if (req == null || req.getFiles() == null || req.getFiles().isEmpty()) {
            throw new IllegalArgumentException("files 不能为空");
        }
        if (req.getFiles().size() > maxFiles) {
            throw new IllegalArgumentException("源文件数超过上限 " + maxFiles);
        }
        if (req.getMainClass() == null || !req.getMainClass().matches("[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*")) {
            throw new IllegalArgumentException("mainClass 必须是合法完全限定名，例如 demo.Main");
        }
        long total = 0;
        for (SourceFile f : req.getFiles()) {
            if (f.getPath() == null || f.getCode() == null) {
                throw new IllegalArgumentException("每个文件都必须有 path 和 code");
            }
            if (!f.getPath().endsWith(".java")) {
                throw new IllegalArgumentException("只接受 .java 文件：" + f.getPath());
            }
            if (f.getPath().contains("..") || Path.of(f.getPath()).isAbsolute()) {
                throw new IllegalArgumentException("path 不得包含 .. 或为绝对路径：" + f.getPath());
            }
            total += f.getCode().length();
        }
        if (total > maxSourceBytes) {
            throw new IllegalArgumentException("源码总大小超过上限 " + maxSourceBytes + " 字节");
        }
    }

    // ── 落盘 ───────────────────────────────────────────────
    private Path newWorkDir() {
        try {
            return Files.createTempDirectory(workRoot, "arsenal-case-");
        } catch (IOException e) {
            throw new CaseException("CASE_WORKDIR", "无法创建临时工作目录：" + e.getMessage(), 503);
        }
    }

    private void writeSources(Path dir, List<SourceFile> files) {
        for (SourceFile f : files) {
            Path target = dir.resolve(f.getPath()).normalize();
            if (!target.startsWith(dir.normalize())) {
                throw new IllegalArgumentException("path 越界：" + f.getPath());
            }
            try {
                Files.createDirectories(target.getParent());
                Files.writeString(target, f.getCode(), StandardCharsets.UTF_8);
            } catch (IOException e) {
                throw new CaseException("CASE_WRITE", "写入源文件失败：" + e.getMessage(), 500);
            }
        }
    }

    // ── 编译 ───────────────────────────────────────────────
    private CaseRunResult compile(Path dir, CaseRunRequest req) {
        Path out = dir.resolve("out");
        try {
            Files.createDirectories(out);
        } catch (IOException e) {
            throw new CaseException("CASE_COMPILE", "无法创建输出目录：" + e.getMessage(), 500);
        }

        List<String> sources = new ArrayList<>();
        for (SourceFile f : req.getFiles()) {
            sources.add(dir.resolve(f.getPath()).normalize().toString());
        }
        Path argfile = dir.resolve("sources.txt");
        try {
            Files.write(argfile, sources, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new CaseException("CASE_COMPILE", "写入编译清单失败：" + e.getMessage(), 500);
        }

        List<String> cmd = new ArrayList<>();
        cmd.add(jdk.javacCmd());
        // 强制 javac 自身（及其报错）用 UTF-8 输出，避免 Windows 下中文报错变乱码。
        // 诊断信息走控制台流，受 sun.stdout/stderr.encoding 控制，光 file.encoding 不够。
        cmd.add("-J-Dfile.encoding=UTF-8");
        cmd.add("-J-Dsun.stdout.encoding=UTF-8");
        cmd.add("-J-Dsun.stderr.encoding=UTF-8");
        cmd.add("-encoding");
        cmd.add("UTF-8");
        cmd.add("-d");
        cmd.add(out.toString());
        cmd.add("@" + argfile);

        long start = System.nanoTime();
        try {
            Process p = new ProcessBuilder(cmd).directory(dir.toFile()).start();
            String[] outErr = capture(p, compileTimeoutMs);
            boolean finished = p.waitFor(compileTimeoutMs, TimeUnit.MILLISECONDS);
            if (!finished) {
                p.destroyForcibly();
                return CaseRunResult.compileTimeout(jdk.version(), nanos(start));
            }
            int code = p.exitValue();
            if (code != 0) {
                return CaseRunResult.compileError(jdk.version(),
                        (outErr[1] == null ? "" : outErr[1]), nanos(start));
            }
            return CaseRunResult.run(jdk.version(), "", "", 0, false, nanos(start));
        } catch (IOException e) {
            throw new CaseException("CASE_COMPILE", "启动 javac 失败：" + e.getMessage(), 503);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new CaseException("CASE_COMPILE", "编译被中断", 500);
        }
    }

    // ── 运行 ───────────────────────────────────────────────
    private CaseRunResult execute(Path dir, CaseRunRequest req) {
        Path out = dir.resolve("out");
        long timeout = (req.getTimeoutMs() != null)
                ? Math.min(Math.max(req.getTimeoutMs(), 1000), 300_000)
                : runTimeoutMs;

        List<String> cmd = new ArrayList<>();
        cmd.add(jdk.javaCmd());
        // 强制 JVM 控制台流用 UTF-8 输出，否则 Windows 下 System.out 中文会变成 GBK 乱码
        cmd.add("-Dfile.encoding=UTF-8");
        cmd.add("-Dsun.stdout.encoding=UTF-8");
        cmd.add("-Dsun.stderr.encoding=UTF-8");
        cmd.add("-Xmx" + maxHeap);
        cmd.add("-cp");
        cmd.add(out.toString());
        cmd.add(req.getMainClass());
        if (req.getArgs() != null) {
            cmd.addAll(req.getArgs());
        }

        long start = System.nanoTime();
        try {
            Process p = new ProcessBuilder(cmd).directory(dir.toFile()).start();
            String[] outErr = capture(p, timeout);
            boolean finished = p.waitFor(timeout, TimeUnit.MILLISECONDS);
            boolean timedOut = !finished;
            if (!finished) {
                p.destroyForcibly();
            }
            Integer exit = finished ? p.exitValue() : null;
            return CaseRunResult.run(jdk.version(), orEmpty(outErr[0]), orEmpty(outErr[1]),
                    exit, timedOut, nanos(start));
        } catch (IOException e) {
            throw new CaseException("CASE_RUN", "启动 java 失败：" + e.getMessage(), 503);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new CaseException("CASE_RUN", "运行被中断", 500);
        }
    }

    // ── 输出捕获（带体量上限，但持续排空管道避免子进程阻塞） ──
    private String[] capture(Process p, long timeoutMs) {
        StringBuilder stdout = new StringBuilder();
        StringBuilder stderr = new StringBuilder();
        Thread tOut = drain(p.getInputStream(), stdout);
        Thread tErr = drain(p.getErrorStream(), stderr);
        tOut.start();
        tErr.start();
        long join = timeoutMs + 5000L;
        try {
            tOut.join(join);
            tErr.join(join);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        return new String[]{ cap(stdout), cap(stderr) };
    }

    private Thread drain(InputStream in, StringBuilder sink) {
        return new Thread(() -> {
            try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
                long total = 0;
                String line;
                while ((line = r.readLine()) != null) {
                    if (total <= maxOutputBytes) {
                        sink.append(line).append('\n');
                    }
                    // 限额的单位是字节（max-output-bytes），按 UTF-8 实际字节数计，不按字符
                    total += line.getBytes(StandardCharsets.UTF_8).length + 1;
                }
            } catch (IOException ignored) {
                // 流被关闭属正常
            }
        });
    }

    private String cap(StringBuilder sb) {
        if (sb.length() <= 0) {
            return "";
        }
        // 用注入的 maxOutputBytes，别再写死一份副本 —— 配置改了这里不同步就是暗伤
        if (sb.length() > maxOutputBytes) {
            return sb.substring(0, (int) maxOutputBytes) + "\n...[输出已截断]";
        }
        return sb.toString();
    }

    private static String orEmpty(String s) {
        return s == null ? "" : s;
    }

    private static long nanos(long startNanos) {
        return Duration.ofNanos(System.nanoTime() - startNanos).toMillis();
    }

    private void deleteDir(Path dir) {
        try {
            if (Files.exists(dir)) {
                try (var walk = Files.walk(dir)) {
                    walk.sorted((a, b) -> b.getNameCount() - a.getNameCount())
                         .forEach(p -> {
                             try {
                                 Files.deleteIfExists(p);
                             } catch (IOException ignored) {
                                 // 子进程残留文件删不掉就留着，下次启动会再建新目录
                             }
                         });
                }
            }
        } catch (IOException | RuntimeException e) {
            log.warn("清理临时目录失败（可忽略）：{}", dir);
        }
    }
}
