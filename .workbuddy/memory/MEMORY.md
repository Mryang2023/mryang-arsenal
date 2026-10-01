# 军火库（arsenal）· 长期约定

**宗旨：软件脚手架装配台 —— 选完 → 下载即跑（09-28 定调）。产物必须能跑；导出「所见即所得」（树 = zip 逐文件一致）。** 三原则：①一份数据三种出口 ②Rule as Data ③写不出 bad/good 示例的不收录。过程见 `.workbuddy/memory/YYYY-MM-DD.md`；计划见 `docs/开发计划-*/`。

## 口径

- 后端 arsenal-server Boot 3.2.5 : **3011**；前端 arsenal-web Next.js 14 : **3010**（`output:'export'`）。
- 事实源：`arsenal-rules/**`（69 条）、`arsenal-cookbook/`、`arsenal-cases/`（9 场景/67 切片/193 锚点）、`arsenal-stacks/*.json`、`arsenal-icons/`。
- 蓝图三层：技术→场景→方案；路由 `/blueprints/[topic]/[scenario]` 动态。案例 L1 目录页（`CASE_GROUPS` 唯一维护点，未归组落「其它」）；L2 空壳 HTML 是既有设计；L3 实测必须真（`lab.kind` 与代码互证）；`playground[]` 纯 JDK（后端 javac 无 classpath）。
- 选型台 **33 维/127 选项/6 预设**；装配台三段十步向导（09-29 核实，原记「七步两段」已过期）：software ①定义②基底③主题框架(19 维唯一选型处)④只读校核台 / frontend-env ⑤前端⑥环境⑦模块 / delivery-run ⑧交付运行⑨部署形态⑩交付；`stepOfDim` 唯一归属出处。SlotBlock 无修改入口是故意的（project-check 反向断言）。形态只预填不约束。
- **四页路由已落地（09-29 夜 P0，拆法 A）**：`/stack` 选型台（software 四步）/ `/stack/env` 环境与模块（⑤⑥⑦）/ `/stack/run` 运行与部署（⑧⑨）/ `/stack/delivery` 交付中心（⑩ + 产物页签）；`StackComposer.tsx`(2399 行) 已删，拆成 `useStackChannel.ts`(状态通道) + `StackDeck.tsx`(常驻结论条) + 四个容器 + `JourneyBar.tsx`(跨页导航)；`wizard.ts` 的 `STACK_PAGES`/`PAGE_OF_STEP`/`PAGE_ID_OF_STEP` 是页面归属唯一出处（`stepOfDim` 等引擎口径未动）。**页面归属裁决只在 `useStackChannel` 挂载时做一次，`step` 绝不能进那条 effect 的依赖数组** —— 放进去会让 URL 被 `router.replace` 拽回 `/stack/`，四页渲染成同一页（project-check 三条源码文本断言守着）。侧边栏「装配台」分组 4 项（`Shell.tsx` NAV_ROWS，`nav-active.ts` 的 `LEAF_PARENTS` 让父项精确匹配）。
- 引擎覆盖：前端 35/69、后端 42/69、LLM 0/43，非正则层 skipped 不伪造。
- 设计 token：canvas #0B0F0E / surface #131917 / brass #D9A441 / olive #7FA650 等（tailwind.config.ts）；装配台语义色只许 `stack/palette.ts` TONE 五色。

## 硬约定（违反即事故）

1. 改内容改 `tools/content/*.py` 不改 JSON → `python tools/build-content.py`（newline='\n'）→ `node arsenal-web/scripts/sync-content.mjs`。加主线/场景：`COOKBOOK_MODULES`/`CASES_MODULES` 加一行。
2. `composeStack` 纯函数；空槽位跳过。**导出包开箱即跑**：SCAFFOLD 树 when 双向对齐（build_project ⑥）；`V()` 变体 when 别漏传。
3. **断言反着验**：注入→红→还原→绿；还原用 `cp` 不用 `git checkout --`。
4. 源码当数据断言（project-check，先 stripComments）。加事实源改四处：sync + resolver + project-check + README 树。
5. **同文件多改动必须串行**（并行 Edit 静默丢改）。
6. 改装配台前 grep project-check 对该文件的**源码文本**断言；StackComposer 已不存在（拆成六文件，断言读「文件合集」，新增容器要同步 `STACK_SPLIT`/`STACK_9PX`/`PAGE_OWNERS` 三张清单）；focusDim 有 200×2 正则窗口，加注释都可能爆。
7. 加/改 verify 层改五处（package.json / verify-all LAYERS / report LAYER_NAMES / meta CHAIN_ORDER / arsenal.json verifyChain）+ README 两处。
8. 加/删断言同步四处数字；`finish()` 打「声明 X/实测 Y」退出 1。
9. git 纪律：逐文件 `add` + `commit -- <路径>`，核对 `diff --cached --stat`；目录 pathspec 会夹带 `_*`。
10. `recipes[].files[].code` 只放 good 版（bad 进 pitfalls）。
11. 子串判据会静默失效 → token 恰好相等 + 双反例。
12. 案例代码自证：`cookbook-lint.ts` 用 `file.path` 作 SourceFile.name；徽标数字一律算出来。
13. 动态路由绝不写 `dynamicParams=false`（dev 报缺 generateStaticParams）；404 由页面内 notFound() 兜。
14. **（09-29 事故沉淀）选项的 `yaml` 片段分两种消费**：非 Spring 配置（Dockerfile/Nginx/CI 等）必须标 `yamlNote: True`；构建插件（jacoco）依赖必须标 `mavenPlugin: True` —— build_project ⑦ 白名单断言守着，裸拼 application.yml = 解析即崩，无版本依赖 = Maven 解析即崩。**base `covered` 必须诚实**：骨架按 3.x 编写，boot41/40 已改 False，pom 回落 3.2.12（renderPom baseNote 写明回落）；升级 4.x 需先复核骨架。
15. **（09-29 第二轮）导出包有两个代码来源**：`stack_project.py` SCAFFOLD 与 `arsenal-scaffold/*.tpl`（backend-plan 渲染）—— 叠加必过「@Component 简单类名唯一」关，securityjwt（默认推荐）曾双装两套鉴权启动即崩，backend-plan 已做接管剔除 + 全局 path 去重。**默认值组合也要端到端冒烟**：defaultOption 必炸 = 产品必炸。
16. **（09-29 第三轮）导出预检闸 export-lint 是最后防线**：`src/lib/export-lint.ts` 五检查（重复 path/同名 bean/悬空 com.example import/pom 无版本/yml 异类顶层键），violation 非空 = 禁止下载并在台面亮清单（UI 不抛异常，useMemo 抛会崩页面）。**BOM 外 groupId 必须显式版本**（白名单见 export-lint BOM_MANAGED_PREFIXES；spring-cloud 有独立 BOM 故意不在列），yml 白名单与 build-content.py SPRING_ROOTS 两处同步。scaffold-check【7】守着（13→17）。

## 校验与运行

- `npm run verify` 九层 ≈ **1043** 项（35 架构+68 图+763 结构导出+36 场景+17 引擎+12 前后端+31 Archify+69 扫描+12 视觉；scaffold 层 17 含预检闸）；cases 穷举 9072 组。
- ⚠️ `.verify/**` 不在根 tsconfig → `npm run typecheck:verify`；safe-delete ≥50 文件会拦 → 九层别挤一个 turn。
- 后端：`SKIP_COMPILE=1 bash arsenal-server/scripts/run.sh`（JDK17 corretto）。改规则必重启。探活 node fetch。GlobalExceptionHandler 把 404/405/415 吃成 500。

## 环境铁律

- 每条命令前 `export PATH="/usr/bin:/bin:/c/Windows/System32:/c/Windows:$PATH"`；node 用 managed 22.22.2-3。
- `next dev/build` 只许 `node arsenal-web/scripts/next-run.mjs`，**它不跑 sync**。
- Git Bash 下 `npm run` exit 1 → 用 node 直跑 npm-cli.js 或脚本本体。
- `trailingSlash: true`；视觉新增路由要归进 shoot.mjs 清单。
- 无头浏览器用 `visual/browser.mjs`；curl 读写不了 /tmp；给 node/python 用 Windows 路径。
- 多会话并发：动文件前两次 md5；它的绿不归你背书。

## 待推进（详见 docs/开发计划-*）

- **案例库扩容+自建入口（09-26，最新）**：61/69 规则无案例（42 条 MUST/NEVER）→ 13 棒：W-0 共享判据 + W-3 脚手架先行，再铺内容，后 W-1 浏览器录入/W-2 私有目录/W-4 AI 草稿。
- 案例库升级 09-25（C-1 AI 出口/C-2 自证/C-3 互链 P1；C-4 thread-pool 保留）；场景 CONTENT 线 P1 补 6 日常场景；UI 分层 L1+L2 已做，L3 与图形化排次夜（`generateStaticParams` 必须数据驱动，写死数字=假绿）。
- CaseLab(分诊台)≠DemoRunner(跑 playground)，两库合并 C-7 未做。
- 装配台剩 S3-1 画布/S3-2 评分卡；P0-2/P2-1 待 mryang 拍板。B0-3 四场景无 benchmark；63/81 位图缺。
- **装配台重设计已定案并排期（09-29 晚，见 `docs/开发计划-2026-09-29-装配台重设计/`）**：拆法 A 四页（`/stack`选型台 / `/stack/env`环境与模块 / `/stack/run`运行与部署 / `/stack/delivery`交付中心）**已落地**，交付中心含预检闸首屏+导出历史；JourneyBar 随 P0 **已落地**；数据层（picks-store/drafts/history/wizard.ts）**确实零改动**。视觉矩阵随之 **21 URL / 63 张**（装配台 +3 页 +9 张、同一夜发现蓝图主题已回到 6 个而旧声明仍按 1 个抽 +3 张）。四棒链已跑完（棒1 P0 拆页 / 棒2 交付与运行页 / 棒3 blocked 未做 / 棒4 P2 视觉统一），**10-01 23:47 第二次终检结案**：十层 **1839 全绿 / 跳过 0**（结构与导出 1505），四页真落地真渲染、picks 跨页点击级一致、反着验三条全真。**P0 遗留 = 无**。棒3 的活儿被 09-30 白天补排棒做掉大半（三态卡 / 密码提示前置 / JourneyBar 角标），净剩一个待拍板口径（「19 维左导航」要不要逐维 19 行）。规程与棒次表见同目录 NIGHT-RUN.md / 00-index.md；状态目录 `.workbuddy/night-chain/2026-09-29/`（REVIEW.md 是补排夜开工判据，上一份归档为 REVIEW-2026-09-30.md）。唯一大块遗留 = 63 张矩阵逐张人工判读（34/63 已看，L 档）。
- 待人工决策：69 规则逐条过目；5 条无检查器 AST 规则补/降级。
