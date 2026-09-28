package {{basePackage}}.system.role.service;

import {{basePackage}}.common.PageResult;
import {{basePackage}}.system.role.dto.PermissionTreeNode;
import {{basePackage}}.system.role.dto.RoleCreateRequest;
import {{basePackage}}.system.role.dto.RoleQuery;
import {{basePackage}}.system.role.dto.RoleResponse;
import {{basePackage}}.system.role.dto.RolePermissionAssignRequest;
import {{basePackage}}.system.role.dto.RoleUpdateRequest;

import java.util.List;

/**
 * 角色业务接口。控制器与实现之间隔着它 —— 测试替换、换持久层时，
 * 上层一行不改。方法集合就是页面上真实存在的操作。
 */
public interface SysRoleService {

    Long create(RoleCreateRequest req);

    RoleResponse getById(Long id);

    PageResult<RoleResponse> page(RoleQuery query);

    void update(Long id, RoleUpdateRequest req);

    /** 物理删除；内置 ADMIN 角色由 service 层拦下。 */
    void delete(Long id);

    /** 角色已授予的权限 id 集合。 */
    List<Long> listPermissionIds(Long id);

    /** 全量替换角色的权限绑定。 */
    void assignPermissions(Long id, RolePermissionAssignRequest req);

    /** 权限树：菜单分组 + 权限叶子，角色授权页复选框的数据源。 */
    List<PermissionTreeNode> permissionTree();
}
