package {{basePackage}}.system.menu.controller;

import {{basePackage}}.auth.security.RequirePermission;
import {{basePackage}}.common.ApiResponse;
import {{basePackage}}.system.menu.dto.MenuSaveRequest;
import {{basePackage}}.system.menu.dto.MenuTreeNode;
import {{basePackage}}.system.menu.dto.MenuUpdateRequest;
import {{basePackage}}.system.menu.service.SysMenuService;
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
@RequestMapping("/api/menus")
public class SysMenuController {

    private final SysMenuService service;

    public SysMenuController(SysMenuService service) {
        this.service = service;
    }

    @GetMapping("/tree")
    @RequirePermission("sys:menu:list")
    public ApiResponse<List<MenuTreeNode>> tree() {
        return ApiResponse.ok(service.tree());
    }

    @PostMapping
    @RequirePermission("sys:menu:save")
    public ApiResponse<Long> create(@Valid @RequestBody MenuSaveRequest req) {
        return ApiResponse.ok(service.create(req));
    }

    @PutMapping("/{id}")
    @RequirePermission("sys:menu:update")
    public ApiResponse<Void> update(@PathVariable Long id, @Valid @RequestBody MenuUpdateRequest req) {
        service.update(id, req);
        return ApiResponse.ok();
    }

    @DeleteMapping("/{id}")
    @RequirePermission("sys:menu:delete")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return ApiResponse.ok();
    }
}
