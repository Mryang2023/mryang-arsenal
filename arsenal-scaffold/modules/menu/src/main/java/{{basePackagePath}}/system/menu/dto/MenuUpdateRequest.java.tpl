package {{basePackage}}.system.menu.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 编辑菜单入参。与新建同一字段集 —— 管理页「新增/编辑」共用一张表单，
 * 两份契约各自演进迟早对不上；id 走路径参数，不在请求体里。
 */
public record MenuUpdateRequest(
        Long parentId,

        @NotBlank(message = "菜单名称不能为空")
        @Size(max = 64, message = "菜单名称最长 64 字符")
        String label,

        @NotBlank(message = "路由路径不能为空")
        @Size(max = 128, message = "路由路径最长 128 字符")
        String path,

        @Size(max = 64, message = "图标最长 64 字符")
        String icon,

        Integer sortNo,

        @Size(max = 128, message = "权限码最长 128 字符")
        String permission,

        @NotNull(message = "状态不能为空")
        Integer status
) {
}
