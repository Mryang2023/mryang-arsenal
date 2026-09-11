package com.arsenal.exporter;

import com.arsenal.domain.Rule;
import com.arsenal.domain.RulesetMeta;
import com.arsenal.domain.Severity;
import com.arsenal.loader.RuleIndex;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 导出服务：把同一份规则数据编译成不同 AI 能直接消费的形式。
 *
 * 「一份数据，三种出口」里的第三种出口在这里落地。
 * 服务端版本的意义在于可被自动化调用（CI、MCP、脚本），
 * 前端那套是给人手动复制的。
 *
 * 关键点：本类不持有任何规则副本，只做格式转换。改了 JSON，这里立即生效。
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

    private final RuleIndex index;

    public ExporterService(RuleIndex index) {
        this.index = index;
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

    public List<Rule> select(Set<Severity> severities, Set<String> categories) {
        return index.filter(severities, categories, false).stream()
                .sorted(Comparator.comparing(Rule::category).thenComparing(Rule::id))
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
                b.append(n++).append(". ").append(r.promptFragment()).append("  <sub>").append(r.id()).append("</sub>\n");
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

    private String buildMarkdown(List<Rule> rules, boolean includeExamples, boolean includeSources,
                                 boolean includeRationale, boolean includeChecks) {
        StringBuilder b = new StringBuilder();
        long mustClass = rules.stream().filter(r -> r.severity() != null && r.severity().blocking()).count();

        b.append("# ").append(index.meta().name()).append(" · 规范书\n\n");
        b.append("> 本文档由规则数据自动生成，请勿手工修改 —— 改数据源。\n");
        b.append(">\n> 版本 **").append(index.meta().version()).append("** ｜ 条目 **").append(rules.size())
                .append("** 条 ｜ 强制级 ").append(mustClass).append(" 条\n");
        b.append("> 适用技术栈：").append(stackLine(index.meta())).append("\n\n");

        b.append("## 级别说明\n\n");
        for (Severity s : Severity.values()) {
            b.append("- **").append(s.label()).append("（").append(s.code()).append("）**：")
                    .append(meaningOf(s)).append('\n');
        }
        b.append("\n---\n\n");

        String currentCategory = null;
        for (Rule r : rules) {
            if (!r.category().equals(currentCategory)) {
                currentCategory = r.category();
                b.append("## ").append(currentCategory).append('\n');
                b.append('\n');
                b.append("_").append(index.byCategory(currentCategory).size()).append(" 条_ \n\n");
            }

            b.append("### `").append(r.id()).append("` ").append(r.title()).append("\n\n");
            b.append("**级别** ").append(r.severity().label()).append("（").append(r.severity().code()).append("）");
            if (!r.tags().isEmpty()) {
                b.append("　**标签** ").append(String.join(" ", r.tags().stream().map(t -> "`" + t + "`").toList()));
            }
            b.append("\n\n");

            if (includeRationale) {
                b.append("**为什么要有这条**\n\n").append(r.rationale()).append("\n\n");
            }
            if (includeExamples) {
                b.append("**❌ 反例**\n\n").append(fence(r.bad(), r.exampleLang())).append('\n');
                b.append("**✅ 正例**\n\n").append(fence(r.good(), r.exampleLang())).append('\n');
            }

            b.append("**约束句（可直接给 AI）**\n\n> ").append(r.promptFragment()).append("\n\n");

            if (includeChecks) {
                b.append("**检查方式**\n\n");
                Rule.Check c = r.checkOrEmpty();
                if (c.hasRegex()) {
                    b.append("- 正则（").append(c.regex().expectPresent() ? "必须命中" : "命中即违规")
                            .append("，作用于 `").append(c.regex().globOrDefault()).append("`）：`")
                            .append(c.regex().pattern().replace("`", "\\`")).append("`\n");
                }
                if (c.hasAst()) {
                    b.append("- AST：`").append(c.ast().query()).append("`（引擎 ")
                            .append(c.ast().engineOrDefault()).append("）\n");
                }
                if (c.hasLlm()) {
                    b.append("- 语义判定：").append(c.llm()).append('\n');
                }
                if (c.hasManual()) {
                    b.append("- 人工检查：").append(c.manual()).append('\n');
                }
                b.append('\n');
            }

            if (includeSources) {
                b.append("**来源**\n\n");
                for (Rule.Source s : r.sources()) {
                    b.append("- ").append(s.ref()).append("　<sub>").append(s.type() == null ? "" : s.type())
                            .append("</sub>\n");
                    if (s.quote() != null && !s.quote().isBlank()) {
                        b.append("  > ").append(s.quote().replace("\n", " ")).append('\n');
                    }
                }
                b.append('\n');
            }
            b.append("---\n\n");
        }
        return b.toString();
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

    private String buildMcp(List<Rule> rules) {
        StringBuilder b = new StringBuilder();
        b.append("{\n");
        b.append("  \"$comment\": \"MCP Server 配置。规则数据源为 arsenal-rules/**/*.json，此处不重复定义任何规则内容。\",\n");
        b.append("  \"mcpServers\": {\n");
        b.append("    \"arsenal\": {\n");
        b.append("      \"command\": \"java\",\n");
        b.append("      \"args\": [\"-jar\", \"arsenal-server-0.1.0.jar\"],\n");
        b.append("      \"env\": { \"ARSENAL_RULES_DIR\": \"./arsenal-rules\" },\n");
        b.append("      \"disabled\": false\n");
        b.append("    }\n");
        b.append("  },\n");
        b.append("  \"_availableRules\": ").append(rules.size()).append(",\n");
        b.append("  \"_tools\": [\"search_rules\", \"get_rule\", \"lint_code\", \"get_prompt\"]\n");
        b.append("}\n");
        return b.toString();
    }

    private String buildJson(List<Rule> rules) {
        // 后端只做最小化 JSON 输出；完整规则集请直接读 arsenal-rules 目录。
        StringBuilder b = new StringBuilder();
        b.append("{\n  \"count\": ").append(rules.size()).append(",\n  \"ids\": [\n");
        for (int i = 0; i < rules.size(); i++) {
            b.append("    \"").append(rules.get(i).id()).append("\"");
            b.append(i < rules.size() - 1 ? ",\n" : "\n");
        }
        b.append("  ]\n}\n");
        return b.toString();
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
