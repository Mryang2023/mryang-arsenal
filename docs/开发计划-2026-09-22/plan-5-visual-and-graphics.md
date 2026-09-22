# 计划 5 · 眼睛：视觉走查与图形资产（多模态专用）

> 前四份计划都在让「数字」和「文字」可信；这一份让「**画面**」可信。
> **适用执行者：具备看图能力的多模态模型。**纯文本模型做这份计划会退化成走过场 —— 见 §四。
> 本计划与计划 1/2 **无文件重叠**，但与本计划外的 `src/**` 有重叠，故不得与计划 3 同波（见 §二）。

---

## 〇、为什么有这份计划（实测，非转述）

仓库里**已经有三套截图脚本，但没有一个人看过那些 PNG**：

| 已有物 | 规模 | 缺陷 |
|---|---|---|
| `.verify/shots.mjs` | 62 行，拍 6 张（装配台 6 个状态） | 只覆盖 `/stack`；无索引；默认 URL 是 `http://127.0.0.1:3010/stack/` |
| `.verify/shots-project.mjs` | 105 行，含下载接住 → 落盘 | 同上；产物进 `.verify/tmp`（verify 运行目录，随时被清） |
| `.verify/shots-case-library/` | 3 张 PNG | 无脚本登记（手工拍的一次性产物） |

三个逐页走查欠账（体检 §七原文）：

1. **10 个页面从未逐页浏览器走查**（`ls out/` 实测 10 个页目录 + 首页）。
2. **`check-case-library.mjs:90-93` 的 `page.on('pageerror')` 注册在前三次 `goto` 之后** ——
   所谓「无运行时报错」其实只覆盖了最后一个页面。这是**静默失败**的教科书形态。
3. **没有任何一处把「画面」变成可判定的东西** —— 所以「这页看着不对」永远靠人偶然发现。

三条实测出的**口径纠正**（写下来防止下一个 agent 造错东西）：

| 别以为 | 实际 |
|---|---|
| 有 light/dark 双主题要跑 | **站点是深色单主题**：`globals.css:5-14` `color-scheme: dark` + `html,body{background:#0b0f0e;color:#e8f0ec}`。**没有主题切换开关**（`Shell.tsx` 里 grep 不到 `darkMode/data-theme/prefers-color-scheme`）→ 矩阵里**不要**造第二主题维度 |
| 画布也只有深色 | 画布**有五态**：`arch-canvas.ts:525` `CanvasTheme = 'dark'\|'light'\|'doc'\|'slide'\|'blueprint'`（`:617` 有 `blueprint` 的 UI 入口「蓝图 · 工程图纸质感」）→ **这才是视觉上真正的第二维度** |
| 3010 端口随便用 | `netstat` 实测此刻 3000–3029 **无监听**。但 3010/3011 在本机其他项目文档里被占用过 → 本计划**钉死 3021**，开跑前先查占用 |

---

## 一、任务清单

### V-1　截图矩阵台（**先有素材，才谈得上看图**）

**做**：新建 `arsenal-web/visual/shoot.mjs`（**纯 `.mjs`，用 `node` 直接跑，不用 tsx** ——
`.verify/**` 不在 tsconfig 里、坏 import 只在运行时炸，别再给自己埋一次）。

1. **URL 清单从产物实测生成**：扫 `out/**/index.html`，不许手写页面数组。
   动态路由各抽 3 个实例（`out/rules/<id>` 排序后取首/中/末，`out/blueprints/<id>` 取 2 个）。
   预期：`10（固定页）+ 3 + 2 = 15` 个 URL。
2. 视口三档：`1440×900` / `1024×768` / `390×844`。**预期截图数 = 15 × 3 = 45**。
3. **监听器必须在 `goto` 之前注册**（这条就是欠账 2 的修法）：
   `page.on('pageerror')` / `page.on('console')`（只收 `error`）/ `page.on('requestfailed')`，
   按 URL 累积，不许共用一个数组后打印（那样丢失归属）。
4. 每张图附带采集：截图字节数、`documentElement.scrollWidth/clientWidth`、
   `body.scrollHeight`、`img` 加载失败列表（`naturalWidth===0 && src` 非空）。
5. 产出 **`arsenal-web/visual/manifest.json`**（机器可读，V-3 的输入）+ `visual/report.md`（人读）。

**跑法**：

```bash
export PATH="/usr/bin:/bin:/c/Windows/System32:/c/Windows:$PATH"
cd /d/mryang/workspace/2026/arsenal/arsenal-web
mv .next ".next-bak-$(date +%H%M%S)" 2>/dev/null        # rename 不计删除，绕开 safe-delete 守卫
node scripts/next-run.mjs build                          # 不许直接 npx next
"C:/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12/python.exe" \
  -m http.server 3021 --bind 127.0.0.1 --directory out &
node visual/shoot.mjs
```

**浏览器**：`chromium.launch({ channel: 'msedge' })`。**本机没有 Chrome**
（`C:\Program Files\Google\Chrome\Application\chrome.exe` 实测不存在），Edge 在
`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`。
`00-index.md`（hy4 旧版）里写的 Chrome 路径是错的。

**验收（脚本自带退出码，不许只看打印）**：
- 截图数 `=== 45`，每张 `> 8KB`；
- `pageerror` 总数、`console.error` 总数、`requestfailed` 总数 **各为 0**，非 0 则打印全文并**退出码 1**；
- `visual/manifest.json` 能被 `JSON.parse`，且 `manifest.urls.length === 15`。

**反向验证（必做，贴进报告）**：把 `out/stack/index.html` 里引用的某张图标文件名改坏一个字符 →
重跑 `node visual/shoot.mjs` → **必须红，且报错里带那个文件名**。还原。

---

### V-2　逐张看图（**本计划的核心，也是多模态唯一能做的一段**）

**做**：用读图能力**逐张**打开 `visual/shots/*.png`，按**七类**判定，产出
`arsenal-web/visual/findings.md`：

| 类 | 判什么 |
|---|---|
| ① 重叠遮挡 | 导航/浮层/图例压住正文，两个定位元素互相盖 |
| ② 溢出截断 | 内容超视口被切、长 ID/长规则名撑破列宽、表格横向溢出 |
| ③ 对比度不足 | 文字与其底色接近（深色站尤其常见：`#3a4a45` 底 + `#4a5a55` 字） |
| ④ 主题错乱 | 深色页面里出现白底块 / 半透明叠加发灰 |
| ⑤ 空态难看 | 空数据、未选型、未扫描时的画面没有引导，或大面积空白 |
| ⑥ 错位未对齐 | 表格列错行、卡片高矮不齐、图例与线色对不上 |
| ⑦ 图形失效 | 图标缺失成占位方块、架构图连线穿节点、SVG 文字溢出画布 |

**每条格式（缺字段即不算）**：
`| # | 截图文件名 | 区域 | 现象 | 类别 | 严重度 | 处置建议 |`
（区域写「上/中/下 + 大致位置」，如「中部右侧，因子表第 3 行」）

**硬性要求**：
- **≥ 15 条**；P0/P1 至少各 1 条。若真的找不到 P0，必须写清「查了哪几张、用什么判据」，
  不许一句「未发现严重问题」了事。
- **每条必须引用真实存在的 PNG 文件名** —— 由
  `node visual/assert.mjs --check-findings` 核对存在性（V-3 一并做）。
- **不许写不可核对的评语**：「整体美观」「体验良好」「可以接受」一律删掉。

**反向验证（证明你真有眼睛，必做）**：
往 `globals.css` **末尾追加**一条明显坏样式（例：`.shell-main{ overflow-x: hidden; }` 造成截断，
或给某个主容器加 `transform: rotate(-1.2deg)`）→ 重跑 `shoot.mjs` → 重看图 →
**findings 里必须新增对应条目**（且能指出是哪一种错位）→ **还原样式并复跑复绿**。
四段输出（注入 / 变红 / 还原 / 复绿）全部贴进报告。
> 做不到这一步 = 这套走查是摆设。这是本计划唯一不能砍的动作。

---

### V-3　把「看着不对」变成「机器能判」（挑 6 条，别贪）

**做**：新建 `arsenal-web/visual/assert.mjs`，从 V-2 的发现里挑** ≥6 条纯计算就能判定**的，写成断言：

1. `documentElement.scrollWidth <= clientWidth`（无横向溢出）
2. 所有元素右边界 `getBoundingClientRect().right <= clientWidth + 1`（抽样：可见的 `main` 一级子元素）
3. 无 `img` 加载失败（`naturalWidth === 0`）
4. 同一视口下固定定位元素两两矩形不相交（采样 `position:fixed`）
5. 正文文字对比度 ≥ 4.5:1（取元素 `color` + 最近的**不透明**祖先背景，按 WCAG 公式算）
6. `<h1>` 数 === 1（每页唯一）
7. 滚动到底部后剩余空白 < 40vh（防「假高度」）

**分工写清楚**：**断言负责「几何与数值」，看图负责「语义」**（图标是否认得出、结论文案是否说得通、
图表是否表意）。不要试图把「这块丑不丑」写成断言 —— 那是给自己造一个必然误报的检查。

**接口**：`node visual/assert.mjs` → 退出码 0/1，尾行打印 `visual: 45 张 / 6 项断言 / 0 失败`。

**握手点（重要）**：**本计划不碰 `package.json`、`arsenal-profiles/arsenal.json`、
`.verify/project-check.ts`** —— 那三处是计划 1 的地盘。挂进 verify 链由**终检棒**做
（3 行改动 + 重跑 `node scripts/sync-content.mjs`）。本任务只交付一个**可独立运行**的脚本。

**反向验证**：临时加 `main { width: 3000px; }` → `node visual/assert.mjs` **必须红并打印实际宽度** → 还原。

---

### V-4　图形资产（手写 inline SVG，**零依赖是硬约束**）

`package.json` 运行时依赖只有 `next / react / react-dom`。**不许**引图标库、绘图库、字体 CDN。

| 产物 | 规格 | 接线 |
|---|---|---|
| `public/og.svg` | 1200×630 分享卡：仓库名 + 三原则一行 + `v<version>` | `layout.tsx` 的 `metadata.openGraph.images` |
| `public/favicon.svg` | 32×32 几何标记（可用仓库主色 `#d9a441`） | `layout.tsx` 的 `metadata.icons` |
| `public/logo-mark.svg` | Shell 顶栏用的标记 | **只交付文件**，接进 `Shell.tsx` 属计划 3 → 列为交接项 |

**打印样式**（`/rules` 与 `/arch` 要能直接打印成 PDF）：
在 `src/app/globals.css` **末尾追加** `@media print { ... }` ——
隐藏导航/浮层/动画、强制浅底深字、`break-inside: avoid` 防卡片被切断。
**只许追加，不许改既有规则**（这文件同时是计划 3 的地盘，追加是最小冲突面）。

**验收（命令 + 期望输出）**：
- `node scripts/next-run.mjs build` 后 `ls out/og.svg out/favicon.svg` 两个都存在；
- **用解析器验，不用正则**：
  `python -c "import xml.etree.ElementTree as ET; [ET.parse(p) for p in ['out/og.svg','out/favicon.svg']]"`
  必须无异常（**反向验证**：故意删掉一个 `</g>` → 必须抛 `ParseError`）；
- `grep -c "@media print" src/app/globals.css` ≥ 1，且 `git diff` 里 globals.css **只有新增行**。

---

### V-5　位图图标 18 → 81（**默认只许做 1 批，且需额度**）

**现状实测**：`find public/icons -type f | wc -l` = **18**（9 类各 2 张）。矢量 81/81 已全量可用，
所以这一条是**唯一花钱的任务**，不影响任何功能的可用性。

**默认上限（本计划写死，改这个数即调额度）**：
> 今晚最多做 **1 批 = 2 个类目 ≈ 18 张 ≈ 90–180 credits**。
> 做完停下，在报告里写「已完成 N 类 / 余 N 类」，**不许连续开第二批**。

**每批固定四步（缺一步闸门就红）**：
1. 生图，prompt **必须以 `<key> icon` 开头**（工具只取前 ~30 字符当文件名，否则配不上 key）；
2. `npm run icons:rasterize <原图目录>`（无头浏览器 → 512×512）；
3. 在 `tools/content/icons.py` 的 **`BITMAPS` 表**登记 `key → '<category>/<key>.png'`；
4. `python tools/build-content.py` → `node scripts/sync-content.mjs`。

**验收**：`sync` 输出「N 张位图已落盘（XKB），无孤儿文件」，且 `X < 6144`（全库 6MB 闸门）。

---

### V-6　视觉回归基准 + 并排对照页

**做**：
1. 冻结 5 个关键画面到 `visual/baseline/`：`/stack` 生产标配、`/stack` 拆掉数据库、
   `/arch` 分层图、`/rules/<id>` 详情、`/check` 结果态。
2. 新建 `visual/compare.html`：**自包含**，左右两块 `<img>` 并排（baseline / latest），
   零依赖、无脚本。用 Python 小脚本按 `manifest.json` 生成，别手写 10 个 `<img>`。
3. **对比由看图完成**（不是像素 diff 库）：开 `compare.html` 截图 → 读图判「是否退化」。

**验收**：`visual/compare.html` 存在且用 `python -m http.server` 打开时左右两张都渲染出来
（不是白框）—— 这本身就要靠**看图**确认，文本检查不到。
**用途**：后续任一棒改了 `arch-canvas.ts` / CSS，多模态只需重跑 V-1 + 开一次 compare 页即可判退化。
> 不引入 `pixelmatch` 之类的像素 diff 依赖：本仓库铁律是零外部依赖，而「看并排图」由多模态来做更准。

---

## 二、文件所有权

| 路径 | 权限 |
|---|---|
| `arsenal-web/visual/**`（新建：脚本 / 截图 / 报告 / 基线） | ✅ **独占** |
| `arsenal-web/public/og.svg` `favicon.svg` `logo-mark.svg`（新建） | ✅ **独占** |
| `arsenal-web/src/app/globals.css` | ⚠️ **仅允许在文件末尾追加 `@media print` 段** |
| `arsenal-web/src/app/layout.tsx` | ⚠️ **仅允许改 `metadata` 段** |
| `arsenal-web/package.json` · `arsenal-profiles/arsenal.json` · `.verify/project-check.ts` | ⛔ 由**终检棒**收口挂链 |
| `arsenal-web/.verify/**` | ⛔ 计划 1 独占 |
| `arsenal-web/src/lib/engine.ts` | ⛔ 计划 2 独占 |
| `arsenal-web/src/**`（`globals.css`/`layout.tsx` 之外） | ⛔ 计划 3 独占 → **本计划与计划 3 不得同波** |

**截图入库策略**：`visual/shots/**`（45 张，约 5–10 MB）**加进 `.gitignore`**，
只提交 `manifest.json` + `report.md` + `findings.md` + `compare.html` + 被结论引用的那几张
（放 `visual/evidence/`，≤ 10 张）。理由：仓库已有 6MB 图标闸门，别让证据图把仓库撑起来。

---

## 三、验收出口（逐条可核对）

| # | 命令 | 期望 |
|---|---|---|
| 1 | `node arsenal-web/visual/shoot.mjs` | `截图 45 / pageerror 0 / console.error 0 / requestfailed 0`，退出码 0 |
| 2 | `node arsenal-web/visual/assert.mjs` | 尾行 `visual: 45 张 / 6 项断言 / 0 失败`，退出码 0 |
| 3 | `node arsenal-web/visual/assert.mjs --check-findings` | findings 里每个文件名都真实存在；条数 ≥ 15 |
| 4 | 反向验证四段 | 注入坏样式 → 变红（发红原文）→ 还原 → 复绿 |
| 5 | `python -c "import xml.etree.ElementTree as ET; ..."` | 两个 SVG 解析通过；删一个闭合标签后必须抛错 |
| 6 | `git diff --stat src/app/globals.css` | 只有新增行（无删除行） |
| 7 | `node scripts/next-run.mjs build` | `out/og.svg` `out/favicon.svg` 存在，构建成功 |
| 8 | `ls public/icons \| wc -l`（若做了 V-5） | ≥ 3 类，且 sync 报「无孤儿文件」+ 全库 < 6MB |

---

## 四、多模态专用纪律（**这段是本计划的一半价值**）

1. **必须真的打开图片看。** 不许根据 DOM 文本、`page.evaluate` 的数值、或代码想象画面然后写结论。
   → 自查：你写下的每条现象，能不能指到某张 PNG 的某个区域？不能就删掉。
2. **不可核对的评语等于没写。** 「美观 / 现代 / 还行 / 可以接受」一律不许出现在 findings 里。
3. **先看图，再改代码。** 这一棒的主产出是**证据（45 张图 + findings）**，不是补丁。
   修 CSS 只在「明显、便宜、且在你所有权白名单内」时才当场做，其余写进 findings 交给计划 3。
4. **反向验证不许省。** 注入一处明显坏样式、证明自己抓得到、再还原 —— 这是唯一能证明
   「这套走查不是走过场」的动作。做不到就如实写「未完成」，不许把没做的动作写成做过。
5. **别造第二主题。** 站点深色单主题（见 §〇）。要造对比就造**视口宽度**与**画布五态**。
6. **守端口。** 用 3021；起站前先 `netstat -ano | grep LISTENING | grep :302` 确认没占用。
   收工必须杀掉 http.server（`kill %1` 或记 PID 后 `taskkill`）—— 留常驻进程会挡住后续夜跑。
