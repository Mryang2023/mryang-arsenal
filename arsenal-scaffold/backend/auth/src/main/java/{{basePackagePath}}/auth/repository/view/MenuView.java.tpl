package {{basePackage}}.auth.repository.view;

/**
 * 菜单查询投影。只取渲染侧边栏需要的列 —— create_time 等管理字段
 * 与「当前用户能看到什么」无关，查出来也不该看到。
 *
 * 普通 POJO：MyBatis 驼峰自动映射与 JPA 原生行映射都依赖 getter/setter。
 */
public class MenuView {

    private Long id;
    private Long parentId;
    private String label;
    private String path;
    private String icon;
    private Integer sortNo;
    private String permission;
    /** 状态：0 正常 1 停用 */
    private Integer status;

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
}
