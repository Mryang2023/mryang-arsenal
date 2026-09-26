'use client';

import Link from 'next/link';
import { Fragment } from 'react';
import { STEPS, stepHref, type StepCtx, type StepId } from './steps';

/**
 * 三步珠链 —— 三层共用，替代 Hero 那 9 行中文说明书。
 *
 * 一条主线色（`#D9A441`）只表示一件事：**你此刻走的路径**。
 * 已经走过的步保持点亮（比当前步暗一半），没走到的步降到 40% ——
 * 「还剩几步」不用读字，看亮度就知道。
 */

const BRASS = '#D9A441';

export interface TrailItem {
  k: string;
  v: string;
}

export default function StepRail({
  current,
  ctx,
  trail,
}: {
  current: StepId;
  ctx?: StepCtx;
  trail?: TrailItem[];
}) {
  const idx = Math.max(0, STEPS.findIndex((s) => s.id === current));

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <div className="flex items-center" data-step-rail={current}>
        {STEPS.map((s, i) => {
          const on = i === idx;
          const done = i < idx;
          const href = stepHref(s.id, ctx);
          const bead = (
            <span
              className="flex items-center gap-1.5 whitespace-nowrap"
              style={{ opacity: on ? 1 : done ? 0.75 : 0.4 }}
            >
              <span
                className="block rounded-full"
                style={
                  on
                    ? { width: 9, height: 9, background: BRASS, boxShadow: `0 0 0 3px ${BRASS}29` }
                    : {
                        width: 7,
                        height: 7,
                        background: done ? BRASS : '#0B0F0E',
                        border: `1.5px solid ${done ? BRASS : '#4A5A52'}`,
                      }
                }
              />
              <span className="mono text-[10px]" style={{ color: on ? BRASS : undefined }}>
                {s.n}
              </span>
              <span className={`text-[12px] ${on ? 'font-medium text-fg' : 'text-fgMuted'}`}>
                {s.label}
              </span>
            </span>
          );
          return (
            <Fragment key={s.id}>
              {i > 0 && (
                <span
                  className="mx-2 block h-px w-6"
                  style={{ background: i <= idx ? 'rgba(217,164,65,0.6)' : '#33413A' }}
                  aria-hidden="true"
                />
              )}
              {href ? (
                <Link href={href} className="transition-opacity hover:opacity-100">
                  {bead}
                </Link>
              ) : (
                // 不可达的步：必须让读屏软件也知道它不可点，不是只靠视觉变淡
                <span aria-disabled="true" title="这一步尚未开通">{bead}</span>
              )}
            </Fragment>
          );
        })}
      </div>

      {trail && trail.length > 0 && (
        <div className="mono flex min-w-0 flex-wrap items-center gap-x-1.5 text-[11px] text-fgFaint">
          {trail.map((t, i) => (
            <span key={t.k} className="flex min-w-0 items-center gap-1.5">
              <span className="text-fgFaint">{t.k}：</span>
              <span className="truncate text-fgMuted">{t.v}</span>
              {i < trail.length - 1 && <span className="text-lineHi">›</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
