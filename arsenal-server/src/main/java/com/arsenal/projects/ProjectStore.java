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
 *   ddl-plans/<planId>.json  DDL 变更计划留档（封顶 50 份）
 *   apidoc-plans/<planId>.json  接口文档生成计划留档（同样封顶 50 份）
 * }</pre>
 *
 * <p><b>ddl-plans/ 是「记录」不是「操作」</b>：计划里只有生成出来的脚本/表说明/实体正文与
 * 它们**应当**落到被管理项目的哪个路径，军火库自己一个字节都不写进那个项目。
 * 留在这里的价值是：变更还没落盘时，档案页也能看到「谁在什么时候计划改哪张表」。
 */
public final class ProjectStore {

    /** 体检历史封顶。 */
    public static final int HISTORY_CAP = 20;
    /** 变更计划留档封顶。一份计划约十几 KB，50 份 ≈ 1MB，够回溯一个迭代。 */
    public static final int PLAN_CAP = 50;

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

    // ── DDL 变更计划（只记录，不执行、不写被管理项目）──

    /** 写一份计划留档：planId 由调用方给（含时间戳），同名覆盖。封顶裁剪。 */
    public void writePlan(String projectId, String planId, JsonNode plan) throws IOException {
        writeJson(planDir(projectId), planId, plan);
    }

    /** 计划列表（完整内容），按记录时间倒序。调用方负责裁剪成摘要。 */
    public List<ObjectNode> listPlans(String projectId) throws IOException {
        return listJson(planDir(projectId));
    }

    /** 单份计划。不存在抛 {@link java.nio.file.NoSuchFileException}（控制器落成 NOT_FOUND）。 */
    public JsonNode readPlan(String projectId, String planId) throws IOException {
        return readJson(planDir(projectId), planId);
    }

    // ── 接口文档生成计划（同样只留档，不写被管理项目）──

    public void writeApiDocPlan(String projectId, String planId, JsonNode plan) throws IOException {
        writeJson(apiDocPlanDir(projectId), planId, plan);
    }

    public List<ObjectNode> listApiDocPlans(String projectId) throws IOException {
        return listJson(apiDocPlanDir(projectId));
    }

    public JsonNode readApiDocPlan(String projectId, String planId) throws IOException {
        return readJson(apiDocPlanDir(projectId), planId);
    }

    /** 删除某项目的全部留档（facts / latest / history / 计划）。缓存 repo/ 由调用方通过 ProjectCache 删。 */
    public void deleteAll(String projectId) {
        deleteQuietly(cacheDir(projectId).resolve("facts.json"));
        deleteQuietly(cacheDir(projectId).resolve("checkup-latest.json"));
        deleteQuietly(checkupHistoryDir(projectId));
        deleteQuietly(planDir(projectId));
        deleteQuietly(apiDocPlanDir(projectId));
    }

    // ─────────────────────────────────────────────────────────────

    private void writeJson(Path dir, String id, JsonNode node) throws IOException {
        Files.createDirectories(dir);
        Path file = dir.resolve(safeId(id) + ".json");
        mapper.writerWithDefaultPrettyPrinter().writeValue(file.toFile(), node);

        List<Path> all = new ArrayList<>();
        try (var list = Files.list(dir)) {
            list.filter(x -> x.toString().endsWith(".json")).forEach(all::add);
        }
        all.sort(Comparator.comparing(p -> p.toFile().lastModified()));
        while (all.size() > PLAN_CAP) {
            Files.deleteIfExists(all.remove(0));
        }
    }

    private List<ObjectNode> listJson(Path dir) throws IOException {
        List<ObjectNode> out = new ArrayList<>();
        if (!Files.isDirectory(dir)) return out;
        try (var list = Files.list(dir)) {
            for (Path p : (Iterable<Path>) list.filter(x -> x.toString().endsWith(".json"))::iterator) {
                out.add((ObjectNode) mapper.readTree(p.toFile()));
            }
        }
        out.sort(Comparator.comparing((ObjectNode n) -> n.path("recordedAt").asText("")).reversed());
        return out;
    }

    private JsonNode readJson(Path dir, String id) throws IOException {
        return mapper.readTree(dir.resolve(safeId(id) + ".json").toFile());
    }

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

    private Path planDir(String projectId) {
        return cacheDir(projectId).resolve("ddl-plans");
    }

    private Path apiDocPlanDir(String projectId) {
        return cacheDir(projectId).resolve("apidoc-plans");
    }

    /** planId 会拼进文件名，只留字母数字与 `-_`。 */
    private static String safeId(String s) {
        return s == null ? "" : s.replaceAll("[^A-Za-z0-9_-]", "");
    }

    private static void deleteQuietly(Path p) {
        try {
            Files.deleteIfExists(p);
        } catch (IOException ignored) {
        }
    }
}
