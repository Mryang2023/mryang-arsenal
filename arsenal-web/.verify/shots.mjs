/**
 * 装配台视觉自检：用本机 Edge 驱动，逐个状态截图。
 *
 * 为什么不用静态 HTML 截图：静态产物只包含初始状态，
 * 而这张图真正的价值在「拆掉一块之后」——缺件、归并结论、抽屉里的零件库，
 * 这些都必须真的点一遍才能看到。所以用 playwright-core 驱动已安装的 Edge
 * （channel: 'msedge'，不下载 Chromium）。
 *
 * 跑法：npx tsx .verify/shots.mjs      （先确保 3010 静态站在跑）
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const URL = process.env.SHOT_URL || 'http://127.0.0.1:3010/stack/';
const OUT = '.verify/shots';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1520, height: 1180 } });

async function shot(name, note) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ✓ ${name}.png  ${note}`);
}

try {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await shot('01-runnable', '初始态：生产标配，可以跑起来');

  // 拆掉「数据库」：点开模块 → 拆掉 → 关掉抽屉看体检结论
  await page.locator('[data-dim="database"]').click();
  await shot('02-drawer', '零件库抽屉：可换可拆，含能力声明');

  await page.getByRole('button', { name: '拆掉这一块（留空）' }).click();
  await page.locator('aside button[aria-label="关闭"]').click();
  await shot('03-broken', '拆掉数据库后：跑不起来 + 下游能力缺口被归并');

  // 从零开始
  await page.getByRole('button', { name: '清空重搭' }).click();
  await shot('04-empty', '清空重搭：5 个必选模块全部空缺');

  // 只留必选
  await page.getByRole('button', { name: '只留必选' }).click();
  await shot('05-skeleton', '只留必选：能跑的最小骨架，其余提示补齐');

  // 造一个组合隐患
  await page.getByRole('button', { name: '生产标配' }).click();
  await page.locator('[data-dim="cache"]').click();
  await page.getByText('Caffeine（本地缓存）').click();
  await page.locator('[data-dim="registry"]').click();
  await page.getByText('Nacos', { exact: true }).click();
  await page.locator('aside button[aria-label="关闭"]').click();
  await shot('06-risk', 'Caffeine + Nacos：能启动，但有多实例缓存不一致隐患');

  const states = await page.$$eval('[data-dim]', (els) =>
    els.map((e) => `${e.dataset.dim}=${e.dataset.state}`)
  );
  console.log(`\n  槽位状态（${states.length} 个）：\n    ${states.join('\n    ')}`);
} finally {
  await browser.close();
}
