# 夜跑第 1 棒（2026-09-22 夜）执行摘要

- **棒次**：1 / 5 · **任务**：plan-1 的 A-2（skip 语义独立化）+ A-1（typecheck 进闸门）
- **起止**：2026-09-22 23:10 → 23:47（实际 37 分钟，预算 118 分钟，提前约 73 分钟）
- **状态**：完成（含备选池第 1 件 A-5 完整版）
- **交棒**：第 2 棒（ddb6a1f4）已改为 2026-09-22T23:50 执行

## 结果一句话

`npm run verify` 从「`&&` 链 + 跳过错算通过」改为「串行 runner + 跳过是独立状态」。
实测 **628 项实测 / 34 项跳过 / 0 失败 → 退出码 2**，即改前宣称的「八层全绿」里有
34 项根本没跑（archify 31 项缺绘图器 + parity 活服务 3 项）。

## 落地的文件

- 新建 `arsenal-web/.verify/lib/report.ts`（唯一记账处，退出码 0/2/1）
- 新建 `arsenal-web/scripts/verify-all.mjs`（串行 runner，不短路 + 逐层计时 + --allow-skip）
- 新建 `arsenal-web/.verify/tsconfig.json`（.verify 首次进类型闸门）
- 改 8 个 check 脚本 + `package.json` + `README.md` 自检段
- 提交：`333edd8`（主）+ `526804c`（A-5 增量）

## 给下一棒的三个关键提醒

1. 本棒没碰 `src/`、`arsenal-server/`、`arsenal-rules/`、`tools/` —— 零冲突。
2. `npm run verify` 退出码会是 2（环境跳过），**不是**你弄坏了；看「失败」列与「问题清单」。
3. 工作区有一批**别人的**未提交改动（topology.ts / memory / night-run 技能 / docs），
   本棒刻意没夹带；终检棒需要决定是否统一提交。
