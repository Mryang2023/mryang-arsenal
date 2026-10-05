/**
 * 构建期跑一致性引擎 → `src/generated/consistency.json`
 *
 * 为什么必须在构建期跑：站点是 `output:'export'` 的静态站，**运行时没有 fs**，
 * 浏览器里扫不了全仓。所以「命名有没有在漂」这件事只能在构建时算出结论，
 * 页面读结论 —— 与 `governance.json` / `ci-history.json` 同一个形状。
 *
 * 与 CI 场景的分工：CI 里跑的是 `charter-ci.mjs`（它 import 同一份引擎，只判 diff 触及的文件），
 * **不是**本脚本。本脚本扫全仓出存量账，CI 扫增量出 PR 门 —— 同一份逻辑，两个范围。
 *
 * 用法：`node scripts/calc-consistency.mjs [--json]`
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { scanConsistency } from './lib/consistency-engine.mjs';

const SELF = url.fileURLToPath(import.meta.url);
const WEB = path.resolve(path.dirname(SELF), '..');
const ROOT = path.resolve(WEB, '..');
const OUT = path.join(WEB, 'src', 'generated', 'consistency.json');

/** 只扫源码文件（与 CI 的 scan.include 同形状，别处不要另写一份口径）。 */
const INCLUDE = [
  '**/*.java', '**/*.kt', '**/*.xml', '**/*.yml', '**/*.yaml', '**/*.sql',
  '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.vue', '**/*.py', '**/*.sh', '**/*.properties',
];

const SKIP_DIRS = new Set([
  '.git', 'node_modules', 'target', 'build', 'dist', 'out', '.next', 'coverage',
  '.workbuddy', '.verify', 'shots', 'evidence',
]);

/** 单文件上限（超过就跳过并计数 —— 生成物与压缩包不是「命名」的观察对象）。 */
const MAX_FILE_BYTES = 384 * 1024;

function toPosix(p) {
  return p.replace(/\\/g, '/');
}

function matchesInclude(rel) {
  const lower = rel.toLowerCase();
  return INCLUDE.some((g) => {
    const ext = g.replace('**/*', '');
    return lower.endsWith(ext);
  });
}

/**
 * 从 scope glob 推出「必须 walk 的顶层前缀」。
 *
 * 为什么需要：全仓 2000+ 文件全读一遍要 30 秒，而「src/main/java 下面 archify 包」这种 scope
 * 的答案在那个子目录下就定了。**先剪枝再扫**是这里唯一的优化点，
 * 否则每次 `npm run sync` 都要为几条检查项付一次全仓读盘的代价。
 *
 * ⚠️ 注释里别照抄 glob 的双星形态 —— 那个序列里含「星号紧跟斜杠」，会把块注释提前闭合
 * （刚踩到两次，报错是「archify is not defined」，看上去完全不像注释问题）。
 *
 * @param {Object[]} items
 * @returns {string[]} 空串表示「全仓都要扫」
 */
function scopePrefixes(items) {
  /** @type {Set<string>} */
  const set = new Set();
  for (const it of items || []) {
    const s = String(it?.scope ?? '**');
    const head = s.split('**')[0].replace(/\/+$/, '');
    set.add(head);
  }
  return [...set];
}

/** @returns {{files:{path:string,content:string}[], skipped:number}} */
function walk(dir) {
  /** @type {{path:string,content:string}[]} */
  const files = [];
  let skipped = 0;
  const rec = (d) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        rec(p);
        continue;
      }
      const rel = toPosix(path.relative(ROOT, p));
      if (!matchesInclude(rel)) continue;
      let st;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      if (st.size > MAX_FILE_BYTES) {
        skipped += 1;
        continue;
      }
      let content;
      try {
        content = fs.readFileSync(p, 'utf8');
      } catch {
        skipped += 1;
        continue;
      }
      files.push({ path: rel, content });
    }
  };
  rec(dir);
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { files, skipped };
}

function main() {
  const charterPath = path.join(WEB, 'src', 'generated', 'charter.json');
  if (!fs.existsSync(charterPath)) {
    console.error('[consistency] 找不到 src/generated/charter.json —— 先跑 npm run sync:content');
    return 1;
  }
  const charter = JSON.parse(fs.readFileSync(charterPath, 'utf8'));
  const docs = (Array.isArray(charter?.charters) ? charter.charters : [])
    .map((c) => c?.doc)
    .filter(Boolean);
  const items = docs.flatMap((d) => (d?.consistency ?? []).map((c) => ({ ...c, charterId: d.id })));

  const t0 = Date.now();
  // 按 scope 前缀剪枝：只有「没有任何 scope 限定到某个子目录」时才全仓扫
  const prefixes = scopePrefixes(items);
  const haveWildcard = prefixes.includes('');
  const roots = haveWildcard ? [ROOT] : prefixes.map((p) => path.join(ROOT, p));
  let files = [];
  let skipped = 0;
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    const got = walk(r);
    files = files.concat(got.files);
    skipped += got.skipped;
  }
  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  const result = scanConsistency(items, files);
  const ms = Date.now() - t0;

  const out = {
    schema: 'arsenal-consistency/1',
    generatedAt: new Date().toISOString(),
    repo: path.basename(ROOT),
    charterIds: docs.map((d) => d.id),
    scan: {
      candidateFiles: files.length,
      skippedLargeOrUnreadable: skipped,
      includeExts: INCLUDE,
      skipDirs: [...SKIP_DIRS].sort(),
      elapsedMs: ms,
    },
    totals: result.totals,
    items: result.items,
    notes: [
      '本文件由 scripts/calc-consistency.mjs 生成，请勿手改。',
      'status=no-files 表示这条检查的 scope 没匹配到任何文件 —— 它不是「通过」，是「没在检查任何东西」。',
      '引擎只发现配置里列出的写法（canonical/forbidden）及其近义变体；没列过的全新同义词发现不了。',
    ],
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');

  const t = result.totals;
  console.log(
    `[consistency] ${t.items} 项 · 扫描 ${files.length} 文件（跳过 ${skipped}）/ ${ms}ms`,
  );
  console.log(
    `         漂移 ${t.drift} · 命中禁用写法 ${t.forbiddenHit} · 摆设（scope 零文件）${t.noFiles} · 一致 ${t.clean} · 阻断 ${t.blocking}`,
  );
  for (const r of result.items) {
    if (r.status === 'clean') continue;
    const tail = r.status === 'no-files'
      ? `scope \`${r.scope}\` 零文件 —— 这条当前没在检查任何东西`
      : `${r.variantCount} 种写法（上限 ${r.minVariants}）：${r.variants.slice(0, 6).map((v) => `${v.variant}${v.kind === 'forbidden' ? '(禁用)' : ''}×${v.count}`).join('、')}`;
    console.log(`         · ${r.id} ${r.concept} → ${r.status}：${tail}`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  process.exit(main());
}
