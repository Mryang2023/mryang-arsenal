#!/usr/bin/env node
/**
 * ddl.mjs —— 四件套的**命令行出口**（只读 + 只生成，永不写被管理项目）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么要有这个文件
 *
 * 档案页那个「四件套校验」页签是给人看的；AI 改表时要的是**能贴进终端**的正文。
 * 没有 CLI 时，AI 只能「打开浏览器 → 点页签 → 复制」，或者绕开军火库直接凭记忆
 * 写 SQL —— 后者正是四件套最常断链的地方（脚本写了，CHANGELOG 忘了）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 边界（与 DdlController 的类注释同一条，写两遍是故意的）
 *
 *   plan    生成 → 打印 → 留档在军火库自己的 .data/ 下。**不改被管理项目的任何文件。**
 *   verify  读缓存 → 算四件套完整性。只读。
 *   没有 apply / exec 子命令。**以后也不要加** —— 军火库是记录者，不是操作者。
 *   真正落盘由人或 AI 用编辑器完成，就位后刷新项目缓存，verify 才会变绿。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 用法
 *
 *   node arsenal-server/scripts/ddl.mjs verify  --project 89d62092d0c7
 *   node arsenal-server/scripts/ddl.mjs plan    --project <id> --spec docs/db/spec.json
 *   node arsenal-server/scripts/ddl.mjs plan    --project <id> --spec -     # 从 stdin 读
 *   node arsenal-server/scripts/ddl.mjs plans   --project <id>
 *   node arsenal-server/scripts/ddl.mjs show    --project <id> --plan 20261021-115312-equipment_ledger
 *
 *   公共参数：--base http://localhost:3011（默认取 ARSENAL_API，再回落本机 3011）
 *            --json   原样打印后端 JSON（给脚本吃）
 *
 * spec 就是 POST /ddl/plan 的请求体：{table, title, operation?, module?, date?, columns[], indexes?}
 * 字段口径见 DdlPlanService 的类注释。record:false 可只生成不留档。
 */

import fs from 'node:fs';
import process from 'node:process';

const BASE = arg('base') || process.env.ARSENAL_API || 'http://localhost:3011';
const JSON_OUT = has('json');

function has(name) {
  return process.argv.includes(`--${name}`);
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : '';
}

function die(msg) {
  console.error(`✕ ${msg}`);
  process.exit(1);
}

async function call(method, urlPath, body) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`${BASE}${urlPath}`, init);
  } catch (e) {
    die(`连不上 ${BASE}（${e.message}）。起服务：bash arsenal-server/scripts/run.sh`);
  }
  let env;
  try {
    env = await res.json();
  } catch {
    die(`后端返回的不是 JSON（HTTP ${res.status}）—— 路由可能不存在`);
  }
  if (!env.success) {
    die(`${env.code || `HTTP_${res.status}`}：${env.message || '请求失败'}`);
  }
  return env.data;
}

// ─────────────────────────────────────────────────────────────
// 子命令
// ─────────────────────────────────────────────────────────────

async function verify(project) {
  const d = await call('GET', `/api/projects/${enc(project)}/ddl/verify`);
  if (JSON_OUT) return print(d);

  const s = d.summary;
  console.log(`四件套完整性  ${d.score}/100   （${d.generatedAt}）`);
  console.log(`  ${s.complete} 完整 · ${s.partial} 部分 · ${s.missing} 缺失 / 共 ${s.tables} 张表`);
  console.log('');
  for (const c of d.checks) bar(c.label, c.covered, c.total);
  console.log('');
  console.log(`  脚本 ${s.scripts} 份（模板 ${s.templateScripts}）· 变更日志 ${s.changelogEntries} 条 · 表说明 ${s.documented} 份 · 实体 ${s.entities} 个`);

  if (d.findings.length) {
    console.log('\n全局问题：');
    for (const f of d.findings) console.log(`  ${mark(f.level)} ${f.message}`);
  }

  const broken = d.tables.filter((t) => t.status !== 'complete');
  if (broken.length) {
    console.log(`\n未齐的表（${broken.length}）：`);
    for (const t of broken) {
      const miss = [];
      if (!t.pieces.sql.ok) miss.push('脚本');
      if (!t.pieces.changelog.ok) miss.push('日志');
      if (!t.pieces.tableDoc.ok) miss.push('说明');
      if (!t.pieces.entity.ok) miss.push('实体');
      console.log(`  ${t.table.padEnd(28)} 缺 ${miss.join('、') || '—'}   ${t.okPieces}/4`);
    }
  }
  console.log('\n（只读审计：军火库不执行 SQL、不写被管理项目的任何文件。）');
}

async function plan(project) {
  const specPath = arg('spec');
  if (!specPath) die('缺 --spec <file|->（POST /ddl/plan 的请求体）');

  let raw;
  if (specPath === '-') {
    raw = fs.readFileSync(0, 'utf8');
  } else {
    if (!fs.existsSync(specPath)) die(`spec 不存在：${specPath}`);
    raw = fs.readFileSync(specPath, 'utf8');
  }
  let spec;
  try {
    spec = JSON.parse(raw);
  } catch (e) {
    die(`spec 不是合法 JSON：${e.message}`);
  }

  const p = await call('POST', `/api/projects/${enc(project)}/ddl/plan`, spec);
  if (JSON_OUT) return print(p);

  console.log(`计划 ${p.planId}  ${p.operation} ${p.table}  （${p.title}）`);
  console.log(`  ${p.stats.businessColumns} 业务字段 · 共 ${p.stats.totalColumns} 列 · ${p.stats.indexes} 索引`);
  console.log(`  留档：${p.recorded ? '已记入军火库 .data/（不是被管理项目）' : '未留档（record:false）'}`);
  console.log('');

  for (const w of p.warnings) console.log(`  ${mark(w.level)} ${w.message}${w.field ? `  [${w.field}]` : ''}`);
  if (p.warnings.length) console.log('');

  const ARTIFACTS = [
    ['sql', '可执行脚本'],
    ['changelog', '变更日志行'],
    ['tableDoc', '表结构说明'],
    ['entity', '实体类'],
  ];
  console.log('四件套（路径是**建议落点**，军火库一个都没写）：');
  for (const [key, label] of ARTIFACTS) {
    const a = p.artifacts[key];
    console.log(`  ${padCjk(label, 10)} ${padCjk(actionLabel(a.action), 18)} ${a.path}`);
  }

  console.log('\n' + '─'.repeat(70));
  for (const [key, label] of ARTIFACTS) {
    const a = p.artifacts[key];
    console.log(`\n### ${label} · ${actionLabel(a.action)} · ${a.path}\n`);
    console.log(a.content);
  }
  console.log('─'.repeat(70));
  console.log('\n以上只是稿子。写不写、写到哪里，由人和 AI 的编辑器决定；');
  console.log('军火库不落盘、不执行 SQL。写入后刷新项目缓存，verify 才会变绿。');
  if (!p.recorded) console.log('\n⚠ 本次没有留档，档案页看不到这次计划。');
}

async function plans(project) {
  const list = await call('GET', `/api/projects/${enc(project)}/ddl/plans`);
  if (JSON_OUT) return print(list);

  if (!list.length) {
    console.log('还没有计划留档。');
    console.log('改表前：ddl.mjs plan --project <id> --spec <file>');
    return;
  }
  console.log(`计划留档 ${list.length} 份（按记录时间倒序）：\n`);
  for (const p of list) {
    const bad = p.problems.length ? `${p.problems.length} 条提示` : '校验通过';
    console.log(`  ${p.recordedAt || p.generatedAt}  ${p.operation.padEnd(6)} ${p.table.padEnd(26)} ${bad}  ${p.planId}`);
  }
}

async function show(project) {
  const planId = arg('plan');
  if (!planId) die('缺 --plan <planId>（列表用 plans 子命令）');
  const p = await call('GET', `/api/projects/${enc(project)}/ddl/plans/${enc(planId)}`);
  if (JSON_OUT) return print(p);

  console.log(`${p.title}  ${p.table}  ${p.operation}  ${p.planId}`);
  for (const w of p.warnings) console.log(`  ${mark(w.level)} ${w.message}`);
  console.log('');
  for (const [key, label] of [
    ['sql', '可执行脚本'],
    ['changelog', '变更日志行'],
    ['tableDoc', '表结构说明'],
    ['entity', '实体类'],
  ]) {
    const a = p.artifacts[key];
    console.log(`\n### ${label} · ${actionLabel(a.action)} · ${a.path}\n`);
    console.log(a.content);
  }
}

// ─────────────────────────────────────────────────────────────
// 小工具
// ─────────────────────────────────────────────────────────────

function enc(s) {
  return encodeURIComponent(s);
}

function print(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function mark(level) {
  return level === 'error' ? '✕' : level === 'warn' ? '!' : '·';
}

function bar(label, covered, total) {
  const pct = total ? Math.round((covered * 100) / total) : 0;
  const width = 24;
  const filled = Math.round((pct * width) / 100);
  console.log(`  ${padCjk(label, 10)} ${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${String(covered).padStart(3)}/${total}  ${pct}%`);
}

/** 中文字符占两列：按显示宽度补空格，否则四条进度条会错开一格。 */
// U+1100-115F Hangul Jamo·U+2E80-A4CF 部首/汉字·U+AC00-D7A3 谚文·U+F900-FAFF 兼容汉字
// U+FE30-FE6F 兼容标点·U+FF00-FF60 全角·U+FFE0-FFE6 全角符号
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/;
function padCjk(s, cols) {
  let w = 0;
  for (const ch of s) w += WIDE.test(ch) ? 2 : 1;
  return s + ' '.repeat(Math.max(0, cols - w));
}

function actionLabel(action) {
  return (
    {
      create: '新建',
      update: '并入已有',
      append: '追加一行',
      fragment: '片段(勿当全文)',
      none: '无需改动',
    }[action] || action
  );
}

// ─────────────────────────────────────────────────────────────

const [cmd] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const project = arg('project') || arg('p');

if (!project) {
  console.error(`用法：
  ddl.mjs verify  --project <id>
  ddl.mjs plan    --project <id> --spec <file|->
  ddl.mjs plans   --project <id>
  ddl.mjs show    --project <id> --plan <planId>
  可选：--base <url>  --json

没有 apply —— 军火库只生成、只审计，不操作被管理的项目。`);
  process.exit(2);
}

const COMMANDS = { verify, plan, plans, show };
if (!COMMANDS[cmd]) die(`不认识的子命令：${cmd}（verify | plan | plans | show）`);

await COMMANDS[cmd](project);
