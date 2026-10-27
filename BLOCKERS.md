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
