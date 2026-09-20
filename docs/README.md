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

用的是 [Archify](https://github.com/tt-a1i/archify)（MIT），版本 `2.17.0-dev.1`。

**刻意没有把它 vendor 进仓库**：它只在"改这两张图"时用一次，进 Git 会让仓库多背 2 MB 的
第三方渲染器与校验器。它落在 `.workbuddy/_archify-tool/`，而 `.gitignore` 里的
`.workbuddy/_*` 会挡住它，所以**它不在仓库里，删了也不影响任何构建**。

`2.17.0-dev.1` 而不是官方 npm 插件里的 `2.14.0`，是因为 `meta.locale`（viewer 中文本地化）
是 2.17 才加的，而插件包目前只发到捆绑 2.14.0 的 `@tt-a1i/archify-dsh@0.1.0`。

### 重新获取（本机网络环境的坑）

`registry.npmjs.org`、`codeload.github.com`、`api.github.com` 可达；
**`raw.githubusercontent.com` 与 `objects.githubusercontent.com` 在本机超时**；
`npm` / `npx` 又定位不到 Node 安装目录（nvm 的老问题），所以 `npx skills add` 这条路也走不通。

还有一条更隐蔽的：**`curl` 与 `Invoke-WebRequest` 在本机走 schannel，会报
`SEC_E_NO_CREDENTIALS` 或连接重置**。它们失败不代表网络不通 —— node 自带 TLS 栈可以通。
所以下载要用 node，不要用 curl：

```bash
# 源码包约 19 MB，解压后 CLI 在 archify-main/archify/bin/archify.mjs
node -e "const h=require('https'),f=require('fs');h.get('https://codeload.github.com/tt-a1i/archify/tar.gz/refs/heads/main',r=>{const c=[];r.on('data',d=>c.push(d));r.on('end',()=>{f.writeFileSync('archify-main.tar.gz',Buffer.concat(c));console.log('ok',c.length)})})"
tar -xzf archify-main.tar.gz -C .workbuddy/_archify-tool/main
node .workbuddy/_archify-tool/main/archify-main/archify/bin/archify.mjs doctor
```

`doctor` 会跑 15 项自检（Node 版本、viewer 模板、五个渲染器、校验器、预览运行时等）。
必须全部 `[ok]` 再往下走。

> 另一条路是 npm 上已发布的 `@tt-a1i/archify-dsh@0.1.0`，它内部捆了一份 Skill
> （用 node 直接拉 tarball 即可，同样别用 npm 命令）。但那份是 **2.14.0，没有
> `meta.locale`**，viewer 界面文案只有英文 —— 所以本仓库这两张图用的是 codeload 上的
> `2.17.0-dev.1`。语言这件事上 2.14 与 2.17 的差别是实打实的。

## 重新生成

```bash
CLI=.workbuddy/_archify-tool/main/archify-main/archify/bin/archify.mjs

node $CLI validate dataflow     docs/arsenal-content-pipeline.dataflow.json --quality showcase --json
node $CLI validate architecture docs/arsenal-runtime.architecture.json     --quality showcase --json

node $CLI deliver  dataflow     docs/arsenal-content-pipeline.dataflow.json docs/arsenal-content-pipeline.html --quality showcase --json
node $CLI deliver  architecture docs/arsenal-runtime.architecture.json     docs/arsenal-runtime.html            --quality showcase --json
```

`validate` 不通过就不要 `deliver`：`deliver` 只在候选产物**全部检查通过**之后才原子替换目标文件，
失败时保留上一版可用的产物。

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

| 产物 | 规格 sha256 | 产物 sha256 | 字节 |
|---|---|---|---|
| `arsenal-content-pipeline.html` | `1945f367099d757caddd5beda043a296461586210fdfb24bf5a1a00839187892` | `a319b0d0fc7bf3a586a77d515cbbb25584062a2639e336c2798a31793b864c8b` | 806,972 |
| `arsenal-runtime.html` | `0e5d4379107fce2e5f0da8f8e008e5cd70c3cabf891150b90784edc1378f1bd0` | `b5d320f9ff631772f3e607c0d0f0c0314c6c7d771df2233a4f116ba28fa28451` | 808,745 |

两张图的规格与产物都是 `--quality showcase`、`errors: 0, warnings: 0`。
重跑上面的 `deliver --json` 可以复现这两行摘要 —— 摘要一致即说明产物没被手改过。

## 看图

- 直接浏览器打开 HTML 即可，**单文件自包含**，不依赖网络、不需要服务端。
- 键盘：`?` 图例说明 · `/` 搜索定位节点 · `R` 路由探测 · `L` 角色透镜 · `P` 导览故事 · `[` `]` 翻章 · `F` 演示模式 · `S` 切换视觉风格 · `T` 明暗 · `E` 导出。
- 稳定链接：`#focus=<id>`、`#focus=<id>&reach=upstream|downstream`、`#route=<源>~<目标>`、`#lens=<类>~<类>`、`#view=<视图id>`。
  例如 `arsenal-runtime.html#view=mcp_gap` 直接跳到"未完成面"。
- 导出的 PNG / SVG 是**完整全图**，不含临时 viewer 状态；动效是有限的、受读者控制的、
  尊重 `prefers-reduced-motion`，且**从不进入导出**。

## 许可

生成的 HTML 内嵌了 Archify 的 viewer（MIT, © tt-a1i）与其第三方声明（含内嵌字体）。
Archify 的完整许可证与 `THIRD_PARTY_NOTICES` 随源码包一起在
`.workbuddy/_archify-tool/main/archify-main/`（不在 Git 里）；再分发这些 HTML 时请一并保留声明。
本仓库自身的图（JSON IR）与仓库同许可。
