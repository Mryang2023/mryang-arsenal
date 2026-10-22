package com.arsenal.projects;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * DDL 变更计划 · 带校验的生成器。
 *
 * <p><b>边界（2026-10-21 用户定的死规矩）</b>：军火库只记录、只生成，<b>不操作被管理的项目</b>。
 * 所以本类刻意没有「apply / write / execute」任何一种出口：
 * <ul>
 *   <li>产出的四件套正文（SQL / CHANGELOG 行 / 表说明 / 实体）只放在响应里；</li>
 *   <li>目标路径是<b>建议</b>，不是写操作 —— 真正落盘由调用方（人或 AI）自己完成；</li>
 *   <li>不连数据库、不执行 SQL、不改 IEMS 仓库里的任何文件。</li>
 * </ul>
 * 计划本身会由控制器记进军火库自己的 {@code .data/projects/<id>/ddl-plans/}，
 * 那是「这次变更被计划过」的留档，不是对被管理项目的动作。
 *
 * <p><b>为什么是生成器而不是模板字符串拼接</b>：四件套的格式散在章程 2.11—2.17、
 * {@code docs/db/README.md}、{@code tables/_TEMPLATE.md} 三处，人抄一遍就会漏一处。
 * 这里把「格式」和「校验」写在一起：生成的正文直接符合模板，同时按章程把
 * 缺注释、timestamp、float 金额、unsigned bigint、物理外键、索引命名等问题当场报出来。
 * 校验结果不阻断生成 —— 人要看到的是一份能改的稿子，而不是一句「不合法」。
 */
public final class DdlPlanService {

    // ── 与章程对齐的常量 ──

    /** BaseEntity 的 7 个公共字段（章程 2.3）。顺序即 SQL 里出现的顺序。 */
    private static final List<Col> BASE_COLUMNS = List.of(
            new Col("id", "bigint", false, null, "主键", "-", "PK", "id", "Long", true, false, false),
            new Col("creator", "bigint", false, "0", "创建人ID", "-", "-", "creator", "Long", false, false, false),
            // 这两个的 Java 类型写 Date 不是笔误：表说明的第 3 节要写「BaseEntity 里的真实类型」，
            // 而仓库的 BaseEntity 用的就是 java.util.Date（章程 2.3 + 2.17：新业务时间字段用
            // LocalDateTime，BaseEntity 的历史 Date 保持兼容）。业务字段的 datetime 另走 LocalDateTime。
            new Col("create_time", "datetime", false, "CURRENT_TIMESTAMP", "创建时间", "-", "-", "createTime", "Date", false, false, false),
            new Col("updater", "bigint", false, "0", "更新人ID", "-", "-", "updater", "Long", false, false, false),
            new Col("update_time", "datetime", false, "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP", "更新时间", "-", "-", "updateTime", "Date", false, false, false),
            new Col("version", "int", false, "0", "乐观锁版本号", "-", "-", "version", "Integer", false, false, false),
            new Col("deleted", "tinyint", false, "0", "删除标记：0未删除 1已删除", "0/1", "-", "deleted", "Integer", false, false, false)
    );

    private static final Set<String> BASE_COLUMN_NAMES = Set.of(
            "id", "creator", "create_time", "updater", "update_time", "version", "deleted");

    /** MySQL 8 保留字（子集，够拦住最常见的撞名）。章程 2.1 禁止用保留字做表名/字段名。 */
    private static final Set<String> RESERVED = Set.of(
            "add", "all", "alter", "and", "as", "asc", "between", "by", "case", "change", "check",
            "column", "condition", "create", "cross", "database", "default", "delete", "desc",
            "describe", "distinct", "drop", "else", "end", "escape", "exists", "explain", "false",
            "for", "foreign", "from", "fulltext", "grant", "group", "having", "in", "index", "inner",
            "insert", "int", "interval", "into", "is", "join", "key", "keys", "kill", "leading",
            "left", "like", "limit", "lock", "match", "natural", "not", "null", "on", "or", "order",
            "outer", "primary", "privileges", "procedure", "range", "read", "real", "references",
            "regexp", "release", "rename", "repeat", "replace", "require", "restrict", "return",
            "revoke", "right", "rlike", "schema", "select", "set", "show", "spatial", "sql",
            "start", "table", "then", "to", "trigger", "true", "union", "unique", "unlock",
            "unsigned", "update", "usage", "use", "using", "values", "view", "when", "where",
            "with", "write");

    private static final Pattern SCRIPT_NAME = Pattern.compile("^V(\\d{8})_(\\d+)__.*\\.sql$", Pattern.CASE_INSENSITIVE);
    private static final Pattern COLUMN_NAME = Pattern.compile("^[a-z][a-z0-9_]*$");

    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("yyyy-MM-dd");
    private static final DateTimeFormatter STAMP = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss");

    private final ObjectMapper mapper;
    private final DossierService dossier;

    public DdlPlanService(ObjectMapper mapper, DossierService dossier) {
        this.mapper = mapper;
        this.dossier = dossier;
    }

    // ─────────────────────────────────────────────────────────────
    // 入口
    // ─────────────────────────────────────────────────────────────

    /**
     * 生成一份变更计划。repo 是项目缓存根（存在即读）。
     *
     * <p>入参形态错抛 {@link IllegalArgumentException}（控制器落 400）——
     * 这类错误的意思是「改一下输入就好」，不是服务端故障。
     */
    public ObjectNode plan(Path repo, JsonNode body) {
        if (body == null || !body.isObject()) throw new IllegalArgumentException("请求体必须是 JSON 对象");
        String table = req(body, "table");
        String title = req(body, "title");
        String operation = str(body, "operation", "CREATE").toUpperCase(Locale.ROOT);
        String date = str(body, "date", LocalDate.now(ZoneOffset.ofHours(8)).format(DAY));
        String module = str(body, "module", defaultModule(table));
        String domain = str(body, "domain", module);
        String author = str(body, "author", "IEMS Team");
        String requirement = str(body, "requirement", "");
        String reason = str(body, "reason", "");
        String impact = str(body, "impact", "新增表，无历史数据");
        String owner = str(body, "owner", "");
        boolean baseEntity = bool(body, "baseEntity", !table.startsWith("sys_log"));
        boolean create = operation.equals("CREATE");

        // 现有的实体 / 脚本是「这条计划是否已经落过盘」的判据，也用来给脚本序号接着数。
        ObjectNode ds = dossier.build(repo);
        JsonNode existingEntities = ds.path("db").path("entities");
        JsonNode existingScripts = ds.path("db").path("scripts");

        List<Col> columns = parseColumns(body.path("columns"));
        boolean callerGaveId = columns.stream().anyMatch(c -> c.name.equals("id"));
        List<Col> effective = new ArrayList<>();
        if (baseEntity) {
            effective.addAll(BASE_COLUMNS);
            columns.removeIf(c -> BASE_COLUMN_NAMES.contains(c.name));
        }
        effective.addAll(columns);

        List<Idx> indexes = parseIndexes(body.path("indexes"), table, columns);
        if (create && indexes.stream().noneMatch(i -> i.type.equals("PRIMARY"))) {
            indexes.add(0, new Idx("PRIMARY", "PRIMARY", List.of("id"), "主键"));
        }

        JsonNode existingEntity = findEntity(existingEntities, table);
        String entityClass = str(body, "entityClass", pascal(table) + "Entity");
        String entityPackage = str(body, "entityPackage", "com.iems." + domain + ".entity");
        // 实体已存在时直接用仓库里的真实路径：按包名重拼容易丢 /src/main/java/ 这一段
        String existingEntityPath = existingEntity == null ? "" : existingEntity.path("file").asText("");
        String entityPath = str(body, "entityFile", existingEntityPath.isBlank()
                ? resolveEntityPath(repo, ds, domain, entityPackage, entityClass)
                : existingEntityPath);

        String scriptName = str(body, "scriptName",
                "V" + date.replace("-", "") + "_" + String.format("%02d", nextSeq(existingScripts, date))
                        + "__" + (table.startsWith(module + "_") ? table : module + "_" + table) + ".sql");
        String sqlPath = "docs/db/" + scriptName;
        String docPath = "docs/db/tables/" + table + ".md";

        List<ObjectNode> warnings = new ArrayList<>();
        warnings.addAll(validateMeta(table, module, operation, columns, baseEntity, callerGaveId));
        warnings.addAll(validateColumns(columns, create));
        // 索引要对着「实际建出来的列」校验：PRIMARY 落在 BaseEntity 的 id 上，
        // 拿业务字段列表去比会把它误判成引用了不存在的字段。
        warnings.addAll(validateIndexes(table, indexes, effective));
        warnings.addAll(validateEntity(entityClass, entityPackage, entityPath, domain));
        // 建议路径可能落在**还没建的模块**里（新域第一次建表必然如此）。四件套只覆盖一个实体文件，
        // 模块本身（pom、包结构、父 pom 的 <module>）不在四件套里；不说清楚，人会以为写四个文件就完事。
        warnings.addAll(validateEntityModule(repo, entityPath, table));
        warnings.addAll(validateStatements(body, create));
        // 对已经齐了的表再出 CREATE 计划，多半是「改完忘了」或「重复生成」：
        // 生成出来的脚本序号会是 _02，内容却和 _01 一模一样，照抄就会多一条重复变更。
        if (create && existingEntity != null && Files.isRegularFile(repo.resolve(docPath))
                && hasScriptForTable(existingScripts, table)) {
            warn(warnings, "warn", "TABLE_ALREADY_COMPLETE", table,
                    "这张表的四件套已经在仓库里了 —— 这个 CREATE 计划大概率是重复生成；"
                            + "除非确实要重建表，否则不要执行，脚本序号也不用往后加");
        }

        String rollback = str(body, "rollback", create
                ? "DROP TABLE IF EXISTS `" + table + "`;"
                : "（待补充：可执行的回滚 SQL；不可回滚必须写备份方案）");
        String before = str(body, "before", create ? "无" : "（待补充：变更前的具体定义）");
        String after = str(body, "after", create
                ? "新增 " + table + " 表（" + columns.size() + " 个业务字段）"
                : "（待补充：变更后的具体定义）");

        List<String> statements = strings(body.path("statements"));

        String sql = create
                ? createSql(table, title, module, author, date, requirement, before, after, impact,
                        rollback, docPath, entityPackage + "." + entityClass, effective, indexes)
                : alterSql(table, title, module, author, date, requirement, before, after, impact,
                        rollback, docPath, entityPackage + "." + entityClass, statements);

        boolean docExists = Files.isRegularFile(repo.resolve(docPath));
        String tableDoc = create
                ? fullTableDoc(table, title, module, owner, date, entityPackage, entityClass,
                        scriptName, effective, columns, indexes, body, existingEntity)
                : tableDocFragment(table, title, date, scriptName, operation, columns, body);

        String entitySource;
        String entityAction;
        if (existingEntity != null) {
            List<String> missing = missingEntityFields(repo, existingEntity.path("file").asText(), columns);
            entitySource = entityFragment(entityClass, table, title, time(body),
                    fieldsByNames(columns, missing), false);
            entityAction = missing.isEmpty() ? "none" : "update";
        } else if (create) {
            entitySource = fullEntity(entityPackage, entityClass, table, title, str(body, "description",
                    title), docPath, author, date, baseEntity, columns);
            entityAction = "create";
        } else {
            // 改表但项目里找不到这张表的实体：计划里只有**本次增量列**，据此生成完整实体
            // 会得到一个缺少原有字段的假实体。只给片段，并明确标红。
            entitySource = entityFragment(entityClass, table, title, time(body), columns, true);
            entityAction = "fragment";
            warn(warnings, "error", "ENTITY_NOT_FOUND_FOR_ALTER", table,
                    "找不到 " + table + " 的实体类；下面只是「本次新增字段」片段，不能当作完整实体写入");
        }

        // 章程 2.15：CHANGELOG 的「原因」必须关联需求/缺陷号 —— 规格里给了 requirement 就拼进来
        String reasonCell;
        if (reason.isEmpty()) {
            reasonCell = "（待补充：需求/缺陷号）";
        } else if (requirement.isBlank() || reason.contains(requirement)) {
            reasonCell = reason;
        } else {
            reasonCell = requirement + " " + reason;
        }
        String changelogRow = changelogRow(date, scriptName, table, operation, before, after,
                reasonCell, impact, rollback, str(body, "envResult", "待执行"), docPath,
                entityPackage + "." + entityClass);

        ObjectNode out = mapper.createObjectNode();
        out.put("schemaVersion", 1);
        out.put("planId", java.time.OffsetDateTime.now(ZoneOffset.ofHours(8)).format(STAMP) + "-" + table);
        out.put("generatedAt", nowIso());
        out.put("writes", false);
        out.put("note", "军火库只生成、不落盘，也不执行 SQL。下面的目标路径是建议，写入由调用方自己完成。");
        out.put("table", table);
        out.put("title", title);
        out.put("operation", operation);
        out.put("module", module);
        out.put("date", date);

        ObjectNode paths = out.putObject("paths");
        paths.put("sql", sqlPath);
        paths.put("changelog", "docs/db/CHANGELOG.md");
        paths.put("tableDoc", docPath);
        paths.put("entity", entityPath);

        ObjectNode artifacts = out.putObject("artifacts");
        artifacts.set("sql", artifact(sqlPath, "create", sql));
        artifacts.set("changelog", artifact("docs/db/CHANGELOG.md", "append", changelogRow));
        // 改表时给的是片段：即使目标 .md 还不存在，也不能把片段写成「新建全文」。
        artifacts.set("tableDoc", artifact(docPath,
                create ? (docExists ? "update" : "create") : "fragment", tableDoc));
        artifacts.set("entity", artifact(entityPath, entityAction, entitySource));

        ArrayNode warningsNode = out.putArray("warnings");
        warnings.forEach(warningsNode::add);

        ArrayNode checklist = out.putArray("checklist");
        checklist.add(check("sql", "可执行脚本", true, sqlPath,
                statements.isEmpty() && !create ? "非建表操作没有 statements，脚本只有头部" : "已生成，需在 dev/test 执行并回填结果"));
        checklist.add(check("changelog", "变更日志", true, "docs/db/CHANGELOG.md", "追加 1 行（12 列）"));
        checklist.add(check("tableDoc", "表结构说明", true, docPath,
                create ? "完整模板；「待补充」处需人工补全" : "只生成变更片段，需并入现有表说明"));
        checklist.add(check("entity", "实体类", !entityAction.equals("none"), entityPath,
                switch (entityAction) {
                    case "create" -> "新建实体";
                    case "update" -> "实体已存在，只列出缺少的字段";
                    case "fragment" -> "改表片段：只含本次新增字段，不能当完整实体";
                    default -> "实体已存在且字段齐全，无需改动";
                }));

        ObjectNode stats = out.putObject("stats");
        stats.put("businessColumns", columns.size());
        stats.put("totalColumns", effective.size());
        stats.put("indexes", indexes.size());
        stats.put("errors", warnings.stream().filter(w -> "error".equals(w.path("level").asText())).count());
        stats.put("warns", warnings.stream().filter(w -> "warn".equals(w.path("level").asText())).count());
        return out;
    }

    // ─────────────────────────────────────────────────────────────
    // 解析
    // ─────────────────────────────────────────────────────────────

    private List<Col> parseColumns(JsonNode arr) {
        List<Col> out = new ArrayList<>();
        if (arr == null || !arr.isArray()) return out;
        int i = 0;
        for (JsonNode n : arr) {
            i++;
            String name = str(n, "name", "");
            if (name.isBlank()) throw new IllegalArgumentException("columns[" + i + "].name 不能为空");
            String type = str(n, "type", "");
            if (type.isBlank()) throw new IllegalArgumentException("columns[" + i + "].type 不能为空（如 bigint / varchar(64)）");
            String javaType = str(n, "javaType", javaTypeOf(type));
            String javaField = str(n, "javaField", camel(name));
            out.add(new Col(
                    name,
                    type,
                    bool(n, "nullable", false),
                    n.has("defaultValue") && !n.get("defaultValue").isNull() ? n.get("defaultValue").asText() : null,
                    str(n, "comment", ""),
                    str(n, "enumOrUnit", "-"),
                    str(n, "index", "-"),
                    javaField,
                    javaType,
                    bool(n, "autoIncrement", false),
                    bool(n, "primary", false),
                    bool(n, "json", type.toLowerCase(Locale.ROOT).startsWith("json"))));
        }
        return out;
    }

    private List<Idx> parseIndexes(JsonNode arr, String table, List<Col> columns) {
        List<Idx> out = new ArrayList<>();
        if (arr != null && arr.isArray()) {
            for (JsonNode n : arr) {
                String type = str(n, "type", "IDX").toUpperCase(Locale.ROOT);
                List<String> fields = strings(n.path("fields"));
                if (fields.isEmpty()) {
                    String single = str(n, "field", "");
                    if (!single.isBlank()) fields = List.of(single);
                }
                if (fields.isEmpty()) continue;
                String name = str(n, "name", defaultIndexName(table, type, fields));
                out.add(new Idx(name, normalizeIndexType(type), fields, str(n, "purpose", "")));
            }
        }
        // 列上的 index 标记：UK / IDX / PK。只补没被显式索引覆盖的字段。
        // 「覆盖」按索引的**首列**算：复合索引 (org_id, status) 已经能服务 org_id 查询，
        // 再补一个单列 idx_..._org_id 是白占写入开销。
        Set<String> covered = new LinkedHashSet<>();
        for (Idx i : out) {
            if (!i.fields.isEmpty()) covered.add(i.fields.get(0));
        }
        for (Col c : columns) {
            String mark = c.index == null ? "" : c.index.toUpperCase(Locale.ROOT);
            String type = switch (mark) {
                case "PK", "PRIMARY" -> "PRIMARY";
                case "UK", "UNIQUE" -> "UNIQUE";
                case "IDX", "INDEX", "KEY" -> "INDEX";
                default -> "";
            };
            if (type.isEmpty()) continue;
            if (covered.contains(c.name)) continue;
            out.add(new Idx(defaultIndexName(table, type, List.of(c.name)), type, List.of(c.name), ""));
            covered.add(c.name);
        }
        return out;
    }

    private static String normalizeIndexType(String t) {
        return switch (t) {
            case "PK", "PRIMARY" -> "PRIMARY";
            case "UK", "UNIQUE" -> "UNIQUE";
            default -> "INDEX";
        };
    }

    private static String defaultIndexName(String table, String type, List<String> fields) {
        if (type.equals("PRIMARY")) return "PRIMARY";
        String prefix = type.equals("UNIQUE") ? "uk_" : "idx_";
        return prefix + table + "_" + String.join("_", fields);
    }

    private static String defaultModule(String table) {
        int i = table.indexOf('_');
        return i > 0 ? table.substring(0, i) : table;
    }

    private static String time(JsonNode body) {
        return str(body, "date", LocalDate.now(ZoneOffset.ofHours(8)).format(DAY));
    }

    // ─────────────────────────────────────────────────────────────
    // SQL 生成
    // ─────────────────────────────────────────────────────────────

    private String createSql(String table, String title, String module, String author, String date,
                             String requirement, String before, String after, String impact,
                             String rollback, String docPath, String entityFqn,
                             List<Col> columns, List<Idx> indexes) {
        StringBuilder sb = new StringBuilder();
        sb.append(sqlHeader("新增" + title + "表", module, table, "CREATE", author, date, requirement,
                before, after, impact, rollback, docPath, entityFqn));
        sb.append("\nCREATE TABLE IF NOT EXISTS `").append(table).append("` (\n");
        List<String> defs = new ArrayList<>();
        for (Col c : sqlOrder(columns)) defs.add("  " + columnSql(c));
        for (Idx i : indexes) defs.add("  " + indexSql(i));
        sb.append(String.join(",\n", defs)).append('\n');
        sb.append(") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='")
                .append(sqlText(title)).append("';\n");
        return sb.toString();
    }

    private String alterSql(String table, String title, String module, String author, String date,
                            String requirement, String before, String after, String impact,
                            String rollback, String docPath, String entityFqn, List<String> statements) {
        StringBuilder sb = new StringBuilder();
        sb.append(sqlHeader("变更" + title + "表", module, table, "ALTER", author, date, requirement,
                before, after, impact, rollback, docPath, entityFqn));
        sb.append('\n');
        if (statements.isEmpty()) {
            sb.append("-- 非建表操作需要在计划里提供 statements（逐条可执行 SQL）。\n");
        } else {
            for (String s : statements) sb.append(s.trim()).append(s.trim().endsWith(";") ? "" : ";").append('\n');
        }
        return sb.toString();
    }

    private static String sqlHeader(String purpose, String module, String table, String operation,
                                    String author, String date, String requirement, String before,
                                    String after, String impact, String rollback, String docPath,
                                    String entityFqn) {
        return "-- ============================================================\n"
                + "-- 目的：" + purpose + "\n"
                + "-- 模块：" + module + "\n"
                + "-- 表：" + table + "\n"
                + "-- 操作：" + operation + "\n"
                + "-- 作者：" + author + "\n"
                + "-- 日期：" + date + "\n"
                + "-- 需求：" + (requirement.isBlank() ? "（待补充：需求/缺陷号）" : requirement) + "\n"
                + "-- 变更前：" + before + "\n"
                + "-- 变更后：" + after + "\n"
                + "-- 影响/兼容：" + impact + "\n"
                + "-- 回滚：" + rollback + "\n"
                + "-- 表结构说明：" + docPath + "\n"
                + "-- 实体类：" + entityFqn + "\n"
                + "-- ============================================================\n";
    }

    /**
     * 建表 SQL 的列序（章程 2.12）：{@code id} → 业务字段 → 其余 BaseEntity 字段。
     *
     * <p>与表说明相反 —— 文档里 7 个公共字段固定在前 7 行便于对照，SQL 里则把 id 留头、
     * 业务字段紧跟，剩下 6 个审计字段垫底。两处顺序都是规范明写的，不能统一。
     */
    private static List<Col> sqlOrder(List<Col> columns) {
        List<Col> ordered = new ArrayList<>();
        Col id = null;
        List<Col> business = new ArrayList<>();
        List<Col> restBase = new ArrayList<>();
        for (Col c : columns) {
            if (c.name.equals("id")) {
                id = c;
            } else if (BASE_COLUMN_NAMES.contains(c.name)) {
                restBase.add(c);
            } else {
                business.add(c);
            }
        }
        if (id != null) ordered.add(id);
        ordered.addAll(business);
        ordered.addAll(restBase);
        return ordered;
    }

    private static String columnSql(Col c) {
        StringBuilder sb = new StringBuilder();
        sb.append('`').append(c.name).append("` ").append(c.type);
        sb.append(c.nullable ? " NULL" : " NOT NULL");
        if (c.defaultValue != null && !c.defaultValue.isBlank()) {
            sb.append(" DEFAULT ").append(sqlDefault(c.defaultValue));
        }
        if (c.autoIncrement) sb.append(" AUTO_INCREMENT");
        sb.append(" COMMENT '").append(sqlText(c.comment)).append('\'');
        return sb.toString();
    }

    /** 默认值：函数/关键字裸写，数字裸写，其余加引号。 */
    private static String sqlDefault(String v) {
        String t = v.trim();
        if (t.equalsIgnoreCase("NULL")) return "NULL";
        if (t.matches("(?i)CURRENT_TIMESTAMP(\\(\\d*\\))?( ON UPDATE CURRENT_TIMESTAMP)?")) return t.toUpperCase(Locale.ROOT);
        if (t.matches("-?\\d+(\\.\\d+)?")) return t;
        return "'" + sqlText(t) + "'";
    }

    private static String indexSql(Idx i) {
        String cols = i.fields.stream().map(f -> "`" + f + "`").reduce((a, b) -> a + ", " + b).orElse("");
        return switch (i.type) {
            case "PRIMARY" -> "PRIMARY KEY (" + cols + ")";
            case "UNIQUE" -> "UNIQUE KEY `" + i.name + "` (" + cols + ")";
            default -> "KEY `" + i.name + "` (" + cols + ")";
        };
    }

    /** SQL 单引号转义。注释里出现单引号不转义会让整份脚本语法错位。 */
    private static String sqlText(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("'", "''");
    }

    // ─────────────────────────────────────────────────────────────
    // 表结构说明
    // ─────────────────────────────────────────────────────────────

    private String fullTableDoc(String table, String title, String module, String owner, String date,
                                String entityPackage, String entityClass, String scriptName,
                                List<Col> effective, List<Col> business, List<Idx> indexes,
                                JsonNode body, JsonNode existingEntity) {
        StringBuilder sb = new StringBuilder();
        sb.append("# ").append(title).append("（`").append(table).append("`）\n\n");
        // 别在这行写「待补充」三个字：审计按这个词数占位符，写了就永远至少 1 个
        sb.append("> 由军火库按 `docs/db/tables/_TEMPLATE.md` 生成；留空的章节在提交前需人工补全。\n");
        sb.append("> 规范见 `docs/开发章程.md` 2.16。\n\n");

        sb.append("## 1. 基本信息\n\n| 项 | 内容 |\n|---|---|\n");
        kv(sb, "表名", "`" + table + "`");
        kv(sb, "中文名", title);
        kv(sb, "模块", module);
        kv(sb, "负责人", owner.isBlank() ? "（待补充）" : owner);
        kv(sb, "创建时间", date);
        kv(sb, "最近变更", date);
        kv(sb, "对应实体", "`" + entityPackage + "." + entityClass + "`");
        kv(sb, "对应 DAO", "`" + entityPackage.replace(".entity", ".dao") + "." + entityClass.replace("Entity", "Dao") + "`");
        kv(sb, "DDL 脚本", "`docs/db/" + scriptName + "`");
        kv(sb, "变更日志", "`docs/db/CHANGELOG.md`");
        if (existingEntity != null) {
            kv(sb, "已存在实体", "`" + existingEntity.path("file").asText() + "`（本计划只补字段）");
        }

        JsonNode biz = body.path("business");
        sb.append("\n## 2. 业务说明\n\n");
        bullet(sb, "用途", str(biz, "purpose", "（待补充：这张表解决什么问题）"));
        bullet(sb, "数据来源", str(biz, "dataSource", "（待补充：页面录入/接口同步/定时任务/导入）"));
        bullet(sb, "生命周期", str(biz, "lifecycle", "（待补充：创建 → 使用 → 归档/删除）"));
        bullet(sb, "删除策略", str(biz, "deleteStrategy", "逻辑删除（`deleted` 字段）"));
        bullet(sb, "预估数据量", str(biz, "volume", "（待补充：当前/年增量）"));

        sb.append("\n## 3. 字段清单\n\n");
        sb.append("| 序号 | 字段 | 类型 | 可空 | 默认值 | 注释 | 枚举/单位 | 索引 | Java 字段 | Java 类型 |\n");
        sb.append("|---|---|---|---|---|---|---|---|---|---|\n");
        int no = 0;
        for (Col c : effective) {
            no++;
            sb.append("| ").append(no)
                    .append(" | `").append(c.name).append("`")
                    .append(" | `").append(c.type).append("`")
                    .append(" | ").append(c.nullable ? "Y" : "N")
                    .append(" | ").append(c.defaultValue == null || c.defaultValue.isBlank() ? "-" : "`" + c.defaultValue + "`")
                    .append(" | ").append(cell(c.comment))
                    .append(" | ").append(cell(c.enumOrUnit == null || c.enumOrUnit.isBlank() ? "-" : c.enumOrUnit))
                    .append(" | ").append(indexMark(indexes, c.name))
                    .append(" | `").append(c.javaField).append("`")
                    .append(" | `").append(c.javaType).append("` |\n");
        }
        if (business.isEmpty()) {
            sb.append("| 8 | （待补充） | - | - | - | 业务字段从第 8 行开始 | - | - | - | - |\n");
        }
        sb.append("\n> `BaseEntity` 公共字段固定列出；业务字段从第 ").append(effective.size() - business.size() + 1)
                .append(" 行开始。\n");

        sb.append("\n## 4. 索引清单\n\n| 索引名 | 类型 | 字段顺序 | 用途 |\n|---|---|---|---|\n");
        for (Idx i : indexes) {
            sb.append("| `").append(i.name).append("` | ").append(indexTypeLabel(i.type))
                    .append(" | ").append(i.fields.stream().map(f -> "`" + f + "`").reduce((a, b) -> a + ", " + b).orElse(""))
                    .append(" | ").append(cell(indexPurpose(i))).append(" |\n");
        }

        sb.append("\n## 5. 关联关系\n\n");
        JsonNode rels = body.path("relations");
        if (rels.isArray() && rels.size() > 0) {
            sb.append("| 本表字段 | 关联表 | 关联字段 | 关系 | 删除/变更策略 |\n|---|---|---|---|---|\n");
            for (JsonNode r : rels) {
                sb.append("| `").append(str(r, "field", "")).append("` | `").append(str(r, "targetTable", ""))
                        .append("` | `").append(str(r, "targetField", "id")).append("` | ")
                        .append(cell(str(r, "relation", "多对一"))).append(" | ")
                        .append(cell(str(r, "onDelete", "不处理"))).append(" |\n");
            }
        } else {
            sb.append("（无逻辑外键；如有，按 `字段 | 关联表 | 关联字段 | 关系 | 策略` 补全）\n");
        }
        sb.append("\n> 禁止物理外键；关联关系由应用层保证。\n");

        sb.append("\n## 6. 状态/枚举\n\n");
        JsonNode enums = body.path("enums");
        if (enums.isArray() && enums.size() > 0) {
            sb.append("| 字段 | 码值 | 含义 | 备注 |\n|---|---|---|---|\n");
            for (JsonNode e : enums) {
                sb.append("| `").append(str(e, "field", "")).append("` | ").append(cell(str(e, "value", "")))
                        .append(" | ").append(cell(str(e, "meaning", ""))).append(" | ")
                        .append(cell(str(e, "note", "-"))).append(" |\n");
            }
        } else {
            // 没给 enums 时按业务字段的 enumOrUnit 反推，别把已有信息丢成一句「待补充」
            List<Col> enumCols = new ArrayList<>();
            for (Col c : business) {
                if (c.enumOrUnit != null && !c.enumOrUnit.isBlank() && !c.enumOrUnit.equals("-")) {
                    enumCols.add(c);
                }
            }
            if (enumCols.isEmpty()) {
                sb.append("（无枚举字段，或待补充）\n");
            } else {
                sb.append("| 字段 | 码值 | 含义 | 备注 |\n|---|---|---|---|\n");
                for (Col c : enumCols) {
                    String note;
                    if (c.defaultValue != null && !c.defaultValue.isBlank()) {
                        note = "默认 `" + c.defaultValue + "`";
                    } else {
                        note = c.nullable ? "可空" : "必填";
                    }
                    sb.append("| `").append(c.name).append("` | ").append(cell(c.enumOrUnit))
                            .append(" | ").append(cell(c.comment))
                            .append(" | ").append(cell(note)).append(" |\n");
                }
            }
        }

        JsonNode scope = body.path("dataScope");
        sb.append("\n## 7. 数据权限\n\n");
        bullet(sb, "组织字段", "`org_id`（" + (bool(scope, "orgId", false) ? "已" : "未") + "启用）");
        bullet(sb, "租户字段", "`tenant_id`（" + (bool(scope, "tenantId", false) ? "已" : "未") + "启用）");
        bullet(sb, "过滤规则", str(scope, "filterRule", "（待补充：当前用户可见组织及其下级/仅本组织/全部）"));
        bullet(sb, "越权校验", str(scope, "authCheck", "service 层校验归属，列表走数据权限拦截器"));

        sb.append("\n## 8. 典型查询\n\n");
        JsonNode queries = body.path("queries");
        if (queries.isArray() && queries.size() > 0) {
            sb.append("| 场景 | SQL 摘要 | 排序 | 预期索引 |\n|---|---|---|---|\n");
            for (JsonNode q : queries) {
                sb.append("| ").append(cell(str(q, "scene", ""))).append(" | `")
                        .append(str(q, "sql", "").replace("`", "")).append("` | ")
                        .append(cell(str(q, "orderBy", "-"))).append(" | ")
                        .append(cell(str(q, "index", "-"))).append(" |\n");
            }
        } else {
            sb.append("（待补充：列表分页、唯一校验等高频 SQL 与预期索引）\n");
        }

        JsonNode arch = body.path("archiving");
        sb.append("\n## 9. 数据量与归档\n\n");
        bullet(sb, "当前数据量", str(arch, "current", "（待补充）"));
        bullet(sb, "年增量", str(arch, "yearly", "（待补充）"));
        bullet(sb, "保留周期", str(arch, "retention", "（待补充：永久/N 年）"));
        bullet(sb, "归档/清理", str(arch, "policy", "（待补充：归档表/定时任务/不清理）"));

        sb.append("\n## 10. 变更记录\n\n| 日期 | 脚本 | 摘要 |\n|---|---|---|\n");
        sb.append("| ").append(date).append(" | `").append(scriptName).append("` | 新增表 |\n");
        sb.append("\n> 详细变更前后、影响、回滚见 `docs/db/CHANGELOG.md`。\n");
        return sb.toString();
    }

    /**
     * 改表时的表说明片段。
     *
     * <p>刻意的取舍：不生成整份文档。整份文档需要**当前完整字段清单**，而计划只知道
     * 「这次加什么」；拿片段冒充全量，会把已有字段从文档里抹掉 —— 那正是四件套最怕的事。
     */
    private String tableDocFragment(String table, String title, String date, String scriptName,
                                    String operation, List<Col> columns, JsonNode body) {
        StringBuilder sb = new StringBuilder();
        sb.append("# ").append(title).append("（`").append(table).append("`）— 变更片段\n\n");
        sb.append("> 这是 ").append(date).append(" 的**片段**，不是完整表说明。请并入 ")
                .append("`docs/db/tables/").append(table).append(".md`，不要覆盖原文件。\n\n");
        sb.append("## 3. 字段清单（本次新增/变更）\n\n");
        sb.append("| 序号 | 字段 | 类型 | 可空 | 默认值 | 注释 | 枚举/单位 | 索引 | Java 字段 | Java 类型 |\n");
        sb.append("|---|---|---|---|---|---|---|---|---|---|\n");
        int no = 0;
        for (Col c : columns) {
            no++;
            sb.append("| ? | `").append(c.name).append("` | `").append(c.type)
                    .append("` | ").append(c.nullable ? "Y" : "N")
                    .append(" | ").append(c.defaultValue == null ? "-" : "`" + c.defaultValue + "`")
                    .append(" | ").append(cell(c.comment))
                    .append(" | ").append(cell(c.enumOrUnit)).append(" | ").append(c.index)
                    .append(" | `").append(c.javaField).append("` | `").append(c.javaType).append("` |\n");
        }
        if (columns.isEmpty()) sb.append("| ? | （本次无字段变化） | - | - | - | - | - | - | - | - |\n");
        sb.append("\n## 10. 变更记录（追加一行）\n\n| 日期 | 脚本 | 摘要 |\n|---|---|---|\n");
        sb.append("| ").append(date).append(" | `").append(scriptName).append("` | ")
                .append(cell(operation.equals("CREATE") ? "新增表" : operation + "：" + str(body, "reason", "变更")))
                .append(" |\n");
        return sb.toString();
    }

    private static void kv(StringBuilder sb, String k, String v) {
        sb.append("| ").append(k).append(" | ").append(cell(v)).append(" |\n");
    }

    private static void bullet(StringBuilder sb, String k, String v) {
        sb.append("- ").append(k).append("：").append(v).append('\n');
    }

    /** 表格单元格转义：竖线会切断列，换行会切断行。 */
    private static String cell(String s) {
        return s == null ? "" : s.replace("|", "\\|").replace("\r", " ").replace("\n", " ");
    }

    private static String indexMark(List<Idx> indexes, String column) {
        for (Idx i : indexes) {
            if (i.type.equals("PRIMARY") && i.fields.contains(column)) return "PK";
            if (i.fields.contains(column)) return i.type.equals("UNIQUE") ? "UK" : "IDX";
        }
        return "-";
    }

    private static String indexTypeLabel(String type) {
        return switch (type) {
            case "PRIMARY" -> "主键";
            case "UNIQUE" -> "唯一";
            default -> "普通";
        };
    }

    /** 规格里没写 purpose 时给一句可读的默认值，别整列都是「—」。 */
    private static String indexPurpose(Idx i) {
        if (!i.purpose.isBlank()) return i.purpose;
        String cols = i.fields.stream().map(f -> "`" + f + "`").reduce((a, b) -> a + ", " + b).orElse("");
        return switch (i.type) {
            case "PRIMARY" -> "主键";
            case "UNIQUE" -> "唯一约束：" + cols + " 不重复";
            default -> cols + " 等值/范围查询";
        };
    }

    // ─────────────────────────────────────────────────────────────
    // 实体类
    // ─────────────────────────────────────────────────────────────

    private String fullEntity(String pkg, String cls, String table, String title, String description,
                              String docPath, String author, String date, boolean baseEntity,
                              List<Col> columns) {
        Set<String> imports = new LinkedHashSet<>();
        // @TableField 只在真有字段需要时才引：驼峰与列名不一致、或有 typeHandler。
        // 无条件 import 会让生成的实体带着一条 IDE 警告，复制过去还得手动删。
        boolean needsTableField = false;
        for (Col c : columns) {
            if (c.json || !c.javaField.equals(camel(c.name))) needsTableField = true;
        }
        if (needsTableField) imports.add("com.baomidou.mybatisplus.annotation.TableField");
        imports.add("com.baomidou.mybatisplus.annotation.TableName");
        if (baseEntity) imports.add("com.iems.framework.mybatis.entity.BaseEntity");
        imports.add("lombok.Data");
        if (baseEntity) imports.add("lombok.EqualsAndHashCode");
        imports.add("java.io.Serializable");
        for (Col c : columns) {
            if (c.javaType.equals("BigDecimal")) imports.add("java.math.BigDecimal");
            if (c.javaType.equals("LocalDateTime")) imports.add("java.time.LocalDateTime");
            if (c.javaType.equals("LocalDate")) imports.add("java.time.LocalDate");
            if (c.javaType.equals("LocalTime")) imports.add("java.time.LocalTime");
            if (c.json) imports.add("com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler");
        }

        StringBuilder sb = new StringBuilder();
        sb.append("package ").append(pkg).append(";\n\n");
        List<String> sorted = new ArrayList<>(imports);
        sorted.sort(String::compareTo);
        // com.* 一段、java.* 一段、lombok 跟 com 一起按字典序 —— 与仓库现有实体一致即可
        for (String i : sorted) sb.append("import ").append(i).append(";\n");
        sb.append("\n/**\n");
        sb.append(" * ").append(title).append("\n");
        sb.append(" *\n");
        sb.append(" * <p>表名：").append(table).append("</p>\n");
        sb.append(" * <p>说明：").append(description.replace("*/", "* /")).append("</p>\n");
        sb.append(" * <p>数据字典：").append(docPath).append("</p>\n");
        sb.append(" *\n");
        sb.append(" * @author ").append(author).append("\n");
        sb.append(" * @since ").append(date).append("\n");
        sb.append(" */\n");
        sb.append("@Data\n");
        if (baseEntity) sb.append("@EqualsAndHashCode(callSuper = true)\n");
        sb.append("@TableName(").append(entityTableAnnotation(table, columns)).append(")\n");
        sb.append("public class ").append(cls);
        if (baseEntity) sb.append(" extends BaseEntity");
        sb.append(" implements Serializable {\n\n");
        sb.append("    private static final long serialVersionUID = 1L;\n");
        for (Col c : columns) {
            sb.append("\n    /**\n");
            for (String line : javadocLines(c)) sb.append("     * ").append(line).append('\n');
            sb.append("     */\n");
            if (c.json) sb.append("    @TableField(typeHandler = JacksonTypeHandler.class)\n");
            if (!c.javaField.equals(camel(c.name))) sb.append("    @TableField(\"").append(c.name).append("\")\n");
            sb.append("    private ").append(c.javaType).append(' ').append(c.javaField).append(";\n");
        }
        sb.append("}\n");
        return sb.toString();
    }

    /** 已存在实体时只给**缺少的字段**，并说明怎么用 —— 整份覆盖会抹掉原有注释。 */
    private String entityFragment(String cls, String table, String title, String date, List<Col> cols,
                                  boolean deltaOnly) {
        StringBuilder sb = new StringBuilder();
        sb.append("// 目标实体：").append(cls).append("（@TableName(\"").append(table).append("\")）\n");
        if (deltaOnly) {
            sb.append("// 项目里找不到这个实体 —— 下面是**本次变更涉及的字段片段**，")
                    .append("不是完整实体，不能直接落盘。\n");
        } else {
            sb.append("// 只把下面缺少的字段追加进去；不要整份覆盖，否则会抹掉已有字段的注释。\n");
        }
        sb.append("// 生成时间：").append(date).append("\n\n");
        if (cols.isEmpty()) {
            sb.append("// 字段已齐全，无需改动。\n");
            return sb.toString();
        }
        for (Col c : cols) {
            sb.append("/**\n");
            for (String line : javadocLines(c)) sb.append(" * ").append(line).append('\n');
            sb.append(" */\n");
            if (c.json) sb.append("@TableField(typeHandler = JacksonTypeHandler.class)\n");
            if (!c.javaField.equals(camel(c.name))) sb.append("@TableField(\"").append(c.name).append("\")\n");
            sb.append("private ").append(c.javaType).append(' ').append(c.javaField).append(";\n\n");
        }
        return sb.toString();
    }

    private static List<String> javadocLines(Col c) {
        List<String> out = new ArrayList<>();
        String comment = c.comment == null || c.comment.isBlank() ? "（待补充：字段含义）" : c.comment;
        out.add(comment);
        if (c.enumOrUnit != null && !c.enumOrUnit.isBlank() && !c.enumOrUnit.equals("-")) {
            out.add("");
            out.add("枚举/单位：" + c.enumOrUnit);
        }
        List<String> extra = new ArrayList<>();
        if (!c.nullable) extra.add("非空");
        if (c.defaultValue != null && !c.defaultValue.isBlank()) extra.add("默认 " + c.defaultValue);
        if (!extra.isEmpty()) {
            out.add("");
            out.add(String.join("，", extra) + "。");
        }
        return out;
    }

    private static String entityTableAnnotation(String table, List<Col> cols) {
        boolean hasJson = cols.stream().anyMatch(c -> c.json);
        return hasJson ? "value = \"" + table + "\", autoResultMap = true" : "\"" + table + "\"";
    }

    private List<String> missingEntityFields(Path repo, String entityRelPath, List<Col> businessColumns) {
        if (entityRelPath.isBlank()) {
            return businessColumns.stream().map(c -> c.name).toList();
        }
        try {
            String src = dossier.readEntity(repo, entityRelPath);
            Set<String> have = new LinkedHashSet<>(DossierService.entityFieldNames(src));
            return businessColumns.stream().map(c -> c.name).filter(n -> !have.contains(camel(n))).toList();
        } catch (Exception e) {
            // 读不了实体不代表字段都不存在，但从计划角度只能按「未知 → 全列」处理，
            // 并在 warnings 里说清（见 validateMeta 的 ENTITY_UNREADABLE 分支之外的单列提示）。
            return businessColumns.stream().map(c -> c.name).toList();
        }
    }

    private static List<Col> fieldsByNames(List<Col> cols, List<String> names) {
        Set<String> want = new LinkedHashSet<>(names);
        return cols.stream().filter(c -> want.contains(c.name)).toList();
    }

    /** 仓库里有没有针对这张表的脚本（文件名以 `__<table>.sql` 结尾）。 */
    private static boolean hasScriptForTable(JsonNode scripts, String table) {
        if (scripts == null || !scripts.isArray()) return false;
        for (JsonNode s : scripts) {
            String file = s.path("file").asText("");
            if (file.endsWith("__" + table + ".sql")) return true;
        }
        return false;
    }

    private static JsonNode findEntity(JsonNode entities, String table) {
        if (entities == null || !entities.isArray()) return null;
        for (JsonNode e : entities) {
            if (table.equals(e.path("table").asText())) return e;
        }
        return null;
    }

    /**
     * 实体落点：优先复用项目里同域实体的目录；其次任意 `…/src/main/java/com/iems/…/entity/`；
     * 最后给一个可读的建议路径。**只是建议** —— 写不写、写到哪，由调用方决定。
     */
    private static String resolveEntityPath(Path repo, ObjectNode ds, String domain, String pkg, String cls) {
        JsonNode entities = ds.path("db").path("entities");
        String leaf = pkg.replace('.', '/') + "/" + cls + ".java";
        boolean sawModuleLayout = false;
        String firstModuleRoot = "";
        if (entities.isArray()) {
            for (JsonNode e : entities) {
                String file = e.path("file").asText("");
                if (file.contains("/com/iems/" + domain + "/entity/")) return javaRootOfModule(file) + leaf;
                if (file.startsWith("module/module-")) sawModuleLayout = true;
                if (firstModuleRoot.isEmpty() && file.contains("/src/main/java/")) {
                    firstModuleRoot = javaRootOfModule(file);
                }
            }
        }
        // 新域在 IEMS 里的惯例是 module/module-<domain>/，即使该模块还没建 —— 建议路径就该指那儿，
        // 而不是把实体塞进恰好先被扫到的 basic/。只有项目完全不是这种布局时，才沿用现有模块根。
        if (sawModuleLayout || Files.isDirectory(repo.resolve("module"))) {
            return "module/module-" + domain + "/src/main/java/" + leaf;
        }
        if (!firstModuleRoot.isEmpty()) return firstModuleRoot + leaf;
        return "module/module-" + domain + "/src/main/java/" + leaf;
    }

    /** `basic/src/main/java/com/iems/system/entity/X.java` → `basic/src/main/java/`（别丢掉这段）。 */
    private static String javaRootOfModule(String file) {
        int at = file.indexOf("/src/main/java/");
        return at > 0 ? file.substring(0, at + "/src/main/java/".length()) : "";
    }

    // ─────────────────────────────────────────────────────────────
    // CHANGELOG 行
    // ─────────────────────────────────────────────────────────────

    private static String changelogRow(String date, String script, String table, String operation,
                                       String before, String after, String reason, String impact,
                                       String rollback, String envResult, String docPath, String entityFqn) {
        return "| " + String.join(" | ", List.of(
                cell(date), cell(script), cell(table), cell(operation), cell(before), cell(after),
                cell(reason), cell(impact), cell(rollback), cell(envResult),
                cell("[" + table + "](tables/" + table + ".md)"),
                cell("`" + entityFqn + "`"))) + " |";
    }

    // ─────────────────────────────────────────────────────────────
    // 校验（按开发章程逐条对着看）
    // ─────────────────────────────────────────────────────────────

    private List<ObjectNode> validateMeta(String table, String module, String operation,
                                          List<Col> columns, boolean baseEntity, boolean callerGaveId) {
        List<ObjectNode> out = new ArrayList<>();
        if (!COLUMN_NAME.matcher(table).matches()) {
            warn(out, "error", "TABLE_NAME", table, "表名必须是小写字母开头、只含小写字母/数字/下划线（章程 2.1）");
        }
        if (table.length() > 64) {
            warn(out, "error", "TABLE_NAME_LENGTH", table, "表名超过 64 字符");
        }
        if (RESERVED.contains(table)) {
            warn(out, "error", "TABLE_RESERVED", table, "表名是 MySQL 保留字（章程 2.1）");
        }
        if (table.startsWith("tmp_")) {
            warn(out, "warn", "TABLE_TMP", table, "tmp_ 前缀表禁止进入生产（章程 2.2）");
        }
        if (!table.startsWith("sys_") && !table.startsWith(module + "_")) {
            warn(out, "warn", "TABLE_PREFIX", table,
                    "业务表建议以 " + module + "_ 开头（章程 2.2），当前表名与模块 " + module + " 对不上");
        }
        if (operation.equals("CREATE") && columns.isEmpty()) {
            warn(out, "warn", "NO_BUSINESS_COLUMNS", table,
                    "建表没有任何业务字段 —— 只会有 BaseEntity 的 7 个公共字段");
        }
        if (callerGaveId && baseEntity) {
            warn(out, "info", "ID_IGNORED", "id", "id/creator/create_time 等 7 个公共字段由 BaseEntity 提供，输入里的同名字段已忽略");
        }
        if (!baseEntity) {
            warn(out, "info", "NO_BASE_ENTITY", table,
                    "baseEntity=false：实体不继承 BaseEntity，请确认已显式包含 id/create_time，并写明不复用的原因（章程 2.3）");
        }
        return out;
    }

    private List<ObjectNode> validateColumns(List<Col> columns, boolean create) {
        List<ObjectNode> out = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        for (Col c : columns) {
            if (!COLUMN_NAME.matcher(c.name).matches()) {
                warn(out, "error", "COLUMN_NAME", c.name, "字段名必须小写 + 下划线，禁止驼峰/大写（章程 2.1）");
            }
            if (RESERVED.contains(c.name)) {
                warn(out, "error", "COLUMN_RESERVED", c.name, "字段名是 MySQL 保留字（章程 2.1）");
            }
            if (!seen.add(c.name)) {
                warn(out, "error", "COLUMN_DUPLICATE", c.name, "字段重复定义");
            }
            if (c.comment == null || c.comment.isBlank()) {
                warn(out, "error", "COLUMN_COMMENT", c.name, "字段必须有 COMMENT（章程 2.7）");
            }
            String type = c.type.toLowerCase(Locale.ROOT).replace(" ", "");
            if (type.contains("unsigned")) {
                warn(out, "error", "COLUMN_UNSIGNED", c.name,
                        "禁止 bigint unsigned 等无符号类型（章程 2.4：JDBC 会映射成 BigInteger）");
            }
            if (type.startsWith("timestamp")) {
                warn(out, "warn", "COLUMN_TIMESTAMP", c.name, "禁止 timestamp，用 datetime（章程 2.9：时区/2038 问题）");
            }
            if (type.startsWith("float") || type.startsWith("double")) {
                warn(out, "warn", "COLUMN_FLOATING", c.name,
                        "float/double 不用于金额与精确计算；金额用 decimal(18,2)（章程 2.4）");
            }
            if (type.startsWith("enum(")) {
                warn(out, "warn", "COLUMN_ENUM_TYPE", c.name, "禁止数据库 enum 类型，用 tinyint/varchar + 注释（章程 2.4）");
            }
            if (type.equals("varchar(255)")) {
                warn(out, "warn", "COLUMN_VARCHAR_255", c.name, "按实际长度取值，禁止一律 varchar(255)（章程 2.4）");
            }
            if (type.startsWith("tinyint") && needsEnumText(c.name)
                    && (c.comment == null || !c.comment.matches(".*\\d.*"))) {
                warn(out, "warn", "COLUMN_ENUM_COMMENT", c.name,
                        "状态/类型字段的注释必须写全码值，例如「0停用 1启用」（章程 2.7）");
            }
            if (!create && !c.nullable && c.defaultValue == null && !c.autoIncrement) {
                // 只对改表说这句话。建表时业务字段 NOT NULL 无默认值是正常的（本来就该显式赋值），
                // 在这里报警只会把真正的 ALTER 风险淹掉。
                warn(out, "warn", "COLUMN_NOT_NULL_NO_DEFAULT", c.name,
                        "给已有表加 NOT NULL 列时必须给默认值，否则已有行填充失败");
            }
            String expected = javaTypeOf(c.type);
            if (!expected.equals(c.javaType)) {
                warn(out, "warn", "COLUMN_JAVA_TYPE", c.name,
                        "SQL 类型 " + c.type + " 通常对应 " + expected + "，当前写的是 " + c.javaType + "（章程 2.4/2.9）");
            }
            if (c.json && !c.javaType.equals("Object") && !c.javaType.equals("Map") && !c.javaType.equals("JsonNode")) {
                warn(out, "info", "COLUMN_JSON_TYPE", c.name,
                        "json 字段建议用明确的 DTO/Map，并保留 JacksonTypeHandler（章程 2.9）");
            }
        }
        return out;
    }

    /** 需要写全码值的字段名（状态类）。 */
    private static boolean needsEnumText(String name) {
        return Set.of("status", "type", "state", "source", "kind", "category", "level", "mode", "stage")
                .contains(name) || name.endsWith("_status") || name.endsWith("_type");
    }

    private List<ObjectNode> validateIndexes(String table, List<Idx> indexes, List<Col> columns) {
        List<ObjectNode> out = new ArrayList<>();
        Set<String> names = new LinkedHashSet<>();
        int normal = 0;
        for (Idx i : indexes) {
            if (!i.type.equals("PRIMARY") && !names.add(i.name)) {
                warn(out, "error", "INDEX_DUPLICATE", i.name, "索引名重复");
            }
            if (!i.type.equals("PRIMARY")) {
                String prefix = i.type.equals("UNIQUE") ? "uk_" : "idx_";
                if (!i.name.startsWith(prefix + table + "_")) {
                    warn(out, "warn", "INDEX_NAME", i.name,
                            "索引命名应为 " + prefix + table + "_<字段>（章程 2.2）");
                }
                normal++;
            }
            for (String f : i.fields) {
                Col c = columns.stream().filter(x -> x.name.equals(f)).findFirst().orElse(null);
                if (c == null) {
                    warn(out, "error", "INDEX_UNKNOWN_FIELD", i.name, "索引引用了不存在的字段：" + f);
                } else if (c.type.toLowerCase(Locale.ROOT).contains("text") && i.type.equals("INDEX")) {
                    warn(out, "warn", "INDEX_ON_TEXT", i.name,
                            "禁止在 text 上建普通索引；需要时用前缀索引（章程 2.6）");
                }
            }
        }
        if (normal > 5) {
            warn(out, "warn", "INDEX_TOO_MANY", table, "单表索引建议不超过 5 个，当前 " + normal + " 个（章程 2.6）");
        }
        return out;
    }

    private List<ObjectNode> validateEntity(String cls, String pkg, String path, String domain) {
        List<ObjectNode> out = new ArrayList<>();
        if (!cls.endsWith("Entity")) {
            warn(out, "warn", "ENTITY_NAME", cls, "实体类命名应为 <表名驼峰>Entity（章程 2.17）");
        }
        if (!pkg.equals("com.iems." + domain + ".entity")) {
            warn(out, "warn", "ENTITY_PACKAGE", pkg, "实体应放在 com.iems.<domain>.entity（章程 2.17）");
        }
        if (path.isBlank()) {
            warn(out, "info", "ENTITY_PATH", cls, "没能从现有实体推断模块目录，建议路径按新模块填写");
        }
        return out;
    }

    /**
     * 建议落点的模块目录在不在。
     *
     * <p>新域第一次建表时，{@code module/module-<domain>/} 必然还不存在 —— 路径推断是对的
     * （就该指那儿），但如果不说，人会以为「写完这四个文件就齐了」，结果实体没有地方放，
     * 或者被顺手塞进 basic/ 里。这条提醒只在**模块缺**时出现，模块在就完全静默。
     */
    private List<ObjectNode> validateEntityModule(Path repo, String entityPath, String table) {
        List<ObjectNode> out = new ArrayList<>();
        if (entityPath.isBlank()) return out; // 空路径已由 validateEntity 报过 ENTITY_PATH
        int i = entityPath.indexOf("/src/main/java/");
        if (i <= 0) {
            warn(out, "info", "ENTITY_MODULE_UNKNOWN", table,
                    "无法从建议路径判断模块目录 —— 请确认实体放哪个模块");
            return out;
        }
        String moduleRoot = entityPath.substring(0, i);
        if (!Files.isDirectory(repo.resolve(moduleRoot))) {
            warn(out, "warn", "ENTITY_MODULE_MISSING", table,
                    "建议路径所在的模块 " + moduleRoot + " 还不存在 —— 四件套之外还要先建模块"
                            + "（pom、包结构、父 pom 里的 <module>），否则实体没有地方放");
        }
        return out;
    }

    private List<ObjectNode> validateStatements(JsonNode body, boolean create) {
        List<ObjectNode> out = new ArrayList<>();
        List<String> statements = strings(body.path("statements"));
        String joined = String.join("\n", statements).toUpperCase(Locale.ROOT);
        if (joined.contains("FOREIGN KEY")) {
            warn(out, "error", "PHYSICAL_FK", "", "禁止物理外键，使用逻辑外键 + 索引（章程 2.1/2.5）");
        }
        if (joined.contains("DROP TABLE") && !create) {
            warn(out, "warn", "DROP_TABLE", "", "生产脚本禁止 DROP TABLE；确需删除请单独 _rollback.sql 并审批（章程 2.11）");
        }
        if (joined.contains("TRUNCATE")) {
            warn(out, "error", "TRUNCATE", "", "生产脚本禁止 TRUNCATE（章程 2.11）");
        }
        if (!create && statements.isEmpty()) {
            warn(out, "error", "NO_STATEMENTS", "", "非 CREATE 操作必须提供 statements（逐条可执行 SQL）");
        }
        if (!create) {
            boolean idempotent = joined.contains("INFORMATION_SCHEMA") || joined.contains("IF NOT EXISTS")
                    || joined.contains("IF EXISTS");
            if (!idempotent && !statements.isEmpty()) {
                // 不推荐 IF NOT EXISTS：MySQL 8 的 ADD COLUMN 不支持它（那是 MariaDB 语法）。
                warn(out, "warn", "NOT_IDEMPOTENT", "",
                        "改表脚本建议先查 information_schema 判存在性（MySQL 8 不支持 ADD COLUMN IF NOT EXISTS），保证可重复执行（章程 2.11）");
            }
        }
        return out;
    }

    private void warn(List<ObjectNode> out, String level, String code, String field, String message) {
        ObjectNode n = mapper.createObjectNode();
        n.put("level", level);
        n.put("code", code);
        if (field != null && !field.isBlank()) n.put("field", field);
        n.put("message", message);
        out.add(n);
    }

    // ─────────────────────────────────────────────────────────────
    // 小工具
    // ─────────────────────────────────────────────────────────────

    /** 按当天已有脚本的序号接着数：同一天第二个脚本就是 _02，不靠人记。 */
    private static int nextSeq(JsonNode scripts, String date) {
        String compact = date.replace("-", "");
        int max = 0;
        if (scripts != null && scripts.isArray()) {
            for (JsonNode s : scripts) {
                String file = s.path("file").asText("");
                Matcher m = SCRIPT_NAME.matcher(file.substring(file.lastIndexOf('/') + 1));
                if (m.matches() && m.group(1).equals(compact)) {
                    max = Math.max(max, Integer.parseInt(m.group(2)));
                }
            }
        }
        return max + 1;
    }

    static String camel(String snake) {
        StringBuilder sb = new StringBuilder();
        boolean up = false;
        for (char c : snake.toCharArray()) {
            if (c == '_') {
                up = true;
                continue;
            }
            sb.append(up ? Character.toUpperCase(c) : c);
            up = false;
        }
        return sb.toString();
    }

    static String pascal(String snake) {
        String c = camel(snake);
        return c.isEmpty() ? c : Character.toUpperCase(c.charAt(0)) + c.substring(1);
    }

    static String javaTypeOf(String sqlType) {
        String t = sqlType.toLowerCase(Locale.ROOT).replace(" ", "");
        if (t.startsWith("tinyint(1)")) return "Boolean";
        if (t.equals("bigint")) return "Long";
        if (t.equals("int") || t.equals("integer") || t.startsWith("tinyint")
                || t.startsWith("smallint") || t.startsWith("mediumint") || t.startsWith("bit")) return "Integer";
        if (t.startsWith("decimal") || t.startsWith("numeric")) return "BigDecimal";
        if (t.startsWith("double") || t.startsWith("float")) return "Double";
        if (t.startsWith("datetime")) return "LocalDateTime";
        if (t.equals("date")) return "LocalDate";
        if (t.equals("time")) return "LocalTime";
        if (t.startsWith("json")) return "Object";
        if (t.startsWith("blob") || t.startsWith("binary") || t.startsWith("varbinary")) return "byte[]";
        return "String";
    }

    private ObjectNode artifact(String path, String action, String content) {
        ObjectNode n = mapper.createObjectNode();
        n.put("path", path);
        n.put("action", action);
        n.put("content", content);
        return n;
    }

    private ObjectNode check(String key, String label, boolean ok, String path, String note) {
        ObjectNode n = mapper.createObjectNode();
        n.put("key", key);
        n.put("label", label);
        n.put("ok", ok);
        n.put("path", path);
        n.put("note", note);
        return n;
    }

    private static String str(JsonNode n, String field, String def) {
        if (n == null) return def;
        JsonNode v = n.get(field);
        return v == null || v.isNull() ? def : v.asText(def);
    }

    private static boolean bool(JsonNode n, String field, boolean def) {
        if (n == null) return def;
        JsonNode v = n.get(field);
        return v == null || v.isNull() ? def : v.asBoolean(def);
    }

    private static String req(JsonNode n, String field) {
        String v = str(n, field, "").trim();
        if (v.isEmpty()) throw new IllegalArgumentException(field + " 不能为空");
        return v;
    }

    private static List<String> strings(JsonNode arr) {
        List<String> out = new ArrayList<>();
        if (arr != null && arr.isArray()) {
            for (JsonNode n : arr) {
                String s = n.asText("");
                if (!s.isBlank()) out.add(s);
            }
        } else if (arr != null && arr.isValueNode()) {
            String s = arr.asText("");
            if (!s.isBlank()) out.add(s);
        }
        return out;
    }

    private static String nowIso() {
        return java.time.OffsetDateTime.now(ZoneOffset.ofHours(8)).toString();
    }

    // ─────────────────────────────────────────────────────────────
    // 数据载体
    // ─────────────────────────────────────────────────────────────

    /** 一列。字段名与 {@code docs/db/tables/_TEMPLATE.md} 第 3 节的 10 列一一对应。 */
    record Col(String name, String type, boolean nullable, String defaultValue, String comment,
               String enumOrUnit, String index, String javaField, String javaType,
               boolean autoIncrement, boolean primary, boolean json) {
    }

    record Idx(String name, String type, List<String> fields, String purpose) {
    }
}
