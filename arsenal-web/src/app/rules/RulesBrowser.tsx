'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import SeverityBadge from '@/components/SeverityBadge';
import { rules as allRules, searchRules, allTags } from '@/lib/rules';
import { CATEGORY_ORDER, CATEGORY_THEME, SEVERITY_ORDER, SEVERITY_THEME, CHECK_LAYER_THEME } from '@/lib/theme';
import type { CategoryKey, Rule, Severity } from '@/lib/types';

type SortKey = 'category' | 'severity' | 'id';
type View = 'card' | 'table';

export default function RulesBrowser() {
  const [q, setQ] = useState('');
  const [sevs, setSevs] = useState<Severity[]>([]);
  const [cats, setCats] = useState<CategoryKey[]>([]);
  const [tag, setTag] = useState<string | null>(null);
  const [autoOnly, setAutoOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>('category');
  const [view, setView] = useState<View>('card');

  // 支持从概览页深链过来：/rules#security
  useEffect(() => {
    const h = decodeURIComponent(window.location.hash.replace('#', ''));
    if (h && (CATEGORY_ORDER as string[]).includes(h)) setCats([h as CategoryKey]);
  }, []);

  const list = useMemo(() => {
    let base = searchRules(q, { severities: sevs, categories: cats });
    if (autoOnly) base = base.filter((r) => Boolean(r.check?.regex?.pattern));
    if (tag) base = base.filter((r) => (r.tags ?? []).includes(tag));

    if (!q.trim()) {
      base = [...base].sort((a, b) => {
        if (sort === 'severity') {
          const d = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
          if (d !== 0) return d;
        }
        if (sort === 'category') {
          const d = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
          if (d !== 0) return d;
        }
        return a.id.localeCompare(b.id);
      });
    }
    return base;
  }, [q, sevs, cats, tag, autoOnly, sort]);

  const anyFilter = sevs.length > 0 || cats.length > 0 || autoOnly || tag !== null || q.trim() !== '';

  function reset() {
    setQ('');
    setSevs([]);
    setCats([]);
    setTag(null);
    setAutoOnly(false);
  }

  function toggle<T>(arr: T[], v: T): T[] {
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  }

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of allRules) m.set(r.category, (m.get(r.category) ?? 0) + 1);
    return m;
  }, []);

  return (
    <div className="space-y-5">
      <header>
        <div className="mono text-2xs uppercase tracking-[0.2em] text-fgFaint">registry</div>
        <h1 className="mt-1 text-[22px] font-semibold text-fg">规则库</h1>
        <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-fgMuted">
          {allRules.length} 条规范，全部可溯源到行业基准。每条都有反例与正例 —— 写不出反例的规则不予收录。
        </p>
      </header>

      {/* ── 搜索与控制条 ─────────────────────────────── */}
      <div className="panel p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fgFaint">
              ⌕
            </span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索规则、ID、关键词… 例如「@Valid」「线程池」「事务」"
              className="w-full rounded-md border border-line bg-canvas py-2 pl-9 pr-3 text-[13px] text-fg placeholder:text-fgFaint focus:border-brassDim focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-2xs text-fgFaint">排序</span>
            <Segmented
              options={[
                { key: 'category', label: '按分类' },
                { key: 'severity', label: '按级别' },
                { key: 'id', label: '按 ID' },
              ]}
              value={sort}
              onChange={(v) => setSort(v as SortKey)}
            />
          </div>

          <Segmented
            options={[
              { key: 'card', label: '卡片' },
              { key: 'table', label: '列表' },
            ]}
            value={view}
            onChange={(v) => setView(v as View)}
          />
        </div>

        {/* 级别筛选 */}
        <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3.5">
          <FilterGroup label="级别">
            {SEVERITY_ORDER.map((s) => {
              const on = sevs.includes(s);
              const t = SEVERITY_THEME[s];
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSevs((p) => toggle(p, s))}
                  className="rounded border px-2 py-0.5 text-2xs transition-colors"
                  style={{
                    color: on ? t.color : '#93A39C',
                    borderColor: on ? t.color + '66' : '#243029',
                    background: on ? t.soft : 'transparent',
                  }}
                >
                  {t.label}
                </button>
              );
            })}
          </FilterGroup>

          <FilterGroup label="仅看">
            <button
              type="button"
              onClick={() => setAutoOnly((v) => !v)}
              className="rounded border px-2 py-0.5 text-2xs transition-colors"
              style={{
                color: autoOnly ? '#56C596' : '#93A39C',
                borderColor: autoOnly ? 'rgba(86,197,150,0.4)' : '#243029',
                background: autoOnly ? 'rgba(86,197,150,0.12)' : 'transparent',
              }}
              title="只显示带正则检测层、能在校验台自动检出的规则"
            >
              可自动检出
            </button>
          </FilterGroup>
        </div>

        {/* 分类筛选 */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <FilterGroup label="分类">
            {CATEGORY_ORDER.map((c) => {
              const on = cats.includes(c);
              const t = CATEGORY_THEME[c];
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCats((p) => toggle(p, c))}
                  className="rounded border px-2 py-0.5 text-2xs transition-colors"
                  style={{
                    color: on ? t.color : '#93A39C',
                    borderColor: on ? t.color + '66' : '#243029',
                    background: on ? t.color + '1A' : 'transparent',
                  }}
                >
                  {t.glyph} {t.name}
                  <span className="mono ml-1 opacity-60">{counts.get(c)}</span>
                </button>
              );
            })}
          </FilterGroup>
        </div>

        {/* 标签 */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <FilterGroup label="标签">
            {allTags.slice(0, 12).map(([t, n]) => {
              const on = tag === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTag(on ? null : t)}
                  className="mono rounded border px-2 py-0.5 text-2xs transition-colors"
                  style={{
                    color: on ? '#D9A441' : '#93A39C',
                    borderColor: on ? 'rgba(217,164,65,0.45)' : '#243029',
                    background: on ? 'rgba(217,164,65,0.12)' : 'transparent',
                  }}
                >
                  {t}
                  <span className="ml-1 opacity-60">{n}</span>
                </button>
              );
            })}
          </FilterGroup>
        </div>

        <div className="mt-3.5 flex items-center justify-between border-t border-line pt-3">
          <span className="text-xs text-fgMuted">
            命中 <span className="mono text-fg">{list.length}</span> / {allRules.length} 条
          </span>
          {anyFilter && (
            <button
              type="button"
              onClick={reset}
              className="text-2xs text-fgFaint underline decoration-dotted underline-offset-2 transition-colors hover:text-fgMuted"
            >
              清空全部筛选
            </button>
          )}
        </div>
      </div>

      {/* ── 结果 ─────────────────────────────────────── */}
      {list.length === 0 ? (
        <div className="panel px-6 py-14 text-center">
          <div className="text-2xl text-fgFaint">∅</div>
          <p className="mt-2 text-sm text-fgMuted">没有匹配的规则。</p>
          <button
            type="button"
            onClick={reset}
            className="mt-3 text-xs text-brass underline decoration-dotted underline-offset-2"
          >
            清空筛选条件
          </button>
        </div>
      ) : view === 'card' ? (
        <div className="grid gap-2.5 lg:grid-cols-2">
          {list.map((r) => (
            <RuleCard key={r.id} rule={r} />
          ))}
        </div>
      ) : (
        <RuleTable list={list} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────── 子组件

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-0.5 text-2xs text-fgFaint">{label}</span>
      {children}
    </div>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex overflow-hidden rounded-md border border-line">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className="px-2.5 py-1 text-2xs transition-colors"
            style={{
              background: on ? '#212B28' : 'transparent',
              color: on ? '#E8F0EC' : '#93A39C',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function RuleCard({ rule: r }: { rule: Rule }) {
  const t = CATEGORY_THEME[r.category];
  const layer = CHECK_LAYER_THEME[r._checkLayer];
  return (
    <Link href={`/rules/${r.id}`} className="panel panel-hover group flex flex-col p-4">
      <div className="flex items-center gap-2">
        <SeverityBadge severity={r.severity} size="sm" />
        <span className="mono text-2xs text-fgFaint">{r.id}</span>
        <span className="ml-auto flex items-center gap-1.5 text-2xs" style={{ color: t.color }}>
          <span>{t.glyph}</span>
          <span>{t.name}</span>
        </span>
      </div>

      <h3 className="mt-2.5 text-[14px] font-medium leading-snug text-fg group-hover:text-white">
        {r.title}
      </h3>

      <p className="mt-2 flex-1 text-xs leading-relaxed text-fgMuted line-clamp-3">
        {r.promptFragment}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-line pt-2.5">
        {(r.tags ?? []).slice(0, 4).map((x) => (
          <span key={x} className="mono rounded bg-surfaceHi px-1.5 py-0.5 text-[10px] text-fgFaint">
            {x}
          </span>
        ))}
        <span
          className="mono ml-auto rounded border px-1.5 py-0.5 text-[10px]"
          style={{ color: layer.color, borderColor: layer.color + '40' }}
          title={layer.desc}
        >
          {layer.label}
        </span>
      </div>
    </Link>
  );
}

function RuleTable({ list }: { list: Rule[] }) {
  return (
    <div className="panel overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-line text-2xs uppercase tracking-wider text-fgFaint">
              <th className="px-4 py-2.5 font-medium">ID</th>
              <th className="px-3 py-2.5 font-medium">级别</th>
              <th className="px-3 py-2.5 font-medium">规则</th>
              <th className="px-3 py-2.5 font-medium">分类</th>
              <th className="px-4 py-2.5 font-medium">检测</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const t = CATEGORY_THEME[r.category];
              const layer = CHECK_LAYER_THEME[r._checkLayer];
              return (
                <tr key={r.id} className="border-b border-line/50 transition-colors last:border-0 hover:bg-surfaceHi">
                  <td className="px-4 py-2.5 align-top">
                    <Link href={`/rules/${r.id}`} className="mono text-2xs text-brass hover:underline">
                      {r.id}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <SeverityBadge severity={r.severity} size="sm" />
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <Link href={`/rules/${r.id}`} className="text-fg hover:underline">
                      {r.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 align-top text-2xs" style={{ color: t.color }}>
                    {t.glyph} {t.name}
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <span className="mono text-2xs" style={{ color: layer.color }}>
                      {layer.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
