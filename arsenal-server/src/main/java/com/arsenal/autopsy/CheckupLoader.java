package com.arsenal.autopsy;

import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * 观察项事实源的加载器 —— 与 {@code ScanRulesLoader} 同一套脾气，但**不许启动失败**。
 *
 * <p>差别来自用途：扫描映射表少加载二十条，会让二十个依赖静默落进「未识别清单」，
 * 那份清单会被当成「我的项目真的没用这些」—— 所以映射表加载失败必须启动失败。
 * 观察项缺了只是「这一档没有提醒」，体检报告的 P0/P1 档照样能出，
 * 因此这里**如实记录原因**并继续（报告里会写明「观察项事实源不可用 + 为什么」）。
 *
 * <p>目录定位同 {@code ScanRulesLoader}：绝对路径是明确指令；相对路径先剥掉开头的
 * {@code ../} 拿到裸子路径，再按「工作目录 → 逐级向上」找。
 * 这样从 {@code arsenal-server/} 与从仓库根启动都能命中 ——
 * 配 {@code ../} 只有工作目录正好是 {@code arsenal-server/} 时才碰巧成立。
 */
public final class CheckupLoader {

    private static final Logger log = LoggerFactory.getLogger(CheckupLoader.class);

    private static final int MAX_UPWARD = 6;
    private static final Set<String> OPERATORS = Set.of(">=", "<=", "==", "!=", "contains", "exists");

    /** 加载结果。**缺文件不是异常** —— `available=false` 本身就是一条要显示出来的结论。 */
    public record Loaded(boolean available, String file, String reason, List<CheckupEvaluator.Rule> rules, int declared) {
    }

    private CheckupLoader() {
    }

    public static Loaded load(String configured, ObjectMapper mapper) {
        Path file = resolve(configured);
        if (file == null) {
            return new Loaded(false, null,
                    "没有找到观察项事实源（已按 " + configured + " 逐级向上找过）—— 体检的 P0/P1 档照常出，观察项这一档本次为空",
                    List.of(), 0);
        }
        try {
            JsonNode root = mapper.readTree(Files.readAllBytes(file));
            JsonNode arr = root.get("rules");
            if (arr == null || !arr.isArray()) {
                // 原因里也只给文件名：这份文案会原样出现在报告里，而报告是要给别人看的
                return new Loaded(false, file.toString(), "观察项事实源里没有 rules 数组：" + file.getFileName(), List.of(), 0);
            }
            List<CheckupEvaluator.Rule> out = new ArrayList<>();
            for (JsonNode n : arr) {
                String op = n.path("when").path("op").asText("");
                if (!OPERATORS.contains(op)) {
                    // 不认识就跳过并记一条 —— 六算子是解释器的能力边界，
                    // 静默当成「没触发」会让这条观察项永远不出现且无人知晓
                    log.warn("观察项 {} 的算子「{}」不在六个之内，已跳过：{}", n.path("id").asText(""), op, file);
                    continue;
                }
                JsonNode ev = n.get("evidence");
                out.add(new CheckupEvaluator.Rule(
                        n.path("id").asText(""),
                        n.path("level").asText("obs"),
                        n.path("when").path("fact").asText(""),
                        op,
                        n.path("when").get("value"),
                        n.path("text").asText(""),
                        n.path("advice").asText(""),
                        ev == null || ev.isNull() ? null : ev.path("from").asText(""),
                        ev == null || ev.isNull() ? 3 : Math.max(1, Math.min(10, ev.path("limit").asInt(3)))));
            }
            return new Loaded(true, file.toString(), null, List.copyOf(out), root.path("count").asInt(out.size()));
        } catch (IOException | JacksonException e) {
            // Jackson 3 的 readTree 抛非受检 JacksonException —— 不兜它的话，
            // 「事实源 JSON 坏了」会穿透「如实记录原因并继续」的设计直接上抛
            return new Loaded(false, file.toString(), "观察项事实源读不了：" + e.getMessage(), List.of(), 0);
        }
    }

    /** 找到就返回路径，找不到返回 null（缺文件是合法状态，不是异常）。 */
    static Path resolve(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        Path configured = Paths.get(raw);
        if (configured.isAbsolute()) {
            return Files.isRegularFile(configured) ? configured.normalize() : null;
        }
        Path cwd = Paths.get("").toAbsolutePath().normalize();
        Path bare = bareRelative(configured);
        for (int up = 0; up <= MAX_UPWARD; up += 1) {
            Path base = cwd;
            for (int i = 0; i < up; i += 1) {
                base = base.getParent();
                if (base == null) break;
            }
            if (base == null) break;
            for (Path candidate : List.of(base.resolve(bare).normalize(), base.resolve(configured).normalize())) {
                if (Files.isRegularFile(candidate)) return candidate;
            }
        }
        return null;
    }

    /** 剥掉开头连续的 {@code ..}，得到可逐级向上拼的裸子路径。 */
    static Path bareRelative(Path configured) {
        List<String> parts = new ArrayList<>();
        boolean leading = true;
        for (Path p : configured.normalize()) {
            String s = p.toString();
            if (leading && "..".equals(s)) {
                continue;
            }
            leading = false;
            parts.add(s);
        }
        if (parts.isEmpty()) {
            return configured.normalize();
        }
        Path out = Paths.get(parts.get(0));
        for (int i = 1; i < parts.size(); i += 1) {
            out = out.resolve(parts.get(i));
        }
        return out;
    }
}
