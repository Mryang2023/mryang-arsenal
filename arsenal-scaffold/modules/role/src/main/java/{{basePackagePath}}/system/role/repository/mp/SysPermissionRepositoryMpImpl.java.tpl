package {{basePackage}}.system.role.repository.mp;

import {{basePackage}}.system.role.domain.SysPermission;
import {{basePackage}}.system.role.repository.SysPermissionRepository;
import {{basePackage}}.system.role.repository.mp.mapper.SysPermissionMapper;
import {{basePackage}}.system.role.repository.view.MenuLabelView;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;

/**
 * 权限仓储的 MyBatis-Plus 实现。单表查询全走 BaseMapper；
 * listMenuLabels 是 XML 里的跨表只读连接 —— 菜单的写路径仍只在 menu 模块。
 */
@Repository
public class SysPermissionRepositoryMpImpl implements SysPermissionRepository {

    private final SysPermissionMapper permissionMapper;

    public SysPermissionRepositoryMpImpl(SysPermissionMapper permissionMapper) {
        this.permissionMapper = permissionMapper;
    }

    @Override
    public List<SysPermission> findAll() {
        // 按主键升序：权限树的输出顺序由此决定，不要依赖数据库返回顺序
        return permissionMapper.selectList(
                new LambdaQueryWrapper<SysPermission>().orderByAsc(SysPermission::getId));
    }

    @Override
    public List<SysPermission> findByIds(Collection<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        return permissionMapper.selectBatchIds(ids);
    }

    @Override
    public List<MenuLabelView> listMenuLabels() {
        return permissionMapper.listMenuLabels();
    }
}
