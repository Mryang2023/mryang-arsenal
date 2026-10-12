package com.arsenal.scan;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 构建文件扫描：Maven / Gradle / npm。
 *
 * 只用**逐行正则**，不解析 XML 树：这里要的是行号（evidence 要用），
 * DOM 解析拿不到行号。代价是不认得 XML 注释里的依赖 —— 那本来就不该算数。
 *
 * 三条硬规矩：
 *   ① 版本读不到就写 null。由 parent 管理的依赖没有 version 是正常的，
 *      写个 0 或 1 就是编造事实。
 *   ② 依赖坐标原样带出（含 scope），不做任何「看着像就归一」的处理。
 *   ③ 只登记，**不判断**这个依赖该不该用（那是 /check 的事）。
 */
public final class BuildScanner {

    private static final Pattern TAG = Pattern.compile("<([a-zA-Z0-9.\\-_]+)>\\s*([^<]*?)\\s*</\\1>");
    private static final Pattern GRADLE_DEP = Pattern.compile(
            "^\\s*(implementation|api|compileOnly|runtimeOnly|testImplementation|annotationProcessor)\\s+['\"]([^'\"]+)['\"]");
    private static final Pattern GRADLE_PLUGIN = Pattern.compile("^\\s*id\\s+['\"]([^'\"]+)['\"]");
    private static final Pattern GRADLE_JAVA = Pattern.compile("sourceCompatibility\\s*=?\\s*['\"]?(\\d+)");

    private BuildScanner() {
    }

    public static ObjectNode scan(ScanContext ctx, List<ScannedDep> depsOut) {
        ObjectNode build = ctx.mapper().createObjectNode();
        ArrayNode artifacts = build.putArray("artifacts");
        ArrayNode dependencies = build.putArray("dependencies");
        ArrayNode plugins = build.putArray("plugins");
        boolean maven = false, gradle = false, npm = false;
        int moduleCount = 0;
        List<String> moduleNames = new ArrayList<>();

        for (Path p : ctx.files()) {
            ctx.tick();
            String rel = ctx.rel(p);
            String name = p.getFileName().toString().toLowerCase();

            if (name.equals("pom.xml")) {
                maven = true;
                moduleCount += scanPom(ctx, p, rel, artifacts, dependencies, plugins, depsOut, moduleNames);
            } else if (name.endsWith(".gradle") || name.endsWith(".gradle.kts")) {
                gradle = true;
                scanGradle(ctx, p, rel, artifacts, dependencies, plugins, depsOut);
            } else if (name.equals("package.json")) {
                npm = true;
                scanPackageJson(ctx, p, rel, artifacts, dependencies, depsOut);
            }
        }

        String kind = maven && gradle ? "mixed" : maven ? "maven" : gradle ? "gradle" : npm ? "npm" : "unknown";
        build.put("kind", kind);
        ObjectNode counts = build.putObject("counts");
        counts.put("modules", moduleCount);
        counts.put("dependencies", dependencies.size());
        // 模块名也记下来：只数个数的话，「哪几个模块」永远答不出来，
        // 而模块目录名正是服务归属的常用线索。去重 + 排序保确定性
        ArrayNode mods = build.putArray("modules");
        new TreeSet<>(moduleNames).forEach(mods::add);
        return build;
    }

    // ─────────────────────────────────────────────────────────────
    // Maven
    // ─────────────────────────────────────────────────────────────

    private static int scanPom(ScanContext ctx, Path p, String rel,
                               ArrayNode artifacts, ArrayNode dependencies, ArrayNode plugins,
                               List<ScannedDep> depsOut, List<String> moduleNames) {
        List<String> lines = ctx.readLines(p);
        if (lines == null) {
            ctx.warn(ScanNote.PARSE_SKIPPED, rel + " 未读取");
            return 0;
        }
        ObjectNode art = ctx.mapper().createObjectNode();
        art.put("path", rel);

        String group = null, artifact = null, javaVersion = null, parentArtifact = null, parentGroup = null;
        int modules = 0;
        boolean inDeps = false, inPlugins = false, inBuildPlugins = false, inParent = false;
        int depStart = -1;
        String curGroup = null, curArtifact = null, curVersion = null, curScope = null;

        for (int i = 0; i < lines.size(); i += 1) {
            String raw = lines.get(i);
            String line = raw.trim();

            if (line.startsWith("<!--") || line.isEmpty()) continue;

            if (line.contains("<dependencies>")) inDeps = true;
            if (line.contains("</dependencies>")) inDeps = false;
            if (line.contains("<plugins>")) inPlugins = true;
            if (line.contains("</plugins>")) inPlugins = false;
            if (line.contains("<build>")) inBuildPlugins = true;
            if (line.contains("</build>")) inBuildPlugins = false;
            if (line.contains("<parent>")) inParent = true;
            if (line.contains("</parent>")) inParent = false;

            Matcher m = TAG.matcher(line);
            while (m.find()) {
                String tag = m.group(1);
                String val = m.group(2).trim();
                switch (tag) {
                    case "groupId" -> {
                        if (inDeps) curGroup = val;
                        else if (inParent) parentGroup = val;
                        else if (group == null) group = val;
                    }
                    case "artifactId" -> {
                        if (inDeps) {
                            curArtifact = val;
                            if (depStart < 0) depStart = i + 1;
                        } else if (inParent) {
                            parentArtifact = val;
                        } else if (inPlugins && inBuildPlugins) {
                            plugins.addObject().put("artifact", val).put("path", rel);
                        } else if (artifact == null) {
                            artifact = val;
                        }
                    }
                    case "version" -> {
                        if (inDeps) curVersion = val;
                        else if (javaVersion == null && !inPlugins) javaVersion = null; // 版本另行处理
                    }
                    case "scope" -> {
                        if (inDeps) curScope = val;
                    }
                    case "java.version", "maven.compiler.source", "maven.compiler.release" -> javaVersion = val;
                    case "module" -> {
                        modules += 1;
                        moduleNames.add(val);
                    }
                    default -> {
                        // 其余标签不关心
                    }
                }
            }

            if (line.contains("</dependency>")) {
                if (curGroup != null && curArtifact != null) {
                    addDep(ctx, dependencies, depsOut, "maven", curGroup, curArtifact, curVersion, curScope, rel,
                            depStart > 0 ? depStart : i + 1);
                }
                curGroup = curArtifact = curVersion = curScope = null;
                depStart = -1;
            }
        }

        art.put("groupId", group);
        art.put("artifactId", artifact);
        // 读不到就显式写 null（写 1 或 8 是在编事实）
        if (javaVersion == null) art.putNull("javaVersion");
        else art.put("javaVersion", javaVersion);
        if (parentArtifact != null) art.put("parent", parentArtifact);
        artifacts.add(art);
        if (javaVersion == null) {
            ctx.warn(ScanNote.VALUE_MISSING, rel + " 里没有 java.version / maven.compiler.source，Java 版本未知");
        }
        return modules;
    }

    // ─────────────────────────────────────────────────────────────
    // Gradle
    // ─────────────────────────────────────────────────────────────

    private static void scanGradle(ScanContext ctx, Path p, String rel,
                                   ArrayNode artifacts, ArrayNode dependencies, ArrayNode plugins,
                                   List<ScannedDep> depsOut) {
        List<String> lines = ctx.readLines(p);
        if (lines == null) return;
        String javaVersion = null;
        for (int i = 0; i < lines.size(); i += 1) {
            String line = lines.get(i);
            Matcher g = GRADLE_DEP.matcher(line);
            if (g.find()) {
                String coord = g.group(2);
                String[] parts = coord.split(":");
                String group = parts.length > 0 ? parts[0] : null;
                String artifact = parts.length > 1 ? parts[1] : null;
                String version = parts.length > 2 ? parts[2] : null;
                if (group != null && artifact != null) {
                    addDep(ctx, dependencies, depsOut, "gradle", group, artifact, version, null, rel, i + 1);
                }
                continue;
            }
            Matcher pl = GRADLE_PLUGIN.matcher(line);
            if (pl.find()) {
                plugins.addObject().put("artifact", pl.group(1)).put("path", rel);
                continue;
            }
            Matcher jv = GRADLE_JAVA.matcher(line);
            if (jv.find() && javaVersion == null) javaVersion = jv.group(1);
        }
        ObjectNode art = ctx.mapper().createObjectNode();
        art.put("path", rel);
        art.put("groupId", (String) null);
        art.put("artifactId", p.getParent().getFileName().toString());
        if (javaVersion == null) art.putNull("javaVersion");
        else art.put("javaVersion", javaVersion);
        artifacts.add(art);
    }

    // ─────────────────────────────────────────────────────────────
    // npm
    // ─────────────────────────────────────────────────────────────

    private static void scanPackageJson(ScanContext ctx, Path p, String rel,
                                        ArrayNode artifacts, ArrayNode dependencies,
                                        List<ScannedDep> depsOut) {
        try {
            JsonNode root = ctx.mapper().readTree(Files.readAllBytes(p));
            if (root.has("name")) {
                ObjectNode art = ctx.mapper().createObjectNode();
                art.put("path", rel);
                art.put("groupId", "npm");
                art.put("artifactId", root.get("name").asText());
                art.putNull("javaVersion");
                artifacts.add(art);
            }
            for (String section : new String[]{"dependencies", "devDependencies", "peerDependencies"}) {
                JsonNode deps = root.get(section);
                if (deps == null || !deps.isObject()) continue;
                var it = deps.properties().iterator();
                while (it.hasNext()) {
                    var e = it.next();
                    addDep(ctx, dependencies, depsOut, "npm", "npm", e.getKey(),
                            e.getValue().asText(null), section, rel, 0);
                }
            }
        } catch (Exception e) {
            ctx.warn(ScanNote.PARSE_SKIPPED, rel + " 不是合法 JSON，未读取依赖");
        }
    }

    private static void addDep(ScanContext ctx, ArrayNode dependencies, List<ScannedDep> depsOut,
                               String kind, String group, String artifact, String version, String scope,
                               String rel, int line) {
        ObjectNode n = dependencies.addObject();
        n.put("group", group);
        n.put("artifact", artifact);
        if (version == null) n.putNull("version");
        else n.put("version", version);
        if (scope == null) n.putNull("scope");
        else n.put("scope", scope);
        n.put("path", rel);
        n.put("line", line);
        depsOut.add(new ScannedDep(kind, group, artifact, version, scope, rel, line));
    }

    /** 给前端用的：把 build.dependencies 里的坐标摊平成去重后的 key 列表 */
    public static List<String> depKeys(ArrayNode dependencies) {
        List<String> out = new ArrayList<>();
        for (JsonNode n : dependencies) {
            out.add(n.path("group").asText("") + ":" + n.path("artifact").asText(""));
        }
        out.sort(String::compareTo);
        return out;
    }
}
