# 军火库（arsenal）· 长期约定

个人代码规范字典 + AI 合规校验平台。三原则：①一份数据三种出口 ②Rule as Data ③写不出 bad/good 示例的不收录。不做：auto-fix、绑某家 AI、规则市场/多租户。上限单人 + 小团队（≤10）。
> 只留**仍在生效**的约定；过程见 `.workbuddy/memory/YYYY-MM-DD.md`；体检见 `docs/现状体检与开发计划-2026-09-22.md`、`docs/功能缺口清单-2026-09-22.md`；计划见 `docs/开发计划-*/`。

## 口径

- 后端 `arsenal-server` Spring Boot 3.2.5 + Java 17 : **3011**；前端 `arsenal-web` Next.js 14 + TS + Tailwind : **3010**（`output:'export'` 纯静态）。
- 事实源全 Git 化：`arsenal-rules/**`（69 条：MUST37/NEVER13/SHOULD18/MAY1）、`arsenal-cookbook/`（1 主线 virtual-thread）、`arsenal-cases/`（8 场景 / 61 切片 / 32 症状 / 175 锚点）、`arsenal-stacks/*.json`、`arsenal-profiles/`、`arsenal-icons/icons.json`。
- **案例库三层**：**技术**（`TOPIC`：`intent≥30` / `pickWhen≥2` / `limits≥2` / `references≥2` / `family` / `glyph`）→ **场景**（`when≥30` + `signals≥2` + `notSuitable≥2` + `decision`）→ **方案**（`approach` / `flow` / `files`(highlights≥2) / `checklist≥3` / `pitfalls≥2` / `lab` / `playground`）。路由 `/blueprints` → `/blueprints/[topic]` → `/blueprints/[topic]/[scenario]`（**动态路由，加主线不用改前端**）；`BlueprintView` 只认扁平 `Feature`，由 `cookbook.ts` 的 `toFeature()` 合成。
- **L3 实测必须是真的**：`lab.kind=mock-endpoint` → 入口必须有 `HttpServer` + `main`；`kind=thread-local` → 必须有 `ThreadLocal`。⚠️ **pinning 不能做在线实验**（synchronized 里阻塞真 IO 会饿死 carrier，实测挂死），只做代码对照。⚠️ `playground[]` 必须**纯 JDK**：后端 `CaseRunnerService` 直接 javac、**无 classpath**；`files[]` 可以是 Spring 版。
- `playground[]` = 自包含可运行 main（`{id,label,mainClass,files:[{path,code}],note?}`）。加字段链路安全：`build_cookbook` 无字段白名单、`sync-content.mjs` 透传未知字段。
- 规则字段名（勿臆造）：`title` / `rationale`（无 `description`）/`bad`/`good`/`check.{regex,ast,llm,manual}`；`check.llm` 是字符串，`check.ast` 是 `{engine,query}`。
- 选型台 **33 维 / 127 选项 / 6 预设 / 100 能力 / 21 策略 / 7 泳道**；`pipelines` 只有 `data` 一条 3 环。**装配台六步向导**：项目定义 → 技术栈基底 → 主题框架 → 分层装配 → 部署形态 → 交付；模型 `src/app/stack/wizard.ts`、面板 `src/app/stack/steps/`。⚠️ 形态**只预填不约束**（`applyShape` 只有 `presetPicks`，全仓无过滤逻辑）。
- 引擎真实覆盖：**前端 35/69**（正则）、**后端 42/69**（35 正则 + 7 AST）、**LLM 0/43**。非正则层一律 skipped，绝不伪造。入口 `src/lib/engine.ts` 的 `lint(files, rules)`。
- 设计 token（tailwind.config.ts）：canvas #0B0F0E / surface #131917 / surfaceHi #1A2220 / surfaceMax #212B28 / line #243029 / lineHi #33413A / treeLine #3C4D45；fg #E8F0EC / fgMuted #93A39C / fgFaint #80918A / brass #D9A441 / olive #7FA650。组件类 `.panel` `.mono` `.grid-bg`(34px) `.stack-bench` `.stat-num`。装配台语义色只许 `src/app/stack/palette.ts` 的 TONE 五色。

## 硬约定（违反即出事故）

1. 改内容改 `tools/content/*.py`，**不改 JSON**：`python tools/build-content.py` → 产物 JSON（必须 `newline='\n'`）→ `node arsenal-web/scripts/sync-content.mjs`。规则 `arsenal-rules/**` 手写、不进管道。**加 cookbook 主线**：`COOKBOOK_MODULES`（build-content.py:79）加一行 + 新 `tools/content/<id>.py` + README（漏了静默不生成）。**加 case 场景**：`CASES_MODULES`(:40) 加一行，同。
2. `composeStack(picks)` 纯函数；空槽位跳过不回退。隐患必须可核对：`trigger` / `symptoms`(≥2) / `impact`；架构结论三档不合并。产物必须能跑：不引用包外文件、端口算出来、zip 用 `testzip()` 验。
3. **断言写完反着验一次**（注入 → 确认真打中 → 必须红 → 还原 → 必须绿）。**注入前先把文件 `cp` 到 `.verify/tmp/`**，还原用 cp 回来；`git checkout --` 回的是 HEAD，会抹掉本棒未提交的改动（09-26 真丢过）。
4. 页面契约两处：页签 id ↔ 渲染分支；导航项 ↔ 路由。源码当数据断言（`project-check.ts`，解析前先 `stripComments()`）。加一类文件型事实源要同时改四处：`sync-content.mjs` + 前端 resolver + `project-check.ts` + README 目录树。
5. **同一文件多处改动必须串行**（并行 Edit 静默丢改、tsc 仍 0 错）。加 prop/state 前 grep 同名声明；状态文案局部变量叫 `statusMeta`。
6. **改装配台前先 grep `.verify/project-check.ts` 对 `StackComposer.tsx` 的字符串断言**（`stack-bench` / TabId 三处一致 / `onSelect={focusDim}` / `loadSnapshot(` / `loadDrafts` / 目录树字面量 / `hist.record(`≥6）—— 对**源码文本**断言，抽新文件会让断言变红。
7. **加/改一层 verify 改五处**：`package.json` + `verify-all.mjs`(LAYERS:55) + `.verify/lib/report.ts`(LAYER_NAMES:69) + `meta-check.ts`(CHAIN_ORDER:62) + `arsenal-profiles/arsenal.json` 的 `project.verifyChain`；另加 README 两处。
8. **加/删断言同步四处数字**：上述 `verifyChain[*].count`、README 总数句、README 分项表、跑 sync。漏了不静默：`finish()` 打「声明 X / 实测 Y」退出 1。⚠️ README 正文散文里的口径由 `project-check`【21】守着（`\d{3,4}\s*项(?!选)` 与 `\d{3,4}\s*的口径`，跳过代码块、排除「选项」）。
9. **分批提交两条 git 纪律**：① 一律 `git add <路径>` + `git commit -- <路径>`（仓库常有别会话预暂存的删除/重命名会被连坐），提交前核对 `git diff --cached --stat`；误提交就 `git reset --soft HEAD~1` + `git reset HEAD -- <路径>`。② 目录级 pathspec 会夹带 `_*` 调试产物 → 逐文件 add，或 add 后 `git diff --cached --name-only | grep '/_'` 复核。
10. **`recipes[].files[].code` 只放 good 版**（bad 写进 `pitfalls` / 规则自身对照）。理由：正则引擎分不出「演示错写法」与「这就是错的」，files 混 bad 就误报。三处登记：`src/lib/cookbook-lint.ts` + `build_cookbook()` + 本条；【19】⑪ 守着。
11. **子串包含型判据会静默失效**（出过两次）。`src.includes('stack-bench')` 对 `stack-benchBROKEN` 全绿 → 切成 token 后要求**恰好相等**，并跑两种反例。
12. 案例代码自证：`cookbook-lint.ts` 把 `files[]` 喂 `engine.lint()`（**必须用 `file.path` 作 `SourceFile.name`**，否则 `targetGlob` 规则静默不适用），产三档：违规 / 可执行 35 / 未判 34（如实披露）。徽标 `src/components/BlueprintSelfCheck.tsx`，数字一律算出来。

## 校验与运行

- `npm run verify` 九层 = 35 架构 + 68 图交互 + **763** 结构导出（【16】字段契约 252 /【17】装配台视觉 24 /【18】交互 23 /【19】案例自证 11 /【20】互链 4 /【21】README 口径 1）+ 36 场景 + 17 引擎 + 12 前后端 + 31 Archify + 69 扫描 + 12 视觉 = **1043**（09-26 实测）。cases 穷举守恒 9072 组。
- 【16】类型 ↔ 事实源**双向**比：cookbook 三层**摊平**成 Topic/Scenario/Recipe 三类分别比（`loadCookbook(level)`）；`references` 挂技术层、`flow/files/highlights` 挂方案层、`playground` 经技术层摊平。fileCount 等 sync 注入字段对 `src/generated/*.json` 核。
- 【17】三档宽度 208/172/148、分布 3/1/29、brass ring、字号 10/11/12/14（数字钉死）。【18】S1-4 默认关 / S1-5 单份 ProgressRing / S2-7 去重。
- **视觉层** A1–A7 在 `visual/assert.mjs`（42 张 = 14 路由 × 3 视口）。⚠️ 断言 `out/` → 先 build；A5 跳过 <12px 文字；`shoot.mjs` 不自起站；沙箱里直接 `node visual/assert.mjs`。
- ⚠️ `.verify/**` 不在根 tsconfig → 改完必须 `npm run typecheck:verify`。⚠️ safe-delete 守卫按工具调用累计 ≥50 抛 → 九层别挤一个 turn；子进程给 `CODEBUDDY_SAFE_DELETE_ENABLED=0`。
- 后端：`SKIP_COMPILE=1 bash arsenal-server/scripts/run.sh`（JDK17 在 `C:/Users/Administrator/.jdks/corretto-17.0.12`）。**改规则必重启**。探活用 node fetch，别用 curl。接口：`/api/health` `/api/stats` `/api/rules`(`/grouped` `/sources` `/{id}`) `/api/export/*` `/api/lint` `/api/archify` `/api/scan/*` `/api/cases/run`（JDK21 子进程，无 classpath）`/api/cases/jdk`。⚠️ `GlobalExceptionHandler` 把 404/405/415 吃成 500。

## 环境铁律

- bash 的 PATH 是坏的：每条命令前 `export PATH="/usr/bin:/bin:/c/Windows/System32:/c/Windows:$PATH"`；node 用 managed `…/node/versions/22.22.2-3`。
- **`next dev`/`build` 只许 `node arsenal-web/scripts/next-run.mjs <cmd>`**；⚠️ 它**不跑 sync** → 改事实源必须显式 sync 再 build。
- **Git Bash 下 `npm run` 会 exit 1**：用 `node "<node目录>/node_modules/npm/bin/npm-cli.js" run <script>` 或直跑脚本本体。
- **`next.config.mjs:19 trailingSlash: true`**：静态导出必须带尾斜杠（否则 `out/` 子路径路由在静态托管下 404）；**视觉/截图脚本新增路由要跟着归类**（`visual/shoot.mjs` 的路由清单），漏了会静默少一张图。
- 后台进程 `run_in_background=true`。无头浏览器用 `visual/browser.mjs` 的 `launchBrowser()`；静态站要在脚本里 `createServer` 自起；别用 `getByRole` / `text-is`。curl 读写不了 `/tmp`、`/d/...`；给 node/python 的路径用 Windows 形式。
- ⚠️ 多会话并发：可能有夜跑链或另一会话在写。动文件前取两次 md5；它的绿不归你背书。

## 待推进（详见 docs/开发计划-*）

- **案例库扩容 + 自建入口（09-26 制定，最新）** → `docs/开发计划-2026-09-26/案例库扩容与自建入口计划-2026-09-26.md`。实测依据：**61/69 规则无案例，其中 42 条 MUST/NEVER**（reliability 8 / security 6 / web 6 / data 5 / skeleton 5 / collab 4 / service 4 / test 3 / concurrency 1）→ 据此反推 9 条新主线；另发现**服务端与导出中心零 cookbook 出口**（C-1 未落袋）、**判据双写**（`build_cookbook` ↔ `sync-content.mjs` 重复同一批阈值）、**门槛文档比代码严**（代码本就允许「无实验」主线）。13 棒：先 W-0 共享判据 + W-3 脚手架，再铺内容，最后 W-1 浏览器录入 / W-2 私有目录 / W-4 AI 草稿出口。
- **案例库升级（09-25）** → `docs/开发计划-2026-09-25/最佳实践案例库升级计划-2026-09-25.md`。C-1 AI 出口 / C-2 代码自证 / C-3 规则互链排 P1；**C-4 `thread-pool` 保留给它**，不与上一条重复立项。
- **场景案例库（09-25 两条线）**：CONTENT 线 P1=补 6 个 Java 日常场景（幂等/慢SQL/导出超时/分布式事务/文件上传/越权脱敏）+ 参数虚胖治理 ✅ + 症状墙筛选兜底；P2=可运行切片（可复用 `DemoRunner`）/ benchmark / 规则反查 / deep link。⚠️ 实测别重算：47 driver 中 **11 inert**（10 个在 `conflicts`、1 个 `vt/lifespan` 在 `notSuitableFor`）；benchmark 切片 **0**、`/rules` 对场景零反查、切片代码不可运行。UI 线见同目录 UI 分层计划。
- **CaseLab ≠ DemoRunner**（09-26 已改名）：`app/cases/CaseLab.tsx`(909) = 症状分诊台；`components/DemoRunner.tsx`(265) = 蓝图页跑 `playground`。**两库合并仍未做**（C-7），别抢。
- **装配台**：UI 升级 P1/P2 全 ✅ + S3-3/S3-4 ✅（三批未提交），剩 S3-1 画布 / S3-2 评分卡（须改 `tools/content/stack*.py`）；向导升级计划见 `docs/开发计划-2026-09-25/装配台向导升级计划-2026-09-25.md`（P0-2 与 P2-1 待 mryang 拍板）。⚠️ 层级约束**只能灰显不能隐藏**，否则【17】分布断言会静默失效。
- B0-3：4 个场景无 benchmark（`async-pipeline` / `high-throughput-io` / `hotspot-cache` / `wide-table-search`）。findings.md 剩 ~14 条：P1 三条（archify 硬编码 localhost:3011、export PREVIEW 原始 Markdown + `<sub>` 泄漏、icons 89 vs 81）；63/81 位图图标缺失。
- 待人工决策：69 条规则逐条过目；5 条无检查器 AST 规则补/降级；`SVC-LAYR-003`；「性能与 JVM」「日志监控」两类未覆盖。
