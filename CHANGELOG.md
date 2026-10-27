# CHANGELOG · 自动迭代改动

## r2 · 2026-10-27
- `arsenal-web/.verify/checkup-check.ts`：【9】端到端那组（9 条断言）的记账从 `knowinglySkipped()` 改为 `skipItems(…, 9)`。
  - 判定过程（先查「90 是真值还是 9 条断言被删」）：9 条 `check()` 仍在 [checkup-check.ts:627-644](file:///D:/workspace/2026/mryang-arsenal/arsenal-web/.verify/checkup-check.ts#L627-L644)，**没有断言被静默删除**；
    起后端（`SKIP_COMPILE=1 bash arsenal-server/scripts/run.sh`，3.6s 起来）再跑本层 → **实测 99 / 跳过 0 / 失败 0，exit 0**，端到端 9 条全真跑全绿
    → 档案声明的 99 是真值，不该改成 90（改了会在后端在的时候反向对不上）。
  - 红的是**归类**：`report.ts` 定义 `knowinglySkipped` 只装「配好环境也不会跑」（造用例代价过大）且**不进项数比对**；
    「后端未启动」是环境缺口，本层【11】那 7 条同类情况早就写明要走 `skipItems`（「记账不平比跳过更脏」）。归到 `skipItems` 后
    `total = 90 + 9 = 99 = 声明`，`verify:meta` 的 checkup 行恢复「对得上」、meta 层 73 项全绿 exit 0。
  - 没有为了让绿灯而放宽任何断言：后端不在时这 9 条依然显式记为「未执行」，退出码 2，不加 `--allow-skip` 依旧不放行。
  - 后端用完已关掉，3011 端口归还（环境与本轮开始时一致）。
- 代码改动 1 个文件 / +11 −3 行。资料文件（CHANGELOG / RUNLOG / BACKLOG / BLOCKERS / state）另计。

## r1 · 2026-10-27
- 新增 `state/RUN_STATE.json`：循环状态机（分支、截止时间、探测到的构建/测试命令、安全策略、计数器）。
- 新增 `BACKLOG.md`：基于实测（非猜测）建立的任务池，逐条标注 `[证据]` / `[待复核]`。
- 新增 `RUNLOG.md`、`CHANGELOG.md`、`BLOCKERS.md`。
- 抓取全量验证基线：`npm run verify` = 2270 项 / 通过 2260 / 跳过 4 / **失败 6** → 退出码 1。
  四个独立真根因（archify 标签重叠、scan fixture 真跑未执行、checkup 档案项数漂移、visual 截图台陈旧）已逐一定位并排入 BACKLOG P0-1…P0-5。
- 代码零改动：本轮只做初始化与基线验证。

## r3 · 2026-10-27
- `arsenal-web/src/lib/arch-canvas.ts`：`CanvasEdge` 新增可选 `labelDy`；`rerouteEntryThroughGateway()` 给入口链的非首段直连边（`ingress→gateway` / `gateway→app`）显式带 `labelDy = 24`。
- `arsenal-web/src/lib/archify-ir.ts`：适配器在「既不走车道也不走导轨」的直连分支把 `edge.labelDy` 透传成 `conn.labelDy`；几何值仍由画布模型给，**适配器不自己猜**。
  - 治的根因：绘图器对 IR 的硬约束 —— 直连边的默认标签位置骑在源节点框内，`layout/constraint` 当场判负
    （`Label "路由转发" overlaps component "ingress"`，校验器建议 `labelDy +24`）。14 例全绿，后端实跑 `07.json` 从「没出图」变成 732512 字节 / 检查 9/9。
- `arsenal-profiles/arsenal.json`：`Archify 链路` 声明项数 20 → **31**。
  - 这不是「改档案掩盖」：该层的逐例九项断言只在**该例全绿时**才产出（`archify-check.ts:295`），所以 20 是「有 11 例红着」时的残数；
    修好后 14 条逐例断言 + 汇总全部执行，实测 31 与档案对不上 —— 由本层自己的「记账对不上」红抓出来，改的是档案侧的真值。
- `README.md`：项数口径 2279 → 2290（3 处）+ archify 的 3 处 20 → 31。**未提交** —— 该文件同时带着用户在途改动（`docs/archive/` 目录树那一处），
  按 B-1 的规矩不做整文件 `--only` 提交，改动留在工作区等用户带走（`verify:project` 读的是工作区，链已复绿）。
