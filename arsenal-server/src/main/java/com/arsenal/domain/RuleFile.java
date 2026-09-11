package com.arsenal.domain;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

/**
 * 规则文件（arsenal-rules/&lt;分类&gt;/*.json）的顶层结构。
 * 一个文件承载同一分类下的若干条规则。
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record RuleFile(
        String category,
        String name,
        String description,
        List<Rule> rules
) {
    public RuleFile {
        rules = rules == null ? List.of() : List.copyOf(rules);
    }
}
