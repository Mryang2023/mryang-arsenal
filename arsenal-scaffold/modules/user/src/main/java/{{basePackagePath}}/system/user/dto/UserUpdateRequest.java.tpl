package {{basePackage}}.system.user.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * 编辑入参。没有 username 字段 —— 用户名是登录标识与权限绑定锚点，
 * 改它等于把这个人所有历史数据挂到另一个人身上，接口层就不给这个口子。
 * status 必填：启停用走这里，不给「只想改昵称却把状态清空」留机会。
 */
public record UserUpdateRequest(
        @Size(max = 64, message = "昵称最长 64 字符")
        String nickname,

        @Email(message = "邮箱格式不正确")
        @Size(max = 128, message = "邮箱最长 128 字符")
        String email,

        @Pattern(regexp = "^1[3-9]\\d{9}$", message = "手机号格式不正确")
        String phone,

        @NotNull(message = "状态不能为空")
        Integer status
) {
}
