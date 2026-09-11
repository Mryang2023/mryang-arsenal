# -*- coding: utf-8 -*-
"""架构图叠加层：给选型维度补上「装配」所需的元信息。

现有 stack_*.py 回答的是「这个选项是什么」（详情、依赖、yaml、坑），
这个文件回答的是另一个问题：**把它们拼起来，能不能跑起来。**

做法是能力供需模型：
    每个选项声明 provides（提供什么能力）与 requires（需要什么能力）；
    校验时把所有已选项的 provides 求并集，再逐条检查 requires 是否被覆盖。
    没被覆盖 = 缺零件 = 跑不起来。

这样「缺什么」不是靠一组 if 硬编码判断出来的，而是算出来的 ——
新增一个选项只要声明能力，校验逻辑一行都不用改。

为什么用叠加层而不是直接改 stack_*.py：
    那些文件加起来 2000 多行，且内容是「选项详情」；架构元信息是另一个维度的事。
    叠加的好处是二者独立演进，且这里的每一处改动都能一眼看清。
"""

# ─────────────────────────────────────────────────────────────
# 泳道：按请求自顶向下穿过一个 Spring Boot 项目的顺序排列
# ─────────────────────────────────────────────────────────────

LANES = [
    {
        "id": "entry",
        "name": "接入层",
        "glyph": "⇥",
        "desc": "请求从这里进场。决定线程模型与整体编程范式，是整张图里最不该中途更换的一层。",
    },
    {
        "id": "app",
        "name": "应用能力",
        "glyph": "▣",
        "desc": "挂在入口上的横切能力：谁能进来、接口契约长什么样、实体与 DTO 怎么转换。",
    },
    {
        "id": "data",
        "name": "数据层",
        "glyph": "▦",
        "desc": "业务数据的落点。层内是一条流水线：持久层 → 数据库 → 连接池 → 迁移。",
    },
    {
        "id": "infra",
        "name": "中间件与调度",
        "glyph": "⇉",
        "desc": "每引入一个就多一个运维面。这一层默认应当留空，被真实需求逼到才装。",
    },
    {
        "id": "quality",
        "name": "保障与观测",
        "glyph": "⛨",
        "desc": "决定两件事：线上出问题你知不知道，改完代码你敢不敢发。",
    },
    {
        "id": "base",
        "name": "运行时基座",
        "glyph": "⬡",
        "desc": "语言与构建。改这两项等于全项目返工，必须最先定死，之后不再讨论。",
    },
]

# ─────────────────────────────────────────────────────────────
# 能力字典：把内部 id 翻译成人能读懂的话，直接显示在方块上
# ─────────────────────────────────────────────────────────────

CAP_NAME = {
    "cap.jvm": "语言运行时",
    "cap.build": "构建与依赖解析",
    "cap.http": "HTTP 请求入口",
    "cap.http.blocking": "阻塞式线程模型",
    "cap.http.reactive": "响应式事件循环",
    "cap.virtual.threads": "虚拟线程调度",
    "cap.datasource": "数据源连接",
    "cap.db.sql": "SQL 数据库",
    "cap.persistence": "数据读写能力",
    "cap.orm": "对象-表映射",
    "cap.pool": "连接池管理",
    "cap.migration": "库结构版本化",
    "cap.cache.local": "进程内缓存",
    "cap.cache.distributed": "分布式缓存",
    "cap.mq": "异步消息投递",
    "cap.registry": "服务注册与发现",
    "cap.config.center": "配置集中管理",
    "cap.schedule.local": "单机定时触发",
    "cap.schedule.distributed": "分布式任务调度",
    "cap.auth": "身份认证与鉴权",
    "cap.apidoc": "接口契约文档",
    "cap.mapping": "实体与 DTO 转换",
    "cap.boilerplate": "样板代码生成",
    "cap.metrics": "运行指标采集",
    "cap.metrics.scrape": "指标外暴露与告警",
    "cap.test": "单元测试能力",
    "cap.test.isolated": "真实依赖的隔离测试",
}

# ─────────────────────────────────────────────────────────────
# 槽位（= 一个选型维度）在架构图里的位置与必要性
#
#   required   缺了它，项目起不来 / 编译不过 —— 这是「跑不起来」的唯一来源
#   recommended 缺了能跑，但架构不完整，属于「该补的件」
#   missing    缺它时给出的具体后果，直接显示在空槽位上
# ─────────────────────────────────────────────────────────────

NODE_ARCH = {
    # ── 接入层 ──────────────────────────────────────────────
    "web": {
        "lane": "entry",
        "icon": "⇥",
        "role": "HTTP 入口",
        "required": True,
        "missing": "没有接入层，进程起来后没有任何端口在监听，请求根本进不来。",
    },
    # ── 应用能力 ────────────────────────────────────────────
    "auth": {
        "lane": "app",
        "icon": "⛨",
        "role": "鉴权",
        "required": False,
        "recommended": True,
        "missing": "没有鉴权，所有接口对任何能连上端口的人开放 —— 包括删除和改数据的接口。",
    },
    "apidoc": {
        "lane": "app",
        "icon": "❐",
        "role": "接口契约",
        "required": False,
        "missing": "没有接口文档，前后端只能靠口头对齐字段，改动后无从比对差异。",
    },
    "mapping": {
        "lane": "app",
        "icon": "⇄",
        "role": "对象映射",
        "required": False,
        "recommended": True,
        "missing": "没有固定的实体↔DTO 转换策略，转换代码会在每个 Service 里各写一遍，字段一多就开始漏字段。",
    },
    "boilerplate": {
        "lane": "app",
        "icon": "⌘",
        "role": "样板代码",
        "required": False,
        "missing": "不表态就意味着团队里会同时存在 Lombok 与手写两种风格，同一份代码两种写法。",
    },
    # ── 数据层 ──────────────────────────────────────────────
    "persistence": {
        "lane": "data",
        "icon": "▤",
        "role": "持久层",
        "required": True,
        "missing": "没有持久层，数据无处可存 —— 只能放在内存变量里，进程一重启就全丢。",
    },
    "database": {
        "lane": "data",
        "icon": "⛁",
        "role": "数据库",
        "required": True,
        "missing": "没有数据库，持久层拿不到连接。启动时连接池初始化就会抛异常，应用直接起不来。",
    },
    "pool": {
        "lane": "data",
        "icon": "⊞",
        "role": "连接池",
        "required": False,
        "recommended": True,
        "missing": "不显式选：Spring Boot 会自动装配 HikariCP，但池大小、超时、泄漏检测全走默认值 —— 默认值未必配得上你的下游。",
    },
    "migration": {
        "lane": "data",
        "icon": "⇡",
        "role": "迁移",
        "required": False,
        "missing": "没有版本化迁移，「当前生产库是哪个版本」没有确定答案，回滚靠记忆。",
    },
    # ── 中间件与调度 ────────────────────────────────────────
    "cache": {
        "lane": "infra",
        "icon": "⚡",
        "role": "缓存",
        "required": False,
        "missing": "不使用缓存。所有读请求直达数据库 —— 数据量没起来之前，这是最省事的选择。",
    },
    "mq": {
        "lane": "infra",
        "icon": "✉",
        "role": "消息队列",
        "required": False,
        "missing": "不使用消息队列。需要异步化的动作只能靠本地线程池，进程一挂任务就丢了。",
    },
    "registry": {
        "lane": "infra",
        "icon": "◈",
        "role": "注册与配置中心",
        "required": False,
        "missing": "单体单实例，不需要注册中心。地址写死在配置里即可，少一个中间件要维护。",
    },
    "scheduler": {
        "lane": "infra",
        "icon": "⟳",
        "role": "定时任务",
        "required": False,
        "missing": "不需要定时任务，或由外部系统触发。",
    },
    # ── 保障与观测 ──────────────────────────────────────────
    "observability": {
        "lane": "quality",
        "icon": "◉",
        "role": "可观测性",
        "required": False,
        "recommended": True,
        "missing": "没有任何指标，「系统现在是否健康」只能靠用户投诉来发现。",
    },
    "test": {
        "lane": "quality",
        "icon": "✓",
        "role": "测试策略",
        "required": False,
        "recommended": True,
        "missing": "没有测试策略，每次改动都是拿生产环境当测试环境。",
    },
    # ── 运行时基座 ──────────────────────────────────────────
    "jdk": {
        "lane": "base",
        "icon": "⬡",
        "role": "语言运行时",
        "required": True,
        "missing": "没有语言版本，连编译目标都无法确定，构建第一步就失败。",
    },
    "build": {
        "lane": "base",
        "icon": "⚒",
        "role": "构建工具",
        "required": True,
        "missing": "没有构建工具，依赖下载不下来、产物打不出来，代码写完也无法交付。",
    },
}

# ─────────────────────────────────────────────────────────────
# 选项的能力声明
#
#   provides  装了这个零件后，系统多出什么能力
#   requires  这个零件要向系统索要什么能力，拿不到就转不起来
#
# 「不用 / 不使用」类选项两个都为空 —— 它不提供能力，也不索要能力，
# 因此不会凭空制造报错。这是刻意的：留空应当是安全的选择。
# ─────────────────────────────────────────────────────────────

OPTION_ARCH = {
    "jdk": {
        "17": {"provides": ["cap.jvm"]},
        "21": {"provides": ["cap.jvm", "cap.virtual.threads"]},
    },
    "build": {
        "maven": {"provides": ["cap.build"]},
        "gradle": {"provides": ["cap.build"]},
    },
    "web": {
        "mvc": {"provides": ["cap.http", "cap.http.blocking"]},
        "webflux": {"provides": ["cap.http", "cap.http.reactive"]},
    },
    "persistence": {
        # 三个持久层都需要：语言运行时 + 数据源 + 真正的 SQL 库
        "jdbc": {
            "requires": ["cap.jvm", "cap.datasource", "cap.db.sql"],
            "provides": ["cap.persistence"],
        },
        "mybatisplus": {
            "requires": ["cap.jvm", "cap.datasource", "cap.db.sql"],
            "provides": ["cap.persistence", "cap.orm"],
        },
        "jpa": {
            "requires": ["cap.jvm", "cap.datasource", "cap.db.sql"],
            "provides": ["cap.persistence", "cap.orm"],
        },
    },
    "database": {
        "mysql": {"provides": ["cap.datasource", "cap.db.sql"]},
        "postgres": {"provides": ["cap.datasource", "cap.db.sql"]},
    },
    "pool": {
        "hikari": {"requires": ["cap.db.sql"], "provides": ["cap.pool"]},
        "druid": {"requires": ["cap.db.sql"], "provides": ["cap.pool"]},
    },
    "migration": {
        "flyway": {"requires": ["cap.db.sql"], "provides": ["cap.migration"]},
        "liquibase": {"requires": ["cap.db.sql"], "provides": ["cap.migration"]},
        "none": {"provides": [], "requires": []},
    },
    "cache": {
        "none": {"provides": [], "requires": []},
        "caffeine": {"requires": ["cap.jvm"], "provides": ["cap.cache.local"]},
        "redis": {"provides": ["cap.cache.distributed"]},
    },
    "mq": {
        "none": {"provides": [], "requires": []},
        "rocketmq": {"provides": ["cap.mq"]},
        "rabbitmq": {"provides": ["cap.mq"]},
        "kafka": {"provides": ["cap.mq"]},
    },
    "registry": {
        "none": {"provides": [], "requires": []},
        "nacos": {"provides": ["cap.registry", "cap.config.center"]},
    },
    "scheduler": {
        "spring": {"requires": ["cap.jvm"], "provides": ["cap.schedule.local"]},
        "xxljob": {"requires": ["cap.jvm"], "provides": ["cap.schedule.distributed"]},
    },
    "auth": {
        "securityjwt": {"requires": ["cap.http"], "provides": ["cap.auth"]},
        "satoken": {"requires": ["cap.http"], "provides": ["cap.auth"]},
        "custom": {"requires": ["cap.http"], "provides": ["cap.auth"]},
    },
    "apidoc": {
        "springdoc": {"requires": ["cap.http"], "provides": ["cap.apidoc"]},
        "knife4j": {"requires": ["cap.http"], "provides": ["cap.apidoc"]},
        "none": {"provides": [], "requires": []},
    },
    "observability": {
        "none": {"provides": [], "requires": []},
        # 注意：prometheus 这一档是「Actuator + Prometheus + Grafana」，
        # 它本身就含 Actuator，所以自己就要提供 cap.metrics，
        # 不能写成「需要 cap.metrics」—— 那样等于向自己索要，永远拼不出来。
        "actuator": {"requires": ["cap.jvm"], "provides": ["cap.metrics"]},
        "prometheus": {
            "requires": ["cap.jvm"],
            "provides": ["cap.metrics", "cap.metrics.scrape"],
        },
    },
    "mapping": {
        "manual": {"provides": ["cap.mapping"]},
        "mapstruct": {"requires": ["cap.jvm"], "provides": ["cap.mapping"]},
    },
    "boilerplate": {
        "lombok": {"requires": ["cap.jvm"], "provides": ["cap.boilerplate"]},
        "plain": {"provides": [], "requires": []},
    },
    "test": {
        "mockito": {"requires": ["cap.jvm"], "provides": ["cap.test"]},
        "testcontainers": {
            "requires": ["cap.jvm"],
            "provides": ["cap.test", "cap.test.isolated"],
        },
    },
}

# ─────────────────────────────────────────────────────────────
# 层内流水线：同一泳道里**参与请求链路**的槽位先后顺序。
#
# 只有真正被请求流经的组件才进流水线。迁移（Flyway / Liquibase）不在此列 ——
# 它在发布期执行，请求进来时它并不在链路上。把它画进流水线是语义错误，
# 会让人误以为请求会「经过」迁移工具。
# 未列入的槽位排在流水线之后，用一个分隔符表示它不在这条线上。
# ─────────────────────────────────────────────────────────────

PIPELINES = {
    "data": ["persistence", "database", "pool"],
}

# ─────────────────────────────────────────────────────────────
# 组合策略：单看每个选项都对，拼起来才出问题的那类情况
#
#   when   声明式命中条件：维度 → 命中任一选项即可；多个维度之间是「与」
#   level  blocker 跑不起来 / risk 能跑但会出事 / note 知道就好
# ─────────────────────────────────────────────────────────────

POLICIES = [
    {
        "id": "ARCH-WEBFLUX-BLOCKING",
        "level": "blocker",
        "when": {"web": ["webflux"], "persistence": ["jdbc", "mybatisplus", "jpa"]},
        "nodes": ["web", "persistence"],
        "title": "响应式链路上挂了阻塞式持久层",
        "text": (
            "WebFlux 的全部收益来自「不阻塞事件循环」。而 JDBC 系持久层的每一次查询都会阻塞"
            "当前线程，在响应式链路里被阻塞的不是一个工作线程，是整个事件循环 —— "
            "少量并发就能让服务失去响应。这个组合能启动，但一上负载就废。"
        ),
        "fix": "两条路选一条：持久层换 R2DBC（真响应式），或 Web 运行时换回 Spring MVC（务实）。",
    },
    {
        "id": "ARCH-MQ-NONE-ASYNC",
        "level": "note",
        "when": {"mq": ["none"], "scheduler": ["xxljob"]},
        "nodes": ["mq", "scheduler"],
        "title": "已有分布式调度，却没有消息队列",
        "text": (
            "XXL-Job 负责「什么时候跑」，不负责「跑不完怎么办」。"
            "如果任务里存在跨系统调用或大批量写库，失败重试与削峰仍需消息队列兜底。"
        ),
        "fix": "若任务本身是短事务、可重入的，可以保持不动。",
    },
    {
        "id": "ARCH-MULTI-INSTANCE-LOCAL-CACHE",
        "level": "risk",
        "when": {"cache": ["caffeine"], "registry": ["nacos"]},
        "nodes": ["cache", "registry"],
        "title": "多实例部署，却用了进程内缓存",
        "text": (
            "选了注册中心就意味着服务会有多个实例。Caffeine 的缓存各自在进程内："
            "A 实例更新数据后只清了自己的缓存，B 实例会继续返回旧值，直到自然过期。"
            "表现为「刷新几次结果不一样」这种极难复现的问题。"
        ),
        "fix": "只把它用在变更极少、且能容忍短暂不一致的数据上；否则换 Redis。",
    },
    {
        "id": "ARCH-MULTI-INSTANCE-SCHEDULER",
        "level": "risk",
        "when": {"scheduler": ["spring"], "registry": ["nacos"]},
        "nodes": ["scheduler", "registry"],
        "title": "@Scheduled 在多实例下会重复执行",
        "text": (
            "多实例部署时，每个实例都会在预定时间各自跑一遍定时任务。"
            "数据会被重复处理 N 次（N = 实例数），而且通常不会报错，只是结果悄悄翻倍。"
        ),
        "fix": "给任务加 ShedLock 分布式锁，或改用 XXL-Job 这类调度中心统一触发。",
    },
    {
        "id": "ARCH-CUSTOM-AUTH",
        "level": "risk",
        "when": {"auth": ["custom"]},
        "nodes": ["auth"],
        "title": "自研鉴权：每个漏掉的细节都是漏洞",
        "text": (
            "自己写 JWT 鉴权需要完整处理：签名算法白名单（防 alg=none 绕过）、"
            "时钟偏移容忍、权限判定时机、ThreadLocal 用完必须清理（漏清理会造成跨请求越权）。"
            "漏掉任何一项都是可被直接利用的安全漏洞。"
        ),
        "fix": "非必要不选。要用就直接用 Spring Security 或 Sa-Token 这类被审计过的实现。",
    },
    {
        "id": "ARCH-NO-MIGRATION",
        "level": "risk",
        "when": {"migration": ["none"]},
        "nodes": ["migration"],
        "title": "库结构没有版本化",
        "text": (
            "没有迁移工具，说明表结构变更只存在于某次手工执行的 SQL 里。"
            "环境之间对不齐、回滚时不知道该退到哪一版，都是从这里开始的。"
        ),
        "fix": "至少把所有 DDL 集中进一个受版本控制的 sql 文件，并为每个变更写明执行顺序。",
    },
    {
        "id": "ARCH-NO-OBSERVABILITY",
        "level": "risk",
        "when": {"observability": ["none"]},
        "nodes": ["observability"],
        "title": "没有任何运行指标",
        "text": (
            "没有指标意味着无法回答「现在是否健康」「刚才那次变慢是哪里慢」。"
            "发现问题的方式只剩下用户报障。"
        ),
        "fix": "最低成本：加 Actuator 暴露 /health 与 /metrics，先用健康检查兜底。",
    },
    {
        "id": "ARCH-API-DOC-PUBLIC",
        "level": "note",
        "when": {"apidoc": ["springdoc", "knife4j"]},
        "nodes": ["apidoc"],
        "title": "接口文档在生产环境必须关闭",
        "text": (
            "文档会把接口结构、参数名与示例暴露给任何能访问到它的人，"
            "连鉴权规则都一并交代清楚。"
        ),
        "fix": "生产 profile 关闭：springdoc.swagger-ui.enabled=false / knife4j.enable=false。",
    },
    {
        "id": "ARCH-VIRTUAL-THREAD-POOL",
        "level": "note",
        "when": {"jdk": ["21"], "web": ["mvc"]},
        "nodes": ["jdk", "pool"],
        "title": "JDK 21 + MVC 可以开虚拟线程，但瓶颈会转移",
        "text": (
            "开启 spring.threads.virtual.enabled=true 后，Tomcat 不再受 max-threads 约束，"
            "并发承载能力大幅上升 —— 而数据库连接池的 maximum-pool-size 没变。"
            "结果是大量虚拟线程在等连接，故障表现从「线程不够」变成「获取连接超时」。"
        ),
        "fix": "开启前先重新核算连接池大小，并对下游接口做限流。",
    },
    {
        "id": "ARCH-DRUID-WITH-JPA",
        "level": "note",
        "when": {"pool": ["druid"], "persistence": ["jpa"]},
        "nodes": ["pool", "persistence"],
        "title": "Druid 与 JPA 共存时的统计口径",
        "text": "Druid 的慢 SQL 统计基于 JDBC 层，JPA 生成的多条语句会各自计入，排查时容易被放大后的条数误导。",
        "fix": "以 Hibernate 的 show-sql 与实际执行计划为准，Druid 只用于连接层面的监控。",
    },
    {
        "id": "ARCH-POSTGRES-CASE",
        "level": "note",
        "when": {"database": ["postgres"]},
        "nodes": ["database"],
        "title": "PostgreSQL 的标识符会折叠成小写",
        "text": "建表时若用双引号包裹大写字段名，字段名就会被永久固定为大小写敏感，之后所有查询都必须带引号，否则找不到列。",
        "fix": "统一用小写下划线命名，永远不要在 DDL 里加双引号。",
    },
    {
        "id": "ARCH-KAFKA-PARTITION",
        "level": "note",
        "when": {"mq": ["kafka"]},
        "nodes": ["mq"],
        "title": "Kafka 的分区数只能增不能减",
        "text": "分区数决定消费并行度上限。事后增加分区会打乱同一个 key 的分配关系，破坏原有的顺序保证。",
        "fix": "按目标吞吐一次性定好分区数，宁多勿少（但别超过消费者实例数的量级）。",
    },
]

# ─────────────────────────────────────────────────────────────
# 四套预设：不是「推荐配置」，而是四种典型的取舍立场
# ─────────────────────────────────────────────────────────────

PRESET_NOTES = {
    "minimal": "能跑通、能量产的最小集。所有可选项留空，只在被真实需求逼到时才加。",
    "standard": "单人/小团队的生产配置。加了缓存与可观测性，够用且不复杂。",
    "cloud": "为多实例与横向扩容准备的形态。注意随之而来的分布式一致性问题。",
    "enterprise": "以合规与可审计优先。Postgres + Liquibase + Druid 监控是这一立场的直接结果。",
}

# ─────────────────────────────────────────────────────────────
# v0.2 增补 · 把「隐患」写具体
#
# 原来的 level + title + text + fix 只回答了「这是个隐患」和「怎么改」。
# 用户看到的仍然是一句判断。真正能拿去做判断的是另外三件事：
#
#   trigger   什么条件下它才会发生（不是所有组合都成立）
#   symptoms  发生时你会在哪里看到什么（越具体越可核对）
#   impact    不处理的后果边界在哪
#
# 这三项补齐之后，一条隐患才从「一个警告」变成「一条可以拿去比对现场的线索」。
# 判断标准：symptoms 里每一条都必须是能在监控、日志或数据里看到的东西 ——
# 写不出可观察现象的，就不算隐患，只是观点。
#
# 为什么用追加而不是就地改 POLICIES：
#   上面那 12 条加起来约 140 行，就地插入会让 diff 覆盖全文，没法 review。
#   分成「策略（什么时候命中）」与「详情（命中了说明什么）」两段，
#   构建期再校验两者一一对应 —— 漏写一条当场炸，不会静默少显示一段。
# ─────────────────────────────────────────────────────────────

POLICY_DETAIL = {
    "ARCH-WEBFLUX-BLOCKING": {
        "trigger": "Web 运行时选了 WebFlux，同时持久层选了 JDBC / MyBatis-Plus / JPA 中任意一个",
        "symptoms": [
            "并发压上去之后 P99 从几十毫秒跳到数秒，但 CPU 利用率并不高 —— 线程都在等 IO",
            "日志里出现 blocking call on reactor-http-nio-x 之类的告警",
            "连接池耗尽后所有接口一起卡死，连 /actuator/health 也不再响应",
        ],
        "impact": "被阻塞的不是一个工作线程，是整个事件循环。少量并发就能让服务失去响应，且无法通过加实例解决。",
    },
    "ARCH-MQ-NONE-ASYNC": {
        "trigger": "选了分布式调度 XXL-Job，但消息队列留空",
        "symptoms": [
            "任务里一次批量写库中途失败，数据只写了一半，没有任何补偿",
            "任务耗时超过调度间隔，下一次触发时上一次还没跑完",
        ],
        "impact": "失败的任务无法重放，只能人工查数、补数。任务量越大，修补成本越高。",
    },
    "ARCH-MULTI-INSTANCE-LOCAL-CACHE": {
        "trigger": "选了注册中心（意味着多实例），同时缓存选了进程内的 Caffeine",
        "symptoms": [
            "在 A 实例改了数据，B 实例仍然返回旧值",
            "同一个接口连续刷新几次，结果不一样",
            "重启任意一个实例后现象消失 —— 这是最典型的特征",
        ],
        "impact": "数据不一致且难以复现（取决于请求落到哪个实例），排查成本极高。",
    },
    "ARCH-MULTI-INSTANCE-SCHEDULER": {
        "trigger": "选了注册中心（多实例），定时任务用的是 Spring @Scheduled",
        "symptoms": [
            "同一批数据被处理 N 次（N = 实例数）",
            "推送、短信、邮件这类任务重复发出",
            "数据库里出现重复记录，或金额、计数被翻倍",
        ],
        "impact": "无声的重复执行。多数情况不抛异常，只在最终数据上体现，发现时通常已积累多日。",
    },
    "ARCH-CUSTOM-AUTH": {
        "trigger": "认证鉴权选了自研实现",
        "symptoms": [
            "构造 alg=none 的 JWT 可以绕过签名校验（未做算法白名单）",
            "上一个请求的用户信息泄漏到下一个请求（ThreadLocal 用后未清理）",
            "令牌过期后仍能访问（未校验 exp，或没有时钟偏移容忍）",
        ],
        "impact": "每一处遗漏都是一个可被直接利用的越权漏洞，且不会在功能测试中暴露。",
    },
    "ARCH-NO-MIGRATION": {
        "trigger": "数据库迁移选了「不使用」",
        "symptoms": [
            "新环境部署后接口报 Unknown column —— 有人手工执行过 DDL 但没同步",
            "回滚时不知道该退到哪一版表结构",
            "开发库与生产库的表结构存在肉眼难查的细微差异",
        ],
        "impact": "环境不可复现。发布和回滚都依赖人的记忆，是长期事故来源。",
    },
    "ARCH-NO-OBSERVABILITY": {
        "trigger": "可观测性选了「不使用」",
        "symptoms": [
            "线上变慢只能靠用户报障发现",
            "无法回答「刚才那次抖动是哪个接口、哪个下游引起的」",
            "没有 /actuator/health，容器编排无法判断实例是否健康，只能盲目重启",
        ],
        "impact": "故障的发现时间与定位时间同时被拉长，平均恢复时间成倍上升。",
    },
    "ARCH-API-DOC-PUBLIC": {
        "trigger": "接口文档选了 SpringDoc 或 Knife4j",
        "symptoms": [
            "生产域名下 /swagger-ui/index.html 可以直接打开",
            "未登录用户能看到全部接口路径、参数名与示例结构",
        ],
        "impact": "接口结构整体泄露，等于替攻击者省去了踩点步骤。",
    },
    "ARCH-VIRTUAL-THREAD-POOL": {
        "trigger": "JDK 选了 21（虚拟线程可用）且 Web 运行时是 Spring MVC",
        "symptoms": [
            "开启虚拟线程后压测报 HikariPool - Connection is not available, request timed out",
            "并发越高错误率越高，而数据库 CPU 并不高",
            "故障表现从「线程池打满」变成「获取连接超时」",
        ],
        "impact": "吞吐瓶颈从 Tomcat 线程数转移到数据库连接池。开了虚拟线程但没核算池大小，等于把堵点往后挪了一格。",
    },
    "ARCH-DRUID-WITH-JPA": {
        "trigger": "连接池选了 Druid，持久层选了 JPA",
        "symptoms": [
            "Druid 的慢 SQL 列表里，同一次业务操作会展开成多条语句",
            "按语句条数统计的慢查询比例明显虚高",
        ],
        "impact": "排查时容易被放大后的条数误导，把精力花在 Hibernate 生成的无关语句上。",
    },
    "ARCH-POSTGRES-CASE": {
        "trigger": "数据库选了 PostgreSQL",
        "symptoms": [
            "DDL 里用双引号包裹过字段名后，查询报 column \"xxx\" does not exist",
            "psql 里能看到这一列，程序里却查不到",
        ],
        "impact": "字段名被永久固定为大小写敏感，之后所有 SQL 都必须带引号，一处漏写就报错。",
    },
    "ARCH-KAFKA-PARTITION": {
        "trigger": "消息队列选了 Kafka",
        "symptoms": [
            "扩容分区之后，同一个 key 的消息被分配到不同分区",
            "消费端出现顺序错乱或重复处理",
        ],
        "impact": "同一 key 的顺序保证被破坏且不可逆 —— 分区数只能增不能减，事后无法回退。",
    },
}

# ─────────────────────────────────────────────────────────────
# v0.2 增补 · 四条新隐患
#
# 选它们的理由：都在「单独看每个选项都对」的范畴里，且都极常见。
# 特别是鉴权与文档那一对 —— 几乎每个加了 Spring Security 的项目都要撞一次。
# ─────────────────────────────────────────────────────────────

POLICIES += [
    {
        "id": "ARCH-NACOS-UNAUTHENTICATED",
        "level": "risk",
        "when": {"registry": ["nacos"]},
        "nodes": ["registry"],
        "title": "Nacos 默认不开鉴权，配置中心是裸的",
        "text": (
            "Nacos 默认关闭认证。任何能连到 8848 端口的人都能读走你的全部配置 —— "
            "包括数据源密码、第三方密钥。同样也能改写配置，"
            "让所有实例在下一次拉取时按新配置运行。"
        ),
        "fix": "开启 nacos.core.auth.enabled=true 并替换默认密钥，8848/9848 不对公网暴露。",
    },
    {
        "id": "ARCH-SECURITY-BLOCKS-APIDOC",
        "level": "note",
        "when": {"auth": ["securityjwt", "satoken"], "apidoc": ["springdoc", "knife4j"]},
        "nodes": ["auth", "apidoc"],
        "title": "加了鉴权之后，接口文档会整体 401",
        "text": (
            "鉴权框架默认拦截所有路径。文档页与 /v3/api-docs 不在放行名单里时，"
            "页面打开是一片空白或一串 401 —— 而报错信息指向鉴权，"
            "让人误以为是令牌的问题。"
        ),
        "fix": "在安全配置里放行 /v3/api-docs/**、/swagger-ui/**、/doc.html、/webjars/**，且只在非生产 profile 生效。",
    },
    {
        "id": "ARCH-SCHEDULER-SINGLE-THREAD",
        "level": "risk",
        "when": {"scheduler": ["spring"]},
        "nodes": ["scheduler"],
        "title": "@Scheduled 默认只有一个调度线程",
        "text": (
            "Spring 调度线程池默认 size=1，所有定时任务共用它。"
            "只要其中一个任务跑得慢，其余任务的全部触发都会顺延，且不会报错。"
            "现象是「任务偶尔不执行」，实际是排队排到了下一次触发时间之后。"
        ),
        "fix": "显式配置 spring.task.scheduling.pool.size（按任务数与单次耗时估算），并给每个任务设超时。",
    },
    {
        "id": "ARCH-POOL-SIZE-UNSET",
        "level": "note",
        "when": {"pool": ["hikari"], "registry": ["nacos"]},
        "nodes": ["pool", "registry"],
        "title": "连接池默认 10，多实例下会打爆数据库",
        "text": (
            "HikariCP 默认 maximum-pool-size=10。服务有 N 个实例时对数据库的总连接数就是 N×10，"
            "扩容还会等比放大。而数据库的 max_connections 通常在 150～200 之间，"
            "四五个实例就能顶到上限，第六个实例连启动都失败。"
        ),
        "fix": "按「实例数 × 池大小 < 数据库 max_connections × 80%」反推池大小，并把 connection-timeout 设成有限值。",
    },
]

POLICY_DETAIL.update({
    "ARCH-NACOS-UNAUTHENTICATED": {
        "trigger": "注册中心 / 配置中心选了 Nacos",
        "symptoms": [
            "8848 端口可直接访问，未登录即可打开控制台",
            "curl 一次 /nacos/v1/cs/configs 就能拿到包含数据库密码的完整配置",
            "配置在无人改动的情况下发生变化",
        ],
        "impact": "配置中心同时泄露凭据与被篡改的入口。改配置比改代码更隐蔽 —— 不产生发布记录。",
    },
    "ARCH-SECURITY-BLOCKS-APIDOC": {
        "trigger": "鉴权选了 Spring Security JWT 或 Sa-Token，同时选了 SpringDoc / Knife4j",
        "symptoms": [
            "打开 /swagger-ui/index.html 或 /doc.html 是空白页或 401",
            "浏览器控制台里 /v3/api-docs 请求返回 401",
            "把鉴权关掉就正常 —— 说明问题在放行名单",
        ],
        "impact": "文档与鉴权是两个独立配置，漏配放行的表现会被误判成令牌问题，浪费排查时间。",
    },
    "ARCH-SCHEDULER-SINGLE-THREAD": {
        "trigger": "定时任务选了 Spring @Scheduled，且任务数大于 1",
        "symptoms": [
            "某个任务跑久之后，其他任务在那一轮集体没执行",
            "日志里任务的实际开始时间与 cron 表达式对不上，且偏差随任务耗时累积",
            "任务执行耗时统计呈锯齿状 —— 实际量的是排队时间",
        ],
        "impact": "任务被静默延迟，不报错不告警。数据类任务表现为「今天的数据没跑」，发现时已影响下游。",
    },
    "ARCH-POOL-SIZE-UNSET": {
        "trigger": "连接池选了 HikariCP，同时选了注册中心（意味着会多实例部署）",
        "symptoms": [
            "扩容到第 N 个实例时新实例启动失败，报 Too many connections",
            "高峰期日志出现 HikariPool - Connection is not available, request timed out",
            "数据库侧连接数长期贴着 max_connections 上限",
        ],
        "impact": "连接数随实例数线性增长，而数据库上限是固定的。扩容不但没提升容量，反而把整个服务推向不可用。",
    },
})
