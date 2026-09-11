package com.arsenal.web;

import com.arsenal.domain.RulesetMeta;
import com.arsenal.loader.RuleIndex;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 元信息与健康检查。
 * MCP 客户端接进来第一件事就是问这个 —— 确认规则集版本对不对。
 */
@RestController
@RequestMapping("/api")
public class MetaController {

    private final RuleIndex index;

    public MetaController(RuleIndex index) {
        this.index = index;
    }

    @GetMapping("/health")
    public ApiResponse<Map<String, Object>> health() {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("status", "UP");
        body.put("ruleset", index.meta().ruleset());
        body.put("version", index.meta().version());
        body.put("rules", index.stats().total());
        body.put("mustClass", index.stats().mustClass());
        body.put("regexCapable", index.stats().regexCapable());
        body.put("serverTime", OffsetDateTime.now().toString());
        return ApiResponse.ok(body);
    }

    @GetMapping("/meta")
    public ApiResponse<RulesetMeta> meta() {
        return ApiResponse.ok(index.meta());
    }

    @GetMapping("/stats")
    public ApiResponse<RuleIndex.Stats> stats() {
        return ApiResponse.ok(index.stats());
    }
}
