package com.arsenal.loader;

import com.arsenal.domain.Rule;
import com.arsenal.domain.RuleFile;
import com.arsenal.domain.RulesetMeta;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;

/**
 * 规则加载器。
 *
 * 唯一的职责：把 arsenal-rules 目录里的 JSON 读成内存对象，并在读的过程中
 * 把「不合格的规则」拦下来。
 *
 * 一条设计原则：<b>有问题就启动失败，不要静默降级</b>。
 * 少加载三条规则和一个能跑的进程，前者危险得多 —— 你会以为自己在被 62 条规则保护，
 * 实际只有 59 条，而且永远发现不了。
 */
@Component
public class RuleLoader {

    private static final Logger log = LoggerFactory.getLogger(RuleLoader.class);

    /** 规则目录的识别标记。只认带它的目录 —— 名字碰巧相同的空目录不算数。 */
    private static final String META_FILE = "meta.json";
    /** 向上找多少级。仓库根到模块目录之间通常只有 1-2 级，6 级留足余量。 */
    private static final int MAX_UPWARD = 6;

    /** 配置原文，只用于日志与报错文案 */
    private final String configuredRaw;
    private final Path rulesRoot;
    private final ObjectMapper mapper;

    public RuleLoader(@Value("${arsenal.rules-dir}") String rulesDir, ObjectMapper mapper) {
        this.configuredRaw = rulesDir;
        this.mapper = mapper;
        this.rulesRoot = resolve(rulesDir);
    }

    public Path rulesRoot() {
        return rulesRoot;
    }

    /**
     * 解析规则目录。
     *
     * 不能只按工作目录解析相对路径 —— 这是踩过的坑：配置值 {@code ../arsenal-rules}
     * 在 arsenal-server 下启动时指向正确位置，在仓库根下启动时指向上一层并不存在的目录，
     * 服务直接起不来；而报错只说「目录不存在」，看不出其实是工作目录不对。
     *
     * 所以按「绝对路径 → 工作目录 → 逐级向上」依次试候选，
     * 并且<b>只接受带 meta.json 的目录</b>：判断依据是内容，不是名字。
     */
    private Path resolve(String raw) {
        Path configured = Paths.get(raw);
        Path cwd = Paths.get("").toAbsolutePath().normalize();

        // 绝对路径是明确指令：说哪个就是哪个，不做任何兜底猜测
        if (configured.isAbsolute()) {
            Path abs = configured.normalize();
            if (!isRuleset(abs)) {
                throw unusable(abs, List.of(abs), cwd, true);
            }
            log.info("规则目录：{}　（来自绝对路径配置）", abs);
            return abs;
        }

        List<Path> candidates = new ArrayList<>();
        addCandidate(candidates, cwd.resolve(configured));

        String bare = configured.getFileName() == null ? "" : configured.getFileName().toString();
        boolean byName = !bare.isEmpty() && !".".equals(bare) && !"..".equals(bare);
        if (byName) {
            addCandidate(candidates, cwd.resolve(bare));
        }

        Path up = cwd;
        for (int i = 0; i < MAX_UPWARD && up.getParent() != null; i++) {
            up = up.getParent();
            addCandidate(candidates, up.resolve(configured));
            if (byName) {
                addCandidate(candidates, up.resolve(bare));
            }
        }

        for (Path c : candidates) {
            if (isRuleset(c)) {
                if (c.equals(candidates.get(0))) {
                    log.info("规则目录：{}", c);
                } else {
                    log.info("规则目录：{}　—— 工作目录 {} 下没有，已自动换基准找到", c, cwd);
                }
                return c;
            }
        }
        throw unusable(candidates.get(0), candidates, cwd, false);
    }

    private void addCandidate(List<Path> out, Path p) {
        Path n = p.toAbsolutePath().normalize();
        if (!out.contains(n)) {
            out.add(n);
        }
    }

    private boolean isRuleset(Path p) {
        return Files.isDirectory(p) && Files.isRegularFile(p.resolve(META_FILE));
    }

    /** 报错要把「试过哪些路径、工作目录是什么」写全 —— 只说目录不存在，等于让人猜。 */
    private IllegalStateException unusable(Path primary, List<Path> tried, Path cwd, boolean absolute) {
        StringBuilder sb = new StringBuilder();
        sb.append("规则目录不可用：").append(primary);
        if (absolute) {
            sb.append("（配置 ").append(configuredRaw).append(" 是绝对路径，但该目录下没有 ").append(META_FILE).append("）");
            return new IllegalStateException(sb.toString());
        }
        sb.append("（目录不存在，或目录下没有 ").append(META_FILE).append("）")
                .append("\n  当前工作目录：").append(cwd)
                .append("\n  配置值 ").append(configuredRaw).append(" 按以下顺序试过，都不成立：");
        for (Path t : tried) {
            sb.append("\n    - ").append(t);
        }
        sb.append("\n  指定方式：启动参数 --arsenal.rules-dir=<绝对路径>，或环境变量 ARSENAL_RULES_DIR");
        return new IllegalStateException(sb.toString());
    }

    public LoadedRuleset load() {
        if (!Files.isDirectory(rulesRoot)) {
            throw new IllegalStateException(
                    "规则目录不存在：" + rulesRoot + "（用 arsenal.rules-dir 或环境变量 ARSENAL_RULES_DIR 指定）");
        }

        RulesetMeta meta = read(rulesRoot.resolve(META_FILE), RulesetMeta.class);
        List<Path> files = discover(meta);
        if (files.isEmpty()) {
            throw new IllegalStateException("规则目录下没有找到任何规则文件：" + rulesRoot);
        }

        List<Rule> all = new ArrayList<>();
        List<String> problems = new ArrayList<>();
        Set<String> seenIds = new HashSet<>();

        for (Path file : files) {
            RuleFile rf = read(file, RuleFile.class);
            String where = relative(file);
            for (Rule rule : rf.rules()) {
                inspect(rule, where, problems, seenIds);
                all.add(rule);
            }
        }

        if (!problems.isEmpty()) {
            throw new IllegalStateException(
                    "规则集完整性校验未通过，共 " + problems.size() + " 个问题，服务拒绝启动：\n  - "
                            + String.join("\n  - ", problems));
        }

        long mustClass = all.stream()
                .filter(r -> r.severity() != null && r.severity().blocking())
                .count();

        log.info("规则集加载完成：{} 条规则 / {} 个文件　版本 {}　强制级 {}/{}（{}%）",
                all.size(), files.size(), meta.version(), mustClass, meta.mustHardLimit(),
                Math.round(mustClass * 100.0 / Math.max(1, meta.mustHardLimit())));

        if (mustClass > meta.mustHardLimit()) {
            log.warn("强制级条目 {} 条已超出硬上限 {} 条 —— 规范超出人能记住的量就会变成摆设，请先降级几条",
                    mustClass, meta.mustHardLimit());
        }

        return new LoadedRuleset(meta, all, files);
    }

    // ──────────────────────────────────────────────── 内部

    private List<Path> discover(RulesetMeta meta) {
        List<Path> out = new ArrayList<>();
        for (RulesetMeta.Category c : meta.categories()) {
            Path dir = rulesRoot.resolve(c.dir());
            if (!Files.isDirectory(dir)) {
                log.warn("分类目录缺失，已跳过：{}", dir);
                continue;
            }
            try (Stream<Path> stream = Files.list(dir)) {
                stream.filter(Files::isRegularFile)
                        .filter(p -> p.getFileName().toString().endsWith(".json"))
                        .sorted()
                        .forEach(out::add);
            } catch (IOException e) {
                throw new UncheckedIOException("读取分类目录失败：" + dir, e);
            }
        }
        return out;
    }

    /**
     * 规则体检。四道闸门在这里落地：可判定、有 bad/good 示例、有检测方式、有出处。
     * 写不出反例的规则说明还没想清楚，不收。
     */
    private void inspect(Rule r, String file, List<String> problems, Set<String> seenIds) {
        if (r.id() == null || r.id().isBlank()) {
            problems.add(file + " 存在缺少 id 的规则");
            return;
        }
        String where = file + "#" + r.id();

        if (!seenIds.add(r.id())) {
            problems.add(where + " ID 重复（ID 永不复用，废弃后作废不回收）");
        }
        if (isBlank(r.category())) {
            problems.add(where + " 缺少 category");
        }
        if (isBlank(r.title())) {
            problems.add(where + " 缺少 title");
        }
        if (r.severity() == null) {
            problems.add(where + " 缺少 severity");
        }
        if (r.sources().isEmpty()) {
            problems.add(where + " 无来源出处 —— 无出处不收录，这是军火库的收录底线");
        }
        if (isBlank(r.rationale())) {
            problems.add(where + " 缺少 rationale");
        }
        if (isBlank(r.bad())) {
            problems.add(where + " 缺少 bad 反例 —— 写不出反例的规则说明还没想清楚");
        }
        if (isBlank(r.good())) {
            problems.add(where + " 缺少 good 正例");
        }
        if (isBlank(r.promptFragment())) {
            problems.add(where + " 缺少 promptFragment —— 没有它就无法喂给 AI");
        }

        Rule.Check c = r.checkOrEmpty();
        if (!c.hasRegex() && !c.hasAst() && !c.hasLlm() && !c.hasManual()) {
            problems.add(where + " check 四层全空 —— 这条规则无法被任何方式验证，等于没写");
        }
    }

    private boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private <T> T read(Path path, Class<T> type) {
        try {
            return mapper.readValue(Files.readString(path, StandardCharsets.UTF_8), type);
        } catch (IOException e) {
            throw new UncheckedIOException("解析规则文件失败：" + path, e);
        }
    }

    private String relative(Path p) {
        return rulesRoot.relativize(p).toString().replace('\\', '/');
    }
}
