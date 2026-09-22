package com.arsenal.scan;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

/**
 * 扫描映射表的加载器。与 {@code RuleLoader} 同一套脾气：**有问题就启动失败，不静默降级**。
 *
 * 少加载二十条映射的后果不是「少认出二十个依赖」，是那二十个依赖会静默落进
 * 「未识别清单」 —— 而用户会把那份清单当成「我的项目真的没用这些」。
 *
 * 目录定位与规则目录同理：绝对路径是明确指令；相对路径按「工作目录 → 逐级向上」找，
 * 并且只认带 {@code scan_rules.json} 的 {@code arsenal-scan} 目录（判断依据是内容不是名字）。
 */
public class ScanRulesLoader {

    private static final int MAX_UPWARD = 6;

    private final Path file;
    private final List<ScanRule> rules;

    public ScanRulesLoader(String configured, ObjectMapper mapper) {
        this.file = resolve(configured);
        this.rules = load(this.file, mapper);
    }

    public ScanRulesLoader(Path file, ObjectMapper mapper) {
        this.file = file;
        this.rules = load(file, mapper);
    }

    public Path file() {
        return file;
    }

    public List<ScanRule> rules() {
        return rules;
    }

    public int count() {
        return rules.size();
    }

    private static Path resolve(String raw) {
        Path configured = Paths.get(raw);
        if (configured.isAbsolute()) {
            if (!Files.isRegularFile(configured)) {
                throw new IllegalStateException("扫描映射表不存在：" + configured);
            }
            return configured.normalize();
        }
        Path cwd = Paths.get("").toAbsolutePath().normalize();
        List<Path> tried = new ArrayList<>();
        for (int up = 0; up <= MAX_UPWARD; up += 1) {
            Path base = cwd;
            for (int i = 0; i < up; i += 1) {
                base = base.getParent();
                if (base == null) break;
            }
            if (base == null) break;
            Path candidate = base.resolve(configured).normalize();
            tried.add(candidate);
            if (Files.isRegularFile(candidate)) return candidate;
        }
        throw new IllegalStateException(
                "扫描映射表不存在。已尝试：" + tried + "（工作目录 " + cwd + "）");
    }

    private static List<ScanRule> load(Path path, ObjectMapper mapper) {
        JsonNode root;
        try {
            root = mapper.readTree(Files.readAllBytes(path));
        } catch (IOException e) {
            throw new UncheckedIOException("扫描映射表读取失败：" + path, e);
        }
        JsonNode arr = root.get("rules");
        if (arr == null || !arr.isArray() || arr.isEmpty()) {
            throw new IllegalStateException("扫描映射表里没有 rules：" + path);
        }
        List<ScanRule> out = new ArrayList<>();
        for (JsonNode n : arr) {
            out.add(new ScanRule(
                    text(n, "kind"), text(n, "group"), text(n, "artifact"),
                    text(n, "tech"), text(n, "icon"), text(n, "dim"),
                    text(n, "opt"), text(n, "name")));
        }
        return List.copyOf(out);
    }

    private static String text(JsonNode n, String field) {
        JsonNode v = n.get(field);
        return v == null || v.isNull() ? null : v.asText();
    }
}
