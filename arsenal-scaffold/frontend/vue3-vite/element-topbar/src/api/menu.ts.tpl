import http from './http';
import type { MenuTreeNode } from '@/types/api';

export function menuTree() {
  return http.get<never, MenuTreeNode[]>('/menus/tree');
}

export function createMenu(data: Partial<MenuTreeNode>) {
  return http.post<never, number>('/menus', data);
}

export function updateMenu(id: number, data: Partial<MenuTreeNode>) {
  return http.put<never, void>(`/menus/${id}`, data);
}

export function deleteMenu(id: number) {
  return http.delete<never, void>(`/menus/${id}`);
}
