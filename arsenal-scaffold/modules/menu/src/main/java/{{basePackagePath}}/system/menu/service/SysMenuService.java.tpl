package {{basePackage}}.system.menu.service;

import {{basePackage}}.system.menu.dto.MenuSaveRequest;
import {{basePackage}}.system.menu.dto.MenuTreeNode;
import {{basePackage}}.system.menu.dto.MenuUpdateRequest;

import java.util.List;

/**
 * 菜单业务接口。控制器与实现之间隔着它 —— 测试替换、换持久层时，
 * 上层一行不改。方法集合就是页面上真实存在的操作。
 */
public interface SysMenuService {

    /** 全量菜单树（含停用）：停用的菜单要先能看见才能重新启用。 */
    List<MenuTreeNode> tree();

    Long create(MenuSaveRequest req);

    void update(Long id, MenuUpdateRequest req);

    /** 物理删除；有子菜单时由 service 层拒绝。 */
    void delete(Long id);
}
