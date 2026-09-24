/**
 * 进度环（S1-5 从 DeliveryDeck 提取为共享组件）。
 *
 * 为什么提取：方案 S1-5 要求结论条「复用 ProgressRing」，而它原来是
 * DeliveryDeck 的文件私有函数 —— 装配台要用只有两条路：抄一份（两处各算
 * 一遍，改半径忘了另一处就是「图上 56px、结论条 44px」式的分歧），或
 * 提成共享组件。选后者，并且让原消费方也改走这份 —— 组件只有一份定义。
 */
export default function ProgressRing({ ratio, tone, size = 56 }: { ratio: number; tone: string; size?: number }) {
  const R = size >= 56 ? 22 : Math.round(size * 0.393);
  const C = 2 * Math.PI * R;
  const on = Math.max(0, Math.min(1, ratio)) * C;
  const cx = size / 2;
  const stroke = size >= 56 ? 5 : 4;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label="必选项覆盖">
      <circle cx={cx} cy={cx} r={R} fill="none" stroke="#243029" strokeWidth={stroke} />
      <circle
        cx={cx}
        cy={cx}
        r={R}
        fill="none"
        stroke={tone}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${on} ${C - on}`}
        transform={`rotate(-90 ${cx} ${cx})`}
      />
      <text
        x={cx}
        y={cx + 4}
        textAnchor="middle"
        fontFamily="'Cascadia Code',Consolas,monospace"
        fontSize={size >= 56 ? 12 : 11}
        fill={tone}
      >
        {Math.round(ratio * 100)}%
      </text>
    </svg>
  );
}
