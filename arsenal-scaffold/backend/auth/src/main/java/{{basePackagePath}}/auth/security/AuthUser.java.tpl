package {{basePackage}}.auth.security;

/**
 * 请求级登录身份。JwtAuthenticationFilter 验签通过后放进 CurrentUserHolder，
 * 业务代码从这里拿「当前是谁」—— 各处不再重复解析 Authorization 头。
 *
 * 只放身份最小集（id + username）：角色、权限随用随查，
 * 塞进上下文的身份越多，「改了角色要重新登录才生效」的坑就越多。
 */
public record AuthUser(Long userId, String username) {
}
