import type { StackPicks } from '@/lib/content-types';
import { defaultPicks, presetPicks } from '@/lib/stack';
import { emptyMeta, normalizePicks, toPickDetails, type StackPicksMeta } from '@/lib/topology';
/**
 * 装配台选型的跨页共享。
 *
 * 装配台是选型的唯一属主；架构图谱页只读 —— 从 localStorage 取最近一次
 * 选型快照。静态导出没有全局状态容器，localStorage 就是最低限度的总线：
 * 装配台每次变更写入，架构图谱挂载时读取一次（同一次会话内导航必然
 * 读到刚写入的值），跨页签靠 storage 事件兜底。
 *
 * ── 两条通道分两个键（扩展自集群形态那一版） ──
 *
 * 选型是「维度 → 选项 id」的字符串映射，集群形态与参数是它的**平行**通道。
 * 两者刻意不塞进同一个值里：`arsenal-stack-picks-v1` 里已经存在大量纯字符串
 * 快照，把值改成对象的那一刻，所有按字符串读它的页面都会拿到 `[object Object]`。
 * 所以：
 *
 *   · 选型仍然写 `arsenal-stack-picks-v1`（形状不变，旧读取点零改动）
 *   · 形态与参数写 `arsenal-stack-meta-v1`（新键，读不到就是空 meta）
 *
 * 旧快照的唯一后果是「形态回到默认」—— 不崩、不清空、不缺维度。
 * 而两端都过 `normalizePicks()`：将来真把两者合成一个键时，
 * 归一化逻辑已经在那儿了，不必再改一遍读取方。
 */

const PICKS_KEY = 'arsenal-stack-picks-v1';
const META_KEY = 'arsenal-stack-meta-v1';
const DETAIL_KEY = 'arsenal-stack-detail-v1';

function canStore(): boolean {
  return typeof window !== 'undefined';
}

/**
 * 写快照。
 *
 * `meta` 可省 —— 省了就等于「这次没有形态要记」，旧行为逐字节不变。
 * 另外写一份**合并形态**的详情对象到 `arsenal-stack-detail-v1`，
 * 供「导出选型 / 粘贴选型」这条人工通路取用（人看到的是带形态的完整记法）。
 */
export function savePicksSnapshot(picks: StackPicks, meta?: StackPicksMeta): void {
  if (!canStore()) return;
  try {
    window.localStorage.setItem(PICKS_KEY, JSON.stringify(picks));
    if (meta) window.localStorage.setItem(META_KEY, JSON.stringify(meta));
    window.localStorage.setItem(DETAIL_KEY, JSON.stringify(toPickDetails(picks, meta)));
  } catch {
    // 存储满 / 隐私模式：静默降级 —— 架构图谱回落到默认选型，不阻塞主流程
  }
}

export interface LoadedSnapshot {
  picks: StackPicks;
  meta: StackPicksMeta;
  /** 快照来自旧格式（有选型、无形态）—— 页面可以据此提示「形态是默认值」 */
  legacy: boolean;
}

/**
 * 读快照（选型 + 形态）。
 *
 * 三条容错：
 *   · 读不到（首次访问 / 手动清过）→ 回落 standard 预设，永不返回空；
 *   · 值不是字符串（有人手改成对象）→ 交 `normalizePicks()` 逐项归一化，
 *     脏的那一项丢掉，其余保留；
 *   · 缺维度 → 按缺省补齐（与改版前一致，不让脏数据进画布）。
 */
export function loadSnapshot(): LoadedSnapshot {
  const fallback = presetPicks('standard');
  if (!canStore()) return { picks: fallback, meta: emptyMeta(), legacy: true };

  let picks: StackPicks = fallback;
  let meta: StackPicksMeta = emptyMeta();
  let legacy = true;

  try {
    const rawPicks = window.localStorage.getItem(PICKS_KEY);
    const rawMeta = window.localStorage.getItem(META_KEY);
    if (rawPicks) {
      const { picks: plain, meta: inlineMeta } = normalizePicks(JSON.parse(rawPicks));
      const merged: StackPicks = { ...defaultPicks };
      for (const key of Object.keys(merged) as (keyof StackPicks)[]) {
        const v = plain[key];
        if (typeof v === 'string') merged[key] = v;
      }
      picks = merged;
      if (Object.keys(inlineMeta.topology).length || Object.keys(inlineMeta.params).length) {
        meta = inlineMeta;
      }
    }
    if (rawMeta) {
      const parsed = JSON.parse(rawMeta) as Partial<StackPicksMeta>;
      const t: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed?.topology ?? {})) {
        if (typeof v === 'string') t[k] = v;
      }
      const pm: Record<string, Record<string, number>> = {};
      for (const [dim, bag] of Object.entries(parsed?.params ?? {})) {
        const clean: Record<string, number> = {};
        for (const [k, v] of Object.entries(bag ?? {})) {
          if (typeof v === 'number' && Number.isFinite(v)) clean[k] = v;
        }
        if (Object.keys(clean).length) pm[dim] = clean;
      }
      if (Object.keys(t).length || Object.keys(pm).length) {
        meta = { topology: t, params: pm };
        legacy = false;
      }
    }
  } catch {
    return { picks: fallback, meta: emptyMeta(), legacy: true };
  }

  return { picks, meta, legacy };
}

/** 只取选型（架构图谱 / 导出等只关心「装了哪些零件」的读取点用这个） */
export function loadPicksSnapshot(): StackPicks {
  return loadSnapshot().picks;
}

/** 只取形态与参数 */
export function loadMetaSnapshot(): StackPicksMeta {
  return loadSnapshot().meta;
}

/** 清掉形态与参数（「清空重搭」时用）—— 选型由调用方另行写入 */
export function clearMetaSnapshot(): void {
  if (!canStore()) return;
  try {
    window.localStorage.removeItem(META_KEY);
  } catch {
    // 同 savePicksSnapshot：失败不阻塞主流程
  }
}
