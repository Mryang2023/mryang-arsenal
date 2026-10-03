import type { Router } from 'vue-router';
import type { MenuNode } from '@/types/api';
import { useAuthStore } from '@/stores/auth';

/**
 * 路由守卫。三段：
 *  1. 去登录页：已登录则回首页（登录页不该被再次看到）；
 *  2. 没凭据：去登录页并带上 redirect，登录成功后原路跳回；
 *  3. 有凭据但身份没加载：拉一次 /api/auth/me + 菜单，失败则凭据已失效，
 *     清本地回登录页 —— 这里绝不能放行，否则页面在半初始化状态下渲染。
 *
 * dynamic = true 时 refreshIdentity 拿到菜单后注册动态路由，并以
 * fullPath 重进一次：新路由必须在下一次匹配时才生效。
 */
export function installGuard(
  router: Router,
  options: {
    dynamic?: boolean;
    /** 动态变体传入注册函数；静态变体没有 dynamic-routes 文件，不传也不会被调用 */
    registerDynamicRoutes?: (router: Router, menus: MenuNode[]) => void;
  } = {}
) {
  let dynamicRegistered = false;
  router.beforeEach(async (to) => {
    const auth = useAuthStore();
    if (to.path === '/login') {
      return auth.isLoggedIn ? { path: '/' } : true;
    }
    if (!auth.isLoggedIn) {
      return { path: '/login', query: { redirect: to.fullPath } };
    }
    if (!auth.user) {
      try {
        await auth.refreshIdentity();
      } catch {
        auth.clearLocal();
        return { path: '/login' };
      }
      // 动态路由的注册函数由「动态变体的路由入口」注入（见 index.dynamic.ts）——
      // 不在这里 import('./dynamic-routes')：静态变体不含该文件，
      // 静态 import 会让 vue-tsc 报 TS2307，生成的项目 npm run build 直接失败
      if (
        options.dynamic &&
        options.registerDynamicRoutes &&
        !dynamicRegistered &&
        auth.menus.length > 0
      ) {
        options.registerDynamicRoutes(router, auth.menus);
        dynamicRegistered = true;
        return to.fullPath;
      }
    }
    return true;
  });
}
