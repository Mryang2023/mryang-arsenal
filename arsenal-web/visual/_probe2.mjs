import { chromium } from 'playwright-core';
import { launchBrowser } from './browser.mjs';
const BASE = process.env.VISUAL_BASE_URL || 'http://127.0.0.1:3021';
const browser = await launchBrowser(chromium);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(BASE + '/rules', { waitUntil: 'networkidle' });
console.log(
  await page.evaluate(() => {
    const aside = document.querySelector('aside');
    const head = aside.querySelector('div');
    const navs = [...aside.querySelectorAll('nav')];
    const nav = navs.find((n) => n.getBoundingClientRect().height > 0);
    const hr = head.getBoundingClientRect();
    const nr = nav.getBoundingClientRect();
    // 菜单最后两项（配额卡 / 统计块）的位置
    const last = nav.lastElementChild.getBoundingClientRect();
    return {
      headH: Math.round(hr.height),
      headBottom: Math.round(hr.bottom),
      navTop: Math.round(nr.top),
      navBottom: Math.round(nr.bottom),
      lastBlockBottom: Math.round(last.bottom),
      winH: window.innerHeight,
      超出视口: Math.round(nr.bottom - window.innerHeight),
    };
  }),
);
await browser.close();