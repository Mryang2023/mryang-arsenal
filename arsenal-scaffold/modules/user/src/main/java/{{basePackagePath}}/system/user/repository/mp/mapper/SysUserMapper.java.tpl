package {{basePackage}}.system.user.repository.mp.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import {{basePackage}}.system.user.domain.SysUser;
import org.apache.ibatis.annotations.Mapper;

/**
 * sys_user 的 BaseMapper。放在 repository/mp/mapper 子包而不要平铺在 repository 下：
 * 生成器若开了 @MapperScan("{{basePackage}}.**.repository")，同包里的普通仓储接口
 * 会被误注册成 Mapper；MyBatis-Plus 靠自动扫描 @Mapper 注解就能发现它们。
 */
@Mapper
public interface SysUserMapper extends BaseMapper<SysUser> {
}
