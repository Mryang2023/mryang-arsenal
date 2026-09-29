/**
 * 与后端的类型契约。字段名与后端 DTO 逐字对齐 ——
 * 这里多写一个后端没有的字段，联调时就是一次「response 里怎么是 undefined」。
 */

/** 后端统一响应包装：code=0 才算成功 */
export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}

/** 后端 PageResult：字段是 page/pageSize（不是 size），对齐 PageResult.java */
export interface PageResult<T> {
  page: number;
  pageSize: number;
  total: number;
  list: T[];
}

/** 登录/当前用户（MeResponse.UserBrief 同构） */
export interface UserBrief {
  id: number;
  username: string;
  nickname: string;
}

export interface LoginResult {
  token: string;
  user: UserBrief;
}

export interface SysUser {
  id: number;
  username: string;
  nickname: string;
  email: string;
  phone: string;
  /** 1 启用 / 0 停用 */
  status: number;
  createdAt: string;
}

export interface Role {
  id: number;
  name: string;
  code: string;
  description: string;
  status: number;
}

/** 权限树节点：分组节点 = 菜单，叶子 = 按钮权限；提交保存只传叶子的 id */
export interface PermissionNode {
  id: number;
  label: string;
  code: string;
  type: 'group' | 'leaf';
  children: PermissionNode[];
}

/** 登录侧菜单节点（/api/auth/menus）：只够渲染，不含管理字段 */
export interface MenuNode {
  id: number;
  label: string;
  path: string;
  icon: string;
  permission: string;
  children: MenuNode[];
}

/** 管理端菜单树节点（/api/menus/tree）：带编辑所需的管理字段 */
export interface MenuTreeNode {
  id: number;
  parentId: number;
  label: string;
  path: string;
  icon: string;
  sortNo: number;
  permission: string;
  /** 1 启用 / 0 停用 */
  status: number;
  children: MenuTreeNode[];
}
