package {{basePackage}}.system.role.dto;

import {{basePackage}}.system.role.domain.SysRole;

import java.time.LocalDateTime;

/**
 * 角色出参。契约字段一字不差（createdAt）—— 实体不直接出接口：
 * 多出去一个内部字段，迟早有人依赖它，想删都删不掉。
 */
public record RoleResponse(
        Long id,
        String name,
        String code,
        String description,
        Integer status,
        LocalDateTime createdAt
) {

    public static RoleResponse from(SysRole role) {
        return new RoleResponse(role.getId(), role.getName(), role.getCode(),
                role.getDescription(), role.getStatus(), role.getCreateTime());
    }
}
