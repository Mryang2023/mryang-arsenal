# 军火库 · 功能检查（Archify 出图功能）

检查日期：2026-09-20
检查对象：本轮新增的「选型 IR → 通用绘图器 → 页面内成品 HTML」这条链路
涉及文件：`arsenal-server/.../archify/ArchifyService.java`、`.../web/ArchifyController.java`、
`.../archify/ArchifyUnavailableException.java`、`arsenal-server/src/main/resources/application.yml`、
`arsenal-web/src/lib/arsenal-api.ts`、`arsenal-web/src/app/stack/TechArch.tsx`、
`arsenal-web/.verify/archify-check.ts`、`arsenal-server/.verify/ArchifyProbe.java`

检查方式：全量读上述源码 + **实跑**（完整 `npm run verify`、并发压测、超大请求体、CORS 预检、
`netstat` 看监听地址、`tasklist` 量进程内存）+ 逐条回原文核对 README 声明。

---

## §0 一句话结论

链路本身是通的：337 项自检全绿，出图接口实测九项全过、`0 错 0 警`、产物字节无损，
CORS 预检与陌生来源拒绝都符合预期。

但**这次改动第一次让军火库多了一个「收到 JSON 就在机器上起子进程」的接口**，
而它的护栏**全部装在「请求已经读进内存、已经解析成树」之后**，服务又监听在 `0.0.0.0`，
并且没有任何并发闸门。前 3000 行代码里所有接口都是只读的（查规则 / 导出 / lint 都在内存里算），
风险模型在这一轮才变，而配套的三道闸门一道都没加。这是本次检查里唯一我认为算「必须修」的遗漏。

另有一处 UX 断点会把用户推进死路：通道那行告诉人「起服务的命令是……」，
但页面**没有任何地方能重新探测一次** —— 用户照做起了服务，按钮仍然是灰的，必须刷新整页。

| 级别 | 一句话 | 位置 |
|---|---|---|
| **P1** | 护栏全在「解析之后」+ 监听 `0.0.0.0` + 无并发闸门，三者叠加 | `ArchifyService` / `application.yml` |
| **P1** | 出图通道无「重新探测」，用户被引导去起服务之后无路可走 | `TechArch.tsx` |
| P2 | `NEXT_PUBLIC_ARSENAL_API` 没进 README（前端唯一一个「后端在哪」的开关） | `README.md` |
| P2 | README「没装时前 19 项跳过」与实现不符（实际整层 29 项全跳） | `README.md` |
| P2 | `specSha256` 在成功/失败两条路来源不同，同一字段两种语义 | `ArchifyService.deliver` |
| P2 | 诊断被静默截断两处（后端 20 / 前端 6），不写「还有 N 条」 | `ArchifyService` / `TechArch.tsx` |
| P2 | `probe()` 负结果不缓存 × 前端 3 秒超时 → 误诊方向是反的 | `ArchifyService.probe` / `arsenal-api.ts` |
| P3 | HTTP 层（状态码映射 / CORS）不在任何自检断言里 | `archify-check.ts`【4】 |
| P3 | `archify-check.ts` 里 `if (!cli)` 是死代码 | `archify-check.ts` |
| P3 | 「复制 IR JSON」没跟着 `irIssues` 一起禁用 | `TechArch.tsx` |
| P3 | `WRENCH_AI_REPO_ROOT` 没跟 `WRENCH_AI_BRAND_ALLOW_PRIVATE` 一起摘 | `ArchifyService.run` |

---

## §1 已核实为「通的」部分（实跑，不是看代码）

```
npm run verify              337 项全绿（35 + 59 + 191 + 14 + 9 + 29），退出码 0
  verify:archify            29/29 —— 12 例 IR 结构自检全过；九项构图检查逐例全过
                            最小标签净空 6px ≥ 4px，最小内部段 20px ≥ 16px
  后端实跑 3 例             711504 / 715896 / 699539 字节 · 674~760 ms · 检查 9/9
                            产物 sha256 对得上（读回来的字节 = 它写下的字节）
```

接口层（本节由手工实测，没进自检链 —— 见 P3-1）：

| 验的东西 | 实测结果 |
|---|---|
| `GET /api/archify` | 200，如实报出 node v22.22.2 / 技能入口存在 / showcase 档 |
| `OPTIONS /api/archify/deliver`（CORS 预检） | 200，`Access-Control-Allow-Origin: http://localhost:3010`，放行 `content-type` |
| `Origin: http://evil.example` | **403**，未回 `Allow-Origin` |
| 请求体不是对象 / brand 是对象 | 400 + 原因码，且**在没装技能的机器上也照样拒**（拒收行为不随环境变化）|
| 坏几何 | 200 + `delivered:false` + 6 条可核对诊断（不抛 5xx，诊断能完整读出来）|
| 每次出图后临时目录 | 残留 0 个 |

结论：**功能本身要验的都对**。下面全部是「护栏与表述」层面的遗漏。

---

## §2 P1-1：护栏全在解析之后，服务还监听在 `0.0.0.0`

### 现象（三条实测证据）

**证据一 —— 监听地址是全网卡。**
```
TCP    0.0.0.0:3011    LISTENING    28140
TCP    [::]:3011       LISTENING    28140
```
`application.yml` 只写了 `server.port`，没写 `server.address`。CORS 只对浏览器生效，
`curl` 完全不看 `Allow-Origin` —— 也就是说「陌生来源 403」这条防线对非浏览器客户端等于零，
局域网内任何一台机器都能直接 POST 这个会起子进程的接口。

**证据二 —— 并发没有任何闸门。**
24 个并发 POST，采样 `node.exe` 进程数：

```
基线 node.exe = 7 个（宿主机自己的）
24 个并发请求期间 → 峰值 13 个，即同时最多 6 个渲染进程在跑（受本机 CPU 限制）
12 个并发时：node.exe 共 12 个，内存合计 1377 MB（基线 ~1171 MB）→ 单渲染进程约 40 MB
```

代码里**没有信号量、没有队列、没有限流**，唯一的闸门是 Tomcat 默认线程池 200。
本机 CPU 少所以只跑到 6 个；换一台多核机器，理论上限是 200 × ~40MB ≈ 8 GB ——
在一台个人开发机上。

**证据三 —— 1 MB 护栏挡的是「喂给渲染器的字节」，不是「我们收下的字节」。**
发一个 24 MB 的请求体（用大量小块拼成，避开 Jackson 的单字符串上限）：

```
HTTP 400  {"code":"BAD_REQUEST","message":"IR 太大（24003625 字节，上限 1048576）"}
```

从「24,003,657 字节收进来」到「报出 24,003,625 字节」，说明这份 body 被
**完整收下 → 完整解析成一棵树 → 重新序列化** 之后，护栏才生效。
（另外实测：单字符串超过 20 MB 时会被 Jackson 自己的 `maxStringLength` 提前挡掉，
返回 `MALFORMED_BODY` —— 那是 Jackson 的默认值在兜底，不是我们的护栏在起作用。）

### 根因

`deliver()` 的顺序是「先问请求本身的问题，再看机器能不能干活」，这个顺序是对的
（见 `ArchifyService` 里的注释，它让拒收对象商标这件事可测、且不随环境变化）。
问题在后面复了一刀：

```
@RequestBody JsonNode spec          ← Jackson 在这里已经无条件把整棵树建好了
  → rejectRemoteBrands(spec)        ← 护栏①
  → probe()                         ← 护栏②
  → writeValueAsBytes(spec) 比大小  ← 护栏③
```

三道护栏**全部在「已经读进内存、已经解析」之后**。所以 `maxSpecBytes` 是一道
「事后护栏」：它能拦住超大 IR 被喂进渲染器，拦不住超大的 body 被收进来。

### 修法（三道，缺一不可）

1. **钉住监听地址**：`server.address: 127.0.0.1`。
   若确实想共享给局域网（手机 / 另一台机器看成品），就把这一条显式写进配置与 README，
   别停留在「不写不说」的第三种状态。
2. **在读到 body 之前就拒**：加一个只作用于 `/api/archify/deliver` 的
   `Filter`，按 `Content-Length` 早拒（给 8×`maxSpecBytes` 的余量），
   没有 `Content-Length` 的分块请求在读取流上做限长。
   注意：**别**把 `IllegalArgumentException` 挪走 —— 那道护栏要留着，它现在是对的，
   只是位置不够靠前。
3. **并发闸门**：`Semaphore(2)`，拿不到就 429 + `Retry-After`（或复用现有的
   503 通道 + 一句「同时最多 2 张图，稍后再点」）。实测一次 0.7 秒，
   两个并发对交互式使用完全够用；第 3 个请求排队等 0.4 秒也比起第 3 个 Node 进程划算。

---

## §3 P1-2：出图通道探测只能靠刷新页面重试

`probeArchify()` 只在 `TechArch` 挂载时跑一次。通道那一行在 `offline` 态写的是：

> 出图通道 — 连不上后端 http://localhost:3011（…）。静态站不依赖它也能用 ——
> 起服务的命令是 `bash arsenal-server/scripts/run.sh`。

信息完全正确、方向也对。但用户照做、把服务起起来之后，**页面上没有任何地方能再问一次**：
`archifyStatus` 仍是 `offline`，「直接生成 HTML」仍是灰的，只能手动刷新整页。

这正好卡在「我们让用户去做的那一步」之后 —— 把用户引导到一条没有出口的路上，
比不告诉他更糟。修法很轻：`offline` / `unavailable` 两态在通道那行右侧加一个
「重新探测」按钮，接 `probeArchify()`（它本来就是幂等的，不需要改 API 层）。

---

## §4 P2：小遗漏与不一致

**P2-1 `NEXT_PUBLIC_ARSENAL_API` 没进 README。**
这是前端唯一一个决定「后端在哪」的开关（默认 `http://localhost:3011`）。
README 里 `ARSENAL_ARCHIFY_CLI` / `ARSENAL_ARCHIFY_NODE` 两个后端侧变量都写了，
唯独漏了前端这一侧。同机静态导出能用默认值，换机器 / 换端口部署就必须在构建期设它
（静态导出站的环境变量是构建期固化的）。这一条应该跟那两个变量写在同一段。

**P2-2 README 一句与实现不符。**
> `verify:archify` 需要机器上装了通用绘图器。没装时**前 19 项**明说跳过并照常退出 0

实际行为：`archify-check.ts` 在【0】找到不入口就 `process.exit(0)`，
打印「⚠ 未找到 wrench-ai —— 本层整体跳过」，**整层 29 项全部不跑**，通过 0 / 失败 0。
「前 19 项」会让人以为后 10 项（后端服务实跑）还执行了 —— 而在这种机器上它恰恰没跑。
这个项目里「自检说的」和「自检做的」不一致算硬伤，必须改。
（`verify:parity` 那段说明里的 `328 项` 算术是对的：35+59+191+14+29。）

**P2-3 `specSha256` 两条路来源不同。**
失败时是我们本地算的 `sha256(specBytes)`；成功时取的是对方收据里的
`specification.sha256`。两边大概率相等，但**语义不同源** —— 一个是「我写下的字节」，
一个是「它读到的字节」。将来谁拿这个字段对账都会踩到「同一字段两种来源」。
统一成本地算最省事，也顺手让成功 / 失败两条路的收据形状对称。

**P2-4 诊断被静默截断两处。**
后端 `MAX_DIAGNOSTICS = 20`、前端 `.slice(0, 6)`，两处都不说「还有 N 条」。
项目里其它地方对这件事是有明确惯例的（lint 报告会写「超出折叠计数」）——
这里应该照办，否则用户会以为渲染器只报了 6 条意见。

**P2-5 `probe()` 负结果不缓存 × 前端 3 秒超时 = 误诊方向是反的。**
`probe()` 只缓存成功（注释说明是有意的：怕人刚装好 node 却被缓存挡住），
代价是「node 装了但跑不通」的机器上每次进页面要起最多 4 个子进程 × 5 秒 =
最长 20 秒；而前端探测只等 3 秒，于是报「连不上后端」——
**后端活着，只是在忙**。这两句话对应的处置动作完全相反。加个 30 秒 TTL 的负结果缓存即可。

---

## §5 P3：整洁度

- **P3-1 HTTP 层不在自检链里。** `verify:archify` 的【4】走 Java 探针（服务层），
  代码注释说明理由是「起 Tomcat 太贵」。但**状态码映射（400 / 503 / 504）与 CORS
  恰恰是「配一次就再也不看」的东西**，配错会让整个功能静默失效。
  建议：探测到 3011 活着时顺手断言 5 条（GET 200 / 非对象 400 / 对象商标 400 /
  超大 400 / 陌生来源 403），没起后端就跳过。这 5 条我已经手工跑过，都符合预期，
  但手工跑过的东西下次改动不会再跑。
- **P3-2** `archify-check.ts` 里 `if (!cli)`（第 417 行）是死代码 ——
  上面已经 `process.exit(0)`，且 TS 已把 `cli` 收窄成 `string`。
- **P3-3** `TechArch.tsx` 的「复制 IR JSON」没跟着 `irIssues.length > 0` 禁用，
  而旁边「下载 IR JSON」在同一条件下是灰的。同一份不合格 IR，一个出口拦、一个出口放。
- **P3-4** `ArchifyService.run()` 摘掉了 `WRENCH_AI_BRAND_ALLOW_PRIVATE`（对），
  但同类的 `WRENCH_AI_REPO_ROOT`（决定渲染器在哪个目录跑 `git`）还在透传。
  按当前 IR 形状走不到那条路（要有 `meta.repository` + 组件 `sources` 才会触发，
  且只跑 `git rev-parse` 这类只读命令，参数走数组不走 shell），所以只是对称性补一刀。

---

## §6 两个需要你定的口径（不算 bug）

1. **成品 HTML 不进导出包，也不持久化。** 页面生成的成品只活在 React state 里，
   刷新即失；而画布编辑是存 localStorage 的。六个导出载体里也没有它。
   要「一份数据三种出口」，这是不是第四个出口？（技术上没问题，缺的是一条产品决策。）
2. **字体口径**：`docs/` 里那两张旧产物是内嵌字体的（大 ~96 KB，离线保真），
   现在生成的是外链 Google Fonts 的（小、离线回落到系统等宽）。将来要不要统一成一种。

---

## §7 剩余工作量

| 项 | 内容 | 量级 |
|---|---|---|
| P1-1 | 钉监听地址 + 早拒超长 body 的 Filter + `Semaphore(2)`；同时给自检补 5 条 HTTP 断言 | 约半天（含验证） |
| P1-2 | 通道那行加「重新探测」按钮 | 十几分钟 |
| P2 | 四份文档 / 字段语义 / 截断提示 / 负结果缓存 | 约两小时 |
| P3 | HTTP 层进自检 + 三处清理 | 约一小时 |

修改完成后需要重跑 `npm run verify`（337 项）并复核 README 的两处表述。

---

## §8 已顺手清掉的东西

- `.verify/tmp/` 下 5 个上一轮探针遗留目录（`archify`、`archify-render`、`archify-sweep`、
  `deliver-probe`、`_fails.txt`）与 `.workbuddy/_wrench-demo`、两个大请求体样本。
  这些都按 `**/.workbuddy/_*` 与 `.verify/tmp/` 的约定可随手删，已删；
  `git status` 确认没有调试产物漏进待提交列表。
