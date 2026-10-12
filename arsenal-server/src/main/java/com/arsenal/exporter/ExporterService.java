package com.arsenal.exporter;

import com.arsenal.domain.Rule;
import com.arsenal.domain.RulesetMeta;
import com.arsenal.domain.Severity;
import com.arsenal.loader.RuleIndex;
import com.arsenal.mcp.McpToolCatalog;
import com.arsenal.util.JsonText;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 导出服务：把同一份规则数据编译成不同 AI 能直接消费的形式。
 *
 * 「一份数据，三种出口」里的第三种出口在这里落地。
 * 服务端版本的意义在于可被自动化调用（CI、MCP、脚本），
 * 前端那套是给人手动复制的。
 *
 * 关键点：本类不持有任何规则副本，只做格式转换。改了 JSON，这里立即生效。
 *
 * <b>一条必须守住的约束：同一种 carrier 在两端必须吐出同样的东西。</b>
 * 前端 exporters.ts 是给人手动复制的出口，后端是给自动化用的出口 ——
 * 两个出口给的答案不一样，比少一个出口危险得多。已对齐：json / markdown / mcp。
 * mcp 的逐字节一致由 npm run verify:parity 断言（见 buildMcp 说明）。
 */
@Service
public class ExporterService {

    public static final String FORMAT_PROMPT = "prompt";
    public static final String FORMAT_MARKDOWN = "markdown";
    public static final String FORMAT_CURSORRULES = "cursorrules";
    public static final String FORMAT_CLAUDE = "claude";
    public static final String FORMAT_MCP = "mcp";
    public static final String FORMAT_JSON = "json";

    public static final List<String> SUPPORTED =
            List.of(FORMAT_PROMPT, FORMAT_MARKDOWN, FORMAT_CURSORRULES, FORMAT_CLAUDE, FORMAT_MCP, FORMAT_JSON);

    /** 与前端 `new Date().toISOString()` 同格式（毫秒 + Z），好让两端的 json 能直接 diff。 */
    private static final DateTimeFormatter ISO_MILLIS =
            DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC);

    private final RuleIndex index;
    private final ObjectMapper mapper;
    private final McpToolCatalog mcpCatalog;

    public ExporterService(RuleIndex index, ObjectMapper mapper, McpToolCatalog mcpCatalog) {
        this.index = index;
        this.mapper = mapper;
        this.mcpCatalog = mcpCatalog;
    }

    public ExportResult export(String format,
                               Set<Severity> severities,
                               Set<String> categories,
                               boolean includeExamples,
                               boolean includeSources,
                               boolean includeRationale,
                               boolean includeChecks) {

        List<Rule> list = select(severities, categories);
        String content = switch (format) {
            case FORMAT_PROMPT -> buildPrompt(list, includeExamples, includeRationale);
            case FORMAT_MARKDOWN -> buildMarkdown(list, includeExamples, includeSources, includeRationale, includeChecks);
            case FORMAT_CURSORRULES -> buildCursorRules(list, includeExamples);
            case FORMAT_CLAUDE -> buildClaude(list, includeExamples);
            case FORMAT_MCP -> buildMcp(list);
            case FORMAT_JSON -> buildJson(list);
            default -> throw new IllegalArgumentException(
                    "不支持的导出格式：" + format + "，可选 " + String.join(" / ", SUPPORTED));
        };

        return new ExportResult(format, filenameOf(format), list.size(),
                content.length(), estimateTokens(content), content);
    }

    /**
     * 按过滤条件取规则，并排成<b>分类的声明顺序</b>（meta.categories 的顺序），分类内按 id。
     *
     * 早先这里按 category 的字母序排（collab, concurrency, data, …），
     * 而前端按 CATEGORY_ORDER（skeleton, web, service, data, …）排 ——
     * 同一份数据、同一种载体，两端给出的条目顺序不一样。
     *
     * 分类顺序是有含义的（从工程骨架到协作约定），不该由字母表决定；
     * 而 meta.categories 的声明顺序本来就等于 CATEGORY_ORDER，所以以数据为准。
     */
    public List<Rule> select(Set<Severity> severities, Set<String> categories) {
        Map<String, Integer> rank = new HashMap<>();
        int i = 0;
        for (RulesetMeta.Category c : index.meta().categories()) {
            rank.put(c.key(), i++);
        }
        return index.filter(severities, categories, false).stream()
                .sorted(Comparator
                        .comparingInt((Rule r) -> rank.getOrDefault(r.category(), Integer.MAX_VALUE))
                        .thenComparing(Rule::id))
                .toList();
    }

    // ──────────────────────────────────────────────── 各载体

    private String buildPrompt(List<Rule> rules, boolean includeExamples, boolean includeRationale) {
        StringBuilder b = new StringBuilder();
        b.append("# 代码规范约束\n\n");
        b.append("以下约束**优先级高于你的默认编码风格**。生成代码前先读一遍；")
                .append("若某条约束与你的习惯冲突，以约束为准，不要自行变通。\n\n");

        RulesetMeta meta = index.meta();
        b.append("适用技术栈：").append(stackLine(meta)).append("\n\n");

        List<Severity> order = List.of(Severity.MUST, Severity.NEVER, Severity.SHOULD, Severity.MAY);
        String[] headings = {"一、强制项（MUST）", "二、禁止项（NEVER）", "三、建议项（SHOULD）", "四、风格项（MAY）"};
        String[] leads = {
                "违反即为错误，不要提交这样的代码。",
                "出现即需返工，没有例外。",
                "默认遵守；确有理由时可以偏离，但请在注释里写明理由。",
                "仅作参考，保持项目内一致即可。"};

        for (int i = 0; i < order.size(); i++) {
            Severity target = order.get(i);
            List<Rule> group = rules.stream().filter(r -> r.severity() == target).toList();
            if (group.isEmpty()) {
                continue;
            }
            b.append("## ").append(headings[i]).append("\n\n");
            b.append("_").append(leads[i]).append("_\n\n");
            int n = 1;
            for (Rule r : group) {
                b.append(n++).append(". ").append(r.promptFragment()).append("（").append(r.id()).append("）\n");
            }
            b.append('\n');
        }

        if (includeExamples) {
            b.append("---\n\n## 附：逐条细则与示例\n\n_仅在你需要判断边界时查阅，不必通读。_\n\n");
            for (Rule r : rules) {
                b.append("### ").append(r.id()).append(' ').append(r.title()).append("\n\n");
                b.append("- **级别**：").append(r.severity().label()).append('\n');
                if (includeRationale) {
                    b.append("- **为什么**：").append(r.rationale()).append('\n');
                }
                b.append("\n**❌ 反例**\n\n").append(fence(r.bad(), r.exampleLang()))
                        .append("\n\n**✅ 正例**\n\n").append(fence(r.good(), r.exampleLang())).append('\n');
            }
        }

        b.append("---\n\n_本约束由「杨先生的军火库」导出（v").append(index.meta().version())
                .append("，").append(rules.size()).append(" 条）。规则数据源为结构化 JSON，三处出口共用同一份数据。_\n");
        return b.toString();
    }

    /**
     * 规范书（人读 / 归档）。
     *
     * 刻意写成「一行一行往里加」，和前端 exporters.ts 的 buildMarkdown <b>一一对应</b> ——
     * 同一种载体在两端必须是同一份文档，而最容易对不上的恰恰是空行、分隔线、标签这种细节：
     * 它们不影响阅读，所以人眼永远看不出来，只会让人拿到两份不同的文件。
     *
     * 摆成同样的形状之后，改动就变成了「两边照着同一处改」。
     * 一致性由 `npm run verify:parity` 逐字节断言，不靠人眼比对。
     */
    private String buildMarkdown(List<Rule> rules, boolean includeExamples, boolean includeSources,
                                 boolean includeRationale, boolean includeChecks) {
        RulesetMeta meta = index.meta();
        List<String> L = new ArrayList<>();

        long must = rules.stream().filter(r -> r.severity() == Severity.MUST).count();
        long never = rules.stream().filter(r -> r.severity() == Severity.NEVER).count();
        long should = rules.stream().filter(r -> r.severity() == Severity.SHOULD).count();

        L.add("# " + meta.name() + " · 规范书");
        L.add("");
        L.add("> 这份文档由规则数据自动生成，请勿手工修改——改数据源。");
        L.add("> ");
        L.add("> 版本 **" + meta.version() + "** ｜ 条目 **" + rules.size() + "** 条 ｜ 强制级 "
                + (must + never) + " 条（强制 " + must + " / 禁止 " + never + "）｜ 建议级 " + should + " 条");
        L.add("> 适用技术栈：" + stackLine(meta));
        L.add("");

        L.add("## 级别说明");
        L.add("");
        for (Severity s : Severity.values()) {
            L.add("- **" + s.label() + "（" + s.code() + "）**：" + meaningOf(s));
        }
        L.add("");

        // 按「传进来这份列表」分组，全流程复用同一个 Map ——
        // 目录和各分类正文章节必须看到同一份数据，否则又会出现「标题 9 条、下面列 3 条」。
        Map<String, List<Rule>> grouped = byCategoryOf(rules);

        L.add("## 目录");
        L.add("");
        for (Map.Entry<String, List<Rule>> e : grouped.entrySet()) {
            L.add("- **" + categoryOf(e.getKey()).nameOrDefault() + "**（" + e.getValue().size() + "）");
            for (Rule r : e.getValue()) {
                L.add("  - `" + r.id() + "` " + r.title());
            }
        }
        L.add("");
        L.add("---");
        L.add("");

        for (Map.Entry<String, List<Rule>> e : grouped.entrySet()) {
            RulesetMeta.Category cat = categoryOf(e.getKey());
            L.add("## " + cat.nameOrDefault() + " · " + cat.englishOrDefault());
            L.add("");
            L.add("> " + cat.blurbOrDefault());
            L.add("");

            for (Rule r : e.getValue()) {
                L.add("### `" + r.id() + "` " + r.title());
                L.add("");
                String tags = r.tags().isEmpty()
                        ? ""
                        : "　**标签** " + r.tags().stream().map(t -> "`" + t + "`").collect(Collectors.joining(" "));
                L.add("**级别** " + r.severity().label() + "（" + r.severity().code() + "）" + tags);
                L.add("");

                if (includeRationale) {
                    L.add("**为什么要有这条**");
                    L.add("");
                    L.add(r.rationale());
                    L.add("");
                }

                if (includeExamples) {
                    L.add("**❌ 反例**");
                    L.add("");
                    L.add(fence(r.bad(), r.exampleLang()));
                    L.add("");
                    L.add("**✅ 正例**");
                    L.add("");
                    L.add(fence(r.good(), r.exampleLang()));
                    L.add("");
                }

                L.add("**约束句（可直接给 AI）**");
                L.add("");
                L.add("> " + r.promptFragment());
                L.add("");

                if (includeChecks) {
                    Rule.Check c = r.checkOrEmpty();
                    L.add("**检查方式**");
                    L.add("");
                    if (c.hasRegex()) {
                        L.add("- 正则（" + (c.regex().expectPresent() ? "必须命中" : "命中即违规")
                                + "，作用于 `" + c.regex().globOrDefault() + "`）：");
                        L.add("");
                        L.add("  ```");
                        L.add("  " + c.regex().pattern());
                        L.add("  ```");
                    }
                    if (c.hasAst()) {
                        L.add("- AST：`" + c.ast().query() + "`（引擎 " + c.ast().engineOrDefault() + "）");
                    }
                    if (c.hasLlm()) {
                        L.add("- 语义判定：" + c.llm());
                    }
                    if (c.hasManual()) {
                        L.add("- 人工检查：" + c.manual());
                    }
                    L.add("");
                }

                if (includeSources) {
                    L.add("**来源**");
                    L.add("");
                    for (Rule.Source s : r.sources()) {
                        L.add("- " + s.ref() + "（" + meta.sourceTypeLabel(s.type()) + "）");
                        if (s.quote() != null && !s.quote().isBlank()) {
                            L.add("  > " + s.quote().replace("\n", " "));
                        }
                    }
                    L.add("");
                }

                L.add("---");
                L.add("");
            }
        }

        L.add("");
        L.add("_生成自 arsenal-rules（v" + meta.version() + "）。共 " + rules.size()
                + " 条，其中强制级 " + index.stats().mustClass() + " 条（当前上限 "
                + index.stats().mustHardLimit() + "，已用 " + index.stats().budgetUsedPct() + "%）。_");
        return String.join("\n", L) + "\n";
    }

    /**
     * 按分类分组，保持传入顺序（rules 已按 category → id 排好，所以先出现的分类即分类顺序）。
     *
     * 刻意按<b>传进来这份列表</b>分组，而不是回查全量索引：
     * 筛选（severity / category）之后条目数已经变了，全量索引回答的是另一个问题。
     * 这里曾经用 {@code index.byCategory(...)} 取条目数，于是 {@code ?severity=MUST}
     * 导出的文档会出现「分类标题写 9 条、下面只列 3 条」。
     */
    private Map<String, List<Rule>> byCategoryOf(List<Rule> rules) {
        return rules.stream().collect(Collectors.groupingBy(
                Rule::category, LinkedHashMap::new, Collectors.toList()));
    }

    /** 分类元信息查不到时退回原始 key —— 露出原始 key 比编一个好听的名字更容易发现问题。 */
    private RulesetMeta.Category categoryOf(String key) {
        for (RulesetMeta.Category c : index.meta().categories()) {
            if (c.key().equals(key)) {
                return c;
            }
        }
        return new RulesetMeta.Category(key, key, key, "", "", 0);
    }

    private String buildCursorRules(List<Rule> rules, boolean includeExamples) {
        StringBuilder b = new StringBuilder();
        b.append("# 项目代码规范（.cursorrules）\n\n");
        b.append("本文件由「杨先生的军火库」自动生成。生成或修改代码时，以下约束优先级最高。")
                .append("如果我的要求与之冲突，先提醒我，不要默默违反。\n\n");
        b.append("技术栈：").append(stackLine(index.meta())).append("。使用 jakarta.* 命名空间（不要用 javax.*），Maven 构建。\n\n");

        b.append("## 必须做到\n\n");
        rules.stream().filter(r -> r.severity() == Severity.MUST)
                .forEach(r -> b.append("- ").append(r.promptFragment()).append('\n'));
        b.append("\n## 绝对不要做\n\n");
        rules.stream().filter(r -> r.severity() == Severity.NEVER)
                .forEach(r -> b.append("- ").append(r.promptFragment()).append('\n'));
        b.append("\n## 建议做法\n\n");
        rules.stream().filter(r -> r.severity() == Severity.SHOULD)
                .forEach(r -> b.append("- ").append(r.promptFragment()).append('\n'));
        b.append('\n');

        if (includeExamples) {
            b.append("## 关键写法对照\n\n");
            rules.stream()
                    .filter(r -> r.severity() == Severity.MUST || r.severity() == Severity.NEVER)
                    .limit(25)
                    .forEach(r -> b.append("### ").append(r.title()).append("\n\n不要这样写：\n\n")
                            .append(fence(r.bad(), r.exampleLang()))
                            .append("\n应该这样写：\n\n").append(fence(r.good(), r.exampleLang())).append('\n'));
        }

        b.append("---\n<!-- 来源：杨先生的军火库 v").append(index.meta().version())
                .append("，共 ").append(rules.size()).append(" 条规则 -->\n");
        return b.toString();
    }

    private String buildClaude(List<Rule> rules, boolean includeExamples) {
        StringBuilder b = new StringBuilder();
        b.append("# CLAUDE.md\n\n## 项目代码规范\n\n");
        b.append("本项目所有代码必须遵守「杨先生的军火库」规范集。以下条目是硬约束，")
                .append("生成代码前请先对照检查，提交前请自查一遍。\n\n");
        b.append("- **规范版本**：v").append(index.meta().version())
                .append("（").append(index.meta().releasedAt()).append("）\n");
        b.append("- **技术栈**：").append(stackLine(index.meta())).append('\n');
        b.append("- **命名空间**：jakarta（不是 javax）\n\n");

        b.append("### 强制项（MUST）——违反即返工\n\n");
        rules.stream().filter(r -> r.severity() == Severity.MUST)
                .forEach(r -> b.append("- [ ] ").append(r.promptFragment()).append('\n'));
        b.append("\n### 禁止项（NEVER）——出现即返工\n\n");
        rules.stream().filter(r -> r.severity() == Severity.NEVER)
                .forEach(r -> b.append("- [ ] ").append(r.promptFragment()).append('\n'));

        List<Rule> should = rules.stream().filter(r -> r.severity() == Severity.SHOULD).toList();
        if (!should.isEmpty()) {
            b.append("\n### 建议项（SHOULD）\n\n");
            should.forEach(r -> b.append("- [ ] ").append(r.promptFragment()).append('\n'));
        }
        b.append('\n');

        if (includeExamples) {
            b.append("### 常见错误写法对照\n\n");
            rules.stream()
                    .filter(r -> r.severity() == Severity.MUST || r.severity() == Severity.NEVER)
                    .limit(20)
                    .forEach(r -> b.append("**").append(r.title()).append("**\n\n")
                            .append(fence(r.bad(), r.exampleLang()))
                            .append("\n改为：\n\n").append(fence(r.good(), r.exampleLang())).append('\n'));
        }
        return b.toString();
    }

    /**
     * MCP Server 配置 —— 与前端 exporters.ts 的 buildMcp <b>逐字节一致</b>。
     *
     * 工具定义来自 arsenal-rules/mcp-tools.json（{@link McpToolCatalog} 加载），
     * 前端那份读的是 sync-rules 编译出的 @/generated/mcp-tools.json —— 同一份数据，
     * 于是「两端一致」不再是妥协，而是可被 npm run verify:parity 逐字节断言的事实。
     *
     * 渲染手法与前端一一对应：逐行拼接，嵌套 schema 用 {@link JsonText#pretty}
     * （等价 {@code JSON.stringify(x, null, 2)}）再 {@link #indentBlock} 缩进 2 格；
     * env 用 inlineObject 那种 {@code { "K": "V" }} 紧凑形态，对齐前端的 inlineObject。
     * 形状摆成一样之后，改动就变成「两边照着同一处改」。
     */
    private String buildMcp(List<Rule> rules) {
        JsonNode launcher = mcpCatalog.launcher();
        JsonNode tools = mcpCatalog.tools();

        StringBuilder b = new StringBuilder();
        b.append("{\n");
        b.append("  \"$comment\": ").append(JsonText.quote(McpToolCatalog.CONFIG_COMMENT)).append(",\n");
        b.append("  \"mcpServers\": {\n");
        b.append("    ").append(JsonText.quote(mcpCatalog.serverName())).append(": {\n");
        b.append("      \"command\": ").append(JsonText.quote(mcpCatalog.launcherCommand())).append(",\n");
        b.append("      \"args\": ").append(JsonText.compact(mcpCatalog.launcherArgs())).append(",\n");
        b.append("      \"env\": ").append(inlineEnv(mcpCatalog.launcherEnv())).append(",\n");
        b.append("      \"disabled\": false\n");
        b.append("    }\n");
        b.append("  },\n");
        b.append("\n");
        b.append("  \"_availableRules\": ").append(rules.size()).append(",\n");
        b.append("  \"$toolDefinitions\": ").append(indentBlock(JsonText.pretty(tools), 2)).append('\n');
        b.append("}\n");
        return b.toString();
    }

    /** 紧凑对象 {@code { "K": "V" }}，对齐前端 exporters.ts 的 inlineObject。 */
    private static String inlineEnv(JsonNode env) {
        StringBuilder b = new StringBuilder("{ ");
        boolean first = true;
        Iterator<Map.Entry<String, JsonNode>> it = env.properties().iterator();
        while (it.hasNext()) {
            Map.Entry<String, JsonNode> e = it.next();
            if (!first) b.append(", ");
            first = false;
            b.append(JsonText.quote(e.getKey())).append(": ").append(JsonText.quote(e.getValue().asText()));
        }
        return b.append(" }").toString();
    }

    /** 首行不动、其余行统一前缩 pad 格，对齐前端 exporters.ts 的 indentBlock。 */
    private static String indentBlock(String s, int pad) {
        String padStr = " ".repeat(pad);
        String[] lines = s.split("\n", -1);
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < lines.length; i++) {
            if (i > 0) b.append(padStr);
            b.append(lines[i]);
            if (i < lines.length - 1) b.append('\n');
        }
        return b.toString();
    }

    /**
     * 原始规则集。
     *
     * 与前端 exporters.ts 的 buildJson 同构：同一层封套、同一批字段、同一个顺序。
     * 这个载体是给「二次开发 / 自建管道」用的 —— 它拿到的必须和界面上下载到的是同一份东西，
     * 否则「一份数据三种出口」这句话在自动化链路上就不成立了。
     *
     * 早先这里只吐 {@code {count, ids}}，而且是手写字符串拼接
     * （id 直接插进引号里，没有任何 JSON 转义 —— 现有 ID 干净所以没炸，但那是个隐患，
     * 而且一个讲规范的项目不该自己实现 JSON emitter）。
     * 现在交给 Jackson：转义、字段顺序、null 处理都不用自己操心。
     *
     * 与前端的一致性口径是<b>逐结构</b>而非逐字节：Jackson 的
     * {@code {"a" : 1}} / 数组内联风格和 {@code JSON.stringify(x, null, 2)}
     * 本来就不同，而 JSON 的空白不是内容。所以断言的是
     * 「对象键无序、数组有序、未设置的字段不出现」—— 由 npm run verify:parity 检查。
     */
    private String buildJson(List<Rule> rules) {
        RulesetMeta meta = index.meta();
        JsonCarrier carrier = new JsonCarrier(
                meta.ruleset(), meta.name(), meta.version(),
                ISO_MILLIS.format(Instant.now()),
                rules.size(), rules);
        try {
            return mapper.writerWithDefaultPrettyPrinter().writeValueAsString(carrier) + "\n";
        } catch (JacksonException e) {
            throw new IllegalStateException("规则集 JSON 序列化失败 —— 这是代码 bug，不是数据问题", e);
        }
    }

    /** 与前端 buildJson 的封套逐字段对应（含字段顺序 —— 顺序一致才 diff 得出来）。 */
    public record JsonCarrier(
            String ruleset,
            String name,
            String version,
            String exportedAt,
            int count,
            List<Rule> rules
    ) {
    }

    // ──────────────────────────────────────────────── 工具

    private String stackLine(RulesetMeta meta) {
        Map<String, String> stack = meta.targetStack();
        List<String> parts = new ArrayList<>();
        for (String key : List.of("language", "framework", "database")) {
            if (stack.containsKey(key)) {
                parts.add(stack.get(key));
            }
        }
        return parts.isEmpty() ? "Java 17 / Spring Boot 3.2.x" : String.join(" · ", parts);
    }

    private String meaningOf(Severity s) {
        return switch (s) {
            case MUST -> "硬约束。违反必修，计入合规分。";
            case NEVER -> "明令禁止。与强制同级阻断。";
            case SHOULD -> "强烈建议。违反不计分，报告中列出。";
            case MAY -> "可选风格。仅作提示词参考，不参与校验。";
        };
    }

    private String fence(String code, String lang) {
        String body = code == null ? "" : code.stripTrailing().replace("```", "``\u200b`");
        return "```" + lang + "\n" + body + "\n```";
    }

    private String filenameOf(String format) {
        return switch (format) {
            case FORMAT_PROMPT -> "arsenal-system-prompt.md";
            case FORMAT_MARKDOWN -> "arsenal-spec.md";
            case FORMAT_CURSORRULES -> ".cursorrules";
            case FORMAT_CLAUDE -> "CLAUDE.md";
            case FORMAT_MCP -> "arsenal-mcp.json";
            case FORMAT_JSON -> "arsenal-rules.json";
            default -> "arsenal-export.txt";
        };
    }

    private int estimateTokens(String s) {
        return Math.round(s.length() / 2.4f);
    }

    /** 导出结果。content 与前端导出中心生成的内容同源同构。 */
    public record ExportResult(
            String format,
            String filename,
            int ruleCount,
            int chars,
            int tokens,
            String content
    ) {
    }
}
