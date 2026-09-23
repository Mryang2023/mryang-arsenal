'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { ArchLink, ArchNode, CasePlan, CaseSlice } from '@/lib/case-types';
import { cases, casesMeta, casesStats, defaultParams } from '@/lib/case-cases';
import { planToPrompt, sliceFileName, synthCase } from '@/lib/case-synth';
import { DIAGRAM_PALETTE, textWidth } from '@/lib/arch-diagram';
import { buildZip } from '@/lib/zip-lite';
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
 * 建议架构图。
 *
 * 为什么不直接调 buildArchDiagram：它的输入是 `picks: StackPicks + audit: ArchAudit`，
 * 泳道来自 arch.lanes 常量（7 条固定泳道），而场景的架构是「自由节点 + 连线」——
 * 硬套会把「对象存储」这类节点塞进它不属于的泳道，产出一张语义错误的图。
 * 所以这里复用它的**底层**（字符宽度、调色板），布局仍按场景自己的 tier 分层。
 */
function ArchSuggestion({ nodes, links }: { nodes: ArchNode[]; links: ArchLink[] }) {
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

  /**
   * 导出整包：把当前参数下命中的切片打成 zip（DDL 汇总一份、每个切片一份 Java、外加 README）。
   *
   * 刻意只导出**命中的**切片 —— 未命中的那些是「这个参数下属于过度设计」，
   * 混进包里等于把不适用方案一起交付出去。
   */
  const exportZip = () => {
    const entries = plan.activeSlices.map(({ slice }) => ({
      name: `${kase.id}/${String(slice.order).padStart(2, '0')}-${slice.id}.java`,
      data: slice.code,
    }));
    const ddl = plan.activeSlices
      .map(({ slice }) => `-- ${slice.order}. ${slice.goal}\n${slice.sql}`)
      .join('\n\n');
    entries.unshift({ name: `${kase.id}/schema.sql`, data: ddl });
    entries.push({ name: `${kase.id}/README.md`, data: planToPrompt(plan) });

    const zip = buildZip(entries);
    const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${kase.id}-${plan.activeSlices.length}slices.zip`;
    a.click();
    URL.revokeObjectURL(url);
    setToast(`已导出 ${entries.length} 个文件（${Math.max(1, Math.round(zip.length / 1024))} KB）`);
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

          {kase.drivers.map((d) => {
            const selected = d.levels.find((lv) => lv.id === params[d.id]);
            return (
              <div key={d.id} className="rounded-lg border border-line bg-surface p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12.5px] font-medium text-fg">{d.name}</span>
                  {d.unit && <span className="mono text-[10px] text-fgFaint">{d.unit}</span>}
                </div>
                {d.hint && <div className="mt-0.5 text-[11px] text-fgFaint">{d.hint}</div>}

                {/* 段选器：整条轨道连通、各档等宽分割。比散按钮更能表达
                    「这几个档位是同一个参数的取值」这件事 —— 散按钮看起来像并列的开关。 */}
                <div className="mt-2 flex overflow-hidden rounded-md border border-line">
                  {d.levels.map((lv, i) => {
                    const on = params[d.id] === lv.id;
                    return (
                      <button key={lv.id} onClick={() => setLevel(d.id, lv.id)} title={lv.note ?? ''}
                        aria-pressed={on}
                        className={`mono flex-1 px-1 py-1 text-[11px] leading-tight transition-colors ${
                          i > 0 ? 'border-l border-line' : ''
                        } ${on
                          ? 'bg-accent/15 font-medium text-fg'
                          : 'text-fgMuted hover:bg-white/[0.03] hover:text-fg'}`}>
                        {lv.label}
                      </button>
                    );
                  })}
                </div>
                {selected?.note && (
                  <div className="mt-1 text-[11px] leading-relaxed text-fgMuted">{selected.note}</div>
                )}
              </div>
            );
          })}

          {/* 互斥路线：说出来比藏起来好 —— 否则读者看到「最多命中 5/6」会以为有 bug */}
          {(kase.exclusiveGroups ?? []).length > 0 && (
            <div className="rounded-lg border px-3 py-2.5"
              style={{ borderColor: 'rgba(79,176,198,0.35)', background: 'rgba(79,176,198,0.05)' }}>
              <div className="text-[12px] font-medium text-fg">⇄ 本场景有互斥路线</div>
              {(kase.exclusiveGroups ?? []).map((g, i) => (
                <div key={i} className="mt-1 text-[11.5px] leading-relaxed text-fgMuted">
                  {g.note}
                  <span className="mono ml-1 text-[10.5px] text-fgFaint">
                    （互斥参数：{g.drivers.map((id) => kase.drivers.find((x) => x.id === id)?.name ?? id).join('、')}）
                  </span>
                </div>
              ))}
            </div>
          )}

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
                <button onClick={exportZip}
                  className="mono rounded border border-accent/40 bg-accent/[0.06] px-1.5 py-0.5 text-[10.5px] text-fg hover:bg-accent/10">
                  导出整包 .zip
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

          {/* 性能参照。
              `benchmark` 是**可选**字段：6 个场景里只有 2 个提供了可核的性能对照。
              没有时不许编一个，也不许把整块藏掉 —— 让人知道「这一项本场景没有」，
              与「有但你不小心折叠了」必须是两种看得出来不同的状态。 */}
          {kase.benchmark ? (
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
          ) : (
            <div className="rounded-lg border border-dashed border-line bg-surface px-4 py-3 text-[12px] text-fgMuted">
              本场景未提供性能参照 —— 没有实测口径的数字不写，避免把量级结论当成通用结论照抄。
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
