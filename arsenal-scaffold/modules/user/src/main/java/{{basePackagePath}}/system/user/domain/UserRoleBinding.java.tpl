package {{basePackage}}.system.user.domain;

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
 * 用户-角色绑定。字段就是两个外键 + 时间，没有任何业务语义；
 * 实体归 user 模块管（用户查询会连带它），role 模块不反向依赖。
 *
 * JPA 与 MyBatis-Plus 注解共存：两套持久层共用一份实体，
 * 模板按选型只装配一种仓储实现，未选中的注解只是元数据。
 */
@Entity
@Table(name = "sys_user_role")
@TableName("sys_user_role")
public class UserRoleBinding {

    /** 主键，数据库自增 */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @TableId(type = IdType.AUTO)
    private Long id;

    /** 被授权的用户 id（软引用 sys_user，分配时全量替换、不设外键级联） */
    @Column(name = "user_id", nullable = false)
    private Long userId;

    /** 授予的角色 id（软引用 sys_role，有效性在 service 层校验） */
    @Column(name = "role_id", nullable = false)
    private Long roleId;

    /** 绑定时间：代码里显式赋值 */
    @Column(name = "create_time", nullable = false)
    private LocalDateTime createTime;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getUserId() {
        return userId;
    }

    public void setUserId(Long userId) {
        this.userId = userId;
    }

    public Long getRoleId() {
        return roleId;
    }

    public void setRoleId(Long roleId) {
        this.roleId = roleId;
    }

    public LocalDateTime getCreateTime() {
        return createTime;
    }

    public void setCreateTime(LocalDateTime createTime) {
        this.createTime = createTime;
    }
}
