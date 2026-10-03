import { createRouter, createWebHistory } from 'vue-router';
import { staticRoutes } from './routes';
import { installGuard } from './guard';

/**
 * 路由入口 · 静态变体：未勾选「菜单模块」时由生成器装配这个文件。
 * 菜单从静态路由表推导，界面完整可用；换成动态菜单只需替换本文件与 menus.ts。
 */
const router = createRouter({
  history: createWebHistory(),
  routes: staticRoutes(),
});

installGuard(router);

export default router;
