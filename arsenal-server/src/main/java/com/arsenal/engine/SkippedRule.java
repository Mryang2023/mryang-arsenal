package com.arsenal.engine;

import com.arsenal.domain.Severity;

/**
 * 本次校验覆盖不到的规则。
 *
 * 存在的意义是「诚实」：宁可明说这条检不了，也不要给一个假阳性把用户带偏。
 * 前端只跑正则层，所以这里通常会有几十条（需 AST / 语义判定的）。
 */
public record SkippedRule(
        String ruleId,
        String title,
        Severity severity,
        String category,
        String layer,
        String reason
) {
}
