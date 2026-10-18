/**
 * 一次性 E2E 探针（2026-10-17 超级夜 · 工坊棒5 收尾）—— 跑完即删，不进 git。
 *
 * 工坊五棒端到端总验收（免后端 route mock，判据与页面文案逐字对齐）：
 *   甲 /projects 空注册表 → 空态引导
 *   乙 列表出现项目 → 行内「打开侦察」= 设当前项目 + 跳 /autopsy → facts 从服务端读回
 *   丙 侦察 → 切 QA：项目卡在、无续跑线索照说空态
 *   丁 QA → 切回侦察：facts 再次从服务端读回（计数递增，不是组件 state），内容仍在
 *   戊 切回 /projects：当前项目横幅在
 *   己 反着验：清掉当前项目 → /qa 守卫空态接管
 *   庚 1440/320 零横向溢出 + 零 pageerror
 *
 * 用法：node visual/_e2e-workshop-chain.mjs（需 dev 活着，E2E_BASE 覆盖端口）
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './browser.mjs';

const BASE = process.env.E2E_BASE || 'http://localhost:3010';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.workbuddy', 'night-chain', '2026-10-17');
const ASSEMBLED = path.join(OUT, '_e2e-demo-facts.json');

const results = [];
const consoleErrors = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
  console.log(`  ${cond ? '✓' : '✗'} ${name}${detail ? ` —— ${detail}` : ''}`);
}

const PID = 'a1b2c3d4e5f6';
const detail = () => ({
  success: true, code: 'OK', message: null,
  data: {
    id: PID, name: '演示项目', source: { kind: 'path', value: 'D:/demo/repo' },
    note: '', addedAt: '2026-10-18T09:00:00+08:00',
    cache: { files: 42, bytes: 90000, ingestedAt: '2026-10-18T09:00:04+08:00', fingerprint: 'dir:42:90000', lastRefresh: null, lastDiff: null },
    lastFactsAt: '2026-10-18T09:05:00+08:00', lastJobId: null,
  },
});
const entry = () => detail().data;
const env = (data) => ({ success: true, code: 'OK', message: null, data });
const stampedReport = () => ({
  success: true, code: 'OK', message: null,
  data: {
    root: 'repo', elapsedMs: 5,
    scope: { files: 42, bytes: 90000, truncated: false, maxFiles: 20000 },
    coverage: { batches: 2, executed: 4, total: 4, decidable: true, tierPool: { p0: 2, p1: 1, other: 1 }, severityPool: { MUST: 2, NEVER: 1, SHOULD: 1, MAY: 0 }, skippedCount: 0, skipped: [], parseFailures: [] },
    p0: [], p1: [], other: [], obs: [],
    cacheFingerprint: 'dir:42:90000', checkedAt: '2026-10-18T09:06:00+08:00',
  },
});
const SNAPSHOTS = {
  success: true, code: 'OK', message: null,
  data: [{ jobId: 'job-old-1', scannedAt: '2026-10-18T09:30:00Z', mode: 'full', files: 12, filesMatched: 12, p0: 0, p1: 0, truncated: false }],
};

const browser = await launchBrowser(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

const facts = JSON.parse(fs.readFileSync(ASSEMBLED, 'utf8'));
let factsHits = 0;
let listHasProject = false;

async function routes() {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  factsHits = 0;
  await page.route((u) => u.pathname === '/api/projects', (r) => {
    if (r.request().method() === 'GET') {
      r.fulfill({ json: env(listHasProject ? [entry()] : []) });
    } else r.fulfill({ json: env(null) });
  });
  await page.route((u) => u.pathname === '/api/projects/' + PID, (r) => r.fulfill({ json: detail() }));
  await page.route((u) => u.pathname === '/api/projects/' + PID + '/facts', (r) => {
    factsHits++;
    r.fulfill({ json: env(facts) });
  });
  await page.route((u) => u.pathname === '/api/projects/' + PID + '/checkups/latest', (r) => r.fulfill({ json: stampedReport() }));
  await page.route((u) => u.pathname === '/api/projects/' + PID + '/checkups', (r) => r.fulfill({ json: env([stampedReport().data]) }));
  await page.route('**/api/qa/llm-status**', (r) => r.fulfill({ json: { success: true, code: 'OK', message: null, data: { configured: false, model: null } } }));
  await page.route('**/api/qa/snapshots**', (r) => r.fulfill({ json: SNAPSHOTS }));
}

async function overflow(p) {
  return p.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
}

try {
  // ── 甲：/projects 空注册表 → 空态引导 ──
  listHasProject = false;
  await routes();
  await page.goto(BASE + '/projects', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  check('甲1 空注册表空态引导', (await page.getByText('还没有项目。先在上面的表单添加第一个项目。').count()) > 0);
  check('甲2 当前项目未选话术', (await page.getByText('尚未选择当前项目').count()) > 0);

  // ── 乙：列表出现项目 → 行内「打开侦察」→ /autopsy 服务端读回 ──
  listHasProject = true;
  await routes();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  check('乙1 项目列表出现演示项目', (await page.getByText('演示项目').count()) > 0);
  await page.getByRole('button', { name: '打开侦察' }).first().click();
  await page.waitForTimeout(2500);
  check('乙2 点击后跳到 /autopsy', page.url().includes('/autopsy'), page.url());
  const active = await page.evaluate(() => localStorage.getItem('arsenal-active-project-v1'));
  check('乙3 当前项目已写 localStorage 总线', !!active && JSON.parse(active).id === PID, String(active));
  check('乙4 挂载即从服务端读回 facts（技术命中）', (await page.getByText('技术命中').count()) > 0, `factsHits=${factsHits}`);
  check('乙5 facts 请求计数 ≥1（真读服务端）', factsHits >= 1, `factsHits=${factsHits}`);
  check('乙6 项目卡显示当前项目', (await page.getByText('演示项目').count()) > 0);

  // ── 丙：侦察 → 切 QA ──
  await page.goto(BASE + '/qa', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  check('丙1 QA 页项目卡在（同一个当前项目）', (await page.getByText('演示项目').count()) > 0);
  check('丙2 无续跑线索 → 照说空态', (await page.getByText('还没跑过审查').count()) > 0);

  // ── 丁：QA → 切回侦察：内容再次从服务端读回，内容仍在 ──
  const hitsBefore = factsHits;
  await page.goto(BASE + '/autopsy', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  check('丁1 切回后 facts 再次从服务端读回（计数递增）', factsHits >= hitsBefore + 1, `factsHits ${hitsBefore}→${factsHits}`);
  check('丁2 切回后内容仍在（技术命中）', (await page.getByText('技术命中').count()) > 0);
  check('丁3 项目卡仍在', (await page.getByText('演示项目').count()) > 0);

  // ── 戊：切回 /projects：当前项目横幅在 ──
  await page.goto(BASE + '/projects', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  check('戊1 当前项目横幅标题在', (await page.getByText('当前项目').count()) > 0);
  check('戊2 横幅显示演示项目', (await page.locator('section, div').filter({ hasText: '当前项目' }).getByText('演示项目').count()) > 0);

  // ── 己：反着验 —— 清掉当前项目 → /qa 守卫空态接管 ──
  await page.evaluate(() => localStorage.removeItem('arsenal-active-project-v1'));
  await page.goto(BASE + '/qa', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  check('己1 无当前项目 → 守卫空态', (await page.getByText('这两个功能依托于固定项目').count()) > 0);
  check('己2 去项目管理入口在', (await page.locator('a[href^="/projects"]').count()) > 0);

  // ── 庚：视口与 pageerror ──
  const ov = await overflow(page);
  check('庚1 1440 零横向溢出', ov === 0, `overflowPx=${ov}`);
  const page2 = await browser.newPage({ viewport: { width: 320, height: 800 } });
  page2.on('pageerror', (e) => consoleErrors.push(`pageerror320: ${e.message}`));
  await routes.call(null);
  // page2 需要自己的 route（route 挂在 page 上）——直接挂同一组
  await page2.route((u) => u.pathname === '/api/projects', (r) => r.fulfill({ json: env([entry()]) }));
  await page2.route((u) => u.pathname === '/api/projects/' + PID, (r) => r.fulfill({ json: detail() }));
  await page2.route((u) => u.pathname === '/api/projects/' + PID + '/facts', (r) => r.fulfill({ json: env(facts) }));
  await page2.route('**/api/qa/llm-status**', (r) => r.fulfill({ json: { success: true, code: 'OK', message: null, data: { configured: false, model: null } } }));
  await page2.route('**/api/qa/snapshots**', (r) => r.fulfill({ json: SNAPSHOTS }));
  await page2.goto(BASE + '/autopsy', { waitUntil: 'domcontentloaded' });
  await page2.waitForTimeout(2000);
  const ov2 = await overflow(page2);
  check('庚2 320 零横向溢出', ov2 <= 1, `overflowPx=${ov2}`);
  await page2.close();

  check('辛 零 pageerror', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}
const passed = results.filter((r) => r.pass).length;
console.log(`\nRESULT: ${passed}/${results.length} passed`);
fs.writeFileSync(path.join(OUT, '_e2e-workshop-chain-result.json'), JSON.stringify({ pass: passed, total: results.length, results, consoleErrors }, null, 2));
process.exit(passed === results.length ? 0 : 1);
