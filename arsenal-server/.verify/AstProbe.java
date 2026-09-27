import com.arsenal.domain.Rule;
import com.arsenal.engine.AstEngine;
import com.arsenal.engine.LintEngine;
import com.arsenal.engine.LintReport;
import com.arsenal.engine.LintRequest;
import com.arsenal.engine.SkippedRule;
import com.arsenal.engine.SourceFile;
import com.arsenal.engine.Violation;
import com.arsenal.loader.RuleIndex;
import com.arsenal.loader.RuleLoader;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * F2 验证探针：AST 层是否真的被 LintEngine 驱动、并能给出正确行号。
 *
 * 绕过 Spring，直接 RuleLoader → RuleIndex → AstEngine + LintEngine，
 * 对一份「故意写满 AST 违规」的样例 Java 跑一遍，断言：
 *   1) 15 个语法层检查器对应的规则都产生了违规（带行号）；
 *   2) 5 个「需类型解析」的 AST 规则仍如实留在 skipped（reason 含「留待 LLM」）；
 *   3) 这 15 个规则都不该出现在 skipped 里。
 *
 * 不是产品代码，compile-check 不编它，只有本探针脚本编它。
 */
public final class AstProbe {

    private AstProbe() {
    }

    /** AstEngine 已注册的 15 个语法层检查器对应的规则 id。 */
    private static final Set<String> AST_CHECKER_IDS = Set.of(
            "CONC-POOL-001", "SVC-LAYR-001", "SVC-EXCP-001", "REL-EXCP-001", "REL-EXCP-003",
            "CONC-THRD-001", "WEB-CTRL-002", "WEB-CTRL-005", "SVC-TX-002", "CONC-POOL-005",
            "TEST-UNIT-002", "WEB-CTRL-004", "WEB-CTRL-003", "CONC-POOL-004", "SVC-TX-001");

    public static void main(String[] args) throws Exception {
        if (args.length < 1) {
            System.err.println("用法: AstProbe <rulesDir>");
            System.exit(2);
        }
        Path rulesDir = Path.of(args[0]).toAbsolutePath().normalize();
        ObjectMapper mapper = new ObjectMapper();
        RuleLoader loader = new RuleLoader(rulesDir.toString(), mapper);
        RuleIndex index = new RuleIndex(loader);
        AstEngine ast = new AstEngine();
        LintEngine engine = new LintEngine(index, ast, 5, 2_097_152);

        List<SourceFile> files = List.of(
                // 样本路径必须落在规则的 appliesTo.pathGlob 声明范围内：
                // SVC-TX-001 等声明 **/service/**、WEB-CTRL-002/003/004 声明 **/controller/**，
                // AST 层按 pathGlob 收口后，声明之外的路径不再触发（这正是收口的意义）。
                new SourceFile("com/demo/service/BadService.java", SERVICE),
                new SourceFile("com/demo/controller/BadController.java", CONTROLLER),
                // TEST-UNIT-002 是 regex+ast 双写规则，正则优先路由 —— 违规来自正则层，
                // 其 targetGlob 是 **/src/test/**/*.java，样本路径必须落在里面才会被检出。
                new SourceFile("src/test/java/com/demo/BadTest.java", TEST));

        LintReport report = engine.lint(new LintRequest(files));

        Set<String> violationIds = new HashSet<>();
        for (Violation v : report.violations()) {
            violationIds.add(v.ruleId());
        }

        int llmSkipped = 0;
        Set<String> skippedAstIds = new HashSet<>();
        for (SkippedRule s : report.skipped()) {
            if (s.reason() != null && s.reason().contains("留待 LLM")) {
                llmSkipped++;
                skippedAstIds.add(s.ruleId());
            }
        }

        // ── 打印 ─────────────────────────────────────
        System.out.println("=== F2 AST 层验证 ===");
        System.out.println("active rules      : " + report.rulePool());
        System.out.println("executable rules  : " + report.executableRules());
        System.out.println("violations total  : " + report.total());
        System.out.println("score             : " + report.score() + " (" + report.grade() + ")");
        System.out.println("skipped total     : " + report.skipped().size());
        System.out.println("skipped(留待LLM)  : " + llmSkipped);
        System.out.println("");
        System.out.println("--- AST 违规（ruleId @ file:line — message）---");
        for (Violation v : report.violations()) {
            if (AST_CHECKER_IDS.contains(v.ruleId())) {
                System.out.println("  " + v.ruleId() + " @ " + v.file() + ":" + v.line()
                        + "  [" + v.severity() + "]  " + v.message());
            }
        }
        System.out.println("");
        System.out.println("--- 仍留在 skipped 的 AST 规则（无语法层检查器）---");
        for (SkippedRule s : report.skipped()) {
            if (skippedAstIds.contains(s.ruleId())) {
                System.out.println("  " + s.ruleId() + "  (" + s.layer() + ")  " + s.reason());
            }
        }

        // ── 断言 ─────────────────────────────────────
        List<String> failures = new ArrayList<>();
        for (String id : AST_CHECKER_IDS) {
            if (!violationIds.contains(id)) {
                failures.add("AST 检查器未产生违规: " + id);
            }
            if (skippedAstIds.contains(id)) {
                failures.add("AST 检查器却出现在 skipped: " + id);
            }
        }
        if (llmSkipped != 5) {
            failures.add("留待 LLM 的 skipped 数应为 5，实际 " + llmSkipped);
        }

        System.out.println("");
        if (failures.isEmpty()) {
            System.out.println("[PASS] AST 层已正确接入 LintEngine：15 个检查器全部生效、5 个类型依赖规则诚实留 skipped");
            System.exit(0);
        } else {
            System.out.println("[FAIL] 发现 " + failures.size() + " 处问题：");
            for (String f : failures) {
                System.out.println("  - " + f);
            }
            System.exit(1);
        }
    }

    private static final String SERVICE = """
            package com.demo;

            import org.springframework.beans.factory.annotation.Autowired;
            import org.springframework.stereotype.Service;
            import org.springframework.transaction.annotation.Transactional;
            import org.springframework.scheduling.annotation.Async;

            import java.text.SimpleDateFormat;
            import java.util.concurrent.ThreadPoolExecutor;
            import java.util.concurrent.TimeUnit;
            import java.util.concurrent.LinkedBlockingQueue;

            @Service
            public class BadService {

                @Autowired
                private Object repo;

                private static final SimpleDateFormat SDF = new SimpleDateFormat("yyyy");

                private final ThreadPoolExecutor executor =
                        new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS, new LinkedBlockingQueue<>());

                public void start() {
                    Thread t = new Thread(() -> {});
                }

                public void fail() {
                    throw new RuntimeException("boom");
                }

                @Transactional
                public void save() {
                }

                @Async
                public void asyncWork() {
                }

                @Transactional
                void pkgSave() {
                }

                public void emptyCatch() {
                    try {
                        risk();
                    } catch (Exception e) {
                    }
                }

                public String finallyReturn() {
                    try {
                        return "a";
                    } finally {
                        return "b";
                    }
                }

                private void risk() {
                }
            }
            """;

    private static final String CONTROLLER = """
            package com.demo;

            import org.springframework.web.bind.annotation.*;
            import org.springframework.web.bind.annotation.RequestBody;

            import java.util.List;

            @RestController
            public class BadController {

                @PostMapping("/u")
                public User create(@RequestBody User u) {
                    return u;
                }

                @GetMapping("/list")
                public List<User> list(@RequestParam int pageSize) {
                    return null;
                }

                public void risky() {
                    try {
                        doIt();
                    } catch (Exception e) {
                        // swallow
                    }
                }

                private void doIt() {
                }
            }
            """;

    private static final String TEST = """
            package com.demo;

            import org.junit.jupiter.api.Test;

            public class BadTest {

                @Test
                public void shouldWork() {
                    System.out.println("no assertion");
                }
            }
            """;
}
