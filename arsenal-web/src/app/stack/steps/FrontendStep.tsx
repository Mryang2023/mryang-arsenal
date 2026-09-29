'use client';

import StepShell from './StepShell';
import { frontendBases } from '@/lib/scaffold/env-form';
import type { StepSpec } from '../wizard';

/**
 * ⑤ 前端技术栈：选前端基底。
 *
 * 完备的基底可以点；「规划中」的灰显但**不隐藏** —— 让用户知道这条路在图纸上，
 * 只是今天选不了。选「无前端」后，⑦ 功能模块若被勾选，模块卡会提示管理页没有落点。
 */
export default function FrontendStep({
  feBase,
  onFeBase,
}: {
  feBase: string;
  onFeBase: (id: string) => void;
}) {
  return (
    <StepShell spec={STEP_SPEC}>
      <div className="grid gap-2.5 p-4 md:grid-cols-3">
        {frontendBases.map((b) => {
          const locked = !!b.uncovered;
          const on = feBase === b.id;
          return (
            <button
              key={b.id}
              type="button"
              data-fe-base={b.id}
              disabled={locked}
              aria-pressed={on}
              onClick={() => onFeBase(b.id)}
              title={locked ? `${b.name}：${b.summary}` : b.summary}
              className="rounded-lg border p-3 text-left transition-colors"
              style={{
                borderColor: on ? 'rgba(217,164,65,0.6)' : '#243029',
                background: on ? 'rgba(217,164,65,0.10)' : 'transparent',
                cursor: locked ? 'not-allowed' : 'pointer',
                opacity: locked ? 0.55 : 1,
              }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-semibold leading-tight text-fg">{b.name}</span>
                <span
                  className="mono rounded-sm px-1 text-[10px] leading-[15px]"
                  style={{
                    color: b.badge === '完备' ? '#7FA650' : b.badge === '规划中' ? '#D9A441' : '#93A39C',
                    background: 'rgba(255,255,255,0.04)',
                  }}
                >
                  {b.badge}
                </span>
              </div>
              <p className="mt-1.5 text-2xs leading-relaxed text-fgMuted">{b.summary}</p>
            </button>
          );
        })}
      </div>
      <p className="border-t border-line px-4 py-2.5 text-2xs leading-relaxed text-fgMuted">
        附带约定：TypeScript + Pinia + Axios（管理端标配，不单独占选择项）。
        开发期 <span className="mono">/api</span> 由 vite 代理转发，生产由 compose 里的 nginx 反代 —— 两边都不需要配 CORS。
      </p>
    </StepShell>
  );
}

const STEP_SPEC = {
  id: 'frontend',
  glyph: '❖',
  name: '前端技术栈',
  section: 'frontend-env',
  question: '前端要吗？要的话用什么搭？',
  feeds: '决定 frontend.zip 产不产出、长什么样。',
} as const satisfies StepSpec;
