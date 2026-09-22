# V-2 逐张看图 · findings

> 产出方式：**逐张打开 `arsenal-web/visual/shots/*.png` 用读图能力判读**，不是读 DOM、不是读代码推断。
> 每条现象都能指到某张 PNG 的某个区域。区域写作「上/中/下 + 大致位置」。
> 定稿 2026-09-23（夜跑第 3 棒）。站点是**深色单主题**，矩阵的第二维度是**视口宽度**（1440/1024/390），不是 light/dark。

## 覆盖情况

| 项 | 数 |
|---|---|
| 矩阵总张数 | 45（15 URL × 3 视口）+ 2 张注入态复核 |
| **实际逐张打开判读** | **34 张** = 桌面 14 + 平板 9 + 移动 9 + 注入态 2 |
| **未判读（如实列出，不算已覆盖）** | **13 张**：`rules-COL-CODE-001` 三档全部、`rules-REL-LOG-002` 平板/移动、`rules-WEB-DTO-001` 平板/移动、`blueprints__mobile`、`blueprints-async-transaction` 平板/移动、`blueprints-skeleton-config` 平板/移动、`rules__tablet` |
| 判读判据 | ①重叠遮挡 ②溢出截断 ③对比度不足 ④主题错乱 ⑤空态难看 ⑥错位未对齐 ⑦图形失效 + `manifest.json` 几何指标 + DOM 探针交叉印证 |

## ⚠️ 先读这一段：**判读中被推翻的 7 条**（眼睛会被缩放骗，这是纪律的代价）

第一轮只看桌面截图（1440→1080 缩放）时，我写下了 22 条。逐条拿源码 / DOM 复核后，**7 条站不住，已全部撤回**。
把撤回过程留在文档里，比悄悄删掉更有用 —— 它说明下面留下的 18 条是过了复核的。

| 原判读 | 撤回原因（复核方式） |
|---|---|
| 「中文段落被两端对齐拉开，字距不均」（archify / 首页 eyebrow） | **全站 `text-align: justify` 的元素数 = 0**（`page.evaluate` 扫 `p,div,span`）。所谓「空隙」是 `tracking-[0.22em]` 字距 + 0.75 缩放下的错觉 |
| 「eyebrow `/` 两侧空隙不等宽」 | 源码是 `flex gap-x-3`，`/` 是独立 flex 项，两侧间距由 gap 统一给出（`page.tsx:60-67`）。不存在不等宽 |
| 「`components` 标签带琥珀色底，四个并列标签形态不一致」 | DOM 实测四个标签**计算样式完全相同**：都是 `code.mono text-[11px] text-fg`，`color` 同为 `rgb(232,240,236)`、`fontWeight 400`、`background transparent`、`borderRadius 0` |
| 「`/cases/` 建议架构面板方片大片空白」 | DOM 实测面板 655×338，子元素合计 296px —— 内容填充正常 |
| 「`check` 页代码面板底部有一条只横跨右半段的细线」 | DOM 实测 `scrollWidth > clientWidth` 且宽度 >100 的容器**一个都没有**，不存在该滚动条 |
| 「场景列表项高度参差」 | 实测列表项盒高一致（113 / 115px），只是长标题在盒内折行 |
| 「`/blueprints/` 统计块四列宽度不均」 | DOM 实测四列**都是 235px**、起点 307/575/843/1111（等距） |

**同时撤回的还有三处字面误读**（已 `grep` 源码核实为空）：「能进 SVV 导出」→ 源码是 `SVG`；
「点示切换」→ 源码是 `点击切换`；`LINTER` 疑似误拼 → `linter` 全大写本就正确。

> **本棒的教训**：`1440×900 → 1080` 的缩放会把小字看错。**看图得到的是「疑点」，写成 finding 前必须用 `grep` 或 `page.evaluate` 复核一次。**
> 每个视口的图都保留原始 PNG（`visual/shots/`），复核用的一行命令见文末。

## findings 表

| # | 截图文件名 | 区域 | 现象 | 类别 | 严重度 | 处置建议 |
|---|---|---|---|---|---|---|
| V2-01 | `home__mobile.png` | 上，页头右侧导航条 | 移动端导航 10 项被压成**单字竖排**（每项实测宽 28px），末两项「校验台」「导出中心」**完全越出 390px 视口、看不见也点不到**。根因元素 `nav.flex.items-center.gap-1.md:hidden`：实测宽 316px、`right=443` → `documentElement.scrollWidth 443 vs clientWidth 390`，**15 个页面 × 移动视口全部 +53px**；全站移动端都有横向滚动条 | ② 溢出截断 | **P0** | 页头导航加 `flex-wrap` 或改横向滚动 / 抽屉；`nav` 补 `min-width:0`。改完跑 `node visual/shoot.mjs`，确认 15 张移动视口图的 `horizontalOverflowPx` 归零 |
| V2-02 | `rules__mobile.png` | 上，搜索框 / 中，规则卡右上分类标签 | **同一根因在输入控件上的具体表现**：`rules__mobile.png` 搜索框 placeholder 被视口右缘切掉（「…例如「@Valid」「线程」缺右引号）；`check__mobile.png` 文件路径框被切成 `src/main/java/com/smarthub/controller/UserC`（看不到文件名）；`icons__mobile.png` 搜索框被切成「例如 缓存、nacc」（`nacos` 少了 `os`）；`stack__mobile.png` 接入层第 3 张形态卡被推出视口，文案「多副本无状态」不可读 | ② 溢出截断 | P1 | 与 V2-01 同根因，**先修导航**；若仍有溢出，这三个输入框需 `min-width:0` + `text-overflow` 处理，第 3 张形态卡改 `grid-cols-1` |
| V2-03 | `archify__desktop.png` | 中右，「后端连不上」卡片 | 静态导出站（`output:'export'`）**挂载即请求硬编码后端** `http://localhost:3011/api/archify`，后端未起就进入红色错误态：卡片顶部一个红点 + URL，正文若干行说明。`manifest.json` 实测**三个视口都产生 requestfailed + console.error**。根因 `src/lib/arsenal-api.ts:16 DEFAULT_BASE = 'http://localhost:3011'` | ⑤ 空态难看 | P1 | 静态站不该在首屏把「连不上」当默认态：① BASE 改可配置（`NEXT_PUBLIC_*`）；② 离线时展示中性的「离线模式 · 可从左栏复制 IR 走 CLI」而不是红色告警 |
| V2-04 | `export__tablet.png` | 下，PREVIEW 面板正文 | 面板名为 **PREVIEW**，但输出的是**原始 Markdown**：`# 代码规范约束`、`## 一、强制项（MUST）`、`以下约束**优先级高于你的默认编码风格**。`（`**` 原样出现）；并且 `<sub>SKEL-CONF-001</sub>` 这类标签**以纯文本泄漏**（根因 `src/lib/exporters.ts:179` 写入的就是未渲染的 `<sub>` 标签） | ⑦ 图形失效 | P1 | 二选一：面板改名 `SOURCE · 源文件` 并保留原文，或者真的渲染 Markdown；`<sub>` 换成纯文本（如 `（SKEL-CONF-001）`）或渲染器支持的语法 |
| V2-05 | `icons__tablet.png` | 中，首屏正文第 1 行 | 文案「第一批 **89** 个图标」与同页统计「登记图标 **81**」矛盾。实测 9 个分类计数求和 = **81**（`角色与外部10 计算与运行11 网络与入口11 存储9 中间件6 观测与运维9 安全9 交付与工程8 形态8`）。源码 `src/app/icons/page.tsx:38` 写的是 89 | ⑥ 错位未对齐 | P1 | 改成 81，或补一句说明 89 的口径（目标数 / 含位图数）—— 同一屏出现两个总数等于没有事实源 |
| V2-06 | `stack__desktop.png` | 下，「应用能力 4/4」两张卡 | 「鉴权」卡与「幂等」卡的说明**完全相同**：「加了鉴权之后，接口文档会整体 401」。DOM 实测该句在页面上出现 **2 次**，而 `src/generated/architecture.json` 里只有 **1 条**带该标题的条目 → 幂等卡挂在了鉴权的说明上 | ⑥ 错位未对齐 | P1 | 给「幂等」等能力卡各写自己的影响文案；建议加一条「同一面板内能力卡正文不得重复」的检查 |
| V2-07 | `home__tablet.png` | 上，首屏正文段 | 同一段落用了**三档字色**：基色 `text-fgMuted` + `<span className="text-fg">行业基准</span>` + `<span className="text-brass">让任何 AI 生成的代码，都收敛到同一套规范上。</span>`（源码 `page.tsx:73-79`）。两处都是「划重点」，却用了两种不同的强调色，读者无法从颜色看出层级差别 | ⑥ 错位未对齐 | P2 | 定一条强调色规则：同页同层级的强调只用一种色；若要区分「出处」与「结论」，就在文案上写出来而不是靠颜色 |
| V2-08 | `icons__tablet.png` | 右下，「AI / 模型服务」图标卡 | 该图标的计算颜色是**紫色 `rgb(108, 92, 231)`**，而它在 `src/generated/icons.json` 里的 `category` 是 **`actor`** —— 同类目其余图标的颜色是**石板灰系**：`用户 rgb(74,85,104)` / `管理员 rgb(60,74,92)` / `遗留系统 rgb(90,100,114)`。色相不同而非明度不同，是网格里唯一一个跳出灰/绿/蓝/红主色的图标 | ④ 主题错乱 | P2 | 若 AI 品牌色是刻意的例外，请在页面上写明；否则去掉该图标的专属色，跟随类目色 |
| V2-09 | `icons__tablet.png` | 中，首屏正文段 | 源码 JSX 的多行中文串会在**句中插入一个空格**：`innerText` 实测为「真正画交付级架构图时缺的 恰恰是那些」「谁在用系统、跑在哪、 怎么进来」（`src/app/icons/page.tsx:36-41` 每行末尾换行）。**本次三个视口下这些空格恰好落在折行处，肉眼看不见** —— 属潜在缺陷，换字号或视口就会显形 | ⑥ 错位未对齐 | P2 | 中文多行串改单行，或用 `{' '}` 显式控制空格；JSX 里「换行 = 一个空格」这条规则对中文尤其伤 |
| V2-10 | `rules-WEB-DTO-001__desktop.png` | 中右，「数据来源」面板 | 路径在单词中间被硬断：`controller.json` 断成 `controller.jso` / `n`；`rules-REL-LOG-002__desktop.png` 同样把 `exception-logging.json` 断成 `excepti` / `on-logging.json`。根因是 `src/app/rules/[id]/page.tsx:348` 用了 `break-all` | ② 溢出截断 | P2 | 路径容器改 `overflow-wrap:anywhere`，或允许横向滚动 —— `break-all` 对英文路径等于「任意字符处断行」 |
| V2-11 | `rules-REL-LOG-002__desktop.png` | 中右，「检测能力」面板 | `AST 未定义` / `语义 未定义` / `人工 未定义` 三行提示字色**极暗**，在深色底上接近不可读；同一面板「规则元信息」的取值（`MUST` / `可靠性` / `v1` / `active` / `2026-09-11` / `server`）同样偏暗 | ③ 对比度不足 | P2 | 先用 V-3 的对比度断言（正文 ≥4.5:1）**量出实际值**再改，别凭感觉调；这三行是「为什么只有正则层」的关键解释，不该是最难读的一行 |
| V2-12 | `stack__desktop.png` | 下右，「可以跑起来」面板参数区 | 面板显示「应用副本数 **0 个**」，但同一面板的副本数滑块实测 `value="1" min="1"`。**0 不可能来自这个滑块** → 显示值与控件值不是同一个来源，读者分不清「0」与「没设」 | ⑤ 空态难看 | P2 | 未设置的参数显示「—」或占位提示；若 0 是「按当前架构算出的结果」，需在旁边标出它是推导值而不是输入值 |
| V2-13 | `stack__tablet.png` | 中左，「网关路由」卡 | 该卡内容只有放大一个「无」加一行小字，是四张层卡里**唯一没有组件信息**的空态，也没有「要不要加网关」的引导（相邻的「流量入口」卡有组件名 + PROVIDES 说明） | ⑤ 空态难看 | P2 | 空态补一个可选动作（如「需要统一鉴权 / 限流时加 SGG」）+ 一键添加 |
| V2-14 | `arch__tablet.png` | 下，画布左下角 | 一个**孤立的 `↑` 字形**浮在画布左下角，无容器、无标签、无相邻元素，看不出是「回到顶部」还是纯装饰（同图右下方另有一个向下的箭头是流程指示，有明确语义） | ⑦ 图形失效 | P2 | 给它容器 + `aria-label`，或直接删掉 |
| V2-15 | `arch__desktop.png` | 下，画布最底一行「服务边界：单人 + 小团队（≤10 人）· 不做 auto-fix / 绑某家 AI / 多租户 SaaS」 | 该行紧贴视口下沿；实测 `/arch/` 的 `scrollHeight` **986 > 视口 900** → 折叠线以下 86px，这一整行是画布里唯一被折掉的正文 | ② 溢出截断 | P2 | 画布高度改 `min-h-screen` 且允许页面滚到留白，或把这行移出固定高度的画布容器 |
| V2-16 | `blueprints-skeleton-config__desktop.png` | 下，分节标题行 | 页面的分节编号**从 ② 开始，全页找不到 ①**：「请求流过哪几层」无编号，紧接的下一节却写「② 什么时候不要用这套写法」。`blueprints-async-transaction__desktop.png` 同一处也一样。源码 `src/app/blueprints/[id]/BlueprintView.tsx:167` 的 `h2` 文本本身不含 ② → ② 是另一个元素渲染的，编号源与标题源不一致 | ⑥ 错位未对齐 | P2 | 把编号与标题统一到一个数据源；要么两节都给编号，要么都不给。**建议顺手确认 ① 是否本来该存在** |
| V2-17 | `cases__mobile.png` | 中，统计块 | 5 个统计项塞进 2 列网格 → 最后一行只剩「39 / 规则 · 条被引用规则」一项，**右侧留一个空单元格**（同页桌面视口是 5 列一排，没有这个问题） | ⑤ 空态难看 | P2 | 移动端改 1 列，或让最后一项 `col-span-2` |
| V2-18 | `F-22-injected-tilt__home__desktop.png` | 全域，主内容区 | **反向验证探针**（非真实缺陷）：注入 `main{transform:rotate(-1.2deg)}` 后主内容区整体逆时针倾斜 1.2°，标题 / 统计 / 卡片基线全部倾斜、与左侧栏不再平行，右侧内容被推出视口。几何同步变化：`shotsWithHorizontalOverflow` **15→45**、`stack__desktop.ovf` **0→85** | ⑥ 错位未对齐 | 探针 | 无需处置。用来证明这套走查抓得到；四段原文见 `visual/reverse-validation.md`，还原后复绿 |

**合计 18 条** · **P0 1 条、P1 5 条、P2 11 条、反向验证探针 1 条**。

## 附 · 非视觉类观察（**不计入 findings 表**，把图上看到的疑点拿去复核后确认的事实）

| # | 事实 | 核实方式 |
|---|---|---|
| A-1 | `/arch/`、`/archify/`、`/stack/` 三个页面**没有 `<h1>`**，其余页面各 1 个 | `grep -c "<h1" src/app/{arch,archify,stack}/page.tsx` 全为 0 |
| A-2 | `favicon` 缺失：`public/` 下只有 `arch/` 与 `icons/` 两个目录（且都是 `.png`），`src/app/layout.tsx` 的 `metadata` 无 `icons` 字段 → 浏览器回退请求 `/favicon.ico` 得 **404** | `ls public/` + `grep -n icons src/app/layout.tsx`；`manifest.json` 的 `knownBaseline.favicon-404` |
| A-3 | 首页「可自动检出 **35** 条」是**前端正则层**口径；后端实测可执行规则是 **42/69**（35 正则 + 7 AST，见第 2 棒 B-4）。两个数都对，但页面上没有一处说明口径差异 | 第 2 棒 `02-done.json`「给下一棒的话」 |
| A-4 | 侧栏「案例 / 代码行 **4 / 2214 行**」把两个不同量纲挤进一个 value，读不出「4 个案例」还是「4 什么」 | `src/components/Shell.tsx:136` |
| A-5 | 图标网格里**同一类目内也存在多种明度**（`actor` 类：74,85,104 / 60,74,92 / 90,100,114；`compute` 类：62,155,79 / 55,111,66 / 46,125,69）。三种明度没有任何可见规则 —— 若这是「重要性」编码，页面上没有图例 | DOM 计算色扫描（V2-08 的同一次探针） |

## 附 · 反向验证（**本计划唯一不能省的动作**）

四段原文（注入 / 变红 / 还原 / 复绿）逐字贴在 **`visual/reverse-validation.md`**。

- **注入 A**（V-2 指定）：`globals.css` 末尾追加 `main{transform:rotate(-1.2deg)}` → 几何变红（`shotsWithHorizontalOverflow` 15→45）+ 看图新增 V2-18 → Edit 精确删除（`grep INJECTED`=0、`git diff` 空）→ 复绿（EXIT=0、几何逐项复原）。
  ⚠️ **如实说明：这次注入没让 `shoot.mjs` 退出码变红**（仍 0），因为闸门判据不含横向溢出 —— 而真实的 V2-01 让移动端永远有溢出，任何「溢出即红」的闸门都得上允许清单，那是 V-3 `assert.mjs` 的职责，本棒不越界。
- **注入 B**（第二处）：改坏 `out/stack/index.html` 的 JS chunk 文件名 → **EXIT=1**，报错原文含 `webpack-a3c37fcbf859f6f9-broken.js`，且 404 **只归属 `stack__{desktop,tablet,mobile}`、另外 42 张干净** → `cp` 回备份 → 复绿。
  B 是**仓库那笔欠账的正面证据**：若监听器仍像 `.verify/check-case-library.mjs` 那样注册在 `goto` 之后，前两次 `goto` 的 404 会被漏掉。

## 附 · 复核用命令

```bash
export PATH="/usr/bin:/bin:/c/Windows/System32:/c/Windows:$PATH"
cd /d/mryang/workspace/2026/arsenal/arsenal-web
# 起站（必须 run_in_background，nohup & 会随上一条命令一起被杀）
"C:/Users/Administrator/.workbuddy/binaries/python/versions/3.13.12/python.exe" -m http.server 3021 --bind 127.0.0.1 --directory out
# 重跑矩阵（45 张 + manifest.json + report.md）
node visual/shoot.mjs
# 关键反例：单独量 390px 下的越界元凶
node -e "const m=JSON.parse(require('fs').readFileSync('visual/manifest.json','utf8'));const s=m.shots.find(x=>x.file==='home__mobile.png');console.log(s.metrics.horizontalOverflowPx, JSON.stringify(s.metrics.topOverflowOffenders[0]))"
```
