package {{basePackage}}.auth.repository.mp;

import {{basePackage}}.auth.repository.AuthQueryRepository;
import {{basePackage}}.auth.repository.view.LoginUserView;
import {{basePackage}}.auth.repository.view.MenuView;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

/**
 * 认证侧查询的 MyBatis-Plus 实现。SQL 全部在 resources/mapper/AuthQueryMapper.xml，
 * 方法与 XML 一一对应 —— 连接查询不走 Wrapper，也不为只读视图建实体。
 */
@Repository
public class AuthQueryRepositoryMpImpl implements AuthQueryRepository {

    private final AuthQueryMapper mapper;

    public AuthQueryRepositoryMpImpl(AuthQueryMapper mapper) {
        this.mapper = mapper;
    }

    @Override
    public Optional<LoginUserView> findLoginUser(String username) {
        return Optional.ofNullable(mapper.findLoginUser(username));
    }

    @Override
    public Optional<LoginUserView> findUserById(Long userId) {
        return Optional.ofNullable(mapper.findUserById(userId));
    }

    @Override
    public List<String> listRoleCodes(Long userId) {
        return mapper.listRoleCodes(userId);
    }

    @Override
    public List<String> listPermissionCodes(Long userId) {
        return mapper.listPermissionCodes(userId);
    }

    @Override
    public List<String> listAllPermissionCodes() {
        return mapper.listAllPermissionCodes();
    }

    @Override
    public List<MenuView> listMenusForUser(Long userId) {
        return mapper.listMenusForUser(userId);
    }

    @Override
    public List<MenuView> listAllMenus() {
        return mapper.listAllMenus();
    }
}
