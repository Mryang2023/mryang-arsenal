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
 * 角色实体。JPA 与 MyBatis-Plus 注解共存（与 user 模块同一口径）：
 * 两套持久层共用一份实体，模板按选型只装配一种仓储实现，实体不改。
 *
 * code 是权限体系的外部标识（种子 [SECTION:core] 写入的 ADMIN 与
 * AuthService.ADMIN_ROLE 同一口径），实体不提供改它的 setter 语义 ——
 * 仓储的 update 也只更新 name/description/status。
 */
@Entity
@Table(name = "sys_role")
@TableName("sys_role")
public class SysRole {

    /** 主键，数据库自增 */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @TableId(type = IdType.AUTO)
    private Long id;

    /** 展示名 —— 页面上给人看的角色名（如「系统管理员」） */
    @Column(nullable = false, length = 64)
    private String name;

    /**
     * 角色编码，权限体系的外部标识（鉴权按它直通/判断）。
     * 全局唯一且创建后不可改 —— 种子幂等与 auth 的 ADMIN 直通都锚在编码上。
     */
    @Column(nullable = false, unique = true, length = 64)
    private String code;

    /** 备注说明，纯展示 */
    @Column(length = 255)
    private String description;

    /** 状态：0 正常 1 停用（内置 ADMIN 禁停用，守卫在 service 层） */
    @Column(nullable = false)
    private Integer status;

    /** 创建时间：代码里显式赋值（原因同 user 模块 —— JPA 全字段 INSERT） */
    @Column(name = "create_time", nullable = false, updatable = false)
    private LocalDateTime createTime;

    /** 更新时间：每次写操作同步刷新 */
    @Column(name = "update_time", nullable = false)
    private LocalDateTime updateTime;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public String getDescription() {
        return description;
    }

    public void setDescription(String description) {
        this.description = description;
    }

    public Integer getStatus() {
        return status;
    }

    public void setStatus(Integer status) {
        this.status = status;
    }

    public LocalDateTime getCreateTime() {
        return createTime;
    }

    public void setCreateTime(LocalDateTime createTime) {
        this.createTime = createTime;
    }

    public LocalDateTime getUpdateTime() {
        return updateTime;
    }

    public void setUpdateTime(LocalDateTime updateTime) {
        this.updateTime = updateTime;
    }
}
