package com.arsenal.util;

import com.fasterxml.jackson.databind.JsonNode;

import java.math.BigInteger;
import java.util.Iterator;
import java.util.Map;

/**
 * 确定性 JSON 文本器 —— 逐字节等价于 JavaScript 的 {@code JSON.stringify}。
 *
 * <b>为什么不用 Jackson 的 pretty printer：</b>
 * 两端要产出同一份文件（见 ExporterService 的类注释），而 Jackson 吐
 * {@code {"a" : 1}}、{@code JSON.stringify} 吐 {@code {"a": 1}} —— 冒号前多一个空格。
 * 于是「两端一致」只能用「逐结构」来断言，永远上不了「逐字节」。
 *
 * 这里把前端那份格式化规则照抄一遍：2 空格缩进、冒号后一个空格、
 * 空对象 {@code {}} / 空数组 {@code []} 不展开、非 ASCII 不转义
 * （{@code JSON.stringify} 不转义中文，照转会把产物写成一堆 unicode 转义序列）。
 *
 * 有了它，mcp 这个载体就能像 markdown 一样上逐字节断言，
 * 而不是像 json 那样退而求其次只看结构。
 */
public final class JsonText {

    private JsonText() {
    }

    /** 等价于 {@code JSON.stringify(v, null, 2)}。 */
    public static String pretty(JsonNode node) {
        StringBuilder b = new StringBuilder();
        write(node, b, 2, 0);
        return b.toString();
    }

    /** 等价于 {@code JSON.stringify(v)}（无任何空白）。 */
    public static String compact(JsonNode node) {
        StringBuilder b = new StringBuilder();
        write(node, b, 0, 0);
        return b.toString();
    }

    /** JSON 字符串字面量（含首尾引号）。 */
    public static String quote(String s) {
        StringBuilder b = new StringBuilder();
        quoteInto(s == null ? "" : s, b);
        return b.toString();
    }

    // ──────────────────────────────────────────────── 内部

    private static void write(JsonNode n, StringBuilder b, int space, int level) {
        if (n == null || n.isNull() || n.isMissingNode()) {
            b.append("null");
            return;
        }
        if (n.isObject()) {
            if (n.isEmpty()) {
                b.append("{}");
                return;
            }
            b.append('{');
            Iterator<Map.Entry<String, JsonNode>> it = n.fields();
            boolean first = true;
            while (it.hasNext()) {
                Map.Entry<String, JsonNode> e = it.next();
                if (!first) {
                    b.append(',');
                }
                first = false;
                newline(b, space, level + 1);
                quoteInto(e.getKey(), b);
                b.append(space > 0 ? ": " : ":");
                write(e.getValue(), b, space, level + 1);
            }
            newline(b, space, level);
            b.append('}');
            return;
        }
        if (n.isArray()) {
            if (n.isEmpty()) {
                b.append("[]");
                return;
            }
            b.append('[');
            boolean first = true;
            for (JsonNode item : n) {
                if (!first) {
                    b.append(',');
                }
                first = false;
                newline(b, space, level + 1);
                write(item, b, space, level + 1);
            }
            newline(b, space, level);
            b.append(']');
            return;
        }
        if (n.isTextual()) {
            quoteInto(n.textValue(), b);
            return;
        }
        if (n.isBoolean()) {
            b.append(n.booleanValue());
            return;
        }
        if (n.isNumber()) {
            b.append(numberText(n));
            return;
        }
        b.append(n);
    }

    /**
     * 数字形态与 JS 对齐。
     *
     * 整数直接落十进制；浮点交给 Jackson 的 asText —— 它用的是
     * BigDecimal 的最短表示，与 JS 的 Number.prototype.toString 在
     * 本项目的数据里是同一结果。当前数据源不含浮点，这条分支只为
     * 「哪天有人往工具 schema 里塞了个 default: 1.5」不炸而已。
     */
    private static String numberText(JsonNode n) {
        if (n.isIntegralNumber()) {
            BigInteger i = n.bigIntegerValue();
            return i.toString();
        }
        return n.asText();
    }

    private static void newline(StringBuilder b, int space, int level) {
        if (space <= 0) {
            return;
        }
        b.append('\n');
        b.append(" ".repeat(space * level));
    }

    /**
     * 字符串转义，规则与 {@code JSON.stringify} 一致：
     * 只转义 {@code " \} 与 C0 控制字符，其余（含中文）原样输出。
     */
    private static void quoteInto(String s, StringBuilder b) {
        b.append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            switch (c) {
                case '"' -> b.append("\\\"");
                case '\\' -> b.append("\\\\");
                case '\n' -> b.append("\\n");
                case '\r' -> b.append("\\r");
                case '\t' -> b.append("\\t");
                case '\b' -> b.append("\\b");
                case '\f' -> b.append("\\f");
                default -> {
                    if (c < 0x20) {
                        b.append(String.format("\\u%04x", (int) c));
                    } else {
                        b.append(c);
                    }
                }
            }
        }
        b.append('"');
    }
}
