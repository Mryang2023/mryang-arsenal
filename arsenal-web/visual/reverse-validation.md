# V-2 反向验证 · 四段原文

> **本计划唯一不能砍的动作**（plan-5 §一 V-2「反向验证」/ §四 纪律 4）。
> 目的：证明「这套走查不是走过场」—— 往页面里注入一处明显坏样式，走查**抓得到**；还原后**复得了绿**。
> 两处注入都不是编的：下面每一段都是从终端里原样贴出来的。
> 时间：2026-09-23 01:3x–01:5x（夜跑第 3 棒）。

---

## 注入 A · 坏样式 → 变红 → 还原 → 复绿（V-2 指定的那一条）

### 第 1 段 · 注入

往 `arsenal-web/src/app/globals.css` **末尾追加**（只追加，不改既有规则）：

```bash
cat >> src/app/globals.css <<'EOF'

/* ===== INJECTED-REVERSE-TEST: V-2 反向验证，验完必须原样删掉这一段（夜跑棒3） ===== */
main {
  transform: rotate(-1.2deg);
}
EOF
```

```
--- 追加后末尾 8 行 ---
    opacity: 1;
  }
}

/* ===== INJECTED-REVERSE-TEST: V-2 反向验证，验完必须原样删掉这一段（夜跑棒3） ===== */
main {
  transform: rotate(-1.2deg);
}
```

> 为什么选 `main`：`src/components/Shell.tsx:150` 的主容器就是 `<main className="min-w-0 flex-1 border-line md:border-l">`，
> 转它等于让**主内容区与左侧栏脱开**，这是最容易用眼睛看出、也最容易在几何指标上留痕的一类错位。

### 第 2 段 · 变红

重建（`mv .next` + `node scripts/next-run.mjs build`）后重跑 `node visual/shoot.mjs`。
**几何指标的红**（原样贴）：

```
✓ home__desktop.png                         343.1 KB  ovf=45  evt=0/1/0/0
✓ home__tablet.png                          256.8 KB  ovf=50  evt=0/0/0/0
✓ home__mobile.png                          118.8 KB  ovf=88  evt=0/0/0/0
✓ arch__desktop.png                         237.6 KB  ovf=10  evt=0/0/0/0
✓ stack__desktop.png                        261.8 KB  ovf=85  evt=0/0/0/0
✓ rules__mobile.png                          57.0 KB  ovf=182 evt=0/0/0/0
（其余 39 张同样 ovf > 0，全量见当次的 visual/manifest.json）
```

与注入前的对照（同一脚本、同一台机器）：

| 指标 | 注入前 | 注入后 |
|---|---|---|
| `totals.shotsWithHorizontalOverflow` | **15**（只有移动视口） | **45**（全部） |
| `stack__desktop.png` `horizontalOverflowPx` | **0** | **85** |
| 每张图字节数（桌面） | 141–207 KB | 182–381 KB（内容被撑宽） |

注入态 `/stack/` 桌面视口的越界元凶（`metrics.topOverflowOffenders`，节选）：

```
pre.mono.overflow-x-auto   right=1462  w=1194  ovfR=22  pos=static
span.text-fgFaint          right=1464  w=1112  ovfR=24  pos=static
div.overflow-hidden.rounded-md right=1463 w=1197 ovfR=23 pos=static
```

**「看」这一层的红**（这才是 V-2 的主证据）：把注入态的 `home__desktop.png` / `stack__desktop.png`
复制到 `visual/evidence/F-22-injected-tilt__*.png` 并逐张判读 —— 主内容区整体**逆时针倾斜 1.2°**，
标题、统计行、卡片的基线全部歪掉，与左侧栏不再平行；右侧内容（如首页「给 AI 用」卡、
装配台「交付预览」面板）被推出视口右边缘。据此在 `findings.md` **新增一条**：

> | F-22 | `F-22-injected-tilt__home__desktop.png` | 全域，主内容区 | 注入 `main{transform:rotate(-1.2deg)}` 后主内容区整体逆时针倾斜 1.2°，标题/统计/卡片基线全部倾斜、与左侧栏不再平行；右侧内容被推出视口。几何同步变化：`shotsWithHorizontalOverflow` 15→45，桌面 `ovf` 由 0 变 9–85px | ⑥ 错位未对齐 | 注入用（非真实缺陷） | 无需处置 —— 反向验证探针；还原后复绿 |

⚠️ **如实说明一处不足**：这次注入**没有让 `shoot.mjs` 的退出码变红**（仍为 0）。
原因：本棒的闸门判据只含「截图数 / 最小字节 / 未申报的运行时报错 / URL 发现数」，
**不含横向溢出**（一旦把溢出纳入闸门，真实的 F-01 会让它永远红，所以判定「溢出多少算坏」必须带允许清单，
那是 V-3 `assert.mjs` 的职责，本棒不越界）。因此这次的「红」由两处可核对的东西承担：
① `manifest.json` 里 `shotsWithHorizontalOverflow` 15→45 这个**客观数值变化**；
② 人眼在图上的判读（新增 F-22）。
**不把「退出码没红」说成「红了」。**

### 第 3 段 · 还原

用 Edit 精确删除追加的那 5 行（**不用 `cp` 还原** —— 上一晚踩过「`cp` 把已注入的文件当备份」的坑）：

```
=== 1) 确认注入已清除（grep 应 0 处）+ globals.css 恢复 170 行 ===
0
170
=== 2) git diff 必须为空（证明是精确还原，不是残留）===
（无输出 —— 空）
```

`grep -rn "INJECTED" src/ | wc -l` → **0**；`wc -l < src/app/globals.css` → **170**（与注入前一致）；
`git diff --stat src/app/globals.css` → **空**。

### 第 4 段 · 复绿

重建后重跑：

```
截图 45/45 · URL 15/15 · 最小 41.5 KB (archify__mobile.png) · 模式 viewport
原始：pageerror 0 · console.error 4 · requestfailed 3 · http>=400 0
分层：已申报基线 7 条 · 意外 0 条
✅ 全绿 · 累计 5.17 MB · manifest.json / report.md 已落盘
EXIT=0
```

几何指标逐项复原：

```
复绿后几何指标：
totals = {"pageErrors":0,"consoleErrors":4,"requestFailures":3,"httpErrors":0,"failedImages":0,
          "shotsFailed":0,"shotsWithHorizontalOverflow":15,"pagesScrollingBelowFold":43}
stack__desktop ovf = 0     （注入态 85）
home__mobile   ovf = 53    （不变 —— 这是真实的 P0，见 findings.md F-01）
```

---

## 注入 B · 改坏一个产物里的资源文件名（prompt 第 4 步要求的第二处）

> prompt 的原例是「把 `out/stack/index.html` 里某张图标文件名改坏一个字符」。
> **实测该页 `imgs=0`、html 里没有任何 `icons/**.svg` 引用**（`grep -o` 输出为空），
> 所以改用同一意图、强度更高的目标：**改坏一个 JS chunk 的文件名**。
> 强在哪：它同时考验「监听器有没有在 `goto` 之前注册」和「错误有没有按 URL 分别归属」——
> 正是仓库那笔欠账（`.verify/check-case-library.mjs` 把 `page.on` 注册在前三次 `goto` 之后）。

### 注入

```
注入：_next/static/chunks/webpack-a3c37fcbf859f6f9.js  ->  _next/static/chunks/webpack-a3c37fcbf859f6f9-broken.js
（只改了 out/stack/index.html 一个文件，原始件已备份到 .workbuddy/_v3/stack-index.html.bak）
```

### 变红

`node visual/shoot.mjs` → **EXIT=1**，原文：

```
requestfailed 原文：
  GET http://127.0.0.1:3021/_next/static/chunks/webpack-a3c37fcbf859f6f9-broken.js  ->  net::ERR_ABORTED
  GET http://127.0.0.1:3021/_next/static/chunks/webpack-a3c37fcbf859f6f9-broken.js  ->  net::ERR_ABORTED
  GET http://127.0.0.1:3021/_next/static/chunks/webpack-a3c37fcbf859f6f9-broken.js  ->  net::ERR_ABORTED

HTTP >=400 原文：
  404 http://127.0.0.1:3021/_next/static/chunks/webpack-a3c37fcbf859f6f9-broken.js
  404 http://127.0.0.1:3021/_next/static/chunks/webpack-a3c37fcbf859f6f9-broken.js
  404 http://127.0.0.1:3021/_next/static/chunks/webpack-a3c37fcbf859f6f9-broken.js
```

**报错里带的就是那个被改坏的文件名**（prompt 的要求）。

### 归属核对（这一条是欠账的正面证据）

```
stack__desktop.png http: ["404 .../webpack-a3c37fcbf859f6f9-broken.js"] reqfail: 1
stack__tablet.png  http: ["404 .../webpack-a3c37fcbf859f6f9-broken.js"] reqfail: 1
stack__mobile.png  http: ["404 .../webpack-a3c37fcbf859f6f9-broken.js"] reqfail: 1
archify__desktop.png reqfail: 1     ← 只有它自己的 localhost:3011，与本次注入无关
archify__tablet.png  reqfail: 1
archify__mobile.png  reqfail: 1
其他 39 张：httpErrors 0、requestFailures 0
```

**错误精确落在被改坏的 `/stack/` 三个视口上，另外 42 张干净。**
若监听器仍像旧写法那样注册在 `goto` 之后，前两次 `goto` 的 404 会被漏掉 —— 现在三次全抓到 ⇒ 欠账已修。

### 还原 · 复绿

```
=== 还原核对（应 0 处 -broken.js）===
0 处 ✓
EXIT=0
✅ 全绿 · 累计 5.17 MB · manifest.json / report.md 已落盘
复绿几何： {"pageErrors":0,"consoleErrors":4,"requestFailures":3,"httpErrors":0,"failedImages":0,
           "shotsFailed":0,"shotsWithHorizontalOverflow":15,"pagesScrollingBelowFold":43}
stack__desktop httpErrors = 0
```

---

## 四段对照总表

| 注入 | 注入物 | 变红的证据 | 还原方式 | 复绿证据 |
|---|---|---|---|---|
| A（V-2 指定） | `globals.css` 末尾追加 `main{transform:rotate(-1.2deg)}` | ① `shotsWithHorizontalOverflow` 15→45；`stack__desktop.ovf` 0→85；② 看图新增 findings **F-22**（⑥ 错位未对齐）。**退出码仍 0，如实说明** | Edit 精确删 5 行；`grep INJECTED`=0、`wc -l`=170、`git diff` 空 | EXIT=0；`shotsWithHorizontalOverflow` 回到 15；`stack__desktop.ovf` 回 0 |
| B（第二处） | 改坏 `out/stack/index.html` 的 JS chunk 名 | **EXIT=1**，报错原文含 `webpack-a3c37fcbf859f6f9-broken.js`；404 只归属 `stack__{desktop,tablet,mobile}` | `cp` 回备份（备份件未被污染） | EXIT=0；`-broken.js` 0 处；`stack__desktop.httpErrors`=0 |

---
---

# V-3 反向验证 · A1–A7 七项断言逐条变红（2026-09-23 01:5x）

> 上面那一节证明的是**截图台**抓得住坏页面（几何指标 + 看图）。
> 这一节证明的是 **`assert.mjs` 的七项断言每一条都真的会红** ——
> 依据本仓库自己的判据：**一条从没红过的断言和摆设没有区别**。
> 下面每个数字都是从终端里原样贴出来的，没有一个是我照着预期写的。

## 方法：注入到 `out/`，不是注入到 `src/`

```bash
python .workbuddy/_p01/redprobe.py all     # 驱动器（一次性调试产物，交付时已删）
```

每个用例：**备份 `out/index.html` + `out/_next/static/css/*.css` → 注入 → 起真站点跑
`node visual/assert.mjs`（全量 45 张）→ 记原始输出 → 还原 → 校验 md5 逐字节复原**。

注入点选 `out/` 而不是 `src/`，有三条理由：

1. 断言测的是 **DOM**，改构建产物与改页面等价；
2. 不必为每次注入跑一遍 `next build`（7 个用例省下 ~7 分钟）；
3. **最重要**：注入点不在源码里，就不存在「忘了还原、把探针提交进仓库」这个事故面 ——
   本仓库已经在这种事上踩过（往 `globals.css` 追加却漏删）。驱动器每次跑完都打印
   `还原 HTML=✓ CSS=✓`，并且是真的比 md5，不是看着像还原了。

每个用例跑之前先探一次 3021 端口：**已有站点在跑就直接拒跑**（`assert.mjs` 会复用那个站点，
测出来的就不是我们注入的 `out/` —— 那会得到一次「看着像反证」的假证据）。

## 四个用例与结果

| # | 注入 | 预期 | 实测结果 | 退出码 |
|---|---|---|---|---|
| ① | `main { width: 3000px !important }`（**plan-5 §V-3 指定的那一条**） | A1 红 | **A1 15 张红**（只有 mobile 档）／A2 连带 15 张 | **1** |
| ② | `main { flex-basis: 3000px !important }` | A1 红 | **全绿** —— 见下面「一条被推翻的直觉」 | 0 |
| ③ | `body::after { width: 3000px }` | A1 红 45/45 | **A1 45/45 红**，A2 保持绿 | **1** |
| ④ | 六项合并注入（A2 隔离 + 图片 404 + sticky 重叠 + 低对比度 + 重复 h1 + 底部假高度） | A2–A7 全红、A1 保持绿 | **A2/A3/A4/A5/A6/A7 全红，A1 全绿** | **1** |

### 用例 ① · plan-5 指定的注入（原文）

```
✗ A1 无横向溢出                 通过  30 / 失败  15 / 未适用   0 / 无从判定   0
✗ A2 main 一级子元素不越界         通过  30 / 失败  15 / 未适用   0 / 无从判定   0
visual: 45 张 / 7 项断言 / 30 失败
```

失败明细（原样贴，**实际宽度就在第一行**）：

```
    A1 无横向溢出：15 张
      home__mobile.png —— scrollWidth 3000 - clientWidth 390 = 2610px
          · main.min-w-0.flex-1「◈personal code arsenal」 0..3000（宽 3000，越界 2610px，static，depth 3）
          · div.px-5.py-6「◈personal code arsenal」 0..3000（宽 3000，越界 2610px，static，depth 4）
          · footer.border-t.border-line「数据源 arsenal-rules/**/*」 0..3000（宽 3000，越界 2610px，static，depth 4）
          · div.animate-fade-up.space-y-9「◈personal code arsenal」 20..2980（宽 2960，越界 2590px，static，depth 5）
          · （线索·被 section.grid-bg.relative/hidden 裁剪）div.pointer-events-none.absolute right=2979 越界 2589px
```

plan-5 §V-3 的要求满足：**红，且打印了实际宽度 2610px**（不是「失败了」四个字）。

### 用例 ② · 一条被推翻的直觉（如实记下来）

我原以为 `main { width: 3000px }` 在桌面档也会红，于是补了一例 `flex-basis: 3000px`。
两例都只在 **mobile 档**红。原因不是断言不灵，是 CSS 的算法：

- 桌面/平板档外层是 `md:flex-row`，`main` 带 `flex-1`（= `flex: 1 1 0%`）与 `min-w-0`。
  **flex-basis 不是 `auto` 时，主轴上的 `width` 被忽略**；而且 `flex-shrink: 1` +
  容器 `max-w-[1500px]` 会在负剩余空间里把它**压回容器宽度** —— 连 `flex-basis: 3000px` 也压得住。
- 移动档外层是 `flex-col`，`width` 落在**交叉轴**上，不参与收缩 → 3000px 原样生效。

所以这一条的真结论是：**A1 是按档位分别测量的**，「只有一档红」也是真红
（那 15 张确实是 `scrollWidth 3000 - clientWidth 390 = 2610px`）。
用例 ③ 绕开 flex（`body::after` 是普通块级）补上了「全档都红」：

```
✗ A1 无横向溢出                 通过   0 / 失败  45 / 未适用   0 / 无从判定   0
visual: 45 张 / 7 项断言 / 45 失败
    A1 无横向溢出：45 张
      home__desktop.png —— scrollWidth 3000 - clientWidth 1440 = 1560px
          · 没有未被裁剪的越界元素 —— 溢出可能来自根元素自身或滚动条宽度
      home__tablet.png —— scrollWidth 3000 - clientWidth 1024 = 1976px
      home__mobile.png —— scrollWidth 3000 - clientWidth 390 = 2610px
```

> 顺带验到一条**元凶定位的边界**：这一例里 A1 打印的是
> 「没有未被裁剪的越界元素 —— 溢出可能来自根元素自身或滚动条宽度」。
> 这是诚实话：撑开文档的是伪元素，`document.querySelectorAll('*')` 本来就看不见它。
> 断言宁可承认「定位不到」，也不编一个元素出来顶罪。

### 用例 ④ · A2–A7 六项同时红（原文，各项都带实际值）

```
✓ A1 无横向溢出                 通过  45 / 失败   0 / 未适用   0 / 无从判定   0
✗ A2 main 一级子元素不越界         通过   0 / 失败  45 / 未适用   0 / 无从判定   0
✗ A3 图片全部加载成功              通过  42 / 失败   3 / 未适用   0 / 无从判定   0
✗ A4 固定/粘性元素互不遮挡           通过   0 / 失败  45 / 未适用   0 / 无从判定   0
✗ A5 正文对比度达标               通过   3 / 失败  42 / 未适用   0 / 无从判定   0
✗ A6 <h1> 唯一               通过  42 / 失败   3 / 未适用   0 / 无从判定   0
✗ A7 页面底部无假高度              通过   0 / 失败  45 / 未适用   0 / 无从判定   0
visual: 45 张 / 7 项断言 / 183 失败
```

失败明细（节选，六项各自的**实际值**都在）：

```
    A2 main 一级子元素不越界：45 张
      home__desktop.png —— main 一级可见子元素 2 个，越界 1 个（clientWidth 1440）
          · div.px-5.py-6 right=3213 越界 1773px
      home__tablet.png —— main 一级可见子元素 2 个，越界 1 个（clientWidth 1024）
          · div.px-5.py-6 right=3213 越界 2189px
      home__mobile.png —— main 一级可见子元素 2 个，越界 1 个（clientWidth 390）
          · div.px-5.py-6 right=3000 越界 2610px
    A3 图片全部加载成功：3 张
      home__desktop.png —— 图片 1 张，加载失败 1 张
          · __probe_missing.png alt="probe-broken-image"
    A4 固定/粘性元素互不遮挡：45 张
      home__desktop.png —— position:fixed|sticky 可见元素 2 个，相交 1 对
          · div.flex.flex-wrap ∩ nav.hidden.px-3 = 240×320px
    A5 正文对比度达标：42 张
      home__desktop.png —— 判定 42 个正文元素（另跳过 78 个），不达标 32 个，阈值 4.5:1
          · "人查" 1.29:1 < 4.5:1（rgb(37,47,44) on rgb(19,25,23)，span.text-[15px].font-semibold）
          · "规则库。分类 + 搜索 + 反例正例对照，任何一条 " 1.29:1 < 4.5:1（rgb(37,47,44) on rgb(19,25,23)，p.mt-3.flex-1）
    A6 <h1> 唯一：3 张
      home__desktop.png —— <h1> 数量 2
          · "杨先生的军火库"
          · "PROBE 重复一级标题"
    A7 页面底部无假高度：45 张
      home__desktop.png —— scrollHeight 5667 - 最后内容底部 4317 = 1351px 空白（上限 360px = 40vh）
          · 最后一个可见元素：h1
      arch__desktop.png —— scrollHeight 2250 - 最后内容底部 900 = 1350px 空白（上限 360px = 40vh）
          · 最后一个可见元素：div.mx-auto.flex
```

A5 那两条尤其值得看：它红的是**实测比值 1.29:1**，而不是「对比度不行」。
A7 也把 `scrollHeight`、最后内容底部、上限三个数一起打出来 —— 否则「底部有假高度」
这句结论没法核对。

## A1 与 A2 的互相隔离（两条断言不许互相顶罪）

这两项天然会连坐（`main` 被撑宽 → 里面的一级子元素当然也越界），所以专门造了对称的两例：

| 用例 | A1 | A2 | 说明了什么 |
|---|---|---|---|
| ③ `body::after{width:3000px}` | **红 45/45** | 绿 45/45 | A1 能在 A2 干净时自己红 |
| ④ `main{overflow-x:hidden}` + `main > *:first-child{width:3000px}` | 绿 45/45 | **红 45/45** | A2 能在 A1 干净时自己红 |

第二例里那个 `overflow-x: hidden` 是刻意加的**隔离手段**：让越界被 `main` 自己吸收，
于是文档级 `scrollWidth` 不变（A1 绿），而 `main` 的一级子元素右边界确实越界（A2 红）。
两例合起来才能说：**A1 不是 A2 的复读机，A2 也不是 A1 的影子。**

## 这一节**没有**证明什么（丑话在前）

1. **不证明阈值选得对**。七项断言全部是按注入的**极端坏样式**变红的
   （3000px、纯 404、1.29:1、150vh）。它们是「能抓住明显坏」，不是
   「能分辨 4.4:1 与 4.6:1 的差别」—— 边界精度没验，别拿这七条当精细度承诺。
2. **不证明语义对**。「这个图标画得对不对」「这句结论说得通吗」不在断言范围内
   —— 那部分继续归看图（V-2），分工写在 `assert.mjs` 文件头。
3. **A4 在移动档永远 `未适用`**（本站移动端没有 `position:fixed|sticky` 元素）。
   这是事实不是缺陷；但它意味着 A4 的覆盖是 30/45 张，报数时要带上这个分母。
4. 注入用的是 **CSS / DOM 层**手段。它证明「测量链路通」，不证明
   「Next.js 构建出来的页面在真实设备上也这样」—— 那需要真实移动端，本轮没有。

