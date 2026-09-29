# -*- coding: utf-8 -*-
"""项目结构层：把选型结果还原成磁盘上真实的目录，并补齐「项目怎么起」的文件。

前面几层各回答一个问题：
    stack_*.py      这个零件是什么（依赖、yaml、配置类、坑）
    stack_arch.py   拼起来能不能跑（能力供需）
这个文件回答第三个：**这套组合落到磁盘上，长什么样。**

为什么结构必须跟着选型变：
    选 MyBatis-Plus 才会有 resources/mapper/，选 Flyway 才会有 resources/db/migration/，
    选 Gradle 就没有 pom.xml。写成一份固定模板是错的 ——
    用户会照着建出一堆永远为空的目录，然后开始怀疑这份图。

条件语法（与 stack_arch.py 的 POLICIES 一致，便于统一校验）：
    when    维度 → 命中任一选项即可；多个维度之间是「与」
    unless  同上，但取反（用于「只要不是 X 就有」这类节点）
    不写条件 = 所有组合都有这个节点。
"""

# ─────────────────────────────────────────────────────────────
# 项目坐标
# ─────────────────────────────────────────────────────────────

GROUP_ID = 'com.example'
ARTIFACT_ID = 'arsenal-demo'
BASE_PACKAGE = 'com.example'

# ─────────────────────────────────────────────────────────────
# 目录树
#
#   name     显示名。目录以 / 结尾，与文件靠这个区分（不额外加 kind 字段，
#            避免出现 kind 与 name 不一致的脏数据）
#   desc     这个目录/文件承担什么职责 —— 写目录不写文件列表
#   badge    来源徽章：这一块是谁带来的。空 = 所有组合都有
#   when     出现条件（不满足则整棵子树隐藏）
#   lines    这个文件大致的行数量级，用于估算规模（可选）
# ─────────────────────────────────────────────────────────────


def D(name, desc='', badge=None, when=None, children=None):
    node = {'name': name, 'desc': desc, 'kind': 'dir'}
    if badge:
        node['badge'] = badge
    if when:
        node['when'] = when
    node['children'] = children or []
    return node


def F(name, desc, badge=None, when=None):
    node = {'name': name, 'desc': desc, 'kind': 'file'}
    if badge:
        node['badge'] = badge
    if when:
        node['when'] = when
    return node


TREE = D('arsenal-demo/', '项目根目录，名字与 artifactId 一致', children=[

    # ── 根级文件 ────────────────────────────────────────────
    F('pom.xml', 'Maven 坐标与依赖。版本全部交给 parent BOM，业务依赖一个都不手写',
      badge='Maven', when={'build': ['maven']}),
    F('build.gradle', 'Gradle 构建脚本。用 toolchain 指定 JDK，不依赖本机 JAVA_HOME',
      badge='Gradle', when={'build': ['gradle']}),
    F('settings.gradle', '工程名与子模块声明', badge='Gradle', when={'build': ['gradle']}),
    F('README.md', '这份 README 由装配台生成：选型表 + 启动步骤 + 隐患清单'),
    F('.gitignore', '排除 target/、logs/、.env —— 这是防密钥泄漏的最后一道机械防线'),

    D('docs/', '项目自己的文档位。导出包会把隐患体检单放在这里', children=[
        F('risk-report.md', '当前选型的隐患体检单。改选型后重新导出一份，保持同步',
          badge='导出附带'),
    ]),

    # ── 交付与运行 ──────────────────────────────────────────
    # 这里的文件与导出包里的文件**逐一对齐**：结构树画出来的，导出包就必须有，
    # 反过来也一样。两边一旦分叉，用户照着图建目录却拿不到文件 ——
    # 那张结构图的可信度就没了。所以文件名保持一模一样。
    D('deploy/', '部署与运行清单。把「谁打包、谁重启、谁扩容、怎么回滚」落成文件，'
                 '而不是留在某个人的脑子里',
      when={'deploy': ['jar', 'docker', 'k8s', 'helm']}, children=[
        F('Dockerfile', '多阶段构建：JDK 阶段出 jar，JRE 阶段只装运行时。'
                        '依赖按变更频率拆层，改一行业务代码不会重下一轮依赖',
          badge='导出附带', when={'deploy': ['docker', 'k8s', 'helm']}),
        F('.dockerignore', '排除 target/、.git/、logs/。少了它，构建上下文会把整份历史推给守护进程',
          badge='导出附带', when={'deploy': ['docker', 'k8s', 'helm']}),
        F('docker-compose.yml', '应用 + 它依赖的中间件。用于本地与联调，不是生产调度器 —— '
                                '生产库的可用性不在它的职责范围内',
          badge='导出附带', when={'deploy': ['docker']}),
        F('Makefile', '把 build / push / deploy / rollback 四条命令固化成同一种调用方式，'
                      '发布步骤从此不含口头约定',
          badge='导出附带', when={'deploy': ['docker', 'k8s', 'helm']}),

        D('systemd/', '进程守护形态下的服务定义', when={'deploy': ['jar']}, children=[
            F('app.service', 'systemd unit。KillSignal 必须是 SIGTERM，'
                             'TimeoutStopSec 必须大于优雅停机超时 —— 两个参数写错就是在每次发布里随机丢请求',
              badge='导出附带', when={'deploy': ['jar']}),
        ]),

        F('prometheus.yml', '抓取配置。compose 里挂载了它 —— 少了这个文件，'
                            'Docker 会挂一个同名目录进去，Prometheus 起不来',
          badge='导出附带', when={'deploy': ['docker'], 'observability': ['prometheus']}),

        D('k8s/', 'Kubernetes 原生清单。按顺序 apply 即可起来一套完整的服务',
          when={'deploy': ['k8s']}, children=[
            F('00-namespace.yaml', '命名空间。隔离资源配额与权限边界的最小单位',
              badge='导出附带', when={'deploy': ['k8s']}),
            F('01-configmap.yaml', '非敏感配置。镜像与环境解耦的落点：换环境只换它，不重新构建',
              badge='导出附带', when={'deploy': ['k8s']}),
            F('02-secret.yaml', '敏感配置的占位。**值是空的** —— 真正的凭据只在部署时注入，'
                                '不进 Git',
              badge='导出附带', when={'deploy': ['k8s']}),
            F('03-serviceaccount.yaml', '运行身份。不用 default SA，权限才能收紧到这个应用',
              badge='导出附带', when={'deploy': ['k8s']}),
            F('04-deployment.yaml', '副本数、资源、三个探针、优雅停机。 probes 缺一个就有一类故障没人管',
              badge='导出附带', when={'deploy': ['k8s']}),
            F('05-service.yaml', 'ClusterIP 服务。给 Pod 一个稳定的 DNS 名与负载均衡',
              badge='导出附带', when={'deploy': ['k8s']}),
            F('06-ingress.yaml', '外部流量入口。TLS 与域名在这里，也可能由网关层统一收走',
              badge='导出附带', when={'deploy': ['k8s']}),
            F('07-hpa.yaml', '按 CPU / 内存扩缩。maxReplicas 是上限，'
                             '不设上限的扩容会把数据库先推到连接数上限',
              badge='导出附带', when={'deploy': ['k8s']}),
            F('08-pdb.yaml', '中断预算。没有它，一次节点排水就能把所有副本同时赶走',
              badge='导出附带', when={'deploy': ['k8s']}),
            F('kustomization.yaml', '资源清单汇总，也是多环境 overlay 的入口',
              badge='导出附带', when={'deploy': ['k8s']}),
        ]),

        D('chart/', 'Helm Chart：一份模板 + 多份 values', when={'deploy': ['helm']}, children=[
            F('Chart.yaml', '元数据。version 是 chart 的版本，appVersion 是应用的版本 —— 混在一起就答不出「这次变了什么」',
              badge='导出附带', when={'deploy': ['helm']}),
            F('values.yaml', '所有环境共享的默认值', badge='导出附带', when={'deploy': ['helm']}),
            F('values-dev.yaml', '开发环境的差值。每份 values 只写差异，不复制整份',
              badge='导出附带', when={'deploy': ['helm']}),
            F('values-prod.yaml', '生产环境的差值：副本数、资源、PDB、Ingress',
              badge='导出附带', when={'deploy': ['helm']}),
            D('templates/', '模板。所有 Go template 表达式集中在这里，values 只提供数据',
              when={'deploy': ['helm']}, children=[
                F('_helpers.tpl', '命名与标签的统一定义。散着写会出现「标签不一致导致 Service 选不到 Pod」',
                  badge='导出附带', when={'deploy': ['helm']}),
                F('deployment.yaml', 'Deployment 模板：镜像、资源、探针、优雅停机全部参数化',
                  badge='导出附带', when={'deploy': ['helm']}),
                F('service.yaml', 'Service 模板', badge='导出附带', when={'deploy': ['helm']}),
                F('ingress.yaml', 'Ingress 模板，按 values 决定是否创建',
                  badge='导出附带', when={'deploy': ['helm']}),
                F('configmap.yaml', '非敏感配置模板', badge='导出附带', when={'deploy': ['helm']}),
                F('secret.yaml', '凭据的**键位说明书**：值一律为空，部署时注入。'
                                 '写进 values 就等于把凭据交给了每个能执行 helm get values 的人',
                  badge='导出附带', when={'deploy': ['helm']}),
                F('serviceaccount.yaml', '运行身份模板。不用 default SA，权限才能收紧到这个应用',
                  badge='导出附带', when={'deploy': ['helm']}),
                F('hpa.yaml', 'HPA 模板，默认关闭', badge='导出附带', when={'deploy': ['helm']}),
                F('pdb.yaml', '中断预算模板。没有它，一次节点排水就能把所有副本同时赶走',
                  badge='导出附带', when={'deploy': ['helm']}),
            ]),
        ]),
    ]),

    D('src/', '', children=[
        D('main/', '生产代码与运行时资源。这里的每个文件都会进最终产物', children=[
            D('java/com/example/', '根包。只放启动类，其他类一律进子包', children=[
                F('Application.java', '启动类。必须在根包 —— @SpringBootApplication 隐式带 @ComponentScan，'
                                     '放错位置会让部分 Bean 扫不到，报出的错误与真实原因毫无关系',
                  badge='所有项目'),

                D('common/', '与业务无关的全局共享物。这一层只往下被依赖，不反向引用任何业务包', children=[
                    F('ApiResponse.java', '统一响应体。所有接口只返回这一种外壳，前端只解析一种结构'),
                    F('PageResult.java', '统一分页结构：页码、页大小、总数、列表，字段名固定不再各写一套'),
                    F('ErrorCode.java', '错误码常量表。码值集中定义，禁止散落在各处的魔法数字'),
                    D('exception/', '领域内可预期的失败类型', children=[
                        F('BizException.java', '业务异常基类，携带错误码 —— 可预期的失败用它，不抛 RuntimeException'),
                    ]),
                    D('web/', '与 HTTP 协议相关的公共物', children=[
                        F('GlobalExceptionHandler.java', '全局异常出口。所有异常在这里转成统一响应体，'
                                                         '兜底分支必须记录堆栈'),
                    ]),
                ]),

                D('config/', '所有 @Configuration 集中在此。项目里只有这一个地方允许出现 @Bean', children=[
                    F('WebMvcConfig.java', '跨域与拦截器链。TraceId 拦截器必须排在鉴权之前',
                      badge='所有项目'),
                    F('JacksonConfig.java', 'JSON 序列化策略。Long 转字符串防前端精度丢失 —— '
                                            '这是最容易上线后才发现的坑', badge='所有项目'),
                    F('AsyncConfig.java', '异步线程池。所有 @Async 都走它，禁止 new Thread',
                      badge='所有项目'),
                    F('RetryConfig.java', '重试策略。退避与次数上限在此统一，不允许在业务代码里写重试循环',
                      badge='所有项目'),
                    F('SecurityConfig.java', '鉴权规则链：放行名单、过滤器顺序、方法级鉴权开关',
                      badge='Spring Security', when={'auth': ['securityjwt']}),
                    F('SaTokenConfig.java', 'Sa-Token 拦截器注册与放行名单',
                      badge='Sa-Token', when={'auth': ['satoken']}),
                    F('MybatisPlusConfig.java', '注册分页插件与乐观锁插件。漏注册时 Page 查询不报错，'
                                                '只是分页参数被静默忽略，返回整张表',
                      badge='MyBatis-Plus', when={'persistence': ['mybatisplus']}),
                    F('JpaAuditConfig.java', '开启 JPA 审计，让 @CreatedDate / @LastModifiedDate 自动填充，'
                                             '不要在每个 save 前手写 setCreateTime',
                      badge='JPA', when={'persistence': ['jpa']}),
                    F('DruidMonitorConfig.java', 'Druid 监控页与慢 SQL 统计',
                      badge='Druid', when={'pool': ['druid']}),
                    F('CacheConfig.java', '本地缓存管理器。必须有容量上限与过期时间：'
                                          '没有上限的缓存等于内存泄漏',
                      badge='Caffeine', when={'cache': ['caffeine']}),
                    F('RedisConfig.java', 'Redis 序列化配置。默认 JDK 序列化不可读、跨语言不可用',
                      badge='Redis', when={'cache': ['redis']}),
                    F('NacosRefreshConfig.java', '配置变更监听与运行时刷新',
                      badge='Nacos', when={'registry': ['nacos']}),
                    F('SchedulerConfig.java', '定时任务线程池与 ShedLock 分布式锁。默认单线程，'
                                              '一个任务跑久会让其余任务全部顺延',
                      badge='@Scheduled', when={'scheduler': ['spring']}),
                    F('XxlJobConfig.java', '调度中心执行器注册',
                      badge='XXL-Job', when={'scheduler': ['xxljob']}),
                    F('OpenApiConfig.java', '接口文档元信息与鉴权 scheme。生产 profile 必须关闭文档页',
                      badge='SpringDoc', when={'apidoc': ['springdoc', 'knife4j']}),
                    F('MetricsConfig.java', '业务指标埋点与 Prometheus 暴露',
                      badge='Prometheus', when={'observability': ['prometheus']}),
                ]),

                D('interceptor/', '拦截器。顺序敏感：TraceId 必须在最前，鉴权在其后', children=[
                    F('TraceIdInterceptor.java', '给每个请求打链路 id 并写进 MDC，否则异步与跨服务日志串不起来'),
                    F('AuthInterceptor.java', '登录态校验与放行名单。用拦截器就要在 WebMvcConfig 注册，'
                                              '漏注册的表现是接口直接裸奔',
                      badge='鉴权', when={'auth': ['securityjwt', 'satoken']}),
                ]),

                D('filter/', '过滤器。只在需要包装请求体（如 XSS、请求日志）时才有', children=[
                    F('RequestLogFilter.java', '请求日志与耗时统计。注意：包装请求体会让文件上传多占一份内存'),
                ]),

                D('integration/', '外部系统的统一边界。所有跨系统调用只从这一层出去，便于统一超时与重试',
                  badge='外部依赖', when={'mq': ['rocketmq', 'rabbitmq', 'kafka']}, children=[
                    F('MessagePublisher.java', '消息生产者。发送与业务写入的事务边界在这里定义清楚'),
                ]),

                D('user/', '业务领域示例：按领域分包，不是按层分包。'
                           '真实项目的每个领域都是同样的六件套', children=[
                    F('controller/UserController.java', 'HTTP 入口。只做参数校验与调用，不写业务逻辑，不直接碰数据库'),
                    F('dto/CreateUserRequest.java', '入参 DTO。必须带校验注解，且与实体分开'),
                    F('dto/UserResponse.java', '出参 DTO。实体不直接出接口 —— 否则加一个字段就泄露一次'),
                    F('dto/UserQuery.java', '查询条件对象。参数超过三个就必须用对象承载'),
                    F('service/UserService.java', '业务层。事务边界在这一层，@Transactional 只写在 public 方法上',
                      when={'persistence': ['jdbc', 'mybatisplus', 'jpa']}),
                    F('repository/UserRepository.java', '数据访问。SQL 与 ORM 调用只出现在这里',
                      when={'persistence': ['mybatisplus', 'jpa']}),
                    F('repository/UserDao.java', '数据访问。用 JdbcTemplate 手写 SQL，SQL 与映射都在这里',
                      when={'persistence': ['jdbc']}),
                    F('domain/User.java', '实体与枚举。表结构在代码里的投影，字段与列一一对应',
                      when={'persistence': ['jdbc', 'mybatisplus', 'jpa']}),
                    F('exception/UserNotFoundException.java', '领域内业务异常。继承 BizException，'
                                                              '错误码由本领域负责'),
                ]),

                D('job/', '定时任务。任务只做「触发」，真正的逻辑仍放在 service 里以便复用与测试',
                  badge='定时任务', when={'scheduler': ['spring', 'xxljob']}, children=[
                    F('UserSyncJob.java', '任务类。方法要短、要幂等、要可重入 —— 超时与重复触发是常态',
                      badge='定时任务', when={'scheduler': ['spring', 'xxljob']}),
                ]),

                D('security/', '鉴权相关的实现物：令牌签发、解析、当前用户上下文',
                  badge='鉴权', when={'auth': ['securityjwt']}, children=[
                    F('JwtAuthenticationFilter.java', 'JWT 解析过滤器。算法必须做白名单校验，'
                                                      '否则 alg=none 可直接绕过签名',
                      badge='Spring Security', when={'auth': ['securityjwt']}),
                    F('CurrentUserHolder.java', '当前登录用户上下文。基于 ThreadLocal —— '
                                                '用完必须在 finally 里清理，否则会跨请求越权',
                      badge='所有项目'),
                ]),
            ]),

            D('resources/', '配置文件与运行时资源。打包后它们位于 classpath 根下，会有覆盖规则', children=[
                F('application.yml', '跨环境一致的配置。密钥一律走环境变量，不写进这个文件'),
                F('application-dev.yml', '开发环境差异配置'),
                F('application-prod.yml', '生产环境差异配置。这个文件里不应出现任何明文密钥'),
                F('logback-spring.xml', '日志滚动与分级。按 profile 切换输出目标',
                  badge='可选'),
                D('mapper/', 'MyBatis XML 映射文件。用注解写 SQL 时这个目录不存在',
                  badge='MyBatis-Plus', when={'persistence': ['mybatisplus']}, children=[
                    F('UserMapper.xml', '复杂 SQL 的落点。简单增删改查用注解就够，不必都往这里搬',
                      badge='MyBatis-Plus', when={'persistence': ['mybatisplus']}),
                ]),
                D('db/', '库结构定义。这一层决定了「新环境能不能一键起起来」', children=[
                    D('migration/', 'Flyway 版本化迁移。命名 V{版本}__{说明}.sql，执行顺序由版本号决定',
                      badge='Flyway', when={'migration': ['flyway']}, children=[
                        F('V1__init.sql', '初始建表脚本。字段、索引、注释一次写全',
                          badge='Flyway', when={'migration': ['flyway']}),
                    ]),
                    D('changelog/', 'Liquibase changelog。master 文件只做 include，不写具体变更',
                      badge='Liquibase', when={'migration': ['liquibase']}, children=[
                        F('db.changelog-master.xml', '变更总入口。按顺序 include 每个 changeset 文件',
                          badge='Liquibase', when={'migration': ['liquibase']}),
                    ]),
                    F('schema.sql', '不引入迁移工具时的建表脚本。至少要有它，并纳入版本控制',
                      badge='无迁移工具', when={'migration': ['none']}),
                ]),
            ]),
        ]),

        D('test/java/com/example/', '测试代码与主代码同包名，但不共享任何工具类 —— '
                                    '测试里能做的事，生产代码里不该能做', children=[
            F('ApplicationTests.java', '上下文冒烟测试。它只证明一件事：Spring 容器能起来。'
                                       '这一条比很多业务测试更早地拦住配置错误',
              badge='测试', when={'test': ['mockito', 'testcontainers']}),
            F('user/service/UserServiceTest.java', 'Service 单元测试。Mock 掉外部依赖，只测业务分支',
              badge='测试', when={'test': ['mockito', 'testcontainers']}),
            F('user/controller/UserControllerTest.java', '接口切片测试。只加载 Web 层，验证参数校验与响应码',
              badge='测试', when={'test': ['mockito'], 'web': ['mvc']}),
            F('support/TestcontainersConfig.java', '用真实数据库跑集成测试。代价是必须有 Docker，'
                                                   'CI 上没有 Docker 就会红',
              badge='Testcontainers', when={'test': ['testcontainers']}),
        ]),
    ]),
])

# ─────────────────────────────────────────────────────────────
# 启动类
#
# 设计立场：**启动类尽量空**。
#
# 每个 @EnableXxx 都放在它自己的配置类里（@EnableScheduling 在 SchedulerConfig、
# @EnableCaching 在 CacheConfig、@EnableJpaAuditing 在 JpaAuditConfig），
# 启动类只留两样东西：
#   1. @SpringBootApplication —— 包扫描的锚点，放错位置一切免谈
#   2. 必须在此生效的扫描注解，如 MyBatis 的 @MapperScan
#
# 为什么坚持这样：启动类一旦开始堆开关，就会变成一个谁都想往里加一行的地方，
# 半年后没人说得清哪些注解是干什么的。而分散到配置类之后，
# 每个开关都在它影响的那块代码旁边，删掉配置类就等于关掉开关。
#
# SWITCH_OWNERS 就是把这份「开关归属表」算出来，写进启动类的注释里 ——
# 用户看一眼就知道：为什么我的启动类这么干净。
# ─────────────────────────────────────────────────────────────

# MapperScan 已移除（2026-09-29 E2E 实测）：宽模式 `com.example.**.repository`
# 会把普通仓储接口（auth/模块体系的 repository/*）误注册成 MyBatis Mapper Bean，
# 启动即因 Bean 二义性失败。所有 Mapper 接口都带 @Mapper，交给 MyBatis-Plus
# 的自动扫描即可 —— 代价只是每个 Mapper 记得写 @Mapper（模板已写）。
APP_ANNOTATIONS = []

SWITCH_OWNERS = [
    {
        'switch': '@EnableScheduling',
        'owner': 'config/SchedulerConfig.java',
        'why': '定时任务总开关',
        'when': {'scheduler': ['spring']},
    },
    {
        'switch': '@EnableSchedulerLock',
        'owner': 'config/SchedulerConfig.java',
        'why': '多实例下给任务加分布式锁，防止重复执行',
        'when': {'scheduler': ['spring']},
    },
    {
        'switch': '@EnableCaching',
        'owner': 'config/CacheConfig.java',
        'why': '注解式缓存总开关',
        'when': {'cache': ['caffeine']},
    },
    {
        'switch': '@EnableCaching',
        'owner': 'config/RedisConfig.java',
        'why': '注解式缓存总开关（Redis 作缓存管理器）',
        'when': {'cache': ['redis']},
    },
    {
        'switch': '@EnableJpaAuditing',
        'owner': 'config/JpaAuditConfig.java',
        'why': '审计字段自动填充',
        'when': {'persistence': ['jpa']},
    },
    {
        'switch': 'WebMvcConfigurer',
        'owner': 'config/WebMvcConfig.java',
        'why': '拦截器链与跨域。不用 @EnableWebMvc —— 它会让自动配置整体失效',
        'when': {'web': ['mvc']},
    },
    {
        'switch': '@EnableWebFlux',
        'owner': '（自动装配）',
        'why': 'WebFlux 由 starter 自动装配，加了反而会打断自动配置',
        'when': {'web': ['webflux']},
    },
    {
        'switch': '@Async / @EnableAsync',
        'owner': 'config/AsyncConfig.java',
        'why': '异步线程池。禁止 new Thread，也禁止用默认的 SimpleAsyncTaskExecutor',
        'when': None,
    },
    {
        'switch': '@Transactional',
        'owner': 'service 层方法上',
        'why': '由 Boot 自动开启，不需要任何 @Enable 注解。写在 public 方法上才生效',
        'when': None,
    },
]

APP_TEMPLATE = '''package com.example;

__IMPORTS__

/**
 * 应用启动类。
 *
 * 三条硬约束（军火库 SKEL-STRC-002）：
 *   1. 必须放在根包 com.example。@SpringBootApplication 隐式带 @ComponentScan，
 *      扫描范围是「本类所在包及其子包」。放到子包里的结果是部分 Bean 扫不到，
 *      而报出来的错误与真实原因毫无关系。
 *   2. 根包里只放这一个类。其他类一律进子包 —— 否则分包边界会从根包开始糊掉。
 *   3. 启动类不做业务初始化。需要预热数据就写 ApplicationRunner，
 *      否则启动失败的原因会被埋进业务异常里。
 *
 * 为什么这个类看起来这么空：
 * 全局开关全部放在各自负责的配置类里，启动类只保留「包扫描锚点」这一个职责。
 *
 * 当前组合的开关归属表（删掉哪个配置类，等于关掉对应的开关）：
 *
__SWITCHES__
 *
 * 这不是洁癖。启动类一旦开始堆注解，它就会变成「谁都想往里加一行」的地方，
 * 半年后没人说得清哪一行是干什么的、能不能删。
 */
@SpringBootApplication
__ANNOTATIONS__
public class Application {

    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
'''

# ─────────────────────────────────────────────────────────────
# 其余可导出文件
# ─────────────────────────────────────────────────────────────

GITIGNORE = '''# 构建产物
target/
build/
out/
!.mvn/wrapper/maven-wrapper.jar

# 日志与运行时
logs/
*.log

# IDE
.idea/
*.iml
*.ipr
*.iws
.vscode/

# 密钥与本地配置 —— 这三行是防事故的核心
.env
.env.*
!.env.example
application-local.yml
src/main/resources/application-local.yml

# 系统文件
.DS_Store
Thumbs.db
'''

FLYWAY_V1 = '''-- V1__init.sql
--
-- 第一条迁移脚本要一次把规范立住，后面所有建表都照它抄。
-- 三条约定：
--   1. 主键统一 bigint unsigned + 自增，不用 varchar 做主键（索引膨胀且无顺序）
--   2. 每张表必带 create_time / update_time / deleted，且都有默认值
--   3. 索引命名固定：唯一索引 uk_ 前缀，普通索引 idx_ 前缀，外键 fk_ 前缀
--      —— 不这样做，半年后看到 idx1、idx2 只能靠猜

CREATE TABLE `user`
(
    `id`          bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
    `username`    varchar(64)     NOT NULL COMMENT '用户名',
    `mobile`      varchar(20)              DEFAULT NULL COMMENT '手机号',
    `status`      tinyint         NOT NULL DEFAULT 0 COMMENT '状态：0正常 1停用',
    `create_time` datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time` datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`     tinyint         NOT NULL DEFAULT 0 COMMENT '逻辑删除：0未删 1已删',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_username` (`username`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_general_ci COMMENT ='用户表';

CREATE TABLE IF NOT EXISTS `example_order`
(
    `id`          bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
    `order_no`    varchar(32)     NOT NULL COMMENT '业务单号，对外唯一标识',
    `amount`      decimal(18, 2)  NOT NULL DEFAULT 0.00 COMMENT '金额。钱一律用 decimal，不用 double',
    `status`      tinyint         NOT NULL DEFAULT 0 COMMENT '状态：0待处理 1处理中 2已完成 3已取消',
    `remark`      varchar(255)             DEFAULT NULL COMMENT '备注',
    `create_time` datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time` datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`     tinyint         NOT NULL DEFAULT 0 COMMENT '逻辑删除：0未删 1已删',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_order_no` (`order_no`),
    KEY `idx_status_create_time` (`status`, `create_time`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_general_ci COMMENT ='示例订单表';
'''

LIQUIBASE_MASTER = '''<?xml version="1.0" encoding="UTF-8"?>
<!--
  变更总入口。这个文件只做 include，不写具体变更 ——
  否则它会随着项目推进膨胀成一个没人敢改的巨型 XML。
-->
<databaseChangeLog
        xmlns="http://www.liquibase.org/xml/ns/dbchangelog"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.liquibase.org/xml/ns/dbchangelog
                            http://www.liquibase.org/xml/ns/dbchangelog/dbchangelog-4.24.xsd">

    <include file="db/changelog/changes/001-init.xml" relativeToChangelogFile="false"/>

</databaseChangeLog>
'''

SMOKE_TEST = '''package com.example;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * 上下文冒烟测试。
 *
 * 它只证明一件事：**Spring 容器能起来**。
 * 但这一条比很多业务测试更早地拦住问题 —— 配置写错、Bean 循环依赖、
 * 数据源连不上、Mapper 扫描路径写错，都会在这里直接失败。
 *
 * 注意：这个测试需要能连上数据库。CI 里要么起一个测试库，
 * 要么用 Testcontainers，不要用 H2 假装它是 MySQL。
 */
@SpringBootTest
class ApplicationTests {

    @Test
    void contextLoads() {
        // 容器起不来，这个测试就不会通过
    }
}
'''

GRADLE_SETTINGS = "rootProject.name = 'arsenal-demo'\n"

# ─────────────────────────────────────────────────────────────
# 脚手架代码（SCAFFOLD）
#
# 「树上画出来的每个文件，包里就真的有」的本体。09-28 十反馈第二轮：
# 用户导出「单体最小集」只拿到 3 个 Java 文件 —— 树画了 40 多个文件，
# 导出链路却只产配置类。从这份数据起，脚手架代码（公共层 / 认证实现 /
# user 领域六件套 / 日志 / 建表脚本）全部真实生成。
#
# 结构：每个条目 = {path, group, from, desc, variants}
#   variants 按声明顺序匹配，第一个 when 命中的胜出；
#   不带 when 的是兜底变体，必须排在最后（构建期校验）。
#   同一维度上两个变体的选项集合必须不相交，否则选型命中时二义。
#
# 代码立场：
#   1. 全部纯 JDK + Spring Boot 3，不用 Lombok —— boilerplate 选什么都能跑。
#   2. 每条硬约束写成注释留在代码里 —— 脚手架是规范的第一个落地物。
#   3. 领域示例只有 user 一个，新领域照它抄六件套。
# ─────────────────────────────────────────────────────────────


def V(code, when=None):
    """一个脚手架变体：when=None 表示兜底（必须排在最后）。"""
    return {'when': when, 'code': code}


def S(path, group, desc, variants, frm='脚手架'):
    return {'path': path, 'group': group, 'from': frm, 'desc': desc, 'variants': variants}


SCAFFOLD = [
    # ── common：与业务无关的全局共享物 ──────────────────────
    S('src/main/java/com/example/common/ApiResponse.java', '源码',
      '统一响应体。所有接口只返回这一种外壳，前端只解析一种结构。', [
        V(r'''package com.example.common;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * 统一响应体。所有接口只返回这一种外壳 ——
 * 前端只需要解析一种结构，网关与日志只需要看一个 code 字段就能判断成败。
 *
 * code 约定：0 成功；非 0 一律对应 ErrorCode 里的某个常量，
 * 禁止在业务代码里手写魔法数字。
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record ApiResponse<T>(int code, String message, T data) {

    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(0, "ok", data);
    }

    public static ApiResponse<Void> ok() {
        return ok(null);
    }

    public static <T> ApiResponse<T> fail(int code, String message) {
        return new ApiResponse<>(code, message, null);
    }

    public static <T> ApiResponse<T> fail(ErrorCode errorCode) {
        return fail(errorCode.getCode(), errorCode.getMessage());
    }
}'''),
      ]),
    S('src/main/java/com/example/common/PageResult.java', '源码',
      '统一分页结构：页码、页大小、总数、列表，字段名固定不再各写一套。', [
        V(r'''package com.example.common;

import java.util.List;

/**
 * 统一分页结构。分页语义只在这里定义一次：
 *   page 从 1 开始；total 是过滤前（不带 LIMIT）的总数；list 永远不为 null。
 */
public record PageResult<T>(long page, long pageSize, long total, List<T> list) {

    public static <T> PageResult<T> of(List<T> list, long total, long page, long pageSize) {
        return new PageResult<>(page, pageSize, total, list == null ? List.of() : list);
    }

    public static <T> PageResult<T> empty(long page, long pageSize) {
        return new PageResult<>(page, pageSize, 0, List.of());
    }
}'''),
      ]),
    S('src/main/java/com/example/common/ErrorCode.java', '源码',
      '错误码常量表。码值集中定义，禁止散落在各处的魔法数字。', [
        V(r'''package com.example.common;

/**
 * 错误码常量表。
 *
 * 分段约定：0 成功；1xxx 通用；2xxx 用户域。新领域动手前先在这里占一段，
 * 半年后看到 2003 还能知道它是谁 —— 散落各处的魔法数字做不到。
 */
public enum ErrorCode {
    OK(0, "ok"),
    SYSTEM_ERROR(1000, "系统繁忙，请稍后再试"),
    PARAM_INVALID(1001, "参数不合法"),
    UNAUTHORIZED(1002, "未登录或登录已过期"),
    FORBIDDEN(1003, "没有操作权限"),
    NOT_FOUND(1004, "资源不存在"),
    CONFLICT(1005, "状态冲突，请刷新后重试"),
    USERNAME_DUPLICATED(2001, "用户名已被占用");

    private final int code;
    private final String message;

    ErrorCode(int code, String message) {
        this.code = code;
        this.message = message;
    }

    public int getCode() {
        return code;
    }

    public String getMessage() {
        return message;
    }
}'''),
      ]),
    S('src/main/java/com/example/common/exception/BizException.java', '源码',
      '业务异常基类，携带错误码 —— 可预期的失败用它，不抛 RuntimeException。', [
        V(r'''package com.example.common.exception;

import com.example.common.ErrorCode;

/**
 * 可预期的业务失败用它，不要裸抛 RuntimeException ——
 * 裸抛的异常没有错误码，全局异常出口只能给前端一个笼统的 500。
 */
public class BizException extends RuntimeException {

    private final ErrorCode errorCode;

    public BizException(ErrorCode errorCode) {
        super(errorCode.getMessage());
        this.errorCode = errorCode;
    }

    public BizException(ErrorCode errorCode, String detail) {
        super(detail);
        this.errorCode = errorCode;
    }

    public ErrorCode getErrorCode() {
        return errorCode;
    }
}'''),
      ]),
    S('src/main/java/com/example/common/web/GlobalExceptionHandler.java', '源码',
      '全局异常出口。所有异常在这里转成统一响应体，兜底分支必须记录堆栈。', [
        V(r'''package com.example.common.web;

import com.example.common.ApiResponse;
import com.example.common.ErrorCode;
import com.example.common.exception.BizException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 全局异常出口。所有异常只在这里转成统一响应体，业务代码不再各自 try-catch。
 *
 * 兜底分支必须记录完整堆栈：异常被转成 200 响应之后，
 * 这行日志是唯一的故障现场 —— 不打堆栈的兜底等于销毁现场。
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    /** 业务异常：可预期，info 级别即可，不打堆栈（堆栈会把日志淹了）。 */
    @ExceptionHandler(BizException.class)
    public ApiResponse<Void> handleBiz(BizException e) {
        log.info("业务异常: code={}, message={}", e.getErrorCode(), e.getMessage());
        return ApiResponse.fail(e.getErrorCode());
    }

    /** 参数校验失败：取第一条提示给前端，足够定位问题。 */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ApiResponse<Void> handleValidation(MethodArgumentNotValidException e) {
        String detail = e.getBindingResult().getFieldErrors().stream()
                .findFirst()
                .map(err -> err.getField() + " " + err.getDefaultMessage())
                .orElse(ErrorCode.PARAM_INVALID.getMessage());
        return ApiResponse.fail(ErrorCode.PARAM_INVALID.getCode(), detail);
    }

    /** 兜底：任何没接住的异常。堆栈必须留下。 */
    @ExceptionHandler(Exception.class)
    public ApiResponse<Void> handleUnexpected(Exception e) {
        log.error("未处理异常", e);
        return ApiResponse.fail(ErrorCode.SYSTEM_ERROR);
    }
}'''),
      ]),

    # ── config：所有 @Configuration 集中在此 ───────────────
    S('src/main/java/com/example/config/WebMvcConfig.java', '源码',
      '跨域与拦截器链。TraceId 拦截器必须排在鉴权之前。', [
        V(r'''package com.example.config;

import com.example.interceptor.AuthInterceptor;
import com.example.interceptor.TraceIdInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * 跨域与拦截器链。不用 @EnableWebMvc —— 它会让 Spring Boot 的
 * MVC 自动配置整体失效，Jackson 的全局定制会跟着失灵。
 */
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    private final TraceIdInterceptor traceIdInterceptor;
    private final AuthInterceptor authInterceptor;

    public WebMvcConfig(TraceIdInterceptor traceIdInterceptor, AuthInterceptor authInterceptor) {
        this.traceIdInterceptor = traceIdInterceptor;
        this.authInterceptor = authInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        // TraceId 必须排在鉴权之前：排查 401 时需要「这个请求为什么被拒」的完整日志链
        registry.addInterceptor(traceIdInterceptor).addPathPatterns("/**").order(0);
        // 登录态校验只拦业务接口；文档、健康检查、静态资源不在名单里
        registry.addInterceptor(authInterceptor).addPathPatterns("/api/**").order(1);
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        // allowedOrigins("*") 与 allowCredentials(true) 互斥 ——
        // 要带凭证就用 allowedOriginPatterns，写 * 浏览器会直接拒绝
        registry.addMapping("/api/**")
                .allowedOriginPatterns("*")
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true)
                .maxAge(3600);
    }
}''', when={'auth': ['securityjwt', 'satoken']}),
        V(r'''package com.example.config;

import com.example.interceptor.TraceIdInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * 跨域与拦截器链。不用 @EnableWebMvc —— 它会让 Spring Boot 的
 * MVC 自动配置整体失效，Jackson 的全局定制会跟着失灵。
 *
 * 当前组合没有选鉴权框架，这里只注册 TraceId。
 * 接入鉴权时在它后面补一行 authInterceptor 注册，order=1。
 */
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    private final TraceIdInterceptor traceIdInterceptor;

    public WebMvcConfig(TraceIdInterceptor traceIdInterceptor) {
        this.traceIdInterceptor = traceIdInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(traceIdInterceptor).addPathPatterns("/**").order(0);
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        // allowedOrigins("*") 与 allowCredentials(true) 互斥 ——
        // 要带凭证就用 allowedOriginPatterns，写 * 浏览器会直接拒绝
        registry.addMapping("/api/**")
                .allowedOriginPatterns("*")
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true)
                .maxAge(3600);
    }
}'''),
      ]),
    S('src/main/java/com/example/config/JacksonConfig.java', '源码',
      'JSON 序列化策略。Long 转字符串防前端精度丢失 —— 这是最容易上线后才发现的坑。', [
        V(r'''package com.example.config;

import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import com.fasterxml.jackson.datatype.jsr310.deser.LocalDateTimeDeserializer;
import com.fasterxml.jackson.datatype.jsr310.ser.LocalDateTimeSerializer;
import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/**
 * JSON 序列化策略，集中在这一处定制，不许散落到注解里各写各的。
 */
@Configuration
public class JacksonConfig {

    private static final DateTimeFormatter DATETIME = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    @Bean
    public Jackson2ObjectMapperBuilderCustomizer jacksonCustomizer() {
        return builder -> builder
                // Long 超过 2^53 之后 JavaScript 无法精确表示，前端拿到的是静默改错的数字。
                // 统一转字符串是防线，不是可选优化。
                .serializerByType(Long.class, ToStringSerializer.instance)
                .serializerByType(Long.TYPE, ToStringSerializer.instance)
                .serializerByType(LocalDateTime.class, new LocalDateTimeSerializer(DATETIME))
                .deserializerByType(LocalDateTime.class, new LocalDateTimeDeserializer(DATETIME))
                // 未知字段不再抛异常：接口加字段后，老客户端不能因此崩掉
                .failOnUnknownProperties(false);
    }
}'''),
      ]),
    S('src/main/java/com/example/config/AsyncConfig.java', '源码',
      '异步线程池。所有 @Async 都走它，禁止 new Thread。', [
        V(r'''package com.example.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;

/**
 * 异步线程池。所有 @Async 都走它 —— 不指定 executor 的 @Async
 * 会落到 SimpleAsyncTaskExecutor：它不复用线程，每个任务开一个新线程，
 * 高并发下等于没有线程池。
 *
 * 队列满之后选 CallerRunsPolicy 而不是丢弃：被拒的任务回到调用者线程执行，
 * 上游自动变慢 —— 这是有界队列的正确退化方式，静默丢任务排障时要命。
 */
@Configuration
@EnableAsync
public class AsyncConfig {

    @Bean("asyncExecutor")
    public Executor asyncExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(4);
        executor.setMaxPoolSize(8);
        executor.setQueueCapacity(200);
        executor.setThreadNamePrefix("async-");
        executor.setRejectedExecutionHandler(new ThreadPoolExecutor.CallerRunsPolicy());
        // 优雅停机：等待在跑的任务完成，最多等 30 秒
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        executor.initialize();
        return executor;
    }
}'''),
      ]),
    S('src/main/java/com/example/config/RetryConfig.java', '源码',
      '重试策略。退避与次数上限在此统一，不允许在业务代码里写重试循环。', [
        V(r'''package com.example.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;
import java.util.function.Supplier;

/**
 * 重试策略。调外部系统（HTTP、下游服务）的代码不允许自己写 for 循环重试 ——
 * 散落各处的重试既看不到总量，也调不了参数。统一从这里借。
 *
 * 指数退避 + 次数上限：连续失败时立刻重试只会把对方打得更狠。
 */
@Configuration
public class RetryConfig {

    private static final Logger log = LoggerFactory.getLogger(RetryConfig.class);

    @Bean
    public RetryExecutor retryExecutor() {
        return new RetryExecutor();
    }

    /** 指数退避重试器。次数与起始等待由调用方给，退避倍率固定 2。 */
    public static class RetryExecutor {

        public <T> T execute(int maxAttempts, Duration initialBackoff, Supplier<T> action) {
            Duration backoff = initialBackoff;
            for (int attempt = 1; ; attempt++) {
                try {
                    return action.get();
                } catch (RuntimeException e) {
                    if (attempt >= maxAttempts) {
                        throw e; // 次数用尽：原样抛出，由全局异常出口统一兜底
                    }
                    log.warn("调用失败（第 {}/{} 次），{}ms 后重试: {}",
                            attempt, maxAttempts, backoff.toMillis(), e.getMessage());
                    try {
                        Thread.sleep(backoff.toMillis());
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        throw new IllegalStateException("重试等待被中断", ie);
                    }
                    backoff = backoff.multipliedBy(2);
                }
            }
        }
    }
}'''),
      ]),

    # ── interceptor / filter ──────────────────────────────
    S('src/main/java/com/example/interceptor/TraceIdInterceptor.java', '源码',
      '给每个请求打链路 id 并写进 MDC，否则异步与跨服务日志串不起来。', [
        V(r'''package com.example.interceptor;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.UUID;

/**
 * 给每个请求打链路 id 并写进 MDC。日志 pattern 里带 %X{traceId} 时，
 * 一次请求的所有日志行都能被一个 id 串起来。
 *
 * 注册顺序必须排在鉴权之前（见 WebMvcConfig）：排查 401 时需要的是
 * 「这个请求为什么被拒」的完整日志链，这依赖 traceId 已经就位。
 */
@Component
public class TraceIdInterceptor implements HandlerInterceptor {

    public static final String TRACE_ID = "traceId";
    public static final String HEADER = "X-Trace-Id";

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        String traceId = request.getHeader(HEADER);
        if (traceId == null || traceId.isBlank()) {
            traceId = UUID.randomUUID().toString().replace("-", "");
        }
        MDC.put(TRACE_ID, traceId);
        response.setHeader(HEADER, traceId);
        return true;
    }

    @Override
    public void afterCompletion(HttpServletRequest request, HttpServletResponse response,
                                Object handler, Exception ex) {
        // Tomcat 线程是复用的，不清就会把上一个请求的 traceId 泄给下一个
        MDC.remove(TRACE_ID);
    }
}'''),
      ]),
    S('src/main/java/com/example/filter/RequestLogFilter.java', '源码',
      '请求日志与耗时统计。注意：包装请求体会让文件上传多占一份内存。', [
        V(r'''package com.example.filter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * 请求日志与耗时统计。只记方法、路径、状态码与耗时，**不包装请求体** ——
 * 包装 body 会让文件上传把整个文件缓存进堆里，多占一份内存。
 * 需要看请求体的场景交给 access log 或网关，不要在这里伸手。
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestLogFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(RequestLogFilter.class);

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        long start = System.currentTimeMillis();
        try {
            chain.doFilter(request, response);
        } finally {
            long cost = System.currentTimeMillis() - start;
            log.info("{} {} -> {} ({} ms)",
                    request.getMethod(), request.getRequestURI(), response.getStatus(), cost);
        }
    }
}'''),
      ]),
    S('src/main/java/com/example/interceptor/AuthInterceptor.java', '源码',
      '登录态校验与放行名单。用拦截器就要在 WebMvcConfig 注册，漏注册的表现是接口直接裸奔。', [
        V(r'''package com.example.interceptor;

import com.example.security.CurrentUserHolder;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.nio.charset.StandardCharsets;

/**
 * 业务侧登录态校验（双防线之二）：JwtAuthenticationFilter 负责解析令牌，
 * 这里负责对 /api/** 断言身份已就位。
 *
 * 放行名单只写在 SecurityConfig 一处 —— 两处各写一份迟早对不上。
 */
@Component
public class AuthInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws Exception {
        if (CurrentUserHolder.getUsername() != null) {
            return true;
        }
        response.setStatus(401);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write(
                "{\"code\":1002,\"message\":\"未登录或登录已过期\",\"data\":null}");
        return false;
    }
}''', when={'auth': ['securityjwt']}),
        V(r'''package com.example.interceptor;

import cn.dev33.satoken.stp.StpUtil;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * 登录态校验（Sa-Token 版）。未登录时由 Sa-Token 抛 NotLoginException，
 * 全局异常出口需要为它补一个分支（sa-token 的异常类不在本模板依赖里，
 * 需要时按 sa-token 文档加一个 @ExceptionHandler）。
 */
@Component
public class AuthInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        StpUtil.checkLogin();
        return true;
    }
}''', when={'auth': ['satoken']}),
      ]),

    # ── security：鉴权实现物（auth=securityjwt）────────────
    S('src/main/java/com/example/security/JwtAuthenticationFilter.java', '源码',
      'JWT 解析过滤器。算法必须做白名单校验，否则 alg=none 可直接绕过签名。', [
        V(r'''package com.example.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import javax.crypto.SecretKey;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/**
 * JWT 解析过滤器。只负责三件事：解析、验签、把身份放进 CurrentUserHolder。
 *
 * 算法白名单不用手写：verifyWith(SecretKey) 把可接受的算法限定为该密钥
 * 对应的族（HS256/384/512），header 里伪造的 alg=none 会被直接拒绝 ——
 * 这是 JWT 最著名的历史漏洞，jjwt 0.12 的 API 从设计上堵死了它。
 */
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final String BEARER = "Bearer ";

    private final SecretKey key;

    public JwtAuthenticationFilter(@Value("${app.jwt.secret}") String secret) {
        // 密钥长度必须 >= 32 字节，HS256 才安全；生产从环境变量注入
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith(BEARER)) {
            try {
                Claims claims = Jwts.parser()
                        .verifyWith(key)
                        .build()
                        .parseSignedClaims(header.substring(BEARER.length()))
                        .getPayload();
                CurrentUserHolder.set(claims.getSubject());
            } catch (JwtException | IllegalArgumentException e) {
                // 无效令牌不在这里拒绝 —— 交给 SecurityConfig 的规则链按路径决定 401 还是放行
                CurrentUserHolder.clear();
            }
        }
        try {
            chain.doFilter(request, response);
        } finally {
            // 请求结束必须清理：线程复用会把身份带给下一个请求，这是真实发生过的越权事故
            CurrentUserHolder.clear();
        }
    }
}''', when={'auth': ['securityjwt']}),
      ]),
    S('src/main/java/com/example/security/CurrentUserHolder.java', '源码',
      '当前登录用户上下文。基于 ThreadLocal —— 用完必须在 finally 里清理，否则会跨请求越权。', [
        V(r'''package com.example.security;

/**
 * 当前登录用户上下文。值由 JwtAuthenticationFilter 在请求进入业务代码前写入。
 *
 * 用完必须清理：过滤器链尾 finally 里 clear()。Tomcat 的线程是复用的，
 * 不清理意味着下一个请求可能读到上一个用户的身份 —— 这是真实发生过的越权事故。
 */
public final class CurrentUserHolder {

    private static final ThreadLocal<String> CONTEXT = new ThreadLocal<>();

    private CurrentUserHolder() {
    }

    public static void set(String username) {
        CONTEXT.set(username);
    }

    /** 拿不到时返回 null 而不是抛异常：定时任务、系统内部调用没有「当前用户」。 */
    public static String getUsername() {
        return CONTEXT.get();
    }

    public static void clear() {
        CONTEXT.remove();
    }
}''', when={'auth': ['securityjwt']}),
      ]),

    # ── resources：日志滚动 ────────────────────────────────
    S('src/main/resources/logback-spring.xml', '配置',
      '日志滚动与分级。按 profile 切换输出目标。', [
        V(r'''<?xml version="1.0" encoding="UTF-8"?>
<!--
  日志滚动与分级。按 profile 切换输出目标：开发看控制台，生产落文件。
  pattern 里的 %X{traceId} 配合 TraceIdInterceptor 使用 ——
  少了它，一次请求的日志串不起来。
-->
<configuration>

    <!-- 只认 dev/prod 两个 springProfile 时，不激活任何 profile 的默认启动会一个
         appender 都没有 —— 应用全程静音，连「启动失败」都看不见。默认态必须落控制台。 -->
    <springProfile name="!prod">
        <appender name="CONSOLE" class="ch.qos.logback.core.ConsoleAppender">
            <encoder>
                <pattern>%d{HH:mm:ss.SSS} [%thread] %-5level %logger{36} - %msg%n</pattern>
                <charset>UTF-8</charset>
            </encoder>
        </appender>
        <root level="INFO">
            <appender-ref ref="CONSOLE"/>
        </root>
    </springProfile>

    <springProfile name="prod">
        <appender name="FILE" class="ch.qos.logback.core.rolling.RollingFileAppender">
            <file>logs/app.log</file>
            <rollingPolicy class="ch.qos.logback.core.rolling.SizeAndTimeBasedRollingPolicy">
                <!-- 按天滚动 + 单文件上限；历史压缩保留 30 天，总量封顶 10GB -->
                <fileNamePattern>logs/app.%d{yyyy-MM-dd}.%i.log.gz</fileNamePattern>
                <maxFileSize>100MB</maxFileSize>
                <maxHistory>30</maxHistory>
                <totalSizeCap>10GB</totalSizeCap>
            </rollingPolicy>
            <encoder>
                <!-- traceId 在最前：生产排障第一件事就是按它捞日志 -->
                <pattern>%d{yyyy-MM-dd HH:mm:ss.SSS} [%X{traceId}] [%thread] %-5level %logger{36} - %msg%n</pattern>
                <charset>UTF-8</charset>
            </encoder>
        </appender>
        <root level="INFO">
            <appender-ref ref="FILE"/>
        </root>
    </springProfile>

</configuration>'''),
      ]),

    # ── user：业务领域示例（六件套，新领域照它抄）──────────
    S('src/main/java/com/example/user/controller/UserController.java', '源码',
      'HTTP 入口。只做参数校验与调用，不写业务逻辑，不直接碰数据库。', [
        V(r'''package com.example.user.controller;

import com.example.common.ApiResponse;
import com.example.common.PageResult;
import com.example.user.dto.CreateUserRequest;
import com.example.user.dto.UserQuery;
import com.example.user.dto.UserResponse;
import com.example.user.service.UserService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * HTTP 入口。只做参数校验与调用：不写业务逻辑、不直接碰数据层。
 * 返回值只有 ApiResponse 一种外壳。
 */
@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserService service;

    public UserController(UserService service) {
        this.service = service;
    }

    @PostMapping
    public ApiResponse<Long> create(@Valid @RequestBody CreateUserRequest req) {
        return ApiResponse.ok(service.create(req));
    }

    @GetMapping("/{id}")
    public ApiResponse<UserResponse> get(@PathVariable Long id) {
        return ApiResponse.ok(service.getById(id));
    }

    @GetMapping
    public ApiResponse<PageResult<UserResponse>> page(UserQuery query) {
        return ApiResponse.ok(service.page(query));
    }
}'''),
      ]),
    S('src/main/java/com/example/user/dto/CreateUserRequest.java', '源码',
      '入参 DTO。必须带校验注解，且与实体分开。', [
        V(r'''package com.example.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 入参 DTO。与实体分开：接口字段是「调用方视角」，实体字段是「表结构视角」，
 * 共用一个类等于把表结构暴露给每个调用方。
 *
 * record 自 JDK16 起可作 DTO：字段不可变、Jackson 与校验注解都原生支持。
 */
public record CreateUserRequest(
        @NotBlank(message = "用户名不能为空")
        @Size(max = 64, message = "用户名最长 64 字符")
        String username,

        @Pattern(regexp = "^1[3-9]\\d{9}$", message = "手机号格式不正确")
        String mobile
) {
}'''),
      ]),
    S('src/main/java/com/example/user/dto/UserResponse.java', '源码',
      '出参 DTO。实体不直接出接口 —— 否则加一个字段就泄露一次。', [
        V(r'''package com.example.user.dto;

import com.example.user.domain.User;

import java.time.LocalDateTime;

/**
 * 出参 DTO。实体不直接出接口 —— 否则每加一个字段（哪怕只是内部标记）
 * 就往外泄露一次。
 */
public record UserResponse(
        Long id,
        String username,
        String mobile,
        Integer status,
        LocalDateTime createTime
) {

    public static UserResponse from(User user) {
        return new UserResponse(
                user.getId(), user.getUsername(), user.getMobile(),
                user.getStatus(), user.getCreateTime());
    }
}'''),
      ]),
    S('src/main/java/com/example/user/dto/UserQuery.java', '源码',
      '查询条件对象。参数超过三个就必须用对象承载。', [
        V(r'''package com.example.user.dto;

/**
 * 查询条件对象。参数超过三个就必须用对象承载 ——
 * 散着的参数每加一个条件就改一遍方法签名，所有调用方跟着改。
 *
 * 普通 class（不是 record）：Spring 按名字绑定 query 参数依赖 setter。
 */
public class UserQuery {

    private long page = 1;
    private long pageSize = 20;
    private String username;
    private Integer status;

    public long getPage() {
        return page;
    }

    public void setPage(long page) {
        this.page = Math.max(1, page);
    }

    public long getPageSize() {
        return pageSize;
    }

    public void setPageSize(long pageSize) {
        // 单页上限兜底：即便调用方传了 100000 也被限制住，防止一次查询拉全表
        this.pageSize = Math.min(Math.max(1, pageSize), 500);
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public Integer getStatus() {
        return status;
    }

    public void setStatus(Integer status) {
        this.status = status;
    }
}'''),
      ]),
    S('src/main/java/com/example/user/domain/User.java', '源码',
      '实体与枚举。表结构在代码里的投影，字段与列一一对应。', [
        V(r'''package com.example.user.domain;

import java.time.LocalDateTime;

/**
 * 用户实体。字段与 user 表一一对应，不放业务方法 —— 它是表结构在代码里的投影。
 * 纯 POJO：JdbcTemplate 的 BeanPropertyRowMapper 依赖无参构造与 setter。
 */
public class User {

    private Long id;
    private String username;
    private String mobile;
    /** 状态：0 正常 1 停用 */
    private Integer status;
    private LocalDateTime createTime;
    private LocalDateTime updateTime;
    /** 逻辑删除：0 未删 1 已删 */
    private Integer deleted;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getMobile() {
        return mobile;
    }

    public void setMobile(String mobile) {
        this.mobile = mobile;
    }

    public Integer getStatus() {
        return status;
    }

    public void setStatus(Integer status) {
        this.status = status;
    }

    public LocalDateTime getCreateTime() {
        return createTime;
    }

    public void setCreateTime(LocalDateTime createTime) {
        this.createTime = createTime;
    }

    public LocalDateTime getUpdateTime() {
        return updateTime;
    }

    public void setUpdateTime(LocalDateTime updateTime) {
        this.updateTime = updateTime;
    }

    public Integer getDeleted() {
        return deleted;
    }

    public void setDeleted(Integer deleted) {
        this.deleted = deleted;
    }
}''', when={'persistence': ['jdbc']}),
        V(r'''package com.example.user.domain;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableLogic;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

/**
 * 用户实体。@TableLogic 配合 yaml 里的 logic-delete-field：
 * 配好后 deleteById 自动变成 update deleted=1，业务代码无感。
 */
@TableName("user")
public class User {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String username;

    private String mobile;

    /** 状态：0 正常 1 停用 */
    private Integer status;

    private LocalDateTime createTime;

    private LocalDateTime updateTime;

    @TableLogic
    private Integer deleted;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getMobile() {
        return mobile;
    }

    public void setMobile(String mobile) {
        this.mobile = mobile;
    }

    public Integer getStatus() {
        return status;
    }

    public void setStatus(Integer status) {
        this.status = status;
    }

    public LocalDateTime getCreateTime() {
        return createTime;
    }

    public void setCreateTime(LocalDateTime createTime) {
        this.createTime = createTime;
    }

    public LocalDateTime getUpdateTime() {
        return updateTime;
    }

    public void setUpdateTime(LocalDateTime updateTime) {
        this.updateTime = updateTime;
    }

    public Integer getDeleted() {
        return deleted;
    }

    public void setDeleted(Integer deleted) {
        this.deleted = deleted;
    }
}''', when={'persistence': ['mybatisplus']}),
        V(r'''package com.example.user.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.springframework.data.annotation.CreatedDate;
import org.springframework.data.annotation.LastModifiedDate;

import java.time.LocalDateTime;

/**
 * 用户实体。列名与 user 表一字不差；ddl-auto=validate 下不一致会在启动时报出来。
 * 审计字段交给 JpaAuditConfig 的 @CreatedDate / @LastModifiedDate 自动填充。
 */
@Entity
@Table(name = "user")
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 64)
    private String username;

    @Column(length = 20)
    private String mobile;

    /** 状态：0 正常 1 停用 */
    @Column(nullable = false)
    private Integer status;

    @CreatedDate
    @Column(nullable = false, updatable = false)
    private LocalDateTime createTime;

    @LastModifiedDate
    @Column(nullable = false)
    private LocalDateTime updateTime;

    /** 逻辑删除：0 未删 1 已删 */
    @Column(nullable = false)
    private Integer deleted;

    /** JPA 必须有无参构造；protected 修饰防止业务代码 new 出无主实体 */
    protected User() {
    }

    public Long getId() {
        return id;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getMobile() {
        return mobile;
    }

    public void setMobile(String mobile) {
        this.mobile = mobile;
    }

    public Integer getStatus() {
        return status;
    }

    public LocalDateTime getCreateTime() {
        return createTime;
    }

    public LocalDateTime getUpdateTime() {
        return updateTime;
    }

    public Integer getDeleted() {
        return deleted;
    }
}''', when={'persistence': ['jpa']}),
      ]),
    S('src/main/java/com/example/user/repository/UserRepository.java', '源码',
      '数据访问。SQL 与 ORM 调用只出现在这里。', [
        V(r'''package com.example.user.repository;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.example.user.domain.User;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 数据访问。继承 BaseMapper 后单表 CRUD 与分页免写 SQL；
 * Wrapper 拼不出来或拼出来不可读的 SQL 落在 resources/mapper/UserMapper.xml ——
 * 两边各取所长，不要硬用 Wrapper 拼多表连接。
 *
 * 接口必须能被扫描到：Application 上的 @MapperScan 路径是 com.example.**.repository。
 */
@Mapper
public interface UserRepository extends BaseMapper<User> {

    /** XML 里的方法在这里声明：参数用 @Param，结果用 resultMap */
    List<User> selectWithStats(@Param("limit") int limit);
}''', when={'persistence': ['mybatisplus']}),
        V(r'''package com.example.user.repository;

import com.example.user.domain.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;

import java.util.Optional;

/**
 * 数据访问。方法名即查询；动态条件用 Specification（见 UserService.page），
 * 不要硬拼一长串方法名。
 */
public interface UserRepository extends JpaRepository<User, Long>, JpaSpecificationExecutor<User> {

    Optional<User> findByUsername(String username);
}''', when={'persistence': ['jpa']}),
      ]),
    S('src/main/java/com/example/user/repository/UserDao.java', '源码',
      '数据访问。用 JdbcTemplate 手写 SQL，SQL 与映射都在这里。', [
        V(r'''package com.example.user.repository;

import com.example.user.domain.User;
import org.springframework.jdbc.core.BeanPropertyRowMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.stereotype.Repository;

import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * 数据访问。用 JdbcTemplate 手写 SQL，SQL 与映射都留在这一层。
 *
 * 参数只用 ? 占位符 —— 拼 SQL 字符串是注入的唯一入口。
 * 没有 ORM 的魔法，每一条 SQL 都看得见：这是 jdbc 路线的全部价值。
 */
@Repository
public class UserDao {

    private static final String COLS =
            "id, username, mobile, status, create_time, update_time, deleted";

    /** BeanPropertyRowMapper 把 create_time 自动映射成 createTime，免写 resultMap */
    private static final RowMapper<User> ROW_MAPPER = new BeanPropertyRowMapper<>(User.class);

    private final JdbcTemplate jdbc;

    public UserDao(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public Optional<User> findById(Long id) {
        String sql = "SELECT " + COLS + " FROM user WHERE id = ? AND deleted = 0";
        return jdbc.query(sql, ROW_MAPPER, id).stream().findFirst();
    }

    public Optional<User> findByUsername(String username) {
        String sql = "SELECT " + COLS + " FROM user WHERE username = ? AND deleted = 0";
        return jdbc.query(sql, ROW_MAPPER, username).stream().findFirst();
    }

    public Long insert(User user) {
        String sql = "INSERT INTO user (username, mobile, status, create_time, update_time, deleted) "
                + "VALUES (?, ?, 0, NOW(), NOW(), 0)";
        GeneratedKeyHolder keyHolder = new GeneratedKeyHolder();
        jdbc.update(con -> {
            var ps = con.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS);
            ps.setString(1, user.getUsername());
            ps.setString(2, user.getMobile());
            return ps;
        }, keyHolder);
        return keyHolder.getKey();
    }

    public List<User> page(String username, Integer status, long offset, long limit) {
        var where = whereOf(username, status);
        String sql = "SELECT " + COLS + " FROM user " + where.sql()
                + " ORDER BY id DESC LIMIT ? OFFSET ?";
        where.args().add(limit);
        where.args().add(offset);
        return jdbc.query(sql, ROW_MAPPER, where.args().toArray());
    }

    public long count(String username, Integer status) {
        var where = whereOf(username, status);
        String sql = "SELECT COUNT(*) FROM user " + where.sql();
        Long n = jdbc.queryForObject(sql, Long.class, where.args().toArray());
        return n == null ? 0 : n;
    }

    /** 动态条件集中拼一次，count 与 page 共用 —— 两处各拼一份迟早对不上 */
    private record Where(String sql, List<Object> args) {
    }

    private static Where whereOf(String username, Integer status) {
        StringBuilder sql = new StringBuilder("WHERE deleted = 0");
        List<Object> args = new ArrayList<>();
        if (username != null && !username.isBlank()) {
            sql.append(" AND username LIKE ?");
            args.add("%" + username + "%");
        }
        if (status != null) {
            sql.append(" AND status = ?");
            args.add(status);
        }
        return new Where(sql.toString(), args);
    }
}''', when={'persistence': ['jdbc']}),
      ]),
    S('src/main/java/com/example/user/service/UserService.java', '源码',
      '业务层。事务边界在这一层，@Transactional 只写在 public 方法上。', [
        V(r'''package com.example.user.service;

import com.example.common.ErrorCode;
import com.example.common.PageResult;
import com.example.common.exception.BizException;
import com.example.user.domain.User;
import com.example.user.dto.CreateUserRequest;
import com.example.user.dto.UserQuery;
import com.example.user.dto.UserResponse;
import com.example.user.exception.UserNotFoundException;
import com.example.user.repository.UserDao;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 业务层。事务边界在这一层：@Transactional 只写在 public 方法上
 * （代理只拦外部调用，类内自调用不生效），查询方法标 readOnly。
 */
@Service
public class UserService {

    private final UserDao dao;

    public UserService(UserDao dao) {
        this.dao = dao;
    }

    @Transactional
    public Long create(CreateUserRequest req) {
        dao.findByUsername(req.username()).ifPresent(u -> {
            throw new BizException(ErrorCode.USERNAME_DUPLICATED);
        });
        User user = new User();
        user.setUsername(req.username());
        user.setMobile(req.mobile());
        return dao.insert(user);
    }

    @Transactional(readOnly = true)
    public UserResponse getById(Long id) {
        return dao.findById(id).map(UserResponse::from)
                .orElseThrow(() -> new UserNotFoundException(id));
    }

    @Transactional(readOnly = true)
    public PageResult<UserResponse> page(UserQuery q) {
        long total = dao.count(q.getUsername(), q.getStatus());
        List<UserResponse> list = dao
                .page(q.getUsername(), q.getStatus(),
                        (q.getPage() - 1) * q.getPageSize(), q.getPageSize())
                .stream().map(UserResponse::from).toList();
        return PageResult.of(list, total, q.getPage(), q.getPageSize());
    }
}''', when={'persistence': ['jdbc']}),
        V(r'''package com.example.user.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.example.common.ErrorCode;
import com.example.common.PageResult;
import com.example.common.exception.BizException;
import com.example.user.domain.User;
import com.example.user.dto.CreateUserRequest;
import com.example.user.dto.UserQuery;
import com.example.user.dto.UserResponse;
import com.example.user.exception.UserNotFoundException;
import com.example.user.repository.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 业务层。事务边界在这一层：@Transactional 只写在 public 方法上，
 * 查询方法标 readOnly。
 *
 * 分页依赖 MybatisPlusConfig 里注册的分页插件 —— 没注册时 Page 查询
 * 不报错，只是分页参数被静默忽略，返回整张表。
 */
@Service
public class UserService {

    private final UserRepository repository;

    public UserService(UserRepository repository) {
        this.repository = repository;
    }

    @Transactional
    public Long create(CreateUserRequest req) {
        Long dup = repository.selectCount(
                new LambdaQueryWrapper<User>().eq(User::getUsername, req.username()));
        if (dup != null && dup > 0) {
            throw new BizException(ErrorCode.USERNAME_DUPLICATED);
        }
        User user = new User();
        user.setUsername(req.username());
        user.setMobile(req.mobile());
        repository.insert(user);
        return user.getId(); // BaseMapper 插入后回填自增主键
    }

    @Transactional(readOnly = true)
    public UserResponse getById(Long id) {
        User user = repository.selectById(id);
        if (user == null) {
            throw new UserNotFoundException(id);
        }
        return UserResponse.from(user);
    }

    @Transactional(readOnly = true)
    public PageResult<UserResponse> page(UserQuery q) {
        LambdaQueryWrapper<User> wrapper = new LambdaQueryWrapper<User>()
                .like(q.getUsername() != null && !q.getUsername().isBlank(),
                        User::getUsername, q.getUsername())
                .eq(q.getStatus() != null, User::getStatus, q.getStatus())
                .orderByDesc(User::getId);
        Page<User> result = repository.selectPage(new Page<>(q.getPage(), q.getPageSize()), wrapper);
        return PageResult.of(
                result.getRecords().stream().map(UserResponse::from).toList(),
                result.getTotal(), q.getPage(), q.getPageSize());
    }
}''', when={'persistence': ['mybatisplus']}),
        V(r'''package com.example.user.service;

import com.example.common.ErrorCode;
import com.example.common.PageResult;
import com.example.common.exception.BizException;
import com.example.user.domain.User;
import com.example.user.dto.CreateUserRequest;
import com.example.user.dto.UserQuery;
import com.example.user.dto.UserResponse;
import com.example.user.exception.UserNotFoundException;
import com.example.user.repository.UserRepository;
import jakarta.persistence.criteria.Predicate;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;

/**
 * 业务层。事务边界在这一层：@Transactional 只写在 public 方法上，
 * 查询方法标 readOnly。
 *
 * 动态查询用 Specification 而不是拼方法名 —— 方法名拼到第三个条件
 * 就没人读得懂了。
 */
@Service
public class UserService {

    private final UserRepository repository;

    public UserService(UserRepository repository) {
        this.repository = repository;
    }

    @Transactional
    public Long create(CreateUserRequest req) {
        if (repository.findByUsername(req.username()).isPresent()) {
            throw new BizException(ErrorCode.USERNAME_DUPLICATED);
        }
        User user = new User();
        user.setUsername(req.username());
        user.setMobile(req.mobile());
        user.setDeleted(0);
        // createTime / updateTime 由 JpaAuditConfig 的审计填充，不手写
        return repository.save(user).getId();
    }

    @Transactional(readOnly = true)
    public UserResponse getById(Long id) {
        return repository.findById(id).map(UserResponse::from)
                .orElseThrow(() -> new UserNotFoundException(id));
    }

    @Transactional(readOnly = true)
    public PageResult<UserResponse> page(UserQuery q) {
        Specification<User> spec = (root, query, cb) -> {
            List<Predicate> ps = new ArrayList<>();
            if (q.getUsername() != null && !q.getUsername().isBlank()) {
                ps.add(cb.like(root.get("username"), "%" + q.getUsername() + "%"));
            }
            if (q.getStatus() != null) {
                ps.add(cb.equal(root.get("status"), q.getStatus()));
            }
            return cb.and(ps.toArray(new Predicate[0]));
        };
        Page<User> page = repository.findAll(spec, PageRequest.of(
                (int) (q.getPage() - 1), (int) q.getPageSize(),
                Sort.by(Sort.Direction.DESC, "id")));
        return PageResult.of(
                page.getContent().stream().map(UserResponse::from).toList(),
                page.getTotalElements(), q.getPage(), q.getPageSize());
    }
}''', when={'persistence': ['jpa']}),
      ]),
    S('src/main/java/com/example/user/exception/UserNotFoundException.java', '源码',
      '领域内业务异常。继承 BizException，错误码由本领域负责。', [
        V(r'''package com.example.user.exception;

import com.example.common.ErrorCode;
import com.example.common.exception.BizException;

/**
 * 领域内业务异常。继承 BizException，错误码由本领域负责 ——
 * 别用通用的 NOT_FOUND 糊弄：用户不存在和订单不存在是两码事，监控要分开数。
 */
public class UserNotFoundException extends BizException {

    public UserNotFoundException(Long id) {
        super(ErrorCode.NOT_FOUND, "用户不存在: id=" + id);
    }
}'''),
      ]),
    S('src/main/resources/mapper/UserMapper.xml', '数据',
      '复杂 SQL 的落点。简单增删改查用注解就够，不必都往这里搬。', [
        V(r'''<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
        "http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<!--
  复杂 SQL 的落点。namespace 必须与 Mapper 接口全限定名一字不差。
  这里只放 Wrapper 拼不出来或拼出来不可读的 SQL —— 简单 CRUD 留给 BaseMapper。
-->
<mapper namespace="com.example.user.repository.UserRepository">

    <resultMap id="userMap" type="com.example.user.domain.User">
        <id column="id" property="id"/>
        <result column="username" property="username"/>
        <result column="mobile" property="mobile"/>
        <result column="status" property="status"/>
        <result column="create_time" property="createTime"/>
        <result column="update_time" property="updateTime"/>
        <result column="deleted" property="deleted"/>
    </resultMap>

    <!-- 示例：BaseMapper 与 Wrapper 都不擅长的报表型查询写在这里 -->
    <select id="selectWithStats" resultMap="userMap">
        SELECT id, username, mobile, status, create_time, update_time, deleted
        FROM user
        WHERE deleted = 0
        ORDER BY id DESC
        LIMIT #{limit}
    </select>

</mapper>''', when={'persistence': ['mybatisplus']}),
      ]),

    # ── job：定时任务 ──────────────────────────────────────
    S('src/main/java/com/example/job/UserSyncJob.java', '源码',
      '任务类。方法要短、要幂等、要可重入 —— 超时与重复触发是常态。', [
        V(r'''package com.example.job;

import com.example.user.service.UserService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * 定时任务示例。三条纪律：
 *   1. 任务只做触发，逻辑放 service —— 才能复用与单测
 *   2. 用 fixedDelay 而不是 fixedRate —— 上一轮没跑完就发下一轮，只会堆积
 *   3. 必须幂等：调度中心重试、实例重启后，同一批数据会被再处理一次
 *
 * 多实例部署时，SchedulerConfig 里的 ShedLock 保证同一时刻只有一个实例在跑。
 */
@Component
public class UserSyncJob {

    private static final Logger log = LoggerFactory.getLogger(UserSyncJob.class);

    private final UserService userService;

    public UserSyncJob(UserService userService) {
        this.userService = userService;
    }

    @Scheduled(initialDelay = 30_000, fixedDelay = 600_000)
    public void syncUsers() {
        log.info("用户同步任务开始");
        // 真实逻辑在这里调 userService 的批量同步方法；异常抛出去让调度器知道这轮失败
        log.info("用户同步任务结束");
    }
}''', when={'scheduler': ['spring']}),
        V(r'''package com.example.job;

import com.xxl.job.core.context.XxlJobHelper;
import com.xxl.job.core.handler.annotation.XxlJob;
import org.springframework.stereotype.Component;

/**
 * XXL-Job 任务示例。执行器注册在 XxlJobConfig；调度中心配置的任务名
 * 必须与 @XxlJob 的值一字不差，对不上的表现是「调度中心显示成功但什么都没跑」。
 * 任务必须幂等：调度中心的重试与失败转移会让同一批数据被处理两次。
 */
@Component
public class UserSyncJob {

    @XxlJob("userSyncJob")
    public void syncUsers() {
        XxlJobHelper.log("用户同步任务开始");
        // 真实逻辑在这里调 userService 的批量同步方法
        XxlJobHelper.handleSuccess();
    }
}''', when={'scheduler': ['xxljob']}),
      ]),

    # ── integration：外部系统的统一边界（mq 命中时）────────
    S('src/main/java/com/example/integration/MessagePublisher.java', '源码',
      '消息生产者。发送与业务写入的事务边界在这里定义清楚。', [
        V(r'''package com.example.integration;

import org.apache.rocketmq.spring.core.RocketMQTemplate;
import org.springframework.messaging.support.MessageBuilder;
import org.springframework.stereotype.Component;

/**
 * 消息生产者。所有跨系统消息只从这一层出去。
 *
 * 发送与业务写入的事务边界必须在这里想清楚：先落库再发消息可能丢消息，
 * 先发消息再落库可能多消息 —— 真正要强一致的写操作用事务消息或本地消息表，
 * 不要靠顺序凑合。
 */
@Component
public class MessagePublisher {

    private final RocketMQTemplate template;

    public MessagePublisher(RocketMQTemplate template) {
        this.template = template;
    }

    public void send(String topic, Object payload) {
        template.convertAndSend(topic, MessageBuilder.withPayload(payload).build());
    }
}''', when={'mq': ['rocketmq']}),
        V(r'''package com.example.integration;

import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;

/**
 * 消息生产者。所有跨系统消息只从这一层出去。
 *
 * RabbitMQ 的投递保证分两段：publisher confirm（到交换机）与
 * 消息持久化（到队列）。只配其一都会在某个故障点丢消息。
 */
@Component
public class MessagePublisher {

    private final RabbitTemplate template;

    public MessagePublisher(RabbitTemplate template) {
        this.template = template;
    }

    public void send(String exchange, String routingKey, Object payload) {
        template.convertAndSend(exchange, routingKey, payload);
    }
}''', when={'mq': ['rabbitmq']}),
        V(r'''package com.example.integration;

import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

/**
 * 消息生产者。所有跨系统消息只从这一层出去。
 *
 * send() 返回的是 future —— 关心结果就同步 get()（会阻塞），
 * 只管吞吐就异步回调；acks=all 与幂等生产者才是「不丢消息」的完整前提。
 */
@Component
public class MessagePublisher {

    private final KafkaTemplate<String, Object> template;

    public MessagePublisher(KafkaTemplate<String, Object> template) {
        this.template = template;
    }

    public void send(String topic, Object payload) {
        template.send(topic, payload);
    }
}''', when={'mq': ['kafka']}),
      ]),

    # ── resources：建表脚本（未引入迁移工具时）─────────────
    S('src/main/resources/db/schema.sql', '数据',
      '不引入迁移工具时的建表脚本。至少要有它，并纳入版本控制。', [
        V(r'''-- 建表脚本（未引入迁移工具）。
-- 新环境能不能一键起起来，全看这个文件与实际库结构是否同步。
-- 四条建表约定（与 Flyway 版一致，后面所有表照它抄）：
--   1. 主键统一 bigint unsigned + 自增，不用 varchar 做主键（索引膨胀且无顺序）
--   2. 每张表必带 create_time / update_time / deleted，且都有默认值
--   3. 索引命名固定：唯一索引 uk_ 前缀，普通索引 idx_ 前缀
--   4. DDL 必须幂等（IF NOT EXISTS）：本文件由 spring.sql.init 在每次启动时执行，
--      不是幂等写法第二次启动就会撞上「表已存在」直接起不来

CREATE TABLE IF NOT EXISTS `user`
(
    `id`          bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
    `username`    varchar(64)     NOT NULL COMMENT '用户名',
    `mobile`      varchar(20)              DEFAULT NULL COMMENT '手机号',
    `status`      tinyint         NOT NULL DEFAULT 0 COMMENT '状态：0正常 1停用',
    `create_time` datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time` datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`     tinyint         NOT NULL DEFAULT 0 COMMENT '逻辑删除：0未删 1已删',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_username` (`username`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_general_ci COMMENT ='用户表';

CREATE TABLE IF NOT EXISTS `example_order`
(
    `id`          bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
    `order_no`    varchar(32)     NOT NULL COMMENT '业务单号，对外唯一标识',
    `amount`      decimal(18, 2)  NOT NULL DEFAULT 0.00 COMMENT '金额。钱一律用 decimal，不用 double',
    `status`      tinyint         NOT NULL DEFAULT 0 COMMENT '状态：0待处理 1处理中 2已完成 3已取消',
    `remark`      varchar(255)             DEFAULT NULL COMMENT '备注',
    `create_time` datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time` datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    `deleted`     tinyint         NOT NULL DEFAULT 0 COMMENT '逻辑删除：0未删 1已删',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_order_no` (`order_no`),
    KEY `idx_status_create_time` (`status`, `create_time`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_general_ci COMMENT ='示例订单表';''', when={'migration': ['none']}),
      ]),

    # ── test：Service 单测 / 接口切片测试 ──────────────────
    S('src/test/java/com/example/user/service/UserServiceTest.java', '测试',
      'Service 单元测试。Mock 掉外部依赖，只测业务分支。', [
        V(r'''package com.example.user.service;

import com.example.common.ErrorCode;
import com.example.common.exception.BizException;
import com.example.user.domain.User;
import com.example.user.dto.CreateUserRequest;
import com.example.user.repository.UserDao;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Service 单元测试。Mock 掉数据访问层，只测业务分支 ——
 * 毫秒级速度，覆盖的是「重复用户名必须被拒绝」这类规则。
 */
@ExtendWith(MockitoExtension.class)
class UserServiceTest {

    @Mock
    private UserDao dao;

    @InjectMocks
    private UserService service;

    @Test
    void createRejectsDuplicatedUsername() {
        when(dao.findByUsername("dup")).thenReturn(Optional.of(new User()));

        var e = assertThrows(BizException.class,
                () -> service.create(new CreateUserRequest("dup", "13800138000")));
        assertEquals(ErrorCode.USERNAME_DUPLICATED, e.getErrorCode());
    }

    @Test
    void createInsertsNewUser() {
        when(dao.findByUsername("fresh")).thenReturn(Optional.empty());
        when(dao.insert(any(User.class))).thenReturn(1L);

        Long id = service.create(new CreateUserRequest("fresh", "13800138000"));
        assertEquals(1L, id);
        verify(dao).insert(any(User.class));
    }
}''', when={'test': ['mockito'], 'persistence': ['jdbc']}),
        V(r'''package com.example.user.service;

import com.example.common.ErrorCode;
import com.example.common.exception.BizException;
import com.example.user.domain.User;
import com.example.user.dto.CreateUserRequest;
import com.example.user.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;

/**
 * Service 单元测试。Mock 掉 Mapper 层，只测业务分支。
 * insert 用 doAnswer 模拟「数据库回填自增主键」—— 真实插入时
 * BaseMapper 会把生成的 id 写回实体，Mock 里自己演一遍。
 */
@ExtendWith(MockitoExtension.class)
class UserServiceTest {

    @Mock
    private UserRepository repository;

    @InjectMocks
    private UserService service;

    @Test
    void createRejectsDuplicatedUsername() {
        when(repository.selectCount(any())).thenReturn(1L);

        var e = assertThrows(BizException.class,
                () -> service.create(new CreateUserRequest("dup", "13800138000")));
        assertEquals(ErrorCode.USERNAME_DUPLICATED, e.getErrorCode());
    }

    @Test
    void createInsertsNewUser() {
        when(repository.selectCount(any())).thenReturn(0L);
        doAnswer(inv -> {
            User u = inv.getArgument(0);
            u.setId(9L);
            return 1;
        }).when(repository).insert(any(User.class));

        Long id = service.create(new CreateUserRequest("fresh", "13800138000"));
        assertEquals(9L, id);
    }
}''', when={'test': ['mockito'], 'persistence': ['mybatisplus']}),
        V(r'''package com.example.user.service;

import com.example.common.ErrorCode;
import com.example.common.exception.BizException;
import com.example.user.domain.User;
import com.example.user.dto.CreateUserRequest;
import com.example.user.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * Service 单元测试。Mock 掉 Repository，只测业务分支。
 * save 用 thenAnswer 模拟「数据库回填自增主键」—— 真实插入时
 * JPA 会把生成的 id 写回实体，Mock 里自己演一遍。
 */
@ExtendWith(MockitoExtension.class)
class UserServiceTest {

    @Mock
    private UserRepository repository;

    @InjectMocks
    private UserService service;

    @Test
    void createRejectsDuplicatedUsername() {
        when(repository.findByUsername("dup")).thenReturn(Optional.of(new User()));

        var e = assertThrows(BizException.class,
                () -> service.create(new CreateUserRequest("dup", "13800138000")));
        assertEquals(ErrorCode.USERNAME_DUPLICATED, e.getErrorCode());
    }

    @Test
    void createInsertsNewUser() {
        when(repository.findByUsername("fresh")).thenReturn(Optional.empty());
        when(repository.save(any(User.class))).thenAnswer(inv -> {
            User u = inv.getArgument(0);
            u.setId(9L);
            return u;
        });

        Long id = service.create(new CreateUserRequest("fresh", "13800138000"));
        assertEquals(9L, id);
    }
}''', when={'test': ['mockito'], 'persistence': ['jpa']}),
        V(r'''package com.example.user.service;

import com.example.user.dto.CreateUserRequest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * 真库集成测试：用 Testcontainers 起一个真 MySQL，走完整的插入与查询。
 * 代价是必须有 Docker —— CI 上没有 Docker 这个测试就会红，这是明示的取舍。
 */
@SpringBootTest
@Testcontainers
class UserServiceTest {

    @Container
    private static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0");

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
        registry.add("spring.datasource.username", MYSQL::getUsername);
        registry.add("spring.datasource.password", MYSQL::getPassword);
    }

    @Autowired
    private UserService userService;

    @Test
    void createAndGet() {
        Long id = userService.create(new CreateUserRequest("boot-user", "13800138000"));
        var resp = userService.getById(id);
        assertEquals("boot-user", resp.username());
    }
}''', when={'test': ['testcontainers']}),
      ]),
    S('src/test/java/com/example/user/controller/UserControllerTest.java', '测试',
      '接口切片测试。只加载 Web 层，验证参数校验与响应码。', [
        # 变体按声明顺序命中：选了内置鉴权（securityjwt/satoken）才有 AuthInterceptor 可 Mock；
        # auth=custom 的鉴权代码由用户自己实现，切片测试不引用它 —— 否则测试编译不过。
        V(r'''package com.example.user.controller;

import com.example.interceptor.AuthInterceptor;
import com.example.interceptor.TraceIdInterceptor;
import com.example.user.dto.CreateUserRequest;
import com.example.user.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 接口切片测试。只加载 Web 层（服务是 Mock 的），验证参数校验与响应码。
 *
 * addFilters = false 关掉安全过滤链；两个拦截器 Mock 放行 ——
 * 切片测试只关心 Web 层自己的行为，鉴权链路有专门的测试。
 */
@WebMvcTest(UserController.class)
@AutoConfigureMockMvc(addFilters = false)
class UserControllerTest {

    @Autowired
    private MockMvc mvc;

    @MockBean
    private UserService service;

    @MockBean
    private TraceIdInterceptor traceIdInterceptor;

    @MockBean
    private AuthInterceptor authInterceptor;

    @BeforeEach
    void openInterceptors() throws Exception {
        when(traceIdInterceptor.preHandle(any(), any(), any())).thenReturn(true);
        when(authInterceptor.preHandle(any(), any(), any())).thenReturn(true);
    }

    @Test
    void createReturnsOk() throws Exception {
        when(service.create(any(CreateUserRequest.class))).thenReturn(1L);

        mvc.perform(post("/api/users")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"tom\",\"mobile\":\"13800138000\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data").value(1));
    }

    @Test
    void createRejectsBadMobile() throws Exception {
        mvc.perform(post("/api/users")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"tom\",\"mobile\":\"123\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1001));
    }
}''', when={'test': ['mockito'], 'web': ['mvc'], 'auth': ['securityjwt', 'satoken']}),
        V(r'''package com.example.user.controller;

import com.example.interceptor.TraceIdInterceptor;
import com.example.user.dto.CreateUserRequest;
import com.example.user.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 接口切片测试。只加载 Web 层（服务是 Mock 的），验证参数校验与响应码。
 *
 * addFilters = false 关掉安全过滤链；TraceIdInterceptor Mock 放行 ——
 * 切片测试只关心 Web 层自己的行为。当前鉴权选型没有内置的
 * AuthInterceptor（custom 的鉴权代码由你自己实现），所以这里没有它可 Mock；
 * 一旦换成 securityjwt / satoken，请参照上一变体把鉴权拦截器也 Mock 掉。
 */
@WebMvcTest(UserController.class)
@AutoConfigureMockMvc(addFilters = false)
class UserControllerTest {

    @Autowired
    private MockMvc mvc;

    @MockBean
    private UserService service;

    @MockBean
    private TraceIdInterceptor traceIdInterceptor;

    @BeforeEach
    void openInterceptors() throws Exception {
        when(traceIdInterceptor.preHandle(any(), any(), any())).thenReturn(true);
    }

    @Test
    void createReturnsOk() throws Exception {
        when(service.create(any(CreateUserRequest.class))).thenReturn(1L);

        mvc.perform(post("/api/users")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"tom\",\"mobile\":\"13800138000\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(0))
                .andExpect(jsonPath("$.data").value(1));
    }

    @Test
    void createRejectsBadMobile() throws Exception {
        mvc.perform(post("/api/users")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"tom\",\"mobile\":\"123\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.code").value(1001));
    }
}''', when={'test': ['mockito'], 'web': ['mvc'], 'auth': ['custom']}),
      ]),
]

# README 模板。占位符由前端替换 —— 用 __X__ 而非 {}，
# 因为 Java 与 YAML 片段里全是花括号，用 format 会被当成占位符炸掉。
README_TEMPLATE = '''# arsenal-demo

由「杨先生的军火库 · 架构装配台」按当前选型生成。

__SELECTION_TABLE__

## 架构图

![架构图](architecture.svg)

__ARCH_SUMMARY__

读图方式：一条横向色带是一层泳道，方块是一个槽位，方块右上角的「必需 / 建议」表示
该槽位留空时的性质；左侧竖直箭头表示请求自上而下穿过各层；层内的 `→` 是请求
真正流经的顺序；竖虚线右侧是旁路件（例如迁移工具，只在发布期起作用，请求不经过它）。
每层负责什么、每个零件的角色、当前缺口与隐患，见 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 目录结构

```
__TREE__
```

__START__

## 这套组合的隐患

__RISKS__

## 开箱即跑

导出包不是「能启动的空框架」，而是一套**能直接接着写业务的脚手架**：
统一响应体、全局异常出口、认证实现、user 领域六件套（新领域照它抄）、
日志滚动、建表脚本全部就位。把数据库连上、`mvn spring-boot:run` 起来后，
`GET /api/users/1` 返回的就是统一外壳 —— 前端只需要解析这一种结构。

__DANGLING__

## 交付清单

__FILES__
'''

README_START_MANUAL = '''## 本地启动

```bash
# 1. 准备数据库：连接信息已默认指向本机（127.0.0.1:3306，库名与项目同名，root/空密码）。
#    只需要把库建出来。最快的办法：
docker run -d --name demo-mysql -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=app -p 3306:3306 mysql:8.0.36
#    （库名默认 app，想改名用环境变量 DB_NAME 覆盖；账号密码同理 DB_USERNAME / DB_PASSWORD）

# 2. 启动（不需要 export 任何变量；没装 docker 就用自己的 MySQL 建同名库）
mvn spring-boot:run

# 3. 验证：容器起来了不算成功，能返回数据才算
curl -s localhost:8080/actuator/health
```

启动失败三步排查（按命中率排序）：
1. **数据库连不上**：MySQL 没起、端口不通。`docker ps` 或 `mysql -h127.0.0.1 -uroot -p` 先确认。
2. **账号密码不对**：默认 root/空密码只对本机 root 免密成立；不是就用 DB_USERNAME / DB_PASSWORD 覆盖。
3. **端口被占**：8080 被别的进程占了，`SERVER_PORT=9090 mvn spring-boot:run` 换端口。'''

README_START_GRADLE = '''## 本地启动

```bash
# 连接信息默认指向本机（127.0.0.1:3306，库名与项目同名，root/空密码），建库即可：
docker run -d --name demo-mysql -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=app -p 3306:3306 mysql:8.0.36

./gradlew bootRun
curl -s localhost:8080/actuator/health
```

启动失败三步排查：数据库没起（docker ps / mysql 先探活）→ 账号密码不对（DB_USERNAME / DB_PASSWORD 覆盖）→ 端口被占（SERVER_PORT 换端口）。'''

# 结构原则：写在结构图页签下方，解释「为什么这样分包」
#
# rule 字段只在军火库规则集里真有对应条目时才写。没有对应规则的照实留空 ——
# 挂一个不存在的规则 id 比不挂更糟：它会让人以为这条已经有规则守着。
# 目前 4 条里有 2 条确实是规则集的覆盖缺口，已记录在案。
STRUCTURE_NOTES = [
    {
        'title': '按领域分包，不按层分包',
        'text': '顶层是业务领域（user、order、article），领域内部才分 controller / service / repository。'
                '按层分包（所有 controller 一个包）在项目长到十几个领域后会先崩：改一个功能要跨五个包找文件。',
        'rule': None,
    },
    {
        'title': '根包只放启动类',
        'text': '@SpringBootApplication 的扫描范围是「本类所在包及其子包」。启动类放错位置，'
                'Bean 扫不到的报错会指向一个与真实原因无关的地方。',
        'rule': 'SKEL-STRC-002',
    },
    {
        'title': 'config 是唯一允许出现 @Bean 的地方',
        'text': '业务类里写 @Bean 会让「这个对象是谁创建的」变得无法回答 —— '
                '调试时看到注入的是代理对象，却找不到定义处。',
        'rule': None,
    },
    {
        'title': 'common 只被依赖，不反向依赖业务',
        'text': 'common 一旦 import 了 user 包里的类，就说明这个类放错位置了。'
                '这条边界失守后，common 会逐渐变成第二个「什么都有」的包。',
        'rule': None,
    },
]

# 结构图的图例说明
STRUCTURE_LEGEND = [
    {'tone': 'dir', 'text': '目录：职责写在右侧，不列文件清单'},
    {'tone': 'file', 'text': '文件：带来源徽章的，说明它是哪个选型带来的'},
    {'tone': 'badge', 'text': '徽章：换掉这个选型，这一块（连同文件）会整体消失'},
]
