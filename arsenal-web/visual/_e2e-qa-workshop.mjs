/**
 * 一次性 E2E 探针（2026-10-17 超级夜 · 工坊棒4 QA 改造）—— 跑完即删，不进 git。
 *
 * 验 verify 链验不了的事（工坊棒4 P0 活体验收，免后端 route mock）：
 *   甲 没有当前项目 → 守卫空态 + 去项目管理入口；临时地址输入退场
 *   乙 lastJobId=RUNNING → 挂载即恢复执行进度面板 + 轮询真在跳（jobs 请求计数 ≥2）
 *   丙 lastJobId=DONE  → 挂载直接出报告（边界卡 + 四页签），不出进度条
 *   丁 反着验：lastJobId 断开（null）→ 什么都不恢复（进度条与报告都不出现）
 *   戊 lastJobId=FAILED → 照实报红，不说健康
 *   己 后端离线 → 项目卡照显（本地名字）+ 内容区离线话术 + 开始审查禁用
 *   另：320px 无横向溢出、零 pageerror
 *
 * 用法：node visual/_e2e-qa-workshop.mjs（需 :3010 dev 活着）
 */
import { chromium } from 'playwright-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './browser.mjs';

const BASE = process.env.E2E_BASE || 'http://localhost:3010';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.workbuddy', 'night-chain', '2026-10-17');

const results = [];
const consoleErrors = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
  console.log(`  ${cond ? '✓' : '✗'} ${name}${detail ? ` —— ${detail}` : ''}`);
}

const PID = 'a1b2c3d4e5f6';

// ───────── mock 数据（与 _e2e-qa.mjs 同族的报告形状） ─────────

function detail(lastJobId) {
  return {
    success: true, code: 'OK', message: null,
    data: {
      id: PID, name: '演示项目', source: { kind: 'path', value: 'D:/demo/repo' },
      note: '', addedAt: '2026-10-18T09:00:00+08:00',
      cache: { files: 42, bytes: 90000, ingestedAt: '2026-10-18T09:00:04+08:00', fingerprint: 'dir:42:90000', lastRefresh: null, lastDiff: null },
      lastFactsAt: null, lastJobId,
    },
  };
}
const JOB = (status, phases, error = null) => ({
  success: true, code: 'OK', message: null,
  data: { jobId: 'job-mock-1', projectId: PID, status, phase: null, phases, error },
});
const SNAPSHOTS = {
  success: true, code: 'OK', message: null,
  data: [{ jobId: 'job-old-1', scannedAt: '2026-10-18T09:30:00Z', mode: 'full', files: 12, filesMatched: 12, p0: 2, p1: 2, truncated: false }],
};

function finding(rule, tier, file, line) {
  return {
    ruleId: rule.id, title: rule.title, severity: rule.severity, category: rule.category,
    file, line, column: 8,
    snippet: 'mock 片段', message: `${rule.title} —— 判据原话（mock）`, collapsed: 0,
    evidence: `${file}:${line}`, rule, impact: rule.impact, impactSource: 'rule-impact',
  };
}
const RULE_SEC = {
  id: 'SEC-AUTH-001', category: 'security', subcategory: 'authorization',
  title: '涉及用户私有数据的接口必须校验资源归属，防水平越权', severity: 'MUST',
  sources: [{ ref: 'mock', type: 'internal', quote: 'mock' }],
  rationale: 'mock', impact: '越权。', bad: 'bad', good: 'good', check: {}, promptFragment: '', version: 1,
};
function reportV2() {
  const p0 = [finding(RULE_SEC, 'p0', 'src/main/java/com/x/OrderController.java', 42)];
  return {
    schemaVersion: 2, jobId: 'job-mock-1', projectId: PID,
    scannedAt: '2026-10-18T10:40:00Z', elapsedMs: 4321,
    projectRef: { kind: 'path', rootName: 'demo-repo' },
    targetRange: { mode: 'full', include: [], exclude: [], filesTotal: 12, filesMatched: 12, pctOfRepo: 100 },
    scope: { files: 12, bytes: 4096, truncated: false, rootName: 'demo-repo', maxFiles: 2000, maxTotalBytes: 10485760 },
    coverage: { total: 69, executed: 69, notRun: 0, batches: 1, decidable: true, severityPool: {}, tierPool: { p0: 1, p1: 0, other: 0 }, skipped: [], skippedCount: 0, parseFailures: [], undecidability: [], scopeFilteredOut: 0 },
    staticFindings: { p0, p1: [], other: [] },
    semanticFindings: [], semanticVerdicts: [], semanticNotes: [],
    semanticStatus: 'ok', semanticReason: 'mock',
    recommendations: [], testSuggestions: [], skipped: [], undecidability: [], llmUsage: null,
    provenSemanticFindings: [], unconfirmedSemanticFindings: [],
    reproTiers: { proven: 0, notReproduced: 0, invalidTest: 0, notRun: 0 },
    reproStatus: 'ok', reproReason: 'mock', reproNotes: [], reproUsage: null,
    committeeFindings: [], committeeNotes: [], committeeSummary: { consensus: 0, solo: 0, budgetCut: false },
    committeeUsage: null,
    ruleset: { version: '0.1.0', releasedAt: '2026-09-11', ruleCount: 69, activeCount: 69, llmLayerRules: 43, loadedAt: '2026-10-18T02:00:00Z', filesNewestMtime: '2026-10-18T03:00:00Z' },
    groupedByRule: [{ ruleId: 'SEC-AUTH-001', title: RULE_SEC.title, severity: 'MUST', tier: 'static', count: 1, items: [{ file: p0[0].file, line: 42, tier: 'p0' }] }],
    scannedFiles: [],
  };
}
const REPORT_OK = { success: true, code: 'OK', message: null, data: reportV2() };

// ───────── 探针主体 ─────────

const browser = await launchBrowser(chromium);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => consoleErrors.push(String(e)));

async function seedProject(pid) {
  await page.goto(`${BASE}/qa`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((v) => {
    localStorage.clear();
    if (v) localStorage.setItem('arsenal-active-project-v1', JSON.stringify({ id: v, name: '演示项目' }));
  }, pid);
}
async function routes({ lastJobId, job, report, jobsCounter, offlineDetail = false, snapshots = SNAPSHOTS }) {
  let jobs = 0;
  await page.route('**/api/qa/llm-status**', (r) => r.fulfill({ json: { success: true, code: 'OK', message: null, data: { configured: false, model: null } } }));
  // 精确匹配 /api/projects/<PID>（playwright glob 的 ? 是单字符通配 —— 棒9 的坑，不用 glob 写法）
  await page.route((u) => u.pathname === '/api/projects/' + PID, (r) => {
    if (offlineDetail) return r.abort();
    r.fulfill({ json: detail(lastJobId) });
  });
  await page.route('**/api/qa/jobs/**', (r) => {
    jobs++;
    if (jobsCounter) jobsCounter.value = jobs;
    r.fulfill({ json: job });
  });
  await page.route('**/api/qa/reports/**', (r) => r.fulfill({ json: report ?? REPORT_OK }));
  await page.route('**/api/qa/snapshots**', (r) => r.fulfill({ json: snapshots }));
  await page.route('**/api/qa/tree**', (r) => r.fulfill({ json: { success: true, code: 'OK', message: null, data: { projectId: PID, from: 'job-old-1', fromJobId: 'job-old-1', files: [] } } }));
  return { jobsCount: () => jobs };
}

console.log('甲 · 无当前项目 → 守卫空态');
await seedProject(null);
await page.goto(`${BASE}/qa`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
check('甲1 守卫空态话术', (await page.getByText('这两个功能依托于固定项目').count()) > 0);
check('甲2 去项目管理入口', (await page.locator('a[href^="/projects"]').count()) > 0);
check('甲3 临时地址输入退场', (await page.locator('input[placeholder*="D:/mryang"]').count()) === 0 && (await page.locator('input[placeholder*="github.com"]').count()) === 0);

console.log('乙 · RUNNING 续跑（切走再回来进度真在）');
const jobsCounter = { value: 0 };
await seedProject(PID);
await routes({ lastJobId: 'job-mock-1', job: JOB('RUNNING', { CLONING: 'done', SCANNING: 'running', ANALYZING: 'pending', AGGREGATING: 'pending' }), jobsCounter });
await page.goto(`${BASE}/qa`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4200);
check('乙1 进度面板自动恢复', (await page.getByText('执行进度').count()) > 0);
check('乙2 jobId 来自 lastJobId', (await page.getByText('job-mock-1').count()) > 0);
check('乙3 轮询真在跳（≥3 跳）', jobsCounter.value >= 3, `jobs 请求 ${jobsCounter.value} 次`);
check('乙4 phase 徽标照渲染', (await page.getByText('静态审查·执行中').count()) > 0 || (await page.getByText('静态审查·完成').count()) > 0);
await page.setViewportSize({ width: 320, height: 800 });
await page.waitForTimeout(400);
const overflow320 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('乙5 320px 无横向溢出', overflow320 <= 1, `溢出 ${overflow320}px`);
await page.setViewportSize({ width: 1440, height: 900 });

console.log('丙 · DONE 续跑（挂载直接出报告）');
await seedProject(PID);
await routes({ lastJobId: 'job-mock-1', job: JOB('DONE', { CLONING: 'done', SCANNING: 'done', ANALYZING: 'done', AGGREGATING: 'done' }) });
await page.goto(`${BASE}/qa`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1800);
check('丙1 边界卡直接渲染', (await page.getByText('边界').count()) > 0 || (await page.locator('button:has-text("问题（1）")').count()) > 0);
check('丙2 不出进度条', (await page.getByText('执行进度').count()) === 0);
check('丙3 历史快照区', (await page.getByText('本项目历史（1 份').count()) > 0);

console.log('丁 · 反着验：lastJobId 断开 → 什么都不恢复');
await seedProject(PID);
await routes({ lastJobId: null, job: JOB('RUNNING', { CLONING: 'running', SCANNING: 'pending', ANALYZING: 'pending', AGGREGATING: 'pending' }) });
await page.goto(`${BASE}/qa`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2600);
check('丁1 无进度条（没线索就没恢复）', (await page.getByText('执行进度').count()) === 0);
check('丁2 无报告', (await page.locator('button:has-text("问题（1）")').count()) === 0);
check('丁3 空态照说', (await page.getByText('还没跑过审查').count()) > 0);

console.log('戊 · FAILED 照实报');
await seedProject(PID);
await routes({ lastJobId: 'job-mock-1', job: JOB('FAILED', { CLONING: 'done', SCANNING: 'failed', ANALYZING: 'pending', AGGREGATING: 'pending' }, 'mock：扫描段炸了') });
await page.goto(`${BASE}/qa`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
check('戊1 失败照实亮红', (await page.getByText('审查失败：JOB_FAILED').count()) > 0);
check('戊2 失败原因可见', (await page.getByText('mock：扫描段炸了').count()) > 0);

console.log('己 · 后端离线 → 卡片照显 + 内容区离线话术 + 按钮禁用');
await seedProject(PID);
await routes({ lastJobId: null, job: JOB('RUNNING', {}), offlineDetail: true });
await page.goto(`${BASE}/qa`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2600);
check('己1 项目卡照本地记录显示', (await page.getByText('演示项目').count()) > 0);
check('己2 离线话术（连不上后端）', (await page.getByText('连不上后端').count()) > 0);
const btnDisabled = await page.locator('button:has-text("开始审查")').isDisabled();
check('己3 开始审查禁用', btnDisabled === true);

check('全局 零 pageerror', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await browser.close();
const pass = results.filter((r) => r.pass).length;
console.log(`\n结果：${pass}/${results.length} 通过`);
fs_write: {
  const fs = await import('node:fs');
  fs.writeFileSync(path.join(OUT, '_e2e-qa-workshop-result.json'), JSON.stringify({ pass, total: results.length, results, consoleErrors }, null, 2));
}
process.exit(pass === results.length ? 0 : 1);
