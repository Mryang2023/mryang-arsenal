package com.arsenal.projects;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.nio.file.Path;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 四件套完整性审计 · <b>只读</b>。
 *
 * <p>「四件套」是 IEMS 的数据库规范（章程 2.11—2.17）：一次表结构变更要同时留下
 * 可执行 SQL、{@code docs/db/CHANGELOG.md} 里的一行、{@code docs/db/tables/<表>.md}、
 * 以及带完整注释的实体类。少任何一件，半年后就没有人能回答「这张表为什么是这个样子」。
 *
 * <p>这个类不解析任何文件 —— 数据全来自 {@link DossierService#build(Path)}，
 * 保证「档案页看到的」和「审计判定的」是<b>同一份事实</b>。两套解析器迟早会对不上，
 * 那时人不知道该信哪个。
 *
 * <p>判定口径（刻意保守）：
 * <ul>
 *   <li>能判定的才判定。表说明的 2/6/7/8/9 节没有结构化解析，就不假装检查过；
 *       1/3/10 节按 {@code basic/columns/changes} 判，其余按标题编号判。</li>
 *   <li>缺脚本但 CHANGELOG 里写着「CREATE」→ 判 error（历史记录与文件对不上，
 *       这是真问题）；两者都缺 → 判 warn（可能是规范建立前的老表）。</li>
 *   <li>日志类表不继承 BaseEntity 是允许的，只给 info。</li>
 * </ul>
 */
public final class DdlVerifyService {

    /** 模板固定 10 节。用于判「节还在不在」，不判内容写得好不好。 */
    private static final int EXPECTED_SECTIONS = 10;
    /** BaseEntity 公共字段数。 */
    private static final int BASE_FIELD_COUNT = 7;

    private static final Pattern SECTION = Pattern.compile("^##\\s+(\\d+)\\s*[.、]\\s*\\S+", Pattern.MULTILINE);
    private static final Pattern PLACEHOLDER = Pattern.compile("待补充");

    private final ObjectMapper mapper;
    private final DossierService dossier;

    public DdlVerifyService(ObjectMapper mapper, DossierService dossier) {
        this.mapper = mapper;
        this.dossier = dossier;
    }

    public ObjectNode verify(Path repo) {
        ObjectNode ds = dossier.build(repo);
        boolean available = ds.path("available").asBoolean(false);
        JsonNode db = ds.path("db");
        JsonNode tables = db.path("tables");
        JsonNode scripts = db.path("scripts");
        JsonNode entries = db.path("changelog").path("entries");

        ObjectNode out = mapper.createObjectNode();
        out.put("schemaVersion", 1);
        out.put("generatedAt", OffsetDateTime.now(ZoneOffset.ofHours(8)).toString());
        out.put("writes", false);
        out.put("note", "只读审计：军火库不执行 SQL、不写被管理项目的任何文件。");
        out.put("available", available);

        ArrayNode tableOut = out.putArray("tables");
        int complete = 0, partial = 0, missing = 0;
        int sqlCovered = 0, changelogCovered = 0, docCovered = 0, entityCovered = 0;

        if (available && tables.isArray()) {
            for (JsonNode t : tables) {
                ObjectNode row = auditTable(repo, t, scripts, entries);
                tableOut.add(row);
                String status = row.path("status").asText();
                switch (status) {
                    case "complete" -> complete++;
                    case "partial" -> partial++;
                    default -> missing++;
                }
                JsonNode pieces = row.path("pieces");
                if (pieces.path("sql").path("ok").asBoolean(false)) sqlCovered++;
                if (pieces.path("changelog").path("ok").asBoolean(false)) changelogCovered++;
                if (pieces.path("tableDoc").path("ok").asBoolean(false)) docCovered++;
                if (pieces.path("entity").path("ok").asBoolean(false)) entityCovered++;
            }
        }

        int total = tables.isArray() ? tables.size() : 0;
        ObjectNode summary = out.putObject("summary");
        summary.put("tables", total);
        summary.put("complete", complete);
        summary.put("partial", partial);
        summary.put("missing", missing);
        summary.put("scripts", countRealScripts(scripts));
        summary.put("templateScripts", scripts.isArray() ? scripts.size() - countRealScripts(scripts) : 0);
        summary.put("changelogEntries", entries.isArray() ? entries.size() : 0);
        summary.put("entities", db.path("entities").isArray() ? db.path("entities").size() : 0);
        summary.put("documented", db.path("stats").path("tablesDocumented").asInt(docCovered));
        summary.put("score", total == 0 ? 0 : Math.round(complete * 100f / total));

        ArrayNode checks = out.putArray("checks");
        checks.add(check("sql", "可执行脚本", sqlCovered, total));
        checks.add(check("changelog", "变更日志", changelogCovered, total));
        checks.add(check("tableDoc", "表结构说明", docCovered, total));
        checks.add(check("entity", "实体类", entityCovered, total));

        ArrayNode findings = out.putArray("findings");
        globalFindings(findings, repo, scripts, entries, db);

        out.put("score", summary.path("score").asInt(0));
        return out;
    }

    // ─────────────────────────────────────────────────────────────
    // 单表
    // ─────────────────────────────────────────────────────────────

    private ObjectNode auditTable(Path repo, JsonNode t, JsonNode scripts, JsonNode entries) {
        String table = t.path("table").asText();
        ObjectNode row = mapper.createObjectNode();
        row.put("table", table);
        row.put("title", t.path("title").asText(""));
        row.put("module", moduleOf(t));

        ArrayNode issues = row.putArray("issues");
        ObjectNode pieces = row.putObject("pieces");

        // ── 1. 可执行脚本 ──
        List<String> scriptFiles = new ArrayList<>();
        int scriptStatements = 0;
        if (scripts.isArray()) {
            for (JsonNode s : scripts) {
                if (s.path("template").asBoolean(false)) continue;
                for (JsonNode st : s.path("tables")) {
                    if (table.equals(st.asText())) {
                        scriptFiles.add(s.path("file").asText());
                        scriptStatements += s.path("statements").asInt(0);
                        break;
                    }
                }
            }
        }
        boolean changelogSaysCreate = false;
        String firstCreateDate = "";
        if (entries.isArray()) {
            for (JsonNode e : entries) {
                if (!table.equals(e.path("table").asText())) continue;
                if (e.path("operation").asText("").toUpperCase(Locale.ROOT).contains("CREATE")) {
                    changelogSaysCreate = true;
                    String d = e.path("date").asText("");
                    if (firstCreateDate.isEmpty() || d.compareTo(firstCreateDate) < 0) firstCreateDate = d;
                }
            }
        }
        ObjectNode sql = pieces.putObject("sql");
        sql.put("ok", !scriptFiles.isEmpty());
        sql.put("count", scriptFiles.size());
        sql.put("statements", scriptStatements);
        ArrayNode sf = sql.putArray("files");
        scriptFiles.forEach(sf::add);
        if (scriptFiles.isEmpty()) {
            if (changelogSaysCreate) {
                issue(issues, "error", "SCRIPT_NOT_FOUND",
                        "CHANGELOG 里有建表记录，但 docs/db 下找不到包含该表的脚本");
            } else {
                issue(issues, "warn", "SCRIPT_MISSING",
                        "没有可执行脚本：这张表怎么建出来的，仓库里查不到");
            }
        }

        // ── 2. 变更日志 ──
        int entryCount = 0;
        String lastDate = "";
        if (entries.isArray()) {
            for (JsonNode e : entries) {
                if (!table.equals(e.path("table").asText())) continue;
                entryCount++;
                String d = e.path("date").asText("");
                if (d.compareTo(lastDate) > 0) lastDate = d;
            }
        }
        ObjectNode change = pieces.putObject("changelog");
        change.put("ok", entryCount > 0);
        change.put("count", entryCount);
        change.put("lastDate", lastDate);
        if (entryCount == 0) {
            issue(issues, "warn", "CHANGELOG_MISSING",
                    "docs/db/CHANGELOG.md 里没有这张表的任何一条记录");
        }

        // ── 3. 表结构说明 ──
        boolean documented = t.path("documented").asBoolean(false);
        String docFile = t.path("file").asText("");
        int docColumns = t.path("columns").isArray() ? t.path("columns").size() : 0;
        int entityFields = t.path("entityFieldCount").asInt(0);
        boolean extendsBase = !t.path("entityExtends").asText("").isBlank();

        ObjectNode doc = pieces.putObject("tableDoc");
        doc.put("ok", documented);
        doc.put("file", docFile);
        // 没有表说明时，tables[].columns 是 mergeTables 从实体反推的 —— 那是「实体有这些字段」，
        // 不是「文档写了这些字段」。混在一起会让审计看起来比实际完整，所以显式分开。
        doc.put("columns", documented ? docColumns : 0);
        doc.put("entityDerivedColumns", documented ? 0 : docColumns);
        Set<Integer> foundSections = documented && !docFile.isBlank()
                ? sectionsOf(repo, docFile) : new LinkedHashSet<>();
        ArrayNode missingSections = doc.putArray("missingSections");
        if (documented) {
            for (int i = 1; i <= EXPECTED_SECTIONS; i++) {
                if (!foundSections.contains(i)) missingSections.add(i);
            }
            doc.put("sectionsFound", foundSections.size());
            doc.put("placeholders", placeholderCount(repo, docFile));
        }
        doc.put("businessColumns", documented ? Math.max(0, docColumns - BASE_FIELD_COUNT) : 0);
        doc.put("entityFields", entityFields);

        if (!documented) {
            issue(issues, "warn", "TABLE_DOC_MISSING",
                    "没有 docs/db/tables/" + table + ".md —— 字段含义只能去读 Java 源码");
        } else {
            if (!missingSections.isEmpty()) {
                issue(issues, "warn", "TABLE_DOC_SECTIONS",
                        "表说明缺第 " + joinInts(missingSections) + " 节（模板共 10 节）");
            }
            if (docColumns == 0) {
                issue(issues, "warn", "TABLE_DOC_NO_COLUMNS", "表说明里没有解析到字段清单（第 3 节）");
            }
        }

        // ── 4. 实体类 ──
        String entityClass = t.path("entityClass").asText("");
        String entityFile = t.path("entityFile").asText("");
        ObjectNode entity = pieces.putObject("entity");
        entity.put("ok", !entityClass.isBlank());
        entity.put("class", entityClass);
        entity.put("file", entityFile);
        entity.put("fields", entityFields);
        entity.put("extendsBaseEntity", extendsBase);
        if (entityClass.isBlank()) {
            issue(issues, "warn", "ENTITY_MISSING", "找不到 @TableName(\"" + table + "\") 的实体类");
        } else {
            if (!extendsBase) {
                issue(issues, "info", "ENTITY_NO_BASE",
                        "实体未继承 BaseEntity —— 日志/中间表可以，业务表请确认这是有意为之");
            }
            if (!entityClass.endsWith("Entity")) {
                issue(issues, "warn", "ENTITY_NAME", "实体类名不以 Entity 结尾：" + entityClass);
            }
        }

        // ── 5. 对账：表说明的业务字段 vs 实体字段 ──
        int docBiz = documented ? Math.max(0, docColumns - BASE_FIELD_COUNT) : 0;
        int entBiz = Math.max(0, entityFields - (extendsBase ? 0 : BASE_FIELD_COUNT));
        ObjectNode reconcile = row.putObject("reconcile");
        reconcile.put("docBusinessFields", docBiz);
        reconcile.put("entityBusinessFields", entBiz);
        boolean comparable = documented && docColumns > 0 && entityFields > 0;
        reconcile.put("comparable", comparable);
        reconcile.put("match", !comparable || docBiz == entBiz);
        if (comparable && docBiz != entBiz) {
            issue(issues, "warn", "FIELD_COUNT_MISMATCH",
                    "表说明列了 " + docBiz + " 个业务字段，实体声明了 " + entBiz
                            + " 个 —— 四件套里有两件写的不是同一张表");
        }

        // ── 6. 状态 ──
        int ok = 0;
        for (String k : List.of("sql", "changelog", "tableDoc", "entity")) {
            if (pieces.path(k).path("ok").asBoolean(false)) ok++;
        }
        row.put("status", ok == 4 ? "complete" : ok == 0 ? "missing" : "partial");
        row.put("okPieces", ok);
        row.put("totalPieces", 4);
        return row;
    }

    // ─────────────────────────────────────────────────────────────
    // 全局
    // ─────────────────────────────────────────────────────────────

    private void globalFindings(ArrayNode findings, Path repo, JsonNode scripts, JsonNode entries, JsonNode db) {
        // 脚本有、CHANGELOG 没有 —— 变更没留可检索的历史
        if (scripts.isArray() && entries.isArray()) {
            Set<String> entryScripts = new LinkedHashSet<>();
            for (JsonNode e : entries) {
                String s = e.path("script").asText("");
                if (!s.isBlank()) entryScripts.add(fileName(s));
            }
            for (JsonNode s : scripts) {
                if (s.path("template").asBoolean(false)) continue;
                String name = fileName(s.path("file").asText(""));
                if (!entryScripts.contains(name)) {
                    finding(findings, "warn", "SCRIPT_WITHOUT_CHANGELOG",
                            name + " 没有对应的 CHANGELOG 行 —— 半年后没人知道它为什么存在");
                }
            }
            // CHANGELOG 有、脚本没有
            Set<String> scriptNames = new LinkedHashSet<>();
            for (JsonNode s : scripts) {
                scriptNames.add(fileName(s.path("file").asText("")));
            }
            for (JsonNode e : entries) {
                String name = fileName(e.path("script").asText(""));
                if (!name.isBlank() && name.toLowerCase(Locale.ROOT).endsWith(".sql")
                        && !scriptNames.contains(name)) {
                    finding(findings, "error", "CHANGELOG_SCRIPT_MISSING",
                            "CHANGELOG 引用的脚本 " + name + " 在 docs/db 下不存在");
                }
            }
        }

        // 同一张表被两个实体映射 —— 复制粘贴留下的重复，值得看见
        JsonNode entities = db.path("entities");
        if (entities.isArray()) {
            java.util.Map<String, List<String>> byTable = new java.util.LinkedHashMap<>();
            for (JsonNode e : entities) {
                String table = e.path("table").asText("");
                if (table.isBlank()) continue;
                byTable.computeIfAbsent(table, k -> new ArrayList<>()).add(e.path("file").asText(""));
            }
            byTable.forEach((table, files) -> {
                if (files.size() > 1) {
                    finding(findings, "warn", "DUPLICATE_ENTITY",
                            table + " 有 " + files.size() + " 个实体映射：" + String.join("、", files));
                }
            });
        }

        // 一条实体都没有 + 一张表都没说明：不是「没问题」，是还没开始
        boolean noEntities = !entities.isArray() || entities.isEmpty();
        boolean noDocs = db.path("stats").path("tablesDocumented").asInt(0) == 0;
        if (noEntities && noDocs) {
            finding(findings, "info", "NOT_STARTED",
                    "项目里既没有实体也没有表说明 —— 如果代码已经写了，多半是缓存过期，先刷新项目");
        }
    }

    private static int countRealScripts(JsonNode scripts) {
        if (scripts == null || !scripts.isArray()) return 0;
        int n = 0;
        for (JsonNode s : scripts) {
            if (!s.path("template").asBoolean(false)) n++;
        }
        return n;
    }

    private Set<Integer> sectionsOf(Path repo, String rel) {
        // 走 DossierService 的读取器：路径边界、大小上限都在那里统一收口
        Set<Integer> out = new LinkedHashSet<>();
        String text;
        try {
            text = dossier.readDoc(repo, rel);
        } catch (Exception e) {
            return out;
        }
        Matcher m = SECTION.matcher(text);
        while (m.find()) {
            try {
                out.add(Integer.parseInt(m.group(1)));
            } catch (NumberFormatException ignored) {
            }
        }
        return out;
    }

    private int placeholderCount(Path repo, String rel) {
        try {
            String text = dossier.readDoc(repo, rel);
            Matcher m = PLACEHOLDER.matcher(text);
            int n = 0;
            while (m.find()) n++;
            return n;
        } catch (Exception e) {
            return 0;
        }
    }

    private ObjectNode check(String key, String label, int covered, int total) {
        ObjectNode n = mapper.createObjectNode();
        n.put("key", key);
        n.put("label", label);
        n.put("covered", covered);
        n.put("total", total);
        n.put("ok", total > 0 && covered == total);
        n.put("percent", total == 0 ? 0 : Math.round(covered * 100f / total));
        return n;
    }

    private void issue(ArrayNode out, String level, String code, String message) {
        ObjectNode n = mapper.createObjectNode();
        n.put("level", level);
        n.put("code", code);
        n.put("message", message);
        out.add(n);
    }

    private void finding(ArrayNode out, String level, String code, String message) {
        issue(out, level, code, message);
    }

    /**
     * 模块归属。实体文件所在目录最可信 —— 脚手架继承来的表说明常把表名前缀当模块
     * （{@code schedule_job} 写成 {@code schedule}，实际实体在 {@code module-quartz} 里），
     * 照抄会把 quartz 拆成 schedule/sms/t 三个假模块。所以顺序是：
     * 实体路径 &gt; 表说明「模块」字段（英文小写才认） &gt; 表名前缀。
     */
    private static String moduleOf(JsonNode t) {
        String table = t.path("table").asText("");
        String ef = t.path("entityFile").asText("").replace('\\', '/');
        if (ef.startsWith("module/module-")) {
            String rest = ef.substring("module/module-".length());
            int slash = rest.indexOf('/');
            String m = slash > 0 ? rest.substring(0, slash) : rest;
            if (m.matches("[a-z][a-z0-9-]*")) return m;
        }
        if (ef.startsWith("basic/")) return "basic";

        String m = t.path("basic").path("模块").asText("").trim().toLowerCase(Locale.ROOT);
        if (m.matches("[a-z][a-z0-9-]*")) return m;
        return table.contains("_") ? table.substring(0, table.indexOf('_')) : table;
    }

    private static String fileName(String path) {
        if (path == null) return "";
        int i = path.replace('\\', '/').lastIndexOf('/');
        return i >= 0 ? path.substring(i + 1) : path;
    }

    private static String joinInts(ArrayNode arr) {
        List<String> s = new ArrayList<>();
        for (JsonNode n : arr) s.add(n.asText());
        return String.join("、", s);
    }
}
