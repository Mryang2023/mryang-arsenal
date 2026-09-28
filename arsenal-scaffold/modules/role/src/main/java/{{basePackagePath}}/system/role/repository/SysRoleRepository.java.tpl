package {{basePackage}}.system.role.repository;

import {{basePackage}}.system.role.domain.SysRole;

import java.util.Collection;
import java.util.List;
import java.util.Optional;

/**
 * 角色仓储接口。服务层只认接口 —— 持久层实现由生成器装配
 * repository/jpa 或 repository/mp 其一，service 一行不改。
 */
public interface SysRoleRepository {

    Optional<SysRole> findById(Long id);

    boolean existsByCode(String code);

    /** keyword 模糊匹配 name 或 code；按 id 倒序。 */
    List<SysRole> page(String keyword, long offset, int limit);

    long count(String keyword);

    Long insert(SysRole role);

    /** 只更新 name/description/status；code 是权限体系的外部标识，不提供修改口子。 */
    void update(SysRole role);

    /** 物理删除，并连带清 sys_role_permission 与 sys_user_role（同一事务）。 */
    void deleteById(Long id);

    /** 给 user 模块分配角色时校验 id 真实存在。 */
    List<SysRole> findByIds(Collection<Long> ids);

    List<Long> listPermissionIds(Long roleId);

    /** 全量替换角色-权限绑定：先删后插，调用方负责事务与权限 id 合法性。 */
    void replacePermissions(Long roleId, List<Long> permissionIds);
}
