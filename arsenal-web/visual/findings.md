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
| V2-01 | `home__mobile.png` | 上，页头右侧导航条 | 移动端导航 10 项被压成**单字竖排**（每项实测宽 28px），末两项「校验台」「导出中心」**完全越出 390px 视口、看不见也点不到**。根因元素 `nav.flex.items-center.gap-1.md:hidden`：实测宽 316px、`right=443` → `documentElement.scrollWidth 443 vs clientWidth 390`，**15 个页面 × 移动视口全部 +53px**；全站移动端都有横向滚动条 | ② 溢出截断 | **P0** | 页头导航加 `flex-wrap` 或改横向滚动 / 抽屉；`nav` 补 `min-width:0`。改完跑 `node visual/shoot.mjs`，确认 15 张移动视口图的 `horizontalOverflowPx` 归零。**2026-09-23 已修复**：见文末「本轮修复台账」F-1 |
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
| V2-13 | `stack__tablet.png` | 中左，「网关路由」卡 | 该卡内容只有放大一个「无」加一行小字，是四张层卡里**唯一没有组件信息**的空态，也没有「要不要加网关」的引导（相邻的「流量入口」卡有组件名 + PROVIDES 说明） | ⑤ 空态难看 | P2 | 空态补一个可选动作（如「需要统一鉴权 / 限流时加 SGG」）+ 一键添加。**2026-09-24 已修复**：见文末「终检补录」G-1 |
| V2-14 | `arch__tablet.png` | 下，画布左下角 | 一个**孤立的 `↑` 字形**浮在画布左下角，无容器、无标签、无相邻元素，看不出是「回到顶部」还是纯装饰（同图右下方另有一个向下的箭头是流程指示，有明确语义） | ⑦ 图形失效 | P2 | 给它容器 + `aria-label`，或直接删掉 |
| V2-15 | `arch__desktop.png` | 下，画布最底一行「服务边界：单人 + 小团队（≤10 人）· 不做 auto-fix / 绑某家 AI / 多租户 SaaS」 | 该行紧贴视口下沿；实测 `/arch/` 的 `scrollHeight` **986 > 视口 900** → 折叠线以下 86px，这一整行是画布里唯一被折掉的正文 | ② 溢出截断 | P2 | 画布高度改 `min-h-screen` 且允许页面滚到留白，或把这行移出固定高度的画布容器 |
| V2-16 | `blueprints-skeleton-config__desktop.png` | 下，分节标题行 | 页面的分节编号**从 ② 开始，全页找不到 ①**：「请求流过哪几层」无编号，紧接的下一节却写「② 什么时候不要用这套写法」。（次要佐证图 `blueprints-async-transaction__desktop` 随 2026-09-29 矩阵换样下线；该缺陷出自共享组件，全部蓝图页同源。）源码 `src/app/blueprints/[id]/BlueprintView.tsx:167` 的 `h2` 文本本身不含 ② → ② 是另一个元素渲染的，编号源与标题源不一致 | ⑥ 错位未对齐 | P2 | 把编号与标题统一到一个数据源；要么两节都给编号，要么都不给。**建议顺手确认 ① 是否本来该存在** |
| V2-17 | `cases__mobile.png` | 中，统计块 | 5 个统计项塞进 2 列网格 → 最后一行只剩「39 / 规则 · 条被引用规则」一项，**右侧留一个空单元格**（同页桌面视口是 5 列一排，没有这个问题） | ⑤ 空态难看 | P2 | 移动端改 1 列，或让最后一项 `col-span-2` |
| V2-18 | `F-22-injected-tilt__home__desktop.png` | 全域，主内容区 | **反向验证探针**（非真实缺陷）：注入 `main{transform:rotate(-1.2deg)}` 后主内容区整体逆时针倾斜 1.2°，标题 / 统计 / 卡片基线全部倾斜、与左侧栏不再平行，右侧内容被推出视口。几何同步变化：`shotsWithHorizontalOverflow` **15→45**、`stack__desktop.ovf` **0→85** | ⑥ 错位未对齐 | 探针 | 无需处置。用来证明这套走查抓得到；四段原文见 `visual/reverse-validation.md`，还原后复绿 |

| V3-01 | 全站 45 张（`assert.mjs` A5 断言，非看图发现） | 全域，正文与说明文字 | **正文对比度不达 WCAG AA（4.5:1）**：最淡一档字色 `fgFaint = #5E6E67` 在 `surface #131917` 上 **3.31:1**、在 `surfaceHi #1A2220` 上 **3.02:1**；代码块注释色 `#5A6A63` 在代码底上 **3.28:1**。A5 首次实跑：**判定 21 张 / 失败 21 张**（另 24 张因背景是渐变或半透明而「不猜」，如实跳过） | ③ 对比度不足 | **P1** | **2026-09-23 已修复**，见文末台账 F-3 |
| V3-02 | 全站 45 张（`assert.mjs` A6 断言，非看图发现） | 全域，页面标题 | **9 张页面（3 个路由 × 3 视口）的 `<h1>` 数量为 0**：`/arch/`、`/archify/`、`/stack/` 三个页面把视觉上的页标题写成了 `<h2>`，另外 36 张各 1 个。这与此前 A-1 的 grep 观察一致，但 A-1 只查了「有没有 `<h1>`」，没量化到「矩阵里 9 张为 0」。对读屏用户等于**整页没有一级标题** | ⑥ 错位未对齐 | **P1** | **2026-09-23 已修复**，见文末台账 F-4 |

**合计 20 条** · **P0 1 条、P1 7 条、P2 11 条、反向验证探针 1 条**（其中 V3-01 / V3-02 由 `assert.mjs` 断言发现，
不是看图判读发现 —— 判据分工见 `assert.mjs` 文件头：**断言管几何与数值，看图管语义**）。

## 附 · 非视觉类观察（**不计入 findings 表**，把图上看到的疑点拿去复核后确认的事实）

| # | 事实 | 核实方式 |
|---|---|---|
| A-1 | `/arch/`、`/archify/`、`/stack/` 三个页面**没有 `<h1>`**，其余页面各 1 个 | `grep -c "<h1" src/app/{arch,archify,stack}/page.tsx` 全为 0 |
| A-2 | `favicon` 缺失：`public/` 下只有 `arch/` 与 `icons/` 两个目录（且都是 `.png`），`src/app/layout.tsx` 的 `metadata` 无 `icons` 字段 → 浏览器回退请求 `/favicon.ico` 得 **404** | `ls public/` + `grep -n icons src/app/layout.tsx`；`manifest.json` 的 `knownBaseline.favicon-404` |
| A-3 | 首页「可自动检出 **35** 条」是**前端正则层**口径；后端实测可执行规则是 **42/69**（35 正则 + 7 AST，见第 2 棒 B-4）。两个数都对，但页面上没有一处说明口径差异 | 第 2 棒 `02-done.json`「给下一棒的话」 |
| A-4 | 侧栏「案例 / 代码行 **4 / 2214 行**」把两个不同量纲挤进一个 value，读不出「4 个案例」还是「4 什么」 | `src/components/Shell.tsx:136` |
| A-5 | 图标网格里**同一类目内也存在多种明度**（`actor` 类：74,85,104 / 60,74,92 / 90,100,114；`compute` 类：62,155,79 / 55,111,66 / 46,125,69）。三种明度没有任何可见规则 —— 若这是「重要性」编码，页面上没有图例 | DOM 计算色扫描（V2-08 的同一次探针） |
| A-6 | **`npm run verify` 的退出码会被沙箱删除守卫污染**：`前后端一致性` 层在 `.verify/parity-check.ts:118` 用 `fs.rmSync(arsenal-server/target/parity-be, {recursive:true})` 清探针产物（实测该目录 2598 个文件），被 `NODE_OPTIONS` 注入的 guard 以 `SAFE_DELETE_BULK_CONFIRM_REQUIRED {count:2598, threshold:50, scope:"turn"}` 抛异常打断 → 该层进程 **退出码 1**，而它已经/残留的 `layer-parity.json` 仍写 `exitCode 2 / fail 0` ⇒ runner 报「层自报退出码 2 / 进程实际 1 —— 记账不可信」，整链 `verify` 从 **2 变 1**。**内容零变化**（都是 628 实测 / 34 跳过 / 0 失败）。**不是本棒引入**：本棒两笔提交只碰 `arsenal-web/visual/**` + `arsenal-web/.gitignore`，`parity-check.ts` 最后一次改动是 `333edd8`（前几棒）。 | 同一条命令跑两次：`npm run verify` → 退出码 1 + 上述「记账不可信」；`CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run verify` → 退出码 **2**，parity 层耗时 1.2s→11.8s（真跑起来做完了探针） |

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

## 附 · 收尾实测撞到的一件事（A-6 的完整原文，给下一棒省 20 分钟）

**症状**（本棒收尾第一次跑全量 `npm run verify`）：

```
前后端一致性      9       3       0       1       1.3s      12
verify: 628 项实测 / 34 项跳过 / 0 项失败  → 退出码 1（有失败）
问题清单
  [失败] 前后端一致性：层自报退出码 2 / 进程实际 1 —— 记账不可信
  [失败] 前后端一致性：有失败项（退出码 1）
```

**为什么会被吓到**：第 2 棒交棒时记的基线是「631 实测 / 31 跳过 / 0 失败 → 退出码 2」，
本次（因后端已停，parity 少 3 项、archify 多出整层 31 项）应为「628 / 34 / 0 → 退出码 2」。
**退出码从 2 变 1 看起来就是回归**，但逐项数字一个没变。

**根因**（`npm run verify` 全量日志里 parity 段落的原始堆栈）：

```
【2】后端探针
D:\mryang\WorkBuddy\...\cli\vendor\shim\node-safe-delete-shim.cjs:220
            throw new Error(detail);
Error: [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED] {"count":2598,"threshold":50,"scope":"turn",
      "targets":["D:\\mryang\\workspace\\2026\\arsenal\\arsenal-server\\target\\parity-be"],"targetCount":1}
    at ... wrappedRmSync [as rmSync] (...shim.cjs:759:15)
    at fs (...arsenal-web\.verify\parity-check.ts:118:4)
```

i.e. 全量 verify 一次工具调用里，前六层累计删除量先耗掉了 guard 的 per-turn 额度，
轮到 parity 层清 `target/parity-be`（2598 个文件）时直接爆表 → **层进程被杀死**（退出码 1），
而 `.verify/tmp/layer-parity.json` 里留下的还是上一次 `exitCode 2 / fail 0` ⇒ runner 判「记账不可信」。

**隔离证据**（唯一变量 = 给子进程关掉守卫）：

```bash
export PATH="/usr/bin:/bin:/c/Windows/System32:/c/Windows:$PATH"
cd /d/mryang/workspace/2026/arsenal/arsenal-web
npm run verify                            # → 退出码 1，parity 1.2s（没跑完就死）
CODEBUDDY_SAFE_DELETE_ENABLED=0 npm run verify   # → 退出码 2，parity 11.8s（真跑完），628/34/0
```

**结论 / 给下一棒的三句话**：

1. 看到 `verify` 退出码 1 且问题清单里只有「记账不可信」这四个字 → **先看 `628 实测 / 34 跳过 / 0 失败` 那行**，
   数字没变就不是回归，是本机沙箱守卫；用 `CODEBUDDY_SAFE_DELETE_ENABLED=0` 复跑拿真退出码。
2. 这是**仓库的潜在缺陷**（不自报、能伪绿也能伪红）：层把 `layer-*.json` 写在删除动作之后/之前不一致，
   加上 runner 的 `cleanOldStatus()` 删不掉旧文件时只吞异常 → 旧状态会被当成本轮状态读。
   建议（未做）`parity-check.ts` 把 `fs.rmSync` 换成「先 rename 成 `.trash-<ts>`，由 shell/python 清理」，
   或在层里 `try/catch` 后如实写 `fail` 而不是让进程崩。
3. 本棒**没有**去修它：文件所有权只给了 `arsenal-web/visual/**`，`.verify/**` 明令不许碰。

---

## 本轮修复台账（2026-09-23 · V-3 挂链那一棒）

V-3（`visual/assert.mjs` + 挂进 `npm run verify`）落地时顺手清掉了下面这些。
每一行都带**实测的前后数字** —— 「看着好了」不算修好。

| # | 对应 finding | 改了什么 | 实测（前 → 后） |
|---|---|---|---|
| **F-1** | **V2-01**（P0）+ **V2-02**（同根因） | ① `src/components/Shell.tsx`：移动导航 `nav` 加 `flex-wrap` + `min-w-0`，页头那层加 `flex-wrap gap-y-2`；② `src/app/rules/RulesBrowser.tsx`：卡片网格**显式**写 `grid-cols-1`（只写 `lg:grid-cols-2` 时移动端走**隐式列** `auto`，列宽被卡片 `min-content` 撑到 399px）；③ `src/app/rules/[id]/page.tsx`：`constraint` 行加 `flex-wrap` | **A1 无横向溢出：通过 30 / 失败 15（+53px）→ 通过 41 / 失败 4（+29px→+3px）→ 通过 45 / 失败 0**。V2-02 那几处输入框被切、第 3 张形态卡被推出视口，随同根因一并消除（全站 45 张已无任何横向溢出） |
| **F-2** | V2-11（P2，「先量出实际值再改」） | 先量后改：`tailwind.config.ts` 的 `fgFaint` `#5E6E67` → `#80918A`；`src/lib/highlight.ts` 的代码注释色 `#5A6A63` → `#80918A`。**没有凭感觉调** —— 候选值先用脚本算三档背景上的比值再定 | 实际比值：`surface` **3.31 → 5.37**、`surfaceHi` **3.02 → 4.90**、代码块底 **3.28 → 5.65**（三档全部过 AA 4.5:1，仍比 `fgMuted` 的 6.15:1 淡一档）。**A5 正文对比度：通过 21 / 失败 21 → 通过 45 / 失败 0** |
| **F-3** | **V3-01**（本轮新发现，P1） | 同 F-2（`fgFaint` 与注释色就是全站对比度不足的两个源头） | 见 F-2 的比值行；A5 从「一半页面不达标」到 45/45 全过 |
| **F-4** | **V3-02**（本轮新发现，P1）+ A-1 | `src/app/archify/ArchifyLab.tsx` 与 `src/app/arch/ArchGallery.tsx` 的页头标题 `<h2>` → `<h1>`；`src/app/stack/StackComposer.tsx` 补 `<h1 className="sr-only">架构装配台</h1>`（画布式界面，**视觉零变化**，只为读屏与断言） | **A6 `<h1>` 唯一：通过 36 / 失败 9 → 通过 45 / 失败 0** |
| **F-5** | （断言自身的缺陷，不是页面缺陷） | `visual/assert.mjs` 的 A4 判据由 `position: fixed` 扩到 `fixed \|\| sticky` —— 本站页头与侧栏都是 `md:sticky`，只判 `fixed` 时这条断言**一张都判不了** | 45 张全 `未适用` → **通过 30 / 未适用 15**（移动端确实没有 sticky 元素，如实计未适用而不是算通过） |
| **F-6** | V-3 挂链（plans-4/-5 的欠账） | 新增 `.verify/visual-check.ts`（12 项）+ 四处登记：`package.json` 的 `verify:visual`、`scripts/verify-all.mjs` 的 `LAYERS`、`.verify/lib/report.ts` 的 `LAYER_NAMES`、`.verify/meta-check.ts` 的 `CHAIN_ORDER`；档案 `verifyChain` 与 README 的总数句 + 分项表同步 | **verify 总数 662 → 674（九层）**；视觉层单跑 `实测 12 项 / 跳过 0 项 / 失败 0 项`，退出码 0 |

### 反向验证：七项断言逐条真红（原文见 `visual/reverse-validation.md`）

按仓库判据「**一条从没红过的断言和摆设没有区别**」，A1–A7 逐条注入坏样式跑真红：

| 注入 | 结果 |
|---|---|
| `body::after{width:3000px}` | A1 **红 45/45**（`scrollWidth 3000 - clientWidth 1440/1024/390 = 1560/1976/2610px`），A2 保持绿 |
| `main{overflow-x:hidden}` + `main > *:first-child{width:3000px}` | A2 **红 45/45**，A1 保持绿 —— 两条断言**互不顶罪**（双向隔离） |
| 六项合并注入 | A2/A3/A4/A5/A6/A7 **全红且各带实际值**（如 A5 `1.29:1 < 4.5:1`、A7 `1351px 空白 > 上限 360px`） |

新加的四处守门也逐条验红（R1–R5）：页面坏了 → 本层红（退出码 1，明细带 45 张的实际溢出量）；
档案声明值改坏 → **层内自判负 + 元核对双红**；README 总数句改坏 → 元核对红（`README 673 / 档案 674`）；
把视觉层从 `CHAIN_ORDER` 摘掉 → 元核对点名「新加了一层却没登记」；`out/` 移走 → **整层跳过（退出码 2、
`countSource: declared`、pass 必须为 0）**。R5 还抓出并修掉了本层自己的一个记账 bug
（前置 `check` 放在守卫之前 → 跳过那轮打出「实测 1 项 / 跳过 12 项」= 13 ≠ 声明 12）。

**本台账没碰的**：V2-03（archify 硬编码 3011）、V2-04（PREVIEW 面板输出原始 Markdown）、
V2-05（89/81 矛盾）、V2-06（两张能力卡正文重复）、V2-07…V2-17 —— 除 V2-01/V2-02 外的 P1/P2 仍然开着。

---

## 终检补录（2026-09-24 · 夜跑终检棒）

| # | 对应 finding | 证据（终检棒独立复跑，不引用第 2 棒自述） | 结论 |
|---|---|---|---|
| **G-1** | **V2-13**（P2，「网关路由」卡空态无引导） | ① 源码：`SlotBlock.tsx:228-238` 空态块由 `hint` 驱动，两行 = `装 「{hint.name}」` + `line-clamp-2 {hint.use}`；② 构建产物：`out/stack/index.html` 里 `装 ` 出现 **6 次**（正好是 6 个 `none` 档槽位），网关卡的第二行是事实源里的真实说明「Gateway 用 Java 写路由与过滤器，和 Spring 生态无缝集成，适合做鉴权、限流…」；③ 断言：【17】`S1-7` 三条守着「两行 + line-clamp-2」「none 档也算未使用」「文案来自事实源」 | **关闭** —— 网关卡不再是「放大一个『无』」 |

> 关闭口径说明：V2-13 原描述是「唯一没有组件信息的空态 + 没有要不要加网关的引导」。
> 现在空态给出「装谁」与「装了有什么用」，且点了就能装 —— 该条成立的部分已被覆盖。
> 注意它**不是**「一键添加」按钮（那是 S2-2 一键补齐的活），所以 L2 只关了「无引导」这一半。


## 09-24 白天会话补录（S1-6 收尾 + S2-8 / S2-3）

| # | 对应 finding | 证据 | 结论 |
|---|---|---|---|
| **H-1** | **V2-12**（P2，副本数显示 0 与滑块 value=1 不一致） | ① 根因坐实：`topology.ts` PARAM_SPECS 的 `app.replicas` fallback=0 是「未设」哨兵，滑杆把哨兵 0 当输入值显示，而容量数字走 `effectiveAppReplicas()`（下限 1），两处不同源；② 修复：新增 `paramIsSet()`，`Capacity` 增加 `replicasSource: 'override' \| 'topology'`；滑杆未设时数值显示 `—`、滑块位置落在形态推导值上，页头与容量摘要都标注来源（「按形态推导」/「滑杆的手动设定」）；③ 断言：【18】新增 V2-12 一条（paramIsSet + replicasSource + DeliveryDeck 两处消费） | **关闭**（未跑验证，等用户实测确认） |
| **H-2** | **V2-06**（P1→复核，「鉴权」卡与「幂等」卡文案相同） | 复核：09-22 走查所指的「应用能力 4/4」面板在 S1 系列重写后的代码里**已找不到对应物**——全仓无「幂等」能力卡渲染点，architecture.json / stack.json 里也无「幂等」条目（唯一一处是调度 policy 的 fix 文案）。当时的重复文案源（policy 卡错挂）在现版结构中不存在 | **转待复核**——不盲改数据硬凑；下轮视觉走查若复现再立 finding |
| **H-3** | **V2-02 残留**（装配台 9px 连排，S1-6 余下部分） | S1-6 计划只列了 SlotBlock/Inspector/DeliveryDeck；本棒把活跃组件全清了：Inspector 5 处、DeliveryDeck 4 处、StackComposer 3 处、GapCard 2 处、TopologyPicker 2 处 → 全部收进 meta 档（10px/15px）。断言：【18】新增「六个活跃组件无 9px」 | **关闭**（孤儿文件 ProjectTree.tsx 仍有 9px，但无任何引用，不渲染） |
