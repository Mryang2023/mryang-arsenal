import { nodeArch, slotsOfLane, arch, type ArchAudit, type ArchStatus, type SlotState } from './arch';
import { dimensions } from './stack';
import type { StackPicks } from './content-types';

/**
 * 架构装配图：把一套选型画成「6 层泳道 + 层内方块 + 请求向下穿过」的图。
 *
 * 为什么自己拼 SVG，而不是引一个图引擎（D2 / Mermaid / Graphviz / LikeC4）：
 *
 *   图引擎解决的是**拓扑**，这张图要的是**版式**。
 *   引擎不知道「泳道」是什么 —— 实测把 6 个容器丢给 D2，无连线时它横排成一长条，
 *   有连线时按依赖把容器的框都打散了。想要竖着叠成色带就得用不可见边去骗布局，
 *   为了迁就引擎而扭曲数据，方向反了。
 *
 *   而这张图的拓扑是**固定的**：6 条泳道、17 个槽位、层内一条流水线。
 *   既然是固定的，坐标就能直接算出来 —— 于是版式、配色、中文折行、主题全在自己手里，
 *   代价是零依赖、产物是几 KB 的真 SVG（图形 + 文本，可选中、可缩放、进 zip 不违和）。
 *
 * 本模块是纯函数：给一份选型，出字符串。页面与导出器共用同一份真相。
 */

// ─────────────────────────────────────────────────────────────
// 版式常量：所有坐标都由它们算出来，改这里就能整体调版
// ─────────────────────────────────────────────────────────────

const PAD = 20;
/** 最左侧「请求向下穿过」那条脊柱的 x */
const SPINE_X = 30;
/** 泳道名所在的栏 */
const LABEL_X = 58;
/** 方块的起始 x */
const CARDS_X = 176;

const CARD_W = 168;
const CARD_H = 62;
const CARD_GAP = 14;
/** 泳道内上下留白 */
const LANE_PAD_Y = 18;
const LANE_GAP = 10;
const LANE_H = LANE_PAD_Y * 2 + CARD_H;

const HEADER_H = 84;
const LEGEND_H = 52;

const CARD_PAD = 11;
const TITLE_FS = 13;
const ROLE_FS = 10.5;
const TAG_FS = 9;

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', Roboto, sans-serif";

// ─────────────────────────────────────────────────────────────
// 主题：站内暗色，导出包里浅色
// ─────────────────────────────────────────────────────────────

export interface DiagramPalette {
  canvas: string;
  band: string;
  bandStroke: string;
  card: string;
  cardStroke: string;
  spine: string;
  fg: string;
  fgMuted: string;
  fgFaint: string;
  accent: string;
  bad: string;
  warn: string;
  ok: string;
  /** 状态底色（半透明感由浅色填充模拟，SVG 里不用 opacity 以免导出后发灰） */
  badSoft: string;
  warnSoft: string;
  okSoft: string;
}

export type DiagramTheme = 'dark' | 'light';

export const DIAGRAM_PALETTE: Record<DiagramTheme, DiagramPalette> = {
  dark: {
    canvas: '#0B0F0E',
    band: '#131917',
    bandStroke: '#243029',
    card: '#1A2220',
    cardStroke: '#3C4D45',
    spine: '#8A6A2A',
    fg: '#E8F0EC',
    fgMuted: '#93A39C',
    fgFaint: '#5E6E67',
    accent: '#D9A441',
    bad: '#E5484D',
    warn: '#D9A441',
    ok: '#7FA650',
    badSoft: '#2A1416',
    warnSoft: '#2A2314',
    okSoft: '#18231A',
  },
  light: {
    canvas: '#FFFFFF',
    band: '#F6F8F7',
    bandStroke: '#DFE6E2',
    card: '#FFFFFF',
    cardStroke: '#B9C5BF',
    spine: '#9A7420',
    fg: '#17201D',
    fgMuted: '#5E6E67',
    fgFaint: '#8A9691',
    accent: '#8A6A2A',
    bad: '#C0392B',
    warn: '#9A7420',
    ok: '#4F6B2E',
    badSoft: '#FDF2F1',
    warnSoft: '#FCF7EC',
    okSoft: '#F2F7EE',
  },
};

// ─────────────────────────────────────────────────────────────
// 模型
// ─────────────────────────────────────────────────────────────

export interface DiagramSlot {
  dimId: string;
  laneId: string;
  /** 方块上的主标题：选中的选项名，未选时是「维度名（未选）」 */
  title: string;
  /** 这一块在架构里承担的角色 */
  role: string;
  state: SlotState;
  required: boolean;
  recommended: boolean;
  /** 在层内流水线上（会画箭头串起来） */
  onPipeline: boolean;
  /** 悬停时能看到的能力说明 */
  tip: string;
}

export interface DiagramLane {
  id: string;
  name: string;
  glyph: string;
  desc: string;
  slots: DiagramSlot[];
  /** 层内流水线的槽位数（前 N 个），其余是旁路件 */
  pipelineCount: number;
}

export interface ArchDiagramModel {
  title: string;
  subtitle: string;
  status: ArchStatus;
  lanes: DiagramLane[];
  width: number;
  height: number;
}

export interface DiagramInput {
  picks: StackPicks;
  audit: ArchAudit;
  /** 图上的主标题，通常用项目名或预设名 */
  title: string;
  subtitle?: string;
  theme?: DiagramTheme;
}

/** 层内流水线里，前几个是「请求真正流经」的，后面的是旁路件（如迁移工具）。 */
function pipelineCountOf(laneId: string, slotIds: string[]): number {
  const order = arch.pipelines[laneId];
  if (!order) return 0;
  const inLane = order.filter((id) => slotIds.includes(id));
  // 流水线只对「已连成链」的前缀有意义；不在泳道里的忽略
  return inLane.length >= 2 ? inLane.length : 0;
}

export function buildArchDiagramModel(input: DiagramInput): ArchDiagramModel {
  const { picks, audit, title, subtitle } = input;
  const dimById = new Map(dimensions.map((d) => [d.id, d]));

  const lanes: DiagramLane[] = arch.lanes.map((lane) => {
    const slotIds = slotsOfLane(lane.id);
    const pipelineCount = pipelineCountOf(lane.id, slotIds);

    const slots: DiagramSlot[] = slotIds.map((dimId, index) => {
      const dim = dimById.get(dimId);
      const node = nodeArch[dimId];
      const optId = picks[dimId];
      const opt = optId ? dim?.options.find((o) => o.id === optId) : undefined;
      const state = audit.slotStates[dimId] ?? 'empty';

      // 悬停说明：把「缺了会怎样」和「提供了哪些能力」都摊开，
      // 图上一眼看不出代价的地方，鼠标停一下就能看到。
      const parts: string[] = [];
      if (opt) parts.push(`${dim?.name ?? dimId}：${opt.name}${opt.summary ? ` —— ${opt.summary}` : ''}`);
      else if (node?.missing) parts.push(node.missing);
      if (!opt && node?.required) parts.push('这一块是必需的：缺它项目起不来。');

      return {
        dimId,
        laneId: lane.id,
        title: opt ? opt.name : `${dim?.name ?? dimId}（未选）`,
        role: node?.role ?? dim?.name ?? dimId,
        state,
        required: !!node?.required,
        recommended: !!node?.recommended,
        onPipeline: index < pipelineCount,
        tip: parts.join(' '),
      };
    });

    return { id: lane.id, name: lane.name, glyph: lane.glyph, desc: lane.desc, slots, pipelineCount };
  });

  const maxSlots = Math.max(1, ...lanes.map((l) => l.slots.length));
  const width = CARDS_X + maxSlots * (CARD_W + CARD_GAP) - CARD_GAP + PAD;
  const height =
    HEADER_H + lanes.length * LANE_H + (lanes.length - 1) * LANE_GAP + LEGEND_H + PAD;

  return {
    title,
    subtitle: subtitle ?? '',
    status: audit.status,
    lanes,
    width: Math.round(width),
    height: Math.round(height),
  };
}

// ─────────────────────────────────────────────────────────────
// 文本度量与折行
//
// SVG 的 <text> 不会自动换行。中英混排必须自己按字宽折 —— 按字数折会在
// 「Actuator + Prometheus + Grafana」这种长西文标签上撑出方块外面。
// ─────────────────────────────────────────────────────────────

/** 全角（CJK、全角标点、假名、谚文）按一个字号宽算，其余按 0.55 算。 */
export function charWidth(ch: string, fontSize: number): number {
  const wide =
    /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(
      ch
    );
  return wide ? fontSize : fontSize * 0.55;
}

export function textWidth(text: string, fontSize: number): number {
  let w = 0;
  for (const ch of text) w += charWidth(ch, fontSize);
  return w;
}

function isWide(ch: string): boolean {
  return charWidth(ch, 1) > 0.9;
}

interface Token {
  text: string;
  width: number;
}

/**
 * 切成可断点。
 *
 * 关键在「西文不许从中间断」：按字符折出来的图上会出现
 * `Spring Security + JW` / `T`、`Prometheu` / `s` 这种把单词掰两半的结果，
 * 比溢出还难看。所以西文按空格成词，只有中文才允许逐字断。
 * 单个词比整行还宽时（罕见）才硬切。
 */
function tokenize(text: string, fontSize: number, maxWidth: number): Token[] {
  const tokens: Token[] = [];
  let word = '';

  const flush = () => {
    if (!word) return;
    const width = textWidth(word, fontSize);
    if (width <= maxWidth) {
      tokens.push({ text: word, width });
    } else {
      // 词比整行还宽：只能硬切，否则它会顶破方块
      let chunk = '';
      let cw = 0;
      for (const ch of word) {
        const c = charWidth(ch, fontSize);
        if (cw + c > maxWidth && chunk) {
          tokens.push({ text: chunk, width: cw });
          chunk = '';
          cw = 0;
        }
        chunk += ch;
        cw += c;
      }
      if (chunk) tokens.push({ text: chunk, width: cw });
    }
    word = '';
  };

  for (const ch of text) {
    if (ch === ' ') {
      flush();
      tokens.push({ text: ' ', width: charWidth(' ', fontSize) });
    } else if (isWide(ch)) {
      flush();
      tokens.push({ text: ch, width: charWidth(ch, fontSize) });
    } else {
      word += ch;
    }
  }
  flush();
  return tokens;
}

/** 折行；超过 maxLines 时在最后一行末尾加省略号。 */
export function wrapText(text: string, maxWidth: number, fontSize: number, maxLines = 2): string[] {
  const tokens = tokenize(text, fontSize, maxWidth);
  const lines: string[] = [];
  let cur = '';
  let w = 0;

  for (const t of tokens) {
    if (w + t.width > maxWidth && cur.length > 0) {
      lines.push(cur.trimEnd());
      cur = '';
      w = 0;
      if (lines.length === maxLines) {
        lines[maxLines - 1] += '…';
        return lines;
      }
      // 行首不留空格
      if (t.text === ' ') continue;
    }
    cur += t.text;
    w += t.width;
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  return lines;
}

// ─────────────────────────────────────────────────────────────
// SVG 生成
// ─────────────────────────────────────────────────────────────

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 状态 → 描边色与虚线。空槽位一律灰，避免和「错误」混淆。 */
function stateStroke(state: SlotState, p: DiagramPalette): { stroke: string; dash: string } {
  switch (state) {
    case 'missing-required':
      return { stroke: p.bad, dash: ' stroke-dasharray="5 4"' };
    case 'missing-recommended':
      return { stroke: p.warn, dash: ' stroke-dasharray="5 4"' };
    case 'conflict':
      return { stroke: p.warn, dash: '' };
    case 'filled':
      return { stroke: p.cardStroke, dash: '' };
    default:
      return { stroke: p.bandStroke, dash: ' stroke-dasharray="3 4"' };
  }
}

function stateFill(state: SlotState, p: DiagramPalette): string {
  switch (state) {
    case 'missing-required':
      return p.badSoft;
    case 'missing-recommended':
    case 'conflict':
      return p.warnSoft;
    case 'filled':
      return p.card;
    default:
      return p.canvas;
  }
}

function stateLabel(state: SlotState): string {
  switch (state) {
    case 'missing-required':
      return '缺必需';
    case 'missing-recommended':
      return '缺建议';
    case 'conflict':
      return '有隐患';
    case 'filled':
      return '已选';
    default:
      return '未选';
  }
}

function roundedCard(x: number, y: number, slot: DiagramSlot, p: DiagramPalette): string {
  const { stroke, dash } = stateStroke(slot.state, p);
  const out: string[] = [];
  // 右上角要放角标时，标题可用宽度必须让出来 —— 否则长标题会钻到角标底下
  const hasCornerTag =
    slot.state === 'missing-required' ||
    slot.state === 'missing-recommended' ||
    slot.state === 'conflict';
  const maxTextW = CARD_W - CARD_PAD * 2 - (hasCornerTag ? 24 : 0);

  out.push(`<g>`);
  if (slot.tip) out.push(`<title>${escapeXml(slot.tip)}</title>`);
  out.push(
    `<rect x="${x}" y="${y}" width="${CARD_W}" height="${CARD_H}" rx="6" ` +
      `fill="${stateFill(slot.state, p)}" stroke="${stroke}" stroke-width="1"${dash}/>`
  );

  // 主标题：选项名。两行放不下就省略。
  const titleLines = wrapText(slot.title, maxTextW, TITLE_FS, 2);
  const titleFill = slot.state === 'filled' || slot.state === 'conflict' ? p.fg : p.fgMuted;
  titleLines.forEach((line, i) => {
    out.push(
      `<text x="${x + CARD_PAD}" y="${y + CARD_PAD + TITLE_FS - 2 + i * (TITLE_FS + 3)}" ` +
        `font-family="${FONT_STACK}" font-size="${TITLE_FS}" font-weight="600" ` +
        `fill="${titleFill}">${escapeXml(line)}</text>`
    );
  });

  // 角色：这一块在架构里干什么
  const roleY = y + CARD_H - CARD_PAD - 1;
  const roleLines = wrapText(slot.role, maxTextW, ROLE_FS, 1);
  out.push(
    `<text x="${x + CARD_PAD}" y="${roleY}" font-family="${FONT_STACK}" ` +
      `font-size="${ROLE_FS}" fill="${p.fgFaint}">${escapeXml(roleLines[0] ?? '')}</text>`
  );

  // 右上角状态角标：只标「需要你动手」的两类，避免图上一堆标签。
  if (slot.state === 'missing-required' || slot.state === 'missing-recommended') {
    const tag = slot.state === 'missing-required' ? '必需' : '建议';
    const tagColor = slot.state === 'missing-required' ? p.bad : p.warn;
    const tw = textWidth(tag, TAG_FS) + 8;
    out.push(
      `<rect x="${x + CARD_W - tw - 6}" y="${y + 6}" width="${tw}" height="${TAG_FS + 6}" rx="3" ` +
        `fill="none" stroke="${tagColor}" stroke-width="1"/>`,
      `<text x="${x + CARD_W - tw / 2 - 6}" y="${y + 6 + TAG_FS + 1}" text-anchor="middle" ` +
        `font-family="${FONT_STACK}" font-size="${TAG_FS}" fill="${tagColor}">${escapeXml(tag)}</text>`
    );
  } else if (slot.state === 'conflict') {
    out.push(
      `<text x="${x + CARD_W - 16}" y="${y + 16}" text-anchor="middle" font-family="${FONT_STACK}" ` +
        `font-size="12" fill="${p.warn}">⚠</text>`
    );
  }

  out.push('</g>');
  return out.join('');
}

export function buildArchDiagramSvg(model: ArchDiagramModel, theme: DiagramTheme = 'dark'): string {
  const p = DIAGRAM_PALETTE[theme];
  const out: string[] = [];

  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${model.width}" height="${model.height}" ` +
      `viewBox="0 0 ${model.width} ${model.height}" role="img" ` +
      `aria-label="${escapeXml(model.title)}">`
  );
  out.push(
    `<style>text{dominant-baseline:auto;letter-spacing:0}` +
      `.mono{font-family:'Cascadia Code','JetBrains Mono',Consolas,monospace}</style>`
  );
  out.push(
    `<rect x="0" y="0" width="${model.width}" height="${model.height}" fill="${p.canvas}"/>`
  );

  // ── 标题区 ──
  out.push(
    `<text x="${PAD}" y="40" font-family="${FONT_STACK}" font-size="20" font-weight="700" ` +
      `fill="${p.accent}">${escapeXml(model.title)}</text>`
  );
  if (model.subtitle) {
    const sub = wrapText(model.subtitle, model.width - PAD * 2, 12, 1)[0] ?? '';
    out.push(
      `<text x="${PAD}" y="64" font-family="${FONT_STACK}" font-size="12" ` +
        `fill="${p.fgMuted}">${escapeXml(sub)}</text>`
    );
  }

  const lanesTop = HEADER_H;
  const firstCenter = lanesTop + LANE_H / 2;
  const lastCenter = lanesTop + (model.lanes.length - 1) * (LANE_H + LANE_GAP) + LANE_H / 2;

  // ── 请求脊柱：一条从接入层贯穿到基座的箭头 ──
  // 这张图要讲的第一件事就是「请求自上而下穿过」，所以它必须是一条连贯的线，
  // 而不是靠读者自己从色带顺序里悟出来。
  out.push(
    `<line x1="${SPINE_X}" y1="${firstCenter}" x2="${SPINE_X}" y2="${lastCenter - 10}" ` +
      `stroke="${p.spine}" stroke-width="2"/>`,
    `<path d="M ${SPINE_X - 5} ${lastCenter - 10} L ${SPINE_X + 5} ${lastCenter - 10} ` +
      `L ${SPINE_X} ${lastCenter} Z" fill="${p.spine}"/>`
  );
  const spineLabelY = (firstCenter + lastCenter) / 2;
  out.push(
    `<text x="${SPINE_X - 7}" y="${spineLabelY}" transform="rotate(-90 ${SPINE_X - 7} ${spineLabelY})" ` +
      `text-anchor="middle" font-family="${FONT_STACK}" font-size="11" ` +
      `fill="${p.spine}">请求向下穿过</text>`
  );

  // ── 泳道 ──
  model.lanes.forEach((lane, laneIndex) => {
    const y = lanesTop + laneIndex * (LANE_H + LANE_GAP);
    const centerY = y + LANE_H / 2;

    out.push(
      `<rect x="${PAD}" y="${y}" width="${model.width - PAD * 2}" height="${LANE_H}" rx="8" ` +
        `fill="${p.band}" stroke="${p.bandStroke}" stroke-width="1"/>`
    );

    // 泳道名（左栏）
    out.push(
      `<text x="${LABEL_X}" y="${centerY - 3}" font-family="${FONT_STACK}" font-size="14" ` +
        `font-weight="700" fill="${p.accent}">${escapeXml(lane.glyph)} ${escapeXml(lane.name)}</text>`,
      `<text x="${LABEL_X}" y="${centerY + 14}" font-family="${FONT_STACK}" font-size="10" ` +
        `fill="${p.fgFaint}">${lane.slots.length} 个槽位</text>`
    );

    const cardsY = y + LANE_PAD_Y;
    lane.slots.forEach((slot, i) => {
      const x = CARDS_X + i * (CARD_W + CARD_GAP);
      out.push(roundedCard(x, cardsY, slot, p));
    });

    // 层内流水线箭头：只在「请求真正流经」的那几个方块之间画
    for (let i = 0; i + 1 < lane.pipelineCount; i += 1) {
      const x1 = CARDS_X + i * (CARD_W + CARD_GAP) + CARD_W;
      const x2 = x1 + CARD_GAP;
      out.push(
        `<line x1="${x1 + 2}" y1="${centerY}" x2="${x2 - 5}" y2="${centerY}" ` +
          `stroke="${p.cardStroke}" stroke-width="2"/>`,
        `<path d="M ${x2 - 5} ${centerY - 4} L ${x2} ${centerY} L ${x2 - 5} ${centerY + 4} Z" ` +
          `fill="${p.cardStroke}"/>`
      );
    }

    // 旁路件：不在请求链路上（例如迁移工具只在发布期起作用），用竖虚线隔开。
    // 不隔开的话，读者会理所当然地以为它也挡在请求路径上。
    if (lane.pipelineCount > 0 && lane.pipelineCount < lane.slots.length) {
      const gapX = CARDS_X + lane.pipelineCount * (CARD_W + CARD_GAP) - CARD_GAP / 2;
      out.push(
        `<line x1="${gapX}" y1="${y + 12}" x2="${gapX}" y2="${y + LANE_H - 12}" ` +
          `stroke="${p.fgFaint}" stroke-width="1" stroke-dasharray="3 4"/>`,
        `<text x="${gapX}" y="${y + LANE_H - 4}" text-anchor="middle" font-family="${FONT_STACK}" ` +
          `font-size="9" fill="${p.fgFaint}">旁路</text>`
      );
    }
  });

  // ── 图例 ──
  const legendY = lanesTop + model.lanes.length * (LANE_H + LANE_GAP) - LANE_GAP + 18;
  const legend: [string, SlotState][] = [
    ['已选', 'filled'],
    ['缺必需', 'missing-required'],
    ['缺建议', 'missing-recommended'],
    ['未选', 'empty'],
  ];
  let lx = PAD;
  for (const [label, st] of legend) {
    const { stroke, dash } = stateStroke(st, p);
    out.push(
      `<rect x="${lx}" y="${legendY}" width="14" height="10" rx="2" fill="${stateFill(st, p)}" ` +
        `stroke="${stroke}" stroke-width="1"${dash}/>`,
      `<text x="${lx + 20}" y="${legendY + 9}" font-family="${FONT_STACK}" font-size="10" ` +
        `fill="${p.fgMuted}">${escapeXml(label)}</text>`
    );
    lx += 76;
  }
  out.push(
    `<text x="${lx + 6}" y="${legendY + 9}" font-family="${FONT_STACK}" font-size="10" ` +
      `fill="${p.fgMuted}">方块右上角「必需 / 建议」= 该槽位留空时的性质</text>`
  );

  out.push('</svg>');
  return out.join('\n');
}

export interface BuiltDiagram {
  model: ArchDiagramModel;
  svg: string;
  width: number;
  height: number;
}

export function buildArchDiagram(input: DiagramInput): BuiltDiagram {
  const model = buildArchDiagramModel(input);
  const svg = buildArchDiagramSvg(model, input.theme ?? 'dark');
  return { model, svg, width: model.width, height: model.height };
}

/**
 * 页面内联用：去掉固定宽高，交给容器缩放 —— 但保留 viewBox，比例不会变形。
 * 导出时仍用原始 SVG：那份是给人下载的，需要确定的像素尺寸。
 */
export function toResponsiveSvg(svg: string): string {
  return svg.replace(
    /^<svg ([^>]*?)width="[\d.]+" height="[\d.]+"/,
    '<svg $1style="max-width:100%;height:auto"'
  );
}

// ─────────────────────────────────────────────────────────────
// 附赠出口：DSL 源码
//
// 拼字符串不要钱，所以顺手把 D2 / Mermaid 源码也给了 —— 想自己改图的人拿去
// 就能渲染，而我们不必为此在浏览器里背一个几 MB 的图引擎。
// ─────────────────────────────────────────────────────────────

export function archDiagramD2(model: ArchDiagramModel): string {
  const out = [`# ${model.title}`, 'direction: down', ''];
  for (const lane of model.lanes) {
    out.push(`${lane.id}: ${lane.name} {`, '  direction: right');
    for (const slot of lane.slots) {
      const label = `${slot.title}\\n${slot.role}`.replace(/"/g, '\\"');
      out.push(`  ${slot.dimId}: "${label}"`);
    }
    out.push('}', '');
  }
  for (const lane of model.lanes) {
    for (let i = 0; i + 1 < lane.pipelineCount; i += 1) {
      out.push(`${lane.id}.${lane.slots[i].dimId} -> ${lane.id}.${lane.slots[i + 1].dimId}`);
    }
  }
  return `${out.join('\n')}\n`;
}

export function archDiagramMermaid(model: ArchDiagramModel): string {
  const out = ['flowchart TB'];
  for (const lane of model.lanes) {
    out.push(`  subgraph ${lane.id}["${lane.name}"]`, '    direction LR');
    for (const slot of lane.slots) {
      const label = `${slot.title}<br/>${slot.role}`.replace(/"/g, '&quot;');
      out.push(`    ${slot.dimId}["${label}"]`);
    }
    out.push('  end');
  }
  for (const lane of model.lanes) {
    for (let i = 0; i + 1 < lane.pipelineCount; i += 1) {
      out.push(`  ${lane.slots[i].dimId} --> ${lane.slots[i + 1].dimId}`);
    }
  }
  return `${out.join('\n')}\n`;
}

/** 图上每个槽位的状态说明，供技术说明文档与自检复用。 */
export function diagramSummary(model: ArchDiagramModel) {
  const all = model.lanes.flatMap((l) => l.slots);
  return {
    lanes: model.lanes.length,
    slots: all.length,
    filled: all.filter((s) => s.state === 'filled' || s.state === 'conflict').length,
    missingRequired: all.filter((s) => s.state === 'missing-required').length,
    missingRecommended: all.filter((s) => s.state === 'missing-recommended').length,
    statusLabel: stateLabel,
  };
}
