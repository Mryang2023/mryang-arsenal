package demo;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * 活体解剖 fixture：最小可运行 Spring Boot 入口。
 *
 * 刻意不引数据库 / Redis —— 本环境没有，且它们会让启动结果不可控。
 * 本 fixture 存在的唯一目的是让「运行时采集」有一条可复现的真样本：
 * 它必须能起来、能报端口、能答 /actuator/health。
 */
@SpringBootApplication
public class DemoApplication {

    public static void main(String[] args) {
        SpringApplication.run(DemoApplication.class, args);
    }
}
