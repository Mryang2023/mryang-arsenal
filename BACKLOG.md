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

- **P0-1 [证据] ~~体检报告层「声明 99 / 实测 90」~~ → r2 已修（改归类，未改档案）。**
  判定结论：**档案 99 是真值，9 条端到端断言一条都没丢**（`checkup-check.ts:627-644`）。
  起后端实跑 `verify:checkup` = 99/99 全绿 exit 0；后端不在时该组按 `report.ts` 的语义应进 `skip` 计数（与同层【11】的 7 条同类），
  原先误用 `knowinglySkipped()`（那个不进项数比对，专指「配好环境也不会跑」）→ 账恒差 9。
  修法：`knowinglySkipped` → `skipItems(…, 9)`；`verify:meta` 恢复全绿（73 项 / 0 失败）。详见 RUNLOG r2。
  遗留：常态（后端未起）本层 9 项未执行 → 链需 `--allow-skip`，属 P0-5 环境项，不是代码缺陷。

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
- **P0-5b [证据，r2 新证] 后端「真跑」本机可用，不需要 maven。**
  `SKIP_COMPILE=1 bash arsenal-server/scripts/run.sh` 实测 **3.6s 起、3011 正常服务**（吃现成 `target/classes` + `.m2` 里的 Spring Boot 4.1.1；JDK 由 `_cp.sh` 定位，本机 corretto-21.0.4）。
  ⇒ P0-5 与 parity 的 3 项跳过、checkup 的 9 项未执行只差这条「起—跑—关」脚本；B-4 的 maven 缺口只卡 scan 层的 fixture 真跑。
  ⚠️ 用完必须真关：后台任务只杀 bash 包装，java 子进程要按 3011 监听 PID `Stop-Process` 掉，否则端口留成常态。

（无已知安全漏洞。`ScanGuard` 的路径逃逸 / 超大文件 / file:///ssh:///git:// 拒绝等安全断言在 r1 基线全部为绿。）

> **r2 后的账**：checkup 层不再判负（99 == 99，常态下 90 通过 + 9 环境未执行），meta 层 73 项全绿。
> 链的**失败面**只剩 archify 2 / scan 3 / visual 1 三条独立根因（= P0-2 / P0-3 / P0-4）；**跳过面**变大（4 → 13），是同一批环境缺口的诚实记账，不是新增红灯。
> 全量 `npm run verify` 需重跑确认（228s > 120s 唤醒间隔，留给专门的确认轮）。

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
- **P3-3 [证据，r2] README 的类型闸门只写了 `npm run typecheck` 一种。** 实测根 tsconfig 的 `**/*.ts` 不匹配点目录（`tsc --listFiles` 里 `.verify/` 0 个文件），
  改断言层必须另有 `npm run typecheck:verify`；`scripts/verify-all.mjs:206` 两个都跑，所以**链没漏，是文档口径不全**（README:353）。单轮小改。
