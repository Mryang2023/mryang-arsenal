'use client';

import { useState } from 'react';
import type { StackPicks } from '@/lib/content-types';
import { dimensions } from '@/lib/stack';
import { STEP_BY_ID, THEME_SECTIONS } from '../wizard';
import DimPicker, { type DimFlag } from '../DimPicker';
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
  dimFlags,
  onPick,
  onClear,
}: {
  picks: StackPicks;
  /** 问题槽位标记（dimId → 红/绿 + 一句话）。出处见 StackComposer 的 issueDots */
  dimFlags?: Record<string, DimFlag>;
  onPick: (dimId: string, optId: string) => void;
  onClear: (dimId: string) => void;
}) {
  const spec = STEP_BY_ID.get('theme')!;
  const [gi, setGi] = useState(0);
  const section = THEME_SECTIONS[Math.min(gi, THEME_SECTIONS.length - 1)] ?? THEME_SECTIONS[0];
  const total = THEME_SECTIONS.reduce((n, s) => n + s.dims.length, 0);
  const filled = THEME_SECTIONS.reduce((n, s) => n + s.dims.filter((d) => picks[d.id]).length, 0);
  // 有问题的组要提前暴露 —— 导航上一眼看到哪组红。按**事实源组**统计该组
  // 全部维度（不只 ③ 的主题件）：问题常出在配在 ④ 的维度（如编排要「容器
  // 运行环境」），只数主题件会漏 —— 那正是「卡红了导航却不知道哪组」的根因。
  const groupIssueDims = (groupId: string) =>
    dimensions
      .filter((d) => d.groupId === groupId && dimFlags?.[d.id]?.kind === 'need')
      .map((d) => `${d.name}：${dimFlags![d.id].label}`);
  const groupIssueCount = (groupId: string) => groupIssueDims(groupId).length;
  // 展开组的「非主题件问题槽位」：组内全部维度 - 主题件，只留有标记的 ——
  // 正常（无问题）时为空，不渲染，不破坏「一个维度只在一条路径出现一次」
  const offThemeIssues = dimensions.filter(
    (d) =>
      d.groupId === section.group.id &&
      dimFlags?.[d.id] &&
      !section.dims.some((t) => t.id === d.id)
  );

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
              const issues = groupIssueCount(s.group.id);
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
                    {issues > 0 && (
                      <span
                        className="mono shrink-0 rounded-sm px-1 text-[10px] leading-[15px]"
                        style={{ color: '#E5484D', background: 'rgba(229,72,77,0.14)' }}
                        title={`这一组有 ${issues} 个槽位卷进「跑不起来」：${groupIssueDims(s.group.id).join('；')}`}
                      >
                        {issues}
                      </span>
                    )}
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
              <DimPicker
                key={d.id}
                dim={d}
                picks={picks}
                flag={dimFlags?.[d.id]}
                onPick={onPick}
                onClear={onClear}
              />
            ))}
          </div>
          {/* 本组里没进主题件清单、但正卷进问题的槽位（配在 ④ 分层装配）。
              只在出问题时才出现：红卡当场可见可修，不用让人拿着一个红标记
              跳去 ④ 翻找 —— 导航角标、组内卡片、问题现场三点连成一线。 */}
          {offThemeIssues.length > 0 && (
            <div className="border-t border-line bg-canvas px-4 py-3">
              <p className="mono mb-2 text-[10px] uppercase tracking-wider text-fgFaint">
                本组其他槽位（配在 ④ 分层装配）· 也卷进了问题
              </p>
              <div className="divide-y divide-line rounded-md border border-line bg-surface">
                {offThemeIssues.map((d) => (
                  <DimPicker
                    key={d.id}
                    dim={d}
                    picks={picks}
                    flag={dimFlags?.[d.id]}
                    onPick={onPick}
                    onClear={onClear}
                  />
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </StepShell>
  );
}
