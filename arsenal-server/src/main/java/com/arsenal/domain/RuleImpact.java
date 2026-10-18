package com.arsenal.domain;

/**
 * 「不修的后果」派生器 —— finding 级 impact 的单一出处。
 *
 * <p>两级来源，诚实标注（不编造）：
 * <ol>
 *   <li>{@code rule-impact} —— 规则库自带 impact 字段（2026-10-18 起 69 条已补齐，Q4），
 *       一句话回答「然后呢」，这是首选；</li>
 *   <li>{@code rule-rationale} —— 规则没有 impact（历史报告回放 / draft 规则）时，
 *       从 rationale 派生并截断到 ~120 字。rationale 是「为什么定这条规」，
 *       不总是「不修会怎样」，所以页面必须标注「出自规则制定理由」，不许让它伪装成真 impact。</li>
 * </ol>
 *
 * <p>截断在句号处收（保持「一句话说死」），没有句号就硬截并补省略号。
 */
public final class RuleImpact {

    /** impact 派生上限（字），与计划书 §5 B5 的「截断到 ~120 字」一致。 */
    static final int MAX_LEN = 120;

    private RuleImpact() {
    }

    /** 一条 finding 的后果：文本 + 来源标注。 */
    public record Impact(String text, String source) {
    }

    public static Impact of(Rule rule) {
        if (rule == null) {
            return new Impact("", "rule-missing");
        }
        if (rule.impact() != null && !rule.impact().isBlank()) {
            return new Impact(rule.impact(), "rule-impact");
        }
        return new Impact(deriveFromRationale(rule.rationale()), "rule-rationale");
    }

    /** rationale → 一句话后果。rationale 也缺时如实给空串（前端 fallback 文案兜底）。 */
    public static String deriveFromRationale(String rationale) {
        if (rationale == null || rationale.isBlank()) {
            return "";
        }
        String s = rationale.strip();
        if (s.length() <= MAX_LEN) {
            return s;
        }
        int cut = s.indexOf('。');
        if (cut > 0 && cut <= MAX_LEN) {
            return s.substring(0, cut + 1);
        }
        return s.substring(0, MAX_LEN) + "…";
    }
}
