package com.arsenal.projects;

import tools.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.nio.file.Path;

/**
 * 项目工坊共享 bean（工坊棒4）。
 *
 * <p>此前 {@code ProjectRegistry / ProjectCache} 在 {@code ProjectController} 构造器里
 * {@code new} 出来，是控制器私有的。棒4 要让 QA 侧也读注册表（{@code lastJobId} 续跑线索）
 * 与缓存根（submit 收 {@code projectId}）—— 如果 QaController 再自己 {@code new} 一个
 * {@code ProjectRegistry}，就是**两个内存快照**：QA 侧写 lastJobId 会用自己启动时的旧列表
 * 覆盖掉项目管理页刚注册的项目（经典内存分叉暗伤）。所以抽成单例 bean，全仓共用一份。
 *
 * <p>目录三档解析不变：默认 {@code .data/projects/} &lt; yml {@code arsenal.projects.dir}
 * &lt; env {@code ARSENAL_PROJECTS_DIR}（{@link ProjectPaths#resolveRoot}）。
 */
@Configuration
public class ProjectBeans {

    @Bean
    public ProjectRegistry projectRegistry(
            @Value("${arsenal.projects.dir:}") String ymlDir, ObjectMapper mapper) {
        return new ProjectRegistry(ProjectPaths.resolveRoot(ymlDir), mapper);
    }

    @Bean
    public ProjectCache projectCache(
            @Value("${arsenal.projects.dir:}") String ymlDir, ObjectMapper mapper) {
        return new ProjectCache(ProjectPaths.resolveRoot(ymlDir), mapper);
    }
}
