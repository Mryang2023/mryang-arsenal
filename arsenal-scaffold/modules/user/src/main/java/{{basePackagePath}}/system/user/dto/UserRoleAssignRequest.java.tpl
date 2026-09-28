package {{basePackage}}.system.user.dto;

import jakarta.validation.constraints.NotNull;

import java.util.List;

/**
 * 角色分配入参。允许空列表（清空全部角色也是合法操作），
 * 但不允许 null —— 「没传」和「清空」是两个意图，混在一起迟早出事故。
 */
public record UserRoleAssignRequest(
        @NotNull(message = "roleIds 不能为 null")
        List<Long> roleIds
) {
}
