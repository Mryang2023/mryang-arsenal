package {{basePackage}}.system.menu.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 新建菜单入参。parentId 可空（根节点），label/path 必填 ——
 * 前端路由要靠 path 挂接，没有 path 的菜单在侧边栏点不开。
 */
public record MenuSaveRequest(
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
