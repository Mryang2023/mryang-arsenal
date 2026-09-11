package com.arsenal.web;

import com.arsenal.engine.LintEngine;
import com.arsenal.engine.LintReport;
import com.arsenal.engine.LintRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 代码校验接口。
 *
 * 用 POST 而不是 GET：请求体可能是一整个模块的源码，
 * 塞进 query string 既不合适也会撞 URL 长度上限。
 */
@RestController
@RequestMapping("/api/lint")
public class LintController {

    private final LintEngine engine;

    public LintController(LintEngine engine) {
        this.engine = engine;
    }

    @PostMapping
    public ApiResponse<LintReport> lint(@Valid @RequestBody LintRequest request) {
        return ApiResponse.ok(engine.lint(request));
    }
}
