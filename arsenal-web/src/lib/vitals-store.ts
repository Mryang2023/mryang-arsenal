/**
 * 生命体征序列 —— **浏览器侧**（localStorage）存放。
 *
 * 与 `src/app/arch/profile-store.ts` / `autopsy-snapshot.ts` 同一条规矩：
 * 别的项目的体检资料**不进军火库仓库**，只活在这台机器的浏览器里。
 * Node 侧那份（`scripts/lib/vitals-store.mjs`，供 CLI 与验证层用）写 `.jsonl` 到
 * `.data/autopsy/`（已 gitignore）—— **两个后端，同一份序列点格式**。
 *
 * ★ 形状 / 组装 / 相减全部从 `scripts/lib/vitals-point.mjs` 拿，本文件一行都不自己算：
 *   两个运行时共用，是为了避免「CLI 说这次没采全、页面说这一版很好」这种事。
 */

import type { ProjectFacts } from '@/lib/facts-arch';
import type { AutopsyReport } from '@/lib/arsenal-api';
import { fingerprintTrust } from '@/lib/autopsy-snapshot';
import type { VitalsSeriesPoint } from '@/lib/vitals-series';
import { downloadText } from '@/lib/zip';
import {
  buildPoint,
  diffPoints,
  pointShapeIssues,
  SERIES_SCHEMA_VERSION,
  STATUS_FULL,
  STATUS_PARTIAL,
} from '../../scripts/lib/vitals-point.mjs';

export { SERIES_SCHEMA_VERSION, STATUS_FULL, STATUS_PARTIAL };

const KEY = 'arsenal-autopsy-vitals-v1';
/** 单项目序列上限 —— 序列点很小，但无界列表迟早把 localStorage 塞满 */
const MAX_PER_PROJECT = 200;

/**
 * 浏览器侧的序列点类型 —— **与图/表格消费方同一个类型**（`vitals-series.ts`），
 * 不另起一份：另起一份的下一步是「两个类型各自演化」，然后某天互不相认。
 */
export type VitalsPointShape = VitalsSeriesPoint;

export interface LoadedVitals {
  /** projectId → 序列点（按 ts 升序） */
  points: Record<string, VitalsPointShape[]>;
  /** 形状坏掉的项目池。不与正常序列混 —— 「这几个点了会不会 읽不出来」要说出口 */
  damaged: { projectId: string; issues: string[] }[];
}

/**
 * 一次体检 → 一枚序列点。
 *
 * ★ 这里**不重新实现 「report 怎么变成点」** —— `buildPoint` 与 CLI 是同一份。
 *   本函数只负责把浏览器手里的东西（report / facts / 快照 id）摆成它的入参。
 */
export function pointFromReport(args: {
  report: AutopsyReport;
  facts?: ProjectFacts | null;
  fingerprint: string;
  fingerprintKind: 'dir' | 'git' | 'report';
  snapshotId: string;
  savedAt: string;
  note?: string | null;
}): VitalsPointShape {
  const { report, fingerprint, fingerprintKind, snapshotId, savedAt } = args;
  const trust = fingerprintTrust(report);
  return buildPoint({
    snapshotId,
    ts: savedAt,
    fp: {
      fingerprint,
      kind: fingerprintKind,
      trust: trust.trustworthy,
      caveat: trust.reason || undefined,
      tree: {
        files: report.scope?.files ?? 0,
        bytes: report.scope?.bytes ?? 0,
        truncated: report.scope?.truncated ?? false,
      },
      ms: report.elapsedMs ?? 0,
    },
    report,
    facts: args.facts ?? null,
    note: args.note ?? null,
    // 没 trust 也要落点：这一趟确实跑过了，只是指纹有盲区 —— 盲区由 fingerprintTrust 表达
    degraded: trust.trustworthy ? null : trust.reason,
  });
}

/** 浏览器没有 inventory walking —— 坏不坏只看形状。 */
export function vitalsPointIssues(p: unknown): string[] {
  return pointShapeIssues(p as Record<string, unknown>);
}

export function loadLocalVitals(): LoadedVitals {
  if (typeof window === 'undefined') return { points: {}, damaged: [] };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { points: {}, damaged: [] };
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { points: {}, damaged: [{ projectId: '(整份)', issues: ['存的不是一个对象'] }] };
    }
    const points: Record<string, VitalsPointShape[]> = {};
    const damaged: { projectId: string; issues: string[] }[] = [];
    for (const [projectId, list] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(list)) {
        damaged.push({ projectId, issues: ['这个项目的序列不是一个数组'] });
        continue;
      }
      const good: VitalsPointShape[] = [];
      for (const doc of list) {
        // 存的时候校验过，但用户可能手改过 localStorage —— 读的时候再挡一次
        const bad = vitalsPointIssues(doc);
        if (bad.length === 0) good.push(doc as VitalsPointShape);
        else damaged.push({ projectId, issues: [`${(doc as { ts?: string })?.ts ?? '?'}：${bad.join('；')}`] });
      }
      if (good.length > 0) {
        points[projectId] = good.sort((a, b) => a.ts.localeCompare(b.ts)).slice(-MAX_PER_PROJECT);
      }
    }
    return { points, damaged };
  } catch (err) {
    return { points: {}, damaged: [{ projectId: '(整份)', issues: [`读不出来：${(err as Error).message}`] }] };
  }
}

/**
 * 追加一枚点。**写之前挡一次形状**（同 Node 侧）。
 *
 * @returns {{ok: boolean, issues: string[], count?: number}}
 */
export function appendLocalPoint(projectId: string, point: VitalsPointShape): { ok: boolean; issues: string[] } {
  const issues = vitalsPointIssues(point);
  if (issues.length > 0) return { ok: false, issues };
  if (typeof window === 'undefined') return { ok: false, issues: ['不在浏览器里，无处可存'] };
  try {
    const loaded = loadLocalVitals();
    const list = [...(loaded.points[projectId] ?? []), point]
      .sort((a, b) => a.ts.localeCompare(b.ts))
      .slice(-MAX_PER_PROJECT);
    const next = { ...loaded.points, [projectId]: list };
    window.localStorage.setItem(KEY, JSON.stringify(next));
    return { ok: true, issues: [] };
  } catch (err) {
    return {
      ok: false,
      issues: [`浏览器本地存储写不进去（多半是配额或隐私模式）：${(err as Error).message}`],
    };
  }
}

export function clearLocalVitals(projectId: string): void {
  if (typeof window === 'undefined') return;
  const loaded = loadLocalVitals();
  delete loaded.points[projectId];
  try {
    window.localStorage.setItem(KEY, JSON.stringify(loaded.points));
  } catch {
    /* 删不掉不值得再吵一次 */
  }
}

/**
 * 导出为 `.jsonl`（与 Node 侧序列文件**同一个**格式 —— 一行一点，
 * 拷进 `.data/autopsy/<项目>/series.jsonl` 就能被 CLI 接着用）。
 */
export function downloadVitalsSeries(points: VitalsPointShape[]): number {
  const body = `${points.map((p) => JSON.stringify(p)).join('\n')}\n`;
  return downloadText(body, `vitals-series-${points.length}.jsonl`, 'application/jsonl');
}

export { diffPoints };
