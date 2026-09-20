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
        /**
         * 来源类型的中文标签（industry-standard → 行业规范 …）。
         * 数据而不是代码：前后端导出同一种载体时都要用，写两份必然会漂。
         */
        Map<String, String> sourceTypes,
        List<Category> categories,
        List<Changelog> changelog
) {

    public RulesetMeta {
        targetStack = targetStack == null ? Map.of() : Map.copyOf(targetStack);
        severityPolicy = severityPolicy == null ? Map.of() : Map.copyOf(severityPolicy);
        sourceRegistry = sourceRegistry == null ? Map.of() : Map.copyOf(sourceRegistry);
        sourceTypes = sourceTypes == null ? Map.of() : Map.copyOf(sourceTypes);
        categories = categories == null ? List.of() : List.copyOf(categories);
        changelog = changelog == null ? List.of() : List.copyOf(changelog);
    }

    /**
     * 来源类型 → 中文标签。
     *
     * 查不到就退回原始 key（露出原始 key 比显示空白更容易发现问题）；
     * 类型本身就缺失时给「来源」，与前端 exporters.ts 的兜底一致。
     */
    public String sourceTypeLabel(String type) {
        if (type == null || type.isBlank()) {
            return "来源";
        }
        return sourceTypes.getOrDefault(type, type);
    }

    /**
     * 强制级配额。mustHardLimit 是硬上限 ——
     * 想新增强制条目，必须先把一条旧的降级。
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Budget(int mustHardLimit, int mustCurrent, int totalCurrent) {
    }

    /**
     * 分类元信息。
     *
     * name / english / blurb 是「这条分类叫什么、怎么向人介绍它」的文案，
     * 属于数据而不是 UI —— 导出器（后端 markdown、前端规范书）都要用。
     * 早先它们只活在前端 theme.ts 里，后端拿不到，于是同一种载体两端导出的分类标题一个中文一个原始 key。
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Category(String key, String name, String english, String blurb, String dir, int fileCount) {

        /** 缺省回退到 key —— 数据里没写就不伪造，露出原始 key 反而容易发现。 */
        public String nameOrDefault() {
            return blankTo(name, key);
        }

        public String englishOrDefault() {
            return blankTo(english, key);
        }

        public String blurbOrDefault() {
            return blankTo(blurb, "");
        }

        private static String blankTo(String v, String fallback) {
            return v == null || v.isBlank() ? fallback : v;
        }
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Changelog(String version, String date, String note) {
    }

    public int mustHardLimit() {
        return budget == null ? 50 : budget.mustHardLimit();
    }
}
