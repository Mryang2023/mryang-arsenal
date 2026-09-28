package {{basePackage}}.auth.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * 密码加密器。只引 spring-security-crypto 这一个纯加密包，不引完整的
 * spring-boot-starter-security —— 完整引入会激活 Security 的过滤器链与自动配置：
 *   1. 所有接口默认 401，必须再配一条 SecurityFilterChain 放行规则；
 *   2. 与本模块的 JwtAuthenticationFilter/AuthInterceptor 形成「两套鉴权」互相打架。
 * 本脚手架的鉴权由 JWT 过滤器 + 拦截器承担，Spring Security 在这里只出借
 * BCrypt 一个类。BCrypt 自带盐值，同一明文每次哈希都不同，
 * 校验必须用 matches() 而不是比字符串。
 */
@Configuration
public class PasswordConfig {

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }
}
