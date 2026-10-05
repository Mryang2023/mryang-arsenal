#!/usr/bin/env node
/**
 * 杨先生的军火库 · MCP 适配层（stdio 传输）
 *
 * 这是「一份数据三种出口」里唯一能形成闭环的一环：让 AI 编码客户端在写代码的当下
 * 主动来查约束、验合规，而不是靠人事先粘贴提示词。
 *
 * 设计取舍：
 * - 纯 node，零运行时依赖（只用 fs / path / url 内置模块）。
 *   lint_code 本地只跑 Level-1 正则层（35/69 条），与前端 engine.ts 同源同口径；
 *   AST 深度判定已由后端 AstEngine 承担（后端合计 42/69），语义层（LLM）仍为 0 ——
 *   所以没有正则的规则在这里如实列为「需后端深度」，不假装本地能判。
 * - 仓库路径自定位：从本文件位置向上三级（scripts/ → arsenal-server/ → 仓库根），
 *   因此 arsenal-mcp.json 里不必写死绝对路径，AI 客户端的 cwd 也不影响。
 * - 工具 schema 读的是 arsenal-rules/mcp-tools.json —— 与前端/后端导出器同一份，
 *   所以「tools/list 返回什么」和「导出产物里写了什么」天然不会漂移。
 *
 * 协议（MCP stdio，每行一条 JSON-RPC 2.0 消息）：
 * - 版本协商：initialize 时客户端带来 protocolVersion，认识的原样回它；
 *   不认识回服务器默认（mcp-tools.json 的 server.protocolVersion，
 *   与 McpToolCatalog.protocolVersion() 读同一份、同一口径）。
 * - 方法面：initialize / ping / tools/list / tools/call /
 *   resources/list / resources/read（规则 → arsenal://rules/<id>）/
 *   prompts/list / prompts/get（severity → 规则集 promptFragment）。
 * - 错误码：参数缺失/不合法 -32602，内部错误 -32603，未知方法 -32601；
 *   notifications/* 按协议静默（不回包、不崩）。
 *
 * 启动：node arsenal-server/scripts/mcp-stdio.mjs
 * 回归：node arsenal-server/scripts/mcp-probe.mjs（spawn 本文件逐条断言，exit 0/1）
 * 接入：docs/MCP-接入指南.md
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..'); // scripts/ -> arsenal-server/ -> 仓库根
const RULES_DIR = process.env.ARSENAL_RULES_DIR
  ? resolve(process.env.ARSENAL_RULES_DIR)
  : join(REPO_ROOT, 'arsenal-rules');
const TOOLS_FILE = join(RULES_DIR, 'mcp-tools.json');

// 服务器认识、可以直接原样回给客户端的协议版本。名单里必须包含默认值；
// 若 mcp-tools.json 声明了名单外的新默认版本，loadData 会把它补进名单。
const SUPPORTED_PROTOCOL_VERSIONS = ['2024-11-05', '2025-03-26', '2025-06-18'];
// 协商不成时的回退值。来自 mcp-tools.json 的 server.protocolVersion，
// 与 McpToolCatalog.protocolVersion() 读同一份数据 —— 两边不能各说各话。
let SERVER_PROTOCOL_VERSION = '2024-11-05';
const SEVERITIES = ['MUST', 'NEVER', 'SHOULD', 'MAY'];
const SEVERITY_PENALTY = { MUST: 6, NEVER: 6, SHOULD: 2, MAY: 0 };

// ──────────────────────────────────────────────── 数据加载
let RULES = [];
let TOOL_DEFS = [];
let SERVER_INFO = { name: 'arsenal', version: '0.1.0' };

function loadData() {
  if (!existsSync(RULES_DIR)) {
    throw new Error(`规则目录不存在：${RULES_DIR}（可用 ARSENAL_RULES_DIR 覆盖）`);
  }
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.json') && !entry.name.startsWith('_') && entry.name !== 'meta.json') {
        files.push(p);
      }
    }
  };
  walk(RULES_DIR);

  const rules = [];
  for (const f of files) {
    const d = JSON.parse(readFileSync(f, 'utf8'));
    if (Array.isArray(d)) rules.push(...d);
    else if (Array.isArray(d.rules)) rules.push(...d.rules);
  }
  RULES = rules;

  if (existsSync(TOOLS_FILE)) {
    const td = JSON.parse(readFileSync(TOOLS_FILE, 'utf8'));
    TOOL_DEFS = td.tools ?? [];
    if (td.server?.name) SERVER_INFO.name = td.server.name;
    if (typeof td.server?.protocolVersion === 'string' && td.server.protocolVersion) {
      SERVER_PROTOCOL_VERSION = td.server.protocolVersion;
      if (!SUPPORTED_PROTOCOL_VERSIONS.includes(SERVER_PROTOCOL_VERSION)) {
        SUPPORTED_PROTOCOL_VERSIONS.push(SERVER_PROTOCOL_VERSION);
      }
    }
  }
}

// ──────────────────────────────────────────────── 正则层（与前端 engine.ts 同源）
function escapeLiteral(s) {
  return s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

function globToRegExp(glob) {
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
      if (end === -1) out += '\\{';
      else {
        const alts = glob.slice(i + 1, end).split(',').map(escapeLiteral);
        out += '(?:' + alts.join('|') + ')';
        i = end;
      }
    } else {
      out += escapeLiteral(c);
    }
  }
  return new RegExp('^' + out + '$', 'i');
}

function normalizePath(p) {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
}

function makeLocator(text) {
  const nl = [];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) nl.push(i);
  return (index) => {
    let lo = 0,
      hi = nl.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (nl[mid] < index) lo = mid + 1;
      else hi = mid;
    }
    const lineStart = lo === 0 ? 0 : nl[lo - 1] + 1;
    return { line: lo + 1, column: index - lineStart + 1 };
  };
}

function snippetAt(text, index, matchText) {
  const lineStart = text.lastIndexOf('\n', index) + 1;
  let lineEnd = text.indexOf('\n', index);
  if (lineEnd === -1) lineEnd = text.length;
  let s = text.slice(lineStart, lineEnd).trim();
  if (!s && matchText) s = matchText.split('\n')[0].trim();
  if (s.length > 140) s = s.slice(0, 140) + '…';
  return s;
}

function collectMatches(re, text) {
  const out = [];
  re.lastIndex = 0;
  let m;
  let guard = 0;
  while ((m = re.exec(text)) !== null) {
    out.push({ index: m.index, text: m[0] });
    if (m[0] === '') re.lastIndex += 1;
    if (++guard > 20000) break;
    if (out.length >= 200) break;
  }
  return out;
}

function grade(score) {
  if (score >= 95) return '合规';
  if (score >= 85) return '良好';
  if (score >= 70) return '及格';
  if (score >= 50) return '不合格';
  return '严重违规';
}

// 规则实际声明的层，按降级顺序 regex → ast → llm → manual（与 Rule.Check.layer() 一致）。
// 一条规则可以有多个层，所以是复合标签（「正则+AST」）而不是猜一个。
// 忽略 check.manual 的后果是：22 条人工检查说明在检索里完全不可见。
function layersOf(r) {
  const c = r.check || {};
  const parts = [];
  if (c.regex?.pattern) parts.push('正则');
  if (c.ast?.query) parts.push('AST');
  if (typeof c.llm === 'string' && c.llm.length > 0) parts.push('语义');
  if (c.manual) parts.push('人工');
  return parts.length ? parts.join('+') : '未声明';
}

// ──────────────────────────────────────────────── 工具实现
function searchRules({ query, severity, category }) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return '请提供 query 关键词，例如「controller 入参」「线程池」「事务」。';
  const out = [];
  for (const r of RULES) {
    if (severity && r.severity !== severity) continue;
    if (category && r.category !== category) continue;
    const c = r.check || {};
    // 字段名以 arsenal-rules/**.json 为准：title / rationale / bad / good / check.{regex,ast,llm,manual}。
    // 这里曾读 r.description / r.badExample / r.goodExample / check.llm.query —— 四个都不存在，
    // 后果是「反例、正例、LLM 提示词、人工说明」全都搜不到，且每条结果标题后跟一个空行。
    const blob = [
      r.id,
      r.title,
      r.rationale,
      r.severity,
      r.category,
      (r.tags || []).join(' '),
      c.ast?.query || '',
      typeof c.llm === 'string' ? c.llm : '',
      c.manual || '',
      (r.bad || '').slice(0, 200),
      (r.good || '').slice(0, 200),
    ]
      .join(' ')
      .toLowerCase();
    if (blob.includes(q)) out.push(r);
  }
  if (!out.length) return `没有匹配「${query}」的规范条目。`;
  const lines = out.slice(0, 20).map((r) => {
    return `• [${r.severity}] ${r.id}（${r.category}·${layersOf(r)}）${r.title}\n  ${r.rationale || ''}`;
  });
  const more = out.length > 20 ? `\n…另有 ${out.length - 20} 条，缩小关键词查看。` : '';
  return `匹配到 ${out.length} 条：\n` + lines.join('\n') + more;
}

function getRule({ id }) {
  const r = RULES.find((x) => x.id === id);
  if (!r) return `未找到规则 ${id}。用 search_rules 按关键词检索可用 ID。`;
  return JSON.stringify(r, null, 2);
}

function lintCode({ filename, content }) {
  const name = normalizePath(filename || 'untitled.java');
  const text = content ?? '';
  const active = RULES.filter((r) => r.status === 'active');
  const executable = active.filter((r) => r.check?.regex?.pattern);
  const skipped = active.filter((r) => !r.check?.regex?.pattern);

  const compiled = [];
  const broken = [];
  for (const r of executable) {
    const rc = r.check.regex;
    let body;
    try {
      const extra = (rc.flags ?? '').replace(/[gm]/g, '');
      body = new RegExp(rc.pattern, 'gm' + extra);
    } catch {
      broken.push(r);
      continue;
    }
    compiled.push({
      rule: r,
      body,
      fileRe: rc.targetGlob ? globToRegExp(normalizePath(rc.targetGlob)) : null,
      expect: rc.expect ?? 'absent',
    });
  }

  const violations = [];
  const locate = makeLocator(text);
  for (const c of compiled) {
    if (c.fileRe && !c.fileRe.test(name)) continue;
    const hits = collectMatches(c.body, text);
    const isViolation = c.expect === 'absent' ? hits.length > 0 : hits.length === 0;
    if (!isViolation) continue;
    const seenLines = new Set();
    const before = violations.length;
    for (const h of hits) {
      const { line } = locate(h.index);
      if (seenLines.has(line)) continue;
      seenLines.add(line);
      if (violations.length < 50) {
        violations.push({
          ruleId: c.rule.id,
          severity: c.rule.severity,
          title: c.rule.title,
          line,
          snippet: snippetAt(text, h.index, h.text),
          message: c.expect === 'present' ? '缺少必需写法' : '命中禁止写法',
        });
      }
    }
    // expect=present 型的违规是「一条都没找到」，hits 为空时上面那个循环什么都不做 ——
    // 所以过去这两条规则在 MCP 里**永远不触发**（0 违规，白送满分）。
    // 与 src/lib/engine.ts:254、LintEngine.java:142-147 同一逻辑：补一条「未找到必需内容」。
    if (c.expect === 'present' && violations.length === before && violations.length < 50) {
      violations.push({
        ruleId: c.rule.id,
        severity: c.rule.severity,
        title: c.rule.title,
        line: 1,
        snippet: `未找到必需内容：${c.rule.title}`,
        message: '缺少必需写法',
      });
    }
  }

  const perRule = new Map();
  for (const v of violations) {
    const cur = perRule.get(v.ruleId);
    if (cur) cur.count += 1;
    else perRule.set(v.ruleId, { severity: v.severity, count: 1 });
  }
  // 评分基数必须与前端一致，不许自己另算一套：
  // 这里曾写死 `6`，于是 SHOULD 被扣 6（应 2）、MAY 被扣 6（应 0）—— 基数错 3 倍，
  // 而死常量 SEVERITY_PENALTY 就在文件顶部（0 引用）。基数出处：
  // src/lib/theme.ts 的 SEVERITY_THEME.penalty 与 Severity.java。
  // 每规则递增上限 4 与总分下限 0 照抄 src/lib/engine.ts 的 `Math.min(count - 1, 4)`。
  const PER_RULE_EXTRA_CAP = 4;
  let penalty = 0;
  for (const [, r] of perRule) {
    penalty += (SEVERITY_PENALTY[r.severity] ?? 0) + Math.min(r.count - 1, PER_RULE_EXTRA_CAP);
  }
  const score = Math.max(0, Math.min(100, 100 - penalty));

  const vLines = violations
    .sort((a, b) => a.line - b.line)
    .map((v) => `✗ [${v.severity}] ${v.ruleId} L${v.line} ${v.title}\n    ${v.snippet}`);
  const sLines = skipped.slice(0, 12).map((r) => {
    return `• ${r.id}（${layersOf(r)}）${r.title}`;
  });
  const summary =
    `合规分 ${score}/100（${grade(score)}）｜违规 ${violations.length} 条｜` +
    `正则可执行 ${executable.length} 条，另有 ${skipped.length} 条需 AST/语义/人工（未纳入本次评分）。`;
  const body =
    summary +
    (vLines.length ? '\n\n违规清单：\n' + vLines.join('\n') : '\n\n未发现正则层违规。') +
    (sLines.length ? '\n\n本次未判定（需后端深度）：\n' + sLines.join('\n') : '') +
    (broken.length ? `\n\n规则自身缺陷（正则无法编译）：${broken.map((b) => b.id).join(', ')}` : '');
  return body;
}

function getPrompt({ severity }) {
  const wanted = (severity || 'MUST,NEVER,SHOULD')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const rules = RULES.filter((r) => r.status === 'active' && wanted.includes(r.severity));
  const lines = rules.map((r) => {
    const frag = r.promptFragment || r.rationale || '';
    return `- [${r.severity}] ${r.id} ${r.title}：${frag}`;
  });
  return (
    `以下是杨先生的军火库的编码约束（共 ${rules.length} 条，级别过滤：${wanted.join('/')}）：\n\n` +
    lines.join('\n')
  );
}

// ──────────────────────────────────────────────── 项目章程层（2026-10-04）
//
// 读的是**另一个数据源** `arsenal-charter/<id>.json` —— 手写事实源，不经 Python 生成器，
// 目录由 ARSENAL_CHARTER_DIR 指定（缺省 <repo>/arsenal-charter）。
//
// 为什么不用 validate-charter.mjs 做判定：那个是**构建期**的闸门（失败即中断），
// 而这里是**运行期**的查询服务。混用会出现「构建期说合格、运行期报违规」而无人知道原因。
// 这里只做**读取与格式化**，不做合格性判断 —— 合格性由构建期那一层负责，且已过。
//
// 为什么今天不读 new Date()：例外是否到期、条款是否生效都靠日期。
// 这里刻意**不自己取** —— 宁可少给一个「是否已到期」的结论，也不给一个会变的：
// 需要时由调用方传 today，或在输出里标明「判定日由调用方给出」。

const CHARTER_DIR = process.env.ARSENAL_CHARTER_DIR
  ? resolve(process.env.ARSENAL_CHARTER_DIR)
  : join(REPO_ROOT, 'arsenal-charter');

let CHARTERS = [];

/** 加载全部章程。目录不存在是**合法起点**（章程由各项目自带），返回空数组。 */
function loadCharters() {
  CHARTERS = [];
  if (!existsSync(CHARTER_DIR)) return;
  for (const f of readdirSync(CHARTER_DIR).filter((x) => x.endsWith('.json')).sort()) {
    try {
      const doc = JSON.parse(readFileSync(join(CHARTER_DIR, f), 'utf8'));
      if (doc && typeof doc === 'object' && Array.isArray(doc.clauses)) {
        CHARTERS.push({ file: `arsenal-charter/${f}`, doc });
      }
    } catch {
      // 坏 JSON 跳过而不是整体崩：章程由各团队手写，坏一份不该让整服务起不来。
      // 它的不合格由构建期那一层拦（sync 链会硬失败），不靠运行期。
    }
  }
}

function todayOrNull(today) {
  return typeof today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : null;
}

/** get_charter —— 取本项目章程条款。 */
function getCharter({ scope, severity, today } = {}) {
  loadCharters();
  if (CHARTERS.length === 0) {
    return (
      '本仓库还没有项目章程（目录 arsenal-charter/ 下没有 *.json）。\n' +
      '这是合法起点 —— 章程由各项目自己带，军火库只提供 schema、校验器与页面。\n' +
      '基线规范仍可用 search_rules / get_rule 查询。'
    );
  }
  const t = todayOrNull(today);
  const wantSev = typeof severity === 'string' ? severity.split(',').map((x) => x.trim()) : null;
  const scopeRe = scope ? globToRegExp(normalizePath(scope)) : null;

  const out = [];
  for (const { doc } of CHARTERS) {
    out.push(`# ${doc.name}（${doc.id} v${doc.version}）`);
    out.push(`基线 ${doc.extends}｜负责人 ${doc.owner}｜批准于 ${doc.ratifiedAt}｜团队 ${doc.team.length} 人`);
    if (t) out.push(`判定日（today）：${t} —— 未生效的条款会被标注`);
    out.push('');

    for (const cl of doc.clauses ?? []) {
      if (wantSev && !wantSev.includes(cl.severity)) continue;
      if (scopeRe && !scopeRe.test(normalizePath(cl.pathGlob))) continue;
      const inForce = t ? cl.effectiveFrom <= t : null;
      out.push(`## ${cl.id}　[${cl.severity}]${inForce === false ? '　（尚未生效）' : ''}`);
      out.push(cl.title);
      out.push(`归谁管：${cl.clauseOwner}｜依据：${cl.decidedBy}｜生效日：${cl.effectiveFrom}`);
      out.push(`作用域：${cl.pathGlob}`);
      out.push(`为什么：${cl.rationale}`);
      out.push(`禁止：${cl.bad.replace(/\n/g, ' ')}`);
      out.push(`正解：${cl.good.replace(/\n/g, ' ')}`);
      out.push(`注入 AI：${cl.promptFragment}`);
      out.push('');
    }
  }
  const n = out.filter((l) => l.startsWith('## ')).length;
  if (n === 0) {
    return (
      '没有条款命中当前筛选条件。\n' +
      `（可用 scope=pathGlob 片段 或 severity=MUST,NEVER 放宽；共 ${CHARTERS.reduce((a, c) => a + (c.doc.clauses?.length ?? 0), 0)} 条条款）`
    );
  }
  return out.join('\n');
}

/** list_exceptions —— 例外登记簿。这个工具的价值在于「先查再申请」。 */
function listExceptions({ pathGlob, includeExpired, today } = {}) {
  loadCharters();
  if (CHARTERS.length === 0) {
    return '本仓库还没有项目章程，因此没有例外台账。若确有需要破例的条款，先由项目团队建立章程。';
  }
  const t = todayOrNull(today);
  const pathRe = pathGlob ? globToRegExp(normalizePath(pathGlob)) : null;
  const lines = [];

  for (const { doc } of CHARTERS) {
    const rows = [];
    for (const ex of doc.exceptions ?? []) {
      const overdue = t ? ex.expiresAt <= t && ex.status !== 'repaid' : false;
      if (!includeExpired && overdue) continue;
      if (pathRe && !pathRe.test(normalizePath(ex.pathGlob))) continue;
      const by = doc.team.includes(ex.owner) ? ex.owner : `${ex.owner}（已不在 team）`;
      rows.push(
        [
          `  ${ex.id}　${ex.clauseId}　状态 ${ex.status}${overdue ? '（已到期未销账）' : ''}`,
          `    覆盖：${ex.pathGlob}`,
          `    理由：${ex.reason}`,
          `    批准 ${ex.approver}｜还债人 ${by}｜到期 ${ex.expiresAt}${ex.ticket ? `｜工单 ${ex.ticket}` : ''}`,
        ].join('\n'),
      );
    }
    if (rows.length > 0) {
      lines.push(`# ${doc.name} —— 合法豁免（${rows.length} 笔）`);
      lines.push(...rows);
      lines.push('');
    }
  }
  if (lines.length === 0) {
    return (
      '当前范围内没有生效中的豁免。\n' +
      '也就是说：代码要偏离某条章程条款时，**没有现成许可**，应先申请或改代码。'
    );
  }
  if (!t) {
    lines.push('（本次未传 today，故未判定是否到期。要看陈年旧账请传 today=YYYY-MM-DD 与 includeExpired=true）');
  }
  return lines.join('\n');
}

/** check_clause —— 定向校验某一条条款。只跑它的 regex 层，其余层如实说「本工具跑不了」。 */
function checkClause({ clauseId, files } = {}) {
  loadCharters();
  const list = Array.isArray(files) ? files : [];
  if (!clauseId) return '缺少 clauseId（条款 ID，PJX- 前缀，如 PJX-SVC-001）';
  if (list.length === 0) return '缺少 files（要检查的文件数组）';

  let found = null;
  let owner = null;
  for (const { doc } of CHARTERS) {
    const cl = (doc.clauses ?? []).find((c) => c.id === clauseId);
    if (cl) {
      found = cl;
      owner = doc;
      break;
    }
  }
  if (!found) {
    const all = CHARTERS.flatMap((c) => (c.doc.clauses ?? []).map((x) => x.id));
    return (
      `本项目章程里没有条款 ${clauseId}。\n` +
      (all.length ? `现有条款：${all.join('、')}` : '（本项目章程条款列表为空）')
    );
  }

  const layer = found.check?.regex ? 'regex' : found.check?.ast ? 'ast' : found.check?.llm ? 'llm' : 'manual';
  const head = [
    `条款 ${found.id}　[${found.severity}]`,
    found.title,
    `归谁管 ${found.clauseOwner}｜依据 ${found.decidedBy}｜生效日 ${found.effectiveFrom}｜作用域 ${found.pathGlob}`,
    `检测方式：${layer}`,
    '',
  ];

  if (layer !== 'regex') {
    return (
      head.join('\n') +
      `本工具只跑**正则层**，这条条款的检测方式是 ${layer} —— 不能在这里判定。\n` +
      '（ast 层要后端编译器、llm 层尚未启动。说「没跑」而不是「通过」：前者是诚实，后者是撒谎。）'
    );
  }

  const fileRe = found.check.regex.targetGlob ? globToRegExp(normalizePath(found.check.regex.targetGlob)) : null;
  const expectAbsent = (found.check.regex.expect ?? 'absent') !== 'present';
  const re = new RegExp(found.check.regex.pattern, found.check.regex.flags ?? 'g');

  const hits = [];
  for (const f of list) {
    const name = normalizePath(String(f?.name ?? 'untitled.java'));
    if (fileRe && !fileRe.test(name)) continue;
    const lines = String(f?.content ?? '').split(/\r?\n/);
    lines.forEach((line, i) => {
      re.lastIndex = 0;
      if (re.test(line) === expectAbsent) {
        hits.push(`  ${name}:${i + 1}　${line.trim().slice(0, 100)}`);
      }
    });
  }

  if (hits.length === 0) {
    return head.join('\n') + `检查了 ${list.length} 个文件，**无命中**。\n正解：${found.good.replace(/\n/g, ' ')}`;
  }
  return (
    head.join('\n') +
    `**命中 ${hits.length} 处：**\n${hits.join('\n')}\n正解：${found.good.replace(/\n/g, ' ')}`
  );
}

/**
 * list_governance_actions —— 「现在该干什么」。
 *
 * 与其它七个工具的分工：它们回答**有什么规矩**（条款 / 豁免 / 某条规则），
 * 这个回答**该处理什么**（谁欠着、谁离队了、什么到期了、什么机器判不了）。
 * 接入方（比如智慧中枢的团队页）拿它当「治理待办」的数据源。
 *
 * ⚠ 为什么读构建期产物而不是现场算：聚合逻辑在 `src/lib/standards.ts`（TypeScript），
 * 而本文件是 .mjs —— 跑在 AI 客户端进程里，没法 import .ts。在 .mjs 里重写一遍
 * 就是本仓最忌讳的「同一规矩两份实现」（已栽三次）。所以：
 *   · 逻辑一份（lib/standards.ts）· 在构建期算（scripts/calc-governance.ts）
 *   · 三个出口读同一份产物（页面 / MCP / CI）
 * 代价是**产物可能过期** —— 所以输出里必须带生成时间、判定日与过期提醒，
 * 而不是让调用方以为看到的是实时结果。
 */
function listGovernanceActions({ level, owner, staleAfterDays } = {}) {
  const genPath = join(REPO_ROOT, 'arsenal-web', 'src', 'generated', 'governance.json');
  if (!existsSync(genPath)) {
    return '治理台产物还没生成。军火库侧跑一次 `npm run sync:governance`（改了章程也要重跑，它会重新算待办）。';
  }
  let g;
  try {
    g = JSON.parse(readFileSync(genPath, 'utf8'));
  } catch (e) {
    return `治理台产物读不出来（${String(e && e.message ? e.message : e)}）。跑一次 \`npm run sync:governance\` 重建。`;
  }

  const staleDays = Number.isFinite(Number(staleAfterDays)) ? Number(staleAfterDays) : 7;
  const ageDays = Math.floor((Date.now() - new Date(g.generatedAt || 0).getTime()) / 86400000);
  const lines = [];
  lines.push(`# 治理待办（判定日 ${g.today}｜生成于 ${(g.generatedAt || '').slice(0, 19).replace('T', ' ')}）`);
  lines.push('');

  let shown = 0;
  for (const c of g.charters || []) {
    const acts = (c.actions || []).filter((a) => {
      if (level && a.level !== level) return false;
      if (owner && !String(a.who || '').includes(owner)) return false;
      return true;
    });
    const sum = c.summary || {};
    lines.push(`## ${c.charterName}（${c.charterId}）—— 共 ${sum.total ?? acts.length} 件：P0 ${sum.p0 ?? 0} / P1 ${sum.p1 ?? 0} / P2 ${sum.p2 ?? 0}`);
    if (acts.length === 0) {
      lines.push('');
      lines.push('  当前没有待办：例外都销了账、没人离队、条款都在机器能判的层上。');
      continue;
    }
    for (const a of acts) {
      shown += 1;
      lines.push('');
      lines.push(`  [${a.level}] ${a.title}`);
      lines.push(`    该谁处理：${a.who ?? '无（不是「随便谁」）'}${a.due ? `｜到期 ${a.due}` : ''}`);
      lines.push(`    ${a.detail}`);
    }
  }

  // ⚠ 用 `>=` 而不是 `>`：staleAfterDays=0 的语义是「不接受任何新鲜度」，
  // 而 `>` 在 ageDays=0 时不触发 —— 那正是「刚生成」的情况，
  // 于是这个阈值在唯一能测出来的场景里失效。判据方向错了，测试也照样绿。
  if (ageDays >= staleDays) {
    lines.push('');
    lines.push(`⚠ 这份清单生成于 ${ageDays} 天前（阈值 ${staleDays} 天）。`
      + '刚改过章程的话跑一次 `npm run sync:governance` 再看 —— 否则你读的是上一次的结论。');
  }
  if (shown === 0) lines.push('', '（没有匹配 level/owner 的待办。）');
  return lines.join('\n');
}

const HANDLERS = {
  search_rules: searchRules,
  get_rule: getRule,
  lint_code: lintCode,
  get_prompt: getPrompt,
  get_charter: getCharter,
  list_exceptions: listExceptions,
  check_clause: checkClause,
  list_governance_actions: listGovernanceActions,
};

// ──────────────────────────────────────────────── JSON-RPC stdio 循环

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

/** 带协议错误码的失败。其它异常一律按内部错误（-32603）处理。 */
class RpcError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** 参数缺失 / 不合法。 */
const invalidParams = (message) => new RpcError(-32602, message);

// ── resources：把 69 条规则暴露成只读资源（uri = arsenal://rules/<id>）──
function resourcesList() {
  return {
    resources: RULES.map((r) => ({
      uri: `arsenal://rules/${r.id}`,
      name: r.id,
      description: `[${r.severity}·${r.category}] ${r.title}`,
      mimeType: 'application/json',
    })),
  };
}

function resourcesRead(params) {
  const uri = params.uri;
  if (typeof uri !== 'string' || !uri) {
    throw invalidParams('resources/read 需要 params.uri，如 "arsenal://rules/WEB-CTRL-002"');
  }
  const m = /^arsenal:\/\/rules\/(.+)$/.exec(uri);
  if (!m) {
    throw invalidParams(
      `无法识别的资源 URI：${uri}（本服务器只提供 arsenal://rules/<规则ID>，用 resources/list 列出全部）`
    );
  }
  const r = RULES.find((x) => x.id === m[1]);
  if (!r) {
    throw invalidParams(`资源不存在：${uri}（用 resources/list 查看全部 ${RULES.length} 条）`);
  }
  return {
    contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(r, null, 2) }],
  };
}

// ── prompts：把 get_prompt 的语义升格为 MCP Prompt（severity → 规则集 promptFragment）──
const PROMPT_NAME = 'arsenal-constraints';
const PROMPT_DEF = {
  name: PROMPT_NAME,
  description:
    '把「杨先生的军火库」的编码约束注入当前会话：按 severity 过滤规则集，取各规则的 promptFragment。',
  arguments: [
    {
      name: 'severity',
      description:
        '逗号分隔的级别，取值 MUST/NEVER/SHOULD/MAY，如 "NEVER" 或 "MUST,NEVER"；缺省 "MUST,NEVER"（50 条硬约束）。',
      required: false,
    },
  ],
};
const DEFAULT_PROMPT_SEVERITY = 'MUST,NEVER';

function promptsList() {
  return { prompts: [PROMPT_DEF] };
}

function promptsGet(params) {
  if (params.name !== PROMPT_NAME) {
    throw invalidParams(`未知 prompt：${String(params.name)}（用 prompts/list 查看可用项）`);
  }
  const raw =
    typeof params.arguments?.severity === 'string' ? params.arguments.severity : DEFAULT_PROMPT_SEVERITY;
  const wanted = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const bad = wanted.filter((s) => !SEVERITIES.includes(s));
  if (!wanted.length || bad.length) {
    throw invalidParams(
      `severity 不合法："${raw}"（可用值 ${SEVERITIES.join('/')}，逗号分隔，如 "NEVER" 或 "MUST,NEVER"）`
    );
  }
  return {
    description: PROMPT_DEF.description,
    messages: [
      { role: 'user', content: { type: 'text', text: getPrompt({ severity: wanted.join(',') }) } },
    ],
  };
}

function handleRequest(req) {
  const method = req.method;
  const params = req.params || {};

  if (method === 'initialize') {
    // 版本协商：认识就回客户端带来的版本，不认识回服务器默认
    //（与 McpToolCatalog.protocolVersion() 注释里写的是同一套口径）。
    const requested = params.protocolVersion;
    const agreed =
      typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : SERVER_PROTOCOL_VERSION;
    return {
      protocolVersion: agreed,
      capabilities: { tools: {}, resources: {}, prompts: {} },
      serverInfo: { name: SERVER_INFO.name, version: SERVER_INFO.version },
    };
  }
  if (method === 'ping') return {};
  if (method === 'tools/list') {
    return { tools: TOOL_DEFS };
  }
  if (method === 'tools/call') {
    if (typeof params.name !== 'string' || !params.name) {
      throw invalidParams('tools/call 需要 params.name（用 tools/list 查看全部工具）');
    }
    if (
      params.arguments !== undefined &&
      (typeof params.arguments !== 'object' || params.arguments === null || Array.isArray(params.arguments))
    ) {
      throw invalidParams('tools/call 的 params.arguments 必须是对象');
    }
    const handler = HANDLERS[params.name];
    if (!handler) {
      throw invalidParams(
        `未知工具：${params.name}（用 tools/list 查看全部 ${TOOL_DEFS.length} 个）`
      );
    }
    // handler 内部抛出的异常不在这里吞：交给外层按内部错误（-32603）回。
    const text = handler(params.arguments || {});
    return { content: [{ type: 'text', text: String(text) }] };
  }
  if (method === 'resources/list') return resourcesList();
  if (method === 'resources/read') return resourcesRead(params);
  if (method === 'prompts/list') return promptsList();
  if (method === 'prompts/get') return promptsGet(params);
  throw new RpcError(-32601, '方法不支持：' + method);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      continue;
    }
    // 通知（无 id，或 notifications/* 前缀）按协议静默：不回包、不报错、不崩。
    // notifications/initialized 就走这里 —— 过去只靠 startsWith('notification') 的巧合接住。
    if (req.id === undefined || (typeof req.method === 'string' && req.method.startsWith('notifications/'))) {
      continue;
    }
    if (typeof req.method !== 'string') {
      // 有 id 但没有 method 的畸形请求：明确回协议错误，不让客户端挂着等超时。
      send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: '请求缺少 method' } });
      continue;
    }
    try {
      const result = handleRequest(req);
      send({ jsonrpc: '2.0', id: req.id, result });
    } catch (e) {
      const known = e instanceof RpcError;
      send({
        jsonrpc: '2.0',
        id: req.id,
        error: {
          code: known ? e.code : -32603,
          message: known ? e.message : '内部错误：' + e.message,
        },
      });
    }
  }
});

try {
  loadData();
} catch (e) {
  process.stderr.write('[arsenal-mcp] 启动失败：' + e.message + '\n');
  process.exit(1);
}
process.stderr.write(
  `[arsenal-mcp] 就绪：${RULES.length} 条规则，${TOOL_DEFS.length} 个工具，` +
    `${RULES.length} 个资源（arsenal://rules/<id>），1 个 prompt（${PROMPT_NAME}）；` +
    `协议默认 ${SERVER_PROTOCOL_VERSION}。\n`
);
