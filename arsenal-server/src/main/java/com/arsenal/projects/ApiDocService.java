package com.arsenal.projects;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 接口文档 · <b>只生成初稿、只做对账</b>。
 *
 * <p>IEMS 的接口文档是<b>对外交付物</b>（交给配合的前端同事），所以它不能是「写完就烂」的
 * 自由文档：代码加了接口、文档没加，前端就白等一天。这里只做两件事：
 * <ol>
 *   <li>{@link #plan} —— 从 Controller 的映射注解生成 Markdown / OpenAPI <b>初稿</b>，
 *       正文放在响应里，人在编辑器里补全后提交。军火库<b>不写 IEMS 的任何文件</b>。</li>
 *   <li>{@link #verify} —— 代码里的接口 vs 文档里的 {@code **Method / Path**} 行，
 *       报 0 缺失 / 0 多余。这是模块看板第 ⑤ 步的闸门。</li>
 * </ol>
 *
 * <p>对账口径：
 * <ul>
 *   <li>代码侧路径来自 {@link ControllerIndex}（后端路径，不带 {@code /api}）。</li>
 *   <li>文档侧路径必须写在 {@code - **Method / Path**：`GET /api/...`} 这一行里，
 *       比较时去掉 {@code /api} 前缀、忽略末尾斜杠与查询串。</li>
 *   <li>{@code @RequestMapping} 没写 method 的接口记为 {@code ANY}，可按任意方法匹配；
 *       它通常意味着「这个接口没想清楚该用哪个动词」，会在 warnings 里单独提示。</li>
 * </ul>
 */
public final class ApiDocService {

    /** 文档里机器可读的路径行。宽容一点：冒号中英文都认，反引号可有可无。 */
    private static final Pattern DOC_ENDPOINT = Pattern.compile(
            "\\*\\*Method\\s*/\\s*Path\\*\\*\\s*[：:]\\s*`?\\s*"
                    + "(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\\s+([^\\s`|]+)\\s*`?",
            Pattern.CASE_INSENSITIVE);

    private final ObjectMapper mapper;

    public ApiDocService(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    // ─────────────────────────────────────────────────────────────
    // 对账
    // ─────────────────────────────────────────────────────────────

    public ObjectNode verify(Path repo, String module) {
        ObjectNode out = base("verify", module);
        ArrayNode notes = out.putArray("notes");
        ArrayNode endpoints = selectEndpoints(repo, module, notes);

        String mdPath = "docs/api/" + module + ".md";
        String oasPath = "docs/api/" + module + ".openapi.json";
        boolean mdPresent = Files.isRegularFile(repo.resolve(mdPath));
        boolean oasPresent = Files.isRegularFile(repo.resolve(oasPath));

        // 代码侧：以 "方法 路径" 为键。ANY 另外记一份，匹配时放宽。
        Map<String, ObjectNode> code = new LinkedHashMap<>();
        Set<String> codePaths = new LinkedHashSet<>();
        Set<String> codeAnyPaths = new LinkedHashSet<>();
        ArrayNode controllers = mapper.createArrayNode();
        Set<String> controllerFiles = new LinkedHashSet<>();
        for (JsonNode e : endpoints) {
            String method = e.path("method").asText("").toUpperCase(Locale.ROOT);
            String path = ControllerIndex.normalize(e.path("path").asText(""));
            codePaths.add(path);
            if (method.equals("ANY")) codeAnyPaths.add(path);
            code.put(method + " " + path, (ObjectNode) e);
            String file = e.path("file").asText("");
            if (controllerFiles.add(file)) {
                ObjectNode c = controllers.addObject();
                c.put("file", file);
                c.put("class", e.path("class").asText(""));
                c.put("tag", e.path("tag").asText(""));
                c.put("base", e.path("base").asText(""));
            }
        }

        // 文档侧
        List<DocEndpoint> docEndpoints = mdPresent ? readDocEndpoints(repo.resolve(mdPath)) : List.of();
        Set<String> docKeys = new LinkedHashSet<>();
        for (DocEndpoint d : docEndpoints) {
            docKeys.add(d.method + " " + docKeyPath(d.path));
        }

        ArrayNode matched = out.putArray("matched");
        ArrayNode missing = out.putArray("missing");
        ArrayNode extra = out.putArray("extra");

        // 文档侧按路径建一份索引：@RequestMapping 不写 method 的接口要能按任意动词匹配。
        Set<String> docPaths = new LinkedHashSet<>();
        for (DocEndpoint d : docEndpoints) docPaths.add(docKeyPath(d.path));

        for (Map.Entry<String, ObjectNode> en : code.entrySet()) {
            String key = en.getKey();
            boolean hit = docKeys.contains(key)
                    || (key.startsWith("ANY ") && docPaths.contains(key.substring(4)));
            if (hit) {
                ObjectNode m = matched.addObject();
                m.put("method", key.substring(0, key.indexOf(' ')));
                m.put("path", key.substring(key.indexOf(' ') + 1));
                m.put("summary", en.getValue().path("summary").asText(""));
            } else {
                missing.add(endpointRow(en.getValue()));
            }
        }
        // 文档写了、代码里没有：方法同路径不同（GET vs POST）也要报，那通常是文档抄错。
        for (DocEndpoint d : docEndpoints) {
            String key = d.method + " " + docKeyPath(d.path);
            boolean hit = code.containsKey(key)
                    || codeAnyPaths.contains(docKeyPath(d.path));
            if (!hit) {
                ObjectNode x = extra.addObject();
                x.put("method", d.method);
                x.put("path", d.path);
                x.put("line", d.line);
            }
        }

        ObjectNode codeStat = out.putObject("code");
        codeStat.set("controllers", controllers);
        codeStat.put("controllerCount", controllers.size());
        codeStat.put("endpointCount", endpoints.size());
        ArrayNode paths = codeStat.putArray("paths");
        codePaths.forEach(paths::add);

        ObjectNode doc = out.putObject("doc");
        ObjectNode md = doc.putObject("markdown");
        md.put("present", mdPresent);
        md.put("path", mdPath);
        md.put("endpointCount", docEndpoints.size());
        ObjectNode oas = doc.putObject("openapi");
        oas.put("present", oasPresent);
        oas.put("path", oasPath);
        oas.put("endpointCount", 0);
        if (oasPresent) {
            fillOpenApiStat(repo.resolve(oasPath), oas, code, notes);
        }

        ObjectNode summary = out.putObject("summary");
        summary.put("codeEndpoints", endpoints.size());
        summary.put("docEndpoints", docEndpoints.size());
        summary.put("matched", matched.size());
        summary.put("missing", missing.size());
        summary.put("extra", extra.size());

        boolean bothFiles = mdPresent && oasPresent;
        boolean aligned = missing.isEmpty() && extra.isEmpty();
        String status;
        if (!mdPresent) status = "missing";
        else if (endpoints.isEmpty()) status = "incomplete";
        else if (bothFiles && aligned) status = "ok";
        else status = "incomplete";
        out.put("status", status);
        out.put("ok", status.equals("ok"));

        if (!mdPresent) {
            warn(notes, "DOC_MISSING", mdPath + " 不存在 —— 前端同事现在拿不到这个模块的接口说明。");
        }
        if (!oasPresent) {
            warn(notes, "OPENAPI_MISSING", oasPath + " 不存在 —— Markdown 与 OpenAPI 是同一对交付物。");
        }
        if (endpoints.isEmpty()) {
            warn(notes, "NO_CONTROLLER", "Controller 里没有找到 " + module + " 的接口；"
                    + "如果模块还没开始写后端，这一步本来就该是空的。");
        }
        if (!aligned) {
            warn(notes, "DOC_DRIFT", "代码与文档对不上：缺 " + missing.size()
                    + " 个、多 " + extra.size() + " 个。接口变更必须与文档同一次提交。");
        }
        return out;
    }

    /** 只读 OpenAPI 附件：统计 paths，并与代码路径对账（附件里不该有代码没有的路径）。 */
    private void fillOpenApiStat(Path file, ObjectNode oas, Map<String, ObjectNode> code, ArrayNode notes) {
        try {
            JsonNode root = mapper.readTree(file.toFile());
            JsonNode paths = root.path("paths");
            int count = 0;
            ArrayNode extra = mapper.createArrayNode();
            if (paths.isObject()) {
                Set<String> anyPaths = new LinkedHashSet<>();
                for (String k : code.keySet()) {
                    if (k.startsWith("ANY ")) anyPaths.add(k.substring(4));
                }
                for (String p : paths.propertyNames()) {
                    JsonNode item = paths.path(p);
                    for (String method : List.of("get", "post", "put", "delete", "patch")) {
                        if (!item.has(method)) continue;
                        count++;
                        String norm = ControllerIndex.normalize(p);
                        String key = method.toUpperCase(Locale.ROOT) + " " + norm;
                        if (!code.containsKey(key) && !anyPaths.contains(norm)) {
                            extra.add(method.toUpperCase(Locale.ROOT) + " " + p);
                        }
                    }
                }
            }
            oas.put("endpointCount", count);
            oas.set("extra", extra);
            if (extra.size() > 0) {
                warn(notes, "OPENAPI_DRIFT",
                        "OpenAPI 里有 " + extra.size() + " 个代码里不存在的接口（多半是删接口时忘了改附件）。");
            }
        } catch (Exception e) {
            oas.put("readable", false);
            oas.put("error", e.getMessage());
            warn(notes, "OPENAPI_UNREADABLE", "OpenAPI 附件读不了：" + e.getMessage());
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 生成初稿
    // ─────────────────────────────────────────────────────────────

    public ObjectNode plan(Path repo, String module) {
        ObjectNode out = base("plan", module);
        ArrayNode notes = out.putArray("notes");
        ArrayNode endpoints = selectEndpoints(repo, module, notes);

        ObjectNode plan = mapper.createObjectNode();
        String date = OffsetDateTime.now(ZoneOffset.ofHours(8)).toLocalDate().toString();
        String planId = java.time.OffsetDateTime.now(ZoneOffset.ofHours(8))
                .format(java.time.format.DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss"))
                + "-" + module + "-apidoc";

        plan.put("schemaVersion", 1);
        plan.put("planId", planId);
        plan.put("generatedAt", OffsetDateTime.now(ZoneOffset.ofHours(8)).toString());
        plan.put("writes", false);
        plan.put("note", "只生成初稿：军火库不写被管理项目的任何文件。正文由人复制到 docs/api/ 后补全。");
        plan.put("module", module);
        plan.put("date", date);

        ObjectNode codeStat = plan.putObject("code");
        codeStat.put("endpointCount", endpoints.size());
        ArrayNode controllers = codeStat.putArray("controllers");
        Set<String> seen = new LinkedHashSet<>();
        for (JsonNode e : endpoints) {
            if (seen.add(e.path("file").asText(""))) {
                ObjectNode c = controllers.addObject();
                c.put("file", e.path("file").asText(""));
                c.put("class", e.path("class").asText(""));
                c.put("base", e.path("base").asText(""));
            }
        }

        String md = renderMarkdown(module, date, endpoints, notes);
        String json = renderOpenApi(module, endpoints);

        ObjectNode artifacts = plan.putObject("artifacts");
        artifacts.set("markdown", artifact("docs/api/" + module + ".md", "create", md));
        artifacts.set("openapi", artifact("docs/api/" + module + ".openapi.json", "create", json));

        ObjectNode stats = plan.putObject("stats");
        stats.put("endpoints", endpoints.size());
        stats.put("controllers", controllers.size());
        stats.put("resources", resourceGroups(endpoints).size());
        stats.put("withPermission", countWithPermission(endpoints));
        stats.put("withSummary", countWithSummary(endpoints));

        out.set("plan", plan);
        return out;
    }

    private ObjectNode artifact(String path, String action, String content) {
        ObjectNode a = mapper.createObjectNode();
        a.put("path", path);
        a.put("action", action);
        a.put("content", content);
        return a;
    }

    // ─────────────────────────────────────────────────────────────
    // 渲染
    // ─────────────────────────────────────────────────────────────

    private String renderMarkdown(String module, String date, ArrayNode endpoints, ArrayNode notes) {
        StringBuilder sb = new StringBuilder();
        sb.append("# ").append(module).append(" · 接口文档\n\n");
        sb.append("> 模块：`").append(module).append("` ｜ 前端 base：`/api` ｜ 更新：").append(date)
                .append(" ｜ 维护：待补充\n");
        sb.append("> 由军火库按 `docs/api/README.md` 从 Controller 生成初稿；标「待补充」的地方需人工补全。\n\n");

        sb.append("## 0. 通用约定\n\n");
        sb.append("- **认证**：请求头 `Authorization: <token>`；Token 失效返回 `401`。\n");
        sb.append("- **返回体**：`{ \"code\": 0, \"msg\": \"success\", \"data\": {} }`，成功判据是 `code === 0`。\n");
        sb.append("- **分页请求**：`page`（从 1 开始）、`limit`（1—1000）、`order`、`asc`。\n");
        sb.append("- **分页响应**：`{ \"code\": 0, \"msg\": \"success\", \"data\": { \"total\": 0, \"list\": [] } }`。\n");
        sb.append("- **时间格式**：日期 `yyyy-MM-dd`，日期时间 `yyyy-MM-dd HH:mm:ss`，时区 `Asia/Shanghai`。\n\n");

        if (endpoints.isEmpty()) {
            sb.append("> 还没有接口：Controller 里没有找到 `").append(module).append("` 的映射。\n");
            return sb.toString();
        }

        Map<String, List<JsonNode>> groups = resourceGroups(endpoints);
        int section = 1;
        int seq = 1;
        for (Map.Entry<String, List<JsonNode>> g : groups.entrySet()) {
            sb.append("## ").append(section++).append(". ").append(g.getKey()).append("\n\n");
            for (JsonNode e : g.getValue()) {
                String summary = e.path("summary").asText("");
                String perm = e.path("permission").asText("");
                String method = e.path("method").asText("");
                String docPath = e.path("docPath").asText("");
                sb.append("### ").append(section - 1).append(".").append(seq++).append(" ")
                        .append(summary.isEmpty() ? method + " " + docPath : summary).append("\n\n");
                sb.append("- **Method / Path**：`").append(method).append(" ").append(docPath).append("`\n");
                sb.append("- **权限码**：`").append(perm.isEmpty() ? "待补充" : perm).append("`\n");
                sb.append("- **说明**：").append(summary.isEmpty() ? "待补充" : summary).append("\n\n");
                sb.append("#### 请求参数\n\n");
                sb.append("| 参数 | 位置 | 类型 | 必填 | 说明 | 示例 |\n|---|---|---|---|---|---|\n");
                sb.append("| 待补充 | query | string | 否 | | |\n\n");
                sb.append("#### 响应字段\n\n");
                sb.append("| 字段 | 类型 | 说明 |\n|---|---|---|\n");
                sb.append("| 待补充 | | |\n\n");
                sb.append("#### 错误码\n\n");
                sb.append("| code | 含义 | 触发条件 |\n|---|---|---|\n\n");
                sb.append("#### 示例\n\n");
                sb.append("```json\n{ \"code\": 0, \"msg\": \"success\", \"data\": {} }\n```\n\n");
            }
        }

        sb.append("## ").append(section).append(". 接口明细（速查）\n\n");
        sb.append("> 军火库 `apidoc verify` 只认上面的 `Method / Path` 行，下表仅供人读。\n\n");
        sb.append("| 接口 | 方法 | 路径 | 权限码 | 说明 |\n|---|---|---|---|---|\n");
        for (JsonNode e : endpoints) {
            sb.append("| ").append(e.path("summary").asText("待补充"))
                    .append(" | ").append(e.path("method").asText(""))
                    .append(" | `").append(e.path("docPath").asText("")).append("`")
                    .append(" | `").append(e.path("permission").asText("待补充")).append("`")
                    .append(" | |\n");
        }
        return sb.toString();
    }

    private String renderOpenApi(String module, ArrayNode endpoints) {
        ObjectNode root = mapper.createObjectNode();
        root.put("openapi", "3.0.3");
        ObjectNode info = root.putObject("info");
        info.put("title", module + " 接口文档");
        info.put("version", "0.1.0");
        info.put("description", "由军火库从 Controller 生成的初稿；请求/响应字段需人工补全。");
        ArrayNode servers = root.putArray("servers");
        servers.addObject().put("url", "/");

        ObjectNode paths = root.putObject("paths");
        for (JsonNode e : endpoints) {
            String method = e.path("method").asText("").toLowerCase(Locale.ROOT);
            if (method.equals("any")) method = "get"; // OpenAPI 没有 ANY；按最常用动词占位
            String path = e.path("path").asText("");
            ObjectNode item = paths.has(path) ? (ObjectNode) paths.get(path) : paths.putObject(path);
            ObjectNode op = item.putObject(method);
            if (!e.path("summary").asText("").isEmpty()) op.put("summary", e.path("summary").asText(""));
            op.putArray("tags").add(module);
            if (!e.path("permission").asText("").isEmpty()) {
                op.put("x-permission", e.path("permission").asText(""));
            }
            ObjectNode responses = op.putObject("responses");
            ObjectNode ok = responses.putObject("200");
            ok.put("description", "OK");
            ObjectNode content = ok.putObject("content");
            ObjectNode appJson = content.putObject("application/json");
            appJson.putObject("schema").put("$ref", "#/components/schemas/Result");
        }

        ObjectNode schemas = root.putObject("components").putObject("schemas");
        ObjectNode result = schemas.putObject("Result");
        result.put("type", "object");
        ObjectNode props = result.putObject("properties");
        props.putObject("code").put("type", "integer").put("description", "0 = 成功");
        props.putObject("msg").put("type", "string");
        props.putObject("data").put("type", "object").put("description", "待补充");

        try {
            return mapper.writerWithDefaultPrettyPrinter().writeValueAsString(root);
        } catch (Exception e) {
            return "{}";
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 选接口 / 分组
    // ─────────────────────────────────────────────────────────────

    /**
     * 选出属于该模块的接口。
     *
     * <p>判定顺序：Controller 的 {@code module}（类级路径第一段，或包名里的业务域）等于模块名。
     * 不按「路径包含模块名」模糊匹配 —— {@code /customer-report} 不该被算进 customer。
     */
    private ArrayNode selectEndpoints(Path repo, String module, ArrayNode notes) {
        ArrayNode out = mapper.createArrayNode();
        ArrayNode controllers = ControllerIndex.scan(repo, mapper);
        int controllerCount = 0;
        for (JsonNode c : controllers) {
            if (!module.equals(c.path("module").asText(""))) continue;
            controllerCount++;
            for (JsonNode e : c.path("endpoints")) {
                ObjectNode row = (ObjectNode) e.deepCopy();
                row.put("controller", c.path("class").asText(""));
                row.put("file", c.path("file").asText(""));
                row.put("tag", c.path("tag").asText(""));
                row.put("base", c.path("base").asText(""));
                out.add(row);
            }
        }
        if (controllerCount == 0) {
            note(notes, "info", "NO_CONTROLLER_FOR_MODULE",
                    "没有 Controller 的 module 字段等于 " + module + "；"
                            + "如果后端路径不按模块名开头，请在 Controller 的 @RequestMapping 里用模块名做第一段。");
        }
        return out;
    }

    /** 资源分组：路径去掉模块段后的第一段；没有则用模块名。 */
    private Map<String, List<JsonNode>> resourceGroups(ArrayNode endpoints) {
        Map<String, List<JsonNode>> groups = new TreeMap<>();
        for (JsonNode e : endpoints) {
            String path = ControllerIndex.normalize(e.path("path").asText(""));
            String[] parts = path.split("/");
            List<String> seg = new ArrayList<>();
            for (String p : parts) if (!p.isBlank()) seg.add(p);
            String resource = seg.size() > 1 ? seg.get(1) : (seg.isEmpty() ? "" : seg.get(0));
            if (resource.isBlank()) resource = "其他";
            groups.computeIfAbsent(resource, k -> new ArrayList<>()).add(e);
        }
        return groups;
    }

    private int countWithPermission(ArrayNode endpoints) {
        int n = 0;
        for (JsonNode e : endpoints) if (!e.path("permission").asText("").isEmpty()) n++;
        return n;
    }

    private int countWithSummary(ArrayNode endpoints) {
        int n = 0;
        for (JsonNode e : endpoints) if (!e.path("summary").asText("").isEmpty()) n++;
        return n;
    }

    /**
     * 文档里的路径带前端 base {@code /api}，Controller 里没有；对账时统一剥掉。
     * 文档写成不带 {@code /api} 也认 —— 两种都有人写，认的是接口本身，不是前缀。
     */
    private static String docKeyPath(String path) {
        String n = ControllerIndex.normalize(path);
        if (n.equals("/api")) return "/";
        return n.startsWith("/api/") ? n.substring("/api".length()) : n;
    }

    private List<DocEndpoint> readDocEndpoints(Path file) {
        List<DocEndpoint> out = new ArrayList<>();
        try {
            String text = Files.readString(file, StandardCharsets.UTF_8);
            Matcher m = DOC_ENDPOINT.matcher(text);
            int line = 1;
            int scanned = 0;
            while (m.find()) {
                for (int i = scanned; i < m.start(); i++) if (text.charAt(i) == '\n') line++;
                scanned = m.start();
                out.add(new DocEndpoint(m.group(1).toUpperCase(Locale.ROOT), m.group(2), line));
            }
        } catch (IOException e) {
            // 读不了就当没有：调用方看 present=true 但 endpointCount=0，会报文档漂移。
        }
        return out;
    }

    // ─────────────────────────────────────────────────────────────

    private ObjectNode base(String kind, String module) {
        ObjectNode out = mapper.createObjectNode();
        out.put("schemaVersion", 1);
        out.put("kind", kind);
        out.put("generatedAt", OffsetDateTime.now(ZoneOffset.ofHours(8)).toString());
        out.put("writes", false);
        out.put("note", "只读对账 / 只生成初稿：军火库不写被管理项目的任何文件，也不执行任何接口。");
        out.put("module", module);
        return out;
    }

    private ObjectNode endpointRow(JsonNode e) {
        ObjectNode m = mapper.createObjectNode();
        m.put("method", e.path("method").asText(""));
        m.put("path", e.path("docPath").asText(e.path("path").asText("")));
        m.put("backendPath", e.path("path").asText(""));
        m.put("summary", e.path("summary").asText(""));
        m.put("controller", e.path("controller").asText(""));
        m.put("file", e.path("file").asText(""));
        return m;
    }

    private void warn(ArrayNode notes, String code, String message) {
        note(notes, "warn", code, message);
    }

    private void note(ArrayNode notes, String level, String code, String message) {
        ObjectNode n = notes.addObject();
        n.put("level", level);
        n.put("code", code);
        n.put("message", message);
    }

    private record DocEndpoint(String method, String path, int line) {
    }
}
