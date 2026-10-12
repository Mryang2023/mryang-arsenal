package com.arsenal.scan;

import tools.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 扫描包的装配。
 *
 * 刻意只在这里出现 Spring 注解：{@link ProjectScanner} 与五个子 Scanner 都是普通对象，
 * 所以 {@code ScanProbe} 可以脱离 Spring 直接 new 出来跑（verify 层就是这么端到端验的）。
 * 启动类上挂 {@code @EnableXxx} 那套是项目里明确不做的写法（开关归属看不出来）。
 */
@Configuration
public class ScanConfig {

    @Bean
    public ScanRulesLoader scanRulesLoader(@Value("${arsenal.scan.rules-file}") String file,
                                           ObjectMapper mapper) {
        return new ScanRulesLoader(file, mapper);
    }

    @Bean
    public ProjectScanner projectScanner(ScanRulesLoader loader, ObjectMapper mapper) {
        return new ProjectScanner(loader, mapper);
    }
}
