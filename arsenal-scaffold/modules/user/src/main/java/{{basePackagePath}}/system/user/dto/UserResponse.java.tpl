package {{basePackage}}.system.user.dto;

import {{basePackage}}.system.user.domain.SysUser;

import java.time.LocalDateTime;

/**
 * 用户出参。契约字段一字不差（createdAt，不是 createTime 的直译）——
 * 实体不直接出接口：多出去一个内部字段，迟早有人依赖它，想删都删不掉；
 * password 留在实体里，出参里出现密码字段迟早被序列化出去。
 */
public record UserResponse(
        Long id,
        String username,
        String nickname,
        String email,
        String phone,
        Integer status,
        LocalDateTime createdAt
) {

    public static UserResponse from(SysUser user) {
        return new UserResponse(user.getId(), user.getUsername(), user.getNickname(),
                user.getEmail(), user.getPhone(), user.getStatus(), user.getCreateTime());
    }
}
