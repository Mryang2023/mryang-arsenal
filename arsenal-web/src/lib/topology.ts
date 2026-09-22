import { dimensions } from './stack';
import type { StackDimension, StackOption } from './content-types';

/**
 * 集群形态层 —— 把「数据库是单实例还是主从」从一句展示文字，变成会算进产物的真模型。
 *
 * 三条设计约束：
 *   ① **形态存在单独的通道里**（`StackPicksMeta`），不挤进 `StackPicks`。
 *      `StackPicks` 是「维度 → 选项 id」的字符串映射，全站十几处按字符串读它；
 *      把形态塞进值里会让那些读取点全部失去类型。平行通道既不动它们，
 *      又让形态成为与选择平级的一等公民。
 *   ② **旧快照必须活着**。localStorage 里已经存在纯字符串快照（没有 meta），
 *      `normalizePicks()` 对它们原样放行 —— 不崩、不清空、行为与改版前一致。
 *   ③ **形态必须能落到数字上**。`resolveTopology()` 给出的 `replicas` 是整数，
 *      K8s 的 `replicas` / PDB / 反亲和、Compose 的实例数、架构图的叠层数
 *      全部由它算出来。算不出数字就不算形态。
 */

export interface TopologyMode {
  id: string;
  label: string;
  /** 图上画几个堆叠卡 / K8s 起几个副本。必须是正整数 */
  replicas: number;
  note?: string;
  requires?: string[];
}

export interface TopologySpec {
  default: string;
  modes: TopologyMode[];
}

/** 与选项选择平行的形态与参数。键一律是维度 id。 */
export interface StackPicksMeta {
  topology: Record<string, string>;
  params: Record<string, Record<string, number>>;
}

/** 单个槽位的完整选择（新格式，导出 / 存储用） */
export interface StackPickDetail {
  option: string;
  topology?: string;
  params?: Record<string, number>;
}

export function emptyMeta(): StackPicksMeta {
  return { topology: {}, params: {} };
}

/**
 * 归一化入口。
 *
 * 输入可以是三样东西：
 *   ① 旧快照 `{ jdk: '17', database: 'mysql' }` —— 原样返回，meta 为空；
 *   ② 新格式 `{ database: { option: 'mysql', topology: 'mgr' } }` —— 折叠成 ① + meta；
 *   ③ 任何脏数据（null / 数组 / 数字）—— 逐项丢弃，绝不整份抛掉。
 *
 * 为什么逐个字段容错而不是整体 try/catch：用户手改过一次 localStorage 之后，
 * 「整个选型被清空」比「某一个槽位空着」难接受得多。
 */
export function normalizePicks(raw: unknown): {
  picks: Record<string, string>;
  meta: StackPicksMeta;
} {
  const picks: Record<string, string> = {};
  const meta = emptyMeta();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { picks, meta };

  for (const [dim, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') {
      picks[dim] = value;
      continue;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const detail = value as Partial<StackPickDetail>;
    if (typeof detail.option !== 'string') continue;
    picks[dim] = detail.option;
    if (typeof detail.topology === 'string') meta.topology[dim] = detail.topology;
    if (detail.params && typeof detail.params === 'object') {
      const clean: Record<string, number> = {};
      for (const [k, v] of Object.entries(detail.params)) {
        if (typeof v === 'number' && Number.isFinite(v)) clean[k] = v;
      }
      if (Object.keys(clean).length) meta.params[dim] = clean;
    }
  }
  return { picks, meta };
}

/** 把任意输入折成「可直接喂给 composeStack 的字符串快照」 */
export function picksToPlain(raw: unknown): Record<string, string> {
  return normalizePicks(raw).picks;
}

const dimById = new Map<string, StackDimension>(dimensions.map((d) => [d.id, d]));

/** 维度上声明的形态表（数据来自 arsenal-stacks/stack.json） */
export function topologySpecOf(dimId: string, option?: StackOption | null): TopologySpec | null {
  const dim = dimById.get(dimId);
  if (!dim) return null;
  const fromOption = option?.topology as TopologySpec | undefined;
  if (fromOption?.modes?.length) return fromOption;
  const fromDim = (dim as unknown as { topology?: TopologySpec }).topology;
  if (fromDim?.modes?.length) return fromDim;
  return null;
}

/** 所有带形态的维度 */
export function topologyDims(): StackDimension[] {
  return dimensions.filter((d) => topologySpecOf(d.id));
}

/**
 * 解出某个维度当前生效的形态。
 *
 * 优先级：显式选的形态 > 选项/维度声明的默认 > 形态表的第一项。
 * 拿不到形态（该组件不区分形态）返回 null —— 调用方必须自己处理 null，
 * 不许在这里塞一个 `single` 兜底：那是「看起来有形态、其实没生效」的来源。
 */
export function resolveTopology(
  dimId: string,
  option: StackOption | null | undefined,
  meta?: StackPicksMeta
): TopologyMode | null {
  const spec = topologySpecOf(dimId, option);
  if (!spec) return null;
  const wanted = meta?.topology?.[dimId] ?? option?.topologyDefault ?? spec.default;
  return spec.modes.find((m) => m.id === wanted) ?? spec.modes[0] ?? null;
}

/** 形态选择器用：把形态表摊平成可直接渲染的项 */
export function topologyChoices(
  dimId: string,
  option: StackOption | null | undefined,
  meta?: StackPicksMeta
): { mode: TopologyMode; active: boolean }[] {
  const spec = topologySpecOf(dimId, option);
  if (!spec) return [];
  const current = resolveTopology(dimId, option, meta);
  return spec.modes.map((mode) => ({ mode, active: mode.id === current?.id }));
}

// ─────────────────────────────────────────────────────────────
// 副本数：一切「几个实例」的唯一来源
// ─────────────────────────────────────────────────────────────

/**
 * 应用副本数。
 *
 * 来源顺序：
 *   ① `clustertopology` 维度选中的形态（用户的全局表态，最权威）
 *   ② `web` 维度的形态（只选了 web 形态、没选全局形态时）
 *   ③ 1（没有做任何形态表态）
 *
 * 这个数字直接决定 K8s `replicas` / PDB `minAvailable` / Compose 实例数 /
 * 架构图叠层数。**任何地方都不许再写死 replicas。**
 */
export function appReplicas(picks: Record<string, string>, meta?: StackPicksMeta): number {
  const dim = dimById.get('clustertopology');
  if (dim) {
    const optId = picks.clustertopology;
    const opt = optId ? dim.options.find((o) => o.id === optId) ?? null : null;
    const mode = resolveTopology('clustertopology', opt, meta);
    if (opt && mode) return Math.max(1, mode.replicas);
  }
  const webDim = dimById.get('web');
  if (webDim) {
    const optId = picks.web;
    const opt = optId ? webDim.options.find((o) => o.id === optId) ?? null : null;
    const mode = resolveTopology('web', opt, meta);
    if (mode) return Math.max(1, mode.replicas);
  }
  return 1;
}

/** 某个数据组件的副本数（没有形态表态就是 1） */
export function componentReplicas(
  dimId: string,
  picks: Record<string, string>,
  meta?: StackPicksMeta
): number {
  const dim = dimById.get(dimId);
  if (!dim) return 1;
  const optId = picks[dimId];
  if (!optId) return 1;
  const opt = dim.options.find((o) => o.id === optId) ?? null;
  const mode = resolveTopology(dimId, opt, meta);
  return mode ? Math.max(1, mode.replicas) : 1;
}

// ─────────────────────────────────────────────────────────────
// 容量摘要：全部由形态与选项算出来，不写死任何一个数字
// ─────────────────────────────────────────────────────────────

export interface CapacityRow {
  dimId: string;
  dimName: string;
  optionName: string;
  modeLabel: string;
  replicas: number;
}

export interface Capacity {
  appReplicas: number;
  /** 每个应用实例的 JVM 堆（MB），来自 params 或默认 1024 */
  heapMb: number;
  /** 每实例连接池上限 */
  poolSize: number;
  /** 全站最大数据库连接数 = 应用副本 × 池大小 —— 这是压到库上的真实数字 */
  dbConnections: number;
  /** 应用侧估算内存 = 副本 × (堆 + 512MB 堆外) */
  appMemoryMb: number;
  rows: CapacityRow[];
  multiReplica: boolean;
}

const HEAP_DEFAULT = 1024;
const OFF_HEAP = 512;
const POOL_DEFAULT = 20;

export function estimateCapacity(
  picks: Record<string, string>,
  meta?: StackPicksMeta
): Capacity {
  const replicas = appReplicas(picks, meta);
  const heapMb = meta?.params?.app?.heapMb ?? HEAP_DEFAULT;
  const poolSize = meta?.params?.database?.poolSize ?? POOL_DEFAULT;

  const rows: CapacityRow[] = [];
  for (const dim of topologyDims()) {
    const optId = picks[dim.id];
    if (!optId) continue;
    const opt = dim.options.find((o) => o.id === optId);
    if (!opt || opt.id === 'none') continue;
    const mode = resolveTopology(dim.id, opt, meta);
    if (!mode) continue;
    rows.push({
      dimId: dim.id,
      dimName: dim.name,
      optionName: opt.name,
      modeLabel: mode.label,
      replicas: Math.max(1, mode.replicas),
    });
  }

  return {
    appReplicas: replicas,
    heapMb,
    poolSize,
    dbConnections: replicas * poolSize,
    appMemoryMb: replicas * (heapMb + OFF_HEAP),
    rows,
    multiReplica: replicas > 1,
  };
}
