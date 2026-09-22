import raw from '@/generated/icons.json';
import type { IconAsset, IconCategory, IconLibrary } from './content-types';
import { TECH_ICONS, iconColor, iconName } from './tech-icons';

/**
 * 图标资产库入口。
 *
 * 数据来源：仓库根 `arsenal-icons/icons.json`（由 `tools/content/icons.py` 生成），
 * 本文件不加工内容，只做检索与「矢量是否真的存在」的兜底判空。
 *
 * 两类资产的分工（改这里之前先读一遍，别把位图塞进架构图）：
 *   矢量 —— TECH_ICONS 里的手绘 SVG，随 currentColor 变色、能进 SVG 导出，
 *           架构图节点 / 装配台 / IR 组件只用这一类；
 *   位图 —— public/icons/** 的 PNG，有质感但换不了色、进不了导出，
 *           只用在卡片配图、文档插图这类展示位。
 */
export const iconLibrary = raw as unknown as IconLibrary;
export const iconAssets: IconAsset[] = iconLibrary.icons;
export const ICON_CATEGORIES: IconCategory[] = iconLibrary.categories;

const byKey = new Map<string, IconAsset>();
for (const i of iconAssets) byKey.set(i.key, i);

export function iconAsset(key: string): IconAsset | undefined {
  return byKey.get(key);
}

/** 分类 id → 该分类下的图标（顺序沿用事实源，页面不再重排） */
export const iconsByCategory: Record<string, IconAsset[]> = (() => {
  const m: Record<string, IconAsset[]> = {};
  for (const c of ICON_CATEGORIES) m[c.id] = [];
  for (const i of iconAssets) (m[i.category] ??= []).push(i);
  return m;
})();

export const categoryMeta = (id: string): IconCategory =>
  ICON_CATEGORIES.find((c) => c.id === id) ?? ICON_CATEGORIES[0];

/**
 * 四路匹配：key / 中文名 / 英文名 / 标签。
 * 大小写不敏感是为了让「NACOS」「nacos」都能命中 —— 搜不到比搜到慢更劝退。
 */
export function searchIcons(q: string): IconAsset[] {
  const s = q.trim().toLowerCase();
  if (!s) return iconAssets;
  return iconAssets.filter(
    (i) =>
      i.key.includes(s) ||
      i.name.toLowerCase().includes(s) ||
      i.en.toLowerCase().includes(s) ||
      i.tags.some((t) => t.toLowerCase().includes(s))
  );
}

/**
 * 矢量是否真的存在。
 *
 * 页面与渲染器都要先过这一关：TECH_ICONS 查不到时会静默回落到 generic，
 * 界面上只是一个灰方块，一个错都不报 —— 这正是图标库最容易烂掉的地方。
 * 这里把「查不到」显式暴露出来，让调用方能自己决定是报错还是标灰。
 */
export function hasVector(key: string | undefined): boolean {
  return !!key && key in TECH_ICONS;
}

/** 图标的展示色：优先用矢量定义里的品牌色，查不到时用分类强调色兜底 */
export function iconAssetColor(asset: IconAsset): string {
  return hasVector(asset.vector) ? iconColor(asset.vector) : categoryMeta(asset.category).accent;
}

export function iconAssetName(asset: IconAsset): string {
  return hasVector(asset.vector) ? iconName(asset.vector) : asset.name;
}

export const iconStats = {
  total: iconAssets.length,
  categories: ICON_CATEGORIES.length,
  bitmaps: iconAssets.filter((i) => !!i.bitmap).length,
  /** 登记了矢量却查不到的条数 —— 恒为 0，由 .verify/project-check.ts【11】守着 */
  missingVector: iconAssets.filter((i) => !hasVector(i.vector)).length,
};
