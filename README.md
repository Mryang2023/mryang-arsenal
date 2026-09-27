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
- **`/arch` 页「导入项目档案」** —— 同一套扫描，产出六视图档案草稿

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
├── arsenal-cookbook/            最佳实践案例数据（1 项技术 / 3 场景 / 3 方案 / 5 文件 / 283 行）
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
│   ├── public/icons/<category>/ 位图资产（分批补；目前 18/81 张，矢量已全量可用）
│   ├── src/lib/                 纯函数层（cookbook / stack / arch / arch-canvas /
│   │                             archify-ir / arch-views / project / zip / icon-assets /
│   │                             topology-figure / topology-flows，都不引绘图库）
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

一条命令跑完十层、共 **1360 项**，外加两个**闸门层**（`typecheck` 与 `verify:meta`，都不计入项数）：

> 那 1360 项**不是手写的**：每层跑完把自己的实测项数写成
> `.verify/tmp/layer-<key>.json`，链尾的 `verify:meta` 再逐层与
> `arsenal-profiles/arsenal.json` 的 `project.verifyChain` 比对 ——
> **对不上就红**。层内加了断言却不改档案，verify 不再全绿（详见下面「项数由实测得出」）。

**`verify` 现在是一个串行 runner（`arsenal-web/scripts/verify-all.mjs`），不是 `&&` 链。**
两层差别是「报告可不可信」：

- **不短路**：以前是 `verify:arch && verify:graph && … && verify:scan`，任何一层红了，
  后面几层**根本不启动**，而「没启动」在退出码上留不下痕迹 —— 报告只显示「第三层红了」。
  现在十层顺序全跑、逐层收集退出码，所以每一层都有行。
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
| `0` | 全绿，且**无任何跳过** | 可以拍胸脯说「十层都跑了」 |
| `2` | 绿（无失败），但**存在跳过** | 可交付，但报告里必须点名哪层跳了、跳了几项 |
| `1` | 有失败（含某层崩溃 / 没写出状态文件 / 空跑却报通过 / **某层实测项数 ≠ 档案声明值**） | 不许交付 |

本机环境满足不了某几层（没起后端 / 没装绘图器）时，用
`npm run verify -- --allow-skip` 把「绿但有跳过」放行成退出码 `0` ——
**跳过项仍会照常打印、照常点名**，只是不判负。这是给「本机就是没后端」的人一条
不撒谎的绿灯，不是把跳过偷偷算成通过。

`npm run verify -- --strict` 是另一个方向：把**「刻意未跑」**的项判成失败（退出码 `1`）。
「刻意未跑」= 造用例代价过大、**不跑是决定而不是意外**的断言 ——
目前 2 项，都在 `verify:scan`（500MB 总字节闸门的真实超限、真等 180s 超时）。
它们与「跳过」分开记账（见下），不进项数合计，所以 1360 的口径不受影响；
但总账里**永远单列一行**，不加 `--strict` 也照打 —— 不打印才是问题。

如果只想**看一眼自己有没有弄坏东西**，看汇总里的**失败**列与「问题清单」即可。
那行总账里的「跳过」是**环境相关**的，别把它当固定值：后端没起时是
「通过 640 / 跳过 34 / 失败 0」（`前后端一致性` 的活服务那 3 条未执行，
加上 `Archify 链路` 整层 31 项未执行）；**起了后端**（`bash arsenal-server/scripts/run.sh`）
就变成「通过 643 / 跳过 31」—— 跳过少 3 项、通过多 3 项，是同一层换了个走法。
那两个退出码 2 都是环境造成的，不是回归。耗时看机器负载：`代码扫描` 常年最慢
（本机实测 72s ~ 321s，它要真编译真跑后端探针），`视觉断言` 约 30~50s（起 msedge 跑 51 张），
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

下表这十行的项数**不是装饰**：`verify:meta` 每次都会拿它们与各层跑出来的实测值比对，
抄错一个数字，verify 就红（这张表本身是被断言的）。

| 层 | 项数 | 看什么 |
|---|---|---|
| `verify:arch` | 35 | 能力供需 / 槽位必需性 / 三态结论 |
| `verify:graph` | 68 | 架构图交互层：依赖边与版式边不许混淆、可达/路由自洽、渲染器加法契约、几何不变量（方块无重叠、不越界、不侵入左栏、图例不出画布；并与 SVG 实画反核） |
| `verify:cases` | 48 | 场景案例库：驱动参数档位离散、**穷举 9456 组参数断言「命中 + 未命中 == 切片总数」一个都不丢**、同参数两次调用逐字节一致、锚点真在代码里、规则 id 真实存在、无 TODO/反模式、**无死切片**（拼不出「全激活」的场景必须把互斥 driver 声明成数据，不许藏）、**导出整包 ZIP 写出器**（CRC-32 对标准值 / 本地头与中央目录与 EOCD 三个签名 / 偏移自洽 / UTF-8 标志位 / 同输入逐字节可复现）、**驱动参数不许是摆设**（每个 driver 必须被 `slices.when` / `conflicts` / `notSuitableFor` 之一引用，否则构建期即失败；`inert` 标记与「是否被切片引用」、`sensitivity` 实测值双向自洽）、**三层路由契约**（L1 / L2 的 client 根组件存在且带 `'use client'`、`generateStaticParams()` 必须由 `cases` 数组驱动 —— 写死场景 id 会让新场景页静默不生成而本层照旧全绿）、**参数 URL 化**（1000 组**可复现伪随机** encode→decode 恒等、越界与缺位串一律回退到推荐档且**不许抛异常**、参数串形态一位一个驱动）、**三步珠链不给死链**（第 1/2 步的 href 必须指向真实存在的路由目录；L3 切片页未开通时第 3 步只渲染不可点，不给点了会 404 的链接） |
| `verify:project` | 1044 | **案例代码自证**（全部 recipe 的 `files[]` 零 MUST/NEVER 违规、样本量非空且与案例库统计一致、可执行 / 未判两档条数取自规则集实测而非写死常数、三档守恒、未判清单逐条可核、闸门内置反例自证有效、徽标数字不许写死、页面真挂载且展开区锚点齐备、「`files[].code` 只放 good 版」硬约定三处登记）、**规则 ↔ 案例双向互链**（recipesByRule 反向索引真被接上、无关联时不渲染空壳、链路双向可达无死链接、覆盖口径自洽）、**README 正文项数口径**（散文中写下的项数必须等于实测总数 —— 堵住散文中过期项数这类话（2026-09-26 实测抓到过一处：正文还写着上一版的口径，全链却一路全绿））、结构树、启动类、隐患、README、架构图与说明、**部署产物（Dockerfile / Compose / K8s 清单 / Helm Chart 的可应用性与字段一致性）**、zip 打包；**六大架构视图数据层**（每个数字可追溯到真实数据）、技术架构画布加料不变量（页脚 / 署名 / 分区计数）、**图标库与动效**（图标 key 不许静默回落、导出态带动画 / 交互态不带）、**图标资产库**（key 唯一、矢量 key 全部命中 `TECH_ICONS`、代码与架构图数据里的图标引用可解析、位图清单 ↔ 磁盘双向对齐、体积 ≤6MB、页面与菜单成对存在）、**导航与页签契约**（导航不许指向空地址、页面不许成孤儿、**高亮判定按路径边界且判据只有一份** —— 裸前缀会让 `/archify` 把 `/arch` 一起点亮）、**选型快照读写配对**（装配台必须自己恢复选型 / 形态 / 基底 —— 属主不读自己的数据等于刷新即丢；出处通道两端都要在）、**字段契约一致性**（类型声明 ↔ 事实源**双向**比对：类型说必选则每条记录都必须有、数据里「有的有有的没有」则类型必须声明为可选；cookbook 四项统计字段由同步脚本注入，改去对着同步产物核 —— 这就是 `/cases` 白屏事故的根因断言）、**装配台视觉契约**（/stack P1 第一组：台面化 / 权重三档 / 焦点与深度 / 字号四档 / 空态引导；三档宽度分布与 `pipelines` 数据互证、配色不新增谱系）、**装配台 P1 第二组**（S1-4 连线可视化：开关默认关、关闭零动效、reduced-motion 停；S1-5 结论条仪表：ProgressRing 单份定义两处消费、33 格点阵一格一维、颜色与零件卡同一份语义；S2-7 去重收编：tree/arch/risk 页签砍掉、右栏入口保留；S2-1 就地换件：OptionList 选项行单份渲染、portal 换件菜单、推荐排序读 defaultOption；S2-2 一键补齐：只补必选未装、走历史栈一步撤销、回执可核对；S2-4 搜索与三档筛选：互斥单选、命中集合 map dimensions 全集、muted 聚光灯不搬家；S2-5 键盘导航：Esc 分层关闭（换件菜单 > 草稿面板 > 选件面板）、泳道 data-lane + 卡片 ←→ 移焦点、选项行 focus-visible；S2-6 方案对比：arsenal-stack-drafts-v1 读写同源、草稿存 picks+meta+baseId 三通道、差异条逐维度出自 picks 对比且 chip 直达；S3-3 分享链接：picks-store 唯一持有 #s= 编解码、hash 优先于 localStorage 且恢复后即抹（一次性引子）、剪贴板失败降级可复制输入行；S3-4 规则联动：rule-hits.ts 组合→技术 key 映射每格有据、规则 id 全部来自 rules.json、Inspector 挂 RuleHits（选型层逐条 / 基底层收一行））、**机理剧本字段契约**（topology_flows 的形态 / 节点 / 边 / 场景 / 步骤五类记录与类型双向比对，与【22】层的播放行为断言互补） |
| `verify:engine` | 17 | 规则池对账、样本检出、误报检查 |
| `verify:parity` | 16 | 前后端导出逐字节一致性（含后端探针实跑）；**活服务体检** —— 起后端时断言 `/api/stats` 报的条数与分布 == 事实源（防「改了规则忘了重启」的静默漂移），没起服务则明说跳过；**AST 层守门** —— 编译并实跑 `AstProbe`，断言 15 个语法层检查器全部产生带行号违规、5 条类型依赖规则诚实 skipped（此前该探针 0 引用，AstEngine 改坏多少都全绿）；**MCP 层守门** —— 实跑 `mcp-probe.mjs` 27 项协议断言（版本协商 / 4 工具 / resources / prompts / 错误码 / 通知静默） |
| `verify:archify` | 31 | 选型 → 通用绘图器 IR：结构自检 + 对方那九项构图检查 + 后端出图服务实跑 |
| `verify:scan` | 69 | 代码扫描：fixture 仓库逐字段（30 文件，按 kind 取 Deployment 不靠文件名字典序）、确定性（扫两次除时间戳外逐字段相等）、恶意输入（路径逃逸 zip / 超大文件 / `file://` `ssh://` `git://` git / 软链外跳）全被拒且错误码正确、密码与 `.env` 脱敏、不存绝对路径；**三条出图链路**（真实 facts → 部署图 / 分层图 / Archify IR，五主题 SVG 互异、跨带直连画红线、IR 过形状预检 + 九项构图检查、同输入逐字节可复现）、**规模四闸门**（单文件 / 深度 / 文件数 / 超时，都有真实超限用例）、**六视图档案草稿**（读到的填真值、读不到的留 `TODO`，`filled` 计数不许注水） |

| `verify:topology` | 20 | **部署形态动画**（2026-09-27 新增第十层）：**形态图快照逐字符一致**（`topologyModeSvg()` 重构后输出与重构前 13 modeId / 18 用例 fixture 比对，改几何必须显式重录）、**机理剧本契约**（场景三问齐备 / `highlight`·`active`·`token` 引用无悬空 / **实例数 == replicas == K8s 副本数** / caption ≤ 40 字且含数字必带 refs / 每场景 ≥ 3 步）、**Caffeine 不出现主从·集群**（09-27 真 bug 回归红线）、**播放器默认收起** + `prefers-reduced-motion` 停自动播、类型 ↔ 事实源双向 + 同步产物逐字节一致 |
| `verify:visual` | 12 | **唯一一层真的打开浏览器看页面**：A1–A7 七项断言 × 51 张截图矩阵（17 路由 × 3 视口，几何**现测**、不读旧截图报告；cookbook 收敛到 1 个蓝图后由 45 张同步为 42 张，2026-09-26 场景库三层页 +9 后再同步为 51 张）——横向溢出 / `main` 一级子元素越界 / 图片加载失败 / `fixed`·`sticky` 元素互不遮挡 / WCAG 2.1 正文对比度 / `<h1>` 唯一 / 页面底部假高度；另含 3 项前置与格式核对（脚本存在、`out/` 已构建、汇总行数）、矩阵与截图台交叉核对、`findings.md` 素材核对。**每项的一条 = 该项在 51 张里任一红**（项数不按张数膨胀，见 `.verify/visual-check.ts` 文件头）。反向验证：七项逐条注入真红，原文见 `arsenal-web/visual/reverse-validation.md` |

改动能力模型、槽位必需性、策略、结构树、架构图渲染或技术架构图（画布 / IR 适配器）之后
**必须重跑**：基线在 `.verify/audit-check.ts`、`.verify/graph-check.ts`、
`.verify/project-check.ts`、`.verify/archify-check.ts` 与 `.verify/scan-check.ts`。

`verify:scan` 需要 bash + JDK 17（它要起后端扫描探针实跑）。缺一个就**明说跳过**、
把本层声明的 69 项全记为「未执行」并**退出 2**（退出 0 的时代结束了）——
那时「实测」里不含扫描断言，总账会点名「代码扫描（69 项未执行）」。

`verify:archify` 需要机器上装了通用绘图器（扳手AI.Archify）。没装时整层 31 项记为
「未执行」并**退出 2**；装了绘图器但后端出图服务不可达时，服务侧那 9 条记为「未执行」，
本层本地 IR 自检仍然真跑。两种都不再计入「通过」。
默认跑 4 套预设 + 8 种边界组合；想穷举七个节点维度的全部 128 种组合：

```bash
cd arsenal-web && ARCHIFY_SWEEP=1 npm run verify:archify
```

它最后 10 项要 `bash` + JDK 17：编译并实跑后端出图服务
（`arsenal-server/.verify/ArchifyProbe.java`），验的是「页面上那颗按钮真的能用」。
上面三节走的是对方的命令行，**覆盖不到服务层** —— 找不到 node、临时文件写错、
子进程输出没被翻译回来，IR 全绿它也照样坏。

> `verify:parity` 需要 `bash` + JDK 17：它要起后端探针实跑一遍导出再逐字节比对。
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
| **最佳实践案例库** | 一个功能完整该怎么写，以及**什么时候不要这么写** | 三层结构：**技术**（解决什么 / 什么时候该选它 / 自身边界）→ **场景**（什么情况下用，带可核对信号）→ **方案**（结构 / 代码 / 陷坑 / 模拟接口实测）。当前 1 项技术 / 3 个场景 / 3 套方案 / 5 文件 / 283 行 / 15 条锚点备注 / 3 个可运行实验（真起 HttpServer 假下游，不用 sleep 假装 IO） |
| **场景案例库（/cases）** | 在**这些约束**下该怎么设计（与最佳实践案例库的分工：那边是「教科书范文」，这边是「会诊」） | 9 个场景 / **37 条症状入口** / 67 个条件切片 / 5400 行 SQL+Java / 193 条锚点备注。入口是**症状分诊台**：先说现象（「翻页越往后越慢」）再落到场景，点一条症状就把参数设到该在的档位 —— 不用先理解 6 个参数。每个场景 5~6 个驱动参数（并发量 / 数据规模 / 读写比 / 一致性 / P99 / 增长预期；幂等场景则是调用来源 / 重复窗口 / 一致性 / 有无全局 ID / 幂等存储），每条代码切片带 `when` 条件：**命中的给代码，没命中的必须写明为什么不适用**（不许静默省略），参数组合本身矛盾（如「百万 QPS + 强一致 + P99<50ms」）在页面顶部标黄；有些档位是**互斥的技术路线**（JDK 17 vs 21、过滤 vs 聚合），拼不出「全激活」的场景必须把互斥 driver 声明成数据而不是藏起来。每个场景必须声明 `recommended` 推荐档并由构建期断言**首屏命中 ≥1 个切片**（曾经默认取最小档，落地场景首屏命中 0/8，一进来就是空屏）；每条症状的 `params` 也断言不能通向空结果。合成引擎 `case-synth.ts` 是纯函数，同参数两次调用逐字节一致（9456 组参数已穷举守恒）；整包可导出 .zip（自研零依赖 ZIP 写出器） |
| **架构装配台** | 由哪些零件组成、**拼起来能不能跑** | **六步向导**：① 项目定义（名字 + 形态）→ ② 技术栈基底 → ③ 主题框架（数据库 / 缓存 / 鉴权…按组选主题件）→ ④ 分层装配（7 泳道台面逐层校核）→ ⑤ 部署形态（每个零件几个副本）→ ⑥ 交付。每步只回答一个问题，且**上一步决定下一步的候选**：形态只给可改的起点；主题件定完台面对应槽位就固定；只有装上的零件才进 ⑤ 谈副本。三档结论（能跑 / 零件不全 / 跑不起来）常驻顶部，不属于任何一步。7 泳道 / **33 维度**（9 组）/ **127 选项** / **100 能力** / 21 策略 / 6 套预设。从「只选 Java 组件」扩到「装配一整个项目」：新增运行基石（运行环境 / 入口负载 / 网关 / 编排 / 制品库）、数据生态（检索 / 分析型存储 / 对象存储）、质量工程（测试栈 / 门禁）、运维安全（CI/CD / 监控 / 密钥 / 日志）、部署形态五组。高阶档（APISIX / TiDB / Vault / Istio / 分库分表 …）带「高阶」角标且必须写 ≥2 条翻车场景。**集群形态成为一等公民**：数据库 / 缓存 / 检索 / 队列 / 应用都能选单实例 / 主从 / 组复制 / 分片 / 云原生，形态参与能力判定，并且**真的影响产物** —— K8s `replicas` / PDB / 反亲和、Helm 三份 values、容量摘要、架构图叠层数全部由 `topology.ts` 算出来，`deploy.ts` 里不再有写死的副本数 |
| **图标资产库（/icons）** | 画架构图会用到的图标：**矢量**供架构图节点 / 装配台 / IR 组件用（随 `currentColor` 变色、能进 SVG 导出），**位图**供卡片配图与文档插图用 —— 两套分工固定，不互相替代 | 9 大类 / 81 个登记图标（`tech-icons` 从 89 扩到 **170** 个：第一批是 MySQL / Redis / Nacos 这类技术件，第二批补的是「谁在用系统 / 跑在哪 / 怎么进来 / 一个还是多个」）。全部手绘 SVG，零图标库依赖。事实源 `arsenal-icons/icons.json`（由 `tools/content/icons.py` 生成）；位图分批补，目前 **18/81 张**（9 个类目各 2 张，共 847KB）—— 缺的那些在页面上如实显示为空态并给出可直接使用的生图 prompt。补图三步：生图（prompt 以 `<key> icon` 开头，文件名才带得出 key）→ `cd arsenal-web && npm run icons:rasterize <原图目录>`（缩到 512 方图落位，体积闸门是**全库 ≤6MB**，1024 原图一张就 200KB）→ 在 `tools/content/icons.py` 的 `BITMAPS` 表里登记一行，再跑 `build-content.py` 与 `sync-content.mjs` |
| **架构图谱（/arch）** | 六大架构一图讲清：业务 / 数据 / 应用 / 技术 / 产品 / 项目 | 由项目档案驱动：换一份 `arsenal-profiles/<id>.json`（或就地导入）就换一个项目，渲染代码零改动。5 张静态视图 + 技术架构（跟随装配台选型）；视图数字全部从真实数据算出。视觉系统：`arch-glyphs`（30+ 概念图标，每域每层一个）、`tech-icons`（170 个技术组件与架构概念图标）、`arch-motion`（SVG 内嵌动画，导出的 .svg 单独打开照样动）、六张 AI 生成封面插画（`public/arch/*.webp`，共 79KB）。动效克制：实线不因为动画变虚线（语义优先），`prefers-reduced-motion` 下全部停 |
| **出图服务（/archify）** | 把任意项目的架构 IR 变成一张合格的 HTML 交付图 | 与选型无关：粘贴 / 上传任意 IR → 本地两道预检（形状 + 已知结构坑）→ 后端渲染 → HTML 预览与下载 + 逐条构图诊断。输入不限于军火库自己生成的 IR |

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
| 视觉走查覆盖 | 51 张矩阵里**逐张看图只判读了 34 张**（其余 17 张未判读，含 2026-09-26 夜新增的 9 张场景页截图；老清单见 `visual/findings.md`）；且 `assert.mjs` 的七项断言只覆盖**几何与数值**，「图标认不认得出」「这句结论说不说得通」仍只能靠人看图 |

---

## 内容源约定（改之前先读）

- **改规则内容 → 改 `arsenal-rules/**/*.json`**（规则是手写数据，不经生成器）
- **改案例 / 选型 / 结构 → 改 `tools/content/*.py`**，然后跑生成器，**不要直接改产物 JSON**
- 规则硬约束：`MUST + NEVER ≤ 50`。超了就是设计出了问题，不是阈值太小
