package com.arsenal.web;

import com.arsenal.autopsy.AutopsyService;
import com.arsenal.scan.SourceResolver;
import tools.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 项目体检接口。
 *
 * <p>与 {@code POST /api/scan/facts} 同形（请求体 {@code {"source":{"kind":"path"|"git","value":"…"}}}），
 * 因为两者面对的是同一个问题：给一个项目地址，把结论拿回来。
 * 差别只在后端：facts 出架构事实，inspect 出三档体检结论（P0 必修 / P1 该改 / 观察项）+ 覆盖率。
 *
 * <p><b>入参校验一律在 Controller 里做。</b>本仓 {@code GlobalExceptionHandler} 会把
 * 404/405/415 吃成 500（既有行为，不是本接口引入的），所以不能指望框架层给出可读的
 * 参数错误 —— 缺字段、kind 不认识、空值都在这里显式抛 {@link IllegalArgumentException}。
 *
 * <p>安全：这条链路会让服务器去读用户给的路径。路径解析与「真实路径必须落在根内」
 * 由 {@link SourceResolver} 与 {@code ScanGuard} 承担（与扫描同一套，不在这里重写一遍）；
 * 报告里只有目录名，没有绝对路径。
 */
@RestController
@RequestMapping("/api/autopsy")
public class AutopsyController {

    private final AutopsyService service;

    public AutopsyController(AutopsyService service) {
        this.service = service;
    }

    /**
     * 体检一个本地目录或一个 https git 地址。
     *
     * <p>zip 不走这里：上传链路是 multipart（{@code /api/scan/upload}），
     * 与本接口的 JSON 请求体不是一回事，混在一条 switch 里迟早要加第三个分支。
     *
     * <p>{@code try(source)} 的清理在 {@link AutopsyService#inspect} 内部 ——
     * 临时目录必须在「源码已读进内存」之后、报告返回之前删掉，
     * 放在这里的话 service 已经用完了（且重复 close 是空操作，但语义会分家）。
     */
    @PostMapping("/inspect")
    public ApiResponse<JsonNode> inspect(@RequestBody JsonNode body) {
        JsonNode source = body == null ? null : body.get("source");
        if (source == null || !source.isObject()) {
            throw new IllegalArgumentException("请求体缺少 source：{\"source\":{\"kind\":\"path|git\",\"value\":\"…\"}}");
        }
        String kind = source.path("kind").asText("");
        String value = source.path("value").asText("");
        if (value.isBlank()) {
            throw new IllegalArgumentException("source.value 是空的 —— 给一个本地目录或 https git 地址");
        }
        SourceResolver resolved = switch (kind) {
            case "path" -> SourceResolver.fromPath(value);
            case "git" -> SourceResolver.fromGit(value);
            default -> throw new IllegalArgumentException(
                    "source.kind 只支持 path / git，收到的是「" + kind + "」（zip 请走 /api/scan/upload）");
        };
        return ApiResponse.ok(service.inspect(resolved));
    }
}
