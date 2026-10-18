package com.arsenal.scan;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 扫描闸门。**这一层是「读别人的代码」这件事唯一的安全边界。**
 *
 * 假设输入是恶意的：zip 里可能有 {@code ../../etc/passwd} 这样的条目名，
 * 目录里可能有指向仓库外的软链接，git 地址可能是 {@code file://} 指向本机任意路径。
 * 所以每条路径都要先 {@code toRealPath()} 再校验落在根目录内 ——
 * 只做字符串判断是挡不住的（{@code a/../..} 归一化后照样出圈）。
 *
 * 四条不变量：
 *   ① 不执行被扫描仓库里的任何东西（这里只有一个副作用：读）
 *   ② 不写被扫描的仓库（临时目录在仓库外，finally 清理）
 *   ③ 凭据值一律脱敏（{@link #isSensitive}）
 *   ④ 规模与时间有硬上限，超了就停，不许「再扫一会儿」
 */
public final class ScanGuard {

    /** 单文件 2MB。超过这个大小的基本不是源码（日志、大 SQL、二进制） */
    public static final long MAX_FILE_BYTES = 2L * 1024 * 1024;
    /** 总解包 500MB */
    public static final long MAX_TOTAL_BYTES = 500L * 1024 * 1024;
    /** 文件数 2 万 */
    public static final int MAX_FILES = 20_000;
    /** 目录深度 20 */
    public static final int MAX_DEPTH = 20;
    /** 总扫描 180 秒 */
    public static final long TIMEOUT_MS = 180_000L;

    /** 这些目录既大又不包含架构事实，扫它们只会拖慢并放大攻击面 */
    private static final Set<String> SKIP_DIRS = Set.of(
            ".git", "node_modules", "target", "build", "dist", "out", ".next", ".next-dev", ".nuxt",
            ".idea", ".vscode", ".gradle", ".mvn", "bin", "obj", "vendor", "__pycache__",
            ".svn", ".hg", "coverage", ".turbo", ".cache");

    /** 只看这些扩展名的文件（其余只计数，不读内容） */
    private static final Set<String> TEXT_EXT = Set.of(
            "java", "kt", "xml", "yml", "yaml", "properties", "gradle", "json", "toml",
            "dockerfile", "conf", "sh", "md", "ts", "tsx", "js", "jsx", "go", "py", "rb",
            "sql", "env", "ini", "cfg", "tf", "proto");

    private static final Pattern SENSITIVE = Pattern.compile(
            "(?i)(pass(word|wd)?|secret|token|api[-_]?key|access[-_]?key|private[-_]?key|credential|auth)");

    private ScanGuard() {
    }

    public static boolean skipDir(String name) {
        return SKIP_DIRS.contains(name.toLowerCase(Locale.ROOT));
    }

    /** 这个文件我们要不要读内容。扩展名不在白名单里的一律不读（可能是二进制） */
    public static boolean readable(String fileName) {
        String n = fileName.toLowerCase(Locale.ROOT);
        if (n.equals("dockerfile") || n.startsWith("dockerfile.")) return true;
        if (n.equals("jenkinsfile") || n.equals("makefile")) return true;
        int dot = n.lastIndexOf('.');
        if (dot < 0) return false;
        return TEXT_EXT.contains(n.substring(dot + 1));
    }

    /**
     * 路径是否安全：真实路径必须落在 root 的真实路径之内。
     *
     * 先 toRealPath 是关键 —— 软链接 {@code link -> /etc} 的字符串形式完全正常，
     * 只有解析之后才看得出它指向仓库外。解析失败（断链）也按不安全处理。
     */
    public static boolean isInside(Path root, Path candidate) {
        try {
            Path realRoot = root.toRealPath();
            Path real = candidate.toRealPath();
            return real.startsWith(realRoot);
        } catch (Exception e) {
            return false;
        }
    }

    /** 目录深度（相对根的分段数）。限制它是因为深目录是 zip 炸弹的常见形状 */
    public static int depth(Path root, Path p) {
        Path rel = root.relativize(p);
        int d = 0;
        for (Path ignored : rel) {
            d += 1;
        }
        return d;
    }

    /**
     * zip 条目名是否安全。
     *
     * 三件事一起查：{@code ..} 分段、绝对路径（含 Windows 盘符与 UNC）、反斜杠
     * （Windows 上 {@code ..\..\x} 同样出圈，只查 {@code /} 会漏）。
     */
    public static boolean zipEntrySafe(String rawName) {
        if (rawName == null || rawName.isEmpty()) return false;
        String n = rawName.replace('\\', '/');
        if (n.startsWith("/") || n.startsWith("//")) return false;
        if (n.contains("\u0000")) return false;
        if (n.matches("^[A-Za-z]:.*")) return false;
        for (String seg : n.split("/")) {
            if (seg.isEmpty()) continue;
            if (seg.equals("..") || seg.equals(".")) return false;
        }
        return true;
    }

    /** git 地址是否允许。只许 https —— 其余协议都能触达本机或要求交互输入凭据 */
    public static boolean gitUrlAllowed(String url) {
        if (url == null) return false;
        String u = url.trim().toLowerCase(Locale.ROOT);
        return u.startsWith("https://");
    }

    /**
     * 键名是否敏感。命中则值一律替换成 {@code ***} ——
     * 扫描结果是要贴进文档、可能发给别人的，配置里的真密码一旦进去就收不回来。
     */
    public static boolean isSensitive(String key) {
        return key != null && SENSITIVE.matcher(key).find();
    }

    public static String redact(String key, String value) {
        return isSensitive(key) ? "***" : value;
    }

    public static boolean fileTooLarge(Path p) {
        try {
            return Files.size(p) > MAX_FILE_BYTES;
        } catch (Exception e) {
            return true;
        }
    }
}
