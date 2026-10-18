/**
 * 一次性 E2E 探针（2026-10-17 结构面板棒3）—— 跑完即删，不进 git。
 *
 * 验 verify 链验不了的事：第三子页签「项目结构」真在解剖台里出树、
 * 卡片头数字与 facts 同源不等就红、徽标带依据、0 类措辞在、320px 不溢出。
 *
 * 数字口径：页面显示 vs 同一路径直接打 /api/scan/facts 的 facts JSON（同源对比，
 * 不抄计划书示例值）。用法：
 *   node visual/_e2e-structure.mjs demo     # demo-repo fixture（1440 + 320 双档）
 *   node visual/_e2e-structure.mjs nocjava  # 扫 docs/（0 Java 类措辞）
 *   node visual/_e2e-structure.mjs self     # 军火库自身真扫
 * 需 :3010 dev 与 :3011 后端活着（java 常驻不了，调用方负责窗口内拉起）。
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './browser.mjs';

const BASE = process.env.E2E_BASE || 'http://localhost:3010';
const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '.workbuddy',
  'night-chain',
  '2026-10-17'
);
const which = process.argv[2] || 'demo';
const FIXTURES = {
  demo: {
    path: 'D:/workspace/2026/mryang-arsenal/arsenal-web/.verify/fixtures/demo-repo',
    assembled: 'D:/workspace/2026/mryang-arsenal/.workbuddy/night-chain/2026-10-17/_e2e-demo-facts.json',
  },
  self: {
    path: 'D:/workspace/2026/mryang-arsenal',
    assembled: 'D:/workspace/2026/mryang-arsenal/.workbuddy/night-chain/2026-10-17/_e2e-self-facts.json',
  },
};
const target = FIXTURES[which];
if (!target) {
  console.error(`未知目标 ${which}（本版内置 demo / self —— java 自退，真扫走不通；nocjava 0 类措辞见 scan-check 1c-8 与备注）`);
  process.exit(2);
}
const FIXTURE = target.path;

const results = [];
const consoleErrors = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
  console.log(`  ${cond ? '✓' : '✗'} ${name}${detail ? ` —— ${detail}` : ''}`);
}

/** facts 来源：后端活着就打真的；java 自退时用组装器产物（判据逐行复刻 classify）。两条路都记来源。 */
async function loadFacts(scanPath) {
  try {
    const res = await fetch('http://127.0.0.1:3011/api/scan/facts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: scanPath }),
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return { facts: await res.json(), source: 'live-backend' };
  } catch {
    /* 落到组装 facts —— 原因写进结果，不猜 */
  }
  return {
    facts: JSON.parse(fs.readFileSync(target.assembled, 'utf8')),
    source: 'assembled（java 本 harness 自退，判据复刻自 CodeScanner.classify）',
  };
}

async function scanFixture(page) {
  const input = page.locator('input[placeholder*="arsenal-server"]');
  await input.waitFor({ state: 'visible', timeout: 30000 });
  for (let i = 0; i < 6; i++) {
    await input.fill(FIXTURE);
    const enabled = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) =>
        x.textContent?.includes('一键分析')
      );
      return !!b && !b.disabled;
    });
    if (enabled) break;
    await page.waitForTimeout(500);
  }
  await page.click('button:has-text("一键分析")');
  await page.waitForSelector('text=三、架构面板', { timeout: 150000 });
}

/** 页面级横向溢出（与 shoot.mjs 同口径：documentElement.scrollWidth - clientWidth） */
async function overflow(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const out = [];
    document.querySelectorAll('*').forEach((el) => {
      if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
        const r = el.getBoundingClientRect();
        out.push(`${el.tagName}.${(el.className || '').toString().slice(0, 40)} +${el.scrollWidth - el.clientWidth}px`);
      }
    });
    return {
      pageOverflowPx: Math.max(0, de.scrollWidth - de.clientWidth),
      elements: out.slice(0, 5),
      elementCount: out.length,
    };
  });
}

const browser = await launchBrowser(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
});

let facts = null;
let factsSource = '';
try {
  const loaded = await loadFacts(FIXTURE);
  facts = loaded.facts;
  factsSource = loaded.source;
  // 扫描接口一律走路由截拦喂同一份 facts —— 页面按钮点的「一键分析」与基准同源。
  // 信封形状：ApiEnvelope<T> = { success, code, message, data }（arsenal-api.ts:90）
  await page.route('**/api/scan/facts', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, code: 'OK', message: null, data: facts }),
    })
  );
  const expDirs = facts.code?.dirs?.length ?? 0;
  const expClasses = facts.code?.classes?.length ?? 0;
  const expUnclassified = (facts.code?.classes ?? []).filter((c) => !c.layer).length;
  console.log(`\n[facts 基准 · ${factsSource}] dirs=${expDirs} classes=${expClasses} unclassified=${expUnclassified} truncated=${!!facts.stats?.truncated}`);

  await page.goto(`${BASE}/autopsy/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => window.localStorage.clear());
  await scanFixture(page);

  // ── 子页签：三个都在，默认仍是技术架构 ──
  check('子页签：技术架构 + 应用分层 + 项目结构三个按钮都在',
    (await page.locator('button:has-text("技术架构")').count()) > 0 &&
    (await page.locator('button:has-text("应用分层")').count()) > 0 &&
    (await page.locator('button:has-text("项目结构")').count()) > 0);
  const activeSub = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === '技术架构');
    return b ? b.className.includes('text-brass') : false;
  });
  check('默认子页签仍是技术架构（canvas）', activeSub);

  // ── 切到项目结构 ──
  await page.click('button:has-text("项目结构")');
  await page.waitForSelector('text=一、这个项目的代码是怎么摆的', { timeout: 15000 });

  // 卡片头数字 vs facts 同源基准
  const headerText = await page.locator('text=/\\d+ 目录 \\/ \\d+ 类/').first().innerText();
  const hm = headerText.match(/(\d+) 目录 \/ (\d+) 类/);
  check('卡片头目录数与 facts 同源相等', hm && Number(hm[1]) === expDirs, `页面=${headerText} 基准=${expDirs}`);
  check('卡片头类数与 facts 同源相等', hm && Number(hm[2]) === expClasses, `页面=${headerText} 基准=${expClasses}`);
  const headAll = await page.evaluate(() => {
    const p = [...document.querySelectorAll('p')].find((x) => x.textContent?.includes('一、这个项目的代码是怎么摆的'));
    return p ? p.closest('.panel').innerText : '';
  });
  check('卡片头未分类数与 facts 同源相等',
    headAll.includes(`判不出角色的 ${expUnclassified} 个`), `期望含「判不出角色的 ${expUnclassified} 个」`);
  check('措辞不歧义：「类」字跟在未分类数后（不与文件数混）',
    headAll.includes(`Java 类判不出角色的 ${expUnclassified} 个`), headAll.split('\n').slice(-1)[0]);

  // 层级释义七行
  const layerRows = await page.evaluate(() => {
    const ps = [...document.querySelectorAll('p')].find((p) => p.textContent?.includes('层级释义'));
    if (!ps) return null;
    const panel = ps.closest('.panel');
    return [...panel.querySelectorAll('li')].map((li) => li.innerText.split('\n')[0]);
  });
  check('层级释义七行（五带 + 工具 + 未分类）', layerRows && layerRows.length === 7, `${layerRows?.length ?? 0} 行`);
  const bandNames = ['客户端', '接入层', '应用层', '领域层', '数据层'];
  const namesOk = bandNames.every((n) => (layerRows ?? []).some((r) => r.startsWith(n)));
  check('五带名逐字等于 BAND_NAME（客户端/接入层/应用层/领域层/数据层）', namesOk, JSON.stringify(layerRows));
  check('七行都带个数（0 也照实报）', (layerRows ?? []).every((r) => /· \d+ 个类/.test(r)));

  // 树默认态：根 + 顶层目录可见
  const treeExists = await page.locator('text=三、目录树').count();
  check('树区在（默认展开两层）', treeExists > 0);

  // 全展开 → 类行数与 facts 逐条相等
  await page.click('button:has-text("全展开")');
  await page.waitForTimeout(400);
  const classRows = await page.evaluate(() =>
    [...document.querySelectorAll('span[title^="判定依据："]')].map((el) => el.innerText)
  );
  check('全展开后类行数 === facts classes 数（一条不丢）', classRows.length === expClasses,
    `页面=${classRows.length} 基准=${expClasses}`);
  const badgesOk = classRows.every((t) => /（据注解|据类名|据包名|无依据）/.test(t));
  check('每个徽标都带判定依据（annotation/name/package/无依据）', badgesOk,
    badgesOk ? '' : classRows.filter((t) => !/（据/.test(t)).slice(0, 3).join(' | '));

  // 中间目录报 total 不报 0
  const srcMain = await page.evaluate(() => {
    const spans = [...document.querySelectorAll('span')].filter((s) => s.innerText === 'java/');
    return spans.length > 0;
  });
  check('约定目录节点在树里（src/main/java 形状）', srcMain);

  // 截断亮条（按事实说话，不硬摘）
  const hasBanner = (await page.locator('text=扫描被闸门截断').count()) > 0;
  check(`截断亮条与 facts.truncated 一致（${!!facts.stats?.truncated}）`, hasBanner === !!facts.stats?.truncated);

  // 0 Java 类措辞（按事实说话）
  const noClassNote = (await page.locator('text=未扫到 Java 类').count()) > 0;
  check(`「未扫到 Java 类」措辞与 classes=0 一致（${expClasses}）`, noClassNote === (expClasses === 0));

  await page.screenshot({ path: path.join(OUT, `_e2e-struct-${which}-1440.png`), fullPage: false });

  // ── 320px 档 ──
  await page.setViewportSize({ width: 320, height: 800 });
  await page.locator('text=一、这个项目的代码是怎么摆的').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const ovf = await overflow(page);
  check('320px 无横向溢出（页面级）', ovf.pageOverflowPx === 0, `溢出 ${ovf.pageOverflowPx}px`);
  if (ovf.elementCount > 0) console.log(`    越界元素 ${ovf.elementCount} 个（最深 5）：${ovf.elements.join(' ; ')}`);
  await page.screenshot({ path: path.join(OUT, `_e2e-struct-${which}-320.png`), fullPage: false });

  // 收起到只剩卡片头，320 再测一次（最小形态也不溢出）
  await page.click('button:has-text("收起")');
  await page.waitForTimeout(300);
  const ovf2 = await overflow(page);
  check('320px 收起态无横向溢出', ovf2.pageOverflowPx === 0, `溢出 ${ovf2.pageOverflowPx}px`);
} catch (err) {
  check('E2E 执行异常', false, String(err).slice(0, 400));
} finally {
  await browser.close();
}

check('无未捕获页面异常', consoleErrors.filter((e) => e.startsWith('pageerror')).length === 0,
  consoleErrors.filter((e) => e.startsWith('pageerror')).slice(0, 2).join(' | '));
const failed = results.filter((r) => !r.pass);
console.log(`\nE2E[${which}] 结果：${results.length - failed.length}/${results.length} 过`);
if (consoleErrors.length) {
  const noise = consoleErrors.filter((e) => !e.startsWith('pageerror'));
  console.log(`console.error ${consoleErrors.length} 条（dev 模式噪音不计失败）：${noise.slice(0, 3).join(' | ').slice(0, 300)}`);
}
fs.writeFileSync(path.join(OUT, `_e2e-struct-${which}.json`), JSON.stringify({ which, results, consoleErrors }, null, 2));
process.exit(failed.length ? 1 : 0);
