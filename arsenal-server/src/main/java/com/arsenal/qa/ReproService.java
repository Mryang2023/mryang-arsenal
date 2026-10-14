package com.arsenal.qa;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * C1 的编排 —— 语义 finding 从「我觉得这里有 bug」走到「我真的跑红了」。
 *
 * <pre>
 * finding ──ReproAuthor──▶ 测试源码 ──ReproRunner──▶ 编译 + 跑 N 次
 *                            │                          │
 *                            │                          ▼
 *                            └──────────────▶ ReproVerdict（纯逻辑，唯一判据）
 *                                                       │
 *                                                       ▼
 *                       finding.repro = { verdict, rate, evidence }  +  两档分流
 * </pre>
 *
 * <p><b>两档分流是这一层真正的产出</b>，判据只有一条：
 * {@link ReproVerdict#REPRODUCED} 进实锤档，其余三档全部留在待确认档。
 * 其中 {@code NOT_REPRODUCED} 单列出来，是因为它是一条<b>反向结论</b>：
 * 「我复现 3 次都是绿的」足以让这条规则降权甚至撤案，不该和「没跑」混在一起。
 *
 * <p>三条不许破的：
 * <ol>
 *   <li><b>不伪造。</b>跑不起来就是 {@code NOT_RUN} + 原因，绝不写成「没复现」。</li>
 *   <li><b>不在这里重算规则结论。</b>这一层只往 finding 上挂 repro 段，
 *       P0/P1 分档仍在 QaService 那一侧 —— 判据不许有第二份实现。</li>
 *   <li><b>预算看得见。</b>一次复现 = 一次 LLM 调用 + 一次编译 + N 次跑。
 *       每 job 的复现条数有上限，超限即停并把剩下的如实标成「未实锤（没跑）」。</li>
 * </ol>
 */
@Component
public class ReproService {

    private static final Logger log = LoggerFactory.getLogger(ReproService.class);

    private final ReproAuthor author;
    private final LlmClient llm;
    private final ObjectMapper mapper;
    private final int maxPerJob;
    private final int attempts;

    public ReproService(ReproAuthor author, LlmClient llm, ObjectMapper mapper,
                        @Value("${arsenal.qa.repro.max-per-job:5}") int maxPerJob,
                        @Value("${arsenal.qa.repro.attempts:3}") int attempts) {
        this.author = author;
        this.llm = llm;
        this.mapper = mapper;
        this.maxPerJob = Math.max(0, maxPerJob);
        this.attempts = Math.max(1, attempts);
    }

    public record Outcome(List<String> notes, ObjectNode usage, int proven, int attempted, boolean budgetCut) {
    }

    /**
     * 给一批语义 finding 补复现。
     *
     * @param workCopy 被检项目的**工作副本**；传 null 就整批记「没跑」
     * @param m2Repo   本地仓库
     * @param findings 语义 findings（就地挂 repro 段）
     */
    public Outcome attach(Path workCopy, Path m2Repo, ArrayNode findings) {
        ObjectNode usage = mapper.createObjectNode();
        usage.put("model", llm.modelName());
        usage.put("attemptsPerCase", attempts);
        usage.put("maxPerJob", maxPerJob);
        List<String> notes = new ArrayList<>();
        int proven = 0;
        int attempted = 0;
        boolean budgetCut = false;

        if (maxPerJob == 0) {
            String why = "本 job 关闭了复现实锤（arsenal.qa.repro.max-per-job=0）";
            notes.add(why + " —— 所有语义 finding 留在待确认档");
            usage.put("budgetCut", true);
            usage.put("proven", 0);
            usage.put("attempted", 0);
            for (JsonNode f : findings) {
                if (f instanceof ObjectNode on) {
                    on.set("repro", mapper.createObjectNode()
                            .put("verdict", ReproVerdict.NOT_RUN)
                            .put("reason", why)
                            .put("tierText", ReproVerdict.tierText(
                                    new ReproVerdict.Judgement(ReproVerdict.NOT_RUN, "", 0, 0, null, ""))));
                }
            }
            return new Outcome(notes, usage, 0, 0, true);
        }

        if (workCopy == null) {
            notes.add("没有工作副本，复现实锤整段未执行 —— 这不是「没复现」");
        }

        for (JsonNode f : findings) {
            if (!(f instanceof ObjectNode on)) {
                continue;
            }
            if (attempted >= maxPerJob) {
                budgetCut = true;
                String why = "已达本 job 的复现条数上限 " + maxPerJob + "，其余 finding 留在待确认档";
                on.set("repro", mapper.createObjectNode()
                        .put("verdict", ReproVerdict.NOT_RUN)
                        .put("reason", why)
                        .put("tierText", "未实锤（没跑起来）"));
                continue;
            }
            attempted++;

            String rel = on.path("file").asString("");
            String source = readQuietly(workCopy == null ? null : workCopy.resolve(rel));

            ReproAuthor.Authored a;
            try {
                a = author.author(on, source);
            } catch (RuntimeException e) {
                log.warn("复现测试生成异常", e);
                on.set("repro", mapper.createObjectNode()
                        .put("verdict", ReproVerdict.NOT_RUN)
                        .put("reason", "生成复现测试时异常：" + e.getMessage())
                        .put("tierText", "未实锤（没跑起来）"));
                continue;
            }

            ObjectNode repro = mapper.createObjectNode()
                    .put("tierText", ReproVerdict.tierText(
                            new ReproVerdict.Judgement(ReproVerdict.NOT_RUN, "", 0, 0, null, "")));

            if (a.refused() || a.draft() == null) {
                repro.put("verdict", ReproVerdict.NOT_RUN)
                        .put("reason", a.note())
                        .put("authored", false);
                on.set("repro", repro);
                notes.add(rel + "：" + a.note());
                continue;
            }

            if (workCopy == null) {
                repro.put("verdict", ReproVerdict.NOT_RUN)
                        .put("reason", "测试写出来了，但没有工作副本可跑 —— 没跑，不是没复现")
                        .put("authored", true)
                        .put("testClass", a.className())
                        .put("testSource", a.draft().source());
                on.set("repro", repro);
                continue;
            }

            ReproRunner.Result r;
            try {
                r = ReproRunner.run(workCopy, m2Repo, a.draft(), attempts);
            } catch (RuntimeException e) {
                log.warn("复现执行异常", e);
                repro.put("verdict", ReproVerdict.NOT_RUN)
                        .put("reason", "执行复现时异常：" + e.getMessage())
                        .put("authored", true)
                        .put("testClass", a.className());
                on.set("repro", repro);
                continue;
            }

            ReproVerdict.Judgement j = r.judgement();
            repro.put("verdict", j.verdict())
                    .put("reason", j.reason())
                    .put("tierText", ReproVerdict.tierText(j))
                    .put("authored", true)
                    .put("testClass", a.className())
                    .put("testSource", a.draft().source())
                    .put("compileMs", r.compileMs());
            if (j.redCount() > 0) {
                repro.put("redCount", j.redCount());
            }
            if (j.attempts() > 0) {
                repro.put("attempts", j.attempts());
            }
            if (j.rate() != null) {
                repro.put("rate", j.rate());
            }
            // 稳定性是 rate 的函数，但**报告层要看得见** —— 判据在 ReproVerdict 一处，这里只转述
            repro.put("stability", j.stability())
                    .put("stabilityText", ReproVerdict.stabilityText(j))
                    .put("stableSamples", ReproVerdict.MIN_SAMPLES_FOR_STABILITY);
            if (j.failureExcerpt() != null && !j.failureExcerpt().isBlank()) {
                repro.put("failureExcerpt", j.failureExcerpt());
            }
            if (!r.compileError().isBlank()) {
                repro.put("compileError", r.compileError());
            }
            if (!r.testClasspath().isEmpty()) {
                ArrayNode cp = repro.putArray("testClasspath");
                r.testClasspath().forEach(cp::add);
            }
            on.set("repro", repro);

            if (j.proven()) {
                proven++;
            }
            notes.add(rel + "：" + ReproVerdict.tierText(j) + " —— " + j.reason());
        }

        usage.put("budgetCut", budgetCut);
        usage.put("proven", proven);
        usage.put("attempted", attempted);
        return new Outcome(notes, usage, proven, attempted, budgetCut);
    }

    private static String readQuietly(Path p) {
        if (p == null) {
            return "";
        }
        try {
            return Files.isRegularFile(p) ? Files.readString(p, StandardCharsets.UTF_8) : "";
        } catch (IOException | RuntimeException e) {
            return "";
        }
    }
}
