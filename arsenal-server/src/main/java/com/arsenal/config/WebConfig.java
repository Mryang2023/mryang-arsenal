package com.arsenal.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * CORS 配置。
 *
 * 默认只放行本地前端（3010）。生产部署请通过 arsenal.cors.allowed-origins 显式指定 ——
 * 不要图省事写 "*"，军火库的安全规则 SEC-* 同样适用于它自己。
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final String[] allowedOrigins;

    public WebConfig(@Value("${arsenal.cors.allowed-origins:}") String origins) {
        this.allowedOrigins = (origins == null || origins.isBlank())
                ? new String[0]
                : origins.split("\\s*,\\s*");
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        if (allowedOrigins.length == 0) {
            return;
        }
        registry.addMapping("/api/**")
                .allowedOrigins(allowedOrigins)
                // DELETE 必须在列：前端 /projects 的删除项目走 DELETE（projects-api.ts），
                // 缺了它浏览器预检直接拒，删除按钮在页面里永远失败而 curl 一切正常。
                .allowedMethods("GET", "POST", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .maxAge(3600);
    }
}
