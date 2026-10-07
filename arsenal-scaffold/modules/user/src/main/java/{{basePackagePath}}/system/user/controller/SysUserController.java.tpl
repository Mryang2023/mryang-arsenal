package {{basePackage}}.system.user.controller;

import {{basePackage}}.auth.security.RequirePermission;
import {{basePackage}}.common.ApiResponse;
import {{basePackage}}.common.PageResult;
import {{basePackage}}.system.user.dto.UserCreateRequest;
import {{basePackage}}.system.user.dto.UserPasswordResetRequest;
import {{basePackage}}.system.user.dto.UserQuery;
import {{basePackage}}.system.user.dto.UserResponse;
import {{basePackage}}.system.user.dto.UserRoleAssignRequest;
import {{basePackage}}.system.user.dto.UserUpdateRequest;
import {{basePackage}}.system.user.service.SysUserService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * HTTP 入口。只做参数校验与调用：不写业务逻辑、不直接碰数据层。
 * 返回值只有 ApiResponse 一种外壳；权限码与 sys_permission.code 一一对应 ——
 * 注解里写了表里没有的码，就没有任何角色能调通它。
 */
@RestController
@RequestMapping("/api/users")
public class SysUserController {

    private final SysUserService service;

    public SysUserController(SysUserService service) {
        this.service = service;
    }

    @GetMapping
    @RequirePermission("sys:user:list")
    public ApiResponse<PageResult<UserResponse>> page(UserQuery query) {
        // 分页参数与关键字都在 UserQuery 上（page 从 1 起）；模糊匹配的范围由仓储实现决定
        return ApiResponse.ok(service.page(query));
    }

    /**
     * 新建用户。
     * 用户名全局唯一 —— 重复时报 USERNAME_DUPLICATED，前端把错误带回到输入框；
     * 密码在这里统一 BCrypt 加密入库，任何地方都不落明文。
     */
    @PostMapping
    @RequirePermission("sys:user:save")
    public ApiResponse<Long> create(@Valid @RequestBody UserCreateRequest req) {
        return ApiResponse.ok(service.create(req));
    }

    /** 更新资料与启停状态。内置 admin 不允许停用（服务层守卫），停用它等于系统锁死。 */
    @PutMapping("/{id}")
    @RequirePermission("sys:user:update")
    public ApiResponse<Void> update(@PathVariable Long id, @Valid @RequestBody UserUpdateRequest req) {
        service.update(id, req);
        return ApiResponse.ok();
    }

    /** 物理删除。内置 admin 禁删、当前登录人禁自删（守卫与原因见 SysUserServiceImpl）。 */
    @DeleteMapping("/{id}")
    @RequirePermission("sys:user:delete")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return ApiResponse.ok();
    }

    /**
     * 管理员重置任意账号的密码（BCrypt 加密入库）。
     * admin 自己也允许被重置 —— 这正是忘记密码时的官方自救通道。
     */
    @PutMapping("/{id}/password")
    @RequirePermission("sys:user:resetPwd")
    public ApiResponse<Void> resetPassword(@PathVariable Long id,
                                           @Valid @RequestBody UserPasswordResetRequest req) {
        service.resetPassword(id, req);
        return ApiResponse.ok();
    }

    /**
     * 给用户分配角色。语义是**全量替换**：请求里的 roleIds 就是该用户的最终角色集
     * （前端权限页整树提交，不做追加式 diff）；去重保序，角色 id 必须真实存在。
     */
    @PutMapping("/{id}/roles")
    @RequirePermission("sys:user:assignRole")
    public ApiResponse<Void> assignRoles(@PathVariable Long id,
                                         @Valid @RequestBody UserRoleAssignRequest req) {
        service.assignRoles(id, req);
        return ApiResponse.ok();
    }
}
