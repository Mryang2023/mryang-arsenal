#!/usr/bin/env node
/**
 * calc-ci-history.mjs —— 把 `arsenal-standards/ci-history.jsonl` 汇总成页面能读的产物。
 *
 * 为什么要有这一步：页面是静态导出，渲染时读不到磁盘；而「门禁在不在跑、判了多少」
 * 这个问题的答案就在 jsonl 里。汇总一次、页面读产物，与治理台那套
 * （lib/standards.ts → calc-governance.ts → generated）**同一个思路**。
 *
 * jsonl 从哪来：`charter-ci.mjs lint --history <路径>` 每次判定追加一行。
 * 它**进 Git**（与 visual/report.md 同类：CI 产物要能被静态站读到，就得有地方存）。
 * 代价是「跑一次门禁 = 一次提交」，所以页面上要说清「最后一次判罚是什么时候」，
 * 而不是让人以为这是实时的。
 *
 * 数据缺失时**不编数字**：没有 jsonl 就写 status=empty，页面明说「尚无判罚记录」。
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '..');
const srcPath = path.join(repoRoot, 'arsenal-standards', 'ci-history.jsonl');
const outPath = path.join(webRoot, 'src', 'generated', 'ci-history.json');

function writeEmpty(reason) {
  const payload = {
    schema: 'arsenal-ci-history/1',
    status: 'empty',
    reason,
    generatedAt: new Date().toISOString(),
    total: 0,
    latest: null,
    byMode: {},
    series: [],
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  return payload;
}

if (!fs.existsSync(srcPath)) {
  const p = writeEmpty('arsenal-standards/ci-history.jsonl 不存在 —— 门禁还没跑过，或跑的时候没带 --history');
  console.log(`[ci-history] ${p.reason} → 写 empty，页面会明说「尚无判罚记录」`);
  process.exit(0);
}

const rows = [];
let bad = 0;
for (const line of fs.readFileSync(srcPath, 'utf8').split(/\r?\n/)) {
  const s = line.trim();
  if (!s) continue;
  try {
    const r = JSON.parse(s);
    // 只认形状完整且 mode 合法的行：历史文件是人写的，坏行不该让页面整体崩，
    // 但也**不能悄悄跳过** —— 计数带出去（bad），页面会显示「N 行读不出来」。
    if (!r || typeof r.at !== 'string' || (r.mode !== 'pr' && r.mode !== 'audit')) {
      bad += 1;
      continue;
    }
    rows.push(r);
  } catch {
    bad += 1;
  }
}

if (rows.length === 0) {
  const p = writeEmpty(`jsonl 存在但一行都读不出来（共 ${bad} 行坏行）`);
  console.log(`[ci-history] ${p.reason}`);
  process.exit(0);
}

rows.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
const latest = rows[rows.length - 1];
const byMode = {};
for (const r of rows) {
  const m = (byMode[r.mode] = byMode[r.mode] || { runs: 0, blocking: 0, blockedRuns: 0, waived: 0 });
  m.runs += 1;
  m.blocking += Number(r.blocking || 0);
  m.waived += Number(r.waived || 0);
  if (Number(r.exitCode) !== 0) m.blockedRuns += 1;
}

const payload = {
  schema: 'arsenal-ci-history/1',
  status: 'ok',
  generatedAt: new Date().toISOString(),
  source: 'arsenal-standards/ci-history.jsonl',
  badLines: bad,
  total: rows.length,
  firstAt: rows[0].at,
  latest,
  byMode,
  // 趋势最多取最近 30 条：再多页面也读不出来，而趋势图要看的是「最近在变好还是变坏」
  series: rows.slice(-30).map((r) => ({
    at: r.at, mode: r.mode, files: r.files, blocking: r.blocking,
    advisory: r.advisory, waived: r.waived, exitCode: r.exitCode,
  })),
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
console.log(
  `[ci-history] 判罚历史已汇总 · ${payload.total} 次`
  + `（PR 门 ${byMode.pr ? byMode.pr.runs : 0} 次 / 存量 ${byMode.audit ? byMode.audit.runs : 0} 次）`
  + ` · 最近一次 ${latest.at.slice(0, 19).replace('T', ' ')} ${latest.mode}`
  + ` 判负 ${latest.blocking} · 拦截 ${Number(latest.exitCode) !== 0 ? '是' : '否'}`
  + (bad ? ` · ⚠ ${bad} 行读不出来` : ''),
);
