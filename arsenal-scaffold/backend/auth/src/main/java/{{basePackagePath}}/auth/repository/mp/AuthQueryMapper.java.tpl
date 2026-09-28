package {{basePackage}}.auth.repository.mp;

import {{basePackage}}.auth.repository.view.LoginUserView;
import {{basePackage}}.auth.repository.view.MenuView;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import java.util.List;

/**
 * 认证侧查询的 MyBatis Mapper。纯连接查询，不继承 BaseMapper（没有对应实体）——
 * 给只读视图硬配一套 CRUD 只会多出一行没人调用的代码。
 *
 * 放在 repository/mp/mapper 子包而不要平铺在 repository 下：
 * 生成器若开了 @MapperScan("{{basePackage}}.**.repository")，同包里的
 * 普通仓储接口会被误注册成 Mapper；MyBatis-Plus 靠自动扫描 @Mapper
 * 注解就能发现它们，无需额外配置。
 */
@Mapper
public interface AuthQueryMapper {

    LoginUserView findLoginUser(@Param("username") String username);

    LoginUserView findUserById(@Param("userId") Long userId);

    List<String> listRoleCodes(@Param("userId") Long userId);

    List<String> listPermissionCodes(@Param("userId") Long userId);

    List<String> listAllPermissionCodes();

    List<MenuView> listMenusForUser(@Param("userId") Long userId);

    List<MenuView> listAllMenus();
}
