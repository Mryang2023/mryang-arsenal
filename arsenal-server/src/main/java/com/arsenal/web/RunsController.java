package com.arsenal.web;

import com.arsenal.autopsy.AutopsyService;
import com.arsenal.loader.RuleIndex;
import com.arsenal.projects.ProjectCache;
import com.arsenal.projects.ProjectRegistry;
import com.arsenal.runs.ReportService;
import com.arsenal.runs.RunStore;
import com.arsenal.scan.SourceResolver;
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

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/**
 * Run 端点（重建设计计划 §7.3 的 v2 第一批）。
 *
 * <p>重建的主张：体检不再只产出「页面读数」，每次执行都是一次 <b>Run</b> ——
 * run.json（状态账）+ findings.jsonl（一行一条问题）+ coverage.json（覆盖率披露）
 * 全部落盘，报告与下载都从这些文件长出来（N3/N4），而不是从页面状态里捞。
 *
 * <p>静态引擎复用 {@link AutopsyService#inspect}（与 /api/autopsy、体检端点同一台引擎，
 * 不另造第二套判定）。本控制器只做编排：校验 → 开 run → 跑引擎 → 落盘 → 收口。
 * 引擎抛任何异常都不吞：run 记 FAILED、写 error.txt，响应如实回 RUN_ERROR ——
 * 「跑失败」与「跑过没问题」必须是两种看得见的状态。
 */
@RestController
@RequestMapping("/api/v2/projects/{projectId}/runs")
public class RunsController {

    private final ProjectRegistry registry;
    private final ProjectCache cache;
    private final AutopsyService autopsy;
    private final RuleIndex index;
    private final RunStore runs;
    private final ObjectMapper mapper;

    public RunsController(ProjectRegistry registry, ProjectCache cache, AutopsyService autopsy,
                          RuleIndex index, RunStore runs, ObjectMapper mapper) {
        this.registry = registry;
        this.cache = cache;
        this.autopsy = autopsy;
        this.index = index;
        this.runs = runs;
        this.mapper = mapper;
    }

    /** 提交一次体检 run（同步执行 —— 静态层秒级到分钟级，异步 Job 是 QA 老路的事，这里不混）。 */
    @PostMapping
    public ApiResponse<ObjectNode> create(@PathVariable("projectId") String projectId,
                                          @RequestBody(required = false) JsonNode body) {
        ObjectNode entry = registry.find(projectId).orElse(null);
        if (entry == null) {
            return ApiResponse.fail("NOT_FOUND", "项目不在注册表里：" + projectId + "。先在项目管理里添加。");
        }
        Path repo = cache.resolve(projectId);
        if (repo == null || !Files.isDirectory(repo)) {
            return ApiResponse.fail("NOT_FOUND", "缓存不存在：" + projectId + "。先刷新项目让代码进缓存。");
        }

        ObjectNode manifest = mapper.createObjectNode();
        manifest.put("snapshot", fingerprintOf(entry));
        manifest.put("rulesetVersion", index.meta() == null ? "unknown" : String.valueOf(index.meta().version()));
        manifest.put("engine", "static(regex+ast)");
        manifest.put("triggeredBy", "api");

        RunStore.RunRef ref = runs.start(projectId, manifest);
        long start = System.currentTimeMillis();
        try {
            ObjectNode report = autopsy.inspect(SourceResolver.fromPath(repo.toString()));
            int[] counts = writeFindings(ref, report);
            writeCoverage(ref, report);
            // report.md 在 complete 之前落盘 —— DONE 状态必须蕴含「报告已在」，不许出现
            // 「run 说完成了、报告却不存在」的账。
            ObjectNode runAccount = runs.read(projectId, ref.runId())
                    .orElseThrow(() -> new IllegalStateException("run.json 刚写完就丢了：" + ref.runId()));
            runs.writeFile(ref, "report.md", ReportService.render(runAccount, report));
            writeSummary(ref, counts, System.currentTimeMillis() - start);
            runs.complete(projectId, ref.runId(), "DONE");
            return ApiResponse.ok(doneNode(ref, counts, System.currentTimeMillis() - start));
        } catch (Exception e) {
            runs.complete(projectId, ref.runId(), "FAILED");
            try {
                runs.writeFile(ref, "error.txt", String.valueOf(e));
            } catch (RuntimeException ignored) {
                // 连 error.txt 都写不进去时不再叠加第二个异常 —— run.json 的 FAILED 已是事实
            }
            return ApiResponse.fail("RUN_ERROR", "体检执行失败：" + e.getMessage());
        }
    }

    /** 项目下全部 run，新的在前（列表来自磁盘，不是内存 —— 重启不丢账）。 */
    @GetMapping
    public ApiResponse<List<ObjectNode>> list(@PathVariable("projectId") String projectId) {
        if (registry.find(projectId).isEmpty()) {
            return ApiResponse.fail("NOT_FOUND", "项目不在注册表里：" + projectId);
        }
        return ApiResponse.ok(runs.list(projectId));
    }

    // ── 落盘细节 ──────────────────────────────────────────────

    /** findings.jsonl：p0/p1/other 三个桶各元素一行紧凑 JSON。返回 {p0,p1,other} 计数。 */
    private int[] writeFindings(RunStore.RunRef ref, ObjectNode report) {
        StringBuilder lines = new StringBuilder();
        int p0 = appendBucket(lines, report.get("p0"));
        int p1 = appendBucket(lines, report.get("p1"));
        int other = appendBucket(lines, report.get("other"));
        runs.writeFile(ref, "findings.jsonl", lines.toString());
        return new int[]{p0, p1, other};
    }

    private int appendBucket(StringBuilder lines, JsonNode bucket) {
        int count = 0;
        if (bucket instanceof ArrayNode arr) {
            for (JsonNode f : arr) {
                lines.append(mapper.writeValueAsString(f)).append('\n');
                count++;
            }
        }
        return count;
    }

    private void writeCoverage(RunStore.RunRef ref, ObjectNode report) {
        JsonNode cov = report.get("coverage");
        runs.writeFile(ref, "coverage.json",
                cov == null ? "{}" : cov.toPrettyString());
    }

    private void writeSummary(RunStore.RunRef ref, int[] counts, long elapsedMs) {
        ObjectNode s = mapper.createObjectNode();
        s.put("p0", counts[0]);
        s.put("p1", counts[1]);
        s.put("other", counts[2]);
        s.put("elapsedMs", elapsedMs);
        runs.writeFile(ref, "summary.json", s.toPrettyString());
    }

    private ObjectNode doneNode(RunStore.RunRef ref, int[] counts, long elapsedMs) {
        ObjectNode out = mapper.createObjectNode();
        out.put("runId", ref.runId());
        out.put("projectId", ref.projectId());
        out.put("status", "DONE");
        out.put("elapsedMs", elapsedMs);
        ObjectNode c = out.putObject("counts");
        c.put("p0", counts[0]);
        c.put("p1", counts[1]);
        c.put("other", counts[2]);
        ArrayNode files = out.putArray("files");
        files.add("run.json").add("findings.jsonl").add("coverage.json").add("summary.json");
        return out;
    }

    private static String fingerprintOf(ObjectNode entry) {
        JsonNode fp = entry.path("cache").path("fingerprint");
        return fp.isString() && !fp.asString("").isEmpty() ? fp.asString() : "unknown";
    }
}
