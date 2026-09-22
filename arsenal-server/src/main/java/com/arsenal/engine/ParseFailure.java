package com.arsenal.engine;

import java.util.List;

/**
 * 一条显式的「解析失败」记录（每条失败文件一条）。
 *
 * <p>刻意既不是 {@link Violation} 也不是 {@link SkippedRule}：
 * <ul>
 *   <li>做成 {@code Violation} 会污染规则命中数与评分 —— 用户会以为代码真的违规了；</li>
 *   <li>塞进 {@code skipped} 会污染它的语义 —— skipped 是「这条规则没有检查器」（能力边界），
 *       而这里是「这次根本没跑成」（本次无结论）。</li>
 * </ul>
 * 所以它是第三类：<b>本次没有结论</b>。存在的唯一理由是让那个「假 100 分」消失：
 * 一个含语法错误、零违规命中的文件，过去会被报成「合规 100 分」。
 */
public record ParseFailure(
        /** 文件路径；报告级条目（整层无编译器 / 未提交 Java 文件）时为空串 */
        String file,
        /** 出错行；不可定位时为 0 */
        int line,
        /** 出错列；不可定位时为 0 */
        int column,
        /** SYNTAX_ERROR | COMPILER_MISSING | NO_JAVA_FILE */
        String status,
        /** 必须含「解析失败」或「无法进行 AST 检查」字样 —— 报告里要能一眼看出没跑成 */
        String message,
        /** javac 原始诊断摘要或具体说明 */
        String detail,
        /** 因此未被评估的规则 id */
        List<String> unevaluatedRules
) {
    public ParseFailure {
        file = file == null ? "" : file;
        status = status == null ? "SYNTAX_ERROR" : status;
        message = message == null ? "" : message;
        detail = detail == null ? "" : detail;
        unevaluatedRules = unevaluatedRules == null ? List.of() : List.copyOf(unevaluatedRules);
    }
}
