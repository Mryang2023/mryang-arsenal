package com.arsenal.cases;

import com.arsenal.web.ApiResponse;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 案例执行服务接口。
 *
 * <p>POST /api/cases/run —— 提交案例源码并在独立 JDK 21 子进程里编译运行，返回 stdout/stderr/退出码。
 * GET  /api/cases/jdk  —— 报告本服务实际使用的 JDK（确认是 21+，虚拟线程等才跑得起来）。
 *
 * <p>注意：这是在你自己机器上执行任意提交的 Java 代码。仅限本机/内网使用，不要暴露到公网。
 */
@RestController
@RequestMapping("/api/cases")
public class CaseController {

    private final CaseRunnerService runner;

    public CaseController(CaseRunnerService runner) {
        this.runner = runner;
    }

    @PostMapping("/run")
    public ApiResponse<CaseRunResult> run(@RequestBody CaseRunRequest req) {
        return ApiResponse.ok(runner.run(req));
    }

    @GetMapping("/jdk")
    public ApiResponse<Map<String, String>> jdk() {
        Map<String, String> info = new LinkedHashMap<>();
        info.put("javaHome", runner.javaHome());
        info.put("version", runner.jdkVersion());
        info.put("javac", runner.javacCmd());
        info.put("java", runner.javaCmd());
        return ApiResponse.ok(info);
    }
}
