'use client';

import type { ReactNode } from 'react';
import type { StepSpec } from '../wizard';

/**
 * 每一步的统一外壳：顶部写清「这一步回答什么问题」和「这个答案喂给谁」。
 *
 * 两句都不是装饰 —— 装配台原来最要命的就是没说清**现在该干什么**：
 * 33 个槽位一起出现，用户只好随便点。每步只问一个问题，并且把上下游
 * 关系写在脸上，用户才知道「我现在选的缓存会决定后面哪一步」。
 */
export default function StepShell({ spec, children }: { spec: StepSpec; children: ReactNode }) {
  return (
    <section className="panel overflow-hidden">
      <header className="border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="mono text-[13px] leading-none text-brass">{spec.glyph}</span>
          <h2 className="text-[13px] font-semibold leading-[18px] text-fg">{spec.question}</h2>
        </div>
        <p className="mt-1 text-[10px] leading-[15px] text-fgMuted">{spec.feeds}</p>
      </header>
      {children}
    </section>
  );
}
