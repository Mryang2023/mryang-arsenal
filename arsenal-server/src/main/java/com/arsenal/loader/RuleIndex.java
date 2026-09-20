package com.arsenal.loader;

import com.arsenal.domain.Rule;
import com.arsenal.domain.RulesetMeta;
import com.arsenal.domain.Severity;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;

/**
 * 规则内存索引。进程启动时构建一次，之后只读。
 *
 * 62 条规则这个规模不需要任何搜索引擎 —— 一个 HashMap 加几个 stream 足够，
 * 而且零依赖、零运维。真正需要外部索引的规模至少要多两个数量级。
 */
@Component
public class RuleIndex {

    private static final Logger log = LoggerFactory.getLogger(RuleIndex.class);

    private final LoadedRuleset loaded;
    private final Map<String, Rule> byId;
    private final Map<String, List<Rule>> byCategory;
    private final Map<String, Long> sourceCounts;
    private final Stats stats;

    public RuleIndex(RuleLoader loader) {
        this.loaded = loader.load();

        Map<String, Rule> idMap = new LinkedHashMap<>();
        Map<String, List<Rule>> catMap = new LinkedHashMap<>();
        Map<String, Long> srcMap = new TreeMap<>();

        for (Rule r : loaded.rules()) {
            idMap.put(r.id(), r);
            catMap.computeIfAbsent(r.category(), k -> new ArrayList<>()).add(r);
            for (Rule.Source s : r.sources()) {
                String key = s.ref() == null ? "未知" : s.ref().split("[ ·§]")[0].trim();
                srcMap.merge(key, 1L, Long::sum);
            }
        }

        catMap.values().forEach(list -> list.sort(Comparator.comparing(Rule::id)));
        this.byId = Map.copyOf(idMap);
        this.byCategory = Map.copyOf(catMap);
        this.sourceCounts = Map.copyOf(srcMap);
        this.stats = computeStats(loaded);

        log.info("索引就绪：{} 个分类，{} 个溯源出处，可自动检出 {} 条（正则层）",
                byCategory.size(), sourceCounts.size(), stats.regexCapable());
    }

    // ──────────────────────────────────────────────── 只读访问

    public RulesetMeta meta() {
        return loaded.meta();
    }

    public List<Rule> all() {
        return loaded.rules();
    }

    public List<Rule> active() {
        return loaded.rules().stream().filter(Rule::isActive).toList();
    }

    public Optional<Rule> byId(String id) {
        return Optional.ofNullable(byId.get(id));
    }

    /**
     * 按分类取规则。
     *
     * 这里曾经还有一个 {@code byCategory(String)} 单数版访问器，已经删掉：
     * 它返回的是**全量**索引，而调用方（导出的 markdown）手里是**筛选后**的列表，
     * 两者混用就会出现「分类标题写 9 条、下面只列 3 条」。
     * 现在需要分组的地方一律对「手里那份列表」分组，不再回查全量索引。
     */
    public Map<String, List<Rule>> grouped() {
        return byCategory;
    }

    public Map<String, Long> sourceCounts() {
        return sourceCounts;
    }

    public Stats stats() {
        return stats;
    }

    // ──────────────────────────────────────────────── 检索

    public List<Rule> filter(Set<Severity> severities, Set<String> categories, boolean autoOnly) {
        return active().stream()
                .filter(r -> severities == null || severities.isEmpty() || severities.contains(r.severity()))
                .filter(r -> categories == null || categories.isEmpty() || categories.contains(r.category()))
                .filter(r -> !autoOnly || r.checkOrEmpty().hasRegex())
                .toList();
    }

    /**
     * 关键词检索。命中字段按权重排序：ID &gt; 标题 &gt; 标签 &gt; 约束句 &gt; 正文。
     * 无关键词时返回按分类、ID 排序的全量列表。
     */
    public List<Rule> search(String q, Set<Severity> severities, Set<String> categories, boolean autoOnly) {
        List<Rule> pool = filter(severities, categories, autoOnly);
        if (q == null || q.isBlank()) {
            return pool.stream()
                    .sorted(Comparator.comparing(Rule::category).thenComparing(Rule::id))
                    .toList();
        }

        String needle = q.trim().toLowerCase(Locale.ROOT);
        record Scored(Rule rule, int score) {
        }

        return pool.stream()
                .map(r -> new Scored(r, score(r, needle)))
                .filter(s -> s.score() > 0)
                .sorted(Comparator.comparingInt(Scored::score).reversed()
                        .thenComparing(s -> s.rule().id()))
                .map(Scored::rule)
                .toList();
    }

    private int score(Rule r, String q) {
        int s = 0;
        String id = nz(r.id()).toLowerCase(Locale.ROOT);
        if (id.equals(q)) {
            s += 1000;
        } else if (id.contains(q)) {
            s += 200;
        }
        if (nz(r.title()).toLowerCase(Locale.ROOT).contains(q)) {
            s += 120;
        }
        if (r.tags().stream().anyMatch(t -> nz(t).toLowerCase(Locale.ROOT).contains(q))) {
            s += 90;
        }
        if (nz(r.promptFragment()).toLowerCase(Locale.ROOT).contains(q)) {
            s += 50;
        }
        String body = (nz(r.rationale()) + nz(r.bad()) + nz(r.good())).toLowerCase(Locale.ROOT);
        if (body.contains(q)) {
            s += 20;
        }
        return s;
    }

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    // ──────────────────────────────────────────────── 统计

    private Stats computeStats(LoadedRuleset set) {
        List<Rule> rules = set.rules();
        Map<String, Integer> bySeverity = new LinkedHashMap<>();
        Map<String, Integer> byCategory = new LinkedHashMap<>();

        int must = 0;
        int never = 0;
        int regex = 0;
        int ast = 0;
        int llm = 0;
        int promptChars = 0;

        for (Rule r : rules) {
            Severity sev = r.severity();
            if (sev != null) {
                bySeverity.merge(sev.code(), 1, Integer::sum);
                if (sev == Severity.MUST) {
                    must++;
                } else if (sev == Severity.NEVER) {
                    never++;
                }
            }
            byCategory.merge(nz(r.category()), 1, Integer::sum);

            Rule.Check c = r.checkOrEmpty();
            if (c.hasRegex()) {
                regex++;
            }
            if (c.hasAst()) {
                ast++;
            }
            if (c.hasLlm()) {
                llm++;
            }
            promptChars += nz(r.promptFragment()).length();
        }

        int mustClass = must + never;
        int limit = set.meta().mustHardLimit();

        return new Stats(
                rules.size(),
                Map.copyOf(bySeverity),
                Map.copyOf(byCategory),
                mustClass,
                limit,
                (int) Math.round(mustClass * 100.0 / Math.max(1, limit)),
                regex,
                ast,
                llm,
                rules.size() - regex,
                sourceCounts.size(),
                promptChars,
                Math.round(promptChars / 1.6f)
        );
    }

    /** 规则集健康度。前端侧边栏的配额进度条用的就是同样的口径。 */
    public record Stats(
            int total,
            Map<String, Integer> bySeverity,
            Map<String, Integer> byCategory,
            int mustClass,
            int mustHardLimit,
            int budgetUsedPct,
            int regexCapable,
            int astCapable,
            int llmCapable,
            int manualOnly,
            int sources,
            int promptChars,
            int promptTokensEstimate
    ) {
    }
}
