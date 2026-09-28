# -*- coding: utf-8 -*-
"""技术主题 · 重试与超时（HTTP / 下游调用）。

案例库三层结构的第三个主题：

    L1 技术（本文件）      下游调用为什么必须带超时、失败为什么要退避重试
    L2 场景                什么情况下用（带可核对信号）
    L3 实现方案            非阻塞指数退避重试 / 显式超时，附模拟接口实测

「模拟接口测试」用 HttpServer 当假下游：先连续返回几回 500 再变好，
对比「带重试恢复」与「不重试直接失败」；以及「下游睡过头时请求是否快速失败」。
退避等待交给调度器，请求线程不被阻塞（满足 REL-RETRY-001）。
"""

RETRY = r"""package com.example.http;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

/**
 * 指数退避重试（非阻塞）：下游偶发失败时按 base*2^n 间隔，由调度器在后台安排下一次尝试，
 * 不阻塞调用方线程。对应 REL-RETRY-001——禁止用 Thread.sleep 在请求线程上做重试等待。
 */
public final class Retry {

    private final int maxAttempts;
    private final long baseMillis;
    private final long maxMillis;
    private final ScheduledExecutorService scheduler;

    public Retry(int maxAttempts, long baseMillis, long maxMillis,
                 ScheduledExecutorService scheduler) {
        this.maxAttempts = maxAttempts;
        this.baseMillis = baseMillis;
        this.maxMillis = maxMillis;
        this.scheduler = scheduler;
    }

    /** 发起一次带重试的异步调用，返回的 Future 在最终成功或耗尽时完成。 */
    public <T> CompletableFuture<T> run(Supplier<T> task) {
        CompletableFuture<T> result = new CompletableFuture<>();
        attempt(task, 0, result);
        return result;
    }

    private <T> void attempt(Supplier<T> task, int n, CompletableFuture<T> result) {
        try {
            result.complete(task.get());              // 成功：直接完成
        } catch (Exception e) {
            if (n >= maxAttempts - 1) {
                result.completeExceptionally(e);      // 耗尽：透传最后一次异常
                return;
            }
            // 指数退避 + 上限，等待交给调度器，调用方线程不被阻塞
            long backoff = Math.min(maxMillis, baseMillis * (1L << n));
            scheduler.schedule(() -> attempt(task, n + 1, result), backoff, TimeUnit.MILLISECONDS);
        }
    }
}
"""

CLIENT = r"""package com.example.http;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.function.Supplier;

/**
 * 下游调用封装：单次调用必带超时，5xx 视为失败交给 Retry 在后台退避重试。
 */
public class DownstreamClient {

    private final HttpClient http;
    private final Retry retry;

    public DownstreamClient(HttpClient http, Retry retry) {
        this.http = http;
        this.retry = retry;
    }

    public CompletableFuture<String> fetchWithRetry(String baseUrl, String path) {
        Supplier<String> call = () -> {
            HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + path))
                    .timeout(Duration.ofMillis(800))            // 单次调用必须设超时
                    .GET().build();
            try {
                HttpResponse<String> r = http.send(req, HttpResponse.BodyHandlers.ofString());
                // 5xx 视为可重试的瞬时失败，抛异常触发退避重试
                if (r.statusCode() >= 500) throw new RuntimeException("下游 5xx: " + r.statusCode());
                return r.body();
            } catch (Exception e) {
                throw new RuntimeException(e);
            }
        };
        return retry.run(call);
    }
}
"""

TIMEOUT_CFG = r"""package com.example.http;

import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.time.Duration;

/**
 * HTTP 客户端超时配置：连接超时与读取超时都必须显式设置，禁止无限等待。
 * 不设这个上限，下游卡住就会把本服务的线程一条条挂死。
 */
public final class HttpClientConfig {

    /** 建连超时：握不上手最多等这么久。 */
    public static HttpClient newClient() {
        return HttpClient.newBuilder()
                .connectTimeout(Duration.ofMillis(500))
                .build();
    }

    /** 读取超时：连上了但一直不吐数据，最多等这么久。需随每次请求设置。 */
    public static HttpRequest withReadTimeout(HttpRequest.Builder b) {
        return b.timeout(Duration.ofMillis(800)).build();
    }
}
"""

# ── L3 模拟接口测试：下游先 500 后正常，对比重试与否 ──────────────
LAB_RETRY_IMPL = r"""import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

/** 与正文同款的非阻塞指数退避重试，供实验直接用。*/
public class Retry {
    private final int maxAttempts;
    private final long baseMillis;
    private final long maxMillis;
    private final ScheduledExecutorService scheduler;

    public Retry(int maxAttempts, long baseMillis, long maxMillis, ScheduledExecutorService scheduler) {
        this.maxAttempts = maxAttempts;
        this.baseMillis = baseMillis;
        this.maxMillis = maxMillis;
        this.scheduler = scheduler;
    }

    public <T> CompletableFuture<T> run(Supplier<T> task) {
        CompletableFuture<T> result = new CompletableFuture<>();
        attempt(task, 0, result);
        return result;
    }

    private <T> void attempt(Supplier<T> task, int n, CompletableFuture<T> result) {
        try {
            result.complete(task.get());
        } catch (Exception e) {
            if (n >= maxAttempts - 1) { result.completeExceptionally(e); return; }
            long backoff = Math.min(maxMillis, baseMillis * (1L << n));
            scheduler.schedule(() -> attempt(task, n + 1, result), backoff, TimeUnit.MILLISECONDS);
        }
    }
}
"""

LAB_RETRY = r"""import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 模拟下游：前 2 次返回 500，之后恢复正常。
 * 对比「带退避重试」与「不重试」——前者在下游恢复后拿到结果，后者首调即失败。
 */
public class Main {

    static final int MAX = 4;
    static final long BASE_MS = 120;
    static final long MAX_BACKOFF = 1000;
    static String url;

    public static void main(String[] args) throws Exception {
        AtomicInteger hits = new AtomicInteger();
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api", ex -> {
            int n = hits.incrementAndGet();
            if (n <= 2) { ex.sendResponseHeaders(500, -1); ex.close(); return; }
            byte[] body = "ok".getBytes();
            ex.sendResponseHeaders(200, body.length);
            ex.getResponseBody().write(body);
            ex.close();
        });
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.start();
        url = "http://127.0.0.1:" + server.getAddress().getPort() + "/api";

        try {
            runWithRetry();
            runNoRetry();
        } finally {
            server.stop(0);
        }
        System.out.println("java.version=" + System.getProperty("java.version"));
    }

    static void runWithRetry() throws Exception {
        ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(1);
        Retry retry = new Retry(MAX, BASE_MS, MAX_BACKOFF, scheduler);
        var http = HttpClient.newHttpClient();
        long t0 = System.nanoTime();
        CompletableFuture<String> f = retry.run(() -> {
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(5)).GET().build();
            try {
                HttpResponse<String> r = http.send(req, HttpResponse.BodyHandlers.ofString());
                if (r.statusCode() >= 500) throw new RuntimeException("5xx");
                return r.body();
            } catch (Exception e) { throw new RuntimeException(e); }
        });
        String v = f.get();
        long ms = (System.nanoTime() - t0) / 1_000_000;
        System.out.printf("%-12s 最终成功：%s（耗时 %dms，含退避）%n", "带重试", v, ms);
        scheduler.shutdown();
    }

    static void runNoRetry() throws Exception {
        var http = HttpClient.newHttpClient();
        long t0 = System.nanoTime();
        boolean ok = false;
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(5)).GET().build();
            HttpResponse<String> r = http.send(req, HttpResponse.BodyHandlers.ofString());
            ok = r.statusCode() == 200;
        } catch (Exception e) { /* 首调即命中 500，无重试直接失败 */ }
        long ms = (System.nanoTime() - t0) / 1_000_000;
        System.out.printf("%-12s 成功：%s（耗时 %dms）%n", "不重试", ok, ms);
    }
}
"""


TOPIC = {
    "id": "retry-timeout",
    "order": 3,
    "name": "重试与超时",
    "subtitle": "下游调用：用退避重试扛偶发失败，用超时挡住无限等待",
    "glyph": "↻",
    "family": "web",
    "runtime": "JDK 11+ HttpClient / Spring RestTemplate",
    "level": "基础",
    "intent": (
        "重试与超时解决的是「下游不可靠、网络会抖」：偶发的 5xx / 超时不应该直接变成用户可见的失败，"
        "但无脑重试会把下游冲垮、无超时则会让本服务的线程一条条挂死。"
        "两者合起来就是「给失败留余地，给等待设上限」。"
    ),
    "pickWhen": [
        {"vs": "遇到失败直接抛给上层",
         "text": "失败是偶发的、下游很快能恢复（网络抖动 / 实例滚动重启）→ 退避重试；失败是确定性的（参数错误 / 404）→ 不要重试"},
        {"vs": "无超时地一直等",
         "text": "任何外部调用都必须设超时（REL-TIME-001）；不设上限，下游卡住会拖死调用方线程"},
        {"vs": "固定间隔狂重试",
         "text": "下游还没恢复就密集重试会把故障放大成雪崩 → 用指数退避 + 抖动打散重试潮汐"},
    ],
    "limits": [
        "只重试幂等的调用：非幂等（写 / 扣款）重试可能造成重复副作用，必须先保证可重放。",
        "退避不能阻塞请求线程：用调度器而非 Thread.sleep（REL-RETRY-001）。",
        "重试有上限：耗尽后必须向上抛，不能「一直试到天荒地老」。",
        "超时不等于重试：超时是单次调用上限，重试是多次尝试，两者要分别设置。",
    ],
    "references": [
        {"title": "Microsoft · 重试通用指南（指数退避 + 抖动）",
         "url": "https://learn.microsoft.com/en-us/azure/architecture/patterns/retry",
         "note": "退避间隔、抖动、按错误类型决定是否重试的官方设计模式"},
        {"title": "RFC 7231 · 4.2.2 Idempotent Methods",
         "url": "https://datatracker.ietf.org/doc/html/rfc7231#section-4.2.2",
         "note": "GET/PUT/DELETE 幂等，POST 非幂等——决定哪些调用可以安全重试"},
        {"title": "军火库规则集 · REL / WEB 类",
         "note": "外部调用必设超时、禁止用 sleep 做重试、GET 必须幂等的强制级条目出处"},
    ],
    "scenarios": [
        {
            "id": "backoff-retry",
            "order": 1,
            "name": "偶发失败的退避重试",
            "when": (
                "调用下游（HTTP / RPC / 三方接口）时，失败是偶发的、且下游能在秒级内自行恢复——"
                "比如实例滚动重启、瞬时网络抖动、限流返回的 429/503。"
                "这类失败若直接抛给用户，体验极差且毫无必要。"
            ),
            "signals": [
                "监控里下游 5xx / 超时呈「稀疏偶发」而非持续，且能自行恢复",
                "错误集中在下游发布 / 实例迁移窗口期",
                "失败与请求内容无关（同样参数时好时坏）",
            ],
            "decision": "对幂等的下游调用加退避重试：偶发失败被自动吸收，且指数退避 + 上限避免把瞬时故障放大成雪崩。",
            "notSuitable": [
                "失败是确定性的（参数校验失败 / 404 / 权限不足）——重试毫无意义",
                "调用非幂等（下单 / 扣款 / 写）——重试会制造重复副作用，需先上幂等键",
                "下游已持续不可用——重试只是徒增压力，应先熔断",
            ],
            "recipes": [
                {
                    "id": "nonblocking-backoff",
                    "order": 1,
                    "name": "非阻塞指数退避重试",
                    "approach": (
                        "把重试逻辑收进一个 Retry 组件：按 base*2^n 退避、带上限，"
                        "用 ScheduledExecutorService 在后台安排下一次尝试，调用方线程不被阻塞；"
                        "耗尽后把最后一次异常透传出去，由上层决定怎么兜底。"
                    ),
                    "flow": [
                        {"layer": "web", "step": "识别可重试失败",
                         "detail": "5xx / 超时 / 429 视为瞬时失败抛异常；4xx 视为确定性失败不重试。"},
                        {"layer": "web", "step": "安排下一次尝试",
                         "detail": "按指数退避间隔交给定时调度器，请求线程立即返回 Future，不阻塞。"},
                        {"layer": "reliability", "step": "耗尽透传",
                         "detail": "达到最大次数仍失败，把异常交给上层（告警 / 降级 / 返回给用户）。"},
                    ],
                    "packages": [
                        "com.example.http   Retry（非阻塞退避）+ DownstreamClient（带超时调用）",
                    ],
                    "files": [
                        {
                            "id": "retry",
                            "path": "src/main/java/com/example/http/Retry.java",
                            "layer": "web",
                            "lang": "java",
                            "role": "非阻塞指数退避重试组件。",
                            "code": RETRY,
                            "highlights": [
                                {"mark": "scheduler.schedule(() -> attempt(task, n + 1, result), backoff, TimeUnit.MILLISECONDS);",
                                 "title": "退避交给调度器，不阻塞线程",
                                 "text": "等待下一轮尝试由调度器在后台执行，调用方线程立刻拿到 Future 返回。严禁用 Thread.sleep 在请求线程上干等——那会占住 Web 线程、把故障放大。",
                                 "rule": "REL-RETRY-001"},
                                {"mark": "long backoff = Math.min(maxMillis, baseMillis * (1L << n));",
                                 "title": "指数退避 + 上限",
                                 "text": "间隔随尝试次数翻倍并设硬上限，避免「越错越急、越急越错」的雪崩；上限保证不会退避到天荒地老。"},
                                {"mark": "result.completeExceptionally(e);",
                                 "title": "耗尽即透传",
                                 "text": "达到最大次数仍失败，把最后一次异常交给上层决定如何兜底（告警 / 降级），而不是吞掉或无限重试。"},
                            ],
                        },
                        {
                            "id": "client",
                            "path": "src/main/java/com/example/http/DownstreamClient.java",
                            "layer": "web",
                            "lang": "java",
                            "role": "下游调用封装：单次超时 + 5xx 触发重试。",
                            "code": CLIENT,
                            "highlights": [
                                {"mark": ".timeout(Duration.ofMillis(800))",
                                 "title": "单次调用必设超时",
                                 "text": "每次请求都带读取超时，下游卡死时本服务能快速失败而不是线程挂起。所有外部调用都必须设超时。",
                                 "rule": "REL-TIME-001"},
                                {"mark": "if (r.statusCode() >= 500) throw new RuntimeException(\"下游 5xx: \" + r.statusCode());",
                                 "title": "把瞬时错误变成重试信号",
                                 "text": "5xx 视为可重试的瞬时失败，抛异常触发 Retry 的退避逻辑；4xx 不在此列（确定性失败不重试）。"},
                            ],
                        },
                    ],
                    "checklist": [
                        "确认只重试幂等调用，非幂等调用已上幂等键或根本不重试。",
                        "确认退避用调度器实现，没有在请求线程上 Thread.sleep。",
                        "确认有最大尝试次数，耗尽后异常向上透传而非吞掉。",
                        "确认按错误类型区分：5xx/429/超时重试，4xx 不重试。",
                        "确认单次调用超时已设置，且与重试上限配合。",
                    ],
                    "pitfalls": [
                        "对下单 / 扣款等非幂等调用重试：会造成重复扣款，必须先用幂等键去重。",
                        "用 Thread.sleep 在请求线程上干等：占住 Web 线程，下游抖动时迅速耗光线程池。",
                        "固定间隔密集重试：下游还没恢复就又被打一波，把瞬时故障放大成持续雪崩。",
                        "重试吞掉异常只返回 null：调用方以为成功，实际啥都没做（REL-EXCP-001 禁止空 catch）。",
                    ],
                    "performance": {
                        "title": "下游前 2 次 500、之后正常（单次调用 200ms 上限）",
                        "columns": ["维度", "不重试", "带退避重试"],
                        "rows": [
                            ["首次调用结果", "失败（命中 500）", "进入重试"],
                            ["最终结果", "失败抛给用户", "成功拿到数据"],
                            ["代价", "无", "多等约 base*2^0 + base*2^1 ≈ 360ms"],
                            ["风险", "体验差", "退避不当可能放大下游压力"],
                        ],
                        "conclusion": "退避重试把「偶发失败」变成用户无感，但前提是调用幂等、退避有上限。页面下方实验能在你机器上把「带重试恢复」与「不重试直接失败」两组结果跑出来。",
                    },
                    "relatedRules": ["REL-RETRY-001", "REL-TIME-001", "REL-EXCP-001", "WEB-CTRL-006"],
                    "lab": {
                        "kind": "mock-endpoint",
                        "intro": "起一个假下游：前 2 次返回 500，之后返回 200。分别用「带退避重试」与「不重试」两种客户端打它，看最终结果。",
                        "observe": [
                            "带重试组：前 2 次 500 被吸收，第 3 次拿到 200，最终成功",
                            "不重试组：首次即命中 500，直接失败，拿不到后续已恢复的数据",
                        ],
                    },
                    "playground": [
                        {"id": "rt-backoff",
                         "label": "模拟下游：带重试恢复 vs 不重试直接失败",
                         "mainClass": "Main",
                         "note": "假下游前 2 次 500 后正常，对比两种客户端的最终结果。",
                         "files": [
                             {"path": "Retry.java", "code": LAB_RETRY_IMPL},
                             {"path": "Main.java", "code": LAB_RETRY}]},
                    ],
                },
            ],
        },
        {
            "id": "call-timeout",
            "order": 2,
            "name": "外部调用必须设超时",
            "when": (
                "任何跨越进程边界的调用——HTTP、RPC、数据库、缓存、消息队列——"
                "只要不显式设超时，下游一旦卡住，本服务的调用线程就会被一条条挂起，"
                "最终线程池耗尽、整个实例失去响应。"
            ),
            "signals": [
                "下游变慢后，本服务线程池活跃线程数持续打满",
                "接口 RT 的 P99 跟着下游 RT 一起发散，没有上限",
                "下游恢复后，本服务仍长时间不恢复（线程全挂在老请求上）",
            ],
            "decision": "连接超时与读取超时都必须显式设置，且值要远小于上游给本服务的超时——这是「不让一次调用无限挂起」的底线。",
            "notSuitable": [
                "纯本地内存计算，没有任何 I/O——无外部依赖可超时",
                "已经由框架全局统一设了超时且 review 过，无需每个调用再写",
                "调用链上游已明确禁止任何超时（极少见，通常是设计有误）",
            ],
            "recipes": [
                {
                    "id": "explicit-timeout",
                    "order": 1,
                    "name": "显式连接 + 读取超时",
                    "approach": (
                        "构造 HTTP 客户端时设连接超时（握不上手的上限），"
                        "每次请求设读取超时（连上了但不吐数据的上限）；"
                        "两个值都要远小于上游给本服务的整体超时，留出重试 / 降级的余量。"
                    ),
                    "flow": [
                        {"layer": "web", "step": "客户端建连超时",
                         "detail": "HttpClient 设 connectTimeout，握不上手最多等这么久。"},
                        {"layer": "web", "step": "请求读取超时",
                         "detail": "每次请求 builder 上设 timeout，连上但无响应最多等这么久。"},
                        {"layer": "reliability", "step": "超时即失败",
                         "detail": "超时抛异常，交由重试 / 熔断 / 降级逻辑处理，而不是线程挂死。"},
                    ],
                    "packages": [
                        "com.example.http   HttpClientConfig（连接 + 读取超时）",
                    ],
                    "files": [
                        {
                            "id": "timeout",
                            "path": "src/main/java/com/example/http/HttpClientConfig.java",
                            "layer": "web",
                            "lang": "java",
                            "role": "HTTP 客户端超时配置。",
                            "code": TIMEOUT_CFG,
                            "highlights": [
                                {"mark": ".connectTimeout(Duration.ofMillis(500))",
                                 "title": "建连超时",
                                 "text": "TCP 握手 / TLS 协商超过 500ms 即失败。没有它，下游端口不通时连接会长时间挂起。"},
                                {"mark": "return b.timeout(Duration.ofMillis(800)).build();",
                                 "title": "读取超时",
                                 "text": "连上了但迟迟不返回数据，超过 800ms 即失败。读取超时比建连超时更重要——很多「假死」都发生在已建连阶段。所有外部调用都必须设超时（REL-TIME-001）。",
                                 "rule": "REL-TIME-001"},
                            ],
                        },
                    ],
                    "checklist": [
                        "确认连接超时与读取超时都已设置，且都远小于上游给本服务的整体超时。",
                        "确认超时抛出的异常被上层（重试 / 熔断 / 降级）接住，而不是裸抛到用户。",
                        "确认超时被监控采集（超时数、超时 RT），能第一时间发现下游劣化。",
                        "确认框架级默认超时已被 review，没有「以为有、其实没有」的静默缺口。",
                    ],
                    "pitfalls": [
                        "只设了连接超时忘了读取超时：下游已建连但拖着不返回，线程照样挂死。",
                        "超时设得比上游还大：上游早已返回 504，本服务还在傻等，用户早就走了。",
                        "超时异常被空 catch 吞掉：既没重试也没告警，故障像没发生过（REL-EXCP-001 禁止）。",
                        "以为框架默认有超时：很多客户端默认无超时，必须显式设置才生效。",
                    ],
                    "relatedRules": ["REL-TIME-001", "REL-EXCP-001", "WEB-CTRL-006"],
                },
            ],
        },
    ],
}
