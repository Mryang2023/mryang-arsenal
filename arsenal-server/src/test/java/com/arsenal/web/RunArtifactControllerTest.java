package com.arsenal.web;

import com.arsenal.runs.RunStore;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.ResponseEntity;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * RunArtifactController 的分支级护栏（ROADMAP N4）。
 *
 * 守四条：下载 200 且带附件头 / run 不存在 404 / run 在但报告未生成 404（两种没拿到分开说）/
 * 产物清单带 sha256 且哈希可复现。全用真实 RunStore + @TempDir，不起 Spring 上下文。
 */
class RunArtifactControllerTest {

    @TempDir
    Path temp;

    private final ObjectMapper mapper = new ObjectMapper();
    private RunStore store;
    private RunArtifactController controller;

    @BeforeEach
    void setUp() {
        store = new RunStore(temp, mapper);
        controller = new RunArtifactController(store, mapper);
    }

    private RunStore.RunRef startRun() {
        return store.start("proj01", mapper.createObjectNode().put("snapshot", "fp"));
    }

    @Test
    void reportDownloadsAsAttachment() throws Exception {
        RunStore.RunRef ref = startRun();
        store.writeFile(ref, "report.md", "# 体检报告 · proj01\n\n本次覆盖：42/69\n");

        ResponseEntity<?> out = controller.report(ref.runId());
        assertEquals(200, out.getStatusCode().value());
        byte[] body = (byte[]) out.getBody();
        assertNotNull(body);
        assertTrue(new String(body, StandardCharsets.UTF_8).contains("本次覆盖：42/69"));
        String disposition = out.getHeaders().getFirst("Content-Disposition");
        assertNotNull(disposition, "必须带附件头");
        assertTrue(disposition.contains("attachment"), "浏览器点了要落文件：attachment");
        assertTrue(disposition.contains("report-" + ref.runId() + ".md"), "文件名带 runId");
    }

    @Test
    void unknownRunIs404() {
        ResponseEntity<?> out = controller.report("ffffffffffffffff");
        assertEquals(404, out.getStatusCode().value());
        @SuppressWarnings("unchecked")
        ApiResponse<Object> body = (ApiResponse<Object>) out.getBody();
        assertNotNull(body);
        assertEquals("NOT_FOUND", body.code());
    }

    @Test
    void runWithoutReportIs404WithDistinctMessage() {
        RunStore.RunRef ref = startRun(); // DONE 都没做，报告自然没有
        ResponseEntity<?> out = controller.report(ref.runId());
        assertEquals(404, out.getStatusCode().value());
        @SuppressWarnings("unchecked")
        ApiResponse<Object> body = (ApiResponse<Object>) out.getBody();
        assertNotNull(body);
        assertEquals("NOT_FOUND", body.code());
        assertTrue(body.message().contains("还没有 report.md"), "「报告未生成」与「run 不存在」必须分开说");
    }

    @Test
    void artifactsListCarriesStableSha256() throws Exception {
        RunStore.RunRef ref = startRun();
        store.writeFile(ref, "report.md", "# report\n");
        store.writeFile(ref, "findings.jsonl", "{\"ruleId\":\"X\"}\n");
        // 临时文件不经 RunStore 写（它正确拒绝了点开头的文件名）—— 直接落盘，验证清单会排除它
        Files.writeString(ref.dir().resolve(".report.md.tmp-deadbeef"), "junk");

        var out = controller.artifacts(ref.runId());
        assertTrue(out.success());
        List<ObjectNode> items = out.data();
        assertEquals(3, items.size(), "run.json + report.md + findings.jsonl；临时文件不进清单");

        ObjectNode report = items.stream()
                .filter(i -> "report.md".equals(i.path("name").asString()))
                .findFirst().orElseThrow();
        assertEquals(9, report.path("bytes").asInt());
        String hash = report.path("sha256").asString();
        assertEquals(64, hash.length(), "sha256 是 64 位 hex");

        // 复现：同内容再算一次，哈希必须一致（G3 的产物面）
        var again = controller.artifacts(ref.runId());
        String hash2 = again.data().stream()
                .filter(i -> "report.md".equals(i.path("name").asString()))
                .findFirst().orElseThrow().path("sha256").asString();
        assertEquals(hash, hash2);
        assertEquals(RunArtifactController.sha256("# report\n".getBytes(StandardCharsets.UTF_8)), hash);
    }

    @Test
    void artifactsOfUnknownRunIsNotFound() {
        var out = controller.artifacts("ffffffffffffffff");
        assertFalse(out.success());
        assertEquals("NOT_FOUND", out.code());
    }

    @Test
    void findingsEndpointFiltersAndKeepsCountHonest() throws Exception {
        RunStore.RunRef ref = startRun();
        StringBuilder lines = new StringBuilder();
        lines.append("{\"ruleId\":\"REL-LOG-001\",\"severity\":\"NEVER\",\"file\":\"src/A.java\",\"line\":12,\"snippet\":\"System.out.println(1);\",\"rule\":{\"sources\":[{\"ref\":\"阿里巴巴Java开发手册\"}]}}\n");
        lines.append("{\"ruleId\":\"REL-LOG-001\",\"severity\":\"NEVER\",\"file\":\"src/B.java\",\"line\":30,\"snippet\":\"printStackTrace();\"}\n");
        lines.append("{\"ruleId\":\"WEB-CTRL-002\",\"severity\":\"MUST\",\"file\":\"src/C.java\",\"line\":8,\"snippet\":\"@RequestBody\"}\n");
        lines.append("not-json-garbage\n"); // 坏行：跳过但计数披露
        store.writeFile(ref, "findings.jsonl", lines.toString());

        // 全量：3 条 + 1 条坏行披露
        var all = controller.findings(ref.runId(), null, null, null, 200);
        assertTrue(all.success());
        assertEquals(3, all.data().path("total").asInt());
        assertEquals(3, all.data().path("returned").asInt());
        assertEquals(1, all.data().path("badLines").asInt(), "坏行要计数，不许静默消失");

        // 按严重度筛
        var never = controller.findings(ref.runId(), "never", null, null, 200);
        assertEquals(2, never.data().path("total").asInt());
        // 按规则筛
        var byRule = controller.findings(ref.runId(), null, "rel-log-001", null, 200);
        assertEquals(2, byRule.data().path("total").asInt(), "规则筛选不分大小写");
        // 按文件子串筛
        var byFile = controller.findings(ref.runId(), null, null, "src/A", 200);
        assertEquals(1, byFile.data().path("total").asInt());
        // limit 截断：total 照实，returned 受 cap
        var capped = controller.findings(ref.runId(), null, null, null, 2);
        assertEquals(3, capped.data().path("total").asInt());
        assertEquals(2, capped.data().path("returned").asInt(), "截断时 total 与 returned 分开报");

        // 出处随行内嵌的 rule.sources 原样带出 —— 问题页签「凭什么」的链接地基
        var items = (tools.jackson.databind.node.ArrayNode) all.data().get("items");
        assertEquals("阿里巴巴Java开发手册",
                items.get(0).path("rule").path("sources").get(0).path("ref").asString());
    }

    @Test
    void findingsOfUnknownRunIsNotFound() {
        var out = controller.findings("ffffffffffffffff", null, null, null, 200);
        assertFalse(out.success());
        assertEquals("NOT_FOUND", out.code());
    }
}
