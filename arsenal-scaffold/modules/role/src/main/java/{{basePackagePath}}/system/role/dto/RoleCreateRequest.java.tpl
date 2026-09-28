package {{basePackage}}.system.role.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 建角色入参。code 用正则限制字符集 —— 角色编码是权限体系的外部标识，
 * 出现在日志、种子、前端路由里，留空白或特殊字符迟早变成排查黑洞。
 */
public record RoleCreateRequest(
        @NotBlank(message = "角色名称不能为空")
        @Size(max = 64, message = "角色名称最长 64 字符")
        String name,

        @NotBlank(message = "角色编码不能为空")
        @Size(max = 64, message = "角色编码最长 64 字符")
        @Pattern(regexp = "^[A-Za-z][A-Za-z0-9_]*$", message = "角色编码只能包含字母、数字与下划线，且以字母开头")
        String code,

        @Size(max = 255, message = "描述最长 255 字符")
        String description
) {
}
