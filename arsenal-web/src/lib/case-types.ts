/**
 * 场景案例库（arsenal-cases）的类型。
 *
 * 与 arsenal-cookbook 的分工（这句要一直留着，否则会有人问「为什么有两套」）：
 *   cookbook 回答「一个功能标准该怎么写」—— 无参数，直接看。
 *   cases    回答「在这些约束下该怎么设计」—— 选场景 + 调参数。
 */

/** 驱动参数的一个离散档位 */
export interface DriverLevel {
  id: string;
  label: string;
  value?: number;
  note?: string;
}

/** 驱动参数：并发量 / 数据规模 / 读写比 / 一致性 / P99 / 增长预期 */
export interface Driver {
  id: string;
  name: string;
  unit?: string;
  hint?: string;
  levels: DriverLevel[];
}

/** 代码切片里的一条要点。mark 是**代码片段锚点**，不是行号 */
export interface SliceHighlight {
  mark: string;
  title: string;
  text: string;
  rule?: string;
}

/** 一个设计决策：问什么、有哪些选项、选了什么、代价是什么 */
export interface SliceDecision {
  question: string;
  options: string[];
  chosen: string;
  tradeoff: string;
}

/** 条件化代码切片 */
export interface CaseSlice {
  id: string;
  order: number;
  goal: string;
  layer: string;
  /** 命中条件：driver id → 允许的档位 id 列表。空对象 = 恒真 */
  when: Record<string, string[]>;
  why: string;
  decision: SliceDecision;
  sql: string;
  code: string;
  highlights: SliceHighlight[];
  pitfalls: string[];
  notSuitable: string[];
  relatedRules: string[];
  refs: { title: string; url?: string; note?: string }[];
}

export interface ArchNode {
  id: string;
  label: string;
  kind: string;
  tier: number;
  whenAny?: Record<string, string[]>;
}

export interface ArchLink {
  from: string;
  to: string;
  label: string;
}

/** 参数组合本身的矛盾。命中即在页面顶部标黄 —— 让人尽早改需求，而不是拿到一套注定达标的方案 */
export interface CaseConflict {
  when: Record<string, string[]>;
  text: string;
}

export interface CaseDef {
  id: string;
  order: number;
  name: string;
  subtitle: string;
  glyph: string;
  domain: string[];
  problem: string;
  symptoms: string[];
  drivers: Driver[];
  conflicts: CaseConflict[];
  slices: CaseSlice[];
  notSuitableFor: { when: Record<string, string[]>; reason: string }[];
  benchmark: {
    title: string;
    columns: string[];
    rows: string[][];
    conclusion: string;
  };
  architecture: { nodes: ArchNode[]; links: ArchLink[] };
  sliceCount?: number;
  driverCount?: number;
  ruleCount?: number;
  lines?: number;
}

export interface CasesDoc {
  meta: {
    collection: string;
    name: string;
    version: string;
    releasedAt: string;
    description: string;
    order: string[];
    count: number;
  };
  cases: CaseDef[];
}

/** driver id → level id */
export type CaseParams = Record<string, string>;

export interface SlicePlan {
  slice: CaseSlice;
  /** 命中的原因，用于页面展示「为什么这一条被激活」 */
  matched: { driverId: string; driverName: string; levelLabel: string }[];
}

export interface InactiveSlice {
  slice: CaseSlice;
  /** 必须给出可核对的原因，例如「该切片要求 数据规模 ∈ {1亿,10亿,100亿}，当前 1000万」 */
  reason: string;
}

export interface DecisionSummary {
  sliceId: string;
  sliceGoal: string;
  question: string;
  chosen: string;
  tradeoff: string;
}

export interface CasePlan {
  kase: CaseDef;
  params: CaseParams;
  /** 参数组合本身的矛盾 / 本场景不适用 —— 页面顶部标黄 */
  warnings: string[];
  activeSlices: SlicePlan[];
  /** 未命中的切片。绝不静默省略：读者必须知道「这个参数下不需要做」还是「不能做」 */
  inactiveSlices: InactiveSlice[];
  decisions: DecisionSummary[];
  rules: string[];
  architecture: { nodes: ArchNode[]; links: ArchLink[] };
}
