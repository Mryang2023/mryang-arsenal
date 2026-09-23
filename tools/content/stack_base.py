# -*- coding: utf-8 -*-
"""选型维度 · 基础组：JDK / 构建工具 / Web 框架。"""

GROUPS = [
    {"id": "base", "name": "基础", "glyph": "◇",
     "desc": "决定语言能力与运行时模型，改起来最贵，一开始就要定对。"},
    {"id": "data", "name": "数据访问", "glyph": "▦",
     "desc": "持久层、数据库、连接池、迁移。项目里最不容易返工的一块。"},
    {"id": "middleware", "name": "中间件", "glyph": "⇉",
     "desc": "缓存、消息、注册中心、调度。每引入一个就多一个运维面。"},
    {"id": "crosscut", "name": "横切关注点", "glyph": "⛨",
     "desc": "鉴权、文档、监控、对象映射、样板代码、测试。"},
    {"id": "delivery", "name": "交付与运行", "glyph": "⬢",
     "desc": "打包、容器化、编排与发布。这一组反向约束业务代码：无状态、优雅停机、还要能自证健康。"},
]

DIMENSIONS = [
    {
        "id": "jdk",
        "groupId": "base",
        "name": "JDK 版本",
        "why": "决定能用哪些语言特性。17 是当前最稳的 LTS，21 才有虚拟线程。",
        "defaultOption": "17",
        "options": [
            {
                "id": "17",
                "name": "Java 17 (LTS)",
                "badge": "稳妥",
                "summary": "record、密封类、switch 表达式、text block 全部可用。生态兼容性最好，所有框架都完整支持。",
                "pomProperties": {"java.version": "17"},
                "notes": [
                    "record 让 DTO 与值对象变得极简，是这一版最大的收益。",
                    "Spring Boot 3.x 最低要求就是 17，低于它的项目必须先升级。",
                ],
                "pitfalls": ["不要用 var 去接 lambda 返回值，可读性会明显下降。"],
            },
            {
                "id": "21",
                "name": "Java 21 (LTS)",
                "badge": "前沿",
                "summary": "在 17 基础上增加虚拟线程、模式匹配 for switch、记录模式、分代 ZGC。",
                "pomProperties": {"java.version": "21"},
                "yaml": "# 虚拟线程：每请求一个虚拟线程，IO 等待不再占用平台线程\nspring:\n  threads:\n    virtual:\n      enabled: true",
                "sample": {
                    "title": "虚拟线程不是银弹：瓶颈会转移到连接池",
                    "lang": "yaml",
                    "code": (
                        "spring:\n"
                        "  threads:\n"
                        "    virtual:\n"
                        "      enabled: true\n"
                        "\n"
                        "# 开启后，Tomcat 不再受 max-threads 约束，\n"
                        "# 请求并发能力急剧上升 —— 但数据库连接池 maximum-pool-size 没变。\n"
                        "# 结果是大量虚拟线程在等连接，表现从「线程不够」变成「获取连接超时」。\n"
                        "# 所以要配套重新审视连接池大小与下游限流。"
                    ),
                },
                "notes": [
                    "虚拟线程适合 IO 密集场景；CPU 密集场景没有收益，反而增加调度开销。",
                    "synchronized 块会 pin 住载体线程，虚拟线程场景下应改用 ReentrantLock。",
                    "踩坑提醒：虚拟线程数与数据库连接池不是同一个量级，必须显式限流。",
                ],
                "pitfalls": [
                    "以为开了虚拟线程就能提吞吐：真实的瓶颈往往在连接池或下游。",
                    "在虚拟线程里用 ThreadLocal 缓存大对象：内存占用会成倍放大。",
                ],
            },
        ],
    },
    {
        "id": "build",
        "groupId": "base",
        "name": "构建工具",
        "why": "决定依赖解析与构建脚本的形态。单模块项目两者差别不大，多模块时差异明显。",
        "defaultOption": "maven",
        "options": [
            {
                "id": "maven",
                "name": "Maven",
                "badge": "通用",
                "summary": "约定优于配置，生态最广，团队上手成本最低。BOM 依赖管理成熟。",
                "notes": [
                    "spring-boot-starter-parent 已经管好绝大多数版本，业务依赖不要手写 version。",
                    "多模块用 <dependencyManagement> 统一版本，禁止子模块各自声明。",
                ],
                "pitfalls": ["依赖冲突用 mvn dependency:tree 定位，不要靠猜。"],
            },
            {
                "id": "gradle",
                "name": "Gradle",
                "badge": "灵活",
                "summary": "构建脚本即代码，增量构建更快，多模块与自定义任务更灵活。代价是需要维护脚本本身。",
                "dependencies": [
                    {"groupId": "", "artifactId": "", "kind": "plugin",
                     "note": "Gradle 使用 plugins 块而非 Maven 依赖坐标，见下方样例"},
                ],
                "sample": {
                    "title": "build.gradle 关键片段",
                    "lang": "text",
                    "code": (
                        "plugins {\n"
                        "    id 'java'\n"
                        "    id 'org.springframework.boot' version '3.2.5'\n"
                        "    id 'io.spring.dependency-management' version '1.1.4'\n"
                        "}\n"
                        "\n"
                        "java {\n"
                        "    toolchain { languageVersion = JavaLanguageVersion.of(17) }\n"
                        "}\n"
                        "\n"
                        "dependencies {\n"
                        "    // 版本同样交给 BOM，不写版本号\n"
                        "    implementation 'org.springframework.boot:spring-boot-starter-web'\n"
                        "    implementation 'org.springframework.boot:spring-boot-starter-validation'\n"
                        "    testImplementation 'org.springframework.boot:spring-boot-starter-test'\n"
                        "}"
                    ),
                },
                "notes": [
                    "用 toolchain 指定 JDK，避免依赖本机 JAVA_HOME。",
                    "不要把构建逻辑写成几百行的脚本 —— 那等于把构建系统变成了需要维护的应用。",
                ],
                "pitfalls": ["Gradle 版本与 Spring Boot 插件版本必须匹配，否则报错信息会指向无关位置。"],
            },
        ],
    },
    {
        "id": "web",
        "groupId": "base",
        "name": "Web 运行时",
        "why": "决定线程模型与编程范式。绝大多数业务系统应该选 MVC。",
        "defaultOption": "mvc",
        "options": [
            {
                "id": "mvc",
                "name": "Spring MVC + Tomcat",
                "badge": "推荐",
                "summary": "同步阻塞、每请求一线程。编程模型直观，调试容易，生态与文档最全。",
                "dependencies": [
                    {"groupId": "org.springframework.boot", "artifactId": "spring-boot-starter-web",
                     "note": "已内嵌 Tomcat，无需单独引入"},
                ],
                "notes": [
                    "同步阻塞意味着一次慢查询会占住一个线程 —— 所以要设超时、要限连接数。",
                    "搭配线程池做异步任务（见蓝图「异步任务」），比全站 reactive 务实得多。",
                ],
                "pitfalls": ["默认 max-threads=200，配置成 2000 并不能提高吞吐，只会让下游被打爆。"],
            },
            {
                "id": "webflux",
                "name": "Spring WebFlux + Netty",
                "badge": "高阶",
                "summary": "响应式非阻塞，少量线程承载高并发连接。适合网关、流式转发、大量长连接场景。",
                "dependencies": [
                    {"groupId": "org.springframework.boot", "artifactId": "spring-boot-starter-webflux"},
                ],
                "yaml": "spring:\n  codec:\n    max-in-memory-size: 2MB   # 不设上限时，大响应体会把堆撑爆",
                "sample": {
                    "title": "响应式 Controller 写法",
                    "lang": "java",
                    "code": (
                        "@RestController\n"
                        "@RequestMapping(\"/api/v1/users\")\n"
                        "public class UserController {\n"
                        "\n"
                        "    private final UserService userService;\n"
                        "\n"
                        "    public UserController(UserService userService) {\n"
                        "        this.userService = userService;\n"
                        "    }\n"
                        "\n"
                        "    // 注意返回的是 Mono/Flux，不是普通对象\n"
                        "    @GetMapping(\"/{id}\")\n"
                        "    public Mono<ApiResponse<UserResponse>> detail(@PathVariable long id) {\n"
                        "        return userService.detail(id).map(ApiResponse::ok);\n"
                        "    }\n"
                        "}"
                    ),
                },
                "notes": [
                    "整条链路都必须是响应式的。只要中间有一处阻塞调用（如 JDBC、RestTemplate），"
                    "收益立刻归零，且阻塞会被放大到整个事件循环上。",
                    "阻断式 JDBC 不可用，必须换 R2DBC 或把阻塞调用扔到独立调度器上。",
                    "排障难度显著高于 MVC：堆栈里全是 reactor 的操作符，看不出业务语义。",
                ],
                "pitfalls": [
                    "在响应式链路里调用阻塞接口：少数几个阻塞就会拖死整个事件循环。",
                    "为了「技术先进」而选 WebFlux：CRUD 业务几乎无收益，维护成本却高一个量级。",
                ],
            },
        ],
    },
]


# ─────────────────────────────────────────────────────────────
# 技术栈基底（全局声明，**不是**选型维度）
# ─────────────────────────────────────────────────────────────
# 为什么不做成 dimension：
#   架构图把「每个维度 = 图上一个槽位」当硬约束 —— build-content.py 的
#   build_architecture 要求每个维度都配齐 NODE_ARCH / OPTION_ARCH /
#   CANVAS_DIMS / CANVAS_OPTIONS，缺一即构建失败。而「技术栈基底」是全局属性、
#   不是系统里的某个组件，硬塞成维度只会得到一张又怪又假的图。
#   所以它是 stack.json 的顶层字段 `bases`，由装配台顶部单独渲染与选择。
#
# covered 的语义必须诚实：False = 本平台尚无该基底的骨架 / 规则 / 部署指引，
#   前端只能显式提示「未覆盖」，绝不伪造产物。
# 版本号与支持窗口取自公开发布记录（2026-09-23 核对），不是估的：
#   4.1.1 / 4.0.8 为当前 OSS 支持线；3.5 / 3.2 线已 EOL。
BASES = [
    {
        "id": "boot41",
        "name": "Spring Boot 4.1",
        "vendor": "Spring",
        "version": "4.1.1",
        "line": "4.1",
        "java": "17+",
        "status": "supported",
        "supportedUntil": "2027-06-30",
        "covered": True,
        "recommended": True,
        "summary": "当前 OSS 支持线。要长期维护的新项目应从这一线起步。",
        "note": "骨架模板按 3.x 编写；4.x 是大版本跃迁（Spring Framework 7），"
                "依赖坐标与配置项需按官方迁移指引复核后再用。",
    },
    {
        "id": "boot40",
        "name": "Spring Boot 4.0",
        "vendor": "Spring",
        "version": "4.0.8",
        "line": "4.0",
        "java": "17+",
        "status": "supported",
        "supportedUntil": "2026-12-31",
        "covered": True,
        "summary": "仍在 OSS 支持窗口内，但支持期只剩数月；新项目建议直接上 4.1。",
        "note": "同 4.1，属大版本跃迁；骨架需按官方迁移指引复核。",
    },
    {
        "id": "boot35",
        "name": "Spring Boot 3.5",
        "vendor": "Spring",
        "version": "3.5.16",
        "line": "3.5",
        "java": "17+",
        "status": "eol",
        "supportedUntil": "2026-06-30",
        "covered": True,
        "summary": "3.x 的最后一个功能线，OSS 支持已于 2026-06-30 结束。",
        "note": "骨架与其基本对齐（3.x 语义），是 3.x 中风险最低的落点；"
                "但 EOL 后不再有 OSS 安全补丁。",
    },
    {
        "id": "boot32",
        "name": "Spring Boot 3.2",
        "vendor": "Spring",
        "version": "3.2.12",
        "line": "3.2",
        "java": "17+",
        "status": "eol",
        "supportedUntil": "2024-12-31",
        "covered": True,
        "summary": "本平台骨架模板的原始基线，OSS 支持早在 2024-12-31 结束。",
        "note": "默认值沿用它只为「与现有骨架逐字节一致」；它已 EOL 一年多，"
                "仅作了同线 patch（3.2.5 → 3.2.12）。新项目不应以此起步。",
    },
    {
        "id": "quarkus",
        "name": "Quarkus",
        "vendor": "Red Hat",
        "version": "3.x",
        "line": "3",
        "java": "17+",
        "status": "uncovered",
        "covered": False,
        "summary": "本平台尚未覆盖的非 Spring 技术栈。",
        "note": "规则库、骨架库、部署指引全部按 Spring Boot 编写；"
                "选中它不会生成任何 Quarkus 产物，仅作为声明。",
    },
    {
        "id": "micronaut",
        "name": "Micronaut",
        "vendor": "Object Computing",
        "version": "4.x",
        "line": "4",
        "java": "17+",
        "status": "uncovered",
        "covered": False,
        "summary": "本平台尚未覆盖的非 Spring 技术栈。",
        "note": "同上：只是声明，不产出 Micronaut 产物。",
    },
]

# 默认基底：保持与现有骨架一致（3.2 线最终 patch），不擅自把默认值抬到未验证的 4.x
DEFAULT_BASE = 'boot32'
