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

## B-7 [r4] 扫描层 13-1/13-2/13-7 的根因是**本机 .m2 缺 4 个 Spring Boot 4.1.1 家族构件**，不是 maven、也不是断言造假
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
