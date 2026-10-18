/**
 * 一次性 SSR 探针（2026-10-17 超级夜 · 图谱棒2）—— 跑完即删，不进 git。
 *
 * 三件事，浏览器 E2E 覆盖不到：
 *   ① issues 分支可达性：draft.issues 非空 → 渲染「形状校验未过」且不吐半张图
 *      （草稿形状被 buildProfileDraftFromFacts 兜底恒过，浏览器里构造不出这个态）；
 *   ② 计数同源正对照：SSR HTML 里的「N 条来自扫描 · M 条待你补」必须与
 *      buildProfileDraftFromFacts 现场算出的 filled / todos.length 逐字相等；
 *   ③ 组件不自卫：filled 字段写死成 999，页面就念 999 ——
 *      证明「计数诚实」靠的是上游字段（7-6 源码断言盯着），不是组件自己纠正。
 *
 * 跑法：node_modules/.bin/tsx visual/_e2e-six-ssr.mjs
 */
import { renderToString } from 'react-dom/server';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { buildProfileDraftFromFacts } from '../src/lib/profile-draft';
import * as SixViewsPanelMod from '../src/app/autopsy/SixViewsPanel';

/** tsx 的 interop 会把 default 包两层（m.default.default 才是组件函数）——三种形态都接 */
const SixViewsPanel =
  SixViewsPanelMod.default?.default ?? SixViewsPanelMod.default ?? SixViewsPanelMod;
if (typeof SixViewsPanel !== 'function') {
  console.error(`SixViewsPanel 解析失败：typeof=${typeof SixViewsPanel} keys=${Object.keys(SixViewsPanelMod).join(',')}`);
  process.exit(2);
}

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.workbuddy', 'night-chain', '2026-10-17');
const facts = JSON.parse(fs.readFileSync(path.join(OUT, '_e2e-demo-facts.json'), 'utf8'));

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
  console.log(`  ${cond ? '✓' : '✗'} ${name}${detail ? ` —— ${detail}` : ''}`);
}

const draft = buildProfileDraftFromFacts(facts);
const empty = {};

/** React SSR 在表达式子节点与文本之间插 <!-- --> 分隔标记 —— 匹配前先剥掉 */
const plain = (html) => html.replace(/<!-- -->/g, '');

// ── ② 计数同源正对照（正常草稿） ──
const okHtml = renderToString(createElement(SixViewsPanel, { draft, profileId: '__draft__', custom: empty }));
check('正常草稿：SSR HTML 含与 lib 现场算相等的 filled 计数',
  plain(okHtml).includes(`${draft.filled} 条来自扫描`), `期望含「${draft.filled} 条来自扫描」`);
check('正常草稿：SSR HTML 含与 lib 现场算相等的 todos 计数',
  plain(okHtml).includes(`${draft.todos.length} 条待你补`), `期望含「${draft.todos.length} 条待你补」`);
check('正常草稿：六视图 tab 行在（五张图可切）', plain(okHtml).includes('业务架构'));
check('正常草稿：不误报 issues（形状过的草稿不亮红）', !plain(okHtml).includes('形状校验未过'));
check('正常草稿：待补展开按钮带着条数（默认收起，条数先说）',
  plain(okHtml).includes(`展开 ${draft.todos.length} 条待补清单`));

// ── ① issues 分支（形状坏的假草稿） ──
const badDraft = { ...draft, issues: ['假形状问题：views.business 缺失（注入样本）'] };
const badHtml = renderToString(createElement(SixViewsPanel, { draft: badDraft, profileId: '__draft__', custom: empty }));
check('issues 非空：明确报错「形状校验未过」', plain(badHtml).includes('形状校验未过'));
check('issues 非空：报错列出每一条（不吞）', plain(badHtml).includes('假形状问题'));
// tab 行 / 头卡都不出现才算「没渲染半张图」（报错文案自身含「六视图」三字，不能拿它当判据）
check('issues 非空：不渲染半张图（无视图 tab 行与头卡）',
  !plain(badHtml).includes('业务架构') && !plain(badHtml).includes('核心关注'));
check('issues 非空：不渲染成熟度条（先修形状再看图）', !plain(badHtml).includes('条来自扫描'));

// ── ③ 组件不自卫（filled 写死 999 就念 999） ──
const lyingDraft = { ...draft, filled: 999 };
const lyingHtml = renderToString(createElement(SixViewsPanel, { draft: lyingDraft, profileId: '__draft__', custom: empty }));
check('写死不自卫证据：filled=999 时页面照念 999（计数诚实靠 7-6 源码断言守）',
  plain(lyingHtml).includes('999 条来自扫描') && !plain(lyingHtml).includes(`${draft.filled} 条来自扫描`));

// ── 内置档案路径（profileId 非草稿、无 custom） ──
const builtinHtml = renderToString(createElement(SixViewsPanel, { draft: null, profileId: 'arsenal', custom: empty }));
check('内置档案：SSR 可渲染（静态导出安全，构建期快照）', plain(builtinHtml).includes('杨先生的军火库'));
check('内置档案：无成熟度条（完整档案没有「待补」概念）', !plain(builtinHtml).includes('条来自扫描'));

const failed = results.filter((r) => !r.pass);
console.log(`\nSSR[sixviews] 结果：${results.length - failed.length}/${results.length} 过`);
if (failed.length > 0) process.exit(1);
