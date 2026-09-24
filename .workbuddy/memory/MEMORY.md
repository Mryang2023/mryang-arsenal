# 军火库（arsenal）· 长期约定

个人代码规范字典 + AI 合规校验平台。三原则：①一份数据三种出口 ②Rule as Data ③写不出 bad/good 示例的不收录。不做：auto-fix、绑某家 AI、规则市场/多租户。上限单人 + 小团队（≤10）。
> 只留**仍在生效**的约定；过程见 `.workbuddy/memory/YYYY-MM-DD.md`；体检见 `docs/现状体检与开发计划-2026-09-22.md`、`docs/功能缺口清单-2026-09-22.md`。

## 口径

- 后端 `arsenal-server` Spring Boot 3.2.5 + Java 17 : **3011**；前端 `arsenal-web` Next.js 14 + TS + Tailwind : **3010**（`output:'export'` 纯静态）。
- 事实源全 Git 化：`arsenal-rules/**`（69 条）、`arsenal-cookbook/`（5 蓝图）、`arsenal-cases/`（8 场景）、`arsenal-stacks/*.json`、`arsenal-profiles/`、`arsenal-icons/icons.json`。
- 蓝图（cookbook）可带 **`playground[]`**：自包含可运行 main（`{id,label,mainClass,files:[{path,code}],note?}`）。这是最佳实践库的「第四种出口」（人查 / 给 AI 用 / 拿代码验 / **能直接跑**）——`/playground` 页面即从这里摊平示例，**不再硬编码**。给任何蓝图加 `playground` 即可多一个可运行示例，无需改前端。加字段链路安全：`build_cookbook` 无字段白名单、`sync-content.mjs` 对 cookbook 未知字段透传。
- 严重度 MUST/NEVER/SHOULD/MAY（37/13/18/1），MUST+NEVER 硬上限 50 已满。
- **规则字段名（勿臆造）**：`title` / `rationale`（无 `description`）、`bad` / `good`、`check.{regex,ast,llm,manual}`；`check.llm` 是字符串，`check.ast` 是 `{engine,query}`。
- 选型台 **33 维 / 127 选项 / 6 预设 / 100 能力 / 21 策略 / 7 泳道**；`pipelines` 目前只有 `data` 一条 3 环。
- 引擎真实覆盖：**前端 35/69**（纯正则）、**后端 42/69**（35 正则 + 7 AST，JDK 自带 `jdk.compiler`）、**LLM 0/43**。非正则层一律 skipped，绝不伪造判定。
- 设计 token（tailwind.config.ts）：canvas #0B0F0E / surface #131917 / surfaceHi #1A2220 / surfaceMax #212B28 / line #243029 / lineHi #33413A / treeLine #3C4D45；fg #E8F0EC / fgMuted #93A39C / fgFaint #80918A / brass #D9A441 / olive #7FA650。组件类 `.panel` `.mono` `.grid-bg`(34px) `.stack-bench` `.stat-num`；阴影 `panel`/`lift`；动画 `fade-up`。装配台语义色只许 `src/app/stack/palette.ts` 的 TONE 五色；装配台专属四变量在 globals.css `:root`（`--stack-bench/-grid/part/part-hi`）。

## 硬约定（违反即出事故）

1. 改内容改 `tools/content/*.py`，**不改 JSON**：`python tools/build-content.py` → 产物 JSON；写 JSON 必须 `newline='\n'`。改完跑 `node scripts/sync-content.mjs`。规则 `arsenal-rules/**` 是手写源，不进管道。
2. `composeStack(picks)` 是纯函数；空槽位跳过、不回退默认。可运行性由 `provides`/`requires` 决定。
3. 隐患必须可核对：`trigger`/`symptoms`(≥2)/`impact`。架构结论三档不合并：跑不起来 / 能跑但零件不全 / 可以跑。
4. 产物必须「能跑」：不引用导出包没有的文件；端口/健康端点算出来不写死；zip 用 `testzip()` 验。
5. **断言写完反着验一次**；注入后先确认注入真打中了；还原用 `git checkout --` 或 `newline=''`（python 文本模式会翻 CRLF）。报错必须带实际值。
6. 页面契约两处：页签 id ↔ 渲染分支；导航项 ↔ 路由；`savePicksSnapshot` ↔ `loadPicksSnapshot`。源码当数据断言（`project-check.ts`，解析前先 `stripComments()`）。
7. 加一类文件型事实源要同时改四处：`sync-content.mjs` + 前端 resolver + `project-check.ts` + README 目录树。
8. **同一文件多处改动必须串行**（并行 Edit 静默丢改、tsc 仍 0 错）。加 prop/state 前 grep 同名声明；状态文案局部变量叫 `statusMeta`。
9. **加/改一层 verify 改五处**：`package.json` + `verify-all.mjs`(LAYERS) + `report.ts`(LAYER_NAMES) + `meta-check.ts`(CHAIN_ORDER) + 档案 `verifyChain`；另加 README 两处。
10. **加/删断言同步四处数字**：`arsenal-profiles/arsenal.json` 的 `verifyChain[*].count`、README 总数句、README 分项表，改完**必跑 sync-content.mjs**（`VERIFY_CHAIN` 读 `generated/profiles.json`）。漏了不静默：`finish()` 打「声明 X / 实测 Y」退出 1，`verify:meta` 也会红。

## 校验与运行

- `npm run verify` 九层（2026-09-24 白天：装配台 P1 第二组 + S2-1/2/4/5/6 + S3-3/4 + multi-source-ingestion 案例，**待用户实跑对账**）= 35 架构 + 68 图交互 + **718** 结构导出（含【16】字段契约 244、【17】装配台视觉契约 24、【18】装配台交互 23）+ 33 场景 + 17 引擎样本 + 12 前后端一致 + 31 Archify + 69 代码扫描 + 12 视觉 = **995**；cases 穷举守恒 9072 组。
- 【16】= 类型 ↔ 事实源**双向**比（必选字段逐记录核 / 异构字段必须可选 —— `/cases` 白屏事故的根因断言）；cookbook 的 fileCount 等 4 个 sync 注入字段改对 `src/generated/*.json` 核。
- 【17】= 装配台 P1 呈现规则（三档宽度 208/172/148、分布 3/1/29 与 pipelines 互证、brass ring 选中态、常驻移除按钮、字号四档 10/11/12/14、空态引导）。**分布数字是钉死的**，pipelines 数据变了要同步改。
- **视觉层**判据 A1–A7 在 `visual/assert.mjs`（45 张 = 15 路由 × 3 视口）。⚠️ 断言的是 `out/` 不是源码 → 先 `node scripts/next-run.mjs build`，否则整层跳过（新鲜度守卫）。⚠️ A5 **不猜**半透明/渐变背景、跳过 <12px 文字 —— 半透明底上的文字对比度它测不到，别拿 A5 绿当全绿。⚠️ `shoot.mjs` 不自起静态站，3021 要先有服务；console 采集有竞态，report.md 条数逐轮不同。
- 汇总表「通过/跳过/失败」是互斥三态，三者之和 = 实测。
- ⚠️ `.verify/**` 不在根 tsconfig → 改完必须实跑（另有 `.verify/tsconfig.json`，`npm run typecheck:verify`）。
- ⚠️ safe-delete 守卫按工具调用累计 ≥50 抛 → 九层别挤一个 turn；子进程给 `CODEBUDDY_SAFE_DELETE_ENABLED=0`。整链 7 分钟起（代码扫描 72~321s）。
- 后端：`SKIP_COMPILE=1 bash arsenal-server/scripts/run.sh`（JDK17 在 `C:/Users/Administrator/.jdks/corretto-17.0.12`）。**改规则必重启后端**。探活用 node fetch，别用 curl（走代理）。
- 接口：`/api/health` `/api/stats` `/api/rules`(`/grouped` `/sources` `/{id}`) `/api/export/*` `/api/lint` `/api/archify` `/api/scan/*` `/api/cases/run`（提交 Java 源码 → JDK21 子进程编译运行 → 回 stdout/stderr/退出码）`/api/cases/jdk`（报告实际 JDK）。
- ⚠️ 改后端先想「异常落到哪个 handler」：`GlobalExceptionHandler` 把 404/405/415 吃成 500。

## 环境铁律

- bash 的 PATH 是坏的：每条命令前 `export PATH="/usr/bin:/bin:/c/Windows/System32:/c/Windows:$PATH"`；node 用 managed `…/node/versions/22.22.2-3`。
- **`next dev`/`build` 只许 `node scripts/next-run.mjs <cmd>`**；⚠️ 它**不跑 sync**（prebuild 只有走 npm 才触发）→ 改了事实源必须显式 sync 再 build，否则 `out/` 是假的。
- **Git Bash 下 `npm run` 会 exit 1**（npm 包装坏了）：用 `node "<node目录>/node_modules/npm/bin/npm-cli.js" run <script>`（注意 npm-cli 在 node 安装目录，不在项目 node_modules），或直接跑脚本本体。
- 后台进程用 `run_in_background=true`，别用 `(cmd &)`。
- 无头浏览器：一律 `visual/browser.mjs` 的 `launchBrowser()`，别写 `channel:'msedge'`（Edge 在版本子目录）。给浏览器用的静态站要在脚本里用 node `createServer` 自己起（外部 python 站 msedge 连不上）。别用 `getByRole`/`text-is`（本站歧义），用 `page.evaluate` 按 textContent 找。
- curl 是 Windows 程序：读写不了 `/tmp`、`/d/...`；给 node/python 的路径用 Windows 形式。
- `/rules/<不存在的 id>/` 在 dev 下 500 白屏不是 404。调试产物写 `arsenal-web/.workbuddy/_*`，用完即删。
- ⚠️ 多会话并发：可能有夜跑链在写。动文件前取两次 md5；它的绿不归你背书。

## 待推进

- **场景案例 7 号 `multi-source-ingestion`（2026-09-24 白天）已建未提交**：`tools/content/cases/multi_source_ingestion.py` + 档案/README 数字同步，来源省妇幼真实项目回灌；等 mryang 过目后 commit，下次 build 后视觉层恢复实测。
- **场景案例 8 号 `virtual-thread`（2026-09-24 下午）已建未提交**：`tools/content/cases/virtual_thread.py`（用户"虚拟现成"按虚拟线程解读），5 切片 / 5 drivers / 带 benchmark，关联 CONC-POOL-001/002/004/005、CONC-LOCK-001/002、CONC-THRD-002；build + sync 已绿（8 场景 / 61 切片 / 175 锚点）。等 mryang 过目后 commit。
- **最佳实践案例库 5 号 `virtual-thread`（2026-09-24 下午）已建未提交**：`tools/content/virtual_thread.py` + `build_cookbook()` 注册，4 文件 / 110 锚点 / 关联 CONC-POOL-001/002/004/005、CONC-LOCK-001/002、CONC-THRD-001/002；build + sync 已绿（5 案例 / 36 文件 / 2420 行 / 110 锚点）。**已加 `playground`（3 个可运行示例：高并发IO/防pinning/背压）** 供 /playground 消费。等 mryang 过目后 commit。
- **后端案例执行服务 `com.arsenal.cases`（2026-09-24 下午）已建未提交**：包内 8 文件 + `GlobalExceptionHandler`/`application.yml` 两处接入；fork JDK21 子进程跑任意 Java，`POST /api/cases/run`、`GET /api/cases/jdk`。编码坑：javac 诊断 + JVM 控制台流都要加 `sun.stdout/stderr.encoding=UTF-8` 才不乱码。当前已在后台跑（端口 3011）。等 mryang 过目后 commit。
- **前端「案例实验室」`/playground`（2026-09-24 下午建，17:30 改版）已建未提交**：`src/app/playground/{page,PlaygroundConsole}.tsx` + `src/lib/case-run.ts` + `src/components/CodeEditor.tsx`(Prism 高亮) + `Shell.tsx` NAV 加一项（导航契约）；调 `/api/cases/run`。**示例来自 `@/lib/cookbook` 的 `features[].playground`，不再硬编码**。build 绿（88 静态页），playwright 实跑点「运行」通过（JDK21，虚拟线程 159ms vs 线程池 572ms），代码 209 个彩色 token。新增依赖 **prismjs + @types/prismjs**。⚠️ 验证静态站**必须起 3010**（后端 CORS 只放行 3010）。⚠️ `CodeEditor` 高亮**必须 mounted 门控**（SSR 先渲染纯文本子节点、挂载后再切 dangerouslySetInnerHTML），否则 React hydration 警告。等 mryang 过目后 commit。
- **⚠️ verify:project 实测 763 / 声明 718（退出 1，2026-09-24 傍晚）**：718 是白天 staged 的（`arsenal.json` 698→718，未提交），之后 8 号案例 + 5 号蓝图（+ 可能夜跑链装配台断言）使【16】等逐记录断言增长到 763 未同步。对账时统一：改 `arsenal-profiles/arsenal.json` 的 project count → `sync-content.mjs` → README 两处。（playground 不引入失败，763 全过。）
- **夜跑链 2026-09-23→24**：第 1 棒案例库 B0 ✅（benchmark 改可选 + 【16】224 条）；第 2 棒装配台 P1 第一组 ✅（S1-1/2/3/6/7 + 【17】24 条）。状态与交账见 `.workbuddy/night-chain/0N-done.json`。
- 【18】= 装配台 P1 第二组（S1-4 连线：开关默认关/关闭零动效/reduced-motion；S1-5 仪表：ProgressRing 单份定义两处消费、33 格点阵 map dimensions、TONE 同源配色；S2-7 去重：tree/arch/risk 砍掉防回潮、右栏入口在、DeliveryDeck focusTab 消费点）。点阵 map 的 dimensions 数据变了不用改这条（动态），S1-2 三档分布 3/1/29 仍钉死。
- **装配台 UI 升级计划** `docs/开发计划-2026-09-23/装配台UI升级计划-2026-09-23.md`：P1 七条 ✅ + P2 八条 ✅ + P3 的 S3-3/S3-4 ✅（09-24 中午~12:3x，S2-1/2/4、S2-5/6、S3-3/4 三批**均未提交**，等用户 verify 后落袋；V2-06 按 H-2 转待复核）。**只剩 S3-1 画布 / S3-2 评分卡（须改 tools/content/stack*.py + build-content + sync）两条 L**。热点文件所有权：StackComposer / DeliveryDeck 一棒一文件。
- **/arch P0**（参数化 5 张写死坐标的图）建议独占一晚；Q3 待拍板（复用 `buildLayeredSvg` 与否）。
- **B0-3 未做**：4 个场景仍无 `benchmark`（等 Q1 拍板；补须改 `tools/content/cases/*.py`）。
- `/cases` 默认参数 0 切片命中（产品决策，未动）。
- findings.md 还剩 ~14 条：P1 三条（archify 硬编码 localhost:3011、export PREVIEW 原始 Markdown + `<sub>` 泄漏、icons 89 vs 81）；V2-13（网关路由空态）已被 S1-7 覆盖、待终检确认关闭。
- 63/81 位图图标缺失（需生图额度）。
- 待人工决策：69 条规则逐条过目；5 条无检查器 AST 规则补/降级；`SVC-LAYR-003`；「性能与 JVM」「日志监控」两类未覆盖。
