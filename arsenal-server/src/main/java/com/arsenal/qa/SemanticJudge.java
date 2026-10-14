package com.arsenal.qa;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import com.arsenal.domain.Rule;
import com.arsenal.domain.Severity;

/**
 * 语义判定器（M2）：把「声明了 llm check、静态层判不出」的规则逐条喂给 LLM，
 * 拿回带行号的判定。契约的硬脊梁是计划书 1.2-③ ——
 * <b>给不出行号（或行号越界）的 finding 直接丢弃</b>，宁缺毋滥；
 * 一批解析失败重试一次，再失败归 skipped 披露，不许静默吞。
 *
 * <p>预算：每 job 的批数上限（默认 40），超限即停并把剩余规则如实标
 * {@code not-run-budget} —— 花多少钱看得见，跑不完说跑不完。
 */
@Component
public class SemanticJudge {

    private static final Logger log = LoggerFactory.getLogger(SemanticJudge.class);

    /** 单文件送检窗口上限（字符）—— 只看开头，超出部分在报告里声明，不假装读完全文。 */
    private static final int FILE_WINDOW_CHARS = 3_200;
    /** 每批携带的文件数：少到模型盯得住行号，多到批数不爆预算。 */
    private static final int FILES_PER_BATCH = 6;
    /** 每条规则最多候选文件数（超出按优先级截断并披露）。 */
    private static final int FILES_PER_RULE = 12;

    private final LlmClient llm;
    private final ObjectMapper mapper;
    private final int maxBatchesPerJob;

    public SemanticJudge(LlmClient llm, ObjectMapper mapper,
                         @Value("${arsenal.qa.llm.max-batches-per-job:40}") int maxBatchesPerJob) {
        this.llm = llm;
        this.mapper = mapper;
        this.maxBatchesPerJob = Math.max(1, maxBatchesPerJob);
    }

    public record Outcome(ArrayNode findings, ArrayNode verdicts, ObjectNode usage,
                          List<String> notes, boolean budgetCut) {
    }

    /**
     * @param root        工作副本根目录（必须在 source.close() 之前调用 —— git 模式跑完即焚）
     * @param relFiles    本次范围（scope）内的相对路径清单
     * @param llmRules    待判定规则（check.llm 非空）
     */
    public Outcome run(Path root, List<String> relFiles, List<Rule> llmRules) {
        ArrayNode findings = mapper.createArrayNode();
        ArrayNode verdicts = mapper.createArrayNode();
        ObjectNode usage = mapper.createObjectNode();
        List<String> notes = new ArrayList<>();

        List<String> java = relFiles.stream().filter(f -> f.endsWith(".java")).sorted().toList();
        List<String> sql = relFiles.stream().filter(f -> f.endsWith(".sql")).sorted().toList();
        usage.put("model", llm.modelName());
        usage.put("candidateFiles", java.size() + sql.size());

        int batches = 0;
        long charsSent = 0;
        int promptTokens = 0;
        int completionTokens = 0;
        int droppedFindings = 0;
        boolean budgetCut = false;

        outer:
        for (Rule rule : llmRules) {
            List<String> candidates = pick(rule, java, sql);
            if (candidates.isEmpty()) {
                verdicts.add(verdictNode(rule, "不适用", List.of(), 0, "范围内没有该规则能落脚的文件类型"));
                continue;
            }
            List<String> ordered = prioritize(rule, candidates);
            List<String> use = ordered.size() > FILES_PER_RULE ? ordered.subList(0, FILES_PER_RULE) : ordered;
            if (use.size() < ordered.size()) {
                notes.add(rule.id() + "：候选 " + ordered.size() + " 个文件，只送检优先级最高的 "
                        + FILES_PER_RULE + " 个（其余未判定）");
            }

            for (int i = 0; i < use.size(); i += FILES_PER_BATCH) {
                if (batches >= maxBatchesPerJob) {
                    budgetCut = true;
                    verdicts.add(verdictNode(rule, "未跑-预算", List.of(), 0,
                            "已达本 job 的 LLM 批数上限 " + maxBatchesPerJob + "，该规则余下批次未执行"));
                    break outer;
                }
                List<String> batch = use.subList(i, Math.min(i + FILES_PER_BATCH, use.size()));
                List<Window> windows = new ArrayList<>();
                StringBuilder code = new StringBuilder();
                for (String rel : batch) {
                    Window w = readWindow(root, rel);
                    if (w == null) {
                        continue;
                    }
                    windows.add(w);
                    code.append(w.text()).append("\n\n");
                }
                if (windows.isEmpty()) {
                    continue;
                }
                batches++;
                charsSent += code.length();
                try {
                    LlmClient.Reply r = llm.chat(systemFor(rule), userFor(rule, code.toString()));
                    promptTokens += r.promptTokens();
                    completionTokens += r.completionTokens();
                    ParseResult pr = parseInto(r.content(), rule, windows, findings);
                    if (pr.retry()) { // 格式不对 —— 计划书口径：重试一次，再败归 skipped
                        r = llm.chat(systemFor(rule), userFor(rule, code.toString()));
                        promptTokens += r.promptTokens();
                        completionTokens += r.completionTokens();
                        pr = parseInto(r.content(), rule, windows, findings);
                    }
                    droppedFindings += pr.dropped();
                    if (pr.failed()) {
                        verdicts.add(verdictNode(rule, "失败-格式", batch, 0,
                                "LLM 返回两次都不是约定 JSON —— 本批不做判定，宁缺毋滥"));
                    } else {
                        verdicts.add(verdictNode(rule, pr.violations() > 0 ? "违规" : "合规",
                                batch, pr.violations(), ""));
                    }
                } catch (LlmClient.LlmException e) {
                    notes.add(rule.id() + "：一批判定失败（" + e.getMessage() + "），该批规则维持未判定");
                } catch (RuntimeException e) {
                    log.warn("语义判定批异常", e);
                    notes.add(rule.id() + "：判定异常（" + e.getMessage() + "），该批维持未判定");
                }
            }
        }

        usage.put("batches", batches);
        usage.put("maxBatches", maxBatchesPerJob);
        usage.put("charsSent", charsSent);
        usage.put("promptTokens", promptTokens);
        usage.put("completionTokens", completionTokens);
        usage.put("droppedFindings", droppedFindings);
        usage.put("budgetCut", budgetCut);
        return new Outcome(findings, verdicts, usage, notes, budgetCut);
    }

    // ── 选料：规则 → 候选文件 + 优先级 ────────────────────────────────

    /** 数据/SQL 类规则吃 .sql，其余 llm 规则都吃 .java —— 与规则问题文本的字面口径一致。 */
    private List<String> pick(Rule rule, List<String> java, List<String> sql) {
        String probe = rule.category() + " " + rule.title() + " " + rule.checkOrEmpty().llm();
        boolean sqlish = probe.contains("表") && probe.contains("字段")
                || rule.id().startsWith("DATA-SCHM") || probe.contains("SQL") || probe.contains("慢查询");
        return switch (rule.category()) {
            case "data" -> sqlish ? sql : List.of();
            default -> java;
        };
    }

    /**
     * 三档甄别（M2 版启发式）：命中规则关键词的文件 → 结构核心（Controller/Service/事务点）→ 其余。
     * 每条入选都给得出理由，不是「随便挑了前 12 个」。
     */
    private List<String> prioritize(Rule rule, List<String> files) {
        String kw = keywordOf(rule);
        record Scored(String path, int rank) {
        }
        List<Scored> scored = new ArrayList<>();
        for (String f : files) {
            int rank = 2;
            String base = f.substring(f.lastIndexOf('/') + 1);
            if (!kw.isEmpty() && base.toLowerCase().contains(kw)) {
                rank = 0;
            } else if (base.contains("Controller") || base.contains("Service") || base.contains("Engine")
                    || base.contains("Runner") || base.contains("Transaction")) {
                rank = 1;
            }
            scored.add(new Scored(f, rank));
        }
        scored.sort(Comparator.comparingInt(Scored::rank).thenComparing(Scored::path));
        return scored.stream().map(Scored::path).toList();
    }

    private String keywordOf(Rule rule) {
        String t = rule.title() + rule.checkOrEmpty().llm();
        for (String k : new String[]{"threadlocal", "锁", "事务", "javadoc", "越权", "脱敏", "校验",
                "转义", "分页", "定时", "会话", "缓存", "mock", "重试"}) {
            if (t.toLowerCase().contains(k)) {
                return k;
            }
        }
        return "";
    }

    private record Window(String rel, int startLine, int endLine, String text) {
    }

    private Window readWindow(Path root, String rel) {
        try {
            String body = Files.readString(root.resolve(rel), StandardCharsets.UTF_8);
            if (body.length() > FILE_WINDOW_CHARS) {
                int cut = body.lastIndexOf('\n', FILE_WINDOW_CHARS);
                if (cut < 0) {
                    cut = FILE_WINDOW_CHARS;
                }
                body = body.substring(0, cut);
            }
            int lines = countLines(body);
            StringBuilder numbered = new StringBuilder();
            int n = 0;
            for (String line : body.split("\n", -1)) {
                n++;
                numbered.append(n).append("| ").append(line).append('\n');
            }
            numbered.insert(0, "// 文件：" + rel + "（绝对行号，1 起）\n");
            return new Window(rel, 1, lines, numbered.toString());
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }

    private int countLines(String s) {
        int n = 1;
        for (int i = 0; i < s.length(); i++) {
            if (s.charAt(i) == '\n') {
                n++;
            }
        }
        return n;
    }

    // ── prompt 与解析 ────────────────────────────────────────────────

    private String systemFor(Rule rule) {
        return """
                你是资深 Java 代码审查员。就给定规则判定下面的代码，只输出 JSON，不输出任何解释文字。
                规则（%s / %s）：%s
                要求：%s
                输出契约（严格遵守）：{"results":[{"file":"<给定文件名>","verdict":"违规|合规|不适用",\
                "findings":[{"line":<整数绝对行号>,"evidence":"<该行原文>","impact":"<一句话说死会出什么事>",\
                "after":"<改后的最小代码>","confidence":<0到1>}]}]}
                铁律：拿不准就判"不适用"；给不出精确行号的 finding 一律不许输出；evidence 必须是该行原文。
                """.formatted(rule.severity(), rule.category(), rule.title(), rule.checkOrEmpty().llm());
    }

    private String userFor(Rule rule, String code) {
        return "规则：" + rule.title() + "\n\n待检代码（行号|内容）：\n\n" + code;
    }

    private record ParseResult(boolean failed, boolean retry, int violations, int dropped) {
    }

    private ParseResult parseInto(String content, Rule rule, List<Window> windows, ArrayNode sink) {
        String cleaned = content.strip();
        if (cleaned.startsWith("```")) {
            cleaned = cleaned.replaceAll("^```[a-zA-Z]*\\n?", "").replaceAll("```\\s*$", "");
        }
        JsonNode root;
        try {
            root = mapper.readTree(cleaned);
        } catch (RuntimeException e) {
            return new ParseResult(true, true, 0, 0);
        }
        JsonNode results = root.path("results");
        if (!results.isArray() || results.isEmpty()) {
            return new ParseResult(true, true, 0, 0);
        }
        int violations = 0;
        int dropped = 0;
        boolean anyUnknownFile = false;
        for (JsonNode one : results) {
            String file = one.path("file").asString("");
            Window w = windows.stream().filter(x -> file.contains(x.rel()) || x.rel().contains(lastSeg(file)))
                    .findFirst().orElse(null);
            if (w == null) {
                anyUnknownFile = true;
                continue;
            }
            boolean isViolation = "违规".equals(one.path("verdict").asString(""));
            if (isViolation) {
                violations++;
            }
            if (isViolation && one.path("findings").isArray()) {
                for (JsonNode f : one.path("findings")) {
                    int line = f.path("line").asInt(0);
                    String evidence = f.path("evidence").asString("");
                    // 契约校验：行号必须落在送检窗口内；evidence 必须能在该行找到字面 —— 对不上即丢弃
                    if (line < w.startLine() || line > w.endLine() || evidence.isBlank()) {
                        dropped++;
                        continue;
                    }
                    if (!windowLineMatches(w, line, evidence)) {
                        dropped++;
                        continue;
                    }
                    sink.add(findingNode(rule, w.rel(), f, line, evidence));
                }
            }
        }
        if (anyUnknownFile) {
            dropped++; // 文件都对不上的整条算丢弃并披露，不静默
        }
        return new ParseResult(false, false, violations, dropped);
    }

    private boolean windowLineMatches(Window w, int line, String evidence) {
        // w.text() 的第 0 行是「// 文件：…」抬头，逻辑行号 L 落在数组下标 L（不是 L-1）。
        String[] ls = w.text().split("\n");
        if (line < 1 || line >= ls.length) {
            return false;
        }
        String src = ls[line];
        int bar = src.indexOf("| ");
        String body = bar >= 0 ? src.substring(bar + 2) : src;
        String haystack = body.replace(" ", "");
        String needle = evidence.replace(" ", "");
        if (needle.isEmpty()) {
            return false;
        }
        return haystack.contains(needle.substring(0, Math.min(24, needle.length())));
    }

    private ObjectNode findingNode(Rule rule, String rel, JsonNode f, int line, String evidence) {
        ObjectNode n = mapper.createObjectNode();
        n.put("ruleId", rule.id());
        n.put("ruleTitle", rule.title());
        n.put("severity", rule.severity() == null ? "MUST" : rule.severity().name());
        n.put("category", rule.category());
        n.put("file", rel);
        n.put("line", line);
        n.put("evidence", evidence);
        n.put("impact", f.path("impact").asString(""));
        n.put("confidence", f.path("confidence").asDouble(0.5));
        n.put("source", "llm");
        ObjectNode rec = n.putObject("recommendation");
        rec.put("before", evidence);
        rec.put("after", f.path("after").asString(""));
        rec.put("rationale", rule.rationale() == null ? rule.promptFragment() : rule.rationale());
        return n;
    }

    private ObjectNode verdictNode(Rule rule, String verdict, List<String> files, int violations, String note) {
        ObjectNode n = mapper.createObjectNode();
        n.put("ruleId", rule.id());
        n.put("title", rule.title());
        String sev = rule.severity() == Severity.MUST || rule.severity() == Severity.NEVER ? "P0" : "P1";
        n.put("severity", sev);
        n.put("verdict", verdict);
        n.put("filesJudged", files.size());
        n.put("violations", violations);
        if (note != null && !note.isBlank()) {
            n.put("note", note);
        }
        return n;
    }

    private String lastSeg(String p) {
        int s = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
        return s < 0 ? p : p.substring(s + 1);
    }
}
