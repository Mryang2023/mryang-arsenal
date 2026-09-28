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
        return ApiResponse.ok(service.page(query));
    }

    @PostMapping
    @RequirePermission("sys:user:save")
    public ApiResponse<Long> create(@Valid @RequestBody UserCreateRequest req) {
        return ApiResponse.ok(service.create(req));
    }

    @PutMapping("/{id}")
    @RequirePermission("sys:user:update")
    public ApiResponse<Void> update(@PathVariable Long id, @Valid @RequestBody UserUpdateRequest req) {
        service.update(id, req);
        return ApiResponse.ok();
    }

    @DeleteMapping("/{id}")
    @RequirePermission("sys:user:delete")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return ApiResponse.ok();
    }

    @PutMapping("/{id}/password")
    @RequirePermission("sys:user:resetPwd")
    public ApiResponse<Void> resetPassword(@PathVariable Long id,
                                           @Valid @RequestBody UserPasswordResetRequest req) {
        service.resetPassword(id, req);
        return ApiResponse.ok();
    }

    @PutMapping("/{id}/roles")
    @RequirePermission("sys:user:assignRole")
    public ApiResponse<Void> assignRoles(@PathVariable Long id,
                                         @Valid @RequestBody UserRoleAssignRequest req) {
        service.assignRoles(id, req);
        return ApiResponse.ok();
    }
}
