package {{basePackage}}.system.user.service;

import {{basePackage}}.common.PageResult;
import {{basePackage}}.system.user.dto.UserCreateRequest;
import {{basePackage}}.system.user.dto.UserPasswordResetRequest;
import {{basePackage}}.system.user.dto.UserQuery;
import {{basePackage}}.system.user.dto.UserResponse;
import {{basePackage}}.system.user.dto.UserRoleAssignRequest;
import {{basePackage}}.system.user.dto.UserUpdateRequest;

/**
 * 用户业务接口。控制器与实现之间隔着它 —— 测试替换、换持久层时，
 * 上层一行不改。方法集合就是页面上真实存在的操作，
 * 不为「将来可能用到」预留任何方法。
 */
public interface SysUserService {

    /** 建用户并返回 id。 */
    Long create(UserCreateRequest req);

    UserResponse getById(Long id);

    PageResult<UserResponse> page(UserQuery query);

    void update(Long id, UserUpdateRequest req);

    /** 物理删除；内置 admin 与当前登录人由 service 层拦下。 */
    void delete(Long id);

    /** 管理员重置密码（BCrypt 加密落库）。 */
    void resetPassword(Long id, UserPasswordResetRequest req);

    /** 全量替换用户角色。 */
    void assignRoles(Long id, UserRoleAssignRequest req);
}
