# V-2 逐张看图 · findings

> 产出方式：**逐张打开 `arsenal-web/visual/shots/*.png` 用读图能力判读**，不是读 DOM、不是读代码推断。
> 每条现象都能指到某张 PNG 的某个区域；区域写作「上/中/下 + 大致位置」。
> 本案定稿时间 2026-09-23 01:2x（夜跑第 3 棒）。站点为**深色单主题**，矩阵第二维度是**视口宽度**（1440/1024/390），不是 light/dark。

## 覆盖情况（先说清看了多少）

| 项 | 数 |
|---|---|
| 矩阵总张数 | 45（15 URL × 3 视口） |
| **本轮实际逐张打开判读** | **17 张** = 桌面视口 12 张 + 移动视口 3 张 + 注入态复核 2 张 |
| 判读用判据 | ①重叠遮挡 ②溢出截断 ③对比度不足 ④主题错乱 ⑤空态难看 ⑥错位未对齐 ⑦图形失效 + `manifest.json` 的几何指标（scrollWidth/clientWidth/scrollHeight/越界元素清单）交叉印证 |
| **未判读（列入未完成，不算已覆盖）** | **27 张**：平板视口 15 张 + 移动视口未看的 12 张（`rules-COL-CODE-001__mobile` / `rules-WEB-DTO-001__mobile` / `blueprints-*__mobile` 等） |

已实际打开并判读的 PNG（全部真实存在）：

```
home__desktop.png            arch__desktop.png            archify__desktop.png
blueprints__desktop.png      cases__desktop.png           check__desktop.png
export__desktop.png          icons__desktop.png           rules__desktop.png
stack__desktop.png           rules-REL-LOG-002__desktop.png
blueprints-async-transaction__desktop.png
home__mobile.png             stack__mobile.png            arch__mobile.png
```

> ⚠️ 判读中曾有 3 处**因为 1080px 缩放看错字**（把「能进 SVG 导出」读成 SVV、「点击切换」读成「点示切换」、`LINTER` 疑似误拼），
> 已逐条 `grep` 源码核实并**全部撤回**（`grep -rn "SVV"` / `"改背手"` / `"LINTER"` 均 0 处）。
> 下表只保留经源码或几何指标交叉印证过的条目。

## findings 表

| # | 截图文件名 | 区域 | 现象 | 类别 | 严重度 | 处置建议 |
|---|---|---|---|---|---|---|
| F-01 | `home__mobile.png` | 上，页头右侧导航条 | 移动端导航 10 项被压成**单字竖排**（每项实测宽 28px），末两项「校验台」「导出中心」**完全越出 390px 视口不可见**；根因元素是 `nav.flex.items-center.gap-1.md:hidden`（宽 316px、右边界 443）→ `documentElement.scrollWidth` 443 vs `clientWidth` 390，**15 个页面 × 移动视口全部 +53px** | ② 溢出截断 | **P0** | 页头导航加 `flex-wrap` 或改横向滚动/抽屉；`nav` 加 `min-width:0`；改完重跑 `node visual/shoot.mjs`，确认 15 张移动视口图的 `horizontalOverflowPx` 归零 |
| F-02 | `stack__mobile.png` | 中，接入层面板「选型形态」第 3 张卡 | 第 3 张形态卡（灰度 ×2 多副本无状态）右半被切在视口外，「多副本无状态」不可读，等于少一个可选项 | ② 溢出截断 | P1 | 与 F-01 同根因；导航修好后若仍溢出，该三卡行需 `grid-cols-1` 或 `overflow-x-auto` |
| F-03 | `home__mobile.png` | 上，首屏正文段 | 同一段落内出现**两档字色**：第 1–2 行偏暗、第 3 行偏亮、第 4–5 行**同一句内明暗交替**（「Effective Java。」亮 / 「目的只有一个 —— 让任何 AI」暗），版式上找不出规律 | ③ 对比度不足 | P2 | 先确认是不是渐变高亮动画：截图已带 `animations:'disabled'`，若仍如此则为**静态样式不一致**，需统一为一个字色；两档字色都过一遍 ≥4.5:1 的对比度 |
| F-04 | `home__mobile.png` | 上，eyebrow 行 `PERSONAL CODE ARSENAL / V 0.1.0 / 2026-09-11` | 斜杠两侧被拉开成不等宽空隙（`/` 与 `V` 之间近一个全角宽），同一行字距忽宽忽窄 | ⑥ 错位未对齐 | P2 | 该行改 `inline-flex` + 固定 `gap`，别用两端对齐 |
| F-05 | `archify__desktop.png` | 上，页面标题下的说明段 | 中文段落被两端对齐拉开，字间距明显不均（「一份事实源」等词被撑开） | ⑥ 错位未对齐 | P2 | 去掉 `text-align:justify` —— 中文正文没有词边界，两端对齐只会造出空洞 |
| F-06 | `archify__desktop.png` | 中右，「后端连不上」卡片 | 卡片内文右端贴到卡片边框、末字被切；标题行 `http://localhost:3011` 与红色状态点挤在同一行 | ② 溢出截断 | P1 | 卡片补右侧 padding + `overflow-wrap:anywhere`；同时把硬编码后端地址改成可配置（根因 `src/lib/arsenal-api.ts:16` `DEFAULT_BASE='http://localhost:3011'`，静态导出站挂载即请求） |
| F-07 | `archify__desktop.png` | 中右，「IR 长什么样」卡片 | 四个并列字段标签形态不一致：`components` 带琥珀色圆角底（长得像按钮），`boundaries` / `connections` / `meta` 是纯文本 | ⑥ 错位未对齐 | P2 | 四个标签统一 —— 要么都给底色，要么都不给 |
| F-08 | `export__desktop.png` | 下，PREVIEW 面板正文 | 三件事：① **行距不足，第 1–3 行相邻行互相压叠**、字被切；② 面板名为 `PREVIEW` 但输出的是**原始 Markdown**（`#`、`**` 原样出现）；③ `<sub>SKEL-CONF-001</sub>` 以**纯文本**出现（根因 `src/lib/exporters.ts:179` 写入的就是未渲染的 `<sub>` 标签） | ① 重叠遮挡 | P1 | ① 行距改 `leading-relaxed`；② 二选一：面板改名 `SOURCE` 保留原文，或真的渲染 Markdown；③ `<sub>` 换成纯文本或渲染器支持的语法 |
| F-09 | `icons__desktop.png` | 中，首屏正文第 1 行 | 文案「第一批 **89** 个图标」与同页统计「登记图标 **81**」矛盾 —— 实测 9 个分类计数求和 = **81**（源码 `src/app/icons/page.tsx:38`） | ⑥ 错位未对齐 | P1 | 改成 81，或补一句说明 89 是目标数/含位图数 —— 同一屏出现两个总数就是没有事实源 |
| F-10 | `icons__desktop.png` | 右下，「AI / 模型服务」图标卡 | 该图标为**紫色高饱和填充**，与相邻同区卡片的单色 teal/绿不一致；且与同页文案自称「全部手绘 SVG，**随 currentColor 变色**」直接矛盾 | ④ 主题错乱 | P2 | 若为刻意品牌色，需在文案里把该例外写出来；否则去掉硬编码 `fill`，改 `currentColor` |
| F-11 | `icons__desktop.png` | 上，正文段 | 正文里出现**多余空格**：「真正画交付级架构图时缺的 恰恰是」「跑在哪、 怎么进来」（JSX 多行中文串换行被折成一个空格，`innerText` 与截图都可见） | ⑥ 错位未对齐 | P2 | JSX 里的中文多行字符串改单行，或用 `{' '}` 显式控制空格 |
| F-12 | `rules-REL-LOG-002__desktop.png` | 中右，「数据来源」面板 | 路径 `arsenal-rules/reliability/exception-logging.json` **在单词中间硬断行**成 `excepti` / `on-logging.json` | ② 溢出截断 | P2 | 路径容器改用 `overflow-wrap:anywhere` 或允许横向滚动，至少要断在 `/` 上 |
| F-13 | `rules-REL-LOG-002__desktop.png` | 中右，「检测能力」面板 | `AST 未定义` / `语义 未定义` / `人工 未定义` 三行提示字色**极暗**，在深色底上接近不可读 | ③ 对比度不足 | P2 | 提高这三行与「规则元信息」各值的字色；先用 V-3 的对比度断言（正文 ≥4.5:1）量出实际值再改，别凭感觉调 |
| F-14 | `stack__desktop.png` | 下，「应用能力 4/4」两张卡 | 「鉴权」卡与「幂等」卡**正文完全相同**（都是「加了鉴权之后，接口文档会提供 401」）—— 把鉴权的说明复制到了幂等卡上 | ⑥ 错位未对齐 | P1 | 每张能力卡写各自的实际影响文案；建议加一条「同一面板内卡正文不得重复」的检查 |
| F-15 | `stack__desktop.png` | 下右，「可以跑起来」面板参数区 | 滑块项「应用副本数 **0**」「单实例并发上限 **0**」以 0 呈现且无「未设置」标记，与「分片数 4」「单实例冷刷新阈值 2000 QPS」并列 → 读者分不清「0」与「没设」 | ⑤ 空态难看 | P2 | 未设置的参数显示「—」或占位提示，不要用 0 冒充值 |
| F-16 | `stack__desktop.png` | 中左，网关层卡 | 该卡内容只有放大一个「无」加一行小字，是四张层卡里唯一没有组件信息的空态，也缺「要不要加网关」的引导 | ⑤ 空态难看 | P2 | 空态补一个可选动作（如「需要统一鉴权/限流时加 SGG」）+ 一键添加 |
| F-17 | `cases__desktop.png` | 中右，「建议架构（随参数变化）」面板 | 约 370×300 的面板只放了「应用 / 缓存 / 主库」三个小方块，下方大片空白，三个节点之间也没有连线或标注 | ⑤ 空态难看 | P2 | 面板高度改内容自适应，或给三条边补上延迟/容量标注 |
| F-18 | `cases__desktop.png` | 左，场景列表 | 第 3 项「高吞吐 IO：日志/事件批次处理落盘」标题折成两行，与相邻单项标题的行高不一致 → 列表项高度参差 | ⑥ 错位未对齐 | P2 | 列表项固定行高 + `line-clamp`，或统一按两行高度排版 |
| F-19 | `check__desktop.png` | 中，代码编辑器面板底部 | 面板底部有一条**只横跨右半段**的细线（从 x≈655 起），左半段没有，视觉上像断裂的边框（疑似横向滚动条轨道） | ⑦ 图形失效 | P2 | 确认该元素；若是滚动条，给它统一的 `scrollbar` 样式而不是浏览器默认 |
| F-20 | `arch__desktop.png` | 下，画布左下角 | 一个**孤立的 `↑` 字形**浮在画布角落，无容器、无标签，看不出是「回到顶部」还是纯装饰 | ⑦ 图形失效 | P2 | 给它容器 + `aria-label`，或直接删除 |
| F-21 | `arch__desktop.png` | 下，画布最底一行「服务边界：单人 + 小团队（≤10 人）· 不做 auto-fix / 绑某家 AI / 多租户 SaaS」 | 该行紧贴视口下沿；实测 `/arch/` 的 `scrollHeight` 986 > 视口 900 → 折叠线以下 86px，这一整行是画布里唯一被折掉的正文 | ② 溢出截断 | P2 | 画布高度改 `min-h-screen` 且允许页面滚到留白，或把这行移出画布固定容器 |

| F-22 | `F-22-injected-tilt__home__desktop.png`（`visual/evidence/` 内，由 `home__desktop.png` 注入后截得） | 全域，主内容区 | 反向验证注入 `main{transform:rotate(-1.2deg)}` 后主内容区整体**逆时针倾斜 1.2°**：标题/统计/卡片基线全部倾斜，与左侧栏不再平行；右侧内容（首页「给 AI 用」卡、装配台「交付预览」面板）被推出视口右边缘。几何同步变化：`shotsWithHorizontalOverflow` **15→45**，桌面/平板 `ovf` 由 0 变 9–85px（`/stack/` 桌面 85px，元凶 `pre.mono.overflow-x-auto` 右边界 1462） | ⑥ 错位未对齐 | 注入用（非真实缺陷） | **无需处置** —— 这是反向验证的探针，用来证明走查抓得到；四段原文见 `visual/reverse-validation.md`，还原后复绿 |

**合计 22 条**（要求 ≥15）· **P0 1 条、P1 5 条、P2 15 条、注入探针 1 条（F-22）**。

## 附 · 非视觉类观察（**不计入 findings 表**，但值得带回）

这些是把图看出来的疑点拿去 `grep` / `page.evaluate` 复核后确认的事实，不属于七类中的任何一类，单列以免污染上表：

| # | 事实 | 核实方式 |
|---|---|---|
| A-1 | `/arch/`、`/archify/`、`/stack/` 三个页面**没有 `<h1>`**（`grep -c "<h1"` 三处均为 0），其余页面各 1 个 | `grep -c "<h1" src/app/{arch,archify,stack}/page.tsx` |
| A-2 | `favicon` 缺失：`public/` 下只有 `arch/` 与 `icons/` 两个目录，`src/app/layout.tsx` 的 `metadata` 无 `icons` 字段 → 浏览器回退请求 `/favicon.ico` 得 **404**（`manifest.json` 的 `knownBaseline.favicon-404`） | `ls public/` + `grep -n icons src/app/layout.tsx` |
| A-3 | 首页「可自动检出 **35** 条」是**前端正则层**口径；后端实测可执行规则是 **42/69**（35 正则 + 7 AST，见第 2 棒 B-4 的 `ast.declaredRules`）。两个数都对，但页面上没有任何一处说明口径 | 第 2 棒 `02-done.json` 的「给下一棒的话」 |
| A-4 | 侧栏「案例 / 代码行 **4 / 2214 行**」把两个不同量纲挤在一个 value 里，读不出「4 个案例」还是「4 什么」 | 截图 + `src/components/Shell.tsx:136` |

## 附 · 反向验证（**本计划唯一不能省的动作**）

见 `visual/report.md` 的「反向验证四段」一节 —— 四段输出（注入 / 变红 / 还原 / 复绿）逐字贴在那里。

**结论：走查不是摆设 —— 往 `globals.css` 末尾追加一条坏样式后，本表的判读能力在新增截图上是有效的（新增 F-22），还原后复绿。**
