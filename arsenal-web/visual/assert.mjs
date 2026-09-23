#!/usr/bin/env node
/**
 * V-3 视觉断言 —— 把「看着不对」变成「机器能判」
 *
 * 分工（plan-5 §V-3 定死）：**断言管几何与数值，看图管语义**。
 * 「这个图标认不认得出来」「这句结论说不说得通」不写成断言 —— 那是给自己造一个必然误报的检查。
 *
 * 纯 .mjs，零新增依赖：唯一的 `playwright-core` 已在 arsenal-web/node_modules，
 * 本机没有 Chrome，靠已安装的 Edge：**路径解析在 `visual/browser.mjs`** ——
 * `channel: 'msedge'` 在这台机器上找不到它（Edge 装在版本子目录里，
 * 2026-09-23 就因此让本层 12 项红了 10 项）。
 * 静态站由本脚本自己起（node 内置 http），跑完关掉 —— 不要求外面先开好 3021。
 *
 * 用法：
 *   node visual/assert.mjs                      # 起静态站 → 15 URL × 3 视口，逐张断言
 *   node visual/assert.mjs --check-findings     # 只核对 findings.md 引用的 PNG 是否真实存在
 *   node visual/assert.mjs --viewport=mobile    # 只跑某一档视口（调试用）
 *   VISUAL_BASE_URL=http://127.0.0.1:3021 node visual/assert.mjs   # 复用已在跑的站点，不起新的
 *
 * 退出码：
 *   0 = 全部断言通过（未适用项不算失败，但会单独计数并打印）
 *   1 = 有断言失败，或环境缺失（out/ 没构建、起不了站、浏览器起不来）—— 两种情况都会全文打印原因
 *
 * 前置：`node scripts/next-run.mjs build` 产出过 out/。没构建过就直接报错退出，不静默跳过。
 *
 * 为什么断言要自己测量、而不是读 manifest.json：
 *   manifest 是 shoot.mjs 跑那一刻的世界。HEAD 变了而没人重跑截图时，读 manifest
 *   断言的是**旧世界**，会给出一种「绿得很自信」的假象。所以几何一律现测。
 *   manifest 只用来交叉核对「要测的矩阵有没有变」（见下 A0）。
 */

import { chromium } from 'playwright-core';
import { launchBrowser, describeBrowserSource } from './browser.mjs';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverUrls, VIEWPORTS, SHOTS_DIR, MANIFEST_PATH, BASE_URL } from './shoot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, '..');
const OUT_DIR = join(WEB_ROOT, 'out');
const EVIDENCE_DIR = join(HERE, 'evidence');
const FINDINGS_PATH = join(HERE, 'findings.md');

/** 阈值集中在这里，改判据只改这一处。
 *  ⚠️ 全部必须是**可结构化克隆的纯值**（数字/字符串/布尔/数组/对象）：
 *  page.evaluate 的入参要序列化进页面上下文，函数过不去 —— 第一次跑就是这么挂的，
 *  而且挂法很阴：45 张全部 evaluate 抛错，逐项汇总却显示「判定 45 张 / 失败 0 张」。 */
const LIMITS = {
  overflowPx: 0,
  childOverflowPx: 1,
  fixedOverlapPx: 2,
  contrastBody: 4.5,
  contrastLarge: 3,
  bottomBlankRatio: 0.4,
  maxContrastSamples: 120,
};

const ARG = process.argv.slice(2);
const ONLY_VIEWPORT = (ARG.find((a) => a.startsWith('--viewport=')) || '').split('=')[1] || null;
const CHECK_FINDINGS = ARG.includes('--check-findings');

const say = (s = '') => console.log(s);

// ══════════════════════════════════════════════════════════════
// 静态站（node 内置 http，零依赖）
// ══════════════════════════════════════════════════════════════

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function startStaticServer(rootDir, port) {
  const root = resolve(rootDir);
  const server = createServer((req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
      let target = resolve(root, '.' + pathname);
      // 目录穿越护栏：resolve 之后必须仍在 root 里
      if (target !== root && !target.startsWith(root + (process.platform === 'win32' ? '\\' : '/'))) {
        res.writeHead(403).end('forbidden');
        return;
      }
      if (existsSync(target) && statSync(target).isDirectory()) target = join(target, 'index.html');
      if (!existsSync(target)) {
        res.writeHead(404).end('not found');
        return;
      }
      const body = readFileSync(target);
      res.writeHead(200, {
        'content-type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
        'content-length': body.length,
      });
      res.end(body);
    } catch (err) {
      res.writeHead(500).end(String((err && err.message) || err));
    }
  });
  return new Promise((ok, no) => {
    server.once('error', no);
    server.listen(port, '127.0.0.1', () => ok(server));
  });
}

async function probe(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return r.ok;
  } catch {
    return false;
  }
}

// ══════════════════════════════════════════════════════════════
// 断言本体（在页面上下文里执行，返回三态：pass / fail / na）
// ══════════════════════════════════════════════════════════════

const ASSERTION_NAMES = [
  'A1 无横向溢出',
  'A2 main 一级子元素不越界',
  'A3 图片全部加载成功',
  'A4 固定/粘性元素互不遮挡',
  'A5 正文对比度达标',
  'A6 <h1> 唯一',
  'A7 页面底部无假高度',
];

function collectAssertions(page) {
  return page.evaluate((limits) => {
    const out = [];
    const de = document.documentElement;
    const cw = de.clientWidth;
    const vh = de.clientHeight;
    const clsOf = (el) => {
      const c = el.className && typeof el.className === 'string' ? el.className : '';
      return `${el.tagName.toLowerCase()}${c ? '.' + c.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
    };
    const isVisible = (el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (parseFloat(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    // ── A1 无横向溢出 ─────────────────────────────
    // 越界元素清单必须给：父容器会连带越界，**最深**的那个才是元凶
    // （V2-01 就是这么从 15 张 53px 定位到 header 里那个 nav 的）。
    const overflow = de.scrollWidth - cw;
    const offenders = [];
    const clippedList = [];
    if (overflow > limits.overflowPx) {
      const list = [];
      for (const el of document.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        const over = r.right - cw;
        if (over <= 1) continue;
        // 关键：被祖先的 overflow-x（auto/scroll/hidden）吸收的越界**不撑破页面**。
        // 代码块里的长行就是这个情形 —— 越界 200px 却只让页面多 3px，报它等于指错人。
        let clipped = null;
        for (let p = el.parentElement; p; p = p.parentElement) {
          const pcs = getComputedStyle(p);
          if (pcs.overflowX !== 'visible') {
            clipped = `${clsOf(p)}/${pcs.overflowX}`;
            break;
          }
        }
        if (clipped) {
          clippedList.push({ who: clsOf(el), text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 22), right: Math.round(r.right), over: Math.round(over), clipped });
          continue;
        }
        let depth = 0;
        for (let p = el.parentElement; p; p = p.parentElement) depth++;
        list.push({
          who: clsOf(el),
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 22),
          left: Math.round(r.left),
          right: Math.round(r.right),
          width: Math.round(r.width),
          over: Math.round(over),
          depth,
          pos: getComputedStyle(el).position,
        });
      }
      // 同越界量时先报**最外层**：撑开页面的往往是某个祖先容器，只报卡片等于指错人。
      list.sort((a, b) => b.over - a.over || a.depth - b.depth);
      for (const x of list.slice(0, 4)) {
        offenders.push(
          `${x.who}${x.text ? `「${x.text}」` : ''} ${x.left}..${x.right}（宽 ${x.width}，越界 ${x.over}px，${x.pos}，depth ${x.depth}）`,
        );
      }
      if (list.length === 0) {
        offenders.push('没有未被裁剪的越界元素 —— 溢出可能来自根元素自身或滚动条宽度');
      }
      // 次级线索：被祖先裁剪的越界元素。它们自己不撑破页面，但**撑开 grid/flex 列宽的
      // 往往就是它们** —— `line-clamp-3` 自带 overflow:hidden，正好把自己从元凶名单里藏起来。
      clippedList.sort((a, b) => b.over - a.over);
      for (const x of clippedList.slice(0, 3)) {
        offenders.push(`（线索·被 ${x.clipped} 裁剪）${x.who}${x.text ? `「${x.text}」` : ''} right=${x.right} 越界 ${x.over}px`);
      }
    }
    out.push({
      id: 'A1',
      ok: overflow <= limits.overflowPx,
      actual: `scrollWidth ${de.scrollWidth} - clientWidth ${cw} = ${overflow}px`,
      offenders,
    });

    // ── A2 main 一级可见子元素右边界不越界 ─────────
    const main = document.querySelector('main') || document.body;
    if (!main) {
      out.push({ id: 'A2', na: '页面没有 main 也没有 body', offenders: [] });
    } else {
      const kids = Array.from(main.children).filter(isVisible);
      const bad = kids
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { who: clsOf(el), right: Math.round(r.right), over: Math.round(r.right - cw) };
        })
        .filter((x) => x.over > limits.childOverflowPx);
      out.push({
        id: 'A2',
        ok: bad.length === 0,
        actual: `main 一级可见子元素 ${kids.length} 个，越界 ${bad.length} 个（clientWidth ${cw}）`,
        offenders: bad.slice(0, 4).map((b) => `${b.who} right=${b.right} 越界 ${b.over}px`),
      });
    }

    // ── A3 图片全部加载成功 ───────────────────────
    const imgs = Array.from(document.images).filter((im) => (im.currentSrc || im.src || '').length > 0);
    const brokenImgs = imgs.filter((im) => im.naturalWidth === 0);
    out.push({
      id: 'A3',
      ok: brokenImgs.length === 0,
      actual: `图片 ${imgs.length} 张，加载失败 ${brokenImgs.length} 张`,
      offenders: brokenImgs.slice(0, 4).map((im) => `${(im.currentSrc || im.src).split('/').slice(-1)[0]} alt="${im.alt}"`),
    });

    // ── A4 固定/粘性元素互不遮挡 ──────────────────
    // 判据含 sticky：站点页头与侧栏都是 `md:sticky`（Shell.tsx:35/75），
    // 只判 fixed 的话这条断言在本站**一张都判不了**（曾经 45 张全 na）。
    // sticky 的静态位置就是它在文档流里的位置，两个 sticky 相交说明版式算错了。
    const floatingEls = Array.from(document.querySelectorAll('*')).filter((el) => {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'sticky') return false;
      if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 8 && r.height > 8;
    });
    if (floatingEls.length < 2) {
      out.push({
        id: 'A4',
        na: `position:fixed|sticky 可见元素只有 ${floatingEls.length} 个，凑不出「两两」`,
        offenders: [],
      });
    } else {
      const boxes = floatingEls.map((el) => ({ who: clsOf(el), r: el.getBoundingClientRect() }));
      const hits = [];
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const A = boxes[i].r;
          const B = boxes[j].r;
          const w = Math.min(A.right, B.right) - Math.max(A.left, B.left);
          const h = Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top);
          if (w > limits.fixedOverlapPx && h > limits.fixedOverlapPx) {
            hits.push(`${boxes[i].who} ∩ ${boxes[j].who} = ${Math.round(w)}×${Math.round(h)}px`);
          }
        }
      }
      out.push({
        id: 'A4',
        ok: hits.length === 0,
        actual: `position:fixed|sticky 可见元素 ${boxes.length} 个，相交 ${hits.length} 对`,
        offenders: hits.slice(0, 4),
      });
    }

    // ── A5 正文对比度（WCAG 2.1）──────────────────
    const parseColor = (s) => {
      const m = String(s || '').match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      if (p.length < 3 || p.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
      return { rgb: p.slice(0, 3), alpha: p.length >= 4 ? p[3] : 1 };
    };
    const lum = (rgb) =>
      rgb
        .map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        })
        .reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) => {
      const la = lum(a);
      const lb = lum(b);
      const hi = Math.max(la, lb);
      const lo = Math.min(la, lb);
      return (hi + 0.05) / (lo + 0.05);
    };
    // 背景只能取「确定不透明」的：渐变 / 半透明 / 图片背景一律不猜
    const opaqueBgOf = (el) => {
      let node = el;
      while (node && node.nodeType === 1) {
        const cs = getComputedStyle(node);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
        if (parseFloat(cs.opacity) < 1) return null;
        const c = parseColor(cs.backgroundColor);
        if (c) {
          if (c.alpha === 1) return c.rgb;
          if (c.alpha > 0) return null;
        }
        node = node.parentElement;
      }
      const rc = parseColor(getComputedStyle(document.documentElement).backgroundColor);
      return rc && rc.alpha === 1 ? rc.rgb : null;
    };
    const hasOwnText = (el) =>
      Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').trim().length >= 2);

    const scope = document.querySelector('main') || document.body;
    const candidates = scope
      ? Array.from(scope.querySelectorAll('p, li, td, th, span, a, code, h1, h2, h3, h4, label, button, div'))
          .filter((el) => hasOwnText(el) && isVisible(el) && !el.closest('[aria-hidden="true"]'))
          .slice(0, limits.maxContrastSamples)
      : [];
    let checked = 0;
    const naReasons = {};
    const lowContrast = [];
    for (const el of candidates) {
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize) || 0;
      if (fs < 12) {
        naReasons['字号 < 12px（标签类）'] = (naReasons['字号 < 12px（标签类）'] || 0) + 1;
        continue;
      }
      const fg = parseColor(cs.color);
      if (!fg || fg.alpha === 0) {
        naReasons['前景色无法解析或全透明'] = (naReasons['前景色无法解析或全透明'] || 0) + 1;
        continue;
      }
      const bg = opaqueBgOf(el);
      if (!bg) {
        naReasons['背景非不透明（渐变/半透明/图片）—— 不猜'] = (naReasons['背景非不透明（渐变/半透明/图片）—— 不猜'] || 0) + 1;
        continue;
      }
      checked++;
      const fw = parseInt(cs.fontWeight, 10) || 400;
      const isLarge = fs >= 24 || (fs >= 18.66 && fw >= 700);
      const need = isLarge ? limits.contrastLarge : limits.contrastBody;
      const got = ratio(fg.rgb, bg);
      if (got + 0.01 < need) {
        lowContrast.push({
          who: clsOf(el),
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 26),
          ratio: Math.round(got * 100) / 100,
          need,
          color: `rgb(${fg.rgb.join(',')})`,
          bg: `rgb(${bg.join(',')})`,
        });
      }
    }
    if (checked === 0) {
      out.push({
        id: 'A5',
        na: `没有可判定的正文元素（候选 ${candidates.length} 个全部落在不可判定背景上）`,
        detail: naReasons,
        offenders: [],
      });
    } else {
      lowContrast.sort((a, b) => a.ratio - b.ratio);
      out.push({
        id: 'A5',
        ok: lowContrast.length === 0,
        actual: `判定 ${checked} 个正文元素（另跳过 ${candidates.length - checked} 个），不达标 ${lowContrast.length} 个，阈值 ${limits.contrastBody}:1`,
        detail: naReasons,
        offenders: lowContrast.slice(0, 4).map((x) => `"${x.text}" ${x.ratio}:1 < ${x.need}:1（${x.color} on ${x.bg}，${x.who}）`),
      });
    }

    // ── A6 <h1> 唯一 ──────────────────────────────
    const h1s = document.querySelectorAll('h1');
    out.push({
      id: 'A6',
      ok: h1s.length === 1,
      actual: `<h1> 数量 ${h1s.length}`,
      offenders: Array.from(h1s).slice(0, 4).map((h) => `"${(h.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 26)}"`),
    });

    // ── A7 页面底部无假高度 ───────────────────────
    let maxBottom = 0;
    let lastWho = '';
    for (const el of document.querySelectorAll('body *')) {
      if (!isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      const bottom = r.bottom + window.scrollY;
      if (bottom > maxBottom) {
        maxBottom = bottom;
        lastWho = clsOf(el);
      }
    }
    const blank = de.scrollHeight - maxBottom;
    const allowed = limits.bottomBlankRatio * vh;
    out.push({
      id: 'A7',
      ok: blank <= allowed,
      actual: `scrollHeight ${de.scrollHeight} - 最后内容底部 ${Math.round(maxBottom)} = ${Math.round(blank)}px 空白（上限 ${Math.round(allowed)}px = ${Math.round(limits.bottomBlankRatio * 100)}vh）`,
      offenders: blank > allowed ? [`最后一个可见元素：${lastWho}`] : [],
    });

    return { assertions: out, viewport: { w: cw, h: vh } };
  }, LIMITS);
}

// ══════════════════════════════════════════════════════════════
// --check-findings：findings.md 引用的 PNG 必须真实存在
// ══════════════════════════════════════════════════════════════

function checkFindings() {
  say('── findings.md 素材核对 ─────────────────────────────');
  if (!existsSync(FINDINGS_PATH)) {
    say(`✗ 找不到 ${FINDINGS_PATH}`);
    return { ok: false, failed: 1, total: 0 };
  }
  const md = readFileSync(FINDINGS_PATH, 'utf8');

  // 条目数：表格行形如 `| F-01 | ... |`，兼容 F-01 / V2-01 两种编号
  const rowIds = new Set((md.match(/^\|\s*((?:F|V\d+|P\d+)-\d+)\s*\|/gm) || []).map((r) => r.trim()));
  const MIN_ENTRIES = 15;
  const entries = rowIds.size;

  // 引用的 png：裸文件名先查 shots/ 再查 evidence/；带路径的按相对 visual/ 解析
  const refs = Array.from(new Set(md.match(/[A-Za-z0-9_][A-Za-z0-9_./-]*\.png/g) || []));
  const missing = [];
  const resolved = [];
  for (const ref of refs) {
    // 去掉 markdown 链接残留（`](../x.png` 这类）
    const clean = ref.replace(/^[.\/]+/, '');
    const cands = clean.includes('/')
      ? [join(HERE, clean)]
      : [join(SHOTS_DIR, clean), join(EVIDENCE_DIR, clean), join(HERE, clean)];
    const hit = cands.find((p) => existsSync(p));
    if (hit) resolved.push({ ref, at: hit });
    else missing.push({ ref, tried: cands });
  }

  say(`  条目数 ${entries}${entries >= MIN_ENTRIES ? ` ✓（≥ ${MIN_ENTRIES}）` : ` ✗（< ${MIN_ENTRIES}）`}`);
  say(`  引用 PNG ${refs.length} 个，命中 ${resolved.length} 个，缺失 ${missing.length} 个`);
  for (const m of missing.slice(0, 8)) {
    say(`    ✗ ${m.ref}`);
    for (const t of m.tried) say(`        试过：${t}`);
  }
  const ok = entries >= MIN_ENTRIES && missing.length === 0;
  say(ok ? '  → findings 素材核对通过' : '  → findings 素材核对不通过');
  return { ok, failed: missing.length + (entries >= MIN_ENTRIES ? 0 : 1), total: refs.length + 1, entries };
}

// ══════════════════════════════════════════════════════════════
// 主流程
// ══════════════════════════════════════════════════════════════

async function main() {
  const started = Date.now();

  if (CHECK_FINDINGS) {
    const r = checkFindings();
    say('');
    say(`findings: 条目 ${r.entries ?? 0} / 引用 PNG ${r.total - 1} / ${r.failed === 0 ? '全部存在' : `${r.failed} 处不通过`}`);
    process.exitCode = r.ok ? 0 : 1;
    return;
  }

  // ① 需要 out/：没有就直说，不静默跳过
  if (!existsSync(OUT_DIR)) {
    say(`✗ 没有 ${OUT_DIR} —— 先跑 node scripts/next-run.mjs build 再跑本脚本。`);
    process.exitCode = 1;
    return;
  }

  // ② URL 矩阵
  let discovery;
  try {
    discovery = discoverUrls();
  } catch (err) {
    say(`✗ URL 发现失败：${err.message}`);
    process.exitCode = 1;
    return;
  }
  const viewports = ONLY_VIEWPORT ? VIEWPORTS.filter((v) => v.id === ONLY_VIEWPORT) : VIEWPORTS;
  if (viewports.length === 0) {
    say(`✗ --viewport=${ONLY_VIEWPORT} 不匹配任何档位（可选：${VIEWPORTS.map((v) => v.id).join(' / ')}）`);
    process.exitCode = 1;
    return;
  }

  // ③ 静态站：外面已在跑就复用，否则自己起
  let server = null;
  let base = BASE_URL;
  const reuse = await probe(`${base}/`);
  if (reuse) {
    say(`· 复用已在运行的站点 ${base}`);
  } else {
    const port = Number(new URL(base).port || 3021);
    try {
      server = await startStaticServer(OUT_DIR, port);
      say(`· 已起静态站 ${base}（root=${OUT_DIR}）`);
    } catch (err) {
      say(`✗ 起静态站失败（端口 ${port}）：${err.message}`);
      say('  提示：换端口用 VISUAL_BASE_URL=http://127.0.0.1:<port>');
      process.exitCode = 1;
      return;
    }
  }

  const total = discovery.urls.length * viewports.length;
  say('');
  say(`── 视觉断言：${discovery.urls.length} URL × ${viewports.length} 视口 = ${total} 张 ──────────`);

  let browser = null;
  const results = [];
  try {
    browser = await launchBrowser(chromium);
  } catch (err) {
    say(`✗ 浏览器启动失败（${describeBrowserSource()}）：${err.message}`);
    if (server) await new Promise((r) => server.close(r));
    process.exitCode = 1;
    return;
  }

  try {
    for (const u of discovery.urls) {
      for (const vp of viewports) {
        const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
        const page = await context.newPage();
        const file = `${u.slug}__${vp.id}.png`;
        let payload = null;
        let err = null;
        try {
          await page.goto(`${base}${u.route}`, { waitUntil: 'load', timeout: 20000 });
          await page.waitForTimeout(180);
          payload = await collectAssertions(page);
        } catch (e) {
          err = (e && e.message) || String(e);
        }
        await context.close();

        const fails = payload ? payload.assertions.filter((a) => a.ok === false) : [];
        const nas = payload ? payload.assertions.filter((a) => a.na) : [];
        results.push({ file, route: u.route, viewport: vp.id, assertions: payload ? payload.assertions : [], err });
        const flag = err ? '✗' : fails.length > 0 ? '✗' : nas.length > 0 ? '~' : '✓';
        say(
          `${flag} ${file.padEnd(38)} ${err ? `加载失败: ${err}` : `${payload.assertions.length - nas.length - fails.length} 通过 / ${fails.length} 失败 / ${nas.length} 未适用`}`,
        );
        for (const f of fails) {
          say(`      ✗ ${ASSERTION_NAMES[Number(f.id.slice(1)) - 1]} —— ${f.actual}`);
          for (const o of f.offenders || []) say(`          · ${o}`);
        }
      }
    }
  } finally {
    await browser.close().catch(() => {});
    if (server) await new Promise((r) => server.close(r));
  }

  // ④ 汇总
  const loadFailures = results.filter((r) => r.err);
  const failList = [];
  const naList = [];
  for (const r of results) {
    for (const a of r.assertions) {
      if (a.ok === false) failList.push({ file: r.file, ...a });
      else if (a.na) naList.push({ file: r.file, id: a.id, why: a.na });
    }
  }

  // 逐项汇总的口径必须严格：**加载失败的张数绝不许算进「判定通过」**。
  // 第一版就是在这里自欺的 —— 45 张全部 evaluate 抛错，表里却全是「判定 45 / 失败 0」。
  const okCount = new Map();
  for (const r of results) {
    if (r.err) continue;
    for (const a of r.assertions) {
      if (a.na) continue;
      if (a.ok === true) okCount.set(a.id, (okCount.get(a.id) || 0) + 1);
    }
  }

  say('');
  say('── 逐项汇总 ──────────────────────────────────────');
  say('   （通过 + 失败 + 未适用 + 无从判定 = 总张数；后两项都不是通过）');
  for (let i = 0; i < ASSERTION_NAMES.length; i++) {
    const id = `A${i + 1}`;
    const pass = okCount.get(id) || 0;
    const fails = failList.filter((f) => f.id === id).length;
    const nas = naList.filter((n) => n.id === id).length;
    const unjudged = results.length - pass - fails - nas;
    const mark = fails > 0 ? '✗' : pass === 0 ? '~' : unjudged > 0 ? '⚠' : '✓';
    say(
      `  ${mark} ${ASSERTION_NAMES[i].padEnd(24)} 通过 ${String(pass).padStart(3)} / 失败 ${String(fails).padStart(3)} / 未适用 ${String(nas).padStart(3)} / 无从判定 ${String(unjudged).padStart(3)}`,
    );
  }

  if (loadFailures.length) {
    say('');
    say(`  加载失败 ${loadFailures.length} 张（这些页面连接都没建立，断言无从谈起）：`);
    for (const r of loadFailures.slice(0, 5)) say(`    ✗ ${r.file} —— ${r.err}`);
  }

  if (failList.length) {
    say('');
    say(`  失败明细（每项断言各列最先命中的 6 张）：`);
    const byId = {};
    for (const f of failList) (byId[f.id] = byId[f.id] || []).push(f);
    for (const [id, arr] of Object.entries(byId)) {
      say(`    ${ASSERTION_NAMES[Number(id.slice(1)) - 1]}：${arr.length} 张`);
      for (const f of arr.slice(0, 6)) {
        say(`      ${f.file} —— ${f.actual}`);
        for (const o of f.offenders || []) say(`          · ${o}`);
      }
      if (arr.length > 6) say(`      …另有 ${arr.length - 6} 张同类`);
    }
  }

  const naSummary = {};
  for (const n of naList) naSummary[n.id] = (naSummary[n.id] || 0) + 1;
  if (Object.keys(naSummary).length) {
    say('');
    say(`  未适用说明（不是通过，是本次这一项无处可判）：`);
    for (const [id, n] of Object.entries(naSummary)) {
      const why = naList.find((x) => x.id === id).why;
      say(`    ~ ${ASSERTION_NAMES[Number(id.slice(1)) - 1]}：${n} 张 —— ${why}`);
    }
  }

  const failed = failList.length + loadFailures.length;
  say('');
  say(`visual: ${results.length} 张 / ${ASSERTION_NAMES.length} 项断言 / ${failed} 失败`);
  say(`耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);

  // ⑤ 与 manifest 的矩阵交叉核对：截图台跑过之后页面又变了的话，这里会说话
  if (existsSync(MANIFEST_PATH)) {
    try {
      const m = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
      if (m.shots && m.shots.length !== results.length) {
        say(`⚠ manifest.json 记的是 ${m.shots.length} 张，本次矩阵是 ${results.length} 张 —— 截图台需要重跑（node visual/shoot.mjs）`);
      }
    } catch {
      /* manifest 坏了不归本脚本管，shoot.mjs 会发现 */
    }
  }

  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(`❌ assert.mjs 未捕获异常：${(err && err.stack) || err}`);
  process.exitCode = 1;
});
