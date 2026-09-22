# 计划 2 · 让引擎说真话（后端 · AST · MCP）

> 归属：台账 B-1 … B-10
> 波次：**Wave 1**（可与计划 1 并行）
> 唯一任务源就是本文。README 里关于「AST 未完成 / MCP 未实现」的说法**是过期的**，不要采信。

---

## 〇、事实基线（先读这一段，别去翻 README）

| 事实 | 证据 |
|---|---|
| 后端 **已实现 15 条 AST 检查器**，用 **JDK 自带 `jdk.compiler`（`JavacTask` + `TreeScanner`），零新增依赖，不需要 JavaParser** | `AstEngine.java:199-215` 注册表恰好 15 条；`:34-36` 明写解析器；`target/scan-probe/com/arsenal/engine/AstEngine.class` + 16 个内部类 |
| 后端可执行 **50/69**（35 正则 + 15 AST） | `LintEngine.java:87-89,160-181` 是驱动点 |
| MCP stdio 服务器 **实测可用**（`initialize` / `tools/list` / `tools/call` 全通，69 条规则 4 个工具） | 手工喂 JSON-RPC 实测；`mcp-stdio.mjs` 零依赖纯 node |
| 规则数据字段名 | `title` / `rationale`（**没有 `description`**）/ `bad` / `good` / `check.{regex,ast,llm,manual}`；`check.llm` 是**字符串**；`check.ast` 是 `{engine,query}`（20 条全在） |

**本计划要关掉的三类谎**：
1. AST 解析失败静默空转，`executableRules` 照样算「已执行」→ `/api/lint` 报**假的 100 分**（P0-2）。
2. MCP 检索读错 4 个字段名 → 反例/正例搜不到、每条结果后面跟一个空行（P1-4a）。
3. 同一套 lint 语义三份实现，**已真实漂移 4 处**（P0-3）。

---

## 一、任务清单

### B-1 MCP `searchRules` 字段对齐（几行，收益最大）

**现状** `arsenal-server/scripts/mcp-stdio.mjs:171-190`：

| 代码读的 | 规则 JSON 里真实的名字 | 后果（已实测） |
|---|---|---|
| `r.description` | **无此字段**（是 `title` / `rationale`） | 每条检索结果标题后跟**一个空行** |
| `r.check?.llm?.query` | `check.llm` 是**字符串** → `.query` 恒 `undefined` | LLM 提示词文本搜不到 |
| `r.badExample` | `bad` | 反例文本搜不到 |
| `r.goodExample` | `good` | 正例文本搜不到 |

`mcp-tools.json:22` 对这个工具的描述恰恰是「拿到本次任务相关的约束句」——**它就是 AI 会不会用这套规范的开关**。

**做**：
1. 修四处字段名（`bad` / `good` / `check.llm` 直取字符串 / `description` → `rationale`）。
2. 层标签（`:188`）现在「只要有 regex 就报正则」，完全忽略 `check.manual`。
   改为**按降级顺序** `regex → ast → llm → manual`（与 `Rule.Check.layer()` 一致），
   并把 `check.manual` 纳入（22 条人工检查说明在检索里必须可见）。
   更准确的做法：一个规则可以有多个层，标签写「正则+AST」这种复合形式。
3. 顺手：`:188` 附近若发现其他读错字段，一并核对（先跑一次全字段 diff，
   用 `node -e` 把 69 条规则的 `Object.keys` 与 `mcp-stdio.mjs` 里读的字段名对比）。

**验收**（给命令）：
```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{}}}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_rules","arguments":{"query":"线程池"}}}' \
 | node arsenal-server/scripts/mcp-stdio.mjs
```
- 结果里**没有空行**（每条 `• [severity] ID（类·层）标题` 后面直接跟说明文本）。
- 取任意一条规则的 `bad` 文本片段当 query → 必须命中（反例可搜）。
- 取某条规则的 `check.manual` 文案片段当 query → 必须命中。
- **反向验证**：把 `r.rationale` 改回 `r.description` → 空行重新出现。

---

### B-2 MCP 评分表用 `SEVERITY_PENALTY`

**现状** `mcp-stdio.mjs:256`：`for (const [, count] of perRule) penalty += 6 + Math.min(count - 1, 4);`
→ **对 SHOULD 扣 6 分（应 2）、对 MAY 扣 6 分（应 0）**，评分基数错 3 倍。
而 `:34` 的 `const SEVERITY_PENALTY = { MUST: 6, NEVER: 6, SHOULD: 2, MAY: 0 }` **全仓零引用（死常量）**。
正确值在 `theme.ts:42-45` 与 `Severity.java:14-17`。

**做**：
1. `penalty += SEVERITY_PENALTY[v.severity] + Math.min(count - 1, 4)` —— 但**上限策略必须与前端一致**：
   先读 `engine.ts` 的 `grade()`（或等价的评分函数）**照抄**它的每规则上限与总分下限，不许自己发明。
2. 若前端用的是「每规则最多扣 N」，把 N 也提为常量（见 B-9 的规格化）。
3. 删掉"死常量"状态后，确认 `SEVERITY_PENALTY` 不再被报为未使用。

**验收**：
- 造三份输入：只违反 1 条 MUST / 只违反 1 条 SHOULD / 只违反 1 条 MAY。
  MCP 输出的 score 必须与**前端 `engine.ts` 的同一输入结果完全相等**（逐字贴出两个数字）。
- **反向验证**：把 `penalty` 改回写死的 6 → MAY 输入从「不扣分」变成「扣 6」，对拍必须红。

---

### B-3 MCP 的 `expect=present` 永不触发

**现状** `mcp-stdio.mjs:233-234` 只做 `if (!isViolation) continue;`。
而 `engine.ts:254` 与 `LintEngine.java:142-147` 都**补了「未找到必需内容」**的逻辑。
→ `expect: present` 型规则（「必须有 X 写法」）在 MCP 永远不触发。

**做**：照 `engine.ts:254` / `LintEngine.java:142-147` 的实现补分支（present 是「未找到 = violation」）。

**验收**：
- 找一条 `expect:present` 的规则（在 `arsenal-rules/**` 里 `grep '"expect": *"present"'` 定位），
  喂一段**缺少**该写法的代码 → MCP 必须产出 violation。
- **反向验证**：喂一段**含**该写法的代码 → 不产出 violation。

---

### B-4 AST 解析失败不再静默（**P0-2 · 本计划最高优先级**）

**现状**：
```java
AstEngine.java:129-132   Parsed parsed = parse(filename, content);
                         if (parsed == null) { return List.of(); }   // 失败与「没命中」不可区分
AstEngine.java:137-140   /** …解析失败时整体返回空 —— 交还 LintEngine 如实归入 skipped，绝不伪造判定。 */
                         // ↑ 注释写的契约，调用方并未这么做
LintEngine.java:161      if (!astRules.isEmpty() && name.endsWith(".java")) { … }   // 非 .java 整层不跑
LintEngine.java:237      … compiled.size() + astRules.size() …                      // 却算进 executableRules
```
三种情况（提交 `.ts` / 提交有语法错的 `.java` / `AstEngine` 解析失败）都是
**无 finding、无 `SkippedRule`、无 note**，而 `executableRules` 照样把它们算作「已执行」
→ `POST /api/lint` 返回 **`score 100 / 合规`**。
前端做法相反（`engine.ts:174-187` 把非正则规则全塞进 `skipped`）—— **两端对同一规则池给出矛盾结论**。

**做**：
1. `parse()` 返回**带状态**的结果，不改用 `null` 表达失败：
   ```java
   enum ParseStatus { OK, NOT_JAVA, SYNTAX_ERROR, COMPILER_MISSING }
   record ParseResult(ParseStatus status, /* tree */ Object unit, String detail) {}
   ```
   `lintFile` 回传失败原因（不是返回空 List）。
2. `LintEngine` 为「因解析失败 / 非 Java 而未跑」的 AST 规则补
   `SkippedRule(layer="ast", reason=…)`，reason 要说明是哪一种（非 Java / 语法不完整 / 编译器缺失）。
3. `executableRules` **只算真的跑过的**（把「已披露为 skipped」的排除出去）。
4. 对齐前端：`score` 的算法要能表达「不可判定」。**先读 `engine.ts` 怎么处理** ——
   若前端在无任何可执行规则时给 `null` 或 0，后端照它做，**不要自己发明第四个约定**。

**验收**（三类输入各给一条 `curl`，期望输出写清）：
| 输入 | 期望 |
|---|---|
| `.ts` 文件（含 ast 规则池） | 响应里**能看到** `layer:"ast"` 的 skipped 条目；`score` **不是 100** |
| 有语法错的 `.java` | 同上，reason 提到「语法不完整」 |
| 正常 `.java` 且确实无违规 | 才允许 100 |
- **反向验证**：把 `parse()` 改回返回 `null` → 三种输入重新变成 100 分且无 skipped（红）。

---

### B-5 后端守恒律

前端有一条守门断言：`run.ts:130-134`「执行 + 披露 == 池子」（执行过的规则数 + 披露为 skipped 的规则数 = 规则池总数）。
后端没有。

**做**：在 `LintEngine` 的评分出口加同构断言：`executed.size + skipped.size == pool.size`。
不成立时：`log.error` 带两边实际数字 + 响应里带 `invariantBroken: true` + 明确说明（**不要静默**）。

**验收**：人为让某条规则既不执行也不进 skipped（临时改一行）→ 断言触发并打印实际数字；改回。
B-6 的 `LintProbe.java` 里要有这一条的口径断言。

---

### B-6 AST 层接入守门（**本计划的交付物，交给计划 1 挂链**）

**现状**（这是最被低估的缺口）：实现得最完整的引擎层（`LintEngine` + `AstEngine`）**没有任何东西在守**：
- `arsenal-server/.verify/AstProbe.java`（236 行）存在，**全仓 0 引用**（只命中它自己），`AstProbe.class` **从未生成**；
- `arsenal-server/scripts/ast-probe.sh` **不存在**；
- `verify:engine`（`.verify/run.ts:28-29`）只 import **前端**引擎，`:75` 断言 `withPattern === 35`；
- `ParityProbe.java:62` 只导出 json / markdown / mcp；`ScanProbe.java` 完全不碰 lint。

→ 一次重构可以让 15 个检查器**全部静默失效**，而 `npm run verify` 依然全绿。

**做**：
1. 补 `arsenal-server/scripts/ast-probe.sh`：用已有的 `_cp.sh` 拼 classpath（`.m2`）→ 编译 → 运行 `AstProbe`
   → 输出稳定 JSON 到 **`<repo>/.verify/tmp/ast-check.json`**，退出码 `0/1/2`（0 通过 / 1 断言失败 / 2 环境缺件）。
   ⚠️ 本机 `bash` 解析到 WSL 桩（`execvpe(/bin/bash) failed`）→ 先按计划 1 的 A-7 找到真 bash，
   或让脚本能被 `bash <abs path of bash.exe>` 调用。脚本用 `#!/usr/bin/env bash`。
2. 修 `AstProbe.java` 使它能真编译真跑（现在它写了断言却从未执行过）：
   - 断言 15 个 checker 对应的规则**都产生了违规（带行号）**；
   - 断言 5 个「需类型解析」的 AST 规则**仍如实留在 skipped**（reason 含「留待 LLM」）；
   - 断言这 15 个规则**不在** skipped 里。
3. 新增 `arsenal-server/.verify/LintProbe.java`，覆盖：
   - B-4 的三类输入（`.ts` / 语法错的 `.java` / 正常无违规）；
   - B-5 的守恒律；
   - B-2 的评分基数（MUST 6 / SHOULD 2 / MAY 0，与前端对拍）。
   同样输出 JSON 到 `.verify/tmp/lint-check.json`。
4. **交接契约（写给计划 1）**：两个 JSON 的形状必须是
   ```json
   { "layer": "ast", "pass": 20, "fail": 0, "skip": 5, "skipped": [{"name":"...","reason":"..."}] }
   ```
   计划 1 的 A-4 会读它算项数、A-5 会把它挂进链尾汇总。**本计划不碰 `package.json`**（那是计划 1 的文件）。

**验收**：
- `bash arsenal-server/scripts/ast-probe.sh` 退出 0；`.verify/tmp/ast-check.json` 存在且能 `JSON.parse`。
- 贴出 15 个 checker 的命中证据（规则 ID + 行号）。
- **反向验证**：把 `AstEngine.register()` 里随便一行注释掉 → probe 必须红（退 1）并指出少了哪条。改回。

---

### B-7 MCP 协议面

**现状** `mcp-stdio.mjs:307-337` 只实现 4 个方法（`initialize` / `ping` / `tools/list` / `tools/call`），
其余一律 `-32601`。另外 `:348-353` **静默丢弃非法 JSON-RPC 行且不回 `-32700`** → 客户端永久等待。

**必做（S 级，先做完再谈其余）**：
1. **`notifications/initialized` 状态机**：现在 `:354` 只按 `startsWith('notification')` 静默丢弃。
   改为：收到 `initialized` 后置 `initialized = true`；未初始化就调 `tools/*` → 回 `-32002`。
2. **版本协商**：`:33` 写死 `const PROTOCOL_VERSION = '2024-11-05'` 并忽略客户端请求的版本。
   照 **`McpToolCatalog.java:124-127`** 已写好的逻辑实现（「客户端传自己的版本时，若认识就回它」）
   —— 逻辑已经存在，`.mjs` 没用它。
3. **错误码区分**：
   - 非法 JSON → `-32700`（**要回**，不能静默丢）
   - 参数缺失 / 形状不对 → `-32602`
   - 内部错误 → `-32603`
   - 方法不支持 → `-32601`（保留）
   **反向验证**：喂一行 `{"jsonrpc":"2.0",` 不完整的 JSON → 必须收到 `-32700` 响应而不是静默。

**应做（M 级）**：
4. `resources/list` + `resources/read`：把 69 条规则按类别暴露为只读资源
   （URI 建议 `arsenal://rules/{category}`、`arsenal://rules/{id}`）。`mcp-tools.json` 里加对应声明。
5. `prompts/list` + `prompts/get`：把现有 `get_prompt` 工具升级为 MCP Prompt，让它能出现在客户端菜单。
6. `tools/list` 响应预留 `nextCursor` 字段（69 条规模不必真分页，但**形状要留位**）。

**可做（标注不做）**：`completion/complete`、`logging/*`、真分页。写进完成报告的「未做」栏。

**验收**：新增 `arsenal-server/.verify/mcp-probe.mjs`，向 stdio 喂 **≥12 条** JSON-RPC
（含 3 条异常：非法 JSON / 未知方法 / 未初始化就调 tools），逐条断言响应形状与错误码，退出码 `0/1`。
输出 JSON 到 `.verify/tmp/mcp-check.json`（形状同 B-6 的契约），一并交给计划 1。

---

### B-8 后端错误处理（6 处，全在体检 §P1-8）

| 位置 | 问题 | 改法 |
|---|---|---|
| `ProjectScanner.java:125-127` | `catch (Exception e) { throw new ScanException(BAD_REQUEST, "扫描失败：" + e.getMessage()); }` → `DeployScanner.java:87` 遇 `EXPOSE 99999999999` 抛 `NumberFormatException`，被吞成 **400** 并把内部异常文本回显给调用方 | 新增 `ScanException.SERVER_ERROR` → **500**；`log.error` 带栈；对外只给泛化文案 |
| `GlobalExceptionHandler.java:110` | 未继承 `ResponseEntityExceptionHandler`；`ExceptionHandlerExceptionResolver`(order 0) 先于 `DefaultHandlerExceptionResolver`(order 1) → `NoResourceFoundException`(404) / 405 / 415 全被兜成 **500**。该文件 `:88-89` 自陈「这个坑踩过五次」，却只补了 `HttpMessageNotReadableException` 一个 | 继承 `ResponseEntityExceptionHandler`（或显式补 404/405/415 三个 handler），逐个验证 |
| `LintEngine.java:64-67` vs `ScanException.TOO_LARGE` | 同一个「太大」语义，前者 **400**、后者 **413**，两套状态码 | 统一 **413** |
| `ArchifyService.java:278` | `receipt.path("ok").asBoolean(false)` → 字段改名/缺失一律 `false` → 每次交付变 `delivered:false` 并给出确定性的「图不合格」结论；反之 `ok:true` 但缺 `validation` 块时返回 `delivered:true` + `0/0 项构图检查` | 改 `readOpt` 式读取：**缺失 → 报「收据无法解析」**（500/明确错误），不伪装成「图不合格」；`validation` 块缺失也要报 |
| `ProjectScanner.java:190-194` | `visitFileFailed` 直接 `CONTINUE` → 读不到的目录产生 **200 OK 且 `files:0, notes:[]`**，UI 渲染成「这个仓库有 0 个文件」；`ScanNote.UNSAFE_PATH`（`ScanNote.java:33`）**全仓零引用** | 留 note；把死常量用起来 |
| `RuleLoader.java:196-199` | 分类目录缺失只 `log.warn` 后 `continue` → 删掉 `arsenal-rules/security/` 服务照常启动、规则静默变少，与该文件 `:30` 自陈契约「有问题就启动失败」矛盾 | 分类目录缺失 → **启动失败**。⚠️ 必须保留「**空目录 ≠ 目录缺失**」的区分，否则空仓库起不来 |

**验收**：每条给一条真实复现命令 + 观察到的状态码（起服务见下），
`curl` 在本机是 Windows 程序 → 输入用 `cygpath -m`、输出 shell 重定向。
`EXPOSE 99999999999` 那个用例必须给出 **500 且响应体不含内部异常文本**。

**起服务**：
```bash
bash arsenal-server/scripts/run.sh      # 3011；JDK17 在 C:/Users/Administrator/.jdks/corretto-17.0.12
```
⚠️ 托管环境注入 `SERVER__PORT=3743`（优先级高于 `application.yml`）→ run.sh 已用 `--server.port` 钉住。
⚠️ 改规则/改 `RuleLoader` 后**必须重启**（RuleLoader 启动时一次性载入）。

---

### B-9 三端 lint 语义规格 + 漂移 #3/#4（**两份文档都漏了这一条**）

**现状**：`engine.ts`（前端）↔ `mcp-stdio.mjs`（MCP）↔ `LintEngine.java`（后端）**逐函数孪生**：
`escapeLiteral` / `globToRegExp` / `normalizePath` / `makeLocator` / `snippetAt` / `collectMatches` / `grade` / 整段评分循环。
**已真实漂移 4 处**（全部实测）：

| # | 漂移 | 证据 | 归属 |
|---|---|---|---|
| 1 | 评分基数错 3 倍（MUST 6 / SHOULD 2 / MAY 0） | `mcp-stdio.mjs:256` 写死 6；死常量 `:34` | **B-2** |
| 2 | `expect=present` 在 MCP 永不触发 | `mcp-stdio.mjs:233-234` | **B-3** |
| 3 | `normalizePath` 去层数不同 | `engine.ts:105-107` 单次 `replace(/^\.\//, '')` vs `GlobMatcher.java:81-93` 用 `while` 去干净 → `././src/Foo.java` 两端归一结果不同 | **本条** |
| 4 | glob 选项 trim 不同 | `engine.ts:88-95` 不 trim vs `GlobMatcher.java:68` 有 `.trim()` → `**/{a, b}/**` 两端匹配不同 | **本条** |

> ⚠️ **#3/#4 在两份文档里都只出现在 P0-3 正文，没有一行进入里程碑**（本次审查补的漏项）。

**做**：
1. 新建 `arsenal-rules/_spec/lint-semantics.json`（**唯一真相**）：
   ```json
   {
     "severityPenalty": { "MUST": 6, "NEVER": 6, "SHOULD": 2, "MAY": 0 },
     "perRuleCap": <从前端 grade() 读出来的真实值>,
     "scoreFloor": 0,
     "normalizePathVectors": [ {"in": "././src/Foo.java", "out": "src/Foo.java"}, ... ≥12 条 ],
     "globVectors": [ {"glob": "**/{a, b}/**", "path": "x/b/y", "match": true}, ... ]
   }
   ```
   （**具体数值必须从现有实现里读出来，不许凭印象填**）
2. 三端共读这份规格：前端 `import` 它、后端作为资源加载、MCP `require` 它。
3. 修 #3：`engine.ts` 的 `normalizePath` 改为 `while` 去干净（与 `GlobMatcher` 一致）。
4. 修 #4：`engine.ts` 的 glob 分支对 alternation 每项 `trim()`（与 `GlobMatcher` 一致）。
5. 对拍脚本：在 `mcp-probe.mjs`（B-6/B-7）里加一节「语义向量三端对拍」——
   同一份向量喂三端，结果必须逐一相等。**前端侧的向量断言请交给计划 1 的 verify 链**（写在交接说明里）。

**验收**：
- 规格里每条向量在**三端**结果一致（贴对拍输出）。
- **反向验证**：把 `engine.ts` 的 `normalizePath` 改回单次 replace → `././src/Foo.java` 的向量必须两端不一致（红）。

---

### B-10 代码与注释里的 JavaParser 纠偏（**本计划负责「代码」的那一半**）

**做**：
1. `arsenal-web/src/lib/engine.ts:164,183`：「由后端 Level 1b（JavaParser）处理」→ `jdk.compiler`。
   ⚠️ 本文件归本计划独占（功能上它就是「引擎」），计划 3 不许碰。
2. `AstEngine.java:42` 注释里的 JavaParser 措辞。
3. `Rule.AstCheck.engineOrDefault()`（`Rule.java:84-86`）默认值 `"javaparser"` → 与实现一致。
   ⚠️ **规则数据里 20 条 `check.ast.engine` 也全是 `"javaparser"`** —— 那部分归**计划 4 的 D-3**。
   **两边必须同批改**，否则又变成「数据说 A、代码说 B」。本计划只改代码默认值，并在完成报告里
   **显著标注「D-3 未完成前，数据仍是不一致状态」**。
4. `McpToolCatalog.java:50-54` 的 `CONFIG_COMMENT`：「AST 深度判定由 F2 接入」→ 已落地的表述。
   ⚠️ **同一句话在前端 `arsenal-web/src/lib/exporters.ts:24-25` 再写一遍**，
   由 `verify:parity` **逐字节比对**（`parity-check.ts:64-87` 那类断言）。
   → **本计划对 `exporters.ts` 的编辑只允许这两行**，且必须**同一次提交里两边一起改**；
   改完必须跑 `npm run verify:parity` 确认绿（否则等于把一句错话冻进受校验的产物，或者把 parity 弄红）。

**验收**：
- `grep -rn "JavaParser" arsenal-server/src arsenal-web/src` → 只剩**明确的「我们不用 JavaParser」说明**（0 命中更佳）。
- `npm run verify:parity` 绿（证明双写同步）。

---

## 二、文件所有权

**允许改**（白名单）：
```
arsenal-server/**                                   （全部：含 scripts/、.verify/*.java、mcp-stdio.mjs）
arsenal-web/src/lib/engine.ts                        （独占）
arsenal-web/src/lib/exporters.ts                     （仅 :24-25 两行）
arsenal-rules/_spec/**                               （新建）
```

**禁止改**（黑名单）：
```
arsenal-web/.verify/**  package.json  tsconfig*  scripts/**   → 计划 1
arsenal-web/src/**（除 engine.ts / exporters.ts 两行）        → 计划 3
arsenal-rules/**（除 _spec/）                                 → 计划 4
arsenal-profiles/**  README.md  docs/**                       → 计划 4
```
⚠️ 尤其：**不要动 `arsenal-profiles/arsenal.json`（哪怕它的 AST 里程碑写着 todo）**
—— 那是计划 4 的 D-2，而且改完必须重跑 `sync-content.mjs`。

---

## 三、验收出口

按顺序跑完，把真实输出贴进完成报告：

1. `bash arsenal-server/scripts/ast-probe.sh` → 退出码 + `.verify/tmp/ast-check.json`
2. `node arsenal-server/.verify/mcp-probe.mjs` → 退出码 + `.verify/tmp/mcp-check.json`
3. MCP 手工喂 JSON-RPC 的 7 条（含 3 条异常）→ 原始响应
4. `curl` 6 条错误处理用例（B-8）→ 状态码 + 响应体片段
5. `/api/lint` 三类输入（B-4）→ `score` 与 `skipped` 条目
6. 三端语义向量对拍结果（B-9）
7. `npm run verify:parity` 绿（B-10 双写同步的证据）
8. **未完成项单列**：`completion/complete`、`logging/*`、真分页、以及 D-3 未落地导致的 engine 字段不一致

---

## 四、风险与注意事项

| 风险 | 说明 | 对策 |
|---|---|---|
| 本机 bash 是 WSL 桩 | `spawnSync('bash')` 报 `execvpe(/bin/bash) failed` → 探针脚本跑不起来 | 先用计划 1 的 A-7（`findBash()`）找到真 Git Bash；或将脚本设计成可被 `bash.exe` 绝对路径调用 |
| 手工拼 `.m2` classpath | `run.sh:34` 写死 `C:/Users/Administrator/.m2/repository`；兄弟文件 `_cp.sh:18-19` 已经修成 `$HOME/.m2/repository` | 探针脚本**复用 `_cp.sh`**，别自己再写一份 |
| `run.sh:105-107` 未加引号的 `$SOURCES` 会词分裂 | `compile-check.sh:26-28` 已用 `mapfile` 修过同一个坑 | 顺手修（属 `arsenal-server/**`，白名单内） |
| 改 `RuleLoader` 后服务行为变化 | 目录缺失改为启动失败，可能把现有环境弄挂 | 先确认 `arsenal-rules/` 下 10 个分类目录都在；保留「空目录 ≠ 缺失」 |
| 异常落到哪个 handler | `GlobalExceptionHandler` 的兜底顺序问题已错 5 种 | B-8 改完必须逐个用 `curl` 验证 404/405/415/413/500 五种 |
| `exporters.ts` 双写 | 只改一边 → parity 红或错话被冻进产物 | 同一次改动里两边一起改，改完立刻 `verify:parity` |
| `.verify/**` 不在 tsconfig | B-6/B-7 的新探针若用 TS，`tsc` 抓不到它 | 探针写成确定性可执行的脚本，**改完立刻实跑** |
