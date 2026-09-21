package com.arsenal.archify;

/**
 * 通用绘图器（Archify / 扳手AI.Archify）跑不起来。
 *
 * <p>与 {@link IllegalArgumentException} 的分工：
 * <ul>
 *   <li><b>请求内容不合规</b>（不是 IR 对象、带了要联网抓取的商标、超大）→ IllegalArgumentException，
 *       是调用方的问题，400。</li>
 *   <li><b>这台机器跑不了它</b>（技能没装、没有 node、跑超时、子进程崩了）→ 本异常，
 *       是环境的问题，503 / 504。这个区分很重要：前者要调用方改请求，后者要调用方去装东西，
 *       糊成同一个错误码，看日志的人会去改错的地方。</li>
 * </ul>
 *
 * <p>四条码都是「怎么修」导向的：不告诉人往哪儿走的原因码，等于没说。
 */
public class ArchifyUnavailableException extends RuntimeException {

    /** 技能没装 —— 机器上找不到 wrench-ai.mjs。 */
    public static final String NOT_INSTALLED = "ARCHIFY_NOT_INSTALLED";
    /** 找不到可用的 node —— 技能装了也跑不起来。 */
    public static final String NODE_MISSING = "ARCHIFY_NODE_MISSING";
    /** 超过时限。实测一次约 1.6 秒，跑到超时基本意味着卡死了。 */
    public static final String TIMEOUT = "ARCHIFY_TIMEOUT";
    /** 子进程非正常退出，且没吐出结构化诊断（通常 node 自己就报错了）。 */
    public static final String EXEC_FAILED = "ARCHIFY_EXEC_FAILED";

    private final String code;

    public ArchifyUnavailableException(String code, String message) {
        super(message);
        this.code = code;
    }

    public ArchifyUnavailableException(String code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    public String code() {
        return code;
    }
}
