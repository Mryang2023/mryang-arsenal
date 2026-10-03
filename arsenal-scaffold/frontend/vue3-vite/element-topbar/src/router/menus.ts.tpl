import { ADMIN_CHILDREN } from './routes';
import type { SideMenuItem } from '@/types/api';

export type { SideMenuItem };

/**
 * 静态菜单：直接从路由表推导。没有菜单模块的后端，界面照样完整可用 ——
 * 「动态菜单是增强，不是前提」，这个兜底让两种后端形态共用同一套布局。
 */
export function sideMenus(): SideMenuItem[] {
  return ADMIN_CHILDREN.filter((r) => r.path !== 'home').map((r) => ({
    label: (r.meta?.title as string) ?? String(r.path),
    icon: 'Menu',
    path: `/${String(r.path)}`,
  }));
}
