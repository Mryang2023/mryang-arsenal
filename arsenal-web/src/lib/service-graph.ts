/**
 * facts.services → 服务调用图 SVG（纯函数，零 React，不碰 DOM）。
 *
 * 与 `arch-canvas.ts` / `arch-layered.ts` 同款性质：模型在 `service-topo.ts`
 * （唯一关联实现），这里只负责画。**渲染器不许改判据** —— 图上少一条边，
 * 一定是模型里没有，不是这儿过滤掉的。
 *
 * 三条刻意的规矩：
 *   ① **无证据不画边**：画 `topo.edges`（feign / depends_on，两端都带 file:line）
 *      与 `topo.externals`（目标在声明之外，点线区分）。外部目标画成虚线框节点，
 *      ingress 画成单元上的徽标（nginx 不是服务，不占节点）。
 *      点线是必要的视觉词汇：depends_on 指向的 mysql 就在本项目 compose 里，
 *      而 feign 指向的 inventory-service 任何声明里都没有 —— 画成同一种线，
 *      看页面的人会把「声明之内的依赖」和「声明之外的调用」看成一回事。
 *   ② **确定性布局**：按名排序的网格，不上物理引擎 —— 同输入必得同一张图
 *      （「扫两次逐字节相等」那类断言的前提）。
 *   ③ **空也是结论**：没有声明之内的边时图上明说，且分清「什么都没读到」与
 *      「读到了、但目标在声明之外」—— 后者说成「都没读到」就是假话
 *      （2026-10-12 demo-repo 实测：0 条内部边 + 1 个外部目标，旧文案两句都谎）。
 */

import { FONT, MONO, themePalette, type CanvasTheme } from '@/lib/arch-canvas';
import { escapeXml } from '@/lib/arch-diagram';
import type { ServiceTopo } from '@/lib/service-topo';

export interface ServiceGraphOpts {
  title?: string;
  subtitle?: string;
  /** 副标题第二行（外部目标从句等）—— 有它时头部加高，没有时图高不变 */
  subtitle2?: string;
}

/** 网格单元格：固定尺寸 + 固定间距，坐标全是算出来的，没有一处随机 */
const CELL_W = 176;
const CELL_H = 68;
const GAP_X = 44;
const GAP_Y = 40;
const PAD = 30;
const HEAD_H1 = 64; // 单行副标题的头部高度
const HEAD_H2 = 82; // 两行副标题的头部高度（副标题2 存在时）
const FOOT_H = 46;
/** 画布宽度下限：图例三项（右端约 369px）与脚注行放得下的最小宽度。
 *  单单元图按公式只有 236px，不放宽则图例/脚注必被画布切掉（2026-10-12 实测）。 */
const MIN_W = 440;

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * 文字宽度估算 → 超宽截断加省略号。没有 DOM 量不了真实宽度，但**截断本身必须确定**：
 * 同输入必得同一张图。全量文本进 <title>（tooltip / 下载后 hover 可见）。
 * 系数按 Edge 实测校准（2026-10-12）：CJK 全角 ≈ 1.05em，一般标点/箭头 ≈ 0.9em，
 * 拉丁数字 ≈ 0.6em。**宁可多算不可少算** —— 少算的那个字符会被画布边界切掉。
 */
function fitText(s: string, fontSize: number, maxW: number): string {
  const w = (t: string) =>
    [...t].reduce((acc, ch) => {
      const cp = ch.codePointAt(0)!;
      return acc + (cp > 0x2e7f ? fontSize * 1.05 : cp > 0x2000 ? fontSize * 0.9 : fontSize * 0.6);
    }, 0);
  if (w(s) <= maxW) return s;
  const ell = '…';
  let out = '';
  for (const ch of s) {
    if (w(out + ch + ell) > maxW) break;
    out += ch;
  }
  return out + ell;
}

interface GNode {
  id: string;
  label: string;
  sub: string;
  kind: 'unit' | 'external' | 'infra';
  /** ingress 徽标（nginx upstream 原文，如 `order-service:8081`） */
  ingress: string[];
  x: number;
  y: number;
}

/** 边在节点边框上的附着点：按目标相对源的方向选边，网格布局下不会穿过节点本体 */
function attach(s: GNode, t: GNode): { x1: number; y1: number; x2: number; y2: number } {
  const scx = s.x + CELL_W / 2;
  const scy = s.y + CELL_H / 2;
  const tcx = t.x + CELL_W / 2;
  const tcy = t.y + CELL_H / 2;
  if (tcx > scx + CELL_W) return { x1: s.x + CELL_W, y1: scy, x2: t.x, y2: tcy };
  if (tcx < scx - CELL_W) return { x1: s.x, y1: scy, x2: t.x + CELL_W, y2: tcy };
  if (tcy > scy) return { x1: scx, y1: s.y + CELL_H, x2: tcx, y2: t.y };
  return { x1: scx, y1: s.y, x2: tcx, y2: t.y + CELL_H };
}

/**
 * 服务调用图。入参只有 `ServiceTopo` 与主题 —— 不读 facts、不读时钟。
 * 调用方（`buildAutopsy`）负责把标题/副标题算好传进来。
 */
export function buildServiceGraphSvg(
  topo: ServiceTopo,
  theme: CanvasTheme = 'dark',
  opts: ServiceGraphOpts = {}
): string {
  const p = themePalette(theme);
  const title = opts.title ?? '服务调用图';
  const subtitle = opts.subtitle ?? '';
  const subtitle2 = opts.subtitle2 ?? '';
  const HEAD_H = subtitle2 ? HEAD_H2 : HEAD_H1;

  // ── 节点集：服务单元 + 外部目标 + 边上出现的基础设施名 ──
  const nodes = new Map<string, GNode>();
  const put = (n: GNode) => {
    if (!nodes.has(n.id)) nodes.set(n.id, n);
  };
  for (const u of topo.units) {
    put({
      id: u.name,
      label: u.name,
      sub: u.codeOnly ? '仅代码 · 无部署声明' : `${u.sources.length} 处声明 · ${u.entries.length} 个入口`,
      kind: 'unit',
      ingress: topo.ingress.filter((i) => i.unit === u.name).map((i) => i.upstream),
      x: 0,
      y: 0,
    });
  }
  for (const e of topo.externals) {
    put({ id: `ext:${e.target}`, label: e.target, sub: '外部目标', kind: 'external', ingress: [], x: 0, y: 0 });
  }
  // 统一边表：声明之内的调用（实线/虚线）+ 指向声明之外的目标（点线）。
  //    节点合成也走这张表 —— 外部调用的 from 同样可能是 '(未归属)'，
  //    只遍历 topo.edges 会漏掉它，那条边就连了个不存在的节点、被静默丢掉。
  const allEdges: { from: string; to: string; kind: string; external: boolean }[] = [
    ...topo.edges.map((e) => ({ from: e.from, to: e.to, kind: e.kind, external: false })),
    ...topo.externals.map((e) => ({ from: e.from, to: e.target, kind: e.kind, external: true })),
  ];
  // 边的两端必须都有节点，否则这条边会被静默画不出来 —— 「模型里有、图上没有」
  // 比不画更糟（看页的人以为没有这条调用）。未知端点按性质补：
  //   from = '(未归属)' → 归属不上的来源；to = 基础设施名（depends_on 常见）
  for (const edge of allEdges) {
    if (!nodes.has(edge.from) && !topo.units.some((u) => u.name === edge.from)) {
      put({
        id: edge.from,
        label: edge.from,
        sub: edge.from === '(未归属)' ? '路由/客户端归属不上' : '来源未解析',
        kind: 'external',
        ingress: [],
        x: 0,
        y: 0,
      });
    }
    if (!edge.external && !nodes.has(edge.to) && !topo.units.some((u) => u.name === edge.to)
        && !topo.externals.some((x) => x.target === edge.to)) {
      put({ id: `infra:${edge.to}`, label: edge.to, sub: '基础设施', kind: 'infra', ingress: [], x: 0, y: 0 });
    }
  }

  const list = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(Math.max(1, list.length)))));
  const rows = Math.max(1, Math.ceil(list.length / cols));
  list.forEach((n, i) => {
    n.x = PAD + (i % cols) * (CELL_W + GAP_X);
    n.y = HEAD_H + Math.floor(i / cols) * (CELL_H + GAP_Y);
  });
  const W = Math.max(MIN_W, PAD * 2 + cols * CELL_W + (cols - 1) * GAP_X);
  const H = HEAD_H + rows * CELL_H + (rows - 1) * GAP_Y + FOOT_H;

  const o: string[] = [];
  o.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r1(W)}" height="${r1(H)}" viewBox="0 0 ${r1(W)} ${r1(H)}" ` +
      `font-family="${FONT}">`
  );
  o.push(`<rect width="${r1(W)}" height="${r1(H)}" fill="${p.bg0}"/>`);
  o.push(
    `<text x="${PAD}" y="34" font-size="19" font-weight="700" fill="${p.title}">${escapeXml(fitText(title, 19, W - PAD * 2))}<title>${escapeXml(title)}</title></text>`
  );
  // 副标题：窄图（单单元 236px）放不下整行 —— 估算宽度截断，全文进 <title>。
  // 截断而不是溢出：SVG 没有换行，溢出的部分会被画布边界切掉，那才是真丢信息。
  if (subtitle) {
    o.push(
      `<text x="${PAD}" y="52" font-size="11" fill="${p.sub}">${escapeXml(fitText(subtitle, 11, W - PAD * 2))}<title>${escapeXml(subtitle)}</title></text>`
    );
  }
  if (subtitle2) {
    o.push(
      `<text x="${PAD}" y="68" font-size="11" fill="${p.sub}">${escapeXml(fitText(subtitle2, 11, W - PAD * 2))}<title>${escapeXml(subtitle2)}</title></text>`
    );
  }

  // ── 边（先画，节点后画盖住线头）──
  const markers =
    `<defs>` +
    `<marker id="sg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
    `<path d="M0,0 L10,5 L0,10 z" fill="${p.edge}"/></marker>` +
    `<marker id="sg-arrow-d" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
    `<path d="M0,0 L10,5 L0,10 z" fill="${p.edgeDashed}"/></marker>` +
    `</defs>`;
  o.push(markers);
  const edgeLines: string[] = [];
  for (const e of allEdges) {
    const s = nodes.get(e.from) ?? nodes.get(`ext:${e.from}`) ?? nodes.get(`infra:${e.from}`);
    const t = e.external
      ? nodes.get(`ext:${e.to}`)
      : nodes.get(e.to) ?? nodes.get(`ext:${e.to}`) ?? nodes.get(`infra:${e.to}`);
    if (!s || !t) continue; // 两端有一端不在节点集里 = 模型没给全，不猜
    const { x1, y1, x2, y2 } = attach(s, t);
    // 线型三档：实线 = 单元间 feign；5 4 虚线 = depends_on（目标在本项目声明里）；
    // 1 3 点线 = 指向声明之外的目标。样式即语义，不靠看图的人猜。
    const dash = e.external ? '1 3' : e.kind === 'depends_on' ? '5 4' : null;
    const stroke = e.external ? p.edgeDashed : e.kind === 'depends_on' ? p.edgeDashed : p.edge;
    edgeLines.push(
      `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" ` +
        `stroke="${stroke}" stroke-width="1.4" ` +
        `${dash ? `stroke-dasharray="${dash}"` : ''} marker-end="url(#${dash ? 'sg-arrow-d' : 'sg-arrow'})"/>`
    );
    // 边类型标注：画在连线中点，底色用节点底，压线也读得清
    const mx = r1((x1 + x2) / 2);
    const my = r1((y1 + y2) / 2 - 5);
    const w = r1(e.kind.length * 6.4 + 10);
    edgeLines.push(
      `<rect x="${r1(mx - w / 2)}" y="${r1(my - 9)}" width="${w}" height="14" rx="3" fill="${p.labelBg}" stroke="${p.cardLine}" stroke-width="0.6"/>` +
        `<text x="${mx}" y="${r1(my + 1.5)}" font-family="${MONO}" font-size="9" fill="${p.labelFg}" text-anchor="middle">${escapeXml(e.kind)}</text>`
    );
  }
  o.push(`<g>${edgeLines.join('')}</g>`);

  // ── 节点 ──
  for (const n of list) {
    const dashed = n.kind === 'external';
    const fill = n.kind === 'unit' ? p.card : n.kind === 'infra' ? p.chipBg : p.bg1;
    const stroke = n.kind === 'unit' ? p.cardLine : dashed ? p.edgeDashed : p.chipFg;
    o.push(
      `<g><title>${escapeXml(n.label)}</title>` +
        `<rect x="${r1(n.x)}" y="${r1(n.y)}" width="${CELL_W}" height="${CELL_H}" rx="7" ` +
        `fill="${fill}" stroke="${stroke}" stroke-width="1.2" ${dashed ? 'stroke-dasharray="5 4"' : ''}/>` +
        `<text x="${r1(n.x + 12)}" y="${r1(n.y + 24)}" font-size="12.5" font-weight="700" fill="${p.title}">${escapeXml(truncate(n.label, 15))}</text>` +
        `<text x="${r1(n.x + 12)}" y="${r1(n.y + 41)}" font-family="${MONO}" font-size="9.5" fill="${p.faint}">${escapeXml(n.sub)}</text>` +
        (n.ingress.length
          ? `<text x="${r1(n.x + 12)}" y="${r1(n.y + 57)}" font-family="${MONO}" font-size="9" fill="${p.edge}">↗ nginx ${escapeXml(truncate(n.ingress.join(' , '), 17))}</text>`
          : '') +
        `</g>`
    );
  }

  // ── 没有声明之内的边时的明说（画一个只有节点的图 = 「调用关系没画完」的假象）──
  //    三种情况说三句话，不混为一谈：① 真的有外部调用（说清「读到了，目标在声明之外」）；
  //    ② 什么都没读到；③ 只有 nginx 转发（ingress 画在徽标上，不算边，但别说成「没读到」）。
  if (topo.edges.length === 0) {
    const cy = r1(HEAD_H + (rows * CELL_H + (rows - 1) * GAP_Y) / 2);
    const msg =
      topo.externals.length > 0
        ? `没有调用边：证据读到了，${topo.externals.length} 个目标在声明之外（点线 → 虚线框）`
        : topo.ingress.length > 0
          ? '未发现服务间调用证据（feign / depends_on 都没读到；nginx 转发见单元上的 ↗ 徽标）'
          : '未发现服务间调用证据（feign / depends_on / nginx 都没读到）';
    // 居中长文最容易被画布切两边 —— fitText 到「左右各留 10px」，全文进 <title>
    o.push(
      `<text x="${r1(W / 2)}" y="${cy}" font-size="12" fill="${p.faint}" text-anchor="middle">` +
        `${escapeXml(fitText(msg, 12, W - 20))}<title>${escapeXml(msg)}</title></text>`
    );
  }

  // ── 脚注图例（两行：样本行 + 备注行。窄图上把备注并到样本行会撞字）──
  //    两行都过 fitText：单单元图（MIN_W=440）也放不下「外部目标（声明之外的名字）」整句，
  //    溢出会被画布边界切掉 —— 截断 + <title> 至少信息不丢（2026-10-12 浏览器实测）。
  const ly = r1(H - 26);
  const ny = r1(H - 10);
  const legend3 = '外部目标（声明之外的名字）';
  const legend3Fit = fitText(legend3, 9.5, W - (PAD + 234) - 6);
  const note2 = '每条边都带 file:line 证据；点线 = 声明之外的目标；同输入必得同一张图';
  o.push(
    `<g font-family="${MONO}" font-size="9.5" fill="${p.faint}">` +
      `<line x1="${PAD}" y1="${ly - 4}" x2="${PAD + 26}" y2="${ly - 4}" stroke="${p.edge}" stroke-width="1.4"/>` +
      `<text x="${PAD + 32}" y="${ly}">feign 调用</text>` +
      `<line x1="${PAD + 104}" y1="${ly - 4}" x2="${PAD + 130}" y2="${ly - 4}" stroke="${p.edgeDashed}" stroke-width="1.4" stroke-dasharray="5 4"/>` +
      `<text x="${PAD + 136}" y="${ly}">depends_on</text>` +
      (legend3Fit
        ? `<rect x="${PAD + 216}" y="${ly - 11}" width="13" height="10" rx="2" fill="none" stroke="${p.edgeDashed}" stroke-width="1.1" stroke-dasharray="3 2"/>` +
          `<text x="${PAD + 234}" y="${ly}">${escapeXml(legend3Fit)}<title>${escapeXml(legend3)}</title></text>`
        : '') +
      `<text x="${PAD}" y="${ny}">${escapeXml(fitText(note2, 9.5, W - PAD * 2))}<title>${escapeXml(note2)}</title></text>` +
      `</g>`
  );
  o.push('</svg>');
  return o.join('');
}

/** 节点名超宽时截断加省略号，全名进 <title>（tooltip）—— 不换行、不撑破格子 */
function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}
