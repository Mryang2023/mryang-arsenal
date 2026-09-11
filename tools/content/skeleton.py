# -*- coding: utf-8 -*-
"""蓝图 04：项目骨架与配置类全集。"""

APP = r"""package com.example;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * 启动类。
 *
 * 三条位置要求：
 *
 * 1. 必须放在根包（这里是 com.example），不能放在 com.example.config 之类的子包。
 *    @SpringBootApplication 隐式带上 @ComponentScan，扫描范围是「本类所在包及其子包」。
 *    放错位置的结果是：部分 Bean 扫不到，然后报一个和「包位置」毫无关系的错误，
 *    比如某个 Service 注入失败。这类问题排查成本极高。
 *
 * 2. 根包名最好等于 groupId + artifactId 的拼接（SKEL-STRC-002）。
 *    好处是包名与坐标天然一致，多人协作时不会出现「这个类该放哪个包」的争论。
 *
 * 3. 根包下只放启动类，业务代码按领域分包（见本蓝图的项目结构树）。
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class Application {

    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
"""

WEB_CONFIG = r"""package com.example.config;

import com.example.interceptor.AuthInterceptor;
import com.example.interceptor.TraceIdInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Web 层配置：跨域、拦截器链。
 *
 * 关于 CORS 的一个原则：能用网关统一配置就不要在应用里配。
 * 应用里配 CORS 的问题是每个服务都要配一遍，且极易配错 ——
 * allowedOrigins("*") 配上 allowCredentials(true) 会被浏览器直接拒绝，
 * 或者被迫放松成「允许任何来源携带凭据」，这是实打实的安全问题。
 * 这里给出的是「没有网关时的最小可用写法」。
 */
@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    private final AuthInterceptor authInterceptor;
    private final TraceIdInterceptor traceIdInterceptor;

    public WebMvcConfig(AuthInterceptor authInterceptor, TraceIdInterceptor traceIdInterceptor) {
        this.authInterceptor = authInterceptor;
        this.traceIdInterceptor = traceIdInterceptor;
    }

    /**
     * 跨域配置。
     *
     * allowedOriginPatterns 而不是 allowedOrigins("*")：后者在开启凭据时会被浏览器拒绝。
     * 生产环境务必把来源收窄成具体域名，不要用 "*"。
     */
    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns("http://localhost:3000", "https://your-domain.com")
                .allowedMethods("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true)
                .maxAge(3600);
    }

    /**
     * 拦截器顺序很重要，按注册顺序执行。
     * TraceId 必须排在鉴权之前 —— 否则鉴权失败时打出的日志没有链路 id，
     * 而那恰恰是最需要追溯的场景。
     */
    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(traceIdInterceptor).order(1).addPathPatterns("/**");
        registry.addInterceptor(authInterceptor).order(2).addPathPatterns("/api/**")
                .excludePathPatterns("/api/v1/auth/login", "/api/v1/auth/register", "/actuator/**");
    }
}
"""

JACKSON_CONFIG = r"""package com.example.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.module.SimpleModule;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import com.fasterxml.jackson.datatype.jdk8.Jdk8Module;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import com.fasterxml.jackson.datatype.jsr310.deser.LocalDateTimeDeserializer;
import com.fasterxml.jackson.datatype.jsr310.ser.LocalDateTimeSerializer;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * JSON 序列化配置。
 *
 * 每个项目都该有这样一个类，因为下面这四件事各有各的坑，而默认行为全都不对：
 *
 * 1. Long 转字符串（防前端精度丢失）
 *    Java 的 long 是 64 位，JS 的 Number 只有 53 位安全整数。
 *    雪花 id、大额流水号一旦超过 2^53，前端拿到的值和后端就不是同一个数了 ——
 *    而且是静默地变成另一个数（末尾几位被抹平），不报任何错。
 *    这类 bug 通常在上线后才被发现，因为测试数据的 id 都很小。
 *
 * 2. LocalDateTime 统一格式
 *    默认序列化成 [2026,9,11,8,0,0] 这种数组，前端解析起来极其别扭。
 *
 * 3. Jdk8Module
 *    Optional 字段必须靠它才能正确序列化 —— 没有它，PATCH 接口的
 *    三态入参会出现「字段在 JSON 里变成 {}」这种诡异结果。
 *
 * 4. 禁止日期用 Date
 *    用 java.time，Date 是可变对象且时区语义混乱。
 */
@Configuration
public class JacksonConfig {

    private static final DateTimeFormatter DATE_TIME =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    /**
     * 覆盖 Spring Boot 默认的 ObjectMapper。
     *
     * 注意：不要在各处自己 new ObjectMapper()。那样既丢掉了这份统一配置，
     * 又有线程安全隐患（配置后不可变，但很多人会忍不住往上加东西）。
     */
    @Bean
    public ObjectMapper objectMapper() {
        ObjectMapper mapper = new ObjectMapper();

        SimpleModule module = new SimpleModule();
        // Long → String：只序列化，反序列化仍接受数字与字符串两种形式
        module.addSerializer(Long.class, ToStringSerializer.instance);
        module.addSerializer(Long.TYPE, ToStringSerializer.instance);
        module.addSerializer(LocalDateTime.class, new LocalDateTimeSerializer(DATE_TIME));
        module.addDeserializer(LocalDateTime.class, new LocalDateTimeDeserializer(DATE_TIME));

        mapper.registerModule(module);
        mapper.registerModule(new JavaTimeModule());
        // PATCH 的 Optional 三态支持，没有它 Optional 会被序列化成奇怪的结构
        mapper.registerModule(new Jdk8Module());

        // 遇到未知字段直接失败，而不是静默忽略。
        // 静默忽略会让「前端字段名拼错」变成一次静默的功能失效。
        mapper.configure(
                com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,
                true);

        return mapper;
    }
}
"""

POM = r"""<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <!--
      一个标准 Spring Boot 项目的 pom 应该长什么样。

      三条纪律（SKEL-DEP-002）：
        1. 依赖 version 交给 parent BOM 管，业务依赖一律不写 <version>。
           手写版本号 = 版本冲突的源头，而且升级 Spring Boot 时它们不会跟着动。
        2. 依赖按用途分组并注释。半年后回看，注释比版本号更有价值。
        3. 不引入用不到的 starter。每多一个依赖就多一份 CVE 面、
           多一份启动扫描开销、多一个「它到底装没装」的疑问。
    -->

    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>3.2.5</version>
        <relativePath/>
    </parent>

    <groupId>com.example</groupId>
    <artifactId>arsenal-demo</artifactId>
    <version>1.0.0</version>
    <name>arsenal-demo</name>
    <description>军火库标准项目骨架</description>

    <properties>
        <java.version>17</java.version>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
        <project.reporting.outputEncoding>UTF-8</project.reporting.outputEncoding>
    </properties>

    <dependencies>
        <!-- ── Web 与校验 ─────────────────────────────────── -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <!-- 校验必须显式引入：Spring Boot 2.3 之后 validation 已从 web starter 中移出，
             漏掉它的表现是所有 @Valid 都静默失效，没有任何报错 -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-validation</artifactId>
        </dependency>

        <!-- ── 数据访问 ───────────────────────────────────── -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-jdbc</artifactId>
        </dependency>
        <dependency>
            <groupId>com.mysql</groupId>
            <artifactId>mysql-connector-j</artifactId>
            <scope>runtime</scope>
        </dependency>

        <!-- ── 安全 ───────────────────────────────────────── -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-security</artifactId>
        </dependency>

        <!-- ── 运维与文档 ─────────────────────────────────── -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-actuator</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springdoc</groupId>
            <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
            <version>2.5.0</version>
        </dependency>

        <!-- ── 重试 ───────────────────────────────────────── -->
        <dependency>
            <groupId>org.springframework.retry</groupId>
            <artifactId>spring-retry</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-aop</artifactId>
        </dependency>

        <!-- ── 测试 ───────────────────────────────────────── -->
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-test</artifactId>
            <scope>test</scope>
        </dependency>
        <dependency>
            <groupId>org.springframework.security</groupId>
            <artifactId>spring-security-test</artifactId>
            <scope>test</scope>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.springframework.boot</groupId>
                <artifactId>spring-boot-maven-plugin</artifactId>
            </plugin>
            <!-- 编译期就开启参数名保留：MyBatis 的 @Param 省略、Spring 的参数名绑定都依赖它 -->
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-compiler-plugin</artifactId>
                <configuration>
                    <parameters>true</parameters>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>
"""

YAML = r"""# ─────────────────────────────────────────────────────────────
# application.yml —— 逐行都写了「为什么」，这才是配置该有的样子。
#
# 三条纪律（SKEL-CONF-001）：
#   1. 密钥、密码、Token 一律走环境变量或配置中心，禁止写死在文件里进 Git；
#   2. 只有「所有环境都一样」的配置才放这个文件，
#      环境相关的放 application-{profile}.yml；
#   3. 每个非直觉配置项都要有注释说明为什么是这个值。
# ─────────────────────────────────────────────────────────────

server:
  port: 8080
  # 优雅停机：收到 SIGTERM 后先拒绝新请求，等在途请求处理完再退出。
  # 不开启时，一次正常发布也会让正在处理的请求直接失败。
  shutdown: graceful
  tomcat:
    # 最大连接数与线程数分开看：
    #   线程数 = 同时能处理多少请求；
    #   连接数 = 同时能保持多少 TCP 连接（含 keep-alive 空闲连接）。
    threads:
      max: 200
      min-spare: 20
    accept-count: 100
  # 请求头大小限制，默认 8KB 在带大 JWT 或 Cookie 时会超限
  max-http-request-header-size: 16KB

spring:
  application:
    name: arsenal-demo

  lifecycle:
    # 优雅停机的等待上限，必须小于容器/网关的强杀时间
    timeout-per-shutdown-phase: 30s

  datasource:
    url: jdbc:mysql://${DB_HOST:127.0.0.1}:${DB_PORT:3306}/${DB_NAME:arsenal}?useUnicode=true&characterEncoding=utf8mb4&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true
    # 密码从不写死在这里（SKEL-CONF-001）
    username: ${DB_USER}
    password: ${DB_PASSWORD}
    driver-class-name: com.mysql.cj.jdbc.Driver
    hikari:
      # 连接池大小不是越大越好。公式参考：核数 * 2 + 有效磁盘数。
      # 超过后端数据库的实际处理能力时，多出来的连接只会加剧锁竞争。
      maximum-pool-size: 20
      minimum-idle: 5
      # 从池里拿连接的等待上限。不设置时是无限等待，
      # 表现是接口全部卡死且没有任何异常 —— 极难排查。
      connection-timeout: 3000
      # 空闲连接存活时间，要小于数据库的 wait_timeout，否则会拿到已被服务端关闭的连接
      idle-timeout: 600000
      max-lifetime: 1800000
      connection-test-query: SELECT 1

  jackson:
    time-zone: Asia/Shanghai
    default-property-inclusion: non_null
    serialization:
      write-dates-as-timestamps: false

  servlet:
    multipart:
      # 上传大小必须显式限制。默认 1MB/10MB，但在导入场景里往往需要调整，
      # 而调整时忘了整体限制就会变成一个可被撑爆的入口。
      max-file-size: 50MB
      max-request-size: 60MB

  threads:
    virtual:
      # JDK 21+ 可开启虚拟线程。注意：开启后 Tomcat 每请求一线程的模型改变，
      # 但「数据库连接池」不会因此变大 —— 瓶颈会转移到连接池上。
      enabled: false

# ── 日志 ────────────────────────────────────────────────────
logging:
  level:
    root: INFO
    # 自己包的日志开到 DEBUG 便于排查，第三方包保持 INFO 避免刷屏
    com.example: DEBUG
    org.springframework.jdbc.core: DEBUG
  pattern:
    # 带上 traceId 才能在微服务/异步场景里把一次请求的日志串起来
    console: "%d{HH:mm:ss.SSS} [%thread] [%X{traceId:-}] %-5level %logger{36} - %msg%n"
  file:
    name: logs/arsenal-demo.log

# ── 监控 ────────────────────────────────────────────────────
management:
  endpoints:
    web:
      exposure:
        # 默认只暴露 health/info。要暴露更多必须显式声明，
        # 而且 /env、/heapdump 这类端点绝不能暴露在公网。
        include: health,info,metrics,prometheus
  endpoint:
    health:
      show-details: when_authorized
  metrics:
    tags:
      application: ${spring.application.name}

# ── 接口文档 ────────────────────────────────────────────────
springdoc:
  swagger-ui:
    # 生产环境务必关闭，文档页会把全部接口结构送给任何能访问的人
    enabled: true
  api-docs:
    path: /v3/api-docs
"""

TREE = r"""arsenal-demo/
├── pom.xml
├── src/
│   ├── main/
│   │   ├── java/com/example/
│   │   │   ├── Application.java              ← 启动类，必须在根包
│   │   │   ├── common/                       ← 全局共享，与业务无关
│   │   │   │   ├── ApiResponse.java          统一响应体
│   │   │   │   ├── PageResult.java           统一分页结构
│   │   │   │   ├── ErrorCode.java            错误码常量表
│   │   │   │   ├── Desensitize.java          脱敏工具
│   │   │   │   ├── exception/
│   │   │   │   │   └── BizException.java     业务异常基类
│   │   │   │   └── web/
│   │   │   │       └── GlobalExceptionHandler.java   全局异常出口
│   │   │   ├── config/                       ← 所有 @Configuration 集中在此
│   │   │   │   ├── WebMvcConfig.java
│   │   │   │   ├── JacksonConfig.java
│   │   │   │   ├── AsyncConfig.java
│   │   │   │   ├── RetryConfig.java
│   │   │   │   └── OpenApiConfig.java
│   │   │   ├── interceptor/                  ← 拦截器（鉴权、链路 id）
│   │   │   ├── filter/                       ← 过滤器（请求日志、XSS 包装）
│   │   │   ├── integration/                  ← 外部系统客户端，统一在此边界
│   │   │   │   └── PartnerClient.java
│   │   │   ├── user/                         ← 按领域分包（不是按层分包）
│   │   │   │   ├── controller/
│   │   │   │   │   └── UserController.java
│   │   │   │   ├── dto/                      入参 / 出参 DTO
│   │   │   │   ├── domain/                   实体与枚举
│   │   │   │   ├── service/                  业务层
│   │   │   │   ├── repository/               数据访问
│   │   │   │   └── exception/                本领域业务异常
│   │   │   └── article/                      另一个领域，结构同上
│   │   └── resources/
│   │       ├── application.yml
│   │       ├── application-dev.yml           开发环境
│   │       ├── application-prod.yml          生产环境（不含任何密钥）
│   │       ├── db/
│   │       │   └── schema.sql                建表脚本
│   │       └── mapper/                       （仅 MyBatis 时存在）
│   └── test/
│       └── java/com/example/
│           ├── user/service/UserServiceTest.java      单元测试（Mock 外部依赖）
│           └── user/controller/UserControllerTest.java  @WebMvcTest 切片测试
└── .gitignore                                必须含 target/、logs/、*.iml、.env
"""

GITIGNORE = r"""# 构建产物
target/
!.mvn/wrapper/maven-wrapper.jar
build/
out/

# 日志与运行时
logs/
*.log

# IDE
.idea/
*.iml
*.ipr
*.iws
.vscode/

# 密钥与本地配置 —— 这两行是防事故的核心
.env
.env.*
!.env.example
application-local.yml
src/main/resources/application-local.yml

# 系统文件
.DS_Store
Thumbs.db
"""

FEATURE = {
    "id": "skeleton-config",
    "order": 4,
    "name": "项目骨架与配置全集",
    "subtitle": "从启动类到 pom、yaml、配置类，一个 Spring Boot 项目被拆开看",
    "glyph": "▥",
    "level": "必备",
    "scenario": (
        "新起一个项目时，把这一套照抄下来，就避免掉了「Long 精度丢失」"
        "「@Valid 静默失效」「没有优雅停机」这些几乎每个项目都会踩一遍的坑。"
    ),
    "intent": "把「一个项目由哪些零件组成」讲全，每个零件给出带注释的完整文件。",
    "tags": ["骨架", "POM", "配置", "启动类", "优雅停机"],
    "relatedRules": [
        "SKEL-STRC-001", "SKEL-STRC-002", "SKEL-DEP-001", "SKEL-DEP-002", "SKEL-DEP-003",
        "SKEL-CONF-001", "COL-GIT-003", "REL-LOG-002", "WEB-CTRL-003", "DATA-SCHM-003",
    ],
    "flow": [
        {"layer": "config", "step": "pom.xml", "detail": "定坐标与依赖边界。版本全部交给 parent BOM，一个都不手写。"},
        {"layer": "config", "step": "Application", "detail": "启动类置于根包。位置错了会导致 Bean 扫不到，报出的错误和真实原因毫无关系。"},
        {"layer": "config", "step": "application.yml", "detail": "只有跨环境一致的配置才放这里；密钥一律走环境变量。"},
        {"layer": "config", "step": "JacksonConfig", "detail": "Long 转字符串防前端精度丢失 —— 这是最容易上线后才发现的坑。"},
        {"layer": "config", "step": "WebMvcConfig", "detail": "跨域与拦截器链。TraceId 拦截器必须排在鉴权之前。"},
        {"layer": "config", "step": ".gitignore", "detail": "把 .env 与 application-local.yml 排除，是防密钥泄漏的最后一道机械防线。"},
    ],
    "packages": [
        "com.example                 启动类（根包只放它）",
        "com.example.common          全局共享：响应体、分页、异常、工具",
        "com.example.config          所有 @Configuration 集中在此",
        "com.example.interceptor     拦截器",
        "com.example.filter          过滤器",
        "com.example.integration     外部系统客户端（统一边界）",
        "com.example.<domain>        业务领域分包：controller/dto/domain/service/repository/exception",
    ],
    "files": [
        {
            "id": "application",
            "path": "src/main/java/com/example/Application.java",
            "layer": "config",
            "lang": "java",
            "role": "启动类。位置本身就是一条规则。",
            "code": APP,
            "highlights": [
                {"mark": "必须放在根包（这里是 com.example）", "title": "启动类的包位置是硬约束", "text": "@SpringBootApplication 隐式带 @ComponentScan，扫描范围是本类所在包及其子包。放错位置的结果是部分 Bean 扫不到，报出的错误和真实原因毫无关系。", "rule": "SKEL-STRC-002"},
                {"mark": "@ConfigurationPropertiesScan", "title": "配置属性类也需要显式扫描", "text": "不加它，@ConfigurationProperties 标注的类不会自动注册，注入时才发现是 null。", "rule": "SKEL-CONF-001"},
            ],
        },
        {
            "id": "jackson",
            "path": "src/main/java/com/example/config/JacksonConfig.java",
            "layer": "config",
            "lang": "java",
            "role": "JSON 序列化。下面四件事默认行为全是错的，所以这个类每个项目都该有。",
            "code": JACKSON_CONFIG,
            "highlights": [
                {"mark": "module.addSerializer(Long.class, ToStringSerializer.instance);", "title": "Long 必须转字符串", "text": "Java long 是 64 位，JS Number 只有 53 位安全整数。雪花 id 超过 2^53 后前端拿到的值和后端不是同一个数 —— 静默变成另一个数，不报任何错。通常上线后才被发现。", "rule": "WEB-CTRL-003"},
                {"mark": "mapper.registerModule(new Jdk8Module());", "title": "Optional 需要 Jdk8Module", "text": "没有它，PATCH 接口的 Optional 三态入参会序列化成诡异结构，三态语义直接失效。", "rule": "WEB-DTO-001"},
                {"mark": "com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES,\n                true", "title": "未知字段应当失败", "text": "静默忽略会让「前端字段名拼错」变成一次无声的功能失效 —— 请求成功、字段没生效、没有任何线索。", "rule": "WEB-DTO-001"},
                {"mark": "不要在各处自己 new ObjectMapper()", "title": "禁止各自 new ObjectMapper", "text": "自己 new 既丢掉这份统一配置（时间格式、Long 转换全部失效），又浪费对象创建开销。", "rule": "SKEL-CONF-001"},
            ],
        },
        {
            "id": "web-config",
            "path": "src/main/java/com/example/config/WebMvcConfig.java",
            "layer": "config",
            "lang": "java",
            "role": "跨域与拦截器链。顺序本身有意义。",
            "code": WEB_CONFIG,
            "highlights": [
                {"mark": "registry.addInterceptor(traceIdInterceptor).order(1)", "title": "TraceId 拦截器必须排在鉴权之前", "text": "否则鉴权失败时打出的日志没有链路 id —— 而那恰恰是最需要追溯的场景。", "rule": "REL-LOG-003"},
                {"mark": ".allowedOriginPatterns(\"http://localhost:3000\", \"https://your-domain.com\")", "title": "不要用 allowedOrigins(\"*\")", "text": "通配来源配上 allowCredentials(true) 会被浏览器直接拒绝；被迫放松成「允许任何来源带凭据」则是实打实的安全问题。生产环境必须收窄成具体域名。", "rule": "SKEL-CONF-001"},
            ],
        },
        {
            "id": "pom",
            "path": "pom.xml",
            "layer": "config",
            "lang": "xml",
            "role": "依赖边界。版本全部交给 BOM。",
            "code": POM,
            "highlights": [
                {"mark": "<artifactId>spring-boot-starter-validation</artifactId>", "title": "validation 必须显式引入", "text": "Spring Boot 2.3 之后校验已从 web starter 中移出。漏掉它的表现是所有 @Valid 全部静默失效 —— 没有任何报错，只是校验不再发生。这是最高频的踩坑项。", "rule": "SKEL-DEP-002"},
                {"mark": "<artifactId>mysql-connector-j</artifactId>", "title": "注意是 mysql-connector-j", "text": "旧的 mysql:mysql-connector-java 已废弃（SKEL-DEP-003 同类问题：废弃依赖不要继续用）。且 scope 应为 runtime —— 编译期不需要它。", "rule": "SKEL-DEP-002"},
                {"mark": "<parameters>true</parameters>", "title": "编译期保留参数名", "text": "Spring 的参数名绑定、MyBatis 省略 @Param 都依赖它。不开启时，参数名会变成 arg0、arg1，然后你会在一个和编译参数毫无关系的地方报错。", "rule": "SKEL-DEP-002"},
                {"mark": "<version>3.2.5</version>", "title": "业务依赖不写版本号", "text": "只有 parent 与「不在 BOM 里」的第三方（如 springdoc）才写 version。手写版本号是版本冲突的源头，而且升级 Boot 时它们不会跟着动。", "rule": "SKEL-DEP-002"},
            ],
        },
        {
            "id": "yaml",
            "path": "src/main/resources/application.yml",
            "layer": "config",
            "lang": "yaml",
            "role": "配置基线。每个非直觉项都写了「为什么」。",
            "code": YAML,
            "highlights": [
                {"mark": "password: ${DB_PASSWORD}", "title": "密钥走环境变量", "text": "密码、Token 写进 yml 并提交 = 密钥已经泄漏。这类事故的修复成本极高（要轮换所有凭据），而防住它只需要一个 ${} 占位。", "rule": "SKEL-CONF-001"},
                {"mark": "connection-timeout: 3000", "title": "连接池等待必须设上限", "text": "不设置时默认无限等待。表现是所有接口一起卡死且没有任何异常抛出 —— 是排查难度最高的一类线上故障。", "rule": "REL-TIME-001"},
                {"mark": "max-lifetime: 1800000", "title": "max-lifetime 要小于数据库 wait_timeout", "text": "否则连接池会一直拿着已被服务端关闭的死连接，报出随机的「连接已关闭」错误。", "rule": "SKEL-CONF-001"},
                {"mark": "shutdown: graceful", "title": "优雅停机", "text": "不开启时，一次正常发布也会让正在处理的请求直接失败。开启后先拒绝新请求，等在途请求处理完再退出。", "rule": "SKEL-CONF-001"},
                {"mark": "include: health,info,metrics,prometheus", "title": "Actuator 端点必须白名单暴露", "text": "/env、/heapdump 这类端点绝不能暴露在公网 —— /heapdump 可以直接下载整个堆内存，里面有全部凭据。", "rule": "SEC-DATA-002"},
            ],
        },
        {
            "id": "tree",
            "path": "项目结构（按领域分包）",
            "layer": "structure",
            "lang": "text",
            "role": "目录结构。这是「按领域分包」而不是「按层分包」。",
            "code": TREE,
            "highlights": [
                {"mark": "├── user/                         ← 按领域分包（不是按层分包）", "title": "按领域分包", "text": "按层分包（所有 controller 一个包）在项目变大后，改一个功能要在 6 个包之间来回跳。按领域分包让「一个功能的全部代码」在同一个目录下。", "rule": "SKEL-STRC-001"},
                {"mark": "├── common/                       ← 全局共享，与业务无关", "title": "common 只放真正全局的东西", "text": "common 是一个容易失控的包。标准是「去掉业务领域后它还成立吗」—— ApiResponse 成立，UserUtil 不成立。", "rule": "SKEL-STRC-001"},
            ],
        },
        {
            "id": "gitignore",
            "path": ".gitignore",
            "layer": "config",
            "lang": "text",
            "role": "防事故的机械防线。",
            "code": GITIGNORE,
            "highlights": [
                {"mark": ".env\n.env.*\n!.env.example", "title": ".gitignore 是防密钥泄漏的最后一道防线", "text": "不要指望「我记得不提交」。人一定会忘，而 .gitignore 不会。注意 !.env.example 这一行：示例文件要提交，它告诉别人需要配哪些变量。", "rule": "COL-GIT-003"},
                {"mark": "target/\n!.mvn/wrapper/maven-wrapper.jar", "title": "构建产物禁止提交", "text": "target/ 提交进仓库会让仓库体积永久膨胀（Git 不会真正删除历史），且每次构建都产生巨大 diff。", "rule": "COL-GIT-003"},
            ],
        },
    ],
    "checklist": [
        "确认启动类在根包，且根包下没有其他业务类",
        "确认 pom 里业务依赖都没有写 <version>（springdoc 这类不在 BOM 里的除外）",
        "确认 spring-boot-starter-validation 已引入（否则所有 @Valid 静默失效）",
        "确认 application.yml 里没有任何明文密钥，全部走 ${} 占位",
        "确认 JacksonConfig 已配置 Long → String（有雪花 id 时必须）",
        "确认 .gitignore 已排除 .env / application-local.yml / target / logs",
        "确认 Actuator 只暴露白名单端点，生产环境关闭 swagger-ui",
        "确认 server.shutdown=graceful 且 timeout 小于网关强杀时间",
    ],
    "pitfalls": [
        "启动类不在根包：部分 Bean 扫不到，报出的错误和真实原因毫无关系。",
        "忘引 spring-boot-starter-validation：所有 @Valid 静默失效。",
        "Long 未转字符串：雪花 id 传到前端后末位被抹平，静默变成另一个数。",
        "连接池 connection-timeout 未设：接口全部卡死且无异常抛出。",
        "max-lifetime 大于数据库 wait_timeout：随机的「连接已关闭」错误。",
        "CORS 用 allowedOrigins(\"*\") + allowCredentials(true)：浏览器直接拒绝，或被逼放松成安全隐患。",
        "Actuator 全端点暴露：/heapdump 可被直接下载，里面有全部凭据。",
    ],
}
