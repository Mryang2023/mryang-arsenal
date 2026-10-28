package com.arsenal.projects;

import com.arsenal.scan.ScanGuard;
import com.arsenal.scan.SourceResolver;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.TimeUnit;

/**
 * 代码缓存：把项目源码摄取进服务器侧目录，之后一切扫描/体检/深检都读这里（不再每请求现 clone）。
 *
 * <p>布局（全部不进 git，见 {@code .gitignore} 的递归忽略项 {@code .data/projects/}）：
 * <pre>{@code
 *   <root>/<projectId>/
 *     repo/          代码缓存（摄取那一刻的稳定快照，只读；活体采集另复制临时副本）
 *     manifest.json  path 项目专用：relpath -> {size, mtimeMs}（刷新/新鲜度比对）
 * }</pre>
 *
 * <p>限额与 {@link ScanGuard} 同源（不抄数字）：单文件 2MB / 总 500MB / 2 万文件 / 深度 20。
 * 超限<b>整份拒绝</b>并回滚已复制的部分 —— 绝不留下半份缓存（验收③）。
 * 唯一例外：超过 2MB 的<b>非源码</b>文件（.xdb / .jar / 字体）不进缓存但仍记入 manifest，
 * 并在 cache 统计里计 {@code skippedFiles}；源码超限照旧整份拒绝。
 *
 * <p><b>2026-10-18 事故止血（三条，都在这一个类里）</b>：
 * <ol>
 *   <li><b>递归复制</b>：摄取落点 {@code <root>/<id>/repo} 若落在源目录之内（用户把仓库根
 *       当源添加，而缓存根默认就在仓库的 {@code .data/} 下），遍历会一头扎进自己正在写的
 *       产物，拷进去的又被遍历到，无限套娃。现在 {@link #requireDisjoint} 前置校验，
 *       重叠直接拒；{@link #cacheSkipDir} 再兜一层 —— 即便缓存根挪到了别处，
 *       源里的 {@code .data} 也不进缓存。</li>
 *   <li><b>毒树不回滚</b>：深路径下 {@code Files.copy} 抛 IOException 后走的是通用
 *       {@code Exception} 分支，不进回滚逻辑，半份缓存留在盘上；而回滚用的
 *       {@code Files.walk} 删除在 Windows 260 字符上限下同样删不动深树。
 *       现在<b>一切异常都回滚</b>，删除走长路径 + 「搬了再删」第二遍（{@link #deleteQuietly}）。</li>
 *   <li><b>跳过目录不剪枝</b>：老写法 {@code Files.walk + continue} 只跳过目录本身那一条
 *       记录，<b>不阻止遍历 descend 进去</b> —— {@code node_modules} / {@code .git} 里的
 *       文件照样进 manifest、进配额。现在一律 {@code walkFileTree + SKIP_SUBTREE}
 *       （与 {@code ProjectScanner} 同一写法，不发明第二种）。</li>
 * </ol>
 */
public final class ProjectCache {

    private final Path root;
    private final ObjectMapper mapper;

    public ProjectCache(Path root, ObjectMapper mapper) {
        this.root = root;
        this.mapper = mapper;
    }

    public Path root() {
        return root;
    }

    /** 某项目的缓存目录（repo/ 的父）。id 参与拼路径，先消毒 —— 剥离后不存在 / \ . 字符，遍历不成立。 */
    public Path cacheDir(String projectId) {
        return root.resolve(safeSegment(projectId));
    }

    /** 拼路径的 id 一律先过这里（与 ProjectStore.safeId / QaService.safeSegment 同一口径）。 */
    private static String safeSegment(String s) {
        return s == null ? "" : s.replaceAll("[^A-Za-z0-9_-]", "");
    }

    /** 缓存根（repo/）。不存在返回 null（调用方据此返回 404）。 */
    public Path resolve(String projectId) {
        Path repo = cacheDir(projectId).resolve("repo");
        return Files.isDirectory(repo) ? repo : null;
    }

    // ─────────────────────────────────────────────────────────────
    // 摄取：本地目录（整树复制 + 限额 + manifest）
    // ─────────────────────────────────────────────────────────────

    public ObjectNode ingestPath(String projectId, Path source) throws IOException {
        Path target = prepareTarget(projectId);

        final long[] total = {0};
        final int[] count = {0};
        // 跳过的超限二进制资源数。**必须单独计数**：它不在 repo/ 里，
        // 但真实存在，报告里要能说清「缓存少了什么、为什么少」。
        final int[] skippedCount = {0};
        final List<ObjectNode> manifest = new ArrayList<>();
        try {
            // 前置校验放在 try 里：失败了连空目录也不留（prepareTarget 已经删过旧缓存，
            // 这时候留个空 target 等于「添加失败但旧缓存被清了」）。
            // 两个方向都查 —— 前者是递归复制，后者是把自己拷进自己。
            requireDisjoint(source, target);
            Path repo = target.resolve("repo");
            Files.createDirectories(repo);

            walkSource(source, new SimpleFileVisitor<>() {
                @Override
                public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
                    if (guardDir(dir, source) == FileVisitResult.SKIP_SUBTREE) {
                        return FileVisitResult.SKIP_SUBTREE;
                    }
                    try {
                        // 镜像空目录（manifest 只记文件，但目录结构要保真）
                        Files.createDirectories(repo.resolve(source.relativize(dir).toString()));
                    } catch (IOException e) {
                        throw new ProjectIngestException("创建目录失败：" + e.getMessage());
                    }
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                    Path rel = source.relativize(file);
                    if (++count[0] > ScanGuard.MAX_FILES) {
                        throw new ProjectIngestException("文件数超过上限 " + ScanGuard.MAX_FILES
                                + "（第 " + count[0] + "个：" + rel + "）");
                    }
                    long size = attrs.size();
                    boolean skipped = false;
                    if (size > ScanGuard.MAX_FILE_BYTES) {
                        // 源码超限照旧拒绝：那通常意味着生成物混进了源码目录，
                        // 静默跳过一个 .java 会让后续扫描得出错误结论。
                        // 二进制资源（.xdb / .jar / 字体）跳过并记账 —— 它不参与分析。
                        String name = file.getFileName() == null ? "" : file.getFileName().toString();
                        if (!ScanGuard.skippableOversize(name)) {
                            throw new ProjectIngestException("单文件超过上限 "
                                    + ScanGuard.MAX_FILE_BYTES / 1024 / 1024 + "MB："
                                    + rel + "（" + size / 1024 / 1024 + "MB）");
                        }
                        skipped = true;
                        skippedCount[0]++;
                    }
                    // 跳过的文件仍计入总配额：否则「跳过」就成了绕过 500MB 总闸门的后门
                    total[0] += size;
                    if (total[0] > ScanGuard.MAX_TOTAL_BYTES) {
                        throw new ProjectIngestException("总大小超过上限 "
                                + ScanGuard.MAX_TOTAL_BYTES / 1024 / 1024 + "MB"
                                + "（已累计 " + total[0] / 1024 / 1024 + "MB，卡在 " + rel + "）");
                    }
                    if (ScanGuard.depth(source, file) > ScanGuard.MAX_DEPTH) {
                        throw new ProjectIngestException("目录深度超过上限 " + ScanGuard.MAX_DEPTH
                                + "（" + rel + "）");
                    }
                    if (!skipped) {
                        Path out = repo.resolve(rel.toString());
                        try {
                            Files.createDirectories(out.getParent());
                            // 深路径两侧都走长路径形式：源或缓存任何一侧超过 260 字符，
                            // 普通形式会在这里抛 IOException（然后被回滚，但用户白白等一场）。
                            Files.copy(longPath(file), longPath(out));
                        } catch (IOException e) {
                            throw new ProjectIngestException("复制失败 " + rel + "：" + e.getMessage());
                        }
                    }
                    ObjectNode m = mapper.createObjectNode();
                    m.put("rel", rel.toString().replace('\\', '/'));
                    m.put("size", size);
                    if (skipped) m.put("skipped", true);
                    try {
                        m.put("mtimeMs", Files.getLastModifiedTime(file).toMillis());
                    } catch (IOException ignored) {
                        m.put("mtimeMs", 0L);
                    }
                    manifest.add(m);
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult visitFileFailed(Path file, IOException exc) {
                    // 读不到的文件（权限 / 断链 / 深路径打不开）一律算摄取失败并回滚，
                    // 不静默跳过 —— 静默跳过的结果是「缓存少了几个文件而没人知道」。
                    throw new ProjectIngestException("读取失败 " + file.getFileName() + "：" + exc.getMessage());
                }
            });

            ObjectNode manifestRoot = mapper.createObjectNode();
            manifestRoot.put("root", source.getFileName() == null ? source.toString() : source.getFileName().toString());
            manifestRoot.put("generatedAt", nowIso());
            ArrayNode files = manifestRoot.putArray("files");
            manifest.forEach(files::add);
            mapper.writerWithDefaultPrettyPrinter().writeValue(target.resolve("manifest.json").toFile(), manifestRoot);
        } catch (Exception e) {
            // 回滚不留半份：配额超限、深路径失败、manifest 写失败，走的都是这一条。
            // （曾经 IOException 不走这里 —— 那是「绝不留下半份缓存」这句注释唯一没兑现的路径。）
            deleteQuietly(target);
            throw e;
        }

        ObjectNode cache = mapper.createObjectNode();
        cache.put("files", count[0]);
        cache.put("bytes", total[0]);
        cache.put("skippedFiles", skippedCount[0]);
        cache.put("ingestedAt", nowIso());
        cache.put("fingerprint", "dir:" + count[0] + ":" + total[0]);
        cache.putNull("lastRefresh");
        cache.putNull("lastDiff");
        return cache;
    }

    // ─────────────────────────────────────────────────────────────
    // 摄取：git（一次性 clone 进缓存，不再每请求现 clone）
    // ─────────────────────────────────────────────────────────────

    public ObjectNode ingestGit(String projectId, String url) throws IOException {
        Path target = prepareTarget(projectId);
        Path repo = target.resolve("repo");
        try {
            SourceResolver.fromGitInto(repo, url);
        } catch (Exception e) {
            deleteQuietly(target);
            throw e;
        }

        String head = readGitHead(repo);
        // 克隆后补一次与 path/zip 摄取同口径的限额：--depth 1 挡不住大仓库（单提交可以
        // 极大），深克隆出 2 万文件/500MB 的结果不该原样落盘。
        long total = 0;
        int count = 0;
        try (var walk = Files.walk(repo)) {
            for (Path p : (Iterable<Path>) walk::iterator) {
                if (Files.isRegularFile(p)) {
                    count++;
                    total += Files.size(p);
                    if (count > ScanGuard.MAX_FILES) {
                        deleteQuietly(target);
                        throw new ProjectIngestException("git 仓库文件数超过上限 " + ScanGuard.MAX_FILES
                                + "，缓存已丢弃（与本地目录摄取同一限额）");
                    }
                    if (total > ScanGuard.MAX_TOTAL_BYTES) {
                        deleteQuietly(target);
                        throw new ProjectIngestException("git 仓库总大小超过上限 "
                                + ScanGuard.MAX_TOTAL_BYTES / 1024 / 1024 + "MB，缓存已丢弃（与本地目录摄取同一限额）");
                    }
                }
            }
        } catch (IOException e) {
            // 计数失败不影响克隆结果 —— 限额只是护栏，数不出来说明这趟不校验
        }
        ObjectNode cache = mapper.createObjectNode();
        cache.put("files", count);
        cache.put("bytes", total);
        cache.put("ingestedAt", nowIso());
        cache.put("fingerprint", head == null ? "git:unknown" : head);
        cache.putNull("lastRefresh");
        cache.putNull("lastDiff");
        return cache;
    }

    // ─────────────────────────────────────────────────────────────
    // 新鲜度 / 刷新（path 项目）
    // ─────────────────────────────────────────────────────────────

    /** 拿源头与 manifest 比：返回 {added,updated,removed,scannedAt}。git 项目返回 {mode:"unscanned"}。 */
    public ObjectNode freshness(String projectId, Path source) throws IOException {
        Path manifestFile = cacheDir(projectId).resolve("manifest.json");
        if (!Files.isRegularFile(manifestFile)) {
            ObjectNode r = mapper.createObjectNode();
            r.put("mode", "unscanned");
            r.put("scannedAt", nowIso());
            return r;
        }
        ObjectNode manifest = (ObjectNode) mapper.readTree(manifestFile.toFile());
        java.util.Map<String, ObjectNode> prev = new java.util.HashMap<>();
        for (var n : manifest.withArray("files")) {
            if (n instanceof ObjectNode o) prev.put(o.path("rel").asText(""), o);
        }
        java.util.Map<String, ObjectNode> cur = new java.util.HashMap<>();
        collectSourceFiles(source, cur);
        List<String> added = new ArrayList<>(), updated = new ArrayList<>(), removed = new ArrayList<>();
        for (var e : cur.entrySet()) {
            ObjectNode old = prev.get(e.getKey());
            if (old == null) added.add(e.getKey());
            else if (old.path("size").asLong(-1) != e.getValue().path("size").asLong(-2)
                    || old.path("mtimeMs").asLong(-1) != e.getValue().path("mtimeMs").asLong(-2)) {
                updated.add(e.getKey());
            }
        }
        for (var k : prev.keySet()) {
            if (!cur.containsKey(k)) removed.add(k);
        }
        ObjectNode r = mapper.createObjectNode();
        r.put("mode", "path");
        r.put("scannedAt", nowIso());
        ArrayNode addedArr = r.putArray("added");
        for (String s : added) addedArr.add(s);
        ArrayNode updatedArr = r.putArray("updated");
        for (String s : updated) updatedArr.add(s);
        ArrayNode removedArr = r.putArray("removed");
        for (String s : removed) removedArr.add(s);
        return r;
    }

    /** 刷新：按 manifest 增量同步（增/改/删）。git 项目用 fetch+reset。返回与 freshness 同形。 */
    public ObjectNode refresh(String projectId, Path source) throws IOException {
        ObjectNode diff = freshness(projectId, source);
        Path repo = cacheDir(projectId).resolve("repo");
        requireDisjoint(source, cacheDir(projectId));
        for (var n : diff.withArray("removed")) {
            Files.deleteIfExists(longPath(repo.resolve(n.asText())));
        }
        java.util.Map<String, ObjectNode> cur = new java.util.HashMap<>();
        collectSourceFiles(source, cur);
        for (var e : cur.entrySet()) {
            // 摄取时跳过的超限二进制，刷新时也不复制 —— 否则「添加得进、刷新就炸」
            if (e.getValue().path("skipped").asBoolean(false)) continue;
            Path out = repo.resolve(e.getKey());
            Files.createDirectories(longPath(out.getParent()));
            Files.copy(longPath(source.resolve(e.getKey())), longPath(out), java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        }
        // 重写 manifest
        ingestManifestOnly(projectId, source);
        long[] total = {0};
        int[] count = {0};
        try (var w = Files.walk(repo)) {
            for (Path p : (Iterable<Path>) w::iterator) {
                if (Files.isRegularFile(p)) {
                    count[0]++;
                    total[0] += Files.size(p);
                }
            }
        }
        ObjectNode cache = mapper.createObjectNode();
        cache.put("files", count[0]);
        cache.put("bytes", total[0]);
        cache.put("ingestedAt", nowIso());
        cache.put("fingerprint", "dir:" + count[0] + ":" + total[0]);
        cache.put("lastRefresh", nowIso());
        cache.set("lastDiff", diff);
        return cache;
    }

    /** 删除缓存目录（不删 .data/qa 历史，那由调用方决定保留）。 */
    public void deleteCache(String projectId) {
        deleteQuietly(cacheDir(projectId));
    }

    // ─────────────────────────────────────────────────────────────
    // 遍历：唯一的源头走法（闸门 + 剪枝）
    // ─────────────────────────────────────────────────────────────

    /**
     * 收源头里所有<b>普通文件</b>（rel -> {size, mtimeMs}），跳过目录一律剪枝。
     * 喂给 {@link #freshness} / {@link #refresh} / manifest 重写，与摄取同一份闸门口径 ——
     * 两边各写一份遍历的结果就是「manifest 记的」与「刷新时找的」不是同一批文件。
     */
    private void collectSourceFiles(Path source, java.util.Map<String, ObjectNode> into) throws IOException {
        walkSource(source, new SimpleFileVisitor<>() {
            @Override
            public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
                return guardDir(dir, source);
            }

            @Override
            public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                String rel = source.relativize(file).toString().replace('\\', '/');
                ObjectNode m = mapper.createObjectNode();
                m.put("size", attrs.size());
                // 与摄取侧同一判据：超限的二进制资源不进缓存，但必须留在清单里 ——
                // 漏记会让 freshness 每次把它报成「新增」，refresh 又会试图复制它。
                String name = file.getFileName() == null ? "" : file.getFileName().toString();
                if (attrs.size() > ScanGuard.MAX_FILE_BYTES && ScanGuard.skippableOversize(name)) {
                    m.put("skipped", true);
                }
                long mt = 0L;
                try {
                    mt = Files.getLastModifiedTime(file).toMillis();
                } catch (IOException ignored) {
                    // mtime 读不到按 0，与摄取侧同口径
                }
                m.put("mtimeMs", mt);
                into.put(rel, m);
                return FileVisitResult.CONTINUE;
            }

            @Override
            public FileVisitResult visitFileFailed(Path file, IOException exc) {
                return FileVisitResult.CONTINUE; // 新鲜度/刷新对单个读不了的文件不较真
            }
        });
    }

    /**
     * 带闸门的源头遍历。<b>必须 walkFileTree + SKIP_SUBTREE</b>：
     * {@code Files.walk + continue} 只跳过目录本身那一条记录，不阻止遍历 descend 进去 ——
     * 这是 2026-10-18 事故里 {@code node_modules} 八千个文件吃光配额的同款写法。
     * 不跟随符号链接（默认）：链接目标在源外的，不进缓存（ScanGuard 的同款精神）。
     */
    private static void walkSource(Path source, SimpleFileVisitor<Path> visitor) throws IOException {
        // 不传 maxDepth：深度由 visitFile 里的显式检查拒绝（保留「目录深度超过上限」这条
        // 可读的错误），而不是让遍历静默停在某一层 —— 静默截断和真拒绝在调用方眼里不一样。
        Files.walkFileTree(source, visitor);
    }

    /** 目录闸门：跳过目录一律 SKIP_SUBTREE（剪枝，不是 continue）。 */
    private static FileVisitResult guardDir(Path dir, Path root) {
        String name = dir.getFileName() == null ? "" : dir.getFileName().toString();
        if (!dir.equals(root) && cacheSkipDir(name)) {
            return FileVisitResult.SKIP_SUBTREE;
        }
        return FileVisitResult.CONTINUE;
    }

    /**
     * 摄取侧跳过目录 = {@link ScanGuard#skipDir} 再加一个 {@code .data}。
     *
     * <p>{@code .data} 不进 {@code ScanGuard.SKIP_DIRS}：那一份是「扫别人的代码」的公共口径，
     * 改它会动扫描层的事实（结构面板的目录树、facts 聚合都读它）。这里是缓存自己的规矩 ——
     * 哪怕缓存根被 {@code arsenal.projects.dir} 挪到了源外面，源里的 {@code .data}
     * （QA 留档 / 报告 / 别的缓存）也不该进项目缓存。
     */
    private static boolean cacheSkipDir(String name) {
        return ScanGuard.skipDir(name) || name.equals(".data");
    }

    // ─────────────────────────────────────────────────────────────
    // 前置校验：落点与源不许重叠（递归复制的根）
    // ─────────────────────────────────────────────────────────────

    /**
     * 缓存落点与源目录必须不相交（两个方向都查）。
     *
     * <p>真实路径比对，不比对字符串：{@code a/../..} 归一化后照样出圈，只认 realPath。
     * 对上的话，遍历会把自己正在写的产物当源头，无限套娃 —— 2026-10-18 那次
     * 28 秒没拷完、前端 15 秒超时的「连不上后端」就是这么来的。
     */
    private static void requireDisjoint(Path source, Path target) throws IOException {
        Path realSource;
        Path realTarget;
        try {
            realSource = source.toRealPath();
            realTarget = target.toRealPath();
        } catch (IOException e) {
            throw new IllegalArgumentException("路径解析失败（源或缓存目录不可达）：" + e.getMessage());
        }
        if (realTarget.startsWith(realSource) || realSource.startsWith(realTarget)) {
            throw new IllegalArgumentException(
                    "源目录与缓存落点重叠，拒绝摄取（否则会递归自我复制）：源 " + realSource
                            + " 与缓存 " + realTarget
                            + " 重叠。两种改法：① 把 arsenal.projects.dir（或环境变量 ARSENAL_PROJECTS_DIR）指到源目录之外；"
                            + "② 换一个不含 .data 的子目录当源。");
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 删除：两遍制（直接删 + 搬了再删）
    // ─────────────────────────────────────────────────────────────

    /**
     * 递归删除，长路径安全。两遍制：
     *
     * <p><b>第一遍直接删</b>（{@link #longPath} 扩展路径前缀）—— 正常 Windows 上这一遍就够。
     * <p><b>第二遍「搬了再删」</b>：第一遍有任何残留（含 IOException 中断的半棵子树），
     * 按最深优先逐个 {@code move} 到同卷短路径再删。为什么需要第二遍 —— 2026-10-18
     * 在本机实测：内核拦截一切 &gt;260 路径的<b>删除</b>（{@code DeleteFileW} /
     * {@code RemoveDirectoryW} 一律 {@code ERROR_ACCESS_DENIED}，加 {@code \\?\} 前缀也没用），
     * 而<b>改名不受影响</b>（618 字符路径 rename 实测通过；17,400 字符的毒树清理也通）。
     * 搬走再删因此成为深树唯一在所有机器上都通的路。
     *
     * <p>第二遍内部还有<b>收尾清扫</b>：搬走却没能删掉的残件（深树的尾段）此时已在
     * 短路径上，对它再走一遍两遍制。每遍至少削掉 512 层（深度上限），所以会到底。
     */
    static void deleteQuietly(Path dir) {
        deleteQuietly(dir, 0);
    }

    /**
     * 带轮次上限的删除。轮次只服务于收尾清扫的递归：深树每过一遍第二遍至少削
     * 512 层，3872 层的天梯八级到底；32 级是防「树不缩」的死循环保险，不是预期路径。
     */
    static void deleteQuietly(Path dir, int round) {
        if (dir == null || round > 32) return;
        try {
            if (!Files.exists(longPath(dir))) return;
            deleteRecursively(dir, 0);
            if (!Files.exists(longPath(dir))) return;
        } catch (IOException ignored) {
            // 落第二遍
        }
        try {
            deleteByMove(dir, round);
        } catch (IOException ignored) {
            // 删除失败不抛出：调用方多在异常处理路径上，再抛会盖住真错误
        }
    }

    private static void deleteRecursively(Path dir, int depth) throws IOException {
        if (depth > 512) return; // 防御：异常深的树（或链接环）不许无限递归
        List<Path> children = new ArrayList<>();
        try (var ds = Files.newDirectoryStream(longPath(dir))) {
            ds.forEach(children::add);
        }
        for (Path child : children) {
            // 子路径必须重新过 longPath：目录流吐出来的孩子会丢掉 \\?\ 前缀，
            // 长路径上不重新包一层，删除会落在非前缀形式上被拒
            Path c = longPath(child);
            // 不跟随符号链接删：链接指向别人的东西，删链接本身就够了
            if (Files.isDirectory(c) && !Files.isSymbolicLink(c)) {
                deleteRecursively(c, depth + 1);
            } else {
                Files.deleteIfExists(c);
            }
        }
        Files.deleteIfExists(longPath(dir));
    }

    /**
     * 第二遍：最深优先，逐个搬到同卷短路径再删。
     *
     * <p>顺序是关键：孩子先搬走，轮到这个目录时它已经是空的 —— 空目录的改名才成立。
     * 没搬动的（并发写入 / 权限）不重试，留着比死循环强。
     *
     * <p><b>每个条目一个独立 temp</b>（{@code .arsenal-clean-tmp-N}）：共用一个 temp 时，
     * 上一个条目搬进来却没能删掉（深树的尾段，删它是 DirectoryNotEmpty），下一个条目的
     * 「先删 temp」就会抛出把整遍第二遍打断在半路 —— 2026-10-18 清 3872 层毒树实测：
     * 旧写法一遍只削掉顶部一段，剩下的链永远躺在 temp 里，而回执还写着「删过了」。
     * 独立 temp 之后，一条搬不动只损失它自己。
     *
     * <p><b>收尾清扫</b>：搬走却没能删掉的残件此时已在短路径上，对它再走一遍两遍制
     * （递归，轮次上限见 {@link #deleteQuietly(Path, int)}）。
     */
    private static void deleteByMove(Path dir, int round) throws IOException {
        List<Path> entries = new ArrayList<>();
        collectDeepestFirst(dir, entries, 0);
        List<Path> temps = new ArrayList<>();
        for (int i = 0; i < entries.size(); i++) {
            Path e = entries.get(i);
            if (!Files.exists(longPath(e))) continue;
            Path temp = shortTempPath(dir, i);
            temps.add(temp);
            try {
                Files.deleteIfExists(temp);
                Files.move(e, temp);
                Files.deleteIfExists(temp);
            } catch (IOException ignored) {
                // 这一个搬不动：不重试，继续下一个
            }
        }
        // 收尾：搬走却没能删掉的残件（深树尾段），在短路径上再走一遍两遍制。
        // 每遍至少削 512 层，递归会到底；round 上限防「树不缩」的死循环。
        for (Path temp : temps) {
            if (Files.exists(longPath(temp))) deleteQuietly(temp, round + 1);
        }
    }

    /** 后序收集（先孩子后自己）—— 这就是「最深优先」。 */
    private static void collectDeepestFirst(Path dir, List<Path> into, int depth) throws IOException {
        if (depth > 512) return;
        List<Path> children = new ArrayList<>();
        try (var ds = Files.newDirectoryStream(longPath(dir))) {
            ds.forEach(children::add);
        }
        for (Path child : children) {
            Path c = longPath(child);
            if (Files.isDirectory(c) && !Files.isSymbolicLink(c)) {
                collectDeepestFirst(c, into, depth + 1);
            } else {
                into.add(c);
            }
        }
        into.add(dir);
    }

    /** 同卷短路径：第 i 个条目一个（{@code <parent>/.arsenal-clean-tmp-i}），同级也超长才退到盘根。 */
    private static Path shortTempPath(Path dir, int i) {
        Path parent = dir.getParent();
        Path candidate = (parent == null ? dir.getRoot() : parent).resolve(".arsenal-clean-tmp-" + i);
        if (candidate.toAbsolutePath().toString().length() < 200) return candidate;
        return dir.getRoot().resolve(".arsenal-clean-tmp-" + i);
    }

    /**
     * Windows 扩展长度路径。超过 240 字符加 {@code \\?\} 前缀（UNC 用 {@code \\?\UNC\}）。
     * 已经是扩展形式或够短就原样返回 —— 前缀不是越多越好，普通路径加前缀反而碍事。
     */
    static Path longPath(Path p) {
        String s = p.toAbsolutePath().normalize().toString();
        if (s.startsWith("\\\\?\\")) return p;
        if (s.length() < 240) return p;
        if (s.startsWith("\\\\")) {
            return Path.of("\\\\?\\UNC\\" + s.substring(2));
        }
        return Path.of("\\\\?\\" + s);
    }

    // ─────────────────────────────────────────────────────────────

    /** 每项目一把摄取锁：prepareTarget 的「删了重建」非原子，同项目并发摄取/扫描会互删目录。 */
    private final java.util.concurrent.ConcurrentHashMap<String, Object> ingestLocks =
            new java.util.concurrent.ConcurrentHashMap<>();

    private Path prepareTarget(String projectId) throws IOException {
        synchronized (ingestLocks.computeIfAbsent(safeSegment(projectId), k -> new Object())) {
            Path target = cacheDir(projectId);
            deleteQuietly(target);
            Files.createDirectories(target);
            return target;
        }
    }

    private void ingestManifestOnly(String projectId, Path source) throws IOException {
        Path target = cacheDir(projectId);
        java.util.Map<String, ObjectNode> cur = new java.util.HashMap<>();
        collectSourceFiles(source, cur);
        ObjectNode manifestRoot = mapper.createObjectNode();
        manifestRoot.put("root", source.getFileName() == null ? source.toString() : source.getFileName().toString());
        manifestRoot.put("generatedAt", nowIso());
        ArrayNode files = manifestRoot.putArray("files");
        for (var e : cur.entrySet()) {
            ObjectNode m = mapper.createObjectNode();
            m.put("rel", e.getKey());
            m.put("size", e.getValue().path("size").asLong());
            m.put("mtimeMs", e.getValue().path("mtimeMs").asLong());
            if (e.getValue().path("skipped").asBoolean(false)) m.put("skipped", true);
            files.add(m);
        }
        mapper.writerWithDefaultPrettyPrinter().writeValue(target.resolve("manifest.json").toFile(), manifestRoot);
    }

    private static String readGitHead(Path repo) {
        Process proc = null;
        try {
            ProcessBuilder pb = new ProcessBuilder("git", "-C", repo.toString(), "rev-parse", "HEAD");
            pb.redirectErrorStream(true);
            proc = pb.start();
            // 先限时等退出再读流：rev-parse 只写 ~41 字节，管道不会满；反过来先读再等的话，
            // git 挂住时 readLine 永远阻塞，进程就再也没人销毁了（泄漏）。
            if (!proc.waitFor(30, TimeUnit.SECONDS)) {
                proc.destroyForcibly();
                return null;
            }
            StringBuilder out = new StringBuilder();
            try (var r = new BufferedReader(new InputStreamReader(proc.getInputStream()))) {
                String line;
                while ((line = r.readLine()) != null && out.length() < 200) out.append(line).append('\n');
            }
            String s = out.toString().trim();
            return s.isEmpty() ? null : s;
        } catch (Exception e) {
            return null;
        } finally {
            // 已退出的进程 destroy 是无害空操作；走异常路径时这里兜底，不留孤儿 git
            if (proc != null) proc.destroyForcibly();
        }
    }

    private static String nowIso() {
        return java.time.OffsetDateTime.now(java.time.ZoneOffset.ofHours(8)).toString();
    }
}
