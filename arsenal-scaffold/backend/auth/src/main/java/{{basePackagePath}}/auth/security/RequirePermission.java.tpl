package {{basePackage}}.auth.security;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 接口权限声明，值是权限码（如 sys:user:save），由 PermissionInterceptor 校验。
 *
 * 权限码必须与 sys_permission 表的 code 一一对应：接口上写了表里没有的码，
 * 意味着没有任何角色能调通它 —— 注解与权限种子必须一起改。
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RequirePermission {

    /** 权限码。 */
    String value();
}
