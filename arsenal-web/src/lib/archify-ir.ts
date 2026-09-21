/**
 * 选型 → Archify JSON IR 适配器。
 *
 * 为什么要有这个东西，而不是拿 Archify 替掉自研画布：
 *
 *   自研画布（arch-canvas.ts）是**专用产线** —— 它知道 Redis 要画成堆叠的集群卡、
 *   端口贴在标题行、进程内的东西不能占节点位。这些判断来自我们的数据模型。
 *   Archify 是**通用绘图器** —— 它不知道 Java 生态里哪些东西会被部署，
 *   但它有我们完全没有的一层：**九项构图自检**（正交折线 / 标签避让 / 交叉数 /
 *   折线节奏 / 边框穿越 …）+ 可交互 HTML 交付。
 *
 *   所以两者不是替代关系。适配器只做一件事：把我们已经想清楚的部署事实
 *   翻译成对方能校验的中间表示，把「画得像不像样」交给它的校验器当质量门。
 *
 * ## 一条不能破的规矩：一份模型，两个渲染器
 *
 * 输入只有 `buildTechArch()` 的产物。适配器**不碰 picks、不碰原始 JSON** ——
 * 否则就会长出第二套「什么算节点、谁连谁」的判断，两张图迟早各说各的，
 * 而且不会有任何东西报错。改了选型数据，两张图一起变。
 *
 * ## 版式为什么是左到右的主干，而不是自上而下的分层
 *
 * 自研画布是自上而下的分层（客户端 → 应用 → 中间件 → 数据 → 观测），
 * 直觉上这里也该照搬。**但照搬会被它整片驳回**，原因在它的端点方向推断：
 *
 *     defaultFromSide(from, to):
 *       to.cx < from.cx → 'left'；to.cx > from.cx → 'right'；**相等才比 y**
 *
 * 它先比两边中心的 x。竖排布局里，下一层的节点中心几乎不可能和上一层完全对齐，
 * 于是每条跨层连线都被判成「水平方向」，而它要求首段与末段必须是水平的 ——
 * 竖排天然做不到。实测四套预设全部因此报 endpoint-side-direction。
 *
 * 所以版式按它期望的形状来：**左到右一条主干**（客户端 → 应用进程 → 右侧一排基础设施）。
 * 三层的分层信息没有丢，它由 region 边框承担 —— 中间件 / 数据存储 / 观测与运维
 * 三组框在右列自上而下排开，读起来仍然是分层的。
 *
 * 规律：**几何可以是自己的，语义必须来自数据**。模型是共享的，版式各自负责。
 */

import {
  CANVAS_LEGEND,
  CANVAS_VIEWS,
  CANVAS_ZONES,
  type CanvasNode,
  type CanvasViewSpec,
  type TechArch,
} from './arch-canvas';

// ─────────────────────────────────────────────────────────────
// IR 类型（对应 architecture.schema.json / common.schema.json）
// ─────────────────────────────────────────────────────────────

export type ArchifyComponentType =
  | 'frontend' | 'backend' | 'database' | 'cloud' | 'security' | 'messagebus' | 'external';

export interface ArchifyComponent {
  id: string;
  type: ArchifyComponentType;
  label: string;
  sublabel?: string;
  tag?: string;
  /** 内置商标 id。我们只用这一种形式：钉版 URL 需要联网抓取，交付物不该有这个依赖 */
  brand?: string;
  pos: [number, number];
  size: [number, number];
}

export interface ArchifyBoundary {
  kind: 'region' | 'security-group';
  label: string;
  wraps: string[];
  pad?: number;
}

export interface ArchifyConnection {
  id: string;
  from: string;
  to: string;
  label?: string;
  variant?: 'default' | 'emphasis' | 'security' | 'dashed';
  fromSide?: 'left' | 'right' | 'top' | 'bottom';
  toSide?: 'left' | 'right' | 'top' | 'bottom';
  via?: [number, number][];
  /**
   * 标签骑在第几段折线上（0 起，默认 1 = 中间那段）。
   * 默认值对四段的车道路径正好是那条竖线，所以只有绕行导轨需要显式指定 ——
   * 它的竖线在最右边、标签会探出画布，得改骑到顶部横轨上。
   */
  labelSegment?: number;
  /** 标签相对默认位置的纵向微调。默认位置对短线来说会骑到源节点的扇出横线上 */
  labelDy?: number;
}

export interface ArchifyView {
  id: string;
  label: string;
  focus: string[];
  note?: string;
}

export interface ArchifyCard {
  dot: 'cyan' | 'emerald' | 'violet' | 'amber' | 'rose' | 'orange' | 'slate';
  title: string;
  items: string[];
}

export interface ArchifyIr {
  schema_version: 1;
  diagram_type: 'architecture';
  meta: {
    title: string;
    subtitle?: string;
    locale: 'zh-CN' | 'en';
    visual_preset?: 'classic' | 'signal-flow' | 'blueprint' | 'editorial';
    quality_profile?: 'standard' | 'showcase';
    animation?: 'trace' | 'none';
    legend?: { mode: 'auto' | 'all' | 'hidden'; entries?: Record<string, { label?: string }> };
    views?: ArchifyView[];
  };
  components: ArchifyComponent[];
  boundaries?: ArchifyBoundary[];
  connections?: ArchifyConnection[];
  cards?: ArchifyCard[];
}

export interface ArchifyIrOptions {
  title?: string;
  subtitle?: string;
  locale?: 'zh-CN' | 'en';
  visualPreset?: 'classic' | 'signal-flow' | 'blueprint' | 'editorial';
  qualityProfile?: 'standard' | 'showcase';
  animation?: 'trace' | 'none';
}

// ─────────────────────────────────────────────────────────────
// 版式常量
//
// 这一套是**给 Archify 用的**，和 arch-canvas.ts 那套刻意不同。共存不矛盾 ——
// 模型共享，几何各自负责：那边是画布上手工调过的像素，这边要留出 region 边框、
// 框外标题带、以及正交折线标签的空隙。
// ─────────────────────────────────────────────────────────────

/** 内容起点。左上角要留出 region 边框与它悬在框外的标题带 */
const MARGIN = 76;
/**
 * 列间距的下限。真实间距由 `corridorWidth()` 按该走廊里所有连线标签的
 * 遮罩宽度算出来 —— 标签必须落在自己的车道线上，所以车道之间的净空
 * 决定了走廊要多宽。这个常量只是保证窄走廊不至于挤成一团。
 */
const MIN_CORRIDOR = 128;
/** 车道带距源列右沿的距离 */
const LANE_START = 26;
/**
 * 相邻两条车道之间，两个标签遮罩的净空。
 *
 * 对方那条「标签不许压到别的连线」的门槛只有 4px，这里给 12 ——
 * 不是为了好看，是因为它的标签矩形是按它自己的字宽估出来的
 * （`max(30, 单位数 × 4.8 + 10)`，全角算 2 个单位），
 * 我们对同一个字符串的估算可能差几个像素。留出这一截，估算误差就吃不掉净空。
 */
const LANE_MIN_GAP = 12;
/** 同一条走廊里，两组车道带之间的净空 */
const LANE_BAND_GAP = 30;
/**
 * 车道带右沿之外还要留的余量。
 *
 * 这一截是给「车道竖段 → 目标左沿」那一段横线用的：对方有 16px 的
 * 内部段长度下限（不足就报短段）。同时标签是骑在车道线上的，右半边
 * 也会探过来，所以这个余量得同时盖住两者。
 */
const LANE_TAIL = 34;
/**
 * 车道竖段的最小长度，也就是「源节点中心」与「目标节点中心」之间必须让开的距离。
 *
 * 对方有一条 16px 的**内部段**下限：车道是「横 → 竖 → 横」，
 * 中间那段竖线若短于 16px 就报 `short-interior-segment`。既然竖段的长度
 * 恰好等于两个中心的高度差，这个差就必须 ≥ 16。这里取 20 留一点余量。
 */
const MIN_LANE_DELTA = 20;
/**
 * 连线标签的净空下限，比对方那条 4px 的门槛留了一截。
 *
 * 留余量不是为了好看：标签矩形是我们按它的字宽公式估出来的，
 * 而它自己算的时候会再取一次整；估出来的 4px 到它手里可能只剩 3.9。
 */
const LABEL_MIN_CLEARANCE = 6;
/**
 * 标签纵向落点的候选偏移。
 *
 * 标签默认骑在中间那段的上方（矩形上沿比中点高 20px，高 14px）。
 * 车道越短，中点越贴近源节点的中心线，标签就正好压在同一源扇出的那条横线上 ——
 * 实测差 2px 就被判不合格。往下推能解决，但推多了又会撞上前一条车道的入线横段，
 * 所以逐步试，取第一个同时避开两者的值。
 */
const LABEL_DROP_CANDIDATES = Array.from({ length: 31 }, (_, i) => i * 2);
/** 同组内上下两个节点的净空 */
const NODE_GAP_Y = 42;
/** 相邻分组的 region 边框之间的净空 */
const GROUP_GAP = 52;
/** region 边框内边距。显式写死，免得被对方默认值悄悄改掉 */
const REGION_PAD = 26;
/** 对方在 pad 之外还会在边框底部多留这么多 */
const REGION_EXTRA_BOTTOM = 20;
/** 分组标题带的高度（标题悬在框外上沿） */
const REGION_LABEL_RAIL = 24;
/** 回边绕行用的右侧导轨，相对内容右沿再往外让这么多；多条回边依次错开 */
const BACK_RAIL_INSET = 72;
const BACK_RAIL_STEP = 30;
/** 回边绕行的顶部横轨。必须在所有组件之上，但要在画布内（包围盒只算组件与边框） */
const TOP_RAIL_Y = 40;
/**
 * 多条回边时顶部横轨依次下移的步距。
 *
 * 回边的标签骑在顶部横轨上，两条回边若共用一条横轨，标签会在同一条水平线上
 * 叠住。错开横轨高度最省事，而且这一段是空的（组件从 MARGIN + 标题带开始），
 * 有地方可让。
 *
 * 为什么是 28 而不是看上去差不多的 22：这个数是算出来的，不是调出来的。
 * 标签框被抬到横轨上方 20px（框顶 = railY - 20，框高 14px），
 * 后一条横轨的标签要给前一条横轨的那条线留出 ≥4px 净空，于是：
 *      railY(n) - 20 ≥ railY(n-1) + 4   ⟹   步距 ≥ 24
 * 22 差了 2px —— 表现为「只要出现第二条回边就压线」，而且只在最严档才报，
 * 平时看不出来。取 28 是因为留一点余量比每次都算到临界值便宜。
 */
const RAIL_STEP_Y = 28;

const SIZE: Record<'client' | 'app' | 'side' | 'node', [number, number]> = {
  client: [176, 60],
  app: [300, 76],
  side: [176, 62],
  node: [204, 74],
};

function sizeOf(node: CanvasNode): [number, number] {
  if (node.kind === 'client') return SIZE.client;
  if (node.kind === 'app') return SIZE.app;
  if (node.kind === 'side') return SIZE.side;
  return SIZE.node;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

// ─────────────────────────────────────────────────────────────
// 列归属
// ─────────────────────────────────────────────────────────────

/**
 * 分区归到第几列。**前两个分区各占一列，其余分区共占第三列。**
 *
 * 为什么后几层要挤在一列：见文件头的说明 —— 它是左到右主干，
 * 而应用进程的下游（中间件 / 数据 / 观测）各自都只与应用相连接，
 * 分散成多列会逼出「跳过一列」的连线，那种线必然压着中间那列的节点走。
 * 挤在一列之后，每条下游连线都是相邻列之间的干净一跳。
 *
 * 找不到分区时归到右列（最保守：它不会把连线挤进主干）。
 */
function columnOf(zoneId: string): 0 | 1 | 2 {
  const index = CANVAS_ZONES.findIndex((z) => z.id === zoneId);
  if (index <= 0) return 0;
  if (index === 1) return 1;
  return 2;
}

// ─────────────────────────────────────────────────────────────
// 构建
// ─────────────────────────────────────────────────────────────

/**
 * 把一张部署模型翻译成 Archify 的 architecture IR。
 *
 * 输出里每个字段都能追回模型里的某个事实：类型来自分区或选项的声明、
 * 商标来自选项声明、端口来自选项声明、集群倍数来自集群形态的声明。
 * **没有一处是渲染器猜的** —— 图上写的东西必须能在数据里找到出处。
 */
export function buildArchifyIr(model: TechArch, opts: ArchifyIrOptions = {}): ArchifyIr {
  const nodes = model.nodes;
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // 分组只算一次，版式和边框共用。组内顺序决定节点自上而下的位置，
  // 而边框的 wraps 是按 id 圈人的 —— 两份各算一次，就会出现
  // 「框里的顺序」和「摆的顺序」不一致，图上只表现为某条线莫名其妙地穿了一下。
  const groups = groupZones(nodes, model.edges);
  const bands = laneBands(groups, model.edges);
  const placed = layoutColumns(groups, bands.corridor, model.edges);
  const pos = new Map(placed.map((s) => [s.node.id, [s.x, s.y] as [number, number]]));

  // ── 分组边框：右列按分区分组；左两列各自成组 ──
  //
  // 客户端那一组**不给框**：它是外部角色，把它框进系统边界里是画错的 ——
  // 读图的人会以为「客户端也归我们部署」。其余每一层给框，
  // 因为「这套东西分几层」本身就是要交付的信息。
  const boundaries: ArchifyBoundary[] = groups
    .filter((g) => g.zone.id !== 'client')
    .map((g) => ({
      kind: 'region' as const,
      label: g.zone.name,
      wraps: g.nodes.map((n) => n.id),
      pad: REGION_PAD,
    }));

  // ── 组件 ──
  const components: ArchifyComponent[] = [];
  for (const node of nodes) {
    const p = pos.get(node.id);
    if (!p) continue; // 没被放进去的节点：防御性跳过，正常走不到
    const mode = node.modes?.[node.mode ?? 0];
    const component: ArchifyComponent = {
      id: node.id,
      type: archifyTypeOf(node),
      label: node.title,
      pos: p,
      size: sizeOf(node),
    };
    const sub = subtitleOf(node, mode);
    if (sub) component.sublabel = sub;
    const tag = tagOf(node, mode);
    if (tag) component.tag = tag;
    if (node.brand) component.brand = node.brand;
    components.push(component);
  }

  // ── 连线 ──
  //
  // 这里是整个适配器最花力气的一段，原因值得写下来：
  //
  // 它的自动路由恒用两端中心的中点作为转折竖线（`midX = (start.x + end.x) / 2`），
  // 于是**同一个源分出去的每一条线，竖段都落在完全相同的那条 x 上**。
  // 五条线共用一条竖廊，标签必然互相压、遮罩必然互相盖 —— 实测就是这么报的。
  //
  // 所以凡是「源节点分出去多条、且跨到相邻列」的连线，由我们自己排车道：
  // 每条线一个独立的竖段 x，车道间距按相邻两条标签的遮罩宽度算出来。
  // 车道顺序与目标上下顺序一致，这样扇出的线不会互相交叉。
  const slotById = new Map(placed.map((s) => [s.node.id, s]));
  const lanes = laneOffsets(bands.plans, placed);
  const rightEdge = Math.max(0, ...placed.map((s) => s.x + s.w));
  const connections: ArchifyConnection[] = [];
  const usedIds = new Set<string>();
  let railCount = 0;

  model.edges.forEach((edge, index) => {
    const a = slotById.get(edge.from);
    const b = slotById.get(edge.to);
    if (!a || !b) return;

    let id = `c_${edge.from}_${edge.to}`;
    let n = 2;
    while (usedIds.has(id)) id = `c_${edge.from}_${edge.to}_${n++}`;
    usedIds.add(id);

    const conn: ArchifyConnection = {
      id,
      from: edge.from,
      to: edge.to,
      label: edge.label,
      variant: edge.kind === 'dashed' ? 'dashed' : 'default',
    };

    const lane = lanes.get(index);
    if (lane) {
      // 走廊车道：右出 → 竖行 → 左进。三段全正交，首段与末段都横向。
      //
      // 竖段的 x 由我们自己定（`laneOffsets`），不是两端中点 —— 这正是整段
      // 绕不过去的地方：对方的自动路由把所有同源连线的竖段都放在同一条 x 上。
      // 首段的起点固定是「源节点右沿的中点」，这也是为什么车道只能靠横向错开，
      // 不能靠纵向错开 —— 纵向错开会让首段变成斜线，正交检查当场驳回。
      const x = round(columnRight(placed, a.col) + lane.dx);
      conn.fromSide = 'right';
      conn.toSide = 'left';
      conn.via = [[x, lane.fromY], [x, lane.toY]];
      conn.labelSegment = 1; // 骑在竖段上。车道 x 各不相同，标签自然互不相压
      if (lane.drop) conn.labelDy = lane.drop;
    } else if (needsRail(a.col, b.col)) {
      // 回边（右列的下游反过来连回主干）：直连会横穿中间那一列的节点 ——
      // 在对方那边这是硬失败（被无关组件挡住）。
      // 所以走「右侧导轨 → 顶部横轨 → 下沉进目标顶边」。三段正交，两次 90° 转角。
      //
      // 导轨的 x 之所以要往内容右沿之外让，是因为包围盒只按组件与边框算，
      // 折点不进包围盒：导轨必须落在画布内，否则线会被切掉一截还看不出来。
      const rail = round(rightEdge + BACK_RAIL_INSET + railCount * BACK_RAIL_STEP);
      const railY = round(TOP_RAIL_Y + railCount * RAIL_STEP_Y);
      railCount += 1;
      conn.fromSide = 'right';
      conn.toSide = 'top';
      conn.via = [
        [rail, round(a.y + a.h / 2)],
        [rail, railY],
        [round(b.x + b.w / 2), railY],
      ];
      // 标签默认骑在第 2 段（那条最右边的竖轨）上，右半边会探出画布；
      // 改骑顶部横轨 —— 那一段上方是空的
      conn.labelSegment = 2;
    }
    connections.push(conn);
  });

  // ── 阅读路径 / 卡片 ──
  const views = buildViews(nodes, byId);
  const cards = buildCards(model, byId);

  const ir: ArchifyIr = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: opts.title ?? '技术架构图',
      locale: opts.locale ?? 'zh-CN',
      quality_profile: opts.qualityProfile ?? 'showcase',
      visual_preset: opts.visualPreset ?? 'blueprint',
    },
    components,
  };
  if (opts.subtitle) ir.meta.subtitle = opts.subtitle;
  if (opts.animation) ir.meta.animation = opts.animation;
  if (views.length) ir.meta.views = views;

  // 图例文字覆盖：不让它那边把 Nacos / Prometheus 这一层读作「云服务」
  const legendEntries: Record<string, { label?: string }> = {};
  for (const [kind, entry] of Object.entries(CANVAS_LEGEND)) {
    if (entry?.label) legendEntries[kind] = { label: entry.label };
  }
  ir.meta.legend = Object.keys(legendEntries).length
    ? { mode: 'auto', entries: legendEntries }
    : { mode: 'auto' };

  if (boundaries.length) ir.boundaries = boundaries;
  if (connections.length) ir.connections = connections;
  if (cards.length) ir.cards = cards;
  return ir;
}

// ── 版式 ──────────────────────────────────────────────────

interface Slot {
  node: CanvasNode;
  col: 0 | 1 | 2;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 一个分区在图上的一组节点（已排好组内自上而下的顺序） */
type ZoneGroup = { zone: (typeof CANVAS_ZONES)[number]; nodes: CanvasNode[] };

/**
 * 把分区排成三列。
 *
 * 左侧两列各放一个分区（外部角色 / 应用进程），右列把其余分区自上而下摞起来，
 * 每个分区外面套一个 region 边框。左两列的节点**相对右列的整段高度垂直居中** ——
 * 顶部对齐会让左半边整片空着，读起来像图画歪了。
 */
function layoutColumns(
  groups: ZoneGroup[],
  corridor: Map<number, number>,
  edges: { from: string; to: string }[]
): Slot[] {
  const left0 = groups.filter((g) => columnOf(g.zone.id) === 0);
  const left1 = groups.filter((g) => columnOf(g.zone.id) === 1);
  const right = groups.filter((g) => columnOf(g.zone.id) === 2);

  const widthOf = (g: { nodes: CanvasNode[] }) => Math.max(0, ...g.nodes.map((n) => sizeOf(n)[0]));
  const col0W = Math.max(0, ...left0.map(widthOf));
  const col1W = Math.max(0, ...left1.map(widthOf));
  const col2W = Math.max(0, ...right.map(widthOf));

  // 列位置取决于走廊宽度，而走廊宽度只取决于标签文字的宽度（与坐标无关），
  // 所以这里没有循环依赖：先把走廊算出来，再定列位置。
  const col0X = MARGIN;
  const col1X = col0X + col0W + (corridor.get(0) ?? MIN_CORRIDOR);
  const col2X = col1X + col1W + (corridor.get(1) ?? MIN_CORRIDOR);

  // ── 右列：自上而下摞。每个分组的占地 = 标题带 + 边框上沿 + 内容 + 边框下沿 ──
  const slots: Slot[] = [];
  let cursor = MARGIN + REGION_LABEL_RAIL;
  for (const group of right) {
    const contentTop = cursor + REGION_PAD;
    let y = contentTop;
    for (const node of group.nodes) {
      const [w, h] = sizeOf(node);
      // **列内水平居中**，不是左对齐：同一列里「数据库」(204 宽) 与
      // 「迁移工具」(176 宽) 左对齐会让两者中心差 14px，而端点方向推断是
      // 先比 x 中心的 —— 那 14px 足以把一条本该竖直的连线判成水平方向。
      slots.push({ node, col: 2, x: round(col2X + (col2W - w) / 2), y: round(y), w, h });
      y += h + NODE_GAP_Y;
    }
    const contentH = y - NODE_GAP_Y - contentTop;
    cursor = contentTop + contentH + REGION_PAD + REGION_EXTRA_BOTTOM + GROUP_GAP;
  }
  const rightBottom = right.length
    ? cursor - GROUP_GAP
    : MARGIN + REGION_LABEL_RAIL;

  // ── 左两列：相对右列那一段垂直居中，再整块挪到「离每个连线目标都够远」的位置 ──
  //
  // 为什么要挪：车道的竖段长度恰好等于「源中心」与「目标中心」的高度差。
  // 天生居中时，应用进程的中心很容易正好撞上右列某个节点的中心 ——
  // 那一跳的竖段就短到十几像素，对方的 16px 内部段下限当场判死。
  //
  // 挪版式而不是挪数据：一个中心的位置是画面的事，不是选型的事。
  // 让图去迁就画法，数据就被污染了。
  const centerY = (MARGIN + rightBottom) / 2;
  const shift = leftBlockShift(centerY, groups, edges, new Map(slots.map((s) => [s.node.id, s])));
  const stack = (list: typeof left0, col: 0 | 1, colX: number, colW: number) => {
    const all = list.flatMap((g) => g.nodes);
    const total = all.reduce((s, n) => s + sizeOf(n)[1], 0) + NODE_GAP_Y * Math.max(0, all.length - 1);
    let y = centerY + shift - total / 2;
    for (const node of all) {
      const [w, h] = sizeOf(node);
      slots.push({ node, col, x: round(colX + (colW - w) / 2), y: round(y), w, h });
      y += h + NODE_GAP_Y;
    }
  };
  stack(left0, 0, col0X, col0W);
  stack(left1, 1, col1X, col1W);

  return slots;
}

/**
 * 左侧两列整块的纵向偏移量。
 *
 * 只有一个自由度（整块上下挪），所以要挑一个「离所有右列目标都够远」的值：
 * 先找满足全部约束的候选里挪得最少的那个；一个都不满足，就退而求其次，
 * 挑「最小间距最大」的那个 —— 至少让缺陷摊薄到所有连线上，而不是集中在一条。
 *
 * 左列内部之间的连线不参与计算：它们两列一起平移，高度差恒为 0，
 * 本来就是一条干净的直线，不需要为它们留间距。
 */
function leftBlockShift(
  centerY: number,
  groups: ZoneGroup[],
  edges: { from: string; to: string }[],
  slotOf: Map<string, Slot>
): number {
  const leftIds = new Set<string>();
  for (const g of groups) {
    if (columnOf(g.zone.id) === 2) continue;
    for (const n of g.nodes) leftIds.add(n.id);
  }

  const targets: number[] = [];
  for (const e of edges) {
    if (!leftIds.has(e.from)) continue;
    const t = slotOf.get(e.to);
    if (t && t.col === 2) targets.push(t.y + t.h / 2);
  }
  if (!targets.length) return 0;

  const dist = (d: number) => Math.min(...targets.map((t) => Math.abs(centerY + d - t)));
  const candidates = [0];
  for (let step = 2; step <= 80; step += 2) candidates.push(step, -step);

  const feasible = candidates.filter((d) => dist(d) >= MIN_LANE_DELTA);
  if (feasible.length) return feasible.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
  return candidates.reduce((a, b) => (dist(b) > dist(a) ? b : a));
}

/**
 * 按分区归组，并给每组排出组内顺序。
 *
 * 组内规矩：**旁路件紧跟在它连出去的那个节点后面**。
 * 旁路件（kind === 'side'，比如 Schema 迁移工具）是对这一层动手的东西，
 * 不是这一层的数据通路 —— 摆错位置会让它的连线横穿中间某个无辜的节点，
 * 那在构图检查里是硬失败（压着无关节点走）。
 * 目标不在本组（或它压根没连线）就退到组尾，不硬插。
 */
function groupZones(
  nodes: CanvasNode[],
  edges: { from: string; to: string }[]
): ZoneGroup[] {
  return CANVAS_ZONES
    .map((zone) => {
      const members = nodes.filter((n) => n.zone === zone.id);
      const ordered = members.filter((n) => n.kind !== 'side');
      for (const side of members.filter((n) => n.kind === 'side')) {
        // 同分区内的连接目标：从连线里找，不猜
        const targetId = edges.find(
          (e) => e.from === side.id && ordered.some((n) => n.id === e.to)
        )?.to;
        const at = targetId ? ordered.findIndex((n) => n.id === targetId) + 1 : ordered.length;
        ordered.splice(at, 0, side);
      }
      return { zone, nodes: ordered };
    })
    .filter((g) => g.nodes.length > 0);
}

// ── 车道规划 ──────────────────────────────────────────────
//
// 这一段是整个适配器里唯一「跟对方搏斗」的地方，所以把缘由写清楚。
//
// 它的自动路由对同源的连线只有一种排法：竖段恒在两端中心的 x 上
// （`midX = (start.x + end.x) / 2`）。于是同一个源分出去的五条线，
// 竖段全落在同一条 x 上，标签全部叠在一处。
//
// 我们改不了它的路由，只能不让它路由：给每条跨列连线显式写 `via`，
// 竖段的 x 由我们自己分配。`via` 一旦给了，它连端点方向都不再推断
// （端点方向推断只在没有显式几何时才跑）—— 也就是说，进了这条路，
// 几何的正确性全归我们。
//
// 车道的宽度不是拍脑袋的：它按每条连线标签的**遮罩宽度**算出来，
// 用的是它自己那套字宽估算规则（全角 2 个单位、每单位 4.8px、再加 10px 内边距，
// 下限 30px）。估错的后果是实打实的：标签压到邻边的竖段上，
// 它会报 `label-route-clearance`，而那条报错指向的是我们的坐标。

/** 与 Archify 一致的「全角字符」判定 —— 字宽估算要用，不能自己另编一套 */
const FULLWIDTH_RE =
  /[\u1100-\u115F\u2E80-\uA4CF\uA960-\uA97C\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF01-\uFF60\uFFE0-\uFFE6\u{16FE0}-\u{18DFF}\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;

/** 文本宽度单位数。全角算 2、其余算 1（和它 `textUnits()` 同一套口径） */
function textUnits(text: string): number {
  let units = 0;
  for (const ch of Array.from(text)) units += FULLWIDTH_RE.test(ch) ? 2 : 1;
  return units;
}

/**
 * 连线标签的遮罩宽度。没标签就是 0 —— 0 会让车道贴在一起，
 * 所以下面算带宽时用 `Math.max(30, …)` 兜底，不能让它退化成零宽。
 */
function labelMaskWidth(label?: string): number {
  if (!label) return 0;
  return Math.max(30, textUnits(label) * 4.8 + 10);
}

/** 一条车道带的净宽：所有标签遮罩横向串起来，两两之间留 `LANE_MIN_GAP` */
function bandWidthOf(edges: { maskW: number }[]): number {
  if (!edges.length) return 0;
  return edges.reduce((sum, e) => sum + e.maskW, 0) + LANE_MIN_GAP * (edges.length - 1);
}

interface LaneEdge {
  /** 在 `model.edges` 里的下标 —— 车道的键 */
  index: number;
  to: string;
  maskW: number;
}

interface LanePlan {
  /** 这个源节点 id。竖向出口的 y 要从它的位置上取 */
  from: string;
  col: 0 | 1 | 2;
  /** 这条车道带左沿相对「源所在列右沿」的偏移 */
  dx0: number;
  /** 该源的跨列出边，按目标在列内自上而下的顺序排好 */
  edges: LaneEdge[];
}

/** 节点在某个分区组里的位置 */
interface ZoneIndex {
  col: Map<string, 0 | 1 | 2>;
  order: Map<string, number>;
}

function indexZones(groups: ZoneGroup[]): ZoneIndex {
  const col = new Map<string, 0 | 1 | 2>();
  const order = new Map<string, number>();
  let ordinal = 0;
  for (const g of groups) {
    const c = columnOf(g.zone.id);
    for (const n of g.nodes) {
      col.set(n.id, c);
      order.set(n.id, ordinal++);
    }
  }
  return { col, order };
}

/**
 * 给每条跨列向前的连线排一条车道，并顺带算出每条走廊要多宽。
 *
 * 只有「源列 < 目标列」的连线进这里。另外两类各有各的走法：
 *   · 回边（目标列更小）走绕行导轨 —— 直连会横穿中间那一列；
 *   · 同列连线交给对方的自动路由 —— 同列的源和目标我们做了列内居中，
 *     x 中心对齐，它自然判定成竖直方向；而且这种源当前至多一条出边，不会互压。
 */
function laneBands(
  groups: ZoneGroup[],
  edges: { from: string; to: string; label?: string }[]
): { corridor: Map<number, number>; plans: LanePlan[] } {
  const { col, order } = indexZones(groups);

  const bySource = new Map<string, LaneEdge[]>();
  edges.forEach((edge, index) => {
    const cf = col.get(edge.from);
    const ct = col.get(edge.to);
    if (cf === undefined || ct === undefined || ct <= cf) return;
    const list = bySource.get(edge.from) ?? [];
    list.push({ index, to: edge.to, maskW: labelMaskWidth(edge.label) });
    bySource.set(edge.from, list);
  });

  // 按「源列」归拢。同列里可能有多个源（比如应用进程与挂在它旁边的迁移工具），
  // 每个源各占一条带 —— 共居一条带会让两源的竖段落在同一条 x 上，
  // 在它眼里那就是「两条无关连线共用走廊」。
  const byColumn = new Map<number, LanePlan[]>();
  for (const [from, list] of bySource) {
    const c = col.get(from)!;
    list.sort((a, b) => (order.get(a.to) ?? 0) - (order.get(b.to) ?? 0));
    const bucket = byColumn.get(c) ?? [];
    bucket.push({ from, col: c, dx0: LANE_START, edges: list });
    byColumn.set(c, bucket);
  }

  const plans: LanePlan[] = [];
  const corridor = new Map<number, number>();
  for (const [c, bucket] of byColumn) {
    bucket.sort((a, b) => (order.get(a.from) ?? 0) - (order.get(b.from) ?? 0));
    let extent = 0;
    bucket.forEach((plan, i) => {
      plan.dx0 = LANE_START + i * LANE_BAND_GAP;
      extent = Math.max(extent, plan.dx0 + bandWidthOf(plan.edges));
      plans.push(plan);
    });
    corridor.set(c, Math.max(MIN_CORRIDOR, extent + LANE_TAIL));
  }
  return { corridor, plans };
}

/**
 * 把车道带摊成每条连线一条车道。
 *
 * 每条车道交出四样东西：竖段的 x（相对源所在列右沿）、出口 y、入口 y、
 * 以及标签要往下挪多少。**标签的落点在这里定，不在连线那里定** ——
 * 判定它会不会压到别的线，需要看到同一走廊里所有车道的入口 y 与 x，
 * 那个视野只有这一层有。
 *
 * 顺序规矩：车道自上而下按目标的上下顺序排。反过来排会让扇出的线互相交叉 ——
 * 它的交叉检查对「同源扇出」也照算不误。
 */
function laneOffsets(
  plans: LanePlan[],
  placed: Slot[]
): Map<number, { dx: number; fromY: number; toY: number; drop: number }> {
  const slotById = new Map(placed.map((s) => [s.node.id, s]));
  const lanes = new Map<number, { dx: number; fromY: number; toY: number; drop: number }>();
  for (const plan of plans) {
    const slot = slotById.get(plan.from);
    if (!slot) continue;
    const fromY = round(slot.y + slot.h / 2);

    // 先只算几何，标签落点留到第二轮 —— 定它需要先看到后面车道的入口 y
    const settled = plan.edges
      .map((edge) => {
        const target = slotById.get(edge.to);
        if (!target) return null;
        return {
          index: edge.index,
          maskW: edge.maskW,
          dx: 0,
          toY: round(target.y + target.h / 2),
          targetLeft: target.x,
        };
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x));

    let cursor = plan.dx0;
    for (const item of settled) {
      // 车道中心线：先让出自己半个遮罩，再走。这样最后一条的右沿
      // 正好落在带宽的右边界内，走廊宽度才对得上。
      const center = cursor + item.maskW / 2;
      item.dx = round(center);
      cursor = center + item.maskW / 2 + LANE_MIN_GAP;
    }

    settled.forEach((item, i) => {
      const colRight = columnRight(placed, plan.col);
      const laneX = round(colRight + item.dx);
      const prior = settled.slice(0, i).map((p) => ({ laneX: round(colRight + p.dx), toY: p.toY }));
      lanes.set(item.index, {
        dx: item.dx,
        fromY,
        toY: item.toY,
        drop: laneLabelDrop(fromY, item.toY, laneX, item.maskW, prior),
      });
    });
  }
  return lanes;
}

/** 一段横线与一个纵向区间的净空 */
function clearanceTo(top: number, bottom: number, lineY: number): number {
  if (lineY >= top && lineY <= bottom) return 0;
  return Math.min(Math.abs(lineY - top), Math.abs(lineY - bottom));
}

/**
 * 标签要往下挪多少，才能既不压源节点的扇出横线、也不压前序车道的入线横段。
 *
 * 两处都是**横线**：源节点的扇出横线恒在 `fromY`（同源所有车道共用），
 * 前序车道的入线横段在自己的入口 y 上、且从自己的车道一路横穿到目标左沿 ——
 * 也就是说它必然横跨本车道标签的横向范围。所以移位只需要纵向腾地方。
 *
 * 候选从 0 开始逐个试，取第一个合格的：挪得越少越好。
 * 一个都不合格就退而求其次，挑净空最大的那个 —— 至少让缺陷最轻。
 */
function laneLabelDrop(
  fromY: number,
  toY: number,
  laneX: number,
  maskW: number,
  prior: { laneX: number; toY: number }[]
): number {
  const midY = (fromY + toY) / 2;
  const right = laneX + maskW / 2;

  let best = 0;
  let bestScore = -Infinity;
  for (const drop of LABEL_DROP_CANDIDATES) {
    // 它自己的标签矩形：上沿比中点高 20px，再整体下移 drop
    const top = midY - 20 + drop;
    const bottom = top + 14;
    let score = clearanceTo(top, bottom, fromY);
    for (const p of prior) {
      if (p.laneX >= right) continue; // 那条入线整个在标签左侧，够不到
      score = Math.min(score, clearanceTo(top, bottom, p.toY));
    }
    if (score >= LABEL_MIN_CLEARANCE) return drop;
    if (score > bestScore) {
      bestScore = score;
      best = drop;
    }
  }
  return best;
}

/** 某一列所有节点里最靠右的那条边。车道与回边导轨都以它为基准 */
function columnRight(placed: Slot[], col: number): number {
  return Math.max(0, ...placed.filter((s) => s.col === col).map((s) => s.x + s.w));
}

/** 目标列在源列左边 = 回边，得绕行 */
function needsRail(fromCol: number, toCol: number): boolean {
  return toCol < fromCol;
}

// ── 组件字段 ──────────────────────────────────────────────

function subtitleOf(node: CanvasNode, mode?: { name: string; replicas: number }): string {
  if (!mode || mode.replicas <= 1) return node.subtitle;
  // 集群形态是交付图上的关键信息：一个实例还是有副本，可用性上限完全不同
  return `${node.subtitle} · ${mode.name}`;
}

function tagOf(node: CanvasNode, mode?: { name: string; replicas: number }): string {
  // 徽章位置只够放一件事。有集群就报倍数（那是规格），没有才报端口
  if (mode && mode.replicas > 1) return `×${mode.replicas}`;
  if (node.port) return `:${node.port}`;
  return '';
}

const COMPONENT_TYPES: ArchifyComponentType[] = [
  'frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external',
];

function asType(raw: string | undefined): ArchifyComponentType | undefined {
  return COMPONENT_TYPES.includes(raw as ArchifyComponentType)
    ? (raw as ArchifyComponentType)
    : undefined;
}

/**
 * 组件类型。正常情况模型里已经解析好了（分区声明 + 选项覆盖）。
 * 真走到兜底说明有人加了新维度却忘了声明分区归属 ——
 * 那时给 `external` 是最保守的：它不会被算进任何一条「系统内部」的结论里。
 */
function archifyTypeOf(node: CanvasNode): ArchifyComponentType {
  const declared = asType(node.archifyType);
  if (declared) return declared;
  if (node.kind === 'app') return 'backend';
  return 'external';
}

// ── 阅读路径 ──────────────────────────────────────────────

/**
 * 阅读路径由数据声明（`CANVAS_VIEWS`），这里只做解析。
 *
 * 两条必须守住的：
 *   ① 焦点**必须过滤成图上真实存在的组件**。Archify 会把指向不存在 id 的
 *      焦点判成硬失败（跨集合一致性检查）。所以规则是「先按声明取，再与图上求交，
 *      交完不足两块就整条丢掉」—— 那一层本来就没选，一条只亮一块的路径
 *      点开跟没点一样，不如不给。
 *   ② 两条路径的焦点不许完全相同。这是本项目已经踩过一次的坑：
 *      导览四章焦点全是「全部槽位」时，点哪一章图都一模一样，导览等于没生效。
 *      `archifyIrIssues()` 里钉着这条。
 */
function buildViews(nodes: CanvasNode[], byId: Map<string, CanvasNode>): ArchifyView[] {
  const views: ArchifyView[] = [];
  for (const spec of CANVAS_VIEWS as CanvasViewSpec[]) {
    const fromZones = spec.zones.flatMap((z) => nodes.filter((n) => n.zone === z).map((n) => n.id));
    const focus = Array.from(new Set([...fromZones, ...spec.dims])).filter((id) => byId.has(id));
    if (focus.length < 2) continue;
    views.push({ id: spec.id, label: spec.label, focus, note: spec.note });
  }
  return views;
}

// ── 卡片 ──────────────────────────────────────────────────

function buildCards(model: TechArch, byId: Map<string, CanvasNode>): ArchifyCard[] {
  const cards: ArchifyCard[] = [];

  // ① 部署形态：谁要单独起进程、起几个
  const clustered = model.nodes
    .map((n) => ({ n, m: n.modes?.[n.mode ?? 0] }))
    .filter((x) => x.m && x.m.replicas > 1);
  if (clustered.length) {
    cards.push({
      dot: 'cyan',
      title: '部署形态（实例数是算出来的，不是估的）',
      items: clustered.map(({ n, m }) => `${n.title} —— ${m!.name}（${m!.replicas} 个实例）`),
    });
  }

  // ② 通信契约：技术说明书要照抄的就是这几行
  if (model.edges.length) {
    cards.push({
      dot: 'emerald',
      title: '通信契约',
      items: model.edges.map((e) => {
        const from = byId.get(e.from)?.title ?? e.from;
        const to = byId.get(e.to)?.title ?? e.to;
        const port = e.port ? ` · :${e.port}` : '';
        const note = e.kind === 'dashed' ? '（非请求必经）' : '';
        return `${from} → ${to}：${e.label}${port}${note}`;
      }),
    });
  }

  // ③ 未引入的中间件。留空是这套模型里最容易被低估的决定，值得单列
  if (model.absent.length) {
    cards.push({
      dot: 'amber',
      title: '刻意没引入的中间件',
      items: model.absent.map((a) => `${a.name} —— 未选择`),
    });
  }

  // ④ 应用进程内、不占部署节点的东西
  const tags = model.nodes.find((n) => n.kind === 'app')?.tags ?? [];
  if (tags.length) {
    cards.push({
      dot: 'slate',
      title: '应用进程内（不是部署单元，所以图上没有它们的方块）',
      items: tags.map((t) => `${t.label}：${t.value}`),
    });
  }

  return cards;
}

// ─────────────────────────────────────────────────────────────
// 出门前自检
// ─────────────────────────────────────────────────────────────

/**
 * 结构自检。**不是** Archify 的九项构图检查 —— 那九项只有它的渲染器算得出来。
 * 这里只拦我们自己写错的那类：id 撞车、端点指向不存在的东西、空焦点、
 * 枚举写出界、两条阅读路径一样、回边折点退化。这些错了会把一张本来能过的图
 * 卡在门外，而报错信息指向对方，查起来更费劲。
 */
export function archifyIrIssues(ir: ArchifyIr): string[] {
  const issues: string[] = [];
  const ID = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
  const ids = new Set<string>();

  for (const c of ir.components) {
    if (!ID.test(c.id)) issues.push(`组件 id ${c.id} 不符合 id 规范`);
    if (ids.has(c.id)) issues.push(`组件 id 重复：${c.id}`);
    ids.add(c.id);
    if (!c.label) issues.push(`组件 ${c.id} 没有 label`);
    if (!asType(c.type)) issues.push(`组件 ${c.id} 的类型 ${c.type} 不在七类里`);
  }

  for (const b of ir.boundaries ?? []) {
    if (!b.wraps.length) issues.push(`分区「${b.label}」没有包住任何组件`);
    for (const id of b.wraps) {
      if (!ids.has(id)) issues.push(`分区「${b.label}」包住了不存在的组件 ${id}`);
    }
  }

  const relIds = new Set<string>();
  for (const c of ir.connections ?? []) {
    if (!ids.has(c.from)) issues.push(`连线 ${c.id} 的起点 ${c.from} 不存在`);
    if (!ids.has(c.to)) issues.push(`连线 ${c.id} 的终点 ${c.to} 不存在`);
    if (!ID.test(c.id)) issues.push(`连线 id ${c.id} 不符合 id 规范`);
    if (relIds.has(c.id)) issues.push(`连线 id 重复：${c.id}`);
    relIds.add(c.id);
    // 显式折点太少会让一条绕行退化成斜线，而斜线过不了它的正交检查。
    // 两个折点是下限：车道是「横 → 竖 → 横」，绕行导轨是「横 → 竖 → 横 → 竖」，
    // 两者都够；一个折点或没有，就必然有一段是斜的。
    if (c.via && c.via.length < 2) {
      issues.push(`连线 ${c.id} 的 via 少于两个折点，绕行会退化成斜线`);
    }
    // 车道与绕行都必须显式给端点方向：给了 via 之后它不再推断，
    // 端点方向就成了「我们说了算」的东西，漏写等于把箭头的落点交还给随机
    if (c.via && (!c.fromSide || !c.toSide)) {
      issues.push(`连线 ${c.id} 给了 via 却没写 fromSide/toSide，箭头落点会不对`);
    }
  }

  const viewIds = new Set<string>();
  const focusKeys = new Map<string, string>();
  for (const v of ir.meta.views ?? []) {
    if (viewIds.has(v.id)) issues.push(`阅读路径 id 重复：${v.id}`);
    viewIds.add(v.id);
    if (!v.focus.length) issues.push(`阅读路径「${v.label}」的焦点是空的`);
    for (const id of v.focus) {
      if (!ids.has(id)) issues.push(`阅读路径「${v.label}」指向不存在的组件 ${id}`);
    }
    // 两条路径焦点一样 = 点哪条图都一样，导览等于没生效
    const key = [...v.focus].sort().join(',');
    const prev = focusKeys.get(key);
    if (prev) issues.push(`阅读路径「${prev}」与「${v.label}」的焦点完全相同`);
    else focusKeys.set(key, v.label);
  }

  return issues;
}

/** 导出文件名。带上标签，一个项目出几张图时不会互相覆盖 */
export function archifyIrFilename(label: string): string {
  const slug = label
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'stack';
  return `architecture-${slug}.json`;
}
