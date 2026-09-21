import raw from '@/generated/rules.json';
import type { CategoryKey, Rule, Ruleset, Severity } from './types';
import { CATEGORY_ORDER } from './theme';

/**
 * 规则集入口。
 *
 * 数据的唯一来源是仓库根目录的 arsenal-rules/**\/*.json —— 本文件不做任何
 * 二次加工，只提供检索。这样「人查 / 给 AI 用 / 拿代码验」三条出口读到的
 * 一定是同一份内容。
 */
export const ruleset = raw as unknown as Ruleset;

export const rules: Rule[] = ruleset.rules;
export const meta = ruleset.meta;
export const stats = ruleset.stats;

export const SEVERITY_FILTER_ORDER: Severity[] = ['MUST', 'NEVER', 'SHOULD', 'MAY'];

const byId = new Map<string, Rule>();
const byCategory = new Map<CategoryKey, Rule[]>();

for (const r of rules) {
  byId.set(r.id, r);
  const list = byCategory.get(r.category) ?? [];
  list.push(r);
  byCategory.set(r.category, list);
}

for (const [, list] of byCategory) {
  list.sort((a, b) => a.id.localeCompare(b.id));
}

export function getRule(id: string): Rule | undefined {
  return byId.get(id);
}

export function rulesOfCategory(cat: CategoryKey): Rule[] {
  return byCategory.get(cat) ?? [];
}

/**
 * 分类的声明顺序 —— 取自 meta.categories，不是前端写死的数组。
 *
 * 顺序是有含义的（从工程骨架到协作约定），而「有含义的顺序」只该有一个出处。
 * 后端 ExporterService.select 用的是同一个来源，所以两端的条目顺序必然一致。
 * 早前后端按分类字母序排、前端按写死的 CATEGORY_ORDER 排 —— 同一种载体
 * 两端给出的条目顺序不一样，而且两边都觉得自己是对的。
 */
export const categoryRank = new Map<string, number>(
  meta.categories.map((c, i) => [c.key, i])
);

/** 分类元信息（名称 / 英文名 / 说明）。查不到时退回 key —— 露出原始 key 比编一个好听的名字更容易发现问题。 */
export function categoryMetaOf(key: string): { name: string; english: string; blurb: string } {
  const c = meta.categories.find((x) => x.key === key);
  return {
    name: c?.name || key,
    english: c?.english || key,
    blurb: c?.blurb || '',
  };
}

/**
 * 来源类型 → 中文标签。
 *
 * 读的是 meta.sourceTypes（与后端同一份数据），不是 TS 里的常量表。
 * 兜底口径与后端 RulesetMeta.sourceTypeLabel 逐字对齐：
 * 类型缺失 → 「来源」；类型不认识 → 原样露出原始 key。
 */
export function sourceTypeLabel(type?: string): string {
  if (!type) return '来源';
  return meta.sourceTypes?.[type] ?? type;
}

export const orderedCategories = CATEGORY_ORDER.map((key) => ({
  key,
  rules: rulesOfCategory(key),
}));

export function countBySeverity(list: Rule[]): Record<Severity, number> {
  const out = { MUST: 0, NEVER: 0, SHOULD: 0, MAY: 0 } as Record<Severity, number>;
  for (const r of list) out[r.severity] = (out[r.severity] ?? 0) + 1;
  return out;
}

/** 全库级别统计（基于实际规则，不信任 meta 里的快照值） */
export const liveStats = (() => {
  const sev = countBySeverity(rules);
  const mustClass = sev.MUST + sev.NEVER;
  return {
    total: rules.length,
    sev,
    mustClass,
    should: sev.SHOULD,
    may: sev.MAY,
    mustHardLimit: meta.budget?.mustHardLimit ?? 50,
    budgetUsedPct: Math.round((mustClass / (meta.budget?.mustHardLimit ?? 50)) * 100),
    regexCapable: rules.filter((r) => r.check?.regex?.pattern).length,
    astCapable: rules.filter((r) => r.check?.ast?.query).length,
    llmCapable: rules.filter((r) => r.check?.llm).length,
    sources: new Set(rules.flatMap((r) => r.sources.map((s) => s.ref.split(/[ ·]/)[0]))).size,
    promptChars: rules.reduce((n, r) => n + r.promptFragment.length, 0),
  };
})();

/**
 * 关键词检索。命中字段按权重排序：ID > 标题 > 标签 > 约束句 > 正文。
 * 纯内存实现，百条以内规模下无需索引结构 —— 不写具体条数，那个数字只会过期。
 */
export function searchRules(
  query: string,
  filters?: { severities?: Severity[]; categories?: CategoryKey[]; layer?: string }
): Rule[] {
  const q = query.trim().toLowerCase();
  const sevs = filters?.severities;
  const cats = filters?.categories;

  let pool = rules.filter((r) => r.status !== 'deprecated');

  if (sevs && sevs.length) pool = pool.filter((r) => sevs.includes(r.severity));
  if (cats && cats.length) pool = pool.filter((r) => cats.includes(r.category));
  if (filters?.layer === 'auto') pool = pool.filter((r) => Boolean(r.check?.regex?.pattern));
  if (filters?.layer === 'manual') pool = pool.filter((r) => !r.check?.regex?.pattern);

  if (!q) return pool;

  const scored = pool.map((r) => {
    let score = 0;
    const id = r.id.toLowerCase();
    const title = r.title.toLowerCase();
    const tags = (r.tags ?? []).join(' ').toLowerCase();
    const frag = r.promptFragment.toLowerCase();
    const body = (r.rationale + r.bad + r.good + JSON.stringify(r.sources)).toLowerCase();

    if (id === q) score += 1000;
    if (id.includes(q)) score += 200;
    if (title.includes(q)) score += 120;
    if (tags.includes(q)) score += 90;
    if (frag.includes(q)) score += 50;
    if (body.includes(q)) score += 20;
    return { r, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.r.id.localeCompare(b.r.id))
    .map((s) => s.r);
}

/** 全部标签，按出现频次降序 */
export const allTags = (() => {
  const m = new Map<string, number>();
  for (const r of rules) for (const t of r.tags ?? []) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
})();

/** 来源清单：聚合每个出处在多少条规则中被引用 */
export const sourceIndex = (() => {
  const m = new Map<string, { ref: string; type: string; count: number; rules: string[] }>();
  for (const r of rules) {
    for (const s of r.sources) {
      // 归并到「书名」粒度，忽略章节号
      const key = s.ref.split(/[ ·§]/)[0].trim();
      const cur = m.get(key) ?? { ref: key, type: s.type ?? 'other', count: 0, rules: [] };
      cur.count += 1;
      cur.rules.push(r.id);
      m.set(key, cur);
    }
  }
  return [...m.values()].sort((a, b) => b.count - a.count);
})();
