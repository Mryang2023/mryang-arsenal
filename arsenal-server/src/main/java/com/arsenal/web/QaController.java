package com.arsenal.web;

import com.arsenal.qa.QaService;
import tools.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 测试工程师接口（/qa 页面的后端）。
 *
 * <p>与同步的 /api/autopsy 的分工：这里全部走「提交 → 轮询 → 取报告」的异步 Job，
 * 因为这条链路把 git clone（60s）和后续 LLM 段（分钟级）都收进来了。
 * 入参校验口径与 {@link AutopsyController} 一致：都在 Controller 里显式做，
 * 错误经 GlobalExceptionHandler 转 400 + 人话 message。
 */
@RestController
@RequestMapping("/api/qa")
public class QaController {

    private final QaService qa;

    public QaController(QaService qa) {
        this.qa = qa;
    }

    /**
     * 受理一次深检。请求体：
     * <pre>{@code {"source":{"kind":"path|git","value":"…"},
     *             "range":{"mode":"full|review|focus","include":[glob…],"exclude":[glob…]},
     *             "deepCheck":false}}</pre>
     * range 缺省 = 整仓。秒回 jobId，不等 clone。
     */
    @PostMapping("/submit")
    public ApiResponse<JsonNode> submit(@RequestBody JsonNode body) {
        return ApiResponse.ok(qa.submit(body));
    }

    /** Job 状态与 4 段进度（轮询用）。 */
    @GetMapping("/jobs/{id}")
    public ApiResponse<JsonNode> job(@PathVariable("id") String id) {
        return ApiResponse.ok(qa.jobNode(id));
    }

    /** 完成后的 qaReport v1。未完成时 400 + 「继续轮询」提示。 */
    @GetMapping("/reports/{id}")
    public ApiResponse<JsonNode> report(@PathVariable("id") String id) {
        return ApiResponse.ok(qa.reportNode(id));
    }

    /** 范围勾选数据源：该项目最近一次深检的文件索引（不重新 clone）。 */
    @GetMapping("/tree")
    public ApiResponse<JsonNode> tree(@RequestParam("projectId") String projectId) {
        return ApiResponse.ok(qa.tree(projectId));
    }

    /** 项目历史快照摘要列表。 */
    @GetMapping("/snapshots")
    public ApiResponse<JsonNode> snapshots(@RequestParam("projectId") String projectId) {
        return ApiResponse.ok(qa.snapshots(projectId));
    }
}
