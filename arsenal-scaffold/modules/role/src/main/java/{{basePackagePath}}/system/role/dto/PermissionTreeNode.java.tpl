package {{basePackage}}.system.role.dto;

import java.util.ArrayList;
import java.util.List;

/**
 * 权限树节点。两层结构：菜单分组（type=menu，id 是菜单 id）+
 * 权限叶子（type=perm，id 是权限 id）。前端提交的必须是叶子 id ——
 * 绑定表里只有 sys_role_permission，菜单 id 不该进任何绑定。
 */
public record PermissionTreeNode(Long id, String label, String code, String type,
                                 List<PermissionTreeNode> children) {

    public static PermissionTreeNode menuGroup(Long menuId, String label) {
        return new PermissionTreeNode(menuId, label, null, "menu", new ArrayList<>());
    }

    public static PermissionTreeNode permissionLeaf(Long id, String label, String code) {
        return new PermissionTreeNode(id, label, code, "perm", new ArrayList<>());
    }
}
