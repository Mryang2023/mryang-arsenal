# 方案 · 夜1棒1 · P0 信息架构拆分（拆法 A 四页 + JourneyBar）

> 体量 **XL**：单棒预算 380（开发 240 / 自检 60 / Review 60 / 收尾 20），交棒硬线 **04:45**。
> 本方案自包含：执行者不需要读对话记录。总规程 `NIGHT-RUN.md` 必读。

## 〇 背景与定案（不许再议）

装配台现状是 `/stack` 单路由塞三段十步（`StackComposer.tsx` 2399 行），选型/环境/运行/交付四种心智挤一屏；导出三包与预检闸状态埋在第 ⑩ 步。**四项已拍板（09-29 20:35）**：

1. 拆法 **A：四页**；
2. 命名照案：选型台 / 环境与模块 / 运行与部署 / 交付中心；
3. 交付中心含导出历史（**夜2 做**，本棒不做）；
4. StepRail→JourneyBar **随本棒**。

**总原则：数据层零改动** —— picks-store / drafts / history / envValues / secrets 的键名与语义不变；`wizard.ts` 的 STEPS / stepOfDim / THEME_SECTIONS / RUN_GROUP_IDS / FLOWS 全保留。拆的是信息架构，不是引擎。

## 一 目标结构

| 路由 | 页名 | 承载步骤（wizard.ts 段） | 心智 |
|---|---|---|---|
| `/stack` | 选型台 | software 段（①项目定义 ②基底 ③主题框架 ④分层装配） | 我在选什么 |
| `/stack/env` | 环境与模块 | frontend-env 段（⑤前端 ⑥环境连接 ⑦模块） | 我连什么、带什么 |
| `/stack/run` | 运行与部署 | delivery-run 段前两步（⑧交付与运行 ⑨部署形态） | 怎么跑、摆几个 |
| `/stack/delivery` | 交付中心 | ⑩交付 + 导出动作 | 我拿到什么 |

- `/stack` 就是选型台本体，**不重定向**；三段十步的 StepId 顺序不变，只是跨页分布。
- 侧边栏（`Shell.tsx` L17 现在是单条目 `{ href: '/stack', label: '脚手架装配台' }`）改为「装配台」分组 4 项。

## 二 实施清单（按序，阶段化推进）

1. **wizard.ts** 加 `SECTION_ROUTE` 常量（section → 路由，三条映射）。唯一新增口径；`stepOfDim` 等一律不动。
2. **拆容器**：`StackComposer.tsx` 拆成 `StackSoftware / StackEnv / StackRun / StackDelivery` 四个容器组件；公共状态收进 `useStackChannel` hook（picks hydration、ProjectMeta、history、drafts、envValues 通道）。**steps/ 下 11 个步骤组件内部零改动**，只动容器层。发现必须改 steps 内部才能拆的，停下来记录并做最小改动。
3. **ProjectMeta.step 恢复映射**：step → 所属 section → 路由；刷新/重开落对页（P2-6 病灶）。`arsenal-stack-project-v1` 键名不变。
4. **StepRail 拆两截**：新 `JourneyBar`（①选型台→②环境与模块→③运行与部署→④交付中心 四节点跨页导航，当前页高亮）+ 页内 Rail（只显示本段步骤）。mobile 390 折叠**不在本棒**（夜3）。
5. **断言与矩阵同步**（本棒最容易翻车的一段，按序做完再验证）：
   - 动手前先 `grep -n "StackComposer\|StepRail\|stepOfDim\|focusDim" arsenal-web/.verify/project-check.ts` 盘点全部源码文本断言（至少 8 组检查、约 16 处触点：S1-1 stack-bench 类名/writing-mode/↓ 字符、S1-5 focusDim 正则×2、S2-3 history 写入口、S2-6 草稿读写同源、9px 字号文件清单等），逐组改写指向新容器文件；**语义不变，只换被读的文件**。
   - `SlotBlock`「无修改入口」反向断言随搬家改路径，语义保持。
   - `visual/shoot.mjs` `EXPECTED`：urls 17→**20** / shots 51→**60**；新增 3 条路由进矩阵。【21】守卫盯截图数，README 里「N 张截图矩阵 / N 路由」散文同步。
   - 断言总数变化 → **五处派生数字同步**（NIGHT-RUN §六.7），改完复跑确认。
   - `.workbuddy/memory/MEMORY.md` 装配台口径补一行「四页路由已落地」。

## 三 技术红线

- 改 `StackComposer.tsx` 与 `project-check.ts` 前 `cp` 备份；**同一文件多处改动必须串行**（并行 Edit 静默丢改）。
- 断言改写只许「换文件指向」，不许为了让它绿而放松判据。红了必须能解释是「断言过时已正确改写」，不是绕过。
- 装配台语义色只许 `stack/palette.ts` TONE 五色；不新增依赖（零外部依赖铁律）。
- `next dev/build` 只许 `node arsenal-web/scripts/next-run.mjs`；验证命令见 NIGHT-RUN §五。

## 四 验收标准（逐条可核对）

1. 四条路由各自渲染对应段；侧边栏分组 4 项可点、当前页高亮。
2. picks/草稿跨页不丢：选型台选两项 → `/stack/env` 可见 → 返回 `/stack` 仍在（手工或无头浏览器验证）。
3. 刷新任意一页恢复正确路由（step→route 映射）。
4. `project-check` 原对 StackComposer 的触点全部改指新文件或显式更新（无悬空 `readRel('src/app/stack/StackComposer.tsx')`）。
5. 全量 verify 十层全绿，实测数字与开工基线对账；断言数变化已五处同步。
6. JourneyBar 四节点可用。
7. git 分批提交（`feat(stack): ...`），无 `_*` 夹带。

## 五 MVP 与可裁剪

- **必保**：四路由 + 侧边栏分组 + useStackChannel + 断言改写 + EXPECTED 20/60 + 全量绿。
- **可砍（记入未做完清单）**：JourneyBar 动效/徽标打磨、九块预览布局重排（夜2）、一切 P1 内容。
- **绝不做**：导出历史面板（夜2）、19 维分区导航（夜2棒2）、mobile 折叠（夜3）。
