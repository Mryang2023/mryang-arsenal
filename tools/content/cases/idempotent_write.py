# -*- coding: utf-8 -*-
"""场景 9 · 幂等写入：同一个请求被送进来两次，怎么保证只生效一次。

为什么单独立一个场景：重复不是边缘情况，它是分布式系统的默认状态 ——
   ① 用户狂点提交按钮（页面没禁用、网络慢，点了没反应就再点一次）；
   ② 上游超时后自动重试（下游其实已经成功，上游以为失败）；
   ③ MQ 至少一次投递语义（重投是设计内的，不是故障）；
   ④ 定时任务多副本同时触发（每个副本都认为该自己跑）。

四条来源的**重复窗口**完全不同：用户连点是毫秒级，MQ 重投是秒~分钟级，
补偿任务可能是跨天。窗口决定了幂等键要存多久 —— 这是本场景最核心的一个旋钮。

核心骨架是「先分类，再选兜底」：
   先按 HTTP 语义把天生幂等的操作摘出去（GET/PUT/DELETE 不需要任何防护），
   剩下的 POST 创建与消费型入口，在 5 种兜底里按「重复窗口 + 一致性要求 + 有没有全局 ID」选。
"""

DRIVERS = [
    {'id': 'caller', 'name': '调用来源', 'unit': '', 'hint': '重复请求是谁发出来的',
     'levels': [
         {'id': 'user', 'label': '用户重复点', 'note': '页面提交 / 表单重复提交'},
         {'id': 'retry', 'label': '上游重试', 'note': '超时后调用方自动重试'},
         {'id': 'mq', 'label': '消息重投', 'note': '至少一次投递，重投是设计内的'},
         {'id': 'job', 'label': '定时任务', 'note': '多副本同时触发 / 补偿重跑'},
     ]},
    {'id': 'window', 'name': '重复窗口', 'unit': '', 'hint': '两次相同请求可能相隔多久 —— 决定幂等键存多久',
     'levels': [
         {'id': 'ms', 'label': '毫秒级', 'note': '连点 / 网关重放，同一瞬间的重复'},
         {'id': 'min', 'label': '分钟级', 'note': 'MQ 重投 / 上游超时重试'},
         {'id': 'hour', 'label': '小时级', 'note': '补偿任务 / 人工重触发'},
         {'id': 'day', 'label': '跨天', 'note': '对账重跑 / 隔日补单'},
     ]},
    {'id': 'consistency', 'name': '一致性要求', 'unit': '', 'hint': '重复一次能不能忍',
     'levels': [
         {'id': 'best', 'label': '尽力而为', 'note': '重复可接受，如埋点 / 计数'},
         {'id': 'exactly', 'label': '恰好一次', 'note': '重复即资损，如扣款 / 下单'},
         {'id': 'atLeast', 'label': '至少一次 + 下游幂等', 'note': '允许重复投递，但下游必须能挡'},
     ]},
    {'id': 'globalId', 'name': '有无全局 ID', 'unit': '', 'hint': '有没有一个可去重的业务键',
     'levels': [
         {'id': 'yes', 'label': '有', 'note': '上游下发或本系统生成的业务唯一键'},
         {'id': 'no', 'label': '没有', 'note': '必须先造键，否则去重无从下手'},
     ]},
    {'id': 'store', 'name': '幂等存储', 'unit': '', 'hint': '拿什么记住「已经做过」',
     'levels': [
         {'id': 'none', 'label': '无', 'note': '没有任何去重设施'},
         {'id': 'mysql', 'label': 'MySQL 唯一键', 'note': '持久、与业务同事务'},
         {'id': 'redis', 'label': 'Redis SETNX', 'note': '快、跨实例，但会过期'},
         {'id': 'both', 'label': '两者都有', 'note': 'Redis 挡并发 + MySQL 留痕'},
     ]},
]

CONFLICTS = [
    {'when': {'consistency': ['exactly'], 'store': ['none']},
     'text': '要求「恰好一次」却没有任何幂等存储：能保证恰好一次的手段只有三类 —— 唯一键、'
             '状态机、分布式锁，三样都没有时「恰好一次」在数学上做不到。要么补存储，'
             '要么把要求降级成「至少一次 + 对账补偿」，别在文档里写一个兑现不了的承诺。'},
    {'when': {'caller': ['mq', 'job'], 'globalId': ['no'], 'consistency': ['exactly']},
     'text': '消息 / 定时触发 + 没有全局业务 ID + 要求恰好一次：唯一键与 SETNX 都需要一个键才能去重，'
             '没有键就只能按请求内容算指纹（内容哈希），而内容哈希会把「两次真实的独立请求」也误判成重复。'
             '先让上游下发幂等键，或改用业务上天然唯一的字段组合。'},
    {'when': {'window': ['day'], 'store': ['redis']},
     'text': '重复窗口跨天但幂等存储只有 Redis：Redis 的幂等键必然带过期时间，'
             '过期即失忆，跨天之后进来的重复请求会被当成新请求放行。跨天窗口必须落到'
             '持久化存储（MySQL 唯一键 / 幂等表），或把过期时间显式设成大于窗口。'},
]

NOT_SUITABLE_FOR = [
    {'when': {'consistency': ['best']},
     'reason': '只要求尽力而为（埋点上报、浏览计数、日志采集）：重复带来的误差可接受，'
               '建幂等表与核销逻辑的成本高于收益。这类场景应该做的是「至少一次 + 下游可容忍重复」，'
               '而不是把每一次写入都套上幂等。'},
    {'when': {'store': ['none'], 'window': ['ms']},
     'reason': '没有任何幂等存储、且重复窗口只在毫秒级：说明重复只可能来自同一请求的瞬时重放'
               '（网关重试 / 负载均衡重发），这类重复应在网关或框架层去重，'
               '而不是在业务代码里建幂等表 —— 业务侧建了也挡不住网络层的重放。'},
    {'when': {'caller': ['user'], 'globalId': ['no'], 'consistency': ['exactly']},
     'reason': '用户提交、没有业务键、还要求恰好一次：用户侧的重复提交唯一可靠的去重依据是'
               '「一次性令牌」（切片 2），用请求内容去猜「是不是同一次提交」必然误判。'
               '先把令牌机制建起来，再谈一致性级别。'},
]

BENCHMARK = {
    'title': '重试放大：一次下游抖动会被放大成多少倍流量（算术推导，不是压测实测）',
    'columns': ['重试层次', '每层重试次数', '最坏放大倍数', '为什么'],
    'rows': [
        ['只在上游重试（单层）', '3', '×3', '每个失败请求最多再发 2 次'],
        ['网关 + 调用方（两层）', '3 × 3', '×9', '网关不知道调用方会重试，各自重试叠加'],
        ['网关 + 调用方 + 本地（三层）', '3 × 3 × 3', '×27', '每层都以为只有自己在重试'],
    ],
    'conclusion': '放大倍数是各层重试次数的**乘积**，不是相加 —— 这是算术，不是实测压测数据。'
                  '所以重试只能放在一层，且必须配退避与上限；没有上限的重试等于把一次抖动变成雪崩。'
                  '本表刻意不提供延迟与吞吐数值 —— 那些随环境变化，编出来的数字比没有更糟。',
}

ARCHITECTURE = {
    'nodes': [
        {'id': 'entry', 'label': '入口（Controller / 监听器）', 'kind': 'backend', 'tier': 0},
        {'id': 'trigger', 'label': '消息 / 定时触发', 'kind': 'messagebus', 'tier': 0,
         'whenAny': {'caller': ['mq', 'job']}},
        {'id': 'token', 'label': '一次性令牌', 'kind': 'database', 'tier': 1,
         'whenAny': {'caller': ['user']}},
        {'id': 'uk', 'label': '唯一键 / 幂等表', 'kind': 'database', 'tier': 1,
         'whenAny': {'store': ['mysql', 'both']}},
        {'id': 'nx', 'label': 'Redis SETNX', 'kind': 'database', 'tier': 1,
         'whenAny': {'store': ['redis', 'both']}},
        {'id': 'biz', 'label': '业务表（状态机）', 'kind': 'database', 'tier': 2},
        {'id': 'retry', 'label': '重试台账', 'kind': 'database', 'tier': 2,
         'whenAny': {'caller': ['retry', 'mq', 'job']}},
        {'id': 'dlq', 'label': '死信', 'kind': 'database', 'tier': 3,
         'whenAny': {'caller': ['retry', 'mq', 'job']}},
    ],
    'links': [
        {'from': 'trigger', 'to': 'entry', 'label': '重投 / 重触发'},
        {'from': 'entry', 'to': 'token', 'label': '核销'},
        {'from': 'entry', 'to': 'uk', 'label': '去重'},
        {'from': 'entry', 'to': 'nx', 'label': '抢键'},
        {'from': 'uk', 'to': 'biz', 'label': '落库'},
        {'from': 'nx', 'to': 'biz', 'label': '放行后写'},
        {'from': 'entry', 'to': 'retry', 'label': '失败登记'},
        {'from': 'retry', 'to': 'dlq', 'label': '超上限'},
    ],
}

SLICES = [
    {
        'id': 'semantics',
        'order': 1,
        'goal': '先划边界：哪些操作天然幂等不用管，哪些必须自己保证',
        'layer': '接口',
        'when': {'caller': ['user', 'retry', 'mq', 'job']},
        'why': '幂等的第一件事不是选方案，是确认「这个接口到底需不需要防」。'
               'GET / PUT / DELETE 在 HTTP 语义上本就幂等（WEB-CTRL-006），给它们加幂等表是白付成本；'
               '真正要防的是 POST 创建类，以及 MQ 消费 / 定时任务 / 上游重试这些「别人替你点第二次」的入口。'
               '这一步做错，后面五种兜底都是在错的地方使劲。',
        'decision': {
            'question': '哪些请求需要幂等防护？',
            'options': [
                '所有接口一律加幂等表 —— 给读接口也加，成本白付还拖慢查询',
                '只有 POST 创建类加 —— 漏掉消费 / 定时 / 重试这条链路，那才是重复的重灾区',
                '按语义分：GET/PUT/DELETE 天然幂等不加；POST 创建与所有消费型入口必须加',
                '交给下游自己保证 —— 责任外包，出事时说不清是谁的',
            ],
            'chosen': '按 HTTP 语义先切两半（WEB-CTRL-006）：GET / PUT / DELETE 天然幂等，不加；'
                      'POST 创建类与所有「非用户直接发起」的入口（消费 / 定时 / 重试）显式做幂等。',
            'tradeoff': '代价是入口处要先做一次归类，并把它写进接口文档；'
                        '收益是幂等设施只建在真正会重复的地方，不为绝大多数读接口付成本。',
        },
        'sql': r"""-- 创建类接口的对象表。它自己不防重复 —— 同一份业务内容可以落两条，
-- 防重要靠后面的唯一键（切片 3）与状态机（切片 4）。
CREATE TABLE `biz_order` (
  `id`         BIGINT      NOT NULL AUTO_INCREMENT,
  `biz_type`   VARCHAR(32) NOT NULL COMMENT '业务类型，如 ORDER / REFUND',
  `biz_key`    VARCHAR(64) NOT NULL COMMENT '业务唯一键：上游下发或本系统生成',
  `user_id`    BIGINT      NOT NULL,
  `amount`     BIGINT      NOT NULL COMMENT '金额（分），不用浮点',
  `status`     VARCHAR(16) NOT NULL DEFAULT 'init' COMMENT 'init/paid/canceled',
  `version`    INT         NOT NULL DEFAULT 0 COMMENT '乐观锁版本号',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='业务单据 · 幂等写入的落点';""",
        'code': r"""/**
 * 场景：幂等写入 / 切片：先分清哪些操作需要自己保证幂等
 * 适用参数：任何调用来源（user / retry / mq / job）
 * 依赖规则：WEB-CTRL-006, WEB-DTO-001
 * JDK：17
 */
package com.example.app.idem;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 幂等不是「所有接口都加一层」。按 HTTP 语义先切两半（WEB-CTRL-006）：
 *   · GET / PUT / DELETE —— 天然幂等：查、整量替换、删除，重复执行一次与一次的最终状态等价。
 *   · POST 创建 —— 每调用一次就多一条记录，必须自己保证（后续 5 个切片就是 5 种保证方式）。
 *
 * 最容易被漏掉的不是用户狂点，而是 MQ 重投 / 定时任务多副本 / 上游超时重试 ——
 * 它们是「别人替你点第二次」，入口根本不在页面上。
 */
@RestController
@RequestMapping("/orders")
public class OrderSemanticsController {

    private final OrderService orders;

    public OrderSemanticsController(OrderService orders) {
        this.orders = orders;
    }

    /** GET 天然幂等：不改变任何状态，查一百次与查一次结果相同。 */
    @GetMapping("/{id}")
    public ResponseEntity<OrderView> detail(@PathVariable Long id) {
        return ResponseEntity.ok(orders.load(id));
    }

    /** PUT 天然幂等：整量替换，同一份内容写多次与写一次的最终状态一致。 */
    @PutMapping("/{id}")
    public ResponseEntity<Void> replace(@PathVariable Long id, @RequestBody OrderCommand cmd) {
        orders.replace(id, cmd);
        return ResponseEntity.noContent().build();
    }

    /** DELETE 天然幂等：删一次与删多次的最终状态都是「不存在」。 */
    @DeleteMapping("/{id}")
    public ResponseEntity<Void> cancel(@PathVariable Long id) {
        orders.cancel(id);
        return ResponseEntity.noContent().build();
    }

    /** POST 创建不幂等：每调用一次就多一条 —— 必须自己保证（见后续切片）。 */
    @PostMapping
    public ResponseEntity<Long> create(@RequestBody OrderCommand cmd) {
        return ResponseEntity.ok(orders.create(cmd));
    }
}

/** 专用 DTO：不拿实体当入参，字段边界清楚（WEB-DTO-001）。 */
record OrderCommand(String bizType, String bizKey, long amount) {}

/** 出参视图（示意）。 */
record OrderView(Long id, String status) {}

/** 服务契约（示意）。 */
interface OrderService {
    OrderView load(Long id);
    void replace(Long id, OrderCommand cmd);
    void cancel(Long id);
    Long create(OrderCommand cmd);
}""",
        'highlights': [
            {'mark': '@GetMapping("/{id}")',
             'title': '天然幂等，不用加防护',
             'text': 'GET 不改变任何状态，重复执行与执行一次等价。给读接口加幂等表只会拖慢查询、'
                     '白付存储成本 —— WEB-CTRL-006 要求的正是「方法与语义一致」。',
             'rule': 'WEB-CTRL-006'},
            {'mark': '@PostMapping',
             'title': '创建类必须自己保证',
             'text': 'POST 每调用一次就多一条记录，语义上不幂等。它是本场景全部兜底方案的落点，'
                     '也是 MQ / 定时 / 重试链路里真正出事的地方。',
             'rule': 'WEB-CTRL-006'},
            {'mark': 'record OrderCommand(',
             'title': '入参用专用 DTO',
             'text': '入参边界清楚，幂等键（bizType + bizKey）才能作为显式字段被声明与校验，'
                     '而不是躲在实体里等某个拦截器去猜。',
             'rule': 'WEB-DTO-001'},
        ],
        'pitfalls': [
            '给所有接口无差别加幂等表 —— 读接口占了大多数，成本白付，查询还多一次写。',
            '只盯着用户狂点，漏掉 MQ 重投与定时多副本 —— 后者的重复量级远大于前者，且没有页面可拦。',
            '用 DELETE 的「天然幂等」为接口副作用开脱 —— 幂等指的是状态结果，不是「日志/消息没有多发出去」。',
        ],
        'notSuitable': [
            '接口本身就是纯查询、没有任何写副作用：这一片对你没有新增信息，直接跳过。',
            '已经把写操作全部改成 PUT 整量替换（天然幂等）：优先级应放在「替换内容是否完整」上，而不是去重。',
        ],
        'relatedRules': ['WEB-CTRL-006', 'WEB-DTO-001'],
        'refs': [
            {'title': 'RFC 9110 · HTTP Semantics：Safe and Idempotent Methods',
             'url': 'https://www.rfc-editor.org/rfc/rfc9110.html#name-idempotent-methods'},
            {'title': 'MDN · HTTP 请求方法（幂等性与安全性对照）',
             'url': 'https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Methods'},
        ],
    },
    {
        'id': 'token',
        'order': 2,
        'goal': '一次性令牌：先领令牌再提交，服务端核销成功才落业务',
        'layer': '接口',
        'when': {'caller': ['user'], 'window': ['ms', 'min'], 'globalId': ['no']},
        'why': '没有全局业务 ID 时（globalId = no），同一个人连点两次在服务端看就是「两个合法请求」，'
               '没有任何字段能把它们认成同一件事 —— 唯一键与 SETNX 都因为缺键而无从下手。'
               '一次性令牌把「同一次提交意图」显式化：提交前先领一个令牌，提交时带上，'
               '服务端核销成功才真正处理。核销必须用条件更新（DATA-SQL-004），'
               '先查后判在并发下会同时通过。',
        'decision': {
            'question': '怎么判断两次提交是「同一次意图」？',
            'options': [
                '按请求内容哈希 —— 用户改一个字再提交就被当成新请求，防不住真正的重复',
                '前端提交后禁用按钮 —— 只能防一半，刷新 / 后退 / 接口慢照样重复',
                '服务端发一次性令牌，提交时核销 —— 意图显式化，且天然带归属',
                '靠唯一业务键 —— 用户提交场景里往往根本没有业务键可用',
            ],
            'chosen': '服务端发一次性令牌（UUID），带归属用户与过期时间；提交时带令牌，'
                      '用条件更新核销（影响行数 1 才算抢到）。',
            'tradeoff': '代价是多一次「领令牌」请求，且前端必须配合带上它；'
                        '收益是不依赖任何业务字段就能挡住重复，顺带完成归属校验。',
        },
        'sql': r"""-- 幂等令牌：先领后交，服务端一次性核销。
CREATE TABLE `idem_token` (
  `id`         BIGINT      NOT NULL AUTO_INCREMENT,
  `token`      VARCHAR(64) NOT NULL COMMENT '一次性令牌',
  `user_id`    BIGINT      NOT NULL COMMENT '归属用户，核销时必须带上（SEC-AUTH-001）',
  `used`       TINYINT     NOT NULL DEFAULT 0 COMMENT '0=未用 1=已核销',
  `expire_at`  DATETIME(3) NOT NULL COMMENT '过期时间，必须大于重复窗口',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_token` (`token`),
  KEY `idx_expire` (`expire_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='幂等令牌 · 一次性核销';""",
        'code': r"""/**
 * 场景：幂等写入 / 切片：一次性令牌
 * 适用参数：用户重复提交，重复窗口毫秒~分钟级
 * 依赖规则：WEB-CTRL-006, DATA-SQL-004, SEC-AUTH-001
 * JDK：17
 */
package com.example.app.idem;

import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 一次性令牌：把「同一次提交意图」显式化。
 *
 * 关键在核销这一步：UPDATE 带 used = 0 条件，用影响行数判胜负。
 * 「先 SELECT 看有没有用过，再 UPDATE」是读-改-写裸奔（DATA-SQL-004）——
 * 两个请求会同时读到 used = 0，然后同时判自己成功。
 *
 * user_id 进 WHERE 不是可选的：它是归属校验（SEC-AUTH-001），
 * 否则任何人拿到令牌字符串都能核销掉别人的令牌。
 */
@RestController
@RequestMapping("/idem")
public class IdempotencyTokenController {

    private final JdbcTemplate jdbc;

    public IdempotencyTokenController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** 第一步：提交前先领一个一次性令牌。 */
    @GetMapping("/token")
    public ResponseEntity<String> issue(@RequestHeader("X-User-Id") long userId) {
        String token = UUID.randomUUID().toString().replace("-", "");
        jdbc.update("INSERT INTO idem_token (token, user_id, used, expire_at) "
            + "VALUES (?, ?, 0, NOW(3) + INTERVAL 30 MINUTE)", token, userId);
        return ResponseEntity.ok(token);
    }

    /** 第二步：提交时带上令牌，核销成功才真正落业务。 */
    @PostMapping("/orders")
    public ResponseEntity<String> create(@RequestHeader("X-User-Id") long userId,
                                         @RequestHeader("X-Idem-Token") String token) {
        if (!consume(token, userId)) {
            return ResponseEntity.status(409).body("重复提交");
        }
        return ResponseEntity.ok("accepted");
    }

    /** 一次性核销：影响行数 1 = 我抢到了；0 = 已被核销或已过期。 */
    private boolean consume(String token, long userId) {
        int n = jdbc.update(
            "UPDATE idem_token SET used = 1 WHERE token = ? AND user_id = ? AND used = 0 AND expire_at > NOW(3)",
            token, userId);
        return n == 1;
    }
}""",
        'highlights': [
            {'mark': 'public ResponseEntity<String> issue(',
             'title': '先领令牌，再提交',
             'text': '提交意图在服务端生成并登记，前端只是搬运。这样「同一次提交」有了唯一标识，'
                     '不再依赖请求内容去猜。',
             'rule': 'WEB-CTRL-006'},
            {'mark': 'UPDATE idem_token SET used = 1 WHERE token = ? AND user_id = ? AND used = 0 AND expire_at > NOW(3)',
             'title': '条件更新判胜负，不是先查后判',
             'text': '把「判断未使用」与「置为已用」压进同一条 SQL。先 SELECT 再 UPDATE 在并发下'
                     '会同时读到 used = 0 —— 这正是 DATA-SQL-004 禁止的读-改-写裸奔。',
             'rule': 'DATA-SQL-004'},
            {'mark': 'return n == 1;',
             'title': '影响行数就是答案',
             'text': '1 = 本次是第一次提交；0 = 已被核销或已过期。不需要额外的判断逻辑，'
                     '也不会有「两个请求都成功」的中间态。',
             'rule': 'DATA-SQL-004'},
        ],
        'pitfalls': [
            '先 SELECT 判断 used 再 UPDATE —— 并发下两个请求同时读到 0，重复提交照穿（DATA-SQL-004）。',
            '核销不带 user_id —— 任何人拿到令牌字符串都能核销掉别人的令牌，越权且可被重放（SEC-AUTH-001）。',
            '过期时间用应用本地时间算 —— 应用与数据库时区不一致会让令牌提前或延后失效；用库里的 NOW(3) 统一。',
        ],
        'notSuitable': [
            '调用来源不是用户（MQ 重投 / 定时任务）：没有「提交前领令牌」这个动作，只能用唯一键或状态机。',
            '有稳定的业务唯一键可用：直接用唯一键兜底更简单，不必多一次领令牌的往返。',
        ],
        'relatedRules': ['WEB-CTRL-006', 'DATA-SQL-004', 'SEC-AUTH-001'],
        'refs': [
            {'title': 'RFC 9110 · Idempotent Methods',
             'url': 'https://www.rfc-editor.org/rfc/rfc9110.html#name-idempotent-methods'},
            {'title': 'OWASP Cheat Sheet · Cross-Site Request Forgery Prevention（同步器令牌模式的同源思路）',
             'url': 'https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html'},
        ],
    },
    {
        'id': 'unique-key',
        'order': 3,
        'goal': '唯一键兜底：让数据库替你挡住第二条重复记录',
        'layer': '数据访问',
        'when': {'store': ['mysql', 'both'], 'globalId': ['yes'],
                 'consistency': ['exactly', 'atLeast']},
        'why': '所有幂等手段里，唯一键是唯一「不需要额外组件、且和业务同一个事务」的一种 —— '
               '它是最后一道防线：令牌失效、Redis 过期、状态机写错，只要唯一键还在，重复记录就进不来。'
               '代价是必须有一个可去重的键；没有全局 ID 时（globalId = no）要先造键，'
               '这是它唯一的硬前提。',
        'decision': {
            'question': '重复记录靠什么挡？',
            'options': [
                '应用层先查一次有没有，没有再插 —— 检查和插入之间有时间窗，并发下必漏',
                '数据库唯一键 + 捕获冲突 —— 冲突判定交给存储引擎，与业务同一事务',
                '分布式锁包住「查 + 插」 —— 多一个组件要维护，且锁失效时防线全无',
                '靠事后对账发现 —— 重复已经落库，资损已经发生',
            ],
            'chosen': '数据库唯一键兜底，应用层捕获 DuplicateKeyException 并转为「返回已有记录」。'
                      '事务边界放在 Service 的 public 方法上（SVC-TX-001），不在 Controller。',
            'tradeoff': '代价是必须有业务键，且冲突时多一次回查；'
                        '收益是防线与业务同事务、零额外组件、不可能被绕过。',
        },
        'sql': r"""-- 唯一键兜底：同一 (biz_type, biz_key) 在库里只可能存在一条。
ALTER TABLE `biz_order`
  ADD UNIQUE KEY `uk_biz_type_key` (`biz_type`, `biz_key`);

-- 冲突即重复：不要先 SELECT 判断存在再 INSERT（DATA-SQL-004）。
-- 直接 INSERT，让存储引擎在唯一索引上判冲突，应用层捕获后回查已有记录。""",
        'code': r"""/**
 * 场景：幂等写入 / 切片：唯一键兜底
 * 适用参数：有 MySQL 幂等存储，要求恰好一次或至少一次
 * 依赖规则：DATA-SQL-004, SVC-TX-001
 * JDK：17
 */
package com.example.app.idem;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 唯一键兜底：直接 INSERT，让存储引擎在唯一索引上判冲突。
 *
 * 为什么不「先查再插」：查与插之间有时间窗，两个请求会同时查到「不存在」，
 * 然后都插入成功 —— 这正是 DATA-SQL-004 禁止的读-改-写裸奔。
 * 唯一键把「判断」和「写入」合并成存储引擎的一次原子操作。
 *
 * 幂等的语义是「结果一致」，不是「报错」。所以冲突后回查已有的那条并返回，
 * 让第二次调用拿到与第一次完全相同的结果。
 */
@Service
public class OrderWriteService {

    private final JdbcTemplate jdbc;

    public OrderWriteService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** 事务边界在 Service 的 public 方法上（SVC-TX-001）。 */
    @Transactional(rollbackFor = Exception.class)
    public long createOnce(String bizType, String bizKey, long userId, long amount) {
        try {
            jdbc.update("INSERT INTO biz_order (biz_type, biz_key, user_id, amount) VALUES (?, ?, ?, ?)",
                bizType, bizKey, userId, amount);
            return jdbc.queryForObject("SELECT LAST_INSERT_ID()", Long.class);
        } catch (DuplicateKeyException e) {
            return jdbc.queryForObject(
                "SELECT id FROM biz_order WHERE biz_type = ? AND biz_key = ?", Long.class, bizType, bizKey);
        }
    }
}""",
        'highlights': [
            {'mark': '@Transactional(rollbackFor = Exception.class)',
             'title': '事务边界在 Service',
             'text': '事务开在 Service 的 public 方法上（SVC-TX-001），Controller 不碰事务。'
                     '唯一键与业务写入才能落在同一个事务里 —— 这是它比分布式锁可靠的原因。',
             'rule': 'SVC-TX-001'},
            {'mark': 'catch (DuplicateKeyException e) {',
             'title': '冲突即重复，不是异常',
             'text': '唯一键冲突说明「这条记录已经有了」。幂等的语义是结果一致，'
                     '所以转成回查并返回已有记录，而不是把异常抛给上游去重试。',
             'rule': 'DATA-SQL-004'},
            {'mark': 'INSERT INTO biz_order (biz_type, biz_key, user_id, amount) VALUES (?, ?, ?, ?)',
             'title': '直接插，让引擎判冲突',
             'text': '不先查。查与插之间的时间窗就是重复的入口 —— 唯一键把判断与写入合成一次原子操作。',
             'rule': 'DATA-SQL-004'},
        ],
        'pitfalls': [
            '先 SELECT 判断存在再 INSERT —— 时间窗内两个请求都查到「不存在」，重复照插（DATA-SQL-004）。',
            '把唯一键冲突当成异常往外抛 —— 上游收到 500 会重试，重复次数反而更多；幂等要求的是「返回同样结果」。',
            '唯一键拼进了可变字段（如时间戳、随机数）—— 每次都是新键，等于没有唯一键。',
            '在 catch 里复用同一个事务继续回查 —— MySQL 的唯一键冲突只回滚该语句、事务仍可用，'
            '但换成 PostgreSQL 这类「出错即整事务中止」的库就会直接报错；换库时把回查挪到新事务里。',
        ],
        'notSuitable': [
            '没有全局业务 ID（globalId = no）：没有键就建不了唯一键。先用一次性令牌把提交意图显式化，'
            '或让上游下发业务键 —— 在此之前这一片无从下手。',
            '没有幂等存储（store = none）：加不了唯一键，只能先补存储或改用上游令牌。',
            '业务上允许同键多条（如一个订单多次退款）：唯一键会误杀，应把区分字段（退款批次）拼进键里再建。',
        ],
        'relatedRules': ['DATA-SQL-004', 'SVC-TX-001'],
        'refs': [
            {'title': 'MySQL 8.0 Reference Manual · InnoDB and FOREIGN KEY / UNIQUE Constraints',
             'url': 'https://dev.mysql.com/doc/refman/8.0/en/innodb-foreign-key-constraints.html'},
            {'title': 'Spring Framework · Transaction Management',
             'url': 'https://docs.spring.io/spring-framework/reference/data-access/transaction.html'},
        ],
    },
    {
        'id': 'state-machine',
        'order': 4,
        'goal': '状态机 + 乐观锁：用影响行数判胜负，重复窗口可以很长',
        'layer': '数据访问',
        'when': {'store': ['mysql', 'both'], 'consistency': ['exactly', 'atLeast'],
                 'window': ['min', 'hour', 'day']},
        'why': '重复窗口到了分钟以上，「挡住第二次写入」已经不够 —— 还需要回答「当前到底处于什么状态」。'
               '状态机把幂等从「去重」升级成「可重放」：任何一次重复进来，都按当前状态给出同样的结果。'
               '实现上把「判断状态」与「改状态」压进同一条 UPDATE，靠影响行数判胜负。',
        'decision': {
            'question': '怎么知道这次是「我改的」还是「别人已经改过」？',
            'options': [
                '先 SELECT 状态，代码里 if 判断再 UPDATE —— 读-改-写裸奔，并发下两个请求都看到 init',
                'UPDATE 带旧状态做条件，靠影响行数判 —— 判断与修改一次原子完成',
                '加分布式锁包住整个过程 —— 多一个组件，且锁比数据库事务更容易失效',
                '不加条件直接 UPDATE —— 重复执行会把状态反复推进，看不出是不是重复',
            ],
            'chosen': 'UPDATE ... WHERE id = ? AND status = \'init\'，靠影响行数判胜负；'
                      '影响行数 0 时回查当前状态，区分「已推进（幂等成功）」与「状态非法（真失败）」。',
            'tradeoff': '代价是冲突时多一次回查，且状态迁移要显式列清楚；'
                        '收益是幂等不再依赖键的存储时长，跨天窗口也能正确回答。',
        },
        'sql': r"""-- 状态机推进：WHERE 里带期望的旧状态，让「判断」与「修改」一次原子完成。
UPDATE `biz_order`
   SET `status` = 'paid',
       `version` = `version` + 1,
       `updated_at` = NOW(3)
 WHERE `id` = ? AND `status` = 'init';
-- 影响行数 1 = 我推进成功；0 = 别人已经推进过，或当前状态根本不允许推进。

-- 需要更通用的并发保护时，用 version 做乐观锁：
UPDATE `biz_order`
   SET `amount` = ?, `version` = `version` + 1
 WHERE `id` = ? AND `version` = ?;""",
        'code': r"""/**
 * 场景：幂等写入 / 切片：状态机 + 乐观锁
 * 适用参数：有 MySQL 幂等存储，重复窗口分钟级以上
 * 依赖规则：DATA-SQL-004, SVC-TX-001, CONC-LOCK-002
 * JDK：17
 */
package com.example.app.idem;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 状态机 + 乐观锁：把「判断当前状态」与「改状态」压进同一条 UPDATE，靠影响行数判胜负。
 *
 * 先 SELECT 看状态再 UPDATE 是读-改-写裸奔（DATA-SQL-004）：
 * 两个请求会同时看到 init，然后都认为自己推进成功。
 *
 * 影响行数 0 有两种完全不同的含义，必须分开处理：
 *   · 已经是 paid —— 这是重复请求，幂等语义下应返回「成功」；
 *   · 是 canceled 之类 —— 状态非法，是真失败，要如实报错。
 * 混为一谈会让「该报错的」变成「静默成功」，问题被推迟到对账才暴露。
 *
 * 锁的粒度就是这一行（CONC-LOCK-002）：不需要锁表，也不需要分布式锁。
 */
@Service
public class OrderStateMachine {

    private final JdbcTemplate jdbc;

    public OrderStateMachine(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(rollbackFor = Exception.class)
    public PayResult payOnce(Long orderId) {
        int n = jdbc.update(
            "UPDATE biz_order SET status = 'paid', version = version + 1 WHERE id = ? AND status = 'init'",
            orderId);
        if (n == 1) {
            return PayResult.APPLIED;
        }
        String status = jdbc.queryForObject(
            "SELECT status FROM biz_order WHERE id = ?", String.class, orderId);
        return "paid".equals(status) ? PayResult.ALREADY : PayResult.REJECTED;
    }

    enum PayResult { APPLIED, ALREADY, REJECTED }
}""",
        'highlights': [
            {'mark': "UPDATE biz_order SET status = 'paid', version = version + 1 WHERE id = ? AND status = 'init'",
             'title': '判断与修改一次完成',
             'text': '旧状态写进 WHERE，数据库保证「读到 init 并改成 paid」是原子的。'
                     '这是 DATA-SQL-004 要求的并发更新加锁，不是先读后写。',
             'rule': 'DATA-SQL-004'},
            {'mark': 'if (n == 1) {',
             'title': '影响行数就是胜负',
             'text': '1 = 本次推进成功；0 = 没抢到。整个过程不需要额外锁，'
                     '锁的粒度天然就是这一行（CONC-LOCK-002）。',
             'rule': 'CONC-LOCK-002'},
            {'mark': 'return "paid".equals(status) ? PayResult.ALREADY : PayResult.REJECTED;',
             'title': '「已做过」与「不能做」必须分开',
             'text': '同为影响行数 0，已推进是幂等成功、状态非法是真失败。'
                     '混在一起会让该报错的请求静默成功，问题推迟到对账才暴露。',
             'rule': 'SVC-TX-001'},
        ],
        'pitfalls': [
            '把影响行数 0 一律当成「重复，返回成功」—— 状态非法的请求也被吞掉，真失败被推迟到对账。',
            '先 SELECT 状态再 UPDATE —— 两个请求同时看到 init，都推进一次，幂等失效（DATA-SQL-004）。',
            '状态迁移没有显式清单 —— 加一个新状态时漏改某个分支，就出现「从 canceled 也能直接 paid」的洞。',
        ],
        'notSuitable': [
            '没有幂等存储（store = none）：条件更新与乐观锁都依赖数据库，先补存储。',
            '只要求尽力而为（consistency = best）：状态机的复杂度高于收益，直接覆盖写即可。',
        ],
        'relatedRules': ['DATA-SQL-004', 'SVC-TX-001', 'CONC-LOCK-002'],
        'refs': [
            {'title': 'MySQL 8.0 Reference Manual · Locking Reads（FOR UPDATE 与条件更新）',
             'url': 'https://dev.mysql.com/doc/refman/8.0/en/innodb-locking-reads.html'},
            {'title': 'Spring Framework · JDBC：JdbcTemplate update 返回值语义',
             'url': 'https://docs.spring.io/spring-framework/reference/data-access/jdbc.html'},
        ],
    },
    {
        'id': 'redis-nx',
        'order': 5,
        'goal': '分布式幂等：Redis SETNX 挡跨实例重复，过期必须大于重复窗口',
        'layer': '可靠性',
        'when': {'store': ['redis', 'both'], 'window': ['ms', 'min', 'hour']},
        'why': '唯一键只在单库内有效。多实例部署时，两个实例可以同时通过各自的本地判断，'
               '最终都往同一个库写 —— 唯一键能挡住第二条记录，但挡不住「第二条记录之前已经发生的副作用」'
               '（远程调用、消息投递）。SETNX 把去重提前到业务之前，跨实例生效。'
               '它最大的坑是过期：过期即失忆，所以过期时间必须大于重复窗口。',
        'decision': {
            'question': '跨实例的重复在哪一层挡？',
            'options': [
                '只靠数据库唯一键 —— 能挡重复记录，挡不住并发期间已经发出的副作用',
                'Redis SETNX + 过期 —— 跨实例生效，快，但会过期',
                'Redis 无过期 SETNX —— 进程崩了键还在，后续请求永久被挡',
                '本地锁（synchronized / ReentrantLock）—— 只管得住本实例，多实例形同虚设',
            ],
            'chosen': 'Redis SETNX + 过期时间（必须大于重复窗口）；业务失败才清键，'
                      '成功后把键留到自然过期，重复请求一律被挡。数据库唯一键仍然保留做最后一道防线。',
            'tradeoff': '代价是多一个组件要保活，且过期时间设错就等于没有幂等；'
                        '收益是把去重提前到副作用之前，跨实例有效。',
        },
        'sql': r"""-- Redis 只挡并发，不存结果。最终状态必须落库，
-- 否则键过期之后没人说得清「这件事到底做没做过」。
CREATE TABLE `idem_record` (
  `id`         BIGINT      NOT NULL AUTO_INCREMENT,
  `biz_type`   VARCHAR(32) NOT NULL,
  `biz_key`    VARCHAR(64) NOT NULL,
  `result`     VARCHAR(255) NULL COMMENT '执行结果摘要，供重复请求直接回放',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_biz` (`biz_type`, `biz_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='幂等记录 · 结果留痕';""",
        'code': r"""/**
 * 场景：幂等写入 / 切片：Redis SETNX 分布式幂等
 * 适用参数：有 Redis 幂等存储，重复窗口毫秒~小时级
 * 依赖规则：CONC-LOCK-001, CONC-LOCK-002, SVC-TX-003
 * JDK：17
 */
package com.example.app.idem;

import java.time.Duration;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

/**
 * SETNX + 过期：跨实例的重复只放行一个。
 *
 * ① 过期时间必须大于重复窗口 —— 过期即失忆，键过期后进来的重复请求会被当成新请求放行。
 * ② 键的粒度是业务键（bizType + bizKey），不是整个接口 —— 一个键挡一次重复，
 *    不会把不相关的请求一起挡住（CONC-LOCK-002）。
 * ③ 同一流程若还要拿数据库行锁，全链路的加锁顺序必须一致：先本键、再行锁。
 *    顺序不一致是死锁的标准配方（CONC-LOCK-001）。
 * ④ 绝不在数据库事务内部调用 Redis（SVC-TX-003）：事务未提交就动键，
 *    另一个实例会读到旧状态，幂等形同虚设。
 * ⑤ 成功之后不要清键 —— 清掉就等于忘掉，重复请求会再抢一次、再做一遍。
 */
@Service
public class RedisIdempotencyGuard {

    private final StringRedisTemplate redis;

    public RedisIdempotencyGuard(StringRedisTemplate redis) {
        this.redis = redis;
    }

    /** 抢键成功 = 本次是第一次；失败 = 别的实例正在处理或刚处理过。 */
    public boolean tryAcquire(String bizType, String bizKey, Duration ttl) {
        String key = "idem:" + bizType + ":" + bizKey;
        Boolean ok = redis.opsForValue().setIfAbsent(key, "1", ttl);
        return Boolean.TRUE.equals(ok);
    }

    /**
     * 只在业务**失败**时调用：清掉键，让重试能进来。
     *
     * 成功后**绝不要删键** —— 删掉之后重复请求会再次抢到键，把业务原样重做一遍，
     * 幂等形同虚设。成功的键留着，让它自然过期，期间所有重复请求一律被挡在门外。
     *
     * 也必须在数据库事务提交之后才调（SVC-TX-003），不能放进事务里。
     */
    public void releaseOnFailure(String bizType, String bizKey) {
        redis.delete("idem:" + bizType + ":" + bizKey);
    }
}""",
        'highlights': [
            {'mark': 'Boolean ok = redis.opsForValue().setIfAbsent(key, "1", ttl);',
             'title': 'SETNX + 过期，一次原子完成',
             'text': '设置与过期必须是一次调用，不能先 SET 再 EXPIRE —— 中间崩了就是永久键。'
                     '过期时间是这道防线的有效期，必须大于重复窗口。',
             'rule': 'CONC-LOCK-002'},
            {'mark': 'String key = "idem:" + bizType + ":" + bizKey;',
             'title': '粒度是业务键，不是接口',
             'text': '锁的粒度越细，被误挡的请求越少（CONC-LOCK-002）。'
                     '用接口名当键会把所有不相关的请求一起挡住，吞吐直接掉到 1。',
             'rule': 'CONC-LOCK-002'},
            {'mark': 'public void releaseOnFailure(String bizType, String bizKey) {',
             'title': '只有失败才清键，成功必须留着',
             'text': '成功之后删键，重复请求会再次抢到键把业务重做一遍 —— 幂等当场失效。'
                     '成功的键留到自然过期，期间重复请求一律被挡。'
                     '另外它必须在数据库事务提交之后才调（SVC-TX-003）：事务内禁止远程调用，Redis 也是远程调用。',
             'rule': 'SVC-TX-003'},
        ],
        'pitfalls': [
            '业务成功后把键删掉 —— 重复请求再次抢到键，业务被原样重做一遍，幂等形同虚设。',
            '过期时间小于重复窗口 —— 键过期后重复请求被当成新请求放行，幂等静默失效。',
            '在 @Transactional 方法里调 Redis —— 事务未提交就动键，别的实例读到旧状态（SVC-TX-003）。',
            'SET 与 EXPIRE 分两次调用 —— 中间进程崩了就是永久键，后续请求被永久挡住。',
        ],
        'notSuitable': [
            '重复窗口跨天（window = day）且只有 Redis：键必然带过期，跨天之后失忆；改用持久化幂等表。',
            '没有 Redis（store = none / mysql）：只能用唯一键与状态机，防线后移到数据库。',
        ],
        'relatedRules': ['CONC-LOCK-001', 'CONC-LOCK-002', 'SVC-TX-003'],
        'refs': [
            {'title': 'Redis Commands · SET（NX / EX 选项）',
             'url': 'https://redis.io/docs/latest/commands/set/'},
            {'title': 'Martin Kleppmann · How to do distributed locking（Redlock 争论的原始论证）',
             'url': 'https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html'},
        ],
    },
    {
        'id': 'retry-storm',
        'order': 6,
        'goal': '重试风暴：退避 + 上限 + 死信，禁止 sleep 重试',
        'layer': '可靠性',
        'when': {'caller': ['retry', 'mq', 'job'], 'window': ['ms', 'min']},
        'why': '重试是重复的放大器：一次下游抖动，经过网关、调用方、本地三层各重试 3 次，'
               '最坏放大到 27 倍。更糟的是多副本部署时定时任务本身会重复触发 —— '
               '每个副本都认为该自己跑（REL-CTNR-004）。所以重试必须同时满足三件事：'
               '有退避、有上限、有死信，且抢占靠条件更新而不是「应该只有一个副本在跑」。',
        'decision': {
            'question': '失败之后怎么重试？',
            'options': [
                'Thread.sleep 之后立刻重试 —— 阻塞线程，无退避无上限（REL-RETRY-001 禁止）',
                '无限重试直到成功 —— 下游已经挂了还持续加压，把故障变成雪崩',
                '固定间隔重试 N 次 —— 有上限但没有退避，抖动期间所有请求同时重试',
                '指数退避 + 上限 + 死信，抢占靠条件更新 —— 可预期、可观测、不雪崩',
            ],
            'chosen': '指数退避（封顶）+ 重试上限 + 超限进死信；'
                      '多副本抢占靠条件更新的影响行数，而不是依赖部署拓扑。',
            'tradeoff': '代价是要维护一张重试台账表，死信还要有人看；'
                        '收益是失败可预期、流量可收敛、没有静默丢弃。',
        },
        'sql': r"""-- 重试台账：每次重试都留痕，超过上限进死信，不静默丢弃。
CREATE TABLE `retry_task` (
  `id`          BIGINT       NOT NULL AUTO_INCREMENT,
  `biz_key`     VARCHAR(64)  NOT NULL,
  `attempt`     INT          NOT NULL DEFAULT 0 COMMENT '已重试次数',
  `max_attempt` INT          NOT NULL DEFAULT 3 COMMENT '重试上限',
  `next_at`     DATETIME(3)  NOT NULL COMMENT '下次执行时间（退避后）',
  `last_error`  VARCHAR(512) NULL,
  `state`       VARCHAR(16)  NOT NULL DEFAULT 'retrying' COMMENT 'retrying/done/dead',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_biz` (`biz_key`),
  KEY `idx_next` (`next_at`, `state`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='重试台账 · 有上限、可观测';

-- 超过上限就搬进死信，等人来看 —— 静默丢弃比失败更危险。
CREATE TABLE `retry_dead_letter` (
  `id`         BIGINT       NOT NULL AUTO_INCREMENT,
  `biz_key`    VARCHAR(64)  NOT NULL,
  `reason`     VARCHAR(512) NULL,
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_biz` (`biz_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='死信 · 重试耗尽';""",
        'code': r"""/**
 * 场景：幂等写入 / 切片：重试风暴
 * 适用参数：上游重试 / 消息重投 / 定时任务，重复窗口毫秒~分钟级
 * 依赖规则：REL-RETRY-001, REL-CTNR-004
 * JDK：17
 */
package com.example.app.idem;

import java.time.Duration;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 重试是重复的放大器：一次下游抖动，经过网关、调用方、本地三层各重试 3 次，
 * 最坏放大到 27 倍（这是算术推导，不是压测实测）。所以三件事同时做：
 *   ① 指数退避并封顶 —— 抖动期间不要所有请求同时重试；
 *   ② 有上限 —— 无限重试把故障变成雪崩；
 *   ③ 超限进死信 —— 静默丢弃比失败更危险。
 *
 * 多副本部署时每个副本都会跑到 drain()：定时任务本身必须幂等（REL-CTNR-004）。
 * 抢占靠条件更新的影响行数，不依赖「应该只有一个副本在跑」这种假设。
 */
@Component
public class RetryScheduler {

    private final JdbcTemplate jdbc;

    public RetryScheduler(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** 指数退避并封顶。禁止用 Thread.sleep 实现重试等待（REL-RETRY-001）。 */
    private Duration backoff(int attempt) {
        long millis = Math.min(60_000L, 500L << Math.min(attempt, 7));
        return Duration.ofMillis(millis);
    }

    @Scheduled(fixedDelay = 5_000)
    public void drain() {
        jdbc.query("SELECT id, biz_key, attempt, max_attempt FROM retry_task "
                + "WHERE state = 'retrying' AND next_at <= NOW(3) LIMIT 100",
            (rs, row) -> new Task(rs.getLong("id"), rs.getString("biz_key"),
                rs.getInt("attempt"), rs.getInt("max_attempt"))).forEach(this::runOne);
    }

    private void runOne(Task t) {
        int claimed = jdbc.update(
            "UPDATE retry_task SET attempt = attempt + 1 WHERE id = ? AND state = 'retrying' AND attempt = ?",
            t.id(), t.attempt());
        if (claimed != 1) {
            return;                       // 别的副本已经推过这一条，本次跳过
        }
        try {
            callDownstream(t.bizKey());
            jdbc.update("UPDATE retry_task SET state = 'done' WHERE id = ?", t.id());
        } catch (RuntimeException e) {
            if (t.attempt() + 1 >= t.maxAttempt()) {
                moveToDeadLetter(t, e);
            } else {
                jdbc.update("UPDATE retry_task SET next_at = NOW(3) + INTERVAL ? SECOND, last_error = ? "
                    + "WHERE id = ?", backoff(t.attempt()).toSeconds(), trim(e.getMessage()), t.id());
            }
        }
    }

    private void moveToDeadLetter(Task t, RuntimeException e) {
        jdbc.update("UPDATE retry_task SET state = 'dead', last_error = ? WHERE id = ?",
            trim(e.getMessage()), t.id());
        jdbc.update("INSERT INTO retry_dead_letter (biz_key, reason) VALUES (?, ?) "
            + "ON DUPLICATE KEY UPDATE reason = VALUES(reason)", t.bizKey(), trim(e.getMessage()));
    }

    /** last_error 列是 VARCHAR(512)，超长会截断报错 —— 入库前先切。 */
    private String trim(String msg) {
        if (msg == null) {
            return "";
        }
        return msg.length() <= 500 ? msg : msg.substring(0, 500);
    }

    /** 真实下游调用；重试的前提是被调方幂等 —— 不幂等的接口重试只会放大事故。 */
    private void callDownstream(String bizKey) {
        // 由调用方注入实际实现
    }

    record Task(long id, String bizKey, int attempt, int maxAttempt) {}
}""",
        'highlights': [
            {'mark': 'long millis = Math.min(60_000L, 500L << Math.min(attempt, 7));',
             'title': '指数退避并封顶',
             'text': '退避让抖动期间的请求错开；封顶避免退避时间长到业务不可接受。'
                     '禁止用 Thread.sleep 阻塞线程来等待（REL-RETRY-001）—— 那是把线程变成计时器。',
             'rule': 'REL-RETRY-001'},
            {'mark': 'UPDATE retry_task SET attempt = attempt + 1 WHERE id = ? AND state = \'retrying\' AND attempt = ?',
             'title': '条件更新抢占，不靠部署拓扑',
             'text': '影响行数 1 才算抢到。多副本同时扫到同一条时只有一个能推进 —— '
                     '定时任务多副本必须幂等（REL-CTNR-004），不能假设「只有一个副本在跑」。',
             'rule': 'REL-CTNR-004'},
            {'mark': 'moveToDeadLetter(t, e);',
             'title': '超上限进死信，不静默丢弃',
             'text': '重试耗尽必须留下可查的痕迹。静默丢弃的问题是「没人知道丢过」，'
                     '等到对账发现时已经无法定位。',
             'rule': 'REL-RETRY-001'},
        ],
        'pitfalls': [
            '用 Thread.sleep 实现重试等待 —— 阻塞线程、无退避无上限（REL-RETRY-001）。',
            '多副本定时任务不抢占 —— 每个副本都跑一遍，重复量与副本数成正比（REL-CTNR-004）。',
            '重试耗尽后静默丢弃 —— 死信表里什么都没有，问题只能靠对账碰运气发现。',
        ],
        'notSuitable': [
            '调用来源是用户（caller = user）：用户侧没有「自动重试」，该做的是一次性令牌（切片 2）。',
            '被调方本身不幂等：重试只会把一次失败放大成 N 次事故 —— 先做幂等，再做重试。',
        ],
        'relatedRules': ['REL-RETRY-001', 'REL-CTNR-004'],
        'refs': [
            {'title': 'AWS Builders Library · Timeouts, retries and backoff with jitter',
             'url': 'https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/'},
            {'title': 'Spring Retry · RetryTemplate 与退避策略',
             'url': 'https://docs.spring.io/spring-batch/reference/appendix/retry.html'},
        ],
    },
]

CASE = {
    'id': 'idempotent-write',
    'order': 9,
    'name': '幂等写入：同一个请求被送进来两次，怎么只生效一次',
    'subtitle': '重复不是边缘情况，它是分布式系统的默认状态',
    'glyph': '⟲',
    'domain': ['支付', '交易', '消息消费', '定时任务', '开放接口'],
    'problem': '同一个写请求被送进来两次 —— 用户连点、上游超时重试、MQ 至少一次投递、定时任务多副本触发。'
               '轻则多一条重复记录，重则重复扣款、重复发货。'
               '难点不在「加个去重」，而在四个源头各自的重复窗口完全不同，'
               '决定了幂等键要存多久、该用哪种兜底。',
    'symptoms': [
        {'id': 'y1', 'text': '用户狂点提交按钮，一笔订单被创建了两次',
         'params': {'caller': 'user', 'window': 'ms'}},
        {'id': 'y2', 'text': 'MQ 消息重投，同一条消息被消费了两次，账不平',
         'params': {'caller': 'mq', 'window': 'min', 'consistency': 'exactly'}},
        {'id': 'y3', 'text': '定时任务多副本同时触发，同一批数据被处理了两遍',
         'params': {'caller': 'job', 'consistency': 'atLeast', 'globalId': 'no'}},
        {'id': 'y4', 'text': '上游超时后自动重试，下游其实已经扣款成功',
         'params': {'caller': 'retry', 'window': 'hour', 'store': 'both'}},
        {'id': 'y5', 'text': '完全没有去重措施，全靠「应该不会重复吧」',
         'params': {'store': 'none'}},
    ],
    'recommended': {
        'caller': 'user', 'window': 'ms', 'consistency': 'exactly',
        'globalId': 'yes', 'store': 'mysql',
    },
    'drivers': DRIVERS,
    'conflicts': CONFLICTS,
    'slices': SLICES,
    # 「用户提交」与「自动重试 / 消息重投 / 定时触发」是本场景的两条技术路线：
    # 前者靠一次性令牌，后者靠重试台账，它们不可能同时成立 ——
    # 所以 6 个切片最多同时激活 5 个。不声明的话，「条件写错了」与「设计如此」
    # 在页面上看不出区别，读者只会以为漏了一片。
    'exclusiveGroups': [
        {'drivers': ['caller'],
         'note': '调用来源分两条路线：用户提交（一次性令牌）与自动重放（重试台账 / 状态机），'
                 '两者对「同一次请求」的认定方式完全不同，不会同时出现在同一套方案里。'},
    ],
    'notSuitableFor': NOT_SUITABLE_FOR,
    'benchmark': BENCHMARK,
    'architecture': ARCHITECTURE,
}
