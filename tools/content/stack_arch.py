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
        "id": "delivery",
        "name": "交付与运行",
        "glyph": "⬢",
        "desc": "代码怎么变成一个正在跑的进程：谁打包、谁重启、谁负责扩容与回滚。",
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
    # ── 交付与运行 ─────────────────────────────────────────
    "cap.packaging": "可执行产物",
    "cap.image": "容器镜像",
    "cap.orchestration": "编排调度与自愈",
    "cap.release.templating": "多环境发布参数化",
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
    # ── 交付与运行 ─────────────────────────────────────────
    "deploy": {
        "lane": "delivery",
        "icon": "⬢",
        "role": "交付形态",
        "required": False,
        "recommended": True,
        "missing": (
            "没有选定交付形态，「代码跑在哪台机器上、挂了谁来重启」就没有确定答案。"
            "能启动不等于能运维 —— 这一格留空，意味着发布与回滚都要现想办法。"
        ),
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
    # ── 交付与运行 ─────────────────────────────────────────
    # 能力链条自下而上：})-可打包 → 能出镜像 → 能编排 → 能参数化多环境。
    # 后两级各自把前一级的能力一并声明出来，是因为它们本身就含那条链路 ——
    # 选了 K8s 就等于「镜像由流水线产出」，不需要再单独选一次 Docker。
    # 反过来，**向自己索要是被明令禁止的**：cap.image 的提供者全都在这个槽位里，
    # 若写成 requires cap.image，用户就永远拼不出可运行组合（构建期会直接拦下来）。
    "deploy": {
        "jar": {
            "requires": ["cap.build", "cap.http"],
            "provides": ["cap.packaging"],
        },
        "docker": {
            "requires": ["cap.build", "cap.http"],
            "provides": ["cap.packaging", "cap.image"],
        },
        "k8s": {
            "requires": ["cap.build", "cap.http"],
            "provides": ["cap.packaging", "cap.image", "cap.orchestration"],
        },
        "helm": {
            "requires": ["cap.build", "cap.http"],
            "provides": [
                "cap.packaging", "cap.image", "cap.orchestration",
                "cap.release.templating",
            ],
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


# ─────────────────────────────────────────────────────────────
# v0.3 增补 · 容器编排带来的五条隐患
#
# 为什么值得专门为「交付与运行」写一批策略：
#   编排平台是第一个**会替你做决定**的组件 —— 它判断实例是否健康、要不要重启、
#   要不要扩容。而它做这些决定依赖的信息全部来自应用自己暴露的东西。
#   信息没给够时，平台不会报错，它会按错误的信息继续做下去：
#   没配 readiness 就把启动中的实例塞进 Service（发布期随机 502），
#   没配指标就按 CPU 扩容（IO 密集服务扩了也没用），
#   多副本照跑 @Scheduled（任务被静默执行 N 次）。
#   这一批全都属于「单独看每个零件都对」的范畴。
# ─────────────────────────────────────────────────────────────

POLICIES += [
    {
        "id": "ARCH-K8S-NO-PROBE",
        "level": "risk",
        "when": {"deploy": ["k8s", "helm"], "observability": ["none"]},
        "nodes": ["deploy", "observability"],
        "title": "编排平台要替你重启实例，但它不知道什么叫「活着的」",
        "text": (
            "liveness / readiness 探针需要一个 HTTP 端点。没有它，平台唯一能判断的"
            "只有「进程还在不在」—— 而死锁、线程池耗尽、连接池打满这三种最常见的"
            "假死状态，进程都还活着。于是该重启的实例不会被重启，"
            "该摘掉的实例还会继续接流量。"
        ),
        "fix": (
            "至少把 Actuator 打开，只暴露 health 端点即可："
            "management.endpoints.web.exposure.include=health，"
            "并把 readiness / liveness 分成两个健康组。"
        ),
    },
    {
        "id": "ARCH-K8S-SCHEDULER-DUP",
        "level": "risk",
        "when": {"deploy": ["k8s", "helm"], "scheduler": ["spring"]},
        "nodes": ["deploy", "scheduler"],
        "title": "多副本等于同一个定时任务被执行 N 次",
        "text": (
            "编排形态天然是多副本：Deployment 的 replicas 是几个，就有几个进程在跑同一份代码。"
            "@Scheduled 挂在每个进程各自的线程上，彼此不通气 —— "
            "到点各跑一遍，数据被处理 N 次。这个过程不抛异常、不打日志报错，"
            "只在最终的数据里体现出来。"
        ),
        "fix": "任务本身做成幂等并加分布式锁（ShedLock），或改用 XXL-Job 这类调度中心统一触发。",
    },
    {
        "id": "ARCH-K8S-POOL-FANOUT",
        "level": "risk",
        "when": {"deploy": ["k8s", "helm"], "pool": ["hikari", "druid"]},
        "nodes": ["deploy", "pool"],
        "title": "副本数 × 连接池 = 打向数据库的连接数",
        "text": (
            "连接池大小是**每个实例**各自的池。副本从 2 扩到 6，数据库看到的连接数就是 4 倍，"
            "而 max_connections 通常是固定的。更糟的是 HPA 会按负载自动加副本 —— "
            "扩容这个动作本身可能先把数据库推到连接上限。"
        ),
        "fix": (
            "按「最大副本数 × maximum-pool-size < max_connections × 80%」反推池大小；"
            "给 HPA 设 maxReplicas 上限，不要让它无限扩。"
        ),
    },
    {
        "id": "ARCH-COMPOSE-PROD-DB",
        "level": "note",
        "when": {"deploy": ["docker"], "database": ["mysql", "postgres"]},
        "nodes": ["deploy", "database"],
        "title": "Compose 里的数据库容器不是生产库",
        "text": (
            "Compose 能一键拉起依赖，但它解决的是「本机也能跑起来」，"
            "不是「挂了怎么办」。容器里的数据库没有高可用、没有故障切换、"
            "备份要你自己导；docker compose down 之后 data 或许还在卷里，"
            "但你并没有演练过怎么把它恢复出来。"
        ),
        "fix": "生产库用独立实例或托管服务；Compose 只负责应用与本地开发依赖。",
    },
    {
        "id": "ARCH-HELM-ROLLBACK-SCHEMA",
        "level": "risk",
        "when": {"deploy": ["helm", "k8s"], "migration": ["flyway", "liquibase"]},
        "nodes": ["deploy", "migration"],
        "title": "回滚能退回旧镜像，退不回旧数据库",
        "text": (
            "helm rollback 或改镜像 tag 只替换容器，已经执行完的迁移脚本不会跟着退版本。"
            "一旦迁移里有 drop column、改类型、重命名字段这类破坏性变更，"
            "回滚后的旧代码面对的是新表结构 —— 回滚这一动作会直接把服务打到不可用，"
            "而它恰恰是在最紧张的时候被执行。"
        ),
        "fix": "把每次发布拆成两步：先发布向后兼容的迁移（只增不删），确认稳定后再删旧结构。",
    },
]

POLICY_DETAIL.update({
    "ARCH-K8S-NO-PROBE": {
        "trigger": "交付形态选了 Kubernetes 或 Helm，同时可观测性选了「不使用」（没有 Actuator 端点）",
        "symptoms": [
            "kubectl get pods 状态一直是 Running，但接口全部超时 —— 平台判定它健康",
            "发布过程中出现随机 502，流量被分到了还在启动的实例上",
            "死锁或连接池耗尽后实例永远不会被替换，只有人工重启才恢复",
        ],
        "impact": "平台基于「进程还在」这一条信息替你做重启与引流决策。假死不可发现、不可自愈，故障只能靠用户投诉暴露。",
    },
    "ARCH-K8S-SCHEDULER-DUP": {
        "trigger": "交付形态选了 Kubernetes 或 Helm（多副本），定时任务用的是 Spring @Scheduled",
        "symptoms": [
            "同一批数据在一分钟内被处理多次，次数等于副本数",
            "通知类任务重复发出：同一条短信 / 邮件 / 推送发到同一个接收方",
            "统计表的计数或金额随时间被放大，且每次放大倍数等于当时的副本数",
        ],
        "impact": "无声的重复执行。不报错、不告警，只在最终数据上体现，发现时通常已积累多日且难以追溯补数范围。",
    },
    "ARCH-K8S-POOL-FANOUT": {
        "trigger": "交付形态选了 Kubernetes 或 Helm（会横向扩容），连接池选了 HikariCP 或 Druid",
        "symptoms": [
            "副本数或 HPA 扩容后，日志里出现 Connection is not available, request timed out",
            "数据库侧连接数逼近 max_connections，且随副本数同步上升",
            "新扩容出的 Pod 启动失败，报 Too many connections —— 扩容反而导致不可用",
        ],
        "impact": "连接需求随副本线性增长而数据库上限固定。扩容不但没提升容量，反而把整个服务推向不可用；取消这种形态尤其糟：故障只在高负载、需要扩容时才出现。",
    },
    "ARCH-COMPOSE-PROD-DB": {
        "trigger": "交付形态选了 Docker Compose，数据库随之跑在容器里",
        "symptoms": [
            "docker compose down 之后数据看似还在卷里，但没有恢复演练过",
            "没有自动备份：数据库的可靠性等同于宿主机那块盘",
            "宿主机 reboot 之后多个容器争相启动，应用先于数据库就绪而连接失败",
        ],
        "impact": "把「能一键拉起来」误当成「有运维保障」。真正出事时只能 pray 最后一次快照可用。",
    },
    "ARCH-HELM-ROLLBACK-SCHEMA": {
        "trigger": "交付形态选了 Helm 或 Kubernetes，同时迁移工具选了 Flyway / Liquibase",
        "symptoms": [
            "回滚后立刻大面积报错 Unknown column / column type mismatch",
            "旧版本日志里出现大量 SQL 异常，而数据库看起来一切正常",
            "回滚失败后唯一的出路是「继续往前修复」，没有干净的退路",
        ],
        "impact": "声称拥有的一键回滚能力只对应用层成立。数据结构是单向的：一旦破坏性变更执行，回滚按钮实际上是坏的。",
    },
})

# ─────────────────────────────────────────────────────────────
# 技术架构图（交付用大图）的画图元信息
#
# 前面那些数据回答的是「能不能跑起来」，这一节回答的是**画出来是什么样**。
# 分开放是刻意的：能力供需模型不该被版式字段污染，反之亦然。
#
# 三条硬规矩：
#   ① 只画**真的会被部署的东西**。Maven、Lombok、JUnit、MapStruct 是构建期/编码期
#      的东西，把它们画成一个个部署节点，是架构图最常见也最误导人的画法 ——
#      所以它们写在应用卡里的「工程属性」上，不占一个节点位。
#   ② 集群形态由数据声明，不在渲染器里 if。选项自己说它有几种部署形态，
#      渲染器只负责把声明的数量画出来 —— 加一种形态不用碰渲染器。
#   ③ 连线上的协议与端口也是声明的。图上写 :3306 是因为数据里写了 :3306，
#      不是渲染器猜的。猜出来的端口号进技术说明书会出事。
# ─────────────────────────────────────────────────────────────

def CL(name, replicas, note=''):
    """一种集群形态。replicas = 图上画几个堆叠的卡。"""
    item = {'name': name, 'replicas': replicas}
    if note:
        item['note'] = note
    return item


# ── 分区：自上而下的部署分层 ──────────────────────────────
#   archifyType  这一层在 Archify 七类组件里的默认归属
#                （frontend / backend / database / cloud / security / messagebus / external）。
#                放这里而不是放渲染器里：它是「这一层是什么性质」的事实，
#                渲染器只负责把它抄进 IR。个别选项要改归属就在选项上覆盖。
CANVAS_ZONES = [
    {'id': 'client', 'name': '客户端', 'glyph': '◍', 'archifyType': 'external',
     'desc': '请求发起方。不属于本次选型，但架构图上不画它，读图的人就得自己脑补。'},
    {'id': 'app', 'name': '应用服务', 'glyph': '⬢', 'archifyType': 'backend',
     'desc': 'Spring Boot 进程。横切能力（鉴权 / 文档 / 映射）挂在这一层内部，不单独部署。'},
    {'id': 'mw', 'name': '中间件', 'glyph': '⇉', 'archifyType': 'cloud',
     'desc': '每引入一个就多一个需要单独运维的进程。留空是安全的选择。'},
    {'id': 'data', 'name': '数据存储', 'glyph': '▦', 'archifyType': 'database',
     'desc': '业务数据的落点。这一层的集群形态直接决定容量与可用性上限。'},
    {'id': 'ops', 'name': '观测与运维', 'glyph': '⛨', 'archifyType': 'cloud',
     'desc': '决定线上出问题时你知不知道、改完代码敢不敢发。'},
    # 交付形态单独一层，排在最后：**加在看图顺序的末尾，但必须真被画出来**。
    # 早先把它塞进 app 那一层当旁路件，结果在导出给通用绘图器时两处都坏：
    # 应用卡是整张图的主干锚点，它的宽度一变，跨层连线的走廊就跟着错位，
    # 对方报「2px 内部段」与「标签压住组件」—— 都是主机 idea 带来的连锁反应。
    # 单独成层之后，它跟 ops / data 一样落在右列，版式规则与已有分支完全相同。
    {'id': 'platform', 'name': '交付与运行', 'glyph': '⬢', 'archifyType': 'cloud',
     'desc': '谁打包、谁重启、谁负责扩容与回滚。这一层替你做的每一个决定，'
             '都依赖应用自己暴露的信息。'},
]

# ── 交付给通用绘图器（Archify）时的图注覆盖 ────────────────
#   Archify 的 `cloud` 类在界面上读作「云服务」。我们这一层装的却是 Nacos /
#   XXL-Job / Prometheus —— 自托管的支撑组件，不是云上的托管服务。
#   与其让图例说一句不准确的话，不如把图例文字改准：
#   类型枚举不动（那是渲染器的词汇表），只覆盖它显示出来的名字。
CANVAS_LEGEND_OVERRIDES = {
    'cloud': {'label': '支撑组件'},
}

# ── 每个维度在图上怎么出现 ────────────────────────────────
#   place  node    画成一个独立部署节点
#          appTag 收进应用卡的「工程属性」（构建期 / 编码期的东西）
#          side   画成挂在主线上的旁路件（发布期才起作用）
CANVAS_DIMS = {
    'jdk':        {'place': 'appTag', 'tagLabel': '运行时'},
    'build':      {'place': 'appTag', 'tagLabel': '构建'},
    'web':        {'place': 'appTag', 'tagLabel': 'Web 容器'},
    'persistence': {'place': 'appTag', 'tagLabel': '持久层'},
    'pool':       {'place': 'appTag', 'tagLabel': '连接池'},
    'mapping':    {'place': 'appTag', 'tagLabel': '对象映射'},
    'boilerplate': {'place': 'appTag', 'tagLabel': '样板代码'},
    'test':       {'place': 'appTag', 'tagLabel': '测试'},
    'auth':       {'place': 'appTag', 'tagLabel': '鉴权'},
    'apidoc':     {'place': 'appTag', 'tagLabel': '接口文档'},
    'migration':  {'place': 'side', 'zone': 'data', 'tagLabel': 'Schema 迁移'},
    'cache':      {'place': 'node', 'zone': 'data'},
    'database':   {'place': 'node', 'zone': 'data'},
    'mq':         {'place': 'node', 'zone': 'mw'},
    'registry':   {'place': 'node', 'zone': 'mw'},
    'scheduler':  {'place': 'node', 'zone': 'mw'},
    'observability': {'place': 'node', 'zone': 'ops'},
    # 交付形态单独占一层：它确实是一个**会被部署的东西**（systemd unit / 镜像流水线 /
    # Deployment），不是应用卡里的一行工程属性。放在 app 层当旁路件会让它看起来
    # 像是跟着应用一起走的某种编译期选择，而实际上它决定的是这个进程怎么被替换。
    'deploy': {'place': 'node', 'zone': 'platform'},
}

# ── 每个选项的图标与部署形态 ──────────────────────────────
#   icon     图标库里的 key（见 arsenal-web/src/lib/tech-icons.ts）
#   port     默认端口。写进连线标签，供技术说明书直接引用
#   cluster  这个组件能怎么部署。第一项是默认形态
#
#   ── 以下三项是给通用绘图器（Archify）导出用的 ──
#   brand        Archify 内置矢量商标的 id。**必须**是 `wrench-ai brands --json`
#                里真实存在的规范 id，编一个会在渲染期直接失败（fail closed）。
#                没有官方商标的组件（Nacos / RocketMQ / XXL-Job / Tomcat…）就不写，
#                图上退回按组件类型上色 —— 比硬塞一个不相干的标好。
#   archifyType  覆盖分区给的默认归属。只在「这一层多数是这个类型、但这个选项不是」
#                时才写，比如消息队列落在中间件层（那一层默认给 cloud）。
#   label        交付图上的短名。选项全名太长时用（"Actuator + Prometheus + Grafana"
#                塞进一个方块会挤成一团）。不写就用选项名。
CANVAS_OPTIONS = {
    'jdk': {
        '17': {'icon': 'jdk'},
        '21': {'icon': 'jdk'},
    },
    'build': {
        'maven': {'icon': 'maven'},
        'gradle': {'icon': 'gradle'},
    },
    'web': {
        # 应用卡的名字与图标取自这一维；brand 让应用方块带上 Spring 标 ——
        # 应用方块本身没有维度，它的品牌只能挂在这里
        'mvc': {'icon': 'tomcat', 'port': '8080', 'brand': 'spring'},
        'webflux': {'icon': 'netty', 'port': '8080', 'brand': 'spring'},
    },
    'persistence': {
        'jdbc': {'icon': 'jdbc'},
        'mybatisplus': {'icon': 'mybatis'},
        'jpa': {'icon': 'jpa'},
    },
    'pool': {
        'hikari': {'icon': 'hikari'},
        'druid': {'icon': 'druid'},
    },
    'mapping': {
        'manual': {'icon': 'generic'},
        'mapstruct': {'icon': 'mapstruct'},
    },
    'boilerplate': {
        'lombok': {'icon': 'lombok'},
        'plain': {'icon': 'generic'},
    },
    'test': {
        'mockito': {'icon': 'junit'},
        'testcontainers': {'icon': 'testcontainers'},
    },
    'auth': {
        'securityjwt': {'icon': 'security'},
        'satoken': {'icon': 'satoken'},
        'custom': {'icon': 'jwt'},
    },
    'apidoc': {
        'springdoc': {'icon': 'springdoc'},
        'knife4j': {'icon': 'knife4j'},
        'none': {'icon': 'none'},
    },
    'migration': {
        # 迁移工具位置在数据层旁边（它是对库动手的），但类型不是 database ——
        # 说 Flyway 是「数据库」会让图例读起来像是多出来一个库
        'flyway': {'icon': 'flyway', 'archifyType': 'cloud'},
        'liquibase': {'icon': 'liquibase', 'archifyType': 'cloud'},
        'none': {'icon': 'none'},
    },
    'database': {
        'mysql': {
            'icon': 'mysql', 'port': '3306', 'brand': 'mysql',
            'cluster': [
                CL('单实例', 1, '一个库扛全部读写。挂了就没了，只适合原型与内部小系统。'),
                CL('主从复制', 2, '写走主库、读走从库。容量与可用性都由从库数量决定。'),
                CL('MGR 集群', 3, '组复制，单节点故障可自动切换。代价是写入延迟上升。'),
            ],
        },
        'postgres': {
            'icon': 'postgres', 'port': '5432', 'brand': 'postgresql',
            'cluster': [
                CL('单实例', 1, '一个实例。备份只能靠快照与 WAL 归档。'),
                CL('主从流复制', 2, '主库写、备库读。故障切换需要 Patroni 之类组件配合。'),
                CL('一主多备', 3, '多备库分担读，主库故障需外部选主。'),
            ],
        },
    },
    'cache': {
        # 本地缓存跑在应用进程里，不占部署节点位
        'none': {'icon': 'none'},
        'caffeine': {'icon': 'caffeine', 'place': 'appTag'},
        'redis': {
            'icon': 'redis', 'port': '6379', 'brand': 'redis',
            'cluster': [
                CL('单实例', 1, '一个实例。缓存挂了只是穿透，不会丢业务数据。'),
                CL('主从 + 哨兵', 3, '哨兵负责选主。三节点是哨兵能自洽的最小奇数。'),
                CL('Cluster 分片', 6, '数据分片到多组。槽位迁移期间部分 key 会短暂不可用。'),
            ],
        },
    },
    'mq': {
        'none': {'icon': 'none'},
        'rocketmq': {
            # RocketMQ 不在 Archify 的商标库里，留空按类型上色
            'icon': 'rocketmq', 'port': '9876', 'archifyType': 'messagebus',
            'cluster': [
                CL('单 Broker', 1, '一个 Broker。堆积能力受单盘限制。'),
                CL('主从 Broker', 2, '主写从读，主挂了从只提供读。'),
                CL('多 Broker 集群', 3, 'Topic 分散到多组 Broker，吞吐随组数增长。'),
            ],
        },
        'rabbitmq': {
            'icon': 'rabbitmq', 'port': '5672', 'archifyType': 'messagebus',
            'brand': 'rabbitmq',
            'cluster': [
                CL('单节点', 1, '一个节点。队列在该节点上，节点挂了队列就没了。'),
                CL('普通集群', 2, '队列元数据同步，消息仍在原节点。'),
                CL('镜像队列', 3, '消息复制到多节点。吞吐下降，但节点故障不丢消息。'),
            ],
        },
        'kafka': {
            'icon': 'kafka', 'port': '9092', 'archifyType': 'messagebus',
            'brand': 'apache-kafka',
            'cluster': [
                CL('单 Broker', 1, '一个 Broker。分区副本无处可放。'),
                CL('三节点集群', 3, '最小可用集群，副本数 3 时允许坏 1 台。'),
                CL('五节点集群', 5, '副本数 3 时允许坏 2 台，同时扛住一次滚动升级。'),
            ],
        },
    },
    'registry': {
        'none': {'icon': 'none'},
        'nacos': {
            'icon': 'nacos', 'port': '8848',
            'cluster': [
                CL('单机模式', 1, '内置 Derby。只适合本地开发，重启丢配置。'),
                CL('三节点集群', 3, 'Raft 选主的最小奇数。生产最低要求。'),
                CL('五节点集群', 5, '允许同时坏 2 台，滚动升级不掉注册表。'),
            ],
        },
    },
    'scheduler': {
        # @Scheduled 是应用进程内的一个线程，画成独立节点等于谎报了一个部署单元
        'spring': {'icon': 'scheduler', 'place': 'appTag'},
        'xxljob': {
            'icon': 'xxljob', 'port': '8080',
            'cluster': [
                CL('单调度中心', 1, '调度中心单点。中心挂了任务不触发，执行器照常跑。'),
                CL('双调度中心', 2, '调度中心主备，靠数据库锁选主。'),
                CL('调度 + 执行器集群', 3, '执行器多实例，任务由调度中心分派。'),
            ],
        },
    },
    # ── 交付形态 ──────────────────────────────────────────
    # 副本数就是 Deployment 的 replicas（或守护形态下的进程数）——
    # 图上写 ×N 是因为这里声明了 N，不是渲染器猜的。
    'deploy': {
        'jar': {
            'icon': 'jar',
            'label': 'Fat JAR + 进程守护',
            'cluster': [
                CL('单进程', 1, '一个 JVM 进程。挂了不会自愈，靠守护进程或人发现。'),
                CL('双机主备', 2, '两台机各一个进程，由负载均衡器判断谁还活着。'),
                CL('多机多进程', 3, '进程横向分布。扩一台机就是一次全手工部署。'),
            ],
        },
        'docker': {
            'icon': 'docker',
            'label': 'Docker + Compose',
            'cluster': [
                CL('单容器', 1, '一个容器。Compose 会把 compose file 里声明的东西一并拉起。'),
                CL('双容器', 2, '应用双副本 + 前置负载。重启策略由 Compose 的 restart 声明。'),
                CL('多容器编排', 3, '应用多副本连同依赖中间件。上限仍是单机容量。'),
            ],
        },
        'k8s': {
            'icon': 'k8s',
            'label': 'Kubernetes',
            'brand': 'kubernetes',
            'cluster': [
                CL('单副本', 1, 'replicas=1。没有滚动更新的余地，发布等于停机。'),
                CL('三副本滚动', 3, '最小生产形态：更新期间始终有实例在服务。'),
                CL('六副本 + HPA', 6, '按负载自动扩缩。连接数与下游压力会被同步放大。'),
            ],
        },
        'helm': {
            'icon': 'helm',
            'label': 'Helm Chart',
            'cluster': [
                CL('单环境', 1, '一份 values。用来验证模板本身写得对不对。'),
                CL('双环境', 2, 'dev + prod 两份 values，同一份模板渲染出两套清单。'),
                CL('三环境', 3, 'dev / staging / prod。环境之间的差值全部落在 values 里。'),
            ],
        },
    },
    'observability': {
        # 只有 Prometheus 是要单独起进程的；Actuator 只是应用暴露的一个端点
        'none': {'icon': 'logback', 'place': 'appTag'},
        'actuator': {'icon': 'actuator', 'place': 'appTag'},
        'prometheus': {
            'icon': 'prometheus', 'port': '9090', 'brand': 'prometheus',
            # 选项全名是「Actuator + Prometheus + Grafana」，塞进一个方块会挤成一团；
            # 图上只写真正起了进程的两个 —— Actuator 是应用自己暴露的端点
            'label': 'Prometheus + Grafana',
            'cluster': [
                CL('单 Prometheus', 1, '一个实例。它自己挂了，监控就一起瞎。'),
                CL('双 Prometheus', 2, '两个实例抓同一批目标，告警去重靠外层。'),
                CL('联邦集群', 3, '边缘 Prometheus 汇总到中心，适合多机房。'),
            ],
        },
    },
}

# ── 连线：谁连谁、走什么协议 ──────────────────────────────
#   from / to  维度 id。任一端没选（或选项留空）就不画这条线
#   label      连线上的协议 / 动作
#   kind       solid=请求必经   dashed=只在某些阶段起作用
CANVAS_LINKS = [
    {'from': 'client', 'to': 'app', 'label': 'HTTPS', 'kind': 'solid'},
    {'from': 'app', 'to': 'database', 'label': 'JDBC', 'kind': 'solid'},
    {'from': 'app', 'to': 'cache', 'label': 'RESP', 'kind': 'solid'},
    {'from': 'app', 'to': 'mq', 'label': '消息生产 / 消费', 'kind': 'solid'},
    {'from': 'app', 'to': 'registry', 'label': '注册 + 配置拉取', 'kind': 'solid'},
    {'from': 'app', 'to': 'scheduler', 'label': '任务回调', 'kind': 'dashed'},
    {'from': 'migration', 'to': 'database', 'label': 'Schema 迁移', 'kind': 'dashed'},
    {'from': 'observability', 'to': 'app', 'label': '指标拉取', 'kind': 'dashed'},
    # 交付形态是一条**回边**：方向从平台指向应用 —— 是平台在调度这个进程，
    # 而不是应用去调用平台。画成 app → deploy 会把管理关系讲成调用关系，
    # 那是图上最常见的一种读错。
    #
    # 标签只有两个字是被约束出来的：跨层连线的标签宽度会直接加宽连线走廊，
    # 而走廊变宽会让整张图越过「桌面可读性」的门槛（1440 宽视口下每511最小的字要看不清）。
    # 换句话说，这里多写四个字，导出给通用绘图器的图就过不了最严档校验。
    {'from': 'deploy', 'to': 'app', 'label': '编排', 'kind': 'dashed'},
]

# ── 交付给通用绘图器（Archify）时的阅读路径 ────────────────
#   每条路径回答「这一条链路要经过哪几块」。焦点由**分区 + 维度**声明，
#   不写死节点 id：没选到的槽位图上根本没有方块，写死了会被对方判成
#   「引用了不存在的组件」——那是硬失败，不是警告。
#
#   两条规矩（第二条是本项目已经踩过一次的坑）：
#     ① 与图上求交后不足两块的路径整条丢掉 —— 只亮一块的路径点开跟没点一样；
#     ② **任意两条路径的焦点不许完全相同**。导览四章焦点全是「全部槽位」时，
#        点哪一章图都一模一样，导览等于没生效。
CANVAS_VIEWS = [
    {'id': 'v_ingress', 'label': '请求进入',
     'zones': ['client', 'app', 'mw'], 'dims': [],
     'note': '外部请求落到应用进程，中间件是它连出去的第一跳。'},
    {'id': 'v_state', 'label': '状态落点',
     'zones': ['app', 'data'], 'dims': [],
     'note': '业务数据最终写在哪、读在哪 —— 这一步决定容量与可用性的上限。'},
    {'id': 'v_async', 'label': '异步与调度',
     'zones': ['app'], 'dims': ['mq', 'scheduler'],
     'note': '不在请求线程里做的那些事：削峰、解耦、定时。'},
    {'id': 'v_ops', 'label': '观测与运维',
     'zones': ['app', 'ops'], 'dims': ['registry'],
     'note': '决定线上出问题时你知不知道、改完代码敢不敢发。'},
    {'id': 'v_delivery', 'label': '交付与运行',
     'zones': ['app'], 'dims': ['deploy'],
     'note': '这套东西最后由谁打包、谁重启、谁负责扩容与回滚。'},
]
