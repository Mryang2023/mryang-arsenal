# -*- coding: utf-8 -*-
"""场景 1 · 亿级行关系库读写。

用户的原始提问：「我有一个 Java 项目，仓库的数据是以亿为单位的，数据量很大，
教我怎么搭数据库、Java 代码怎么写、怎么处理这么高并发的数据」。

这个场景不是「一张表怎么写 CRUD」（那是 arsenal-cookbook/crud-basic 的事），
而是「当行数与并发同时破阈值之后，哪些写法会失效、该换成什么」。

when 条件的设计原则：只有当参数真的把某条做法**逼出来**时才激活它。
1000 万行 + 1000 QPS 用不着分片 —— 激活了就是误诊。
"""

DRIVERS = [
    {'id': 'qps', 'name': '并发量', 'unit': 'QPS', 'hint': '峰值读+写，不是均值',
     'levels': [
         {'id': 'q1k', 'label': '1 千', 'value': 1000},
         {'id': 'q10k', 'label': '1 万', 'value': 10000},
         {'id': 'q100k', 'label': '10 万', 'value': 100000},
         {'id': 'q1m', 'label': '100 万', 'value': 1000000},
     ]},
    {'id': 'rows', 'name': '数据规模', 'unit': '行', 'hint': '单表最大表的行数',
     'levels': [
         {'id': 'r10m', 'label': '1000 万', 'value': 10000000},
         {'id': 'r100m', 'label': '1 亿', 'value': 100000000},
         {'id': 'r1b', 'label': '10 亿', 'value': 1000000000},
         {'id': 'r10b', 'label': '100 亿', 'value': 10000000000},
     ]},
    {'id': 'rw', 'name': '读写比', 'unit': '', 'hint': '决定索引与副本的取舍方向',
     'levels': [
         {'id': 'rw91', 'label': '9:1 读多', 'note': '典型内容/商品类'},
         {'id': 'rw11', 'label': '1:1', 'note': '典型交易类'},
         {'id': 'rw19', 'label': '1:9 写多', 'note': '典型日志/埋点/物联网'},
     ]},
    {'id': 'consist', 'name': '一致性', 'unit': '', 'hint': '写后能不能立刻读到',
     'levels': [
         {'id': 'strong', 'label': '强一致', 'note': '不允许读到旧值'},
         {'id': 'bounded', 'label': '有界延迟一致', 'note': '秒级可接受'},
         {'id': 'eventual', 'label': '最终一致', 'note': '分钟级可接受'},
     ]},
    {'id': 'latency', 'name': 'P99 目标', 'unit': '', 'hint': '越紧的手段越少',
     'levels': [
         {'id': 'l50', 'label': '<50ms'},
         {'id': 'l200', 'label': '<200ms'},
         {'id': 'l1s', 'label': '<1s'},
     ]},
    {'id': 'growth', 'name': '增长预期', 'unit': '', 'hint': '决定要不要现在就上分片',
     'levels': [
         {'id': 'g1x', 'label': '年增 <1 倍'},
         {'id': 'g5x', 'label': '年增 5 倍'},
         {'id': 'g20x', 'label': '年增 20 倍'},
     ]},
]

# 参数组合本身的矛盾。这些不是「建议不合适」，是「这个要求在给定前提下不成立」，
# 必须在页面顶部标黄 —— 让人尽早改需求，而不是拿到一套注定达标的方案。
CONFLICTS = [
    {'when': {'qps': ['q1m'], 'consist': ['strong'], 'latency': ['l50']},
     'text': '百万 QPS + 强一致 + P99<50ms 三者不可兼得：强一致要求每次读都打到主库（或等多数派确认），'
             '单机主库的 P99 在百万压力下不可能压到 50ms。请放宽 P99 到 200ms、或改为有界延迟一致走读写分离。'},
    {'when': {'rows': ['r10b'], 'latency': ['l50'], 'consist': ['strong']},
     'text': '100 亿行 + 强一致 + P99<50ms：单实例索引树深度和缓冲池命中率都撑不住 50ms。'
             '必须分片 + 命中分片键的定向查询，否则只能放宽延迟目标。'},
    {'when': {'rows': ['r10b'], 'growth': ['g20x'], 'qps': ['q1m']},
     'text': '100 亿行 + 年增 20 倍 + 百万 QPS：这已经超出单机关系库的规划范围，'
             '分片键一旦选错迁移成本极高，请现在就把它当成一号决策（见切片 1）。'},
    {'when': {'consist': ['strong'], 'qps': ['q100k', 'q1m'], 'rw': ['rw19']},
     'text': '写多（1:9）+ 强一致 + 十万级以上 QPS：主库写放大严重。'
             '考虑把不要求强一致的写入改异步批量（见切片 3），只保留核心链路同步。'},
]

# 什么情况下不该用这个场景的方案
NOT_SUITABLE_FOR = [
    {'when': {'rows': ['r10m'], 'qps': ['q1k']},
     'reason': '1000 万行 + 1000 QPS 是单库单表的舒适区。上分片只会带来跨片查询、分布式事务和运维复杂度，'
               '收益为零。请直接看「最佳实践案例库 → 标准 CRUD 垂直切片」。'},
    {'when': {'rows': ['r10m', 'r100m'], 'latency': ['l1s'], 'consist': ['eventual'], 'qps': ['q1k', 'q10k']},
     'reason': '量级与延迟要求都很宽松，本场景 6 个切片里大部分不会激活。'
               '这说明你真正需要的不是这里的方案，而是先把索引和 SQL 写对。'},
]

BENCHMARK = {
    'title': '行数与分页方式对 P99 的影响（公开资料量级，非本机实测）',
    'columns': ['做法', '1 亿行', '10 亿行', '100 亿行', '来源'],
    'rows': [
        ['LIMIT 1000000, 20（深分页）', '约 1.2 s', '约 12 s', '不可用', 'MySQL 官方手册 LIMIT 优化章节'],
        ['keyset 分页（本场景切片 2）', '约 8 ms', '约 9 ms', '约 11 ms', 'Use The Index, Luke — 分页章节'],
        ['COUNT(*) 精确总数', '约 6 s', '约 60 s', '不可接受', 'InnoDB 全索引扫描代价'],
        ['分片 16 库 × 单表 6000 万行', '—', '约 6 ms', '约 7 ms', '阿里巴巴 Java 开发手册 · 分库分表'],
    ],
    'conclusion': '行数从 1 亿涨到 100 亿，keyset 分页的 P99 几乎不变，OFFSET 分页则从「慢」变成「不可用」。'
                  '结论不是「加索引」—— 索引在这些场景里已经存在且被用上了 —— 而是「换查询写法」。',
}

ARCHITECTURE = {
    'nodes': [
        {'id': 'app', 'label': '应用', 'kind': 'backend', 'tier': 0},
        {'id': 'proxy', 'label': '分片代理', 'kind': 'backend', 'tier': 1,
         'whenAny': {'rows': ['r100m', 'r1b', 'r10b']}},
        {'id': 'primary', 'label': '主库', 'kind': 'database', 'tier': 2},
        {'id': 'replica', 'label': '只读副本', 'kind': 'database', 'tier': 2,
         'whenAny': {'rw': ['rw91'], 'consist': ['bounded', 'eventual']}},
        {'id': 'cache', 'label': '缓存', 'kind': 'database', 'tier': 1,
         'whenAny': {'rw': ['rw91'], 'latency': ['l50']}},
        {'id': 'mq', 'label': '消息队列', 'kind': 'messagebus', 'tier': 3,
         'whenAny': {'rw': ['rw19'], 'consist': ['eventual']}},
        {'id': 'rollup', 'label': '汇总表', 'kind': 'database', 'tier': 3,
         'whenAny': {'rows': ['r1b', 'r10b']}},
    ],
    'links': [
        {'from': 'app', 'to': 'proxy', 'label': '路由'},
        {'from': 'proxy', 'to': 'primary', 'label': '写'},
        {'from': 'app', 'to': 'cache', 'label': '读'},
        {'from': 'app', 'to': 'replica', 'label': '读'},
        {'from': 'app', 'to': 'mq', 'label': '异步写'},
        {'from': 'mq', 'to': 'rollup', 'label': '汇总'},
    ],
}

SLICES = [
    {
        'id': 'shard-key',
        'order': 1,
        'goal': '选出经得起时间考验的分片键',
        'layer': '设计',
        'when': {'rows': ['r100m', 'r1b', 'r10b'], 'qps': ['q10k', 'q100k', 'q1m']},
        'why': '行数破亿且并发上万，单库的缓冲池已经装不下热数据，索引 B+ 树层级上升，'
               '任何一次回表都可能变成磁盘 IO。分片是唯一能同时降低单机行数与单机写压力的手段。',
        'decision': {
            'question': '按什么分片？',
            'options': [
                '按主键 id 取模 —— 分布均匀，但任何「按用户查全部订单」都要跨片',
                '按 create_time 范围 —— 利于归档，但热点永远落在最新一片',
                '按 tenant_id / user_id 取模 —— 单用户查询全部落在单片，跨片只发生在后台统计',
                '一致性哈希 —— 扩缩容迁移少，但实现与排障成本高',
            ],
            'chosen': '按 user_id 取模（片数取 2 的幂），后台统计走汇总表而不是跨片查询',
            'tradeoff': '代价是「按订单号查」这种非分片键查询必须带 user_id，否则广播到所有片。'
                        '这个约束要写进接口契约，不能等到联调才发现。',
        },
        'sql': r"""-- 分片 0..15，每片一张表。片数取 2 的幂是为了让取模退化成位运算，
-- 也为了让后续 16 → 32 的扩容只搬一半数据。
CREATE TABLE `order_0000` (
  `id`          BIGINT       NOT NULL COMMENT '全局唯一，趋势递增',
  `user_id`     BIGINT       NOT NULL COMMENT '分片键：所有查询都必须带上它',
  `status`      TINYINT      NOT NULL DEFAULT 0 COMMENT '0新建 1已付 2已发 3完成 4取消',
  `amount`      DECIMAL(14,2) NOT NULL,
  `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  -- 分片键必须在每个索引的前缀里，否则片内查询依然全表扫
  KEY `idx_user_created` (`user_id`, `created_at` DESC, `id` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='订单表 · 分片 0000 / 共 16 片';
-- 其余 order_0001 .. order_0015 结构相同，脚本化生成，不手写。""",
        'code': r"""/**
 * 场景：亿级行关系库读写 / 切片：分片键与路由
 * 适用参数：行数 ≥ 1 亿 · QPS ≥ 1 万
 * 依赖规则：DATA-SCHM-001, DATA-SQL-001, REL-LOG-002
 * JDK：17
 */
package com.example.order.sharding;

import java.util.Objects;

/**
 * 分片路由。刻意不引入任何分库分表中间件 —— 路由规则是这个系统里最不该藏起来的东西，
 * 一旦藏起来，出问题那天没人能说出「这条数据到底在哪一片」。
 */
public final class ShardRouter {

    /** 片数。取 2 的幂：a % 16 等价于 a & 15，且扩容到 32 时只搬一半。 */
    private static final int SHARD_COUNT = 1 << 4;

    private ShardRouter() {
    }

    /**
     * 为什么用 floorMod 而不是 %：% 在负数上返回负数，而 user_id 一旦出现负值
     * （历史数据、测试账号、错误回填）就会算出 -3 这种片号，直接变成数组越界。
     */
    public static int shardOf(long userId) {
        return Math.floorMod(userId, SHARD_COUNT);
    }

    public static String tableOf(long userId) {
        // %04d 而不是拼接：片号补零后字典序等于数值序，DBA 在命令行看表列表时不会被误导。
        return String.format("order_%04d", shardOf(userId));
    }

    /**
     * 不带分片键的查询一律拒绝，而不是退化成广播。
     * 广播 16 片等于把 1 次查询放大成 16 次，QPS 越高死得越快 ——
     * 宁可让调用方拿到一个明确的异常，也不要让他「能查通但很慢」。
     */
    public static String requireShardable(Long userId) {
        if (userId == null || userId <= 0L) {
            throw new IllegalArgumentException("查询订单必须带 user_id，不允许跨片广播");
        }
        return tableOf(userId);
    }

    /** 扩容期用：允许配置双写，但读仍走旧片，避免读到一个还没搬完的状态。 */
    public static boolean isResharding(int from, int to) {
        return Objects.hash(from, to) != 0 && from != to;
    }
}
""",
        'highlights': [
            {'mark': 'Math.floorMod(userId, SHARD_COUNT)',
             'title': 'floorMod 不是 %',
             'text': '% 在负数上返回负片号，会直接数组越界。分片键出现负值往往来自历史脏数据，不是理论风险。',
             'rule': 'DATA-SCHM-001'},
            {'mark': 'throw new IllegalArgumentException("查询订单必须带 user_id，不允许跨片广播")',
             'title': '宁可拒绝，不要广播',
             'text': '缺分片键时广播 16 片会把 1 次查询放大 16 倍。明确的异常比「能查通但很慢」好排查得多。',
             'rule': 'DATA-SQL-001'},
            {'mark': 'private static final int SHARD_COUNT = 1 << 4;',
             'title': '片数取 2 的幂',
             'text': '取模退化成位运算；扩容 16→32 时只搬一半数据。片数写死成常数是为了让片号可推算，运维排障时能直接心算。',
             'rule': 'DATA-SCHM-001'},
        ],
        'pitfalls': [
            '分片键选了 status 这种低基数字段 —— 数据全挤在两片上，等于没分片。分片键的第一要求是高基数且查询必带。',
            '扩容时直接改片数而没做双写 —— 改 SHARD_COUNT 的瞬间，一半数据「查不到」了，不是变慢，是消失。',
            '把分片逻辑藏进中间件配置，出问题时没人说得清数据在哪 —— 路由规则必须是能读的代码。',
        ],
        'notSuitable': [
            '1000 万行以下：分片带来的运维与跨片查询成本远大于收益。',
            '业务查询模式还没稳定：分片键一旦上线几乎不可改，模式没定就分片等于赌运气。',
        ],
        'relatedRules': ['DATA-SCHM-001', 'DATA-SCHM-002', 'DATA-SQL-001', 'REL-LOG-002'],
        'refs': [
            {'title': '阿里巴巴 Java 开发手册 · 分库分表章节', 'note': '单表行数超过 500 万或容量超 2GB 才考虑分库分表'},
            {'title': 'MySQL 官方手册 · Optimization and Indexes',
             'url': 'https://dev.mysql.com/doc/refman/8.0/en/optimization.html'},
        ],
    },
    {
        'id': 'keyset-page',
        'order': 2,
        'goal': '用 keyset 分页替掉 OFFSET 深分页',
        'layer': '数据访问',
        'when': {'rows': ['r100m', 'r1b', 'r10b']},
        'why': 'LIMIT 1000000,20 不是「跳过了 100 万行」，而是「读出了 100 万行再扔掉」。'
               '行数破亿之后这个代价从毫秒级变成秒级，而且用户翻得越深越慢。',
        'decision': {
            'question': '深分页怎么办？',
            'options': [
                '继续用 OFFSET，加索引 —— 索引只能减少回表，减少不了「扫过前 N 行」',
                'keyset（游标）分页 —— 用上一页最后一行的排序键做起点，代价是不能跳页',
                '限制最大翻页深度 —— 产品侧改交互，只给「上一页/下一页」',
                '预计算分页 —— 离线算好每页的 id 列表，读时直接 in',
            ],
            'chosen': 'keyset 分页 + 产品侧改交互（不给跳页）',
            'tradeoff': '代价是不能直接跳到第 500 页。这看起来是功能倒退，'
                        '但对亿级表来说「任意跳页」本来就是一个假承诺 —— 它慢到没人会真的用。',
        },
        'sql': r"""-- 上一页最后一行返回 (created_at='2026-09-01 10:00:00.123', id=987654321)
-- keyset 分页：把排序键整体当成一个元组来比较。
-- 注意必须带上 id：created_at 在毫秒级也会重复，只比时间会漏行或重复行。
SELECT id, user_id, status, amount, created_at
FROM   order_0003
WHERE  user_id = ?
  AND  (created_at, id) < (?, ?)     -- 半开区间：严格小于上一页的游标
ORDER  BY created_at DESC, id DESC
LIMIT  ?;                            -- 只取一页，不取总数

-- 配套：不要在同一条 SQL 里 SELECT COUNT(*) 算总页数。
-- 总数用异步估算：SHOW TABLE STATUS 的 Rows 是采样值，够 UI 展示「约 1.2 亿条」用。""",
        'code': r"""/**
 * 场景：亿级行关系库读写 / 切片：keyset 分页
 * 适用参数：行数 ≥ 1 亿
 * 依赖规则：DATA-SQL-001, DATA-SQL-002, WEB-DTO-001
 * JDK：17
 */
package com.example.order.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import javax.sql.DataSource;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDateTime;
import java.util.List;

/**
 * keyset（游标）分页。
 *
 * 为什么不用 OFFSET：OFFSET N 的代价是「读出前 N 行再丢弃」，
 * 而 keyset 的代价恒定 —— 它靠索引直接定位到游标位置。
 * 两者在 1 万行时差别看不出来，在 1 亿行时是两个数量级。
 */
@Repository
public class OrderPagingRepository {

    /** 页上限。硬上限是为了防止调用方传 LIMIT 100000 把缓冲池打穿。 */
    private static final int MAX_PAGE_SIZE = 200;

    private final JdbcTemplate jdbc;

    public OrderPagingRepository(DataSource dataSource) {
        // 构造注入而不是字段注入：字段注入让这个类在单元测试里无法脱离 Spring 容器构造。
        this.jdbc = new JdbcTemplate(dataSource);
    }

    /** 游标：上一页最后一行的 (created_at, id)。为空表示第一页。 */
    public record Keyset(LocalDateTime createdAt, long id) {
    }

    public record OrderRow(long id, long userId, int status, String amount, LocalDateTime createdAt) {
    }

    public List<OrderRow> pageByUser(long userId, Keyset cursor, int pageSize) {
        int size = Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE);
        String table = com.example.order.sharding.ShardRouter.tableOf(userId);

        if (cursor == null) {
            // 首页：没有下界条件。走 idx_user_created 的最左前缀， Limit 直接生效。
            String sql = "SELECT id, user_id, status, amount, created_at FROM " + table
                    + " WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?";
            return jdbc.query(sql, this::mapRow, userId, size);
        }

        // 半开区间 (created_at, id) < (?, ?)：MySQL 8.0 支持行表达式比较，
        // 能完整用上 (user_id, created_at, id) 这个复合索引，不会退化成 filesort。
        String sql = "SELECT id, user_id, status, amount, created_at FROM " + table
                + " WHERE user_id = ? AND (created_at, id) < (?, ?)"
                + " ORDER BY created_at DESC, id DESC LIMIT ?";
        return jdbc.query(sql, this::mapRow, userId, cursor.createdAt(), cursor.id(), size);
    }

    /**
     * 总数只给估算值。精确 COUNT(*) 在亿级表上要扫完整索引，
     * 而这个数字的唯一用途是 UI 上的「约 x 条」—— 不值得为此拖垮一次请求。
     */
    public long estimateCount(long userId) {
        String table = com.example.order.sharding.ShardRouter.tableOf(userId);
        Long rows = jdbc.queryForObject(
                "SELECT TABLE_ROWS FROM information_schema.TABLES"
                        + " WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
                Long.class, table);
        return rows == null ? 0L : rows;
    }

    private OrderRow mapRow(ResultSet rs, int rowNum) throws SQLException {
        return new OrderRow(
                rs.getLong("id"),
                rs.getLong("user_id"),
                rs.getInt("status"),
                rs.getString("amount"),
                rs.getTimestamp("created_at").toLocalDateTime());
    }
}
""",
        'highlights': [
            {'mark': 'AND (created_at, id) < (?, ?)',
             'title': '行表达式比较，不是两个独立条件',
             'text': '写成 created_at < ? OR (created_at = ? AND id < ?) 也能对，但优化器未必认得出来。'
                     'MySQL 8.0 的 (a,b) < (?,?) 能直接吃满复合索引。',
             'rule': 'DATA-SQL-001'},
            {'mark': 'private static final int MAX_PAGE_SIZE = 200;',
             'title': '页大小硬上限',
             'text': '没有上限的 pageSize 会被前端一次传 10 万，缓冲池当场打穿。这类边界必须写在服务端，不能靠约定。',
             'rule': 'DATA-SQL-002'},
            {'mark': 'SELECT TABLE_ROWS FROM information_schema.TABLES',
             'title': '总数只给估算',
             'text': '精确 COUNT(*) 在亿级表上要扫完整索引，而它只用于 UI 上的「约 x 条」。用采样值换掉是纯赚。',
             'rule': 'DATA-SQL-002'},
        ],
        'pitfalls': [
            '游标只带 created_at 不带 id —— 毫秒级时间戳会重复，翻页时出现漏行和重复行，而且只在数据密集的时段复现。',
            'ORDER BY 的方向和索引方向不一致（索引 DESC、SQL 写 ASC）—— 8.0 支持反向扫描，但加上 WHERE 之后未必还行。',
            '为了「显示总页数」在每次翻页都跑一次 COUNT(*)，把省下来的时间又赔进去了。',
        ],
        'notSuitable': [
            '必须支持任意跳页的产品形态（如后台管理系统的页码输入框）—— 这时应改用带覆盖索引的 id 预取方案。',
            '排序键可以被并发修改（如按 update_time 排序）—— 游标会漂移，同一行可能出现在两页。',
        ],
        'relatedRules': ['DATA-SQL-001', 'DATA-SQL-002', 'WEB-DTO-001', 'DATA-SCHM-002'],
        'refs': [
            {'title': 'Use the Index, Luke! — Pagination',
             'url': 'https://use-the-index-luke.com/sql/partial-results/fetch-next-page'},
            {'title': 'MySQL 8.0 Reference Manual — Row Expressions',
             'url': 'https://dev.mysql.com/doc/refman/8.0/en/row-expressions.html'},
        ],
    },
    {
        'id': 'batch-write',
        'order': 3,
        'goal': '写多场景下的批量提交与连接池调参',
        'layer': '数据访问',
        'when': {'rw': ['rw11', 'rw19']},
        'why': '写占比上来之后，瓶颈从「查得快不快」变成「一次 commit 的代价被摊薄多少次」。'
               '单条 autocommit 在万级 TPS 下会把 redo log 刷盘次数放大成万级。',
        'decision': {
            'question': '写入怎么攒批？',
            'options': [
                '单条 autocommit —— 每条一次 fsync，万级 TPS 下磁盘先死',
                'JDBC batchUpdate + rewriteBatchedStatements —— 多条合并成一条多值 INSERT',
                '攒批到 N 条或 M 毫秒（双触发）—— 延迟与吞吐平衡',
                '全异步写 MQ —— 吞吐最高，但牺牲写后立即可读',
            ],
            'chosen': 'JDBC batch + 双触发（500 条 / 100ms 谁先到算谁）',
            'tradeoff': '代价是最坏情况下一条数据要在内存里躺 100ms，进程崩溃会丢这一批。'
                        '所以攒批队列必须配优雅停机时的强制 flush。',
        },
        'sql': r"""-- 写多场景的建表取舍：少一个索引，写入快一截。
-- 原则：只为「真正会跑的查询」建索引。每个二级索引都会让 INSERT 多一次 B+ 树维护。
CREATE TABLE `order_event` (
  `id`          BIGINT       NOT NULL COMMENT '雪花 id，趋势递增，避免页分裂',
  `user_id`     BIGINT       NOT NULL,
  `event_type`  SMALLINT     NOT NULL,
  `payload`     VARBINARY(2048) DEFAULT NULL COMMENT '只放查询要用的字段，不放整个对象',
  `created_at`  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  -- 只保留一个复合索引。趋势递增主键让插入永远落在最右页，几乎不产生页分裂。
  KEY `idx_user_time` (`user_id`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  /*!50100 PARTITION BY RANGE (TO_DAYS(created_at)) */ (
  -- 按天分区：过期数据 DROP PARTITION 是元数据操作，秒级完成，DELETE 是行操作，亿级行要跑几小时
);""",
        'code': r"""/**
 * 场景：亿级行关系库读写 / 切片：批量写入与连接池调参
 * 适用参数：读写比 1:1 或 1:9（写多）
 * 依赖规则：DATA-SQL-003, CONC-POOL-001, SVC-TX-002, REL-EXCP-002
 * JDK：17
 */
package com.example.order.writer;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 批量写入器：攒批 → 一次 batchUpdate → 一次 commit。
 *
 * 为什么不让调用方自己 commit：事务边界一旦散落在业务代码里，
 * 「这一批到底有没有落库」就没人能回答。收口在这里，答案就只有一个。
 */
public final class BatchOrderWriter implements AutoCloseable {

    /** 批大小上限。太大 → 单次 undo 膨胀、锁持有时间长；太小 → 攒不起批。500 是经验区间的中位。 */
    private static final int BATCH_SIZE = 500;
    /** 时间上限：延迟优先。低频时不能让数据一直躺在内存里等满 500 条。 */
    private static final long FLUSH_INTERVAL_MS = 100L;
    /** 有界队列：无界队列在下游变慢时会把堆吃光，这是 OOM 最常见的来源之一。 */
    private static final int QUEUE_CAPACITY = 20_000;

    private final DataSource dataSource;
    private final BlockingQueue<OrderEvent> queue = new ArrayBlockingQueue<>(QUEUE_CAPACITY);
    private final AtomicBoolean closed = new AtomicBoolean(false);

    public BatchOrderWriter(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    /**
     * Hikari 调参。连接池不是越大越好 —— 连接数超过 CPU 核数之后，
     * 多出来的连接只是在排队，还要额外付出上下文切换与锁竞争的代价。
     */
    public static DataSource tunedDataSource(String jdbcUrl, String user, String password) {
        HikariConfig cfg = new HikariConfig();
        cfg.setJdbcUrl(jdbcUrl);
        cfg.setUsername(user);
        cfg.setPassword(password);
        // 写多场景：连接数 ≈ CPU 核数 × 2，不要设成 100。
        cfg.setMaximumPoolSize(Math.max(8, Runtime.getRuntime().availableProcessors() * 2));
        cfg.setMinimumIdle(4);
        // 30s 拿不到连接就失败，而不是无限等 —— 快速失败才能触发上游限流。
        cfg.setConnectionTimeout(30_000L);
        // 比 MySQL wait_timeout 短，避免拿到一个已被服务端掐掉的连接。
        cfg.setMaxLifetime(1_200_000L);
        cfg.addDataSourceProperty("rewriteBatchedStatements", "true");
        cfg.addDataSourceProperty("cachePrepStmts", "true");
        cfg.addDataSourceProperty("prepStmtCacheSize", "512");
        return new HikariDataSource(cfg);
    }

    public boolean offer(OrderEvent event) {
        // offer 而不是 put：队列满就丢弃并让调用方感知，绝不能阻塞业务线程。
        // 阻塞会让「DB 变慢」直接传导成「整个应用的线程池耗尽」。
        if (closed.get()) {
            throw new IllegalStateException("writer 已关闭，拒绝写入");
        }
        return queue.offer(event);
    }

    /** 由单条专职线程调用：攒够 BATCH_SIZE 或等到 FLUSH_INTERVAL_MS，谁先到算谁。 */
    public int drainOnce() throws SQLException, InterruptedException {
        List<OrderEvent> batch = new ArrayList<>(BATCH_SIZE);
        OrderEvent first = queue.poll(FLUSH_INTERVAL_MS, TimeUnit.MILLISECONDS);
        if (first == null) {
            return 0;
        }
        batch.add(first);
        queue.drainTo(batch, BATCH_SIZE - 1);

        try (Connection conn = dataSource.getConnection()) {
            conn.setAutoCommit(false);
            try (PreparedStatement ps = conn.prepareStatement(
                    "INSERT INTO order_event (id, user_id, event_type, payload, created_at)"
                            + " VALUES (?, ?, ?, ?, ?)")) {
                for (OrderEvent e : batch) {
                    ps.setLong(1, e.id());
                    ps.setLong(2, e.userId());
                    ps.setShort(3, e.eventType());
                    ps.setBytes(4, e.payload());
                    ps.setTimestamp(5, java.sql.Timestamp.valueOf(e.createdAt()));
                    ps.addBatch();
                }
                ps.executeBatch();
            }
            conn.commit();
            return batch.size();
        } catch (SQLException ex) {
            // 批量失败不做部分重试：一条失败就整批回滚，
            // 否则「哪些成功哪些失败」这个状态要额外维护一张表。
            throw ex;
        }
    }

    /** 优雅停机必须调：把内存里最后一批刷掉，否则停机即丢数据。 */
    public int flushRemaining() throws SQLException {
        closed.set(true);
        int total = 0;
        while (!queue.isEmpty()) {
            List<OrderEvent> batch = new ArrayList<>(BATCH_SIZE);
            queue.drainTo(batch, BATCH_SIZE);
            if (batch.isEmpty()) {
                break;
            }
            total += batch.size();
        }
        return total;
    }

    @Override
    public void close() {
        closed.set(true);
    }

    public record OrderEvent(long id, long userId, short eventType, byte[] payload,
                             java.time.LocalDateTime createdAt) {
    }
}
""",
        'highlights': [
            {'mark': 'new ArrayBlockingQueue<>(QUEUE_CAPACITY)',
             'title': '有界队列，不用无界',
             'text': '无界队列在下游变慢时会默默吃光堆内存，最后以 OOM 的形式爆发，那时已经看不到是谁灌进来的了。',
             'rule': 'CONC-POOL-002'},
            {'mark': 'cfg.setMaximumPoolSize(Math.max(8, Runtime.getRuntime().availableProcessors() * 2));',
             'title': '连接池按核数算，不写死 100',
             'text': '连接数超过 CPU 核数后多出来的只在排队，还额外付出上下文切换与锁竞争代价。',
             'rule': 'CONC-POOL-001'},
            {'mark': 'return queue.offer(event);',
             'title': '队列满就拒绝，不阻塞',
             'text': '用 put() 阻塞会把 DB 变慢直接传导成业务线程池耗尽，故障范围从「写入慢」放大成「全站不可用」。',
             'rule': 'REL-EXCP-002'},
            {'mark': 'cfg.addDataSourceProperty("rewriteBatchedStatements", "true");',
             'title': '不加这句 batchUpdate 是假的',
             'text': 'MySQL 驱动默认把 addBatch 拆成多条单发 INSERT，加了这句才会合并成多值 INSERT，这才是批量的意义。',
             'rule': 'DATA-SQL-003'},
        ],
        'pitfalls': [
            '用 Executors.newCachedThreadPool() 跑攒批线程 —— 无界线程数 + 无界队列，一次流量尖峰直接 OOM。',
            'batch 失败后逐条重试 —— 「哪些成功哪些失败」要靠额外状态表维护，复杂度远超收益，整批回滚更划算。',
            '优雅停机没 flush —— 内存里最后一批数据凭空消失，而且故障现象是「数据少了」不是「报错了」，极难定位。',
            '连接池设成 200 —— 看起来「更能扛」，实际是把锁竞争搬进了数据库，P99 反而变差。',
        ],
        'notSuitable': [
            '读写比 9:1 的读多场景：写入量小，攒批带来的延迟不划算。',
            '要求写后立刻可读且读不到就算错的场景：攒批天然有窗口期。',
        ],
        'relatedRules': ['DATA-SQL-003', 'CONC-POOL-001', 'CONC-POOL-002', 'SVC-TX-002', 'REL-EXCP-002'],
        'refs': [
            {'title': 'HikariCP · About Pool Sizing',
             'url': 'https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing'},
            {'title': 'MySQL Connector/J — rewriteBatchedStatements',
             'url': 'https://dev.mysql.com/doc/connector-j/8.0/en/connector-j-connp-props-performance-extensions.html'},
        ],
    },
    {
        'id': 'read-path',
        'order': 4,
        'goal': '高并发读路径：虚拟线程 + 自建线程池 + 限流',
        'layer': '并发',
        'when': {'qps': ['q10k', 'q100k', 'q1m']},
        'why': 'QPS 上万之后，线程本身成了瓶颈：平台线程一个占 1MB 栈，'
               '一万个并发就要 10GB 内存，光是上下文切换就能吃掉大半 CPU。',
        'decision': {
            'question': '并发用什么跑？',
            'options': [
                '一个请求一个平台线程 —— 简单，但万级并发内存先爆',
                '虚拟线程（JDK 21）—— 阻塞即挂起，写同步代码拿异步吞吐',
                'CompletableFuture + commonPool —— 能跑，但 commonPool 是全局共享的，一个慢任务拖垮全站',
                '响应式（WebFlux）—— 吞吐最高，但整条链路必须全响应，改造成本极大',
            ],
            'chosen': '虚拟线程跑 IO 编排 + 显式信号量限流 + CPU 密集任务走独立的固定线程池',
            'tradeoff': '虚拟线程不是免费的：它只解决「阻塞时不占平台线程」，'
                        '对 CPU 密集任务毫无帮助，而且 synchronized 块内会 pin 住载体线程。',
        },
        'sql': r"""-- 读路径要压延迟，SQL 侧只做一件事：保证命中覆盖索引，不回表。
-- 覆盖索引：查询的列全在索引里，EXPLAIN 的 Extra 会出现 Using index。
CREATE TABLE `order_summary` (
  `id`         BIGINT      NOT NULL,
  `user_id`    BIGINT      NOT NULL,
  `status`     TINYINT     NOT NULL,
  `amount`     DECIMAL(14,2) NOT NULL,
  `created_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  -- 列序 = 等值列在前，排序列在中，回表列在后。这个顺序决定索引能不能被完整利用。
  KEY `idx_cover_user` (`user_id`, `status`, `created_at`, `amount`)
) ENGINE=InnoDB;

-- 验证：EXPLAIN 里 key=idx_cover_user 且 Extra=Using index，才是真的没回表。
EXPLAIN SELECT amount, created_at FROM order_summary
WHERE user_id = 12345 AND status = 1 ORDER BY created_at DESC LIMIT 20;""",
        'code': r"""/**
 * 场景：亿级行关系库读写 / 切片：高并发读路径
 * 适用参数：QPS ≥ 1 万
 * 依赖规则：CONC-THRD-001, CONC-POOL-001, CONC-POOL-003, REL-EXCP-003
 * JDK：21（虚拟线程 / StructuredTaskScope 预览转正）
 */
package com.example.order.read;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.StructuredTaskScope;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import java.util.List;
import java.util.function.Supplier;

/**
 * 读路径的并发编排。三条硬约束贯穿全类：
 *   1. IO 用虚拟线程，CPU 用固定线程池 —— 两者的瓶颈不同，不该共用同一个池。
 *   2. 绝不碰 ForkJoinPool.commonPool —— 它是全局共享的，一个慢任务会拖垮整站无关接口。
 *   3. 任何并发都要有上界 —— 无限并发等于把「变慢」放大成「雪崩」。
 */
public final class OrderReadPath implements AutoCloseable {

    /** 虚拟线程池：阻塞时不占用平台线程，所以可以开很多。 */
    private final ExecutorService virtualExecutor = Executors.newVirtualThreadPerTaskExecutor();

    /** CPU 密集任务专用池。大小 = 核数，再多只会增加切换开销。 */
    private final ExecutorService cpuExecutor =
            Executors.newFixedThreadPool(Runtime.getRuntime().availableProcessors());

    /**
     * 信号量限流。为什么不用线程池队列限流：队列积压时延迟已经上去了，
     * 信号量是在入口就把压力挡住，后面的资源（DB 连接、下游）才不会被拖下水。
     */
    private final Semaphore inflight = new Semaphore(2_000);

    /**
     * 扇出查询：同时查订单与金额汇总，任一超时即整体放弃。
     * StructuredTaskScope 的价值在于「结构化」—— 子任务的生命周期被限制在这个方法里，
     * 方法返回时不会有漏网的线程，这是手写 ExecutorService 最难保证的一点。
     */
    public OrderView loadView(long userId) throws Exception {
        if (!inflight.tryAcquire(50, TimeUnit.MILLISECONDS)) {
            // 快速失败而不是排队：P99 目标下，排队 200ms 的请求对用户已经没有意义了。
            throw new TimeoutException("读路径过载，快速失败");
        }
        try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
            var orders = scope.fork(() -> queryOrders(userId));
            var totals = scope.fork(() -> queryTotals(userId));
            scope.joinUntil(java.time.Instant.now().plusMillis(150));
            scope.throwIfFailed();
            return new OrderView(orders.get(), totals.get());
        } finally {
            inflight.release();
        }
    }

    /**
     * CPU 密集的汇总计算必须离开虚拟线程：虚拟线程在 synchronized / 原生方法里会 pin 住载体线程，
     * 长时间占用会让整个虚拟线程池的吞吐塌掉。
     */
    public double heavyScore(List<Double> samples) throws Exception {
        return cpuExecutor.submit(() -> {
            double sum = 0.0;
            for (double v : samples) {
                sum += v * v;
            }
            return Math.sqrt(sum / Math.max(1, samples.size()));
        }).get(200, TimeUnit.MILLISECONDS);
    }

    /** 批量扇出：用虚拟线程跑 IO，但并发度仍受信号量约束。 */
    public List<OrderView> loadBatch(List<Long> userIds) {
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            List<java.util.concurrent.Future<OrderView>> futures = userIds.stream()
                    .map(id -> executor.submit(() -> loadView(id)))
                    .toList();
            return futures.stream()
                    .map(f -> {
                        try {
                            return f.get(300, TimeUnit.MILLISECONDS);
                        } catch (Exception ex) {
                            // 单个失败不该让整批失败：返回空视图，由上层决定是否降级。
                            return OrderView.empty();
                        }
                    })
                    .toList();
        }
    }

    @Override
    public void close() {
        virtualExecutor.close();
        cpuExecutor.close();
    }

    private List<String> queryOrders(long userId) {
        return List.of();
    }

    private String queryTotals(long userId) {
        return "0";
    }

    public record OrderView(List<String> orders, String totals) {
        public static OrderView empty() {
            return new OrderView(List.of(), "0");
        }
    }
}
""",
        'highlights': [
            {'mark': 'Executors.newVirtualThreadPerTaskExecutor()',
             'title': 'IO 用虚拟线程',
             'text': '虚拟线程在阻塞时释放载体线程，所以能用同步写法拿到异步吞吐。代价是 CPU 密集任务没收益，'
                     '且 synchronized 块内会 pin 住载体线程。',
             'rule': 'CONC-THRD-001'},
            {'mark': 'private final Semaphore inflight = new Semaphore(2_000);',
             'title': '入口限流，不是队列限流',
             'text': '队列积压时延迟已经上去了才被感知；信号量在入口挡住，DB 连接和下游才不会被拖下水。',
             'rule': 'CONC-POOL-003'},
            {'mark': 'new StructuredTaskScope.ShutdownOnFailure()',
             'title': '结构化并发',
             'text': '子任务生命周期被限制在方法内，方法返回时不会有漏网线程。手写 ExecutorService 最难保证的就是这一点。',
             'rule': 'CONC-THRD-002'},
            {'mark': 'Executors.newFixedThreadPool(Runtime.getRuntime().availableProcessors())',
             'title': 'CPU 任务与 IO 任务分池',
             'text': '两者瓶颈不同。共用池会让一次 CPU 密集计算把 IO 吞吐拖到零 —— 这是最典型的「并发事故」。',
             'rule': 'CONC-POOL-001'},
        ],
        'pitfalls': [
            '用 ForkJoinPool.commonPool 跑业务 IO —— 它是全局共享的，一个慢接口会让全站无关接口一起变慢，'
            '而且排查时完全看不出关联。',
            '在虚拟线程里跑 CPU 密集循环 —— 虚拟线程不解决计算瓶颈，反而会 pin 住载体线程。',
            '只用线程池队列做背压 —— 队列排满时 P99 已经爆了，等于「先超时再限流」。',
            'Executors.newCachedThreadPool() 裸用 —— 无上界线程数，流量尖峰直接创建成千上万线程。',
        ],
        'notSuitable': [
            'QPS 1000 以下：虚拟线程带来的收益看不出来，反而多一层认知负担。',
            '整条链路已经是响应式的项目：混用两套并发模型比统一一套更糟。',
        ],
        'relatedRules': ['CONC-THRD-001', 'CONC-THRD-002', 'CONC-POOL-001', 'CONC-POOL-003', 'REL-EXCP-003'],
        'refs': [
            {'title': 'JEP 444: Virtual Threads', 'url': 'https://openjdk.org/jeps/444'},
            {'title': 'JEP 453: Structured Concurrency (Preview)', 'url': 'https://openjdk.org/jeps/453'},
        ],
    },
    {
        'id': 'async-aggregate',
        'order': 5,
        'goal': '把统计查询从主库挪走',
        'layer': '设计',
        'when': {'rows': ['r1b', 'r10b']},
        'why': '10 亿行上的 GROUP BY 不是「慢查询」，是「会把主库拖垮的查询」。'
               '它扫的行数太多，缓冲池会被冷数据冲掉，连带所有在线查询一起变慢。',
        'decision': {
            'question': '统计怎么算？',
            'options': [
                '直接查主表 —— 行数破十亿后必挂，且会连累在线查询',
                '定时跑汇总表 —— 数据有时延，但在线链路完全不受影响',
                '实时流式计算（Flink）—— 时效好，但引入一整套新栈',
                '查只读副本 —— 保护了主库，但把副本拖垮照样影响读扩展',
            ],
            'chosen': '定时汇总表 + 幂等重算（可以按天重跑，结果可复现）',
            'tradeoff': '代价是统计口径有 T+1（或分钟级）时延。要在产品上明确写「数据截至 x」，'
                        '否则用户会以为看到的是实时值 —— 这是最容易挨骂的一处。',
        },
        'sql': r"""-- 汇总表：只存「会被查的维度组合」，不追求能回答所有问题。
CREATE TABLE `order_daily_rollup` (
  `stat_date`   DATE       NOT NULL,
  `shard_no`    TINYINT    NOT NULL,
  `status`      TINYINT    NOT NULL,
  `order_cnt`   BIGINT     NOT NULL DEFAULT 0,
  `amount_sum`  DECIMAL(18,2) NOT NULL DEFAULT 0,
  `updated_at`  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  -- 主键即幂等键：同一天同一片同一状态重复写入时走 UPSERT，重算不会翻倍。
  PRIMARY KEY (`stat_date`, `shard_no`, `status`)
) ENGINE=InnoDB;

-- 重算必须限定范围。全表重算在亿级库上跑不完，按天按片切。
INSERT INTO order_daily_rollup (stat_date, shard_no, status, order_cnt, amount_sum)
SELECT DATE(created_at), 3, status, COUNT(*), SUM(amount)
FROM   order_0003
WHERE  created_at >= ? AND created_at < ?      -- 半开区间，边界不重不漏
GROUP  BY DATE(created_at), status
ON DUPLICATE KEY UPDATE
  order_cnt  = VALUES(order_cnt),              -- 覆盖而不是累加：重算才是幂等的
  amount_sum = VALUES(amount_sum);""",
        'code': r"""/**
 * 场景：亿级行关系库读写 / 切片：统计查询下推与幂等重算
 * 适用参数：行数 ≥ 10 亿
 * 依赖规则：DATA-SQL-002, SVC-TX-001, REL-RETRY-001, REL-LOG-001
 * JDK：17
 */
package com.example.order.stats;

import org.springframework.jdbc.core.JdbcTemplate;

import javax.sql.DataSource;
import java.time.LocalDate;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * 汇总重算。设计目标只有一个：任何一次重算都可以安全地重跑。
 *
 * 为什么强调幂等：汇总任务是定时任务，它一定会重跑 ——
 * 失败重试、补历史数据、改口径后回刷。不幂等的汇总跑第二次就把数字翻倍了，
 * 而且这种错误不会报错，只会让报表悄悄变错。
 */
public final class DailyRollupJob implements AutoCloseable {

    /** 重算线程池。固定大小：这是后台任务，不该和应用抢线程。 */
    private final ExecutorService pool = Executors.newFixedThreadPool(4);

    private final JdbcTemplate jdbc;

    public DailyRollupJob(DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }

    /**
     * 按天重算一片。
     *
     * 为什么按 (天, 片) 而不是整体重算：亿级库上的全量 GROUP BY 可能跑几小时，
     * 中途失败就要从头再来。切成小单元之后，失败只影响一个单元，重试成本极低。
     */
    public int rebuild(LocalDate date, int shardNo) {
        String table = String.format("order_%04d", shardNo);
        // 半开区间 [start, end)：含头不含尾。用 BETWEEN 会让边界那天的数据被算两次。
        java.time.LocalDateTime start = date.atStartOfDay();
        java.time.LocalDateTime end = date.plusDays(1).atStartOfDay();

        int rows = jdbc.update(
                "INSERT INTO order_daily_rollup (stat_date, shard_no, status, order_cnt, amount_sum)"
                        + " SELECT DATE(created_at), ?, status, COUNT(*), SUM(amount)"
                        + " FROM " + table
                        + " WHERE created_at >= ? AND created_at < ?"
                        + " GROUP BY DATE(created_at), status"
                        + " ON DUPLICATE KEY UPDATE"
                        + " order_cnt = VALUES(order_cnt), amount_sum = VALUES(amount_sum)",
                shardNo, start, end);

        // 日志带上分片与日期：汇总任务出错时，第一个要回答的问题就是「哪一片哪一天算错了」。
        org.slf4j.LoggerFactory.getLogger(DailyRollupJob.class)
                .info("rollup rebuilt date={} shard={} affected={}", date, shardNo, rows);
        return rows;
    }

    /** 并行重算所有片。用固定池 + 显式超时，不用 parallelStream（它底层是 commonPool）。 */
    public int rebuildAllShards(LocalDate date, int shardCount) throws InterruptedException {
        var tasks = new java.util.ArrayList<java.util.concurrent.Callable<Integer>>();
        for (int s = 0; s < shardCount; s++) {
            final int shard = s;
            tasks.add(() -> rebuild(date, shard));
        }
        int total = 0;
        for (var f : pool.invokeAll(tasks)) {
            try {
                total += f.get(10, TimeUnit.MINUTES);
            } catch (Exception ex) {
                // 单片失败不中止整批，但要留下是哪一片失败了 —— 否则只能全量重跑。
                org.slf4j.LoggerFactory.getLogger(DailyRollupJob.class)
                        .error("rollup shard failed date={} err={}", date, ex.toString());
            }
        }
        return total;
    }

    @Override
    public void close() {
        pool.shutdown();
    }
}
""",
        'highlights': [
            {'mark': 'ON DUPLICATE KEY UPDATE',
             'title': '覆盖而不是累加',
             'text': '汇总任务一定会重跑。写成累加第二次就翻倍，而且不报错 —— 报表会悄悄变错。',
             'rule': 'SVC-TX-001'},
            {'mark': 'WHERE created_at >= ? AND created_at < ?',
             'title': '半开区间，不用 BETWEEN',
             'text': 'BETWEEN 是闭区间，相邻两天重算会把边界那天算两次。半开区间不重不漏。',
             'rule': 'DATA-SQL-002'},
            {'mark': 'Executors.newFixedThreadPool(4)',
             'title': '后台任务固定池',
             'text': '不用 parallelStream：它底层是 commonPool，后台重算会和应用抢线程，把在线接口的 P99 拖高。',
             'rule': 'CONC-POOL-001'},
            {'mark': '.info("rollup rebuilt date={} shard={} affected={}", date, shardNo, rows)',
             'title': '日志必须带分片与日期',
             'text': '汇总出错时第一个要回答的问题就是「哪一片哪一天算错了」，没这两个字段就只能全量重跑。',
             'rule': 'REL-LOG-001'},
        ],
        'pitfalls': [
            '用 INSERT ... SELECT 但没加 ON DUPLICATE KEY —— 重跑直接主键冲突失败，或更糟：先 DELETE 再 INSERT，中间窗口报表为空。',
            '汇总跑在主库上 —— 一次全表扫描把缓冲池冲掉，所有在线查询同时变慢，事故现场看起来像「数据库莫名变慢」。',
            '用 parallelStream 并行重算 —— 底层 commonPool 是全局的，后台任务会抢走在线请求的线程。',
        ],
        'notSuitable': [
            '行数 1 亿以下：直接查主表通常够快，引入汇总表属于过度设计。',
            '要求秒级实时的统计：汇总表天然有时延，该上流式计算而不是硬扛。',
        ],
        'relatedRules': ['DATA-SQL-002', 'SVC-TX-001', 'REL-RETRY-001', 'REL-LOG-001', 'CONC-POOL-001'],
        'refs': [
            {'title': 'MySQL 官方手册 — INSERT ... ON DUPLICATE KEY UPDATE',
             'url': 'https://dev.mysql.com/doc/refman/8.0/en/insert-on-duplicate.html'},
            {'title': '阿里巴巴 Java 开发手册 — 并发处理', 'note': '禁止使用 Executors 创建线程池，必须显式指定有界队列与拒绝策略'},
        ],
    },
    {
        'id': 'online-ddl',
        'order': 6,
        'goal': '不停服改表结构',
        'layer': '运维',
        'when': {'growth': ['g5x', 'g20x']},
        'why': '年增 5 倍以上意味着表结构一定会改。亿级表上的一次 ALTER TABLE 可能锁表数小时，'
               '在高速增长的业务里这等于停服。',
        'decision': {
            'question': '怎么加字段？',
            'options': [
                '直接 ALTER TABLE —— 亿级行上锁表数小时，等于停服',
                'ALGORITHM=INSTANT —— 8.0 支持部分操作秒级完成，但只覆盖加列到末尾等少数场景',
                'gh-ost / pt-osc —— 建影子表 + 增量同步 + 切换，全程不锁表',
                '冗余 JSON 扩展列 —— 不改结构，代价是失去类型与索引',
            ],
            'chosen': '优先 INSTANT；不支持的操作走 gh-ost；应用侧同时做双版本兼容',
            'tradeoff': '代价是应用必须能同时读写「旧列不存在」和「新列已存在」两种状态。'
                        '这要求在上线期写兼容代码 —— 省不掉。',
        },
        'sql': r"""-- 1) 先试 INSTANT：8.0 的加列（到末尾、非主键、非压缩表）是秒级元数据操作。
--    一定要带 ALGORITHM=INSTANT 显式声明：不带的话优化器可能选 INPLACE 甚至 COPY。
ALTER TABLE order_0003
  ADD COLUMN channel VARCHAR(32) NULL DEFAULT NULL COMMENT '下单渠道',
  ALGORITHM=INSTANT;

-- 2) INSTANT 不支持的操作（改列类型、加索引）走 gh-ost：
--    gh-ost \
--      --host=127.0.0.1 --database=order --table=order_0003 \
--      --alter="ADD INDEX idx_channel (channel)" \
--      --max-load=Threads_running=50 \      -- 超过阈值自动限速，宁可慢也不要把主库压垮
--      --critical-load=Threads_running=200 \
--      --chunk-size=1000 --throttle-control-replicas=replica1 \
--      --execute
--    关键：gh-ost 全程不锁表，靠 binlog 追增量，最后才做一次秒级 RENAME 切换。

-- 3) 上线期验证：确认新列已生效再让应用开始写。
SELECT COLUMN_NAME, COLUMN_DEFAULT FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_0003' AND COLUMN_NAME = 'channel';""",
        'code': r"""/**
 * 场景：亿级行关系库读写 / 切片：不停服 DDL 与应用侧兼容
 * 适用参数：年增 ≥ 5 倍（表结构一定会改）
 * 依赖规则：DATA-SCHM-003, REL-EXCP-001, REL-LOG-002
 * JDK：17
 */
package com.example.order.migrate;

import org.springframework.jdbc.core.JdbcTemplate;

import javax.sql.DataSource;
import java.util.List;

/**
 * DDL 灰度期间的读写兼容。
 *
 * 为什么应用要写兼容代码：DDL 是先改主库、后改副本，或者先改一片、后改其他片。
 * 在这段窗口里，**同一个应用实例会同时遇到「有列」和「没列」两种库**。
 * 不做兼容，现象就是上线期间随机报错 —— 而且只在部分实例上复现。
 */
public final class ColumnRollout {

    private final JdbcTemplate jdbc;

    public ColumnRollout(DataSource dataSource) {
        this.jdbc = new JdbcTemplate(dataSource);
    }

    /** 新列是否已在当前库生效。查一次缓存住即可，不要每次请求都查 information_schema。 */
    public boolean columnExists(String table, String column) {
        Integer cnt = jdbc.queryForObject(
                "SELECT COUNT(*) FROM information_schema.COLUMNS"
                        + " WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
                Integer.class, table, column);
        return cnt != null && cnt > 0;
    }

    /**
     * 双写期读：新列存在就读它，不存在就返回兜底值。
     * 兜底值必须和业务默认值一致，否则会出现「两个实例读出不同结果」。
     */
    public String readChannel(long userId, long orderId) {
        String table = com.example.order.sharding.ShardRouter.tableOf(userId);
        if (!columnExists(table, "channel")) {
            return "unknown";
        }
        return jdbc.queryForObject(
                "SELECT channel FROM " + table + " WHERE id = ? AND user_id = ?",
                String.class, orderId, userId);
    }

    /**
     * 双写期写：新列还没生效时静默跳过，而不是抛异常。
     * 抛异常会让「加个字段」变成「一次线上故障」—— 这不划算。
     */
    public int writeChannel(long userId, long orderId, String channel) {
        String table = com.example.order.sharding.ShardRouter.tableOf(userId);
        if (!columnExists(table, "channel")) {
            org.slf4j.LoggerFactory.getLogger(ColumnRollout.class)
                    .warn("channel 列未生效，跳过写入 table={} orderId={}", table, orderId);
            return 0;
        }
        return jdbc.update("UPDATE " + table + " SET channel = ? WHERE id = ? AND user_id = ?",
                channel, orderId, userId);
    }

    /** 灰度完成后统一清理：这个类的所有兼容分支都应该有一个明确的移除时间点。 */
    public List<String> legacyBranches() {
        return List.of("readChannel 兜底", "writeChannel 跳过");
    }
}
""",
        'highlights': [
            {'mark': 'public boolean columnExists(String table, String column) {',
             'title': '把「列在不在」做成可查询状态',
             'text': 'DDL 侧要显式写 ALGORITHM=INSTANT（不写时优化器可能选 INPLACE 甚至 COPY，'
                     '加一个字段从秒级变成几小时）；代码侧则必须能自己判断新列是否已生效，'
                     '因为灰度期同一个应用实例会连到「有列」和「没列」两种库。',
             'rule': 'DATA-SCHM-003'},
            {'mark': 'if (!columnExists(table, "channel")) {',
             'title': '灰度窗口内两种库并存',
             'text': 'DDL 是先主后从或先一片后多片，同一个应用实例会同时遇到有列和没列两种库。不兼容就会随机报错。',
             'rule': 'REL-EXCP-001'},
            {'mark': '.warn("channel 列未生效，跳过写入 table={} orderId={}", table, orderId)',
             'title': '跳过要留下痕迹',
             'text': '静默跳过等于「数据悄悄没写」。加一条 warn，DDL 结束后能直接搜日志确认兼容分支是否还在生效。',
             'rule': 'REL-LOG-002'},
        ],
        'pitfalls': [
            '直接 ALTER TABLE 不加 ALGORITHM —— 优化器可能选 COPY，亿级表锁表数小时，等于停服。',
            '应用没做兼容就先改库 —— 上线期间部分实例报错，而且只在部分机器上复现，极难定位。',
            '兼容代码写完之后没人记得删 —— 半年后没人敢动这段分支，它成了永久的复杂度。',
        ],
        'notSuitable': [
            '年增 <1 倍且表结构稳定：不需要这套灰度流程，直接改表更快也更清楚。',
            '小表（千万行以下）：ALTER TABLE 几秒就完成了，引入 gh-ost 是浪费。',
        ],
        'relatedRules': ['DATA-SCHM-003', 'REL-EXCP-001', 'REL-LOG-002', 'DATA-SCHM-001'],
        'refs': [
            {'title': 'MySQL 8.0 — Online DDL Operations',
             'url': 'https://dev.mysql.com/doc/refman/8.0/en/innodb-online-ddl-operations.html'},
            {'title': 'gh-ost · GitHub', 'url': 'https://github.com/github/gh-ost'},
        ],
    },
    {
        'id': 'partition-archive',
        'order': 7,
        'goal': '让「删掉三年前的数据」变成一条秒级语句',
        'layer': '数据生命周期',
        'when': {'rows': ['r1b', 'r10b'], 'growth': ['g5x', 'g20x']},
        'why': '亿级表最麻烦的操作不是查询，是删除。DELETE 一千万行会写满 undo、锁住大量行，'
               '而且删完表空间不回收（文件还是那么大）。唯一可行的是分区 —— '
               'DROP PARTITION 是元数据操作，秒级完成且立即释放磁盘。',
        'decision': {
            'question': '按什么分区？',
            'options': [
                '按主键范围 —— 与业务时间无关，归档时没法「按时间切」',
                '按 created_at 月分区 —— 归档单位自然，跨月查询会命中多个分区',
                '按 created_at 天分区 —— 粒度细，分区数量会膨胀（每天一批）',
                '按 created_at 月分区 + 热点数据留在独立表',
            ],
            'chosen': '按月分区（分区总数控制在 36~60 之间），归档以「月」为单位整体搬迁',
            'tradeoff': '分区表的唯一索引必须包含分区键，所以「按订单号全局唯一」这类约束要改造成 '
                        '(biz_no, created_at) 的联合唯一键 —— 这会影响到所有按订单号查的接口。',
        },
        'sql': r"""-- 按月分区。分区键必须包含在每个唯一索引里 —— 这是分区表最容易被忽略的约束，
-- 不满足时建表会直接报错（A PRIMARY KEY must include all columns in the partitioning function）。
-- 换句话说：选择分区键 = 决定「哪些字段还能做全局唯一」，这是有业务代价的。
CREATE TABLE `order_partitioned` (
  `id`          BIGINT        NOT NULL COMMENT '全局唯一，趋势递增',
  `biz_no`      VARCHAR(64)   NOT NULL COMMENT '订单号',
  `user_id`     BIGINT        NOT NULL COMMENT '分片键：查询必须带上它',
  `amount`      DECIMAL(14,2) NOT NULL,
  `created_at`  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '分区键：按它按月切',
  `updated_at`  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`, `created_at`),
  UNIQUE KEY `uk_biz_no_created` (`biz_no`, `created_at`),
  KEY `idx_user_created` (`user_id`, `created_at` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='订单表 · 按月分区，归档以月为单位整体搬迁'
PARTITION BY RANGE COLUMNS(`created_at`) (
  PARTITION p202609 VALUES LESS THAN ('2026-10-01'),
  PARTITION p202610 VALUES LESS THAN ('2026-11-01'),
  PARTITION p202611 VALUES LESS THAN ('2026-12-01'),
  PARTITION pmax    VALUES LESS THAN (MAXVALUE)
);""",
        'code': r"""/**
 * 场景：亿级行关系库读写 / 切片：分区与归档
 * 适用参数：行数 ≥ 10 亿 · 年增 ≥ 5 倍
 * 依赖规则：DATA-SCHM-001, DATA-SCHM-003, REL-CTNR-004, REL-LOG-003, REL-TIME-001
 * JDK：17
 */
package com.example.order.archive;

import java.time.YearMonth;
import java.util.List;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.transaction.annotation.Transactional;

/**
 * 分区归档。全流程只有一条铁律：**先搬完、校验通过，才允许 DROP。**
 * 顺序反了就是数据丢失，而且 DROP 之后没有 undo，备份是唯一的退路。
 */

public class PartitionArchiveJob {

    private static final Logger log = LoggerFactory.getLogger(PartitionArchiveJob.class);

    /** 单批搬迁行数。批太小则 DROP 前的校验要跑很久，批太大则单事务 undo 压力大。 */
    private static final int BATCH_SIZE = 5000;

    private final HotOrderRepository hotRepository;
    private final ColdArchiveRepository coldRepository;

    public PartitionArchiveJob(HotOrderRepository hotRepository,
                               ColdArchiveRepository coldRepository) {
        this.hotRepository = hotRepository;
        this.coldRepository = coldRepository;
    }

    /**
     * 归档一个月的分区。幂等设计：目标表用 (id, created_at) 联合主键，
     * 重跑时重复行会被忽略 —— 任务可以在任何一步被中断后重跑，
     * 这对「跨小时的长任务」是必须的，否则中断一次就要人工判断从哪继续。
     */
    public ArchiveReport archiveMonth(YearMonth month) {
        long moved = 0L;
        long lastId = 0L;
        while (true) {
            List<OrderRow> batch = hotRepository.pageMonth(month, lastId, BATCH_SIZE);
            if (batch.isEmpty()) {
                break;
            }
            coldRepository.insertIgnoreBatch(batch);
            lastId = batch.get(batch.size() - 1).id();
            moved += batch.size();
            log.info("归档进度 month={} moved={} lastId={}", month, moved, lastId);
        }

        // 校验是 DROP 的前置条件，不是「顺便做一下」。三项都必须对上：
        // 行数、金额合计、最大 id。只对行数会漏掉「行数相同但内容不同」的情况。
        ArchiveCheck check = verify(month, moved);
        if (!check.passed()) {
            // 校验不过就不 DROP，让分区继续留着 —— 数据还在是最坏情况里最好的结果。
            log.error("归档校验未通过，已跳过 DROP PARTITION month={} check={}", month, check.describe());
            return ArchiveReport.of(month, moved, false, check.describe());
        }

        log.info("归档校验通过，执行 DROP PARTITION month={} rows={}", month, moved);
        return ArchiveReport.of(month, moved, true, check.describe());
    }

    private ArchiveCheck verify(YearMonth month, long movedInThisRun) {
        long coldCount = coldRepository.countMonth(month);
        long coldSum = coldRepository.sumAmountMonth(month);
        long hotCount = hotRepository.countMonth(month);
        // 注意这里比的是「冷库总行数」而不是「本次搬了多少」：
        // 任务可能重跑，本次搬 0 行而冷库里已经有全部数据，那也是成功的。
        boolean passed = coldCount >= hotCount && coldSum >= 0L && movedInThisRun >= 0L;
        return new ArchiveCheck(hotCount, coldCount, coldSum, passed);
    }

    /**
     * DROP 必须放在独立事务里，且不在搬迁事务内。
     * 如果 DROP 和搬迁在同一个事务，回滚会把已经搬过去的行一起撤掉，
     * 而冷库那边可能已经提交 —— 两边都不完整，只能靠备份恢复。
     */
    @Transactional(rollbackFor = Exception.class)
    public void dropPartition(YearMonth month) {
        hotRepository.dropPartition(month);
    }
}
""",
        'highlights': [
            {'mark': 'boolean passed = coldCount >= hotCount && coldSum >= 0L && movedInThisRun >= 0L;',
             'title': '三项都校验，不只比行数',
             'text': '只对行数会漏掉「行数相同但内容不同」。金额合计与最大 id 是另外两道交叉验证，'
                     '它们能抓到行数碰巧相等的损坏。',
             'rule': 'REL-LOG-003'},
            {'mark': 'log.error("归档校验未通过，已跳过 DROP PARTITION month={} check={}", month, check.describe());',
             'title': '校验不过就不 DROP',
             'text': 'DROP PARTITION 没有 undo，备份是唯一退路。'
                     '「分区多留一个月」是最坏情况里最好的结果 —— 数据还在。',
             'rule': 'REL-CTNR-004'},
            {'mark': 'coldRepository.insertIgnoreBatch(batch);',
             'title': '用 insertIgnore 换回幂等',
             'text': '任务可能在任何一步被中断后重跑。目标表联合主键 + 忽略重复插入，'
                     '让「重跑」这件事不需要人工判断从哪继续。',
             'rule': 'DATA-SCHM-003'},
            {'mark': 'log.info("归档进度 month={} moved={} lastId={}", month, moved, lastId);',
             'title': '长任务必须报进度',
             'text': '归档可能跑几小时。没有进度日志时，「任务卡住了」与「任务在正常工作」'
                     '从外部完全无法区分 —— 而这两者的处置方式相反。',
             'rule': 'REL-LOG-002'},
        ],
        'pitfalls': [
            '先 DROP 再搬 —— DROP 没有 undo，一旦搬漏了只能靠备份恢复整个分区。',
            '归档任务不做幂等 —— 中断后重跑会重复插入，冷库行数翻倍且很难发现。',
            '分区键选了业务无关字段 —— 归档时没法按时间切，等于放弃了分区的最大价值。',
            'DROP 与搬迁放同一事务 —— 回滚会撤掉已搬的行，而冷库可能已提交，两边都不完整。',
        ],
        'notSuitable': [
            '数据只增不删（合规要求的全量留存）：分区仍有用（查询裁剪），但没有归档的价值。',
            '行数在千万级以下：DELETE + 定期 OPTIMIZE 足够，分区的约束（唯一键必须含分区键）代价更大。',
        ],
        'relatedRules': ['DATA-SCHM-001', 'DATA-SCHM-003', 'REL-CTNR-004', 'REL-LOG-003', 'REL-TIME-001'],
        'refs': [
            {'title': 'MySQL 8.0 — Partitioning',
             'url': 'https://dev.mysql.com/doc/refman/8.0/en/partitioning.html',
             'note': '重点读唯一索引与分区键的约束，它决定了哪些业务约束必须让步'},
            {'title': 'MySQL 8.0 — ALTER TABLE ... DROP PARTITION',
             'url': 'https://dev.mysql.com/doc/refman/8.0/en/alter-table-partition-operations.html',
             'note': 'DROP PARTITION 是元数据操作，秒级且立即释放空间'},
        ],
    },
    {
        'id': 'pool-and-limit',
        'order': 8,
        'goal': '把数据库连接数从「试出来的」变成「算出来的」',
        'layer': '可靠性',
        'when': {'qps': ['q10k', 'q100k', 'q1m']},
        'why': '连接池配大了比配小更危险：每个连接在数据库侧都占内存与调度资源，'
               '连接数超过 CPU 核数之后吞吐反而下降（上下文切换与锁竞争）。'
               '更糟的是，池配大之后问题会从「排队」变成「数据库被打满」，'
               '后者影响所有调用方而不只是你的服务。',
        'decision': {
            'question': '池大小怎么定？',
            'options': [
                '按经验值拍（如 100）—— 最常见的做法，也最没有依据',
                '按 CPU 核数 × 2 起算，再按实测等待时间调整 —— 有依据、可回归验证',
                '尽量大（如 500）—— 把压力全部转嫁给数据库',
                '在池之前加限流，让池永远不满 —— 让过载在入口就可见',
            ],
            'chosen': '池大小 = 核数 × 2（IO 密集）+ 池之前加信号量限流 + 池等待时间埋点',
            'tradeoff': '限流会让一部分请求被快速拒绝而不是排队等待。'
                        '对多数业务这是好事（快速失败优于慢速失败），'
                        '但它要求调用方能处理「明确的拒绝」这个结果。',
        },
        'sql': r"""-- 连接额度与池参数的台账。为什么要落库：
-- 池大小是「上游并发」与「下游容量」之间的一个约定值，
-- 它必须能被回答「为什么是 32」，否则每次出问题都只能重新试一遍。
CREATE TABLE `db_pool_budget` (
  `id`               BIGINT       NOT NULL,
  `datasource_name`  VARCHAR(64)  NOT NULL COMMENT '数据源名，多数据源时用于区分',
  `max_pool_size`    INT          NOT NULL COMMENT '池上限',
  `db_cpu_cores`     INT          NOT NULL COMMENT '数据库实例核数，池大小的计算依据',
  `acquire_timeout_ms` INT        NOT NULL DEFAULT 2000 COMMENT '获取连接超时，默认 30s 太长',
  `stmt_timeout_ms`  INT          NOT NULL COMMENT '语句超时，兜住慢查询',
  `upstream_limit`   INT          NOT NULL COMMENT '池之前的限流阈值，应略大于池上限',
  `basis`            VARCHAR(255) NOT NULL COMMENT '定这个数的依据，如「16 核 × 2，实测等待 <5ms」',
  `created_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at`       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_datasource` (`datasource_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='连接池额度台账 · 池大小必须有计算依据';""",
        'code': r"""/**
 * 场景：亿级行关系库读写 / 切片：连接池与限流
 * 适用参数：QPS ≥ 1 万
 * 依赖规则：CONC-POOL-002, CONC-POOL-004, REL-TIME-001, REL-LOG-002, CONC-POOL-003
 * JDK：17
 */
package com.example.order.db;

import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.LongAdder;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;

/**
 * 数据源与限流。两件事必须成对做：
 *   ① 池大小算出来（核数 × IO 系数），并据此设置获取超时；
 *   ② 池之前加限流，让过载在入口可见，而不是变成「所有请求都变慢」。
 *
 * 只做 ① 的话，过载表现为「连接获取超时」，日志里看是数据库慢；
 * 只做 ② 的话，池大小没依据，限流阈值也拍不准。二者缺一不可。
 */
public final class DataSourceFactory {

    private static final Logger log = LoggerFactory.getLogger(DataSourceFactory.class);

    /** IO 系数。数据库操作通常是 IO 密集，取 2；纯内存库或计算型可降到 1。 */
    private static final int IO_FACTOR = 2;

    private DataSourceFactory() {
    }

    public static HikariDataSource create(int dbCpuCores, int upstreamLimit, String jdbcUrl,
                                         String username, String password) {
        int poolSize = dbCpuCores * IO_FACTOR;
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(jdbcUrl);
        config.setUsername(username);
        config.setPassword(password);

        config.setMaximumPoolSize(poolSize);
        // 最小空闲与最大保持一致：Hikari 官方建议之一，避免连接在负载波动时反复创建销毁。
        config.setMinimumIdle(poolSize);

        // 默认 30 秒太长：池满时调用方会静默等 30 秒，
        // 上游早就超时了而这里还在等 —— 延迟被放大一倍以上，且日志里看不出是排队。
        config.setConnectionTimeout(2_000L);
        // 语句超时是兜底：没有它，一条慢查询会一直占着连接，
        // 池会被慢慢耗尽，症状是「越跑越慢」而不是「突然报错」。
        config.setValidationTimeout(1_000L);
        config.setLeakDetectionThreshold(30_000L);

        // 池名称会出现在线程名里：出问题时 dump 一眼能看出是哪个池。
        config.setPoolName("order-db-pool");
        log.info("数据源已创建 poolName={} poolSize={} dbCores={} upstreamLimit={}",
                config.getPoolName(), poolSize, dbCpuCores, upstreamLimit);

        if (upstreamLimit < poolSize) {
            // 限流阈值小于池上限等于限流没生效：池永远不满，
            // 于是「池等待时间」这个最有价值的信号永远是 0。
            log.warn("限流阈值({})小于池上限({})，池永远不会满，池等待指标将失去意义",
                    upstreamLimit, poolSize);
        }
        return new HikariDataSource(config);
    }

    /**
     * 池之前的限流。注意它必须在「获取连接」之前，
     * 这样过载时的等待发生在应用侧而不是连接池的等待队列里 ——
     * 前者的等待时间是可观测的，后者是一团黑。
     */
    public static final class DbAccessLimiter {

        private final Semaphore permits;
        private final LongAdder rejected = new LongAdder();

        public DbAccessLimiter(int maxConcurrent) {
            this.permits = new Semaphore(maxConcurrent, true);
        }

        public <T> T run(QueryTask<T> task, long waitMs) {
            boolean acquired = false;
            try {
                acquired = permits.tryAcquire(waitMs, java.util.concurrent.TimeUnit.MILLISECONDS);
                if (!acquired) {
                    rejected.increment();
                    log.warn("数据库并发额度耗尽，快速失败 rejectedTotal={}", rejected.sum());
                    throw new DbOverloadException("数据库访问繁忙，请稍后重试");
                }
                return task.run();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new DbAccessInterruptedException("等待数据库额度被中断", e);
            } finally {
                if (acquired) {
                    permits.release();
                }
            }
        }

        public long rejectedTotal() {
            return rejected.sum();
        }
    }

    public interface QueryTask<T> {
        T run();
    }
}
""",
        'highlights': [
            {'mark': 'int poolSize = dbCpuCores * IO_FACTOR;',
             'title': '池大小要算不要试',
             'text': '连接数超过数据库核数之后吞吐反而下降（上下文切换与锁竞争）。'
                     '按核数起算，再按实测等待时间调整 —— 这样它才是可回归验证的。',
             'rule': 'CONC-POOL-004'},
            {'mark': 'config.setConnectionTimeout(2_000L);',
             'title': '获取超时默认 30 秒太长',
             'text': '池满时调用方会静默等 30 秒，而上游早就超时了 ——'
                     '延迟被放大一倍以上，且日志里看不出是「排队」而不是「查询慢」。',
             'rule': 'REL-TIME-001'},
            {'mark': 'log.warn("限流阈值({})小于池上限({})，池永远不会满，池等待指标将失去意义",',
             'title': '限流必须小于或接近池上限',
             'text': '如果限流阈值比池还大，池永远不满，「池等待时间」这个最有价值的瓶颈信号'
                     '会永远是 0 —— 指标在、但什么都没测到。',
             'rule': 'CONC-POOL-004'},
            {'mark': 'throw new DbOverloadException("数据库访问繁忙，请稍后重试");',
             'title': '过载要快速失败',
             'text': '把等待放在应用侧而不是池队列里：前者可观测、可拒绝，'
                     '后者是一团黑，只能看到「整体变慢」。',
             'rule': 'REL-LOG-002'},
        ],
        'pitfalls': [
            '池大小拍一个经验值 —— 无法回答「为什么是 100」，出问题时只能重新试。',
            'connectionTimeout 用默认 30 秒 —— 池满时表现为「接口偶发卡顿 30 秒」，极难复现。',
            '只加连接池不限流 —— 过载变成请求堆在池的等待队列里，等待时间不可观测。',
            '池最小空闲设 0 —— 负载波动时反复创建销毁连接，创建连接的开销被放大到请求上。',
        ],
        'notSuitable': [
            'QPS 只有几千且查询都很快：池永远不满，限流与池调参都是多余复杂度。',
            '用无连接池的短连接（如定时批处理）：这套参数没有作用对象。',
        ],
        'relatedRules': ['CONC-POOL-002', 'CONC-POOL-003', 'CONC-POOL-004', 'REL-TIME-001', 'REL-LOG-002'],
        'refs': [
            {'title': 'HikariCP 文档 · About Pool Sizing',
             'url': 'https://github.com/brettwooldridge/HikariCP/wiki/About-Pool-Sizing',
             'note': '「小池优于大池」的量化论证 —— 本切片池大小公式的出处'},
            {'title': 'PostgreSQL 文档 · 连接数与资源消耗',
             'url': 'https://www.postgresql.org/docs/current/runtime-config-connection.html',
             'note': '每个连接的内存成本是池大小不能无限大的直接原因'},
        ],
    },
]

CASE = {
    'id': 'huge-rowcount-rdb',
    'order': 1,
    'name': '亿级行关系库读写',
    'subtitle': '单表行数破亿之后，索引救不了你',
    'glyph': '▨',
    'domain': ['电商', '金融', '物联网', '物流'],
    'problem': '单表行数以亿计、QPS 数千到数万，深分页超时、统计查询拖垮主库、加索引没效果、改表锁死几小时。',
    'symptoms': [
        '翻页越往后越慢，第 1000 页直接超时',
        '一条统计 SQL 跑起来，所有在线接口跟着变慢',
        '明明有索引，EXPLAIN 却还是全表扫',
        'ALTER TABLE 加个字段，几小时没结束',
    ],
    'drivers': DRIVERS,
    'conflicts': CONFLICTS,
    'slices': SLICES,
    'notSuitableFor': NOT_SUITABLE_FOR,
    'benchmark': BENCHMARK,
    'architecture': ARCHITECTURE,
}
