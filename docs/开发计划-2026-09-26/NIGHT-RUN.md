# 夜跑规程 · 2026-09-26（本夜实例化）

> 本文件是**每一棒开工必读的第一份**，自包含。夜间 agent 不需要知道技能目录的存在。
> 通用章程见 `docs/hy4-night-plans/NIGHT-RUN.md`（常驻版，§五是终检职责）。
> 本夜的任务清单与棒次细节在**同目录的 `夜跑计划书-2026-09-26.md`**。

---

## 一、窗口与硬线（硬约束，不是"尽量做完"）

| 项 | 值 |
|---|---|
| 窗口 | **23:05 → 07:55**（530 min） |
| 工作目录 | `D:\workspace\2026\mryang-arsenal` |
| 状态目录 | `D:\workspace\2026\mryang-arsenal\.workbuddy\night-chain\2026-09-26\`（**按夜归档，别写到上一层**） |
| 上一夜 | `.workbuddy\night-chain\REVIEW-2026-09-25.md`（老式布局，无日期子目录） |
| 全仓硬停 | **07:55** —— 窗口外每分钟都在扣积分，到线无条件停手 |

### 棒次表

| 棒 | 任务 | 体量 | 开工 | 交棒硬线 | 预算 | 开发 / 自检 / Review / 收尾 |
|---|---|---|---|---|---|---|
| **1** | 场景库补「幂等」场景 `idempotent-write` | **L** | 23:05 | **02:55** | 230 | 126 / 42 / 42 / 20 |
| **2** | 案例库 AI 出口 `blueprint-pack`（C-1） | **M** | 接棒（兜底 02:58） | **06:45** | 225 | 125 / 40 / 40 / 20 |
| **终检** | 巡检与补漏（唯一不写新功能的一棒） | — | 06:50（无条件） | **07:55** | 65 | — |

**为什么是 2 棒不是 3 棒**（算术，别再重排）：

```
可用窗口 530 − 终检 65 − 交接 3×2 = 462  →  单棒预算 230
幂等场景 = 内容型 L（6 切片 × 12-15 min + benchmark/architecture）→ 需 120×1.5+20 = 200 min
3 棒方案单棒只有 155 min < 200 → 违反准入条件，不许排
且总产出：2 棒 286 min > 3 棒 271 min（每棒固定开销 23 min，加棒是负收益）
```

---

## 二、接力协议（每棒开工第一件事）

1. 读状态目录 `night-chain\2026-09-26\`，搞清现在到第几棒。
2. **等前棒**：`<N-1>-done.json` 不存在 → **不许开工，不许碰仓库任何文件**。每 60 秒查一次，最多等到本棒硬线。
3. **读到 done.json ≠ 可以开工**。必须三件事同时成立：
   `可交棒 == true` 且 `验证.全量跑了 == true` 且 `提交.已提交 == true`。
   缺一 → 视同未交棒 → 写 `<N>-blocked.json` 跳过本棒，如实留给终检。
   > 前棒崩了却留下一个 done.json，是无人值守下最容易发生的静默事故。
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

---

## 八、开工前基线（编排时实测，收尾要对回去）

```
HEAD        = b927e30
git status  = 空（干净）
九层总数    = 1043（35 / 68 / 763 / 36 / 17 / 12 / 31 / 69 / 12），0 跳过，0 失败，刻意未跑 2
后端 3011   = 编排时 ALIVE —— 但你开工时多半是 DEAD，先探活
场景库      = 8 场景 / 61 切片 / 32 症状 / 47 driver（11 个 inert）
案例库      = 1 技术 / 3 场景 / 3 方案 / 3 实验
```

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
7. **归因核查**：`git log --name-only --format="" b927e30..HEAD | grep '/_' | sort -u` 必须为空；
   对最大两个提交 `git show --name-status` 逐条看域归属。
8. 用 `present_files` 呈现 `REVIEW.md`。

**绝对不许**：为了让报告好看而修改结论、把"没做"写成"做了"、删掉挂红的断言。
