package com.arsenal.qa;

import com.arsenal.engine.GlobMatcher;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 检测范围选择器：{@code full | review | focus} + include/exclude glob 集合。
 *
 * <p>两种局部语义（见 00-计划书 1.1.1）：
 * <ul>
 *   <li>{@code review} —— 严格局部：文件列表在引擎入口就被裁剪，圈外**真的没检查**；</li>
 *   <li>{@code focus} —— 全量扫描 + 聚焦呈现：引擎跑整仓（分层/闭包是全局事实），
 *       报告的明细只留圈内，圈外只给计数。</li>
 * </ul>
 *
 * <p>glob 语义与规则 targetGlob 同一台 {@link GlobMatcher}（前后端结论一致的既有约定）。
 * 路径口径是**工作副本内的相对路径（{@code /} 分隔）**：绝对路径、盘符、任何 {@code ..}
 * 段都在解析期直接拒绝 —— 这些 glob 由 HTTP 请求体进来，是外部输入。
 */
public final class QaRange {

    public static final String FULL = "full";
    public static final String REVIEW = "review";
    public static final String FOCUS = "focus";

    private final String mode;
    private final List<String> include;
    private final List<String> exclude;
    private final List<GlobMatcher> includeMatchers;
    private final List<GlobMatcher> excludeMatchers;

    private QaRange(String mode, List<String> include, List<String> exclude) {
        this.mode = mode;
        this.include = List.copyOf(include);
        this.exclude = List.copyOf(exclude);
        this.includeMatchers = include.stream().map(GlobMatcher::compile).toList();
        this.excludeMatchers = exclude.stream().map(GlobMatcher::compile).toList();
    }

    public static QaRange full() {
        return new QaRange(FULL, List.of(), List.of());
    }

    /** 从请求体解析。null / 缺省 = 整仓。非法输入一律 IllegalArgumentException（Controller 层转 400）。 */
    public static QaRange fromJson(JsonNode node) {
        if (node == null || node.isNull()) {
            return full();
        }
        if (!node.isObject()) {
            throw new IllegalArgumentException("range 必须是对象：{\"mode\":\"full|review|focus\",\"include\":[glob…],\"exclude\":[glob…]}");
        }
        String mode = node.path("mode").asText(FULL).trim().toLowerCase(Locale.ROOT);
        if (!mode.equals(FULL) && !mode.equals(REVIEW) && !mode.equals(FOCUS)) {
            throw new IllegalArgumentException("range.mode 只支持 full / review / focus，收到的是「" + mode + "」");
        }
        List<String> include = readGlobs(node.get("include"), "include");
        List<String> exclude = readGlobs(node.get("exclude"), "exclude");
        if (!mode.equals(FULL) && include.isEmpty()) {
            throw new IllegalArgumentException(mode + " 模式至少要有一个 include —— 要整仓检测请用 full 模式");
        }
        return new QaRange(mode, include, exclude);
    }

    private static List<String> readGlobs(JsonNode arr, String field) {
        List<String> out = new ArrayList<>();
        if (arr == null || arr.isNull()) {
            return out;
        }
        if (!arr.isArray()) {
            throw new IllegalArgumentException("range." + field + " 必须是字符串数组");
        }
        for (JsonNode n : arr) {
            String raw = n.asText("").trim().replace('\\', '/');
            validate(raw, field);
            out.add(raw);
        }
        return out;
    }

    private static void validate(String glob, String field) {
        if (glob.isEmpty()) {
            throw new IllegalArgumentException("range." + field + " 里有空的 glob");
        }
        if (glob.startsWith("/") || glob.matches("^[A-Za-z]:.*")) {
            throw new IllegalArgumentException("range." + field + " 只收仓库内相对路径，不接受绝对路径：" + glob);
        }
        for (String seg : glob.split("/")) {
            if (seg.equals("..")) {
                throw new IllegalArgumentException("range." + field + " 的 glob 里有越界的 ..（只能在仓库根内匹配）：" + glob);
            }
        }
    }

    /** relPath 必须是仓库根下的相对路径、{@code /} 分隔（与 AutopsyService.SourceFile 命名口径一致）。 */
    public boolean matches(String relPath) {
        if (mode.equals(FULL)) {
            return true;
        }
        String p = relPath.replace('\\', '/');
        boolean in = includeMatchers.isEmpty() || includeMatchers.stream().anyMatch(m -> m.matches(p));
        return in && excludeMatchers.stream().noneMatch(m -> m.matches(p));
    }

    public boolean isFull() {
        return mode.equals(FULL);
    }

    public boolean isReview() {
        return mode.equals(REVIEW);
    }

    public String mode() {
        return mode;
    }

    public List<String> include() {
        return include;
    }

    public List<String> exclude() {
        return exclude;
    }

    /** 把选择器原样写进报告（jobId 落盘、树接口回显都用它）。 */
    public void writeInto(ObjectNode n) {
        n.put("mode", mode);
        var inc = n.putArray("include");
        for (String g : include) {
            inc.add(g);
        }
        var exc = n.putArray("exclude");
        for (String g : exclude) {
            exc.add(g);
        }
    }
}
