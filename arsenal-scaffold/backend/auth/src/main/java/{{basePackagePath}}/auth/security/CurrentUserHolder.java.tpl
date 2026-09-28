package {{basePackage}}.auth.security;

/**
 * 当前登录用户上下文。值由 JwtAuthenticationFilter 在请求进入业务代码前写入。
 *
 * 用完必须清理：过滤器 finally 里 clear()。Tomcat 的线程是复用的，
 * 不清理意味着下一个请求可能读到上一个用户的身份 —— 这是真实发生过的越权事故。
 */
public final class CurrentUserHolder {

    private static final ThreadLocal<AuthUser> CONTEXT = new ThreadLocal<>();

    private CurrentUserHolder() {
    }

    public static void set(AuthUser user) {
        CONTEXT.set(user);
    }

    /** 拿不到时返回 null 而不是抛异常：定时任务、系统内部调用没有「当前用户」。 */
    public static AuthUser get() {
        return CONTEXT.get();
    }

    public static Long getUserId() {
        AuthUser user = CONTEXT.get();
        return user == null ? null : user.userId();
    }

    public static String getUsername() {
        AuthUser user = CONTEXT.get();
        return user == null ? null : user.username();
    }

    public static void clear() {
        CONTEXT.remove();
    }
}
