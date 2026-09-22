package com.arsenal.scan;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

/**
 * 配置文件扫描：yml / yaml / properties / env。
 *
 * 两件事必须做对：
 *   <b>一、脱敏。</b>{@code password / secret / token / key} 的值一律 {@code ***}，
 *   只留键名。扫描结果是要贴进文档、可能发出去的东西，真密码一旦进去就收不回来。
 *   {@code .env} 更严格：只留键名，值一个都不留。
 *   <b>二、不猜。</b>YAML 的缩进层级由行首空格决定，这里按缩进栈还原点分键名；
 *   遇到解析不了的形状（多行块、列表里嵌 map）就记一条 note，不硬凑一个键名出来。
 */
public final class ConfigScanner {

    /** 单个文件最多记多少个值。配置文件可能有几千行，事实 JSON 不该跟着膨胀 */
    private static final int MAX_VALUES = 60;

    private ConfigScanner() {
    }

    public static ArrayNode scan(ScanContext ctx) {
        ArrayNode out = ctx.mapper().createArrayNode();
        List<Path> configs = new ArrayList<>();
        for (Path p : ctx.files()) {
            String rel = ctx.rel(p);
            String name = p.getFileName().toString().toLowerCase();
            if (name.endsWith(".yml") || name.endsWith(".yaml") || name.endsWith(".properties")
                    || name.equals(".env") || name.endsWith(".env")) {
                // CI / Helm / K8s / compose 清单由各自的 Scanner 负责，
                // 混进配置列表会让「这个项目的配置」看起来有七八份，其中五份是部署清单
                if (isDeployOrCi(rel, name)) continue;
                configs.add(p);
            }
        }
        // 排序：application.yml 排在 config 子目录之前，事实 JSON 的顺序才稳定
        configs.sort((a, b) -> ctx.rel(a).compareTo(ctx.rel(b)));
        for (Path p : configs) {
            ctx.tick();
            String rel = ctx.rel(p);
            String name = p.getFileName().toString().toLowerCase();
            List<String> lines = ctx.readLines(p);
            if (lines == null) continue;
            ObjectNode node = ctx.mapper().createObjectNode();
            node.put("path", rel);
            ArrayNode keys = node.putArray("keys");
            ObjectNode values = node.putObject("values");
            if (name.endsWith(".properties")) {
                scanProperties(ctx, lines, rel, keys, values);
            } else if (name.contains(".env")) {
                scanEnv(ctx, lines, rel, keys, values);
            } else {
                scanYaml(ctx, lines, rel, keys, values);
            }
            out.add(node);
        }
        return out;
    }

    // ─────────────────────────────────────────────────────────────
    // YAML：按缩进栈还原点分键名
    // ─────────────────────────────────────────────────────────────

    private static void scanYaml(ScanContext ctx, List<String> lines, String rel, ArrayNode keys, ObjectNode values) {
        // 用 List 当栈（push/pop 走尾部）：ArrayDeque 的 push 是加到头部，
        // 直接 new ArrayList<>(deque) 会把键名顺序倒过来 —— 于是 server.port 变成 port.server。
        List<Integer> stack = new ArrayList<>();
        List<String> path = new ArrayList<>();
        List<String> flat = new ArrayList<>();
        for (int i = 0; i < lines.size(); i += 1) {
            String raw = lines.get(i);
            if (raw.isBlank()) continue;
            String trimmed = raw.trim();
            if (trimmed.startsWith("#")) continue;
            if (trimmed.equals("---") || trimmed.equals("...")) continue;
            int indent = raw.length() - raw.stripLeading().length();
            if (trimmed.startsWith("- ")) {
                // 列表项：不还原键名（无法确定它是哪一项），只记一条 note 说明这里没读
                ctx.warn(ScanNote.PARSE_SKIPPED, rel + ":" + (i + 1) + " 是列表项，未还原键名");
                continue;
            }
            int colon = trimmed.indexOf(':');
            if (colon <= 0) continue;
            String key = trimmed.substring(0, colon).trim();
            String value = trimmed.length() > colon + 1 ? trimmed.substring(colon + 1).trim() : "";

            while (!stack.isEmpty() && stack.get(stack.size() - 1) >= indent) {
                stack.remove(stack.size() - 1);
                path.remove(path.size() - 1);
            }
            stack.add(indent);
            path.add(key);
            String full = String.join(".", path);
            if (value.isEmpty() || value.equals("|") || value.equals(">")) {
                // 有可能是嵌套，也有可能是多行块。先记键名，值留给子键
                flat.add(full);
                continue;
            }
            flat.add(full);
            if (values.size() < MAX_VALUES) {
                values.put(full, ScanGuard.redact(full, stripQuotes(value)));
            }
        }
        for (String k : flat) {
            keys.add(k);
        }
    }

    private static void scanProperties(ScanContext ctx, List<String> lines, String rel, ArrayNode keys, ObjectNode values) {
        for (int i = 0; i < lines.size(); i += 1) {
            String line = lines.get(i).trim();
            if (line.isEmpty() || line.startsWith("#") || line.startsWith("!")) continue;
            int eq = line.indexOf('=');
            int colon = line.indexOf(':');
            int sep = eq >= 0 ? eq : colon;
            if (sep <= 0) continue;
            String key = line.substring(0, sep).trim();
            String value = line.substring(sep + 1).trim();
            keys.add(key);
            if (values.size() < MAX_VALUES) {
                values.put(key, ScanGuard.redact(key, value));
            }
        }
    }

    /** .env：只留键名。这类文件的值通常整份都是机密，留一个都不行 */
    private static void scanEnv(ScanContext ctx, List<String> lines, String rel, ArrayNode keys, ObjectNode values) {
        scanProperties(ctx, lines, rel, keys, values);
        List<String> names = new ArrayList<>();
        values.fieldNames().forEachRemaining(names::add);
        for (String it : names) {
            values.put(it, "***");
        }
        ctx.note(ScanNote.INFO, "ENV_ONLY_KEYS", rel + " 是 .env，只保留键名");
    }

    private static boolean isDeployOrCi(String rel, String name) {
        String r = rel.toLowerCase();
        return r.contains(".gitlab-ci") || r.contains(".github/workflows/") || r.contains(".drone")
                || r.contains("azure-pipelines") || r.contains("docker-compose") || r.contains("compose")
                || name.equals("chart.yaml") || name.equals("values.yaml")
                || r.contains("deploy/") || r.contains("k8s/") || r.contains("helm/");
    }

    private static String stripQuotes(String v) {
        if (v.length() >= 2 && ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'")))) {
            return v.substring(1, v.length() - 1);
        }
        return v;
    }
}
