package {{basePackage}}.auth.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;

/**
 * JWT 签发与校验，职责只有两个：登录成功后发令牌、请求进来时验令牌。
 *
 * 密钥与有效期从配置读（app.jwt.secret / app.jwt.ttl-minutes）；
 * 生产环境密钥必须用环境变量注入 —— 写死在仓库里等于把门钥匙贴在门上。
 *
 * 算法白名单不用手写：verifyWith(SecretKey) 把可接受算法限定为该密钥
 * 对应的族（HS256/384/512），header 里伪造的 alg=none 会被直接拒绝 ——
 * 这是 JWT 最著名的历史漏洞，jjwt 0.12 的 API 从设计上堵死了它。
 */
@Component
public class JwtService {

    /** 用户 id 放进自定义 claim：业务要 uid 时不用再查库 */
    public static final String CLAIM_UID = "uid";

    private final SecretKey key;
    private final long ttlMinutes;

    public JwtService(@Value("${app.jwt.secret}") String secret,
                      @Value("${app.jwt.ttl-minutes:720}") long ttlMinutes) {
        // HS256 要求密钥 >= 32 字节，太短的密钥 jjwt 会直接抛异常 —— 这是故意的
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.ttlMinutes = ttlMinutes;
    }

    public String issue(Long userId, String username) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(username)
                .claim(CLAIM_UID, userId)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plusSeconds(ttlMinutes * 60)))
                .signWith(key)
                .compact();
    }

    /**
     * 校验并取出身份。签名不符 / 已过期 / 格式错误统一返回 null ——
     * 对调用方（过滤器）与「没带令牌」同等处理，不向响应泄露失败原因。
     */
    public AuthUser verify(String token) {
        try {
            Claims claims = Jwts.parser()
                    .verifyWith(key)
                    .build()
                    .parseSignedClaims(token)
                    .getPayload();
            Number uid = claims.get(CLAIM_UID, Number.class);
            if (uid == null) {
                // 没有身份声明的令牌一律不可信（别的系统签发的同名格式令牌也拦在这里）
                return null;
            }
            return new AuthUser(uid.longValue(), claims.getSubject());
        } catch (RuntimeException e) {
            // JwtException / IllegalArgumentException 都归入「令牌不可信」
            return null;
        }
    }
}
