package com.arsenal.qa;

import java.io.PrintWriter;
import java.io.StringWriter;
import org.junit.platform.engine.discovery.DiscoverySelectors;
import org.junit.platform.launcher.Launcher;
import org.junit.platform.launcher.LauncherDiscoveryRequest;
import org.junit.platform.launcher.core.LauncherDiscoveryRequestBuilder;
import org.junit.platform.launcher.core.LauncherFactory;
import org.junit.platform.launcher.listeners.SummaryGeneratingListener;
import org.junit.platform.launcher.listeners.TestExecutionSummary;

/**
 * 复现测试的启动器 —— <b>被 {@code ReproRunner} 用 {@code java -cp …} 调起的那一端</b>。
 *
 * <p><b>为什么它是资源而不是编译源。</b>服务端本仓<b>不编译期依赖 JUnit</b>：
 * JUnit 只在「真跑一次复现」那一刻才需要，那一刻的 classpath 是
 * {@code ReproRunner} 现拼的（含用户自己的 jar 与 .m2 里的 junit-platform-*）。
 * 把它放进编译源，等于让整个服务端为了一个可选功能背上 JUnit 的传递依赖 ——
 * 而 {@code console-standalone} 那个 jar 本机还没有（2026-10-14 实测），
 * 于是「实锤」这一档会为一个 jar 卡住全仓。
 * 现在它随用随编译：{@code ReproRunner} 从 classpath 取出本文件、落到工作副本、
 * 用 javac 编译、再用同一份 classpath 跑起来。缺 junit jar 时那一步会失败，
 * 而失败被如实记成「没跑」，不会变成编译不过。
 *
 * <p><b>输出契约（被 ReproRunner 逐行解析，改动前先看它）</b>：
 * <pre>
 * ARSENAL-REPRO-BEGIN
 * TESTS total=3 succeeded=0 failed=3 aborted=0 skipped=0
 * FAIL &lt;显示名&gt;
 * STACK &lt;该失败的首个断言异常，最多 12 行&gt;
 * FAIL ...
 * ARSENAL-REPRO-END
 * </pre>
 * 用哨兵行包住，是因为 JUnit 自己也会往 stdout 打印横幅与日志 ——
 * 不设边界的话，「有失败」和「有一条长得像失败的日志」分不开。
 *
 * <p>退出码：<b>有失败 = 1，全过 = 0，跑不起来 = 2</b>。
 * 2 这一档必须与 1 分开：「测试红了」是实锤，「测试没跑起来」不是 ——
 * 合成一个码，那份没跑起来的报告会被当成实锤（这正是本仓反复付过学费的那类事故）。
 */
public final class ReproTestLauncher {

    private ReproTestLauncher() {
    }

    public static void main(String[] args) {
        if (args.length < 1 || args[0].isBlank()) {
            System.err.println("用法：ReproTestLauncher <测试类全限定名>");
            System.exit(2);
        }
        String testClass = args[0].trim();

        StringBuilder out = new StringBuilder();
        LauncherDiscoveryRequest request;
        try {
            request = LauncherDiscoveryRequestBuilder.request()
                    .selectors(DiscoverySelectors.selectClass(testClass))
                    .build();
        } catch (RuntimeException e) {
            out.append("ARSENAL-REPRO-BEGIN\n")
                    .append("ERROR 选择测试类失败：").append(e.getClass().getSimpleName())
                    .append(": ").append(nullSafe(e.getMessage())).append('\n')
                    .append("ARSENAL-REPRO-END\n");
            System.out.print(out);
            System.exit(2);
            return;
        }

        SummaryGeneratingListener listener = new SummaryGeneratingListener();
        Launcher launcher = LauncherFactory.create();
        launcher.execute(request, listener);

        TestExecutionSummary s = listener.getSummary();
        long found = s.getTestsFoundCount();
        out.append("ARSENAL-REPRO-BEGIN\n");
        if (found == 0) {
            // 0 个测试 ≠ 全过。写不出来的那一档必须自己说话（10-03 教训：0 本身是一条结论）
            out.append("ERROR 这个类里没找到任何 @Test —— 复现测试写空了，不是「通过」\n");
            out.append("ARSENAL-REPRO-END\n");
            System.out.print(out);
            System.exit(2);
            return;
        }
        out.append("TESTS total=").append(found)
                .append(" succeeded=").append(s.getTestsSucceededCount())
                .append(" failed=").append(s.getTestsFailedCount())
                .append(" aborted=").append(s.getTestsAbortedCount())
                .append(" skipped=").append(s.getTestsSkippedCount())
                .append('\n');

        for (TestExecutionSummary.Failure f : s.getFailures()) {
            String display = f.getTestIdentifier() == null
                    ? "(未知测试)"
                    : f.getTestIdentifier().getDisplayName();
            out.append("FAIL ").append(display).append('\n');
            out.append("STACK ").append(head(f.getException(), 12)).append('\n');
        }
        out.append("ARSENAL-REPRO-END\n");
        System.out.print(out);

        System.exit(s.getTestsFailedCount() > 0 ? 1 : 0);
    }

    /** 异常栈的前 n 行。**只取栈，不取 message 之外的任何东西** —— 堆栈就是证据本身。 */
    private static String head(Throwable t, int n) {
        if (t == null) {
            return "(没有异常对象 —— 这是启动器的问题，不是测试的问题)";
        }
        StringWriter sw = new StringWriter();
        t.printStackTrace(new PrintWriter(sw));
        String[] lines = sw.toString().split("\n");
        StringBuilder sb = new StringBuilder();
        sb.append(t.getClass().getName()).append(": ").append(nullSafe(t.getMessage()));
        for (int i = 0; i < Math.min(n, lines.length); i++) {
            String l = lines[i].trim();
            if (l.isEmpty()) {
                continue;
            }
            sb.append(" ⏎ ").append(l);
        }
        return sb.toString();
    }

    private static String nullSafe(String s) {
        return s == null ? "(无消息)" : s.replace('\n', ' ').replace('\r', ' ');
    }
}
