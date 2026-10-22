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
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * 模块开发看板 · <b>只读推断，不存第二份状态</b>。
 *
 * <p>对应 IEMS 的固定打法（{@code docs/模块开发流程.md}）：
 * <pre>
 *   ① 设计说明 → ② 表结构设计 → ③ 建表四件套 → ④ 后端实现 → ⑤ 接口文档 → ⑥ 前端实现 → ⑦ 自测验收
 * </pre>
 *
 * <p><b>为什么不让人手动点「完成」</b>：手动状态两天就会和仓库脱节，然后没人知道该信哪个。
 * 这里每一格都只认仓库里的文件 —— 设计说明有没有、四件套齐不齐、Controller 有几个接口、
 * 文档对没对上、前端目录有没有东西。文件在，格子就绿；文件不在，谁说做完了都不算。
 *
 * <p><b>模块从哪来</b>：设计说明文件名（{@code docs/design/YYYY-MM-DD-<module>.md}）、
 * 接口文档（{@code docs/api/<module>.md}）、表说明里的「模块」字段。三者并集 ——
 * 任意一个先落地，模块就出现在看板上。只建了后端目录但没有设计说明的，不算「已立项」。
 *
 * <p><b>前端从哪来</b>：注册表里与当前项目<b>同父目录</b>、且有 {@code package.json} 的项目
 * （IEMS-Service 与 IEMS-Web 就是这种关系）。前端没注册进军火库时，第 ⑥ 步如实显示
 * 「没找到前端项目」，不会假装 Todo 或 Done。
 *
 * <p>军火库在这里依旧只读：不执行 SQL、不写被管理项目、不启服务。
 */
public final class ModuleBoardService {

    /** 模块名只允许业务域英文小写。表说明里写成中文的，回落到表名前缀。 */
    private static final Pattern MODULE_TOKEN = Pattern.compile("^[a-z][a-z0-9-]*$");
    private static final Pattern DESIGN_FILE =
            Pattern.compile("^(\\d{4}-\\d{2}-\\d{2})-(.+)\\.md$");
    private static final Pattern MODULE_HEADER =
            Pattern.compile("模块\\s*[:：]\\s*`?([A-Za-z0-9_-]+)`?");
    private static final Pattern TITLE_LINE = Pattern.compile("^#\\s+(.+)$");
    private static final Pattern SECTION2 =
            Pattern.compile("^##\\s+2\\s*[.、]\\s*(.+)$", Pattern.MULTILINE);
    private static final Pattern TABLE_SIGNAL =
            Pattern.compile("(?m)^\\s*[-*]?\\s*(新增/修改表|表清单|表结构)[:：]\\s*\\S+"
                    + "|`[a-z][a-z0-9]*_[a-z0-9_]+`");
    private static final Pattern NUMBERED_SECTION =
            Pattern.compile("^##\\s+(\\d+)\\s*[.、]\\s*\\S+", Pattern.MULTILINE);

    private static final int MAX_DOC_BYTES = 512 * 1024;

    /**
     * 脚手架自带模块 —— 不是「还没开始」，而是「不在业务开发范围」。
     * 只在「由表说明反推模块」时过滤；设计说明或接口文档里明确写了同名的，
     * 说明是人有意为之，仍然正常显示。
     */
    private static final Set<String> SCAFFOLD_MODULES = Set.of(
            "basic", "system", "sys", "quartz", "job", "message", "monitor", "sms", "schedule", "t");

    private final ObjectMapper mapper;
    private final DdlVerifyService verifier;
    private final ApiDocService apiDoc;
    private final ProjectRegistry registry;
    private final ProjectCache cache;

    public ModuleBoardService(ObjectMapper mapper, DdlVerifyService verifier, ApiDocService apiDoc,
                              ProjectRegistry registry, ProjectCache cache) {
        this.mapper = mapper;
        this.verifier = verifier;
        this.apiDoc = apiDoc;
        this.registry = registry;
        this.cache = cache;
    }

    /**
     * 整块看板。
     *
     * @param repo      后端项目的缓存仓库
     * @param projectId 注册表 id（用来找同级前端项目）
     */
    public ObjectNode board(Path repo, String projectId) {
        ObjectNode out = mapper.createObjectNode();
        out.put("schemaVersion", 1);
        out.put("generatedAt", OffsetDateTime.now(ZoneOffset.ofHours(8)).toString());
        out.put("writes", false);
        out.put("note", "只读推断：每一格都来自仓库文件，军火库不保存第二份进度，也不写被管理项目。");
        out.put("available", Files.isDirectory(repo.resolve("docs")));

        ObjectNode entry = registry.find(projectId).orElse(null);
        ObjectNode project = out.putObject("project");
        project.put("id", projectId);
        project.put("name", entry == null ? "" : entry.path("name").asText(""));
        project.put("path", entry == null ? "" : entry.path("source").path("value").asText(""));

        ObjectNode frontend = findFrontend(projectId);
        out.set("frontend", frontend);

        ObjectNode playbook = out.putObject("playbook");
        playbook.put("file", "docs/模块开发流程.md");
        playbook.put("found", Files.isRegularFile(repo.resolve("docs/模块开发流程.md")));
        playbook.put("apiReadme", Files.isRegularFile(repo.resolve("docs/api/README.md")));

        ArrayNode notes = out.putArray("notes");
        if (!playbook.path("found").asBoolean(false)) {
            note(notes, "warn", "PLAYBOOK_MISSING",
                    "docs/模块开发流程.md 不在缓存里 —— 看板的阶段口径来自这份文件，缺了就先补它。");
        }
        if (!playbook.path("apiReadme").asBoolean(false)) {
            note(notes, "warn", "API_README_MISSING",
                    "docs/api/README.md 不在缓存里 —— 接口文档的写法与对账规则没有落点。");
        }
        if (!frontend.path("detected").asBoolean(false)) {
            note(notes, "info", "FRONTEND_NOT_FOUND",
                    "没找到同父目录的前端项目；第 ⑥ 步会一直显示「未检测到」，"
                            + "把 IEMS-Web 也加进军火库就能看到前端进度。");
        }

        // ── 事实源 ──
        ObjectNode verify = verifier.verify(repo);
        ArrayNode controllers = ControllerIndex.scan(repo, mapper);
        Map<String, List<JsonNode>> tablesByModule = groupTables(verify.path("tables"));
        Map<String, List<JsonNode>> controllersByModule = groupControllers(controllers);

        Map<String, Seed> seeds = discoverModules(repo, tablesByModule);

        ArrayNode modules = out.putArray("modules");
        int acceptReady = 0;
        int inProgress = 0;
        int notStarted = 0;
        int[] stageDone = new int[7]; // 下标 1..6 使用

        for (Seed seed : seeds.values()) {
            ObjectNode m = buildModule(repo, seed, tablesByModule, controllersByModule, frontend);
            modules.add(m);

            ArrayNode stages = (ArrayNode) m.path("stages");
            int done = 0;
            for (int i = 0; i < 6; i++) {
                if ("done".equals(stages.get(i).path("status").asText())) {
                    done++;
                    stageDone[i + 1]++;
                }
            }
            if (done == 6) {
                acceptReady++;
                ((ObjectNode) stages.get(6)).put("status", "ready");
            } else if (done == 0 && stages.get(0).path("status").asText().equals("todo")) {
                notStarted++;
            } else {
                inProgress++;
            }
        }

        ObjectNode summary = out.putObject("summary");
        summary.put("modules", modules.size());
        summary.put("acceptReady", acceptReady);
        summary.put("inProgress", inProgress);
        summary.put("notStarted", notStarted);
        ObjectNode byStage = summary.putObject("stageDone");
        for (int i = 1; i <= 6; i++) byStage.put("stage" + i, stageDone[i]);

        out.set("modules", modules);
        out.set("notes", notes);
        return out;
    }

    // ─────────────────────────────────────────────────────────────
    // 单模块
    // ─────────────────────────────────────────────────────────────

    private ObjectNode buildModule(Path repo, Seed seed,
                                   Map<String, List<JsonNode>> tablesByModule,
                                   Map<String, List<JsonNode>> controllersByModule,
                                   ObjectNode frontend) {
        String module = seed.module;
        ObjectNode m = mapper.createObjectNode();
        m.put("module", module);
        m.put("label", seed.label.isBlank() ? module : seed.label);

        ArrayNode stages = m.putArray("stages");
        stages.add(stageDesign(repo, seed));
        stages.add(stageSchema(repo, seed, tablesByModule.getOrDefault(module, List.of())));
        stages.add(stageFourPiece(tablesByModule.getOrDefault(module, List.of())));
        stages.add(stageBackend(repo, module, controllersByModule.getOrDefault(module, List.of())));
        stages.add(stageApiDoc(repo, module, controllersByModule.getOrDefault(module, List.of())));
        stages.add(stageFrontend(module, frontend));
        stages.add(stageAcceptance(stages));

        int done = 0;
        for (int i = 0; i < 6; i++) {
            if ("done".equals(stages.get(i).path("status").asText())) done++;
        }
        ObjectNode progress = m.putObject("progress");
        progress.put("done", done);
        progress.put("total", 6);
        progress.put("percent", Math.round(done * 100f / 6));
        m.put("acceptReady", done == 6);
        m.put("nextAction", nextAction(module, stages));
        return m;
    }

    // ① 设计说明 ────────────────────────────────────────────────

    private ObjectNode stageDesign(Path repo, Seed seed) {
        if (seed.designFile == null) {
            ObjectNode s = stage(1, "design", "设计说明", "todo",
                    "还没有设计说明。军火库靠文件名认模块，文件名必须是 `YYYY-MM-DD-<module>.md`。");
            miss(s, "docs/design/YYYY-MM-DD-" + seed.module + ".md", "backend");
            return s;
        }
        ObjectNode s = stage(1, "design", "设计说明", "done", seed.designTitle);
        evidence(s, seed.designFile, "backend", seed.designDate + " · " + seed.designSections + " 节");
        return s;
    }

    // ② 表结构设计 ──────────────────────────────────────────────

    private ObjectNode stageSchema(Path repo, Seed seed, List<JsonNode> tables) {
        int tableCount = tables.size();
        String section2 = seed.designFile == null ? "" : readSection2(repo.resolve(seed.designFile));
        boolean designed = !section2.isBlank() && TABLE_SIGNAL.matcher(section2).find();

        ObjectNode s = stage(2, "schema", "表结构设计", "partial", "");
        if (designed) {
            s.put("status", "done");
            s.put("detail", "设计说明第 2 节写了表/接口变更；模块现有 " + tableCount + " 张表。");
            evidence(s, seed.designFile, "backend", "第 2 节");
        } else if (seed.designFile != null) {
            s.put("detail", "设计说明在，但第 2 节看不出表清单（要么没写，要么只写了标题）。");
            evidence(s, seed.designFile, "backend", "第 2 节为空");
        } else if (tableCount > 0) {
            s.put("detail", "已经有 " + tableCount + " 张表，但没有设计说明 —— 表的来历只能从脚本反推。");
        } else {
            s.put("status", "todo");
            s.put("detail", "还没有表结构设计。写进设计说明第 2 节，再用 `ddl.mjs plan` 校验。");
            miss(s, "docs/design/YYYY-MM-DD-" + seed.module + ".md", "backend");
        }
        for (JsonNode t : tables) {
            evidence(s, t.path("table").asText(""), "backend", t.path("title").asText(""));
        }
        return s;
    }

    /** 取设计说明第 2 节正文（到下一个一级章为止）。 */
    private String readSection2(Path file) {
        List<String> lines = readLines(file);
        StringBuilder sb = new StringBuilder();
        boolean in = false;
        for (String l : lines) {
            if (SECTION2.matcher(l).matches()) {
                in = true;
                sb.append(l).append('\n');
                continue;
            }
            if (in && l.startsWith("## ")) break;
            if (in) sb.append(l).append('\n');
        }
        return sb.toString();
    }

    // ③ 四件套 ─────────────────────────────────────────────────

    private ObjectNode stageFourPiece(List<JsonNode> tables) {
        if (tables.isEmpty()) {
            ObjectNode s = stage(3, "fourPiece", "建表四件套", "todo",
                    "这个模块还没有表。先做第 ② 步，再用 `ddl.mjs plan` 生成脚本/日志/说明/实体。");
            return s;
        }
        int complete = 0, partial = 0;
        ObjectNode s = stage(3, "fourPiece", "建表四件套", "todo", "");
        for (JsonNode t : tables) {
            String table = t.path("table").asText("");
            String status = t.path("status").asText("");
            if (status.equals("complete")) complete++;
            else if (t.path("okPieces").asInt(0) > 0) partial++;
            evidence(s, table, "backend", t.path("okPieces").asInt(0) + "/4 · " + statusLabel(status));
        }
        if (complete == tables.size()) {
            s.put("status", "done");
            s.put("detail", tables.size() + " 张表四件齐全。");
        } else if (complete + partial > 0) {
            s.put("status", "partial");
            s.put("detail", complete + " 张完整、" + (tables.size() - complete) + " 张还缺件（脚本/日志/说明/实体）。");
        } else {
            s.put("status", "todo");
            s.put("detail", tables.size() + " 张表都还没有四件套 —— 表怎么来的，仓库里查不到。");
        }
        return s;
    }

    // ④ 后端实现 ────────────────────────────────────────────────

    private ObjectNode stageBackend(Path repo, String module, List<JsonNode> controllers) {
        // 包路径必须带上：module/module-x 下是 src/main/java/com/iems/x/{entity,dao,service...}，
        // 少这一层会把「实体在、Controller 还没写」误报成「这个模块还没有后端代码」。
        Path moduleDir = repo.resolve("module").resolve("module-" + module)
                .resolve("src/main/java/com/iems").resolve(module);
        int entities = countFiles(moduleDir.resolve("entity"), ".java");
        int daos = countFiles(moduleDir.resolve("dao"), ".java");
        // service 是递归统计的，impl 会一起被算进去；接口数要把它减掉，否则明细重复计数。
        int impls = countFiles(moduleDir.resolve("service").resolve("impl"), ".java");
        int services = countFiles(moduleDir.resolve("service"), ".java") - impls;
        int dtos = countFiles(moduleDir.resolve("dto"), ".java")
                + countFiles(moduleDir.resolve("vo"), ".java")
                + countFiles(moduleDir.resolve("query"), ".java")
                + countFiles(moduleDir.resolve("convert"), ".java");
        int endpointCount = 0;
        for (JsonNode c : controllers) endpointCount += c.path("endpoints").size();

        ObjectNode s = stage(4, "backend", "后端实现", "todo", "");
        s.put("endpointCount", endpointCount);
        s.put("controllerCount", controllers.size());

        List<String> layers = new ArrayList<>();
        if (entities > 0) layers.add("实体 " + entities);
        if (daos > 0) layers.add("DAO " + daos);
        if (services > 0) layers.add("Service " + services + (impls > 0 ? "（impl " + impls + "）" : ""));
        if (dtos > 0) layers.add("DTO/VO " + dtos);
        if (!controllers.isEmpty()) layers.add("Controller " + controllers.size() + " · 接口 " + endpointCount);

        for (JsonNode c : controllers) {
            String file = c.path("file").asText("");
            evidence(s, file, "backend", c.path("base").asText("") + " · " + c.path("endpoints").size() + " 个接口");
        }
        if (!layers.isEmpty()) {
            s.put("detail", String.join(" · ", layers));
        } else {
            s.put("detail", "`module/module-" + module + "` 下还没有后端代码。");
            miss(s, "module/module-" + module + "/src/main/java/com/iems/" + module + "/", "backend");
        }

        boolean wired = endpointCount > 0 && entities > 0 && daos > 0 && services > 0;
        if (wired) {
            s.put("status", "done");
        } else if (!layers.isEmpty()) {
            s.put("status", "partial");
            if (endpointCount == 0) miss(s, "Controller（" + module + " 的 @RequestMapping）", "backend");
            if (entities == 0) miss(s, "entity（@TableName 实体）", "backend");
            if (daos == 0) miss(s, "dao（BaseDao）", "backend");
            if (services == 0) miss(s, "service + service.impl", "backend");
        }
        return s;
    }

    // ⑤ 接口文档 ────────────────────────────────────────────────

    private ObjectNode stageApiDoc(Path repo, String module, List<JsonNode> controllers) {
        ObjectNode v = apiDoc.verify(repo, module);
        String status = v.path("status").asText("missing");
        ObjectNode s = stage(5, "apiDoc", "接口文档", "todo", "");
        JsonNode summary = v.path("summary");
        int codeN = summary.path("codeEndpoints").asInt(0);
        int docN = summary.path("docEndpoints").asInt(0);
        int missing = summary.path("missing").asInt(0);
        int extra = summary.path("extra").asInt(0);

        s.put("codeEndpoints", codeN);
        s.put("docEndpoints", docN);
        s.put("missingCount", missing);
        s.put("extraCount", extra);

        if (status.equals("ok")) {
            s.put("status", "done");
            s.put("detail", "代码 " + codeN + " 个接口、文档 " + docN + " 个，0 缺失 / 0 多余。");
        } else if (status.equals("missing")) {
            s.put("status", codeN > 0 ? "partial" : "todo");
            s.put("detail", "还没有 docs/api/" + module + ".md。前端同事现在只能读源码。");
        } else {
            s.put("status", "partial");
            s.put("detail", "代码 " + codeN + " 个、文档 " + docN + " 个；缺 " + missing + " 个、多 " + extra + " 个。");
        }

        if (Files.isRegularFile(repo.resolve("docs/api/" + module + ".md"))) {
            evidence(s, "docs/api/" + module + ".md", "backend", docN + " 个接口");
        } else {
            miss(s, "docs/api/" + module + ".md", "backend");
        }
        if (Files.isRegularFile(repo.resolve("docs/api/" + module + ".openapi.json"))) {
            evidence(s, "docs/api/" + module + ".openapi.json", "backend", "OpenAPI 附件");
        } else {
            miss(s, "docs/api/" + module + ".openapi.json", "backend");
        }
        return s;
    }

    // ⑥ 前端实现 ────────────────────────────────────────────────

    private ObjectNode stageFrontend(String module, ObjectNode frontend) {
        ObjectNode s = stage(6, "frontend", "前端实现", "todo", "");
        s.put("detected", frontend.path("detected").asBoolean(false));
        if (!frontend.path("detected").asBoolean(false)) {
            s.put("detail", "没找到同父目录的前端项目（需要 package.json + src/）。");
            miss(s, "IEMS-Web/src/api/" + module + "/", "frontend");
            miss(s, "IEMS-Web/src/views/" + module + "/", "frontend");
            return s;
        }
        Path root = Path.of(frontend.path("root").asText(""));
        int apiFiles = countFiles(root.resolve("src/api").resolve(module), null);
        int viewFiles = countFiles(root.resolve("src/views").resolve(module), null);
        s.put("apiFiles", apiFiles);
        s.put("viewFiles", viewFiles);

        if (apiFiles > 0) evidence(s, "src/api/" + module + "/", "frontend", apiFiles + " 个文件");
        else miss(s, "src/api/" + module + "/", "frontend");
        if (viewFiles > 0) evidence(s, "src/views/" + module + "/", "frontend", viewFiles + " 个文件");
        else miss(s, "src/views/" + module + "/", "frontend");

        if (apiFiles > 0 && viewFiles > 0) {
            s.put("status", "done");
            s.put("detail", "API 客户端 " + apiFiles + " 个文件、页面 " + viewFiles + " 个文件。");
        } else if (apiFiles > 0 || viewFiles > 0) {
            s.put("status", "partial");
            s.put("detail", apiFiles > 0 ? "API 客户端有了，页面还没落到 src/views/" + module + "/。"
                    : "页面目录有了，src/api/" + module + "/ 还没有请求封装。");
        } else {
            s.put("detail", "前端项目在，但 `src/api/" + module + "/` 和 `src/views/" + module + "/` 都还是空的。");
        }
        return s;
    }

    // ⑦ 自测验收 ────────────────────────────────────────────────

    private ObjectNode stageAcceptance(ArrayNode stages) {
        ObjectNode s = stage(7, "acceptance", "自测验收", "todo", "");
        List<String> left = new ArrayList<>();
        for (int i = 0; i < 6; i++) {
            JsonNode st = stages.get(i);
            if (!"done".equals(st.path("status").asText())) left.add(st.path("name").asText());
        }
        if (left.isEmpty()) {
            s.put("status", "ready");
            s.put("detail", "1—6 全绿，可以人工验收。验收结论由人定，军火库只提示「可以看了」。");
        } else {
            s.put("detail", "还差：" + String.join("、", left) + "。");
        }
        return s;
    }

    // ─────────────────────────────────────────────────────────────
    // 模块发现
    // ─────────────────────────────────────────────────────────────

    private static final class Seed {
        String module;
        String label = "";
        String designFile;
        String designDate = "";
        String designTitle = "";
        int designSections;

        Seed(String module) {
            this.module = module;
        }
    }

    private Map<String, Seed> discoverModules(Path repo, Map<String, List<JsonNode>> tablesByModule) {
        Map<String, Seed> seeds = new TreeMap<>();
        // 设计说明
        Path designDir = repo.resolve("docs/design");
        if (Files.isDirectory(designDir)) {
            for (Path f : listFiles(designDir, ".md")) {
                String name = f.getFileName().toString();
                if (name.equalsIgnoreCase("README.md") || name.startsWith("_")) continue;
                Matcher m = DESIGN_FILE.matcher(name);
                if (!m.matches()) continue;
                String topic = m.group(2);
                String module = MODULE_TOKEN.matcher(topic).matches() ? topic : moduleFromHeader(f);
                if (module.isEmpty()) continue;
                Seed seed = seeds.computeIfAbsent(module, Seed::new);
                // 同一模块有多份设计说明时取文件名日期最新的一份
                if (seed.designFile == null || m.group(1).compareTo(seed.designDate) > 0) {
                    seed.designFile = "docs/design/" + name;
                    seed.designDate = m.group(1);
                    seed.designTitle = titleOf(f);
                    seed.designSections = countSections(f);
                }
            }
        }
        // 接口文档
        Path apiDir = repo.resolve("docs/api");
        if (Files.isDirectory(apiDir)) {
            for (Path f : listFiles(apiDir, ".md")) {
                String name = f.getFileName().toString();
                if (name.equalsIgnoreCase("README.md") || name.startsWith("_")) continue;
                String module = name.substring(0, name.length() - 3);
                if (!MODULE_TOKEN.matcher(module).matches()) continue;
                seeds.computeIfAbsent(module, Seed::new);
            }
            for (Path f : listFiles(apiDir, ".json")) {
                String name = f.getFileName().toString();
                if (!name.endsWith(".openapi.json")) continue;
                String module = name.substring(0, name.length() - ".openapi.json".length());
                if (!MODULE_TOKEN.matcher(module).matches()) continue;
                seeds.computeIfAbsent(module, Seed::new);
            }
        }
        // 表说明里的「模块」（表模块已由 DdlVerifyService 按实体路径归属，这里再滤掉脚手架）
        for (String module : tablesByModule.keySet()) {
            if (!MODULE_TOKEN.matcher(module).matches()) continue;
            if (SCAFFOLD_MODULES.contains(module)) continue;
            seeds.computeIfAbsent(module, Seed::new);
        }
        for (Seed seed : seeds.values()) {
            // 设计说明的标题最贴近模块名（「客户管理模块设计说明」→「客户管理」），
            // 没有设计说明时才退到表说明的标题。
            if (seed.label.isBlank()) seed.label = labelFromTitle(seed.designTitle);
            if (seed.label.isBlank()) {
                List<JsonNode> ts = tablesByModule.getOrDefault(seed.module, List.of());
                if (!ts.isEmpty()) seed.label = ts.get(0).path("title").asText("");
            }
        }
        return seeds;
    }

    private Map<String, List<JsonNode>> groupTables(JsonNode tables) {
        Map<String, List<JsonNode>> out = new TreeMap<>();
        if (!tables.isArray()) return out;
        for (JsonNode t : tables) {
            String module = t.path("module").asText("").trim().toLowerCase(Locale.ROOT);
            if (module.isEmpty()) continue;
            out.computeIfAbsent(module, k -> new ArrayList<>()).add(t);
        }
        return out;
    }

    private Map<String, List<JsonNode>> groupControllers(ArrayNode controllers) {
        Map<String, List<JsonNode>> out = new TreeMap<>();
        for (JsonNode c : controllers) {
            String module = c.path("module").asText("");
            if (module.isEmpty() || module.equals("unknown")) continue;
            out.computeIfAbsent(module, k -> new ArrayList<>()).add(c);
        }
        return out;
    }

    // ─────────────────────────────────────────────────────────────
    // 前端项目
    // ─────────────────────────────────────────────────────────────

    private ObjectNode findFrontend(String projectId) {
        ObjectNode out = mapper.createObjectNode();
        out.put("detected", false);
        ObjectNode self = registry.find(projectId).orElse(null);
        if (self == null) return out;
        String kind = self.path("source").path("kind").asText("");
        String value = self.path("source").path("value").asText("");
        if (!kind.equals("path") || value.isBlank()) return out;

        Path selfPath = Path.of(value).toAbsolutePath().normalize();
        Path parent = selfPath.getParent();
        if (parent == null) return out;
        String parentKey = key(parent);

        for (ObjectNode e : registry.list()) {
            String id = e.path("id").asText("");
            if (id.equals(projectId)) continue;
            if (!e.path("source").path("kind").asText("").equals("path")) continue;
            String v = e.path("source").path("value").asText("");
            if (v.isBlank()) continue;
            Path p = Path.of(v).toAbsolutePath().normalize();
            if (p.getParent() == null || !key(p.getParent()).equals(parentKey)) continue;
            if (!Files.isRegularFile(p.resolve("package.json"))) continue;
            if (!Files.isDirectory(p.resolve("src"))) continue;

            // 缓存优先（看板其余格子读的都是缓存，前端也读缓存才不会两套事实）
            Path cached = cache.resolve(id);
            Path root = cached != null ? cached : p;
            out.put("detected", true);
            out.put("id", id);
            out.put("name", e.path("name").asText(""));
            out.put("path", v);
            out.put("root", root.toString().replace('\\', '/'));
            out.put("fromCache", cached != null);
            return out;
        }
        return out;
    }

    private static String key(Path p) {
        return p.toString().replace('\\', '/').toLowerCase(Locale.ROOT);
    }

    // ─────────────────────────────────────────────────────────────
    // 小工具
    // ─────────────────────────────────────────────────────────────

    private ObjectNode stage(int no, String key, String name, String status, String detail) {
        ObjectNode s = mapper.createObjectNode();
        s.put("no", no);
        s.put("key", key);
        s.put("name", name);
        s.put("status", status);
        s.put("detail", detail);
        s.putArray("evidence");
        s.putArray("missing");
        return s;
    }

    private void evidence(ObjectNode stage, String path, String root, String note) {
        if (path == null || path.isBlank()) return;
        ObjectNode e = ((ArrayNode) stage.path("evidence")).addObject();
        e.put("path", path);
        e.put("root", root);
        e.put("note", note == null ? "" : note);
    }

    private void miss(ObjectNode stage, String path, String root) {
        ObjectNode e = ((ArrayNode) stage.path("missing")).addObject();
        e.put("path", path);
        e.put("root", root);
    }

    private String nextAction(String module, ArrayNode stages) {
        for (JsonNode s : stages) {
            String status = s.path("status").asText();
            if (!status.equals("done") && !status.equals("ready")) {
                return switch (s.path("key").asText()) {
                    case "design" -> "写设计说明：docs/design/YYYY-MM-DD-" + module
                            + ".md（模板见 docs/design/README.md）";
                    case "schema" -> "在设计说明第 2 节列清表清单，再用 ddl.mjs plan 校验";
                    case "fourPiece" -> "用 ddl.mjs plan 生成四件套，写进 IEMS 后 ddl verify 变绿";
                    case "backend" -> "按 Entity → DAO → DTO/VO/Query → Convert → Service → Impl → Controller 实现";
                    case "apiDoc" -> "apidoc.mjs verify --module " + module
                            + " 对账，缺的接口补进 docs/api/" + module + ".md";
                    case "frontend" -> "在前端 src/api/" + module + "/ 与 src/views/" + module + "/ 实现";
                    case "acceptance" -> "1—6 全绿后人工验收";
                    default -> "";
                };
            }
        }
        return "";
    }

    private static String statusLabel(String status) {
        return switch (status) {
            case "complete" -> "完整";
            case "partial" -> "部分";
            default -> "缺失";
        };
    }

    private List<Path> listFiles(Path dir, String suffix) {
        List<Path> out = new ArrayList<>();
        if (!Files.isDirectory(dir)) return out;
        try (Stream<Path> s = Files.list(dir)) {
            s.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().endsWith(suffix))
                    .forEach(out::add);
        } catch (IOException e) {
            return out;
        }
        out.sort(Comparator.comparing(Path::toString));
        return out;
    }

    /**
     * 统计目录里的文件数。{@code suffix} 为空表示所有文件。
     * 跳过 node_modules / .git / dist —— 它们会把「前端实现了没」这个判断整个弄失真。
     */
    private static int countFiles(Path dir, String suffix) {
        if (dir == null || !Files.isDirectory(dir)) return 0;
        try (Stream<Path> s = Files.walk(dir, 8)) {
            return (int) s.filter(Files::isRegularFile)
                    .filter(p -> {
                        String r = p.toString().replace('\\', '/');
                        return !r.contains("/node_modules/") && !r.contains("/.git/")
                                && !r.contains("/dist/");
                    })
                    .filter(p -> suffix == null || p.getFileName().toString().endsWith(suffix))
                    .count();
        } catch (IOException e) {
            return 0;
        }
    }

    private List<String> readLines(Path file) {
        try {
            if (!Files.isRegularFile(file) || Files.size(file) > MAX_DOC_BYTES) return List.of();
            return Files.readAllLines(file, StandardCharsets.UTF_8);
        } catch (IOException e) {
            return List.of();
        }
    }

    private String titleOf(Path file) {
        for (String l : readLines(file)) {
            Matcher m = TITLE_LINE.matcher(l.trim());
            if (m.matches()) return m.group(1).trim();
        }
        return "";
    }

    /**
     * 从设计说明标题取模块中文名：去掉「设计说明/设计方案/设计文档」和结尾的「模块」。
     * 「客户管理模块设计说明」→「客户管理」；「设备管理设计说明」→「设备管理」。
     */
    private static String labelFromTitle(String title) {
        if (title == null || title.isBlank()) return "";
        String t = title.trim()
                .replaceAll("(设计说明|设计方案|设计文档)$", "")
                .replaceAll("模块$", "")
                .trim();
        return t.length() >= 2 ? t : "";
    }

    private int countSections(Path file) {
        int n = 0;
        for (String l : readLines(file)) if (NUMBERED_SECTION.matcher(l).matches()) n++;
        return n;
    }

    /** 主题式文件名（中文）时，从正文前 40 行找 `模块：customer`。 */
    private String moduleFromHeader(Path file) {
        List<String> lines = readLines(file);
        int limit = Math.min(lines.size(), 40);
        for (int i = 0; i < limit; i++) {
            Matcher m = MODULE_HEADER.matcher(lines.get(i));
            if (m.find()) {
                String v = m.group(1);
                return MODULE_TOKEN.matcher(v).matches() ? v : "";
            }
        }
        return "";
    }

    private void note(ArrayNode notes, String level, String code, String message) {
        ObjectNode n = notes.addObject();
        n.put("level", level);
        n.put("code", code);
        n.put("message", message);
    }
}
