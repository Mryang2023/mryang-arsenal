package com.arsenal.scan;

/**
 * 扫描失败。带**错误码** —— 扫描的失败原因决定了调用方下一步做什么：
 * 路径不存在要改输入，超限要缩小范围，超时要重试或分批。混成一个「扫描失败」，
 * 页面上就只能显示一句没用的话。
 */
public class ScanException extends RuntimeException {

    /** 输入本身不合法（路径不存在、不是目录、git 地址不是 https、zip 里有 ../） */
    public static final String BAD_REQUEST = "SCAN_BAD_REQUEST";
    /** 规模超限：单文件 / 总字节 / 文件数 / 目录深度 */
    public static final String TOO_LARGE = "SCAN_TOO_LARGE";
    /** 超时。已扫描的部分仍然返回，由调用方决定是否采用 */
    public static final String TIMEOUT = "SCAN_TIMEOUT";
    /** git 拉取失败（网络、地址、凭据提示被拒） */
    public static final String GIT_FAILED = "SCAN_GIT_FAILED";

    private final String code;

    public ScanException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String code() {
        return code;
    }

    public static ScanException badRequest(String message) {
        return new ScanException(BAD_REQUEST, message);
    }

    public static ScanException tooLarge(String message) {
        return new ScanException(TOO_LARGE, message);
    }

    public static ScanException timeout(String message) {
        return new ScanException(TIMEOUT, message);
    }
}
