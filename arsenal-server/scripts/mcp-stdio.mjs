#!/usr/bin/env node
/**
 * 杨先生的军火库 · MCP 适配层（stdio 传输）
 *
 * 这是「一份数据三种出口」里唯一能形成闭环的一环：让 AI 编码客户端在写代码的当下
 * 主动来查约束、验合规，而不是靠人事先粘贴提示词。
 *
 * 设计取舍：
 * - 纯 node，零运行时依赖（只用 fs / path / url 内置模块）。
 *   lint_code 的 Level-1 正则层在本地跑，与前端 engine.ts 同源同口径；
 *   AST / 语义层（F2）做成之后，这里把那 32 条从 skipped 移到可执行即可，调用方无感。
 * - 仓库路径自定位：从本文件位置向上三级（scripts/ → arsenal-server/ → 仓库根），
 *   因此 arsenal-mcp.json 里不必写死绝对路径，AI 客户端的 cwd 也不影响。
 * - 工具 schema 读的是 arsenal-rules/mcp-tools.json —— 与前端/后端导出器同一份，
 *   所以「tools/list 返回什么」和「导出产物里写了什么」天然不会漂移。
 *
 * 协议：MCP 2024-11-05，stdio = 每行一条 JSON-RPC 2.0 消息。
 *
 * 启动：node arsenal-server/scripts/mcp-stdio.mjs
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

const PROTOCOL_VERSION = '2024-11-05';
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

const HANDLERS = {
  search_rules: searchRules,
  get_rule: getRule,
  lint_code: lintCode,
  get_prompt: getPrompt,
};

// ──────────────────────────────────────────────── JSON-RPC stdio 循环
let nextId = 1;

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function handleRequest(req) {
  const id = req.id;
  const method = req.method;
  const params = req.params || {};

  if (method === 'initialize') {
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_INFO.name, version: SERVER_INFO.version },
    };
  }
  if (method === 'ping') return {};
  if (method === 'tools/list') {
    return { tools: TOOL_DEFS };
  }
  if (method === 'tools/call') {
    const name = params.name;
    const handler = HANDLERS[name];
    if (!handler) {
      return { content: [{ type: 'text', text: `未知工具：${name}` }], isError: true };
    }
    try {
      const text = handler(params.arguments || {});
      return { content: [{ type: 'text', text: String(text) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `工具执行出错：${e.message}` }], isError: true };
    }
  }
  throw new Error('方法不支持：' + method);
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
    if (req.method && req.method.startsWith('notification')) continue; // 通知不回
    try {
      const result = handleRequest(req);
      send({ jsonrpc: '2.0', id: req.id, result });
    } catch (e) {
      send({ jsonrpc: '2.0', id: req.id, error: { code: -32601, message: e.message } });
    }
  }
});

try {
  loadData();
} catch (e) {
  process.stderr.write('[arsenal-mcp] 启动失败：' + e.message + '\n');
  process.exit(1);
}
process.stderr.write(`[arsenal-mcp] 就绪：${RULES.length} 条规则，${TOOL_DEFS.length} 个工具。\n`);
