import { createRouter, createWebHistory } from 'vue-router';
import type { RouteRecordRaw } from 'vue-router';
import { dynamicSkeletonRoutes } from './routes';
import { installGuard } from './guard';

/**
 * 路由入口 · 动态变体：勾选了「菜单模块」时由生成器装配这个文件。
 * 骨架只含登录页与布局（布局里先挂首页）；其余路由等守卫拉到菜单树后
 * 由 dynamic-routes 按注册表挂接 —— 菜单接口失败时守卫拿不到菜单，
 * 照旧只有骨架路由，侧边栏会回退静态菜单，页面可达性由后端菜单树保证。
 */
const router = createRouter({
  history: createWebHistory(),
  routes: dynamicSkeletonRoutes() as RouteRecordRaw[],
});

import { registerDynamicRoutes } from './dynamic-routes';
// 注册函数在这里注入：静态变体不装配本文件，guard 里因此不需要对 dynamic-routes 的依赖
installGuard(router, { dynamic: true, registerDynamicRoutes });

export default router;
