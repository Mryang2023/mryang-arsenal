-- 种子数据（PostgreSQL 方言）。幂等可重跑：CI、演示环境、compose 首次启动
-- 都会反复执行本脚本；每次靠「显式主键 + 唯一键」命中 ON CONFLICT 静默跳过，
-- 而不是报错中断 —— 幂等是种子脚本的底线，不是优化项。
--
-- 与 MySQL 版（shared/sql/mysql/V2__seed.sql.tpl）的刻意差异 —— 不是漂移：
--   1. ON CONFLICT DO NOTHING（MySQL 为 ON DUPLICATE KEY UPDATE id = id）；
--      不写冲突目标：任何唯一键命中都跳过，比逐条写目标更不容易漂移
--   2. 显式 id 插入不会推进 BIGSERIAL 序列 —— 末尾必须补 setval，
--      否则第一条业务 INSERT 必撞主键；MySQL 的显式 id 会自动推进序列，无需这一步
--   3. 注释口径与 MySQL 版一字不差（分段、保留规则、密码策略）
--
-- 显式主键是刻意为之：sys_user_role / sys_role_permission 的绑定行必须
-- 落在已知 id 上，分段裁剪后绑定引用才不悬空；密码列绝不在更新集合里 ——
-- 重跑种子不能把管理员改过的密码冲掉。
--
-- 分段与保留规则（生成器按模块选型裁剪，段名不要改）：
--   [SECTION:core]       admin 账号 + ADMIN 角色 + 绑定   —— 始终保留
--   [SECTION:permission] 按钮权限码 + ADMIN 全量授权      —— 选择 role 模块时保留
--   [SECTION:menu]       菜单树种子                       —— 选择 menu 模块时保留
-- 只裁 [SECTION:menu] 而保留 [SECTION:permission] 时，权限行的 menu_id
-- 指向不存在的菜单：权限树把查不到的菜单归入「未分组的菜单」，属预期行为。
--
-- 初始账号：admin / admin123（对应明文 admin123，首次登录后请修改；
-- 该哈希由机器生成并经 javac 同源校验，两种数据库共用同一哈希。）

-- ===== [SECTION:core] =====
INSERT INTO sys_user (id, username, nickname, password, status)
VALUES (1, 'admin', '系统管理员', '$2a$10$8fhl7kBiVnYpkEF46O4e0.hbiwDX7gpc6iZxaiak6D/SYAd2SrKji', 0)
ON CONFLICT DO NOTHING;

INSERT INTO sys_role (id, name, code, description, status)
VALUES (1, '超级管理员', 'ADMIN', '内置角色：拥有全部权限与菜单，禁删禁停用', 0)
ON CONFLICT DO NOTHING;

INSERT INTO sys_user_role (id, user_id, role_id, create_time)
VALUES (1, 1, 1, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- ===== [SECTION:permission] =====
-- 15 个权限码：user 6 + role 5 + menu 4。menu_id 指向 [SECTION:menu] 的菜单行；
-- 菜单段被裁剪时这些引用落空，权限树按「未分组的菜单」兜底（role 模块行为）。
INSERT INTO sys_permission (id, code, name, menu_id, create_time) VALUES
(1,  'sys:user:list',       '用户查询', 2, CURRENT_TIMESTAMP),
(2,  'sys:user:save',       '用户新增', 2, CURRENT_TIMESTAMP),
(3,  'sys:user:update',     '用户编辑', 2, CURRENT_TIMESTAMP),
(4,  'sys:user:delete',     '用户删除', 2, CURRENT_TIMESTAMP),
(5,  'sys:user:resetPwd',   '重置密码', 2, CURRENT_TIMESTAMP),
(6,  'sys:user:assignRole', '分配角色', 2, CURRENT_TIMESTAMP),
(7,  'sys:role:list',       '角色查询', 3, CURRENT_TIMESTAMP),
(8,  'sys:role:save',       '角色新增', 3, CURRENT_TIMESTAMP),
(9,  'sys:role:update',     '角色编辑', 3, CURRENT_TIMESTAMP),
(10, 'sys:role:delete',     '角色删除', 3, CURRENT_TIMESTAMP),
(11, 'sys:role:assignPerm', '分配权限', 3, CURRENT_TIMESTAMP),
(12, 'sys:menu:list',       '菜单查询', 4, CURRENT_TIMESTAMP),
(13, 'sys:menu:save',       '菜单新增', 4, CURRENT_TIMESTAMP),
(14, 'sys:menu:update',     '菜单编辑', 4, CURRENT_TIMESTAMP),
(15, 'sys:menu:delete',     '菜单删除', 4, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- ADMIN 全量授权（15 条绑定，显式 id 1..15）。绑定行落在 [SECTION:permission]；
-- 裁掉本段则 ADMIN 直通退化为逐条授权 —— 语义一致（auth 的 ADMIN 直通按角色码判定）。
INSERT INTO sys_role_permission (id, role_id, permission_id, create_time) VALUES
(1,  1, 1,  CURRENT_TIMESTAMP),
(2,  1, 2,  CURRENT_TIMESTAMP),
(3,  1, 3,  CURRENT_TIMESTAMP),
(4,  1, 4,  CURRENT_TIMESTAMP),
(5,  1, 5,  CURRENT_TIMESTAMP),
(6,  1, 6,  CURRENT_TIMESTAMP),
(7,  1, 7,  CURRENT_TIMESTAMP),
(8,  1, 8,  CURRENT_TIMESTAMP),
(9,  1, 9,  CURRENT_TIMESTAMP),
(10, 1, 10, CURRENT_TIMESTAMP),
(11, 1, 11, CURRENT_TIMESTAMP),
(12, 1, 12, CURRENT_TIMESTAMP),
(13, 1, 13, CURRENT_TIMESTAMP),
(14, 1, 14, CURRENT_TIMESTAMP),
(15, 1, 15, CURRENT_TIMESTAMP)
ON CONFLICT DO NOTHING;

-- ===== [SECTION:menu] =====
-- 1 个目录 + 3 个页面菜单，与 module.json 的 menus 字段一一对应
-- （title/path/permission/icon 四元组一字不差）。
INSERT INTO sys_menu (id, parent_id, label, path, icon, sort_no, permission, status) VALUES
(1, NULL, '系统管理', '/system',      'setting', 1, NULL,           0),
(2, 1,    '用户管理', '/system/user', 'user',    1, 'sys:user:list', 0),
(3, 1,    '角色管理', '/system/role', 'team',    2, 'sys:role:list', 0),
(4, 1,    '菜单管理', '/system/menu', 'menu',    3, 'sys:menu:list', 0)
ON CONFLICT DO NOTHING;

-- 显式 id 插入不推进序列：六表各补一次 setval，否则第一条业务 INSERT 必撞主键。
-- MySQL 无此步（显式 id 自动推进 AUTO_INCREMENT）；两种库的种子语义一致。
SELECT setval(pg_get_serial_sequence('sys_user', 'id'),
              GREATEST((SELECT COALESCE(MAX(id), 1) FROM sys_user), 1));
SELECT setval(pg_get_serial_sequence('sys_role', 'id'),
              GREATEST((SELECT COALESCE(MAX(id), 1) FROM sys_role), 1));
SELECT setval(pg_get_serial_sequence('sys_permission', 'id'),
              GREATEST((SELECT COALESCE(MAX(id), 1) FROM sys_permission), 1));
SELECT setval(pg_get_serial_sequence('sys_menu', 'id'),
              GREATEST((SELECT COALESCE(MAX(id), 1) FROM sys_menu), 1));
SELECT setval(pg_get_serial_sequence('sys_user_role', 'id'),
              GREATEST((SELECT COALESCE(MAX(id), 1) FROM sys_user_role), 1));
SELECT setval(pg_get_serial_sequence('sys_role_permission', 'id'),
              GREATEST((SELECT COALESCE(MAX(id), 1) FROM sys_role_permission), 1));
