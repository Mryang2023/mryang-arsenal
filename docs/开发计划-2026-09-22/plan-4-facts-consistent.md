# 计划 4 · 让事实一致（文档 · 数据源 · 跨端常量 · 清理）

> 归属：台账 D-1 … D-7 + 「severity 文案/token 除数」
> 波次：**Wave 2**（收口波次。必须等计划 1 的 A-4 定了项数口径、计划 2/3 定了代码事实）
> 唯一任务源就是本文。

---

## 〇、为什么是收口波次，而不是「顺手改文档」

体检文档把「文档纠偏」排在里程碑 2 / 优先级第 7。**这个排法是错的**，理由有三条：

1. **并行 agent 本身就是「下一个 AI」。** 如果 4 个 agent 同时启动，另 3 个会读到
   `README:379`「AST 层校验未完成」、`arsenal-profiles/arsenal.json` 的 `"L2 AST": {"status":"todo"}`
   → 从而重复评估已完成的工作，或按错误里程碑排期。
   （Wave 1 的提示词里已经直接注入事实绕开这一点，见 `00-index.md` §五）
2. **本计划要改两个总数**（README 的「662 项」、`verifyChain`），
   而这两个数字在计划 1 的 A-4 做完（项数由实测得出）之后才稳定。**反序做 = 返工。**
3. **本计划要改 `arsenal-profiles/arsenal.json`**，而它改完必须重跑 `sync-content.mjs`，
   否则 `src/generated/profiles.json` 过期 → 构建期炸在 import 或【14】契约红 ——
   如果计划 1 正在同时调 verify 链，这个红会跟它的红混在一起，**谁都不好排查**。

**做完这一份，下一个接手的人才不会被误导。**

---

## 一、任务清单

### D-1 文档全量纠偏（按 STALE CLAIMS A–E 逐条）

> 证据表在 `docs/功能缺口清单-2026-09-22.md` 的「文档与代码不一致」一节（A1–A9 / B1–B5 / C1–C2 / D1–D9 / E1–E4）。
> 逐条改，**改完在报告里逐条打勾**。

**A. AST 层「未做 / 等 JavaParser」**
| 位置 | 现在说 | 改成 |
|---|---|---|
| `README.md:379` | 「AST 层校验｜69 条里 20 条需要语法树判定，前端只跑正则层的 35 条」（列在**未完成**） | 拆成两句：**前端** 35 条（纯正则，刻意设计）；**后端已实现 15 条 AST**（`jdk.compiler`），覆盖率 50/69 |
| `docs/arsenal-runtime.architecture.json` 对应节点 | 若也有 AST 未做描述 | 同上（改完须重跑 Archify 生成 HTML，见下） |
| `arsenal-profiles/arsenal.json`（渲染在 `/arch` 上） | `"L2 AST": {"status":"todo"}`、`{{rules.astCapable}} 条待接入`、`JavaParser 查询已写进规则数据，引擎未做 —— 全部如实 skipped` | → **D-2** |
| `arsenal-web/src/app/page.tsx:430-437` | 进度卡 `doing` + 「AST 层校验（JavaParser）」 | → **计划 3 的 C-3**（本计划不碰 `arsenal-web/src`） |
| `arsenal-web/src/app/rules/[id]/page.tsx:180`、`CheckConsole.tsx:318`、`engine.ts:164,183` | JavaParser | → **C-3 / B-10**（不在本计划） |
| `arsenal-server/.../AstEngine.java:42`、`McpToolCatalog.java:53`、`exporters.ts:25` | JavaParser / 「由 F2 接入」 | → **B-10**（不在本计划） |

**B. MCP「未实现」**
| 位置 | 现在说 | 改成 |
|---|---|---|
| `README.md:377` | 「MCP Server 适配层｜**项目成败关键**」（列在**未完成**） | 移出「未完成」；新增一节说明「已可用的 stdio 服务器 + 怎么接」，链接 `docs/mcp-setup.md`（计划 3 的 C-4 产出） |
| `docs/arsenal-runtime.architecture.json:27` | 「MCP 适配层尚未实现，那是让 AI 主动来查规范的关键一步。」 | 「MCP 适配层已可用（stdio），是把规范主动喂给 AI 的关键通道。」 |
| 同上 `:44` | `{"id":"mcp","label":"MCP 适配层","sublabel":"尚未实现","tag":"项目成败关键"}` | `sublabel` → `已可用（stdio）`；必要时改 `tag` |

⚠️ 改完 `arsenal-runtime.architecture.json` **必须重跑 Archify 生成 `arsenal-runtime.html`**
（两个文件是一对：JSON 是 source of truth，HTML 是确定性编译产物，**两者都进 Git**）。
工具与步骤见 `docs/README.md`（技能 ID `wrench-ai`，**不要走 `npx skills add`** —— 本机 github git 协议不通）。

**C. 「后端只读规则集」**
| 位置 | 现在说 | 改成 |
|---|---|---|
| `README.md:378` | 「后端已能出图（`/api/archify`）与校验（`/api/lint`），但装配台、蓝图、案例库仍只在前端算」 | 后半句属实保留；**前半句低估后端** —— 补 `GET /api/export/{format}`（6 种载体）、`POST /api/scan/{facts,upload}`、`GET /api/scan/rules` 等 |
| `杨先生的军火库-蓝图库与选型台-v0.1.md:368`、`arsenal-profiles/arsenal.json` 的「装配台 / 蓝图接后端 API」 | 「后端 `arsenal-server` 目前只读规则集」 | 后端 49 个类，含完整 scan / exporter / archify / lint。真正只在前端的是**装配台 / 蓝图 / 案例库** |

**D. 计数类过期**（**全部重新数，不许照抄任何一份文档的数字**）
| 位置 | 现在说 | 实测口径 |
|---|---|---|
| `杨先生的军火库-蓝图库与选型台-v0.1.md:370` | 62 条 / 32 AST / 30 正则 | **69 / 20 / 35** |
| 同上 `:347-348` | 17 模块 / 42 选项 / 4 预设 / 27 能力 / 16 策略 / 6 层 | **33 维 / 127 选项 / 6 预设 / 100 能力 / 21 策略 / 7 泳道** |
| 同上 `:352` | 20 目录 / 56 文件节点 | **未复核** —— 本计划必须实际数列后再写，数不出来就删掉这行 |
| `arsenal-rules/README.md:92,94` | 规则总数 **62**、建议级（SHOULD）**12** | **69 / 18**（MUST 37 + NEVER 13 + SHOULD 18 + MAY 1） |
| `杨先生的军火库-规则基线-v0.1.md:230` | 「你过一遍 **62 条**清单」 | 69 |
| `README.md:198` | 「`compile-check.sh` —— **26 源文件 → 41 class**」 | `src/main/java` 下实测 **49 个 `.java`**；`target/classes` 的 41 class **停在 09-11 未重编**。本计划要给出**重新编译后的**准确数字（源文件数 / 顶层 class 数 / 含内部类的 class 数），并注明区分 |
| `README.md:233` | 「一条命令跑完八层、共 **662 项**」 | 662 **是手写常量**。与计划 1 的 A-4 对齐：改成「662 项（其中 N 项为刻意未跑 / M 项因缺依赖跳过）」 |
| `arsenal-web/.verify/project-check.ts:509,512,517` | 注释里 628 与 662 并存 | → **计划 1 的 A-4**（不在本计划） |
| `杨先生的军火库-规则基线-v0.1.md:228-233` | §6「下一步」四步中第 2/3/4 步（搭 server 骨架 + 规则加载管线、前端三页、校验引擎 Level 1）**全部已完成**却仍列为待办 | 标注完成；只留真实待办（`:219` 的 `SVC-LAYR-003`） |

**E. 其他**
| 位置 | 现在说 | 改成 |
|---|---|---|
| `arsenal-web/src/app/page.tsx:366` | 「语义判定层（LLM）覆盖 {{rules.llmCapable}} 条」暗示已覆盖 | → **计划 3 的 C-3**（口径与 `arsenal.json` 的「L3 未启动」统一） |
| `docs/README.md` | 「**哪些能力还没做**（MCP 适配层）。未完成的部件用虚线画出，不做任何『已具备』的暗示」 | 改这一句（MCP 已可用）；并把 `docs/开发计划-2026-09-22/` 登记进该索引 |
| `docs/hy4-night-plans/{00-index,REMAINING-PLAN,NIGHT-RUN}.md` | 自称「剩余计划」 | **不删**，顶部加一段「**已归档**：本文写于 2026-09-22 10:20 前，其中 P0-1（`topology.ts` 类型错）与 P0-2（构建）已在同日修掉；现行计划见 `docs/开发计划-2026-09-22/`」 |
| `code-review-2026-09-19.md`、`code-review-2026-09-20.md`、`function-review-2026-09-19.md`、`function-review-2026-09-20.md`（仓库根） | 修复队列，可能已部分关闭 | 逐条核对状态，未关闭的搬进 `docs/开发计划-2026-09-22/`（新建 `backlog.md`）或就地标注状态；已全关的加顶部结论 |

**验收**：
```bash
# 1. JavaParser 只剩「我们不用」的说明
grep -rn "JavaParser" --include=*.md --include=*.json . | grep -v node_modules
# 2. 过期计数全清
grep -rn "62 条\|62 源文件\|26 源文件\|41 class\|17 模块\|42 选项\|4 预设\|27 项能力\|16 条组合策略\|6 层架构画布\|17 个槽位" \
  README.md docs/*.md 杨先生的军火库-*.md arsenal-rules/README.md
# 3. Archify 产物与源同步
node -e "..."   # 或按 docs/README.md 的命令重跑，产物 mtime 必须晚于 json
```
- **反向验证**：随便挑一条改过的计数，用 `node -e` 重新数一次，必须与文档一致（证明不是照抄的）。

---

### D-2 项目档案数据纠偏（`arsenal-profiles/arsenal.json`）

**本计划拥有该文件除 `project.verifyChain` 之外的全部字段**（那个数组归计划 1 的 A-4）。

| 位置 | 现在说 | 改成 |
|---|---|---|
| `:376-381` `"L2 AST"` | `status:"todo"`、`metric:"{{rules.astCapable}} 条待接入"`、`desc:"JavaParser 查询已写进规则数据，引擎未做 —— 全部如实 skipped"` | `status:"done"`；`metric` 改为**已实现的 15 条**（如 `15 / {{rules.astCapable}} 条已接入`）；`desc` 说明用 `jdk.compiler`、以及 5 条因依赖类型解析而如实 skipped |
| `:383-387` `"L3 LLM 语义"` | `status:"todo"`、`metric:"未启动"` | **保持 todo —— 这一处本来是对的**（`llm` 层确实 0 条执行）。只统一措辞，与 `page.tsx` 对齐 |
| `:486` 附近「装配台 / 蓝图接后端 API」 | `desc:"前端已完整可用，后端目前只读规则集"` | 见 D-1 的 C 类 |
| `:490-493`「AST 引擎层」 | `desc:"JavaParser，{{rules.astCapable}} 条 ast 规则已备好数据"`、`tone:"next"` | 解析器名改 `jdk.compiler`；`tone` 按实际进度调整（若已 done 则移出 roadmap） |
| `:504-507`「结构层 2 条规则缺口」 | `desc:"界面如实标注，不挂假 id，补不补待定"` | **保持不变**（措辞正确）；在 D-7 的决策清单里给它一个明确的「待 mryang 拍板」条目 |

⚠️ **改完必须 `node scripts/sync-content.mjs`**（`VERIFY_TOTAL` / `VERIFY_CHAIN` 都来自
`src/generated/profiles.json`）。忘了这一步的症状是「构建期炸在 import」或【14】契约红，**看着像随机故障**。

⚠️ `/arch` 页有一个 token 机制：**能算的数字不许手抄**，档案里出现阿拉伯数字的 `metric`
必须写成 `{{rules.total}}` 这类 token，由 `arch-profile.ts` 的 `buildMetrics()` 解。
改 `metric` 时若要用新 token，**必须先在 `buildMetrics()` 里登记**。

**验收**：
- `node scripts/sync-content.mjs` 通过（锚点/交叉校验失败会直接中断）
- `npm run verify:project` 全绿，尤其【14】项目档案 9 条（文件名=id、六视图齐、token 全可解、
  数字必须来自 token、文案不许写回代码、渲染器只引类型、五张图都收到 data、清单同源）
- `/arch` 页截图：AST 卡片不再是 `todo`；切换项目档案选择器仍正常

---

### D-3 规则数据纠偏：`check.ast.engine` 20 处（**本次审查新发现的漏项**）

**实测**：`arsenal-rules/**/*.json` 里 **20/20** 条含 `check.ast` 的规则，`engine` 字段全是 `"javaparser"`：
```json
{"engine":"javaparser","query":"objectCreation of java.lang.Thread"}
```
而实现用的是 **JDK 自带的 `jdk.compiler`**（`AstEngine.java:34-36` 明写「**零新增依赖，不需要 JavaParser**」），
`Rule.AstCheck.engineOrDefault()`（`Rule.java:84-86`）的默认值也是 `"javaparser"`。

**两份审计文档的 JavaParser 纠偏清单里没有这一条** —— 只列了 README / UI / 注释。
→ 只改 UI 不改数据，下一个人读规则 JSON 还是会看到 javaparser。

**做**：
1. 20 处 `"engine": "javaparser"` → 与实现一致。**先与计划 2 的 B-10 确认取值**
   （B-10 会改 `engineOrDefault()` 的默认值）。两个选择：
   - `"jdk.compiler"`（指名实现，最直白）
   - `"javac"` / `"ast"`（引擎中立，未来换实现不用再改数据）
   **倾向后者**（引擎中立），但这要由计划 2 的 B-10 定，**两边必须同批改**。
2. 顺带核对 `arsenal-rules/meta.json`：它的 `budget` 已经是 `totalCurrent: 69 / mustCurrent: 50`，
   `severityPolicy` 文案与 `theme.ts` / `ExporterService.meaningOf()` 语义一致 —— **这一份是对的先例**，
   D-4 会考虑直接复用它。
3. ⚠️ **改规则文件后必须重启后端**（`RuleLoader` 启动时一次性载入，不重启时 `/api/stats` 一脸正常地报旧值）。

**验收**：
```bash
node -e "
const fs=require('fs'),path=require('path');let s=new Set();
(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);
 if(e.isDirectory())w(p);else if(e.name.endsWith('.json')&&e.name!=='mcp-tools.json'){
  try{const j=JSON.parse(fs.readFileSync(p,'utf8'));const l=Array.isArray(j)?j:j.rules;
   if(Array.isArray(l))l.forEach(r=>r.check&&r.check.ast&&s.add(r.check.ast.engine));}catch(e){}}}})('arsenal-rules');
console.log([...s]);"
# 期望：只有一个值
```
- 重启后端后 `GET /api/rules/{id}` 返回的 `check.ast.engine` 正确。
- **反向验证**：把某一条改回 `javaparser` → 上面的脚本应打印两个值（证明脚本真的在数）。

---

### D-4 severity 文案与 token 除数数据化（消灭同构重复）

**（a）severity 文案 —— 逐字重复、无守卫**
- `arsenal-web/src/lib/theme.ts:42-45` 的 `meaning`：
  `MUST: '硬约束。违反必修，计入合规分。'` / `NEVER: '明令禁止。与强制同级阻断。'` /
  `SHOULD: '强烈建议。违反不计分，报告中列出。'` / `MAY: '可选风格。仅作提示词参考，不参与校验。'`
- `arsenal-server/.../exporter/ExporterService.java:512-518` 的 `meaningOf()`：**逐字相同**的四句。
- 分类文案**有**守卫（`parity-check.ts:64-87` 逐字段断言），**severity 这条同构重复却没有**。
- **有一个现成的数据源**：`arsenal-rules/meta.json` 的 `severityPolicy` 已有四句语义相近的文本
  （`MUST: "硬约束。违反必修，计入合规分。总数硬上限 50 条——超过说明规范已超出人能记住的量。"`）。
  **先判断是否可复用**：若前 4 句的主干一致 → 提为数据并让三处共读；
  若语义不同（meta 那句多了「硬上限 50」的说明）→ 新增一个 `severityMeaning` 字段，**别硬合并**。

**（b）token 除数 —— 三个数字打架**
| 位置 | 值 | 备注 |
|---|---|---|
| `arsenal-web/scripts/sync-rules.mjs:176` | `/ 1.6` | 注释「中文约 1.6 字符/token」 |
| `arsenal-web/src/lib/exporters.ts:540` | 注释写 **1.6** | **注释与下一行代码自相矛盾** |
| `arsenal-web/src/lib/exporters.ts:541` | `/ 2.4` | 注释说「取保守混合值」 |
| `arsenal-server/.../ExporterService.java:538-540` | `/ 2.4f` | 无注释 |

→ 同一内容在**规则页**与**导出中心**显示的「≈ tokens」**差一半**。

**做**：
1. **定一个除数**（建议 2.4 —— 它同时被前后端两份导出器使用，改动面最小；
   但要在选它的理由里写清「保守混合值」的实测依据，不要只因为「多数派」）。
2. 提为**唯一数据源**（建议放 `arsenal-rules/meta.json` 的新字段，或 `arsenal-rules/_spec/`，
   与计划 2 的 `lint-semantics.json` 同目录更整齐 —— **需与计划 2 协调**，因为它 owns `_spec/`）。
3. 四处共读：`sync-rules.mjs`、`exporters.ts`、`ExporterService.java`，并**修掉 `exporters.ts:540` 的自相矛盾注释**。
4. 补守卫：给 severity 文案与 token 除数加 `parity-check.ts` 式逐字段断言
   （分类文案已经有，照它的形状写）。
   ⚠️ `arsenal-web/.verify/parity-check.ts` 归**计划 1** —— 本计划对它的编辑**只允许新增这两组断言**，
   不许改别的。若计划 1 的 A-4 加了 `report.ts`，断言请用 `report.ts` 的 `check()`。

**验收**：
- 改 `theme.ts` 的 `meaning` → `ExporterService` 的导出内容**同步变化**（或 parity 断言直接红）。
  贴出「改一处、另一端跟着变」的证据。
- 同一份内容在规则页与导出中心显示的 `≈ tokens` **数字相等**（贴两个数字）。
- **反向验证**：把 token 除数改回 1.6（只改一处）→ parity 断言必须红。

---

### D-5 清理

| 项 | 处理 | 注意 |
|---|---|---|
| `.verify/audit-check.mts`（与 `audit-check.ts` SHA256 完全相同） | 删除 | **计划 1 的 A-8 已负责**，若已删则跳过 |
| `arsenal-rules/README.md` 自身过期（`:92` 62 / `:94` SHOULD 12） | → D-1 |
| 死常量 `ScanNote.java:33 UNSAFE_PATH` | 计划 2 的 B-8 会把它用起来 | 先确认，避免重复处理 |
| 死常量 `mcp-stdio.mjs:34 SEVERITY_PENALTY` | 计划 2 的 B-2 会用上 | 同上 |
| 未用导出 `zip.ts:91 buildZip`（唯一调用者同文件） | 计划 1 的 A-zip 会把它变成 CaseLab 的调用目标 | 同上 |
| 未用导出 `engine.ts:71 globToRegExp`（唯一调用者同文件） | 保留（B-9 可能要用），或在 B-9 落地后确认 | 不在本计划 |
| `package.json` 的 `"lint": "next lint"` | devDependencies **无 eslint / eslint-config-next**、无 `.eslintrc*`，且 `next.config.mjs:21` 设了 `eslint.ignoreDuringBuilds: true` → **这脚本根本跑不起来** | `package.json` 归计划 1 → **请计划 1 代删**（本计划只提供理由），或本计划在所有权表里破例改这一行 |
| `.audit/`（41 文件 / 103KB，含本轮并发会话的 `join-test.ts`、`topology.fixed.ts`、`t7.mjs`） | 清理 | 确认里面没有还要用的东西（`topology.fixed.ts` 看起来是并发会话的中间产物） |
| `.verify/tmp/`（20039 个文件） | 计划 1 的 A-8 负责脚本化清理 | 不在本计划 |
| `arsenal-cookbook/*.json` 磁盘 CRLF / Git blob LF | `git add --renormalize arsenal-cookbook` | `.gitattributes` 的 clean filter 已归一，所以 `git status` 是干净的 —— **今天无影响，但「同一 commit 不同字节」** |
| `arsenal-web/_tsc_out.txt`、`.workbuddy/_*` | 计划 3 的 C-7 | 不在本计划 |

**验收**：`git status` 除预期改动外 clean；`git ls-files --eol arsenal-cookbook` 全是 `lf`；
`grep -rn "next lint" package.json README.md` 的结果与处置一致。

---

### D-6 位图图标进度记账（**不做生图**）

**现状**：矢量图标 **81/81 已完成**（不阻塞任何功能）；位图 `arsenal-web/public/icons` 实测 **18 个文件 / 866.9 KB**
（9 类各 2 张），**欠 63 张**，需生图额度（REMAINING-PLAN 估算 ≈ 315–630 credits）。

**做**：把「18/81、欠 63 张、需额度」写进 README 的进度表与 `arsenal-profiles/arsenal.json` 的对应 metric
（用 token，不许手抄）。**不生图** —— 那需要 mryang 授权额度，属 D-7 的决策清单。

**验收**：`node -e` 数 `public/icons` 文件数与文档数字一致。

---

### D-7 人工决策清单（**本任务的交付物是「清单」，不是实现**）

**做**：新建 `docs/待人工决策-2026-09-22.md`，包含四块：

1. **69 条规则逐条过目表**（`arsenal.json` 自认「没过目就不算军火库」）
   表格列：`id | severity | category | 一句话 | 待标记（同意 / 改 / 删） | 备注`。
   **69 行，一行不少**（`node -e` 从 `arsenal-rules/**` 直接生成表格骨架，不许手写漏行）。
2. **5 条无检查器的 AST 规则的处置**（`COL-CODE-002` / `CONC-THRD-002` / `REL-LOG-003` / `SEC-LOG-001` / `SKEL-STRC-002`）
   - 每条的**依赖能力**（类型解析 / 跨文件符号表 / 控制流）与 `AstEngine.java:38-42` 划出的边界；
   - 三个选项及代价：**补**（要新增符号表能力，等于做一个新引擎）/ **降级为「人工 + LLM」** / **留 skipped**；
   - ⚠️ **明确写清口径**：`AstEngine.java:38-42` 说这是**刻意划出的边界，不是 bug**；
     而缺口清单把它们排在第 6 位当「缺口」。**这两个结论冲突，需要 mryang 拍板哪个口径对外**。
   - 注意：其中 4 条同时有 `llm` 兜底，**只有 `COL-CODE-002` 是纯 `ast`**（没有任何自动化路径）。
3. **`SVC-LAYR-003`**（`规则基线-v0.1.md:219`）：Service 是否拆接口/实现的三个方案与代价。
4. **未覆盖类别**（`规则基线-v0.1.md:222`）：「性能与 JVM」「日志采集与监控大盘」的候选规则草案
   （先给草稿，不要写进 `arsenal-rules/`，避免污染 MUST+NEVER 已满的 50 条上限）。
5. **63 张位图生图额度**：给一个分批方案与预估 credits。
6. **`noUncheckedIndexedAccess` 是否开启**：由计划 1 的 A-1 给出实测错误数，这里记账为待决项。

**验收**：文件存在；**条目数 = 69**（`grep -c '^| ' | ...` 可核对）；每条都可勾选。

---

## 二、文件所有权

**允许改**（白名单）：
```
README.md
根目录 *.md（杨先生的军火库-*.md、code-review-*.md、function-review-*.md）
docs/**                              （除 docs/mcp-setup.md，那是计划 3 的）
arsenal-profiles/arsenal.json        （**除 project.verifyChain 数组**）
arsenal-rules/**                     （**除 _spec/**；仅 check.ast.engine 字段 + README.md + meta.json）
arsenal-cookbook/**                  （仅 git renormalize，不改内容）
arsenal-web/.verify/parity-check.ts  （**仅新增 severity 文案 / token 除数两组断言**）
arsenal-web/package.json             （**仅删 `lint` 一行**，且仅在计划 1 未处理时）
.audit/**                            （清理）
.gitattributes                       （仅在确需时）
```

**禁止改**（黑名单）：
```
arsenal-server/**                    → 计划 2
arsenal-web/src/**                   → 计划 3（除 engine.ts 归计划 2）
arsenal-web/.verify/**（除 parity-check 的一处）
arsenal-web/package.json（除 lint 一行）
arsenal-web/scripts/**
arsenal-rules/_spec/**               → 计划 2
docs/mcp-setup.md                    → 计划 3
```

⚠️ **本计划是唯一被允许改 `arsenal-profiles/arsenal.json` 与 `README.md` 的计划**（计划 1 只碰 verifyChain 一个数组、
只在「一条命令跑完」那一段碰 README）—— 而且本计划在 **Wave 2**，所以天然串行。

---

## 三、验收出口

1. 三条 `grep` 命令的输出（JavaParser / 过期计数 / Archify 产物时间戳）
2. `node scripts/sync-content.mjs` 通过 + `npm run verify:project` 全绿（贴【14】那几行）
3. `check.ast.engine` 取值集合的输出（期望只有一个值）+ 重启后端后的 `/api/rules/{id}` 片段
4. 「改一处 severity 文案、另一端跟着变」的证据 + token 数相等的两个数字
5. `git status` / `git ls-files --eol arsenal-cookbook` 的输出
6. `docs/待人工决策-2026-09-22.md`（条目数 69 的核对命令 + 结果）
7. **未完成项单列**：哪几条 STALE CLAIM 因为归别的计划而没做（逐条写明「归计划 N 的 X 任务」）

---

## 四、风险与注意事项

| 风险 | 说明 | 对策 |
|---|---|---|
| 忘跑 `sync-content.mjs` | `src/generated/profiles.json` 过期 → 构建期炸在 import 或【14】契约红，**看着像随机故障** | 改档案后立刻跑；把它当「改档案」这个动作的一部分 |
| 档案 metric 手抄数字 | `/arch` 页有一条硬约定：能算的数字必须走 token | 新增 token 要先在 `arch-profile.ts` 的 `buildMetrics()` 登记；扫描未知 token 时会**跳过 `note`**（写给人看的说明允许引述 token 语法） |
| Archify 产物不同步 | `docs/*.html` 是 `*.json` 的编译产物，**两个都进 Git** | 改完 JSON 必须重跑生成；工具装法见 `docs/README.md`（github git 协议不通，走推荐市场） |
| 改规则文件不重启后端 | `RuleLoader` 启动时一次性载入，不重启时 `/api/stats` 一脸正常地报旧值 | 改 `arsenal-rules/**` 后重启 |
| 改动面最广 | 本计划同时动文档 + 档案数据 + 规则数据 + 跨端常量 | 按 D-1…D-7 顺序做，每做完一块跑一次 `sync` + 相关 verify 层，别攒到最后 |
| 与计划 2 抢 `_spec/` | D-4 想把 token 除数放 `_spec/`，而那目录归计划 2 | 先协调；协调不成则放 `meta.json`（本计划 owns） |
| 多会话并发 | 同仓库可能有夜跑链在写 | 动手前取两次 md5；它的绿不归你背书 |
