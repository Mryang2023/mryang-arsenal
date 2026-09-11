package com.arsenal.web;

import com.arsenal.domain.Rule;
import com.arsenal.domain.Severity;
import com.arsenal.loader.RuleIndex;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 规则检索接口。
 *
 * 只做 HTTP 适配：解析参数、调用索引、包装响应。
 * 没有任何业务判断落在这一层 —— 军火库第一条规则就是禁止这么干。
 */
@RestController
@RequestMapping("/api/rules")
public class RuleController {

    private final RuleIndex index;

    public RuleController(RuleIndex index) {
        this.index = index;
    }

    /** 检索规则。q 为空时返回全量（按分类 + ID 排序）。 */
    @GetMapping
    public ApiResponse<List<Rule>> list(
            @RequestParam(name = "q", required = false) String q,
            @RequestParam(name = "severity", required = false) List<String> severity,
            @RequestParam(name = "category", required = false) List<String> category,
            @RequestParam(name = "autoOnly", defaultValue = "false") boolean autoOnly) {

        return ApiResponse.ok(index.search(q, severities(severity), setOf(category), autoOnly));
    }

    /** 按分类分组返回，用于渲染分类树。 */
    @GetMapping("/grouped")
    public ApiResponse<Map<String, List<Rule>>> grouped() {
        return ApiResponse.ok(index.grouped());
    }

    /** 溯源出处排行 —— 用于回答「这套规范到底站在谁的肩膀上」。 */
    @GetMapping("/sources")
    public ApiResponse<Map<String, Long>> sources() {
        return ApiResponse.ok(index.sourceCounts());
    }

    @GetMapping("/{id}")
    public ApiResponse<Rule> byId(@PathVariable("id") String id) {
        return ApiResponse.ok(index.byId(id).orElseThrow(() -> new RuleNotFoundException(id)));
    }

    // ────────────────────────────────────────────────

    private Set<Severity> severities(List<String> raw) {
        Set<Severity> out = new LinkedHashSet<>();
        if (raw != null) {
            for (String s : raw) {
                out.add(Severity.from(s));
            }
        }
        return out;
    }

    private Set<String> setOf(List<String> raw) {
        return raw == null ? Set.of() : new LinkedHashSet<>(raw);
    }
}
