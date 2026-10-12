import RoutePending from '@/components/RoutePending';

/**
 * 装配台的 Suspense 边界 —— 覆盖 `/stack` 整棵子树（四页 + 十条步骤路由）。
 *
 * 没有它的时候，点侧栏菜单要等整页算完才看到任何东西动（实测 0.37~1.01s 阻塞渲染）。
 * 挂上边界后布局与侧栏高亮先提交，这一格显示占位，算完再整块换掉。
 * 共享的占位在 `src/components/RoutePending.tsx`，装配台之外的页面别引它。
 */
export default function Loading() {
  return <RoutePending label="装配台" />;
}
