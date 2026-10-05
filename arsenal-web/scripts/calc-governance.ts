/**
 * calc-governance.ts —— 把「治理台」的五块聚合在**构建期**算成一份产物。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 为什么要有这一步（不是直接在页面里算）
 *
 * 三个出口要讲同一件事，而它们跑在不同地方：
 *   · 页面   —— 静态导出，浏览器里算（能算，但**只有它能算**）
 *   · MCP    —— .mjs 跑在 AI 客户端里，**import 不了 .ts 的纯函数层**
 *   · CI     —— .mjs 执行器，同上
 * 于是如果把聚合逻辑留在页面里，MCP 与 CI 就只能「没有」或「再写一份」——
 * 后者本仓已经栽过三次（sync 的 cookbook 段、project-check【13】、判别口径）。
 *
 * 所以：**逻辑只有一份（src/lib/standards.ts），在本脚本里算一次，
 * 三个出口读同一份产物。** 这就是「一份数据三种出口」在跨语言/跨运行时上的做法。
 *
 * 跑法：`npm run sync` 链里自动执行（prebuild → predev 都会先跑它）。
 * 为什么能跑 tsx：sync 是 **npm 层**的 `&&` 链，不是 node 嵌套 spawn ——
 * 本环境 spawnSync(process.execPath) 会被沙箱拦成 EBUSY（Archify 那 3 项红就是这个原因）。
 *
 * 产物：`src/generated/governance.json`（gitignore 内，可重建）
 * 断言：`charter-check`【17】会验「产物与实时计算逐项一致」——
 * 产物过期是这类架构最典型的静默失效（页面显示上次的数字，没人会发现）。
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { actionItems, actionSummary, peopleView, areaRiskView, gateReadiness, timelineView } from '../src/lib/standards';
import type { CharterEntry } from '../src/lib/charter';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const genPath = path.join(webRoot, 'src', 'generated', 'governance.json');

/** 构建期固定判定日：可用 ARSENAL_TODAY 覆盖（复现历史结论用）。 */
const today = process.env.ARSENAL_TODAY ?? new Date().toISOString().slice(0, 10);

const snapPath = path.join(webRoot, 'src', 'generated', 'charter.json');
if (!fs.existsSync(snapPath)) {
  console.error('[calc-governance] 还没有 src/generated/charter.json —— 先跑 node scripts/sync-content.mjs');
  process.exit(2);
}
const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
const charters: CharterEntry[] = Array.isArray(snap.charters) ? snap.charters : [];

const perCharter = charters.map((entry) => {
  const doc = entry.doc;
  const items = actionItems(doc, today);
  const people = peopleView(doc, today);
  return {
    charterId: doc.id,
    charterName: doc.name,
    owner: doc.owner,
    team: doc.team,
    policy: doc.policy,
    actions: items,
    summary: actionSummary(items),
    people,
    areas: areaRiskView(doc, today),
    timeline: timelineView(doc, today, 12),
    readiness: gateReadiness(doc, today),
  };
});

const out = {
  schema: 'arsenal-governance/1',
  generatedAt: new Date().toISOString(),
  today,
  note: '本文件由 scripts/calc-governance.ts 生成，请勿手改。页面 / MCP / CI 读同一份，页面另有实时回落。',
  totals: {
    charters: perCharter.length,
    actions: perCharter.reduce((n, c) => n + c.actions.length, 0),
    p0: perCharter.reduce((n, c) => n + c.summary.p0, 0),
    p1: perCharter.reduce((n, c) => n + c.summary.p1, 0),
    p2: perCharter.reduce((n, c) => n + c.summary.p2, 0),
    outsiders: perCharter.reduce((n, c) => n + c.people.outsiders.length, 0),
  },
  charters: perCharter,
};

fs.mkdirSync(path.dirname(genPath), { recursive: true });
fs.writeFileSync(genPath, JSON.stringify(out, null, 2) + '\n', 'utf8');

console.log(
  `[calc-governance] 治理台产物已生成 · 判定日 ${today} · 章程 ${perCharter.length} 份 · `
  + `待办 ${out.totals.actions}（P0 ${out.totals.p0} / P1 ${out.totals.p1} / P2 ${out.totals.p2}）· `
  + `离队 ${out.totals.outsiders} 人 → src/generated/governance.json`,
);
