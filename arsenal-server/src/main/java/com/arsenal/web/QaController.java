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
    /** 注册表（工坊棒4，共享 bean）：submit 成功后回写 lastJobId ——「切走再回来续跑」的唯一线索。 */
    private final com.arsenal.projects.ProjectRegistry registry;

    public QaController(QaService qa, com.arsenal.projects.ProjectRegistry registry) {
        this.qa = qa;
        this.registry = registry;
    }

    /**
     * 数字孪生 · 对话问诊：对着一个项目的活档案问一句话。
     *
     * <p>请求体：{@code {"question":"…","source":{…}}}。<b>入参校验全在这一层</b> ——
     * {@code GlobalExceptionHandler} 会把 400 吃成 500，那会让「参数写错了」变成「后端炸了」。
     *
     * <p>返回体里 {@code dossier}（哪层有数据）与 {@code numberAudit}（答案里的数字有没有出处）
     * 是这个接口真正的价值 —— 它们让「答得流畅但数字是编的」这件事能被看见。
     */
    @PostMapping("/ask")
    public ApiResponse<JsonNode> ask(@RequestBody JsonNode body) {
        JsonNode q = body == null ? null : body.get("question");
        if (q == null || !q.isTextual() || q.asString("").isBlank()) {
            throw new IllegalArgumentException("缺少 question（问诊不猜你想问什么）");
        }
        if (q.asString("").length() > 500) {
            throw new IllegalArgumentException("question 太长了（最多 500 字）");
        }
        return ApiResponse.ok(qa.ask(body.path("question").asString(""), body.path("source")));
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
        JsonNode out = qa.submit(body);
        // 工坊棒4：lastJobId 回写。项目不在注册表（source 老路）时 touchLastJob 静默跳过。
        registry.touchLastJob(out.path("projectId").asText(""), out.path("jobId").asText(""));
        return ApiResponse.ok(out);
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

    /** LLM 语义层配置状态。前端据此决定「深度检测」勾选框放不放行 —— 只回状态与模型名，绝不回 key。 */
    @GetMapping("/llm-status")
    public ApiResponse<JsonNode> llmStatus() {
        return ApiResponse.ok(qa.llmStatus());
    }
}
