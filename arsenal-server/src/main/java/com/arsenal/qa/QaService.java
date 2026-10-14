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
    private final LlmClient llm;
    private final SemanticJudge judge;
    /** C1：给语义 finding 补「我真的跑红了」的实锤。关掉用 arsenal.qa.repro.max-per-job=0。 */
    private final ReproService repro;
    /** C4：三个审查员并行 + 交叉验证（共识 / 孤证）。 */
    private final CommitteeJudge committee;
    /** 本地 maven 仓库 —— 编译与跑复现测试都要它。找不到就如实说「没跑」。 */
    private final Path m2Repo;

    private final Map<String, QaJob> jobs = new ConcurrentHashMap<>();
    private ExecutorService executor;

    public QaService(AutopsyService autopsy, RuleIndex index, ObjectMapper mapper,
                     LlmClient llm, SemanticJudge judge, ReproService repro, CommitteeJudge committee,
                     @Value("${arsenal.qa.data-dir:../.data/qa}") String dataDir,
                     @Value("${arsenal.qa.pool-size:2}") int poolSize,
                     @Value("${arsenal.m2.repo:}") String m2RepoEnv) {
        this.autopsy = autopsy;
        this.index = index;
        this.mapper = mapper;
        this.llm = llm;
        this.judge = judge;
        this.repro = repro;
        this.committee = committee;
        this.baseDir = Path.of(dataDir).toAbsolutePath().normalize();
        this.poolSize = Math.max(1, poolSize);
        // 与 AutopsyController#m2Repo 同一个口径：env 优先，否则 ~/.m2/repository。
        // 找不到不是启动失败 —— 那只意味着「复现实锤跑不了」，由 assemble 如实披露。
        String repo = m2RepoEnv == null || m2RepoEnv.isBlank()
                ? System.getenv("M2_REPO") : m2RepoEnv;
        this.m2Repo = (repo == null || repo.isBlank()
                ? Path.of(System.getProperty("user.home"), ".m2", "repository")
                : Path.of(repo)).toAbsolutePath().normalize();
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

            // 语义层（M2）：deepCheck + 已配 key 才放行。
            // ⚠ 必须赶在 autopsy.inspect 之前跑 —— inspect 的 try-with-resources 会关掉 source，
            //   git 模式的工作副本用完即焚，事后再读文件就是空的。
            SemanticJudge.Outcome semantic = null;
            String semanticSkip = null;
            if (job.deepCheck()) {
                List<Rule> llmRules = llmRules();
                if (!llm.configured()) {
                    semanticSkip = "已请求语义深检，但 LLM 未配置（缺环境变量 ARSENAL_LLM_KEY）—— "
                            + "本次降级为纯静态结论，「没跑」不等于「没问题」";
                } else if (llmRules.isEmpty()) {
                    semanticSkip = "LLM 已配置，但当前规则集里没有可交语义层的规则";
                } else {
                    List<String> targets = semanticTargets(job, allFiles);
                    semantic = judge.run(source.root(), targets, llmRules);
                }
            } else {
                semanticSkip = "语义深检未开启 —— 本次结论全部来自静态引擎";
            }

            // C1 实锤：紧跟语义判定，同样必须在 inspect 关掉 source 之前跑
            //（复现测试要读目标文件、要往工作副本里写测试、要编译 —— 三件事都指着那份还活着的副本）。
            ReproService.Outcome reproOutcome = null;
            if (semantic != null) {
                if (job.deepCheck()) {
                    reproOutcome = repro.attach(source.root(), m2Repo, semantic.findings());
                } else {
                    reproOutcome = null;
                }
            }

            // review：引擎入口裁剪（圈外文件内容都不读）。full/focus：与 /autopsy 逐位同源的整仓跑。
            Predicate<String> filter = job.range().isReview() ? job.range()::matches : null;
            JsonNode report = autopsy.inspect(source, filter);
            job.markPhaseDone(QaJob.PHASES.get(1));

            job.enterPhase(QaJob.PHASES.get(2)); // ANALYZING
            persistJob(job);
            // ── C4 委员会：同样必须在 inspect 关掉 source 之前跑 ──
            // ⚠ 顺序不是随意的：autopsy.inspect 内部会 close 掉 source（git 模式的工作副本用完即焚），
            //   事后再读文件就是空的。所以委员会与复现一样，都排在 inspect 之前。
            CommitteeJudge.Outcome comOutcome = null;
            if (job.deepCheck()) {
                comOutcome = committee.run(source.root(), semanticTargets(job, allFiles));
            }

            ObjectNode qa = assemble(job, report, allFiles, matched, semantic, semanticSkip, reproOutcome);

            if (comOutcome != null) {
                qa.set("committeeFindings", comOutcome.findings());
                qa.set("committeeUsage", comOutcome.usage());
                ArrayNode cn = qa.putArray("committeeNotes");
                comOutcome.notes().forEach(cn::add);
                ObjectNode cs = qa.putObject("committeeSummary");
                cs.put("consensus", comOutcome.consensus());
                cs.put("solo", comOutcome.solo());
                cs.put("budgetCut", comOutcome.budgetCut());
                cs.put("note", "孤证 ≠ 误报：只有一个审查员报的是置信标注，"
                        + "与「语义 finding 必带 confidence、不进 P0」是同一条纪律");
            } else {
                qa.set("committeeFindings", mapper.createArrayNode());
                qa.putNull("committeeUsage");
                qa.putArray("committeeNotes");
                ObjectNode cs = qa.putObject("committeeSummary");
                cs.put("consensus", 0);
                cs.put("solo", 0);
                cs.put("budgetCut", false);
                cs.put("note", "语义深检未开启 —— 委员会需要 LLM，本次没跑");
            }

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

    private ObjectNode assemble(QaJob job, JsonNode autopsyReport, List<String> allFiles, int matched,
                                SemanticJudge.Outcome semantic, String semanticSkip,
                                ReproService.Outcome reproOutcome) {
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

        // 语义档（M2）：跑过就如实落 findings/verdicts/usage/notes；没跑写清「为什么没跑」。
        // 三态披露纪律不变 —— 「没跑」「跑不完」「跑完没问题」是三回事，绝不含混。
        if (semantic != null) {
            rep.set("semanticFindings", semantic.findings());
            rep.set("semanticVerdicts", semantic.verdicts());
            ArrayNode notes = rep.putArray("semanticNotes");
            semantic.notes().forEach(notes::add);
            boolean anyFailedVerdict = false;
            for (JsonNode v : semantic.verdicts()) {
                if ("失败-格式".equals(v.path("verdict").asString(""))) {
                    anyFailedVerdict = true;
                    break;
                }
            }
            boolean ranAnything = semantic.verdicts().size() > 0;
            String status = !ranAnything ? "failed"
                    : (semantic.budgetCut() || anyFailedVerdict || !semantic.notes().isEmpty()) ? "partial"
                    : "ok";
            rep.put("semanticStatus", status);
            rep.put("semanticReason", statusReason(status, semantic));
            rep.set("llmUsage", semantic.usage());
        } else {
            rep.set("semanticFindings", mapper.createArrayNode());
            rep.set("semanticVerdicts", mapper.createArrayNode());
            rep.put("semanticStatus", "not-run");
            rep.put("semanticReason", semanticSkip == null
                    ? "语义深检未执行 —— 本次结论全部来自静态引擎" : semanticSkip);
            rep.putNull("llmUsage");
        }

        List<JsonNode> presented = new ArrayList<>();
        presented.addAll(toList(findings.path("p0")));
        presented.addAll(toList(findings.path("p1")));
        presented.addAll(toList(findings.path("other")));

        rep.set("recommendations", buildRecommendations(presented));
        rep.set("testSuggestions", buildTestSuggestions(allFiles, presented, semantic, reproOutcome));

        // ── C1：语义 finding 的两档 ──
        // 「有复现」= 我真的跑红了；其余一律「待确认」。
        // ⚠ 这一段**只做分流，不改 P0/P1 分档**：语义 finding 本来就不进 P0（有 confidence 纪律），
        //   实锤是把它从「待确认」提到「有复现」，不是把它塞进静态 P0 —— 那是另一条判据的事。
        ArrayNode proven = mapper.createArrayNode();
        ArrayNode unconfirmed = mapper.createArrayNode();
        int notReproduced = 0;
        int invalidDraft = 0;
        int notRun = 0;
        int stable = 0;
        int flaky = 0;
        int insufficient = 0;
        if (semantic != null) {
            for (JsonNode f : semantic.findings()) {
                String v = f.path("repro").path("verdict").asString("");
                if (ReproVerdict.REPRODUCED.equals(v)) {
                    proven.add(f);
                    String st = f.path("repro").path("stability").asString("");
                    if (ReproVerdict.STABILITY_STABLE.equals(st)) {
                        stable++;
                    } else if (ReproVerdict.STABILITY_FLAKY.equals(st)) {
                        flaky++;
                    } else {
                        insufficient++;
                    }
                } else {
                    unconfirmed.add(f);
                    if (ReproVerdict.NOT_REPRODUCED.equals(v)) {
                        notReproduced++;
                    } else if (ReproVerdict.INVALID.equals(v)) {
                        invalidDraft++;
                    } else if (ReproVerdict.NOT_RUN.equals(v)) {
                        notRun++;
                    }
                }
            }
        }
        rep.set("provenSemanticFindings", proven);
        rep.set("unconfirmedSemanticFindings", unconfirmed);
        ObjectNode tiers = rep.putObject("reproTiers");
        tiers.put("proven", proven.size());
        tiers.put("notReproduced", notReproduced);
        tiers.put("invalidTest", invalidDraft);
        tiers.put("notRun", notRun);
        // 稳定性**不参与两档分流**，只做标注：偶发复现仍然是实锤（并发类缺陷天生低复现率，
        // 若因为「不稳定」降级，它们就永远进不了实锤档，也就永远没人修）。
        ObjectNode stab = tiers.putObject("stability");
        stab.put("stable", stable);
        stab.put("flaky", flaky);
        stab.put("insufficientSamples", insufficient);
        stab.put("minSamples", ReproVerdict.MIN_SAMPLES_FOR_STABILITY);
        if (reproOutcome == null) {
            rep.put("reproStatus", "not-run");
            rep.put("reproReason", semantic == null
                    ? "语义层没跑，复现实锤无从谈起 —— 这不是「没复现」"
                    : "语义深检未开启，复现实锤未执行");
            rep.putNull("reproUsage");
        } else {
            boolean anyRan = reproOutcome.attempted() > 0 && reproOutcome.proven() + notReproduced
                    + invalidDraft + notRun > 0;
            rep.put("reproStatus", !anyRan ? "not-run" : reproOutcome.proven() > 0 ? "ok" : "partial");
            StringBuilder why = new StringBuilder();
            why.append("尝试实锤 ").append(reproOutcome.attempted()).append(" 条，")
                    .append("实锤 ").append(reproOutcome.proven()).append(" 条，")
                    .append("复现失败 ").append(notReproduced).append(" 条，")
                    .append("测试无效 ").append(invalidDraft).append(" 条，")
                    .append("没跑起来 ").append(notRun).append(" 条");
            if (reproOutcome.budgetCut()) {
                why.append("；已达本 job 的复现条数上限，余下未实锤");
            }
            rep.put("reproReason", why.toString());
            rep.set("reproUsage", reproOutcome.usage());
            ArrayNode rn = rep.putArray("reproNotes");
            reproOutcome.notes().forEach(rn::add);
        }

        rep.set("skipped", coverage.path("skipped"));
        rep.set("undecidability", coverage.path("undecidability"));

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

    // ── 语义层（M2）：规则选取 + 送检范围 + 状态口径 ──

    /** 最强的自动化层级是 llm 的活跃规则 —— regex/ast 层能判的绝不浪费 token。 */
    private List<Rule> llmRules() {
        return index.active().stream()
                .filter(r -> "llm".equals(r.checkOrEmpty().layer()))
                .toList();
    }

    /** 送检文件 = 本次 scope 内的相对路径（full 全量，review/focus 只圈内；judge 再按扩展名筛）。 */
    private List<String> semanticTargets(QaJob job, List<String> allFiles) {
        if (job.range().isFull()) {
            return allFiles;
        }
        return allFiles.stream().filter(job.range()::matches).toList();
    }

    private static String statusReason(String status, SemanticJudge.Outcome o) {
        if ("failed".equals(status)) {
            return "语义层未能产出任何判定 —— 原因见 semanticNotes";
        }
        if (o.budgetCut()) {
            return "语义层已执行，但撞到本 job 的 LLM 批数上限被截断 —— 余下规则未判定（见 llmUsage.budgetCut）";
        }
        if ("partial".equals(status)) {
            return "语义层部分完成：含判定失败批或被截断的候选 —— 逐项见 semanticNotes / semanticVerdicts";
        }
        return "语义层已执行完毕";
    }

    /** LLM 配置状态（/api/qa/llm-status）：只回状态与模型名，绝不回 key。 */
    public JsonNode llmStatus() {
        return llm.statusNode();
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
    //
    // ★ 2026-10-14：draftCases 从 putNull 占位变成真实内容（计划书点名的旧债）。
    //   那个空字段一直显示成「有建议但没有用例」，读起来像「用例已经有了只是没展示」。
    //   现在它挂的是 ReproService 真跑出来的产物 —— 编译过的测试源码、判据、复现率、失败堆栈；
    //   跑不出来时是 status=not-run + 原因，不再是一个假装有值的空字段。

    private ArrayNode buildTestSuggestions(List<String> files, List<JsonNode> findings,
                                           SemanticJudge.Outcome semantic, ReproService.Outcome outcome) {
        // 按目标文件把**已实锤**的复现产物索引起来 —— 建议行按 target 挂自己的用例
        Map<String, List<JsonNode>> reproByFile = new LinkedHashMap<>();
        if (semantic != null) {
            for (JsonNode f : semantic.findings()) {
                if (ReproVerdict.REPRODUCED.equals(f.path("repro").path("verdict").asString(""))) {
                    reproByFile.computeIfAbsent(f.path("file").asString(""), k -> new ArrayList<>()).add(f);
                }
            }
        }
        int attempted = outcome == null ? 0 : outcome.attempted();

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
            g.set("draftCases", reproCases("（全仓）", reproByFile, attempted, outcome));
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
            o.set("draftCases", reproCases(f, reproByFile, attempted, outcome));
        }
        if (mainJava >= MAX_TEST_SUGGESTIONS) {
            ObjectNode note = arr.addObject();
            note.put("note", "建议数已达上限 " + MAX_TEST_SUGGESTIONS + "，按违规命中密度排序截断");
        }
        return arr;
    }

    /**
     * 一条建议挂的复现用例。
     *
     * <p>形状刻意是 {@code {status, cases[]}} 而不是裸数组：这样「有建议但一条都没实锤」
     * 与「实锤了 3 条」在报告里是两种能一眼分开的形状，而不是都变成空数组 ——
     * 空数组在 JSON 里长得和「没跑」一模一样。
     */
    private ObjectNode reproCases(String target, Map<String, List<JsonNode>> byFile,
                                  int attempted, ReproService.Outcome outcome) {
        ObjectNode n = mapper.createObjectNode();
        List<JsonNode> found = byFile.getOrDefault(target, List.of());
        if (!found.isEmpty()) {
            n.put("status", "proven");
            n.put("reason", "这个目标上已经有跑红的复现测试 —— 建议直接拿它当回归用例");
            ArrayNode cases = n.putArray("cases");
            for (JsonNode f : found) {
                ObjectNode c = cases.addObject();
                JsonNode r = f.path("repro");
                c.put("ruleId", f.path("ruleId").asString(""));
                c.put("line", f.path("line").asInt(0));
                c.put("testClass", r.path("testClass").asString(""));
                c.put("source", r.path("testSource").asString(""));
                c.put("verdict", ReproVerdict.REPRODUCED);
                if (r.has("rate")) {
                    c.put("rate", r.path("rate").asDouble(0));
                }
                if (!r.path("failureExcerpt").asString("").isBlank()) {
                    c.put("failureExcerpt", r.path("failureExcerpt").asString(""));
                }
            }
            return n;
        }
        if (attempted == 0 || outcome == null) {
            n.put("status", "not-run");
            n.put("reason", "复现实锤没跑（LLM 未配置 / 语义深检未开启 / 本 job 关掉了实锤）—— "
                    + "这是「没跑」，不是「跑过但没问题」");
            n.putArray("cases");
            return n;
        }
        n.put("status", "no-repro");
        n.put("reason", "这个目标上没能实锤任何一条：可能是测试写不出来、复现全绿、或测试本身无效"
                + " —— 三者在 reproNotes 里逐条分开写了，不合并成一句「验证过」");
        n.putArray("cases");
        return n;
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
