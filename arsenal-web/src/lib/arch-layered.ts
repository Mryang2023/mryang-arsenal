/**
 * facts → 应用分层架构图（链路 ②）—— 纯数据 + 手绘 SVG，零依赖。
 *
 * 与 `arch-canvas.ts` 的部署图互补：部署图答「跑起来长什么样」，这张图答
 * 「代码是怎么分层的」。版式是**横向五带**（客户端 → 接入层 → 应用层 → 领域层
 * → 数据层，左到右），调用方向从左往右。
 *
 * 三件必须守住的事：
 *
 *   ① **带的 id 是渲染器契约，不许漂。**`client / api / app / domain / data`
 *      这五个 id 被 `profile-draft.ts`（六视图草稿）与 `scan-check.ts`（断言）
 *      同时依赖，改了 id 不报错、只是图上少一栏。
 *   ② **每一个数字都能追回 facts。**类的条数来自 `code.layers`，注解条数来自
 *      `code.annotations`，数据存储来自技术命中（优先读部署模型里的节点）。
 *      读不到就是 `null`（「没读到」），不写 0 也不写 1 —— 0 会被读成「确实没有」。
 *   ③ **零条目不静默消失。**`layers` 里出现的每个分层键都必须落进某个带；
 *      落不进五带的（比如 `config`）在应用层里单独成一个条目，不并进别人的数字。
 *
 * 这张图最有价值的一笔是**跨带直连的红色警示线**：扫描器在 Controller 里认到
 * Repository / Dao / Mapper 类型的字段（Controller 绕过 Service 直接碰数据层），
 * 这是最典型的分层腐化，画成红色虚线比写进报告里显眼得多。
 */

import { themePalette, type CanvasTheme, type TechArch } from './arch-canvas';
import { escapeXml } from './arch-diagram';
import { SCAN_RULES } from './scan-rules';
import type { ProjectFacts } from './facts-arch';

// ─────────────────────────────────────────────────────────────
// 一、数据
// ─────────────────────────────────────────────────────────────

export type LayerBandId = 'client' | 'api' | 'app' | 'domain' | 'data';

/** 带内的一条计数。`infra` 的是「它连出去的对象」而不是代码单元，画法不同 */
export interface LayeredGroup {
  label: string;
  /** 条数。`null` = 扫描没读到（不是 0） */
  count: number | null;
  infra: boolean;
}

export interface LayeredBand {
  id: LayerBandId;
  /** 带名。渲染器直接印在图上，也是断言用的字面量 */
  name: string;
  desc: string;
  /** 这一带的**类数**（不含 infra 条目）。读不到为 null */
  total: number | null;
  groups: LayeredGroup[];
}

/** 正向调用的主干。画在相邻带之间 */
export interface LayeredEdge {
  from: LayerBandId;
  to: LayerBandId;
  label: string;
}

/** 跨带直连（`code.directCalls`）：from 绕过中间带直接持有 to */
export interface CrossCall {
  from: LayerBandId;
  to: LayerBandId;
  fromClass: string;
  toClass: string;
  file: string;
  /** 隔了几个带。>= 2 才是真正的「跨带」，画红色警示线 */
  hops: number;
  /* kind 恒为 repo —— 外部调用走 externals，不混进来 */
  kind: 'repo';
}

export interface LayeredArchData {
  bands: LayeredBand[];
  edges: LayeredEdge[];
  crossCalls: CrossCall[];
  /** 应用层对外调用的第三方 / 外部服务（`code.clientsUnique`） */
  externals: string[];
}

export const BAND_ORDER: LayerBandId[] = ['client', 'api', 'app', 'domain', 'data'];

const BAND_NAME: Record<LayerBandId, string> = {
  client: '客户端',
  api: '接入层',
  app: '应用层',
  domain: '领域层',
  data: '数据层',
};

/** 会被画成数据层 infra 条目的技术维度 */
const DATA_DIMS = new Set(['database', 'cache', 'objectstore', 'search', 'mq']);

function bandIndex(id: LayerBandId): number {
  return BAND_ORDER.indexOf(id);
}

/**
 * 类名 → 带。**按后缀判，不看包名**：包路径是可以随便起的，
 * 后缀（`*Controller` / `*Repository`）是工程惯例，误判率低得多。
 */
function bandOfClass(name: string): LayerBandId {
  if (/Controller$/.test(name)) return 'api';
  if (/(Repository|Dao|Mapper|Store)$/.test(name)) return 'data';
  if (/(ServiceImpl|Service)$/.test(name)) return 'app';
  if (/(Entity|Domain|Aggregate|ValueObject|VO)$/.test(name)) return 'domain';
  return 'app';
}

/** 数据层 infra 条目：优先用部署模型里真实存在的节点，保证两张图不打架 */
function dataStores(facts: ProjectFacts, arch?: TechArch): string[] {
  if (arch) {
    const fromModel = arch.nodes
      .filter((n) => n.kind !== 'app' && (n.zone === 'data' || n.zone === 'mw'))
      .map((n) => n.title);
    // 部署模型里一个存储节点都没有时，退回映射表 —— 否则「没上线」会被读成「没有数据存储」
    if (fromModel.length) return fromModel;
  }
  const out: string[] = [];
  for (const m of facts.techStack?.matched ?? []) {
    const rule = SCAN_RULES.find((r) => r.tech === m.tech && r.dim && DATA_DIMS.has(r.dim));
    if (rule && !out.includes(rule.name)) out.push(rule.name);
  }
  return out;
}

/** 计数为 0 的条目一律不列 —— 「× 0」看着像结论，其实只是这一带没有 */
function groups(entries: LayeredGroup[]): LayeredGroup[] {
  const kept = entries.filter((g) => g.infra || (g.count ?? 0) > 0);
  if (kept.length) return kept;
  return [{ label: '未发现', count: null, infra: false }];
}

/**
 * 把代码结构事实摊成五带 + 跨带直连。
 *
 * 只统计扫描器**直接读到的**：分层计数来自注解 / 类名后缀 / 包名（`code.layers`），
 * 跨带直连来自 `code.directCalls`，外部客户端来自 `code.clientsUnique`。
 * 读不到就不进任何带 —— 与事实层「不猜」的规矩一致。
 *
 * `arch` 可省：给了就用部署模型里的中间件/存储节点当数据层的 infra 条目，
 * 两张图因此不会各说各的。
 */
export function buildLayeredArch(facts: ProjectFacts, arch?: TechArch): LayeredArchData {
  const layers = facts.code?.layers ?? {};
  const ann = facts.code?.annotations ?? {};
  const fe = facts.frontend ?? { kind: null, deps: [], routes: [] };
  const routes = facts.code?.routes ?? [];

  const stores = dataStores(facts, arch);

  const bands: LayeredBand[] = [
    {
      id: 'client',
      name: BAND_NAME.client,
      desc: '浏览器 / 移动端 / 三方系统',
      total: fe.kind ? (fe.routes ?? []).length : null,
      groups: groups([
        fe.kind
          ? { label: `页面路由（${fe.kind}）`, count: (fe.routes ?? []).length, infra: false }
          : { label: '未发现前端（后端项目或服务端渲染）', count: null, infra: false },
      ]),
    },
    {
      id: 'api',
      name: BAND_NAME.api,
      desc: 'Controller —— 对外 HTTP 入口',
      total: layers.controller ?? null,
      groups: groups([
        { label: 'Controller', count: layers.controller ?? 0, infra: false },
        { label: '对外路由', count: routes.length, infra: false },
        { label: '@RestControllerAdvice', count: ann['@RestControllerAdvice'] ?? 0, infra: false },
      ]),
    },
    {
      id: 'app',
      name: BAND_NAME.app,
      desc: 'Service 与装配 —— 业务编排，也是 Config 类的落点',
      // Service 与 Config 都算应用层的类。两个键扫描器一个都没给 → null（没读到）
      total:
        layers.service === undefined && layers.config === undefined
          ? null
          : (layers.service ?? 0) + (layers.config ?? 0),
      groups: groups([
        { label: 'Service', count: layers.service ?? 0, infra: false },
        { label: 'Config', count: layers.config ?? 0, infra: false },
        { label: '@Scheduled', count: ann['@Scheduled'] ?? 0, infra: false },
        { label: '@Transactional', count: ann['@Transactional'] ?? 0, infra: false },
      ]),
    },
    {
      id: 'domain',
      name: BAND_NAME.domain,
      desc: '领域对象 / 实体 —— 不依赖任何一层',
      total: layers.domain ?? null,
      groups: groups([{ label: 'Domain / Entity', count: layers.domain ?? 0, infra: false }]),
    },
    {
      id: 'data',
      name: BAND_NAME.data,
      desc: 'Repository —— 持久化。数据存储是它连出去的对象，不计入类数',
      total: layers.repository ?? null,
      groups: [
        ...groups([{ label: 'Repository', count: layers.repository ?? 0, infra: false }]),
        ...stores.map((s): LayeredGroup => ({ label: s, count: null, infra: true })),
      ],
    },
  ];

  const edges: LayeredEdge[] = [
    { from: 'client', to: 'api', label: 'HTTP' },
    { from: 'api', to: 'app', label: '方法调用' },
    { from: 'app', to: 'domain', label: '领域对象' },
    { from: 'app', to: 'data', label: '持久化' },
  ];

  const crossCalls: CrossCall[] = [];
  for (const d of facts.code?.directCalls ?? []) {
    const from = bandOfClass(d.from);
    const to = bandOfClass(d.to);
    crossCalls.push({
      from,
      to,
      fromClass: d.from,
      toClass: d.to,
      file: d.file,
      hops: Math.abs(bandIndex(to) - bandIndex(from)),
      kind: 'repo',
    });
  }

  const externals = (facts.code?.clientsUnique ?? facts.code?.clients ?? [])
    .map((c) => c.target ?? c.kind)
    .filter((v, i, arr) => Boolean(v) && arr.indexOf(v) === i) as string[];

  return { bands, edges, crossCalls, externals };
}

// ─────────────────────────────────────────────────────────────
// 二、手绘 SVG
// ─────────────────────────────────────────────────────────────

const PAD = 26;
const CW = 176; // 带宽
const GAP = 56; // 带间距（留出连线标签的位置）
const HH = 46; // 带头部高（带名 + 小字说明）
const IBH = 30; // 条目方块高
const IBG = 10; // 条目间距
const EXT_W = 146;

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
const MONO = "'Cascadia Code','JetBrains Mono',Consolas,monospace";
const RED = '#E5484D';
const AMBER = '#E5A33D';
const ACCENTS = ['#5A9FD4', '#7FBF6A', '#D4A45A', '#9F7FC4', '#5FC4AF'];

/**
 * 渲染分层图。
 *
 * 主题只改颜色，不改任何几何 —— 与部署图同一套 `themePalette`，
 * 两张图贴进同一份文档时不会一深一浅。
 */
export function buildLayeredSvg(arch: LayeredArchData, theme: CanvasTheme = 'doc'): string {
  const p = themePalette(theme);
  const bands = arch.bands;
  const maxItems = Math.max(1, ...bands.map((b) => b.groups.length));
  const bodyH = maxItems * (IBH + IBG) + 12;
  const bandH = HH + bodyH;
  const bandTop = PAD;
  const bandBottom = bandTop + bandH;

  // 底部弧线车道：正向跨带（app→data）一条，每条红色警示线一条
  const violations = arch.crossCalls.filter((c) => c.hops >= 2);
  const arcY = (i: number) => bandBottom + 16 + i * 26;
  const arcLane = 24 + Math.max(1, violations.length + 1) * 26;

  const n = bands.length;
  const bandW = n * CW + (n - 1) * GAP;
  const externalX = PAD + bandW + GAP;
  const externalW = arch.externals.length ? EXT_W : 0;
  const W = externalX + externalW + PAD;
  const H = PAD * 2 + bandH + arcLane + 30; // 末 30 = 图例

  const xOf = (i: number) => PAD + i * (CW + GAP);
  const cxOf = (i: number) => xOf(i) + CW / 2;
  const idxOf = (id: LayerBandId) => bands.findIndex((b) => b.id === id);
  const bandCY = bandTop + HH + bodyH / 2;

  const o: string[] = [];
  o.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ` +
      `role="img" aria-label="${escapeXml('应用分层架构图')}">`
  );
  o.push(
    `<defs>` +
      `<linearGradient id="la-bg" x1="0" y1="0" x2="0.4" y2="1">` +
      `<stop offset="0" stop-color="${p.bg0}"/><stop offset="1" stop-color="${p.bg1}"/></linearGradient>` +
      `<marker id="la-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
      `<path d="M0 0 10 5 0 10 z" fill="${p.edge}"/></marker>` +
      `<marker id="la-arrow-r" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
      `<path d="M0 0 10 5 0 10 z" fill="${RED}"/></marker>` +
      `</defs>`
  );
  o.push(`<rect width="${W}" height="${H}" fill="url(#la-bg)"/>`);

  // ── 五带 ──
  bands.forEach((b, i) => {
    const x = xOf(i);
    const accent = ACCENTS[i % ACCENTS.length];
    o.push(
      `<rect x="${r(x)}" y="${r(bandTop)}" width="${r(CW)}" height="${r(bandH)}" rx="13" ` +
        `fill="${p.zone}" stroke="${p.zoneLine}" stroke-width="1"/>`
    );
    o.push(
      `<rect x="${r(x + 16)}" y="${r(bandTop)}" width="${r(Math.max(0, CW - 32))}" height="2.5" rx="1.25" ` +
        `fill="${accent}" opacity="0.6"/>`
    );
    o.push(
      `<text x="${r(x + 16)}" y="${r(bandTop + 21)}" font-family="${FONT}" font-size="13" font-weight="700" ` +
        `fill="${p.title}">${escapeXml(b.name)}</text>`
    );
    // 带内的类数：读不到写「—」，绝不写 0 —— 0 会被读成「确实没有」
    o.push(
      `<text x="${r(x + CW - 16)}" y="${r(bandTop + 21)}" text-anchor="end" font-family="${MONO}" ` +
        `font-size="12" font-weight="700" fill="${accent}">${b.total === null ? '—' : b.total}</text>`
    );
    o.push(
      `<text x="${r(x + 16)}" y="${r(bandTop + 37)}" font-family="${FONT}" font-size="9.5" ` +
        `fill="${p.faint}">${escapeXml(clip(b.desc, CW - 32, 9.5))}</text>`
    );

    b.groups.forEach((g, j) => {
      const iy = bandTop + HH + 8 + j * (IBH + IBG);
      const ibw = CW - 24;
      o.push(
        `<rect x="${r(x + 12)}" y="${r(iy)}" width="${r(ibw)}" height="${r(IBH)}" rx="8" ` +
          `fill="${p.card}" stroke="${g.infra ? p.zoneLine : p.cardLine}" stroke-width="1"` +
          `${g.infra ? ' stroke-dasharray="4 3"' : ''}/>`
      );
      o.push(
        `<text x="${r(x + 24)}" y="${r(iy + 19)}" font-family="${FONT}" font-size="11.5" ` +
          `fill="${g.infra ? p.sub : p.title}">${escapeXml(clip(g.label, ibw - 62, 11.5))}</text>`
      );
      o.push(
        `<text x="${r(x + CW - 24)}" y="${r(iy + 19)}" text-anchor="end" font-family="${MONO}" ` +
          `font-size="11" font-weight="700" fill="${g.infra ? p.faint : accent}">` +
          `${g.count === null ? '—' : `×${g.count}`}</text>`
      );
    });
  });

  // ── 相邻带的连线（带间标签就放在两条带中间那块空档里）──
  for (const e of arch.edges) {
    const i = idxOf(e.from);
    const j = idxOf(e.to);
    if (i < 0 || j < 0) continue;
    if (j === i + 1) {
      const x1 = xOf(i) + CW;
      const x2 = xOf(j);
      o.push(
        `<line x1="${r(x1)}" y1="${r(bandCY)}" x2="${r(x2 - 13)}" y2="${r(bandCY)}" ` +
          `stroke="${p.edge}" stroke-width="1.4" marker-end="url(#la-arrow)"/>`
      );
      o.push(
        `<text x="${r((x1 + x2) / 2)}" y="${r(bandCY - 8)}" text-anchor="middle" font-family="${FONT}" ` +
          `font-size="9.5" fill="${p.faint}">${escapeXml(e.label)}</text>`
      );
      continue;
    }
    if (j > i + 1) {
      // 跳过中间带的调用：走底部弧线，别从方块上碾过去
      const y = arcY(0);
      o.push(
        `<path d="M${r(cxOf(i))} ${r(bandBottom)} C ${r(cxOf(i))} ${r(y)}, ${r(cxOf(j))} ${r(y)}, ` +
          `${r(cxOf(j))} ${r(bandBottom)}" fill="none" stroke="${p.edge}" stroke-width="1.4" ` +
          `marker-end="url(#la-arrow)"/>`
      );
      o.push(label((cxOf(i) + cxOf(j)) / 2, y - 2, e.label, p.labelBg, p.labelFg, p.zoneLine));
    }
  }

  // ── 跨带直连：红色警示线 ──
  violations.forEach((c, i) => {
    const fi = idxOf(c.from);
    const ti = idxOf(c.to);
    if (fi < 0 || ti < 0) return;
    const y = arcY(i + 1);
    const x1 = cxOf(fi);
    const x2 = cxOf(ti);
    o.push(
      `<path d="M${r(x1)} ${r(bandBottom)} C ${r(x1)} ${r(y)}, ${r(x2)} ${r(y)}, ${r(x2)} ${r(bandBottom)}" ` +
        `fill="none" stroke="${RED}" stroke-width="1.7" stroke-dasharray="6 4" marker-end="url(#la-arrow-r)"/>`
    );
    o.push(label((x1 + x2) / 2, y - 2, `${c.fromClass} → ${c.toClass}`, p.labelBg, RED, RED));
  });

  // ── 外部 / 第三方（琥珀色框，条目来自 code.clientsUnique）──
  if (externalW) {
    o.push(
      `<rect x="${r(externalX)}" y="${r(bandTop)}" width="${r(externalW)}" height="${r(bandH)}" rx="12" ` +
        `fill="${p.zone}" stroke="${AMBER}" stroke-width="1" stroke-dasharray="5 4"/>`
    );
    o.push(
      `<text x="${r(externalX + 12)}" y="${r(bandTop + 21)}" font-family="${FONT}" font-size="11" ` +
        `font-weight="700" fill="${AMBER}">外部 / 第三方</text>`
    );
    arch.externals.slice(0, 8).forEach((name, i) => {
      const ey = bandTop + HH + 8 + i * (IBH + IBG);
      o.push(
        `<rect x="${r(externalX + 12)}" y="${r(ey)}" width="${r(externalW - 24)}" height="${r(IBH)}" rx="8" ` +
          `fill="${p.card}" stroke="${p.cardLine}" stroke-width="1"/>`
      );
      o.push(
        `<text x="${r(externalX + 24)}" y="${r(ey + 19)}" font-family="${FONT}" font-size="11" ` +
          `fill="${p.title}">${escapeXml(clip(name, externalW - 48, 11))}</text>`
      );
    });
  }

  // ── 图例 ──
  o.push(
    `<text x="${r(PAD)}" y="${r(H - 9)}" font-family="${FONT}" font-size="9.5" fill="${p.faint}">` +
      `灰线＝正常分层调用 · 红虚线＝跨带直连（Controller 直接持有数据层，应整改）· ` +
      `琥珀虚线框＝本图外部的第三方服务 · 虚线条目＝应用连出去的数据存储（不计入类数）` +
      ` · 数字全部来自代码扫描</text>`
  );

  o.push(`</svg>`);
  return o.join('\n');
}

function label(
  cx: number,
  cy: number,
  text: string,
  bg: string,
  fg: string,
  stroke: string
): string {
  const tw = Math.max(38, textW(text, 9.5) + 14);
  return (
    `<rect x="${r(cx - tw / 2)}" y="${r(cy - 9)}" width="${r(tw)}" height="18" rx="9" ` +
    `fill="${bg}" stroke="${stroke}" stroke-width="1"/>` +
    `<text x="${r(cx)}" y="${r(cy + 4)}" text-anchor="middle" font-family="${FONT}" ` +
    `font-size="9.5" fill="${fg}">${escapeXml(text)}</text>`
  );
}

function r(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 中文全角 ≈ 1em，ASCII ≈ 0.55em —— 与部署图同一套估算，两张图的裁剪手感一致 */
function textW(s: string, fontSize: number): number {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0x2e7f ? fontSize : fontSize * 0.55;
  return w;
}

function clip(s: string, maxPx: number, fontSize: number): string {
  if (textW(s, fontSize) <= maxPx) return s;
  let out = s;
  while (out.length > 1 && textW(`${out}…`, fontSize) > maxPx) out = out.slice(0, -1);
  return `${out}…`;
}
