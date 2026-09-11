package com.arsenal.engine;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.Size;

import java.util.List;

/**
 * 校验请求。支持一次传多个文件（校验一个模块而不是一个文件）。
 */
public record LintRequest(

        @NotEmpty(message = "至少要提交一个文件")
        @Size(max = 200, message = "单次最多校验 200 个文件")
        List<SourceFile> files
) {
    public LintRequest {
        files = files == null ? List.of() : List.copyOf(files);
    }
}
