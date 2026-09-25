'use client';

import { useState } from 'react';
import type { StackPicks } from '@/lib/content-types';
import { STEP_BY_ID, THEME_SECTIONS } from '../wizard';
import DimPicker from '../DimPicker';
import StepShell from './StepShell';

/**
 * ③ 主题框架 —— 按「主题」而不是按「层」选，且**一次只展开一组**。
 *
 * 用户想的是「我的数据库是什么、缓存是什么」，不是「数据层第三个槽位是什么」。
 * 所以这一步按事实源的 `groups` 分区（数据访问 / 中间件 / 横切关注点……），
 * 每组只放**主题件**（判定规则见 wizard.ts：required/recommended 优先，
 * 整组没有时就取该组第一个装得上的维度）。
 *
 * 之前七个组 + 每组若干维度一次性铺开，还是一长屏。现在用左侧分组导航
 * 把 33 个主题件拆成几屏：点一组、定一组，进度（已定 X/Y）写在导航上，
 * 哪组还没定完不用展开就知道。剩下的可选件不在这里 —— 它们在 ④ 分层装配
 * 按层出现，一个维度只在一条路径上出现一次，不会两处打架。
 */
export default function ThemeStep({
  picks,
  onPick,
  onClear,
}: {
  picks: StackPicks;
  onPick: (dimId: string, optId: string) => void;
  onClear: (dimId: string) => void;
}) {
  const spec = STEP_BY_ID.get('theme')!;
  const [gi, setGi] = useState(0);
  const section = THEME_SECTIONS[Math.min(gi, THEME_SECTIONS.length - 1)] ?? THEME_SECTIONS[0];
  const total = THEME_SECTIONS.reduce((n, s) => n + s.dims.length, 0);
  const filled = THEME_SECTIONS.reduce((n, s) => n + s.dims.filter((d) => picks[d.id]).length, 0);

  return (
    <StepShell spec={spec}>
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,176px)_minmax(0,1fr)]">
        {/* ── 分组导航：一次只展开并定一组 ── */}
        <nav className="lg:sticky lg:top-4 lg:self-start" aria-label="主题分组">
          <p className="mono px-1 text-[10px] uppercase leading-[15px] tracking-wider text-fgFaint">
            主题分组 · 已定 {filled}/{total}
          </p>
          <ul className="mt-1.5 space-y-1">
            {THEME_SECTIONS.map((s, i) => {
              const f = s.dims.filter((d) => picks[d.id]).length;
              const on = i === gi;
              const done = f === s.dims.length && s.dims.length > 0;
              return (
                <li key={s.group.id}>
                  <button
                    type="button"
                    data-theme-nav={s.group.id}
                    aria-current={on ? 'true' : undefined}
                    onClick={() => setGi(i)}
                    className="flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors"
                    style={{
                      borderColor: on ? 'rgba(217,164,65,0.6)' : '#243029',
                      background: on ? 'rgba(217,164,65,0.10)' : 'transparent',
                    }}
                  >
                    <span className="mono text-[13px] leading-none" style={{ color: on ? '#D9A441' : '#93A39C' }}>
                      {s.group.glyph}
                    </span>
                    <span
                      className="min-w-0 flex-1 truncate text-[11px] font-medium leading-[16px]"
                      style={{ color: on ? '#E8F0EC' : '#93A39C' }}
                    >
                      {s.group.name}
                    </span>
                    <span className="mono shrink-0 text-[10px] leading-[15px] text-fgFaint">
                      {f}/{s.dims.length}
                    </span>
                    {done && (
                      <span className="mono shrink-0 text-[10px] leading-none" style={{ color: '#7FA650' }}>
                        ✓
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex items-center gap-1.5 px-1">
            <button
              type="button"
              onClick={() => setGi((v) => Math.max(0, v - 1))}
              disabled={gi === 0}
              className="rounded-md border border-line px-2 py-1 text-[10px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
            >
              ← 上一组
            </button>
            <button
              type="button"
              onClick={() => setGi((v) => Math.min(THEME_SECTIONS.length - 1, v + 1))}
              disabled={gi >= THEME_SECTIONS.length - 1}
              className="rounded-md border border-line px-2 py-1 text-[10px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
            >
              下一组 →
            </button>
          </div>
        </nav>

        {/* ── 当前组：只渲染选中的那一组 ── */}
        <section data-theme-group={section.group.id} className="panel overflow-hidden">
          <header className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b border-line px-4 py-3">
            <span className="mono text-[13px] leading-none text-brass">{section.group.glyph}</span>
            <h3 className="text-[13px] font-semibold leading-[18px] text-fg">{section.group.name}</h3>
            <span className="mono text-[10px] leading-[15px] text-fgFaint">
              第 {gi + 1}/{THEME_SECTIONS.length} 组 · 已定 {section.dims.filter((d) => picks[d.id]).length}/
              {section.dims.length}
            </span>
          </header>
          <p className="border-b border-line px-4 py-2 text-[10px] leading-[15px] text-fgMuted">
            {section.group.desc}
          </p>
          <div className="divide-y divide-line">
            {section.dims.map((d) => (
              <DimPicker key={d.id} dim={d} picks={picks} onPick={onPick} onClear={onClear} />
            ))}
          </div>
        </section>
      </div>
    </StepShell>
  );
}
