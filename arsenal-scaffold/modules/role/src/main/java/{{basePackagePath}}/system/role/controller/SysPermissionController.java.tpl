package {{basePackage}}.system.role.controller;

import {{basePackage}}.auth.security.RequirePermission;
import {{basePackage}}.common.ApiResponse;
import {{basePackage}}.system.role.dto.PermissionTreeNode;
import {{basePackage}}.system.role.service.SysRoleService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 权限树入口。挂在 role 模块是因为「给角色授什么」是角色的职责；
 * 放在 menu 模块会把「读权限」变成菜单的义务，两个模块互相牵连。
 * 权限码沿用 sys:role:list —— 读权限树是角色授权页的前置步骤。
 */
@RestController
@RequestMapping("/api/permissions")
public class SysPermissionController {

    private final SysRoleService service;

    public SysPermissionController(SysRoleService service) {
        this.service = service;
    }

    @GetMapping("/tree")
    @RequirePermission("sys:role:list")
    public ApiResponse<List<PermissionTreeNode>> tree() {
        return ApiResponse.ok(service.permissionTree());
    }
}
