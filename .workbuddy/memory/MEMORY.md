# 军火库（arsenal）· 长期约定

个人代码规范字典 + AI 合规校验平台。三原则：①一份数据三种出口（人查/给 AI 用/拿代码验）②Rule as Data ③写不出 bad/good 示例的不收录。不做：auto-fix、绑某家 AI、规则市场/多租户。上限单人 + 小团队（≤10）。
> 本文件只留**还在生效的约定**；过程与踩坑见 `.workbuddy/memory/YYYY-MM-DD.md`；现状体检见 `docs/现状体检与开发计划-2026-09-22.md` 与 `docs/功能缺口清单-2026-09-22.md`。

## 口径

- 后端 `arsenal-server` Spring Boot 3.2.5 + Java 17 : **3011**；前端 `arsenal-web` Next.js 14 + TS + Tailwind : **3010**（`output:'export'` 纯静态）。
- 事实源全 Git 化：`arsenal-rules/**/*.json`（69 条 / 10 个规则文件）、`arsenal-cookbook/*.json`、`arsenal-stacks/{stack,architecture,project}.json`、`arsenal-profiles/<id>.json`、`arsenal-icons/icons.json`。
- 严重度 MUST/NEVER/SHOULD/MAY（37/13/18/1），**MUST+NEVER 硬上限 50** 已满。九大类：skeleton web service data concurrency reliability security test collab。
- **规则字段名（勿臆造）**：`title` / `rationale`（**没有 `description`**）、`bad` / `good`（**不是 badExample/goodExample**）、`check.{regex,ast,llm,manual}`；`check.llm` 是**字符串**，`check.ast` 是 `{engine,query}`。
- 选型台 **33 维 / 127 选项 / 6 预设 / 100 能力 / 21 策略 / 7 泳道**；`deploy` = jar·docker·k8s·helm（`src/lib/deploy.ts`）。
- 引擎真实覆盖：**前端 35/69**（纯正则）、**后端 42/69**（35 正则 + **7** AST，用 JDK 自带 `jdk.compiler`，**不是 JavaParser**）、**LLM 0/43**。非正则层一律 skipped，绝不伪造判定。
  - ⚠️ 2026-09-23 终检棒实测纠正：此处原写「35 正则 + 15 AST = 50/69」是**错的**。15 是 `AstEngine.register()` 的检查器数，其中 **8 条因 `LintEngine` 的 `if (hasRegex) … else if (hasAst)` 在 API 路径上永不执行**。完整分解：20 条声明 ast = 8（同时声明正则，被「正则优先」抢走）+ 12（无正则），12 里 5 条无检查器（即上面那 5 条刻意边界）→ **真跑 7 条**（好文件 `executableRules=42`、坏文件 35、`AstLayer.declaredRules=7`）。**09-23 白天已把两处过期口径改对**：`arsenal.json` 的 L2 AST `status:done` + roadmap 那条换成「AST 路由与 glob 收口」，README「当前进度」新增「校验引擎覆盖」行、「未完成」表 AST 行改写。

## 硬约定（违反即出事故）

1. 改内容改 `tools/content/*.py`，**不改 JSON**：`python tools/build-content.py` → `arsenal-{cookbook,stacks}/*.json`；写 JSON 必须 `newline='\n'`。加维度同时进 `STACK_MODULES`，改完跑 `node scripts/sync-content.mjs`（锚点/交叉校验失败即中断）。规则 `arsenal-rules/**` **不进该管道**，是手写源。
2. `composeStack(picks)` 是纯函数；空槽位跳过、不回退默认；未声明维度留空。可运行性由数据决定（`provides`/`requires`）；向自己索要是构建期硬错。
3. 隐患必须可核对：`trigger`/`symptoms`(≥2)/`impact`，与 `POLICY_DETAIL` 一一对应。**架构结论分三档不合并**：跑不起来 / 能跑但零件不全 / 可以跑起来。
4. **交付产物必须「能跑」不只是「看着对」**：不许引用导出包里没有的文件；照模板写、别做字符串替换；健康端点/JDBC/停机时长/端口一律算不写死；compose `depends_on` 标方向；k8s 用 `apply -k`。导出 zip 用 `zipfile.testzip()` 验。
5. **断言写完反着验一次**（把真相改坏必须变红）；报错必须带实际值。
6. **页面契约是两处**：页签 id（`TabId`）↔ 渲染分支（`tab==='x'`）；导航项 ↔ 路由；`savePicksSnapshot` ↔ `loadPicksSnapshot`。只有把**源码当数据断言**才抓得住（`project-check.ts`【13】，解析前先 `stripComments()`）。
7. 加一类文件型事实源要同时改四处：`sync-content.mjs`（形状闸门）+ 前端 resolver + `project-check.ts`（契约）+ README 目录树。
8. **同一文件多处改动必须串行**（并行 Edit 必丢、不报错、`tsc` 也 0 错）。给老文件加 prop/state 前先 grep 同名声明；「状态文案」类局部变量统一叫 `statusMeta`，**不叫 `meta`**。

## 校验与运行

- `npm run verify` 八层 = 35 架构 + 59 图与交互 + 406 结构与导出 + 33 场景案例 + 17 引擎样本 + 12 前后端一致性 + 31 Archify + 69 代码扫描 = **662**（以 `src/generated/profiles.json` 的 `verifyChain` 为准；改口径要同步 `arsenal-profiles/arsenal.json` **并重跑 `sync-content.mjs`**）。
  - ⚠️ `VERIFY_CHAIN.reduce() === VERIFY_TOTAL` 是**半恒真**，手写总数无守门（引擎 14→17 靠人发现）。待改成各层报实测值互比。
- ⚠️ **`.verify/**` 不在 tsconfig 里**：`next build` / `tsc` 都不看它，坏 import 只在**运行时**炸。改完必须**实跑那一层**。
- ⚠️ **safe-delete 守卫按「一次工具调用」累计** ≥50 就抛 → `npm run verify` 八层别挤在一个 turn；子进程清理照 `next-run.mjs`，**只给该子进程** `CODEBUDDY_SAFE_DELETE_ENABLED=0`。
- ⚠️ **多会话并发**：同仓库可能有夜跑链在写。动它文件前取两次 md5；它的绿不归你背书。
- ⚠️ **同名函数跨模块 = 静默选错**（`buildTechArchFromFacts` 曾有两份、返回形状不同）→ 加模块前先 grep 同名导出。
- `CASES_MODULES` 只许有一份（在 `tools/build-content.py`）；`tools/content/cases/__init__.py` 那份是死的，改它等于新场景「写了但不生成」且不报错。
- 后端：`bash arsenal-server/scripts/run.sh`（JDK 17 在 `C:/Users/Administrator/.jdks/corretto-17.0.12`，PATH 上是 21；`ARSENAL_PORT` 换端口）。托管环境注入 `SERVER__PORT=3743` 优先级高于 yml，run.sh 已用 `--server.port` 钉住。**改规则必重启后端**（RuleLoader 启动时一次性载入）。
- ⚠️ 改后端先想「异常落到哪个 handler」：`GlobalExceptionHandler` 的 `@ExceptionHandler(Exception.class)` 把 Spring 自身的 404/405/415 吃成 500（已错 5 种）。
- 接口：`/api/health`、`/api/stats`、`/api/rules`(`/grouped` `/sources` `/{id}`)、`/api/export/*`、`/api/lint`、`/api/archify`、`/api/scan/*`。

## 环境铁律

- **bash 的 PATH 是坏的**：每条命令前 `export PATH="/usr/bin:/bin:/c/Windows/System32:/c/Windows:$PATH"`；node 用 managed `…/node/versions/22.22.2-3`。**PowerShell 工具捕获不到 stdout** → 排查走 bash。
- **`next dev` / `next build` 必须走 `node scripts/next-run.mjs <cmd>`**，不许直接 `npx next`（Next 启动即 `recursiveDelete(distDir)` 逐个 unlink，撞守卫就抛错穿透、dev server 当场死）。
- **`curl` 是 Windows 程序**，读写不了 `/tmp`、`/d/...` → 输入用 `cygpath -m`、输出 shell 重定向；给 node 的路径必须 Windows 形式。**heredoc 里别写 `${x.toFixed(2)}`**（被 shell 抢展开）→ 用 Write 落文件。
- 无头浏览器：`playwright-core` 在 `arsenal-web/node_modules`，**本机没有 Chrome**（`C:/Program Files/Google/Chrome/...` 不存在），只有 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` → 一律 `chromium.launch({channel:'msedge'})`；`getByRole`/`text-is` 在本站歧义（页签按钮内嵌 glyph span）→ 用 `page.evaluate` 按 textContent 找并 click。截图/静态站用 **3021** 端口（3000–3029 实测空闲，但 3010/3011 被其他项目占用过）。旧文档 `docs/hy4-night-plans/**` 的工作目录 `D:\workspace\2026\mryang-arsenal` **不存在**，别照抄。
- `/rules/<不存在的 id>/` 在 dev 下是 500 白屏不是 404（`output:'export'` 时 `generateStaticParams()` 先抛）。调试产物写 `.workbuddy/_*`，用完即删。
- 本机 `registry.npmjs.org` 通、`github.com` 的 git 协议不通 → 装技能走推荐市场。

## 待推进

见 `docs/开发计划-2026-09-22/00-index.md`（**五份**按功能切分、文件所有权互斥的计划；**该文件同时是夜跑编排书** —— §一 工作量裁定、§二 棒次表、§三 按棒钉死的备选池、§五 统一台账 A/B/C/D/V 共 40 条、§九 定时任务登记表）。夜跑规程是 `docs/开发计划-2026-09-22/NIGHT-RUN.md`（一棒三段/接力/收尾七步/`0N-done.json` schema），排期走技能 `night-run`（章程公式：单棒预算 =(窗口−终检40−交接3×棒数−缓冲)/棒数，**准入体量 ≤(预算−20)/1.5**；本仓库 8 小时窗口 ≈ 4 工作棒 + 终检、单棒 118 分钟 → 只装得下 ~7 条任务）。`war-board.html` 是同目录的排期视图。计划 5 是**多模态专用**的视觉走查（45 张截图矩阵 + 逐张判读 + `visual/assert.mjs`），纯文本模型做不了。
- **待人工决策（不是代码问题）**：69 条规则逐条过目（同意/改/删，「没过目就不算军火库」）；5 条无检查器的 AST 规则（`COL-CODE-002`/`CONC-THRD-002`/`REL-LOG-003`/`SEC-LOG-001`/`SKEL-STRC-002`，是**刻意边界**不是 bug）补/降级/留 skipped；`SVC-LAYR-003` 待拍板；「性能与 JVM」「日志监控」两类未覆盖。
- 63/81 位图图标缺失（矢量 81/81 已全量，不阻塞任何功能，需生图额度）。
