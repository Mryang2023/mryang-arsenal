package {{basePackage}}.system.role.repository.mp.mapper;

import {{basePackage}}.system.role.domain.RolePermissionBinding;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;

/**
 * sys_role_permission 的 BaseMapper。绑定表没有业务语义，
 * 单表 CRUD 全走 BaseMapper，不配 XML。
 */
@Mapper
public interface RolePermissionBindingMapper extends BaseMapper<RolePermissionBinding> {
}
