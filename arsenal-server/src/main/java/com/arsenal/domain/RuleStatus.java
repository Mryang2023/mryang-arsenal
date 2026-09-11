package com.arsenal.domain;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * 规则生命周期状态。
 *
 * active 参与校验与导出；draft 只供浏览；deprecated 保留追溯但不再生效。
 * 规则废弃后 ID 作废不回收 —— 历史报告里出现的 ID 必须永远能查到。
 */
public enum RuleStatus {

    ACTIVE("active"),
    DRAFT("draft"),
    DEPRECATED("deprecated");

    private final String code;

    RuleStatus(String code) {
        this.code = code;
    }

    @JsonValue
    public String code() {
        return code;
    }

    @JsonCreator
    public static RuleStatus from(String raw) {
        if (raw == null || raw.isBlank()) {
            return ACTIVE;
        }
        for (RuleStatus s : values()) {
            if (s.code.equalsIgnoreCase(raw.trim())) {
                return s;
            }
        }
        throw new IllegalArgumentException("未知的规则状态: " + raw);
    }
}
