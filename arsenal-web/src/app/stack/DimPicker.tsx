'use client';

import { capsOf, needsOf, capLabel, nodeArch } from '@/lib/arch';
import { recommendedOrder } from './Inspector';
import type { StackDimension, StackPicks } from '@/lib/content-types';
import { TONE } from './palette';

/**
 * 一个维度一行：维度名 + 候选零件横排。
 *
 * 与右栏 `Inspector` 的分工：Inspector 是「点开一个槽位深挖」的纵向下钻，
 * 这里是「一次扫过好几条」的横向选择 —— 向导的每一步要在**一屏里把这一步
 * 该定的东西定完**，逐个点开面板会让人在步骤里迷路。
 *
 * 三处不妥协：
 *   · 候选顺序吃 `recommendedOrder()`（事实源 defaultOption 排前、「不用」垫底），
 *     这里不另排一遍 —— 两处排序漂移是最难发现的坏法；
 *   · 每个候选把 provides / requires 的能力标签带上 —— 选件不是选名字，
 *     是选「装上去之后系统多出什么、要向系统要什么」；
 *   · 未选时显示空态引导（装什么 / 装了有什么用），出处同样是事实源。
 */

export interface DimFlag {
  kind: 'need' | 'remedy';
  /** 一句话说明：要「容器运行环境」/ 可补「容器运行环境」/ 必选未装 */
  label: string;
  /** 更完整的关联说明（悬停 title 用）：谁在要、为什么推荐 —— 标签要短，解释放这里 */
  detail?: string;
  /** 补法推荐直接选哪个零件 —— 卡片里给它描绿框，问题不用第二次查找 */
  optionId?: string;
}

export default function DimPicker({
  dim,
  picks,
  onPick,
  onClear,
  flag,
}: {
  dim: StackDimension;
  picks: StackPicks;
  onPick: (dimId: string, optId: string) => void;
  onClear: (dimId: string) => void;
  /** 问题标记：need 红 / remedy 绿。三类问题都标 ——
      要没人给的能力（need）、能补上缺口（remedy）、必选未装（need）。 */
  flag?: DimFlag;
}) {
  const current = picks[dim.id] ?? '';
  const node = nodeArch[dim.id];
  const order = recommendedOrder(dim);
  const flagColor = flag?.kind === 'need' ? TONE.bad : { color: '#7FA650', border: 'rgba(127,166,80,0.6)', soft: 'rgba(127,166,80,0.10)' };

  return (
    <div className="relative border-t border-line px-4 py-3 first:border-t-0">
      {/* 显眼的问题框（09-28 反馈：满卡打勾看不出哪张卡有问题）——
          absolute 覆盖框不碰 divide 分隔布局；need 红 / remedy 绿，与点阵同一语言 */}
      {flag && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-1.5 inset-y-1 rounded-md border-2"
            style={{ borderColor: flagColor.color, boxShadow: `0 0 0 1px ${flagColor.color}40` }}
          />
          <div className="pointer-events-none absolute -top-[1px] right-2 -translate-y-1/2">
            <span
              className="mono rounded-sm border px-1.5 text-[10px] leading-[17px]"
              style={{
                color: flagColor.color,
                borderColor: flagColor.border,
                background: flag.kind === 'need' ? 'rgba(229,72,77,0.16)' : 'rgba(127,166,80,0.16)',
              }}
            >
              {flag.label}
            </span>
          </div>
        </>
      )}
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h4 className="text-[12px] font-semibold leading-[18px] text-fg">{dim.name}</h4>
        {node?.required && (
          <span
            className="mono rounded-sm border px-1 text-[10px] leading-[15px]"
            style={{ color: TONE.bad.color, borderColor: TONE.bad.border, background: TONE.bad.soft }}
          >
            必选 · 缺了跑不起来
          </span>
        )}
        {!node?.required && node?.recommended && (
          <span
            className="mono rounded-sm border px-1 text-[10px] leading-[15px]"
            style={{ color: TONE.warn.color, borderColor: TONE.warn.border, background: TONE.warn.soft }}
          >
            建议 · 缺了能跑但不完整
          </span>
        )}
        {!current && (
          <span className="mono text-[10px] leading-[15px] text-fgFaint">未定</span>
        )}
        <p className="min-w-0 flex-1 text-[10px] leading-[15px] text-fgFaint">{dim.why}</p>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {order.map((o) => {
          const on = o.id === current;
          const isNone = o.id === 'none';
          const isRemedyPick = flag?.optionId === o.id && !on;
          return (
            <button
              key={o.id}
              type="button"
              data-dim-pick={dim.id}
              data-opt={o.id}
              aria-pressed={on}
              onClick={() => (on && !isNone ? onClear(dim.id) : onPick(dim.id, o.id))}
              title={
                on && !isNone
                  ? '再点一次取消（退回未定）'
                  : isRemedyPick
                    ? `${flag!.detail ?? flag!.label} —— 选它即可补上`
                    : o.summary
              }
              className="w-[208px] rounded-md border px-2.5 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brass"
              style={{
                borderColor: on ? 'rgba(217,164,65,0.65)' : isRemedyPick ? flagColor.border : '#243029',
                background: on
                  ? 'rgba(217,164,65,0.09)'
                  : isRemedyPick
                    ? 'rgba(127,166,80,0.10)'
                    : 'transparent',
                opacity: isNone && !on ? 0.72 : 1,
              }}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="mono flex h-[13px] w-[13px] shrink-0 items-center justify-center rounded-full border text-[10px] leading-none"
                  style={{
                    borderColor: on ? '#D9A441' : isRemedyPick ? '#7FA650' : '#33413A',
                    color: on ? '#D9A441' : isRemedyPick ? '#7FA650' : 'transparent',
                  }}
                >
                  {on ? '✓' : isRemedyPick ? '+' : ''}
                </span>
                <span className="truncate text-[11px] font-medium leading-[16px] text-fg">
                  {o.name}
                </span>
                {o.badge && (
                  <span className="mono ml-auto shrink-0 rounded-sm border border-line px-1 text-[10px] leading-[15px] text-fgFaint">
                    {o.badge}
                  </span>
                )}
              </div>
              <p className="mt-1 line-clamp-2 text-[10px] leading-[15px] text-fgMuted">
                {o.summary}
              </p>
              {(capsOf(dim.id, o.id).length > 0 || needsOf(dim.id, o.id).length > 0) && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {capsOf(dim.id, o.id).map((c) => (
                    <span
                      key={c}
                      className="mono rounded-sm px-1 text-[10px] leading-[15px]"
                      style={{ color: '#7FA650', background: 'rgba(127,166,80,0.10)' }}
                    >
                      +{capLabel(c)}
                    </span>
                  ))}
                  {needsOf(dim.id, o.id).map((c) => (
                    <span
                      key={c}
                      className="mono rounded-sm px-1 text-[10px] leading-[15px]"
                      style={{ color: '#93A39C', background: 'rgba(255,255,255,0.04)' }}
                    >
                      需 {capLabel(c)}
                    </span>
                  ))}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
