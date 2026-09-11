package com.arsenal.domain;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;
import java.util.Map;

/**
 * 规则集元信息（arsenal-rules/meta.json）的映射。
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record RulesetMeta(
        String ruleset,
        String name,
        String codename,
        String version,
        String releasedAt,
        String description,
        Map<String, String> targetStack,
        Map<String, String> severityPolicy,
        Budget budget,
        Map<String, Object> sourceRegistry,
        List<Category> categories,
        List<Changelog> changelog
) {

    public RulesetMeta {
        targetStack = targetStack == null ? Map.of() : Map.copyOf(targetStack);
        severityPolicy = severityPolicy == null ? Map.of() : Map.copyOf(severityPolicy);
        sourceRegistry = sourceRegistry == null ? Map.of() : Map.copyOf(sourceRegistry);
        categories = categories == null ? List.of() : List.copyOf(categories);
        changelog = changelog == null ? List.of() : List.copyOf(changelog);
    }

    /**
     * 强制级配额。mustHardLimit 是硬上限 ——
     * 想新增强制条目，必须先把一条旧的降级。
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Budget(int mustHardLimit, int mustCurrent, int totalCurrent) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Category(String key, String name, String dir, int fileCount) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Changelog(String version, String date, String note) {
    }

    public int mustHardLimit() {
        return budget == null ? 50 : budget.mustHardLimit();
    }
}
