package com.arsenal.projects;

import com.arsenal.autopsy.AutopsyService;
import com.arsenal.scan.IncrementalRequest;
import com.arsenal.scan.ProjectScanner;
import com.arsenal.scan.ScanException;
import com.arsenal.scan.ScanGuard;
import com.arsenal.scan.SourceResolver;
import com.arsenal.web.ApiResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.DeleteMapping;
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

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/**
 * 项目工坊 · 项目管理后端（工坊棒1）。
 *
 * <p>注册表 + 代码缓存 + 统一 projectId 的唯一写入口。所有「项目代码进缓存」都走这里，
 * 之后扫描 / 体检 / 深检读缓存，不再每请求现 clone（治「慢」的大头，见计划 D4）。
 *
 * <p>错误口径：入参形态错（缺字段 / kind 不认识 / 路径不存在）→ {@link IllegalArgumentException}
 * （由 {@code GlobalExceptionHandler} 落成 400）；业务冲突（重复 id / 限额超限 / 源头不可达 /
 * 源与缓存落点重叠）走 {@link ApiResponse#fail} 的 {@code code} 字段（CONFLICT / QUOTA_EXCEEDED /
 * SOURCE_UNREACHABLE / BAD_SOURCE），与计划书「409 / 400」语义对应 —— 单一信封，调用方按
 * {@code success} + {@code code} 分支。
 *
 * <p>projectId 算法：一律走 {@link ProjectIds#projectIdOf}（全仓唯一一份），
 * 与既有 QA 的 {@code .data/qa/<id>/} 历史逐字节对齐（暗伤止血）。
 */
@RestController
@RequestMapping("/api/projects")
public class ProjectController {

    private final ProjectRegistry registry;
    private final ProjectCache cache;
    private final ProjectStore store;
    private final ProjectScanner scanner;
    private final AutopsyService autopsy;
    private final ObjectMapper mapper;

    public ProjectController(
            @Value("${arsenal.projects.dir:}") String ymlDir,
            ObjectMapper mapper,
            ProjectRegistry registry,
            ProjectCache cache,
            ProjectScanner scanner,
            AutopsyService autopsy) {
        // registry / cache 走共享 bean（ProjectBeans，工坊棒4）：QA 侧也要读注册表与缓存根，
        // 各自 new 会造成两个内存快照互相覆盖（lastJobId 写丢、注册项被旧列表冲掉）。
        Path root = ProjectPaths.resolveRoot(ymlDir);
        this.registry = registry;
        this.cache = cache;
        this.store = new ProjectStore(root, mapper);
        this.scanner = scanner;
        this.autopsy = autopsy;
        this.mapper = mapper;
    }

    /** 列表（摘要，不 walk 源头）。 */
    @GetMapping
    public ApiResponse<List<ObjectNode>> list() {
        return ApiResponse.ok(registry.list());
    }

    /**
     * 加项目 + 摄取缓存。重复 id → CONFLICT（不创建第二个）；限额超限 → QUOTA_EXCEEDED（不留半份缓存）；
     * 源与缓存落点重叠 → BAD_SOURCE（2026-10-18：递归自我复制事故的前置拦截）。
     */
    @PostMapping
    public ApiResponse<ObjectNode> add(@RequestBody JsonNode body) {
        String name = body.path("name").asText("").trim();
        JsonNode src = body.path("source");
        if (name.isEmpty()) throw new IllegalArgumentException("name 不能为空");
        if (!src.isObject()) throw new IllegalArgumentException("缺少 source：{\"source\":{\"kind\":\"path|git\",\"value\":\"…\"}}");
        String kind = src.path("kind").asText("");
        String value = src.path("value").asText("");
        if (value.isBlank()) throw new IllegalArgumentException("source.value 是空的");
        if (!kind.equals("path") && !kind.equals("git")) {
            throw new IllegalArgumentException("source.kind 只支持 path / git，收到「" + kind + "」");
        }

        String id = ProjectIds.projectIdOf(kind, value);
        if (registry.exists(id)) {
            return ApiResponse.fail("CONFLICT", "已存在同 id 项目：" + id + "（同一地址重复添加不会建第二份）");
        }

        ObjectNode cacheStat;
        try {
            if (kind.equals("path")) {
                SourceResolver resolved = SourceResolver.fromPath(value); // 校验存在 + 真实路径
                cacheStat = cache.ingestPath(id, resolved.root());
            } else {
                if (!ScanGuard.gitUrlAllowed(value)) {
                    throw new IllegalArgumentException("只支持 https 的公开 git 地址");
                }
                cacheStat = cache.ingestGit(id, value);
            }
        } catch (ProjectIngestException e) {
            return ApiResponse.fail("QUOTA_EXCEEDED", e.getMessage());
        } catch (IllegalArgumentException e) {
            // 摄取前置校验（源与缓存落点重叠等）。这是「调用方改一下输入就好」的问题，
            // 曾被你下面的 Exception 分支吞成 SOURCE_UNREACHABLE —— 那个码的意思是
            // 「源头不可达」，而实际是源头选错了，排查方向整个反了。
            return ApiResponse.fail("BAD_SOURCE", e.getMessage());
        } catch (ScanException e) {
            return ApiResponse.fail("SOURCE_UNREACHABLE", e.getMessage());
        } catch (Exception e) {
            return ApiResponse.fail("SOURCE_UNREACHABLE", "摄取失败：" + e.getMessage());
        }

        ObjectNode entry = mapper.createObjectNode();
        entry.put("id", id);
        entry.put("name", name);
        ObjectNode source = entry.putObject("source");
        source.put("kind", kind);
        source.put("value", redact(kind, value)); // 只存脱敏值，真值不落盘
        entry.put("note", "");
        entry.put("addedAt", nowIso());
        entry.set("cache", cacheStat);
        entry.putNull("lastFactsAt");
        entry.putNull("lastJobId");
        registry.add(entry);
        return ApiResponse.ok(entry);
    }

    /** 详情 + 新鲜度（path：walk 源头比对；git：一期「未检测」）。 */
    @GetMapping("/{id}")
    public ApiResponse<ObjectNode> detail(@PathVariable("id") String id) {
        ObjectNode entry = registry.find(id).orElse(null);
        if (entry == null) {
            return ApiResponse.fail("NOT_FOUND", "项目不在了：" + safe(id));
        }
        ObjectNode out = entry.deepCopy();
        String kind = entry.path("source").path("kind").asText("");
        String value = entry.path("source").path("value").asText("");
        if (kind.equals("path")) {
            try {
                out.set("freshness", cache.freshness(id, Path.of(value)));
            } catch (Exception e) {
                ObjectNode fr = mapper.createObjectNode();
                fr.put("mode", "unscanned");
                fr.put("reason", e.getMessage());
                out.set("freshness", fr);
            }
        } else {
            ObjectNode fr = mapper.createObjectNode();
            fr.put("mode", "unscanned");
            fr.put("reason", "git 源头新鲜度一期未检测，点刷新同步");
            out.set("freshness", fr);
        }
        return ApiResponse.ok(out);
    }

    /** 刷新缓存（path：增量同步；git：fetch+reset）。源头不可达 → SOURCE_UNREACHABLE，旧缓存原样保留。 */
    @PostMapping("/{id}/refresh")
    public ApiResponse<ObjectNode> refresh(@PathVariable("id") String id) {
        ObjectNode entry = registry.find(id).orElse(null);
        if (entry == null) return ApiResponse.fail("NOT_FOUND", "项目不在了：" + safe(id));
        String kind = entry.path("source").path("kind").asText("");
        String value = entry.path("source").path("value").asText("");
        try {
            if (kind.equals("path")) {
                ObjectNode stat = cache.refresh(id, Path.of(value));
                applyCacheStat(entry, stat);
                return ApiResponse.ok(entry);
            } else {
                // git 一期：fetch+reset 由 SourceResolver 不负责；直接失败明说
                return ApiResponse.fail("SOURCE_UNREACHABLE", "git 刷新一期未实现（fetch+reset 待补），旧缓存原样保留");
            }
        } catch (ProjectIngestException e) {
            return ApiResponse.fail("QUOTA_EXCEEDED", e.getMessage());
        } catch (IllegalArgumentException e) {
            // 与 add 同口径：源与缓存落点重叠 → BAD_SOURCE（源头选错，不是服务端故障）
            return ApiResponse.fail("BAD_SOURCE", e.getMessage());
        } catch (Exception e) {
            return ApiResponse.fail("SOURCE_UNREACHABLE", "刷新失败，旧缓存原样保留：" + e.getMessage());
        }
    }

    /** 删除：摘注册项 + 删缓存/facts/体检留档；QA 历史（.data/qa/<id>/）保留（审计痕迹）。 */
    @DeleteMapping("/{id}")
    public ApiResponse<ObjectNode> delete(@PathVariable("id") String id) {
        ObjectNode entry = registry.find(id).orElse(null);
        if (entry == null) return ApiResponse.fail("NOT_FOUND", "项目不在了：" + safe(id));
        cache.deleteCache(id);
        store.deleteAll(id);
        registry.remove(id);
        ObjectNode out = mapper.createObjectNode();
        out.put("deleted", id);
        out.put("qaHistoryKept", true);
        out.put("note", ".data/qa/" + id + "/ 历史报告已保留");
        return ApiResponse.ok(out);
    }

    // ── facts / checkups 服务端留档 ──

    @GetMapping("/{id}/facts")
    public ApiResponse<JsonNode> getFacts(@PathVariable("id") String id) {
        if (!store.hasFacts(id)) return ApiResponse.fail("NOT_FOUND", "还没扫过：" + safe(id));
        try {
            return ApiResponse.ok(store.readFacts(id));
        } catch (Exception e) {
            return ApiResponse.fail("READ_ERROR", e.getMessage());
        }
    }

    /** 重扫缓存 → 更新 facts 缓存，返回 facts。 */
    @PostMapping("/{id}/scan")
    public ApiResponse<JsonNode> scan(@PathVariable("id") String id) {
        Path repo = cache.resolve(id);
        if (repo == null) return ApiResponse.fail("NOT_FOUND", "缓存不存在：" + safe(id));
        try {
            JsonNode facts = scanner.scan(SourceResolver.fromPath(repo.toString()), IncrementalRequest.none());
            store.writeFacts(id, facts);
            ObjectNode entry = registry.find(id).orElse(null);
            if (entry != null) {
                entry.put("lastFactsAt", nowIso());
                registry.replace(entry);
            }
            return ApiResponse.ok(facts);
        } catch (Exception e) {
            return ApiResponse.fail("SCAN_ERROR", e.getMessage());
        }
    }

    @GetMapping("/{id}/checkups")
    public ApiResponse<List<ObjectNode>> checkupHistory(@PathVariable("id") String id) {
        try {
            return ApiResponse.ok(store.checkupHistory(id));
        } catch (Exception e) {
            return ApiResponse.fail("READ_ERROR", e.getMessage());
        }
    }

    @GetMapping("/{id}/checkups/latest")
    public ApiResponse<JsonNode> checkupLatest(@PathVariable("id") String id) {
        if (!store.hasCheckup(id)) return ApiResponse.fail("NOT_FOUND", "还没体检过：" + safe(id));
        try {
            return ApiResponse.ok(store.readCheckupLatest(id));
        } catch (Exception e) {
            return ApiResponse.fail("READ_ERROR", e.getMessage());
        }
    }

    /** 跑一次体检（读缓存）→ 写 latest + history。 */
    @PostMapping("/{id}/checkup")
    public ApiResponse<JsonNode> checkup(@PathVariable("id") String id) {
        Path repo = cache.resolve(id);
        if (repo == null) return ApiResponse.fail("NOT_FOUND", "缓存不存在：" + safe(id));
        try {
            ObjectNode report = autopsy.inspect(SourceResolver.fromPath(repo.toString()));
            // 内容级指纹戳（工坊棒3）：L1 复用判据的比对锚点。留档时把「这次体检
            // 对着哪份缓存内容」钉进报告 —— 前端拿它与注册表当前 cache.fingerprint
            // 比对，相等才许复用；旧留档没有戳 → 前端照实说「无法内容级校验」并真扫。
            // 不盖章的话，「缓存换过内容」与「报告还是那份」在页面上长得一模一样。
            String cacheFingerprint = null;
            ObjectNode entry = registry.find(id).orElse(null);
            if (entry != null && entry.has("cache") && entry.get("cache").has("fingerprint")
                    && !entry.get("cache").get("fingerprint").isNull()) {
                cacheFingerprint = entry.get("cache").get("fingerprint").asText();
            }
            report.put("cacheFingerprint", cacheFingerprint);
            report.put("checkedAt", nowIso());
            store.writeCheckup(id, report);
            return ApiResponse.ok(report);
        } catch (Exception e) {
            return ApiResponse.fail("CHECKUP_ERROR", e.getMessage());
        }
    }

    // ─────────────────────────────────────────────────────────────

    private void applyCacheStat(ObjectNode entry, ObjectNode stat) {
        entry.set("cache", stat);
        registry.replace(entry);
    }

    /** 脱敏：git 地址里的 user:token@ 变成 user:***@；path 原样（本地目录无凭据）。 */
    private static String redact(String kind, String value) {
        if (!kind.equals("git")) return value;
        return value.replaceAll("://([^:/@]+):[^@]*@", "://$1:***@");
    }

    private static String safe(String s) {
        return s == null ? "" : s.replaceAll("[^A-Za-z0-9_-]", "");
    }

    private static String nowIso() {
        return java.time.OffsetDateTime.now(java.time.ZoneOffset.ofHours(8)).toString();
    }
}
