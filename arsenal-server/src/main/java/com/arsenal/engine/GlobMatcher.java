package com.arsenal.engine;

import java.util.regex.Pattern;

/**
 * glob → 正则。规则的 targetGlob 用它筛文件。
 *
 * 支持 `**`（跨目录）、`*`（单层）、`?`（单字符）、`{a,b}`（择一）。
 * `**&#47;` 允许匹配零层目录，这样 `**&#47;controller/**&#47;*.java` 也能命中
 * 用户只填了文件名的场景。
 *
 * 与前端 arsenal-web/src/lib/engine.ts 的 globToRegExp 保持完全相同的行为 ——
 * 两端结论不一致比没有校验更糟。
 */
public final class GlobMatcher {

    private final String glob;
    private final Pattern pattern;

    private GlobMatcher(String glob, Pattern pattern) {
        this.glob = glob;
        this.pattern = pattern;
    }

    public static GlobMatcher compile(String glob) {
        String g = (glob == null || glob.isBlank()) ? "**/*" : glob.trim();
        return new GlobMatcher(g, Pattern.compile(toRegex(g), Pattern.CASE_INSENSITIVE));
    }

    /**
     * 逗号分隔的配置串 → matcher 列表（夜班 N5/2026-10-30 起供 {@code arsenal.lint.ignore-globs} 用）。
     * 空串 / null / 全是空段 → 空列表（调用方用它表示「无追加规则」，不能塞进一个空 glob 误伤全仓）。
     */
    public static java.util.List<GlobMatcher> listOf(String commaSeparated) {
        java.util.List<GlobMatcher> out = new java.util.ArrayList<>();
        if (commaSeparated == null || commaSeparated.isBlank()) {
            return out;
        }
        for (String part : commaSeparated.split(",")) {
            String g = part.trim();
            if (!g.isEmpty()) {
                out.add(compile(g));
            }
        }
        return out;
    }

    public boolean matches(String path) {
        return pattern.matcher(normalize(path)).matches();
    }

    public String glob() {
        return glob;
    }

    static String toRegex(String glob) {
        StringBuilder out = new StringBuilder("^");
        for (int i = 0; i < glob.length(); i++) {
            char c = glob.charAt(i);
            switch (c) {
                case '*' -> {
                    if (i + 1 < glob.length() && glob.charAt(i + 1) == '*') {
                        i++;
                        if (i + 1 < glob.length() && glob.charAt(i + 1) == '/') {
                            i++;
                            out.append("(?:.*/)?"); // **/ 允许零层
                        } else {
                            out.append(".*");
                        }
                    } else {
                        out.append("[^/]*");
                    }
                }
                case '?' -> out.append("[^/]");
                case '{' -> {
                    int end = glob.indexOf('}', i);
                    if (end < 0) {
                        out.append("\\{");
                    } else {
                        String[] alts = glob.substring(i + 1, end).split(",");
                        out.append("(?:");
                        for (int k = 0; k < alts.length; k++) {
                            if (k > 0) {
                                out.append('|');
                            }
                            out.append(Pattern.quote(alts[k].trim()));
                        }
                        out.append(')');
                        i = end;
                    }
                }
                default -> out.append(Pattern.quote(String.valueOf(c)));
            }
        }
        return out.append('$').toString();
    }

    /** 统一成 posix 风格并去掉前导 ./ 与 /，因为用户粘贴的路径什么样都有。 */
    public static String normalize(String path) {
        if (path == null) {
            return "";
        }
        String p = path.replace('\\', '/');
        while (p.startsWith("./")) {
            p = p.substring(2);
        }
        while (p.startsWith("/")) {
            p = p.substring(1);
        }
        return p;
    }
}
