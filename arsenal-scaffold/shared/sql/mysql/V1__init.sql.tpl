-- 系统六表 DDL（MySQL 方言）。
-- 约定与 db/schema.sql 一致：
--   1. 主键统一 bigint unsigned 自增 —— varchar 做主键索引膨胀且无顺序
--   2. 每张表必带 create_time / update_time，且都有默认值
--   3. 索引命名：唯一索引 uk_ 前缀，普通索引 idx_ 前缀
-- 与老 schema 的两处差异是刻意的，不是漂移：
--   a. 没有 deleted 列 —— 需求是物理删除；「admin 禁删」是业务保护，
--      放在 service 层（SysUserServiceImpl），数据库约束防不住代码写错表
--   b. 全表 IF NOT EXISTS：脚本会被演示环境反复执行，重跑不报错是底线
-- 本文件不含模板占位符：两种数据库各持一份，六表列名一字不差。

CREATE TABLE IF NOT EXISTS `sys_user`
(
    `id`          bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
    `username`    varchar(64)     NOT NULL COMMENT '用户名（登录标识）',
    `nickname`    varchar(64)              DEFAULT NULL COMMENT '显示名',
    `email`       varchar(128)             DEFAULT NULL COMMENT '邮箱',
    `phone`       varchar(20)              DEFAULT NULL COMMENT '手机号',
    `password`    varchar(100)    NOT NULL COMMENT 'BCrypt 哈希',
    `status`      tinyint         NOT NULL DEFAULT 0 COMMENT '状态：0正常 1停用',
    `create_time` datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time` datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_username` (`username`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_general_ci COMMENT ='系统用户表';

CREATE TABLE IF NOT EXISTS `sys_role`
(
    `id`          bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
    `name`        varchar(64)     NOT NULL COMMENT '角色名',
    `code`        varchar(64)     NOT NULL COMMENT '角色编码（权限体系外部标识，如 ADMIN）',
    `description` varchar(255)             DEFAULT NULL COMMENT '描述',
    `status`      tinyint         NOT NULL DEFAULT 0 COMMENT '状态：0正常 1停用',
    `create_time` datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time` datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_code` (`code`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_general_ci COMMENT ='角色表';

CREATE TABLE IF NOT EXISTS `sys_permission`
(
    `id`          bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
    `code`        varchar(128)    NOT NULL COMMENT '权限码（与 @RequirePermission 一一对应）',
    `name`        varchar(64)     NOT NULL COMMENT '权限名',
    `menu_id`     bigint unsigned          DEFAULT NULL COMMENT '所属菜单（软引用，可空；菜单段被裁剪时归入未分组）',
    `create_time` datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_code` (`code`),
    KEY `idx_menu_id` (`menu_id`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_general_ci COMMENT ='权限码表';

CREATE TABLE IF NOT EXISTS `sys_menu`
(
    `id`          bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
    `parent_id`   bigint unsigned          DEFAULT NULL COMMENT '父菜单；NULL 为根',
    `label`       varchar(64)     NOT NULL COMMENT '菜单名',
    `path`        varchar(128)             DEFAULT NULL COMMENT '前端路由',
    `icon`        varchar(64)              DEFAULT NULL COMMENT '图标',
    `sort_no`     int             NOT NULL DEFAULT 0 COMMENT '排序号',
    `permission`  varchar(128)             DEFAULT NULL COMMENT '可见性权限码（空 = 目录恒可见）',
    `status`      tinyint         NOT NULL DEFAULT 0 COMMENT '状态：0正常 1停用',
    `create_time` datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    `update_time` datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_path` (`path`),
    KEY `idx_parent_id` (`parent_id`),
    KEY `idx_permission` (`permission`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_general_ci COMMENT ='菜单表';

CREATE TABLE IF NOT EXISTS `sys_user_role`
(
    `id`          bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
    `user_id`     bigint unsigned NOT NULL COMMENT '用户',
    `role_id`     bigint unsigned NOT NULL COMMENT '角色',
    `create_time` datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_user_role` (`user_id`, `role_id`),
    KEY `idx_role_id` (`role_id`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_general_ci COMMENT ='用户-角色绑定表';

CREATE TABLE IF NOT EXISTS `sys_role_permission`
(
    `id`            bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键',
    `role_id`       bigint unsigned NOT NULL COMMENT '角色',
    `permission_id` bigint unsigned NOT NULL COMMENT '权限',
    `create_time`   datetime        NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
    PRIMARY KEY (`id`),
    UNIQUE KEY `uk_role_perm` (`role_id`, `permission_id`),
    KEY `idx_permission_id` (`permission_id`)
) ENGINE = InnoDB
  DEFAULT CHARSET = utf8mb4
  COLLATE = utf8mb4_general_ci COMMENT ='角色-权限绑定表';
