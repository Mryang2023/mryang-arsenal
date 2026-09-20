# 杨先生的军火库 · arsenal

个人代码规范字典 + AI 代码合规校验平台。

目标只有一个：**让任何 AI 生成的代码，都收敛到同一套工程规范上。**

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
│       ├── stack_base.py stack_data.py stack_mw.py
│       ├── stack_arch.py stack_cross.py stack_presets.py  ← 装配台选型
│       └── stack_project.py     项目结构树 / 启动类 / 导出文件模板
│
├── arsenal-rules/               规则数据源（source of truth，Git 化）
│   ├── _schema/rule.schema.json 规则对象的 JSON Schema
│   ├── meta.json                分类树与统计
│   └── {skeleton,web,service,data,concurrency,reliability,security,test,collab}/*.json
│
├── arsenal-cookbook/            最佳实践案例数据（4 条切片 / 32 文件 / 2214 行）
├── arsenal-stacks/              装配台数据
│   ├── stack.json               17 维度 / 42 选项 / 4 预设
│   ├── architecture.json        6 泳道 / 27 能力 / 16 条组合策略
│   └── project.json             条件化目录树 / 启动类 / 导出文件模板
│
├── arsenal-web/                 Next.js 前端（3010）
│   ├── src/app/{rules,check,export,blueprints,stack}/  五个页面
│   ├── src/lib/{cookbook,stack,arch,project,zip}.ts    纯函数层
│   └── .verify/                 自检脚本（1129 行，属资产，进 Git）
│
├── arsenal-server/              Spring Boot 后端（3011，只读规则集）
│   └── src/main/java/com/arsenal/{loader,engine,exporter,web,domain}
│
└── 杨先生的军火库-*.md          计划书 / 规则基线 / 案例库与选型台 说明
```

### 数据流

```
tools/content/*.py            内容源（改内容改这里，不要改 JSON）
        │  python tools/build-content.py          含构建期校验，失败即中断
        ▼
arsenal-rules/ · arsenal-cookbook/ · arsenal-stacks/     source of truth，进 Git
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
| `GET /api/health` | 存活 + 规则集版本（62 条 / 50 条强制级） |
| `GET /api/stats` | 按严重度、分类统计 |
| `GET /api/rules` · `/grouped` · `/sources` · `/{id}` | 规则查询 |
| `GET /api/export/formats` · `/api/export/{format}` · `/{format}/raw` | 导出六种载体 |
| `POST /api/lint` | 送代码拿违规清单 + 非正则层的 `skipped` 如实披露 |

`POST /api/lint` 的请求体是 `{"files":[{"name":"com/example/UserController.java","content":"..."}]}`。
`name` 用于匹配规则的 `targetGlob`，所以路径要尽量真实 —— 填裸文件名和填完整包路径，匹配到的规则数量差很多。

### 自检（改动后必跑）

```bash
cd arsenal-web && npm run verify
```

一条命令跑完五层、共 **304 项**：

| 层 | 项数 | 看什么 |
|---|---|---|
| `verify:arch` | 35 | 能力供需 / 槽位必需性 / 三态结论 |
| `verify:graph` | 56 | 架构图交互层：依赖边与版式边不许混淆、可达/路由自洽、渲染器加法契约 |
| `verify:project` | 191 | 结构树、启动类、隐患、README、架构图与说明、zip 打包 |
| `verify:engine` | 14 | 规则池对账、样本检出、误报检查 |
| `verify:parity` | 8 | 前后端导出逐字节一致性（含后端探针实跑） |

改动能力模型、槽位必需性、策略、结构树或架构图渲染之后**必须重跑**：基线在
`.verify/audit-check.ts`、`.verify/graph-check.ts` 与 `.verify/project-check.ts`。

> `verify:parity` 需要 `bash` + JDK 17：它要起后端探针实跑一遍导出再逐字节比对。
> 没有 bash 的环境这一层跑不了（报 `execvpe(/bin/bash) failed`），此时前四层
> （35 + 56 + 191 + 14 = 296 项）仍然有效，只有最后一层的 8 项缺失。

---

## 当前进度

| 资产 | 回答什么 | 规模 |
|---|---|---|
| **规则集** | 不能做什么 | 62 条（MUST 37 + NEVER 13 = 50 条强制级卡满上限，SHOULD 12） |
| **最佳实践案例库** | 一个功能完整该怎么写，以及**什么时候不要这么写** | 4 条切片 / 32 文件 / 2214 行 / 98 条锚点备注 / 16 条参考出处 |
| **架构装配台** | 由哪些零件组成、**拼起来能不能跑** | 6 泳道 / 17 模块 / 42 选项 / 27 能力 / 16 策略 |

装配台的核心是**能力供需模型**：每个选项声明 `requires` / `provides`，
所有已装配方块的 `provides` 求并集，未覆盖的 `requires` 即为缺零件，据此给出三态结论
（跑不起来 / 能跑但零件不全 / 可运行）。隐患不是一句判断，而是补齐
**触发条件 / 可观察现象 / 后果边界**三项——写不出可观察现象的，不算隐患。

一键导出：装配台右上角可导出完整可用的 Spring Boot 工程骨架（构建文件、启动类、
配置类、profile、迁移脚本、冒烟测试、README、隐患体检单、架构图与技术说明）。

**架构图是算出来的，不是画出来的。** 装配台「交付 → 架构图」页签把当前组合渲染成
「6 层泳道 + 请求向下穿过」的图：方块是 17 个槽位，缺必需的描红、缺建议的描黄铜、
参与了组合隐患的带 ⚠，层内 `→` 是请求真正流经的顺序，竖虚线右侧是旁路件。
导出包里带 `architecture.svg`（浅色，供文档引用）、`ARCHITECTURE.md`（同源的技术说明）、
以及 `architecture.d2` / `architecture.mermaid` 源码。

这张图没有引任何绘图库，`src/lib/arch-diagram.ts` 一个纯函数直接拼 SVG —— 因为
层是固定的 6 条、槽位是固定的 17 个，坐标能直接算出来。图引擎解决的是**拓扑**，
而这里要的是**版式**：实测把 6 个容器交给 D2，无连线时它横排成一长条，有连线时
按依赖把容器的框都打散了。既然拓扑固定，就不该为了迁就引擎去扭曲数据。

---

## 未完成

| 项 | 说明 |
|---|---|
| **MCP Server 适配层** | **项目成败关键** —— 让 AI 写代码时主动来查规范，才能真的治本 |
| 后端接入案例库与装配台 | 目前后端只读规则集，前端已完整可用 |
| AST 层校验 | 62 条里 32 条需要语法树判定，前端只跑正则层的 30 条 |
| LLM 语义层 | 仅 MUST / SHOULD，强制要求行号定位 |
| **62 条规则逐条过目** | 需 mryang 标记「同意 / 改 / 删」。没过目就不算军火库 |

---

## 内容源约定（改之前先读）

- **改规则内容 → 改 `arsenal-rules/**/*.json`**（规则是手写数据，不经生成器）
- **改案例 / 选型 / 结构 → 改 `tools/content/*.py`**，然后跑生成器，**不要直接改产物 JSON**
- 规则硬约束：`MUST + NEVER ≤ 50`。超了就是设计出了问题，不是阈值太小
