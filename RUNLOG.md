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
