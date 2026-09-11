package com.arsenal.engine;

import com.arsenal.domain.Severity;

/**
 * 一处违规。必须能定位到「哪个文件、哪一行、哪一列」——
 * 给不出位置的判定等于没给结论。
 */
public record Violation(
        String ruleId,
        String title,
        Severity severity,
        String category,
        String file,
        int line,
        int column,
        String snippet,
        String message,
        String fix,
        /** 同文件同规则被折叠掉的额外命中数 */
        int collapsed
) {
    public Violation withCollapsed(int n) {
        return new Violation(ruleId, title, severity, category, file, line, column, snippet, message, fix, n);
    }
}
