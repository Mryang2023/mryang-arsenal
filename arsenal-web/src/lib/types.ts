export type Severity = 'MUST' | 'SHOULD' | 'MAY' | 'NEVER';

export type CategoryKey =
  | 'skeleton' | 'web' | 'service' | 'data' | 'concurrency'
  | 'reliability' | 'security' | 'test' | 'collab';

/** 检测层：static(regex) → ast → llm → manual，逐层降级 */
export type CheckLayer = 'regex' | 'ast' | 'llm' | 'manual';

export interface RuleSource {
  ref: string;
  type?: 'industry-standard' | 'framework-doc' | 'spec' | 'book' | 'security-baseline' | 'project-decision';
  quote?: string;
}

export interface RegexCheck {
  pattern: string;
  flags?: string;
  targetGlob?: string;
  expect?: 'absent' | 'present';
}

export interface AstCheck {
  engine?: 'javaparser' | 'pmd' | 'custom';
  query: string;
}

export interface RuleCheck {
  regex?: RegexCheck;
  ast?: AstCheck;
  llm?: string;
  manual?: string;
}

export interface Rule {
  id: string;
  category: CategoryKey;
  subcategory?: string;
  title: string;
  severity: Severity;
  sources: RuleSource[];
  rationale: string;
  appliesTo?: { stack?: string[]; scope?: string; pathGlob?: string };
  bad: string;
  good: string;
  check: RuleCheck;
  promptFragment: string;
  tags?: string[];
  status: 'active' | 'draft' | 'deprecated';
  version: number;
  supersedes?: string;
  updatedAt?: string;
  /** 由同步脚本注入：严重度权重 */
  _weight: number;
  _hasStaticCheck: boolean;
  _checkLayer: CheckLayer;
  _sourceFile: string;
}

export interface CategoryMeta {
  key: CategoryKey;
  name: string;
  /** 分类的英文名，规范书标题用（`工程骨架 · Skeleton`）。 */
  english?: string;
  /** 一句话说明这条分类管什么。 */
  blurb?: string;
  dir: string;
  fileCount: number;
}

export interface SourceRegistryEntry {
  title: string;
  type: string;
  authority: string;
  severityMapping?: Record<string, string>;
  note?: string;
}

export interface RulesetMeta {
  ruleset: string;
  name: string;
  codename?: string;
  version: string;
  releasedAt: string;
  description: string;
  targetStack: Record<string, string>;
  severityPolicy: Record<string, string>;
  budget: { mustHardLimit: number; mustCurrent: number; totalCurrent: number };
  sourceRegistry: Record<string, SourceRegistryEntry>;
  /**
   * 来源类型 → 中文标签（`industry-standard` → `行业规范`）。
   *
   * 与后端 RulesetMeta.sourceTypes 读的是同一份数据。刻意做成数据而不是
   * TS 常量：后端导出规范书时拿不到 TS，两边各写一份必然会漂。
   */
  sourceTypes: Record<string, string>;
  categories: CategoryMeta[];
  changelog: { version: string; date: string; note: string }[];
}

export interface RulesetStats {
  total: number;
  bySeverity: Record<string, number>;
  byCategory: Record<string, number>;
  mustClass: number;
  mustHardLimit: number;
  budgetUsedPct: number;
  promptChars: number;
  promptTokensEstimate: number;
  categoryFiles: Record<string, string[]>;
}

export interface Ruleset {
  generatedAt: string;
  meta: RulesetMeta;
  stats: RulesetStats;
  rules: Rule[];
}
