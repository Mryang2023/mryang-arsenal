'use client';

import { STEPS, stepIndex, type StepId } from './wizard';

/**
 * 步骤条 + 上一步 / 下一步。
 *
 * 六步**全部可点**：装配不是一次性问卷 —— 改了 ① 的形态想回头看 ③ 缓存变成
 * 什么，必须能直接跳回去。步骤条上每一格都带一个进度短标签（如「12/15」），
 * 所以「哪一步还没定完」不用点进去才知道。
 *
 * 「下一步」永远是主按钮，「上一步」永远在左边 —— 不因为到了最后一步就把
 * 位置换掉，肌肉记忆比对称美观值钱。
 */
export default function StepRail({
  step,
  onStep,
  summary,
  canAdvance,
  blockedHint,
}: {
  step: StepId;
  onStep: (id: StepId) => void;
  /** 每格的进度短标签；空串表示这一步没有可数的进度 */
  summary: Record<StepId, string>;
  /** 为 false 时「下一步」禁用，并在下方写明为什么 —— 静默禁用等于按钮坏了 */
  canAdvance: boolean;
  blockedHint?: string;
}) {
  const idx = stepIndex(step);
  const prev = STEPS[idx - 1];
  const next = STEPS[idx + 1];

  return (
    <nav className="panel overflow-hidden" aria-label="装配步骤">
      <ol className="flex flex-wrap items-stretch gap-x-1 gap-y-1.5 px-3 py-2.5">
        {STEPS.map((s, i) => {
          const on = s.id === step;
          return (
            <li key={s.id} className="flex items-center">
              {i > 0 && (
                <span
                  aria-hidden
                  className="mono mx-1 text-[11px] leading-none text-fgFaint"
                >
                  ›
                </span>
              )}
              <button
                type="button"
                data-step={s.id}
                aria-current={on ? 'step' : undefined}
                onClick={() => onStep(s.id)}
                title={s.question}
                className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors"
                style={{
                  borderColor: on ? 'rgba(217,164,65,0.6)' : '#243029',
                  background: on ? 'rgba(217,164,65,0.10)' : 'transparent',
                  color: on ? '#D9A441' : '#93A39C',
                }}
              >
                <span className="mono text-[12px] leading-none">{s.glyph}</span>
                <span className="mono text-[10px] leading-none text-fgFaint">{i + 1}</span>
                <span className="font-medium leading-[16px]">{s.name}</span>
                {summary[s.id] && (
                  <span className="mono text-[10px] leading-none text-fgFaint">
                    {summary[s.id]}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-3 py-2.5">
        <button
          type="button"
          data-step-prev=""
          onClick={() => prev && onStep(prev.id)}
          disabled={!prev}
          className="rounded-md border border-line px-2.5 py-1 text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          ← 上一步{prev ? ` · ${prev.name}` : ''}
        </button>
        <button
          type="button"
          data-step-next=""
          onClick={() => next && onStep(next.id)}
          disabled={!next || !canAdvance}
          className="rounded-md border px-3 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            borderColor: 'rgba(217,164,65,0.6)',
            background: 'rgba(217,164,65,0.12)',
            color: '#D9A441',
          }}
          title={next ? `下一步 · ${next.name}` : '已是最后一步'}
        >
          {next ? `下一步 · ${next.name} →` : '已是最后一步'}
        </button>
        {!canAdvance && blockedHint && (
          <p className="min-w-0 flex-1 text-[10px] leading-[15px]" style={{ color: '#D9A441' }}>
            {blockedHint}
          </p>
        )}
      </div>
    </nav>
  );
}
