#!/usr/bin/env node
/**
 * 生命体征 CLI —— `node scripts/autopsy-watch.mjs once --path <dir>`
 *
 * 一句话：**让解剖台多看几次**。跑一次落一个序列点，自动跟上一个点比，中文打印四段变化。
 *
 * ─────────────────────────────────────────────────────────────
 * 三条不许让步的规矩：
 *
 * ① **指纹相同就复用，不重扫** —— 指纹脑子在她自己的模块里（autopsy-fingerprint），
 *    这里只是一个调用方，不许自己判断「这次要不要扫」。
 * ② **指纹不可信时落点但不许说「没变」** —— `fingerprintTrust` / `fingerprintCaveat`
 *    已经把盲区写死了；盲区不是缺陷，把它包装成「已校验无变化」才是。
 * ③ **采不到的字段写 null，不许兜底成 0** —— 后端没起来时 P0 是「没采到」，
 *    不是「P0 有 0 个」。这一点这条 CLI 打印得很吵，是刻意的。
 *
 * ④ **L2 按文件增量在指纹那一步就算，不额外走一遍盘** —— 两遍 walking 会把省下的时间还回去。
 *    能不能沿用由后端判（描述文件清单的唯一定义处在那儿），这边只报「变了哪些」；
 *    差分算不出来时一律按全量，不写成「0 个变化」。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么**不写 --every 守护进程**（2026-10-13 的取舍，别当成没做完）：
 *   本环境长驻进程会静默死（java 实测约 35 秒），自己造调度器等于把「定时」变成
 *   「随机」。定时交给外部调度器（cron / 计划任务 / WorkBuddy 自动化）调 `once`，
 *   每次都是一次干净的短命进程 —— 更好验，也更不会半夜悄悄不干活。
 *
 * 三个子命令：
 *   once --path <dir> [--project <id>] [--note "…"] [--api http://127.0.0.1:3011]
 *   list --project <id> [--last N]
 *   diff --project <id>            # 最后两点对比
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import {
  resolveAutopsyDir,
  readProfileAutopsyDir,
} from './lib/autopsy-store.mjs';
import {
  collectDirTree,
  fingerprintCaveat,
  fingerprintDirTree,
  fingerprintGitState,
  projectIdOf,
  readGitState,
} from './lib/autopsy-fingerprint.mjs';
import {
  describeDelta,
  diffEntries,
  readManifest,
  readPrevFacts,
  writeManifest,
  writePrevFacts,
} from './lib/file-delta.mjs';
import {
  STATUS_FULL,
  STATUS_PARTIAL,
  appendPoint,
  listPoints,
  loadLastPoint,
  newPointId,
  seriesFile,
} from './lib/vitals-store.mjs';
// 序列点的**形状 / 组装 / 相减**不在本文件实现 —— 与浏览器共用同一份，
// 理由见 vitals-point.mjs 文件头（两种运行时各写一遍的代价本仓已付过三次）。
import { buildPoint, diffPoints, formatDiff } from './lib/vitals-point.mjs';

/** 默认后端地址 —— 与前端 `arsenalApiBase()` 同一个口径（端口 3011）。 */
export const DEFAULT_API_BASE = 'http://127.0.0.1:3011';

/** 单次 HTTP 的兜底超时。体检一次通常几秒，给到 3 分钟是给大仓库留的余量。 */
const DEFAULT_TIMEOUT_MS = 180_000;

// ═══════════════════════════════════════════════════════════════
// 参数
// ═══════════════════════════════════════════════════════════════

/**
 * 解析命令行。**不认 Abbreviation、不做智能纠错** —— 拼错的 flag 应当立刻报错，
 * 而不是被当成没传（后者会让「这次没生效」变成一次静默失败）。
 *
 * @param {string[]} argv `process.argv`
 * @returns {{cmd: string, flags: Record<string, string|boolean>}}
 */
export function parseArgs(argv) {
  const cmd = String(argv[2] ?? '').trim();
  /** @type {Record<string, string|boolean>} */
  const flags = {};
  for (let i = 3; i < argv.length; i += 1) {
    const tok = argv[i];
    if (!tok.startsWith('--')) continue;
    const eq = tok.indexOf('=');
    const key = eq < 0 ? tok.slice(2) : tok.slice(2, eq);
    if (eq >= 0) flags[key] = tok.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[key] = argv[i + 1];
    else flags[key] = true;
    if (eq < 0 && flags[key] !== true) i += 1;
  }
  return { cmd, flags };
}

/** @param {Record<string, string|boolean>} f @param {string} k @returns {string|null} */
function str(f, k) {
  const v = f[k];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

// ═══════════════════════════════════════════════════════════════
// 指纹与 input kind
// ═══════════════════════════════════════════════════════════════

/**
 * 判定这次输入的形态。**只看本地**：远程 git 地址要先 clone，那是外部调度器的事，
 * 不在 CLI 里做（做了就是另一个「长驻 / 半死不活进程」）。
 *
 * @param {string} p 本地目录绝对路径
 * @param {'auto'|'dir'|'git'} [want]
 * @returns {{kind: 'dir'|'git', value: string}}
 */
export function detectSource(p, want = 'auto') {
  if (want === 'git' || want === 'dir') return { kind: want, value: p };
  return fs.existsSync(path.join(p, '.git'))
    ? { kind: 'git', value: p }
    : { kind: 'dir', value: p };
}

/**
 * 采集一次「这次要不要重扫」的证据。
 *
 * 注意 ms 与 files/bytes 都在这里量 —— L2 按文件增量就靠同一棵树算差分，
 * 不额外走一遍盘（两遍 walking 会把「省下来的时间」又还回去）。
 *
 * @param {Object} args
 * @param {{kind: 'dir'|'git', value: string}} args.source
 * @param {number} [args.maxEntries]
 * @returns {{fingerprint: string, kind: 'dir'|'git', trust: boolean, caveat: string, tree: {files: number, bytes: number, truncated: boolean}, ms: number, entries: Array<{rel: string, mtimeMs: number, size: number}>, error?: string}}
 */
export function collectFingerprint({ source, maxEntries }) {
  const t0 = Date.now();
  const tree = collectDirTree(source.value, maxEntries ? { maxEntries } : {});
  const ms = Date.now() - t0;
  /** entries 一律带出去 —— L2 的差分要的就是它（git 指纹也不例外：porcelain 只说
   *  「有改动」，说不出改了哪些文件，而增量判据需要具体的相对路径）。 */
  const base = { tree: { files: tree.files, bytes: tree.bytes, truncated: tree.truncated }, ms, entries: tree.entries };

  if (source.kind === 'git') {
    const st = readGitState(source.value);
    if (st) {
      return {
        fingerprint: fingerprintGitState(st),
        kind: 'git',
        // git 指纹覆盖 HEAD + porcelain，工作区之外的影响因素不参与 —— caveat 里写明
        trust: !tree.truncated && tree.files > 0,
        caveat: fingerprintCaveat('git'),
        ...base,
        ...(tree.error ? { error: tree.error } : {}),
      };
    }
    // 说自己是 git 但 git 读不出来 —— 不许假装还是 git 指纹，降级到 dir 并把原因写进 caveat
    return {
      fingerprint: fingerprintDirTree(tree.entries),
      kind: 'dir',
      trust: !tree.truncated && tree.files > 0,
      caveat: `这个目录不是可读的 git 仓库（git 状态读不出来），已退回目录指纹；${fingerprintCaveat('dir')}`,
      ...base,
      ...(tree.error ? { error: tree.error } : {}),
    };
  }

  return {
    fingerprint: fingerprintDirTree(tree.entries),
    kind: 'dir',
    trust: !tree.truncated && tree.files > 0,
    caveat: fingerprintCaveat('dir'),
    ...base,
    ...(tree.error ? { error: tree.error } : {}),
  };
}

// ═══════════════════════════════════════════════════════════════
// 采集：先看 usecase —— 后端在线就真扫，不在就如实降级
// ═══════════════════════════════════════════════════════════════

/**
 * 调后端一个 JSON 接口。**用的是 node 内置 fetch**（node 18+），不装 axios。
 *
 * @param {Object} args
 * @param {string} args.base
 * @param {string} args.apiPath
 * @param {Record<string, any>} args.body
 * @param {number} [args.timeoutMs]
 * @returns {Promise<{ok: boolean, data?: any, message?: string}>}
 */
export async function postJson({ base, apiPath, body, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}${apiPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    let envelope = null;
    try {
      envelope = await res.json();
    } catch {
      return { ok: false, message: `后端返回的不是 JSON（HTTP ${res.status}）` };
    }
    if (!envelope?.success || envelope.data == null) {
      return {
        ok: false,
        message: envelope?.message || `HTTP ${res.status}` || '后端没给原因',
      };
    }
    return { ok: true, data: envelope.data };
  } catch (err) {
    const e = /** @type {Error} */ (err);
    const why = e.name === 'AbortError' ? `超过 ${timeoutMs}ms 没回来` : e.message;
    return { ok: false, message: `连不上后端 ${base}（${why}）` };
  } finally {
    clearTimeout(timer);
  }
}


// ═══════════════════════════════════════════════════════════════
// 目录裁决（沿用解剖台三档，不在这里另写一份）
// ═══════════════════════════════════════════════════════════════

/** @param {{repoRoot: string, webRoot: string}} o */
function autopsyRootDir({ repoRoot, webRoot }) {
  return resolveAutopsyDir({
    webRoot,
    repoRoot,
    profileAutopsyDir: readProfileAutopsyDir(path.join(repoRoot, 'arsenal-profiles', 'arsenal.json')),
  });
}

// ═══════════════════════════════════════════════════════════════
// once
// ═══════════════════════════════════════════════════════════════

/**
 * 跑一次。<b>可注入 `io`（ collect / scan ）</b> —— 断言层要能在不连后端的情况下
 * 走完整流程；这条链路要是只能真扫才能测，那「复用」逻辑就永远验不了。
 *
 * @param {Object} args
 * @param {string} args.target 本地目录
 * @param {'auto'|'dir'|'git'} [args.kind]
 * @param {string} [args.projectId]
 * @param {string|null} [args.note]
 * @param {string} args.dir 已裁决好的解剖台根目录
 * @param {Date} [args.now]
 * @param {boolean} [args.noScan] true = 不联网采集，只落「规模/指纹」点
 * @param {{inspect: (s: Record<string,any>, hint?: Record<string,any>) => Promise<{ok: boolean, data?: any, message?: string}>, facts: (s: Record<string,any>, hint?: Record<string,any>) => Promise<{ok: boolean, data?: any, message?: string}>}} [args.io]
 * @returns {Promise<{ok: boolean, point: Record<string, any>|null, reused: boolean, issues: string[], lines: string[], delta: import('./lib/file-delta.mjs').FileDelta|null, incremental: {applied: boolean, reason: string}|null}>}
 */
export async function runOnce({
  target,
  kind = 'auto',
  projectId,
  note = null,
  dir,
  now = new Date(),
  noScan = false,
  io,
}) {
  const lines = [];
  /** @type {string[]} */
  const issues = [];

  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) {
    return { ok: false, point: null, reused: false, issues: [`路径不存在：${abs}`], lines, delta: null, incremental: null };
  }
  if (!fs.statSync(abs).isDirectory()) {
    return { ok: false, point: null, reused: false, issues: [`不是目录：${abs}`], lines, delta: null, incremental: null };
  }

  const source = detectSource(abs, kind);
  const pid = projectId ?? projectIdOf(source.kind, source.value);
  const fp = collectFingerprint({ source });

  const prev = loadLastPoint({ dir, projectId: pid });
  // 复用条件：**指纹相同 且 上一个点是 full**。
  // 上一个点是 partial（比如那次后端没起来）时不许沿用 —— 「那次也没采到」不等于「这次没变」。
  const canReuse = !!prev && prev.fingerprint === fp.fingerprint && prev.status === STATUS_FULL;

  lines.push(`项目 ${pid}　输入 ${source.kind}:${source.value}`);
  lines.push(
    `指纹 ${String(fp.fingerprint).slice(0, 12)}…（${fp.kind}，采集中 ${fp.ms}ms，${fp.tree.files} 个文件 / ${fp.tree.bytes} 字节${fp.tree.truncated ? '，⚠ 已被规模闸门截断' : ''}）`
  );
  if (!fp.trust) {
    lines.push(`⚠ 本次指纹有盲区：${fp.caveat}`);
  }

  // ── L2：这一层算「变了哪些文件」，顺便决定能不能沿用上一枚点 ──
  const prevManifest = readManifest({ dir, projectId: pid });
  const delta = diffEntries(prevManifest, { entries: fp.entries, truncated: fp.tree.truncated });
  lines.push(...describeDelta(delta));

  /** 给后端的增量提示。差分不可信时一律不传 —— 让它老老实实全量。 */
  const l2Hint = delta.trust && delta.changed > 0
    ? { changedFiles: [...delta.added, ...delta.modified, ...delta.removed] }
    : null;

  const id = newPointId(now);
  const ts = now.toISOString();

  if (canReuse) {
    // ── 复用：指纹没变 → 上一次的结论依然成立，逐字段照抄（status 也是 full） ──
    const point = {
      schemaVersion: 1,
      snapshotId: id,
      ts,
      fingerprint: fp.fingerprint,
      fingerprintKind: fp.kind,
      fingerprintTrust: fp.trust,
      fingerprintCaveat: fp.caveat,
      verdict: { ...prev.verdict },
      services: { ...prev.services },
      coverage: { ...prev.coverage },
      scan: { ...prev.scan, delta: deltaSummary(delta) },
      status: STATUS_FULL,
      ...(note ? { note } : {}),
    };
    const w = appendPoint({ dir, projectId: pid, point });
    if (!w.ok) {
      issues.push(...w.issues);
      return { ok: false, point: null, reused: true, issues, lines, delta, incremental: null };
    }
    saveL2Cache({ dir, projectId: pid, ts, fp, entries: fp.entries, facts: null, issues });
    lines.push('指纹与上一枚序列点相同 → 复用上一次的体检结论，没有重扫。');
    lines.push('四段变化：无变化（同一份输入，复用上一次的结论）。');
    lines.push(
      `下次建议执行：${new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()}（本命令不做定时，交给外部调度器）`
    );
    return { ok: true, point, reused: true, issues, lines, delta, incremental: null };
  }

  // ── 真采集（或降级） ─────────────────────────────────────────
  let report = null;
  let facts = null;
  let degraded = null;
  if (noScan) {
    degraded = '本次未联网采集体检结论（--no-scan）';
  } else if (io) {
    const ri = await io.inspect({ kind: source.kind, value: source.value });
    if (ri.ok) report = ri.data;
    else degraded = `体检没采到：${ri.message}`;
    // 体检端点不接增量：它只读 facts 与观察项，而观察项的判定要看部署清单 ——
    // 增量沿用会让「结论来自哪一次」说不清。要增量只走 facts 那条。
    const fi = await io.facts(
      { kind: source.kind, value: source.value },
      l2Hint ? { ...l2Hint, prevFacts: readPrevFacts({ dir, projectId: pid }) ?? undefined } : undefined
    );
    if (fi.ok) facts = fi.data;
    else if (report) {
      // 报告有了但 facts 没采到：服务段留 null 并说明，不许 static 0
      degraded = `${degraded ? `${degraded}；` : ''}服务段没采到：${fi.message}`;
    } else {
      degraded = `${degraded ? `${degraded}；` : ''}facts 也没采到：${fi.message}`;
    }
  } else {
    degraded = '本次没有任何采集来源（未传 io）';
  }

  const point = buildPoint({ snapshotId: id, ts, fp, report, facts, note, degraded, delta: deltaSummary(delta) });
  const w = appendPoint({ dir, projectId: pid, point });
  if (!w.ok) {
    issues.push(...w.issues);
    return { ok: false, point: null, reused: false, issues, lines, delta, incremental: null };
  }
  saveL2Cache({ dir, projectId: pid, ts, fp, entries: fp.entries, facts, issues });

  /** 后端到底有没有走增量 —— 事实说了算，不猜。 */
  const incremental = facts?.incremental
    ? { applied: facts.incremental.applied === true, reason: String(facts.incremental.reason ?? '') }
    : null;
  if (incremental) {
    lines.push(
      incremental.applied
        ? `L2 增量：后端沿用了 ${facts.incremental.reusedBlocks} 个块，只重算了代码侧`
        : `L2 未生效：${incremental.reason || '后端没给出原因'}`
    );
  } else if (l2Hint) {
    lines.push('L2 未生效：这一份 facts 里没有 incremental 段（后端版本比 CLI 老）');
  }

  lines.push(
    `体检 ${point.verdict.p0 ?? '未采到'} P0 / ${point.verdict.p1 ?? '未采到'} P1 / ${point.verdict.obs ?? '未采到'} 观察` +
      `　覆盖率 ${point.coverage.executed ?? '未采到'}/${point.coverage.total ?? '未采到'}`
  );
  if (degraded) lines.push(`⚠ ${degraded}　（这一枚点是 partial，不进曲线）`);

  if (prev) {
    const d = diffPoints(prev, point);
    lines.push('与上一枚序列点的变化：');
    lines.push(...formatDiff(d));
  } else {
    lines.push('这是第一枚序列点，没有可对比的上一次。');
  }

  const next = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  lines.push(`下次建议执行：${next.toISOString()}（本命令不做定时，交给外部调度器）`);
  return { ok: true, point, reused: false, issues, lines, delta, incremental };
}

/**
 * 序列点里只带差分的**计数**，不带文件清单 ——
 * 清单可能有几千条，塞进 JSONL 会让「一个点」变成「一个点加几百 KB」。
 * 完整清单在 `files.json`，这里给出「去哪看」。
 *
 * @param {import('./lib/file-delta.mjs').FileDelta} d
 */
function deltaSummary(d) {
  return {
    added: d.added.length,
    modified: d.modified.length,
    removed: d.removed.length,
    unchanged: d.unchanged,
    changed: d.changed,
    trust: d.trust,
    caveat: d.caveat,
  };
}

/**
 * 落 L2 缓存。**只在采到了 facts 时才更新 facts 缓存** ——
 * 用一份没采全的 facts 覆盖掉上一份好事实，会让下一次沿用出一份比全量还差的结论。
 * 清单文件则每次都写：它描述的是「此刻磁盘长什么样」，与采没采到无关。
 *
 * @returns {void}
 */
function saveL2Cache({ dir, projectId, ts, fp, entries, facts, issues }) {
  const m = writeManifest({
    dir,
    projectId,
    ts,
    fingerprint: fp.fingerprint,
    entries,
    truncated: fp.tree.truncated,
  });
  if (!m.ok) issues.push(...m.issues);
  if (facts) {
    const f = writePrevFacts({ dir, projectId, ts, facts });
    if (!f.ok) issues.push(...f.issues);
  }
}

// ═══════════════════════════════════════════════════════════════
// list / diff
// ═══════════════════════════════════════════════════════════════

/**
 * 列出某个项目的序列点。**有坏行就先报坏行** —— 序列悄悄少点是最难发现的一类故障。
 *
 * @param {{dir: string, projectId: string, last?: number}} args
 * @returns {{found: boolean, lines: string[], count: number}}
 */
export function runList({ dir, projectId, last }) {
  const file = seriesFile({ dir, projectId });
  if (!fs.existsSync(file)) {
    return { found: false, lines: [`这个项目的序列文件还不存在：${file}`, '（一次都没跑过 —— 先跑 `once`）'], count: 0 };
  }
  const { points, issues, lines: total } = listPoints({ dir, projectId });
  const lines = [`序列文件：${file}`];
  lines.push(`共 ${total} 行：可用 ${points.length} 点 / 坏行 ${issues.length} 行`);
  for (const bad of issues) lines.push(`　[坏行 第 ${bad.line} 行] ${bad.issues.join('；')}`);
  if (points.length === 0) {
    lines.push('没有任何可用的序列点（0 点 —— 不是「一切正常」，是这次还没跑出来）。');
    return { found: true, lines, count: 0 };
  }
  const shown = typeof last === 'number' && last > 0 ? points.slice(-last) : points;
  for (const p of shown) {
    lines.push(
      `　${p.ts}　${String(p.fingerprint).slice(0, 8)}　` +
        `P0 ${p.verdict?.p0 ?? '未采到'} / P1 ${p.verdict?.p1 ?? '未采到'} / 观察 ${p.verdict?.obs ?? '未采到'}　` +
        `覆盖 ${p.coverage?.executed ?? '未采到'}/${p.coverage?.total ?? '未采到'}　` +
        `${p.scan?.files ?? '?'} 文件　${p.status === STATUS_FULL ? '' : `⚠ ${p.status}${p.degraded ? `：${p.degraded}` : ''}`}`.trimEnd() +
        (p.note ? `　备注：${p.note}` : '')
    );
  }
  return { found: true, lines, count: points.length };
}

/**
 * 最后两点的四段变化。
 *
 * @param {{dir: string, projectId: string}} args
 * @returns {{ok: boolean, lines: string[]}}
 */
export function runDiff({ dir, projectId }) {
  const { points, issues } = listPoints({ dir, projectId });
  const lines = [];
  for (const bad of issues) lines.push(`[坏行 第 ${bad.line} 行] ${bad.issues.join('；')}`);
  if (points.length === 0) return { ok: false, lines: [...lines, '没有可用的序列点，没法比。'] };
  if (points.length === 1) {
    return {
      ok: false,
      lines: [...lines, `只有 1 枚序列点（${points[0].ts}），还没有「上一次」可以跟它比。`],
    };
  }
  const prev = points[points.length - 2];
  const next = points[points.length - 1];
  lines.push(`最后两点：${prev.ts} → ${next.ts}`);
  lines.push(...formatDiff(diffPoints(prev, next)));
  return { ok: true, lines };
}

// ═══════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════

const USAGE = `用法：
  node scripts/autopsy-watch.mjs once --path <dir> [--project <id>] [--note "…"] [--kind auto|dir|git]
                                      [--api http://127.0.0.1:3011] [--no-scan]
  node scripts/autopsy-watch.mjs list --project <id> [--last N]
  node scripts/autopsy-watch.mjs diff --project <id>

说明：
  once   采集一次并落一枚序列点（指纹相同则复用上一次结论、不重扫；
         指纹变了会先算文件级差分，再把差异交给后端决定能否只重算代码侧）
  list   列出这个项目的全部序列点
  diff   最后两点相比，打印四段变化（体检 / 服务 / 覆盖率 / 文件数）

L2 的缓存落在 <序列目录>/<项目>/ 下：files.json（文件清单）与 facts.json（上一份事实）。
两者都不进 git（.gitignore 已覆盖）。files.json 缺了或坏了 → 下一次退化成全量，
不会假装「没变」。`;

/**
 * CLI 入口。**返回退出码**（不在这里 process.exit —— 便于被别的脚本或断言调用）。
 *
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  const { cmd, flags } = parseArgs(argv);
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const webRoot = path.resolve(here, '..');
  const repoRoot = path.resolve(webRoot, '..');
  const root = autopsyRootDir({ repoRoot, webRoot });

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(USAGE);
    console.log(`\n序列目录：${root.dir}  (${root.source})`);
    return 0;
  }

  if (cmd === 'list') {
    const pid = str(flags, 'project');
    if (!pid) {
      console.error('缺少 --project <id>（不知道要看哪个项目）');
      return 1;
    }
    const lastRaw = str(flags, 'last');
    const r = runList({ dir: root.dir, projectId: pid, last: lastRaw ? Number(lastRaw) : undefined });
    for (const l of r.lines) console.log(l);
    return r.found ? 0 : 1;
  }

  if (cmd === 'diff') {
    const pid = str(flags, 'project');
    if (!pid) {
      console.error('缺少 --project <id>');
      return 1;
    }
    const r = runDiff({ dir: root.dir, projectId: pid });
    for (const l of r.lines) console.log(l);
    return r.ok ? 0 : 1;
  }

  if (cmd === 'once') {
    const target = str(flags, 'path');
    if (!target) {
      console.error('缺少 --path <dir>');
      console.error(USAGE);
      return 1;
    }
    const base = str(flags, 'api') ?? DEFAULT_API_BASE;
    const noScan = flags['no-scan'] === true;
    const kindArg = str(flags, 'kind') ?? 'auto';
    /** @type {'auto'|'dir'|'git'} */
    const kind = kindArg === 'dir' || kindArg === 'git' ? kindArg : 'auto';

    const io = noScan
      ? undefined
      : {
          inspect: (source) => postJson({ base, apiPath: '/api/autopsy/inspect', body: { source } }),
          // L2：把「这次变了哪些文件」与上一份 facts 一起送过去。
          // 后端**不一定**采用（描述文件被动过就不用）—— 结论一律从返回的 incremental 段读，
          // 这里不猜、也不在本地假装它生效了。
          facts: (source, hint) =>
            postJson({ base, apiPath: '/api/scan/facts', body: hint ? { source, ...hint } : { source } }),
        };

    const r = await runOnce({
      target,
      kind,
      projectId: str(flags, 'project'),
      note: str(flags, 'note'),
      dir: root.dir,
      noScan,
      io,
    });
    for (const l of r.lines) console.log(l);
    for (const bad of r.issues) console.error(`✗ ${bad}`);
    return r.ok ? 0 : 1;
  }

  console.error(`未知子命令：${cmd}`);
  console.error(USAGE);
  return 1;
}

// 只在被当命令跑时进 —— 与 autopsy-store.mjs 同款守卫：
// 断言层会 import 上面的纯函数，无条件 exit 会让「import 一下就退出」成为最难查的 bug。
const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;

if (invokedDirectly) {
  main(process.argv).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err);
      process.exit(1);
    }
  );
}
