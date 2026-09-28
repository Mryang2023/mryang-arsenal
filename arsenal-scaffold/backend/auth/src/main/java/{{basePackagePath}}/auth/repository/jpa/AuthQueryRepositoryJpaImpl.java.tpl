package {{basePackage}}.auth.repository.jpa;

import {{basePackage}}.auth.repository.AuthQueryRepository;
import {{basePackage}}.auth.repository.view.LoginUserView;
import {{basePackage}}.auth.repository.view.MenuView;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Optional;

/**
 * 认证侧查询的 JPA 实现。多表聚合用原生 SQL 走 EntityManager：
 * 这些查询读的是「视图」不是「实体」，为它们造四个查询专用实体
 * 只是为了让 JPA 高兴，不值；原生 SQL 的列名与 db/schema 一字不差。
 */
@Repository
@Transactional(readOnly = true)
public class AuthQueryRepositoryJpaImpl implements AuthQueryRepository {

    private static final String MENU_COLS =
            "m.id, m.parent_id, m.label, m.path, m.icon, m.sort_no, m.permission, m.status";

    /**
     * 用户权限码子查询：listMenusForUser 与 listPermissionCodes 共用一段 SQL ——
     * 两处各写一份，「角色须启用」这类口径迟早改了一处漏一处。
     */
    private static final String USER_PERMISSION_CODES =
            "SELECT p.code FROM sys_permission p"
                    + " JOIN sys_role_permission rp ON rp.permission_id = p.id"
                    + " JOIN sys_user_role ur ON ur.role_id = rp.role_id"
                    + " JOIN sys_role r ON r.id = rp.role_id"
                    + " WHERE ur.user_id = ? AND r.status = 0";

    private final EntityManager em;

    public AuthQueryRepositoryJpaImpl(EntityManager em) {
        this.em = em;
    }

    @Override
    public Optional<LoginUserView> findLoginUser(String username) {
        return findUser("SELECT id, username, password, nickname, status"
                + " FROM sys_user WHERE username = ?", username);
    }

    @Override
    public Optional<LoginUserView> findUserById(Long userId) {
        return findUser("SELECT id, username, password, nickname, status"
                + " FROM sys_user WHERE id = ?", userId);
    }

    private Optional<LoginUserView> findUser(String sql, Object arg) {
        List<?> rows = em.createNativeQuery(sql).setParameter(1, arg).getResultList();
        if (rows.isEmpty()) {
            return Optional.empty();
        }
        Object[] r = (Object[]) rows.get(0);
        LoginUserView view = new LoginUserView();
        view.setId(((Number) r[0]).longValue());
        view.setUsername((String) r[1]);
        view.setPassword((String) r[2]);
        view.setNickname((String) r[3]);
        view.setStatus(r[4] == null ? null : ((Number) r[4]).intValue());
        return Optional.of(view);
    }

    @Override
    public List<String> listRoleCodes(Long userId) {
        List<?> rows = em.createNativeQuery(
                        "SELECT r.code FROM sys_role r"
                                + " JOIN sys_user_role ur ON ur.role_id = r.id"
                                + " WHERE ur.user_id = ? AND r.status = 0")
                .setParameter(1, userId)
                .getResultList();
        return rows.stream().map(String::valueOf).toList();
    }

    @Override
    public List<String> listPermissionCodes(Long userId) {
        List<?> rows = em.createNativeQuery(USER_PERMISSION_CODES)
                .setParameter(1, userId)
                .getResultList();
        return rows.stream().map(String::valueOf).toList();
    }

    @Override
    public List<String> listAllPermissionCodes() {
        List<?> rows = em.createNativeQuery("SELECT code FROM sys_permission").getResultList();
        return rows.stream().map(String::valueOf).toList();
    }

    @Override
    @SuppressWarnings("unchecked")
    public List<MenuView> listMenusForUser(Long userId) {
        List<Object[]> rows = em.createNativeQuery(
                        "SELECT " + MENU_COLS + " FROM sys_menu m"
                                + " WHERE m.status = 0"
                                + " AND (m.permission IS NULL OR m.permission IN (" + USER_PERMISSION_CODES + "))"
                                + " ORDER BY m.sort_no, m.id")
                .setParameter(1, userId)
                .getResultList();
        return rows.stream().map(AuthQueryRepositoryJpaImpl::toMenu).toList();
    }

    @Override
    @SuppressWarnings("unchecked")
    public List<MenuView> listAllMenus() {
        List<Object[]> rows = em.createNativeQuery(
                        "SELECT " + MENU_COLS + " FROM sys_menu m"
                                + " WHERE m.status = 0 ORDER BY m.sort_no, m.id")
                .getResultList();
        return rows.stream().map(AuthQueryRepositoryJpaImpl::toMenu).toList();
    }

    /** 原生行转视图。按下标取值，与 SELECT 列顺序一一对应 —— 改列顺序必须同步改这里 */
    private static MenuView toMenu(Object[] r) {
        MenuView view = new MenuView();
        view.setId(((Number) r[0]).longValue());
        view.setParentId(r[1] == null ? null : ((Number) r[1]).longValue());
        view.setLabel((String) r[2]);
        view.setPath((String) r[3]);
        view.setIcon((String) r[4]);
        view.setSortNo(r[5] == null ? null : ((Number) r[5]).intValue());
        view.setPermission((String) r[6]);
        view.setStatus(r[7] == null ? null : ((Number) r[7]).intValue());
        return view;
    }
}
