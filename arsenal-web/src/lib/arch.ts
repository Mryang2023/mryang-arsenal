import archRaw from '@/generated/architecture.json';
import { dimensions } from './stack';
import type { StackPicks } from './content-types';

/**
 * 架构装配图与可运行性校验。
 *
 * 这一层只回答一个问题：**把这套零件拼起来，能跑起来吗？**
 *
 * 判断方式不是一串 if，而是能力供需：
 *   每个选项声明 provides（装上去之后系统多出什么能力）
 *                   requires（要向系统索要什么能力）
 *   把所有已选项的 provides 求并集，再逐条检查 requires 是否被覆盖。
 *   没被覆盖的部分就是缺的零件。
 *
 * 这样「缺什么」是算出来的。将来新增一个中间件，只要声明它提供什么、需要什么，
 * 校验逻辑一行都不用改。
 */

// ─────────────────────────────────────────────────────────────
// 类型
// ─────────────────────────────────────────────────────────────

export interface ArchLane {
  id: string;
  name: string;
  glyph: string;
  desc: string;
}

export interface ArchNode {
  lane: string;
  icon: string;
  /** 这一块在架构里承担的角色，显示在方块上 */
  role: string;
  /** 缺了它项目起不来 / 编译不过 —— 「跑不起来」的唯一来源 */
  required?: boolean;
  /** 缺了能跑，但架构不完整 */
  recommended?: boolean;
  /** 缺它时的具体后果，直接显示给用户 */
  missing?: string;
}

export interface CapSpec {
  provides?: string[];
  requires?: string[];
}

export type PolicyLevel = 'blocker' | 'risk' | 'note';

export interface ArchPolicy {
  id: string;
  level: PolicyLevel;
  /** 声明式命中条件：维度 → 命中任一选项即可；多个维度之间是「与」 */
  when: Record<string, string[]>;
  /** 命中后需要高亮的槽位 */
  nodes?: string[];
  title: string;
  text: string;
  fix?: string;
}

/**
 * 隐患详情 —— 与策略分开存放。
 *
 * 策略回答「什么时候命中」，详情回答「命中了说明会发生什么」。
 * 三者缺一不可：只说 trigger 是算命，只说 symptoms 是猜谜，
 * 配上 impact 才能判断要不要现在处理。
 */
export interface PolicyDetail {
  /** 什么条件下它才会发生 —— 不是所有组合都成立 */
  trigger?: string;
  /** 发生时能在哪看到什么。写不出可核对现象的不该当隐患报 */
  symptoms?: string[];
  /** 不处理的后果边界 */
  impact?: string;
}

export interface Architecture {
  lanes: ArchLane[];
  capNames: Record<string, string>;
  nodes: Record<string, ArchNode>;
  options: Record<string, Record<string, CapSpec>>;
  pipelines: Record<string, string[]>;
  policies: ArchPolicy[];
  policyDetail: Record<string, PolicyDetail>;
  presetNotes: Record<string, string>;
}

export const arch = archRaw as unknown as Architecture;

export const lanes: ArchLane[] = arch.lanes;
export const nodeArch: Record<string, ArchNode> = arch.nodes;
export const capNames: Record<string, string> = arch.capNames;

/** 槽位在画布上的落位：泳道 → 该泳道内的槽位（按流水线顺序） */
export interface LaneSlot {
  dimId: string;
  lane: ArchLane;
  node: ArchNode;
  /** 该泳道是否有层内流水线，若有则块之间画箭头 */
  inPipeline: boolean;
}

export function slotsOfLane(laneId: string): string[] {
  const order = arch.pipelines[laneId];
  const members = dimensions
    .filter((d) => nodeArch[d.id]?.lane === laneId)
    .map((d) => d.id);
  if (!order) return members;
  // 有流水线定义时按流水线顺序，未登记的兜底追加在后面（不应发生）
  return [...order.filter((id) => members.includes(id)),
          ...members.filter((id) => !order.includes(id))];
}

/** 每个能力可能由哪些槽位提供，用于判断「缺口」该归因到哪里 */
const capProviders = new Map<string, Set<string>>();
for (const [dim, opts] of Object.entries(arch.options)) {
  for (const spec of Object.values(opts)) {
    for (const cap of spec.provides ?? []) {
      if (!capProviders.has(cap)) capProviders.set(cap, new Set());
      capProviders.get(cap)!.add(dim);
    }
  }
}

/** 某个选项提供了哪些能力（画在方块上） */
export function capsOf(dimId: string, optId: string): string[] {
  return arch.options[dimId]?.[optId]?.provides ?? [];
}

/** 某个选项索要哪些能力 */
export function needsOf(dimId: string, optId: string): string[] {
  return arch.options[dimId]?.[optId]?.requires ?? [];
}

export function capLabel(cap: string): string {
  return capNames[cap] ?? cap.replace(/^cap\./, '');
}

// ─────────────────────────────────────────────────────────────
// 校验结果
// ─────────────────────────────────────────────────────────────

export type SlotState =
  | 'filled'               // 已选
  | 'missing-required'     // 必选未选 —— 跑不起来
  | 'missing-recommended'  // 建议项未选
  | 'empty'                // 可选未选
  | 'conflict';            // 已选，但参与某个组合隐患

export interface ArchGap {
  /** 归因到哪个槽位（用于点击定位） */
  dim: string;
  title: string;
  detail: string;
  fix?: string;
  /** 需要高亮的槽位 */
  nodes: string[];
  /** 被同一条结论顺带解释掉的能力缺口，避免重复报同一件事 */
  consequences?: string[];
  /** 触发条件（来自隐患详情） */
  trigger?: string;
  /** 发生时能看到的现象 —— 界面与导出清单里都是最有用的部分 */
  symptoms?: string[];
  /** 后果边界 */
  impact?: string;
}

export type ArchStatus = 'broken' | 'incomplete' | 'runnable';

export interface ArchAudit {
  status: ArchStatus;
  /** 跑不起来 */
  blockers: ArchGap[];
  /** 能跑，但会出事 */
  risks: ArchGap[];
  /** 知道就好 */
  notes: ArchGap[];
  /** 建议补齐（非必需槽位空缺） */
  gaps: ArchGap[];
  slotStates: Record<string, SlotState>;
  /** 当前组合提供的全部能力 */
  providedCaps: string[];
  /** 被索要却无人提供的能力 */
  unmetCaps: string[];
  stats: {
    filled: number;
    total: number;
    requiredFilled: number;
    requiredTotal: number;
    optionalFilled: number;
    optionalTotal: number;
    deps: number;
  };
}

function optionOfDim(dimId: string, picks: StackPicks): string | undefined {
  const v = picks[dimId];
  return v && v.length > 0 ? v : undefined;
}

function matchPolicy(policy: ArchPolicy, picks: StackPicks): boolean {
  const entries = Object.entries(policy.when ?? {});
  if (!entries.length) return false;
  return entries.every(([dim, opts]) => {
    const picked = optionOfDim(dim, picks);
    return picked !== undefined && opts.includes(picked);
  });
}

/**
 * 主校验函数：纯函数，无副作用。
 *
 * 结论分三档，这是刻意的：
 *   broken      缺必需模块 / 必需能力无人提供 / 存在硬冲突 → 跑不起来
 *   incomplete  能跑，但缺了建议补齐的件
 *   runnable    零件齐、能力闭环、无冲突
 */
export function auditArchitecture(picks: StackPicks): ArchAudit {
  const blockers: ArchGap[] = [];
  const risks: ArchGap[] = [];
  const notes: ArchGap[] = [];
  const gaps: ArchGap[] = [];
  const slotStates: Record<string, SlotState> = {};

  // ── ① 收集已选项与它们提供的能力 ──────────────────────────
  const provided = new Set<string>();
  const filledDims: string[] = [];
  const filledOptions: { dimId: string; optId: string }[] = [];

  for (const dim of dimensions) {
    const optId = optionOfDim(dim.id, picks);
    if (!optId) continue;
    const spec = arch.options[dim.id]?.[optId];
    if (!spec) {
      // 数据缺失（理论上构建期已拦住）—— 不能静默当成没问题
      slotStates[dim.id] = 'filled';
      continue;
    }
    filledDims.push(dim.id);
    filledOptions.push({ dimId: dim.id, optId });
    for (const cap of spec.provides ?? []) provided.add(cap);
  }

  // ── ② 空槽位 ─────────────────────────────────────────────
  const missingRequired = new Set<string>();
  for (const dim of dimensions) {
    const node = nodeArch[dim.id];
    if (!node) continue;
    if (optionOfDim(dim.id, picks)) continue;

    if (node.required) {
      missingRequired.add(dim.id);
      slotStates[dim.id] = 'missing-required';
      blockers.push({
        dim: dim.id,
        title: `缺少「${dim.name}」`,
        detail: node.missing ?? '这一块是必需的，缺它项目起不来。',
        nodes: [dim.id],
      });
    } else if (node.recommended) {
      slotStates[dim.id] = 'missing-recommended';
      gaps.push({
        dim: dim.id,
        title: `建议补上「${dim.name}」`,
        detail: node.missing ?? '缺它能跑，但架构不完整。',
        nodes: [dim.id],
      });
    } else {
      slotStates[dim.id] = 'empty';
    }
  }

  // ── ③ 能力缺口 ───────────────────────────────────────────
  // 归因规则：若某个缺口所需的提供者恰好全是「已报为缺失的必需槽位」，
  // 那就不是新问题，而是同一件事的下游后果 —— 归并进那条结论里。
  const unmet = new Map<string, string[]>();
  for (const f of filledOptions) {
    for (const cap of needsOf(f.dimId, f.optId)) {
      if (provided.has(cap)) continue;
      if (!unmet.has(cap)) unmet.set(cap, []);
      if (!unmet.get(cap)!.includes(f.dimId)) unmet.get(cap)!.push(f.dimId);
    }
  }

  const dimName = (id: string) => dimensions.find((d) => d.id === id)?.name ?? id;
  const blockerByDim = new Map(blockers.map((b) => [b.dim, b]));
  const unmetCaps: string[] = [];

  for (const [cap, needers] of unmet) {
    const providers = capProviders.get(cap) ?? new Set<string>();
    const explained =
      providers.size > 0 &&
      [...providers].every((p) => missingRequired.has(p)) &&
      providers.size === 1;

    if (explained) {
      const owner = [...providers][0];
      const target = blockerByDim.get(owner);
      if (target) {
        if (!target.consequences) target.consequences = [];
        target.consequences.push(
          `${needers.map(dimName).join('、')} 因此拿不到「${capLabel(cap)}」`
        );
        continue;
      }
    }

    unmetCaps.push(cap);
    blockers.push({
      dim: needers[0],
      title: `「${capLabel(cap)}」无人提供`,
      detail:
        `${needers.map(dimName).join('、')} 需要「${capLabel(cap)}」才能工作，` +
        '但当前选择里没有任何零件能提供它。',
      nodes: needers,
    });
  }

  // ── ④ 组合策略 ───────────────────────────────────────────
  for (const policy of arch.policies) {
    if (!matchPolicy(policy, picks)) continue;
    // 详情与策略分开存，这里合起来 —— 一条隐患卡片需要同时用到两边
    const detail = arch.policyDetail?.[policy.id];
    const gap: ArchGap = {
      dim: (policy.nodes ?? [])[0] ?? '',
      title: policy.title,
      detail: policy.text,
      fix: policy.fix,
      nodes: policy.nodes ?? [],
      trigger: detail?.trigger,
      symptoms: detail?.symptoms,
      impact: detail?.impact,
    };
    if (policy.level === 'blocker') blockers.push(gap);
    else if (policy.level === 'risk') risks.push(gap);
    else notes.push(gap);
  }

  // ── ⑤ 槽位状态：参与隐患的块要标出来 ──────────────────────
  const hot = new Set<string>();
  for (const g of [...blockers, ...risks, ...notes]) {
    for (const n of g.nodes) hot.add(n);
  }
  for (const dim of dimensions) {
    const st = slotStates[dim.id];
    if (st && st !== 'filled') continue;
    slotStates[dim.id] = hot.has(dim.id) ? 'conflict' : filledDims.includes(dim.id) ? 'filled' : (st ?? 'empty');
  }

  // ── ⑥ 统计 ───────────────────────────────────────────────
  const requiredDims = dimensions.filter((d) => nodeArch[d.id]?.required);
  const optionalDims = dimensions.filter((d) => !nodeArch[d.id]?.required);
  const isFilled = (id: string) => filledDims.includes(id);

  let status: ArchStatus = 'runnable';
  if (blockers.length) status = 'broken';
  else if (gaps.length) status = 'incomplete';

  return {
    status,
    blockers,
    risks,
    notes,
    gaps,
    slotStates,
    providedCaps: [...provided],
    unmetCaps,
    stats: {
      filled: filledDims.length,
      total: dimensions.length,
      requiredFilled: requiredDims.filter((d) => isFilled(d.id)).length,
      requiredTotal: requiredDims.length,
      optionalFilled: optionalDims.filter((d) => isFilled(d.id)).length,
      optionalTotal: optionalDims.length,
      deps: filledOptions.length,
    },
  };
}

/**
 * 只保留必选槽位的骨架 —— 「先把能跑的最小骨架立起来」的起点。
 * 空画布（全不选）用 stack.ts 的 emptyPicks()。
 */
export function skeletonPicks(): StackPicks {
  const picks: StackPicks = {};
  for (const dim of dimensions) {
    const node = nodeArch[dim.id];
    picks[dim.id] = node?.required ? dim.defaultOption : '';
  }
  return picks;
}

export const STATUS_META: Record<ArchStatus, { label: string; tone: 'ok' | 'warn' | 'bad'; summary: string }> = {
  runnable: {
    label: '可以跑起来',
    tone: 'ok',
    summary: '必选模块齐全，能力闭环，未发现组合冲突。',
  },
  incomplete: {
    label: '能跑，但零件不全',
    tone: 'warn',
    summary: '不影响启动，但有几块建议补上，否则运行起来会缺能力。',
  },
  broken: {
    label: '跑不起来',
    tone: 'bad',
    summary: '缺了必需模块或有能力无人提供 —— 这样的组合启动就会失败。',
  },
};
