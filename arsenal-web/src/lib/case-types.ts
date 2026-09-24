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

/**
 * 互斥声明：某些 driver 的不同档位代表「两条互斥的技术路线」，
 * 使部分切片在数学上不可能同时激活（JDK 17 与 21、组合过滤与聚合下钻）。
 *
 * 为什么要显式声明：不声明的话，「最多只能激活 5/6」这个现象
 * 与「有切片永远不激活（死代码）」在外部看起来一模一样。
 * 声明之后就分得开了 —— 而且它本身对读者有价值：
 * 它说明「你得先在这些路线里选一条」。
 */
export interface ExclusiveGroup {
  drivers: string[];
  note: string;
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
  /** 使「全激活」不可能成立的互斥 driver。空/缺省表示本场景可以全激活 */
  exclusiveGroups?: ExclusiveGroup[];
  notSuitableFor: { when: Record<string, string[]>; reason: string }[];
  /**
   * 性能 / 量级对照。**可选** —— 只有给出了可核口径的场景才写。
   *
   * 为什么必须是可选：7 个场景里只有 3 个有实测口径（huge-rowcount-rdb / genomic-sequence-store / multi-source-ingestion）。
   * 当初这里写成必填，类型就对数据撒了谎，`CaseLab` 于是无守卫直读 `benchmark.title` ——
   * 默认场景恰好有数据，静态预渲染与 45 张视觉断言全绿，用户点到第 3 个场景才白屏。
   * 「类型许诺了数据没有的东西」比「少一个字段」危险得多，因为它让 tsc 闭上嘴。
   *
   * 消费侧一律用 `kase.benchmark ? … : 空态`，不许 `!` 断言、不许编数字。
   */
  benchmark?: {
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
