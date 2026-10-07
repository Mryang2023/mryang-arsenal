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

    /**
     * 全量菜单树。树在服务层构建（防环 + 按排序号稳定排序），
     * 前端侧边栏与菜单管理页共用这一份结构。
     */
    @GetMapping("/tree")
    @RequirePermission("sys:menu:list")
    public ApiResponse<List<MenuTreeNode>> tree() {
        return ApiResponse.ok(service.tree());
    }

    /** 新增菜单项。parentId 指向父菜单（一级菜单传 null / 0，语义见 MenuSaveRequest）。 */
    @PostMapping
    @RequirePermission("sys:menu:save")
    public ApiResponse<Long> create(@Valid @RequestBody MenuSaveRequest req) {
        return ApiResponse.ok(service.create(req));
    }

    /** 编辑菜单项（含换父）。移动后仍由服务层保证不成环。 */
    @PutMapping("/{id}")
    @RequirePermission("sys:menu:update")
    public ApiResponse<Void> update(@PathVariable Long id, @Valid @RequestBody MenuUpdateRequest req) {
        service.update(id, req);
        return ApiResponse.ok();
    }

    /** 删除菜单项。**有子菜单时拒绝删除** —— 先删子级再删自己，防树断枝。 */
    @DeleteMapping("/{id}")
    @RequirePermission("sys:menu:delete")
    public ApiResponse<Void> delete(@PathVariable Long id) {
        service.delete(id);
        return ApiResponse.ok();
    }
}
