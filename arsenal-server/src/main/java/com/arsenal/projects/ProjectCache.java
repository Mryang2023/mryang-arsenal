package com.arsenal.projects;

import com.arsenal.scan.ScanGuard;
import com.arsenal.scan.SourceResolver;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;

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

    /** 某项目的缓存目录（repo/ 的父）。 */
    public Path cacheDir(String projectId) {
        return root.resolve(projectId);
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
        Path repo = target.resolve("repo");
        Files.createDirectories(repo);

        final long[] total = {0};
        final int[] count = {0};
        final List<ObjectNode> manifest = new ArrayList<>();
        try (var walk = Files.walk(source)) {
            for (Path p : (Iterable<Path>) walk::iterator) {
                if (ScanGuard.skipDir(p.getFileName() == null ? "" : p.getFileName().toString())) {
                    continue;
                }
                Path rel = source.relativize(p);
                if (Files.isDirectory(p)) {
                    Files.createDirectories(repo.resolve(rel.toString()));
                } else if (Files.isRegularFile(p)) {
                    if (++count[0] > ScanGuard.MAX_FILES) {
                        throw new ProjectIngestException("文件数超过上限 " + ScanGuard.MAX_FILES);
                    }
                    long size = Files.size(p);
                    if (size > ScanGuard.MAX_FILE_BYTES) {
                        throw new ProjectIngestException("单文件超过上限 " + ScanGuard.MAX_FILE_BYTES / 1024 / 1024 + "MB");
                    }
                    total[0] += size;
                    if (total[0] > ScanGuard.MAX_TOTAL_BYTES) {
                        throw new ProjectIngestException("总大小超过上限 " + ScanGuard.MAX_TOTAL_BYTES / 1024 / 1024 + "MB");
                    }
                    if (ScanGuard.depth(source, p) > ScanGuard.MAX_DEPTH) {
                        throw new ProjectIngestException("目录深度超过上限 " + ScanGuard.MAX_DEPTH);
                    }
                    Path out = repo.resolve(rel.toString());
                    Files.createDirectories(out.getParent());
                    Files.copy(p, out);
                    ObjectNode m = mapper.createObjectNode();
                    m.put("rel", rel.toString().replace('\\', '/'));
                    m.put("size", size);
                    try {
                        m.put("mtimeMs", Files.getLastModifiedTime(p).toMillis());
                    } catch (IOException ignored) {
                        m.put("mtimeMs", 0L);
                    }
                    manifest.add(m);
                }
            }
        } catch (ProjectIngestException e) {
            deleteQuietly(target);
            throw e;
        }
        ObjectNode manifestRoot = mapper.createObjectNode();
        manifestRoot.put("root", source.getFileName() == null ? source.toString() : source.getFileName().toString());
        manifestRoot.put("generatedAt", nowIso());
        ArrayNode files = manifestRoot.putArray("files");
        manifest.forEach(files::add);
        mapper.writerWithDefaultPrettyPrinter().writeValue(target.resolve("manifest.json").toFile(), manifestRoot);

        ObjectNode cache = mapper.createObjectNode();
        cache.put("files", count[0]);
        cache.put("bytes", total[0]);
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
        SourceResolver.fromGitInto(repo, url);

        String head = readGitHead(repo);
        ObjectNode cache = mapper.createObjectNode();
        long[] total = {0};
        int[] count = {0};
        try (var walk = Files.walk(repo)) {
            for (Path p : (Iterable<Path>) walk::iterator) {
                if (Files.isRegularFile(p)) {
                    count[0]++;
                    total[0] += Files.size(p);
                }
            }
        } catch (IOException ignored) {
            // 计数失败不影响克隆结果
        }
        cache.put("files", count[0]);
        cache.put("bytes", total[0]);
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
        try (var walk = Files.walk(source)) {
            for (Path p : (Iterable<Path>) walk::iterator) {
                if (ScanGuard.skipDir(p.getFileName() == null ? "" : p.getFileName().toString())) continue;
                if (!Files.isRegularFile(p)) continue;
                String rel = source.relativize(p).toString().replace('\\', '/');
                ObjectNode m = mapper.createObjectNode();
                long size = Files.size(p);
                long mt = 0L;
                try { mt = Files.getLastModifiedTime(p).toMillis(); } catch (IOException ignored) { }
                m.put("size", size);
                m.put("mtimeMs", mt);
                cur.put(rel, m);
            }
        }
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
        for (var n : diff.withArray("removed")) {
            Files.deleteIfExists(repo.resolve(n.asText()));
        }
        try (var walk = Files.walk(source)) {
            for (Path p : (Iterable<Path>) walk::iterator) {
                if (ScanGuard.skipDir(p.getFileName() == null ? "" : p.getFileName().toString())) continue;
                if (!Files.isRegularFile(p)) continue;
                Path out = repo.resolve(source.relativize(p).toString());
                Files.createDirectories(out.getParent());
                Files.copy(p, out, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
            }
        }
        // 重写 manifest
        ingestManifestOnly(projectId, source);
        long[] total = {0}; int[] count = {0};
        try (var w = Files.walk(repo)) {
            for (Path p : (Iterable<Path>) w::iterator) {
                if (Files.isRegularFile(p)) { count[0]++; total[0] += Files.size(p); }
            }
        }
        ObjectNode cache = mapper.createObjectNode();
        cache.put("files", count[0]); cache.put("bytes", total[0]);
        cache.put("ingestedAt", nowIso());
        cache.put("fingerprint", "dir:" + count[0] + ":" + total[0]);
        cache.put("lastRefresh", nowIso());
        cache.set("lastDiff", diff);
        return cache;
    }

    private void ingestManifestOnly(String projectId, Path source) throws IOException {
        Path target = cacheDir(projectId);
        final List<ObjectNode> manifest = new ArrayList<>();
        try (var walk = Files.walk(source)) {
            for (Path p : (Iterable<Path>) walk::iterator) {
                if (ScanGuard.skipDir(p.getFileName() == null ? "" : p.getFileName().toString())) continue;
                if (!Files.isRegularFile(p)) continue;
                ObjectNode m = mapper.createObjectNode();
                m.put("rel", source.relativize(p).toString().replace('\\', '/'));
                m.put("size", Files.size(p));
                try { m.put("mtimeMs", Files.getLastModifiedTime(p).toMillis()); } catch (IOException ignored) { m.put("mtimeMs", 0L); }
                manifest.add(m);
            }
        }
        ObjectNode manifestRoot = mapper.createObjectNode();
        manifestRoot.put("root", source.getFileName() == null ? source.toString() : source.getFileName().toString());
        manifestRoot.put("generatedAt", nowIso());
        ArrayNode files = manifestRoot.putArray("files");
        manifest.forEach(files::add);
        mapper.writerWithDefaultPrettyPrinter().writeValue(target.resolve("manifest.json").toFile(), manifestRoot);
    }

    /** 删除缓存目录（不删 .data/qa 历史，那由调用方决定保留）。 */
    public void deleteCache(String projectId) {
        deleteQuietly(cacheDir(projectId));
    }

    // ─────────────────────────────────────────────────────────────

    private Path prepareTarget(String projectId) throws IOException {
        Path target = cacheDir(projectId);
        deleteQuietly(target);
        Files.createDirectories(target);
        return target;
    }

    private static String readGitHead(Path repo) {
        try {
            ProcessBuilder pb = new ProcessBuilder("git", "-C", repo.toString(), "rev-parse", "HEAD");
            pb.redirectErrorStream(true);
            Process proc = pb.start();
            StringBuilder out = new StringBuilder();
            try (var r = new BufferedReader(new InputStreamReader(proc.getInputStream()))) {
                String line;
                while ((line = r.readLine()) != null && out.length() < 200) out.append(line).append('\n');
            }
            proc.waitFor(30, TimeUnit.SECONDS);
            String s = out.toString().trim();
            return s.isEmpty() ? null : s;
        } catch (Exception e) {
            return null;
        }
    }

    private static void deleteQuietly(Path dir) {
        if (dir == null || !Files.exists(dir)) return;
        try (var walk = Files.walk(dir)) {
            walk.sorted(Comparator.reverseOrder()).forEach(p -> {
                try { Files.deleteIfExists(p); } catch (IOException ignored) { }
            });
        } catch (IOException ignored) {
        }
    }

    private static String nowIso() {
        return java.time.OffsetDateTime.now(java.time.ZoneOffset.ofHours(8)).toString();
    }
}
