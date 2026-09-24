# -*- coding: utf-8 -*-
"""场景 8 · 虚拟线程（Project Loom）：高并发 IO 任务怎么用才不踩坑。

用户的原始提问：「虚拟现成（线程）怎么用的案例」—— 在军火库这种 Java 代码规范平台里，
唯一合理的解释是 Java 21 的虚拟线程（Virtual Threads / Project Loom）。

核心矛盾：虚拟线程不是「换了名字的线程池」，用错反而更慢或更不安全——
   ① 用 ThreadPoolExecutor 再去「池化」虚拟线程 → 既限制并发又把载体线程堵死；
   ② 在 synchronized 临界区里跑 → pinning（钉死），吞吐优势归零；
   ③ 不加以节制地无限创建 → 下游连接池/配额被打爆，连锁失败；
   ④ 海量虚拟线程下用 ThreadLocal 存上下文 → 堆内存被放大数倍甚至 OOM。

这个场景的骨架是「无限工厂 + 显式闸门 + 正确的锁」：
虚拟线程执行器本身是无界的，限流/背压/锁的职责必须由 Semaphore / ReentrantLock 显式承担，
而不是像平台线程池那样「靠池大小顺便限流」。
"""

DRIVERS = [
    {'id': 'jdk', 'name': 'JDK 版本', 'unit': '', 'hint': '虚拟线程需要 JDK 21+',
     'levels': [
         {'id': 'j17', 'label': 'Java 17', 'note': '无虚拟线程，只能走平台线程池'},
         {'id': 'j21', 'label': 'Java 21', 'note': '虚拟线程正式交付（JEP 444）'},
         {'id': 'j25', 'label': 'Java 25', 'note': '虚拟线程更完善，ScopedValue 转正'},
     ]},
    {'id': 'workload', 'name': '负载类型', 'unit': '', 'hint': '计算 vs 等待的占比',
     'levels': [
         {'id': 'io', 'label': 'IO 密集', 'note': '远端调用 / JDBC / 文件读写为主'},
         {'id': 'cpu', 'label': 'CPU 密集', 'note': '计算为主，虚拟线程无益'},
         {'id': 'mixed', 'label': '混合', 'note': '计算与等待交替'},
     ]},
    {'id': 'scale', 'name': '并发规模', 'unit': '同时', 'hint': '同一时刻的并发任务数',
     'levels': [
         {'id': 'low', 'label': '<100'},
         {'id': 'mid', 'label': '100~1k'},
         {'id': 'high', 'label': '>1k', 'note': '高并发，pinning 与背压问题集中爆发'},
     ]},
    {'id': 'blocking', 'name': '阻塞性质', 'unit': '', 'hint': '临界区与等待的写法',
     'levels': [
         {'id': 'noCrit', 'label': '无临界区', 'note': '无共享可变状态'},
         {'id': 'syncBlock', 'label': 'synchronized 临界区', 'note': '会触发 pinning'},
         {'id': 'lockCrit', 'label': 'ReentrantLock 临界区', 'note': '不 pinning'},
         {'id': 'native', 'label': 'JNI / 本地阻塞', 'note': 'JVM 调度不可见，必 pin'},
     ]},
    {'id': 'lifespan', 'name': '任务时长', 'unit': '', 'hint': '单个虚拟线程占用载体线程的时长',
     'levels': [
         {'id': 'short', 'label': '<100ms', 'note': '短 IO 等待，虚拟线程最佳区'},
         {'id': 'long', 'label': '秒级', 'note': '长时间占住载体线程，吞吐下降'},
     ]},
]

CONFLICTS = [
    {'when': {'workload': ['cpu'], 'scale': ['high', 'mid']},
     'text': 'CPU 密集型 + 中高并发：虚拟线程不减少任何 CPU 计算量，调度与载体线程切换开销反而增加。'
             '应改用平台线程池（核心线程数 ≈ CPU 核数，配合有界队列与拒绝策略，见 CONC-POOL-004）。'},
    {'when': {'blocking': ['syncBlock'], 'scale': ['high']},
     'text': '大量 synchronized 临界区 + 高并发：虚拟线程在 synchronized 内被 pin 到载体线程，'
             'pinning 让吞吐优势归零，甚至比平台线程还糟。必须先替换成 ReentrantLock'
             '（见切片「pinning 与锁替换」）。'},
    {'when': {'blocking': ['native'], 'scale': ['high', 'mid']},
     'text': 'JNI / 本地阻塞 + 中高并发：本地阻塞对 JVM 调度不可见，虚拟线程无法在等待时让出载体线程，'
             'pinning 必然发生，收益极低甚至为负。'},
]

NOT_SUITABLE_FOR = [
    {'when': {'jdk': ['j17']},
     'reason': 'Java 17 没有虚拟线程（Project Loom 在 JDK 21 才正式交付）。'
               '只能走平台线程池（ThreadPoolExecutor + 有界队列 + 拒绝策略，见 CONC-POOL-004）。'},
    {'when': {'workload': ['cpu']},
     'reason': '纯 CPU 密集型：虚拟线程只为「等待」而生，对计算无帮助。'
               '平台线程池更合适，虚拟线程反而增加切换开销。'},
    {'when': {'lifespan': ['long']},
     'reason': '任务时长秒级且高并发：虚拟线程长时间占住载体线程不释放，载体线程池被占满，吞吐下降。'
               '虚拟线程适合短 IO 等待，长任务请评估平台线程或分批。'},
]

BENCHMARK = {
    'title': '平台线程池 vs 虚拟线程：IO 密集型并发（模拟 1 万并发、每任务 50ms 下游等待）',
    'columns': ['方案', '并发线程', '吞吐(req/s)', '满载内存'],
    'rows': [
        ['平台线程池（200 线程）', '200', '≈2000', '栈约 200MB'],
        ['虚拟线程（每任务一个）', '≈10000', '≈200000', '按需、极少占满 1MB 上限'],
    ],
    'conclusion': 'IO 等待型任务收益巨大：虚拟线程把「等待」从载体线程上卸载，同硬件下吞吐可提升 1~2 个数量级。'
                  '但 CPU 密集、synchronized 临界区、JNI 阻塞会让收益归零甚至为负——见矛盾与不适用。',
}

ARCHITECTURE = {
    'nodes': [
        {'id': 'app', 'label': '应用入口', 'kind': 'backend', 'tier': 0},
        {'id': 'vt', 'label': '虚拟线程执行器', 'kind': 'backend', 'tier': 0,
         'whenAny': {'jdk': ['j21', 'j25']}},
        {'id': 'carrier', 'label': '载体线程池', 'kind': 'backend', 'tier': 1},
        {'id': 'downstream', 'label': '下游 / 数据库', 'kind': 'database', 'tier': 2,
         'whenAny': {'scale': ['high', 'mid']}},
        {'id': 'guard', 'label': '并发闸门(Semaphore)', 'kind': 'messagebus', 'tier': 1,
         'whenAny': {'scale': ['high']}},
    ],
    'links': [
        {'from': 'app', 'to': 'vt', 'label': '提交'},
        {'from': 'vt', 'to': 'carrier', 'label': '挂载'},
        {'from': 'vt', 'to': 'downstream', 'label': '调用'},
        {'from': 'app', 'to': 'guard', 'label': '限流'},
        {'from': 'guard', 'to': 'downstream', 'label': '放行'},
    ],
}

SLICES = [
    {
        'id': 'enable-vt',
        'order': 1,
        'goal': '启用虚拟线程：Spring Boot 开关 + 给 @Async 绑定虚拟线程执行器',
        'layer': '配置',
        'when': {'jdk': ['j21', 'j25']},
        'why': '虚拟线程要先用起来。Spring Boot 3.2+ 一行开关让 Web 容器与 JDBC 的阻塞点自动跑在虚拟线程上，'
               '但 @Async 有独立的执行器，不显式绑定就会落回「每任务新建线程」的 SimpleAsyncTaskExecutor。',
        'decision': {
            'question': '@Async 的任务跑在哪个线程上？',
            'options': [
                '不配置，用默认执行器 —— 落到 SimpleAsyncTaskExecutor，每次新建线程、无上限',
                '绑定平台线程池 —— 能控并发，但虚拟线程优势没用上',
                '绑定虚拟线程执行器 —— 每任务一个虚拟线程，且不违反 CONC-POOL-002',
                '直接 new Thread —— 被 CONC-POOL-001 禁止',
            ],
            'chosen': '绑定 VirtualThreadTaskExecutor（虚拟线程执行器）。它是 Executors 工厂里'
                      '唯一被放行的一个（CONC-POOL-002 禁止的是无界队列/无界线程数的那几个）。',
            'tradeoff': '代价是虚拟线程「无限创建」，下游有容量上限时必须另加闸门（见切片「并发闸门与快速失败」）；'
                        '收益是 IO 等待期间不再占用平台线程池。',
        },
        'sql': r"""-- 本场景并发服务持有的任务表：虚拟线程负责把每条 task 拉起并执行。
CREATE TABLE `batch_task` (
  `id`         BIGINT       NOT NULL AUTO_INCREMENT,
  `biz_key`    VARCHAR(64)  NOT NULL COMMENT '业务键，如 report_id',
  `status`     VARCHAR(16)  NOT NULL DEFAULT 'pending' COMMENT 'pending/running/done/failed',
  `payload`    JSON         NULL COMMENT '执行入参',
  `result`     JSON         NULL,
  `created_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='批量任务 · 由虚拟线程并发执行';""",
        'code': r"""/**
 * 场景：虚拟线程（Project Loom） / 切片：启用虚拟线程
 * 适用参数：JDK 21+（运行载体为 Web 容器或 @Async/WebClient 框架）
 * 依赖规则：CONC-POOL-005, CONC-POOL-002
 * JDK：21
 */
package com.example.app.vt;

import java.util.concurrent.Executors;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.task.AsyncTaskExecutor;
import org.springframework.core.task.VirtualThreadTaskExecutor;
import org.springframework.scheduling.annotation.EnableAsync;

/**
 * Spring Boot 3.2+ 一行开关让 Tomcat/Undertow、WebClient、DataSource 的阻塞点
 * 自动跑在虚拟线程上：spring.threads.virtual.enabled=true。
 *
 * 但 @Async 不会自动享用它——@Async 用独立的 TaskExecutor，必须显式绑定，
 * 否则落回 SimpleAsyncTaskExecutor（每任务新建线程、无上限）。
 * 注意：Executors.newVirtualThreadPerTaskExecutor() 是 Executors 工厂里
 * 唯一被放行的一个（CONC-POOL-002 禁止的是无界队列/无界线程数的那几个）。
 */
@Configuration
@EnableAsync
public class VirtualThreadConfig {

    /** 给 @Async 用的虚拟线程执行器：每任务一个虚拟线程，不是池。 */
    @Bean("virtualTaskExecutor")
    public AsyncTaskExecutor virtualTaskExecutor() {
        return new VirtualThreadTaskExecutor("vt-async-");
    }

    /** 给其他代码手动提交用的执行器。 */
    @Bean("virtualExecutor")
    public java.util.concurrent.ExecutorService virtualExecutor() {
        return Executors.newVirtualThreadPerTaskExecutor();
    }
}""",
        'highlights': [
            {'mark': 'spring.threads.virtual.enabled=true',
             'title': '一行开关接管容器线程',
             'text': 'Spring Boot 3.2+ 的 spring.threads.virtual.enabled=true 让 Tomcat/Undertow、'
                     'WebClient、DataSource 的阻塞点自动跑在虚拟线程上，无需改业务代码。',
             'rule': 'CONC-POOL-005'},
            {'mark': 'return new VirtualThreadTaskExecutor("vt-async-");',
             'title': '@Async 必须显式绑定',
             'text': '@Async 不会自动使用上面的开关，必须显式绑定虚拟线程执行器，'
                     '否则落到 SimpleAsyncTaskExecutor（每任务新建线程、无上限）。',
             'rule': 'CONC-POOL-005'},
            {'mark': 'Executors.newVirtualThreadPerTaskExecutor()',
             'title': '唯一被放行的 Executors 工厂',
             'text': 'CONC-POOL-002 禁止 Executors 的无界工厂，但 newVirtualThreadPerTaskExecutor 例外——'
                     '它创建的正是「每任务一个虚拟线程」的无限工厂，正是虚拟线程的正确用法。',
             'rule': 'CONC-POOL-002'},
        ],
        'pitfalls': [
            '只开 spring.threads.virtual.enabled=true 就以为 @Async 也上了虚拟线程 —— @Async 用独立执行器，必须显式绑定。',
            '用 ThreadPoolExecutor 再包一层去「池化」虚拟线程 —— 既限制并发又把载体线程堵死，双重错误。',
            '在 JDK 17 上写虚拟线程代码 —— 编译不过，虚拟线程是 JDK 21 才正式交付的特性。',
        ],
        'notSuitable': [
            'Java 17 及更低：没有虚拟线程，只能走平台线程池（见 CONC-POOL-004）。',
            '服务里没有任何 IO 等待型并发：开关开了也无人受益，徒增理解成本。',
        ],
        'relatedRules': ['CONC-POOL-005', 'CONC-POOL-002'],
        'refs': [
            {'title': 'OpenJDK JEP 444 · Virtual Threads', 'url': 'https://openjdk.org/jeps/444'},
            {'title': 'Spring Boot Reference · Virtual Threads',
             'url': 'https://docs.spring.io/spring-boot/reference/features/threads.html'},
        ],
    },
    {
        'id': 'vt-per-task-executor',
        'order': 2,
        'goal': '每任务虚拟线程执行器：不要池化，但必须显式限流',
        'layer': '并发',
        'when': {'jdk': ['j21', 'j25'], 'scale': ['high', 'mid']},
        'why': '虚拟线程执行器本身就是「无限工厂」，每个任务创建一个虚拟线程。再用 ThreadPoolExecutor 去池化它，'
               '既限制了并发（虚拟线程本可海量）又把载体线程堵死。但「无限」不等于「无节制」——'
               '下游有容量上限时，必须用 Semaphore 做并发闸门。',
        'decision': {
            'question': '海量并发任务怎么提交？',
            'options': [
                'new Thread(task) 直接起 —— 被 CONC-POOL-001 禁止，且完全失控',
                'Executors.newFixedThreadPool(n) —— 仍是平台线程池，并发上限锁死在 n',
                'Executors.newVirtualThreadPerTaskExecutor() —— 每任务虚拟线程，再用 Semaphore 控下游并发',
                '包一层 ThreadPoolExecutor 池化虚拟线程 —— 画蛇添足，载体线程反被堵',
            ],
            'chosen': 'Executors.newVirtualThreadPerTaskExecutor() + Semaphore 闸门。'
                      '前者是无限工厂，后者是下游容量兜底，职责分离，等价于平台线程池「有界队列+拒绝策略」（CONC-POOL-004）。',
            'tradeoff': '代价是限流逻辑要自己写（Semaphore + try/finally）；'
                        '收益是并发可随负载弹性到成千上万，载体线程数仍约等于 CPU 核数。',
        },
        'sql': r"""-- 高并发下游调用的配额表：Semaphore 的许可数对应这里的并发上限配置。
CREATE TABLE `downstream_quota` (
  `id`             BIGINT      NOT NULL AUTO_INCREMENT,
  `api_name`       VARCHAR(64) NOT NULL,
  `max_concurrent` INT         NOT NULL COMMENT '并发闸门上限，对应代码里的 Semaphore 许可数',
  `created_at`     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_api` (`api_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='下游并发配额';""",
        'code': r"""/**
 * 场景：虚拟线程 / 切片：每任务虚拟线程执行器 + 并发闸门
 * 适用参数：JDK 21+ 且并发中高
 * 依赖规则：CONC-POOL-001, CONC-POOL-004
 * JDK：21
 */
package com.example.app.vt;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;

/** Request/Result 为业务入参与出参（示意）。 */
record Request(String key) {}
record Result(String data) {}

/**
 * 虚拟线程执行器本身就是「无限工厂」：Executors.newVirtualThreadPerTaskExecutor()
 * 每任务创建一个虚拟线程。不要用 ThreadPoolExecutor 再去「池化」它——
 * 那样既限制了并发（虚拟线程本可海量），又把载体线程堵死。
 *
 * 但「无限」不等于「无节制」：下游（DB、第三方 API）往往有连接数/配额上限。
 * 平台线程世界用「有界队列 + 拒绝策略」（CONC-POOL-004）兜底；
 * 虚拟线程世界用 Semaphore 做并发闸门，等价物。禁止用 new Thread() 直接起（CONC-POOL-001）。
 */
public final class BatchFetcher {

    private final ExecutorService vt = Executors.newVirtualThreadPerTaskExecutor();
    /** 并发闸门：最多同时 200 个下游调用，超过的线程在 acquire 处让出载体线程等待。 */
    private final Semaphore gate = new Semaphore(200);

    public List<Result> fetchAll(List<Request> reqs) {
        List<CompletableFuture<Result>> futures = new ArrayList<>();
        for (Request req : reqs) {
            futures.add(CompletableFuture.supplyAsync(
                () -> {
                    gate.acquire();                 // 拿到许可才发起下游调用
                    try {
                        return callDownstream(req);
                    } finally {
                        gate.release();
                    }
                }, vt));
        }
        return futures.stream().map(CompletableFuture::join).toList();
    }

    private Result callDownstream(Request req) {
        return new Result("ok:" + req.key());
    }
}""",
        'highlights': [
            {'mark': 'private final ExecutorService vt = Executors.newVirtualThreadPerTaskExecutor();',
             'title': '无限工厂，不池化',
             'text': '每任务一个虚拟线程。不要再套 ThreadPoolExecutor，那会画蛇添足地把载体线程堵死。',
             'rule': 'CONC-POOL-001'},
            {'mark': 'private final Semaphore gate = new Semaphore(200);',
             'title': '并发闸门 = 有界兜底',
             'text': '虚拟线程世界没有「池大小」可以顺便限流，下游容量必须显式用 Semaphore 兜底，'
                     '等价平台线程池的「有界队列 + 拒绝策略」（CONC-POOL-004）。',
             'rule': 'CONC-POOL-004'},
            {'mark': 'gate.acquire();',
             'title': '等待时也释放载体线程',
             'text': '未拿到许可的虚拟线程在 acquire 处挂起，让出载体线程去跑别的任务——'
                     '这正是虚拟线程能在海量并发下保持低载体线程数的原因。',
             'rule': 'CONC-POOL-004'},
        ],
        'pitfalls': [
            '用 ThreadPoolExecutor 去池化虚拟线程 —— 既限制并发又把载体线程堵死，双重错误。',
            '以为虚拟线程「无限」就什么都不限 —— 下游连接池/配额被打爆，连锁 429 失败。',
            '闸门忘记在 finally 里 release —— 一次异常后许可永久丢失，闸门逐渐锁死。',
        ],
        'notSuitable': [
            '并发很低（<100）且下游能扛：直接用一个小的 ThreadPoolExecutor 就够了，每任务虚拟线程执行器收益不明显。',
            'Java 17：无虚拟线程，只能用常规线程池（有界队列 + 拒绝策略，见 CONC-POOL-004）。',
        ],
        'relatedRules': ['CONC-POOL-001', 'CONC-POOL-004'],
        'refs': [
            {'title': 'OpenJDK JEP 444 · Virtual Threads', 'url': 'https://openjdk.org/jeps/444'},
            {'title': 'Spring Framework · Task Execution and Scheduling',
             'url': 'https://docs.spring.io/spring-framework/reference/integration/scheduling.html'},
        ],
    },
    {
        'id': 'vt-pinning-lock',
        'order': 3,
        'goal': 'pinning 与锁替换：用 ReentrantLock 替代 synchronized',
        'layer': '并发',
        'when': {'jdk': ['j21', 'j25'], 'blocking': ['syncBlock']},
        'why': 'synchronized 临界区会让虚拟线程被 pin 到载体线程（pinning）：等待时无法把载体线程让给别人，'
               '高并发下载体线程池被占满，虚拟线程吞吐优势归零。换 ReentrantLock 走 AQS，JVM 能正确挂起/恢复虚拟线程。',
        'decision': {
            'question': '虚拟线程里的临界区用什么锁？',
            'options': [
                'synchronized —— 在热路径会 pinning，高并发下优势归零',
                'ReentrantLock —— 走 AQS，等待时虚拟线程可被挂起，不 pinning',
                'Object.wait/notify —— 同样会 pinning，且 API 陈旧',
                '不用锁，靠无锁原子类 —— 适用简单计数，复杂临界区做不到',
            ],
            'chosen': 'ReentrantLock。锁必须在 finally 释放（CONC-LOCK-002），且只在必要代码块内加锁，'
                      '绝不在锁内做 IO/远程调用（CONC-LOCK-002 的同一原则在虚拟线程下更关键）。',
            'tradeoff': '代价是代码比 synchronized 啰嗦（lock/unlock + try/finally）；'
                        '收益是临界区不再 pinning，虚拟线程吞吐优势保住。',
        },
        'sql': r"""-- 被并发递增的计数器：ReentrantLock 保护「读-改-写」期间虚拟线程不在 synchronized 内被 pin。
CREATE TABLE `kv_counter` (
  `k`   VARCHAR(64) NOT NULL,
  `v`   BIGINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (`k`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='键值计数器';""",
        'code': r"""/**
 * 场景：虚拟线程 / 切片：pinning 与锁替换
 * 适用参数：JDK 21+ 且存在 synchronized 临界区
 * 依赖规则：CONC-LOCK-002, CONC-LOCK-001
 * JDK：21
 */
package com.example.app.vt;

import java.util.concurrent.locks.ReentrantLock;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * pinning（钉死）：虚拟线程在 synchronized 块内、或调用 Object.wait / native 方法时，
 * 无法在等待时把载体线程让给别人，等于被「钉」在载体线程上。
 * 高并发下，大量虚拟线程在 synchronized 临界区排队 → 载体线程池被占满 →
 * 虚拟线程的吞吐优势归零，甚至比平台线程还糟。
 *
 * 替换方案：用 ReentrantLock。它的阻塞走 AQS，JVM 能在等待时正确挂起/恢复虚拟线程，
 * 不触发 pinning。注意：锁必须在 finally 释放（CONC-LOCK-002）。
 */
public final class CounterService {

    private final ReentrantLock lock = new ReentrantLock();
    private final JdbcTemplate jdbc;

    public CounterService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** 计数器自增。用 ReentrantLock 而非 synchronized，避免虚拟线程被 pin。 */
    public void increment(String key, long delta) {
        lock.lock();                 // 不 pinning：等待时虚拟线程可被挂起
        try {
            Long cur = jdbc.queryForObject(
                "SELECT v FROM kv_counter WHERE k = ? FOR UPDATE", Long.class, key);
            jdbc.update("UPDATE kv_counter SET v = ? WHERE k = ?", cur + delta, key);
        } finally {
            lock.unlock();
        }
    }
}""",
        'highlights': [
            {'mark': 'private final ReentrantLock lock = new ReentrantLock();',
             'title': '用 ReentrantLock 替代 synchronized',
             'text': 'ReentrantLock 的阻塞路径走 AQS，JVM 能在虚拟线程等待时正确挂起/恢复，不触发 pinning。',
             'rule': 'CONC-LOCK-002'},
            {'mark': 'lock.lock();',
             'title': '不 pinning 的加锁',
             'text': '虚拟线程在 ReentrantLock 上等待时会挂起并让出载体线程，并发度不再被载体线程数卡死。',
             'rule': 'CONC-LOCK-002'},
            {'mark': 'lock.unlock();',
             'title': '锁必须在 finally 释放',
             'text': '任何异常路径都要释放锁，否则后续所有请求永久阻塞。这正是 CONC-LOCK-002 的底线。',
             'rule': 'CONC-LOCK-002'},
        ],
        'pitfalls': [
            '在热路径用 synchronized —— 虚拟线程被 pin 到载体线程，高并发吞吐优势归零。',
            '锁内做 IO / 远程调用 —— 即便用 ReentrantLock，持锁等待 IO 也会把并发卡在临界区（CONC-LOCK-002）。',
            '忘记在 finally 里 unlock —— 一次异常后锁永远不释放，整段逻辑死锁。',
        ],
        'notSuitable': [
            '没有临界区（无共享可变状态）：本来就用不上锁，谈不上 pinning，也无替换对象。',
            '临界区极短且并发不高：pinning 影响可忽略，synchronized 足够，不必为虚拟线程改锁。',
        ],
        'relatedRules': ['CONC-LOCK-002', 'CONC-LOCK-001'],
        'refs': [
            {'title': 'OpenJDK JEP 444 · Pinning', 'url': 'https://openjdk.org/jeps/444'},
            {'title': 'Java SE 21 API · ReentrantLock',
             'url': 'https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/util/concurrent/locks/ReentrantLock.html'},
        ],
    },
    {
        'id': 'vt-backpressure',
        'order': 4,
        'goal': '并发闸门与快速失败：带超时的 Semaphore 限流',
        'layer': '并发',
        'when': {'jdk': ['j21', 'j25'], 'scale': ['high']},
        'why': '虚拟线程「无限创建」是双刃剑：下游有连接池/配额上限时，不加以节制，高峰期海量虚拟线程同时打下游'
               '→ 连接耗尽 / 限流 429 → 连锁失败。平台线程用「有界队列 + 拒绝策略」（CONC-POOL-004）兜底；'
               '虚拟线程用带超时的 Semaphore 做并发数闸门，避免无限等待。',
        'decision': {
            'question': '下游扛不住时怎么兜底？',
            'options': [
                '不限流，全部放行 —— 下游连接池耗尽、429 连锁失败',
                '靠池大小限流 —— 虚拟线程执行器是无限工厂，没有「池大小」可借',
                'Semaphore 无超时获取 —— 拿不到许可就永久挂起，虚拟线程堆积',
                'Semaphore 带超时获取 + 快速失败 —— 等价「有界队列 + 拒绝策略」',
            ],
            'chosen': 'Semaphore 带超时 tryAcquire + 快速失败。等价平台线程池的「有界队列 + 拒绝策略」'
                      '（CONC-POOL-004）：满了就明确拒绝，而不是无限积压。',
            'tradeoff': '代价是调用方要处理「被限流」的异常；收益是下游永远不会被自己拖垮，失败可预期、可重试。',
        },
        'sql': r"""-- 任务执行记录：Semaphore 限流后成功放行的调用记入此表，便于核对并发曲线。
CREATE TABLE `task_run` (
  `id`         BIGINT       NOT NULL AUTO_INCREMENT,
  `task_id`    BIGINT       NOT NULL,
  `acquired`   TINYINT      NOT NULL COMMENT '1=拿到并发许可 0=被限流快速失败',
  `started_at` DATETIME(3)  NULL,
  `ended_at`   DATETIME(3)  NULL,
  PRIMARY KEY (`id`),
  KEY `idx_task` (`task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='任务执行记录';""",
        'code': r"""/**
 * 场景：虚拟线程 / 切片：并发闸门与快速失败
 * 适用参数：JDK 21+ 且高并发调用有容量上限的下游
 * 依赖规则：CONC-POOL-004
 * JDK：21
 */
package com.example.app.vt;

import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

/**
 * 虚拟线程「无限创建」是双刃剑：下游有连接池/配额上限时，
 * 不加以节制，高峰期海量虚拟线程同时打下游 → 连接耗尽 / 限流 429 → 连锁失败。
 *
 * 平台线程用「有界队列 + 拒绝策略」（CONC-POOL-004）兜底；
 * 虚拟线程用 Semaphore 做并发数闸门，并给获取加超时，避免无限等待。
 */
public final class RateGuardedCaller {

    private final ExecutorService vt = Executors.newVirtualThreadPerTaskExecutor();
    private final Semaphore gate = new Semaphore(200);

    public <T> T callGuarded(Callable<T> task) throws Exception {
        // 带超时的获取：等不到许可就快速失败，而不是把虚拟线程挂死在 acquire 上
        if (!gate.tryAcquire(500, TimeUnit.MILLISECONDS)) {
            throw new IllegalStateException("下游并发已达上限，快速失败");
        }
        try {
            return vt.submit(task).get();
        } finally {
            gate.release();
        }
    }
}""",
        'highlights': [
            {'mark': 'private final Semaphore gate = new Semaphore(200);',
             'title': '并发数闸门',
             'text': '下游有容量上限，必须显式限流。虚拟线程没有「池大小」可顺手限流，'
                     'Semaphore 就是它的等价物（CONC-POOL-004）。',
             'rule': 'CONC-POOL-004'},
            {'mark': 'if (!gate.tryAcquire(500, TimeUnit.MILLISECONDS)) {',
             'title': '带超时，不无限等待',
             'text': '无超时获取会让拿不到许可的虚拟线程永久挂起、越积越多；超时才能把压力转成「可预期的失败」。',
             'rule': 'CONC-POOL-004'},
            {'mark': 'throw new IllegalStateException("下游并发已达上限，快速失败");',
             'title': '满了就明确拒绝',
             'text': '等价平台线程池的拒绝策略：不静默丢弃、不无限积压，让调用方拿到明确的失败去重试或降级。',
             'rule': 'CONC-POOL-004'},
        ],
        'pitfalls': [
            'Semaphore 无超时获取 —— 拿不到许可就永久挂起，虚拟线程越积越多直至资源枯竭。',
            '以为虚拟线程无限就不设闸门 —— 下游连接池/配额被打爆，429 连锁失败。',
            '快速失败不记录、不重试 —— 限流本应触发降级或退避，吞掉就白限了。',
        ],
        'notSuitable': [
            '下游无容量上限且调用量平稳：不需要并发闸门，直接每任务虚拟线程即可。',
            'Java 17：用平台线程池的有界队列 + 拒绝策略（CONC-POOL-004）兜底，思路一致。',
        ],
        'relatedRules': ['CONC-POOL-004'],
        'refs': [
            {'title': 'OpenJDK JEP 444 · Virtual Threads', 'url': 'https://openjdk.org/jeps/444'},
            {'title': '阿里巴巴Java开发手册 · 并发处理（有界队列/拒绝策略）',
             'note': 'CONC-POOL-004 的同款思想：有限资源必须显式兜底，禁止默认 AbortPolicy 沉默失败'},
        ],
    },
    {
        'id': 'vt-threadlocal',
        'order': 5,
        'goal': '海量虚拟线程下的 ThreadLocal：放大内存、必须清理、优先传参',
        'layer': '并发',
        'when': {'jdk': ['j21', 'j25'], 'scale': ['high']},
        'why': '虚拟线程数量可达百万级。用 ThreadLocal 存大对象或请求上下文，每个虚拟线程一份副本 → 堆内存被放大数倍甚至 OOM；'
               '忘了 remove（CONC-THRD-002）→ 旧请求数据泄漏到新任务。优先把上下文作为方法参数传递，或用 ScopedValue。',
        'decision': {
            'question': '请求级上下文怎么带？',
            'options': [
                'ThreadLocal 存大对象 —— 海量虚拟线程下内存被放大数倍，且忘了 remove 就泄漏',
                'ThreadLocal 存小对象 + finally remove —— 可用，但仍有副本放大',
                '方法参数显式传递 —— 零副本、零泄漏，最稳',
                'ScopedValue（JDK 21 孵化 / 24 转正）—— 一次性写入只读共享，天然无副本放大',
            ],
            'chosen': '优先方法参数显式传递；跨多层且只读的上下文用 ScopedValue（JDK 21 孵化、JDK 24 转正）。'
                      '若必须 ThreadLocal，务必在 finally 中 remove（CONC-THRD-002）。',
            'tradeoff': '代价是方法签名变长（传参）或引入 ScopedValue 的新 API；'
                        '收益是海量虚拟线程下不放大内存、不泄漏旧请求数据。',
        },
        'sql': r"""-- 请求级上下文来源表：虚拟线程下更推荐把上下文作为方法参数传递，而非塞进 ThreadLocal。
CREATE TABLE `tenant_ctx` (
  `tenant_id`  VARCHAR(32) NOT NULL,
  `name`       VARCHAR(64) NOT NULL,
  PRIMARY KEY (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='租户上下文';""",
        'code': r"""/**
 * 场景：虚拟线程 / 切片：海量虚拟线程下的 ThreadLocal
 * 适用参数：JDK 21+ 且高并发、需要请求级上下文
 * 依赖规则：CONC-THRD-002
 * JDK：21
 */
package com.example.app.vt;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Request/User 为业务入参与上下文（示意）。 */
record Request(String id) {}
record User(String id) {}

/**
 * 虚拟线程数量可达百万级。若用 ThreadLocal 存大对象或请求上下文：
 *   ① 每个虚拟线程一份副本 → 堆内存被放大数倍甚至 OOM；
 *   ② 忘了 remove（CONC-THRD-002）→ 旧请求数据泄漏到新任务。
 *
 * 优先做法：把上下文作为方法参数显式传递；或用 ScopedValue（JDK 21 孵化、JDK 24 转正）
 * 做「一次性写入、只读共享」的请求上下文，天然无副本放大、无需 remove。
 */
public final class ContextPassing {

    // 反例（不出现在运行路径）：海量虚拟线程下放大内存且易泄漏
    // private static final ThreadLocal<User> CTX = new ThreadLocal<>();

    private final ExecutorService vt = Executors.newVirtualThreadPerTaskExecutor();

    /** 上下文作为参数传递，零副本、零泄漏风险。 */
    public void handle(Request req, User user) {
        vt.submit(() -> doWork(req, user));
    }

    private void doWork(Request req, User user) {
        // user 沿调用链显式传递，不需要任何 ThreadLocal
    }
}""",
        'highlights': [
            {'mark': 'private final ExecutorService vt = Executors.newVirtualThreadPerTaskExecutor();',
             'title': '海量虚拟线程执行器',
             'text': '百万级虚拟线程下，任何「每线程一份」的状态都会放大——这是 ThreadLocal 在虚拟线程下最危险的特质。',
             'rule': 'CONC-THRD-002'},
            {'mark': '// private static final ThreadLocal<User> CTX = new ThreadLocal<>();',
             'title': '反例：放大的内存与泄漏',
             'text': '每个虚拟线程一份 User 副本，堆内存被放大数倍；忘了 remove 还会让旧请求数据泄漏到新任务。',
             'rule': 'CONC-THRD-002'},
            {'mark': 'public void handle(Request req, User user) {',
             'title': '上下文显式传参',
             'text': '把上下文作为方法参数传递，零副本、零泄漏，是虚拟线程下最稳的做法。',
             'rule': 'CONC-THRD-002'},
        ],
        'pitfalls': [
            '在海量虚拟线程下用 ThreadLocal 存大对象 —— 每线程一份副本，堆内存被放大数倍甚至 OOM。',
            'ThreadLocal 设了不 remove —— 旧请求数据泄漏到下一个任务，且虚拟线程复用会放大泄漏面（CONC-THRD-002）。',
            '把 ThreadLocal 当全局上下文总线 —— 虚拟线程下副本放大 + 清理遗漏，双重雷。',
        ],
        'notSuitable': [
            '并发规模低、虚拟线程数量有限：ThreadLocal 放大与泄漏风险都小，沿用即可（但仍要 finally remove）。',
            '没有请求级上下文需求：本来就没有 ThreadLocal 的使用场景。',
        ],
        'relatedRules': ['CONC-THRD-002'],
        'refs': [
            {'title': 'OpenJDK JEP 429 · Scoped Values', 'url': 'https://openjdk.org/jeps/429'},
            {'title': 'OpenJDK JEP 444 · Virtual Threads', 'url': 'https://openjdk.org/jeps/444'},
        ],
    },
]

CASE = {
    'id': 'virtual-thread',
    'order': 8,
    'name': '虚拟线程（Project Loom）：高并发 IO 任务怎么用才不踩坑',
    'subtitle': '虚拟线程不是「换了名字的线程池」，用错反而更慢或更不安全',
    'glyph': '⟐',
    'domain': ['聚合查询', '批量回源', '网关', '数据同步'],
    'problem': '大量 IO 等待型任务（远端 HTTP 调用、JDBC 查询、文件读写）并发跑，平台线程池被阻塞占满，吞吐上不去；'
               '盲目上虚拟线程后又踩 pinning、ThreadLocal 放大、无背压雪崩。',
    'symptoms': [
        '批量聚合调用时 Tomcat 容器线程被打满，新请求 503',
        '开了虚拟线程但 CPU 占用不降反升，吞吐没变化',
        '高峰期数千虚拟线程各自的 ThreadLocal 把堆内存拉爆',
        '虚拟线程无上限创建，下游被打挂后连锁失败',
    ],
    'drivers': DRIVERS,
    'conflicts': CONFLICTS,
    'slices': SLICES,
    'notSuitableFor': NOT_SUITABLE_FOR,
    'benchmark': BENCHMARK,
    'architecture': ARCHITECTURE,
}
