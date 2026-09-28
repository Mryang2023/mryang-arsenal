<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
        "http://mybatis.org/dtd/mybatis-3-mapper.dtd">
<!--
  权限树分组用的一条跨表只读查询。namespace 与 Mapper 接口全限定名一字不差；
  列名与 db/schema 一字不差。菜单的写路径仍只在 menu 模块 ——
  这里只读 sys_menu 的 id 与 label，跨表读不构成模块依赖。
-->
<mapper namespace="{{basePackage}}.system.role.repository.mp.mapper.SysPermissionMapper">

    <select id="listMenuLabels" resultType="{{basePackage}}.system.role.repository.view.MenuLabelView">
        SELECT id, label
        FROM sys_menu
        ORDER BY id
    </select>

</mapper>
