package com.arsenal.mcp;

import com.arsenal.loader.RuleLoader;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * MCP 工具定义目录 —— 读的是 {@code arsenal-rules/mcp-tools.json}。
 *
 * <b>这个类存在的唯一理由，是消灭「同一份工具 schema 抄三遍」。</b>
 * 在这之前：前端 exporters.ts 里硬编码了一份 90 行 schema，
 * 后端 {@code buildMcp} 只能给一个 {@code _tools} 字符串数组，
 * 「两端刻意不一致」被写进注释当成了有意为之的妥协。
 *
 * 把定义变成数据之后，前端导出器、后端导出器、MCP Server 三处读的是同一个文件，
 * 于是那条差异不再是「克制的选择」，而是单纯的不一致 —— 可以直接上断言。
 *
 * <b>校验放在加载期，不在使用期。</b> 工具名重复、缺 description、缺 inputSchema，
 * 这类问题在运行时的表现是「AI 客户端连上了，但不会调你的工具 / 调不通」——
 * 从客户端那一侧几乎无法定位。所以宁可让进程起不来。
 */
@Component
public class McpToolCatalog {

    private static final Logger log = LoggerFactory.getLogger(McpToolCatalog.class);

    /** 与 arsenal-web/scripts/sync-rules.mjs 读的是同一个文件、同一批校验。 */
    public static final String FILE_NAME = "mcp-tools.json";

    /**
     * 配置里的说明行。
     *
     * 两端各写一份字面量是刻意的：它要进产物、又不能被序列化器改写风格，
     * 由 parity 逐字节比对守着 —— 一旦分叉就是红的。
     * （前端那份在 arsenal-web/src/lib/exporters.ts 的 MCP_CONFIG_COMMENT。）
     */
    public static final String CONFIG_COMMENT =
            "MCP Server 配置（stdio）。把 __ARSENAL_HOME__ 替换成本仓库的绝对路径后再用；"
                    + "工具定义来自 arsenal-rules/mcp-tools.json，与后端导出器读的是同一份，两端产物逐字节一致。"
                    + "适配层实现在 arsenal-server/scripts/mcp-stdio.mjs（只需 node；AST 深度判定已由后端 AstEngine 执行），"
                    + "规则数据源为 arsenal-rules/**/*.json，此处不重复定义任何规则内容。";

    private final Path file;
    private final JsonNode root;
    private final JsonNode tools;

    public McpToolCatalog(RuleLoader loader, ObjectMapper mapper) {
        this.file = loader.rulesRoot().resolve(FILE_NAME);
        if (!Files.isRegularFile(file)) {
            throw new IllegalStateException(
                    "MCP 工具定义缺失：" + file + " —— 它是导出器与适配层共读的数据源，不能少");
        }
        try {
            this.root = mapper.readTree(Files.readString(file, StandardCharsets.UTF_8));
        } catch (IOException e) {
            throw new UncheckedIOException("解析 MCP 工具定义失败：" + file, e);
        }

        List<String> problems = new ArrayList<>();
        if (text(path("server", "name")).isBlank()) {
            problems.add("server.name 缺失");
        }
        if (text(path("launcher", "command")).isBlank()) {
            problems.add("launcher.command 缺失");
        }
        JsonNode list = root.path("tools");
        if (!list.isArray() || list.isEmpty()) {
            problems.add("tools 为空");
        } else {
            Set<String> seen = new HashSet<>();
            for (JsonNode t : list) {
                String name = t.path("name").asText("");
                if (name.isBlank()) {
                    problems.add("tools[] 存在缺少 name 的条目");
                    continue;
                }
                if (!seen.add(name)) {
                    problems.add("工具名重复：" + name);
                }
                if (t.path("description").asText("").isBlank()) {
                    problems.add("工具 " + name + " 缺少 description（AI 靠它决定调不调）");
                }
                if (!t.has("inputSchema")) {
                    problems.add("工具 " + name + " 缺少 inputSchema");
                }
            }
        }
        if (!problems.isEmpty()) {
            throw new IllegalStateException(
                    FILE_NAME + " 校验未通过，共 " + problems.size() + " 个问题：\n  - "
                            + String.join("\n  - ", problems));
        }

        this.tools = list;
        log.info("MCP 工具定义就绪：{} 个工具（{}）", tools.size(), toolNames());
    }

    public Path file() {
        return file;
    }

    public String serverName() {
        return text(path("server", "name"));
    }

    public String serverDescription() {
        return text(path("server", "description"));
    }

    /** 服务端支持的协议版本。客户端传自己的版本时，若认识就回它、不认识就回这个。 */
    public String protocolVersion() {
        String v = text(path("server", "protocolVersion"));
        return v.isBlank() ? "2024-11-05" : v;
    }

    public String launcherCommand() {
        return text(path("launcher", "command"));
    }

    /** launcher 整段（command / args / env），后端导出器按行拼装产物时要逐字段取。 */
    public JsonNode launcher() {
        return root.path("launcher");
    }

    public JsonNode launcherArgs() {
        return root.path("launcher").path("args");
    }

    /** 环境变量。用 JsonNode 而不是 Map，是为了保住数据里的键顺序（导出产物要逐字节一致）。 */
    public JsonNode launcherEnv() {
        return root.path("launcher").path("env");
    }

    public JsonNode tools() {
        return tools;
    }

    public List<String> toolNames() {
        List<String> out = new ArrayList<>();
        for (JsonNode t : tools) {
            out.add(t.path("name").asText());
        }
        return out;
    }

    // ────────────────────────────────────────────────

    private JsonNode path(String... keys) {
        JsonNode n = root;
        for (String k : keys) {
            n = n.path(k);
        }
        return n;
    }

    private String text(JsonNode n) {
        return n.isTextual() ? n.textValue() : "";
    }
}
