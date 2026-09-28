package {{basePackage}}.system.user.service.impl;

import {{basePackage}}.auth.security.CurrentUserHolder;
import {{basePackage}}.common.ErrorCode;
import {{basePackage}}.common.PageResult;
import {{basePackage}}.common.exception.BizException;
import {{basePackage}}.system.role.repository.SysRoleRepository;
import {{basePackage}}.system.user.domain.SysUser;
import {{basePackage}}.system.user.dto.UserCreateRequest;
import {{basePackage}}.system.user.dto.UserPasswordResetRequest;
import {{basePackage}}.system.user.dto.UserQuery;
import {{basePackage}}.system.user.dto.UserResponse;
import {{basePackage}}.system.user.dto.UserRoleAssignRequest;
import {{basePackage}}.system.user.dto.UserUpdateRequest;
import {{basePackage}}.system.user.repository.SysUserRepository;
import {{basePackage}}.system.user.service.SysUserService;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.LinkedHashSet;
import java.util.List;

/**
 * 用户业务实现。事务边界在这一层：@Transactional 只写在 public 方法上
 * （代理只拦外部调用，类内自调用不生效），查询方法标 readOnly。
 *
 * 跨模块只依赖 role 模块的仓储接口（校验角色 id 真实存在），
 * 不触碰它的内部实现 —— 模块之间的面就是 repository/service 接口。
 */
@Service
public class SysUserServiceImpl implements SysUserService {

    /** 内置管理员用户名：种子写入，与 V2__seed 的 [SECTION:core] 对应 */
    static final String BUILTIN_ADMIN = "admin";

    private final SysUserRepository userRepository;
    private final SysRoleRepository roleRepository;
    private final PasswordEncoder passwordEncoder;

    public SysUserServiceImpl(SysUserRepository userRepository,
                              SysRoleRepository roleRepository,
                              PasswordEncoder passwordEncoder) {
        this.userRepository = userRepository;
        this.roleRepository = roleRepository;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    @Transactional
    public Long create(UserCreateRequest req) {
        if (userRepository.existsByUsername(req.username())) {
            throw new BizException(ErrorCode.USERNAME_DUPLICATED);
        }
        SysUser user = new SysUser();
        user.setUsername(req.username());
        user.setNickname(req.nickname());
        user.setEmail(req.email());
        user.setPhone(req.phone());
        user.setPassword(passwordEncoder.encode(req.password()));
        user.setStatus(0);
        // 时间在代码里赋值而不依赖数据库默认值：JPA 全字段 INSERT 会把 null 写进去，
        // 显式赋值让 JPA 与 MyBatis-Plus 两条实现行为一致
        LocalDateTime now = LocalDateTime.now();
        user.setCreateTime(now);
        user.setUpdateTime(now);
        return userRepository.insert(user);
    }

    @Override
    @Transactional(readOnly = true)
    public UserResponse getById(Long id) {
        return userRepository.findById(id).map(UserResponse::from)
                .orElseThrow(() -> notFound(id));
    }

    @Override
    @Transactional(readOnly = true)
    public PageResult<UserResponse> page(UserQuery query) {
        long offset = (query.getPage() - 1) * query.getPageSize();
        List<SysUser> users = userRepository.page(query.getKeyword(), offset, (int) query.getPageSize());
        long total = userRepository.count(query.getKeyword());
        return PageResult.of(users.stream().map(UserResponse::from).toList(),
                total, query.getPage(), query.getPageSize());
    }

    @Override
    @Transactional
    public void update(Long id, UserUpdateRequest req) {
        SysUser user = userRepository.findById(id).orElseThrow(() -> notFound(id));
        guardAdminDisable(user, req.status());
        user.setNickname(req.nickname());
        user.setEmail(req.email());
        user.setPhone(req.phone());
        user.setStatus(req.status());
        user.setUpdateTime(LocalDateTime.now());
        userRepository.updateProfile(user);
    }

    /**
     * 内置 admin 为什么禁停用：它是种子里唯一确定存在的账号，
     * 停用 + 忘记其他管理员密码 = 系统锁死，只能改库自救。
     */
    private void guardAdminDisable(SysUser user, Integer targetStatus) {
        if (BUILTIN_ADMIN.equals(user.getUsername()) && targetStatus != null && targetStatus != 0) {
            throw new BizException(ErrorCode.FORBIDDEN, "内置管理员账号不允许停用");
        }
    }

    /**
     * admin 为什么禁删：种子的幂等策略依赖「admin 恒存在」（重跑种子不重建已删用户），
     * 删掉 admin 后没人能管理角色与菜单，系统直接锁死；
     * 当前登录人也禁自删 —— 删了自己等于当场登出，页面上的确认框救不了这个操作。
     */
    @Override
    @Transactional
    public void delete(Long id) {
        SysUser user = userRepository.findById(id).orElseThrow(() -> notFound(id));
        if (BUILTIN_ADMIN.equals(user.getUsername())) {
            throw new BizException(ErrorCode.FORBIDDEN, "内置管理员账号不允许删除");
        }
        Long currentUserId = CurrentUserHolder.getUserId();
        if (id.equals(currentUserId)) {
            throw new BizException(ErrorCode.FORBIDDEN, "不能删除当前登录账号");
        }
        userRepository.deleteById(id);
    }

    @Override
    @Transactional
    public void resetPassword(Long id, UserPasswordResetRequest req) {
        // admin 也允许被重置 —— 这正是忘记密码的官方自救通道
        SysUser user = userRepository.findById(id).orElseThrow(() -> notFound(id));
        userRepository.updatePassword(user.getId(), passwordEncoder.encode(req.password()));
    }

    @Override
    @Transactional
    public void assignRoles(Long id, UserRoleAssignRequest req) {
        userRepository.findById(id).orElseThrow(() -> notFound(id));
        List<Long> roleIds = List.copyOf(new LinkedHashSet<>(req.roleIds())); // 去重且保序
        if (roleRepository.findByIds(roleIds).size() != roleIds.size()) {
            throw new BizException(ErrorCode.PARAM_INVALID, "存在无效的角色项");
        }
        userRepository.replaceRoles(id, roleIds);
    }

    private static BizException notFound(Long id) {
        return new BizException(ErrorCode.NOT_FOUND, "用户不存在: id=" + id);
    }
}
