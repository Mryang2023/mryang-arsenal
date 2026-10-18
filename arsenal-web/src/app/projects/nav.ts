/**
 * 项目工坊 · 导航菜单数据唯一出处（工坊棒2）。
 *
 * 这是「项目工坊」一级菜单组的**唯一数据来源**：Shell.tsx 只消费，不在这里
 * 另排一张表。三个子项 = 项目管理 / 项目侦察 / 质检台，各有真实路由。
 *
 * 双注册约定（仿 command-center 的 MenuCatalogService.BUILTIN 覆盖前端
 * NAV_ITEMS）：本仓没有后端菜单目录，等价机制是 `project-check.ts` 的导航
 * 契约会扫这份文件，断言每个 href 都指向真实 page.tsx（含新增的 /projects）。
 * 所以改菜单只改这里，校验层自动覆盖 —— 漏一个子项 / 指错地址都会红。
 */
export interface ProjectNavChild {
  href: string;
  label: string;
  glyph: string;
  count: number;
}

export const PROJECT_NAV: ProjectNavChild[] = [
  { href: '/projects', label: '项目管理', glyph: '◧', count: 0 },
  { href: '/autopsy', label: '项目侦察', glyph: '▧', count: 0 },
  { href: '/qa', label: '质检台', glyph: '⚗', count: 0 },
];

/** 组标题（Shell 渲染分组标题用，不单独成链接）。 */
export const PROJECT_GROUP = { label: '项目工坊', glyph: '⚙', count: 0 } as const;
