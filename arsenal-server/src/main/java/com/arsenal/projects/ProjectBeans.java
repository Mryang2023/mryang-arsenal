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
 *
 * <p><b>2026-10-18</b>：{@code @Value} 的 key 必须与 yml 键名逐字一致（kebab 就写 kebab）——
 * {@code @Value} 不做 Spring Boot 的 relaxed binding，{@code arsenal.projects-dir} 这个键
 * 用 {@code ${arsenal.projects.dir}} 查**永远查不到**，会静默回落默认值。本类曾因此
 * 让 yml 层的 projects-dir 从上线起就没生效过（一直走 {@code DEFAULT_DIR} 相对进程 cwd），
 * 用户在仓库根跑服务时缓存落进仓库内，触发 BAD_SOURCE 才暴露。
 */
@Configuration
public class ProjectBeans {

    @Bean
    public ProjectRegistry projectRegistry(
            @Value("${arsenal.projects-dir:}") String ymlDir, ObjectMapper mapper) {
        return new ProjectRegistry(ProjectPaths.resolveRoot(ymlDir), mapper);
    }

    @Bean
    public ProjectCache projectCache(
            @Value("${arsenal.projects-dir:}") String ymlDir, ObjectMapper mapper) {
        return new ProjectCache(ProjectPaths.resolveRoot(ymlDir), mapper);
    }

    /**
     * Run 落盘层（夜班 N1/2026-10-30）。与 registry / cache 同根 ——
     * run 目录就是 {@code <项目根>/<projectId>/runs/<runId>}，和缓存、注册表住在同一棵树上，
     * 删项目时一个子树带走全部产物，不会留孤儿目录。
     */
    @Bean
    public com.arsenal.runs.RunStore runStore(
            @Value("${arsenal.projects-dir:}") String ymlDir, ObjectMapper mapper) {
        return new com.arsenal.runs.RunStore(ProjectPaths.resolveRoot(ymlDir), mapper);
    }
}
