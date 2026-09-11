package com.arsenal.web;

/**
 * 规则不存在。
 *
 * 注意：规则 ID 永不复用、作废不回收 —— 所以这个异常在正常情况下
 * 只会因为「拼错了 ID」触发，不会因为「规则已删除」触发。
 */
public class RuleNotFoundException extends RuntimeException {

    private final String ruleId;

    public RuleNotFoundException(String ruleId) {
        super("规则不存在：" + ruleId);
        this.ruleId = ruleId;
    }

    public String ruleId() {
        return ruleId;
    }
}
