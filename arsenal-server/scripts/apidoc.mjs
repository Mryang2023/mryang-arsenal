#!/usr/bin/env node
/**
 * apidoc.mjs —— 接口文档的**命令行出口**（只对账 + 只出稿，永不写被管理项目）。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 为什么要有这个文件
 *
 * IEMS 的打法是「后端写完 → 出接口文档 → 再写前端」。文档是要交给前端同事的交付物，
 * 所以它不能靠记忆补：Controller 加了接口忘了写文档，联调时才发现，代价最大。
 *
 * verify 把 Controller 里的真实接口与 docs/api/<module>.md 逐条对照，
 * 缺哪个、多哪个、OpenAPI 附件是否过期，一次说清。plan 按代码生成两份草稿骨架，
 * 请求参数、错误码、示例由人补 —— 那些是业务判断，扫描补不出来。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 边界（与 ApiDocController 的类注释同一条，写两遍是故意的）
 *
 *   plan    生成 → 打印 → 留档在军火库自己的 .data/ 下。**不改被管理项目的任何文件。**
 *   verify  读缓存 → 对账。只读。
 *   没有 apply / write 子命令。**以后也不要加。**
 *   真正落盘由人把稿子写进 docs/api/，再刷新项目缓存，verify 才会变绿。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 用法
 *
 *   node arsenal-server/scripts/apidoc.mjs verify --project 89d62092d0c7 --module equipment
 *   node arsenal-server/scripts/apidoc.mjs plan   --project <id> --module customer
 *   node arsenal-server/scripts/apidoc.mjs plan   --project <id> --module customer --no-record
 *   node arsenal-server/scripts/apidoc.mjs plans  --project <id>
 *   node arsenal-server/scripts/apidoc.mjs show   --project <id> --plan 20261021-153012-customer-apidoc
 *
 *   公共参数：--base http://localhost:3011（默认取 ARSENAL_API，再回落本机 3011）
 *            --json   原样打印后端 JSON（给脚本吃）
 */

import process from 'node:process';

const BASE = arg('base') || process.env.ARSENAL_API || 'http://localhost:3011';
const JSON_OUT = has('json');
const MODULE = arg('module') || arg('m');

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

function needModule() {
  if (!MODULE) die('缺 --module <module>（英文小写，如 customer、equipment）');
  return MODULE;
}

// ─────────────────────────────────────────────────────────────
// 子命令
// ─────────────────────────────────────────────────────────────

async function verify(project) {
  const module = needModule();
  const d = await call('GET', `/api/projects/${enc(project)}/apidoc/verify?module=${enc(module)}`);
  if (JSON_OUT) return print(d);

  console.log(`接口文档对账  ${d.module}  ${statusLabel(d.status)}`);
  const s = d.summary;
  console.log(`  代码 ${s.codeEndpoints} 个接口 · 文档 ${s.docEndpoints} 条 · 对上 ${s.matched}`
    + ` · 缺 ${s.missing} · 多 ${s.extra}`);
  console.log('');

  fileLine('Markdown', d.doc.markdown, 'endpointCount', '条接口');
  fileLine('OpenAPI ', d.doc.openapi, 'endpointCount', '个路径');

  if (d.missing.length) {
    console.log(`\n缺失（代码里有、文档没写）${d.missing.length}：`);
    for (const e of d.missing) {
      console.log(`  ✕ ${e.method.padEnd(6)} ${padCjk(e.path, 42)} ${e.summary || ''}`);
    }
  }
  if (d.extra.length) {
    console.log(`\n多余（文档里有、代码没有）${d.extra.length}：`);
    for (const e of d.extra) {
      console.log(`  ! ${e.method.padEnd(6)} ${padCjk(e.path, 42)} ${e.line ? `第 ${e.line} 行` : ''}`);
    }
  }
  if (d.doc.openapi.extra && d.doc.openapi.extra.length) {
    console.log(`\nOpenAPI 附件过期${d.doc.openapi.extra.length}：`);
    for (const p of d.doc.openapi.extra) console.log(`  ! ${p}`);
  }
  if (d.notes.length) {
    console.log('\n提示：');
    for (const n of d.notes) console.log(`  ${mark(n.level)} ${n.message}`);
  }

  console.log('\n（只读对账：军火库不执行接口、不写被管理项目的任何文件。）');
  if (!d.ok) console.log('文档没对齐 —— 接口变更必须与 docs/api/ 同一次提交。');
}

async function plan(project) {
  const module = needModule();
  const record = !has('no-record');
  const resp = await call('POST', `/api/projects/${enc(project)}/apidoc/plan`,
    { module, record });
  if (JSON_OUT) return print(resp);

  const p = resp.plan;
  const st = p.stats;
  console.log(`草稿 ${p.planId}  ${p.module}  （${p.date}）`);
  console.log(`  ${st.endpoints} 个接口 · ${st.controllers} 个 Controller · ${st.resources} 个资源`
    + ` · 带权限码 ${st.withPermission} · 带摘要 ${st.withSummary}`);
  console.log(`  留档：${p.recorded ? '已记入军火库 .data/（不是被管理项目）' : '未留档（--no-record）'}`);

  if (resp.notes.length) {
    console.log('');
    for (const n of resp.notes) console.log(`  ${mark(n.level)} ${n.message}`);
  }

  console.log('\n两份交付物（路径是**建议落点**，军火库一个都没写）：');
  for (const [key, label] of [['markdown', 'Markdown'], ['openapi', 'OpenAPI ']]) {
    const a = p.artifacts[key];
    console.log(`  ${label}  ${padCjk(actionLabel(a.action), 8)} ${a.path}`);
  }

  console.log('\n' + '─'.repeat(70));
  for (const [key, label] of [['markdown', 'Markdown'], ['openapi', 'OpenAPI']]) {
    const a = p.artifacts[key];
    console.log(`\n### ${label} · ${actionLabel(a.action)} · ${a.path}\n`);
    console.log(a.content);
  }
  console.log('─'.repeat(70));
  console.log('\n以上只是骨架：请求/响应字段、错误码、示例要人补。');
  console.log('写进 docs/api/ 后刷新项目缓存，apidoc verify 才会变绿。');
  if (!p.recorded) console.log('\n⚠ 本次没有留档，档案页看不到这份草稿。');
}

async function plans(project) {
  const list = await call('GET', `/api/projects/${enc(project)}/apidoc/plans`);
  if (JSON_OUT) return print(list);

  if (!list.length) {
    console.log('还没有接口文档草稿。');
    console.log('出稿：apidoc.mjs plan --project <id> --module <module>');
    return;
  }
  console.log(`草稿留档 ${list.length} 份（按记录时间倒序）：\n`);
  for (const p of list) {
    const st = p.stats || {};
    console.log(`  ${p.recordedAt || p.generatedAt}  ${padCjk(p.module, 12)}`
      + `${String(st.endpoints ?? 0).padStart(3)} 个接口  ${p.planId}`);
  }
}

async function show(project) {
  const planId = arg('plan');
  if (!planId) die('缺 --plan <planId>（列表用 plans 子命令）');
  const p = await call('GET', `/api/projects/${enc(project)}/apidoc/plans/${enc(planId)}`);
  if (JSON_OUT) return print(p);

  console.log(`${p.module}  ${p.planId}  （${p.date}）`);
  for (const [key, label] of [['markdown', 'Markdown'], ['openapi', 'OpenAPI']]) {
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

function statusLabel(status) {
  return (
    {
      ok: '✓ 已对齐',
      incomplete: '! 未对齐',
      missing: '✕ 还没有文档',
    }[status] || status
  );
}

function actionLabel(action) {
  return {
    create: '新建',
    update: '并入',
    none: '无需改动',
  }[action] || action;
}

function fileLine(label, f, countKey, unit) {
  if (!f.present) {
    console.log(`  ${label}  ✕ 缺失  ${f.path}`);
    return;
  }
  const n = f[countKey] || 0;
  console.log(`  ${label}  ✓ ${String(n).padStart(3)} ${unit}  ${f.path}`);
}

/** 中文字符占两列：按显示宽度补空格，否则对账列表会错开。 */
// U+1100-115F Hangul Jamo·U+2E80-A4CF 部首/汉字·U+AC00-D7A3 谚文·U+F900-FAFF 兼容汉字
// U+FE30-FE6F 兼容标点·U+FF00-FF60 全角·U+FFE0-FFE6 全角符号
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/;
function padCjk(s, cols) {
  let w = 0;
  for (const ch of s) w += WIDE.test(ch) ? 2 : 1;
  return s + ' '.repeat(Math.max(0, cols - w));
}

// ─────────────────────────────────────────────────────────────

const [cmd] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const project = arg('project') || arg('p');

if (!project) {
  console.error(`用法：
  apidoc.mjs verify --project <id> --module <module>
  apidoc.mjs plan   --project <id> --module <module> [--no-record]
  apidoc.mjs plans  --project <id>
  apidoc.mjs show   --project <id> --plan <planId>
  可选：--base <url>  --json

没有 apply —— 军火库只对账、只出稿，不写被管理的项目。`);
  process.exit(2);
}

const COMMANDS = { verify, plan, plans, show };
if (!COMMANDS[cmd]) die(`不认识的子命令：${cmd}（verify | plan | plans | show）`);

await COMMANDS[cmd](project);
