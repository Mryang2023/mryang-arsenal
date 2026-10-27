# BACKLOG · 自动迭代任务池

> 每轮从最高优先级里挑**一个**能在单轮时间盒（约 15–25 分钟）内完成的小任务。
> 标注 `[证据]` = 本轮循环亲自核实过；`[待复核]` = 来自历史文档，动手前必须先验证仍然成立。

## 基线事实（r1 建立，2026-10-27）

| 项 | 状态 |
|---|---|
| `arsenal-web` typecheck | 绿（10.3s） |
| `arsenal-web` verify 链 | 13 层串行 runner，需 `--allow-skip` 才能在本机全绿 |
| `arsenal-server` 单元测试 | **0 个**，`src/test` 目录不存在 `[证据]` |
| `spring-boot-starter-test` | 已声明为 test 依赖，但无一个测试用到它 `[证据]` |
| CI 配置 | 仓库根**无** `.github/`（但存在 `scripts/calc-ci-history.mjs`） `[证据]` |
| 服务 | 后端 3011 / 前端 3010 均未运行 → parity/archify/scan/visual 层必然跳过 `[证据]` |

---

## P0 · 安全 / 数据丢失 / 构建失败

**基线总账（r1 实测，2026-10-27 15:41Z，耗时 227.7s）：`npm run verify` = 2270 项 / 通过 2260 / 跳过 4 / 失败 6 → 退出码 1。链是红的。** 四个独立根因：

- **P0-1 [证据] 体检报告层「声明 99 / 实测 90」→ 连带 `verify:meta` 元核对判负。**
  `arsenal-profiles/arsenal.json` 的 `project.verifyChain` 给 checkup 层声明 99 项，实跑只有 90 项。
  这一条是**整条链唯一的「非环境」机械性红灯**，单文件、影响面最小。
  动手前必须先判定：是 90 为真值（档案数字陈旧 → 改档案），还是**有 9 条断言被静默删掉**（→ 那是真 bug，不许改档案掩盖）。
  验证：`npm run verify:checkup` + `npm run verify:meta`。**→ r2 选定**

- **P0-2 [证据] Archify 链路 2 项失败 —— 边标签与组件重叠。**
  布局校验器报 `layout/constraint` error：`Label "路由转发" overlaps component "ingress"`，多个预设（cloud / enterprise / ha / data-intensive…）连带判负。
  源：`arsenal-web/src/lib/arch-canvas.ts:597`（入口改道生成 `ingress→app` 边）+ `arsenal-web/src/lib/archify-ir.ts:386-420`（`labelSegment` / `labelDy` 定位）。
  校验器给了明确建议：`labelDy +24`（移到框下方）。
  ⚠️ 已知遗留：`.workbuddy/night-chain/2026-10-17/{01,02}-done.json` 记为「白天基线既有」，一直没修。
  ⚠️ 风险：动 IR 可能撞到「字节无损」的快照断言，改前要先确认快照耦合面。**→ r3 候选**

- **P0-3 [证据] 代码扫描层 3 项失败（13-1 / 13-2 / 13-7）—— fixture spring-boot 真跑不起来。**
  症状：`status=not-executed port=null line=undefined health=undefined`；13-2 的 `stoppedBy=exited` 与 13-7 的 `端口 null vs null` 都是它的级联。
  源码注释 `.verify/scan-check.ts:1852`：13-1~13-7 需要「bash + JDK + .m2」。
  本机 `mvn` **不在 PATH**（只有 `arsenal-server/mvnw`），`.m2` 仓库存在 → 先判定是环境缺口还是代码缺陷，**不许为了让它变绿而跳过或伪造**。
  若是环境：登记 BLOCKERS，不动代码。**→ r4 候选**

- **P0-4 [证据] 视觉断言层 1 项失败 —— 截图台陈旧。**
  `visual/manifest.json` 记 108 张，本次矩阵 111 张 → 页面路由增删后没重跑截图台。
  修法机械：`node visual/shoot.mjs`。
  ⚠️ 代价：会一次改动 100+ 张 PNG，**远超单轮 8 文件上限**，且属批量产物重写 → 需单独一轮并先中人工确认（已登记 BLOCKERS）。

- **P0-5 [证据] 前后端一致性层 3 项跳过 + 视觉层 1 项未适用。** 根因是后端 3011 未运行。
  非代码缺陷，属环境。做法：加「起后端 → 跑 verify → 关后端」一键脚本（复用现成的 `target/arsenal-server-0.1.0.jar`），让一致性层真能验。不改 verify 链本身。

（无已知安全漏洞。`ScanGuard` 的路径逃逸 / 超大文件 / file:///ssh:///git:// 拒绝等安全断言在 r1 基线全部为绿。）

---

## P1 · 稳定性 / 错误处理 / 测试覆盖

- **P1-1 [证据] 后端零单元测试。** `arsenal-server` 没有任何 `src/test`。后端逻辑（`ScanGuard`、`AstEngine`、`ProjectStore`、`QaService`）全靠前端 `.verify` 黑盒打。
  风险：前端链跳过时后端等于裸奔；重构无保护网。
  做法：**小步**补最小冒烟测试 —— 第一个只测 `ScanGuard` 的 zip 路径穿越拒绝（README 明写的铁律，最容易写成纯单元测试）。一次只加 1 个测试类。
- **P1-2 [待复核] 前端 AST 层 0/20。** 出自 `docs/功能缺口清单-2026-09-22.md` §1.1，该文档自称是「刻意设计不是 bug」。
  → 先复核代码现状再决定是否算缺口；若确实是设计意图，降级为 P3 文档项。
- **P1-3 [待复核] LLM 层 43 条规则全项目 0 条被执行。** 同上文档 §0.2。属功能方向，非单轮可完成，先记录不排期。

---

## P2 · 功能拓展（须有 BACKLOG 依据）

- **P2-1 [证据] 无 CI 落地。** 有 `docs/项目章程-CI落地指南.md` 与 `scripts/calc-ci-history.mjs`，但仓库无 `.github/`。
  风险：本次循环「不 push」的红线下，CI 属外部系统配置 → 见安全红线第 1 条。**记录但不擅自创建**，需人工确认（已登记 BLOCKERS）。

---

## P3 · 结构 / 可读性 / 文档

- **P3-1 [证据] 根目录散落审计产物。** `.verify/`、`.data/`、`.workbuddy/`、`.zcode/` 混在仓库根，近期已有 commit 在做清理（`52feeb3`）。跟进但要避开用户在途的归档工作。
- **P3-2 [待复核] `docs/功能缺口清单-2026-09-22.md` 已 35 天未更新**，其中 P0-1/P0-2 标注「已修」，可整理成现状稿。
