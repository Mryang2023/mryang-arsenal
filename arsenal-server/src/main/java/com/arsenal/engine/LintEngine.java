package com.arsenal.engine;

import com.arsenal.domain.Rule;
import com.arsenal.domain.Severity;
import com.arsenal.loader.RuleIndex;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.regex.PatternSyntaxException;

/**
 * Level 1 校验引擎（文本层 + 语法树层）。
 *
 * 执行两层：check.regex（文本正则，零成本、可离线、确定性最强）与
 * check.ast 中「语法层高置信」的子集（由 AstEngine 用 jdk.compiler 跑，零新增依赖）。
 * 其余 —— ast 中需类型解析/跨文件符号表的部分、llm、manual —— 不在这里伪造判定，
 * 一律进 skipped 如实披露。
 *
 * 为什么坚持「不伪造」：一个假阳性会让人开始怀疑整个报告，
 * 一旦开始怀疑，工具就死了。宁可老实说「这条我检不了」。
 */
@Component
public class LintEngine {

    private static final Logger log = LoggerFactory.getLogger(LintEngine.class);

    private static final int SNIPPET_MAX = 140;
    private static final int MAX_HITS_PER_RULE_PER_FILE = 200;

    private final RuleIndex index;
    private final AstEngine astEngine;
    private final int maxPerRule;
    private final long maxScanBytes;

    public LintEngine(RuleIndex index, AstEngine astEngine,
                      @Value("${arsenal.lint.max-violations-per-rule:5}") int maxPerRule,
                      @Value("${arsenal.lint.max-scan-bytes:2097152}") long maxScanBytes) {
        this.index = index;
        this.astEngine = astEngine;
        this.maxPerRule = Math.max(1, maxPerRule);
        this.maxScanBytes = maxScanBytes;
    }

    /** 已编译的规则。启动后每次请求复用编译结果，避免重复 compile。 */
    private record Compiled(Rule rule, Pattern body, GlobMatcher fileMatcher, boolean expectPresent) {
    }

    /**
     * AST 规则的编译结果：appliesTo.pathGlob → {@link GlobMatcher}。
     *
     * <p>正则层早就用 targetGlob 筛文件，AST 层却对 pathGlob 视而不见 ——
     * 声明了 service/controller 目录的规则照样在任意 .java 上触发（README「未完成表」里的
     * 「AST 路由收口」）。现在 AST 层与正则层共用同一套 glob 语义：
     * 声明了 pathGlob → 仅匹配路径执行；未声明 → compile 兜底成 {@code **&#47;*}，
     * 即全 .java 执行，行为与收口前完全一致。
     */
    private record AstCompiled(Rule rule, GlobMatcher pathMatcher) {
    }

    public LintReport lint(LintRequest request) {
        long start = System.nanoTime();

        List<SourceFile> files = request.files();
        long totalBytes = files.stream().mapToLong(SourceFile::byteSize).sum();
        if (totalBytes > maxScanBytes) {
            throw new IllegalArgumentException(
                    "提交内容共 " + totalBytes + " 字节，超出单次扫描上限 " + maxScanBytes + " 字节，请拆分后重试");
        }

        List<Rule> active = index.active();
        List<Compiled> compiled = new ArrayList<>();
        List<AstCompiled> astRules = new ArrayList<>();
        List<SkippedRule> skipped = new ArrayList<>();

        // ── 1. 编译 ─────────────────────────────────────
        for (Rule r : active) {
            Rule.Check c = r.checkOrEmpty();
            if (c.hasRegex()) {
                Rule.RegexCheck rc = c.regex();
                try {
                    Pattern p = Pattern.compile(rc.pattern(), flagsOf(rc.flags()));
                    compiled.add(new Compiled(r, p, GlobMatcher.compile(rc.globOrDefault()), rc.expectPresent()));
                } catch (PatternSyntaxException e) {
                    skipped.add(new SkippedRule(r.id(), r.title(), r.severity(), r.category(), "regex",
                            "规则自身的正则无法编译（这是规则缺陷，请修复）：" + e.getDescription()));
                    log.warn("规则 {} 的正则无法编译：{}", r.id(), e.getDescription());
                }
            } else if (c.hasAst() && astEngine.hasChecker(r.id())) {
                // AST 语法层有对应检查器 —— 交给 AstEngine 在扫描阶段执行。
                // appliesTo 可为 null（规则没写 appliesTo 段），此时按「未声明」处理。
                String pathGlob = r.appliesTo() == null ? null : r.appliesTo().pathGlob();
                astRules.add(new AstCompiled(r, GlobMatcher.compile(pathGlob)));
            } else {
                skipped.add(new SkippedRule(r.id(), r.title(), r.severity(), r.category(),
                        c.layer(), reasonFor(c)));
            }
        }

        // ── 2. 扫描 ─────────────────────────────────────
        List<Violation> violations = new ArrayList<>();
        Map<String, Set<String>> ruleFileHits = new LinkedHashMap<>();
        int totalLines = 0;
        int matchedFiles = 0;
        int notApplicable = 0;

        // AST 层的执行账本 —— 这三样过去都不存在，正是「假 100 分」的来源
        List<ParseFailure> unparsed = new ArrayList<>();
        List<String> astRuleIds = astRules.stream().map(a -> a.rule().id()).toList();
        Set<String> astEvaluatedRuleIds = new LinkedHashSet<>();
        int javaFiles = 0;
        int nonJavaFiles = 0;
        int parsedJavaFiles = 0;
        int failedJavaFiles = 0;
        boolean compilerMissing = false;

        for (SourceFile file : files) {
            String name = GlobMatcher.normalize(file.name());
            String text = file.content();
            totalLines += file.lineCount();
            int[] newlines = newlineIndex(text);
            boolean touched = false;

            for (Compiled c : compiled) {
                if (!c.fileMatcher().matches(name)) {
                    notApplicable++;
                    continue;
                }
                touched = true;

                List<int[]> hits = collect(c.body(), text);
                boolean isViolation = c.expectPresent() ? hits.isEmpty() : !hits.isEmpty();
                if (!isViolation) {
                    continue;
                }

                // 同一行只报一次 —— 重复命中是噪音，不是更多信息
                Set<Integer> seenLines = new LinkedHashSet<>();
                List<Violation> picked = new ArrayList<>();

                for (int[] h : hits) {
                    int idx = h[0];
                    int line = lineOf(newlines, idx);
                    if (!seenLines.add(line)) {
                        continue;
                    }
                    if (picked.size() >= maxPerRule) {
                        continue;
                    }
                    picked.add(new Violation(
                            c.rule().id(), c.rule().title(), c.rule().severity(), c.rule().category(),
                            name, line, columnOf(newlines, idx), snippet(text, idx, h[1]),
                            "命中禁止写法", c.rule().promptFragment(), 0));
                }

                if (picked.isEmpty() && c.expectPresent()) {
                    picked.add(new Violation(
                            c.rule().id(), c.rule().title(), c.rule().severity(), c.rule().category(),
                            name, 1, 1, "未找到必需内容：" + c.rule().title(),
                            "缺少必需写法", c.rule().promptFragment(), 0));
                }

                violations.addAll(picked);

                int collapsed = Math.max(0, seenLines.size() - picked.size());
                if (collapsed > 0 && !picked.isEmpty()) {
                    int last = violations.size() - 1;
                    violations.set(last, violations.get(last).withCollapsed(collapsed));
                }

                ruleFileHits.computeIfAbsent(c.rule().id(), k -> new LinkedHashSet<>()).add(name);
            }

            // ── 2b. AST 层（语法树）── 仅对 Java 源执行，解析一次跑完全部检查器
            //
            // 「没跑成」必须留下痕迹：解析失败时生成显式的 ParseFailure 条目，
            // 并且**不把这条规则算进 executableRules**（它确实没执行）。
            // 绝不能像过去那样返回空 map 就完事 —— 那等于把「没结论」报成「零违规」。
            if (!astRules.isEmpty()) {
                if (!name.endsWith(".java")) {
                    // 非 Java 文件：AST 层不适用，但整层是否跑成要等收尾时统一判定
                    nonJavaFiles++;
                } else {
                    touched = true;
                    javaFiles++;
                    // pathGlob 收口：只把声明路径内的规则交给本文件；声明外的
                    // （file × rule）组合与正则层同口径计入 notApplicable。
                    // 解析照旧对每个 .java 执行 —— 「这个文件没有任何适用规则」与
                    // 「解析失败」是两回事，账本（parsedJavaFiles / 账目）不能因此变形。
                    List<Rule> applicable = new ArrayList<>();
                    for (AstCompiled a : astRules) {
                        if (a.pathMatcher().matches(name)) {
                            applicable.add(a.rule());
                        } else {
                            notApplicable++;
                        }
                    }
                    AstEngine.FileScan scan = astEngine.lintFile(applicable, name, text);
                    if (scan.parse().ok()) {
                        parsedJavaFiles++;
                        astEvaluatedRuleIds.addAll(astRuleIds);
                        for (Map.Entry<String, List<AstEngine.Finding>> e : scan.hits().entrySet()) {
                            Rule ar = index.byId(e.getKey()).orElse(null);
                            if (ar == null) {
                                continue;
                            }
                            int shown = 0;
                            for (AstEngine.Finding fnd : e.getValue()) {
                                if (shown++ >= maxPerRule) {
                                    break;
                                }
                                violations.add(new Violation(
                                        ar.id(), ar.title(), ar.severity(), ar.category(),
                                        name, fnd.line(), 1, fnd.snippet(),
                                        fnd.message(), ar.promptFragment(), 0));
                            }
                            ruleFileHits.computeIfAbsent(ar.id(), k -> new LinkedHashSet<>()).add(name);
                        }
                    } else {
                        failedJavaFiles++;
                        if (scan.parse().status() == AstEngine.ParseStatus.COMPILER_MISSING) {
                            // 无编译器不是「这个文件」的问题，是一条报告级事实 —— 收尾时记一次，
                            // 否则 N 个文件就是 N 条一模一样的记录（噪音，不是信息）。
                            compilerMissing = true;
                        } else {
                            unparsed.add(parseFailureOf(name, scan.parse(), astRuleIds));
                        }
                    }
                }
            }

            if (touched) {
                matchedFiles++;
            }
        }

        // ── 3. 评分 ─────────────────────────────────────
        Map<String, Integer> perRuleCount = new LinkedHashMap<>();
        for (Violation v : violations) {
            perRuleCount.merge(v.ruleId(), 1, Integer::sum);
        }

        int penalty = 0;
        for (Map.Entry<String, Integer> e : perRuleCount.entrySet()) {
            Severity sev = index.byId(e.getKey()).map(Rule::severity).orElse(Severity.SHOULD);
            penalty += sev.penalty() + Math.min(e.getValue() - 1, 4);
        }
        int penaltyScore = Math.max(0, Math.min(100, 100 - penalty));

        // ── 4. 聚合 ─────────────────────────────────────
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (Severity s : Severity.values()) {
            counts.put(s.code(), 0);
        }
        Map<String, LintReport.CategoryHits> catMap = new LinkedHashMap<>();
        for (Violation v : violations) {
            String key = v.severity() == null ? Severity.SHOULD.code() : v.severity().code();
            counts.merge(key, 1, Integer::sum);
            catMap.merge(v.category(),
                    new LintReport.CategoryHits(v.category(), 1, v.severity()),
                    (a, b) -> new LintReport.CategoryHits(a.category(), a.count() + 1, a.severity()));
        }

        List<RuleHitSummary> byRule = perRuleCount.entrySet().stream()
                .map(e -> {
                    Rule r = index.byId(e.getKey()).orElse(null);
                    return new RuleHitSummary(
                            e.getKey(),
                            r == null ? "" : r.title(),
                            r == null ? Severity.SHOULD : r.severity(),
                            r == null ? "" : r.category(),
                            e.getValue(),
                            ruleFileHits.getOrDefault(e.getKey(), Set.of()).size());
                })
                .sorted(Comparator
                        .comparingInt((RuleHitSummary h) -> h.severity() == null ? 0 : h.severity().penalty())
                        .reversed()
                        .thenComparing(Comparator.comparingInt(RuleHitSummary::count).reversed()))
                .toList();

        violations.sort(Comparator.comparing(Violation::file).thenComparingInt(Violation::line));

        long ms = (System.nanoTime() - start) / 1_000_000;

        // ── 5. 「没跑成」的显式披露（B-4）──────────────────
        // 整层未执行时补一条报告级记录。不做这一步，「提交一个 .ts → 拿到 100 分」这个谎就还在：
        // 那时 astRules 一条都没跑，却照样被算进 executableRules，且没有任何一行说明。
        String astStatus;
        String astNote;
        if (astRules.isEmpty()) {
            astStatus = "not_applicable";
            astNote = "本次规则池里没有可执行的 AST 规则。";
        } else if (compilerMissing) {
            astStatus = "compiler_missing";
            astNote = "当前 JVM 无 java.compiler —— 无法进行 AST 检查，"
                    + astRuleIds.size() + " 条 AST 规则未执行。";
            unparsed.add(new ParseFailure("", 0, 0, "COMPILER_MISSING",
                    "无法进行 AST 检查：当前 JVM 没有 javac（java.compiler 模块缺失）", astNote, astRuleIds));
        } else if (javaFiles == 0) {
            astStatus = "no_java_file";
            astNote = "本次没有提交任何 .java 文件（非 Java 文件 " + nonJavaFiles + " 个）—— "
                    + "AST 层未执行，" + astRuleIds.size() + " 条 AST 规则本次没有结论。";
            unparsed.add(new ParseFailure("", 0, 0, "NO_JAVA_FILE",
                    "解析失败：没有可解析的 .java 文件，AST 规则一条都没跑", astNote, astRuleIds));
        } else if (parsedJavaFiles == 0) {
            astStatus = "failed";
            astNote = "全部 " + javaFiles + " 个 .java 文件解析失败 —— 无法进行 AST 检查。";
        } else if (failedJavaFiles > 0) {
            astStatus = "partial";
            astNote = failedJavaFiles + "/" + javaFiles + " 个 .java 文件解析失败，"
                    + "AST 结论只覆盖解析成功的 " + parsedJavaFiles + " 个文件。";
        } else {
            astStatus = "executed";
            astNote = "AST 层已对 " + parsedJavaFiles + " 个 .java 文件执行完毕。";
        }

        // 只有「一个文件都没解析成功」时才是整层未执行；partial 的细节由 per-file 的 unparsed 条目承担，
        // 那时把 7 条全列成「未执行」是夸大。
        boolean wholeLayerRan = parsedJavaFiles > 0 || astRules.isEmpty();
        List<String> astUnevaluated = wholeLayerRan ? List.of() : astRuleIds;
        AstLayer ast = new AstLayer(astStatus, astRuleIds.size(), javaFiles,
                parsedJavaFiles, failedJavaFiles, astUnevaluated, astNote);

        // 不可判定 = 有人本来会跑、却没跑成。此时**不给数字**：给 100 是谎，给别的数也是谎。
        boolean decidable = ast.conclusive() && unparsed.isEmpty();
        List<String> undecidability = new ArrayList<>();
        if (!decidable) {
            undecidability.add(astNote);
            if (!unparsed.isEmpty()) {
                undecidability.add("存在 " + unparsed.size() + " 条「本次没跑成」记录，"
                        + "受影响的 AST 规则 " + astRuleIds.size() + " 条 —— 本次不给出合规结论。");
            }
        }
        Integer score = decidable ? penaltyScore : null;
        String grade = decidable ? grade(penaltyScore) : "不可判定";

        return new LintReport(
                files.size(), totalLines, active.size(), compiled.size() + astEvaluatedRuleIds.size(),
                matchedFiles, notApplicable,
                violations, skipped, unparsed,
                score, grade, counts,
                new ArrayList<>(catMap.values()), byRule, ms,
                ast, decidable, undecidability);
    }

    /** 把一次解析失败转成报告里的显式条目（含「解析失败」字样，并点名因此没跑到的规则）。 */
    private ParseFailure parseFailureOf(String file, AstEngine.ParseResult parse, List<String> ruleIds) {
        List<AstEngine.ParseError> errors = parse.errors();
        String why = switch (parse.status()) {
            case COMPILER_MISSING -> "无法进行 AST 检查（当前 JVM 无 java.compiler）";
            case SYNTAX_ERROR -> "解析失败：语法不完整";
            case OK -> "解析成功";
        };
        AstEngine.ParseError first = errors.isEmpty() ? null : errors.get(0);
        String firstText = first == null ? parse.detail() : first.describe();
        String detail = first == null
                ? parse.detail()
                : parse.detail() + "｜首条诊断 " + firstText + "（共 " + errors.size() + " 条）";
        return new ParseFailure(file,
                first == null ? 0 : first.line(),
                first == null ? 0 : first.column(),
                parse.status().name(), why + "：" + firstText, detail, ruleIds);
    }

    // ──────────────────────────────────────────────── 内部工具

    private int flagsOf(String flags) {
        int f = Pattern.MULTILINE; // 规则里的 ^ $ 一律按行匹配，与前端 JS 行为对齐
        if (flags != null) {
            if (flags.indexOf('i') >= 0) {
                f |= Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE;
            }
            if (flags.indexOf('s') >= 0) {
                f |= Pattern.DOTALL;
            }
            if (flags.indexOf('u') >= 0) {
                f |= Pattern.UNICODE_CHARACTER_CLASS;
            }
        }
        return f;
    }

    private String reasonFor(Rule.Check c) {
        if (c.hasAst()) {
            // 走到这里说明该 AST 规则没有语法层检查器：依赖类型解析 / 跨文件符号表 / 控制流，
            // jdk.compiler 的纯语法扫描做不到，诚实留待 LLM 语义层，绝不伪造判定
            return "AST 语法层无对应检查器：依赖类型解析/跨文件符号表/控制流，留待 LLM 语义层执行";
        }
        if (c.hasLlm()) {
            return "需语义判定 —— 交由 LLM 层执行（强制要求行号定位，给不出行号视为无效）";
        }
        return "无法自动判定 —— 需人工过目";
    }

    private List<int[]> collect(Pattern p, String text) {
        List<int[]> out = new ArrayList<>();
        Matcher m = p.matcher(text);
        int guard = 0;
        while (m.find()) {
            out.add(new int[]{m.start(), m.end() - m.start()});
            if (++guard >= MAX_HITS_PER_RULE_PER_FILE) {
                break;
            }
        }
        return out;
    }

    private int[] newlineIndex(String text) {
        int n = 0;
        for (int i = 0; i < text.length(); i++) {
            if (text.charAt(i) == '\n') {
                n++;
            }
        }
        int[] arr = new int[n];
        int k = 0;
        for (int i = 0; i < text.length(); i++) {
            if (text.charAt(i) == '\n') {
                arr[k++] = i;
            }
        }
        return arr;
    }

    private int lineOf(int[] newlines, int index) {
        int lo = 0;
        int hi = newlines.length;
        while (lo < hi) {
            int mid = (lo + hi) >>> 1;
            if (newlines[mid] < index) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return lo + 1;
    }

    private int columnOf(int[] newlines, int index) {
        int line = lineOf(newlines, index);
        int start = line == 1 ? 0 : newlines[line - 2] + 1;
        return index - start + 1;
    }

    private String snippet(String text, int index, int matchLen) {
        int lineStart = text.lastIndexOf('\n', index) + 1;
        int lineEnd = text.indexOf('\n', index);
        if (lineEnd < 0) {
            lineEnd = text.length();
        }
        String s = text.substring(lineStart, Math.max(lineStart, lineEnd)).trim();

        if (s.isEmpty() && matchLen > 0) {
            String raw = text.substring(index, Math.min(text.length(), index + matchLen));
            int nl = raw.indexOf('\n');
            s = (nl >= 0 ? raw.substring(0, nl) : raw).trim();
        }
        return s.length() > SNIPPET_MAX ? s.substring(0, SNIPPET_MAX) + "…" : s;
    }

    private String grade(int score) {
        if (score >= 95) {
            return "合规";
        }
        if (score >= 85) {
            return "良好";
        }
        if (score >= 70) {
            return "及格";
        }
        if (score >= 50) {
            return "不合格";
        }
        return "严重违规";
    }
}
