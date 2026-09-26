'use client';

/**
 * 场景库三层共用的图元 —— 从 `CaseLab.tsx` **原样搬过来**，一行逻辑都没改。
 *
 * 搬家的唯一目的是让 L1 / L2 各自只引自己要的那几块：
 * 之前 909 行的单文件把「症状墙 / 参数面板 / 架构图 / 切片卡」焊在一起，
 * 想拆路由就必须先拆文件。P1 的「上图」（星群 / 参数谱 / 轨道图）会来改这里，
 * 但那是次夜的事 —— 今晚只搬，不改观。
 */

import { useState } from 'react';
import Link from 'next/link';
import type { ArchLink, ArchNode, CaseSlice, Driver } from '@/lib/case-types';
import { sliceFileName } from '@/lib/case-synth';
import { DIAGRAM_PALETTE, textWidth } from '@/lib/arch-diagram';
import CodeBlock from '@/components/CodeBlock';

const KIND_COLOR: Record<string, string> = {
  backend: '#4FB0C6',
  database: '#D9A441',
  cloud: '#8B7BD8',
  messagebus: '#46A758',
  security: '#E5484D',
};

/** 图上文字与底色统一走 arch-diagram 的调色板，避免这里再定义一套会漂移的颜色。 */
const P = DIAGRAM_PALETTE.dark;

/**
 * 节点宽度按文字实际宽度算。
 *
 * 写死宽度在「样本元数据」这类中文标签上会溢出 —— SVG 的文字不会自动换行，
 * 溢出后表现为「标签压在节点边框上」，而且只在某些场景才出现。
 * 字符宽度规则（CJK≈1em、ASCII≈0.55em）复用 arch-diagram 的实现，
 * 这样图上文字与全站其他图的度量完全一致。
 */
function nodeWidth(label: string): number {
  return Math.max(88, Math.round(textWidth(label, 11.5)) + 28);
}

/**
 * 参数指纹：场景卡里的一小行点阵 —— 每组点对应一个驱动参数，
 * 点数 = 档位数，亮点 = 当前选中的档。
 *
 * 为什么用图：200px 边栏里「6 参数」三个字读不出参数空间的形状；
 * 点阵让「这个场景参数空间多密、你选到哪了」变成一眼可扫的图形，
 * 还能跨场景对比（hotspot-cache 的六组点明显比别的场景密）。
 */
export function ParamFingerprint({ drivers, params }: { drivers: Driver[]; params: Record<string, string> }) {
  const DOT = 3;
  const GAP = 2.5;
  const SEP = 5;
  const H = 8;
  const widths = drivers.map((d) => d.levels.length * (DOT + GAP) - GAP);
  const w = widths.reduce((a, b) => a + b, 0) + SEP * Math.max(0, drivers.length - 1);
  let x = 0;
  return (
    <svg viewBox={`0 0 ${w} ${H}`} width={w} height={H} className="mt-1.5" role="img"
      aria-label="参数指纹：每组点是一个驱动参数的档位，亮点是当前选中档">
      {drivers.map((d, i) => {
        const sel = d.levels.findIndex((l) => l.id === params[d.id]);
        const dots = d.levels.map((lv, j) => (
          <circle key={lv.id} cx={x + j * (DOT + GAP) + DOT / 2} cy={H / 2}
            r={j === sel ? 2.7 : 1.6}
            fill={j === sel ? '#D9A441' : 'rgba(232,240,236,0.22)'} />
        ));
        x += widths[i] + SEP;
        return <g key={d.id}>{dots}</g>;
      })}
    </svg>
  );
}

/**
 * 档位轴：把文字段选按钮升级成一条真正的轴 ——
 * 点在轨道上的**位置**就是档位的序（小 → 大），填充段表示当前选到了多大规模。
 *
 * 互斥路线（如 JDK 17 vs 21）不画填充段：它们没有「大小」语义，
 * 填充会暗示「选 21 比 17 更进一步」—— 图形不能替数据撒谎。
 */
export function LevelAxis({ driver, value, exclusive, onChange }: {
  driver: Driver;
  value: string;
  exclusive: boolean;
  onChange: (id: string) => void;
}) {
  const n = driver.levels.length;
  const idx = Math.max(0, driver.levels.findIndex((l) => l.id === value));
  const cap = `${100 / (2 * n)}%`;
  return (
    <div className="mt-2">
      <div className="relative">
        {/* 轨道：从第一档中心画到最后一档中心 */}
        <div className="absolute top-[6px] h-px" style={{ left: cap, right: cap, background: '#33413A' }} />
        {!exclusive && n > 1 && (
          <div className="absolute top-[5.5px] h-[2px] rounded-full"
            style={{
              left: cap,
              width: `calc((100% - ${100 / n}%) * ${n > 1 ? idx / (n - 1) : 0})`,
              background: 'rgba(217,164,65,0.8)',
            }} />
        )}
        <div className="relative grid" style={{ gridTemplateColumns: `repeat(${n},minmax(0,1fr))` }}>
          {driver.levels.map((lv, j) => {
            const on = j === idx;
            return (
              <button key={lv.id} onClick={() => onChange(lv.id)} title={lv.note ?? lv.label}
                aria-pressed={on}
                className="group flex flex-col items-center focus:outline-none">
                <span className="flex h-[13px] items-center">
                  <span className="block rounded-full transition-all"
                    style={on
                      ? { width: 9, height: 9, background: '#D9A441', boxShadow: '0 0 0 3px rgba(217,164,65,0.16)' }
                      : { width: 7, height: 7, background: '#0B0F0E', border: '1.5px solid #4A5A52' }} />
                </span>
                <span className={`mt-0.5 px-0.5 text-center text-[10px] leading-tight transition-colors ${on
                  ? 'font-medium text-fg'
                  : 'text-fgMuted group-hover:text-fg'}`}>
                  {lv.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * 建议架构图。
 *
 * 为什么不直接调 buildArchDiagram：它的输入是 `picks: StackPicks + audit: ArchAudit`，
 * 泳道来自 arch.lanes 常量（7 条固定泳道），而场景的架构是「自由节点 + 连线」——
 * 硬套会把「对象存储」这类节点塞进它不属于的泳道，产出一张语义错误的图。
 * 所以这里复用它的**底层**（字符宽度、调色板），布局仍按场景自己的 tier 分层。
 */
export function ArchSuggestion({ nodes, links }: { nodes: ArchNode[]; links: ArchLink[] }) {
  if (!nodes.length) return null;

  const NODE_H = 34;
  const GAP_X = 14;
  const GAP_Y = 46;

  const tiers = [...new Set(nodes.map((n) => n.tier))].sort((a, b) => a - b);
  const widthOf = new Map(nodes.map((n) => [n.id, nodeWidth(n.label)]));
  const rowWidth = (t: number) => {
    const row = nodes.filter((n) => n.tier === t);
    return row.reduce((sum, n) => sum + (widthOf.get(n.id) ?? 0), 0) + Math.max(0, row.length - 1) * GAP_X;
  };
  const widest = Math.max(360, ...tiers.map(rowWidth));
  const W = widest + GAP_X * 2;

  const pos = new Map<string, { x: number; y: number; w: number }>();
  tiers.forEach((t, ti) => {
    const row = nodes.filter((n) => n.tier === t);
    // 每行按「最宽行」居中：不居中时上下层左边界参差，连线看起来全是斜的。
    let x = GAP_X + (widest - rowWidth(t)) / 2;
    const y = GAP_Y + ti * (NODE_H + GAP_Y);
    row.forEach((n) => {
      const w = widthOf.get(n.id) ?? 88;
      pos.set(n.id, { x, y, w });
      x += w + GAP_X;
    });
  });

  const H = GAP_Y + tiers.length * (NODE_H + GAP_Y);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 280 }} role="img"
      aria-label="建议架构图">
      <defs>
        <marker id="case-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3"
          orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L6,3 L0,6 z" fill={P.spine} />
        </marker>
      </defs>
      {links.map((l, i) => {
        const a = pos.get(l.from);
        const b = pos.get(l.to);
        if (!a || !b) return null;
        const x1 = a.x + a.w / 2;
        const y1 = a.y + NODE_H;
        const x2 = b.x + b.w / 2;
        const y2 = b.y;
        const my = (y1 + y2) / 2;
        return (
          <g key={i}>
            <path d={`M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`}
              fill="none" stroke={P.bandStroke} strokeWidth={1.2} markerEnd="url(#case-arrow)" />
            {l.label && (
              <text x={(x1 + x2) / 2} y={my - 3} fontSize={9} fill={P.fgFaint}
                textAnchor="middle">{l.label}</text>
            )}
          </g>
        );
      })}
      {nodes.map((n) => {
        const p = pos.get(n.id);
        if (!p) return null;
        const c = KIND_COLOR[n.kind] ?? P.fgFaint;
        return (
          <g key={n.id}>
            <rect x={p.x} y={p.y} width={p.w} height={NODE_H} rx={5}
              fill={P.card} stroke={c} strokeOpacity={0.55} />
            <text x={p.x + p.w / 2} y={p.y + NODE_H / 2 + 4} fontSize={11.5}
              fill={P.fg} textAnchor="middle">{n.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** L2 结果区的切片卡。整片施工图（代码/要点/坑/规则/出处）都在这一张卡里 —— L3 上线后搬走 */
export function SliceCard({ kase, slice, open, onToggle }: {
  kase: { id: string; name: string };
  slice: CaseSlice;
  open: boolean;
  onToggle: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const code = showAll ? slice.code : slice.code.split('\n').slice(0, 28).join('\n');
  const truncated = !showAll && slice.code.split('\n').length > 28;

  const download = () => {
    const blob = new Blob([slice.code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = sliceFileName(kase as never, slice);
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <button onClick={onToggle}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.02]">
        <span className="mono mt-0.5 w-5 shrink-0 text-[11px] text-fgFaint">
          {open ? '▾' : '▸'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="mono text-2xs text-fgFaint">#{slice.order}</span>
            <span className="text-[14px] font-medium text-fg">{slice.goal}</span>
            <span className="mono rounded border border-line px-1 text-[10px] text-fgFaint">
              {slice.layer}
            </span>
          </span>
          <span className="mt-1 block text-[12.5px] leading-relaxed text-fgMuted">
            {slice.why}
          </span>
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-line px-4 py-4">
          {/* 决策 */}
          <div className="rounded-md border border-line bg-white/[0.015] p-3">
            <div className="text-[12px] font-medium text-fg">决策 · {slice.decision.question}</div>
            <div className="mt-2 space-y-1">
              {slice.decision.options.map((o, i) => (
                <div key={i} className="flex gap-2 text-[12px] text-fgMuted">
                  <span className="text-fgFaint">○</span><span>{o}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 border-t border-line pt-2 text-[12px]">
              <span className="text-fgFaint">选中 → </span>
              <span style={{ color: '#46A758' }}>{slice.decision.chosen}</span>
            </div>
            <div className="mt-1 text-[12px] text-fgMuted">
              <span className="text-fgFaint">代价 → </span>{slice.decision.tradeoff}
            </div>
          </div>

          {/* DDL */}
          <div>
            <div className="mb-1.5 text-2xs uppercase tracking-[0.14em] text-fgFaint">
              建表 / DDL
            </div>
            <CodeBlock code={slice.sql} lang="sql" label="schema.sql" />
          </div>

          {/* Java */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-2xs uppercase tracking-[0.14em] text-fgFaint">
                Java · {sliceFileName(kase as never, slice)}
              </span>
              <span className="flex gap-1">
                <button onClick={() => setShowAll((v) => !v)}
                  className="mono rounded border border-line px-1.5 py-0.5 text-[10px] text-fgMuted hover:text-fg">
                  {truncated ? '展开全部' : '收起'}
                </button>
                <button onClick={download}
                  className="mono rounded border border-line px-1.5 py-0.5 text-[10px] text-fgMuted hover:text-fg">
                  下载 .java
                </button>
              </span>
            </div>
            <CodeBlock code={code} lang="java" label={sliceFileName(kase as never, slice)} />
            {truncated && (
              <div className="mt-1 text-[11px] text-fgFaint">
                已折叠显示前 28 行，共 {slice.code.split('\n').length} 行
              </div>
            )}
          </div>

          {/* 要点锚点 */}
          <div>
            <div className="mb-1.5 text-2xs uppercase tracking-[0.14em] text-fgFaint">
              要点（锚点定位）
            </div>
            <div className="space-y-1.5">
              {slice.highlights.map((h, i) => (
                <div key={i} className="rounded border border-line bg-white/[0.015] px-3 py-2">
                  <div className="flex items-start gap-2">
                    <span className="mono mt-0.5 text-[10px]" style={{ color: '#D9A441' }}>
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-medium text-fg">{h.title}</div>
                      <div className="mt-0.5 text-[12px] leading-relaxed text-fgMuted">
                        {h.text}
                      </div>
                      <div className="mono mt-1 truncate text-[11px] text-fgFaint">
                        ⌖ {h.mark}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 坑 / 不适用 / 规则 / 出处 */}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded border border-line p-3">
              <div className="mb-1.5 text-2xs uppercase tracking-[0.14em] text-fgFaint">坑</div>
              <ul className="space-y-1">
                {slice.pitfalls.map((p, i) => (
                  <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-fgMuted">
                    <span style={{ color: '#E5484D' }}>⚠</span><span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded border border-line p-3">
              <div className="mb-1.5 text-2xs uppercase tracking-[0.14em] text-fgFaint">
                不要用在这些情况
              </div>
              <ul className="space-y-1">
                {slice.notSuitable.map((p, i) => (
                  <li key={i} className="flex gap-2 text-[12px] leading-relaxed text-fgMuted">
                    <span style={{ color: '#5E6E67' }}>✕</span><span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="text-2xs uppercase tracking-[0.14em] text-fgFaint">关联规则</span>
            {slice.relatedRules.map((r) => (
              <Link key={r} href={`/rules/${r}/`}
                className="mono rounded border border-line px-1.5 py-0.5 text-[11px] text-fgMuted hover:text-fg">
                {r}
              </Link>
            ))}
          </div>

          <div className="border-t border-line pt-2 text-[11.5px] text-fgFaint">
            出处：
            {slice.refs.map((r, i) => (
              <span key={i}>
                {i > 0 && ' · '}
                {r.url ? (
                  <a href={r.url} target="_blank" rel="noreferrer"
                    className="underline decoration-dotted hover:text-fg">{r.title}</a>
                ) : (
                  <span>{r.title}{r.note ? `（${r.note}）` : ''}</span>
                )}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
