package com.arsenal.loader;

import com.arsenal.domain.Rule;
import com.arsenal.domain.RulesetMeta;
import com.arsenal.domain.Severity;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.stream.Stream;

/**
 * 规则内存索引。进程启动时构建一次，之后可经 {@link #refresh()} 热重载。
 *
 * <p>62 条规则这个规模不需要任何搜索引擎 —— 一个 HashMap 加几个 stream 足够，
 * 而且零依赖、零运维。真正需要外部索引的规模至少要多两个数量级。
 *
 * <p><b>热加载（2026-10-18 质检台 Q1，B1）：</b>旧实现把索引字段当 final、启动后只读，
 * 「改规则必重启」。现在所有索引状态收进不可变 {@link Snapshot}，单一 {@code volatile} 引用持有：
 * 读方（LintEngine / AutopsyService / QaService / Controller 们）每次现读快照，改造对它们透明；
 * 写方 {@link #refresh()} 重新 load 后整块换引用 —— 读到的一定是完整一致的快照，没有半新半旧。
 * 重载失败时<b>保留旧快照</b>并抛错：服务不能因为一次坏 JSON 失去保护。
 *
 * <p><b>缓存核实（B3，先查再改）：</b>LintEngine 的 Compiled/AstCompiled 是 run() 内局部变量
 * （每跑现编译）；AstEngine 的 checkers 是构造期代码注册（不是规则数据）——
 * 两者都不持规则对象引用，热加载无死角，无需清任何派生缓存。
 */
@Component
public class RuleIndex {

    private static final Logger log = LoggerFactory.getLogger(RuleIndex.class);

    private final RuleLoader loader;
    private volatile Snapshot snap;

    /** 一次加载的完整只读快照。索引字段全部收在这里，refresh 整块换。 */
    private record Snapshot(
            LoadedRuleset loaded,
            Map<String, Rule> byId,
            Map<String, List<Rule>> byCategory,
            Map<String, Long> sourceCounts,
            Stats stats,
            Instant loadedAt,
            String filesNewestMtime
    ) {
    }

    public RuleIndex(RuleLoader loader) {
        this.loader = loader;
        this.snap = build(loader.load());
        log.info("索引就绪：{} 个分类，{} 个溯源出处，可自动检出 {} 条（正则层）",
                snap.byCategory().size(), snap.sourceCounts().size(), snap.stats().regexCapable());
    }

    private Snapshot build(LoadedRuleset loaded) {
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

        Instant at = Instant.now();
        String mtime = newestMtimeOfRuleset(loaded);
        return new Snapshot(loaded, Map.copyOf(idMap), Map.copyOf(catMap), Map.copyOf(srcMap),
                computeStats(loaded, srcMap.size()), at, mtime);
    }

    /**
     * 规则库文件最新 mtime（B6）：启动与每次 reload 时各算一次，不每次 scan 都走 IO。
     * 报告 stamp 带上它，前端才有依据亮「规则库文件已变更但未重载」的黄条。
     */
    private String newestMtimeOfRuleset(LoadedRuleset set) {
        if (set.files().isEmpty()) {
            return "";
        }
        Path root = set.files().get(0).getParent() == null
                ? null : set.files().get(0).getParent().getParent();
        if (root == null || !Files.isDirectory(root)) {
            return "";
        }
        long newest = 0L;
        try (Stream<Path> walk = Files.walk(root)) {
            for (Path p : (Iterable<Path>) walk.filter(Files::isRegularFile)
                    .filter(p -> p.getFileName().toString().endsWith(".json"))::iterator) {
                try {
                    long m = Files.getLastModifiedTime(p).toMillis();
                    if (m > newest) {
                        newest = m;
                    }
                } catch (IOException e) {
                    log.warn("读规则文件 mtime 失败，跳过：{}", p);
                }
            }
        } catch (IOException e) {
            log.warn("规则库目录遍历失败，filesNewestMtime 记空：{}", root);
            return "";
        }
        return newest == 0L ? "" : Instant.ofEpochMilli(newest).toString();
    }

    // ──────────────────────────────────────────────── 热重载

    /**
     * 重载结果：前后规则数与版本都出去 —— 「重载了但其实没重读」要靠这组数字现形。
     */
    public record ReloadResult(
            int before,
            int after,
            String versionBefore,
            String versionAfter,
            String loadedAt,
            String filesNewestMtime
    ) {
    }

    /**
     * 热重载：重新读盘、重建快照、整块换引用。
     *
     * <p>失败语义：<b>保留旧快照</b>再抛错 —— 坏 JSON / 缺文件只应该让「这次重载」失败，
     * 不能让服务失去已经验证过的旧规则集。synchronized 串行化并发重载
     * （端点层还有 AtomicBoolean 防重入，这里是最后防线）。
     */
    public synchronized ReloadResult refresh() {
        Snapshot old = snap;
        LoadedRuleset fresh;
        try {
            fresh = loader.load();
        } catch (RuntimeException e) {
            log.error("规则集重载失败，保留旧快照（版本 {}，{} 条）：{}",
                    old.loaded().meta().version(), old.loaded().rules().size(), e.getMessage());
            throw new IllegalStateException("规则集重载失败，已保留旧规则集（版本 "
                    + old.loaded().meta().version() + "）：" + e.getMessage(), e);
        }
        this.snap = build(fresh);
        log.info("规则集已热重载：{} 条 → {} 条　版本 {} → {}",
                old.loaded().rules().size(), fresh.rules().size(),
                old.loaded().meta().version(), fresh.meta().version());
        return new ReloadResult(
                old.loaded().rules().size(), fresh.rules().size(),
                old.loaded().meta().version(), fresh.meta().version(),
                snap.loadedAt().toString(), snap.filesNewestMtime());
    }

    // ──────────────────────────────────────────────── 只读访问（全部现读快照）

    public RulesetMeta meta() {
        return snap.loaded().meta();
    }

    public List<Rule> all() {
        return snap.loaded().rules();
    }

    public List<Rule> active() {
        return snap.loaded().rules().stream().filter(Rule::isActive).toList();
    }

    /** 本次加载时间（报告 ruleset stamp 用）。 */
    public Instant loadedAt() {
        return snap.loadedAt();
    }

    /** 规则库文件最新 mtime（B6）。晚于 loadedAt ⇒ 有文件改了没重载。 */
    public String filesNewestMtime() {
        return snap.filesNewestMtime();
    }

    public Optional<Rule> byId(String id) {
        return Optional.ofNullable(snap.byId().get(id));
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
        return snap.byCategory();
    }

    public Map<String, Long> sourceCounts() {
        return snap.sourceCounts();
    }

    public Stats stats() {
        return snap.stats();
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

    private Stats computeStats(LoadedRuleset set, int sourceCount) {
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
                sourceCount,
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
