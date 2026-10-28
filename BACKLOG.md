# BACKLOG · 自动迭代任务池

> 每轮从最高优先级里挑**一个**能在单轮时间盒（约 15–25 分钟）内完成的小任务。
> 标注 `[证据]` = 本轮循环亲自核实过；`[待复核]` = 来自历史文档，动手前必须先验证仍然成立。

## 基线事实（r1 建立，2026-10-27）

| 项 | 状态 |
|---|---|
| `arsenal-web` typecheck | 绿（10.3s） |
| `arsenal-web` verify 链 | 13 层串行 runner，需 `--allow-skip` 才能在本机全绿 |
| `arsenal-server` 单元测试 | **0 个**，`src/test` 目录不存在 `[证据]` |
| `spring-boot-starter-test` | 已声明为 test 依赖，但无一个测试用到它 `[证据]` |
| CI 配置 | 仓库根**无** `.github/`（但存在 `scripts/calc-ci-history.mjs`） `[证据]` |
| 服务 | 后端 3011 / 前端 3010 均未运行 → parity/archify/scan/visual 层必然跳过 `[证据]` |

---

## P0 · 安全 / 数据丢失 / 构建失败

**基线总账（r1 实测，2026-10-27 15:41Z，耗时 227.7s）：`npm run verify` = 2270 项 / 通过 2260 / 跳过 4 / 失败 6 → 退出码 1。链是红的。** 四个独立根因：

- **P0-1 [证据] ~~体检报告层「声明 99 / 实测 90」~~ → r2 已修（改归类，未改档案）。**
  判定结论：**档案 99 是真值，9 条端到端断言一条都没丢**（`checkup-check.ts:627-644`）。
  起后端实跑 `verify:checkup` = 99/99 全绿 exit 0；后端不在时该组按 `report.ts` 的语义应进 `skip` 计数（与同层【11】的 7 条同类），
  原先误用 `knowinglySkipped()`（那个不进项数比对，专指「配好环境也不会跑」）→ 账恒差 9。
  修法：`knowinglySkipped` → `skipItems(…, 9)`；`verify:meta` 恢复全绿（73 项 / 0 失败）。详见 RUNLOG r2。
  遗留：常态（后端未起）本层 9 项未执行 → 链需 `--allow-skip`，属 P0-5 环境项，不是代码缺陷。

- **P0-2 [证据] ~~Archify 链路 2 项失败 —— 边标签与组件重叠~~ → r3 已修（改出图几何，未放宽校验器）。**
  根因：入口改道链里 `ingress→gateway` / `gateway→app` 是**没有 via 的直连边**，绘图器把标签默认放在源框内 → `layout/constraint` 判负。
  修法：`CanvasEdge.labelDy`（arch-canvas.ts）+ 适配器直连分支透传（archify-ir.ts:420），取校验器建议值 24。
  连带：该层逐例断言只在「该例全绿」时产出 ⇒ 残数 20 不是真值，全绿实测 **31**；档案与 README 口径一起校正（2279 → 2290）。
  「字节无损」经核对是**产物自洽 sha**（写回一致），不是 golden 快照 ⇒ 无快照耦合面。
  ⚠️ README 的 6 处数字改动未提交（捆着用户在途改动）→ BLOCKERS B-6。**→ r3 候选**

- **P0-3 [证据] ~~代码扫描层 3 项失败（13-1 / 13-2 / 13-7）~~ → r4 判定完成：环境缺口，已登记 B-7，不动代码。**
  三条红同一根因：`_rtcp.sh` 把运行时类路径钉在 Spring Boot 4.1.1，而本机 `.m2` 缺
  `spring-boot-actuator` / `spring-boot-actuator-autoconfigure`（只有 3.x）/ `spring-boot-health` / `spring-boot-micrometer-observation`（完全没有），
  `_rt_add()` 静默跳过缺件 → Boot 处理 actuator condition 时抛 `IllegalStateException`，fixture 起不来，采集器如实报 `not-executed`。
  **`mvn` 不在这条链路上**（`runtime-probe.sh` 用 `target/classes` + `.m2` 直起 java）—— 原任务描述里「可能硬编码 mvn」的前提被实测推翻。
  修法需人批准（联网拉 4 个构件 or 认可这 3 项就是本机未覆盖）；见 B-7。

- **P0-4 [证据] 视觉断言层 1 项失败 —— 截图台陈旧。**
  `visual/manifest.json` 记 108 张，本次矩阵 111 张 → 页面路由增删后没重跑截图台。
  修法机械：`node visual/shoot.mjs`。
  ⚠️ 代价：会一次改动 100+ 张 PNG，**远超单轮 8 文件上限**，且属批量产物重写 → 需单独一轮并先中人工确认（已登记 BLOCKERS）。

- **P0-5 [证据] ~~前后端一致性层 3 项跳过 + 体检端到端 9 项未执行~~ → r6 已交付 `npm run verify:with-backend`。**
  实测：parity 16/16 跳过 0、checkup 99/99 跳过 0，脚本按 3011 持有者 PID 收尾并归还端口。
  不改 verify 链的判定，只把「起—跑—关」绑成一个动作；`--keep` 与「已有外部后端」两条分支未实测（见 RUNLOG r6）。
- **P0-5b [证据，r2 新证] 后端「真跑」本机可用，不需要 maven。**
  `SKIP_COMPILE=1 bash arsenal-server/scripts/run.sh` 实测 **3.6s 起、3011 正常服务**（吃现成 `target/classes` + `.m2` 里的 Spring Boot 4.1.1；JDK 由 `_cp.sh` 定位，本机 corretto-21.0.4）。
  ⇒ P0-5 与 parity 的 3 项跳过、checkup 的 9 项未执行只差这条「起—跑—关」脚本。
  （r4 修正：scan 层的 fixture 真跑也不经过 maven，卡在 `.m2` 缺 4 个 4.1.1 构件 —— 见 B-7，不是 B-4 说的那件事。）
  ⚠️ 用完必须真关：后台任务只杀 bash 包装，java 子进程要按 3011 监听 PID `Stop-Process` 掉，否则端口留成常态。

（无已知安全漏洞。`ScanGuard` 的路径逃逸 / 超大文件 / file:///ssh:///git:// 拒绝等安全断言在 r1 基线全部为绿。）

> **r2 后的账**：checkup 层不再判负（99 == 99，常态下 90 通过 + 9 环境未执行），meta 层 73 项全绿。
> 链的**失败面**只剩 archify 2 / scan 3 / visual 1 三条独立根因（= P0-2 / P0-3 / P0-4）；**跳过面**变大（4 → 13），是同一批环境缺口的诚实记账，不是新增红灯。
> 全量 `npm run verify` 需重跑确认（228s > 120s 唤醒间隔，留给专门的确认轮）。
> **r3 后的账**：Archify 链路那 2 条红消除（修的是出图几何，不是校验器），且该层项数从「残数 20」校正为全绿真值 **31**，README 口径随之 2279 → 2290。
> 失败面 = scan 3 + visual 1 = **4**（r1 是 6）；未跑 = parity 3 + checkup 9（都要后端）+ visual 1。
> **r4 后的账**：scan 那 3 条红判定为**环境缺口**（B-7：`.m2` 缺 4 个 Spring Boot 4.1.1 家族构件，与 maven 无关），代码零改动、不放宽断言。
> 于是**真代码红只剩 visual 1**（P0-4，需批准 B-2 的批量截图重写）；剩下的都挂在「本机跑不了」上：scan 3 条红（B-7）+ parity 3 与 checkup 9 共 12 项未执行（后端类，见 P0-5b）。

---

## P1 · 稳定性 / 错误处理 / 测试覆盖

- **P1-1 [证据，r14 复核完成] ~~后端零单元测试~~ → 前提半过期；真实缺口是两处具名分支，已补。**
  「没有任何 `src/test`」是真的，但由此推出「后端裸奔」不成立 —— 产品的后端逻辑由
  `arsenal-server/.verify/*.java` 五个探针（`ScanProbe` / `ProjectsProbe` / `RuntimeProbe` / `AstProbe` / `Q1Probe`）
  从前端链黑盒驱动，`verify:scan` 173 项里绝大部分在验后端。刻意的架构选择：产品代码只在 `src/main/java`，
  验证代码在 `.verify/` 且**不写成 JUnit**（不存在 `src/test` 是设计，不是遗漏）。
  **逐分支数过的真空**（r13 判定，r14 补）：① `ScanGuard.zipEntrySafe` 的 9 条拒绝分支里，
  黑盒只喂过 2 条（`../escape.txt`、`/abs.txt` —— 见 `ScanProbe` 的 `makeZip`，escape.zip 里只有这两个条目名）；
  Windows 反斜杠（`..\..\x`）、大小写盘符（`C:/`）、UNC（`//`）、NUL、空串、点分段（`./x.txt`）
  这 7 条**在全仓库 0 条断言**
  —— 黑盒看不到，因为条目名只要出圈，观测到的永远是同一个整包 `SCAN_BAD_REQUEST`，区分不出是哪条分支生效；
  ② `redactValue` 的 PEM 私钥块脱敏（键名不敏感、值里藏私钥那一层）同样 0 条断言。
  **处置**：新增 `guard-pure` 探针动作把这两处逐分支摊开，前端 3-8/3-9/3-10 三条断言接住
  （含一条反向断言：正常条目 `src/Ok.java` 必须仍放行 —— 闸门全拒也是一样的红）。实测**未发现缺陷**，
  9 条分支与 3 层脱敏行为全部正确，补的是回归护栏。
  **r15 接着数完（P1-1b，判定轮 + 补 6 条）**：`ScanGuard` 剩下的纯判定按分支数下来，四处真空都补了
  （3-11~3-16，`verify:scan` 173→179）—— `readable` 的具名文件与前缀分支、`skippableOversize` 的「二进制跳过」那半条、
  `gitUrlAllowed` 的**正向**、`fileTooLarge` 与 `isInside` 的 `catch`（fail-closed）。判定与理由见 RUNLOG r15 的分支表。
  **一个新事实（决定不改）**：`depth(root, root)` 实测 1 不是 0（空相对路径在 `AbstractPath` 迭代器里算一段）；
  闸门是 `> MAX_DEPTH`，改它只会挪掉 5-2 的 22 层边界 → 按实测值钉住。
  **本轮未发现缺陷**，补的是回归护栏。至此 `ScanGuard` 的纯判定全部有守卫。
- **P1-1c [证据，r16 复核完成] ~~超限二进制的「跳过并记账」摄取侧 0 条断言~~ → 已补满，未发现缺陷。**
  判据函数 `skippableOversize` 早在 3-12 钉住，但记账本身没人守：`ProjectCache.java:140 skippedCount[0]++` /
  `:167 manifest.skipped` / `:201 cache.skippedFiles` 三处删掉任何一处，链全绿 —— javadoc 承诺的
  「跳过的事实会记进 manifest 与 cache 统计，不是静默消失」是一句无守卫的话。
  **r16 处置**：探针动作落在 `ScanProbe` 的 `oversize-skip` / `oversize-clean`（不是原计划的 `ProjectsProbe` ——
  那一层要带进 `verify:checkup` 常态 9 项未执行，门禁更贵且本轮够不着；`guards` 那次 trips 已经付过 4 分钟成本，搭同一趟车）。
  前端 5-5（记账三处齐活 + 正常文件不受牵连）/ 5-6（**跳过不绕限额**：3MB 二进制的字节仍计入 quota）/
  5-7（反向对照：干净夹具 `skippedFiles==0` 且 manifest 无 skipped 行）三条断言接住，`verify:scan` 179→**182**。
  **注入回归验过它们真的咬**：删掉 `skippedCount[0]++` → 5-5 红；把跳过文件的字节从 `total[0]` 里摘掉 → 5-6 红；
  两轮都按 sha256 备份并复原 `ProjectCache.java`（字节级 identical，用户的 49/17 行在途改动未动）。
- **仍开放的下一步**（若还要往这方向走）：`AstEngine` / `ProjectStore` / `QaService` 的同等逐分支判定未做过，
  本轮只把 `ScanGuard` 数干净；不要据此三句泛泛说「零测试」再开任务。
- **P1-2 [证据，r7 复核完成] ~~前端 AST 层 0/20（待复核）~~ → 前提过期，判为「设计意图 + 缺口已闭环」，不是缺口。**
  出自 `docs/功能缺口清单-2026-09-22.md` §1.1（35 天未更新）。2026-10-27 逐条实测：
  ① 语料现状未变：69 条规则 / 正则 35 / AST 20 / `AstEngine` 注册 15 个检查器（另 5 条需类型解析，诚实进 skipped）。
  ② 前端本地确实只跑正则层，`engine.ts:163-183` 把 ast/llm/manual 一律如实披露为不伪造判定 —— 这是**离线优先的刻意设计**（静态站首屏零网络请求）。
  ③ 文档 §3.3「前端从不调 `POST /api/lint`」**已不成立**：`arsenal-api.ts:617 lintRemote()` 存在，`CheckConsole.tsx:10 / :76 / :287-288` 三态接线（idle/running/report + 「代码已改动」过期标记 + RemotePanel）。→ 20 条 AST 规则的结论**用户可达**。
  ④ 文档 §6.2「AST 层零自动化覆盖」**已不成立**：`arsenal-server/scripts/ast-probe.sh` 存在并接进 `verify:parity`【6】；r7 实跑 `npm run verify:parity` → 该 2 项全绿、层 `13 通过 / 3 未执行（后端类）/ 0 失败`。
  ⑤ `arsenal-profiles/arsenal.json:377` 的 L2 AST `status` 已是 `done`（文档 A3 那条「渲染在 /arch 上的 todo」已修）。
  ⑥ 前端 `src` 全域再无 `JavaParser` 字样（文档 A5–A8 已修）。
  ⇒ 本条**关闭、不降级为 P3 文档项**（因为文档本身只是历史证据，不是待办）。真正遗留的是下面这条名实不一，r7 新证。
- **P1-2b [证据，r7 新证] 20 条 AST 规则的数据仍自称引擎是 `javaparser`，与实际 `jdk.compiler` 名实不一。**
  位置：`arsenal-rules/**/*.json` 9 个文件共 20 处 `"engine": "javaparser"` → 同步进 `arsenal-web/src/generated/rules.json` 20 处 → 渲染在规则详情页 `arsenal-web/src/app/rules/[id]/page.tsx:207`（`engine=${check.ast.engine ?? 'javaparser'}`，兜底默认值也是这个名字）→ 由 `ExporterService.java:270` 写进导出产物（「AST：`query`（引擎 javaparser）」）→ 后端默认值 `Rule.java:85-87 engineOrDefault()` 与 `:80` javadoc 同错。而 `AstEngine.java:37` 明写「零新增依赖，不需要 JavaParser」。
  影响：用户与接入方（含 AI）读到的引擎名是错的，可能据此以为要引 JavaParser 依赖。属**规则语料内容**改动 → 需本人过目，已登记 **BLOCKERS B-8**，循环不擅改语料。
- **P1-3 [证据，r7 更新前提] LLM 层 43 条规则 0 条被执行 —— 结论仍成立，但「全项目没有任何 LLM 调用代码」这句前提已过期。**
  现已存在 `arsenal-server/src/main/java/com/arsenal/qa/LlmClient.java`（`java.net.http.HttpClient` + OpenAI 兼容 `/chat/completions`，默认 base-url deepseek，key 走 `ARSENAL_LLM_KEY`，`statusNode()` 只披露状态不外泄 key），被 QA 会诊链路使用；该类 `:26` 明写「同步链路永不碰这里：/autopsy、/api/lint 的调用方不注入本类」。
  ⇒ 缺口精确化为「lint 的 43 条 llm 规则没有复用这条现成客户端」，而不是「要先从零搭 LLM 调用」。仍属功能方向、非单轮可完成，不排期。
- **P1-4 [证据，r3] ~~archify 逐例断言只在全绿时产出~~ → r5 已修（1 文件 / +11 −4）。**
  现在红例与「校验器拿不到 JSON」两条路都产出一条红断言；注入回归实测：`31 项 / 13 失败`、`declaredMismatch: null`、逐例点名到预设。
  全绿态仍是 31 项不变 ⇒ 档案声明不用动。穷举模式（`ARCHIFY_SWEEP=1`）保持只报例外。

- **P1-5 [证据，r4] ~~`_rtcp.sh` 的 `_rt_add()` 对缺件静默跳过~~ → r9 已修（但真位置不是这里，见下）。**
  r9 实跑复核把根因更正了：把失败信息带偏的是 **`RuntimeClasspath.findJar()` 的降版分支**（注释宣称「会记进 note」，代码一个字没记），
  不是 `_rt_add`。已修：降版构件如实进 `missing()` + `note`，`RuntimeProbe` 的 `reason` 先点名混版再贴异常，
  `scan-check.ts` 的 13-1 失败详情带上清单（判定条件与项数 170 未动，三条红仍红）。代码 4 文件 / +46 −9。
  **剩下那半条已在 r10 收尾**（`_rtcp.sh` 的 `_rt_add()` 缺件攒清单说到 stderr，拼装与判定一字未动，
  实测说出「缺 5 个运行期构件」，与 r9 的降版证据对上）。本条关闭。


---

## P2 · 功能拓展（须有 BACKLOG 依据）

- **P2-1 [证据] 无 CI 落地。** 有 `docs/项目章程-CI落地指南.md` 与 `scripts/calc-ci-history.mjs`，但仓库无 `.github/`。
  风险：本次循环「不 push」的红线下，CI 属外部系统配置 → 见安全红线第 1 条。**记录但不擅自创建**，需人工确认（已登记 BLOCKERS）。

---

## P3 · 结构 / 可读性 / 文档

- **P3-1 [证据] 根目录散落审计产物。** `.verify/`、`.data/`、`.workbuddy/`、`.zcode/` 混在仓库根，近期已有 commit 在做清理（`52feeb3`）。跟进但要避开用户在途的归档工作。
- **P3-2 [证据，r11] ~~`docs/功能缺口清单-2026-09-22.md` 已 35 天未更新，可整理成现状稿~~ → r11 已交付。**
  没有改写那份历史报告（取证纪律值得保留），而是新建 `docs/现状复核-2026-10-27.md`：
  逐条标注「已被实测推翻 / 仍然成立 / 0922 之后新发现」，每条旁边挂一行复现命令。
- **P3-5 [证据，r12 新增并已完成] 0922 报告顶部没有复核指针。** r12 已在该文件头部加 5 行：
  点名四条被实测推翻的前提并链到 `docs/现状复核-2026-10-27.md`（正文取证一字未改）。
  理由：那份文档是后续 AI 会话最可能先读的一份，不留指针就会被当成现状重复建设。
  ⚠️ 同类风险仍在：`docs/arsenal-runtime.architecture.json` 已被改正（「MCP 已接入」），
  但它带用户在途改动（B-6 同类），循环不碰。

  顺带纠正了本报告自己的两处口径：`docs/功能缺口清单` 的「LLM 0 执行」缺了「客户端已存在」这个前提；
  B-7 的「缺 4 个构件」其实是「2 真缺 + 5 降版混用」。
- **P3-3 [证据，r2] README 的类型闸门只写了 `npm run typecheck` 一种。** 实测根 tsconfig 的 `**/*.ts` 不匹配点目录（`tsc --listFiles` 里 `.verify/` 0 个文件），
  改断言层必须另有 `npm run typecheck:verify`；`scripts/verify-all.mjs:206` 两个都跑，所以**链没漏，是文档口径不全**（README:353）。单轮小改。
