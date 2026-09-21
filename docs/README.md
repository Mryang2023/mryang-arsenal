# docs/ —— 用 Archify 生成的工程图

这个目录里的 HTML 不是手写的，也不是截图，而是**由同目录的 JSON IR 确定性编译出来的**。
两者是一对：`*.json` 是 source of truth（进 Git），`*.html` 是它的编译产物（也进 Git，
因为它是给人看的交付物，而不是可重建的中间态）。

| 源（改这个） | 产物（别手改） |
|---|---|
| `arsenal-content-pipeline.dataflow.json` | `arsenal-content-pipeline.html` |
| `arsenal-runtime.architecture.json` | `arsenal-runtime.html` |

## 这两张图回答什么

- **内容流水线（dataflow）** —— 改一条规则 / 改一个案例，要经过哪几道关卡才能到页面。
  重点是那条**虚线旁路**：规则是唯一不经 Python 生成器的手写源。
- **运行时架构（architecture）** —— 系统由哪些部件组成、请求怎么走、哪三处出口、
  以及**哪些能力还没做**（MCP 适配层）。未完成的部件用虚线画出，不做任何"已具备"的暗示。

图上每个方块的状态、每条连线的方向都来自 `arsenal-rules` / `arsenal-stacks` 的真实数据与
`README.md` / `.workbuddy/memory/MEMORY.md` 的实测记录，没有推测的运维设施（云资源、监控、
CI/CD 一律没画）。

## 工具与版本

用的是 [Archify](https://github.com/tt-a1i/archify)（MIT），核心版本 `2.17.0-dev.1`。

**现在以技能形式装着，不再是临时下载的 CLI。** 位置：

```
~/.workbuddy/skills/wrench-ai/          # 技能 ID: wrench-ai，市场名「扳手AI.Archify」
  bin/wrench-ai.mjs                     # 命令行入口（原 archify.mjs，命令语法一致）
  renderers/  schemas/  examples/  delta/  assets/template.html
```

装法（WorkBuddy 推荐市场搜 `archify`）——**不要走 `npx skills add`**：
`skills` CLI 本身能跑，但它用 `git clone`，而 **github.com 的 git 协议在本机不通**
（`Recv failure: Connection was reset`）。`codeload` 的 https tarball 通、`registry.npmjs.org` 通、
`raw.githubusercontent.com` 超时、`api.github.com` 403。

> 历史上曾用 codeload 把 `2.17.0-dev.1` 源码包解到 `.workbuddy/_archify-tool/` 来跑（本 README
> 旧版记的就是那套）。该目录是会话级产物，**已被清理，现在不存在**。现行路径是上面那个技能目录。

`2.17.0-dev.1` 而不是 npm 上 `@tt-a1i/archify-dsh@0.1.0` 捆的 `2.14.0`，是因为 `meta.locale`
（viewer 中文本地化）是 2.17 才加的。市场版核心也是 `2.17.0-dev.1`（`package.json` 里写的），
所以**语言与渲染行为一致**。

## 重新生成

```bash
# Git Bash 下给 node 传路径要用 Windows 形式，/c/... 会被解析成当前盘的相对路径
CLI="C:/Users/Administrator/.workbuddy/skills/wrench-ai/bin/wrench-ai.mjs"

node "$CLI" validate dataflow     docs/arsenal-content-pipeline.dataflow.json --quality showcase --json
node "$CLI" validate architecture docs/arsenal-runtime.architecture.json     --quality showcase --json

node "$CLI" deliver  dataflow     docs/arsenal-content-pipeline.dataflow.json docs/arsenal-content-pipeline.html --quality showcase --json
node "$CLI" deliver  architecture docs/arsenal-runtime.architecture.json     docs/arsenal-runtime.html            --quality showcase --json
```

`validate` 不通过就不要 `deliver`：`deliver` 只在候选产物**全部检查通过**之后才原子替换目标文件，
失败时保留上一版可用的产物。

### 三条出图的路

| 路 | 入口 | 什么时候用 |
|---|---|---|
| 命令行 | `node "$CLI" deliver …`（上面那两行） | 重新生成 `docs/` 下的交付物 |
| 页面里 | `/stack` → 「技术架构图」页签 → 「直接生成 HTML」 | 看**当前选型**画出来什么样，不必先落盘找编辑器 |
| 自检 | `cd arsenal-web && npm run verify:archify` | 改过 IR 适配器、画布或出图服务之后 |

第二条走的是 `arsenal-server`（3011）的 `POST /api/archify/deliver` —— 浏览器跑不了这套
Node 渲染器，所以要有个服务端起子进程。后端不在时按钮自动灰掉、那一行说清缺什么，
**其余四个出口照常可用**（军火库要能脱离服务器活着）。

三条路是同一个渲染器、同一份 IR 格式，所以下面这条字体警告对页面出的图**同样成立** ——
现有的 `docs/*.html` 是唯一的例外（它们是内嵌字体的旧版产物），不是标准。


### ⚠️ 重跑之前先读这段：产物会变，且未必变好

市场版（wrench-ai）与当初生成现有 HTML 的 codeload 版**不是逐字节同一产物**，已实测：

| | 规格 sha256 | 产物 sha256 | 字节 |
|---|---|---|---|
| 现有（codeload 版） | 见下表 | 见下表 | 806,972 / 808,745 |
| 市场版重跑 | **与下表完全一致** ✅ | **不一致** ❌ | 710,956 / 712,729（小约 96 KB） |

规格 hash 一致说明 **JSON 没被改动**；产物 hash 不一致的原因有两条，都是市场版重打包时改的：

1. **CSS 类名前缀 `archify-` → `wrench-ai-`**（换品牌，纯改字面量）。
2. **内嵌字体被换成 Google Fonts 外链** —— 这是实质差异。现有 HTML 把 JetBrains Mono 以
   base64 内嵌（约 88 KB），**真·离线自包含**；市场版改成
   `<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono...">` +
   `preconnect fonts.gstatic.com`，离线时回退到系统 monospace 栈。
   它只保留了一组 `local()` 的 `@font-face`，而且那条注释写明是**给导出图片的无头渲染用的**，
   不是给页面正文用的。

**结论：现有两张 HTML 保留，不要用市场版无条件覆盖。** 理由：这两张图是要给人看 / 贴进说明书的
交付物，内嵌字体比 CDN 外链更稳（离线可读、不受 Google Fonts 可达性影响、打开不外连）。
九项构图检查在两种构建下都是全绿，**图的画法没变，变的只是字体怎么送到浏览器**。

若确实需要用市场版重新出图（比如接入了新的图型），记得回填下表并接受字体回退。

### 校验到什么程度

`--quality showcase` 跑 9 项结构检查 + 一份构图度量，任一不过即失败：

```
single_svg · finite_svg · orthogonal_arrows · label_route_clearance
relationship_crossings · relationship_corridors · container_border_runs
route_rhythm · legend_clearance
构图：properCrossings / ambiguousCorridors / microSegment / desktopReadability …
```

这 9 项**全绿**是这两张图当前的基线（`errors: 0, warnings: 0`）。改图之后必须重新跑到全绿——
它拦的是"两条无关连线合并成一条视觉上分不清的走廊""标签压在方块上""在 1440px 视口下字号被
缩到看不清"这类**只有人眼才会发现、但人眼又经常漏掉**的问题。

## 交付回执（sha256）

`deliver --json` 每次都会给出规格与产物的摘要，用来确认"这份 HTML 确实由这份 JSON 编译而来"：

| 产物 | 规格 sha256 | 产物 sha256（codeload 版，即仓库现状） | 字节 |
|---|---|---|---|
| `arsenal-content-pipeline.html` | `1945f367099d757caddd5beda043a296461586210fdfb24bf5a1a00839187892` | `a319b0d0fc7bf3a586a77d515cbbb25584062a2639e336c2798a31793b864c8b` | 806,972 |
| `arsenal-runtime.html` | `0e5d4379107fce2e5f0da8f8e008e5cd70c3cabf891150b90784edc1378f1bd0` | `b5d320f9ff631772f3e607c0d0f0c0314c6c7d771df2233a4f116ba28fa28451` | 808,745 |

**规格 sha256 可复现**（2026-09-20 用市场版重跑，两行都与上表逐字节一致，`errors: 0, warnings: 0`，
9/9 检查通过）。**产物 sha256 在当前技能下复现不了**，原因见上一节——这一列记为「codeload 版」，
它描述的是仓库里这份 HTML 的出身，不是"重跑就该得到它"。

市场版同一份 JSON 产出的摘要（留档，便于将来对照）：

| 产物 | 产物 sha256（市场版） | 字节 |
|---|---|---|
| `pipeline.html` | `7b7cd3ff736dc5be52c8d12ab528b94a138181d8e0abb9fb1f82bea37cc8b81c` | 710,956 |
| `runtime.html` | `039595ee728bcff0a5080d74f332c251def083b655b5374f2ba605733df90286` | 712,729 |

## 看图

- 直接浏览器打开 HTML 即可，**单文件自包含**，不依赖网络、不需要服务端。
- 键盘：`?` 图例说明 · `/` 搜索定位节点 · `R` 路由探测 · `L` 角色透镜 · `P` 导览故事 · `[` `]` 翻章 · `F` 演示模式 · `S` 切换视觉风格 · `T` 明暗 · `E` 导出。
- 稳定链接：`#focus=<id>`、`#focus=<id>&reach=upstream|downstream`、`#route=<源>~<目标>`、`#lens=<类>~<类>`、`#view=<视图id>`。
  例如 `arsenal-runtime.html#view=mcp_gap` 直接跳到"未完成面"。
- 导出的 PNG / SVG 是**完整全图**，不含临时 viewer 状态；动效是有限的、受读者控制的、
  尊重 `prefers-reduced-motion`，且**从不进入导出**。

## 许可

仓库里这两份 HTML 内嵌了 Archify 的 viewer（MIT, © tt-a1i）与其第三方声明，**并内嵌了 JetBrains Mono
字体（OFL）**；再分发时请一并保留声明。技能目录（`~/.workbuddy/skills/wrench-ai/`）里带有完整的
`LICENSE` 与 `THIRD_PARTY_NOTICES.md`，可从这里取。

注意：市场版技能产出的 HTML 不内嵌字体，改为引用 Google Fonts CDN——若将来改用市场版出图，
再分发前需自行确认该引用的合规性与可达性。

本仓库自身的图（JSON IR）与仓库同许可。
