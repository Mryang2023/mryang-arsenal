'use client';

import type { ArchGap } from '@/lib/arch';
import { dimensions } from '@/lib/stack';
import { STEP_BY_ID, groupOfDim, stepOfDim } from './wizard';
import { TONE } from './palette';

/**
 * 一条隐患的完整呈现。
 *
 * 右侧装配面板与「隐患体检单」页签共用它，保证同一份结论在两处长得一样 ——
 * 同一件事在两处说法不同，是最容易让人开始不信报告的原因。
 *
 * 信息顺序是刻意的：
 *   是什么 → 发生了什么会看到什么 → 后果 → 对策
 * 「会看到什么」放在后果之前，因为它是唯一能被现场核对的，
 * 也是这一栏从「一句警告」变成「一条线索」的关键。
 */
export default function GapCard({
  gap,
  tone,
  onFocus,
  dense = false,
}: {
  gap: ArchGap;
  tone: 'bad' | 'warn' | 'info';
  onFocus?: (dim: string) => void;
  dense?: boolean;
}) {
  const t = TONE[tone];
  const dim = dimensions.find((d) => d.id === gap.dim);

  return (
    <div
      className="rounded-lg border px-3.5 py-3"
      style={{ borderColor: t.border, background: t.soft }}
    >
      <div className="flex items-start gap-2">
        <span className="mono mt-[3px] shrink-0 text-[10px] leading-none" style={{ color: t.color }}>
          ▸
        </span>
        <div className="min-w-0 flex-1">
          <p className={`${dense ? 'text-2xs' : 'text-[13px]'} font-semibold leading-snug text-fg`}>
            {gap.title}
          </p>
          {dim && onFocus && (
            <button
              type="button"
              onClick={() => onFocus(gap.dim)}
              className="mono mt-1 rounded-sm border border-line px-1 text-[10px] leading-[15px] text-fgFaint transition-colors hover:border-lineHi hover:text-fg"
            >
              定位到「{dim.name}」↑
            </button>
          )}

          <p className="mt-1.5 text-[10px] leading-[16px] text-fgMuted">{gap.detail}</p>

          {gap.trigger && (
            <p className="mt-2 text-[10px] leading-[16px] text-fgMuted">
              <span className="mono mr-1 text-fgFaint">触发条件</span>
              {gap.trigger}
            </p>
          )}

          {gap.symptoms?.length ? (
            <div className="mt-2">
              <p className="mono text-[10px] uppercase tracking-wider" style={{ color: t.color }}>
                会看到的现象
              </p>
              <ul className="mt-1 space-y-1">
                {gap.symptoms.map((s, i) => (
                  <li key={i} className="flex gap-1.5 text-[10px] leading-[16px] text-fgMuted">
                    <span className="mono shrink-0 text-fgFaint">{i + 1}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {gap.impact && (
            <p className="mt-2 border-l-2 pl-2 text-[10px] leading-[16px]" style={{ borderColor: t.border, color: '#C8D6D0' }}>
              <span className="mono mr-1 text-fgFaint">后果</span>
              {gap.impact}
            </p>
          )}

          {gap.consequences?.length ? (
            <ul className="mt-2 space-y-0.5">
              {gap.consequences.map((c, i) => (
                <li key={i} className="text-[10px] leading-[16px]" style={{ color: t.color }}>
                  · {c}
                </li>
              ))}
            </ul>
          ) : null}

          {/* 能力缺口的补法：哪个步骤、哪个槽位、选什么。与「定位到」不同 ——
              「定位到」回的是谁在要这块能力，这里去的是能补上的那个槽位。
              步骤必须写出来：只说槽位名，用户在步骤的分组导航里找不到它
              （「运行环境」配在 ⑤ 交付与运行），会以为步骤里没这个东西。 */}
          {gap.unmetCap && (
            <div className="mt-2">
              <p className="mono text-[10px] uppercase tracking-wider" style={{ color: t.color }}>
                怎么补
                <span className="ml-1.5 normal-case tracking-normal text-fgFaint">
                  点「去补」直达该槽位所在的步骤
                </span>
              </p>
              {gap.remedies?.length ? (
                <ul className="mt-1 space-y-1">
                  {gap.remedies.slice(0, 3).map((r) => {
                    const d = dimensions.find((x) => x.id === r.dim);
                    const opt = d?.options.find((o) => o.id === r.option);
                    const s = stepOfDim(r.dim);
                    const spec = s ? STEP_BY_ID.get(s) : null;
                    const g = groupOfDim(r.dim);
                    return (
                      <li
                        key={r.dim}
                        className="flex flex-wrap items-baseline gap-x-1.5 text-[10px] leading-[16px]"
                      >
                        {spec && (
                          <span
                            className="mono rounded-sm border border-line px-1 text-[10px] leading-[15px] text-fgFaint"
                            title={`「${d?.name ?? r.dim}」这一槽位配在「${spec.name}」这一步`}
                          >
                            {spec.glyph} {spec.name}
                          </span>
                        )}
                        <span className="text-fgMuted">
                          {g ? `${g.name} / ` : ''}
                          {d?.name ?? r.dim}
                        </span>
                        {opt && <span style={{ color: '#7FA650' }}>→ {opt.name}</span>}
                        {onFocus && (
                          <button
                            type="button"
                            onClick={() => onFocus(r.dim)}
                            className="mono ml-auto rounded-sm border border-line px-1 text-[10px] leading-[15px] text-fgFaint transition-colors hover:border-lineHi hover:text-fg"
                            title={`跳到「${d?.name ?? r.dim}」所在的步骤去选零件`}
                          >
                            去补 ↑
                          </button>
                        )}
                      </li>
                    );
                  })}
                  {gap.remedies.length > 3 && (
                    <li className="text-[10px] leading-[16px] text-fgFaint">
                      另外 {gap.remedies.length - 3} 个槽位也能补上这项能力
                    </li>
                  )}
                </ul>
              ) : (
                <p className="mt-1 text-[10px] leading-[16px] text-fgMuted">
                  事实源里还没有零件声明能提供这项能力 —— 没法靠换零件修，得先扩事实源。
                </p>
              )}
            </div>
          )}

          {gap.fix && (
            <p className="mt-2 rounded-md border border-line bg-canvas px-2 py-1.5 text-[10px] leading-[16px] text-olive">
              <span className="mono mr-1 text-fgFaint">对策</span>
              {gap.fix}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
