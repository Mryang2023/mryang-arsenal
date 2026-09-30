import type { StackPicks } from '@/lib/content-types';
import type { StackPicksMeta } from '@/lib/topology';

/**
 * 方案草稿（S2-6）：把「一套选型 + 形态参数 + 基底」按名字存进 localStorage，
 * 供「与 X 对比」随时取回比差异。
 *
 * ⚠️ 硬约定：localStorage 键「只写不读的不加」—— 本键的读取方是装配台的
 * 对比下拉（loadDrafts），删掉读取方必须连写入一起删，不留只写的死键。
 *
 * 存储不是仓库：上限 DRAFTS_LIMIT 份，超出挤掉最旧。
 * 读到的脏数据（旧版本 / 手改 / 存储污染）整条丢弃，绝不带病进对比 ——
 * 拿坏快照比出来的差异是错话，比没有更糟。
 */

export const STACK_DRAFTS_KEY = 'arsenal-stack-drafts-v1';

export const DRAFTS_LIMIT = 10;

export interface StackDraft {
  id: string;
  name: string;
  /** ISO 时间串；对比下拉里只展示日期段 */
  savedAt: string;
  picks: StackPicks;
  meta: StackPicksMeta;
  baseId: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * 单条草稿的结构校验。meta 形状照 `StackPicksMeta` 核：
 * topology 是字符串映射、params 是「维度 → (参数名 → 数值)」两层映射。
 */
function parseDraft(v: unknown): StackDraft | null {
  if (!isRecord(v)) return null;
  const id = v.id;
  const name = v.name;
  const savedAt = v.savedAt;
  const baseId = v.baseId;
  if (
    typeof id !== 'string' ||
    typeof name !== 'string' ||
    typeof savedAt !== 'string' ||
    typeof baseId !== 'string'
  ) {
    return null;
  }
  if (!isRecord(v.picks) || !isRecord(v.meta)) return null;
  const picks: StackPicks = {};
  for (const [k, val] of Object.entries(v.picks)) {
    if (typeof val === 'string') picks[k] = val;
  }
  const rawTopo = (v.meta as Record<string, unknown>).topology;
  const rawParams = (v.meta as Record<string, unknown>).params;
  if (!isRecord(rawTopo) || !isRecord(rawParams)) return null;
  const topology: Record<string, string> = {};
  for (const [k, val] of Object.entries(rawTopo)) {
    if (typeof val === 'string') topology[k] = val;
  }
  const params: Record<string, Record<string, number>> = {};
  for (const [dim, ps] of Object.entries(rawParams)) {
    if (!isRecord(ps)) continue;
    const slot: Record<string, number> = {};
    for (const [pk, pv] of Object.entries(ps)) {
      if (typeof pv === 'number' && Number.isFinite(pv)) slot[pk] = pv;
    }
    params[dim] = slot;
  }
  return { id, name, savedAt, picks, meta: { topology, params }, baseId };
}

/** 读草稿。任何异常（无存储 / 坏 JSON / 形状不对）都返回已过滤的数组或空 —— 不抛错。 */
export function loadDrafts(): StackDraft[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STACK_DRAFTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseDraft)
      .filter((d): d is StackDraft => d !== null);
  } catch {
    return [];
  }
}

/**
 * 列表指纹（id + 名字 + 存档时间）。
 *
 * 为什么需要它：方案历史面板挂载时会「重读一次存储」（草稿可能是别的页面存下的），
 * 而 `loadDrafts()` 每次都新建数组 —— 直接 setDrafts 就是一次**内容完全没变**的
 * 重渲染，父组件跟着整棵树重算一遍。先比指纹，相同就保留原引用不更新。
 *
 * 只比这三个字段是有意的：picks / meta 变了而 id+name+savedAt 没变的情况
 * 不存在（草稿是整份快照，改任何一处都是新 id 新时间）。
 */
export function draftsKey(list: StackDraft[]): string {
  return list.map((d) => `${d.id}|${d.name}|${d.savedAt}`).join('\n');
}

/**
 * 写草稿并返回裁剪后的列表（调用方拿它更新 state，避免再读一遍存储）。
 * 超出上限挤掉最旧（数组头部是最新的）。
 */
export function saveDrafts(list: StackDraft[]): StackDraft[] {
  const next = list.slice(0, DRAFTS_LIMIT);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STACK_DRAFTS_KEY, JSON.stringify(next));
    } catch {
      // 存储满 / 隐私模式：静默降级 —— 对比功能本轮不可用，不阻塞装配主流程
    }
  }
  return next;
}
