package {{basePackage}}.auth.dto;

import {{basePackage}}.auth.repository.view.MenuView;

import java.util.ArrayList;
import java.util.List;

/**
 * 菜单树节点（登录用户视角）。字段与前端契约一字不差：
 * 契约之外的字段宁可不出 —— 多出去一个，迟早有人依赖它，想删都删不掉。
 *
 * record 组件 children 是可变列表：树在构建时原地挂接，
 * 这里不追求不可变，避免为挂孩子再引入 builder。
 */
public record MenuNode(Long id, String label, String path, String icon,
                       String permission, List<MenuNode> children) {

    public static MenuNode from(MenuView view) {
        return new MenuNode(view.getId(), view.getLabel(), view.getPath(),
                view.getIcon(), view.getPermission(), new ArrayList<>());
    }
}
