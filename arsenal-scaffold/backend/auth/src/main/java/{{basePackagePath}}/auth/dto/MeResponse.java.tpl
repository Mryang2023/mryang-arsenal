package {{basePackage}}.auth.dto;

/**
 * /api/auth/me 出参。与 LoginResponse.UserBrief 同形但独立成类 ——
 * 两个接口的契约独立演进时互不牵连。
 */
public record MeResponse(Long id, String username, String nickname) {
}
