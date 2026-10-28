import {
  arch,
  capLabel,
  capsOf,
  needsOf,
  nodeArch,
  slotsOfLane,
  type ArchAudit,
  type SlotState,
} from '../../src/lib/arch';
import { dimensions, presets } from '../../src/lib/stack';
import type { StackPicks } from '../../src/lib/content-types';

/**
 * 装配台的「图」层 —— 把一份选型变成一张有向图，并只在这张图上回答问题。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要独立一层：
 *
 * 装配台原来只回答「缺什么」（能力供需）。但读者真正会问的下一个问题是
 * 「我动了这一块，会连着谁」—— 那是**可达性**，不是列表能回答的。
 * arch-diagram.ts 负责把结果画成版式，这里负责算出事实；两者都是纯函数。
 *
 * ─────────────────────────────────────────────────────────────
 * 一条不可动摇的规矩：**两种边的性质完全不同，绝不能混着说。**
 *
 *   capability  依赖边。由选项自己声明的 provides / requires 推导出来：
 *               A 提供「缓存」，B 要「缓存」，于是 A → B。
 *               这是**事实** —— 拆掉 A，B 就真的拿不到缓存。
 *
 *   pipeline    版式边。由 architecture.json 的 pipelines 声明推导：
 *               同一泳道内，请求真正流经的顺序。
 *               这是**版式主张**，不是依赖事实 —— 它说明「画的顺序」，
 *               不说明「谁缺了谁就跑不了」。
 *
 * 所以每条边都带 kind，可达性查询默认**只走 capability 边**；
 * 路由探测会走两种边，但结果里用 usesLayout 标出来，界面必须区别显示。
 * 把版式边当成依赖说出去，就是在编造架构 —— 这个项目最不能犯的错。
 */

// ─────────────────────────────────────────────────────────────
// 模型
// ─────────────────────────────────────────────────────────────

export type EdgeKind = 'capability' | 'pipeline';

export interface GraphNode {
  dimId: string;
  laneId: string;
  /** 方块上的主标题：选中的选项名，未选时是「维度名（未选）」 */
  title: string;
  role: string;
  state: SlotState;
  /** 当前选项提供的能力 */
  provides: string[];
  /** 当前选项索要的能力 */
  requires: string[];
  /** 索要了、但当前组合里没人提供的能力 —— 缺口的来源 */
  unmet: string[];
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** capability 边承载的能力 id（同一对槽位可能由多条能力连起来） */
  caps: string[];
  /** pipeline 边所在泳道 */
  laneId?: string;
  /**
   * pipeline 边在泳道内的序号。
   * 与 arch-diagram.ts 画箭头时的下标同源 —— 交互层靠它精确点亮某一段流水线，
   * 而不是靠"第几条边"这种一改数据就错位的猜法。
   */
  pipeIndex?: number;
}

export interface GraphLane {
  id: string;
  name: string;
  glyph: string;
  /** 泳道内的槽位，按流水线顺序 */
  slots: string[];
}

export interface ArchGraph {
  nodes: GraphNode[];
  byDim: Map<string, GraphNode>;
  edges: GraphEdge[];
  /** dimId → 出边 / 入边（都只含 capability 与 pipeline，按 kind 自行过滤） */
  out: Map<string, GraphEdge[]>;
  in: Map<string, GraphEdge[]>;
  lanes: GraphLane[];
  /** 当前组合提供的全部能力 */
  providedCaps: Set<string>;
}

export type ReachMode = 'upstream' | 'downstream';

export interface ReachResult {
  mode: ReachMode;
  origin: string;
  /** 可达的槽位（**不含** origin 自己） */
  nodes: string[];
  /** 走过的边 */
  hops: GraphEdge[];
  /** 沿途涉及的能力 */
  caps: string[];
}

export interface Route {
  /** 含起点与终点的槽位序列 */
  nodes: string[];
  hops: GraphEdge[];
  caps: string[];
  /** 是否用到了版式边 —— 用到了就必须在界面上说明 */
  usesLayout: boolean;
}

export interface LaneLens {
  laneId: string;
  laneName: string;
  provides: string[];
  requires: string[];
  unmet: string[];
}

export interface LaneComparison {
  a: LaneLens;
  b: LaneLens;
  /** 能力面：只在一边被提供的 */
  providesOnlyA: string[];
  providesOnlyB: string[];
  providesShared: string[];
  /** 索求面：只在一边被索要的 */
  requiresOnlyA: string[];
  requiresOnlyB: string[];
  requiresShared: string[];
}

export interface Story {
  id: string;
  label: string;
  /**
   * 要聚焦的槽位。**允许为空** —— 「当前选择就是这套预设」时确实没有槽位可指，
   * 这时候图不该整片压暗，而是保持原样，由 note 说明原因。
   * 非空时，焦点必须是画布上真实存在的槽位。
   */
  focus: string[];
  note: string;
  /**
   * authored  来自 arsenal-stacks 里手写的预设 —— 是作者主张的取舍
   * computed  由当前组合算出来的缺口 / 隐患 —— 是事实，但会随选择变化
   * 界面上必须区分：把算出来的当预设讲，等于把结论伪装成主张。
   */
  source: 'preset' | 'computed';
}

// ─────────────────────────────────────────────────────────────
// 建图
// ─────────────────────────────────────────────────────────────

/** 画布上的槽位：有 nodeArch 声明的维度（= 17 个）。顺序跟 dimensions 一致。 */
function diagramDims() {
  return dimensions.filter((d) => !!nodeArch[d.id]);
}

export function buildArchGraph(picks: StackPicks, audit: ArchAudit): ArchGraph {
  const dims = diagramDims();

  // ── ① 节点：能力从「选中的那个选项」上取，不是从维度上取 ──
  const provided = new Set<string>();
  const nodes: GraphNode[] = dims.map((dim) => {
    const node = nodeArch[dim.id];
    const optId = picks[dim.id];
    const provides = optId ? capsOf(dim.id, optId) : [];
    const requires = optId ? needsOf(dim.id, optId) : [];
    for (const c of provides) provided.add(c);
    return {
      dimId: dim.id,
      laneId: node.lane,
      title: optId
        ? dim.options.find((o) => o.id === optId)?.name ?? optId
        : `${dim.name}（未选）`,
      role: node.role,
      state: audit.slotStates[dim.id] ?? 'empty',
      provides,
      requires,
      unmet: [],
    };
  });

  const byDim = new Map(nodes.map((n) => [n.dimId, n]));

  // ── ② 补 unmet：要了但没人提供 ──
  for (const n of nodes) {
    n.unmet = n.requires.filter((c) => !provided.has(c));
  }

  // ── ③ capability 边：谁提供了我索要的能力，谁就是我这一格的供给方 ──
  /** 能力 → 提供它的槽位（只算已选中的） */
  const providersOf = new Map<string, string[]>();
  for (const n of nodes) {
    for (const c of n.provides) {
      if (!providersOf.has(c)) providersOf.set(c, []);
      providersOf.get(c)!.push(n.dimId);
    }
  }

  const edges: GraphEdge[] = [];
  /** 同一对 (from,to) 的多条能力合并成一条边 —— 不然图上会出现重叠的并联箭头 */
  const capPair = new Map<string, GraphEdge>();

  for (const n of nodes) {
    for (const c of n.requires) {
      for (const p of providersOf.get(c) ?? []) {
        // 自己提供自己索要的能力不算依赖关系（例如 JPA 同时提供和使用 DataSource 语义）
        if (p === n.dimId) continue;
        const key = `${p}->${n.dimId}`;
        let edge = capPair.get(key);
        if (!edge) {
          edge = { from: p, to: n.dimId, kind: 'capability', caps: [] };
          capPair.set(key, edge);
          edges.push(edge);
        }
        if (!edge.caps.includes(c)) edge.caps.push(c);
      }
    }
  }

  // ── ④ pipeline 边：泳道内「请求真正流经」的顺序 ──
  //    判据必须与 arch-diagram.ts 的 pipelineCountOf **逐字一致**：
  //    只取 pipelines 里声明过、且确实属于该泳道的槽位；不足 2 个就整条不连。
  //    否则会出现「图上有这条边、画面上却没画箭头」的两份真相。
  //    pipeIndex 与画箭头时的下标同源，交互层用它定位要点亮的那一段。
  const laneList: GraphLane[] = [];
  for (const lane of arch.lanes) {
    const slots = slotsOfLane(lane.id);
    laneList.push({ id: lane.id, name: lane.name, glyph: lane.glyph, slots });
    const declared = arch.pipelines[lane.id];
    if (!declared) continue;
    const present = slots.filter((id) => byDim.has(id));
    const inLane = declared.filter((id) => present.includes(id));
    if (inLane.length < 2) continue;
    for (let i = 0; i + 1 < inLane.length; i += 1) {
      edges.push({
        from: inLane[i],
        to: inLane[i + 1],
        kind: 'pipeline',
        caps: [],
        laneId: lane.id,
        pipeIndex: i,
      });
    }
  }

  // ── ⑤ 邻接表（确定性：按 from 的维度声明顺序、再按 kind、再按 to）──
  const order = new Map(dims.map((d, i) => [d.id, i]));
  edges.sort((x, y) => {
    const fx = order.get(x.from)! - order.get(y.from)!;
    if (fx !== 0) return fx;
    if (x.kind !== y.kind) return x.kind === 'capability' ? -1 : 1;
    return order.get(x.to)! - order.get(y.to)!;
  });

  const out = new Map<string, GraphEdge[]>();
  const inc = new Map<string, GraphEdge[]>();
  for (const d of dims) {
    out.set(d.id, []);
    inc.set(d.id, []);
  }
  for (const e of edges) {
    out.get(e.from)!.push(e);
    inc.get(e.to)!.push(e);
  }

  return { nodes, byDim, edges, out, in: inc, lanes: laneList, providedCaps: provided };
}

// ─────────────────────────────────────────────────────────────
// 可达性：只走 capability 边
// ─────────────────────────────────────────────────────────────

/**
 * 追溯一个槽位的上游 / 下游**依赖**可达面。
 *
 * 上游 = 我（间接）依赖谁；下游 = 谁（间接）依赖我。
 * 刻意只走 capability 边：这是「拆了它会连带影响谁」的唯一诚实答案。
 */
export function reachFrom(graph: ArchGraph, dimId: string, mode: ReachMode): ReachResult {
  const hops: GraphEdge[] = [];
  const seen = new Set<string>([dimId]);
  const queue = [dimId];

  while (queue.length) {
    const cur = queue.shift()!;
    const next = mode === 'upstream' ? graph.in.get(cur) : graph.out.get(cur);
    for (const e of next ?? []) {
      if (e.kind !== 'capability') continue;
      hops.push(e);
      const other = mode === 'upstream' ? e.from : e.to;
      if (seen.has(other)) continue;
      seen.add(other);
      queue.push(other);
    }
  }

  seen.delete(dimId); // 不可自反：origin 永远不在自己的可达面里
  const caps = [...new Set(hops.flatMap((h) => h.caps))];
  return { mode, origin: dimId, nodes: [...seen], hops, caps };
}

// ─────────────────────────────────────────────────────────────
// 路由：走两种边，但如实标注
// ─────────────────────────────────────────────────────────────

/**
 * 两个槽位之间的最短有向通路，最多返回 maxRoutes 条等长路径。
 *
 * 与可达性的区别：路由同时走 capability 与 pipeline 边 —— 读者问的往往是
 * 「从接入层到数据库，请求到底怎么过去」，那是版式与依赖合起来才能回答的。
 * 代价是结果里混了两种性质，所以每条路径都带 usesLayout，用到了版式边就必须说明。
 */
export function routesBetween(
  graph: ArchGraph,
  from: string,
  to: string,
  maxRoutes = 3
): Route[] {
  if (from === to || !graph.byDim.has(from) || !graph.byDim.has(to)) return [];

  /** BFS 记录每个节点的最短距离，同时收集等长的前驱，避免漏掉并列最短路径 */
  const dist = new Map<string, number>([[from, 0]]);
  const preds = new Map<string, GraphEdge[]>();
  const queue = [from];

  while (queue.length) {
    const cur = queue.shift()!;
    const d = dist.get(cur)!;
    for (const e of graph.out.get(cur) ?? []) {
      const known = dist.get(e.to);
      if (known === undefined) {
        dist.set(e.to, d + 1);
        preds.set(e.to, [e]);
        queue.push(e.to);
      } else if (known === d + 1) {
        preds.get(e.to)!.push(e);
      }
    }
  }

  if (!dist.has(to)) return [];

  // 回溯所有最短路径
  const found: Route[] = [];
  const walk = (cur: string, acc: GraphEdge[]) => {
    if (found.length >= maxRoutes) return;
    if (cur === from) {
      const hops = [...acc].reverse();
      found.push({
        nodes: [from, ...hops.map((h) => h.to)],
        hops,
        caps: [...new Set(hops.flatMap((h) => h.caps))],
        usesLayout: hops.some((h) => h.kind === 'pipeline'),
      });
      return;
    }
    for (const e of preds.get(cur) ?? []) walk(e.from, [...acc, e]);
  };
  walk(to, []);

  return found;
}

// ─────────────────────────────────────────────────────────────
// 角色透镜：两个泳道对比
// ─────────────────────────────────────────────────────────────

function laneLens(graph: ArchGraph, laneId: string): LaneLens {
  const lane = graph.lanes.find((l) => l.id === laneId);
  const members = (lane?.slots ?? [])
    .map((id) => graph.byDim.get(id))
    .filter((n): n is GraphNode => !!n);
  const union = (pick: (n: GraphNode) => string[]) => [
    ...new Set(members.flatMap(pick)),
  ];
  return {
    laneId,
    laneName: lane?.name ?? laneId,
    provides: union((n) => n.provides),
    requires: union((n) => n.requires),
    unmet: union((n) => n.unmet),
  };
}

/** 对比两个泳道的「提供什么 / 索要什么」。只看已选中的槽位，空格子不产生能力。 */
export function compareLanes(graph: ArchGraph, laneA: string, laneB: string): LaneComparison {
  const a = laneLens(graph, laneA);
  const b = laneLens(graph, laneB);
  const split = (xa: string[], xb: string[]) => ({
    onlyA: xa.filter((c) => !xb.includes(c)),
    onlyB: xb.filter((c) => !xa.includes(c)),
    shared: xa.filter((c) => xb.includes(c)),
  });
  const p = split(a.provides, b.provides);
  const r = split(a.requires, b.requires);
  return {
    a,
    b,
    providesOnlyA: p.onlyA,
    providesOnlyB: p.onlyB,
    providesShared: p.shared,
    requiresOnlyA: r.onlyA,
    requiresOnlyB: r.onlyB,
    requiresShared: r.shared,
  };
}

// ─────────────────────────────────────────────────────────────
// 导览故事
// ─────────────────────────────────────────────────────────────

export function graphStories(graph: ArchGraph, picks: StackPicks, audit: ArchAudit): Story[] {
  const stories: Story[] = [];

  // ── 手写预设：作者主张的取舍 ──
  //
  // 焦点取「与当前选择**不一样**的槽位」，不取预设声明了哪些维度。
  // 四个预设都声明了全部 17 个维度：按声明取，每章的 focus 都是 17/17，
  // 图上没有任何一格被压暗 —— 点哪一章图都一模一样，导览等于没生效。
  // 差异才是这套主张真正的可看点：想变成它，要动的就是这几格。
  for (const preset of presets) {
    const declared = Object.keys(preset.picks).filter((d) => graph.byDim.has(d));
    if (declared.length < 2) continue;
    const focus = declared.filter((d) => picks[d] !== preset.picks[d]);
    stories.push({
      id: `preset-${preset.id}`,
      label: preset.name,
      focus,
      note:
        focus.length === 0
          ? `当前选择就是这套预设，没有要换的槽位。${preset.summary}`
          : `相对当前选择要换掉 ${focus.length} 个槽位。${preset.summary}`,
      source: 'preset',
    });
  }

  // ── 算出来的面：缺口与隐患 ──
  const gapNodes = [
    ...new Set(
      [...audit.blockers, ...audit.gaps].flatMap((g) => g.nodes).filter((d) => graph.byDim.has(d))
    ),
  ];
  if (gapNodes.length) {
    stories.push({
      id: 'computed-gaps',
      label: '当前缺口',
      focus: gapNodes,
      note: `按当前选择算出来有 ${audit.blockers.length + audit.gaps.length} 处缺件，涉及 ${gapNodes.length} 个槽位。`,
      source: 'computed',
    });
  }

  const riskNodes = [
    ...new Set(
      [...audit.risks, ...audit.notes].flatMap((g) => g.nodes).filter((d) => graph.byDim.has(d))
    ),
  ];
  if (riskNodes.length) {
    stories.push({
      id: 'computed-risks',
      label: '组合隐患',
      focus: riskNodes,
      note: `有 ${audit.risks.length} 条风险、${audit.notes.length} 条提醒落在这些槽位上。`,
      source: 'computed',
    });
  }

  // 当前选择对应的预设排在最前，方便对照
  const activePreset = presets.find((p) =>
    Object.entries(p.picks).every(([d, o]) => picks[d] === o)
  );
  if (activePreset) {
    const i = stories.findIndex((s) => s.id === `preset-${activePreset.id}`);
    if (i > 0) stories.unshift(...stories.splice(i, 1));
  }

  return stories;
}

// ─────────────────────────────────────────────────────────────
// 展示用的小工具
// ─────────────────────────────────────────────────────────────

/** 一条边的读法。版式边与依赖边用**不同的措辞**，防止读者混淆。 */
export function edgeLabel(edge: GraphEdge): string {
  if (edge.kind === 'pipeline') return '层内下一跳（版式顺序）';
  return edge.caps.map((c) => `提供「${capLabel(c)}」`).join('、');
}

export { capLabel };
