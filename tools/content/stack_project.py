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
                    F('service/UserService.java', '业务层。事务边界在这一层，@Transactional 只写在 public 方法上'),
                    F('repository/UserRepository.java', '数据访问。SQL 与 ORM 调用只出现在这里',
                      when={'persistence': ['mybatisplus', 'jpa']}),
                    F('repository/UserDao.java', '数据访问。用 JdbcTemplate 手写 SQL，SQL 与映射都在这里',
                      when={'persistence': ['jdbc']}),
                    F('domain/User.java', '实体与枚举。表结构在代码里的投影，字段与列一一对应'),
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
              badge='测试', when={'test': ['mockito', 'testcontainers']}),
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

APP_ANNOTATIONS = [
    {
        'code': '@MapperScan("com.example.**.repository")',
        'import': 'org.mybatis.spring.annotation.MapperScan',
        'comment': '扫描 Mapper 接口。也可以给每个接口加 @Mapper，但那样每新增一个都要记得加 ——'
                   '漏掉的表现是启动报 NoSuchBeanDefinitionException，且找不出是哪个接口漏了。',
        'source': '持久层 · MyBatis-Plus',
        'when': {'persistence': ['mybatisplus']},
    },
]

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

CREATE TABLE `example_order`
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

# README 模板。占位符由前端替换 —— 用 __X__ 而非 {}，
# 因为 Java 与 YAML 片段里全是花括号，用 format 会被当成占位符炸掉。
README_TEMPLATE = '''# arsenal-demo

由「杨先生的军火库 · 架构装配台」按当前选型生成。

__SELECTION_TABLE__

## 架构图

![架构图](architecture.svg)

__ARCH_SUMMARY__

读图方式：横向色带是 6 层，方块是 17 个槽位，方块右上角的「必需 / 建议」表示
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

## 上手前必须补齐的类

导出包只包含「结构与配置」层面的文件，不含业务代码 —— 业务代码每个项目都不一样。
下面这些类被配置类引用了，但不在导出包里，需要自己实现或从案例库复制：

__DANGLING__

## 交付清单

__FILES__
'''

README_START_MANUAL = '''## 本地启动

```bash
# 1. 准备数据库（先建库，表结构交给迁移工具）
#    建好之后把连接信息写进环境变量，不要写进 application.yml
export DB_URL='jdbc:mysql://127.0.0.1:3306/arsenal_demo?useSSL=false&serverTimezone=Asia/Shanghai'
export DB_USERNAME=root
export DB_PASSWORD=******

# 2. 启动
mvn spring-boot:run

# 3. 验证：容器起来了不算成功，能返回数据才算
curl -s localhost:8080/actuator/health
```

启动类跑不起来时，先看这一条：**数据库连不上**占了启动失败的大半。'''

README_START_GRADLE = '''## 本地启动

```bash
export DB_URL='jdbc:mysql://127.0.0.1:3306/arsenal_demo?useSSL=false&serverTimezone=Asia/Shanghai'
export DB_USERNAME=root
export DB_PASSWORD=******

./gradlew bootRun
curl -s localhost:8080/actuator/health
```

启动类跑不起来时，先看这一条：**数据库连不上**占了启动失败的大半。'''

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
