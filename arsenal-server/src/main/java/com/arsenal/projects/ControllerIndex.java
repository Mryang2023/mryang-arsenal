package com.arsenal.projects;

import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Controller 索引 · <b>只读源码</b>。
 *
 * <p>回答一个问题：**这个模块现在对外暴露了哪些接口**。模块看板第 ④ 步和
 * {@code apidoc.mjs verify} 都靠它 —— 前者看「后端写没写」，后者看「文档对不对得上」。
 * 两处共用同一份解析，避免页面说「有 5 个接口」而 CLI 说「4 个」。
 *
 * <p>为什么用正则而不是 AST：军火库不引 JavaParser（体积 + 版本），而 Controller 的
 * 注解形态高度固定 —— {@code @RequestMapping}/{@code @XxxMapping} + {@code public} 方法。
 * 解析口径刻意保守：
 * <ul>
 *   <li>只认类级 {@code @RequestMapping} 的最后一次出现，不追继承链（Controller 不继承 Controller）。</li>
 *   <li>方法窗口 = 上一个方法签名之后到本方法签名之前；窗口里取<b>最后一条</b>映射注解 ——
 *       它离签名最近，就是本方法的。注解顺序（{@code @Operation} 在前在后）不影响。</li>
 *   <li>路径只取第一个字符串字面量（或 {@code {"a","b"}} 里的全部）。
 *       {@code produces = "application/json"} 这类参数不会被误当路径。</li>
 *   <li>解析不出来的不猜：没有映射注解的 public 方法直接跳过，不会凭空造一个接口。</li>
 * </ul>
 *
 * <p>本类不缓存、不写文件。一次请求走一遍源码，几十个 Controller 是毫秒级。
 */
public final class ControllerIndex {

    /** 单文件上限。Controller 正常几 KB，超过这个数基本是别的文件。 */
    private static final int MAX_FILE_BYTES = 256 * 1024;

    private static final Pattern CLASS_DECL =
            Pattern.compile("\\bclass\\s+([A-Za-z_$][A-Za-z0-9_$]*)");
    /**
     * public 方法签名。返回类型允许泛型/数组/全限定名，方法名后必须紧跟 {@code (}。
     * 构造器（{@code public Foo(}）没有返回类型，因此不会命中。
     */
    private static final Pattern METHOD_DECL = Pattern.compile(
            "\\bpublic\\s+(?:static\\s+)?(?:final\\s+)?[A-Za-z0-9_$<>\\[\\],.\\s]+?\\s+([A-Za-z_$][A-Za-z0-9_$]*)\\s*\\(");
    private static final Pattern MAPPING =
            Pattern.compile("@(Get|Post|Put|Delete|Patch|Request)Mapping\\b");
    private static final Pattern TAG =
            Pattern.compile("@Tag\\s*\\(\\s*name\\s*=\\s*\"([^\"]*)\"");
    private static final Pattern SUMMARY =
            Pattern.compile("@Operation\\s*\\([^)]*?summary\\s*=\\s*\"([^\"]*)\"", Pattern.DOTALL);
    private static final Pattern PERMISSION =
            Pattern.compile("hasAuthority\\s*\\(\\s*'([^']+)'\\s*\\)");
    private static final Pattern SA_PERMISSION =
            Pattern.compile("@SaCheckPermission\\s*\\(\\s*(?:value\\s*=\\s*)?\"([^\"]+)\"");
    private static final Pattern STRING_LITERAL = Pattern.compile("\"([^\"]*)\"");
    private static final Pattern REQUEST_METHOD =
            Pattern.compile("RequestMethod\\.([A-Z]+)");
    private static final Pattern PACKAGE =
            Pattern.compile("^\\s*package\\s+([A-Za-z0-9_.]+)\\s*;", Pattern.MULTILINE);

    private ControllerIndex() {
    }

    /**
     * 扫全仓 Controller。
     *
     * <p>返回的每个节点：
     * <pre>{@code
     * {
     *   "file": "module/module-customer/.../CustomerController.java",
     *   "class": "CustomerController",
     *   "tag": "客户管理",
     *   "base": "/customer",
     *   "module": "customer",
     *   "endpoints": [
     *     {"method":"GET","path":"/customer/page","docPath":"/api/customer/page",
     *      "summary":"分页","permission":"customer:customer:page"}
     *   ]
     * }
     * }</pre>
     */
    public static ArrayNode scan(Path repo, ObjectMapper mapper) {
        ArrayNode out = mapper.createArrayNode();
        if (repo == null || !Files.isDirectory(repo)) return out;

        List<Path> files = new ArrayList<>();
        try (Stream<Path> s = Files.walk(repo, 32)) {
            s.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().endsWith(".java"))
                    .filter(p -> {
                        String r = rel(repo, p);
                        return !r.contains("/target/") && !r.startsWith("target/")
                                && !r.contains("/node_modules/");
                    })
                    .forEach(files::add);
        } catch (IOException e) {
            return out;
        }
        files.sort(Comparator.comparing(Path::toString));

        for (Path f : files) {
            ObjectNode c = parseFile(repo, f, mapper);
            if (c != null) out.add(c);
        }
        return out;
    }

    // ─────────────────────────────────────────────────────────────

    private static ObjectNode parseFile(Path repo, Path f, ObjectMapper mapper) {
        String text;
        try {
            if (Files.size(f) > MAX_FILE_BYTES) return null;
            text = Files.readString(f, StandardCharsets.UTF_8);
        } catch (IOException e) {
            return null;
        }
        if (!text.contains("@RestController") && !text.contains("@Controller")) return null;

        Matcher cm = CLASS_DECL.matcher(text);
        if (!cm.find()) return null;
        String className = cm.group(1);
        int classAt = cm.start();

        String base = findLastMapping(text, 0, classAt);
        base = normalize(base);

        String module = firstSegment(base);
        if (module.isEmpty()) module = moduleFromPackage(text);
        if (module.isEmpty()) module = "unknown";

        ObjectNode c = mapper.createObjectNode();
        c.put("file", rel(repo, f));
        c.put("class", className);
        c.put("tag", lastGroup(TAG, text));
        c.put("base", base);
        c.put("module", module);

        ArrayNode endpoints = c.putArray("endpoints");
        List<int[]> signatures = new ArrayList<>();
        Matcher mm = METHOD_DECL.matcher(text);
        while (mm.find()) {
            if (mm.start() < classAt) continue;
            signatures.add(new int[]{mm.start(), mm.end()});
        }

        int windowStart = classAt;
        for (int[] sig : signatures) {
            int from = windowStart;
            int to = sig[0];
            windowStart = sig[1];

            Mapping m = findLastMappingInfo(text, from, to);
            if (m == null) continue; // public 方法但不是接口（工具方法等）

            String summary = lastGroup(SUMMARY, text.substring(from, to));
            String permission = lastPermission(text.substring(from, to));

            for (String sub : m.paths) {
                String path = join(base, sub);
                ObjectNode e = endpoints.addObject();
                e.put("method", m.method);
                e.put("path", path);
                e.put("docPath", "/api" + (path.equals("/") ? "" : path));
                e.put("summary", summary);
                e.put("permission", permission);
            }
        }
        return c;
    }

    /** 类级映射：取类声明之前最后一次。 */
    private static String findLastMapping(String text, int from, int to) {
        Mapping m = findLastMappingInfo(text, from, to);
        return m == null || m.paths.isEmpty() ? "" : m.paths.get(0);
    }

    private static Mapping findLastMappingInfo(String text, int from, int to) {
        if (to <= from) return null;
        String window = text.substring(from, to);
        Matcher m = MAPPING.matcher(window);
        Mapping last = null;
        while (m.find()) {
            int after = m.end();
            // 跳过空白，若紧跟 '(' 则取到配对右括号
            int i = after;
            while (i < window.length() && Character.isWhitespace(window.charAt(i))) i++;
            String args = "";
            if (i < window.length() && window.charAt(i) == '(') {
                int end = matchingParen(window, i);
                if (end > 0) args = window.substring(i + 1, end);
            }
            String verb = m.group(1).toUpperCase(Locale.ROOT);
            if (verb.equals("REQUEST")) {
                Matcher rm = REQUEST_METHOD.matcher(args);
                verb = rm.find() ? rm.group(1) : "ANY";
            }
            last = new Mapping(verb, pathArgs(args));
        }
        return last;
    }

    /**
     * 提取映射路径。{@code {"a","b"}} 取全部；否则只取第一个字符串字面量。
     * 空注解（{@code @GetMapping}）返回一个空串 —— 表示只挂在类级路径上。
     */
    private static List<String> pathArgs(String args) {
        String a = args.trim();
        if (a.isEmpty()) return List.of("");
        if (a.startsWith("{")) {
            int end = a.indexOf('}');
            a = end > 0 ? a.substring(0, end) : a;
            List<String> out = new ArrayList<>();
            Matcher m = STRING_LITERAL.matcher(a);
            while (m.find()) out.add(m.group(1));
            return out.isEmpty() ? List.of("") : out;
        }
        Matcher m = STRING_LITERAL.matcher(a);
        return m.find() ? List.of(m.group(1)) : List.of("");
    }

    /** 从 {@code '('} 起找配对右括号，字符串内的括号不算。 */
    private static int matchingParen(String s, int open) {
        int depth = 0;
        boolean inString = false;
        for (int i = open; i < s.length(); i++) {
            char ch = s.charAt(i);
            if (ch == '"' && (i == 0 || s.charAt(i - 1) != '\\')) inString = !inString;
            if (inString) continue;
            if (ch == '(') depth++;
            else if (ch == ')') {
                depth--;
                if (depth == 0) return i;
            }
        }
        return -1;
    }

    private static String lastPermission(String window) {
        String p = lastGroup(PERMISSION, window);
        if (!p.isEmpty()) return p;
        return lastGroup(SA_PERMISSION, window);
    }

    private static String lastGroup(Pattern p, String text) {
        Matcher m = p.matcher(text);
        String last = "";
        while (m.find()) last = m.group(1);
        return last;
    }

    private static String moduleFromPackage(String text) {
        Matcher m = PACKAGE.matcher(text);
        if (!m.find()) return "";
        String[] parts = m.group(1).split("\\.");
        for (int i = 0; i < parts.length - 1; i++) {
            if (parts[i].equals("iems")) {
                String next = parts[i + 1];
                return next.equals("controller") ? "" : next;
            }
        }
        return "";
    }

    /** 拼路径：两段都归一化，去掉重复斜杠与末尾斜杠。 */
    static String join(String base, String sub) {
        String b = normalize(base);
        String s = sub == null ? "" : sub.trim();
        if (s.isEmpty()) return b;
        if (!s.startsWith("/")) s = "/" + s;
        String joined = normalize(b + s);
        return joined.isEmpty() ? "/" : joined;
    }

    static String normalize(String p) {
        if (p == null) return "";
        String s = p.trim();
        int q = s.indexOf('?');
        if (q >= 0) s = s.substring(0, q);
        s = s.replace('\\', '/').replaceAll("/{2,}", "/");
        if (!s.isEmpty() && !s.startsWith("/")) s = "/" + s;
        if (s.length() > 1 && s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }

    private static String firstSegment(String path) {
        String p = normalize(path);
        if (p.length() <= 1) return "";
        int slash = p.indexOf('/', 1);
        return (slash < 0 ? p.substring(1) : p.substring(1, slash)).toLowerCase(Locale.ROOT);
    }

    private static String rel(Path repo, Path p) {
        return repo.relativize(p).toString().replace('\\', '/');
    }

    private record Mapping(String method, List<String> paths) {
    }
}
