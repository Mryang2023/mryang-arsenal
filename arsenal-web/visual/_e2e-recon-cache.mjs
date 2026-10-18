/**
 * 一次性 E2E 探针（2026-10-17 超级夜 · 工坊棒3 侦察改造）—— 跑完即删，不进 git。
 *
 * 验 verify 链验不了的事（工坊棒3 P0 活体验收）：
 *   ① 没有当前项目 → 守卫空态 + 去项目管理入口；页面里没有地址输入框
 *   ② 有当前项目 → 挂载即从服务端读回 facts（route mock 证明）+ 体检 latest
 *   ③ 切走再回来 → 内容再次从服务端读回（facts 请求计数 ≥2，不是组件 state）
 *   ④ L1 内容级复用：留档指纹 === 缓存指纹 → 一键体检不发请求（POST 计数 0）+ 复用条
 *   ⑤ 反例：指纹不一致 → 界面说「缓存内容已变」，一键体检真发 POST（计数 1）
 *
 * 免后端姿势（java 本 harness 自退，照第1/3棒先例）：page.route 截拦 /api/projects/*。
 * 用法：node visual/_e2e-recon-cache.mjs（需 :3010 dev 活着）
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
const detail = (fingerprint) => ({
  success: true, code: 'OK', message: null,
  data: {
    id: PID, name: '演示项目', source: { kind: 'path', value: 'D:/demo/repo' },
    note: '', addedAt: '2026-10-18T09:00:00+08:00',
    cache: { files: 42, bytes: 90000, ingestedAt: '2026-10-18T09:00:04+08:00', fingerprint, lastRefresh: null, lastDiff: null },
    lastFactsAt: '2026-10-18T09:05:00+08:00', lastJobId: null,
  },
});
const env = (success, code, message, data) => ({ success, code, message, data });
// 最小合法体检报告：CheckupPanel 需要 scope/coverage/p0/p1/other/obs
const stampedReport = (fingerprint) => ({
  success: true, code: 'OK', message: null,
  data: {
    root: 'repo', elapsedMs: 5,
    scope: { files: 42, bytes: 90000, truncated: false, maxFiles: 20000 },
    coverage: { batches: 2, executed: 4, total: 4, decidable: true, tierPool: { p0: 2, p1: 1, other: 1 }, severityPool: { MUST: 2, NEVER: 1, SHOULD: 1, MAY: 0 }, skippedCount: 0, skipped: [], parseFailures: [] },
    p0: [], p1: [], other: [], obs: [],
    cacheFingerprint: fingerprint, checkedAt: '2026-10-18T09:06:00+08:00',
  },
});

const browser = await launchBrowser(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

let facts = JSON.parse(fs.readFileSync(ASSEMBLED, 'utf8'));
let factsHits = 0;
let checkupPosts = 0;

async function mock(fingerprint, latestFingerprint) {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  factsHits = 0; checkupPosts = 0;
  await page.route('**/api/projects/' + PID, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail(fingerprint)) }));
  await page.route('**/api/projects/' + PID + '/facts', (route) => {
    factsHits++;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(env(true, 'OK', null, facts)) });
  });
  await page.route('**/api/projects/' + PID + '/checkups/latest', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stampedReport(latestFingerprint)) }));
  await page.route('**/api/projects/' + PID + '/checkups', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(env(true, 'OK', null, [stampedReport(latestFingerprint).data])) }));
  await page.route('**/api/projects/' + PID + '/checkup', (route) => {
    if (route.request().method() === 'POST') {
      checkupPosts++;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stampedReport(fingerprint)) });
    } else route.fallback();
  });
}

async function overflow(p) {
  return p.evaluate(() => {
    const de = document.documentElement;
    return Math.max(0, de.scrollWidth - de.clientWidth);
  });
}

try {
  // ── 甲：没有当前项目 → 守卫空态 ──
  await page.goto(BASE + '/autopsy', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  check('甲1 守卫空态：「还没有当前项目」', await page.getByText('还没有当前项目').count() > 0);
  check('甲2 守卫空态：去项目管理入口', await page.getByText('去项目管理选项目').count() > 0);
  check('甲3 临时地址输入退场：页面没有 text input', await page.locator('input[type="text"], input[type="file"]').count() === 0);

  // ── 乙：有当前项目 + 指纹一致 → 挂载读回 + L1 复用 ──
  await mock('fp-cache-1', 'fp-cache-1');
  await page.evaluate((pid) => {
    localStorage.setItem('arsenal-active-project-v1', JSON.stringify({ id: pid, name: '演示项目' }));
  }, PID);
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  check('乙1 挂载即从服务端读回 facts（事实摘要出现）', await page.getByText('技术命中').count() > 0, `factsHits=${factsHits}`);
  check('乙2 项目卡显示当前项目名', await page.getByText('◈ 演示项目').count() > 0);

  // 切走再回来：内容再次从服务端读回
  const hitsBefore = factsHits;
  await page.goto(BASE + '/projects', { waitUntil: 'networkidle' });
  await page.goto(BASE + '/autopsy', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  check('乙4 切菜单再回来：facts 再次从服务端读回（不是组件 state）', factsHits >= hitsBefore + 1, `factsHits ${hitsBefore}→${factsHits}`);
  check('乙5 回来后内容还在（事实摘要）', await page.getByText('技术命中').count() > 0);

  // 切体检页签后：latest 留档说明 + L1 复用（指纹一致 → 一键体检不发 POST）
  await page.getByRole('button', { name: '体检报告' }).click();
  await page.waitForTimeout(300);
  check('乙3 体检 latest 从服务端读回（服务端留档说明出现）', await page.getByText('本报告来自服务端留档').count() > 0);
  const postsBefore = checkupPosts;
  await page.getByRole('button', { name: '一键体检' }).click();
  await page.waitForTimeout(800);
  check('乙6 L1 内容级复用：不发请求（POST 计数 0）', checkupPosts === postsBefore, `posts=${checkupPosts - postsBefore}`);
  check('乙7 复用条说出内容级依据（指纹一致）', await page.getByText('内容级校验通过').count() > 0);

  // ── 丙：指纹不一致 → 照实说「已变」，真扫 ──
  await mock('fp-cache-2', 'fp-cache-1');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: '体检报告' }).click();
  await page.waitForTimeout(300);
  check('丙1 指纹不一致：界面说「缓存内容已变」', await page.getByText('缓存内容已变').count() > 0);
  const postsBefore2 = checkupPosts;
  await page.getByRole('button', { name: '一键体检' }).click();
  await page.waitForTimeout(1000);
  check('丙2 指纹不一致：一键体检真发 POST（计数 1）', checkupPosts === postsBefore2 + 1, `posts=${checkupPosts - postsBefore2}`);

  const ov = await overflow(page);
  check('丁 1440 视口零横向溢出', ov === 0, `overflowPx=${ov}`);

  // 320 视口
  const page2 = await browser.newPage({ viewport: { width: 320, height: 800 } });
  page2.on('pageerror', (e) => consoleErrors.push(`pageerror320: ${e.message}`));
  await page2.goto(BASE + '/autopsy', { waitUntil: 'networkidle' });
  await page2.waitForTimeout(1000);
  const ov2 = await overflow(page2);
  check('戊 320 视口零横向溢出', ov2 === 0, `overflowPx=${ov2}`);
  await page2.close();

  check('己 零 pageerror', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
}
const passed = results.filter((r) => r.pass).length;
console.log(`\nRESULT: ${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
