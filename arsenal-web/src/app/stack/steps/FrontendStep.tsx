'use client';

import StepShell from './StepShell';
import { frontendBases, frontendTemplatesOf } from '@/lib/scaffold/env-form';
import type { StepSpec } from '../wizard';
import { TONE, INK, toneAt, gloss } from '../palette';

/**
 * ⑤ 前端技术栈：先选前端基底，再选该基底下的 UI 模板。
 *
 * 完备的基底可以点；「规划中」的灰显但**不隐藏** —— 让用户知道这条路在图纸上，
 * 只是今天选不了。选「无前端」后，⑦ 功能模块若被勾选，模块卡会提示管理页没有落点。
 *
 * UI 模板（2026-10-03）：同一基底可以有多套界面方案（arsenal-scaffold/frontend/
 * <base>/<template>/），清单来自事实源 frontend.templates；只有声明了 templates
 * 的基底才出这一节，选「无前端」/规划中基底时整节隐藏。
 */
export default function FrontendStep({
  feBase,
  feUi,
  onFeBase,
  onFeUi,
}: {
  feBase: string;
  feUi: string;
  onFeBase: (id: string) => void;
  onFeUi: (id: string) => void;
}) {
  const templates = frontendTemplatesOf(feBase);
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
                borderColor: on ? toneAt('warn', 0.6) : INK.line,
                background: on ? toneAt('warn', 0.10) : 'transparent',
                cursor: locked ? 'not-allowed' : 'pointer',
                opacity: locked ? 0.55 : 1,
              }}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-semibold leading-tight text-fg">{b.name}</span>
                <span
                  className="mono rounded-sm px-1 text-[10px] leading-[15px]"
                  style={{
                    color: b.badge === '完备' ? TONE.ok.color : b.badge === '规划中' ? TONE.warn.color : INK.muted,
                    background: gloss(0.04),
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

      {templates.length > 0 && (
        <div className="border-t border-line px-4 py-3">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            UI 模板 · 决定 frontend 包里的界面长什么样
          </p>
          <div className="mt-2 grid gap-2.5 md:grid-cols-3">
            {templates.map((t) => {
              const on = feUi === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  data-fe-ui={t.id}
                  aria-pressed={on}
                  onClick={() => onFeUi(t.id)}
                  title={t.summary}
                  className="rounded-lg border p-3 text-left transition-colors"
                  style={{
                    borderColor: on ? toneAt('warn', 0.6) : INK.line,
                    background: on ? toneAt('warn', 0.10) : 'transparent',
                    cursor: 'pointer',
                  }}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-semibold leading-tight text-fg">{t.name}</span>
                    {t.default && (
                      <span
                        className="mono rounded-sm px-1 text-[10px] leading-[15px]"
                        style={{ color: TONE.ok.color, background: gloss(0.04) }}
                      >
                        默认
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-2xs leading-relaxed text-fgMuted">{t.summary}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <p className="border-t border-line px-4 py-2.5 text-2xs leading-relaxed text-fgMuted">
        附带约定：TypeScript + Pinia + Axios（管理端标配，不单独占选择项）。
        开发期 <span className="mono">/api</span> 由 vite 代理转发，生产由 compose 里的 nginx 反代 —— 两边都不需要配 CORS。
      </p>
    </StepShell>
  );
}

const STEP_SPEC = {
  id: 'frontend',
  route: '/stack/step/frontend',
  glyph: '❖',
  name: '前端技术栈',
  section: 'frontend-env',
  question: '前端要吗？要的话用什么搭、界面用哪套模板？',
  feeds: '决定 frontend.zip 产不产出、长什么样。',
} as const satisfies StepSpec;
