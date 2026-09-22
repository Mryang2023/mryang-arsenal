# 方案 4 · 代码入库：给一个仓库出架构图 + 出图服务

> **一句话**：让 `/arch` 和 `/archify` 都能**从代码出发** —— 给一个本地目录、一个 zip、或一个 git 仓库地址，扫描出事实，自动生成该项目的应用分层图、部署架构图、以及一张可交付的 HTML 架构图。
> **建议时段**：第 4 晚（23:00 后，最重的一份）
> **依赖**：**必须在方案 1、3 之后**
> —— 方案 1 提供图标（扫描出来的每个技术都要有图标），方案 3 定下「交付级架构图」的版式（本方案的图直接复用）。
> **预计产出**：后端 `com.arsenal.scan` 包 + 3 个接口 + 扫描规则表 + `/archify` 第三输入源 + fixture 测试仓库

---

## 0. 开工必读

| 顺序 | 文件 | 看什么 |
|---|---|---|
| 1 | `docs/hy4-night-plans/00-index.md` | 四条铁律、环境备忘 |
| 2 | `README.md` 的「出图服务」两节 | `/archify` 的契约：**IR 进，HTML 出** |
| 3 | `arsenal-web/src/lib/archify-ir.ts` | **IR 的完整字段**，本方案最终就是生产这个 |
| 4 | `arsenal-server/.../archify/ArchifyService.java` | 后端怎么调 Node 渲染器；**本次一行不改它** |
| 5 | `arsenal-server/.../web/ArchifyController.java` | 接口风格（`ApiResponse<T>`、状态码约定） |
| 6 | `arsenal-web/src/lib/arch-canvas.ts` | `TechArch` 模型形状 —— 扫描结果要产出这个 |
| 7 | `arsenal-web/src/lib/arch-profile.ts` | 六视图档案的 schema（扫描要产出**草稿**） |
| 8 | `arsenal-web/src/lib/tech-icons.ts` | 技术 key 的合法取值（扫描结果必须能对上图标） |
| 9 | `arsenal-server/src/main/java/com/arsenal/loader/` | 现有文件读取与校验风格，照抄 |
| 10 | `arsenal-server/.verify/ArchifyProbe.java` | 后端探针的写法，本方案要照着写 `ScanProbe.java` |

---

## 1. 现状（已核实）

### 1.1 `/archify` 已经做对的部分（**不要重做**）

| 项 | 现状 |
|---|---|
| 契约 | IR 进，HTML 出。输入已解耦，不限于军火库自己生成的 IR |
| 三个输入源 | ① 手粘 textarea ② 上传 `.json` ③ 「用当前选型生成一份」 |
| 本地两道预检 | `archifyIrShapeIssues()`（形状）+ `archifyIrIssues()`（已知结构坑）—— 两道都过才发请求 |
| 三类结果分开显示 | 形状不对（改文件）/ 构图没过（改 IR，诊断逐条列）/ 后端不可达（给离线出路） |
| 后端 | `POST /api/archify/deliver`，请求体**就是 IR 本身**；`ArchifyService` 用 `ProcessBuilder` 调 `node <wrench-ai.mjs> deliver architecture <in> <out> --quality showcase --json` |
| 实测 | 7 组件 · 6 连线 · 4 分区 · 4 阅读路径 → 9/9 检查通过，381 ms，705 KB HTML |

### 1.2 缺的那一块

**全仓没有任何「读代码」的能力**：

- 前端无 `simple-git` / `child_process` / 任何文件扫描代码
- 后端 `ArchifyService` 只接收 IR、落临时文件、跑 Node CLI、翻译结果 —— **它不参与分析代码**
- `deploy.ts` 生成的 Makefile 模板里出现的 `$(shell git rev-parse ...)` 是**写进导出文件的文本**，本项目不执行

所以本方案要做的是**一个新引擎**：`代码 → 事实 → 图`。这是四份方案里唯一「从零建一块」的。

### 1.3 一个必须澄清的命名歧义

**仓库里没有叫「软件架构图」的东西。** 全仓 grep 无命中（只有 OWASP 的英文 "Software and Data Integrity"）。

本方案对「软件架构图」的裁定：

> **软件架构图 = 交付级架构图 = 两类图的组合**
> ① **应用分层架构图**：页面层 → 控制器 → 服务 → 数据访问 → 存储，答「代码是怎么分的」
> ② **部署架构图**：进程 / 中间件 / 存储 / 网关，答「跑起来长什么样」
> 前者新增（`buildLayeredArch()`），后者复用方案 3 的 `TechArch` / `buildTechArchSvg`

**如果你说的「软件架构图」是别的意思**（比如只想要第 ② 张，或想要 C4 风格的 context/container 图），改本方案 §3.4 的两条即可，其余不变。

---

## 2. 目标与非目标

### 目标

- **G1 扫描引擎**：后端新增 `com.arsenal.scan` 包，能吃 ① 本地目录 ② 上传的 zip ③ https git 地址
- **G2 事实提取**：产出 `ProjectFacts` —— 构建、配置、部署、代码结构、CI 五类事实，**只记录读到的，不许猜**
- **G3 技术栈归一化**：把依赖坐标映射到 `tech-icons.ts` 认识的技术 key；映射表是**数据**（`tools/content/scan_rules.py`），可维护可测
- **G4 两条出图链路**：
  - `facts → ArchifyIr → 复用现有出图服务 → HTML`（**后端 `ArchifyService` 一行不改**）
  - `facts → TechArch 模型 → buildTechArchSvg → SVG/PNG`（复用方案 3 的三态输出）
- **G5 新图**：应用分层架构图 `buildLayeredArch(facts)`
- **G6 六视图档案草稿**：`facts → arsenal-profiles/<id>.json` 草稿，能算的自动填、算不出的显式标 `TODO:`，导入 `/arch` 看
- **G7 前端入口**：`/archify` 加第三个输入源「从代码生成」；`/arch` 加「导入项目档案」
- **G8 安全**：扫描是**只读 + 不执行 + 有闸门**的操作，红线见 §6

### 非目标

- ❌ 不做代码质量分析（那是 `/check` 与 `/api/lint` 的职责）
- ❌ 不做增量索引 / 数据库 / 持久化（每次扫描即焚，临时目录 finally 清理）
- ❌ 不改 `ArchifyService`（它已经在正确的位置做了正确的事）
- ❌ 不做私有 git 的凭据管理（只支持公开 https 仓库；私有仓库请自行 clone 后扫本地目录）
- ❌ 不推断业务语义（不猜「这个模块是订单」—— 业务架构视图只能靠档案，扫描只填技术侧）
- ❌ 不引入依赖（前端零依赖；后端沿用现有依赖集）

---

## 3. 设计

### 3.1 整体数据流

```
   输入（三选一）
   ├─ 本地目录路径（后端与代码同机时才有意义）
   ├─ 上传的 zip（走 multipart，后端解包）
   └─ https git 地址（浅克隆 --depth 1 --single-branch）
              │
              ▼
   ┌──────────────────────────────────────┐
   │  ProjectScanner（后端，只读）          │
   │   ├─ BuildScanner    pom/gradle/npm  │
   │   ├─ ConfigScanner   yml/properties  │
   │   ├─ DeployScanner   Dockerfile/K8s  │
   │   ├─ CodeScanner     包结构/注解/路由  │
   │   └─ CiScanner       .gitlab-ci 等   │
   └──────────────┬───────────────────────┘
                  ▼
            ProjectFacts（事实 JSON，只有读到的东西）
                  │
        ┌─────────┼──────────────┬────────────────┐
        ▼         ▼              ▼                ▼
   TechStack    TechArch      LayeredArch      ProfileDraft
   （归一化）    （部署图）      （分层图）        （六视图草稿）
        │         │              │                │
        ▼         ▼              ▼                ▼
     图标映射   SVG/PNG       SVG/PNG        arsenal-profiles/*.json
                                    │
                                    ▼
                             ArchifyIr →（现有）出图服务 → HTML
```

### 3.2 `ProjectFacts` 形状（事实层，**不加解释**）

```jsonc
{
  "schemaVersion": 1,
  "root": "demo-repo",              // 只留目录名，不留绝对路径
  "scannedAt": "2026-09-22T01:10:00+08:00",
  "stats": { "files": 1284, "bytes": 5839102, "truncated": false, "elapsedMs": 812 },

  "build": {
    "kind": "maven",                 // maven|gradle|npm|mixed|unknown
    "artifacts": [ { "path": "pom.xml", "groupId": "com.demo", "artifactId": "demo", "javaVersion": "17" } ],
    "dependencies": [
      { "group": "org.springframework.boot", "artifact": "spring-boot-starter-web", "version": "3.2.5", "scope": "compile" }
    ],
    "plugins": [ { "artifact": "spring-boot-maven-plugin" } ],
    "counts": { "modules": 3, "dependencies": 42 }
  },

  "config": [
    { "path": "src/main/resources/application.yml",
      "keys": ["server.port", "spring.datasource.url", "spring.data.redis.host", "spring.kafka.bootstrap-servers"],
      "values": { "server.port": "8080" } }        // 只记非敏感值；见 §6 脱敏
  ],

  "deploy": {
    "dockerfiles": [ { "path": "Dockerfile", "baseImages": ["eclipse-temurin:17-jre"], "exposedPorts": [8080] } ],
    "compose": [ { "path": "docker-compose.yml", "services": ["app", "mysql", "redis"] } ],
    "k8s": [ { "path": "deploy/k8s/deployment.yaml", "kind": "Deployment", "name": "demo-app", "replicas": 3 } ],
    "helm": [ { "path": "deploy/helm/demo/Chart.yaml", "name": "demo", "replicaCount": 3 } ],
    "nginx": [ { "path": "deploy/nginx.conf", "upstreams": ["demo-app:8080"] } ],
    "ci": [ { "path": ".gitlab-ci.yml", "stages": ["build", "test", "deploy"] } ]
  },

  "code": {
    "packages": [ { "path": "com/demo/order", "files": 14 } ],   // 只取前 3 层
    "layers": { "controller": 6, "service": 9, "repository": 5, "config": 4, "domain": 22 },
    "annotations": { "@RestController": 6, "@Service": 9, "@Component": 4, "@Scheduled": 2, "@KafkaListener": 1 },
    "routes": [ { "method": "GET", "path": "/api/orders/{id}", "class": "OrderController#get" } ],
    "clients": [ { "kind": "feign", "target": "inventory-service" } ]
  },

  "frontend": { "kind": "next", "routes": ["/", "/orders"], "deps": ["react", "next"] },

  "notes": [
    { "level": "warn", "code": "PARSE_SKIPPED", "message": "pom.xml 里 2 个 dependency 缺少 version（由 parent 管理）" }
  ]
}
```

**硬规则**：

1. **`notes` 必须如实记录所有「没看懂」的地方** —— 解析失败、文件过大被跳过、编码异常。**不许静默跳过任何一个文件**
2. **不填推断值**。读不到 `replicas` 就写 `null`，不许写 1
3. **不存绝对路径**（隐私 + 可复现）

### 3.3 技术栈归一化：`tools/content/scan_rules.py`

依赖坐标 → 技术 key 的映射表，**是数据不是代码**：

```python
RULES = [
  dict(match=("org.springframework.boot", "spring-boot-starter-web"),
       tech="spring", node=dict(lane="app", icon="spring", role="应用进程", place="node")),
  dict(match=("com.alibaba.cloud", "spring-cloud-starter-alibaba-nacos-discovery"),
       tech="nacos", node=dict(lane="infra", icon="nacos", role="注册中心", required=False)),
  dict(match=("org.springframework.boot", "spring-boot-starter-data-redis"),
       tech="redis", node=dict(lane="data", icon="redis", role="缓存")),
  dict(match=("com.mysql", "mysql-connector-j"),         tech="mysql"),
  dict(match=("org.elasticsearch.client", "*"),           tech="elasticsearch"),
  dict(match=("org.apache.kafka", "kafka-clients"),       tech="kafka"),
  dict(match=("io.minio", "minio"),                       tech="minio"),
  ...  # 目标：≥80 条，覆盖 tech-icons.ts 里主流的那些
]
```

**未命中怎么办**：**不猜**。进 `facts.notes` 记一条 `UNMAPPED_DEPENDENCY`，并在前端显示「识别到 3 个未收录依赖：xxx、yyy、zzz」。这份未命中清单本身就是**待补的图标与映射**（可以回流给方案 1）。

`match` 支持 `*` 通配，与 `targetGlob` 同风格（复用现有 glob 工具）。

产出：

```jsonc
"techStack": {
  "matched": [ { "tech": "spring", "evidence": [{"path":"pom.xml","line":42,"group":"…","artifact":"…"}] } ],
  "unmatched": [ { "group": "com.foo", "artifact": "bar", "count": 3 } ],
  "coverage": 0.87
}
```

**每条必须有 `evidence`（文件路径 + 行号）** —— 这是「不许猜」的强制形式。

### 3.4 三条出图链路

#### 链路 1 · 部署架构图（复用方案 3）

```
facts.techStack.matched + facts.deploy
      → buildTechArchFromFacts(facts) → TechArch 模型
      → buildTechArchSvg(arch, 'doc' | 'slide' | 'blueprint')
      → SVG / PNG
```

规则：只画 **会被部署的东西**（与 `arch-canvas.ts` 现有原则一致）—— Maven / Lombok 进应用卡的工程属性，不占节点位。
副本数**从 facts 里读**（K8s `replicas` / Helm `replicaCount`）；读不到就画 1 个框并在图上标「未声明副本数」，**不许默认 3**。

#### 链路 2 · 应用分层架构图（新增）

```
facts.code.layers + facts.code.packages + facts.frontend
      → buildLayeredArch(facts) → LayeredArch 模型
      → buildLayeredSvg(arch, theme) → SVG / PNG
```

版式（横向五带，左到右是调用方向）：

```
┌─────────┬──────────────┬──────────────┬──────────────┬─────────┐
│  客户端  │   接入层      │   应用层      │   领域层      │  数据层  │
│ 6 页面   │ 6 Controller │ 9 Service    │ 22 domain    │ 5 Repo  │
│         │ + 网关        │ + 2 定时任务  │ + 4 配置      │ + 缓存  │
└─────────┴──────────────┴──────────────┴──────────────┴─────────┘
   调用方向 →→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→→
```

- 每带里的方块 = 包 / 类分组，**带文件数**
- 带与带之间画主调用箭头；跨带直接调用（Controller → Repository）画成**红色警示线**（这是常见反模式，扫描能抓到，很有价值）
- 右侧窄栏放「横切关注点」：配置、异常、日志、安全

#### 链路 3 · 交付级 HTML（复用现有出图服务）

```
facts → buildArchifyIrFromFacts(facts)
      → archifyIrShapeIssues() + archifyIrIssues()   ← 本地两道预检
      → POST /api/archify/deliver
      → HTML（可预览、可下载）
```

**关键要求**：IR 必须**通过现有九项构图检查**。所以要照抄 `buildArchifyIr` 的硬规律（`archify-ir.ts` 里已写死的那几条）：

- 版式左到右主干（跨列连线判方向看两端 x 中心）
- 同源扇出自己排车道（显式 `via`）
- 回边走右导轨 + 顶部横轨、标签骑横轨
- `RAIL_STEP_Y = 28`
- 走廊宽 = 连线标签宽之和；**跨层标签只许两个字**
- **别把新分区塞进 app 那层**（应用卡是主干锚点，宽度一变走廊全错位）；新分区放 `CANVAS_ZONES` 末尾

### 3.5 后端设计（`com.arsenal.scan`）

包结构：

```
com/arsenal/scan/
├── ProjectScanner.java       编排：输入 → 五种 Scanner → ProjectFacts
├── BuildScanner.java
├── ConfigScanner.java
├── DeployScanner.java
├── CodeScanner.java
├── CiScanner.java
├── TechStackResolver.java    应用 scan_rules.json
├── ScanRulesLoader.java      与 RuleLoader 同风格，启动时一次性载入
├── ScanGuard.java            闸门：大小 / 数量 / 路径 / 超时 / 黑白名单
├── SourceResolver.java       目录 / zip / git 三种输入的统一抽象
└── ScanException.java        带错误码
```

**接口**（沿用现有 `ApiResponse<T>` 与状态码约定）：

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST` | `/api/scan/facts` | 请求体 `{"source":{"kind":"path"\|"git","value":"…"}}` → `ProjectFacts` |
| `POST` | `/api/scan/upload` | `multipart/form-data` 上传 zip → `ProjectFacts` + 一个短期 `scanId` |
| `POST` | `/api/scan/diagram` | 请求体 `{"scanId"\|"facts":…, "kinds":["tech","layered"],"theme":"doc"}` → SVG 字符串数组 |
| `POST` | `/api/scan/archify` | 请求体 `{"scanId"\|"facts":…}` → 直接转发给 `ArchifyService.deliver()`，返回 `DeliverOutcome` |
| `GET`  | `/api/scan/rules` | 反查映射表（调试用） |

**注意异常落点**（项目踩过 5 次的坑）：`GlobalExceptionHandler` 的 `@ExceptionHandler(Exception.class)` 会先于 `DefaultHandlerExceptionResolver` 把 Spring 自己的 415/405/404 吃成 500。新增接口时要显式处理：不合规的请求体 → 400、超限 → 413、超时 → 504。

### 3.6 前端入口

**`/archify` 加第三个输入源**（现有两个：粘 IR / 传 JSON）：

```
[ 粘贴 IR ]  [ 上传 .json ]  [ 从代码生成 ]  [ 用当前选型生成 ]
                                   ↑ 新增
```

点「从代码生成」→ 展开一个小面板：`本地路径 / git 地址 / 上传 zip` 三选一 → 扫描 → 显示 `ProjectFacts` 摘要（技术栈 chip 云 + 未识别清单 + notes）→ 生成 IR → 自动走既有的两道预检 → 送后端出图。

**`/arch` 加「导入项目档案」**：扫描结果可以「生成档案草稿」→ 下载 `arsenal-profiles/<id>.json` → 用户自己放进仓库 → 跑 `sync:content`。**不自动写进仓库**（沿用现有规矩：导入的档案只活在本机）。

**不做新页面**。这两处都是「加一个输入源」，不是加一个功能页 —— 加页面会让 NAV 变长，且【13】要同步改。

### 3.7 安全闸门（`ScanGuard`）—— 这份方案里最重要的一节

扫描是「把别人的代码读进来」，必须假设输入是恶意的。

| 闸门 | 规定 |
|---|---|
| **不执行任何东西** | 不跑仓库里的任何脚本 / hook / 构建 / 测试；`git clone` 必须 `--config core.hooksPath=/dev/null`；不解析软链接指向的目标 |
| **路径逃逸** | 每个路径先 `toRealPath()`，必须落在根目录内；拒绝 `..` / 绝对路径 / 符号链接外跳（zip 也要防 `../`，用 `zipfile` 同款校验） |
| **规模** | 单文件 ≤2MB、总解包 ≤500MB、文件数 ≤20000、目录深度 ≤20 |
| **时间** | 总扫描 ≤180s，超时中断并返回已扫描部分 + `truncated: true` |
| **git** | 只允许 `https://`；禁 `file://` / `ssh://` / `git://`；`--depth 1 --single-branch --no-tags`；`GIT_TERMINAL_PROMPT=0`；超时 `destroyForcibly` |
| **脱敏** | 配置文件里的 `password` / `secret` / `key` / `token` **值一律替换为 `***`**，只留键名；`.env` 只留键名 |
| **不落盘** | 临时目录 `finally` 清理；不往被扫描的仓库里写任何东西 |
| **不上传** | 扫描结果只返回给调用方，**不外发任何地方**（不调第三方 API） |

**闸门必须自己有测试**：`.verify/scan-check.ts` 里要有一组「恶意输入」用例（路径逃逸 zip、超大文件、`file://` git 地址、软链外跳），断言**全部被拒且错误码正确**。

---

## 4. 分阶段实施

### 阶段 A · 后端骨架 + 只扫构建文件

1. 建 `com/arsenal/scan/` 包，先只实现 `SourceResolver`（只支持本地目录）+ `ScanGuard` + `BuildScanner`
2. `POST /api/scan/facts` 只回 `{build: {...}}`
3. `tools/content/scan_rules.py` → `arsenal-scan/scan_rules.json`（新增事实源，走 `build-content.py`）
4. `ScanRulesLoader` 启动载入（照抄 `RuleLoader`）

**验收**：拿本项目 `arsenal-server` 扫一下，能报出 `spring-boot-starter-web`、`mysql` 之类的依赖。**先不画图。**

### 阶段 B · 补齐五种 Scanner

`ConfigScanner` / `DeployScanner` / `CodeScanner` / `CiScanner` 依次补齐。`CodeScanner` 最重（要解析 Java 源码取注解与路由）—— **用正则 + 极简词法分析，不引 JavaParser**（那是方案里的「AST 层」，另一个议题）。

**验收**：对本项目 + 一个 Next.js 项目 + 一个纯 Go 项目各扫一次，`notes` 里如实记录所有没看懂的地方。

### 阶段 C · 三张图

1. `buildTechArchFromFacts()` → 复用 `buildTechArchSvg`（依赖方案 3 的 theme）
2. `buildLayeredArch()` + `buildLayeredSvg()`（新写，照 `arch-diagram.ts` 的手绘 SVG 路子）
3. `buildArchifyIrFromFacts()` → 走现有出图服务

**验收**：本项目自己扫一遍，三张图都出得来；**IR 必须过现有九项构图检查**（`verify:archify` 会守）。

### 阶段 D · 前端入口 + 安全加固

1. `/archify` 加「从代码生成」输入源（含 zip 上传）
2. `/arch` 加「导入项目档案」+ 档案草稿下载
3. `ScanGuard` 的恶意输入用例全部写进 `.verify/scan-check.ts`
4. `ScanProbe.java`（照抄 `ArchifyProbe.java` 的写法）做端到端实跑

### 阶段 E · 验证与收尾

1. 新增 `.verify/scan-check.ts` + `package.json` 的 `verify:scan`
2. **fixture 仓库**：`.verify/fixtures/demo-repo/` 放一个 30 文件左右的假 Spring Boot 项目（含 pom / 两个 yml / Dockerfile / K8s 清单 / 3 个 Controller / 1 个 Feign 客户端），断言扫描结果**逐字段**
3. 四处同步 verify 数字
4. README：目录树加 `arsenal-scan/`、新增一节「从代码出图」、进度表加一行、verify 数字
5. memory 追加

---

## 5. 验收清单

```bash
cd D:/workspace/2026/mryang-arsenal
export PATH="/usr/bin:/bin:/c/Windows/System32:/c/Windows:$PATH"
python tools/build-content.py
cd arsenal-web && node scripts/sync-content.mjs
npm run verify            # 含新的 verify:scan
npm run build

# 后端
cd ../arsenal-server
bash scripts/run.sh       # 3011
bash scripts/compile-check.sh

# 端到端：扫自己
curl -s -X POST http://localhost:3011/api/scan/facts \
  -H "Content-Type: application/json" \
  -d '{"source":{"kind":"path","value":"D:/workspace/2026/mryang-arsenal/arsenal-server"}}'
```

**fixture 断言（逐条写清楚）**：

| # | 断言 |
|---|---|
| 1 | `build.kind === 'maven'`；`artifacts[0].javaVersion === '17'` |
| 2 | `config[0].values['server.port'] === '8080'` |
| 3 | `deploy.k8s[0].replicas === 3` |
| 4 | `code.annotations['@RestController'] === 3` |
| 5 | `code.clients[0].kind === 'feign'` |
| 6 | `techStack.matched` 含 `spring` / `mysql` / `redis`；每条都有 `evidence` |
| 7 | `unmatched` 里的依赖在 `notes` 里有 `UNMAPPED_DEPENDENCY` 记录 |
| 8 | 生成的 IR 通过 `archifyIrShapeIssues()` + `archifyIrIssues()` |
| 9 | `buildLayeredSvg()` 输出非空且含 5 个带名 |
| 10 | 恶意 zip（`../escape.txt`）被拒，错误码 = 400 |
| 11 | `file://` git 地址被拒 |
| 12 | 配置文件里的 `password` 值被替换为 `***` |
| 13 | 同一份 fixture 扫两次，`facts` 除 `scannedAt` / `elapsedMs` 外**逐字段相等** |

> 断言 13 很重要：扫描必须是**确定性**的，否则图会随机变。

---

## 6. 红线

1. **不执行被扫描仓库里的任何东西**（脚本、hook、构建、测试一律不跑）
2. **路径必须 `toRealPath()` 后再校验在根目录内**，zip 与 git 同理
3. **不做任何推断**：读不到就 `null` + 一条 `note`
4. **不改 `ArchifyService`** —— 它已经对了，本方案只生产 IR
5. **不引入依赖**（后端不引 JavaParser / 前端不引任何扫描库）
6. **凭据值必须脱敏**（`password` / `secret` / `key` / `token`）
7. **临时目录 `finally` 清理**，不往别人的仓库里写东西
8. **私有仓库不支持** —— 只 https 公开地址，明确告知用户
9. 调试产物写 `.workbuddy/_*`，用完即删

---

## 7. MVP 与可裁剪

| 优先级 | 内容 |
|---|---|
| P0 | 阶段 A + B：扫描引擎（本地目录输入）+ 事实 JSON |
| P0 | 阶段 C 的链路 1（部署架构图）+ 链路 3（出 IR 送现有出图服务） |
| P1 | 阶段 D 前端入口（`/archify` 加输入源） |
| P1 | 阶段 E 的 fixture 断言 1–8、10–13 |
| P2 | 链路 2（应用分层图）—— 用户明确要「软件架构图」，但它最费时 |
| P2 | zip 上传 + git 输入 |
| P3 | 六视图档案草稿生成 |

**如果一晚做不完**：保住「本地目录 → facts → IR → 现有出图服务出 HTML」这条最短闭环。它已经能满足「给你代码，出图」的核心诉求，而且风险最低（复用现成链路）。

---

## 8. 收尾清单

- [ ] 生成器 / 同步 / verify / build 全绿
- [ ] `bash scripts/compile-check.sh` 通过
- [ ] `ScanProbe` 端到端实跑通过
- [ ] verify 数字四处同步
- [ ] README：目录树、新增「从代码出图」一节、进度表、verify 数字
- [ ] memory 日志追加（含「未识别的依赖清单」—— 这是给方案 1 的输入）
- [ ] 扫描结果与生成的图呈现给用户

---

## 9. 定时任务 prompt（可直接粘贴）

```
执行 D:\workspace\2026\mryang-arsenal\docs\hy4-night-plans\plan-4-code-to-diagram.md 的全部内容。

先读：00-index.md（四条铁律与环境备忘）、README.md 的「出图服务」两节、
arsenal-web/src/lib/archify-ir.ts（IR 全字段）、arsenal-server 的 archify 包、
arsenal-web/src/lib/arch-canvas.ts 与 arch-profile.ts、
arsenal-server/.verify/ArchifyProbe.java、.workbuddy/memory/MEMORY.md 与最近三天日志。

核心要求（按 A→E 顺序）：
1. 后端新增 com.arsenal.scan 包：ProjectScanner 编排五个子 Scanner
   （Build/Config/Deploy/Code/Ci）产出 ProjectFacts；ScanGuard 做闸门；SourceResolver 支持
   本地目录 / zip / https git 三种输入；
2. 技术栈归一化走数据表：tools/content/scan_rules.py → arsenal-scan/scan_rules.json，
   ≥80 条映射；未命中依赖必须进 notes 的 UNMAPPED_DEPENDENCY，每条匹配必须有 evidence（路径+行号）；
3. 三条出图链路：① facts → TechArch → buildTechArchSvg（复用方案 3 的三态）
   ② facts → buildLayeredArch → 应用分层图（五带 + 跨带直连的红色警示线）
   ③ facts → ArchifyIr → 现有 POST /api/archify/deliver → HTML；
   **ArchifyService 一行都不许改**，IR 必须过现有九项构图检查；
4. 前端只在 /archify 加「从代码生成」输入源、在 /arch 加「导入项目档案」，不许新增页面；
5. 安全（最重要，逐条落实）：不执行被扫描仓库的任何东西、路径 toRealPath 后校验在根内、
   zip 防 ../ 逃逸、单文件 2MB / 总 500MB / 2 万文件 / 180s 超时、git 只许 https 且 --depth 1
   且禁 hook、配置文件里的 password/secret/key/token 值替换为 ***、临时目录 finally 清理；
6. 新增 verify:scan 一层，含 fixture 仓库（.verify/fixtures/demo-repo/，约 30 文件）
   的逐字段断言 + 恶意输入用例（路径逃逸 zip / 超大文件 / file:// git / 软链外跳）+ 确定性断言
   （同一份 fixture 扫两次结果逐字段相等，除时间戳）。

时间不够时按「7. MVP 与可裁剪」取舍 —— 底线是「本地目录 → facts → IR → 现有出图服务出 HTML」
这条最短闭环跑通。剩余项如实列入剩余工作量清单。
收尾按 00-index.md 第五节（verify + 四处同步数字 + README + memory + present_files）。
```
