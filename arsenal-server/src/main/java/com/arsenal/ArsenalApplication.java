package com.arsenal;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * 杨先生的军火库 · 规则服务。
 *
 * 职责边界（刻意保持很窄）：
 *   1. 把 arsenal-rules/**\/*.json 加载进内存索引
 *   2. 对外提供检索、导出、校验三类能力
 *
 * 它不持有规则的副本，也不允许规则在数据库里再存一份 ——
 * 数据源永远是那堆 JSON 文件，这里只是它的一层可执行外壳。
 */
@SpringBootApplication
public class ArsenalApplication {

    public static void main(String[] args) {
        SpringApplication.run(ArsenalApplication.class, args);
    }
}
