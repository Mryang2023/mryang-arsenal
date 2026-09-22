# 第 2 棒 · 装配台升级（plan-3）执行记忆

## 2026-09-22 01:15 → 03:08（Hy4 preview）· 状态：部分完成

- **交接**：`01-done.json` 存在，第 1 棒 01:12 已交棒（图标库 170 矢量 / 0 位图）。无需等待。
- **结果**：数据层与引擎层做完，页面层一行未动。verify **554 项全绿**（arch 35 / graph 59 / project 400 / engine 17 / parity 12 / archify 31），`npm run build` 通过。
- **规模**：维度 18→33，选项 46→127，能力 31→100，预设 4→6。
- **未做**：阶段 C 动态交付台（九块预览 / 图形化形态选择器 / 五条滑杆 / 四动作导出）、阶段 D 交付级架构图三态、`buildTopologySvg()`、已有维度的高阶档（TiDB / Redis Cluster / Seata / Istio）、四条新策略。
- **交棒**：第 3 棒（87b68d76）已改到 03:10。

## 下次接着做时的第一件事

`topology.ts` 已经能算（`appReplicas` / `resolveTopology` / `estimateCapacity`），但**没有 UI 消费它**。
接入口：`StackComposer.tsx` 把 `meta: StackPicksMeta` 提到 state，`SlotBlock.tsx` 渲染
`topologyChoices(dim.id, option, meta)`，滑杆写 `meta.params[dimId][key]`。

## 复用价值最高的三条经验

1. **派子 agent 并行写数据模块时，让每个模块导出 `*_EXTRA` 由生成器合并**，而不是多人改同一份大文件 —— 本次五个数据模块 + 一份 canvas 元信息全程零编辑丢失。
2. **加维度必须同时补全部预设**，否则新槽位是 `empty`/`missing-recommended`，`verify:arch` 会一次红三条。
3. **改完 `arsenal.json` 的 verifyChain 必须重跑 `sync-content.mjs`**，`VERIFY_TOTAL` 才更新。

---

## 后续一轮 · 形态 UI 收尾 + 只读巡检（用户口述「只改代码，不要检验」）

- **补完了第 2 棒欠的页面层**：`topology.ts` 的 `buildTopologySvg()` / `topologyModeSvg()` 落地，
  新增 `DeliveryDeck.tsx`（九块动态交付台 + 四动作 + 五滑杆）与 `TopologyPicker.tsx`（图形化形态选择器），
  并把 `nodeTopologyMap()` 接进 `arch-canvas`（架构图叠层随形态变）、`deploy.ts`（replicas 由
  `effectiveAppReplicas` 算）、`picks-store`（双通道快照）、`TechArch.tsx`。
- **只读巡检抓出一个 P0 编译级事故**：`Inspector.tsx` / `StackComposer.tsx` 新增 `meta: StackPicksMeta`
  撞上早有的 `const meta = STATUS_META[audit.status]` → 同作用域重复声明，编译不过，
  且 `<Picker meta={meta}>` 会把状态文案当形态数据传。**已改名 `statusMeta` 修掉**，并写进
  项目 MEMORY.md 硬约定第 14 条。
- **未做**：一次都没跑 `tsc` / `build` / verify（用户明令不改检验）；高阶技术可选项、四条新策略、
  verify 四处数字同步、README 均未动。

**下次接手第一件事**：这两个 TSR 组件**从未编译过**，先跑一次类型检查/构建再谈其余。
