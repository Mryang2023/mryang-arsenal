package {{basePackage}}.auth.config;

import {{basePackage}}.auth.security.PermissionInterceptor;
import {{basePackage}}.auth.web.AuthInterceptor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * 鉴权拦截器链与跨域。不用 @EnableWebMvc —— 它会让 Spring Boot 的
 * MVC 自动配置整体失效，Jackson 的全局定制会跟着失灵。
 *
 * 装配提示：auth 模块接管登录校验后，common 侧的 interceptor/AuthInterceptor
 * 占位实现不要再注册，否则同一请求会被拦两遍；公开路径名单只有本类一处。
 */
@Configuration
public class AuthWebMvcConfig implements WebMvcConfigurer {

    private final AuthInterceptor authInterceptor;
    private final PermissionInterceptor permissionInterceptor;

    public AuthWebMvcConfig(AuthInterceptor authInterceptor, PermissionInterceptor permissionInterceptor) {
        this.authInterceptor = authInterceptor;
        this.permissionInterceptor = permissionInterceptor;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        // 登录态在前（order=1）、权限码在后（order=2）：401 永远先于 403
        registry.addInterceptor(authInterceptor)
                .addPathPatterns("/api/**")
                .excludePathPatterns("/api/auth/login")
                .order(1);
        registry.addInterceptor(permissionInterceptor).addPathPatterns("/api/**").order(2);
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        // allowedOrigins("*") 与 allowCredentials(true) 互斥 ——
        // 要带凭证就用 allowedOriginPatterns，写 * 浏览器会直接拒绝
        registry.addMapping("/api/**")
                .allowedOriginPatterns("*")
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true)
                .maxAge(3600);
    }
}
