# -*- coding: utf-8 -*-
"""场景 4 · 热点缓存：缓存击穿 / 穿透 / 雪崩、热点 key 分片、本地+分布式两级、一致性窗口。

用户的原始提问：「我们的接口 QPS 很高，热点数据都放缓存，但一到大促就出问题——
缓存一失效整库被打挂，或者热点 key 把单节点打爆」。

核心矛盾：缓存是为了扛读，但它自己也会成为瓶颈和故障源。
这个场景关心：击穿（单 key 过期瞬间的并发回源）、穿透（不存在的 key）、雪崩（批量过期）、
热点 key 分片、本地+分布式两级、一致性的时间窗口。
"""

DRIVERS = [
    {'id': 'qps', 'name': '并发读量', 'unit': 'QPS', 'hint': '缓存要扛的读',
     'levels': [
         {'id': 'q1k', 'label': '1 千'},
         {'id': 'q10k', 'label': '1 万'},
         {'id': 'q100k', 'label': '10 万'},
         {'id': 'q1m', 'label': '100 万'},
     ]},
    {'id': 'hotspot', 'name': '热点集中度', 'unit': '', 'hint': 'key 的分布偏斜度',
     'levels': [
         {'id': 'even', 'label': '均匀'},
         {'id': 'skew', 'label': '80/20 倾斜'},
         {'id': 'extreme', 'label': '99/1 极端'},
     ]},
    {'id': 'latency', 'name': 'P99 目标', 'unit': '', 'hint': '回源代价容忍度',
     'levels': [
         {'id': 'l50', 'label': '<50ms'},
         {'id': 'l200', 'label': '<200ms'},
         {'id': 'l1s', 'label': '<1s'},
     ]},
    {'id': 'consist', 'name': '一致性', 'unit': '', 'hint': '缓存与库的可接受偏差',
     'levels': [
         {'id': 'strong', 'label': '强一致'},
         {'id': 'bounded', 'label': '秒级窗口'},
         {'id': 'eventual', 'label': '最终一致'},
     ]},
    {'id': 'ttl', 'name': 'TTL 策略', 'unit': '', 'hint': '过期方式',
     'levels': [
         {'id': 'fixed', 'label': '固定 TTL'},
         {'id': 'jitter', 'label': '随机抖动'},
         {'id': 'none', 'label': '不过期'},
     ]},
    {'id': 'replicas', 'name': '缓存集群规模', 'unit': '节点', 'hint': '一致性协议成本',
     'levels': [
         {'id': 'r1', 'label': '单实例'},
         {'id': 'r4', 'label': '4 节点'},
         {'id': 'r32', 'label': '32 节点'},
     ]},
]

CONFLICTS = [
    {'when': {'qps': ['q1m'], 'consist': ['strong'], 'latency': ['l50']},
     'text': '百万 QPS + 强一致 + P99<50ms 三者不可兼得：强一致要求读缓存失效时回源并等库确认，'
             '百万级回源压力 + 强一致等待，P99 不可能压到 50ms。请放宽为秒级窗口（bounded）走读写分离。'},
    {'when': {'hotspot': ['extreme'], 'replicas': ['r1']},
     'text': '99/1 极端热点 + 单实例缓存：热点 key 把单节点 CPU/带宽打满，整个缓存被一个 key 拖死。'
             '必须上热点 key 分片（见切片「热点 key 分片」）或多级缓存把热点挡在本地的副本里。'},
    {'when': {'consist': ['strong'], 'ttl': ['none']},
     'text': '强一致却「不过期」：缓存永不失效意味着库更新后缓存永远是旧值，强一致彻底失效。'
             '强一致必须配合失效/更新机制，不能靠「不过期」假装一致。'},
]

NOT_SUITABLE_FOR = [
    {'when': {'qps': ['q1k'], 'hotspot': ['even']},
     'reason': '1 千 QPS + key 均匀：单实例缓存甚至不加缓存都够，击穿/穿透/雪崩/热点分片全是净成本。'
               '直接查库或简单加一层缓存即可。'},
    {'when': {'qps': ['q1k', 'q10k'], 'ttl': ['jitter'], 'consist': ['eventual']},
     'reason': '量级与一致性要求都很宽松，本场景大部分切片不会激活。'
               '真正要做的只是「给缓存加个 TTL 别让它无限增长」，不需要整套多级缓存架构。'},
]

SLICES = [
    {
        'id': 'local-cache-bounded',
        'order': 1,
        'goal': '本地 + 分布式两级缓存，且本地必须有界',
        'layer': '设计',
        'when': {'qps': ['q10k', 'q100k', 'q1m']},
        'why': 'QPS 到万级，每次请求都打远程缓存会有网络 RTT 与连接开销。'
               '在应用进程内加一层本地缓存挡住大部分读，但本地缓存必须是有界的，否则就是内存泄漏。',
        'decision': {
            'question': '两级缓存怎么搭？',
            'options': [
                '只用远程缓存（Redis） —— 简单，但每次都有网络 RTT',
                '只用本地缓存 —— 快，但多实例间不一致且容量无界风险',
                '本地（有界 Caffeine）+ 远程（Redis）两级 —— 本地挡 80% 读，远程兜底',
                '本地无限 Map —— 看起来快，实际是内存泄漏',
            ],
            'chosen': '本地 Caffeine（有界、带淘汰）+ Redis 两级，本地命中率目标 80%+',
            'tradeoff': '代价是本地与远程之间有一致性窗口（见切片「一致性窗口」）。'
                        '但 QPS 量级下，这个窗口换来的吞吐是必须的。',
        },
        'sql': r"""-- 缓存不存库，但「缓存里有没有这条」本身可以建一张轻量存在性表，
-- 用来在穿透防护里区分「真没有」和「还没加载」。这里给出热点对象的元信息表。
CREATE TABLE `cache_catalog` (
  `cache_key`   VARCHAR(191) NOT NULL COMMENT '业务 key，建议哈希后存储',
  `kind`        TINYINT      NOT NULL COMMENT '1商品 2用户 3配置',
  `version`     BIGINT       NOT NULL DEFAULT 0 COMMENT '乐观锁版本，用于失效比对',
  `updated_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`cache_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='缓存目录 · 记录 key 是否存在与版本';""",
        'code': r"""/**
 * 场景：热点缓存 / 切片：本地+分布式两级，本地必须有界
 * 适用参数：并发读 QPS ≥ 1 万
 * 依赖规则：CONC-POOL-004, REL-CTNR-005, REL-TIME-001
 * JDK：21
 */
package com.example.cache.twolevel;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import java.time.Duration;

/**
 * 两级缓存读路径。
 * 为什么本地必须走 Caffeine 而不是 ConcurrentHashMap：后者无界，热点 key 持续写入会撑爆堆；
 * Caffeine 基于 W-TinyLFU，有最大条目与权重上限，超限自动淘汰。
 */
public final class TwoLevelCache {
    /** 本地上限。无界本地缓存 = 内存泄漏。按单实例可承受的堆比例设，不是拍脑袋的 10000。 */
    private final Cache<String, byte[]> local = Caffeine.newBuilder()
            .maximumWeight(200_000_000)
            .weigher((k, v) -> k.length() + v.length)
            .expireAfterWrite(Duration.ofSeconds(30))
            .build();

    private final RemoteCache remote;

    public TwoLevelCache(RemoteCache remote) {
        this.remote = remote;
    }

    public byte[] get(String key) {
        byte[] v = local.getIfPresent(key);
        if (v != null) {
            return v; // 本地命中：零网络，挡住绝大多数读
        }
        // 本地未命中才打远程；远程超时必须设上限，否则一个慢节点拖死整条读链路。
        byte[] rv = remote.getWithTimeout(key, 50);
        if (rv != null) {
            local.put(key, rv);
        }
        return rv;
    }

    public interface RemoteCache {
        byte[] getWithTimeout(String key, int millis);
    }
}
""",
        'highlights': [
            {'mark': '.maximumWeight(200_000_000)',
             'title': '本地必须有上限',
             'text': 'ConcurrentHashMap 无界，热点 key 持续写入会撑爆堆。Caffeine 按权重/条目有界，超限自动淘汰。',
             'rule': 'CONC-POOL-004'},
            {'mark': 'byte[] rv = remote.getWithTimeout(key, 50);',
             'title': '远程调用必须超时',
             'text': '不设超时的远程读，一个慢节点会把整条读链路拖死。50ms 是 P99<200ms 下能给远程的预算。',
             'rule': 'REL-TIME-001'},
        ],
        'pitfalls': [
            '本地用 ConcurrentHashMap —— 无界，key 持续写入最终 OOM。',
            '远程读不设超时 —— 一个慢节点拖死整条链路，故障从「一个 key 慢」放大成「全站读慢」。',
            '两级都不过期 —— 库更新后双层全是旧值，一致性彻底失控。',
        ],
        'notSuitable': [
            'QPS 1 千以下：直接查库或单级缓存足够，两级架构是净复杂度。',
            '单实例且数据量极小：本地缓存的命中率收益不抵维护成本。',
        ],
        'relatedRules': ['CONC-POOL-004', 'REL-TIME-001', 'REL-CTNR-005', 'WEB-CTRL-005'],
        'refs': [
            {'title': 'Caffeine — Window TinyLFU', 'url': 'https://github.com/ben-manes/caffeine'},
            {'title': 'Facebook — TAO：社交图谱缓存的两级设计', 'note': '本地缓存挡读 + 远程做真相源'},
        ],
    },
    {
        'id': 'two-level-invalidation',
        'order': 2,
        'goal': '两级缓存的一致性失效',
        'layer': '设计',
        'when': {'replicas': ['r4', 'r32'], 'consist': ['strong', 'bounded']},
        'why': '多级缓存最大的坑是「更新了一个层级，另一个层级还是旧值」。'
               '集群规模越大、一致性要求越高，失效越不能靠「各自过期」，必须主动失效。',
        'decision': {
            'question': '更新后怎么让各层失效？',
            'options': [
                '只更新库，等缓存自己过期 —— 简单，但窗口期内读到旧值',
                '更新库后删远程缓存，本地靠 TTL 自然失效 —— 折中，窗口短',
                '发广播让所有实例删本地 + 删远程 —— 强一致，但广播本身要可靠',
                '写库后双删（延迟再删一次） —— 防并发读回填旧值',
            ],
            'chosen': '更新库 → 删远程 → 发失效广播清各实例本地 → 双删兜底',
            'tradeoff': '代价是写路径多一次广播，且广播失败要有降级（回退到 TTL）。'
                        '强一致下这个代价必须付。',
        },
        'sql': r"""-- 失效广播的「已处理序号」：防止同一条失效消息被同一实例处理两次（重复删无害，但可省）。
CREATE TABLE `cache_invalidate_log` (
  `msg_id`      VARCHAR(64)  NOT NULL COMMENT '失效消息唯一 id（如 uuid）',
  `node`        VARCHAR(64)  NOT NULL COMMENT '处理节点',
  `handled_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`msg_id`, `node`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='失效消息去重 · 每节点每条仅处理一次';""",
        'code': r"""/**
 * 场景：热点缓存 / 切片：两级缓存一致性失效
 * 适用参数：集群规模 ≥ 4 节点 且 一致性 = 强一致/秒级窗口
 * 依赖规则：SVC-TX-002, REL-EXCP-003, DATA-SQL-001
 * JDK：21
 */
package com.example.cache.invalidate;

import java.util.Set;

/**
 * 缓存失效广播的接收方。
 * 为什么用「删」而不是「改」：更新时库里的数据可能还在事务里没提交，
 * 直接把旧值推给各实例反而制造更长的旧值窗口。删掉让它们重新回源读最新。
 */
public final class InvalidationReceiver {
    private final LocalCache local;
    private final InvalidateLogDao logDao;

    public InvalidationReceiver(LocalCache local, InvalidateLogDao logDao) {
        this.local = local;
        this.logDao = logDao;
    }

    /** 收到失效消息：先按 (msgId, node) 去重，避免重复处理。 */
    public void onInvalidate(String msgId, String node, Set<String> keys) {
        // finally 里绝不 return：会吞掉调用方的异常语义，掩盖真正的失效失败。
        try {
            if (logDao.markHandled(msgId, node) == 0) {
                return; // 已处理过，幂等跳过
            }
            for (String k : keys) {
                local.invalidate(k);
            }
        } finally {
            // 只做清理，不在这里 return
        }
    }

    public interface LocalCache {
        void invalidate(String key);
    }

    public interface InvalidateLogDao {
        /** INSERT IGNORE，命中主键返回 0 表示已处理。 */
        int markHandled(String msgId, String node);
    }
}
""",
        'highlights': [
            {'mark': 'if (logDao.markHandled(msgId, node) == 0) {',
             'title': '按 (msgId,node) 幂等',
             'text': '同一失效消息可能被投递多次，用 INSERT IGNORE 去重，保证每个节点每条只处理一次。',
             'rule': 'DATA-SQL-001'},
            {'mark': '} finally {',
             'title': 'finally 不 return',
             'text': 'finally 里的 return 会吞掉 try 块的真实异常，掩盖失效失败，让旧值一直留在本地。',
             'rule': 'REL-EXCP-003'},
        ],
        'pitfalls': [
            '用「改」而不是「删」推送新值 —— 事务未提交时把旧值推下去，旧值窗口更长。',
            'finally 里 return —— 吞掉真实异常，失效失败被静默，本地一直旧值。',
            '广播失败没有降级 —— 集群里总有节点收不到，回退 TTL 是必须的兜底。',
        ],
        'notSuitable': [
            '单实例：没有「多实例本地不一致」问题，删远程即可。',
            '最终一致且 TTL 很短：靠过期就行，主动失效是过度设计。',
        ],
        'relatedRules': ['SVC-TX-002', 'REL-EXCP-003', 'DATA-SQL-001', 'REL-EXCP-001'],
        'refs': [
            {'title': 'Redis — Cache Invalidation Patterns',
             'url': 'https://redis.io/docs/latest/develop/use/patterns/'},
            {'title': '《Designing Data-Intensive Applications》— Cache Inconsistency',
             'note': '写后失效 vs 写后更新，及双删策略'},
        ],
    },
    {
        'id': 'stampede-singleflight',
        'order': 3,
        'goal': '缓存击穿：单 key 过期瞬间的并发回源（singleflight）',
        'layer': '并发',
        'when': {'hotspot': ['skew', 'extreme'], 'qps': ['q10k', 'q100k']},
        'why': '热点 key 在同一秒过期，会有成千上万个请求同时发现「缓存没了」，一起回源打库 —— '
               '这就是击穿。库瞬间被这波并发打死，比正常流量高几个数量级。',
        'decision': {
            'question': '击穿怎么防？',
            'options': [
                '不防 —— 过期瞬间所有请求一起回源，库被打挂',
                'singleflight（合并回源） —— 同一 key 同一时刻只放一个请求回源，其余等待',
                '热点 key 不过期 + 后台刷新 —— 读永远不空，但写要主动更新',
                '互斥锁回源 —— 一个拿锁回源，其余阻塞',
            ],
            'chosen': 'singleflight 合并回源 + 热点 key 永不过期走后台刷新',
            'tradeoff': '代价是回源的那个请求变慢（它要等库），但只慢一个，其余拿它的结果。'
                        'singleflight 的等待要有超时，否则回源挂了会把所有等待者一起拖死。',
        },
        'sql': r"""-- 后台刷新需要记录每个热点 key 的「下次刷新时间」，由定时任务在过期前主动回源。
CREATE TABLE `cache_refresh_task` (
  `cache_key`     VARCHAR(191) NOT NULL,
  `refresh_at`    DATETIME(3)  NOT NULL COMMENT '应在此刻前完成刷新',
  `status`        TINYINT      NOT NULL DEFAULT 0 COMMENT '0待刷 1刷新中 2完成',
  `version`       BIGINT       NOT NULL DEFAULT 0,
  PRIMARY KEY (`cache_key`),
  KEY `idx_refresh` (`refresh_at`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='热点 key 后台刷新调度';""",
        'code': r"""/**
 * 场景：热点缓存 / 切片：击穿防护 singleflight
 * 适用参数：热点集中度 倾斜/极端 且 并发读 ≥ 1 万
 * 依赖规则：CONC-LOCK-002, REL-TIME-001, REL-EXCP-002
 * JDK：21
 */
package com.example.cache.stampede;

import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

/**
 * 单 key 回源合并（singleflight）。
 * 为什么不直接用 synchronized：synchronized 会锁住整个方法，不同 key 也互斥；
 * 这里按 key 维度合并，只有「同一个 key 的并发回源」被合并，其他 key 不受影响。
 */
public final class SingleflightLoader {
    /** 按 key 维护一个进行中的回源 future，其余请求复用它而不是各自回源。 */
    private final ConcurrentHashMap<String, CompletableFuture<byte[]>> inflight = new ConcurrentHashMap<>();

    private final Backend backend;

    public SingleflightLoader(Backend backend) {
        this.backend = backend;
    }

    public byte[] load(String key) throws Exception {
        // computeIfAbsent：同一 key 只有一个 future 被创建，其余拿到同一个。这就是合并回源。
        CompletableFuture<byte[]> f = inflight.computeIfAbsent(key, k ->
                CompletableFuture.supplyAsync(() -> backend.fetch(k)));
        try {
            // 回源必须有超时：回源挂了不能让所有等待者无限等。
            return f.get(200, TimeUnit.MILLISECONDS);
        } finally {
            inflight.remove(key, f);
        }
    }

    public interface Backend {
        byte[] fetch(String key);
    }
}
""",
        'highlights': [
            {'mark': 'inflight.computeIfAbsent(key, k ->',
             'title': '按 key 合并回源',
             'text': '同一 key 只有一个 future 被创建，其余复用结果。不同 key 互不影响，避免 synchronized 的全局互斥。',
             'rule': 'CONC-LOCK-002'},
            {'mark': 'return f.get(200, TimeUnit.MILLISECONDS);',
             'title': '回源必须超时',
             'text': '回源挂了不能让所有等待者无限等。200ms 是回源能给的预算，超时就走降级而不是堆积。',
             'rule': 'REL-TIME-001'},
        ],
        'pitfalls': [
            '用 synchronized 包住整个 load —— 不同 key 也互斥，吞吐被锁死。',
            '回源不超时 —— 回源慢时所有等待者一起堆积，击穿防护反而制造新的拥塞。',
            '只在过期瞬间才合并，平时不合并 —— 高频热点 key 每次过期都来一波，防护要常驻。',
        ],
        'notSuitable': [
            'key 分布均匀且 QPS 低：过期瞬间回源压力小，不需要 singleflight。',
            '数据基本不变：直接永不过期更简单。',
        ],
        'relatedRules': ['CONC-LOCK-002', 'REL-TIME-001', 'REL-EXCP-002', 'CONC-LOCK-001'],
        'refs': [
            {'title': 'Google — Singleflight 模式（Go sync/singleflight）',
             'url': 'https://pkg.go.dev/golang.org/x/sync/singleflight'},
            {'title': '微软 — Cache Stampede / Thundering Herd',
             'note': '单 key 过期瞬间的并发回源是典型雪崩前兆'},
        ],
    },
    {
        'id': 'penetration-bloom',
        'order': 4,
        'goal': '缓存穿透：不存在的 key 打穿缓存',
        'layer': '设计',
        'when': {'qps': ['q100k', 'q1m']},
        'why': '穿透和击穿不同：击穿是「有这个 key 但过期了」，穿透是「根本没有这个 key」。'
               '攻击者或脏数据用大量不存在的 id 查询，缓存永远不命中，请求全打到库上。',
        'decision': {
            'question': '穿透怎么防？',
            'options': [
                '不防 —— 不存在的 key 每次都回源，库被打挂',
                '缓存空值（null）并设短 TTL —— 简单，但空值也占内存',
                '布隆过滤器拦截不存在的 key —— 内存极小，误判率可控',
                '接口层校验 id 格式 —— 挡住明显非法的，但挡不住合法但不存在的',
            ],
            'chosen': '布隆过滤器挡掉绝大多数不存在的 key + 空值缓存兜底',
            'tradeoff': '代价是布隆过滤器要随数据更新（误删的 key 要从过滤器移除，否则误判），'
                        '且有误判率（极小概率把存在的 key 判成不存在，需回源验证）。',
        },
        'sql': r"""-- 空值缓存表：对「确认不存在」的 key 也写一条带短 TTL 的记录，避免反复回源。
-- 注意 TTL 要短（如 60s），否则数据刚插入就被空值挡住读不到。
CREATE TABLE `cache_null_marker` (
  `cache_key`   VARCHAR(191) NOT NULL,
  `expire_at`   DATETIME(3)  NOT NULL COMMENT '短 TTL，到点自动失效允许重新回源',
  PRIMARY KEY (`cache_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='空值标记 · 防穿透兜底';""",
        'code': r"""/**
 * 场景：热点缓存 / 切片：穿透防护（布隆过滤器 + 空值缓存）
 * 适用参数：并发读 QPS ≥ 10 万
 * 依赖规则：SEC-INPUT-001, DATA-SQL-002, REL-EXCP-002
 * JDK：21
 */
package com.example.cache.penetration;

import java.util.BitSet;

/**
 * 布隆过滤器拦截不存在的 key。
 * 为什么用布隆而不是把全量 key 放 Set：全量 key 可能是十亿级，Set 内存爆炸；
 * 布隆用位数组，内存是 key 数的几倍比特，且有可控误判率。
 */
public final class BloomGuard {
    private final BitSet bits;
    private final int numHashes;

    public BloomGuard(int bitsSize, int numHashes) {
        this.bits = new BitSet(bitsSize);
        this.numHashes = numHashes;
    }

    /** 可能存在才放过去回源；返回 false 直接挡掉，绝不打库。 */
    public boolean mightExist(String key) {
        for (int i = 0; i < numHashes; i++) {
            // 多个独立哈希位，任一位为 0 即确定不存在
            if (!bits.get(hash(key, i) % bits.size())) {
                return false;
            }
        }
        return true;
    }

    /** 写入时把 key 的各位点亮。删除要用计数布隆，标准布隆不支持安全删除。 */
    public void add(String key) {
        for (int i = 0; i < numHashes; i++) {
            bits.set(hash(key, i) % bits.size());
        }
    }

    private int hash(String key, int salt) {
        return (key.hashCode() ^ (salt * 0x9e3779b1)) & Integer.MAX_VALUE;
    }
}
""",
        'highlights': [
            {'mark': 'if (!bits.get(hash(key, i) % bits.size())) {',
             'title': '任一位为 0 即不存在',
             'text': '布隆过滤器的核心：不存在的 key 一定有位为 0；存在的 key 可能全为 1（有误判）。挡穿透靠的是前者。',
             'rule': 'SEC-INPUT-001'},
            {'mark': 'public boolean mightExist(String key) {',
             'title': '返回「可能存在」而非「存在」',
             'text': '布隆有 False Positive，所以方法名必须诚实。误判的 key 会多一次回源，但概率极低，远好过被打穿。',
             'rule': 'REL-EXCP-002'},
        ],
        'pitfalls': [
            '把全量 key 放 HashSet 做拦截 —— 十亿 key 内存爆炸，布隆的存在意义就在这里。',
            '只缓存空值不设短 TTL —— 数据刚插入就被空值挡住，读不到新数据。',
            '误删 key 不更新布隆 —— 标准布隆不支持安全删除，需用计数布隆或重建。',
        ],
        'notSuitable': [
            'QPS 低且 key 空间小：空值缓存就够，布隆是额外复杂度。',
            'key 几乎都存在（无穿透风险）：布隆没有收益。',
        ],
        'relatedRules': ['SEC-INPUT-001', 'DATA-SQL-002', 'REL-EXCP-002', 'REL-EXCP-001'],
        'refs': [
            {'title': 'Bloom Filter — 原理与误判率', 'url': 'https://en.wikipedia.org/wiki/Bloom_filter'},
            {'title': 'Redis — Bloom / Cuckoo Filter 模块', 'url': 'https://redis.io/docs/latest/develop/data-types/probabilistic/'},
        ],
    },
    {
        'id': 'write-invalidate-order',
        'order': 5,
        'goal': '缓存与库的写顺序（先写库还是先删缓存）',
        'layer': '设计',
        'when': {'consist': ['strong', 'bounded'], 'replicas': ['r1', 'r4', 'r32']},
        'why': '更新数据时，缓存和库之间必须有一个顺序，否则会出现「读到更新前的旧值」或「读到更新后的新值又变回旧值」。'
               '强一致/秒级窗口下这个顺序尤其重要。',
        'decision': {
            'question': '更新时先动谁？',
            'options': [
                '先删缓存再写库 —— 并发下可能把旧值又填回缓存',
                '先写库再删缓存（Cache-Aside） —— 推荐，删除失败概率低于写入失败',
                '先写库再更新缓存 —— 并发写可能把旧值覆盖新值',
                '写库后双删（延迟再删一次） —— 防并发读回填旧值',
            ],
            'chosen': 'Cache-Aside：先写库，再删缓存；高并发下加一次延迟双删',
            'tradeoff': '代价是极端并发下仍有一个微小窗口会读到旧值（概率极低），且删除缓存要可靠。'
                        '双删把窗口进一步压缩。',
        },
        'sql': r"""-- 写路径的「双删」需要一个延迟任务表：写库后延迟 N 秒再删一次缓存。
CREATE TABLE `cache_delete_delay` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `cache_key`   VARCHAR(191) NOT NULL,
  `run_at`      DATETIME(3)  NOT NULL COMMENT '延迟到此刻再删',
  `done`        TINYINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_run` (`run_at`, `done`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='延迟双删调度';""",
        'code': r"""/**
 * 场景：热点缓存 / 切片：写路径的缓存顺序（Cache-Aside + 双删）
 * 适用参数：一致性 = 强一致/秒级窗口
 * 依赖规则：SVC-TX-001, SVC-TX-002, REL-EXCP-001
 * JDK：21
 */
package com.example.cache.writeorder;

/**
 * 写路径缓存顺序。
 * 为什么先写库再删缓存（而不是先删再写）：先删缓存后写库，并发读可能在写库完成前
 * 回源把旧值又填回缓存；先写库再删缓存，最坏只是「删失败→旧值短暂存在」，删除比写入更不易失败。
 */
public final class CacheAsideWriter {
    private final Repository repo;
    private final RemoteCache cache;
    private final DelayDeleteDao delayDao;

    public CacheAsideWriter(Repository repo, RemoteCache cache, DelayDeleteDao delayDao) {
        this.repo = repo;
        this.cache = cache;
        this.delayDao = delayDao;
    }

    /** 必须在事务内：写库与登记延迟删要么都成功，要么都回滚。 */
    @Transactional(rollbackFor = Exception.class)
    public void update(long id, String value) {
        repo.update(id, value);
        cache.delete(keyOf(id));
        // 双删：延迟再删一次，吃掉「写库后、首次删除前」那个并发读回填的旧值窗口。
        delayDao.scheduleDelete(keyOf(id), 500);
    }

    private String keyOf(long id) {
        return "obj:" + id;
    }

    public interface Repository {
        void update(long id, String value);
    }

    public interface RemoteCache {
        void delete(String key);
    }

    public interface DelayDeleteDao {
        void scheduleDelete(String key, int delayMillis);
    }
}
""",
        'highlights': [
            {'mark': '@Transactional(rollbackFor = Exception.class)',
             'title': '写库与登记双删同事务',
             'text': '写库成功但延迟删没登记，就少一次删除，旧值窗口变长。两者必须同事务，要么都成要么都回滚。',
             'rule': 'SVC-TX-002'},
            {'mark': 'delayDao.scheduleDelete(keyOf(id), 500);',
             'title': '延迟双删',
             'text': '吃掉「写库后、首次删除前」那个并发读回填旧值的窗口。500ms 远大于一次读回源耗时。',
             'rule': 'SVC-TX-001'},
        ],
        'pitfalls': [
            '先删缓存再写库 —— 并发读在写库前回源填回旧值，更新「消失」。',
            '事务只包写库不包双删登记 —— 写成功但没登记延迟删，旧值窗口变长。',
            '@Transactional 不设 rollbackFor —— 默认只回滚 RuntimeException，检查异常会漏回滚。',
        ],
        'notSuitable': [
            '最终一致且 TTL 短：等到过期即可，不必纠结写顺序。',
            '只读数据：没有写路径，顺序问题不存在。',
        ],
        'relatedRules': ['SVC-TX-001', 'SVC-TX-002', 'REL-EXCP-001', 'SVC-LAYR-001'],
        'refs': [
            {'title': 'Cache-Aside / Cache-Through 模式',
             'url': 'https://learn.microsoft.com/en-us/azure/architecture/patterns/cache-aside'},
            {'title': '「先删缓存还是先更新库」经典讨论', 'note': '延迟双删是对并发回填旧值的工程补偿'},
        ],
    },
    {
        'id': 'extreme-hotkey-split',
        'order': 6,
        'goal': '热点 key 分片（把单 key 的流量打散）',
        'layer': '设计',
        'when': {'hotspot': ['extreme'], 'qps': ['q100k', 'q1m']},
        'why': '99/1 极端热点下，某个 key 可能占全部流量的 90%。'
               '即使有缓存，这个 key 也会把单缓存节点/单分片的 CPU、带宽、连接打满，整个缓存被一个 key 拖死。',
        'decision': {
            'question': '极端热点怎么打散？',
            'options': [
                '单 key 单副本 —— 热点 key 把单节点打爆',
                'key 分片（热点 key 复制成 N 份） —— 读随机打其中一份，流量均摊',
                '本地缓存挡热点 —— 让请求根本不打远程',
                '限流单个 key —— 保住其他 key，但热点自身被限',
            ],
            'chosen': '热点 key 复制成 N 份（逻辑 key → key#0..N-1）+ 本地缓存兜底',
            'tradeoff': '代价是写入时要更新 N 份（或写入走失效让 N 份各自回源），且 N 份之间短暂不一致。'
                        '但极端热点下，这点不一致换来了「缓存不被一个 key 打死」。',
        },
        'sql': r"""-- 热点登记表：记录哪些 key 被标记为热点，以及分片数 N。
-- 由监控自动识别（访问频次超阈值）后写入，读写路径据此决定分片数。
CREATE TABLE `hot_key_registry` (
  `base_key`    VARCHAR(191) NOT NULL COMMENT '逻辑 key（未分片前）',
  `shards`      TINYINT      NOT NULL DEFAULT 1 COMMENT '1=不分片；>1=复制成 N 份',
  `detected_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`base_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='热点 key 注册 · 驱动分片';""",
        'code': r"""/**
 * 场景：热点缓存 / 切片：极端热点 key 分片
 * 适用参数：热点集中度 = 极端 且 并发读 ≥ 10 万
 * 依赖规则：CONC-POOL-003, REL-CTNR-005, REL-EXCP-002
 * JDK：21
 */
package com.example.cache.hotkey;

import java.util.concurrent.ThreadLocalRandom;

/**
 * 热点 key 分片读。
 * 为什么把单 key 复制成 N 份：单 key 的物理副本只有一个，所有读打到同一节点同一连接。
 * 复制成 N 份后，读随机选一份，流量被均摊到 N 个副本，单节点不再被一个 key 打死。
 */
public final class HotKeySplitter {
    private final HotKeyRegistry registry;
    private final RemoteCache cache;

    public HotKeySplitter(HotKeyRegistry registry, RemoteCache cache) {
        this.registry = registry;
        this.cache = cache;
    }

    public byte[] get(String baseKey) {
        int shards = registry.shardsOf(baseKey); // 1 表示普通 key
        if (shards <= 1) {
            return cache.get(baseKey);
        }
        // 读随机打其中一份，把单 key 流量均摊到 N 个物理副本
        int idx = ThreadLocalRandom.current().nextInt(shards);
        return cache.get(baseKey + "#" + idx);
    }

    public interface HotKeyRegistry {
        int shardsOf(String baseKey);
    }

    public interface RemoteCache {
        byte[] get(String key);
    }
}
""",
        'highlights': [
            {'mark': 'int shards = registry.shardsOf(baseKey);',
             'title': '按注册表决定分片数',
             'text': '普通 key 不分片；被监控标记为热点的 key 才有 N 份。分片数是数据驱动的，不是写死的。',
             'rule': 'CONC-POOL-003'},
            {'mark': 'int idx = ThreadLocalRandom.current().nextInt(shards);',
             'title': '读随机打一份',
             'text': '流量被均摊到 N 个物理副本，单节点不再被一个 key 的流量打满。随机比轮询更不易共振。',
             'rule': 'REL-CTNR-005'},
        ],
        'pitfalls': [
            '热点 key 只放单副本 —— 90% 流量打一个节点，整缓存被一个 key 拖死。',
            '分片但写入只更新一份 —— 读到的其他份永远是旧值，不一致窗口被放大。',
            '分片数写死成常数 —— 热点强度在变，分片数应由监控动态调整。',
        ],
        'notSuitable': [
            'key 分布均匀：没有单点热点，分片纯属浪费。',
            'QPS 低：单副本扛得住，不需要打散。',
        ],
        'relatedRules': ['CONC-POOL-003', 'REL-CTNR-005', 'REL-EXCP-002', 'REL-EXCP-001'],
        'refs': [
            {'title': '阿里 — 热点 key 打散（Key 分片）实践',
             'note': '将热点 key 复制多份均摊读流量'},
            {'title': 'Twitter — 处理热点 Tweet 的缓存策略', 'note': '本地缓存 + 多副本分散单点压力'},
        ],
    },
    {
        'id': 'avalanche-ttl',
        'order': 7,
        'goal': '缓存雪崩：批量过期的防护',
        'layer': '设计',
        'when': {'ttl': ['fixed', 'none']},
        'why': '雪崩和击穿不同：击穿是单个 key，雪崩是「一大批 key 在同一时刻同时过期」，'
               '瞬间全部回源把库打挂。最常见的成因是所有 key 用同一个固定 TTL。',
        'decision': {
            'question': '雪崩怎么防？',
            'options': [
                '所有 key 同一固定 TTL —— 到点一起过期，库被集火',
                'TTL 加随机抖动 —— 过期时间打散，不会同一刻集体失效',
                '永不过期 + 后台刷新 —— 读永远有值，但写要主动维护',
                '限流 + 熔断回源 —— 即使集体过期，回源也被限住',
            ],
            'chosen': 'TTL 随机抖动（基础值 ± 随机百分比）+ 回源限流熔断',
            'tradeoff': '代价是缓存有效时间有长有短，统计口径略不整齐。'
                        '但比起「集体过期打挂库」，这点不齐完全可接受。',
        },
        'sql': r"""-- 雪崩后的恢复：如果库确实被集火，需要一条「熔断期间返回旧值」的记录表。
-- 用它记录最后一次成功回源的时间，熔断时返回该时间戳之前的旧快照。
CREATE TABLE `cache_snapshot` (
  `cache_key`   VARCHAR(191) NOT NULL,
  `payload`     MEDIUMBLOB   NOT NULL COMMENT '最后一次成功回源的快照',
  `saved_at`    DATETIME(3)  NOT NULL,
  PRIMARY KEY (`cache_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='熔断兜底快照';""",
        'code': r"""/**
 * 场景：热点缓存 / 切片：雪崩防护（TTL 抖动 + 回源限流）
 * 适用参数：TTL 策略 = 固定 TTL 或不过期（不过期也要后台刷新，否则是另一种雪崩）
 * 依赖规则：CONC-POOL-003, REL-TIME-001, REL-EXCP-002
 * JDK：21
 */
package com.example.cache.avalanche;

import java.util.concurrent.Semaphore;
import java.util.concurrent.ThreadLocalRandom;

/**
 * 雪崩防护的写侧：TTL 抖动。
 * 为什么加随机抖动：如果所有 key 的 TTL 都是 300s，它们会在同一秒集体过期，
 * 瞬间回源打挂库。抖动把过期时间打散成 [base*0.8, base*1.2] 的一个带，错峰失效。
 */
public final class TtlJitter {
    private final long baseTtlMs;

    public TtlJitter(long baseTtlMs) {
        this.baseTtlMs = baseTtlMs;
    }

    /** 计算带抖动的 TTL，避免集体过期。返回 [base*0.8, base*1.2) 之间的随机值。 */
    public long jitterTtl() {
        double factor = 0.8 + ThreadLocalRandom.current().nextDouble() * 0.4;
        return (long) (baseTtlMs * factor);
    }

    /**
     * 回源限流：即使集体过期，同时回源的并发也被信号量卡住，保护库。
     * 超出部分走降级（返回旧快照），而不是放任全部打库。
     */
    public static class SourceLimiter {
        private final Semaphore permits;

        public SourceLimiter(int maxConcurrent) {
            // 信号量命名明确，便于排查「为什么回源被限」。
            this.permits = new Semaphore(maxConcurrent, true);
        }

        public boolean tryRefresh() {
            return permits.tryAcquire();
        }

        public void finish() {
            permits.release();
        }
    }
}
""",
        'highlights': [
            {'mark': 'double factor = 0.8 + ThreadLocalRandom.current().nextDouble() * 0.4;',
             'title': 'TTL ±20% 抖动',
             'text': '把过期时间打散成一条带而非一个时刻，错峰失效。集体过期瞬间打库的事故就来自「同一 TTL」。',
             'rule': 'REL-EXCP-002'},
            {'mark': 'this.permits = new Semaphore(maxConcurrent, true);',
             'title': '回源限流保护库',
             'text': '即使集体过期，同时回源的并发也被信号量卡住；超出的走降级而非放任打库。第二个参数 true = 公平，避免饿死。',
             'rule': 'CONC-POOL-003'},
        ],
        'pitfalls': [
            '所有 key 同一固定 TTL —— 到点集体过期，库被集火，典型雪崩。',
            '不过期却不后台刷新 —— 库更新后缓存永远是旧值，且重启后集体冷启动也是另一种雪崩。',
            '回源无限流 —— 集体过期时全部请求一起打库，限流是最后一道保险。',
        ],
        'notSuitable': [
            'key 量极小且 TTL 各异：本来就不会集体过期，不需要专门抖动。',
            '纯静态配置（几乎不变）：永不过期 + 变更时主动刷新即可。',
        ],
        'relatedRules': ['CONC-POOL-003', 'REL-TIME-001', 'REL-EXCP-002', 'REL-EXCP-001'],
        'refs': [
            {'title': '缓存雪崩 / 穿透 / 击穿 三件套', 'note': '雪崩=批量过期，击穿=单key过期瞬间，穿透=不存在的key'},
            {'title': 'RESILIENCE4J — 限流与熔断', 'url': 'https://resilience4j.readme.io/'},
        ],
    },
    {
        'id': 'monitor-degrade',
        'order': 8,
        'goal': '缓存可观测与降级兜底（覆盖真实缺口：监控与降级）',
        'layer': '运维',
        'when': {},
        'why': '缓存是「加速层」不是「真相源」，它一定会出问题（节点宕机、网络分区、集体过期）。'
               '没有可观测和降级，缓存一挂，故障表现是「库被打挂」而不是「缓存没加速」，极难定位。',
        'decision': {
            'question': '缓存挂了怎么办？',
            'options': [
                '缓存挂了就全打库 —— 库被缓存的流量打死',
                '熔断：缓存异常率超阈值就走降级（返回旧值/限流/直连限流后的库',
                '只监控不降级 —— 看得见但救不了',
                '缓存挂了直接报错 —— 用户全部失败',
            ],
            'chosen': '监控命中率/延迟/异常率三项 + 熔断后降级（返回快照或受限直连）',
            'tradeoff': '代价是要维护降级逻辑和快照，且降级返回的数据可能是旧的。'
                        '但「慢一点/旧一点」远好于「全站挂掉」。',
        },
        'sql': r"""-- 降级快照表：熔断期间返回最后一次成功的旧值，而不是打库。
CREATE TABLE `cache_fallback` (
  `cache_key`   VARCHAR(191) NOT NULL,
  `payload`     MEDIUMBLOB   NOT NULL,
  `saved_at`    DATETIME(3)  NOT NULL,
  PRIMARY KEY (`cache_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='降级快照 · 熔断时返回';""",
        'code': r"""/**
 * 场景：热点缓存 / 切片：可观测与降级兜底
 * 适用参数：恒真 —— 缓存一定会出故障
 * 依赖规则：REL-LOG-002, REL-CTNR-007, REL-EXCP-001
 * JDK：21
 */
package com.example.cache.guard;

import java.util.concurrent.atomic.AtomicLong;

/**
 * 缓存健康探针。
 * 为什么健康探针只反映缓存自身可用性：如果把库的健康也算进来，
 * 库一抖缓存就被误判为不健康，触发不必要的降级（见 REL-CTNR-007 同源原则）。
 */
public final class CacheHealth {
    private final AtomicLong hits = new AtomicLong();
    private final AtomicLong misses = new AtomicLong();
    private final AtomicLong errors = new AtomicLong();

    public void recordHit() {
        hits.incrementAndGet();
    }

    public void recordMiss() {
        misses.incrementAndGet();
    }

    public void recordError() {
        errors.incrementAndGet();
    }

    /** 命中率。熔断决策依据它，而不是凭感觉。返回 0~1。 */
    public double hitRate() {
        long h = hits.get();
        long m = misses.get();
        long total = h + m;
        return total == 0 ? 1.0 : (double) h / total;
    }

    /** 是否该熔断：异常率超阈值且有一定样本量，避免冷启动误判。 */
    public boolean shouldOpenCircuit(long thresholdErrors) {
        return errors.get() >= thresholdErrors && errors.get() > (hits.get() + misses.get()) * 0.1;
    }
}
""",
        'highlights': [
            {'mark': 'public double hitRate() {',
             'title': '命中率是熔断依据',
             'text': '降级靠数据驱动。命中率骤降 + 异常率抬升才是缓存真出问题的信号，而不是拍脑袋。',
             'rule': 'REL-LOG-002'},
            {'mark': 'errors.get() > (hits.get() + misses.get()) * 0.1',
             'title': '异常率阈值 + 样本量',
             'text': '冷启动样本少时异常率会虚高，必须乘基数做比例判断，否则一启动就误熔断。',
             'rule': 'REL-CTNR-007'},
        ],
        'pitfalls': [
            '缓存挂了直接全打库 —— 缓存本来就在扛大部分读，全打库等于主动制造雪崩。',
            '健康探针把库健康算进来 —— 库一抖缓存被误判不健康，触发不必要降级。',
            '只监控不降级 —— 看得见故障但救不了，监控沦为摆设。',
        ],
        'notSuitable': [
            '缓存只是锦上添花（无缓存也能正常服务）：降级逻辑可省。',
            '数据绝对不能旧（如余额）：降级返回快照不适用，需直连限流后的库。',
        ],
        'relatedRules': ['REL-LOG-002', 'REL-CTNR-007', 'REL-EXCP-001', 'REL-EXCP-003'],
        'refs': [
            {'title': 'Kubernetes — 探针只反映自身可用性',
             'url': 'https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/'},
            {'title': 'RESILIENCE4J — Circuit Breaker', 'url': 'https://resilience4j.readme.io/docs/circuitbreaker'},
        ],
    },
]

CASE = {
    'id': 'hotspot-cache',
    'order': 4,
    'name': '热点缓存：击穿 / 穿透 / 雪崩、热点 key 分片、两级缓存',
    'subtitle': '缓存自己也会成为故障源，挡读的同时要防它被打挂',
    'glyph': '◈',
    'domain': ['电商', '社交', '内容', '大促'],
    'problem': '高并发读下，缓存一失效整库被打挂；热点 key 把单节点打爆；'
               '不存在的 key 打穿缓存；一批 key 同时过期引发雪崩。',
    'symptoms': [
        {'id': 'y1', 'text': "大促开始缓存一过期的瞬间，数据库 CPU 直接 100%", 'params': {'hotspot': 'extreme', 'qps': 'q100k'}},
        {'id': 'y2', 'text': "某个热点商品把单个缓存节点带宽打满", 'params': {'hotspot': 'extreme', 'qps': 'q100k'}},
        {'id': 'y3', 'text': "大量非法 id 请求把数据库连接池耗光", 'params': {'qps': 'q1m'}},
        {'id': 'y4', 'text': "缓存节点宕机后，流量直接把库冲垮", 'params': {'replicas': 'r32', 'consist': 'strong'}},
    ],
    'recommended': {
        'qps': 'q100k', 'hotspot': 'extreme', 'latency': 'l50',
        'consist': 'strong', 'ttl': 'fixed', 'replicas': 'r4',
    },
    'drivers': DRIVERS,
    'conflicts': CONFLICTS,
    'slices': SLICES,
    'notSuitableFor': NOT_SUITABLE_FOR,
    'architecture': {
        'nodes': [
            {'id': 'app', 'label': '应用', 'kind': 'backend', 'tier': 0},
            {'id': 'local', 'label': '本地缓存', 'kind': 'database', 'tier': 1,
             'whenAny': {'qps': ['q10k', 'q100k', 'q1m']}},
            {'id': 'dist', 'label': '分布式缓存', 'kind': 'database', 'tier': 1},
            {'id': 'bloom', 'label': '布隆过滤器', 'kind': 'database', 'tier': 1,
             'whenAny': {'qps': ['q100k', 'q1m']}},
            {'id': 'db', 'label': '数据库', 'kind': 'database', 'tier': 2},
            {'id': 'scheduler', 'label': '失效/刷新调度', 'kind': 'messagebus', 'tier': 3,
             'whenAny': {'consist': ['strong', 'bounded']}},
        ],
        'links': [
            {'from': 'app', 'to': 'local', 'label': '读'},
            {'from': 'app', 'to': 'dist', 'label': '读'},
            {'from': 'app', 'to': 'bloom', 'label': '拦截'},
            {'from': 'app', 'to': 'db', 'label': '回源'},
            {'from': 'scheduler', 'to': 'dist', 'label': '失效'},
        ],
    },
}
