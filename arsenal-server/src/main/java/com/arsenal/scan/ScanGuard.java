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
            ".svn", ".hg", "coverage", ".turbo", ".cache",
            // 夜班 N5（2026-10-30）：.wb-tmp 是 workbuddy 工具链的临时产物目录，
            // 对真实项目（command-center-backend）实测贡献了 22 条假 finding —— 它进 SKIP_DIRS
            // 与进 SKIP_DIRS 的其他目录同一条理由：既不是架构事实，也不是业务源码。
            ".wb-tmp");

    /** 只看这些扩展名的文件（其余只计数，不读内容） */
    private static final Set<String> TEXT_EXT = Set.of(
            "java", "kt", "xml", "yml", "yaml", "properties", "gradle", "json", "toml",
            "dockerfile", "conf", "sh", "md", "ts", "tsx", "js", "jsx", "go", "py", "rb",
            "sql", "env", "ini", "cfg", "tf", "proto");

    private static final Pattern SENSITIVE = Pattern.compile(
            "(?i)(pass(word|wd)?|secret|token|api[-_]?key|access[-_]?key|private[-_]?key|credential|auth)");

    private ScanGuard() {
    }

    /**
     * 文件级内置忽略（夜班 N5）。收的是「位置就说明它是噪音」的三类：
     * <ul>
     *   <li>仓库根的 {@code Smoke*.java} —— 手工冒烟脚本；真实项目里它贡献了 6 条假 finding。
     *       只拦根目录：src 下真叫 Smoke 开头的可能是受测类，不能误伤。</li>
     *   <li>{@code *.min.js} / {@code *.min.css} —— 压缩产物，读它只是浪费字节预算。</li>
     * </ul>
     * 面向「相对路径（/ 分隔）」判断，与 {@code AutopsyService.collect} 的 rel 口径一致。
     * 项目级追加规则走 {@code arsenal.lint.ignore-globs}（glob），不在这里。
     */
    public static boolean ignoreFile(String relPath) {
        if (relPath == null || relPath.isEmpty()) {
            return false;
        }
        int slash = relPath.lastIndexOf('/');
        String base = slash < 0 ? relPath : relPath.substring(slash + 1);
        boolean atRoot = slash < 0;
        String lower = base.toLowerCase(Locale.ROOT);
        if (atRoot && lower.startsWith("smoke") && lower.endsWith(".java")) {
            return true;
        }
        return lower.endsWith(".min.js") || lower.endsWith(".min.css");
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
     * 超限文件能否跳过，而不是整份拒绝。
     *
     * <p>2MB 这条线的本意是挡「不是源码的大文件」。对源码来说，超限通常意味着生成物
     * 混进来了，应当拒绝并让人看见；对二进制资源（.xdb / .jar / .png / 字体）来说，
     * 它本来就不参与任何静态分析 —— 为一个 10MB 的 ip2region 库把整个项目拒之门外，
     * 换来的只是一个「加不进来」的结论，没有信息量。
     *
     * <p>判定复用 {@link #readable}：不读内容的文件 = 可以跳过。跳过的事实会记进
     * manifest 与 cache 统计（{@code skippedFiles}），不是静默消失。
     */
    public static boolean skippableOversize(String fileName) {
        return !readable(fileName);
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
        return isSensitive(key) ? "***" : redactValue(value);
    }

    /** PEM 私钥块。键名不敏感也要挡 —— 私钥体不配出现在扫描输出里（藏在任何键的值里都一样）。 */
    private static final Pattern PEM_BLOCK = Pattern.compile(
            "-----BEGIN [A-Z ]*PRIVATE KEY-----[\\s\\S]*?-----END [A-Z ]*PRIVATE KEY-----");

    /** 值级脱敏：与键名无关，抹掉内嵌的 PEM 私钥块（多行值、JDBC URL 内嵌凭据之外的最后兜底）。 */
    public static String redactValue(String value) {
        if (value == null) return null;
        return PEM_BLOCK.matcher(value).replaceAll("***PEM-PRIVATE-KEY***");
    }

    public static boolean fileTooLarge(Path p) {
        try {
            return Files.size(p) > MAX_FILE_BYTES;
        } catch (Exception e) {
            return true;
        }
    }
}
