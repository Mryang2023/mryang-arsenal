import type { RouteRecordRaw } from 'vue-router';

/**
 * 静态路由表。两个用途：
 * 1. 静态菜单变体：整张表就是最终路由（勾选菜单模块之前的形态也能完整可用）；
 * 2. 动态菜单变体的兜底：菜单接口失败/为空时回退到这张表，页面照常可达。
 *
 * meta.perm 是进入该页面需要的权限码；没有勾选菜单模块的后端不做权限校验，
 * 前端这里的 perm 只用于渲染侧边栏与提示，真正的拦截在后端。
 */
export const ADMIN_CHILDREN: RouteRecordRaw[] = [
  {
    path: 'home',
    name: 'home',
    component: () => import('@/views/home/index.vue'),
    meta: { title: '首页' },
  },
  {
    path: 'system/user',
    name: 'system-user',
    component: () => import('@/views/system/user/index.vue'),
    meta: { title: '用户管理', perm: 'sys:user:list' },
  },
  {
    path: 'system/role',
    name: 'system-role',
    component: () => import('@/views/system/role/index.vue'),
    meta: { title: '角色管理', perm: 'sys:role:list' },
  },
  {
    path: 'system/menu',
    name: 'system-menu',
    component: () => import('@/views/system/menu/index.vue'),
    meta: { title: '菜单管理', perm: 'sys:menu:list' },
  },
];

export const LAYOUT_PATH = '/';

export const LOGIN_ROUTE: RouteRecordRaw = {
  path: '/login',
  name: 'login',
  component: () => import('@/views/login/index.vue'),
  meta: { title: '登录' },
};

/** 静态变体的完整路由表 */
export function staticRoutes(): RouteRecordRaw[] {
  return [
    LOGIN_ROUTE,
    {
      path: LAYOUT_PATH,
      component: () => import('@/layout/AdminLayout.vue'),
      children: ADMIN_CHILDREN,
    },
    { path: '/:pathMatch(.*)*', redirect: LAYOUT_PATH },
  ];
}

/** 动态变体只预置骨架：Layout 里先挂首页，其余路由等菜单回来再挂 */
export function dynamicSkeletonRoutes(): RouteRecordRaw[] {
  return [
    LOGIN_ROUTE,
    {
      path: LAYOUT_PATH,
      name: 'layout',
      component: () => import('@/layout/AdminLayout.vue'),
      children: [ADMIN_CHILDREN[0]],
    },
    { path: '/:pathMatch(.*)*', redirect: LAYOUT_PATH },
  ];
}
