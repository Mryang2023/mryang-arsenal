/**
 * 生命体征「序列点」—— **Node 与浏览器共用的唯一一份口径**（零依赖，可进浏览器包）。
 *
 * 本文件装两样东西，多一样都不许装：
 *   ① **形状**：什么样算一个合法的序列点（`pointShapeIssues`）
 *   ② **纯计算**：report/facts → 序列点（`buildPoint`）、两点相减（`diffPoints`）、
 *      差 → 中文四段（`formatDiff`）
 *
 * ★ 为什么不许出现 `node:fs` 之类的东西：页面（Next 静态导出）与 CLI（node）**共用这些判据**。
 *   一旦各写一份，就会长出「CLI 说这次是 partial、页面说它是 full」这种谁也复现不了的差别
 *   （本仓为「同一规矩两份实现」付过三次学费：charter-dir、project-check【13】、快照形状）。
 *   存盘那一层因此单独待在 `vitals-store.mjs`（Node）与 `src/lib/vitals-store.ts`（浏览器）。
 *
 * ★ null 与 0 不是一回事：**没采到写 null，不许兜底成 0**。
 *   「P0 有 0 个」和「这次没采到 P0」是两句完全不同的话，兜底就是把后者说成前者。
 */

/** 序列点 schema 版本。改结构就 +1，旧点不删、不静默升级，由读的一方决定怎么办。 */
export const SERIES_SCHEMA_VERSION = 1;

/** 这一次采全了 */
export const STATUS_FULL = 'full';
/** 这一次没采全（后端没起来 / 被规模闸门截断）—— 不进曲线，要留在列表里说清楚 */
export const STATUS_PARTIAL = 'partial';

/** @typedef {'dir'|'git'|'report'} FingerprintKind */
/** @typedef {'full'|'partial'} PointStatus */

/**
 * @typedef {Object} VitalsPoint
 * @property {number} schemaVersion
 * @property {string} snapshotId  `20261013T234500Z`，字典序 == 时间序
 * @property {string} ts          ISO 8601 落点时刻
 * @property {string} fingerprint
 * @property {FingerprintKind} fingerprintKind
 * @property {boolean} fingerprintTrust 指纹是否可信（false = 有盲区，不许当「没变」）
 * @property {string} [fingerprintCaveat] 盲区说明，页面上要原样显示
 * @property {{p0: number|null, p1: number|null, other: number|null, obs: number|null}} verdict
 * @property {{declarations: number|null, entryPoints: number|null, units: number|null, conflicts: number|null}} services
 * @property {{executed: number|null, total: number|null}} coverage
 * @property {{files: number, bytes: number, ms: number, truncated: boolean, delta?: ScanDelta|null}} scan
 * @property {PointStatus} status
 * @property {string} [note]
 * @property {string} [degraded] 本点为什么是 partial：采不到的原因原话
 */

/**
 * 文件级差分的**计数摘要**。只带计数不带文件清单 ——
 * 清单可能有几千条，塞进 JSONL 会让「一个点」变成「一个点加几百 KB」。
 * @typedef {Object} ScanDelta
 * @property {number} added
 * @property {number} modified
 * @property {number} removed
 * @property {number} unchanged
 * @property {number|null} changed 变更总数；trust=false 时是 null（「没算出来」不是 0）
 * @property {boolean} trust
 * @property {string} caveat
 */

const FINGERPRINT_KINDS = ['dir', 'git', 'report'];

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** 非负整数，或 null（没采到）。**不许是别的任何东西** —— 页面上「未采到」靠 null 区分。 */
function isCountOrNull(v) {
  return v === null || (typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0);
}

/**
 * 序列点形状校验。**返回问题数组而不是 boolean** —— 「哪坏了」比「坏了」有用。
 *
 * 这里刻意**不校验数字是否为 null**：值缺失是合法的，
 * 缺失与否由 `status` 与 `degraded` 表达，不由形状层代劳。
 *
 * @param {Record<string, any>} p
 * @returns {string[]} 空数组 = 形状没问题
 */
export function pointShapeIssues(p) {
  const out = [];
  if (!isPlainObject(p)) return ['序列点不是一个对象'];
  if (p.schemaVersion !== SERIES_SCHEMA_VERSION) {
    out.push(
      `schemaVersion 是 ${JSON.stringify(p.schemaVersion)}，本版只认 ${SERIES_SCHEMA_VERSION}` +
        `（这一行是别的版本写的，不是坏了 —— 升级或重扫一次）`
    );
  }
  if (typeof p.snapshotId !== 'string' || p.snapshotId.trim() === '') out.push('缺少 snapshotId');
  if (typeof p.ts !== 'string' || p.ts.trim() === '') out.push('缺少 ts');
  if (typeof p.fingerprint !== 'string' || p.fingerprint.trim() === '') out.push('缺少 fingerprint');
  if (!FINGERPRINT_KINDS.includes(p.fingerprintKind)) {
    out.push(`fingerprintKind 是 ${JSON.stringify(p.fingerprintKind)}，只认 dir / git / report`);
  }
  if (p.status !== STATUS_FULL && p.status !== STATUS_PARTIAL) {
    out.push(`status 是 ${JSON.stringify(p.status)}，只认 ${STATUS_FULL} / ${STATUS_PARTIAL}`);
  }
  const scan = p.scan;
  if (!isPlainObject(scan)) out.push('缺少 scan 段（这次扫了多少文件 / 字节 / 毫秒）');
  else {
    if (typeof scan.truncated !== 'boolean') out.push('scan.truncated 不是 boolean —— 截断与否不能含糊');
    // delta 是可选的（旧点没有），但**在就要完整**：半份差分比没有差分更难解释
    if (scan.delta !== undefined && scan.delta !== null) {
      if (!isPlainObject(scan.delta)) {
        out.push('scan.delta 不是对象');
      } else {
        for (const k of ['added', 'modified', 'removed', 'unchanged']) {
          if (!isCountOrNull(scan.delta[k])) out.push(`scan.delta.${k} 必须是非负整数或 null`);
        }
        if (!isCountOrNull(scan.delta.changed)) out.push('scan.delta.changed 必须是非负整数或 null');
        if (typeof scan.delta.trust !== 'boolean') out.push('scan.delta.trust 不是 boolean');
        if (typeof scan.delta.caveat !== 'string') out.push('scan.delta.caveat 必须是字符串');
        // 「没算出来」不许长成「0 个变化」：trust=false 时 changed 必须为 null
        if (scan.delta.trust === false && scan.delta.changed !== null) {
          out.push('scan.delta.trust=false 时 changed 必须是 null —— 「没算出来」不是「0 个变化」');
        }
      }
    }
  }

  for (const seg of ['verdict', 'services', 'coverage']) {
    const keys =
      seg === 'verdict'
        ? ['p0', 'p1', 'other', 'obs']
        : seg === 'services'
          ? ['declarations', 'entryPoints', 'units', 'conflicts']
          : ['executed', 'total'];
    const s = p[seg];
    if (!isPlainObject(s)) {
      out.push(`缺少 ${seg} 段`);
      continue;
    }
    for (const k of keys) {
      if (!(k in s)) out.push(`${seg}.${k} 缺字段（没采到就写 null，不许省略）`);
      else if (!isCountOrNull(s[k])) out.push(`${seg}.${k} 必须是非负整数或 null`);
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════
// report / facts → 序列点
// ═══════════════════════════════════════════════════════════════

/**
 * 只读地数 facts 里的服务信号。**这里做的是「数组有多长」，不是判定**
 * —— 服务单元的归属 / 冲突判定唯一出处是 `src/lib/service-topo.ts`（本仓铁律：
 * 判定逻辑不许有第二份实现）。所以 `units` / `conflicts` 在没有 topo 结果时留 null。
 *
 * @param {Record<string, any>|null} facts
 * @returns {{declarations: number|null, entryPoints: number|null, units: number|null, conflicts: number|null}}
 */
export function servicesFromFacts(facts) {
  const empty = { declarations: null, entryPoints: null, units: null, conflicts: null };
  if (!facts || typeof facts !== 'object') return empty;
  return {
    declarations: Array.isArray(facts?.services?.declarations)
      ? facts.services.declarations.length
      : null,
    entryPoints: Array.isArray(facts?.code?.entryPoints) ? facts.code.entryPoints.length : null,
    // units / conflicts 要等 service-topo 关联之后才有 —— 没跑就 null，不许拿 declarations 顶替
    units: typeof facts?.services?.units === 'number' ? facts.services.units : null,
    conflicts: typeof facts?.services?.conflicts === 'number' ? facts.services.conflicts : null,
  };
}

/**
 * 组装一个序列点。**报告 / facts 缺哪个，对应字段就是 null**，并写进 status 与 degraded。
 *
 * @param {Object} args
 * @param {string} args.snapshotId
 * @param {string} args.ts
 * @param {{fingerprint: string, kind: 'dir'|'git'|'report', trust: boolean, caveat?: string, tree: {files: number, bytes: number, truncated: boolean}, ms: number}} args.fp
 *        指纹采集结果（出处 `autopsy-fingerprint.mjs`）
 * @param {Record<string, any>|null} args.report  `/api/autopsy/inspect` 回包
 * @param {Record<string, any>|null} args.facts   `/api/scan/facts` 回包
 * @param {string|null} [args.note]
 * @param {string|null} [args.degraded]
 * @param {{added: number, modified: number, removed: number, unchanged: number, changed: number|null, trust: boolean, caveat: string}|null} [args.delta]
 *        文件级差分摘要（L2）；null = 这次没算（例如没落清单）
 * @returns {VitalsPoint}
 */
export function buildPoint({ snapshotId, ts, fp, report, facts, note = null, degraded = null, delta = null }) {
  const hasReport = !!report && Array.isArray(report.p0) && Array.isArray(report.p1);
  return {
    schemaVersion: SERIES_SCHEMA_VERSION,
    snapshotId,
    ts,
    fingerprint: fp.fingerprint,
    fingerprintKind: fp.kind,
    fingerprintTrust: fp.trust,
    fingerprintCaveat: fp.caveat ?? '',
    // ── 体检：三档结论的**条数**。缺报告 = 没采到 = null（不是 0） ──
    verdict: {
      p0: hasReport ? report.p0.length : null,
      p1: hasReport ? report.p1.length : null,
      other: hasReport && Array.isArray(report.other) ? report.other.length : null,
      obs: hasReport && Array.isArray(report.obs?.items) ? report.obs.items.length : null,
    },
    services: servicesFromFacts(facts),
    // 覆盖率分母从报告读 —— 写死 69 的那天就是它开始撒谎的那天
    coverage: hasReport
      ? {
          executed: typeof report.coverage?.executed === 'number' ? report.coverage.executed : null,
          total: typeof report.coverage?.total === 'number' ? report.coverage.total : null,
        }
      : { executed: null, total: null },
    scan: {
      files: fp.tree.files,
      bytes: fp.tree.bytes,
      // 有报告就用报告里的 elapsedMs（那是真扫描耗时）；没有就用指纹采集的 walking 时间
      ms: typeof report?.elapsedMs === 'number' ? report.elapsedMs : fp.ms,
      truncated: report?.scope?.truncated ?? fp.tree.truncated,
      ...(delta ? { delta } : {}),
    },
    // truncated 为真 = 规模闸门截断 = 指纹覆盖不全 → partial；缺报告同样 partial
    status:
      fp.tree.truncated || report?.scope?.truncated || !hasReport || degraded
        ? STATUS_PARTIAL
        : STATUS_FULL,
    ...(note ? { note } : {}),
    ...(degraded ? { degraded } : {}),
  };
}

// ═══════════════════════════════════════════════════════════════
// 两点之差
// ═══════════════════════════════════════════════════════════════

/**
 * 两个序列点的四段差。
 *
 * ★ 它比的是**计数**，不是结论明细。明细级对照（哪条规则新增了、哪一条修好了）
 *   的唯一出处是 `src/lib/autopsy-snapshot.ts` 的 `diffSnapshots` ——
 *   这里刻意不去重建 finding 列表：那会是同一份判据的第二实现（本仓 10-04 铁律）。
 *
 * @param {VitalsPoint} prev
 * @param {VitalsPoint} next
 * @returns {{sameFingerprint: boolean, checkup: Record<string, {prev: number|null, next: number|null, delta: number|null}>, services: Record<string, {prev: number|null, next: number|null, delta: number|null}>, coverage: {prev: number|null, next: number|null, total: number|null, delta: number|null}, files: {prev: number, next: number, delta: number}}}
 */
export function diffPoints(prev, next) {
  /** @param {number|null} a @param {number|null} b @returns {number|null} */
  const delta = (a, b) => (typeof a === 'number' && typeof b === 'number' ? b - a : null);
  /** @param {Record<string, any>|null|undefined} o @param {string} k */
  const get = (o, k) => (o && typeof o[k] === 'number' ? o[k] : null);
  return {
    sameFingerprint: prev?.fingerprint === next?.fingerprint,
    checkup: {
      p0: { prev: get(prev?.verdict, 'p0'), next: get(next?.verdict, 'p0'), delta: delta(get(prev?.verdict, 'p0'), get(next?.verdict, 'p0')) },
      p1: { prev: get(prev?.verdict, 'p1'), next: get(next?.verdict, 'p1'), delta: delta(get(prev?.verdict, 'p1'), get(next?.verdict, 'p1')) },
      obs: { prev: get(prev?.verdict, 'obs'), next: get(next?.verdict, 'obs'), delta: delta(get(prev?.verdict, 'obs'), get(next?.verdict, 'obs')) },
    },
    services: {
      units: { prev: get(prev?.services, 'units'), next: get(next?.services, 'units'), delta: delta(get(prev?.services, 'units'), get(next?.services, 'units')) },
      declarations: { prev: get(prev?.services, 'declarations'), next: get(next?.services, 'declarations'), delta: delta(get(prev?.services, 'declarations'), get(next?.services, 'declarations')) },
    },
    coverage: {
      prev: get(prev?.coverage, 'executed'),
      next: get(next?.coverage, 'executed'),
      total: get(next?.coverage, 'total') ?? get(prev?.coverage, 'total'),
      delta: delta(get(prev?.coverage, 'executed'), get(next?.coverage, 'executed')),
    },
    files: {
      prev: prev?.scan?.files ?? 0,
      next: next?.scan?.files ?? 0,
      delta: (next?.scan?.files ?? 0) - (prev?.scan?.files ?? 0),
    },
  };
}

/** @param {{prev: number|null, next: number|null, delta: number|null}} d @param {string} [unit] */
function fmtDelta(d, unit = '') {
  if (d.delta === null) return `${d.prev ?? '未采到'} → ${d.next ?? '未采到'}（没采全，不比）`;
  const sign = d.delta > 0 ? `+${d.delta}` : String(d.delta);
  return `${d.prev} → ${d.next}${unit}（${d.delta === 0 ? '没变' : `${sign}${unit}`}）`;
}

/**
 * 把 diff 渲染成人能读的中文。**纯函数**（便于断言层直接对字符串）。
 *
 * @param {ReturnType<typeof diffPoints>} d
 * @param {{prevName?: string, nextName?: string}} [names]
 * @returns {string[]}
 */
export function formatDiff(d, names = {}) {
  const lines = [];
  if (names.prevName || names.nextName) {
    lines.push(`　比对对象：${names.prevName ?? '?'} → ${names.nextName ?? '?'}`);
  }
  lines.push(
    `　体检：P0 ${fmtDelta(d.checkup.p0)}｜P1 ${fmtDelta(d.checkup.p1)}｜观察 ${fmtDelta(d.checkup.obs)}`
  );
  lines.push(`　服务：单元 ${fmtDelta(d.services.units)}｜声明 ${fmtDelta(d.services.declarations)}`);
  lines.push(
    d.coverage.total === null
      ? `　覆盖率：${fmtDelta(d.coverage)}（分母未采到）`
      : `　覆盖率：${fmtDelta(d.coverage)} / 共 ${d.coverage.total} 条`
  );
  lines.push(`　文件数：${fmtDelta(d.files)}`);
  lines.push(`　指纹：${d.sameFingerprint ? '与上一次相同（同一份输入）' : '与上一次不同'}`);
  return lines;
}
