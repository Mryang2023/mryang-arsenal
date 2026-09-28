package {{basePackage}}.auth.repository;

import {{basePackage}}.auth.repository.view.LoginUserView;
import {{basePackage}}.auth.repository.view.MenuView;

import java.util.List;
import java.util.Optional;

/**
 * 认证侧只读查询。登录与菜单聚合要跨 sys_user / sys_role / sys_permission /
 * sys_menu 四张表 —— 这类连接查询收在 auth 自己的仓储里，而不借用
 * 各业务模块的仓储接口：auth 是基础设施，不依赖任何业务模块，
 * 单独装配也要能编译运行。
 *
 * 实现二选一（生成器按持久层选型装配其一）：repository/jpa 或 repository/mp。
 */
public interface AuthQueryRepository {

    /** 按用户名取登录视图（含密码哈希，仅供 BCrypt 校验）。 */
    Optional<LoginUserView> findLoginUser(String username);

    /** /api/auth/me 按 id 现读：停用、改名要立即生效，不能回显令牌内容。 */
    Optional<LoginUserView> findUserById(Long userId);

    /** 用户的启用角色码集合，用于 ADMIN 直通判断。 */
    List<String> listRoleCodes(Long userId);

    /** 用户经由角色获得的所有权限码（角色须启用）。 */
    List<String> listPermissionCodes(Long userId);

    /** 全量权限码：ADMIN 直通时不再逐角色累加。 */
    List<String> listAllPermissionCodes();

    /** 用户可见菜单（permission 为空或命中权限码；停用菜单排除），按 sort_no, id 排序。 */
    List<MenuView> listMenusForUser(Long userId);

    /** 全量启用菜单，供 ADMIN 直通，排序同上。 */
    List<MenuView> listAllMenus();
}
