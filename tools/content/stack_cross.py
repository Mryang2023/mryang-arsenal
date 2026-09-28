# -*- coding: utf-8 -*-
"""选型维度 · 横切关注点：鉴权 / 文档 / 监控 / 映射 / 样板代码 / 测试。"""

DIMENSIONS = [
    {
        "id": "auth",
        "groupId": "crosscut",
        "name": "认证鉴权",
        "why": "决定「谁能访问这个接口」怎么表达。安全相关，不能靠自定义过滤器凑合。",
        "defaultOption": "securityjwt",
        "options": [
            {
                "id": "securityjwt",
                "name": "Spring Security + JWT",
                "badge": "推荐",
                "summary": "官方方案，过滤器链清晰，方法级注解（@PreAuthorize）成熟。学习曲线较陡但一次学透。",
                "dependencies": [
                    {"groupId": "org.springframework.boot", "artifactId": "spring-boot-starter-security"},
                    {"groupId": "io.jsonwebtoken", "artifactId": "jjwt-api", "version": "0.12.5"},
                    {"groupId": "io.jsonwebtoken", "artifactId": "jjwt-impl", "version": "0.12.5", "scope": "runtime"},
                    {"groupId": "io.jsonwebtoken", "artifactId": "jjwt-jackson", "version": "0.12.5", "scope": "runtime"},
                ],
                "configClasses": [
                    {
                        "className": "SecurityConfig",
                        "path": "src/main/java/com/example/config/SecurityConfig.java",
                        "code": (
                            "package com.example.config;\n"
                            "\n"
                            "import com.example.security.JwtAuthenticationFilter;\n"
                            "import org.springframework.context.annotation.Bean;\n"
                            "import org.springframework.context.annotation.Configuration;\n"
                            "import org.springframework.http.HttpMethod;\n"
                            "import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;\n"
                            "import org.springframework.security.config.annotation.web.builders.HttpSecurity;\n"
                            "import org.springframework.security.config.http.SessionCreationPolicy;\n"
                            "import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;\n"
                            "import org.springframework.security.crypto.password.PasswordEncoder;\n"
                            "import org.springframework.security.web.SecurityFilterChain;\n"
                            "import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;\n"
                            "\n"
                            "/**\n"
                            " * Spring Security 配置。\n"
                            " *\n"
                            " * 四条原则：\n"
                            " *   1. 无状态：JWT 场景必须关掉 Session（STATELESS），否则水平扩容后\n"
                            " *      会话落在某一台机器上，其他实例认不出你。\n"
                            " *   2. CSRF 关闭：无状态 + 不用 Cookie 时 CSRF 不构成威胁；\n"
                            " *      但如果你同时用了 Cookie，就必须开回来。\n"
                            " *   3. 白名单必须显式列出，默认拒绝。\n"
                            " *   4. 密码编码器用 BCrypt，不要用 MD5/SHA1（可暴力破解）。\n"
                            " */\n"
                            "@Configuration\n"
                            "@EnableMethodSecurity\n"
                            "public class SecurityConfig {\n"
                            "\n"
                            "    /** 无需认证即可访问的路径。只放登录、注册、健康检查、文档。 */\n"
                            "    private static final String[] WHITELIST = {\n"
                            "            \"/api/v1/auth/login\",\n"
                            "            \"/api/v1/auth/register\",\n"
                            "            \"/actuator/health\",\n"
                            "    };\n"
                            "\n"
                            "    private final JwtAuthenticationFilter jwtAuthenticationFilter;\n"
                            "\n"
                            "    public SecurityConfig(JwtAuthenticationFilter jwtAuthenticationFilter) {\n"
                            "        this.jwtAuthenticationFilter = jwtAuthenticationFilter;\n"
                            "    }\n"
                            "\n"
                            "    @Bean\n"
                            "    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {\n"
                            "        http\n"
                            "                .csrf(csrf -> csrf.disable())\n"
                            "                .sessionManagement(session ->\n"
                            "                        session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))\n"
                            "                .authorizeHttpRequests(auth -> auth\n"
                            "                        .requestMatchers(WHITELIST).permitAll()\n"
                            "                        // 接口文档在生产环境应关闭；开发环境放开\n"
                            "                        .requestMatchers(\"/v3/api-docs/**\", \"/swagger-ui/**\").permitAll()\n"
                            "                        .requestMatchers(HttpMethod.OPTIONS, \"/**\").permitAll()\n"
                            "                        // 其余一律要认证：默认拒绝，而不是默认放行\n"
                            "                        .anyRequest().authenticated())\n"
                            "                // JWT 过滤器放在用户名密码过滤器之前\n"
                            "                .addFilterBefore(jwtAuthenticationFilter,\n"
                            "                        UsernamePasswordAuthenticationFilter.class);\n"
                            "        return http.build();\n"
                            "    }\n"
                            "\n"
                            "    /** BCrypt 自带盐值且可调计算强度，是密码存储的默认选择。 */\n"
                            "    @Bean\n"
                            "    public PasswordEncoder passwordEncoder() {\n"
                            "        return new BCryptPasswordEncoder();\n"
                            "    }\n"
                            "}"
                        ),
                    },
                    {
                        "className": "MethodSecuritySample",
                        "path": "方法级鉴权用法",
                        "code": (
                            "// 方法级鉴权：把「谁能调这个接口」写在方法上，一眼可见。\n"
                            "@RestController\n"
                            "@RequestMapping(\"/api/v1/users\")\n"
                            "public class UserController {\n"
                            "\n"
                            "    // 需要 ADMIN 角色\n"
                            "    @PreAuthorize(\"hasRole('ADMIN')\")\n"
                            "    @DeleteMapping(\"/{id}\")\n"
                            "    public ApiResponse<Void> delete(@PathVariable long id) {\n"
                            "        userService.delete(id);\n"
                            "        return ApiResponse.ok();\n"
                            "    }\n"
                            "\n"
                            "    // 只允许本人或管理员（水平越权防护，SEC-AUTH-001）\n"
                            "    @PreAuthorize(\"#id == authentication.principal.userId or hasRole('ADMIN')\")\n"
                            "    @GetMapping(\"/{id}/profile\")\n"
                            "    public ApiResponse<UserProfileResponse> profile(@PathVariable long id) {\n"
                            "        return ApiResponse.ok(userService.profile(id));\n"
                            "    }\n"
                            "}\n"
                            "\n"
                            "// 注意：@PreAuthorize 只解决「能不能进这个接口」，\n"
                            "// 不解决「这条数据是不是你的」。列表类接口必须把当前用户\n"
                            "// 作为查询条件传下去，不能靠前端传 userId。"
                        ),
                    },
                ],
                "notes": [
                    "JWT 的 payload 是明文 Base64，不是加密 —— 绝不能放手机号、身份证等敏感信息。",
                    "Refresh Token 必须有独立的撤销机制（Redis 黑名单或版本号），否则签发后无法失效。",
                    "水平越权是比注入更常见的漏洞：列表接口务必用当前登录用户作为查询条件。",
                ],
                "pitfalls": [
                    "把 userId 放在请求参数里：攻击者改成别人的 id 就能读别人的数据。",
                    "JWT 密钥硬编码且长度不足：HMAC-SHA256 需要至少 256 位密钥。",
                    "白名单写成 /**：以为只是临时放开，然后忘了删。",
                    "Spring Security 默认密码打印：日志里出现 Using generated security password。",
                ],
            },
            {
                "id": "satoken",
                "name": "Sa-Token",
                "badge": "轻量",
                "summary": "国产轻量鉴权框架，API 直观（StpUtil.login / checkPermission），上手比 Security 快很多。",
                "dependencies": [
                    {"groupId": "cn.dev33", "artifactId": "sa-token-spring-boot3-starter",
                     "version": "1.38.0", "note": "Spring Boot 3 必须用 boot3 版本"},
                    {"groupId": "cn.dev33", "artifactId": "sa-token-redis-jackson", "version": "1.38.0",
                     "note": "用 Redis 存会话时引入，否则重启后全部登录态失效"},
                ],
                "yaml": (
                    "sa-token:\n"
                    "  token-name: Authorization\n"
                    "  # Token 有效期 30 天。设得太短用户体验差，太长泄漏风险高\n"
                    "  timeout: 2592000\n"
                    "  # 最低活跃频率 -1 表示不检查，表示只要在有效期就一直有效\n"
                    "  active-timeout: -1\n"
                    "  # 允许同一账号多端登录（false 则新登录踢掉旧登录）\n"
                    "  is-concurrent: true\n"
                    "  is-share: false\n"
                    "  token-style: uuid\n"
                    "  # 生产环境必须关掉控制台输出\n"
                    "  is-print: false"
                ),
                "configClasses": [
                    {
                        "className": "SaTokenConfig",
                        "path": "src/main/java/com/example/config/SaTokenConfig.java",
                        "code": (
                            "package com.example.config;\n"
                            "\n"
                            "import cn.dev33.satoken.interceptor.SaInterceptor;\n"
                            "import cn.dev33.satoken.router.SaRouter;\n"
                            "import cn.dev33.satoken.stp.StpUtil;\n"
                            "import org.springframework.context.annotation.Configuration;\n"
                            "import org.springframework.web.servlet.config.annotation.InterceptorRegistry;\n"
                            "import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;\n"
                            "\n"
                            "/**\n"
                            " * Sa-Token 拦截器注册。\n"
                            " *\n"
                            " * 关键设计：全局拦截器只做「是否登录」检查，\n"
                            " * 权限粒度交给方法上的 @SaCheckPermission —— \n"
                            " * 把权限规则全部堆在拦截器里，会变成一个没人敢改的 if 长列表。\n"
                            " */\n"
                            "@Configuration\n"
                            "public class SaTokenConfig implements WebMvcConfigurer {\n"
                            "\n"
                            "    @Override\n"
                            "    public void addInterceptors(InterceptorRegistry registry) {\n"
                            "        registry.addInterceptor(new SaInterceptor(handler ->\n"
                            "                        // 只拦「登录校验」，白名单显式列出\n"
                            "                        SaRouter.match(\"/**\")\n"
                            "                                .notMatch(\"/api/v1/auth/**\")\n"
                            "                                .notMatch(\"/actuator/**\")\n"
                            "                                .check(r -> StpUtil.checkLogin())))\n"
                            "                .addPathPatterns(\"/**\");\n"
                            "    }\n"
                            "}"
                        ),
                    }
                ],
                "notes": [
                    "一定要接 Redis 存会话。默认存在内存里，重启即全员掉线，多实例部署更是互相认不出。",
                    "Sa-Token 的 token 默认是 UUID 而非 JWT。若要无状态 JWT 需额外配置，权衡点是「能否主动踢人」。",
                ],
                "pitfalls": [
                    "不接 Redis：重启后所有用户需重新登录；多实例部署时登录态互不可见。",
                    "is-print 保持 true 上生产：控制台会持续打印 token 相关信息。",
                ],
            },
            {
                "id": "custom",
                "name": "自研拦截器 + JWT",
                "badge": "不推荐",
                "summary": "自己写过滤器解析 JWT 并塞进 ThreadLocal。看起来简单，但鉴权细节极易漏。",
                "dependencies": [
                    {"groupId": "io.jsonwebtoken", "artifactId": "jjwt-api", "version": "0.12.5"},
                    {"groupId": "io.jsonwebtoken", "artifactId": "jjwt-impl", "version": "0.12.5", "scope": "runtime"},
                    {"groupId": "io.jsonwebtoken", "artifactId": "jjwt-jackson", "version": "0.12.5", "scope": "runtime"},
                ],
                "notes": [
                    "选择它就意味着你要自己实现：token 解析、过期处理、时钟偏移容忍、签名算法白名单（防 alg=none 攻击）、"
                    "权限判定、异常统一处理。这几项任何一项漏掉都是安全漏洞。",
                    "如果只是觉得 Spring Security 配置繁琐，其实更划算的是用 Sa-Token。",
                    "唯一合理的使用场景是：需要与既有非 Java 系统共用同一套 token 约定，且安全边界非常清晰。",
                ],
                "pitfalls": [
                    "不校验签名算法：攻击者把 header 改成 alg=none 即可伪造 token。",
                    "ThreadLocal 用完不 remove：线程池复用导致下一个请求拿到上一个人的身份 —— 这是最严重的越权漏洞之一。",
                    "只在拦截器里判断「token 有效」却不管「有没有权限访问这个资源」。",
                ],
            },
        ],
    },
    {
        "id": "apidoc",
        "groupId": "crosscut",
        "name": "接口文档",
        "why": "决定接口契约如何被消费。用注解生成比手写 wiki 可靠，因为代码变了文档会跟着变。",
        "defaultOption": "springdoc",
        "options": [
            {
                "id": "springdoc",
                "name": "SpringDoc OpenAPI",
                "badge": "推荐",
                "summary": "Spring Boot 3 的标准选择（springfox 已停止维护且不兼容 Boot 3）。注解生成，UI 内置。",
                "dependencies": [
                    {"groupId": "org.springdoc", "artifactId": "springdoc-openapi-starter-webmvc-ui",
                     "version": "2.5.0"},
                ],
                "yaml": (
                    "springdoc:\n"
                    "  swagger-ui:\n"
                    "    # 生产环境必须关闭：文档页会把全部接口结构送给任何能访问的人\n"
                    "    enabled: true\n"
                    "    path: /swagger-ui.html\n"
                    "  api-docs:\n"
                    "    path: /v3/api-docs\n"
                    "  # 只扫描指定包，避免把 actuator 内部端点也扫进来\n"
                    "  packages-to-scan: com.example"
                ),
                "configClasses": [
                    {
                        "className": "OpenApiConfig",
                        "path": "src/main/java/com/example/config/OpenApiConfig.java",
                        "code": (
                            "package com.example.config;\n"
                            "\n"
                            "import io.swagger.v3.oas.models.OpenAPI;\n"
                            "import io.swagger.v3.oas.models.info.Info;\n"
                            "import io.swagger.v3.oas.models.security.SecurityRequirement;\n"
                            "import io.swagger.v3.oas.models.security.SecurityScheme;\n"
                            "import org.springframework.context.annotation.Bean;\n"
                            "import org.springframework.context.annotation.Configuration;\n"
                            "\n"
                            "/**\n"
                            " * OpenAPI 元信息。\n"
                            " *\n"
                            " * 注册 SecurityScheme 后，Swagger UI 右上角会出现\n"
                            " * 「Authorize」按钮，可以直接填 JWT 调试受保护接口 ——\n"
                            " * 不注册的话每次调试都要手工改 header，很影响使用率。\n"
                            " */\n"
                            "@Configuration\n"
                            "public class OpenApiConfig {\n"
                            "\n"
                            "    private static final String SCHEME = \"bearerAuth\";\n"
                            "\n"
                            "    @Bean\n"
                            "    public OpenAPI openAPI() {\n"
                            "        return new OpenAPI()\n"
                            "                .info(new Info()\n"
                            "                        .title(\"军火库示例服务\")\n"
                            "                        .version(\"1.0.0\")\n"
                            "                        .description(\"所有接口统一返回 ApiResponse；\"\n"
                            "                                + \"业务错误码见错误码表\"))\n"
                            "                .addSecurityItem(new SecurityRequirement().addList(SCHEME))\n"
                            "                .components(new io.swagger.v3.oas.models.Components()\n"
                            "                        .addSecuritySchemes(SCHEME, new SecurityScheme()\n"
                            "                                .type(SecurityScheme.Type.HTTP)\n"
                            "                                .scheme(\"bearer\")\n"
                            "                                .bearerFormat(\"JWT\")));\n"
                            "    }\n"
                            "}"
                        ),
                    }
                ],
                "notes": [
                    "生产环境必须关掉 swagger-ui.enabled，否则接口结构对外全公开。",
                    "DTO 上的 @Schema(description = ...) 会直接进文档；不写则字段无说明。",
                ],
                "pitfalls": [
                    "换成 springfox：不兼容 Spring Boot 3（依赖旧 Servlet API），启动直接失败。",
                    "文档页上生产：暴露全部接口、参数结构与示例，等于给攻击者做了功课。",
                ],
            },
            {
                "id": "knife4j",
                "name": "Knife4j",
                "badge": "中文增强",
                "summary": "SpringDoc 的中文增强 UI，界面更适合国内团队使用，支持调试、离线文档导出。",
                "dependencies": [
                    {"groupId": "com.github.xiaoymin", "artifactId": "knife4j-openapi3-jakarta-spring-boot-starter",
                     "version": "4.5.0", "note": "jakarta 版本，对应 Spring Boot 3"},
                ],
                "yaml": (
                    "knife4j:\n"
                    "  enable: true\n"
                    "  setting:\n"
                    "    language: zh_cn\n"
                    "  # 生产环境建议关闭（enable: false）"
                ),
                "configClasses": [
                    {
                        "className": "OpenApiConfig",
                        "path": "src/main/java/com/example/config/OpenApiConfig.java",
                        "code": (
                            "package com.example.config;\n"
                            "\n"
                            "import io.swagger.v3.oas.models.OpenAPI;\n"
                            "import io.swagger.v3.oas.models.info.Info;\n"
                            "import io.swagger.v3.oas.models.security.SecurityRequirement;\n"
                            "import io.swagger.v3.oas.models.security.SecurityScheme;\n"
                            "import org.springframework.context.annotation.Bean;\n"
                            "import org.springframework.context.annotation.Configuration;\n"
                            "\n"
                            "/**\n"
                            " * OpenAPI 元信息（Knife4j 版）。\n"
                            " *\n"
                            " * Knife4j 是 SpringDoc 之上的 UI 层，底层注解完全一致，\n"
                            " * 文档入口是 /doc.html（swagger-ui.html 也能用）。\n"
                            " * 注册 SecurityScheme 后，右上角会出现「Authorize」按钮，\n"
                            " * 可以直接填 JWT 调试受保护接口。\n"
                            " */\n"
                            "@Configuration\n"
                            "public class OpenApiConfig {\n"
                            "\n"
                            "    private static final String SCHEME = \"bearerAuth\";\n"
                            "\n"
                            "    @Bean\n"
                            "    public OpenAPI openAPI() {\n"
                            "        return new OpenAPI()\n"
                            "                .info(new Info()\n"
                            "                        .title(\"军火库示例服务\")\n"
                            "                        .version(\"1.0.0\")\n"
                            "                        .description(\"所有接口统一返回 ApiResponse；\"\n"
                            "                                + \"业务错误码见错误码表\"))\n"
                            "                .addSecurityItem(new SecurityRequirement().addList(SCHEME))\n"
                            "                .components(new io.swagger.v3.oas.models.Components()\n"
                            "                        .addSecuritySchemes(SCHEME, new SecurityScheme()\n"
                            "                                .type(SecurityScheme.Type.HTTP)\n"
                            "                                .scheme(\"bearer\")\n"
                            "                                .bearerFormat(\"JWT\")));\n"
                            "    }\n"
                            "}"
                        ),
                    }
                ],
                "notes": [
                    "它是在 SpringDoc 之上的 UI 层，注解用法与 SpringDoc 完全一致（@Schema、@Operation）。",
                    "离线文档导出对交付给外部对接方很实用，省掉手写接口文档的时间。",
                ],
                "pitfalls": ["必须用 jakarta 版本，用错版本会因 javax.servlet 缺失而启动失败。"],
            },
            {
                "id": "none",
                "name": "不生成文档",
                "badge": "极简",
                "summary": "用 Markdown 手写接口文档。适合接口极少、且几乎不变的项目。",
                "dependencies": [],
                "notes": [
                    "手写文档的必然结局是「代码改了文档没改」，然后没有任何人再信任它。",
                    "如果实在不想引入注解，至少让集成测试承担契约描述的作用。",
                ],
                "pitfalls": ["文档与实现漂移后，对接方按文档写代码，联调时才发现全是错的。"],
            },
        ],
    },
    {
        "id": "observability",
        "groupId": "crosscut",
        "name": "可观测性",
        "why": "出问题时你唯一能依靠的东西。没有监控的应用等于在黑盒里跑。",
        "defaultOption": "prometheus",
        "options": [
            {
                "id": "none",
                "name": "仅日志",
                "badge": "最小",
                "summary": "只输出日志文件，靠 grep 排查。小项目起步可以，但故障定位会非常慢。",
                "dependencies": [],
                "notes": [
                    "至少要保证：日志有 traceId、异常有堆栈、关键路径有 INFO 级别记录。",
                    "没有指标意味着「系统现在是否健康」只能靠用户投诉来发现。",
                ],
                "pitfalls": ["只打 println 不打日志：容器化后 stdout 无人收集，出问题什么都查不到。"],
            },
            {
                "id": "actuator",
                "name": "Actuator",
                "badge": "基础",
                "summary": "Spring Boot 自带健康检查与运行时信息。是容器编排（K8s）探针的必要条件。",
                "dependencies": [
                    {"groupId": "org.springframework.boot", "artifactId": "spring-boot-starter-actuator"},
                ],
                "yaml": (
                    "management:\n"
                    "  endpoints:\n"
                    "    web:\n"
                    "      exposure:\n"
                    "        # 只暴露必要端点。/env、/heapdump、/beans 绝不能对公网开放\n"
                    "        include: health,info,metrics\n"
                    "  endpoint:\n"
                    "    health:\n"
                    "      # 默认不对匿名用户展示细节（含数据库连接状态等内部信息）\n"
                    "      show-details: when_authorized\n"
                    "      probes:\n"
                    "        enabled: true        # 开启 K8s liveness/readiness 探针\n"
                    "  server:\n"
                    "    port: 8081              # 可选：管理端口与业务端口分离，避免暴露业务端口"
                ),
                "notes": [
                    "/actuator/health 用作 K8s 探针时，注意它会检查数据库连接 —— "
                    "数据库短暂抖动会导致 Pod 被重启，往往适得其反。必要时把 db 健康检查排除。",
                    "管理端口建议与业务端口分离，安全边界更清晰。",
                ],
                "pitfalls": [
                    "exposure.include: \"*\"：/heapdump 能直接下载整个堆内存，里面有全部凭据与用户数据。",
                    "health 检查包含数据库且用于 liveness 探针：数据库抖动引起 Pod 反复重启。",
                ],
            },
            {
                "id": "prometheus",
                "name": "Actuator + Prometheus + Grafana",
                "badge": "推荐",
                "summary": "暴露标准指标格式，接入 Prometheus 抓取，Grafana 出图。可做告警与容量规划。",
                "dependencies": [
                    {"groupId": "org.springframework.boot", "artifactId": "spring-boot-starter-actuator"},
                    {"groupId": "io.micrometer", "artifactId": "micrometer-registry-prometheus"},
                    # TimedAspect（@Timed 注解支持）依赖 AspectJ 织入；缺这个依赖
                    # 启动即 NoClassDefFoundError: org/aspectj/lang/ProceedingJoinPoint
                    {"groupId": "org.springframework.boot", "artifactId": "spring-boot-starter-aop",
                     "note": "MetricsConfig 注册 TimedAspect 必需"},
                ],
                "yaml": (
                    "management:\n"
                    "  endpoints:\n"
                    "    web:\n"
                    "      exposure:\n"
                    "        include: health,info,metrics,prometheus\n"
                    "  metrics:\n"
                    "    tags:\n"
                    "      # 打上应用名标签，多服务共用一套 Prometheus 时才能区分\n"
                    "      application: ${spring.application.name}\n"
                    "    distribution:\n"
                    "      percentiles-histogram:\n"
                    "        # 开启后才有 P95/P99 直方图，只看平均值会漏掉长尾\n"
                    "        http.server.requests: true\n"
                    "    export:\n"
                    "      prometheus:\n"
                    "        enabled: true"
                ),
                "configClasses": [
                    {
                        "className": "MetricsConfig",
                        "path": "src/main/java/com/example/config/MetricsConfig.java",
                        "code": (
                            "package com.example.config;\n"
                            "\n"
                            "import io.micrometer.core.aop.TimedAspect;\n"
                            "import io.micrometer.core.instrument.MeterRegistry;\n"
                            "import org.springframework.context.annotation.Bean;\n"
                            "import org.springframework.context.annotation.Configuration;\n"
                            "\n"
                            "/**\n"
                            " * 自定义业务指标。\n"
                            " *\n"
                            " * 为什么需要它：HTTP 指标只能告诉你「接口变慢了」，\n"
                            " * 但告诉不了你「是哪一类业务变慢了」。\n"
                            " * 加上业务维度的计数器，才能把技术指标映射回业务问题。\n"
                            " *\n"
                            " * 指标命名约定：<域>_<对象>_<动作>_<单位>，\n"
                            " * 例如 order_create_total、import_rows_processed_total。\n"
                            " */\n"
                            "@Configuration\n"
                            "public class MetricsConfig {\n"
                            "\n"
                            "    /** 开启 @Timed 注解支持（AOP 代理），否则 @Timed 不会生效。 */\n"
                            "    @Bean\n"
                            "    public TimedAspect timedAspect(MeterRegistry registry) {\n"
                            "        return new TimedAspect(registry);\n"
                            "    }\n"
                            "}"
                        ),
                    }
                ],
                "sample": {
                    "title": "业务指标埋点",
                    "lang": "java",
                    "code": (
                        "@Service\n"
                        "public class OrderService {\n"
                        "\n"
                        "    private final Counter orderCreatedCounter;\n"
                        "    private final Counter orderFailedCounter;\n"
                        "\n"
                        "    // 计数器在构造时注册一次，不要在方法里反复 Counter.builder()\n"
                        "    public OrderService(MeterRegistry registry) {\n"
                        "        this.orderCreatedCounter = Counter.builder(\"order_create_total\")\n"
                        "                .description(\"成功创建的订单数\")\n"
                        "                .register(registry);\n"
                        "        this.orderFailedCounter = Counter.builder(\"order_create_failed_total\")\n"
                        "                .description(\"创建失败的订单数\")\n"
                        "                .tag(\"reason\", \"business\")\n"
                        "                .register(registry);\n"
                        "    }\n"
                        "\n"
                        "    @Transactional(rollbackFor = Exception.class)\n"
                        "    public long create(OrderCreateRequest request) {\n"
                        "        try {\n"
                        "            long id = orderRepository.insert(buildOrder(request));\n"
                        "            orderCreatedCounter.increment();\n"
                        "            return id;\n"
                        "        } catch (BizException e) {\n"
                        "            orderFailedCounter.increment();\n"
                        "            throw e;\n"
                        "        }\n"
                        "    }\n"
                        "}"
                    ),
                },
                "notes": [
                    "必须开 percentiles-histogram，否则只有平均值。平均响应 100ms 的背后可能是「99% 是 10ms，1% 是 9 秒」。",
                    "告警要基于症状（错误率、P99 延迟、队列积压）而不是原因（CPU 使用率）。",
                    "自定义业务指标比技术指标更有价值：它能把「系统慢」翻译成「哪类业务出问题」。",
                ],
                "pitfalls": [
                    "标签值里放用户 id / 订单号：指标基数爆炸，Prometheus 内存被撑爆。",
                    "只看平均值做容量规划：长尾被完全掩盖。",
                    "Counter 在方法内 builder 注册：每次调用都新建，指标数据错乱且内存增长。",
                ],
            },
        ],
    },
    {
        "id": "mapping",
        "groupId": "crosscut",
        "name": "对象映射",
        "why": "Entity / DTO / VO 之间的转换。字段少时手写更清晰，字段多时映射器更省事。",
        "defaultOption": "manual",
        "options": [
            {
                "id": "manual",
                "name": "手写静态工厂方法",
                "badge": "推荐",
                "summary": "在 DTO 上写 from(Entity) 静态方法。零依赖、零魔法、编译期检查、调试直观。",
                "dependencies": [],
                "sample": {
                    "title": "标准写法：把转换与脱敏收在一处",
                    "lang": "java",
                    "code": (
                        "public record UserResponse(Long id, String username, String mobile) {\n"
                        "\n"
                        "    /**\n"
                        "     * 实体 → 出参。\n"
                        "     *\n"
                        "     * 为什么不放在 Controller 或工具类里：\n"
                        "     *   转换逻辑跟着 DTO 走，改字段时你在改这个文件，\n"
                        "     *   编译错误会直接指出所有需要同步修改的地方。\n"
                        "     */\n"
                        "    public static UserResponse from(User user) {\n"
                        "        if (user == null) {\n"
                        "            return null;\n"
                        "        }\n"
                        "        return new UserResponse(\n"
                        "                user.getId(),\n"
                        "                user.getUsername(),\n"
                        "                Desensitize.mobile(user.getMobile()));\n"
                        "    }\n"
                        "}"
                    ),
                },
                "notes": [
                    "字段少于 10 个时手写通常比引入映射器更划算：可读、可断点、无反射开销。",
                    "把脱敏、格式化这类副作用放在转换方法里，能保证「不会漏」。",
                ],
                "pitfalls": ["在 Controller 里内联转换：转换逻辑散落各处，加字段时必然漏改某一处。"],
            },
            {
                "id": "mapstruct",
                "name": "MapStruct",
                "badge": "字段多时",
                "summary": "编译期生成映射代码，运行期零反射。字段几十个的实体，用它比手写省事。",
                "dependencies": [
                    {"groupId": "org.mapstruct", "artifactId": "mapstruct", "version": "1.5.5.Final"},
                    {"groupId": "org.mapstruct", "artifactId": "mapstruct-processor", "version": "1.5.5.Final",
                     "scope": "provided"},
                    {"groupId": "org.projectlombok", "artifactId": "lombok-mapstruct-binding", "version": "0.2.0",
                     "note": "同时用 Lombok 时必须加，否则生成的代码引用不到 Lombok 生成的 getter"},
                ],
                "sample": {
                    "title": "映射器声明",
                    "lang": "java",
                    "code": (
                        "@Mapper(componentModel = MappingConstants.ComponentModel.SPRING,\n"
                        "        unmappedTargetPolicy = ReportingPolicy.ERROR)\n"
                        "public interface UserConverter {\n"
                        "\n"
                        "    // 字段名不一致时显式声明映射，不要靠猜\n"
                        "    @Mapping(source = \"mobile\", target = \"mobile\", qualifiedByName = \"desensitizeMobile\")\n"
                        "    UserResponse toResponse(User user);\n"
                        "\n"
                        "    @Named(\"desensitizeMobile\")\n"
                        "    default String desensitizeMobile(String mobile) {\n"
                        "        return Desensitize.mobile(mobile);\n"
                        "    }\n"
                        "}\n"
                        "\n"
                        "// 注意 unmappedTargetPolicy = ERROR：\n"
                        "// 默认是 WARN，结果就是「目标对象某个字段没被映射」这种问题\n"
                        "// 只在运行期表现为「字段是 null」，编译期完全沉默。\n"
                        "// 设成 ERROR 后，漏映射会直接编译失败。"
                    ),
                },
                "notes": [
                    "unmappedTargetPolicy 必须设成 ERROR。默认 WARN 会让漏字段变成运行期的 null。",
                    "与 Lombok 同时使用时必须加 lombok-mapstruct-binding，否则注解处理器顺序问题会导致生成代码编译失败。",
                    "生成的实现类在 target/generated-sources 下，出问题时可以直接看它到底生成了什么。",
                ],
                "pitfalls": [
                    "漏加 lombok-mapstruct-binding：报「找不到 getter 方法」且指向莫名其妙的位置。",
                    "保持默认 WARN：字段没映射不报错，只在上线后表现为某个字段总是 null。",
                ],
            },
        ],
    },
    {
        "id": "boilerplate",
        "groupId": "crosscut",
        "name": "样板代码策略",
        "why": "决定 getter/构造器/日志声明是手写还是生成。这是团队偏好，不是对错问题。",
        "defaultOption": "lombok",
        "options": [
            {
                "id": "lombok",
                "name": "使用 Lombok",
                "badge": "简洁",
                "summary": "@Data / @RequiredArgsConstructor / @Slf4j 消除大量样板代码，代码更短更聚焦。",
                "dependencies": [
                    {"groupId": "org.projectlombok", "artifactId": "lombok", "scope": "provided"},
                ],
                "sample": {
                    "title": "常用组合与三条使用边界",
                    "lang": "java",
                    "code": (
                        "@Slf4j                       // 替代手写 LoggerFactory\n"
                        "@Service\n"
                        "@RequiredArgsConstructor     // 为所有 final 字段生成构造器（构造器注入的简写）\n"
                        "public class UserService {\n"
                        "\n"
                        "    private final UserRepository userRepository;\n"
                        "    private final PasswordEncoder passwordEncoder;\n"
                        "\n"
                        "    public Long create(CreateUserRequest request) {\n"
                        "        log.info(\"创建用户 username={}\", request.username());\n"
                        "        // ...\n"
                        "    }\n"
                        "}\n"
                        "\n"
                        "// ── 三条边界 ──────────────────────────────────────\n"
                        "// 1. 实体类不要用 @Data 生成 setter：实体应当只有明确的\n"
                        "//    业务方法，而不是让任何字段都能被任意改写。\n"
                        "// 2. 不要用 @Builder 去构造需要校验的对象：\n"
                        "//    builder 会绕过构造器里的参数校验。\n"
                        "// 3. 不要用 @EqualsAndHashCode 于 JPA 实体：\n"
                        "//    关联实体互相引用会导致无限递归与延迟加载异常。"
                    ),
                },
                "notes": [
                    "@RequiredArgsConstructor 是构造器注入最简洁的表达，但要显式声明 `private final` 字段。",
                    "IDE 需要安装 Lombok 插件，否则会报「找不到 getter」。CI 上则靠注解处理器，不影响构建。",
                ],
                "pitfalls": [
                    "在实体上用 @Data：等于给所有字段开了 setter，破坏封装。",
                    "@Builder 绕过构造器校验：必填字段可以为 null 地构造出来。",
                    "@EqualsAndHashCode 用在双向关联实体上：栈溢出。",
                ],
            },
            {
                "id": "plain",
                "name": "不用 Lombok（纯手写）",
                "badge": "零魔法",
                "summary": "手写 getter/setter/构造器。代码更长，但没有任何编译期魔法，调试与阅读零障碍。",
                "dependencies": [],
                "sample": {
                    "title": "手写写法",
                    "lang": "java",
                    "code": (
                        "@Service\n"
                        "public class UserService {\n"
                        "\n"
                        "    private static final Logger log = LoggerFactory.getLogger(UserService.class);\n"
                        "\n"
                        "    private final UserRepository userRepository;\n"
                        "\n"
                        "    public UserService(UserRepository userRepository) {\n"
                        "        this.userRepository = userRepository;\n"
                        "    }\n"
                        "\n"
                        "    public Long create(CreateUserRequest request) {\n"
                        "        log.info(\"创建用户 username={}\", request.username());\n"
                        "        // ...\n"
                        "    }\n"
                        "}\n"
                        "\n"
                        "// 显式构造器的额外好处：\n"
                        "// 依赖一变，测试代码会立刻编译失败，\n"
                        "// 依赖变更在编译期暴露，而不是运行期变成 NPE。"
                    ),
                },
                "notes": [
                    "对于入参 / 出参优先用 record，能省掉绝大部分 getter/setter 手写量。",
                    "团队里如果有成员不熟悉 Lombok，混用时容易出现「看不懂为什么能编译」的摩擦。",
                ],
                "pitfalls": ["record 不能用于需要 setter 绑定的 @ModelAttribute 查询对象，那种仍要手写。"],
            },
        ],
    },
    {
        "id": "test",
        "groupId": "crosscut",
        "name": "测试策略",
        "why": "决定测试能跑多快、能覆盖多深。集成测试很有价值，但必须有选择地使用。",
        "defaultOption": "mockito",
        "options": [
            {
                "id": "mockito",
                "name": "JUnit 5 + Mockito",
                "badge": "推荐",
                "summary": "纯单元测试，外部依赖全部 Mock。毫秒级执行，可在每次提交前全量跑。",
                "dependencies": [
                    {"groupId": "org.springframework.boot", "artifactId": "spring-boot-starter-test",
                     "scope": "test", "note": "已含 JUnit 5、Mockito、AssertJ"},
                ],
                "sample": {
                    "title": "三种测试的适用范围",
                    "lang": "java",
                    "code": (
                        "// ① 纯单元测试：只测业务逻辑，不启动 Spring 容器。\n"
                        "//    快（毫秒级）、稳定，覆盖 Service 的分支逻辑。\n"
                        "@ExtendWith(MockitoExtension.class)\n"
                        "class UserServiceTest { /* 见蓝图：标准 CRUD 垂直切片 */ }\n"
                        "\n"
                        "// ② 切片测试：只启动 Web 层，Service 用 @MockBean。\n"
                        "//    用于验证「参数校验、异常出口、JSON 结构」是否正确。\n"
                        "@WebMvcTest(UserController.class)\n"
                        "class UserControllerTest {\n"
                        "\n"
                        "    @Autowired\n"
                        "    private MockMvc mockMvc;\n"
                        "\n"
                        "    @MockBean\n"
                        "    private UserService userService;\n"
                        "\n"
                        "    @Test\n"
                        "    @DisplayName(\"创建用户：缺用户名时返回 400 且带字段级原因\")\n"
                        "    void create_shouldRejectBlankUsername() throws Exception {\n"
                        "        mockMvc.perform(post(\"/api/v1/users\")\n"
                        "                        .contentType(MediaType.APPLICATION_JSON)\n"
                        "                        .content(\"{\\\"username\\\":\\\"\\\",\\\"mobile\\\":\\\"13800138000\\\"}\"))\n"
                        "                .andExpect(status().isBadRequest())\n"
                        "                .andExpect(jsonPath(\"$.code\").value(40001))\n"
                        "                // 关键断言：错误信息里必须指出是哪个字段\n"
                        "                .andExpect(jsonPath(\"$.message\").value(\"containsString(\\\"username\\\")\"));\n"
                        "    }\n"
                        "}\n"
                        "\n"
                        "// ③ 集成测试：真实数据库。数量要克制 —— 它慢、脆、且失败原因难定位。\n"
                        "//    只用于验证「SQL 语句、事务行为、ORM 映射」这三件事。\n"
                        "@SpringBootTest\n"
                        "@Transactional   // 每个用例结束自动回滚，保证独立性\n"
                        "class UserRepositoryIT { }"
                    ),
                },
                "notes": [
                    "测试金字塔：单元测试占绝大多数，切片测试次之，集成测试最少。倒过来会得到一个跑 20 分钟的测试套件，然后没人跑它。",
                    "断言用 AssertJ（assertThat）或 JUnit 的 assertEquals，禁止 System.out 人肉验证。",
                    "每个用例必须独立：共享状态的测试会在并行执行时随机失败。",
                ],
                "pitfalls": [
                    "测试之间共享数据库状态：执行顺序一变就失败，最后没人敢动测试。",
                    "@MockBean 用太多：等于在测一个「你以为的」Spring 配置，而不是真实的。",
                    "只断言没抛异常（不写 verify）：失败路径的副作用完全没被验证。",
                ],
            },
            {
                "id": "testcontainers",
                "name": "JUnit 5 + Testcontainers",
                "badge": "真实环境",
                "summary": "用 Docker 起真实的 MySQL/Redis 跑测试。环境与生产一致，避免「本地过、线上挂」。",
                "dependencies": [
                    {"groupId": "org.springframework.boot", "artifactId": "spring-boot-starter-test", "scope": "test"},
                    {"groupId": "org.springframework.boot", "artifactId": "spring-boot-testcontainers",
                     "scope": "test"},
                    {"groupId": "org.testcontainers", "artifactId": "mysql", "scope": "test"},
                    {"groupId": "org.testcontainers", "artifactId": "junit-jupiter", "scope": "test"},
                ],
                "configClasses": [
                    {
                        "className": "TestcontainersConfig",
                        "path": "src/test/java/com/example/support/TestcontainersConfig.java",
                        "code": (
                            "package com.example.support;\n"
                            "\n"
                            "import org.springframework.boot.test.context.TestConfiguration;\n"
                            "import org.springframework.boot.testcontainers.service.connection.ServiceConnection;\n"
                            "import org.springframework.context.annotation.Bean;\n"
                            "import org.testcontainers.containers.MySQLContainer;\n"
                            "\n"
                            "/**\n"
                            " * 集成测试用真实数据库。\n"
                            " *\n"
                            " * 关键：容器是 static 且只启动一次（@ServiceConnection 会把\n"
                            " * 连接信息自动注入 datasource 配置），所有测试类共享。\n"
                            " * 每个测试类起一个容器会让测试套件慢到没人愿意跑。\n"
                            " *\n"
                            " * 另一个好处是：它验证的是真实的 MySQL 行为，\n"
                            " * 包括字符集、排序规则、唯一索引冲突的具体错误码 ——\n"
                            " * 这些用 H2 永远测不出来。\n"
                            " */\n"
                            "@TestConfiguration(proxyBeanMethods = false)\n"
                            "public class TestcontainersConfig {\n"
                            "\n"
                            "    @Bean\n"
                            "    @ServiceConnection\n"
                            "    public MySQLContainer<?> mysqlContainer() {\n"
                            "        return new MySQLContainer<>(\"mysql:8.0.36\")\n"
                            "                // 必须指定 utf8mb4，否则测不出 emoji 相关的字符集问题\n"
                            "                .withCommand(\"--character-set-server=utf8mb4\",\n"
                            "                        \"--collation-server=utf8mb4_general_ci\")\n"
                            "                .withReuse(true);\n"
                            "    }\n"
                            "}"
                        ),
                    }
                ],
                "notes": [
                    "CI 环境必须有 Docker，否则整批集成测试跑不起来 —— 这是选它的主要前提。",
                    "容器共享（static 容器 + withReuse）是让测试套件保持可接受耗时的关键。",
                    "不要用它替代单元测试。它慢一个数量级，应该只覆盖「必须依赖真实数据库」的场景。",
                ],
                "pitfalls": [
                    "每个测试类起一个新容器：套件耗时从 30 秒变成 10 分钟。",
                    "CI 没有 Docker 权限：本地能过、流水线上全红。",
                    "用 H2 模拟 MySQL：方言差异导致「测试全过、上线就挂」。",
                ],
            },
        ],
    },
]
