package com.arsenal.qa;

import java.util.List;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import org.springframework.stereotype.Component;

/**
 * 复现测试的作者 —— 把一条语义 finding 变成一段**能跑的** JUnit 5 测试源码。
 *
 * <p>这是 C1 的入口，也是最容易把整件事变成谎言的一环。所以这里的规矩很硬：
 *
 * <ul>
 *   <li><b>不许模型自己宣布复现成功。</b>它只负责「写一个会失败的测试」，
 *       写不写得出、跑不跑得红，一律由 {@link ReproRunner} + {@link ReproVerdict} 说话。
 *       返回里没有 confidence 字段 —— 有的话它会被误当成实锤。</li>
 *   <li><b>写不出来就说写不出来。</b>模型回 {@code cannot: true} 是一个合法且有用的答案：
 *       它把「这条 finding 没有可自动化的复现路径」显式说出来，
 *       而不是硬凑一段跑绿的测试（那会让人误以为「验证过了，没问题」）。</li>
 *   <li><b>格式不对重试一次，再不对就放弃这一条。</b>与语义判定同一个口径（宁缺毋滥）。</li>
 * </ul>
 *
 * <p>为什么用 JUnit 5：本机 .m2 里 {@code junit-platform-launcher} 与
 * {@code junit-jupiter-engine} 齐全（2026-10-14 实测），而
 * {@code console-standalone} 没有 —— 用已齐的那几个，不用缺的那个。
 */
@Component
public class ReproAuthor {

    private final LlmClient llm;
    private final ObjectMapper mapper;

    public ReproAuthor(LlmClient llm, ObjectMapper mapper) {
        this.llm = llm;
        this.mapper = mapper;
    }

    /** 一次 authored 的结果。{@code draft} 为 null 表示「模型说写不出来」或「格式不对，已放弃」。 */
    public record Authored(ReproRunner.Draft draft, String className, String note, boolean refused,
                           int promptTokens, int completionTokens) {
    }

    /** 目标源码的取样窗口 —— 与 SemanticJudge 同一个量级，不多送。 */
    private static final int WINDOW_CHARS = 3_200;

    /**
     * @param finding 语义 finding 的 JSON 节点（必须有 file / line / evidence / impact）
     * @param targetSource 目标文件内容（可为空 —— 空就只给行与证据）
     */
    public Authored author(JsonNode finding, String targetSource) {
        String body = clip(targetSource);
        int pt = 0;
        int ct = 0;
        for (int attempt = 1; attempt <= 2; attempt++) {
            try {
                LlmClient.Reply r = llm.chat(system(), user(finding, body));
                pt += r.promptTokens();
                ct += r.completionTokens();
                JsonNode n = parse(r.content());
                if (n == null) {
                    if (attempt == 2) {
                        return new Authored(null, "", "模型两次都没给出约定 JSON —— 这一条放弃生成复现测试",
                                true, pt, ct);
                    }
                    continue;
                }
                if (n.path("cannot").asBoolean(false)) {
                    return new Authored(null, "", "模型说这条 finding 没有可自动化的复现路径：" + n.path("reason").asString(""),
                            true, pt, ct);
                }
                String fqcn = n.path("className").asString("").trim();
                String src = n.path("source").asString("");
                if (fqcn.isEmpty() || src.isBlank() || !src.contains("@Test")) {
                    if (attempt == 2) {
                        return new Authored(null, "",
                                "模型给的测试缺少全限定类名或 @Test —— 放弃（宁缺毋滥，不硬凑）", true, pt, ct);
                    }
                    continue;
                }
                return new Authored(new ReproRunner.Draft(fqcn, src), fqcn, n.path("note").asString(""),
                        false, pt, ct);
            } catch (LlmClient.LlmException e) {
                return new Authored(null, "", "生成复现测试失败：" + e.getMessage(), true, pt, ct);
            }
        }
        return new Authored(null, "", "生成复现测试失败（已重试一次）", true, pt, ct);
    }

    private String system() {
        return """
                你是资深 Java 测试工程师。给你一条代码审查发现，请写一个**能复现它**的最小 JUnit 5 测试。
                只输出 JSON，不输出任何解释文字。
                输出契约（严格遵守）：
                {"cannot":false,"className":"<全限定类名，必须含包名与 @Test>",
                 "source":"<完整 Java 测试源码的转义字符串>",
                 "note":"<一句话说清这个测试怎么触发那条问题>"}
                或 {"cannot":true,"reason":"<为什么这条发现无法用自动化测试复现>"}
                铁律：
                1. 只能依赖 JUnit 5（org.junit.jupiter.api.*）；需要外部服务就用桩类替代，不要引第三方库。
                2. 测试必须**断言会失败的那件事**——写一个在缺陷存在时抛 AssertionError 的断言。
                3. 不要 mock 被测对象本身；用最小输入驱动它。
                4. 写不出能复现的测试就返回 cannot:true，不要硬凑一段会通过的测试。
                """;
    }

    private String user(JsonNode f, String source) {
        return "发现（" + f.path("ruleId").asString("?") + "）：" + f.path("ruleTitle").asString("")
                + "\n位置：" + f.path("file").asString("?") + ":" + f.path("line").asInt(0)
                + "\n问题：" + f.path("impact").asString("")
                + "\n那一行原文：" + f.path("evidence").asString("")
                + "\n\n目标文件（行号|内容）：\n\n" + (source.isBlank() ? "（没取到全文，就上面那一行）" : source);
    }

    private JsonNode parse(String content) {
        String s = content.strip();
        if (s.startsWith("```")) {
            s = s.replaceAll("^```[a-zA-Z]*\\n?", "").replaceAll("```\\s*$", "");
        }
        try {
            JsonNode n = mapper.readTree(s);
            return n != null && n.isObject() ? n : null;
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static String clip(String s) {
        if (s == null || s.isBlank()) {
            return "";
        }
        if (s.length() <= WINDOW_CHARS) {
            return s;
        }
        int cut = s.lastIndexOf('\n', WINDOW_CHARS);
        if (cut < 0) {
            cut = WINDOW_CHARS;
        }
        return s.substring(0, cut);
    }

    /** 供报告层引用：四档判据的取值顺序（报告与 UI 都按这个顺序渲染，不自己另排）。 */
    public static List<String> tiers() {
        return List.of(ReproVerdict.REPRODUCED, ReproVerdict.NOT_REPRODUCED,
                ReproVerdict.INVALID, ReproVerdict.NOT_RUN);
    }
}
