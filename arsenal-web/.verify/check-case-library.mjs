/**
 * 案例库改名与新增字段的视觉自检。
 *
 * 为什么要真跑浏览器而不是只看构建产物的字符串：
 * 侧边栏菜单从「蓝图库」加长到「最佳实践案例库」，光看 HTML 里有这五个字不够 ——
 * 212px 的侧栏里它可能已经被挤到换行或被截断。这类问题只有截图能看出来。
 *
 * 跑法：node .verify/check-case-library.mjs   （先确保 3010 静态站在跑）
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.env.SHOT_URL || 'http://127.0.0.1:3010';
const OUT = '.verify/shots-case-library';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1520, height: 1180 } });

const problems = [];

async function shot(name, note) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ✓ ${name}.png  ${note}`);
}

try {
  // ── ① 侧边栏菜单：必须完整可见，不能被截断 ──────────────
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  // 侧栏有移动端与桌面端两套导航，桌面那套在 aside 里，这里量的是它的宽度。
  // 用 ^= 而不是 = ：next.config 开了 trailingSlash，导出的 href 带结尾斜杠。
  const SEL = 'aside nav a[href^="/blueprints"]';
  const navItem = page.locator(SEL).first();
  if ((await navItem.count()) === 0) {
    throw new Error('侧边栏里找不到指向 /blueprints 的菜单项');
  }
  const box = await navItem.boundingBox();
  const label = page.locator(`${SEL} span.flex-1`).first();
  const labelBox = await label.boundingBox();
  const text = (await label.innerText()).trim();

  console.log(`  菜单文字：「${text}」`);
  console.log(`  侧栏项宽 ${box?.width}px，文字宽 ${labelBox?.width}px`);

  if (text !== '最佳实践案例库') {
    problems.push(`侧边栏菜单文字是「${text}」，期望「最佳实践案例库」`);
  }
  if (box && labelBox && labelBox.width > box.width - 24) {
    problems.push(`菜单文字宽度 ${labelBox.width} 已顶到侧栏项宽 ${box.width}，可能被截断`);
  }
  // 文字是否换行：行高明显超过单行说明折行了
  if (labelBox && labelBox.height > 24) {
    problems.push(`菜单文字高度 ${labelBox.height}px，疑似折行`);
  }
  await shot('01-sidebar', '侧边栏：菜单已改名为最佳实践案例库');

  // ── ② 列表页 ──────────────────────────────────────────
  await page.goto(`${BASE}/blueprints/`, { waitUntil: 'networkidle' });
  const heading = (await page.locator('h1').first().innerText()).trim();
  console.log(`  列表页标题：「${heading}」`);
  if (heading !== '最佳实践案例库') {
    problems.push(`列表页标题是「${heading}」`);
  }
  const caseCount = await page.locator('a[href^="/blueprints/"]').count();
  console.log(`  案例卡片 ${caseCount} 张`);
  if (caseCount < 4) problems.push(`列表页只有 ${caseCount} 张案例卡片`);
  await shot('02-list', '列表页：标题 + 案例卡片');

  // ── ③ 详情页三段新增内容 ──────────────────────────────
  await page.goto(`${BASE}/blueprints/crud-basic/`, { waitUntil: 'networkidle' });
  for (const [sel, label] of [
    ['text=什么时候不要用这套写法', '不适用边界'],
    ['text=分页查询的关键量级', '性能对比'],
    ['text=参考出处', '参考出处'],
  ]) {
    const n = await page.locator(sel).count();
    console.log(`  ${label}：命中 ${n} 处`);
    if (n === 0) problems.push(`详情页缺少「${label}」区块`);
  }
  // 参考出处里的外链必须真的带 href
  const refLinks = await page.locator('section a[target="_blank"]').count();
  console.log(`  参考外链 ${refLinks} 条`);
  if (refLinks === 0) problems.push('参考出处里没有任何外部链接');

  await page.screenshot({ path: `${OUT}/03-detail-full.png`, fullPage: true });
  console.log(`  ✓ 03-detail-full.png  详情页整页`);

  // ── ④ 控制台不能有报错 ────────────────────────────────
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/blueprints/skeleton-config/`, { waitUntil: 'networkidle' });
  if (errors.length) problems.push(`页面运行时报错：${errors.join(' | ')}`);
} finally {
  await browser.close();
}

console.log('\n──────────────────────────────────────────────');
if (problems.length) {
  console.log(`失败 ${problems.length} 项：`);
  for (const p of problems) console.log('  - ' + p);
  process.exit(1);
}
console.log('全部通过：菜单改名生效、无截断、三段新增内容均已渲染');
