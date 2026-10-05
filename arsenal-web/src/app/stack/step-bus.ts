'use client';

import type { StepId } from './wizard';

/**
 * 当前步骤的**跨组件广播** —— 侧边栏菜单树为什么不能只靠 pathname 的原因：
 *
 * 页内换步刻意不做 router 导航（重挂载会把撤销栈、台面聚焦、搜索词这些
 * 瞬时态全丢，见 StepRail.go / 各页 focusDim 的注释），于是 pathname 停在
 * 页路由上不动，按 pathname 点亮的侧栏就停在上一步 ——「页内点了步骤，
 * 左边菜单树没跟着变」（2026-10-05 反馈）。试过 `history.replaceState`
 * 同步 URL：Next 14 的 App Router 不认跨 pathname 的原生 History 改动，
 * 路由树没跟上，地址栏随后被它自己弹回旧步骤 —— 此路不通。
 *
 * 所以换 state 的地方顺手广播：useStackChannel 的 setStep 是全站唯一的
 * 换步入口（水合恢复、页规格重置、步骤条、点阵直达全都汇进它），
 * 它发布；Shell 在布局里拿不到装配台的 state，它订阅。
 * 模块级单例 —— 同一时刻只有一个当前步；null = 没有装配台页面挂载着
 * （卸载时发布 null，不然从 /stack 跳去 /rules 侧栏还亮着装配台的步骤）。
 */
let current: StepId | null = null;
const listeners = new Set<() => void>();

export function publishStep(id: StepId | null): void {
  if (current === id) return;
  current = id;
  (globalThis as { __arsenalStepBus?: string | null }).__arsenalStepBus = id;
  (globalThis as { __arsenalStepBusListeners?: number }).__arsenalStepBusListeners = listeners.size;
  for (const l of listeners) l();
}

export function subscribeStep(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** useSyncExternalStore 的 getSnapshot —— 返回原始值，引用稳定 */
export function currentStep(): StepId | null {
  return current;
}
