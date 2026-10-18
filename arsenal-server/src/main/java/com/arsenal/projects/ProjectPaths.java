package com.arsenal.projects;

import java.nio.file.Path;

/**
 * 项目工坊数据目录解析 —— 三档，照 {@code charter-dir.mjs} 先例：
 * 环境变量 {@code ARSENAL_PROJECTS_DIR} > yml {@code arsenal.projects.dir} > 默认 {@code .data/projects}。
 *
 * <p>缓存永远不进被扫描的仓库，也不进 git（见 {@code .gitignore} 的递归忽略项 {@code .data/projects/}）。
 * 默认落在仓库根的 {@code .data/projects/}（与既有 {@code .data/qa/} 同规矩：
 * 「别的项目的资料不入库」）。
 */
public final class ProjectPaths {

    /** 环境变量最高优先。 */
    public static final String ENV_DIR = "ARSENAL_PROJECTS_DIR";
    /** yml 配置键（中档默认）。 */
    public static final String YML_KEY = "arsenal.projects.dir";
    /** 硬编码最终兜底。 */
    public static final String DEFAULT_DIR = ".data/projects";

    private ProjectPaths() {
    }

    /**
     * 解出根目录（不负责创建）。
     *
     * @param ymlConfig yml 里 {@code arsenal.projects.dir} 的值（可能为空串）
     */
    public static Path resolveRoot(String ymlConfig) {
        String env = System.getenv(ENV_DIR);
        if (env != null && !env.isBlank()) {
            return Path.of(env);
        }
        if (ymlConfig != null && !ymlConfig.isBlank()) {
            return Path.of(ymlConfig);
        }
        return Path.of(DEFAULT_DIR);
    }
}
