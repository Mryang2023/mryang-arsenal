# 杨先生的军火库 · arsenal

个人代码规范字典 + AI 代码合规校验平台。

目标只有一个：**让任何 AI 生成的代码，都收敛到同一套工程规范上。**

### 从代码出图（`com.arsenal.scan`）

给一个本地目录、一个 zip、或一个 https git 地址，扫描出一份**只读的事实 JSON**：

```bash
curl -s -X POST http://localhost:3011/api/scan/facts   -H "Content-Type: application/json"   -d '{"source":{"kind":"path","value":"D:/workspace/2026/mryang-arsenal/arsenal-server"}}'
```

| 接口 | 说明 |
|---|---|
| `POST /api/scan/facts` | 本地目录 / https git → `ProjectFacts` |
| `POST /api/scan/upload` | 上传 zip → `ProjectFacts` |
| `GET /api/scan/rules` | 映射表条数与位置 |
| `GET /api/scan/rules/detail` | 映射表反查（这个依赖为什么没被认出来） |

三条硬规矩：**只记录读到的**（副本数读不到是 `null` + 一条 note，绝不填 1）、
**每条命中都有 evidence**（文件路径 + 行号）、**未命中不丢**（进 `notes` 的 `UNMAPPED_DEPENDENCY`）。

安全闸门（`ScanGuard`）：不执行被扫描仓库里的任何东西（git 带 `--config core.hooksPath=/dev/null`）、
路径先 `toRealPath()` 再校验在根内、zip 出现 `../` 或绝对路径**整体拒绝**、
单文件 2MB / 总 500MB / 2 万文件 / 深度 20 / 180s 超时、
`password` `secret` `token` `key` 的值一律 `***`（`.env` 只留键名）、临时目录 finally 清理。

---

---

## 仓库位置

```
D:\workspace\2026\mryang-arsenal
```

单仓 monorepo。之所以不拆成三个仓：`tools/build-content.py` 一个生成器同时产出
规则 / 案例 / 选型三类数据，它们本就是「一份数据三种出口」的耦合体，拆开会让构建链断成三段。

| | 端口 | 技术栈 |
|---|---|---|
| `arsenal-web` | 3010 | Next.js 14 App Router + TypeScript + Tailwind |
| `arsenal-server` | 3011 | Spring Boot 3.2.5 + Java 17 |

---

## 三条不可动摇的设计原则

1. **一份数据，三种出口。** 每改一条规则，必须同时惠及「人查 / 给 AI 用 / 拿代码验」三条路径。
2. **Rule as Data。** 规则是结构化 JSON 对象，不是 Markdown 文字。改数据源 → 三处同时生效。
3. **写不出 bad/good 示例的规则不收录。** 「代码要健壮」这类无法判定的鸡汤一律拒绝。

**不做**：auto-fix（只诊断给建议）、绑定某家 AI 的代理、规则市场 / 多租户 SaaS。
上限是单人 + 小团队（≤10 人）。

---

## 目录结构

```
arsenal/
├── tools/                       内容生成器（Python）
│   ├── build-content.py         主入口 + 构建期校验
│   └── content/*.py             内容源：在 Python 侧原样承载 Java / YAML / XML
│       ├── skeleton.py crud.py http.py async_tx.py     ← 最佳实践案例（端到端垂直切片）
│       ├── stack_base.py stack_data.py stack_mw.py stack_deploy.py
│       ├── stack_arch.py stack_cross.py stack_presets.py  ← 装配台选型
│       └── stack_project.py     项目结构树 / 启动类 / 导出文件模板
│       └── icons.py             图标资产库清单（九大类 / 矢量 key / 位图路径）
│
├── arsenal-rules/               规则数据源（source of truth，Git 化）
│   ├── _schema/rule.schema.json 规则对象的 JSON Schema
│   ├── meta.json                分类树与统计
│   └── {skeleton,web,service,data,concurrency,reliability,security,test,collab}/*.json
│
├── arsenal-cookbook/            最佳实践案例数据（4 条切片 / 32 文件 / 2214 行）
├── arsenal-cases/               场景案例数据（source of truth，由 tools/content/cases/*.py 生成）
│   ├── meta.json                2 场景 / 12 切片 / 1353 行 SQL+Java
│   ├── huge-rowcount-rdb.json   亿级行关系库读写
│   └── genomic-sequence-store.json  基因 / DNA 序列海量存取
├── arsenal-scan/               代码扫描映射表（source of truth，由 tools/content/scan_rules.py 生成）
│   └── scan_rules.json          108 条坐标映射 / 47 条会落进部署图
├── arsenal-stacks/              装配台数据
│   ├── stack.json               18 维度 / 46 选项 / 4 预设
│   ├── architecture.json        7 泳道 / 31 能力 / 21 条组合策略
│   └── project.json             条件化目录树 / 启动类 / 导出文件模板
│
├── arsenal-profiles/            六视图项目档案（换项目只加这里，代码零改动）
│   └── <id>.json                与文件名同 id；数字一律写 {{token}}，不许手抄
│
├── arsenal-icons/               图标资产库清单（source of truth）
│   └── icons.json               81 个图标 / 9 类 —— 矢量 key 与位图路径的登记表
│
├── arsenal-web/                 Next.js 前端（3010）
│   ├── src/app/{rules,check,export,blueprints,stack,arch,archify,icons}/  八个页面
│   │                             （arch = 架构图谱：业务 / 数据 / 应用 / 技术 / 产品 / 项目 六大架构，
│   │                              讲哪个项目由项目档案决定；技术架构沿用装配台选型 ——
│   │                              localStorage 快照，装配台是唯一属主。
│   │                              archify = 出图服务：任意 IR 进城，HTML 出城。
│   │                              icons = 图标资产库：分类 / 搜索 / 复制 key / 矢量位图双视图）
│   ├── public/icons/<category>/ 位图资产（分批补；目前 0 张，矢量已全量可用）
│   ├── src/lib/                 纯函数层（cookbook / stack / arch / arch-canvas /
│   │                             archify-ir / arch-views / project / zip / icon-assets，
│   │                             都不引绘图库）
│   │                             + arsenal-api.ts（唯一一处网络请求，调后端出图）
│   └── .verify/                 自检脚本（属资产，进 Git）
│
├── arsenal-server/              Spring Boot 后端（3011）
│   ├── src/main/java/com/arsenal/{loader,engine,exporter,archify,web,domain}
│   └── .verify/                 探针（校验工具，不进产品代码目录）
│
└── 杨先生的军火库-*.md          计划书 / 规则基线 / 案例库与选型台 说明
```

### 数据流

```
tools/content/*.py            内容源（改内容改这里，不要改 JSON）
        │  python tools/build-content.py          含构建期校验，失败即中断
        ▼
arsenal-rules/ · arsenal-cookbook/ · arsenal-stacks/ · arsenal-profiles/   source of truth，进 Git
        │  node scripts/sync-content.mjs          构建前自动执行，含锚点校验
        ▼
arsenal-web/src/generated/*.json              编译期快照（gitignore，可重建）
        │
        ▼
src/lib/*.ts  →  页面 / 合成器 / 导出器
```

**为什么用 Python 生成器而不是手写 JSON**：Java / YAML / XML 里全是双引号和换行，
手写 JSON 字符串必须逐行转义（`\n`、`\"`），极易出错且完全不可读。

---

## 怎么跑

### 前端（3010）

```bash
cd arsenal-web
npm install                # 首次
npm run dev                # 开发模式，改代码热更新
```

静态导出（脱离服务器，进 Git / 进内网 / 直接分享）：

```bash
npm run build              # prebuild 会先自动跑 sync
python -m http.server 3010 -d out
```

### 后端（3011）

```bash
cd arsenal-server
bash scripts/run.sh                                   # 编译并启动，无需 Maven
SERVER_ARGS="--server.port=3011" bash scripts/run.sh  # 指定端口
```

`run.sh` 自己找 JDK 17（扫 `~/.jdks` 与 Program Files 各处，取最高的 17），并拼 `.m2` 里的运行时依赖。
JDK 装在别处时用 `JDK_HOME=<JDK 目录> bash scripts/run.sh` 指定；有 Maven 时 `mvn spring-boot:run` 也可以。

只想要静态编译（不启动，只验 API 用对了没）：

```bash
bash scripts/compile-check.sh      # 26 源文件 → 41 class
```

> `SKIP_COMPILE=1` 只跳过 javac，资源照旧复制 —— 资源复制是刻意放在守卫之外的。
> 早先两者在同一个 `if` 里，于是「先 `compile-check.sh` 再 `SKIP_COMPILE=1` 启动」这条最自然的路径
> 会缺 `application.yml`，启动报 `Could not resolve placeholder 'arsenal.rules-dir'` ——
> 看着像配置写错，实则 `target/classes` 里只有 `com/`。

启动后的接口：

| 接口 | 用途 |
|---|---|
| `GET /api/health` | 存活 + 规则集版本（69 条 / 50 条强制级） |
| `GET /api/stats` | 按严重度、分类统计 |
| `GET /api/rules` · `/grouped` · `/sources` · `/{id}` | 规则查询 |
| `GET /api/export/formats` · `/api/export/{format}` · `/{format}/raw` | 导出六种载体 |
| `POST /api/lint` | 送代码拿违规清单 + 非正则层的 `skipped` 如实披露 |
| `GET /api/archify` | 这台机器能不能出图（node / 技能入口 / 看不到时怎么补） |
| `POST /api/archify/deliver` | 送一份 IR，拿 HTML + 校验收据；画不合格时回诊断而不是报错 |

`POST /api/lint` 的请求体是 `{"files":[{"name":"com/example/UserController.java","content":"..."}]}`。
`name` 用于匹配规则的 `targetGlob`，所以路径要尽量真实 —— 填裸文件名和填完整包路径，匹配到的规则数量差很多。

`POST /api/archify/deliver` 的请求体**就是 IR 本身**（不套壳），即页面上复制/下载到的那份 JSON。
两种「没成」刻意用两种状态码：图没过构图检查 → **200 + `delivered:false` + 诊断数组**
（那是这次调用最有价值的东西，包成错误码只会让人为了读它去解析错误体）；
环境跑不了（没装技能 / 超时）→ **503 / 504**；请求本身不合规 → **400**。


### 自检（改动后必跑）

```bash
cd arsenal-web && npm run verify
```

一条命令跑完八层、共 **620 项**：

| 层 | 项数 | 看什么 |
|---|---|---|
| `verify:arch` | 35 | 能力供需 / 槽位必需性 / 三态结论 |
| `verify:graph` | 59 | 架构图交互层：依赖边与版式边不许混淆、可达/路由自洽、渲染器加法契约 |
| `verify:cases` | 25 | 场景案例库：驱动参数档位离散、**穷举 2592 组参数断言「命中 + 未命中 == 切片总数」一个都不丢**、同参数两次调用逐字节一致、锚点真在代码里、规则 id 真实存在、无 TODO/反模式 |
| `verify:project` | 406 | 结构树、启动类、隐患、README、架构图与说明、**部署产物（Dockerfile / Compose / K8s 清单 / Helm Chart 的可应用性与字段一致性）**、zip 打包；**六大架构视图数据层**（每个数字可追溯到真实数据）、技术架构画布加料不变量（页脚 / 署名 / 分区计数）、**图标库与动效**（图标 key 不许静默回落、导出态带动画 / 交互态不带）、**图标资产库**（key 唯一、矢量 key 全部命中 `TECH_ICONS`、代码与架构图数据里的图标引用可解析、位图清单 ↔ 磁盘双向对齐、体积 ≤6MB、页面与菜单成对存在）、**导航与页签契约**（导航不许指向空地址、页面不许成孤儿、页签 id 必须有渲染分支） |
| `verify:engine` | 17 | 规则池对账、样本检出、误报检查 |
| `verify:parity` | 12 | 前后端导出逐字节一致性（含后端探针实跑）；**活服务体检** —— 起后端时断言 `/api/stats` 报的条数与分布 == 事实源（防「改了规则忘了重启」的静默漂移），没起服务则明说跳过 |
| `verify:archify` | 31 | 选型 → 通用绘图器 IR：结构自检 + 对方那九项构图检查 + 后端出图服务实跑 |
| `verify:scan` | 35 | 代码扫描：fixture 仓库逐字段、确定性（扫两次除时间戳外逐字段相等）、恶意输入（路径逃逸 zip / 超大文件 / `file://` `ssh://` `git://` git / 软链外跳）全被拒且错误码正确、密码与 `.env` 脱敏、不存绝对路径 |

改动能力模型、槽位必需性、策略、结构树、架构图渲染或技术架构图（画布 / IR 适配器）之后
**必须重跑**：基线在 `.verify/audit-check.ts`、`.verify/graph-check.ts`、
`.verify/project-check.ts`、`.verify/archify-check.ts` 与 `.verify/scan-check.ts`。

`verify:scan` 需要 bash + JDK 17（它要起后端扫描探针实跑）。缺一个就**明说跳过**并退出 0 ——
那时「通过」里不含扫描断言。

`verify:archify` 需要机器上装了通用绘图器（扳手AI.Archify）。没装时前 19 项
**明说跳过**并照常退出 0 —— 但那时「通过」里不包含九项构图检查，别当成绿灯。
默认跑 4 套预设 + 8 种边界组合；想穷举七个节点维度的全部 128 种组合：

```bash
cd arsenal-web && ARCHIFY_SWEEP=1 npm run verify:archify
```

它最后 10 项要 `bash` + JDK 17：编译并实跑后端出图服务
（`arsenal-server/.verify/ArchifyProbe.java`），验的是「页面上那颗按钮真的能用」。
上面三节走的是对方的命令行，**覆盖不到服务层** —— 找不到 node、临时文件写错、
子进程输出没被翻译回来，IR 全绿它也照样坏。

> `verify:parity` 需要 `bash` + JDK 17：它要起后端探针实跑一遍导出再逐字节比对。
> 没有 bash 的环境这一层跑不了（报 `execvpe(/bin/bash) failed`），此时其余五层
> （35 + 59 + 213 + 14 + 29 = 350 项）仍然有效，只是少了 parity 的 9 项
> 与 archify 里依赖 bash 的那部分。


---

## 当前进度

| 资产 | 回答什么 | 规模 |
|---|---|---|
| **规则集** | 不能做什么 | 69 条（MUST 37 + NEVER 13 = 50 条强制级卡满上限；SHOULD 18 + MAY 1） |
| **最佳实践案例库** | 一个功能完整该怎么写，以及**什么时候不要这么写** | 4 条切片 / 32 文件 / 2214 行 / 98 条锚点备注 / 16 条参考出处 |
| **场景案例库（/cases）** | 在**这些约束**下该怎么设计（与最佳实践案例库的分工：那边是「教科书范文」，这边是「会诊」） | 2 个场景 / 12 个条件切片 / 1353 行 SQL+Java / 45 条锚点备注。每个场景 6 个驱动参数（并发量 / 数据规模 / 读写比 / 一致性 / P99 / 增长预期），每条代码切片带 `when` 条件：**命中的给代码，没命中的必须写明为什么不适用**（不许静默省略），参数组合本身矛盾（如「百万 QPS + 强一致 + P99<50ms」）在页面顶部标黄。合成引擎 `case-synth.ts` 是纯函数，同参数两次调用逐字节一致（2592 组参数已穷举守恒） |
| **架构装配台** | 由哪些零件组成、**拼起来能不能跑** | 7 泳道 / **33 维度**（9 组）/ **127 选项** / **100 能力** / 21 策略 / 6 套预设。从「只选 Java 组件」扩到「装配一整个项目」：新增运行基石（运行环境 / 入口负载 / 网关 / 编排 / 制品库）、数据生态（检索 / 分析型存储 / 对象存储）、质量工程（测试栈 / 门禁）、运维安全（CI/CD / 监控 / 密钥 / 日志）、部署形态五组。高阶档（APISIX / TiDB / Vault / Istio / 分库分表 …）带「高阶」角标且必须写 ≥2 条翻车场景。**集群形态成为一等公民**：数据库 / 缓存 / 检索 / 队列 / 应用都能选单实例 / 主从 / 组复制 / 分片 / 云原生，形态参与能力判定，并且**真的影响产物** —— K8s `replicas` / PDB / 反亲和、Helm 三份 values、容量摘要、架构图叠层数全部由 `topology.ts` 算出来，`deploy.ts` 里不再有写死的副本数 |
| **图标资产库（/icons）** | 画架构图会用到的图标：**矢量**供架构图节点 / 装配台 / IR 组件用（随 `currentColor` 变色、能进 SVG 导出），**位图**供卡片配图与文档插图用 —— 两套分工固定，不互相替代 | 9 大类 / 81 个登记图标（`tech-icons` 从 89 扩到 **170** 个：第一批是 MySQL / Redis / Nacos 这类技术件，第二批补的是「谁在用系统 / 跑在哪 / 怎么进来 / 一个还是多个」）。全部手绘 SVG，零图标库依赖。事实源 `arsenal-icons/icons.json`（由 `tools/content/icons.py` 生成）；位图分批补，目前 0 张 —— 空态在页面上如实显示并给出可直接使用的生图 prompt |
| **架构图谱（/arch）** | 六大架构一图讲清：业务 / 数据 / 应用 / 技术 / 产品 / 项目 | 由项目档案驱动：换一份 `arsenal-profiles/<id>.json`（或就地导入）就换一个项目，渲染代码零改动。5 张静态视图 + 技术架构（跟随装配台选型）；视图数字全部从真实数据算出。视觉系统：`arch-glyphs`（30+ 概念图标，每域每层一个）、`tech-icons`（170 个技术组件与架构概念图标）、`arch-motion`（SVG 内嵌动画，导出的 .svg 单独打开照样动）、六张 AI 生成封面插画（`public/arch/*.webp`，共 79KB）。动效克制：实线不因为动画变虚线（语义优先），`prefers-reduced-motion` 下全部停 |
| **出图服务（/archify）** | 把任意项目的架构 IR 变成一张合格的 HTML 交付图 | 与选型无关：粘贴 / 上传任意 IR → 本地两道预检（形状 + 已知结构坑）→ 后端渲染 → HTML 预览与下载 + 逐条构图诊断。输入不限于军火库自己生成的 IR |

装配台的核心是**能力供需模型**：每个选项声明 `requires` / `provides`，
所有已装配方块的 `provides` 求并集，未覆盖的 `requires` 即为缺零件，据此给出三态结论
（跑不起来 / 能跑但零件不全 / 可运行）。隐患不是一句判断，而是补齐
**触发条件 / 可观察现象 / 后果边界**三项——写不出可观察现象的，不算隐患。

一键导出：装配台右上角可导出完整可用的 Spring Boot 工程骨架（构建文件、启动类、
配置类、profile、迁移脚本、冒烟测试、README、隐患体检单、架构图与技术说明）。

**架构图是算出来的，不是画出来的。** 装配台「交付 → 架构图」页签把当前组合渲染成
「7 层泳道 + 请求向下穿过」的图：方块是 18 个槽位，缺必需的描红、缺建议的描黄铜、
参与了组合隐患的带 ⚠，层内 `→` 是请求真正流经的顺序，竖虚线右侧是旁路件。
导出包里带 `architecture.svg`（浅色，供文档引用）、`ARCHITECTURE.md`（同源的技术说明）、
以及 `architecture.d2` / `architecture.mermaid` 源码。

这张图没有引任何绘图库，`src/lib/arch-diagram.ts` 一个纯函数直接拼 SVG —— 因为
层是固定的 7 条、槽位是固定的 18 个，坐标能直接算出来。图引擎解决的是**拓扑**，
而这里要的是**版式**：实测把 6 个容器交给 D2，无连线时它横排成一长条，有连线时
按依赖把容器的框都打散了。既然拓扑固定，就不该为了迁就引擎去扭曲数据。

**「架构图谱 → 技术架构」视图回答的是另一件事：部署出来长什么样。** 与架构图的分工
是刻意的 —— 那张图给选型时看（谁依赖谁），这张图给技术说明书与客户看。构建期的
零件（Maven / Lombok / 测试框架）收进应用卡的工程属性，不占部署节点位；Redis、
Nacos 这类要单独起进程的才画成节点。可以拖动、改名、换集群形态，改动只影响交付
呈现，不碰选型判定（存在 localStorage，不进 Git）。它在 `/arch` 路由下（2026-09-21
起装配台不再内嵌此页签），选型快照由装配台写入 localStorage —— 装配台是选型唯一
属主，这里只读。

### 给别的项目出这六张图

`/arch` 不是「军火库的一个功能页」，它是**对某个项目的六面展示** —— 六张图讲的从来是
「哪个项目」。所以输入口是数据，不是代码：

```
写一份 arsenal-profiles/<你的项目>.json
        │  npm run sync:content        （校验六视图齐备 / id 与文件名一致 / token 写法合法）
        ▼
src/generated/profiles.json           编译期快照
        │
        ▼
/arch 的「项目档案」选择器            点一下切过去，或就地粘贴 / 上传一份临时档案
```

两条硬规矩（构建期与自检期各拦一次，手改 JSON 绕不过去）：

1. **能算的数字不许手抄。** 档案里出现阿拉伯数字的 `metric` 必须写成 `{{rules.total}}`
   这种 token，由 `arch-profile.ts` 的 `buildMetrics()` 从真实数据解出来。抄一个「69 条」
   进去，改一次事实源它就变成一句自信的错话 —— 而错话不会报错，只会一直显示。
2. **六视图必须齐。** 每个视图要有 `definition / focus / question / outputs`，缺了构建期直接失败。
   视图的中文名 / 图标 / 主题色留在代码里（渲染器的契约），档案只负责「这个项目在这个面上写了什么」。

导入的档案只活在本机浏览器里（localStorage），**不进仓库** —— 别的项目的架构资料不该因为
我们想看一眼就被提交进来。要长期保留就落成 `arsenal-profiles/<id>.json` 再同步一次。
技术架构那张图例外：它讲「你要部署的东西」，跟着装配台选型走，不跟档案走。

### 出图服务（/archify）

通用绘图器（扳手 AI）的能力一旦只能从装配台触发，看起来就只是军火库自己的一个按钮。
`/archify` 把输入口解耦，契约只剩一条：**IR 进，HTML 出**。

三类结果分开显示，因为处置方式完全不同：**形状不对**（文件本身不是 IR —— 送来后端只会
拿到一个指向我们代码行的 `TypeError`，所以在本地就拦下并说清哪一层不对）、**构图没过**
（图的问题，逐条列出对方的诊断）、**后端不可达**（不是错误是常态，给离线出路：把 IR
复制走，用 CLI 出图）。本地只拦「形状」与「我们已知会踩的结构坑」，九项构图检查在前端
算不出来 —— 那只有对方的渲染器算得出，如实交给它回报。

出口有五个：复制 PNG、下载 SVG、复制技术说明书 Markdown，**导出通用绘图器的
IR JSON**（见 `src/lib/archify-ir.ts`），以及**在页面里直接生成 HTML**
（由后端起对方的 Node 渲染器完成，成品嵌在页面内预览）。IR 那条不是重复劳动：
我们自己的画布没有「构图质量」这一层，而对方有正交折线 / 标签避让 / 交叉数 /
折线节奏 / 边框穿越 / 图例净空一整套自检，还带可交互 HTML 交付。
**一份模型，两个渲染器**：两边都从 `buildTechArch()` 取事实，几何各算各的 ——
改了选型数据，两张图一起变。

手工拖出来的坐标**不带过去**：那份图有自己的版式引擎，而正是那个引擎在管
「标签会不会压线」。喂扰动过的坐标只会让它报到我们头上；改名、集群形态、手加的
连线都跟着走。

「直接生成 HTML」需要后端（`arsenal-server`，3011）活着 —— 那份渲染器是 Node 的，
浏览器跑不了（见 `arsenal-server/.../archify/ArchifyService.java`）。
后端不在时按钮灰掉、通道那一行说清缺什么，**其余四个出口照常可用**：
「能脱离服务器活着」这条原则没有被打破。后端要能找到技能（默认
`~/.workbuddy/skills/wrench-ai/bin/wrench-ai.mjs`）与 node，两者任一缺失都如实报出来，
用 `ARSENAL_ARCHIFY_CLI` / `ARSENAL_ARCHIFY_NODE` 可以指到实际位置。


---

## 未完成

| 项 | 说明 |
|---|---|
| **MCP Server 适配层** | **项目成败关键** —— 让 AI 写代码时主动来查规范，才能真的治本 |
| 后端接入案例库与装配台 | 后端已能出图（`/api/archify`）与校验（`/api/lint`），但装配台、蓝图、案例库仍只在前端算 |
| AST 层校验 | 69 条里 20 条需要语法树判定，前端只跑正则层的 35 条 |
| LLM 语义层 | 仅 MUST / SHOULD，强制要求行号定位 |
| **69 条规则逐条过目** | 需 mryang 标记「同意 / 改 / 删」。没过目就不算军火库 |

---

## 内容源约定（改之前先读）

- **改规则内容 → 改 `arsenal-rules/**/*.json`**（规则是手写数据，不经生成器）
- **改案例 / 选型 / 结构 → 改 `tools/content/*.py`**，然后跑生成器，**不要直接改产物 JSON**
- 规则硬约束：`MUST + NEVER ≤ 50`。超了就是设计出了问题，不是阈值太小
