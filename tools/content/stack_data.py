# -*- coding: utf-8 -*-
"""选型维度 · 数据访问组：持久层 / 数据库 / 连接池 / 迁移。"""

DIMENSIONS = [
    {
        "id": "persistence",
        "groupId": "data",
        "name": "持久层",
        "why": "最影响日常写代码手感的一个选择 —— Service 里怎么写数据访问，全由它决定。",
        "defaultOption": "jdbc",
        "options": [
            {
                "id": "jdbc",
                "name": "Spring JdbcTemplate",
                "badge": "最轻",
                "summary": "Spring 自带，零额外依赖。SQL 完全手写，没有任何隐式行为，出问题时能一眼看懂。",
                "dependencies": [
                    {"groupId": "org.springframework.boot", "artifactId": "spring-boot-starter-jdbc"},
                    {"groupId": "com.mysql", "artifactId": "mysql-connector-j", "scope": "runtime"},
                ],
                "configClasses": [],
                "sample": {
                    "title": "Service 里的数据访问写法",
                    "lang": "java",
                    "code": (
                        "@Repository\n"
                        "public class UserRepository {\n"
                        "\n"
                        "    private final JdbcTemplate jdbcTemplate;\n"
                        "\n"
                        "    public UserRepository(JdbcTemplate jdbcTemplate) {\n"
                        "        this.jdbcTemplate = jdbcTemplate;\n"
                        "    }\n"
                        "\n"
                        "    public User findById(long id) {\n"
                        "        String sql = \"SELECT id, username, mobile FROM user WHERE id = ?\";\n"
                        "        List<User> rows = jdbcTemplate.query(sql, rowMapper, id);\n"
                        "        return rows.isEmpty() ? null : rows.get(0);\n"
                        "    }\n"
                        "}"
                    ),
                },
                "notes": [
                    "自动配置已就绪，只需配 datasource，不需要写任何配置类。",
                    "没有懒加载、没有一级缓存、没有隐式刷新 —— 所有行为都写在 SQL 里。",
                    "代价是重复的 RowMapper 与手写 SQL，字段多时维护量不小。",
                ],
                "pitfalls": [
                    "在循环里逐条查询（N+1）：一次列表接口打出 500 条 SQL。要改成 in 批量查。",
                    "拼 SQL 字符串传参：必须用 ? 占位符，这是注入的唯一入口。",
                ],
            },
            {
                "id": "mybatisplus",
                "name": "MyBatis-Plus",
                "badge": "主流",
                "summary": "国内使用最广。单表 CRUD 由 BaseMapper 自动生成，复杂 SQL 手写在 XML 里，两边各取所长。",
                "dependencies": [
                    {"groupId": "com.baomidou", "artifactId": "mybatis-plus-spring-boot3-starter",
                     "version": "3.5.7", "note": "注意是 spring-boot3 版本，普通版不兼容 Spring Boot 3"},
                ],
                "yaml": (
                    "mybatis-plus:\n"
                    "  global-config:\n"
                    "    db-config:\n"
                    "      logic-delete-field: isDeleted   # 逻辑删除字段，配好后 deleteById 自动变成 update\n"
                    "      logic-delete-value: 1\n"
                    "      logic-not-delete-value: 0\n"
                    "  configuration:\n"
                    "    # 驼峰与下划线自动映射，省掉大量 resultMap\n"
                    "    map-underscore-to-camel-case: true\n"
                    "    # 生产环境关掉 SQL 打印，否则日志量会失控\n"
                    "    log-impl: org.apache.ibatis.logging.nologging.NoLoggingImpl\n"
                    "mapper-locations: classpath*:/mapper/**/*.xml"
                ),
                "configClasses": [
                    {
                        "className": "MybatisPlusConfig",
                        "path": "src/main/java/com/example/config/MybatisPlusConfig.java",
                        "code": (
                            "package com.example.config;\n"
                            "\n"
                            "import com.baomidou.mybatisplus.annotation.DbType;\n"
                            "import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;\n"
                            "import com.baomidou.mybatisplus.extension.plugins.inner.OptimisticLockerInnerInterceptor;\n"
                            "import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;\n"
                            "import org.springframework.context.annotation.Bean;\n"
                            "import org.springframework.context.annotation.Configuration;\n"
                            "\n"
                            "/**\n"
                            " * 必须手工注册分页插件 —— 这是最容易漏的一步。\n"
                            " * 不注册时 Page 查询不会报错，只是分页参数被静默忽略，\n"
                            " * 返回全部数据（一个查询把整张表拉进内存）。\n"
                            " */\n"
                            "@Configuration\n"
                            "public class MybatisPlusConfig {\n"
                            "\n"
                            "    @Bean\n"
                            "    public MybatisPlusInterceptor mybatisPlusInterceptor() {\n"
                            "        MybatisPlusInterceptor interceptor = new MybatisPlusInterceptor();\n"
                            "        // 乐观锁插件：配合 @Version 字段使用，防并发覆盖\n"
                            "        interceptor.addInnerInterceptor(new OptimisticLockerInnerInterceptor());\n"
                            "        // 分页插件必须最后加，且必须指定 DbType\n"
                            "        PaginationInnerInterceptor page = new PaginationInnerInterceptor(DbType.MYSQL);\n"
                            "        // 单页最大条数兜底：即便调用方传了 100000 也会被限制住\n"
                            "        page.setMaxLimit(500L);\n"
                            "        interceptor.addInnerInterceptor(page);\n"
                            "        return interceptor;\n"
                            "    }\n"
                            "}"
                        ),
                    }
                ],
                "sample": {
                    "title": "Service 里的数据访问写法",
                    "lang": "java",
                    "code": (
                        "@Service\n"
                        "public class UserService {\n"
                        "\n"
                        "    private final UserMapper userMapper;\n"
                        "\n"
                        "    public UserService(UserMapper userMapper) {\n"
                        "        this.userMapper = userMapper;\n"
                        "    }\n"
                        "\n"
                        "    public PageResult<UserResponse> page(UserQuery query) {\n"
                        "        // 分页插件生效后，这里不需要手写 count 与 limit\n"
                        "        Page<User> page = new Page<>(query.getPage(), query.getPageSize());\n"
                        "        LambdaQueryWrapper<User> wrapper = new LambdaQueryWrapper<User>()\n"
                        "                .eq(User::getStatus, query.getStatus())\n"
                        "                .like(StringUtils.hasText(query.getUsername()),\n"
                        "                        User::getUsername, query.getUsername())\n"
                        "                .orderByDesc(User::getId);\n"
                        "        Page<User> result = userMapper.selectPage(page, wrapper);\n"
                        "        return PageResult.of(\n"
                        "                result.getRecords().stream().map(UserResponse::from).toList(),\n"
                        "                result.getTotal(), query.getPage(), query.getPageSize());\n"
                        "    }\n"
                        "}"
                    ),
                },
                "notes": [
                    "单表 CRUD 用 BaseMapper + LambdaQueryWrapper，复杂 SQL 写 XML —— 不要硬用 Wrapper 拼多表连接，那会变成不可读的代码。",
                    "分页插件必须手工注册，漏了不报错、只是静默返回全量。",
                    "逻辑删除字段配好后，deleteById 会自动改成 update，不用改业务代码。",
                ],
                "pitfalls": [
                    "忘记注册分页插件：分页参数被静默忽略，一次查询拉全表。",
                    "用 Wrapper 硬拼多表 join：可读性远不如一条 XML SQL，且无法用索引提示。",
                    "在 service 里直接调 mapper 做多表写入却不加事务：数据一致性没有保证。",
                ],
            },
            {
                "id": "jpa",
                "name": "Spring Data JPA",
                "badge": "规范",
                "summary": "以领域模型为中心，方法名即查询，自动建表。适合模型复杂、以对象为中心的系统。",
                "dependencies": [
                    {"groupId": "org.springframework.boot", "artifactId": "spring-boot-starter-data-jpa"},
                    {"groupId": "com.mysql", "artifactId": "mysql-connector-j", "scope": "runtime"},
                ],
                "yaml": (
                    "spring:\n"
                    "  jpa:\n"
                    "    hibernate:\n"
                    "      ddl-auto: validate      # 生产环境绝不使用 update/create，只做校验\n"
                    "    open-in-view: false        # 必须关掉，见下方说明\n"
                    "    properties:\n"
                    "      hibernate:\n"
                    "        jdbc.batch_size: 50     # 批量写入，减少来回次数\n"
                    "        order_inserts: true\n"
                    "        order_updates: true\n"
                    "        query.in_clause_parameter_padding: true"
                ),
                "configClasses": [
                    {
                        "className": "JpaAuditConfig",
                        "path": "src/main/java/com/example/config/JpaAuditConfig.java",
                        "code": (
                            "package com.example.config;\n"
                            "\n"
                            "import java.util.Optional;\n"
                            "import org.springframework.context.annotation.Bean;\n"
                            "import org.springframework.context.annotation.Configuration;\n"
                            "import org.springframework.data.domain.AuditorAware;\n"
                            "import org.springframework.data.jpa.repository.config.EnableJpaAuditing;\n"
                            "\n"
                            "/**\n"
                            " * 开启 JPA 审计：让 @CreatedDate / @LastModifiedDate 自动填充，\n"
                            " * 不要在每个 save 之前手写 setCreateTime —— 总有某条路径会忘。\n"
                            " */\n"
                            "@Configuration\n"
                            "@EnableJpaAuditing\n"
                            "public class JpaAuditConfig {\n"
                            "\n"
                            "    /** 操作人从当前登录态取。取不到时返回空而不是抛异常，避免定时任务写库失败。 */\n"
                            "    @Bean\n"
                            "    public AuditorAware<String> auditorAware() {\n"
                            "        return () -> Optional.ofNullable(CurrentUserHolder.getUsername());\n"
                            "    }\n"
                            "}"
                        ),
                    }
                ],
                "sample": {
                    "title": "Service 里的数据访问写法",
                    "lang": "java",
                    "code": (
                        "@Service\n"
                        "public class UserService {\n"
                        "\n"
                        "    private final UserRepository userRepository;\n"
                        "\n"
                        "    public UserService(UserRepository userRepository) {\n"
                        "        this.userRepository = userRepository;\n"
                        "    }\n"
                        "\n"
                        "    @Transactional(readOnly = true)\n"
                        "    public PageResult<UserResponse> page(UserQuery query, Pageable pageable) {\n"
                        "        Page<User> page = userRepository.findByStatus(query.getStatus(), pageable);\n"
                        "        return PageResult.of(\n"
                        "                page.getContent().stream().map(UserResponse::from).toList(),\n"
                        "                page.getTotalElements(), query.getPage(), query.getPageSize());\n"
                        "    }\n"
                        "}"
                    ),
                },
                "notes": [
                    "open-in-view 必须关掉。开着它意味着数据库连接会一直持有到响应渲染完成 ——"
                    "长连接、懒加载在视图层触发、事务边界被拉长到整个请求，是 JPA 最常见的生产事故来源。",
                    "ddl-auto 生产环境只能是 validate 或 none。update 会静默改表结构，"
                    "包括删列、改类型，且没有任何确认。",
                    "分页建议用 Slice（不查总数）做「下一页」列表，性能差别很大。",
                ],
                "pitfalls": [
                    "开着 open-in-view：请求结束前连接不释放，高并发下连接池瞬间打满。",
                    "N+1 查询：@ManyToOne 默认 EAGER，列表查询会按行数发 SQL。用 @EntityGraph 或 join fetch 解决。",
                    "ddl-auto: update 上生产：某天应用重启后表结构被悄悄改了。",
                    "在 @Transactional 方法外访问懒加载属性：LazyInitializationException。",
                ],
            },
        ],
    },
    {
        "id": "database",
        "groupId": "data",
        "name": "数据库",
        "why": "决定 SQL 方言、驱动依赖与连接参数。选错后迁移成本极高，属于一次性决策。",
        "defaultOption": "mysql",
        "options": [
            {
                "id": "mysql",
                "name": "MySQL 8.x",
                "badge": "通用",
                "summary": "国内最主流，运维资料最多，云厂商支持最完整。8.x 已支持窗口函数与 CTE。",
                "dependencies": [
                    {"groupId": "com.mysql", "artifactId": "mysql-connector-j", "scope": "runtime"},
                ],
                "yaml": (
                    "spring:\n"
                    "  datasource:\n"
                    # url 必须单行写完：YAML 普通标量不能跨行拼接，任何夹进来的
                    # 引号或空格都会变成 JDBC URL 的一部分，直接连不上库
                    # characterEncoding 写的是 **Java 编码名** utf8（Connector/J 8 会把它映射到
                    # MySQL 侧的 utf8mb4）；写 utf8mb4 会被当成非法 Java 编码，建连直接炸
                    "    url: jdbc:mysql://${DB_HOST:127.0.0.1}:${DB_PORT:3306}/${DB_NAME:app}?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&useSSL=false&allowPublicKeyRetrieval=true&rewriteBatchedStatements=true\n"
                    "    # rewriteBatchedStatements 必须开：否则 JDBC 的 batch 是一条条发，慢十倍以上\n"
                    "    # 默认连本机 root/空密码；全部可用环境变量覆盖：DB_HOST / DB_PORT / DB_NAME / DB_USERNAME / DB_PASSWORD\n"
                    "    driver-class-name: com.mysql.cj.jdbc.Driver\n"
                    "    username: ${DB_USERNAME:root}\n"
                    "    password: ${DB_PASSWORD:}"
                ),
                "notes": [
                    "字符集必须 utf8mb4。utf8 在 MySQL 里其实是三字节的，存不下 emoji 与部分生僻字。",
                    "serverTimezone 必须显式设置，否则时间字段会出现 8 小时偏移。",
                    "批量写入必须加 rewriteBatchedStatements=true，否则 JDBC 的 batch 是假的。",
                ],
                "pitfalls": [
                    "用 utf8 而非 utf8mb4：存 emoji 报错「Incorrect string value」。",
                    "排序规则选了 utf8mb4_general_ci 却在做严格比对：某些字符会被视为相等。",
                ],
            },
            {
                "id": "postgres",
                "name": "PostgreSQL 16",
                "badge": "严谨",
                "summary": "类型系统严格、JSONB 与全文检索强、事务与并发控制更符合标准。适合数据模型复杂或分析需求重的场景。",
                "dependencies": [
                    {"groupId": "org.postgresql", "artifactId": "postgresql", "scope": "runtime"},
                ],
                "yaml": (
                    "spring:\n"
                    "  datasource:\n"
                    "    # reWriteBatchedInserts 让 JDBC batch 真正合并成一条多值 INSERT\n"
                    "    url: jdbc:postgresql://${DB_HOST:127.0.0.1}:${DB_PORT:5432}/${DB_NAME:app}?ApplicationName=arsenal-demo&reWriteBatchedInserts=true\n"
                    "    driver-class-name: org.postgresql.Driver\n"
                    "    # 与 MySQL 一致：默认连本机，全部可用环境变量覆盖\n"
                    "    username: ${DB_USERNAME:root}\n"
                    "    password: ${DB_PASSWORD:}"
                ),
                "notes": [
                    "PG 的表名、字段名默认折叠为小写；用双引号包裹的大写标识符不会被折叠，会变成两套命名。所以一律用小写加下划线。",
                    "COUNT(*) 在大表上很慢，PG 需要顺序扫描；需要近似值可用 pg_class.reltuples。",
                    "reWriteBatchedInserts=true 才能让 JDBC batch 真正合并成一条多值 INSERT。",
                ],
                "pitfalls": [
                    "建表时用了带引号的大写标识符：之后所有查询都必须带引号，否则找不到表。",
                    "把 MySQL 的 ON DUPLICATE KEY UPDATE 直接搬过来：语法不成立，要用 ON CONFLICT。",
                ],
            },
        ],
    },
    {
        "id": "pool",
        "groupId": "data",
        "name": "连接池",
        "why": "Spring Boot 默认 HikariCP。选 Druid 主要是为了它的监控面板。",
        "defaultOption": "hikari",
        "options": [
            {
                "id": "hikari",
                "name": "HikariCP",
                "badge": "默认",
                "summary": "Spring Boot 内置，性能最好，配置项少。绝大多数项目的最优解。",
                "dependencies": [
                    {"groupId": "org.springframework.boot", "artifactId": "spring-boot-starter-jdbc",
                     "note": "已内置 HikariCP"},
                ],
                "yaml": (
                    "spring:\n"
                    "  datasource:\n"
                    "    hikari:\n"
                    "      maximum-pool-size: 20        # 不是越大越好，超过数据库处理能力只会加剧锁竞争\n"
                    "      minimum-idle: 5\n"
                    "      connection-timeout: 3000     # 必须设，否则池满时无限等待且无异常\n"
                    "      idle-timeout: 600000\n"
                    "      max-lifetime: 1800000        # 必须小于数据库 wait_timeout\n"
                    "      connection-test-query: SELECT 1"
                ),
                "notes": [
                    "连接池大小经验公式：核数 × 2 + 有效磁盘数。20 已经能支撑相当规模的业务。",
                    "connection-timeout 是必设项。默认 30s 太长，线上表现是所有接口一起卡住。",
                ],
                "pitfalls": ["maximum-pool-size 调到 200：数据库端 max_connections 被打满，反而拖垮全局。"],
            },
            {
                "id": "druid",
                "name": "Druid",
                "badge": "带监控",
                "summary": "阿里开源。自带 SQL 监控、慢 SQL 记录、防火墙。代价是需要手工维护配置类与监控页鉴权。",
                "dependencies": [
                    {"groupId": "com.alibaba", "artifactId": "druid-spring-boot-3-starter",
                     "version": "1.2.23", "note": "Spring Boot 3 必须用 spring-boot-3-starter 版本"},
                ],
                "yaml": (
                    "spring:\n"
                    "  datasource:\n"
                    "    druid:\n"
                    "      initial-size: 5\n"
                    "      min-idle: 5\n"
                    "      max-active: 20\n"
                    "      max-wait: 3000                 # 等价于 Hikari 的 connection-timeout\n"
                    "      validation-query: SELECT 1\n"
                    "      test-while-idle: true\n"
                    "      # 慢 SQL 记录：这是 Druid 最实用的功能\n"
                    "      filter:\n"
                    "        stat:\n"
                    "          enabled: true\n"
                    "          slow-sql-millis: 1000\n"
                    "          log-slow-sql: true\n"
                    "      stat-view-servlet:\n"
                    "        enabled: true\n"
                    "        # 不给默认值时占位符解析失败会直接挡启动；本地默认关闭鉴权页可见性由使用者自担\n"
                    "        login-username: ${DRUID_USER:}\n"
                    "        login-password: ${DRUID_PWD:}\n"
                    "        # 生产环境必须限制来源 IP，监控页会暴露全部 SQL\n"
                    "        allow: 127.0.0.1"
                ),
                "configClasses": [
                    {
                        "className": "DruidMonitorConfig",
                        "path": "src/main/java/com/example/config/DruidMonitorConfig.java",
                        "code": (
                            "package com.example.config;\n"
                            "\n"
                            "import com.alibaba.druid.support.jakarta.StatViewServlet;\n"
                            "import org.springframework.boot.web.servlet.ServletRegistrationBean;\n"
                            "import org.springframework.context.annotation.Bean;\n"
                            "import org.springframework.context.annotation.Configuration;\n"
                            "\n"
                            "/**\n"
                            " * Druid 监控页注册。\n"
                            " *\n"
                            " * 注意：监控页会暴露全部 SQL 语句、表名、参数与执行计划，\n"
                            " * 属于内部信息，必须限制来源 IP 并加鉴权，绝不可对公网开放。\n"
                            " */\n"
                            "@Configuration\n"
                            "public class DruidMonitorConfig {\n"
                            "\n"
                            "    @Bean\n"
                            "    public ServletRegistrationBean<StatViewServlet> druidStatView() {\n"
                            "        ServletRegistrationBean<StatViewServlet> bean =\n"
                            "                new ServletRegistrationBean<>(new StatViewServlet(), \"/druid/*\");\n"
                            "        bean.addInitParameter(\"loginUsername\", System.getenv(\"DRUID_USER\"));\n"
                            "        bean.addInitParameter(\"loginPassword\", System.getenv(\"DRUID_PWD\"));\n"
                            "        // 只允许本机访问，生产环境改成内网网段\n"
                            "        bean.addInitParameter(\"allow\", \"127.0.0.1\");\n"
                            "        return bean;\n"
                            "    }\n"
                            "}"
                        ),
                    }
                ],
                "notes": [
                    "Druid 的核心价值是慢 SQL 与 SQL 统计，不是连接池性能本身。若不需要监控，Hikari 更合适。",
                    "Spring Boot 3 必须用 druid-spring-boot-3-starter（jakarta 命名空间），旧版会报 ClassNotFound。",
                ],
                "pitfalls": [
                    "监控页对公网开放：等于把数据库结构全文送出去。",
                    "用了 Spring Boot 2 的 druid starter：Servlet API 不兼容，启动直接失败。",
                ],
            },
        ],
    },
    {
        "id": "migration",
        "groupId": "data",
        "name": "数据库迁移",
        "why": "决定表结构变更如何进版本控制。不用迁移工具意味着生产环境靠人肉执行 SQL。",
        "defaultOption": "flyway",
        "options": [
            {
                "id": "flyway",
                "name": "Flyway",
                "badge": "推荐",
                "summary": "SQL 优先，脚本即迁移。把 schema 变更纳入 Git，让「生产库是哪个版本」有确定答案。",
                "dependencies": [
                    {"groupId": "org.flywaydb", "artifactId": "flyway-core"},
                    {"groupId": "org.flywaydb", "artifactId": "flyway-mysql", "note": "MySQL 10.x 起必须单独引入"},
                ],
                "yaml": (
                    "spring:\n"
                    "  flyway:\n"
                    "    enabled: true\n"
                    "    locations: classpath:db/migration\n"
                    "    baseline-on-migrate: true      # 已有存量库时，把当前状态记为基线\n"
                    "    baseline-version: 0\n"
                    "    validate-on-migrate: true      # 校验脚本校验和，防止有人改历史脚本\n"
                    "    out-of-order: false            # 禁止插入历史版本，保持线性\n"
                    "    clean-disabled: true           # 生产环境必须禁用 clean（它会删光所有表）"
                ),
                "configClasses": [],
                "sample": {
                    "title": "迁移脚本命名与写法",
                    "lang": "sql",
                    "code": (
                        "-- src/main/resources/db/migration/V1__create_user.sql\n"
                        "-- 命名规则：V<版本>__<描述>.sql，双下划线，版本号不可回改\n"
                        "-- 校验和一旦变化，Flyway 会直接拒绝启动 —— 这是有意为之：\n"
                        "-- 历史脚本必须视为不可变，改结构要新增一个版本\n"
                        "CREATE TABLE `user` (\n"
                        "    `id`          bigint unsigned NOT NULL AUTO_INCREMENT,\n"
                        "    `username`    varchar(32)     NOT NULL,\n"
                        "    `create_time` datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP,\n"
                        "    `update_time` datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,\n"
                        "    PRIMARY KEY (`id`),\n"
                        "    UNIQUE KEY `uk_username` (`username`)\n"
                        ") ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;\n"
                        "\n"
                        "-- 加字段用新版本，不要改 V1：\n"
                        "-- src/main/resources/db/migration/V2__add_user_mobile.sql\n"
                        "-- ALTER TABLE `user` ADD COLUMN `mobile` varchar(20) NOT NULL DEFAULT '' COMMENT '手机号';"
                    ),
                },
                "notes": [
                    "历史脚本一旦执行过就不能再改 —— 校验和会变，启动直接失败。改结构必须新增版本。",
                    "迁移必须可重复执行、且在多实例部署下安全（Flyway 用锁表保证只有一个实例在迁移）。",
                ],
                "pitfalls": [
                    "改了已经上线的 V1 脚本：所有环境启动时校验和不匹配，服务起不来。",
                    "生产环境保留 clean 权限：一条 flyway:clean 命令删光所有表。",
                ],
            },
            {
                "id": "liquibase",
                "name": "Liquibase",
                "badge": "跨库",
                "summary": "变更集用 XML/YAML 描述，可自动生成各数据库的方言 SQL。适合需要同时支持多种数据库的产品。",
                "dependencies": [
                    {"groupId": "org.liquibase", "artifactId": "liquibase-core"},
                ],
                "yaml": (
                    "spring:\n"
                    "  liquibase:\n"
                    "    enabled: true\n"
                    "    change-log: classpath:db/changelog/db.changelog-master.yaml\n"
                    "    contexts: prod"
                ),
                "notes": [
                    "changelog 是「主索引」，只负责 include 各个变更集，不要往里写具体变更。",
                    "每条 changeset 必须有唯一 id + author，改了内容会导致校验和变化。",
                    "跨库能力是它的核心卖点：同一份变更集能生成 MySQL 与 PG 两种方言。",
                ],
                "pitfalls": ["改动已执行的 changeset：校验和不匹配导致启动失败。"],
            },
            {
                "id": "none",
                "name": "不使用迁移工具",
                "badge": "轻量",
                "summary": "手工维护 schema.sql，需要时人工执行。短期项目或原型阶段可以接受。",
                "dependencies": [],
                "yaml": (
                    "spring:\n"
                    "  sql:\n"
                    "    init:\n"
                    "      # 没有迁移工具时，由 Spring 在每次启动时执行 schema.sql（位置见 schema-locations）。\n"
                    "      # schema.sql 里的 DDL 必须幂等（CREATE TABLE IF NOT EXISTS），\n"
                    "      # 否则第二次启动就会撞上「表已存在」直接起不来。\n"
                    "      mode: always\n"
                    "      schema-locations: classpath:db/schema.sql"
                ),
                "notes": [
                    "代价是：没有「当前生产库是什么版本」的确定答案，回滚靠记忆。",
                    "如果一定要这样，至少把所有 DDL 集中在一个受版本控制的 sql 文件里，并记录每次执行的时间与执行人。",
                ],
                "pitfalls": [
                    "生产环境靠人肉执行 SQL：漏执行、执行顺序错误、环境间不一致几乎必然发生。",
                    "多人同时改表结构且没有记录：谁都不知道某个列是谁加的。",
                ],
            },
        ],
    },
]
