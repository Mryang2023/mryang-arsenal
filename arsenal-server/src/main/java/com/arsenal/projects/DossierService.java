package com.arsenal.projects;

import tools.jackson.databind.JsonNode;
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
 * 项目档案 · 只读索引器。
 *
 * <p>这份档案回答的是「这个项目自己记了什么」，不是「它的代码长什么样」——
 * 后者归 {@code /facts} 与 {@code /checkup}。两者刻意分开：代码事实可以重扫，
 * 文档是**人写的承诺**，重扫不出来。
 *
 * <p>数据全部来自项目缓存 {@code <cache>/<projectId>/repo/}，不读源头、不写任何东西、
 * 不执行 SQL。索引的是 IEMS 约定的「四件套」：
 * <pre>
 *   docs/db/CHANGELOG.md          变更历史（只追加的表格）
 *   docs/db/tables/&lt;table&gt;.md    表结构说明（固定章节 + 固定列）
 *   docs/db/**&#47;*.sql            可执行脚本
 *   docs/**&#47;*章程*.md          开发章程
 *   **&#47;*.java 的 @TableName     表 → 实体映射
 * </pre>
 *
 * <p>解析是**宽松**的：章节缺失、表格列数对不上都只是少给一块，不整份失败。
 * 文档是人写的，格式漂移是常态 —— 因为某一节写歪了就报「档案坏了」，等于让
 * 人不敢改文档。缺什么由 {@code notes} 明说，页面照实展示。
 *
 * <p>路径安全：所有读取都先 {@link #safeResolve} —— 拒绝 {@code ..}、拒绝绝对路径、
 * 解析后必须仍在 repo 内，且只允许 {@code .md} / {@code .sql} 两种扩展名。
 */
public final class DossierService {

    /** 单份文档读取上限。章程目前约 100KB，512KB 留足余量又不至于把内存当仓库。 */
    public static final long MAX_DOC_BYTES = 512L * 1024;
    /** 实体源码读取上限。与 {@link #indexEntities} 的跳过阈值同源，避免「索引时读、现读时拒」。 */
    public static final long MAX_ENTITY_BYTES = 256L * 1024;

    private static final Pattern HEADING = Pattern.compile("^(#{1,6})\\s+(.+?)\\s*$");
    private static final Pattern NUMBERED = Pattern.compile("^##\\s+(\\d+)\\.\\s*(.+?)\\s*$");
    private static final Pattern TABLE_NAME_IN_HEADING = Pattern.compile("^#\\s+(.+?)（`([A-Za-z0-9_]+)`）\\s*$");
    private static final Pattern TABLE_NAME_BACKTICK = Pattern.compile("^#\\s+`?([A-Za-z0-9_]+)`?\\s*$");
    private static final Pattern TABLE_ANNOTATION = Pattern.compile("@TableName\\s*\\(\\s*\"([^\"]+)\"");
    private static final Pattern CLASS_DECL = Pattern.compile("\\bclass\\s+([A-Za-z0-9_]+)");
    private static final Pattern SQL_TABLE = Pattern.compile(
            "(?i)\\b(?:create\\s+table(?:\\s+if\\s+not\\s+exists)?|alter\\s+table|drop\\s+table(?:\\s+if\\s+exists)?)\\s+`?([A-Za-z0-9_]+)`?");

    private static final String CHANGELOG_REL = "docs/db/CHANGELOG.md";
    private static final String TABLES_DIR_REL = "docs/db/tables";

    private final ObjectMapper mapper;

    public DossierService(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    // ─────────────────────────────────────────────────────────────
    // 汇总
    // ─────────────────────────────────────────────────────────────

    /** 索引整份档案。repo 必须是已摄取的缓存目录（存在即读，不存在返回空档案而不是抛错）。 */
    public ObjectNode build(Path repo) {
        ObjectNode out = mapper.createObjectNode();
        out.put("schemaVersion", 1);
        out.put("root", repo.getFileName() == null ? "repo" : repo.getFileName().toString());
        out.put("indexedAt", java.time.OffsetDateTime.now(java.time.ZoneOffset.ofHours(8)).toString());
        ArrayNode notes = out.putArray("notes");

        boolean repoOk = repo != null && Files.isDirectory(repo);
        out.put("available", repoOk);
        if (!repoOk) {
            notes.add(note("warn", "REPO_MISSING", "项目缓存目录不存在，档案为空。先刷新缓存再试。"));
            return out;
        }

        ObjectNode charter = indexCharter(repo, notes);
        out.set("charter", charter);

        ObjectNode db = out.putObject("db");
        Path dbDir = repo.resolve("docs/db");
        db.put("present", Files.isDirectory(dbDir));
        if (!Files.isDirectory(dbDir)) {
            notes.add(note("info", "DB_DOCS_MISSING",
                    "没有 docs/db/ 目录 —— 这个项目还没按「四件套」记录数据库变更。"));
        }
        db.set("changelog", indexChangelog(repo, notes));
        ArrayNode docTables = indexTables(repo, notes);
        ArrayNode entities = indexEntities(repo, notes);
        db.set("tables", mergeTables(repo, docTables, entities, notes));
        db.set("scripts", indexScripts(repo, notes));
        db.set("entities", entities);

        ObjectNode stats = out.putObject("stats");
        int undocumented = 0;
        for (JsonNode t : db.path("tables")) {
            if (!t.path("documented").asBoolean(false)) undocumented++;
        }
        stats.put("tables", db.path("tables").size());
        stats.put("tablesDocumented", db.path("tables").size() - undocumented);
        stats.put("tablesUndocumented", undocumented);
        stats.put("changelogEntries", db.path("changelog").path("count").asInt(0));
        stats.put("scripts", db.path("scripts").size());
        stats.put("entities", db.path("entities").size());
        stats.put("charterLines", charter.path("lines").asInt(0));
        return out;
    }

    // ─────────────────────────────────────────────────────────────
    // 章程
    // ─────────────────────────────────────────────────────────────

    /**
     * 章程：找 {@code docs/**}{@code /*章程*.md}，优先 {@code docs/开发章程.md}。
     *
     * <p>只给**目录**（各级标题 + 行号）与统计，正文按需 {@link #readDoc} 取 ——
     * 2400 行的章程整份塞进一次响应，页面还没渲染完就先卡住了。
     */
    private ObjectNode indexCharter(Path repo, ArrayNode notes) {
        ObjectNode out = mapper.createObjectNode();
        out.put("found", false);
        Path hit = findCharter(repo, notes);
        if (hit == null) return out;

        String rel = rel(repo, hit);
        out.put("found", true);
        out.put("file", rel);
        try {
            long size = Files.size(hit);
            out.put("bytes", size);
            out.put("updatedAt", Files.getLastModifiedTime(hit).toInstant().toString());
            if (size > MAX_DOC_BYTES) {
                notes.add(note("warn", "CHARTER_TOO_LARGE",
                        rel + " 超过 " + MAX_DOC_BYTES / 1024 + "KB，只索引目录不提供全文。"));
                out.put("readable", false);
                return out;
            }
            List<String> lines = Files.readAllLines(hit, StandardCharsets.UTF_8);
            out.put("lines", lines.size());
            out.put("readable", true);
            String title = "";
            ArrayNode outline = out.putArray("outline");
            for (int i = 0; i < lines.size(); i++) {
                String l = lines.get(i);
                Matcher numbered = NUMBERED.matcher(l);
                Matcher heading = HEADING.matcher(l);
                ObjectNode h = null;
                if (numbered.matches()) {
                    h = outline.addObject();
                    h.put("level", 2);
                    h.put("number", numbered.group(1));
                    h.put("title", stripInline(numbered.group(2)));
                    h.put("line", i + 1);
                } else if (heading.matches()) {
                    int level = heading.group(1).length();
                    if (level <= 3) {
                        h = outline.addObject();
                        h.put("level", level);
                        h.put("title", stripInline(heading.group(2)));
                        h.put("line", i + 1);
                    }
                }
                if (h != null && title.isEmpty() && h.path("level").asInt() == 1) {
                    title = h.path("title").asText("");
                }
            }
            out.put("title", title.isEmpty() ? rel : title);
        } catch (IOException e) {
            notes.add(note("warn", "CHARTER_READ_ERROR", rel + " 读不了：" + e.getMessage()));
        }
        return out;
    }

    private Path findCharter(Path repo, ArrayNode notes) {
        Path preferred = repo.resolve("docs/开发章程.md");
        if (Files.isRegularFile(preferred)) return preferred;
        Path docs = repo.resolve("docs");
        if (!Files.isDirectory(docs)) return null;
        List<Path> found = new ArrayList<>();
        try (Stream<Path> s = Files.walk(docs, 3)) {
            s.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().endsWith(".md"))
                    .filter(p -> p.getFileName().toString().contains("章程"))
                    .filter(p -> !p.toString().contains("ai-memory"))
                    .forEach(found::add);
        } catch (IOException e) {
            return null;
        }
        if (found.isEmpty()) return null;
        found.sort(Comparator.comparing(Path::toString));
        if (found.size() > 1) {
            notes.add(note("info", "CHARTER_MULTIPLE",
                    "找到多份章程，取第一份：" + rel(repo, found.get(0)) + "（共 " + found.size() + " 份）"));
        }
        return found.get(0);
    }

    // ─────────────────────────────────────────────────────────────
    // 变更历史
    // ─────────────────────────────────────────────────────────────

    /**
     * CHANGELOG：定位 {@code ## 变更记录}，其后连续表格行即记录。
     *
     * <p>列序固定（日期 / 脚本 / 表 / 操作 / 变更前 / 变更后 / 原因 / 影响 / 回滚 /
     * 执行环境 / 表结构说明 / 实体类）。列数不足 12 的行跳过但计数 ——
     * 少一列通常是手写时漏了，静默当成 12 列去映射会把「原因」显示成「影响」。
     */
    private ObjectNode indexChangelog(Path repo, ArrayNode notes) {
        ObjectNode out = mapper.createObjectNode();
        out.put("found", false);
        Path f = repo.resolve(CHANGELOG_REL);
        if (!Files.isRegularFile(f)) return out;

        out.put("found", true);
        out.put("file", CHANGELOG_REL);
        ArrayNode entries = out.putArray("entries");
        int skipped = 0;
        boolean inSection = false;
        try {
            for (String line : Files.readAllLines(f, StandardCharsets.UTF_8)) {
                if (line.startsWith("## ")) {
                    inSection = line.contains("变更记录");
                    continue;
                }
                if (!inSection || !line.trim().startsWith("|")) continue;
                List<String> cells = cells(line);
                if (cells.isEmpty() || isSeparator(cells)) continue;
                if (cells.get(0).contains("日期") || cells.get(1).equals("脚本")) continue;
                if (cells.size() < 12) {
                    skipped++;
                    continue;
                }
                ObjectNode e = entries.addObject();
                e.put("date", plain(cells.get(0)));
                e.put("script", plain(cells.get(1)));
                e.put("table", plain(cells.get(2)));
                e.put("operation", plain(cells.get(3)));
                e.put("before", plain(cells.get(4)));
                e.put("after", plain(cells.get(5)));
                e.put("reason", plain(cells.get(6)));
                e.put("impact", plain(cells.get(7)));
                e.put("rollback", plain(cells.get(8)));
                e.put("envResult", plain(cells.get(9)));
                e.put("tableDoc", plain(cells.get(10)));
                e.put("entity", plain(cells.get(11)));
            }
        } catch (IOException e) {
            notes.add(note("warn", "CHANGELOG_READ_ERROR", CHANGELOG_REL + " 读不了：" + e.getMessage()));
        }
        out.put("count", entries.size());
        if (skipped > 0) {
            out.put("skippedRows", skipped);
            notes.add(note("warn", "CHANGELOG_BAD_ROW",
                    CHANGELOG_REL + " 有 " + skipped + " 行列数不足 12，未计入。"));
        }
        return out;
    }

    // ─────────────────────────────────────────────────────────────
    // 表结构说明
    // ─────────────────────────────────────────────────────────────

    /**
     * 表文档：{@code docs/db/tables/*.md}，跳过 README 与 {@code _TEMPLATE.md}。
     *
     * <p>按「## N. 标题」切节，按固定列名读表。字段清单第 1 行是表头，随后可能
     * 有一行分隔线；两行都跳过。缺哪一节只让对应字段为空，不影响其它节。
     */
    private ArrayNode indexTables(Path repo, ArrayNode notes) {
        ArrayNode out = mapper.createArrayNode();
        Path dir = repo.resolve(TABLES_DIR_REL);
        if (!Files.isDirectory(dir)) return out;

        List<Path> files = new ArrayList<>();
        try (Stream<Path> s = Files.list(dir)) {
            s.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().endsWith(".md"))
                    .filter(p -> {
                        String n = p.getFileName().toString().toLowerCase(Locale.ROOT);
                        return !n.equals("readme.md") && !n.startsWith("_");
                    })
                    .forEach(files::add);
        } catch (IOException e) {
            notes.add(note("warn", "TABLES_READ_ERROR", TABLES_DIR_REL + " 读不了：" + e.getMessage()));
            return out;
        }
        files.sort(Comparator.comparing(p -> p.getFileName().toString()));
        for (Path f : files) {
            ObjectNode t = parseTableDoc(repo, f, notes);
            if (t != null) out.add(t);
        }
        return out;
    }

    private ObjectNode parseTableDoc(Path repo, Path f, ArrayNode notes) {
        String rel = rel(repo, f);
        List<String> lines;
        try {
            if (Files.size(f) > MAX_DOC_BYTES) {
                notes.add(note("warn", "TABLE_DOC_TOO_LARGE", rel + " 超过上限，已跳过。"));
                return null;
            }
            lines = Files.readAllLines(f, StandardCharsets.UTF_8);
        } catch (IOException e) {
            notes.add(note("warn", "TABLE_DOC_READ_ERROR", rel + " 读不了：" + e.getMessage()));
            return null;
        }

        ObjectNode t = mapper.createObjectNode();
        t.put("file", rel);
        t.put("updatedAt", lastModified(f));

        String title = "";
        String tableName = "";
        for (String l : lines) {
            Matcher m = TABLE_NAME_IN_HEADING.matcher(l.trim());
            if (m.matches()) {
                title = stripInline(m.group(1));
                tableName = m.group(2);
                break;
            }
            Matcher m2 = TABLE_NAME_BACKTICK.matcher(l.trim());
            if (m2.matches()) {
                tableName = m2.group(1);
                break;
            }
        }
        if (tableName.isEmpty()) {
            String fn = f.getFileName().toString();
            tableName = fn.substring(0, fn.length() - ".md".length());
        }
        t.put("table", tableName);
        t.put("title", title);

        // 切节：section[编号] = 该节正文行
        java.util.Map<Integer, List<String>> sections = new java.util.LinkedHashMap<>();
        int current = 0;
        sections.put(0, new ArrayList<>());
        for (String l : lines) {
            Matcher n = NUMBERED.matcher(l);
            if (n.matches()) {
                current = Integer.parseInt(n.group(1));
                sections.computeIfAbsent(current, k -> new ArrayList<>());
                continue;
            }
            if (l.startsWith("# ")) continue;
            sections.computeIfAbsent(current, k -> new ArrayList<>()).add(l);
        }

        t.set("basic", keyValueTable(sections.getOrDefault(1, List.of())));
        t.set("columns", columnTable(sections.getOrDefault(3, List.of())));
        t.set("indexes", genericTable(sections.getOrDefault(4, List.of()),
                new String[]{"name", "type", "fields", "purpose"}));
        t.set("relations", genericTable(sections.getOrDefault(5, List.of()),
                new String[]{"field", "targetTable", "targetField", "relation", "onDelete"}));
        t.set("changes", genericTable(sections.getOrDefault(10, List.of()),
                new String[]{"date", "script", "summary"}));
        return t;
    }

    /** 第 1 节「基本信息」：两列 项 / 内容。 */
    private ObjectNode keyValueTable(List<String> body) {
        ObjectNode out = mapper.createObjectNode();
        for (String l : body) {
            List<String> c = cells(l);
            if (c.size() < 2 || isSeparator(c)) continue;
            String k = plain(c.get(0));
            if (k.isEmpty() || k.equals("项")) continue;
            out.put(k, plain(c.get(1)));
        }
        return out;
    }

    /**
     * 第 3 节「字段清单」：10 列。前两行是表头与分隔线，跳过。
     * 序号不是数字的行也跳过 —— 那是备注段落而不是字段。
     */
    private ArrayNode columnTable(List<String> body) {
        ArrayNode out = mapper.createArrayNode();
        for (String l : body) {
            List<String> c = cells(l);
            if (c.size() < 10 || isSeparator(c)) continue;
            String no = plain(c.get(0));
            if (no.isEmpty() || no.equals("序号") || !no.matches("\\d+")) continue;
            ObjectNode col = out.addObject();
            col.put("no", Integer.parseInt(no));
            col.put("name", plain(c.get(1)));
            col.put("type", plain(c.get(2)));
            col.put("nullable", plain(c.get(3)));
            col.put("defaultValue", plain(c.get(4)));
            col.put("comment", plain(c.get(5)));
            col.put("enumOrUnit", plain(c.get(6)));
            col.put("index", plain(c.get(7)));
            col.put("javaField", plain(c.get(8)));
            col.put("javaType", plain(c.get(9)));
        }
        return out;
    }

    private ArrayNode genericTable(List<String> body, String[] keys) {
        ArrayNode out = mapper.createArrayNode();
        boolean headerSkipped = false;
        for (String l : body) {
            List<String> c = cells(l);
            if (c.size() < keys.length || isSeparator(c)) continue;
            if (!headerSkipped) {
                headerSkipped = true;
                continue;
            }
            // addObject() 已经把节点挂上去了 —— 再 add 一次就会每行出现两遍
            ObjectNode row = out.addObject();
            for (int i = 0; i < keys.length; i++) row.put(keys[i], plain(c.get(i)));
        }
        return out;
    }

    // ─────────────────────────────────────────────────────────────
    // SQL 脚本
    // ─────────────────────────────────────────────────────────────

    /** DDL 脚本清单：只列文件与它提到的表，**不执行**，也不尝试判断语法对错。 */
    private ArrayNode indexScripts(Path repo, ArrayNode notes) {
        ArrayNode out = mapper.createArrayNode();
        Path db = repo.resolve("docs/db");
        if (!Files.isDirectory(db)) return out;
        List<Path> files = new ArrayList<>();
        try (Stream<Path> s = Files.walk(db, 4)) {
            s.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".sql"))
                    .forEach(files::add);
        } catch (IOException e) {
            notes.add(note("warn", "SCRIPTS_READ_ERROR", "docs/db 遍历失败：" + e.getMessage()));
            return out;
        }
        files.sort(Comparator.comparing(Path::toString));
        for (Path f : files) {
            String rel = rel(repo, f);
            ObjectNode s = out.addObject();
            s.put("file", rel);
            s.put("template", rel.contains("/templates/"));
            s.put("updatedAt", lastModified(f));
            try {
                s.put("bytes", Files.size(f));
                List<String> lines = Files.readAllLines(f, StandardCharsets.UTF_8);
                s.put("lines", lines.size());
                ArrayNode tables = s.putArray("tables");
                java.util.Set<String> seen = new java.util.LinkedHashSet<>();
                StringBuilder text = new StringBuilder();
                for (String l : lines) text.append(l).append('\n');
                Matcher m = SQL_TABLE.matcher(text);
                while (m.find()) seen.add(m.group(1));
                seen.forEach(tables::add);
                s.put("statements", countStatements(lines));
            } catch (IOException e) {
                notes.add(note("warn", "SCRIPT_READ_ERROR", rel + " 读不了：" + e.getMessage()));
            }
        }
        return out;
    }

    private static int countStatements(List<String> lines) {
        StringBuilder sb = new StringBuilder();
        for (String l : lines) {
            String t = l.trim();
            if (t.startsWith("--") || t.startsWith("#") || t.isEmpty()) continue;
            sb.append(t).append('\n');
        }
        int n = 0;
        for (String part : sb.toString().split(";")) {
            if (!part.trim().isEmpty()) n++;
        }
        return n;
    }

    // ─────────────────────────────────────────────────────────────
    // 实体映射
    // ─────────────────────────────────────────────────────────────

    /**
     * 表 → 实体：扫 Java 源码里的 {@code @TableName("x")}。
     *
     * <p>只读缓存里的 .java，跳过 target/build；命中两个类映射同一张表时两条都列出 ——
     * 那多半是复制粘贴留下的重复实体，是**值得看见**的事实，不该被去重掩盖。
     */
    private ArrayNode indexEntities(Path repo, ArrayNode notes) {
        ArrayNode out = mapper.createArrayNode();
        List<Path> files = new ArrayList<>();
        try (Stream<Path> s = Files.walk(repo, 20)) {
            s.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().endsWith(".java"))
                    .filter(p -> {
                        String r = rel(repo, p);
                        return !r.startsWith("target/") && !r.contains("/target/")
                                && !r.contains("node_modules/");
                    })
                    .forEach(files::add);
        } catch (IOException e) {
            notes.add(note("warn", "ENTITY_WALK_ERROR", "Java 源码遍历失败：" + e.getMessage()));
            return out;
        }
        files.sort(Comparator.comparing(Path::toString));
        for (Path f : files) {
            String text;
            try {
                if (Files.size(f) > 256 * 1024) continue;
                text = Files.readString(f, StandardCharsets.UTF_8);
            } catch (IOException e) {
                continue;
            }
            Matcher m = TABLE_ANNOTATION.matcher(text);
            if (!m.find()) continue;
            String table = m.group(1);
            Matcher cm = CLASS_DECL.matcher(text);
            String cls = cm.find() ? cm.group(1) : f.getFileName().toString().replace(".java", "");
            ObjectNode e = out.addObject();
            e.put("table", table);
            e.put("class", cls);
            e.put("file", rel(repo, f));
            Matcher lm = Pattern.compile("\\bclass\\s+" + Pattern.quote(cls) + "\\s+extends\\s+([A-Za-z0-9_]+)").matcher(text);
            e.put("extends", lm.find() ? lm.group(1) : "");
            // 字段数不算「代码长什么样」，它是档案用来对账的：表说明里业务字段数与实体字段数
            // 对不上，说明四件套里有两件写的不是同一张表。只给数字，字段名按需现读。
            e.put("fieldCount", entityFieldNames(text).size());
        }
        return out;
    }

    /**
     * 实体里的持久化字段名（顺序即源码顺序）。
     *
     * <p>给「变更计划」与「四件套校验」共用：计划要判断某个字段是否已经写过，
     * 校验要拿字段数与表说明对账。解析口径与 {@link #entityColumns} 同一套正则，
     * 不另写一份 —— 两处口径一旦分叉，页面说「一致」而人眼看到不一致。
     */
    public static List<String> entityFieldNames(String source) {
        List<String> out = new ArrayList<>();
        if (source == null || source.isBlank()) return out;
        for (String raw : source.split("\\r?\\n")) {
            Matcher m = ENTITY_FIELD.matcher(raw.trim());
            if (m.matches()) out.add(m.group(2));
        }
        return out;
    }

    // ─────────────────────────────────────────────────────────────
    // 合并：表说明（人写） + 实体（代码里有的）
    // ─────────────────────────────────────────────────────────────

    /**
     * 一份数据字典 = 表说明 ∪ 实体映射。
     *
     * <p>为什么两边都要：只列 {@code docs/db/tables/*.md}，一个还没开始写文档的项目
     * 打开数据字典是空白，等于说「你没有表」；只列实体，又看不出哪张表连说明都没写。
     * 合并后每个表都带 {@code documented} 标记 —— **缺文档本身就是一条结论**，
     * 不是过滤条件。四件套里「表结构说明」这一件有没有做到，看这一列就知道。
     *
     * <p>表说明优先：同一张表两边都有时，列信息取人写的那份（它能写清枚举、单位、
     * 索引意图，实体只有类型）。实体只补 {@code entityClass}。
     */
    private ArrayNode mergeTables(Path repo, ArrayNode docTables, ArrayNode entities, ArrayNode notes) {
        java.util.Map<String, ObjectNode> byTable = new java.util.TreeMap<>();
        for (var n : docTables) {
            ObjectNode t = (ObjectNode) n;
            t.put("documented", true);
            byTable.put(t.path("table").asText(), t);
        }
        int undocumented = 0;
        for (var n : entities) {
            ObjectNode e = (ObjectNode) n;
            String table = e.path("table").asText();
            if (table.isEmpty()) continue;
            ObjectNode t = byTable.get(table);
            if (t == null) {
                t = mapper.createObjectNode();
                t.put("table", table);
                t.put("title", "");
                t.put("documented", false);
                t.put("file", "");
                t.put("source", "entity");
                t.set("columns", entityColumns(repo, e.path("file").asText(), notes));
                t.set("indexes", mapper.createArrayNode());
                t.set("relations", mapper.createArrayNode());
                t.set("changes", mapper.createArrayNode());
                byTable.put(table, t);
                undocumented++;
            }
            t.put("entityClass", e.path("class").asText());
            t.put("entityFile", e.path("file").asText());
            t.put("entityExtends", e.path("extends").asText());
            t.put("entityFieldCount", e.path("fieldCount").asInt(0));
        }
        ArrayNode out = mapper.createArrayNode();
        byTable.values().forEach(out::add);
        if (undocumented > 0) {
            notes.add(note("info", "TABLES_UNDOCUMENTED",
                    "有 " + undocumented + " 张表只找到实体、没有 docs/db/tables/<表名>.md —— "
                            + "列信息是从 Java 字段反推的，类型映射与注释可能不全。"));
        }
        return out;
    }

    /**
     * 从实体源码反推字段。**只求「有比没有强」**：注释取 Javadoc 第一行，
     * 类型原样给 Java 类型（不猜 SQL 类型 —— 猜错了比空着更糟）。
     */
    private ArrayNode entityColumns(Path repo, String relPath, ArrayNode notes) {
        ArrayNode out = mapper.createArrayNode();
        Path f = safeResolveAny(repo, relPath);
        if (f == null) return out;
        List<String> lines;
        try {
            lines = Files.readAllLines(f, StandardCharsets.UTF_8);
        } catch (IOException e) {
            notes.add(note("warn", "ENTITY_READ_ERROR", relPath + " 读不了：" + e.getMessage()));
            return out;
        }
        String pendingDoc = "";
        boolean inJavadoc = false;
        StringBuilder doc = new StringBuilder();
        for (String raw : lines) {
            String l = raw.trim();
            if (inJavadoc) {
                if (l.contains("*/")) {
                    inJavadoc = false;
                    pendingDoc = firstLine(doc.toString());
                    doc.setLength(0);
                } else {
                    doc.append(l).append('\n');
                }
                continue;
            }
            if (l.startsWith("/**")) {
                if (l.contains("*/")) {
                    pendingDoc = firstLine(l.substring(l.indexOf("/**") + 3, l.indexOf("*/")));
                } else {
                    inJavadoc = true;
                    doc.setLength(0);
                }
                continue;
            }
            if (l.startsWith("//")) {
                pendingDoc = firstLine(l.substring(2));
                continue;
            }
            Matcher fm = ENTITY_FIELD.matcher(l);
            if (fm.matches()) {
                String type = fm.group(1).trim();
                String name = fm.group(2);
                ObjectNode c = out.addObject();
                c.put("no", out.size());
                c.put("name", name);
                c.put("type", type);
                c.put("javaField", name);
                c.put("javaType", type);
                c.put("comment", pendingDoc);
                c.put("nullable", "");
                c.put("defaultValue", "");
                c.put("enumOrUnit", "");
                c.put("index", "");
                pendingDoc = "";
                continue;
            }
            // 非字段行（方法签名、注解、空行）不清空注释：Javadoc 常隔着一个注解行
            if (!l.isEmpty() && !l.startsWith("@") && !l.startsWith("*")) pendingDoc = "";
        }
        return out;
    }

    private static String firstLine(String doc) {
        for (String l : doc.split("\\r?\\n")) {
            String t = l.trim().replaceAll("^\\*+", "").trim();
            if (!t.isEmpty() && !t.startsWith("@")) return t;
        }
        return "";
    }

    /**
     * 实体字段：{@code private Long id;} / {@code private List<String> tags = new ArrayList<>();}
     * 允许前面的 {@code @TableField(...)} 等注解。static / final 字段跳过。
     */
    private static final Pattern ENTITY_FIELD = Pattern.compile(
            "^(?:(?:@[A-Za-z0-9_.]+(?:\\([^)]*\\))?\\s*)*)private\\s+(?!static\\b)(?!final\\b)"
                    + "([A-Za-z0-9_$.]+(?:\\s*<[^;=]+?>)?(?:\\s*\\[\\])?)\\s+([A-Za-z_][A-Za-z0-9_]*)\\s*(?:=[^;]*)?;$");

    /** 实体文件白名单放宽到 .java —— 它只读缓存内已存在的文件，不写。 */
    private static Path safeResolveAny(Path repo, String relPath) {
        if (repo == null || relPath == null || relPath.isBlank()) return null;
        String r = relPath.replace('\\', '/');
        if (r.startsWith("/") || r.matches("^[A-Za-z]:.*")) return null;
        for (String seg : r.split("/")) {
            if (seg.equals("..") || seg.equals(".")) return null;
        }
        try {
            Path realRepo = repo.toRealPath();
            Path target = realRepo.resolve(r).normalize().toRealPath();
            return target.startsWith(realRepo) && Files.isRegularFile(target) ? target : null;
        } catch (IOException e) {
            return null;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 单文件读取（正文按需）
    // ─────────────────────────────────────────────────────────────

    /** 读一份文档原文。路径必须落在 repo 内且是 .md / .sql —— 这是唯一的读出口。 */
    public String readDoc(Path repo, String relPath) throws IOException {
        Path p = safeResolve(repo, relPath);
        if (p == null) throw new IllegalArgumentException("路径不在项目缓存内或不是文档：" + relPath);
        if (Files.size(p) > MAX_DOC_BYTES) {
            throw new IllegalArgumentException("文档超过 " + MAX_DOC_BYTES / 1024 + "KB 上限：" + relPath);
        }
        return Files.readString(p, StandardCharsets.UTF_8);
    }

    /**
     * 读一份实体源码。只读缓存内已存在的 .java，不写。
     *
     * <p>与 {@link #readDoc} 分开：那个是「页面点开文档」，白名单只有 .md/.sql ——
     * 让页面能按任意路径读 Java 源码，等于把整个仓库的源码开成 GET 接口。
     * 这里是给变更计划做「字段是否已存在」的比对，路径来自索引结果而不是用户输入。
     */
    public String readEntity(Path repo, String relPath) throws IOException {
        Path p = safeResolveAny(repo, relPath);
        if (p == null) throw new IllegalArgumentException("不是项目缓存内的 Java 源文件：" + relPath);
        if (Files.size(p) > MAX_ENTITY_BYTES) {
            throw new IllegalArgumentException("实体源码超过 " + MAX_ENTITY_BYTES / 1024 + "KB 上限：" + relPath);
        }
        return Files.readString(p, StandardCharsets.UTF_8);
    }

    /**
     * 相对路径 → 真实路径。三道闸：拒绝绝对路径与 {@code ..} 分段、解析后仍在 repo 内、
     * 扩展名白名单。只做字符串判断挡不住软链接，所以最后一步用 {@code toRealPath} 比对。
     */
    public static Path safeResolve(Path repo, String relPath) {
        if (repo == null || relPath == null || relPath.isBlank()) return null;
        String r = relPath.replace('\\', '/');
        if (r.startsWith("/") || r.matches("^[A-Za-z]:.*")) return null;
        for (String seg : r.split("/")) {
            if (seg.equals("..") || seg.equals(".")) return null;
        }
        String lower = r.toLowerCase(Locale.ROOT);
        if (!lower.endsWith(".md") && !lower.endsWith(".sql")) return null;
        try {
            Path realRepo = repo.toRealPath();
            Path target = realRepo.resolve(r).normalize().toRealPath();
            if (!target.startsWith(realRepo) || !Files.isRegularFile(target)) return null;
            return target;
        } catch (IOException e) {
            return null;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Markdown 小工具
    // ─────────────────────────────────────────────────────────────

    /** 拆一行表格。返回值已去掉首尾竖线；不含竖线的行返回空表。 */
    static List<String> cells(String line) {
        String t = line.trim();
        if (!t.startsWith("|")) return List.of();
        if (t.endsWith("|")) t = t.substring(0, t.length() - 1);
        t = t.substring(1);
        List<String> out = new ArrayList<>();
        for (String c : t.split("\\|", -1)) out.add(c.trim());
        return out;
    }

    /** 分隔行：{@code |---|---|}。 */
    static boolean isSeparator(List<String> cells) {
        if (cells.isEmpty()) return false;
        for (String c : cells) {
            if (!c.matches(":?-{3,}:?")) return false;
        }
        return true;
    }

    /**
     * 去掉 Markdown 行内标记：反引号、加粗、链接。
     * {@code [equipment_ledger](tables/equipment_ledger.md)} → {@code equipment_ledger}。
     */
    static String plain(String cell) {
        String s = cell.trim().replace("`", "").replace("**", "");
        s = s.replaceAll("\\[([^\\]]+)]\\(([^)]+)\\)", "$1");
        return s.trim();
    }

    /** 标题去行内标记；{@code 2.15 数据库变更} 这类编号前缀保留。 */
    static String stripInline(String s) {
        return plain(s);
    }

    private ObjectNode note(String level, String code, String message) {
        ObjectNode n = mapper.createObjectNode();
        n.put("level", level);
        n.put("code", code);
        n.put("message", message);
        return n;
    }

    private static String lastModified(Path p) {
        try {
            return Files.getLastModifiedTime(p).toInstant().toString();
        } catch (IOException e) {
            return "";
        }
    }

    private static String rel(Path repo, Path p) {
        return repo.relativize(p).toString().replace('\\', '/');
    }
}
