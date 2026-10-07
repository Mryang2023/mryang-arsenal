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
 * 用户实体。JPA 与 MyBatis-Plus 两套注解共存于同一个类：
 * 两套持久层共用一份实体，模板按选型只装配一种仓储实现，实体不改；
 * 未选中的那套注解只是元数据，不会被任何框架读取。
 *
 * 密码哈希在实体里（登录校验要用）—— 但它永远不出 DTO：
 * 对外结构见 UserResponse，那里没有 password 字段。
 *
 * 需求是物理删除模型，没有 deleted 逻辑删除列；删除保护（admin 禁删）
 * 在 SysUserServiceImpl 里做，不靠数据库约束 —— 约束防不住代码写错表。
 */
@Entity
@Table(name = "sys_user")
@TableName("sys_user")
public class SysUser {

    /** 主键，数据库自增 —— 两套持久层都用自增策略，表结构一处定义 */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @TableId(type = IdType.AUTO)
    private Long id;

    /** 登录名，全局唯一（唯一性在 service 层先查再插，数据库唯一索引兜底） */
    @Column(nullable = false, unique = true, length = 64)
    private String username;

    /** 显示名 —— 页面上优先展示它而不是 username */
    @Column(length = 64)
    private String nickname;

    @Column(length = 128)
    private String email;

    @Column(length = 20)
    private String phone;

    /** BCrypt 哈希（$2a$ 开头，60 字符） */
    @Column(name = "password", nullable = false, length = 100)
    private String password;

    /** 状态：0 正常 1 停用（停用 = 登录被拒；内置 admin 禁停用，守卫在 service 层） */
    @Column(nullable = false)
    private Integer status;

    /** 创建时间：代码里显式赋值（JPA 全字段 INSERT 会把 null 写进去，不依赖数据库默认值） */
    @Column(name = "create_time", nullable = false, updatable = false)
    private LocalDateTime createTime;

    /** 更新时间：每次写操作同步刷新，两端实现行为一致 */
    @Column(name = "update_time", nullable = false)
    private LocalDateTime updateTime;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getUsername() {
        return username;
    }

    public void setUsername(String username) {
        this.username = username;
    }

    public String getNickname() {
        return nickname;
    }

    public void setNickname(String nickname) {
        this.nickname = nickname;
    }

    public String getEmail() {
        return email;
    }

    public void setEmail(String email) {
        this.email = email;
    }

    public String getPhone() {
        return phone;
    }

    public void setPhone(String phone) {
        this.phone = phone;
    }

    public String getPassword() {
        return password;
    }

    public void setPassword(String password) {
        this.password = password;
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
