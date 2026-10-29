package com.arsenal.runs;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 体检报告渲染器（重建设计计划 §5.3）—— 把一次 run 的机器结论渲染成**人读的 report.md**。
 *
 * <p>纯函数、零 IO、零 Spring：输入 run 状态账 + 引擎报告，输出 markdown 字符串。
 * 与本仓其他判据层同一条纪律 —— 能直接验证的纯逻辑不藏在副作用里，
 * {@code ReportServiceTest} 拿构造数据就能跑。
 *
 * <p>报告的四条硬约定（重建计划 §5.2 G4/G5 的落点）：
 * <ul>
 *   <li><b>每条结论带位置。</b>Top 表必须给出 {@code 文件:行}，没有位置的问题不配进报告。</li>
 *   <li><b>每条结论带出处。</b>规则的 sources[].ref 原文列出 —— 「凭什么」必须和「是什么」在同一行。</li>
 *   <li><b>覆盖率必须披露。</b>执行/未验证/原因分层写清 —— 不把「没跑」说成「没问题」。</li>
 *   <li><b>确定性。</b>同输入同输出（G3）：不放当前时间、不放随机数、不依赖 HashMap 遍历序。</li>
 * </ul>
 */
public final class ReportService {

    private ReportService() {
    }

    private static final int TOP_LIMIT = 10;

    private static int severityRank(String s) {
        return switch (s == null ? "" : s) {
            case "NEVER" -> 0;
            case "MUST" -> 1;
            case "SHOULD" -> 2;
            default -> 3;
        };
    }

    /**
     * 健康分口径（写进报告，可审计）：100 − P0×0.3 − P1×0.1 − 其他×0.05，向下不为负。
     * 数字全部来自本次 run 的实际命中，不是拍脑袋的常量。
     */
    public static int healthScore(int p0, int p1, int other) {
        double raw = 100 - p0 * 0.3 - p1 * 0.1 - other * 0.05;
        return (int) Math.max(0, Math.round(raw));
    }

    /** @param run run.json 状态账（runId / projectId / startedAt / manifest） */
    public static String render(ObjectNode run, ObjectNode report) {
        StringBuilder out = new StringBuilder(8192);
        String runId = run.path("runId").asString("");
        String projectId = run.path("projectId").asString("");
        String startedAt = run.path("startedAt").asString("");
        String snapshot = run.path("manifest").path("snapshot").asString("unknown");
        String rulesetVersion = run.path("manifest").path("rulesetVersion").asString("unknown");

        int p0 = sizeOf(report.get("p0"));
        int p1 = sizeOf(report.get("p1"));
        int other = sizeOf(report.get("other"));
        JsonNode scope = report.get("scope");

        out.append("# 体检报告 · ").append(projectId).append(" · run ").append(runId).append("\n\n");
        out.append("- 快照：`").append(snapshot).append("` · 规则集：").append(rulesetVersion)
                .append(" · 开始：").append(startedAt).append('\n');
        if (scope != null) {
            out.append("- 范围：").append(scope.path("files").asInt(0)).append(" 个文件 / ")
                    .append(scope.path("bytes").asInt(0)).append(" 字节\n");
        }
        out.append("- 结论：P0 ").append(p0).append(" 条 · P1 ").append(p1).append(" 条 · 其他 ").append(other).append(" 条\n");
        out.append("- 健康分：**").append(healthScore(p0, p1, other)).append("/100**")
                .append("（口径：100 − P0×0.3 − P1×0.1 − 其他×0.05）\n\n");

        renderCoverage(out, report);

        out.append("## Top 问题（按规则聚合，附位置与出处）\n\n");
        if (p0 + p1 + other == 0) {
            out.append("本次没有命中任何规则。这不等于「代码没问题」—— 只覆盖了上面披露的那部分规则。\n\n");
        } else {
            out.append("| # | 规则 | 严重度 | 命中 | 首处位置 | 出处 |\n");
            out.append("|---|---|---|---|---|---|\n");
            out.append(topRows(report));
            out.append('\n');
        }

        renderNextSteps(out, p0, report);
        return out.toString();
    }

    // ── Top 问题（按规则聚合）──────────────────────────────────

    private record Agg(String ruleId, String title, String severity, int count,
                       String firstLocation, List<String> sources) {
    }

    /** 聚合渲染：按规则聚合计数，首处取字典序最小的 {@code 文件:行}，严重度取最高档。 */
    public static String topRows(ObjectNode report) {
        Map<String, Agg> aggs = new LinkedHashMap<>();
        for (String bucket : List.of("p0", "p1", "other")) {
            JsonNode arr = report.get(bucket);
            if (!(arr instanceof ArrayNode a)) {
                continue;
            }
            for (JsonNode f : a) {
                String ruleId = f.path("ruleId").asString("?");
                String loc = f.path("file").asString("?") + ":" + f.path("line").asInt(0);
                Agg cur = aggs.get(ruleId);
                if (cur == null) {
                    aggs.put(ruleId, new Agg(ruleId, f.path("title").asString(""),
                            f.path("severity").asString(""), 1, loc, sourcesOf(f)));
                } else {
                    String sev = severityRank(f.path("severity").asString("")) < severityRank(cur.severity)
                            ? f.path("severity").asString("") : cur.severity;
                    String loc0 = loc.compareTo(cur.firstLocation) < 0 ? loc : cur.firstLocation;
                    aggs.put(ruleId, new Agg(ruleId, cur.title, sev, cur.count + 1, loc0, cur.sources));
                }
            }
        }
        List<Agg> top = new ArrayList<>(aggs.values());
        top.sort((x, y) -> {
            int byCount = Integer.compare(y.count, x.count);
            return byCount != 0 ? byCount : x.ruleId.compareTo(y.ruleId);
        });
        StringBuilder out = new StringBuilder();
        int i = 1;
        for (Agg a : top) {
            if (i > TOP_LIMIT) {
                out.append('\n').append("另有 ").append(top.size() - TOP_LIMIT)
                        .append(" 条规则命中，全量见 findings.jsonl。\n");
                break;
            }
            out.append("| ").append(i++).append(" | `").append(a.ruleId).append("` ")
                    .append(a.title).append(" | ").append(a.severity)
                    .append(" | ").append(a.count)
                    .append(" | `").append(a.firstLocation).append("` | ")
                    .append(String.join("；", a.sources)).append(" |\n");
        }
        return out.toString();
    }

    private static List<String> sourcesOf(JsonNode finding) {
        List<String> out = new ArrayList<>();
        JsonNode sources = finding.path("rule").path("sources");
        if (sources.isArray()) {
            for (JsonNode s : sources) {
                String ref = s.path("ref").asString("");
                if (!ref.isEmpty()) {
                    out.add(ref);
                }
                if (out.size() >= 2) {
                    break;
                }
            }
        }
        return out;
    }

    // ── 覆盖率披露 ────────────────────────────────────────────

    private static void renderCoverage(StringBuilder out, ObjectNode report) {
        JsonNode cov = report.get("coverage");
        out.append("## 本次覆盖（诚实口径）\n\n");
        if (cov == null) {
            out.append("本次报告没有覆盖率数据 —— 这不是「全部通过」，是「引擎没给账」。\n\n");
            return;
        }
        int total = cov.path("total").asInt(0);
        int executed = cov.path("executed").asInt(0);
        int notRun = cov.path("notRun").asInt(0);
        out.append("- 规则总数 ").append(total)
                .append(" · 自动执行 ").append(executed)
                .append(" · 未验证 ").append(notRun).append('\n');

        ArrayNode skipped = cov.path("skipped") instanceof ArrayNode s ? s : null;
        if (skipped != null && !skipped.isEmpty()) {
            Map<String, Integer> byLayer = new LinkedHashMap<>();
            for (JsonNode sk : skipped) {
                byLayer.merge(sk.path("layer").asString("other"), 1, Integer::sum);
            }
            out.append("- 未验证构成：");
            List<String> parts = new ArrayList<>();
            for (String layer : List.of("llm", "ast", "manual")) {
                Integer n = byLayer.get(layer);
                if (n != null) {
                    parts.add(switch (layer) {
                        case "llm" -> "LLM 语义层 " + n;
                        case "ast" -> "AST 无检查器 " + n;
                        case "manual" -> "需人工 " + n;
                        default -> layer + " " + n;
                    });
                }
            }
            out.append(String.join(" · ", parts)).append('\n');
        }
        JsonNode parseFailures = cov.path("parseFailures");
        int failed = parseFailures.isArray() ? parseFailures.size() : parseFailures.asInt(0);
        out.append("- 解析失败 ").append(failed).append(" 处\n\n");

        if (skipped != null && !skipped.isEmpty()) {
            out.append("<details><summary>未验证清单（").append(skipped.size()).append(" 条，点开看原因）</summary>\n\n");
            for (JsonNode sk : skipped) {
                out.append("- `").append(sk.path("ruleId").asString("?")).append("` ")
                        .append(sk.path("title").asString("")).append(" —— ")
                        .append(sk.path("reason").asString("")).append('\n');
            }
            out.append("\n</details>\n\n");
        }
    }

    // ── 下一步 ────────────────────────────────────────────────

    private static void renderNextSteps(StringBuilder out, int p0, ObjectNode report) {
        out.append("## 下一步\n\n");
        int n = 1;
        JsonNode cov = report.get("coverage");
        int llmSkipped = countLayer(cov, "llm");
        int manualSkipped = countLayer(cov, "manual");
        if (p0 > 0) {
            out.append(n++).append(". 先修 P0 的 ").append(p0)
                    .append(" 条 —— 修复闭环（生成补丁 → 沙箱验证）在阶段 1 提供，当前可按 findings.jsonl 逐条处理。\n");
        }
        if (llmSkipped > 0) {
            out.append(n++).append(". 配置 `ARSENAL_LLM_KEY` 可解锁 ").append(llmSkipped)
                    .append(" 条语义规则 —— 未配置时它们**没有被执行**，本报告不替它们下结论。\n");
        }
        if (manualSkipped > 0) {
            out.append(n++).append(". ").append(manualSkipped).append(" 条规则只能人工过目（见未验证清单），建议排进代码评审。\n");
        }
        if (n == 1) {
            out.append("1. 本次没有 P0 且没有明显缺口 —— 保持节奏，下次改动后重跑一次 run 留档。\n");
        }
        out.append('\n');
    }

    private static int countLayer(JsonNode cov, String layer) {
        if (cov == null) {
            return 0;
        }
        JsonNode skipped = cov.path("skipped");
        if (!skipped.isArray()) {
            return 0;
        }
        int n = 0;
        for (JsonNode sk : skipped) {
            if (layer.equals(sk.path("layer").asString(""))) {
                n++;
            }
        }
        return n;
    }

    private static int sizeOf(JsonNode arr) {
        return arr instanceof ArrayNode a ? a.size() : 0;
    }
}
