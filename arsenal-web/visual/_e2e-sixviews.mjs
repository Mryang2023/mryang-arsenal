/**
 * 一次性 E2E 探针（2026-10-17 超级夜 · 图谱棒2 六视图进台）—— 跑完即删，不进 git。
 *
 * 验 verify 链（静态/单测）验不了的事：六视图子页签真在解剖台里出图、
 * 档案条三种档案（内置/草稿/导入）切换、成熟度数字与待补清单自洽、
 * 形状坏的档案按下导入那一刻被拒、切子页签档案选择不丢、320px 不溢出。
 *
 * 免后端姿势（java 本 harness 自退，照第1棒先例）：page.route 截拦
 * /api/scan/facts 喂 assembled facts（判据复刻自 CodeScanner.classify）。
 *
 * 用法：node visual/_e2e-sixviews.mjs
 * 需 :3010 dev 活着（next-run.mjs dev -p 3010）。
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchBrowser } from './browser.mjs';

const BASE = process.env.E2E_BASE || 'http://localhost:3010';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.workbuddy', 'night-chain', '2026-10-17');
const ASSEMBLED = path.join(OUT, '_e2e-demo-facts.json');
const FIXTURE = 'D:/workspace/2026/mryang-arsenal/arsenal-web/.verify/fixtures/demo-repo';

const results = [];
const consoleErrors = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
  console.log(`  ${cond ? '✓' : '✗'} ${name}${detail ? ` —— ${detail}` : ''}`);
}

/** 合法档案：照内置 arsenal.json 改 id / name（其余形状原样，过 validateImport 两关） */
const BUILTIN_PROFILE = 'D:/workspace/2026/mryang-arsenal/arsenal-profiles/arsenal.json';

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
    return { pageOverflowPx: Math.max(0, de.scrollWidth - de.clientWidth), elements: out.slice(0, 5), elementCount: out.length };
  });
}

const browser = await launchBrowser(chromium);
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
});

let facts = null;
try {
  facts = JSON.parse(fs.readFileSync(ASSEMBLED, 'utf8'));
  await page.route('**/api/scan/facts', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, code: 'OK', message: null, data: facts }),
    })
  );

  await page.goto(`${BASE}/autopsy/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => window.localStorage.clear());
  await page.waitForSelector('text=三、架构面板', { timeout: 60000 });

  // ── 甲、没扫描：架构面板 + 档案条 + 四子页签都在，默认仍是技术架构 ──
  check('没扫描：架构面板在（不再要求扫描完成才渲染）', (await page.locator('text=三、架构面板').count()) > 0);
  check('没扫描：档案条在', (await page.locator('text=换档案 = 换一套六视图').count()) > 0);
  check('没扫描：内置档案 chip 在（▣ 杨先生的军火库）',
    (await page.locator('button:has-text("杨先生的军火库")').count()) > 0);
  check('没扫描：提示「还没扫描」，六视图讲内置档案',
    (await page.locator('text=还没扫描').count()) > 0);
  check('没扫描：草稿 chip 不出现（✦ 只在扫描后）',
    (await page.locator('button:has-text("本次扫描草稿")').count()) === 0);
  const subs = ['技术架构', '应用分层', '项目结构', '六视图'];
  const subCounts = [];
  for (const s of subs) subCounts.push(await page.locator(`button:has-text("${s}")`).count());
  check('子页签四项都在（技术架构/应用分层/项目结构/六视图）',
    subCounts.every((c) => c > 0), JSON.stringify(subCounts));
  const activeSub = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === '技术架构');
    return b ? b.className.includes('text-brass') : false;
  });
  check('默认子页签仍是技术架构（canvas）', activeSub);
  check('没扫描：canvas 子页签给引导文案（不对着空白猜）',
    (await page.locator('text=这个子页签要读扫描事实').count()) > 0);

  // ── 乙、没扫描切六视图：讲内置档案，离线可看 ──
  await page.click('button:has-text("六视图")');
  await page.waitForSelector('text=业务架构', { timeout: 15000 });
  const builtinBadge = await page.evaluate(() => {
    const h2 = [...document.querySelectorAll('h2')].find((x) => x.textContent?.includes('业务架构'));
    return h2 ? h2.innerText : '';
  });
  check('没扫描：六视图讲内置档案（头卡徽章=杨先生的军火库）',
    builtinBadge.includes('杨先生的军火库'), builtinBadge.split('\n')[0]);
  const viewTabs = ['业务架构', '数据架构', '应用架构', '产品架构', '项目架构'];
  const vtCounts = [];
  for (const s of viewTabs) vtCounts.push(await page.locator(`button:has-text("${s}")`).count());
  check('五张静态图 tab 都在（tech 不重复 —— 画布在技术架构子页签）',
    vtCounts.every((c) => c > 0), JSON.stringify(vtCounts));
  check('技术架构图去向说明在（「不在这五张里」）',
    (await page.locator('text=技术架构图不在这五张里').count()) > 0);
  check('非草稿模式：成熟度条不显示（内置档案是完整的）',
    (await page.locator('text=条来自扫描').count()) === 0);
  check('视图主体出图（业务视图 SVG/卡片区在）',
    (await page.locator('text=核心关注').count()) > 0);

  // ── 丙、切到数据视图再切回（切视图不丢档案） ──
  await page.click('button:has-text("数据架构")');
  await page.waitForTimeout(600);
  const dataBadge = await page.evaluate(() => {
    const h2 = [...document.querySelectorAll('h2')].find((x) => x.textContent?.includes('数据架构'));
    return h2 ? h2.innerText : '';
  });
  check('切视图：头卡跟着切（数据架构 + 内置档案徽章仍在）',
    dataBadge.includes('数据架构') && dataBadge.includes('杨先生的军火库'));

  // ── 丁、有扫描：草稿 chip 出现 + 成熟度条 + 待补清单 ──
  const addr = page.locator('input[placeholder*="arsenal-server"]');
  await addr.fill(FIXTURE);
  await page.click('button:has-text("一键分析")');
  await page.waitForSelector('button:has-text("本次扫描草稿")', { timeout: 60000 });
  check('有扫描：草稿 chip 出现（✦ 本次扫描草稿）',
    (await page.locator('button:has-text("本次扫描草稿")').count()) > 0);
  // 没手动选过 → 默认落草稿（effective = draft）
  const draftBadge = await page.evaluate(() => {
    const h2 = [...document.querySelectorAll('h2')].find((x) => x.textContent?.includes('数据架构'));
    return h2 ? h2.innerText : '';
  });
  check('有扫描且没手动选过：六视图默认讲草稿', draftBadge.includes('扫描草稿'), draftBadge.split('\n')[0]);

  const maturity = await page.evaluate(() => {
    const el = [...document.querySelectorAll('span')].find((x) => x.textContent?.includes('条来自扫描'));
    return el ? el.innerText.replace(/\s+/g, ' ') : '';
  });
  const mm = maturity.match(/(\d+) 条来自扫描 · (\d+) 条待你补/);
  check('成熟度条措辞：「N 条来自扫描 · M 条待你补」', !!mm, maturity);
  const filledN = mm ? Number(mm[1]) : -1;
  const todoM = mm ? Number(mm[2]) : -1;
  check('成熟度：扫描填进去的真数据 > 0（不空也不假）', filledN > 0, `filled=${filledN}`);
  check('成熟度：待补条数 > 0（业务视图大片 TODO 是事实）', todoM > 0, `todos=${todoM}`);
  check('草稿不当成品卖：声明句在（「不是成品档案」）',
    (await page.locator('text=这是扫描草稿，不是成品档案').count()) > 0);
  check('草稿形状过：issues 报错不出现（半张图不渲染）',
    (await page.locator('text=形状校验未过').count()) === 0);

  await page.click('button:has-text("展开")');
  await page.waitForTimeout(400);
  const todoRows = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((x) => x.textContent?.includes('待补清单'));
    if (!btn) return [];
    const box = btn.closest('div').parentElement;
    return [...box.querySelectorAll('li')].map((li) => li.innerText);
  });
  check('待补清单可展开：条数 = 成熟度条的 M', todoRows.length === todoM,
    `清单=${todoRows.length} 条 M=${todoM}`);
  check('每条待补带档案内位置（views.business.outlets[0] 这种）',
    todoRows.length > 0 && todoRows.every((t) => /views\.[\w.[\]]+：|^[a-zA-Z][\w.[\]]*：/.test(t.trim().replace(/^·\s*/, ''))),
    todoRows[0]?.slice(0, 60));
  check('TODO 前缀原文上图（不搞第二套标记）',
    (await page.locator('text=/TODO/').count()) > 0);

  // ── 戊、切档案：内置 ←→ 草稿 ──
  await page.click('button:has-text("杨先生的军火库")');
  await page.waitForTimeout(700);
  const backBuiltin = await page.evaluate(() => {
    const h2 = [...document.querySelectorAll('h2')].find((x) => x.textContent?.includes('数据架构'));
    return h2 ? h2.innerText : '';
  });
  check('切到内置档案：六视图切过去（徽章回杨先生的军火库）',
    backBuiltin.includes('杨先生的军火库'), backBuiltin.split('\n')[0]);
  check('切到内置档案：成熟度条消失（没有「待补」概念）',
    (await page.locator('text=条来自扫描').count()) === 0);

  // ── 己、切子页签不丢档案选择 ──
  // 注意：六视图面板内部的「视图 tab」随面板卸载回默认（业务架构）—— 这是已知行为
  // （P2，提升它要付 AutopsyLab 更胖的代价）；这里验的是任务书点名项：档案选择不丢。
  await page.click('button:has-text("技术架构")');
  await page.waitForTimeout(400);
  await page.click('button:has-text("六视图")');
  await page.waitForTimeout(700);
  const afterRound = await page.evaluate(() => {
    const h2 = [...document.querySelectorAll('h2')].find((x) => x.textContent?.includes('业务架构'));
    return h2 ? h2.innerText : '';
  });
  check('切子页签（画布→六视图）档案选择不丢', afterRound.includes('杨先生的军火库'), afterRound.split('\n')[0]);

  // ── 庚、导入形状坏的档案：那一刻就被拒，不白屏 ──
  await page.click('button:has-text("+ 导入 JSON")');
  await page.waitForTimeout(300);
  await page.locator('textarea').first().fill('{"foo": 1}');
  await page.click('button:has-text("导入粘贴的档案")');
  await page.waitForTimeout(400);
  check('形状坏的档案：✗ issues 当场亮（缺 views 段）',
    (await page.locator('text=缺少 views 段').count()) > 0);
  const stillBuiltin = await page.evaluate(() => {
    const h2 = [...document.querySelectorAll('h2')].find((x) => x.textContent?.includes('业务架构'));
    return h2 ? h2.innerText : '';
  });
  check('形状坏的档案：不切换不白屏（徽章未变）', stillBuiltin.includes('杨先生的军火库'));

  // 解不开的 token 也被拒（第二关）。注意 token 名只能用 [A-Za-z0-9.] ——
  // 带连字符的假 token 不匹配 TOKEN_RE（既有语法设计），选了它验不到这一关。
  const badToken = JSON.parse(fs.readFileSync(BUILTIN_PROFILE, 'utf8'));
  badToken.id = 'bad-token-case';
  badToken.views.business.definition = '规则一共 {{rules.nope}} 条';
  await page.locator('textarea').first().fill(JSON.stringify(badToken));
  await page.click('button:has-text("导入粘贴的档案")');
  await page.waitForTimeout(400);
  check('token 解不开的档案：第二关也拒（解不开的 token）',
    (await page.locator('text=解不开的 token').count()) > 0);

  // ── 辛、导入合法档案：六视图切过去 ──
  const goodDoc = JSON.parse(fs.readFileSync(BUILTIN_PROFILE, 'utf8'));
  goodDoc.id = 'e2e-imported-demo';
  goodDoc.name = 'E2E 导入档案（台架）';
  goodDoc.subtitle = '一次性 E2E 导入样本';
  await page.locator('textarea').first().fill(JSON.stringify(goodDoc));
  await page.click('button:has-text("导入粘贴的档案")');
  await page.waitForTimeout(800);
  const importedBadge = await page.evaluate(() => {
    const h2 = [...document.querySelectorAll('h2')].find((x) => x.textContent?.includes('业务架构'));
    return h2 ? h2.innerText : '';
  });
  check('合法档案导入：六视图切过去（徽章=E2E 导入档案）',
    importedBadge.includes('E2E 导入档案'), importedBadge.split('\n')[0]);
  check('合法档案导入：⇪ chip 出现在档案条',
    (await page.locator('button:has-text("E2E 导入档案（台架）")').count()) > 0);

  // 导入档案 reload 后还在（localStorage 留档）。拆两问：① 写没写进 localStorage；
  // ② 芯片渲不渲染（初始空 + effect 加载有帧间延迟，查得太早会假红）。
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('text=三、架构面板', { timeout: 60000 });
  const stored = await page.evaluate(() => {
    const raw = window.localStorage.getItem('arsenal-arch-profiles-v1');
    return raw ? Object.keys(JSON.parse(raw)) : [];
  });
  check('导入档案 reload 后写进了 localStorage', stored.includes('e2e-imported-demo'), JSON.stringify(stored));
  await page.waitForTimeout(1500);
  check('导入档案 reload 后仍在档案条（本机浏览器留档）',
    (await page.locator('button:has-text("E2E 导入档案（台架）")').count()) > 0);

  // ── 壬、重新扫描不抢走手动选过的档案（Code Review 正确性疑点） ──
  await page.click('button:has-text("一键分析")');
  await page.waitForTimeout(2500); // route 还拦着，二次扫描同源 facts
  const afterRescan = await page.evaluate(() => {
    const h2 = [...document.querySelectorAll('h2')].find((x) => x.textContent?.includes('业务架构'));
    return h2 ? h2.innerText : '';
  });
  check('重新扫描：手动选过的档案不被抢走（仍是 E2E 导入档案）',
    afterRescan.includes('E2E 导入档案'), afterRescan.split('\n')[0]);
  check('重新扫描：成熟度条仍不显示（非草稿模式不因重扫亮出来）',
    (await page.locator('text=条来自扫描').count()) === 0);

  await page.screenshot({ path: path.join(OUT, '_e2e-six-1440.png'), fullPage: false });

  // ── 320px 档：六视图态 + 导入区展开 ──
  await page.click('button:has-text("六视图")');
  await page.waitForTimeout(800);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(500);
  const ovf = await overflow(page);
  check('320px 六视图态无横向溢出（页面级）', ovf.pageOverflowPx === 0, `溢出 ${ovf.pageOverflowPx}px`);
  if (ovf.elementCount > 0) console.log(`    越界元素 ${ovf.elementCount} 个（最深 5）：${ovf.elements.join(' ; ')}`);
  await page.screenshot({ path: path.join(OUT, '_e2e-six-320.png'), fullPage: false });

  await page.click('button:has-text("+ 导入 JSON")');
  await page.waitForTimeout(400);
  const ovf2 = await overflow(page);
  check('320px 导入区展开无横向溢出', ovf2.pageOverflowPx === 0, `溢出 ${ovf2.pageOverflowPx}px`);
} catch (err) {
  check('E2E 执行异常', false, String(err).slice(0, 500));
} finally {
  await browser.close();
}

check('无未捕获页面异常', consoleErrors.filter((e) => e.startsWith('pageerror')).length === 0,
  consoleErrors.filter((e) => e.startsWith('pageerror')).slice(0, 2).join(' | '));
const failed = results.filter((r) => !r.pass);
console.log(`\nE2E[sixviews] 结果：${results.length - failed.length}/${results.length} 过`);
if (failed.length > 0) {
  console.log('失败项：');
  failed.forEach((f) => console.log(`  ✗ ${f.name}${f.detail ? ` —— ${f.detail}` : ''}`));
  process.exit(1);
}
