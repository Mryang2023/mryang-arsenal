package com.arsenal.qa;

import com.arsenal.domain.Rule;
import com.arsenal.domain.Severity;
import com.arsenal.loader.RuleIndex;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * qaReport v2 的「按规则」聚合（2026-10-18 质检台 Q1，B5 的一半）。
 *
 * <p><b>后端算，不前端算</b>（拍板项 3）：① 留档 JSON 直接可读聚合；② {@code collapsed}
 * （引擎折叠计数）的语义只有后端知道；③ 前端少一套聚合逻辑就少一处口径打架。
 *
 * <p><b>铁律：count === items.length === 平铺视图里这条规则该档的条数。</b>
 * 聚合视图与平铺视图同源不同算法，count 打架就是 bug —— 所以 count 不是算出来的，
 * 是 items 装完之后取 size 的。引擎折叠掉的命中（collapsed）单独记 {@code collapsedTotal}，
 * 只做披露，不混进 count。
 *
 * <p>两个判据来源不混组（tier 字段）：static = 规则引擎（violationNode），
 * semantic = LLM 语义深检（自带 confidence 纪律，永不进 P0 —— 分组也不混）。
 * 组序：严重度（MUST → NEVER → SHOULD → MAY，读枚举不写死）→ tier → ruleId。
 */
public final class FindingGrouper {

    private FindingGrouper() {
    }

    /** 一条静态 finding + 它在平铺视图里的档位（p0 / p1 / other）。 */
    public record StaticF(String tier, JsonNode v) {
    }

    private static final List<String> SEV_ORDER = List.of("MUST", "NEVER", "SHOULD", "MAY");

    private static int sevRank(String code) {
        int i = SEV_ORDER.indexOf(code);
        return i < 0 ? SEV_ORDER.size() : i;
    }

    /**
     * @param statics   平铺静态 findings（focus 模式下传圈内保留后的那份 —— 聚合与平铺必须同源）
     * @param semantics 语义深检 findings（原样；没跑就传空列表，聚合里就没有 semantic 组）
     */
    public static ArrayNode group(ObjectMapper mapper, RuleIndex index,
                                  List<StaticF> statics, List<JsonNode> semantics) {
        Map<String, Acc> groups = new LinkedHashMap<>();

        for (StaticF sf : statics) {
            JsonNode v = sf.v();
            String ruleId = v.path("ruleId").asText("");
            Rule rule = index.byId(ruleId).orElse(null);
            String sev = rule != null && rule.severity() != null
                    ? rule.severity().code()
                    : v.path("severity").asText("SHOULD");
            String title = rule != null && rule.title() != null ? rule.title() : v.path("title").asText(ruleId);
            Acc acc = groups.computeIfAbsent("static|" + ruleId, k -> new Acc(mapper, ruleId, title, sev, "static"));
            ObjectNode item = acc.items.addObject();
            item.put("file", v.path("file").asText(""));
            item.put("line", v.path("line").asInt());
            item.put("tier", sf.tier());
            acc.collapsed += v.path("collapsed").asInt(0);
        }

        for (JsonNode f : semantics) {
            String ruleId = f.path("ruleId").asText("");
            Acc acc = groups.computeIfAbsent("semantic|" + ruleId,
                    k -> new Acc(mapper, ruleId, f.path("ruleTitle").asText(ruleId),
                            f.path("severity").asText("SHOULD"), "semantic"));
            ObjectNode item = acc.items.addObject();
            item.put("file", f.path("file").asText(""));
            item.put("line", f.path("line").asInt());
        }

        List<Acc> ordered = new ArrayList<>(groups.values());
        ordered.sort((a, b) -> {
            int c = Integer.compare(sevRank(a.severity), sevRank(b.severity));
            if (c != 0) {
                return c;
            }
            c = a.tier.compareTo(b.tier);
            if (c != 0) {
                return c;
            }
            return a.ruleId.compareTo(b.ruleId);
        });

        ArrayNode out = mapper.createArrayNode();
        for (Acc acc : ordered) {
            ObjectNode g = out.addObject();
            g.put("ruleId", acc.ruleId);
            g.put("title", acc.title);
            g.put("severity", acc.severity);
            g.put("tier", acc.tier);
            g.put("count", acc.items.size());
            if (acc.collapsed > 0) {
                g.put("collapsedTotal", acc.collapsed);
            }
            g.set("items", acc.items);
        }
        return out;
    }

    /** 聚合累加器：count 永远 = items.size()，不另设计数器 —— 两视图打架在这条就断了根。 */
    private static final class Acc {
        final String ruleId;
        final String title;
        final String severity;
        final String tier;
        final ArrayNode items;
        int collapsed;

        Acc(ObjectMapper mapper, String ruleId, String title, String severity, String tier) {
            this.ruleId = ruleId;
            this.title = title;
            this.severity = severity;
            this.tier = tier;
            this.items = mapper.createArrayNode();
        }
    }
}
