/**
 * 生命体征序列存放 —— 解剖台「多看几次」的时间维度地基。
 *
 * 为什么是 JSONL 而不是一个大 JSON 数组（本棒第一个结构性取舍）：
 *   序列是**只追加**的。用数组存意味着每次落点都要「读全量 → 改一份 → 写全量」，
 *   于是 ① 序列越长写一次越贵 ② 中途崩一次就是全序列损坏 ③ 想 `tail` 看最近几次
 *   得先解析整个文件。JSONL 一行一点，追加 = appendFileSync，坏一行只坏一行。
 *
 * ★ 三条不许让步的规矩（照抄 `autopsy-store.mjs`，理由同样适用，别再写第三遍）：
 *   ① **读不到的值写 null，不许兜底成 0** —— 「P0 有 0 个」和「这次没采到 P0」
 *      在页面上是两句完全不同的话，兜底就是把后者说成前者。
 *   ② **坏行不许静默跳过** —— 跳过 = 曲线悄悄少画一个点，而页面上一切都绿。
 *      `listPoints` 必须把 issues 交还给调用方去显示（autopsy-store 的 damaged 同款）。
 *   ③ **追加写完立刻读回校验** —— 「写了」和「真写进去了」在 try 住异常之后
 *      长得一模一样，只有读回能区分。
 *
 * 落在 `<autopsyDir>/<safeFileId(projectId)>/series.jsonl`（三档目录裁决重用
 * `resolveAutopsyDir`，这里不再实现第二份 —— 目录口径分家的代价 2026-10-12 已付过）。
 *
 * @module vitals-store
 */

import fs from 'node:fs';
import path from 'node:path';
import { safeFileId } from './autopsy-snapshot-shape.mjs';
import {
  SERIES_SCHEMA_VERSION,
  STATUS_FULL,
  STATUS_PARTIAL,
  pointShapeIssues as sharedPointShapeIssues,
} from './vitals-point.mjs';

export { SERIES_SCHEMA_VERSION, STATUS_FULL, STATUS_PARTIAL };

/**
 * 形状校验转发 —— 唯一出处在 `vitals-shape.mjs`（浏览器与 Node 共用），
 * 这里不另写一份（两种运行时各写一遍「什么样算坏点」的代价本仓已付过两次）。
 */
export const pointShapeIssues = sharedPointShapeIssues;

/** 序列文件名。`.jsonl` 后缀是刻意的：它能被 `tail -f` 与文本编辑器直接看。 */
export const SERIES_FILE_NAME = 'series.jsonl';

/** @typedef {'full'|'partial'} PointStatus */

/**
 * @typedef {Object} VitalsPoint
 * @property {number} schemaVersion
 * @property {string} snapshotId  `20261013T234500Z`，字典序 == 时间序
 * @property {string} ts          ISO 8601 落点时刻
 * @property {string} fingerprint
 * @property {'dir'|'git'|'report'} fingerprintKind
 * @property {boolean} fingerprintTrust 指纹是否可信（false = 有盲区，不许当「没变」）
 * @property {string} [fingerprintCaveat] 盲区说明，页面上要原样显示
 * @property {{p0: number|null, p1: number|null, other: number|null, obs: number|null}} verdict
 * @property {{declarations: number|null, entryPoints: number|null, units: number|null, conflicts: number|null}} services
 * @property {{executed: number|null, total: number|null}} coverage
 * @property {{files: number, bytes: number, ms: number, truncated: boolean}} scan
 * @property {PointStatus} status
 * @property {string} [note]     调用方留下的一句话备注（如 `ad-hoc 重扫`）
 * @property {string} [degraded] 本点为什么是 partial：采不到体检数据的原因原话
 */

/**
 * 某个项目的序列目录。<autopsyDir>/<projectSafeId>/
 *
 * @param {{dir: string, projectId: string}} args
 * @returns {string}
 */
export function seriesDir({ dir, projectId }) {
  return path.join(dir, safeFileId(projectId));
}

/**
 * 序列文件路径。
 *
 * @param {{dir: string, projectId: string}} args
 * @returns {string}
 */
export function seriesFile({ dir, projectId }) {
  return path.join(seriesDir({ dir, projectId }), SERIES_FILE_NAME);
}


/**
 * 追加一个序列点。**写完立刻读回校验**，读回不一致就失败并返回原因。
 *
 * ★ 为什么这里的 ok=false 一定要往外传而不是 console.warn：
 *   「看起来落了点」和「落了点」在曲线上长得一模一样 —— 后者是今天多一个点，
 *   前者是三个月后发现这三个月是空的。
 *
 * @param {{dir: string, projectId: string, point: Record<string, any>}} args
 * @returns {{ok: boolean, file?: string, issues: string[], verified: boolean}}
 */
export function appendPoint({ dir, projectId, point }) {
  const issues = pointShapeIssues(point);
  if (issues.length > 0) return { ok: false, issues, verified: false };

  const dirAbs = seriesDir({ dir, projectId });
  const file = path.join(dirAbs, SERIES_FILE_NAME);
  fs.mkdirSync(dirAbs, { recursive: true });
  // 一行一点。末尾统一 LF —— 本仓所有落盘文本一条口径。
  fs.appendFileSync(file, `${JSON.stringify(point)}\n`, 'utf8');

  // ── 读回校验 ──────────────────────────────────────────────
  const back = readLastLine(file);
  if (!back.ok) {
    return {
      ok: false,
      issues: [`追加后读回失败（写了但没写到？）：${back.error}`],
      verified: false,
    };
  }
  if (back.text !== JSON.stringify(point)) {
    return { ok: false, issues: ['追加后读回的内容与写入的不一致'], verified: false };
  }
  return { ok: true, file, issues: [], verified: true };
}

/**
 * 读文件最后一行（容错：文件不存在 / 为空都算 OK 的「没有」）。
 *
 * @param {string} file
 * @returns {{ok: boolean, text?: string, error?: string}}
 */
function readLastLine(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return { ok: false, error: /** @type {Error} */ (err).message };
  }
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return { ok: false, error: '文件里没有任何一行内容' };
  return { ok: true, text: lines[lines.length - 1] };
}

/**
 * 读出某个项目的全部序列点，按 `ts` 升序。
 *
 * ★ 坏行走 issues 而不是 continue —— 见文件头规矩 ②。调用方必须把它显示出来，
 *   否则「序列悄悄少了几个点」这种事没有任何一个环节会说话。
 *
 * @param {{dir: string, projectId: string}} args
 * @returns {{points: Array<Record<string, any>>, issues: Array<{line: number, raw: string, issues: string[]}>, lines: number, file: string}}
 *          `lines` 是文件里非空行总数（= 正常点 + 坏行），用来反查有没有静默丢弃
 */
export function listPoints({ dir, projectId }) {
  const file = seriesFile({ dir, projectId });
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    // 目录/文件还不存在 = 一次都没跑过，这不是错误
    return { points: [], issues: [], lines: 0, file };
  }

  /** @type {Array<{line: number, doc: Record<string, any>}>} */
  const parsed = [];
  const issues = [];
  let lines = 0;
  const rawLines = text.split('\n');
  for (let i = 0; i < rawLines.length; i += 1) {
    const raw = rawLines[i];
    if (raw.trim() === '') continue;
    lines += 1;
    let doc = null;
    try {
      doc = JSON.parse(raw);
    } catch (err) {
      issues.push({
        line: i + 1,
        raw: raw.slice(0, 120),
        issues: [`不是合法 JSON：${/** @type {Error} */ (err).message}`],
      });
      continue;
    }
    const bad = pointShapeIssues(doc);
    if (bad.length > 0) {
      issues.push({ line: i + 1, raw: raw.slice(0, 120), issues: bad });
      continue;
    }
    // 行号只带在副作用记的那份上，不写进 doc 本身 ——
    // 否则「同输入两次 appendPoint 逐字段相等」这条断言会被行号打脸，
    // 而它红的原因跟我们要守的东西一点关系都没有。
    parsed.push({ line: i + 1, doc });
  }

  // 升序：ts 相同则按文件里的先后顺序（保持追加序，不引入第二重口径）
  parsed.sort((a, b) => {
    const c = String(a.doc.ts).localeCompare(String(b.doc.ts));
    return c !== 0 ? c : a.line - b.line;
  });
  return { points: parsed.map((p) => p.doc), issues, lines, file };
}

/**
 * 取最后一个点（按 ts 升序后的末位）。**没有就返回 null**，不编一个空的出来。
 *
 * @param {{dir: string, projectId: string}} args
 * @returns {Record<string, any>|null}
 */
export function loadLastPoint({ dir, projectId }) {
  const { points } = listPoints({ dir, projectId });
  return points.length > 0 ? points[points.length - 1] : null;
}

/**
 * 追加基线 TS 形态的时间戳 id —— 与 `autopsy-store.mjs` 的 `newId` 同形：
 * 两个运行时不许长出两种 id 形态（它们要在同一个 UI 里并列显示）。
 *
 * @param {Date} [now]
 * @returns {string}
 */
export function newPointId(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
