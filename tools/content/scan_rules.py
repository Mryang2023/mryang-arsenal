# -*- coding: utf-8 -*-
"""代码扫描的「技术栈归一化」映射表。

为什么它是数据而不是代码：
    扫描器读到的东西是**别人的坐标**（`org.springframework.boot:spring-boot-starter-web`），
    架构图认识的是**我们的词**（`web: mvc`、`mysql`）。这层翻译如果散在 Java 的 if-else 里，
    加一个中间件要改代码、改完还没有任何地方报错。写成数据之后，两张表对不对得上
    由 sync-content.mjs 的闸门守（dim/opt 必须在 architecture.json 里真存在）。

三条硬规矩：
    ① 匹配只按坐标（group + artifact），artifact 支持 `*` 通配；
       **不按文件名猜、不按包名猜** —— 猜出来的技术栈会画进交付图，那是最坏的一类错。
    ② 每条命中必须带 evidence（文件路径 + 行号）。这条由扫描器保证，但**没有映射就没有命中**，
       所以未命中的依赖一律进 `UNMAPPED_DEPENDENCY` note，不静默丢弃。
    ③ 没画在架构图上的东西（`dim` 为空）也要登记：它有 `tech`，页面会当「识别到但未上图的组件」列出来，
       并且 `icon` 指向 tech-icons.ts 里真实存在的 key。

kind 取值：maven | gradle | npm
"""

# 九大类沿用 arsenal-rules 的分类，只为页面分组，不参与判定
KIND_LABEL = {
    'maven': 'Maven 依赖',
    'gradle': 'Gradle 依赖',
    'npm': '前端依赖',
}

RULES = [
    # ── Web / 运行时 ──────────────────────────────────────────────
    dict(kind='maven', group='org.springframework.boot', artifact='spring-boot-starter-web',
         tech='spring', icon='spring', dim='web', opt='mvc', name='Spring MVC'),
    dict(kind='maven', group='org.springframework.boot', artifact='spring-boot-starter-webflux',
         tech='webflux', icon='webflux', dim='web', opt='webflux', name='Spring WebFlux'),
    dict(kind='maven', group='org.springframework.boot', artifact='spring-boot-starter-websocket',
         tech='websocket', name='WebSocket'),
    dict(kind='maven', group='org.springframework.boot', artifact='spring-boot-starter-thymeleaf',
         tech='thymeleaf', name='Thymeleaf'),
    dict(kind='maven', group='org.springframework.boot', artifact='spring-boot-starter-freemarker',
         tech='freemarker', name='FreeMarker'),
    dict(kind='maven', group='org.springframework.boot', artifact='spring-boot-starter-validation',
         tech='validation', name='Bean Validation'),
    dict(kind='maven', group='org.springframework.boot', artifact='spring-boot-starter-mail',
         tech='mail', name='JavaMail'),
    dict(kind='maven', group='org.springframework.boot', artifact='spring-boot-starter-cache',
         tech='springcache', name='Spring Cache 抽象'),
    dict(kind='maven', group='org.springframework.boot', artifact='spring-boot-starter-batch',
         tech='batch', name='Spring Batch'),
    dict(kind='maven', group='io.netty', artifact='*', tech='netty', icon='netty', name='Netty'),
    dict(kind='maven', group='org.apache.tomcat.embed', artifact='*', tech='tomcat', icon='tomcat', name='Tomcat'),
    dict(kind='maven', group='io.undertow', artifact='*', tech='undertow', name='Undertow'),

    # ── 持久层 ───────────────────────────────────────────────────
    dict(kind='maven', group='org.springframework.boot', artifact='spring-boot-starter-data-jpa',
         tech='jpa', icon='jpa', dim='persistence', opt='jpa', name='Spring Data JPA'),
    dict(kind='maven', group='org.springframework.boot', artifact='spring-boot-starter-jdbc',
         tech='jdbc', icon='jdbc', dim='persistence', opt='jdbc', name='Spring JDBC'),
    dict(kind='maven', group='com.baomidou', artifact='mybatis-plus-boot-starter',
         tech='mybatisplus', icon='mybatis', dim='persistence', opt='mybatisplus', name='MyBatis-Plus'),
    dict(kind='maven', group='org.mybatis.spring.boot', artifact='*',
         tech='mybatis', icon='mybatis', dim='persistence', opt='mybatisplus', name='MyBatis'),
    dict(kind='maven', group='org.mybatis', artifact='*', tech='mybatis', icon='mybatis', name='MyBatis 内核'),
    dict(kind='maven', group='org.hibernate.orm', artifact='*', tech='hibernate', icon='jpa', name='Hibernate'),
    dict(kind='maven', group='com.github.pagehelper', artifact='*', tech='pagehelper', name='PageHelper'),
    dict(kind='maven', group='com.zaxxer', artifact='HikariCP',
         tech='hikari', icon='hikari', dim='pool', opt='hikari', name='HikariCP'),
    dict(kind='maven', group='com.alibaba', artifact='druid-spring-boot-starter',
         tech='druid', icon='druid', dim='pool', opt='druid', name='Druid'),
    dict(kind='maven', group='com.alibaba', artifact='druid', tech='druid', icon='druid', name='Druid'),
    dict(kind='maven', group='org.flywaydb', artifact='*',
         tech='flyway', icon='flyway', dim='migration', opt='flyway', name='Flyway'),
    dict(kind='maven', group='org.liquibase', artifact='*',
         tech='liquibase', icon='liquibase', dim='migration', opt='liquibase', name='Liquibase'),

    # ── 数据库 ───────────────────────────────────────────────────
    dict(kind='maven', group='com.mysql', artifact='*',
         tech='mysql', icon='mysql', dim='database', opt='mysql', name='MySQL'),
    dict(kind='maven', group='mysql', artifact='*', tech='mysql', icon='mysql', name='MySQL（旧坐标）'),
    dict(kind='maven', group='org.postgresql', artifact='*',
         tech='postgres', icon='postgres', dim='database', opt='postgres', name='PostgreSQL'),
    dict(kind='maven', group='com.oracle.database.jdbc', artifact='*',
         tech='oracle', icon='oracle', name='Oracle'),
    dict(kind='maven', group='org.springframework.boot', artifact='spring-boot-starter-data-mongodb',
         tech='mongodb', icon='mongodb', name='MongoDB'),
    dict(kind='maven', group='com.clickhouse', artifact='*',
         tech='clickhouse', icon='clickhouse', dim='analytics', opt='clickhouse', name='ClickHouse'),
    dict(kind='maven', group='org.apache.shardingsphere', artifact='*',
         tech='shardingsphere', name='ShardingSphere'),
    dict(kind='maven', group='com.baomidou', artifact='dynamic-datasource-spring-boot-starter',
         tech='dynamicdatasource', name='动态数据源'),

    # ── 缓存 ─────────────────────────────────────────────────────
    dict(kind='maven', group='org.springframework.boot', artifact='spring-boot-starter-data-redis',
         tech='redis', icon='redis', dim='cache', opt='redis', name='Redis'),
    dict(kind='maven', group='org.redisson', artifact='*', tech='redisson', icon='redis', name='Redisson'),
    dict(kind='maven', group='redis.clients', artifact='*', tech='jedis', icon='redis', name='Jedis / Lettuce'),
    dict(kind='maven', group='com.github.ben-manes.caffeine', artifact='*',
         tech='caffeine', icon='caffeine', dim='cache', opt='caffeine', name='Caffeine 本地缓存'),
    dict(kind='maven', group='net.spy', artifact='*', tech='memcached', icon='memcached', name='Memcached'),

    # ── 消息 ─────────────────────────────────────────────────────
    dict(kind='maven', group='org.springframework.kafka', artifact='*',
         tech='kafka', icon='kafka', dim='mq', opt='kafka', name='Kafka'),
    dict(kind='maven', group='org.apache.kafka', artifact='*',
         tech='kafka', icon='kafka', dim='mq', opt='kafka', name='Kafka 客户端'),
    dict(kind='maven', group='org.apache.rocketmq', artifact='*',
         tech='rocketmq', icon='rocketmq', dim='mq', opt='rocketmq', name='RocketMQ'),
    dict(kind='maven', group='org.springframework.boot', artifact='spring-boot-starter-amqp',
         tech='rabbitmq', icon='rabbitmq', dim='mq', opt='rabbitmq', name='RabbitMQ'),
    dict(kind='maven', group='org.apache.pulsar', artifact='*',
         tech='pulsar', icon='pulsar', name='Pulsar'),

    # ── 注册中心 / 治理 / 网关 ────────────────────────────────────
    dict(kind='maven', group='com.alibaba.cloud', artifact='spring-cloud-starter-alibaba-nacos-discovery',
         tech='nacos', icon='nacos', dim='registry', opt='nacos', name='Nacos 注册中心'),
    dict(kind='maven', group='com.alibaba.cloud', artifact='spring-cloud-starter-alibaba-nacos-config',
         tech='nacos', icon='nacos', dim='secret', opt='configcenter', name='Nacos 配置中心'),
    dict(kind='maven', group='com.alibaba.cloud', artifact='spring-cloud-starter-alibaba-sentinel',
         tech='sentinel', icon='sentinel', name='Sentinel 流控'),
    dict(kind='maven', group='org.springframework.cloud', artifact='spring-cloud-starter-gateway',
         tech='gateway', icon='gateway', dim='gateway', opt='scg', name='Spring Cloud Gateway'),
    dict(kind='maven', group='org.springframework.cloud', artifact='spring-cloud-starter-openfeign',
         tech='openfeign', icon='spring', name='OpenFeign'),
    dict(kind='maven', group='org.springframework.cloud', artifact='spring-cloud-starter-loadbalancer',
         tech='loadbalancer', name='Spring Cloud LoadBalancer'),
    dict(kind='maven', group='org.apache.dubbo', artifact='*', tech='dubbo', name='Dubbo'),
    dict(kind='maven', group='org.apache.zookeeper', artifact='*',
         tech='zookeeper', icon='zookeeper', name='ZooKeeper'),
    dict(kind='maven', group='org.apache.curator', artifact='*', tech='curator', icon='zookeeper', name='Curator'),
    dict(kind='maven', group='org.springframework.cloud', artifact='spring-cloud-starter-consul-discovery',
         tech='consul', icon='consul', name='Consul'),

    # ── 安全 / 认证 ──────────────────────────────────────────────
    dict(kind='maven', group='org.springframework.boot', artifact='spring-boot-starter-security',
         tech='security', icon='security', dim='auth', opt='securityjwt', name='Spring Security'),
    dict(kind='maven', group='org.springframework.boot', artifact='spring-boot-starter-oauth2-resource-server',
         tech='oauth2', icon='security', name='OAuth2 资源服务'),
    dict(kind='maven', group='cn.dev33', artifact='*',
         tech='satoken', icon='satoken', dim='auth', opt='satoken', name='Sa-Token'),
    dict(kind='maven', group='io.jsonwebtoken', artifact='*', tech='jwt', icon='jwt', name='JJWT'),
    dict(kind='maven', group='com.auth0', artifact='java-jwt', tech='jwt', icon='jwt', name='Auth0 JWT'),

    # ── 接口文档 ─────────────────────────────────────────────────
    dict(kind='maven', group='org.springdoc', artifact='*',
         tech='springdoc', icon='springdoc', dim='apidoc', opt='springdoc', name='SpringDoc / OpenAPI'),
    dict(kind='maven', group='com.github.xiaoymin', artifact='*',
         tech='knife4j', icon='knife4j', dim='apidoc', opt='knife4j', name='Knife4j'),
    dict(kind='maven', group='io.swagger.core.v3', artifact='*', tech='swagger', icon='springdoc', name='Swagger'),

    # ── 观测与日志 ───────────────────────────────────────────────
    dict(kind='maven', group='org.springframework.boot', artifact='spring-boot-starter-actuator',
         tech='actuator', icon='actuator', dim='observability', opt='actuator', name='Actuator'),
    dict(kind='maven', group='io.micrometer', artifact='*',
         tech='prometheus', icon='prometheus', dim='observability', opt='prometheus', name='Micrometer / Prometheus'),
    dict(kind='maven', group='ch.qos.logback', artifact='*',
         tech='logback', icon='logback', dim='logging', opt='logback', name='Logback'),
    dict(kind='maven', group='net.logstash.logback', artifact='*',
         tech='elk', icon='logback', dim='logging', opt='elk', name='Logstash Encoder'),
    dict(kind='maven', group='org.apache.skywalking', artifact='*',
         tech='skywalking', icon='grafana', dim='monitoring', opt='skywalking', name='SkyWalking'),

    # ── 检索 / 对象存储 ──────────────────────────────────────────
    dict(kind='maven', group='org.springframework.boot', artifact='spring-boot-starter-data-elasticsearch',
         tech='elasticsearch', icon='elasticsearch', dim='search', opt='es', name='Elasticsearch'),
    dict(kind='maven', group='co.elastic.clients', artifact='*',
         tech='elasticsearch', icon='elasticsearch', dim='search', opt='es', name='ES Java Client'),
    dict(kind='maven', group='org.elasticsearch.client', artifact='*',
         tech='elasticsearch', icon='elasticsearch', dim='search', opt='es', name='ES REST Client'),
    dict(kind='maven', group='io.minio', artifact='*',
         tech='minio', icon='minio', dim='objectstore', opt='minio', name='MinIO'),
    dict(kind='maven', group='com.aliyun.oss', artifact='*',
         tech='oss', icon='minio', dim='objectstore', opt='oss', name='阿里云 OSS'),
    dict(kind='maven', group='software.amazon.awssdk', artifact='s3',
         tech='s3', icon='minio', dim='objectstore', opt='s3', name='AWS S3'),

    # ── 调度 ─────────────────────────────────────────────────────
    dict(kind='maven', group='com.xuxueli', artifact='*',
         tech='xxljob', icon='xxljob', dim='scheduler', opt='xxljob', name='XXL-Job'),
    dict(kind='maven', group='org.springframework.boot', artifact='spring-boot-starter-quartz',
         tech='quartz', icon='scheduler', dim='scheduler', opt='spring', name='Quartz'),
    dict(kind='maven', group='org.quartz-scheduler', artifact='*',
         tech='quartz', icon='scheduler', name='Quartz 内核'),

    # ── 编码期 / 测试 ────────────────────────────────────────────
    dict(kind='maven', group='org.projectlombok', artifact='*',
         tech='lombok', icon='lombok', dim='boilerplate', opt='lombok', name='Lombok'),
    dict(kind='maven', group='org.mapstruct', artifact='*',
         tech='mapstruct', icon='mapstruct', dim='mapping', opt='mapstruct', name='MapStruct'),
    dict(kind='maven', group='org.springframework.boot', artifact='spring-boot-starter-test',
         tech='junit5', icon='junit', dim='testing', opt='junit5', name='Spring Boot Test'),
    dict(kind='maven', group='org.junit.jupiter', artifact='*',
         tech='junit5', icon='junit', dim='testing', opt='junit5', name='JUnit 5'),
    dict(kind='maven', group='org.testcontainers', artifact='*',
         tech='testcontainers', icon='testcontainers', dim='testing', opt='testcontainers', name='Testcontainers'),
    dict(kind='maven', group='org.mockito', artifact='*',
         tech='mockito', icon='junit', dim='testing', opt='mockito', name='Mockito'),
    dict(kind='maven', group='com.github.tomakehurst', artifact='*',
         tech='wiremock', icon='junit', dim='testing', opt='wiremock', name='WireMock'),
    dict(kind='maven', group='org.jacoco', artifact='*',
         tech='jacoco', icon='junit', dim='qualitygate', opt='jacoco', name='JaCoCo'),

    # ── 常用工具库（不上架构图的节点位，但要认得出来）────────────
    dict(kind='maven', group='com.fasterxml.jackson.core', artifact='*', tech='jackson', name='Jackson'),
    dict(kind='maven', group='com.alibaba.fastjson2', artifact='*', tech='fastjson', name='FastJSON2'),
    dict(kind='maven', group='com.alibaba', artifact='fastjson', tech='fastjson', name='FastJSON'),
    dict(kind='maven', group='cn.hutool', artifact='*', tech='hutool', name='Hutool'),
    dict(kind='maven', group='com.google.guava', artifact='*', tech='guava', name='Guava'),
    dict(kind='maven', group='org.apache.commons', artifact='commons-lang3', tech='commons', name='Commons Lang'),
    dict(kind='maven', group='org.apache.poi', artifact='*', tech='poi', name='Apache POI'),
    dict(kind='maven', group='com.alibaba', artifact='easyexcel', tech='easyexcel', name='EasyExcel'),
    dict(kind='maven', group='org.yaml', artifact='snakeyaml', tech='snakeyaml', name='SnakeYAML'),
    dict(kind='maven', group='org.bouncycastle', artifact='*', tech='bouncycastle', name='BouncyCastle'),
    dict(kind='maven', group='com.github.ulisesbocchio', artifact='*', tech='jasypt', name='Jasypt 加密配置'),
    dict(kind='maven', group='io.grpc', artifact='*', tech='grpc', name='gRPC'),
    dict(kind='maven', group='com.google.protobuf', artifact='*', tech='protobuf', name='Protobuf'),

    # ── 前端依赖 ─────────────────────────────────────────────────
    dict(kind='npm', group='npm', artifact='next', tech='next', name='Next.js'),
    dict(kind='npm', group='npm', artifact='react', tech='react', name='React'),
    dict(kind='npm', group='npm', artifact='react-dom', tech='react', name='React DOM'),
    dict(kind='npm', group='npm', artifact='vue', tech='vue', name='Vue'),
    dict(kind='npm', group='npm', artifact='pinia', tech='pinia', name='Pinia'),
    dict(kind='npm', group='npm', artifact='vuex', tech='vuex', name='Vuex'),
    dict(kind='npm', group='npm', artifact='antd', tech='antd', name='Ant Design'),
    dict(kind='npm', group='npm', artifact='element-plus', tech='elementplus', name='Element Plus'),
    dict(kind='npm', group='npm', artifact='axios', tech='axios', name='Axios'),
    dict(kind='npm', group='npm', artifact='tailwindcss', tech='tailwind', name='Tailwind CSS'),
    dict(kind='npm', group='npm', artifact='typescript', tech='typescript', name='TypeScript'),
    dict(kind='npm', group='npm', artifact='vite', tech='vite', name='Vite'),
    dict(kind='npm', group='npm', artifact='echarts', tech='echarts', name='ECharts'),
]
