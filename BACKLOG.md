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

- **P1-1 [证据] 后端零单元测试。** `arsenal-server` 没有任何 `src/test`。后端逻辑（`ScanGuard`、`AstEngine`、`ProjectStore`、`QaService`）全靠前端 `.verify` 黑盒打。
  风险：前端链跳过时后端等于裸奔；重构无保护网。
  做法：**小步**补最小冒烟测试 —— 第一个只测 `ScanGuard` 的 zip 路径穿越拒绝（README 明写的铁律，最容易写成纯单元测试）。一次只加 1 个测试类。
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
  顺带纠正了本报告自己的两处口径：`docs/功能缺口清单` 的「LLM 0 执行」缺了「客户端已存在」这个前提；
  B-7 的「缺 4 个构件」其实是「2 真缺 + 5 降版混用」。
- **P3-3 [证据，r2] README 的类型闸门只写了 `npm run typecheck` 一种。** 实测根 tsconfig 的 `**/*.ts` 不匹配点目录（`tsc --listFiles` 里 `.verify/` 0 个文件），
  改断言层必须另有 `npm run typecheck:verify`；`scripts/verify-all.mjs:206` 两个都跑，所以**链没漏，是文档口径不全**（README:353）。单轮小改。
