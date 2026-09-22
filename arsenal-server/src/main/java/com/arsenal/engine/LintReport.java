package com.arsenal.engine;

import com.arsenal.domain.Severity;

import java.util.List;
import java.util.Map;

/**
 * 校验报告。
 *
 * <p>刻意区分三类：
 * <ul>
 *   <li>{@code violations} —— 确实违规（结论）；</li>
 *   <li>{@code skipped} —— 检不了（能力边界：这条规则没有检查器）；</li>
 *   <li>{@code unparsed} —— 本次没跑成（解析失败 / 不是 Java / 没有编译器）。</li>
 * </ul>
 * 把三者混在一起，或者让第三类静默消失，就是最容易骗人的做法 ——
 * 一个含语法错误、零违规命中的文件，过去会被报成「合规 100 分」。
 *
 * <p><b>{@code score} 是可空的</b>：当 {@code decidable} 为 false（存在解析失败）时它是
 * {@code null}，{@code grade} 是「不可判定」。不给数字，因为数字本身就是一句断言 ——
 * 给 100 是谎，给任何一个别的数也是谎。消费者必须先看 {@code decidable} 再用 {@code score}。
 */
public record LintReport(
        int fileCount,
        int totalLines,
        int rulePool,
        /** 真的跑过的规则数（正则层编译成功的 + AST 层在解析成功的文件上实际执行过的） */
        int executableRules,
        int matchedFiles,
        int notApplicable,
        List<Violation> violations,
        List<SkippedRule> skipped,
        /** 第三类：本次没跑成的显式记录（每条失败文件一条） */
        List<ParseFailure> unparsed,
        /** 不可判定时为 null —— 不许把「没结论」呈现成满分 */
        Integer score,
        String grade,
        Map<String, Integer> counts,
        List<CategoryHits> byCategory,
        List<RuleHitSummary> byRule,
        long durationMs,
        /** AST 层本次的执行情况（无编译器 / 无 Java 文件 / 语法错误都在这） */
        AstLayer ast,
        /** 本次结论是否可判定。false 时不得把报告读成「合规」 */
        boolean decidable,
        /** 不可判定的人可读原因 */
        List<String> undecidability
) {

    public LintReport {
        violations = violations == null ? List.of() : List.copyOf(violations);
        skipped = skipped == null ? List.of() : List.copyOf(skipped);
        unparsed = unparsed == null ? List.of() : List.copyOf(unparsed);
        counts = counts == null ? Map.of() : Map.copyOf(counts);
        byCategory = byCategory == null ? List.of() : List.copyOf(byCategory);
        byRule = byRule == null ? List.of() : List.copyOf(byRule);
        undecidability = undecidability == null ? List.of() : List.copyOf(undecidability);
    }

    public record CategoryHits(String category, int count, Severity severity) {
    }

    public int total() {
        return violations.size();
    }

    public int mustClassViolations() {
        return violations.stream()
                .filter(v -> v.severity() != null && v.severity().blocking())
                .toList()
                .size();
    }
}
