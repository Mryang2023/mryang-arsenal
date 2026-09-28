# -*- coding: utf-8 -*-
"""技术主题 · Web 层分层与统一出入参（Spring MVC）。

案例库三层结构的 Web 主线：

    L1 技术（本文件）      Controller 该做什么、统一出入参解决什么
    L2 场景                什么情况下要把逻辑下沉 / 要校验与统一响应（带可核对信号）
    L3 实现方案            瘦 Controller + Service + 全局异常 / @Valid + 统一响应体，
                          附模拟接口实测

「模拟接口测试」用 HttpServer 当假服务：一组端点演示「瘦 Controller 可单测 +
异常统一收敛」，另一组演示「入参校验拦截 vs 不校验直达业务」。都是真起 HttpServer
假下游，不靠 sleep 假装。
"""

RESULT = r"""package com.example.web.dto;

/**
 * 统一响应体：所有接口都返回它，禁止裸返回业务对象或裸抛异常。
 * 前端只认这一个结构，错误与成功走同一套字段。
 */
public class ApiResult<T> {
    private String code;   // "0" 表示成功，非 "0" 表示业务错误码
    private String message;
    private T data;

    public static <T> ApiResult<T> ok(T data) {
        ApiResult<T> r = new ApiResult<>();
        r.code = "0"; r.message = "ok"; r.data = data;
        return r;
    }
    public static ApiResult<Void> fail(String code, String message) {
        ApiResult<Void> r = new ApiResult<>();
        r.code = code; r.message = message;
        return r;
    }
    // getter / setter 省略
}
"""

SERVICE = r"""package com.example.web.service;

import com.example.web.dto.BusinessException;

/**
 * 订单业务服务：所有业务逻辑、校验、外部调用都在这层。
 * Controller 只负责把 HTTP 请求适配成方法调用、把结果包成 ApiResult。
 */
@org.springframework.stereotype.Service
public class OrderService {

    /** 业务摘要：纯内存计算，可脱离任何容器直接调用与单测。 */
    public String summarize(long orderId) {
        if (orderId <= 0) throw new BusinessException("PARAM_001", "订单号必须为正");
        return "order-" + orderId + " -> 2 items, total 199.00";
    }

    /** 会失败的业务：异常交给全局处理器收敛，Controller 内不 catch。 */
    public String deduct(long orderId) {
        throw new BusinessException("BIZ_001", "库存不足");
    }
}
"""

BUSINESS_EX = r"""package com.example.web.dto;

/** 业务异常：带错误码，由全局异常处理器统一转成 ApiResult.fail。 */
public class BusinessException extends RuntimeException {
    public final String code;
    public BusinessException(String code, String message) {
        super(message);
        this.code = code;
    }
}
"""

CONTROLLER = r"""package com.example.web.controller;

import com.example.web.dto.ApiResult;
import com.example.web.service.OrderService;
import org.springframework.web.bind.annotation.*;

/**
 * 瘦 Controller：只做 HTTP 适配（取参、调服务、包响应），
 * 不写业务逻辑、不直接访问数据源、不在方法内 try-catch 业务异常。
 */
@RestController
@RequestMapping("/orders")
public class OrderController {

    private final OrderService service;
    public OrderController(OrderService service) { this.service = service; }

    @GetMapping("/{id}")
    public ApiResult<String> get(@PathVariable long id) {
        // 异常不在这里 catch —— 交给 GlobalExceptionHandler 统一收敛
        return ApiResult.ok(service.summarize(id));
    }
}
"""

EX_HANDLER = r"""package com.example.web.advice;

import com.example.web.dto.ApiResult;
import com.example.web.dto.BusinessException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * 全局异常处理器：所有 Controller 抛出的异常在这里统一出口，
 * 变成 ApiResult.fail(...)，避免把堆栈或裸异常泄露给前端。
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ApiResult<Void>> onBiz(BusinessException e) {
        return ResponseEntity.ok(ApiResult.fail(e.code, e.getMessage()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResult<Void>> onOther(Exception e) {
        return ResponseEntity.ok(ApiResult.fail("SYS_001", "系统异常"));
    }
}
"""

REQUEST = r"""package com.example.web.dto;

import jakarta.validation.constraints.*;

/**
 * 入参 DTO：字段约束就写在对象上，由 @Valid 在入口统一校验，
 * 不把校验散落到业务方法里，也不靠手写 if。
 */
public class CreateUserRequest {
    @NotBlank(message = "姓名不能为空")
    private String name;

    @NotBlank(message = "邮箱不能为空")
    @Email(message = "邮箱格式非法")
    private String email;

    // getter / setter 省略
}
"""

USER_CONTROLLER = r"""package com.example.web.controller;

import com.example.web.dto.ApiResult;
import com.example.web.dto.CreateUserRequest;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

/**
 * 入参校验 + 统一响应：@Valid 让字段约束在入口生效，
 * 非法入参直接变成 422，根本进不了业务方法。
 */
@RestController
@RequestMapping("/users")
public class UserController {

    @PostMapping
    public ApiResult<String> create(@Valid @RequestBody CreateUserRequest req) {
        // req 到这里已经过 @Valid 校验；非法入参在到达本方法前就被拦下
        return ApiResult.ok("saved:" + req.getName());
    }
}
"""

# ── L3 模拟接口测试 ─────────────────────────────────────────────────
LAB_LAYER = r"""import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;

/** 业务服务：可脱离 HTTP 容器直接调用与单测（瘦 Controller 的核心收益）。 */
class OrderService {
    String summarize(long id) { return "order-" + id + " -> 2 items"; }
    String risky() { throw new RuntimeException("BIZ_001:库存不足"); }
}

public class Main {
    static OrderService svc = new OrderService();

    public static void main(String[] args) throws Exception {
        // ① 证明瘦 Controller 可单测：业务方法脱离 Server 直接调用并断言
        String direct = svc.summarize(1);
        System.out.println("[单测] service.summarize(1) = " + direct);

        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        // 瘦端点：只适配，逻辑委托 service
        server.createContext("/order", ex -> {
            long id = Long.parseLong(ex.getRequestURI().getQuery().split("=")[1]);
            respond(ex, 200, json("code", "0", "data", svc.summarize(id)));
        });
        // 统一出口：异常被「全局处理器」收敛为 {code,message}
        server.createContext("/boom", ex -> {
            try { svc.risky(); respond(ex, 200, "{}"); }
            catch (RuntimeException be) { respond(ex, 200, json("code", "BIZ_001", "message", be.getMessage())); }
        });
        // 无统一出口对照：异常直接冒泡，HttpServer 返回 500 + 堆栈
        server.createContext("/boom-raw", ex -> { svc.risky(); respond(ex, 200, "{}"); });
        server.start();
        String base = "http://127.0.0.1:" + server.getAddress().getPort();
        call(base + "/order?id=1");
        call(base + "/boom");
        call(base + "/boom-raw");
        server.stop(0);
        System.out.println("java.version=" + System.getProperty("java.version"));
    }
    static void respond(HttpExchange ex, int code, String body) throws IOException {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        ex.sendResponseHeaders(code, b.length); ex.getResponseBody().write(b); ex.close();
    }
    static String json(String... kv) {
        StringBuilder sb = new StringBuilder("{");
        for (int i = 0; i < kv.length; i += 2)
            sb.append(i > 0 ? "," : "").append('"').append(kv[i]).append("\":\"").append(kv[i + 1]).append('"');
        return sb.append("}").toString();
    }
    static void call(String url) throws Exception {
        var r = java.net.http.HttpClient.newHttpClient().send(
            java.net.http.HttpRequest.newBuilder(java.net.URI.create(url)).GET().build(),
            java.net.http.HttpResponse.BodyHandlers.ofString());
        System.out.println("[HTTP] " + url + " -> " + r.statusCode() + " " + r.body());
    }
}
"""

LAB_VALIDATE = r"""import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.Executors;

/** 用户 DTO + 手动校验（对应 @NotBlank / @Email 做的事）。 */
class User {
    String name, email;
    User(String n, String e) { name = n; email = e; }
    List<String> validate() {
        List<String> errs = new ArrayList<>();
        if (name == null || name.isBlank()) errs.add("name 不能为空");
        if (email == null || !email.contains("@")) errs.add("email 格式非法");
        return errs;
    }
}

public class Main {
    public static void main(String[] args) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        // 带校验端点
        server.createContext("/users", ex -> {
            Map<String,String> p = parse(ex.getRequestURI().getQuery());
            User u = new User(p.get("name"), p.get("email"));
            List<String> errs = u.validate();
            if (!errs.isEmpty()) { respond(ex, 422, json("code","VALID_001","message",String.join(";",errs))); return; }
            respond(ex, 200, json("code","0","data","saved:"+u.name));
        });
        // 无校验端点（坏写法对照）：非法数据也 200 直达业务
        server.createContext("/users-raw", ex -> {
            Map<String,String> p = parse(ex.getRequestURI().getQuery());
            User u = new User(p.get("name"), p.get("email"));
            respond(ex, 200, json("code","0","data","saved:"+u.name));
        });
        server.start();
        String base = "http://127.0.0.1:" + server.getAddress().getPort();
        call(base + "/users?name=&email=bad");
        call(base + "/users?name=alice&email=a@b.com");
        call(base + "/users-raw?name=&email=bad");
        server.stop(0);
        System.out.println("java.version=" + System.getProperty("java.version"));
    }
    static Map<String,String> parse(String q) {
        Map<String,String> m = new HashMap<>();
        if (q != null) for (String p : q.split("&")) { String[] kv = p.split("=",2); if (kv.length==2) m.put(kv[0], kv[1]); }
        return m;
    }
    static void respond(HttpExchange ex, int code, String body) throws IOException {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        ex.sendResponseHeaders(code, b.length); ex.getResponseBody().write(b); ex.close();
    }
    static String json(String... kv) {
        StringBuilder sb = new StringBuilder("{");
        for (int i = 0; i < kv.length; i += 2)
            sb.append(i > 0 ? "," : "").append('"').append(kv[i]).append("\":\"").append(kv[i + 1]).append('"');
        return sb.append("}").toString();
    }
    static void call(String url) throws Exception {
        var r = java.net.http.HttpClient.newHttpClient().send(
            java.net.http.HttpRequest.newBuilder(java.net.URI.create(url)).GET().build(),
            java.net.http.HttpResponse.BodyHandlers.ofString());
        System.out.println("[HTTP] " + url + " -> " + r.statusCode() + " " + r.body());
    }
}
"""


TOPIC = {
    "id": "web-layer",
    "order": 5,
    "name": "Web 层分层与统一出入参",
    "subtitle": "Controller 只做适配，业务下沉 Service，出入参统一收敛",
    "glyph": "☰",
    "family": "web",
    "runtime": "Spring MVC",
    "level": "基础",
    "intent": (
        "Web 层分层解决的是「HTTP 适配」与「业务逻辑」混在一起导致的两件事："
        "一是 Controller 越来越胖、无法单测，二是错误与响应格式各写各的、前端对接成本爆炸。"
        "把逻辑下沉到 Service、用统一响应体与全局异常收敛出入参，Controller 就只剩适配。"
    ),
    "pickWhen": [
        {"vs": "在 Controller 里直接写业务逻辑",
         "text": "任何需要单测、需要复用、或会被多个端点共享的逻辑 → 下沉 Service；只有取参/调服/包响应才留 Controller"},
        {"vs": "每个接口自己定义返回结构",
         "text": "前端要对接 N 种结构 → 统一 ApiResult；只有纯文件流 / SSE 等少数场景才绕过统一响应"},
        {"vs": "在 Controller 里 try-catch 业务异常",
         "text": "异常该被统一处理 → 交给 @ControllerAdvice；Controller 内 catch 只会让错误格式再次发散"},
    ],
    "limits": [
        "统一响应体不是银弹：文件下载、SSE、重定向等少数场景需要绕过它。",
        "Service 也不是必须拆接口/实现：只在多实现或需要代理时才分（见 SVC-LAYR-003）。",
        "全局异常处理器只收敛「异常出口」，业务内的正常校验失败仍应走 ApiResult.fail 显式返回。",
        "分层解决的是可维护与可测试，不解决性能——别指望分层能提速。",
    ],
    "references": [
        {"title": "Spring · @ControllerAdvice 官方文档",
         "url": "https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/bind/annotation/ControllerAdvice.html",
         "note": "全局异常处理器的标准用法"},
        {"title": "Spring · @Valid / @Validated 校验",
         "url": "https://docs.spring.io/spring-framework/reference/core/validation/beans-beans.html",
         "note": "在 @RequestBody 上触发 Bean Validation 的入口"},
        {"title": "军火库规则集 · WEB 类",
         "note": "Controller 职责、@Valid、统一响应体、全局异常处理的强制级条目出处"},
    ],
    "scenarios": [
        {
            "id": "thin-controller",
            "order": 1,
            "name": "Controller 只做适配，业务下沉 Service",
            "when": (
                "Controller 方法里开始出现业务判断、数据库访问、或调用多个下游后再拼装——"
                "这些方法无法脱离 HTTP 容器单测，且同一段逻辑在多个端点间复制。"
            ),
            "signals": [
                "Controller 单方法超过几十行，且包含 if/else 业务分支",
                "业务逻辑只能在起了 Web 容器后才能跑测试",
                "同样的计算在多个 Controller 里各写一遍",
            ],
            "decision": "把业务逻辑、校验、外部调用全部下沉到 Service；Controller 只取参、调服务、包 ApiResult。异常一律抛出，交给全局处理器。",
            "notSuitable": [
                "端点仅做字段透传、无业务逻辑——薄薄一层直接返回即可，不必硬拆 Service",
                "纯静态资源 / 健康检查——不需要分层",
                "一次性脚本式接口，生命周期极短",
            ],
            "recipes": [
                {
                    "id": "layered",
                    "order": 1,
                    "name": "瘦 Controller + Service + 全局异常处理器",
                    "approach": (
                        "Controller 只做 HTTP 适配，业务逻辑收进 Service；"
                        "业务异常直接抛出，由 @ControllerAdvice 统一收敛成 ApiResult.fail，"
                        "Controller 内不写 try-catch。"
                    ),
                    "flow": [
                        {"layer": "web", "step": "接收请求", "detail": "Controller 取路径/查询/体参数，不做业务判断。"},
                        {"layer": "service", "step": "执行逻辑", "detail": "Service 完成校验、计算、外部调用，异常直接抛。"},
                        {"layer": "web", "step": "包统一响应", "detail": "Controller 把 Service 结果包成 ApiResult.ok 返回。"},
                        {"layer": "web", "step": "异常统一收敛", "detail": "@ControllerAdvice 捕获所有未处理异常，转成 ApiResult.fail，不泄露堆栈。"},
                    ],
                    "packages": [
                        "com.example.web.controller  瘦 Controller（取参 / 调服务 / 包响应）",
                        "com.example.web.service     业务逻辑（可脱离容器单测）",
                        "com.example.web.advice      全局异常处理器（统一出口）",
                    ],
                    "files": [
                        {
                            "id": "service",
                            "path": "src/main/java/com/example/web/service/OrderService.java",
                            "layer": "service", "lang": "java",
                            "role": "业务逻辑：可脱离容器单测，不依赖 HTTP。",
                            "code": SERVICE,
                            "highlights": [
                                {"mark": "public String summarize(long orderId) {",
                                 "title": "逻辑在 Service，不依赖容器",
                                 "text": "订单摘要只是内存计算，但因为它在 Service 里，可以脱离 Tomcat 直接 new OrderService().summarize(1) 做单测——这是分层最直接的收益。",
                                 "rule": "WEB-CTRL-001"},
                                {"mark": "throw new BusinessException(\"BIZ_001\", \"库存不足\");",
                                 "title": "异常直接抛，不自己吞",
                                 "text": "业务错误抛出去交给全局处理器，Controller 不必也绝不该在每个方法里写 try-catch；否则错误格式会再次发散。"},
                            ],
                        },
                        {
                            "id": "controller",
                            "path": "src/main/java/com/example/web/controller/OrderController.java",
                            "layer": "web", "lang": "java",
                            "role": "瘦 Controller：取参 → 调服务 → 包 ApiResult。",
                            "code": CONTROLLER,
                            "highlights": [
                                {"mark": "return ApiResult.ok(service.summarize(id));",
                                 "title": "只适配，不承载逻辑",
                                 "text": "Controller 方法体只有「取参 + 调服务 + 包响应」三件事，没有任何业务分支——这正是 WEB-CTRL-001 要求的职责边界。"},
                                {"mark": "// 异常不在这里 catch —— 交给 GlobalExceptionHandler 统一收敛",
                                 "title": "不在 Controller 内 try-catch 业务异常",
                                 "text": "业务异常直接冒泡到 @ControllerAdvice，由它统一转成 ApiResult.fail。Controller 内 catch 既重复又让错误格式发散（WEB-CTRL-004）。",
                                 "rule": "WEB-CTRL-004"},
                            ],
                        },
                        {
                            "id": "handler",
                            "path": "src/main/java/com/example/web/advice/GlobalExceptionHandler.java",
                            "layer": "web", "lang": "java",
                            "role": "全局异常处理器：所有未处理异常统一收敛。",
                            "code": EX_HANDLER,
                            "highlights": [
                                {"mark": "@RestControllerAdvice",
                                 "title": "统一出口，一处收敛",
                                 "text": "所有 Controller 的异常都从这里过，返回结构永远是 ApiResult，前端只需对接一种格式。"},
                                {"mark": "return ResponseEntity.ok(ApiResult.fail(e.code, e.getMessage()));",
                                 "title": "异常变统一响应，不泄露堆栈",
                                 "text": "业务异常被转成 {code,message} 返回，堆栈不进响应体——既统一又安全（WEB-CTRL-004 / 顺带满足 SEC-OUTPUT-001 的不泄露）。",
                                 "rule": "WEB-CTRL-004"},
                            ],
                        },
                    ],
                    "checklist": [
                        "确认 Controller 方法里没有业务分支、没有数据库访问、没有 try-catch 业务异常。",
                        "确认 Service 的方法可以不启动容器就被 JUnit 直接调用。",
                        "确认 @ControllerAdvice 覆盖了业务异常与兜底异常，且返回结构都是 ApiResult。",
                        "确认异常响应不携带堆栈 / 内部路径等敏感信息。",
                    ],
                    "pitfalls": [
                        "把业务判断写进 Controller：逻辑无法单测，且同一段会在多个端点复制。",
                        "在 Controller 里 try-catch 业务异常：错误格式再次发散，全局处理器形同虚设。",
                        "每个接口自定义返回结构：前端对接成本爆炸，也失去统一错误码。",
                        "全局处理器吞掉异常只返 null：故障像没发生过，排查无门。",
                    ],
                    "performance": {
                        "title": "分层对可测试性的影响（同段逻辑两种写法）",
                        "columns": ["维度", "胖 Controller（逻辑内联）", "瘦 Controller + Service"],
                        "rows": [
                            ["单测是否需要容器", "是（必须起 HTTP / MockMvc）", "否（直接调用 Service 方法）"],
                            ["逻辑复用", "需复制", "Service 一处，多处调用"],
                            ["出错时格式", "各端点自己定", "全局统一 ApiResult"],
                            ["代价", "无", "多一层方法调用（可忽略）"],
                        ],
                        "conclusion": "分层换来的不是性能，是「业务逻辑可单测、错误格式统一」。页面下方实验能在你机器上把「瘦 Controller 可单测 + 异常统一收敛」与「无统一出口泄漏堆栈」两组行为跑出来。",
                    },
                    "relatedRules": ["WEB-CTRL-001", "WEB-CTRL-004"],
                    "lab": {
                        "kind": "mock-endpoint",
                        "intro": "起一个假服务：/order 演示瘦 Controller 委托 Service（业务方法可脱离 Server 直接调用）；/boom 与 /boom-raw 对比「统一出口收敛」与「异常泄漏为 500+堆栈」。",
                        "observe": [
                            "业务方法 svc.summarize(1) 可在无 Server 的 main 里直接调用并断言（瘦 Controller 可单测）",
                            "/boom 经统一出口返回 {code,message}（HTTP 200）；/boom-raw 无统一出口，HttpServer 返回 500 且响应体含堆栈文本",
                        ],
                    },
                    "playground": [
                        {"id": "wl-layer",
                         "label": "瘦 Controller 可单测 + 异常统一收敛",
                         "mainClass": "Main",
                         "note": "/order 演示业务方法脱离 Server 直接调用；/boom vs /boom-raw 对比统一出口与异常泄漏。",
                         "files": [{"path": "Main.java", "code": LAB_LAYER}]},
                    ],
                },
            ],
        },
        {
            "id": "validate-and-unify",
            "order": 2,
            "name": "入参校验与统一响应体",
            "when": (
                "接口接收外部传入的字段（表单、JSON body、查询参数），且这些字段可能被填成空值、"
                "错误格式或越界值——若不校验就进业务，脏数据会直达数据库或下游。"
            ),
            "signals": [
                "业务方法开头出现一长串 if (xxx == null) 手写校验",
                "非法入参有时进库、有时报 NPE，行为不一致",
                "前端拿到过 200 但业务实际失败，或拿到裸异常堆栈",
            ],
            "decision": "用 @Valid + DTO 字段约束在入口统一校验，非法即 422；所有成功与失败都走 ApiResult 统一结构，不让响应体形态发散。",
            "notSuitable": [
                "内部服务间已信任的调用——可省略部分校验，但跨信任边界仍要校",
                "纯查询转发、无字段语义——无需约束",
                "文件上传等二进制场景——走专用校验而非 Bean Validation",
            ],
            "recipes": [
                {
                    "id": "valid-unified",
                    "order": 1,
                    "name": "@Valid 入口校验 + ApiResult 统一响应",
                    "approach": (
                        "把字段约束写在 DTO 上（@NotBlank / @Email 等），"
                        "Controller 用 @Valid 在入口触发校验；非法入参被框架直接转成 422，"
                        "所有正常返回都包成 ApiResult。"
                    ),
                    "flow": [
                        {"layer": "web", "step": "声明约束", "detail": "DTO 字段上写 @NotBlank / @Email，约束随对象走。"},
                        {"layer": "web", "step": "入口触发校验", "detail": "@Valid @RequestBody 让框架在绑参时校验，非法即 422。"},
                        {"layer": "web", "step": "统一返回", "detail": "合法时包 ApiResult.ok，框架校验失败也归一到 ApiResult.fail 结构。"},
                    ],
                    "packages": [
                        "com.example.web.dto       CreateUserRequest（字段约束）+ ApiResult（统一响应）",
                        "com.example.web.controller UserController（@Valid 入口）",
                    ],
                    "files": [
                        {
                            "id": "dto",
                            "path": "src/main/java/com/example/web/dto/CreateUserRequest.java",
                            "layer": "web", "lang": "java",
                            "role": "入参 DTO：字段约束随对象声明。",
                            "code": REQUEST,
                            "highlights": [
                                {"mark": "@NotBlank(message = \"姓名不能为空\")",
                                 "title": "约束写在 DTO 上",
                                 "text": "校验规则贴近数据，不散落在业务方法里，也更不容易被「顺手跳过」。@Valid 在入口统一触发（WEB-CTRL-002）。",
                                 "rule": "WEB-CTRL-002"},
                                {"mark": "@Email(message = \"邮箱格式非法\")",
                                 "title": "格式约束可声明式表达",
                                 "text": "邮箱、长度、范围等用标准约束注解即可，无需手写正则 if；新增字段时补注解而不是补一段校验代码。"},
                            ],
                        },
                        {
                            "id": "controller",
                            "path": "src/main/java/com/example/web/controller/UserController.java",
                            "layer": "web", "lang": "java",
                            "role": "入口校验 + 统一响应。",
                            "code": USER_CONTROLLER,
                            "highlights": [
                                {"mark": "public ApiResult<String> create(@Valid @RequestBody CreateUserRequest req) {",
                                 "title": "@Valid 在入口拦非法入参",
                                 "text": "框架在校验失败时直接返回 422，方法体根本不会执行——脏数据到不了业务层（WEB-CTRL-002）。",
                                 "rule": "WEB-CTRL-002"},
                                {"mark": "return ApiResult.ok(\"saved:\" + req.getName());",
                                 "title": "统一响应体",
                                 "text": "所有成功都包成 ApiResult，前端只认这一个结构，错误与成功走同一套字段（WEB-CTRL-003）。",
                                 "rule": "WEB-CTRL-003"},
                            ],
                        },
                    ],
                    "checklist": [
                        "确认所有对外入参都有 DTO，且约束注解写在字段上而非业务方法里。",
                        "确认 Controller 用 @Valid（@RequestBody / @ModelAttribute）触发校验。",
                        "确认校验失败被收敛为统一 ApiResult 错误结构，而不是裸 400/500。",
                        "确认没有在业务方法开头手写一长串 if 校验（那说明约束没落在 DTO 上）。",
                    ],
                    "pitfalls": [
                        "只在业务方法里手写 if 校验：约束易漏、易重复，且绕过入口的请求（内部调用）会逃脱。",
                        "DTO 不带约束、直接收 Map<String,Object>：等于放弃声明式校验，全靠人记。",
                        "校验失败返回裸异常堆栈：前端拿到 500+堆栈，既丑又不安全。",
                        "用 String 接一切参数再自己解析：类型与格式错误推迟到业务里才爆。",
                    ],
                    "relatedRules": ["WEB-CTRL-002", "WEB-CTRL-003"],
                    "lab": {
                        "kind": "mock-endpoint",
                        "intro": "起一个假服务：/users 带入口校验（非法入参 422 + 统一错误体），/users-raw 不校验（非法也 200 直达业务），对比两者。",
                        "observe": [
                            "/users 非法入参（name 空、email 非法）→ 422 + {code,message} 统一错误体，不进业务",
                            "/users-raw（无校验）非法入参也返回 200，脏数据直达业务逻辑",
                        ],
                    },
                    "playground": [
                        {"id": "wl-validate",
                         "label": "入参校验拦截 vs 不校验直达业务",
                         "mainClass": "Main",
                         "note": "/users 带校验（非法 422），/users-raw 不校验（非法也 200），对比响应。",
                         "files": [{"path": "Main.java", "code": LAB_VALIDATE}]},
                    ],
                },
            ],
        },
    ],
}
