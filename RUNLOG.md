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
