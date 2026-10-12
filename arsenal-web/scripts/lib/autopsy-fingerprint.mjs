/**
 * 解剖台指纹 —— 「这份输入变了吗」的唯一算法出处。
 *
 * 三种输入，三种指纹，**但它们的目的只有一个**：让「这次要不要重扫」这个决定
 * 有据可依，而不是靠「上次好像扫过」。
 *
 * ┌─ 输入 ─────────┬─ 指纹 ────────────────────────┬─ 盲区（页面必须写明） ─────────┐
 * │ 本地目录        │ 递归树 rel+mtimeMs+size        │ 内容改了但 mtime/size 没变会漏 │
 * │ git 仓库        │ HEAD + `git status --porcelain`│ 未跟踪的新文件在 porcelain 里有 │
 * │ 体检报告（浏览器）│ root + files + bytes          │ 只比规模，同尺寸改动必漏        │
 * └───────────────┴──────────────────────────────┴──────────────────────────┘
 *
 * ★ 「不许读全量内容」是一条硬规矩：大仓库（本仓 7500+ 文件）逐文件 readFileSync
 *   会把一次「要不要重扫」的判断变成比真扫一遍还慢的操作。代价就是上面那栏盲区 ——
 *   这是**取舍不是缺陷**，不许在页面上声称 100% 准确。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
// 项目身份**不在这里实现** —— 它必须与浏览器侧同一个算法（否则落盘按 A 分组、
// 文件按 B 命名，`listSnapshots({projectId})` 永远查不到，而页面上只说「还没有快照」）。
// 出处是 autopsy-snapshot-shape.mjs（零 node 依赖，两个运行时都能 import），这里转发出去。
import { projectIdOf } from './autopsy-snapshot-shape.mjs';

export { projectIdOf };

/** @param {string} s @returns {string} */
export function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * 默认跳过的目录。
 *
 * ★ 这不是洁癖：`.git` / `node_modules` / `target` 动辄几万到几十万文件，
 *   逐条 `statSync` 会让「要不要重扫」这个判断本身变成几分钟的 IO ——
 *   比真扫一遍还慢，那这个功能就没有意义了。
 *   而且它们的变化（比如 `npm install`）与「业务代码变没变」无关，
 *   算进指纹只会让 L1 永远不命中。
 */
export const DEFAULT_SKIP_DIRS = [
  '.git',
  'node_modules',
  'target',
  'dist',
  'build',
  '.next',
  'out',
  '.idea',
  '.venv',
  '__pycache__',
];

/** @param {string} rel 目录相对路径（带尾斜杠） */
function defaultSkip(rel) {
  const name = rel.slice(0, -1).split('/').pop() ?? '';
  return DEFAULT_SKIP_DIRS.includes(name);
}

/**
 * 递归收集目录树的「轻量坐标」。**不打开任何文件内容** —— 只读 stat。
 * 排序是必须的：readdir 的顺序在两套文件系统上不一样，不排序同一个目录会算出两个指纹。
 *
 * @param {string} root
 * @param {Object} [opts]
 * @param {number} [opts.maxEntries] 上限，超过即截断（截断会让指纹失去意义，故同时返回 truncated）
 * @param {(rel: string) => boolean} [opts.skip] 返回 true 则跳过该目录（如 node_modules / .git）
 * @returns {{entries: Array<{rel: string, mtimeMs: number, size: number}>, files: number, bytes: number, truncated: boolean, error?: string}}
 */
export function collectDirTree(root, opts = {}) {
  const maxEntries = opts.maxEntries ?? 200000;
  const skip = opts.skip ?? defaultSkip;
  const entries = [];
  let files = 0;
  let bytes = 0;
  let truncated = false;
  let error;

  const walk = (abs, rel) => {
    if (truncated) return;
    let items;
    try {
      items = fs.readdirSync(abs, { withFileTypes: true });
    } catch (err) {
      error = /** @type {Error} */ (err).message;
      return;
    }
    // 目录名排序：保证同一棵树在任何机器上得到同一个顺序
    items.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const it of items) {
      if (truncated) return;
      const childRel = rel === '' ? it.name : `${rel}/${it.name}`;
      const childAbs = path.join(abs, it.name);
      if (it.isDirectory()) {
        if (skip(`${childRel}/`)) continue;
        walk(childAbs, childRel);
        continue;
      }
      if (!it.isFile()) continue;
      if (entries.length >= maxEntries) {
        truncated = true;
        return;
      }
      let st;
      try {
        st = fs.statSync(childAbs);
      } catch {
        // 权限 / 已删除：记一个「读不到」的坐标，不要让整棵树静默少一项
        entries.push({ rel: childRel, mtimeMs: -1, size: -1 });
        files += 1;
        continue;
      }
      entries.push({ rel: childRel, mtimeMs: Math.round(st.mtimeMs), size: st.size });
      files += 1;
      bytes += st.size;
    }
  };

  walk(root, '');
  entries.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
  return { entries, files, bytes, truncated, ...(error ? { error } : {}) };
}

/**
 * 目录指纹（mtime + size 树）。
 *
 * @param {Array<{rel: string, mtimeMs: number, size: number}>} entries
 * @returns {string}
 */
export function fingerprintDirTree(entries) {
  const lines = entries.map((e) => `${e.rel}\t${e.mtimeMs}\t${e.size}`);
  return sha256Hex(lines.join('\n'));
}

/**
 * git 指纹：HEAD commit + 未提交改动（porcelain 全量）。
 *
 * @param {{head: string, status: string}} state
 * @returns {string}
 */
export function fingerprintGitState({ head, status }) {
  return sha256Hex(`head=${head}\nstatus=${status}`);
}

/**
 * 读一个仓库的 git 状态。**argv 传参不拼 shell**（命令注入这门课本仓在
 * `SourceResolver` 那边已经补过一次，这里照做）+ 关掉 hooks 与凭据交互：
 * 指纹是一次只读探测，不该有副作用、更不该弹窗要密码。
 *
 * @param {string} repoPath
 * @returns {{head: string, status: string}|null} 不是 git 仓库或 git 不可用时返回 null
 */
export function readGitState(repoPath) {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  // `-c` 不是 `--config`：后者 git 主命令不认，会整条失败并静默返回 null
  const run = (/** @type {string[]} */ args) =>
    spawnSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', repoPath, ...args], {
      encoding: 'utf8',
      env,
      timeout: 10000,
    });
  const head = run(['rev-parse', 'HEAD']);
  if (head.status !== 0) return null;
  const status = run(['status', '--porcelain']);
  return {
    head: (head.stdout ?? '').trim(),
    status: (status.status === 0 ? status.stdout ?? '' : '').trim(),
  };
}

/**
 * 一句话的指纹口径说明 —— 页面上要原样显示，**不许包装成「已校验无变化」**。
 *
 * @param {'dir'|'git'|'report'} kind
 * @returns {string}
 */
export function fingerprintCaveat(kind) {
  if (kind === 'dir') return '目录指纹基于 mtime + size，内容改了但两者都没变时会漏检';
  if (kind === 'git') return 'git 指纹基于 HEAD 与未提交改动，工作区之外的影响因素不参与';
  return '报告指纹只比根目录名 / 文件数 / 字节数，同尺寸的改动一定漏检';
}
