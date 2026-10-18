# 军火库（arsenal）· 长期约定

**宗旨：软件脚手架装配台 —— 选完 → 下载即跑（09-28 定调）。导出「所见即所得」（树 = zip 逐文件一致）。** 三原则：①一份数据三种出口 ②Rule as Data ③写不出 bad/good 示例的不收录。过程见 `.workbuddy/memory/YYYY-MM-DD.md`；计划见 `docs/开发计划-*/`。

## 口径

- 后端 arsenal-server Boot **4.1.1** : **3011**；前端 arsenal-web Next.js 14 : **3010**（`output:'export'`）。
- **（10-18）工坊 projects 目录三档**：env `ARSENAL_PROJECTS_DIR` > yml `arsenal.projects-dir`（kebab，`ProjectPaths.resolveRoot` 里 System.getenv 保证 env 优先）> 默认 `D:/arsenal-projects-cache`（**仓库外**，10-18 起；曾是 DEFAULT_DIR `.data/projects` 相对进程 cwd，IDEA 跑仓库根时缓存落仓库内触发 BAD_SOURCE）。⚠ **`@Value` 不做 relaxed binding**：yml kebab 键必须 kebab 查（`${arsenal.projects-dir:}`），点分查静默查不到——该键曾因此从上线起整层失效（ProjectBeans javadoc 记着）。
- 事实源：`arsenal-rules/**`（69 条）、`arsenal-cookbook/`、`arsenal-cases/`（9 场景/67 切片/193 锚点）、`arsenal-stacks/*.json`、`arsenal-icons/`。
- 蓝图三层：技术→场景→方案，路由 `/blueprints/[topic]/[scenario]` 动态。案例 L1 目录页（`CASE_GROUPS` 唯一维护点）；L2 空壳 HTML 是既有设计；L3 实测必须真；`playground[]` 纯 JDK。
- 选型台 **33 维/127 选项/6 预设**；装配台三段十步向导：software ①定义②基底③主题框架(19 维唯一选型处)④校核台 / frontend-env ⑤前端⑥环境⑦模块 / delivery-run ⑧交付运行⑨部署形态⑩交付；`stepOfDim` 唯一归属出处。
- **四页路由已落地（09-29 夜）**：`/stack` 选型台 / `/stack/env` 环境与模块 / `/stack/run` 运行与部署 / `/stack/delivery` 交付中心；StackComposer.tsx(2399 行) 已拆成 `useStackChannel.ts` + `StackDeck.tsx` + 四容器 + `JourneyBar.tsx`；`wizard.ts` 的 `STACK_PAGES`/`PAGE_OF_STEP` 是页面归属唯一出处。**页面归属裁决只在 `useStackChannel` 挂载时做一次，`step` 绝不能进那条 effect 依赖数组**（否则 URL 被 `router.replace` 拽回 `/stack/`，四页渲染成同一页；project-check 三条源码文本断言守着）。
- 引擎覆盖：前端 35/69、后端 42/69、LLM 0/43，非正则层 skipped 不伪造。
- 设计 token：canvas #0B0F0E / surface #131917 / brass #D9A441 / olive #7FA650（tailwind.config.ts）；装配台语义色只许 `stack/palette.ts` TONE 五色。

## 硬约定（违反即事故）

1. 改内容改 `tools/content/*.py` 不改 JSON → `python tools/build-content.py`（newline='\n'）→ `node arsenal-web/scripts/sync-content.mjs`。加主线/场景：`COOKBOOK_MODULES`/`CASES_MODULES` 加一行。
2. `composeStack` 纯函数；空槽位跳过。**导出包开箱即跑**：SCAFFOLD 树 when 双向对齐；`V()` 变体 when 别漏传。
3. **断言反着验**：注入→红→还原→绿；还原用 `cp` 不用 `git checkout --`。
4. 源码当数据断言（project-check，先 stripComments）。加事实源改四处：sync + resolver + project-check + README 树。⚠️ **project-check 不验本仓 README**（验的是导出包 README）→ 本仓 README 与 `arsenal.json#project.dirs` 漏登记永远不会红；章程目录（`arsenal-charter/`，唯一手写 JSON 的事实源）就漏过，现由章程层【13】守着。**新增事实源目录照抄这条。**
5. **同文件多改动必须串行**（并行 Edit 静默丢改）。
6. 改装配台前 grep project-check 对该文件的**源码文本**断言（新增容器同步 `STACK_SPLIT`/`STACK_9PX`/`PAGE_OWNERS` 三张清单）；focusDim 有 200×2 正则窗口，加注释都可能爆。
7. 加/改 verify 层改五处（package.json / verify-all LAYERS / report LAYER_NAMES / meta CHAIN_ORDER / arsenal.json verifyChain）+ README 两处。`finish(layer)` 用 layer 字符串同时决定状态文件名与查表层名 → **新层必须用独立 key**，否则后写覆盖先写、项数被静默吞。
8. 加/删断言同步四处数字；`finish()` 打「声明 X/实测 Y」退出 1。
9. git 纪律：逐文件 `add` + `commit -- <路径>`，核对 `diff --cached --stat`；目录 pathspec 会夹带 `_*`。
10. `recipes[].files[].code` 只放 good 版（bad 进 pitfalls）。案例代码自证：`cookbook-lint.ts` 用 `file.path` 作 SourceFile.name；徽标数字一律算出来。
11. 子串判据会静默失效 → token 恰好相等 + 双反例。动态路由绝不写 `dynamicParams=false`；404 由页面内 notFound() 兜。
12. **（09-29）选项 `yaml` 片段分两种消费**：非 Spring 配置标 `yamlNote: True`；构建插件（jacoco）标 `mavenPlugin: True` —— build_project ⑦ 白名单守着。**base `covered` 必须诚实**（骨架按 3.x，boot41/40 已 False，pom 回落 3.2.12）。
13. **（09-29）导出包两个代码来源**：`stack_project.py` SCAFFOLD 与 `arsenal-scaffold/*.tpl` —— 叠加必过「@Component 简单类名唯一」关（securityjwt 曾双装两套鉴权启动即崩）。**默认值组合也要端到端冒烟**。
14. **（09-29）export-lint 是最后防线**：`src/lib/export-lint.ts` 五检查，violation 非空 = 禁止下载并台面亮清单（UI 不抛异常）。BOM 外 groupId 必须显式版本；yml 白名单与 build-content.py SPRING_ROOTS 两处同步。
15. **（10-03）章程层 charter（第 12 层，41 项）**：`arsenal-charter/<id>.json` **手写**（不进 `tools/content/*.py`）。契约 `arsenal-rules/_schema/charter-contract.mjs`，校验器 `scripts/lib/validate-charter.mjs`（`today` 注入不读 `new Date()`）。**ID 前缀 `PJX-` 不是 `PJ-`**（首段最少 3 字符）。
16. **（10-03）写完契约/校验器/判据，第一件事是跑，不是读。** 踩过 5 个静态读不出的 bug：ESM TDZ、`required` 标错层、Set 调 Map 的 `.get`、**判据方向写反导致该报的永远不报**（永不触发的断言和一直为绿的长得一模一样）、同一问题被外壳+专用判据报两次。配套：charter-check 第 8 节**结构自检**（逐类注入必填缺失看有没有报出）+ 第 9 节**配置化验「改 policy 真改判定」**（成对：改值真变+反向仍红）。**新增子结构类型必配一条自检。**
17. **（10-03）待拍板项必须真的配置化，且要 grep 自查**：章程层 `policy` 段必填 —— `overdueException`(error/warn/ignore)·`orphanBlocks`(warn/error，独立于上条)·`requireTicket`·`budgetScope`(separate/shared)。章程目录三档：默认 `arsenal-charter` < `arsenal.json#project.charterDir` < env `ARSENAL_CHARTER_DIR`。**说「都配置了」之前必须 grep 一次。**
18. **（10-04）判定逻辑第二份实现时，不 import、比对行为**：CI 执行器 `arsenal-server/scripts/charter-ci.mjs` 与 `arsenal-web/src/lib/engine.ts` 判同一批规则 → 同批规则+同批样本，比对 (ruleId,file,line) 三元组；**必配「样本确实触发命中」**否则恒真。导出的 CI 片段引用的路径必须真存在（曾引用编出来的包名和不存在的脚本）。
19. **（10-04）断言层验「算得对不对」，视觉层验「说得对不对」，后者不能省**：实测页面显示「34 条章程没跑」而实际只有 2 条（漏 `PJX-` 前缀），断言层全绿；`{n > 0 && …}` 在 0 条时整条提示消失 —— **0 的情况也要说，它本身是一条结论**。凡是页面「N 条…」措辞，写完必须打开看一遍。MCP 工具数从 `arsenal-rules/mcp-tools.json` 现读，不写死。CI 片段不许写死判负口径（由用户 policy 决定）。
20. **（10-03）层数/项数一律从档案读**：`meta-check` 从 `chainDeclared.length` 算；源码注释里的历史数字可保留，只改活口径。
21. **（10-12）「跑不动」和「没跑」不许写成同一句话 —— 先探活再判断。** 10-11 夜三棒把 `verify:visual` 记「跳过/EBUSY」，终检实测能跑（130s/102 张）并抓出两个真红（矩阵 vs manifest 差 3 张；A8 粘性列不可达 61/102 张）。→ 记「跳过」前必须当场再跑一次。`visual/shoot.mjs` 的 `EXPECTED`（fixedPages/urls/shots）是手写期望值，加路由要手动同步三处并重跑（需活着静态站 `:3021`）。
22. **（10-14）`spawnSync` 探外部进程：EBUSY/EAGAIN/EPERM 是瞬时态，必须重试再判**。实测同一台机器同一条 `spawnSync('bash',['--version'])` 四次里 3 次 EBUSY、1 次跑通。老写法只看 `status === 0`，于是 EBUSY 被写成「bash 不可用」→ **整层 N 项记成「未执行」而实测数取自档案声明值**（一句假话套着另一句假话），且 `verify:scan` 在链内退化成「?」无成绩。修法见 `scan-check.ts` 的 `probeBash()` / `gitProbe`：重试 3 次 + 照实写「被本环境拒绝」，**不写「沙箱限制」这类推断**（推断写进跳过理由，下一个人会当真）。修完链内 scan 首次拿到成绩（0 失败）。
23. **（10-14）措辞层是独立出口，必须单独配断言**。`healthWording()` 的 null 分支在 `reconcileRuntime` 路径上**根本走不到**（调用前已判非空），所以 13-A/13-B/13-F 全绿时它照样能返回「健康」——把「没做」说成「做了」。→ 由 13-G 直接打措辞层。判据用「先 `stripNegated()` 抠掉否定式，剩下的才是肯定句」；**第一版把方向写反了（`!NEGATED.test(w)`）把「不是健康」判成错**，又一次印证硬约定 16：**判据方向写反和没写这条断言长得一模一样**。
24. **（10-14）`/autopsy` 已六页签**：`arch / services / checkup / history / vitals / runtime`。前五页**一个字节都不执行**，`runtime` 会（后端 `POST /api/autopsy/run` 在工作副本里真跑）。三份状态（checkup / vitals / runtime）**刻意不合并** —— 合并会把「快照好了、序列没好、活体没跑」藏成一片空白。api 层 `autopsyRun` 超时 150s，**不复用 `SCAN_TIMEOUT_MS`(200s)**：必须比后端 90s 墙钟宽，否则前端先超时、进程还在跑，页面会说「没采到」。zip 模式走不了活体（上传件活不过一次请求），页面明说。

## 校验与运行

- `npm run verify` **13 层**（arsenal.json verifyChain）/ 全链实测 **2145 项**（章程层 93；10-11 autopsy 层 +16）。层数与项数都从档案读，链尾 `verify:meta` 再比一次。
- ⚠️ `.verify/**` 不在根 tsconfig → `npm run typecheck:verify`；safe-delete ≥50 文件会拦 → 别挤一个 turn。
- **从 TS 断言 import `.mjs` 校验器**：要写 JSDoc `@typedef`/`@returns`；`baseCharter()` 夹具返回 `Record<string, any>`。
- 后端：`SKIP_COMPILE=1 bash arsenal-server/scripts/run.sh`（JDK17 corretto）。改规则必重启。探活 node fetch。GlobalExceptionHandler 把 404/405/415 吃成 500。

## 环境铁律

- 每条命令前 `export PATH="/usr/bin:/bin:/c/Windows/System32:/c/Windows:$PATH"`；node 用 managed 22.22.2。
- `next dev/build` 只许 `node arsenal-web/scripts/next-run.mjs`，**它不跑 sync**。
- Git Bash 下 `npm run` exit 1 → 用 node 直跑 npm-cli.js 或脚本本体。`trailingSlash: true`；视觉新增路由归进 shoot.mjs 清单。
- 无头浏览器用 `visual/browser.mjs`；curl 读写不了 /tmp；给 node/python 用 Windows 路径。**本机没有 Chrome**，playwright chromium 脚本要显式 `ARSENAL_CHROME="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"`。
- **`spawnSync(process.execPath, …)` 在本环境返回 EBUSY** → `verify:archify` 调外部 CLI 恒失败 3 项，shell 手工跑是好的。**看到 Archify 红先验 EBUSY，别改代码。**
- **（10-18 推翻 10-12 旧结论）java「常驻不了」是误判，根因是 run.sh 类路径缺件**：Boot 4 把 `ServletWebServerFactory` 拆进 `spring-boot-web-server` / `spring-boot-tomcat`（全 .m2 只这两个 jar 有该类），迁移提交 daf2c80 没补 → WebMvc Deducer 三判据全在场推断 SERVLET、自动配置条件类缺失静默不建 web server → Started 后无保活线程 code=0 退出、端口从不监听。**表象（35s 静默死 / 父活着也自退）与「harness 杀后台进程」一模一样，别再把「连不上本地服务」归因于环境** —— 先看日志有没有 Tomcat/DispatcherServlet 行。已修（d508c17），冒烟 7/7 过，服务正常保活。探活仍建议「启动 + fetch + kill 同一条 bash 命令」图省事，但不是必须了。
- **javac/java 的 `-cp` 首条目用相对路径会让其余条目静默失效**（报「程序包 X 不存在」而 CP 明明有）：一律绝对 Windows 路径（`cygpath -m`）。探针脚本用 `to_win` 从未踩到。
- 多会话并发：动文件前两次 md5；它的绿不归你背书。

## 待推进（详见 docs/开发计划-*）

- **案例库扩容+自建入口（09-26，最新）**：61/69 规则无案例（42 条 MUST/NEVER）→ 13 棒：W-0 共享判据 + W-3 脚手架先行，再铺内容，后 W-1 浏览器录入/W-2 私有目录/W-4 AI 草稿。
- CaseLab(分诊台)≠DemoRunner(跑 playground)，两库合并 C-7 未做。场景 CONTENT 线 P1 补 6 日常场景。
- 装配台剩 S3-1 画布/S3-2 评分卡；P0-2/P2-1 待拍板。B0-3 四场景无 benchmark；63/81 位图缺。
- **装配台重设计已结案（10-01 23:47 终检）**：四页真落地，十层 1839 全绿/跳过 0，P0 遗留 = 无。唯一大块遗留 = 63 张矩阵逐张人工判读（34/63 已看，L 档）。
- 待人工决策：69 规则逐条过目；5 条无检查器 AST 规则补/降级。
