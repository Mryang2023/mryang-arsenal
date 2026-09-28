package {{basePackage}}.system.role.service.impl;

import {{basePackage}}.common.ErrorCode;
import {{basePackage}}.common.PageResult;
import {{basePackage}}.common.exception.BizException;
import {{basePackage}}.system.role.domain.SysPermission;
import {{basePackage}}.system.role.domain.SysRole;
import {{basePackage}}.system.role.dto.PermissionTreeNode;
import {{basePackage}}.system.role.dto.RoleCreateRequest;
import {{basePackage}}.system.role.dto.RolePermissionAssignRequest;
import {{basePackage}}.system.role.dto.RoleQuery;
import {{basePackage}}.system.role.dto.RoleResponse;
import {{basePackage}}.system.role.dto.RoleUpdateRequest;
import {{basePackage}}.system.role.repository.SysPermissionRepository;
import {{basePackage}}.system.role.repository.SysRoleRepository;
import {{basePackage}}.system.role.repository.view.MenuLabelView;
import {{basePackage}}.system.role.service.SysRoleService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/**
 * 角色业务实现。事务边界在这一层：@Transactional 只写在 public 方法上
 * （代理只拦外部调用，类内自调用不生效），查询方法标 readOnly。
 */
@Service
public class SysRoleServiceImpl implements SysRoleService {

    /** 内置超管角色码：与 auth 模块的 AuthService.ADMIN_ROLE、种子 [SECTION:core] 同一口径 */
    static final String BUILTIN_ADMIN_CODE = "ADMIN";

    private final SysRoleRepository roleRepository;
    private final SysPermissionRepository permissionRepository;

    public SysRoleServiceImpl(SysRoleRepository roleRepository, SysPermissionRepository permissionRepository) {
        this.roleRepository = roleRepository;
        this.permissionRepository = permissionRepository;
    }

    @Override
    @Transactional
    public Long create(RoleCreateRequest req) {
        if (BUILTIN_ADMIN_CODE.equals(req.code())) {
            // ADMIN 是种子写入的内置角色，重跑种子时按编码幂等 ——
            // 让新建角色占用这个码，下次重跑种子就会「新建失败或覆盖已有」，口径全乱
            throw new BizException(ErrorCode.CONFLICT, "角色编码 ADMIN 为内置角色保留");
        }
        if (roleRepository.existsByCode(req.code())) {
            throw new BizException(ErrorCode.CONFLICT, "角色编码已存在: " + req.code());
        }
        SysRole role = new SysRole();
        role.setName(req.name());
        role.setCode(req.code());
        role.setDescription(req.description());
        role.setStatus(0);
        // 时间在代码里赋值而不依赖数据库默认值：JPA 全字段 INSERT 会把 null 写进去，
        // 显式赋值让 JPA 与 MyBatis-Plus 两条实现行为一致
        LocalDateTime now = LocalDateTime.now();
        role.setCreateTime(now);
        role.setUpdateTime(now);
        return roleRepository.insert(role);
    }

    @Override
    @Transactional(readOnly = true)
    public RoleResponse getById(Long id) {
        return roleRepository.findById(id).map(RoleResponse::from)
                .orElseThrow(() -> notFound(id));
    }

    @Override
    @Transactional(readOnly = true)
    public PageResult<RoleResponse> page(RoleQuery query) {
        long offset = (query.getPage() - 1) * query.getPageSize();
        List<SysRole> roles = roleRepository.page(query.getKeyword(), offset, (int) query.getPageSize());
        long total = roleRepository.count(query.getKeyword());
        return PageResult.of(roles.stream().map(RoleResponse::from).toList(),
                total, query.getPage(), query.getPageSize());
    }

    @Override
    @Transactional
    public void update(Long id, RoleUpdateRequest req) {
        SysRole role = roleRepository.findById(id).orElseThrow(() -> notFound(id));
        if (BUILTIN_ADMIN_CODE.equals(role.getCode()) && req.status() != null && req.status() != 0) {
            // 内置 ADMIN 禁停用：它是权限体系的地基，停用后无人再拥有 sys:role:delete，
            // 等于把钥匙锁进保险柜，系统锁死只能改库自救
            throw new BizException(ErrorCode.FORBIDDEN, "内置超管角色不允许停用");
        }
        role.setName(req.name());
        role.setDescription(req.description());
        role.setStatus(req.status());
        role.setUpdateTime(LocalDateTime.now());
        roleRepository.update(role);
    }

    /** ADMIN 为什么禁删：种子的幂等策略与 auth 的 ADMIN 直通都依赖「ADMIN 恒存在」。 */
    @Override
    @Transactional
    public void delete(Long id) {
        SysRole role = roleRepository.findById(id).orElseThrow(() -> notFound(id));
        if (BUILTIN_ADMIN_CODE.equals(role.getCode())) {
            throw new BizException(ErrorCode.FORBIDDEN, "内置超管角色不允许删除");
        }
        roleRepository.deleteById(id);
    }

    @Override
    @Transactional(readOnly = true)
    public List<Long> listPermissionIds(Long id) {
        roleRepository.findById(id).orElseThrow(() -> notFound(id));
        return roleRepository.listPermissionIds(id);
    }

    @Override
    @Transactional
    public void assignPermissions(Long id, RolePermissionAssignRequest req) {
        roleRepository.findById(id).orElseThrow(() -> notFound(id));
        List<Long> permissionIds = List.copyOf(new LinkedHashSet<>(req.permissionIds()));
        if (permissionRepository.findByIds(permissionIds).size() != permissionIds.size()) {
            throw new BizException(ErrorCode.PARAM_INVALID, "存在无效的权限项");
        }
        roleRepository.replacePermissions(id, permissionIds);
    }

    /**
     * 权限树。以「菜单分组 + 权限叶子」两层结构返回：
     *   [{id:菜单id, label:菜单名, type:"menu", children:[{id:权限id, label:权限名, code, type:"perm"}]}]
     * menuId 指向已被裁剪/删除的菜单时归入「未分组的菜单」（标签兜底），
     * 权限本身照常可授 —— 种子允许只保留 [SECTION:permission] 而裁掉菜单段。
     */
    @Override
    @Transactional(readOnly = true)
    public List<PermissionTreeNode> permissionTree() {
        List<SysPermission> permissions = permissionRepository.findAll();
        Map<Long, String> menuLabels = new HashMap<>();
        for (MenuLabelView view : permissionRepository.listMenuLabels()) {
            menuLabels.put(view.getId(), view.getLabel());
        }
        Map<Long, PermissionTreeNode> groups = new LinkedHashMap<>();
        List<PermissionTreeNode> roots = new ArrayList<>();
        for (SysPermission p : permissions) {
            PermissionTreeNode leaf = PermissionTreeNode.permissionLeaf(p.getId(), p.getName(), p.getCode());
            if (p.getMenuId() == null) {
                roots.add(leaf);
            } else {
                groups.computeIfAbsent(p.getMenuId(),
                                id -> PermissionTreeNode.menuGroup(id, menuLabels.getOrDefault(id, "未分组的菜单")))
                        .children().add(leaf);
            }
        }
        roots.addAll(groups.values());
        return roots;
    }

    private static BizException notFound(Long id) {
        return new BizException(ErrorCode.NOT_FOUND, "角色不存在: id=" + id);
    }
}
