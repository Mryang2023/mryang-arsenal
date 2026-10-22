# 棒 1 · 生命体征 CLI 先行（跃迁 B 最小第一步）

**日期**：2026-10-13
**代号**：vitals-series
**体量**：L（开发净 145 min）
**一句话**：让解剖台「多看几次」—— 每次分析落一个序列点，下次自动和上次对比，并画出第一条健康度曲线。

---

## 0. 你在做什么（先读这段）

解剖台现在的能力是**一次性的**：扫一次 → 出报告 → 存快照。快照有了、`diffSnapshots` 有了、指纹 L1 复用也有了，但**没人定时再扫一次，也没人把多次连成线**。

本棒补的就是「时间维度」的最小闭环：

```
node scripts/autopsy-watch.mjs once --path <dir|git>
        │  扫一次 → 落一个序列点 → 和上一个点对比 → 打印四段变化
        ▼
.data/autopsy/<projectId>/series.jsonl     （时间序列，追加写）
        │
        ▼
vitals-series.ts（纯函数）→ 曲线 SVG   →  /autopsy 第五页签「生命体征」
```

**这不是「把旧计划的 L2 增量做完」。** L2 按文件增量（CodeScanner 聚合重构）本棒**明确不做**，理由见 §4。

---

## 1. 已有资产（动手前先确认它们还在，缺一个就降级并如实记录）

| 资产 | 位置 | 现状 |
|---|---|---|
| 快照读写（三档目录） | `arsenal-web/scripts/lib/autopsy-store.mjs`（`resolveAutopsyDir` / `saveSnapshot` / `listSnapshots` / `loadLatest`） | 已存在 |
| 真内容级指纹 | `arsenal-web/scripts/lib/autopsy-fingerprint.mjs`（`fingerprintDirTree` / `fingerprintGitState` / `fingerprintCaveat`） | 已存在 |
| 快照对照 | `arsenal-web/src/lib/autopsy-snapshot.ts:235` `diffSnapshots(prev, next)` | 已存在，产出 `SnapshotDiff`（含 `sameFingerprint`） |
| 指纹可信度 | `autopsy-snapshot.ts:104` `fingerprintTrust(report)` | 已存在（truncated / 扫到 0 文件时不可信） |
| 快照形状校验 | `arsenal-web/scripts/lib/autopsy-snapshot-shape.mjs` | 已存在 |
| 分层验证 | `arsenal-web/.verify/scan-check.ts`（1304 行，`verify:scan` 112 项） | 已存在，本棒在**这里**加组，不新建层 |

**引用核实（开工第一件事）**：逐个 `ls` / `grep` 确认上表文件存在。方案里的行号是 2026-10-13 的实测值，**以你开工时 grep 到的为准**。

---

## 2. 分阶段实施

### 阶段 A · 序列存储（约 30 min）

新增 `arsenal-web/scripts/lib/vitals-store.mjs`（Node 侧，与 autopsy-store 同目录同风格）：

- 序列文件：`<autopsyDir>/<projectId>/series.jsonl`，**JSONL 一行一点**（可 `tail`、可手工修、不与既有 `*.json` 快照互踩）。
- 序列点 schema（`schemaVersion: 1`）：
  ```json
  { "schemaVersion": 1, "snapshotId": "2026-10-13T23:40:11", "ts": "2026-10-13T23:40:11+08:00",
    "fingerprint": "sha256:…", "fingerprintKind": "dir|git|report", "fingerprintTrust": true,
    "verdict": { "p0": 12, "p1": 31, "obs": 8 },
    "services": { "declarations": 29, "entryPoints": 13, "units": 15, "conflicts": 3 },
    "coverage": { "executed": 42, "total": 69 },
    "scan": { "files": 4821, "bytes": 1234567, "ms": 18300, "truncated": false },
    "status": "full|partial" }
  ```
- **读不到的值写 `null`，不许兜底**（仓库既有纪律）。`truncated` 为真时 `status: "partial"` 且该点**不参与曲线**（下面 §3 断言 6）。
- `appendPoint({ dir, projectId, point })` —— 追加写 + 读回校验（写完立刻 read 一次，确认落盘，防「写了但没写进去」的静默失败）。
- `listPoints({ dir, projectId })` —— 按 `ts` 升序返回；**坏行不许静默跳过**，返回 `issues[]` 让调用方显示（这是本仓 10-04 铁律的同款要求）。

### 阶段 B · CLI（约 40 min）

新增 `arsenal-web/scripts/autopsy-watch.mjs`（零依赖，只用 node 内置 + 既有的 scripts/lib）：

```
node scripts/autopsy-watch.mjs once  --path <dir> [--project <id>] [--note "…"]
node scripts/autopsy-watch.mjs list  --project <id>
node scripts/autopsy-watch.mjs diff  --project <id>            # 最后两点对比
```

- `once` 流程：解析路径 → 算指纹 → **指纹与最新点相同 → 直接复用既有快照，不重扫**（L1 复用已有，别重造）→ 落新点 → 与上一个点跑 `diffSnapshots` → 打印四段变化（体检 / 服务 / 覆盖率 / 文件数）。
- **不写守护进程、不做 `--every` 定时循环**（见 §4 降级项）。`once` 结尾打印一行「下次建议执行：<ts + 24h>」，定时交给外部调度器。
- 指纹不可信（`fingerprintTrust` 为 false）时，落点但打印醒目提示「本次指纹有盲区，见 `fingerprintCaveat`」，不许当成「没变」。
- CLI 输出必须是人能读的中文，不许只吐 JSON。

### 阶段 C · 曲线纯函数（约 35 min）

新增 `arsenal-web/src/lib/vitals-series.ts`：

- 输入序列点数组 → 输出 SVG 字符串，**零依赖手写**（与 `src/lib/arch-diagram.ts` 同款纪律，不引任何图表库）。
- 三条线：P0 数（主）、服务单元数、覆盖率（42/69 这种带分母的）。
- **确定性**：同输入两次调用**逐字节相等**（本仓硬纪律，既有层都有这条断言）。
- 单点：画一个点，不许画折线。**空序列：不画空图**，返回「还没有序列数据」文案（页面与 CLI 共用）。
- 坐标轴数字从数据算，不许出现写死的 69（覆盖率分母从序列点 `coverage.total` 读）。

### 阶段 D · 页面（约 25 min）

`/autopsy` 新增第五页签「生命体征」：曲线 + 序列点列表（每行：时间戳 / P0/P1 / 指纹前 8 位 / 与上次的变化摘要，可点开看 diff）。

**降级线**：时间不够就先不做页面，只保证 CLI + 曲线纯函数 + 落盘 SVG 文件可用，把「页面未做」如实写进 `01-done.json`。

### 阶段 E · 断言（约 15 min）

**并入 `verify:scan`，不新建层**（新建层要同步六处：package.json / verify-all LAYERS / report LAYER_NAMES / meta CHAIN_ORDER / arsenal.json verifyChain + README 两处 —— 本棒不值得）。

动手前先 `grep` `scan-check.ts` 现有组编号（文件 1304 行，组标题形如 `// 【11】…`），**接在最大编号之后**，不要撞号。新增组「生命体征」5–7 条：

1. 同输入两次 `appendPoint` → 序列点**除 ts/snapshotId 外逐字段相等**；
2. `vitals-series` 同输入两次 → SVG **逐字节相等**；
3. 空序列 → 返回「无数据」文案，**不许产出一张看起来健康的空图**；
4. 单点 → 只画点不画折线（读 SVG 里 `<line>`/`<polyline>` 数量判定）；
5. 构造两点（P0 从 12 变 10）→ `diffSnapshots` 四段变化里「体检」段真的显示 -2 且带依据；
6. `status: "partial"` 的点不进曲线（曲线点数 == 序列点数 − partial 数）；
7. 坏行注入 → `listPoints` 返回 issues 且**不许静默跳过**（本条是静默失败守卫）。

---

## 3. 验收标准

1. 对本仓（`D:\mryang\workspace\2026\arsenal`）跑两次 `once` → 两个序列点，第二次指纹相同**走了复用**（不重扫、耗时明显短），打印「无变化」。
2. 改一个文件（例如给某个 .ts 加一行注释）再跑第三次 → 指纹变了，四段变化里有**真变化**（不是「无变化」）。
3. `node scripts/autopsy-watch.mjs list --project <id>` 输出可读。
4. 曲线 SVG 逐字节可复现；空序列不画假图。
5. `npm run verify:scan` 全绿（项数增加，见 §5 数字同步）。
6. **反着验 ≥2 处**：① 往 `series.jsonl` 塞一行坏 JSON → `listPoints` 报 issues（确认真会报）→ 还原；② 把序列里某点的 `p0` 改大 → 曲线形状真的变（确认曲线读的是数据不是写死的）→ 还原。
7. 页面（若做了）打开逐句读一遍「N 条 / N 个点」措辞 —— 本仓 10-04 教训：视觉层验「说得对不对」不能省。

---

## 4. MVP 与可裁剪（**今晚明确不做**，不是遗漏）

| 砍掉 | 为什么 |
|---|---|
| **L2 按文件增量重扫** | 需要重构 `CodeScanner` 的 `TreeMap` 扁平聚合，是 XL 级改造，本棒装不下。改为：每次全量重扫，但把 `scan.files / ms / truncated` 记进序列点 —— **先把「重扫一次要多久、扫多少文件」的数据攒出来**，L2 做不做、值不值，下一晚拿真数据判断 |
| 定时守护进程（`--every`） | 自己造调度器会撞本环境「java/长驻进程静默死」的老问题。改为外部调度器调 `once`，更稳也更好验 |
| 断崖归因（定位到某次提交） | 要读 git 历史并与序列点对齐，独立成棒 |
| 舰队视图（多项目一屏排行榜） | 需要先有序列数据，本棒产出的数据正是它的前置 |
| 健康度综合指数 | 计划书明写「四分量可解释、不许黑箱分数」，本棒只画三条原始曲线，不做合并指数 |

---

## 5. 收尾必做（顺序不能反）

1. **全量验证**：`cd arsenal-web && npm run verify`（13 层），记录真实总数与跳过的层。**没跑过就不能说它是绿的。**
2. **派生数字同步四处**（改完复跑确认生效）：
   - `arsenal.json` 的 verifyChain 项数（`verify:scan` 112 → 新值）
   - `README.md` 第 365 行起的**分层表**里 `verify:scan` 那一行
   - `README.md` 正文里散文总数（2175 → 新值）
   - `node arsenal-web/scripts/sync-content.mjs` 复跑后 `src/generated/profiles.json`
3. `git commit`（`feat(vitals): …`），确认没夹带 `_*`。
4. 删 `_*` 调试产物。
5. 追加 `.workbuddy/memory/2026-10-13.md`。
6. 写 `.workbuddy/night-chain/01-done.json`（schema 见 NIGHT-RUN.md §四）。

---

## 6. 本棒专属雷区

- **序列文件不许进军火库 git** —— 沿用 `profile-store.ts` 顶部注释立的规矩：别的项目的资料不该因为我们看一眼就被提交。确认 `.data/` 已在 `.gitignore`。
- **不许写死覆盖率分母 69** —— 从序列点的 `coverage.total` 读。本仓踩过（体检报告页写死 69）。
- **`diffSnapshots` 是现成的，不许自己再写一份对比逻辑** —— 本仓 10-04 硬约定 18：判定逻辑第二份实现是事故源头。
- **指纹相同 ≠ 没变** —— `fingerprintTrust` / `fingerprintCaveat` 已经把盲区写死了，复用它，别自己判断「是不是没变」。
- **棒 2 会接着改 `/autopsy` 的 `AutopsyLab.tsx`** —— 你加的是第五页签，别抢第六页签的位置；把「页签已加到第几」写进 `01-done.json` 的「给下一棒的话」。
