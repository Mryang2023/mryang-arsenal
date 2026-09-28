package {{basePackage}}.system.role.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * 改角色入参。没有 code 字段 —— 编码是权限体系的外部标识，
 * 接口层就不提供改它的口子；status 必填，启停用走这里。
 */
public record RoleUpdateRequest(
        @NotBlank(message = "角色名称不能为空")
        @Size(max = 64, message = "角色名称最长 64 字符")
        String name,

        @Size(max = 255, message = "描述最长 255 字符")
        String description,

        @NotNull(message = "状态不能为空")
        Integer status
) {
}
