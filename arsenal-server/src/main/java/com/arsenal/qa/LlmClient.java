package com.arsenal.qa;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * OpenAI-compatible chat 客户端 —— 只服务 /qa 的语义深检（M2）。
 *
 * <p>三条铁律，写在这里而不是调用方：
 * <ul>
 *   <li><b>key 只走环境变量</b>（application.yml 的 {@code ${ARSENAL_LLM_KEY:}} 占位），
 *       不落库、不进前端、不进 git、不进日志 —— 日志只记 model 与状态码。</li>
 *   <li><b>同步链路永不碰这里</b>：/autopsy、/api/lint 的调用方不注入本类。
 *       LLM 判定只活在 /qa 的异步 Job 上下文里（分钟级调用不该撞 HTTP 超时）。</li>
 *   <li><b>失败要说人话</b>：网络/鉴权/格式错误统一成 {@link LlmException}，
 *       由 QaService 落成 semanticStatus=failed + 原因，不静默、不伪造判定。</li>
 * </ul>
 */
@Component
public class LlmClient {

    private static final Logger log = LoggerFactory.getLogger(LlmClient.class);

    /** 单请求代码+提示词的字符上限 —— 超了不是截断prompt假装看过，是直接拒（调用方拆批）。 */
    public static final int MAX_REQUEST_CHARS = 24_000;

    private final String baseUrl;
    private final String model;
    private final String apiKey;
    private final int timeoutSeconds;
    private final HttpClient http;
    private final ObjectMapper mapper;

    public LlmClient(ObjectMapper mapper,
                     @Value("${arsenal.qa.llm.base-url:https://api.deepseek.com/v1}") String baseUrl,
                     @Value("${arsenal.qa.llm.model:deepseek-chat}") String model,
                     @Value("${arsenal.qa.llm.api-key:}") String apiKey,
                     @Value("${arsenal.qa.llm.timeout-seconds:30}") int timeoutSeconds) {
        this.mapper = mapper;
        this.baseUrl = baseUrl == null ? "" : baseUrl.replaceAll("/+$", "");
        this.model = model == null ? "" : model.trim();
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.timeoutSeconds = Math.max(5, timeoutSeconds);
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .build();
    }

    /** 是否可用：key 与 base-url 齐备才算配置 —— 前端据此决定深检勾选框放不放行。 */
    public boolean configured() {
        return !apiKey.isEmpty() && baseUrl.startsWith("http");
    }

    public String modelName() {
        return model;
    }

    /** 状态披露（/api/qa/llm-status）：只回状态与模型名，绝不回 key、也不回完整 base-url。 */
    public JsonNode statusNode() {
        ObjectNode n = mapper.createObjectNode();
        n.put("configured", configured());
        n.put("model", configured() ? model : "");
        n.put("reason", configured() ? ""
                : (apiKey.isEmpty() ? "未设置环境变量 ARSENAL_LLM_KEY —— 深检将整段跳过，报告只含静态结论"
                        : "LLM base-url 配置异常（需 http/https 开头）"));
        return n;
    }

    /** 一次 chat：system 定规矩 + user 给料。返回内容 + usage 记账。 */
    public Reply chat(String system, String user) throws LlmException {
        if (!configured()) {
            throw new LlmException("LLM 未配置（缺 ARSENAL_LLM_KEY）—— 不应走到这一步，调用方漏了前置检查");
        }
        if (system.length() + user.length() > MAX_REQUEST_CHARS) {
            throw new LlmException("单请求体积超限：" + (system.length() + user.length())
                    + " > " + MAX_REQUEST_CHARS + " 字符 —— 批次没切干净");
        }
        ObjectNode req = mapper.createObjectNode();
        req.put("model", model);
        req.put("temperature", 0.0);
        req.put("max_tokens", 1200);
        ArrayNode msgs = req.putArray("messages");
        msgs.addObject().put("role", "system").put("content", system);
        msgs.addObject().put("role", "user").put("content", user);

        Exception last = null;
        for (int attempt = 1; attempt <= 2; attempt++) { // 传输类错误重试一次；4xx 立停
            try {
                HttpRequest.Builder b = HttpRequest.newBuilder()
                        .uri(URI.create(baseUrl + "/chat/completions"))
                        .timeout(Duration.ofSeconds(timeoutSeconds))
                        .header("content-type", "application/json")
                        .header("authorization", "Bearer " + apiKey)
                        .POST(HttpRequest.BodyPublishers.ofString(
                                mapper.writeValueAsString(req), StandardCharsets.UTF_8));
                HttpResponse<String> res = http.send(b.build(), HttpResponse.BodyHandlers.ofString());
                if (res.statusCode() >= 400 && res.statusCode() < 500 && res.statusCode() != 429) {
                    throw new LlmException("LLM 服务端拒绝（HTTP " + res.statusCode()
                            + "，鉴权/参数问题，重试无意义）");
                }
                if (res.statusCode() != 200) {
                    last = new LlmException("LLM 上游异常（HTTP " + res.statusCode() + "）");
                    if (attempt == 1) {
                        Thread.sleep(1200);
                        continue;
                    }
                    throw (LlmException) last;
                }
                JsonNode body = mapper.readTree(res.body());
                JsonNode choice = body.path("choices").path(0).path("message").path("content");
                if (choice.isString() == false && choice.isMissingNode()) {
                    throw new LlmException("LLM 响应里没有 choices[0].message.content —— 上游格式与 OpenAI 契约不符");
                }
                JsonNode usage = body.path("usage");
                return new Reply(choice.asString(""),
                        usage.path("prompt_tokens").asInt(0),
                        usage.path("completion_tokens").asInt(0));
            } catch (LlmException e) {
                throw e;
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new LlmException("等待 LLM 响应时被中断");
            } catch (Exception e) {
                last = e;
                if (attempt == 1) {
                    log.warn("LLM 第 1 跳失败（{}s 后重试一次）：{}", 1, e.toString());
                    try {
                        Thread.sleep(1200);
                    } catch (InterruptedException ie) {
                        Thread.currentThread().interrupt();
                        break;
                    }
                }
            }
        }
        throw new LlmException("LLM 调用失败（已重试一次）：" + (last == null ? "未知原因" : last.getMessage()));
    }

    /** 响应内容 + token 记账（llmUsage 的数据源）。 */
    public record Reply(String content, int promptTokens, int completionTokens) {
    }

    /** 语义层统一异常：QaService 拿它落 semanticStatus=failed，绝不吞。 */
    public static class LlmException extends Exception {
        public LlmException(String message) {
            super(message);
        }
    }

    // 供测试期日志降噪：列出注入目标 host（不含 key），排查「配了 key 却连不通」用
    String targetHost() {
        try {
            return List.of(URI.create(baseUrl).getHost()).get(0);
        } catch (Exception e) {
            return "(invalid-base-url)";
        }
    }
}
