package {{basePackage}}.system.role.controller;

import {{basePackage}}.auth.security.RequirePermission;
import {{basePackage}}.common.ApiResponse;
import {{basePackage}}.common.PageResult;
import {{basePackage}}.system.role.dto.RoleCreateRequest;
import {{basePackage}}.system.role.dto.RolePermissionAssignRequest;
import {{basePackage}}.system.role.dto.RoleQuery;
import {{basePackage}}.system.role.dto.RoleResponse;
import {{basePackage}}.system.role.dto.RoleUpdateRequest;
import {{basePackage}}.system.role.service.SysRoleService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * HTTP 入口。只做参数校验与调用：不写业务逻辑、不直接碰数据层。
 * 返回值只有 ApiResponse 一种外壳；权限码与 sys_permission.code 一一对应。
 */
@RestController
@RequestMapping("/api/roles")
public class SysRoleController {

    private final SysRoleService service;

    public SysRoleController(SysRoleService service) {
        this.service = service;
    }

    @GetMapping
    @RequirePermission("sys:role:list")
    public ApiResponse<PageResult<RoleResponse>> page(RoleQuery query) {
        return ApiResponse.ok(service.page(query));
    }

    @PostMapping
    @RequirePermission("sys:role:save")
    public ApiResponse<Long> create(@Valid @RequestBody RoleCreateRequest req) {
        return ApiResponse.ok(service.create(req));
    }

    @PutMapping("/{id}")
    @RequirePermission("sys:role:update")
    public ApiResponse<Void> update(@PathVariable Long id, @Valid @RequestBody RoleUpdateRequest req) {
        service.update(id, req);
        return ApiResponse.ok();
    }

    @DeleteMapping("/{id}")
    @RequirePermission("sys:role:delete")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return ApiResponse.ok();
    }

    @GetMapping("/{id}/permissions")
    @RequirePermission("sys:role:list")
    public ApiResponse<List<Long>> permissions(@PathVariable Long id) {
        return ApiResponse.ok(service.listPermissionIds(id));
    }

    @PutMapping("/{id}/permissions")
    @RequirePermission("sys:role:assignPerm")
    public ApiResponse<Void> assignPermissions(@PathVariable Long id,
                                               @Valid @RequestBody RolePermissionAssignRequest req) {
        service.assignPermissions(id, req);
        return ApiResponse.ok();
    }
}
