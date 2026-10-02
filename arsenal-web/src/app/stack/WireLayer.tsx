'use client';
import { TONE } from './palette';

/**
 * 请求链路连线（S1-4）。
 *
 * 两类连线都从这里出：
 *   · `WireLayer` —— 泳道之间的竖连线（原 LaneWire 的职责，从 StackComposer 迁来）；
 *   · `SlotWire`  —— 链路槽位之间的横向箭头（原来是 → 字符：字号随浏览器变、
 *     基线对不齐、换字体就错位；SVG 后线宽箭尖全是算出来的）。
 *
 * 动效与 arch-motion 的约定一致（见 lib/arch-motion.ts 顶部三条克制）：
 * 流动 = stroke-dasharray + dashoffset 动画，只动合成友好属性；
 * prefers-reduced-motion 下一律停。keyframes 与流动类定义在 globals.css
 * 的装配台段落（.stack-wire-flow），这里只负责挂类名 —— SSR 安全，也不靠
 * 「谁先渲染谁挂 style」这种顺序假设。
 *
 * 「点亮请求链路」开关（flowOn）：
 *   · off —— 零动效、零高亮，连线用 treeLine 静态实线（与 S1-1 落地时的样子一致）；
 *   · on  —— 泳道间竖线与槽内箭头转黄铜流动虚线，只有真正在请求链路上的
 *     连线才点亮（pipelines 数据决定，不亮旁路件之间的分隔线）。
 */

const IDLE_STROKE = '#3C4D45'; // treeLine：结构线专用 token，不是语义色
const FLOW_STROKE = TONE.warn.color; // brass：点亮 = 方案的 warn 语义色，不引第二配色

/**
 * 泳道之间的竖连线。
 *
 * flowOn 时改走「流动虚线」：dasharray 让线变成一截一截往前跑的样子，
 * 表示「请求正在向下穿过」，而不是静态的装饰线。
 */
export function WireLayer({ flowOn }: { flowOn: boolean }) {
  return (
    <svg
      width="10"
      height="24"
      viewBox="0 0 10 24"
      aria-hidden="true"
      className="shrink-0 overflow-visible"
    >
      <line
        x1="5"
        y1="0"
        x2="5"
        y2="17"
        stroke={flowOn ? FLOW_STROKE : IDLE_STROKE}
        strokeWidth="1"
        className={flowOn ? 'stack-wire-flow' : undefined}
      />
      <path
        d="M2 14 L5 18 L8 14"
        fill="none"
        stroke={flowOn ? FLOW_STROKE : IDLE_STROKE}
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * 链路槽位之间的横向箭头（替代 → 字符）。
 *
 * 与泳道间连线同一条语义：它只出现在「这条边在请求链路上」的位置
 * （inPipeline && pipedIdx > 0），点亮时与泳道间连线一起流动 ——
 * 两段一起亮，链路才是「一条线」，不是各自闪烁的碎线头。
 */
export function SlotWire({ flowOn }: { flowOn: boolean }) {
  return (
    <svg
      width="16"
      height="10"
      viewBox="0 0 16 10"
      aria-hidden="true"
      className="mr-1.5 shrink-0 self-center overflow-visible"
    >
      <line
        x1="0"
        y1="5"
        x2="11"
        y2="5"
        stroke={flowOn ? FLOW_STROKE : IDLE_STROKE}
        strokeWidth="1"
        className={flowOn ? 'stack-wire-flow' : undefined}
      />
      <path
        d="M8 2 L12 5 L8 8"
        fill="none"
        stroke={flowOn ? FLOW_STROKE : IDLE_STROKE}
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
