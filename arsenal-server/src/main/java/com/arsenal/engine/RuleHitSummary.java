package com.arsenal.engine;

import com.arsenal.domain.Severity;

/** 按规则聚合的命中统计 —— 用来回答「我这次最常犯哪几条」。 */
public record RuleHitSummary(
        String ruleId,
        String title,
        Severity severity,
        String category,
        int count,
        int files
) {
}
