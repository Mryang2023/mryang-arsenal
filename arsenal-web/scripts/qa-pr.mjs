#!/usr/bin/env node
/**
 * PR 机器人（CI 形态）—— `node scripts/qa-pr.mjs --base <ref> [--head <ref>] [--api ...]`
 *
 * 一句话：**push 之后 CI 调它，只审这次 diff，把报告贴进流水线产物。**
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么第一步是 CLI 而不是 webhook（计划书 C3 的边界）：
 *   webhook 要公网入口。本机 PortableGit 的 push 会假死、CI runner 也没有 ——
 *   先做无公网依赖的 CI 形态，把「只审 diff」这件事做扎实，再谈公网。
 *
 * ─────────────────────────────────────────────────────────────
 * 四条不许破的规矩：
 *
 * ① **只审 diff，但要说清「只审到哪」。**
 *    行级映射来自 unified diff 的 hunk 头；解析不出来时**返回空而不是全选** ——
 *    「这次改动影响了整个文件」是最不该有的默认值（那样等于没审）。
 *    页面上必须写「本次映射到 N 行 / 该文件共 M 行」，覆盖率不隐藏。
 *
 * ② **行级映射不许重写一套。** 出处是 `src/lib/call-closure.ts` 的
 *    `findingTouchedByDiff` / `changedLinesFromDiff`，与功能视图共用同一份 ——
 *    「这个改动影响了哪些功能」和「哪些 finding 落在改动里」必须用同一个答案。
 *
 * ③ **闭包缺失时不许装作没影响。** 拿不到 facts（后端没起 / 没扫过）时，
 *    结论是「无法判定影响面」，退出码 2 —— 不是「通过」。
 *
 * ④ **退出码三档。** 0 = 没有 P0；1 = 有 P0（门禁红）；2 = 没跑起来。
 *    2 必须与 1 分开：CI 里「审不动」被当成「通过」，那是最贵的一种假绿。
 *
 * 零外部依赖：只用 node 内置模块 + git CLI（数组参数，不拼 shell）。
 *
 * ⚠ **必须用 tsx 跑**（`npm run qa:pr`），不能 `node scripts/qa-pr.mjs` ——
 *   它 import 了 `src/lib/call-closure.ts`（与功能视图同一份闭包聚类）。
 *   抄一份 .mjs 的等价实现会让「功能视图说的影响面」和「PR 机器人说的影响面」分家，
 *   而这两个数一旦不一致，最难查的地方正是「为什么页面上说受影响、CI 说没受影响」。
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { spawnSync } from 'node:child_process';

import { affectedFeatures, buildFunctionView, findingTouchedByDiff } from '../src/lib/call-closure.ts';

const DEFAULT_API = 'http://127.0.0.1:3011';
const TIMEOUT_MS = 600_000;

export function parseArgs(argv) {
  const flags = {};
  const cmd = String(argv[2] ?? '').trim();
  for (let i = 3; i < argv.length; i += 1) {
    const tok = argv[i];
    if (!tok.startsWith('--')) continue;
    const eq = tok.indexOf('=');
    const key = eq < 0 ? tok.slice(2) : tok.slice(2, eq);
    if (eq >= 0) flags[key] = tok.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[key] = argv[++i];
    else flags[key] = true;
  }
  return { cmd, flags };
}

/**
 * 取 diff 文本。**argv 传参不拼 shell** —— 仓库名/分支名进命令行的次数太多了，
 * 拼一次就多一个注入面（`SourceResolver` 与 `RunSandbox` 都已经补过一次）。
 */
export function gitDiff(repoDir, base, head) {
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const args = ['-c', 'core.hooksPath=/dev/null', '-C', repoDir, 'diff', '--unified=3'];
  if (base) args.push(base);
  if (head) args.push(head);
  const r = spawnSync('git', args, { encoding: 'utf8', env, timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) {
    return { ok: false, text: '', reason: `git diff 失败（${r.error?.code ?? r.status}）：${(r.stderr ?? '').slice(0, 300)}` };
  }
  return { ok: true, text: r.stdout ?? '', reason: '' };
}

/** 从 unified diff 里抽出「这次动了哪些文件」。路径以仓库相对路径为准。 */
export function changedFilesFromDiff(diffText) {
  const files = new Set();
  for (const line of diffText.split('\n')) {
    if (!line.startsWith('+++ ')) continue;
    const p = line.slice(4).trim();
    if (p === '/dev/null') continue;
    files.add(p.startsWith('b/') ? p.slice(2) : p);
  }
  return [...files].sort();
}

async function postJson(base, apiPath, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}${apiPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const env = await res.json();
    if (!env?.success || env.data == null) {
      return { ok: false, message: env?.message || `HTTP ${res.status}` };
    }
    return { ok: true, data: env.data };
  } catch (e) {
    return { ok: false, message: `连不上后端 ${base}（${e.name === 'AbortError' ? '超时' : e.message}）` };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 审一次。**纯逻辑部分（行级映射 / 影响面）在这里，判定在报告形状里** ——
 * 与本仓其他判据层同款：能直接验证的部分不藏在副作用里。
 */
export function review({ diffText, facts, report }) {
  const files = changedFilesFromDiff(diffText);
  // facts 是 /api/scan/facts 的完整事实 —— 调用边/路由/入口都挂在 code 段下，
  // 直接整个传进去等于传一张空图（与 FunctionPanel 2026-10-14 修的同一个坑）。
  const view = facts ? buildFunctionView({ ...facts.code }) : null;
  const impacted = view ? affectedFeatures(view, files) : [];

  const staticFindings = [];
  // 体检报告的三档是**平铺**的 p0 / p1 / other 三个数组（AutopsyReport 的形状），
  // 不是 staticFindings.tier —— 照抄一个不存在的层会把「N 条结论」变成 0，
  // 而 0 在门禁里读起来就是「没问题」。
  for (const tier of ['p0', 'p1', 'other']) {
    for (const f of report?.[tier] ?? []) staticFindings.push({ ...f, tier });
  }
  const semanticFindings = report?.semanticFindings ?? [];

  /** 一条 finding 是否落在本次 diff 里。查不到映射的行 → 不算「这次引入的」 */
  const judge = (f) => {
    const touched = findingTouchedByDiff(f, diffText);
    return { ...f, touched, tier: f.tier ?? 'semantic' };
  };
  const touchedStatic = staticFindings.map(judge).filter((f) => f.touched);
  const touchedSemantic = semanticFindings.map(judge).filter((f) => f.touched);

  /** 覆盖率要报出来：不隐藏「没审到的那部分」 */
  const coverage = {
    changedFiles: files.length,
    mappedFeatures: impacted.length,
    staticFindingsTotal: staticFindings.length,
    staticFindingsInDiff: touchedStatic.length,
    semanticFindingsTotal: semanticFindings.length,
    semanticFindingsInDiff: touchedSemantic.length,
    note: '「不在 diff 里」的 finding 不是不存在，是这次没碰到它 —— '
      + '行级映射靠 unified diff 的 hunk 头，解析不出来的行一律不计入',
  };

  const p0 = touchedStatic.filter((f) => f.tier === 'p0');
  return {
    status: p0.length > 0 ? 'blocked' : 'clean',
    files,
    impacted: impacted.map((c) => ({
      id: c.id,
      label: c.label,
      classes: c.classes.length,
      files: c.files.length,
      inbound: c.inbound.length,
    })),
    findings: [...touchedStatic, ...touchedSemantic],
    p0Count: p0.length,
    coverage,
    reasons: [],
  };
}

export function formatReport(r) {
  const L = [];
  L.push('════ PR 机器人 · 只审本次 diff ════');
  L.push(
    r.coverage.changedFiles > 0
      ? `改动 ${r.coverage.changedFiles} 个文件，映射到 ${r.coverage.mappedFeatures} 条功能链`
      : '这次 diff 里没有可审的文件'
  );
  if (r.impacted.length > 0) {
    L.push('受影响的功能：');
    for (const c of r.impacted) {
      L.push(`  · ${c.label}　${c.classes} 类 / ${c.files} 文件${c.inbound > 0 ? ` / 外部打进 ${c.inbound} 条` : ''}`);
    }
  } else {
    L.push('受影响的功能：映射不到 —— 拿不到调用关系时这不是「没影响」，是「不知道」。');
  }
  L.push('');
  L.push(
    `本次 diff 里命中的结论：静态 ${r.coverage.staticFindingsInDiff}/${r.coverage.staticFindingsTotal}`
      + `（P0 ${r.p0Count}）· 语义 ${r.coverage.semanticFindingsInDiff}/${r.coverage.semanticFindingsTotal}`
  );
  for (const f of r.findings.slice(0, 40)) {
    L.push(`  [${f.tier}] ${f.file}:${f.line} — ${f.impact ?? f.evidence ?? ''}`.trimEnd());
  }
  if (r.findings.length > 40) L.push(`  …还有 ${r.findings.length - 40} 条`);
  L.push('');
  L.push(`覆盖率口径：${r.coverage.note}`);
  L.push('');
  L.push(r.status === 'blocked' ? `门禁：红（${r.p0Count} 条 P0 落在本次 diff 里）` : '门禁：绿');
  return L;
}

export async function main(argv) {
  const { flags } = parseArgs(argv);
  const repo = String(flags.repo ?? process.cwd());
  const base = typeof flags.base === 'string' ? flags.base : '';
  const head = typeof flags.head === 'string' ? flags.head : '';
  const api = typeof flags.api === 'string' ? flags.api : DEFAULT_API;
  const out = typeof flags.out === 'string' ? flags.out : '';

  if (!base && !flags['staged']) {
    console.error('缺少 --base <ref>（要比哪个基线）或 --staged（只审暂存区）');
    return 2;
  }
  const d = flags.staged
    ? gitDiff(repo, null, '--staged')
    : gitDiff(repo, base, head || null);
  if (!d.ok) {
    console.error(`diff 拿不到：${d.reason}`);
    return 2;
  }
  const diffText = d.text;
  const files = changedFilesFromDiff(diffText);
  if (files.length === 0) {
    console.log('这次 diff 里没有文件（空提交或只有二进制）—— 门禁绿，但不是因为审过了什么。');
    return 0;
  }

  const source = { kind: 'path', value: repo };
  const [factsR, reportR] = await Promise.all([
    postJson(api, '/api/scan/facts', { source }),
    // 同步体检走 /api/autopsy/inspect。**不是** /api/qa/* —— 那条是异步 Job，
    // CI 里等一个 job 再取报告要多两个往返与一次轮询，而门禁要的是「这次 diff 的结论」。
    postJson(api, '/api/autopsy/inspect', { source }),
  ]);

  if (!factsR.ok) {
    console.error(`拿不到 facts → 无法判定影响面：${factsR.message}`);
    console.error('这不是「没有影响」，是「没跑起来」。CI 里请把它当失败处理（退出码 2）。');
    return 2;
  }

  const r = review({ diffText, facts: factsR.data, report: reportR.ok ? reportR.data : null });
  if (!reportR.ok) {
    r.reasons.push(`体检报告没取到（${reportR.message}）—— 静态结论那部分是空的，不是「没问题」`);
  }
  const text = formatReport(r).join('\n');
  console.log(text);
  if (out) {
    try {
      fs.mkdirSync(path.dirname(path.resolve(repo, out)), { recursive: true });
      fs.writeFileSync(path.resolve(repo, out), text + '\n', 'utf8');
      console.log(`\n报告已写：${out}`);
    } catch (e) {
      console.error(`报告写不下（${e.message}）—— 已打在标准输出里`);
    }
  }
  return r.status === 'blocked' ? 1 : 0;
}

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
      process.exit(2);
    }
  );
}
