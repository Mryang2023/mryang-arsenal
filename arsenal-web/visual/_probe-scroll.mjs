/**
 * 临时探针：量侧边栏菜单与主内容区的滚动关系（不写进仓库，跑完即删）
 * 1) 菜单高度 vs 视口高度 —— 菜单比视口高时，用户在菜单上滚滚不动就变成了滚内容
 * 2) aside/nav 的 computed overflow / position
 * 3) 在菜单区域滚轮后，看 window.scrollY 变没变（=冲突的直接证据）
 */
import { chromium } from 'playwright-core';
import { launchBrowser } from './browser.mjs';

const BASE = process.env.VISUAL_BASE_URL || 'http://127.0.0.1:3021';
const URLS = ['/', '/rules', '/stack', '/cases'];

const browser = await launchBrowser(chromium);
for (const w of [1920, 1440, 1280]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 } });
  const page = await ctx.newPage();
  for (const u of URLS) {
    await page.goto(BASE + u, { waitUntil: 'networkidle' });
    // 桌面端那个 nav（移动端那个是 md:hidden，高度 0，别取错）
    const info = await page.evaluate(() => {
      const aside = document.querySelector('aside');
      const navs = aside ? [...aside.querySelectorAll('nav')] : [];
      const nav = navs.find((n) => n.getBoundingClientRect().height > 0) || null;
      const main = document.querySelector('main');
      const navR = nav?.getBoundingClientRect();
      const cs = nav ? getComputedStyle(nav) : null;
      const links = nav ? nav.querySelectorAll('a').length : 0;
      return {
        docScrollH: document.documentElement.scrollHeight,
        winH: window.innerHeight,
        asideH: aside ? Math.round(aside.getBoundingClientRect().height) : null,
        navH: navR ? Math.round(navR.height) : null,
        navTop: navR ? Math.round(navR.top) : null,
        navPos: cs?.position,
        navOverflowY: cs?.overflowY,
        navScrollH: nav ? nav.scrollHeight : null,
        mainH: main ? Math.round(main.getBoundingClientRect().height) : null,
        navLinks: links,
      };
    });
    // 在菜单正中滚 300px，看页面滚动条是否被推动
    const before = await page.evaluate(() => window.scrollY);
    const box = await page.evaluate(() => {
      const aside = document.querySelector('aside');
      const navs = aside ? [...aside.querySelectorAll('nav')] : [];
      const nav = navs.find((n) => n.getBoundingClientRect().height > 0);
      if (!nav) return null;
      const r = nav.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(Math.min(r.top + 40, window.innerHeight - 40)) };
    });
    if (box) {
      await page.mouse.move(box.x, box.y);
      await page.mouse.wheel(0, 300);
      await page.waitForTimeout(250);
    }
    const after = await page.evaluate(() => window.scrollY);
    console.log(
      `${w}px ${u.padEnd(9)} navH=${info.navH} navTop=${info.navTop} navPos=${info.navPos} ovfY=${info.navOverflowY} navScrollH=${info.navScrollH} winH=${info.winH} docH=${info.docScrollH} links=${info.navLinks} | 菜单上滚轮300 → window.scrollY ${before}→${after}`,
    );
  }
  await ctx.close();
}
await browser.close();