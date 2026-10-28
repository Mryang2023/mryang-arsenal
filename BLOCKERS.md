# BLOCKERS · 需人工决策 / 高风险，循环不擅自处理

## B-1 [r1] 用户在 `main` 上有一份未提交的在途工作
- **事实**：31 个文件已暂存（`code-review-*.md` 等 7 篇重命名进 `docs/archive/`，另有 `.workbuddy/`、`arsenal-web/src/app/stack/ArchDiagram.tsx`、`ProjectTree.tsx`、`src/lib/twin-dossier.ts`、`zip-lite.ts` 等删除，累计 17703 行删除）+ 28 个工作区改动 + 3 个未跟踪文件。
- **为什么不处理**：这不是循环产生的，属用户正在做的事。`reset` / `stash` / 裸 `commit -a` 都可能吞掉或销毁它。
- **循环的处置**：`git checkout -b` 建分支（索引与工作区原样保留）；每次提交只用 `git commit --only <显式路径>`，绝不 `git add -A`。
- **需要人**：确认这批归档是否要单独成一个 commit。

## B-2 [r1] 视觉断言修复会一次重写 100+ 张 PNG
- **事实**：`arsenal-web/visual/manifest.json` 记 108 张，实际矩阵 111 张；断言明确要求重跑 `node visual/shoot.mjs`。
- **为什么不处理**：单轮上限 8 文件 / 300 行；批量重写截图产物面大、且需要浏览器（msedge）稳定环境。属「大量二进制变更」，不在无人监督下自动做。
- **需要人**：批准单独一轮跑 `node visual/shoot.mjs`，或确认这 3 张新路由本就不该进快照基线。

## B-3 [r1] 仓库无 CI 配置（`.github/` 不存在）
- **事实**：有 `docs/项目章程-CI落地指南.md` 和 `scripts/calc-ci-history.mjs`，但仓库根没有任何 CI 工作流文件。
- **为什么不处理**：CI 属外部系统 / 需选平台（GitHub / GitLab —— 日志里出现过 `gitlab-ci` fixture），且推送被安全红线禁止。
- **需要人**：决定用哪个平台、以及 verify 链要挂在哪个触发条件上。

## B-4 [r1] 后端「真跑」类断言依赖本机 Maven —— 待判定是环境还是代码
- **事实**：`mvn` 不在 PATH（只有 `arsenal-server/mvnw`）；`.m2` 本地仓库存在；扫描层 13-1/13-2/13-7 需要 bash + JDK + .m2 才能把 fixture spring-boot 项目真跑起来，现全部 `not-executed`。
- **为什么不擅自处理**：若为迁就本机而放宽断言或加跳过，就是「把没跑当成通过」——正是 verify 链注释里点名要防的两种说谎的绿。
- **r2 新证（部分改写本条前提）**：本机起后端服务**不需要 mvn** —— `SKIP_COMPILE=1 bash arsenal-server/scripts/run.sh` 3.6s 起、3011 正常（吃现成 `target/classes`，JDK 走 `_cp.sh`）。所以「后端真跑」类断言（parity / checkup 端到端）不是被 maven 卡住的，只是脚本没写；**本条剩下的真缺口只有 scan 层 fixture 需要从源码编译起 Spring Boot**。
- **计划**：r4 先复现、定位探针到底调哪个 maven 命令；若是探针硬编码 `mvn`，则改为走 wrapper（属代码缺陷，可修）；若纯是本机缺件，则留红并写清复跑条件。
- **r4 判定完成（本条前提被推翻）**：这条链路**根本不经过 maven**（`runtime-probe.sh` 用 `target/classes` + `.m2` 直起 java）。真缺口见 **B-7**。

## B-5 [r2] 排程工具 `mcp__builtin__qoder_cron` 在本轮会话不可见 —— 120s 唤醒机制断裂
- **事实**：r1 用 `mcp__builtin__qoder_cron` 成功建过 r2 任务（job_id `42beb80d-…`，revision 2）。r2 收尾时 `mcp_get` / `mcp_call` 都报 "not found"，`mcp_list` 全量 98 个工具里没有任何 cron / 定时类工具（builtin 只剩 chat/session/team_task 等 12 个）。
- **不擅自替代**：`create_chat_session` 是**立刻**起新会话，没有延时 —— 用它续跑等于把 120s 节奏改成背靠背，还会让多轮叠在同一时刻；直接写 `.qoder-cn` 里的应用私有存储属于改别人家的状态。两条都不做。
- **本轮的处置**：r3 起改为**同一会话内连续轮次**（先做完再歇），RUN_STATE.wakeup.mechanism 标成 degraded，节奏与「独立唤醒」不再一致；每轮仍然自己读状态文件、自己提交。
- **需要人**：确认这个定时工具是被下线了还是本会话没挂载；若要恢复「独立唤醒 + 120s」，需要把它重新暴露出来。

## B-6 [r3] README 的项数口径改动留在工作区，循环无法单独提交
- **事实**：r3 需要把 README 的 6 处数字（2279 → 2290、archify 20 → 31）跟着档案一起改，否则 `verify:project` 的「README 项数口径 == 声明总数」判负。
  但 `README.md` **同时带着用户在途改动**（`docs/archive/` 目录树那一处，属 B-1 那批）—— 对它做 `git commit --only README.md` 会把用户那份一起提交掉。
- **循环的处置**：只提交 `arsenal-profiles/arsenal.json` + 两个 src/lib 文件；README 的改动**原样留在工作区**（verify 链读工作区，链已复绿；HEAD 里没有这 6 处）。
- **需要人**：用户提交自己那批 README 改动时把这两组数字一并带走；或确认由循环单独带走。

## B-7 [r4，根因已被 r9 更正 → 见文末「B-7 更正」] 扫描层 13-1/13-2/13-7 的红是本机镜像不全，不是 maven、也不是断言造假
- **实测证据**（`bash arsenal-server/scripts/runtime-probe.sh …/runtime-demo demo.DemoApplication spring-boot 60000` 手跑一次）：
  进程真起来了、真失败，失败在 Spring 自动配置阶段：
  `IllegalStateException: EndpointCondition must be used on @Bean methods when the endpoint is not specified`
  ← `Error processing condition on o.s.boot.servlet.autoconfigure.actuate.web.mappings.ServletMappingsAutoConfiguration`
  → 采集器如实报 `status=not-executed`（13-2 的 `stoppedBy=exited`、13-7 的 `端口 null vs null` 都是它的级联，三条红一个根因）。
- **为什么**：`arsenal-server/scripts/_rtcp.sh` 把运行时类路径钉在 `B=4.1.1`，但本机 `.m2` 里
  `spring-boot-actuator` / `spring-boot-actuator-autoconfigure` **只有 3.2.0 / 3.2.12 / 3.3.6**，
  `spring-boot-health` / `spring-boot-micrometer-observation` **目录都没有**。
  `_rt_add()` 对缺的 jar 是 `if [ -f ]` **静默跳过** —— 于是 spring-boot-servlet 的 actuator 集成类在场、它依赖的 actuator 构件缺席，
  Boot 处理 condition 时炸。`mvn` 根本不在链路上（这条探针刻意无 maven，`target/classes` + `.m2` 直起）。
- **为什么不擅自修**：补齐需要联网拉 4 个构件（改依赖来源属供应链动作，且本循环不装来源不明依赖）；
  混用 3.x actuator 与 4.1.1 家族更是把不匹配藏进类路径。放宽 13-1 的断言同样不许。
- **需要人**：批准拉取 `spring-boot-{actuator,actuator-autoconfigure,health,micrometer-observation}:4.1.1`（或确认这台机器就该让这 3 条红着、把这 3 项登记为环境未覆盖）。
- **顺带可做的代码项**（不阻塞，见 BACKLOG P1-5）：`_rt_add` 静默跳过缺件 —— 让它把「缺了哪几个 jar」如实进 `missingDeps`，
  这样 13-1 的失败信息一眼可读，而不是被 Spring 的 condition 异常带偏。

## B-8 [r7] 20 条 AST 规则的 `engine` 数据自称 `javaparser`，与实际 `jdk.compiler` 名实不一 —— 改的是规则语料，需本人拍板
- **事实链（全部 2026-10-27 实测）**：
  `arsenal-rules/**/*.json` 9 个文件共 **20 处** `"engine": "javaparser"`
  → `arsenal-web/src/generated/rules.json` **20 处**（同一份数据同步产物）
  → 规则详情页 `arsenal-web/src/app/rules/[id]/page.tsx:207` 把它渲染成 `engine=javaparser`（兜底默认值也写死同一个词）
  → 后端导出 `ExporterService.java:270` 把「（引擎 javaparser）」写进 6 个载体的导出产物
  → `Rule.java:80` javadoc 与 `:85-87 engineOrDefault()` 的默认值同错。
  而真正跑的那台引擎是 `AstEngine.java:37` 自述的 **JDK 自带 `jdk.compiler`，零新增依赖、不需要 JavaParser**。
- **为什么这是产品面而不是注释面**：它出现在**用户看得见的页面与导出文档**里，且是「引哪个依赖」的信号 —— 后续 AI 会话很可能据此以为要引入 JavaParser。r7 复核 P1-2 时前端 `src` 里的 JavaParser 字样已全部清零，唯独这份**数据**还留着。
- **为什么不擅自修**：① 这 20 处是规则语料内容，`arsenal-profiles/arsenal.json` 自认「69 条没过目就不算军火库」，改语料字段属本人决策；
  ② 改后要走 `npm run sync` 重生成 `src/generated/rules.json`，并**同时**改后端默认值与前端兜底字符串，否则三处不一致；
  ③ 导出产物由 `verify:parity` 逐字节守着，语料一改 markdown 必变，需要确认口径（`javaparser` → `jdk.compiler` 还是 `arsenal-ast`）。
- **需要人**：拍板一个引擎名口径。建议值：`jdk.compiler`（与 `AstEngine` 自述一致、零依赖事实）。
  拿到口径后循环可一次做完：20 处语料 + `Rule.engineOrDefault()` + `Rule.java:80` javadoc + `page.tsx:207` 兜底 + `npm run sync` + 复跑 `verify:parity`/`verify:project`。

## B-7 更正 [r9] 真根因是**降版混用**，不是「缺 4 个构件」—— 需要人批的清单随之变化
- **本条上面的 r4 记录有一半是错的**，且错法正是它自己要防的那种：拿「读不出的失败信息」倒推了根因。
  r9 把披露修好后同一条命令实测：`missingDeps` 从 2 条变 7 条 ——
  - 真缺（本地一个版本都没有）：`spring-boot-health`、`spring-boot-micrometer-observation`；
  - **降版**（要的那版没装，`RuntimeClasspath.findJar()` 悄悄退到本地最高版）：
    `spring-boot-actuator` 4.1.1→**3.3.6**、`spring-boot-actuator-autoconfigure` 4.1.1→**3.3.6**、
    `spring-jcl` 7.0.9→6.1.6、`spring-tx` 7.0.9→6.1.6、`micrometer-core` 1.17.1→1.13.8。
- **崩溃主因是那对 3.3.6 的 actuator-autoconfigure**：栈帧 `OnAvailableEndpointCondition… [spring-boot-actuator-autoconfigure-3.3.6.jar]`
  直接指着它，被 4.1.1 的 `spring-boot-autoconfigure` 处理 condition 时炸出 `EndpointCondition must be used on @Bean methods…`。
  原记录说的「`_rt_add` 静默跳过导致类路径里 actuator 缺席」不成立 —— fixture 的类路径不是 `_rtcp.sh` 拼的那份，
  而是探针里 `RuntimeClasspath.resolve()` 现解析的 42 个 jar，那份里 actuator **在场，但是 3.x 的**。
- **需要人的清单更正为**（仍是「批准联网拉构件」这一件事，但项目变多且优先级变了）：
  1. `org.springframework.boot:spring-boot-actuator:4.1.1`、`spring-boot-actuator-autoconfigure:4.1.1` —— 拉到这俩，13-1 大概率直接转绿（混版消失）；
  2. `spring-boot-health:4.1.1`、`spring-boot-micrometer-observation:4.1.1`、`io.micrometer:micrometer-core:1.17.1`；
  3. `org.springframework:spring-jcl:7.0.9`、`spring-tx:7.0.9`（与已在场的 spring-core 7.0.9 同代）。
  或按原样认可：这 3 条红是**本机镜像不全**，不是代码缺陷（断言已不再伪装成绿）。
- **循环仍不擅自拉**：改 `.m2` 内容属供应链动作（安全红线第 3 条），且混用 3.x/4.x 本身就是这次要防的病。

## B-9 [r15] r14 的一条断言依赖**未提交的产品代码** —— 干净检出本分支会红一条，需人决定怎么带走
- **事实**：`verify:scan` 的 3-10（PEM 值级脱敏）调的是 `ScanGuard.redact` 走到 `redactValue`；
  而 `git show HEAD:arsenal-server/src/main/java/com/arsenal/scan/ScanGuard.java` 里**没有** `redactValue` / `PEM_BLOCK` ——
  那 11 行至今只在工作区（`git diff` 唯一一处 hunk）。全仓库没有任何提交引入过它（`git log --all -S "PEM_BLOCK"` 空）。
- **归属已核**（不是循环漏提交）：`stat` 显示 `ScanGuard.java` 的 mtime = **2026-10-25 23:29 +0800**，
  早于本循环开工（2026-10-27 15:34Z）两天 → 属 **B-1 那批用户在途工作**。r14 用 `--only` 绕开它是对的。
- **后果**：本机 `verify:scan` 绿（176/3，链读工作区）；**干净检出 `auto/iterate-20261027-mvquivjb` 会红一条**，
  且红的是「行为」而不是「护栏」—— 因为 HEAD 的 `redact()` 根本不做值级脱敏。
  这条分支目前不是自洽的：`.verify` 层（已提交）引用了产品层（未提交）的能力。
- **循环不擅自处理**：对 `ScanGuard.java` 做 `git commit --only` 会把用户那份一起提交掉（与 B-1 / B-6 同一死结）。
- **需要人**（三选一，循环都能接着做）：
  ① 用户把 `redactValue` 那 11 行随自己那批一起提交 —— 分支自洽，3-10 变成真护栏，无需任何改动；
  ② 授权循环单独把这 11 行提成一个 commit（只含 `ScanGuard.java`，消息写明是替用户在途工作做的归属拆分）；
  ③ 判定「PEM 值级脱敏暂不是产品承诺」→ 把 3-10 连同探针那张 `redact` 表一起撤下（**不是放宽、是撤销断言**，
     需要明说，因为这条守的是「私钥不许进扫描输出」这类外泄面）。

## B-5 补充 [r15] 排程工具是**时好时坏**，不是永久下线 —— 影响「谁来决定下一轮何时开始」
- **新事实**：r14 收尾时（2026-10-27T23:55Z）`mcp__builtin__qoder_cron` 可用并成功排出 r15（job `8a477844…`，00:01:30Z 触发，本条正是被它唤醒的）；
  r15 收尾时（00:18Z）同一个工具在 `mcp_list`（含 keyword `cron` / `schedul` / `builtin`）与 `mcp_get` 里都不存在，builtin 只剩 12 个 chat/session 类工具。
  → 结论修正：这不是「r2 起就没了」，而是**按会话挂载**。对本条 B-5 里「确认是被下线还是本会话没挂载」的疑问，r15 给的答案是后者。
- **本轮的处置**：不用 `create_chat_session` 顶替（它是**立刻**起会话，没有延时；r2 已定过这条判据，不重复讨论）；
  也不写 `.qoder-cn` 应用私有存储。按 B-5 既有安排回到「同会话连续跑」，节奏与独立唤醒不一致这件事如实记在 RUN_STATE.wakeup。
- **需要人**：如果要保持「独立唤醒 + 120s」，得让这个工具在每个会话都挂载（或给循环一个可用的延时唤醒入口）。

## B-10 [r17] `ProjectCache` 的 javadoc 说三份 id 消毒「同一口径」—— 实测两份相同、第三份是另一回事，需人决定改注释还是统一语义
- **事实（r17 用 `id-sanitize` 探针实测，九条向量）**：
  - `ProjectCache.safeSegment`（:75）与 `ProjectStore.safeId`（:213）**逐向量完全相同**：剥离非 `[A-Za-z0-9_-]` 的字符，
    `null` 与 `..` 都剥成空串（`../../etc/passwd` → `etcpasswd`，反斜杠向量 → `Windowswinini`，`a<NUL>b` → `ab`）。
  - `QaService.safeSegment`（:1036）**不是同一件事**：`!s.matches("[A-Za-z0-9_-]{1,64}")` 直接 `throw IllegalArgumentException`
    （HTTP 层 → 400）。九条向量里八条被拒，只有合法 id 原样放行；差别不止「拒 vs 剥」，**64 这个长度上限只存在于这一份**
    —— 65 个合法字符的 id，剥离版原样放过、QA 版拒绝。
  - 而 `ProjectCache.java:73` 的注释写的是「与 `ProjectStore.safeId` / `QaService.safeSegment` 同一口径」。
- **判为缺陷了吗**：没有可利用缺陷。① 拒比剥严，越界路径一条都没有（九条向量 `dirInsideRoot` 全为 true）；
  ② 真实 projectId 由 `ProjectIds.projectIdOf` 恒生成 12 位十六进制，走不到分歧；
  ③ `ProjectController.delete` 先 `registry.find(id)` 再删，剥成空串的 id 进不了删除路径（否则 `deleteCache("")` 会作用到缓存根）。
  → 这是**口径声明与实现不符**，不是安全洞。
- **为什么不自己改掉**：两种改法都不是循环能单方面决定的。
  ① 改注释（把「同一口径」限成「与 `ProjectStore` 同一口径；QA 侧走拒绝」）—— 动的是 `ProjectCache.java`，
     该文件正带用户在途 49/17 行改动，循环提交它会把别人的工作一起带走（与 B-9 同一类归属问题）；
  ② 统一语义（QA 改成剥离）—— 是把 400 变成静默改写，属**行为变更**，且会让 QA 侧丢掉长度上限。
- **本轮的处置**：不改产品代码、不改注释，把现状钉成断言（5-8 永不越界 / 5-9 两份相同 / 5-10 第三份确实不同）。
  5-10 是**故意钉住分歧**的：谁将来把三份统一成语义一致，这条会红，逼他同时处理那句注释 —— 这不是放宽断言，
  是把「注释说的话」和「代码做的事」之间的裂缝放在灯下。
- **咬得住的证据（注入回归）**：把 `ProjectCache.safeSegment` 的白名单放宽到含点号（`[^A-Za-z0-9_.-]`）后复跑
  `verify:scan` → **5-8 与 5-9 双双转红**（fail 3 → 5），按 sha256 复原为字节 identical
  （`86bc4128…`，与 r16 记录的同一枚），用户的 49/17 行在途改动未受波及。

## B-11 [r18] 跨语言 projectId 有两处真实漂移（NBSP 与 null kind）—— 同一个地址在两套系统里会得到两个身份，需人决定对齐方向
- **事实（r18 用 `id-project` 探针真跑 Java 侧 `ProjectIds`，与 Node 那份 `autopsy-snapshot-shape.mjs:51` 逐向量对拍，十五根向量里十三条相同）**：
  - **NBSP（U+00A0）**：`path:<NBSP>D:/work/order-service<NBSP>` 这类值，
    Java 的 `String.trim()` **只剥 ≤ U+0020**（`ProjectIds.java:35`），NBSP 原地保留；
    JS 的 `String.prototype.trim()` 把 NBSP 连同其它 Unicode 空白**一起剥掉**。
    实测两侧算出的 id：Java `fb75c9a843de` vs Node `e081b28924ec` —— **同一个路径得到两个身份**。
  - **kind 为 null/undefined**：Java 拼 `""`（`kind == null ? "" : kind`）→ 规范串 `:D:/work/order-service`（id `30a3b5a70bef`）；
    Node 拼 `String(sourceKind)` → `null:D:/work/order-service` 或 `undefined:…`（id `1c9c85042273`）。
- **可达性**：
  - NBSP 那条**真实可达** —— 从文档/聊天工具里粘贴一个带 U+00A0 的本地路径是常见输入，前端 `AutopsyLab.tsx` /
    `src/lib/autopsy-snapshot.ts` 用 Node 那份算 id，后端 `.data/projects/<id>` 与 `.data/qa/<id>` 用 Java 那份，
    两边一错位就是「缓存明明摄入了却查不到 / QA 历史对不上项目」，也就是 `ProjectIds` javadoc 自述要根治的那个暗伤的**残留通道**。
  - null kind 那条目前不可达（`ProjectController` 校验 kind 只能是 path/git），属同一函数的第二处不一致。
- **为什么不自己改**：往哪边对齐都不是循环该单方面决定的。
  ① 把 Java 改成剥 Unicode 空白（`strip()` 或正则）→ 会让**已存在的带 NBSP 缓存目录**与新算出的 id 对不上，
     且与 javadoc 里「与既有 `QaService.projectIdOf` 逐字节一致、旧 QA 历史不作废」这条约束冲突；
  ② 把 Node 改成只剥 ≤ U+0020 → 浏览器与 Node 侧的快照 id 会跟着变，`.data` 之外的历史快照文件名同样受影响；
  ③ 归一化更彻底（顺手剥 BOM U+FEFF、连续空白折叠）→ 是**产品口径变更**，需要与「未脱敏原值算 id」这条既有取舍一起定。
- **本轮的处置**：不改两边任何一份。5-11 把 Java 的规范化串逐条钉死、5-12 钉十三条两套相同、
  5-13 用 node:crypto 独立算基线 id（不让被验实现自证）、**5-14 如实钉住这两处漂移**（含 `30a3b5a70bef` 这个具体值）——
  谁将来对齐，5-14 会红，逼他确认对齐方向并处理历史数据，而不是静默改一边让两套系统悄悄分家。
