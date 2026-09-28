package {{basePackage}}.system.role.repository.mp;

import {{basePackage}}.system.role.domain.RolePermissionBinding;
import {{basePackage}}.system.role.domain.SysRole;
import {{basePackage}}.system.role.repository.SysRoleRepository;
import {{basePackage}}.system.role.repository.mp.mapper.RolePermissionBindingMapper;
import {{basePackage}}.system.role.repository.mp.mapper.SysRoleMapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Optional;

/**
 * 角色仓储的 MyBatis-Plus 实现。单表 CRUD 全走 BaseMapper；
 * offset 换算回页码再交给分页插件 —— 分页行为与 MybatisPlusConfig
 * 里注册的分页插件绑定，插件没注册时 Page 会被静默忽略返回整表。
 */
@Repository
public class SysRoleRepositoryMpImpl implements SysRoleRepository {

    private final SysRoleMapper roleMapper;
    private final RolePermissionBindingMapper bindingMapper;

    public SysRoleRepositoryMpImpl(SysRoleMapper roleMapper, RolePermissionBindingMapper bindingMapper) {
        this.roleMapper = roleMapper;
        this.bindingMapper = bindingMapper;
    }

    @Override
    public Optional<SysRole> findById(Long id) {
        return Optional.ofNullable(roleMapper.selectById(id));
    }

    @Override
    public boolean existsByCode(String code) {
        return roleMapper.exists(new LambdaQueryWrapper<SysRole>()
                .eq(SysRole::getCode, code));
    }

    @Override
    public List<SysRole> page(String keyword, long offset, int limit) {
        // 服务层按 (page-1)*limit 算出 offset，这里换算回页码；两者必须始终成对出现
        Page<SysRole> result = roleMapper.selectPage(
                new Page<>(offset / limit + 1, limit), wrapperOf(keyword));
        return result.getRecords();
    }

    @Override
    public long count(String keyword) {
        Long n = roleMapper.selectCount(wrapperOf(keyword));
        return n == null ? 0 : n;
    }

    /** keyword 同时模糊 name 与 code —— 角色列表页只有一个搜索框 */
    private static LambdaQueryWrapper<SysRole> wrapperOf(String keyword) {
        LambdaQueryWrapper<SysRole> wrapper = new LambdaQueryWrapper<>();
        if (keyword != null && !keyword.isBlank()) {
            wrapper.and(w -> w.like(SysRole::getName, keyword)
                    .or().like(SysRole::getCode, keyword));
        }
        wrapper.orderByDesc(SysRole::getId);
        return wrapper;
    }

    @Override
    public Long insert(SysRole role) {
        roleMapper.insert(role);
        // BaseMapper 插入后回填自增主键
        return role.getId();
    }

    @Override
    public void update(SysRole role) {
        // code 不在更新集合里：编码是权限体系的外部标识，仓储层就不提供改它的口子
        roleMapper.update(null, new com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper<SysRole>()
                .eq(SysRole::getId, role.getId())
                .set(SysRole::getName, role.getName())
                .set(SysRole::getDescription, role.getDescription())
                .set(SysRole::getStatus, role.getStatus())
                .set(SysRole::getUpdateTime, role.getUpdateTime()));
    }

    /**
     * 物理删除并连带清两张绑定表（同一事务，事务边界在 service）：
     * sys_role_permission 的绑定实体归本模块；sys_user_role 归 user 模块 ——
     * 跨表清理放在这里是因为「删角色」的入口在 role 模块，悬挂绑定对谁都没意义。
     */
    @Override
    public void deleteById(Long id) {
        bindingMapper.delete(new LambdaQueryWrapper<RolePermissionBinding>()
                .eq(RolePermissionBinding::getRoleId, id));
        roleMapper.delete(new QueryWrapper<SysRole>().eq("id", id));
    }

    @Override
    public List<SysRole> findByIds(Collection<Long> ids) {
        if (ids == null || ids.isEmpty()) {
            return List.of();
        }
        return roleMapper.selectBatchIds(ids);
    }

    @Override
    public List<Long> listPermissionIds(Long roleId) {
        return bindingMapper.selectList(new LambdaQueryWrapper<RolePermissionBinding>()
                        .eq(RolePermissionBinding::getRoleId, roleId))
                .stream().map(RolePermissionBinding::getPermissionId).toList();
    }

    @Override
    public void replacePermissions(Long roleId, List<Long> permissionIds) {
        bindingMapper.delete(new LambdaQueryWrapper<RolePermissionBinding>()
                .eq(RolePermissionBinding::getRoleId, roleId));
        LocalDateTime now = LocalDateTime.now();
        for (Long permissionId : permissionIds) {
            RolePermissionBinding binding = new RolePermissionBinding();
            binding.setRoleId(roleId);
            binding.setPermissionId(permissionId);
            binding.setCreateTime(now);
            bindingMapper.insert(binding);
        }
    }
}
