package {{basePackage}}.system.user.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 重置密码入参。管理员重置走这里；本人改密属于个人中心，
 * 是另一个接口（要验旧密码），不共用同一个入参 ——
 * 两个场景的安全要求不同，共用 DTO 迟早把「不验旧密码」带进个人中心。
 */
public record UserPasswordResetRequest(
        @NotBlank(message = "新密码不能为空")
        @Size(min = 6, max = 64, message = "密码长度须在 6 到 64 位之间")
        String password
) {
}
