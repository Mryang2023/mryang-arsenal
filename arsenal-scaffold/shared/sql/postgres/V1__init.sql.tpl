-- 系统六表 DDL（PostgreSQL 方言）。
-- 与 MySQL 版（shared/sql/mysql/V1__init.sql.tpl）同一套表，刻意差异逐条列出 —— 不是漂移：
--   1. 主键 BIGSERIAL（MySQL 为 bigint unsigned AUTO_INCREMENT；PG 没有 unsigned）
--   2. 时间统一 timestamptz（MySQL 为 datetime）
--   3. 注释用 COMMENT ON（PG 不支持 MySQL 的行内 COMMENT 语法）
--   4. update_time 不配 ON UPDATE 触发器：两种库的更新时间都由应用层赋值
--      （各 service 的 setUpdateTime），行为在 JPA 与 MyBatis-Plus 两条实现里一致
--   5. 全部 IF NOT EXISTS：脚本会被 CI 与 compose 首次启动反复执行，重跑不报错是底线
-- 列名与两种数据库各自一份一字不差；六表约定同 db/schema.sql。

CREATE TABLE IF NOT EXISTS sys_user
(
    id          BIGSERIAL PRIMARY KEY,
    username    VARCHAR(64)  NOT NULL,
    nickname    VARCHAR(64),
    email       VARCHAR(128),
    phone       VARCHAR(20),
    password    VARCHAR(100) NOT NULL,
    status      SMALLINT     NOT NULL DEFAULT 0,
    create_time TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_sys_user_username UNIQUE (username)
);
COMMENT ON TABLE sys_user IS '系统用户表';
COMMENT ON COLUMN sys_user.username IS '登录标识';
COMMENT ON COLUMN sys_user.password IS 'BCrypt 哈希';
COMMENT ON COLUMN sys_user.status IS '状态：0正常 1停用';

CREATE TABLE IF NOT EXISTS sys_role
(
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(64)  NOT NULL,
    code        VARCHAR(64)  NOT NULL,
    description VARCHAR(255),
    status      SMALLINT     NOT NULL DEFAULT 0,
    create_time TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_sys_role_code UNIQUE (code)
);
COMMENT ON TABLE sys_role IS '角色表';
COMMENT ON COLUMN sys_role.code IS '角色编码（权限体系外部标识，如 ADMIN）';

CREATE TABLE IF NOT EXISTS sys_permission
(
    id          BIGSERIAL PRIMARY KEY,
    code        VARCHAR(128) NOT NULL,
    name        VARCHAR(64)  NOT NULL,
    menu_id     BIGINT,
    create_time TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_sys_permission_code UNIQUE (code)
);
COMMENT ON TABLE sys_permission IS '权限码表';
COMMENT ON COLUMN sys_permission.code IS '权限码（与 @RequirePermission 一一对应）';
COMMENT ON COLUMN sys_permission.menu_id IS '所属菜单（软引用，可空；菜单模块被裁剪时归入未分组）';

CREATE TABLE IF NOT EXISTS sys_menu
(
    id          BIGSERIAL PRIMARY KEY,
    parent_id   BIGINT,
    label       VARCHAR(64)  NOT NULL,
    path        VARCHAR(128) NOT NULL,
    icon        VARCHAR(64),
    sort_no     INT          NOT NULL DEFAULT 0,
    permission  VARCHAR(128),
    status      SMALLINT     NOT NULL DEFAULT 0,
    create_time TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    update_time TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_sys_menu_path UNIQUE (path)
);
COMMENT ON TABLE sys_menu IS '菜单表';
COMMENT ON COLUMN sys_menu.parent_id IS '父菜单；NULL 为根';
COMMENT ON COLUMN sys_menu.permission IS '可见性权限码（空 = 目录恒可见）';

CREATE TABLE IF NOT EXISTS sys_user_role
(
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT       NOT NULL,
    role_id     BIGINT       NOT NULL,
    create_time TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_sys_user_role UNIQUE (user_id, role_id)
);
COMMENT ON TABLE sys_user_role IS '用户-角色绑定表';

CREATE TABLE IF NOT EXISTS sys_role_permission
(
    id            BIGSERIAL PRIMARY KEY,
    role_id       BIGINT      NOT NULL,
    permission_id BIGINT      NOT NULL,
    create_time   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_sys_role_permission UNIQUE (role_id, permission_id)
);
COMMENT ON TABLE sys_role_permission IS '角色-权限绑定表';

CREATE INDEX IF NOT EXISTS idx_sys_menu_parent_id ON sys_menu (parent_id);
CREATE INDEX IF NOT EXISTS idx_sys_permission_menu_id ON sys_permission (menu_id);
CREATE INDEX IF NOT EXISTS idx_sys_user_role_role_id ON sys_user_role (role_id);
CREATE INDEX IF NOT EXISTS idx_sys_role_permission_permission_id ON sys_role_permission (permission_id);
