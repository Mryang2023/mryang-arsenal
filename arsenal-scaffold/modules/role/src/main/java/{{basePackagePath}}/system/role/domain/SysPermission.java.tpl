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
 * 权限码实体。code 唯一，与接口上的 @RequirePermission 一一对应；
 * menuId 指向所属菜单（可空）—— 权限树按它分组展示。
 *
 * menuId 是软引用：生成器允许只保留 [SECTION:permission] 种子而裁掉菜单段，
 * 指向不存在菜单的权限在权限树里归入「未分组的菜单」照常可授 ——
 * 不用外键约束锁死，因为模块可以被单独裁剪。
 */
@Entity
@Table(name = "sys_permission")
@TableName("sys_permission")
public class SysPermission {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    @TableId(type = IdType.AUTO)
    private Long id;

    /** 权限码，如 sys:user:save；唯一。 */
    @Column(nullable = false, unique = true, length = 128)
    private String code;

    @Column(nullable = false, length = 64)
    private String name;

    @Column(name = "menu_id")
    private Long menuId;

    @Column(name = "create_time", nullable = false)
    private LocalDateTime createTime;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public Long getMenuId() {
        return menuId;
    }

    public void setMenuId(Long menuId) {
        this.menuId = menuId;
    }

    public LocalDateTime getCreateTime() {
        return createTime;
    }

    public void setCreateTime(LocalDateTime createTime) {
        this.createTime = createTime;
    }
}
