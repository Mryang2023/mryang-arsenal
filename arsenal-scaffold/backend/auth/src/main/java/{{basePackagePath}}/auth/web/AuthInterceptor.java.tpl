package {{basePackage}}.auth.web;

import {{basePackage}}.auth.security.CurrentUserHolder;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

import java.nio.charset.StandardCharsets;

/**
 * 业务侧登录态校验（双防线之二）：JwtAuthenticationFilter 负责解析令牌，
 * 这里负责对 /api/** 断言身份已就位；放行名单只写在 AuthWebMvcConfig 一处。
 */
@Component
public class AuthInterceptor implements HandlerInterceptor {

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws Exception {
        if (CurrentUserHolder.get() != null) {
            return true;
        }
        response.setStatus(401);
        response.setCharacterEncoding(StandardCharsets.UTF_8.name());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write(
                "{\"code\":1002,\"message\":\"未登录或登录已过期\",\"data\":null}");
        return false;
    }
}
