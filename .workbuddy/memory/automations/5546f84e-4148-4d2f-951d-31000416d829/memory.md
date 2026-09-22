# 夜跑 · 第 3 棒（2026-09-22 夜）· 自动化执行记忆

> 任务：计划 5 的 V-1（截图矩阵台）+ V-2（逐张看图，多模态专用）
> 自动化 id：`5546f84e-4148-4d2f-951d-31000416d829`

## 2026-09-23 00:13 → 01:07（首次执行）

**结果：部分完成（核心硬判据全达标；V-2 未跑满 45 张）。**

- 交接凭证：`.workbuddy/night-chain/03-done.json`（28.5KB，17 个必填字段齐全）。
  开工时建了 `03-running.json`（含砍定范围），前棒 `02-done.json` 00:10 已就位，**未轮询等待**。
- 交付：`arsenal-web/visual/` 下 5 个文本产物 + 10 张 evidence PNG；45 张截图在 `visual/shots/`
  （已 gitignore）。三笔提交 `0687972` / `9f5f65f` / `213326f`，只含 `arsenal-web/visual/**` 与 `.gitignore`。
- 硬判据：45/45 张、EXIT=0、5.17MB；findings **18 条**（P0 1 / P1 5 / P2 11 + 探针 1），
  超过「≥15」；反向验证两处**都真红**（坏样式注入 → 几何 15→45 但退出码仍 0，已如实说明；
  坏 JS chunk 名 → EXIT=1 且 404 只归属 stack 三张）。
- 未做完（如实记录在 done.json）：V-2 判读 **34/45 张**（13 张文件名已逐张点名）；
  备选池 V-3 `visual/assert.mjs`、V-5 位图生图**均未启动**。
- **新增踩坑（下一棒必看）**：`npm run verify` 退出码从 2 变 **1**，但 628 实测 / 34 跳过 / 0 失败
  内容零回归 —— 根因是沙箱删除守卫在 parity 层清 `target/parity-be`（2598 文件）时抛
  `SAFE_DELETE_BULK_CONFIRM_REQUIRED` 把该层打死（层自报 2 / 进程实际 1 → runner 判「记账不可信」）。
  隔离证据：`CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run verify` → 退出码 2。已写进
  `visual/findings.md` 的 A-6 与「收尾实测撞到的一件事」，并订正 memory/2026-09-23.md。
- 收尾：调试产物（`_v3/`、`_v3b/`、`_w3/`）全删；3021 静态站已杀（PID 1620）；
  `arsenal-web/.workbuddy/icons-batch1.html` 是 09-22 白天的遗留，**非本棒产出，未动**。
- 交棒：第 4 棒 `5777414f-bdf8-4a15-8d0e-de62bbc7c624` 由 05:13 前移到 01:07（提前 4 小时）。

**给下一次执行的提示**：本棒的单棒实际耗时约 50 分钟（预算 118），主要时间花在
「写 shoot.mjs」与「复核第一轮判读、撤回 7 条误读」上；判读 45 张图确实吃时间，
若下次仍接 V-2 类任务，建议开局就把「只判读 30 张 + findings ≥15 条」写进砍定范围。
