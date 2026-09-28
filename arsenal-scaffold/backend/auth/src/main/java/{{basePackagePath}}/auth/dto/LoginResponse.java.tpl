package {{basePackage}}.auth.dto;

/**
 * 登录出参：{token, user{id, username, nickname}}，与前端契约一字不差。
 * 内层用嵌套 record 而不是 Map —— 字段名写错在编译期就红，Map 要等前端联调才发现。
 */
public record LoginResponse(String token, UserBrief user) {

    public record UserBrief(Long id, String username, String nickname) {
    }
}
