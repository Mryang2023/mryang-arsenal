/**
 * 路由切换的占位 —— 装配台十条步骤路由与四个页面共用这一份。
 *
 * 存在的理由：装配台每次换页都要现算能力审计、导出计划、部署文件与架构图几何，
 * 实测 0.37~1.01s 的阻塞渲染（2026-10-12 生产静态站实测）。App Router 没有
 * loading 边界时，React 会把「侧栏高亮」和「整页内容」压在同一次提交里 ——
 * 于是用户点下去之后看到的不是切换，是等待。挂上边界后高亮立刻走，
 * 这一段算的过程有个诚实的说法。
 *
 * 两条硬约定：
 * · **不许有数字**。这里没有条数、没有百分比、没有预计耗时 —— 占位不是预报，
 *   写一个「约 0.5 秒」就等于对着没测过的环境撒谎。
 * · **不许画半份结论**。骨架屏可以闪，结论不许在算完之前出现。
 */
export default function RoutePending({ label = '装配台' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-md border border-line bg-surface px-5 py-6"
      data-route-pending={label}
    >
      <p className="text-sm font-medium text-fg">{label} · 正在装载这一步</p>
      <p className="mt-1.5 text-2xs leading-relaxed text-fgMuted">
        这一步的能力供需、导出清单与图形都在这一次点击里现算；算完之前不给半份结论。
      </p>
      <div className="mt-4 space-y-2" aria-hidden="true">
        <span className="block h-3 w-2/3 rounded bg-surfaceHi" />
        <span className="block h-3 w-1/2 rounded bg-surfaceHi" />
        <span className="block h-3 w-3/4 rounded bg-surfaceHi" />
      </div>
    </div>
  );
}
