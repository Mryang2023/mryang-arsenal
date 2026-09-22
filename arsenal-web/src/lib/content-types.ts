/**
 * 最佳实践案例库（arsenal-cookbook）与技术选型台（arsenal-stacks）的类型定义。
 *
 * 与 types.ts 分开的原因是两者的生命周期不同：
 * 规则集是长期稳定的资产，案例与选型会随技术栈演进而频繁增补。
 */

// ─────────────────────────────────────────────────────────────
// 最佳实践案例库
// ─────────────────────────────────────────────────────────────

/** 代码在系统中的位置。决定展示配色与分组。 */
export type CodeLayer =
  | 'client' | 'web' | 'dto-in' | 'dto-out' | 'service' | 'repo' | 'domain'
  | 'exception' | 'common' | 'config' | 'structure' | 'sql' | 'test'
  | 'concurrency' | 'integration';

/**
 * 一条要点备注。
 *
 * mark 是「片段锚点」——一段必然出现在代码里的原文。
 * 刻意不用行号：代码一改行号就错位，而错位的备注会给出自信的错误结论。
 * 锚点找不到目标时同步脚本直接构建失败，不会静默降级。
 */
export interface Highlight {
  mark: string;
  title: string;
  text: string;
  /** 关联的规则 ID，可跳转到规则详情 */
  rule?: string;
}

export interface FeatureFile {
  id: string;
  path: string;
  layer: CodeLayer;
  lang: string;
  /** 这个文件在整体中承担什么职责 */
  role: string;
  code: string;
  highlights: Highlight[];
}

export interface FlowStep {
  layer: CodeLayer;
  step: string;
  detail: string;
}

export interface FeatureMatrix {
  title: string;
  columns: string[];
  rows: string[][];
  notes: string[];
}

/**
 * 性能 / 量级对照表。
 *
 * 刻意用「列 + 行」而不是一个自由字符串：案例库里的性能说明必须是可核对的，
 * 只给结论不给口径的段落，读者无法判断它是否适用于自己的场景。
 */
export interface FeaturePerformance {
  title: string;
  columns: string[];
  rows: string[][];
  /** 这张表说明了什么。只给表格不给判断，读者没法决策。 */
  conclusion: string;
}

/**
 * 参考出处。
 *
 * 与规则集的 sources 同一套立场：无出处不收录。
 * url 与 note 至少要有一个 —— 标题后面什么都不挂，等于没有出处。
 */
export interface FeatureReference {
  title: string;
  url?: string;
  note?: string;
}

export interface Feature {
  id: string;
  order: number;
  name: string;
  subtitle: string;
  glyph: string;
  level: string;
  scenario: string;
  intent: string;
  tags: string[];
  relatedRules: string[];
  flow: FlowStep[];
  packages: string[];
  files: FeatureFile[];
  matrix?: FeatureMatrix;
  checklist: string[];
  pitfalls: string[];
  /** 什么时候**不要**用这套写法。案例只有划清边界才敢被当成蓝本复制。 */
  notSuitable: string[];
  /** 性能 / 量级对照，非必填 */
  performance?: FeaturePerformance;
  /** 权威出处，至少两条 */
  references: FeatureReference[];
  /** 由同步脚本注入 */
  fileCount: number;
  highlightCount: number;
  ruleCount: number;
  lines: number;
}

export interface Cookbook {
  meta: {
    collection: string;
    name: string;
    version: string;
    releasedAt: string;
    description: string;
    order: string[];
    count: number;
  };
  features: Feature[];
}

// ─────────────────────────────────────────────────────────────
// 技术选型台
// ─────────────────────────────────────────────────────────────

export interface Dependency {
  groupId: string;
  artifactId: string;
  version?: string;
  scope?: string;
  /** 非 Maven 依赖（如 Gradle 插件）用这个标记 */
  kind?: string;
  note?: string;
}

export interface ConfigClass {
  className: string;
  path: string;
  code: string;
}

export interface Sample {
  title: string;
  lang: string;
  code: string;
}

export interface StackOption {
  id: string;
  name: string;
  badge?: string;
  summary: string;
  dependencies?: Dependency[];
  pomProperties?: Record<string, string>;
  yaml?: string;
  configClasses?: ConfigClass[];
  sample?: Sample;
  /** 运维动作：要装什么、要建什么 */
  ops?: string[];
  /** 需要的环境变量 */
  env?: { key: string; desc: string }[];
  notes?: string[];
  pitfalls?: string[];
  /**
   * 集群形态表（数据来自 arsenal-stacks/stack.json）。
   * 类型定义在 topology.ts —— 那边要用它算副本数，放这里是循环依赖。
   */
  topology?: unknown;
  /** 该选项的默认形态 id。不选时用它，而不是形态表的第一项 */
  topologyDefault?: string;
}

export interface StackDimension {
  id: string;
  groupId: string;
  name: string;
  why: string;
  defaultOption: string;
  options: StackOption[];
  /** 维度级形态表：这个组件不区分具体产品时（MySQL 与 PostgreSQL 都能做主从）挂在这里 */
  topology?: unknown;
}

export interface StackGroup {
  id: string;
  name: string;
  glyph: string;
  desc: string;
}

export interface Preset {
  id: string;
  name: string;
  badge: string;
  summary: string;
  picks: Record<string, string>;
}

export interface Stack {
  collection: string;
  name: string;
  version: string;
  releasedAt: string;
  description: string;
  groups: StackGroup[];
  dimensions: StackDimension[];
  presets: Preset[];
}

/** 当前选择：维度 id → 选项 id */
export type StackPicks = Record<string, string>;

/** 合成产物 */
export interface ComposedStack {
  dependencies: Dependency[];
  properties: Record<string, string>;
  yamlBlocks: { dimName: string; optName: string; body: string }[];
  configClasses: (ConfigClass & { dimName: string; optName: string })[];
  samples: (Sample & { dimName: string; optName: string; layer: CodeLayer })[];
  ops: { dimName: string; optName: string; items: string[] }[];
  env: { key: string; desc: string; dimName: string; optName: string }[];
  notes: { dimName: string; optName: string; items: string[] }[];
  pitfalls: { dimName: string; optName: string; items: string[] }[];
  selected: { dimension: StackDimension; option: StackOption }[];
}

// ── 图标资产库 ──────────────────────────────────────────────
export interface IconCategory {
  id: string;
  name: string;
  accent: string;
  desc: string;
}

/**
 * 一条图标登记。
 *
 * `vector` 指向 tech-icons.ts 的 key（架构图用）；`bitmap` 是 public/icons 下
 * 的相对路径（展示用）。**bitmap 允许为空** —— 位图是分批补的，登记先于产出，
 * 空值表示「这张还没画」，不是「这条数据坏了」。
 */
export interface IconAsset {
  key: string;
  name: string;
  en: string;
  category: string;
  tags: string[];
  vector: string;
  bitmap: string;
  subject: string;
}

export interface IconLibrary {
  collection: string;
  name: string;
  version: string;
  description: string;
  stylePrefix: string;
  categories: IconCategory[];
  count: number;
  bitmapCount: number;
  icons: IconAsset[];
}
