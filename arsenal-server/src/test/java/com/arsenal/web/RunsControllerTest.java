package com.arsenal.web;

import com.arsenal.autopsy.AutopsyService;
import com.arsenal.domain.RulesetMeta;
import com.arsenal.loader.RuleIndex;
import com.arsenal.projects.ProjectCache;
import com.arsenal.projects.ProjectRegistry;
import com.arsenal.runs.RunStore;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.Mockito;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * RunsController 的分支级护栏（ROADMAP N2）。
 *
 * 守四条分支：项目不在（404 语义）/ 缓存不在（404 语义）/ 正常 run（三文件落盘 +
 * findings 行数与 coverage 口径一致）/ 引擎炸（run 记 FAILED、错误如实回，
 * 绝不把「跑失败」说成「跑过没问题」）。AutopsyService 用 mock —— 引擎本体
 * 另有链路守着，这里只验编排与落盘。
 */
class RunsControllerTest {

    @TempDir
    Path temp;

    private final ObjectMapper mapper = tools.jackson.databind.json.JsonMapper.builder()
            .enable(tools.jackson.databind.SerializationFeature.INDENT_OUTPUT)
            .build();
    private ProjectRegistry registry;
    private ProjectCache cache;
    private AutopsyService autopsy;
    private RuleIndex index;
    private RunStore store;
    private RunsController controller;

    @BeforeEach
    void setUp() {
        registry = Mockito.mock(ProjectRegistry.class);
        cache = Mockito.mock(ProjectCache.class);
        autopsy = Mockito.mock(AutopsyService.class);
        index = Mockito.mock(RuleIndex.class);
        // 模拟 Spring 注入的 mapper（字段初始化处已开 INDENT_OUTPUT）：Boot 4 给 HTTP 响应
        // 配了 pretty printer（真实事故来源 —— 控制器若直接用它写 findings.jsonl，
        // 200 条 finding 会被展开成 1.1 万行）。控制器内部的紧凑 writer 必须顶住这个配置，
        // JSONL 才是一行一个对象。
        store = new RunStore(temp, mapper);
        controller = new RunsController(registry, cache, autopsy, index, store, mapper);
    }

    private ObjectNode entry(String fingerprint) {
        ObjectNode e = mapper.createObjectNode();
        ObjectNode src = e.putObject("source");
        src.put("kind", "path");
        src.put("value", "D:/some/project");
        ObjectNode c = e.putObject("cache");
        c.put("fingerprint", fingerprint);
        return e;
    }

    private ObjectNode fakeReport() {
        ObjectNode report = mapper.createObjectNode();
        ObjectNode f1 = report.putArray("p0").addObject();
        f1.put("ruleId", "REL-LOG-001");
        f1.put("title", "禁止使用 System.out 输出");
        f1.put("severity", "NEVER");
        f1.put("file", "src/main/java/demo/A.java");
        f1.put("line", 12);
        f1.put("snippet", "System.out.println(1);");
        f1.put("evidence", "src/main/java/demo/A.java:12");
        ObjectNode f2 = report.putArray("p1").addObject();
        f2.put("ruleId", "WEB-CTRL-002");
        f2.put("severity", "MUST");
        f2.put("file", "src/main/java/demo/B.java");
        f2.put("line", 30);
        f2.put("evidence", "src/main/java/demo/B.java:30");
        report.putArray("other");
        ObjectNode cov = report.putObject("coverage");
        cov.put("total", 69);
        cov.put("executed", 42);
        cov.put("notRun", 27);
        return report;
    }

    private Path fakeCacheRoot() throws Exception {
        Path repo = temp.resolve("repo");
        Files.createDirectories(repo.resolve("src"));
        Files.writeString(repo.resolve("src/A.java"), "class A { void m(){ System.out.println(1); } }\n");
        return repo;
    }

    private RulesetMeta meta() {
        return new RulesetMeta("arsenal-rules", "军火库", "arsenal", "0.1.0", "2026-09-11", "d",
                Map.of(), Map.of(), null, Map.of(), Map.of(), List.of(), List.of());
    }

    @Test
    void unknownProjectIsNotFound() {
        when(registry.find("nosuch")).thenReturn(Optional.empty());
        ApiResponse<ObjectNode> out = controller.create("nosuch", null);
        assertFalse(out.success());
        assertEquals("NOT_FOUND", out.code());
        assertTrue(store.list("nosuch").isEmpty(), "被拒的请求不许留下半个 run 目录");
    }

    @Test
    void missingCacheIsNotFound() throws Exception {
        when(registry.find("proj01")).thenReturn(Optional.of(entry("fp")));
        when(cache.resolve("proj01")).thenReturn(null);
        ApiResponse<ObjectNode> out = controller.create("proj01", null);
        assertFalse(out.success());
        assertEquals("NOT_FOUND", out.code());
        assertTrue(store.list("proj01").isEmpty());
    }

    @Test
    void createRunWritesFindingsCoverageAndClosesDone() throws Exception {
        when(registry.find("proj01")).thenReturn(Optional.of(entry("dir:371:5938261")));
        when(cache.resolve("proj01")).thenReturn(fakeCacheRoot());
        when(index.meta()).thenReturn(meta());
        when(autopsy.inspect(any())).thenReturn(fakeReport());

        ApiResponse<ObjectNode> out = controller.create("proj01", null);
        assertTrue(out.success(), "正常 run 应成功：" + out.message());
        ObjectNode data = out.data();
        String runId = data.path("runId").asString();
        assertEquals("DONE", data.path("status").asString());
        assertEquals(1, data.path("counts").path("p0").asInt());
        assertEquals(1, data.path("counts").path("p1").asInt());

        Path dir = store.dirOf("proj01", runId).orElseThrow();
        assertEquals("DONE", store.read("proj01", runId).orElseThrow().path("status").asString());
        assertEquals("dir:371:5938261",
                store.read("proj01", runId).orElseThrow().path("manifest").path("snapshot").asString());
        assertEquals("0.1.0",
                store.read("proj01", runId).orElseThrow().path("manifest").path("rulesetVersion").asString());

        List<String> lines = Files.readAllLines(dir.resolve("findings.jsonl"), StandardCharsets.UTF_8);
        assertEquals(2, lines.size(), "findings 每条一行");
        ObjectNode first = (ObjectNode) mapper.readTree(lines.get(0));
        assertEquals("REL-LOG-001", first.path("ruleId").asString());
        assertEquals(12, first.path("line").asInt(), "finding 必须带行号 —— 这是报告可信度的地基");

        ObjectNode cov = (ObjectNode) mapper.readTree(Files.readString(dir.resolve("coverage.json"), StandardCharsets.UTF_8));
        assertEquals(42, cov.path("executed").asInt());
        assertEquals(69, cov.path("total").asInt());
        assertEquals(27, cov.path("notRun").asInt(), "coverage 原样落盘，不改数字");

        assertTrue(Files.isRegularFile(dir.resolve("report.md")), "DONE 状态必须蕴含 report.md 已落盘");
        String md = Files.readString(dir.resolve("report.md"), StandardCharsets.UTF_8);
        assertTrue(md.contains("本次覆盖"), "报告必须有覆盖率披露");
        assertTrue(md.contains("run " + runId), "报告必须署上 runId");
    }

    @Test
    void engineFailureMarksRunFailedAndTellsTheTruth() throws Exception {
        when(registry.find("proj01")).thenReturn(Optional.of(entry("fp")));
        when(cache.resolve("proj01")).thenReturn(fakeCacheRoot());
        when(index.meta()).thenReturn(meta());
        when(autopsy.inspect(any())).thenThrow(new RuntimeException("引擎炸了"));

        ApiResponse<ObjectNode> out = controller.create("proj01", null);
        assertFalse(out.success());
        assertEquals("RUN_ERROR", out.code());

        List<ObjectNode> runs = store.list("proj01");
        assertEquals(1, runs.size(), "失败也是一次 run，账上必须有");
        assertEquals("FAILED", runs.get(0).path("status").asString());
        Path dir = store.dirOf("proj01", runs.get(0).path("runId").asString()).orElseThrow();
        assertTrue(Files.readString(dir.resolve("error.txt"), StandardCharsets.UTF_8).contains("引擎炸了"),
                "失败原因要落盘可查");
    }

    @Test
    void listRequiresKnownProject() {
        when(registry.find("nosuch")).thenReturn(Optional.empty());
        ApiResponse<List<ObjectNode>> out = controller.list("nosuch");
        assertFalse(out.success());
        assertEquals("NOT_FOUND", out.code());
    }
}
