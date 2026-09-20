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
        List<Rule> astRules = new ArrayList<>();
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
                // AST 语法层有对应检查器 —— 交给 AstEngine 在扫描阶段执行
                astRules.add(r);
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
            if (!astRules.isEmpty() && name.endsWith(".java")) {
                touched = true;
                Map<String, List<AstEngine.Finding>> astHits = astEngine.lintFile(astRules, name, text);
                for (Map.Entry<String, List<AstEngine.Finding>> e : astHits.entrySet()) {
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
        int score = Math.max(0, Math.min(100, 100 - penalty));

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

        return new LintReport(
                files.size(), totalLines, active.size(), compiled.size() + astRules.size(),
                matchedFiles, notApplicable,
                violations, skipped,
                score, grade(score), counts,
                new ArrayList<>(catMap.values()), byRule, ms);
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
