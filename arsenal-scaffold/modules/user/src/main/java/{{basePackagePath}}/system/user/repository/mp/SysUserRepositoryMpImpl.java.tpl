package {{basePackage}}.system.user.repository.mp;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import {{basePackage}}.system.user.domain.SysUser;
import {{basePackage}}.system.user.domain.UserRoleBinding;
import {{basePackage}}.system.user.repository.SysUserRepository;
import {{basePackage}}.system.user.repository.mp.mapper.SysUserMapper;
import {{basePackage}}.system.user.repository.mp.mapper.UserRoleBindingMapper;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

/**
 * 用户仓储的 MyBatis-Plus 实现。单表 CRUD 全走 BaseMapper；
 * offset 换算回页码再交给分页插件 —— 分页行为与 MybatisPlusConfig
 * 里注册的分页插件绑定，插件没注册时 Page 会被静默忽略返回整表。
 */
@Repository
public class SysUserRepositoryMpImpl implements SysUserRepository {

    private final SysUserMapper userMapper;
    private final UserRoleBindingMapper bindingMapper;

    public SysUserRepositoryMpImpl(SysUserMapper userMapper, UserRoleBindingMapper bindingMapper) {
        this.userMapper = userMapper;
        this.bindingMapper = bindingMapper;
    }

    @Override
    public Optional<SysUser> findById(Long id) {
        return Optional.ofNullable(userMapper.selectById(id));
    }

    @Override
    public Optional<SysUser> findByUsername(String username) {
        return Optional.ofNullable(userMapper.selectOne(new LambdaQueryWrapper<SysUser>()
                .eq(SysUser::getUsername, username)));
    }

    @Override
    public boolean existsByUsername(String username) {
        return userMapper.exists(new LambdaQueryWrapper<SysUser>()
                .eq(SysUser::getUsername, username));
    }

    @Override
    public List<SysUser> page(String keyword, long offset, int limit) {
        // 服务层按 (page-1)*limit 算出 offset，这里换算回页码；两者必须始终成对出现
        Page<SysUser> result = userMapper.selectPage(
                new Page<>(offset / limit + 1, limit), wrapperOf(keyword));
        return result.getRecords();
    }

    @Override
    public long count(String keyword) {
        Long n = userMapper.selectCount(wrapperOf(keyword));
        return n == null ? 0 : n;
    }

    /** keyword 同时模糊 username 与 nickname —— 列表页只有一个搜索框 */
    private static LambdaQueryWrapper<SysUser> wrapperOf(String keyword) {
        LambdaQueryWrapper<SysUser> wrapper = new LambdaQueryWrapper<>();
        if (keyword != null && !keyword.isBlank()) {
            wrapper.and(w -> w.like(SysUser::getUsername, keyword)
                    .or().like(SysUser::getNickname, keyword));
        }
        wrapper.orderByDesc(SysUser::getId);
        return wrapper;
    }

    @Override
    public Long insert(SysUser user) {
        userMapper.insert(user);
        // BaseMapper 插入后回填自增主键
        return user.getId();
    }

    @Override
    public void updateProfile(SysUser user) {
        // 用户名不在更新集合里：username 是登录标识，仓储层就不提供改它的口子
        userMapper.update(null, new LambdaUpdateWrapper<SysUser>()
                .eq(SysUser::getId, user.getId())
                .set(SysUser::getNickname, user.getNickname())
                .set(SysUser::getEmail, user.getEmail())
                .set(SysUser::getPhone, user.getPhone())
                .set(SysUser::getStatus, user.getStatus())
                .set(SysUser::getUpdateTime, user.getUpdateTime()));
    }

    @Override
    public void updatePassword(Long id, String passwordHash) {
        userMapper.update(null, new LambdaUpdateWrapper<SysUser>()
                .eq(SysUser::getId, id)
                .set(SysUser::getPassword, passwordHash)
                .set(SysUser::getUpdateTime, LocalDateTime.now()));
    }

    @Override
    public void deleteById(Long id) {
        // 先清绑定再删用户：同一条物理删除路径，绑定行不留悬挂
        bindingMapper.delete(new LambdaQueryWrapper<UserRoleBinding>()
                .eq(UserRoleBinding::getUserId, id));
        userMapper.deleteById(id);
    }

    @Override
    public List<Long> listRoleIds(Long userId) {
        return bindingMapper.selectList(new LambdaQueryWrapper<UserRoleBinding>()
                        .eq(UserRoleBinding::getUserId, userId))
                .stream().map(UserRoleBinding::getRoleId).toList();
    }

    @Override
    public void replaceRoles(Long userId, List<Long> roleIds) {
        bindingMapper.delete(new LambdaQueryWrapper<UserRoleBinding>()
                .eq(UserRoleBinding::getUserId, userId));
        LocalDateTime now = LocalDateTime.now();
        for (Long roleId : roleIds) {
            UserRoleBinding binding = new UserRoleBinding();
            binding.setUserId(userId);
            binding.setRoleId(roleId);
            binding.setCreateTime(now);
            bindingMapper.insert(binding);
        }
    }
}
