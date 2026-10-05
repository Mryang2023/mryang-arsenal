'use client';

import { useRouter } from 'next/navigation';
import {
  PAGE_OF_STEP,
  STACK_PAGES,
  STEP_BY_ID,
  STEP_ROUTES,
  STEPS,
  stepIndex,
  type StackPageId,
  type StepId,
} from './wizard';
import { TONE, INK, toneAt } from './palette';

/**
 * 页内步骤条 + 上一步 / 下一步。
 *
 * P0 拆四页之前：一条步骤条铺满**全部十步**。拆页后它只显示**本页那几步**
 * （跨页由 JourneyBar 负责），但上一步 / 下一步仍沿十步的全局顺序走 ——
 * 走到本页最后一步再点「下一步」，直接跳到下一页的那一步，中间不断。
 *
 * 步骤**全部可点**：装配不是一次性问卷 —— 改了 ① 的形态想回头看 ③ 缓存变成
 * 什么，必须能直接跳回去。每一格都带一个进度短标签（如「12/15」），
 * 所以「哪一步还没定完」不用点进去才知道。
 *
 * 「下一步」永远是主按钮，「上一步」永远在左边 —— 不因为到了最后一步就把
 * 位置换掉，肌肉记忆比对称美观值钱。
 */
export default function StepRail({
  page,
  step,
  onStep,
  summary,
  issues,
  canAdvance,
  blockedHint,
}: {
  page: StackPageId;
  step: StepId;
  onStep: (id: StepId) => void;
  /** 每格的进度短标签；空串表示这一步没有可数的进度 */
  summary: Record<StepId, string>;
  /**
   * 每步卷进「跑不起来」的问题清单（标题列表）—— 步骤名旁标红数。
   * 「跑不起来」发生在哪一步配置的槽位上，步骤条就得先说出来；
   * 让用户点进 ⑩ 交付才第一次见到结论，是导航失职（09-28 反馈）。
   */
  issues?: Partial<Record<StepId, string[]>>;
  /** 为 false 时「下一步」禁用，并在下方写明为什么 —— 静默禁用等于按钮坏了 */
  canAdvance: boolean;
  blockedHint?: string;
}) {
  const router = useRouter();
  const pageSpec = STACK_PAGES.find((p) => p.id === page) ?? STACK_PAGES[0];
  // 用 STEP_BY_ID 而不是 `STEPS[stepIndex(id)]`：stepIndex 是数组下标（0 起），
  // 曾经按「1 起」写成 `STEPS[stepIndex(id) - 1]` —— 首页第一步落到 STEPS[-1]，
  // 预渲染直接 Cannot read properties of undefined。按 id 取就不会有这个 off-by-one。
  const pageSteps = pageSpec.steps.map((id) => STEP_BY_ID.get(id)).filter((s): s is (typeof STEPS)[number] => !!s);

  /** 切步骤：落在别的页就同时换页（十步是一条路，不因拆页而断）。
   *  跨页落到**步骤路由**（/stack/step/<id>）—— 新页把这一步钉死，侧边栏
   *  细分子项也点亮那一步；本页的步只就地 setStep，不做任何导航。 */
  function go(id: StepId) {
    const home = PAGE_OF_STEP[id];
    if (home !== pageSpec.route) router.push(STEP_ROUTES[id]);
    onStep(id);
  }

  const idx = stepIndex(step);
  const prev = STEPS[idx - 1];
  const next = STEPS[idx + 1];

  return (
    <nav className="panel overflow-hidden" aria-label="装配步骤">
      <ol className="flex flex-wrap items-stretch gap-x-1 gap-y-1.5 px-3 py-2.5">
        {pageSteps.map((s, k) => {
          const i = stepIndex(s.id);
          const on = s.id === step;
          const stepIssues = issues?.[s.id] ?? [];
          return (
            <li key={s.id} className="flex items-center">
              {/* 页内分隔箭头：第一格前面不画（用页内下标 k，不是全局序号 i） */}
              {k > 0 && (
                <span aria-hidden className="mono mx-1 text-[11px] leading-none text-fgFaint">
                  ›
                </span>
              )}
              <button
                type="button"
                data-step={s.id}
                aria-current={on ? 'step' : undefined}
                onClick={() => go(s.id)}
                title={stepIssues.length ? `${s.question}\n\n这一步有问题：\n· ${stepIssues.join('\n· ')}` : s.question}
                className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors"
                style={{
                  borderColor: on ? toneAt('warn', 0.6) : INK.line,
                  background: on ? toneAt('warn', 0.10) : 'transparent',
                  color: on ? TONE.warn.color : INK.muted,
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
                    style={{ color: TONE.bad.color, background: toneAt('bad', 0.14) }}
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
          onClick={() => prev && go(prev.id)}
          disabled={!prev}
          className="rounded-md border border-line px-2.5 py-1 text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          ← 上一步{prev ? ` · ${prev.name}` : ''}
        </button>
        <button
          type="button"
          data-step-next=""
          onClick={() => next && go(next.id)}
          disabled={!next || !canAdvance}
          className="rounded-md border px-3 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          style={{
            borderColor: toneAt('warn', 0.6),
            background: toneAt('warn', 0.12),
            color: TONE.warn.color,
          }}
          title={next ? `下一步 · ${next.name}` : '已是最后一步'}
        >
          {next ? `下一步 · ${next.name} →` : '已是最后一步'}
        </button>
        {!canAdvance && blockedHint && (
          <p className="min-w-0 flex-1 text-[10px] leading-[15px]" style={{ color: TONE.warn.color }}>
            {blockedHint}
          </p>
        )}
      </div>
    </nav>
  );
}
