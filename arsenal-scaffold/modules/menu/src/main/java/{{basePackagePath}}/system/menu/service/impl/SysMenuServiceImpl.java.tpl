package {{basePackage}}.system.menu.service.impl;

import {{basePackage}}.common.ErrorCode;
import {{basePackage}}.common.exception.BizException;
import {{basePackage}}.system.menu.domain.SysMenu;
import {{basePackage}}.system.menu.dto.MenuSaveRequest;
import {{basePackage}}.system.menu.dto.MenuTreeNode;
import {{basePackage}}.system.menu.dto.MenuUpdateRequest;
import {{basePackage}}.system.menu.repository.SysMenuRepository;
import {{basePackage}}.system.menu.service.SysMenuService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 菜单业务实现。事务边界在这一层：@Transactional 只写在 public 方法上
 * （代理只拦外部调用，类内自调用不生效），查询方法标 readOnly。
 */
@Service
public class SysMenuServiceImpl implements SysMenuService {

    private static final Logger log = LoggerFactory.getLogger(SysMenuServiceImpl.class);

    /** 父链检查的深度上限：超过即判定成环 —— 菜单树不该比这更深 */
    private static final int MAX_DEPTH = 64;

    private final SysMenuRepository menuRepository;

    public SysMenuServiceImpl(SysMenuRepository menuRepository) {
        this.menuRepository = menuRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public List<MenuTreeNode> tree() {
        // 管理端树返回全量（含停用）：停用的菜单要先能看见才能重新启用
        return buildTree(menuRepository.findAll());
    }

    @Override
    @Transactional
    public Long create(MenuSaveRequest req) {
        validateParent(req.parentId(), null);
        SysMenu menu = new SysMenu();
        apply(menu, req.parentId(), req.label(), req.path(), req.icon(),
                req.sortNo(), req.permission(), req.status());
        // 时间在代码里赋值而不依赖数据库默认值：JPA 全字段 INSERT 会把 null 写进去，
        // 显式赋值让 JPA 与 MyBatis-Plus 两条实现行为一致
        LocalDateTime now = LocalDateTime.now();
        menu.setCreateTime(now);
        menu.setUpdateTime(now);
        return menuRepository.insert(menu);
    }

    @Override
    @Transactional
    public void update(Long id, MenuUpdateRequest req) {
        SysMenu menu = menuRepository.findById(id)
                .orElseThrow(() -> notFound(id));
        validateParent(req.parentId(), id);
        // 父链成环检查：把自己挂到自己的子孙下面，树构建会静默丢节点，必须在这里拦住
        guardNoCycle(id, req.parentId());
        apply(menu, req.parentId(), req.label(), req.path(), req.icon(),
                req.sortNo(), req.permission(), req.status());
        menu.setUpdateTime(LocalDateTime.now());
        menuRepository.update(menu);
    }

    /**
     * 物理删除。有子菜单先拒绝 —— 级联删除会把「误删一个目录 = 删掉半棵树」
     * 变成一次点击就能完成的事故。
     */
    @Override
    @Transactional
    public void delete(Long id) {
        if (menuRepository.existsByParentId(id)) {
            throw new BizException(ErrorCode.CONFLICT, "存在子菜单，请先删除子菜单");
        }
        menuRepository.deleteById(id);
    }

    private void validateParent(Long parentId, Long selfId) {
        if (parentId == null) {
            return;
        }
        if (parentId.equals(selfId)) {
            throw new BizException(ErrorCode.CONFLICT, "父菜单不能是自己");
        }
        menuRepository.findById(parentId)
                .orElseThrow(() -> new BizException(ErrorCode.NOT_FOUND, "父菜单不存在: id=" + parentId));
    }

    private void guardNoCycle(Long selfId, Long parentId) {
        Long cursor = parentId;
        int hops = 0;
        while (cursor != null && hops++ < MAX_DEPTH) {
            if (cursor.equals(selfId)) {
                throw new BizException(ErrorCode.CONFLICT, "不能把菜单挂到自己的子孙节点下");
            }
            cursor = menuRepository.findById(cursor).map(SysMenu::getParentId).orElse(null);
        }
    }

    private static void apply(SysMenu menu, Long parentId, String label, String path,
                              String icon, Integer sortNo, String permission, Integer status) {
        menu.setParentId(parentId);
        menu.setLabel(label);
        menu.setPath(path);
        menu.setIcon(icon);
        menu.setSortNo(sortNo == null ? 0 : sortNo);
        menu.setPermission(permission);
        menu.setStatus(status);
    }

    /**
     * 树构建（防环）。parentId 指向不存在节点的一律按根处理（父菜单被停用/裁剪时，
     * 页面菜单仍然可用）；成环节点到不了任何根，遍历结束后按差值告警 ——
     * 菜单数据是后台维护的，脏数据要「看得见但进不了响应」，而不是死循环。
     *
     * 口径与 auth 模块 AuthService.buildTree 一致。两个模块各自持有一份：
     * 菜单模块不能反向依赖 auth，反之亦然；这段逻辑不到 40 行，复制比引出
     * 公共依赖更便宜。MenuTreeNode 是 record：访问器是 id() 不是 getId()。
     */
    private List<MenuTreeNode> buildTree(List<SysMenu> rows) {
        Map<Long, MenuTreeNode> nodes = new LinkedHashMap<>();
        for (SysMenu row : rows) {
            nodes.put(row.getId(), MenuTreeNode.from(row));
        }
        Map<Long, List<MenuTreeNode>> childrenOf = new HashMap<>();
        List<MenuTreeNode> roots = new ArrayList<>();
        for (SysMenu row : rows) {
            MenuTreeNode node = nodes.get(row.getId());
            MenuTreeNode parent = row.getParentId() == null ? null : nodes.get(row.getParentId());
            if (parent == null || parent == node) {
                roots.add(node);
            } else {
                childrenOf.computeIfAbsent(parent.id(), k -> new ArrayList<>()).add(node);
            }
        }
        Set<Long> linked = new HashSet<>();
        for (MenuTreeNode root : roots) {
            attach(root, childrenOf, linked);
        }
        if (linked.size() < nodes.size()) {
            // 差值就是成环节点数量：日志必须留 —— 它们不会出现在任何响应里，只能靠日志发现
            log.warn("菜单树存在成环节点，已丢弃 {} 个，请检查 sys_menu.parent_id 数据",
                    nodes.size() - linked.size());
        }
        return roots;
    }

    private void attach(MenuTreeNode node, Map<Long, List<MenuTreeNode>> childrenOf, Set<Long> linked) {
        linked.add(node.id());
        List<MenuTreeNode> children = childrenOf.get(node.id());
        if (children == null) {
            return;
        }
        for (MenuTreeNode child : children) {
            if (linked.add(child.id())) {
                attach(child, childrenOf, linked);
                node.children().add(child);
            }
        }
    }

    private static BizException notFound(Long id) {
        return new BizException(ErrorCode.NOT_FOUND, "菜单不存在: id=" + id);
    }
}
