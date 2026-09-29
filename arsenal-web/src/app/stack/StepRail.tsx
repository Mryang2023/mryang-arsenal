'use client';

import { STEPS, stepIndex, type StepId, type StepSection } from './wizard';

/** 三段十步的分段标签 */
const SECTION_LABELS: Record<StepSection, string> = {
  software: '软件架构',
  'frontend-env': '前端与环境',
  'delivery-run': '交付运行',
};

/**
 * 步骤条 + 上一步 / 下一步。
 *
 * 七步**全部可点**：装配不是一次性问卷 —— 改了 ① 的形态想回头看 ③ 缓存变成
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
  issues,
  canAdvance,
  blockedHint,
}: {
  step: StepId;
  onStep: (id: StepId) => void;
  /** 每格的进度短标签；空串表示这一步没有可数的进度 */
  summary: Record<StepId, string>;
  /**
   * 每步卷进「跑不起来」的问题清单（标题列表）—— 步骤名旁标红数。
   * 「跑不起来」发生在哪一步配置的槽位上，步骤条就得先说出来；
   * 让用户点进 ⑦ 交付才第一次见到结论，是导航失职（09-28 反馈）。
   */
  issues?: Partial<Record<StepId, string[]>>;
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
          const stepIssues = issues?.[s.id] ?? [];
          // 段落切换处插一段分段标签 —— 三段十步后步骤条变长，
          // 没有分段标签用户分不清「选零件」和「填环境」是两个世界
          const sectionLabel =
            SECTION_LABELS[s.section] && (i === 0 || STEPS[i - 1].section !== s.section)
              ? SECTION_LABELS[s.section]
              : null;
          return (
            <li key={s.id} className="flex items-center">
              {sectionLabel ? (
                <span
                  aria-hidden
                  className="mono mx-1.5 border-l border-line pl-2 text-[10px] uppercase leading-none tracking-wider text-fgFaint"
                >
                  {sectionLabel}
                </span>
              ) : (
                i > 0 && (
                  <span
                    aria-hidden
                    className="mono mx-1 text-[11px] leading-none text-fgFaint"
                  >
                    ›
                  </span>
                )
              )}
              <button
                type="button"
                data-step={s.id}
                aria-current={on ? 'step' : undefined}
                onClick={() => onStep(s.id)}
                title={stepIssues.length ? `${s.question}\n\n这一步有问题：\n· ${stepIssues.join('\n· ')}` : s.question}
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
                {stepIssues.length > 0 && (
                  <span
                    className="mono rounded-sm px-1 text-[10px] leading-[15px]"
                    style={{ color: '#E5484D', background: 'rgba(229,72,77,0.14)' }}
                    title={stepIssues.join('；')}
                  >
                    {stepIssues.length}
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
