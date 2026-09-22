# -*- coding: utf-8 -*-
"""场景 3 · 高吞吐 IO：日志 / 事件批处理落盘。

用户的原始提问：「我们有一套日志/事件采集，峰值写入很大，怎么写才能既不丢、又不被写放大拖死，
还要在下游变慢时扛住背压」。

核心矛盾：单条写入的 fsync 代价 × 写入量 = 总落盘代价。量一上来，瓶颈从「查得快不快」
变成「一次 commit 的代价被摊薄了多少次」。这个场景关心：写放大、顺序写、背压、批提交、冷热分层。
"""

DRIVERS = [
    {'id': 'qps', 'name': '并发写入量', 'unit': 'QPS', 'hint': '峰值写，不是均值',
     'levels': [
         {'id': 'q1k', 'label': '1 千'},
         {'id': 'q10k', 'label': '1 万'},
         {'id': 'q100k', 'label': '10 万'},
         {'id': 'q1m', 'label': '100 万'},
     ]},
    {'id': 'volume', 'name': '日增数据量', 'unit': '行', 'hint': '决定文件滚动与归档频率',
     'levels': [
         {'id': 'v1m', 'label': '百万'},
         {'id': 'v100m', 'label': '1 亿'},
         {'id': 'v1b', 'label': '10 亿'},
         {'id': 'v10b', 'label': '100 亿'},
     ]},
    {'id': 'latency', 'name': 'P99 落地目标', 'unit': '', 'hint': '越紧越依赖攒批',
     'levels': [
         {'id': 'l50', 'label': '<50ms'},
         {'id': 'l200', 'label': '<200ms'},
         {'id': 'l1s', 'label': '<1s'},
     ]},
    {'id': 'durable', 'name': '持久化要求', 'unit': '', 'hint': '决定 fsync 频率',
     'levels': [
         {'id': 'durable', 'label': '不丢（每次 fsync）'},
         {'id': 'atleast', 'label': '至少一次'},
         {'id': 'best', 'label': '尽力'},
     ]},
    {'id': 'burst', 'name': '写入形态', 'unit': '', 'hint': '持续流 vs 突发批',
     'levels': [
         {'id': 'stream', 'label': '持续流'},
         {'id': 'batch', 'label': '突发批'},
         {'id': 'mixed', 'label': '混合'},
     ]},
    {'id': 'growth', 'name': '增长预期', 'unit': '', 'hint': '决定要不要现在就分层',
     'levels': [
         {'id': 'g1x', 'label': '年增 <1 倍'},
         {'id': 'g5x', 'label': '年增 5 倍'},
         {'id': 'g20x', 'label': '年增 20 倍'},
     ]},
]

CONFLICTS = [
    {'when': {'qps': ['q1m'], 'durable': ['durable'], 'latency': ['l50']},
     'text': '百万 QPS + 每次 fsync + P99<50ms 三者不可兼得：fsync 是磁盘级串行点，'
             '百万次/秒的 fsync 任何单机都压不到 50ms。要么放宽 P99 到 200ms（攒批后批量 fsync），'
             '要么接受 at-least-once 语义（丢批可重放，但不每批 fsync）。'},
    {'when': {'volume': ['v10b'], 'growth': ['g20x'], 'durable': ['durable']},
     'text': '日增 100 亿 + 年增 20 倍 + 每次不丢：单盘很快写满且 fsync 压力持续走高。'
             '必须现在就上冷热分层 + 按日期滚动文件（见切片「冷热分层」），否则三年后连归档都搬不动。'},
    {'when': {'qps': ['q100k', 'q1m'], 'burst': ['batch'], 'durable': ['durable']},
     'text': '突发批量 + 高 QPS + 每次不丢：突发瞬间会打满连接池与磁盘 IO。'
             '需要背压（见切片「背压」）把尖峰削平，否则 DB 抖动放大成全链路超时。'},
]

NOT_SUITABLE_FOR = [
    {'when': {'qps': ['q1k'], 'volume': ['v1m']},
     'reason': '1 千 QPS + 百万行/天 是单库单表的舒适区。攒批、滚动分片、冷热分层全是净成本。'
               '直接逐条 INSERT 或简单文件追加就够，请先看「最佳实践案例库 → 标准 CRUD」。'},
    {'when': {'volume': ['v1m', 'v100m'], 'latency': ['l1s'], 'durable': ['best']},
     'reason': '量级与持久化要求都很宽松，本场景大部分切片不会激活。'
               '你真正需要的只是「别用无界队列」这一条，不需要整套批处理流水线。'},
]

SLICES = [
    {
        'id': 'batch-flush',
        'order': 1,
        'goal': '批量攒批与双触发提交',
        'layer': '数据访问',
        'when': {'qps': ['q10k', 'q100k', 'q1m']},
        'why': '写入量到万级 QPS 后，单条 autocommit 的代价是「每条一次 fsync」，'
               '万级 TPS 下磁盘先死。必须把多次写入摊薄到一次 batch 提交里。',
        'decision': {
            'question': '写入怎么攒批？',
            'options': [
                '单条 autocommit —— 每条一次 fsync，万级 TPS 下磁盘先死',
                'JDBC batch + rewriteBatchedStatements —— 多条合并成一条多值 INSERT',
                '攒批到 N 条或 M 毫秒双触发 —— 延迟与吞吐平衡',
                '全异步写 MQ —— 吞吐最高，但牺牲写后立刻可查',
            ],
            'chosen': 'JDBC batch + 双触发（500 条 / 100ms 谁先到算谁）',
            'tradeoff': '最坏情况下一条数据在内存躺 100ms，进程崩溃会丢这一批，'
                        '所以攒批队列必须配优雅停机时的强制 flush。',
        },
        'sql': r"""-- 写多场景的建表取舍：少一个索引，写入快一截。
-- 只为真正会跑的查询建索引。每个二级索引都让 INSERT 多一次 B+ 树维护。
CREATE TABLE `ingest_event` (
  `id`          BIGINT       NOT NULL COMMENT '趋势递增，避免页分裂',
  `topic`       VARCHAR(64)  NOT NULL COMMENT '事件主题',
  `payload`     MEDIUMBLOB   NOT NULL COMMENT '只放查询要用的字节',
  `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_topic_time` (`topic`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  /*!50100 PARTITION BY RANGE (TO_DAYS(created_at)) */;""",
        'code': r"""/**
 * 场景：高吞吐 IO / 切片：批量攒批与双触发提交
 * 适用参数：并发写入 QPS ≥ 1 万
 * 依赖规则：CONC-POOL-001, CONC-POOL-002, CONC-POOL-004, DATA-SQL-001
 * JDK：21
 */
package com.example.ingest.flush;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.TimeUnit;

/** 攒批写入器：达到 BATCH_SIZE 或等待 FLUSH_MS 谁先到，触发一次提交。 */
public final class BatchFlushWriter implements AutoCloseable {
    /** 批大小上限。太大 → undo 膨胀、锁持有久；太小 → 攒不起批。500 是经验中位值。 */
    private static final int BATCH_SIZE = 500;
    /** 时间上限：低频时不能让数据一直躺在内存等满 500 条。 */
    private static final long FLUSH_MS = 100L;
    /** 有界队列：无界队列在下游变慢时会把堆吃光，是 OOM 最常见来源之一。 */
    private static final int QUEUE_CAP = 200_000;

    private final HikariDataSource ds;
    private final BlockingQueue<Event> queue = new ArrayBlockingQueue<>(QUEUE_CAP);

    public BatchFlushWriter(String url, String user, String pwd) {
        HikariConfig cfg = new HikariConfig();
        cfg.setJdbcUrl(url);
        cfg.setUsername(user);
        cfg.setPassword(pwd);
        // 写多场景：连接数 ≈ CPU 核数 × 2，别设成 100（多出来的只在排队）。
        cfg.setMaximumPoolSize(Runtime.getRuntime().availableProcessors() * 2);
        // 不加这句 batchUpdate 是假的：MySQL 驱动默认把 addBatch 拆成多条单发 INSERT。
        cfg.addDataSourceProperty("rewriteBatchedStatements", "true");
        this.ds = new HikariDataSource(cfg);
    }

    /** offer 而不是 put：队列满就拒绝，绝不阻塞业务线程（阻塞会把 DB 变慢传导成全站雪崩）。 */
    public boolean submit(Event e) {
        return queue.offer(e);
    }

    /** 由专职单线程调用：双触发攒批，一次 executeBatch + 一次 commit。 */
    public int drain() throws Exception {
        Event first = queue.poll(FLUSH_MS, TimeUnit.MILLISECONDS);
        if (first == null) {
            return 0;
        }
        List<Event> batch = new ArrayList<>(BATCH_SIZE);
        batch.add(first);
        queue.drainTo(batch, BATCH_SIZE - 1);
        try (Connection conn = ds.getConnection()) {
            conn.setAutoCommit(false);
            try (PreparedStatement ps = conn.prepareStatement(
                    "INSERT INTO ingest_event (id, topic, payload, created_at) VALUES (?, ?, ?, ?)")) {
                for (Event e : batch) {
                    ps.setLong(1, e.id());
                    ps.setString(2, e.topic());
                    ps.setBytes(3, e.payload());
                    ps.setTimestamp(4, java.sql.Timestamp.valueOf(e.createdAt()));
                    ps.addBatch();
                }
                ps.executeBatch();
            }
            conn.commit();
            return batch.size();
        }
    }

    @Override
    public void close() {
        ds.close();
    }

    public record Event(long id, String topic, byte[] payload, java.time.LocalDateTime createdAt) {
    }
}
""",
        'highlights': [
            {'mark': 'private static final int BATCH_SIZE = 500;',
             'title': '批大小上限',
             'text': '太大 → undo 膨胀、锁持有时间长；太小 → 攒不起批。500 是经验区间的中位，需按行宽实测微调。',
             'rule': 'CONC-POOL-004'},
            {'mark': 'cfg.addDataSourceProperty("rewriteBatchedStatements", "true");',
             'title': '不加这句 batchUpdate 是假的',
             'text': 'MySQL 驱动默认把 addBatch 拆成多条单发 INSERT，加了这句才合并成多值 INSERT，这才是批量的意义。',
             'rule': 'DATA-SQL-001'},
            {'mark': 'return queue.offer(e);',
             'title': '队列满就拒绝，不阻塞',
             'text': '用 put() 阻塞会把 DB 变慢直接传导成业务线程池耗尽，故障范围从「写入慢」放大成「全站不可用」。',
             'rule': 'CONC-POOL-004'},
        ],
        'pitfalls': [
            '用 Executors.newCachedThreadPool() 跑攒批线程 —— 无界线程数 + 无界队列，一次尖峰直接 OOM。',
            'batch 失败后逐条重试 —— 「哪些成功哪些失败」要靠额外状态表维护，复杂度远超收益，整批回滚更划算。',
            '优雅停机没 flush —— 内存里最后一批数据凭空消失，现象是「数据少了」不是「报错了」，极难定位。',
            '连接池设成 200 —— 看起来更能扛，实际把锁竞争搬进数据库，P99 反而变差。',
        ],
        'notSuitable': [
            '并发写入 1 千 QPS 以下：单条写入足够，攒批带来的 100ms 窗口期不划算。',
            '要求写后立刻可读且读不到就算错的场景：攒批天然有窗口期。',
        ],
        'relatedRules': ['CONC-POOL-001', 'CONC-POOL-002', 'CONC-POOL-004', 'DATA-SQL-001', 'CONC-POOL-003'],
        'refs': [
            {'title': 'MySQL Connector/J — rewriteBatchedStatements',
             'url': 'https://dev.mysql.com/doc/connector-j/8.0/en/connector-j-connp-props-performance-extensions.html'},
            {'title': 'HikariCP · About Pool Sizing',
             'url': 'https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing'},
        ],
    },
    {
        'id': 'append-only',
        'order': 2,
        'goal': '追加写 / 顺序写避免随机 IO',
        'layer': '存储',
        'when': {'volume': ['v100m', 'v1b', 'v10b']},
        'why': '日增上亿行后，如果每条事件都随机定位写入，磁盘磁头来回寻道会把吞吐打掉一个数量级。'
               '事件天然按时间有序，落盘必须走纯追加写（append-only）。',
        'decision': {
            'question': '落盘文件怎么写？',
            'options': [
                '每条直接 update 随机位置 —— 随机 IO，磁盘寻道吃光吞吐',
                '追加写顺序文件 + 后台建索引 —— 写路径纯顺序，读靠外部索引',
                '直接写对象存储分块 —— 适合冷数据，但实时读不便',
                '写 WAL 再异步整理 —— 写极快，但要多一道 compaction',
            ],
            'chosen': '追加写本地顺序文件（StandardOpenOption.APPEND）+ 周期性 fsync + 后台建索引',
            'tradeoff': '代价是「按主键随机读」要回查索引再定位文件偏移，读路径比直接 UPDATE 复杂。'
                        '但写吞吐的提升是数量级的，事件场景写远多于改。',
        },
        'sql': r"""-- 顺序写场景不需要「按主键 UPDATE」，表设计成只追加（append-only）。
-- 主键用趋势递增 id，写入永远落在最右页，几乎不产生页分裂。
CREATE TABLE `ingest_blob` (
  `id`          BIGINT       NOT NULL COMMENT '趋势递增，写入永远在最右页',
  `file_no`     INT          NOT NULL COMMENT '滚动文件序号，对应磁盘上的 segment',
  `offset`      BIGINT       NOT NULL COMMENT '在 segment 文件内的字节偏移',
  `len`         INT          NOT NULL COMMENT '本事件字节长度',
  `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_file_off` (`file_no`, `offset`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='事件偏移索引 · 本体在顺序文件';""",
        'code': r"""/**
 * 场景：高吞吐 IO / 切片：追加写顺序文件
 * 适用参数：日增数据量 ≥ 1 亿
 * 依赖规则：DATA-SCHM-001, REL-LOG-003, REL-CTNR-001
 * JDK：21
 */
package com.example.ingest.append;

import java.io.BufferedOutputStream;
import java.io.OutputStream;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

/**
 * 顺序段文件写入器。
 * 为什么用 APPEND 而不是随机写：事件按时间有序，追加写让磁盘只做顺序 IO，
 * 吞吐比随机写高一个数量级。代价是「随机读」要靠外部偏移索引（见 ingest_blob）。
 */
public final class SegmentWriter implements AutoCloseable {
    /** 每攒够这么多字节强制 fsync 一次。太频繁吞吐掉，太稀疏丢得多。 */
    private static final long FSYNC_EVERY = 8L * 1024 * 1024;

    private final Path path;
    private final OutputStream out;
    private long written = 0L;

    public SegmentWriter(Path dir, int fileNo) throws Exception {
        this.path = dir.resolve(String.format("seg-%05d.log", fileNo));
        // APPEND：内核只做顺序写，不回退磁头。CREATE 保证文件不存在时建出来。
        this.out = new BufferedOutputStream(
                Files.newOutputStream(path, StandardOpenOption.CREATE, StandardOpenOption.APPEND));
    }

    public synchronized long write(byte[] buf, int n) throws Exception {
        long offset = written;
        out.write(buf, 0, n);
        written += n;
        // 攒够 8MB 才 fsync：flush 只是把用户态缓冲推到内核，不等于落盘。
        // 真正落盘必须靠 FileChannel.force(true)，否则宕机丢最后这批。
        if (written % FSYNC_EVERY < n) {
            force();
        }
        return offset;
    }

    /** 真正落盘：force(true) 同时刷文件数据与元数据。 */
    public void force() throws Exception {
        try (FileChannel ch = FileChannel.open(path, StandardOpenOption.APPEND, StandardOpenOption.WRITE)) {
            ch.force(true);
        }
    }

    @Override
    public void close() throws Exception {
        force();
        out.close();
    }
}
""",
        'highlights': [
            {'mark': 'Files.newOutputStream(path, StandardOpenOption.CREATE, StandardOpenOption.APPEND)',
             'title': 'APPEND 顺序写',
             'text': '追加写让磁盘只做顺序 IO，吞吐比随机写高一个数量级。事件天然按时间有序，正适合这种模式。',
             'rule': 'DATA-SCHM-001'},
            {'mark': 'ch.force(true);',
             'title': 'force 才是真落盘',
             'text': 'BufferedOutputStream.flush() 只把数据推到内核页缓存，宕机仍会丢。必须 FileChannel.force(true) 刷到磁盘。',
             'rule': 'REL-LOG-003'},
        ],
        'pitfalls': [
            '用随机写（按主键定位）落事件 —— 磁头来回寻道，吞吐直接掉一个数量级。',
            '只 flush 不 force —— 宕机后丢最后一批，而且故障现象是「数据少了」不是报错，极难定位。',
            'fsync 频率过高（每条一次）—— 把顺序写退化成每条一次磁盘同步，吞吐回到原点。',
        ],
        'notSuitable': [
            '日增不到 1 亿：随机写也扛得住，顺序文件的索引复杂度不划算。',
            '事件需要频繁按主键原地修改：append-only 不支持改，得换成 LSM 类存储。',
        ],
        'relatedRules': ['DATA-SCHM-001', 'REL-LOG-003', 'REL-CTNR-001', 'DATA-SCHM-003'],
        'refs': [
            {'title': 'Linux — open(2) O_APPEND 语义',
             'url': 'https://man7.org/linux/man-pages/man2/open.2.html'},
            {'title': '《Designing Data-Intensive Applications》— SSTables & LSM-Trees',
             'note': '顺序写 + 后台合并是 LSM 树高写入吞吐的核心'},
        ],
    },
    {
        'id': 'fsync-policy',
        'order': 3,
        'goal': '刷盘策略与 fsync 取舍',
        'layer': '存储',
        'when': {'durable': ['durable', 'atleast']},
        'why': '「不丢」和「至少一次」都要求数据真正落到持久介质，但频率不同：'
               '不丢要求每条或每批 fsync，至少一次允许攒批后批量 fsync 并容忍重放。',
        'decision': {
            'question': 'fsync 怎么取舍？',
            'options': [
                '每条都 fsync —— 最安全，但吞吐被磁盘串行点锁死',
                '攒批后批量 fsync —— 吞吐高，宕机丢最后一批（at-least-once 可重放）',
                '完全不 fsync 依赖 OS 刷盘 —— 吞吐最高，丢数据风险最大',
                'WAL + group commit —— 多个事务共用一次 fsync',
            ],
            'chosen': 'durable → group commit 批量 fsync；atleast → 攒批 fsync + 写入端幂等去重',
            'tradeoff': '代价是 durable 下 P99 受 fsync 频率约束，不能再压到 50ms 以下（见 CONFLICTS）。'
                        'atleast 必须把「重放可能重复」做成可接受的语义。',
        },
        'sql': r"""-- 至少一次语义下，去重表是必须的：同一批可能因重放被消费两次。
CREATE TABLE `ingest_dedup` (
  `batch_key`   CHAR(32)    NOT NULL COMMENT '批次指纹（内容 sha256 前 32 位）',
  `status`      TINYINT     NOT NULL DEFAULT 0 COMMENT '0待处理 1已落盘',
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`batch_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='写入批次去重 · 防重放';""",
        'code': r"""/**
 * 场景：高吞吐 IO / 切片：fsync 策略与 group commit
 * 适用参数：持久化要求 = 不丢 或 至少一次
 * 依赖规则：REL-LOG-003, REL-RETRY-001, SVC-TX-002
 * JDK：21
 */
package com.example.ingest.durability;

import java.security.MessageDigest;
import java.util.HexFormat;

/**
 * 批次指纹。用于「至少一次」语义下去重：同一批数据重放时指纹相同，只落一次。
 * 为什么用内容指纹而不是序号：序号依赖全局发号，发号服务本身会成为瓶颈和单点；
 * 内容指纹让任何一跳都可以独立判断「这批是不是已经处理过」。
 */
public final class BatchFingerprint {

    /** 计算批次指纹。边读边算 SHA-256，不把整批读进堆（避免大批次 OOM）。 */
    public static String of(byte[] payload) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            md.update(payload);
            byte[] full = md.digest();
            byte[] head = new byte[16];
            System.arraycopy(full, 0, head, 0, 16);
            return HexFormat.of().formatHex(head);
        } catch (Exception ex) {
            throw new IllegalStateException("指纹计算失败", ex);
        }
    }

    /**
     * 是否首次见到该批次。返回 false 表示重放：调用方应跳过落盘而不是再写一次（否则重复事件）。
     * 注意：这里用 DB 唯一主键兜底，不是用内存 Set —— 多实例部署时内存视图不可靠。
     */
    public boolean seen(String batchKey, DedupDao dao) {
        return dao.insertIgnore(batchKey) == 0;
    }

    public interface DedupDao {
        /** INSERT IGNORE，命中主键冲突返回 0，表示已存在。 */
        int insertIgnore(String batchKey);
    }
}
""",
        'highlights': [
            {'mark': 'MessageDigest md = MessageDigest.getInstance("SHA-256");',
             'title': '内容指纹而非序号',
             'text': '序号依赖全局发号服务，会成瓶颈和单点；内容指纹让任意一跳都能独立判断批次是否处理过。',
             'rule': 'SVC-TX-002'},
            {'mark': 'return dao.insertIgnore(batchKey) == 0;',
             'title': '用 DB 唯一键兜底去重',
             'text': '多实例部署下内存 Set 不可靠，必须靠 INSERT IGNORE 的主键冲突返回 0 来判定重复，这才是真幂等。',
             'rule': 'REL-RETRY-001'},
        ],
        'pitfalls': [
            '用内存 Set 去重 —— 多实例部署时每个实例视图不同，重放照样重复落盘。',
            '每条都 fsync 还想压 P99<50ms —— 这是物理上不可能的，见 CONFLICTS。',
            '重放时不做去重直接再写 —— 事件流里出现重复，下游统计全错。',
        ],
        'notSuitable': [
            '持久化要求是「尽力」且无所谓重复：这套指纹与去重开销不划算。',
            '单实例且能接受丢数据：直接写文件不 fsync 更快。',
        ],
        'relatedRules': ['REL-LOG-003', 'REL-RETRY-001', 'SVC-TX-002', 'REL-EXCP-002'],
        'refs': [
            {'title': 'PostgreSQL — Synchronous Commit & Group Commit',
             'url': 'https://www.postgresql.org/docs/current/wal-async-commit.html'},
            {'title': 'Kafka — Delivery Semantics',
             'url': 'https://kafka.apache.org/documentation/#semantics'},
        ],
    },
    {
        'id': 'backpressure',
        'order': 4,
        'goal': '背压与有界队列',
        'layer': '并发',
        'when': {'qps': ['q100k', 'q1m']},
        'why': '十万级以上 QPS 时，下游（DB / 磁盘 / 下游服务）一旦变慢，内存里的待处理事件会瞬间堆积。'
               '没有背压，结果是 OOM 然后全链路雪崩。',
        'decision': {
            'question': '背压怎么做？',
            'options': [
                '无界队列 + 一直 offer —— 下游慢就堆内存，最终 OOM',
                '信号量在入口限流 —— 满了快速失败，保护后端',
                '有界队列 + 拒绝策略 —— 满了丢弃或降级，而非无限堆积',
                '反压到上游（如 MQ 消费限速）—— 从源头削峰',
            ],
            'chosen': '有界队列 + 显式拒绝（offer 返回 false 即降级），入口不排队',
            'tradeoff': '代价是下游持续慢时会有事件被拒。但「丢一批可重放」远好于「全站 OOM 一起死」。'
                        '拒绝事件必须能被重放（配合 at-least-once 语义）。',
        },
        'sql': r"""-- 背压生效时拒掉的事件进死信表，稍后重放，而不是默默丢失。
CREATE TABLE `ingest_deadletter` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `topic`       VARCHAR(64)  NOT NULL,
  `payload`     MEDIUMBLOB   NOT NULL,
  `reason`      VARCHAR(128) NOT NULL COMMENT '拒绝原因：queue_full / timeout',
  `replay_at`   DATETIME(3)  DEFAULT NULL COMMENT '可被重放的时间',
  `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_replay` (`replay_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='被背压拒掉的事件 · 待重放';""",
        'code': r"""/**
 * 场景：高吞吐 IO / 切片：背压与有界队列
 * 适用参数：并发写入 QPS ≥ 10 万
 * 依赖规则：CONC-POOL-002, CONC-POOL-004, REL-EXCP-002
 * JDK：21
 */
package com.example.ingest.backpressure;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/**
 * 带背压的写入管线。
 * 关键决定：队列必须有界。无界队列在下游变慢时会把堆吃光，
 * 最后以 OOM 的形式爆发，那时已经看不到是谁灌进来的了。
 */
public final class BackpressurePipeline implements AutoCloseable {
    /** 队列硬上限。超过就拒绝，绝不无限堆积。 */
    private static final int QUEUE_CAP = 100_000;

    // 禁止用 Executors.newCachedThreadPool：无界线程 + 无界队列 = 流量尖峰直接 OOM。
    // 必须显式 ThreadPoolExecutor + 有界队列 + 明确拒绝策略。
    private final ThreadPoolExecutor workers = new ThreadPoolExecutor(
            8, 32,
            60L, TimeUnit.SECONDS,
            new LinkedBlockingQueue<>(QUEUE_CAP),
            r -> new Thread(r, "ingest-worker"),
            new ThreadPoolExecutor.CallerRunsPolicy());

    private final BlockingQueue<Event> queue = new ArrayBlockingQueue<>(QUEUE_CAP);
    private final DeadLetterDao dlq;

    public BackpressurePipeline(DeadLetterDao dlq) {
        this.dlq = dlq;
    }

    /** 入口提交：队列满走 CallerRunsPolicy（调用方线程自己跑），既限速又不丢。 */
    public void submit(Event e) {
        if (!queue.offer(e)) {
            // 连队列都满：落死信表待重放，而不是抛异常让上游崩。
            dlq.save(e, "queue_full");
            return;
        }
        workers.execute(() -> handle(e));
    }

    private void handle(Event e) {
        try {
            // 实际写入逻辑省略
        } catch (RuntimeException ex) {
            // 异常只能用于异常，不能当流程控制；失败进死信，不要吞掉。
            dlq.save(e, "handler_error");
        }
    }

    @Override
    public void close() {
        workers.shutdown();
    }

    public record Event(long id, byte[] payload) {
    }

    public interface DeadLetterDao {
        void save(Event e, String reason);
    }
}
""",
        'highlights': [
            {'mark': 'new ThreadPoolExecutor(',
             'title': '显式线程池，禁 Executors 工厂',
             'text': 'Executors.newCachedThreadPool 无界线程 + 无界队列，尖峰直接 OOM。必须显式指定有界队列与拒绝策略。',
             'rule': 'CONC-POOL-002'},
            {'mark': 'if (!queue.offer(e)) {',
             'title': '有界队列 + 满则降级',
             'text': '无界队列在下游慢时把堆吃光。满就落死信表待重放，比「全站 OOM 一起死」好得多。',
             'rule': 'CONC-POOL-004'},
            {'mark': 'new Thread(r, "ingest-worker")',
             'title': '有意义的线程名',
             'text': '出事故时线程栈里能看出是谁在跑，而不是千篇一律的 pool-x-thread-y。',
             'rule': 'CONC-POOL-003'},
        ],
        'pitfalls': [
            '用 Executors.newCachedThreadPool() 裸用 —— 无上界线程数，尖峰直接创建成千上万线程。',
            '队列满了抛异常让上游崩 —— 把「下游慢」传导成「上游也死」，故障范围放大。',
            '用异常做流程控制（catch 后继续）—— 异常语义被污染，真正错误被掩盖。',
        ],
        'notSuitable': [
            'QPS 1 万以下：背压复杂度不划算，直接写就行。',
            '下游是同步强一致且不可降级：背压拒掉的事件无法重放，需换方案。',
        ],
        'relatedRules': ['CONC-POOL-002', 'CONC-POOL-004', 'CONC-POOL-003', 'REL-EXCP-002', 'CONC-POOL-001'],
        'refs': [
            {'title': 'Reactive Streams — Backpressure 语义',
             'url': 'https://reactivestreams.org/'},
            {'title': '阿里巴巴 Java 开发手册 — 并发处理',
             'note': '禁止 Executors 创建线程池，必须显式指定有界队列与拒绝策略'},
        ],
    },
    {
        'id': 'file-roll',
        'order': 5,
        'goal': '按时间 / 大小滚动分片文件',
        'layer': '存储',
        'when': {'volume': ['v1b', 'v10b']},
        'why': '日增十亿级以上，单个段文件会大到无法管理与复制。必须按时间或大小滚动成多个小文件，'
               '这样过期数据可以整文件删除，复制与校验也按文件粒度并行。',
        'decision': {
            'question': '段文件怎么滚动？',
            'options': [
                '单文件无限增长 —— 大到无法复制、无法删除、fsck 都慢',
                '按时间滚动（每小时/每天） —— 利于按时间归档与 TTL',
                '按大小滚动（每 1GB） —— 粒度均匀，利于并行复制',
                '按时间 + 大小双触发 —— 两者谁先到算谁',
            ],
            'chosen': '按时间（每整点）+ 大小（每 1GB）双触发滚动',
            'tradeoff': '代价是要维护「当前写文件」的状态，并处理好滚动瞬间的两文件并发写。'
                        '但这个状态用文件序号即可，不进数据库。',
        },
        'sql': r"""-- 段文件元数据：只记序号、起止时间、字节数，用于复制与 TTL。真正的事件内容在顺序文件里。
CREATE TABLE `ingest_segment` (
  `file_no`     INT          NOT NULL,
  `start_at`    DATETIME(3)  NOT NULL,
  `end_at`      DATETIME(3)  DEFAULT NULL,
  `bytes`       BIGINT       NOT NULL DEFAULT 0,
  `sealed`      TINYINT      NOT NULL DEFAULT 0 COMMENT '1=已封口，可安全复制删除',
  PRIMARY KEY (`file_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='段文件目录 · 不含事件内容';""",
        'code': r"""/**
 * 场景：高吞吐 IO / 切片：按时间/大小滚动分片
 * 适用参数：日增数据量 ≥ 10 亿
 * 依赖规则：DATA-SCHM-003, REL-CTNR-001, REL-LOG-001
 * JDK：21
 */
package com.example.ingest.roll;

import java.io.OutputStream;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;

/**
 * 段文件滚动策略。
 * 为什么双触发：只按大小会在低峰期产生超大文件，只按时间会在高峰期产生太多小文件。
 * 两者谁先到算谁，文件大小才既不太大也不太小。
 */
public final class SegmentRoller {
    /** 单个段文件上限。太大复制慢、删除慢；太小文件数爆炸。1GB 是经验甜点。 */
    private static final long MAX_BYTES = 1L << 30;
    /** 时间窗口。整点滚动让归档能按时间对齐。 */
    private static final Duration MAX_AGE = Duration.ofHours(1);

    private int currentNo;
    private OutputStream currentOut;
    private long currentBytes;
    private Instant currentStart;

    public SegmentRoller(Path dir, int startNo) {
        this.currentNo = startNo;
    }

    /** 是否该滚动：大小或时间任一越界即封口当前文件。 */
    public boolean shouldRoll(long willWrite) {
        if (currentOut == null) {
            return true;
        }
        boolean bySize = currentBytes + willWrite > MAX_BYTES;
        boolean byTime = Duration.between(currentStart, Instant.now()).compareTo(MAX_AGE) >= 0;
        return bySize || byTime;
    }

    /** 当前文件序号。复制与 TTL 都以这个序号为粒度。 */
    public int currentFileNo() {
        return currentNo;
    }

    /** 封口并开新文件。返回刚封口的文件号。 */
    public int sealAndNext(OutputStreamSupplier sup) throws Exception {
        if (currentOut != null) {
            currentOut.close();
        }
        currentNo += 1;
        currentOut = sup.open(currentNo);
        currentBytes = 0L;
        currentStart = Instant.now();
        return currentNo - 1;
    }

    public interface OutputStreamSupplier {
        OutputStream open(int fileNo) throws Exception;
    }
}
""",
        'highlights': [
            {'mark': 'private static final long MAX_BYTES = 1L << 30;',
             'title': '单文件 1GB 甜点',
             'text': '太大复制/删除慢，太小文件数爆炸。1GB 让复制、校验、TTL 删除都能按文件粒度并行。',
             'rule': 'DATA-SCHM-003'},
            {'mark': 'return bySize || byTime;',
             'title': '双触发滚动',
             'text': '只按大小低峰期文件过大，只按时间高峰期小文件爆炸。两者谁先到算谁，文件体积才均衡。',
             'rule': 'REL-CTNR-001'},
        ],
        'pitfalls': [
            '单文件无限增长 —— 大到无法复制、无法删除，fsck 都跑不完。',
            '滚动瞬间两文件并发写同一序号 —— 复制时可能读到半旧半新的文件，必须封口后再开新。',
            '不记录段文件目录 —— 复制与 TTL 没有依据，过期数据删不掉。',
        ],
        'notSuitable': [
            '日增不到 10 亿：单文件或简单按天足够，滚动状态机是净开销。',
            '数据需要原地修改：append-only 段文件不支持改，不适合。',
        ],
        'relatedRules': ['DATA-SCHM-003', 'REL-CTNR-001', 'REL-LOG-001', 'REL-LOG-002'],
        'refs': [
            {'title': 'Kafka — Log Segment 滚动策略',
             'url': 'https://kafka.apache.org/documentation/#log'},
            {'title': 'LSM-Tree Compaction 综述', 'note': 'SSTable 按大小/层级滚动与合并'},
        ],
    },
    {
        'id': 'tiered-archive',
        'order': 6,
        'goal': '冷热分层与归档清理（覆盖真实缺口：归档与冷热分层）',
        'layer': '设计',
        'when': {'growth': ['g5x', 'g20x']},
        'why': '年增 5 倍以上意味着热数据占比越来越小，大部分历史事件再也查不到。'
               '把它们和热数据放一起，索引与缓存都被冷数据稀释，整库变慢。必须冷热分层。',
        'decision': {
            'question': '冷热怎么分？',
            'options': [
                '全量留热存储 —— 越存越慢，成本线性飙升',
                '按时间分层（热 SSD / 温 HDD / 冷对象存储）—— 直观，按年龄迁移',
                '按访问频率分层 —— 精准但需统计访问热度',
                '只保留近期 N 天，更早直接删除 —— 最简单，但丢历史',
            ],
            'chosen': '按时间分层：近 7 天热 SSD，7~90 天温 HDD，90 天以上转对象存储归档',
            'tradeoff': '代价是查询要按时间路由到不同层，且冷层查询延迟高。'
                        '但事件场景 99% 查询集中在近期，这个代价完全可接受。',
        },
        'sql': r"""-- 分层：热表只留近期，冷数据迁出后热表体积小、缓冲池命中率高。
-- 用分区表让「迁出」变成 DROP PARTITION（元数据操作，秒级），而不是 DELETE（行操作，亿级要几小时）。
ALTER TABLE ingest_event
  PARTITION BY RANGE (TO_DAYS(created_at)) (
    PARTITION p_hot  VALUES LESS THAN (TO_DAYS(NOW()) - 7),
    PARTITION p_warm VALUES LESS THAN (TO_DAYS(NOW()) - 90),
    PARTITION p_cold VALUES LESS THAN MAXVALUE
  );

-- 归档：把 90 天前的数据导出到对象存储后，DROP 旧分区。先导出再 DROP，顺序反了数据就丢了。
ALTER TABLE ingest_event DROP PARTITION p_cold;""",
        'code': r"""/**
 * 场景：高吞吐 IO / 切片：冷热分层与归档
 * 适用参数：年增 ≥ 5 倍（历史数据会越来越多）
 * 依赖规则：DATA-SCHM-001, REL-CTNR-005, REL-LOG-002
 * JDK：21
 */
package com.example.ingest.tier;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

/**
 * 冷热分层路由。
 * 为什么按时间而不是按访问频率：事件的历史查询分布极度偏斜（99% 查近期），
 * 按时间分层实现简单且效果足够；访问频率统计本身要额外存储与计算，收益不划算。
 */
public final class TierRouter {
    /** 热层保留天数。超过即降级。 */
    private static final int HOT_DAYS = 7;
    private static final int WARM_DAYS = 90;

    private TierRouter() {
    }

    /** 该事件应落在哪一层。按年龄路由，查询时先打热层再打冷层。 */
    public static Tier tierOf(Instant createdAt, Instant now) {
        long age = ChronoUnit.DAYS.between(createdAt, now);
        if (age <= HOT_DAYS) {
            return Tier.HOT;
        }
        if (age <= WARM_DAYS) {
            return Tier.WARM;
        }
        return Tier.COLD;
    }

    /** 是否到了归档时机：冷数据定期导出到对象存储后删除本地。 */
    public static boolean shouldArchive(Instant createdAt, Instant now) {
        // 90 天前的冷数据可以安全归档；归档作业失败时必须跳过，不能裸删。
        return ChronoUnit.DAYS.between(createdAt, now) > WARM_DAYS;
    }

    public enum Tier {
        HOT, WARM, COLD
    }
}
""",
        'highlights': [
            {'mark': 'private static final int HOT_DAYS = 7;',
             'title': '近 7 天热层',
             'text': '事件 99% 查询集中在近期。热层体积小，缓冲池命中率高；冷数据稀释索引是整库变慢的主因。',
             'rule': 'DATA-SCHM-001'},
            {'mark': 'return ChronoUnit.DAYS.between(createdAt, now) > WARM_DAYS;',
             'title': '按年龄归档',
             'text': '按时间分层实现简单、效果足够。归档作业失败必须跳过而非裸删，否则冷数据凭空消失。',
             'rule': 'REL-CTNR-005'},
        ],
        'pitfalls': [
            '全量留热存储 —— 越存越慢，成本线性飙升，缓冲池被冷数据冲掉。',
            '归档作业先 DROP 再导出 —— 顺序反了数据直接丢，而且不报错。',
            '用访问频率分层却没统计能力 —— 分层逻辑退化成拍脑袋，路由错误。',
        ],
        'notSuitable': [
            '年增 <1 倍且数据量小：分层带来的路由复杂度不划算。',
            '所有事件都必须随时可查且延迟一致：分层后冷层延迟高，不满足。',
        ],
        'relatedRules': ['DATA-SCHM-001', 'REL-CTNR-005', 'REL-LOG-002', 'DATA-SCHM-003'],
        'refs': [
            {'title': 'MySQL 8.0 — Partitioning by RANGE',
             'url': 'https://dev.mysql.com/doc/refman/8.0/en/partitioning-range.html'},
            {'title': 'AWS — Storage Tiering 最佳实践', 'note': '热/温/冷分层按访问年龄迁移'},
        ],
    },
    {
        'id': 'idempotent-dedup',
        'order': 7,
        'goal': '至少一次语义与去重',
        'layer': '设计',
        'when': {},
        'why': '高吞吐管道几乎必然采用「至少一次」语义（攒批 fsync + 可重放），'
               '这意味着同一条事件可能因重放被消费两次。去重不是可选项，是正确性底线。',
        'decision': {
            'question': '重复怎么防？',
            'options': [
                '不防 —— 重复事件直接进下游，统计全错',
                '内存 Set 去重 —— 单实例可用，多实例失效',
                '内容指纹 + DB 唯一键 —— 跨实例可靠去重',
                '业务主键幂等（UPSERT） —— 适合可覆盖的场景',
            ],
            'chosen': '内容指纹（sha256 前缀）+ 写入端 DB 唯一键 INSERT IGNORE 兜底',
            'tradeoff': '代价是每次写入多一次去重查/插。但相比重复事件造成的下游错误，'
                        '这个开销是必须付的。指纹用前缀而非全文，省存储。',
        },
        'sql': r"""-- 去重键：用事件业务主键或内容指纹做唯一约束。
-- 重复事件 INSERT IGNORE 命中冲突，影响行数 0，即视为已处理。
CREATE TABLE `ingest_dedup_v2` (
  `dedup_key`   VARCHAR(64) NOT NULL COMMENT '业务主键 或 内容 sha256 前缀',
  `consumed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`dedup_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='消费去重 · 跨实例可靠';""",
        'code': r"""/**
 * 场景：高吞吐 IO / 切片：至少一次语义与去重
 * 适用参数：恒真 —— 高吞吐管道必然 at-least-once
 * 依赖规则：REL-RETRY-001, SVC-EXCP-001, DATA-SQL-001
 * JDK：21
 */
package com.example.ingest.dedup;

import java.util.Set;

/**
 * 消费去重闸门。
 * 为什么必须跨实例可靠：管道通常多消费者并行，内存 Set 在每个实例各有一份，
 * 同一事件可能被两个实例都认为「没见过」。唯一键兜底才是真幂等。
 */
public final class ConsumeDedup {
    private final DedupDao dao;

    public ConsumeDedup(DedupDao dao) {
        this.dao = dao;
    }

    /**
     * 尝试消费。返回 false 表示重复（已被其他实例消费过），调用方应跳过。
     * 用 INSERT IGNORE：命中主键冲突返回 0，原子且跨实例可靠。
     */
    public boolean tryConsume(String dedupKey) {
        // 禁止用 Thread.sleep 做重试退避：会占住消费者线程，应该用定时或 MQ 重试。
        int affected = dao.insertIgnore(dedupKey);
        return affected > 0;
    }

    /** 批量去重：一次事务插一批，冲突的返回 0 但不影响其余。 */
    public Set<String> filterNew(Set<String> keys) {
        return dao.insertIgnoreBatch(keys);
    }

    public interface DedupDao {
        int insertIgnore(String dedupKey);

        Set<String> insertIgnoreBatch(Set<String> dedupKeys);
    }
}
""",
        'highlights': [
            {'mark': 'int affected = dao.insertIgnore(dedupKey);',
             'title': 'INSERT IGNORE 兜底',
             'text': '命中主键冲突返回 0，原子且跨实例可靠。内存 Set 在多消费者下会漏判重复。',
             'rule': 'DATA-SQL-001'},
            {'mark': 'return affected > 0;',
             'title': '返回是否首次',
             'text': 'false = 重复，调用方跳过。把「重放可能重复」做成可接受的语义，而不是靠运气。',
             'rule': 'REL-RETRY-001'},
        ],
        'pitfalls': [
            '用内存 Set 去重 —— 多实例各一份视图，重复照样进下游。',
            '用 Thread.sleep 做重试退避 —— 占住消费者线程，吞吐直接掉。',
            '重复事件不处理直接落库 —— 下游计数、关联全错，且错误是静默的。',
        ],
        'notSuitable': [
            '单实例且能接受重复：内存去重就够，不需 DB 唯一键开销。',
            '事件本身允许重复（如纯日志不计数的埋点）：可不防。',
        ],
        'relatedRules': ['REL-RETRY-001', 'SVC-EXCP-001', 'DATA-SQL-001', 'REL-EXCP-002'],
        'refs': [
            {'title': 'Kafka — Idempotent Producer & Exactly-Once',
             'url': 'https://kafka.apache.org/documentation/#producerconfigs_enable.idempotence'},
            {'title': '《Designing Data-Intensive Applications》— Duplicate Suppression',
             'note': '用唯一键做幂等去重'},
        ],
    },
    {
        'id': 'graceful-shutdown',
        'order': 8,
        'goal': '优雅停机与最后一批 flush',
        'layer': '运维',
        'when': {},
        'why': '高吞吐写入进程在发布、缩容、宿主机驱逐时会被要求退出。'
               '如果只关连接不 flush，内存里最后一批（可能几万条）会凭空消失，'
               '而且现象是「数据少了」不是报错。',
        'decision': {
            'question': '停机怎么处理内存里的批？',
            'options': [
                '直接 kill —— 内存最后一批消失，且不报错',
                '先 flush 再退出 —— 保证不丢，但停机稍慢',
                '依赖 OS 刷盘 —— 不可靠，崩溃时页缓存丢',
                '发信号后等 N 秒强制退出 —— 兼顾速度与可靠',
            ],
            'chosen': '收到 SIGTERM 先停止接新流量 → flush 内存批 → 关闭连接池 → 退出',
            'tradeoff': '代价是停机时间变长（取决于最后一批大小）。但「丢数据」远比「多等 100ms」严重，'
                        '且终止等待时长要配得比 flush 耗时更久（见 REL-CTNR-001）。',
        },
        'sql': r"""-- 停机前要确认没有「已接流量但未落盘」的事件：用一张心跳表反映进程是否还在健康写入。
CREATE TABLE `ingest_heartbeat` (
  `node`        VARCHAR(64) NOT NULL,
  `last_write`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`node`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='写入节点心跳 · 停机可观测';""",
        'code': r"""/**
 * 场景：高吞吐 IO / 切片：优雅停机与最后一批 flush
 * 适用参数：恒真 —— 任何写进程都要能干净退出
 * 依赖规则：REL-CTNR-001, REL-CTNR-006, REL-LOG-002
 * JDK：21
 */
package com.example.ingest.lifecycle;

import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 优雅停机钩子。
 * 为什么不能 kill -9 了事：内存里攒着的最后一批事件没 flush 就消失，
 * 现象是「数据少了」而不是报错，最难的不是修复而是发现。
 */
public final class GracefulShutdown {
    /** 停止接新流量标志。先置位，新请求直接拒绝，旧请求继续处理。 */
    private final AtomicBoolean draining = new AtomicBoolean(false);
    private final FlushableQueue queue;
    private final int waitSeconds;

    public GracefulShutdown(FlushableQueue queue, int waitSeconds) {
        this.queue = queue;
        // 终止等待时长必须大于 flush 耗时，否则 flush 没跑完就被 SIGKILL。
        this.waitSeconds = Math.max(waitSeconds, 30);
    }

    /** 注册到 Runtime 的 shutdown hook。先停收，再 flush，再关池。 */
    public void install() {
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            draining.set(true);
            try {
                // 给一个上限，避免 flush 卡死导致永远不退出的僵死。
                queue.flushAll(waitSeconds, TimeUnit.SECONDS);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
            }
        }, "ingest-shutdown"));
    }

    public boolean isDraining() {
        return draining.get();
    }

    public interface FlushableQueue {
        void flushAll(long timeout, TimeUnit unit) throws InterruptedException;
    }
}
""",
        'highlights': [
            {'mark': 'this.waitSeconds = Math.max(waitSeconds, 30);',
             'title': '等待时长 > flush 耗时',
             'text': '优雅停机的终止等待必须比 flush 耗时长，否则 flush 没跑完进程就被 SIGKILL，最后一批照丢。',
             'rule': 'REL-CTNR-001'},
            {'mark': 'draining.set(true);',
             'title': '先停收新流量',
             'text': '新请求直接拒绝，旧请求继续处理。避免停机期间还往内存里灌数据，flush 永远跑不完。',
             'rule': 'REL-CTNR-006'},
        ],
        'pitfalls': [
            'kill -9 直接杀 —— 内存最后一批凭空消失，且不报错。',
            '终止等待配得比 flush 短 —— 等于没 flush，进程被强杀。',
            '停机不先停收流量 —— 边 flush 边来新数据，flush 永远跑不完。',
        ],
        'notSuitable': [
            '纯一次性批处理脚本（跑完即退，无长驻内存批）：不需要这套钩子。',
            '数据可随意丢失的临时管道：直接退出更快。',
        ],
        'relatedRules': ['REL-CTNR-001', 'REL-CTNR-006', 'REL-LOG-002', 'REL-LOG-001'],
        'refs': [
            {'title': 'Kubernetes — Pod termination grace period',
             'url': 'https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#pod-termination'},
            {'title': 'JVM — Shutdown Hooks',
             'url': 'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/lang/Runtime.html#addShutdownHook(java.lang.Thread)'},
        ],
    },
]

CASE = {
    'id': 'high-throughput-io',
    'order': 3,
    'name': '高吞吐 IO：日志 / 事件批处理落盘',
    'subtitle': '写放大、顺序写、背压与批提交，量一上来全得重算',
    'glyph': '⛁',
    'domain': ['日志', '物联网', '埋点', '交易流水'],
    'problem': '峰值写入巨大，单条 fsync 代价 × 写入量压垮磁盘；下游变慢时内存堆积 OOM；'
               '历史数据越积越多拖慢全库。',
    'symptoms': [
        '写入 QPS 一高，磁盘 IO 打满，P99 直线上升',
        '下游慢一点，进程内存就暴涨直到 OOM',
        '表越来越大，备份和查询都变慢',
        '发布停机后发现有数据「少了一批」',
    ],
    'drivers': DRIVERS,
    'conflicts': CONFLICTS,
    'slices': SLICES,
    'notSuitableFor': NOT_SUITABLE_FOR,
    'architecture': {
        'nodes': [
            {'id': 'app', 'label': '采集端', 'kind': 'backend', 'tier': 0},
            {'id': 'batch', 'label': '攒批层', 'kind': 'backend', 'tier': 1,
             'whenAny': {'qps': ['q10k', 'q100k', 'q1m']}},
            {'id': 'mq', 'label': '消息队列', 'kind': 'messagebus', 'tier': 1,
             'whenAny': {'durable': ['atleast', 'best'], 'burst': ['batch', 'mixed']}},
            {'id': 'db', 'label': '热存储', 'kind': 'database', 'tier': 2},
            {'id': 'objstore', 'label': '冷归档', 'kind': 'cloud', 'tier': 3,
             'whenAny': {'growth': ['g5x', 'g20x']}},
            {'id': 'dlq', 'label': '死信/重放', 'kind': 'database', 'tier': 3,
             'whenAny': {'qps': ['q100k', 'q1m']}},
        ],
        'links': [
            {'from': 'app', 'to': 'batch', 'label': '提交'},
            {'from': 'batch', 'to': 'mq', 'label': '异步'},
            {'from': 'batch', 'to': 'db', 'label': '落盘'},
            {'from': 'batch', 'to': 'dlq', 'label': '拒掉'},
            {'from': 'db', 'to': 'objstore', 'label': '归档'},
        ],
    },
}
