import raw from '@/generated/cookbook.json';
import type { Cookbook, Feature, FeatureFile, Highlight } from './content-types';

/**
 * 最佳实践案例库入口。
 *
 * 数据来源：仓库根目录 arsenal-cookbook/**\/*.json。
 * 本文件不做任何内容加工，只提供检索与锚点定位。
 */
export const cookbook = raw as unknown as Cookbook;
export const features: Feature[] = cookbook.features;
export const cookbookMeta = cookbook.meta;

const byId = new Map<string, Feature>();
for (const f of features) byId.set(f.id, f);

export function getFeature(id: string): Feature | undefined {
  return byId.get(id);
}

/** 全部关联规则 ID（去重），用于展示「这个案例库共覆盖多少条规则」 */
export const allRelatedRules = (() => {
  const s = new Set<string>();
  for (const f of features) for (const r of f.relatedRules) s.add(r);
  return [...s].sort();
})();

/** 规则 ID → 引用了它的案例清单，用于规则详情页反向链接 */
export const featuresByRule = (() => {
  const m = new Map<string, Feature[]>();
  for (const f of features) {
    for (const r of f.relatedRules) {
      const list = m.get(r) ?? [];
      list.push(f);
      m.set(r, list);
    }
  }
  return m;
})();

export const cookbookStats = {
  features: features.length,
  files: features.reduce((n, f) => n + f.fileCount, 0),
  lines: features.reduce((n, f) => n + f.lines, 0),
  highlights: features.reduce((n, f) => n + f.highlightCount, 0),
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
export function layersOf(f: Feature): { layer: string; files: FeatureFile[] }[] {
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
