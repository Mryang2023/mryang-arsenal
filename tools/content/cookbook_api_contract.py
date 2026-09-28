# -*- coding: utf-8 -*-
"""技术主题 · 接口契约层（DTO / 校验 / 统一响应 / 异常出口）。

案例库第二条主线（A 型规格，第一条由虚拟线程担任）。
本主线吃掉 web 类 6 条强制级规则（这是选题的唯一依据，见《案例库扩容计划》§2.1）：

    WEB-CTRL-001  Controller 只做 HTTP 适配，禁止承载业务逻辑或直接访问数据源
    WEB-CTRL-002  @RequestBody 入参必须加 @Valid，且 DTO 字段必须带约束注解
    WEB-CTRL-003  所有接口必须返回统一响应体，禁止裸返回任意对象
    WEB-CTRL-004  必须由全局异常处理器统一出口，Controller 内禁止 try-catch 业务异常
    WEB-CTRL-005  分页查询必须限制单页最大条数，禁止接受无上限的 pageSize
    WEB-DTO-001   接口入参与出参必须使用专用 DTO，禁止收发 Map 或直接序列化实体

三层结构：

    S1 request-validation   入参校验收口：DTO + @Valid + 字段约束（吃 001 / 002 / DTO-001）
    S2 unified-response     统一出口：ApiResponse + 全局异常处理器（吃 003 / 004）
    S3 pagination-limit     分页与批量上限：PageQuery 夹逼 + 游标（吃 005）

⚠ 硬约定（C-2 案例代码自证）：files[].code 只放 good 版 —— bad 示例一律写进
pitfalls 或规则自身的 bad/good 对照；本文件的每一段 Java 都要能过自己的规则引擎
（含正则层全部 35 条可执行规则），并把 6 条规则的 rationale 真正落到代码与备注里。
"""

DTO_REQUEST = r"""package com.example.contract.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 创建用户的入参契约。
 *
 * 这一个类同时回答三个问题（WEB-DTO-001 / WEB-CTRL-002）：
 *   · 形状  —— 专用 Request DTO，字段显式声明，不收 Map、不收数据库实体；
 *   · 合法性 —— 每个字段都带约束注解，没有「裸字段」；
 *   · 话术  —— message 直接写面向用户的中文，全局处理器会把它原样拼进 400 响应。
 *
 * 注意包名是 jakarta.validation：Spring Boot 3 起是 jakarta 命名空间，
 * 写成 javax.validation 时注解类根本不在 classpath 上，等于没写校验。
 */
public class UserCreateRequest {

    @NotBlank(message = "用户名不能为空")
    @Size(max = 32, message = "用户名不能超过 32 个字符")
    private String username;

    @NotBlank(message = "邮箱不能为空")
    @Email(message = "邮箱格式不正确")
    private String email;

    @Size(min = 6, max = 64, message = "密码长度须在 6~64 位之间")
    private String password;

    @Pattern(regexp = "^1[3-9]\\d{9}$", message = "手机号格式不正确")
    private String mobile;

    public String getUsername() { return username; }
    public void setUsername(String username) { this.username = username; }

    public String getEmail() { return email; }
    public void setEmail(String email) { this.email = email; }

    public String getPassword() { return password; }
    public void setPassword(String password) { this.password = password; }

    public String getMobile() { return mobile; }
    public void setMobile(String mobile) { this.mobile = mobile; }
}
"""

CONTROLLER_CREATE = r"""package com.example.contract.controller;

import com.example.contract.common.ApiResponse;
import com.example.contract.dto.UserCreateRequest;
import com.example.contract.service.UserService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 用户写接口：Controller 只做 HTTP 适配（WEB-CTRL-001）。
 *
 * 方法体里只有四件事：参数绑定、触发校验（@Valid）、调用一个 Service、包装响应。
 * 没有业务分支、没有循环、没有数据访问、没有 try-catch ——
 * 校验失败与业务失败都交给全局异常处理器（见 unified-response 场景）。
 */
@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserService userService;

    /** 构造器注入：字段不变 final，单测可以直接 new，不需要容器。 */
    public UserController(UserService userService) {
        this.userService = userService;
    }

    /**
     * 创建用户。
     * @Valid 与 @RequestBody 同驻一个参数：漏掉 @Valid 时 DTO 上的所有约束注解
     * 会同时静默失效——不报错、不告警，非法数据直达业务层（WEB-CTRL-002 的全部理由）。
     */
    @PostMapping
    public ApiResponse<Long> create(@Valid @RequestBody UserCreateRequest req) {
        return ApiResponse.ok(userService.create(req));
    }
}
"""

API_RESPONSE = r"""package com.example.contract.common;

/**
 * 统一响应体（WEB-CTRL-003）：全项目所有接口唯一的出参结构。
 *
 * code 只有两种语义：「0」成功、非 0 失败；失败时 data 恒为 null。
 * 前端因此只需要写一种解析：先看 code，再取 data——
 * 没有统一响应体时，「空结果」和「失败」长得一样，每个接口都要单独约定。
 *
 * 构造器私有 + 静态工厂：成功的结构只能经 ok() 造出，失败的只能经 fail() 造出，
 * 响应的形状在源头被收口，而不是每个接口各拼一个 Map。
 */
public class ApiResponse<T> {

    private final String code;
    private final String message;
    private final T data;

    private ApiResponse(String code, String message, T data) {
        this.code = code;
        this.message = message;
        this.data = data;
    }

    /** 成功：code 恒为「0」，业务数据放 data。 */
    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>("0", "ok", data);
    }

    /** 失败：code 来自业务异常的唯一来源，data 恒为 null。 */
    public static <T> ApiResponse<T> fail(String code, String message) {
        return new ApiResponse<>(code, message, null);
    }

    public String getCode() { return code; }
    public String getMessage() { return message; }
    public T getData() { return data; }
}
"""

USER_VO = r"""package com.example.contract.dto;

/**
 * 用户出参视图（WEB-DTO-001 的另一半）：出参也必须是专用 VO，不许直接序列化实体。
 *
 * 数据库实体 UserPO 里的 passwordHash、internalFlag、tenantId 永远不该出现在 API 上；
 * 用 VO 显式列出对外可见的字段，数据库加字段、实体改结构，接口契约纹丝不动。
 */
public record UserVO(Long id, String username, String email) {
}
"""

BIZ_EXCEPTION = r"""package com.example.contract.exception;

/**
 * 业务异常（WEB-CTRL-004 的另一半）：业务失败在代码里的唯一表达方式。
 *
 * 只表达「业务规则不满足」（余额不足、用户不存在），不代表系统故障；
 * 错误码随异常走，响应体里的 code 从此只有这一个来源，不再有各处硬编码。
 * 继承 RuntimeException：调用方不被迫层层声明 throws，异常一路抛到全局出口。
 */
public class BizException extends RuntimeException {

    private final String code;

    public BizException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() { return code; }
}
"""

GLOBAL_HANDLER = r"""package com.example.contract.exception;

import com.example.contract.common.ApiResponse;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 全局异常处理器（WEB-CTRL-004）：异常到响应体的映射，全项目只有这一份。
 *
 * Controller 里因此禁止 try-catch 业务异常——每个 Controller 各写各的 catch，
 * 同类异常在不同接口返回不同结构，N 个 Controller 就是 N 处遗漏点；
 * 收口到一个 @RestControllerAdvice 后，映射只写一次，漏不掉也改不散。
 *
 * 三条路都汇进 ApiResponse：
 *   · BizException                  —— 业务失败，code/message 原样透出；
 *   · MethodArgumentNotValidException —— @Valid 校验失败，400 + 逐字段中文提示；
 *   · 其余一切                      —— 500 固定话术，现场只进日志。
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /** 业务异常：调用方按 code 做分支，message 直接面向用户。 */
    @ExceptionHandler(BizException.class)
    public ApiResponse<Void> handleBiz(BizException e) {
        return ApiResponse.fail(e.getCode(), e.getMessage());
    }

    /** @Valid 校验失败：提示语逐字段拼出来，全部来自 DTO 注解上的中文 message。 */
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ApiResponse<Void> handleValid(MethodArgumentNotValidException e) {
        String detail = e.getBindingResult().getFieldErrors().stream()
                .map(f -> f.getField() + " " + f.getDefaultMessage())
                .collect(Collectors.joining("; "));
        return ApiResponse.fail("A0400", detail);
    }

    /** 兜底：未预期异常不回细节给调用方，完整堆栈留在日志里排障。 */
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    @ExceptionHandler(Exception.class)
    public ApiResponse<Void> handleUnexpected(Exception e) {
        log.error("未预期异常", e);
        return ApiResponse.fail("A0500", "系统繁忙，请稍后重试");
    }
}
"""

PAGE_QUERY = r"""package com.example.contract.common;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/**
 * 分页参数基类（WEB-CTRL-005）：上限必须长在契约对象上，而不是等每个接口自己想起来。
 *
 * 上限同时存在于两处，缺一不可：
 *   · @Max(200)      —— 走 Bean Validation 的入口（@Valid / @Validated）在入口就拒绝越界请求；
 *   · safeSize() 夹逼 —— 兜住绕过注解的调用：内部方法直接传参、或某处漏了 @Valid。
 * WEB-CTRL-002 的教训在这里同样成立：注解只在被校验时生效，夹逼是注解的保险丝。
 *
 * pageSize 不设上限等价于提供一个「一次拉全表」的公开接口，
 * 这是存储层之外最廉价的拒绝服务方式。
 */
public abstract class PageQuery {

    /** 单页条数硬上限，全项目同一个数。 */
    public static final int MAX_SIZE = 200;

    @Min(value = 1, message = "页码从 1 开始")
    private int page = 1;

    @Min(value = 1, message = "单页至少 1 条")
    @Max(value = MAX_SIZE, message = "单页最多 200 条")
    private int size = 10;

    /** 服务端兜底夹逼：无论参数怎么进来，size 都落在 [1, MAX_SIZE]。 */
    public int safeSize() {
        return Math.min(Math.max(size, 1), MAX_SIZE);
    }

    /** 页码兜底：page=0 / 负数一律当第 1 页。 */
    public int safePage() {
        return Math.max(page, 1);
    }

    public int getPage() { return page; }
    public void setPage(int page) { this.page = page; }

    public int getSize() { return size; }
    public void setSize(int size) { this.size = size; }
}
"""

USER_QUERY_REQUEST = r"""package com.example.contract.dto;

import com.example.contract.common.PageQuery;

/**
 * 用户列表查询的入参契约（WEB-DTO-001）：查询条件 + 分页字段收进同一个专用 DTO。
 * 禁止用一排散装 @RequestParam，更禁止用 Map 接收——那样契约不存在，
 * 改一个字段名不会有任何东西报错。
 */
public class UserQueryRequest extends PageQuery {

    /** 关键字：模糊匹配用户名 / 邮箱，可为空。 */
    private String keyword;

    /** 排序字段：必须是服务端白名单里的值，请求传什么不算数。 */
    private String sort;

    /** 游标翻页参数：上一页返回的 nextCursor，首页不传。 */
    private Long lastId;

    public String getKeyword() { return keyword; }
    public void setKeyword(String keyword) { this.keyword = keyword; }

    public String getSort() { return sort; }
    public void setSort(String sort) { this.sort = sort; }

    public Long getLastId() { return lastId; }
    public void setLastId(Long lastId) { this.lastId = lastId; }
}
"""

PAGE_RESULT = r"""package com.example.contract.common;

import java.util.List;

/**
 * 统一分页出参（WEB-DTO-001 / WEB-CTRL-003）：列表接口唯一的返回包装。
 *
 * hasNext 由服务端算好——让前端「数 records.size() 判断还有没有下一页」，
 * 恰好整页时会多打一次空查询；
 * 游标模式下不携带 total：深翻页每次都 count 一遍全表，是慢查询的常见来源，
 * 要总数就等调用方明确要，别在每一页里都顺带算一遍。
 */
public class PageResult<T> {

    private final List<T> records;
    private final boolean hasNext;
    /** 下一页游标（本页最后一条的定位值），hasNext=false 时为 null。 */
    private final Long nextCursor;

    private PageResult(List<T> records, boolean hasNext, Long nextCursor) {
        this.records = records;
        this.hasNext = hasNext;
        this.nextCursor = nextCursor;
    }

    public static <T> PageResult<T> of(List<T> records, boolean hasNext, Long nextCursor) {
        return new PageResult<>(records, hasNext, nextCursor);
    }

    public List<T> getRecords() { return records; }
    public boolean isHasNext() { return hasNext; }
    public Long getNextCursor() { return nextCursor; }
}
"""

USER_QUERY_SERVICE = r"""package com.example.contract.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.example.contract.common.PageResult;
import com.example.contract.dto.UserQueryRequest;
import com.example.contract.dto.UserVO;
import com.example.contract.exception.BizException;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;

/**
 * 用户查询服务：分页上限与游标翻页在服务端的落点（WEB-CTRL-005）。
 *
 * Controller 收下 UserQueryRequest 后调到这里，查询从此只有这一份写法：
 *   · size 一律经 safeSize() 夹逼——服务端兜底，不信任何一方的自觉；
 *   · offset 深翻页直接拒绝并引导游标：LIMIT offset 越往后扫过并丢弃的行越多；
 *   · 排序字段走白名单，请求里传来的任何排序字符串都不直达存储层。
 */
@Service
public class UserQueryService {

    /** offset 深翻页阈值：超过就引导改用游标，而不是放行一个注定变慢的查询。 */
    private static final long MAX_OFFSET_ROWS = 50_000;

    /** 排序白名单：枚举全集，新增排序字段在这里加，而不是接受任意字符串。 */
    private static final Set<String> SORTABLE = Set.of("id", "createdAt");

    private final UserMapper userMapper;

    public UserQueryService(UserMapper userMapper) {
        this.userMapper = userMapper;
    }

    /** 常规分页：出参统一 PageResult，total 不随每页顺带计算。 */
    public PageResult<UserVO> page(UserQueryRequest req) {
        checkSort(req);
        int size = req.safeSize();
        long offset = (long) (req.safePage() - 1) * size;
        if (offset > MAX_OFFSET_ROWS) {
            throw new BizException("A0400", "翻页过深，请改用游标参数 lastId 翻页");
        }
        Page<UserPO> result = userMapper.selectPage(
                new Page<>(req.safePage(), size, false), baseQuery(req));
        List<UserVO> items = toViews(result.getRecords());
        return PageResult.of(items, items.size() == size, null);
    }

    /** 游标翻页：where id < lastId order by id desc limit size，扫描行数恒为一页。 */
    public PageResult<UserVO> cursor(UserQueryRequest req) {
        checkSort(req);
        int size = req.safeSize();
        LambdaQueryWrapper<UserPO> q = baseQuery(req)
                .lt(req.getLastId() != null, UserPO::getId, req.getLastId());
        Page<UserPO> result = userMapper.selectPage(new Page<>(1, size, false), q);
        List<UserVO> items = toViews(result.getRecords());
        boolean hasNext = items.size() == size;
        Long nextCursor = hasNext ? items.get(items.size() - 1).getId() : null;
        return PageResult.of(items, hasNext, nextCursor);
    }

    private LambdaQueryWrapper<UserPO> baseQuery(UserQueryRequest req) {
        return Wrappers.<UserPO>lambdaQuery()
                // 显式列出对外字段；实体里的 passwordHash 等敏感列根本不进查询
                .select(UserPO::getId, UserPO::getUsername, UserPO::getEmail)
                .orderByDesc(UserPO::getId);
    }

    private void checkSort(UserQueryRequest req) {
        if (req.getSort() != null && !SORTABLE.contains(req.getSort())) {
            throw new BizException("A0400", "不支持的排序字段：" + req.getSort());
        }
    }

    private List<UserVO> toViews(List<UserPO> rows) {
        return rows.stream()
                .map(u -> new UserVO(u.getId(), u.getUsername(), u.getEmail()))
                .toList();
    }
}
"""

# ── L3 模拟接口测试 ─────────────────────────────────────────────────
# 与虚拟线程主线同一套约定：JDK 内置 HttpServer 在 127.0.0.1:0 起假 Controller，
# HttpClient 真发请求；端口内核分配、跑完 stop(0)，不联网、不写盘。
# playground 是纯 JDK 版（后端案例执行服务无 classpath，见 N-8）；
# files[] 是 Spring 版。两者差异仅为框架写法，语义一致 —— 已写进各 demo 的 note。

LAB_VALID = r"""import com.sun.net.httpserver.HttpServer;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * 契约校验对比：同一个假 Controller 的两种写法。
 *   legacy 版 —— 不校验，body 里是什么就往下传，脏数据静默入库；
 *   contract 版 —— 与 @NotBlank / @Size / @Email 同义的逐字段判定，失败立刻 400。
 * 两段输出对同一份非法 body 的反应，就是「有契约」与「没契约」的全部差别。
 */
public class Main {

    record Row(String username, String email) {}

    static final List<Row> TABLE = new ArrayList<>();

    public static void main(String[] args) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/users", ex -> {
            String json = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            String username = field(json, "username");
            String email = field(json, "email");

            if (ex.getRequestURI().getPath().endsWith("/legacy")) {
                TABLE.add(new Row(username, email));
                respond(ex, 200, "{\"ok\":true}");
                System.out.println("[legacy]   200 入库成功 username='" + username + "'（空也照收）");
                return;
            }
            List<String> errors = new ArrayList<>();
            if (username == null || username.isBlank()) errors.add("username 用户名不能为空");
            if (username != null && username.length() > 32) errors.add("username 用户名不能超过 32 个字符");
            if (email == null || email.isBlank()) errors.add("email 邮箱不能为空");
            else if (!email.contains("@") || email.startsWith("@") || email.endsWith("@")) {
                errors.add("email 邮箱格式不正确");
            }
            if (!errors.isEmpty()) {
                respond(ex, 400, "{\"code\":\"A0400\",\"message\":\"" + String.join("; ", errors) + "\"}");
                System.out.println("[contract] 400 拒绝：" + errors);
                return;
            }
            TABLE.add(new Row(username, email));
            respond(ex, 200, "{\"code\":\"0\",\"message\":\"ok\"}");
            System.out.println("[contract] 200 入库成功 username='" + username + "'");
        });
        server.start();
        String base = "http://127.0.0.1:" + server.getAddress().getPort() + "/users";
        HttpClient client = HttpClient.newHttpClient();

        post(client, base + "/legacy", "{\"username\":\"\",\"email\":\"not-an-email\"}");
        post(client, base, "{\"username\":\"\",\"email\":\"not-an-email\"}");
        post(client, base, "{\"username\":\"yang\",\"email\":\"yang@example.com\"}");
        server.stop(0);
        System.out.println("java.version=" + System.getProperty("java.version"));
    }

    static void post(HttpClient client, String url, String body) throws Exception {
        client.send(HttpRequest.newBuilder(URI.create(url))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(body)).build(),
            HttpResponse.BodyHandlers.discarding());
    }

    /** 极简字段提取，只为本实验服务（演示语义，不是 JSON 解析范式）。 */
    static String field(String json, String key) {
        int k = json.indexOf("\"" + key + "\":");
        if (k < 0) return null;
        int s = json.indexOf('"', k + key.length() + 3);
        int e = s < 0 ? -1 : json.indexOf('"', s + 1);
        return (s < 0 || e < 0) ? null : json.substring(s + 1, e);
    }

    static void respond(com.sun.net.httpserver.HttpExchange ex, int code, String body) throws Exception {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        ex.sendResponseHeaders(code, bytes.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(bytes);
        }
    }
}
"""

LAB_ADVICE = r"""import com.sun.net.httpserver.HttpServer;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;

/**
 * 统一出口对比：同一个「查无此用户」的失败，三种出口长什么样。
 *   old-a —— 失败返回 {"error": ...}，HTTP 404；
 *   old-b —— Controller 各自 catch，吞成另一种结构 {"msg": ...}，HTTP 500；
 *   api   —— 全局唯一出口：无论成功失败都是 {code, message, data} 一种结构。
 * 调用方要解析的结构从三种变成一种，这就是 @RestControllerAdvice 的全部价值。
 */
public class Main {

    /** 对应 Spring 版的 BizException：业务失败在代码里的唯一表达。 */
    static class BizException extends RuntimeException {
        final String code;
        BizException(String code, String message) { super(message); this.code = code; }
    }

    public static void main(String[] args) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/old-a", ex -> {
            respond(ex, 404, "{\"error\":\"user not found\"}");
            System.out.println("[old-a] 404 {\"error\":\"user not found\"}");
        });
        server.createContext("/old-b", ex -> {
            try {
                find(42L);
                respond(ex, 200, "{\"data\":{}}");
            } catch (Exception e) {
                // 旧写法：各接口自 catch，同一类失败长成另一种结构
                respond(ex, 500, "{\"msg\":\"查询失败\"}");
                System.out.println("[old-b] 500 {\"msg\":\"查询失败\"}");
            }
        });
        server.createContext("/api/users", ex -> {
            try {
                find(42L);
                respond(ex, 200, "{\"code\":\"0\",\"message\":\"ok\",\"data\":{\"id\":42}}");
            } catch (BizException e) {
                // 新写法：只抛不接，映射只存在于这一处（对应 @RestControllerAdvice）
                respond(ex, 200, "{\"code\":\"" + e.code + "\",\"message\":\"" + e.getMessage()
                    + "\",\"data\":null}");
                System.out.println("[api]   200 {\"code\":\"" + e.code + "\",\"message\":\""
                    + e.getMessage() + "\",\"data\":null}");
            }
        });
        server.start();
        String base = "http://127.0.0.1:" + server.getAddress().getPort();
        HttpClient client = HttpClient.newHttpClient();
        get(client, base + "/old-a");
        get(client, base + "/old-b");
        get(client, base + "/api/users/42");
        server.stop(0);
        System.out.println("java.version=" + System.getProperty("java.version"));
    }

    static void find(long id) {
        throw new BizException("A0404", "用户不存在");
    }

    static void get(HttpClient client, String url) throws Exception {
        client.send(HttpRequest.newBuilder(URI.create(url)).GET().build(),
            HttpResponse.BodyHandlers.discarding());
    }

    static void respond(com.sun.net.httpserver.HttpExchange ex, int code, String body) throws Exception {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        ex.sendResponseHeaders(code, bytes.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(bytes);
        }
    }
}
"""

LAB_PAGE = r"""import com.sun.net.httpserver.HttpServer;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * 分页上限与深翻页：同一张 10000 行的假表，四种拉法。
 *   raw    —— size 原样进查询：一次把表拉穿（无上限的真实后果）；
 *   clamp  —— safeSize() 夹逼：同样的超大请求被压到 200；
 *   offset —— 第 49 页：存储层要扫过并丢弃前 9800 行，越往后越慢；
 *   cursor —— 游标：where id < lastId，每次只扫一页，行数恒定。
 * 「扫描行数」由 handler 侧计数，模拟存储层真实读过的行。
 */
public class Main {

    static final int ROWS = 10_000;
    static final int MAX_SIZE = 200;
    static int scanned;

    public static void main(String[] args) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/list", ex -> {
            Map<String, String> q = query(ex.getRequestURI().getRawQuery());
            int size = Integer.parseInt(q.getOrDefault("size", "10"));
            String mode = q.getOrDefault("mode", "clamp");
            int returned;
            switch (mode) {
                case "raw" -> {
                    scanned = ROWS;
                    returned = size;
                    System.out.println("[raw]    size=" + size + " -> 返回 " + Math.min(returned, ROWS)
                        + " 行，扫描 " + scanned + " 行（全表拉穿）");
                }
                case "clamp" -> {
                    int safe = Math.min(Math.max(size, 1), MAX_SIZE);
                    scanned = safe;
                    returned = safe;
                    System.out.println("[clamp]  size=" + size + " -> 夹逼为 " + returned
                        + " 行，扫描 " + scanned + " 行");
                }
                case "offset" -> {
                    int page = Integer.parseInt(q.getOrDefault("page", "1"));
                    scanned = (page - 1) * size + size;
                    returned = size;
                    System.out.println("[offset] 第 " + page + " 页 -> 返回 " + returned
                        + " 行，扫描 " + scanned + " 行（前 " + (scanned - size) + " 行被扫过即丢弃）");
                }
                default -> {
                    scanned = size;
                    returned = size;
                    System.out.println("[cursor] 游标翻页 -> 返回 " + returned
                        + " 行，扫描 " + scanned + " 行（恒定，与页深无关）");
                }
            }
            respond(ex, 200, "{\"returned\":" + Math.min(returned, ROWS) + ",\"scanned\":" + scanned + "}");
        });
        server.start();
        String base = "http://127.0.0.1:" + server.getAddress().getPort() + "/list";
        HttpClient client = HttpClient.newHttpClient();
        get(client, base + "?mode=raw&size=1000000");
        get(client, base + "?mode=clamp&size=1000000");
        get(client, base + "?mode=offset&size=200&page=49");
        get(client, base + "?mode=cursor&size=200");
        server.stop(0);
        System.out.println("java.version=" + System.getProperty("java.version"));
    }

    static Map<String, String> query(String raw) {
        Map<String, String> out = new HashMap<>();
        if (raw == null) return out;
        for (String pair : raw.split("&")) {
            int eq = pair.indexOf('=');
            if (eq > 0) out.put(pair.substring(0, eq), pair.substring(eq + 1));
        }
        return out;
    }

    static void get(HttpClient client, String url) throws Exception {
        client.send(HttpRequest.newBuilder(URI.create(url)).GET().build(),
            HttpResponse.BodyHandlers.discarding());
    }

    static void respond(com.sun.net.httpserver.HttpExchange ex, int code, String body) throws Exception {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        ex.sendResponseHeaders(code, bytes.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(bytes);
        }
    }
}
"""


TOPIC = {
    "id": "api-contract",
    "order": 2,
    "name": "接口契约层",
    "subtitle": "DTO / 校验 / 统一响应 / 异常出口：把「功能对了」升级成「契约对了」",
    "glyph": "⌸",
    "family": "web",
    "runtime": "Spring Boot 3.x · JDK 17+",
    "level": "基础",
    "intent": (
        "接口契约层解决的是「前后端各说各话」：入参没人校验、出参每人一个形状、"
        "失败时返回什么全靠口头约定。这一层把契约固化成代码 —— 专用 DTO 定形状、"
        "Bean Validation 定合法性、统一响应体定结构、全局异常处理器定失败出口、"
        "分页上限定资源边界 —— 让每个接口在写出来的那一刻就自动长成同一个样子，"
        "而不是靠 code review 逐个人肉对齐。"
    ),
    "pickWhen": [
        {"vs": "Controller 手写 if 判空",
         "text": "字段一多手写校验必漏、提示语各处不一；Bean Validation 声明式挂在字段上，校验与提示同源。仅一两个标量参数的 GET 接口可用 @RequestParam + @Validated 走同一套注解。"},
        {"vs": "RFC 7807 ProblemDetail",
         "text": "面向第三方、要求标准 REST 错误语义的开放 API 用 ProblemDetail；对自家前后端，统一 ApiResponse 更直接 —— 前端只认一种解析。两者选一个并全项目一致，不混用。"},
        {"vs": "网关层统一校验",
         "text": "网关能挡鉴权与限流，但字段级契约（必填 / 长度 / 格式）只有最贴近业务的 DTO 知道。网关兜外、DTO 兜内，两者是互补不是替代。"},
    ],
    "limits": [
        "契约层只管「进出的形状与合法性」，不管业务规则：「用户名是否已存在」这类要查库的校验属于 Service。",
        "统一响应体是内部约定：开放给第三方且要求标准 REST 语义的接口要另立出口（如 ProblemDetail），别一套结构硬塞所有受众。",
        "@Valid 只校验单个字段 / 单个对象；跨字段约束（开始时间 < 结束时间）要写类级自定义注解或下沉到 Service。",
        "分页上限挡得住误传挡不住恶意：限流、鉴权与脱敏是另外三层，pageSize 夹逼只是把最便宜的那扇门关上。",
    ],
    "references": [
        {"title": "Jakarta Bean Validation 3.0 规范",
         "url": "https://jakarta.ee/specifications/beanvalidation/3.0/",
         "note": "约束注解与校验语义的正式规范，@Valid 触发模型出自这里"},
        {"title": "Spring Framework · Validation 与 @RestControllerAdvice",
         "url": "https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-validation.html",
         "note": "@Valid 触发点、MethodArgumentNotValidException 与全局异常处理"},
        {"title": "阿里巴巴 Java 开发手册 · 工程结构 / 异常日志 / 安全规约",
         "note": "DO 与 DTO 禁止混用、错误码约定、pageSize 上限等【强制】条目来源"},
        {"title": "军火库规则集 · WEB 类",
         "note": "WEB-CTRL-001~006 / WEB-DTO-001 的规则原文与 bad/good 对照"},
    ],
    "scenarios": [
        {
            "id": "request-validation",
            "order": 1,
            "name": "入参校验收口",
            "when": (
                "写任何接收 JSON body 的接口 —— 创建、更新、提交、导入。只要入参来自外部"
                "（前端 / 第三方 / 脚本），形状与合法性就必须在进业务层之前判定完毕，"
                "而不是散落在 Controller 的 if 里，或干脆没人判。"
            ),
            "signals": [
                "Controller 方法体里出现成排的 if (x == null) / isBlank(x) 防御性判空",
                "DTO 里出现 Map<String, Object>，或数据库实体被直接收进 @RequestBody",
                "DTO 字段上写了 @NotBlank / @Size，接口却照单全收空值 —— @Valid 没加，注解全部静默失效",
            ],
            "decision": (
                "契约要长在参数上：专用 DTO 定形状，约束注解定合法性，@Valid 定触发点。"
                "三者齐了，非法请求在进 Service 之前就以 400 + 中文提示失败，业务代码里不再出现防御性判空。"
            ),
            "notSuitable": [
                "纯查询且无 body 的简单 GET（几个标量参数）—— @RequestParam + @Validated 就够，别为一个 page 参数建 DTO",
                "系统间定时任务 / 消息消费的内部调用 —— 不走 HTTP 序列化，领域对象直传，套一层 Request DTO 只添翻译成本",
                "一次性原型验证 —— 先把契约画出来再写代码比写完再补 DTO 便宜；确要裸奔也必须知道此刻欠着什么",
            ],
            "recipes": [
                {
                    "id": "dto-and-valid",
                    "order": 1,
                    "name": "专用 DTO + @Valid + 字段约束",
                    "approach": (
                        "入参用 XxxRequest 专用 DTO 收口：字段带约束注解与面向用户的中文 message，"
                        "Controller 在 @RequestBody 参数上加 @Valid 触发校验；校验失败由全局处理器"
                        "转成 400 + 逐字段提示，业务层从此只见合法数据。"
                    ),
                    "flow": [
                        {"layer": "client", "step": "POST /api/users 携带 JSON",
                         "detail": "调用方按契约发请求；契约本身由 DTO 类显式声明，不靠文档口头约定。"},
                        {"layer": "web", "step": "@Valid @RequestBody 绑定并触发校验",
                         "detail": "Controller 只做 HTTP 适配：绑定、触发校验、调用一个 Service、包装响应。"},
                        {"layer": "dto-in", "step": "约束注解逐字段判定",
                         "detail": "@NotBlank / @Size / @Email / @Pattern 各司其职，message 是面向用户的中文。"},
                        {"layer": "exception", "step": "校验失败 → 全局处理器 → 400",
                         "detail": "MethodArgumentNotValidException 被全局处理器接住，请求在进 Service 前失败。"},
                        {"layer": "service", "step": "校验通过才进业务层",
                         "detail": "userService.create(req) 拿到的必然是合法数据，方法体里不再有防御性判空。"},
                        {"layer": "client", "step": "拿到统一响应体",
                         "detail": "ApiResponse<Long>：code=0 表示成功，data 是新用户 id。"},
                    ],
                    "packages": [
                        "com.example.contract.dto        入参 / 出参契约对象（Request / VO）",
                        "com.example.contract.controller HTTP 适配层（薄，只做绑定与转发）",
                    ],
                    "files": [
                        {
                            "id": "dto",
                            "path": "src/main/java/com/example/contract/dto/UserCreateRequest.java",
                            "layer": "dto-in",
                            "lang": "java",
                            "role": "创建用户的入参契约：字段显式、约束注解齐全、message 面向用户。",
                            "code": DTO_REQUEST,
                            "highlights": [
                                {"mark": "@NotBlank(message = \"用户名不能为空\")",
                                 "title": "约束与话术同源",
                                 "text": "message 直接写面向用户的中文，全局处理器把它原样拼进 400 响应 —— 提示语不会散落在 Controller 里各写各的。",
                                 "rule": "WEB-CTRL-002"},
                                {"mark": "private String username;",
                                 "title": "没有裸字段",
                                 "text": "每个字段都带约束注解；「以后再加校验」通常等于永远不加 —— 契约在字段声明的那一刻就定完。",
                                 "rule": "WEB-CTRL-002"},
                                {"mark": "import jakarta.validation.constraints.NotBlank;",
                                 "title": "jakarta 命名空间",
                                 "text": "Spring Boot 3 起是 jakarta.validation；写成 javax.validation 时注解类不在 classpath 上，等于没写校验。",
                                 "rule": "SKEL-DEP-001"},
                            ],
                        },
                        {
                            "id": "controller",
                            "path": "src/main/java/com/example/contract/controller/UserController.java",
                            "layer": "web",
                            "lang": "java",
                            "role": "用户写接口：Controller 只做 HTTP 适配，业务与数据访问一概不沾。",
                            "code": CONTROLLER_CREATE,
                            "highlights": [
                                {"mark": "@Valid @RequestBody UserCreateRequest req",
                                 "title": "@Valid 是校验的触发点",
                                 "text": "漏掉它时 DTO 上所有约束注解同时静默失效 —— 不报错不告警，非法数据直达业务层，是最隐蔽的一类缺陷。",
                                 "rule": "WEB-CTRL-002"},
                                {"mark": "return ApiResponse.ok(userService.create(req));",
                                 "title": "一行方法体：适配而非业务",
                                 "text": "调用单个 Service、包装响应，没有 if 分支 / 循环 / 数据访问 —— 业务掺进 Controller 就无法复用、无法单测、事务也无法界定。",
                                 "rule": "WEB-CTRL-001"},
                                {"mark": "public ApiResponse<Long> create",
                                 "title": "入参出参都是专用类型",
                                 "text": "入参 UserCreateRequest、出参 ApiResponse<Long>；不收 Map、不收实体 —— Map 收发意味着契约不存在，实体直出会把内部字段暴露到 API 上。",
                                 "rule": "WEB-DTO-001"},
                                {"mark": "public UserController(UserService userService) {",
                                 "title": "构造器注入",
                                 "text": "字段 final、单测可直 new；字段注入（@Autowired private）会让依赖隐藏在类内部，测试必须起容器。",
                                 "rule": "SVC-LAYR-001"},
                            ],
                        },
                    ],
                    "checklist": [
                        "确认每个 @RequestBody 参数前都有 @Valid —— 漏了它，DTO 上所有注解同时静默失效。",
                        "确认入参类型是专用 Request DTO，不是 Map、不是数据库实体。",
                        "确认每个字段都有约束注解，且 message 是面向用户的中文。",
                        "确认校验失败进的是全局处理器的 400 分支，Controller 里没有 try-catch。",
                    ],
                    "pitfalls": [
                        "@Valid 写丢或写在错误位置：注解全部失效且不报错 —— 上线靠用户帮你发现，这是规则里「高频踩坑」标签的出处。",
                        "校验消息写成「参数错误」这种笼统话：用户不知道改哪个字段；message 要具体到字段与规则。",
                        "把「手机号是否已注册」也塞进 DTO 校验或 Controller 的 if —— 格式是契约、查库是业务，边界混了就会长成大泥球。",
                    ],
                    "relatedRules": ["WEB-CTRL-001", "WEB-CTRL-002", "WEB-DTO-001"],
                    "lab": {
                        "kind": "mock-endpoint",
                        "intro": (
                            "同一个假 Controller 两种写法：legacy 版对非法请求照单全收，"
                            "contract 版在入口就 400 + 逐字段中文提示。同一份非法 body，两段输出对比。"
                        ),
                        "observe": [
                            "legacy 版对 username 为空、email 非法的请求返回 200 并把脏数据计入库存 —— 全程没有任何报错",
                            "contract 版对同一份 body 返回 400，message 逐字段列出全部违规项；合法 body 正常入库",
                        ],
                    },
                    "playground": [
                        {"id": "api-contract-valid",
                         "label": "契约校验：直通 vs 收口",
                         "mainClass": "Main",
                         "note": "纯 JDK 复刻（差异仅为框架写法，语义一致）：Spring 版由 @Valid + 全局异常处理器完成同一件事。",
                         "files": [{"path": "Main.java", "code": LAB_VALID}]},
                    ],
                },
            ],
        },
        {
            "id": "unified-response",
            "order": 2,
            "name": "统一出口：响应体与异常",
            "when": (
                "接口超过一个、调用方超过一个人的时候。只要前端还要解析两个以上接口的返回，"
                "响应结构就必须只有一种；只要业务异常存在，它到响应体的映射就必须只有一份 —— "
                "两者都靠「每个接口自己注意」维持不住。"
            ),
            "signals": [
                "不同 Controller 的失败返回长得不一样：有的 error、有的 msg、有的直接 500 空页",
                "Controller 方法体里 try-catch 包住 Service 调用，把异常吞成本接口独有的一种返回",
                "错误码字符串散落在各处硬编码，同一个业务含义在不同接口是不同码",
            ],
            "decision": (
                "ApiResponse 定唯一结构，BizException 定唯一业务失败表达，"
                "@RestControllerAdvice 定唯一映射出口。Controller 从此只抛不接，前端只解析一种结构。"
            ),
            "notSuitable": [
                "对接方已锁死另一种响应协议的存量接口 —— 在适配层单独收敛，不要为此把全局结构改成两套",
                "浏览器直接打开的文件下载 / 导出流 —— 它是字节流不是 JSON，硬包一层 ApiResponse 只会破坏流",
                "对第三方的开放 API 若已约定 RFC 7807 —— 那是一条独立出口，与内部结构并存且各自保持一致",
            ],
            "recipes": [
                {
                    "id": "result-and-advice",
                    "order": 1,
                    "name": "ApiResponse + BizException + @RestControllerAdvice",
                    "approach": (
                        "响应体 ApiResponse<T>（code / message / data）配静态工厂 ok / fail；"
                        "业务失败一律 throw BizException(码, 中文提示)；@RestControllerAdvice 把业务异常、"
                        "校验失败与未预期异常三路都映射到同一种结构，全项目只有这一份映射。"
                    ),
                    "flow": [
                        {"layer": "client", "step": "GET /api/users/{id}",
                         "detail": "前端只认一种响应结构：先看 code，再取 data。"},
                        {"layer": "web", "step": "Controller 直接调用 Service",
                         "detail": "没有 try-catch —— 异常一律上抛，Controller 不替全局出口做决定。"},
                        {"layer": "service", "step": "业务规则不满足 → throw BizException",
                         "detail": "查无此用户即 throw new BizException(\"A0404\", \"用户不存在\")，错误码随异常走。"},
                        {"layer": "exception", "step": "@RestControllerAdvice 命中对应分支",
                         "detail": "BizException / 校验失败 / 未预期异常三条路都在同一份映射表里。"},
                        {"layer": "common", "step": "统一响应体序列化",
                         "detail": "ApiResponse.fail(code, message) —— 失败时 data 恒为 null。"},
                        {"layer": "client", "step": "按 code 分支",
                         "detail": "成功 code=0；业务失败 code=A0404 之类可做分支；系统错误 A0500 固定话术。"},
                    ],
                    "packages": [
                        "com.example.contract.common      统一响应体（ApiResponse / PageResult）",
                        "com.example.contract.exception   业务异常与全局异常处理器",
                        "com.example.contract.dto         出参 VO（对外可见字段的显式清单）",
                    ],
                    "files": [
                        {
                            "id": "api-response",
                            "path": "src/main/java/com/example/contract/common/ApiResponse.java",
                            "layer": "common",
                            "lang": "java",
                            "role": "统一响应体：全项目所有接口唯一的出参结构。",
                            "code": API_RESPONSE,
                            "highlights": [
                                {"mark": "public static <T> ApiResponse<T> ok(T data) {",
                                 "title": "成功只有一种形状",
                                 "text": "静态工厂收口构造路径：结构只能在 ok / fail 两处被造出来，接口没法各拼各的返回体。",
                                 "rule": "WEB-CTRL-003"},
                                {"mark": "public static <T> ApiResponse<T> fail(String code, String message) {",
                                 "title": "失败也只有一个来源",
                                 "text": "code 由业务异常带入而不是各接口手填 —— 同一个业务含义全项目是同一个码。",
                                 "rule": "WEB-CTRL-003"},
                                {"mark": "private ApiResponse(String code, String message, T data) {",
                                 "title": "构造器私有",
                                 "text": "防止绕过工厂直接 new 出第三种语义不明的结构；data 与 code 的配对关系在源头被锁死。",
                                 "rule": "WEB-CTRL-003"},
                            ],
                        },
                        {
                            "id": "user-vo",
                            "path": "src/main/java/com/example/contract/dto/UserVO.java",
                            "layer": "dto-out",
                            "lang": "java",
                            "role": "用户出参视图：对外可见字段的显式清单，实体永不直接出 API。",
                            "code": USER_VO,
                            "highlights": [
                                {"mark": "public record UserVO(Long id, String username, String email) {",
                                 "title": "只列对外可见的字段",
                                 "text": "passwordHash、internalFlag、tenantId 留在实体里 —— 直接序列化实体会把内部字段暴露到 API 上，且数据库改字段就破接口。",
                                 "rule": "WEB-DTO-001"},
                                {"mark": "package com.example.contract.dto;",
                                 "title": "VO 是契约不是实体",
                                 "text": "record 不可变、字段即契约：数据库加字段、实体改结构，接口契约纹丝不动。",
                                 "rule": "WEB-DTO-001"},
                            ],
                        },
                        {
                            "id": "biz-exception",
                            "path": "src/main/java/com/example/contract/exception/BizException.java",
                            "layer": "exception",
                            "lang": "java",
                            "role": "业务异常：业务失败的唯一表达，错误码的唯一来源。",
                            "code": BIZ_EXCEPTION,
                            "highlights": [
                                {"mark": "public class BizException extends RuntimeException {",
                                 "title": "业务失败是异常，不是返回值",
                                 "text": "业务规则不满足（余额不足 / 用户不存在）用异常表达，Service 的正常路径不用被错误码返回值污染。",
                                 "rule": "WEB-CTRL-004"},
                                {"mark": "public BizException(String code, String message) {",
                                 "title": "错误码随异常走",
                                 "text": "code 是异常的属性而不是抛出处的局部变量 —— 响应体里的错误码只有这一个来源，不会各处硬编码。",
                                 "rule": "WEB-CTRL-004"},
                            ],
                        },
                        {
                            "id": "global-handler",
                            "path": "src/main/java/com/example/contract/exception/GlobalExceptionHandler.java",
                            "layer": "exception",
                            "lang": "java",
                            "role": "全局异常处理器：异常到响应体的映射全项目只有这一份。",
                            "code": GLOBAL_HANDLER,
                            "highlights": [
                                {"mark": "@RestControllerAdvice",
                                 "title": "全局唯一出口",
                                 "text": "N 个 Controller 各写各的 catch，就是 N 处遗漏点；收口到一个 Advice 后，映射只写一次，漏不掉也改不散。",
                                 "rule": "WEB-CTRL-004"},
                                {"mark": "@ExceptionHandler(MethodArgumentNotValidException.class)",
                                 "title": "校验失败也走同一种结构",
                                 "text": "@Valid 的失败（400 + 逐字段提示）与业务失败（code/message）共用 ApiResponse —— 前端解析逻辑永远只有一份。",
                                 "rule": "WEB-CTRL-002"},
                                {"mark": "return ApiResponse.fail(\"A0500\", \"系统繁忙，请稍后重试\");",
                                 "title": "兜底不泄内部信息",
                                 "text": "未预期异常对外只给固定话术，完整堆栈留在日志 —— e.getMessage() 里可能藏着内部路径与 SQL 片段。",
                                 "rule": "WEB-CTRL-004"},
                                {"mark": "log.error(\"未预期异常\", e);",
                                 "title": "现场只进日志",
                                 "text": "异常对象整个交给 SLF4J（带完整堆栈）；用占位符而不是字符串拼接拼日志，现场才拼得回。",
                                 "rule": "REL-LOG-002"},
                            ],
                        },
                    ],
                    "checklist": [
                        "确认所有 Controller 方法的返回类型都是 ApiResponse<T>（或包着它的 ResponseEntity），没有裸实体 / 裸集合。",
                        "确认 Controller 方法体里没有任何 try-catch —— 异常一律上抛给全局处理器。",
                        "确认错误码只有一个来源（BizException），响应体里的 code 不允许在别处再写一遍。",
                        "确认兜底 handler 不把堆栈与内部信息回给调用方，完整现场只进日志。",
                    ],
                    "pitfalls": [
                        "在 Controller 里 catch 业务异常再「转换」一下返回：同类异常从此在不同接口长成不同结构，全局处理器被架空。",
                        "兜底 handler 把 e.getMessage() 原样回给用户：内部路径、SQL 片段可能就在里面 —— 对外只给固定话术，细节进日志。",
                        "把业务异常设计成受检异常（继承 Exception）：调用方被迫层层 try-catch 或方法签名全挂 throws，出口又被打散。",
                    ],
                    "relatedRules": ["WEB-CTRL-003", "WEB-CTRL-004", "WEB-DTO-001"],
                    "lab": {
                        "kind": "mock-endpoint",
                        "intro": (
                            "同一个「查无此用户」的失败：旧接口 A 返回 error 结构（404），"
                            "旧接口 B 各自 catch 吞成 msg 结构（500），新接口统一 code/message/data。"
                            "三段响应摆在一起，就是统一出口前后的差别。"
                        ),
                        "observe": [
                            "旧接口 A / B 对同一类失败返回两种结构、两种 HTTP 状态 —— 调用方要写两套解析",
                            "新接口无论成功失败都是 code/message/data 一种结构；业务失败 code=A0404，前端按 code 分支即可",
                        ],
                    },
                    "playground": [
                        {"id": "api-contract-advice",
                         "label": "统一出口：三种失败出口对比",
                         "mainClass": "Main",
                         "note": "纯 JDK 复刻（差异仅为框架写法，语义一致）：Spring 版由 @RestControllerAdvice 在同一处完成映射。",
                         "files": [{"path": "Main.java", "code": LAB_ADVICE}]},
                    ],
                },
            ],
        },
        {
            "id": "pagination-limit",
            "order": 3,
            "name": "分页与批量上限",
            "when": (
                "任何接收 page / size / limit 参数的列表接口，以及一切「把一批数据搬走」的导出、"
                "同步接口。size 是调用方可控的资源旋钮：不设上限，就等于把「一次拉全表」"
                "做成了公开接口；深翻页不限，就等于把慢查询的钥匙交给前端。"
            ),
            "signals": [
                "pageSize / size 参数由前端随意传，服务端照单全收",
                "存在一次返回几千上万行的「导出」接口，或前端循环翻页直到空",
                "深翻页时接口越来越慢：LIMIT offset 越大，存储层扫过并丢弃的行越多",
            ],
            "decision": (
                "上限必须同时存在于两处：参数对象的 @Max 让越界请求在入口被拒，"
                "safeSize() 夹逼让绕过注解的调用（内部复用、漏了 @Valid）也拿不到超大页；"
                "深翻页不给 offset，给游标。"
            ),
            "notSuitable": [
                "结果集天然有界的配置表 / 字典表 —— 几十行数据翻不深，给上限即可，游标是过度设计",
                "已由搜索引擎 / OLAP 引擎承担深分页的场景 —— 那里有原生 cursor / scroll，应用层再包一层只会重复",
                "一次性离线批处理（内部任务间传全量）—— 它不是分页问题，用批处理或分片拉取，别伪装成 pageSize",
            ],
            "recipes": [
                {
                    "id": "page-clamp-and-cursor",
                    "order": 1,
                    "name": "PageQuery 夹逼 + 游标翻页",
                    "approach": (
                        "分页参数统一继承 PageQuery：字段带 @Min / @Max 注解，safeSize() 再夹逼一次；"
                        "列表出参统一 PageResult（records / hasNext / nextCursor），hasNext 服务端算好；"
                        "深翻页走游标（where id < lastId），offset 超过阈值直接拒绝并引导改游标。"
                    ),
                    "flow": [
                        {"layer": "client", "step": "GET /api/users?page=2&size=50&lastId=...",
                         "detail": "查询条件与分页字段收进同一个 UserQueryRequest，不是一排散装参数。"},
                        {"layer": "dto-in", "step": "绑定到查询契约",
                         "detail": "UserQueryRequest extends PageQuery：查询条件与分页上限同源。"},
                        {"layer": "common", "step": "safeSize() 夹逼",
                         "detail": "无论参数怎么进来，size 都落在 [1, 200]；@Max 在入口已拒过一次，这里是保险丝。"},
                        {"layer": "service", "step": "深翻保护与排序白名单",
                         "detail": "offset 超阈值直接拒绝并引导游标；排序字段不在白名单即拒绝，请求字符串不直达存储层。"},
                        {"layer": "dto-out", "step": "统一分页出参",
                         "detail": "PageResult{records, hasNext, nextCursor}；hasNext 服务端判定，不让前端数条数。"},
                        {"layer": "client", "step": "游标拉下一页",
                         "detail": "hasNext=true 时带 nextCursor 请求下一页，不跳页、不数总数，每次代价恒定。"},
                    ],
                    "packages": [
                        "com.example.contract.common      PageQuery（上限夹逼）/ PageResult（统一分页出参）",
                        "com.example.contract.service     查询服务（夹逼 + 游标 + 排序白名单）",
                    ],
                    "files": [
                        {
                            "id": "page-query",
                            "path": "src/main/java/com/example/contract/common/PageQuery.java",
                            "layer": "common",
                            "lang": "java",
                            "role": "分页参数基类：上限注解 + 夹逼兜底，全项目 size 上限同一个数。",
                            "code": PAGE_QUERY,
                            "highlights": [
                                {"mark": "public static final int MAX_SIZE = 200;",
                                 "title": "上限是全项目常数",
                                 "text": "200 是规则建议的上限值；「每个接口自己定一个」等于没有上限 —— 常数只定义一次，注解与夹逼共用。",
                                 "rule": "WEB-CTRL-005"},
                                {"mark": "public int safeSize() {",
                                 "title": "夹逼是注解的保险丝",
                                 "text": "@Max 只在 Bean Validation 真跑时生效（内部直调、漏 @Valid 时会失效）；safeSize() 让任何路径拿到的 size 都落在界内。",
                                 "rule": "WEB-CTRL-005"},
                                {"mark": "@Max(value = MAX_SIZE, message = \"单页最多 200 条\")",
                                 "title": "注解挡入口，中文拒越界",
                                 "text": "走 @Valid 的入口（Controller 绑定）越界请求直接 400，message 与其它契约同一套话术。",
                                 "rule": "WEB-CTRL-005"},
                            ],
                        },
                        {
                            "id": "query-dto",
                            "path": "src/main/java/com/example/contract/dto/UserQueryRequest.java",
                            "layer": "dto-in",
                            "lang": "java",
                            "role": "用户列表查询契约：查询条件 + 分页字段 + 游标参数收进同一个 DTO。",
                            "code": USER_QUERY_REQUEST,
                            "highlights": [
                                {"mark": "public class UserQueryRequest extends PageQuery {",
                                 "title": "查询也是契约",
                                 "text": "查询条件 + 分页收进一个专用 DTO，继承统一的上限基类 —— 不用散装 @RequestParam，更不用 Map。",
                                 "rule": "WEB-DTO-001"},
                                {"mark": "private String sort;",
                                 "title": "排序字段进契约受管",
                                 "text": "sort 是字符串但不是自由文本：服务端白名单校验它，恶意 order by 字符串到不了存储层。",
                                 "rule": "WEB-CTRL-005"},
                            ],
                        },
                        {
                            "id": "page-result",
                            "path": "src/main/java/com/example/contract/common/PageResult.java",
                            "layer": "dto-out",
                            "lang": "java",
                            "role": "统一分页出参：records / hasNext / nextCursor，列表接口唯一的返回包装。",
                            "code": PAGE_RESULT,
                            "highlights": [
                                {"mark": "private final boolean hasNext;",
                                 "title": "hasNext 服务端算",
                                 "text": "让前端数 records.size() 判断「还有没有下一页」，恰好整页时会多打一次空查询；有没有下一页是服务端的事实。",
                                 "rule": "WEB-CTRL-005"},
                                {"mark": "private final Long nextCursor;",
                                 "title": "游标随页返回",
                                 "text": "下一页的定位值由本页带出 —— 调用方不需要理解 offset 与总页数，翻页代价与页深无关。",
                                 "rule": "WEB-CTRL-005"},
                            ],
                        },
                        {
                            "id": "query-service",
                            "path": "src/main/java/com/example/contract/service/UserQueryService.java",
                            "layer": "service",
                            "lang": "java",
                            "role": "分页查询服务：size 夹逼、offset 阈值、游标翻页、排序白名单的唯一落点。",
                            "code": USER_QUERY_SERVICE,
                            "highlights": [
                                {"mark": "int size = req.safeSize();",
                                 "title": "服务端兜底夹逼",
                                 "text": "查询永远用夹逼后的 size —— 不信调用方自觉，也不信「注解一定被走到」。",
                                 "rule": "WEB-CTRL-005"},
                                {"mark": "throw new BizException(\"A0400\", \"翻页过深，请改用游标参数 lastId 翻页\");",
                                 "title": "深翻页拒绝并引导",
                                 "text": "LIMIT offset 越往后扫过并丢弃的行越多；超过阈值不放行注定变慢的查询，而是告诉调用方正确的路。",
                                 "rule": "WEB-CTRL-005"},
                                {"mark": ".lt(req.getLastId() != null, UserPO::getId, req.getLastId())",
                                 "title": "游标代替深 offset",
                                 "text": "where id < lastId order by id desc：每页扫描行数恒定，与页深无关 —— 深翻页的正确姿势。",
                                 "rule": "WEB-CTRL-005"},
                                {"mark": "private static final Set<String> SORTABLE = Set.of(\"id\", \"createdAt\");",
                                 "title": "排序字段白名单",
                                 "text": "请求传来的排序字符串只允许命中白名单枚举；恶意 order by 到不了存储层。",
                                 "rule": "WEB-CTRL-005"},
                                {"mark": ".select(UserPO::getId, UserPO::getUsername, UserPO::getEmail)",
                                 "title": "查询列显式",
                                 "text": "只查对外字段：敏感列根本不进查询，顺带省掉不用列的传输 —— 与出参 VO 是同一件事的两端。",
                                 "rule": "WEB-DTO-001"},
                            ],
                        },
                    ],
                    "checklist": [
                        "确认每个分页参数对象都继承 PageQuery，size 上限全项目同一个数（MAX_SIZE）。",
                        "确认查询入参是专用 DTO（含查询条件与分页字段），不是一排散装 @RequestParam，更不是 Map。",
                        "确认排序字段走白名单，任何来自请求的排序字符串都不能直达存储层。",
                        "确认深翻页路径有兜底：offset 超阈值要拒绝并引导游标，而不是放行一个注定变慢的查询。",
                    ],
                    "pitfalls": [
                        "只在 @Max 上限夹、没做 safeSize 夹逼：内部方法直接传参或某处漏了 @Valid，上限就静默消失。",
                        "前端自己数 records.size() 判断「还有没有下一页」：恰好整页时多打一次空查询；hasNext 要服务端算好。",
                        "导出接口用「分页循环直到空」实现：size 再大也扛不住全量搬运 —— 它是批处理问题，不是分页问题。",
                    ],
                    "performance": {
                        "title": "同一张 10000 行的表：四种拉法（页面下方实验可复现）",
                        "columns": ["拉法", "返回条数", "存储层扫描行数", "风险"],
                        "rows": [
                            ["size=1000000 直传（无上限）", "1000000", "1000000", "内存打满，最廉价的拒绝服务"],
                            ["size 夹逼到 200", "200", "200", "可控"],
                            ["offset 翻到第 49 页（size=200）", "200", "10000（前 9800 行扫过即弃）", "越往后越慢"],
                            ["游标翻到第 49 页（size=200）", "200", "200", "恒定，与页深无关"],
                        ],
                        "conclusion": (
                            "上限挡的是「一次拉全表」，游标挡的是「越翻越慢」。"
                            "两个都不是性能优化，是把调用方可控的资源旋钮收回服务端。"
                        ),
                    },
                    "relatedRules": ["WEB-CTRL-005", "WEB-DTO-001"],
                    "lab": {
                        "kind": "mock-endpoint",
                        "intro": (
                            "同一张 10000 行的假表四种拉法：size 直传、夹逼、offset 深翻、游标，"
                            "handler 侧计数「存储层真实扫过的行数」，直接对比返回条数与扫描行数。"
                        ),
                        "observe": [
                            "raw 模式 size=1000000：返回条数等于全表 —— 上限缺失时这就是一个公开的全表导出接口",
                            "clamp 模式同样的超大请求被压到 200；offset 第 49 页扫描 10000 行，游标每次恒为 200",
                        ],
                    },
                    "playground": [
                        {"id": "api-contract-page",
                         "label": "分页上限与深翻页：四种拉法",
                         "mainClass": "Main",
                         "note": "纯 JDK 复刻（差异仅为框架写法，语义一致）：Spring 版由 PageQuery + PageResult 承担同一组职责。",
                         "files": [{"path": "Main.java", "code": LAB_PAGE}]},
                    ],
                },
            ],
        },
    ],
}
