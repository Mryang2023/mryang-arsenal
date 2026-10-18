'use client';

/**
 * 当前项目 · 跨页共享总线（工坊棒2）。
 *
 * 项目工坊的核心心智是「先选一个固定项目，再进侦察 / 测试工程师」。
 * 这份 store 就是那个「当前项目」的唯一真相：写在 localStorage，跨页签 /
 * 跨页面（/projects ↔ /autopsy ↔ /qa）靠它保持一致，跨标签页靠 storage 事件兜底。
 *
 * 设计仿 `picks-store.ts` 的跨页总线：单一 localStorage 键、读写集中在一处、
 * 读取失败回落 null（绝不返回半截对象 / 绝不带病进界面）。
 *
 * ⚠ 键名**只在此文件定义一次** —— 页面与导航都调 `getActiveProject` /
 * `setActiveProject`，不许在别处硬编码 `arsenal-active-project-v1`
 * （两处各自为政时读写会静默对不上，正是 picks-store 当年踩过的坑）。
 */
import { useSyncExternalStore } from 'react';

const ACTIVE_KEY = 'arsenal-active-project-v1';

export interface ActiveProject {
  /** 与后端注册表一致的 projectId（统一算法 sha256-12，前端复用 autopsy-snapshot-shape.mjs） */
  id: string;
  /** 项目名（设置时一并记下，导航组标题与横幅可直接显示，免得再去后端查名字） */
  name?: string;
}

function canStore(): boolean {
  return typeof window !== 'undefined';
}

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

if (canStore()) {
  // 跨标签页：另一个标签页改了当前项目，本标签页的导航组标题 / 横幅要跟着变
  window.addEventListener('storage', (e) => {
    if (e.key === ACTIVE_KEY) emit();
  });
}

/**
 * 读当前项目。读不到 / 形状不对 → null，永不返回半截对象
 * （半截的当前项目会让界面写出「当前：undefined」这种更像谣言的东西）。
 *
 * ★ 快照按原始串缓存（工坊棒3 E2E 抓到的真 bug）：useSyncExternalStore 要求
 *   getSnapshot 返回**引用稳定**的值 —— 这里每次 parse 都会造新对象，React
 *   会判「快照变了」无限重渲染（Maximum update depth exceeded），页面直接崩
 *   （「This page couldn't load」）。只有 active 为 null 时恰好返回同一引用才
 *   没炸过 —— 所以 /projects 的空态 smoke 一直是绿的，一设当前项目就爆。
 *   修法：原始串没变就返回上一次 parse 的同一个对象引用。
 */
let snapRaw: string | null = null;
let snapVal: ActiveProject | null = null;

export function getActiveProject(): ActiveProject | null {
  if (!canStore()) return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_KEY);
    if (raw === snapRaw) return snapVal;
    if (!raw) {
      snapRaw = null;
      snapVal = null;
      return null;
    }
    const p = JSON.parse(raw) as Partial<ActiveProject>;
    snapRaw = raw;
    snapVal = typeof p.id === 'string' && p.id ? { id: p.id, name: typeof p.name === 'string' ? p.name : undefined } : null;
    return snapVal;
  } catch {
    snapRaw = null;
    snapVal = null;
    return null;
  }
}

/** 写当前项目。传 null = 清除。失败静默降级（隐私模式），不阻塞主流程。 */
export function setActiveProject(p: ActiveProject | null): void {
  if (!canStore()) return;
  try {
    if (p === null) window.localStorage.removeItem(ACTIVE_KEY);
    else window.localStorage.setItem(ACTIVE_KEY, JSON.stringify({ id: p.id, name: p.name }));
    emit();
  } catch {
    // 存不下就静默降级，当前项目丢失不影响页面其余功能
  }
}

/** 订阅变化。返回取消订阅函数。 */
export function subscribeActiveProject(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** React 钩子：当前项目变化时触发重渲染（同一次会话内导航必然读到刚写入的值）。 */
export function useActiveProject(): ActiveProject | null {
  return useSyncExternalStore(subscribeActiveProject, getActiveProject, () => null);
}
