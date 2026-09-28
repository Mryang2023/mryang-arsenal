package {{basePackage}}.auth.service;

import {{basePackage}}.auth.dto.LoginResponse;
import {{basePackage}}.auth.dto.MeResponse;
import {{basePackage}}.auth.dto.MenuNode;
import {{basePackage}}.auth.repository.AuthQueryRepository;
import {{basePackage}}.auth.repository.view.LoginUserView;
import {{basePackage}}.auth.repository.view.MenuView;
import {{basePackage}}.auth.security.JwtService;
import {{basePackage}}.common.ErrorCode;
import {{basePackage}}.common.exception.BizException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 认证业务：登录校验、当前用户信息、菜单树聚合、权限码判定。
 */
@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);

    /** 内置超管角色码（种子写入 sys_role.code），命中即拥有全部权限与菜单 */
    public static final String ADMIN_ROLE = "ADMIN";

    private final AuthQueryRepository repository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;

    public AuthService(AuthQueryRepository repository, PasswordEncoder passwordEncoder, JwtService jwtService) {
        this.repository = repository;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
    }

    /**
     * 登录：BCrypt 校验 + 签发令牌。
     *
     * 失败提示统一为「用户名或密码错误」—— 一旦区分「用户不存在」和「密码错误」，
     * 等于向攻击者广播哪些用户名真实存在。只有「账号被停用」例外：
     * 用户名密码都对还拦着，不给原因会被当成系统 bug。
     */
    public LoginResponse login(String username, String rawPassword) {
        LoginUserView user = repository.findLoginUser(username).orElse(null);
        if (user == null || user.getPassword() == null
                || !passwordEncoder.matches(rawPassword, user.getPassword())) {
            throw new BizException(ErrorCode.UNAUTHORIZED, "用户名或密码错误");
        }
        if (user.getStatus() == null || user.getStatus() != 0) {
            throw new BizException(ErrorCode.FORBIDDEN, "账号已停用，请联系管理员");
        }
        String token = jwtService.issue(user.getId(), user.getUsername());
        return new LoginResponse(token,
                new LoginResponse.UserBrief(user.getId(), user.getUsername(), user.getNickname()));
    }

    /** 当前用户信息。从库里现读而不是回显令牌内容：停用/改名要立即生效。 */
    public MeResponse me(Long userId) {
        LoginUserView user = repository.findUserById(userId)
                .orElseThrow(() -> new BizException(ErrorCode.UNAUTHORIZED, "用户不存在或已删除"));
        return new MeResponse(user.getId(), user.getUsername(), user.getNickname());
    }

    /** ADMIN 直通：内置管理员拥有全部权限码，不必逐条授到表里 */
    public boolean hasPermission(Long userId, String permission) {
        if (isAdmin(userId)) {
            return true;
        }
        return repository.listPermissionCodes(userId).contains(permission);
    }

    private boolean isAdmin(Long userId) {
        return repository.listRoleCodes(userId).contains(ADMIN_ROLE);
    }

    /**
     * 当前用户菜单树。可见性口径：菜单的 permission 为空（目录）或命中用户权限码；
     * ADMIN 看全量。树构建带防环，脏数据只丢弃不抛异常。
     */
    public List<MenuNode> menuTree(Long userId) {
        List<MenuView> rows = isAdmin(userId)
                ? repository.listAllMenus()
                : repository.listMenusForUser(userId);
        return buildTree(rows);
    }

    /**
     * 树构建（防环）。parentId 指向不存在节点的一律按根处理（父菜单被停用/裁剪时，
     * 页面菜单仍然可用）；成环节点到不了任何根，遍历结束后按差值告警 ——
     * 菜单数据是后台维护的，脏数据要「看得见但进不了响应」，而不是死循环。
     */
    private List<MenuNode> buildTree(List<MenuView> rows) {
        Map<Long, MenuNode> nodes = new LinkedHashMap<>();
        for (MenuView row : rows) {
            nodes.put(row.getId(), MenuNode.from(row));
        }
        Map<Long, List<MenuNode>> childrenOf = new HashMap<>();
        List<MenuNode> roots = new ArrayList<>();
        for (MenuView row : rows) {
            MenuNode node = nodes.get(row.getId());
            MenuNode parent = row.getParentId() == null ? null : nodes.get(row.getParentId());
            if (parent == null || parent == node) {
                roots.add(node);
            } else {
                // MenuNode 是 record：访问器是 id() 不是 getId() —— 写错编译期就红
                childrenOf.computeIfAbsent(parent.id(), k -> new ArrayList<>()).add(node);
            }
        }
        Set<Long> linked = new HashSet<>();
        for (MenuNode root : roots) {
            attach(root, childrenOf, linked);
        }
        if (linked.size() < nodes.size()) {
            // 差值就是成环节点数量：日志必须留 —— 它们不会出现在任何响应里，只能靠日志发现
            log.warn("菜单树存在成环节点，已丢弃 {} 个，请检查 sys_menu.parent_id 数据",
                    nodes.size() - linked.size());
        }
        return roots;
    }

    private void attach(MenuNode node, Map<Long, List<MenuNode>> childrenOf, Set<Long> linked) {
        linked.add(node.id());
        List<MenuNode> children = childrenOf.get(node.id());
        if (children == null) {
            return;
        }
        for (MenuNode child : children) {
            if (linked.add(child.id())) {
                attach(child, childrenOf, linked);
                node.children().add(child);
            }
        }
    }
}
