package com.arsenal.cases;

/**
 * 案例执行服务的业务异常。
 *
 * <p>和 ScanException / ArchifyUnavailableException 一个思路：业务的失败码必须自己声明落点，
 * 不能落到全局兜底的 500（那是「服务端坏了」的意思，语义完全反了）。
 * 例如「没找到 JDK 21」是环境不可用（503），不是服务器 bug。
 */
public class CaseException extends RuntimeException {

    private final String code;
    private final int status;

    public CaseException(String code, String message, int status) {
        super(message);
        this.code = code;
        this.status = status;
    }

    public String code() {
        return code;
    }

    public int status() {
        return status;
    }
}
