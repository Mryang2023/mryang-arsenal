package {{basePackage}}.auth.security;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * JWT 解析过滤器。只负责三件事：取头、验签、把身份放进 CurrentUserHolder。
 *
 * 无效令牌不在这里拒绝 —— 交给 AuthInterceptor 按路径决定 401 还是放行，
 * 「哪些路径公开」因此只存在 AuthWebMvcConfig 一份名单，不会两处对不上。
 */
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private static final String BEARER = "Bearer ";

    private final JwtService jwtService;

    public JwtAuthenticationFilter(JwtService jwtService) {
        this.jwtService = jwtService;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith(BEARER)) {
            AuthUser user = jwtService.verify(header.substring(BEARER.length()));
            if (user != null) {
                CurrentUserHolder.set(user);
            }
        }
        try {
            chain.doFilter(request, response);
        } finally {
            // 请求结束必须清理：线程复用会把身份带给下一个请求，这是真实发生过的越权事故
            CurrentUserHolder.clear();
        }
    }
}
