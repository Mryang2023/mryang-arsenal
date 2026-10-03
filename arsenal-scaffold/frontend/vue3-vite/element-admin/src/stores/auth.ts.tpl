import { defineStore } from 'pinia';
import { fetchMe, fetchMyMenus, login as apiLogin, logout as apiLogout } from '@/api/auth';
import type { MenuNode, UserBrief } from '@/types/api';

const TOKEN_KEY = 'admin_token';

/** 从菜单树里收集全部权限码（按钮权限是叶子节点的 permission 字段） */
function collectPerms(menus: MenuNode[], into: Set<string>) {
  for (const m of menus) {
    if (m.permission) into.add(m.permission);
    if (m.children?.length) collectPerms(m.children, into);
  }
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem(TOKEN_KEY) ?? '',
    user: null as UserBrief | null,
    /** 登录用户的菜单树（动态菜单数据源；未勾选菜单模块时为空数组） */
    menus: [] as MenuNode[],
    /** 按钮权限码集合，v-perm 指令从这里查 */
    perms: new Set<string>(),
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
  },
  actions: {
    async login(username: string, password: string) {
      const res = await apiLogin(username, password);
      this.token = res.token;
      this.user = res.user;
      localStorage.setItem(TOKEN_KEY, res.token);
    },
    /** 刷新当前用户与权限。菜单接口 404 说明没勾菜单模块：静默降级为空，走静态路由 */
    async refreshIdentity() {
      this.user = await fetchMe();
      if (this.menus.length === 0) {
        try {
          this.menus = await fetchMyMenus();
        } catch {
          this.menus = [];
        }
        const perms = new Set<string>();
        collectPerms(this.menus, perms);
        this.perms = perms;
      }
    },
    async logout() {
      try {
        await apiLogout();
      } catch {
        // 后端登出失败不阻塞本地登出：本地凭据必须清掉
      }
      this.clearLocal();
    },
    /** 只清本地不调后端（401 时用：凭据已失效，再调 logout 只会再吃一个 401） */
    clearLocal() {
      this.token = '';
      this.user = null;
      this.menus = [];
      this.perms = new Set();
      localStorage.removeItem(TOKEN_KEY);
    },
  },
});
