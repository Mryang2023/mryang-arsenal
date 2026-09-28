package {{basePackage}}.system.menu.repository.jpa;

import {{basePackage}}.system.menu.domain.SysMenu;
import {{basePackage}}.system.menu.repository.SysMenuRepository;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * 菜单仓储的 JPA 实现。全量排序走 JPQL ORDER BY（sortNo, id）——
 * 排序在 SQL 收口，树组装只管挂接不管排序，两处各写一份迟早对不上。
 */
@Repository
@Transactional(readOnly = true)
public class SysMenuRepositoryJpaImpl implements SysMenuRepository {

    private final EntityManager em;

    public SysMenuRepositoryJpaImpl(EntityManager em) {
        this.em = em;
    }

    @Override
    public Optional<SysMenu> findById(Long id) {
        return Optional.ofNullable(em.find(SysMenu.class, id));
    }

    @Override
    public List<SysMenu> findAll() {
        return em.createQuery(
                        "SELECT m FROM SysMenu m ORDER BY m.sortNo, m.id", SysMenu.class)
                .getResultList();
    }

    @Override
    public boolean existsByParentId(Long parentId) {
        Long n = em.createQuery(
                        "SELECT COUNT(m) FROM SysMenu m WHERE m.parentId = :parentId", Long.class)
                .setParameter("parentId", parentId)
                .getSingleResult();
        return n != null && n > 0;
    }

    @Override
    @Transactional
    public Long insert(SysMenu menu) {
        em.persist(menu);
        return menu.getId();
    }

    @Override
    @Transactional
    public void update(SysMenu menu) {
        em.createQuery("UPDATE SysMenu m SET m.parentId = :parentId, m.label = :label,"
                        + " m.path = :path, m.icon = :icon, m.sortNo = :sortNo,"
                        + " m.permission = :permission, m.status = :status,"
                        + " m.updateTime = :now WHERE m.id = :id")
                .setParameter("parentId", menu.getParentId())
                .setParameter("label", menu.getLabel())
                .setParameter("path", menu.getPath())
                .setParameter("icon", menu.getIcon())
                .setParameter("sortNo", menu.getSortNo())
                .setParameter("permission", menu.getPermission())
                .setParameter("status", menu.getStatus())
                .setParameter("now", menu.getUpdateTime())
                .setParameter("id", menu.getId())
                .executeUpdate();
    }

    @Override
    @Transactional
    public void deleteById(Long id) {
        em.createQuery("DELETE FROM SysMenu m WHERE m.id = :id")
                .setParameter("id", id)
                .executeUpdate();
    }
}
