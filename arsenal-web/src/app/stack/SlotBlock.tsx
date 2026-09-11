'use client';

import { capLabel, capsOf, needsOf, nodeArch } from '@/lib/arch';
import type { SlotState } from '@/lib/arch';
import type { StackOption } from '@/lib/content-types';
import { TONE } from './palette';

/**
 * 架构图上的一个模块方块。
 *
 * 三行信息，缺一不可：
 *   ① 这是什么（图标 + 角色 + 必要性）
 *   ② 装的是哪个零件（选项名 / 未选型）
 *   ③ 它向系统提供什么能力（或：缺它会怎样）
 *
 * 第三行是这张图比清单强的地方 —— 它把「为什么缺它就跑不起来」写在脸上。
 */
export default function SlotBlock({
  dimId,
  state,
  option,
  hazards,
  active,
  onClick,
  onClear,
}: {
  dimId: string;
  state: SlotState;
  option?: StackOption;
  /** 这块零件参与的组合隐患标题 —— 「有隐患」三个字没有用，得说清是什么隐患 */
  hazards?: string[];
  active: boolean;
  onClick: () => void;
  onClear: () => void;
}) {
  const node = nodeArch[dimId];
  if (!node) return null;

  const picked = state === 'filled' || state === 'conflict';
  const tone =
    state === 'missing-required' ? TONE.bad
      : state === 'conflict' ? TONE.warn
        : state === 'missing-recommended' ? TONE.idle
          : picked ? TONE.ok
            : TONE.idle;

  const caps = picked && option ? capsOf(dimId, option.id) : [];
  const needs = picked && option ? needsOf(dimId, option.id) : [];

  return (
    <button
      type="button"
      data-dim={dimId}
      data-state={state}
      onClick={onClick}
      title={picked ? `${node.role}：${option?.name}` : node.missing}
      className="group relative flex w-[172px] shrink-0 flex-col rounded-lg border px-3 py-2.5 text-left transition-all duration-150"
      style={{
        borderColor: tone.border,
        borderStyle: state === 'missing-required' || (!picked && state !== 'missing-recommended') ? 'dashed' : 'solid',
        background: picked ? tone.soft : 'rgba(255,255,255,0.012)',
        boxShadow: active ? `0 0 0 1px ${tone.border}, 0 8px 20px -14px rgba(0,0,0,0.9)` : undefined,
      }}
    >
      {/* ① 身份行 */}
      <div className="flex items-center gap-1.5">
        <span
          className="text-[14px] leading-none"
          style={{ color: picked ? tone.color : TONE.idle.color }}
        >
          {node.icon}
        </span>
        <span className="text-2xs font-medium text-fg">{node.role}</span>
        {node.required ? (
          <span
            className="mono ml-auto rounded-sm px-1 text-[9px] leading-[14px]"
            style={{
              color: state === 'missing-required' ? '#E5484D' : '#5E6E67',
              background: state === 'missing-required' ? 'rgba(229,72,77,0.14)' : 'rgba(255,255,255,0.04)',
            }}
          >
            必选
          </span>
        ) : state === 'conflict' ? (
          <span
            className="mono ml-auto rounded-sm px-1 text-[9px] leading-[14px]"
            style={{ color: '#D9A441', background: 'rgba(217,164,65,0.14)' }}
          >
            有隐患
          </span>
        ) : node.recommended && !picked ? (
          <span className="mono ml-auto text-[9px] leading-[14px] text-fgFaint">建议</span>
        ) : null}
      </div>

      {/* ② 零件行 */}
      <div
        className="mt-1.5 truncate text-[12px] font-semibold"
        style={{
          color: picked ? '#E8F0EC' : state === 'missing-required' ? '#E5484D' : '#5E6E67',
        }}
      >
        {picked ? option?.name : node.required ? '未选型' : '未使用'}
      </div>

      {/* ③ 能力行 —— 这张图的核心信息。
             参与隐患时替换成隐患标题：把「有隐患」三个字换成「是什么隐患」。 */}
      <div className="mt-1.5 flex min-h-[28px] flex-col gap-0.5">
        {picked && hazards && hazards.length > 0 ? (
          <>
            <span className="mono text-[9px] uppercase tracking-wider" style={{ color: '#D9A441' }}>
              隐患 · {hazards.length}
            </span>
            <ul className="space-y-0.5">
              {hazards.slice(0, 2).map((h) => (
                <li
                  key={h}
                  className="text-[10px] leading-[13px]"
                  style={{ color: 'rgba(217,164,65,0.92)' }}
                >
                  · {h}
                </li>
              ))}
            </ul>
            {hazards.length > 2 && (
              <span className="text-[9px] leading-[12px] text-fgFaint">
                另有 {hazards.length - 2} 条，见右侧结论
              </span>
            )}
          </>
        ) : picked ? (
          caps.length > 0 ? (
            <>
              <span className="mono text-[9px] uppercase tracking-wider text-fgFaint">provides</span>
              <span className="text-[10px] leading-[13px] text-fgMuted">
                {caps.map(capLabel).join(' · ')}
              </span>
              {needs.length > 0 && (
                <span className="truncate text-[9px] leading-[12px] text-fgFaint">
                  需要 {needs.map(capLabel).join(' · ')}
                </span>
              )}
            </>
          ) : (
            <span className="text-[10px] leading-[13px] text-fgFaint">
              不提供额外能力，也不向系统索要能力
            </span>
          )
        ) : (
          <span
            className="text-[10px] leading-[13px]"
            style={{ color: state === 'missing-required' ? 'rgba(229,72,77,0.85)' : '#5E6E67' }}
          >
            {node.missing}
          </span>
        )}
      </div>

      {/* 已选块：hover 出现移除按钮 */}
      {picked && (
        <span
          role="button"
          tabIndex={-1}
          aria-label="移除该模块"
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          className="mono absolute -right-1.5 -top-1.5 hidden h-[16px] w-[16px] cursor-pointer items-center justify-center rounded-full border border-lineHi bg-surfaceMax text-[10px] leading-none text-fgMuted group-hover:flex hover:text-fg"
        >
          ×
        </span>
      )}
    </button>
  );
}
