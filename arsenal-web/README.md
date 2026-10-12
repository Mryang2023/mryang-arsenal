# arsenal-web · 杨先生的军火库（前端）

规则查阅、案例示范、技术选型、代码校验的界面层。
Next.js 16 App Router + React 19 + TypeScript 5.9 + Tailwind 4。

```
npm install
npm run dev      # http://localhost:3010
npm run build    # 静态导出到 out/（可直接扔进内网或对象存储）
```

## 它是怎么拿到内容的

**它不定义任何内容。** 页面上的每一个字都来自仓库根目录的三个数据目录：

```
arsenal-rules/**/*.json       规则集（62 条）
arsenal-cookbook/*.json       最佳实践案例库（4 条端到端垂直切片）
arsenal-stacks/stack.json     技术选型（17 维度 / 42 选项 / 4 预设）
        │
        │  scripts/sync-rules.mjs + scripts/sync-content.mjs
        │  （npm run dev / build 前自动执行）
        ▼
src/generated/{rules,cookbook,stack}.json   （编译期快照，已 gitignore）
        │
        ▼
src/lib/{rules,cookbook,stack}.ts  →  页面 / 校验引擎 / 合成器 / 导出器
```

两个同步脚本都会在构建时做完整性校验，并且**宁可构建失败也不静默降级**：

| 校验 | 时机 |
|---|---|
| 规则字段缺失 / ID 重复 / 无来源出处 | `sync-rules.mjs` → 构建失败 |
| 案例的要点锚点在代码里找不到目标 | `sync-content.mjs` → 构建失败 |
| 案例缺少「不适用边界」或参考出处少于 2 条 | `sync-content.mjs` → 构建失败 |
| 预设引用了不存在的维度或选项 | `tools/build-content.py` → 生成失败 |

第二条尤其重要：案例的编号备注用「代码片段锚点」而不是行号定位。
行号会随代码改动错位，而**错位的备注比没有备注更危险** —— 它会给出一个自信的错误结论。
锚点校验保证备注永远挂在正确的代码上。

第三条守的是案例库的底线：只讲优点、不划边界的范例，会诱导人在错误场景照抄，
那比没有案例更糟。所以「什么时候不要用这套写法」和参考出处是**必填**。

## 页面

| 路径 | 作用 |
|---|---|
| `/` | 概览：规则总量、强制级配额、九大类分布、来源矩阵 |
| `/rules` | 规则库：搜索 + 级别/分类/标签筛选 + 卡片/列表双视图 |
| `/rules/[id]` | 规则详情：反例正例对照、检测方式、出处溯源 |
| `/blueprints` | 最佳实践案例库：4 条端到端垂直切片的入口 |
| `/blueprints/[id]` | 案例详情：不适用边界、数据流、完整代码（带编号备注）、验收清单、常见坑、性能量级、参考出处 |
| `/stack` | 装配台：6 层架构图自由拼装，缺零件直接告诉你跑不起来；配好可导出工程骨架 + 架构图 + 技术说明 |
| `/check` | 校验台：粘贴代码 → 违规清单（带行号）+ 合规分 |
| `/export` | 导出中心：5 种载体一键复制 / 下载 |

## 装配台在做什么

它不只是一张技术对比表 —— 它先回答一个问题：**这套零件拼起来，能跑起来吗？**

**画布。** 17 个模块摆成 6 层泳道（接入层 / 应用能力 / 数据层 / 中间件 / 保障与观测 / 运行时基座），
数据层内部是一条流水线：持久层 → 数据库 → 连接池 → 迁移。
每块方块有三行信息：它是什么、装的是哪个零件、**它向系统提供什么能力**。

**判据是能力供需，不是 if 判断。** 每个选项声明：

```jsonc
"persistence": { "jdbc": {
  "requires": ["cap.jvm", "cap.datasource", "cap.db.sql"],  // 要向系统索要什么
  "provides": ["cap.persistence"]                            // 装上去之后多出什么
}}
```

校验时把所有已装配方块的 `provides` 求并集，再看谁的 `requires` 没被覆盖 ——
没被覆盖就是缺零件。新增一个中间件只要声明能力，校验逻辑一行都不用改。

结论分三档，刻意区分开：

| 结论 | 含义 |
|---|---|
| **跑不起来** | 缺必需模块 / 能力无人提供 / 存在硬冲突（如 WebFlux + 阻塞式持久层） |
| **能跑，但零件不全** | 必选齐了，但建议件留空（没有鉴权、没有可观测性…） |
| **可以跑起来** | 零件齐、能力闭环、无冲突 |

**归并，不重复报错。** 拆掉「数据库」时，不应该既报「缺数据库」又报「数据源无人提供」——
后者是前者的后果。校验器会把这类下游缺口归并成第一条结论的「因此」，写成
「持久层 因此拿不到『数据源连接』」。

**产物。** 当前组合实时合成 7 类东西：
1. **pom.xml** —— 依赖按模块分组去重，业务依赖不写 version
2. **application.yml** —— 每段标注它来自哪一块
3. **Java 配置类** —— 当前组合下必须存在的 Config，含「漏了会怎样」的注释
4. **联动代码** —— 选型对业务代码的实际影响（持久层换了，Service 怎么写就变了）
5. **运维清单** —— 上线前要做的事 + 需要配置的环境变量
6. **组合隐患** —— 「单看都对、组合起来会出事」的提示
7. **给 AI 的约束** —— 一段可直接贴给 AI 的 System Prompt

合成逻辑是纯函数（`composeStack(picks)`），无副作用、无 IO，
因此后端可以复用同一份逻辑产出完全一致的产物。

## 目录

```
scripts/sync-rules.mjs    规则同步 + 完整性校验
scripts/sync-content.mjs  案例 / 选型 / 架构图同步 + 锚点、边界与能力校验
src/lib/types.ts          Rule 对象类型
src/lib/content-types.ts  Feature / Stack 对象类型
src/lib/rules.ts          规则加载、检索、统计
src/lib/cookbook.ts       案例加载 + 锚点定位
src/lib/stack.ts          选型加载 + 合成引擎 + 产物渲染
src/lib/arch.ts           架构装配图 + 可运行性校验（能力供需求解）
src/lib/engine.ts         Level 1 校验引擎（正则层）
src/lib/exporters.ts      5 种载体生成器
src/lib/highlight.ts      极简语法着色（零依赖）+ 跨行 span 安全切行
src/lib/theme.ts          分类 / 严重度 / 代码分层 的识别色
src/lib/samples.ts        校验台演示样本
src/components/           Shell / CodeBlock / CodeWithNotes / CopyButton / SeverityBadge
src/app/stack/            装配台：画布 / 模块方块 / 装配面板
src/app/                  页面
```

## 三个刻意的设计决定

**一、不引入语法高亮库。**
`highlight.ts` 是一个手写的小着色器。军火库要能离线、要能在任何环境构建，
多一个依赖就多一个长期负担。代价是只支持 java / sql / xml / yaml / json。

**二、校验引擎只跑正则层，不伪造结果。**
62 条规则里有 30 条带 `check.regex`，前端就跑这 30 条。
剩下 32 条需要 AST 或语义判定 —— 它们**不会被假装检查过**，而是进 `skipped` 清单如实列出。
一条假阳性会让人开始怀疑整份报告，一旦开始怀疑，工具就死了。

**三、图省事的地方一律不省。**
装配台没有用「一张对比表的 JSON」糊过去，而是给每个选项写全了依赖、配置、配置类、
联动代码、运维动作与坑。因为**一张对比表没法回答「我的项目长什么样」**，
而这个才是用户真正要的东西。

**四、可运行性由数据决定，不由代码决定。**
「缺什么会跑不起来」不是一组写死的 if，而是能力供需求解的结果。
好处是：新增一个中间件只需要在 `tools/content/stack_arch.py` 里声明它提供什么、需要什么，
校验逻辑、画布渲染、结论文案全都自动跟上。
构建期还有一道自检专门拦数据错误 —— 比如某个选项索要的能力只有它自己所在的槽位能提供
（等于向自己索要），这种组合用户永远拼不出来，必须在构建时就炸掉。

## 自检

`npm run verify` 一条命令跑完五层、共 **304 项**（任一层红即中断）：

```
npm run verify:arch        # 35 项：能力供需 / 槽位必需性 / 三态结论
npm run verify:graph       # 56 项：架构图交互层 —— 依赖边与版式边不许混淆、可达/路由自洽、渲染器加法契约
npm run verify:project     # 191 项：结构树、启动类、隐患、README、架构图与说明、zip 打包
npm run verify:engine      # 14 项：校验引擎对靶子样本的命中率与误报检查
npm run verify:parity      # 8 项：前后端导出逐字节一致性（需 bash + JDK 21，起后端探针实跑）
```

## 注意

- `src/generated/` 是生成物，不要手改，也不要提交。
- 案例与选型的源数据是 **Python 生成器产出的 JSON**，不要手改 JSON，改生成器：
  ```
  python tools/build-content.py     # tools/content/*.py  →  arsenal-{cookbook,stacks}/*.json
  ```
  用生成器而不是手写 JSON，是因为 Java / YAML / XML 代码里全是双引号与换行，
  手写 JSON 字符串必须逐行转义，极易出错且不可读。
- 新增案例时，`notSuitable`（≥2 条）与 `references`（≥2 条）是硬性要求，
  生成器与同步脚本各校验一遍 —— 写不出「什么时候不要用」的，不算案例。
- 改规则请改 `arsenal-rules/**/*.json`，前端会自动跟上。
