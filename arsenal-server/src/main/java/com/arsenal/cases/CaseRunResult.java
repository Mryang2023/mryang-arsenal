package com.arsenal.cases;

/**
 * 一次案例执行的完整结果。
 *
 * <p>编译失败与运行失败都走同一个结构：{@code compiled=false} 表示 javac 没过，
 * 此时 {@code exitCode} 为 null、{@code stderr} 里是编译错误；运行阶段 {@code compiled=true}，
 * {@code exitCode} 为进程退出码（被杀时为 null），{@code timedOut} 标记是否超时强杀。
 */
public record CaseRunResult(
        boolean compiled,
        String jdkVersion,
        String stdout,
        String stderr,
        Integer exitCode,
        boolean timedOut,
        long durationMs
) {

    /** 编译失败：javac 非零退出。 */
    public static CaseRunResult compileError(String jdkVersion, String stderr, long durationMs) {
        return new CaseRunResult(false, jdkVersion, "", stderr == null ? "" : stderr, null, false, durationMs);
    }

    /** 编译阶段就超时。 */
    public static CaseRunResult compileTimeout(String jdkVersion, long durationMs) {
        return new CaseRunResult(false, jdkVersion, "", "编译超时（强杀）", null, true, durationMs);
    }

    /** 运行成功或运行失败（含超时强杀）的统一构造。 */
    public static CaseRunResult run(String jdkVersion, String stdout, String stderr,
                                    Integer exitCode, boolean timedOut, long durationMs) {
        return new CaseRunResult(true, jdkVersion, stdout, stderr, exitCode, timedOut, durationMs);
    }
}
