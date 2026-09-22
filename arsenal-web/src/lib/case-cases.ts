import raw from '@/generated/cases.json';
import type { CaseDef, CasesDoc, CaseParams, Driver } from './case-types';

/**
 * 场景案例库入口。
 *
 * 数据来源：仓库根目录 arsenal-cases/**\/*.json。
 * 本文件不做任何内容加工，只提供检索与默认参数。
 */
export const casesDoc = raw as unknown as CasesDoc;
export const cases: CaseDef[] = casesDoc.cases;
export const casesMeta = casesDoc.meta;

const byId = new Map<string, CaseDef>();
for (const c of cases) byId.set(c.id, c);

export function getCase(id: string): CaseDef | undefined {
  return byId.get(id);
}

/**
 * 默认参数：每个驱动取第一个档位。
 *
 * 取第一个而不是中间那个，是因为档位是按「从小到大」排的 ——
 * 默认落在最小档，用户一眼能看出「调大之后才会出现更多切片」，
 * 这正好演示了条件切片的意义。
 */
export function defaultParams(kase: CaseDef): CaseParams {
  const out: CaseParams = {};
  for (const d of kase.drivers) {
    if (d.levels.length) out[d.id] = d.levels[0].id;
  }
  return out;
}

export function driverById(kase: CaseDef, id: string): Driver | undefined {
  return kase.drivers.find((d) => d.id === id);
}

export function levelLabel(kase: CaseDef, driverId: string, levelId: string): string {
  const d = driverById(kase, driverId);
  return d?.levels.find((l) => l.id === levelId)?.label ?? levelId;
}

export const casesStats = {
  cases: cases.length,
  slices: cases.reduce((n, c) => n + (c.slices?.length ?? 0), 0),
  drivers: cases.reduce((n, c) => n + (c.drivers?.length ?? 0), 0),
  rules: new Set(cases.flatMap((c) => c.slices.flatMap((s) => s.relatedRules))).size,
  lines: cases.reduce((n, c) => n + (c.lines ?? 0), 0),
};
