package com.arsenal.web;

import com.arsenal.archify.ArchifyService;
import com.arsenal.scan.ProjectScanner;
import com.arsenal.scan.ScanException;
import com.arsenal.scan.SourceResolver;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.InputStream;

/**
 * 代码扫描接口。
 *
 * <p>这一层只做「把 HTTP 请求翻译成一次扫描」，不含任何业务判断 ——
 * 输入怎么变成事实是 {@link ProjectScanner} 的事，输入安不安全是
 * {@link com.arsenal.scan.ScanGuard} 的事。混在这里的结果是每个接口都要重写一遍安全逻辑。
 *
 * <p>三种输入：本地目录 / zip 上传 / https git 地址。它们都收敛成
 * {@link SourceResolver} 的一个目录，扫描器对输入来源一无所知。
 *
 * <p>返回的就是事实 JSON 本身（不套壳）：前端拿到什么就能贴进文档什么，
 * 多一层包装就多一处会漂移的地方。
 */
@RestController
@RequestMapping("/api/scan")
public class ScanController {

    private final ProjectScanner scanner;
    private final ObjectMapper mapper;
    private final ArchifyService archifyService;

    public ScanController(ProjectScanner scanner, ObjectMapper mapper, ArchifyService archifyService) {
        this.scanner = scanner;
        this.mapper = mapper;
        this.archifyService = archifyService;
    }

    /** 这台机器的扫描能力：装了多少条映射、表在哪。页面上「未识别依赖」的提示要用到 */
    @GetMapping("/rules")
    public ApiResponse<ObjectNode> rules() {
        ObjectNode n = mapper.createObjectNode();
        n.put("count", scanner.ruleCount());
        n.put("file", scanner.rulesFile().toString().replace('\\', '/'));
        return ApiResponse.ok(n);
    }

    /**
     * 扫一个本地目录或一个 git 地址。
     *
     * <p>请求体：{@code {"source":{"kind":"path"|"git","value":"..."}}}。
     * 缺字段、kind 不认识、路径不存在都是 400 —— 它们是调用方改一下就好的问题，
     * 不是服务端异常。
     */
    @PostMapping("/facts")
    public ApiResponse<JsonNode> facts(@RequestBody JsonNode body) {
        JsonNode source = body == null ? null : body.get("source");
        if (source == null || !source.isObject()) {
            throw new IllegalArgumentException("请求体缺少 source：{\"source\":{\"kind\":\"path|git\",\"value\":\"…\"}}");
        }
        String kind = source.path("kind").asText("");
        String value = source.path("value").asText("");
        return switch (kind) {
            case "path" -> ApiResponse.ok(scanner.scan(SourceResolver.fromPath(value)));
            case "git" -> ApiResponse.ok(scanner.scan(SourceResolver.fromGit(value)));
            default -> throw new IllegalArgumentException(
                    "source.kind 只支持 path / git，收到的是「" + kind + "」（zip 请走 /api/scan/upload）");
        };
    }

    /**
     * 上传一个 zip 直接扫。
     *
     * <p>注意这里**不落盘到任何业务目录**：解压进 JVM 临时目录，扫描结束在
     * {@code finally} 里删掉（见 {@link SourceResolver#close}）。
     */
    @PostMapping("/upload")
    public ApiResponse<JsonNode> upload(@RequestParam(value = "file", required = false) MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("上传的文件是空的");
        }
        String name = file.getOriginalFilename() == null ? "" : file.getOriginalFilename().toLowerCase();
        if (!name.endsWith(".zip")) {
            throw new IllegalArgumentException("只接受 .zip（收到的是 " + (name.isEmpty() ? "未知" : name) + "）");
        }
        try (InputStream in = file.getInputStream()) {
            return ApiResponse.ok(scanner.scan(SourceResolver.fromZip(in)));
        } catch (java.io.IOException e) {
            throw new IllegalArgumentException("上传的文件读不了：" + e.getMessage());
        } catch (ScanException e) {
            throw e;
        }
    }

    /** 映射表反查。调试用：想不通「为什么这个依赖没被认出来」时先看它在不在表里 */
    @GetMapping("/rules/detail")
    public ApiResponse<ArrayNode> rulesDetail() {
        return ApiResponse.ok(new com.arsenal.scan.TechStackResolver(
                new com.arsenal.scan.ScanRulesLoader(
                        scanner.rulesFile().toString(), mapper).rules()).describe(mapper));
    }

    /**
     * 把「已构建好的架构 IR」直接交给出图服务渲染。
     *
     * <p>与 {@code POST /api/archify/deliver} 同形：请求体就是 IR 本身
     * （{@code {"ir": <IR>}}，或直接把 IR 作为请求体）。facts → IR 这一步在
     * 前端完成（复用出图服务的版式必须由前端决定主题），后端不重做一遍，
     * 避免同一份架构出现「前端一张、后端一张」对不上的图。
     *
     * <p>本接口只是把扫描链路上的「出图」收敛到同一个出图服务，
     * 不改动 {@link ArchifyService} 本身。
     */
    @PostMapping("/archify")
    public ApiResponse<ArchifyService.DeliverOutcome> archify(@RequestBody JsonNode body) {
        if (body == null || !body.isObject()) {
            throw new IllegalArgumentException("请求体必须是一个 JSON 对象（IR 本身，或 {\"ir\": <IR>}）");
        }
        JsonNode ir = body.path("ir");
        if (ir.isMissingNode() || !ir.isObject()) {
            ir = body; // 允许直接把 IR 作为请求体（与 /api/archify/deliver 一致）
        }
        return ApiResponse.ok(archifyService.deliver(ir));
    }

    /**
     * 把扫描事实转成「出图数据」—— 部署选型（picks）+ 应用分层（bands）+ 跨带直连（crossCalls）。
     *
     * <p><b>本接口只给数据，不给 SVG。</b>像素级 SVG（buildTechArchSvg / buildLayeredSvg）
     * 是前端静态站的事，浏览器里才能跑；后端若再实现一遍同样的渲染，两份图就会各说各的
     * （计划里明确反对「两张图打架」）。所以这里返回<b>规范化的出图数据模型</b>，
     * 交给前端渲染，或交给脚本落盘。
     *
     * <p>请求体：{@code {"facts": <ProjectFacts>, "kinds": ["tech","layered"], "theme": "doc"}}。
     * {@code kinds} 省略时两项都给；{@code theme} 仅透传，渲染由前端决定。
     */
    @PostMapping("/diagram")
    public ApiResponse<JsonNode> diagram(@RequestBody JsonNode body) {
        JsonNode facts = body == null ? null : body.get("facts");
        if (facts == null || !facts.isObject()) {
            throw new IllegalArgumentException(
                    "请求体必须含 facts（ProjectFacts JSON 对象）：{\"facts\": …, \"kinds\": […], \"theme\": \"doc\"}");
        }
        String theme = body.path("theme").asText("doc");
        JsonNode kinds = body.path("kinds");
        boolean wantTech = kinds.isMissingNode() || kinds.isNull() || arrayHas(kinds, "tech");
        boolean wantLayered = kinds.isMissingNode() || kinds.isNull() || arrayHas(kinds, "layered");

        ObjectNode out = mapper.createObjectNode();
        out.put("theme", theme);
        out.put("schemaVersion", facts.path("schemaVersion").asInt(1));
        out.put("root", facts.path("root").asText(""));
        if (wantTech) {
            out.set("deploy", deployDiagram(facts));
        }
        if (wantLayered) {
            out.set("layered", layeredDiagram(facts));
        }
        return ApiResponse.ok(out);
    }

    /** 部署选型：从 techStack.matched 的 dim/opt 直接取（纯查表，与前端 factsToPicks 同一份事实来源），外加部署清单推导的四个维度。 */
    private JsonNode deployDiagram(JsonNode facts) {
        ObjectNode deploy = mapper.createObjectNode();
        ObjectNode picks = mapper.createObjectNode();
        JsonNode matched = facts.path("techStack").path("matched");
        if (matched.isArray()) {
            for (JsonNode m : matched) {
                String dim = m.path("dim").asText("");
                String opt = m.path("opt").asText("");
                if (!dim.isEmpty() && !opt.isEmpty()) {
                    picks.put(dim, opt);
                }
            }
        }
        JsonNode deployFacts = facts.path("deploy");
        JsonNode k8s = deployFacts.path("k8s");
        JsonNode helm = deployFacts.path("helm");
        JsonNode compose = deployFacts.path("compose");
        JsonNode docker = deployFacts.path("dockerfiles");
        JsonNode nginx = deployFacts.path("nginx");

        if (helm.isArray() && helm.size() > 0) picks.put("deploy", "helm");
        else if (k8s.isArray() && k8s.size() > 0) picks.put("deploy", "k8s");
        else if (compose.isArray() && compose.size() > 0) picks.put("deploy", "docker");
        else if (docker.isArray() && docker.size() > 0) picks.put("deploy", "docker");

        if (k8s.isArray() && k8s.size() > 0) picks.put("orchestration", "k8s");
        else if (compose.isArray() && compose.size() > 0) picks.put("orchestration", "compose");

        if (nginx.isArray() && nginx.size() > 0) picks.put("ingress", "nginx");

        JsonNode ci = deployFacts.path("ci");
        if (ci.isArray()) {
            for (JsonNode c : ci) {
                String opt = ciOpt(c.path("kind").asText(""));
                if (opt != null) {
                    picks.put("cicd", opt);
                    break;
                }
            }
        }
        deploy.set("picks", picks);

        // 副本数：优先 K8s Deployment.replicas，其次 Helm.replicaCount；读不到为 null（不默认 1 / 3）
        ObjectNode replicas = mapper.createObjectNode();
        replicas.put("replicas", replicaOf(k8s, "replicas", "Deployment"));
        replicas.put("replicaCount", replicaOf(helm, "replicaCount", null));
        deploy.set("replicas", replicas);
        return deploy;
    }

    private static Long replicaOf(JsonNode arr, String field, String requiredKind) {
        if (arr.isArray()) {
            for (JsonNode n : arr) {
                if (requiredKind != null && !requiredKind.equals(n.path("kind").asText(""))) {
                    continue;
                }
                JsonNode v = n.path(field);
                if (v.isNumber()) {
                    return v.asLong();
                }
            }
        }
        return null;
    }

    private static String ciOpt(String kind) {
        return switch (kind) {
            case "gitlab-ci" -> "gitlabci";
            case "githubactions" -> "githubactions";
            case "jenkins" -> "jenkins";
            case "argocd" -> "argocd";
            default -> null;
        };
    }

    /** 应用分层：从 code.layers / frontend 直接取计数，directCalls 当跨带直连。 */
    private JsonNode layeredDiagram(JsonNode facts) {
        JsonNode layers = facts.path("code").path("layers");
        JsonNode frontend = facts.path("frontend");
        ArrayNode bands = mapper.createArrayNode();
        int clientCount = frontend.path("kind").isTextual() ? frontend.path("routes").size() : -1;
        addBand(bands, "client", "客户端", clientCount);
        addBand(bands, "api", "接入层", layers.path("controller"));
        addBand(bands, "app", "应用层", layers.path("service"));
        addBand(bands, "domain", "领域层", layers.path("domain"));
        addBand(bands, "data", "数据层", layers.path("repository"));

        ArrayNode cross = mapper.createArrayNode();
        JsonNode directCalls = facts.path("code").path("directCalls");
        if (directCalls.isArray()) {
            for (JsonNode d : directCalls) {
                ObjectNode c = mapper.createObjectNode();
                c.put("from", d.path("from").asText(""));
                c.put("to", d.path("to").asText(""));
                c.put("file", d.path("file").asText(""));
                cross.add(c);
            }
        }
        ObjectNode layered = mapper.createObjectNode();
        layered.set("bands", bands);
        layered.set("crossCalls", cross);
        return layered;
    }

    private void addBand(ArrayNode bands, String id, String name, JsonNode countNode) {
        int count = countNode.isNumber() ? countNode.asInt() : 0;
        ObjectNode b = mapper.createObjectNode();
        b.put("id", id);
        b.put("name", name);
        b.put("count", count);
        bands.add(b);
    }

    private void addBand(ArrayNode bands, String id, String name, int count) {
        ObjectNode b = mapper.createObjectNode();
        b.put("id", id);
        b.put("name", name);
        b.put("count", count);
        bands.add(b);
    }

    private static boolean arrayHas(JsonNode arr, String v) {
        if (!arr.isArray()) {
            return false;
        }
        for (JsonNode n : arr) {
            if (v.equals(n.asText(""))) {
                return true;
            }
        }
        return false;
    }
}
