package com.arsenal.projects;

import com.arsenal.web.ApiResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.nio.file.Path;

/**
 * 模块开发看板 · <b>只读推断</b>。
 *
 * <p>把 IEMS 的固定打法（设计说明 → 表结构 → 四件套 → 后端 → 接口文档 → 前端 → 人工验收）
 * 投影成一块看板。状态完全由仓库文件推断，军火库不存进度，也不提供「标记完成」——
 * 那种按钮迟早会说谎。
 *
 * <p>数据来源：{@link DdlVerifyService}（表四件套）、{@link ControllerIndex}（后端接口）、
 * {@link ApiDocService}（文档对账）、前端项目的 {@code src/api|views/<module>/}。
 * 前端项目靠「同父目录 + package.json」自动发现（IEMS-Service / IEMS-Web 的布局）。
 */
@RestController
@RequestMapping("/api/projects/{id}/modules")
public class ModuleController {

    private final ProjectRegistry registry;
    private final ProjectCache cache;
    private final ModuleBoardService board;

    public ModuleController(
            @Value("${arsenal.projects-dir:}") String ymlDir,
            ObjectMapper mapper,
            ProjectRegistry registry,
            ProjectCache cache) {
        this.registry = registry;
        this.cache = cache;
        // 依赖在构造里 new：这几个服务都是无状态的，与 DdlController 同一模式。
        DossierService dossier = new DossierService(mapper);
        this.board = new ModuleBoardService(
                mapper,
                new DdlVerifyService(mapper, dossier),
                new ApiDocService(mapper),
                registry,
                cache);
    }

    /**
     * 全量看板。
     *
     * <p>一次返回所有模块的所有阶段：模块数量是个位数，前端按需折叠，比逐个模块发请求简单。
     * 缓存不存在时返回 NOT_FOUND —— 先 {@code POST /api/projects/{id}/refresh}。
     */
    @GetMapping
    public ApiResponse<ObjectNode> board(@PathVariable("id") String id) {
        if (registry.find(id).isEmpty()) {
            return ApiResponse.fail("NOT_FOUND", "项目不在了：" + safe(id));
        }
        Path repo = cache.resolve(id);
        if (repo == null) {
            return ApiResponse.fail("NOT_FOUND",
                    "项目还没有缓存仓库：" + safe(id) + "；先 POST /api/projects/" + safe(id) + "/refresh");
        }
        return ApiResponse.ok(board.board(repo, id));
    }

    private static String safe(String s) {
        return s == null ? "" : s.replaceAll("[\\r\\n]", " ");
    }
}
