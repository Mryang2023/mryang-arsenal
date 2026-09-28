package {{basePackage}}.system.user.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 建用户入参。字段与接口契约一字不差 —— 多出去一个字段，
 * 迟早有人开始依赖它，想删都删不掉。
 *
 * password 必填：管理员建号即给初始密码，「建了号再想办法给密码」
 * 会留一个登不进去的孤儿账号。手机号用正则卡格式（11 位、1 开头）。
 */
public record UserCreateRequest(
        @NotBlank(message = "用户名不能为空")
        @Size(max = 64, message = "用户名最长 64 字符")
        String username,

        @Size(max = 64, message = "昵称最长 64 字符")
        String nickname,

        @Email(message = "邮箱格式不正确")
        @Size(max = 128, message = "邮箱最长 128 字符")
        String email,

        @Pattern(regexp = "^1[3-9]\\d{9}$", message = "手机号格式不正确")
        String phone,

        @NotBlank(message = "初始密码不能为空")
        @Size(min = 6, max = 64, message = "密码长度须在 6 到 64 位之间")
        String password
) {
}
