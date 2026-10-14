package com.arsenal.qa;

import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 复现判据 —— <b>「这条语义 finding 到底算不算实锤」的唯一出处</b>。
 *
 * <p>计划书 C1 的核心承诺是：置信度不再来自「模型嘴里的 0.8」，而来自「我真的跑红了」。
 * 那么「跑红了」怎么算，就必须是一份**纯逻辑、无 IO、可被直接验证**的判据，
 * 而不是散在调用方 if 里的直觉。本类就是那份判据。
 *
 * ─────────────────────────────────────────────────────────────
 * 四档，不是两档 —— 因为「没跑起来」绝不能落进「没复现」：
 *
 * <pre>
 * REPRODUCED      测试红了，且红的原因是断言失败（不是编译错 / 超时 / 环境错）
 * NOT_REPRODUCED  跑了 N 次全绿 —— 这是一条**结论**：模型说的这个 bug 不存在或已修
 * INVALID         测试自己不行（编译不过 / 类名对不上 / 一个 @Test 都没有）
 * NOT_RUN         环境不具备（缺 junit jar / 缺 m2 / 超时 / 沙箱拒了）
 * </pre>
 *
 * <p><b>最容易写错的一条</b>：把 {@code NOT_RUN} 当成 {@code NOT_REPRODUCED}。
 * 那样页面会显示「复现失败」而实际是「没跑」—— 用例草案会被当成「模型说错了」，
 * 下一步就会去删规则。10-14 硬约定 21 说的就是这件事：<b>跑不动与没跑不许写成同一句话</b>。
 *
 * <p>另一条同样重要：<b>{@code NOT_REPRODUCED} 是一条有价值的结论，不是失败</b>。
 * 「我复现 3 次都是绿的」比「我猜这里有个 bug」更接近真相，它该进报告并让规则降权，
 * 而不是被当成一次失败悄悄丢掉。
 */
public final class ReproVerdict {

    private ReproVerdict() {
    }

    public static final String REPRODUCED = "reproduced";
    public static final String NOT_REPRODUCED = "not-reproduced";
    public static final String INVALID = "invalid";
    public static final String NOT_RUN = "not-run";

    /** 一次「跑」的结果 —— 由 {@link ReproRunner} 填，判据只看这几个字段。 */
    public record Run(boolean ran, int exitCode, String stdout, String stderr, String reason) {

        public static Run notRun(String reason) {
            return new Run(false, -1, "", "", reason);
        }
    }

    /** 判定的结果。{@code tier} 是给报告用的两档分流依据。 */
    public record Judgement(String verdict, String reason, int redCount, int attempts, Double rate,
                            String failureExcerpt) {

        /** 实锤档 = 只有 {@link #REPRODUCED} 进；其余三档一律留在「待确认」。 */
        public boolean proven() {
            return REPRODUCED.equals(verdict);
        }

        /** 稳定性分档（见 {@link #stabilityOf}）。判定里不直接存 —— 它是 rate 的函数，存两份就会漂。 */
        public String stability() {
            return stabilityOf(redCount, attempts);
        }
    }

    // ── 稳定性：flaky 判定 ────────────────────────────────────────
    //
    // 计划书 C1 的边界写得很清楚：「并发 bug 的复现测试本身可能 flaky ——
    // 如实标『复现率 3/10』，不假装稳定」。
    // 所以这里做的是**标注**，不是**降级**：
    //
    //   ⚠ 偶发复现**仍然是实锤**。跑红过就是跑红过 ——
    //     如果因为「不稳定」把它降到待确认，那正是并发类缺陷的下场：
    //     它们天生低复现率，于是永远进不了实锤档，于是永远没人修。
    //     稳定性只影响「你有多急」，不影响「它是不是真的」。
    public static final String STABILITY_STABLE = "stable";
    public static final String STABILITY_FLAKY = "flaky";
    public static final String STABILITY_ABSENT = "absent";
    /** 样本不足 —— **宁可不给结论，也不拿 1/1 说「稳定复现」**。 */
    public static final String STABILITY_INSUFFICIENT = "insufficient";

    /** 少于这个样本数就不给稳定性结论。1 次跑红说明不了「稳定」，2 次也说明不了。 */
    public static final int MIN_SAMPLES_FOR_STABILITY = 3;

    /**
     * 稳定性分档。<b>纯函数</b>，判据只看两个数 —— 所以能被直接验证。
     *
     * @param redCount 跑红的次数（不含没跑起来的那些）
     * @param attempts 真正跑了的次数（<b>分母</b>：超时的、被沙箱拒的不算）
     */
    public static String stabilityOf(int redCount, int attempts) {
        if (attempts < MIN_SAMPLES_FOR_STABILITY) {
            return STABILITY_INSUFFICIENT;
        }
        if (redCount <= 0) {
            return STABILITY_ABSENT;
        }
        return redCount >= attempts ? STABILITY_STABLE : STABILITY_FLAKY;
    }

    /** 稳定性的一句话说法，页面与报告原样用。 */
    public static String stabilityText(Judgement j) {
        return switch (j.stability()) {
            case STABILITY_STABLE -> "稳定复现（每次都红）";
            case STABILITY_FLAKY -> "偶发复现 —— 是真问题，但不稳定"
                    + "（这类通常是并发 / 时序 / 环境相关；它仍然是实锤，只是你没法靠它天天拦）";
            case STABILITY_ABSENT -> "跑够了但一次都没红";
            default -> "样本不足（跑了 " + j.attempts() + " 次，少于 " + MIN_SAMPLES_FOR_STABILITY
                    + " 次）—— 不给稳定性结论";
        };
    }

    private static final Pattern TESTS = Pattern.compile("TESTS total=(\\d+) succeeded=(\\d+) failed=(\\d+)");
    private static final Pattern NO_TEST = Pattern.compile("^ERROR 这个类里没找到任何 @Test");
    private static final Pattern ERROR_LINE = Pattern.compile("^ERROR (.+)$", Pattern.MULTILINE);

    /**
     * N 次运行的综合判定。
     *
     * @param runs 每「次」跑的结果（顺序 = 第几次）。全部 notRun 时直接给 NOT_RUN。
     */
    public static Judgement judge(List<Run> runs) {
        if (runs == null || runs.isEmpty()) {
            return new Judgement(NOT_RUN, "一次都没跑（没有可跑的复现测试）", 0, 0, null, "");
        }
        int attempts = runs.size();
        List<Run> ran = runs.stream().filter(Run::ran).toList();

        if (ran.isEmpty()) {
            // ★ 全都没跑 → NOT_RUN，一档都不许往上抬。理由取第一条，不是拼接一堆。
            return new Judgement(NOT_RUN, firstReason(runs), 0, attempts, null, "");
        }

        int red = 0;
        String firstGoodStack = "";
        for (Run r : ran) {
            Judgement one = judgeOne(r);
            if (REPRODUCED.equals(one.verdict())) {
                red++;
                if (firstGoodStack.isEmpty()) {
                    firstGoodStack = one.failureExcerpt();
                }
            }
        }
        int effective = ran.size();
        if (red > 0) {
            // 复现率如实给，不四舍五入成「稳定复现」—— 3 次里红 1 次就是 1/3
            Judgement j = new Judgement(REPRODUCED,
                    "复现成功：" + red + "/" + effective + " 次跑红（另有 " + (attempts - effective)
                            + " 次没跑起来，不计入分母）",
                    red, effective, (double) red / effective, firstGoodStack);
            // ⚠ reason 里补一句稳定性 —— 「跑红了」与「每次都红」是两句话，
            //   只报前者会让并发类缺陷看起来和空指针一样可靠。
            return new Judgement(j.verdict(), j.reason() + "；" + stabilityText(j),
                    j.redCount(), j.attempts(), j.rate(), j.failureExcerpt());
        }
        // 全绿 —— 这是结论，不是失败
        return new Judgement(NOT_REPRODUCED,
                "复现失败：" + effective + " 次全绿 —— 这条语义 finding 站不住（可能已修，或模型判错）",
                0, effective, 0.0, "");
    }

    /** 单次跑的判定。public 是因为调用方要单独用它做「这一次到底算不算红」的展示。 */
    public static Judgement judgeOne(Run r) {
        if (!r.ran()) {
            return new Judgement(NOT_RUN, nullSafe(r.reason()), 0, 0, null, "");
        }
        String out = r.stdout() == null ? "" : r.stdout();
        if (!out.contains("ARSENAL-REPRO-BEGIN")) {
            // 没有哨兵行 = 进程起来了但没跑到我们写的输出段（classpath 缺 / 启动器崩了）
            return new Judgement(NOT_RUN,
                    "进程起来了但没打出约定的结果段（多半是 classpath 缺 junit-platform-launcher）",
                    0, 0, null, head(r.stderr(), 400));
        }
        Matcher noTest = NO_TEST.matcher(out);
        if (noTest.find()) {
            return new Judgement(INVALID, "复现测试里一个 @Test 都没有 —— 测试本身是废的", 0, 0, null, "");
        }
        Matcher m = TESTS.matcher(out);
        if (!m.find()) {
            String err = firstErrorLine(out);
            return new Judgement(INVALID,
                    err == null ? "结果段里没有 TESTS 行，输出格式与约定不符" : err,
                    0, 0, null, head(out, 400));
        }
        int total = parse(m.group(1));
        int failed = parse(m.group(3));
        if (total == 0) {
            return new Judgement(INVALID, "TESTS total=0 —— 一个测试都没发现，不许当「通过」", 0, 0, null, "");
        }
        if (failed <= 0) {
            return new Judgement(NOT_REPRODUCED, "测试全绿（" + total + " 个）", 0, 0, 0.0, "");
        }
        if (r.exitCode() == 2) {
            return new Judgement(NOT_RUN, "启动器以「跑不起来」退出（码 2），这次不计入分母", 0, 0, null, "");
        }
        return new Judgement(REPRODUCED,
                failed + "/" + total + " 个测试红了", 1, 0, null, firstStack(out));
    }

    private static String firstStack(String out) {
        boolean inStack = false;
        StringBuilder sb = new StringBuilder();
        for (String line : out.split("\n")) {
            if (line.startsWith("STACK ")) {
                if (inStack && sb.length() > 0) {
                    break;
                }
                inStack = true;
                sb.append(line.substring(6));
                continue;
            }
            if (inStack && line.startsWith("FAIL ")) {
                break;
            }
            if (inStack) {
                sb.append('\n').append(line);
            }
        }
        return sb.toString().trim();
    }

    private static String firstErrorLine(String out) {
        Matcher m = ERROR_LINE.matcher(out);
        return m.find() ? m.group(1).trim() : null;
    }

    private static int parse(String s) {
        try {
            return Integer.parseInt(s.trim());
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    private static String firstReason(List<Run> runs) {
        for (Run r : runs) {
            if (r.reason() != null && !r.reason().isBlank()) {
                return r.reason();
            }
        }
        return "全部未执行且没有给出原因";
    }

    private static String head(String s, int n) {
        if (s == null || s.isBlank()) {
            return "";
        }
        String t = s.strip();
        return t.length() <= n ? t : t.substring(0, n) + "…";
    }

    private static String nullSafe(String s) {
        return s == null || s.isBlank() ? "没跑，且没给原因" : s;
    }

    /**
     * 报告里那一行中文。**四档各有各的话，不许合并** ——
     * 「没复现」和「没跑」在页面上都显示成「未实锤」的话，用户会去改规则而不是改环境。
     */
    public static String tierText(Judgement j) {
        return switch (j.verdict()) {
            case REPRODUCED -> "有复现（实锤）";
            case NOT_REPRODUCED -> "复现失败 —— 这条 finding 站不住";
            case INVALID -> "复现测试本身无效，未判";
            default -> "未实锤（没跑起来）";
        };
    }

    /**
     * 两档分流的最终依据。<b>偶发复现算实锤</b> —— 见 {@link #STABILITY_FLAKY} 处的理由。
     * 这一句写在方法里而不是散在调用方，是为了让它只有一个可被直接验证的出处。
     */
    public static boolean provedTier(Judgement j) {
        return REPRODUCED.equals(j.verdict());
    }
}
