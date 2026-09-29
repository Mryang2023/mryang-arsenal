import http from './http';
import type { PageResult, PermissionNode, Role } from '@/types/api';

export function pageRoles(params: { page: number; pageSize: number; keyword?: string }) {
  return http.get<never, PageResult<Role>>('/roles', { params });
}

export function createRole(data: { name: string; code: string; description: string }) {
  return http.post<never, number>('/roles', data);
}

export function updateRole(id: number, data: { name: string; code: string; description: string }) {
  return http.put<never, void>(`/roles/${id}`, data);
}

export function deleteRole(id: number) {
  return http.delete<never, void>(`/roles/${id}`);
}

/** 角色已勾选的权限 id 列表（只有叶子） */
export function rolePermissionIds(id: number) {
  return http.get<never, number[]>(`/roles/${id}/permissions`);
}

/** 保存角色权限：只传叶子（按钮权限）的 id，分组由后端按叶子归并 */
export function assignRolePermissions(id: number, permissionIds: number[]) {
  return http.put<never, void>(`/roles/${id}/permissions`, { permissionIds });
}

export function permissionTree() {
  return http.get<never, PermissionNode[]>('/permissions/tree');
}
