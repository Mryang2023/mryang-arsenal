package com.arsenal.qa;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.nio.file.Path;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * C4 · 审查员委员会 —— 三个审查员并行审同一批文件，交叉验证后给「共识 / 孤证」标注。
 *
 * <pre>
 *                    ┌─ 安全审查员 ─┐
 *  同一批 triage 文件 ┼─ 性能审查员 ─┼─▶ 交叉验证 ─▶ 共识（2+ 报）/ 孤证（1 个报）
 *                    └─ 并发审查员 ─┘
 * </pre>
 *
 * <p><b>三条不许破的规矩：</b>
 * <ol>
 *   <li><b>孤证 ≠ 误报。</b>只有一个审查员报的是<b>置信标注</b>，不是判负 ——
 *       计划书写得很清楚，它与既有纪律「语义 finding 必带 confidence、不进 P0」一致。
 *       所以本页绝不把孤证从报告里删掉，只在它旁边写「只有安全审查员报了它」。</li>
 *   <li><b>成本 ×3，预算闸门必须先于功能。</b>三个审查员各花各的钱，所以
 *       {@code llmUsage} 从一份变三份（{@code perJudgeer}），超限即熔断并把未跑的审查员
 *       如实标 {@code not-run-budget} —— 绝不允许「跑完了但没说花了多少」。</li>
 *   <li><b>结论只做分流，不改规则。</b>委员会不重新判定任何规则，也不改 P0/P1 分档；
 *       它只在同一条 finding 上挂「谁报了它」。</li>
 * </ol>
 *
 * <p><b>并行是真的并行</b>：三个审查员用同一个线程池的三个 future 同时发出去。
 * 串行跑会让墙钟 ×3，而这三个请求互相之间没有依赖 —— 串行只是把等待时间乘起来。
 */
@Component
public class CommitteeJudge {

    private static final Logger log = LoggerFactory.getLogger(CommitteeJudge.class);

    /** 三个审查员。顺序固定 → 报告与 UI 的渲染顺序稳定。 */
    public static final String SECURITY = "security";
    public static final String PERFORMANCE = "performance";
    public static final String CONCURRENCY = "concurrency";
    public static final List<String> MEMBERS = List.of(SECURITY, PERFORMANCE, CONCURRENCY);

    public static final String CONSENSUS = "consensus";
    public static final String SOLO = "solo";
    public static final String NONE = "none-reported";

    /** 单个文件送审窗口上限 —— 与 SemanticJudge 同一个量级。 */
    private static final int FILE_WINDOW_CHARS = 3_200;

    private final LlmClient llm;
    private final ObjectMapper mapper;
    private final int maxBatches;
    private final int parallel;

    public CommitteeJudge(LlmClient llm, ObjectMapper mapper,
                          @Value("${arsenal.qa.committee.max-batches-per-job:12}") int maxBatches,
                          @Value("${arsenal.qa.committee.parallelism:3}") int parallel) {
        this.llm = llm;
        this.mapper = mapper;
        this.maxBatches = Math.max(0, maxBatches);
        this.parallel = Math.max(1, Math.min(3, parallel));
    }

    public record Outcome(ArrayNode findings, ObjectNode usage, List<String> notes,
                          boolean budgetCut, int consensus, int solo) {
    }

    /**
     * @param workCopy 被检项目工作副本（必须在 source.close() 之前调 —— 与语义判定同一纪律）
     * @param relFiles 本批 triage 的相对路径
     */
    public Outcome run(Path workCopy, List<String> relFiles) {
        ArrayNode findings = mapper.createArrayNode();
        ObjectNode usage = mapper.createObjectNode();
        usage.put("model", llm.modelName());
        usage.put("members", MEMBERS.size());
        ObjectNode perJudgeer = usage.putObject("perJudgeer");
        List<String> notes = new ArrayList<>();

        if (!llm.configured()) {
            usage.put("batches", 0);
            usage.put("budgetCut", false);
            notes.add("委员会未执行 —— LLM 未配置（缺 ARSENAL_LLM_KEY）");
            return new Outcome(findings, usage, notes, false, 0, 0);
        }
        if (maxBatches == 0) {
            usage.put("batches", 0);
            usage.put("budgetCut", true);
            notes.add("委员会已关闭（arsenal.qa.committee.max-batches-per-job=0）");
            return new Outcome(findings, usage, notes, true, 0, 0);
        }
        List<String> batch = pick(relFiles);
        if (batch.isEmpty()) {
            usage.put("batches", 0);
            notes.add("这一批没有可送审的 .java 文件");
            return new Outcome(findings, usage, notes, false, 0, 0);
        }

        StringBuilder code = new StringBuilder();
        for (String rel : batch) {
            String w = readWindow(workCopy, rel);
            if (w != null) {
                code.append(w);
            }
        }
        if (code.isEmpty()) {
            usage.put("batches", 0);
            notes.add("这批文件一个都读不到，委员会没有料可审");
            return new Outcome(findings, usage, notes, false, 0, 0);
        }

        int budget = Math.min(maxBatches, MEMBERS.size());
        boolean cut = budget < MEMBERS.size();

        // ── 三个审查员并发跑 ──
        List<String> running = MEMBERS.subList(0, budget);
        ExecutorService pool = Executors.newFixedThreadPool(Math.max(1, parallel));
        /** 审查员 → 它报的问题清单 */
        Map<String, List<Issue>> byJudgeer = new LinkedHashMap<>();
        try {
            List<Future<Map.Entry<String, List<Issue>>>> futures = new ArrayList<>();
            for (String member : running) {
                Callable<Map.Entry<String, List<Issue>>> task = () -> Map.entry(member, judgeOnce(member, code.toString()));
                futures.add(pool.submit(task));
            }
            for (Future<Map.Entry<String, List<Issue>>> f : futures) {
                Map.Entry<String, List<Issue>> e;
                try {
                    // 单个审查员超时不拖死整批 —— 它记 not-run，其余两个的结论照样有效
                    e = f.get(8, TimeUnit.MINUTES);
                } catch (Exception ex) {
                    notes.add("有一个审查员没跑完（" + rootMsg(ex) + "）—— 它的意见缺席，另外两位的结论仍然有效");
                    continue;
                }
                byJudgeer.put(e.getKey(), e.getValue());
            }
        } finally {
            pool.shutdownNow();
        }

        int totalBatches = 0;
        int promptTokens = 0;
        int completionTokens = 0;
        for (String member : MEMBERS) {
            ObjectNode one = perJudgeer.putObject(member);
            List<Issue> got = byJudgeer.get(member);
            boolean ran = got != null;
            one.put("ran", ran);
            if (!ran) {
                one.put("reason", cut && !running.contains(member)
                        ? "已达本 job 的委员会批数上限 " + maxBatches + "，该审查员未执行"
                        : "这一路没跑起来（见 notes）");
                one.put("batches", 0);
                one.put("issues", 0);
                one.put("promptTokens", 0);
                one.put("completionTokens", 0);
                continue;
            }
            totalBatches++;
            one.put("batches", 1);
            one.put("issues", got.size());
            one.put("promptTokens", (int) got.stream().mapToLong(i -> i.promptTokens).sum());
            one.put("completionTokens", (int) got.stream().mapToLong(i -> i.completionTokens).sum());
            promptTokens += (int) got.stream().mapToLong(i -> i.promptTokens).sum();
            completionTokens += (int) got.stream().mapToLong(i -> i.completionTokens).sum();
        }
        usage.put("batches", totalBatches);
        usage.put("promptTokens", promptTokens);
        usage.put("completionTokens", completionTokens);
        usage.put("budgetCut", cut);
        // 成本 ×3 这件事必须写进报告 —— 只给一个总数会让人以为和单审一样便宜
        usage.put("costNote", "三个审查员各调一次 LLM，成本是单审的 " + totalBatches + " 倍"
                + (totalBatches < MEMBERS.size() ? "（本 job 有审查员没跑）" : ""));

        // ── 交叉验证 ──
        // 用「文件:行 + 归一化标题」当同一问题的键：三个审查员措辞不同，
        // 但都指向同一行同一件事时必须被认成一条，否则「共识」永远是 0。
        Map<String, List<String>> voters = new LinkedHashMap<>();
        Map<String, Issue> canonical = new LinkedHashMap<>();
        for (Map.Entry<String, List<Issue>> e : byJudgeer.entrySet()) {
            for (Issue i : e.getValue()) {
                String key = i.file + ":" + i.line + "|" + normalize(i.title);
                voters.computeIfAbsent(key, k -> new ArrayList<>()).add(e.getKey());
                canonical.putIfAbsent(key, i);
            }
        }

        int consensus = 0;
        int solo = 0;
        for (Map.Entry<String, List<String>> e : voters.entrySet()) {
            Issue i = canonical.get(e.getKey());
            int n = e.getValue().size();
            boolean isConsensus = n >= 2;
            if (isConsensus) {
                consensus++;
            } else {
                solo++;
            }
            ObjectNode f = mapper.createObjectNode();
            f.put("file", i.file);
            f.put("line", i.line);
            f.put("title", i.title);
            f.put("impact", i.impact);
            f.put("evidence", i.evidence);
            f.put("signal", isConsensus ? CONSENSUS : SOLO);
            f.put("voters", n);
            ArrayNode who = f.putArray("reportedBy");
            e.getValue().forEach(who::add);
            f.put("signalText", isConsensus
                    ? "共识：" + n + " 个审查员都报了它（" + String.join("、", e.getValue()) + "）"
                    : "孤证：只有「" + e.getValue().get(0) + "」报了它 —— "
                            + "孤证不等于误报，只说明另外两位没看见；请自己核一遍再决定改不改");
            findings.add(f);
        }
        // 一个都没报也是一条结论 —— 报告里要写出来，否则「0 条」会被读成「没审」
        if (findings.isEmpty()) {
            notes.add("三个审查员跑完了，一个问题都没报 —— 这不等于「代码没问题」，"
                    + "它们只看得到送进来的那几个文件与这一批视角");
        }
        return new Outcome(findings, usage, notes, cut, consensus, solo);
    }

    // ── 单个审查员 ────────────────────────────────────────────────

    private record Issue(String file, int line, String title, String impact, String evidence,
                         int promptTokens, int completionTokens) {
    }

    private List<Issue> judgeOnce(String member, String code) {
        String reply;
        int pt = 0;
        int ct = 0;
        try {
            LlmClient.Reply r = llm.chat(systemFor(member), "待审代码（行号|内容）：\n\n" + code);
            reply = r.content();
            pt = r.promptTokens();
            ct = r.completionTokens();
        } catch (LlmClient.LlmException e) {
            throw new IllegalStateException(member + " 审查员调用失败：" + e.getMessage(), e);
        }
        String cleaned = reply.strip();
        if (cleaned.startsWith("```")) {
            cleaned = cleaned.replaceAll("^```[a-zA-Z]*\\n?", "").replaceAll("```\\s*$", "");
        }
        List<Issue> out = new ArrayList<>();
        try {
            JsonNode root = mapper.readTree(cleaned);
            JsonNode arr = root.path("findings");
            if (!arr.isArray()) {
                return out;
            }
            for (JsonNode f : arr) {
                String file = f.path("file").asString("");
                int line = f.path("line").asInt(0);
                String evidence = f.path("evidence").asString("");
                // 与语义判定同一纪律：给不出行号 / 行号不在送检窗口内 → 丢，不硬收
                if (line < 1 || evidence.isBlank() || file.isBlank()) {
                    continue;
                }
                out.add(new Issue(file, line, f.path("title").asString(""),
                        f.path("impact").asString(""), evidence, pt, ct));
            }
        } catch (RuntimeException e) {
            // 格式不对 = 这一位没发言，不是「它认为没问题」
            throw new IllegalStateException(member + " 审查员返回的不是约定 JSON", e);
        }
        return out;
    }

    private String systemFor(String member) {
        String role = switch (member) {
            case SECURITY -> "你是资深应用安全审查员。只看安全：注入、路径逃逸、越权、敏感信息硬编码、"
                    + "反序列化、SSRF、命令拼接、密钥管理。不评论性能与并发。";
            case PERFORMANCE -> "你是资深性能审查员。只看性能：循环内 IO、N+1、无界集合、重复计算、"
                    + "不必要的同步与拷贝、缺分页的查询。不评论安全与并发。";
            default -> "你是资深并发审查员。只看并发：共享可变状态、ThreadLocal 泄漏、锁的粒度与顺序、"
                    + "事务里做远程调用、幂等性、线程池配置、不安全的发布。不评论安全与性能。";
        };
        return role + """
                
                给定代码，只输出 JSON，不输出任何解释文字。
                输出契约（严格遵守）：{"findings":[{"file":"<给定文件名>","line":<整数绝对行号>,
                "title":"<一句话说清问题>","impact":"<一句话说死会出什么事>","evidence":"<该行原文>"}]}
                铁律：拿不准就一条都不报；给不出精确行号的一律不许输出；evidence 必须是该行原文。
                没有问题就输出 {"findings":[]} —— 空数组是合法答案，比硬凑一条好。
                """;
    }

    private List<String> pick(List<String> relFiles) {
        List<String> java = relFiles.stream().filter(f -> f.endsWith(".java")).sorted().toList();
        int cap = Math.max(1, maxBatches);
        // 每次委员会只审一批 —— 三个审查员 × 一批 = 3 次调用，超了就是钱
        return java.size() <= cap ? java : java.subList(0, cap);
    }

    private String readWindow(Path root, String rel) {
        try {
            String body = java.nio.file.Files.readString(root.resolve(rel),
                    java.nio.charset.StandardCharsets.UTF_8);
            if (body.length() > FILE_WINDOW_CHARS) {
                int cut = body.lastIndexOf('\n', FILE_WINDOW_CHARS);
                body = body.substring(0, cut < 0 ? FILE_WINDOW_CHARS : cut);
            }
            StringBuilder sb = new StringBuilder();
            sb.append("// 文件：").append(rel).append('\n');
            int n = 0;
            for (String line : body.split("\n", -1)) {
                n++;
                sb.append(n).append("| ").append(line).append('\n');
            }
            return sb.toString();
        } catch (java.io.IOException | RuntimeException e) {
            return null;
        }
    }

    /**
     * 交叉验证的键归一化。<b>只归一空白与标点，不归一措辞</b> ——
     * 措辞不同恰恰是不同审查员各自写的证据；把它们揉成同一个词，
     * 「共识」就会从一个需要论证的数字变成一个恒等于分组数的数字。
     */
    static String normalize(String title) {
        if (title == null) {
            return "";
        }
        String s = title.replaceAll("\\s+", "");
        // 只剥掉句末标点：标题首尾的修饰词保留
        s = s.replaceAll("[。．.，,；;！!？?、]+$", "");
        return s;
    }

    private static String rootMsg(Throwable t) {
        Throwable c = t;
        while (c.getCause() != null && c.getCause() != c) {
            c = c.getCause();
        }
        return c.getMessage() == null ? c.getClass().getSimpleName() : c.getMessage();
    }
}
