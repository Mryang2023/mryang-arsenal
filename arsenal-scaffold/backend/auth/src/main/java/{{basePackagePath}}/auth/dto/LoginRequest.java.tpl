package {{basePackage}}.auth.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 登录入参。失败文案统一交给 AuthService —— 这里只做「非空/长度」的机械校验，
 * 不在字段注解里写「用户名不存在」之类会泄露账号信息的提示。
 */
public record LoginRequest(
        @NotBlank(message = "用户名不能为空")
        @Size(max = 64, message = "用户名最长 64 字符")
        String username,

        @NotBlank(message = "密码不能为空")
        @Size(max = 64, message = "密码最长 64 字符")
        String password
) {
}
