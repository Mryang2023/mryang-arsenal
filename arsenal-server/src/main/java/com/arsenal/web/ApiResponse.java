package com.arsenal.web;

/**
 * 统一响应体。所有接口必须返回它 —— 这是军火库自己的规则 WEB-CTRL-003 要求的，
 * 所以自家服务第一个遵守。
 */
public record ApiResponse<T>(
        boolean success,
        String code,
        String message,
        T data
) {

    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(true, "OK", null, data);
    }

    public static <T> ApiResponse<T> fail(String code, String message) {
        return new ApiResponse<>(false, code, message, null);
    }
}
