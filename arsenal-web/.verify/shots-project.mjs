/**
 * 结构层与导出的视觉自检：用本机 Edge 驱动，把新做的四件事逐个走一遍。
 *
 * 这一轮新增的东西全是「点了才看得见」的：
 *   · 启动类页签与开关归属表
 *   · 结构图（跟着选型变，换 Gradle 就没有 pom.xml）
 *   · 隐患体检单（触发条件 / 现象 / 后果 / 对策）
 *   · 一键导出 —— 这里会把下载真的接住、落到磁盘，
 *     再交给 Python 的 zipfile 复核。导出按钮这种东西，
 *     只截图看不出包是空的还是坏的。
 *
 * 跑法：先起静态站（python -m http.server 3010 -d out），再 npx tsx .verify/shots-project.mjs
 */
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.SHOT_URL || 'http://127.0.0.1:3010/stack/';
const OUT = '.verify/shots';
const DL = '.verify/tmp';
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(DL, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1520, height: 1400 } });

async function shot(name, note) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ✓ ${name}.png  ${note}`);
}

/** 展开产物区并切到某个页签 */
async function tab(label) {
  const btn = page.getByRole('button', { name: new RegExp(label) }).last();
  await btn.scrollIntoViewIfNeeded();
  await btn.click();
  await page.waitForTimeout(200);
}

try {
  await page.goto(URL, { waitUntil: 'networkidle' });

  // ── ① 危害讲透：方块上直接写出是哪条隐患 ────────────────
  await page.getByRole('button', { name: '生产标配' }).click();
  await page.locator('[data-dim="cache"]').click();
  await page.getByText('Caffeine（本地缓存）').click();
  await page.locator('[data-dim="registry"]').click();
  await page.getByText('Nacos', { exact: true }).click();
  await page.locator('aside button[aria-label="关闭"]').click();
  await page.locator('.panel').filter({ hasText: '中间件与调度' }).first().scrollIntoViewIfNeeded();
  await shot('10-hazard-on-block', '组合隐患：方块上直接写出是哪条，不再只标「有隐患」');

  // ── ② 隐患体检单页签 ───────────────────────────────────
  await tab('隐患体检单');
  await shot('11-risk-sheet', '隐患体检单：触发条件 / 会看到的现象 / 后果 / 对策');

  // ── ③ 启动类 ───────────────────────────────────────────
  await page.getByRole('button', { name: '生产标配' }).click();
  await tab('Application.java');
  await shot('12-app-class', '启动类：完整文件 + 全局开关归属表');

  // ── ④ 结构图（Maven + MyBatis-Plus）────────────────────
  await tab('目录与导出');
  await page.locator('.panel').filter({ hasText: '目录结构' }).first().scrollIntoViewIfNeeded();
  await shot('13-tree-maven', '结构图：Maven + MyBatis-Plus，mapper/ 与 db/migration/ 都在');

  // ── ⑤ 换成 Gradle + JPA，结构必须跟着变 ────────────────
  await page.locator('[data-dim="build"]').click();
  await page.getByText('Gradle', { exact: true }).click();
  await page.locator('[data-dim="persistence"]').click();
  await page.getByText('Spring Data JPA').click();
  await page.locator('aside button[aria-label="关闭"]').click();
  await page.waitForTimeout(250);
  await page.locator('.panel').filter({ hasText: '目录结构' }).first().scrollIntoViewIfNeeded();
  await shot('14-tree-gradle-jpa', '换 Gradle + JPA：pom.xml 与 mapper/ 消失，出现 JpaAuditConfig');

  // ── ⑥ 一键导出：把包接住 ───────────────────────────────
  await page.getByRole('button', { name: '生产标配' }).click();
  await page.waitForTimeout(200);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '一键导出项目' }).click(),
  ]);
  const target = path.join(DL, 'downloaded.zip');
  await download.saveAs(target);
  const size = fs.statSync(target).size;
  console.log(`  ✓ 导出下载 → ${target}（${size} bytes）`);
  await page
    .locator('.panel')
    .filter({ hasText: '这套组合的产物' })
    .first()
    .scrollIntoViewIfNeeded();
  await shot('15-exported', '导出成功：告诉用户包里装了什么、下一步怎么跑');

  // ── ⑦ 导出后 zip 是否可解析：交给 Python zipfile 在下一步复核 ──
  fs.writeFileSync(
    path.join(DL, 'download-info.json'),
    JSON.stringify({ target, size, suggested: download.suggestedFilename() }, null, 2),
    'utf8'
  );
  console.log(`  建议文件名：${download.suggestedFilename()}`);
} finally {
  await browser.close();
}
