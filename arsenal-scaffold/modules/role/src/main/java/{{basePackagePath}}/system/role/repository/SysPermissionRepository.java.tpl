package {{basePackage}}.system.role.repository;

import {{basePackage}}.system.role.domain.SysPermission;
import {{basePackage}}.system.role.repository.view.MenuLabelView;

import java.util.Collection;
import java.util.List;

/**
 * 权限码仓储接口。权限树按菜单分组展示需要 sys_menu 的只读标签 ——
 * 这里只读不写：菜单的写路径仍只在 menu 模块，跨表读不构成模块依赖。
 */
public interface SysPermissionRepository {

    /** 全量权限，按 id 排序 —— 权限树的输出顺序由此决定。 */
    List<SysPermission> findAll();

    /** 分配权限前校验 id 真实存在。 */
    List<SysPermission> findByIds(Collection<Long> ids);

    /** 权限树分组的菜单标签（跨 sys_menu 只读）。 */
    List<MenuLabelView> listMenuLabels();
}
