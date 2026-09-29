# 夜跑规程 · 装配台重设计（原三夜分期，现合并单夜）

> ## ⚠️ 变更（09-29 21:0x，mryang 拍板：三夜合并为今晚单夜链）
>
> 下表**覆盖**本文及各文档中全部「三夜分期」表述，冲突时以本块为准。7 条定时任务的 prompt/时间/交棒链已全部改写；**状态目录统一为 `2026-09-29\`**；状态文件序号：棒1=01、棒2=02、棒3=03、棒4=04；夜2/夜3 两条终检任务（dd47c4f8 / fe42a31a）已 **PAUSED**。
>
> | 棒 | 任务 | 方案 | 兜底开工 | 交棒硬线 | 窗口说明 |
> |---|---|---|---|---|---|
> | 1 | P0 信息架构拆分（XL） | plan-1-p0-拆页.md | 23:05 定时 | **04:45** | 预算 380 完整，独占前半夜 |
> | 2 | 交付中心与运行部署页 | plan-2-p1-交付与运行页.md | 05:10 | **06:05** | 实际 ~60 min，熔断出「预检闸首屏化」最小集 |
> | 3 | 选型台与环境模块页 | plan-3-p1-选型与环境页.md | 06:30 | **06:45** | 15-30 min，大概率 blocked 快速退出 |
> | 4 | 视觉统一与走查 | plan-4-p2-视觉统一.md | 06:48 | **07:00** | 7-50 min，大概率 blocked 快速退出 |
> | 终 | 全链巡检与补漏 | 本文件 §九 | 07:05 | 硬停 07:55 | 预算 40，P0 四页是今晚硬底线 |
>
> **合并单夜特别条款**：棒2/棒3/棒4 醒来第一件事算窗口剩余，`剩余 < 自检+收尾+20` → 写 `<N>-blocked.json`（字段：窗口不足）5 分钟内退出并交棒。**blocked 是正常结局，不是事故**，绝不硬做。跨夜首棒条款作废（本夜无跨夜）。交棒链 id：67035e70 → 8838b819 → 43fdb172 → 17ce1f1a → 67a4c020。

> 本文件是**每一棒开工必读的第一份**，自包含。夜间 agent 不需要知道技能目录的存在。
> 总纲与拍板：同目录 `00-index.md`、`PLAN.md`；常驻章程：`docs\hy4-night-plans\NIGHT-RUN.md`。

---

## 一、窗口与棒次

| 项 | 值 |
|---|---|
| 窗口（每夜） | **23:05 → 次日 07:55**（530 min） |
| 全仓硬停 | **07:55** —— 窗口外每分钟都在扣积分，到线无条件停手 |
| 工作目录 | `D:\mryang\workspace\2026\arsenal` |
| 状态目录 | 按夜归档：`.workbuddy\night-chain\2026-09-29\` / `2026-09-30\` / `2026-10-01\` |

| 夜 | 棒 | 任务 | 方案 | 体量 | 开工 | 交棒硬线 | 预算（开/自/审/收） |
|---|---|---|---|---|---|---|---|
| 1 | 1 | P0 信息架构拆分 | plan-1-p0-拆页.md | XL | 23:05 | **04:45** | 380（240/60/60/20） |
| 1 | 终 | 巡检与补漏 | 本文件 §九 | — | 兜底 04:48 | 硬停 07:55 | 40+ |
| 2 | 1 | 交付中心与运行部署页 | plan-2-p1-交付与运行页.md | L | 23:05 | **03:05** | 240（145/37/38/20） |
| 2 | 2 | 选型台与环境模块页 | plan-3-p1-选型与环境页.md | L | 接棒（兜底 03:08） | **07:08** | 240（145/37/38/20） |
| 2 | 终 | 巡检与补漏 | 本文件 §九 | — | 兜底 07:11 | 硬停 07:55 | 44 |
| 3 | 1 | 视觉统一与走查 | plan-4-p2-视觉统一.md | M+ | 23:05 | **03:05** | 240（145/37/38/20） |
| 3 | 终 | 巡检与补漏 | 本文件 §九 | — | 兜底 03:08 | 硬停 07:55 | 40+ |

**「交棒硬线」是硬线。** 到点无论做到哪一步，停止开新阶段，执行 §四 收尾并交棒。

---

## 二、接力协议（每棒开工第一件事）

1. 读状态目录（本夜子目录），搞清现在到第几棒。
2. **等前棒**：`<N-1>-done.json` 不存在 → **不许开工，不许碰仓库任何文件**。每 60 秒查一次，最多等到本棒硬线；等不到写 `<N>-blocked.json` 跳过本棒，把下一棒 `scheduledAt` 设为本棒硬线时刻（不是"现在+3分钟"，否则整链轮询到天亮）。
3. **读到 done.json ≠ 可以开工**，必须三件同时成立：`可交棒 == true` 且 `验证.全量跑了 == true` 且 `提交.已提交 == true`。缺一 → 视同未交棒 → blocked。
4. 判断交接是否发生以状态文件 **mtime** 为准，「收工」字段不可信。
5. 开工即建 `<N>-running.json`（含砍定后的范围）。
6. **每夜第一棒**：先 `git status --porcelain` 盘点。若躺着别的会话的未提交改动 → 按分批纪律先提交存量（`chore(baseline): ...`）再开发；**跨夜首棒（夜2棒1/夜3棒1）**还要读上一夜 `REVIEW.md`，前置不满足（上夜 P0 未落/仓库不可运行）→ blocked 跳过。

### 交棒动作（写死工具与参数）

```
automation_update(mode="update", id="<下一棒 automation id>",
                  scheduledAt="<现在 + 3 分钟，ISO 8601>")
```
其余字段一律不传（mode=update 下未传字段保持原值）。改完回读确认生效。

---

## 三、一棒三段（缺一不可，这是交付的定义）

| 段 | 预算 | 对准 |
|---|---|---|
| 开发 | 60% | 按方案 MVP 先做闭环再扩展 |
| 自检补漏 | 20% | **方案（要求）**：该做的都做了吗？有没有静默失败？ |
| Code Review | 20% | **代码（实现）**：写得住吗？和项目一致吗？ |

收尾另算约 20 min（§四），是交付的一部分。

**熔断检查点**：开发过半算一次剩余 —— `剩余 < 自检 + review + 20` → **立刻停止开发**转自检，未完成如实记进 `开发.未做完的`。

**自检五件事**：①方案验收标准逐条拉表 ✅/⚠️/❌（对照原文）②声称新建的文件逐个 `ls` ③**反着验 ≥2 处**新闸门/断言（注入→确认真红→还原）④找"空跑通过"（样本量为 0 的检查）⑤方案引用的 id/路径去仓库核实。

**Review 五维度**：正确性/安全/性能/可维护性/一致性。每条 `[P0/P1/P2] file:line —— 问题 → 根因 → 处置`。P0 与便宜的 P1 当场修；不许把 P2 包装成 P1。

**段间门禁**：开发→自检须构建通过；自检→Review 无未修 P0 完整性缺陷；Review→收尾无未修 P0 代码缺陷。

---

## 四、收尾清单（顺序不能反）

1. **跑全量验证**（十层，不是只跑自己那层），记录三态（通过/跳过/失败）并与开工基线对账。**没跑过就不能说它是绿的。**
2. **同步所有派生数字**（§六.7 五处），改完复跑确认。
3. **git commit**（`feat(scope): ...`），分批纪律见 §六.8。
4. 删光 `_*` 调试产物。
5. 追加 memory 日志（`.workbuddy/memory/当日.md`，**增量追加**）。
6. 构建/验证比开工前更红且修不了 → **回滚到开工前状态**并说明。
7. 写 `<N>-done.json`（schema 见 `docs\hy4-night-plans\NIGHT-RUN.md` 配套模板），先填 `可交棒` 再落盘。

---

## 五、环境备忘（每条命令都要）

```bash
export PATH="/usr/bin:/bin:/c/Windows/System32:/c/Windows:$PATH"
```

| 运行时 | 路径 |
|---|---|
| node | `C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe` |
| python | `C:\Users\Administrator\.workbuddy\binaries\python\versions\3.13.12\python.exe` |
| JDK17 | `C:/Users/Administrator/.jdks/corretto-17.0.12` |

```bash
cd /d/mryang/workspace/2026/arsenal/arsenal-web
node scripts/next-run.mjs build      # 静态导出（next build 只许走这个包装）
node scripts/verify-all.mjs          # 十层全量
node visual/assert.mjs               # 沙箱里 verify:visual 包装层可能 EBUSY，直接跑这个
./node_modules/.bin/tsx .verify/project-check.ts   # project 层单层快验
```

- **Git Bash 下 `npm run <script>` 会 exit 1** → 直接跑脚本本体，或 `node "<node目录>/node_modules/npm/bin/npm-cli.js" run <script>`。
- 后端（parity / archify 需要）：先探活 `node -e "fetch('http://127.0.0.1:3011/api/health').then(r=>console.log(r.status)).catch(e=>console.log('DEAD'))"`；DEAD 就 `JAVA_HOME="C:/Users/Administrator/.jdks/corretto-17.0.12" SKIP_COMPILE=1 bash arsenal-server/scripts/run.sh`（**改过规则必重启**；后端随会话结束而死是常态）。

---

## 六、项目铁律

1. **事实源只能是 `tools\content\*.py`**。改完必跑 `python tools\build-content.py` → `node arsenal-web\scripts\sync-content.mjs`。本三夜**计划不碰数据层** —— 碰了就是越界。
2. **写 JSON 一律 `newline='\n'`**。
3. **零外部依赖**：不许引入任何图标/动画/图表/滑杆/绘图库。
4. **派生数字同步五处**（改断言数必做）：`arsenal-profiles\arsenal.json` verifyChain[*].count / `.verify\project-check.ts` 手写总数常数 / README 总数句 / README 分项表 / `meta-check.ts` CHAIN_ORDER。改完 arsenal.json 必须重跑 sync-content.mjs。
5. **改 `StackComposer.tsx`（或 P0 之后的新容器）前先 grep `.verify\project-check.ts` 对它们的字符串断言** —— `stack-bench` / TabId / `onSelect={focusDim}` / `loadSnapshot(` / `loadDrafts` / `hist.record(` / 目录树字面量……抽文件会让断言静默变红。
6. **调试产物写 `_*` 前缀，用完即删。**
7. **方案里引用的规则 id 必须去 `arsenal-rules\` 查**，不许照抄方案示例。
8. **git 分批纪律**：`git add <文件>` + `git commit -- <路径>`，提交前看 `git diff --cached --stat`；目录级 pathspec 会夹带 `_*`。误提交：`git reset --soft HEAD~1` + `git reset HEAD -- <路径>`。
9. **同一文件多处改动必须串行**（并行 Edit 静默丢改，tsc 仍 0 错）。
10. **不许 push**（本机 PortableGit push 假死），只 commit。

---

## 七、本仓雷区（装配台重设计专项 + 通用）

**专项（本三夜必读）**：
- **export-lint 预检闸是最后防线**（`src/lib/export-lint.ts` 五检查 + BOM 白名单）：表现层可以禁用下载，但五检查的计算逻辑一行不动；UI 侧**严禁在 useMemo/render 路径抛异常**（崩整页），违规走 state 渲染红块。
- **P0 拆页后断言指向新容器**：夜1 会把 project-check 里对 `StackComposer.tsx` 的 ≥8 组断言改指 `StackSoftware/StackEnv/StackRun/StackDelivery` 等 —— 后续棒改这些容器前同样先 grep 断言。
- **EXPECTED 20/60 被【21】守卫钉死**：README「N 张截图矩阵 / N 路由」散文与 shoot.mjs 锚定值必须一致；**不许再新增路由**。
- **装配台约束只能灰显不能隐藏**：【17】钉死 33 槽位与三档宽度 208/172/148、分布 3/1/29；角标/计数一律从数据现算，不许手写常数。
- **SlotBlock 无修改入口是故意的**（反向断言），别给它加编辑功能。
- **`wizard.ts` 是步骤归属唯一出处**（stepOfDim/THEME_SECTIONS/RUN_GROUP_IDS/FLOWS/SECTION_ROUTE）—— 任何"这个维度归哪一步/哪一页"的判定只许消费它。
- **Archify 层 09-29 白天 3 项失败是环境问题**（宿主对 node 起子进程 EBUSY，探针手动跑全绿）：夜跑遇到 Archify 挂红，先手动复跑探针区分环境/代码，报告写明哪层被拦，别急着回滚。

**通用（历夜实测沉淀）**：
- 后端 3011 随会话结束而死 → parity 层静默跳过、退出码 2（绿但有跳过）≠ 全绿。跑全量前先探活。
- 视觉层断言 `out/` 不是源码 → 先 build 再跑；汇总表「通过/跳过/失败」是互斥三态。
- **注入后先断言「注入真的打中了」**再跑检查（本仓踩过两次注入打空仍绿）。
- **还原分两种**：没碰过的文件 `git checkout -- <file>`；本棒已改动未提交的**必须先 `cp` 备份再用 `cp` 还原**（git checkout 会抹掉未提交改动）。还原后 `git status --porcelain` 复查。
- 两份 `CaseLab` 不是重复文件（cases/CaseLab.tsx=分诊台，components/DemoRunner.tsx=演示控制台）。
- 模块勾选字段名是 `conflicts` 不是 `exclusiveGroups`；`arsenal-cases\*.json` 包了一层 `case` 键。
- spawn node 必须传原生 Windows 路径（`C:\...`）；`/d/...` MSYS 风格只有 spawn bash 能用。
- 无头浏览器脚本用 `playwright-core`（不是 `playwright`），放 `visual\_NN-ui.mjs`。

---

## 八、开工前基线（每棒开工先取真值，别抄文档）

```
HEAD / git status：开工实测（上夜终检 09-28 00:35 收官时工作区 0 条、十层全绿）
验证总数：09-27 终检实测 1388（十层）—— 之后数字持续漂移（scaffold 层 09-29 已 13→17），
          **以你开工时 verify:meta + 全量实测为准**，收尾对回去。
后端 3011：多半 DEAD，先探活。
```

---

## 九、终检棒职责（唯一不写新功能的一棒）

1. **等前棒**（最后一棒没交棒就等到硬停线，等待期间不碰任何文件）；收集状态目录全部文件。
2. **独立验证，不许只信状态文件**：全量构建 + 十层验证真跑；声称新建的文件逐个确认；**闸门/断言故意写坏一次确认真红**（优先验今晚新写、从未红过的）；四条路由真挂上导航、页面真渲染；数字真同步五处；memory 真写了；**git 真提交了、工作区干净**。
3. **差异清单**：逐棒点名「它说做了 vs 实际」。
4. **补漏**（优先级：仓库不可运行 > 验证挂红 > 数字不同步 > 文档缺失 > 状态文件缺失），**不补任何 30 min 以上的新功能**。
   **绝对不许**：为报告好看而改结论、把"没做"写成"做了"、删掉挂红的断言。
5. **产出 `REVIEW.md`**（写进本夜状态目录）：逐棒自述 vs 独立验证 + 差异清单 + 补了什么 + 剩余工作量（按离闭环距离排 P0/P1/P2，**每条带四字段**：位置 / 当前状态 / 离闭环还差什么 / 预估档位；需用户拍板的单独拎最前）。剩余清单是下一夜的输入。
6. 清理 `*-running` / `*-blocked`，只留 `*-done.json` 与 `REVIEW.md`；把 `.workbuddy\night-chain\LATEST` 改成本夜日期；用 `present_files` 呈现 REVIEW.md。
7. **硬停 07:55**。
