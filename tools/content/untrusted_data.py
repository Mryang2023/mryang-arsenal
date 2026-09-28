# -*- coding: utf-8 -*-
"""技术主题 · 不可信数据防线（反序列化 + 输出转义）。

案例库三层结构的安全主线：

    L1 技术（本文件）      外部进来的数据为什么不能轻信
    L2 场景                什么情况下要守反序列化白名单 / 要输出转义（带可核对信号）
    L3 实现方案            具体类型绑定 + 多态白名单 / 输出前转义，附模拟接口实测

「模拟接口测试」用 HttpServer 当假服务：一组端点分别吐「可信 / 不可信」的序列化字节，
对比无白名单与带白名单反序列化的结果；另一组演示用户输入拼进 HTML 时转义与否的差异。
都是真起 HttpServer 假下游，不靠 sleep 假装。
"""

SAFE_DESERIALIZE = r"""package com.example.sec;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.json.JsonMapper;

/**
 * 安全反序列化（SEC-DESER-001）：不可信 JSON 绝不开多态类型自动解析。
 *
 * Jackson 的两类「多态类型自动解析」开关一旦对不可信输入打开，
 * 就会按 JSON 里的类型信息去实例化任意类——攻击者可借此构造
 * 非预期类型。正确做法：直接绑定到具体 DTO，不开多态。
 * （具体开关名见本条信号的 pitfalls，注释里不复述 API 名——
 *   本文件要过自己的规则引擎，注释里出现 API 调用字样会被当真命中。）
 */
public class SafeDeserialize {

    /** 不开多态类型自动解析：不可信输入禁用一切「按类型名实例化」的入口。 */
    public OrderDTO read(String json) throws Exception {
        ObjectMapper mapper = new JsonMapper();
        return mapper.readValue(json, OrderDTO.class);
    }
}
"""

SAFE_VIEW = r"""package com.example.sec;

import org.springframework.web.util.HtmlUtils;

/**
 * 输出转义（SEC-OUTPUT-001）：把用户可控数据写进 HTML / 页面前必须转义，
 * 否则 <script> 等会被浏览器当代码执行（XSS）。
 *
 * 用框架提供的转义工具，不要手拼标签；模板引擎也要开启自动转义。
 */
public class SafeView {

    /** ✅ 安全：转义后再进 HTML。 */
    public String render(String userInput) {
        String safe = HtmlUtils.htmlEscape(userInput);   // 或 org.owasp.encoder.Encode.forHtml(userInput)
        return "<div>你好，" + safe + "</div>";
    }

    // 危险：直接拼接未转义数据 —— return "<div>你好，" + userInput + "</div>";
}
"""

# ── L3 模拟接口测试：反序列化白名单 ───────────────────────────────
LAB_DESER = r"""import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;

/** 模拟「可信」与「不可信」两类序列化对象。 */
class Payload implements Serializable { String v = "benign"; }
class Evil implements Serializable { String v = "should-not-deser"; }

/** 带白名单的 ObjectInputStream：只放行声明的类。 */
class SafeOIS extends ObjectInputStream {
    SafeOIS(InputStream in) throws IOException { super(in); }
    protected Class<?> resolveClass(ObjectStreamClass d) throws IOException, ClassNotFoundException {
        if (!d.getName().equals(Payload.class.getName()))
            throw new InvalidClassException("拒绝反序列化非白名单类型: " + d.getName());
        return super.resolveClass(d);
    }
}

public class Main {
    static byte[] ser(Object o) throws IOException {
        var baos = new ByteArrayOutputStream();
        try (var oos = new ObjectOutputStream(baos)) { oos.writeObject(o); }
        return baos.toByteArray();
    }
    public static void main(String[] args) throws Exception {
        byte[] benign = ser(new Payload());
        byte[] evil = ser(new Evil());

        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.createContext("/safe", ex -> respondBytes(ex, benign));
        server.createContext("/evil", ex -> respondBytes(ex, evil));
        server.start();
        String base = "http://127.0.0.1:" + server.getAddress().getPort();

        byte[] fromEvil = get(base + "/evil");

        // (a) 无白名单：Evil 也能被还原 —— 攻击者的类会被实例化
        try (var ois = new ObjectInputStream(new ByteArrayInputStream(fromEvil))) {
            Object o = ois.readObject();
            System.out.println("[无白名单] /evil 还原出: " + o.getClass().getSimpleName());
        } catch (Exception e) { System.out.println("[无白名单] /evil 失败: " + e); }

        // (b) 有白名单：Evil 直接被拒，Payload 正常
        try (var ois = new SafeOIS(new ByteArrayInputStream(fromEvil))) {
            ois.readObject();
            System.out.println("[白名单] /evil 竟被还原（不应发生）");
        } catch (Exception e) { System.out.println("[白名单] /evil 被拒: " + e.getClass().getSimpleName()); }
        try (var ois = new SafeOIS(new ByteArrayInputStream(ser(new Payload())))) {
            Object o = ois.readObject();
            System.out.println("[白名单] /safe 正常还原: " + o.getClass().getSimpleName());
        } catch (Exception e) { System.out.println("[白名单] /safe 失败: " + e); }

        server.stop(0);
        System.out.println("java.version=" + System.getProperty("java.version"));
    }
    static void respondBytes(HttpExchange ex, byte[] b) throws IOException {
        ex.sendResponseHeaders(200, b.length); ex.getResponseBody().write(b); ex.close();
    }
    static byte[] get(String url) throws Exception {
        return java.net.http.HttpClient.newHttpClient()
            .send(java.net.http.HttpRequest.newBuilder(java.net.URI.create(url)).GET().build(),
                  java.net.http.HttpResponse.BodyHandlers.ofByteArray()).body();
    }
}
"""

# ── L3 模拟接口测试：输出转义 ─────────────────────────────────────
LAB_ESCAPE = r"""import com.sun.net.httpserver.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executors;

public class Main {
    // 纯 JDK 转义：把 < > & " ' 转成 HTML 实体
    static String escape(String s) {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace("\"", "&quot;").replace("'", "&#39;");
    }
    static String page(String name) {
        return "<html><body>你好, " + name + "</body></html>";
    }
    public static void main(String[] args) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.createContext("/reflect", ex -> {
            String q = ex.getRequestURI().getQuery();
            String name = query(q, "name");
            boolean esc = "1".equals(query(q, "esc"));
            String safe = esc ? escape(name) : name;   // 是否转义
            String html = page(safe);
            byte[] b = html.getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().add("Content-Type", "text/html; charset=utf-8");
            ex.sendResponseHeaders(200, b.length);
            ex.getResponseBody().write(b); ex.close();
        });
        server.start();
        String base = "http://127.0.0.1:" + server.getAddress().getPort();
        callRaw(base + "/reflect?name=<script>alert(1)</script>&esc=0"); // 未转义
        callRaw(base + "/reflect?name=<script>alert(1)</script>&esc=1"); // 已转义
        server.stop(0);
        System.out.println("java.version=" + System.getProperty("java.version"));
    }
    static String query(String q, String k) {
        if (q == null) return "";
        for (String p : q.split("&")) {
            String[] kv = p.split("=", 2);
            if (kv.length == 2 && kv[0].equals(k)) return kv[1];
        }
        return "";
    }
    static void callRaw(String url) throws Exception {
        var r = java.net.http.HttpClient.newHttpClient().send(
            java.net.http.HttpRequest.newBuilder(java.net.URI.create(url)).GET().build(),
            java.net.http.HttpResponse.BodyHandlers.ofString());
        System.out.println("[HTTP] esc=" + query(url, "esc") + " -> " + r.body());
    }
}
"""


TOPIC = {
    "id": "untrusted-data",
    "order": 6,
    "name": "不可信数据防线",
    "subtitle": "外部输入不轻信：反序列化守白名单，输出前先转义",
    "glyph": "⊘",
    "family": "security",
    "runtime": "JDK + Jackson / Spring",
    "level": "进阶",
    "intent": (
        "不可信数据防线解决的是「外部进来的东西不能直接信任」："
        "一是反序列化会把 JSON / 字节流里的类型信息当成指令去实例化类，"
        "二是用户可控文本直接拼进 HTML 会被浏览器当代码执行（XSS）。"
        "两件事的共同点是「入口处的边界检查」，漏掉任一个都是高危漏洞。"
    ),
    "pickWhen": [
        {"vs": "直接 readValue 到 Object / 开启默认多态",
         "text": "JSON 来自外部（请求体 / 消息队列 / 文件）→ 必须绑定具体类型或严格白名单；绝不开 activateDefaultTyping"},
        {"vs": "把用户文本直接拼进 HTML",
         "text": "任何会渲染到页面的用户数据 → 先转义；模板引擎也要开自动转义，不能手拼标签"},
        {"vs": "信任上游「已经校验过」",
         "text": "跨信任边界的每一跳都要自己校验；上游的校验不代表你能省掉这一层"},
    ],
    "limits": [
        "白名单优于黑名单：允许清单短且明确，新增类型要显式加，而不是「除了 X 都放行」。",
        "转义要按上下文：HTML / JS / URL / CSS 各有不同转义规则，不能一套通吃。",
        "反序列化不是唯一入口：XML、YAML、原生 Java 序列化同样危险，原则一致。",
        "转义不能代替鉴权：XSS 防护不解决越权，两者是正交的两件事。",
    ],
    "references": [
        {"title": "OWASP · Deserialization Cheat Sheet",
         "url": "https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html",
         "note": "为什么不可信输入不能开多态反序列化，以及白名单做法"},
        {"title": "OWASP · XSS Prevention Cheat Sheet",
         "url": "https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html",
         "note": "按上下文转义（HTML/JS/URL）的正确做法"},
        {"title": "军火库规则集 · SECURITY 类",
         "note": "反序列化与输出转义的强制级条目出处"},
    ],
    "scenarios": [
        {
            "id": "safe-deserialization",
            "order": 1,
            "name": "反序列化不可信数据",
            "when": (
                "把外部 JSON / 字节流 / 消息还原成对象时——尤其来源是请求体、"
                "消息队列、文件或第三方系统，内容不在你的控制之内。"
            ),
            "signals": [
                "代码里有 ObjectMapper.enableDefaultTyping / activateDefaultTyping 对着外部输入",
                "用原生 ObjectInputStream.readObject() 读不可信字节",
                "反序列化目标类型是 Object 或带泛型的基类（「按类型名实例化」的入口）",
            ],
            "decision": "外部输入绝不开启多态类型自动解析；要么绑定到具体 DTO，要么用严格白名单 PolymorphicTypeValidator 限定允许的子类型。",
            "notSuitable": [
                "数据来自本进程内、类型完全可控（如自己序列化的缓存）——风险极低",
                "仅做 JSON 解析且始终绑定具体类型——本就安全",
                "纯文本 / CSV 解析——不涉及类型实例化",
            ],
            "recipes": [
                {
                    "id": "deser-allowlist",
                    "order": 1,
                    "name": "具体类型绑定 + 多态白名单",
                    "approach": (
                        "不开启默认多态，直接把外部 JSON 绑定到具体 DTO；"
                        "确实需要多态时，用 activateDefaultTyping + 严格白名单校验器，"
                        "只允许声明的少数子类型。"
                    ),
                    "flow": [
                        {"layer": "security", "step": "识别反序列化入口", "detail": "找出所有 readValue / readObject 对着外部输入的位置。"},
                        {"layer": "security", "step": "关闭多态自动解析", "detail": "默认不开 activateDefaultTyping；绑定到具体 DTO 类型。"},
                        {"layer": "security", "step": "必须多态则加白名单", "detail": "用 BasicPolymorphicTypeValidator 限定允许的子类型集合。"},
                    ],
                    "packages": [
                        "com.example.sec   SafeDeserialize（具体类型绑定 + 多态白名单）",
                    ],
                    "files": [
                        {
                            "id": "deser",
                            "path": "src/main/java/com/example/sec/SafeDeserialize.java",
                            "layer": "security", "lang": "java",
                            "role": "安全反序列化：绑定具体 DTO，不开多态。",
                            "code": SAFE_DESERIALIZE,
                            "highlights": [
                                {"mark": "return mapper.readValue(json, OrderDTO.class);",
                                 "title": "绑定具体类型，不开多态",
                                 "text": "目标类型是具体的 OrderDTO，JSON 里没有「按类型名实例化」的入口——攻击者无法借反序列化构造非预期类（SEC-DESER-001）。",
                                 "rule": "SEC-DESER-001"},
                                {"mark": "不开多态类型自动解析：不可信输入禁用一切「按类型名实例化」的入口",
                                 "title": "关闭多态类型自动解析",
                                 "text": "enableDefaultTyping / activateDefaultTyping 会让 Jackson 按 JSON 里的类型信息实例化任意类，是反序列化漏洞的根源；不可信输入一律不开。"},
                            ],
                        },
                    ],
                    "checklist": [
                        "确认所有对着外部输入的反序列化都不开启默认多态。",
                        "确认 readValue 的目标类型是具体 DTO，不是 Object 或泛型基类。",
                        "确认确需多态时用了 BasicPolymorphicTypeValidator 白名单，而非 LaissezFaire。",
                        "确认原生 Java 序列化（ObjectInputStream）也对不可信字节加了白名单 resolveClass。",
                    ],
                    "pitfalls": [
                        "enableDefaultTyping 对着外部 JSON：攻击者可用 @class 实例化 gadget 类，造成 RCE。",
                        "readValue 到 Object：等于敞开「按类型名实例化」的入口。",
                        "以为「只反序列化我自己的类就安全」：类名可被 JSON 里的类型信息替换。",
                        "用黑名单拦几个已知危险类：名单永远追不上新 gadget，白名单才是正解。",
                    ],
                    "relatedRules": ["SEC-DESER-001"],
                    "lab": {
                        "kind": "mock-endpoint",
                        "intro": "起一个假服务分别吐出「可信 Payload」与「不可信 Evil」的序列化字节；客户端用无白名单与带白名单的 ObjectInputStream 各读一次。",
                        "observe": [
                            "无白名单的 ObjectInputStream 能还原 /evil 里的 Evil 类（攻击者可借反序列化实例化任意 Serializable 类）",
                            "加白名单（SafeOIS）后，/evil 直接抛 InvalidClassException 拒绝；只有 /safe 的 Payload 被还原",
                        ],
                    },
                    "playground": [
                        {"id": "ud-deser",
                         "label": "反序列化白名单守卫",
                         "mainClass": "Main",
                         "note": "/safe 与 /evil 分别吐序列化字节，对比无白名单 vs 白名单 ObjectInputStream。",
                         "files": [{"path": "Main.java", "code": LAB_DESER}]},
                    ],
                },
            ],
        },
        {
            "id": "output-escaping",
            "order": 2,
            "name": "输出转义防注入",
            "when": (
                "把用户可控文本渲染进 HTML 页面、邮件模板或任何会被当代码解析的上下文时——"
                "这些数据来源不在你控制之内，可能含 <script> 等可被执行的片段。"
            ),
            "signals": [
                "模板里用 ${userInput} 直接拼进 HTML 标签内",
                "后端手工拼接 HTML 字符串返回（含用户输入）",
                "前端 innerHTML = 后端返回的用户字段",
            ],
            "decision": "用户数据写进 HTML/页面前必须按上下文转义（HTML/JS/URL 各异），用框架转义工具而非手拼标签。",
            "notSuitable": [
                "数据来自本系统、且已结构化存储（如数字 ID）——风险低但仍建议转义",
                "纯 JSON API（不带 HTML 渲染）——转义交给前端框架处理",
                "已经在可信白名单内的固定文案",
            ],
            "recipes": [
                {
                    "id": "escape-output",
                    "order": 1,
                    "name": "输出前转义用户数据",
                    "approach": (
                        "把用户可控数据写进 HTML 前用 HtmlUtils.htmlEscape（或 OWASP Encode.forHtml）转义，"
                        "模板引擎开启自动转义；不同上下文用对应转义规则。"
                    ),
                    "flow": [
                        {"layer": "security", "step": "识别输出点", "detail": "找出所有把用户数据拼进 HTML / 模板的位置。"},
                        {"layer": "security", "step": "按上下文转义", "detail": "HTML 用 htmlEscape，JS/URL/属性各有对应方法，不混用。"},
                        {"layer": "web", "step": "开启自动转义", "detail": "模板引擎默认自动转义，仅在确需原始 HTML 时显式关闭并二次审查。"},
                    ],
                    "packages": [
                        "com.example.sec   SafeView（输出转义）",
                    ],
                    "files": [
                        {
                            "id": "view",
                            "path": "src/main/java/com/example/sec/SafeView.java",
                            "layer": "security", "lang": "java",
                            "role": "输出转义：用户数据进 HTML 前先转义。",
                            "code": SAFE_VIEW,
                            "highlights": [
                                {"mark": "String safe = HtmlUtils.htmlEscape(userInput);",
                                 "title": "渲染前先转义",
                                 "text": "把 < > & 等转成 HTML 实体，用户输入里的 <script> 会变成纯文本显示，浏览器不执行（SEC-OUTPUT-001）。",
                                 "rule": "SEC-OUTPUT-001"},
                                {"mark": "// 危险：直接拼接未转义数据 —— return \"<div>你好，\" + userInput + \"</div>\";",
                                 "title": "禁止直接拼接未转义数据",
                                 "text": "未转义的用户文本直接进 HTML，<script> 会被当代码执行（XSS）；任何手写标签拼接都是隐患。"},
                            ],
                        },
                    ],
                    "checklist": [
                        "确认所有用户可控文本在进 HTML 前都经过转义。",
                        "确认转义按上下文区分（HTML/JS/URL/属性），没有一套通吃。",
                        "确认模板引擎自动转义已开启，未在不必要处关闭。",
                        "确认前端 innerHTML 来源也经过转义或来自可信结构。",
                    ],
                    "pitfalls": [
                        "模板里 ${userInput} 直接进 HTML：<script> 原样执行，XSS。",
                        "只用黑名单替换 <script：攻击者可用 <img onerror=>、<svg> 等绕过。",
                        "转义一次却用在不同上下文：HTML 转义后的串进 JS 仍可能被执行。",
                        "以为「前端框架会管」：服务端拼 HTML 的场景框架管不到，必须自己转义。",
                    ],
                    "relatedRules": ["SEC-OUTPUT-001"],
                    "lab": {
                        "kind": "mock-endpoint",
                        "intro": "起一个假服务 /reflect?name=<script>...&esc=0|1：esc=0 原样拼进 HTML，esc=1 先转义，对比响应体。",
                        "observe": [
                            "未转义（esc=0）：响应体保留 <script>alert(1)</script>，浏览器会执行（XSS）",
                            "已转义（esc=1）：< 被转成 &lt;，响应体变为纯文本，不执行",
                        ],
                    },
                    "playground": [
                        {"id": "ud-escape",
                         "label": "输出转义对照（XSS 防护）",
                         "mainClass": "Main",
                         "note": "/reflect?name=<script>&esc=0 未转义 vs esc=1 已转义，对比响应体。",
                         "files": [{"path": "Main.java", "code": LAB_ESCAPE}]},
                    ],
                },
            ],
        },
    ],
}
