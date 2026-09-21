import type { StackPicks } from '@/lib/content-types';
import { defaultPicks, presetPicks } from '@/lib/stack';
/**
 * 装配台选型的跨页共享。
 *
 * 装配台是选型的唯一属主；架构图谱页只读 —— 从 localStorage 取最近一次
 * 选型快照。静态导出没有全局状态容器，localStorage 就是最低限度的总线：
 * 装配台每次变更写入，架构图谱挂载时读取一次（同一次会话内导航必然
 * 读到刚写入的值），跨页签靠 storage 事件兜底。
 */

const PICKS_KEY = 'arsenal-stack-picks-v1';

export function savePicksSnapshot(picks: StackPicks): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PICKS_KEY, JSON.stringify(picks));
  } catch {
    // 存储满 / 隐私模式：静默降级 —— 架构图谱回落到默认选型，不阻塞主流程
  }
}

/** 读不到（首次访问 / 手动清过）时回落到 standard 预设，永不返回空。 */
export function loadPicksSnapshot(): StackPicks {
  const fallback = presetPicks('standard');
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(PICKS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<StackPicks>;
    // 逐维校验：缺维度或带了不存在的值都按缺省补齐，不让脏数据进画布
    const merged: StackPicks = { ...defaultPicks };
    for (const key of Object.keys(merged) as (keyof StackPicks)[]) {
      const v = parsed[key];
      if (typeof v === 'string') merged[key] = v;
    }
    return merged;
  } catch {
    return fallback;
  }
}
