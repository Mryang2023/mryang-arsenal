package {{basePackage}}.system.menu.repository.mp.mapper;

import {{basePackage}}.system.menu.domain.SysMenu;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;

/**
 * sys_menu 的 BaseMapper。放在 repository/mp/mapper 子包而不要平铺在
 * repository 下：生成器若开了 @MapperScan("{{basePackage}}.**.repository")，
 * 同包里的普通仓储接口会被误注册成 Mapper；MP 靠自动扫描 @Mapper
 * 注解就能发现它们，无需额外配置。
 */
@Mapper
public interface SysMenuMapper extends BaseMapper<SysMenu> {
}
