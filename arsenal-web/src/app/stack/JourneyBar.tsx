'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import type { StackPicks } from '@/lib/content-types';
import { RUN_SECTIONS, STACK_PAGES, THEME_SECTIONS, type StackPageId } from './wizard';

/**
 * 装配旅程 —— 四页之间的横向导航。
 *
 * P0 拆四页之后，页内步骤条（StepRail）只看见**当前这一页的几步**，
 * 跨页去哪儿就没人说了。JourneyBar 补的正是这一层：四个节点常驻，
 * 当前页高亮，点一下直接换页。
 *
 * 节点与它承载的步骤**同一份出处**（wizard.STACK_PAGES），不在这里另排一张表。
 *
 * ── 已选角标（P1，2026-09-30）──
 * 每个节点挂「本页已定 X/Y」，数字从 picks 现算，与 ThemeStep 左导航、
 * 结论条点阵同源。**只有真的存在维度级选型的页才给角标** ——
 * 环境与模块页（前端基底 / 连接信息 / 模块勾选）与交付中心（产物）没有维度可数，
 * 给它们硬凑一个 x/y 就是在说假话；那两页的进度由页内 StepRail 的短标签负责
 * （「3 项缺」/「后 42 前 18」）。
 *
 * ── mobile 390 折叠（P2，2026-09-30）──
 * 窄视口下四节点收成进度点（序号圆点），当前页名单独显示在右侧，
 * 不再让四个长名字挤在一行里折行。**一套 DOM 两种表现** ——
 * 不为窄屏再复制四个链接（复制 = 8 个 data-journey，任何按节点数写的判据
 * 立刻失真），只用响应式类把「名字」与「胶囊外形」收起来。
 */
export default function JourneyBar({
  current,
  picks,
}: {
  current: StackPageId;
  picks: StackPicks;
}) {
  const here = STACK_PAGES.find((p) => p.id === current) ?? STACK_PAGES[0];
  return (
    <nav className="panel flex flex-wrap items-center gap-x-1 gap-y-1.5 px-3 py-2" aria-label="装配旅程">
      <span className="mono mr-1 text-[10px] uppercase leading-[15px] tracking-wider text-fgFaint">
        装配旅程
      </span>
      {STACK_PAGES.map((p, i) => {
        const on = p.id === current;
        const prog = pageProgress(p.id, picks);
        return (
          <Fragment key={p.id}>
            {i > 0 && (
              <span aria-hidden className="mono mx-1 text-[11px] leading-none text-fgFaint">
                ›
              </span>
            )}
            <Link
              href={p.route}
              data-journey={p.id}
              aria-current={on ? 'page' : undefined}
              // 尺寸走 class 不走内联样式：内联的 width/height 压不过 `sm:w-auto`
              // （内联优先级更高），窄屏圆点会在宽屏上僵成 26px 方块。
              className="flex h-[26px] w-[26px] items-center justify-center gap-1.5 rounded-full border text-[11px] transition-colors sm:h-auto sm:w-auto sm:justify-start sm:rounded-md sm:px-2 sm:py-1"
              style={{
                borderColor: on ? 'rgba(217,164,65,0.6)' : '#243029',
                background: on ? 'rgba(217,164,65,0.10)' : 'transparent',
                color: on ? '#D9A441' : '#93A39C',
              }}
              title={`${p.name} —— ${p.steps.length} 步：${p.steps.join(' · ')}`}
            >
              <span className="mono text-[12px] leading-none">{p.glyph}</span>
              <span className="mono text-[10px] leading-none text-fgFaint">{i + 1}</span>
              <span className="hidden font-medium leading-[16px] sm:inline">{p.name}</span>
              {prog && (
                <span
                  data-journey-progress={p.id}
                  className="mono hidden text-[10px] leading-none text-fgFaint sm:inline"
                >
                  {prog.filled}/{prog.total}
                </span>
              )}
            </Link>
          </Fragment>
        );
      })}
      {/* 窄屏：节点收成圆点后认不出自己在哪 —— 当前页名补在后面 */}
      <span className="ml-1 text-[11px] font-medium leading-[16px] text-fg sm:hidden">
        {here.name}
      </span>
    </nav>
  );
}

/**
 * 本页「已定 X/Y」—— 从 picks 现算，不写死 19 / 33 这类数字。
 * 没有维度级选型的页返回 null（调用方就不渲染角标，而不是渲染一个假的 0/0）。
 */
function pageProgress(id: StackPageId, picks: StackPicks): { filled: number; total: number } | null {
  const src = id === 'software' ? THEME_SECTIONS : id === 'run' ? RUN_SECTIONS : null;
  if (!src) return null;
  let filled = 0;
  let total = 0;
  for (const s of src) {
    for (const d of s.dims) {
      total += 1;
      if (picks[d.id]) filled += 1;
    }
  }
  return total > 0 ? { filled, total } : null;
}
