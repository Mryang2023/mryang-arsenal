package com.arsenal.web;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import java.util.stream.Collectors;

/**
 * 全局唯一异常出口。
 *
 * 各 Controller 一律不写 try-catch —— 同类异常在不同接口返回不同结构，
 * 是接口契约崩坏的开始。军火库规则 WEB-CTRL-004 说的就是这件事。
 *
 * 另外注意：这里没有一处 printStackTrace（REL-LOG-001），全部走结构化日志。
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(RuleNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ApiResponse<Void> handleNotFound(RuleNotFoundException e) {
        // 用户填错 ID 属于正常输入，不打堆栈
        log.info("规则查询未命中：{}", e.ruleId());
        return ApiResponse.fail("RULE_NOT_FOUND", e.getMessage());
    }

    @ExceptionHandler(IllegalArgumentException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ApiResponse<Void> handleBadRequest(IllegalArgumentException e) {
        log.info("请求参数不合法：{}", e.getMessage());
        return ApiResponse.fail("BAD_REQUEST", e.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ApiResponse<Void> handleValidation(MethodArgumentNotValidException e) {
        String detail = e.getBindingResult().getFieldErrors().stream()
                .map(f -> f.getField() + " " + f.getDefaultMessage())
                .collect(Collectors.joining("；"));
        log.info("参数校验失败：{}", detail);
        return ApiResponse.fail("VALIDATION_FAILED", detail);
    }

    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public ApiResponse<Void> handleUnexpected(Exception e) {
        log.error("未预期的服务端异常", e);
        return ApiResponse.fail("INTERNAL_ERROR", "服务端异常，详情见服务日志");
    }
}
