# 计划 3 · 把已实现的能力接到用户手上（前端）

> 归属：台账 C-1 … C-7
> 波次：**Wave 2**（必须等计划 2 的 B-4 落地）
> 唯一任务源就是本文。

---

## 〇、为什么必须等计划 2

**P0-2 未修时，本计划的头号功能是负资产。**

后端 `POST /api/lint` 早就能跑 35 正则 + 15 AST = **50/69**（`LintEngine.java:87-89` → `AstEngine.java:199-215`）。
但 `AstEngine` 解析失败时**静默返回空**，而 `LintEngine.java:237` 的 `executableRules` 照样把它算作「已执行」
→ 用户粘一个 `.ts` 文件也会看到 **`score 100 / 合规`**。

所以：**先把 `lintRemote()` 接上，就是把这个 bug 直接送到用户脸上。**
计划 2 的 B-4 做完（`.ts` / 语法错的 `.java` 不再报 100 分）之后，本计划才可以开工。

同时本计划要修的文案（C-3）里最关键的一条是：
`CheckConsole.tsx:318` 现在告诉用户「想让它们也跑起来，**要等**后端 arsenal-server 的 JavaParser 与 LLM 层」
—— **AST 那一半的等待早就结束了**，只是前端从来没去调。这是本计划存在的全部理由。

---

## 一、任务清单

### C-1 `lintRemote()` 三态

**现状**：`src/lib/arsenal-api.ts` 只导出 **4 个函数**：
`probeArchify():112` / `deliverArchify():153` / `scanFacts():257` / `scanUpload():282`。
全仓 `grep 'api/lint'` 在 `arsenal-web/src` 内 **0 命中**。

**做**：
1. 加 `lintRemote(files: { path: string; content: string }[])`，**照抄 `ScanOutcome` 的三态范式**
   （`arsenal-api.ts:223-227`）：
   ```ts
   export type LintOutcome =
     | { kind: 'result'; ... }      // 后端给了判定（含 findings / skipped / score / executableRules）
     | { kind: 'rejected'; code: string; message: string }
     | { kind: 'offline'; message: string };
   ```
   三态的语义与 `ScanOutcome` 完全对齐（`facts` → `result`）。**不要发明第四种**。
2. 超时策略沿用 `scanFacts` 的写法（`SCAN_TIMEOUT_MS = 200_000` 那种「让后端先超时、说清是哪一步」的思路），
   lint 应该短得多 —— 先读后端是否有超时，再定一个（建议 30s）。
3. **守住 `arsenal-api.ts:12` 的原则：「能脱离服务器活着」。**
   后端不可达 → `{kind:'offline'}`，由**调用方**回落到本地 `lint()`，并在 UI 里如实说明。
4. 请求/响应字段名必须与 `LintController` 的真实契约一致 —— **先读 `LintController.java` 和 `LintEngine` 的响应 record**，
   不要照文档猜。

**验收**：
- 后端在 3011 跑着：`kind:'result'`，响应里 `executableRules` 含 AST 部分（数字应接近 50，不是 35）。
- 后端停掉：`kind:'offline'`，且 `message` 可读。
- 故意传超限/非法输入 → `kind:'rejected'` 且 `code` 是后端给的错误码。
- 起后端：`bash arsenal-server/scripts/run.sh`（JDK17 在 `C:/Users/Administrator/.jdks/corretto-17.0.12`）。

---

### C-2 `/check` 加「后端深检」入口（**分层呈现**）

**现状**：`src/app/check/CheckConsole.tsx` 粘贴代码只拿到 35/69。

**做**：
1. **默认行为不变**：仍然本地正则层（保证离线可用）。
2. 新增一个**显式**入口（按钮/开关）：「后端深检（50/69）」。
3. 结果**必须分层呈现**，这是本任务的核心，不是装饰：
   - 正则层命中（现有形态）
   - AST 层命中（带行号）
   - **如实 skipped**（带 reason）—— 与「合规」分开，不许混进一个分数里糊过去
   ```
   ┌─ 正则层 35 条 ──── 命中 2 ──┐
   ├─ AST 层  15 条 ─── 命中 1 ──┤   ← 后端深检后才有
   ├─ 未执行 19 条 ─── 原因逐条列 ┤   ← 不许藏
   └─────────────────────────────┘
   ```
4. 复用 `components/CodeIntake.tsx` 已有的三态呈现形态（那个页面已经把 report/rejected/offline 三段式做过了）。
5. 不允许出现「按钮在、点进去空白、零报错」这种页签契约问题（记忆第 6 条）。

**验收**：
- 粘一段含 `new Thread()` 的 Java → 本地层无命中，深检层命中 `CONC-POOL-001`（**先实际确认它是最先命中的那条**，别照抄）。
- 粘一个 `.ts` 文件 → 深检明确显示「AST 层未执行（非 Java）」+ 该层 skipped，**score 不是 100**。
- 后端停掉后点深检 → 明确提示「后端不可达，已回落本地正则层（35/69）」，**不报错、不白屏**。

---

### C-3 前端 UI 文案纠偏

| 位置 | 现在说 | 改成 |
|---|---|---|
| `src/app/check/CheckConsole.tsx:318` | 「（需 AST 或语义判定）。想让它们也跑起来，**要等**后端 arsenal-server 的 **JavaParser** 与 LLM 层。」 | 「AST 层已可由后端就地执行，点『后端深检』即可；**LLM 语义层仍未做**。」 |
| `src/app/page.tsx:430-437` | 进度卡「后端 arsenal-server」state=`doing`，列「**AST 层校验（JavaParser）**」 | AST 已完成；解析器名改 `jdk.compiler`（或直接不写解析器名） |
| `src/app/rules/[id]/page.tsx:180` | 「需要 Java 解析器（**JavaParser**）。由后端 arsenal-server 执行」 | 「由后端执行」这句是对的，保留；`JavaParser` → `jdk.compiler` |
| `src/app/page.tsx:366` | 「语义判定层（LLM）覆盖 {{rules.llmCapable}} 条」措辞暗示已覆盖 | 改为「声明了 LLM 检查的条数」，与 `arsenal.json:383-387` 的「L3 未启动」口径统一 |

⚠️ `src/lib/engine.ts` 的同类文案**归计划 2**（B-10），本计划不许碰那个文件。

**验收**：
- `grep -rn "JavaParser" arsenal-web/src` → 只剩（若有）「我们不用 JavaParser」的说明，0 命中更佳。
- `grep -rn "要等.*JavaParser\|AST 层校验（JavaParser）"` → 0 命中。
- `/check`、`/`、`/rules/WEB-CTRL-002` 三页截图（`msedge --headless --screenshot`）确认文案已变。

---

### C-4 MCP 接入说明（**写新文件，不动 README**）

**现状**：MCP 适配层能跑，但**没有任何注册路径**：
- 后端**没有 `McpController`**（`web` 下 6 个控制器的 `@RequestMapping` 全集是
  `/api/{health,meta,stats,rules,export,lint,archify,scan}` —— 无 `/mcp`）；
- `arsenal-rules/mcp-tools.json:11-17` 的 launcher 只是一个**导出模板**，用户必须手工替换 `__ARSENAL_HOME__`；
- **README 从头到尾没说怎么把 MCP 接进 AI 客户端。**

**做**：
1. **新建 `docs/mcp-setup.md`**（本计划拥有的新文件；README 归计划 4，所以只在这里写，
   由计划 4 的 D-1 在 README 里加一行链接 —— **别去改 README**）。
   内容：Claude Code / Cursor / DSH 各自的配置片段：
   ```json
   { "mcpServers": { "arsenal": {
       "command": "node",
       "args": ["<绝对路径>/arsenal-server/scripts/mcp-stdio.mjs"],
       "env": { "ARSENAL_RULES_DIR": "<绝对路径>/arsenal-rules" } } } }
   ```
   + 4 个工具各一句话说明（`search_rules` / `get_rule` / `lint_code` / `get_prompt`）
   + 实测过的握手样例（`initialize` 的实际响应）
   + **已知限制**：`resources/*`、`prompts/*` 的情况（以计划 2 的 B-7 实际交付为准）×
2. **新建 `arsenal-web/scripts/mcp-launcher.mjs`**：`node scripts/mcp-launcher.mjs --print`
   自动算出本机绝对路径并打印可粘贴的配置 JSON，**用户不再需要手工替换 `__ARSENAL_HOME__`**。
   （只依赖 node，不引第三方包）

**验收**：
- 照 `docs/mcp-setup.md` 从一个干净目录走一遍，`initialize` / `tools/list` 能通（贴原始响应）。
- `node arsenal-web/scripts/mcp-launcher.mjs --print` 输出的两个路径在本机**真实存在**
  （`test -f` 验证，不许只管打印）。
- **反向验证**：把 `ARSENAL_RULES_DIR` 指向一个不存在的目录 → 服务器应给出可读的错误（不是静默 0 条规则）。

---

### C-5 大文件拆分（**只拆"真纠缠"的，不拆"尺寸合理"的**）

已核实行数：`StackComposer.tsx` **928**、`lib/project.ts` **924**、`lib/arch-canvas.ts` **1101**。

**该拆**：
| 文件 | 问题 | 拆法 |
|---|---|---|
| `src/app/stack/StackComposer.tsx` | 主组件从 `:82` 延伸到 `:877` —— **约 796 行单一渲染函数** | 按「选型面板 / 预览 / 导出动作 / 状态管理」切子组件 + 自定义 hook。行为**不许变** |
| `src/lib/project.ts` | 树过滤 `:127` + CJK 宽度排版 `:211/:232` + 代码生成 `:246/:294/:355` + Markdown 报告 `:499/:539` + 导出装配 `buildExportPlan:661`（单函数 196 行）+ 悬空引用检测 `:857` | 拆成 `project/tree.ts`、`project/layout.ts`、`project/codegen.ts`、`project/report.ts`、`project/export-plan.ts`；**原路径必须保持同名 re-export**（否则 `project-check.ts` 的导入会炸） |
| `src/lib/arch-canvas.ts` | 数据装载 + 模型构建 + 布局算法 + 5 套调色板 + SVG 渲染 + Markdown；且与 `archify-ir.ts`（1093 行）**各有一套独立布局引擎** | 拆调色板 / 布局 / 渲染。**不动 `archify-ir.ts`**（它的布局是另一条链路，动了要重跑 Archify 图形断言） |

**不要动**（尺寸合理，拆了反而更难读）：
`tech-icons.ts`（1501 行，是静态 SVG 数据表 `:51-1478`，不是逻辑）、
`deploy.ts`（1534 行，约 40 个**互不调用**的模板发生器 + 一个编排器）、
`DeliveryDeck.tsx`（930 行，已良好分解为 12 个小组件）、
`AstEngine.java`（全仓结构最清晰）、`ArchifyService.java`（职责单一）。

**验收**：
- `npx tsc --noEmit` 0 错、`next build` **86 页全绿**（走 `node scripts/next-run.mjs build`）。
- `npm run verify` 全绿，尤其 `verify:project`【13】的**页签/导航契约**层 ——
  它把源码当数据断言，拆分最容易在这里翻车。
- 拆分**前后**各截一次图（`StackComposer`、`/project`、`/arch`）做像素对比。
- **每拆完一个文件立刻**跑 `tsc` + 跑那一层 verify，**不要攒到最后**。
  ⚠️ `.verify/**` 不在 tsconfig 里，坏 import 只在运行时炸成整层 TypeError。

---

### C-6 生成 JSON 懒加载（**先量后改**）

**现状**：11 个 lib 文件静态 `import … from '@/generated/*.json'`
（`case-cases.ts:1`、`stack.ts:1`、`cookbook.ts:1`、`rules.ts:1`、`arch.ts:1`、`arch-canvas.ts:20`、
`arch-views.ts:1`、`project.ts:1`、`icon-assets.ts:1`、`scan-rules.ts:10`、`exporters.ts:4`）。
`src/generated/` 实测合计 **1086.4 KB**；`next.config.mjs` 是 `output:'export'`，
`CaseLab.tsx`（`src/app/cases/`）是 `'use client'` → 直达 **373.8 KB** 的 `cases.json`。
实测 `/arch` 页 First Load JS **376 kB**。

**做（严格按此顺序）**：
1. **先量 baseline**：`node scripts/next-run.mjs build` 的输出里抄下 `/arch`、`/check`、`/cases`、`/` 的
   First Load JS；再列 `src/generated/*.json` 逐文件字节。
2. 候选手段：路由级 `next/dynamic` 懒加载 `cases.json` 与 `arch-canvas`；列表页只切元数据。
3. **收益 < 20% 就明确写「不做」并给数据。** 不要为了「做了个优化」而引入复杂度。
   `output:'export'` 下 `next/dynamic` 确实会分包，但 `CaseLab` 是客户端组件且同步 import —— **必须实测**。
4. ⚠️ 若决定「列表页只切元数据」→ 要**新增生成物**（`src/generated/*-meta.json`）→
   这会触发 `scripts/sync-content.mjs` 的形状闸门与 `project-check.ts` 的契约
   → **那两个文件归计划 1**，请走「与计划 1 协调」流程，**不要自己改**。
   （更省事的做法：本地 JSON 文件太多就把这条降级为「不做」。）

**验收**：before/after 的 First Load JS **数字** + 一次 `next build` 全绿。
若不做，给出实测数据与结论。

**不要优化**（澄清）：`case-synth` 的 7884 组穷举实测 **3.51 秒**、33 项全通过 —— 性能没问题，
「5427 组」是过期记忆。唯一值得顺手修的不一致：`case-check.ts:210` 用上限 `20000`，
而 `case-synth.ts:205` 与 `case-check.ts:274` 用默认 `5000` → 某场景组合数落在 5000~20000 时会
**静默退化为角点采样**（当前 6 场景均未触发）。
⚠️ `case-check.ts` 归**计划 1** → 这条写成交接说明交给计划 1，本计划不碰。

---

### C-7 前端残留清理

| 位置 | 处理 |
|---|---|
| `arsenal-web/_tsc_out.txt`（894B，内容是 `tsc: line 2: sed: command not found` 之类的调试垃圾） | 删除 |
| `arsenal-web/.workbuddy/`（1.1MB） | 清临时文件。⚠️ **不要删 `.workbuddy/memory/`**（那是记忆，不是缓存） |
| `src/app/export/ExportStudio.tsx:24-30,64-74` | 导出失败时把「导出失败：…」当**文件内容** `a.download` 给用户 → 改为失败提示，**不许下载错误文本** |
| `src/app/rules/[id]/` 在 dev 下 **500 白屏**（不是 404） | `output:'export'` 时 Next 先在 `generateStaticParams()` 找 param，找不到就抛，页面里的 `notFound()` 没机会跑。**评估可行修法并给结论**（可修则修 + 截图；不可修则写清楚原因与影响面） |

**验收**：`ls` 确认残留已清；失败路径手跑一次并把「失败时不再下载文件」截图。
`/rules/不存在的id/` 的 dev 行为给出结论 + 证据（`next dev` 日志 + 浏览器截图）。
⚠️ `next dev` 必须走 `node scripts/next-run.mjs dev -p 3010`，不许直接 `npx next`。

---

## 二、文件所有权

**允许改**（白名单）：
```
arsenal-web/src/**                        （**除 src/lib/engine.ts**）
arsenal-web/next.config.mjs
arsenal-web/public/**
docs/mcp-setup.md                         （新建）
arsenal-web/scripts/mcp-launcher.mjs      （新建）
arsenal-web/_tsc_out.txt                  （删除）
arsenal-web/.workbuddy/_*                 （仅临时调试产物）
```

**禁止改**（黑名单）：
```
arsenal-server/**                       → 计划 2
arsenal-web/src/lib/engine.ts           → 计划 2（它是「引擎」，功能上归计划 2）
arsenal-web/.verify/**                  → 计划 1
arsenal-web/package.json  tsconfig*     → 计划 1
arsenal-web/scripts/**（除 mcp-launcher.mjs）→ 计划 1
README.md                               → 计划 4（接入说明写进 docs/mcp-setup.md，由计划 4 加链接）
arsenal-profiles/**  arsenal-rules/**   → 计划 4
```

⚠️ **`StackComposer.tsx` 里若需要 diff/对比文案**，注意记忆里的坑：
给老文件加 prop/state 前**先 grep 这个名字在文件里已有的声明**；
「状态文案」类局部变量统一叫 `statusMeta`，**不叫 `meta`**（曾因同名撞出「编译不过 + 语义错」双重故障）。

---

## 三、验收出口

1. `/check` 页：本地层结果 / 后端深检结果 / 后端离线三种状态的截图
2. `lintRemote` 三态各一条真实响应（`result` / `rejected` / `offline`）
3. 用户可见覆盖数字：**35/69 → 50/69**（用同一份输入给出前后两次的 findings + skipped 条数）
4. `grep -rn "JavaParser" arsenal-web/src` 的输出
5. `docs/mcp-setup.md` 走查记录 + `mcp-launcher --print` 的路径存在性验证
6. 拆分后：`npx tsc --noEmit` 0 错 + `next build` 86 页 + `npm run verify` 全绿 + 前后截图对比
7. 性能：before/after First Load JS 数字（或「不做」的实测结论）
8. 未完成项单列

---

## 四、风险与注意事项

| 风险 | 说明 | 对策 |
|---|---|---|
| 拆分打断契约 | `verify:project`【13】把源码当数据断言（页签 id ↔ 渲染分支、导航项 ↔ 路由） | 每拆一个文件立刻跑那一层 |
| 拆分改变行为 | `StackComposer` 的导出整包是生产路径 | 拆完必须**手跑一次导出**并解压验证（`zipfile.testzip()`） |
| `.verify` 不在 tsconfig | 坏 import 只在运行时炸 | 实跑那一层 |
| 改 `project.ts` 的导出 | `project-check` / `.verify/*` 里有大量 `import from '@/lib/project'` | 用同名 re-export 保留原路径，**不要搬文件不改导出** |
| 生成 JSON 懒加载触发 sync 闸门 | 新增生成物要改 `sync-content.mjs` + 契约（计划 1） | 收益 < 20% 就砍掉这条任务 |
| safe-delete 守卫 | 删 `_tsc_out.txt` 之类单文件没问题；批量清 `.workbuddy/_*` 要小心 | 单文件直接删；批量走 Python `shutil` 或 `mv` 到临时目录 |
| 多会话并发 | 同仓库可能有夜跑链在写 `src/lib/*` | 动手前取两次 md5 确认没有活写手 |
