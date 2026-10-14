/**
 * L2「按文件增量」的客户端一半 —— **两份文件清单之差**。
 *
 * ★ 这个文件只回答一个问题：**这次变了哪些文件。**
 *   「能不能少扫一点」不是它决定的 —— 那是后端 `IncrementalHint` 的事
 *   （描述文件清单有第二份实现就迟早会漂移，所以那边是唯一定义处）。
 *   这边只负责把差异算准、说清，并在**看不见的时候说看不见**。
 *
 * ─────────────────────────────────────────────────────────────
 * 三条不许让步的规矩：
 *
 * ① **0 变更与「没算出来」是两句话。**
 *    `trust=false` 时（上一份清单不存在 / 坏了 / 被规模闸门截断），
 *    一律记成「上一次没有可比对的清单 → 本次按全量算」，
 *    绝不写成「0 个文件变化」。后者会让一次没采到变成一次「确认没变」。
 *
 * ② **盲区照旧，不许装作没有。**
 *    清单坐标是 mtime + size（与 `autopsy-fingerprint.mjs` 同一个口径）——
 *    内容改了但两者都没变时，这里也看不见。这条盲区必须随结果一起返回。
 *
 * ③ **清单不进 git。** 落在 `.data/autopsy/<项目>/` 下（已被 `.gitignore` 覆盖）——
 *    别人的项目清单不该因为我们看一眼就被提交。
 *
 * 零依赖（只用 node:fs / node:path），不进浏览器包 ——
 * 浏览器侧那一半（快照指纹）走的是另一条路，本仓不把两套差分实现合并：
 * 它们服务的对象不同（磁盘清单 vs 报告规模），合并出来的「差分」两边都不认。
 */

import fs from 'node:fs';
import path from 'node:path';

/** 清单 schema 版本。改结构就 +1，旧清单读不出来时如实说「没有可比对的清单」，不硬读。 */
export const MANIFEST_SCHEMA_VERSION = 1;

/**
 * 清单文件名。一个项目一份 —— 两次采集之间靠它比。
 * @param {{dir: string, projectId: string}} args
 * @returns {string}
 */
export function manifestFile({ dir, projectId }) {
  return path.join(dir, projectId, 'files.json');
}

/**
 * 上一份 facts 的落点。与清单同目录 —— 两者是同一个缓存的两半，
 * 分开放会让「有一半过期了」变成可能发生的状态。
 *
 * @param {{dir: string, projectId: string}} args
 * @returns {string}
 */
export function factsFile({ dir, projectId }) {
  return path.join(dir, projectId, 'facts.json');
}

/**
 * 上一份 facts 超过这个字节数就不存。理由：那已经不是「缓存」而是「复制」，
 * 而一份放不进缓存的旧 facts 只会让下一次老老实实全量重算 —— 那本来就该发生。
 */
export const MAX_CACHED_FACTS_BYTES = 8 * 1024 * 1024;

/**
 * @typedef {Object} FileDelta
 * @property {string[]} added     新出现的文件
 * @property {string[]} modified  mtime 或 size 变了的文件
 * @property {string[]} removed   消失的文件
 * @property {number} unchanged   没动的文件数
 * @property {number|null} changed 变更总数（增+改+删）；trust=false 时为 null
 * @property {boolean} trust      这次差分可不可信
 * @property {string} caveat      不可信的原因（trust=true 时是空串）
 * @property {number} total       本次清单的文件总数
 */

/**
 * @typedef {Object} Manifest
 * @property {number} schemaVersion
 * @property {string} ts
 * @property {string} fingerprint
 * @property {boolean} [truncated]
 * @property {number} [count]
 * @property {Array<{rel: string, mtimeMs: number, size: number}>} entries
 */

/**
 * 算差分。**纯函数** —— 不读盘不写盘，断言层与 CLI 共用同一份判据。
 *
 * @param {Manifest|null} prev 上一次清单
 * @param {{entries: Array<{rel: string, mtimeMs: number, size: number}>, truncated?: boolean}} cur 本次清单
 * @returns {FileDelta}
 */
export function diffEntries(prev, cur) {
  const curEntries = Array.isArray(cur?.entries) ? cur.entries : [];
  const total = curEntries.length;

  // 本次清单自己就被截断了 → 差分必然不全（少掉的那部分会被算成「删了」）
  if (cur?.truncated) {
    return untrustworthy(total, `本次清单被规模闸门截断（只看到 ${total} 个文件），差分不可信`);
  }
  const prevEntries = prev && Array.isArray(prev.entries) ? prev.entries : null;
  if (prevEntries === null || prev.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    return untrustworthy(
      total,
      prevEntries === null
        ? '没有上一次的文件清单（第一次跑，或上一次没落盘）—— 本次按全量算'
        : `上一次清单的 schemaVersion 是 ${prev.schemaVersion}，本版只认 ${MANIFEST_SCHEMA_VERSION}`
    );
  }
  if (prev.truncated) {
    return untrustworthy(total, '上一次的文件清单本身被截断过，拿它比出来的差分不可信');
  }

  /** @type {Map<string, {mtimeMs: number, size: number}>} */
  const prevMap = new Map();
  for (const e of prevEntries) prevMap.set(e.rel, { mtimeMs: e.mtimeMs, size: e.size });

  const added = [];
  const modified = [];
  const curMap = new Set();
  for (const e of curEntries) {
    curMap.add(e.rel);
    const before = prevMap.get(e.rel);
    if (before === undefined) {
      added.push(e.rel);
    } else if (before.mtimeMs !== e.mtimeMs || before.size !== e.size) {
      modified.push(e.rel);
    }
  }
  const removed = [];
  for (const rel of prevMap.keys()) {
    if (!curMap.has(rel)) removed.push(rel);
  }

  // 排序：同一份输入必须给出同一个顺序，否则「变了哪些」每次打印都不一样
  added.sort();
  modified.sort();
  removed.sort();

  const changed = added.length + modified.length + removed.length;
  return {
    added,
    modified,
    removed,
    unchanged: total - added.length - modified.length,
    changed,
    trust: true,
    caveat: '',
    total,
  };
}

/**
 * @param {number} total
 * @param {string} caveat
 * @returns {FileDelta}
 */
function untrustworthy(total, caveat) {
  return {
    added: [],
    modified: [],
    removed: [],
    unchanged: 0,
    changed: null,
    trust: false,
    caveat,
    total,
  };
}

/**
 * 差分的中文表述。**0 变更与不可信必须长得不一样** ——
 * 「没变」和「没算出来」在页面上都显示成一行字的话，等于把后者说成了前者。
 *
 * @param {FileDelta} d
 * @param {{limit?: number}} [opts] 每类最多列几条（超出明说还有多少，不静默截断）
 * @returns {string[]}
 */
export function describeDelta(d, { limit = 8 } = {}) {
  if (!d.trust) {
    return [
      `文件级差分：算不出来 —— ${d.caveat}`,
      `　本次看到 ${d.total} 个文件。这一枚点按「全量」记账，不许当「没变」。`,
    ];
  }
  if (d.changed === 0) {
    return [
      `文件级差分：0 个文件变化（本次清单 ${d.total} 个文件，逐个比对 mtime + size）。`,
      '　注意这只说明 mtime 与 size 都没动 —— 内容改了但两者都没变的情况看不见。',
    ];
  }
  const lines = [
    `文件级差分：新增 ${d.added.length} / 修改 ${d.modified.length} / 删除 ${d.removed.length}`
      + `（共 ${d.changed} 个，未动 ${d.unchanged} 个；按 mtime + size 判定）`,
  ];
  const section = (label, list) => {
    if (list.length === 0) return;
    const shown = list.slice(0, limit);
    lines.push(`　${label}（${list.length}）：${shown.join('、')}`);
    if (list.length > shown.length) {
      lines.push(`　　…还有 ${list.length - shown.length} 个没列出来（完整清单在 files.json 里）`);
    }
  };
  section('新增', d.added);
  section('修改', d.modified);
  section('删除', d.removed);
  return lines;
}

/**
 * 读上一份清单。**读不出来就返回 null** —— 由 `diffEntries` 去说「不可信」，
 * 这里不自己编一个空清单（空清单会被算成「删了全部文件」）。
 *
 * @param {{dir: string, projectId: string}} args
 * @returns {Manifest|null}
 */
export function readManifest({ dir, projectId }) {
  const file = manifestFile({ dir, projectId });
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.entries)) return null;
    return raw;
  } catch {
    return null;
  }
}

/**
 * 写本次清单。**写失败不算致命** —— 它只是下一次的「上一次」，
 * 丢了的结果是「下一次退化成全量」，不是「这一次结论错了」。
 * 所以这里返回结果让调用方决定要不要说，不抛。
 *
 * @param {{dir: string, projectId: string, ts: string, fingerprint: string, entries: Array<{rel: string, mtimeMs: number, size: number}>, truncated?: boolean}} args
 * @returns {{ok: boolean, file: string, issues: string[]}}
 */
export function writeManifest({ dir, projectId, ts, fingerprint, entries, truncated = false }) {
  const file = manifestFile({ dir, projectId });
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify(
        { schemaVersion: MANIFEST_SCHEMA_VERSION, ts, fingerprint, truncated, count: entries.length, entries },
        null,
        0
      ) + '\n',
      'utf8'
    );
    return { ok: true, file, issues: [] };
  } catch (err) {
    return { ok: false, file, issues: [`文件清单没落盘：${/** @type {Error} */ (err).message}（下一次会退化成全量）`] };
  }
}

/**
 * 读上一份 facts（给后端做 L2 沿用）。**读不出来返回 null**，
 * 调用方据此走全量 —— 不许拿空对象去冒充「上一份」，那会让后端沿用出一个空壳。
 *
 * @param {{dir: string, projectId: string}} args
 * @returns {Record<string, any>|null}
 */
export function readPrevFacts({ dir, projectId }) {
  try {
    const raw = JSON.parse(fs.readFileSync(factsFile({ dir, projectId }), 'utf8'));
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  } catch {
    return null;
  }
}

/**
 * 存本次 facts，供下一次沿用。**存不下就明说**，不退化成「静默没有缓存」——
 * 下一次会全量重算，那是正确行为，但用户有权知道它为什么慢。
 *
 * @param {{dir: string, projectId: string, ts: string, facts: Record<string, any>|null}} args
 * @returns {{ok: boolean, file: string, issues: string[]}}
 */
export function writePrevFacts({ dir, projectId, ts, facts }) {
  const file = factsFile({ dir, projectId });
  if (!facts || typeof facts !== 'object') {
    return { ok: false, file, issues: ['这次没采到 facts，没有可缓存的上一份（下一次会全量重算）'] };
  }
  let text;
  try {
    text = JSON.stringify({ ts, facts });
  } catch (err) {
    return { ok: false, file, issues: [`facts 序列化失败，没缓存：${/** @type {Error} */ (err).message}`] };
  }
  if (text.length > MAX_CACHED_FACTS_BYTES) {
    return {
      ok: false,
      file,
      issues: [`facts 有 ${(text.length / 1024 / 1024).toFixed(1)}MB，超过缓存上限，不存（下一次会全量重算）`],
    };
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
    return { ok: true, file, issues: [] };
  } catch (err) {
    return { ok: false, file, issues: [`facts 没缓存：${/** @type {Error} */ (err).message}（下一次会全量重算）`] };
  }
}
