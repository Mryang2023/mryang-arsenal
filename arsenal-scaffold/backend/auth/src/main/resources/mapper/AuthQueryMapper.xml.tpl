<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
        "http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<!--
  认证侧聚合查询的 SQL。连接查询不走 Wrapper 也不建查询实体 ——
  这些 SQL 读的是「视图」而不是「可变实体」，列名与 db/schema 一字不差。
  mapUnderscoreToCamelCase 默认开启：parent_id/sort_no 自动映射 parentId/sortNo。
-->
<mapper namespace="{{basePackage}}.auth.repository.mp.AuthQueryMapper">

    <select id="findLoginUser" resultType="{{basePackage}}.auth.repository.view.LoginUserView">
        SELECT id, username, password, nickname, status
        FROM sys_user
        WHERE username = #{username}
    </select>

    <select id="findUserById" resultType="{{basePackage}}.auth.repository.view.LoginUserView">
        SELECT id, username, password, nickname, status
        FROM sys_user
        WHERE id = #{userId}
    </select>

    <select id="listRoleCodes" resultType="string">
        SELECT r.code
        FROM sys_role r
        JOIN sys_user_role ur ON ur.role_id = r.id
        WHERE ur.user_id = #{userId}
          AND r.status = 0
    </select>

    <!-- 用户权限码子查询与 JPA 实现的 USER_PERMISSION_CODES 同源：
         「角色须启用」的口径改一处必须两处同步，两条实现各持一份 -->
    <select id="listPermissionCodes" resultType="string">
        SELECT DISTINCT p.code
        FROM sys_permission p
        JOIN sys_role_permission rp ON rp.permission_id = p.id
        JOIN sys_user_role ur ON ur.role_id = rp.role_id
        JOIN sys_role r ON r.id = rp.role_id
        WHERE ur.user_id = #{userId}
          AND r.status = 0
    </select>

    <select id="listAllPermissionCodes" resultType="string">
        SELECT code
        FROM sys_permission
    </select>

    <!-- 可见菜单：目录（permission 为空）恒可见，页面菜单要求权限码命中；
         排序在 SQL 收口（sort_no, id），树构建只管组装不管排序 -->
    <select id="listMenusForUser" resultType="{{basePackage}}.auth.repository.view.MenuView">
        SELECT m.id, m.parent_id, m.label, m.path, m.icon, m.sort_no, m.permission, m.status
        FROM sys_menu m
        WHERE m.status = 0
          AND (m.permission IS NULL OR m.permission IN (
              SELECT p.code
              FROM sys_permission p
              JOIN sys_role_permission rp ON rp.permission_id = p.id
              JOIN sys_user_role ur ON ur.role_id = rp.role_id
              JOIN sys_role r ON r.id = rp.role_id
              WHERE ur.user_id = #{userId}
                AND r.status = 0))
        ORDER BY m.sort_no, m.id
    </select>

    <select id="listAllMenus" resultType="{{basePackage}}.auth.repository.view.MenuView">
        SELECT m.id, m.parent_id, m.label, m.path, m.icon, m.sort_no, m.permission, m.status
        FROM sys_menu m
        WHERE m.status = 0
        ORDER BY m.sort_no, m.id
    </select>

</mapper>
