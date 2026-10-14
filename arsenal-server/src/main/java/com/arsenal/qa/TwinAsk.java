package com.arsenal.qa;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 数字孪生 · 对话问诊 —— 对着一个项目的活档案问一句话。
 *
 * <p><b>这一层最要紧的不是答得好，是答得诚实。</b>问诊的失败模式不是「答不出来」，
 * 而是「答得很流畅、数字也像真的，而那些数字来自一层根本没数据的地方」。
 * 所以：
 *
 * <ul>
 *   <li><b>档案先于答案。</b>四层（静态 / 语义 / 运行时 / 时间）哪层有数据、哪层没有，
 *       在生成答案之前就写进 {@code dossier}，答案里每个数字都能回溯到其中一段。</li>
 *   <li><b>答不了的层要写在答案里。</b>「运行时层没有数据」不是脚注，是答案的第一句。</li>
 *   <li><b>不静默降级。</b>LLM 没配 → 整段 {@code not-run} + 原因；
 *       档案装配不出来 → 说清缺哪层。不许返回「没有发现问题」这种把缺席说成清白的话。</li>
 * </ul>
 *
 * <p>答案的<b>数字自检</b>在 {@code auditAnswer}：原文里的每个数字都必须能在档案里找到。
 * 这不是「数字对不对」（那要判断语义），而是「这个数字是不是有出处」——
 * 后者是判据，能做成纯函数、能被直接验证。
 */
@Component
public class TwinAsk {

    /** 单次提问的档案上限（字符）—— 超了是拒，不是截断。 */
    private static final int MAX_DOSSIER_CHARS = 18_000;

    private final LlmClient llm;
    private final ObjectMapper mapper;

    public TwinAsk(LlmClient llm, ObjectMapper mapper) {
        this.llm = llm;
        this.mapper = mapper;
    }

    /**
     * @param workCopy   被检项目工作副本
     * @param facts      静态层（可为 null）
     * @param report     语义层报告（可为 null）
     * @param runtime    运行时对账结果（可为 null）
     * @param vitalsPoints 生命体征序列点数与最新一枚（可为 null）
     */
    public ObjectNode ask(Path workCopy, String projectId, String question,
                          JsonNode facts, JsonNode report, JsonNode runtime,
                          Integer vitalsPoints, JsonNode vitalsLatest) {
        ObjectNode out = mapper.createObjectNode();
        out.put("schemaVersion", 1);
        out.put("projectId", projectId == null ? "" : projectId);
        out.put("question", question == null ? "" : question);

        if (question == null || question.isBlank()) {
            out.put("status", "not-run");
            out.put("reason", "没有问句 —— 问诊不猜你想问什么");
            return out;
        }

        // ── 档案：先把「哪层有数据」定下来 ──
        ObjectNode dossier = buildDossier(facts, report, runtime, vitalsPoints, vitalsLatest);
        out.set("dossier", dossier);
        ArrayNode blind = out.putArray("blindSpots");
        for (String b : blindSpots(dossier)) {
            blind.add(b);
        }
        if (blind.isEmpty()) {
            // 0 条盲区也要说「0 条」—— 与「没算」长得一样的空白最难查
            blind.add("0 条盲区（四层都有数据）。");
        }

        if (!llm.configured()) {
            out.put("status", "not-run");
            out.put("reason", "LLM 未配置（缺环境变量 ARSENAL_LLM_KEY）—— 问诊整段未执行，"
                    + "上面的档案是真的，答案没生成。不许把「没答」读成「没问题」。");
            return out;
        }

        String dossierText = dossierText(dossier, facts);
        if (dossierText.length() > MAX_DOSSIER_CHARS) {
            out.put("status", "not-run");
            out.put("reason", "档案 " + dossierText.length() + " 字，超过送检上限 " + MAX_DOSSIER_CHARS
                    + " —— 直接拒，不截断。截断后模型会以为自己看完了，然后对着没看见的部分编答案。");
            return out;
        }

        try {
            LlmClient.Reply r = llm.chat(system(), user(question, dossierText, blind.toString()));
            ObjectNode a = parse(r.content());
            if (a == null) {
                out.put("status", "failed");
                out.put("reason", "模型两次都没给出约定 JSON —— 宁可不给答案，也不给半句");
                return out;
            }
            out.put("status", "ok");
            out.put("answer", a.path("answer").asString(""));
            ArrayNode cites = out.putArray("citations");
            for (JsonNode c : a.path("citations")) {
                cites.add(c.asString(""));
            }
            ArrayNode cannotSay = out.putArray("cannotSay");
            for (JsonNode c : a.path("cannotSay")) {
                cannotSay.add(c.asString(""));
            }
            ObjectNode usage = out.putObject("usage");
            usage.put("promptTokens", r.promptTokens());
            usage.put("completionTokens", r.completionTokens());
            usage.put("dossierChars", dossierText.length());

            // ── 数字自检 ──
            ArrayNode orphans = out.putArray("orphanNumbers");
            String flat = dossierText.replaceAll("\\s+", "");
            java.util.Set<String> seen = new java.util.LinkedHashSet<>();
            for (String n : (a.path("answer").asString("")).split("\\D+")) {
                if (n.isBlank() || !seen.add(n)) {
                    continue;
                }
                if (!flat.contains(n)) {
                    orphans.add(n);
                }
            }
            boolean auditOk = orphans.isEmpty();
            out.put("numberAudit", auditOk ? "pass" : "suspect");
            if (!auditOk) {
                List<String> named = new ArrayList<>();
                orphans.forEach(n -> named.add(n.asString("")));
                out.put("numberAuditNote", "答案里有 " + named.size()
                        + " 个数字在档案里找不到出处：" + String.join("、", named)
                        + " —— 这些数字可能是在编。**看结论前先核这几个数。**");
            }
            return out;
        } catch (LlmClient.LlmException e) {
            out.put("status", "failed");
            out.put("reason", "问诊调用失败：" + e.getMessage());
            return out;
        }
    }

    // ── 档案 ──────────────────────────────────────────────────────

    private ObjectNode buildDossier(JsonNode facts, JsonNode report, JsonNode runtime,
                                   Integer vitalsPoints, JsonNode vitalsLatest) {
        ObjectNode d = mapper.createObjectNode();
        boolean staticOk = facts != null && !facts.isMissingNode();
        boolean semanticOk = report != null && report.has("reproTiers");
        boolean runtimeOk = runtime != null && runtime.has("counts");
        boolean timeOk = vitalsPoints != null && vitalsPoints > 0;
        ObjectNode st = d.putObject("static");
        st.put("present", staticOk);
        st.put("note", staticOk
                ? (facts.path("code").path("entryPoints").size() + " 个可运行入口 / "
                    + facts.path("code").path("routes").size() + " 条路由 / "
                    + facts.path("code").path("directCalls").size() + " 条直接调用边")
                : "没数据");
        ObjectNode se = d.putObject("semantic");
        se.put("present", semanticOk);
        se.put("proven", report == null ? 0 : report.path("reproTiers").path("proven").asInt(0));
        se.put("notReproduced", report == null ? 0 : report.path("reproTiers").path("notReproduced").asInt(0));
        se.put("notRun", report == null ? 0 : report.path("reproTiers").path("notRun").asInt(0));
        ObjectNode rt = d.putObject("runtime");
        rt.put("present", runtimeOk);
        rt.put("started", runtimeOk ? runtime.path("started").asInt(0) : 0);
        rt.put("declared", runtimeOk ? runtime.path("declared").asInt(0) : 0);
        ObjectNode tm = d.putObject("time");
        tm.put("present", timeOk);
        tm.put("points", timeOk ? vitalsPoints : 0);
        if (timeOk && vitalsLatest != null) {
            tm.set("latest", vitalsLatest);
        }
        d.put("empty", !staticOk && !semanticOk && !runtimeOk && !timeOk);
        return d;
    }

    private List<String> blindSpots(ObjectNode d) {
        List<String> out2 = new ArrayList<>();
        for (String k : List.of("static", "semantic", "runtime", "time")) {
            if (!d.path(k).path("present").asBoolean(false)) {
                out2.add(nameOf(k) + "这一层没有数据 —— 关于它的任何说法都是猜测，不许编");
            }
        }
        if (d.path("empty").asBoolean(false)) {
            out2.add("四层全空 —— 这份档案答不了任何问题，只能告诉你「还没扫过」");
        }
        return out2;
    }

    private static String nameOf(String k) {
        return switch (k) {
            case "static" -> "静态层：";
            case "semantic" -> "语义层：";
            case "runtime" -> "运行时层：";
            default -> "时间层：";
        };
    }

    private String dossierText(ObjectNode d, JsonNode facts) {
        StringBuilder sb = new StringBuilder();
        sb.append("【静态层】").append(d.path("static").path("present").asBoolean(false) ? "" : "（无数据）")
                .append('\n').append(d.path("static").path("note").asString("")).append('\n');
        sb.append("【语义层】").append(d.path("semantic").path("present").asBoolean(false) ? "" : "（无数据）")
                .append('\n').append("实锤 ").append(d.path("semantic").path("proven").asInt(0))
                .append(" / 复现失败 ").append(d.path("semantic").path("notReproduced").asInt(0))
                .append(" / 没跑起来 ").append(d.path("semantic").path("notRun").asInt(0)).append('\n');
        sb.append("【运行时层】").append(d.path("runtime").path("present").asBoolean(false) ? "" : "（无数据）")
                .append('\n').append(d.path("runtime").path("started").asInt(0)).append('/')
                .append(d.path("runtime").path("declared").asInt(0)).append('\n');
        sb.append("【时间层】").append(d.path("time").path("present").asBoolean(false) ? "" : "（无数据）")
                .append('\n').append(d.path("time").path("points").asInt(0)).append(" 枚序列点\n");
        if (facts != null && !facts.isMissingNode()) {
            sb.append("【静态明细】\n")
                    .append("路由：").append(facts.path("code").path("routes").toString().substring(0,
                            Math.min(1500, facts.path("code").path("routes").toString().length())))
                    .append('\n')
                    .append("服务声明：").append(facts.path("services").path("declarations").toString()
                            .substring(0, Math.min(1500,
                                    facts.path("services").path("declarations").toString().length())))
                    .append('\n');
        }
        return sb.toString();
    }

    private String system() {
        return """
                你是这个项目的活档案。你只能依据给出的档案回答，**不许用档案之外的知识补充数字**。
                只输出 JSON：
                {"answer":"<回答>","citations":["<答案里每个数字的出处，用档案里的原文片段>"],
                 "cannotSay":["<档案答不了、所以你没说的事>"]}
                铁律：
                1. 答案里出现的每个数字都必须能在档案里找到；找不到就不许写那个数字，改写成一句话描述。
                2. 某一层写着「无数据」时，不许用别的层的数字代替，也不许说「没问题」—— 写「这一层没数据，答不了」。
                3. 「复现失败」与「没跑起来」是两件事，不许合并成「未实锤」。
                4. 闭包大小、影响面一律当成下界，不许说成「只动这些」。
                """;
    }

    private String user(String q, String dossier, String blind) {
        return "档案：\n\n" + dossier + "\n\n盲区：\n" + blind + "\n\n问题：" + q;
    }

    private ObjectNode parse(String content) {
        String s = content.strip();
        if (s.startsWith("```")) {
            s = s.replaceAll("^```[a-zA-Z]*\\n?", "").replaceAll("```\\s*$", "");
        }
        try {
            JsonNode n = mapper.readTree(s);
            return n != null && n.isObject() ? (ObjectNode) n : null;
        } catch (RuntimeException e) {
            return null;
        }
    }
}
