import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cases, getCase } from '@/lib/case-cases';
import CaseBench from './CaseBench';

/**
 * L2 · 场景操作台 —— 「这个约束下全局长什么样？」
 *
 * ⚠️ `generateStaticParams()` **必须由 `cases` 数组驱动**，不许手写 id 列表：
 * 场景数已经从 8 变 9（2026-09-26 第 1 棒加了「幂等写入」），写死 8 会让第 9 个场景
 * **静默不生成页面**，而 `case-check` 的路由断言还照旧绿 —— 这是本仓最典型的假绿形态。
 */
export function generateStaticParams() {
  return cases.map((c) => ({ caseId: c.id }));
}

// ⚠️ 不要在这里写 `export const dynamicParams = false`：
// Next.js 14 的 dev 服务器（buildAppStaticPaths, utils.js:1044）会把
// "任一分段 dynamicParams===false" 算成 fallback=false，进而 fallbackMode 不是 "static"，
// 在 `output:'export'` 下直接抛 "missing exported function generateStaticParams()" ——
// 明明函数就在，dev 却报缺。rules / blueprints 两条动态路由都不设它，dev、build 都正常。
// 未知 caseId 的 404 由下方 `getCase()` 返回 undefined → notFound() 兜住，静态导出也没有对应 HTML。

export async function generateMetadata({
  params,
}: {
  params: Promise<{ caseId: string }>;
}): Promise<Metadata> {
  const { caseId } = await params;
  const kase = getCase(caseId);
  if (!kase) return { title: '未找到场景' };
  return {
    title: `${kase.name} · 场景案例库`,
    description: kase.problem,
  };
}

// params 是 Promise（Next 15+ 动态 API 异步化）
export default async function CaseBenchPage({
  params,
}: {
  params: Promise<{ caseId: string }>;
}) {
  const { caseId } = await params;
  const kase = getCase(caseId);
  if (!kase) notFound();

  // 只把 caseId 传下去 —— `cases.json` 在共享 chunk 里，客户端自行 `getCase()`，
  // 绝不把整个 cases 数组当 prop 传（那会让每页各复制一份 512 KB 进 flight payload）。
  //
  // ⚠️ `<Suspense>` 不能省：`output:'export'` 下 `useSearchParams()` 只有包在
  // Suspense 边界内才允许出现在静态导出的页面里（否则 build 直接报错）。
  return (
    <Suspense fallback={null}>
      <CaseBench caseId={caseId} />
    </Suspense>
  );
}
