package com.arsenal.cases;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 定位用来「跑案例」的 JDK。
 *
 * <p>为什么单独一个类：后端主服务跑在 JDK 17 上（Spring Boot 3.2.5 的最低要求），
 * 但虚拟线程等案例需要 JDK 21+ 的运行时。两者不能混：把主服务升到 21 会影响整套规则/校验链路。
 * 所以这里独立解析一个 JDK 21+，案例代码以子进程方式在它上面编译运行，主服务不受牵连。
 *
 * <p>解析优先级：
 * 1. 显式配置（arsenal.cases.jdk-home / 环境变量 ARSENAL_CASE_JDK）
 * 2. 扫描 ~/.jdks 与常见安装目录，挑版本号最高且 ≥21 的那个
 *
 * <p>对齐 scripts/_cp.sh 的思路：不把 JDK 路径写死，按候选列表依次找，找不到时把「试过哪些」报出来。
 */
public class JdkResolver {

    private static final Logger log = LoggerFactory.getLogger(JdkResolver.class);
    private static final Pattern VERSION_MAJOR = Pattern.compile("\"(\\d+)\\.");

    private final Path javaHome;
    private final String javaCmd;
    private final String javacCmd;
    private final String version;

    public JdkResolver(String configuredHome) {
        this.javaHome = resolve(configuredHome);
        String os = System.getProperty("os.name", "").toLowerCase();
        String bin = os.contains("win") ? "bin/java.exe" : "bin/java";
        String jbin = os.contains("win") ? "bin/javac.exe" : "bin/javac";
        this.javaCmd = javaHome.resolve(bin).toString();
        this.javacCmd = javaHome.resolve(jbin).toString();
        this.version = probeVersion(javaCmd);
        log.info("案例执行 JDK = {} （{}）", javaHome, version);
    }

    public Path javaHome() {
        return javaHome;
    }

    public String javaCmd() {
        return javaCmd;
    }

    public String javacCmd() {
        return javacCmd;
    }

    public String version() {
        return version;
    }

    private static Path resolve(String configured) {
        if (configured != null && !configured.isBlank()) {
            Path p = Path.of(configured);
            if (valid(p)) {
                return p;
            }
            throw new CaseException("CASE_JDK_NOT_FOUND",
                    "配置的案例 JDK 不存在或缺少 javac：" + configured, 503);
        }

        List<Path> roots = new ArrayList<>();
        String home = System.getProperty("user.home");
        if (home != null) {
            roots.add(Path.of(home, ".jdks"));
        }
        roots.add(Path.of("C:/Program Files/Java"));
        roots.add(Path.of("C:/Program Files/Microsoft"));
        roots.add(Path.of("C:/Program Files/Amazon Corretto"));
        roots.add(Path.of("C:/Program Files/Eclipse Adoptium"));
        roots.add(Path.of("C:/Program Files/Zulu"));

        Path best = null;
        int bestMajor = 0;
        List<String> tried = new ArrayList<>();
        for (Path root : roots) {
            if (!Files.isDirectory(root)) {
                continue;
            }
            try {
                List<Path> kids = Files.list(root).toList();
                for (Path c : kids) {
                    String name = c.getFileName().toString().toLowerCase();
                    if (!hasModernTag(name)) {
                        continue;
                    }
                    tried.add(c.toString());
                    if (!valid(c)) {
                        continue;
                    }
                    int major = majorOf(c);
                    if (major >= 21 && major > bestMajor) {
                        bestMajor = major;
                        best = c;
                    }
                }
            } catch (Exception ignore) {
                // 某个目录读不了就跳过，不阻断其它候选
            }
        }

        if (best == null) {
            String scanned = String.join(", ", tried);
            throw new CaseException("CASE_JDK_NOT_FOUND",
                    "未找到 JDK 21+（虚拟线程等案例需要）。已扫描：" + (scanned.isEmpty() ? "（无匹配目录）" : scanned)
                            + "。请设置 arsenal.cases.jdk-home 指向 JDK 21+ 安装目录。", 503);
        }
        return best;
    }

    private static boolean hasModernTag(String name) {
        return name.contains("21") || name.contains("22") || name.contains("23")
                || name.contains("24") || name.contains("25");
    }

    private static boolean valid(Path p) {
        if (p == null) {
            return false;
        }
        String os = System.getProperty("os.name", "").toLowerCase();
        Path javac = p.resolve("bin").resolve(os.contains("win") ? "javac.exe" : "javac");
        return Files.isRegularFile(javac);
    }

    private static int majorOf(Path home) {
        String os = System.getProperty("os.name", "").toLowerCase();
        Path java = home.resolve("bin").resolve(os.contains("win") ? "java.exe" : "java");
        try {
            Process p = new ProcessBuilder(java.toString(), "-version").start();
            String out = new String(p.getErrorStream().readAllBytes(), StandardCharsets.UTF_8);
            Matcher m = VERSION_MAJOR.matcher(out);
            if (m.find()) {
                return Integer.parseInt(m.group(1));
            }
        } catch (Exception ignore) {
            // 读不到版本就当 0，外层用 >=21 过滤
        }
        return 0;
    }

    private static String probeVersion(String javaCmd) {
        try {
            Process p = new ProcessBuilder(javaCmd, "-version").start();
            String out = new String(p.getErrorStream().readAllBytes(), StandardCharsets.UTF_8).trim();
            return out.replace("\r\n", " ").replace("\n", " ");
        } catch (Exception e) {
            return "unknown";
        }
    }
}
