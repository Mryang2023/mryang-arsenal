package com.arsenal.scan;

import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 代码结构扫描：包、分层、注解、路由、外部客户端。
 *
 * <b>用正则 + 极简词法，不引 JavaParser。</b>理由不是「先凑合」：
 * 这里要的是**统计与位置**（有几个 Controller、路由长什么样、谁调了谁），
 * 完整的 AST 换来的是我们并不需要的精度，代价是依赖、启动时间与失败模式都变复杂。
 * 真正需要类型解析的那层（「Controller 直接调了 Repository」是否真的成立）
 * 属于 AST 层，是另一个议题 —— 本类只报**能直接读到的**事实。
 *
 * 跨带直连（Controller → Repository）在图上画红色警示线，依据是本类输出的
 * {@code code.routes} 与 {@code code.layerCalls}：Controller 类里出现 Repository 类型的字段，
 * 就是一条直连 —— 这条**不猜**，字段名对得上才算。
 */
public final class CodeScanner {

    /** 只统计这些注解。全量统计会把 @Override 也算进来，那不是架构事实 */
    private static final List<String> WATCHED = List.of(
            "@RestController", "@Controller", "@Service", "@Repository", "@Component",
            "@Configuration", "@Bean", "@Scheduled", "@Async", "@Transactional",
            "@Cacheable", "@KafkaListener", "@FeignClient", "@RestControllerAdvice",
            "@ControllerAdvice", "@Mapper", "@Entity", "@Aspect");

    private static final Pattern ANNOTATION = Pattern.compile("@([A-Za-z][A-Za-z0-9_]*)");
    private static final Pattern MAPPING = Pattern.compile(
            "@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\\s*(\\(([^)]*)\\))?");
    private static final Pattern FEIGN = Pattern.compile("@FeignClient\\s*\\(([^)]*)\\)");
    private static final Pattern METHOD_DECL = Pattern.compile(
            "(public|protected|private)?\\s*[\\w<>\\[\\],\\s\\.\\?]+\\s+(\\w+)\\s*\\([^;]*\\)\\s*\\{?\\s*$");
    private static final Pattern CLASS_DECL = Pattern.compile(
            "(class|interface|record|enum)\\s+([A-Za-z][A-Za-z0-9_]*)");
    private static final Pattern FIELD_TYPE = Pattern.compile(
            "(?:private|protected|public)?\\s*(?:final\\s+)?([A-Z][A-Za-z0-9_]*)\\s+[a-z][A-Za-z0-9_]*\\s*;");
    private static final Pattern PACKAGE = Pattern.compile("^\\s*package\\s+([\\w.]+)\\s*;");

    private CodeScanner() {
    }

    public static ObjectNode scan(ScanContext ctx) {
        ObjectNode code = ctx.mapper().createObjectNode();
        Map<String, Integer> annotations = new TreeMap<>();
        Map<String, Integer> layers = new TreeMap<>();
        Map<String, Integer> packages = new TreeMap<>();
        List<Route> routes = new ArrayList<>();
        List<Client> clients = new ArrayList<>();
        List<DirectCall> directCalls = new ArrayList<>();
        List<EntryPoint> entryPoints = new ArrayList<>();

        for (Path p : ctx.files()) {
            ctx.tick();
            String rel = ctx.rel(p);
            if (!rel.endsWith(".java")) continue;
            List<String> lines = ctx.readLines(p);
            if (lines == null) continue;

            String pkg = null, className = null;
            List<String> classAnnotations = new ArrayList<>();
            boolean restController = false, controller = false, service = false,
                    repository = false, configuration = false;
            boolean springBoot = false, mainFound = false;
            int entryLine = -1;

            for (int i = 0; i < lines.size(); i += 1) {
                String raw = lines.get(i);
                String line = stripComment(raw);
                if (line.isBlank()) continue;

                // 可运行入口：main 方法（无框架 Java 应用也是入口，不只是 Spring Boot）
                if (entryLine < 0 && line.contains("public static void main(")) {
                    mainFound = true;
                    entryLine = i + 1;
                }

                if (pkg == null) {
                    Matcher pm = PACKAGE.matcher(line);
                    if (pm.find()) pkg = pm.group(1);
                }
                Matcher cm = CLASS_DECL.matcher(line);
                if (cm.find() && className == null) className = cm.group(2);

                Matcher am = ANNOTATION.matcher(line);
                while (am.find()) {
                    String ann = "@" + am.group(1);
                    if (WATCHED.contains(ann)) {
                        annotations.merge(ann, 1, Integer::sum);
                        if (!classAnnotations.contains(ann)) classAnnotations.add(ann);
                    }
                    switch (ann) {
                        case "@RestController" -> restController = true;
                        case "@Controller" -> controller = true;
                        case "@Service" -> service = true;
                        case "@Repository", "@Mapper" -> repository = true;
                        case "@Configuration" -> configuration = true;
                        default -> {
                            // 其余只计数
                        }
                    }
                    // @SpringBootApplication **不进 WATCHED**（那会扰动全局注解计数），
                    // 但它是最硬的「这是一个可运行服务」信号，单独记
                    if (ann.equals("@SpringBootApplication")) {
                        springBoot = true;
                        if (entryLine < 0) entryLine = i + 1;
                    }
                }

                // 路由：注解上的路径 + 紧随其后的方法名
                Matcher mm = MAPPING.matcher(line);
                if (mm.find()) {
                    String ann = mm.group(1);
                    String args = mm.group(3) == null ? "" : mm.group(3);
                    String path = firstString(args);
                    String method = switch (ann) {
                        case "GetMapping" -> "GET";
                        case "PostMapping" -> "POST";
                        case "PutMapping" -> "PUT";
                        case "DeleteMapping" -> "DELETE";
                        case "PatchMapping" -> "PATCH";
                        default -> requestMethodOf(args);
                    };
                    String handler = lookAheadMethod(lines, i);
                    routes.add(new Route(method, path, (className == null ? "?" : className) + "#" + handler, rel, i + 1));
                }

                Matcher fm = FEIGN.matcher(line);
                if (fm.find()) {
                    clients.add(new Client("feign", firstNamedArg(fm.group(1), "name", "value"), rel, i + 1));
                }
                if (line.contains("new RestTemplate(") || line.contains("RestTemplate ")) {
                    clients.add(new Client("resttemplate", null, rel, i + 1));
                }
                if (line.contains("WebClient.builder") || line.contains("WebClient ")) {
                    clients.add(new Client("webclient", null, rel, i + 1));
                }
            }

            // 分层：注解优先，其次类名后缀，最后看包名
            String layer = classify(restController, controller, service, repository, configuration, className, pkg);
            if (layer != null) layers.merge(layer, 1, Integer::sum);

            // 可运行入口登记：有 @SpringBootApplication 或 main 就算。
            // 两者都有时 runtime 记 spring-boot（更具体），行号取先出现的那个
            if (springBoot || mainFound) {
                entryPoints.add(new EntryPoint(rel, entryLine > 0 ? entryLine : 1, pkg, className,
                        springBoot ? "spring-boot" : "main"));
            }

            // 跨带直连：Controller 里出现 *Repository / *Mapper / *Dao 类型的字段
            if ((restController || controller) && className != null) {
                for (String line : lines) {
                    Matcher ft = FIELD_TYPE.matcher(stripComment(line));
                    if (ft.find()) {
                        String type = ft.group(1);
                        if (type.endsWith("Repository") || type.endsWith("Mapper") || type.endsWith("Dao")) {
                            directCalls.add(new DirectCall(className, type, rel));
                        }
                    }
                }
            }

            // 包：只取前三层，避免把深目录全列出来
            if (pkg != null) {
                String[] seg = pkg.split("\\.");
                StringBuilder sb = new StringBuilder();
                int n = Math.min(3, seg.length);
                for (int s = 0; s < n; s += 1) {
                    if (s > 0) sb.append('/');
                    sb.append(seg[s]);
                }
                packages.merge(sb.toString(), 1, Integer::sum);
            }
        }

        ObjectNode ann = code.putObject("annotations");
        annotations.forEach(ann::put);
        ObjectNode lay = code.putObject("layers");
        layers.forEach(lay::put);
        ArrayNode pkgs = code.putArray("packages");
        packages.entrySet().stream()
                .sorted(Map.Entry.<String, Integer>comparingByKey())
                .forEach(e -> pkgs.addObject().put("path", e.getKey()).put("files", e.getValue()));

        ArrayNode r = code.putArray("routes");
        routes.stream()
                .sorted((a, b) -> a.path.equals(b.path) ? a.method.compareTo(b.method) : a.path.compareTo(b.path))
                .forEach(x -> {
                    ObjectNode n = r.addObject();
                    n.put("method", x.method);
                    n.put("path", x.path);
                    n.put("handler", x.handler);
                    n.put("file", x.file);
                    n.put("line", x.line);
                });

        ArrayNode c = code.putArray("clients");
        clients.stream()
                .sorted((a, b) -> a.kind.equals(b.kind) ? a.file.compareTo(b.file) : a.kind.compareTo(b.kind))
                .forEach(x -> {
                    ObjectNode n = c.addObject();
                    n.put("kind", x.kind);
                    if (x.target == null) n.putNull("target");
                    else n.put("target", x.target);
                    n.put("file", x.file);
                    n.put("line", x.line);
                });

        ArrayNode d = code.putArray("directCalls");
        directCalls.stream()
                .sorted((a, b) -> a.from.equals(b.from) ? a.to.compareTo(b.to) : a.from.compareTo(b.from))
                .forEach(x -> {
                    ObjectNode n = d.addObject();
                    n.put("from", x.from);
                    n.put("to", x.to);
                    n.put("file", x.file);
                });

        // 可运行入口（服务计数的代码侧信号）。读不到 package / 类名就写 null ——
        // 没有入口的仓库是 0 条，那本身是个结论，不许拿别的类凑
        ArrayNode eps = code.putArray("entryPoints");
        entryPoints.stream()
                .sorted((a, b) -> a.file().equals(b.file()) ? Integer.compare(a.line(), b.line()) : a.file().compareTo(b.file()))
                .forEach(x -> {
                    ObjectNode n = eps.addObject();
                    n.put("file", x.file());
                    n.put("line", x.line());
                    if (x.pkg() != null) n.put("package", x.pkg());
                    else n.putNull("package");
                    if (x.className() != null) n.put("className", x.className());
                    else n.putNull("className");
                    n.put("runtime", x.runtime());
                });

        // 去重后的客户端（同一个 kind+target 只留一条），给图上用
        ArrayNode uniq = code.putArray("clientsUnique");
        Map<String, Client> seen = new LinkedHashMap<>();
        for (Client x : clients) {
            seen.putIfAbsent(x.kind + "|" + x.target, x);
        }
        seen.values().stream()
                .sorted((a, b) -> (a.kind + a.target).compareTo(b.kind + b.target))
                .forEach(x -> {
                    ObjectNode n = uniq.addObject();
                    n.put("kind", x.kind);
                    if (x.target == null) n.putNull("target");
                    else n.put("target", x.target);
                });
        return code;
    }

    private static String classify(boolean rest, boolean ctrl, boolean svc, boolean repo, boolean conf,
                                   String className, String pkg) {
        if (rest || ctrl) return "controller";
        if (svc) return "service";
        if (repo) return "repository";
        if (conf) return "config";
        if (className != null) {
            if (className.endsWith("Service") || className.endsWith("ServiceImpl")) return "service";
            if (className.endsWith("Repository") || className.endsWith("Mapper") || className.endsWith("Dao")) {
                return "repository";
            }
            if (className.endsWith("Controller")) return "controller";
            if (className.endsWith("Config") || className.endsWith("Configuration")) return "config";
        }
        if (pkg != null && (pkg.contains(".domain") || pkg.contains(".entity") || pkg.contains(".model")
                || pkg.contains(".dto") || pkg.contains(".vo"))) {
            return "domain";
        }
        return null;
    }

    /** 去掉行注释与块注释行。注释里的 `@Something` 不是注解，之前踩过这个坑（规则引擎同款） */
    private static String stripComment(String raw) {
        String t = raw.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return "";
        int idx = t.indexOf("//");
        if (idx > 0) return t.substring(0, idx);
        return t;
    }

    private static String firstString(String args) {
        Matcher m = Pattern.compile("\"([^\"]*)\"").matcher(args);
        return m.find() ? m.group(1) : "";
    }

    private static String requestMethodOf(String args) {
        Matcher m = Pattern.compile("RequestMethod\\.(\\w+)").matcher(args);
        return m.find() ? m.group(1) : "ANY";
    }

    private static String firstNamedArg(String args, String... names) {
        for (String n : names) {
            Matcher m = Pattern.compile(n + "\\s*=\\s*\"([^\"]+)\"").matcher(args);
            if (m.find()) return m.group(1);
        }
        Matcher m = Pattern.compile("\"([^\"]+)\"").matcher(args);
        return m.find() ? m.group(1) : null;
    }

    /** 从注解行的下一行开始找方法声明。找不到就写 ?，不猜 */
    private static String lookAheadMethod(List<String> lines, int from) {
        for (int i = from + 1; i < Math.min(lines.size(), from + 6); i += 1) {
            String line = stripComment(lines.get(i));
            if (line.isBlank() || line.startsWith("@")) continue;
            Matcher m = METHOD_DECL.matcher(line);
            if (m.find()) return m.group(2);
        }
        return "?";
    }

    private record Route(String method, String path, String handler, String file, int line) {
    }

    private record Client(String kind, String target, String file, int line) {
    }

    private record DirectCall(String from, String to, String file) {
    }

    private record EntryPoint(String file, int line, String pkg, String className, String runtime) {
    }
}
