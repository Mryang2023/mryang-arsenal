'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { CaseParams, CaseSlice } from '@/lib/case-types';
import { cases, defaultParams, getCase, symptomParams } from '@/lib/case-cases';
import { planToPrompt, synthCase, whenHits } from '@/lib/case-synth';
import { buildZip } from '@/lib/zip-lite';
import { ArchSuggestion, LevelAxis, SliceCard } from '../_lib/case-parts';
import { caseUrl, decodeParams, encodeParams, isFullyValid } from '../_lib/params-codec';
import StepRail from '../_lib/step-rail';

/**
 * L2 —— 只回答一个问题：**这个约束下，全局长什么样？**
 *
 * 参数来自 URL（`?p=<code>&s=<symptomId>`）：刷新不丢、链接可发人。
 * 改参数**不触发 Next 导航** —— 用 `history.replaceState` 静默改写 `p`，
 * 否则每点一档就重跑一次服务端渲染 + 把滚动位置弹回顶部。
 *
 * ⚠️ 调这个组件的地方必须用 `<Suspense>` 包一层：`output:'export'` 下
 * `useSearchParams()` 只有在 Suspense 边界内才允许在静态页里读。
 */

/**
 * 切片目录：把当前参数下命中的切片按 `layer` 分层列成锚点清单，
 * 点一下跳到对应切片卡。单场景 2~6 片、2~6 个分层，不会失控。
 * 没有它，一屏切片卡滚下去没有落脚处，和「所有内容挤一页」是同一种病。
 */
function SliceIndex({ items }: { items: { slice: CaseSlice }[] }) {
  if (!items.length) return null;
  const byLayer = new Map<string, CaseSlice[]>();
  for (const { slice } of items) {
    if (!byLayer.has(slice.layer)) byLayer.set(slice.layer, []);
    byLayer.get(slice.layer)!.push(slice);
  }
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-2xs uppercase tracking-[0.14em] text-fgFaint">本场景切片目录（按分层）</span>
        <span className="mono text-[11px] text-fgFaint">{items.length} 片</span>
      </div>
      <div className="space-y-2.5">
        {[...byLayer.entries()].map(([layer, slices]) => (
          <div key={layer}>
            <div className="mb-1 text-[11px] text-fgFaint">{layer}</div>
            <div className="flex flex-wrap gap-1.5">
              {slices.map((s) => (
                <a key={s.id} href={`#slice-${s.id}`}
                  className="mono rounded border border-line bg-canvas px-2 py-0.5 text-[11px] text-fgMuted transition-colors hover:border-brass/50 hover:text-fg">
                  #{s.order} {s.goal}
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CaseBench({ caseId }: { caseId: string }) {
  const sp = useSearchParams();
  const kase = getCase(caseId) ?? cases[0];

  const code = sp.get('p');
  const symptomId = sp.get('s');
  const symptom = kase.symptoms.find((s) => s.id === symptomId) ?? null;
  /** URL 串里有认不出来的位 → 如实说一句，而不是悄悄回到推荐档装作认了 */
  const codeOk = code === null || isFullyValid(kase.drivers, code);

  const fallback = useMemo(
    () => (symptom ? symptomParams(kase, symptom) : defaultParams(kase)),
    [kase, symptom]
  );

  const [params, setParams] = useState<CaseParams>(() =>
    code ? decodeParams(kase.drivers, code, fallback) : fallback
  );
  const [openSlices, setOpenSlices] = useState<Record<string, boolean>>({});
  const [showInactive, setShowInactive] = useState(false);
  const [toast, setToast] = useState('');
  /** 当前是从哪条症状进来的。手动改参数就清掉 —— 参数一改，入口就不再是依据了 */
  const [activeSymptom, setActiveSymptom] = useState<string | null>(symptom?.id ?? null);

  const plan = useMemo(() => synthCase(kase, params), [kase, params]);

  /**
   * 写回地址栏：不给 Next 添负担，也不让页面跳动。
   *
   * ⚠️ state 必须原样传回去（不能传 null）：App Router 把自己的恢复信息存在
   * `history.state` 里，换成 null 之后「后退再前进」会丢失这一屏的滚动与状态。
   */
  const syncUrl = (next: CaseParams, sym: string | null) => {
    try {
      window.history.replaceState(
        window.history.state,
        '',
        caseUrl(kase.id, encodeParams(kase.drivers, next), sym)
      );
    } catch {
      // 某些嵌入式环境禁了 history API —— 写不了就算了，页面本身照常工作
    }
  };

  const setLevel = (driverId: string, levelId: string) => {
    setActiveSymptom(null);
    const next = { ...params, [driverId]: levelId };
    setParams(next);
    syncUrl(next, null);
  };

  const reset = () => {
    const next = defaultParams(kase);
    setActiveSymptom(null);
    setParams(next);
    syncUrl(next, null);
  };

  const activeSymptomText = activeSymptom
    ? kase.symptoms.find((s) => s.id === activeSymptom)?.text
    : undefined;

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
    <div className="animate-fade-up space-y-5">
      {/* ── 顶部：珠链 + 场景切换条 ───────────────────── */}
      <header className="space-y-3">
        <StepRail current="params" ctx={{ caseId: kase.id }} trail={[{ k: '场景', v: kase.name }]} />
        {/* 横向切换条：替代原来左侧那一列 sticky 场景列表 —— 三层路由下场景切换是「换页」，
            不再是「换一块面板」，所以做成一条看得见全体的横条（兼一个滚动区，别再开第三个） */}
        <div className="scroll-thin flex gap-2 overflow-x-auto pb-1">
          {cases.map((c) => {
            const on = c.id === kase.id;
            return (
              <Link key={c.id} href={caseUrl(c.id)} data-case-switch={c.id}
                className={`shrink-0 rounded-lg border px-3 py-1.5 transition-colors ${on
                  ? 'border-accent/40 bg-accent/[0.06]'
                  : 'border-line bg-surface hover:bg-white/[0.02]'}`}>
                <span className="mono mr-1.5 text-[12px]" style={{ color: '#D9A441' }}>{c.glyph}</span>
                <span className={`text-[12.5px] ${on ? 'text-fg' : 'text-fgMuted'}`}>{c.name}</span>
              </Link>
            );
          })}
        </div>
      </header>

      <h1 className="text-[21px] font-semibold leading-snug tracking-tight text-fg md:text-[24px]">
        {kase.name}
        <span className="ml-2 text-[13px] font-normal text-fgFaint">{kase.subtitle}</span>
      </h1>

      {/* ── 两栏：参数 | 结果 ─────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* 参数面板。⚠️ sticky 必须配 max-h + overflow —— 面板比视口高时
            光钉住会把底部（互斥提示 / 复制按钮）永远留在屏幕外。 */}
        <aside className="scroll-thin space-y-3 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto lg:pr-1.5">
          <div className="flex items-center justify-between">
            <span className="text-2xs uppercase tracking-[0.14em] text-fgFaint">参数</span>
            <button onClick={reset}
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
            const exclusive = (kase.exclusiveGroups ?? []).some((g) => g.drivers.includes(d.id));
            // 这个参数能改变什么 —— 构建期实测，页面只负责把结论说破。
            // 引用它的告警条数 / 当前正在响的条数，用与引擎同一把尺子（whenHits）算，
            // 免得出现「顶部没黄条、参数卡上却写着 ⚠ 1」。
            const confRules = kase.conflicts.filter((c) => (c.when[d.id] ?? []).length > 0);
            const nsRules = kase.notSuitableFor.filter((n) => (n.when[d.id] ?? []).length > 0);
            const warnRules = [...confRules, ...nsRules];
            const warnFired = warnRules.filter((r) => whenHits(r.when, params)).length;
            const warnKind = nsRules.length === 0 ? '矛盾告警'
              : confRules.length === 0 ? '适用性提示' : '告警';
            return (
              <div key={d.id} className="rounded-lg border border-line bg-surface p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12.5px] font-medium text-fg">{d.name}</span>
                  {d.unit && <span className="mono text-[10px] text-fgFaint">{d.unit}</span>}
                </div>
                {d.hint && <div className="mt-0.5 text-[11px] text-fgFaint">{d.hint}</div>}

                {/* 档位轴：位置即序（小 → 大），填充段 = 已选到的量级。
                    互斥路线没有大小语义，轴上不填充（见 LevelAxis 注释）。 */}
                <LevelAxis driver={d} value={params[d.id] ?? d.levels[0]?.id ?? ''}
                  exclusive={exclusive} onChange={(id) => setLevel(d.id, id)} />
                {selected?.note && (
                  <div className="mt-1 text-[11px] leading-relaxed text-fgMuted">{selected.note}</div>
                )}

                {/* 影响面：拖这个滑块到底会不会改变结果。
                    不说破的话，11 个 inert 参数会让用户判定「页面坏了」。 */}
                {d.inert ? (
                  <div className="mt-1.5 flex items-center gap-1.5 rounded px-1.5 py-1"
                    style={{ border: '1px solid rgba(217,164,65,0.28)', background: 'rgba(217,164,65,0.06)' }}>
                    <span className="text-[10.5px]" style={{ color: '#D9A441' }}>⊘</span>
                    <span className="text-[10.5px] leading-tight text-fgMuted">
                      只影响{warnKind} · 不改变命中切片
                    </span>
                    {warnRules.length > 0 && (
                      <span className="mono ml-auto shrink-0 text-[10px]"
                        style={{ color: warnFired > 0 ? '#D9A441' : '#80918A' }}
                        title={`引用这个参数的告警共 ${warnRules.length} 条，当前参数下触发 ${warnFired} 条`}>
                        ⚠ {warnFired}/{warnRules.length}
                      </span>
                    )}
                  </div>
                ) : typeof d.sensitivity === 'number' ? (
                  <div className="mt-1.5 flex items-center gap-1.5"
                    title="切换这个参数的档位时，命中切片集合发生变化的比例（构建期穷举实测）">
                    <span className="text-[10px] text-fgFaint">影响面</span>
                    <span className="h-[3px] w-12 overflow-hidden rounded-full"
                      style={{ background: 'rgba(232,240,236,0.12)' }}>
                      <span className="block h-full rounded-full"
                        style={{ width: `${Math.round(d.sensitivity * 100)}%`,
                          background: 'rgba(127,166,80,0.85)' }} />
                    </span>
                    <span className="mono text-[10px] text-fgMuted">
                      {Math.round(d.sensitivity * 100)}%
                    </span>
                  </div>
                ) : null}
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
          {/* URL 串里有认不出来的位 —— 如实说一句 */}
          {!codeOk && (
            <div className="rounded-lg border border-line px-3 py-2 text-[12px] leading-relaxed text-fgMuted">
              <span className="mono text-fgFaint">↯</span> 链接里的参数串
              <span className="mono mx-1 text-fgMuted">{code}</span>
              有认不出来的位，已退回推荐档 —— 地址不用手改，在下面点档位即可。
            </div>
          )}

          {/* 入口溯源：这组参数是哪条症状推出来的，必须看得见 ——
              否则用户看到 6 个参数已被设好，无从判断该不该信。 */}
          {activeSymptomText && (
            <div className="flex items-start gap-2 rounded-lg border px-3 py-2"
              style={{ borderColor: 'rgba(217,164,65,0.35)', background: 'rgba(217,164,65,0.05)' }}>
              <span className="mono mt-[2px] text-[11px]" style={{ color: '#D9A441' }}>↳</span>
              <span className="text-[12px] leading-relaxed text-fgMuted">
                从症状进入：<span className="text-fg">{activeSymptomText}</span>
                <span className="text-fgFaint"> —— 参数已按该症状设好，改动任一参数即解除</span>
              </span>
              <button onClick={reset} className="mono ml-auto shrink-0 text-[11px] text-fgFaint hover:text-fg">
                回到推荐档
              </button>
            </div>
          )}

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

          {/* 切片目录（按分层）+ 切片本体 */}
          <SliceIndex items={plan.activeSlices} />
          <div className="space-y-3">
            {plan.activeSlices.map(({ slice }) => (
              <div key={slice.id} id={`slice-${slice.id}`} className="scroll-mt-4">
                <SliceCard
                  kase={kase}
                  slice={slice}
                  open={openSlices[slice.id] !== false}
                  onToggle={() => setOpenSlices((m) => ({ ...m, [slice.id]: m[slice.id] === false }))}
                />
              </div>
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
              `benchmark` 是**可选**字段：只有给出了可核口径的场景才写。
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
