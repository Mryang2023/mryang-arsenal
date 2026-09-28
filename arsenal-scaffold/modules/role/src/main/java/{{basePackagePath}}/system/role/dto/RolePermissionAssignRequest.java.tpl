package {{basePackage}}.system.role.dto;

import jakarta.validation.constraints.NotNull;

import java.util.List;

/**
 * 角色-权限分配入参。允许空列表（清空全部权限也是合法操作），
 * 但不允许 null —— 「没传」和「清空」是两个意图，混在一起迟早出事故。
 */
public record RolePermissionAssignRequest(
        @NotNull(message = "permissionIds 不能为 null")
        List<Long> permissionIds
) {
}
