package com.arsenal.domain;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

/**
 * 规则严重度。
 *
 * MUST 与 NEVER 同级阻断，且共同占用「强制级配额」（硬上限 50 条）——
 * 配额的存在是刻意的：规范超过人能记住的量，就会退化成摆设。
 */
public enum Severity {

    MUST("MUST", "强制", 6, true),
    NEVER("NEVER", "禁止", 6, true),
    SHOULD("SHOULD", "建议", 2, false),
    MAY("MAY", "可选", 0, false);

    private final String code;
    private final String label;
    private final int penalty;
    private final boolean blocking;

    Severity(String code, String label, int penalty, boolean blocking) {
        this.code = code;
        this.label = label;
        this.penalty = penalty;
        this.blocking = blocking;
    }

    @JsonValue
    public String code() {
        return code;
    }

    public String label() {
        return label;
    }

    /** 单条违规扣分。用于合规度评分。 */
    public int penalty() {
        return penalty;
    }

    public boolean blocking() {
        return blocking;
    }

    @JsonCreator
    public static Severity from(String raw) {
        if (raw == null || raw.isBlank()) {
            return SHOULD;
        }
        for (Severity s : values()) {
            if (s.code.equalsIgnoreCase(raw.trim())) {
                return s;
            }
        }
        throw new IllegalArgumentException("未知的规则级别: " + raw);
    }
}
