# 方案 · 夜2棒1 · 交付中心与运行部署页重设计

> 体量 **L**：单棒预算 240（开发 145 / 自检 37 / Review 38 / 收尾 20），交棒硬线 **03:05**。
> 总规程 `NIGHT-RUN.md` 必读。**前置：夜1 P0 已落地四页**（见 §〇）。

## 〇 前置依赖检查（开工先做，不满足就降级/跳过）

1. 上夜 `REVIEW.md` 存在且无未修复的 P0；`2026-09-29\01-done.json` 状态为完成。
2. 四条路由真实存在：`/stack` `/stack/env` `/stack/run` `/stack/delivery`（`ls arsenal-web/src/app/stack/`）。
3. 不满足 → 写 `01-blocked.json` 跳过，如实留给终检。**不许在旧单页上硬做本方案。**

## 一 范围（交付中心是 mryang 拍板核心，优先保它）

### 1. 交付中心 `/stack/delivery`（P0-3 病灶：交付埋最深）

- **预检闸首屏化**：进入页面第一屏就是预检闸状态面板 ——
  violations 非空 → 红块逐条 `[check] message`（五类：duplicate-path / bean-conflict / dangling-import / pom-no-version / yml-foreign-root），三包下载卡禁用（`disabled` + `cursor-not-allowed opacity-40`）；
  violations 为空 → 绿状态行 + 下载卡启用。
  **UI 不抛异常**：违规信息走 state/props 渲染，**严禁在 useMemo/render 路径抛错**（会崩整页）。
- **导出历史面板（拍板项③）**：读草稿 `arsenal-stack-drafts-v1`（`drafts.ts` 是唯一持键方）列表 → 每条可恢复 / 可删除。**只读消费既有数据，键名与读写函数不改**；没有历史时显示空态而不是隐藏入口。
- 三包下载卡（后端包 / 前端包 / 全量）层级重排，树预览与九块图归位为页签/分区。

### 2. 运行与部署页 `/stack/run`

- ⑨ 部署形态只列已装零件的既有规则**保持**；新增**形态图右栏实时预览**（数据驱动，随选型即时变化；`replicas` 语义不许动）。

## 二 红线

- `export-lint.ts` 五检查不被绕过：前端禁用下载是**表现层**，`buildExportPlan`/`buildExportArtifacts` 的 violations 计算逻辑一行不动。
- `SlotBlock` 无修改入口是故意的（project-check 反向断言），别「顺手」给它加编辑功能。
- 动手前 `grep -n "DeliveryDeck\|ScaffoldDelivery\|SlotBlock" arsenal-web/.verify/project-check.ts` 盘点相关断言，改动与之同步。
- 装配台语义色只许 TONE 五色；同文件多处改动必须串行。

## 三 验收标准

1. 注入违规组合（如 pom 加无版本依赖走 export 冒烟）→ 交付中心首屏红 + 下载禁用；还原 → 绿。export-lint 五类检查计数不变。
2. drafts 有记录时历史面板可见、可恢复、可删；storage 键名不变（`grep arsenal-stack-drafts-v1` 仍只在 drafts.ts）。
3. `/stack/run` 形态图随选型实时变化（改一个已装零件的副本数，图跟着变）。
4. 全量 verify 十层绿 + 五处数字同步 + git 分批提交。

## 四 MVP 与可裁剪

- **必保**：预检闸首屏 + 导出历史面板 + 下载卡层级。
- **可砍**：九块图重排细节、运行页动效、历史面板的批量操作。
