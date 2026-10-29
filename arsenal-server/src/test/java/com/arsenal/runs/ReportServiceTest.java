package com.arsenal.runs;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * ReportService 的分支级护栏（ROADMAP N3）。
 *
 * 守报告的四条硬约定：覆盖率披露（不把没跑说成没问题）、Top 表带文件:行与规则出处、
 * 健康分口径确定、同输入同输出（G3 确定性门）。全部用构造数据，不碰引擎不碰磁盘。
 */
class ReportServiceTest {

    private final ObjectMapper mapper = new ObjectMapper();

    private ObjectNode runAccount() {
        ObjectNode run = mapper.createObjectNode();
        run.put("runId", "abc123def4567890");
        run.put("projectId", "proj01");
        run.put("status", "RUNNING");
        run.put("startedAt", "2026-10-30T00:20:00+08:00");
        ObjectNode m = run.putObject("manifest");
        m.put("snapshot", "dir:371:5938261");
        m.put("rulesetVersion", "0.1.0");
        return run;
    }

    private ObjectNode finding(String ruleId, String title, String severity, String file, int line, String sourceRef) {
        ObjectNode f = mapper.createObjectNode();
        f.put("ruleId", ruleId);
        f.put("title", title);
        f.put("severity", severity);
        f.put("file", file);
        f.put("line", line);
        ObjectNode rule = f.putObject("rule");
        rule.put("id", ruleId);
        ObjectNode s = rule.putArray("sources").addObject();
        s.put("ref", sourceRef);
        s.put("type", "industry-standard");
        return f;
    }

    private ObjectNode report() {
        ObjectNode report = mapper.createObjectNode();
        // 注意：Jackson 3 的 putArray(fieldName) 是「替换成新空数组」语义 ——
        // 每次 cov.putArray("skipped").addObject() 都会把上一条清掉。
        // 多条目必须先取住 ArrayNode 引用再 addObject。
        ArrayNode p0 = report.putArray("p0");
        p0.add(finding("REL-LOG-001", "禁止 System.out 输出", "NEVER",
                "src/main/java/demo/A.java", 12, "阿里巴巴Java开发手册 异常日志·日志规约【强制】"));
        p0.add(finding("REL-LOG-001", "禁止 System.out 输出", "NEVER",
                "src/main/java/demo/B.java", 38, "阿里巴巴Java开发手册"));
        p0.add(finding("WEB-CTRL-002", "@RequestBody 必须加 @Valid", "MUST",
                "src/main/java/demo/C.java", 30, "阿里巴巴Java开发手册 安全规约 §4"));
        ArrayNode p1 = report.putArray("p1");
        p1.add(finding("SVC-LAYR-001", "禁止字段注入", "MUST",
                "src/main/java/demo/D.java", 8, "Spring 官方文档"));
        report.putArray("other");
        ObjectNode cov = report.putObject("coverage");
        cov.put("total", 69);
        cov.put("executed", 42);
        cov.put("notRun", 27);
        ArrayNode skipped = cov.putArray("skipped");
        skipped.addObject().put("ruleId", "WEB-CTRL-001").put("title", "Controller 只做 HTTP 适配")
                .put("layer", "llm").put("reason", "需语义判定");
        skipped.addObject().put("ruleId", "COL-CODE-002").put("title", "重写必须加 @Override")
                .put("layer", "ast").put("reason", "AST 无检查器");
        skipped.addObject().put("ruleId", "COL-GIT-002").put("title", "单次提交只做一件事")
                .put("layer", "manual").put("reason", "需人工过目");
        cov.putArray("parseFailures");
        ObjectNode scope = report.putObject("scope");
        scope.put("files", 438);
        scope.put("bytes", 5414561);
        return report;
    }

    @Test
    void rendersCoverageDisclosureWithSkippedBreakdown() {
        String md = ReportService.render(runAccount(), report());
        assertTrue(md.contains("本次覆盖"), "必须有覆盖率披露段");
        assertTrue(md.contains("规则总数 69"), "总数来自数据");
        assertTrue(md.contains("自动执行 42"), "执行数来自数据");
        assertTrue(md.contains("未验证 27"), "未验证数来自数据");
        assertTrue(md.contains("LLM 语义层 1"), "未验证构成按层分解");
        assertTrue(md.contains("AST 无检查器 1"));
        assertTrue(md.contains("需人工 1"));
        assertTrue(md.contains("解析失败 0 处"));
        assertTrue(md.contains("需语义判定"), "跳过原因要可见");
    }

    @Test
    void rendersTopTableWithLocationAndProvenance() {
        String md = ReportService.render(runAccount(), report());
        assertTrue(md.contains("Top 问题"), "必须有 Top 段");
        // ≥3 条带行号的位置（G4：每条结论带位置）
        assertTrue(md.contains("src/main/java/demo/A.java:12"));
        assertTrue(md.contains("src/main/java/demo/C.java:30"));
        assertTrue(md.contains("src/main/java/demo/D.java:8"));
        // 出处与问题同一行（G4：带出处）
        String logRow = md.lines().filter(l -> l.contains("REL-LOG-001")).findFirst().orElse("");
        assertTrue(logRow.contains("阿里巴巴Java开发手册"), "出处必须和规则在同一行");
        assertTrue(logRow.startsWith("| 1 |"), "REL-LOG-001 命中 2 次，按命中数排第一");
    }

    @Test
    void healthScoreInRangeAndDeterministic() {
        int s = ReportService.healthScore(200, 21, 0);
        assertTrue(s >= 0 && s <= 100, "健康分必须在 0-100：" + s);
        assertEquals(38, ReportService.healthScore(200, 21, 0), "口径固定：100 − 200×0.3 − 21×0.1 = 37.9 → 38");
        assertEquals(100, ReportService.healthScore(0, 0, 0), "零命中满分");
        assertEquals(0, ReportService.healthScore(1000, 0, 0), "向下不为负");
    }

    @Test
    void sameInputSameOutputDeterministic() {
        String a = ReportService.render(runAccount(), report());
        String b = ReportService.render(runAccount(), report());
        assertEquals(a, b, "同输入必须同输出（G3 确定性门）");
    }

    @Test
    void emptyFindingsSaySoWithoutPretending() {
        ObjectNode report = mapper.createObjectNode();
        report.putArray("p0");
        report.putArray("p1");
        report.putArray("other");
        ObjectNode cov = report.putObject("coverage");
        cov.put("total", 69);
        cov.put("executed", 35);
        cov.put("notRun", 34);
        String md = ReportService.render(runAccount(), report);
        assertTrue(md.contains("100/100"), "零命中满分");
        assertTrue(md.contains("本次没有命中任何规则"), "要直说没命中");
        assertTrue(md.contains("不等于「代码没问题」"), "不许把覆盖不全说成全部通过");
        assertTrue(md.contains("结论：P0 0 条"), "结论行如实报 0");
    }

    @Test
    void nextStepsMentionUnlocksAndManualWork() {
        String md = ReportService.render(runAccount(), report());
        assertTrue(md.contains("ARSENAL_LLM_KEY"), "LLM 缺口的解锁动作要写清");
        assertTrue(md.contains("先修 P0"), "有 P0 就先修 P0");
    }

    @Test
    void manifestMetaDataHeadsTheReport() {
        String md = ReportService.render(runAccount(), report());
        assertTrue(md.contains("run abc123def4567890"), "runId 署名");
        assertTrue(md.contains("dir:371:5938261"), "快照指纹署名");
        assertTrue(md.contains("0.1.0"), "规则集版本署名");
        assertTrue(md.contains("438 个文件"), "范围署名");
    }
}
