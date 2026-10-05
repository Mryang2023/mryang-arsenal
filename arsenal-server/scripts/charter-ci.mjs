#!/usr/bin/env node
/**
 * charter-ci.mjs —— 项目章程的 **CI 执行器**（导出 + 判定，一个文件两种模式）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么是「一个文件、两种模式」
 *
 * CI 片段里原本写的是 `npx arsenal-lint`——一个**并不存在**的包。
 * 而让业务仓为了跑一次门禁去 `npm i` 一个还没发布的包，是把「工具好用」
 * 变成「工具要先有发布流程」。所以：
 *
 *   export 模式  跑在**军火库**里（它要读 arsenal-rules/ 与 arsenal-charter/），
 *                把「判定所需的一切」打成一个自包含目录 `.arsenal/ci/`：
 *                config.json（规则正则 + 生效条款 + 例外 + policy 判负口径 + 文件清单）
 *                + 本文件的一份副本（lint 模式**零 import**，拷过去就能跑）。
 *   lint 模式    跑在**业务仓 CI** 里，只读 config.json。除了 node 内置模块
 *                它不 import 任何东西 —— 不引军火库的 TS、不引 npm 包。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 三条设计纪律（每一条都对应一类真实失败）
 *
 * 1. **判负口径不写死。** 例外到期要不要判负、孤儿例外拦不拦，读的是 config 里的
 *    `charter.policy` —— 那是**用户自己章程**里的字段。片段写死等于越权。
 *    （CI 片段本身不写死，这里也不写死。）
 *
 * 2. **PR 门只查 diff 触及的文件。** 存量不合规是必然的，第一次跑就报 300 条红，
 *    第二次就没人愿意用了。文件清单在 export 阶段算好写进 config ——
 *    判定阶段不再碰 git，于是「浅克隆导致 diff 为空」不会变成「静默全绿」。
 *
 * 3. **检不了就说检不了。** 章程条款的 ast / llm / manual 层、`override.replace`
 *    （契约里 replacement 是**描述**不是可执行 pattern）一律进 skipped 并打印，
 *    绝不用「假设它通过了」来凑一个全绿。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 判定与 `arsenal-web/src/lib/engine.ts` 的关系（重要）
 *
 * 引擎是 TypeScript、跑在浏览器/校验台；这里是 .mjs、跑在 CI。
 * 两者对「什么算违规」的判断必须**逐条一致**，而本仓最忌讳「同一规矩两份实现」。
 * 所以这里不 import 引擎（跨 TS/MJS 边界反而更脆），而是：
 *   · 语义照抄引擎（pattern / flags / expect / targetGlob / 同规则同文件折叠）
 *   · 由 `charter-check`【15】做**跨实现一致性断言**：同一批样本、同一批规则，
 *     两边跑出来的 (ruleId, file, line) 三元组必须逐条相同。
 *   · 改了一边而另一边没改 → 那条断言立刻红。
 *
 * 用法（业务仓 CI 里）：
 *   node .arsenal/ci/charter-ci.mjs lint --config .arsenal/ci --mode pr
 *   node .arsenal/ci/charter-ci.mjs lint --config .arsenal/ci --mode audit --report debt.md
 *
 * 用法（军火库里生成 config）：
 *   node arsenal-server/scripts/charter-ci.mjs export --mode pr   --out .arsenal/ci --base origin/main
 *   node arsenal-server/scripts/charter-ci.mjs export --mode audit --out .arsenal/ci
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { execFileSync } from 'node:child_process';

const SELF = url.fileURLToPath(import.meta.url);
const ARSENAL_ROOT = path.resolve(path.dirname(SELF), '..', '..');
const CONFIG_NAME = 'config.json';
const EXECUTOR_NAME = 'charter-ci.mjs';

const MAX_HITS_PER_RULE_PER_FILE = 200;   // 与 engine.ts 同值：防 pathological 正则
const MAX_REPORTED_PER_RULE_PER_FILE = 5;  // 同上：同一规则同文件最多报 5 条，其余折叠计数
const SNIPPET_MAX = 140;
const DEFAULT_FAIL_ON = ['MUST', 'NEVER'];

/* ═══════════════════════════════════════════════════════════════════════
   一、纯函数区（lint 模式只用这一段，零 import）
   ═══════════════════════════════════════════════════════════════════════ */

/** @param {string} p */
function normalizePath(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
}

/** @param {string} s */
function escapeLiteral(s) {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

/**
 * glob → RegExp。与 engine.ts 的 globToRegExp **逐行同义**（`**` 跨目录、`*` 单层、
 * `?` 单字符、`{a,b}` 枚举、大小写不敏感）。改一边必须改另一边 —— 【15】断言会红。
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          out += '(?:.*/)?';
        } else {
          out += '.*';
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end === -1) {
        out += '\\{';
      } else {
        out += '(?:' + glob.slice(i + 1, end).split(',').map(escapeLiteral).join('|') + ')';
        i = end;
      }
    } else {
      out += escapeLiteral(c);
    }
  }
  return new RegExp('^' + out + '$', 'i');
}

/**
 * 预建换行索引 + 二分定位（与 engine.ts makeLocator 同算法）。
 * @param {string} text
 * @returns {(index:number)=>{line:number,column:number}}
 */
function makeLocator(text) {
  /** @type {number[]} */
  const nl = [];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) nl.push(i);
  return (index) => {
    let lo = 0;
    let hi = nl.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (nl[mid] < index) lo = mid + 1;
      else hi = mid;
    }
    const lineStart = lo === 0 ? 0 : nl[lo - 1] + 1;
    return { line: lo + 1, column: index - lineStart + 1 };
  };
}

/**
 * @param {string} text @param {number} index @param {string} matchText
 * @returns {string}
 */
function snippetAt(text, index, matchText) {
  const lineStart = text.lastIndexOf('\n', index) + 1;
  let lineEnd = text.indexOf('\n', index);
  if (lineEnd === -1) lineEnd = text.length;
  let s = text.slice(lineStart, lineEnd).trim();
  if (!s && matchText) s = matchText.split('\n')[0].trim();
  if (s.length > SNIPPET_MAX) s = s.slice(0, SNIPPET_MAX) + '…';
  return s;
}

/**
 * @param {RegExp} re @param {string} text
 * @returns {{index:number,text:string}[]}
 */
function collectMatches(re, text) {
  const out = [];
  re.lastIndex = 0;
  let m;
  let guard = 0;
  while ((m = re.exec(text)) !== null) {
    out.push({ index: m.index, text: m[0] });
    if (m[0] === '') re.lastIndex += 1;
    if (++guard > 20000) break;
    if (out.length >= MAX_HITS_PER_RULE_PER_FILE) break;
  }
  return out;
}

/**
 * ★ 例外豁免：**双条件**（clauseId + pathGlob），缺一不可。
 *
 * 拍板项 ③ 的落点。如果只按 clauseId 豁免，一行 JSON 就能让一条 MUST 条款
 * 在全仓失效 —— 治理会从「有台账」退化成「有开关」。所以这里要求文件路径
 * 也落在例外登记的 pathGlob 内才放行，并**留痕**（进 waived 列表），让人知道
 * 这次是靠哪张条子过的。
 *
 * @param {Array<any>} exceptions @param {string} clauseId @param {string} file
 * @returns {{ok:boolean, reason?:string, exception?:any}}
 */
export function exceptionCovered(exceptions, clauseId, file) {
  const f = normalizePath(file);
  for (const ex of exceptions || []) {
    if (ex.clauseId !== clauseId) continue;
    if (ex.status !== 'active') continue;
    const g = ex.pathGlob ? globToRegExp(ex.pathGlob) : null;
    if (g && !g.test(f)) continue;
    return { ok: true, exception: ex, reason: `例外 ${ex.id} 放行（${ex.pathGlob || '全项目'}，到期 ${ex.expiresAt}）` };
  }
  return { ok: false };
}

/**
 * ★ 一条规则的最终判定集：override（relax 忽略 / replace 不自动执行）先于例外。
 *
 * @param {any} rule @param {string} file
 * @returns {{ignored:boolean, note?:string}}
 */
export function overrideGateFor(rule, file) {
  const f = normalizePath(file);
  for (const ov of rule.overrides || []) {
    if (ov.ruleId !== rule.id) continue;
    const g = ov.pathGlob ? globToRegExp(ov.pathGlob) : null;
    if (g && !g.test(f)) continue;
    if (ov.action === 'relax') {
      return { ignored: true, note: `override relax（${ov.approver || '未署名'} 批准，到期 ${ov.expiresAt || '未设'}）` };
    }
    if (ov.action === 'replace') {
      return {
        ignored: false,
        note: `override replace：契约里 replacement 是文字描述、不是可执行正则，本工具**不自动替换** —— 需人工确认后改 pattern`,
      };
    }
  }
  return { ignored: false };
}

/**
 * 核心判定：给定文件内容与规则集，返回违例清单 + 折叠计数 + 豁免留痕 + skipped。
 *
 * 与 engine.ts 的差异只有三处，且都是**引擎不需要的**：
 *   ① 章程条款多两个门槛：冻结线（effectiveFrom ≤ today）与 pathGlob 作用域；
 *   ② 例外双条件豁免（引擎没有「台账」这个概念）；
 *   ③ override 的 relax 忽略 / replace 提示。
 * L0 规则且不涉 override/例外时，输出与引擎逐条相同 —— 【15】断言守的就是这一点。
 *
 * @param {{name:string, content:string}[]} files
 * @param {any[]} rules
 * @param {{today?:string, exceptions?:any[], skipped?:any[], waived?:any[]}} [opt]
 */
export function lintFiles(files, rules, opt = {}) {
  const today = opt.today || '';
  const exceptions = opt.exceptions || [];
  const skipped = opt.skipped || [];
  const waived = opt.waived || [];

  const compiled = [];
  for (const r of rules) {
    const rx = r.check && r.check.regex;
    if (!rx || !rx.pattern) {
      skipped.push({
        ruleId: r.id,
        title: r.title || r.id,
        layer: r.layer || 'manual',
        reason: r.layer === 'ast'
          ? '需 Java AST 解析 —— CI 门禁只跑正则层（跑不了就说跑不了）'
          : r.layer === 'llm'
            ? '需语义判定 —— 交由人工或后端 Level 2'
            : '无法自动判定 —— 需人工过目',
      });
      continue;
    }
    if (r.source === 'charter') {
      if (today && r.effectiveFrom && r.effectiveFrom > today) {
        skipped.push({
          ruleId: r.id,
          title: r.title || r.id,
          layer: 'regex',
          reason: `条款 ${r.effectiveFrom} 才生效（判定日 ${today}）—— 冻结线之前不进 PR 门`,
        });
        continue;
      }
    }
    let body = null;
    try {
      const extra = String(rx.flags || '').replace(/[gm]/g, '');
      body = new RegExp(rx.pattern, 'gm' + extra);
    } catch {
      skipped.push({ ruleId: r.id, title: r.title || r.id, layer: 'regex', reason: '规则自身的正则无法编译 —— 这是规则缺陷，请修复' });
      continue;
    }
    compiled.push({
      rule: r,
      body,
      fileRe: rx.targetGlob ? globToRegExp(normalizePath(rx.targetGlob)) : null,
      clauseScopeRe: r.source === 'charter' && r.pathGlob ? globToRegExp(normalizePath(r.pathGlob)) : null,
      expect: rx.expect || 'absent',
    });
  }

  /** @type {any[]} */
  const violations = [];
  let totalLines = 0;
  let notApplicable = 0;

  for (const file of files) {
    const name = normalizePath(file.name || 'untitled');
    const text = file.content ?? '';
    totalLines += text ? text.split('\n').length : 0;
    const locate = makeLocator(text);

    for (const c of compiled) {
      if (c.fileRe && !c.fileRe.test(name)) { notApplicable++; continue; }
      if (c.clauseScopeRe && !c.clauseScopeRe.test(name)) { notApplicable++; continue; }

      const gate = overrideGateFor(c.rule, name);
      if (gate.ignored) {
        waived.push({ ruleId: c.rule.id, file: name, kind: 'override', reason: gate.note });
        continue;
      }
      if (gate.note) skipped.push({ ruleId: c.rule.id, title: c.rule.title || c.rule.id, layer: 'regex', reason: gate.note });

      const hits = collectMatches(c.body, text);
      const isViolation = c.expect === 'absent' ? hits.length > 0 : hits.length === 0;

      if (c.rule.source === 'charter') {
        const cover = exceptionCovered(exceptions, c.rule.id, name);
        if (cover.ok) {
          waived.push({ ruleId: c.rule.id, file: name, kind: 'exception', reason: cover.reason });
          continue;
        }
      }
      if (!isViolation) continue;

      const seenLines = new Set();
      const picked = [];
      let collapsed = 0;
      for (const h of hits) {
        const { line, column } = locate(h.index);
        if (seenLines.has(line)) continue;
        seenLines.add(line);
        if (picked.length < MAX_REPORTED_PER_RULE_PER_FILE) {
          picked.push({ line, column, snippet: snippetAt(text, h.index, h.text) });
        } else {
          collapsed += 1;
        }
      }
      // expect=present 且一个都没找到 → 违规点在「文件里没有它」，位置记 1:1。
      // 与 engine.ts 同措辞：这里说的不是某一行写错了，而是整份文件缺了必需写法。
      if (c.expect === 'present' && picked.length === 0) {
        picked.push({ line: 1, column: 1, snippet: `未找到必需内容：${c.rule.title || c.rule.id}` });
      }
      for (const p of picked) {
        violations.push({
          ruleId: c.rule.id,
          title: c.rule.title || c.rule.id,
          severity: c.rule.severity,
          source: c.rule.source || 'L0',
          category: c.rule.category || '',
          file: name,
          line: p.line,
          column: p.column,
          snippet: p.snippet,
          clauseOwner: c.rule.clauseOwner || null,
          effectiveFrom: c.rule.effectiveFrom || null,
          collapsed: 0,
        });
      }
      if (collapsed) {
        const last = violations[violations.length - 1];
        if (last && last.ruleId === c.rule.id && last.file === name) last.collapsed = collapsed;
      }
    }
  }

  return { violations, skipped, waived, fileCount: files.length, totalLines, notApplicable };
}

/**
 * 例外台账的处置（拍板项 ③ 之外的另一半：到期与孤儿怎么算）。
 * 口径全部读 `policy` —— **不写死**。
 *
 * @param {any[]} exceptions @param {any} policy @param {string} today
 */
export function auditExceptions(exceptions, policy, today) {
  const rows = [];
  for (const ex of exceptions || []) {
    let state = ex.status;
    const overdue = Boolean(ex.expiresAt) && ex.expiresAt < today;
    if (overdue && state === 'active') state = 'expired';
    let level = 'ok';
    if (state === 'expired') {
      if (policy.overdueException === 'error') level = 'error';
      else if (policy.overdueException === 'warn') level = 'warn';
      else level = 'ignore';         // ignore 不是静默：仍记账，只是不判负
    }
    if (state === 'orphaned' && policy.orphanBlocks === 'error') level = 'error';
    else if (state === 'orphaned' && policy.orphanBlocks === 'warn' && level === 'ok') level = 'warn';
    rows.push({ id: ex.id, clauseId: ex.clauseId, state, level, expiresAt: ex.expiresAt, owner: ex.owner, policyTag: level === 'ignore' ? 'policy.ignore' : null });
  }
  return rows;
}

/* ═══════════════════════════════════════════════════════════════════════
   二、export 模式（军火库侧）
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * @param {string[]} argv
 * @returns {{mode:string,out:string,base:string|null,repo:string,today:string,failOn:string[]}}
 */
function parseArgs(argv) {
  const a = {
    mode: 'pr', out: '.arsenal/ci', base: null, repo: process.cwd(),
    today: process.env.ARSENAL_TODAY || new Date().toISOString().slice(0, 10),
    filesFrom: null, failOn: DEFAULT_FAIL_ON, report: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--mode') a.mode = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--config') a.out = argv[++i];   // lint 的 --config 与 export 的 --out 同一个槽
    else if (k === '--base') a.base = argv[++i];
    else if (k === '--repo') a.repo = argv[++i];
    else if (k === '--today') a.today = argv[++i];
    else if (k === '--files-from') a.filesFrom = argv[++i];
    else if (k === '--report') a.report = argv[++i];
    else if (k === '--fail-on') a.failOn = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
  }
  return /** @type {any} */ (a);
}

/** @param {string} p @returns {any[]} */
function loadL0Rules(arsenalRoot) {
  const rulesDir = path.join(arsenalRoot, 'arsenal-rules');
  const out = [];
  for (const cat of fs.readdirSync(rulesDir)) {
    const dir = path.join(rulesDir, cat);
    if (!fs.statSync(dir).isDirectory() || cat.startsWith('_')) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      for (const r of doc.rules || []) {
        if (r.status !== 'active') continue;
        out.push({
          id: r.id, title: r.title, severity: r.severity, category: r.category,
          status: r.status, check: r.check, source: 'L0',
          layer: r.check && r.check.ast ? 'ast' : r.check && r.check.llm ? 'llm' : r.check && r.check.regex ? 'regex' : 'manual',
        });
      }
    }
  }
  return out;
}

/**
 * PR 门的文件清单。**拿不到就报错，不许当成「本次没改文件」** ——
 * 浅克隆 / base ref 写错都会让 git 返回空或失败，而空清单等于门禁静默失效。
 *
 * @param {string} repo @param {string|null} base @param {string|null} filesFrom
 * @returns {string[]}
 */
export function resolvePrFiles(repo, base, filesFrom) {
  if (filesFrom) {
    return fs.readFileSync(path.resolve(repo, filesFrom), 'utf8')
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  if (!base) {
    throw new Error('PR 门必须给 --base <ref>（例如 origin/main）或 --files-from <清单文件>。\n'
      + '         不给而默认「无文件」= 门禁静默失效，本工具拒绝这么干。');
  }
  const candidates = [base, `origin/${base}`];
  /** @type {string[]} */
  let lastErr = [];
  for (const ref of candidates) {
    try {
      const out = execFileSync('git', ['diff', '--name-only', `${ref}...HEAD`], {
        cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
      return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    } catch (e) {
      lastErr.push(String((e && /** @type {any} */ (e).stderr) || e).trim());
    }
  }
  throw new Error(`取不到 PR diff（试过 ${candidates.join(' / ')}）。\n`
    + `         浅克隆拿不到历史时请加 fetch-depth: 0，或改用 --files-from。\n`
    + `         git 的原话：${lastErr.join(' | ') || '(无)'}`);
}

/**
 * @param {string[]} argv @returns {Promise<number>}
 */
async function runExport(argv) {
  const a = parseArgs(argv);
  const repo = path.resolve(a.repo);
  const outDir = path.resolve(repo, a.out);

  // 章程目录解析与 sync 共用一份（避免第三份实现）—— 动态 import 让 lint 模式保持零依赖。
  // ⚠️ Windows 上动态 import 绝对路径必须给 file:// URL，给裸路径会报
  //「Only URLs with a scheme in: file, data, and node are supported」（踩过）。
  const { resolveCharterDir, readProfileCharterDir } = await import(
    url.pathToFileURL(path.join(ARSENAL_ROOT, 'arsenal-web', 'scripts', 'lib', 'charter-dir.mjs')).href
  );
  const { dir: charterDir, source: charterDirSource } = resolveCharterDir({
    repoRoot: ARSENAL_ROOT,
    profileCharterDir: readProfileCharterDir(path.join(ARSENAL_ROOT, 'arsenal-profiles', 'arsenal.json')),
  });

  const l0 = loadL0Rules(ARSENAL_ROOT);
  const charterFiles = fs.existsSync(charterDir)
    ? fs.readdirSync(charterDir).filter((f) => f.endsWith('.json')).sort()
    : [];
  if (charterFiles.length === 0) {
    throw new Error(`章程目录（${charterDirSource}：${charterDir}）里没有 .json —— `
      + '没有章程就没有「项目自己的规矩」，PR 门只能跑 L0。要么补章程，要么明确接受这一点。');
  }
  const docs = charterFiles.map((f) => JSON.parse(fs.readFileSync(path.join(charterDir, f), 'utf8')));

  const clauses = [];
  for (const d of docs) {
    for (const c of d.clauses || []) {
      clauses.push({
        id: c.id, title: c.title, severity: c.severity, category: c.category || 'charter',
        status: c.status || 'active', check: c.check, source: 'charter',
        clauseOwner: c.clauseOwner || null, decidedBy: c.decidedBy || null,
        effectiveFrom: c.effectiveFrom || null, pathGlob: c.pathGlob || null,
        layer: c.check && c.check.ast ? 'ast' : c.check && c.check.llm ? 'llm' : c.check && c.check.regex ? 'regex' : 'manual',
      });
    }
  }

  const exceptions = docs.flatMap((d) => (d.exceptions || []).map((e) => ({ ...e, charterId: d.id })));
  const overrides = docs.flatMap((d) => (d.overrides || []).map((o) => ({ ...o, charterId: d.id })));
  const policy = docs[0].policy || {};

  // 冻结线在**导出时**裁一次：只把 today 已生效的条款带进 config。
  // 判定阶段不再看日历 —— 同一份 config 跑两次结论必须一样。
  const inForce = clauses.filter((c) => !c.effectiveFrom || c.effectiveFrom <= a.today);
  const notYet = clauses.filter((c) => c.effectiveFrom && c.effectiveFrom > a.today);

  // override 挂到对应 L0 规则上，判定时按文件路径生效
  const rules = l0.map((r) => ({ ...r, overrides: overrides.filter((o) => o.ruleId === r.id) }));

  let files = [];
  if (a.mode === 'pr') {
    files = resolvePrFiles(repo, a.base, a.filesFrom);
  }

  const config = {
    schema: 'arsenal-charter-ci/1',
    generatedAt: new Date().toISOString(),
    today: a.today,
    mode: a.mode,
    failOn: a.failOn,
    repo: { path: repo, name: path.basename(repo) },
    charter: {
      id: docs[0].id,
      name: docs[0].name,
      version: docs[0].version,
      dir: charterDir,
      dirSource: charterDirSource,
      policy,
      budget: docs[0].budget || null,
      clauses: inForce,
      clausesNotYet: notYet.map((c) => ({ id: c.id, effectiveFrom: c.effectiveFrom })),
      exceptions,
      overrides,
    },
    rules,
    files,
    scan: {
      include: ['**/*.java', '**/*.kt', '**/*.xml', '**/*.yml', '**/*.yaml', '**/*.sql', '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.vue', '**/*.py', '**/*.sh', '**/*.properties'],
      exclude: ['**/node_modules/**', '**/target/**', '**/build/**', '**/dist/**', '**/out/**', '**/.git/**', '**/.next/**', '**/generated/**'],
    },
    notes: [
      '本文件由 arsenal-server/scripts/charter-ci.mjs export 生成，请勿手改。',
      '判负口径（例外到期 / 孤儿例外）读 charter.policy —— 那是本项目章程自己的字段，执行器不写死。',
      '条款已按 today 裁过一遍（冻结线）；判定阶段不再读日历。',
    ],
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, CONFIG_NAME), JSON.stringify(config, null, 2) + '\n', 'utf8');
  fs.copyFileSync(SELF, path.join(outDir, EXECUTOR_NAME));

  console.log(`[charter-ci] 已导出判定配置 → ${outDir.replace(/\\/g, '/')}`);
  console.log(`         模式 ${a.mode} · 判定日 ${a.today} · 章程来自${charterDirSource}`);
  console.log(`         L0 规则 ${rules.length} 条 / 生效条款 ${inForce.length} 条`
    + (notYet.length ? `（未生效 ${notYet.length} 条：${notYet.map((c) => c.id).join('、')}）` : ''));
  console.log(`         例外 ${exceptions.length} 条 · override ${overrides.length} 条 · 判负口径 ${JSON.stringify(policy)}`);
  if (a.mode === 'pr') {
    console.log(`         本次 diff 触及 ${files.length} 个文件 —— PR 门只判这些，存量走 audit 账`);
  } else {
    console.log(`         audit 模式：判定范围由 scan.include / scan.exclude 决定（存量只记账不阻断）`);
  }
  return 0;
}

/* ═══════════════════════════════════════════════════════════════════════
   三、lint 模式（业务仓 CI 侧，零 import）
   ═══════════════════════════════════════════════════════════════════════ */

/** @param {string} dir @returns {string[]} */
function walkScan(dir, scan) {
  const inc = (scan.include || []).map((g) => globToRegExp(g));
  const exc = (scan.exclude || []).map((g) => globToRegExp(g));
  /** @type {string[]} */
  const out = [];
  const skipDirs = new Set(['.git', 'node_modules', 'target', 'build', 'dist', 'out', '.next']);
  /** @param {string} d */
  const rec = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (skipDirs.has(e.name)) continue;
        rec(p);
      } else {
        const rel = normalizePath(path.relative(dir, p));
        if (exc.some((r) => r.test(rel))) continue;
        if (inc.length && !inc.some((r) => r.test(rel))) continue;
        out.push(rel);
      }
    }
  };
  rec(dir);
  return out.sort();
}

/**
 * @param {string[]} argv @returns {number}
 */
function runLint(argv) {
  const a = parseArgs(argv);
  // --config 既可指目录（.arsenal/ci）也可指文件（.arsenal/ci/config.json）。
  // 判据：路径存在且是文件 → 用它；否则当目录、补上 config.json。
  // （不这么判的后果：传目录时会把目录当 JSON 解析，报一个和真实原因无关的错。）
  const cfgCandidate = path.resolve(a.out);
  const configPath = fs.existsSync(cfgCandidate) && fs.statSync(cfgCandidate).isFile()
    ? cfgCandidate
    : path.join(cfgCandidate, CONFIG_NAME);
  if (!fs.existsSync(configPath)) {
    console.error(`[charter-ci] 找不到配置：${configPath}\n`
      + '         先跑 export：node <军火库>/arsenal-server/scripts/charter-ci.mjs export --out .arsenal/ci');
    return 2;
  }
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const mode = a.mode || cfg.mode || 'pr';
  const repo = path.resolve(a.repo);
  const failOn = (Array.isArray(cfg.failOn) && cfg.failOn.length ? cfg.failOn : DEFAULT_FAIL_ON);

  const rules = [...(cfg.rules || []), ...((cfg.charter && cfg.charter.clauses) || [])];

  /** @type {{name:string,content:string}[]} */
  let files = [];
  let missing = 0;
  if (mode === 'pr') {
    for (const f of cfg.files || []) {
      const abs = path.join(repo, f);
      if (!fs.existsSync(abs)) { missing++; continue; }
      files.push({ name: normalizePath(f), content: fs.readFileSync(abs, 'utf8') });
    }
  } else {
    for (const rel of walkScan(repo, cfg.scan || {})) {
      files.push({ name: rel, content: fs.readFileSync(path.join(repo, rel), 'utf8') });
    }
  }

  const result = lintFiles(files, rules, {
    today: cfg.today,
    exceptions: (cfg.charter && cfg.charter.exceptions) || [],
  });
  const exRows = auditExceptions((cfg.charter && cfg.charter.exceptions) || [], (cfg.charter && cfg.charter.policy) || {}, cfg.today);

  const blocking = result.violations.filter((v) => failOn.includes(v.severity));
  const advisory = result.violations.filter((v) => !failOn.includes(v.severity));
  const exError = exRows.filter((r) => r.level === 'error');
  const exWarn = exRows.filter((r) => r.level === 'warn' || r.level === 'ignore');

  const line = '─'.repeat(72);
  console.log(line);
  console.log(`项目章程门禁 · ${mode === 'pr' ? 'PR 门（只查本次 diff）' : '存量审计（不阻断）'}`);
  console.log(`项目 ${(cfg.repo && cfg.repo.name) || '?'} · 章程 ${(cfg.charter && cfg.charter.name) || '-'}`
    + ` · 判定日 ${cfg.today} · 判负 severity ${failOn.join('/')}`);
  console.log(line);
  console.log(`规则池 ${rules.length}（L0 ${(cfg.rules || []).length} + 生效条款 ${((cfg.charter && cfg.charter.clauses) || []).length}）`
    + ` · 判定文件 ${files.length}${missing ? `（diff 清单里 ${missing} 个文件在盘上不存在，已跳过并计入统计）` : ''}`);
  if ((cfg.charter && cfg.charter.clausesNotYet || []).length) {
    console.log(`未生效条款 ${cfg.charter.clausesNotYet.map((c) => `${c.id}(${c.effectiveFrom})`).join('、')} —— 冻结线之前不进本门`);
  }
  console.log('');

  if (blocking.length) {
    console.log(`✗ 阻断项 ${blocking.length} 条（severity ∈ ${failOn.join('/')}）：`);
    for (const v of blocking.slice(0, 40)) {
      console.log(`  ${v.file}:${v.line}:${v.column}  [${v.severity}] ${v.ruleId} ${v.title}`);
      if (v.source === 'charter') console.log(`      条款归 ${v.clauseOwner || '未署名'} · 生效 ${v.effectiveFrom || '未设'} · ${v.snippet.slice(0, 100)}`);
      else if (v.snippet) console.log(`      ${v.snippet.slice(0, 100)}`);
      if (v.collapsed) console.log(`      （同文件同规则另有 ${v.collapsed} 处已折叠）`);
    }
    if (blocking.length > 40) console.log(`  …… 另有 ${blocking.length - 40} 条`);
  } else {
    console.log(`✓ 无阻断项`);
  }
  if (advisory.length) {
    console.log(`· 提示项 ${advisory.length} 条（不阻断，severity ∈ ${[...new Set(advisory.map((v) => v.severity))].join('/')}）`);
    for (const v of advisory.slice(0, 10)) console.log(`  ${v.file}:${v.line}  [${v.severity}] ${v.ruleId} ${v.title}`);
    if (advisory.length > 10) console.log(`  …… 另有 ${advisory.length - 10} 条`);
  }

  if (result.waived.length) {
    console.log('');
    console.log(`放行 ${result.waived.length} 处（各有台账，不是「查不到」）：`);
    const byRule = new Map();
    for (const w of result.waived) {
      const k = `${w.ruleId}@${w.file}`;
      if (!byRule.has(k)) byRule.set(k, w);
    }
    for (const w of [...byRule.values()].slice(0, 15)) console.log(`  ${w.ruleId}  ${w.file}  ← ${w.reason}`);
  }

  console.log('');
  console.log(`例外台账 ${exRows.length} 条：未销账且到期 ${exRows.filter((r) => r.state === 'expired').length} 条`
    + ` · 孤儿 ${exRows.filter((r) => r.state === 'orphaned').length} 条`);
  for (const r of exError) console.log(`  ✗ [${r.level}] ${r.id} → ${r.clauseId}（${r.state}，到期 ${r.expiresAt}，债主 ${r.owner}）`);
  for (const r of exWarn) console.log(`  · [${r.level}] ${r.id} → ${r.clauseId}（${r.state}，到期 ${r.expiresAt}）`);
  if (exRows.length === 0) console.log('  （无例外登记 —— 合法起点：条款一条不许破）');

  if (result.skipped.length) {
    console.log('');
    console.log(`⚠ 本工具检不了的 ${result.skipped.length} 项（**不假装通过**）：`);
    const seen = new Set();
    for (const s of result.skipped) {
      if (seen.has(s.ruleId)) continue;
      seen.add(s.ruleId);
      console.log(`  ${s.ruleId}  ${s.reason}`);
    }
  }
  console.log(line);

  // ── 债务账（audit 模式的可交付物）──
  const reportPath = a.report;
  if (mode === 'audit' && reportPath) {
    const byClause = new Map();
    for (const v of result.violations) {
      const k = v.ruleId;
      if (!byClause.has(k)) byClause.set(k, { ruleId: k, title: v.title, severity: v.severity, source: v.source, hits: 0, files: new Set(), exceptions: 0 });
      const row = byClause.get(k);
      row.hits += 1;
      row.files.add(v.file);
    }
    for (const r of exRows) {
      if (!byClause.has(r.clauseId)) continue;
      byClause.get(r.clauseId).exceptions += 1;
    }
    const rows = [...byClause.values()].sort((a2, b2) => b2.hits - a2.hits);
    const md = [
      `# 债务账 · ${(cfg.charter && cfg.charter.name) || ''}`,
      '',
      `> 判定日 ${cfg.today} · 扫描 ${files.length} 个文件 · 这页的 KPI 是**数字下降**，不是零。`,
      '> 只报不改：存量违规不阻断 PR，改完再跑一次看数字。',
      '',
      '| 条款 | 历史违规数 | 例外数 | 级别 | 来源 | 涉及文件 |',
      '|---|---:|---:|---|---|---:|',
      ...rows.map((r) => `| \`${r.ruleId}\` ${r.title} | ${r.hits} | ${r.exceptions} | ${r.severity} | ${r.source} | ${r.files.size} |`),
      '',
      '## 例外台账',
      '',
      '| 例外 | 条款 | 状态 | 到期 | 债主 | 判负 |',
      '|---|---|---|---|---|---|',
      ...exRows.map((r) => `| \`${r.id}\` | \`${r.clauseId}\` | ${r.state} | ${r.expiresAt || '-'} | ${r.owner || '-'} | ${r.level} |`),
      '',
    ].join('\n');
    fs.writeFileSync(path.resolve(repo, reportPath), md, 'utf8');
    console.log(`债务账已写出：${path.resolve(repo, reportPath).replace(/\\/g, '/')}`);
  }

  if (mode === 'audit') {
    console.log('audit 模式不阻断（--mode audit 的存在意义就是让存量账先跑起来）。');
    return 0;
  }
  if (blocking.length || exError.length) {
    console.log('');
    console.log(`判负：${blocking.length} 条阻断违规${exError.length ? ` + ${exError.length} 条例外台账 error` : ''}`
      + `（口径来自章程 policy 与 --fail-on，不是本工具写死的）`);
    return 1;
  }
  return 0;
}

/* ═══════════════════════════════════════════════════════════════════════
   四、入口
   ═══════════════════════════════════════════════════════════════════════ */

async function main() {
  const [, , cmd, ...rest] = process.argv;
  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(`项目章程 CI 执行器（导出 + 判定，一个文件两种模式）

  export（跑在军火库里，产出自包含配置）
    node charter-ci.mjs export --mode pr|audit --out <目录> [--base <ref> | --files-from <清单>]
                              [--repo <业务仓路径>] [--today YYYY-MM-DD]

  lint（跑在业务仓 CI 里，只读配置、零依赖）
    node charter-ci.mjs lint --config <目录> [--mode pr|audit] [--repo <路径>] [--report debt.md]

说明
  · 判负口径读章程 policy，本工具不写死
  · PR 门只判 export 阶段算出的 diff 文件；存量走 audit，只出账不阻断
  · 检不了的层（ast / llm / manual、override.replace）一律如实列出，不假装通过`);
    return 0;
  }
  if (cmd === 'export') return runExport(rest);
  if (cmd === 'lint') return runLint(rest);
  console.error(`未知子命令：${cmd}（只认 export / lint）`);
  return 2;
}

// ★ 只有被**直接当命令跑**时才进 main。
// 断言层要 import 本文件的纯函数（lintFiles / globToRegExp / exceptionCovered /
// auditExceptions）做跨实现一致性比对 —— 若无条件 main()，那次 import 会把整个
// 判定跑一遍并 process.exit 掉，断言层连日志都读不到。
if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`[charter-ci] ${err && /** @type {any} */ (err).message ? /** @type {any} */ (err).message : err}`);
      process.exit(2);
    },
  );
}
