package com.arsenal.scan;

/**
 * 一条「没看懂 / 没做成」的记录。
 *
 * 硬规矩：**不许静默跳过任何东西**。文件太大没读、编码异常、依赖没映射、
 * 期望里的字段找不到 —— 都要留一条。事实 JSON 里看不到这些信息，
 * 看的人就会以为「这个项目没有配置文件」，而真相是「我们没读」。
 */
public record ScanNote(
        String level,
        String code,
        String message
) {
    public static final String WARN = "warn";
    public static final String INFO = "info";

    /** 解析失败 */
    public static final String PARSE_SKIPPED = "PARSE_SKIPPED";
    /** 文件过大未读 */
    public static final String FILE_TOO_LARGE = "FILE_TOO_LARGE";
    /** 文件读不了（权限 / 编码） */
    public static final String FILE_UNREADABLE = "FILE_UNREADABLE";
    /** 依赖没命中映射表 */
    public static final String UNMAPPED_DEPENDENCY = "UNMAPPED_DEPENDENCY";
    /** 规模触顶，扫描被截断 */
    public static final String TRUNCATED = "TRUNCATED";
    /** 目录深度触顶。Files.walk 到深度上限是**静默停下**的，不留这条就会显得「仓库就这么大」 */
    public static final String DEPTH_EXCEEDED = "DEPTH_EXCEEDED";
    /** 期望里有、实际没有的字段（读不到就 null，但要说清读不到） */
    public static final String VALUE_MISSING = "VALUE_MISSING";
    /** 安全闸门拦下的东西 */
    public static final String UNSAFE_PATH = "UNSAFE_PATH";
}
