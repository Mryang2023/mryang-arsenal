/**
 * 代码扫描映射表的解析层（读 src/generated/scan_rules.json）。
 *
 * 与 cookbook / stack 同一套路：**页面不读仓库根目录的 JSON**，
 * 只读同步产物 —— 少一个来源就少一处「两边不一致」。
 *
 * 这一层刻意不含任何「猜」的逻辑：查不到就是查不到，返回 undefined，
 * 由调用方决定要不要显示成「未识别」。
 */
import scanRaw from '@/generated/scan_rules.json';

export interface ScanRule {
  kind: 'maven' | 'gradle' | 'npm';
  group: string;
  artifact: string;
  tech: string;
  icon?: string;
  dim?: string;
  opt?: string;
  name: string;
}

interface ScanDoc {
  meta: { collection: string; count: number; onCanvas: number };
  rules: ScanRule[];
}

const doc = scanRaw as ScanDoc;

export const SCAN_RULES: ScanRule[] = doc.rules ?? [];

export const SCAN_RULE_META = doc.meta ?? { collection: 'arsenal-scan', count: 0, onCanvas: 0 };

const byTech = new Map(SCAN_RULES.map((r) => [r.tech, r]));

/** 技术 key → 中文名。页面上的 chip 用它，避免直接显示坐标 */
export function scanTechName(tech: string): string {
  return byTech.get(tech)?.name ?? tech;
}

/** 技术 key → 图标。没有就用通用图，不返回空 */
export function scanTechIcon(tech: string): string | undefined {
  return byTech.get(tech)?.icon;
}

/** 这条 tech 会不会出现在部署图上（有 dim 才落节点） */
export function scanTechOnCanvas(tech: string): boolean {
  return Boolean(byTech.get(tech)?.dim);
}

export function scanStats(): { count: number; onCanvas: number; techs: number } {
  return {
    count: SCAN_RULES.length,
    onCanvas: SCAN_RULES.filter((r) => r.dim).length,
    techs: new Set(SCAN_RULES.map((r) => r.tech)).size,
  };
}
