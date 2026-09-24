import { dimensions } from './stack';
import type { StackDimension, StackOption } from './content-types';
import { escapeXml } from './arch-diagram';
import { capLabel } from './arch';

/**
 * 集群形态层 —— 把「数据库是单实例还是主从」从一句展示文字，变成会算进产物的真模型。
 *
 * 四条设计约束：
 *   ① **形态存在单独的通道里**（`StackPicksMeta`），不挤进 `StackPicks`。
 *      `StackPicks` 是「维度 → 选项 id」的字符串映射，全站十几处按字符串读它；
 *      把形态塞进值里会让那些读取点全部失去类型。平行通道既不动它们，
 *      又让形态成为与选择平级的一等公民。
 *   ② **旧快照必须活着**。localStorage 里已经存在纯字符串快照（没有 meta），
 *      `normalizePicks()` 对它们原样放行 —— 不崩、不清空、行为与改版前一致。
 *   ③ **形态必须能落到数字上**。`resolveTopology()` 给出的 `replicas` 是整数，
 *      K8s 的 `replicas` / PDB / 反亲和、Compose 的实例数、架构图的叠层数
 *      全部由它算出来。算不出数字就不算形态。
 *   ④ **形态图与容量摘要都从这里出**。`buildTopologySvg()` 与 `estimateCapacity()`
 *      没有第二份「形态长什么样」的知识 —— 页面上看到的框数与清单里的副本数
 *      是同一个 `resolveTopology()` 的结果，不可能是两个数。
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

/**
 * 反向：字符串快照 + meta → 逐槽位的完整记法。
 * `savePicksSnapshot()` 写盘前用它把两条通道合回一个对象，
 * 于是「打开时怎么读」与「关闭时怎么写」共用同一份形状定义。
 */
export function toPickDetails(
  picks: Record<string, string>,
  meta?: StackPicksMeta
): Record<string, StackPickDetail> {
  const out: Record<string, StackPickDetail> = {};
  for (const [dim, opt] of Object.entries(picks)) {
    if (!opt) continue;
    const detail: StackPickDetail = { option: opt };
    const t = meta?.topology?.[dim];
    if (t) detail.topology = t;
    const p = meta?.params?.[dim];
    if (p && Object.keys(p).length) detail.params = { ...p };
    out[dim] = detail;
  }
  return out;
}

const dimById = new Map<string, StackDimension>(dimensions.map((d) => [d.id, d]));

function optionOfDim(dimId: string, optId: string | undefined): StackOption | null {
  if (!optId) return null;
  const dim = dimById.get(dimId);
  return dim?.options.find((o) => o.id === optId) ?? null;
}

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
// 参数：五条滑杆的唯一来源
//
// 与形态同源：滑杆的值写进 `meta.params[dimId][key]`，产物侧一律从
// `paramValue()` 读 —— 页面上滑到 5，K8s 清单里就是 5，中间没有第二条路径。
// ─────────────────────────────────────────────────────────────

export interface ParamSpec {
  /** params 挂在哪个维度下 */
  dimId: string;
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  fallback: number;
  /** 这个数字会落到产物的哪个位置 —— 滑杆不写清去处就等于在滑空气 */
  impact: string;
}

export const PARAM_SPECS: ParamSpec[] = [
  {
    dimId: 'app', key: 'replicas', label: '应用副本数', unit: '个',
    min: 1, max: 12, step: 1, fallback: 0,
    impact: 'K8s replicas / PDB minAvailable / Compose 实例数 / 架构图叠层数',
  },
  {
    dimId: 'database', key: 'poolSize', label: '连接池上限', unit: '',
    min: 2, max: 200, step: 1, fallback: 20,
    impact: 'hikari.maximum-pool-size；全站连接数 = 副本数 × 池上限',
  },
  {
    dimId: 'app', key: 'heapMb', label: 'JVM 堆', unit: 'MB',
    min: 256, max: 8192, step: 256, fallback: 1024,
    impact: '-Xmx；容量摘要按「堆 + 512MB 堆外」估算每副本内存',
  },
  {
    dimId: 'app', key: 'qpsLimit', label: '单实例限流阈值', unit: 'QPS',
    min: 100, max: 50000, step: 100, fallback: 2000,
    impact: 'resilience4j / sentinel 的 RateLimiter 阈值，写进配置片段',
  },
  {
    dimId: 'database', key: 'shardCount', label: '分片数', unit: '片',
    min: 1, max: 64, step: 1, fallback: 4,
    impact: '分库分表路由片数；形态图上「分库分表」那张图的格子数跟着变',
  },
];

const paramByKey = new Map(PARAM_SPECS.map((s) => [s.key, s]));

/** 单条参数当前值：显式调过就用调的，没调过用 fallback */
export function paramValue(meta: StackPicksMeta | undefined, key: string): number {
  const spec = paramByKey.get(key);
  if (!spec) return 0;
  const v = meta?.params?.[spec.dimId]?.[spec.key];
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Math.min(spec.max, Math.max(spec.min, v));
  }
  return spec.fallback;
}

/**
 * 这条参数**用户调过没有**。
 *
 * `app.replicas` 的 fallback 是 0（「未设」哨兵，见 PARAM_SPECS）——
 * V2-12 事故的根源就是把哨兵 0 当输入值显示了出来。UI 侧判「未设」
 * 必须走这里，不许拿 `paramValue() === 0` 猜。
 */
export function paramIsSet(meta: StackPicksMeta | undefined, key: string): boolean {
  const spec = paramByKey.get(key);
  if (!spec) return false;
  const v = meta?.params?.[spec.dimId]?.[spec.key];
  return typeof v === 'number' && Number.isFinite(v);
}

/** 写一条参数，返回新的 meta（不改原对象 —— 与 composeStack 的纯度要求一致） */
export function withParam(
  meta: StackPicksMeta | undefined,
  key: string,
  value: number
): StackPicksMeta {
  const base = meta ?? emptyMeta();
  const spec = paramByKey.get(key);
  if (!spec) return base;
  const clamped = Math.min(spec.max, Math.max(spec.min, value));
  return {
    topology: { ...base.topology },
    params: { ...base.params, [spec.dimId]: { ...(base.params?.[spec.dimId] ?? {}), [spec.key]: clamped } },
  };
}

/** 写一个形态，返回新的 meta */
export function withTopology(
  meta: StackPicksMeta | undefined,
  dimId: string,
  modeId: string
): StackPicksMeta {
  const base = meta ?? emptyMeta();
  return { topology: { ...base.topology, [dimId]: modeId }, params: { ...base.params } };
}

// ─────────────────────────────────────────────────────────────
// 副本数：一切「几个实例」的唯一来源
// ─────────────────────────────────────────────────────────────

/**
 * 应用副本数（只按形态算，不含滑杆覆盖）。
 *
 * 来源顺序：
 *   ① `clustertopology` 维度选中的形态（用户的全局表态，最权威）
 *   ② `web` 维度的形态（只选了 web 形态、没选全局形态时）
 *   ③ 1（没有做任何形态表态）
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

/**
 * 生效的应用副本数 = 滑杆显式值 > 形态算出的值。
 *
 * `deploy.ts` / 容量摘要 / 架构图叠层**全部**走这一个函数。
 * 中间任何一处直接读 `appReplicas()`，滑杆就成了摆设。
 */
export function effectiveAppReplicas(
  picks: Record<string, string>,
  meta?: StackPicksMeta
): number {
  const override = meta?.params?.app?.replicas;
  if (typeof override === 'number' && Number.isFinite(override)) {
    return Math.max(1, Math.round(override));
  }
  return appReplicas(picks, meta);
}

/** 某个数据组件的副本数（没有形态表态就是 1） */
export function componentReplicas(
  dimId: string,
  picks: Record<string, string>,
  meta?: StackPicksMeta
): number {
  const opt = optionOfDim(dimId, picks[dimId]);
  if (!opt) return 1;
  const mode = resolveTopology(dimId, opt, meta);
  return mode ? Math.max(1, mode.replicas) : 1;
}

// ─────────────────────────────────────────────────────────────
// 容量摘要：全部由形态与参数算出来，不写死任何一个数字
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
  /** 副本数的来源：滑杆显式设定（override）或按所选形态推导（topology，V2-12） */
  replicasSource: 'override' | 'topology';
  /** 每个应用实例的 JVM 堆（MB） */
  heapMb: number;
  /** 每实例连接池上限 */
  poolSize: number;
  /** 全站最大数据库连接数 = 应用副本 × 池上限 —— 这是压到库上的真实数字 */
  dbConnections: number;
  /** 应用侧估算内存 = 副本 × (堆 + 512MB 堆外) */
  appMemoryMb: number;
  /** 单实例限流阈值；全站可承受入口 QPS = 阈值 × 副本数 */
  qpsLimit: number;
  totalQps: number;
  /** 分片数（分库分表形态下形态图的格子数） */
  shardCount: number;
  rows: CapacityRow[];
  multiReplica: boolean;
}

const HEAP_DEFAULT = 1024;
const OFF_HEAP = 512;
const POOL_DEFAULT = 20;
const QPS_DEFAULT = 2000;
const SHARD_DEFAULT = 4;

export function estimateCapacity(
  picks: Record<string, string>,
  meta?: StackPicksMeta
): Capacity {
  const replicas = effectiveAppReplicas(picks, meta);
  const heapMb = meta?.params?.app?.heapMb ?? HEAP_DEFAULT;
  const poolSize = meta?.params?.database?.poolSize ?? POOL_DEFAULT;
  const qpsLimit = meta?.params?.app?.qpsLimit ?? QPS_DEFAULT;
  const shardCount = meta?.params?.database?.shardCount ?? SHARD_DEFAULT;

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
    replicasSource: paramIsSet(meta, 'replicas') ? 'override' : 'topology',
    heapMb,
    poolSize,
    dbConnections: replicas * poolSize,
    appMemoryMb: replicas * (heapMb + OFF_HEAP),
    qpsLimit,
    totalQps: replicas * qpsLimit,
    shardCount,
    rows,
    multiReplica: replicas > 1,
  };
}

// ─────────────────────────────────────────────────────────────
// 集群形态图
//
// 这是「形态到底选了什么」的**图形答案**：每个带形态的组件一张卡，
// 卡里按形态 id 画不同的图（1 个框 / 主从两框 / 环形集群 / proxy + N×M 格子），
// 底下写清几个实例。框数一律来自 `resolveTopology()`，与 K8s 清单同源。
// ─────────────────────────────────────────────────────────────

export interface TopologyFigure {
  dimId: string;
  dimName: string;
  optionName: string;
  modeId: string;
  modeLabel: string;
  replicas: number;
  note: string;
  /** 该形态索要的能力（中文名），空数组表示不额外索要 */
  requires: string[];
}

/**
 * 画布叠层的形态覆盖表。
 *
 * `buildTechArch()` 只认每个选项**静态声明**的 `cluster`（写在 architecture.json 的 canvas 段里）。
 * 用户在装配台上把数据库切成「分片」，静态声明不知道这件事 —— 图上就还是那三档老形态。
 *
 * 所以形态表从外面传进去：键是维度 id（外加一个 `app`，指应用卡本身），
 * 值是该维度**当前生效**的形态列表与选中序号。`arch-canvas` 不需要认识
 * `TopologySpec`，它只要一份 `{ name, replicas }[]` —— 依赖边因此只有一条单向的
 * 「页面 → topology → arch-canvas」，没有反向。
 */
export interface NodeTopologyOverride {
  modes: { name: string; replicas: number }[];
  /** 选中的形态序号。画布把它当 `mode` 用 */
  mode: number;
}

export function nodeTopologyMap(
  picks: Record<string, string>,
  meta?: StackPicksMeta
): Record<string, NodeTopologyOverride> {
  const out: Record<string, NodeTopologyOverride> = {};

  for (const dim of topologyDims()) {
    const opt = optionOfDim(dim.id, picks[dim.id]);
    if (!opt || opt.id === 'none') continue;
    const spec = topologySpecOf(dim.id, opt);
    if (!spec) continue;
    const resolved = resolveTopology(dim.id, opt, meta);
    const idx = spec.modes.findIndex((m) => m.id === resolved?.id);
    out[dim.id] = {
      modes: spec.modes.map((m) => ({ name: m.label, replicas: Math.max(1, m.replicas) })),
      mode: idx >= 0 ? idx : 0,
    };
  }

  // 应用卡：它的副本数由 `effectiveAppReplicas()` 决定（滑杆 > 部署形态 > 1）。
  // 画布上的应用卡 id 固定是 `app`，与 `web` 维度不是同一个键。
  const reps = effectiveAppReplicas(picks, meta);
  out.app = {
    modes: [
      { name: '单副本', replicas: 1 },
      { name: '多副本', replicas: reps },
    ],
    mode: reps > 1 ? 1 : 0,
  };

  return out;
}

/** 当前选型下每个带形态的组件落在什么形态上 */
export function topologyFigures(
  picks: Record<string, string>,
  meta?: StackPicksMeta
): TopologyFigure[] {
  const out: TopologyFigure[] = [];
  for (const dim of topologyDims()) {
    const opt = optionOfDim(dim.id, picks[dim.id]);
    if (!opt || opt.id === 'none') continue;
    const mode = resolveTopology(dim.id, opt, meta);
    if (!mode) continue;
    out.push({
      dimId: dim.id,
      dimName: dim.name,
      optionName: opt.name,
      modeId: mode.id,
      modeLabel: mode.label,
      replicas: Math.max(1, mode.replicas),
      note: mode.note ?? '',
      requires: (mode.requires ?? []).map(capLabel),
    });
  }
  return out;
}

export interface TopoPalette {
  bg0: string; bg1: string; grid: string;
  card: string; cardLine: string;
  title: string; sub: string; faint: string;
  accent: string; accentSoft: string; line: string;
}

const TOPO_DARK: TopoPalette = {
  bg0: '#0A0F0E', bg1: '#111A19', grid: 'rgba(255,255,255,0.035)',
  card: '#16211F', cardLine: 'rgba(255,255,255,0.10)',
  title: '#EAF2F0', sub: '#9BAFB0', faint: '#6A7F80',
  accent: '#D9A441', accentSoft: 'rgba(217,164,65,0.14)', line: '#5C7C78',
};
const TOPO_LIGHT: TopoPalette = {
  bg0: '#F6F8F7', bg1: '#EDF2F1', grid: 'rgba(20,40,40,0.045)',
  card: '#FFFFFF', cardLine: 'rgba(20,50,50,0.14)',
  title: '#12211F', sub: '#5B6F6E', faint: '#8A9C9B',
  accent: '#8A6A1F', accentSoft: 'rgba(138,106,31,0.10)', line: '#6B8A86',
};
const TOPO_BLUEPRINT: TopoPalette = {
  bg0: '#0B2447', bg1: '#061A33', grid: 'rgba(255,255,255,0.07)',
  card: 'rgba(10,36,70,0.9)', cardLine: 'rgba(150,220,255,0.42)',
  title: '#EAF6FF', sub: '#9FC8E8', faint: '#7BA6C9',
  accent: '#8FD4FF', accentSoft: 'rgba(143,212,255,0.14)', line: '#8FD4FF',
};

export function topologyPalette(theme: string | undefined): TopoPalette {
  if (theme === 'light' || theme === 'doc') return TOPO_LIGHT;
  if (theme === 'blueprint') return TOPO_BLUEPRINT;
  return TOPO_DARK;
}

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
const MONO = "'Cascadia Code','JetBrains Mono',Consolas,monospace";

const CARD_W = 336;
const CARD_H = 176;
const CARD_GAP = 18;
const PAD = 40;
const HEAD_H = 66;
const FOOT_H = 46;

function rr(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 一个方块（可带小字标签） */
function box(
  x: number, y: number, w: number, h: number, p: TopoPalette,
  label: string, dashed = false, strong = false
): string {
  return (
    `<rect x="${rr(x)}" y="${rr(y)}" width="${rr(w)}" height="${rr(h)}" rx="6" ` +
    `fill="${strong ? p.accentSoft : p.card}" stroke="${strong ? p.accent : p.cardLine}" ` +
    `stroke-width="1"${dashed ? ' stroke-dasharray="4 3"' : ''}/>` +
    (label
      ? `<text x="${rr(x + w / 2)}" y="${rr(y + h / 2 + 4)}" font-family="${FONT}" font-size="10" ` +
        `text-anchor="middle" fill="${strong ? p.accent : p.sub}">${escapeXml(label)}</text>`
      : '')
  );
}

/** 一小截连线（可选箭头） */
function link(
  x1: number, y1: number, x2: number, y2: number, p: TopoPalette, dashed = false, arrow = false
): string {
  return (
    `<path d="M${rr(x1)} ${rr(y1)} L${rr(x2)} ${rr(y2)}" fill="none" stroke="${p.line}" ` +
    `stroke-width="1.3"${dashed ? ' stroke-dasharray="4 3"' : ''}` +
    `${arrow ? ` marker-end="url(#tp-ar)"` : ''}/>`
  );
}

/**
 * 形态图形。**每种形态一张不同的图** —— 形态选择器里那几个迷你图示
 * 就是这套画法的缩小版，两处共用同一段几何，不会出现「选的时候是三个框、
 * 形态图里画成两个」。
 */
export function topologyModeSvg(
  modeId: string,
  replicas: number,
  x: number,
  y: number,
  w: number,
  h: number,
  p: TopoPalette,
  shardCount = 4
): string {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const o: string[] = [];
  const BW = 62;
  const BH = 30;

  const row = (ids: string[], yy: number, strongFirst = false) => {
    const n = ids.length;
    const total = n * BW + (n - 1) * 14;
    let bx = cx - total / 2;
    ids.forEach((label, i) => {
      o.push(box(bx, yy - BH / 2, BW, BH, p, label, false, strongFirst && i === 0));
      if (i < n - 1) o.push(link(bx + BW, yy, bx + BW + 14, yy, p));
      bx += BW + 14;
    });
  };

  switch (modeId) {
    case 'single':
      o.push(box(cx - BW / 2, cy - BH / 2, BW, BH, p, '1 实例', false, true));
      break;

    case 'masterslave':
      o.push(box(cx - 96, cy - 30, 78, 30, p, '主', false, true));
      o.push(box(cx + 18, cy + 4, 78, 30, p, '从', false, true));
      o.push(link(cx - 57 + 39, cy - 15, cx + 57 + 6, cy + 19, p, false, true));
      o.push(
        `<text x="${rr(cx + 46)}" y="${rr(cy - 20)}" font-family="${FONT}" font-size="10" fill="${p.faint}">复制</text>`
      );
      break;

    case 'mgr':
    case 'cluster':
    case 'replicaset':
      // row() 自己往 o 里塞方块与连线，它没有返回值 —— 套一层 o.push 只会塞进一个 undefined，
      // join 时化成空行，于是这几个形态少画方块与连线。typecheck 抓不到（row 返回 void 而
      // o.push 收 string，是 TS2345），目前也没有自动断言守着这几种形态 —— 只有
      // visual/shoot.mjs 的截图矩阵能间接发现（.verify/topology-check.ts 尚未创建）。
      row(['A', 'B', 'C'], cy - 6);
      o.push(
        `<path d="M${rr(cx - 62)} ${rr(cy - 21)} A 62 26 0 0 1 ${rr(cx + 62)} ${rr(cy - 21)}" ` +
        `fill="none" stroke="${p.accent}" stroke-width="1.2" stroke-dasharray="3 3"/>`
      );
      o.push(
        `<text x="${rr(cx)}" y="${rr(cy + 40)}" font-family="${FONT}" font-size="10" ` +
        `text-anchor="middle" fill="${p.faint}">${
          modeId === 'mgr' ? '多数派写 / 自动选主' : '分片副本 / 心跳'
        }</text>`
      );
      break;

    case 'multiaz':
      o.push(box(cx - 138, cy - 26, 108, 52, p, '可用区 A', false, false));
      o.push(box(cx + 30, cy - 26, 108, 52, p, '可用区 B', false, false));
      o.push(link(cx - 30, cy, cx + 30, cy, p, true));
      o.push(
        `<text x="${rr(cx)}" y="${rr(cy - 34)}" font-family="${FONT}" font-size="10" ` +
        `text-anchor="middle" fill="${p.faint}">跨区复制</text>`
      );
      break;

    case 'sharded': {
      const n = Math.max(1, Math.min(shardCount, 64));
      const cols = Math.min(4, n);
      const rows = Math.ceil(n / cols);
      const cw = 26, ch = 18, g = 5;
      const gridW = cols * cw + (cols - 1) * g;
      const gx = cx - gridW / 2 + 26;
      o.push(box(cx - gridW / 2 - 76, cy - 16, 62, 32, p, 'Proxy', false, true));
      for (let i = 0; i < n; i += 1) {
        const r0 = Math.floor(i / cols);
        const c0 = i % cols;
        o.push(box(gx + c0 * (cw + g), cy - (rows * ch + (rows - 1) * g) / 2 + r0 * (ch + g), cw, ch, p, ''));
      }
      o.push(link(cx - gridW / 2 - 14, cy, cx - gridW / 2 + 14, cy, p, false, true));
      o.push(
        `<text x="${rr(cx + 12)}" y="${rr(cy - (rows * ch) / 2 - 8)}" font-family="${MONO}" ` +
        `font-size="10" fill="${p.accent}">${n} 片</text>`
      );
      break;
    }

    case 'cloudnative':
      row(['T', 'T', 'T'], cy - 14);
      o.push(box(cx - 108, cy + 16, 216, 20, p, '共享存储 / 分布式事务', false, false));
      break;

    case 'multilevel':
      o.push(box(cx - 96, cy - 38, 76, 26, p, 'L1 本地', false, true));
      o.push(box(cx + 20, cy - 38, 76, 26, p, 'L2 分布式', false, true));
      o.push(box(cx - 38, cy + 10, 76, 26, p, '数据库', false, false));
      o.push(link(cx - 20, cy - 12, cx - 12, cy + 10, p, false, true));
      o.push(link(cx + 34, cy - 12, cx + 10, cy + 10, p, false, true));
      break;

    case 'tiered': {
      const bands = ['热数据', '温数据', '冷数据'];
      bands.forEach((b, i) => {
        o.push(box(cx - 108, cy - 42 + i * 28, 216, 22, p, b, i > 0, i === 0));
      });
      break;
    }

    case 'multi': {
      const n = Math.max(2, Math.min(replicas, 5));
      for (let i = n - 1; i >= 0; i -= 1) {
        o.push(box(cx - 84 + i * 10, cy - 14 - i * 8, 96, 28, p, i === 0 ? '应用' : '', false, i === 0));
      }
      break;
    }

    case 'canary':
      o.push(box(cx - 112, cy - 18, 96, 36, p, '稳定版', false, true));
      o.push(box(cx + 16, cy - 18, 96, 36, p, '灰度版', true, false));
      o.push(
        `<text x="${rr(cx + 64)}" y="${rr(cy + 36)}" font-family="${FONT}" font-size="10" ` +
        `text-anchor="middle" fill="${p.faint}">按比例导流</text>`
      );
      break;

    default: {
      const n = Math.max(1, Math.min(replicas, 5));
      const ids = Array.from({ length: n }, (_, i) => `${i + 1}`);
      row(ids, cy, true);
      break;
    }
  }
  return o.join('');
}

export interface TopologySvgOptions {
  /** 与架构图同一套主题词，便于两图并排贴进同一份文档 */
  theme?: 'dark' | 'light' | 'doc' | 'slide' | 'blueprint';
  columns?: number;
  title?: string;
  subtitle?: string;
}

export interface BuiltTopologySvg {
  svg: string;
  width: number;
  height: number;
  figures: TopologyFigure[];
  /** 应用自身也在这张图里 —— 它不是「带形态的组件」，但它的副本数也是形态算出来的 */
  appReplicas: number;
}

/**
 * 集群形态图。
 *
 * 与 `buildTechArchSvg` 并列的第二张交付图：架构图回答「有哪些组件」，
 * 形态图回答「每个组件有几个、怎么摆」。两张图共用一套主题词，
 * 并排贴进文档不会一个白底一个黑底。
 */
export function buildTopologySvg(
  picks: Record<string, string>,
  meta?: StackPicksMeta,
  opts: TopologySvgOptions = {}
): BuiltTopologySvg {
  const p = topologyPalette(opts.theme);
  const figures = topologyFigures(picks, meta);
  const replicas = effectiveAppReplicas(picks, meta);
  const cols = Math.max(1, Math.min(opts.columns ?? (figures.length > 1 ? 2 : 1), 3));

  // 应用自身永远画在最前面：它就是「副本数」这个词的本来主语
  const cards: { title: string; chip: string; modeId: string; reps: number; note: string; extra: string }[] = [
    {
      title: '应用服务',
      chip: replicas > 1 ? `多副本 ×${replicas}` : '单副本',
      // 画法与副本数必须同一个判据：只选了 web 的形态（没选全局部署形态）时
      // 副本数来自 web，图上也得画成多副本，不能拿 clustertopology 是否表态当条件。
      modeId: replicas > 1 ? 'multi' : 'single',
      reps: replicas,
      note: picks.clustertopology ? '随部署形态' : '未做部署形态表态',
      extra: '',
    },
    ...figures.map((f) => ({
      title: `${f.dimName} · ${f.optionName}`,
      chip: f.modeLabel,
      modeId: f.modeId,
      reps: f.replicas,
      note: f.note,
      extra: f.requires.length ? `需 ${f.requires.join(' / ')}` : '',
    })),
  ];

  const rows = Math.ceil(cards.length / cols);
  const W = PAD * 2 + cols * CARD_W + (cols - 1) * CARD_GAP;
  const H = HEAD_H + rows * CARD_H + (rows - 1) * CARD_GAP + FOOT_H;
  const title = opts.title ?? '集群形态图';
  const subtitle = opts.subtitle ?? '每个组件几个实例、怎么摆 —— 框数就是清单里的副本数';

  const o: string[] = [];
  o.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ` +
    `role="img" aria-label="${escapeXml(title)}">`
  );
  o.push(
    `<defs>` +
    `<linearGradient id="tp-bg" x1="0" y1="0" x2="0.7" y2="1">` +
    `<stop offset="0" stop-color="${p.bg0}"/><stop offset="1" stop-color="${p.bg1}"/></linearGradient>` +
    `<pattern id="tp-grid" width="26" height="26" patternUnits="userSpaceOnUse">` +
    `<path d="M26 0H0V26" fill="none" stroke="${p.grid}" stroke-width="1"/></pattern>` +
    `<marker id="tp-ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
    `<path d="M0 0 10 5 0 10 z" fill="${p.line}"/></marker>` +
    `</defs>`
  );
  o.push(`<rect width="${W}" height="${H}" fill="url(#tp-bg)"/>`);
  o.push(`<rect width="${W}" height="${H}" fill="url(#tp-grid)"/>`);

  o.push(
    `<text x="${PAD}" y="34" font-family="${FONT}" font-size="18" font-weight="700" fill="${p.title}">${escapeXml(title)}</text>`
  );
  o.push(
    `<text x="${PAD}" y="52" font-family="${FONT}" font-size="11.5" fill="${p.sub}">${escapeXml(subtitle)}</text>`
  );
  o.push(
    `<rect x="${W - 196}" y="20" width="166" height="24" rx="7" fill="${p.accentSoft}" stroke="${p.cardLine}"/>` +
    `<text x="${W - 113}" y="36" text-anchor="middle" font-family="${MONO}" font-size="10" ` +
    `fill="${p.faint}" letter-spacing="0.8">杨先生的军火库 · arsenal</text>`
  );

  cards.forEach((c, i) => {
    const r0 = Math.floor(i / cols);
    const c0 = i % cols;
    const x = PAD + c0 * (CARD_W + CARD_GAP);
    const y = HEAD_H + r0 * (CARD_H + CARD_GAP);

    o.push(
      `<rect x="${rr(x)}" y="${rr(y)}" width="${CARD_W}" height="${CARD_H}" rx="12" ` +
      `fill="${p.card}" stroke="${p.cardLine}" stroke-width="1"/>`
    );
    o.push(`<rect x="${rr(x)}" y="${rr(y)}" width="${CARD_W}" height="3" rx="1.5" fill="${p.accent}" opacity="0.85"/>`);
    o.push(
      `<text x="${rr(x + 16)}" y="${rr(y + 28)}" font-family="${FONT}" font-size="12.5" font-weight="650" ` +
      `fill="${p.title}">${escapeXml(clip(c.title, 22))}</text>`
    );
    o.push(
      `<rect x="${rr(x + CARD_W - 16 - (c.chip.length * 11 + 16))}" y="${rr(y + 15)}" ` +
      `width="${rr(c.chip.length * 11 + 16)}" height="18" rx="9" fill="${p.accentSoft}" stroke="${p.accent}" stroke-opacity="0.4"/>` +
      `<text x="${rr(x + CARD_W - 16 - (c.chip.length * 11 + 16) / 2)}" y="${rr(y + 28)}" text-anchor="middle" ` +
      `font-family="${FONT}" font-size="10" fill="${p.accent}">${escapeXml(c.chip)}</text>`
    );

    const fx = x + 16;
    const fy = y + 42;
    const fw = CARD_W - 32;
    const fh = CARD_H - 42 - 40;
    o.push(
      `<rect x="${rr(fx)}" y="${rr(fy)}" width="${rr(fw)}" height="${rr(fh)}" rx="8" ` +
      `fill="none" stroke="${p.grid}" stroke-width="1"/>`
    );
    o.push(topologyModeSvg(c.modeId, c.reps, fx, fy, fw, fh, p, paramValue(meta, 'shardCount')));

    const line2 = [c.note, c.extra].filter(Boolean).join(' · ');
    o.push(
      `<text x="${rr(x + 16)}" y="${rr(y + CARD_H - 22)}" font-family="${MONO}" font-size="11" ` +
      `font-weight="700" fill="${p.accent}">×${c.reps}</text>` +
      `<text x="${rr(x + 16 + 34)}" y="${rr(y + CARD_H - 22)}" font-family="${FONT}" font-size="10" ` +
      `fill="${p.faint}">${escapeXml(clip(line2, 42))}</text>`
    );
  });

  // 页脚：符号不解释，读图的人就得猜
  {
    const fy = H - FOOT_H;
    const ly = fy + FOOT_H / 2;
    o.push(`<line x1="0" y1="${rr(fy)}" x2="${W}" y2="${rr(fy)}" stroke="${p.cardLine}" stroke-width="1"/>`);
    o.push(
      `<g font-family="${FONT}" font-size="10" fill="${p.faint}">` +
      `<text x="${PAD}" y="${rr(ly + 4)}">实线 = 复制 / 数据流向</text>` +
      `<text x="${PAD + 190}" y="${rr(ly + 4)}">虚线 = 跨区 / 灰度</text>` +
      `<text x="${PAD + 380}" y="${rr(ly + 4)}">网格 = 分片数（滑杆可调）</text>` +
      `<text x="${PAD + 620}" y="${rr(ly + 4)}">共 ${figures.length} 个组件带形态表态</text>` +
      `</g>` +
      `<text x="${W - PAD}" y="${rr(ly + 4)}" text-anchor="end" font-family="${MONO}" font-size="10" ` +
      `fill="${p.faint}" letter-spacing="0.8">杨先生的军火库 · arsenal</text>`
    );
  }

  o.push(`</svg>`);
  return { svg: o.join('\n'), width: W, height: H, figures, appReplicas: replicas };
}

/** 按像素宽度裁字：CJK 算 1em，ASCII 算 0.55em */
function clip(s: string, maxUnits: number): string {
  let used = 0;
  let out = '';
  for (const ch of s) {
    const w = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? 1 : 0.55;
    if (used + w > maxUnits) return `${out}…`;
    used += w;
    out += ch;
  }
  return out;
}
