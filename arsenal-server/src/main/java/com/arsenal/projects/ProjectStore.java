package com.arsenal.projects;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 服务端按项目留档（治「切菜单内容丢失」的暗伤）：facts / 体检 latest + history 都按 projectId 落盘，
 * 切走再回来是从服务端读回，不是组件 state。
 *
 * <p>布局（在 {@code <root>/<projectId>/} 下，与缓存 repo/ 同级）：
 * <pre>{@code
 *   facts.json               最近一次扫描事实 + meta{scannedAt, elapsedMs, fingerprint}
 *   checkup-latest.json     最近一次体检报告
 *   checkup-history/<id>.json  体检历史（封顶 20 份，超出删最旧）
 * }</pre>
 */
public final class ProjectStore {

    /** 体检历史封顶。 */
    public static final int HISTORY_CAP = 20;

    private final Path root;
    private final ObjectMapper mapper;

    public ProjectStore(Path root, ObjectMapper mapper) {
        this.root = root;
        this.mapper = mapper;
    }

    // ── facts ──

    public boolean hasFacts(String projectId) {
        return Files.isRegularFile(factsPath(projectId));
    }

    public JsonNode readFacts(String projectId) throws IOException {
        return mapper.readTree(factsPath(projectId).toFile());
    }

    public void writeFacts(String projectId, JsonNode facts) throws IOException {
        Path dir = cacheDir(projectId);
        Files.createDirectories(dir);
        mapper.writerWithDefaultPrettyPrinter().writeValue(dir.resolve("facts.json").toFile(), facts);
    }

    // ── checkups ──

    public boolean hasCheckup(String projectId) {
        return Files.isRegularFile(checkupLatestPath(projectId));
    }

    public JsonNode readCheckupLatest(String projectId) throws IOException {
        return mapper.readTree(checkupLatestPath(projectId).toFile());
    }

    /** 历史摘要列表（不含整报告），按时间倒序。 */
    public List<ObjectNode> checkupHistory(String projectId) throws IOException {
        Path dir = checkupHistoryDir(projectId);
        if (!Files.isDirectory(dir)) return new ArrayList<>();
        List<ObjectNode> out = new ArrayList<>();
        try (var list = Files.list(dir)) {
            for (Path p : (Iterable<Path>) list.filter(x -> x.toString().endsWith(".json"))::iterator) {
                out.add((ObjectNode) mapper.readTree(p.toFile()));
            }
        }
        out.sort(Comparator.comparing((ObjectNode n) -> n.path("savedAt").asText("")).reversed());
        return out;
    }

    /** 写一份体检报告：更新 latest + 追加 history（封顶裁剪）。 */
    public void writeCheckup(String projectId, JsonNode report) throws IOException {
        Path dir = cacheDir(projectId);
        Files.createDirectories(dir);
        Path history = checkupHistoryDir(projectId);
        Files.createDirectories(history);

        mapper.writerWithDefaultPrettyPrinter().writeValue(checkupLatestPath(projectId).toFile(), report);

        String stamp = java.time.OffsetDateTime.now(java.time.ZoneOffset.ofHours(8))
                .toString().replace(':', '-').replace('.', '-');
        String jobId = report.path("jobId").asText("" + System.nanoTime());
        Path histFile = history.resolve(stamp + "-" + jobId + ".json");
        mapper.writerWithDefaultPrettyPrinter().writeValue(histFile.toFile(), report);

        // 封顶裁剪：超出删最旧
        List<Path> all = new ArrayList<>();
        try (var list = Files.list(history)) {
            list.filter(x -> x.toString().endsWith(".json")).forEach(all::add);
        }
        all.sort(Comparator.comparing(p -> p.toFile().lastModified()));
        while (all.size() > HISTORY_CAP) {
            Path oldest = all.remove(0);
            Files.deleteIfExists(oldest);
        }
    }

    /** 删除某项目的全部留档（facts / latest / history）。缓存 repo/ 由调用方通过 ProjectCache 删。 */
    public void deleteAll(String projectId) {
        deleteQuietly(cacheDir(projectId).resolve("facts.json"));
        deleteQuietly(cacheDir(projectId).resolve("checkup-latest.json"));
        deleteQuietly(checkupHistoryDir(projectId));
    }

    // ─────────────────────────────────────────────────────────────

    private Path cacheDir(String projectId) {
        return root.resolve(projectId);
    }

    private Path factsPath(String projectId) {
        return cacheDir(projectId).resolve("facts.json");
    }

    private Path checkupLatestPath(String projectId) {
        return cacheDir(projectId).resolve("checkup-latest.json");
    }

    private Path checkupHistoryDir(String projectId) {
        return cacheDir(projectId).resolve("checkup-history");
    }

    private static void deleteQuietly(Path p) {
        try {
            Files.deleteIfExists(p);
        } catch (IOException ignored) {
        }
    }
}
