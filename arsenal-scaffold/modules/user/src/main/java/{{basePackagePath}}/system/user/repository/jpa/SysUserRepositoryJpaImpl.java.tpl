package {{basePackage}}.system.user.repository.jpa;

import {{basePackage}}.system.user.domain.SysUser;
import {{basePackage}}.system.user.domain.UserRoleBinding;
import {{basePackage}}.system.user.repository.SysUserRepository;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 用户仓储的 JPA 实现。动态分页用 JPQL 手拼条件（与 jdbc 版 UserDao 的
 * whereOf 同一思路）—— 这里是自定义接口，不是 JpaRepository，Specification 用不上。
 *
 * 事务只读方法标 readOnly：Hibernate 关脏检查，列表页不再逐行比对快照。
 */
@Repository
@Transactional(readOnly = true)
public class SysUserRepositoryJpaImpl implements SysUserRepository {

    private final EntityManager em;

    public SysUserRepositoryJpaImpl(EntityManager em) {
        this.em = em;
    }

    @Override
    public Optional<SysUser> findById(Long id) {
        return Optional.ofNullable(em.find(SysUser.class, id));
    }

    @Override
    public Optional<SysUser> findByUsername(String username) {
        List<SysUser> users = em.createQuery(
                        "SELECT u FROM SysUser u WHERE u.username = :username", SysUser.class)
                .setParameter("username", username)
                .getResultList();
        return users.stream().findFirst();
    }

    @Override
    public boolean existsByUsername(String username) {
        Long n = em.createQuery(
                        "SELECT COUNT(u) FROM SysUser u WHERE u.username = :username", Long.class)
                .setParameter("username", username)
                .getSingleResult();
        return n != null && n > 0;
    }

    @Override
    @SuppressWarnings("unchecked")
    public List<SysUser> page(String keyword, long offset, int limit) {
        StringBuilder jpql = new StringBuilder("SELECT u FROM SysUser u WHERE 1 = 1");
        Map<String, Object> params = new HashMap<>();
        appendKeyword(jpql, params, keyword);
        jpql.append(" ORDER BY u.id DESC");
        var query = em.createQuery(jpql.toString(), SysUser.class)
                .setFirstResult((int) offset)
                .setMaxResults(limit);
        params.forEach(query::setParameter);
        return query.getResultList();
    }

    @Override
    public long count(String keyword) {
        StringBuilder jpql = new StringBuilder("SELECT COUNT(u) FROM SysUser u WHERE 1 = 1");
        Map<String, Object> params = new HashMap<>();
        appendKeyword(jpql, params, keyword);
        var query = em.createQuery(jpql.toString(), Long.class);
        params.forEach(query::setParameter);
        Long n = query.getSingleResult();
        return n == null ? 0 : n;
    }

    /** keyword 同时模糊 username 与 nickname —— 列表页只有一个搜索框 */
    private static void appendKeyword(StringBuilder jpql, Map<String, Object> params, String keyword) {
        if (keyword != null && !keyword.isBlank()) {
            jpql.append(" AND (LOWER(u.username) LIKE :kw OR LOWER(u.nickname) LIKE :kw)");
            params.put("kw", "%" + keyword.toLowerCase() + "%");
        }
    }

    @Override
    @Transactional
    public Long insert(SysUser user) {
        em.persist(user);
        // IDENTITY 主键在 persist 时即回填 —— 不必 flush 后再取
        return user.getId();
    }

    @Override
    @Transactional
    public void updateProfile(SysUser user) {
        // 用户名不出现在更新集合里：username 是登录标识，接口层就不提供改它的口子
        em.createQuery("UPDATE SysUser u SET u.nickname = :nickname, u.email = :email,"
                        + " u.phone = :phone, u.status = :status, u.updateTime = :now"
                        + " WHERE u.id = :id")
                .setParameter("nickname", user.getNickname())
                .setParameter("email", user.getEmail())
                .setParameter("phone", user.getPhone())
                .setParameter("status", user.getStatus())
                .setParameter("now", user.getUpdateTime())
                .setParameter("id", user.getId())
                .executeUpdate();
    }

    @Override
    @Transactional
    public void updatePassword(Long id, String passwordHash) {
        em.createQuery("UPDATE SysUser u SET u.password = :password, u.updateTime = :now"
                        + " WHERE u.id = :id")
                .setParameter("password", passwordHash)
                .setParameter("now", LocalDateTime.now())
                .setParameter("id", id)
                .executeUpdate();
    }

    @Override
    @Transactional
    public void deleteById(Long id) {
        // 先清绑定再删用户：同一条物理删除路径，绑定行不留悬挂
        em.createQuery("DELETE FROM UserRoleBinding b WHERE b.userId = :userId")
                .setParameter("userId", id)
                .executeUpdate();
        em.createQuery("DELETE FROM SysUser u WHERE u.id = :id")
                .setParameter("id", id)
                .executeUpdate();
    }

    @Override
    public List<Long> listRoleIds(Long userId) {
        return em.createQuery(
                        "SELECT b.roleId FROM UserRoleBinding b WHERE b.userId = :userId", Long.class)
                .setParameter("userId", userId)
                .getResultList();
    }

    @Override
    @Transactional
    public void replaceRoles(Long userId, List<Long> roleIds) {
        em.createQuery("DELETE FROM UserRoleBinding b WHERE b.userId = :userId")
                .setParameter("userId", userId)
                .executeUpdate();
        LocalDateTime now = LocalDateTime.now();
        for (Long roleId : roleIds) {
            UserRoleBinding binding = new UserRoleBinding();
            binding.setUserId(userId);
            binding.setRoleId(roleId);
            binding.setCreateTime(now);
            em.persist(binding);
        }
    }
}
