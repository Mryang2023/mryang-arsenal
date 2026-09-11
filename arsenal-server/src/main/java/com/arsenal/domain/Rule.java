package com.arsenal.domain;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

/**
 * 一条规范 = 一个 Rule。
 *
 * 这是整个项目的原子单元：人查、给 AI 用、拿代码验，三条路径消费的都是它。
 * 字段与 arsenal-rules/_schema/rule.schema.json 严格对应。
 *
 * 「无出处不收录」：sources 不允许为空 —— 没有权威背书的条目只是个人偏好，
 * 不配占用强制级配额。
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record Rule(
        String id,
        String category,
        String subcategory,
        String title,
        Severity severity,
        List<Source> sources,
        String rationale,
        AppliesTo appliesTo,
        String bad,
        String good,
        Check check,
        String promptFragment,
        List<String> tags,
        RuleStatus status,
        int version,
        String supersedes,
        String updatedAt
) {

    public Rule {
        sources = sources == null ? List.of() : List.copyOf(sources);
        tags = tags == null ? List.of() : List.copyOf(tags);
    }

    /** 规则的行业出处。出处即权威背书，也是日后升降级的依据。 */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Source(String ref, String type, String quote) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record AppliesTo(List<String> stack, String scope, String pathGlob) {
    }

    /** 文本层检测。零成本、可离线、确定性最强，优先执行。 */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record RegexCheck(String pattern, String flags, String targetGlob, String expect) {

        /** absent（默认）＝命中即违规；present＝必须命中。 */
        public boolean expectPresent() {
            return "present".equalsIgnoreCase(expect);
        }

        public String globOrDefault() {
            return (targetGlob == null || targetGlob.isBlank()) ? "**/*" : targetGlob;
        }
    }

    /** 语法树层检测。由 JavaParser 执行，文本正则做不了的部分交给它。 */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record AstCheck(String engine, String query) {

        public String engineOrDefault() {
            return (engine == null || engine.isBlank()) ? "javaparser" : engine;
        }
    }

    /**
     * 检测方式。四层按 regex → ast → llm → manual 降级。
     * 能自动判定的规则才配叫「可执行规范」，其余只是文档。
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Check(RegexCheck regex, AstCheck ast, String llm, String manual) {

        public static final Check EMPTY = new Check(null, null, null, null);

        public boolean hasRegex() {
            return regex != null && regex.pattern() != null && !regex.pattern().isBlank();
        }

        public boolean hasAst() {
            return ast != null && ast.query() != null && !ast.query().isBlank();
        }

        public boolean hasLlm() {
            return llm != null && !llm.isBlank();
        }

        public boolean hasManual() {
            return manual != null && !manual.isBlank();
        }

        /** 本条规则最强的自动化层级。前端只用 regex 层，所以这个值决定它能不能被离线检出。 */
        public String layer() {
            if (hasRegex()) {
                return "regex";
            }
            if (hasAst()) {
                return "ast";
            }
            if (hasLlm()) {
                return "llm";
            }
            return "manual";
        }
    }

    public Check checkOrEmpty() {
        return check == null ? Check.EMPTY : check;
    }

    public boolean isActive() {
        return status == null || status == RuleStatus.ACTIVE;
    }

    /** 从 bad 示例推断代码语言，用于导出时的代码块标注。 */
    public String exampleLang() {
        String glob = checkOrEmpty().regex() != null ? checkOrEmpty().regex().globOrDefault() : "";
        if (glob.contains(".sql")) {
            return "sql";
        }
        if (glob.contains("xml")) {
            return "xml";
        }
        if (glob.contains("yml") || glob.contains("yaml") || glob.contains("properties")) {
            return "yaml";
        }
        if (glob.contains("commit-msg")) {
            return "text";
        }
        return "java";
    }
}
