'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { CaseDef } from '@/lib/case-types';
import { allSymptoms, cases, casesMeta, casesStats, defaultParams, symptomParams } from '@/lib/case-cases';
import { synthCase } from '@/lib/case-synth';
import { ParamFingerprint } from './_lib/case-parts';
import { caseUrl, encodeParams } from './_lib/params-codec';
import StepRail from './_lib/step-rail';

/**
 * L1 —— 只回答一个问题：**我遇到的是什么？**
 *
 * 这一层不许出现参数、代码、切片列表（那些在 L2 / L3）。
 * 点一条症状 = 落到对应场景，并把参数一次性设到该症状该在的档位上 ——
 * 用户不必先理解 6 个参数各自是什么。
 */
function TriageBoard() {
  const [q, setQ] = useState('');
  const all = useMemo(() => allSymptoms(), []);

  // 命中数预览：32 条症状 × 纯函数重算，代价可忽略，但必须 memo ——
  // 搜索框每敲一个字都会重渲染，不 memo 就是每次 32 次全场景合成。
  const rows = useMemo(
    () =>
      all.map(({ kase, symptom }) => {
        const params = symptomParams(kase, symptom);
        return {
          kase,
          symptom,
          hit: synthCase(kase, params).activeSlices.length,
          href: caseUrl(kase.id, encodeParams(kase.drivers, params), symptom.id),
        };
      }),
    [all]
  );

  const kw = q.trim();
  const filtered = kw
    ? rows.filter((r) => r.symptom.text.includes(kw)
      || r.kase.name.includes(kw)
      || (r.kase.domain ?? []).some((d) => d.includes(kw)))
    : rows;

  return (
    <section data-triage className="rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3">
        <span className="text-2xs uppercase tracking-[0.14em] text-fgFaint">先说症状</span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="描述你看到的现象，或搜场景 / 领域"
          aria-label="搜索症状"
          className="min-w-[220px] flex-1 rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] text-fg placeholder:text-fgFaint focus:border-accent/50 focus:outline-none"
        />
        <span className="mono text-[11px] text-fgFaint">
          {filtered.length}/{rows.length}
        </span>
      </div>

      {/* grid-cols-1 必须显式写 —— 缺省的 auto track 按 max-content 取宽，
          移动端单列时整片症状墙会被最长那行文本撑出视口（A1 溢出） */}
      <div className="grid grid-cols-1 gap-px bg-line sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map(({ kase, symptom, hit, href }) => (
          <Link
            data-symptom={`${kase.id}/${symptom.id}`}
            data-hit={hit}
            key={`${kase.id}/${symptom.id}`}
            href={href}
            className="group bg-surface px-3.5 py-2.5 transition-colors hover:bg-white/[0.02]">
            <div className="text-[12.5px] leading-relaxed text-fg">{symptom.text}</div>
            <div className="mt-1.5 flex items-center gap-2">
              <span className="mono shrink-0 text-[10.5px]" style={{ color: '#D9A441' }}>{kase.glyph}</span>
              {/* min-w-0 与 truncate 必须成对 —— truncate 只会截自己的内容，
                  而 flex 子项默认 min-width:auto，长场景名会把整张卡撑出视口 */}
              <span className="min-w-0 truncate text-[11px] text-fgFaint">{kase.name}</span>
              {/* 点阵：亮格 = 点进去后会命中的切片 */}
              <span className="ml-auto flex shrink-0 gap-[2px]" aria-label={`命中 ${hit} 个切片`}>
                {Array.from({ length: kase.slices.length }, (_, i) => (
                  <span key={i} className="h-[4px] w-[5px] rounded-[1px]"
                    style={{ background: i < hit ? 'rgba(217,164,65,0.9)' : 'rgba(232,240,236,0.10)' }} />
                ))}
              </span>
            </div>
          </Link>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="px-4 py-8 text-center text-[12.5px] text-fgMuted">
          没有匹配的症状 —— 试试「慢」「超时」「OOM」「重复」这类现象词。
        </div>
      )}
    </section>
  );
}

/** 场景徽章：glyph + 命中条 + 参数指纹 —— 入口第二列队形，供「我知道我要什么」的人直取 */
function CaseBadge({ kase }: { kase: CaseDef }) {
  const params = defaultParams(kase);
  const hit = synthCase(kase, params).activeSlices.length;
  return (
    <Link
      data-case={kase.id}
      href={caseUrl(kase.id)}
      className="min-w-0 rounded-lg border border-line bg-surface px-3 py-2.5 transition-colors hover:bg-white/[0.02]">
      <div className="flex items-center gap-2">
        <span className="mono shrink-0 text-[13px]" style={{ color: '#D9A441' }}>{kase.glyph}</span>
        <span className="min-w-0 truncate text-[13px] font-medium text-fg">{kase.name}</span>
        <span className="mono ml-auto shrink-0 text-[10px]" title={`推荐档命中 ${hit} / ${kase.slices.length} 个切片`}>
          <span style={{ color: '#93A39C' }}>{hit}</span>
          <span className="text-fgFaint">/{kase.slices.length}</span>
        </span>
      </div>
      <div className="mt-1 truncate text-[11.5px] leading-relaxed text-fgFaint">{kase.subtitle}</div>
      <ParamFingerprint drivers={kase.drivers} params={params} />
    </Link>
  );
}

export default function L1CaseIndex() {
  return (
    <div className="animate-fade-up space-y-6">
      {/* ── Hero ─────────────────────────────────────── */}
      <header className="grid-bg relative overflow-hidden rounded-xl border border-line bg-surface">
        <div className="pointer-events-none absolute inset-0" style={{
          background:
            'radial-gradient(110% 100% at 0% 0%, rgba(217,164,65,0.10) 0%, transparent 58%), radial-gradient(80% 90% at 100% 100%, rgba(79,176,198,0.08) 0%, transparent 60%)',
        }} />
        <div className="relative px-6 py-7 md:px-9">
          <div className="mb-4">
            <StepRail current="symptom" />
          </div>
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
            <span className="text-fg">先说症状，再拿方案</span> —— 下面
            <span className="text-fg">{casesStats.symptoms} 条症状</span>是入口，
            点一条就落到对应场景，并把参数设到这个症状该在的档位上，直接给
            <span className="text-fg">建表 DDL 与生产级 Java</span>。
            每个代码切片都带命中条件：<span className="text-fg">命中的给出代码</span>，
            没命中的<span className="text-fg">必须写明为什么不适用</span> —— 不许静默省略。
            与「最佳实践案例库」的分工：那边讲
            <span className="text-fg">一个功能标准该怎么写</span>，这边讲
            <span className="text-fg">在这些约束下该怎么设计</span>。
          </p>
          <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-6">
            {[
              { k: '症状', v: casesStats.symptoms, s: '个入口' },
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

      {/* ── 症状分诊台 ───────────────────────────────── */}
      <TriageBoard />

      {/* ── 场景徽章：知道场景名的就不必再过一遍症状墙 ── */}
      <section>
        <div className="mb-2 text-2xs uppercase tracking-[0.14em] text-fgFaint">或者直接进场景</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {cases.map((c) => (
            <CaseBadge key={c.id} kase={c} />
          ))}
        </div>
      </section>
    </div>
  );
}
