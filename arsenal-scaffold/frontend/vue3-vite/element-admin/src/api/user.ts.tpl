import http from './http';
import type { PageResult, SysUser } from '@/types/api';

export function pageUsers(params: { page: number; pageSize: number; keyword?: string }) {
  return http.get<never, PageResult<SysUser>>('/users', { params });
}

/** 新用户由管理员给初始密码，首次登录后自行修改 */
export function createUser(data: {
  username: string;
  nickname: string;
  email: string;
  phone: string;
  password: string;
}) {
  return http.post<never, number>('/users', data);
}

export function updateUser(
  id: number,
  data: { nickname: string; email: string; phone: string; status?: number },
) {
  return http.put<never, void>(`/users/${id}`, data);
}

export function deleteUser(id: number) {
  return http.delete<never, void>(`/users/${id}`);
}

export function resetPassword(id: number, password: string) {
  return http.put<never, void>(`/users/${id}/password`, { password });
}

export function assignRoles(id: number, roleIds: number[]) {
  return http.put<never, void>(`/users/${id}/roles`, { roleIds });
}
