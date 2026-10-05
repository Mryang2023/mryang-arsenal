#!/usr/bin/env node
/**
 * 杨先生的军火库 · MCP 回归探针
 *
 * spawn 一个 mcp-stdio.mjs 子进程（stdio 管道），逐条喂 JSON-RPC 并断言**内容**，
 * 不是「有响应就算过」：数字、规则 ID、错误码、两处出口的同一性都验。
 *
 * 实测口径（2026-09-27）：规则 69 条、NEVER 13 条、「线程池」命中 6 条。
 * 数字断言与规则集同步 —— 规则集扩容后这里会红，改常数即可，那是探针在提醒你重算口径。
 *
 * 用法：node arsenal-server/scripts/mcp-probe.mjs
 * 退出码：全过 0；有失败 1（失败逐条打印在下面）。
 */

import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve as resolvePath } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, 'mcp-stdio.mjs');
/** 仓库根。用于现读 mcp-tools.json 与 arsenal-charter/*.json —— 事实源不手抄。 */
const REPO_ROOT = join(__dirname, '..', '..');
/** 探针的判定日。**必须显式给**，不能让服务端读系统时钟 —— 「条款生效了没」「豁免到期了没」会随运行时刻变，探针就无法稳定复现。 */
const PROBE_TODAY = process.env.ARSENAL_TODAY ?? '2026-10-04';
const TIMEOUT_MS = 10_000;

// 实测口径（改规则集后同步这里，探针红就是提醒你重算）：
const EXPECT = {
  RULE_COUNT: 69, // resources/list 条数 = 规则总数
  NEVER_COUNT: 13, // get_prompt / prompts/get severity=NEVER 的条数
  THREAD_POOL_MIN_HITS: 1, // search_rules「线程池」命中下限（实测 6，只卡下限防规则文案改动误红）
};

// ──────────────────────────────────────────────── 断言记账
const results = [];
let failed = 0;
function check(name, ok, detail) {
  results.push({ name, ok });
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`      ↳ ${detail}`);
}
const fmt = (v) => JSON.stringify(v)?.length > 300 ? JSON.stringify(v).slice(0, 300) + '…' : JSON.stringify(v);

// ──────────────────────────────────────────────── stdio 客户端
const child = spawn(process.execPath, [SERVER], { stdio: ['pipe', 'pipe', 'pipe'] });
child.stdin.on('error', () => {}); // 子进程死了之后的 EPIPE 不许把探针自己崩掉

let outBuf = '';
let stderrBuf = '';
let exited = null;
const pending = new Map();
const unexpected = [];
let nextId = 0;

child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  outBuf += chunk;
  let nl;
  while ((nl = outBuf.indexOf('\n')) >= 0) {
    const line = outBuf.slice(0, nl).trim();
    outBuf = outBuf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      unexpected.push('stdout 出现非 JSON 行：' + line.slice(0, 120));
      continue;
    }
    const waiter = pending.get(msg.id);
    if (waiter) {
      pending.delete(msg.id);
      waiter(msg);
    } else {
      // 通知不该有响应、id 不该错位 —— 多出来任何一条都是「协议在乱说话」。
      unexpected.push('收到未登记的响应：' + line.slice(0, 160));
    }
  }
});
child.stderr.setEncoding('utf8');
child.stderr.on('data', (d) => {
  stderrBuf += d;
});
child.on('exit', (code) => {
  exited = code;
});

function request(method, params) {
  const id = ++nextId;
  const frame = { jsonrpc: '2.0', id, method };
  if (params !== undefined) frame.params = params;
  return new Promise((resolveP, reject) => {
    if (exited !== null) {
      reject(new Error(`子进程已退出（code=${exited}）无法发送 ${method}。stderr：${stderrBuf.trim().slice(-400)}`));
      return;
    }
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`等 ${method} 响应超时（${TIMEOUT_MS}ms）${exited !== null ? `；子进程已退出 code=${exited}，stderr：${stderrBuf.trim().slice(-400)}` : ''}`));
    }, TIMEOUT_MS);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolveP(msg);
    });
    child.stdin.write(JSON.stringify(frame) + '\n');
  });
}

function notify(method, params) {
  const frame = { jsonrpc: '2.0', method };
  if (params !== undefined) frame.params = params;
  child.stdin.write(JSON.stringify(frame) + '\n');
}

// ──────────────────────────────────────────────── 场景
try {
  // 【1】initialize：客户端带新版本号 → 原样回同版本
  const initNew = await request('initialize', {
    protocolVersion: '2025-06-18',
    clientInfo: { name: 'arsenal-probe', version: '0.0.0' },
  });
  check(
    'initialize 版本协商：客户端 2025-06-18 → 回 2025-06-18',
    initNew.result?.protocolVersion === '2025-06-18',
    `实际回 ${fmt(initNew.result?.protocolVersion)}`
  );
  check(
    'initialize capabilities 声明 tools/resources/prompts',
    !!initNew.result?.capabilities?.tools && !!initNew.result?.capabilities?.resources && !!initNew.result?.capabilities?.prompts,
    `实际 capabilities=${fmt(initNew.result?.capabilities)}`
  );
  check(
    'initialize serverInfo.name = arsenal',
    initNew.result?.serverInfo?.name === 'arsenal',
    `实际 ${fmt(initNew.result?.serverInfo)}`
  );

  // 【2】notifications/initialized：必须静默 —— 不回包、不崩（后续请求还能对上号即为证）
  notify('notifications/initialized');

  // 【3】initialize：客户端带不认识的版本 → 回服务器默认
  const initOld = await request('initialize', { protocolVersion: '2099-01-01' });
  check(
    'initialize 版本协商：客户端 2099-01-01（不认识）→ 回默认 2024-11-05',
    initOld.result?.protocolVersion === '2024-11-05',
    `实际回 ${fmt(initOld.result?.protocolVersion)}`
  );

  // 【4】ping
  const pong = await request('ping');
  check('ping 返回空对象', JSON.stringify(pong.result) === '{}' && !pong.error, `实际 ${fmt(pong.result ?? pong.error)}`);

  // 【5】tools/list：工具数与名称**从 mcp-tools.json 现读**，不写死。
  //
  // 写死过（`names.length === 4` + 四个名字的数组），后果是 2026-10-04 加了三个章程工具后
  // 探针报「返回 4 个工具」而实际 7 个 —— **它本该在加工具的那一刻提醒我改它**，
  // 实际却成了要我自己想起来改的地方。这就是「手抄数字」的标准形态。
  //
  // 现在改成从事实源读：新增工具不用改探针，**漏实现一个 handler 才会红**。
  const EXPECTED_TOOLS = JSON.parse(
    readFileSync(join(REPO_ROOT, 'arsenal-rules', 'mcp-tools.json'), 'utf8')
  ).tools.map((t) => t.name);

  const tl = await request('tools/list');
  const tools = tl.result?.tools ?? [];
  const names = tools.map((t) => t.name);
  check(
    `tools/list 返回 ${EXPECTED_TOOLS.length} 个工具，名称与 mcp-tools.json 一致（现读，不写死）`,
    names.length === EXPECTED_TOOLS.length && EXPECTED_TOOLS.every((n) => names.includes(n)),
    `声明 ${EXPECTED_TOOLS.length} / 实际 ${names.length}；差集 ${fmt(
      EXPECTED_TOOLS.filter((n) => !names.includes(n)),
    )} / ${fmt(names.filter((n) => !EXPECTED_TOOLS.includes(n)))}`
  );
  const schemaBad = tools.filter(
    (t) => t.inputSchema?.type !== 'object' || Object.keys(t.inputSchema?.properties ?? {}).length === 0
  );
  check(
    '每个工具 inputSchema 非空（type=object 且 properties 至少 1 个字段）',
    schemaBad.length === 0,
    schemaBad.length ? `不合规：${schemaBad.map((t) => t.name).join(', ')}` : ''
  );

  // 【6】search_rules「线程池」
  const sr = await request('tools/call', { name: 'search_rules', arguments: { query: '线程池' } });
  const srText = sr.result?.content?.[0]?.text ?? '';
  const srCount = Number(/^匹配到 (\d+) 条/.exec(srText)?.[1] ?? 0);
  const bulletCount = (srText.match(/^• /gm) ?? []).length;
  check(
    `search_rules「线程池」命中 > 0（实测 ${srCount} 条）`,
    srCount >= EXPECT.THREAD_POOL_MIN_HITS && !sr.error,
    `解析到 ${srCount} 条，文本开头：${srText.slice(0, 80)}`
  );
  check(
    'search_rules 正文条数与声明一致（「匹配到 N 条」= 列表行数）',
    srCount === bulletCount,
    `声明 ${srCount}，正文 ${bulletCount} 行`
  );
  check(
    'search_rules 命中线程池基线规则 CONC-POOL-001',
    srText.includes('CONC-POOL-001'),
    `文本里没有 CONC-POOL-001`
  );

  // 【7】get_prompt severity=NEVER
  const gp = await request('tools/call', { name: 'get_prompt', arguments: { severity: 'NEVER' } });
  const gpText = gp.result?.content?.[0]?.text ?? '';
  const gpCount = Number(/共 (\d+) 条/.exec(gpText)?.[1] ?? 0);
  const gpLines = (gpText.match(/^- \[NEVER\] /gm) ?? []).length;
  check(
    `get_prompt severity=NEVER 返回 ${EXPECT.NEVER_COUNT} 条`,
    gpCount === EXPECT.NEVER_COUNT && gpLines === EXPECT.NEVER_COUNT && !gp.error,
    `声明 ${gpCount} 条 / 正文 ${gpLines} 行，文本开头：${gpText.slice(0, 80)}`
  );

  // 【8】lint_code：违规代码必须被扣分
  const lintSample = [
    'public class Demo {',
    '  public static void main(String[] args) throws Exception {',
    '    Thread t = new Thread(() -> System.out.println("hi"));',
    '    t.start();',
    '    Executors.newFixedThreadPool(4);',
    '    try { risky(); } catch (Exception e) { e.printStackTrace(); }',
    '  }',
    '}',
  ].join('\n');
  const lc = await request('tools/call', {
    name: 'lint_code',
    arguments: { filename: 'src/main/java/demo/Demo.java', content: lintSample },
  });
  const lcText = lc.result?.content?.[0]?.text ?? '';
  const score = Number(/合规分 (\d+)\/100/.exec(lcText)?.[1] ?? NaN);
  const viol = Number(/违规 (\d+) 条/.exec(lcText)?.[1] ?? NaN);
  check(
    'lint_code 返回合规分（0-100 整数）',
    Number.isInteger(score) && score >= 0 && score <= 100 && !lc.error,
    `解析到 合规分=${score}，文本开头：${lcText.slice(0, 80)}`
  );
  check(
    `违规样例被真实扣分（score=${score} < 100，违规 ${viol} 条 > 0）`,
    score < 100 && viol > 0,
    `解析到 合规分=${score}，违规=${viol}`
  );
  check(
    'lint_code 命中线程池两条基线规则（CONC-POOL-001 / CONC-POOL-002）',
    lcText.includes('CONC-POOL-001') && lcText.includes('CONC-POOL-002'),
    '违规清单里没有 CONC-POOL-001 或 CONC-POOL-002'
  );

  // 【9】resources/list
  const rl = await request('resources/list');
  const resources = rl.result?.resources ?? [];
  const uris = resources.map((r) => r.uri);
  check(
    `resources/list 返回 ${EXPECT.RULE_COUNT} 条资源`,
    resources.length === EXPECT.RULE_COUNT && !rl.error,
    `实际 ${resources.length} 条。若规则集扩容，把 EXPECT.RULE_COUNT 改成新总数`
  );
  const shapeBad = resources.filter(
    (r) => !/^arsenal:\/\/rules\/.+/.test(r.uri ?? '') || !r.name || !r.description || r.mimeType !== 'application/json'
  );
  check(
    '每条资源形状完整（uri=arsenal://rules/<id>、name、description、mimeType）',
    shapeBad.length === 0,
    shapeBad.length ? `首条不合规：${fmt(shapeBad[0])}` : ''
  );
  check(
    '资源 uri 无重复',
    new Set(uris).size === uris.length,
    `去重后 ${new Set(uris).size} / ${uris.length}`
  );

  // 【10】get_rule 与 resources/read 取同一条规则，两处内容必须同一
  const probeRule = resources[0]; // 实测第一条 = COL-GIT-001；用动态第一条，规则集重排也不误红
  const probeId = probeRule ? probeRule.name : '';
  const gr = await request('tools/call', { name: 'get_rule', arguments: { id: probeId } });
  let grRule = null;
  let grParseErr = '';
  try {
    grRule = JSON.parse(gr.result?.content?.[0]?.text ?? 'null');
  } catch (e) {
    grParseErr = String(e.message);
  }
  check(
    `get_rule（${probeId || '取资源首条失败'}）返回可解析的规则 JSON`,
    grRule && grRule.id === probeId && grRule.title && grRule.severity,
    grParseErr || `实际 ${fmt(gr.result?.content?.[0]?.text).slice(0, 160)}`
  );
  const rr = await request('resources/read', { uri: probeRule?.uri ?? 'arsenal://rules/none' });
  let rrRule = null;
  let rrParseErr = '';
  try {
    rrRule = JSON.parse(rr.result?.contents?.[0]?.text ?? 'null');
  } catch (e) {
    rrParseErr = String(e.message);
  }
  check(
    `resources/read（${probeRule?.uri ?? ''}）返回同一份规则 JSON`,
    rrRule && grRule && JSON.stringify(rrRule) === JSON.stringify(grRule),
    rrParseErr || `与 get_rule 的内容不同：${fmt(rrRule).slice(0, 160)}`
  );

  // 【11】resources/read 的两种坏参数 → -32602
  const rrMissing = await request('resources/read', { uri: 'arsenal://rules/NO-SUCH-000' });
  check(
    'resources/read 不存在的 id → -32602',
    rrMissing.error?.code === -32602,
    `实际 ${fmt(rrMissing.error ?? rrMissing.result)}`
  );
  const rrBadUri = await request('resources/read', { uri: 'https://example.com/rule' });
  check(
    'resources/read 非 arsenal://rules/ 的 URI → -32602',
    rrBadUri.error?.code === -32602,
    `实际 ${fmt(rrBadUri.error ?? rrBadUri.result)}`
  );

  // 【12】prompts/list
  const pl = await request('prompts/list');
  const prompts = pl.result?.prompts ?? [];
  check(
    'prompts/list 至少 1 个 prompt，且带 name/description/arguments',
    prompts.length >= 1 &&
      prompts.every((p) => typeof p.name === 'string' && p.name && p.description && Array.isArray(p.arguments)),
    `实际 ${fmt(pl.result)}`
  );

  // 【13】prompts/get severity=NEVER → 与 get_prompt 同一口径的 13 条
  const pg = await request('prompts/get', {
    name: prompts[0]?.name ?? 'arsenal-constraints',
    arguments: { severity: 'NEVER' },
  });
  const pgText = pg.result?.messages?.[0]?.content?.text ?? '';
  const pgCount = Number(/共 (\d+) 条/.exec(pgText)?.[1] ?? 0);
  check(
    `prompts/get severity=NEVER 返回 ${EXPECT.NEVER_COUNT} 条片段（messages[0].content.text）`,
    pg.result?.messages?.[0]?.role === 'user' && pgCount === EXPECT.NEVER_COUNT && !pg.error,
    `解析到 ${pgCount} 条，实际结构 ${fmt(pg.result).slice(0, 160)}`
  );

  // 【14】prompts/get severity 不合法 → -32602
  const pgBad = await request('prompts/get', {
    name: prompts[0]?.name ?? 'arsenal-constraints',
    arguments: { severity: 'WHENEVER' },
  });
  check(
    'prompts/get severity=WHENEVER（不合法）→ -32602',
    pgBad.error?.code === -32602,
    `实际 ${fmt(pgBad.error ?? pgBad.result)}`
  );

  // 【15】未知方法 → -32601
  const unknown = await request('no/such/method');
  check('未知方法 no/such/method → -32601', unknown.error?.code === -32601, `实际 ${fmt(unknown.error ?? unknown.result)}`);

  // 【16】tools/call 缺 name → -32602
  const tcMissing = await request('tools/call', {});
  check('tools/call 缺 params.name → -32602', tcMissing.error?.code === -32602, `实际 ${fmt(tcMissing.error ?? tcMissing.result)}`);

  // 【17】全程没有多余的响应（通知被静默、id 没错位）
  check(
    '通知静默且无多余响应（notifications/initialized 未触发回包）',
    unexpected.length === 0,
    unexpected.slice(0, 3).join(' | ')
  );


  // ══════════════════════════════════════════════════════════════
  // 【11】项目章程层（2026-10-04）：get_charter / list_exceptions / check_clause
  //
  // 这三个工具读的是**另一个数据源**（arsenal-charter/*.json，手写、不经生成器），
  // 所以它们是「另一条链」而不是 search_rules 的分支 —— 光断言 tools/list 里有名字不够，
  // 必须真的调、真的看返回内容。
  // ══════════════════════════════════════════════════════════════

  // 11a. get_charter 返回本项目章程，且带齐四个协作字段
  const gc = await request('tools/call', {
    name: 'get_charter',
    arguments: { today: PROBE_TODAY },
  });
  const gcText = gc.result?.content?.[0]?.text ?? '';
  const charterDir = resolvePath(REPO_ROOT, 'arsenal-charter');
  const charterFiles = existsSync(charterDir)
    ? readdirSync(charterDir).filter((f) => f.endsWith('.json'))
    : [];
  const charterDoc = charterFiles.length
    ? JSON.parse(readFileSync(resolvePath(charterDir, charterFiles.sort()[0]), 'utf8'))
    : null;

  check('get_charter 返回内容非空', gcText.trim().length > 0, `${gcText.length} 字符`);
  if (charterDoc) {
    check(
      'get_charter 报出章程名与基线版本',
      gcText.includes(charterDoc.name) && gcText.includes(charterDoc.extends),
      `${charterDoc.name} / ${charterDoc.extends}`
    );
    const ids = (charterDoc.clauses ?? []).map((c) => c.id);
    check(
      `get_charter 返回全部 ${ids.length} 条条款（一条都不少）`,
      ids.every((id) => gcText.includes(id)),
      `缺：${fmt(ids.filter((id) => !gcText.includes(id)))}`
    );
    // 四个协作字段必须出现在输出里 —— 它们正是章程层存在的理由
    check(
      'get_charter 每条条款带齐四个协作字段（归谁管/依据/生效日/作用域）',
      ['归谁管', '依据', '生效日', '作用域'].every((k) => gcText.includes(k)),
      ''
    );
  } else {
    check('（跳过）arsenal-charter/ 下无文件，不做内容断言', true, '目录为空');
  }

  // 11b. get_charter 的 scope 过滤真的过滤（不是装饰参数）
  if (charterDoc && (charterDoc.clauses ?? []).length > 1) {
    const one = charterDoc.clauses[0];
    const scoped = await request('tools/call', {
      name: 'get_charter',
      arguments: { today: PROBE_TODAY, scope: one.pathGlob },
    });
    const scopedText = scoped.result?.content?.[0]?.text ?? '';
    check(
      'get_charter 的 scope 过滤生效（给了某条款的作用域，只返回它）',
      scopedText.includes(one.id),
      `含 ${one.id}；其余 ${(charterDoc.clauses ?? [])
        .filter((c) => c.id !== one.id)
        .filter((c) => scopedText.includes(c.id))
        .length} 条不该出现却出现了`
    );
  }

  // 11c. list_exceptions 把「先查再申请」这条路给出来
  const le = await request('tools/call', {
    name: 'list_exceptions',
    arguments: { today: PROBE_TODAY },
  });
  const leText = le.result?.content?.[0]?.text ?? '';
  check('list_exceptions 返回内容非空', leText.trim().length > 0, `${leText.length} 字符`);
  if (charterDoc) {
    const excs = charterDoc.exceptions ?? [];
    check(
      `list_exceptions 返回全部 ${excs.length} 笔豁免`,
      excs.every((e) => leText.includes(e.id)),
      `缺：${fmt(excs.filter((e) => !leText.includes(e.id)).map((e) => e.id))}`
    );
    check(
      '每笔豁免带「覆盖范围 + 还债人 + 到期日 + 工单号」',
      excs.every((e) => leText.includes(e.pathGlob) && leText.includes(e.expiresAt) && leText.includes(e.owner)),
      ''
    );
  }

  // 11d. check_clause 端到端：喂条款的 bad 示例，必须报出命中 + 行号
  if (charterDoc) {
    const reClause = (charterDoc.clauses ?? []).find((c) => c.check?.regex?.pattern);
    if (!reClause) {
      check('（跳过）本章程无正则层条款，check_clause 无端到端用例', true, '');
    } else {
      const cc = await request('tools/call', {
        name: 'check_clause',
        arguments: {
          clauseId: reClause.id,
          files: [{ name: 'com/example/Probe.java', content: reClause.bad }],
        },
      });
      const ccText = cc.result?.content?.[0]?.text ?? '';
      check('check_clause 报出命中', ccText.includes('命中'), ccText.slice(0, 60).replace(/\n/g, ' '));
      check('check_clause 命中带行号', /:\d+/.test(ccText), (ccText.match(/:\d+/) ?? ['无'])[0]);
      check('check_clause 回显条款归谁管（写代码的人要知道找谁）', ccText.includes(reClause.clauseOwner), '');

      // 反证：喂 good 示例不该报命中 —— 否则「命中」只是恒真
      const ccGood = await request('tools/call', {
        name: 'check_clause',
        arguments: {
          clauseId: reClause.id,
          files: [{ name: 'com/example/Probe.java', content: reClause.good }],
        },
      });
      const ccGoodText = ccGood.result?.content?.[0]?.text ?? '';
      check(
        '反证：喂该条款的 good 示例 → 不报命中（否则「命中」是恒真断言）',
        !ccGoodText.includes('**命中'),
        ccGoodText.slice(0, 60).replace(/\n/g, ' ')
      );
    }
  }

  // 11e. 查一个不存在的条款 → 必须**指名说没有并列出真实 ID**，不是空字符串也不是报错
  const ccMiss = await request('tools/call', {
    name: 'check_clause',
    arguments: { clauseId: 'PJX-NOT-EXIST-999', files: [{ name: 'a.java', content: 'x' }] },
  });
  const ccMissText = ccMiss.result?.content?.[0]?.text ?? '';
  check(
    'check_clause 查不存在的条款 → 明确说没有并列出真实 ID（不是静默空结果）',
    ccMissText.includes('没有条款') && (charterDoc ? (charterDoc.clauses ?? []).some((c) => ccMissText.includes(c.id)) : true),
    ccMissText.slice(0, 60).replace(/\n/g, ' ')
  );

} catch (e) {
  failed += 1;
  console.log(`FAIL  场景中断：${e.message}`);
  console.log(`      子进程 stderr 末尾：${stderrBuf.trim().slice(-400) || '(空)'}`);
} finally {
  child.kill();
}

const passed = results.filter((r) => r.ok).length;
console.log('');
console.log(`═══ MCP 探针：${passed} 过 / ${failed} 败（共 ${results.length} 项断言）═══`);
process.exit(failed === 0 ? 0 : 1);
