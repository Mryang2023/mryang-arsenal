import { DIAGRAM_LAYOUT, type ArchDiagramModel } from '../../src/lib/arch-diagram';

/**
 * 架构装配图的**几何模型 + 不变量**。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么要有这个文件（它补的是哪一块空白）：
 *
 * 这张图此前只有两类检查：
 *   · `graph-check.ts`   —— 图**语义**（谁依赖谁、能力是否闭环）
 *   · `visual-check.ts`  —— 浏览器里的 DOM 几何（A1 横向溢出 / A2 一级子元素越界）
 *
 * 「方块有没有互相压住」「方块有没有掉出泳道」这两件事，**两边都不管**：
 * 语义检查看不见坐标，DOM 检查看见的是一堆 `<g>` 而不是方块。
 * 而 `arch-diagram.ts` 里那 700 行拼字符串的渲染代码，一行断言都没有 ——
 * 改错一个 `LANE_PAD_Y`，图会安静地压在一起，没有任何东西会红。
 *
 * 所以这里把版式**算成数据**（和 ServerLab 把布局与渲染分开是同一条道理：
 * 场景是数据，SVG 只是它的一种出口），再对数据判不变量。判据抄的是它们的
 * `checkOverlap` / `checkBounds`：
 *
 *   · 无重叠 —— 两两比对，**边界接触也算违规**（原文未说明相切，取严）
 *   · 不越界 —— 每个方块都在画布内
 *   · 在带内 —— 方块必须落在自己那条泳道里（上下左右都不许探出去）
 *
 * 版式常量一律从 `DIAGRAM_LAYOUT` 读，**绝不在这里重抄一遍** ——
 * 抄一遍就等于「校验器按旧尺寸算新图」，那种漂移是静默的。
 */

/** 矩形。与渲染层用的 `ArchDiagramModel.width/height` 同一套单位（SVG 用户单位）。 */
export interface GeoBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LaneBox extends GeoBox {
  id: string;
  index: number;
}

export interface CardBox extends GeoBox {
  laneId: string;
  dimId: string;
  /** 在泳道内的横向序号 */
  index: number;
}

export interface DiagramGeometry {
  canvas: GeoBox;
  lanes: LaneBox[];
  cards: CardBox[];
  /** 图例条整体占位（4 个色块 + 说明文字所在的那一行） */
  legend: GeoBox;
  /** 左栏（脊柱 + 泳道名）的右边界；方块不得越过它 */
  leftColumnRight: number;
}

/** 诊断形态与 ServerLab 的 `{ level, code, path, message }` 一致（未另造一套）。 */
export interface GeometryDiagnostic {
  level: 'error' | 'warn';
  code: string;
  path: string;
  message: string;
}

export const GEOMETRY_CODE = {
  cardOutOfCanvas: 'GEO_CARD_OUT_OF_CANVAS',
  cardOverlap: 'GEO_CARD_OVERLAP',
  cardOutOfLane: 'GEO_CARD_OUT_OF_LANE',
  cardInLeftColumn: 'GEO_CARD_IN_LEFT_COLUMN',
  laneOutOfCanvas: 'GEO_LANE_OUT_OF_CANVAS',
  laneOverlap: 'GEO_LANE_OVERLAP',
  laneOutOfOrder: 'GEO_LANE_OUT_OF_ORDER',
  legendOutOfCanvas: 'GEO_LEGEND_OUT_OF_CANVAS',
} as const;

/* ══════════════════════════════════════════════════════════════
   一、版式 → 数据
   ══════════════════════════════════════════════════════════════ */

/**
 * 把一张装配图的模型算成方块坐标。
 *
 * 算术与 `arch-diagram.ts` 的 `renderArchSvg` **逐式对应**：
 *   泳道带 y = HEADER_H + i × (LANE_H + LANE_GAP)
 *   卡片 x   = CARDS_X + j × (CARD_W + CARD_GAP)
 *   卡片 y   = 泳道带 y + LANE_PAD_Y
 * 谁改了渲染而没改这里，`graph-check` 的「模型 vs 实画」那条断言会立刻红。
 * （那条断言就是为此存在的 —— 光有公式对齐不算证据，得拿真产物比。）
 */
export function layoutDiagramGeometry(model: ArchDiagramModel): DiagramGeometry {
  const L = DIAGRAM_LAYOUT;
  const lanes: LaneBox[] = model.lanes.map((lane, i) => ({
    id: lane.id,
    index: i,
    x: L.PAD,
    y: L.HEADER_H + i * (L.LANE_H + L.LANE_GAP),
    w: model.width - L.PAD * 2,
    h: L.LANE_H,
  }));

  const cards: CardBox[] = [];
  model.lanes.forEach((lane, laneIndex) => {
    const laneBox = lanes[laneIndex];
    lane.slots.forEach((slot, j) => {
      cards.push({
        laneId: lane.id,
        dimId: slot.dimId,
        index: j,
        x: L.CARDS_X + j * (L.CARD_W + L.CARD_GAP),
        y: laneBox.y + L.LANE_PAD_Y,
        w: L.CARD_W,
        h: L.CARD_H,
      });
    });
  });

  const lanesBottom = lanes.length > 0 ? lanes[lanes.length - 1].y + L.LANE_H : L.HEADER_H;
  const legendY = lanesBottom - L.LANE_GAP + 18;

  return {
    canvas: { x: 0, y: 0, w: model.width, h: model.height },
    lanes,
    cards,
    // 图例是横向一串：4 个 14×10 的色块 + 说明文字，宽度按渲染层的推进量算
    legend: { x: L.PAD, y: legendY, w: 4 * 76 + 300, h: 12 },
    leftColumnRight: L.CARDS_X,
  };
}

/* ══════════════════════════════════════════════════════════════
   二、几何不变量
   ══════════════════════════════════════════════════════════════ */

/** 相交判定：**接触即算违规**（ServerLab 的 checkOverlap 取严，这里同口径）。 */
function intersects(a: GeoBox, b: GeoBox): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

function contains(outer: GeoBox, inner: GeoBox): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

function box(b: GeoBox): string {
  return `x=${b.x} y=${b.y} w=${b.w} h=${b.h}`;
}

/**
 * 全部几何不变量。返回 `Diagnostic[]` —— **不抛错、不短路**：
 * 一处重叠不应该让后面五条判据全都看不见。
 */
export function checkDiagramGeometry(geo: DiagramGeometry): GeometryDiagnostic[] {
  const out: GeometryDiagnostic[] = [];

  // G1 卡片必须都在画布内
  for (const card of geo.cards) {
    if (!contains(geo.canvas, card)) {
      out.push({
        level: 'error',
        code: GEOMETRY_CODE.cardOutOfCanvas,
        path: `cards[${card.laneId}/${card.dimId}]`,
        message: `方块越出画布：方块 ${box(card)}，画布 ${box(geo.canvas)}`,
      });
    }
  }

  // G2 卡片两两不重叠（边界接触也算违规）
  for (let i = 0; i < geo.cards.length; i += 1) {
    for (let j = i + 1; j < geo.cards.length; j += 1) {
      const a = geo.cards[i];
      const b = geo.cards[j];
      if (intersects(a, b)) {
        out.push({
          level: 'error',
          code: GEOMETRY_CODE.cardOverlap,
          path: `cards[${a.laneId}/${a.dimId}] × cards[${b.laneId}/${b.dimId}]`,
          message:
            `两个方块相交（含边界接触）：${a.laneId}/${a.dimId} ${box(a)} 与 ` +
            `${b.laneId}/${b.dimId} ${box(b)}`,
        });
      }
    }
  }

  // G3 卡片必须落在自己那条泳道里（上下左右都不许探出去）
  const laneById = new Map(geo.lanes.map((l) => [l.id, l]));
  for (const card of geo.cards) {
    const lane = laneById.get(card.laneId);
    if (lane === undefined) {
      out.push({
        level: 'error',
        code: GEOMETRY_CODE.cardOutOfLane,
        path: `cards[${card.laneId}/${card.dimId}]`,
        message: `方块挂在不存在的泳道 "${card.laneId}" 上`,
      });
      continue;
    }
    if (!contains(lane, card)) {
      out.push({
        level: 'error',
        code: GEOMETRY_CODE.cardOutOfLane,
        path: `cards[${card.laneId}/${card.dimId}]`,
        message: `方块掉出所属泳道：方块 ${box(card)}，泳道 "${lane.id}" ${box(lane)}`,
      });
    }
  }

  // G4 卡片不得侵入左栏（脊柱 + 泳道名）—— 左栏是文字，压上去就等于文字被盖住
  for (const card of geo.cards) {
    if (card.x < geo.leftColumnRight) {
      out.push({
        level: 'error',
        code: GEOMETRY_CODE.cardInLeftColumn,
        path: `cards[${card.laneId}/${card.dimId}]`,
        message: `方块左边界 ${card.x} 侵入左栏（左栏右边界 ${geo.leftColumnRight}）—— 会压住泳道名与脊柱`,
      });
    }
  }

  // G5 泳道带在画布内
  for (const lane of geo.lanes) {
    if (!contains(geo.canvas, lane)) {
      out.push({
        level: 'error',
        code: GEOMETRY_CODE.laneOutOfCanvas,
        path: `lanes[${lane.id}]`,
        message: `泳道越出画布：泳道 ${box(lane)}，画布 ${box(geo.canvas)}`,
      });
    }
  }

  // G6 泳道带两两不重叠
  for (let i = 0; i < geo.lanes.length; i += 1) {
    for (let j = i + 1; j < geo.lanes.length; j += 1) {
      const a = geo.lanes[i];
      const b = geo.lanes[j];
      if (intersects(a, b)) {
        out.push({
          level: 'error',
          code: GEOMETRY_CODE.laneOverlap,
          path: `lanes[${a.id}] × lanes[${b.id}]`,
          message: `两条泳道相交：${a.id} ${box(a)} 与 ${b.id} ${box(b)}`,
        });
      }
    }
  }

  // G7 泳道纵向严格递增 —— 顺序错了图还是"能看"，但讲的故事是错的
  for (let i = 1; i < geo.lanes.length; i += 1) {
    if (geo.lanes[i].y <= geo.lanes[i - 1].y) {
      out.push({
        level: 'error',
        code: GEOMETRY_CODE.laneOutOfOrder,
        path: `lanes[${geo.lanes[i].id}]`,
        message:
          `泳道纵向顺序错乱：第 ${i} 条 "${geo.lanes[i].id}" 的 y=${geo.lanes[i].y}，` +
          `不大于第 ${i - 1} 条 "${geo.lanes[i - 1].id}" 的 y=${geo.lanes[i - 1].y}`,
      });
    }
  }

  // G8 图例条不得越出画布
  if (!contains(geo.canvas, geo.legend)) {
    out.push({
      level: 'error',
      code: GEOMETRY_CODE.legendOutOfCanvas,
      path: 'legend',
      message: `图例越出画布：图例 ${box(geo.legend)}，画布 ${box(geo.canvas)}`,
    });
  }

  return out;
}

/* ══════════════════════════════════════════════════════════════
   三、模型 vs 实画：公式对齐不算证据，得拿真产物比
   ══════════════════════════════════════════════════════════════ */

/** 从 SVG 文本里抠出所有 `<rect>`（只认属性顺序 x → y → width → height，与渲染层一致）。 */
export function parseSvgRects(svg: string): GeoBox[] {
  const re = /<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"/g;
  const out: GeoBox[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg)) !== null) {
    out.push({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) });
  }
  return out;
}

/**
 * SVG 里真正画出来的方块（按尺寸认 —— 全渲染层只有一处产出 CARD_W × CARD_H 的 rect）。
 *
 * 为什么敢用尺寸认而不是加 class：规范产物是**要进导出包**的，加 class 会改字节，
 * 而 `graph-check` 有「导出包里的 architecture.svg 逐字节稳定」的既有断言。
 * 用尺寸认是零侵入的，代价是这条断言与 CARD_W 耦合 —— 而 CARD_W 本来就在
 * `DIAGRAM_LAYOUT` 里，两边读的是同一份，不构成第二套几何。
 */
export function parseRenderedCards(svg: string): GeoBox[] {
  const { CARD_W, CARD_H } = DIAGRAM_LAYOUT;
  return parseSvgRects(svg).filter((r) => r.w === CARD_W && r.h === CARD_H);
}

/** 方块集合是否逐一对应（顺序无关）—— 颜色/描边可以变，「画在哪」不许变。 */
export function sameBoxSet(a: GeoBox[], b: GeoBox[]): boolean {
  if (a.length !== b.length) return false;
  const key = (r: GeoBox) => `${r.x},${r.y},${r.w},${r.h}`;
  const set = new Set(a.map(key));
  return b.every((r) => set.has(key(r)));
}
