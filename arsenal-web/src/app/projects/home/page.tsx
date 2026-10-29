import { Suspense } from 'react';
import ProjectHomeGate from './ProjectHomeGate';

export const metadata = {
  title: '项目主页 · 项目',
};

/**
 * 项目主页的静态路由壳。
 *
 * 动态段（/projects/[id]）在 `output: 'export'` 下无法把运行时项目枚举进构建，
 * 所以这里用查询参数 `?id=<projectId>` 承载项目选择（有依据偏离，见 ProjectHome 头注）。
 * useSearchParams 在静态导出下必须挂在 Suspense 边界内 —— 这是 Next 的硬要求。
 */
export default function ProjectHomePage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-fgMuted">载入项目主页…</div>}>
      <ProjectHomeGate />
    </Suspense>
  );
}
