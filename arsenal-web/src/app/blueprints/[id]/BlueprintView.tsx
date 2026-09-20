'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import CodeWithNotes from '@/components/CodeWithNotes';
import { getRule } from '@/lib/rules';
import { layerTheme } from '@/lib/theme';
import { SEVERITY_THEME } from '@/lib/theme';
import type { Feature } from '@/lib/content-types';

export default function BlueprintView({ feature }: { feature: Feature }) {
  const [activeId, setActiveId] = useState(feature.files[0]?.id ?? '');
  const active = feature.files.find((f) => f.id === activeId) ?? feature.files[0];

  const layerGroups = useMemo(() => {
    const order: string[] = [];
    const m = new Map<string, typeof feature.files>();
    for (const file of feature.files) {
      if (!m.has(file.layer)) {
        m.set(file.layer, []);
        order.push(file.layer);
      }
      m.get(file.layer)!.push(file);
    }
    return order.map((layer) => ({ layer, files: m.get(layer)! }));
  }, [feature]);

  return (
    <div className="animate-fade-up space-y-7">
      {/* ── 面包屑 ───────────────────────────────────── */}
      <div className="mono flex items-center gap-2 text-2xs text-fgFaint">
        <Link href="/blueprints" className="transition-colors hover:text-brass">
          最佳实践案例库
        </Link>
        <span className="text-lineHi">/</span>
        <span className="text-fgMuted">{feature.id}</span>
      </div>

      {/* ── 头部 ─────────────────────────────────────── */}
      <header className="grid-bg relative overflow-hidden rounded-xl border border-line bg-surface">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(110% 100% at 0% 0%, rgba(79,176,198,0.10) 0%, transparent 58%)',
          }}
        />
        <div className="relative px-6 py-7 md:px-8">
          <div className="flex items-start gap-4">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border text-xl"
              style={{
                borderColor: 'rgba(79,176,198,0.32)',
                background: 'rgba(79,176,198,0.07)',
                color: '#4FB0C6',
              }}
            >
              {feature.glyph}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[24px] font-semibold leading-tight tracking-tight text-fg">
                  {feature.name}
                </h1>
                <span
                  className="rounded px-1.5 py-0.5 text-2xs"
                  style={{ background: 'rgba(217,164,65,0.13)', color: '#D9A441' }}
                >
                  {feature.level}
                </span>
              </div>
              <p className="mt-2 max-w-3xl text-[14px] leading-relaxed text-fgMuted">
                {feature.subtitle}
              </p>
              <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-fgFaint">
                {feature.scenario}
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-1.5">
            {feature.tags.map((t) => (
              <span
                key={t}
                className="rounded border border-line bg-surfaceHi px-2 py-0.5 text-2xs text-fgMuted"
              >
                {t}
              </span>
            ))}
          </div>

          <div className="mono mt-5 flex flex-wrap gap-x-5 gap-y-1.5 text-2xs text-fgFaint">
            <span>
              <span className="text-fgMuted">{feature.fileCount}</span> 个文件
            </span>
            <span>
              <span className="text-fgMuted">{feature.lines}</span> 行代码
            </span>
            <span>
              <span className="text-fgMuted">{feature.highlightCount}</span> 条要点备注
            </span>
            <span>
              关联 <span className="text-fgMuted">{feature.ruleCount}</span> 条规则
            </span>
          </div>
        </div>
      </header>

      {/* ── 数据流 ───────────────────────────────────── */}
      <section className="panel p-5">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-[14px] font-semibold text-fg">请求流过哪几层</h2>
          <span className="text-2xs text-fgFaint">每一层只做它该做的事，越界就是分层失效</span>
        </div>
        <ol className="space-y-0">
          {feature.flow.map((s, i) => {
            const lt = layerTheme(s.layer);
            const last = i === feature.flow.length - 1;
            return (
              <li key={i} className="flex gap-3">
                <div className="flex w-6 shrink-0 flex-col items-center">
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-full border text-[11px]"
                    style={{
                      borderColor: lt.color + '4D',
                      background: lt.color + '14',
                      color: lt.color,
                    }}
                  >
                    {i + 1}
                  </span>
                  {!last && (
                    <span
                      className="w-px flex-1"
                      style={{ background: 'linear-gradient(#243029, #243029)' }}
                    />
                  )}
                </div>
                <div className={`min-w-0 flex-1 ${last ? '' : 'pb-4'}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-fg">{s.step}</span>
                    <span
                      className="rounded px-1.5 py-0.5 text-2xs"
                      style={{ color: lt.color, background: lt.color + '14' }}
                    >
                      {lt.label}
                    </span>
                  </div>
                  <p className="mt-1 text-2xs leading-relaxed text-fgMuted">{s.detail}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* ── 不适用边界 ───────────────────────────────── */}
      {/* 案例只有划清边界才敢被当成蓝本复制 —— 只讲优点的范例会被照抄到错误场景。 */}
      <section
        className="rounded-lg border px-5 py-4"
        style={{ borderColor: 'rgba(229,115,75,0.28)', background: 'rgba(229,115,75,0.05)' }}
      >
        <div className="mb-3 flex flex-wrap items-baseline gap-2">
          <span className="mono text-[13px]" style={{ color: '#E5734B' }}>
            ⊘
          </span>
          <h2 className="text-[14px] font-semibold text-fg">什么时候不要用这套写法</h2>
          <span className="text-2xs text-fgFaint">
            先确认你的场景不在这里面，再动手抄
          </span>
        </div>
        <ul className="grid gap-2.5 md:grid-cols-2">
          {feature.notSuitable.map((n, i) => (
            <li key={i} className="flex gap-2.5">
              <span
                className="mt-[6px] h-[5px] w-[5px] shrink-0 rounded-full"
                style={{ background: '#E5734B' }}
              />
              <span className="text-2xs leading-relaxed text-fgMuted">{n}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* ── HTTP 语义矩阵（仅部分案例有） ────────────── */}
      {feature.matrix && (
        <section className="panel overflow-hidden">
          <div className="border-b border-line px-5 py-4">
            <h2 className="text-[14px] font-semibold text-fg">{feature.matrix.title}</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-2xs">
              <thead>
                <tr className="border-b border-line bg-surfaceHi">
                  {feature.matrix.columns.map((c) => (
                    <th
                      key={c}
                      className="whitespace-nowrap px-3 py-2 text-left font-medium text-fgMuted"
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {feature.matrix.rows.map((row, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    {row.map((cell, j) => (
                      <td
                        key={j}
                        className={`px-3 py-2 align-top ${
                          j === 0
                            ? 'mono font-semibold'
                            : j === 2 || j === 3
                            ? 'mono'
                            : ''
                        }`}
                        style={
                          j === 0
                            ? { color: '#4FB0C6' }
                            : cell === '是'
                            ? { color: '#56C596' }
                            : cell === '否'
                            ? { color: '#E5734B' }
                            : { color: '#93A39C' }
                        }
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line px-5 py-3">
            <ul className="space-y-1">
              {feature.matrix.notes.map((n, i) => (
                <li key={i} className="flex gap-2 text-2xs leading-relaxed text-fgFaint">
                  <span className="text-lineHi">·</span>
                  <span>{n}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* ── 文件导航 ─────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[14px] font-semibold text-fg">完整代码</h2>
          <span className="text-2xs text-fgFaint">
            点击文件名切换 · 行号旁的编号角标是备注，悬停可看解读
          </span>
        </div>

        <div className="space-y-2">
          {layerGroups.map(({ layer, files }) => {
            const lt = layerTheme(layer);
            return (
              <div key={layer} className="flex flex-wrap items-center gap-2">
                <span
                  className="mono w-[86px] shrink-0 text-2xs"
                  style={{ color: lt.color }}
                >
                  {lt.glyph} {lt.label}
                </span>
                {files.map((file) => {
                  const on = file.id === activeId;
                  return (
                    <button
                      key={file.id}
                      type="button"
                      onClick={() => setActiveId(file.id)}
                      className="mono max-w-full truncate rounded border px-2 py-1 text-2xs transition-colors"
                      style={{
                        borderColor: on ? 'rgba(217,164,65,0.5)' : '#243029',
                        background: on ? 'rgba(217,164,65,0.09)' : '#131917',
                        color: on ? '#E8F0EC' : '#93A39C',
                      }}
                    >
                      {file.path.split('/').pop()}
                      {file.highlights.length > 0 && (
                        <span className="ml-1.5 text-[10px]" style={{ color: '#D9A441' }}>
                          {file.highlights.length}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {active && (
          <div className="pt-1">
            <CodeWithNotes
              code={active.code}
              lang={active.lang}
              layer={active.layer}
              path={active.path}
              role={active.role}
              notes={active.highlights}
            />
          </div>
        )}
      </section>

      {/* ── 包结构 ───────────────────────────────────── */}
      <section className="panel p-5">
        <h2 className="text-[14px] font-semibold text-fg">这些代码该放在哪</h2>
        <div className="mt-3 space-y-1.5">
          {feature.packages.map((p) => {
            const [pkg, ...rest] = p.split(/\s{2,}/);
            return (
              <div key={p} className="flex flex-col gap-0.5 md:flex-row md:items-baseline md:gap-3">
                <code className="mono shrink-0 text-[12px]" style={{ color: '#7FC8DC' }}>
                  {pkg}
                </code>
                {rest.length > 0 && (
                  <span className="text-2xs leading-relaxed text-fgMuted">{rest.join(' ')}</span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── 验收清单 + 常见坑 ────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="panel p-5">
          <div className="mb-3 flex items-center gap-2">
            <span className="mono text-[13px]" style={{ color: '#56C596' }}>
              ✓
            </span>
            <h2 className="text-[14px] font-semibold text-fg">提交前验收清单</h2>
          </div>
          <ul className="space-y-2">
            {feature.checklist.map((c, i) => (
              <li key={i} className="flex gap-2.5">
                <span
                  className="mono mt-[2px] flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded border text-[9px]"
                  style={{ borderColor: 'rgba(86,197,150,0.4)', color: '#56C596' }}
                >
                  {i + 1}
                </span>
                <span className="text-2xs leading-relaxed text-fgMuted">{c}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel p-5">
          <div className="mb-3 flex items-center gap-2">
            <span className="mono text-[13px]" style={{ color: '#E5734B' }}>
              ⚠
            </span>
            <h2 className="text-[14px] font-semibold text-fg">这套写法最容易踩的坑</h2>
          </div>
          <ul className="space-y-2">
            {feature.pitfalls.map((p, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="mt-[6px] h-[5px] w-[5px] shrink-0 rounded-full" style={{ background: '#E5734B' }} />
                <span className="text-2xs leading-relaxed text-fgMuted">{p}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* ── 性能 / 量级对照（非必填） ─────────────────── */}
      {feature.performance && (
        <section className="panel overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3.5">
            <div className="flex items-center gap-2">
              <span className="mono text-[13px]" style={{ color: '#4FB0C6' }}>
                ◱
              </span>
              <h2 className="text-[14px] font-semibold text-fg">{feature.performance.title}</h2>
            </div>
            <span className="text-2xs text-fgFaint">量级与机制，不是某台机器的实测数字</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-line text-2xs uppercase tracking-wider text-fgFaint">
                  {feature.performance.columns.map((c, i) => (
                    <th key={i} className="whitespace-nowrap px-5 py-2.5 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {feature.performance.rows.map((row, ri) => (
                  <tr key={ri} className="border-b border-line/60 last:border-0">
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className={
                          ci === 0
                            ? 'px-5 py-2.5 text-fg'
                            : 'px-5 py-2.5 leading-relaxed text-fgMuted'
                        }
                      >
                        {ci === 0 ? <span className="mono text-[12px]">{cell}</span> : cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line bg-surfaceHi px-5 py-3 text-2xs leading-relaxed text-fgMuted">
            {feature.performance.conclusion}
          </p>
        </section>
      )}

      {/* ── 关联规则 ─────────────────────────────────── */}
      <section className="panel p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[14px] font-semibold text-fg">这份案例覆盖的规则</h2>
          <Link href="/rules" className="mono text-2xs text-fgFaint transition-colors hover:text-brass">
            去规则库 →
          </Link>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {feature.relatedRules.map((rid) => {
            const rule = getRule(rid);
            const sev = rule ? SEVERITY_THEME[rule.severity] : null;
            return (
              <Link
                key={rid}
                href={`/rules/${rid}`}
                title={rule?.title ?? rid}
                className="mono flex items-center gap-1.5 rounded border px-2 py-1 text-2xs transition-colors hover:opacity-80"
                style={{
                  borderColor: sev ? sev.color + '3D' : '#243029',
                  background: sev ? sev.soft : '#131917',
                  color: sev ? sev.color : '#93A39C',
                }}
              >
                <span>{rid}</span>
                {sev && <span className="text-[10px] opacity-70">{sev.label}</span>}
              </Link>
            );
          })}
        </div>
      </section>

      {/* ── 参考出处 ─────────────────────────────────── */}
      {/* 与规则集同一立场：无出处不收录。已核对的给链接，内部资料给说明。 */}
      <section className="panel p-5">
        <div className="mb-3 flex items-center gap-2">
          <span className="mono text-[13px]" style={{ color: '#7FC8DC' }}>
            ↧
          </span>
          <h2 className="text-[14px] font-semibold text-fg">参考出处</h2>
        </div>
        <ul className="space-y-2.5">
          {feature.references.map((r, i) => (
            <li key={i} className="flex flex-col gap-0.5 md:flex-row md:items-baseline md:gap-3">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="mono text-2xs text-fgFaint">{String(i + 1).padStart(2, '0')}</span>
                {r.url ? (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[13px] text-fg transition-colors hover:text-brass"
                  >
                    {r.title}
                    <span className="mono ml-1 text-2xs text-fgFaint">↗</span>
                  </a>
                ) : (
                  <span className="text-[13px] text-fg">{r.title}</span>
                )}
              </span>
              {r.note && (
                <span className="pl-6 text-2xs leading-relaxed text-fgFaint md:pl-0">
                  {r.note}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
