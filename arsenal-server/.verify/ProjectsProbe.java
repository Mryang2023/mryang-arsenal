import com.arsenal.projects.ProjectCache;
import com.arsenal.projects.ProjectIngestException;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

/**
 * 项目工坊摄取安全探针（2026-10-18 事故的回归防线）。
 *
 * 与 ScanProbe 同一套路：产品代码只编 src/main/java，本文件额外编进去（校验工具不进产品目录）。
 * 每个动作回一张收据 {action, ok, ...}，输入被拒也算跑完（ok=false + code），由断言层判。
 *
 * <p><b>⚠️ 探针自己删文件的规矩（2026-10-18 用一次险肇事故换来的）</b>：
 * 本探针的夹具准备会 rmrf 工作目录。第一版没校验参数，而调用方一次转义失误
 * （to_win 未定义 → 参数空串）就让 {@code Paths.get("")} 落到了进程 cwd ——
 * 也就是 arsenal-server 根 —— rmrf 把 src/main/java 整棵树删了（靠 git 才恢复）。
 * 所以现在：① 参数为空 / 不是绝对路径 → 直接拒绝，不碰文件系统；
 * ② rmrf 有安全网：服务器根（cwd）、它的任何祖先、它自己下面的 src 与 target，
 * 一律不删。调用方（断言层）传的工作目录必须自己建好并位于服务器目录树之外。
 *
 * 动作:
 *   gate:<work>     摄取闸门：.data / node_modules / .git 必须被剪枝（SKIP_SUBTREE，不是 continue）
 *   overlap:<work>  源与缓存落点重叠 → IllegalArgumentException 且不留空目录
 *   quota:<work>    单文件超限 → ProjectIngestException 且整份回滚
 *   delete-deep:<work>  深树（>260）删除：本机内核拦长路径删除，靠「搬了再删」第二遍
 *   delete-cache:<root>:<id>  通用：删某个项目缓存目录（真实毒树清理也走它）
 */
public class ProjectsProbe {

    /** 进程 cwd（探针脚本 cd 到 SERVER_ROOT 后才启动 java）—— 安全网的参照点。 */
    static final Path SERVER_ROOT = Paths.get("").toAbsolutePath().normalize();

    static final ObjectMapper MAPPER = new ObjectMapper();

    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.err.println("用法: ProjectsProbe <out.json> <动作> [动作...]");
            System.exit(2);
        }
        Path out = Paths.get(args[0]);
        ArrayNode receipts = MAPPER.createArrayNode();
        for (int i = 1; i < args.length; i++) {
            String action = args[i];
            ObjectNode r = receipts.addObject();
            r.put("action", action);
            try {
                String verb = action.substring(0, action.indexOf(':'));
                String param = action.substring(action.indexOf(':') + 1);
                switch (verb) {
                    case "gate" -> gate(r, workDir(param));
                    case "overlap" -> overlap(r, workDir(param));
                    case "quota" -> quota(r, workDir(param));
                    case "delete-deep" -> deleteDeep(r, workDir(param));
                    case "delete-cache" -> deleteCache(r, param);
                    default -> r.put("ok", false).put("code", "UNKNOWN_ACTION").put("message", "不认识的动词: " + verb);
                }
            } catch (Throwable t) {
                r.put("ok", false).put("code", "PROBE_ERROR").put("message", String.valueOf(t));
            }
        }
        Files.createDirectories(out.getParent());
        MAPPER.writerWithDefaultPrettyPrinter().writeValue(out.toFile(), receipts);
    }

    /**
     * 工作目录参数校验。空串 / 相对路径 / 落在服务器目录树里（含它的祖先）→ 一律拒绝。
     * 宁可不跑，不许删错地方 —— 探针是校验工具，它的第一职责是不造成破坏。
     */
    static Path workDir(String param) {
        if (param == null || param.isBlank()) {
            throw new IllegalArgumentException("动作参数为空（疑似调用方转义失误）—— 拒绝动作");
        }
        Path p = Paths.get(param).toAbsolutePath().normalize();
        if (!p.isAbsolute() || p.toString().isBlank()) {
            throw new IllegalArgumentException("工作目录不是绝对路径: " + param);
        }
        if (p.equals(SERVER_ROOT) || SERVER_ROOT.startsWith(p) || p.startsWith(SERVER_ROOT)) {
            throw new IllegalArgumentException("拒绝在服务器目录树内动手（含祖先）: " + p);
        }
        return p;
    }

    // ── gate：跳过目录必须剪枝 ────────────────────────────────

    static void gate(ObjectNode r, Path work) throws Exception {
        Path src = work.resolve("src");
        rmrf(src);
        Files.createDirectories(src.resolve("pkg"));
        Files.writeString(src.resolve("Top.java"), "class Top {}\n", StandardCharsets.UTF_8);
        Files.writeString(src.resolve("pkg").resolve("Deep.java"), "class Deep {}\n", StandardCharsets.UTF_8);
        // 三类「既大又无架构事实」的目录，每类放一个可识别的文件
        Files.createDirectories(src.resolve(".data").resolve("projects").resolve("abc"));
        Files.writeString(src.resolve(".data").resolve("projects").resolve("abc").resolve("report.json"), "{}\n", StandardCharsets.UTF_8);
        Files.createDirectories(src.resolve("node_modules").resolve("lib"));
        Files.writeString(src.resolve("node_modules").resolve("lib").resolve("Thing.java"), "class Thing {}\n", StandardCharsets.UTF_8);
        Files.createDirectories(src.resolve(".git"));
        Files.writeString(src.resolve(".git").resolve("config"), "[core]\n", StandardCharsets.UTF_8);

        Path cacheRoot = work.resolve("cache");
        rmrf(cacheRoot);
        ProjectCache cache = new ProjectCache(cacheRoot, MAPPER);
        ObjectNode stat = cache.ingestPath("probe-gate", src);

        // manifest 里必须只有两个真源码文件；三类跳过目录一个都不许在
        ObjectNode manifest = (ObjectNode) MAPPER.readTree(cacheDirOf(cacheRoot, "probe-gate").resolve("manifest.json").toFile());
        List<String> rels = new ArrayList<>();
        for (var n : manifest.withArray("files")) rels.add(n.path("rel").asText());
        r.put("ok", true);
        r.put("files", stat.path("files").asInt());
        r.set("rels", MAPPER.valueToTree(rels));
        r.put("hasData", rels.stream().anyMatch(x -> x.startsWith(".data/")));
        r.put("hasNodeModules", rels.stream().anyMatch(x -> x.startsWith("node_modules/")));
        r.put("hasGit", rels.stream().anyMatch(x -> x.startsWith(".git/")));
        // 夹具侧事实：三类跳过目录里的可识别文件**真的建成了**才记 true。
        // 断言层要连它一起判 —— 只有「夹具有 + manifest 没有」才证明剪枝真的发生了，
        // 否则「manifest 里没有 .data」可能只是因为夹具里从来没有（判据白跑）。
        r.put("fixtureHadData", Files.isRegularFile(src.resolve(".data").resolve("projects").resolve("abc").resolve("report.json")));
        r.put("fixtureHadNodeModules", Files.isRegularFile(src.resolve("node_modules").resolve("lib").resolve("Thing.java")));
        r.put("fixtureHadGit", Files.isRegularFile(src.resolve(".git").resolve("config")));
    }

    // ── overlap：源与缓存落点重叠必须前置拒绝 ─────────────────

    static void overlap(ObjectNode r, Path work) throws Exception {
        Path src = work.resolve("src");
        rmrf(src);
        Files.createDirectories(src);
        Files.writeString(src.resolve("A.java"), "class A {}\n", StandardCharsets.UTF_8);
        // 缓存根故意放在源里面（复现事故的几何：仓库根当源 + 缓存默认在 .data 下）
        Path cacheRoot = src.resolve(".data").resolve("projects");
        Files.createDirectories(cacheRoot);

        ProjectCache cache = new ProjectCache(cacheRoot, MAPPER);
        Path target = cacheRoot.resolve("probe-overlap");
        boolean targetBefore = Files.isDirectory(target);
        String message = null;
        try {
            cache.ingestPath("probe-overlap", src);
            message = "(没抛异常 —— 前置校验失效)";
        } catch (IllegalArgumentException e) {
            message = e.getMessage();
        } catch (Throwable t) {
            message = "抛了别的类型: " + t.getClass().getName() + " " + t.getMessage();
        }
        r.put("ok", message != null && message.contains("重叠") && !targetBefore && !Files.isDirectory(target));
        r.put("message", message == null ? "" : message);
        r.put("targetLeft", Files.isDirectory(target));
    }

    // ── quota：超限整份回滚，不留半份 ────────────────────────

    static void quota(ObjectNode r, Path work) throws Exception {
        Path src = work.resolve("src");
        rmrf(src);
        Files.createDirectories(src);
        Files.writeString(src.resolve("Small.java"), "class Small {}\n", StandardCharsets.UTF_8);
        // 3MB > 单文件 2MB 上限。必须是**源码**（.java 在 TEXT_EXT 白名单里）：
        // 335519c 起「超限二进制资源」走跳过并记账，不再抛 —— 拿 .bin 测会永远绿不了
        // 本断言（二进制被静默跳过 = 摄取成功 = target 留下）。本动作测的正是
        // 「源码超限仍整份拒绝」这条不变量：生成物混进源码目录必须炸出来。
        byte[] big = new byte[3 * 1024 * 1024];
        Files.write(src.resolve("Big.java"), big);

        Path cacheRoot = work.resolve("cache");
        rmrf(cacheRoot);
        ProjectCache cache = new ProjectCache(cacheRoot, MAPPER);
        Path target = cacheRoot.resolve("probe-quota");
        String message = null;
        try {
            cache.ingestPath("probe-quota", src);
            message = "(没抛异常 —— 限额失效)";
        } catch (ProjectIngestException e) {
            message = e.getMessage();
        } catch (Throwable t) {
            message = "抛了别的类型: " + t.getClass().getName() + " " + t.getMessage();
        }
        r.put("ok", message != null && message.contains("单文件超过上限") && !Files.isDirectory(target));
        r.put("message", message == null ? "" : message);
        r.put("targetLeft", Files.isDirectory(target));
    }

    // ── delete-deep：>260 的树必须真删掉 ─────────────────────

    static void deleteDeep(ObjectNode r, Path work) throws Exception {
        Path cacheRoot = work.resolve("cache");
        rmrf(cacheRoot);
        Files.createDirectories(cacheRoot);
        // 25 层、每层 16 字符 →  deepest path > 400 字符； bottom 放一个真文件
        Path cur = cacheRoot.resolve("deepproj").resolve("repo");
        for (int i = 0; i < 25; i++) cur = cur.resolve("layer" + i + "0123456789ab");
        Files.createDirectories(cur);
        Path leaf = cur.resolve("leaf.txt");
        Files.writeString(leaf, "deep\n", StandardCharsets.UTF_8);
        int maxLen = leaf.toAbsolutePath().normalize().toString().length();
        boolean before = Files.isDirectory(cacheRoot.resolve("deepproj"));

        new ProjectCache(cacheRoot, MAPPER).deleteCache("deepproj");

        boolean after = Files.isDirectory(cacheRoot.resolve("deepproj"));
        r.put("ok", before && !after);
        r.put("maxPathLen", maxLen);
        r.put("before", before);
        r.put("after", after);
    }

    // ── delete-cache：删任意项目缓存目录（真实清理入口）─────

    static void deleteCache(ObjectNode r, String param) throws Exception {
        // 必须在最后一个冒号处切：Windows 盘符（D:）自己就带一个冒号，
        // 在第一个冒号切会把 root 切成 "D"、id 吞掉整条路径（2026-10-18 实测踩过，
        // 靠下面的 UNSAFE_ROOT 安全网才没误删）。id 是十六进制哈希，不会含冒号。
        int sep = param.lastIndexOf(':');
        if (sep < 0) {
            r.put("ok", false).put("code", "BAD_PARAM").put("message", "应为 <root>:<id>");
            return;
        }
        Path cacheRoot = Paths.get(param.substring(0, sep)).toAbsolutePath().normalize();
        String id = param.substring(sep + 1);
        // 与 workDir 同一道安全网：缓存根不许落在服务器目录树内或其祖先
        if (cacheRoot.equals(SERVER_ROOT) || SERVER_ROOT.startsWith(cacheRoot) || cacheRoot.startsWith(SERVER_ROOT)) {
            r.put("ok", false).put("code", "UNSAFE_ROOT").put("message", "拒绝删除服务器目录树内或其祖先下的缓存: " + cacheRoot);
            return;
        }
        Path dir = cacheRoot.resolve(id);
        boolean before = Files.isDirectory(dir);
        new ProjectCache(cacheRoot, MAPPER).deleteCache(id);
        boolean after = Files.isDirectory(dir);
        r.put("ok", !after);
        r.put("before", before);
        r.put("after", after);
        r.put("id", id);
    }

    // ── 小工具 ──────────────────────────────────────────────

    static Path cacheDirOf(Path cacheRoot, String id) {
        return cacheRoot.resolve(id);
    }

    static void rmrf(Path dir) throws Exception {
        if (dir == null) return;
        // 安全网（workDir 已经拦过一道，这里是第二道，永远不拆）：
        // 服务器根、它的任何祖先、它下面的任何路径，一律不删。
        Path abs = dir.toAbsolutePath().normalize();
        if (abs.equals(SERVER_ROOT) || SERVER_ROOT.startsWith(abs) || abs.startsWith(SERVER_ROOT)) {
            throw new IllegalStateException("rmrf 安全网：拒绝删除服务器目录树内或其祖先: " + abs);
        }
        if (!Files.isDirectory(dir)) return;
        List<Path> all = new ArrayList<>();
        collect(dir, all);
        for (int i = all.size() - 1; i >= 0; i--) {
            try { Files.deleteIfExists(all.get(i)); } catch (Exception ignored) { }
        }
    }

    static void collect(Path dir, List<Path> into) throws Exception {
        into.add(dir);
        try (var ds = Files.newDirectoryStream(dir)) {
            for (Path c : ds) {
                if (Files.isDirectory(c) && !Files.isSymbolicLink(c)) collect(c, into);
                else into.add(c);
            }
        }
    }
}
