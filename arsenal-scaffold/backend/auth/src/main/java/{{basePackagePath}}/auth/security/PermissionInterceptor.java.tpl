package {{basePackage}}.auth.security;

import {{basePackage}}.auth.service.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;

import java.nio.charset.StandardCharsets;

/**
 * 权限校验（第二道闸）。登录态由 AuthInterceptor 保证，这里只看「有没有这个码」。
 *
 * 每次命中注解的请求都查一次库，换来的是「管理员改完权限立即生效」——
 * 引缓存就得回答失效时机的问题；脚手架阶段宁可每次查，真有量再加带 TTL 的缓存。
 */
@Component
public class PermissionInterceptor implements HandlerInterceptor {

    private final AuthService authService;

    public PermissionInterceptor(AuthService authService) {
        this.authService = authService;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws Exception {
        if (!(handler instanceof HandlerMethod handlerMethod)) {
            // 静态资源等非 Controller 处理器不拦
            return true;
        }
        RequirePermission required = handlerMethod.getMethodAnnotation(RequirePermission.class);
        if (required == null) {
            return true;
        }
        Long userId = CurrentUserHolder.getUserId();
        if (userId != null && authService.hasPermission(userId, required.value())) {
            return true;
        }
        response.setStatus(403);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write(
                "{\"code\":1003,\"message\":\"没有操作权限\",\"data\":null}");
        return false;
    }
}
