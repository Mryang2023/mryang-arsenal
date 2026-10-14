package com.arsenal.qa;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * C2 · 改造工坊 —— 「代码时光机」的**计划与校验这一半**。
 *
 * <p>计划书对这一件有一条决定性的边界，本类整条设计都由它推出来：
 *
 * <blockquote><b>全自动改造是危险机器，首版是「人踩油门、机器干活」。</b></blockquote>
 *
 * 所以这里<b>没有</b>「一键改造」这个动作，也<b>不</b>有一个能直接产出 diff 的入口。
 * 一次工坊会话是三段，每一段都要人确认：
 *
 * <pre>
 *   PLAN   选目标 → 逐点方案（哪些能自动、哪些只能出主意）      ← 不写任何文件
 *   APPLY  人工确认后，只机械应用「可自动」的那些点            ← 数组参数调沙箱，无 shell
 *   VERIFY 改造前后各跑一次审查 + 全套测试 → 数字对照           ← 不达标就不许「交付」
 * </pre>
 *
 * <p><b>「可自动」的判据只有一条</b>：那条优化方案里带<b>规则自带的 before/after 正例</b>，
 * 且 before 能在目标文件里<b>逐字节找到</b>。找不到 → 不自动改，只出方案。
 * 这条判据的作用是把「机械替换」与「设计决策」分开 ——
 * 前者错了一次是可回滚的 diff，后者错了一次是半个重构。
 *
 * <p>三条不许破：
 * <ol>
 *   <li><b>用户的目录一个字节都不动。</b>全程在 {@code /qa} 的工作副本里；
 *       「交付」也只是产出一个 diff 文本 + 前后对照，<b>不 commit、不 push</b>。</li>
 *   <li><b>交付门槛是数字，不是感觉。</b>「P0 14→2、测试 47 绿」这种话必须来自两次真跑的报告，
 *       两次都没跑 → 结论是「没验」，不是「达标」。</li>
 *   <li><b>每一步可单步回滚。</b>每改一处就把那一份原文存下来，回滚 = 把原文写回去，
 *       而不是 {@code git checkout}（那会连带抹掉别人未提交的改动）。</li>
 * </ol>
 */
@Component
public class RefactorWorkshop {

    private static final Logger log = LoggerFactory.getLogger(RefactorWorkshop.class);

    /** 一次会话的应用上限 —— 「人踩油门」不等于「一次能踩一百脚」。 */
    public static final int MAX_APPLY_PER_SESSION = 20;
    private static final long PATCH_WALL_MS = 120_000L;

    private final LlmClient llm;
    private final ObjectMapper mapper;
    private final int maxPerJob;

    public RefactorWorkshop(LlmClient llm, ObjectMapper mapper,
                            @Value("${arsenal.qa.refactor.max-per-session:20}") int maxPerJob) {
        this.llm = llm;
        this.mapper = mapper;
        this.maxPerJob = Math.max(1, Math.min(MAX_APPLY_PER_SESSION, maxPerJob));
    }

    /** 一处改造点。{@code auto} 就是「能不能机械应用」的唯一判据结果。 */
    public record Step(String file, String before, String after, String title, String rationale,
                       boolean auto, String skipReason) {

        public ObjectNode toNode(ObjectMapper m) {
            ObjectNode n = m.createObjectNode();
            n.put("file", file);
            n.put("title", title);
            n.put("rationale", rationale);
            n.put("auto", auto);
            n.put("before", before);
            n.put("after", after);
            if (!auto) {
                n.put("skipReason", skipReason);
            }
            return n;
        }
    }

    public record Plan(List<Step> steps, ObjectNode usage, List<String> notes, boolean planOnly) {
    }

    public record Applied(List<String> appliedFiles, List<String> appliedTitles,
                          List<String> skipped, String undoPath, ObjectNode usage) {
    }

    // ── 第一段：PLAN（不写任何文件） ──────────────────────────────

    /**
     * 出一份改造方案。<b>这一步一个字节都不写。</b>
     *
     * @param workCopy   被检项目工作副本
     * @param goal       改造目标（如「升 Spring Boot 3」「上虚拟线程」），人给的
     * @param candidates 带 before/after 的改造点（来自规则正例），可为空
     */
    public Plan plan(Path workCopy, String goal, List<Step> candidates) {
        ObjectNode usage = mapper.createObjectNode();
        usage.put("model", llm.modelName());
        List<String> notes = new ArrayList<>();
        usage.put("candidates", candidates.size());

        if (goal == null || goal.isBlank()) {
            notes.add("没有改造目标 —— 这一步必须人给。工坊不猜「你想改成什么样」。");
            usage.put("llmUsed", false);
            return new Plan(List.of(), usage, notes, true);
        }
        if (candidates.isEmpty()) {
            notes.add("没有任何带 before/after 的改造点可排 —— 这一步本轮只出思路，不出可应用的改动");
            usage.put("llmUsed", false);
            return new Plan(List.of(), usage, notes, true);
        }

        List<Step> steps = new ArrayList<>();
        for (Step c : candidates) {
            Step judged = judgeAuto(workCopy, c);
            steps.add(judged);
            if (!judged.auto()) {
                notes.add(judged.file() + "：只出方案不自动改 —— " + judged.skipReason());
            }
        }
        long auto = steps.stream().filter(Step::auto).count();
        notes.add("共 " + steps.size() + " 个改造点，可机械应用 " + auto + " 个、只出方案 "
                + (steps.size() - auto) + " 个。**应用前需要人确认。**");

        // LLM 只用来给「顺序与取舍」出主意，不用来生成代码 —— 生成代码那一步是 apply 里的机械替换
        if (llm.configured()) {
            try {
                LlmClient.Reply r = llm.chat(planSystem(), planUser(goal, steps));
                usage.put("llmUsed", true);
                usage.put("promptTokens", r.promptTokens());
                usage.put("completionTokens", r.completionTokens());
                ObjectNode order = parseOrder(r.content());
                if (order != null) {
                    notes.add("LLM 给的执行顺序：" + order.path("order").asString("(没给)"));
                    if (order.path("advice").asString("").isBlank()) {
                        notes.add(order.path("advice").asString(""));
                    }
                }
            } catch (LlmClient.LlmException e) {
                usage.put("llmUsed", false);
                notes.add("没取到 LLM 的排序建议（" + e.getMessage() + "）—— 不影响应用，顺序退回按文件分组");
            }
        } else {
            usage.put("llmUsed", false);
            notes.add("LLM 未配置 —— 没有排序建议，但改造点本身来自规则正例，不依赖 LLM");
        }
        return new Plan(steps, usage, notes, true);
    }

    /**
     * 「能不能自动改」的判据 —— <b>唯一定义处</b>。
     *
     * <p>三个条件缺一不可：① 有 before/after；② before 在目标文件里<b>逐字节</b>找得到；
     * ③ 替换点出现且只出现一次。
     * 第三条最容易被忘：同一个 before 片段在文件里出现三次时，
     * 「自动替换」要么只改第一处（改一半），要么改三处（改超了）——
     * 两种都是「看起来改成功了」的假绿，所以直接判不可自动。
     */
    Step judgeAuto(Path workCopy, Step c) {
        if (c.before() == null || c.before().isBlank() || c.after() == null || c.after().isBlank()) {
            return withSkip(c, "这条方案没有 before/after 正例 —— 属于「需要设计决策」，只出方案不动手");
        }
        if (c.before().equals(c.after())) {
            return withSkip(c, "before 与 after 相同，等于没有改动");
        }
        String body;
        try {
            Path p = workCopy.resolve(c.file());
            if (!Files.isRegularFile(p)) {
                return withSkip(c, "目标文件在仓库里不存在：" + c.file());
            }
            body = Files.readString(p, StandardCharsets.UTF_8);
        } catch (IOException | RuntimeException e) {
            return withSkip(c, "读不了目标文件：" + e.getMessage());
        }
        int hits = countOccurrences(body, c.before());
        if (hits == 0) {
            return withSkip(c, "before 在 " + c.file() + " 里找不到 —— 代码已经变了，按原方案改会改错地方");
        }
        if (hits > 1) {
            return withSkip(c, "before 在 " + c.file() + " 里出现 " + hits
                    + " 次 —— 自动替换要么只改第一处（改一半）、要么全改（改超了），都算「看起来成功」的假绿");
        }
        return c;
    }

    // ── 第二段：APPLY（人确认之后才走这里） ────────────────────────

    /**
     * 只机械应用「可自动」的那些点，并落下**回滚所需的原文**。
     *
     * @param confirmed 人确认过的改造点（没在 steps 里、auto=false 的会被如实跳过去）
     */
    public Applied apply(Path workCopy, List<Step> confirmed) {
        ObjectNode usage = mapper.createObjectNode();
        List<String> appliedFiles = new ArrayList<>();
        List<String> appliedTitles = new ArrayList<>();
        List<String> skipped = new ArrayList<>();
        usage.put("confirmed", confirmed.size());
        usage.put("limitPerSession", maxPerJob);

        /** 每一处改动的原文 —— 回滚就是把它写回去。 */
        Map<String, String> undo = new LinkedHashMap<>();
        int n = 0;
        for (Step s : confirmed) {
            if (n >= maxPerJob) {
                skipped.add(s.file() + "：超出本次应用上限 " + maxPerJob + "，其余留到下一次会话");
                continue;
            }
            if (!s.auto()) {
                skipped.add(s.file() + "：" + s.skipReason());
                continue;
            }
            try {
                Path p = workCopy.resolve(s.file());
                String body = Files.readString(p, StandardCharsets.UTF_8);
                int hits = countOccurrences(body, s.before());
                if (hits != 1) {
                    // 应用前再核一次 —— 计划与应用之间文件可能被别人动过
                    skipped.add(s.file() + "：应用时 before 出现 " + hits
                            + " 次（计划时是 1 次）—— 文件在计划之后被改过，这次不动它");
                    continue;
                }
                undo.put(s.file() + "#" + n, body);
                Files.writeString(p, body.replace(s.before(), s.after()), StandardCharsets.UTF_8);
                appliedFiles.add(s.file());
                appliedTitles.add(s.title());
                n++;
            } catch (IOException | RuntimeException e) {
                skipped.add(s.file() + "：应用失败（" + e.getMessage() + "）");
            }
        }

        String undoPath = "";
        if (!undo.isEmpty()) {
            Path f = workCopy.resolve("target").resolve("arsenal-refactor-undo.json");
            try {
                Files.createDirectories(f.getParent());
                ObjectNode u = mapper.createObjectNode();
                ObjectNode byFile = u.putObject("originals");
                undo.forEach(byFile::put);
                u.put("note", "回滚 = 把这些原文写回对应文件；这是「单步回滚」的凭据，"
                        + "不许用 git checkout（那会连带抹掉别人未提交的改动）");
                Files.writeString(f, mapper.writeValueAsString(u), StandardCharsets.UTF_8);
                undoPath = f.toString();
            } catch (IOException | RuntimeException e) {
                log.warn("回滚凭据写不下", e);
            }
        }
        usage.put("applied", appliedFiles.size());
        usage.put("skipped", skipped.size());
        return new Applied(appliedFiles, appliedTitles, skipped, undoPath, usage);
    }

    // ── 第三段：VERIFY（数字，不是感觉） ──────────────────────────

    /**
     * 改造前后对照。<b>两次都没跑 = 「没验」，不是「达标」。</b>
     *
     * @param before 改造前的报告（可空）
     * @param after  改造后的报告（可空）
     * @param testsBefore / testsAfter 全套测试通过数（可为 null = 没跑）
     */
    public ObjectNode verify(JsonNode before, JsonNode after, Integer testsBefore, Integer testsAfter) {
        ObjectNode v = mapper.createObjectNode();
        if (before == null || after == null) {
            v.put("status", "not-run");
            v.put("reason", "改造前或改造后有一侧没有报告 —— 没验过，不许说达标");
            return v;
        }
        ObjectNode b = counts(before);
        ObjectNode a = counts(after);
        v.set("before", b);
        v.set("after", a);
        v.set("tests", testsBefore == null || testsAfter == null
                ? mapper.createObjectNode().put("status", "not-run")
                : mapper.createObjectNode()
                        .put("before", testsBefore).put("after", testsAfter)
                        .put("delta", testsAfter - testsBefore));
        boolean p0Down = a.path("p0").asInt() <= b.path("p0").asInt();
        boolean testsOk = testsBefore != null && testsAfter != null && testsAfter >= testsBefore;
        v.put("p0Improved", p0Down);
        v.put("testsKept", testsOk);
        v.put("status", (p0Down && testsOk) ? "deliverable" : "not-deliverable");
        v.put("reason", (p0Down && testsOk)
                ? "P0 未增加且测试没变少 —— 可以交付一个 diff（仍然不 commit、不 push）"
                : "P0 没降或测试掉了几条 —— 不许交付。这不是「差一点」，是把改动退回去重做");
        return v;
    }

    private ObjectNode counts(JsonNode report) {
        ObjectNode n = mapper.createObjectNode();
        n.put("p0", report.path("staticFindings").path("p0").size());
        n.put("p1", report.path("staticFindings").path("p1").size());
        n.put("other", report.path("staticFindings").path("other").size());
        n.put("provenSemantic", report.path("reproTiers").path("proven").asInt(0));
        return n;
    }

    // ── 杂项 ──────────────────────────────────────────────────────

    private String planSystem() {
        return """
                你是资深重构顾问。给你一个改造目标与一批改造点，只输出 JSON。
                输出契约：{"order":"<按风险从低到高的执行顺序，逗号分隔的点标题>","advice":"<一句话提醒>"}
                铁律：只排序与给建议，**不许生成任何代码**；代码由机械替换负责，
                你在这里写代码就等于绕过了「人踩油门」那道闸。
                """;
    }

    private String planUser(String goal, List<Step> steps) {
        StringBuilder sb = new StringBuilder("改造目标：").append(goal).append("\n\n改造点：\n");
        int i = 0;
        for (Step s : steps) {
            sb.append(++i).append(". [").append(s.auto() ? "可自动" : "只出方案").append("] ")
                    .append(s.file()).append(" · ").append(s.title());
            if (!s.skipReason().isBlank()) {
                sb.append("（原因：").append(s.skipReason()).append('）');
            }
            sb.append('\n');
        }
        return sb.toString();
    }

    private ObjectNode parseOrder(String content) {
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

    private static Step withSkip(Step c, String reason) {
        return new Step(c.file(), c.before(), c.after(), c.title(), c.rationale(), false, reason);
    }

    /** 子串出现次数。<b>不重叠计数</b> —— 重叠计数会让「aaa」在「aaaa」里算成 2 次。 */
    static int countOccurrences(String haystack, String needle) {
        if (needle == null || needle.isEmpty()) {
            return 0;
        }
        int n = 0;
        int from = 0;
        while (true) {
            int i = haystack.indexOf(needle, from);
            if (i < 0) {
                return n;
            }
            n++;
            from = i + needle.length();
        }
    }
}
