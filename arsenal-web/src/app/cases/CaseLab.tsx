'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ArchLink, ArchNode, CasePlan, CaseSlice } from '@/lib/case-types';
import { cases, casesMeta, casesStats, defaultParams } from '@/lib/case-cases';
import { planToPrompt, sliceFileName, synthCase } from '@/lib/case-synth';
import CodeBlock from '@/components/CodeBlock';

const KIND_COLOR: Record<string, string> = {
  backend: '#4FB0C6',
  database: '#D9A441',
  cloud: '#8B7BD8',
  messagebus: '#46A758',
  security: '#E5484D',
};

/**
 * 建议架构图。
 *
 * 为什么不用 arch-diagram.ts：那个绘图器的输入是「选型台的泳道 + 槽位」，
 * 而场景案例的架构是「自由节点 + 连线」，硬套会把节点塞进不属于它的泳道。
 * 这里按 tier 分层画，零依赖、纯函数，与项目其余部分同一种手绘 SVG 做法。
 */
function ArchSuggestion({ nodes, links }: { nodes: ArchNode[]; links: ArchLink[] }) {
  if (!nodes.length) return null;

  const NODE_W = 104;
  const NODE_H = 34;
  const GAP_X = 16;
  const GAP_Y = 52;

  const tiers = [...new Set(nodes.map((n) => n.tier))].sort((a, b) => a - b);
  const pos = new Map<string, { x: number; y: number }>();
  const maxCols = Math.max(...tiers.map((t) => nodes.filter((n) => n.tier === t).length));
  const W = Math.max(360, maxCols * (NODE_W + GAP_X) + GAP_X);

  tiers.forEach((t, ti) => {
    const row = nodes.filter((n) => n.tier === t);
    const rowW = row.length * NODE_W + (row.length - 1) * GAP_X;
    const startX = (W - rowW) / 2;
    row.forEach((n, i) => {
      pos.set(n.id, { x: startX + i * (NODE_W + GAP_X), y: GAP_Y + ti * (NODE_H + GAP_Y) });
    });
  });

  const H = GAP_Y + tiers.length * (NODE_H + GAP_Y);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 260 }} role="img"
      aria-label="建议架构图">
      <defs>
        <marker id="case-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3"
          orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L6,3 L0,6 z" fill="#3A4A44" />
        </marker>
      </defs>
      {links.map((l, i) => {
        const a = pos.get(l.from);
        const b = pos.get(l.to);
        if (!a || !b) return null;
        const x1 = a.x + NODE_W / 2;
        const y1 = a.y + NODE_H;
        const x2 = b.x + NODE_W / 2;
        const y2 = b.y;
        const my = (y1 + y2) / 2;
        return (
          <g key={i}>
            <path d={`M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`}
              fill="none" stroke="#2C3A34" strokeWidth={1.2} markerEnd="url(#case-arrow)" />
            {l.label && (
              <text x={(x1 + x2) / 2} y={my - 3} fontSize={9} fill="#6D7F77"
                textAnchor="middle">{l.label}</text>
            )}
          </g>
        );
      })}
      {nodes.map((n) => {
        const p = pos.get(n.id);
        if (!p) return null;
        const c = KIND_COLOR[n.kind] ?? '#5E6E67';
        return (
          <g key={n.id}>
            <rect x={p.x} y={p.y} width={NODE_W} height={NODE_H} rx={5}
              fill="rgba(255,255,255,0.02)" stroke={c} strokeOpacity={0.5} />
            <text x={p.x + NODE_W / 2} y={p.y + NODE_H / 2 + 4} fontSize={11.5}
              fill="#D6E0DB" textAnchor="middle">{n.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function SliceCard({ kase, slice, open, onToggle }: {
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

export default function CaseLab() {
  const [caseId, setCaseId] = useState(cases[0]?.id ?? '');
  const [paramsMap, setParamsMap] = useState<Record<string, Record<string, string>>>(() => {
    const m: Record<string, Record<string, string>> = {};
    for (const c of cases) m[c.id] = defaultParams(c);
    return m;
  });
  const [openSlices, setOpenSlices] = useState<Record<string, boolean>>({});
  const [showInactive, setShowInactive] = useState(false);
  const [toast, setToast] = useState('');

  const kase = cases.find((c) => c.id === caseId) ?? cases[0];
  const params = paramsMap[kase.id] ?? defaultParams(kase);

  // 纯函数重算：点一下参数立刻出结果，无请求
  const plan: CasePlan = useMemo(() => synthCase(kase, params), [kase, params]);

  const setLevel = (driverId: string, levelId: string) => {
    setParamsMap((m) => ({ ...m, [kase.id]: { ...(m[kase.id] ?? {}), [driverId]: levelId } }));
  };

  const copyPrompt = async () => {
    const text = planToPrompt(plan);
    try {
      await navigator.clipboard.writeText(text);
      setToast(`已复制 ${text.length} 字符的需求描述`);
    } catch {
      setToast('复制失败，请手动选择文本');
    }
    setTimeout(() => setToast(''), 2600);
  };

  const allOpen = plan.activeSlices.length > 0 &&
    plan.activeSlices.every(({ slice }) => openSlices[slice.id] !== false);

  return (
    <div className="animate-fade-up space-y-6">
      {/* ── Hero ─────────────────────────────────────── */}
      <header className="grid-bg relative overflow-hidden rounded-xl border border-line bg-surface">
        <div className="pointer-events-none absolute inset-0" style={{
          background:
            'radial-gradient(110% 100% at 0% 0%, rgba(217,164,65,0.10) 0%, transparent 58%), radial-gradient(80% 90% at 100% 100%, rgba(79,176,198,0.08) 0%, transparent 60%)',
        }} />
        <div className="relative px-6 py-7 md:px-9">
          <div className="mono mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs uppercase tracking-[0.2em] text-fgFaint">
            <span style={{ color: '#D9A441' }}>◫</span>
            <span>scenario lab</span>
            <span className="text-lineHi">/</span>
            <span>v{casesMeta.version}</span>
            <span className="text-lineHi">/</span>
            <span>{casesMeta.releasedAt}</span>
          </div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-fg md:text-[32px]">
            场景案例库
          </h1>
          <p className="mt-3 max-w-3xl text-[14.5px] leading-relaxed text-fgMuted">
            说出你的问题、调几个参数，直接给<span className="text-fg">建表 DDL 与生产级 Java</span>。
            每个代码切片都带命中条件：<span className="text-fg">命中的给出代码</span>，
            没命中的<span className="text-fg">必须写明为什么不适用</span> —— 不许静默省略。
            参数组合本身成立不了（比如「百万 QPS + 强一致 + P99&lt;50ms」）会在顶部标黄。
            与「最佳实践案例库」的分工：那边讲
            <span className="text-fg">一个功能标准该怎么写</span>，这边讲
            <span className="text-fg">在这些约束下该怎么设计</span>。
          </p>
          <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-5">
            {[
              { k: '场景', v: casesStats.cases, s: '个真实问题' },
              { k: '切片', v: casesStats.slices, s: '个条件切片' },
              { k: '驱动参数', v: casesStats.drivers, s: '个可调维度' },
              { k: '代码', v: casesStats.lines, s: '行 SQL+Java' },
              { k: '规则', v: casesStats.rules, s: '条被引规则' },
            ].map((x) => (
              <div key={x.k} className="bg-surface px-3 py-2.5">
                <div className="mono text-[19px] font-semibold text-fg">{x.v}</div>
                <div className="text-[11.5px] text-fgFaint">{x.k} · {x.s}</div>
              </div>
            ))}
          </div>
        </div>
      </header>

      {/* ── 三栏 ─────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[200px_260px_minmax(0,1fr)]">
        {/* 场景列表 */}
        <aside className="space-y-2">
          <div className="text-2xs uppercase tracking-[0.14em] text-fgFaint">场景</div>
          {cases.map((c) => {
            const on = c.id === kase.id;
            return (
              <button key={c.id} onClick={() => setCaseId(c.id)}
                className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${on
                  ? 'border-accent/40 bg-accent/[0.06]'
                  : 'border-line bg-surface hover:bg-white/[0.02]'}`}>
                <div className="flex items-center gap-2">
                  <span className="mono text-[13px]" style={{ color: '#D9A441' }}>{c.glyph}</span>
                  <span className="text-[13px] font-medium text-fg">{c.name}</span>
                </div>
                <div className="mt-1 text-[11.5px] leading-relaxed text-fgFaint">
                  {c.subtitle}
                </div>
                <div className="mono mt-1 text-[10.5px] text-fgFaint">
                  {c.sliceCount} 切片 · {c.driverCount} 参数
                </div>
              </button>
            );
          })}
        </aside>

        {/* 参数面板 */}
        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <div className="flex items-center justify-between">
            <span className="text-2xs uppercase tracking-[0.14em] text-fgFaint">参数</span>
            <button onClick={() => setParamsMap((m) => ({ ...m, [kase.id]: defaultParams(kase) }))}
              className="mono rounded border border-line px-1.5 py-0.5 text-[10px] text-fgMuted hover:text-fg">
              重置
            </button>
          </div>

          <div className="rounded-lg border border-line bg-surface p-3">
            <div className="text-[12.5px] font-medium text-fg">{kase.name}</div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-fgFaint">{kase.problem}</p>
          </div>

          {kase.drivers.map((d) => (
            <div key={d.id} className="rounded-lg border border-line bg-surface p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12.5px] font-medium text-fg">{d.name}</span>
                {d.unit && <span className="mono text-[10px] text-fgFaint">{d.unit}</span>}
              </div>
              {d.hint && <div className="mt-0.5 text-[11px] text-fgFaint">{d.hint}</div>}
              <div className="mt-2 flex flex-wrap gap-1">
                {d.levels.map((lv) => {
                  const on = params[d.id] === lv.id;
                  return (
                    <button key={lv.id} onClick={() => setLevel(d.id, lv.id)} title={lv.note ?? ''}
                      className={`mono rounded border px-1.5 py-0.5 text-[11px] transition-colors ${on
                        ? 'border-accent/50 bg-accent/10 text-fg'
                        : 'border-line text-fgMuted hover:text-fg'}`}>
                      {lv.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <button onClick={copyPrompt}
            className="w-full rounded-lg border border-accent/40 bg-accent/[0.06] px-3 py-2 text-[12.5px] font-medium text-fg transition-colors hover:bg-accent/10">
            复制为 prompt
          </button>
          {toast && (
            <div className="rounded border border-line bg-surface px-2.5 py-1.5 text-[11.5px] text-fgMuted">
              {toast}
            </div>
          )}
        </aside>

        {/* 结果区 */}
        <section className="min-w-0 space-y-4">
          {/* 矛盾告警 */}
          {plan.warnings.length > 0 && (
            <div className="rounded-lg border px-4 py-3"
              style={{ borderColor: 'rgba(217,164,65,0.45)', background: 'rgba(217,164,65,0.07)' }}>
              <div className="text-[12.5px] font-medium" style={{ color: '#D9A441' }}>
                ⚠ 这组参数本身有 {plan.warnings.length} 处需要你先决定
              </div>
              <ul className="mt-1.5 space-y-1">
                {plan.warnings.map((w, i) => (
                  <li key={i} className="text-[12px] leading-relaxed text-fgMuted">{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 摘要 */}
          <div className="rounded-lg border border-line bg-surface px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-fgMuted">
              <span>命中 <span className="mono text-fg">{plan.activeSlices.length}</span>
                /{kase.slices.length} 个切片</span>
              <span className="text-lineHi">·</span>
              <span>涉及 <span className="mono text-fg">{plan.rules.length}</span> 条规则</span>
              <span className="text-lineHi">·</span>
              <span>建议架构 <span className="mono text-fg">{plan.architecture.nodes.length}</span> 个节点</span>
              {plan.inactiveSlices.length > 0 && (
                <>
                  <span className="text-lineHi">·</span>
                  <button onClick={() => setShowInactive((v) => !v)} className="hover:text-fg">
                    {plan.inactiveSlices.length} 个切片未命中（{showInactive ? '收起' : '展开看原因'}）
                  </button>
                </>
              )}
              <span className="ml-auto flex gap-1">
                <button onClick={() => setOpenSlices(
                  Object.fromEntries(kase.slices.map((s) => [s.id, !allOpen])))}
                  className="mono rounded border border-line px-1.5 py-0.5 text-[10.5px] hover:text-fg">
                  {allOpen ? '全部收起' : '展开全部'}
                </button>
              </span>
            </div>
          </div>

          {/* 未命中 —— 折叠但不省略 */}
          {showInactive && plan.inactiveSlices.length > 0 && (
            <div className="space-y-1.5 rounded-lg border border-line bg-surface p-3">
              <div className="text-2xs uppercase tracking-[0.14em] text-fgFaint">
                未命中的切片（不是「不需要做」，是「这个参数下做了属于过度设计」）
              </div>
              {plan.inactiveSlices.map((s, i) => (
                <div key={i} className="border-t border-line pt-1.5 text-[12px] first:border-0">
                  <span className="text-fg">{s.slice.goal}</span>
                  <span className="mx-1.5 text-fgFaint">—</span>
                  <span className="leading-relaxed text-fgMuted">{s.reason}</span>
                </div>
              ))}
            </div>
          )}

          {/* 建议架构 */}
          <div className="rounded-lg border border-line bg-surface p-4">
            <div className="mb-2 text-2xs uppercase tracking-[0.14em] text-fgFaint">
              建议架构（随参数变化）
            </div>
            <ArchSuggestion nodes={plan.architecture.nodes} links={plan.architecture.links} />
          </div>

          {/* 设计决策清单 */}
          {plan.decisions.length > 0 && (
            <div className="rounded-lg border border-line bg-surface p-4">
              <div className="mb-2 text-2xs uppercase tracking-[0.14em] text-fgFaint">
                设计决策清单
              </div>
              <ol className="space-y-1.5">
                {plan.decisions.map((d, i) => (
                  <li key={i} className="text-[12.5px] leading-relaxed">
                    <span className="mono mr-1.5 text-[11px] text-fgFaint">{i + 1}.</span>
                    <span className="text-fgMuted">{d.question} </span>
                    <span style={{ color: '#46A758' }}>{d.chosen}</span>
                    <span className="text-fgFaint">（{d.tradeoff}）</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* 切片 */}
          <div className="space-y-3">
            {plan.activeSlices.map(({ slice }) => (
              <SliceCard
                key={slice.id}
                kase={kase}
                slice={slice}
                open={openSlices[slice.id] !== false}
                onToggle={() => setOpenSlices((m) => ({ ...m, [slice.id]: m[slice.id] === false }))}
              />
            ))}
            {plan.activeSlices.length === 0 && (
              <div className="rounded-lg border border-line bg-surface px-4 py-8 text-center text-[13px] text-fgMuted">
                当前参数下没有任何切片命中 —— 通常意味着这个量级用不上本场景的方案。
                {kase.notSuitableFor.length > 0 && (
                  <div className="mt-2 text-[12px] text-fgFaint">
                    {kase.notSuitableFor[0].reason}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 性能参照 */}
          <details className="rounded-lg border border-line bg-surface p-4">
            <summary className="cursor-pointer text-2xs uppercase tracking-[0.14em] text-fgFaint">
              {kase.benchmark.title}
            </summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr>
                    {kase.benchmark.columns.map((c, i) => (
                      <th key={i} className="border-b border-line px-2 py-1.5 text-left font-medium text-fgMuted">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {kase.benchmark.rows.map((r, i) => (
                    <tr key={i}>
                      {r.map((cell, j) => (
                        <td key={j} className="border-b border-line/50 px-2 py-1.5 text-fgMuted">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-fgFaint">
              {kase.benchmark.conclusion}
            </p>
          </details>
        </section>
      </div>
    </div>
  );
}
