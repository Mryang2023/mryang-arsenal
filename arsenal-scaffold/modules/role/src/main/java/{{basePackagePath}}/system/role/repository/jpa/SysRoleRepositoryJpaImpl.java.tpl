package {{basePackage}}.system.role.repository.jpa;

import {{basePackage}}.system.role.domain.RolePermissionBinding;
import {{basePackage}}.system.role.domain.SysRole;
import {{basePackage}}.system.role.repository.SysRoleRepository;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 角色仓储的 JPA 实现。动态分页用 JPQL 手拼条件（与 user 模块同一思路）；
 * 这里是自定义接口，不是 JpaRepository，Specification 用不上不硬凑。
 */
@Repository
@Transactional(readOnly = true)
public class SysRoleRepositoryJpaImpl implements SysRoleRepository {

    private final EntityManager em;

    public SysRoleRepositoryJpaImpl(EntityManager em) {
        this.em = em;
    }

    @Override
    public Optional<SysRole> findById(Long id) {
        return Optional.ofNullable(em.find(SysRole.class, id));
    }

    @Override
    public boolean existsByCode(String code) {
        Long n = em.createQuery(
                        "SELECT COUNT(r) FROM SysRole r WHERE r.code = :code", Long.class)
                .setParameter("code", code)
                .getSingleResult();
        return n != null && n > 0;
    }

    @Override
    @SuppressWarnings("unchecked")
    public List<SysRole> page(String keyword, long offset, int limit) {
        StringBuilder jpql = new StringBuilder("SELECT r FROM SysRole r WHERE 1 = 1");
        Map<String, Object> params = new HashMap<>();
        appendKeyword(jpql, params, keyword);
        jpql.append(" ORDER BY r.id DESC");
        var query = em.createQuery(jpql.toString(), SysRole.class)
                .setFirstResult((int) offset)
                .setMaxResults(limit);
        params.forEach(query::setParameter);
        return query.getResultList();
    }

    @Override
    public long count(String keyword) {
        StringBuilder jpql = new StringBuilder("SELECT COUNT(r) FROM SysRole r WHERE 1 = 1");
        Map<String, Object> params = new HashMap<>();
        appendKeyword(jpql, params, keyword);
        var query = em.createQuery(jpql.toString(), Long.class);
        params.forEach(query::setParameter);
        Long n = query.getSingleResult();
        return n == null ? 0 : n;
    }

    /** keyword 同时模糊 name 与 code —— 角色列表页只有一个搜索框 */
    private static void appendKeyword(StringBuilder jpql, Map<String, Object> params, String keyword) {
        if (keyword != null && !keyword.isBlank()) {
            jpql.append(" AND (LOWER(r.name) LIKE :kw OR LOWER(r.code) LIKE :kw)");
            params.put("kw", "%" + keyword.toLowerCase() + "%");
        }
    }

    @Override
    @Transactional
    public Long insert(SysRole role) {
        em.persist(role);
        return role.getId();
    }

    @Override
    @Transactional
    public void update(SysRole role) {
        // code 不在更新集合里：编码是权限体系的外部标识，仓储层就不提供改它的口子
        em.createQuery("UPDATE SysRole r SET r.name = :name, r.description = :description,"
                        + " r.status = :status, r.updateTime = :now WHERE r.id = :id")
                .setParameter("name", role.getName())
                .setParameter("description", role.getDescription())
                .setParameter("status", role.getStatus())
                .setParameter("now", role.getUpdateTime())
                .setParameter("id", role.getId())
                .executeUpdate();
    }

    /**
     * 物理删除并连带清两张绑定表（同一事务）：
     * sys_role_permission 的绑定实体归本模块；sys_user_role 归 user 模块 ——
     * 跨表清理放在这里是因为「删角色」的入口在 role 模块，悬挂绑定对谁都没意义。
     */
    @Override
    @Transactional
    public void deleteById(Long id) {
        em.createQuery("DELETE FROM RolePermissionBinding b WHERE b.roleId = :roleId")
                .setParameter("roleId", id)
                .executeUpdate();
        em.createNativeQuery("DELETE FROM sys_user_role WHERE role_id = ?")
                .setParameter(1, id)
                .executeUpdate();
        em.createQuery("DELETE FROM SysRole r WHERE r.id = :id")
                .setParameter("id", id)
                .executeUpdate();
    }

    @Override
    public List<SysRole> findByIds(Collection<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        return em.createQuery("SELECT r FROM SysRole r WHERE r.id IN :ids", SysRole.class)
                .setParameter("ids", ids)
                .getResultList();
    }

    @Override
    public List<Long> listPermissionIds(Long roleId) {
        return em.createQuery(
                        "SELECT b.permissionId FROM RolePermissionBinding b WHERE b.roleId = :roleId",
                        Long.class)
                .setParameter("roleId", roleId)
                .getResultList();
    }

    @Override
    @Transactional
    public void replacePermissions(Long roleId, List<Long> permissionIds) {
        em.createQuery("DELETE FROM RolePermissionBinding b WHERE b.roleId = :roleId")
                .setParameter("roleId", roleId)
                .executeUpdate();
        LocalDateTime now = LocalDateTime.now();
        for (Long permissionId : permissionIds) {
            RolePermissionBinding binding = new RolePermissionBinding();
            binding.setRoleId(roleId);
            binding.setPermissionId(permissionId);
            binding.setCreateTime(now);
            em.persist(binding);
        }
    }
}
