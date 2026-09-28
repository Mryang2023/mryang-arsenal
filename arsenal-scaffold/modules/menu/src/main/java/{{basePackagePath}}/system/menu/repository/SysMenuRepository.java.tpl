package {{basePackage}}.system.menu.repository;

import {{basePackage}}.system.menu.domain.SysMenu;

import java.util.List;
import java.util.Optional;

/**
 * 菜单仓储接口。服务层只认接口 —— 持久层实现由生成器装配
 * repository/jpa 或 repository/mp 其一，service 一行不改。
 *
 * 刻意只暴露 findAll 而不给逐层查询：菜单是全量读内存组树的小表，
 * 逐层查库反而把防环逻辑打散到 SQL 里。
 */
public interface SysMenuRepository {

    Optional<SysMenu> findById(Long id);

    /** 全量菜单，按 sort_no, id 排序 —— 树组装只管挂接不管排序。 */
    List<SysMenu> findAll();

    boolean existsByParentId(Long parentId);

    Long insert(SysMenu menu);

    void update(SysMenu menu);

    void deleteById(Long id);
}
