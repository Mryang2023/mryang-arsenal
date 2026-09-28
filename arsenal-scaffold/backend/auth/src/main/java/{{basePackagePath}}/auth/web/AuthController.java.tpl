package {{basePackage}}.auth.web;

import {{basePackage}}.auth.dto.LoginRequest;
import {{basePackage}}.auth.dto.LoginResponse;
import {{basePackage}}.auth.dto.MeResponse;
import {{basePackage}}.auth.dto.MenuNode;
import {{basePackage}}.auth.security.AuthUser;
import {{basePackage}}.auth.security.CurrentUserHolder;
import {{basePackage}}.auth.service.AuthService;
import {{basePackage}}.common.ApiResponse;
import {{basePackage}}.common.ErrorCode;
import {{basePackage}}.common.exception.BizException;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 认证入口。login 在放行名单里（见 AuthWebMvcConfig）；
 * me / logout / menus 只要求登录态，不挂权限码。
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService service;

    public AuthController(AuthService service) {
        this.service = service;
    }

    @PostMapping("/login")
    public ApiResponse<LoginResponse> login(@Valid @RequestBody LoginRequest req) {
        return ApiResponse.ok(service.login(req.username(), req.password()));
    }

    @GetMapping("/me")
    public ApiResponse<MeResponse> me() {
        return ApiResponse.ok(service.me(requireCurrent().userId()));
    }

    /**
     * 登出。JWT 无状态，服务端没有会话可销毁 —— 前端丢弃令牌即可。
     * 端点保留是为了契约稳定：将来换黑名单/短令牌方案时前端不用改。
     */
    @PostMapping("/logout")
    public ApiResponse<Void> logout() {
        requireCurrent();
        return ApiResponse.ok();
    }

    /** 当前用户菜单树：侧边栏动态渲染的数据源 */
    @GetMapping("/menus")
    public ApiResponse<List<MenuNode>> menus() {
        return ApiResponse.ok(service.menuTree(requireCurrent().userId()));
    }

    private AuthUser requireCurrent() {
        AuthUser current = CurrentUserHolder.get();
        if (current == null) {
            // 拦截器已挡住匿名请求，走到这里说明令牌在链路中段失效 —— 统一按未登录处理
            throw new BizException(ErrorCode.UNAUTHORIZED);
        }
        return current;
    }
}
