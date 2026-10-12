package com.arsenal.autopsy;

import tools.jackson.databind.JsonNode;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 观察项解释器 —— 六算子，判据全在 JSON 里，**这一行 Java 都不认识「依赖过多」这个概念**。
 *
 * <p>为什么不把观察项写成 Java：换一种语言（或换一个团队）就得改代码重编译，
 * 而观察项恰恰是最该随项目调的东西 —— 有的团队不许 Nginx，有的团队 CI 门槛是 5 个 stage。
 * 所以判据是数据（`arsenal-checkups/checkups.json`），这里只有一个解释器。
 *
 * <p><b>三种结局，不许合并成两种。</b>一条观察项可能是：
 * <ol>
 *   <li>{@code fired} —— 条件成立，报告里出现这一条；</li>
 *   <li>{@code 没触发} —— 条件不成立，不出现；</li>
 *   <li>{@code unevaluated} —— **算不出来**（路径不存在 / 类型不对 / 算子不认识）。</li>
 * </ol>
 * 第三种如果并进第二种，报告就会把「没查」显示成「没问题」——
 * 这正是本仓反复治的病（{@code charterNotExecutableCount} 漏前缀那次）。
 * 所以这里显式返回 {@link Unevaluated}，调用方必须把它显示出来。
 *
 * <p>算子只有六个（{@code >= <= == != contains exists}），**刻意不做表达式引擎**：
 * 一条观察项就是一个三元条件。要做「A 且 B」就写两条观察项 —— 报告里出现两条，
 * 比在一个 {@code when} 里塞 AND/OR 更好读、更好验。
 */
public final class CheckupEvaluator {

    /** 一条观察项规则（已从 JSON 解析，与 JSON 字段一一对应）。 */
    public record Rule(
            String id,
            String level,
            String fact,
            String op,
            JsonNode value,
            String text,
            String advice,
            String evidenceFrom,
            int evidenceLimit) {
    }

    /** 一条证据。铁律：结论必带 file:line —— 没有就明说没有，不许省略。 */
    public record Evidence(String path, int line) {
        public String render() {
            if (path == null || path.isEmpty()) {
                return "（无文件证据）";
            }
            return line > 0 ? path + ":" + line : path + "（无行号）";
        }
    }

    /** 触发的观察项：一句话结论 + 证据 + 触发时的实测值。 */
    public record Finding(String id, String level, String text, String advice, List<Evidence> evidence, String actual) {
    }

    /** 算不出来的观察项。**必须显示** —— 它与「没触发」在页面上是两件事。 */
    public record Unevaluated(String id, String fact, String op, String reason) {
    }

    /** 一次解释的完整结果。 */
    public record Outcome(List<Finding> fired, List<Unevaluated> unevaluated, int ruleCount) {
    }

    private final List<Rule> rules;

    public CheckupEvaluator(List<Rule> rules) {
        this.rules = rules == null ? List.of() : List.copyOf(rules);
    }

    public int ruleCount() {
        return rules.size();
    }

    public Outcome evaluate(JsonNode facts) {
        List<Finding> fired = new ArrayList<>();
        List<Unevaluated> unevaluated = new ArrayList<>();
        for (Rule r : rules) {
            JsonNode node = resolve(facts, r.fact());
            Boolean hit = compare(r.op(), node, r.value());
            if (hit == null) {
                unevaluated.add(new Unevaluated(r.id(), r.fact(), r.op(),
                        "事实里取不到可比的值（路径不存在或类型与算子不配）—— 这条观察项本次没有结论，不等于没问题"));
                continue;
            }
            if (!hit) {
                continue;
            }
            fired.add(new Finding(
                    r.id(),
                    r.level(),
                    render(r.text(), node, r.value()),
                    r.advice(),
                    evidenceOf(facts, r),
                    renderActual(node)));
        }
        return new Outcome(List.copyOf(fired), List.copyOf(unevaluated), rules.size());
    }

    // ─────────────────────────────────────────────────────────────
    // 路径解析
    // ─────────────────────────────────────────────────────────────

    /**
     * 点分路径取值。支持：字段名、数组下标、末尾的 {@code .length}。
     *
     * <p>{@code length} 的语义跟着节点类型走：数组取元素数、字符串取字符数、对象取字段数。
     * 三种都叫「有多少个」，观察项要的就是这个数。
     */
    static JsonNode resolve(JsonNode root, String path) {
        if (root == null || path == null || path.isBlank()) {
            return null;
        }
        JsonNode cur = root;
        for (String seg : path.split("\\.")) {
            if (cur == null || cur.isMissingNode()) {
                return null;
            }
            String s = seg.trim();
            if (s.isEmpty()) {
                return null;
            }
            if ("length".equals(s)) {
                return lengthOf(cur);
            }
            if (cur.isArray()) {
                int idx = asIndex(s);
                if (idx < 0 || idx >= cur.size()) {
                    return null;
                }
                cur = cur.get(idx);
                continue;
            }
            if (!cur.isObject()) {
                return null;
            }
            cur = cur.get(s);
        }
        return cur == null || cur.isMissingNode() ? null : cur;
    }

    private static JsonNode lengthOf(JsonNode node) {
        int n = node.isArray() ? node.size()
                : node.isObject() ? node.size()
                : node.isTextual() ? node.asText().length()
                : -1;
        return n < 0 ? null : new tools.jackson.databind.node.IntNode(n);
    }

    private static int asIndex(String s) {
        if (s.isEmpty() || s.length() > 9) {
            return -1;
        }
        for (int i = 0; i < s.length(); i += 1) {
            if (!Character.isDigit(s.charAt(i))) {
                return -1;
            }
        }
        try {
            return Integer.parseInt(s);
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 六算子
    // ─────────────────────────────────────────────────────────────

    /**
     * @return true 命中 / false 未命中 / **null = 算不出来**（调用方必须把它显示出来，不许当成 false）
     */
    static Boolean compare(String op, JsonNode actual, JsonNode expected) {
        if (op == null) {
            return null;
        }
        switch (op) {
            case "exists" -> {
                if (actual == null) {
                    return Boolean.FALSE.equals(boolOf(expected)) ? Boolean.TRUE : Boolean.FALSE;
                }
                boolean present = actual.isArray() ? actual.size() > 0
                        : actual.isTextual() ? !actual.asText().isEmpty()
                        : !actual.isNull();
                return present == Boolean.TRUE.equals(boolOf(expected));
            }
            case "contains" -> {
                if (actual == null || !expected.isTextual()) {
                    return null;
                }
                if (actual.isArray()) {
                    String want = expected.asText();
                    for (JsonNode n : actual) {
                        if (n.isTextual() && n.asText().equals(want)) {
                            return Boolean.TRUE;
                        }
                    }
                    return Boolean.FALSE;
                }
                if (actual.isTextual()) {
                    return actual.asText().contains(expected.asText());
                }
                return null;
            }
            case ">=", "<=", "==", "!=" -> {
                if (expected.isNumber() || expected.isBoolean()) {
                    Double a = numOf(actual);
                    if (a == null) {
                        return null;
                    }
                    double b = expected.isBoolean() ? (expected.asBoolean() ? 1d : 0d) : expected.asDouble();
                    return switch (op) {
                        case ">=" -> a >= b;
                        case "<=" -> a <= b;
                        case "==" -> a == b;
                        default -> a != b;
                    };
                }
                if (expected.isTextual()) {
                    // 「构建工具不是 maven」这类判据：actual 取不到（null）时不许判成「不等于 → 命中」，
                    // 那会把「没扫到构建文件」误报成「构建工具不是 maven」。
                    if (actual == null || !actual.isTextual()) {
                        return null;
                    }
                    int cmp = actual.asText().compareTo(expected.asText());
                    return switch (op) {
                        case "==" -> cmp == 0;
                        case "!=" -> cmp != 0;
                        default -> null; // >= <= 对字符串无意义 —— 宁可说算不出来
                    };
                }
                return null;
            }
            default -> {
                return null;
            }
        }
    }

    private static Boolean boolOf(JsonNode n) {
        if (n == null || n.isNull()) {
            return null;
        }
        return n.isBoolean() ? n.asBoolean() : Boolean.parseBoolean(n.asText());
    }

    private static Double numOf(JsonNode n) {
        if (n == null || !n.isNumber()) {
            return null;
        }
        return n.asDouble();
    }

    // ─────────────────────────────────────────────────────────────
    // 文案与证据
    // ─────────────────────────────────────────────────────────────

    /** 占位符只有两个：{n} 实测值、{value} 阈值。带实测值是「这条算出来的」的自证。 */
    static String render(String text, JsonNode actual, JsonNode expected) {
        if (text == null) {
            return "";
        }
        return text.replace("{n}", renderActual(actual))
                .replace("{value}", expected == null || expected.isNull() ? "（未给）" : expected.asText());
    }

    static String renderActual(JsonNode actual) {
        if (actual == null || actual.isNull()) {
            return "（取不到）";
        }
        if (actual.isTextual()) {
            return actual.asText().isEmpty() ? "（空）" : actual.asText();
        }
        // 容器值（数组/对象）原样紧凑 JSON 呈现。Jackson 3 里 asText() 对容器是**抛异常**
        // 而不是旧版那种未定义行为 —— 观察项一命中数组型事实（如服务清单）整份体检报告就 500，
        // 2026-10-12 /qa 自检本仓时踩实。展示降级好过整个功能不可用。
        if (actual.isArray() || actual.isObject()) {
            return actual.toString();
        }
        return actual.asText();
    }

    /**
     * 取最多 {@code limit} 条证据。
     *
     * <p>三种形状都要认：直接带 {@code path}/{@code line} 的（依赖、Nginx 配置）、
     * 把出处塞在 {@code evidence[]} 里的（未识别依赖）、以及**一条都没有**的
     * （「没有 CI」这种结论天然没有文件证据 —— 那时返回一条「（无文件证据）」，
     * 让页面上明说是「没找到」而不是「没查」）。
     */
    private static List<Evidence> evidenceOf(JsonNode facts, Rule r) {
        if (r.evidenceFrom() == null || r.evidenceFrom().isBlank()) {
            return List.of(new Evidence("", 0));
        }
        JsonNode arr = resolve(facts, r.evidenceFrom());
        if (arr == null || !arr.isArray() || arr.isEmpty()) {
            return List.of(new Evidence("", 0));
        }
        List<Evidence> out = new ArrayList<>();
        for (int i = 0; i < arr.size() && out.size() < r.evidenceLimit(); i += 1) {
            out.add(evidenceOfOne(arr.get(i)));
        }
        return List.copyOf(out);
    }

    private static Evidence evidenceOfOne(JsonNode item) {
        // 三种形状都要认：直接带 path 的（依赖 / Nginx 配置）、把文件路径放在 file 字段的
        // （code.directCalls 的 {from,to,file}）、以及把出处塞进 evidence[] 的（未识别依赖）。
        // 认错形状的后果是证据退化成「（无文件证据）」，而那条会被读成「没查」。
        for (String key : new String[]{"path", "file"}) {
            JsonNode pathNode = item.get(key);
            if (pathNode != null && pathNode.isTextual() && !pathNode.asText().isEmpty()) {
                JsonNode lineNode = item.get("line");
                return new Evidence(pathNode.asText(), lineNode != null && lineNode.isNumber() ? lineNode.asInt() : 0);
            }
        }
        JsonNode ev = item.get("evidence");
        if (ev != null && ev.isArray() && !ev.isEmpty()) {
            return evidenceOfOne(ev.get(0));
        }
        // 都没有 —— 用 group:artifact / from→to 这类可读标识兜底，行号是 0，
        // 页面显示「（无行号）」，不许假装成有出处
        String group = item.path("group").asText("");
        String artifact = item.path("artifact").asText("");
        String label = (group.isEmpty() ? "" : group + ":") + artifact;
        return new Evidence(label.isEmpty() ? item.path("from").asText("") + " → " + item.path("to").asText("") : label, 0);
    }
}
