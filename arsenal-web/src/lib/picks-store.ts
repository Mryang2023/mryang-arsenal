import type { StackPicks } from '@/lib/content-types';
import { defaultBase, defaultPicks, presetPicks } from '@/lib/stack';
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
// 技术栈基底是**全局声明**，与选型/形态平行 —— 单独一个键，
// 不去动 picks 的形状（同 META_KEY 的理由：旧读取点拿它当纯字符串）。
const BASE_KEY = 'arsenal-stack-base-v1';
// 选型出处：这套选型是从哪来的（目前只有「代码扫描」一种需要落盘）。
// 同样单开一个键 —— 它是**关于选型的元信息**，不是选型本身。
const PROVENANCE_KEY = 'arsenal-stack-provenance-v1';

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

// ─────────────────────────────────────────────────────────────
// 选型出处（provenance）
//
// 为什么值得单开一条通道：装配台上一个槽位填着 redis，用户必须能问出
// 「这是谁填的、凭什么」。扫描填的（有一行 pom.xml:47 做证据）和人手点的，
// 可信度不是一回事 —— 分不清这两者，档案就会把推断当成事实。
//
// 形状与 `facts-arch.ts` 的 `FactsDetail` 结构等价，但**刻意不复用那个类型**：
// facts-arch 牵连 arch-canvas / archify-ir 整个出图链，让一个只碰 localStorage
// 的模块去 import 它，所有读 picks-store 的地方都会被拖着编译一遍出图全家桶。
// 这里只留落盘真正需要的字段，转换由调用方（CodeIntake）做一次。
// ─────────────────────────────────────────────────────────────

export interface PicksProvenance {
  kind: 'scan';
  /** 扫描的仓库根路径 */
  root: string;
  /** 扫描时间（后端给的 ISO 串，原样存，不自己造时间） */
  scannedAt: string;
  /** 依赖坐标命中的槽位，每条带出处文件与行号 */
  fromDeps: { dim: string; opt: string; tech: string; path: string; line: number }[];
  /** 部署清单推出来的槽位，`because` 是仓库里真实存在的那个文件 */
  fromDeploy: { dim: string; opt: string; because: string }[];
  /** 同维度命中多条时的裁决结果 */
  conflicts: { dim: string; kept: string; dropped: string[] }[];
  /** 未识别的依赖条数（明细留在 /check 页，这里只记个数） */
  unmatchedCount: number;
  /**
   * 落盘那一刻的选型快照。
   *
   * 存它是为了在装配台上做**实时 diff**：用户后来手动改过哪几格，
   * 一比对就知道（`atScan[dim] !== picks[dim]`）。
   * 不存的话只剩「这套选型来自扫描」这一句笼统的话，
   * 而用户真正要分辨的是「哪几格是我自己改的」。
   */
  atScan: Record<string, string>;
}

/** 写选型出处。传 null 等于清除（用户清空重搭时用）。 */
export function saveProvenance(p: PicksProvenance | null): void {
  if (!canStore()) return;
  try {
    if (p === null) window.localStorage.removeItem(PROVENANCE_KEY);
    else window.localStorage.setItem(PROVENANCE_KEY, JSON.stringify(p));
  } catch {
    // 同 savePicksSnapshot：存不下就静默降级，出处丢了不影响选型本身
  }
}

/**
 * 读选型出处。读不到 / 形状不对 → null，绝不返回半截对象 ——
 * 半截的出处会让界面写出「来自扫描 · 出处 undefined」这种更像谣言的东西。
 */
export function loadProvenance(): PicksProvenance | null {
  if (!canStore()) return null;
  try {
    const raw = window.localStorage.getItem(PROVENANCE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<PicksProvenance>;
    if (p?.kind !== 'scan') return null;
    if (typeof p.root !== 'string' || typeof p.atScan !== 'object' || p.atScan === null) {
      return null;
    }
    return {
      kind: 'scan',
      root: p.root,
      scannedAt: typeof p.scannedAt === 'string' ? p.scannedAt : '',
      fromDeps: Array.isArray(p.fromDeps) ? p.fromDeps : [],
      fromDeploy: Array.isArray(p.fromDeploy) ? p.fromDeploy : [],
      conflicts: Array.isArray(p.conflicts) ? p.conflicts : [],
      unmatchedCount: typeof p.unmatchedCount === 'number' ? p.unmatchedCount : 0,
      atScan: p.atScan as Record<string, string>,
    };
  } catch {
    return null;
  }
}

/** 清掉选型出处（用户在装配台里手动改过之后，出处不再代表这套选型） */
export function clearProvenance(): void {
  saveProvenance(null);
}

/**
 * 「把这套选型装进装配台」—— 只写盘，不跳页。
 *
 * 跳转由调用方做：`CodeIntake` 被 /arch 与 /archify 两处复用，
 * 路由决策不该埋在组件里，也不该埋在这里。
 *
 * **形态一律留空**，这是刻意的：扫描读得到的是「应用副本数」
 * （K8s `replicas` / Helm `replicaCount`），而形态问的是
 * 「数据库是单实例还是主从」这类问题 —— 扫描答不上来。
 * 拿应用副本数去推形态、或干脆给个默认值，都会让装配台的形态图
 * 画出没有依据的框数（正是 topology.ts 顶部第 ③ 条要防的事）。
 * 读不到就留空，由用户自己表态。
 */
export function adoptPicks(picks: StackPicks, provenance?: PicksProvenance | null): void {
  savePicksSnapshot(picks, emptyMeta());
  saveProvenance(provenance ?? null);
}

/** 读技术栈基底：读不到（首次 / 手动清过）→ 回落默认基底，永不返回空 */
export function loadBaseSnapshot(): string {
  if (!canStore()) return defaultBase;
  try {
    return window.localStorage.getItem(BASE_KEY) || defaultBase;
  } catch {
    return defaultBase;
  }
}

/** 写技术栈基底。失败静默降级（隐私模式），不阻塞主流程。 */
export function saveBaseSnapshot(baseId: string): void {
  if (!canStore()) return;
  try {
    window.localStorage.setItem(BASE_KEY, baseId);
  } catch {
    // 同 savePicksSnapshot
  }
}
