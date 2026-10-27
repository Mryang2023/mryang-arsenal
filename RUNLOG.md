# RUNLOG · 迭代流水

## r1 · 2026-10-27 15:34Z — 初始化

**做了什么**
1. 审计结构：`arsenal-server`（Spring Boot 4.1.1 / Java 21 / Maven wrapper）+ `arsenal-web`（Next 16.4 / React 19 / TS）+ 12 个 `arsenal-*` 数据模块。
2. 探测命令：见 `state/RUN_STATE.json` 的 `commands`。`mvn` 不在 PATH，改用 `arsenal-server/mvnw`。
3. **关键发现（安全）**：`main` 上有**用户在途工作**未提交 —— 31 个文件已暂存（docs 归档到 `docs/archive/`，含 17703 行删除 + 若干 web 文件删除），28 个工作区改动，3 个未跟踪。
   → 决定：用 `git checkout -b` 建自动分支（完整保留索引与工作区），后续**只用 `git commit --only <显式路径>`** 提交本循环自己的文件，绝不 `git add -A`、不 `reset`、不 `stash`，避免吞掉或回滚用户的工作。
4. 基线验证：`arsenal-web` typecheck 绿（10.3s / exit 0）。全量 verify 链（13 层）后台跑，日志 `.verify-baseline-r1.log`。

**结果**：状态机文件建立 —— `state/RUN_STATE.json`、`BACKLOG.md`、`RUNLOG.md`、`CHANGELOG.md`、`BLOCKERS.md`。

### 基线总账（r1，全量 verify，227.7s）

`arsenal-web$ npm run verify` → **实测 2270 项 / 通过 2260 / 跳过 4 / 失败 6 → 退出码 1**

| 层 | 声明 | 实测 | 跳过 | 失败 | 结论 |
|---|---|---|---|---|---|
| 架构判定 arch | 35 | 35 | 0 | 0 | 绿 |
| 图与交互 graph | 75 | 75 | 0 | 0 | 绿 |
| 场景案例 cases | 48 | 48 | 0 | 0 | 绿 |
| 结构与导出 project | 1547 | 1547 | 0 | 0 | 绿 |
| 引擎样本 engine | 17 | 17 | 0 | 0 | 绿 |
| 前后端一致性 parity | 16 | 13 | **3** | 0 | 后端 3011 未起 |
| Archify 链路 archify | 20 | 20 | 0 | **2** | 红：标签重叠 |
| 代码扫描 scan | 170 | 170 | 0 | **3** | 红：fixture 真跑不起来 |
| 脚手架 scaffold | 21 | 21 | 0 | 0 | 绿 |
| 项目章程 charter | 197 | 197 | 0 | 0 | 绿 |
| 体检报告 checkup | 99 | **90** | 0 | 0（但层判负） | 红：档案数字漂移 |
| 部署形态 topology | 21 | 21 | 0 | 0 | 绿 |
| 视觉断言 visual | 13 | 12 | 1 | **1** | 红：截图台 108 vs 矩阵 111 |
| 元核对 meta | — | 72 | 0 | **1** | 连带 checkup 判负 |

最慢层：代码扫描 115.1s。安全闸门断言（路径逃逸 zip / 超大文件 / `file://` `ssh://` `git://` 拒绝 / 脱敏）**全绿**。

**结论**：这条链不是「环境没准备好所以跳过」的假绿 —— 它有 4 个各自独立的真根因，已逐一定位并写进 BACKLOG P0-1…P0-4。r2 从最小面、最机械的 P0-1（checkup 声明数漂移）开刀。

## r2 · 2026-10-27 15:54Z — P0-1：checkup 层「声明 99 / 实测 90」

**先做判定（不许跳过的那一步）**：90 到底是真值，还是有 9 条断言被静默删掉？
1. `grep -n "check('端到端" .verify/checkup-check.ts` → 9 条 `check()` 全在（627-635 八条 + 640-644 一条多行调用），**没有断言丢失**。
2. 起后端 `SKIP_COMPILE=1 bash arsenal-server/scripts/run.sh`（3.592s 起来，端口 3011），再跑 `npm run verify:checkup`
   → **实测 99 / 跳过 0 / 失败 0 / exit 0**，端到端 9 条逐条真跑真绿（含「报告 JSON 里没有绝对路径」对产物再判一次）。
3. ⇒ 档案 `project.verifyChain` 里 checkup 的 **99 是真值**，把它改成 90 是掩盖：后端一起来就会反向对不上。

**真正的红在归类**：`.verify/lib/report.ts:218-231` 写明 `knowinglySkipped()` 只装「**配好环境也不会跑**」（造 500MB 用例、真等 180s 这种），
并且它**不进 pass/fail/skip、不参与项数比对**；而「后端未启动」是环境缺口，同一个文件里【11】那 7 条同类情况早已写明要走 `skipItems`
（注释原话：「记账不平比跳过更脏」）。【9】用了 `knowinglySkipped` ⇒ 声明 99 对上实测 90，账永远差 9。

**改动**（1 文件 / +11 −3）：`arsenal-web/.verify/checkup-check.ts`
- 【9】的 `data === null` 分支：`knowinglySkipped(name, reason)` → `skipItems(name, reason, 9)`，注释补上判据与本次红灯出处；
- 顶层 import 去掉已不再用的 `knowinglySkipped`；
- `else` 分支加一行警告：这组 9 条 check 与上面字面量 9、档案 99 三者靠「记账对不上」这条红互锁。

**验证**（只跑相关层；全量 verify 228s > 120s 唤醒间隔，留给确认轮）
| 命令 | 结果 |
|---|---|
| `npm run verify:checkup`（后端**在**） | 实测 99 / 跳过 0 / 失败 0 · exit 0 · `declaredMismatch: null` |
| `npm run verify:checkup`（后端**关**，常态） | 实测 90 / 跳过 9 / 失败 0 · total 99 == 声明 99 · exit 2（跳过不放行，诚实） |
| `npm run verify:meta` | 实测 73 / 跳过 0 / 失败 0 · exit 0（r1 是 1 失败）；13 层「声明/实测」全行**对得上** |
| `npm run typecheck` | exit 0 |
| `npm run typecheck:verify` | exit 0（注意：`typecheck` 的根 tsconfig 排除了 `.verify`，改断言层要跑这一个 —— 链里 `scripts/verify-all.mjs:206` 的两个 tsc 都跑，所以闸门本身没漏；只有 README:353 只写了 `npm run typecheck` 一种） |

**与基线差值**：meta 层 r1 是「72 项 / 1 失败（连带 checkup）」，现在「73 项 / 0 失败」；其余三条红与基线同数、未新增任何失败
（`.verify/tmp/layer-*.json` 现值：archify 2 失败 / scan 3 失败 / visual 1 失败 1 跳过）。checkup 层从「层判负」变成「9 项环境未执行」，
跳过口径 4 → 13（parity 3 + checkup 9），性质与 r1 基线里 parity 的跳过同类 —— 不是新增失败，也不拿它换绿。
**收尾**：后端已 `Stop-Process` 关掉、3011 归还，环境回到本轮开始时状态（后端未运行）。

## r3 · 2026-10-27 16:05Z — P0-2：Archify 边标签与组件重叠（2 项失败）

**注**：本轮起改为同一会话内连续跑（排程工具 `mcp__builtin__qoder_cron` 在 r2 收尾时已不可见，见 BLOCKERS B-5），120s 唤醒节奏不再成立。

**根因定位**（照 BACKLOG P0-2 给的两处源）
- 失败详情：`Label "路由转发" overlaps component "ingress"` —— label rect `[1138,1806,48,14]`，ingress rect `[1060,1752,204,74]`；
  校验器自己给建议 `labelDy +24 (below)`。云/企业/HA/数据密集等多个预设连带红，汇总成 2 条断言：
  【2】14 例逐例九项 + 【4】后端实跑 3 例（`07.json` 直接「没出图」）。
- 看 IR 才知道红的是哪条边：`.verify/tmp/archify-check/02.json` 里 `c_ingress_gateway` 是**没有任何 via / fromSide / labelSegment 的直连边**
  （`arch-canvas.ts` 的入口改道链 `client→ingress→gateway→app`，只有第一条拿得到车道折线）。直连边的默认标签位置落在源框内 → 绘图器 `layout/constraint` 判负。

**修法**（几何值由画布模型给，适配器不猜）
1. `CanvasEdge` 加可选 `labelDy`（arch-canvas.ts:159 那块类型定义）。
2. `rerouteEntryThroughGateway()`：链上 `i>0` 的直连边带 `labelDy: 24`（校验器建议值）。
3. `archify-ir.ts:420`：直连分支透传 `conn.labelDy = edge.labelDy`。
4. **没动校验器、没放宽任何断言、没加 skip** —— 改的是出图侧的几何声明。

**连带发现并处理**：修好后本层实测从 20 涨到 **31**，被自己的「记账对不上」红点出来。
查清才改：`archify-check.ts:295` 的逐例断言**只在该例全绿时才产出**，所以「20」是 11 例红着时的残数 —— 全绿态的真值是 31，于是改 `arsenal-profiles/arsenal.json` 的声明值（20 → 31）并同步 README 的项数口径（2279 → 2290，另 3 处 archify 20 → 31）。
⇒ 与 r2 相反的两种错法都要防：**别把残数当真值**，也别把真值改成残数。

**验证**（只跑相关层）
| 命令 | 结果 |
|---|---|
| `npm run verify:archify` | 实测 31 / 跳过 0 / 失败 0 · exit 0（r1 是 18 通过 + 2 失败）；后端实跑 3 例 00/07/13 全部 9/9、0 错 0 警 |
| `npm run verify:project` | 实测 1547 / 跳过 0 / 失败 0（README 口径第一版红 1 条，补齐 6 处数字后复绿） |
| `npm run verify:graph` | 75 / 0 / 0 |
| `npm run verify:arch` / `verify:cases` / `verify:topology` | 35 / 48 / 21，全 0 红 |
| `npm run verify:meta` | 73 / 跳过 0 / 失败 0 · 13 层声明与实测**全行对得上**（含 archify 31） |
| `npm run verify:checkup` | 90 通过 + 9 环境未执行（与 r2 一致，未受本轮影响） |
| `npm run typecheck` / `typecheck:verify` | 均 exit 0 |

**与基线差值**：链的**失败面** r1 是 archify 2 + scan 3 + visual 1 = 6；r2 消掉 meta 的连带红；本轮再消掉 archify 2 ⇒ **剩 scan 3 + visual 1 = 4**。
跳过面不变（parity 3 + checkup 9 = 12 项环境未执行 + visual 1）。全量 `npm run verify` 待确认轮重跑（约 228s）。

**提交面**：代码 2 文件 + 档案 1 文件（+17 −2 行）。README 的 6 处数字**留在工作区未提交**（该文件捆着用户在途改动，见 B-1 / B-6）。

## r4 · 2026-10-27 16:16Z — P0-3：scan 层 3 条红的根因判定（判定轮，代码零改动）

**结论先说**：不是 maven，不是断言造假，是**本机 `.m2` 缺 4 个 Spring Boot 4.1.1 家族构件** → 已登记 BLOCKERS **B-7**，代码一行没动。

1. 复跑本层：`npm run verify:scan` → 实测 167 通过 / 3 失败 / 0 跳过（与 r1 基线同数，本轮没有引入回归）。
   三条红的细节彼此是级联：`13-1 status=not-executed port=null` ⇒ `13-2 stoppedBy=exited`（自己退的，不是我们杀的）⇒ `13-7 端口 null vs null`。
2. 手跑那条探针，拿到第一手证据（不是读断言转述）：
   `bash arsenal-server/scripts/runtime-probe.sh …fixtures/runtime-demo demo.DemoApplication spring-boot 60000`
   → 进程真起、Spring 自动配置阶段抛
   `IllegalStateException: EndpointCondition must be used on @Bean methods when the endpoint is not specified`
   ← `Error processing condition on …servlet.autoconfigure.actuate.web.mappings.ServletMappingsAutoConfiguration`，采集器如实回 `not-executed`。
3. **B-4 的前提被推翻**：这条链路**根本不碰 maven** —— `runtime-probe.sh` 是 `target/classes` + `.m2` 直起 `java`（脚本头部注释就写着「无需 Maven」）。
4. 定位到类路径装配：`_rtcp.sh` 钉 `B=4.1.1`，逐个 `_rt_add`，而 `_rt_add()` 是 `if [ -f … ]; then 加进去; fi` —— **缺件静默跳过**。
   实测本机 `.m2`：`spring-boot-actuator` / `spring-boot-actuator-autoconfigure` 只有 3.2.0 / 3.2.12 / 3.3.6；`spring-boot-health` / `spring-boot-micrometer-observation` **目录都不存在**。
   ⇒ `spring-boot-servlet` 的 actuator 集成类在场、它要的 actuator 构件缺席，condition 处理当场炸。
5. 为什么不修：补齐要联网拉 4 个构件（供应链动作，循环红线外）；混 3.x 进 4.1.1 类路径是把不匹配藏起来；放宽 13-1 更不许。
   顺带登记可独立做的小修 **P1-5**：让 `_rt_add` 把缺件如实进 `missingDeps`，失败信息就不会被 Spring 的异常带偏。

**产出**：BLOCKERS B-7（含手跑命令与逐构件核对表）、B-4 前提修正、BACKLOG P0-3 判毕 / P1-5 新增 / P0-5b 表述修正、RUNLOG 本条。

## r5 · 2026-10-27 16:22Z — P1-4：archify 逐例断言无条件产出（项数不随红绿抖动）

**做了什么**：`archify-check.ts` 的【2】循环里，`check()` 原先只走 `else if (!sweep)` 这一支 —— 例子全绿才产出，
红例只进 `caseErrors` 汇总。结果是「坏了」在账面上表现为「少一条断言」。改成两支都产出（红的那条带原始诊断文本），
校验器拿不到 JSON 的 `continue` 分支同样补一条红。穷举模式（`ARCHIFY_SWEEP=1`）保持只报例外，不受影响。

**证据（两种状态都真跑）**
| 状态 | 结果 |
|---|---|
| 正常（labelDy=24） | 实测 31 / 通过 31 / 失败 0 · exit 0 · `declaredMismatch: null` |
| 注入回归（临时把 labelDy 改 0） | 实测 31 / 通过 18 / **失败 13** · exit 1 · `declaredMismatch: null` · 逐例点名 `✗ 预设·cloud · 九项全过` |
| 复原后复核 | `git status` 对 arch-canvas.ts 无输出；archify 31 全绿、meta 73 全绿、两个 typecheck exit 0 |

对比 r1 基线：同样这种回归当时报的是「实测 20 / 声明 20 / 1 条汇总红」—— 项数被红吃掉，元核对查不出「少了 11 条」。
**改动面**：1 文件 / +11 −4 行。注入用的临时改动不属于交付面，已复原。

## r6 · 2026-10-27 16:30Z — P0-5：`verify:with-backend`（起—跑—关一键）

**做了什么**：把 r2 实测到的「后端本机 3.6s 起、不需要 maven」变成一条命令，顺手把收尾做严：
按 **端口持有者 PID** 关停，而不是信任 spawn 回来的那个 bash 句柄 —— 本仓实测过 TaskStop 只杀包装、
java 留在 3011 上（r2 踩过）。所以脚本里 `finally` 一定执行关停，端口没归还就退出 1。

**真跑结果**（一次完整跑批）
| 层 | 改前（后端不在） | 改后（脚本内） |
|---|---|---|
| `verify:parity` | 13 通过 / **3 跳过** | **16 通过 / 0 跳过** · exit 0 |
| `verify:checkup` | 90 通过 / **9 跳过** | **99 通过 / 0 跳过** · exit 0 |
| 收尾 | — | `· 关后端：PID 17828` → `· 3011 已归还` · 脚本退出码 0 |

**回归面**：`verify:project 1547/0/0`、`verify:charter 197/0/0`（README 新增段落后复跑）、`typecheck:verify` 通过、`node --check` 通过。
档案 `verifyChain` 声明值不动：parity 16、checkup 99 本来就是这两层的全绿真值（r2 已核过 99）。

**已知边界**：`--keep` 与「3011 上已有别人的服务」两条分支只做了代码审查，没实测；脚本只跑那两层，
不替代全量 `npm run verify`（scan 3 条红是 B-7 的构件缺口，起后端治不了它）。

**链的账（r6 后）**：常态（不起后端）失败面仍是 scan 3 + visual 1 = 4，未执行 12 项后端类；
按需跑 `verify:with-backend` 就能把那 12 项变成真跑，且这次真跑已验证为全绿。

## r7 · 2026-10-27 16:31Z — P1-2：复核「前端 AST 层 0/20」（判定轮，代码零改动）

**任务**：`docs/功能缺口清单-2026-09-22.md` §1.1（35 天未更新）说前端只跑正则层、AST 层 0/20，自称「刻意设计不是 bug」。
BACKLOG 要求先判真缺口还是设计意图，**不许为凑绿灯改档案**。

**判定：前提已过期 —— 既不是缺口，也不只是「设计意图」四个字，而是「设计意图 + 缺口已被后来的实现闭环」。**

| # | 复核点 | 2026-10-27 实测 |
|---|---|---|
| ① | 语料规模 | 69 条规则 / 正则 35 / AST 20 / `AstEngine.java:199-215` 注册 **15** 个检查器（另 5 条需类型解析，如实进 skipped）→ 与文档一致，未变 |
| ② | 前端本地是否只跑正则 | 是。`engine.ts:163-183` 显式「不在这里伪造判定」，ast/llm/manual 全进 skipped 披露 → **刻意设计**（静态站首屏零网络） |
| ③ | 文档 §3.3「前端从不调 `POST /api/lint`」 | **已不成立**：`arsenal-api.ts:617 lintRemote()` + `CheckConsole.tsx:10/:76/:287-288` 三态接线（含「代码已改动」过期标记、RemotePanel）→ 20 条 AST 结论**用户可达** |
| ④ | 文档 §6.2「AST 层零自动化覆盖」 | **已不成立**：`arsenal-server/scripts/ast-probe.sh` 存在、接进 `verify:parity`【6】；本轮实跑 2 项全绿 |
| ⑤ | 档案 `arsenal.json:377` L2 AST | `status` 已是 `done`（文档 A3 那条渲染在 `/arch` 上的 todo 已修） |
| ⑥ | 前端 `JavaParser` 字样 | `arsenal-web/src` 全域 0 命中（文档 A5–A8 已修） |

**处理**：P1-2 关闭（不降级为 P3 —— 文档是历史证据不是待办）。顺带把 P1-3 的前提更新为准确说法：
LLM 客户端**已存在**（`qa/LlmClient.java`，OpenAI 兼容 + `ARSENAL_LLM_KEY`，`:26` 明写同步链路不注入），
缺的只是「lint 的 43 条 llm 规则没复用它」，而非「要先从零搭 LLM」。

**新发现（登记 B-8，不改代码）**：20 条 AST 规则的**数据**仍自称 `engine: "javaparser"`
（`arsenal-rules` 9 文件 20 处 → `generated/rules.json` 20 处 → 详情页 `rules/[id]/page.tsx:207`（兜底默认值同词）→ `ExporterService.java:270` 写进导出产物 → `Rule.java:80/:85-87` 同错），
而真引擎是 `jdk.compiler`（`AstEngine.java:37` 自述零依赖）。属规则语料内容 + 被 parity 逐字节守着的导出面 → 需本人拍板口径。

**门禁**：判定轮无代码改动。`verify:parity` 实跑 = 13 通过 / 0 失败 / 3 未执行（后端类，与基线同数）· exit 2；
AST【6】与 MCP【7】两组守门全绿。失败面未新增（链仍是 scan 3 + visual 1 = 4）。

**改动文件**：`BACKLOG.md`、`BLOCKERS.md`、`RUNLOG.md`、`state/RUN_STATE.json`（纯流水与结论，产品代码 0 处）。

## r8 · 2026-10-27 16:41Z — 确认轮：全量 verify（r2–r7 累计账目核对）

**本意**：r2–r7 每轮只跑相关层，唤醒间隔 120s 装不下全量链 —— 这一轮专门重跑全量核对累计账目。代码零改动。

**第一次全量（231s → 179s 那次先跑）**：合计 `2290 / 通过 2262 / 跳过 25 / 失败 3`。
反常：visual 层从基线的「1 失败」变成「0 通过 / 13 未执行」。查出是**我自己 r3 改了 `src/lib/arch-canvas.ts`**
把静态产物判旧了 —— 该层前置护栏 `out/index.html` 构建于 10-25 23:57 < 源码 10-28 00:20，于是整层如实跳过
（`countSource` 随之退成 `declared`，项数取自档案、不算证据）。这不是修好了，是测不了。

**处置**：`node scripts/next-run.mjs build` 重建 `out/`（该目录被 `.gitignore:4` 忽略、0 个文件进版本库，
所以不是 B-2 那种「一次改 100+ 张受版本控制的 PNG」，纯本地产物）。**不**动 `visual/shoot.mjs`。

**第二次全量（out/ 已新）**：`verify: 实测 2290 项（通过 2273 / 跳过 13 / 失败 4）→ 退出码 1`，耗时 231.4s。

| 层 | 基线 r1 | r8 实测 | 说明 |
|---|---|---|---|
| Archify 链路 | 20 项 / **2 失败** | **31 项 / 0 失败** | r3 修标签重叠 + r5 让逐例断言无条件产出；档案声明已同步为 31 |
| 体检报告 | 90 实测 / **记账对不上判负** | 90 通过 / **9 未执行** / 0 失败 | r2 把 9 条改判 `skipItems`（真值仍是 99，见 `verify:with-backend`） |
| 前后端一致性 | 13 / 3 | 13 / 3 | AstProbe【6】+ MCP【7】两组守门全绿；3 项属后端类未执行 |
| 视觉断言 | 1 失败 + 1 未适用 | 11 通过 / 1 失败 / 1 未执行 | 仍是 B-2 那条「断言 111 张 vs 截图台 108 张」，未擅自重跑截图台 |
| 代码扫描 | **3 失败** | **3 失败** | B-7：本机 `.m2` 缺 4 个 Boot 4.1.1 构件，非断言造假 |
| 元核对（闸门） | **1 失败**（连带 checkup） | **73 / 0 / 0 · exit 0** | 十三层声明值 == 实测值全部对上 |

**累计账**：失败 6 → **4**（少 2 条 = r3 的 archify 真修）；新增失败 **0**；实测项数 2270 → 2290（+20 = archify 逐例断言）；
跳过 4 → 13（这 12 项是「后端起了就能跑」，r6 的 `verify:with-backend` 已实测能跑成 16/99 全绿）。
剩下 4 条红全部有主：scan 3 → B-7（要人批准拉构件）、visual 1 → B-2（要人批准重跑截图台）。

**运维教训（已写进 state.commands）**：改前端 `src/**` 之后 visual 层会自己判旧并整层跳过 ——
下一轮只要碰前端源码，就得先 `node scripts/next-run.mjs build` 再跑链，否则「13 项未执行」会被当成没事。

## r9 · 2026-10-27 17:00Z — P1-5：让 13-1 的失败信息自己说清「缺哪几个构件」

**计划**（r8 写的 next_round_plan）：`_rtcp.sh` 的 `_rt_add()` 对缺件静默跳过，让缺件进 `missingDeps` 通道。

**做完判定才发现计划本身错位** —— 按计划读了 `RuntimeClasspath` 才看清：fixture 的类路径**不是** `_rtcp.sh` 拼的那份，
而是探针里 `resolve()` 现解析的 42 个 jar。真凶是 `findJar()` 的降版分支：它退到本地最高版本，
而注释写着「会被记进 note —— 用户能看见『这个版本是猜的』」—— **那条分支一个字都没记**。注释与代码不符，
且不符的方向恰好是让失败信息读起来像「缺构件」。r4 把它记成「.m2 缺 4 个构件」（B-7）就是被这条假披露带偏的。

**改动（4 文件 / +46 −9，只改披露不改判定）**
| 文件 | 改了什么 |
|---|---|
| `autopsy/RuntimeClasspath.java` | `findJar()` 收集降版坐标 → 同时进 `missing()`（带 `4.1.1 未装，退到 3.3.6` 这样的后缀）与 `note`；选包逻辑一行没动 |
| `autopsy/RuntimeProbe.java` | 进程起不来时 `reason` 先点名混版构件，再贴 Spring 异常原文 |
| `scripts/runtime-probe.sh` | 补 `-Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8`（与 archify/projects/scan 三个探针脚本同款）—— JDK 18+ 里 `-Dfile.encoding` 已不管 `System.out`，本机探针一直吐的是 **GBK 字节的 JSON**，前端按 utf8 解 → 中文全乱码 |
| `.verify/scan-check.ts` | 13-1 失败详情追加「缺/降版构件 7 个：<清单>」+「探针原因：<400 字>」 |

**实跑对照**（同一命令 `runtime-probe.sh …/runtime-demo demo.DemoApplication spring-boot 60000`）
- 改前：`missingDeps` 2 条、`reason` 只有 Spring 的 `EndpointCondition must be used on @Bean methods…`。
- 改后：`missingDeps` **7 条** = 2 真缺（`spring-boot-health`、`spring-boot-micrometer-observation`）
  + 5 降版（`actuator` / `actuator-autoconfigure` → 3.3.6、`spring-jcl` / `spring-tx` → 6.1.6、`micrometer-core` → 1.13.8），
  `reason` 开头即「类路径里有降版构件 […]，混版起跑」；崩溃主因确认是那对 **3.3.6 的 actuator-autoconfigure**（栈帧点名），不是「没装」。
- 编码那条是本轮的意外收获：r2 起就存在，之前没人拿中文文本去解探针的 stdout。

**门禁**：`bash scripts/compile-check.sh` → 100 源文件 / 208 class OK；
`verify:parity` 13 通过 / 0 失败（含 compile-check + AstProbe + MCP 守门）；
`verify:scan` **167 通过 / 3 失败 / 项数仍 170**（13-1/13-2/13-7 三条红原样保留 —— 没有为了让链好看而放宽）；
`typecheck` + `typecheck:verify` exit 0。

**账**：链失败面仍是 4（scan 3 + visual 1），与 r8 全量一致，未新增；新增的是「这 3 条红现在一眼读得出根因」。

**遗留半条**：`_rtcp.sh` 的 `_rt_add()` 仍静默跳过缺件 —— 实测它只影响跑探针那台 JVM 自己的类路径，不参与 fixture 解析，降到 P3（r10 候选）。
**BLOCKERS**：B-7 追加「更正」段 —— r4 那半条诊断作废，需人批准的构件清单从 4 个变 7 个（且前 2 个到位大概率直接转绿）。

## r10 · 2026-10-27 17:04Z — P3-4（P1-5 遗留半条）：`_rt_add()` 不再静默跳过缺件

**改动**：`arsenal-server/scripts/_rtcp.sh` 1 文件 / +14 −1。缺件攒进 `RT_MISSING`，脚本末尾一次性说到 **stderr**
（stdout 要留给探针那份单行 JSON —— `scan-check.ts:2039` 只挑以 `{` 开头的行，混进 stdout 会把断言解挂）。

**为什么这条值得做（r9 的教训回 Applied）**：原注释写「缺了……不在这里静默跳过」，但它描述的是 fixture 那一路；
这台跑探针的 JVM 自己的类路径**恰恰就在静默跳过**。又是一处「注释宣称已披露、代码没披露」。

**实跑验证**：
- stderr 现说出：`[rtcp] 本机 .m2 缺 5 个运行期构件（类路径按现有 jar 拼）：spring-boot-{actuator, actuator-autoconfigure, health, micrometer-observation}:4.1.1 + micrometer-core:1.17.1`
  —— 与 r9 的降版证据完全对上（就是这 5 个害得 fixture 退到 3.3.6 / 6.1.6 / 1.13.8）。
- stdout 仍是可解析单行 JSON、`missingDeps` 7 条 —— 拼装结果与判定一字未动。

**门禁**：`verify:scan` 167 通过 / 3 失败 / 项数 170（与 r9 同，未新增）；`verify:parity` 13 通过 / 0 失败 / 3 跳（与 r8 同）。

**链的账（r10 后）**：失败面 4（scan 3 + visual 1）不变；B-7 的人工清单证据现在有两处独立来源（探针 JSON + 脚本 stderr）。

## r11 · 2026-10-27 17:06Z — P3-2：现状复核文档（1 新建文件，代码零改动）

**产出**：`docs/现状复核-2026-10-27.md`（约 100 行）。**不改写** `docs/功能缺口清单-2026-09-22.md`——
那份报告的取证纪律是它最值钱的部分（每条挂复现命令、负向结论也敢实跑），改掉等于抹掉可复现证据链。
新文档只做三件事：① 列出已被实测推翻的 5 条（前端不调 `/api/lint`、AST 零覆盖、项数是手写常量、
「全项目无 LLM 调用代码」、JavaParser 名实不一的剩余位置）；② 复核后**仍然成立**的 7 个数字
（69 / 35 / 20 / 15 / 5 / 43 / 22，重新按同一办法数过）；③ 0922 之后新发现的 4 条（降版混用、
`_rt_add` 静默跳过、探针 GBK 输出、后端不需要 maven）。每条旁边都写了一行复现命令。

**顺手核到的两件事**
- `docs/arsenal-runtime.architecture.json` 里「MCP 尚未实现」那两处**已经被改成「已接入」**，
  但该文件带用户在途改动（`git status` 有 `M`）→ 本轮不碰、不提交（同 B-6 判据）。
- 链对 `docs/` 没有项数口径断言（`project-check.ts` 里的 `docs/risk-report.md` 是脚手架 preset 的产物路径，不是本仓 docs/）
  → 新增文档文件不会搅动 1547 项。实测确认：**`verify:project 1547/0/0`、`verify:charter 197/0/0`**，与基线同数。

**账**：链失败面仍是 4（scan 3 + visual 1），本轮 0 代码改动、0 新增失败。
