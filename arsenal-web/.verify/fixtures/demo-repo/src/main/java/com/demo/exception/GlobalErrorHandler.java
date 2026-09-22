package com.demo.exception;

import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** 全局异常兜底。它的存在会成为分层图右侧「横切关注点」里的一枚绿点 */
@RestControllerAdvice
public class GlobalErrorHandler {

    @ExceptionHandler(IllegalArgumentException.class)
    public String onBadRequest(IllegalArgumentException e) {
        return "bad: " + e.getMessage();
    }
}
