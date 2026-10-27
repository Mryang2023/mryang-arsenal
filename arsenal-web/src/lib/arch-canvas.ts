/**
 * 交付用技术架构图：模型 + 布局 + SVG 渲染。
 *
 * 与 `arch-diagram.ts`（泳道依赖分析图）的区别：
 *   那张图回答「谁依赖谁」，给选型时用；这张图回答**「部署出来是什么样」**，
 *   是要贴进技术说明书、发给同事和客户的。所以两件事必须分开做。
 *
 * 三条不能破的规矩：
 *   ① **只画会被部署的东西**。Maven / Lombok / JUnit / MapStruct 是构建期、编码期的
 *      东西，把它们画成一个个部署节点，是架构图里最常见也最误导的画法 —— 它们
 *      在图上是应用卡里的「工程属性」，不占节点位。这条由数据的 `place` 决定。
 *   ② **集群形态是数据声明的**，渲染器只负责把声明的副本数画出来。
 *      图上写「主从复制 · 2 节点」是因为选项里写了 replicas=2，不是渲染器猜的。
 *   ③ **端口与协议也是声明的**。技术说明书会照抄这一栏，猜出来的端口号会出事。
 *
 * 编辑态（位移 / 改名 / 集群形态 / 增删节点）全部走 `CanvasEdits`，
 * 与选型数据分开：改图不影响判定，改判定不影响图。
 */

import archRaw from '@/generated/architecture.json';
import { dimensions } from './stack';
import type { StackPicks } from './content-types';
import { escapeXml } from './arch-diagram';
import { iconColor, iconSvg, iconName } from './tech-icons';
import { svgMotionStyle } from './arch-motion';

// ─────────────────────────────────────────────────────────────
// 数据读取
// ─────────────────────────────────────────────────────────────

interface ClusterMode {
  name: string;
  replicas: number;
  note?: string;
}
interface CanvasOption {
  icon: string;
  port?: string;
  cluster?: ClusterMode[];
  /**
   * 落位覆盖。**关键**：同一个维度里，有的选项跑在应用进程内（Caffeine 本地缓存、
   * Spring @Scheduled、Actuator 端点），有的要单独起进程（Redis、XXL-Job、Prometheus）。
   * 落位只能按选项定，按维度定就会把进程内的东西画成一个不存在的部署单元 ——
   * 那是架构图里最容易被当真的一类错。
   */
  place?: 'node' | 'appTag' | 'side';
  /**
   * 交给通用绘图器（Archify）导出时用的三项声明。
   *
   * 为什么放在数据里而不是适配器里：它们都是**关于这个组件的事实**，
   * 不是版式选择 —— 「Redis 有官方商标」「Flyway 不是数据库」这两句话，
   * 无论哪个渲染器来画都为真。适配器只负责把它们抄进 IR。
   */
  /** Archify 内置商标 id。必须真实存在，编一个会在它那边直接渲染失败 */
  brand?: string;
  /** 覆盖分区给的组件类型（消息队列落在中间件层时要改） */
  archifyType?: string;
  /** 交付图上的短名。全名太长时用 */
  label?: string;
  /**
   * 技术身份（选项级）。同一 tech 字符串的**跨维度选项**在图上合并成同一个部署节点
   * （部署形态=k8s / 运行基座=k8s / 编排=k8s 都是 Kubernetes，只画一个盒子）。
   * 没声明 tech 的选项按「维度 id」生成唯一键，永不合并 —— 渲染器不猜「哪些是同一种技术」，
   * 这层事实由数据（stack_arch.py / stack_canvas_extra.py）声明。
   */
  tech?: string;
}
interface CanvasDim {
  place: 'node' | 'appTag' | 'side';
  zone?: string;
  tagLabel?: string;
}
interface CanvasZone {
  id: string;
  name: string;
  glyph: string;
  desc: string;
  /** 这一层在 Archify 七类组件里的归属。由数据说了算，渲染器不猜 */
  archifyType?: string;
}
interface CanvasLink {
  from: string;
  to: string;
  label: string;
  kind: 'solid' | 'dashed';
}

/**
 * 阅读路径的声明形式：用**分区与维度**指代焦点，不写死节点 id。
 * 没选到的槽位图上没有方块，写死了会被通用绘图器判成引用不存在的组件。
 */
export interface CanvasViewSpec {
  id: string;
  label: string;
  zones: string[];
  dims: string[];
  note: string;
}

const CANVAS = (archRaw as { canvas?: {
  zones: CanvasZone[];
  dims: Record<string, CanvasDim>;
  options: Record<string, Record<string, CanvasOption>>;
  links: CanvasLink[];
  legend?: Record<string, { label?: string }>;
  views?: CanvasViewSpec[];
} }).canvas;

export const CANVAS_ZONES: CanvasZone[] = CANVAS?.zones ?? [];
/** 导出给 Archify 时的图例文字覆盖（比如不让 cloud 那一类读作「云服务」） */
export const CANVAS_LEGEND: Record<string, { label?: string }> = CANVAS?.legend ?? {};
/** 导出给 Archify 时的阅读路径声明 */
export const CANVAS_VIEWS: CanvasViewSpec[] = CANVAS?.views ?? [];
const CANVAS_DIMS: Record<string, CanvasDim> = CANVAS?.dims ?? {};
const CANVAS_OPTIONS: Record<string, Record<string, CanvasOption>> = CANVAS?.options ?? {};
const CANVAS_LINKS: CanvasLink[] = CANVAS?.links ?? [];

/** 分区所属的 Archify 组件类型。找不到分区就没有默认值 —— 宁可留空也不猜 */
function zoneArchifyType(zoneId: string | undefined): string | undefined {
  return CANVAS_ZONES.find((z) => z.id === zoneId)?.archifyType;
}

// ─────────────────────────────────────────────────────────────
// 模型
// ─────────────────────────────────────────────────────────────

export type NodeKind = 'client' | 'app' | 'component' | 'side' | 'custom';

export interface CanvasNode {
  id: string;
  title: string;
  /** 副标题：角色说明或端口 */
  subtitle: string;
  icon: string;
  zone: string;
  kind: NodeKind;
  /** 应用卡里的工程属性（构建期 / 编码期的东西） */
  tags: { label: string; value: string; icon: string }[];
  /** 集群形态列表与当前选中项下标 */
  modes?: ClusterMode[];
  mode?: number;
  port?: string;
  /**
   * 交给通用绘图器导出时用：组件类型与品牌商标。
   * 在这里解析一次，两个渲染器就都拿到同一份事实 ——
   * 免得各画各的、慢慢画出两张互相矛盾的图来。
   */
  archifyType?: string;
  brand?: string;
  /** 技术身份（选项级）。同一 tech 的跨维度节点合并为单个部署节点，详见 mergeDuplicateTechNodes */
  tech?: string;
  /** 自动布局算出来的位置，编辑位移叠加在其上 */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CanvasEdge {
  from: string;
  to: string;
  label: string;
  kind: 'solid' | 'dashed';
  /** 连线标签上要不要带端口 */
  port?: string;
  /**
   * 同一组（同一段跨区路径）里的第几条 / 共几条。
   * 多条线挤在同一段竖路上时，水平段按这个错开 —— 要不然三条线的标签
   * 会叠在同一行上，图看上去像乱码。
   */
  lane?: number;
  lanes?: number;
  /**
   * 连线标签的纵向微调（绘图器 IR 的 `labelDy`）。
   * 上下直连的边默认位置会把标签骑在源节点框里，通用绘图器按
   * `layout/constraint` 当场判负 —— 这种边必须自己说挪多少。
   */
  labelDy?: number;
}

export interface CanvasEdits {
  /** 相对自动布局的位移 */
  offsets: Record<string, { x: number; y: number }>;
  /** 改名 */
  titles: Record<string, string>;
  /** 改副标题 */
  subtitles: Record<string, string>;
  /** 集群形态下标 */
  clusters: Record<string, number>;
  /** 隐藏的节点 */
  hidden: string[];
  /** 手加的节点 */
  added: CanvasNode[];
  /** 手加的连线 */
  links: { from: string; to: string; label: string; kind: 'solid' | 'dashed' }[];
}

export function emptyEdits(): CanvasEdits {
  return { offsets: {}, titles: {}, subtitles: {}, clusters: {}, hidden: [], added: [], links: [] };
}

export interface TechArch {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  zones: { zone: CanvasZone; x: number; y: number; w: number; h: number }[];
  width: number;
  height: number;
  /** 这套组合里"根本没选"的中间件，交付说明里要写出来 */
  absent: { dimId: string; name: string }[];
}

// ─────────────────────────────────────────────────────────────
// 版式常量
// ─────────────────────────────────────────────────────────────

const PAD = 44;
const ZONE_PAD_Y = 30;
const ZONE_GAP = 32;
const NODE_GAP = 26;
const APP_W = 372;
const NODE_W = 214;
const NODE_H = 78;
const SIDE_W = 150;
const SIDE_H = 62;
const CLIENT_W = 150;
const CLIENT_H = 58;
const TAG_H = 22;

/** 全套 SVG 渲染器共用这两个字体常量 —— 导出是为了 `service-graph.ts` 复用同一处，
 *  各渲染器各写一份字体栈，改了一处另一处的图会慢慢长得不一样（而没有任何东西会报错）。 */
export const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
export const MONO = "'Cascadia Code','JetBrains Mono',Consolas,monospace";

// ─────────────────────────────────────────────────────────────
// 建模：选型 → 节点
// ─────────────────────────────────────────────────────────────

/** "Redis（分布式缓存）" → 主名 Redis + 备注 分布式缓存。交付图上标题必须短。 */
function splitParens(name: string): [string, string] {
  const m = name.match(/^(.*?)\s*[（(]([^）)]+)[）)]\s*$/);
  return m ? [m[1], m[2]] : [name, ''];
}

function optionName(dimId: string, optId: string | undefined): string {
  if (!optId) return '未选择';
  const dim = dimensions.find((d) => d.id === dimId);
  return dim?.options.find((o) => o.id === optId)?.name ?? optId;
}

function canvasOpt(dimId: string, optId: string | undefined): CanvasOption | undefined {
  if (!optId) return undefined;
  return CANVAS_OPTIONS[dimId]?.[optId];
}

/**
 * 图上显示的选项名。选项自己声明了短名（`label`）就用短名 ——
 * 全名是给选型界面读的，交付图上它会被卡片宽度裁掉半截。
 * 两个渲染器共用这一处，图与图之间不会出现「一个写全名一个写短名」。
 */
function displayName(dimId: string, optId: string | undefined): string {
  return canvasOpt(dimId, optId)?.label ?? optionName(dimId, optId);
}

/** 选项是不是「不用 / 不使用」这一类 —— 这类不画节点，画了等于画了个空盒子 */
function isNoneOption(optId: string | undefined): boolean {
  return !optId || optId === 'none';
}

export function buildTechArch(
  picks: StackPicks,
  edits: CanvasEdits = emptyEdits(),
  opts: {
    controlPlane?: boolean;
    /**
     * 形态覆盖表（由 `nodeTopologyMap()` 生成）。给了就**取代**静态的 `cluster` 声明，
     * 于是「装配台上选了分片」这件事会真的画到图上：叠层数、×N 徽章一起变。
     */
    topology?: Record<string, { modes: { name: string; replicas: number }[]; mode: number }>;
  } = {}
): TechArch {
  const nodes: CanvasNode[] = [];
  const absent: { dimId: string; name: string }[] = [];
  const appTags: { label: string; value: string; icon: string }[] = [];
  const hidden = new Set(edits.hidden);

  // ── 客户端：固定节点，不属于任何选型 ──
  nodes.push({
    id: 'client',
    title: '客户端',
    subtitle: '浏览器 / 移动端 / 三方系统',
    icon: 'client',
    zone: 'client',
    kind: 'client',
    tags: [],
    archifyType: zoneArchifyType('client'),
    x: 0, y: 0, w: CLIENT_W, h: CLIENT_H,
  });

  // ── 应用卡 ──
  const webOpt = picks.web;
  const webSpec = canvasOpt('web', webOpt);
  const webIcon = webSpec?.icon ?? 'spring';
  const webPort = webSpec?.port;
  const appTopo = opts.topology?.app;
  const appNode: CanvasNode = {
    id: 'app',
    title: `${displayName('web', webOpt)} 应用`,
    subtitle: webPort ? `Spring Boot 进程 · :${webPort}` : 'Spring Boot 进程',
    icon: webIcon,
    zone: 'app',
    kind: 'app',
    tags: [],
    port: webPort,
    // 应用方块自己没有维度，它的品牌只能挂在 web 那一维的选项上
    brand: webSpec?.brand,
    archifyType: zoneArchifyType('app'),
    modes: appTopo?.modes,
    mode: appTopo?.mode,
    x: 0, y: 0, w: APP_W, h: 96,
  };
  nodes.push(appNode);

  // ── 各维度：进应用卡的标签 / 独立节点 / 旁路件 ──
  for (const dim of dimensions) {
    const spec = CANVAS_DIMS[dim.id];
    if (!spec) continue;
    const optId = picks[dim.id];
    const opt = canvasOpt(dim.id, optId);
    // 落位先看选项自己的声明：Caffeine 与 Redis 是同一个维度，但一个在进程内、一个要起进程
    const place = opt?.place ?? spec.place;

    if (place === 'appTag') {
      if (isNoneOption(optId)) continue;
      appTags.push({
        label: spec.tagLabel ?? dim.name,
        value: displayName(dim.id, optId),
        icon: opt?.icon ?? 'generic',
      });
      continue;
    }

    if (isNoneOption(optId)) {
      absent.push({ dimId: dim.id, name: dim.name });
      continue;
    }

    const isSide = place === 'side';
    const nodeZone = spec.zone ?? 'mw';
    const [mainName, noteName] = splitParens(displayName(dim.id, optId));
    const node: CanvasNode = {
      id: dim.id,
      title: mainName,
      subtitle: noteName ? `${dim.name} · ${noteName}` : dim.name,
      icon: opt?.icon ?? 'generic',
      zone: nodeZone,
      kind: isSide ? 'side' : 'component',
      tags: [],
      // 形态覆盖优先：装配台上选的集群形态比 architecture.json 里的静态声明更权威
      modes: opts.topology?.[dim.id]?.modes ?? opt?.cluster,
      mode:
        opts.topology?.[dim.id]?.mode ??
        (opt?.cluster ? (edits.clusters[dim.id] ?? 0) : undefined),
      port: opt?.port,
      // 类型先看选项自己的声明，再退回分区给的那一层性质
      archifyType: opt?.archifyType ?? zoneArchifyType(nodeZone),
      brand: opt?.brand,
      tech: opt?.tech,
      x: 0, y: 0,
      w: isSide ? SIDE_W : NODE_W,
      h: isSide ? SIDE_H : NODE_H,
    };
    nodes.push(node);
  }

  // ── 同技术合并：选项级 tech 身份相同的跨维度节点（如 deploy=k8s / orchestration=k8s /
  //    os=k8s 都 tech:"kubernetes"）只画一个节点，避免「两个一模一样的 Kubernetes 盒子」。
  //    合并判据是数据声明的 tech，不是图标 —— 图标相同但系统不同的（Solr / Doris 都
  //    columnar 图标）不会被误并。存活节点优先取被连线表引用到的 id（保留 deploy→app
  //    这类边），其余维度的角色并进取 subtitle。逐字节对照的断言在 graph-check.ts。
  mergeDuplicateTechNodes(nodes, CANVAS_LINKS, dimensions);

  appNode.tags = appTags;
  // 工程属性按两列排，行数决定卡高
  const tagRows = Math.max(1, Math.ceil(appTags.length / 2));
  appNode.h = 96 + tagRows * TAG_H;

  // ── 手加的节点 ──
  for (const n of edits.added) nodes.push({ ...n });

  // ── 连线 ──
  // 端点必须真的在图上：选项落到「进程内」时（Caffeine / @Scheduled / Actuator）
  // 它没有节点位，指向它的连线必须一起消失 —— 否则图上会出现一根连到空气里的线。
  const onCanvas = new Set(nodes.map((n) => n.id));
  const edges: CanvasEdge[] = [];
  const portOf = (id: string) => nodes.find((n) => n.id === id)?.port;
  for (const link of CANVAS_LINKS) {
    if (hidden.has(link.from) || hidden.has(link.to)) continue;
    if (!onCanvas.has(link.from) || !onCanvas.has(link.to)) continue;
    edges.push({ ...link, port: portOf(link.to) || portOf(link.from) });
  }
  for (const l of edits.links) {
    if (hidden.has(l.from) || hidden.has(l.to)) continue;
    if (!onCanvas.has(l.from) || !onCanvas.has(l.to)) continue;
    edges.push({ ...l, port: portOf(l.to) || portOf(l.from) });
  }

  // ── 请求入口改道：ingress / gateway 一旦选中，流量必须穿过它们，
  //    不能还是 client→app 直连（否则反向代理节点悬空，图上自相矛盾）。
  //    改道在连线表之后做：先按静态表连好，再据 picks 把入口路径重画一遍。
  rerouteEntryThroughGateway(edges, onCanvas, portOf);

  // 同一对分区之间的多条线，水平段依次错开 18px，标签就不会叠成一行
  const zoneOf = (id: string) => nodes.find((n) => n.id === id)?.zone ?? '?';
  const byPair = new Map<string, CanvasEdge[]>();
  for (const e of edges) {
    const key = `${zoneOf(e.from)}>${zoneOf(e.to)}`;
    const list = byPair.get(key) ?? [];
    list.push(e);
    byPair.set(key, list);
  }
  for (const list of byPair.values()) {
    list.forEach((e, i) => {
      e.lane = i;
      e.lanes = list.length;
    });
  }

  // ── 布局 ──
  const visible = nodes.filter((n) => !hidden.has(n.id));
  layout(visible, canvasZoneOrder(opts.controlPlane === true));

  // ── 位移 ──
  for (const n of nodes) {
    const off = edits.offsets[n.id];
    if (off) {
      n.x += off.x;
      n.y += off.y;
    }
    const t = edits.titles[n.id];
    if (t) n.title = t;
    const st = edits.subtitles[n.id];
    if (st) n.subtitle = st;
  }

  const boxes = visible.map((n) => ({
    x0: n.x, y0: n.y, x1: n.x + n.w, y1: n.y + n.h,
  }));
  const stack = clusterStack(nodes);
  for (const s of stack) {
    boxes.push({ x0: s.x, y0: s.y, x1: s.x + s.w, y1: s.y + s.h });
  }

  const minX = Math.min(...boxes.map((b) => b.x0));
  const minY = Math.min(...boxes.map((b) => b.y0));
  const maxX = Math.max(...boxes.map((b) => b.x1));
  const maxY = Math.max(...boxes.map((b) => b.y1));

  const zones = zoneBoxes(nodes.filter((n) => !hidden.has(n.id)), minX);

  return {
    nodes,
    edges,
    zones,
    width: Math.round(maxX - minX + PAD * 2),
    height: Math.round(maxY - minY + PAD * 2 + 34),
    absent,
  };
}

/**
 * 按分区自顶向下排：每个分区一行，行内居中。
 *
 * `order` 由 `canvasZoneOrder()` 给出 —— 控制面分离只改这一个参数，
 * 其余几何一寸不动（行高、行距、列宽全部照旧）。
 */
function layout(nodes: CanvasNode[], order: string[] = canvasZoneOrder()) {
  const byZone = new Map<string, CanvasNode[]>();
  for (const n of nodes) {
    const list = byZone.get(n.zone) ?? [];
    list.push(n);
    byZone.set(n.zone, list);
  }
  const widths = order.map((zid) => {
    const list = byZone.get(zid) ?? [];
    if (!list.length) return 0;
    return list.reduce((s, n) => s + n.w, 0) + NODE_GAP * (list.length - 1);
  });
  const inner = Math.max(APP_W, ...widths);

  let y = PAD + 34;
  for (let i = 0; i < order.length; i += 1) {
    const list = byZone.get(order[i]);
    if (!list || !list.length) continue;
    const rowW = widths[i];
    let x = PAD + (inner - rowW) / 2;
    for (const n of list) {
      n.x = x;
      n.y = y + ZONE_PAD_Y;
      x += n.w + NODE_GAP;
    }
    const rowH = Math.max(...list.map((n) => n.h));
    y += rowH + ZONE_PAD_Y * 2 + ZONE_GAP;
  }
}

/** 集群堆叠：副本数 >1 时在卡后面垫几张错位卡 */
function clusterStack(nodes: CanvasNode[]) {
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (const n of nodes) {
    if (!n.modes || n.mode === undefined) continue;
    const replicas = n.modes[n.mode]?.replicas ?? 1;
    const extra = Math.min(replicas - 1, 3);
    for (let i = 1; i <= extra; i += 1) {
      out.push({ x: n.x + i * 7, y: n.y - i * 6, w: n.w, h: n.h });
    }
  }
  return out;
}

/**
 * 同技术合并：选项级 tech 身份相同的维度节点，视为同一技术实体，只保留一个节点。
 * 典型现场：`deploy=k8s` / `orchestration=k8s` / `os=k8s` 都声明 `tech:"kubernetes"`，
 * 原样会出「两个一模一样的 Kubernetes 盒子」；合并后一个节点，
 * 副标题把各维度的角色并起来（如「交付形态 + 编排调度 + 运行基石」）。
 *
 * 存活节点优先取**被连线表引用到**的那个 id，确保 `deploy→app` 这类既有边不丢；
 * 端口 / 集群形态取第一个非空来源。被合并掉的节点从 `nodes` 中移除。
 *
 * 只作用于「落到独立节点位」的维度节点（`kind==='component'` 且 id 是已知维度）；
 * client / app / 旁路件(side) / 手加节点都不参与，避免误吞。
 */
function mergeDuplicateTechNodes(
  nodes: CanvasNode[],
  links: CanvasLink[],
  dims: { id: string; name: string }[]
): void {
  const dimName = (id: string) => dims.find((d) => d.id === id)?.name ?? id;
  const linkIds = new Set(links.flatMap((l) => [l.from, l.to]));
  const candidates = nodes.filter(
    (n) => n.kind === 'component' && dims.some((d) => d.id === n.id)
  );
  const groups = new Map<string, CanvasNode[]>();
  for (const n of candidates) {
    // 数据驱动：同一 tech 字符串的跨维度选项合并为单节点。
    // 选项没声明 tech 时按「维度 id」生成唯一键，永不合并（避免把 Solr / Doris
    // 这类同图标但不同系统的东西误并成一张图）。
    const key = n.tech ? `tech:${n.tech}` : `__uniq__:${n.id}`;
    const list = groups.get(key) ?? [];
    list.push(n);
    groups.set(key, list);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const survivor = group.find((n) => linkIds.has(n.id)) ?? group[0];
    const merged = group.filter((n) => n !== survivor);
    survivor.subtitle = group.map((n) => dimName(n.id)).join(' + ');
    if (!survivor.port) {
      const otherPort = merged.find((n) => n.port)?.port;
      if (otherPort) survivor.port = otherPort;
    }
    if (!survivor.modes) {
      const otherModes = merged.find((n) => n.modes)?.modes;
      const otherMode = merged.find((n) => n.mode !== undefined)?.mode;
      if (otherModes) {
        survivor.modes = otherModes;
        survivor.mode = otherMode ?? 0;
      }
    }
    for (const m of merged) {
      const i = nodes.indexOf(m);
      if (i >= 0) nodes.splice(i, 1);
    }
  }
}

/**
 * 请求入口改道：当 `ingress` 或 `gateway` 节点在图上时，把 `client→app` 直连改成
 * `client→ingress→(gateway)→app` 的链路，让反向代理 / 网关真正落在请求路径上，
 * 而不是孤零零悬空。没有任何入口节点时（纯直连架构）保持 `client→app` 不变。
 */
function rerouteEntryThroughGateway(
  edges: CanvasEdge[],
  onCanvas: Set<string>,
  portOf: (id: string) => string | undefined
): void {
  const has = (id: string) => onCanvas.has(id);
  if (!has('ingress') && !has('gateway')) return;
  for (let i = edges.length - 1; i >= 0; i--) {
    if (edges[i].from === 'client' && edges[i].to === 'app') edges.splice(i, 1);
  }
  const chain: string[] = ['client'];
  if (has('ingress')) chain.push('ingress');
  if (has('gateway')) chain.push('gateway');
  chain.push('app');
  for (let i = 0; i < chain.length - 1; i++) {
    const from = chain[i];
    const to = chain[i + 1];
    const isEntry = from === 'client';
    const port = portOf(to) || (isEntry ? portOf(from) : undefined);
    edges.push({
      from,
      to,
      label: i === 0 ? 'HTTPS' : from === 'ingress' ? '路由转发' : 'HTTP',
      kind: 'solid',
      port,
      // 入口链的第一条走车道（有 via 折线，标签骑竖段）；后面的都是上下直连，
      // 默认标签位置落在源节点框内 —— 绘图器实跑出图会按 layout/constraint 判负。
      // 24 = 校验器给的建议值（把标签压到源框下沿之外的走廊里）。
      labelDy: i === 0 ? undefined : 24,
    });
  }
}

function zoneBoxes(nodes: CanvasNode[], _minX: number) {
  const byZone = new Map<string, CanvasNode[]>();
  for (const n of nodes) {
    const list = byZone.get(n.zone) ?? [];
    list.push(n);
    byZone.set(n.zone, list);
  }
  const out: TechArch['zones'] = [];
  for (const z of CANVAS_ZONES) {
    const list = byZone.get(z.id);
    if (!list || !list.length) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of list) {
      x0 = Math.min(x0, n.x);
      y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + n.w);
      y1 = Math.max(y1, n.y + n.h);
    }
    out.push({ zone: z, x: x0 - 20, y: y0 - 26, w: x1 - x0 + 40, h: y1 - y0 + 46 });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 渲染
// ─────────────────────────────────────────────────────────────

/**
 * 五套主题。前两套给屏幕（编辑器里看着舒服），后三套给**交付物**：
 *
 * - `doc` —— 白底黑线、去网格去辉光。要贴进 Word / 打印，屏幕上的辉光在纸上就是一片脏。
 * - `slide` —— 深色大屏。投影仪对比度低，所以底色比 `dark` 更深、字更亮、线更粗一档。
 * - `blueprint` —— 工程蓝图（深蓝底 + 冷白细线 + 明显网格）。给「架构评审」这种场合。
 *
 * 主题只改**呈现**，不改任何几何与判定 —— 同一份 `TechArch` 换主题重渲染，节点坐标逐像素不变。
 */
export type CanvasTheme = 'dark' | 'light' | 'doc' | 'slide' | 'blueprint';

export interface Palette {
  /** 底色是深的吗。渐变叠层、投影浓度这些跟明暗走，跟具体是哪一套无关 */
  dark: boolean;
  bg0: string; bg1: string; grid: string; glow: string;
  zone: string; zoneLine: string;
  card: string; cardLine: string;
  title: string; sub: string; faint: string;
  edge: string; edgeDashed: string; labelBg: string; labelFg: string;
  chipBg: string; chipFg: string;
  shadow: string;
}

const DARK: Palette = {
  dark: true,
  bg0: '#0A0F0E', bg1: '#111A19', grid: 'rgba(255,255,255,0.035)', glow: 'rgba(120,200,180,0.10)',
  zone: 'rgba(255,255,255,0.022)', zoneLine: 'rgba(255,255,255,0.07)',
  card: '#16211F', cardLine: 'rgba(255,255,255,0.10)',
  title: '#EAF2F0', sub: '#9BAFB0', faint: '#6A7F80',
  edge: '#5C7C78', edgeDashed: '#3E5A57', labelBg: '#0E1514', labelFg: '#B8CFCB',
  chipBg: 'rgba(255,255,255,0.05)', chipFg: '#9BAFB0',
  shadow: 'rgba(0,0,0,0.45)',
};
const LIGHT: Palette = {
  dark: false,
  bg0: '#F6F8F7', bg1: '#EDF2F1', grid: 'rgba(20,40,40,0.045)', glow: 'rgba(40,120,110,0.07)',
  zone: 'rgba(255,255,255,0.75)', zoneLine: 'rgba(20,50,50,0.12)',
  card: '#FFFFFF', cardLine: 'rgba(20,50,50,0.14)',
  title: '#12211F', sub: '#5B6F6E', faint: '#8A9C9B',
  edge: '#6B8A86', edgeDashed: '#9DB6B2', labelBg: '#FFFFFF', labelFg: '#3B5451',
  chipBg: 'rgba(20,60,55,0.06)', chipFg: '#4A625F',
  shadow: 'rgba(20,40,40,0.14)',
};

/** 文档：纯白底、细灰线，打印出来不糊。网格与辉光都断开 —— 纸面不需要它们 */
const DOC: Palette = {
  dark: false,
  bg0: '#FFFFFF', bg1: '#FBFCFC', grid: 'transparent', glow: 'transparent',
  zone: 'rgba(15,35,35,0.018)', zoneLine: '#D6DEE1',
  card: '#FFFFFF', cardLine: '#C4D0D4',
  title: '#15201F', sub: '#556664', faint: '#869796',
  edge: '#5C6B6A', edgeDashed: '#A6B4B3', labelBg: '#FFFFFF', labelFg: '#394847',
  chipBg: '#F0F4F4', chipFg: '#485857',
  shadow: 'rgba(20,40,40,0.07)',
};

/** 演示：比 dark 更暗的底、更亮的字，投影仪上才分得清 */
const SLIDE: Palette = {
  dark: true,
  bg0: '#080D14', bg1: '#131C28', grid: 'rgba(255,255,255,0.028)', glow: 'rgba(90,159,212,0.16)',
  zone: 'rgba(255,255,255,0.03)', zoneLine: 'rgba(255,255,255,0.10)',
  card: '#1A2431', cardLine: 'rgba(255,255,255,0.14)',
  title: '#F4F8FC', sub: '#AABBCB', faint: '#718397',
  edge: '#7FA6C8', edgeDashed: '#455C74', labelBg: '#121B27', labelFg: '#C6D8E8',
  chipBg: 'rgba(255,255,255,0.06)', chipFg: '#AABBCB',
  shadow: 'rgba(0,0,0,0.55)',
};

/** 蓝图：深蓝底 + 冷白细线 + 明显网格。评审场合的「工程图纸」质感 */
const BLUEPRINT: Palette = {
  dark: true,
  bg0: '#0B2340', bg1: '#08192E', grid: 'rgba(190,220,255,0.075)', glow: 'rgba(130,195,255,0.12)',
  zone: 'rgba(255,255,255,0.035)', zoneLine: 'rgba(196,222,255,0.20)',
  card: '#10304F', cardLine: 'rgba(170,210,255,0.30)',
  title: '#EBF4FF', sub: '#AAC7E8', faint: '#6F92BA',
  edge: '#93BBE2', edgeDashed: '#4D7496', labelBg: '#0A2138', labelFg: '#D4E8FB',
  chipBg: 'rgba(150,200,255,0.10)', chipFg: '#AAC7E8',
  shadow: 'rgba(0,10,25,0.55)',
};

const PALETTES: Record<CanvasTheme, Palette> = {
  dark: DARK, light: LIGHT, doc: DOC, slide: SLIDE, blueprint: BLUEPRINT,
};

/**
 * 取调色板。**分层的图与部署图必须共用这一处** ——
 * 两套渲染器各自写一份配色，改了一处另一处不报错，两张图会慢慢变成两种风格。
 */
export function themePalette(theme: CanvasTheme): Palette {
  return PALETTES[theme] ?? DARK;
}

/**
 * 主题清单与中文名。**UI 不许自己再写一份** ——
 * 主题列表写两处，改一处不报错：选择器里少了选项、或者选了却渲染成默认主题。
 */
export const CANVAS_THEME_OPTIONS: { id: CanvasTheme; label: string; hint: string }[] = [
  { id: 'dark', label: '深色', hint: '屏幕阅读' },
  { id: 'light', label: '浅色', hint: '屏幕阅读' },
  { id: 'doc', label: '文档', hint: '白底去网格 · 贴进说明书 / 打印' },
  { id: 'slide', label: '演示', hint: '高对比深色 · 投影用' },
  { id: 'blueprint', label: '蓝图', hint: '工程图纸质感 · 评审用' },
];

/** 分区强调色 —— 按序循环，只用于装饰性描边与标题刻度，不承载语义 */
const ZONE_ACCENTS = ['#5A9FD4', '#7FBF6A', '#D4A45A', '#9F7FC4', '#5FC4AF', '#C46A6A'];

/**
 * 控制面分区：注册/配置中心（mw）+ 观测运维（ops）。
 *
 * 这两个分区里的东西挂了，业务请求照样跑完 —— 代价是「你有多久才知道它挂了」。
 * 所以它们在交付图上本该分开看，而不是和业务节点混在一列里。
 */
export const CONTROL_PLANE_ZONES = ['mw', 'ops'];

/**
 * 分区自上而下的顺序。
 *
 * 控制面分离打开时把控制面挪到最后 —— **「画在下方一条带里」是靠改版式顺序做到的**，
 * 不是在原地画个虚线框假装分开。顺序一变，节点坐标与连线路径全部跟着重算，
 * 所以它只能是 `buildTechArch` 的入参，不能是渲染期的装饰。
 */
export function canvasZoneOrder(controlPlane = false): string[] {
  const ids = CANVAS_ZONES.map((z) => z.id);
  if (!controlPlane) return ids;
  return [
    ...ids.filter((id) => !CONTROL_PLANE_ZONES.includes(id)),
    ...ids.filter((id) => CONTROL_PLANE_ZONES.includes(id)),
  ];
}

/** 页脚图例高度：图例是交付图的一部分，打印出来也得能读懂符号 */
const FOOT_H = 44;

export interface SvgExportOpts {
  title?: string;
  subtitle?: string;
  /** 交互态：带 data-node 钩子、不放动效。导出的图不用它 */
  hooks?: boolean;
  /** 分区色带：每个分区铺一层极浅的强调色，远处一眼分清边界。缺省开 */
  bands?: boolean;
  /** 控制面 / 数据面分离。**必须与 buildTechArch 的同一个开关一起用** ——
   *  版式已经分过了，这里只补分隔线与带名 */
  controlPlane?: boolean;
  /** 输出像素倍率。1 = 原尺寸；1.5 给 2400px 高清版（viewBox 不变，不会变形） */
  scale?: number;
  /** 文字最少化：节点上只留图标 + 名称，端口收进脚注、副标题与工程属性不画 */
  lean?: boolean;
}

export function buildTechArchSvg(
  arch: TechArch,
  theme: CanvasTheme = 'dark',
  opts: SvgExportOpts = {}
): string {
  const p = themePalette(theme);
  const title = opts.title ?? '';
  const subtitle = opts.subtitle ?? '';
  const scale = Math.max(1, opts.scale ?? 1);
  const bands = opts.bands !== false;
  const lean = opts.lean === true;
  // 精简模式把端口从节点上摘下来，就必须在别处给回去 —— 否则图上是干净了，
  // 「服务跑在哪个端口」这个信息直接消失。脚注就是那个「别处」。
  const portList = arch.nodes
    .filter((n) => n.port)
    .map((n) => `${n.title} :${n.port}`);
  const FOOT_NOTE_H = lean && portList.length ? 22 : 0;
  const headH = title ? 62 : 24;
  const W = arch.width;
  const H = arch.height + headH + FOOT_H + FOOT_NOTE_H;
  const dx = 0;
  const dy = headH;
  const o: string[] = [];

  o.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${r(W * scale)}" height="${r(H * scale)}" viewBox="0 0 ${W} ${H}" ` +
    `role="img" aria-label="${escapeXml(title || '技术架构图')}">`
  );
  o.push(`<defs>` +
    `<linearGradient id="ta-bg" x1="0" y1="0" x2="0.7" y2="1">` +
    `<stop offset="0" stop-color="${p.bg0}"/><stop offset="1" stop-color="${p.bg1}"/></linearGradient>` +
    `<radialGradient id="ta-glow" cx="0.5" cy="0" r="0.75">` +
    `<stop offset="0" stop-color="${p.glow}"/><stop offset="1" stop-color="transparent"/></radialGradient>` +
    `<linearGradient id="ta-cardg" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#FFFFFF" stop-opacity="${p.dark ? 0.05 : 0.45}"/>` +
    `<stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient>` +
    `<pattern id="ta-grid" width="26" height="26" patternUnits="userSpaceOnUse">` +
    `<path d="M26 0H0V26" fill="none" stroke="${p.grid}" stroke-width="1"/></pattern>` +
    `<filter id="ta-shadow" x="-20%" y="-20%" width="150%" height="150%">` +
    `<feDropShadow dx="0" dy="3" stdDeviation="5" flood-color="${p.shadow}"/></filter>` +
    `<marker id="ta-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
    `<path d="M0 0 10 5 0 10 z" fill="${p.edge}"/></marker>` +
    `<marker id="ta-arrow-d" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">` +
    `<path d="M0 0 10 5 0 10 z" fill="${p.edgeDashed}"/></marker>` +
    `</defs>`
  );
  // 动效样式表内嵌在 SVG 里 —— 导出的 .svg 单独打开照样会动。
  // 交互态（hooks）不加：拖拽时元素在动会影响手感，且每次重绘都要重放一遍入场。
  if (!opts.hooks) o.push(svgMotionStyle());
  o.push(`<rect width="${W}" height="${H}" fill="url(#ta-bg)"/>`);
  o.push(`<rect width="${W}" height="${H}" fill="url(#ta-glow)"/>`);
  o.push(`<rect width="${W}" height="${H}" fill="url(#ta-grid)"/>`);

  // ── 标题 ──
  if (title) {
    o.push(`<text x="30" y="34" font-family="${FONT}" font-size="19" font-weight="700" fill="${p.title}">${escapeXml(title)}</text>`);
    if (subtitle) {
      o.push(`<text x="30" y="52" font-family="${FONT}" font-size="11.5" fill="${p.sub}">${escapeXml(subtitle)}</text>`);
    }
    // 标题行右端：一枚出处角标 —— 交付图要能看出来自谁
    o.push(
      `<g font-family="${MONO}" font-size="10" fill="${p.faint}">` +
      `<rect x="${W - 196}" y="20" width="166" height="24" rx="7" fill="${p.chipBg}" stroke="${p.zoneLine}"/>` +
      `<text x="${W - 113}" y="36" text-anchor="middle" letter-spacing="0.8">杨先生的军火库 · arsenal</text></g>`
    );
  }

  // ── 分区 ──
  arch.zones.forEach((z, zi) => {
    const x = z.x + dx, y = z.y + dy, w = z.w, h = z.h;
    const accent = ZONE_ACCENTS[zi % ZONE_ACCENTS.length];
    o.push(`<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="14" fill="${p.zone}" stroke="${p.zoneLine}" stroke-width="1"/>`);
    // 分区色带：把强调色极浅地铺满整块分区。顶边那条细线在缩略图上会消失，
    // 一层色带不会 —— 缩到 30% 也能看出「这里是三块，不是一块」。
    if (bands) {
      o.push(`<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="14" fill="${accent}" opacity="${p.dark ? 0.055 : 0.04}"/>`);
    }
    // 分区顶边强调条（内缩避开圆角）—— 远处一眼分清分区边界
    o.push(`<rect x="${r(x + 18)}" y="${r(y)}" width="${r(Math.max(0, w - 36))}" height="2.5" rx="1.25" fill="${accent}" opacity="0.55"/>`);
    // 标题悬浮在框外左上：节点正上方是连线标签的位置，标题挤进去必然打架。
    // 标题前加强调刻度、后缀节点计数 —— 计数是核对点：图上数字与选型对不上就是漏画。
    const label = `${z.zone.glyph} ${z.zone.name}`;
    const nodeCount = arch.nodes.filter((n) => n.zone === z.zone.id).length;
    o.push(`<rect x="${r(x + 6)}" y="${r(y - 17)}" width="3" height="12" rx="1.5" fill="${accent}"/>`);
    o.push(`<text x="${r(x + 15)}" y="${r(y - 8)}" font-family="${FONT}" font-size="11" font-weight="700" fill="${p.sub}" letter-spacing="0.6">${escapeXml(label)}</text>`);
    o.push(
      `<g font-family="${MONO}" font-size="9" fill="${p.faint}">` +
      `<rect x="${r(x + 21 + textW(label, 11))}" y="${r(y - 17)}" width="40" height="16" rx="8" fill="${p.chipBg}" stroke="${p.zoneLine}"/>` +
      `<text x="${r(x + 41 + textW(label, 11))}" y="${r(y - 6)}" text-anchor="middle">${nodeCount} 节点</text></g>`
    );
  });

  // ── 控制面 / 数据面分离的标注 ──
  //
  // 版式顺序已经在 buildTechArch 里分过了，这里补的只是「读图的人怎么知道自己
  // 在看哪一面」。带名右对齐，躲开分区自己的悬浮标题（那个在左侧）。
  if (opts.controlPlane) {
    const dataZones = arch.zones.filter((z) => !CONTROL_PLANE_ZONES.includes(z.zone.id));
    const ctrlZones = arch.zones.filter((z) => CONTROL_PLANE_ZONES.includes(z.zone.id));
    const bandMark = (text: string, top: number, dashed: boolean) => {
      const y = top - 9;
      return (
        (dashed
          ? `<line x1="${r(W - 520)}" y1="${r(y)}" x2="${r(W - 300)}" y2="${r(y)}" stroke="${p.zoneLine}" stroke-width="1" stroke-dasharray="6 5"/>`
          : `<line x1="${r(W - 520)}" y1="${r(y)}" x2="${r(W - 300)}" y2="${r(y)}" stroke="${p.zoneLine}" stroke-width="1"/>`) +
        `<text x="${r(W - 30)}" y="${r(y + 4)}" text-anchor="end" font-family="${FONT}" font-size="10.5" ` +
        `font-weight="700" letter-spacing="1.1" fill="${p.faint}">${escapeXml(text)}</text>`
      );
    };
    if (dataZones.length) {
      o.push(bandMark('数据面 · 业务代码与它自己的数据', Math.min(...dataZones.map((z) => z.y + dy)), false));
    }
    if (ctrlZones.length) {
      o.push(bandMark('控制面 · 注册 / 配置 / 观测', Math.min(...ctrlZones.map((z) => z.y + dy)), true));
    }
  }

  // ── 连线（先画线，节点压在上面） ──
  for (const [ei, e] of arch.edges.entries()) {
    const a = arch.nodes.find((n) => n.id === e.from);
    const b = arch.nodes.find((n) => n.id === e.to);
    if (!a || !b) continue;
    const d = routeEdge(a, b, dx, dy, e.lane ?? 0, e.lanes ?? 1);
    const color = e.kind === 'dashed' ? p.edgeDashed : p.edge;
    const marker = e.kind === 'dashed' ? 'ta-arrow-d' : 'ta-arrow';
    // 虚线本来就是"在流动"，让它真流动；实线保持实线，另叠一条跑动光带
    const motion = opts.hooks ? '' : e.kind === 'dashed' ? ' class="am-flow-slow"' : '';
    o.push(
      `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" ` +
      `${e.kind === 'dashed' ? 'stroke-dasharray="5 4" ' : ''}marker-end="url(#${marker})"${motion}/>`
    );
    if (!opts.hooks && e.kind !== 'dashed') {
      o.push(
        `<path d="${d}" fill="none" stroke="${p.title}" stroke-width="2.6" stroke-linecap="round" ` +
        `stroke-dasharray="16 220" opacity="0.26" class="am-run" style="animation-delay:${(ei % 5) * 0.42}s"/>`
      );
    }
    const m = edgeLabelPoint(a, b, dx, dy, e.lane ?? 0, e.lanes ?? 1);
    const text = e.port ? `${e.label} · :${e.port}` : e.label;
    const tw = Math.max(34, text.length * 6.4 + 14);
    o.push(
      `<rect x="${r(m.x - tw / 2)}" y="${r(m.y - 9)}" width="${r(tw)}" height="18" rx="9" ` +
      `fill="${p.labelBg}" stroke="${p.zoneLine}" stroke-width="1"/>`
    );
    o.push(
      `<text x="${r(m.x)}" y="${r(m.y + 4)}" font-family="${FONT}" font-size="10" ` +
      `text-anchor="middle" fill="${p.labelFg}">${escapeXml(text)}</text>`
    );  }

  // ── 节点 ──
  for (const [ni, n] of arch.nodes.entries()) {
    const stack = clusterStack([n]);
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      const s = stack[i];
      o.push(
        `<rect x="${r(s.x + dx)}" y="${r(s.y + dy)}" width="${r(s.w)}" height="${r(s.h)}" rx="11" ` +
        `fill="${p.card}" stroke="${p.cardLine}" stroke-width="1" opacity="${0.55 - i * 0.12}"/>`
      );
    }
    o.push(nodeSvg(n, p, dx, dy, opts.hooks === true, ni, lean));
  }

  // ── 页脚图例：符号不解释，读图的人就得猜 ──
  {
    const fy = arch.height + headH;
    const ly = fy + FOOT_H / 2;
    o.push(`<line x1="0" y1="${r(fy)}" x2="${W}" y2="${r(fy)}" stroke="${p.zoneLine}" stroke-width="1"/>`);
    const legendParts: string[] = [];
    legendParts.push(
      `<line x1="30" y1="${r(ly)}" x2="62" y2="${r(ly)}" stroke="${p.edge}" stroke-width="1.5" marker-end="url(#ta-arrow)"/>` +
      `<text x="70" y="${r(ly + 3.5)}" font-family="${FONT}" font-size="10" fill="${p.faint}">调用 / 数据流</text>`
    );
    legendParts.push(
      `<line x1="196" y1="${r(ly)}" x2="228" y2="${r(ly)}" stroke="${p.edgeDashed}" stroke-width="1.5" stroke-dasharray="5 4" marker-end="url(#ta-arrow-d)"/>` +
      `<text x="236" y="${r(ly + 3.5)}" font-family="${FONT}" font-size="10" fill="${p.faint}">异步 / 配置注入</text>`
    );
    legendParts.push(
      `<text x="380" y="${r(ly + 3.5)}" font-family="${MONO}" font-size="10.5" font-weight="700" fill="${p.sub}">×N</text>` +
      `<text x="404" y="${r(ly + 3.5)}" font-family="${FONT}" font-size="10" fill="${p.faint}">集群副本数</text>` +
      `<text x="500" y="${r(ly + 3.5)}" font-family="${MONO}" font-size="10.5" fill="${p.sub}">:port</text>` +
      `<text x="536" y="${r(ly + 3.5)}" font-family="${FONT}" font-size="10" fill="${p.faint}">服务端口</text>`
    );
    // 标题行右端已有出处角标时页脚不重复；无标题的图（交互态）由页脚署名
    const brand = title
      ? ''
      : `<text x="${W - 30}" y="${r(ly + 3.5)}" text-anchor="end" font-family="${MONO}" font-size="10" fill="${p.faint}" letter-spacing="0.8">杨先生的军火库 · arsenal</text>`;
    o.push(legendParts.join('') + brand);
  }

  // ── 脚注：从节点上摘下来的东西在这儿还回去 ──
  if (FOOT_NOTE_H) {
    const ny = arch.height + headH + FOOT_H + 13;
    o.push(
      `<text x="30" y="${r(ny)}" font-family="${FONT}" font-size="10" fill="${p.faint}">` +
      `端口：${escapeXml(portList.join('  ·  '))}</text>`
    );
  }

  o.push(`</svg>`);
  return o.join('\n');
}

function r(n: number): number {
  return Math.round(n * 100) / 100;
}

function nodeSvg(
  n: CanvasNode,
  p: Palette,
  dx: number,
  dy: number,
  hooks = false,
  /** 入场档位：节点按序号依次浮现（交互态不用，拖拽时元素在动会影响手感） */
  rise = 0,
  /** 精简模式：不画副标题、端口徽章、副本形态名、应用工程属性 */
  lean = false
): string {
  const x = n.x + dx, y = n.y + dy, w = n.w, h = n.h;
  const brand = iconColor(n.icon);
  const o: string[] = [];
  const replicas = n.modes && n.mode !== undefined ? (n.modes[n.mode]?.replicas ?? 1) : 1;

  o.push(`<g${hooks ? ` data-node="${escapeXml(n.id)}" style="cursor:grab"` : ` class="am-rise" style="--i:${rise}"`}>`);
  // 卡片：底色 + 一层极淡的纵向高光渐变，比纯平多一点体积感
  o.push(
    `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="11" ` +
    `fill="${p.card}" stroke="${p.cardLine}" stroke-width="1" filter="url(#ta-shadow)"/>`
  );
  o.push(
    `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="11" fill="url(#ta-cardg)"/>`
  );
  // 顶部品牌色条
  o.push(`<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="3" rx="1.5" fill="${brand}" opacity="0.9"/>`);

  // 图标底 + 图标（底座加一圈同色细描边，纯色块显得像占位符）
  const ic = 34;
  o.push(`<rect x="${r(x + 13)}" y="${r(y + 15)}" width="${ic}" height="${ic}" rx="9" fill="${brand}" opacity="0.14"/>`);
  o.push(`<rect x="${r(x + 13)}" y="${r(y + 15)}" width="${ic}" height="${ic}" rx="9" fill="none" stroke="${brand}" stroke-opacity="0.3" stroke-width="1"/>`);
  o.push(iconSvg(n.icon, x + 13 + (ic - 24) / 2, y + 15 + (ic - 24) / 2, 24));

  // 标题 / 副标题
  const tx = x + 13 + ic + 11;
  const titleAvail = w - 70 - (n.port ? 42 : 0) - (replicas > 1 ? 30 : 0);
  const titleFs = textW(n.title, 13) <= titleAvail ? 13 : 11.5;
  o.push(
    `<text x="${r(tx)}" y="${r(y + 30)}" font-family="${FONT}" font-size="${titleFs}" font-weight="650" ` +
    `fill="${p.title}">${escapeXml(clipPx(n.title, titleAvail, titleFs))}</text>`
  );
  if (!lean) {
    o.push(
      `<text x="${r(tx)}" y="${r(y + 45)}" font-family="${FONT}" font-size="10.5" ` +
      `fill="${p.sub}">${escapeXml(clipPx(n.subtitle, w - 78 - (replicas > 1 ? 46 : 0), 10.5))}</text>`
    );
  }

  // 端口 / 集群徽章都放标题行右端：塞进副标题行会和「注册中心 / 配置中心」这类长说明打架
  let badgeX = x + w - 12;
  if (n.port && !lean) {
    o.push(
      `<text x="${r(badgeX)}" y="${r(y + 30)}" font-family="${MONO}" font-size="10.5" ` +
      `text-anchor="end" fill="${p.faint}">:${escapeXml(n.port)}</text>`
    );
    badgeX -= 40;
  }
  if (replicas > 1) {
    o.push(
      `<text x="${r(badgeX)}" y="${r(y + 30)}" font-family="${MONO}" font-size="11" font-weight="700" ` +
      `text-anchor="end" fill="${brand}">×${replicas}</text>`
    );
    const modeName = lean ? undefined : n.modes?.[n.mode ?? 0]?.name;
    if (modeName) {
      o.push(
        `<text x="${r(badgeX)}" y="${r(y + 45)}" font-family="${FONT}" font-size="9.5" ` +
        `text-anchor="end" fill="${p.faint}">${escapeXml(clipPx(modeName, 56, 9.5))}</text>`
      );
    }
  }

  // 应用卡的工程属性
  if (!lean && n.kind === 'app' && n.tags.length) {
    let ty = y + 62;
    const colW = (w - 26) / 2;
    n.tags.forEach((t, i) => {
      const cx = x + 13 + (i % 2) * colW;
      const cy = ty + Math.floor(i / 2) * TAG_H;
      o.push(`<rect x="${r(cx)}" y="${r(cy)}" width="${r(colW - 6)}" height="18" rx="6" fill="${p.chipBg}"/>`);
      o.push(iconSvg(t.icon, cx + 3, cy + 3, 12));
      o.push(
        `<text x="${r(cx + 18)}" y="${r(cy + 12.5)}" font-family="${FONT}" font-size="9.5" ` +
        `fill="${p.chipFg}">${escapeXml(clipPx(`${t.label} · ${t.value}`, colW - 30, 9.5))}</text>`
      );
    });
  }

  o.push(`</g>`);
  return o.join('');
}

/** 正交折线。同行节点横连（右缘 → 左缘），跨区节点走「竖-横-竖」 */
function routeEdge(a: CanvasNode, b: CanvasNode, dx: number, dy: number, lane = 0, lanes = 1): string {
  const aTop = a.y + dy;
  const bTop = b.y + dy;
  const sameRow = Math.abs(aTop - bTop) < 8 && Math.abs(a.h - b.h) < 2;
  if (sameRow) {
    // 同一行：从两者较近的侧边直连，绝不绕到卡片背后
    const aR = a.x + a.w + dx, aL = a.x + dx;
    const bR = b.x + b.w + dx, bL = b.x + dx;
    const midY = aTop + a.h / 2;
    if (aR <= bL) return `M${r(aR)} ${r(midY)} L${r(bL)} ${r(midY)}`;
    if (bR <= aL) return `M${r(bR)} ${r(midY)} L${r(aL)} ${r(midY)}`;
  }
  // 多条线从同一个源出发时，出口在源边上按 lane 均分 —— 像总线分出支路，
  // 每条线有自己的竖直段，标签贴各自的竖线，不会叠成一行
  const ax = exitX(a, lane, lanes) + dx;
  const bx = b.x + b.w / 2 + dx;
  const down = bTop >= aTop + a.h - 4;
  const ay = down ? aTop + a.h : aTop;
  const by = down ? bTop : bTop + b.h;
  if (Math.abs(ax - bx) < 2) return `M${r(ax)} ${r(ay)} L${r(bx)} ${r(by)}`;
  const mid = (ay + by) / 2;
  return `M${r(ax)} ${r(ay)} L${r(ax)} ${r(mid)} L${r(bx)} ${r(mid)} L${r(bx)} ${r(by)}`;
}

/** 源节点边上按 lane 均分的出口 x */
function exitX(a: CanvasNode, lane: number, lanes: number): number {
  return a.x + (a.w * (lane + 1)) / (lanes + 1);
}

/** 标签贴着线自己的出口放 —— 跨多个分区的长线，标签压在中间分区上是灾难 */
function edgeLabelPoint(a: CanvasNode, b: CanvasNode, dx: number, dy: number, lane = 0, lanes = 1) {
  const aTop = a.y + dy;
  const bTop = b.y + dy;
  const sameRow = Math.abs(aTop - bTop) < 8 && Math.abs(a.h - b.h) < 2;
  if (sameRow) {
    const midY = aTop + a.h / 2;
    if (a.x + a.w <= b.x) return { x: (a.x + a.w + b.x) / 2 + dx, y: midY };
    return { x: (b.x + b.w + a.x) / 2 + dx, y: midY };
  }
  const down = bTop >= aTop + a.h - 4;
  if (down) {
    // 标签贴目标入口：目标在下一区是横排的，间隔足够，标签互相不打架；
    // 贴源端则多条线共享一个底边，标签必然叠在一起
    return { x: b.x + b.w / 2 + dx, y: bTop - 15 };
  }
  // 向上的线（观测拉取指标）目标端是应用底边，那里已有一排出口 —— 贴源端才不挤
  return { x: exitX(a, lane, lanes) + dx, y: aTop - 15 };
}

/**
 * 按像素宽度裁剪。中文全角 ≈ 1em，ASCII ≈ 0.55em —— 按字符数猜会把
 * 「注册中心 / 配置中心」这种长说明裁过头，或让标题压到端口上。
 */
export function textW(s: string, fontSize: number): number {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0x2e7f ? fontSize : fontSize * 0.55;
  return w;
}

function clipPx(s: string, maxPx: number, fontSize = 13): string {
  if (textW(s, fontSize) <= maxPx) return s;
  let out = s;
  while (out.length > 1 && textW(`${out}…`, fontSize) > maxPx) out = out.slice(0, -1);
  return `${out}…`;
}

// ─────────────────────────────────────────────────────────────
// 交付：给技术说明书用的 Markdown
// ─────────────────────────────────────────────────────────────

/** 把当前这张图翻成一段可以直接粘进技术说明书的 Markdown。 */
export function techArchMarkdown(
  arch: TechArch,
  picks: StackPicks,
  opts: { title?: string } = {}
): string {
  const title = opts.title ?? '技术架构说明';
  const lines: string[] = [];
  lines.push(`## ${title}`);
  lines.push('');
  lines.push('### 一、部署视图');
  lines.push('');
  lines.push('```text');
  for (const z of arch.zones) {
    const members = arch.nodes.filter((n) => n.zone === z.zone.id);
    lines.push(`  [${z.zone.name}]`);
    for (const n of members) {
      const replicas = n.modes && n.mode !== undefined ? (n.modes[n.mode]?.replicas ?? 1) : 1;
      const mode = replicas > 1 ? `（${n.modes![n.mode!].name}，${replicas} 节点）` : '';
      const port = n.port ? ` :${n.port}` : '';
      lines.push(`    - ${n.title}${port}${mode}`);
      if (n.kind === 'app' && n.tags.length) {
        lines.push(`      ${n.tags.map((t) => `${t.label}=${t.value}`).join(' / ')}`);
      }
    }
    lines.push('');
  }
  lines.push('```');
  lines.push('');
  lines.push('### 二、组件清单');
  lines.push('');
  lines.push('| 组件 | 选型 | 部署形态 | 端口 | 说明 |');
  lines.push('|---|---|---|---|---|');
  for (const n of arch.nodes) {
    if (n.kind === 'client') continue;
    const replicas = n.modes && n.mode !== undefined ? (n.modes[n.mode]?.replicas ?? 1) : 1;
    const mode = n.modes ? `${n.modes[n.mode ?? 0].name}（${replicas} 节点）` : '单实例';
    lines.push(
      `| ${n.title} | ${n.subtitle} | ${mode} | ${n.port ? ':' + n.port : '—'} | ${n.tags.length ? n.tags.map((t) => `${t.label} ${t.value}`).join('、') : '—'} |`
    );
  }
  lines.push('');
  if (arch.absent.length) {
    lines.push('### 三、本次未引入');
    lines.push('');
    for (const a of arch.absent) lines.push(`- ${a.name}：未启用（选型留空）`);
    lines.push('');
  }
  lines.push('### 四、组件间通信');
  lines.push('');
  lines.push('| 发起方 | 接收方 | 协议 / 动作 | 性质 |');
  lines.push('|---|---|---|---|');
  const nameOf = (id: string) => arch.nodes.find((n) => n.id === id)?.title ?? id;
  for (const e of arch.edges) {
    lines.push(
      `| ${nameOf(e.from)} | ${nameOf(e.to)} | ${e.label}${e.port ? ' :' + e.port : ''} | ${e.kind === 'dashed' ? '旁路（非请求必经）' : '请求必经'} |`
    );
  }
  lines.push('');
  lines.push('> 本表由装配台按当前选型自动生成，改选型后请重新导出，避免与实际部署不一致。');
  lines.push('');
  void picks;
  return lines.join('\n');
}

/** 图标展示名，给调色板用 */
export { iconName };
