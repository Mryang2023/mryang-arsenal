# -*- coding: utf-8 -*-
"""技术主题 · 本地缓存（Cache-Aside）。

案例库三层结构的第四个主题：

    L1 技术（本文件）      缓存解决什么、什么时候该用、自身边界
    L2 场景                什么情况下用（带可核对信号）
    L3 实现方案            防穿透 / 击穿 / 雪崩 + 读写一致性，附模拟接口实测

「模拟接口测试」用 HttpServer 当慢数据库：100 次相同查询，
对比「每次都打 DB」与「缓存后只打 1 次」，命中率差异是真实的。
"""

CACHE_ASIDE = r"""package com.example.cache;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.locks.ReentrantLock;
import java.util.function.Function;

/**
 * Cache-Aside 封装：读时先查缓存，未命中查库并回填。
 * 同一份代码防住三类经典事故：
 *   - 穿透：反复查「不存在的 key」打到 DB  →  空值也缓存
 *   - 击穿：热点 key 失效瞬间，大量请求同时打向 DB  →  单 key 互斥重建
 *   - 雪崩：大量 key 同一时刻集体失效  →  基础 TTL（生产应叠加随机抖动）
 */
public class ProductCache {

    // 基础 TTL：生产环境应在 expireAfterWrite 上叠加随机抖动（如 5±2 分钟），
    // 避免大量 key 在同一时刻集体失效把 DB 瞬间打爆（防雪崩）。
    private final Cache<Long, String> cache = Caffeine.newBuilder()
            .expireAfterWrite(5, TimeUnit.MINUTES)
            .build();

    // 单 key 重建互斥：热点 key 失效瞬间，只放一个请求去查库，其余复用其结果（防击穿）。
    private final Map<Long, ReentrantLock> locks = new ConcurrentHashMap<>();

    // 空值占位：查不到的 key 也回填一小段时间，避免反复打到 DB（防穿透）。
    private static final String NULL = "__NULL__";

    private final Function<Long, String> loader;

    public ProductCache(Function<Long, String> loader) {
        this.loader = loader;
    }

    public String get(Long id) {
        String v = cache.getIfPresent(id);
        if (v != null) {
            return v.equals(NULL) ? null : v;        // 命中空值缓存，直接返回，不再查库
        }
        // 防击穿：同一 id 串行化「查库 + 回填」，其余线程等锁后直接命中缓存
        ReentrantLock lock = locks.computeIfAbsent(id, k -> new ReentrantLock());
        lock.lock();
        try {
            v = cache.getIfPresent(id);
            if (v != null) return v.equals(NULL) ? null : v;
            String db = loader.apply(id);            // 真正查库（同一时刻仅一个线程执行）
            if (db == null) {
                cache.put(id, NULL);                 // 空值也回填，短 TTL
            } else {
                cache.put(id, db);
            }
            return db;
        } finally {
            lock.unlock();
            locks.remove(id);
        }
    }
}
"""

WRITER = r"""package com.example.cache;

import java.util.function.Consumer;

/**
 * 写路径的一致性：采用 Cache-Aside 的「先更新库、再删缓存」，
 * 而不是「更新库 + 更新缓存」——删除而非更新能避开并发下的写顺序错乱。
 */
public class CatalogWriter {

    private final Consumer<Long> cacheEvict;     // 删缓存
    private final Consumer<Product> dbUpdate;    // 更新数据库（真相来源）

    public CatalogWriter(Consumer<Long> cacheEvict, Consumer<Product> dbUpdate) {
        this.cacheEvict = cacheEvict;
        this.dbUpdate = dbUpdate;
    }

    public void updatePrice(long id, long newPrice) {
        // 1) 先更新数据源——数据库是真相来源，缓存只是它的副本
        dbUpdate.accept(new Product(id, newPrice));
        // 2) 再删除缓存，让下一次读回填最新值；删除而非更新，避免「写库 A、写缓存 B」错序
        cacheEvict.accept(id);
    }

    public static class Product {
        public final long id;
        public final long price;
        public Product(long id, long price) { this.id = id; this.price = price; }
    }
}
"""

LAB_CACHE = r"""import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Phaser;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 模拟慢数据库：100 个并发打同一个 key。
 * 对比「每次都查 DB」与「缓存后只查 1 次」——命中率差异直接体现在 DB 命中次数上。
 */
public class Main {

    static final int N = 100;
    static String url;
    static final ConcurrentHashMap<Long, String> cache = new ConcurrentHashMap<>();
    static final AtomicInteger dbHits = new AtomicInteger();

    public static void main(String[] args) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/db", ex -> {
            dbHits.incrementAndGet();
            sleep(30);                       // 模拟慢查询
            byte[] body = "v".getBytes();
            ex.sendResponseHeaders(200, body.length);
            ex.getResponseBody().write(body);
            ex.close();
        });
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.start();
        url = "http://127.0.0.1:" + server.getAddress().getPort() + "/db";

        try {
            run("无缓存", false);
            dbHits.set(0);
            run("有缓存", true);
        } finally {
            server.stop(0);
        }
        System.out.println("java.version=" + System.getProperty("java.version"));
    }

    static void run(String label, boolean useCache) throws Exception {
        var client = HttpClient.newHttpClient();
        Phaser barrier = new Phaser(N);
        long t0 = System.nanoTime();
        int ok = 0;
        try (ExecutorService ex = Executors.newVirtualThreadPerTaskExecutor()) {
            for (int i = 0; i < N; i++) {
                ex.submit(() -> {
                    try {
                        String v = useCache
                                ? cache.computeIfAbsent(1L, k -> fetch(client))
                                : fetch(client);
                        if (v != null) ok++;
                    } finally { barrier.arrive(); }
                });
            }
            barrier.awaitAdvance(0);
        }
        long ms = (System.nanoTime() - t0) / 1_000_000;
        System.out.printf("%-10s %d 次相同查询 -> %4dms（打到 DB %d 次，命中 %d）%n",
                label, N, ms, dbHits.get(), ok);
    }

    static String fetch(HttpClient client) {
        try {
            var req = HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(10)).GET().build();
            return client.send(req, HttpResponse.BodyHandlers.ofString()).statusCode() == 200 ? "v" : null;
        } catch (Exception e) { return null; }
    }

    static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }
}
"""


TOPIC = {
    "id": "local-cache",
    "order": 4,
    "name": "本地缓存",
    "subtitle": "把热点数据放进内存：扛住读压力，但要防穿透 / 击穿 / 雪崩",
    "glyph": "▦",
    "family": "reliability",
    "runtime": "Caffeine / ConcurrentHashMap",
    "level": "基础",
    "intent": (
        "本地缓存解决的是「同一个热点数据被海量请求反复查库」：把读多写少的数据放进进程内存，"
        "命中即返回，数据库只需承接未命中的一小部分。代价是要处理「缓存与库不一致」"
        "以及三类经典失效——穿透、击穿、雪崩。"
    ),
    "pickWhen": [
        {"vs": "每次都查数据库",
         "text": "读多写少、热点集中（商品详情 / 配置 / 元数据）→ 本地缓存；写多读少或强一致要求 → 不要缓存"},
        {"vs": "分布式缓存（Redis）",
         "text": "单实例内就能兜住的热点、且能接受进程内不一致 → 本地缓存（零网络跳数）；多实例需共享或强一致 → 分布式缓存"},
        {"vs": "直接 HashMap 裸存",
         "text": "需要容量上限 / 过期 / 淘汰策略 → Caffeine 等成熟实现；裸 Map 会无界增长直至 OOM"},
    ],
    "limits": [
        "进程内缓存与数据库存在天然不一致窗口：写后短时内读到旧值，必须接受最终一致。",
        "不适合强一致场景（余额 / 库存扣减）——缓存的「快」来自牺牲即时一致。",
        "内存是有限的：必须设容量上限与淘汰策略，否则无界增长直至 OOM。",
        "多实例各自持有一份：一个实例更新后，其它实例仍是旧值，需要主动失效或短 TTL 兜底。",
    ],
    "references": [
        {"title": "Caffeine · GitHub Wiki（缓存策略与驱逐）",
         "url": "https://github.com/ben-manes/caffeine/wiki",
         "note": "expireAfterWrite / 容量上限 / 淘汰策略的官方说明"},
        {"title": "Cache-Aside Pattern · Microsoft Azure",
         "url": "https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside",
         "note": "读时回填、写时失效的标准 Cache-Aside 流程与一致性取舍"},
        {"title": "军火库规则集 · REL 类",
         "note": "外部调用必设超时（缓存正是对下游超时风险的对冲）、异常不得吞掉等强制级条目出处"},
    ],
    "scenarios": [
        {
            "id": "three-disasters",
            "order": 1,
            "name": "防穿透 / 击穿 / 雪崩",
            "when": (
                "把热点数据放进本地缓存后，仍要面对三类经典事故：查不存在的 key（穿透）、"
                "热点 key 失效瞬间（击穿）、大量 key 同时过期（雪崩）。"
                "任何一类没防住，缓存反而会把数据库打挂。"
            ),
            "signals": [
                "DB 突然出现大量「查一个根本不存在的 id」的查询（穿透）",
                "某个热点 key 过期瞬间，DB QPS 尖刺式暴涨（击穿）",
                "缓存批量重启 / TTL 集中到期时，DB 压力同步暴涨（雪崩）",
            ],
            "decision": "Cache-Aside 要在回填逻辑里同时堵住三类漏洞：空值缓存防穿透、单 key 互斥重建防击穿、TTL 抖动防雪崩。",
            "notSuitable": [
                "数据强一致、不能容忍短时旧值——缓存的快来自牺牲即时一致",
                "写入极热、缓存命中率低——缓存帮不上忙还增加复杂度",
                "单条数据极大、内存放不下——换分布式缓存或别的设计",
            ],
            "recipes": [
                {
                    "id": "safe-cache-aside",
                    "order": 1,
                    "name": "带三重防护的 Cache-Aside",
                    "approach": (
                        "读路径：先查缓存，未命中查库并回填；回填时"
                        "空值也缓存（防穿透）、同一 key 用互斥锁串行重建（防击穿）、"
                        "TTL 叠加随机抖动（防雪崩）。"
                    ),
                    "flow": [
                        {"layer": "cache", "step": "查缓存",
                         "detail": "先 getIfPresent，命中即返回（含空值命中）。"},
                        {"layer": "cache", "step": "单 key 互斥重建",
                         "detail": "未命中时按 key 加锁，仅一个线程查库回填，其余复用结果。"},
                        {"layer": "data", "step": "查库并回填",
                         "detail": "查到写真值；查不到写空值占位（短 TTL）防穿透。"},
                        {"layer": "reliability", "step": "TTL 抖动",
                         "detail": "过期时间叠加随机，避免集体失效雪崩（图中未画，属配置层）。"},
                    ],
                    "packages": [
                        "com.example.cache   ProductCache（空值缓存 + 互斥重建 + TTL）",
                    ],
                    "files": [
                        {
                            "id": "cache-aside",
                            "path": "src/main/java/com/example/cache/ProductCache.java",
                            "layer": "cache",
                            "lang": "java",
                            "role": "带三重防护的 Cache-Aside 读路径。",
                            "code": CACHE_ASIDE,
                            "highlights": [
                                {"mark": "cache.put(id, NULL);",
                                 "title": "空值也缓存（防穿透）",
                                 "text": "查不到的 key 也回填一个占位值并给短 TTL，后续相同查询直接命中返回 null，不再打到 DB——否则攻击者用不存在的 id 就能打穿缓存直击数据库。"},
                                {"mark": "ReentrantLock lock = locks.computeIfAbsent(id, k -> new ReentrantLock());",
                                 "title": "单 key 互斥重建（防击穿）",
                                 "text": "热点 key 失效的瞬间，大量请求会同时未命中。按 key 加锁让只有一个线程去查库回填，其余等锁后直接命中——否则瞬时并发全压到 DB 上形成尖刺。"},
                                {"mark": ".expireAfterWrite(5, TimeUnit.MINUTES)",
                                 "title": "基础 TTL（防雪崩要叠抖动）",
                                 "text": "这是基础过期时间。生产必须在它之上叠加随机抖动（如 5±2 分钟），否则大量 key 在同一时刻集体失效，会瞬间把 DB 打爆（雪崩）。"},
                            ],
                        },
                    ],
                    "checklist": [
                        "确认不存在的 key 也会被缓存（空值占位 + 短 TTL），防穿透。",
                        "确认热点 key 重建有互斥，单 key 同一时刻只放一个请求查库，防击穿。",
                        "确认 TTL 叠加了随机抖动，避免集体失效，防雪崩。",
                        "确认缓存有容量上限与淘汰策略，不会无界增长直至 OOM。",
                        "确认 loader 异常不被吞掉，查库失败要向上抛而不是回填假值。",
                    ],
                    "pitfalls": [
                        "只缓存查到的、不缓存查不到的：攻击者用不存在的 id 即可打穿缓存直击 DB（穿透）。",
                        "热点 key 失效瞬间无互斥：瞬时并发全部涌向 DB，形成 QPS 尖刺（击穿）。",
                        "所有 key 同一 TTL：缓存集中重启或批量到期时，DB 压力同步暴涨（雪崩）。",
                        "loader 异常被吞掉并回填 null：故障期间缓存里全是假空值，恢复后也长期返回空。",
                    ],
                    "performance": {
                        "title": "100 次相同查询（慢数据库 30ms/次）",
                        "columns": ["维度", "无缓存", "有缓存"],
                        "rows": [
                            ["打到 DB 的次数", "100", "1"],
                            ["总耗时量级", "≈ 100 × 30ms", "≈ 1 × 30ms + 内存读"],
                            ["DB 压力", "100 倍", "几乎为零"],
                            ["风险点", "DB 被打爆", "失效瞬间需防击穿"],
                        ],
                        "conclusion": "缓存把「重复读」变成「内存命中」，DB 只需承接未命中那一小部分。但命中率越高，失效瞬间越危险——所以穿透 / 击穿 / 雪崩必须同时防。页面下方实验能在你机器上把这两组数字跑出来。",
                    },
                    "relatedRules": ["REL-TIME-001", "REL-EXCP-001"],
                    "lab": {
                        "kind": "mock-endpoint",
                        "intro": "起一个 30ms 延迟的假数据库，100 个并发打同一个 key，对比「每次查 DB」与「缓存后只查 1 次」打到的 DB 次数。",
                        "observe": [
                            "无缓存组：DB 命中次数 = 100（每个请求都打到库）",
                            "有缓存组：DB 命中次数 = 1（仅首次未命中回填）",
                        ],
                    },
                    "playground": [
                        {"id": "lc-hit",
                         "label": "模拟慢库：100 次相同查询的 DB 命中数",
                         "mainClass": "Main",
                         "note": "30ms 假数据库，对比有/无缓存打到 DB 的次数。",
                         "files": [{"path": "Main.java", "code": LAB_CACHE}]},
                    ],
                },
            ],
        },
        {
            "id": "write-consistency",
            "order": 2,
            "name": "读写一致性：写时删缓存",
            "when": (
                "使用了本地缓存且数据会被更新——此时必须决定「更新库之后，缓存怎么跟」。"
                "选错策略会在并发下产生长期脏数据：用户改了价格，别人看到的还是旧价。"
            ),
            "signals": [
                "更新后短时间内，部分请求仍读到旧值且长时间不刷新",
                "多实例各自缓存，一个实例更新后其它实例读旧",
                "代码里出现「更新库 + 顺手更新缓存」的写法，且偶发脏读",
            ],
            "decision": "Cache-Aside 的写策略取「先更新库、再删缓存」：删而非更新，能避开并发下的写顺序错乱；遗留的极短不一致窗口用短 TTL 兜底。",
            "notSuitable": [
                "数据强一致、不能容忍任何旧值窗口——不应使用本地缓存",
                "写后几乎没人立即读——可以只更新库，让缓存自然过期",
                "缓存与库本就是同一份（如纯内存计算）—无需此策略",
            ],
            "recipes": [
                {
                    "id": "evict-on-write",
                    "order": 1,
                    "name": "先更新库，再删缓存",
                    "approach": (
                        "写路径先更新数据库（真相来源），再删除对应缓存条目；"
                        "下次读会回填最新值。删而非更新，避免「写库 A、写缓存 B」的并发错序。"
                    ),
                    "flow": [
                        {"layer": "data", "step": "更新数据库",
                         "detail": "先把新值落库，数据库是唯一真相来源。"},
                        {"layer": "cache", "step": "删除缓存",
                         "detail": "删掉该 key，而非写入新值；下一次读触发回填。"},
                        {"layer": "reliability", "step": "短 TTL 兜底",
                         "detail": "极端并发下的残留旧值，由缓存的短 TTL 自动过期，不必额外处理。"},
                    ],
                    "packages": [
                        "com.example.cache   CatalogWriter（先更新库、再删缓存）",
                    ],
                    "files": [
                        {
                            "id": "writer",
                            "path": "src/main/java/com/example/cache/CatalogWriter.java",
                            "layer": "cache",
                            "lang": "java",
                            "role": "写路径一致性：先更新库，再删缓存。",
                            "code": WRITER,
                            "highlights": [
                                {"mark": "dbUpdate.accept(new Product(id, newPrice));",
                                 "title": "先更新库（真相来源）",
                                 "text": "数据库是唯一真相来源，先把它改对；缓存只是副本，顺序上库在前才能保证后续回填的是新值。"},
                                {"mark": "cacheEvict.accept(id);",
                                 "title": "再删缓存，而非更新缓存",
                                 "text": "删除而非写入新值：并发下「写库 A、再写缓存 B」可能和「读 A、回填 B」交错，留下长期脏值；删除让下次读统一回填，最差只是极短旧值窗口。"},
                            ],
                        },
                    ],
                    "checklist": [
                        "确认写路径是先更新库、再删缓存，顺序不可颠倒。",
                        "确认是「删除」而非「更新」缓存，避免并发写序错乱。",
                        "确认缓存有短 TTL 兜底，极端残留旧值会自动过期。",
                        "确认多实例场景有主动失效或接受短窗口不一致，不要假设各实例自动同步。",
                        "确认删缓存失败有重试 / 告警，否则会留下长期脏值。",
                    ],
                    "pitfalls": [
                        "先删缓存再更新库：删除后、更新前的读会回填旧值，留下长期脏数据。",
                        "更新库又顺手更新缓存：并发下与读回填交错，可能写出比库更旧的值。",
                        "删缓存失败被吞掉：缓存永远不刷新，读到的永久是旧值。",
                        "以为本地缓存多实例自动一致：各实例独立持有一份，必须主动失效或靠 TTL。",
                    ],
                    "relatedRules": ["REL-TIME-001", "REL-EXCP-001"],
                },
            ],
        },
    ],
}
