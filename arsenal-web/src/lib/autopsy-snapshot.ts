import type { AutopsyFinding, AutopsyReport, ScanSource } from '@/lib/arsenal-api';
import type { ProjectFacts } from '@/lib/facts-arch';
// 形状校验不在本文件重写 —— 与 Node 侧（scripts/lib/autopsy-store.mjs）共用同一份。
// 理由：两种运行时各写一遍「什么样算坏快照」，最后一定长出「磁盘说坏了、页面说没坏」
// 这种谁也复现不了的差别（本仓已为同类分歧付过两次学费）。
import {
  snapshotShapeIssues as sharedShapeIssues,
  projectIdOf as sharedProjectIdOf,
  SOURCE_KINDS,
} from '../../scripts/lib/autopsy-snapshot-shape.mjs';

/**
 * 解剖台快照 —— 「这次体检到底查了什么」的留档。
 *
 * 三条刻意的分工（页面不许自己重算任何一条）：
 *   ① **report 怎么来** —— `autopsyInspect()`（`lib/arsenal-api.ts`），本文件不发起请求。
 *   ② **什么样算坏快照** —— `scripts/lib/autopsy-snapshot-shape.mjs`，Node 与浏览器共用。
 *   ③ **快照存哪** —— 见下面 `loadLocalSnapshots()`：本站是静态导出站（`output:'export'`），
 *      没有 Node 服务端可写盘，所以浏览器侧落在 localStorage；Node 侧那套三档目录
 *      （`autopsy-store.mjs`）供 CLI 与验证层使用 —— **两个后端，同一份快照格式**。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么不把 ProjectFacts 整份塞进来：
 * 体检报告本身就带全量 findings，再叠一份 facts 常常逼近 localStorage 的 5MB 配额。
 * facts 因此是**可选**的，存不下时先丢它，保留结论（报告）——
 * 「留不住架构事实」比「一份快照都存不下」轻得多，取舍要写在明处。
 */

/** 一条 findings 的身份。用它做差集，而不是用数组下标 —— 下标会在重排后错位。 */
export function findingKey(f: Pick<AutopsyFinding, 'ruleId' | 'file' | 'line'>): string {
  return `${f.ruleId}@${f.file}:${f.line}`;
}

export interface AutopsySnapshot {
  schemaVersion: number;
  /** `20261012T032500Z` 形态，字典序 == 时间序 */
  snapshotId: string;
  /** 项目身份：同来源永远同一个 id（生成算法在 Node 侧 `projectIdOf`） */
  projectId: string;
  source: ScanSource;
  fingerprint: string;
  /** dir = 目录 mtime+size 树；git = HEAD+porcelain；report = 只看规模（浏览器） */
  fingerprintKind: 'report' | 'dir' | 'git';
  savedAt: string;
  root: string;
  elapsedMs: number;
  scope: AutopsyReport['scope'];
  coverage: {
    total: number;
    executed: number;
    notRun: number;
    skippedCount: number;
    decidable: boolean;
  };
  verdict: { p0: number; p1: number; other: number; obs: number };
  report: AutopsyReport;
  facts?: ProjectFacts;
  /** 为省配额丢掉 facts 时会置 true —— 「没存」与「没有问题」在页面上必须说得清 */
  factsOmitted?: boolean;
  toolVersion: string;
}

// ─────────────────────────────────────────────────────────────
// 形状校验（转发 + 类型收窄）
// ─────────────────────────────────────────────────────────────

export { SOURCE_KINDS };

/**
 * @returns 空数组 = 这份快照能用。**每一条都是人读的中文**，会直接显示在页面上。
 */
export function snapshotShapeIssues(doc: unknown): string[] {
  return sharedShapeIssues(doc);
}

function isSnapshot(doc: unknown): doc is AutopsySnapshot {
  return snapshotShapeIssues(doc).length === 0;
}

// ─────────────────────────────────────────────────────────────
// 指纹
// ─────────────────────────────────────────────────────────────

/**
 * 浏览器可达的弱指纹：**只看根目录名 / 文件数 / 字节数**。
 *
 * ★ 它不是加密哈希，也不需要是 —— 它只用来回答「规模变了没有」。
 * ★ 它的盲区必须在页面上照实写：`文件数 + 字节数都没变的改动，这条指纹看不出来`。
 *   真·内容级指纹（mtime+size 树 / git HEAD）在 Node 侧 `autopsy-fingerprint.mjs`，
 *   浏览器读不到目录，做不到 —— **不要在这里假装做到了**。
 */
export function reportScopeFingerprint(report: AutopsyReport): string {
  return `report:${report.root}|${report.scope.files}|${report.scope.bytes}`;
}

/**
 * 这条指纹**可不可信**。
 *
 * ★ 空跑是最危险的静默失败：一个文件都没扫到时，指纹是 `report:xxx|0|0` ——
 *   它长得跟正常指纹一模一样，于是「上次也是 0 个文件」会被判成「输入没变」，
 *   页面言之凿凿地说「复用」，而实际上**上次什么也没扫到**。
 *   「没扫到」与「扫过且没变」在页面上长得一模一样（2026-10-04 同款），所以这里显式挡掉。
 */
export function fingerprintTrust(report: AutopsyReport): { trustworthy: boolean; reason: string } {
  if (!report?.scope) return { trustworthy: false, reason: '这次报告没有 scope，无从判断输入规模' };
  if (report.scope.truncated) {
    return { trustworthy: false, reason: '这次扫描被规模闸门截断了，指纹只覆盖了扫到的那部分' };
  }
  if (report.scope.files === 0) {
    return { trustworthy: false, reason: '这次一个文件都没扫到，指纹是空的 —— 不能拿来判「没变」' };
  }
  return { trustworthy: true, reason: '' };
}

/**
 * 项目身份 —— 与 Node 侧**同一个算法**（`autopsy-snapshot-shape.mjs` 的 `projectIdOf`）。
 *
 * ★ 别在这里另写一份哈希：两侧 id 不一致的直接后果不是「命名不统一」，而是
 *   磁盘快照按 A 分组、文件名按 B 命名 → 按 projectId 查历史**永远查不到**，
 *   而页面只会说「这个地址还没有任何快照」（一句正确但误导的话）。
 */
export const projectIdOf = sharedProjectIdOf;

/**
 * 存进快照的 `source.value` —— **先去掉 URL 里内嵌的凭据**。
 *
 * ★ 这是本棒的安全审查结论（不是顺手加的）：`https://u:<token>@github.com/o/r.git`
 *   这种地址是私有仓库的常见写法，而快照是要**落盘 / 进 localStorage** 的 ——
 *   原样存进去等于把令牌写进一份会被下载、会被人传阅的 JSON 里。
 *   脱敏必须发生在**算 projectId 之前**，否则「带令牌的同一仓库」与「不带令牌的」
 *   会算出两个 id —— 又是一对平行身份。
 */
export function redactSourceValue(value: string): string {
  return String(value ?? '').replace(/\/\/([^/@\s]+)@/g, '//***@');
}

/**
 * 一个来源的身份 —— **唯一入口**。
 * 凡是「这个地址对应哪份历史」的地方都走它，不要各自拼 `kind + value`。
 */
export function projectIdOfSource(source: ScanSource): string {
  return projectIdOf(source.kind, redactSourceValue(source.value));
}

/** `20261012T032500Z` —— 冒号会破坏文件名与 localStorage key，一律去掉。 */
export function newSnapshotId(now: Date = new Date()): string {
  return `${now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
}

// ─────────────────────────────────────────────────────────────
// 组装
// ─────────────────────────────────────────────────────────────

export function buildSnapshot(args: {
  source: ScanSource;
  report: AutopsyReport;
  facts?: ProjectFacts | null;
  now?: Date;
  toolVersion?: string;
}): AutopsySnapshot {
  const report = args.report;
  const now = args.now ?? new Date();
  const snap: AutopsySnapshot = {
    schemaVersion: 1,
    snapshotId: newSnapshotId(now),
    projectId: projectIdOfSource(args.source),
    source: { kind: args.source.kind, value: redactSourceValue(args.source.value.trim()) },
    fingerprint: reportScopeFingerprint(report),
    fingerprintKind: 'report',
    savedAt: now.toISOString(),
    root: report.root,
    elapsedMs: report.elapsedMs,
    scope: report.scope,
    coverage: {
      total: report.coverage.total,
      executed: report.coverage.executed,
      notRun: report.coverage.notRun,
      skippedCount: report.coverage.skippedCount,
      decidable: report.coverage.decidable,
    },
    verdict: {
      p0: report.p0.length,
      p1: report.p1.length,
      other: report.other.length,
      obs: report.obs.available ? report.obs.firedCount : 0,
    },
    report,
    ...(args.facts ? { facts: args.facts } : {}),
    toolVersion: args.toolVersion ?? '0.1.0',
  };
  return snap;
}

// ─────────────────────────────────────────────────────────────
// 对照
// ─────────────────────────────────────────────────────────────

export interface TierDelta {
  prev: number;
  next: number;
  /** 这次新冒出来的 */
  added: AutopsyFinding[];
  /** 上次命中、这次没了 —— 「修好了」还是「这条规则今天没跑」，靠 reason 区分 */
  fixed: AutopsyFinding[];
}

export interface SnapshotDiff {
  prevId: string;
  nextId: string;
  sameFingerprint: boolean;
  p0: TierDelta;
  p1: TierDelta;
  coveragePrev: number;
  coverageNext: number;
  coverageTotal: number;
  obsPrev: number;
  obsNext: number;
}

/**
 * 「P0 少了 2 个」**必须有依据**，否则它和「2 条规则今天没跑」在页面上长得一模一样。
 * 依据就在这里：少了的那 2 个是哪一条哪个文件的哪一行，逐条列得出来。
 */
function tierDelta(prev: AutopsyFinding[], next: AutopsyFinding[]): TierDelta {
  const prevMap = new Map(prev.map((f) => [findingKey(f), f]));
  const nextMap = new Map(next.map((f) => [findingKey(f), f]));
  return {
    prev: prev.length,
    next: next.length,
    added: next.filter((f) => !prevMap.has(findingKey(f))),
    fixed: prev.filter((f) => !nextMap.has(findingKey(f))),
  };
}

export function diffSnapshots(prev: AutopsySnapshot, next: AutopsySnapshot): SnapshotDiff {
  return {
    prevId: prev.snapshotId,
    nextId: next.snapshotId,
    sameFingerprint: prev.fingerprint === next.fingerprint,
    p0: tierDelta(prev.report.p0, next.report.p0),
    p1: tierDelta(prev.report.p1, next.report.p1),
    coveragePrev: prev.coverage.executed,
    coverageNext: next.coverage.executed,
    coverageTotal: next.coverage.total,
    obsPrev: prev.verdict.obs,
    obsNext: next.verdict.obs,
  };
}

// ─────────────────────────────────────────────────────────────
// localStorage 存放
// ─────────────────────────────────────────────────────────────

/**
 * 导入/自产快照的本地存放。
 *
 * 与 `src/app/arch/profile-store.ts` 同一条规矩：**别的项目的体检资料不进军火库仓库**。
 * 它只活在这台机器的浏览器里；要长期留档就「下载快照 JSON」，
 * 或者 Node 侧 `scripts/autopsy-store.mjs` 存进 `.data/autopsy/`（那个目录已进 .gitignore）。
 */
const KEY = 'arsenal-autopsy-snapshots-v1';
/** 单项目留档上限 —— 无界的列表会让 localStorage 在半年后突然塞满 */
const MAX_PER_PROJECT = 30;
const MAX_TOTAL = 120;

export interface LocalSnapshotSet {
  /** projectId → 该项目的快照（按 snapshotId 倒序） */
  [projectId: string]: AutopsySnapshot[];
}

export interface LoadedSnapshots {
  snapshots: LocalSnapshotSet;
  /** 形状坏掉的项目池。不与正常列表混，页面上要说「这几份坏了」而不是当作没有 */
  damaged: { projectId: string; issues: string[] }[];
}

export function loadLocalSnapshots(): LoadedSnapshots {
  if (typeof window === 'undefined') return { snapshots: {}, damaged: [] };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { snapshots: {}, damaged: [] };
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { snapshots: {}, damaged: [{ projectId: '(整份)', issues: ['存的不是一个对象'] }] };
    }
    const out: LocalSnapshotSet = {};
    const damaged: { projectId: string; issues: string[] }[] = [];
    for (const [projectId, list] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(list)) {
        damaged.push({ projectId, issues: ['这个项目的快照不是一个数组'] });
        continue;
      }
      const good: AutopsySnapshot[] = [];
      for (const doc of list) {
        // 存进去的时候校验过，但用户可能手改过 localStorage —— 读的时候再挡一次。
        // 一份坏快照会让整个「历史」页白屏，那比「这份档案不见了」严重得多
        if (isSnapshot(doc)) good.push(doc);
        else damaged.push({ projectId, issues: [`${(doc as { snapshotId?: string })?.snapshotId ?? '?'}：${snapshotShapeIssues(doc).join('；')}`] });
      }
      if (good.length > 0) out[projectId] = good.sort((a, b) => b.snapshotId.localeCompare(a.snapshotId));
    }
    return { snapshots: out, damaged };
  } catch (err) {
    return {
      snapshots: {},
      damaged: [{ projectId: '(整份)', issues: [`读不出来：${(err as Error).message}`] }],
    };
  }
}

export interface SaveOutcome {
  ok: boolean;
  issues: string[];
  /** 为省配额丢掉 facts 时为真 */
  factsOmitted?: boolean;
}

/**
 * 存一份。**写之前挡一次形状**（同 Node 侧 `saveSnapshot`），写失败分两档重试：
 * ① 丢 facts 再试一次（保住结论）② 还失败 → 老实告诉用户为什么没存下。
 */
export function saveLocalSnapshot(snapshot: AutopsySnapshot): SaveOutcome {
  const issues = snapshotShapeIssues(snapshot);
  if (issues.length > 0) return { ok: false, issues };
  if (typeof window === 'undefined') return { ok: false, issues: ['不在浏览器里，无处可存'] };

  const attempt = (withFacts: boolean): boolean => {
    try {
      const set = loadLocalSnapshots().snapshots;
      const pid = snapshot.projectId;
      const list = set[pid] ?? [];
      const doc: AutopsySnapshot = withFacts
        ? snapshot
        : { ...snapshot, facts: undefined, factsOmitted: true };
      const nextList = [doc, ...list.filter((s) => s.snapshotId !== doc.snapshotId)]
        .sort((a, b) => b.snapshotId.localeCompare(a.snapshotId))
        .slice(0, MAX_PER_PROJECT);
      set[pid] = nextList;
      // 全局上限：按「每项目的最后一份」排，最早的先丢
      const ordered = Object.entries(set).sort(
        (a, b) => (b[1][0]?.snapshotId ?? '').localeCompare(a[1][0]?.snapshotId ?? '')
      );
      let keptTotal = 0;
      for (const [k, v] of ordered) {
        const room = Math.max(0, MAX_TOTAL - keptTotal);
        set[k] = v.slice(0, Math.min(v.length, room));
        keptTotal += set[k].length;
      }
      window.localStorage.setItem(KEY, JSON.stringify(set));
      return true;
    } catch {
      return false;
    }
  };

  if (attempt(true)) return { ok: true, issues: [] };
  if (attempt(false)) {
    return {
      ok: true,
      issues: [],
      factsOmitted: true,
    };
  }
  return {
    ok: false,
    issues: [
      '浏览器本地存储写不进去（多半是 5MB 配额满了或隐私模式）。可以先删掉几条旧快照，或用「下载快照 JSON」自己留档。',
    ],
  };
}

export function deleteLocalSnapshot(projectId: string, snapshotId: string): void {
  if (typeof window === 'undefined') return;
  const set = loadLocalSnapshots().snapshots;
  const list = (set[projectId] ?? []).filter((s) => s.snapshotId !== snapshotId);
  if (list.length === 0) delete set[projectId];
  else set[projectId] = list;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(set));
  } catch {
    /* 删不掉不值得再吵一次 */
  }
}

/**
 * L1 复用。**「找到」不等于「没变」**：这里只判定 fingerprint 相等，
 * 而 fingerprint 自己有一条写明的盲区（见 `reportScopeFingerprint`）——
 * 页面上必须同时把这句盲区写出来，不许光秃秃地只显示「未变化」三个字。
 */
export function reusableSnapshot(
  list: AutopsySnapshot[],
  fingerprint: string
): AutopsySnapshot | null {
  if (list.length === 0) return null;
  return list.find((s) => s.fingerprint === fingerprint) ?? null;
}
