package {{basePackage}}.system.role.domain;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.LocalDateTime;

/**
 * 角色-权限绑定。字段就是两个外键 + 时间，没有业务语义；
 * 实体归 role 模块管（角色授权连带它），user 模块不反向依赖。
 */
@Entity
@Table(name = "sys_role_permission")
@TableName("sys_role_permission")
public class RolePermissionBinding {

    /** 主键，数据库自增 */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @TableId(type = IdType.AUTO)
    private Long id;

    /** 被授权的角色 id（软引用 sys_role，分配时全量替换、不设外键级联） */
    @Column(name = "role_id", nullable = false)
    private Long roleId;

    /** 授予的权限 id（软引用 sys_permission，有效性在 service 层校验） */
    @Column(name = "permission_id", nullable = false)
    private Long permissionId;

    /** 绑定时间：代码里显式赋值 */
    @Column(name = "create_time", nullable = false)
    private LocalDateTime createTime;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getRoleId() {
        return roleId;
    }

    public void setRoleId(Long roleId) {
        this.roleId = roleId;
    }

    public Long getPermissionId() {
        return permissionId;
    }

    public void setPermissionId(Long permissionId) {
        this.permissionId = permissionId;
    }

    public LocalDateTime getCreateTime() {
        return createTime;
    }

    public void setCreateTime(LocalDateTime createTime) {
        this.createTime = createTime;
    }
}
