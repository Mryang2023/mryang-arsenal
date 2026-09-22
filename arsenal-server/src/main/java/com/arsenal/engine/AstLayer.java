package com.arsenal.engine;

import java.util.List;

/**
 * AST 层本次的执行情况。
 *
 * <p>存在的理由：AST 规则没有可执行检查器时进 {@code skipped} 是对的（能力边界），
 * 但「有检查器、却因为文件不是 Java / 语法坏了 / 当前 JVM 没有编译器而没跑」是另一回事 ——
 * 它既不是「违规」也不是「能力边界」，而是「本次没跑成」。
 * 过去这三种情况都是静默的：没有 finding、没有 skipped、没有 note，
 * 而 {@code executableRules} 照样把它们算成「已执行」→ {@code POST /api/lint} 返回假的 100 分。
 *
 * <p>{@code status} 取值：
 * <ul>
 *   <li>{@code executed} —— 所有提交的 .java 文件都解析成功，AST 结论完整</li>
 *   <li>{@code partial} —— 部分 .java 文件解析失败，AST 结论只覆盖解析成功的那些</li>
 *   <li>{@code failed} —— 提交了 .java 但全部解析失败，AST 结论为空</li>
 *   <li>{@code no_java_file} —— 本次没有任何 .java 文件，AST 规则一条也没跑</li>
 *   <li>{@code compiler_missing} —— 当前 JVM 无 java.compiler，无法进行 AST 检查</li>
 *   <li>{@code not_applicable} —— 规则池里本来就没有可执行的 AST 规则</li>
 * </ul>
 */
public record AstLayer(
        String status,
        /** 本次应在本层执行的 AST 规则数（走 skipped 的那 5 条「无检查器」不算） */
        int declaredRules,
        /** 提交的 .java 文件数 */
        int javaFiles,
        /** 解析成功的 .java 文件数 */
        int parsedFiles,
        /** 解析失败的 .java 文件数 */
        int failedFiles,
        /** 未执行时：因此没跑到的规则 id（执行完整时为空） */
        List<String> unevaluatedRules,
        /** 人可读说明（含「无法进行 AST 检查」等字样） */
        String note
) {
    public AstLayer {
        status = status == null ? "not_applicable" : status;
        unevaluatedRules = unevaluatedRules == null ? List.of() : List.copyOf(unevaluatedRules);
        note = note == null ? "" : note;
    }

    /** 本层是否给得出结论。false 时 LintEngine 不许把报告呈现成「合规」。 */
    public boolean conclusive() {
        return "executed".equals(status) || "not_applicable".equals(status);
    }
}
