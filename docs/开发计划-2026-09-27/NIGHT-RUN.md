# 夜跑规程 · 2026-09-27（本夜实例化）

> 本文件是**每一棒开工必读的第一份**，自包含。夜间 agent 不需要知道技能目录的存在。
> 通用章程见 `docs/hy4-night-plans/NIGHT-RUN.md`（常驻版，§五是终检职责）。
> 本夜任务方案：`docs\开发计划-2026-09-26\部署形态动画化计划-2026-09-26.md`（**已定稿，决策已拍板**）。
> 六夜分期见 `docs\升级方案-2026-09-27.md` —— **本夜 = 夜 1**。

---

## 一、窗口与硬线（硬约束，不是"尽量做完"）

| 项 | 值 |
|---|---|
| 窗口 | **23:05 → 07:55**（530 min） |
| 工作目录 | `D:\workspace\2026\mryang-arsenal` |
| 状态目录 | `D:\workspace\2026\mryang-arsenal\.workbuddy\night-chain\2026-09-27\`（**按夜归档，别写到上一层**） |
| 上一夜 | `.workbuddy\night-chain\2026-09-26\REVIEW.md` |
| 全仓硬停 | **07:55** —— 窗口外每分钟都在扣积分，到线无条件停手 |

### 棒次表

| 棒 | 任务 | 体量 | 开工 | 交棒硬线 | 预算 | 开发 / 自检 / Review / 收尾 |
|---|---|---|---|---|---|---|
| **1** | **部署形态动画化**（C-1 / P0-4，独占上半夜） | **XL** | 23:05 | **05:40** | 395 | 220 / 65 / 65 / 45 |
| **终检** | 巡检与补漏（唯一不写新功能的一棒） | — | 接棒（兜底 05:43） | **07:55** | 65 | — |

**为什么只有 1 棒**（算术，别再重排）：

```
动画化净工时 ≈ 250 min（图元模型重构 + 新播放器组件 + 【22】verify 层改五处 + 18 步剧本内容）
准入：250 × 1.5 + 20 = 395 min 预算
395 + 终检 65 + 交接 6 = 466 ≤ 530  ✓ 装得下，但**装不下第二棒**
```

它是**重构型不是增量型**：要动 `topologyModeSvg()` 这个全局渲染函数，与【17】【18】装配台断言耦合，
需要充分的 review 与回滚判断。**不与别的任务混排** —— 这是 09-26 就定下的结论。

### 三个决策 ✅ 已于 09-26 20:0x 拍板（不用再问，照做）

| 决策 | 拍板结果 |
|---|---|
| 做 Redis 还是全家族 | **Redis 家族优先** |
| 机理台默认展开还是收起 | **默认收起** |
| 要不要手动故障注入 | **不做** |

### 本棒的四个硬点（动手前先认清）

1. **`topologyModeSvg()` 是全局渲染函数** —— 改它会影响所有形态的图，不是加一个新页面。
2. **【17】【18】装配台断言绑在上面** —— 33 槽位分布 3/1/29、三档宽度 208/172/148 等数字钉死，
   改完必须全量跑，红了要能说清是"断言过时"还是"改坏了"，不许直接改断言让它绿。
3. **若要新增【22】verify 层，得改七处**：`package.json` + `verify-all.mjs`(LAYERS) +
   `report.ts`(LAYER_NAMES) + `meta-check.ts`(CHAIN_ORDER) + 档案 `verifyChain` + README 两处。
   **先问自己：这一层是不是非加不可**？能挂在既有层里就别开新层（硬约定 10）。
4. **18 步剧本是内容活**，占净工时的大头。时间不够就**先保图元模型 + 播放器**，剧本往后砍，
   但砍了要在 `01-done.json` 里写明砍到第几步 —— 不许交一个看起来完整、实际只有 3 步剧本的壳。

---


## 二、接力协议（每棒开工第一件事）

1. 读状态目录 `night-chain\2026-09-26\`，搞清现在到第几棒。
2. **等前棒**：`<N-1>-done.json` 不存在 → **不许开工，不许碰仓库任何文件**。每 60 秒查一次，最多等到本棒硬线。
3. **读到 done.json ≠ 可以开工**。必须三件事同时成立：
   `可交棒 == true` 且 `验证.全量跑了 == true` 且 `提交.已提交 == true`。
   缺一 → 视同未交棒 → 写 `<N>-blocked.json` 跳过本棒，如实留给终检。
   > 前棒崩了却留下一个 done.json，是无人值守下最容易发生的静默事故。
   > 另：状态文件里的「收工」时刻字段**不可信**（棒 1 曾写下一个自己还没到的收工时刻）。
   > 下一棒判断交接是否发生，以状态文件的 **mtime** 或文件里显式的「交接时刻」字段为准，**不要比对「收工」字段**。
4. 等不到 → 写 blocked，**把下一棒 `scheduledAt` 设为本棒硬线时刻**（不是"现在+3分钟"，否则整链一路轮询到天亮）。
5. 开工即建 `<N>-running.json`（含本棒砍定后的范围）。
6. **第一棒**：`git status --porcelain` 若非空 → 先分批提交存量（`chore(baseline): ...`）再开发。
   （编排时实测：**工作区干净**，本步大概率无事，但必须先查。）

### 交棒动作（写死工具与参数，别只说"改一下时间"）

```
automation_update(
  mode = "update",
  id   = "<下一棒的 automation id>",
  scheduledAt = "<现在 + 3 分钟，ISO 8601 带时区>"
)
```

其余字段**一律不传**（mode=update 下未传字段保持原值）。改完回读一次确认生效。

---

## 三、一棒三段（缺一不可，这是交付的定义）

| 段 | 占比 | 对准什么 |
|---|---|---|
| 开发 | 60% | 按方案的 MVP 先做闭环，再做扩展 |
| 自检补漏 | 20% | **方案（要求）**：该做的都做了吗？有没有静默失败？ |
| Code Review | 20% | **代码（实现）**：写得住吗？和项目一致吗？ |

**收尾另算约 20 min**，它是交付的一部分，不是可选的最后一步。

### 熔断检查点（到点必做，不许凭感觉）

开发过半时算一次剩余：`剩余 < 自检 + review + 20` → **立刻停止开发**，转入自检，
并把"开发未完成"如实记进 `开发.未做完的`。
继续开发的代价是三段全被压没 —— 那不算交付。
> 首次夜跑四棒全停在地基，本质就是这道熔断没生效。无人值守下必须把算法写死。

### 自检五件事（§2.3）

1. 把方案的验收标准逐条拉表 ✅/⚠️/❌（**对照原文，不是印象**）
2. 声称新建的文件逐个 `ls` 确认
3. **反着验 ≥2 处**：故意注入错误 → 确认真红 → 还原
4. 找"空跑通过"的检查（断言通过但样本量为 0）
5. 方案引用的 id / 路径，去仓库核实真实存在

### Review 五维度

正确性 / 安全 / 性能 / 可维护性 / 一致性。
每条记 `[P0/P1/P2] file:line —— 问题 → 根因 → 处置`。
**P0 与便宜的 P1 当场修**；其余进清单并写明为什么没修。不许把 P2 包装成 P1 凑数。

---

## 四、收尾清单（顺序不能反）

1. **跑全量验证**（不是只跑自己改的那层），记录**三态**并与开工前基线对比
2. **同步所有派生数字**（见 §五，五处）
3. **git commit**（`feat(scope): ...` 规范格式）
4. 删掉所有 `_*` 调试产物
5. 追加 memory 日志（**增量追加，别整体覆写** —— 有多个会话在写）
6. 若构建/验证比开工前更红且修不了 → **回滚到开工前状态**并说明
7. 写 `<N>-done.json`，**先填 `可交棒`** 再落盘

---

## 五、环境备忘（每条命令前都要）

```bash
# bash 的 PATH 是坏的，不加则 ls / dirname / head 全部 command not found
export PATH="/usr/bin:/bin:/c/Windows/System32:/c/Windows:$PATH"
```

| 运行时 | 路径 |
|---|---|
| node | `C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe` |
| python | `C:\Users\Administrator\.workbuddy\binaries\python\versions\3.13.12\python.exe` |
| JDK17 | `C:/Users/Administrator/.jdks/corretto-17.0.12` |

**Git Bash 下 `npm run <script>` 会 exit 1** → 直接跑脚本本体，或
`node "<node目录>/node_modules/npm/bin/npm-cli.js" run <script>`。

```bash
cd /d/workspace/2026/mryang-arsenal/arsenal-web
node scripts/next-run.mjs build      # 静态导出（next build 只许走这个包装）
node scripts/verify-all.mjs          # 九层全量
node visual/assert.mjs               # 沙箱里 verify:visual 包装层 EBUSY，直接跑这个
./node_modules/.bin/tsx .verify/project-check.ts   # 单层快验
```

后端（parity / archify 层需要）：
```bash
JAVA_HOME="C:/Users/Administrator/.jdks/corretto-17.0.12" SKIP_COMPILE=1 bash arsenal-server/scripts/run.sh
```

---

## 六、项目铁律

1. **事实源只能是 `tools\content\*.py`**。改完必跑
   `python tools\build-content.py` → `node arsenal-web\scripts\sync-content.mjs`。
   场景注册点是 `tools/build-content.py:40` 的 **`CASES_MODULES`**（漏了不报错，静默不生成）。
2. **写 JSON 一律 `newline='\n'`**，否则整份文件变「CRLF 假变更」。
3. **零外部依赖是硬约束** —— 不许引入任何图标 / 动画 / 图表 / 滑杆 / 绘图库。
4. **新模块必须登记进生成器**（`STACK_MODULES` / `CASES_MODULES` / cookbook 管道）。
5. **方案里引用的规则 id 必须去 `arsenal-rules\` 查**，不许照抄方案示例。
6. **调试产物写 `.workbuddy\_*` 或 `arsenal-web\.workbuddy\_*`，用完即删。**
7. **派生数字同步五处**（改一处必改全部，改完复跑确认）：
   - `arsenal-profiles\arsenal.json` → `project.verifyChain[*].count`
   - `arsenal-web\.verify\project-check.ts` 手写总数常数
   - `README.md` 总数句
   - `README.md` 分项表
   - `verify:meta`（`meta-check.ts` 的 CHAIN_ORDER）
   改完 `arsenal.json` **必须重跑 `sync-content.mjs`** 才生效。

### git 分批纪律（两条都真踩过）

- 一律 `git add <路径>` + **`git commit -- <路径>`**；提交前看 `git diff --cached --stat` 只含本批。
  仓库里常有别的会话**预暂存**的改动，不带 pathspec 会把它们连坐进本批。
- **目录级 pathspec 会夹带 `_*` 调试产物** → 逐文件 add，或 add 后
  `git diff --cached --name-only | grep '/_'` 复核必须为空。
- 误提交：`git reset --soft HEAD~1` + `git reset HEAD -- <被连坐路径>`（不动工作区）。

---

## 七、本仓库已知雷区（照抄进每棒）

- **后端 3011 随定时任务会话结束而死** → parity 层静默跳过 3 项、退出码 **2（绿但有跳过）**。
  **跑全量前先 node fetch 探活**，DEAD 就起后端。这是本仓最容易被读成全绿的假绿点。
- **视觉层断言的是 `out/` 不是源码** → 跑之前必须先 `next-run.mjs build`，否则整层跳过。
- **汇总表「通过 / 跳过 / 失败」是互斥三态**，三者之和才是实测。
  退出码 2（绿但有跳过）**不许写成"通过"**。
- **注入后先断言「注入真的打中了」** —— 本仓踩过两次注入打空、检查仍绿。
- **还原分两种情况**：
  - 本棒**没碰过**的文件 → `git checkout -- <file>` 最稳；
  - 本棒**已改动未提交**的文件 → **必须先 `cp` 备份到 `.verify/tmp/` 再用 `cp` 还原**。
    ⚠️ `git checkout --` 会回到 HEAD，把未提交的改动一起抹掉（2026-09-26 白天真踩过）。
  - 还原后 `git status --porcelain` 复查干净（python 文本模式写回会翻 CRLF，内容对但挂 M）。
- **两份 `CaseLab` 不是重复文件**：`src\app\cases\CaseLab.tsx`(909) = 症状分诊台；
  `src\components\DemoRunner.tsx`(265，原 `components\CaseLab.tsx`) = 蓝图页演示控制台。
- **字段名是 `conflicts` 不是 `exclusiveGroups`**（后者在 JSON 里是 null）。
- `arsenal-cases\*.json` **包了一层 `case` 键**（`{"case":{...}}`），脚本别打空。
- **装配台约束只能灰显不能隐藏**：【17】钉死 33 槽位与三档宽度分布 3/1/29。
- **改 `StackComposer.tsx` 前先 grep `.verify/project-check.ts` 对它的字符串断言**
  （`stack-bench` / TabId 三处一致 / `onSelect={focusDim}` / `loadSnapshot(` / `loadDrafts` / 目录树字面量 / `hist.record(`≥6）—— 抽成新文件会让断言静默变红。
- **同一文件多处改动必须串行**（并行 Edit 静默丢改、tsc 仍 0 错）。
- 无头浏览器脚本放 `arsenal-web\visual\_NN-ui.mjs`，import 用 **`playwright-core`**（不是 `playwright`）；
  给浏览器用的静态站要在脚本里用 node `createServer` 自起。

### 本夜第 1 棒（部署形态动画化）专属雷区 —— 六条，动手前先读一遍

1. **先出快照，再动 `topologyModeSvg()`** —— 它是全局渲染函数，13 个既有 `modeId` 的输出
   在重构前后必须**逐字符一致**。这是方案作者点名的「本批最关键护栏」：
   改渲染函数动的是全局几何，不锁死就会让迷你图和形态图卡片**悄悄变形**，
   而【17】视觉断言查的是 `out/`，不一定当场红，等发现已经是视觉回归。
2. **剧本画的节点数必须 == 该形态 `replicas`**（`client` 不计）——
   「动画画 3 个、K8s 写 2 个」是本方案自己点名的头号事故形态，正是本项目最忌讳的那类。
3. **悬空引用是静默失败**：`steps[].highlight` / `active` / `token.edge` / `edges[].from/to`
   引用的 id 必须存在。这类错了不会报错，只会**播放时不动**，是最难查的一类 bug。
4. **`caption` 含数字必须带 `refs`** —— 不许凭空编数字（硬约定 3 的延伸）。
5. **Caffeine 不得出现在 `masterslave` / `cluster` 形态** —— 这是回归 bug #2，已有前科。
6. **播放器默认收起 + 尊重 `prefers-reduced-motion`** —— 动画抢戏把 ⑤ 的表单挤没了，
   等于把选型台的主功能挤掉。**不新增路由。**

**另两条结构约束**（不是雷区但是硬边界）：

- **`replicas` 字段不许动**，只动 modes 集合 —— 否则 ⑥ 交付的副本数计算会受影响，还得回归一遍。
- **【22】verify 层先问"非加不可吗"**：方案 §6 给了 12 条建议断言（首版 ~12 条），
  开工去读原文。**能挂在既有层里就别开新层**（硬约定 10：开一层要改七处）。


### 次夜首棒（W-0 共享判据）的雷区 —— 今晚不执行，先记账别丢

- **改 `tools/build-content.py` 只动 `build_cookbook()`（91-284 行）与 `COOKBOOK_FAMILIES`。**
  绝对不许碰 **`CASES_MODULES`（:40）/ `STACK_MODULES`（:28）** —— 第 1 棒刚往 `CASES_MODULES`
  加过 `'cases/idempotent_write'`，误删会让第 1 棒的产物**静默不生成**，两棒的账一起坏。
- **`_contract.json` 是新增事实源文件。** 按铁律「加一类事实源改四处」（sync + 前端 resolver +
  `project-check.ts` + README 目录树），四处处处都要改。
  **推荐回避**：不要新增 `src/generated/cookbook-contract.json`，而是让 sync 把 contract
  内联进 **`src/generated/cookbook.json` 的 `meta.contract`** —— 这样只动
  `cookbook-types.ts` 一个字段，且【16】本就在比 cookbook 的字段契约，能顺带守住。
  两种做法都行，但**不许只做一半**（facts 写了、前端没读，等于没有）。
- **判据「是否已抽走」用源码文本 grep 断言**（读 build/sync 源码，旧判据文案出现即红），
  这是本仓「源码即数据」的既有套路。
  **别去 grep `30` / `2` / `3` 这类数字阈值** —— 太宽泛，必然误伤无关代码。
- 【22】是 **project 层内新增一组断言**（和【16】-【21】同级），**不是新增一层**。
  所以数字同步按「四处」（档案 `verifyChain[project].count` / `project-check.ts` 常数 /
  README 总数句 / README 分项表），**不需要**走「加一层改五处」（那是加 `verify-all.mjs`
  LAYERS 层的口径，别搞混）。
- 写任何 JSON 一律 `newline='\n'`。

---

### 本夜新增雷区（2026-09-27 白天实测得出，已核对）

1. **数字基线已变 1082**（parity **16** / project **786**）—— 改这两层的断言数时，
   五处同步的起点是 1082/16/786。**别拿旧文档的 1076/12/784 抄。**
   （本棒若只动 stack 侧，可能不碰这两层，但收尾同步数字时要从 1082 起算。）
2. **`toPosix()` 出来的 `/d/...` 是 MSYS 风格**：只有 spawn **bash** 能用；
   spawn **node** 必须传原生 Windows 路径（`C:\...`）。parity【7】里有注释范例。
3. **后端已跑新引擎类**：`WEB-CTRL-004` 开始真检出（此前 reduce 缺陷导致从未检出）——
   探针/样本里出现它的违规是**修复生效**，不是误报，别去"修"它。
4. **`AstProbe` / `mcp-probe` 已挂 parity【6】【7】**：改 `AstEngine` / `mcp-stdio.mjs` 后必须跑 parity 层。
   ⚠️ **本棒不该碰这两个文件** —— 它们属于并发会话正在做的 MCP 改动，见 §八基线。
5. **【21】已有两位数收窄守卫**：README 里「N 张截图矩阵 / N 路由」必须等于 `shoot.mjs` 的 EXPECTED 锚定值。
   改截图张数不止要同步四处，还会被【21】盯住。
6. **`scan-check` 跑完自清 fixture** —— 别假设 `.verify/tmp/scan-check/` 里有上一轮残骸可复用。
7. **`.audit/` 已不存在、根目录 0 字节垃圾已删** —— 09-22 审计的残留清单大半已失效，别照单清理。
8. **交接时间以 `done.json` 的文件 mtime 为准**，「收工」字段不可信（已写进 §二接力协议）。


## 八、开工前基线（编排时实测，收尾要对回去）

```
HEAD        = 574e9da（19:2x；**开工前以你实际 `git log -1` 看到的为准**）
git status  = ⚠️⚠️ **19:2x 实测：仓库里躺着 30+ 条别的会话的未提交改动**（MCP 接入相关）：
              arsenal-server/src/main/java/com/arsenal/engine/{AstEngine,LintEngine}.java、
              arsenal-server/src/main/java/com/arsenal/mcp/McpToolCatalog.java、
              arsenal-server/scripts/{mcp-stdio,mcp-install,mcp-probe}.mjs、ast-probe.sh、
              arsenal-web/src/lib/{engine,case-synth,arsenal-api,exporters}.ts、
              arsenal-web/.verify/{project-check,parity-check,scan-check}.ts、
              arsenal-web/src/app/{page,rules/[id]/page,check/CheckConsole}.tsx、
              .gitignore / README.md / arsenal-profiles/arsenal.json / visual/shoot.mjs
              + 未跟踪：docs/MCP-接入指南.md、docs/升级方案-2026-09-27.md
              + 已删除未暂存：根层 5 个乱码名垃圾文件（今晚只排 / 工作目录 / 性质 / 状态目录 / 窗口）
              → **这个会话 19:22 还在写**。开工第一件事 `git status --porcelain` 盘点，
              并按 §六的 git 分批纪律处理。
九层总数    = ⚠️ **数字正在漂移，别信文档**：
              09-26 终检实测 1076；19:2x 读档案 `project.verifyChain` 合计 = 1082。
              两者对不上 = 并发会话改了断言但没同步档案（或反之）。
              → **开工先 `verify:meta` + 全量跑一次取真值**，把这个数当作你的基线，
                收尾对回去。别照抄 1076 也别照抄 1082。
后端 3011   = 19:2x 实测 ALIVE（白天起的实例仍在跑）→ 但你开工时多半是 DEAD，先探活
场景库      = 9 场景（幂等场景 09-26 夜已加）/ 切片与症状数开工实测
案例库      = 1 技术 / 3 场景 / 3 方案 / 3 实验
```

### 本夜不排的任务（记账，别在夜里临时起意）

| 任务 | 为什么不进本夜 |
|---|---|
| **W-0 共享判据** | 是 A-1 主线扩容的解锁件，排**次夜首棒**（升级方案 §六 夜 2）。本夜预算被动画化占满 |
| **B-1 lintRemote / B-2 AST 守门 / B-3 MCP** | 期一收口三件套，排夜 3。**⚠️ B-3 与并发会话正在做的 MCP 改动是同一片区域 —— 必须等它落袋后再排，别两拨人同时改 `McpToolCatalog.java`** |
| **`blueprint-pack`（C-1）** | 它和 W-4 都动 `ExportStudio.tsx`，必须与 W-4 错开；排期在升级方案里靠后 |
| **案例库 9 条新主线（P0-5）** | XL，5~7 夜的内容滚动期，从夜 4 起 |

---


## 九、终检棒职责（§六）

**唯一不写新功能的一棒。产出是「真相」+ 收拾摊子。**

1. **独立验证，不许只信状态文件** —— 全量构建 + 全量验证真跑、文件存在性、闸门真会中断、
   断言真会变红、页面真渲染、数字真同步、memory 真写了、**git 真提交了**。
2. **反着验补课** —— 优先验**今晚新写的、从未红过**的检查。
3. **差异清单** —— 逐棒点名「它说做了 vs 实际」。
4. **补漏**（优先级：仓库不可运行 > 验证挂红 > 数字不同步 > 文档缺失 > 状态文件缺失），
   **不补任何需要 30 min 以上的新功能**。
5. **产出 `REVIEW.md`**（写到 `night-chain\2026-09-26\REVIEW.md`），剩余工作量按离闭环距离排
   P0/P1/P2，**每条带四个字段**：`位置 / 当前状态 / 离闭环还差什么 / 预估档位`。
   若有需要人拍板的决策项，**单独拎到最前面**并注明"排期前需先找用户拍板"。
6. **清理** `*-running` / `*-blocked`，只留 `*-done.json` 与 `REVIEW.md`；
   把 `.workbuddy\night-chain\LATEST` 内容改成 `2026-09-26`。
7. **归因核查**：`git log --name-only --format="" b927e30..HEAD | grep '/_' | sort -u`
   **排除 `_lib/` 等刻意的 Next 私有目录后必须为空**（09-26 终检实测：`src/app/cases/_lib/` 四个文件命中 ——
   那是 Next.js 约定的私有目录（路由私有模块），不是 `_*` 调试产物，直接判空会误报）；
   对最大两个提交 `git show --name-status` 逐条看域归属。
8. 用 `present_files` 呈现 `REVIEW.md`。

**绝对不许**：为了让报告好看而修改结论、把"没做"写成"做了"、删掉挂红的断言。
