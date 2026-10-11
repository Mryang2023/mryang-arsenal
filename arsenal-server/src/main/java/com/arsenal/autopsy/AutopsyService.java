package com.arsenal.autopsy;

import com.arsenal.domain.Rule;
import com.arsenal.domain.Severity;
import com.arsenal.engine.LintEngine;
import com.arsenal.engine.LintReport;
import com.arsenal.engine.LintRequest;
import com.arsenal.engine.SourceFile;
import com.arsenal.engine.Violation;
import com.arsenal.loader.RuleIndex;
import com.arsenal.scan.ProjectScanner;
import com.arsenal.scan.ScanGuard;
import com.arsenal.scan.SourceResolver;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 体检：一个项目目录 → 一份三档报告（P0 必修 / P1 该改 / 观察项）+ 覆盖率。
 *
 * <p><b>复用，不重造。</b>P0/P1 来自现有的 {@link LintEngine}（69 条规则，与 /api/lint 同一台引擎），
 * 事实来自 {@link ProjectScanner}（与 /api/scan/facts 同一台扫描器）。本类只做三件新事：
 * <ol>
 *   <li>把「本地目录 / git」这两种输入喂给 LintEngine —— 它原本只吃上传的源码；</li>
 *   <li>把 LintEngine 的**覆盖率**显式算出来并原样带出去（rulePool vs executableRules）；</li>
 *   <li>跑观察项解释器（判据是数据，见 {@link CheckupEvaluator}）。</li>
 * </ol>
 *
 * <p><b>「没检查」与「检查通过」必须分开。</b>AST 层只能覆盖 69 条里的一部分，
 * 剩下那些既不是通过也不是违规 —— 它们进 {@code coverage.skipped}，报告必须显示条数。
 * 少报这一句，读者就会把「0 违规」读成「合规」。
 */
@Component
public class AutopsyService {

    private static final Logger log = LoggerFactory.getLogger(AutopsyService.class);

    /** 体检只读这几类文件：Java 是 AST 层的输入，配置几类是正则层规则的靶子。 */
    private static final Set<String> EXTS = Set.of("java", "xml", "yml", "yaml", "properties");

    /**
     * 违规片段要脱敏：{@code snippet} 是**原始源码行**，而本棒专挑 {@code yml / properties} 进来扫 ——
     * 也就是说「配置里写着真密码的那一行」完全可能成为某条违规的证据行。
     * 报告是要留档、要导出的，密码一旦进去就收不回来（扫描层 {@code ScanGuard.redact} 管的是
     * 配置项取值，管不到整行源码，所以这里补一道）。
     */
    private static final java.util.regex.Pattern CREDENTIAL = java.util.regex.Pattern.compile(
            "(?i)(password|passwd|secret|token|api[-_]?key|access[-_]?key|private[-_]?key)(\\s*[:=]\\s*)(\\S+)");

    /** 单档最多回报多少条。超出截断并**明说截断了** —— 静默截断等于改结论。 */
    private static final int MAX_ITEMS_PER_TIER = 200;

    private final ProjectScanner scanner;
    private final LintEngine lint;
    private final RuleIndex index;
    private final ObjectMapper mapper;
    private final CheckupEvaluator evaluator;
    private final CheckupLoader.Loaded checkups;

    private final int maxFiles;
    private final long maxTotalBytes;
    private final long batchBudget;

    public AutopsyService(ProjectScanner scanner, LintEngine lint, RuleIndex index, ObjectMapper mapper,
                          @Value("${arsenal.checkups.file:../arsenal-checkups/checkups.json}") String checkupsFile,
                          @Value("${arsenal.lint.max-scan-bytes:2097152}") long batchBudget,
                          @Value("${arsenal.autopsy.max-files:600}") int maxFiles,
                          @Value("${arsenal.autopsy.max-total-bytes:6291456}") long maxTotalBytes) {
        this.scanner = scanner;
        this.lint = lint;
        this.index = index;
        this.mapper = mapper;
        this.batchBudget = Math.max(1, batchBudget);
        this.maxFiles = Math.max(1, maxFiles);
        this.maxTotalBytes = Math.max(this.batchBudget, maxTotalBytes);
        this.checkups = CheckupLoader.load(checkupsFile, mapper);
        this.evaluator = new CheckupEvaluator(this.checkups.rules());
        if (!this.checkups.available()) {
            log.warn("观察项事实源不可用：{}", this.checkups.reason());
        }
    }

    public ObjectNode inspect(SourceResolver source) {
        long start = System.currentTimeMillis();
        try (source) {
            // ① 先把源码读进内存：git / zip 的临时目录在 scanner.scan 里会被清掉，
            //    「先扫事实再读文件」会读到空气。
            Collected collected = collect(source.root());
            List<SourceFile> files = collected.files();
            // ★ 两条截断路径都要算：文件数上限 **和** 总字节上限。
            //   原先这里只看了文件数，字节撑爆时 truncated 仍是 false ——
            //   报告会说「扫完了」，实际后半截根本没进引擎。
            //   （文件数那条用 >= 是因为 walk 到 maxFiles 就停，不可能超过，
            //     恰好等于上限时就是踩在刀口上；字节那条由 capped 直接给。）
            boolean truncated = collected.capped();
            long bytes = files.stream().mapToLong(SourceFile::byteSize).sum();

            JsonNode facts = scanner.scan(source);

            // ② 分批喂给 LintEngine：它的 2MB 上限是为「上传源码」设的护栏，
            //    这里要扫整个项目，只能分批，**不去改那条护栏**（改了就等于给 /api/lint 也松绑）。
            List<LintReport> reports = new ArrayList<>();
            List<SourceFile> batch = new ArrayList<>();
            long batchBytes = 0;
            for (SourceFile f : files) {
                int size = f.byteSize();
                if (size > batchBudget) {
                    continue; // 单文件超过一批的预算 —— 跳过它，不为此放宽护栏
                }
                if (!batch.isEmpty() && batchBytes + size > batchBudget) {
                    reports.add(lint.lint(new LintRequest(batch)));
                    batch = new ArrayList<>();
                    batchBytes = 0;
                }
                batch.add(f);
                batchBytes += size;
            }
            if (!batch.isEmpty()) {
                reports.add(lint.lint(new LintRequest(batch)));
            }
            if (reports.isEmpty()) {
                reports.add(lint.lint(new LintRequest(List.of())));
            }

            ObjectNode out = mapper.createObjectNode();
            out.put("schemaVersion", 1);
            out.put("root", source.rootName());
            out.put("sourceKind", source.kind());
            out.put("elapsedMs", System.currentTimeMillis() - start);
            out.set("scope", scopeNode(files.size(), bytes, truncated, source));
            out.set("coverage", coverageNode(reports));
            out.set("p0", tierNode(reports, true));
            out.set("p1", tierNode(reports, false));
            out.set("other", otherNode(reports));
            out.set("obs", observationNode(facts));
            return out;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 文件收集
    // ─────────────────────────────────────────────────────────────

    /**
     * 收集待检文件。安全口径与 {@link ProjectScanner#scan} 完全一致：
     * 跳过大目录、每个文件都要过「真实路径在根内」（软链外跳在这里被拦下）、
     * 规模与时间有硬上限。
     *
     * <p>名字是相对路径且用 {@code /} —— LintEngine 拿它去匹配规则的 targetGlob，
     * 写成绝对路径的话 {@code src/main/java/...} 这类 glob 一条都匹配不上。
     */
    /** 收集结果。**capped 是截断信号** —— 它与「文件列表」一样是结论的一部分。 */
    private record Collected(List<SourceFile> files, boolean capped) {
    }

    private Collected collect(Path root) {
        List<SourceFile> out = new ArrayList<>();
        long[] total = {0};
        boolean[] capped = {false};
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
                    if (capped[0] || out.size() >= maxFiles) {
                        capped[0] = true;
                        return FileVisitResult.CONTINUE;
                    }
                    String name = file.getFileName().toString();
                    if (!readable(name) || !ScanGuard.isInside(root, file)) {
                        return FileVisitResult.CONTINUE;
                    }
                    if (attrs.size() > ScanGuard.MAX_FILE_BYTES) {
                        return FileVisitResult.CONTINUE;
                    }
                    String text;
                    try {
                        text = Files.readString(file, StandardCharsets.UTF_8);
                    } catch (IOException e) {
                        return FileVisitResult.CONTINUE; // 读不了的跳过，不因此中断整次体检
                    }
                    int size = text.getBytes(StandardCharsets.UTF_8).length;
                    if (total[0] + size > maxTotalBytes) {
                        capped[0] = true;
                        return FileVisitResult.TERMINATE;
                    }
                    total[0] += size;
                    out.add(new SourceFile(root.relativize(file).toString().replace('\\', '/'), text));
                    return FileVisitResult.CONTINUE;
                }
            });
        } catch (IOException e) {
            throw new IllegalArgumentException("读取项目目录失败：" + e.getMessage());
        }
        out.sort(Comparator.comparing(SourceFile::name));
        // 文件数那条截断：walk 在 out.size() >= maxFiles 时就停，正好等于上限也算踩线
        return new Collected(List.copyOf(out), capped[0] || out.size() >= maxFiles);
    }

    private static boolean readable(String fileName) {
        int dot = fileName.lastIndexOf('.');
        if (dot < 0) {
            return false;
        }
        String ext = fileName.substring(dot + 1).toLowerCase(Locale.ROOT);
        return EXTS.contains(ext) && ScanGuard.readable(fileName);
    }

    private ObjectNode scopeNode(int fileCount, long bytes, boolean truncated, SourceResolver source) {
        ObjectNode n = mapper.createObjectNode();
        n.put("files", fileCount);
        n.put("bytes", bytes);
        n.put("truncated", truncated);
        // ★ 只给目录名不给绝对路径 —— 事实 JSON 会被留档、会进快照，
        //   绝对路径既泄隐私又不可复现（本仓既有口径，见 SourceResolver#rootName）
        n.put("rootName", source.rootName());
        n.put("maxFiles", maxFiles);
        n.put("maxTotalBytes", maxTotalBytes);
        return n;
    }

    // ─────────────────────────────────────────────────────────────
    // 覆盖率 —— 本棒的诚实核心
    // ─────────────────────────────────────────────────────────────

    /**
     * 覆盖率：{@code rulePool} 是规则池总数（69），{@code executed} 是这次真跑过的条数，
     * 差值 {@code notRun} 是**没结论**的条数。
     *
     * <p>为什么必须带分母：只报「P0: 12 条」的页面，读者无法区分「这条没命中」与
     * 「这条压根没检查」。本仓 2026-10-04 在 {@code charterNotExecutableCount} 上
     * 踩过一模一样的坑（漏了前缀导致显示 34 而章程只有 2 条）。
     */
    private ObjectNode coverageNode(List<LintReport> reports) {
        LintReport first = reports.get(0);
        int pool = first.rulePool();
        int executed = 0;
        boolean decidable = true;
        for (LintReport r : reports) {
            executed = Math.max(executed, r.executableRules());
            decidable = decidable && r.decidable();
        }
        // 严重度分布与档位规模**从规则池现数**，不写死 37/13/18
        Map<String, Integer> bySeverity = new LinkedHashMap<>();
        for (Severity s : Severity.values()) {
            bySeverity.put(s.code(), 0);
        }
        int p0Pool = 0;
        int p1Pool = 0;
        int otherPool = 0;
        for (Rule r : index.active()) {
            bySeverity.merge(r.severity().code(), 1, Integer::sum);
            if (r.severity() == Severity.MAY) {
                otherPool++;
            } else if (r.severity().blocking()) {
                p0Pool++;
            } else {
                p1Pool++;
            }
        }

        ObjectNode n = mapper.createObjectNode();
        n.put("total", pool);
        n.put("executed", executed);
        n.put("notRun", Math.max(0, pool - executed));
        n.put("batches", reports.size());
        n.put("decidable", decidable);

        ObjectNode severity = (ObjectNode) n.putObject("severityPool");
        for (Map.Entry<String, Integer> e : bySeverity.entrySet()) {
            severity.put(e.getKey(), e.getValue());
        }
        ObjectNode tiers = (ObjectNode) n.putObject("tierPool");
        tiers.put("p0", p0Pool);
        tiers.put("p1", p1Pool);
        tiers.put("other", otherPool);

        ArrayNode skipped = n.putArray("skipped");
        // skipped 只取决于规则池，与文件无关 —— 所以取第一批的那份即可（逐批都一样）
        for (var s : first.skipped()) {
            ObjectNode o = skipped.addObject();
            o.put("ruleId", s.ruleId());
            o.put("title", s.title());
            o.put("severity", s.severity() == null ? "" : s.severity().code());
            o.put("category", s.category());
            o.put("layer", s.layer());
            o.put("reason", s.reason());
        }

        ArrayNode failures = n.putArray("parseFailures");
        int shown = 0;
        for (LintReport r : reports) {
            for (var p : r.unparsed()) {
                if (shown++ >= 20) break;
                ObjectNode o = failures.addObject();
                o.put("file", p.file());
                o.put("line", p.line());
                o.put("status", p.status());
                o.put("message", p.message());
            }
        }
        ArrayNode why = n.putArray("undecidability");
        for (LintReport r : reports) {
            for (String s : r.undecidability()) {
                why.add(s);
            }
        }
        // ★ 0 也是结论：这个字段让前端不必猜「是没跑还是全跑了」
        n.put("skippedCount", first.skipped().size());
        return n;
    }

    // ─────────────────────────────────────────────────────────────
    // 三档
    // ─────────────────────────────────────────────────────────────

    /** P0（MUST+NEVER，{@link Severity#blocking()}）/ P1（SHOULD）。分级读枚举不写死。 */
    private ArrayNode tierNode(List<LintReport> reports, boolean blocking) {
        ArrayNode arr = mapper.createArrayNode();
        int shown = 0;
        for (LintReport r : reports) {
            for (Violation v : r.violations()) {
                Severity sev = v.severity() == null ? Severity.SHOULD : v.severity();
                if (sev.blocking() != blocking || sev == Severity.MAY) {
                    continue;
                }
                if (shown++ >= MAX_ITEMS_PER_TIER) {
                    continue;
                }
                arr.add(violationNode(v, sev));
            }
        }
        return arr;
    }

    /** MAY 档：不评分、不判负，但**不许静默丢弃** —— 丢了的违规没人知道它存在过。 */
    private ArrayNode otherNode(List<LintReport> reports) {
        ArrayNode arr = mapper.createArrayNode();
        int shown = 0;
        for (LintReport r : reports) {
            for (Violation v : r.violations()) {
                Severity sev = v.severity() == null ? Severity.SHOULD : v.severity();
                if (sev != Severity.MAY) {
                    continue;
                }
                if (shown++ >= MAX_ITEMS_PER_TIER) {
                    continue;
                }
                arr.add(violationNode(v, sev));
            }
        }
        return arr;
    }

    private ObjectNode violationNode(Violation v, Severity sev) {
        ObjectNode o = mapper.createObjectNode();
        o.put("ruleId", v.ruleId());
        o.put("title", v.title());
        o.put("severity", sev.code());
        o.put("category", v.category());
        o.put("file", v.file());
        o.put("line", v.line());
        o.put("column", v.column());
        o.put("snippet", safeSnippet(v.snippet()));
        o.put("message", v.message());
        o.put("collapsed", v.collapsed());
        o.put("evidence", v.file() + ":" + v.line());
        return o;
    }

    /** 把片段里「键 = 值」的值换成 {@code ***}。键名口径与 {@code ScanGuard.isSensitive} 同源。 */
    static String safeSnippet(String snippet) {
        if (snippet == null || snippet.isEmpty()) {
            return "";
        }
        return CREDENTIAL.matcher(snippet).replaceAll(m -> m.group(1) + m.group(2) + "***");
    }

    // ─────────────────────────────────────────────────────────────
    // 观察项
    // ─────────────────────────────────────────────────────────────

    /**
     * 观察项：判据来自 {@code arsenal-checkups/checkups.json}，这里只调解释器。
     *
     * <p>三件事都要出去：触发的、算不出来的、以及**事实源本身在不在**。
     * 第三件最容易漏 —— 事实源读不到时观察项一档会是空的，
     * 而「没有要提示的」与「压根没配」在页面上长得一模一样。
     */
    private ObjectNode observationNode(JsonNode facts) {
        ObjectNode n = mapper.createObjectNode();
        n.put("available", checkups.available());
        // ★ 只给文件名不给绝对路径 —— 报告会被留档、会进快照、会导出给别人看，
        //   服务器上的目录布局不属于这份报告要说的东西（且与 scope.rootName 口径一致）
        n.put("source", checkups.file() == null ? "" : Path.of(checkups.file()).getFileName().toString());
        n.put("ruleCount", evaluator.ruleCount());
        if (!checkups.available()) {
            n.put("reason", checkups.reason());
            n.putArray("items");
            n.putArray("unevaluated");
            return n;
        }
        CheckupEvaluator.Outcome outcome = evaluator.evaluate(facts);
        ArrayNode items = n.putArray("items");
        for (CheckupEvaluator.Finding f : outcome.fired()) {
            ObjectNode o = items.addObject();
            o.put("id", f.id());
            o.put("level", f.level());
            o.put("text", f.text());
            o.put("advice", f.advice());
            o.put("actual", f.actual());
            ArrayNode ev = o.putArray("evidence");
            for (CheckupEvaluator.Evidence e : f.evidence()) {
                ev.add(e.render());
            }
        }
        ArrayNode unevaluated = n.putArray("unevaluated");
        for (CheckupEvaluator.Unevaluated u : outcome.unevaluated()) {
            ObjectNode o = unevaluated.addObject();
            o.put("id", u.id());
            o.put("fact", u.fact());
            o.put("op", u.op());
            o.put("reason", u.reason());
        }
        // ★ 三个数字都出去：分母（ruleCount）、触发数、算不出来数
        n.put("firedCount", outcome.fired().size());
        n.put("unevaluatedCount", outcome.unevaluated().size());
        return n;
    }
}
