import type { Router } from 'vue-router';
import type { RouteComponent } from 'vue-router';
import type { MenuNode } from '@/types/api';

/**
 * 菜单 path → 页面组件 的注册表。
 * 后端菜单树只说「有这一页」，组件落在这里 —— path 对不上的菜单项不注册路由，
 * 侧边栏仍会渲染（点击无跳转），不会因为后端多配了一个菜单就构建失败。
 */
const REGISTRY: Record<string, () => Promise<RouteComponent>> = {
  '/home': () => import('@/views/home/index.vue'),
  '/system/user': () => import('@/views/system/user/index.vue'),
  '/system/role': () => import('@/views/system/role/index.vue'),
  '/system/menu': () => import('@/views/system/menu/index.vue'),
};

function flatten(menus: MenuNode[]): MenuNode[] {
  return menus.flatMap((m) => [m, ...(m.children?.length ? flatten(m.children) : [])]);
}

/** 把菜单树映射成路由，挂到布局路由下。path 必须以 / 开头才进注册表匹配 */
export function registerDynamicRoutes(router: Router, menus: MenuNode[]) {
  for (const node of flatten(menus)) {
    if (!node.path || !node.path.startsWith('/')) continue;
    const loader = REGISTRY[node.path];
    if (!loader) continue;
    router.addRoute('layout', {
      path: node.path.replace(/^\//, ''),
      name: `dyn${node.path}`,
      component: loader,
      meta: { title: node.label, perm: node.permission || undefined },
    });
  }
}
