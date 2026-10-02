'use client';

import { bases, dimensions } from '@/lib/stack';
import type { StackPicks } from '@/lib/content-types';
import { STEP_BY_ID } from '../wizard';
import DimPicker, { type DimFlag } from '../DimPicker';
import StepShell from './StepShell';
import { TONE, INK, toneAt } from '../palette';

/**
 * ② 技术栈基底 —— 整个项目跑在哪条栈上。
 *
 * 基底是**全局声明，不是选型维度**：它决定 pom 的 parent 版本、gradle 插件里
 * 写的 Spring Boot 版本，不参与能力校验、不上台面。所以它单独一步，
 * 不与「数据库选什么」这类问题混在一起。
 *
 * 未覆盖的基底（Quarkus / Micronaut）明说「只作声明，不产出对应产物」——
 * 静默当作支持会让人拿着一份 Spring Boot 骨架以为自己在建 Quarkus 工程。
 */

const BASE_STATUS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  supported: { label: '支持中', color: '#3FB950', bg: 'rgba(63,185,80,0.12)', border: 'rgba(63,185,80,0.40)' },
  eol: { label: '已 EOL', color: TONE.warn.color, bg: toneAt('warn', 0.12), border: toneAt('warn', 0.45) },
  uncovered: { label: '未覆盖', color: INK.muted, bg: 'transparent', border: INK.line },
};

export default function BaseStep({
  baseId,
  onBase,
  picks,
  dimFlags,
  onPick,
  onClear,
}: {
  baseId: string;
  onBase: (id: string) => void;
  picks: StackPicks;
  /** 问题槽位标记（与 ③ 同一形状、同一份数据） */
  dimFlags?: Record<string, DimFlag>;
  onPick: (dimId: string, optId: string) => void;
  onClear: (dimId: string) => void;
}) {
  const spec = STEP_BY_ID.get('base')!;
  /** 基础组的三个维度（JDK / 构建工具 / Web 运行时）—— 与基底同一步定完 */
  const baseDims = dimensions.filter((d) => d.groupId === 'base');

  return (
    <StepShell spec={spec}>
      <div className="p-4">
        <div className="flex flex-wrap gap-1.5">
          {bases.map((b) => {
            const on = b.id === baseId;
            const st = BASE_STATUS[b.status] ?? BASE_STATUS.uncovered;
            return (
              <button
                key={b.id}
                type="button"
                data-base={b.id}
                aria-pressed={on}
                onClick={() => onBase(b.id)}
                title={b.note ? `${b.summary}\n\n${b.note}` : b.summary}
                className="w-[208px] rounded-md border px-2.5 py-2 text-left transition-colors"
                style={{
                  borderColor: on ? toneAt('warn', 0.65) : INK.line,
                  background: on ? toneAt('warn', 0.09) : 'transparent',
                  opacity: b.covered ? 1 : 0.86,
                }}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="mono flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-full border text-[10px] leading-none"
                    style={{
                      borderColor: on ? TONE.warn.color : INK.dim,
                      color: on ? TONE.warn.color : 'transparent',
                    }}
                  >
                    ✓
                  </span>
                  <span className="truncate text-[11px] font-medium leading-[16px] text-fg">
                    {b.name}
                  </span>
                  <span
                    className="mono ml-auto shrink-0 rounded-sm border px-1 text-[10px] leading-[15px]"
                    style={{ color: st.color, background: st.bg, borderColor: st.border }}
                  >
                    {st.label}
                  </span>
                </div>
                <p className="mono mt-1 text-[10px] leading-[15px] text-fgFaint">
                  {b.vendor} · {b.version} · Java {b.java}
                  {b.supportedUntil ? ` · 支持止于 ${b.supportedUntil}` : ''}
                </p>
                <p className="mt-1 line-clamp-2 text-[10px] leading-[15px] text-fgMuted">
                  {b.summary}
                </p>
                {!b.covered && (
                  <p className="mt-1 text-[10px] leading-[15px]" style={{ color: TONE.warn.color }}>
                    本平台未覆盖：只作声明，产物仍是 Spring Boot 骨架。
                  </p>
                )}
                {b.recommended && (
                  <p className="mono mt-1 text-[10px] leading-[15px]" style={{ color: TONE.ok.color }}>
                    新项目建议落点
                  </p>
                )}
              </button>
            );
          })}
        </div>

        <div className="mt-4 rounded-md border border-line">
          {baseDims.map((d) => (
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
    </StepShell>
  );
}
