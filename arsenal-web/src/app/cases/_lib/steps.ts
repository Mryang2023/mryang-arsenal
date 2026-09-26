/**
 * 三层路由的「我在第几步」—— 数据与普通函数放在这里，组件在 `step-rail.tsx`。
 *
 * 拆开是为了让 `.verify` 能**直接 import 纯数据**（它跑在 node 里，不该去碰 JSX）：
 * 「三步的 href 是否与真实路由一致」是一条会被写坏的契约 ——
 * 珠链上写 `/cases/x/detail` 而实际目录叫 `[sliceId]`，页面点过去就是 404，
 * 而 404 在静态导出站上长得跟白屏一样。这类错只能靠断言抓。
 */

export type StepId = 'symptom' | 'params' | 'slice';

export const STEPS: { id: StepId; label: string; n: string }[] = [
  { id: 'symptom', label: '挑症状', n: '①' },
  { id: 'params', label: '拧参数', n: '②' },
  { id: 'slice', label: '拿方案', n: '③' },
];

export const STEP_LABEL: Record<StepId, string> = {
  symptom: '挑症状',
  params: '拧参数',
  slice: '拿方案',
};

/** 三层都在 `/cases` 下 —— 与 `src/app/cases/**` 的目录一致 */
export const CASES_ROOT = '/cases';

/**
 * L3（`/cases/[caseId]/[sliceId]`）是否已真正产出。
 *
 * 这是**事实**不是开关：D-1 已拍板做真静态路由，但 61 个切片页排次夜。
 * 置 true 之前必须先建 `app/cases/[caseId]/[sliceId]/page.tsx`，
 * 否则珠链第 3 步会指向一个不存在的地址 —— 死链比「未开通」三个字糟。
 * `.verify/case-check.ts` 断言它必须等于目录是否真的存在。
 */
export const L3_ROUTE_READY = false;

/** L3 路由目录（相对 `src/app`）—— 只有 L3_ROUTE_READY 为 true 时珠链第 3 步才可点 */
export const L3_ROUTE_DIR = 'cases/[caseId]/[sliceId]';
export const L2_ROUTE_DIR = 'cases/[caseId]';

export interface StepCtx {
  caseId?: string;
  sliceId?: string;
}

/**
 * 某一步的落地地址。**不可达就返回 null** —— 珠链把它渲染成不可点，
 * 而不是渲染成一个点了会 404 的链接。
 */
export function stepHref(id: StepId, ctx: StepCtx = {}): string | null {
  if (id === 'symptom') return `${CASES_ROOT}/`;
  if (id === 'params') return ctx.caseId ? `${CASES_ROOT}/${ctx.caseId}/` : null;
  if (!L3_ROUTE_READY) return null;
  return ctx.caseId && ctx.sliceId ? `${CASES_ROOT}/${ctx.caseId}/${ctx.sliceId}/` : null;
}
