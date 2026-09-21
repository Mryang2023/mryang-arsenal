'use client';

import { ARCH_GLYPHS } from '@/lib/arch-glyphs';
import { svgMotionStyle } from '@/lib/arch-motion';
import type { CSSProperties, ReactNode } from 'react';
import type { ArchViewData } from '@/lib/arch-views';

/**
 * 五张架构视图（业务 / 数据 / 应用 / 产品 / 项目）的 SVG 渲染。
 *
 * 这几张图**不认军火库**：它们只认一份 `ArchViewData`。所以同一个渲染器
 * 换个项目的档案就能画出别家的六张图 —— 数据从 props 进来，
 * 不在模块顶层读常量（读常量的话，换档案要等一次重新构建）。
 *
 * 技术架构走 arch-canvas（可编辑、可导出），这五张是「讲清楚」用的静态图：
 * 数据全部来自项目档案（`arsenal-profiles/*.json`）—— 档案里的数字又是
 * 从真实数据算出来的，规则增删后图会自己跟上，不存在「图上写 62 条、
 * 库里 63 条」这种事；也没有「换个项目就无从下手」这种事。
 *
 * 画布约定与站点一致：暗色底、卡片 #141F1D、文字 #EAF2F0。
 * 文字一律先按像素估宽（CJK≈1em / ASCII≈0.55em）再裁剪或换行。
 */

const FONT = "'Noto Sans SC','PingFang SC','Microsoft YaHei',system-ui,sans-serif";
const MONO = "'SF Mono',ui-monospace,'Cascadia Mono',Consolas,monospace";

const C = {
  card: '#141F1D',
  cardLine: 'rgba(255,255,255,0.10)',
  title: '#EAF2F0',
  sub: '#9BAFB0',
  faint: '#6A7F80',
  chip: 'rgba(255,255,255,0.05)',
  chipLine: 'rgba(255,255,255,0.08)',
};

function textW(s: string, fs: number): number {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0x2e7f ? fs : fs * 0.55;
  return w;
}

/** 贪心换行：按像素估宽，CJK 一字一em */
function wrap(s: string, maxPx: number, fs: number): string[] {
  const lines: string[] = [];
  let cur = '';
  let curW = 0;
  for (const ch of s) {
    const cw = ch.charCodeAt(0) > 0x2e7f ? fs : fs * 0.55;
    if (curW + cw > maxPx && cur) {
      lines.push(cur);
      cur = '';
      curW = 0;
    }
    cur += ch;
    curW += cw;
  }
  if (cur) lines.push(cur);
  return lines;
}

function clip(s: string, maxPx: number, fs: number): string {
  if (textW(s, fs) <= maxPx) return s;
  let out = '';
  let w = 0;
  for (const ch of s) {
    const cw = ch.charCodeAt(0) > 0x2e7f ? fs : fs * 0.55;
    if (w + cw > maxPx - 10) return out + '…';
    out += ch;
    w += cw;
  }
  return out;
}

/** 把 arch-glyphs 的手绘图标摆到 SVG 的 (x, y) 处 */
function IconSvg({ name, x, y, size = 16, color = 'currentColor' }: { name: string; x: number; y: number; size?: number; color?: string }) {
  const s = size / 24;
  return (
    <g
      transform={`translate(${x} ${y}) scale(${s})`}
      style={{ color }}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: ARCH_GLYPHS[name] ?? ARCH_GLYPHS.spark }}
    />
  );
}

/** 垂直箭头（向下）。flow=true 时线身流动，方向就是数据流方向 */
function vArrow(x: number, y1: number, y2: number, color: string, key: string, flow = true): ReactNode {
  return (
    <g key={key}>
      <line
        x1={x}
        y1={y1}
        x2={x}
        y2={y2 - 6}
        stroke={color}
        strokeWidth={1.4}
        className={flow ? 'am-flow' : undefined}
      />
      <path d={`M${x - 4} ${y2 - 7} L${x + 4} ${y2 - 7} L${x} ${y2} Z`} fill={color} />
    </g>
  );
}

/** 水平箭头（向右） */
function hArrow(x1: number, x2: number, y: number, color: string, key: string, flow = true): ReactNode {
  return (
    <g key={key}>
      <line
        x1={x1}
        y1={y}
        x2={x2 - 6}
        y2={y}
        stroke={color}
        strokeWidth={1.4}
        className={flow ? 'am-flow' : undefined}
      />
      <path d={`M${x2 - 7} ${y - 4} L${x2 - 7} ${y + 4} L${x2} ${y} Z`} fill={color} />
    </g>
  );
}

/** 脉冲点：外面一圈扩散环 + 中心实心点，表示"这里在往外发东西" */
function PulseDot({ cx, cy, color, key }: { cx: number; cy: number; color: string; key?: string }) {
  return (
    <g key={key}>
      <circle cx={cx} cy={cy} r={4} fill="none" stroke={color} strokeWidth={1.2} className="am-pulse" />
      <circle cx={cx} cy={cy} r={3.2} fill={color} />
    </g>
  );
}

interface CardProps {
  x: number;
  y: number;
  w: number;
  h: number;
  accent: string;
  title: string;
  sub?: string;
  /** 等宽小字（路径 / 度量） */
  mono?: string;
  /** 自动换行的说明文字（占满剩余高度） */
  desc?: string;
  /** 无图标时的字符回退（◆ / ⬢ 之类） */
  glyph?: string;
  /** arch-glyphs 里的手绘图标 key，给了就优先画图标 */
  icon?: string;
  /** 入场档位：同排卡片 0、1、2… 递增，形成依次浮现 */
  i?: number;
}

/** 通用卡片：左侧强调竖条 + 标题行 + 说明 */
function Card({ x, y, w, h, accent, title, sub, mono, desc, glyph, icon, i = 0 }: CardProps) {
  const pad = 14;
  const els: ReactNode[] = [];
  const titleY = y + pad + 13;
  els.push(
    <rect key="bg" x={x} y={y} width={w} height={h} rx={10} fill={C.card} stroke={C.cardLine} strokeWidth={1} />
  );
  els.push(<rect key="bar" x={x} y={y} width={3.5} height={h} rx={1.75} fill={accent} opacity={0.85} />);
  const gX = x + pad + 4;
  if (icon) {
    els.push(
      <rect key="gbg" x={gX - 1.5} y={titleY - 13} width={17} height={17} rx={5} fill={accent} opacity={0.13} />
    );
    els.push(<IconSvg key="g" name={icon} x={gX} y={titleY - 12} size={14} color={accent} />);
  } else {
    els.push(
      <text key="g" x={gX} y={titleY} fontFamily={FONT} fontSize={14} fill={accent}>
        {glyph ?? '◆'}
      </text>
    );
  }
  els.push(
    <text
      key="t"
      x={gX + 20}
      y={titleY}
      fontFamily={FONT}
      fontSize={13.5}
      fontWeight={650}
      fill={C.title}
    >
      {clip(title, w - pad * 2 - 24, 13.5)}
    </text>
  );
  let cy = titleY + (mono ? 19 : sub ? 18 : 6);
  if (mono) {
    els.push(
      <text key="m" x={gX + 20} y={cy} fontFamily={MONO} fontSize={10} fill={accent} opacity={0.9}>
        {clip(mono, w - pad * 2 - 20, 10)}
      </text>
    );
    cy += sub || desc ? 17 : 0;
  }
  if (sub) {
    els.push(
      <text key="s" x={gX + 20} y={cy} fontFamily={FONT} fontSize={10.5} fill={C.sub}>
        {clip(sub, w - pad * 2 - 20, 10.5)}
      </text>
    );
    cy += desc ? 16 : 0;
  }
  if (desc) {
    const lines = wrap(desc, w - pad * 2 - 8, 10).slice(0, Math.max(1, Math.floor((y + h - cy - 6) / 14)));
    lines.forEach((ln, i) => {
      els.push(
        <text key={`d${i}`} x={x + pad} y={cy + 12 + i * 14} fontFamily={FONT} fontSize={10} fill={C.faint}>
          {ln}
        </text>
      );
    });
  }
  return (
    <g className="am-rise" style={{ '--i': i } as CSSProperties}>
      {els}
    </g>
  );
}

/** svgMotionStyle() 每次渲染都重拼一遍字符串没必要，五张图共用一份 */
const MOTION_CSS = svgMotionStyle().replace(/^<style>/, '').replace(/<\/style>$/, '');

/**
 * 画布外壳。动效样式表在这里注入 —— 每张图自带一份，互不依赖，
 * 复制单张 SVG 出去单独打开也照样会动。
 */
function Svg({ h, children, label }: { h: number; children: ReactNode; label: string }) {
  return (
    <svg viewBox={`0 0 1160 ${h}`} width="100%" role="img" aria-label={label} style={{ display: 'block' }}>
      <defs>
        <style dangerouslySetInnerHTML={{ __html: MOTION_CSS }} />
      </defs>
      {children}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════
// 业务架构：能力域 → Rule as Data → 三种出口 → 消费者
// ═══════════════════════════════════════════════════════════════

const ACC = {
  business: '#3E9B4F',
  data: '#2F6FBA',
  app: '#D97B29',
  tech: '#7C5CBF',
  product: '#0F9B8E',
  project: '#C4453C',
};

/** 五个能力域各自的图标（顺序与 BUSINESS_DOMAINS 对应） */
const DOMAIN_ICONS = ['dict', 'blueprint', 'assemble', 'verify', 'deliver'];
/** 三种出口的图标（顺序与 BUSINESS_OUTLETS 对应） */
const OUTLET_ICONS = ['human', 'ai', 'lint'];
/** 三类消费者的图标 */
const CONSUMER_ICONS = ['human', 'ai', 'server'];

export function BusinessDiagram({ data }: { data: ArchViewData }) {
  const { businessDomains: BUSINESS_DOMAINS, businessOutlets: BUSINESS_OUTLETS, businessConsumers: BUSINESS_CONSUMERS } = data;
  const W = 1160;
  const cardW = 216;
  const gap = (W - 20 - cardW * 5) / 4;
  const hubs: { x: number; label: string }[] = BUSINESS_OUTLETS.map((o, i) => ({
    x: 40 + i * 380,
    label: o.name,
  }));
  return (
    <Svg h={492} label="业务架构图">
      {/* 能力域 */}
      {BUSINESS_DOMAINS.map((d, i) => (
        <Card
          key={d.name}
          x={10 + i * (cardW + gap)}
          y={8}
          w={cardW}
          h={112}
          accent={ACC.business}
          icon={DOMAIN_ICONS[i]}
          i={i}
          title={d.name}
          mono={d.metric}
          desc={d.desc}
        />
      ))}
      {BUSINESS_DOMAINS.map((_, i) =>
        vArrow(10 + cardW / 2 + i * (cardW + gap), 120, 158, ACC.business, `a${i}`)
      )}
      {/* 数据核心横带 */}
      <g className="am-rise" style={{ '--i': 5 } as CSSProperties}>
        <rect x={10} y={162} width={W - 20} height={44} rx={10} fill="rgba(62,155,79,0.10)" stroke="rgba(62,155,79,0.35)" strokeWidth={1} />
        <IconSvg name="layers" x={26} y={171} size={16} color="#7CCB8A" />
        <text x={W / 2} y={182} textAnchor="middle" fontFamily={FONT} fontSize={12.5} fontWeight={700} fill="#7CCB8A">
          一份数据 · Rule as Data
        </text>
        <text x={W / 2} y={197} textAnchor="middle" fontFamily={FONT} fontSize={9.5} fill={C.faint}>
          规则 / 蓝图 / 选型全部是结构化 JSON —— 不是 Markdown 文字
        </text>
        <PulseDot cx={W - 28} cy={184} color="#7CCB8A" />
      </g>
      {hubs.map((hUb, i) => vArrow(hUb.x + 170, 206, 244, ACC.business, `b${i}`))}
      {/* 三种出口 */}
      {BUSINESS_OUTLETS.map((o, i) => (
        <Card
          key={o.name}
          x={40 + i * 380}
          y={248}
          w={340}
          h={104}
          accent={ACC.data}
          icon={OUTLET_ICONS[i]}
          i={6 + i}
          title={o.name}
          desc={o.desc}
        />
      ))}
      <text x={W / 2} y={382} textAnchor="middle" fontFamily={FONT} fontSize={9.5} fill={C.faint}>
        ↓ 谁在消费
      </text>
      {/* 消费者 */}
      {BUSINESS_CONSUMERS.map((cname, i) => (
        <g key={cname} className="am-rise" style={{ '--i': 9 + i } as CSSProperties}>
          <rect x={130 + i * 320} y={396} width={280} height={40} rx={20} fill={C.chip} stroke={C.chipLine} />
          <IconSvg name={CONSUMER_ICONS[i]} x={142 + i * 320} y={408} size={16} color={ACC.business} />
          <text x={168 + i * 320} y={421} fontFamily={FONT} fontSize={12} fill={C.sub}>
            {cname}
          </text>
        </g>
      ))}
      {/* 服务边界 */}
      <g className="am-rise" style={{ '--i': 12 } as CSSProperties}>
        <IconSvg name="scale" x={16} y={459} size={13} color={C.faint} />
        <text x={W - 12} y={470} textAnchor="end" fontFamily={FONT} fontSize={9.5} fill={C.faint}>
          服务边界：单人 + 小团队（≤10 人）· 不做 auto-fix / 绑定某家 AI / 多租户 SaaS
        </text>
      </g>
    </Svg>
  );
}

// ═══════════════════════════════════════════════════════════════
// 数据架构：资产 → 构建管道 → 消费方 + 治理
// ═══════════════════════════════════════════════════════════════

/** 三份数据资产的图标（顺序与 DATA_ASSETS 对应） */
const ASSET_ICONS = ['rulesDb', 'cookDb', 'stackDb'];
/** 构建管道四段的图标 */
const PIPELINE_ICONS = ['pen', 'gear', 'stackDb', 'sync'];
/** 三类消费方的图标 */
const DATA_CONSUMER_ICONS = ['browser', 'server', 'deliver'];
/** 治理三道闸的图标 */
const GOVERNANCE_ICONS = ['anchor', 'crossCheck', 'flag'];

export function DataDiagram({ data }: { data: ArchViewData }) {
  const { dataAssets: DATA_ASSETS, dataPipeline: DATA_PIPELINE, dataConsumers: DATA_CONSUMERS, dataGovernance: DATA_GOVERNANCE } = data;
  const W = 1160;
  const aw = 370;
  const pw = 250;
  const pgap = 30;
  const px0 = (W - (pw * 4 + pgap * 3)) / 2;
  return (
    <Svg h={596} label="数据架构图">
      {DATA_ASSETS.map((a, i) => (
        <Card
          key={a.path}
          x={10 + i * 390}
          y={8}
          w={aw}
          h={116}
          accent={ACC.data}
          icon={ASSET_ICONS[i]}
          i={i}
          title={a.name}
          mono={a.path}
          desc={`${a.metric} — ${a.desc}`}
        />
      ))}
      {[0, 1, 2].map((i) =>
        vArrow(10 + aw / 2 + i * 390, 124, 158, ACC.data, `a${i}`)
      )}
      {/* 构建管道容器：边框走慢速流动，一眼看出"这是条在跑的管道" */}
      <g className="am-rise" style={{ '--i': 3 } as CSSProperties}>
        <rect x={px0 - 16} y={162} width={pw * 4 + pgap * 3 + 32} height={124} rx={12} fill="rgba(47,111,186,0.06)" stroke="rgba(47,111,186,0.30)" strokeDasharray="6 4" className="am-flow-slow" />
        <IconSvg name="pipe" x={px0 - 10} y={174} size={14} color="#7FA8D9" />
        <text x={px0 + 10} y={182} fontFamily={FONT} fontSize={10} fontWeight={700} fill="#7FA8D9" letterSpacing={1}>
          构建管道 · 改内容改 tools/content/*.py，不改 JSON
        </text>
      </g>
      {DATA_PIPELINE.map((s, i) => (
        <g key={s.name} className="am-rise" style={{ '--i': 4 + i } as CSSProperties}>
          <rect x={px0 + i * (pw + pgap)} y={196} width={pw} height={72} rx={10} fill={C.card} stroke={C.cardLine} />
          <rect x={px0 + i * (pw + pgap) + 10} y={208} width={18} height={18} rx={5} fill={ACC.data} opacity={0.13} />
          <IconSvg name={PIPELINE_ICONS[i]} x={px0 + i * (pw + pgap) + 12} y={210} size={14} color={ACC.data} />
          <text x={px0 + i * (pw + pgap) + 34} y={222} fontFamily={MONO} fontSize={10.5} fontWeight={650} fill={C.title}>
            {clip(s.name, pw - 46, 10.5)}
          </text>
          {wrap(s.desc, pw - 28, 9.5).slice(0, 2).map((ln, j) => (
            <text key={j} x={px0 + i * (pw + pgap) + 14} y={242 + j * 13} fontFamily={FONT} fontSize={9.5} fill={C.faint}>
              {ln}
            </text>
          ))}
          {i < 3 && hArrow(px0 + i * (pw + pgap) + pw + 2, px0 + (i + 1) * (pw + pgap) - 2, 232, ACC.data, `p${i}`)}
        </g>
      ))}
      {vArrow(W / 2, 286, 320, ACC.data, 'down')}
      {DATA_CONSUMERS.map((cname, i) => (
        <g key={cname} className="am-rise" style={{ '--i': 8 + i } as CSSProperties}>
          <rect x={10 + i * 390} y={324} width={aw} height={58} rx={10} fill={C.card} stroke={C.cardLine} />
          <IconSvg name={DATA_CONSUMER_ICONS[i]} x={22 + i * 390} y={345} size={15} color={ACC.data} />
          <text x={46 + i * 390} y={346} fontFamily={FONT} fontSize={10.5} fontWeight={650} fill={C.title}>
            {['前端', '后端', '导出'][i]}
          </text>
          {wrap(cname, aw - 60, 9.5).map((ln, j) => (
            <text key={j} x={46 + i * 390} y={361 + j * 12} fontFamily={FONT} fontSize={9.5} fill={C.faint}>
              {ln}
            </text>
          ))}
        </g>
      ))}
      {/* 治理 */}
      <g className="am-rise" style={{ '--i': 11 } as CSSProperties}>
        <rect x={10} y={414} width={W - 20} height={172} rx={12} fill="rgba(255,255,255,0.02)" stroke={C.chipLine} />
        <IconSvg name="lock" x={26} y={431} size={14} color="#7FA8D9" />
        <text x={46} y={442} fontFamily={FONT} fontSize={11.5} fontWeight={700} fill="#7FA8D9" letterSpacing={1}>
          治理规则 —— 防数据漂移的三道闸
        </text>
      </g>
      {DATA_GOVERNANCE.map((g, i) => (
        <g key={i} className="am-rise" style={{ '--i': 12 + i } as CSSProperties}>
          <rect x={26 + i * 380} y={458} width={364} height={104} rx={9} fill={C.card} stroke={C.cardLine} />
          <IconSvg name={GOVERNANCE_ICONS[i]} x={40 + i * 380} y={474} size={15} color={ACC.data} />
          {wrap(g, 336, 10).map((ln, j) => (
            <text key={j} x={40 + i * 380} y={508 + j * 15} fontFamily={FONT} fontSize={10} fill={C.sub}>
              {ln}
            </text>
          ))}
        </g>
      ))}
    </Svg>
  );
}

// ═══════════════════════════════════════════════════════════════
// 应用架构：五层横带（页面 → 领域库 → API 客户端 → 服务 → 数据源）
// ═══════════════════════════════════════════════════════════════

/** 五层的图标（顺序与 APP_LAYERS 对应） */
const APP_LAYER_ICONS = ['browser', 'lib', 'plug', 'server', 'datasource'];

export function AppDiagram({ data }: { data: ArchViewData }) {
  const { appLayers: APP_LAYERS, appContracts: APP_CONTRACTS } = data;
  const W = 1160;
  const bandH = 96;
  const bandGap = 22;
  const top = 8;
  const leftW = 252;
  return (
    <Svg h={748} label="应用架构图">
      {APP_LAYERS.map((layer, i) => {
        const y = top + i * (bandH + bandGap);
        const chipsX0 = 20 + leftW + 16;
        const maxW = W - 20 - chipsX0;
        // chips 自动换行排布
        const rows: { text: string; x: number; y: number; w: number }[] = [];
        let cx = chipsX0;
        let cy = y + 20;
        for (const item of layer.items) {
          const cw = textW(item, 10.5) + 20;
          if (cx + cw > chipsX0 + maxW) {
            cx = chipsX0;
            cy += 30;
          }
          rows.push({ text: item, x: cx, y: cy, w: cw });
          cx += cw + 8;
        }
        const accent = [ACC.app, '#B86520', '#9A8F6A', '#8A6F3C', '#6A7F80'][i] ?? ACC.app;
        return (
          <g key={layer.name} className="am-rise" style={{ '--i': i } as CSSProperties}>
            <rect x={20} y={y} width={W - 40} height={bandH} rx={11} fill={C.card} stroke={C.cardLine} />
            <rect x={20} y={y} width={leftW} height={bandH} rx={11} fill="rgba(217,123,41,0.08)" stroke="rgba(217,123,41,0.25)" />
            <rect x={34} y={y + 17} width={20} height={20} rx={6} fill={accent} opacity={0.14} />
            <IconSvg name={APP_LAYER_ICONS[i]} x={37} y={y + 20} size={14} color={accent} />
            <text x={62} y={y + 32} fontFamily={FONT} fontSize={13.5} fontWeight={700} fill={C.title}>
              {layer.name}
            </text>
            {wrap(layer.desc, leftW - 36, 9).slice(0, 3).map((ln, j) => (
              <text key={j} x={38} y={y + 48 + j * 13} fontFamily={FONT} fontSize={9} fill={C.faint}>
                {ln}
              </text>
            ))}
            {rows.map((cItem, j) => (
              <g key={j}>
                <rect x={cItem.x} y={cItem.y} width={cItem.w} height={22} rx={6} fill={C.chip} stroke={C.chipLine} />
                <text
                  x={cItem.x + 10}
                  y={cItem.y + 15}
                  fontFamily={j >= 0 && layer.name === '页面层' ? FONT : MONO}
                  fontSize={10.5}
                  fill={C.sub}
                >
                  {clip(cItem.text, cItem.w - 16, 10.5)}
                </text>
              </g>
            ))}
            {i < APP_LAYERS.length - 1 &&
              vArrow(W - 44, y + bandH, y + bandH + bandGap, accent, `l${i}`)}
          </g>
        );
      })}
      {/* 契约 */}
      <g className="am-rise" style={{ '--i': 5 } as CSSProperties}>
        <rect x={20} y={top + 5 * (bandH + bandGap) - bandGap + 8} width={W - 40} height={104} rx={12} fill="rgba(217,123,41,0.05)" stroke="rgba(217,123,41,0.25)" />
        <IconSvg name="handshake" x={36} y={top + 5 * (bandH + bandGap) - bandGap + 22} size={15} color="#E09B5C" />
        <text x={58} y={top + 5 * (bandH + bandGap) - bandGap + 34} fontFamily={FONT} fontSize={11.5} fontWeight={700} fill="#E09B5C" letterSpacing={1}>
          前后端契约
        </text>
      </g>
      {APP_CONTRACTS.map((cItem, i) => (
        <g key={i} className="am-rise" style={{ '--i': 6 + i } as CSSProperties}>
          <circle cx={44} cy={top + 5 * (bandH + bandGap) - bandGap + 56 + i * 22} r={3.5} fill={ACC.app} className="am-breathe" />
          {wrap(cItem, 1000, 10).slice(0, 1).map((ln, j) => (
            <text key={j} x={58} y={top + 5 * (bandH + bandGap) - bandGap + 60 + i * 22} fontFamily={FONT} fontSize={10} fill={C.sub}>
              {ln}
            </text>
          ))}
        </g>
      ))}
    </Svg>
  );
}

// ═══════════════════════════════════════════════════════════════
// 产品架构：功能面 × 引擎三层 × 严重度配额 × 不做清单
// ═══════════════════════════════════════════════════════════════

/** 功能面的图标（顺序与档案里的 product.surfaces 对应） */
const PRODUCT_SURFACE_ICONS = ['search', 'compare', 'assemble', 'layers', 'blueprint', 'lint', 'deliver'];
/** 引擎三层的图标 */
const ENGINE_ICONS = ['regex', 'tree', 'brain'];

export function ProductDiagram({ data }: { data: ArchViewData }) {
  const {
    severityRows: SEVERITY_ROWS,
    productSurfaces: PRODUCT_SURFACES,
    engineLayers: ENGINE_LAYERS,
    mustLimit: MUST_LIMIT,
    productNonGoals: PRODUCT_NON_GOALS,
  } = data;
  const W = 1160;
  const sw = 292;
  const engineX = 650;
  const engineW = W - engineX - 20;
  const mustSum = SEVERITY_ROWS.filter((sIr) => sIr.name === 'MUST' || sIr.name === 'NEVER').reduce(
    (n, sIr) => n + sIr.count,
    0
  );
  const gaugeW = 520;
  return (
    <Svg h={648} label="产品架构图">
      <text x={20} y={24} fontFamily={FONT} fontSize={11.5} fontWeight={700} fill="#5FC4B8" letterSpacing={1}>
        六个功能面
      </text>
      {PRODUCT_SURFACES.map((sIr, i) => (
        <Card
          key={sIr.name}
          x={20 + (i % 2) * (sw + 14)}
          y={38 + Math.floor(i / 2) * 108}
          w={sw}
          h={94}
          accent={ACC.product}
          icon={PRODUCT_SURFACE_ICONS[i]}
          i={i}
          title={sIr.name}
          desc={sIr.desc}
        />
      ))}
      {/* 引擎三层 */}
      <rect x={engineX} y={38} width={engineW} height={324} rx={12} fill="rgba(15,155,142,0.05)" stroke="rgba(15,155,142,0.28)" />
      <text x={engineX + 18} y={64} fontFamily={FONT} fontSize={11.5} fontWeight={700} fill="#5FC4B8" letterSpacing={1}>
        校验引擎三层 —— 台阶式演进
      </text>
      {ENGINE_LAYERS.map((l, i) => {
        const y = 80 + i * 92;
        const done = l.status === 'done';
        return (
          <g key={l.name} className="am-rise" style={{ '--i': 6 + i } as CSSProperties}>
            <rect x={engineX + 18} y={y} width={engineW - 36} height={70} rx={9} fill={C.card} stroke={done ? 'rgba(15,155,142,0.45)' : C.cardLine} strokeDasharray={done ? undefined : '5 4'} />
            <rect x={engineX + 28} y={y + 14} width={18} height={18} rx={5} fill={done ? ACC.product : C.faint} opacity={done ? 0.14 : 0.08} />
            <IconSvg name={ENGINE_ICONS[i]} x={engineX + 31} y={y + 17} size={12} color={done ? ACC.product : C.faint} />
            <text x={engineX + 54} y={y + 29} fontFamily={FONT} fontSize={12.5} fontWeight={650} fill={C.title}>
              {l.name}
            </text>
            <text x={engineX + engineW - 34} y={y + 29} textAnchor="end" fontFamily={MONO} fontSize={10} fill={done ? '#5FC4B8' : C.faint}>
              {l.metric}
            </text>
            {wrap(l.desc, engineW - 76, 9.5).map((ln, j) => (
              <text key={j} x={engineX + 40} y={y + 48 + j * 13} fontFamily={FONT} fontSize={9.5} fill={C.faint}>
                {ln}
              </text>
            ))}
            {i < 2 && vArrow(engineX + 40, y + 70, y + 92, ACC.product, `e${i}`)}
          </g>
        );
      })}
      <text x={engineX + 18} y={396} fontFamily={FONT} fontSize={9.5} fill={C.faint}>
        非正则层一律 skipped 如实披露 —— 宁可少判，不伪造判定。
      </text>
      {/* 严重度配额 */}
      <g className="am-rise" style={{ '--i': 9 } as CSSProperties}>
        <rect x={20} y={396} width={598} height={118} rx={12} fill={C.card} stroke={C.cardLine} />
        <IconSvg name="gauge" x={36} y={411} size={15} color="#5FC4B8" />
        <text x={58} y={424} fontFamily={FONT} fontSize={11.5} fontWeight={700} fill="#5FC4B8" letterSpacing={1}>
          严重度与强制配额
        </text>
      </g>
      {SEVERITY_ROWS.map((sIr, i) => (
        <g key={sIr.name} className="am-rise" style={{ '--i': 10 + i } as CSSProperties}>
          <rect x={38 + i * 142} y={440} width={130} height={26} rx={7} fill={C.chip} stroke={C.chipLine} />
          <text x={50 + i * 142} y={457} fontFamily={MONO} fontSize={10.5} fill={C.sub}>
            {sIr.name}
          </text>
          <text x={158 + i * 142} y={457} textAnchor="end" fontFamily={MONO} fontSize={11} fontWeight={700} fill={C.title}>
            {sIr.count}
          </text>
        </g>
      ))}
      <text x={38} y={488} fontFamily={FONT} fontSize={9.5} fill={C.faint}>
        MUST + NEVER 硬上限 {MUST_LIMIT}
      </text>
      {/* 配额条：满额就闪 —— 这不是装饰，是"这条线不能越"的提醒 */}
      <g className="am-rise" style={{ '--i': 14 } as CSSProperties}>
        <rect x={38} y={494} width={gaugeW} height={10} rx={5} fill="rgba(255,255,255,0.06)" />
        <rect
          x={38}
          y={494}
          width={Math.max(6, (gaugeW * mustSum) / MUST_LIMIT)}
          height={10}
          rx={5}
          fill={mustSum >= MUST_LIMIT ? '#E5484D' : ACC.product}
          className={mustSum >= MUST_LIMIT ? 'am-breathe' : undefined}
        />
        <text x={38 + gaugeW + 12} y={503} fontFamily={MONO} fontSize={10.5} fill={mustSum >= MUST_LIMIT ? '#E5484D' : '#5FC4B8'}>
          {mustSum}/{MUST_LIMIT} · 已满额
        </text>
      </g>
      {/* 不做清单 */}
      <g className="am-rise" style={{ '--i': 15 } as CSSProperties}>
        <rect x={20} y={530} width={W - 40} height={104} rx={12} fill="rgba(196,69,60,0.05)" stroke="rgba(196,69,60,0.28)" />
        <IconSvg name="noGo" x={36} y={546} size={14} color="#D97A73" />
        <text x={58} y={556} fontFamily={FONT} fontSize={11.5} fontWeight={700} fill="#D97A73" letterSpacing={1}>
          不做清单 —— 边界也是产品决策
        </text>
      </g>
      {PRODUCT_NON_GOALS.map((g, i) => (
        <g key={i} className="am-rise" style={{ '--i': 16 + i } as CSSProperties}>
          <IconSvg name="noGo" x={42 + i * 376} y={576} size={13} color="#D97A73" />
          {wrap(g, 340, 10).map((ln, j) => (
            <text key={j} x={62 + i * 376} y={584 + j * 14} fontFamily={FONT} fontSize={10} fill={C.sub}>
              {ln}
            </text>
          ))}
        </g>
      ))}
    </Svg>
  );
}

// ═══════════════════════════════════════════════════════════════
// 项目架构：仓库分区 × 构建链 × 验证链 × 里程碑
// ═══════════════════════════════════════════════════════════════

const TONE_COLOR: Record<string, string> = {
  key: '#E5B45A',
  done: '#56C596',
  next: '#7FA8D9',
  later: '#6A7F80',
};

/** 仓库分区的图标（顺序与档案里的 project.dirs 对应） */
const PROJECT_DIR_ICONS = [
  'folderRules',
  'folderCook',
  'folderStack',
  'folderWeb',
  'folderServer',
  'folderTools',
  'folderDocs',
  'folderProfiles',
];
/** 构建链四步的图标 */
const PIPELINE_STEP_ICONS = ['pen', 'gear', 'crossCheck', 'verify'];
/** 里程碑按紧急度的图标 */
const TONE_ICON: Record<string, string> = { key: 'key', done: 'verify', next: 'flag', later: 'clock' };
/** 验证链六段的图标 */
const VERIFY_ICONS = ['assemble', 'layers', 'verify', 'regex', 'crossCheck', 'spark'];

export function ProjectDiagram({ data }: { data: ArchViewData }) {
  const {
    verifyTotal: VERIFY_TOTAL,
    projectDirs: PROJECT_DIRS,
    projectPipeline: PROJECT_PIPELINE,
    verifyChain: VERIFY_CHAIN,
    projectRoadmap: PROJECT_ROADMAP,
  } = data;
  const W = 1160;
  const dirX = 20;
  const dirW = 350;
  const pipeX = 404;
  const pipeW = 250;
  const rightX = 688;
  const rightW = W - rightX - 20;
  const segColors = [ACC.project, '#D96A59', '#B8654F', '#9A5A50', '#8A4A44', '#7A403C'];
  const segTotal = VERIFY_TOTAL;
  let acc = 0;
  return (
    <Svg h={656} label="项目架构图">
      <text x={dirX} y={24} fontFamily={FONT} fontSize={11.5} fontWeight={700} fill="#D98A82" letterSpacing={1}>
        仓库分区
      </text>
      {PROJECT_DIRS.map((d, i) => {
        const y = 38 + i * 60;
        return (
          <g key={d.path} className="am-rise" style={{ '--i': i } as CSSProperties}>
            {i > 0 && <line x1={dirX + 16} y1={y - 8} x2={dirX + 16} y2={y + 8} stroke={C.chipLine} strokeWidth={1.2} className="am-flow-slow" />}
            <rect x={dirX} y={y} width={dirW} height={50} rx={9} fill={C.card} stroke={C.cardLine} />
            <IconSvg name={PROJECT_DIR_ICONS[i]} x={dirX + 12} y={y + 13} size={16} color={ACC.project} />
            <text x={dirX + 36} y={y + 21} fontFamily={MONO} fontSize={11} fontWeight={650} fill={ACC.project}>
              {clip(d.path, dirW - 52, 11)}
            </text>
            <text x={dirX + 36} y={y + 38} fontFamily={FONT} fontSize={9.5} fill={C.faint}>
              {clip(d.role, dirW - 52, 9.5)}
            </text>
          </g>
        );
      })}
      <text x={pipeX} y={24} fontFamily={FONT} fontSize={11.5} fontWeight={700} fill="#D98A82" letterSpacing={1}>
        构建链
      </text>
      {PROJECT_PIPELINE.map((p, i) => {
        const y = 38 + i * 90;
        return (
          <g key={i} className="am-rise" style={{ '--i': 7 + i } as CSSProperties}>
            <rect x={pipeX} y={y} width={pipeW} height={66} rx={9} fill={C.card} stroke={C.cardLine} />
            <IconSvg name={PIPELINE_STEP_ICONS[i]} x={pipeX + 12} y={y + 13} size={15} color={ACC.project} />
            <text x={pipeX + 34} y={y + 25} fontFamily={MONO} fontSize={10} fontWeight={650} fill={C.title}>
              {`Step ${i + 1}`}
            </text>
            {wrap(p, pipeW - 28, 9.5).slice(0, 2).map((ln, j) => (
              <text key={j} x={pipeX + 14} y={y + 42 + j * 13} fontFamily={MONO} fontSize={9} fill={C.faint}>
                {clip(ln, pipeW - 28, 9)}
              </text>
            ))}
            {i < PROJECT_PIPELINE.length - 1 &&
              vArrow(pipeX + pipeW / 2, y + 66, y + 90, ACC.project, `pp${i}`)}
          </g>
        );
      })}
      {/* 验证链 */}
      <g className="am-rise" style={{ '--i': 11 } as CSSProperties}>
        <IconSvg name="scale" x={rightX - 2} y={12} size={14} color="#D98A82" />
        <text x={rightX + 18} y={24} fontFamily={FONT} fontSize={11.5} fontWeight={700} fill="#D98A82" letterSpacing={1}>
          验证链 · {segTotal} 项自检
        </text>
        <rect x={rightX} y={38} width={rightW} height={30} rx={8} fill="rgba(255,255,255,0.04)" stroke={C.chipLine} />
      </g>
      {VERIFY_CHAIN.map((seg, i) => {
        const x = rightX + 2 + (rightW - 4) * (acc / segTotal);
        const w = ((rightW - 4) * seg.count) / segTotal;
        acc += seg.count;
        return (
          <rect key={seg.name} x={x} y={40} width={Math.max(3, w)} height={26} fill={segColors[i]} opacity={0.85} rx={4} className="am-rise" style={{ '--i': 12 + i } as CSSProperties} />
        );
      })}
      {VERIFY_CHAIN.map((seg, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = rightX + col * 240;
        const y = 92 + row * 46;
        return (
          <g key={seg.name} className="am-rise" style={{ '--i': 12 + i } as CSSProperties}>
            <rect x={x} y={y} width={226} height={38} rx={8} fill={C.card} stroke={C.cardLine} />
            <IconSvg name={VERIFY_ICONS[i]} x={x + 8} y={y + 12} size={14} color={segColors[i]} />
            <text x={x + 28} y={y + 16} fontFamily={FONT} fontSize={10.5} fontWeight={650} fill={C.title}>
              {seg.name}
            </text>
            <text x={x + 216} y={y + 16} textAnchor="end" fontFamily={MONO} fontSize={10.5} fill={segColors[i]}>
              {seg.count}
            </text>
            <text x={x + 28} y={y + 30} fontFamily={FONT} fontSize={8.5} fill={C.faint}>
              {clip(seg.desc, 190, 8.5)}
            </text>
          </g>
        );
      })}
      {/* 里程碑 */}
      <text x={rightX} y={266} fontFamily={FONT} fontSize={11.5} fontWeight={700} fill="#D98A82" letterSpacing={1}>
        待推进里程碑
      </text>
      {PROJECT_ROADMAP.map((mItem, i) => {
        const y = 280 + i * 52;
        const color = TONE_COLOR[mItem.tone];
        return (
          <g key={mItem.name} className="am-rise" style={{ '--i': 18 + i } as CSSProperties}>
            <rect x={rightX} y={y} width={rightW} height={44} rx={9} fill={C.card} stroke={C.cardLine} />
            <IconSvg name={TONE_ICON[mItem.tone]} x={rightX + 12} y={y + 15} size={15} color={color} />
            <text x={rightX + 34} y={y + 19} fontFamily={FONT} fontSize={10.5} fontWeight={650} fill={C.title}>
              {clip(mItem.name, 240, 10.5)}
            </text>
            <text x={rightX + 34} y={y + 34} fontFamily={FONT} fontSize={9} fill={C.faint}>
              {clip(mItem.desc, rightW - 52, 9)}
            </text>
            <text x={rightX + rightW - 14} y={y + 19} textAnchor="end" fontFamily={FONT} fontSize={9} fill={color}>
              {mItem.tone === 'key' ? '关键' : mItem.tone === 'done' ? '已落地' : mItem.tone === 'next' ? '下一步' : '待定'}
            </text>
          </g>
        );
      })}
    </Svg>
  );
}
