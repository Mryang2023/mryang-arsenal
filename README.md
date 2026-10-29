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

#### 三条出图链路：同一份 facts，三张图

事实 JSON 一个字符都不改，三条链路各自从它出图 —— 判定全由 facts 决定，没有第二份输入：

| 链路 | 适配层 | 产物 | 关键约束 |
|---|---|---|---|
| ① 部署架构图 | `factsToPicks` → `buildTechArchFromFacts` | `buildTechArchSvg(arch, theme)` | 槽位由部署文件（Dockerfile / K8s / Helm / Compose / nginx / CI）反推；**副本数只从清单读**，读不到不画徽章 |
| ② 应用分层图 | `buildLayeredArch` | `buildLayeredSvg(arch, theme)` | 五带 client / api / app / domain / data；跨带直连（Controller → Repository 隔 ≥2 带）画红色警示线 |
| ③ Archify IR | `buildArchifyIrFromFacts` | `POST /api/archify/deliver` → HTML | 复用现有出图服务，`ArchifyService` 一行未改 —— 只喂对形状 |

主题五态（`doc` / `slide` / `blueprint` / `dark` / `light`）由 `PALETTES` 一处定义，
UI 列表从 `CANVAS_THEME_OPTIONS` 取，不再两处各写一份。

前端两个入口都收敛到同一份适配层 `src/lib/facts-arch.ts`：

- **`/archify` 页「从代码生成」** —— 本地目录 / git / zip 三输入源 → 三张图 → 一键把 IR 送进出图服务
- **`/autopsy` 页「六视图档案」** —— 同一套扫描，产出六视图档案草稿（2026-10-17 起 `/arch` 退役并入解剖台）

档案草稿（`src/lib/profile-draft.ts`）不许编：`buildProfileDraftFromFacts` 的 `filled`
只说真数据的条数，`todos` 逐条列出还是 `TODO` 的字段 —— 半空档案进不了仓库。

> 事实层的铁律一路贯穿到这里：**读不到就不画**。分层图的条数来自 facts 里真实存在的类，
> 部署图的副本数来自清单里的 `replicas`，档案草稿读不到的字段留 `TODO` —— 宁可空着，不许默认。

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
| `arsenal-web` | 3010 | Next.js 16 App Router + React 19 + TypeScript 5.9 + Tailwind 4 |
| `arsenal-server` | 3011 | Spring Boot 4.1.1 + Java 21（Jackson 3） |

> 2026-10-12 技术栈大规模升级：Next.js 14→16 / React 18→19 / Tailwind 3→4 / TS 5.5→5.9；
> Spring Boot 3.2.5→4.1.1 / Java 17→21 / Jackson 2→3。方案、取舍与验收闸门见
> `docs/升级计划-2026-10-12-技术栈大规模升级.md`。

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
│       ├── virtual_thread.py     ← 最佳实践案例（技术 / 场景 / 方案 三层）
│       ├── cases/*.py           场景案例（9 个场景 / 37 条症状 / 67 个条件切片 / 193 条锚点）
│       ├── stack_base.py stack_data.py stack_mw.py stack_deploy.py
│       ├── stack_arch.py stack_cross.py stack_presets.py  ← 装配台选型
│       ├── stack_project.py     项目结构树 / 启动类 / 导出文件模板
│       ├── stack_topology.py stack_topology_flows.py  ← 部署形态表 / 机理剧本（形态动画化 09-27）
│       └── icons.py             图标资产库清单（九大类 / 矢量 key / 位图路径）
│
├── arsenal-rules/               规则数据源（source of truth，Git 化）
│   ├── _schema/rule-contract.mjs 字段契约的唯一来源（枚举 / 必填 / 类型 / 正则）
│   ├── _schema/rule.schema.json  由上面那个生成，勿手改（sync 挂防漂移闸门）
│   ├── meta.json                分类树与统计
│   └── {skeleton,web,service,data,concurrency,reliability,security,test,collab}/*.json
│
├── arsenal-cookbook/            最佳实践案例数据（6 项技术 / 13 场景 / 13 方案 / 20 文件 / 757 行 / 10 可运行实验）
├── arsenal-cases/               场景案例数据（source of truth，由 tools/content/cases/*.py 生成）
│   ├── meta.json                9 场景 / 67 切片 / 5400 行 SQL+Java / 37 条症状入口
│   ├── huge-rowcount-rdb.json   亿级行关系库读写
│   ├── genomic-sequence-store.json  基因 / DNA 序列海量存取
│   ├── high-throughput-io.json  高吞吐 IO 与虚拟线程
│   ├── hotspot-cache.json       热点数据与多级缓存
│   ├── async-pipeline.json      异步流水线与最终一致
│   ├── wide-table-search.json   宽表、检索与分析
│   ├── idempotent-write.json    幂等写入：重复请求怎么只生效一次
├── arsenal-scan/               代码扫描映射表（source of truth，由 tools/content/scan_rules.py 生成）
│   └── scan_rules.json          108 条坐标映射 / 47 条会落进部署图
├── arsenal-stacks/              装配台数据
│   ├── stack.json               33 维度 / 127 选项 / 6 预设
│   ├── architecture.json        7 泳道 / 33 槽位 / 100 能力 / 21 条组合策略
│   ├── topology_flows.json      部署形态机理剧本（2 形态 / 6 场景 / 21 步旁白，数字全部带 refs）
│   └── project.json             条件化目录树 / 启动类 / 导出文件模板
│
├── arsenal-charter/            项目章程事实源（**手写** JSON，随项目走；不进 `tools/content/*.py`）
│   └── <id>.json               条款 / 例外登记簿 / override / 一致性项 / `policy` 四项口径
│                               （多人协作治理层，2026-10-03 新增；设计稿见 docs/开发计划-2026-10-03-项目章程/）
├── arsenal-checkups/           体检观察项事实源（**手写** JSON，随项目走；不进 `tools/content/*.py`）
│   └── checkups.json           观察项判据：三元条件 `{fact, op, value}` + 六算子（`>=` `<=` `==` `!=` `contains` `exists`）
│                               （解剖台体检的第三档，2026-10-12 新增；**判据是数据不是代码** ——
│                                 Java 侧只有 `CheckupEvaluator` 一个解释器，加一条观察项不用重编译）
├── arsenal-profiles/            六视图项目档案（换项目只加这里，代码零改动）
│   └── <id>.json                与文件名同 id；数字一律写 {{token}}，不许手抄
│
├── arsenal-icons/               图标资产库清单（source of truth）
│   └── icons.json               81 个图标 / 9 类 —— 矢量 key 与位图路径的登记表
│
├── arsenal-web/                 Next.js 前端（3010）
│   ├── src/app/{rules,check,cases,export,blueprints,stack,arch,archify,icons,charter,standards,autopsy,qa,projects}/  14 个页面
│   │                             （arch = 已退役的「架构图谱」，现在只是旧书签重定向页（2026-10-17 并入
│   │                              解剖台）；技术架构画布与六视图档案住 /autopsy 架构面板 ——
│   │                              画布选型跟本次扫描走（副本数读部署清单，读不到不兜底），
│   │                              「跟随装配台 localStorage 快照」的旧路径随 /arch 一并退役。
│   │                              archify = 出图服务：任意 IR 进城，HTML 出城。
│   │                              icons = 图标资产库：分类 / 搜索 / 复制 key / 矢量位图双视图）
│   ├── public/icons/<category>/ 位图资产（分批补；目前 18/81 张，矢量已全量可用）
│   ├── src/lib/                 纯函数层（cookbook / stack / arch / arch-canvas /
│   │                             archify-ir / arch-views / project / zip / icon-assets /
│   │                             topology-figure / topology-flows / charter，都不引绘图库）
│   │                             + arsenal-api.ts（唯一一处网络请求，调后端出图）
│   └── .verify/                 自检脚本（属资产，进 Git）
│
├── arsenal-server/              Spring Boot 后端（3011）
│   ├── src/main/java/com/arsenal/{loader,engine,exporter,archify,web,domain}
│   └── .verify/                 探针（校验工具，不进产品代码目录）
│
└── docs/archive/                早期计划书 / 规则基线 / 历次审查（2026-09 时代，
                                  数字已过期，docs/ 里的体检报告逐条更正过——只作历史留档）
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

`run.sh` 自己找 JDK 21（扫 `~/.jdks` 与 Program Files 各处，取最高的 21），并拼 `.m2` 里的运行时依赖。
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

一条命令跑完十三层、共 **2326 项**，外加两个**闸门层**（`typecheck` 与 `verify:meta`，都不计入项数）：

> 那 2326 项**不是手写的**：每层跑完把自己的实测项数写成
> `.verify/tmp/layer-<key>.json`，链尾的 `verify:meta` 再逐层与
> `arsenal-profiles/arsenal.json` 的 `project.verifyChain` 比对 ——
> **对不上就红**。层内加了断言却不改档案，verify 不再全绿（详见下面「项数由实测得出」）。

**`verify` 现在是一个串行 runner（`arsenal-web/scripts/verify-all.mjs`），不是 `&&` 链。**
两层差别是「报告可不可信」：

- **不短路**：以前是 `verify:arch && verify:graph && … && verify:scan`，任何一层红了，
  后面几层**根本不启动**，而「没启动」在退出码上留不下痕迹 —— 报告只显示「第三层红了」。
  现在十三层顺序全跑、逐层收集退出码，所以每一层都有行。
- **跳过是独立状态**：既不算通过、也不算失败。每层收尾都会打
  `实测 N 项 / 跳过 M 项 / 失败 K 项`，并写 `.verify/tmp/layer-<key>.json`；
  runner 末尾打一行总账，数字全部来自各层真实输出（**没有一个是手写的**）。

```text
# 本机快照（起了后端 + 未装绘图器）—— 数字随环境变，不是规格；原因见下一段
合计              643     31      0
（实测合计 = 通过 + 跳过 + 失败 = 674 项 —— 与链尾元核对表里的「实测」同义，可与档案声明值直接比）
刻意未跑          2 项    不打算跑（不是环境问题；--strict 下判失败）
元核对（闸门）    52      1       0       2       2.0s      闸门层（守各层声明值 vs 实测）
verify: 实测 674 项（通过 643 / 跳过 31 / 失败 0）  → 退出码 2（绿但存在跳过）
```

> 列名口径：汇总表的「通过 / 跳过 / 失败」是**互斥三态**，三者之和才是**实测项数**。
> 这一列曾印 `pass` 却叫「实测」，与元核对表里的「实测」同名不同义 —— 零失败时同值看不出，
> 有失败时同一份日志里会出现两个打架的合计（实测：688 与 678）。已改名，算法一个没动。

**退出码约定**（与 `scripts/verify-all.mjs`、`.verify/lib/report.ts` 同源，改口径三处一起改）：

| 退出码 | 含义 | 怎么用 |
|---|---|---|
| `0` | 全绿，且**无任何跳过** | 可以拍胸脯说「十三层都跑了」 |
| `2` | 绿（无失败），但**存在跳过** | 可交付，但报告里必须点名哪层跳了、跳了几项 |
| `1` | 有失败（含某层崩溃 / 没写出状态文件 / 空跑却报通过 / **某层实测项数 ≠ 档案声明值**） | 不许交付 |

本机环境满足不了某几层（没起后端 / 没装绘图器）时，用
`npm run verify -- --allow-skip` 把「绿但有跳过」放行成退出码 `0` ——
**跳过项仍会照常打印、照常点名**，只是不判负。这是给「本机就是没后端」的人一条
不撒谎的绿灯，不是把跳过偷偷算成通过。

不想让那 12 项后端类断言一直挂着，就跑 `npm run verify:with-backend` —— 它把
**起后端 → 跑 `verify:parity` + `verify:checkup` → 关后端**绑成一个动作（本机不需要 maven：
吃现成 `target/classes` + `.m2`，实测起程约 4s）。收尾按 **3011 的持有者 PID** 关停 ——
`bash` 包装退场后 java 会留在端口上，那种残留会让下一次跑批读到上一个进程，所以端口没归还就退出 `1`，
不把「没关掉」说成「跑完了」。3011 上已有服务时它复用、不抢也不关（`--keep` 是同义的手动版）。

`npm run verify -- --strict` 是另一个方向：把**「刻意未跑」**的项判成失败（退出码 `1`）。
「刻意未跑」= 造用例代价过大、**不跑是决定而不是意外**的断言 ——
目前 2 项，都在 `verify:scan`（500MB 总字节闸门的真实超限、真等 180s 超时）。
它们与「跳过」分开记账（见下），不进项数合计，所以 2326 的口径不受影响；
但总账里**永远单列一行**，不加 `--strict` 也照打 —— 不打印才是问题。

如果只想**看一眼自己有没有弄坏东西**，看汇总里的**失败**列与「问题清单」即可。
那行总账里的「跳过」是**环境相关**的，别把它当固定值：后端没起时是
「通过 640 / 跳过 34 / 失败 0」（`前后端一致性` 的活服务那 3 条未执行，
加上 `Archify 链路` 整层 31 项未执行）；**起了后端**（`bash arsenal-server/scripts/run.sh`）
就变成「通过 643 / 跳过 31」—— 跳过少 3 项、通过多 3 项，是同一层换了个走法。
那两个退出码 2 都是环境造成的，不是回归。耗时看机器负载：`代码扫描` 常年最慢
（本机实测 72s ~ 321s，它要真编译真跑后端探针），`视觉断言` 约 70~90s（起 msedge 跑 108 张），
其余八层都在 5s 以内（`前后端一致性` 约 13s 是 JDK 编译）。

#### 项数由实测得出（`verify:meta`）

以前的总数是**手写的**：`project-check.ts` 里那句
`VERIFY_CHAIN.reduce((n, v) => n + v.count, 0) === VERIFY_TOTAL && VERIFY_TOTAL === 662`
前半句是恒等式（`VERIFY_TOTAL` 的定义就是那个 reduce，两边同时从同一份档案派生，永远相等），
真正起作用的只有那个手写的 `662`。于是「层内加了 3 项断言而外面的数字没动」这件事，
整套 verify 完全看不见 —— 引擎层从 14 涨到 17 就是这么漏掉的。那个手写数字**现在已经删掉**，
换成机器守门：

| 环节 | 谁做 | 产出 |
|---|---|---|
| 各层跑完把自己的**实测项数**写出来 | `.verify/lib/report.ts` 的 `finish()` | `.verify/tmp/layer-<key>.json`（`pass` / `fail` / `skip` / `measured` / `total`） |
| 逐层与档案声明值比对 | 链尾的 `.verify/meta-check.ts` | `.verify/tmp/layer-counts.json` + 逐层打「声明 X / 实测 Y」 |

`verify:meta` **必须挂在链尾**：`verify:project` 跑在十层的**中间**，它执行时
`engine / parity / archify / scan` 还没开始跑，`layer-<key>.json` 根本不存在 ——
放在那里只能读到半份、或者上一轮的陈旧文件，然后变成一条永远绿的假断言。

它比对四件事，每一件都能红：

1. `arsenal-profiles/arsenal.json` 与 `src/generated/profiles.json` 的 verifyChain 逐层相同
   （抓「改了档案忘了跑 `node scripts/sync-content.mjs`」）；
2. 每层 `total`（= 通过 + 失败 + 未执行）等于档案声明值，不等就打印「声明 34 / 实测 35」；
3. 状态文件里记的声明值与元核对**自己读到的**档案值一致；
4. README 的总数句与分项表每一行的项数 —— 手抄件也归机器管。

另外，**每层在收尾时自己也会拿实测项数比一次档案**，不等就当场判负（退出码 1）——
所以故意改坏一个数字时，出错的那一层与 `verify:meta` 会**同时**红。

**整层跳过不算「核对通过」**：`skipLayer()` 记下的「N 项未执行」里的 N 取自档案声明值
（本层一行都没跑，无从测量），拿它去比声明值等于自己给自己出题。这种层在
`layer-<key>.json` 里带 `countSource: 'declared'`，元核对把它记成**未核对**
（进跳过计数 → 退出码 2），不计入通过。本机没装绘图器，`Archify 链路` 走的就是这条路。

**「刻意未跑」与「跳过」是两件事**（`report.ts` 的 `knowinglySkipped()` vs `skip()`）：

| | 含义 | 进不进项数账 | 退出码 |
|---|---|---|---|
| `skip` / `skipItems` / `skipLayer` | 想跑但跑不了（缺依赖 / 依赖不可达） | 进（算「未执行」项） | `2` |
| `knowinglySkipped` | **本来就不打算跑**（造用例代价过大） | **不进** | 默认不判负；`--strict` 下 `1` |

分开记账的唯一原因：混在一起，「跳过 34 项」这句话就说不出
「其中几项是环境问题、几项是我们决定不跑」。两个数都写进
`.verify/tmp/layer-counts.json`（`skip` 与 `knowinglySkipped` 各一个），人读时看得出区别。

**类型闸门**：`npm run typecheck` = `node node_modules/typescript/bin/tsc --noEmit`
（**不要**用 `node_modules/.bin/tsc`，那是 shell shim，本机必挂；也不要 `npx tsc`）。
它是 runner 里的一个闸门层（不计项数）：先跑根配置守 `src/`，
再跑 `.verify/tsconfig.json` 守那 11 个断言脚本自己 —— 因为
**`.verify/**` 不在根 tsconfig 的 include 里**（TS 的 `**/*.ts` 不匹配点开头的目录，
实测 `--listFiles` 共 521 个文件、`.verify` 下 0 个），只跑根配置的话，
断言脚本的类型错只在**运行时**炸成整层崩。
`noUncheckedIndexedAccess` **暂未开启**：实测打开后 `tsc --noEmit` 报 **139 条**错误
（65×TS18048 / 35×TS2532 / 24×TS2322 / 14×TS2345 / 1×TS2538），
属独立任务，不在本层范围。

下表这十三行的项数**不是装饰**：`verify:meta` 每次都会拿它们与各层跑出来的实测值比对，
抄错一个数字，verify 就红（这张表本身是被断言的）。

| 层 | 项数 | 看什么 |
|---|---|---|
| `verify:arch` | 35 | 能力供需 / 槽位必需性 / 三态结论 |
| `verify:graph` | 75 | 架构图交互层：依赖边与版式边不许混淆、可达/路由自洽、渲染器加法契约、几何不变量（方块无重叠、不越界、不侵入左栏、图例不出画布；并与 SVG 实画反核）；技术栈部署图合并与入口改道不变量（K8s/Docker 多维度合并为单节点、ingress/gateway 选中时请求路径必穿过、未选时保持直连） |
| `verify:cases` | 48 | 场景案例库：驱动参数档位离散、**穷举 9456 组参数断言「命中 + 未命中 == 切片总数」一个都不丢**、同参数两次调用逐字节一致、锚点真在代码里、规则 id 真实存在、无 TODO/反模式、**无死切片**（拼不出「全激活」的场景必须把互斥 driver 声明成数据，不许藏）、**导出整包 ZIP 写出器**（CRC-32 对标准值 / 本地头与中央目录与 EOCD 三个签名 / 偏移自洽 / UTF-8 标志位 / 同输入逐字节可复现）、**驱动参数不许是摆设**（每个 driver 必须被 `slices.when` / `conflicts` / `notSuitableFor` 之一引用，否则构建期即失败；`inert` 标记与「是否被切片引用」、`sensitivity` 实测值双向自洽）、**三层路由契约**（L1 / L2 的 client 根组件存在且带 `'use client'`、`generateStaticParams()` 必须由 `cases` 数组驱动 —— 写死场景 id 会让新场景页静默不生成而本层照旧全绿）、**参数 URL 化**（1000 组**可复现伪随机** encode→decode 恒等、越界与缺位串一律回退到推荐档且**不许抛异常**、参数串形态一位一个驱动）、**三步珠链不给死链**（第 1/2 步的 href 必须指向真实存在的路由目录；L3 切片页未开通时第 3 步只渲染不可点，不给点了会 404 的链接） |
| `verify:project` | 1547 | **案例代码自证**（全部 recipe 的 `files[]` 零 MUST/NEVER 违规、样本量非空且与案例库统计一致、可执行 / 未判两档条数取自规则集实测而非写死常数、三档守恒、未判清单逐条可核、闸门内置反例自证有效、徽标数字不许写死、页面真挂载且展开区锚点齐备、「`files[].code` 只放 good 版」硬约定三处登记）、**规则 ↔ 案例双向互链**（recipesByRule 反向索引真被接上、无关联时不渲染空壳、链路双向可达无死链接、覆盖口径自洽）、**README 正文项数口径**（散文中写下的项数必须等于实测总数 —— 堵住散文中过期项数这类话（2026-09-26 实测抓到过一处：正文还写着上一版的口径，全链却一路全绿））、结构树、启动类、隐患、README、架构图与说明、**部署产物（Dockerfile / Compose / K8s 清单 / Helm Chart 的可应用性与字段一致性）**、zip 打包；**六大架构视图数据层**（每个数字可追溯到真实数据）、技术架构画布加料不变量（页脚 / 署名 / 分区计数）、**图标库与动效**（图标 key 不许静默回落、导出态带动画 / 交互态不带）、**图标资产库**（key 唯一、矢量 key 全部命中 `TECH_ICONS`、代码与架构图数据里的图标引用可解析、位图清单 ↔ 磁盘双向对齐、体积 ≤6MB、页面与菜单成对存在）、**导航与页签契约**（导航不许指向空地址、页面不许成孤儿、**高亮判定按路径边界且判据只有一份** —— 裸前缀会让 `/archify` 把 `/arch` 一起点亮、**侧栏分组折叠**：默认只展开当前页所在的组，判定走同一份 `isNavActive`，折叠只在渲染层过滤（菜单数据少一个地址，①③ 两条就同时失去覆盖），移动端页一级常显不受折叠影响）、**选型快照读写配对**（装配台必须自己恢复选型 / 形态 / 基底 —— 属主不读自己的数据等于刷新即丢；出处通道两端都要在）、**字段契约一致性**（类型声明 ↔ 事实源**双向**比对：类型说必选则每条记录都必须有、数据里「有的有有的没有」则类型必须声明为可选；cookbook 四项统计字段由同步脚本注入，改去对着同步产物核 —— 这就是 `/cases` 白屏事故的根因断言）、**装配台视觉契约**（/stack P1 第一组：台面化 / 权重三档 / 焦点与深度 / 字号四档 / 空态引导；三档宽度分布与 `pipelines` 数据互证、配色不新增谱系）、**装配台 P1 第二组**（S1-4 连线可视化：开关默认关、关闭零动效、reduced-motion 停；S1-5 结论条仪表：ProgressRing 单份定义两处消费、33 格点阵一格一维、颜色与零件卡同一份语义；S2-7 去重收编：tree/arch/risk 页签砍掉、右栏入口保留；S2-1 就地换件：OptionList 选项行单份渲染、portal 换件菜单、推荐排序读 defaultOption；S2-2 一键补齐：只补必选未装、走历史栈一步撤销、回执可核对；S2-4 搜索与三档筛选：互斥单选、命中集合 map dimensions 全集、muted 聚光灯不搬家；S2-5 键盘导航：Esc 分层关闭（换件菜单 > 草稿面板 > 选件面板）、泳道 data-lane + 卡片 ←→ 移焦点、选项行 focus-visible；S2-6 方案对比：arsenal-stack-drafts-v1 读写同源、草稿存 picks+meta+baseId 三通道、差异条逐维度出自 picks 对比且 chip 直达；S3-3 分享链接：picks-store 唯一持有 #s= 编解码、hash 优先于 localStorage 且恢复后即抹（一次性引子）、剪贴板失败降级可复制输入行；S3-4 规则联动：rule-hits.ts 组合→技术 key 映射每格有据、规则 id 全部来自 rules.json、Inspector 挂 RuleHits（选型层逐条 / 基底层收一行））、**机理剧本字段契约**（topology_flows 的形态 / 节点 / 边 / 场景 / 步骤五类记录与类型双向比对，与【22】层的播放行为断言互补）、**判据单一来源（W-0）**（案例库三层判据的阈值只许在 `tools/content/cookbook_contract.py` 定义一处：Python 定义 / `meta.json` / 同步产物三处逐键一致、`build_cookbook()` 与 `sync-content.mjs` 都不许再内联阈值、契约缺键必须失败而**不许**静默回落默认值 —— 回落等于又藏了一份副本）、**装配台 P1 交付中心**（预检闸首屏化且两个版面都在、闸门只展示不算 lint、五类违规逐条 `[check] message`、渲染路径不抛异常、两份包各自独立过闸、下载禁用与闸门同源、export-lint 五检查未被绕过）、**方案历史**（`arsenal-stack-drafts-v1` 仍由 `drafts.ts` 独家真读写、空态可见、恢复 / 删除入口齐备、恢复是三通道整份回灌且进历史栈）、**运行页形态图右栏**（⑨ 只在部署形态步出现且与表单分栏、复用 `buildTopologySvg()` 不重写画法）、**装配台 P1 第二组（2026-09-30）**（⑥ 连接三态卡：三态由 demoMode + 必填是否填完推导、组件内不另存开关、必填集合取自表单事实源；密码「默认不落盘」提示排在表单之前且只出现一次；「本机默认」回落只清非密码必填字段；JourneyBar：角标从 picks 现算且无维度可数的页返回 null 不渲染假角标、窄屏折叠只有一套 DOM 且尺寸走 class 不走内联、四页都把 picks 喂给 JourneyBar）、**装配台 P1 第三组（2026-09-30）**（预检闸的归总只在 useMemo 里算且调用方一侧也 memo；方案历史重读有相等短路，指纹相同保留原引用；形态图右栏不自绘，buildTopologySvg 只调一次；装配台色值只有一处出处（不许裸写 hex / 手拼 rgba / 混用 tailwind 出厂语义色，TONE / INK / SWATCH 之外不许出现第二个色值来源）；徽章分类色走 SWATCH 不借语义色；半透明取色 toneAt() 从 TONE 派生）、**装配台 P2 三项（2026-09-30）**（三张下载卡分主次层级且卡上的包构成从 files 现算；⑧ 交付与运行右栏列出这套选型会生成的部署文件、清单由调用方生成而组件只展示；⑩ 交付右栏概览按类别与顶层目录现算不写死类别名；形态图收 highlight 且每张卡带 dimId 钥匙；副本数的落点 replicaLines() 从生成的部署文件里抽、不照格式背；焦点双向 —— 台上调哪一项图上就亮哪一项，点图上的项焦点回台面）、**装配台步骤路由（2026-10-05）**（十条 `/stack/step/<id>` 页面各自钉住自己的步 —— stepPageMeta 与 StepPage id 同 id、目录即路由；导航地址从 Shell 与 wizard 两处收集去重，十条步骤路由都在「指向真实页面 / 恰好点亮一项」契约内）、**换页即时性（2026-10-12）**（点菜单后不是「等待」而是「切换」：装配台 14 条路由全在同一条 `stack/loading.tsx` 边界之下，URL + 侧栏高亮 + 占位在 11~35ms 先提交，现算的审计/导出/图形随后补 —— 实测 2026-10-12 生产静态站；边界只圈 /stack，全站 loading.tsx 恰好一份；骨架 `components/RoutePending.tsx` 单份出处、住 components/ 以避开【26】色值扫描范围；占位文案不许有数字（写「约 0.5 秒」就是对没测过的环境撒谎）、不许有假 h1、必须带 `role="status"`）、**架构图谱合并 · 画布进台（2026-10-17）**（画布搬进 /autopsy：子页签两分支、picks / titleRoot / irOverride 三件接线、副本数只从部署清单读不兜底、IR 二义收口、画布主题自管 preset、编辑态按项目分键、部署图卡片撤下、/arch 默认路径字节级不变） / **质检台 Q1 数据契约 7 条（2026-10-18）**（RuleIndex 热加载 volatile 快照 + synchronized refresh / reload 端点存在且 AtomicBoolean 防重入 / violationNode 挂规则快照 + impact·impactSource（autopsy 与 qa 共用出口一起吃）/ assemble schemaVersion=2 + ruleset stamp + groupedByRule 后端算 / 聚合 count=items.size() 铁律（不许另设计数器）/ impact 派生单一出处与两级来源标注（rule-impact / rule-rationale）/ 前端契约全 additive 可选（写成必填 = 旧 v1 报告在类型层就打不开）；行为级验证在免 Spring 探针 Q1Probe：热加载正反样本 69↔70、版本 0.1.0→0.2.0-probe、聚合 Σcount=平铺总数）/ **质检台 Q2 前端重构 5 条（2026-10-18）**（QaLab 拆 7 组件且旧面板函数不许残留、两视图对账 crossCheck 逐档比对且打架亮红上墙、静态 finding 六段详情固定顺序 + file:// 复制降级、规则库账黄条 + 一键 reload 回包前后计数、v1 fallback 纪律缺键渲染人话不许渲染成 0；行为级验证在 mock 报告探针：v2 一致亮绿 / 聚合故意打架亮红 / v1 fallback 三场景） / **统一 projectId（工坊棒1 后端注册表，2026-10-18）**（Node 与后端 ProjectIds 逐字节一致：纯 JS SHA-256 与 Java MessageDigest 同式、取前 12 位十六进制、kind 进串、大小写反例必不同、QaService 委托 ProjectIds 无第二份 sha256 副本） / **结构面板边界收尾 2 条（2026-10-18）**（32-1 派生层源码带边界声明句：命名推断只能起名、不划业务边界、业务语义归功能视图与项目档案 —— scan-check【1c】行为级三条在探针拿不到 facts 时整组跳过，这里源码文本兜底；32-2 README「解剖台能回答什么」含项目结构边界行，能力面与实现同说一件事） / **质检台命名门禁 4 条（2026-10-18）**（全仓旧词只剩白名单——白名单外 0 处；白名单内恰好还在：ReproAuthor 的 LLM 角色指令不许跟着改名走，改过头=改坏 prompt；导航 /qa 子项 label 与页 title/h1 都钉成「质检台」） |
| `verify:scaffold` | 21 | **脚手架生成链路**（模板↔bundle 逐文件一致、生成 Java import↔pom GAV 零悬空、前端 import↔package.json 零悬空、module.json 字段契约、占位符白名单、三包组装冒烟：全家桶四类文件 / 演示档 / 路由双变体 / feBase=none / 环境烘焙、**导出预检闸**：事故同款组合零违规 / 接管回归 / nacos·jacoco 显式版本 / 五类毒物注入全被拦——同名 bean·悬空 import·无版本依赖·yml 异类键·重复 path） |
| `verify:engine` | 17 | 规则池对账、样本检出、误报检查 |
| `verify:parity` | 16 | 前后端导出逐字节一致性（含后端探针实跑）；**活服务体检** —— 起后端时断言 `/api/stats` 报的条数与分布 == 事实源（防「改了规则忘了重启」的静默漂移），没起服务则明说跳过；**AST 层守门** —— 编译并实跑 `AstProbe`，断言 15 个语法层检查器全部产生带行号违规、5 条类型依赖规则诚实 skipped（此前该探针 0 引用，AstEngine 改坏多少都全绿）；**MCP 层守门** —— 实跑 `mcp-probe.mjs` 27 项协议断言（版本协商 / 4 工具 / resources / prompts / 错误码 / 通知静默） |
| `verify:archify` | 31 | 选型 → 通用绘图器 IR：结构自检 + 对方那九项构图检查 + 后端出图服务实跑 |
| `verify:scan` | 206 | 代码扫描：fixture 仓库逐字段（30 文件，按 kind 取 Deployment 不靠文件名字典序）、确定性（扫两次除时间戳外逐字段相等）、恶意输入（路径逃逸 zip / 超大文件 / `file://` `ssh://` `git://` git / 软链外跳）全被拒且错误码正确、密码与 `.env` 脱敏、不存绝对路径；**三条出图链路**（真实 facts → 部署图 / 分层图 / Archify IR，五主题 SVG 互异、跨带直连画红线、IR 过形状预检 + 九项构图检查、同输入逐字节可复现）、**规模四闸门**（单文件 / 深度 / 文件数 / 超时，都有真实超限用例）、**六视图档案草稿**（读到的填真值、读不到的留 `TODO`，`filled` 计数不许注水）+ **成熟度计数不写死两条**（2026-10-17 图谱棒2：`{draft.filled}`/`{draft.todos.length}` 必须现读上图 —— 写死即红；草稿解析后 `verifyTotal` = 档案自己 `verifyChain` 求和，不在别处另算一份）、**解剖台数据层 7 条**（2026-10-11：`buildAutopsy` 与 `facts-arch` 直算**逐字段等价** —— 抽数据层时顺手改判据会让 /archify 与 /autopsy 各说各的而两边全绿 / 未识别依赖条数与 facts 一致且坐标非空 / 路径解析对照：名字一致不报警、不一致报 `diverged`、zip 不误报 / 映射表规模从同步产物读不写死 / 解剖台五个文件都在 / 四个消费方都走 `autopsy-data` 不许留平行实现 / **服务拓扑产物可复现**（2026-10-12 棒 3：topo 模型与 topoSvg 与 facts 直算逐字节相等 —— 挂面板不许让「看到的图」与「推出的图」静默分家））、**服务拓扑 18 条**（2026-10-12 棒 2/3/5：Java 只摊平 `facts.services.declarations` 不做关联，跨源合并判定全在 TS 纯函数 `buildServiceTopo` 一份 —— compose 4 空格缩进逐服务详情带行号 / k8s 多文档行号各指各的 / 入口 3 个 spring-boot + 1 个裸 main / 微服务夹具五单元两源合并带出处 / ghost-service 声明无代码进冲突清单 / **反向断言：补上代码冲突必须消失** / 单体夹具 1 入口说「单体特征」且三个精确名不合并 / 空信号 0 也是结论并列检查过的信号 / order-service 与 order-svc 近似名不合并 / 同 facts 两次逐字段相等 / **外部目标带 from 且画点线**（2026-10-12 棒 3 目检实测补：0 条内部边 + 1 个外部调用时，模型带 from、图点线连到虚线框、空态说「读到了但目标在声明之外」而不是「都没读到」的假话）/ **仓中仓布局以声明所在目录为根归属**（2026-10-12 棒 5 真扫军火库自身暴露：compose 在子目录、服务代码在同级子目录时，只认入口路径第一段会把精确同名误报成 declared-no-code 假冲突 —— 修复前这条断言是红的）） / **生命体征序列 8 条（2026-10-13 夜跑棒 1）**（`vitals-store.mjs` 追加写完立刻读回校验、序列点除 ts/snapshotId 外逐字段相等 / 曲线 `vitals-series.ts` 同输入两次**逐字节相等**、空序列返回「还没有序列数据」**不画一张看起来健康的空图**、单点只画点不画折线、两点相减体检段真显示 −2、partial 点不进曲线、坏行进 issues **不许静默跳过**、覆盖率分母从数据读不写死 69） / **类清单与目录计数 12 条（2026-10-17 夜跑棒 2，项目结构面板棒 1 的 Java 信号）**（`CodeScanner` 新增 `code.classes[]`：每个 .java 文件一条，带 name/file/line/package/layer/layerBy/annotations，`layer`/`layerBy` 来自既有 `classify()` 原地扩展（返回值改带出处：annotation 硬事实 / name 命名推断 / package 约定推断 / 双 null 未分类），`entryPoints` 口径不动；新增 `code.dirs[]`：`ctx.files()` 全量文件按父目录归并（"" = 仓库根目录），被 `ScanGuard.skipDir` 跳过的目录不在树里 —— 树是「读过的文件」不是磁盘全貌；`classify()` 类名后缀表加封闭集 `Utils`/`Util`/`Helper`/`Tools` → `util`（与既有 Service/Repository 后缀同款性质，**不加 `@Component` → layer 的映射**，`@Component` 杂项落未分类）；断言：Σ `classes[].layer` 与 `layers` 聚合逐键相等（双向，多一个键也是漂移）+ **反向断言删一条必判负** / util 桶 `layerBy` 全为 `name` / `layers` 键集精确钉死（只多 `util` 一个键）/ Σ `dirs.files` === `stats.files` / 根目录 "" 计数 / 三种 `layerBy` 出处齐现且未分类非空 / **arsenal-server 自身真扫四条性质断言**（一致性·目录自洽·util 为 0 也是结论·`target` 零泄漏）） / **结构派生层 14 条（2026-10-17 结构面板棒 2，纯函数层）**（`code-structure.ts`：组树不丢类、约定节点 `src/main/java` 在且子树带计数（中间目录 files=0 看 `total`，根 `total` === Σ `dirs.files`）/ 七行（五带 + util + 未分类）计数和 === 类总数 / 五带 + util 计数和 === `layers` 聚合和（未分类不进聚合，两层口径对齐）/ util 徽标全文带「据类名」依据 / 未分类桶与 `layer=null` 逐一相等且不混已分类类 / 空态明说「未扫到 Java 类」（0 也是结论）/ 同 facts 两次派生逐字段相等 / 五带名与释义逐字复用 `arch-layered` 的 `BAND_NAME`/`BAND_DESC`（单一词汇表）/ Markdown 导出五样齐全 / **反例自证两条各打一个判据**：判据外 `layer` 值必使「七行覆盖」判负（掉出所有行）、只加类不改聚合必使「派生↔聚合」判负（聚合是 Java 侧另一份事实）—— 恒真断言没有意义 / 自身真扫同样过一致性且 util 行为 0） / **结构边界三条（2026-10-18 结构面板棒4）**（树分组节点只来自目录路径 —— 没有按层 / 按类名 / 按业务猜测造出的分组桶；类只挂文件真实路径 —— 命名推断不挪类、不按层分桶；边界声明句常驻 notes 与 Markdown —— 「命名推断只能起名，不划业务边界」跟着每次导出走） / **条目名出圈 9 条分支 + 值级脱敏三层（2026-10-28 自动循环 r14）**（`..\..\win.txt` 反斜杠 / 大小写盘符 / UNC / NUL / 点分段 / 空名 逐条被拒，**正常名字 `src/Ok.java` 仍放行反着验**（全拒也是一样的红），脱敏三层齐：敏感键→`***` / 键名不敏感但值里藏私钥→PEM 块抹掉且原文不残留 / 普通值原样透传。走 `guard-pure` 探针动作直问函数 —— 与 8-5「不真等 180s」同先例，因为条目名只要出圈，黑盒回来的永远是同一张整包 `SCAN_BAD_REQUEST`，六条分支一张都没被单独证明过。**实测结论：九分支与三层脱敏当前行为全部正确，本轮没有发现缺陷 —— 补的是回归护栏，不是修复**） / **闸门其余五处纯判定 6 条（2026-10-28 自动循环 r15）**（接着 r14 的办法把 `ScanGuard` 剩下的纯判定按分支数完：`readable` 的具名文件与前缀分支（fixture 只有 `Dockerfile` 一个具名名，`Jenkinsfile` / `Makefile` / `Dockerfile.prod` / 大写扩展名 各删一行链都不红）+ 无点 / 尾点 / 多段点 / `.env` 边界 / `skippableOversize` 的**分岔**（335519c 把超限拆成「源码整份拒绝 / 二进制跳过并记账」，`ProjectsProbe.quota` 只钉住拒绝那半，跳过那半含 `skippedFiles` 记账全仓库 0 条断言）/ `gitUrlAllowed` 的**正向**（3-3/3-4/3-5 全是拒绝，函数恒 false 时一条不变 —— 三条 https 必须放过：原样、带首尾空格、大写协议；探针回吐的 `value` 也一起对，输入被悄悄改了而 verdict 照旧的绿不算数）/ `fileTooLarge` 与 `isInside` 的 `catch`（读不到大小、真实路径解析失败一律按拦下处理；3-6 撞的是 `fromPath` 的 exists 检查，走不到 `isInside` 的 catch）/ `depth` 的分段计数按实测钉死 —— **根自身是 1 不是 0**（空相对路径在 `AbstractPath` 迭代器里算一段），闸门是 `> MAX_DEPTH` 不影响判定，改它反倒会挪掉 5-2 的 22 层边界。六条同样都带反方向对照（小文件 false、根内真文件 true、正常源码不跳过）。**实测结论：五处判定当前行为全部正确，本轮没有发现缺陷**） / **超限二进制「跳过并记账」摄取侧三条（2026-10-28 自动循环 r16，P1-1c）**（r15 的 3-12 钉的是判据函数该不该跳，这三条钉的是**跳完之后事实有没有留下**：`ProjectCache` 的 `skippedCount++` / `manifest.skipped` / `cache.skippedFiles` 三处删掉任何一条，此前链全绿 —— javadoc 那句「跳过的事实会记进 manifest 与 cache 统计，不是静默消失」原本无人守。5-5 记账齐（`skippedFiles=1` + manifest 带 `skipped` + 字节没落进缓存 + 正常文件一个都不牵连）/ 5-6 被跳过的文件仍计入 `files` 与 `bytes` 配额（否则「跳过」就成了绕过 500MB 总闸门的后门）/ 5-7 **反向对照**：同一条链不放那个 3MB 文件 → `skippedFiles` 必须 0 且 manifest 一条 `skipped` 都没有（恒等于 1 不算过）。夹具与摄取都在探针里做完、搭【5】那趟车。**实测结论：记账链路行为全部正确（files=3 / bytes=3145828 / skippedFiles=1 / xdb 未落盘 / App.java 与 pom 照常复制），未发现缺陷**） / **拼路径 id 消毒口径三条（2026-10-28 自动循环 r17，P1-1d）**（ProjectCache 的 javadoc 宣称与 `ProjectStore.safeId` / `QaService.safeSegment`「同一口径」，而三份函数全仓库 **0 条直接断言**。探针 `id-sanitize` 反射取这三份 private static，九条向量（穿越 / 反斜杠 / 纯点 / 编码 / 空串 / NUL / 65 字符 / 合法 id / null）逐条回吐三份判定 + 消毒后目录真实落点，期望表在前端：5-8 九条**全部不越出缓存根**、消毒后只剩白名单字符、剥出非空的必落进真子目录（塌回根只允许在剥成空串的三条上）/ 5-9 前两份逐向量同结果（null→空串这条分支只有直接喂 null 才看得见）/ 5-10 **反着钉住第三份并不相同**：QaService 是「拒」不是「剥」，八条异常输入一律抛、连 65 字符这种剥离版放行的也拒（64 上限只存在于这一份），只放行合法 id 原样返回。**实测结论：没有可利用缺陷**（拒比剥严，真实 projectId 恒为 12 位十六进制走不到分歧），真问题是注释与实现不符 → 登记 B-10 等人工决定，本轮不擅自统一三份语义） / **跨语言 projectId 行为对拍 4 条（2026-10-28 自动循环 r18，P1-1e）**（「同一地址在两套系统里算出同一身份」这条 棒1 暗伤此前只由**源码长相**守着：31-3/31-4 是正则匹配 `ProjectIds.java` 的 `MessageDigest`/`formatHex`/`substring(0, 12)` 字样，而这份 Java 实现五个探针里**从未执行过一次**（对拍向量 31-1 跑的是 Node 那份）—— 等价重构会让 31-3 因长相红、真漂移反而不红。探针 `id-project` 真跑 Java 侧 normalize + projectIdOf 十五根向量，前端用同一批向量调 Node 那份逐字节对拍：5-11 Java 规范化串逐条钉死 / 5-12 十三条两套实现相同 / 5-13 基线 id 不由被验实现自证（必须等于用 node:crypto 独立算的 sha256 前 12 位，两份同时漂到同一个错值也算红）/ 5-14 **如实钉住当前仅有的两处漂移**：Java 的 trim 只剥 ≤U+0020、JS 的 trim 连 U+00A0 一起剥（带 NBSP 的路径在两套系统里得到两个身份），kind=null 时 Java 拼空串而 JS 拼 `String(null)` → 可达性极低但是真缺陷，对齐方向需人工定 → B-11） / **待检扩展名两份集合的契约 5 条（2026-10-28 自动循环 r19，P1-1f）**（`QaService:68` 的注释自己写着「与 AutopsyService 同一套待检扩展名 —— 两处不一致，`pctOfRepo` 的分母就是假的」，而两份 `EXTS` 五个探针里从未执行过、也没有断言比较过这两套：从任一份删掉 `yaml`，链照绿而占比静默掺水。探针 `exts-contract` 反射取两份 private static 集合，并在 15 文件混扩展名夹具上真跑 `QaService#listCandidateFiles`（walk 级，分母出处）与 `AutopsyService#readable`（文件名级）逐行对吐：5-15 两份逐元素相同（带长度下限，防「两份都被截成同一个东西」空过）/ 5-16 当前集合就是 java·properties·xml·yaml·yml 五个（加 .kt/.sql 是口径变更，要显式改期望表）/ 5-17 十三行非 skipDir 夹具两侧判定逐行一致（大写 `.JAVA`、多点名 `App.Test.java`、无扩展名 `Makefile`/`Dockerfile` 四类边界）/ 5-18 分母口径摊开：15 个文件只有 7 个进分母，`README.md`/`nginx.conf`/`rows.json`/`Makefile`/`Dockerfile` 内容会被读却不计数 → 前端「占全仓 x%」那句文案与口径不符，登记 B-12 / 5-19 反向钉住**该有**的差异：`target/` 与 `.git/` 下两条分母不收而文件名级会说收，skipDir 不许并进 readable。**实测结论：两份集合逐字相同、两侧判定逐行一致，本轮唯一真实问题是用户可见文案（B-12）**） / **QaService 四个 private static 纯判定 6 条（2026-10-28 自动循环 r20，P1-1g）**（`testBaseName` / `statusReason` / `firstNonBlank` / `trimLines` 这四个名字在 `.verify/*.java` 与 `arsenal-web/.verify/*.ts` 里一次都没出现过（grep 计数 0）。探针 `qa-pure` 按名字反射、逐向量回吐原始返回（null → 字面量 NULL、抛异常 → THROWS，让「返回 null / 返回空串 / 抛」三种结果本身可断言），期望表在前端：5-20 十五条命名向量（四种算测试 / 四种不算，含 `Footest.java` 与 `Protest.java` 两条大小写敏感对照 / 两条启发式固有假阳性：裸 `Test.java` 得**空基名**、`TestsFoo.java` 被切成 `sFoo` / null 入参当场 NPE，函数没有 null 守护）/ 5-21 钉住 `statusReason` 的分支顺序（failed 优先于 budgetCut，budgetCut 排在 status 判定之前，所以 status=ok 也会被念成「撞到上限」）/ 5-22 钉住它对 `not-run` 与空 status 一律回「语义层已执行完毕」（默认分支就是「已执行」，调用点靠 `semantic != null` 挡住，函数本身不挡）/ 5-23 `firstNonBlank` 八条（null / 空串 / 纯空白都算未命中，双 null 得空串，b 即使空白也照原样返回 —— 保证的是非 null 不是非空白）/ 5-24 **实测出真缺陷**：`trimLines` 是恒等函数 —— `split(换行, max+1)` 与 `join(换行, lines)` 互逆，五条超限向量输出全部逐字节等于输入、行数一行没减，那句「截到 24 行」从来没生效 → **B-13** / 5-25 现状账：同步产物里 69 条 good 片段最长 21 行、一条都不超过源码里现读的 cap=24（两个数都不写死）→ 缺陷今天不可观测，但语料一涨过 24 行就静默失效，这条先红。**实测纠正判定时的一个猜测：`Protest.java` 不会被误判成「Pro 的测试」，后缀匹配大小写敏感** / **AstEngine 五个工具与 toList 的分支级直问 6 条（2026-10-29 自动循环 r21，P1-1h）**（这五个名字（annName / hasAnnotation / hasMember / typeSimpleName / isPrimitive）与 QaService.toList 此前在 .verify 里 0 直接引用 —— AstProbe 端到端真跑 AstEngine 但断言只对检查器产出的 Finding，等价重构改坏任何一个分支、只要 15 个检查器的夹具恰好没走到，链照绿。探针动作 ast-pure 反射 parse（parse-only，未解析符号照样产树）从真语法树取真 AnnotationTree/ModifiersTree/TypeTree 喂函数，逐向量回吐原始判定：5-26 toList 六条（数组逐元素 / 空数组 / NullNode·MissingNode·文本节点一律空表 —— 产品喂的是 findings.path()，字段缺席与 JSON null 都可达且都不是异常 / Java null 当场 NPE 防御分支）/ 5-27 annName 三分支（简单名原样 Service、全限定 @java.lang.Deprecated 只取尾段 Deprecated、小写 @override 原样保留 —— parse-only 不做符号解析；null 注解树当场 NPE）/ 5-28 hasAnnotation 四分支（精确名 true、**varargs 第二位才轮到也 true** —— 只认第一个名字的实现在这条上红、未命中 false、匹配大小写敏感：问 service 对 @Service 是 false 而问 override 对 @override 是 true；无注解类三问全 false 反方向基线；null ModifiersTree false）/ 5-29 hasMember 只认「名=值」赋值形态（value=「x」 问 value true、**简写 @SuppressWarnings(「x」) 问 value 得 false** —— 单值实参不是 AssignmentTree、问不存在的成员 false）/ 5-30 typeSimpleName 六条（Identifier 照回、MemberSelect 取尾段 List·Entry、ParameterizedType 递归 List<String>→List、数组类型落 toString 兜底 int[]、null 给空串不是 NPE）/ 5-31 isPrimitive 九个闭集（void 算、String/Int/空串不算、null 当场 NPE —— Set.of 的 contains 不收 null）。**实测结论：六个函数当前行为全部正确，本轮没有发现缺陷 —— 补的是分支级护栏，不是修复**）） |

| `verify:topology` | 21 | **部署形态动画**（2026-09-27 新增第十层）：**形态图快照逐字符一致**（`topologyModeSvg()` 重构后输出与重构前 13 modeId / 18 用例 fixture 比对，改几何必须显式重录）、**机理剧本契约**（场景三问齐备 / `highlight`·`active`·`token` 引用无悬空 / **实例数 == replicas == K8s 副本数** / caption ≤ 40 字且含数字必带 refs / 每场景 ≥ 3 步）、**Caffeine 不出现主从·集群**（09-27 真 bug 回归红线）、**播放器默认收起** + `prefers-reduced-motion` 停自动播、类型 ↔ 事实源双向 + 同步产物逐字节一致 |
| `verify:charter` | 197 | **项目章程**（多人协作治理机制，2026-10-03 新增）：**拍板项全部配置化**（改一行 JSON，不改代码）—— `policy` 四个字段：`overdueException`（例外到期未销账：error 判负 / warn 只记债务账 / ignore 不检查）、`orphanBlocks`（债主离队的孤儿例外是否仍判负）、`requireTicket`（工单号是否必填）、`budgetScope`（章程 MUST 是否与 L0 的 50 条共享一个池子）· `budget.mustLimit` 条款数上限读数据 · 条款四字段（`clauseOwner` 谁管这条 / `decidedBy` 依据哪次决策 / `effectiveFrom` **冻结线靠它算** / `pathGlob` 作用域）齐备 · 例外登记簿**五道闸门**（到期日必填不接受永久豁免 / 还债人须在 team / 到期未销账按 policy 处置 / 债主离队转 `orphaned` 不再永久红 / 理由长度下限）· override 三动作（`relax` 必带理由+批准人+到期日、`replace` 必带替换物、指向不存在的规则即报错、**刻意不给第四种 `delete`**）· 基线必须钉版本 · **结构自检**（四类子结构各自都跑了自己的字段校验 —— 摘掉外壳递归后唯一能发现「某个专用判据漏跑」的机制）· **反着验逐条注入真红**（含「不该红的时候没红」：relax 补齐后通过、孤儿例外不红、已销账不红、optional 模式放过无工单号）· **政策生效断言 11 条**（每条政策成对验「改值真改判定」+「反向仍红」—— 专治「字段写进契约但校验器忘了读」，已反验真能发现）· **P1 页面契约 18 条**（纯函数层导���齐全 · today 来自构建期注入且与校验器同源 · 快照 L0 数 == 现扫实测 · 排序不丢条数且两次调用逐项相同 · 债务账按 openDebt 降序且**守恒** · 例外处置随 policy 变 · shared 缺数据时如实说「无法计算」而非显示 0% · 页面三件文件存在 · 侧栏挂上且 glyph 不缺）· **/check 项目模式 6 条**（并入规则池且不改 L0 原数组 / 端到端真检出 / **反证仅 L0 时无该命中** / 命中带 owner 与依据 / 本机跑不了的条款数被算出来 —— 页面必须显示它，否则「0 违规」等于「没查」）· **P2 导出 16 条**（规范书六章齐备含全部 id / 带 policy 取值与判定日 / 标题不重复拼接 / CI 片段两 job 且 PR 门只查 diff / **CI 片段不写死判负口径**（读用户章程的 policy）/ 交付三份且两出口逐字节一致 / 空章程不崩） / **事实源登记 2 条**（README 目录树 + 项目档案 `project.dirs` 都登记了 `arsenal-charter/` —— 硬约定第 4 条「加事实源改四处」里本层能守的两处：漏登记不会有任何东西报错，而「换项目只加这里」这句承诺正是靠这两处承载的）· **P3 一致性引擎 27 条（2026-10-06，第五层全仓聚合）**（五套命名 fixture 真报漂移 / 扫到零文件是 `no-files` 不是 clean —— 摆设最常见的样子 / `rules`·`ruled` 归并成 `rule`，复数与过去式不算新写法 / 近义容差收到 2，滤掉 `checkout`·`checksum` 这类派生词 / 禁用写法命中即报 / 四种 type 都得真抽出写法，未知 type 抛错不静默通过 / 产物与章程配置条目数一致、`scanConsistency` 全仓只有一处定义） |

| `verify:checkup` | 99 | **体检报告**（解剖台「体检」页，2026-10-12 新增第十三层）：**观察项是数据不是代码** —— 判据写在 `arsenal-checkups/checkups.json`（第 9 个事实源，手写 JSON、不进 `tools/content/*.py`），`CheckupEvaluator.java` 去注释后不许出现任何具体事实路径，加一条观察项不用重编译 / **覆盖率必须带分母**（后端从 `rulePool` 现数、前端不许出现写死的 69，实测 42/69 就要显示「覆盖 42/69、27 条没结论」）/ **「没检查」与「检查通过」不许长得一样**（skipped 明细可折叠、0 条时有文案、coverage.total 为 0 时明说「一条都没查」）/ **空态三句话**（某档 0 条仍显示档标题、观察项事实源不可用时明说「没配」而不是「一条都没有」、算不出来的观察项单独记账）/ **分级读枚举**（MUST+NEVER 经 `Severity.blocking()` 判 P0、SHOULD 判 P1、MAY 进 other 不静默丢弃）/ **新事实源四处登记**（README 目录树 + 档案 `project.dirs` + sync 构建期硬失败 + 同步产物 —— 前三处漏登记永远不会红）/ **校验器反着验 16 条**（**rules 清空必须红不许全过** / 算子与 value 类型不配红 / today 未注入红不静默跳过）/ **结构自检 6 条** / **报告里不许有绝对路径**（观察项出处经 `getFileName()` 收敛，并对真跑出来的 JSON 再判一次）/ **服务拓扑观察项判据 1 条**（CK-OBS-007/008 必须走 `code.entryPoints.length` 入口数，不许走 `services.declarations.length` 声明数 —— demo-repo 8 声明 / 1 入口，用声明数会把单体误判成多服务）/ **端到端 9 条**（真跑 `POST /api/autopsy/inspect`，后端不在时明说跳过不装作通过）/ **工坊棒3 +2（2026-10-18）**：体检留档挂载即从服务端读回（facts / latest / history 三件接线）+ L1 复用内容级（报告指纹戳与缓存指纹比对，「用户说没变」声明式分支退场） |
| `verify:visual` | 13 | **唯一一层真的打开浏览器看页面**：A1–A8 八项断言 × 108 张截图矩阵（36 路由 × 3 视口，几何**现测**、不读旧截图报告；cookbook 收敛到 1 个蓝图后由 45 张回落 42 张，2026-09-26 场景库三层页 +9 到 51 张，2026-09-29 装配台拆页 +9 到 60 张、同一夜发现蓝图主题已回到 6 个而旧声明仍按 1 个抽，再 +3 到 63 张，2026-10-04 项目章程页 +3 到 **66 张**，2026-10-05 装配台步骤路由 +30 到 96 张、同日工程规范台 /standards +3 到 99 张，2026-10-11 项目解剖台 /autopsy +3 到 102 张，2026-10-12 质检台 /qa +3 到 **105 张**，2026-10-18 项目工坊 /projects +3 到 **108 张**）——横向溢出 / `main` 一级子元素越界 / 图片加载失败 / `fixed`·`sticky` 元素互不遮挡 / WCAG 2.1 正文对比度 / `<h1>` 唯一 / 页面底部假高度 / 粘性列可滚达（A8）；另含 3 项前置与格式核对（脚本存在、`out/` 已构建、汇总行数）、矩阵与截图台交叉核对、`findings.md` 素材核对。**每项的一条 = 该项在 108 张里任一红**（项数不按张数膨胀，见 `.verify/visual-check.ts` 文件头）。反向验证：七项逐条注入真红，原文见 `arsenal-web/visual/reverse-validation.md` |

改动能力模型、槽位必需性、策略、结构树、架构图渲染或技术架构图（画布 / IR 适配器）之后
**必须重跑**：基线在 `.verify/audit-check.ts`、`.verify/graph-check.ts`、
`.verify/project-check.ts`、`.verify/archify-check.ts` 与 `.verify/scan-check.ts`。

`verify:scan` 需要 bash + JDK 21（它要起后端扫描探针实跑）。缺一个就**明说跳过**、
把本层声明的全部项记为「未执行」并**退出 2**（退出 0 的时代结束了）——
那时「实测」里不含扫描断言，总账会点名「代码扫描（整层未执行）」。

`verify:archify` 需要机器上装了通用绘图器（扳手AI.Archify）。没装时整层 31 项记为
「未执行」并**退出 2**；装了绘图器但后端出图服务不可达时，服务侧那 9 条记为「未执行」，
本层本地 IR 自检仍然真跑。两种都不再计入「通过」。
默认跑 4 套预设 + 8 种边界组合；想穷举七个节点维度的全部 128 种组合：

```bash
cd arsenal-web && ARCHIFY_SWEEP=1 npm run verify:archify
```

它最后 10 项要 `bash` + JDK 21：编译并实跑后端出图服务
（`arsenal-server/.verify/ArchifyProbe.java`），验的是「页面上那颗按钮真的能用」。
上面三节走的是对方的命令行，**覆盖不到服务层** —— 找不到 node、临时文件写错、
子进程输出没被翻译回来，IR 全绿它也照样坏。

> `verify:parity` 需要 `bash` + JDK 21：它要起后端探针实跑一遍导出再逐字节比对。
> 没有 bash 的环境这一层跑不了（报 `execvpe(/bin/bash) failed`），此时其余七层
> 仍然有效 —— 但这一层的「未执行」不再被静默吞掉：
> 探针起不来 → 依赖它的比对项记「未执行」；探针跑成了但没起后端 →
> **活服务那 3 条**（规则数 / 严重度分布 / 分类分布）记「未执行」，
> 本层退出 2，总账里点名「前后端一致性（N 项未执行）」。
> AST 守门组同语义（编译 AstProbe 也要 JDK）；**MCP 守门组只需要 node**
>（`mcp-probe.mjs` 是零依赖脚本，不碰后端 3011），bash 缺件时它仍真跑。


---

## 当前进度

| 资产 | 回答什么 | 规模 |
|---|---|---|
| **规则集** | 不能做什么 | 69 条（MUST 37 + NEVER 13 = 50 条强制级卡满上限；SHOULD 18 + MAY 1） |
| **校验引擎覆盖** | 规则里到底跑得动几条 | **前端 35/69**（纯正则，刻意设计 —— 浏览器里没有编译器）；**后端 42/69**（35 条正则 + 7 条语法树，用 JDK 自带的 `jdk.compiler`，零新增依赖）；**语义（LLM）层 0/43** 未启动。20 条规则声明了语法树查询：其中 8 条同时声明了正则、按「正则优先」路由由正则层出结论，5 条尚无检查器（如实 skipped，不静默忽略）。非正则层一律标 skipped，绝不伪造判定。改 `AstEngine.register()` 或 `LintEngine` 的正则优先路由时要同步这一行 |
| **最佳实践案例库** | 一个功能完整该怎么写，以及**什么时候不要这么写** | 三层结构：**技术**（解决什么 / 什么时候该选它 / 自身边界）→ **场景**（什么情况下用，带可核对信号）→ **方案**（结构 / 代码 / 陷坑 / 模拟接口实测）。当前 6 项技术（虚拟线程 / 数据库连接池 / 重试与超时 / 本地缓存 / Web 分层 / 不可信数据）/ 13 个场景 / 13 套方案 / 20 文件 / 757 行 / 51 条锚点备注 / 10 个可运行实验（真起 HttpServer 假下游，不用 sleep 假装 IO） |
| **场景案例库（/cases）** | 在**这些约束**下该怎么设计（与最佳实践案例库的分工：那边是「教科书范文」，这边是「会诊」） | 9 个场景 / **37 条症状入口** / 67 个条件切片 / 5400 行 SQL+Java / 193 条锚点备注。入口是**症状分诊台**：先说现象（「翻页越往后越慢」）再落到场景，点一条症状就把参数设到该在的档位 —— 不用先理解 6 个参数。每个场景 5~6 个驱动参数（并发量 / 数据规模 / 读写比 / 一致性 / P99 / 增长预期；幂等场景则是调用来源 / 重复窗口 / 一致性 / 有无全局 ID / 幂等存储），每条代码切片带 `when` 条件：**命中的给代码，没命中的必须写明为什么不适用**（不许静默省略），参数组合本身矛盾（如「百万 QPS + 强一致 + P99<50ms」）在页面顶部标黄；有些档位是**互斥的技术路线**（JDK 17 vs 21、过滤 vs 聚合），拼不出「全激活」的场景必须把互斥 driver 声明成数据而不是藏起来。每个场景必须声明 `recommended` 推荐档并由构建期断言**首屏命中 ≥1 个切片**（曾经默认取最小档，落地场景首屏命中 0/8，一进来就是空屏）；每条症状的 `params` 也断言不能通向空结果。合成引擎 `case-synth.ts` 是纯函数，同参数两次调用逐字节一致（9456 组参数已穷举守恒）；整包可导出 .zip（自研零依赖 ZIP 写出器） |
| **架构装配台** | 由哪些零件组成、**拼起来能不能跑** | **六步向导**：① 项目定义（名字 + 形态）→ ② 技术栈基底 → ③ 主题框架（数据库 / 缓存 / 鉴权…按组选主题件）→ ④ 分层装配（7 泳道台面逐层校核）→ ⑤ 部署形态（每个零件几个副本）→ ⑥ 交付。每步只回答一个问题，且**上一步决定下一步的候选**：形态只给可改的起点；主题件定完台面对应槽位就固定；只有装上的零件才进 ⑤ 谈副本。三档结论（能跑 / 零件不全 / 跑不起来）常驻顶部，不属于任何一步。7 泳道 / **33 维度**（9 组）/ **127 选项** / **100 能力** / 21 策略 / 6 套预设。从「只选 Java 组件」扩到「装配一整个项目」：新增运行基石（运行环境 / 入口负载 / 网关 / 编排 / 制品库）、数据生态（检索 / 分析型存储 / 对象存储）、质量工程（测试栈 / 门禁）、运维安全（CI/CD / 监控 / 密钥 / 日志）、部署形态五组。高阶档（APISIX / TiDB / Vault / Istio / 分库分表 …）带「高阶」角标且必须写 ≥2 条翻车场景。**集群形态成为一等公民**：数据库 / 缓存 / 检索 / 队列 / 应用都能选单实例 / 主从 / 组复制 / 分片 / 云原生，形态参与能力判定，并且**真的影响产物** —— K8s `replicas` / PDB / 反亲和、Helm 三份 values、容量摘要、架构图叠层数全部由 `topology.ts` 算出来，`deploy.ts` 里不再有写死的副本数 |
| **图标资产库（/icons）** | 画架构图会用到的图标：**矢量**供架构图节点 / 装配台 / IR 组件用（随 `currentColor` 变色、能进 SVG 导出），**位图**供卡片配图与文档插图用 —— 两套分工固定，不互相替代 | 9 大类 / 81 个登记图标（`tech-icons` 从 89 扩到 **170** 个：第一批是 MySQL / Redis / Nacos 这类技术件，第二批补的是「谁在用系统 / 跑在哪 / 怎么进来 / 一个还是多个」）。全部手绘 SVG，零图标库依赖。事实源 `arsenal-icons/icons.json`（由 `tools/content/icons.py` 生成）；位图分批补，目前 **18/81 张**（9 个类目各 2 张，共 847KB）—— 缺的那些在页面上如实显示为空态并给出可直接使用的生图 prompt。补图三步：生图（prompt 以 `<key> icon` 开头，文件名才带得出 key）→ `cd arsenal-web && npm run icons:rasterize <原图目录>`（缩到 512 方图落位，体积闸门是**全库 ≤6MB**，1024 原图一张就 200KB）→ 在 `tools/content/icons.py` 的 `BITMAPS` 表里登记一行，再跑 `build-content.py` 与 `sync-content.mjs` |
| **架构图谱（/arch，2026-10-17 退役）** | 原六大架构一图讲清：业务 / 数据 / 应用 / 技术 / 产品 / 项目。**已并入解剖台**：`/arch` 现在只是旧书签重定向页，六视图档案与技术架构画布都住 `/autopsy`（渲染代码、档案机制、视觉系统原样迁移，`public/arch/*.webp` 封面插画保留） | 由项目档案驱动：换一份 `arsenal-profiles/<id>.json`（或就地导入）就换一个项目，渲染代码零改动。5 张静态视图 + 技术架构（跟随装配台选型）；视图数字全部从真实数据算出。视觉系统：`arch-glyphs`（30+ 概念图标，每域每层一个）、`tech-icons`（170 个技术组件与架构概念图标）、`arch-motion`（SVG 内嵌动画，导出的 .svg 单独打开照样动）。动效克制：实线不因为动画变虚线（语义优先），`prefers-reduced-motion` 下全部停 |
| **出图服务（/archify）** | 把任意项目的架构 IR 变成一张合格的 HTML 交付图 | 与选型无关：粘贴 / 上传任意 IR → 本地两道预检（形状 + 已知结构坑）→ 后端渲染 → HTML 预览与下载 + 逐条构图诊断。输入不限于军火库自己生成的 IR |
| **项目侦察（/autopsy，原项目解剖台）** | 一个陌生仓库**跑起来是什么样**：几个进程、每个进程的代码在哪、部署清单声明了什么、互相怎么调用、哪些声明对不上代码 | 六个页签：架构面板（2026-10-17 起含原「架构图谱」的技术架构画布与六视图档案）/ 服务拓扑 / 体检报告 / 历史 / 生命体征 / 活体对账。服务拓扑只做**精确匹配**（compose 服务 / k8s 工作负载 / 代码可运行入口三源分开报，能合并的合并、合不了的并排说清），0 和 1 也是结论。真扫证据（2026-10-12）：军火库自身 29 条声明 / 13 个入口 / 15 个单元 / 3 条冲突（app、demo-app 是单体夹具命名对不上，ghost-service 是故意留的幽灵声明 —— 三条全是真冲突）；command-center 9 条声明 / 5 个入口 / 7 个单元 / 2 条冲突（compose 声明的 backend / frontend 与 `src/` 代码布局精确对不上，如实报「归属不了」而不是硬猜）|

装配台的核心是**能力供需模型**：每个选项声明 `requires` / `provides`，
所有已装配方块的 `provides` 求并集，未覆盖的 `requires` 即为缺零件，据此给出三态结论
（跑不起来 / 能跑但零件不全 / 可运行）。隐患不是一句判断，而是补齐
**触发条件 / 可观察现象 / 后果边界**三项——写不出可观察现象的，不算隐患。

一键导出：装配台 ⑥ 交付这一步可导出完整可用的 Spring Boot 工程骨架（构建文件、启动类、
配置类、profile、迁移脚本、冒烟测试、README、隐患体检单、架构图与技术说明）。
项目名在 ① 项目定义里定下后**贯通**所有出口：pom 的 `artifactId`、application.yml 的
`spring.application.name`、K8s / Compose 的应用名、README 与隐患单标题、架构图标题、zip 文件名。

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
呈现，不碰选型判定（编辑态存 localStorage，不进 Git）。它只住 `/autopsy` 的「技术架构」
子页签（2026-09-21 起装配台不再内嵌此页签；2026-10-17 起 `/arch` 整页退役，画布单宿主进
解剖台），选型来自本次扫描（`factsToPicks`），编辑态按项目分键存 localStorage ——
图是交付物，选型判定仍归扫描与装配台。

### 给别的项目出这六张图

这组视图不是「军火库的一个功能页」，它是**对某个项目的六面展示** —— 六张图讲的从来是
「哪个项目」。所以输入口是数据，不是代码：

```
写一份 arsenal-profiles/<你的项目>.json
        │  npm run sync:content        （校验六视图齐备 / id 与文件名一致 / token 写法合法）
        ▼
src/generated/profiles.json           编译期快照
        │
        ▼
/autopsy 的「项目档案」选择器          点一下切过去，或就地粘贴 / 上传一份临时档案
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

#### 出图结果怎么看（三种，成本不同）

成品是**在页面里嵌一层 iframe 预览**的。但图是「按容器宽度等比缩放」的
（成品自己的 CSS 里写着 `svg { width: 100% }`），而预览落在左栏里 —— 于是「看得清」
这件事等于「给它更多宽度/高度」，跟放大镜无关。所以出了三条出口：

| 出口 | 它解决什么 | 实测（平台自身那张图，设计宽 1237） |
| --- | --- | --- |
| **放大预览** | 覆盖层铺满视口，Esc 或点空白关。图仍受成品**自己那套版式**的约束，没有跟着变大到顶 | iframe 1654×949，图 930px（不是宽度不够，是它没把宽度用完） |
| **新标签页打开** | `blob:` 起一个**不带沙箱**的窗口，最彻底：成品自带的右上工具栏（缩放 `+ - 0`、「演示」铺满整屏、主题、风格、导出 SVG/PNG）全部原生可用 | 1441px（顶到它自己的 1440px 阅读宽度，即设计尺寸的 141%） |
| **下载 HTML** | 存成自包含单文件（字体样式全内联），双击就是同一张图 | — |

内联预览（不点任何按钮）是 735px —— 只有设计尺寸的 72%。这张图**读不清不是 bug 是几何**：
要么放大，要么换出口。（三个数出自同一台机器同一次实测，原始输出见
`.workbuddy/_archify-view/result.json`。）

内联 iframe 的沙箱补了 `allow-downloads`：原先只有 `allow-scripts`，于是成品工具栏的
「导出 SVG/PNG」在预览里点了**什么都不发生、也不报错**。同源严格 A/B（同一份产物、唯一变量是
sandbox 标志，带顶层对照）：无 iframe ✅ 下载到 `diagram.svg` → `allow-scripts` ✗ 静默失效 →
`allow-scripts allow-downloads` ✅ 恢复正常。同时加了 `allow="clipboard-write"`（「复制 PNG」同理）。

一个做不到的事顺便说清：成品认 `?present=1`（铺满整屏）与 `?embed=1`（只留图面），
但预览用的是 `srcDoc`，文档没有 URL、给不了查询串 —— 所以「铺满整屏」这条只有
新标签页那条路走得到。

「直接生成 HTML」需要后端（`arsenal-server`，3011）活着 —— 那份渲染器是 Node 的，
浏览器跑不了（见 `arsenal-server/.../archify/ArchifyService.java`）。
后端不在时按钮灰掉、通道那一行说清缺什么，**其余四个出口照常可用**：
「能脱离服务器活着」这条原则没有被打破。后端要能找到技能（默认
`~/.workbuddy/skills/wrench-ai/bin/wrench-ai.mjs`）与 node，两者任一缺失都如实报出来，
用 `ARSENAL_ARCHIFY_CLI` / `ARSENAL_ARCHIFY_NODE` 可以指到实际位置。

### 解剖台能回答什么（/autopsy）

六个页签，各回答一个问题，合起来是「**这个仓库跑起来是什么样**」：

| 页签 | 回答什么 | 怎么读 |
|---|---|---|
| **架构面板** | 这个仓库**长什么样**：技术栈部署（可拖拽画布）/ 应用分层 / 项目结构 / 六视图档案（业务·数据·应用·产品·项目） | 画布选型跟本次扫描走，副本数读部署清单；六视图可离线讲内置档案。与出图服务同源：一份 IR 两个渲染器 |
| **服务拓扑** | 有几个服务、每个服务的代码在哪、部署清单声明了什么、互相怎么调用 | 见下 |
| **体检报告** | 69 条规则里这次真跑动了几条、哪些没跑、没跑的原因 | 观察项是数据不是代码（`arsenal-checkups/checkups.json`），覆盖率必须带分母 |
| **历史** | 历次扫描怎么变的 | 按 git 指纹判「变没变」，0 文件 / 被截断的指纹不许复用 |
| **生命体征** | 体检快照随时间怎么变 | 序列逐字段校验后上图，空序列明说「还没有序列数据」，不画一张看起来健康的空图 |
| **活体对账** | 声明 vs 实测：真把仓库跑起来对账 | 三档结论（match / mismatch / not-run）各带档位字样；跑不动就照实说跑不动，不许写成「健康」 |

**架构面板三条提前说清的短板**（2026-10-17 架构图谱并入时立此存照）：

1. **扫描草稿替代不了手写档案。** 业务定位、消费方、非目标这些话代码里没有，扫不出来
   —— 六视图的完整度取决于你补不补 TODO；平台只保证「补的地方亮出来、没补的不装成补了」。
2. **可拖拽画布改的是呈现，不是事实。** 拖动、改名、加节点、加连线只影响交付图；
   选型判定仍归扫描与装配台 —— 画布顶部的横幅原样写着这条分工。
3. **`/arch` 想恢复画廊，成本 = 把重定向页改回去。** 六视图渲染器是共享组件不绑死路由，
   技术上随时能恢复；但两个 URL 长期讲同一套六视图就是漂移温床 —— 所以退役选了「一个入口」。

**项目结构这一格的边界**（2026-10-18 结构面板棒4 立此存照）：结构卡只给「目录树 + 徽标 +
层级释义」。树的分组只来自真实路径，类挂在它的文件真实路径下；命名推断（`Utils` 后缀这类）
只能给类起徽标（必带「据类名」角标），**不划业务边界** —— 猜「这是订单模块」是功能视图与
项目档案的职责，不是本面板的。判不出的进未分类桶，不塞层；扫描被闸门截断时亮条列出真实
闸门数字。这条边界同时钉在行为断言（scan-check【1c】边界①②③）与源码断言（project-check
【32】）里，声明句被删或能力面被夸大都会红。

**服务拓扑这一档的纪律：只精确匹配，不归一化。** compose 服务 / k8s 工作负载 /
代码可运行入口三个来源**分开报数**（「compose 说 4 个、k8s 说 2 个、入口 4 个」
是三句话，合并成一个数就等于猜）；能按目录名 / 类名 / 包路径精确归上的才合并，
`order-service` 与 `order-svc` 并排展示；归属不了的进冲突清单，带 file:line 证据，
措辞是「没有代码能归属到它」而不是「仓库里找不到代码」—— 单体仓库的代码就在根
目录，只是名字对不上（demo-repo 实测教训）。**0 和 1 也是结论**：没有信号时说清
检查过哪些信号，只有一个入口时说「单体特征」，别把「一个单元」读成「只有一个
服务在跑」。

边界（刻意不做，做计划书第 5 节有全部理由）：不做名称归一化 / 模糊匹配；不把
Maven modules / k8s Service / Dockerfile / Helm chart 算进服务数（构建单元、网络
声明、镜像单元、打包单位是四件不同的事）；不解析 RestTemplate / WebClient 的目标
URL（常在 `${order.url}` 配置里，target=null 进「未解析」桶如实计数）；不猜网关 /
注册中心角色（除非注解真读到）。2026-10-12 真扫军火库自身（29 条声明 / 13 个入口 /
15 个单元 / 3 条冲突，三条全是真冲突）与 command-center（9 条声明 / 5 个入口 /
7 个单元 / 2 条冲突：compose 声明的 backend / frontend 与 `src/` 布局精确对不上，
如实报「归属不了」）各跑过一次，证据在日报里。


---

## 未完成

| 项 | 说明 |
|---|---|
| **MCP Server 适配层** | stdio 服务器**已可用且有守门**：4 工具 + 69 条规则作只读资源 + prompts、版本协商、错误码区分（-32601/-32602/-32603），回归探针 27 项断言挂在 `verify:parity`【7】。接入方法见 [docs/MCP-接入指南.md](docs/MCP-接入指南.md)（含一键安装 `node arsenal-server/scripts/mcp-install.mjs`）。**剩余**：各 AI 客户端侧实测（本机无客户端）、按需补 HTTP/SSE 传输 |
| 后端接入案例库与装配台 | 后端已能出图（`/api/archify`）、校验（`/api/lint`，**2026-09-27 起前端 /check 页「后端深检」按钮已真实调用**）与扫描出图（facts → 三张图），但装配台、蓝图、案例库仍只在前端算 |
| AST 路由收口 | **pathGlob 已收口（2026-09-27）**：AST 层复用正则层同一套 `GlobMatcher`，声明外路径不再触发，并由 `AstProbe` 实跑守门（`verify:parity`【6】；该探针此前 0 引用、从未编译执行）。顺手修了一个真 bug：`TryFinder` 未覆写 `reduce`，WEB-CTRL-004（Controller 禁 try-catch）**从未检出过**。**剩余**：5 条无检查器的 AST 规则（依赖类型解析，待拍板补还是降级）；同根因潜伏缺陷一处 —— `AssertFinder` 的 reduce 未覆写，assert 不在语句链末尾时会把「有断言」误判为「无断言」（TEST-UNIT-002，未修） |
| LLM 语义层 | 仅 MUST / SHOULD，强制要求行号定位 |
| **69 条规则逐条过目** | 需 mryang 标记「同意 / 改 / 删」。没过目就不算军火库 |
| 视觉走查遗留 | `arsenal-web/visual/findings.md` 共 **20 条**。已闭环 **5 条**（V2-01 移动端全站溢出 +53px、V2-02 同根因、V2-11 与 V3-01 是同一处对比度修复、V3-02 `<h1>` 缺失 —— 见该文件的「本轮修复台账」）；**其余 15 条仍开着**，其中 P1 三条：`/archify/` 页硬编码 `localhost:3011`（静态站首屏就是红色错误态）、`/export/` 页 PREVIEW 面板输出的是原始 Markdown 且 `<sub>` 标签以纯文本泄漏、`/icons/` 页「第一批 89 个图标」与同页「登记图标 81」自相矛盾 |
| 视觉走查覆盖 | 108 张矩阵里**逐张看图只判读了 34 张**（其余 74 张未判读：含 2026-09-26 夜新增的 9 张场景页截图、2026-09-29 夜装配台拆页新增的 9 张、2026-10-04 新增的 3 张项目章程页、2026-10-05 新增的 30 张装配台步骤路由页、2026-10-11 解剖台 /autopsy 新增的 3 张、2026-10-12 质检台 /qa 新增的 3 张；老清单见 `visual/findings.md`）；且 `assert.mjs` 的七项断言只覆盖**几何与数值**，「图标认不认得出」「这句结论说不说得通」仍只能靠人看图 |

---

## 内容源约定（改之前先读）

- **改规则内容 → 改 `arsenal-rules/**/*.json`**（规则是手写数据，不经生成器）
- **改案例 / 选型 / 结构 → 改 `tools/content/*.py`**，然后跑生成器，**不要直接改产物 JSON**
- 规则硬约束：`MUST + NEVER ≤ 50`。超了就是设计出了问题，不是阈值太小
