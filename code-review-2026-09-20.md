# 军火库 · 代码审查报告（2026-09-20）

审查对象：`D:\workspace\2026\mryang-arsenal`（工作区有未提交改动）
审查日期：2026-09-20
审查范围：本轮「选型 IR → 交付 HTML」功能新增/改动的代码 ——
`arsenal-server`（`com.arsenal.archify` 包 + `ArchifyController` + `GlobalExceptionHandler` + `application.yml`）、
`arsenal-web`（`archify-ir.ts` 1024 行 / `arsenal-api.ts` 210 行 / `TechArch.tsx` 815 行 / `arch-canvas.ts`）、
两侧 `.verify/` 自检脚本（`archify-check.ts` 526 行 / `ArchifyProbe.java` 336 行 / `archify-probe.sh`）。

审查方式：**逐行读源码 + 对活着的服务与渲染器实跑取证**。凡下结论处都给了可复现的命令或探针结果；
读代码推出来的结论单独标注「未实测」。与 `function-review-2026-09-20.md` 的分工：那份审的是
「功能对不对、约定守没守」，这份审的是**代码本身**（错误映射、并发与资源、类型与边界、死代码、注释与实现是否一致）。

**本次未能实跑**：`node` 解析失败的场景（本机 PATH 与兜底路径上都有 node，造不出「全都找不到」）—— 见 §3 P2-1。

---

## §0 结论摘要

新增的两百多行后端代码质量在线：不碰 shell、拒收能联网的输入、超时杀得掉、临时目录必清、
失败与不可用分成两套语义。三处「注释里写下了自己踩过的坑」尤其扎实（`columnRight` 的基准、
包围盒只算组件、标签落点为什么得在车道层定）。

问题集中在两类：**一处在异常出口（一处改动，影响所有接口）**，**一处在「客户端文字进渲染器」这条链上**。

| 级别 | 编号 | 一句话 |
|---|---|---|
| P1 | 1 | 兜底 `@ExceptionHandler(Exception.class)` 把 Spring 自己的 4xx 全吃成 **500** —— 实测 404/405/415 共 5 例 |
| P1 | 2 | 分区不在声明里的节点被**静默丢掉**，自检看不见（实测 10 进 9 出，报 0 处）；注释还写着相反的兜底 |
| P1 | 3 | 前端 `75_000` 硬编码超时，与后端**可配**的超时脱钩 —— 而后端已经把真值送到前端了 |
| P2 | 1–5 | 见 §2：负结果不缓存的锁、护栏在解析之后、无并发闸门、超时只管响应头、状态机缺 `finally` |
| P3 | 1–9 | 见 §3：死分支、探针分支没人接、固定 30px 带距、`specSha` 两种来源且无人校验、静默截断 … |

**查过、不是问题**（也一并记在 §4，避免下次重复怀疑）：

- **可编辑文字经 IR 进对方渲染器，不构成注入。** 我构造了 6 处载荷（含 `</text><img onerror>`、
  `"><script>`、`<svg onload>`、`</script>` 逃逸）追到渲染器每一处落点，**全部转义，无漏点**。
- **拖拽时的整链重算不是性能问题。** 实测 0.55 ms/步，占 60fps 单帧预算 3%。

---

## §1 P1：会给出错结论的地方

### P1-1 兜底异常分支把协议级 4xx 全变成 500

`GlobalExceptionHandler` 的最后一段是 `@ExceptionHandler(Exception.class)` + `INTERNAL_ERROR`。
它确实"兜住了"，但**兜得太靠前**：在 `ExceptionHandlerExceptionResolver` 里，它比
`DefaultHandlerExceptionResolver` 先命中，于是 Spring 自己那些「调用方错了」的异常全落进 500。

实测（服务在跑，逐条复现）：

| 请求 | 期望 | 实测 |
|---|---|---|
| `POST /api/archify/deliver` + `Content-Type: text/plain`（体是合法 JSON） | 415 | **500 INTERNAL_ERROR** |
| 同上，**不带** `Content-Type` | 415 | **500 INTERNAL_ERROR** |
| `DELETE /api/archify/deliver` | 405 | **500 INTERNAL_ERROR** |
| `POST /api/rules`（只认 GET） | 405 | **500 INTERNAL_ERROR** |
| `GET /api/nope` | 404 | **500 INTERNAL_ERROR** |
| `GET /no-such-page` | 404 | **500 INTERNAL_ERROR** |
| `POST /api/archify/deliver` 不带请求体 | 400 | 400 `MALFORMED_BODY` ✅ |

反讽在于：这个类的注释**专门为 `HttpMessageNotReadableException` 写了**「不接住它会落到最下面的兜底分支变成
500 —— 而 500 的意思是「服务端坏了」，实际情况是调用方发了坏数据。**这个错误码指向的排查方向完全是反的**」。
它为同一类用户错误里的一个兄弟接了手，另一个（Content-Type 不对）漏在外面 —— 上面表格里第 7 行与第 1、2 行
是同一件事的两半。

连带后果：

1. **日志/告警被污染。** 每个路径写错的请求都走 `log.error("未预期的服务端异常", e)` 带堆栈 ——
   一个扫描器或一个前端路由打错，就能把 ERROR 刷满。项目自己的 `REL-LOG-001` 就是这个意思。
2. **前端说不出人话。** `arsenal-api.ts` 把非 success 一律映射成 `{kind:'error', code}`，
   页面显示「服务端异常，详情见服务日志」，而真相是「Content-Type 不是 application/json」。
3. **MCP 适配层将来要靠 `code` 分流**，而 `INTERNAL_ERROR` 这个码在这里是错的。

**修**：让 advice 继承 `ResponseEntityExceptionHandler`（`@RestControllerAdvice` + `extends`）并把
`handleExceptionInternal` 收编到 `ApiResponse`；或者给 `HttpMediaTypeNotSupportedException` /
`HttpRequestMethodNotSupportedException` / `NoResourceFoundException` 各加一个显式 handler。
顺带在 `.verify` 里补几条 HTTP 断言 —— 这一层目前**一条断言都没有**，所以它能同时错 5 种。

### P1-2 未知分区的节点被静默丢掉，而且自检看不见

实测（`tsx` 探针，往 `buildTechArch` 的产物里塞一个 `zone: 'not-a-zone'` 的节点）：

```
模型里的节点数 : 10
IR 里的组件数  : 9
幽灵节点进 IR 了吗 : false
结构自检报了几处   : 0 []
```

根的链条：

1. `groupZones()` 只遍历 `CANVAS_ZONES` → 分区不在其中的节点**进不了任何组**；
2. `layoutColumns()` 只遍历组 → 该节点**拿不到槽位**；
3. `buildArchifyIr` 的组件循环里 `const p = pos.get(node.id); if (!p) continue;` → **静默跳过**；
4. `archifyIrIssues()` 只看 IR，而那时节点已经不在 IR 里 → **永远报不出来**。

两处注释与实现相反，正是这两处本应拦住它：

- `archifyTypeOf` 写着「真走到兜底说明有人加了新维度却忘了声明分区归属」—— 这类节点**走不到**这个兜底
  （在更早的 `groupZones` 就没了）；
- `columnOf` 写着「找不到分区时归到右列（最保守：它不会把连线挤进主干）」，代码是
  `if (index <= 0) return 0` —— `findIndex` 找不到返回 **-1**，`-1 <= 0` → 返回 **0（左列）**。
  注释说要归右、代码归了左，而且这段是死代码（未知分区在 `groupZones` 已被过滤掉）。

为什么这不是纸上的问题：项目**正在做「加维度」这件事** —— `待推进` 里那两条结构层规则缺口就是加东西的场景。
加一个维度、忘了在 `canvas.zones` 里给它一个归属，图上就少一块，**没有任何提示**，而这张图是要发给客户的。

**修**（10 行）：`buildArchifyIr` 里对 `model.nodes` 断言每个都拿到了槽位，缺的把 id 交出去而不是 `continue`
（可以让 `buildArchifyIr` 返回 `{ir, issues}`，或让 `groupZones` 直接抛）；顺带把 `columnOf` 的注释改成实情。

### P1-3 前端硬编码 75s 超时，与后端可配的超时脱钩

```ts
// arsenal-api.ts:162
75_000
```
注释写着：「超时给到后端自己超时的 1.25 倍」（60 × 1.25）。但 `application.yml` 里
`arsenal.archify.timeout-seconds` 是**可配的**，而且 `probe()` **已经把它如实返回**
（`ArchifyProbe.timeoutSeconds`），前端类型里也声明了 —— **就是没人用**。

后果：有人把 `timeout-seconds` 调到 120（慢机器上完全合理），前端 75s 先掐断 → 用户看到的是一个
没有上下文的 abort，而后端那句精心写的「实测一次约 1.6 秒，跑到超时通常意味着它卡住了 —— 先手工跑一遍
render 看它停在哪」**永远送不到**。注释描述的设计意图，正好被这个硬编码破坏掉。

**修**：`deliverArchify(ir, timeoutMs)`，调用点用 `probe.timeoutSeconds * 1000 * 1.25`。
前端 `ArchifyStatus.ready` 里已经揣着这个值了。

---

## §2 P2：健壮性与资源

### P2-1 `resolveNode()` 的负结果不缓存，而且跑在 `synchronized` 里

只缓存成功是对的（注释的理由正当：人可能刚装上 node）。但失败时，**每次调用**都会重新进
`synchronized (this)` 跑完整候选链：`configuredNode` → `node` → 3 个兜底路径，每项 `waitFor` 上限 **5 秒**。

最坏情况：某个候选是「存在但挂住」的二进制（指向一个会等 stdin 的包装脚本之类），一次 `probe()`
就握住 monitor 20 秒。而这把锁是**整个 service 的单飞**，期间所有 `probe()` 与 `deliver()` 全部堵住 ——
`deliver()` 第 231 行就会调 `probe()`。Tomcat 工作线程被单向堆住，且页面**进站就打一次 probe**，
所以这个函数在最坏情况下会被反复触发。

**修**：负结果也缓存，带一个短 TTL（30 秒左右，兼顾「人刚装上」）；或把 `synchronized` 换成
`AtomicReference` + 单飞，别让"找 node"这件事阻塞渲染。
**声明：这一条是读代码推出来的，未能实测** —— 本机 PATH 与兜底路径上都有 node，造不出全都找不到的场景。

### P2-2 护栏在「解析之后」：`maxSpecBytes` 挡的是喂给渲染器的字节，不是收下的字节

`deliver(JsonNode spec)` 拿到的是**已经解析成树**的对象 —— Spring 在进入方法之前就把整个请求体读进内存了。
所以 24 MB 请求体走的是：**完整收下 → 完整解析 → `writerWithDefaultPrettyPrinter()` 重新序列化 →
然后**才比对 `maxSpecBytes` 并回 400。

`server.tomcat.max-http-form-post-size`、`spring.servlet.multipart.*` 都没配，也没有按 `Content-Length`
早拒的 Filter。

一个顺带观察（**不是**我们的护栏在起作用，别当成证据）：单个字符串超过 20 MB 会被 **Jackson 自己的**
`StreamReadConstraints.maxStringLength` 挡成 `MALFORMED_BODY`。那是 Jackson 兜底。

**修**：一个读 `Content-Length` 的 `OncePerRequestFilter`，对 `/api/archify/deliver` 早拒 413；
或至少显式打开 `server.tomcat.max-http-form-post-size`。

> P2-2 与 P2-3 是同一族：**这是军火库第一个「收 JSON 就在机器上起子进程」的接口**。
> 此前所有接口都是只读的，风险模型这一轮才变 —— 而配套闸门一道没加。

### P2-3 出图接口没有任何并发闸门

`ArchifyService` 里没有信号量、没有队列、没有每来源计数。唯一的上限是 Tomcat 线程池（默认 200）。
实测：24 并发 POST → 峰值 6 个渲染进程（受本机 CPU 限制）；12 并发时 `node.exe` 合计 1377 MB
vs 基线 1171 MB → **单进程约 40 MB**。

**修**：`Semaphore(2~4)`；满载回 429 配一个新 code（例如 `ARCHIFY_BUSY`）。
数量可配（`arsenal.archify.max-concurrency`），别写死。

### P2-4 `fetchWithTimeout` 的超时只覆盖响应头，不覆盖响应体

```ts
try { return await fetch(url, { ...init, signal: controller.signal }); }
finally { clearTimeout(timer); }
```

`fetch` 在**收到响应头**时就 resolve，`finally` 随即清掉定时器；紧接着的 `await res.json()`
读响应体时**已经没有超时保护**。出图这条路的响应体是整份 HTML（约 700 KB）——服务端若在发完头之后卡住，
前端会永久挂起：不 abort、不报错、`generating` 永远是 `true`。

**修**：把 `clearTimeout` 挪到 body 读完（`await res.json()` 之后）；或把 signal 的生命周期交给调用方。

### P2-5 `generateArtifact` 缺 `try/finally`，异常会让按钮永久停在「渲染中…」

`deliverArchify` 目前确实不会抛（所有分支都 return 一个结果对象）。但这是**当前实现的性质，不是契约**：
哪天在里面加一句会抛的代码，页面上就永久卡在 `generating: true`，没有任何错误提示，只能刷新整页。

**修**：`setGenerating(false)` 从中间挪进 `finally`。

---

## §3 P3：可维护性与一致性

| # | 位置 | 问题 |
|---|---|---|
| 1 | `archify-check.ts:417` | `if (!cli)` 是**死分支** —— 第 92-99 行已 `process.exit(0)`，TS 也把 `cli` 收窄成了 `string`（`process.exit(): never`）。那段「本机没装通用绘图器 → 跳过」的提示永远不会执行 |
| 2 | `archify-check.ts` vs `ArchifyProbe.guards` | 探针在样本不足两个组件时写 `badGeometrySkipped`，前端**没接**这个分支：断言会以 `undefined === false` 失败并报一句看不懂的错。今天样本恒 ≥2 组件，够不到 —— 但这是「探针加了分支、守门人没跟上」的结构性缺口 |
| 3 | `archify-ir.ts:705` | `plan.dx0 = LANE_START + i * LANE_BAND_GAP` 是**固定 30px 步距**，与前一带的实际宽度无关；而带宽按标签遮罩算（5 条 40px 遮罩 = 248px > 30px）。**同列出现第二个「多出边源」时两带必然在 x 上重叠** → 对方那句「两条无关连线共用走廊」必触发。今天够不到：实测三列里只有第 1 列有跨列出边且只有一个源，第 0 列只有一条出边，第 2 列无出边（没有第 3 列），所以 `i` 恒为 0。修：`dx0` 改成前一带右沿累加 |
| 4 | `ArchifyService` `Receipt.specSha256` | **一个字段两种来源**：成功时取对方收据里的 `spec.sha256`，失败时取我们本地算的 `sha256(specBytes)`。更值得注意：**没有任何地方比对这两个值**。探针验了 `artifactShaMatches`（读回的字节 == 收据里的产物 sha），却没有对称的 `specShaMatches`（写下的字节 == 收据里的输入 sha）—— 后者恰好是「它渲染的确实是我们发的那份 IR」的直接证据 |
| 5 | `ArchifyService.diagnosticsOf` / `TechArch.tsx:703,707` | 诊断**静默截断**三处（后端 20 条、前端 6 条、text 400 字符），都不写「超出 N 条」。项目别处的惯例是标「超出折叠计数」（`max-violations-per-rule` 就是这么做的）。图不合格时诊断是这次调用最值钱的东西 |
| 6 | `TechArch.tsx:459,462` | `paletteGroups` 在渲染里做反向查找：`Object.keys(TECH_ICONS).find(k => TECH_ICONS[k] === ic)`，每个图标扫 40 条、同一个 key 求两次。`Object.entries(TECH_ICONS)` 一次拿 key 与值。（抽屉打开才渲染，影响很小 —— 记它是因为「渲染里做反向查找」这个形态） |
| 7 | `ArchifyProbe.java:68` | 绕过 Spring，把 `"showcase", 60, 1048576` 与 `application.yml` **各维护一份**（注释已声明取舍）。漂移的表现是「探针说能用、服务里说不可用」，反向更糟 |
| 8 | `README.md` | `NEXT_PUBLIC_ARSENAL_API` 没写进去 —— 前端唯一一个「后端在哪」的开关。两个**后端**侧变量（`ARSENAL_ARCHIFY_CLI` / `ARSENAL_ARCHIFY_NODE`）都写了，这个没写；而静态站是构建期固化，它比那两个更必须写下来 |
| 9 | `arsenal-api.ts:151` | `deliverArchify(ir: unknown)` 丢掉了 IR 的类型。`archify-ir.ts` 已导出 `ArchifyIr`，调用点手里就是它 —— 代价为零的类型检查白白放弃 |

---

## §4 做得好的地方（与「查过没问题」）

**设计上值得保留的：**

1. **三条自陈的安全边界都落成了代码，且各自可测。** 不用 shell（`ProcessBuilder` 收 argv 数组）、
   拒收对象形态商标（递归整棵树，注释写明「这类我们永远不用、但一旦出现就危险的输入，正确的处理是拒收，不是消毒」）、
   显式摘掉对方的 `WRENCH_AI_BRAND_ALLOW_PRIVATE`（防止父进程环境把这条规矩从另一侧绕过去）。
   而且 `rejectRemoteBrands` **放在 `probe()` 之前**，注释写明了理由：「少一道防线的地方，恰恰是最容易被忽略的地方」
   —— 一台没装技能的机器上也照样拒收。这是把安全判断与可用性判断解耦，做法是对的。
2. **「图没画出来不算接口失败」这个取舍是对的。** 对方校验不过时给的是十几条可核对的诊断，
   包成 4xx 只会让调用方为了读诊断去解析错误体。所以失败走**正常返回** + `delivered:false`，
   环境问题才抛异常，且异常码全是「怎么修」导向的（`NOT_INSTALLED` / `NODE_MISSING` / `TIMEOUT` / `EXEC_FAILED`）。
3. **`Probe.reason` 里的文案是真正的可诊断性**，不是「友好提示」：缺什么、环境变量叫什么名、装好之前还能怎么用
   （「仍可下载 IR JSON，拿到有 Node 的机器上自己渲染」）。页面上四态分开说也是同一个思路。
4. **输出重定向到文件而不是管道**，注释把两个理由都写了（管道的缓冲区死锁、Windows 控制台代码页糊中文），
   而且 UTF-8 读回来 —— 探针里还有一条 `artifactShaMatches` 真的在验「读回的字节 == 它写下的字节」。
5. **`archify-ir.ts` 文件头把「为什么必须左到右」写成了可复现的推理**：引了对方的
   `defaultFromSide` 源码（先比 x 中心、相等才比 y），结论是竖排布局必然被判成水平方向、必然报
   `endpoint-side-direction`。这是"我读过它的代码"而不是"我试出来了"。同理 `columnOf` 里那段
   「后几层为什么挤在一列」、「标签落点为什么必须在这一层定（判定它会不会压线需要看到同一走廊所有车道）」。
6. **探针的两条设计原则。** ①喂坏数据：只测「好的能过」等于只测一半，所以另外喂坏几何（必须如实报诊断、
   不许抛异常）、对象商标（当场拒）、非对象体（当场拒）；②IR 由调用方传入，探针不自己造 ——
   「探针自己造一份输入，就等于在验探针造的那份，而不是前端真正产出的那份」。
7. **`archifyIrIssues` 与对方的九项检查分工清楚。** 只拦「我们自己写错的那类」（id 撞车、端点悬空、
   焦点重复、`via` 折点退化、给了 via 却没写 endpoint side），并把理由写在断言旁边。

**实证查过、确认不是问题的（避免下次重复怀疑）：**

8. **可编辑文字进对方的渲染器不构成注入。** 我构造了一份带 6 处载荷的 IR
   （`label` / `sublabel` / `meta.title` / 连线 `label` / 卡片 `title`+`items`，
   含 `</text><img onerror=alert(1)>`、`"><script>alert(2)</script>`、`<svg onload=alert(4)>`），
   逐处追到渲染器的落点：

   | 落点 | 防护 |
   |---|---|
   | SVG 文本（节点 label / sublabel / tag / 连线 label / 分区 label） | 全部 `esc()` |
   | 节点属性（`data-node-label` 等） | `focusNodeAttrs` 对每个值 `esc(String(v))` |
   | 卡片（`dot` / `title` / `items`） | `renderCards` 三处全 `esc` |
   | 内嵌 `<script type="application/json">` | `serializeScriptJson` 把 `<` `>` `&` 转成 `\u003c` `\u003e` `\u0026` |
   | `escapeHtml` 覆盖面 | `& < > " '` 五个全转 |

   **无漏点。** iframe 的 `sandbox="allow-scripts"`（不带 `allow-same-origin`）是第二道。
   附带观察：注入载荷会被对方自己的构图检查先挡在门外（超长 label 触发标签净空失败，图根本出不来）。
9. **拖拽时的整链重算不是性能问题。** 我怀疑 `edits` 每像素变一次会让
   `buildTechArch` + 两次 `buildTechArchSvg` + `techArchMarkdown` + `buildArchifyIr` + `JSON.stringify(ir, null, 2)`
   全部重跑。实测 60 步均值 **0.55 ms/步**，占 60fps 单帧预算 **3%**。
   分项：两次 SVG 0.19ms、`buildTechArch` 0.04ms、`buildArchifyIr` 0.08ms、`JSON.stringify` 0.02ms、
   `archifyIrIssues` 0.01ms。**不用优化。**
10. **CORS 正确**（同源预检 200、陌生来源 403）；**临时目录每次都干净**（探针 `tempDirsLeft === 0`，
    我另外手工复查过 tmp）；**产物字节无损**（`artifactShaMatches` 9/9）。

---

## §5 未能验证（诚实记录）

1. **P2-1（node 负结果不缓存）未实测。** 本机 PATH 与三个兜底路径上都能找到 node，造不出「全都找不到」的场景。
   结论来自读代码，强度弱于本报告其余条目。
2. **`GlobalExceptionHandler` 的修复未验证。** P1-1 只做到「复现 5 例错误映射」，没做修复后的回归 ——
   而且这一层**当前没有任何自检断言**，所以修完也仍然无守门（见 §6 第 1 条）。
3. **并发上限未做压测。** P2-3 的数字是 24 并发下的观测值，没有做长时间压测；单进程内存 40 MB 是
   一次采样的差值，不是稳态值。
4. **`archify-ir.ts` 的**版式**正确性不在本次范围。** 那一层靠对方的九项检查守（`verify:archify` 29 项 +
   穷举 133 例全过），本次只审代码结构（死代码、注释与实现一致性、边界），没有重新推导车道几何。
5. **`arch-canvas.ts`（自研画布）只做了针对性阅读**（`CANVAS_ZONES` / 节点构造 / `zone` 来源），
   没有逐行审。本次审的是它与 IR 适配器的接缝。

---

## §6 建议的修复顺序

| 顺序 | 项 | 理由 | 量级 |
|---|---|---|---|
| 1 | **P1-1** 异常映射 | 一处改动影响**所有**接口；且它正是项目自己最在意的那类错（错误码指向反方向）。修完顺手给 `.verify` 补 5 条 HTTP 断言 | 1 小时 |
| 2 | **P1-2** 静默丢节点 | 加维度时的**活路径**，修法 10 行；补一条「模型节点数 == IR 组件数」的断言 | 30 分钟 |
| 3 | P2-1 / P2-2 / P2-3 | 同一族：出图接口的资源闸门（锁、早拒、并发上限），一起做比分开做省事 | 半天 |
| 4 | **P1-3** 前端超时脱钩 | 3 行，把探针已经送来的值用上 | 15 分钟 |
| 5 | P2-4 / P2-5 | 前端超时与状态机的两处收尾 | 20 分钟 |
| 6 | P3-4 / P3-5 | 补 `specSha` 对称校验（在一份到处做字节校验的设计里，这是唯一漏掉的对称项）+ 截断标注 | 1 小时 |
| 7 | P3-1 / P3-2 / P3-3 | 死分支、探针分支对齐、车道带距改累加 | 1 小时 |
| 8 | P3-6 ~ P3-9 | 记录在案，随手改 | — |
