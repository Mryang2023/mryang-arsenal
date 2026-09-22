package com.arsenal.scan;

import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * 依赖坐标 → 技术 key。**只做查表，不做推断。**
 *
 * 没命中的依赖不会被丢掉，也不会被「猜一个近似的」：它进 {@code unmatched}，
 * 并由调用方写成一条 {@code UNMAPPED_DEPENDENCY} note。这份未命中清单本身就是
 * 待补的映射与图标 —— 它比「悄悄当成没看见」有用得多。
 *
 * 每条命中必须带 evidence（文件路径 + 行号）。这是「不许猜」的强制形式：
 * 图上说这个项目用了 Redis，点开要能看到是 pom.xml 第 42 行写的。
 */
public final class TechStackResolver {

    /** 同一个 tech 只出一个节点，evidence 合并 —— 一份依赖在图上是两个节点就错了 */
    private final Map<String, ScanRule> byKey = new LinkedHashMap<>();

    public TechStackResolver(List<ScanRule> rules) {
        for (ScanRule r : rules) {
            byKey.putIfAbsent(key(r.kind(), r.group(), r.artifact()), r);
        }
    }

    private static String key(String kind, String group, String artifact) {
        return (kind == null ? "maven" : kind) + "|" + group + "|" + artifact;
    }

    /** 精确匹配优先，其次同 group 的通配（artifact = *） */
    public ScanRule match(String kind, String group, String artifact) {
        ScanRule exact = byKey.get(key(kind, group, artifact));
        if (exact != null) return exact;
        return byKey.get(key(kind, group, "*"));
    }

    /**
     * 归一化一批依赖。
     *
     * @param deps 依赖（含来源文件与行号）
     * @return {@code {matched:[…], unmatched:[…], coverage: 0..1}}，全部按 key 排序（确定性）
     */
    public ObjectNode resolve(List<ScannedDep> deps, ObjectMapper mapper) {
        Map<String, Hit> hits = new LinkedHashMap<>();
        Map<String, Miss> misses = new LinkedHashMap<>();

        for (ScannedDep d : deps) {
            ScanRule rule = match(d.kind(), d.group(), d.artifact());
            if (rule == null) {
                String mk = d.group() + ":" + d.artifact();
                Miss m = misses.computeIfAbsent(mk, k -> new Miss(d.group(), d.artifact(), new ArrayList<>()));
                m.evidence.add(new Evidence(d.path(), d.line()));
                continue;
            }
            Hit h = hits.computeIfAbsent(rule.tech(), t -> new Hit(rule, new ArrayList<>()));
            h.evidence.add(new Evidence(d.path(), d.line()));
        }

        ObjectNode out = mapper.createObjectNode();
        ArrayNode matched = out.putArray("matched");
        hits.values().stream()
                .sorted(Comparator.comparing(h -> h.rule.tech()))
                .forEach(h -> {
                    ObjectNode n = matched.addObject();
                    n.put("tech", h.rule.tech());
                    n.put("name", h.rule.name());
                    if (h.rule.icon() != null) n.put("icon", h.rule.icon());
                    if (h.rule.dim() != null) n.put("dim", h.rule.dim());
                    if (h.rule.opt() != null) n.put("opt", h.rule.opt());
                    ArrayNode ev = n.putArray("evidence");
                    h.evidence.stream()
                            .sorted(Comparator.comparing((Evidence e) -> e.path).thenComparingInt(e -> e.line))
                            .forEach(e -> {
                                ObjectNode en = ev.addObject();
                                en.put("path", e.path);
                                en.put("line", e.line);
                            });
                });

        ArrayNode unmatched = out.putArray("unmatched");
        misses.values().stream()
                .sorted(Comparator.comparing(m -> m.group + ":" + m.artifact))
                .forEach(m -> {
                    ObjectNode n = unmatched.addObject();
                    n.put("group", m.group);
                    n.put("artifact", m.artifact);
                    n.put("count", m.evidence.size());
                    ArrayNode ev = n.putArray("evidence");
                    m.evidence.stream()
                            .sorted(Comparator.comparing((Evidence e) -> e.path).thenComparingInt(e -> e.line))
                            .limit(5)
                            .forEach(e -> {
                                ObjectNode en = ev.addObject();
                                en.put("path", e.path);
                                en.put("line", e.line);
                            });
                });

        int total = deps.size();
        double coverage = total == 0 ? 0 : Math.round((double) hits.size() / (double) (hits.size() + misses.size()) * 100.0) / 100.0;
        out.put("coverage", coverage);
        out.put("depCount", total);
        return out;
    }

    /** 给 /api/scan/rules 的反查视图 */
    public ArrayNode describe(ObjectMapper mapper) {
        ArrayNode arr = mapper.createArrayNode();
        byKey.values().stream()
                .sorted(Comparator.comparing((ScanRule r) -> r.group().toLowerCase(Locale.ROOT))
                        .thenComparing(r -> r.artifact()))
                .forEach(r -> {
                    ObjectNode n = arr.addObject();
                    n.put("kind", r.kind());
                    n.put("group", r.group());
                    n.put("artifact", r.artifact());
                    n.put("tech", r.tech());
                    n.put("name", r.name());
                    if (r.icon() != null) n.put("icon", r.icon());
                    if (r.dim() != null) n.put("dim", r.dim());
                    if (r.opt() != null) n.put("opt", r.opt());
                });
        return arr;
    }

    private record Evidence(String path, int line) {
    }

    private static final class Hit {
        final ScanRule rule;
        final List<Evidence> evidence;

        Hit(ScanRule rule, List<Evidence> evidence) {
            this.rule = rule;
            this.evidence = evidence;
        }
    }

    private static final class Miss {
        final String group;
        final String artifact;
        final List<Evidence> evidence;

        Miss(String group, String artifact, List<Evidence> evidence) {
            this.group = group;
            this.artifact = artifact;
            this.evidence = evidence;
        }
    }
}
