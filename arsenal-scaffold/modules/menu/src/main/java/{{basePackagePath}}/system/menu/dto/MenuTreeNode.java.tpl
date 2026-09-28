package {{basePackage}}.system.menu.dto;

import {{basePackage}}.system.menu.domain.SysMenu;

import java.util.ArrayList;
import java.util.List;

/**
 * 管理端菜单树节点。含 parentId/sortNo/status 等管理字段 ——
 * 与登录侧的 auth.dto.MenuNode 是两份独立契约：管理端要能编辑，
 * 登录侧只需要渲染；合用一个类，想删管理字段时就得动登录侧。
 */
public record MenuTreeNode(Long id, Long parentId, String label, String path, String icon,
                           Integer sortNo, String permission, Integer status,
                           List<MenuTreeNode> children) {

    public static MenuTreeNode from(SysMenu menu) {
        return new MenuTreeNode(menu.getId(), menu.getParentId(), menu.getLabel(), menu.getPath(),
                menu.getIcon(), menu.getSortNo(), menu.getPermission(), menu.getStatus(),
                new ArrayList<>());
    }
}
