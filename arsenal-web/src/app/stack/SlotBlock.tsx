'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { capLabel, capsOf, needsOf, nodeArch } from '@/lib/arch';
import type { SlotState } from '@/lib/arch';
import type { StackOption, StackPicks } from '@/lib/content-types';
import { dimensionById } from '@/lib/stack';
import { OptionList } from './Inspector';
import { TONE } from './palette';

/**
 * 卡片三档宽度（方案 §2.4）。
 *
 * 权重只用「宽度」这一维表达，不新增第二种配色 —— 请求链路上的核心件最宽，
 * 旁路件最窄。判定在 StackComposer 里做（那边才知道 `arch.pipelines`），
 * 这里只负责把档位翻译成像素。
 */
export type SlotWeight = 'core' | 'regular' | 'bypass';

/** 档位 → 像素。只在组件内部用，不外借 —— 宽度规则改了这里的三个数就够。 */
const SLOT_WIDTH: Record<SlotWeight, number> = {
  core: 208,
  regular: 172,
  bypass: 148,
};

  /**
   * 空态引导：装什么、装了有什么用（方案 S1-7）。
   *
   * 「未使用」在这里有**两种**形态，两种都要引导：
   *   ① 压根没选（`picks[dimId]` 为空）；
   *   ② 选了事实源里的 `none` 那一项 —— 「不用消息队列」「无」都是它。
   * 只处理 ① 的话，`/stack` 默认态下 33 格全是 `filled`，引导一行都不会出现
   * （V2-13 的「网关路由」卡就是 ②，放大一个「无」加一行小字，没有任何引导）。
   */
export interface SlotHint {
  /** 建议装的零件名 */
  name: string;
  /** 装了之后系统多出什么能力 / 少了什么麻烦 */
  use: string;
}

/**
 * 架构图上的一个模块方块。
 *
 * 三行信息，缺一不可：
 *   ① 这是什么（图标 + 角色 + 必要性）
 *   ② 装的是哪个零件（选项名 / 未选型）
 *   ③ 它向系统提供什么能力（或：缺它会怎样 / 装它会怎样）
 *
 * 第三行是这张图比清单强的地方 —— 它把「为什么缺它就跑不起来」写在脸上。
 */
export default function SlotBlock({
  dimId,
  state,
  option,
  hazards,
  active,
  /**
   * 权重档位，决定卡片宽度。缺省 `regular` —— 老调用方（/arch 页面等）
   * 不传也不会退化成 0 宽。
   */
  weight = 'regular',
  /** 台面上有别的卡片被选中时，同层降噪到 0.96（方案 S1-3 / 契约 L4） */
  dimmed = false,
  /** 未选槽位的「装什么 / 装了有什么用」 */
  hint,
  onClick,
  onClear,
  /** 选型快照 —— 「已装什么」直接画在卡面上 */
  picks,
  /** 就地换件回调（S2-1）——给了才画「换」chip */
  onSwap,
  /** 搜索 / 筛选未命中降噪（S2-4） */
  muted,
}: {
  dimId: string;
  state: SlotState;
  option?: StackOption;
  /** 这块零件参与的组合隐患标题 —— 「有隐患」三个字没有用，得说清是什么隐患 */
  hazards?: string[];
  active: boolean;
  weight?: SlotWeight;
  dimmed?: boolean;
  hint?: SlotHint;
  onClick: () => void;
  onClear: () => void;
  picks: StackPicks;
  /**
   * 就地换件（S2-1）：给了这个回调，卡片上才出「换」chip。
   * 不给（老调用方 /arch 页）就不画 —— 老页面没有 pick 语义。
   */
  onSwap?: (dimId: string, optId: string) => void;
  /**
   * 搜索 / 筛选未命中（S2-4）：聚光灯式降噪到 0.28，而不是把卡片搬走 ——
   * 搬家会破坏「哪个零件在哪条泳道」的空间记忆，降噪保留方位。
   */
  muted?: boolean;
}) {
  // 换件菜单（S2-1）。hooks 必须摆在 `!node` 早退之前 —— 早退虽然实际不触发
  // （nodeArch 覆盖全部槽位），但 hook 数量随渲染分支变化是硬违规，规矩不靠运气立。
  const [swapOpen, setSwapOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; top?: number; bottom?: number } | null>(
    null
  );
  const cardRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!swapOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSwapOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [swapOpen]);

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

  /** 装的是事实源里 `none` 那一档（「不用消息队列」「无」……） */
  const isNone = option?.id === 'none';
  /** 没用上 = 没选，或明确选了「不用」。这是正常态不是错误 —— 淡一档而不是报红 */
  const unused = isNone || (!picked && !node.required);

  /** 打开换件菜单：按卡片矩形定位，右缘夹进视口，下方放不下往上翻 */
  function openSwap() {
    const r = cardRef.current?.getBoundingClientRect();
    if (r) {
      const W = 288;
      const H = 336;
      const M = 8;
      const left = Math.min(Math.max(M, r.left), Math.max(M, window.innerWidth - W - M));
      const fitsBelow = r.bottom + M + H <= window.innerHeight;
      setMenuPos(
        fitsBelow
          ? { left, top: r.bottom + M }
          : { left, bottom: window.innerHeight - r.top + M }
      );
    }
    setSwapOpen(true);
  }

  return (
    <div className="flex shrink-0 flex-col self-start">
    <button
      type="button"
      ref={cardRef}
      data-dim={dimId}
      data-state={state}
      data-weight={weight}
      onClick={onClick}
      onKeyDown={(e) => {
        // S2-5：←→ 在同泳道卡片间移动焦点（DOM 顺序 = 泳道内槽位顺序）。
        // Tab 管全台面遍历，←→ 管泳道内微调 —— 两套粒度各管一层。
        // 泳道容器靠 data-lane 定位（StackComposer 泳道 section），
        // 卡片靠 button[data-dim] 圈定，形态卡等其他按钮不混进来。
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const laneEl = (e.currentTarget as HTMLElement).closest('[data-lane]');
        if (!laneEl) return;
        const cards = Array.from(laneEl.querySelectorAll<HTMLButtonElement>('button[data-dim]'));
        const i = cards.indexOf(e.currentTarget as HTMLButtonElement);
        if (i < 0) return;
        const target = cards[e.key === 'ArrowRight' ? i + 1 : i - 1];
        if (target) {
          e.preventDefault();
          target.focus();
        }
      }}
      title={picked ? `${node.role}：${option?.name}` : node.missing}
      className="relative flex shrink-0 flex-col rounded-lg border px-3 py-2.5 text-left transition-all duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass"
      style={{
        width: SLOT_WIDTH[weight],
        borderColor: tone.border,
        borderStyle: state === 'missing-required' || (!picked && state !== 'missing-recommended') ? 'dashed' : 'solid',
        background: active
          ? 'var(--stack-part-hi)'
          : picked
            ? 'var(--stack-part)'
            : 'rgba(255,255,255,0.012)',
        // L4 选中：黄铜 ring + 抬升；L1 同层降噪 0.96；未用件 0.72；筛选未命中 0.28（S2-4 聚光灯）
        boxShadow: active ? '0 0 0 1px #D9A441, 0 12px 32px -16px rgba(0,0,0,0.9)' : undefined,
        opacity: muted ? 0.28 : unused ? 0.72 : dimmed ? 0.96 : 1,
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
            className="mono ml-auto rounded-sm px-1 text-[10px] leading-[15px]"
            style={{
              color: state === 'missing-required' ? '#E5484D' : '#5E6E67',
              background: state === 'missing-required' ? 'rgba(229,72,77,0.14)' : 'rgba(255,255,255,0.04)',
            }}
          >
            必选
          </span>
        ) : state === 'conflict' ? (
          <span
            className="mono ml-auto rounded-sm px-1 text-[10px] leading-[15px]"
            style={{ color: '#D9A441', background: 'rgba(217,164,65,0.14)' }}
          >
            有隐患
          </span>
        ) : node.recommended && !picked ? (
          <span className="mono ml-auto text-[10px] leading-[15px] text-fgMuted">建议</span>
        ) : null}
      </div>

      {/* ② 零件行：零件名 + 就地换件 chip（S2-1）。整张卡本来就是 <button>，
          chip 只能用 role=button 的 span（button 套 button 会 hydration 报错），
          与右上角移除按钮同一套路；stopPropagation 防止点 chip 触发开面板。 */}
      <div className="mt-1.5 flex items-center gap-1.5">
        <div
          className="min-w-0 flex-1 truncate text-[12px] font-semibold leading-[18px]"
          style={{
            color: picked ? '#E8F0EC' : state === 'missing-required' ? '#E5484D' : '#5E6E67',
          }}
        >
          {picked ? option?.name : node.required ? '未选型' : '未使用'}
        </div>
        {onSwap && picked && !isNone && (
          <span
            role="button"
            tabIndex={0}
            aria-label={`换掉 ${option?.name ?? node.role}`}
            onClick={(e) => {
              e.stopPropagation();
              openSwap();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                openSwap();
              }
            }}
            className="mono shrink-0 cursor-pointer rounded-sm border border-line px-1 text-[10px] leading-[15px] text-fgMuted transition-colors hover:border-brass hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brass"
          >
            换
          </span>
        )}
      </div>

      {/* ③ 能力行 —— 这张图的核心信息。
             参与隐患时替换成隐患标题：把「有隐患」三个字换成「是什么隐患」。 */}
      <div className="mt-1.5 flex min-h-[30px] flex-col gap-0.5">
        {picked && !isNone && hazards && hazards.length > 0 ? (
          <>
            <span className="mono text-[10px] uppercase leading-[15px] tracking-wider" style={{ color: '#D9A441' }}>
              隐患 · {hazards.length}
            </span>
            <ul className="space-y-0.5">
              {hazards.slice(0, 2).map((h) => (
                <li
                  key={h}
                  className="text-[11px] leading-[16px]"
                  style={{ color: 'rgba(217,164,65,0.92)' }}
                >
                  · {h}
                </li>
              ))}
            </ul>
            {hazards.length > 2 && (
              <span className="text-[10px] leading-[15px] text-fgMuted">
                另有 {hazards.length - 2} 条，见右侧结论
              </span>
            )}
          </>
        ) : picked && !isNone ? (
          caps.length > 0 ? (
            <>
              <span className="mono text-[10px] uppercase leading-[15px] tracking-wider text-fgMuted">provides</span>
              <span className="text-[11px] leading-[16px] text-fgMuted">
                {caps.map(capLabel).join(' · ')}
              </span>
              {needs.length > 0 && (
                <span className="truncate text-[10px] leading-[15px] text-fgMuted">
                  需要 {needs.map(capLabel).join(' · ')}
                </span>
              )}
            </>
          ) : (
            <span className="text-[11px] leading-[16px] text-fgMuted">
              不提供额外能力，也不向系统索要能力
            </span>
          )
        ) : !picked ? (
          <span
            className="text-[11px] leading-[16px]"
            style={{ color: state === 'missing-required' ? 'rgba(229,72,77,0.85)' : '#80918A' }}
          >
            {node.missing}
          </span>
        ) : null}
      </div>

      {/* 空态引导（S1-7）：只说「无」等于没说 —— 得回答「装什么」和「装了有什么用」。
          整张卡本来就是按钮，点任意位置即直达右侧选件，所以这里只画箭头、不套第二层按钮。
          虚线上沿把「当前状态」和「建议动作」分开，免得读成卡片自带的一行说明。 */}
      {hint && (
        <div className="mt-1 flex flex-col gap-0.5 border-t border-dashed border-line pt-1">
          <span className="truncate text-[11px] leading-[16px] text-fgMuted">
            <span className="mono text-fgMuted">装 </span>
            {hint.name}
            <span className="mono text-fgMuted"> →</span>
          </span>
          <span className="line-clamp-2 text-[10px] leading-[15px] text-fgMuted">{hint.use}</span>
        </div>
      )}

      {/* 已选块：移除按钮常驻（不再依赖 hover —— 触屏没有 hover，
          藏起来等于删不掉）。外层 32×32 是触摸点击区，里层 20×20 是视觉本体。 */}
      {picked && !isNone && (
        <span
          role="button"
          tabIndex={0}
          aria-label={`移除 ${option?.name ?? node.role}`}
          onClick={(e) => {
            e.stopPropagation();
            onClear();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onClear();
            }
          }}
          className="absolute -right-2.5 -top-2.5 z-10 flex h-8 w-8 cursor-pointer items-start justify-end rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brass"
        >
          <span className="mono flex h-5 w-5 items-center justify-center rounded-full border border-lineHi bg-surfaceMax text-[11px] leading-none text-fgMuted transition-colors duration-150 hover:border-brass hover:text-fg">
            ×
          </span>
        </span>
      )}
    </button>

      {/* 就地换件菜单（S2-1）：portal 到 body —— 泳道 section 带 overflow-hidden，
          卡片内绝对定位的菜单会在泳道边缘被整块裁掉。fixed 定位按卡片矩形算，
          右缘 / 下缘夹进视口，Esc 或点遮罩关闭；选项行吃 Inspector 的 OptionList（推荐在前）。 */}
      {swapOpen &&
        menuPos &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setSwapOpen(false)}
              aria-hidden="true"
            />
            <div
              data-swap-menu=""
              role="menu"
              aria-label={`换掉 ${node.role} 的零件`}
              className="panel fixed z-50 w-[288px] overflow-hidden rounded-lg"
              style={{
                left: menuPos.left,
                ...(menuPos.top !== undefined
                  ? { top: menuPos.top }
                  : { bottom: menuPos.bottom }),
                boxShadow: '0 16px 40px -16px rgba(0,0,0,0.9)',
              }}
            >
              <div className="flex items-baseline gap-2 border-b border-line px-3 py-2">
                <span className="text-[12px] leading-none text-brass">{node.icon}</span>
                <p className="text-[11px] font-semibold text-fg">
                  {dimensionById.get(dimId)?.name ?? node.role}
                </p>
                <span className="mono ml-auto text-[10px] text-fgFaint">推荐在前</span>
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                <OptionList
                  dimId={dimId}
                  current={picks[dimId] ?? ''}
                  onPick={(d, o) => {
                    setSwapOpen(false);
                    onSwap?.(d, o);
                  }}
                />
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
