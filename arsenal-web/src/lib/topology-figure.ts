import { escapeXml } from './arch-diagram';

/**
 * 形态图元模型 —— 「每种形态长什么样」的唯一实现处，`topologyModeSvg()` 的本体。
 *
 * 为什么要有这个文件（《部署形态动画化计划》D3）：
 *   旧 `topologyModeSvg()` 是一个 `switch (modeId)` 直接吐 SVG 字符串 ——
 *   没有节点、没有边、没有 id，剧本想说「点亮主→从这条复制边」无从引用。
 *   现在拆成两段：**先产图元**（`buildTopologyModeFigure()`：nodes[] + edges[] + 绘制序列），
 *   **再渲染**（`renderTopologyFigure()`：只认图元，不认识任何具体形态）。
 *   `topologyModeSvg()` 变成两行薄封装，**签名不变** ——
 *   TopologyPicker 迷你图与 buildTopologySvg 卡片两处消费零改动，
 *   【17】的视觉断言与【22】的逐字符快照都不该被这次重构震到。
 *
 * 逐字符约束：几何与元素顺序与重构前**完全一致**（快照 fixture：
 * `.verify/fixtures/topology-mode-snapshots.json`，13 个 modeId / 18 个用例）。
 * 要改几何：先重跑快照生成并在提交说明里给出理由 —— 悄悄变形是本文件最大的风险。
 */

// ── 调色板（原 topology.ts 原样搬来）────────────────────────────

export interface TopoPalette {
  bg0: string; bg1: string; grid: string;
  card: string; cardLine: string;
  title: string; sub: string; faint: string;
  accent: string; accentSoft: string; line: string;
}

const TOPO_DARK: TopoPalette = {
  bg0: '#0A0F0E', bg1: '#111A19', grid: 'rgba(255,255,255,0.035)',
  card: '#16211F', cardLine: 'rgba(255,255,255,0.10)',
  title: '#EAF2F0', sub: '#9BAFB0', faint: '#6A7F80',
  accent: '#D9A441', accentSoft: 'rgba(217,164,65,0.14)', line: '#5C7C78',
};
const TOPO_LIGHT: TopoPalette = {
  bg0: '#F6F8F7', bg1: '#EDF2F1', grid: 'rgba(20,40,40,0.045)',
  card: '#FFFFFF', cardLine: 'rgba(20,50,50,0.14)',
  title: '#12211F', sub: '#5B6F6E', faint: '#8A9C9B',
  accent: '#8A6A1F', accentSoft: 'rgba(138,106,31,0.10)', line: '#6B8A86',
};
const TOPO_BLUEPRINT: TopoPalette = {
  bg0: '#0B2447', bg1: '#061A33', grid: 'rgba(255,255,255,0.07)',
  card: 'rgba(10,36,70,0.9)', cardLine: 'rgba(150,220,255,0.42)',
  title: '#EAF6FF', sub: '#9FC8E8', faint: '#7BA6C9',
  accent: '#8FD4FF', accentSoft: 'rgba(143,212,255,0.14)', line: '#8FD4FF',
};

export function topologyPalette(theme: string | undefined): TopoPalette {
  if (theme === 'light' || theme === 'doc') return TOPO_LIGHT;
  if (theme === 'blueprint') return TOPO_BLUEPRINT;
  return TOPO_DARK;
}

export const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
export const MONO = "'Cascadia Code','JetBrains Mono',Consolas,monospace";

function rr(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── 图元模型 ──────────────────────────────────────────────────
// nodes[] / edges[] 带 id，是剧本（topology_flows）可以引用的词汇表；
// paint[] 是**绘制序列**：SVG 是一维的，重叠与连线顺序本身就是几何的一部分，
// 所以渲染顺序必须由模型显式给出，而不是让渲染器按类型分组重排 ——
// 后者会让「重构前后逐字符一致」变成不可能。

export interface TopoFigureNode {
  id: string;
  /** 空字符串 = 画一个不带文字的方块（分片格子 / 叠层空卡） */
  label: string;
  x: number; y: number; w: number; h: number;
  /** 金色实心强调（主节点 / 稳定版 / Proxy） */
  strong?: boolean;
  /** 虚线边框（温冷数据 / 灰度版） */
  dashed?: boolean;
}

export interface TopoFigureEdge {
  id: string;
  /** from/to 是图元引用（给剧本用），坐标显式给出 —— 形态图的几何全是手工排的 */
  from: string; to: string;
  x1: number; y1: number; x2: number; y2: number;
  dashed?: boolean;
  arrow?: boolean;
}

/** 非节点 / 非边的绘制元素：旁注文字与装饰路径 */
export type TopoFigureMark =
  | { t: 'node'; id: string }
  | { t: 'edge'; id: string }
  | { t: 'text'; text: string; x: number; y: number; mono?: boolean; anchor?: 'middle'; tone?: 'faint' | 'accent' }
  | { t: 'deco'; d: string };

export interface TopoFigureModel {
  modeId: string;
  nodes: TopoFigureNode[];
  edges: TopoFigureEdge[];
  paint: TopoFigureMark[];
}

// ── 渲染（与重构前 box()/link()/各 text 的输出逐字符一致）──────

function nodeSvg(n: TopoFigureNode, p: TopoPalette): string {
  return (
    `<rect x="${rr(n.x)}" y="${rr(n.y)}" width="${rr(n.w)}" height="${rr(n.h)}" rx="6" ` +
    `fill="${n.strong ? p.accentSoft : p.card}" stroke="${n.strong ? p.accent : p.cardLine}" ` +
    `stroke-width="1"${n.dashed ? ' stroke-dasharray="4 3"' : ''}/>` +
    (n.label
      ? `<text x="${rr(n.x + n.w / 2)}" y="${rr(n.y + n.h / 2 + 4)}" font-family="${FONT}" font-size="10" ` +
        `text-anchor="middle" fill="${n.strong ? p.accent : p.sub}">${escapeXml(n.label)}</text>`
      : '')
  );
}

function edgeSvg(e: TopoFigureEdge, p: TopoPalette): string {
  return (
    `<path d="M${rr(e.x1)} ${rr(e.y1)} L${rr(e.x2)} ${rr(e.y2)}" fill="none" stroke="${p.line}" ` +
    `stroke-width="1.3"${e.dashed ? ' stroke-dasharray="4 3"' : ''}` +
    `${e.arrow ? ` marker-end="url(#tp-ar)"` : ''}/>`
  );
}

function markSvg(m: TopoFigureMark, p: TopoPalette): string {
  if (m.t === 'text') {
    return (
      `<text x="${rr(m.x)}" y="${rr(m.y)}" font-family="${m.mono ? MONO : FONT}" font-size="10" ` +
      `${m.anchor ? `text-anchor="${m.anchor}" ` : ''}` +
      `fill="${m.tone === 'accent' ? p.accent : p.faint}">${escapeXml(m.text)}</text>`
    );
  }
  if (m.t === 'deco') {
    return (
      `<path d="${m.d}" fill="none" stroke="${p.accent}" stroke-width="1.2" stroke-dasharray="3 3"/>`
    );
  }
  return '';
}

/** 把图元模型渲染成 SVG 片段（不含 <svg> 外壳 —— 与重构前的返回口径一致） */
export function renderTopologyFigure(m: TopoFigureModel, p: TopoPalette): string {
  const out: string[] = [];
  for (const mark of m.paint) {
    if (mark.t === 'node') {
      const n = m.nodes.find((x) => x.id === mark.id);
      if (n) out.push(nodeSvg(n, p));
    } else if (mark.t === 'edge') {
      const e = m.edges.find((x) => x.id === mark.id);
      if (e) out.push(edgeSvg(e, p));
    } else {
      out.push(markSvg(mark, p));
    }
  }
  return out.join('');
}

// ── 布局：13 种形态的图元（几何 = 重构前 switch 的逐分支移植）──

export function buildTopologyModeFigure(
  modeId: string,
  replicas: number,
  x: number,
  y: number,
  w: number,
  h: number,
  shardCount = 4
): TopoFigureModel {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const BW = 62;
  const BH = 30;

  const nodes: TopoFigureNode[] = [];
  const edges: TopoFigureEdge[] = [];
  const paint: TopoFigureMark[] = [];

  const node = (
    id: string, label: string,
    nx: number, ny: number, nw: number, nh: number,
    opts: { strong?: boolean; dashed?: boolean } = {}
  ): void => {
    nodes.push({ id, label, x: nx, y: ny, w: nw, h: nh, ...opts });
    paint.push({ t: 'node', id });
  };
  const edge = (
    id: string, from: string, to: string,
    x1: number, y1: number, x2: number, y2: number,
    opts: { dashed?: boolean; arrow?: boolean } = {}
  ): void => {
    edges.push({ id, from, to, x1, y1, x2, y2, ...opts });
    paint.push({ t: 'edge', id });
  };
  const text = (
    txt: string, tx: number, ty: number,
    opts: { mono?: boolean; anchor?: 'middle'; tone?: 'faint' | 'accent' } = {}
  ): void => {
    paint.push({ t: 'text', text: txt, x: tx, y: ty, ...opts });
  };
  const deco = (d: string): void => {
    paint.push({ t: 'deco', d });
  };
  /** 一排方块 + 中间的短连线（绘制顺序与旧 row() 完全一致：块线相间） */
  const row = (ids: string[], yy: number, strongFirst = false): void => {
    const n = ids.length;
    const total = n * BW + (n - 1) * 14;
    let bx = cx - total / 2;
    ids.forEach((label, i) => {
      node(`${modeId}-row-${i}`, label, bx, yy - BH / 2, BW, BH, { strong: strongFirst && i === 0 });
      if (i < n - 1) edge(`${modeId}-row-l${i}`, `${modeId}-row-${i}`, `${modeId}-row-${i + 1}`, bx + BW, yy, bx + BW + 14, yy);
      bx += BW + 14;
    });
  };

  switch (modeId) {
    case 'single':
      node('inst', '1 实例', cx - BW / 2, cy - BH / 2, BW, BH, { strong: true });
      break;

    case 'masterslave':
      node('m', '主', cx - 96, cy - 30, 78, 30, { strong: true });
      node('s', '从', cx + 18, cy + 4, 78, 30, { strong: true });
      edge('m-s', 'm', 's', cx - 57 + 39, cy - 15, cx + 57 + 6, cy + 19, { arrow: true });
      text('复制', cx + 46, cy - 20);
      break;

    case 'mgr':
    case 'cluster':
    case 'replicaset':
      // 历史坑（原 topology.ts 注释搬迁）：row() 自己负责把方块与连线按「块线相间」
      // 塞进绘制序列，它没有返回值 —— 旧实现若写成 o.push(row(...)) 只会塞进一个
      // undefined，join 化成空行，这几个形态就少画一半。现在 paint 序列由 node()/edge()
      // 直接写入，这条路已经堵死；【22】层的逐字符快照（mgr/cluster/replicaset 三例）守着它。
      row(['A', 'B', 'C'], cy - 6);
      deco(`M${rr(cx - 62)} ${rr(cy - 21)} A 62 26 0 0 1 ${rr(cx + 62)} ${rr(cy - 21)}`);
      text(modeId === 'mgr' ? '多数派写 / 自动选主' : '分片副本 / 心跳', cx, cy + 40, { anchor: 'middle' });
      break;

    case 'multiaz':
      node('az-a', '可用区 A', cx - 138, cy - 26, 108, 52);
      node('az-b', '可用区 B', cx + 30, cy - 26, 108, 52);
      edge('az-link', 'az-a', 'az-b', cx - 30, cy, cx + 30, cy, { dashed: true });
      text('跨区复制', cx, cy - 34, { anchor: 'middle' });
      break;

    case 'sharded': {
      const n = Math.max(1, Math.min(shardCount, 64));
      const cols = Math.min(4, n);
      const rows = Math.ceil(n / cols);
      const cw = 26, ch = 18, g = 5;
      const gridW = cols * cw + (cols - 1) * g;
      const gx = cx - gridW / 2 + 26;
      node('proxy', 'Proxy', cx - gridW / 2 - 76, cy - 16, 62, 32, { strong: true });
      for (let i = 0; i < n; i += 1) {
        const r0 = Math.floor(i / cols);
        const c0 = i % cols;
        node(`shard-${i}`, '', gx + c0 * (cw + g), cy - (rows * ch + (rows - 1) * g) / 2 + r0 * (ch + g), cw, ch);
      }
      edge('proxy-grid', 'proxy', 'shard-0', cx - gridW / 2 - 14, cy, cx - gridW / 2 + 14, cy, { arrow: true });
      text(`${n} 片`, cx + 12, cy - (rows * ch) / 2 - 8, { mono: true, tone: 'accent' });
      break;
    }

    case 'cloudnative':
      row(['T', 'T', 'T'], cy - 14);
      node('shared', '共享存储 / 分布式事务', cx - 108, cy + 16, 216, 20);
      break;

    case 'multilevel':
      node('l1', 'L1 本地', cx - 96, cy - 38, 76, 26, { strong: true });
      node('l2', 'L2 分布式', cx + 20, cy - 38, 76, 26, { strong: true });
      node('db', '数据库', cx - 38, cy + 10, 76, 26);
      edge('l1-db', 'l1', 'db', cx - 20, cy - 12, cx - 12, cy + 10, { arrow: true });
      edge('l2-db', 'l2', 'db', cx + 34, cy - 12, cx + 10, cy + 10, { arrow: true });
      break;

    case 'tiered': {
      const bands = ['热数据', '温数据', '冷数据'];
      bands.forEach((b, i) => {
        node(`band-${i}`, b, cx - 108, cy - 42 + i * 28, 216, 22, { dashed: i > 0, strong: i === 0 });
      });
      break;
    }

    case 'multi': {
      const n = Math.max(2, Math.min(replicas, 5));
      for (let i = n - 1; i >= 0; i -= 1) {
        node(`replica-${i}`, i === 0 ? '应用' : '', cx - 84 + i * 10, cy - 14 - i * 8, 96, 28, { strong: i === 0 });
      }
      break;
    }

    case 'canary':
      node('stable', '稳定版', cx - 112, cy - 18, 96, 36, { strong: true });
      node('gray', '灰度版', cx + 16, cy - 18, 96, 36, { dashed: true });
      text('按比例导流', cx + 64, cy + 36, { anchor: 'middle' });
      break;

    default: {
      const n = Math.max(1, Math.min(replicas, 5));
      row(Array.from({ length: n }, (_, i) => `${i + 1}`), cy, true);
      break;
    }
  }

  return { modeId, nodes, edges, paint };
}

/** 形态图形。**每种形态一张不同的图** —— 选择器迷你图与形态图卡片共用同一段几何。 */
export function topologyModeSvg(
  modeId: string,
  replicas: number,
  x: number,
  y: number,
  w: number,
  h: number,
  p: TopoPalette,
  shardCount = 4
): string {
  return renderTopologyFigure(buildTopologyModeFigure(modeId, replicas, x, y, w, h, shardCount), p);
}

// ── 机理剧本的自动布局 ────────────────────────────────────────
// 剧本节点只带 kind 不带坐标（显式 x/y 可选）——布局是「kind → 位置」的
// 纯函数：应用在最左，主在上排，从 / 存储在下排，缓存居中，代理靠左。
// 确定性：同输入同输出（同一 kind 的多个节点按声明顺序从左到右排开）。

export interface TopoFlowLayoutNode {
  id: string;
  label: string;
  kind: string;
  x: number; y: number; w: number; h: number;
}

export interface TopoFlowLayoutEdge {
  id: string;
  x1: number; y1: number; x2: number; y2: number;
}

export interface TopoFlowLayout {
  width: number;
  height: number;
  nodes: TopoFlowLayoutNode[];
  edges: TopoFlowLayoutEdge[];
}

const FLOW_NODE_W = 120;
const FLOW_NODE_H = 44;

/** kind → 行带（自上而下）：主 64 / 缓存·代理 128 / 从·存储 222（画布 560×300） */
const FLOW_ROW_Y: Record<string, number> = {
  primary: 64,
  cache: 128,
  proxy: 128,
  replica: 222,
  store: 222,
};

export function layoutFlowFigure(
  nodes: { id: string; label: string; kind: string; x?: number; y?: number }[],
  edges: { id: string; from: string; to: string }[],
  width = 560,
  height = 300
): TopoFlowLayout {
  const laid: TopoFlowLayoutNode[] = [];
  const centers = new Map<string, { x: number; y: number }>();
  const place = (box: TopoFlowLayoutNode) => centers.set(box.id, { x: box.x + box.w / 2, y: box.y + box.h / 2 });

  // 显式坐标优先；其余按 kind 归入行带，同带内按声明顺序排开
  const byRow = new Map<number, TopoFlowLayoutNode[]>();
  for (const n of nodes) {
    const box: TopoFlowLayoutNode = {
      id: n.id,
      label: n.label,
      kind: n.kind,
      w: FLOW_NODE_W,
      h: FLOW_NODE_H,
      x: n.x ?? 0,
      y: n.y ?? 0,
    };
    laid.push(box);
    if (n.x !== undefined && n.y !== undefined) {
      place(box);
      continue;
    }
    const rowY = FLOW_ROW_Y[n.kind] ?? Math.round(height / 2 - FLOW_NODE_H / 2);
    if (!byRow.has(rowY)) byRow.set(rowY, []);
    byRow.get(rowY)!.push(box);
  }
  const RIGHT_X0 = 210; // 应用列（最左）与组件区（右侧）的分界
  for (const [rowY, group] of byRow) {
    const total = group.length * FLOW_NODE_W + (group.length - 1) * 24;
    const startX = RIGHT_X0 + Math.max(0, (width - RIGHT_X0 - 24 - total) / 2);
    group.forEach((box, i) => {
      box.x = Math.round(startX + i * (FLOW_NODE_W + 24));
      box.y = rowY;
      place(box);
    });
  }
  // client / proxy 固定在左侧列（剧本没给显式坐标时）—— 先记待定位，再统一放
  const pendingLeft: TopoFlowLayoutNode[] = [];
  for (const box of laid) {
    if (!centers.has(box.id) && (box.kind === 'client' || box.kind === 'proxy')) pendingLeft.push(box);
  }
  pendingLeft.forEach((box, i) => {
    box.x = box.kind === 'client' ? 24 : 128;
    box.y = Math.round(height / 2 - FLOW_NODE_H / 2) + (pendingLeft.length > 1 ? (i - (pendingLeft.length - 1) / 2) * (FLOW_NODE_H + 18) : 0);
    place(box);
  });

  // 边 = 两端节点中心连线（线画在节点下层，端点收进方块里也看不见）
  const outEdges: TopoFlowLayoutEdge[] = [];
  for (const e of edges) {
    const a = centers.get(e.from);
    const b = centers.get(e.to);
    if (!a || !b) continue; // 悬空引用由 build 与【22】层拦，布局侧静默跳过
    outEdges.push({ id: e.id, x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }
  return { width, height, nodes: laid, edges: outEdges };
}
