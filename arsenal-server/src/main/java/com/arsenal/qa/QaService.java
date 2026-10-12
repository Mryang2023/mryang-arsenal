package com.arsenal.qa;

import com.arsenal.autopsy.AutopsyService;
import com.arsenal.domain.Rule;
import com.arsenal.loader.RuleIndex;
import com.arsenal.scan.ScanGuard;
import com.arsenal.scan.SourceResolver;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;

/**
 * 测试工程师（/qa）的编排：Job 状态机 + qaReport v1 组装 + 快照落盘。
 *
 * <p><b>静态链路与解剖台同源。</b>P0/P1 判定走的是同一个 {@link AutopsyService}（同一次 collect、
 * 同一台 LintEngine、同一份 coverage 口径）—— 「/qa 与 /autopsy 同地址数字必须一致」这条验收
 * 不是靠对齐两份代码实现的，是靠只写一层薄壳实现的。review 模式的引擎入口裁剪也复用
 * {@link AutopsyService#inspect(SourceResolver, Predicate)}，过滤发生在读文件内容之前。
 *
 * <p>M1 的边界（如实写进报告，不装 M3）：语义深检档恒为「未执行」；优化方案 = 规则自带 good
 * 片段的模板化对照；测试建议 = 纯启发式（findings 命中密度 × 同名测试文件存在性）。
 *
 * <p>落盘布局（不进 git，沿用 autopsy 的规矩）：
 * <pre>
 *   .data/qa/jobs/&lt;jobId&gt;.json          —— job 状态（重启可查历史）
 *   .data/qa/&lt;projectId&gt;/&lt;jobId&gt;.json  —— qaReport 快照（历史列表、范围勾选的目录树来源）
 * </pre>
 */
@Component
public class QaService {

    private static final Logger log = LoggerFactory.getLogger(QaService.class);

    /** 与 AutopsyService 同一套待检扩展名 —— 两处不一致，pctOfRepo 的分母就是假的。 */
    private static final Set<String> EXTS = Set.of("java", "xml", "yml", "yaml", "properties");

    /** scannedFiles 索引的封顶：目录树勾选够用即可，报告不该膨胀成文件清单转储。 */
    private static final int MAX_FILE_INDEX = 5000;
    private static final int MAX_RECOMMENDATIONS = 120;
    private static final int MAX_TEST_SUGGESTIONS = 25;

    private final AutopsyService autopsy;
    private final RuleIndex index;
    private final ObjectMapper mapper;
    private final Path baseDir;
    private final int poolSize;

    private final Map<String, QaJob> jobs = new ConcurrentHashMap<>();
    private ExecutorService executor;

    public QaService(AutopsyService autopsy, RuleIndex index, ObjectMapper mapper,
                     @Value("${arsenal.qa.data-dir:../.data/qa}") String dataDir,
                     @Value("${arsenal.qa.pool-size:2}") int poolSize) {
        this.autopsy = autopsy;
        this.index = index;
        this.mapper = mapper;
        this.baseDir = Path.of(dataDir).toAbsolutePath().normalize();
        this.poolSize = Math.max(1, poolSize);
    }

    @PostConstruct
    void init() {
        try {
            Files.createDirectories(jobsDir());
        } catch (IOException e) {
            throw new IllegalStateException("无法创建 qa 数据目录：" + baseDir, e);
        }
        // 重启恢复：磁盘上的 job 状态读回内存；挂着 RUNNING 的一律判死（worker 线程已经没了）
        try (var list = Files.list(jobsDir())) {
            for (Path p : list.filter(f -> f.toString().endsWith(".json")).toList()) {
                try {
                    QaJob job = new QaJob(mapper.readTree(Files.readString(p, StandardCharsets.UTF_8)));
                    if (job.abandonIfStale()) {
                        persistJob(job);
                    }
                    jobs.put(job.id(), job);
                } catch (Exception e) {
                    log.warn("job 状态文件读不回内存，跳过：{}", p, e);
                }
            }
        } catch (IOException ignored) {
            // 列不出历史不影响新提交；如实记日志即可
        }
        executor = Executors.newFixedThreadPool(poolSize, r -> {
            Thread t = new Thread(r, "qa-worker");
            t.setDaemon(true);
            return t;
        });
    }

    @PreDestroy
    void shutdown() {
        if (executor != null) {
            executor.shutdownNow();
            try {
                executor.awaitTermination(5, TimeUnit.SECONDS);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 提交 / 查询
    // ─────────────────────────────────────────────────────────────

    /**
     * 受理一次深检。这里只做校验与入队 —— git clone 发生在 worker 的 CLONING 段，
     * submit 必须秒回，这正是本功能与同步 /api/autopsy 的分工。
     */
    public ObjectNode submit(JsonNode body) {
        JsonNode source = body == null ? null : body.get("source");
        if (source == null || !source.isObject()) {
            throw new IllegalArgumentException(
                    "请求体缺少 source：{\"source\":{\"kind\":\"path|git\",\"value\":\"…\"},\"range\":{…}}");
        }
        String kind = source.path("kind").asText("");
        String value = source.path("value").asText("");
        if (value.isBlank()) {
            throw new IllegalArgumentException("source.value 是空的 —— 给一个本地目录或 https git 地址");
        }
        if (!kind.equals("path") && !kind.equals("git")) {
            throw new IllegalArgumentException(
                    "source.kind 只支持 path / git，收到的是「" + kind + "」（zip 请走 /api/scan/upload）");
        }
        QaRange range = QaRange.fromJson(body.get("range"));
        boolean deepCheck = body.path("deepCheck").asBoolean(false);

        String jobId = UUID.randomUUID().toString().replace("-", "").substring(0, 16);
        QaJob job = new QaJob(jobId, projectIdOf(kind, value), kind, value, range, deepCheck);
        jobs.put(jobId, job);
        persistJob(job);
        executor.submit(() -> run(job));

        ObjectNode out = mapper.createObjectNode();
        out.put("jobId", jobId);
        out.put("projectId", job.projectId());
        out.put("status", job.status());
        return out;
    }

    /** job 状态（轮询用）。内存没有再读盘 —— 重启后查历史也要给得出。 */
    public JsonNode jobNode(String jobId) {
        String id = safeSegment(jobId); // 拼路径的输入一律先消毒（../../ 之类直接 400）
        QaJob job = jobs.get(id);
        if (job != null) {
            return job.toNode(mapper.createObjectNode());
        }
        Path p = jobsDir().resolve(id + ".json");
        if (!Files.isRegularFile(p)) {
            throw new IllegalArgumentException("没有这个 jobId：" + jobId);
        }
        try {
            return mapper.readTree(Files.readString(p, StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new IllegalArgumentException("job 状态读不出来：" + e.getMessage());
        }
    }

    /** 完成后的报告。DONE 之前调用是明确的错误，不做「半成品也能看」。 */
    public JsonNode reportNode(String jobId) {
        QaJob job = requireJob(jobId);
        if (!QaJob.DONE.equals(job.status())) {
            throw new IllegalArgumentException("报告还没好 —— job 当前是 " + job.status() + "，请继续轮询 /api/qa/jobs/" + job.id());
        }
        Path p = snapshotPath(job.projectId(), jobId);
        if (!Files.isRegularFile(p)) {
            throw new IllegalArgumentException("报告文件不在了：" + p.getFileName());
        }
        try {
            return mapper.readTree(Files.readString(p, StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new IllegalArgumentException("报告读不出来：" + e.getMessage());
        }
    }

    /**
     * 范围勾选用的目录树来源：该项目**最近一次成功深检**的文件索引。
     *
     * <p>刻意不做 clone 缓存 —— 工作副本用完即删（安全口径），勾选需要的只是一份文件名清单，
     * 上次扫描已经把它落在快照里了。首次 git 深检前没有树，前端引导用户「先整仓跑一次再圈范围」。
     */
    public JsonNode tree(String projectId) {
        Path dir = baseDir.resolve(safeSegment(projectId));
        List<Path> reports = newestReports(dir);
        for (Path p : reports) {
            try {
                JsonNode rep = mapper.readTree(Files.readString(p, StandardCharsets.UTF_8));
                JsonNode files = rep.get("scannedFiles");
                if (files == null || !files.isArray() || files.isEmpty()) {
                    continue;
                }
                ObjectNode out = mapper.createObjectNode();
                out.put("projectId", projectId);
                out.put("fromJobId", p.getFileName().toString().replace(".json", ""));
                out.put("from", rep.path("scannedAt").asText(""));
                out.set("files", files);
                return out;
            } catch (IOException ignored) {
                // 一份坏了就试下一份，全坏了才报错
            }
        }
        throw new IllegalArgumentException("这个 projectId 还没有成功的深检，拿不到目录树 —— 先跑一次整仓检测");
    }

    /** 项目的历史快照摘要（列表用，不内嵌整报告）。 */
    public JsonNode snapshots(String projectId) {
        Path dir = baseDir.resolve(safeSegment(projectId));
        ArrayNode arr = mapper.createArrayNode();
        for (Path p : newestReports(dir)) {
            try {
                JsonNode rep = mapper.readTree(Files.readString(p, StandardCharsets.UTF_8));
                ObjectNode o = arr.addObject();
                o.put("jobId", p.getFileName().toString().replace(".json", ""));
                o.put("scannedAt", rep.path("scannedAt").asText(""));
                o.put("mode", rep.path("targetRange").path("mode").asText(""));
                o.put("files", rep.path("scope").path("files").asInt(0));
                o.put("filesMatched", rep.path("targetRange").path("filesMatched").asInt(0));
                o.put("p0", rep.path("staticFindings").path("p0").isArray()
                        ? rep.path("staticFindings").path("p0").size() : 0);
                o.put("p1", rep.path("staticFindings").path("p1").size());
                o.put("truncated", rep.path("scope").path("truncated").asBoolean(false));
            } catch (IOException ignored) {
                // 摘要跳过坏文件
            }
        }
        return arr;
    }

    // ─────────────────────────────────────────────────────────────
    // worker：5 段流水线
    // ─────────────────────────────────────────────────────────────

    private void run(QaJob job) {
        try {
            job.enterPhase(QaJob.PHASES.get(0)); // CLONING
            persistJob(job);
            SourceResolver source = job.kind().equals("git")
                    ? SourceResolver.fromGit(job.ref())
                    : SourceResolver.fromPath(job.ref());
            job.markPhaseDone(QaJob.PHASES.get(0));

            // ① 预走一遍只取文件名 —— 引擎跑起来会关掉工作副本，事后就数不出分母了。
            //    口径（EXTS / skipDir / isInside）与 AutopsyService.collect 一致，pctOfRepo 才不掺水。
            List<String> allFiles = listCandidateFiles(source.root());
            int matched = job.range().isFull() ? allFiles.size()
                    : (int) allFiles.stream().filter(job.range()::matches).count();

            job.enterPhase(QaJob.PHASES.get(1)); // SCANNING
            persistJob(job);
            // review：引擎入口裁剪（圈外文件内容都不读）。full/focus：与 /autopsy 逐位同源的整仓跑。
            Predicate<String> filter = job.range().isReview() ? job.range()::matches : null;
            JsonNode report = autopsy.inspect(source, filter);
            job.markPhaseDone(QaJob.PHASES.get(1));

            job.enterPhase(QaJob.PHASES.get(2)); // ANALYZING
            persistJob(job);
            ObjectNode qa = assemble(job, report, allFiles, matched);
            job.markPhaseDone(QaJob.PHASES.get(2));

            job.enterPhase(QaJob.PHASES.get(3)); // AGGREGATING
            persistJob(job);
            writeSnapshot(job.projectId(), job.id(), qa);
            job.succeed();
            persistJob(job);
        } catch (Exception e) {
            log.warn("qa job {} 失败", job.id(), e);
            job.fail(e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage());
            persistJob(job);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // qaReport v1 组装（schema 见 00-计划书 1.2-⑤）
    // ─────────────────────────────────────────────────────────────

    private ObjectNode assemble(QaJob job, JsonNode autopsyReport, List<String> allFiles, int matched) {
        ObjectNode rep = mapper.createObjectNode();
        rep.put("schemaVersion", 1);
        rep.put("jobId", job.id());
        rep.put("projectId", job.projectId());
        rep.put("scannedAt", Instant.now().toString());
        rep.put("elapsedMs", autopsyReport.path("elapsedMs").asLong(0));

        ObjectNode projectRef = rep.putObject("projectRef");
        projectRef.put("kind", autopsyReport.path("sourceKind").asText(job.kind()));
        projectRef.put("rootName", autopsyReport.path("root").asText(""));

        // targetRange：选择器原样 + 占比 + 圈外摘要（focus 才有；review 圈外根本没跑，给 null 语义 = 缺字段 + 明说）
        ObjectNode target = rep.putObject("targetRange");
        job.range().writeInto(target);
        int total = allFiles.size();
        target.put("filesTotal", total);
        target.put("filesMatched", matched);
        target.put("pctOfRepo", total == 0 ? 0.0 : Math.round(matched * 1000.0 / total) / 10.0);
        if (total > MAX_FILE_INDEX) {
            target.put("fileIndexTruncated", true);
        }

        rep.set("scope", autopsyReport.path("scope"));
        ObjectNode coverage = (ObjectNode) autopsyReport.path("coverage");
        coverage.put("scopeFilteredOut", autopsyReport.path("scope").path("filteredOut").asInt(0));
        rep.set("coverage", coverage);

        // staticFindings：focus 在此出口分桶（明细留圈内、圈外只出计数）；full/review 原样带出
        ObjectNode findings = rep.putObject("staticFindings");
        JsonNode p0 = autopsyReport.path("p0");
        JsonNode p1 = autopsyReport.path("p1");
        JsonNode other = autopsyReport.path("other");
        if (job.range().mode().equals(QaRange.FOCUS)) {
            int[] out = {0, 0, 0};
            findings.set("p0", retainInScope(p0, job.range(), out, 0));
            findings.set("p1", retainInScope(p1, job.range(), out, 1));
            findings.set("other", retainInScope(other, job.range(), out, 2));
            ObjectNode oos = findings.putObject("outOfScopeSummary");
            oos.put("p0", out[0]);
            oos.put("p1", out[1]);
            oos.put("other", out[2]);
            oos.put("note", "圈外已全量扫描，此处只计数不给明细");
        } else {
            findings.set("p0", p0);
            findings.set("p1", p1);
            findings.set("other", other);
            if (job.range().isReview()) {
                findings.put("outOfScopeNote", "review 模式：圈外文件未读未检，不存在『折叠的圈外违规』");
            }
        }

        // 语义档：M1 恒未执行 —— 「没跑」与「没问题」分开写死（三态披露纪律）
        rep.set("semanticFindings", mapper.createArrayNode());
        rep.put("semanticStatus", "not-run");
        rep.put("semanticReason", job.deepCheck()
                ? "已请求语义深检，但 LLM 层未上线（M1 骨架不含；M2 起交付）—— 本次结论全部来自静态引擎"
                : "语义深检未开启 —— 本次结论全部来自静态引擎");

        List<JsonNode> presented = new ArrayList<>();
        presented.addAll(toList(findings.path("p0")));
        presented.addAll(toList(findings.path("p1")));
        presented.addAll(toList(findings.path("other")));

        rep.set("recommendations", buildRecommendations(presented));
        rep.set("testSuggestions", buildTestSuggestions(allFiles, presented));

        rep.set("skipped", coverage.path("skipped"));
        rep.set("undecidability", coverage.path("undecidability"));
        rep.putNull("llmUsage");

        ArrayNode idx = rep.putArray("scannedFiles");
        for (int i = 0; i < Math.min(total, MAX_FILE_INDEX); i++) {
            idx.add(allFiles.get(i));
        }
        return rep;
    }

    private static List<JsonNode> toList(JsonNode arr) {
        List<JsonNode> out = new ArrayList<>();
        if (arr.isArray()) {
            arr.forEach(out::add);
        }
        return out;
    }

    private ArrayNode retainInScope(JsonNode tierArray, QaRange range, int[] outCounts, int slot) {
        ArrayNode kept = mapper.createArrayNode();
        for (JsonNode v : tierArray) {
            if (range.matches(v.path("file").asText(""))) {
                kept.add(v);
            } else {
                outCounts[slot]++;
            }
        }
        return kept;
    }

    // ── 面板 C · 离线模板：违规 → 规则自带 good 片段的对照方案 ──

    private ArrayNode buildRecommendations(List<JsonNode> findings) {
        ArrayNode arr = mapper.createArrayNode();
        Set<String> seen = new LinkedHashSet<>();
        int truncated = 0;
        for (JsonNode v : findings) {
            String ruleId = v.path("ruleId").asText("");
            String file = v.path("file").asText("");
            // 聚类键 = 文件 + 规则：同一处同一病报三遍不叫方案叫噪音
            if (!seen.add(ruleId + "|" + file)) {
                continue;
            }
            if (arr.size() >= MAX_RECOMMENDATIONS) {
                truncated++;
                continue;
            }
            Rule rule = index.byId(ruleId).orElse(null);
            ObjectNode r = arr.addObject();
            r.put("id", "r" + (arr.size()));
            r.put("title", "修复「" + v.path("title").asText(ruleId) + "」 — " + file + ":" + v.path("line").asInt());
            r.put("file", file);
            r.put("line", v.path("line").asInt());
            r.put("severity", v.path("severity").asText(""));
            r.put("category", v.path("category").asText(""));
            r.put("source", "rule:" + ruleId);
            r.put("before", v.path("snippet").asText(""));
            if (rule != null && rule.good() != null && !rule.good().isBlank()) {
                r.put("after", trimLines(rule.good(), 24));
                r.put("rationale", firstNonBlank(rule.rationale(), v.path("message").asText("")));
            } else {
                r.put("after", "");
                r.put("afterNote", "规则未附正例 —— 方案停在说明级，不编造示例代码");
                r.put("rationale", firstNonBlank(v.path("message").asText(""), rule == null ? "" : rule.rationale()));
            }
        }
        if (truncated > 0) {
            ObjectNode note = arr.addObject();
            note.put("note", "另有 " + truncated + " 组同类问题未展开（上限 " + MAX_RECOMMENDATIONS + "），明细见 staticFindings");
        }
        return arr;
    }

    // ── 面板 D · 离线启发式：findings 命中密度 × 同名测试存在性 ──

    private ArrayNode buildTestSuggestions(List<String> files, List<JsonNode> findings) {
        Map<String, Integer> hits = new LinkedHashMap<>();
        for (JsonNode v : findings) {
            hits.merge(v.path("file").asText(""), 1, Integer::sum);
        }

        Set<String> testedBases = new LinkedHashSet<>();
        boolean anyTestFile = false;
        for (String f : files) {
            String base = testBaseName(f);
            if (base != null) {
                anyTestFile = true;
                testedBases.add(base.toLowerCase(Locale.ROOT));
            }
        }

        ArrayNode arr = mapper.createArrayNode();
        if (!anyTestFile && !files.isEmpty() && files.stream().anyMatch(f -> f.endsWith(".java"))) {
            ObjectNode g = arr.addObject();
            g.put("target", "（全仓）");
            g.put("reason", "仓库里找不到任何 *Test / *Tests / *IT 文件 —— 核心路径至少该有冒烟级用例");
            g.putNull("draftCases");
        }

        List<Map.Entry<String, Integer>> ranked = hits.entrySet().stream()
                .sorted(Comparator.<Map.Entry<String, Integer>>comparingInt(Map.Entry::getValue).reversed()
                        .thenComparing(Map.Entry::getKey))
                .toList();
        int mainJava = 0;
        for (Map.Entry<String, Integer> e : ranked) {
            String f = e.getKey();
            if (!f.endsWith(".java") || !f.contains("/src/main/") && !f.startsWith("src/main/")) {
                continue;
            }
            mainJava++;
            if (arr.size() >= MAX_TEST_SUGGESTIONS) {
                continue;
            }
            String base = f.substring(f.lastIndexOf('/') + 1).replace(".java", "").toLowerCase(Locale.ROOT);
            if (testedBases.contains(base)) {
                continue;
            }
            ObjectNode o = arr.addObject();
            o.put("target", f);
            o.put("findings", e.getValue());
            o.put("reason", "命中 " + e.getValue() + " 处静态违规且仓库内找不到同名测试（" + base + "Test 等命名）—— 这里最该有用例");
            o.putNull("draftCases");
        }
        if (mainJava >= MAX_TEST_SUGGESTIONS) {
            ObjectNode note = arr.addObject();
            note.put("note", "建议数已达上限 " + MAX_TEST_SUGGESTIONS + "，按违规命中密度排序截断");
        }
        return arr;
    }

    /** 测试文件命名识别：FooTest / FooTests / FooIT / TestFoo → "foo"；不是测试文件返回 null。 */
    private static String testBaseName(String path) {
        if (!path.endsWith(".java")) {
            return null;
        }
        String name = path.substring(path.lastIndexOf('/') + 1).replace(".java", "");
        if (name.endsWith("Test") || name.endsWith("Tests") || name.endsWith("IT")) {
            return name.replaceAll("(Test|Tests|IT)$", "");
        }
        if (name.startsWith("Test") && name.length() > 4) {
            return name.substring(4);
        }
        return null;
    }

    // ─────────────────────────────────────────────────────────────
    // 工具
    // ─────────────────────────────────────────────────────────────

    private List<String> listCandidateFiles(Path root) {
        List<String> out = new ArrayList<>();
        try {
            Files.walkFileTree(root, new SimpleFileVisitor<>() {
                @Override
                public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
                    if (!dir.equals(root) && ScanGuard.skipDir(dir.getFileName().toString())) {
                        return FileVisitResult.SKIP_SUBTREE;
                    }
                    if (!ScanGuard.isInside(root, dir)) {
                        return FileVisitResult.SKIP_SUBTREE;
                    }
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                    if (out.size() >= MAX_FILE_INDEX) {
                        return FileVisitResult.TERMINATE;
                    }
                    if (!ScanGuard.isInside(root, file)) {
                        return FileVisitResult.CONTINUE;
                    }
                    String name = file.getFileName().toString();
                    int dot = name.lastIndexOf('.');
                    if (dot < 0 || !EXTS.contains(name.substring(dot + 1).toLowerCase(Locale.ROOT))
                            || !ScanGuard.readable(name)) {
                        return FileVisitResult.CONTINUE;
                    }
                    out.add(root.relativize(file).toString().replace('\\', '/'));
                    return FileVisitResult.CONTINUE;
                }
            });
        } catch (IOException e) {
            throw new IllegalArgumentException("文件索引失败：" + e.getMessage());
        }
        out.sort(Comparator.naturalOrder());
        return out;
    }

    private QaJob requireJob(String jobId) {
        String id = safeSegment(jobId);
        QaJob job = jobs.get(id);
        if (job == null) {
            Path p = jobsDir().resolve(id + ".json");
            if (Files.isRegularFile(p)) {
                try {
                    job = new QaJob(mapper.readTree(Files.readString(p, StandardCharsets.UTF_8)));
                } catch (IOException e) {
                    throw new IllegalArgumentException("job 状态读不出来：" + e.getMessage());
                }
            }
        }
        if (job == null) {
            throw new IllegalArgumentException("没有这个 jobId：" + jobId);
        }
        return job;
    }

    /** projectId = sha256(kind + ":" + 规范化 ref) 前 12 位 —— 同一地址重启后仍对得上历史。 */
    static String projectIdOf(String kind, String ref) {
        String normalized = kind + ":" + ref.trim().replace('\\', '/').replaceAll("/+$", "");
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(normalized.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(d).substring(0, 12);
        } catch (Exception e) {
            throw new IllegalStateException(e); // JDK 必有 SHA-256
        }
    }

    /** projectId 参与拼路径，先回炉当外部输入消毒（防有人手拼 ../）。 */
    private static String safeSegment(String s) {
        if (s == null || !s.matches("[A-Za-z0-9_-]{1,64}")) {
            throw new IllegalArgumentException("projectId 形态不对：" + s);
        }
        return s;
    }

    private Path jobsDir() {
        return baseDir.resolve("jobs");
    }

    private Path snapshotPath(String projectId, String jobId) {
        return baseDir.resolve(safeSegment(projectId)).resolve(safeSegment(jobId) + ".json");
    }

    private List<Path> newestReports(Path dir) {
        if (!Files.isDirectory(dir)) {
            return List.of();
        }
        try (var list = Files.list(dir)) {
            return list.filter(p -> p.toString().endsWith(".json"))
                    .sorted(Comparator.comparing((Path p) -> {
                        try {
                            return Files.getLastModifiedTime(p).toInstant();
                        } catch (IOException e) {
                            return Instant.EPOCH;
                        }
                    }).reversed())
                    .toList();
        } catch (IOException e) {
            return List.of();
        }
    }

    private void persistJob(QaJob job) {
        writeAtomically(jobsDir().resolve(safeSegment(job.id()) + ".json"), job.toNode(mapper.createObjectNode()));
    }

    private void writeSnapshot(String projectId, String jobId, ObjectNode report) {
        Path dir = baseDir.resolve(safeSegment(projectId));
        Path file = dir.resolve(safeSegment(jobId) + ".json");
        try {
            Files.createDirectories(dir);
        } catch (IOException e) {
            log.warn("快照目录创建失败，报告只留在内存之外没有落盘", e);
        }
        writeAtomically(file, report);
    }

    /** 先写 .tmp 再 move —— 轮询方读到半截 JSON 是最难查的偶发。 */
    private void writeAtomically(Path file, JsonNode node) {
        try {
            Path tmp = file.resolveSibling(file.getFileName() + ".tmp");
            Files.writeString(tmp, node.toPrettyString(), StandardCharsets.UTF_8);
            Files.move(tmp, file, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            log.warn("落盘失败：{}", file, e);
        }
    }

    private static String trimLines(String s, int max) {
        String[] lines = s.split("\n", max + 1);
        return lines.length <= max ? s : String.join("\n", lines);
    }

    private static String firstNonBlank(String a, String b) {
        return a != null && !a.isBlank() ? a : (b == null ? "" : b);
    }
}
