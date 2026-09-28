package {{basePackage}}.system.user.repository.mp.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import {{basePackage}}.system.user.domain.UserRoleBinding;
import org.apache.ibatis.annotations.Mapper;

/**
 * sys_user_role 的 BaseMapper。绑定表没有独立业务语义，
 * 单表 CRUD 全走 BaseMapper，不配 XML。
 */
@Mapper
public interface UserRoleBindingMapper extends BaseMapper<UserRoleBinding> {
}
