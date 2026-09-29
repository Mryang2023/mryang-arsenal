/**
 * 侧边栏高亮判定 —— 单独放成一个**纯函数**，为的是让校验层能直接把它当数据来跑
 * （见 `.verify/project-check.ts` 【13】⑤）。
 *
 * 不能写成 `pathname.startsWith(href)`：那是**裸前缀**匹配。`/archify`（出图服务）
 * 与 `/arch`（架构图谱）只差一串后缀，于是点「出图服务」时「架构图谱」跟着一起点亮 ——
 * 2026-09-23 就是这么被发现的。同样中招的还有任何「已有一个路由是另一个路由前缀」的组合。
 *
 * 正确判据是**路径边界**：等于本身，或以 `href + '/'` 开头。这样
 * `/rules/WEB-DTO-001` 仍然点亮「规则库」，而 `/archify` 不会再点亮 `/arch`。
 * 首页 `/` 单独处理 —— 否则它对任何路径都成立。
 */
/**
 * 「有子页的父项」—— 例外表。
 *
 * P0 拆四页之后 `/stack` 下面多出 `/stack/env` `/stack/run` `/stack/delivery`
 * 三条子路由。此时通用的前缀匹配会让 `/stack/env` 同时点亮「/stack」和
 * 「/stack/env」两项 —— 侧边栏出现两个选中态。这些父项改按**精确匹配自己**。
 * `/rules/WEB-DTO-001` 那类「详情页要点亮列表页」的场景不受影响 —— 它们不在此表。
 */
const LEAF_PARENTS = new Set(['/stack']);

export function isNavActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  if (href === '') return false;
  if (LEAF_PARENTS.has(href)) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
