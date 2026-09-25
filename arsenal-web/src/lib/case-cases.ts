import raw from '@/generated/cases.json';
import type { CaseDef, CaseParams, CasesDoc, CaseSymptom, Driver } from './case-types';

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
 * 默认参数：场景自己声明的推荐档。
 *
 * 曾经是「每个驱动取第一档」，理由是档位按从小到大排、默认落在最小档能演示
 * 「调大之后才出现更多切片」。但这个理由只在演示时成立 —— 实际首屏是
 * 落地场景命中 0/8 的空屏：用户还没理解参数空间，就已经得到「什么都没有」。
 *
 * 现在推荐档由数据显式声明（recommended），并在 build-content.py 里强制
 * 它至少命中一个切片。想演示条件切片，去调参数，别拿首屏当教具。
 */
export function defaultParams(kase: CaseDef): CaseParams {
  const out: CaseParams = {};
  for (const d of kase.drivers) {
    const rec = kase.recommended?.[d.id];
    out[d.id] = rec && d.levels.some((l) => l.id === rec) ? rec : d.levels[0]?.id ?? '';
  }
  return out;
}

/**
 * 点一条症状之后的参数：症状只声明它关心的维度，其余用推荐档补齐。
 *
 * 补齐而不是只给症状那几个维度 —— 参数不完整会让剩余维度静默落到第一档，
 * 同样可能命中 0 个切片，等于把「空屏」换个入口再犯一次。
 */
export function symptomParams(kase: CaseDef, symptom: { params?: CaseParams }): CaseParams {
  return { ...defaultParams(kase), ...(symptom.params ?? {}) };
}

/** 全部症状摊平，供分诊台一次性扫完。每条带上它归属的场景 */
export function allSymptoms(): { kase: CaseDef; symptom: CaseSymptom }[] {
  return cases.flatMap((k) => (k.symptoms ?? []).map((symptom) => ({ kase: k, symptom })));
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
  symptoms: cases.reduce((n, c) => n + (c.symptoms?.length ?? 0), 0),
  slices: cases.reduce((n, c) => n + (c.slices?.length ?? 0), 0),
  drivers: cases.reduce((n, c) => n + (c.drivers?.length ?? 0), 0),
  rules: new Set(cases.flatMap((c) => c.slices.flatMap((s) => s.relatedRules))).size,
  lines: cases.reduce((n, c) => n + (c.lines ?? 0), 0),
};
