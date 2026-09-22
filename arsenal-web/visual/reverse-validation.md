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
