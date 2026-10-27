# CHANGELOG · 自动迭代改动

## r2 · 2026-10-27
- `arsenal-web/.verify/checkup-check.ts`：【9】端到端那组（9 条断言）的记账从 `knowinglySkipped()` 改为 `skipItems(…, 9)`。
  - 判定过程（先查「90 是真值还是 9 条断言被删」）：9 条 `check()` 仍在 [checkup-check.ts:627-644](file:///D:/workspace/2026/mryang-arsenal/arsenal-web/.verify/checkup-check.ts#L627-L644)，**没有断言被静默删除**；
    起后端（`SKIP_COMPILE=1 bash arsenal-server/scripts/run.sh`，3.6s 起来）再跑本层 → **实测 99 / 跳过 0 / 失败 0，exit 0**，端到端 9 条全真跑全绿
    → 档案声明的 99 是真值，不该改成 90（改了会在后端在的时候反向对不上）。
  - 红的是**归类**：`report.ts` 定义 `knowinglySkipped` 只装「配好环境也不会跑」（造用例代价过大）且**不进项数比对**；
    「后端未启动」是环境缺口，本层【11】那 7 条同类情况早就写明要走 `skipItems`（「记账不平比跳过更脏」）。归到 `skipItems` 后
    `total = 90 + 9 = 99 = 声明`，`verify:meta` 的 checkup 行恢复「对得上」、meta 层 73 项全绿 exit 0。
  - 没有为了让绿灯而放宽任何断言：后端不在时这 9 条依然显式记为「未执行」，退出码 2，不加 `--allow-skip` 依旧不放行。
  - 后端用完已关掉，3011 端口归还（环境与本轮开始时一致）。
- 代码改动 1 个文件 / +11 −3 行。资料文件（CHANGELOG / RUNLOG / BACKLOG / BLOCKERS / state）另计。

## r1 · 2026-10-27
- 新增 `state/RUN_STATE.json`：循环状态机（分支、截止时间、探测到的构建/测试命令、安全策略、计数器）。
- 新增 `BACKLOG.md`：基于实测（非猜测）建立的任务池，逐条标注 `[证据]` / `[待复核]`。
- 新增 `RUNLOG.md`、`CHANGELOG.md`、`BLOCKERS.md`。
- 抓取全量验证基线：`npm run verify` = 2270 项 / 通过 2260 / 跳过 4 / **失败 6** → 退出码 1。
  四个独立真根因（archify 标签重叠、scan fixture 真跑未执行、checkup 档案项数漂移、visual 截图台陈旧）已逐一定位并排入 BACKLOG P0-1…P0-5。
- 代码零改动：本轮只做初始化与基线验证。

## r3 · 2026-10-27
- `arsenal-web/src/lib/arch-canvas.ts`：`CanvasEdge` 新增可选 `labelDy`；`rerouteEntryThroughGateway()` 给入口链的非首段直连边（`ingress→gateway` / `gateway→app`）显式带 `labelDy = 24`。
- `arsenal-web/src/lib/archify-ir.ts`：适配器在「既不走车道也不走导轨」的直连分支把 `edge.labelDy` 透传成 `conn.labelDy`；几何值仍由画布模型给，**适配器不自己猜**。
  - 治的根因：绘图器对 IR 的硬约束 —— 直连边的默认标签位置骑在源节点框内，`layout/constraint` 当场判负
    （`Label "路由转发" overlaps component "ingress"`，校验器建议 `labelDy +24`）。14 例全绿，后端实跑 `07.json` 从「没出图」变成 732512 字节 / 检查 9/9。
- `arsenal-profiles/arsenal.json`：`Archify 链路` 声明项数 20 → **31**。
  - 这不是「改档案掩盖」：该层的逐例九项断言只在**该例全绿时**才产出（`archify-check.ts:295`），所以 20 是「有 11 例红着」时的残数；
    修好后 14 条逐例断言 + 汇总全部执行，实测 31 与档案对不上 —— 由本层自己的「记账对不上」红抓出来，改的是档案侧的真值。
- `README.md`：项数口径 2279 → 2290（3 处）+ archify 的 3 处 20 → 31。**未提交** —— 该文件同时带着用户在途改动（`docs/archive/` 目录树那一处），
  按 B-1 的规矩不做整文件 `--only` 提交，改动留在工作区等用户带走（`verify:project` 读的是工作区，链已复绿）。

## r4 · 2026-10-27
- **代码零改动**（判定轮）。`npm run verify:scan` 的 3 条红（13-1/13-2/13-7）判定为环境缺口：
  本机 `.m2` 缺 `spring-boot-actuator` / `-actuator-autoconfigure` / `-health` / `-micrometer-observation` 的 4.1.1 构件，
  `_rtcp.sh` 的 `_rt_add()` 静默跳过缺件，fixture 在 Spring 自动配置阶段抛 `EndpointCondition …` → `not-executed`。
  原 BACKLOG/B-4 猜的「硬编码 mvn」经实测推翻：`runtime-probe.sh` 走 `target/classes` + `.m2` 直起 java，不碰 maven。
- 资料改动：`BLOCKERS.md`（新增 B-7、B-4 前提修正）、`BACKLOG.md`（P0-3 判毕、新增 P1-5、P0-5b 表述修正）、`RUNLOG.md`（r4）。

## r5 · 2026-10-27
- `arsenal-web/.verify/archify-check.ts`：逐例九项断言改成**无条件产出**（红的那例、以及校验器拿不到 JSON 的那例都产出一条 `check(…, false, 原因)`）。
  - 治的是 P1-4：原先只有全绿的例子才 `check()`，一例红 → 那条断言**蒸发**而不是变红，本层项数从 31 掉到 20，
    账面反过来骗过 `verify:meta`，失败信息只剩汇总那一行点不出哪例（r1 的「archify 声明 20」就是这么来的残数）。
  - 注入回归实测过两种状态：把入口链 `labelDy` 临时改成 0 → `实测 31 / 通过 18 / 失败 13`、`declaredMismatch: null`、逐例点名到「预设·cloud」；
    改回 24 → `31 / 0 / 0`。**项数不再随红绿抖动**。临时注入已复原（`git status` 对 arch-canvas.ts 无输出）。
  - 没有放宽任何判定：红仍然是红，而且多了一条点名。改动面 1 文件 / +11 −4 行；注入用的临时改动已复原、不属于交付面。
- 档案 `Archify 链路` 声明值不动（仍是 r3 校正后的 31）。

## r6 · 2026-10-27
- 新增 `arsenal-web/scripts/verify-with-backend.mjs` + `package.json` 的 `verify:with-backend`：起后端 → 跑 `verify:parity` 与 `verify:checkup` → **按 3011 持有者 PID 关后端**。
  - 治 P0-5：这两层里 12 项「后端类未执行」不是代码跑不了，是没人愿意手动起再手动关。
  - 实测（本机，无需 maven）：`parity 16/16 跳过 0`、`checkup 99/99 跳过 0`、脚本自己把 3011 归还、退出码 0。
    改前常态是 `parity 13 通过 + 3 跳过`、`checkup 90 通过 + 9 跳过`。
  - 安全边界：3011 上已有服务 → 复用、**不抢也不杀**；`--keep` 显式保留并打印 PID；关停失败（端口仍被占）→ 退出 1 并点名 PID。
    后端起不来 → 直接退出 1 并甩出启动日志尾巴，**不把「跳过」写成「通过」**。
  - 未跑过的分支：`--keep` 与「已有外部后端」两条只做静态审查，没有实测（本机每次都是干净起停）。
- `README.md`：新增这段用法说明（**仍未提交**，同 B-6 —— 该文件捆着用户在途改动，现累计 7 处待带走）。

## r9 · 2026-10-27
- `arsenal-server/scripts/runtime-probe.sh`：JVM 参数补 `-Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8`（与 `archify-probe.sh` / `projects-probe.sh` / `scan-probe.sh` 同款写法）。
  - 实测根因：JDK 18+ 里 `-Dfile.encoding` **不再决定 `System.out` 的字符集**，它跟随控制台码页（本机 GBK）——
    探针吐出的 JSON 因此是 GBK 字节，前端 `spawnSync(encoding:'utf8')` 解出来 `reason` / `missingDeps` 里的中文全是乱码
    （复现：utf-8 解码报 `invalid start byte`，GBK 解码才通）。这是 r2 起就在的缺陷，之前没人拿中文文本去解它。
- `arsenal-server/src/main/java/com/arsenal/autopsy/RuntimeClasspath.java`：`findJar()` 的「退到本地最高版本」这条降级分支**开始如实上报**（新增 `downgraded` 收集，同时进 `missing()` 与 `note`）。
  - 原注释宣称「会被记进 note —— 用户能看见『这个版本是猜的』」，但那条分支一个字都没记，注释与代码不符（P1-5 的真实位置，见下条 B-7 更正）。
  - 只改披露，**不改选包逻辑**：类路径解析结果与之前逐 jar 相同，13-1/13-2/13-7 该红仍然红。
- `arsenal-server/src/main/java/com/arsenal/autopsy/RuntimeProbe.java`：进程起不来时，`reason` 先点名「哪几个构件降了版」再贴 Spring 异常原文。
- `arsenal-web/.verify/scan-check.ts`：13-1 的失败详情带上 `缺/降版构件 N 个：<清单>` 与 `探针原因：<reason 前 400 字>`。
  - 判定条件、项数（170）一律未动；改前失败信息只有 `status=not-executed port=null`，读的人分不清是项目 bug 还是环境问题。
- 本机实测（fixture `runtime-demo` 真跑）：`missingDeps` 从 2 条变 7 条 —— 2 条真缺（`spring-boot-health`、`spring-boot-micrometer-observation`）
  + 5 条降版（`spring-boot-actuator` / `spring-boot-actuator-autoconfigure` 4.1.1→3.3.6、`spring-jcl` / `spring-tx` 7.0.9→6.1.6、`micrometer-core` 1.17.1→1.13.8）。
  **崩溃主因正是那对 3.3.6 的 actuator-autoconfigure**（栈帧直接指着它），不是「缺构件」本身 —— B-7 原记录被本轮实测更正。
- 门禁：`verify:parity 13/0/3跳`（含 compile-check 100 源文件 → 208 class）、`verify:scan 167/0/3`（同 3 条红、无新增）、`typecheck` 与 `typecheck:verify` 均 exit 0。
- 代码改动 4 个文件 / +46 −9 行。

## r10 · 2026-10-27 17:04Z
- `arsenal-server/scripts/_rtcp.sh`：`_rt_add()` 的缺件分支从**静默跳过**改为攒进 `RT_MISSING`，
  脚本末尾一次性把清单说到 **stderr**（stdout 必须留给探针那份单行 JSON，混进去就把断言解挂了）。
  - 顺带修掉一处注释与代码不符：原话「缺了……不在这里静默跳过」描述的其实是 fixture 那一路（`RuntimeClasspath`），
    而这台跑探针的 JVM 自己的类路径**就是**在静默跳过 —— 与 r9 在 `findJar()` 修的同一类病。
  - 本机实测：stderr 现说出 `缺 5 个运行期构件` —— `spring-boot-{actuator,actuator-autoconfigure,health,micrometer-observation}:4.1.1`
    与 `micrometer-core:1.17.1`（这正是 r9 里 fixture 被迫降版的根因，两条证据对上）。
  - 拼装结果与判定**一字未动**：`RTCP` 内容不变、`runtime-probe.sh` 的 stdout 仍是可解析的单行 JSON（实测 `missingDeps` 7 条）。
- 代码改动 1 个文件 / +14 −1 行。

## r11 · 2026-10-27 17:06Z
- 新建 `docs/现状复核-2026-10-27.md`：把 `docs/功能缺口清单-2026-09-22.md`（35 天前）逐条按**今天的实测**过一遍——
  已被推翻的 5 条、仍然成立的 7 个数字、0922 之后新发现的 4 条，每条旁边挂一行复现命令。
  - 刻意不改写那份历史报告：它的取证纪律（含负向实跑）是价值所在，重写等于抹掉可复现证据链。
  - 本轮**代码零改动**；顺带确认链对 `docs/` 无项数口径断言，`verify:project 1547/0/0`、`verify:charter 197/0/0` 与基线同数。
  - `docs/arsenal-runtime.architecture.json` 的「MCP 尚未实现」已被改成「已接入」，但该文件带用户在途改动 → 不碰不提交（同 B-6）。

## r12 · 2026-10-27 17:10Z
- `docs/功能缺口清单-2026-09-22.md`：顶部加一段**复核指针**（+5 行，正文一字未改）。
  - 点名四条已被实测推翻的前提（前端不调 `/api/lint`、AST 零覆盖、项数是手写常量、全项目无 LLM 调用代码），
    并把链接指向 `docs/现状复核-2026-10-27.md`。
  - 为什么值得单独一轮：这份文档是后续 AI 会话最可能先读的那一份；不留指针，
    下一次会话就会照着「AST 没人守门」「MCP 没实现」重复建设一遍——0922 报告 §7 榜 #7 说的正是这个代价。
  - 沿用该文件自己已有的规矩（「落盘时由主会话复核，读本文时以这里为准」），只在复核区追加，不动取证正文。
- 门禁：`verify:project 1547/0/0`（链对 `docs/` 无项数口径断言，与基线同数）。代码零改动。

## r14 · 2026-10-27 23:55Z
- `42079cd` — 扫描闸门的**纯判定分支**补断言，`verify:scan` 170 → **173 项**（4 文件 / +98 −9）。
  - `arsenal-server/.verify/ScanProbe.java`：新增 `guard-pure` 动作，把 `ScanGuard.zipEntrySafe` 的
    9 条拒绝分支 + 1 条正常条目、`redact` 的 3 层（敏感键 / PEM 块 / 普通值）原始判定逐条回吐，探针不判对错。
  - `arsenal-web/.verify/scan-check.ts`：新增 3-8 / 3-9 / 3-10 三条断言。3-9 是反向断言
    （正常条目必须仍放行 —— 闸门全拒也是一样的红）。
  - `arsenal-profiles/arsenal.json`：`代码扫描` count 170→173，desc 写明**本轮未发现缺陷、补的是回归护栏**。
  - `README.md`：6 行纯数字（总数 2274→2293、project 1548→1547、scan 170→173、checkup 82→99）。
    用户在途的两段散文留在工作区，没进这次提交。
- 判定结论（P1-1 关闭方式见 BACKLOG）：「后端零单元测试」这句话的前提半过期 —— `src/test` 不存在是设计，
  `.verify` 五探针 + 173 项黑盒才是后端的保护网。真正的真空换成具名分支才可执行：
  `zipEntrySafe` 9 条分支黑盒只喂过 2 条，`redactValue` 的 PEM 层 0 覆盖。删掉盘符那一行正则，链照绿 —— 这就是补的意义。
- 两个「绿了但没验」的坑：① Java 注释里的 `\u0000` 会被词法前置展开，javac 当场报错；
  ② Edit 把 `\u0000` 静默写成 U+00A0，断言验的是个空格。落盘后按字节复核，最终写 `"a" + (char) 0 + "b.txt"`。
- 门禁：`typecheck:verify` 0；`verify:scan` 170 通过 / 3 失败（与基线同数）/ 实测 173 = 声明 173；
  `verify:meta` 73/0/0（中途亮过 3 项红，是我漏登记 sync 产物与 README 两处口径，按它说的补齐而非放宽）。
  失败面仍是 4（scan 3 + visual 1），0 新增。
