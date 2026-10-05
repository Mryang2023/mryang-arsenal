#!/usr/bin/env node
/**
 * V-1 截图矩阵台 —— 军火库视觉走查的素材来源
 *
 * 纯 .mjs，用 `node visual/shoot.mjs` 直接跑。
 * 刻意不用 tsx / 不引入任何新依赖：仓库铁律是运行时零外部依赖，
 * 且 `.verify/**` 不在 tsconfig 里，坏 import 只在运行时炸 —— 不给自己埋这个坑。
 * 唯一的依赖 `playwright-core` 已在 arsenal-web/node_modules（不下载 Chromium，
 * 本机没有 Chrome，靠已安装的 Edge：**路径解析在 `visual/browser.mjs`**，
 * 因为 `channel: 'msedge'` 在这台机器上找不到它 —— Edge 装在版本子目录里）。
 *
 * 用法：
 *   node visual/shoot.mjs              # 跑全部 22 URL × 3 视口 = 66 张
 *   VISUAL_BASE_URL=http://127.0.0.1:3021/ node visual/shoot.mjs
 *
 * 退出码：
 *   0 = 四项闸门全过（截图数 63 / 每张 >8KB / 无 4xx 响应 / 无运行时报错）
 *   1 = 任一闸门不过，或 URL 发现数与预期不符 —— 全文打印实际错误
 *
 * 产物：
 *   visual/shots/*.png      63 张（已 gitignore，不入库）
 *   visual/manifest.json    机器可读（V-3 assert.mjs 的输入）
 *   visual/report.md        人读
 */

import { chromium } from 'playwright-core';
import { launchBrowser, describeBrowserSource } from './browser.mjs';
import { readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- 路径 / 参数（不硬编码端口：可用环境变量覆盖） ----------

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, '..');
const OUT_DIR = join(WEB_ROOT, 'out');
const SHOTS_DIR = join(HERE, 'shots');
const MANIFEST_PATH = join(HERE, 'manifest.json');
const REPORT_PATH = join(HERE, 'report.md');

const BASE_URL = (process.env.VISUAL_BASE_URL || 'http://127.0.0.1:3021').replace(/\/+$/, '');

// ---------- 预期值（写死的判据，不符即红） ----------

const EXPECTED = {
  // 装配台拆页（2026-09-29 P0）：/stack 由单页拆成四页，stack 子树整棵计入固定页
  // （10 → 13），矩阵随之 17 URL → 20 URL、51 张 → 60 张。
  // 项目章程页（2026-10-03 夜跑）：/charter 上线，固定页 13 → 14，矩阵 21 → 22 URL、63 → 66 张。
  // 装配台步骤路由（2026-10-05）：/stack/step/<id> 十条上线（侧边栏拆细菜单的直达路由，
  // 仍是静态路由不是动态实例，discoverUrls 对 stack 子树整棵放行），固定页 14 → 24，
  // 矩阵 22 → 32 URL、66 → 96 张。
  fixedPages: 24,
  rulePicks: 3,
  // 2026-09-29 修正：上面这句「只剩 1 个」早就过期了 —— 蓝图主题已回到 6 个
  // （connection-pool / local-cache / retry-timeout / untrusted-data / web-layer +
  // virtual-thread，全部静态导出），抽首/末就是 2 个。
  // 这条漂移一直没被任何人发现，是因为 **verify 链只跑 assert.mjs，它不读 mismatches**
  // —— 本棒第一次单独跑 shoot.mjs 才让它红出来。
  blueprintPicks: 2,
  // 场景案例库三层路由（2026-09-26 第 2 棒）：L2 场景页已静态导出（9 个），
  // 按 rules 的先例抽首/中/末 3 个；L3 切片页（61 个）次夜才做，
  // 那时池子非空后这里的 slicePicks 必须改成 2（首/末），脚本会当场报警。
  casePicks: 3,
  slicePicks: 0,
  urls: 32,
  shots: 96,
  minBytes: 8 * 1024,
};

/** 视口三档 —— 站点是深色单主题，第二维度只能是**视口宽度**（见 plan-5 §〇） */
const VIEWPORTS = [
  { id: 'desktop', width: 1440, height: 900 },
  { id: 'tablet', width: 1024, height: 768 },
  { id: 'mobile', width: 390, height: 844 },
];

/** 不进矩阵的目录：404 不是「页面」而是错误页，从未被任何人逐页走查过 */
const EXCLUDED_TOP_DIRS = new Set(['404']);

/**
 * 截图范围 —— **视口尺寸，不是整页**。
 *
 * 为什么不用 fullPage：首轮实测整页图在长页上完全不可判读
 * （`rules__mobile.png` = 390×14809，长宽比 1:38；`home__mobile.png` = 390×8552）。
 * 视觉走查的价值在于「真的看清」—— 交给多模态的图必须是能看清的尺寸。
 * 折中：视口截图给「看」，`metrics.scrollHeight` 给「量」；
 * 折叠线以下的内容由 `scrollHeight` / 越界元素清单（见 report.md）覆盖，
 * 像素级的折叠线以下逐段判读归 V-6 的并排对照（已列入未完成清单）。
 */
const FULL_PAGE = process.env.VISUAL_FULL_PAGE === '1';

/**
 * 已申报基线问题 —— **不计入闸门，但每次运行都打印、并单独计数**。
 *
 * 这是「已知问题台账」而不是「跳过即通过」：
 * ① 每一条都有 id / 原因 / 归属，且**出现在 report.md 与 findings.md 里**；
 * ② 只有匹配到这里的失败才被豁免，其余任何失败一律让退出码变 1（回归守得住）；
 * ③ `--strict` 或 `VISUAL_STRICT=1` 可让它们照常算失败，供终检棒独立复核。
 */
const KNOWN_BASELINE = [
  // favicon-404 已于 2026-10-02 修复（public/favicon.svg + layout.tsx metadata.icons），
  // 基线条目同步摘除 —— 若 404 回归，现在会作为「意外」直接红，不再被基线吞掉。
  {
    id: 'archify-backend-down',
    reason:
      'src/lib/arsenal-api.ts:16 硬编码 DEFAULT_BASE = http://localhost:3011；静态导出站（output:export）挂载即请求 /api/archify，后端未起则必然失败。真实缺陷，见 findings.md F-06。',
    match: (e) =>
      // 后端未起：失败事件（requestfailed / http 40x）自带完整 url
      /\/api\/archify$/.test(String(e.url || '')) ||
      // 后端活着但未开 CORS：3 条 CORS console.error 由 Chromium 生成，无脚本 location（url 为空），
      // 报错原文（e.text）里带目标 URL，如 "Access to fetch at 'http://localhost:3011/api/archify' … CORS policy"。
      // 只归入本条基线，不涉及其它 console.error。
      /\/api\/archify/.test(String(e.text || '')),
  },
  {
    // 2026-10-04：矩阵从 63 张扩到 66 张（/charter 上线）后首次爆量（423 条）。
    // 机理：shoot 逐页 goto 节奏很快，每页视口里的 <Link> 预取还在飞就被下一次
    // 导航中止，Next 路由器对每个被中止的预取打一条 console.error —— 原文自己
    // 写明「Falling back to browser navigation」，页面行为无损，属良性噪音。
    // 页面越重、链接越多，被中止的预取越多（63→66 张时爆量就是这么来的）。
    id: 'rsc-prefetch-abort',
    reason:
      '静态导出站上 <Link> 预取被矩阵的快速导航中止：Next 路由器打 console.error 并回退浏览器导航，页面行为无损。基线申报而非静默 —— --strict 下照常算失败。',
    match: (e) => /Failed to fetch RSC payload/.test(String(e.text || '')),
  },
];

const STRICT = process.env.VISUAL_STRICT === '1' || process.argv.includes('--strict');

// ---------- URL 清单：从产物实测生成，不手写 ----------

/**
 * 递归收集 out 下所有 index.html。
 * 跳过 `_` 开头的目录（_next 静态资源）。
 */
function collectIndexHtml(dir, acc) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectIndexHtml(abs, acc);
    } else if (entry.name === 'index.html') {
      acc.push(abs);
    }
  }
  return acc;
}

/** `out/rules/COL-CODE-001/index.html` -> `rules/COL-CODE-001`（不含 index.html） */
function routeSegments(absHtml) {
  return relative(OUT_DIR, absHtml).split(sep).slice(0, -1);
}

function segmentsToRoute(segs) {
  return segs.length === 0 ? '/' : `/${segs.join('/')}/`;
}

function routeToSlug(route) {
  if (route === '/') return 'home';
  return route.replace(/^\/+|\/+$/g, '').replace(/\//g, '-');
}

export function discoverUrls({ outDir = OUT_DIR, expect = EXPECTED } = {}) {
  const htmls = collectIndexHtml(outDir, []);
  if (htmls.length === 0) {
    throw new Error(`URL 发现失败：${outDir} 下没有任何 index.html —— 是不是没跑过 next build？`);
  }

  const problems = [];
  const fixed = [];
  const rules = [];
  const blueprints = [];
  // 场景案例库三层：segs.length===2 是场景页（/cases/<caseId>），
  // ===3 是切片施工图页（/cases/<caseId>/<sliceId>，次夜才生成）。
  const casePages = [];
  const caseSlicePages = [];

  for (const abs of htmls) {
    const segs = routeSegments(abs);
    const top = segs[0];
    if (top !== undefined && EXCLUDED_TOP_DIRS.has(top)) continue;

    if (top === 'rules' && segs.length === 2) {
      rules.push({ id: segs[1], abs, segs });
    } else if (top === 'blueprints' && segs.length === 2) {
      blueprints.push({ id: segs[1], abs, segs });
    } else if (top === 'cases' && segs.length === 2) {
      casePages.push({ id: segs[1], abs, segs });
    } else if (top === 'cases' && segs.length === 3) {
      caseSlicePages.push({ id: segs[2], abs, segs });
    } else if (segs.length <= 1 || top === 'stack') {
      // 装配台 2026-09-29 P0 拆页：`/stack` 由单页拆成四页，子树多了
      // `/stack/env` `/stack/run` `/stack/delivery` 三片 index.html。
      // 它们是**静态路由**而非「同一动态路由的不同实例」，所以与固定页同类；
      // 这里不放行就会落进下面的 problems（未归类），发现数当场对不上。
      fixed.push({ abs, segs });
    } else {
      problems.push(`未归类的 index.html（既不是固定页也不是已知动态路由）：${segmentsToRoute(segs)}`);
    }
  }

  fixed.sort((a, b) => segmentsToRoute(a.segs).localeCompare(segmentsToRoute(b.segs)));
  rules.sort((a, b) => a.id.localeCompare(b.id));
  blueprints.sort((a, b) => a.id.localeCompare(b.id));
  casePages.sort((a, b) => a.id.localeCompare(b.id));
  caseSlicePages.sort((a, b) => a.id.localeCompare(b.id));

  // 动态路由各抽实例：rules 取首/中/末，blueprints 取首/末，
  // cases 取首/中/末，cases 的切片层取首/末（L3 静态页上线后这个池子才非空）
  //
  // ⚠️ 下标必须先去重再抽：池子里只有 1 个实例时（blueprints 收敛后就是 1 个），
  // `[0, len-1]` 是 `[0, 0]` —— 同一个实例被抽两次，`picks` 计数会比预期多 1，
  // 而 URL 侧靠 `seen` 去重看不出来。**这一条在 2026-09-26 之前就是红的**
  // （本棒之前没人单独跑过 shoot.mjs：verify 链只跑 assert.mjs，它不读 mismatches）。
  const picked = [];
  const pickFrom = (arr, pool, idxs) => {
    for (const idx of [...new Set(idxs)]) {
      if (idx >= 0 && idx < pool.length) picked.push({ arr, item: pool[idx], idx });
    }
  };
  pickFrom('rules', rules, [0, Math.floor(rules.length / 2), rules.length - 1]);
  pickFrom('blueprints', blueprints, [0, blueprints.length - 1]);
  pickFrom('cases', casePages, [0, Math.floor(casePages.length / 2), casePages.length - 1]);
  pickFrom('caseSlices', caseSlicePages, [0, caseSlicePages.length - 1]);

  const seen = new Set();
  const urls = [];
  const KIND_OF = {
    rules: 'rule-detail',
    blueprints: 'blueprint-detail',
    cases: 'case-bench',
    caseSlices: 'case-slice',
  };
  for (const f of fixed) {
    const route = segmentsToRoute(f.segs);
    if (seen.has(route)) continue;
    seen.add(route);
    urls.push({ route, kind: 'fixed', slug: routeToSlug(route), source: relative(WEB_ROOT, f.abs).replace(/\\/g, '/') });
  }
  for (const p of picked) {
    const route = segmentsToRoute(p.item.segs);
    if (seen.has(route)) continue;
    seen.add(route);
    urls.push({
      route,
      kind: KIND_OF[p.arr],
      slug: routeToSlug(route),
      dynamicId: p.item.id,
      pickIndex: p.idx,
      poolSize:
        p.arr === 'rules' ? rules.length
          : p.arr === 'blueprints' ? blueprints.length
            : p.arr === 'cases' ? casePages.length
              : caseSlicePages.length,
      source: relative(WEB_ROOT, p.item.abs).replace(/\\/g, '/'),
    });
  }

  const counts = {
    fixed: fixed.length,
    rules: rules.length,
    blueprints: blueprints.length,
    cases: casePages.length,
    caseSlices: caseSlicePages.length,
    urls: urls.length,
  };

  // 预期值闸门：发现数不符即失败（不许静默继续）
  const mismatches = [];
  const picksOf = (arr) => picked.filter((p) => p.arr === arr).length;
  if (counts.fixed !== expect.fixedPages) {
    mismatches.push(`固定页 ${counts.fixed} ≠ 预期 ${expect.fixedPages}`);
  }
  if (counts.urls !== expect.urls) {
    mismatches.push(`URL 总数 ${counts.urls} ≠ 预期 ${expect.urls}`);
  }
  if (picksOf('rules') !== expect.rulePicks) {
    mismatches.push(`rules 抽到 ${picksOf('rules')} 个 ≠ 预期 ${expect.rulePicks}`);
  }
  if (picksOf('blueprints') !== expect.blueprintPicks) {
    mismatches.push(`blueprints 抽到 ${picksOf('blueprints')} 个 ≠ 预期 ${expect.blueprintPicks}`);
  }
  if (picksOf('cases') !== expect.casePicks) {
    mismatches.push(`cases 抽到 ${picksOf('cases')} 个 ≠ 预期 ${expect.casePicks}`);
  }
  if (picksOf('caseSlices') !== expect.slicePicks) {
    mismatches.push(`cases 切片层抽到 ${picksOf('caseSlices')} 个 ≠ 预期 ${expect.slicePicks}（L3 静态页上线后要改成 2）`);
  }

  return {
    urls,
    counts,
    mismatches,
    pools: {
      rules: rules.length,
      blueprints: blueprints.length,
      cases: casePages.length,
      caseSlices: caseSlicePages.length,
    },
  };
}

// ---------- 单页采集 ----------

const MAX_EVENT_DETAIL = 12;

async function settle(page) {
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  // 等图片解码 + 字体，超时不算失败（超时本身由 img 失败清单与 4xx 闸门兜住）
  await page
    .evaluate(async () => {
      const pending = Array.from(document.images)
        .filter((im) => !im.complete)
        .map((im) => new Promise((r) => { im.addEventListener('load', r, { once: true }); im.addEventListener('error', r, { once: true }); }));
      await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, 3000))]);
      if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
    })
    .catch(() => {});
  await page.waitForTimeout(250);
}

function collectMetrics(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const failedImages = Array.from(document.images)
      .filter((im) => (im.currentSrc || im.src || '').length > 0 && im.naturalWidth === 0)
      .map((im) => {
        const r = im.getBoundingClientRect();
        return {
          src: im.currentSrc || im.src,
          alt: im.alt || '',
          cssWidth: Math.round(r.width),
          cssHeight: Math.round(r.height),
        };
      });
    const h1Count = document.querySelectorAll('h1').length;

    // 越界元素量化：谁把 scrollWidth 撑出去的。只收「最深」的 5 个，
    // 因为父容器会连带越界，最深的那个才是元凶（例：390px 下移动导航 nav 越界 53px）。
    const cw = de.clientWidth;
    const offenders = [];
    for (const el of document.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      const overflowRight = r.right - cw;
      if (overflowRight <= 1) continue;
      const cs = getComputedStyle(el);
      let depth = 0;
      for (let p = el.parentElement; p; p = p.parentElement) depth++;
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className && typeof el.className === 'string' ? el.className : '').slice(0, 100),
        right: Math.round(r.right),
        width: Math.round(r.width),
        top: Math.round(r.top),
        overflowRight: Math.round(overflowRight),
        position: cs.position,
        overflowX: cs.overflowX,
        flexWrap: cs.flexWrap,
        depth,
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      });
    }
    offenders.sort((a, b) => b.depth - a.depth || b.overflowRight - a.overflowRight);
    const topOverflowOffenders = offenders.slice(0, 5);

    return {
      scrollWidth: de.scrollWidth,
      clientWidth: de.clientWidth,
      scrollHeight: de.scrollHeight,
      clientHeight: de.clientHeight,
      bodyScrollHeight: document.body ? document.body.scrollHeight : 0,
      horizontalOverflowPx: Math.max(0, de.scrollWidth - de.clientWidth),
      belowFoldPx: Math.max(0, de.scrollHeight - de.clientHeight),
      imgTotal: document.images.length,
      failedImages,
      overflowElementCount: offenders.length,
      topOverflowOffenders,
      h1Count,
      title: document.title || '',
    };
  });
}

async function shootOne(browser, urlEntry, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  // ⚠️ 监听器必须在 page.goto **之前**注册。
  // 这正是仓库欠账：.verify/check-case-library.mjs 把 page.on 注册在前三次 goto 之后，
  // 所谓「无运行时报错」其实只覆盖了最后一个页面。
  const pageErrors = [];
  const consoleErrors = [];
  const requestFailures = [];
  const httpErrors = [];

  page.on('pageerror', (err) => {
    pageErrors.push({ message: err.message, stack: String(err.stack || '').split('\n').slice(0, 4).join(' | ') });
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const loc = msg.location() || {};
    consoleErrors.push({ text: msg.text(), url: loc.url || '', lineNumber: loc.lineNumber ?? null });
  });
  page.on('requestfailed', (req) => {
    const failure = req.failure();
    requestFailures.push({ url: req.url(), method: req.method(), errorText: failure ? failure.errorText : '' });
  });
  page.on('response', (res) => {
    if (res.status() >= 400) httpErrors.push({ url: res.url(), status: res.status() });
  });

  const file = `${urlEntry.slug}__${viewport.id}.png`;
  const filePath = join(SHOTS_DIR, file);
  const startedAt = Date.now();

  const shot = {
    file,
    route: urlEntry.route,
    kind: urlEntry.kind,
    dynamicId: urlEntry.dynamicId ?? null,
    viewport: viewport.id,
    width: viewport.width,
    height: viewport.height,
    bytes: 0,
    durationMs: 0,
    ok: false,
    error: null,
    metrics: null,
    pageErrors,
    consoleErrors,
    requestFailures,
    httpErrors,
  };

  try {
    await page.goto(BASE_URL + urlEntry.route, { waitUntil: 'load', timeout: 45000 });
    await settle(page);
    const metrics = await collectMetrics(page);
    const buf = await page.screenshot({ fullPage: FULL_PAGE, animations: 'disabled', timeout: 45000 });
    writeFileSync(filePath, buf);
    shot.bytes = buf.length;
    shot.metrics = metrics;
    shot.ok = true;
  } catch (err) {
    shot.error = String((err && err.message) || err);
  } finally {
    shot.durationMs = Date.now() - startedAt;
    await context.close().catch(() => {});
  }

  return shot;
}

// ---------- 报告 ----------

function fmtBytes(n) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`;
}

function truncate(s, n = 160) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

function buildReport(manifest) {
  const L = [];
  L.push('# V-1 截图矩阵 · 人读报告');
  L.push('');
  L.push(`- 生成时间：${manifest.generatedAt}`);
  L.push(`- 站点：\`${manifest.baseUrl}\`（静态导出 \`out/\`，深色单主题）`);
  L.push(`- 矩阵：${manifest.urls.length} 个 URL × ${manifest.viewports.length} 个视口 = **${manifest.shots.length} 张**`);
  L.push(`- 截图范围：\`${manifest.captureMode}\`${manifest.fullPage ? '（整页）' : '（视口尺寸 —— 整页图在长页上完全不可判读，见脚本里 FULL_PAGE 的注释）'}`);
  L.push(`- 折叠线以下：由 \`metrics.scrollHeight\` 与越界元素清单量化；像素级逐段判读归 V-6/V-3，**本棒未做**`);
  L.push('');
  L.push('## 闸门');
  L.push('');
  L.push('两档：**意外**失败让退出码变 1；**已申报基线**只计数、只打印，`--strict` 可让它们照常算失败。');
  L.push('');
  L.push('| 判据 | 期望 | 实测（意外 / 已申报） | 结果 |');
  L.push('|---|---|---|---|');
  const g = manifest.gate;
  const un = g.unexpected;
  L.push(`| 截图数 | ${g.expectedShots} | ${g.actualShots} | ${g.actualShots === g.expectedShots ? '✅' : '❌'} |`);
  L.push(`| 每张字节数 | > ${g.minBytes} | 最小 ${g.minBytesActual}（${g.minBytesFile}） | ${g.minBytesActual > g.minBytes ? '✅' : '❌'} |`);
  L.push(`| URL 发现数 | ${g.expectedUrls} | ${g.actualUrls} | ${g.actualUrls === g.expectedUrls ? '✅' : '❌'} |`);
  L.push(`| pageerror | 0 | ${un.pageErrors} / ${g.pageErrors - un.pageErrors} | ${un.pageErrors === 0 ? '✅' : '❌'} |`);
  L.push(`| console.error | 0 | ${un.consoleErrors} / ${g.consoleErrors - un.consoleErrors} | ${un.consoleErrors === 0 ? '✅' : '❌'} |`);
  L.push(`| requestfailed | 0 | ${un.requestFailures} / ${g.requestFailures - un.requestFailures} | ${un.requestFailures === 0 ? '✅' : '❌'} |`);
  L.push(`| HTTP ≥400 | 0 | ${un.httpErrors} / ${g.httpErrors - un.httpErrors} | ${un.httpErrors === 0 ? '✅' : '❌'} |`);
  L.push('');
  L.push(`**退出码：${g.ok ? '0（意外失败为 0）' : '1（有意外失败）'}**${g.strict ? ' · 本次为 `--strict` 模式' : ''}`);
  L.push('');
  if (g.violations.length > 0) {
    L.push('### 未过的闸门（原文）');
    L.push('');
    for (const v of g.violations) L.push(`- ${v}`);
    L.push('');
  }
  L.push('### 已申报基线问题（不计入闸门，但必须被人看见）');
  L.push('');
  if (g.knownBaseline.length === 0) {
    L.push('（本次无 —— 运行时错误与 4xx 全为 0）');
  } else {
    L.push('| id | 条数 | 原因 | 归属 |');
    L.push('|---|---|---|---|');
    for (const b of g.knownBaseline) L.push(`| \`${b.id}\` | ${b.count} | ${b.reason} | findings.md |`);
    L.push('');
    for (const b of g.knownBaseline) {
      L.push(`- \`${b.id}\`：`);
      for (const e of b.events) L.push(`  - \`${e.file}\` · ${e.kind} · ${e.status ?? ''} ${e.url || e.text}`);
    }
  }
  L.push('');
  L.push('## URL 清单（从产物实测生成）');
  L.push('');
  L.push('| # | 路由 | 类型 | 来源文件 |');
  L.push('|---|---|---|---|');
  const KIND_LABEL = {
    fixed: (u) => '固定页',
    'rule-detail': (u) => `规则详情（池 ${u.poolSize}，取第 ${u.pickIndex + 1}）`,
    'blueprint-detail': (u) => `蓝图详情（池 ${u.poolSize}，取第 ${u.pickIndex + 1}）`,
    'case-bench': (u) => `场景操作台（池 ${u.poolSize}，取第 ${u.pickIndex + 1}）`,
    'case-slice': (u) => `切片施工图（池 ${u.poolSize}，取第 ${u.pickIndex + 1}）`,
  };
  manifest.urls.forEach((u, i) => {
    const kind = (KIND_LABEL[u.kind] ?? ((x) => x.kind))(u);
    L.push(`| ${i + 1} | \`${u.route}\` | ${kind} | \`${u.source}\` |`);
  });
  L.push('');
  L.push('## 截图明细');
  L.push('');
  L.push('| 文件 | 路由 | 视口 | 字节 | 尺寸(视口) | scrollW/clientW | 横向溢出 | scrollH | img 失败 | pageerror | console.err | reqfail | 4xx |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const s of manifest.shots) {
    const m = s.metrics;
    if (!s.ok) {
      L.push(`| \`${s.file}\` | \`${s.route}\` | ${s.viewport} | — | ${s.width}×${s.height} | — | — | — | — | ${s.pageErrors.length} | ${s.consoleErrors.length} | ${s.requestFailures.length} | ${s.httpErrors.length} |`);
      continue;
    }
    L.push(
      `| \`${s.file}\` | \`${s.route}\` | ${s.viewport} | ${fmtBytes(s.bytes)} | ${s.width}×${s.height} | ${m.scrollWidth}/${m.clientWidth} | ${m.horizontalOverflowPx}px | ${m.scrollHeight} | ${m.failedImages.length} | ${s.pageErrors.length} | ${s.consoleErrors.length} | ${s.requestFailures.length} | ${s.httpErrors.length} |`,
    );
  }
  L.push('');
  const overflowShots = manifest.shots.filter((s) => s.metrics && s.metrics.horizontalOverflowPx > 0);
  L.push(`## 横向溢出的元凶（${overflowShots.length} 张有溢出）`);
  L.push('');
  if (overflowShots.length === 0) {
    L.push(`（无 —— 全部 ${manifest.shots.length} 张 scrollWidth === clientWidth）`);
  } else {
    L.push('「最深」的那个元素才是元凶（父容器会连带越界）。');
    L.push('');
    for (const s of overflowShots) {
      L.push(`### \`${s.file}\` —— 越界 ${s.metrics.horizontalOverflowPx}px，共 ${s.metrics.overflowElementCount} 个元素越界`);
      L.push('');
      L.push('| 元素 | right | width | 越界 | position | overflow-x | 文案 |');
      L.push('|---|---|---|---|---|---|---|');
      for (const o of s.metrics.topOverflowOffenders) {
        L.push(
          `| \`${o.tag}${o.cls ? `.${o.cls.split(/\s+/).slice(0, 3).join('.')}` : ''}\` | ${o.right} | ${o.width} | ${o.overflowRight} | ${o.position} | ${o.overflowX} | ${o.text || '—'} |`,
        );
      }
      L.push('');
    }
  }
  L.push('');
  const failedShots = manifest.shots.filter((s) => !s.ok);
  if (failedShots.length > 0) {
    L.push('## 截图本身失败的条目（原文）');
    L.push('');
    for (const s of failedShots) L.push(`- \`${s.file}\`（\`${s.route}\` @ ${s.viewport}）：${s.error}`);
    L.push('');
  }
  const allPageErrors = manifest.shots.flatMap((s) => s.pageErrors.map((e) => ({ file: s.file, ...e })));
  const allConsole = manifest.shots.flatMap((s) => s.consoleErrors.map((e) => ({ file: s.file, ...e })));
  const allReqFail = manifest.shots.flatMap((s) => s.requestFailures.map((e) => ({ file: s.file, ...e })));
  const allHttp = manifest.shots.flatMap((s) => s.httpErrors.map((e) => ({ file: s.file, ...e })));
  const allImgFail = manifest.shots.flatMap((s) => s.metrics ? s.metrics.failedImages.map((e) => ({ file: s.file, ...e })) : []);

  const sections = [
    ['pageerror 全文', allPageErrors, (e) => `\`${e.file}\`：${e.message}\n  - stack: ${truncate(e.stack, 300)}`],
    ['console.error 全文', allConsole, (e) => `\`${e.file}\`：${e.text}\n  - at: ${e.url}:${e.lineNumber}`],
    ['requestfailed 全文', allReqFail, (e) => `\`${e.file}\`：${e.method} ${e.url}\n  - errorText: ${e.errorText}`],
    ['HTTP 4xx/5xx 全文', allHttp, (e) => `\`${e.file}\`：${e.status} ${e.url}`],
    ['img 加载失败（naturalWidth===0 且 src 非空）', allImgFail, (e) => `\`${e.file}\`：src=${e.src}\n  - alt="${e.alt}" css=${e.cssWidth}×${e.cssHeight}`],
  ];
  for (const [title, list, render] of sections) {
    L.push(`## ${title}（${list.length} 条）`);
    L.push('');
    if (list.length === 0) {
      L.push('（无）');
    } else {
      for (const item of list.slice(0, MAX_EVENT_DETAIL * 4)) L.push(`- ${render(item)}`);
      if (list.length > MAX_EVENT_DETAIL * 4) L.push(`- …另有 ${list.length - MAX_EVENT_DETAIL * 4} 条（见 manifest.json）`);
    }
    L.push('');
  }
  L.push('## 采集口径');
  L.push('');
  L.push('- 监听器（`pageerror` / `console` / `requestfailed` / `response`）**在 `page.goto` 之前注册**，按 URL×视口分别累积，不共用数组。');
  L.push('- 每张图附带：截图字节数、`documentElement.scrollWidth/clientWidth`、`scrollHeight`、`img` 失败清单、`h1` 数量、**越界元素清单（最深 5 个）**。');
  L.push(`- 退出码 1 的条件：截图数 ≠ ${EXPECTED.shots}、任一张 ≤ 8KB、**未申报的** pageerror/console.error/requestfailed/HTTP≥400 任一非 0、URL 发现数 ≠ ${EXPECTED.urls}。`);
  L.push('');
  L.push('## 相关文件');
  L.push('');
  L.push('- `visual/findings.md` —— V-2 逐张看图的人工判读结论（21 条，含 P0）');
  L.push('- `visual/reverse-validation.md` —— **反向验证四段**（注入 / 变红 / 还原 / 复绿）逐字原文');
  L.push('- `visual/evidence/` —— findings 引用的那几张位图（`visual/shots/**` 不入库）');
  return `${L.join('\n')}\n`;
}

// ---------- 主流程 ----------

async function main() {
  const startedAt = new Date();
  let discovery;
  try {
    discovery = discoverUrls();
  } catch (err) {
    console.error(`❌ URL 发现失败：${err.message}`);
    process.exitCode = 1;
    return;
  }

  mkdirSync(SHOTS_DIR, { recursive: true });

  const shots = [];
  let browser = null;
  const fatal = [];

  try {
    browser = await launchBrowser(chromium);
  } catch (err) {
    fatal.push(`浏览器启动失败（${describeBrowserSource()}）：${err.message}`);
  }

  if (browser) {
    try {
      for (const u of discovery.urls) {
        for (const vp of VIEWPORTS) {
          const shot = await shootOne(browser, u, vp);
          shots.push(shot);
          const flag = shot.ok ? '✓' : '✗';
          console.log(
            `${flag} ${shot.file.padEnd(40)} ${shot.ok ? fmtBytes(shot.bytes).padStart(9) : 'FAILED'.padStart(9)}  ` +
              `ovf=${shot.metrics ? shot.metrics.horizontalOverflowPx : '?'}  ` +
              `evt=${shot.pageErrors.length}/${shot.consoleErrors.length}/${shot.requestFailures.length}/${shot.httpErrors.length}` +
              (shot.error ? `  err=${shot.error}` : ''),
          );
        }
      }
    } finally {
      // 必须放 finally：截图循环里任何未预期异常都不许把 msedge 进程漏在后台
      await browser.close().catch(() => {});
    }
  }

  const allPageErrors = shots.flatMap((s) => s.pageErrors.map((e) => ({ file: s.file, kind: 'pageerror', ...e })));
  const allConsoleErrors = shots.flatMap((s) => s.consoleErrors.map((e) => ({ file: s.file, kind: 'console', ...e })));
  const allRequestFailures = shots.flatMap((s) => s.requestFailures.map((e) => ({ file: s.file, kind: 'requestfailed', ...e })));
  const allHttpErrors = shots.flatMap((s) => s.httpErrors.map((e) => ({ file: s.file, kind: 'http', ...e })));
  const shotFailures = shots.filter((s) => !s.ok);

  // 已知 / 意外 分层：只有「意外」才让闸门变红
  const classify = (events) => {
    const known = [];
    const unexpected = [];
    for (const e of events) {
      const hit = KNOWN_BASELINE.find((k) => {
        try {
          return k.match(e);
        } catch {
          return false;
        }
      });
      if (hit && !STRICT) known.push({ ...e, baselineId: hit.id, baselineReason: hit.reason });
      else unexpected.push(e);
    }
    return { known, unexpected };
  };

  const consoleClass = classify(allConsoleErrors);
  const reqClass = classify(allRequestFailures);
  const httpClass = classify(allHttpErrors);
  const pageErrClass = classify(allPageErrors);

  const minBytesFile = shots.reduce((best, s) => (best === null || s.bytes < best.bytes ? s : best), null);
  const minBytesActual = shots.length === 0 ? 0 : shots.reduce((m, s) => Math.min(m, s.bytes), Number.POSITIVE_INFINITY);
  const minBytesName = minBytesFile ? minBytesFile.file : '';

  const violations = [];
  if (fatal.length > 0) violations.push(...fatal);
  if (discovery.mismatches.length > 0) violations.push(...discovery.mismatches.map((m) => `URL 发现不符预期：${m}`));
  if (shots.length !== EXPECTED.shots) violations.push(`截图数 ${shots.length} ≠ 期望 ${EXPECTED.shots}`);
  for (const s of shotFailures) violations.push(`截图失败 ${s.file}：${s.error}`);
  if (minBytesActual <= EXPECTED.minBytes && shots.length > 0) {
    violations.push(`最小截图字节数 ${minBytesActual} ≤ ${EXPECTED.minBytes}（文件 ${minBytesName}）`);
  }
  if (pageErrClass.unexpected.length !== 0) violations.push(`未申报的 pageerror 共 ${pageErrClass.unexpected.length} 条（期望 0）`);
  if (consoleClass.unexpected.length !== 0) violations.push(`未申报的 console.error 共 ${consoleClass.unexpected.length} 条（期望 0）`);
  if (reqClass.unexpected.length !== 0) violations.push(`未申报的 requestfailed 共 ${reqClass.unexpected.length} 条（期望 0）`);
  if (httpClass.unexpected.length !== 0) violations.push(`未申报的 HTTP ≥400 响应共 ${httpClass.unexpected.length} 条（期望 0）`);

  const knownIssues = [
    ...pageErrClass.known,
    ...consoleClass.known,
    ...reqClass.known,
    ...httpClass.known,
  ];
  const byBaseline = {};
  for (const k of knownIssues) {
    if (!byBaseline[k.baselineId]) byBaseline[k.baselineId] = { id: k.baselineId, reason: k.baselineReason, count: 0, events: [] };
    byBaseline[k.baselineId].count += 1;
    byBaseline[k.baselineId].events.push({ file: k.file, kind: k.kind, url: k.url ?? '', text: k.text ?? '', status: k.status ?? null });
  }

  const gate = {
    ok: violations.length === 0,
    strict: STRICT,
    expectedShots: EXPECTED.shots,
    actualShots: shots.length,
    expectedUrls: EXPECTED.urls,
    actualUrls: discovery.urls.length,
    minBytes: EXPECTED.minBytes,
    minBytesActual: minBytesActual === Number.POSITIVE_INFINITY ? 0 : minBytesActual,
    minBytesFile: minBytesName,
    // 原始总数（含已申报）
    pageErrors: allPageErrors.length,
    consoleErrors: allConsoleErrors.length,
    requestFailures: allRequestFailures.length,
    httpErrors: allHttpErrors.length,
    // 分层后：闸门只看 unexpected
    unexpected: {
      pageErrors: pageErrClass.unexpected.length,
      consoleErrors: consoleClass.unexpected.length,
      requestFailures: reqClass.unexpected.length,
      httpErrors: httpClass.unexpected.length,
    },
    knownBaselineCount: knownIssues.length,
    knownBaseline: Object.values(byBaseline),
    violations,
  };

  const manifest = {
    generator: 'arsenal-web/visual/shoot.mjs',
    generatedAt: startedAt.toISOString(),
    baseUrl: BASE_URL,
    fullPage: FULL_PAGE,
    captureMode: FULL_PAGE ? 'fullPage' : 'viewport',
    discovery: {
      indexHtmlTotal:
        discovery.counts.fixed + discovery.counts.rules + discovery.counts.blueprints
          + discovery.counts.cases + discovery.counts.caseSlices,
      fixedPages: discovery.counts.fixed,
      rulePagesInPool: discovery.counts.rules,
      blueprintPagesInPool: discovery.counts.blueprints,
      casePagesInPool: discovery.counts.cases,
      caseSlicePagesInPool: discovery.counts.caseSlices,
      excludedTopDirs: Array.from(EXCLUDED_TOP_DIRS),
    },
    viewports: VIEWPORTS,
    urls: discovery.urls,
    shots,
    totals: {
      pageErrors: allPageErrors.length,
      consoleErrors: allConsoleErrors.length,
      requestFailures: allRequestFailures.length,
      httpErrors: allHttpErrors.length,
      failedImages: shots.reduce((n, s) => n + (s.metrics ? s.metrics.failedImages.length : 0), 0),
      shotsFailed: shotFailures.length,
      shotsWithHorizontalOverflow: shots.filter((s) => s.metrics && s.metrics.horizontalOverflowPx > 0).length,
      pagesScrollingBelowFold: shots.filter((s) => s.metrics && s.metrics.scrollHeight > s.height + 40).length,
    },
    gate,
  };

  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8' });
  writeFileSync(REPORT_PATH, buildReport(manifest), { encoding: 'utf8' });

  console.log('');
  console.log(`截图 ${shots.length}/${EXPECTED.shots} · URL ${discovery.urls.length}/${EXPECTED.urls} · 最小 ${fmtBytes(gate.minBytesActual)} (${minBytesName}) · 模式 ${manifest.captureMode}${STRICT ? ' · --strict' : ''}`);
  console.log(
    `原始：pageerror ${gate.pageErrors} · console.error ${gate.consoleErrors} · requestfailed ${gate.requestFailures} · http>=400 ${gate.httpErrors}`,
  );
  console.log(
    `分层：已申报基线 ${gate.knownBaselineCount} 条 · 意外 ${gate.unexpected.pageErrors + gate.unexpected.consoleErrors + gate.unexpected.requestFailures + gate.unexpected.httpErrors} 条`,
  );
  if (gate.knownBaseline.length > 0) {
    console.log('');
    console.log('已申报基线问题（不计入闸门，但必须被人看见）：');
    for (const b of gate.knownBaseline) {
      console.log(`  [${b.id}] ${b.count} 条 —— ${b.reason}`);
      for (const e of b.events.slice(0, 4)) console.log(`      ${e.file} | ${e.kind} | ${e.status ?? ''} ${e.url || e.text}`);
    }
    console.log('  （`--strict` 可让它们照常算失败）');
  }
  if (!gate.ok) {
    console.error('');
    console.error(`❌ ${violations.length} 条闸门不过：`);
    for (const v of violations) console.error(`  - ${v}`);
    if (allRequestFailures.length > 0) {
      console.error('');
      console.error('requestfailed 原文：');
      for (const e of allRequestFailures) console.error(`  ${e.method} ${e.url}  ->  ${e.errorText}`);
    }
    if (allHttpErrors.length > 0) {
      console.error('');
      console.error('HTTP >=400 原文：');
      for (const e of allHttpErrors) console.error(`  ${e.status} ${e.url}`);
    }
    if (allPageErrors.length > 0) {
      console.error('');
      console.error('pageerror 原文：');
      for (const e of allPageErrors) console.error(`  ${e.message}`);
    }
    if (allConsoleErrors.length > 0) {
      console.error('');
      console.error('console.error 原文：');
      for (const e of allConsoleErrors) console.error(`  ${e.text}`);
    }
    process.exitCode = 1;
    return;
  }

  const totalBytes = shots.reduce((n, s) => n + s.bytes, 0);
  console.log(`✅ 全绿 · 累计 ${fmtBytes(totalBytes)} · manifest.json / report.md 已落盘`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => {
    console.error(`❌ shoot.mjs 未捕获异常：${(err && err.stack) || err}`);
    process.exitCode = 1;
  });
}

// 供 V-3 / 自检脚本复用（不入 verify 链）。只导出纯函数与常量，不导出 fs 东西。
// ⚠️ discoverUrls 本身就是 `export function`，不要再列进来（会 Duplicate export 报错）。
export { collectIndexHtml, segmentsToRoute, routeToSlug, EXPECTED, VIEWPORTS, BASE_URL, SHOTS_DIR, MANIFEST_PATH, REPORT_PATH, KNOWN_BASELINE };
