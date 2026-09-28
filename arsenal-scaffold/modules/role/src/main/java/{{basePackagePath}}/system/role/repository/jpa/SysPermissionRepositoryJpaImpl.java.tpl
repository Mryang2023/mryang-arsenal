package {{basePackage}}.system.role.repository.jpa;

import {{basePackage}}.system.role.domain.SysPermission;
import {{basePackage}}.system.role.repository.SysPermissionRepository;
import {{basePackage}}.system.role.repository.view.MenuLabelView;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.Collection;
import java.util.List;

/**
 * 权限仓储的 JPA 实现。三个查询全走 JPQL/原生 SQL，动态条件都不存在；
 * listMenuLabels 是对 sys_menu 的只读连接 —— 菜单的写路径仍只在 menu 模块，
 * 只读不构成模块依赖。
 */
@Repository
@Transactional(readOnly = true)
public class SysPermissionRepositoryJpaImpl implements SysPermissionRepository {

    private final EntityManager em;

    public SysPermissionRepositoryJpaImpl(EntityManager em) {
        this.em = em;
    }

    @Override
    public List<SysPermission> findAll() {
        return em.createQuery("SELECT p FROM SysPermission p ORDER BY p.id", SysPermission.class)
                .getResultList();
    }

    @Override
    public List<SysPermission> findByIds(Collection<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        return em.createQuery("SELECT p FROM SysPermission p WHERE p.id IN :ids", SysPermission.class)
                .setParameter("ids", ids)
                .getResultList();
    }

    @Override
    @SuppressWarnings("unchecked")
    public List<MenuLabelView> listMenuLabels() {
        List<Object[]> rows = em.createNativeQuery(
                        "SELECT id, label FROM sys_menu ORDER BY id")
                .getResultList();
        return rows.stream().map(r -> {
            MenuLabelView view = new MenuLabelView();
            view.setId(((Number) r[0]).longValue());
            view.setLabel((String) r[1]);
            return view;
        }).toList();
    }
}
