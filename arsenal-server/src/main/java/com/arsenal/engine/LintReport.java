package com.arsenal.engine;

import com.arsenal.domain.Severity;

import java.util.List;
import java.util.Map;

/**
 * 校验报告。
 *
 * 刻意区分了 violations（确实违规）与 skipped（检不了）——
 * 前者是结论，后者是能力边界。把两者混在一起是最容易骗人的做法。
 */
public record LintReport(
        int fileCount,
        int totalLines,
        int rulePool,
        int executableRules,
        int matchedFiles,
        int notApplicable,
        List<Violation> violations,
        List<SkippedRule> skipped,
        int score,
        String grade,
        Map<String, Integer> counts,
        List<CategoryHits> byCategory,
        List<RuleHitSummary> byRule,
        long durationMs
) {

    public LintReport {
        violations = violations == null ? List.of() : List.copyOf(violations);
        skipped = skipped == null ? List.of() : List.copyOf(skipped);
        counts = counts == null ? Map.of() : Map.copyOf(counts);
        byCategory = byCategory == null ? List.of() : List.copyOf(byCategory);
        byRule = byRule == null ? List.of() : List.copyOf(byRule);
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
