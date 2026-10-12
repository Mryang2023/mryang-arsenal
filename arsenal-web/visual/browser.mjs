/**
 * 启动无头浏览器 —— 视觉层里**唯一一处**启动入口（shoot.mjs 与 assert.mjs 共用）。
 *
 * 为什么不能只写 `chromium.launch({ channel: 'msedge' })`：Playwright 找 msedge 走的是
 * 「注册表 App Paths → 取不到就退回 `%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe`」
 * 这一路。而本机 Edge 装在 `C:\Program Files (x86)\Microsoft\Edge\Application\92.0.902.67\`
 * —— **版本子目录里**，`Application\` 根下没有 `msedge.exe`。于是它直接报：
 *
 *   Chromium distribution 'msedge' is not found at
 *   C:\Users\Administrator\AppData\Local\Microsoft\Edge\Application\msedge.exe
 *
 * 2026-09-23 实测后果：`verify:visual` 12 项里 **10 项红**，`pass` 只剩 2 项不需要浏览器的
 * 前置项，而且报的是「起不来浏览器」这种跟页面无关的错 —— 很容易被读成「这层本来就跑不动」，
 * 于是整条九层链的绿都变得不可信。
 *
 * 所以这里按顺序试三条路，任一条命中就用显式 `executablePath`：
 *   ① 环境变量 `EDGE_PATH`（换机器时的手动出口）
 *   ② 常见安装根目录下的 `msedge.exe`
 *   ③ 根目录下的**版本子目录**里最高的那个 `msedge.exe`（本机就是这种）
 * 三条都不中才退回 `channel: 'msedge'`，让 Playwright 自己找 —— 不把话说死。
 *
 * 2026-10-12（Tailwind 4 升级）新增 **⓪ Playwright 自带 chromium 优先**：
 * Tailwind 4 的产物整个装在 CSS `@layer` 里（还有 color-mix()），官方要求
 * Chromium 111+。本机 Edge 是 92（2021）—— `@layer` 要 Chromium 99+，92 直接把
 * utilities 整层丢弃，页面退化成「半裸」布局，视觉断言量到的全是假象
 * （实测：.overflow-auto 在 CSS 文件里有、加载后 CSSOM 里没有，溢出全是假的）。
 * v3 产物没有 cascade layers 所以当年没事；v4 起自带 chromium 若已安装就优先用它，
 * 没有才落回 Edge 三条路。`npx playwright install chromium` 可补装。
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const EDGE_ROOTS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application',
  'C:\\Program Files\\Microsoft\\Edge\\Application',
];

/** 本机 `msedge.exe` 的绝对路径；找不到返回 null（此时交给 Playwright 的 channel 兜底） */
export function findEdgeBinary() {
  const fromEnv = process.env.EDGE_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  for (const root of EDGE_ROOTS) {
    if (!existsSync(root)) continue;

    const direct = join(root, 'msedge.exe');
    if (existsSync(direct)) return direct;

    // 根下没有 → 去版本子目录里找，取版本号最大的那个
    const candidates = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d+\./.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .reverse()
      .map((name) => join(root, name, 'msedge.exe'))
      .filter((p) => existsSync(p));
    if (candidates.length > 0) return candidates[0];
  }
  return null;
}

/**
 * 用统一策略启动浏览器。
 * @param {import('playwright-core').BrowserType} chromium
 * @param {object} [extra] 追加的 launch 选项（会覆盖默认的 headless / args）
 * @returns {Promise<import('playwright-core').Browser>}
 */
export async function launchBrowser(chromium, extra = {}) {
  const opts = { headless: true, args: ['--disable-gpu'], ...extra };
  // ⓪ Playwright 自带 chromium 优先 —— Tailwind 4 的 @layer / color-mix 需要
  //   Chromium 111+，本机 Edge 92 会整层丢弃样式（见文件头注释）。
  let bundled = null;
  try {
    bundled = chromium.executablePath();
  } catch {
    /* 未安装时 executablePath 可能抛错，走下面的 Edge 三条路 */
  }
  if (bundled && existsSync(bundled)) return chromium.launch({ ...opts, executablePath: bundled });
  const binary = findEdgeBinary();
  if (binary) return chromium.launch({ ...opts, executablePath: binary });
  return chromium.launch({ ...opts, channel: 'msedge' });
}

/** 出错时说清楚「它是怎么找的」，别只丢一句 Playwright 的原文 */
export function describeBrowserSource() {
  let bundled = null;
  try {
    bundled = chromiumPathHint();
  } catch {
    /* 同上 */
  }
  if (bundled && existsSync(bundled)) return `Playwright 自带 chromium ${bundled}`;
  const binary = findEdgeBinary();
  return binary
    ? `显式路径 ${binary}`
    : '没有找到本机 msedge.exe（试过 EDGE_PATH、两个安装根目录、版本子目录），已退回 channel=msedge';
}

/** playwright-core 注册表里 chromium 的落盘路径；未安装则返回不存在的路径 */
function chromiumPathHint() {
  // 延迟 require：让「没装 chromium 只用 Edge」的机器完全不碰注册表
  const require = createRequire(import.meta.url);
  const { chromium: chrome } = require('playwright-core');
  return chrome.executablePath();
}
