import { useAuthStore } from '@/stores/auth';
import { ADMIN_CHILDREN } from './routes';
import type { SideMenuItem } from '@/types/api';

/**
 * 动态菜单：登录后由守卫把 /api/auth/menus 的结果放进 auth store，
 * 这里把 MenuNode 树映射成侧边栏条目。菜单为空（后端没勾菜单模块 /
 * 接口失败）时回退到静态路由表推导 —— 导航永远有东西可渲染。
 * 注意本文件与 menus.ts 同名导出，生成器按选型二选一装配。
 */
export function sideMenus(): SideMenuItem[] {
  const auth = useAuthStore();
  if (auth.menus.length === 0) {
    return ADMIN_CHILDREN.filter((r) => r.path !== 'home').map((r) => ({
      label: (r.meta?.title as string) ?? String(r.path),
      icon: 'Menu',
      path: `/${String(r.path)}`,
    }));
  }
  const map = (nodes: typeof auth.menus): SideMenuItem[] =>
    nodes.map((n) => ({
      label: n.label,
      icon: n.icon || undefined,
      path: n.path || undefined,
      children: n.children?.length ? map(n.children) : undefined,
    }));
  return map(auth.menus);
}
