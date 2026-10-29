#!/usr/bin/env node
/**
 * e2e:delivery —— 产品验收链（重建设计计划 §7.8，夜班 N10/2026-10-30）。
 *
 * 一条命令跑通重建后的核心交付闭环，全程只对真实 HTTP 接口说话（不 import 任何业务代码）：
 *
 *   起后端（若 3011 不在）→ 导入 fixture 项目 → 提交 v2 run → 断言 report.md
 *   （含覆盖率披露 / 文件:行 / 规则出处）→ 断言产物清单带 sha256 → 清理。
 *
 * 与站内 2330 项链的关系：那条链守「站内数据自洽」，本脚本守「用户能不能完成一次交付」。
 * 退出码 0 = 链路活着。全程 < 5 分钟。
 */
import { spawn, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
/** fixture 住在 arsenal-web 的 verify 目录下（它与既有 verify 链共用同一套夹具）。 */
const webRoot = path.resolve(here, '..');
const API = 'http://127.0.0.1:3011';
const FIXTURE = path.join(webRoot, '.verify', 'fixtures', 'demo-repo');

let startedByUs = false;
let failures = 0;

function ok(cond, label) {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label);
  if (!cond) failures++;
}

async function api(method, urlPath, body, raw) {
  const res = await fetch(API + urlPath, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return res;
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function waitHealthy(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const out = await api('GET', '/api/health');
      if (out.json?.data?.status === 'UP') return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

/** 与后端 ProjectIds.projectIdOf 同算法：sha256("path:<规范化的值>")[0:12]。 */
function projectIdOfPath(absPath) {
  const normalized = 'path:' + absPath.trim().replaceAll('\\', '/').replace(/\/+$/, '');
  return crypto.createHash('sha256').update(normalized, 'utf-8').digest('hex').slice(0, 12);
}

function killBackendByPort() {
  try {
    const out = execSync('netstat -ano', { encoding: 'utf-8' });
    const pids = new Set(
      out.split('\n')
        .filter((l) => l.includes(':3011') && l.includes('LISTENING'))
        .map((l) => l.trim().split(/\s+/).pop())
        .filter(Boolean),
    );
    for (const pid of pids) {
      try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' }); } catch { /* already gone */ }
    }
    return pids.size > 0;
  } catch {
    return false;
  }
}

console.log('\n== e2e:delivery 体检即产物 ==\n');

// ── ① 后端就绪 ─────────────────────────────────────────────
console.log('① 后端 :3011');
const alreadyUp = await waitHealthy(3000);
if (!alreadyUp) {
  console.log('  后端不在，SKIP_COMPILE=1 拉起（吃现成 target/classes）…');
  const child = spawn('bash', ['arsenal-server/scripts/run.sh'], {
    cwd: repoRoot,
    env: { ...process.env, SKIP_COMPILE: '1' },
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  startedByUs = true;
}
ok(await waitHealthy(90000), '后端健康（UP）');
if (failures) process.exit(1);

// ── ② 导入 fixture ─────────────────────────────────────────
console.log('② 导入 fixture（.verify/fixtures/demo-repo）');
if (!fs.existsSync(FIXTURE)) {
  console.log('  ✗ fixture 不存在：' + FIXTURE);
  process.exit(1);
}
const pid = projectIdOfPath(FIXTURE);
const add = await api('POST', '/api/projects', { name: 'e2e-delivery-demo', source: { kind: 'path', value: FIXTURE } });
ok(add.status === 200 && (add.json?.success || add.json?.code === 'CONFLICT'),
  `项目已注册（success=${add.json?.success} code=${add.json?.code ?? ''}，重复导入按 CONFLICT 复用）`);
const detail = await api('GET', `/api/projects/${pid}`);
ok(detail.json?.success === true && detail.json?.data?.cache?.fingerprint, `缓存就绪（projectId=${pid}）`);
if (failures) process.exit(1);

// ── ③ 提交 v2 run ──────────────────────────────────────────
console.log('③ 提交体检 run（POST /api/v2/projects/{id}/runs）');
const run = await api('POST', `/api/v2/projects/${pid}/runs`, {});
ok(run.json?.success === true && run.json?.data?.status === 'DONE',
  `run 完成（runId=${run.json?.data?.runId ?? '?'} counts=${JSON.stringify(run.json?.data?.counts ?? {})}）`);
const runId = run.json?.data?.runId;
if (!runId) process.exit(1);

// ── ④ 报告可下载且内容过硬 ─────────────────────────────────
console.log('④ 下载 report.md 并断言内容');
const rep = await api('GET', `/api/v2/runs/${runId}/report.md`, undefined, true);
ok(rep.status === 200, 'GET /api/v2/runs/{runId}/report.md → 200');
ok((rep.headers.get('content-disposition') ?? '').includes('attachment'), 'Content-Disposition 附件头在场');
const md = await rep.text();
ok(md.includes('本次覆盖'), '报告含覆盖率披露段（不把没跑说成没问题）');
ok(md.includes('Top 问题'), '报告含 Top 问题段');
ok(/[A-Za-z0-9_\-./]+\.(java|xml|yml|properties):\d+/.test(md), '报告的问题带 文件:行 定位');
ok(/出处|阿里巴巴|Spring|OWASP/.test(md), '报告的问题带规则出处');
ok(md.includes('健康分'), '报告含健康分');

// ── ⑤ 产物清单带哈希 ───────────────────────────────────────
console.log('⑤ 产物清单（GET /api/v2/runs/{runId}/artifacts）');
const arts = await api('GET', `/api/v2/runs/${runId}/artifacts`);
const names = (arts.json?.data ?? []).map((a) => a.name);
ok(arts.json?.success === true, '清单可取');
ok(['run.json', 'findings.jsonl', 'coverage.json', 'report.md', 'summary.json'].every((n) => names.includes(n)),
  '五类核心产物齐备：' + names.join(', '));
const repArt = (arts.json?.data ?? []).find((a) => a.name === 'report.md');
ok(/^\w{64}$/.test(repArt?.sha256 ?? ''), 'report.md 带 sha256（可复现）');
ok((arts.json?.data ?? []).every((a) => a.sha256 && a.bytes > 0), '每项产物都有哈希与字节数');

// ── ⑥ 收尾 ─────────────────────────────────────────────────
console.log('⑥ 清理');
const del = await api('DELETE', `/api/projects/${pid}`);
ok(del.json?.success === true, 'fixture 项目已删除（QA/run 历史按后端口径保留）');
if (startedByUs) {
  killBackendByPort();
  console.log('  （由本脚本拉起的后端已停止）');
} else {
  console.log('  （后端本来就在跑，保持原样不关）');
}

console.log(`\n== 结果：${failures === 0 ? '全部通过' : failures + ' 项失败'} ==\n`);
process.exit(failures === 0 ? 0 : 1);
