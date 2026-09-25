import raw from '@/generated/cookbook.json';
import type {
  Cookbook,
  Feature,
  FeatureFile,
  Highlight,
  Recipe,
  Scenario,
  Topic,
} from './content-types';

/**
 * 最佳实践案例库入口（三层：技术 → 场景 → 实现方案）。
 *
 * 数据来源：仓库根目录 arsenal-cookbook/**\/*.json。
 * 本文件不做任何内容加工，只提供检索与锚点定位。
 */
export const cookbook = raw as unknown as Cookbook;
export const topics: Topic[] = cookbook.topics;
export const cookbookMeta = cookbook.meta;

const topicById = new Map<string, Topic>();
for (const t of topics) topicById.set(t.id, t);

export function getTopic(id: string): Topic | undefined {
  return topicById.get(id);
}

export function getScenario(topicId: string, scenarioId: string): Scenario | undefined {
  return getTopic(topicId)?.scenarios.find((s) => s.id === scenarioId);
}

export function getRecipe(
  topicId: string,
  scenarioId: string,
  recipeId: string
): Recipe | undefined {
  return getScenario(topicId, scenarioId)?.recipes.find((r) => r.id === recipeId);
}

/**
 * 摊平的「技术 / 场景 / 方案」三元组。
 *
 * 详情页渲染器（BlueprintView）是从旧的一层结构长出来的，它认的是 Feature。
 * 这里不重写那套渲染器，而是把三层数据合成一份 Feature 视图 —— 字段名一一对应，
 * 渲染器零改动，三层结构的上下文字段（适用条件、实现方式、参考出处）则由
 * 对应层级补齐：scenario 取场景的 when、intent 取方案的 approach、references 取技术级出处。
 */
export interface RecipeLocation {
  topic: Topic;
  scenario: Scenario;
  recipe: Recipe;
}

export const recipeLocations: RecipeLocation[] = topics.flatMap((topic) =>
  topic.scenarios.flatMap((scenario) =>
    scenario.recipes.map((recipe) => ({ topic, scenario, recipe }))
  )
);

export function toFeature({ topic, scenario, recipe }: RecipeLocation): Feature {
  return {
    id: `${topic.id}/${scenario.id}/${recipe.id}`,
    order: recipe.order,
    name: recipe.name,
    subtitle: `${topic.name} · ${scenario.name}`,
    glyph: topic.glyph,
    level: topic.level,
    scenario: scenario.when,
    intent: recipe.approach,
    tags: [topic.name, scenario.name, topic.runtime],
    relatedRules: recipe.relatedRules,
    flow: recipe.flow,
    packages: recipe.packages,
    files: recipe.files,
    checklist: recipe.checklist,
    pitfalls: recipe.pitfalls,
    notSuitable: scenario.notSuitable,
    performance: recipe.performance,
    references: topic.references,
    playground: recipe.playground,
    fileCount: recipe.fileCount,
    highlightCount: recipe.highlightCount,
    ruleCount: recipe.ruleCount,
    lines: recipe.lines,
  };
}

/** 全部关联规则 ID（去重），用于展示「这个案例库共覆盖多少条规则」 */
export const allRelatedRules = (() => {
  const s = new Set<string>();
  for (const { recipe } of recipeLocations) for (const r of recipe.relatedRules) s.add(r);
  return [...s].sort();
})();

/** 规则 ID → 引用了它的方案清单，用于规则详情页反向链接 */
export const recipesByRule = (() => {
  const m = new Map<string, RecipeLocation[]>();
  for (const loc of recipeLocations) {
    for (const r of loc.recipe.relatedRules) {
      const list = m.get(r) ?? [];
      list.push(loc);
      m.set(r, list);
    }
  }
  return m;
})();

export const cookbookStats = {
  /** L1 技术数 */
  features: topics.length,
  /** L2 场景数 */
  scenarios: topics.reduce((n, t) => n + t.scenarioCount, 0),
  /** L3 方案数 */
  recipes: topics.reduce((n, t) => n + t.recipeCount, 0),
  /** 可运行的模拟接口实验数 */
  demos: topics.reduce((n, t) => n + t.demoCount, 0),
  files: topics.reduce((n, t) => n + t.fileCount, 0),
  lines: topics.reduce((n, t) => n + t.lines, 0),
  highlights: topics.reduce((n, t) => n + t.highlightCount, 0),
  rules: allRelatedRules.length,
};

/**
 * 在代码里定位一条要点的锚点位置。
 *
 * 返回 1-based 行号与列区间（列用于在同一行内精确标记片段）。
 * 找不到时返回 null —— 此时前端会降级为「只展示要点、不做行内标记」，
 * 而不是猜一个位置把角标挂错地方。
 */
export interface Anchor {
  line: number;
  startCol: number;
  endCol: number;
}

export function locateAnchor(code: string, mark: string): Anchor | null {
  const idx = code.indexOf(mark);
  if (idx < 0) return null;

  const before = code.slice(0, idx);
  const line = before.split('\n').length;
  const lineStart = before.lastIndexOf('\n') + 1;
  const startCol = idx - lineStart;

  // 多行锚点：只标记第一行的可见部分
  const firstLineEnd = mark.indexOf('\n');
  const visible = firstLineEnd >= 0 ? mark.slice(0, firstLineEnd) : mark;

  return { line, startCol, endCol: startCol + visible.length };
}

/** 给一个文件的所有要点算出锚点，保持原始顺序 */
export function anchorFile(file: FeatureFile): (Highlight & { anchor: Anchor | null })[] {
  return (file.highlights ?? []).map((h) => ({
    ...h,
    anchor: locateAnchor(file.code, h.mark),
  }));
}

/** 按代码层聚合，用于详情页的目录与统计 */
export function layersOf(f: { files: FeatureFile[] }): { layer: string; files: FeatureFile[] }[] {
  const order: string[] = [];
  const m = new Map<string, FeatureFile[]>();
  for (const file of f.files) {
    if (!m.has(file.layer)) {
      m.set(file.layer, []);
      order.push(file.layer);
    }
    m.get(file.layer)!.push(file);
  }
  return order.map((layer) => ({ layer, files: m.get(layer)! }));
}
