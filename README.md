# 杨先生的军火库 · arsenal

个人代码规范字典 + AI 代码合规校验平台。

目标只有一个：**让任何 AI 生成的代码，都收敛到同一套工程规范上。**

---

## 仓库位置

```
D:\mryang\workspace\2026\arsenal
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
│   └── .verify/                 自检脚本（649 行，属资产，进 Git）
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
npm run build              # 会先自动跑 sync-content.mjs
python -m http.server 3010 -d out
```

> 沙箱里 `next dev` 会被 safe-delete 守卫拦截，所以走「静态构建 + http.server」这条路。

### 后端（3011）

```bash
cd arsenal-server
bash scripts/compile-check.sh      # 本机无 mvn，用 JDK 17 + .m2 跑 javac 静态编译
# 有 Maven 时：mvn spring-boot:run
```

### 自检（改动后必跑）

```bash
cd arsenal-web && npm run verify
```

一条命令跑完三层：**35 项架构判定 + 103 项结构与导出 + 引擎样本**。
改动能力模型、槽位必需性、策略或结构树之后**必须重跑**，基线在
`.verify/audit-check.ts` 与 `.verify/project-check.ts`。

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
配置类、profile、迁移脚本、冒烟测试、README、隐患体检单）。

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
