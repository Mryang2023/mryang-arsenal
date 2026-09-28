package {{basePackage}}.system.role.repository.mp.mapper;

import {{basePackage}}.system.role.domain.SysPermission;
import {{basePackage}}.system.role.repository.view.MenuLabelView;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;

import java.util.List;

/**
 * sys_permission 的 BaseMapper + 一条跨表只读查询。
 * listMenuLabels 的 SQL 在 resources/mapper/SysPermissionMapper.xml ——
 * namespace 与本接口全限定名一字不差。
 */
@Mapper
public interface SysPermissionMapper extends BaseMapper<SysPermission> {

    List<MenuLabelView> listMenuLabels();
}
