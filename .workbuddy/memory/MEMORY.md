# 军火库（arsenal）· 长期约定

个人代码规范字典 + AI 合规校验平台。三原则：①一份数据三种出口 ②Rule as Data ③写不出 bad/good 示例的不收录。不做：auto-fix、绑某家 AI、规则市场/多租户。上限单人 + 小团队（≤10）。
> 只留**仍在生效**的约定；过程见 `.workbuddy/memory/YYYY-MM-DD.md`；体检见 `docs/现状体检与开发计划-2026-09-22.md`、`docs/功能缺口清单-2026-09-22.md`。

## 口径

- 后端 `arsenal-server` Spring Boot 3.2.5 + Java 17 : **3011**；前端 `arsenal-web` Next.js 14 + TS + Tailwind : **3010**（`output:'export'` 纯静态）。
- 事实源全 Git 化：`arsenal-rules/**`（69 条）、`arsenal-cookbook/`（**1 条主线**：virtual-thread，**三层结构**，2026-09-24 晚重构）、`arsenal-cases/`（8 场景）、`arsenal-stacks/*.json`、`arsenal-profiles/`、`arsenal-icons/icons.json`。
- **案例库是三层**：**技术**（`TOPIC`：解决什么 / `pickWhen` 什么时候该选它 / `limits` 自身边界 / `family` 家族 / `references`）→ **场景**（`scenarios[]`：`when` + `signals[]` 可核对信号 + `notSuitable`）→ **方案**（`recipes[]`：flow / files / checklist / pitfalls / `lab` 实测 / `playground[]` 可运行示例）。路由 `/blueprints` → `/blueprints/[topic]` → `/blueprints/[topic]/[scenario]`；`BlueprintView` 只认扁平 `Feature`，由 `cookbook.ts` 的 `toFeature()` 合成视图，渲染器零改动。`BlueprintView.tsx` 已 git mv 到 `src/components/`。
- **L3 实测必须是真的**：`lab.kind=mock-endpoint` → 示例自己起 `HttpServer` 假下游 + `HttpClient` 真打（build/sync 都断言代码里必须有 `HttpServer`）；`kind=thread-local` → 必须有 `ThreadLocal`。⚠️ **pinning 不能做成在线实验**：synchronized 里阻塞真实 IO 会把 carrier 全部 pin 住，连「唤醒等锁的虚拟线程」都排不上 carrier —— 实测直接饿死超时（HttpClient 版、原生 socket 版都挂死）。pinning 只用代码 bad/good 对照讲。
- `playground[]` = 自包含可运行 main（`{id,label,mainClass,files:[{path,code}],note?}`）。这是案例库的第四种出口（人查 / 给 AI 用 / 拿代码验 / **能直接跑**）。加字段链路安全：`build_cookbook` 无字段白名单、`sync-content.mjs` 对 cookbook 未知字段透传。
- 严重度 MUST/NEVER/SHOULD/MAY（37/13/18/1），MUST+NEVER 硬上限 50 已满。规则字段名（勿臆造）：`title` / `rationale`（无 `description`）、`bad` / `good`、`check.{regex,ast,llm,manual}`；`check.llm` 是字符串，`check.ast` 是 `{engine,query}`。
- 选型台 **33 维 / 127 选项 / 6 预设 / 100 能力 / 21 策略 / 7 泳道**；`pipelines` 目前只有 `data` 一条 3 环。
- **装配台是六步向导**：① 项目定义 → ② 技术栈基底 → ③ 主题框架（左侧分组子导航）→ ④ 分层装配（顶部流水线选择器）→ ⑤ 部署形态 → ⑥ 交付（交付预览 / 组合产物双版面）。模型 `src/app/stack/wizard.ts`，面板 `src/app/stack/steps/`。
- 引擎真实覆盖：**前端 35/69**（纯正则）、**后端 42/69**（35 正则 + 7 AST）、**LLM 0/43**。非正则层一律 skipped，绝不伪造判定。前端引擎入口 `src/lib/engine.ts` 的 `lint(files, rules)`。
- 设计 token（tailwind.config.ts）：canvas #0B0F0E / surface #131917 / surfaceHi #1A2220 / surfaceMax #212B28 / line #243029 / lineHi #33413A / treeLine #3C4D45；fg #E8F0EC / fgMuted #93A39C / fgFaint #80918A / brass #D9A441 / olive #7FA650。组件类 `.panel` `.mono` `.grid-bg`(34px) `.stack-bench` `.stat-num`。装配台语义色只许 `src/app/stack/palette.ts` 的 TONE 五色。

## 硬约定（违反即出事故）

1. 改内容改 `tools/content/*.py`，**不改 JSON**：`python tools/build-content.py` → 产物 JSON；写 JSON 必须 `newline='\n'`。改完跑 `node scripts/sync-content.mjs`。规则 `arsenal-rules/**` 是手写源，不进管道。
2. `composeStack(picks)` 是纯函数；空槽位跳过、不回退默认。可运行性由 `provides`/`requires` 决定。
3. 隐患必须可核对：`trigger`/`symptoms`(≥2)/`impact`。架构结论三档不合并：跑不起来 / 能跑但零件不全 / 可以跑。
4. 产物必须「能跑」：不引用导出包没有的文件；端口/健康端点算出来不写死；zip 用 `testzip()` 验。
5. **断言写完反着验一次**；注入后先确认注入真打中了；还原用 `git checkout --` 或 `newline=''`（python 文本模式会翻 CRLF）。报错必须带实际值。
6. 页面契约两处：页签 id ↔ 渲染分支；导航项 ↔ 路由；`savePicksSnapshot` ↔ `loadPicksSnapshot`。源码当数据断言（`project-check.ts`，解析前先 `stripComments()`）。
7. 加一类文件型事实源要同时改四处：`sync-content.mjs` + 前端 resolver + `project-check.ts` + README 目录树。
8. **同一文件多处改动必须串行**（并行 Edit 静默丢改、tsc 仍 0 错）。加 prop/state 前 grep 同名声明；状态文案局部变量叫 `statusMeta`。
9. **改装配台前先 grep `.verify/project-check.ts` 对 `StackComposer.tsx` 的字符串断言**（`stack-bench` / TabId 三处一致 / `onSelect={focusDim}` / `loadSnapshot(` / `loadDrafts` / 目录树字面量 / `hist.record(`≥6）。这些是对**源码文本**断言，抽成新文件会让断言静默变红。
10. **加/改一层 verify 改五处**：`package.json` + `verify-all.mjs`(LAYERS) + `report.ts`(LAYER_NAMES) + `meta-check.ts`(CHAIN_ORDER) + 档案 `verifyChain`；另加 README 两处。
11. **加/删断言同步四处数字**：`arsenal-profiles/arsenal.json` 的 `verifyChain[*].count`、README 总数句、README 分项表，改完**必跑 sync-content.mjs**。漏了不静默：`finish()` 打「声明 X / 实测 Y」退出 1。
12. **分批提交两条 git 纪律（2026-09-25 夜跑实测，都真踩了）**：① 仓库里常有白天会话**预暂存**的删除/重命名，`git commit` 不带 pathspec 会把它们连坐进本批 —— 一律 `git add <路径>` + **`git commit -- <路径>`**，提交前看 `git diff --cached --stat` 只含本批；误提交了就 `git reset --soft HEAD~1` + `git reset HEAD -- <被连坐路径>` 复原（不动工作区）。② **目录级 pathspec 会夹带 `_*` 调试产物**（实测 `git add src/app/stack/steps` 把 `steps/_probe.tsx` 也请进索引）→ 逐文件 add，或 add 后 `git diff --cached --name-only | grep '/_'` 复核。`.workbuddy/_*` 有 gitignore 兜底，`src/**/_*` 没有。

## 校验与运行

- `npm run verify` 九层 = 35 架构 + 68 图交互 + **739** 结构导出（含【16】字段契约 252、【17】装配台视觉 24、【18】装配台交互 23）+ 33 场景 + 17 引擎样本 + 12 前后端一致 + 31 Archify + 69 代码扫描 + 12 视觉 = **1016**；cases 穷举守恒 9072 组。
- 【16】= 类型 ↔ 事实源**双向**比。cookbook 三层要**摊平**成三类记录分别比 `Topic` / `Scenario` / `Recipe`（`loadCookbook(level)`）；`references` 挂技术层、`flow/files/highlights` 挂方案层、`playground` 经技术层摊平校验。fileCount 等 sync 注入字段改对 `src/generated/*.json` 核。
- 【17】装配台 P1 呈现（三档宽度 208/172/148、分布 3/1/29 与 pipelines 互证、brass ring、字号四档 10/11/12/14）。分布数字钉死。【18】装配台交互（S1-4 连线开关默认关 / S1-5 ProgressRing 单份定义 / S2-7 去重）。
- **视觉层**判据 A1–A7 在 `visual/assert.mjs`（42 张 = 14 路由 × 3 视口）。⚠️ 断言 `out/` 不是源码 → 先 build；A5 不猜半透明背景、跳过 <12px 文字；`shoot.mjs` 不自起静态站。⚠️ 沙箱里 `verify:visual` 包装层 spawnSync EBUSY，直接 `node visual/assert.mjs` 可过。
- 汇总表「通过/跳过/失败」互斥三态，和 = 实测。⚠️ `.verify/**` 不在根 tsconfig → 改完必须实跑（`npm run typecheck:verify`）。⚠️ safe-delete 守卫按工具调用累计 ≥50 抛 → 九层别挤一个 turn；子进程给 `CODEBUDDY_SAFE_DELETE_ENABLED=0`。
- 后端：`SKIP_COMPILE=1 bash arsenal-server/scripts/run.sh`（JDK17 在 `C:/Users/Administrator/.jdks/corretto-17.0.12`）。**改规则必重启后端**。探活用 node fetch，别用 curl。接口：`/api/health` `/api/stats` `/api/rules`(`/grouped` `/sources` `/{id}`) `/api/export/*` `/api/lint` `/api/archify` `/api/scan/*` `/api/cases/run`（Java 源码 → JDK21 子进程）`/api/cases/jdk`。⚠️ `GlobalExceptionHandler` 把 404/405/415 吃成 500。

## 环境铁律

- bash 的 PATH 是坏的：每条命令前 `export PATH="/usr/bin:/bin:/c/Windows/System32:/c/Windows:$PATH"`；node 用 managed `…/node/versions/22.22.2-3`。
- **`next dev`/`build` 只许 `node scripts/next-run.mjs <cmd>`**；⚠️ 它**不跑 sync** → 改了事实源必须显式 sync 再 build。
- **Git Bash 下 `npm run` 会 exit 1**：用 `node "<node目录>/node_modules/npm/bin/npm-cli.js" run <script>` 或直接跑脚本本体。
- 后台进程用 `run_in_background=true`。无头浏览器一律 `visual/browser.mjs` 的 `launchBrowser()`；给浏览器用的静态站要在脚本里用 node `createServer` 自起；别用 `getByRole`/`text-is`。
- curl 是 Windows 程序：读写不了 `/tmp`、`/d/...`；给 node/python 的路径用 Windows 形式。
- ⚠️ 多会话并发：可能有夜跑链或另一会话在写。动文件前取两次 md5；它的绿不归你背书。

## 待推进

- **装配台下一步升级计划（2026-09-25 制定）** → `docs/开发计划-2026-09-25/装配台向导升级计划-2026-09-25.md`。⚠️ 两个关键结论：① **形态只预填不约束**（`StackComposer.tsx:573 applyShape` 只有 `presetPicks`，全仓无过滤逻辑）—— 用户「上一层确定下一层」只兑现拆分未兑现约束；② 层级约束**只能灰显不能隐藏**，否则【17】33 槽位分布 3/1/29 断言静默变红。P0=落袋 4 批 + `scopes?: string[]`（须可选，走 `tools/content/stack_*.py`）；P1=跨步骤摘要条 / ③减压 / 画布(S3-1) / 冲突文案；P2=评分卡(S3-2，分值不许编造) / 形态模板。P0-2 与 P2-1 需 mryang 拍板内容决策。（全部未提交，等 mryang 过目）

- **案例实验室**：后端 `com.arsenal.cases`（8 文件 + 两处接入）、前端 `CaseLab` 调 `/api/cases/run`（JDK21 子进程）。编码坑：javac 诊断 + JVM 控制台流都要 `sun.stdout/stderr.encoding=UTF-8`。⚠️ 曾**两份 CaseLab 并存**；09-26 已把 `src/components/CaseLab.tsx`(265) 改名 **`DemoRunner.tsx`**（C1-4），现在只剩 `src/app/cases/CaseLab.tsx`(909) 叫 CaseLab。**合并仍未做**（蓝图 C-7），别抢。⚠️ 实验依赖 3011，纯静态 `out/` 离线不可用。
- **装配台 UI 升级** `docs/开发计划-2026-09-23/装配台UI升级计划-2026-09-23.md`：P1/P2 全 ✅ + P3 的 S3-3/S3-4 ✅（三批均未提交）。**只剩 S3-1 画布 / S3-2 评分卡**（须改 `tools/content/stack*.py`）。
- **案例库升级计划** `docs/开发计划-2026-09-25/最佳实践案例库升级计划-2026-09-25.md`（2026-09-25 制定）：C-1 AI 出口 / C-2 代码自证 / C-3 规则互链 为 P1。
- **场景案例库升级计划** `docs/开发计划-2026-09-25/场景案例库升级计划-2026-09-25.md`（2026-09-25 制定）：P1=补 6 个 Java 日常场景（幂等/慢SQL/导出超时/分布式事务/文件上传/越权脱敏）+ 参数虚胖治理 + 症状墙筛选兜底 + 消同名陷阱；P2=可运行切片 / benchmark / 规则反查 / deep link；P3=模糊匹配 / A-B 对比 / 跨页互链。
  - ✅ **C1-2 参数虚胖治理已落地（09-26 夜跑第 2 棒）**：构建期断言「driver 必须被 `slices.when`/`conflicts`/`notSuitableFor` 之一引用」，否则 build 失败；`sensitivity` + `inert` 由 `build-content.py` 实测写进产物；前端参数卡标注「只影响告警 · 不改变命中切片 / ⚠ n/m / 影响面 NN%」；`.verify/case-check.ts`【14】三条守着（场景案例层 33 → 36，九层合计 **1027**）。
  - ⚠️ **实测（别重算，09-26 已修正）**：47 个 driver 里 **11 个 inert**（不被任何 `slices[].when` 引用 = 不改变命中切片）—— 其中 10 个参与 `conflicts`、1 个（`vt/lifespan`）参与 `notSuitableFor`。⚠️ 09-25 那版结论说「`vt/lifespan` 三处都不引用」是**错的**，它一直在 `virtual_thread.py` 的 `NOT_SUITABLE_FOR` 里。真孤儿当时只有 `msi/growth`（已补 conflicts）。另：benchmark 切片 **0**、`/rules` 对场景**零反查**、`app/cases/**` 无 URL 同步（结果不可分享）、切片代码不可运行。建议起手：虚胖治理（一晚、零内容成本）+ 先做「幂等」「慢 SQL」两个当样板。
  - ⚠️ **两个 CaseLab 不是重复文件**（09-26 已改名）：`app/cases/CaseLab.tsx`(909) = 症状分诊台；`components/DemoRunner.tsx`(265，原 `components/CaseLab.tsx`) = 蓝图页跑 `feature.playground` 的演示控制台（`BlueprintView.tsx:327` 消费）。C2-1 可运行切片可直接复用 `DemoRunner`。
- 场景案例 7 号 `multi-source-ingestion`、8 号 `virtual-thread` 已建未提交（8 场景 / 61 切片 / 175 锚点）。
- B0-3：4 个场景仍无 `benchmark`。`/cases` 默认参数 0 切片命中（产品决策，未动）。
- findings.md 还剩 ~14 条：P1 三条（archify 硬编码 localhost:3011、export PREVIEW 原始 Markdown + `<sub>` 泄漏、icons 89 vs 81）。63/81 位图图标缺失。
- 待人工决策：69 条规则逐条过目；5 条无检查器 AST 规则补/降级；`SVC-LAYR-003`；「性能与 JVM」「日志监控」两类未覆盖。
