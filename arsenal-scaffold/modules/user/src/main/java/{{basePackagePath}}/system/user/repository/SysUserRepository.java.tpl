package {{basePackage}}.system.user.repository;

import {{basePackage}}.system.user.domain.SysUser;

import java.util.List;
import java.util.Optional;

/**
 * 用户仓储接口。服务层只认这个接口 —— 持久层是 JPA 还是 MyBatis-Plus，
 * 由生成器装配 repository/jpa 或 repository/mp 下的实现，service 一行不改。
 *
 * 方法集合刻意收窄：仓储暴露的是「服务层需要的查询」，
 * 不是底层框架的全量能力。
 */
public interface SysUserRepository {

    Optional<SysUser> findById(Long id);

    Optional<SysUser> findByUsername(String username);

    boolean existsByUsername(String username);

    /** keyword 模糊匹配 username 或 nickname；按 id 倒序。 */
    List<SysUser> page(String keyword, long offset, int limit);

    long count(String keyword);

    /** 插入并回填自增 id。 */
    Long insert(SysUser user);

    /** 只更新基础资料列（nickname/email/phone/status），不动密码与用户名。 */
    void updateProfile(SysUser user);

    void updatePassword(Long id, String passwordHash);

    /** 物理删除，并连带清空 sys_user_role 绑定（同一事务内完成）。 */
    void deleteById(Long id);

    List<Long> listRoleIds(Long userId);

    /** 全量替换角色绑定：先删后插，调用方负责事务与角色 id 合法性。 */
    void replaceRoles(Long userId, List<Long> roleIds);
}
