package {{basePackage}}.system.menu.repository.mp;

import {{basePackage}}.system.menu.domain.SysMenu;
import {{basePackage}}.system.menu.repository.SysMenuRepository;
import {{basePackage}}.system.menu.repository.mp.mapper.SysMenuMapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * 菜单仓储的 MyBatis-Plus 实现。排序用 orderByAsc 双键（sortNo, id）——
 * 与 JPA 实现的 ORDER BY sort_no, id 同一口径，两处各写一份迟早对不上。
 */
@Repository
public class SysMenuRepositoryMpImpl implements SysMenuRepository {

    private final SysMenuMapper menuMapper;

    public SysMenuRepositoryMpImpl(SysMenuMapper menuMapper) {
        this.menuMapper = menuMapper;
    }

    @Override
    public Optional<SysMenu> findById(Long id) {
        return Optional.ofNullable(menuMapper.selectById(id));
    }

    @Override
    public List<SysMenu> findAll() {
        return menuMapper.selectList(new LambdaQueryWrapper<SysMenu>()
                .orderByAsc(SysMenu::getSortNo)
                .orderByAsc(SysMenu::getId));
    }

    @Override
    public boolean existsByParentId(Long parentId) {
        return menuMapper.exists(new LambdaQueryWrapper<SysMenu>()
                .eq(SysMenu::getParentId, parentId));
    }

    @Override
    public Long insert(SysMenu menu) {
        menuMapper.insert(menu);
        return menu.getId();
    }

    @Override
    public void update(SysMenu menu) {
        menuMapper.update(null, new com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper<SysMenu>()
                .eq(SysMenu::getId, menu.getId())
                .set(SysMenu::getParentId, menu.getParentId())
                .set(SysMenu::getLabel, menu.getLabel())
                .set(SysMenu::getPath, menu.getPath())
                .set(SysMenu::getIcon, menu.getIcon())
                .set(SysMenu::getSortNo, menu.getSortNo())
                .set(SysMenu::getPermission, menu.getPermission())
                .set(SysMenu::getStatus, menu.getStatus())
                .set(SysMenu::getUpdateTime, menu.getUpdateTime()));
    }

    @Override
    public void deleteById(Long id) {
        menuMapper.deleteById(id);
    }
}
