# 装配台重设计计划（2026-09-29）

> 触发：mryang 反馈「装配台的交互一点也不好，页面设计也不好，重新给我设计，菜单给我拆分出来」。
> 本文档只做**诊断 + 信息架构 + 分阶段计划**，未动任何代码；按 P0 → P1 → P2 实施。
> **已定案（2026-09-29 20:35，mryang 拍板四项，见第五节）**：拆法 A · 四页命名照案 · 交付中心加导出历史 · JourneyBar 随 P0。待令开工。

## 〇 结论先行

1. **病根**：`/stack` 一个路由塞下三段十步（StackComposer.tsx 2399 行），选型、环境、运行、交付四种心智模型挤一屏；侧边栏只有「脚手架装配台」一个入口；最重要的产物（导出三包 + 预检闸状态）埋在第 ⑩ 步。
2. **药方（已定案）**：菜单拆成「装配台」分组下的 **4 个独立页面**，每页只回答一个心智模型；数据层（picks-store / 草稿 / 历史 / wizard.ts）**零改动** —— 拆的是信息架构，不是引擎。
3. **分三阶段**：P0 拆页 + JourneyBar + 断言同步（一次落地）→ P1 逐页交互重设计（含交付中心导出历史面板）→ P2 视觉统一与窄视口。

## 一 现状诊断

### 1.1 结构事实（2026-09-29 实测）

| 项 | 现状 |
|---|---|
| 路由 | 单页 `/stack`（page.tsx 17 行 + StackComposer.tsx 2399 行） |
| 向导 | 三段十步：software（①项目定义 ②技术栈基底 ③主题框架 ④分层装配）/ frontend-env（⑤前端技术栈 ⑥环境与连接 ⑦功能模块）/ delivery-run（⑧交付与运行 ⑨部署形态 ⑩交付） |
| 步骤条 | StepRail 横向 10 格 + 分段标签 + 进度短标签 + issue 红数 |
| 组件面 | app/stack/ 16 组件 + steps/ 11 步组件 |
| 侧边栏 | Shell.tsx L17 单入口 `{ href: '/stack', label: '脚手架装配台', glyph: '⬡' }` |
| 状态 | picks-store 单例 + ProjectMeta（arsenal-stack-project-v1，含 step 恢复）+ 草稿 arsenal-stack-drafts-v1 + history 快照栈（20 上限） |
| 数据源 | wizard.ts：STEPS / stepOfDim（维度归属唯一出处）/ THEME_SECTIONS 19 维 / RUN_GROUP_IDS 三组 / FLOWS 四条流水线 |

### 1.2 交互病灶

| # | 病灶 | 证据 | 影响 |
|---|------|------|------|
| P0-1 | 十步一屏，长滚动 | 2399 行单组件 | 选型上下文丢失，回改靠来回滚 |
| P0-2 | 选型/环境/运行/交付混一页 | 三段共屏 | 注意力争夺：填数据库连接时旁边是泳道图 |
| P0-3 | 交付埋在最深处 | 导出三包 + 预检闸红块在第 ⑩ 步 | 预检闸拦了下载，用户要滚到最后才知道为什么 |
| P1-4 | StepRail 横条拥挤 | 10 格 + 分段标签 | tablet/mobile 视口挤压折行 |
| P1-5 | 菜单单入口 | 侧边栏 1 项 | 「校核台在哪 / 交付在哪」没有空间记忆 |
| P2-6 | 步骤恢复靠 step 字段 | ProjectMeta.step | 拆页后要映射成路由，处理不当刷新跳回第一段 |

### 1.3 红线约束（改版必须连动）

| 触点 | 事实 | 动作 |
|---|---|---|
| project-check 源码断言 | 至少 8 组检查直接读 StackComposer.tsx 源码文本（S1-1 台面类名 stack-bench / writing-mode / ↓ 字符、S1-5 focusDim 正则 ×2、S2-3 history 写入口、S2-6 草稿读写同源、9px 字号文件清单等，约 16 处触点） | 拆页时逐组改写指向新组件；断言总数变化同步四处 + README 两处 |
| shoot.mjs 矩阵 | EXPECTED urls:17 / shots:51（17 路由 × 3 视口），minBytes 8KB | +3 路由 → urls 20 / shots 60 |
| picks-store 跨页契约 | 快照被 TechArch / ArchifyLab / ArchGallery 读 | 契约不变，零改动 |
| SlotBlock 反向断言 | 无修改入口是故意的 | 保留；搬进交付中心后断言跟随改路径 |
| wizard.ts 唯一归属 | stepOfDim / THEME_SECTIONS / RUN_GROUP_IDS / FLOWS | 全保留；新增 section→路由映射常量，不另立口径 |
| 视觉 token | 站点深色单主题；装配台语义色只许 stack/palette.ts TONE 五色 | 新页面沿用 token，不新增语义色 |
| MEMORY 口径 | 记忆文件曾写「七步两段」，实际已是三段十步 | 已更正（09-29 与本计划同步） |

## 二 新信息架构（拆法 A，已定案）

### 2.1 菜单拆分（Shell.tsx 侧边栏）

```
概览
规则库
最佳实践案例库
场景案例库
▼ 装配台
   ◈ 选型台        /stack           （①②③④ 软件架构段）
   ❖ 环境与模块     /stack/env       （⑤⑥⑦ 前端·环境·模块）
   ⬢ 运行与部署     /stack/run       （⑧⑨ 交付运行·部署形态）
   ⇩ 交付中心       /stack/delivery  （⑩ 交付 + 导出 + 预检闸 + 历史）
架构图谱
图标库
……
```

### 2.2 路由 × 职责 × 交互

| 路由 | 页名 | 承载步骤 | 心智模型 | 关键交互 |
|---|---|---|---|---|
| `/stack` | 选型台 | ①②③④（software 段） | 我在选什么 | 形态起点 → 基底 → 19 维主题框架分区 → ④ 只读校核台 |
| `/stack/env` | 环境与模块 | ⑤⑥⑦（frontend-env 段） | 我连什么、带什么 | 前端栈开关 / 连接信息（密码默认不落盘）/ 模块勾选与冲突标黄 |
| `/stack/run` | 运行与部署 | ⑧⑨（delivery-run 前两步） | 怎么跑、摆几个 | 运行基石整组表态（runtime/delivery/ops 三组）/ 部署形态只列已装零件 |
| `/stack/delivery` | 交付中心 | ⑩ + 全部导出动作 | 我拿到什么 | **首屏 = 预检闸状态面板**（绿放行下载 / 红逐条清单）+ 三包下载卡 + 树预览 + 九块图 + **导出历史面板**（已定案） |

兼容性：`/stack` 仍是选型台本体，不重定向；ProjectMeta.step 恢复逻辑映射到对应路由（step → section → route），刷新回到正确的页。

### 2.3 数据契约不动清单

- picks-store / envValues / secrets / 模块勾选：单例照旧，跨路由读写；TechArch / ArchifyLab / ArchGallery 消费方零改动
- 草稿 arsenal-stack-drafts-v1、历史快照栈：键名不变
- wizard.ts STEPS / stepOfDim / THEME_SECTIONS / RUN_GROUP_IDS / FLOWS：全保留；新增 `SECTION_ROUTE` 常量（section → 路由），作为归属口径的补充而非替代
- steps/ 11 个步骤组件：P0 阶段内部零改动

### 2.4 拆法 B（已否决）：3 页

运行与部署并入交付中心（`/stack/delivery` 承载 ⑧⑨⑩）。菜单更短，但交付页混入配置心智，与「交付中心只管产出」的原则冲突 —— mryang 09-29 拍板不用，留档备查。

## 三 分阶段实施

### P0 信息架构拆分（逻辑零改动，一次落地）

1. wizard.ts 加 `SECTION_ROUTE`（section → 路由）
2. StackComposer.tsx 拆 4 容器：StackSoftware / StackEnv / StackRun / StackDelivery；公共状态收进 useStackChannel hook；steps/* 组件不动
3. StepRail 拆两截：**JourneyBar**（4 节点跨页导航，已定案随 P0）+ 页内 Rail（本段步骤）；mobile 390 折叠为进度点放 P2
4. Shell.tsx 侧边栏加「装配台」分组（4 项）
5. project-check 断言逐组改写 + 数字同步四处 + README 两处；shoot.mjs EXPECTED 20/60

验收：verify 九层全绿；4 路由手工走查；picks/草稿跨页不丢；刷新恢复到正确页。

### P1 逐页交互重设计

- 选型台：19 维分区左导航 + 已选计数角标 + 必缺件点名条；④ 校核台点卡片跨页直达归属页
- 环境与模块：连接三态卡（演示 / 本机 / 远端），「密码默认不落盘」提示前置
- 运行与部署：形态图右栏实时预览
- 交付中心（已定案范围）：预检闸首屏化 + **导出历史面板**（drafts 数据已有，只加可见入口）+ 三包下载卡 + 树预览 + 九块图

### P2 视觉统一

- mobile 390 视口 JourneyBar 折叠为进度点
- TONE 五色纪律复查 + shoot 60 张全量走查

## 四 改动面与风险

| 阶段 | 改动面 | 主要风险 | 对策 |
|---|---|---|---|
| P0 | Shell.tsx / 新路由 ×3 / 容器 ×4 / StepRail→JourneyBar / project-check / shoot.mjs | ① 断言改写漏项 → project-check 红（红即漏项清单，可接受）② picks-store hydration 时序 ③ 深链 step 恢复映射错段 | 拆一页验一页；断言改写与组件拆分同 commit |
| P1 | 各页内部 | SlotBlock 反向断言被误破坏 | 动校核台前先 grep 断言原文 |
| P2 | CSS / 视觉 | 新语义色违规 | 只用 TONE 五色 |

## 五 定案记录（2026-09-29 20:35，mryang）

| # | 议题 | 定案 |
|---|---|---|
| 1 | 拆法 A（4 页）vs B（3 页） | **A** |
| 2 | 四页命名 | 照案：选型台 / 环境与模块 / 运行与部署 / 交付中心 |
| 3 | 交付中心导出历史面板 | **加**（drafts 数据已有，只加可见入口） |
| 4 | JourneyBar 随 P0 | **是** |

## 六 下一步

**已排三夜（2026-09-29 21:00 排期，定时任务已建）**：夜1 = P0（XL 独占）；夜2 = P1 两页（交付与运行 / 选型与环境）；夜3 = P2 视觉统一。棒次表、接力协议、环境备忘见同目录 `NIGHT-RUN.md` 与 `00-index.md`；四份自包含方案 `plan-1..4`。P0 验收标准见第三节。
