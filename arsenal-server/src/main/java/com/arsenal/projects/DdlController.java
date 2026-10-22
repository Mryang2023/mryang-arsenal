package com.arsenal.projects;

import com.arsenal.web.ApiResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
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
import java.util.List;

/**
 * DDL 变更留档 · <b>只生成、只审计、不操作</b>。
 *
 * <p>这个控制器是整个「军火库管 IEMS」改造的边界线，写在这里免得以后有人顺手加错：
 * <ul>
 *   <li>{@code POST /ddl/plan} —— 生成四件套正文 + 校验。正文放在响应里，
 *       <b>不写进被管理项目的任何文件</b>（{@code writes:false}）。</li>
 *   <li>{@code GET /ddl/verify} —— 只读审计每个表的四件套完整性。</li>
 *   <li>{@code /ddl/plans} —— 军火库<b>自己</b>的计划留档（{@code .data/projects/<id>/ddl-plans/}），
 *       用来回答「这张表的变更什么时候被计划过」，与实际落盘与否无关。</li>
 * </ul>
 * 没有 apply / write / execute 端点，以后也不要加 —— 那会让军火库从「记录者」变成「操作者」，
 * 而用户要的正是前者。
 */
@RestController
@RequestMapping("/api/projects/{id}/ddl")
public class DdlController {

    private final ProjectRegistry registry;
    private final ProjectCache cache;
    private final ProjectStore store;
    private final DdlPlanService planner;
    private final DdlVerifyService verifier;
    private final ObjectMapper mapper;

    public DdlController(
            @Value("${arsenal.projects-dir:}") String ymlDir,
            ObjectMapper mapper,
            ProjectRegistry registry,
            ProjectCache cache) {
        Path root = ProjectPaths.resolveRoot(ymlDir);
        this.registry = registry;
        this.cache = cache;
        this.mapper = mapper;
        // store 与 ProjectController 各持一份：它只有 root + mapper 两个不可变字段，
        // 不像 registry/cache 有内存快照，重复 new 不会互相覆盖。
        this.store = new ProjectStore(root, mapper);
        DossierService dossier = new DossierService(mapper);
        this.planner = new DdlPlanService(mapper, dossier);
        this.verifier = new DdlVerifyService(mapper, dossier);
    }

    /**
     * 生成变更计划。{@code record:false} 时只看不留档。
     *
     * <p>入参形态错抛 {@link IllegalArgumentException} → 400 BAD_REQUEST（调用方改输入即可）。
     */
    @PostMapping("/plan")
    public ApiResponse<ObjectNode> plan(@PathVariable("id") String id, @RequestBody(required = false) JsonNode body) {
        Path repo = repo(id);
        if (repo == null) return ApiResponse.fail("NOT_FOUND", "项目或缓存不存在：" + safe(id));
        if (body == null) throw new IllegalArgumentException("请求体不能为空");

        ObjectNode plan = planner.plan(repo, body);

        boolean record = !body.has("record") || body.path("record").asBoolean(true);
        if (record) {
            String planId = plan.path("planId").asText();
            plan.put("recordedAt", OffsetDateTime.now(ZoneOffset.ofHours(8)).toString());
            try {
                store.writePlan(id, planId, plan);
                plan.put("recorded", true);
            } catch (IOException e) {
                // 留档失败不该让「已经生成好的稿子」丢掉：正文照常返回，只是说明没留下记录。
                plan.put("recorded", false);
                plan.put("recordError", e.getMessage());
            }
        } else {
            plan.put("recorded", false);
        }
        return ApiResponse.ok(plan);
    }

    /** 四件套完整性审计。只读，可随时重跑。 */
    @GetMapping("/verify")
    public ApiResponse<ObjectNode> verify(@PathVariable("id") String id) {
        Path repo = repo(id);
        if (repo == null) return ApiResponse.fail("NOT_FOUND", "项目或缓存不存在：" + safe(id));
        return ApiResponse.ok(verifier.verify(repo));
    }

    /** 计划留档列表（摘要）。按记录时间倒序。 */
    @GetMapping("/plans")
    public ApiResponse<ArrayNode> plans(@PathVariable("id") String id) {
        if (!registry.find(id).isPresent()) {
            return ApiResponse.fail("NOT_FOUND", "项目不在了：" + safe(id));
        }
        ArrayNode out = mapper.createArrayNode();
        try {
            for (ObjectNode p : store.listPlans(id)) {
                out.add(summary(p));
            }
        } catch (IOException e) {
            return ApiResponse.fail("READ_ERROR", "计划留档读不了：" + e.getMessage());
        }
        return ApiResponse.ok(out);
    }

    /** 单份计划全文（含四件套正文），用于把当时生成的稿子原样取回。 */
    @GetMapping("/plans/{planId}")
    public ApiResponse<JsonNode> plan(@PathVariable("id") String id, @PathVariable("planId") String planId) {
        if (!registry.find(id).isPresent()) {
            return ApiResponse.fail("NOT_FOUND", "项目不在了：" + safe(id));
        }
        try {
            return ApiResponse.ok(store.readPlan(id, planId));
        } catch (NoSuchFileException e) {
            return ApiResponse.fail("NOT_FOUND", "计划不存在：" + safe(planId));
        } catch (IOException e) {
            return ApiResponse.fail("READ_ERROR", "计划读不了：" + e.getMessage());
        }
    }

    // ─────────────────────────────────────────────────────────────

    /** 摘要刻意不带 artifacts：列表页一屏几十条，正文几万字会把响应撑爆。 */
    private ObjectNode summary(ObjectNode p) {
        ObjectNode n = mapper.createObjectNode();
        n.put("planId", p.path("planId").asText(""));
        n.put("recordedAt", p.path("recordedAt").asText(""));
        n.put("generatedAt", p.path("generatedAt").asText(""));
        n.put("table", p.path("table").asText(""));
        n.put("title", p.path("title").asText(""));
        n.put("operation", p.path("operation").asText(""));
        n.put("module", p.path("module").asText(""));
        n.put("date", p.path("date").asText(""));
        n.set("paths", p.path("paths"));
        n.set("stats", p.path("stats"));
        ArrayNode severe = n.putArray("problems");
        JsonNode warnings = p.path("warnings");
        if (warnings.isArray()) {
            for (JsonNode w : warnings) {
                if (!"info".equals(w.path("level").asText())) severe.add(w);
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
