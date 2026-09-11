package com.arsenal.web;

import com.arsenal.domain.Severity;
import com.arsenal.exporter.ExporterService;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 导出接口。同一份规则数据编译成不同载体。
 *
 * 提供了两个形态：
 *   /api/export/{format}        —— JSON 包装（带元信息，供程序消费）
 *   /api/export/{format}/raw    —— 裸文本（供 curl 直接重定向成文件）
 */
@RestController
@RequestMapping("/api/export")
public class ExportController {

    private final ExporterService exporter;

    public ExportController(ExporterService exporter) {
        this.exporter = exporter;
    }

    @GetMapping("/formats")
    public ApiResponse<List<String>> formats() {
        return ApiResponse.ok(ExporterService.SUPPORTED);
    }

    @GetMapping("/{format}")
    public ApiResponse<ExporterService.ExportResult> export(
            @PathVariable("format") String format,
            @RequestParam(name = "severity", required = false) List<String> severity,
            @RequestParam(name = "category", required = false) List<String> category,
            @RequestParam(name = "examples", defaultValue = "true") boolean examples,
            @RequestParam(name = "sources", defaultValue = "true") boolean sources,
            @RequestParam(name = "rationale", defaultValue = "false") boolean rationale,
            @RequestParam(name = "checks", defaultValue = "false") boolean checks) {

        return ApiResponse.ok(exporter.export(
                format, severities(severity), setOf(category), examples, sources, rationale, checks));
    }

    @GetMapping(value = "/{format}/raw", produces = MediaType.TEXT_PLAIN_VALUE + ";charset=UTF-8")
    public String raw(
            @PathVariable("format") String format,
            @RequestParam(name = "severity", required = false) List<String> severity,
            @RequestParam(name = "category", required = false) List<String> category,
            @RequestParam(name = "examples", defaultValue = "true") boolean examples,
            @RequestParam(name = "sources", defaultValue = "true") boolean sources,
            @RequestParam(name = "rationale", defaultValue = "false") boolean rationale,
            @RequestParam(name = "checks", defaultValue = "false") boolean checks) {

        return exporter.export(format, severities(severity), setOf(category),
                examples, sources, rationale, checks).content();
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
