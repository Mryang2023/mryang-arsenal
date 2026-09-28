package {{basePackage}}.system.role.repository.view;

/**
 * 菜单标签投影（权限树分组用）。只要 id + label 两列：
 * 分组展示需要的就这么多，多查一列都是给将来留隐患。
 */
public class MenuLabelView {

    private Long id;
    private String label;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getLabel() {
        return label;
    }

    public void setLabel(String label) {
        this.label = label;
    }
}
