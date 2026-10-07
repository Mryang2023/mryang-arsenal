package {{basePackage}}.system.menu.domain;

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
 * 菜单实体。JPA 与 MyBatis-Plus 注解共存（三模块同一口径）。
 *
 * permission 是软引用：指向 sys_permission.code。生成器裁掉 [SECTION:permission]
 * 种子段时，permission 落空的菜单对非 ADMIN 用户不可见 —— 不用外键锁死，
 * 因为权限段与菜单段允许被生成器分开裁剪。
 */
@Entity
@Table(name = "sys_menu")
@TableName("sys_menu")
public class SysMenu {

    /** 主键，数据库自增 */
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @TableId(type = IdType.AUTO)
    private Long id;

    /** 父菜单 id；NULL 表示根节点。树在服务层构建（防环、按 sortNo 排序）。 */
    @Column(name = "parent_id")
    private Long parentId;

    /** 菜单显示名（侧边栏与面包屑用它） */
    @Column(nullable = false, length = 64)
    private String label;

    /** 前端路由路径（如 /system/user）；目录型菜单可为空 */
    @Column(length = 128)
    private String path;

    /** 图标标识，前端图标库的 key */
    @Column(length = 64)
    private String icon;

    /** 排序号：同层菜单按它稳定排序（服务层建树时保证） */
    @Column(name = "sort_no", nullable = false)
    private Integer sortNo;

    /** 访问该菜单所需权限码（软引用 sys_permission.code，语义见类注释） */
    @Column(length = 128)
    private String permission;

    /** 状态：0 正常 1 停用（停用的菜单不进树） */
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

    public Long getParentId() {
        return parentId;
    }

    public void setParentId(Long parentId) {
        this.parentId = parentId;
    }

    public String getLabel() {
        return label;
    }

    public void setLabel(String label) {
        this.label = label;
    }

    public String getPath() {
        return path;
    }

    public void setPath(String path) {
        this.path = path;
    }

    public String getIcon() {
        return icon;
    }

    public void setIcon(String icon) {
        this.icon = icon;
    }

    public Integer getSortNo() {
        return sortNo;
    }

    public void setSortNo(Integer sortNo) {
        this.sortNo = sortNo;
    }

    public String getPermission() {
        return permission;
    }

    public void setPermission(String permission) {
        this.permission = permission;
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
