package com.arsenal.web;

import com.arsenal.scan.ProjectScanner;
import com.arsenal.scan.ScanException;
import com.arsenal.scan.SourceResolver;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.InputStream;

/**
 * 代码扫描接口。
 *
 * <p>这一层只做「把 HTTP 请求翻译成一次扫描」，不含任何业务判断 ——
 * 输入怎么变成事实是 {@link ProjectScanner} 的事，输入安不安全是
 * {@link com.arsenal.scan.ScanGuard} 的事。混在这里的结果是每个接口都要重写一遍安全逻辑。
 *
 * <p>三种输入：本地目录 / zip 上传 / https git 地址。它们都收敛成
 * {@link SourceResolver} 的一个目录，扫描器对输入来源一无所知。
 *
 * <p>返回的就是事实 JSON 本身（不套壳）：前端拿到什么就能贴进文档什么，
 * 多一层包装就多一处会漂移的地方。
 */
@RestController
@RequestMapping("/api/scan")
public class ScanController {

    private final ProjectScanner scanner;
    private final ObjectMapper mapper;

    public ScanController(ProjectScanner scanner, ObjectMapper mapper) {
        this.scanner = scanner;
        this.mapper = mapper;
    }

    /** 这台机器的扫描能力：装了多少条映射、表在哪。页面上「未识别依赖」的提示要用到 */
    @GetMapping("/rules")
    public ApiResponse<ObjectNode> rules() {
        ObjectNode n = mapper.createObjectNode();
        n.put("count", scanner.ruleCount());
        n.put("file", scanner.rulesFile().toString().replace('\\', '/'));
        return ApiResponse.ok(n);
    }

    /**
     * 扫一个本地目录或一个 git 地址。
     *
     * <p>请求体：{@code {"source":{"kind":"path"|"git","value":"..."}}}。
     * 缺字段、kind 不认识、路径不存在都是 400 —— 它们是调用方改一下就好的问题，
     * 不是服务端异常。
     */
    @PostMapping("/facts")
    public ApiResponse<JsonNode> facts(@RequestBody JsonNode body) {
        JsonNode source = body == null ? null : body.get("source");
        if (source == null || !source.isObject()) {
            throw new IllegalArgumentException("请求体缺少 source：{\"source\":{\"kind\":\"path|git\",\"value\":\"…\"}}");
        }
        String kind = source.path("kind").asText("");
        String value = source.path("value").asText("");
        return switch (kind) {
            case "path" -> ApiResponse.ok(scanner.scan(SourceResolver.fromPath(value)));
            case "git" -> ApiResponse.ok(scanner.scan(SourceResolver.fromGit(value)));
            default -> throw new IllegalArgumentException(
                    "source.kind 只支持 path / git，收到的是「" + kind + "」（zip 请走 /api/scan/upload）");
        };
    }

    /**
     * 上传一个 zip 直接扫。
     *
     * <p>注意这里**不落盘到任何业务目录**：解压进 JVM 临时目录，扫描结束在
     * {@code finally} 里删掉（见 {@link SourceResolver#close}）。
     */
    @PostMapping("/upload")
    public ApiResponse<JsonNode> upload(@RequestParam(value = "file", required = false) MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("上传的文件是空的");
        }
        String name = file.getOriginalFilename() == null ? "" : file.getOriginalFilename().toLowerCase();
        if (!name.endsWith(".zip")) {
            throw new IllegalArgumentException("只接受 .zip（收到的是 " + (name.isEmpty() ? "未知" : name) + "）");
        }
        try (InputStream in = file.getInputStream()) {
            return ApiResponse.ok(scanner.scan(SourceResolver.fromZip(in)));
        } catch (java.io.IOException e) {
            throw new IllegalArgumentException("上传的文件读不了：" + e.getMessage());
        } catch (ScanException e) {
            throw e;
        }
    }

    /** 映射表反查。调试用：想不通「为什么这个依赖没被认出来」时先看它在不在表里 */
    @GetMapping("/rules/detail")
    public ApiResponse<ArrayNode> rulesDetail() {
        return ApiResponse.ok(new com.arsenal.scan.TechStackResolver(
                new com.arsenal.scan.ScanRulesLoader(
                        scanner.rulesFile().toString(), mapper).rules()).describe(mapper));
    }
}
