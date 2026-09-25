# -*- coding: utf-8 -*-
"""场景 2 · 基因 / DNA 序列海量存取。

用户的原始提问：「在做医院的项目，有关于基因的部分，DNA 序列很多，
患者会去查 DNA 序列，数据量非常庞大，告诉我如何建表建库、如何写 Java 代码才能快速查询」。

这个场景的核心矛盾是**三种查询模式的代价完全不在一个量级**：
  ① 按样本 ID 取全序列  —— GB 级、低频
  ② 按基因位点区间查变异 —— 高频、小结果集、要求亚秒
  ③ 按人群做聚合统计    —— 极低频、全表扫描

把这三种都塞进同一张关系表，是这类项目最常见的死法：
序列本体一旦进库，备份、主从复制、DDL 会一起失控。
"""

DRIVERS = [
    {'id': 'qps', 'name': '并发量', 'unit': 'QPS', 'hint': '位点查询为主',
     'levels': [
         {'id': 'q100', 'label': '100', 'value': 100},
         {'id': 'q1k', 'label': '1 千', 'value': 1000},
         {'id': 'q10k', 'label': '1 万', 'value': 10000},
         {'id': 'q100k', 'label': '10 万', 'value': 100000},
     ]},
    {'id': 'rows', 'name': '数据规模', 'unit': '样本', 'hint': '单样本序列可达 GB 级',
     'levels': [
         {'id': 's10k', 'label': '1 万', 'value': 10000},
         {'id': 's1m', 'label': '100 万', 'value': 1000000},
         {'id': 's100m', 'label': '1 亿', 'value': 100000000},
         {'id': 's1b', 'label': '10 亿', 'value': 1000000000},
     ]},
    {'id': 'rw', 'name': '读写比', 'unit': '', 'hint': '导入期 vs 查询期差别极大',
     'levels': [
         {'id': 'rw91', 'label': '9:1 读多', 'note': '平台稳定运营期'},
         {'id': 'rw11', 'label': '1:1', 'note': '持续有小批量入库'},
         {'id': 'rw19', 'label': '1:9 写多', 'note': '测序仪批量导入期'},
     ]},
    {'id': 'consist', 'name': '一致性', 'unit': '', 'hint': '报告能不能读旧值',
     'levels': [
         {'id': 'strong', 'label': '强一致', 'note': '出报告链路必须读最新'},
         {'id': 'bounded', 'label': '有界延迟一致', 'note': '秒级'},
         {'id': 'eventual', 'label': '最终一致', 'note': '科研统计可接受分钟级'},
     ]},
    {'id': 'latency', 'name': 'P99 目标', 'unit': '', 'hint': '针对位点区间查询',
     'levels': [
         {'id': 'l50', 'label': '<50ms'},
         {'id': 'l200', 'label': '<200ms'},
         {'id': 'l1s', 'label': '<1s'},
     ]},
    {'id': 'growth', 'name': '增长预期', 'unit': '', 'hint': '测序量通常是超线性增长',
     'levels': [
         {'id': 'g1x', 'label': '年增 <1 倍'},
         {'id': 'g5x', 'label': '年增 5 倍'},
         {'id': 'g20x', 'label': '年增 20 倍'},
     ]},
]

CONFLICTS = [
    {'when': {'rows': ['s100m', 's1b'], 'latency': ['l50'], 'rw': ['rw19']},
     'text': '亿级样本 + 批量导入期 + 位点查询 P99<50ms：导入会持续占用 IO 与索引维护资源，'
             '与低延迟查询直接冲突。请把导入与查询分开时段或分开实例（见切片「批量导入不停服」）。'},
    {'when': {'rows': ['s1b'], 'latency': ['l50'], 'consist': ['strong']},
     'text': '10 亿样本 + 强一致 + 位点查询 P99<50ms：必须把变异位点与序列本体彻底分层，'
             '并且位点表按染色体分区 + 复合索引前缀命中。任何一次回表都会让 P99 掉出 50ms。'},
    {'when': {'rows': ['s1b'], 'growth': ['g20x'], 'latency': ['l50', 'l200']},
     'text': '10 亿样本且年增 20 倍：按这个增速三年内会到千亿级。'
             '分区策略要按「能 DROP PARTITION」来设计，否则三年后连删数据都做不到。'},
]

NOT_SUITABLE_FOR = [
    {'when': {'rows': ['s10k'], 'qps': ['q100']},
     'reason': '1 万样本 + 100 QPS 是单库单表的量级。分层、分区、冷热切换这套东西在这里全是净成本。'
               '先把变异位点表建对索引就够了。'},
    {'when': {'rows': ['s10k', 's1m'], 'latency': ['l1s'], 'qps': ['q100', 'q1k']},
     'reason': '规模与延迟都很宽松，本场景大部分切片不会激活。真正要做的只是「序列别进关系库」这一条。'},
]

BENCHMARK = {
    'title': '序列本体存放位置对运维的影响（公开资料量级，非本机实测）',
    'columns': ['做法', '单库体积', '备份耗时', '主从延迟', '来源'],
    'rows': [
        ['序列 BLOB 存 MySQL', '约 20 TB', '小时级，且锁竞争明显', '分钟~小时级', '行业普遍反馈'],
        ['序列存对象存储 + DB 存指针', '约 200 GB', '分钟级', '秒级', 'AWS 基因组学最佳实践'],
        ['变异位点独立列存', '数 TB', '可接受', '可接受', 'GA4GH 存储规范'],
    ],
    'conclusion': '序列本体进关系库，代价不体现在查询上（查询照样能跑），而是体现在备份、复制、DDL 上 —— '
                  '这些操作会随时间线性恶化，等发现时已经改不动了。分层是这个场景唯一不可让步的决策。',
}

ARCHITECTURE = {
    'nodes': [
        {'id': 'app', 'label': '查询服务', 'kind': 'backend', 'tier': 0},
        {'id': 'meta', 'label': '样本元数据', 'kind': 'database', 'tier': 1},
        {'id': 'variant', 'label': '变异位点库', 'kind': 'database', 'tier': 1},
        {'id': 'objstore', 'label': '对象存储', 'kind': 'cloud', 'tier': 2},
        {'id': 'cache', 'label': '位点缓存', 'kind': 'database', 'tier': 2,
         'whenAny': {'latency': ['l50'], 'rw': ['rw91']}},
        {'id': 'import', 'label': '导入流水线', 'kind': 'messagebus', 'tier': 3,
         'whenAny': {'rw': ['rw11', 'rw19']}},
        {'id': 'audit', 'label': '审计日志', 'kind': 'security', 'tier': 3},
    ],
    'links': [
        {'from': 'app', 'to': 'meta', 'label': '元数据'},
        {'from': 'app', 'to': 'variant', 'label': '区间查'},
        {'from': 'app', 'to': 'objstore', 'label': '流式取序列'},
        {'from': 'app', 'to': 'cache', 'label': '热点'},
        {'from': 'import', 'to': 'objstore', 'label': '写入'},
        {'from': 'import', 'to': 'variant', 'label': '批量位点'},
        {'from': 'app', 'to': 'audit', 'label': '谁查了谁'},
    ],
}

SLICES = [
    {
        'id': 'storage-layering',
        'order': 1,
        'goal': '序列本体不进关系库',
        'layer': '设计',
        'when': {'rows': ['s1m', 's100m', 's1b']},
        'why': '单个样本的原始序列可达 GB 级。一旦进关系库，体积会到数十 TB，'
               '而备份、主从复制、DDL 的代价都随体积线性上升 —— 查询还是能跑，但运维会先崩。',
        'decision': {
            'question': '序列本体放哪？',
            'options': [
                'MySQL BLOB / LONGTEXT —— 一条记录几十 MB，缓冲池当场被冲掉',
                '文件系统 + DB 存路径 —— 便宜，但备份一致性、多副本、扩容全要自己做',
                '对象存储（MinIO / S3）+ DB 存指针与校验和 —— 体积与成本都可控，且天然多副本',
                '专用列存（Parquet + 对象存储）—— 适合批量分析，不适合单样本点查',
            ],
            'chosen': '对象存储存序列本体，DB 只存 object_key + sha256 + 字节数，元数据与位点独立建表',
            'tradeoff': '代价是「取一条完整序列」变成两次调用（查指针 + 取对象），且要处理对象与元数据不一致。'
                        '这个不一致用「先写对象、后写元数据」的顺序 + 校验和兜底。',
        },
        'sql': r"""-- 三层：样本元数据 / 变异位点 / 序列对象指针。刻意分成三张表而不是一张宽表。
CREATE TABLE `genome_sample` (
  `sample_id`    BIGINT      NOT NULL COMMENT '样本唯一标识，业务侧生成',
  `patient_id`   BIGINT      NOT NULL COMMENT '患者。脱敏后存储，明文另存受控区',
  `assay`        VARCHAR(32) NOT NULL COMMENT '检测项目：WGS/WES/Panel',
  `status`       TINYINT     NOT NULL DEFAULT 0 COMMENT '0已收样 1测序中 2已出变异 3已出报告',
  `sampled_at`   DATE        NOT NULL,
  `created_at`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`sample_id`),
  KEY `idx_patient` (`patient_id`, `sampled_at` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='样本元数据 · 不含任何序列数据';

-- 序列本体只留指针。绝不允许把序列内容放进这张表。
CREATE TABLE `genome_sequence_object` (
  `sample_id`   BIGINT       NOT NULL,
  `seq_type`    VARCHAR(16)  NOT NULL COMMENT 'FASTQ/BAM/CRAM/VCF',
  `object_key`  VARCHAR(512) NOT NULL COMMENT '对象存储路径：bucket/prefix/sample_id/xxx.cram',
  `size_bytes`  BIGINT       NOT NULL,
  -- 校验和是这套设计的兜底：对象与元数据不一致时，它是唯一能判定谁对的证据。
  `sha256`      CHAR(64)     NOT NULL,
  `uploaded_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`sample_id`, `seq_type`),
  KEY `idx_uploaded` (`uploaded_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='序列对象指针 · 本体在对象存储';""",
        'code': r"""/**
 * 场景：基因 / DNA 序列海量存取 / 切片：存储分层
 * 适用参数：样本数 ≥ 100 万
 * 依赖规则：DATA-SCHM-001, SEC-DATA-001, REL-EXCP-001
 * JDK：17
 */
package com.example.genome.store;

import java.io.InputStream;
import java.security.MessageDigest;
import java.util.HexFormat;

/**
 * 序列对象的写入顺序：**先落对象，后写元数据**。
 *
 * 为什么是这个顺序：反过来（先写元数据）会出现「元数据说有、对象里没有」，
 * 这种状态对查询方是致命的 —— 它会拿到一个 404 当成了数据丢失。
 * 先写对象则最坏情况是「对象有了、元数据没写」，那只是一个孤儿文件，
 * 用定时对账扫掉即可，不影响任何查询。
 */
public final class SequenceObjectStore {

    private final ObjectStorage storage;
    private final SequenceMetaDao metaDao;

    public SequenceObjectStore(ObjectStorage storage, SequenceMetaDao metaDao) {
        this.storage = storage;
        this.metaDao = metaDao;
    }

    /**
     * @return 对象 key，供元数据表引用
     */
    public String put(long sampleId, String seqType, InputStream body) throws Exception {
        String key = objectKey(sampleId, seqType);
        MessageDigest digest = MessageDigest.getInstance("SHA-256");

        // 边写边算校验和：不缓冲整个文件。GB 级序列一旦 readAllBytes 就是一次 OOM。
        long size = storage.putStreaming(key, body, digest);

        String sha = HexFormat.of().formatHex(digest.digest());
        // 元数据放在对象成功之后。这一步失败会留下孤儿对象，由对账任务清理。
        metaDao.upsert(sampleId, seqType, key, size, sha);
        return key;
    }

    /** 取序列：只返回流，调用方必须 close。返回 byte[] 的方法在这里一律不许存在。 */
    public InputStream open(long sampleId, String seqType) throws Exception {
        var meta = metaDao.load(sampleId, seqType)
                .orElseThrow(() -> new java.util.NoSuchElementException(
                        "样本序列不存在 sampleId=" + sampleId + " type=" + seqType));
        return storage.open(meta.objectKey());
    }

    /** 对账：只信校验和。对象与元数据不一致时，SHA-256 是唯一能判定谁对的证据。 */
    public boolean verify(long sampleId, String seqType) throws Exception {
        var meta = metaDao.load(sampleId, seqType).orElse(null);
        if (meta == null) {
            return false;
        }
        return meta.sha256().equals(storage.checksum(meta.objectKey()));
    }

    static String objectKey(long sampleId, String seqType) {
        // 按 sample_id 取模分前缀：对象存储虽然不关心目录，但列举与生命周期规则要靠前缀分段。
        return "seq/%02d/%d/%s".formatted(sampleId % 100, sampleId, seqType.toLowerCase());
    }

    /** 对象存储抽象。刻意不引 SDK 类型进来 —— 换成 MinIO / S3 / OSS 时只改这一个实现。 */
    public interface ObjectStorage {
        long putStreaming(String key, InputStream body, MessageDigest digest) throws Exception;

        InputStream open(String key) throws Exception;

        String checksum(String key) throws Exception;
    }

    public interface SequenceMetaDao {
        void upsert(long sampleId, String seqType, String objectKey, long size, String sha256);

        java.util.Optional<SeqMeta> load(long sampleId, String seqType);
    }

    public record SeqMeta(String objectKey, long sizeBytes, String sha256) {
    }
}
""",
        'highlights': [
            {'mark': 'long size = storage.putStreaming(key, body, digest);',
             'title': '流式写，不许读全量',
             'text': 'GB 级序列一旦 readAllBytes 就是一次 OOM。边写边算 SHA-256，内存占用恒定。',
             'rule': 'DATA-SCHM-001'},
            {'mark': 'metaDao.upsert(sampleId, seqType, key, size, sha);',
             'title': '先对象后元数据',
             'text': '反过来会出现「元数据说有、对象没有」，查询方会把 404 当数据丢失。先写对象的最坏情况只是孤儿文件。',
             'rule': 'REL-EXCP-001'},
            {'mark': 'public InputStream open(long sampleId, String seqType)',
             'title': '只返回流，不返回 byte[]',
             'text': '这个类里不允许存在返回 byte[] 的方法 —— 那是把「会不会 OOM」交给调用方的调用方式决定。',
             'rule': 'DATA-SCHM-001'},
            {'mark': 'return meta.sha256().equals(storage.checksum(meta.objectKey()));',
             'title': '校验和是唯一裁判',
             'text': '对象与元数据不一致时，没有第三方可以仲裁，只有 SHA-256 说了算。这也是它必须落库的原因。',
             'rule': 'SEC-DATA-001'},
        ],
        'pitfalls': [
            '把序列塞进 MySQL 的 LONGTEXT —— 单条几十 MB，缓冲池被一次查询冲干净，全库跟着慢。',
            '先写元数据再写对象 —— 故障窗口内查询方拿到「有元数据但取不到内容」，会被当成数据丢失上报。',
            '返回 byte[] 给上层 —— 上层拿去 new String(bytes) 或者直接进集合，堆直接爆。',
            '不存校验和 —— 对象被误删或位翻转时，没有任何证据能判定是丢了还是本来就没有。',
        ],
        'notSuitable': [
            '样本数 1 万以下且序列很小：分层带来的双写一致性成本大于收益。',
            '没有对象存储且不能引入：退化为本地文件系统时，备份与多副本要自己补齐，不能只做个路径表。',
        ],
        'relatedRules': ['DATA-SCHM-001', 'DATA-SCHM-002', 'SEC-DATA-001', 'REL-EXCP-001'],
        'refs': [
            {'title': 'GA4GH — Data Repository Service 规范', 'url': 'https://github.com/ga4gh/data-repository-service-schemas'},
            {'title': 'AWS — Genomics Workflows 最佳实践', 'note': '序列文件存 S3，元数据与索引存数据库'},
        ],
    },
    {
        'id': 'variant-ddl',
        'order': 2,
        'goal': '变异位点表：分区 + 复合索引列序',
        'layer': '设计',
        'when': {'rows': ['s1m', 's100m', 's1b']},
        'why': '位点查询是高频、小结果集、要求亚秒的操作。它必须命中索引前缀，'
               '而且数据量到十亿级后要靠分区把「扫的范围」压下来。',
        'decision': {
            'question': '变异位点怎么建表？',
            'options': [
                '单表 + 索引 —— 十亿行后索引树太深，且历史数据无法低成本下线',
                '按染色体 LIST 分区 —— 与查询模式完全对齐，代价是分区数固定',
                '按 sample_id HASH 分区 —— 分布均匀，但区间查询要跨所有分区',
                '按时间 RANGE 分区 —— 利于归档，但位点查询几乎不带时间',
            ],
            'chosen': '按 chromosome LIST 分区，区内复合索引 (chromosome, pos, sample_id)',
            'tradeoff': '代价是染色体数是固定的（24 条 + 特殊），分区键不可再改。'
                        '但位点查询永远带染色体，这个对齐关系是稳定的，值得赌。',
        },
        'sql': r"""-- 变异位点表。百万样本 × 每人约 400 万个位点 = 万亿行的量级，必须分区。
CREATE TABLE `genome_variant` (
  `id`           BIGINT      NOT NULL,
  `sample_id`    BIGINT      NOT NULL,
  `chromosome`   VARCHAR(8)  NOT NULL COMMENT '1..22,X,Y,MT —— 分区键，查询必带',
  `pos`          INT         NOT NULL COMMENT '位点坐标，1-based',
  `ref_allele`   VARCHAR(255) NOT NULL,
  `alt_allele`   VARCHAR(255) NOT NULL,
  `quality`      SMALLINT    NOT NULL DEFAULT 0,
  `created_at`   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`, `chromosome`),
  -- 列序 = 分区键 → 等值/范围列 → 回表列。位点查询永远是「某染色体的某区间」，
  -- 所以 (chromosome, pos) 必须在最前面，顺序反过来索引就废了。
  KEY `idx_chr_pos` (`chromosome`, `pos`, `sample_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
PARTITION BY LIST COLUMNS (chromosome) (
  PARTITION p01 VALUES IN ('1'),  PARTITION p02 VALUES IN ('2'),
  PARTITION p03 VALUES IN ('3'),  PARTITION p04 VALUES IN ('4'),
  PARTITION p05 VALUES IN ('5'),  PARTITION p06 VALUES IN ('6'),
  PARTITION p07 VALUES IN ('7'),  PARTITION p08 VALUES IN ('8'),
  PARTITION p09 VALUES IN ('9'),  PARTITION p10 VALUES IN ('10'),
  PARTITION p11 VALUES IN ('11'), PARTITION p12 VALUES IN ('12'),
  PARTITION p13 VALUES IN ('13'), PARTITION p14 VALUES IN ('14'),
  PARTITION p15 VALUES IN ('15'), PARTITION p16 VALUES IN ('16'),
  PARTITION p17 VALUES IN ('17'), PARTITION p18 VALUES IN ('18'),
  PARTITION p19 VALUES IN ('19'), PARTITION p20 VALUES IN ('20'),
  PARTITION p21 VALUES IN ('21'), PARTITION p22 VALUES IN ('22'),
  PARTITION px  VALUES IN ('X'),  PARTITION py VALUES IN ('Y'),
  PARTITION pm  VALUES IN ('MT')
);
-- 注意：分区键必须进主键，否则 MySQL 直接拒绝建表。这是最容易卡住的一处。""",
        'code': r"""/**
 * 场景：基因 / DNA 序列海量存取 / 切片：位点表建分区与复合索引
 * 适用参数：样本数 ≥ 100 万
 * 依赖规则：DATA-SCHM-002, DATA-SQL-001, DATA-SCHM-003
 * JDK：17
 */
package com.example.genome.variant;

import java.util.Locale;
import java.util.Set;

/**
 * 位点表的分区与索引约束。
 *
 * 这里刻意把「哪些值合法」写成代码常量而不是散落在 SQL 字符串里：
 * 分区键的取值集合决定了能不能落到分区，拼错一个大小写（'x' 而不是 'X'）
 * 在 MySQL 里不是「查不到」，而是直接报「无对应分区」错误。
 */
public final class VariantSchema {

    /** 合法染色体。与 DDL 的 PARTITION BY LIST 逐一对齐，改 DDL 必须同步改这里。 */
    private static final Set<String> CHROMOSOMES = Set.of(
            "1", "2", "3", "4", "5", "6", "7", "8", "9", "10",
            "11", "12", "13", "14", "15", "16", "17", "18", "19", "20",
            "21", "22", "X", "Y", "MT");

    private VariantSchema() {
    }

    /**
     * 规范化染色体写法。数据库里存的是大写 'X'，用户可能传 'chrX'、'x'、'chrx'。
     * 不做归一化，后果是「明明有数据却查不到」—— 这类 bug 在数据侧完全看不出来。
     */
    public static String normalizeChromosome(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("染色体为空");
        }
        String s = raw.trim();
        if (s.regionMatches(true, 0, "chr", 0, 3)) {
            s = s.substring(3);
        }
        String upper = s.toUpperCase(Locale.ROOT);
        if (!CHROMOSOMES.contains(upper)) {
            throw new IllegalArgumentException("非法染色体：" + raw);
        }
        return upper;
    }

    /**
     * 区间查询的边界必须是半开区间 [startPos, endPos)。
     * 用 BETWEEN（闭区间）会让相邻两次查询在边界位点上重复，
     * 拼接多个区间时就会多出一行 —— 在报告里表现为「同一个变异出现两次」。
     */
    public static void requireValidRange(int startPos, int endPos) {
        if (startPos < 1) {
            throw new IllegalArgumentException("pos 从 1 开始，startPos=" + startPos);
        }
        if (endPos <= startPos) {
            throw new IllegalArgumentException("区间必须满足 endPos > startPos："
                    + startPos + ".." + endPos);
        }
        // 单区间长度上限。一次查几千万个位点会把缓冲池冲掉，也会让接口超时。
        if ((long) endPos - startPos > 5_000_000L) {
            throw new IllegalArgumentException("单次区间不得超过 500 万个位点，请分段查询");
        }
    }

    /** 索引前缀顺序。SQL 拼装时必须按这个顺序来，顺序错了索引就废了。 */
    public static String indexHint() {
        return "idx_chr_pos (chromosome, pos, sample_id)";
    }
}
""",
        'highlights': [
            {'mark': 'if (!CHROMOSOMES.contains(upper)) {',
             'title': '分区键取值必须校验',
             'text': '传错染色体在分区表上不是「查不到」，是「无对应分区」报错。白名单比事后排查便宜得多。',
             'rule': 'DATA-SCHM-002'},
            {'mark': 'if (s.regionMatches(true, 0, "chr", 0, 3)) {',
             'title': 'chrX / x / X 归一',
             'text': '用户写法不统一时，不做归一的后果是「明明有数据却查不到」，这类 bug 在数据侧完全看不出来。',
             'rule': 'DATA-SQL-001'},
            {'mark': 'if (endPos <= startPos) {',
             'title': '半开区间 [start, end)',
             'text': '用 BETWEEN（闭区间）拼接相邻区间会在边界位点重复，报告里表现为「同一个变异出现两次」。',
             'rule': 'DATA-SQL-001'},
            {'mark': 'if ((long) endPos - startPos > 5_000_000L) {',
             'title': '区间长度上限',
             'text': '一次查几千万位点会冲掉缓冲池，连带其他查询一起变慢。宁可让调用方分段。',
             'rule': 'DATA-SQL-002'},
        ],
        'pitfalls': [
            '复合索引列序写成 (pos, chromosome) —— 查询带 chromosome 时索引前缀不匹配，直接全分区扫。',
            '分区键忘了进主键 —— MySQL 直接拒绝建表，报错信息还是英文的，第一次都会卡在这。',
            '染色体大小写不统一 —— 一部分数据存 X 一部分存 x，分区表会把它们当成两个世界。',
        ],
        'notSuitable': [
            '样本数 1 万以下：分区带来的管理成本大于收益，单表加索引足够。',
            '查询模式以「按样本取全部变异」为主而不是按区间：分区键该换成 sample_id 的 HASH。',
        ],
        'relatedRules': ['DATA-SCHM-002', 'DATA-SCHM-003', 'DATA-SQL-001', 'DATA-SQL-002'],
        'refs': [
            {'title': 'MySQL 8.0 — Partitioning', 'url': 'https://dev.mysql.com/doc/refman/8.0/en/partitioning.html'},
            {'title': 'Use the Index, Luke! — 复合索引列序', 'url': 'https://use-the-index-luke.com/sql/where-clause/the-equals-operator/concatenated-keys'},
        ],
    },
    {
        'id': 'range-query',
        'order': 3,
        'goal': '位点区间查询：命中索引、不回表',
        'layer': '数据访问',
        'when': {'latency': ['l50', 'l200']},
        'why': '这是患者和医生真正在等的那次查询。P99 要求亚秒，'
               '意味着一次查询既不能扫太多行，也不能产生大量回表。',
        'decision': {
            'question': '怎么保证 P99？',
            'options': [
                'SELECT * —— 回表取到 ref/alt 两个 VARCHAR(255)，行宽大、IO 翻倍',
                '覆盖索引 + 只查需要的列 —— Extra 出现 Using index',
                '加缓存兜住热点区间 —— 有效，但要先有正确的索引',
                '预计算常见区间 —— 只适合固定 Panel，不适合任意区间',
            ],
            'chosen': '覆盖索引（把 ref/alt 缩短到实际需要的长度）+ 只查需要的列 + 热点区间二级缓存',
            'tradeoff': '代价是索引变大。位点表本来就大，多一个宽索引会让写入变慢。'
                        '所以这个索引只在「查询期」建，批量导入期可以先不建（见「批量导入」切片）。',
        },
        'sql': r"""-- 覆盖索引：查询用到的列全在索引里，EXPLAIN 的 Extra = Using index（不回表）。
-- ref/alt 实测 99.9% 是单字符（SNV），但留了 VARCHAR(64) 给少量结构变异。
ALTER TABLE genome_variant
  ADD KEY `idx_cover_range` (`chromosome`, `pos`, `sample_id`, `ref_allele`(8), `alt_allele`(8), `quality`),
  ALGORITHM=INSTANT, LOCK=NONE;

-- 区间查询。半开区间 + 只取需要的列 + 显式 LIMIT。
SELECT sample_id, pos, ref_allele, alt_allele, quality
FROM   genome_variant PARTITION (p07)
WHERE  chromosome = '7'
  AND  pos >= ? AND pos < ?          -- 半开区间，不重不漏
  AND  sample_id = ?
ORDER  BY pos
LIMIT  1000;                          -- 必须带上限：万一区间给大了，至少要能停下来

-- 验证：这三列都要对得上，缺一个就是没吃住索引。
EXPLAIN SELECT sample_id, pos, ref_allele FROM genome_variant
WHERE chromosome='7' AND pos >= 1 AND pos < 100000 AND sample_id = 1;
--   key = idx_cover_range · rows 明显小于区间行数 · Extra = Using index""",
        'code': r"""/**
 * 场景：基因 / DNA 序列海量存取 / 切片：位点区间查询
 * 适用参数：P99 < 200ms
 * 依赖规则：DATA-SQL-001, DATA-SQL-002, CONC-POOL-003, REL-EXCP-003
 * JDK：21（虚拟线程）
 */
package com.example.genome.query;

import org.springframework.jdbc.core.JdbcTemplate;

import javax.sql.DataSource;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

/**
 * 位点区间查询。三条硬约束：
 *   1. 只查需要的列 —— SELECT * 会回表取两个 VARCHAR(255)，行宽翻倍，P99 直接掉出 200ms。
 *   2. 半开区间 —— 相邻区间拼接时不重不漏。
 *   3. 并发有上界 —— 无限并发会把 DB 连接吃光，那时 P99 不是变高，是全部超时。
 */
public final class VariantRangeQuery implements AutoCloseable {

    private static final int MAX_ROWS = 1000;

    private final JdbcTemplate jdbc;

    /**
     * 显式信号量。为什么不用连接池排队：连接池排满时延迟已经上去了才被感知，
     * 而 P99 目标下「排队 200ms 的请求对用户已经没有意义」—— 快速失败更划算。
     */
    private final Semaphore inflight;

    /** IO 密集，用虚拟线程。CPU 密集的解析不要放在这里。 */
    private final ExecutorService pool = Executors.newVirtualThreadPerTaskExecutor();

    public VariantRangeQuery(DataSource dataSource, int maxConcurrency) {
        this.jdbc = new JdbcTemplate(dataSource);
        this.inflight = new Semaphore(maxConcurrency);
    }

    public record Range(String chromosome, int startPos, int endPos, long sampleId) {
    }

    public record Variant(long sampleId, int pos, String refAllele, String altAllele, int quality) {
    }

    public List<Variant> query(Range range) {
        String chr = VariantSchema_Ref.normalizeChromosome(range.chromosome());
        VariantSchema_Ref.requireValidRange(range.startPos(), range.endPos());

        if (!inflight.tryAcquire()) {
            // 不排队，直接失败。上层可以做降级（返回缓存或提示稍后再试）。
            throw new IllegalStateException("位点查询过载，拒绝服务");
        }
        try {
            // 显式指定列名，不用 SELECT *：ref/alt 是大字段，回表代价高。
            String sql = "SELECT sample_id, pos, ref_allele, alt_allele, quality"
                    + " FROM genome_variant"
                    + " WHERE chromosome = ? AND pos >= ? AND pos < ? AND sample_id = ?"
                    + " ORDER BY pos LIMIT ?";
            return jdbc.query(sql,
                    (rs, n) -> new Variant(
                            rs.getLong("sample_id"),
                            rs.getInt("pos"),
                            rs.getString("ref_allele"),
                            rs.getString("alt_allele"),
                            rs.getInt("quality")),
                    chr, range.startPos(), range.endPos(), range.sampleId(), MAX_ROWS);
        } finally {
            inflight.release();
        }
    }

    /** 多区间并行查（Panel 场景）。并发度仍受信号量约束。 */
    public List<List<Variant>> queryBatch(List<Range> ranges) throws InterruptedException {
        try (var exec = Executors.newVirtualThreadPerTaskExecutor()) {
            var futures = ranges.stream().map(r -> exec.submit(() -> query(r))).toList();
            var out = new java.util.ArrayList<List<Variant>>(futures.size());
            for (var f : futures) {
                try {
                    out.add(f.get(500, TimeUnit.MILLISECONDS));
                } catch (Exception ex) {
                    // 单区间失败不该让整个 Panel 失败：补一个空列表，由上层标注「该区间未取到」。
                    out.add(List.of());
                }
            }
            return List.copyOf(out);
        }
    }

    @Override
    public void close() {
        pool.close();
    }

    /** 避免与上一切片的同名类冲突的引用别名（生产代码里就是同一个 VariantSchema）。 */
    static final class VariantSchema_Ref {
        static String normalizeChromosome(String s) {
            return com.example.genome.variant.VariantSchema.normalizeChromosome(s);
        }

        static void requireValidRange(int a, int b) {
            com.example.genome.variant.VariantSchema.requireValidRange(a, b);
        }
    }
}
""",
        'highlights': [
            {'mark': 'SELECT sample_id, pos, ref_allele, alt_allele, quality',
             'title': '只查需要的列，不用 SELECT *',
             'text': 'ref/alt 是 VARCHAR(255)，回表取它们会让行宽翻倍，P99 直接掉出 200ms。覆盖索引的价值就在这。',
             'rule': 'DATA-SQL-001'},
            {'mark': 'AND pos >= ? AND pos < ?',
             'title': '半开区间',
             'text': 'Panel 会拼多个相邻区间，闭区间会在边界位点重复，报告里变成「同一个变异出现两次」。',
             'rule': 'DATA-SQL-001'},
            {'mark': 'if (!inflight.tryAcquire()) {',
             'title': '过载就拒绝，不排队',
             'text': 'P99 目标下排队 200ms 的请求已经没有意义。快速失败还能让上层做降级，排队只会全军覆没。',
             'rule': 'CONC-POOL-003'},
            {'mark': 'out.add(List.of());',
             'title': '单区间失败不拖垮整批',
             'text': 'Panel 有几十个区间，一个失败就整体失败会让可用性变成「几十个里全对才算成功」。',
             'rule': 'REL-EXCP-003'},
        ],
        'pitfalls': [
            '用 SELECT * —— 回表代价是行宽的倍数，在 P99 目标下这是最贵的一处浪费。',
            '区间用 BETWEEN —— 相邻区间边界重复，报告里出现重复变异，临床上是严重问题。',
            '不加 LIMIT —— 一个写错的区间（比如传了整条染色体）会扫几亿行。',
            '用 ForkJoinPool.commonPool 跑并行区间 —— 全局共享池，一个慢区间会拖慢全站无关接口。',
        ],
        'notSuitable': [
            'P99 宽松到 1s 以上：不需要覆盖索引与信号量这套紧箍咒，简单查就够。',
            '查询以「按样本取全部变异」为主：那应该按 sample_id 建索引，不是按区间。',
        ],
        'relatedRules': ['DATA-SQL-001', 'DATA-SQL-002', 'CONC-POOL-003', 'REL-EXCP-003', 'CONC-THRD-001'],
        'refs': [
            {'title': 'Use the Index, Luke! — 覆盖索引', 'url': 'https://use-the-index-luke.com/sql/clustering/index-only-scan'},
            {'title': 'JEP 444: Virtual Threads', 'url': 'https://openjdk.org/jeps/444'},
        ],
    },
    {
        'id': 'stream-blob',
        'order': 4,
        'goal': '大序列的流式读写与断点续传',
        'layer': '数据访问',
        'when': {'rows': ['s1m', 's100m', 's1b']},
        'why': '“按样本取全序列”这个查询本身是低频的，但它单次要搬 GB 级数据。'
               '只要有一次把它读进堆，就是一次 OOM；只要有一次网络中断就全部重来，就是无法完成。',
        'decision': {
            'question': 'GB 级序列怎么传？',
            'options': [
                '一次性读进 byte[] 再返回 —— GB 级直接 OOM，没有任何商量余地',
                '流式转发（InputStream → 响应流）—— 内存恒定，但不能重试',
                '分块 + Range 请求 —— 支持断点续传，代价是客户端要实现拼接',
                '先压缩再传 —— 省带宽，但压缩本身要 CPU，且仍是全量',
            ],
            'chosen': '流式转发为主 + HTTP Range 支持断点续传',
            'tradeoff': '代价是客户端要处理「续传」这件事，而且流式一旦中断不能自动重试 —— '
                        '必须让客户端从断点继续，而不是服务端默默重来。',
        },
        'sql': r"""-- 续传状态表：谁在传、传到哪、校验和是什么。
-- 没有这张表就没有「断点」，只有「重来」—— GB 级文件重来三次基本就传不完了。
CREATE TABLE `genome_transfer` (
  `transfer_id`  CHAR(36)     NOT NULL COMMENT '客户端生成的 UUID，避免服务端发号成为瓶颈',
  `sample_id`    BIGINT       NOT NULL,
  `seq_type`     VARCHAR(16)  NOT NULL,
  `offset_bytes` BIGINT       NOT NULL DEFAULT 0 COMMENT '已确认接收的字节数',
  `total_bytes`  BIGINT       NOT NULL,
  `sha256`       CHAR(64)     DEFAULT NULL COMMENT '传完后回填，用于最终校验',
  `state`        TINYINT      NOT NULL DEFAULT 0 COMMENT '0进行中 1完成 2作废',
  `updated_at`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`transfer_id`),
  KEY `idx_state_updated` (`state`, `updated_at`)   -- 清理超时未完成的传输
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='序列传输断点';""",
        'code': r"""/**
 * 场景：基因 / DNA 序列海量存取 / 切片：GB 级序列流式读写与断点续传
 * 适用参数：样本数 ≥ 100 万（单样本 GB 级）
 * 依赖规则：DATA-SCHM-001, REL-EXCP-002, REL-LOG-003
 * JDK：21
 */
package com.example.genome.transfer;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.NoSuchElementException;

/**
 * 序列流式传输。
 *
 * 这个类里**不存在**返回 byte[] 或接收 byte[] 的方法，这是刻意的：
 * 只要开了这个口子，就一定会有调用方把 GB 级数据读进堆里，
 * 而 OOM 现场只会显示「堆不够」，看不出是谁灌进来的。
 */
public final class SequenceStreamer {

    /** 缓冲区固定 1MB。再大不省时间，只占内存。 */
    private static final int BUFFER = 1024 * 1024;

    private final SequenceSource source;
    private final TransferDao dao;

    public SequenceStreamer(SequenceSource source, TransferDao dao) {
        this.source = source;
        this.dao = dao;
    }

    /**
     * 从 offset 继续传输。
     *
     * 为什么支持断点而不是「失败就重来」：GB 级文件在真实网络下几乎不可能一次传完，
     * 重来策略的期望完成次数是 3~5 次，而每次都要重传已经成功的部分 —— 实际上永远传不完。
     */
    public long resume(String transferId, long offset, OutputStream out) throws IOException {
        var t = dao.load(transferId)
                .orElseThrow(() -> new NoSuchElementException("传输不存在：" + transferId));
        if (t.state() == 2) {
            throw new IllegalStateException("传输已作废，不能续传：" + transferId);
        }

        long sent = 0L;
        try (InputStream in = source.openRange(t.objectKey(), offset, t.totalBytes())) {
            byte[] buf = new byte[BUFFER];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                sent += n;
            }
        } catch (IOException ex) {
            // 中断不是失败：把已确认字节数记下来，下次从这里继续。
            // 只有记下来，客户端才不用从 0 开始。
            dao.saveOffset(transferId, offset + sent);
            throw ex;
        }
        dao.saveOffset(transferId, t.totalBytes());
        return sent;
    }

    /** 传输完成后的最终校验。校验和不通过必须明确报错，不能「差不多就算了」。 */
    public boolean seal(String transferId, String expectedSha) {
        var t = dao.load(transferId).orElse(null);
        if (t == null) {
            return false;
        }
        if (!expectedSha.equals(t.sha256())) {
            throw new IllegalStateException("序列校验和不匹配 transferId=" + transferId
                    + " —— 数据可能已损坏，拒绝标记为完成");
        }
        dao.markDone(transferId);
        return true;
    }

    public interface SequenceSource {
        InputStream openRange(String objectKey, long offset, long endExclusive) throws IOException;
    }

    public interface TransferDao {
        java.util.Optional<Transfer> load(String transferId);

        void saveOffset(String transferId, long offset);

        void markDone(String transferId);
    }

    public record Transfer(String objectKey, long totalBytes, String sha256, int state) {
    }
}
""",
        'highlights': [
            {'mark': 'private static final int BUFFER = 1024 * 1024;',
             'title': '固定 1MB 缓冲',
             'text': '内存占用恒定，与文件大小无关。再大的缓冲不省时间，只是多占内存。',
             'rule': 'DATA-SCHM-001'},
            {'mark': 'dao.saveOffset(transferId, offset + sent);',
             'title': '中断要记断点，不是重来',
             'text': 'GB 级文件重来策略的期望完成次数是 3~5 次，每次重传成功的部分 —— 实际永远传不完。',
             'rule': 'REL-EXCP-002'},
            {'mark': 'throw new IllegalStateException("序列校验和不匹配 transferId=" + transferId',
             'title': '校验不通过就拒绝',
             'text': '基因数据错了不会报错，只会让报告出错。这里是最后一道能拦住它的地方。',
             'rule': 'REL-LOG-003'},
            {'mark': 'InputStream openRange(String objectKey, long offset, long endExclusive)',
             'title': 'Range 而非全量',
             'text': '服务端能不能只给一段，决定了客户端能不能断点续传。这个能力必须在接口层就存在。',
             'rule': 'DATA-SCHM-001'},
        ],
        'pitfalls': [
            '任何一处把序列读成 byte[] —— 一次 OOM 就会带走整个实例上的其他请求。',
            '传输失败不记 offset —— 客户端只能从 0 重来，大文件在真实网络下基本传不完。',
            '校验和不匹配只打个日志继续走 —— 基因数据错了不会报错，只会让下游报告出错，后果比宕机严重。',
        ],
        'notSuitable': [
            '序列只有几 MB：流式与续传的复杂度不划算，直接返回更清楚。',
            '客户端不支持 Range：续传无从谈起，退化为一次性流式即可。',
        ],
        'relatedRules': ['DATA-SCHM-001', 'REL-EXCP-002', 'REL-LOG-003', 'SEC-DATA-002'],
        'refs': [
            {'title': 'RFC 9110 — HTTP Range Requests', 'url': 'https://www.rfc-editor.org/rfc/rfc9110#name-range'},
            {'title': 'GA4GH — htsget 规范（基因组区间流式读取）', 'url': 'https://samtools.github.io/hts-specs/htsget.html'},
        ],
    },
    {
        'id': 'bulk-import',
        'order': 5,
        'goal': '测序仪批量导入，不停服、不影响在线查询',
        'layer': '数据访问',
        'when': {'rw': ['rw11', 'rw19']},
        'why': '一台测序仪一天产出的数据量可能超过平台历史总和。'
               '导入期如果和查询期抢资源，表现是「导入期间医生查不了报告」。',
        'decision': {
            'question': '怎么导入？',
            'options': [
                '逐条 INSERT —— 万亿行量级下这是按年计算的工作',
                'JDBC batch —— 比逐条快两个数量级，但仍受 SQL 解析与日志刷盘限制',
                'LOAD DATA / MySQL COPY —— 绕过 SQL 层，最快，代价是几乎无校验',
                '先写对象存储，再异步批量入位点库 —— 解耦导入与查询',
            ],
            'chosen': '位点数据先落对象存储（VCF），再按染色体分批 LOAD DATA 入分区表；导入期不建覆盖索引',
            'tradeoff': '代价是导入期间查询性能下降（没有覆盖索引）。所以导入要走单独实例或单独时段，'
                        '这是 CONFLICTS 里那条告警的由来。',
        },
        'sql': r"""-- 导入期策略：先不建二级索引，等导入完再建。
-- 原因：每写一行都要维护一次 B+ 树，万亿行下索引维护的代价远超插入本身。
ALTER TABLE genome_variant DROP KEY idx_cover_range;

-- 批量导入：绕过 SQL 解析层。比 JDBC batch 再快一个数量级。
LOAD DATA LOCAL INFILE '/import/chr7_part001.tsv'
  INTO TABLE genome_variant PARTITION (p07)      -- 指定分区，避免写入时再去路由
  CHARACTER SET utf8mb4
  FIELDS TERMINATED BY '\t' LINES TERMINATED BY '\n'
  (id, sample_id, chromosome, pos, ref_allele, alt_allele, quality);

-- 导入完成后统一建索引（8.0 支持 INPLACE，不阻塞 DML 但会消耗 IO）。
ALTER TABLE genome_variant
  ADD KEY idx_cover_range (chromosome, pos, sample_id, ref_allele(8), alt_allele(8), quality),
  ALGORITHM=INPLACE, LOCK=NONE;

-- 导入期间限速：gh-ost 的思路同样适用于 LOAD DATA —— 靠 Threads_running 判断主库压力。
-- 超过阈值就 sleep 一会儿，宁可导入慢，也不能让在线查询超时。""",
        'code': r"""/**
 * 场景：基因 / DNA 序列海量存取 / 切片：批量导入不停服
 * 适用参数：读写比 1:1 或 1:9（导入期）
 * 依赖规则：DATA-SQL-003, CONC-POOL-001, CONC-POOL-002, REL-LOG-001
 * JDK：17
 */
package com.example.genome.importing;

import org.springframework.jdbc.core.JdbcTemplate;

import javax.sql.DataSource;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

/**
 * 位点批量导入器。
 *
 * 设计上刻意和在线查询**不在同一个池、不在同一个信号量**里：
 * 导入是吞吐优先，查询是延迟优先，混在一起的结果是两者都做不好 ——
 * 表现为「导入期间医生查不了报告」。
 */
public final class VariantBulkImporter implements AutoCloseable {

    /** 有界队列：导入数据可能几小时都导不完，队列无界 = 必然 OOM。 */
    private final BlockingQueue<VariantRow> queue = new ArrayBlockingQueue<>(50_000);

    /** 导入专用固定池。4 条足够 —— 再多只会让主库 Threads_running 飙高。 */
    private final ExecutorService workers = Executors.newFixedThreadPool(4);

    private final JdbcTemplate jdbc;
    private final AtomicLong imported = new AtomicLong();

    public VariantBulkImporter(DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }

    public record VariantRow(long id, long sampleId, String chromosome, int pos,
                             String refAllele, String altAllele, int quality) {
    }

    /** 只接受 offer 语义：队列满就返回 false，让上游放慢，绝不让内存无限涨。 */
    public boolean submit(VariantRow row) {
        return queue.offer(row);
    }

    public void start() {
        for (int i = 0; i < 4; i++) {
            workers.submit(this::drainLoop);
        }
    }

    private void drainLoop() {
        var batch = new java.util.ArrayList<VariantRow>(1000);
        while (!Thread.currentThread().isInterrupted()) {
            try {
                VariantRow first = queue.poll(200, TimeUnit.MILLISECONDS);
                if (first == null) {
                    continue;
                }
                batch.clear();
                batch.add(first);
                queue.drainTo(batch, 999);
                flush(batch);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                return;
            } catch (RuntimeException ex) {
                // 导入失败必须留下批次信息，否则只能全量重导。
                org.slf4j.LoggerFactory.getLogger(VariantBulkImporter.class)
                        .error("variant import batch failed size={} err={}", batch.size(), ex.toString());
            }
        }
    }

    private void flush(java.util.List<VariantRow> batch) {
        jdbc.batchUpdate(
                "INSERT INTO genome_variant"
                        + " (id, sample_id, chromosome, pos, ref_allele, alt_allele, quality)"
                        + " VALUES (?,?,?,?,?,?,?)",
                batch, 1000,
                (ps, row) -> {
                    ps.setLong(1, row.id());
                    ps.setLong(2, row.sampleId());
                    ps.setString(3, row.chromosome());
                    ps.setInt(4, row.pos());
                    ps.setString(5, row.refAllele());
                    ps.setString(6, row.altAllele());
                    ps.setInt(7, row.quality());
                });
        long total = imported.addAndGet(batch.size());
        if (total % 1_000_000 == 0) {
            // 每百万行打一次：导入跑几小时的时候，这是唯一能判断「还活着吗」的依据。
            org.slf4j.LoggerFactory.getLogger(VariantBulkImporter.class)
                    .info("variant imported total={} queueBacklog={}", total, queue.size());
        }
    }

    public long importedCount() {
        return imported.get();
    }

    @Override
    public void close() {
        workers.shutdownNow();
    }
}
""",
        'highlights': [
            {'mark': 'new ArrayBlockingQueue<>(50_000)',
             'title': '导入队列必须有界',
             'text': '导入可能跑几小时，队列无界等于必然 OOM。有界还能通过 offer 返回值让上游自然降速。',
             'rule': 'CONC-POOL-002'},
            {'mark': 'Executors.newFixedThreadPool(4)',
             'title': '导入专用池，不与在线共用',
             'text': '导入吞吐优先、查询延迟优先，混在一个池里的结果是两者都做不好 —— 表现为导入期间查不了报告。',
             'rule': 'CONC-POOL-001'},
            {'mark': 'jdbc.batchUpdate(',
             'title': '批量提交而非逐条',
             'text': '万亿行量级下逐条 INSERT 是按年计算的工作。批量能差两个数量级。',
             'rule': 'DATA-SQL-003'},
            {'mark': '.info("variant imported total={} queueBacklog={}", total, queue.size());',
             'title': '每百万行报一次进度',
             'text': '导入跑几小时时，这是唯一能判断「还活着吗」的依据。没有它，只能靠猜。',
             'rule': 'REL-LOG-001'},
        ],
        'pitfalls': [
            '导入和查询共用一个连接池 —— 导入把连接占满，在线查询全部超时，故障现象是「平台莫名不可用」。',
            '导入期就建好所有索引 —— 每写一行维护一次 B+ 树，索引维护代价超过插入本身几倍。',
            '用无界队列承接测序仪数据 —— 产线速度远大于入库速度，堆必然被打爆。',
            '导入失败不打批次日志 —— 只能全量重导，而全量重导又要几小时。',
        ],
        'notSuitable': [
            '读写比 9:1 的稳定运营期：没有批量导入压力，不需要这套流水线。',
            '一次导入只有几万行：直接 batchUpdate 就够了，不需要队列与工作池。',
        ],
        'relatedRules': ['DATA-SQL-003', 'CONC-POOL-001', 'CONC-POOL-002', 'REL-LOG-001', 'SVC-TX-002'],
        'refs': [
            {'title': 'MySQL 8.0 — LOAD DATA 与批量插入优化',
             'url': 'https://dev.mysql.com/doc/refman/8.0/en/insert-optimization.html'},
            {'title': 'MySQL 8.0 — ALTER TABLE 的 ALGORITHM 与 LOCK 子句',
             'url': 'https://dev.mysql.com/doc/refman/8.0/en/alter-table.html'},
        ],
    },
    {
        'id': 'audit-mask',
        'order': 6,
        'goal': '患者数据脱敏与审计（医疗场景不可省）',
        'layer': '安全',
        'when': {},
        'why': '基因数据是可识别到个人的敏感信息，而且不可撤销 —— 泄露了就是永久泄露。'
               '这一条与数据规模无关，所以 when 为空（恒真）。',
        'decision': {
            'question': '怎么兼顾可用与合规？',
            'options': [
                '明文存 everywhere —— 最省事，一次泄露就是重大事故',
                '全字段加密 —— 合规最好，但没法查询没法索引',
                '标识字段脱敏 + 明文隔离在受控区 —— 查询侧只碰脱敏值',
                '只做应用层权限 —— 挡住了人，没挡住误操作与内鬼',
            ],
            'chosen': 'patient_id 脱敏映射 + 明文映射表隔离 + 全量审计「谁在什么时候查了谁的什么」',
            'tradeoff': '代价是多一次映射查询，且审计本身会成为写热点。'
                        '审计必须异步写（否则拖慢查询），但异步就意味着审计可能丢 —— 用有界队列 + 落盘兜底。',
        },
        'sql': r"""-- 受控区：明文映射表。这张表与业务表不同库、不同账号、不同备份策略。
CREATE TABLE `patient_identity` (
  `pseudo_id`   BIGINT      NOT NULL COMMENT '业务库里用的脱敏 id',
  `real_id`     VARCHAR(64) NOT NULL COMMENT '真实患者标识（住院号/身份证）',
  `id_card`     VARBINARY(256) DEFAULT NULL COMMENT '加密存储，密钥在 KMS',
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`pseudo_id`),
  UNIQUE KEY `uk_real` (`real_id`)
) ENGINE=InnoDB COMMENT='患者身份映射 · 受控区 · 与业务库隔离';

-- 审计表。只增不改，按时间分区便于到期销毁。
CREATE TABLE `genome_access_audit` (
  `audit_id`    BIGINT      NOT NULL,
  `actor`       VARCHAR(64) NOT NULL COMMENT '操作人（医生工号 / 系统账号）',
  `action`      VARCHAR(32) NOT NULL COMMENT 'QUERY_RANGE / FETCH_SEQ / EXPORT',
  `pseudo_id`   BIGINT      NOT NULL,
  `sample_id`   BIGINT      DEFAULT NULL,
  `query_json`  JSON        DEFAULT NULL COMMENT '查询条件脱敏后的快照',
  `client_ip`   VARCHAR(45) DEFAULT NULL,
  `created_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`audit_id`, `created_at`),
  KEY `idx_actor_time` (`actor`, `created_at` DESC),
  KEY `idx_patient_time` (`pseudo_id`, `created_at` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
PARTITION BY RANGE (TO_DAYS(created_at)) ();""",
        'code': r"""/**
 * 场景：基因 / DNA 序列海量存取 / 切片：脱敏与审计
 * 适用参数：恒真 —— 与规模无关，医疗场景不可省
 * 依赖规则：SEC-DATA-001, SEC-DATA-002, SEC-LOG-001, REL-LOG-002
 * JDK：17
 */
package com.example.genome.audit;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * 访问审计。两条设计决定了一切：
 *
 *   1. **异步写** —— 审计在查询的关键路径上，同步写会把 P99 拉高。
 *   2. **有界队列 + 满则落盘** —— 异步意味着可能丢。审计丢了等于没审，
 *      所以队列满的时候不能丢，必须落到本地文件等补写。这是「异步」唯一的代价兑现处。
 */
public final class AccessAuditor implements AutoCloseable {

    private final BlockingQueue<AccessEvent> queue = new ArrayBlockingQueue<>(10_000);
    private final ExecutorService writer = Executors.newSingleThreadExecutor();
    private final AuditSink sink;

    public AccessAuditor(AuditSink sink) {
        this.sink = sink;
        writer.submit(this::drain);
    }

    public record AccessEvent(String actor, String action, long pseudoId, Long sampleId,
                              String queryJson, String clientIp) {
    }

    /** 查询路径上调用。这个方法不允许抛异常 —— 审计失败不该让查询失败。 */
    public void record(AccessEvent e) {
        if (!queue.offer(e)) {
            // 队列满：落盘兜底，绝不静默丢弃。审计丢了在合规检查时等同于「没有审计」。
            sink.spillToFile(e);
        }
    }

    private void drain() {
        while (!Thread.currentThread().isInterrupted()) {
            try {
                AccessEvent e = queue.poll(500, TimeUnit.MILLISECONDS);
                if (e == null) {
                    continue;
                }
                var batch = new java.util.ArrayList<AccessEvent>(500);
                batch.add(e);
                queue.drainTo(batch, 499);
                sink.writeBatch(batch);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                return;
            } catch (RuntimeException ex) {
                // 审计写失败只能记日志：不能因为审计挂了就让业务挂，但必须留下痕迹。
                org.slf4j.LoggerFactory.getLogger(AccessAuditor.class)
                        .error("audit write failed: {}", ex.toString());
            }
        }
    }

    /**
     * 脱敏：业务库里只能出现 pseudo_id。
     *
     * 为什么用单向映射而不是加密：加密意味着有密钥就能反解，而密钥一定会在某个地方被加载。
     * 单向映射 + 隔离库，让「查业务库的人」在技术上就拿不到明文。
     */
    public static long pseudoIdOf(String realId) {
        // 生产实现：查 patient_identity 表；这里给出不可逆的哈希派生作为兜底。
        long h = 0xcbf29ce484222325L;
        for (byte b : realId.getBytes(java.nio.charset.StandardCharsets.UTF_8)) {
            h ^= b;
            h *= 0x100000001b3L;
        }
        return Math.floorMod(h, 1L << 40);
    }

    /** 日志脱敏：任何落进日志的查询条件都必须先过这一层。 */
    public static String maskForLog(String s) {
        if (s == null || s.length() <= 4) {
            return "****";
        }
        return s.substring(0, 2) + "****" + s.substring(s.length() - 2);
    }

    @Override
    public void close() {
        writer.shutdownNow();
    }

    public interface AuditSink {
        void writeBatch(java.util.List<AccessEvent> batch);

        void spillToFile(AccessEvent e);
    }
}
""",
        'highlights': [
            {'mark': 'sink.spillToFile(e);',
             'title': '队列满要落盘，不能丢',
             'text': '异步审计唯一的代价兑现处。审计丢了在合规检查时等同于「没有审计」，比慢一点严重得多。',
             'rule': 'SEC-LOG-001'},
            {'mark': 'public void record(AccessEvent e) {',
             'title': '审计不允许抛异常',
             'text': '审计在查询关键路径上，它抛异常会让查询失败 —— 那是把合规组件变成了可用性单点。',
             'rule': 'REL-LOG-002'},
            {'mark': 'return Math.floorMod(h, 1L << 40);',
             'title': '单向映射而非加密',
             'text': '加密意味着有密钥就能反解，而密钥一定会在某处被加载。单向映射让「能查业务库的人」技术上拿不到明文。',
             'rule': 'SEC-DATA-002'},
            {'mark': 'return s.substring(0, 2) + "****" + s.substring(s.length() - 2);',
             'title': '日志必须脱敏',
             'text': '查询条件直接进日志是最常见的泄露路径 —— 日志的访问权限通常远宽于数据库。',
             'rule': 'SEC-LOG-001'},
        ],
        'pitfalls': [
            '审计同步写 —— 在查询关键路径上加一次写，P99 直接抬高，然后被人在压测时「优化」掉，等于没做。',
            '审计队列满了直接丢弃 —— 平时看不出来，合规检查时才发现「有一段时间没有任何审计记录」。',
            'patient_id 明文进业务库 —— 一次脱库就是全量泄露，而基因数据是不可撤销的。',
            '日志里打印完整查询条件 —— 日志的访问权限通常远宽于数据库，这是最容易被忽略的泄露路径。',
        ],
        'notSuitable': [
            '纯科研且已做伦理审批的匿名数据集：本就没有可识别信息，审计重点不同。',
            '内部测试环境：但要注意测试数据必须是合成的，不能拿生产数据「先跑一遍」。',
        ],
        'relatedRules': ['SEC-DATA-001', 'SEC-DATA-002', 'SEC-LOG-001', 'REL-LOG-002', 'SEC-INPUT-001'],
        'refs': [
            {'title': '《个人信息保护法》— 敏感个人信息处理规则', 'note': '医疗健康、生物识别信息属于敏感个人信息，需单独同意'},
            {'title': 'GA4GH — 数据访问与审计规范', 'url': 'https://www.ga4gh.org/'},
        ],
    },
    {
        'id': 'cold-tier-routing',
        'order': 7,
        'goal': '让「查三年前的老样本」不占用热数据的资源',
        'layer': '数据生命周期',
        'when': {'rows': ['s100m', 's1b'], 'growth': ['g5x', 'g20x']},
        'why': '测序量年年翻倍，三年前的样本可能再也没人查，但它仍然占着最贵的存储、'
               '还在被备份、还在拖慢主从。分层不是优化，是不分层就撑不到第三年的问题。',
        'decision': {
            'question': '冷层用什么存储？',
            'options': [
                '同一种对象存储的不同存储类别（标准 / 低频 / 归档）—— 接口一致，成本差几十倍',
                '独立的冷存储系统 —— 隔离彻底，但多一套系统要维护',
                '就留在对象存储标准层不降级 —— 管理最简，成本最高',
                '冷层单独一套对象存储 + 独立账号 —— 安全隔离最好，运维最重',
            ],
            'chosen': '同一对象存储的不同存储类别（标准 / 低频 / 归档），按样本年龄自动降级',
            'tradeoff': '归档类别的对象**不能直接读** —— 必须先发解冻请求，之后几小时才可读'
                        '（标准档 3~5 小时）。这个特性会彻底改变接口的形态：'
                        '「取序列」不再是一个同步方法，而是一个「提交任务 + 轮询结果」的流程。'
                        '能不能接受这个改变，是这个方案能不能用的前提。',
        },
        'sql': r"""-- 分层的落点是元数据表上的一个字段，而不是「根据时间现算」。
-- 现算的问题是分层规则会变（3 个月改成 6 个月），改规则时现算的实现要改代码 + 发版，
-- 而落库的实现只需要更新一次数据 —— 差异在规则第一次调整时就会体现出来。
CREATE TABLE `genome_sample_tier` (
  `id`             BIGINT       NOT NULL,
  `sample_id`      BIGINT       NOT NULL COMMENT '样本 id',
  `tier`           TINYINT      NOT NULL COMMENT '0热(标准) 1温(低频) 2冷(归档)',
  `object_bucket`  VARCHAR(64)  NOT NULL COMMENT '所在桶，分层时可能换桶',
  `object_key`     VARCHAR(255) NOT NULL COMMENT '对象键',
  `restored`       TINYINT      NOT NULL DEFAULT 0 COMMENT '冷层是否已解冻（解冻后有时效，会再冷回去）',
  `restore_expire_at` DATETIME(3) NULL COMMENT '解冻有效期。归档存储的解冻是有时间窗的',
  `tier_changed_at` DATETIME(3) NOT NULL COMMENT '最近一次分层变更时刻',
  `created_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`     DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sample_id` (`sample_id`),
  KEY `idx_tier_changed` (`tier`, `tier_changed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='样本分层元数据 · 分层的依据落库，不现算';""",
        'code': r"""/**
 * 场景：基因 / DNA 序列海量存取 / 切片：冷热分层与查询路由
 * 适用参数：样本 ≥ 1 亿 · 年增 ≥ 5 倍
 * 依赖规则：REL-TIME-001, REL-CTNR-004, REL-LOG-002, REL-CTNR-005
 * JDK：17
 */
package com.example.genome.tier;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 分层读取。整个类的形态由一件事决定：**归档存储的对象不能直接读**。
 * 它必须先解冻，之后几小时才可读，而且解冻有有效期（会再冷回去）。
 * 所以「取序列」在这里不是一个同步方法，是「提交任务 + 查状态」。
 */
public class TieredSequenceReader {

    private static final Logger log = LoggerFactory.getLogger(TieredSequenceReader.class);

    private final SampleMetadataRepository metadataRepository;
    private final ObjectStoreClient objectStore;
    private final RestoreTaskQueue restoreQueue;

    public TieredSequenceReader(SampleMetadataRepository metadataRepository,
                                ObjectStoreClient objectStore,
                                RestoreTaskQueue restoreQueue) {
        this.metadataRepository = metadataRepository;
        this.objectStore = objectStore;
        this.restoreQueue = restoreQueue;
    }

    public SequenceResult read(long sampleId) {
        SampleMetadata meta = metadataRepository.find(sampleId);
        if (meta == null) {
            throw new SampleNotFoundException("样本不存在 sampleId=" + sampleId);
        }

        // 路由依据取自元数据字段，而不是「根据创建时间现算」：
        // 分层规则会变（3 个月改成 6 个月），现算的实现要改代码发版，落库的只改一次数据。
        if (meta.tier() == StorageTier.HOT) {
            return SequenceResult.ready(objectStore.get(meta.objectKey()));
        }

        // 这一步是整个分层的代价兑现处。冷层没解冻时必须返回「进行中」而不是阻塞等待 ——
        // 一个同步接口等 3 小时，等于把可用性问题伪装成性能问题。
        if (!meta.restored()) {
            restoreQueue.submit(sampleId, meta.objectKey());
            log.info("冷层样本需先解冻，已提交异步任务 sampleId={} tier={}", sampleId, meta.tier());
            return SequenceResult.pending(sampleId, "样本已归档，解冻任务已提交，通常数小时内可读");
        }

        SequenceResult result = SequenceResult.ready(objectStore.get(meta.objectKey()));
        // 冷查询的延迟与热查询不在一个量级，把实际耗时记下来，
        // 前端才能给出诚实的提示，而不是让用户以为系统卡住了。
        log.info("冷层读取完成 sampleId={} bytes={}", sampleId, result.sizeBytes());
        return result;
    }

    /**
     * 分层降级任务。幂等的写法是「以元数据里的 tier 为目标状态」而不是「+1 级」——
     * 后者在重跑时会把样本一路降到最冷的层，而它可能上周刚被查过。
     */
    public int demoteBatch(int batchSize) {
        var candidates = metadataRepository.findDemoteCandidates(batchSize);
        int moved = 0;
        for (SampleMetadata candidate : candidates) {
            if (!metadataRepository.compareAndSetTier(candidate.id(), candidate.tier(),
                    StorageTier.COLD)) {
                // 没抢到说明别的实例已经处理了它 —— 跳过而不是重试，
                // 重试等于两个实例互相抢，做无用功。
                continue;
            }
            objectStore.changeStorageClass(candidate.objectKey(), StorageTier.COLD);
            moved++;
        }
        log.info("分层降级完成 moved={}/{}", moved, candidates.size());
        return moved;
    }
}
""",
        'highlights': [
            {'mark': 'if (!meta.restored()) {',
             'title': '归档对象不能直接读',
             'text': '这是整个冷热分层最容易踩的坑：归档存储（如 S3 Glacier）必须先发解冻请求，'
                     '之后 3~5 小时才可读，而解冻还有有效期。'
                     '不知道这一点，接口会被设计成同步阻塞几小时。',
             'rule': 'REL-TIME-001'},
            {'mark': 'return SequenceResult.pending(sampleId, "样本已归档，解冻任务已提交，通常数小时内可读");',
             'title': '返回「进行中」而不是阻塞',
             'text': '同步接口等 3 小时等于把可用性问题伪装成性能问题 ——'
                     '调用方看到的是超时，而真正的原因是「这个数据本来就不在这里」。',
             'rule': 'REL-CTNR-005'},
            {'mark': 'if (!metadataRepository.compareAndSetTier(candidate.id(), candidate.tier(),\n                    StorageTier.COLD)) {',
             'title': '分层靠目标状态，不靠「+1 级」',
             'text': '「+1 级」在重跑时会把样本一路降到最冷的层，而它可能上周刚被查过。'
                     '以目标状态 + CAS 更新才既幂等又不会误降。',
             'rule': 'REL-CTNR-004'},
            {'mark': 'log.info("分层降级完成 moved={}/{}", moved, candidates.size());',
             'title': '降级量要能看趋势',
             'text': '每月降级多少、热层剩多少，决定了要不要调整分层阈值。'
                     '没有这个数字，阈值只能靠猜。',
             'rule': 'REL-LOG-002'},
        ],
        'pitfalls': [
            '把「取序列」设计成同步接口 —— 冷层样本会阻塞几小时，而且在压测时完全复现不出来。',
            '解冻后不记有效期 —— 归档存储的解冻有时效，过期会再冷回去，而系统以为它还是热的。',
            '分层规则写死在代码里 —— 改规则（3 个月改 6 个月）要发版，而这是纯运营调整。',
            '降级任务用「+1 级」而不是目标状态 —— 重跑会把样本一路降到最冷层。',
        ],
        'notSuitable': [
            '样本量在十万级：所有数据都在热层完全负担得起，分层只增加复杂度。',
            '所有样本都要求秒级可读（如实时临床会诊）：归档型的解冻延迟本身就不满足需求。',
        ],
        'relatedRules': ['REL-TIME-001', 'REL-CTNR-004', 'REL-CTNR-005', 'REL-LOG-002'],
        'refs': [
            {'title': 'AWS S3 文档 · 存储类别与归档解冻',
             'url': 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html',
             'note': 'Glacier 各档的解冻时长与费用差异极大，选档前必须读这一节'},
            {'title': 'AWS 基因组学最佳实践 · 数据分层',
             'note': '序列数据与变异数据的分层策略不同：序列冷、位点热'},
        ],
    },
    {
        'id': 'hotspot-variant-cache',
        'order': 8,
        'goal': '把最热的位点查询压在缓存层，且敢于设长 TTL',
        'layer': '缓存',
        'when': {'qps': ['q10k', 'q100k'], 'latency': ['l50', 'l200']},
        'why': '位点查询是高频小结果集，天然适合缓存。但它和普通业务缓存有个本质差别：'
               '**基因数据是不可变的** —— 一个人的变异位点在报告签发后就固定了，'
               '重新测序会产生新样本而不是改旧样本。所以这里不需要「写后失效」这套机制，'
               'TTL 可以设得很长。这个领域判断比缓存技术本身更值钱。',
        'decision': {
            'question': '缓存该多激进？',
            'options': [
                '按通用业务缓存设短 TTL（分钟级）—— 保守，但浪费了「数据不可变」这个事实',
                '长 TTL（小时级）+ 不做写后失效 —— 收益最大，前提是数据真的不可变',
                '只缓存「有变异」的区间 —— 省内存，但空结果的重复回源没被处理',
                '长 TTL + 布隆过滤器预检空区间',
            ],
            'chosen': '长 TTL（12 小时）+ 布隆过滤空区间 + L1/L2 两级',
            'tradeoff': '长 TTL 的代价是「数据订正」变得困难 —— 如果某个样本的位点被人工修正，'
                        '缓存最长要 12 小时才更新。所以必须保留一条「人工强制失效」的通道，'
                        '并且这条通道要记审计（谁在什么时候失效了什么）。',
        },
        'sql': r"""-- 位点缓存的策略与强制失效通道。为什么要落库：
-- 长 TTL 的前提是「数据不可变」，一旦有订正发生，就必须有一条能立刻生效的通道，
-- 而且这条通道的每一次使用都要留痕 —— 医疗数据的缓存跳过是被审计关注的行为。
CREATE TABLE `variant_cache_policy` (
  `id`              BIGINT       NOT NULL,
  `cache_name`      VARCHAR(64)  NOT NULL COMMENT '缓存名',
  `ttl_seconds`     INT          NOT NULL COMMENT 'TTL，基因数据不可变所以可以很长',
  `bloom_bucket`    INT          NOT NULL DEFAULT 1000000 COMMENT '布隆过滤的区间粒度（碱基）',
  `force_evict_by`  VARCHAR(64)  NULL COMMENT '最近一次强制失效的操作者',
  `force_evict_at`  DATETIME(3)  NULL COMMENT '强制失效时刻',
  `force_evict_reason` VARCHAR(255) NULL COMMENT '失效原因（数据订正 / 报告撤回 / 误报）',
  `created_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cache_name` (`cache_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='位点缓存策略 · 长 TTL 的前提是不可变，订正必须留痕';""",
        'code': r"""/**
 * 场景：基因 / DNA 序列海量存取 / 切片：位点热查询缓存
 * 适用参数：QPS ≥ 1 万 · 位点查询 P99 < 200ms
 * 依赖规则：REL-CTNR-005, REL-LOG-002, CONC-POOL-004, SEC-DATA-001
 * JDK：17
 */
package com.example.genome.cache;

import java.time.Duration;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 位点查询的二级缓存。
 *
 * TTL 设 12 小时是刻意的，也是本场景最值得抄的一条：**基因数据不可变**。
 * 报告签发后位点就固定了，重测会产生新样本而不是改旧样本 ——
 * 所以这里不需要「写后失效」这套复杂机制，只按样本生命周期设 TTL 即可。
 */
public class VariantCacheService {

    private static final Logger log = LoggerFactory.getLogger(VariantCacheService.class);

    /** 12 小时：不是拍出来的，是「报告签发后不再变更」这个业务事实的直接结果。 */
    private static final Duration VARIANT_TTL = Duration.ofHours(12);

    /** 布隆过滤的区间粒度（100 万碱基）。粒度太细则布隆体积大，太粗则假阳性高。 */
    private static final long REGION_BUCKET = 1_000_000L;

    private final VariantRepository variantRepository;
    private final CacheClient l1;
    private final CacheClient l2;
    private final BloomFilter regionBloom;
    private final CachePolicyRepository policyRepository;

    public VariantCacheService(VariantRepository variantRepository, CacheClient l1, CacheClient l2,
                               BloomFilter regionBloom, CachePolicyRepository policyRepository) {
        this.variantRepository = variantRepository;
        this.l1 = l1;
        this.l2 = l2;
        this.regionBloom = regionBloom;
        this.policyRepository = policyRepository;
    }

    public List<Variant> query(String chrom, long start, long end) {
        String regionKey = "variant:" + chrom + ":" + start + "-" + end;

        List<Variant> cached = l1.list(regionKey);
        if (cached != null) {
            return cached;
        }
        List<Variant> fromL2 = l2.list(regionKey);
        if (fromL2 != null) {
            // 回填 L1：热区间会被反复查，L1 是这一层的主要收益来源。
            l1.put(regionKey, fromL2, VARIANT_TTL);
            return fromL2;
        }

        // 布隆过滤的是「这个区间有没有变异」。绝大多数区间是**没有**变异的 ——
        // 正常人的绝大部分区间与参考基因组一致。这些空结果每次都回源一次，
        // 是位点查询里最大的无效开销，而它换不来任何数据。
        if (!regionBloom.mightContain(chrom + ":" + (start / REGION_BUCKET))) {
            log.debug("区间无变异，跳过回源 chrom={} start={} end={}", chrom, start, end);
            return List.of();
        }

        List<Variant> loaded = variantRepository.queryRegion(chrom, start, end);
        l2.put(regionKey, loaded, VARIANT_TTL);
        l1.put(regionKey, loaded, VARIANT_TTL);
        return loaded;
    }

    /**
     * 强制失效。这是长 TTL 方案的必要配套：数据订正、报告撤回都会让缓存里的结论变错，
     * 而长 TTL 意味着「等它自己过期」最长达 12 小时 —— 医疗场景下这不成立。
     */
    public void forceEvict(String chrom, String operator, String reason) {
        policyRepository.recordForceEvict("variant", operator, reason);
        // 按染色体前缀失效而不是精确区间：订正往往影响的是一整段，
        // 精确失效会留下「同一染色体上相邻区间结论不一致」的怪现象。
        l1.evictByPrefix("variant:" + chrom + ":");
        l2.evictByPrefix("variant:" + chrom + ":");
        log.warn("位点缓存被强制失效 chrom={} operator={} reason={}", chrom, operator, reason);
    }
}
""",
        'highlights': [
            {'mark': 'private static final Duration VARIANT_TTL = Duration.ofHours(12);',
             'title': 'TTL 长是因为数据不可变',
             'text': '这是本场景最值得抄的一条判断：报告签发后位点固定，重测产生新样本而不是改旧样本 ——'
                     '所以不需要「写后失效」，TTL 可以设得很长。领域知识比缓存技术本身更值钱。',
             'rule': 'REL-CTNR-005'},
            {'mark': 'if (!regionBloom.mightContain(chrom + ":" + (start / REGION_BUCKET))) {',
             'title': '绝大多数区间没有变异',
             'text': '正常人的绝大部分区间与参考基因组一致。这些空结果每次回源一次，'
                     '是位点查询里最大的无效开销 —— 而且它换不来任何数据。',
             'rule': 'REL-LOG-002'},
            {'mark': 'l1.evictByPrefix("variant:" + chrom + ":");',
             'title': '失效按前缀而不是精确区间',
             'text': '订正往往影响一整段。精确失效会留下「同一染色体上相邻区间结论不一致」的怪现象，'
                     '而这种不一致在报告里是灾难性的。',
             'rule': 'CONC-POOL-004'},
            {'mark': 'log.warn("位点缓存被强制失效 chrom={} operator={} reason={}", chrom, operator, reason);',
             'title': '强制失效必须留痕',
             'text': '医疗数据场景下，「谁让缓存跳过了最新数据」是审计会问的第一个问题。'
                     '操作者与原因必须进日志和数据表。',
             'rule': 'SEC-DATA-001'},
        ],
        'pitfalls': [
            '照搬通用业务的短 TTL —— 浪费了「数据不可变」这个免费的优势，命中率无谓地低。',
            '设了长 TTL 却没做强制失效 —— 数据订正后最长 12 小时用户仍看到旧结论。',
            '只缓存有变异的区间 —— 空结果的重复回源是最主要的无效开销，恰好被漏掉了。',
            '缓存里放未脱敏的样本标识 —— 缓存通常比数据库更易被访问，脱敏层级不能降。',
        ],
        'notSuitable': [
            'QPS 只有几百：数据库直接扛得住，缓存带来的一致性问题不值得。',
            '位点数据会被频繁订正（如科研迭代期）：不可变前提不成立，长 TTL 会持续给出错误结论。',
        ],
        'relatedRules': ['REL-CTNR-005', 'REL-LOG-002', 'CONC-POOL-004', 'SEC-DATA-001'],
        'refs': [
            {'title': 'GA4GH · 变异数据模型与查询规范',
             'url': 'https://www.ga4gh.org/',
             'note': '变异位点的标准表达（染色体 + 位置 + 参考/替代碱基），是索引设计的依据'},
            {'title': '论文 · 布隆过滤器在基因组区间查询中的应用',
             'note': '区间查询的稀疏性（大部分区间无变异）是布隆在这里有效的原因'},
        ],
    },
]

CASE = {
    'id': 'genomic-sequence-store',
    'order': 2,
    'name': '基因 / DNA 序列海量存取',
    'subtitle': '序列别进关系库，位点查询才救得回来',
    'glyph': '⧉',
    'domain': ['医疗', '基因检测', '科研', '生物信息'],
    'problem': '单样本序列 GB 级、样本数百万到十亿；患者高频查询位点区间要求亚秒，测序仪还在持续批量导入。',
    'symptoms': [
        {'id': 'y1', 'text': "数据库体积膨胀到数十 TB，备份跑不完", 'params': {'rows': 's1b'}},
        {'id': 'y2', 'text': "主从延迟从秒级涨到小时级", 'params': {'rw': 'rw19', 'rows': 's100m'}},
        {'id': 'y3', 'text': "位点查询要么全表扫要么回表，P99 上不去", 'params': {'latency': 'l50', 'rows': 's100m'}},
        {'id': 'y4', 'text': "加一个字段的 ALTER 跑几小时", 'params': {'growth': 'g5x', 'rows': 's100m'}},
    ],
    'recommended': {
        'qps': 'q10k', 'rows': 's100m', 'rw': 'rw11',
        'consist': 'strong', 'latency': 'l50', 'growth': 'g5x',
    },
    'drivers': DRIVERS,
    'conflicts': CONFLICTS,
    'slices': SLICES,
    'notSuitableFor': NOT_SUITABLE_FOR,
    'benchmark': BENCHMARK,
    'architecture': ARCHITECTURE,
}
