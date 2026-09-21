package com.arsenal.web;

import com.arsenal.archify.ArchifyUnavailableException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
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

    /**
     * 请求体根本不是合法 JSON（或 Content-Type 不对）。
     *
     * <p>不接住它会落到最下面的兜底分支变成 500 —— 而 500 的意思是「服务端坏了」，
     * 实际情况是调用方发了坏数据。这个错误码指向的排查方向完全是反的。
     */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public ApiResponse<Void> handleUnreadable(HttpMessageNotReadableException e) {
        log.info("请求体无法解析：{}", e.getMessage());
        return ApiResponse.fail("MALFORMED_BODY", "请求体不是合法 JSON，或 Content-Type 不是 application/json");
    }

    /**
     * 环境跑不了通用绘图器（没装技能、没有 node、超时、子进程崩了）。
     *
     * <p>这里面有两类语义：超时是 504（网关等后端超时），其余是 503（暂时不可用）。
     * 分成两个状态码不是为了好看 —— 它们的处置动作不同：504 要去看那个进程，
     * 503 要去装东西。混成一个，看日志的人会去改错的地方。
     */
    @ExceptionHandler(ArchifyUnavailableException.class)
    public ResponseEntity<ApiResponse<Void>> handleArchifyUnavailable(ArchifyUnavailableException e) {
        boolean timeout = ArchifyUnavailableException.TIMEOUT.equals(e.code());
        HttpStatus status = timeout ? HttpStatus.GATEWAY_TIMEOUT : HttpStatus.SERVICE_UNAVAILABLE;
        log.warn("通用绘图器不可用（{}）：{}", e.code(), e.getMessage());
        return ResponseEntity.status(status).body(ApiResponse.fail(e.code(), e.getMessage()));
    }

    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public ApiResponse<Void> handleUnexpected(Exception e) {
        log.error("未预期的服务端异常", e);
        return ApiResponse.fail("INTERNAL_ERROR", "服务端异常，详情见服务日志");
    }
}
