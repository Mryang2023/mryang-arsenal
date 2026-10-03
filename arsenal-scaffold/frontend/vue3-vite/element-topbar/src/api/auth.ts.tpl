import http from './http';
import type { LoginResult, MenuNode, UserBrief } from '@/types/api';

export function login(username: string, password: string) {
  return http.post<never, LoginResult>('/auth/login', { username, password });
}

export function fetchMe() {
  return http.get<never, UserBrief>('/auth/me');
}

export function logout() {
  return http.post<never, void>('/auth/logout');
}

/**
 * 登录用户的菜单树（勾选了菜单模块的后端才有这个端点）。
 * silent：没有菜单模块时 404 属于预期，降级走静态路由，不弹全局错误。
 */
export function fetchMyMenus() {
  return http.get<never, MenuNode[]>('/auth/menus', { silent: true });
}
