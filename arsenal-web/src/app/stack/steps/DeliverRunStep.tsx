'use client';

import { useEffect, useRef } from 'react';
import type { StackPicks } from '@/lib/content-types';
import { RUN_SECTIONS, STEP_BY_ID } from '../wizard';
import DimPicker, { type DimFlag } from '../DimPicker';
import StepShell from './StepShell';
import { TONE, toneAt } from '../palette';

/**
 * ⑤ 交付与运行 —— 交付运行段的第一步，**只谈怎么跑起来**。
 *
 * 09-28 反馈：架构选择就选代码软件架构，交付相关的单独一个流程，混着选太乱。
 * 于是运行基石 / 交付与运行 / 运维安全三组（运行环境、入口、网关、编排、
 * 制品库、交付形态、CI/CD、监控、密钥、日志）整组搬到这里 —— 代码架构在
 * ②③④ 定完，这一步集中表态「它怎么跑起来、怎么交付」。
 *
 * 与 ③ 主题框架同构（组分区 + DimPicker 卡墙 + 问题标记），差别只在口径：
 * ③ 只放主题件（剩下的去 ④ 校核），这里放**全量**交付维度 —— 交付面一共
 * 10 个槽位，一屏铺得下，不需要「先选组再看」的两次点击。
 */
export default function DeliverRunStep({
  picks,
  dimFlags,
  onPick,
  onClear,
  activeDim,
}: {
  picks: StackPicks;
  /** 问题槽位标记（dimId → 红/绿 + 一句话）。出处见 StackComposer 的 issueDots */
  dimFlags?: Record<string, DimFlag>;
  onPick: (dimId: string, optId: string) => void;
  onClear: (dimId: string) => void;
  /** focusDim 链路：点阵/台面点进来的槽位。三组一屏铺完，但页可以长 —— 滚动 + 高亮 */
  activeDim?: string | null;
}) {
  const spec = STEP_BY_ID.get('deliverRun')!;
  const total = RUN_SECTIONS.reduce((n, s) => n + s.dims.length, 0);
  const filled = RUN_SECTIONS.reduce((n, s) => n + s.dims.filter((d) => picks[d.id]).length, 0);
  // focusDim 断线修复（2026-10-03，与 ThemeStep 同批）：activeDim 此前无人消费，
  // 从选型台点运行/交付维度的格子跳过来后看不到任何对应 UI。
  const followRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!activeDim) return;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        followRef.current
          ?.querySelector(`[data-dim-id="${activeDim}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      })
    );
  }, [activeDim]);

  return (
    <StepShell spec={spec}>
      <div ref={followRef} className="space-y-3 p-4">
        <p className="rounded-md border border-line bg-surface px-4 py-2 text-[11px] leading-[17px] text-fgMuted">
          <span className="mono text-brass">⬢</span> 代码架构（技术栈 / 数据 / 中间件 / 横切）已在{' '}
          <span className="text-fg">② ③ ④</span> 定完，这一步只回答它们的运行与交付面：
          跑在什么环境上、请求从哪进来、谁编排、镜像放哪、怎么构建发布与运维 ——
          共 {total} 个槽位，已定 {filled}/{total}。
        </p>
        {RUN_SECTIONS.map((s) => {
          const f = s.dims.filter((d) => picks[d.id]).length;
          const issues = s.dims.filter((d) => dimFlags?.[d.id]?.kind === 'need').length;
          return (
            <section key={s.group.id} data-run-group={s.group.id} className="panel overflow-hidden">
              <header className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-b border-line px-4 py-3">
                <span className="mono text-[13px] leading-none text-brass">{s.group.glyph}</span>
                <h3 className="text-[13px] font-semibold leading-[18px] text-fg">{s.group.name}</h3>
                <span className="mono text-[10px] leading-[15px] text-fgFaint">
                  已定 {f}/{s.dims.length}
                </span>
                {issues > 0 && (
                  <span
                    className="mono rounded-sm px-1 text-[10px] leading-[15px]"
                    style={{ color: TONE.bad.color, background: toneAt('bad', 0.14) }}
                    title={`这一组有 ${issues} 个槽位卷进「跑不起来」`}
                  >
                    {issues} 个问题
                  </span>
                )}
              </header>
              <p className="border-b border-line px-4 py-2 text-[10px] leading-[15px] text-fgMuted">
                {s.group.desc}
              </p>
              <div className="divide-y divide-line">
                {s.dims.map((d) => (
                  <DimPicker
                    key={d.id}
                    dim={d}
                    picks={picks}
                    flag={dimFlags?.[d.id]}
                    highlight={activeDim === d.id}
                    onPick={onPick}
                    onClear={onClear}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </StepShell>
  );
}
