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
 *
 * <p>踩过的坑（实测启动失败）：向上查找曾经是**拿原始的相对路径**去逐级 resolve，
 * 于是配置里那个 {@code ../arsenal-scan/scan_rules.json} 在第 up 级被解析成
 * 「第 up+1 级的 arsenal-scan」—— 起点那几级全部落空，方向整个反了。
 * 配 {@code ../} 只有工作目录正好是 {@code arsenal-server/} 时才碰巧成立，
 * 换成 IDE 直接跑主类（工作目录 = 仓库根）就找不到文件。
 *
 * <p>现在的口径：先把相对路径里的 {@code ../} 解析掉，拿到一个**裸的相对子路径**
 * （如 {@code arsenal-scan/scan_rules.json}），再拿它逐级向上拼。这样从
 * {@code arsenal-server/} 和从仓库根启动都能命中，配置里写 {@code ../} 也不再是把命运
 * 押在工作目录上。三级兜底按「越靠近工作目录越优先」排序，不合并成一条猜测。
 */
public class ScanRulesLoader {

    private static final int MAX_UPWARD = 6;

    /**
     * 归一化后的裸相对路径：剥掉纯前缀的 {@code ../}，得到可逐级向上拼的子路径。
     *
     * <p>形如 {@code ../arsenal-scan/scan_rules.json} → {@code arsenal-scan/scan_rules.json}。
     * 路径中段出现的 {@code ..}（如 {@code a/../b}）先正常 normalize 掉；
     * 只有**位于开头**的 {@code ..} 会被剥除，因为它们表达的是「相对工作目录往上几级」，
     * 而向上查找本身已经在枚举这个维度了。
     */
    static Path bareRelative(Path configured) {
        List<String> parts = new ArrayList<>();
        boolean leading = true;
        for (Path p : configured.normalize()) {
            String s = p.toString();
            if (leading && "..".equals(s)) {
                continue; // 开头连续的 .. 全部剥掉，交给逐级向上枚举
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
        Path bare = bareRelative(configured);
        List<Path> tried = new ArrayList<>();
        for (int up = 0; up <= MAX_UPWARD; up += 1) {
            Path base = cwd;
            for (int i = 0; i < up; i += 1) {
                base = base.getParent();
                if (base == null) break;
            }
            if (base == null) break;
            // 先按裸相对路径拼（工作目录 = 仓库根时这一条就命中），
            // 再退回原始写法（工作目录 = arsenal-server/ 时 ../ 才是对的）。
            // 两种写法都试，谁先命中用谁 —— 报错里会列出全部尝试过的路径。
            List<Path> candidates = bare.equals(configured.normalize())
                    ? List.of(base.resolve(bare).normalize())
                    : List.of(base.resolve(bare).normalize(), base.resolve(configured).normalize());
            for (Path candidate : candidates) {
                tried.add(candidate);
                if (Files.isRegularFile(candidate)) return candidate;
            }
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
