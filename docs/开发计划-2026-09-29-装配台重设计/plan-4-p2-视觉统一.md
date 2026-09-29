# 方案 · 夜3棒1 · P2 视觉统一与全量走查

> 体量 **M+**：单棒预算 240（开发 145 / 自检 37 / Review 38 / 收尾 20），交棒硬线 **03:05**。
> 总规程 `NIGHT-RUN.md` 必读。**前置：夜2 两棒 + 终检已完成**。

## 〇 前置依赖检查

1. `night-chain\2026-09-30\REVIEW.md` 存在且无未修复 P0。
2. 四页 + JourneyBar + 交付中心/选型台重设计均已落地。
3. 不满足 → 写 `01-blocked.json` 跳过。

## 一 范围

1. **JourneyBar mobile 390 折叠**：窄视口下四节点折叠为进度点（数字圆点 + 当前页名），不再折行挤压；tablet 1024 检查两档表现。纯 CSS/布局，不加依赖。
2. **TONE 五色纪律复查**：装配台四页全部语义色只许 `stack/palette.ts` TONE 五色 —— 扫本次三夜新增代码里的裸色值（`#[0-9a-f]{3,6}`、任意 `text-rose-`/`bg-amber-` 等 tailwind 语义色混入装配台页面），清零或收编进 palette。
3. **shoot.mjs 60 张全量走查**：
   - 先 `node scripts/next-run.mjs build`（视觉层断言的是 `out/` 不是源码，不 build 整层跳过）；
   - 起 3021 端口静态服务 → `node visual/shoot.mjs` 出 60 张（20 路由 × 3 视口）；
   - 逐张过 `visual/report.md`，越界/挤压/不可读的修掉；只修四页相关 + 既有路由里的明显回归。
   - ⚠️ 60 张之外的旧路由问题**记录不扩表**（EXPECTED 20/60 已被【21】守卫钉死）。

## 二 红线

- 视觉层的 EBUSY 现象：沙箱里 `verify:visual` 包装层可能被守卫拦截 → 直接 `node visual/assert.mjs`，报告里写清是哪层被拦，别当代码问题。
- 不新增任何依赖（零外部依赖铁律）；不新增路由（EXPECTED 20 不许再变）。
- 修视觉不许改数据（`arsenal-stacks/*.json`、`tools/content/*` 本棒一概不碰）。

## 三 验收标准

1. mobile 390 下 JourneyBar 是进度点形态，四页无横向溢出。
2. 裸色值清零或收编（grep 可核对：四页组件内无 palette 之外的语义色）。
3. shoot 60 张产出，report 无未处理的 ⚠；视觉层断言实测（EBUSY 时记录哪层被拦）。
4. 全量 verify 十层绿 + git 分批提交。

## 四 MVP 与可裁剪

- **必保**：JourneyBar 折叠 + shoot 60 张走查与修复。
- **可砍**：动效打磨、深色 token 之外的视觉优化点子。
