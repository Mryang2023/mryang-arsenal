package com.arsenal.projects;

import com.arsenal.web.ApiResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;

/**
 * 接口文档 · <b>只对账、只出稿、不写仓库</b>。
 *
 * <p>这是模块开发打法里第 ⑤ 步的落点。用户要把接口文档交给前端同事，所以这里做两件事：
 * <ul>
 *   <li>{@code GET /apidoc/verify?module=customer} —— 把 Controller 里的真实接口与
 *       {@code docs/api/<module>.md} 逐条对账，回答「文档缺哪几个、多哪几个」。
 *       {@code .openapi.json} 也按同样口径核对，防止附件悄悄过期。</li>
 *   <li>{@code POST /apidoc/plan} —— 按代码生成一份 Markdown + OpenAPI <b>草稿</b>。
 *       草稿只放在响应里（{@code writes:false}），由人补完请求/响应字段后自己提交。</li>
 * </ul>
 *
 * <p>为什么不让军火库直接写进 {@code docs/api/}：那一步属于「操作被管理项目」。
 * 文档里要写业务错误码、字段含义、示例，这些是人的判断，不是扫描能补出来的。
 * 军火库把骨架和差异摆出来，落笔仍然在人。
 *
 * <p>留档（{@code apidoc-plans/}）只是记「什么时候生成过哪份草稿」，与仓库内容无关。
 */
@RestController
@RequestMapping("/api/projects/{id}/apidoc")
public class ApiDocController {

    /** 模块名口径与文档文件名一致：英文小写，可带连字符。 */
    private static final String MODULE_PATTERN = "[a-z][a-z0-9-]*";

    private final ProjectRegistry registry;
    private final ProjectCache cache;
    private final ProjectStore store;
    private final ApiDocService apiDoc;
    private final ObjectMapper mapper;

    public ApiDocController(
            @Value("${arsenal.projects-dir:}") String ymlDir,
            ObjectMapper mapper,
            ProjectRegistry registry,
            ProjectCache cache) {
        Path root = ProjectPaths.resolveRoot(ymlDir);
        this.registry = registry;
        this.cache = cache;
        this.mapper = mapper;
        this.store = new ProjectStore(root, mapper);
        this.apiDoc = new ApiDocService(mapper);
    }

    /** 文档与代码对账。只读，可随时重跑。 */
    @GetMapping("/verify")
    public ApiResponse<ObjectNode> verify(@PathVariable("id") String id,
                                          @RequestParam(value = "module", required = false) String module) {
        Path repo = repo(id);
        if (repo == null) return ApiResponse.fail("NOT_FOUND", "项目或缓存不存在：" + safe(id));
        String m = requireModule(module);
        return ApiResponse.ok(apiDoc.verify(repo, m));
    }

    /**
     * 生成接口文档草稿。{@code record:false} 时只看不留档。
     *
     * <p>请求体：{@code {"module":"customer","record":true}}。模块名也可以放在 query 上，
     * 方便浏览器直接点。
     */
    @PostMapping("/plan")
    public ApiResponse<ObjectNode> plan(@PathVariable("id") String id,
                                        @RequestParam(value = "module", required = false) String queryModule,
                                        @RequestBody(required = false) JsonNode body) {
        Path repo = repo(id);
        if (repo == null) return ApiResponse.fail("NOT_FOUND", "项目或缓存不存在：" + safe(id));

        String raw = body != null && body.has("module") ? body.path("module").asText("") : queryModule;
        String m = requireModule(raw);

        ObjectNode resp = apiDoc.plan(repo, m);
        // ApiDocService 的响应是 {kind, module, notes, plan:{...}}；留档只存里面的 plan，
        // 外面那层是这次调用的上下文，再存一遍没意义。
        JsonNode planNode = resp.path("plan");
        if (!(planNode instanceof ObjectNode plan)) {
            return ApiResponse.fail("INTERNAL", "生成器没有返回计划正文");
        }

        boolean record = body == null || !body.has("record") || body.path("record").asBoolean(true);
        if (record) {
            plan.put("recordedAt", OffsetDateTime.now(ZoneOffset.ofHours(8)).toString());
            try {
                store.writeApiDocPlan(id, plan.path("planId").asText(), plan);
                plan.put("recorded", true);
            } catch (IOException e) {
                // 和 DDL 一样：留档失败不能把已经生成好的稿子丢掉。
                plan.put("recorded", false);
                plan.put("recordError", e.getMessage());
            }
        } else {
            plan.put("recorded", false);
        }
        return ApiResponse.ok(resp);
    }

    /** 草稿留档列表（摘要，不含正文）。 */
    @GetMapping("/plans")
    public ApiResponse<ArrayNode> plans(@PathVariable("id") String id) {
        if (registry.find(id).isEmpty()) {
            return ApiResponse.fail("NOT_FOUND", "项目不在了：" + safe(id));
        }
        ArrayNode out = mapper.createArrayNode();
        try {
            for (ObjectNode p : store.listApiDocPlans(id)) {
                out.add(summary(p));
            }
        } catch (IOException e) {
            return ApiResponse.fail("READ_ERROR", "留档读不了：" + e.getMessage());
        }
        return ApiResponse.ok(out);
    }

    /** 单份草稿全文（含两份文档正文）。 */
    @GetMapping("/plans/{planId}")
    public ApiResponse<JsonNode> plan(@PathVariable("id") String id,
                                      @PathVariable("planId") String planId) {
        if (registry.find(id).isEmpty()) {
            return ApiResponse.fail("NOT_FOUND", "项目不在了：" + safe(id));
        }
        try {
            return ApiResponse.ok(store.readApiDocPlan(id, planId));
        } catch (NoSuchFileException e) {
            return ApiResponse.fail("NOT_FOUND", "草稿不存在：" + safe(planId));
        } catch (IOException e) {
            return ApiResponse.fail("READ_ERROR", "草稿读不了：" + e.getMessage());
        }
    }

    // ─────────────────────────────────────────────────────────────

    private String requireModule(String raw) {
        String m = raw == null ? "" : raw.trim().toLowerCase();
        if (!m.matches(MODULE_PATTERN)) {
            throw new IllegalArgumentException(
                    "module 必须是英文小写模块名（如 customer、equipment），收到：" + safe(raw));
        }
        return m;
    }

    /** 摘要不带 artifacts：一份草稿两份文档，正文能把列表响应撑到几十万字。 */
    private ObjectNode summary(ObjectNode p) {
        ObjectNode n = mapper.createObjectNode();
        n.put("planId", p.path("planId").asText(""));
        n.put("recordedAt", p.path("recordedAt").asText(""));
        n.put("generatedAt", p.path("generatedAt").asText(""));
        n.put("module", p.path("module").asText(""));
        n.set("stats", p.path("stats"));
        ArrayNode files = n.putArray("files");
        JsonNode artifacts = p.path("artifacts");
        if (artifacts.isObject()) {
            for (String key : artifacts.propertyNames()) {
                JsonNode a = artifacts.path(key);
                ObjectNode f = files.addObject();
                f.put("kind", key);
                f.put("path", a.path("path").asText(""));
                f.put("action", a.path("action").asText(""));
                f.put("chars", a.path("content").asText("").length());
            }
        }
        return n;
    }

    private Path repo(String id) {
        if (registry.find(id).isEmpty()) return null;
        return cache.resolve(id);
    }

    private static String safe(String s) {
        return s == null ? "" : s.replaceAll("[\\r\\n]", " ");
    }
}
