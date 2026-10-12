'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { CaseDef } from '@/lib/case-types';
import { allSymptoms, cases, casesMeta, casesStats, defaultParams, symptomParams } from '@/lib/case-cases';
import { synthCase } from '@/lib/case-synth';
import { caseUrl, encodeParams } from './_lib/params-codec';
import StepRail from './_lib/step-rail';

/**
 * L1 —— 场景案例库的**目录页**。
 *
 * 之前的问题：32 条症状 + 9 个场景平铺成一堵墙，没有归类、没有导航，
 * 用户进来看不出「这是一组一组的」。现在按「核心工程挑战」把 9 个场景归成 3 组，
 * 左边 sticky 目录跳锚点，右边分组陈列；症状检索改成「先输入再出结果」，
 * 默认不再铺满 32 张卡。
 *
 * ⚠️ 分组只在这里维护一处 `CASE_GROUPS`；新场景只要进了 `cases`，
 * 没被任何组覆盖会自动掉进「其它场景」，绝不会从目录里消失。
 */

/** 主题分组（按核心工程挑战，不重叠）。members 填 case.id。 */
const CASE_GROUPS: { id: string; name: string; blurb: string; members: string[] }[] = [
  {
    id: 'scale',
    name: '海量数据与存储',
    blurb: '行数 / 文件量破亿，索引与常规手段失效，得换存储与写入模型',
    members: ['huge-rowcount-rdb', 'genomic-sequence-store', 'high-throughput-io', 'multi-source-ingestion'],
  },
  {
    id: 'access',
    name: '查询 · 缓存 · 检索',
    blurb: '读多写少、要快、要扛热点——宽表怎么查、缓存怎么不炸',
    members: ['wide-table-search', 'hotspot-cache'],
  },
  {
    id: 'reliable',
    name: '并发 · 异步 · 可靠性',
    blurb: '高并发 IO、消息解耦、不丢不重不乱序',
    members: ['async-pipeline', 'virtual-thread', 'idempotent-write'],
  },
];

function buildGroups(): { id: string; name: string; blurb: string; cases: CaseDef[] }[] {
  const placed = new Set<string>(CASE_GROUPS.flatMap((g) => g.members));
  const groups = CASE_GROUPS.map((g) => ({
    id: g.id,
    name: g.name,
    blurb: g.blurb,
    cases: g.members
      .map((id) => cases.find((c) => c.id === id))
      .filter((c): c is CaseDef => Boolean(c)),
  }));
  const rest = cases.filter((c) => !placed.has(c.id));
  if (rest.length) {
    groups.push({ id: 'other', name: '其它场景', blurb: '尚未归入上述分组的场景', cases: rest });
  }
  return groups;
}

/** 目录卡：glyph + 名 + 副标题 + 一句话问题 + 领域标签 + 关键量 + 入口，全部本地算，不传整个 cases */
function DirectoryCard({ kase }: { kase: CaseDef }) {
  const params = defaultParams(kase);
  const hit = synthCase(kase, params).activeSlices.length;
  return (
    <Link
      href={caseUrl(kase.id)}
      data-case={kase.id}
      className="group relative flex flex-col rounded-xl border border-line bg-surface p-4 transition-colors hover:border-lineHi hover:bg-surfaceHi">
      <div className="flex items-start gap-3">
        <span className="mono shrink-0 text-[17px] leading-none" style={{ color: '#D9A441' }}>
          {kase.glyph}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold leading-tight text-fg">{kase.name}</div>
          <div className="mt-0.5 truncate text-[12px] text-fgFaint">{kase.subtitle}</div>
        </div>
        <span className="mono shrink-0 text-[11px]" title={`推荐档命中 ${hit} / ${kase.slices.length} 个切片`}>
          <span style={{ color: '#D9A441' }}>{hit}</span>
          <span className="text-fgFaint">/{kase.slices.length}</span>
        </span>
      </div>

      <p className="mt-2 line-clamp-2 text-[12.5px] leading-relaxed text-fgMuted">{kase.problem}</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {kase.domain.map((d) => (
          <span key={d} className="rounded border border-line px-1.5 py-0.5 text-[10.5px] text-fgFaint">
            {d}
          </span>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5">
        <div className="flex gap-3 text-[11px] text-fgMuted">
          <span>{kase.drivers.length} 参数</span>
          <span>{kase.slices.length} 切片</span>
          <span>{kase.lines} 行</span>
        </div>
        <span className="mono text-[11px] text-fgFaint transition-colors group-hover:text-brass">进入 →</span>
      </div>
    </Link>
  );
}

/** 左侧 sticky 目录栏 */
function TocRail({ groups }: { groups: { id: string; name: string; cases: CaseDef[] }[] }) {
  return (
    <nav className="space-y-0.5 text-[12.5px]" aria-label="场景目录">
      <div className="px-2 pb-1.5 text-2xs uppercase tracking-[0.14em] text-fgFaint">目录</div>
      {groups.map((g) => (
        <a
          key={g.id}
          href={`#grp-${g.id}`}
          className="block rounded px-2 py-1.5 text-fgMuted transition-colors hover:bg-surface hover:text-fg">
          <span className="mr-2 mono text-fgFaint">{g.cases.length}</span>
          {g.name}
        </a>
      ))}
      <a
        href="#symptoms"
        className="block rounded px-2 py-1.5 text-fgMuted transition-colors hover:bg-surface hover:text-fg">
        按症状找
      </a>
    </nav>
  );
}

/** 症状检索：先输入再出结果，默认不铺墙 */
function SymptomFinder() {
  const [q, setQ] = useState('');
  const all = useMemo(() => allSymptoms(), []);
  const kw = q.trim();

  const grouped = useMemo(() => {
    if (!kw) return [];
    const hits = all.filter(
      ({ kase, symptom }) =>
        symptom.text.includes(kw) ||
        kase.name.includes(kw) ||
        (kase.domain ?? []).some((d) => d.includes(kw))
    );
    const m = new Map<string, { kase: CaseDef; items: { text: string; hit: number; href: string }[] }>();
    for (const { kase, symptom } of hits) {
      const params = symptomParams(kase, symptom);
      const hit = synthCase(kase, params).activeSlices.length;
      const href = caseUrl(kase.id, encodeParams(kase.drivers, params), symptom.id);
      if (!m.has(kase.id)) m.set(kase.id, { kase, items: [] });
      m.get(kase.id)!.items.push({ text: symptom.text, hit, href });
    }
    return [...m.values()];
  }, [all, kw]);

  return (
    <section id="symptoms" className="scroll-mt-4">
      <div className="mb-2 flex items-baseline gap-3 border-b border-line pb-2">
        <h2 className="text-[17px] font-semibold text-fg">按症状找</h2>
        <span className="text-[12.5px] text-fgMuted">说不清属于哪一类？描述你看到的现象</span>
      </div>

      <div className="rounded-xl border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3">
          <span className="text-2xs uppercase tracking-[0.14em] text-fgFaint">描述现象</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="比如：慢、超时、OOM、重复、雪崩、翻页越往后越慢"
            aria-label="搜索症状"
            className="min-w-[240px] flex-1 rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[12.5px] text-fg placeholder:text-fgFaint focus:border-brass/50 focus:outline-hidden"
          />
          <span className="mono text-[11px] text-fgFaint">
            {kw ? `${grouped.reduce((n, g) => n + g.items.length, 0)} 条命中` : '输入后检索'}
          </span>
        </div>

        {!kw ? (
          <div className="px-4 py-6 text-[12.5px] leading-relaxed text-fgMuted">
            直接从左上目录挑一类场景进入；或者在这里输入你正遇到的现象，
            下面会按场景分组列出相关症状，点一条就直达该场景并把参数设到对应档位。
          </div>
        ) : grouped.length === 0 ? (
          <div className="px-4 py-6 text-[12.5px] text-fgMuted">
            没有匹配的症状 —— 试试「慢」「超时」「OOM」「重复」这类现象词，或从左上目录直接进场景。
          </div>
        ) : (
          <div className="space-y-3 p-3">
            {grouped.map(({ kase, items }) => (
              <div key={kase.id}>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="mono text-[12px]" style={{ color: '#D9A441' }}>{kase.glyph}</span>
                  <span className="text-[12.5px] font-medium text-fg">{kase.name}</span>
                </div>
                <div className="grid grid-cols-1 gap-px bg-line sm:grid-cols-2 xl:grid-cols-3">
                  {items.map((it) => (
                    <Link
                      key={it.href}
                      href={it.href}
                      className="group flex items-center gap-2 bg-surface px-3 py-2.5 transition-colors hover:bg-surfaceHi">
                      <span className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-fg">
                        {it.text}
                      </span>
                      <span className="mono shrink-0 text-[10px]" title={`命中 ${it.hit} 个切片`}>
                        <span style={{ color: '#D9A441' }}>{it.hit}</span>
                        <span className="text-fgFaint">/{(kase.slices ?? []).length}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default function L1CaseIndex() {
  const groups = useMemo(buildGroups, []);

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
            <span className="text-fg">先说症状，再拿方案</span> ——{' '}
            {casesStats.cases} 个真实场景、{casesStats.slices} 个条件切片，按下面的目录挑一类进入；
            每个切片都带命中条件：<span className="text-fg">命中的给出代码</span>，
            没命中的<span className="text-fg">必须写明为什么不适用</span>。
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

      {/* ── 目录 + 分组陈列 ───────────────────────────── */}
      <div className="lg:grid lg:grid-cols-[224px_minmax(0,1fr)] lg:gap-6">
        <aside className="hidden lg:block">
          <div className="lg:sticky lg:top-4">
            <div className="rounded-xl border border-line bg-surface p-3 shadow-panel">
              <TocRail groups={groups} />
            </div>
          </div>
        </aside>

        <div className="min-w-0 space-y-8">
          {groups.map((g) => (
            <section key={g.id} id={`grp-${g.id}`} className="scroll-mt-4">
              <div className="mb-3 flex items-baseline gap-3 border-b border-line pb-2">
                <span className="mono text-[11px] text-fgFaint">{g.cases.length}</span>
                <h2 className="text-[17px] font-semibold text-fg">{g.name}</h2>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-fgMuted">{g.blurb}</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {g.cases.map((c) => (
                  <DirectoryCard key={c.id} kase={c} />
                ))}
              </div>
            </section>
          ))}

          <SymptomFinder />
        </div>
      </div>
    </div>
  );
}
