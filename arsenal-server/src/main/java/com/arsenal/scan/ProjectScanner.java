package com.arsenal.scan;

import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.nio.file.FileVisitOption;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.List;

/**
 * 扫描编排：一个目录 → 一份 {@code ProjectFacts}。
 *
 * <b>只记录读到的东西。</b>这里没有任何一处「默认值」：
 * 副本数读不到是 {@code null} + 一条 note，Java 版本读不到是 {@code null} + 一条 note。
 * 「填个 1 看起来完整一点」是这套东西最危险的写法 ——
 * 事实 JSON 会被当成依据写进文档，编出来的数字会一路传到交付物里。
 *
 * 五个子 Scanner 之间没有依赖，顺序固定是为了输出稳定（事实 JSON 逐字段可比）。
 */
public final class ProjectScanner {

    private final ScanRulesLoader rulesLoader;
    private final ObjectMapper mapper;
    private final TechStackResolver resolver;

    public ProjectScanner(ScanRulesLoader rulesLoader, ObjectMapper mapper) {
        this.rulesLoader = rulesLoader;
        this.mapper = mapper;
        this.resolver = new TechStackResolver(rulesLoader.rules());
    }

    public int ruleCount() {
        return rulesLoader.count();
    }

    public Path rulesFile() {
        return rulesLoader.file();
    }

    /**
     * 扫描一个已经解析好的输入源。
     *
     * @param source 输入源（本地目录 / zip / git 都是它）
     */
    public ObjectNode scan(SourceResolver source) {
        long start = System.currentTimeMillis();
        try (source) {
            boolean[] collectFlags = new boolean[2];
            List<Path> files = collect(source.root(), collectFlags);
            ScanContext ctx = new ScanContext(source.root(), files, mapper, ScanGuard.TIMEOUT_MS);
            if (collectFlags[0]) {
                ctx.warn(ScanNote.DEPTH_EXCEEDED,
                        "目录深度超过 " + ScanGuard.MAX_DEPTH + " 层，更深的内容没有扫");
                ctx.markTruncated();
            }
            if (collectFlags[1]) {
                ctx.warn(ScanNote.TRUNCATED,
                        "总字节超过上限 " + ScanGuard.MAX_TOTAL_BYTES / 1024 / 1024 + "MB，不再收集更多文件");
                ctx.markTruncated();
            }
            ObjectNode facts = mapper.createObjectNode();
            facts.put("schemaVersion", 1);
            facts.put("root", source.rootName());
            facts.put("sourceKind", source.kind());
            facts.put("scannedAt", OffsetDateTime.now().toString());

            List<ScannedDep> deps = new ArrayList<>();
            ObjectNode build = BuildScanner.scan(ctx, deps);
            facts.set("build", build);

            ArrayNode config = ConfigScanner.scan(ctx);
            facts.set("config", config);

            ObjectNode deploy = DeployScanner.scan(ctx);
            ArrayNode ci = CiScanner.scan(ctx);
            deploy.set("ci", ci);
            facts.set("deploy", deploy);

            ObjectNode code = CodeScanner.scan(ctx);
            facts.set("code", code);

            facts.set("frontend", scanFrontend(ctx, deps));

            ObjectNode techStack = resolver.resolve(deps, mapper);
            facts.set("techStack", techStack);
            // 未命中的依赖必须留下痕迹：这份清单本身就是待补的映射与图标
            ArrayNode unmatched = (ArrayNode) techStack.get("unmatched");
            if (unmatched != null) {
                for (var n : unmatched) {
                    ctx.warn(ScanNote.UNMAPPED_DEPENDENCY,
                            "未收录依赖 " + n.path("group").asText() + ":" + n.path("artifact").asText()
                                    + "（" + n.path("count").asInt() + " 处）");
                }
            }
            if (ctx.truncated()) {
                ctx.note(ScanNote.WARN, ScanNote.TRUNCATED, "扫描被闸门截断，以下事实可能不完整");
            }

            ObjectNode stats = facts.putObject("stats");
            stats.put("files", files.size());
            stats.put("bytes", totalBytes(files));
            stats.put("truncated", ctx.truncated());
            stats.put("elapsedMs", System.currentTimeMillis() - start);

            ArrayNode notes = facts.putArray("notes");
            for (ScanNote n : ctx.sortedNotes()) {
                ObjectNode o = notes.addObject();
                o.put("level", n.level());
                o.put("code", n.code());
                o.put("message", n.message());
            }
            return facts;
        } catch (ScanException e) {
            throw e;
        } catch (Exception e) {
            throw new ScanException(ScanException.BAD_REQUEST, "扫描失败：" + e.getMessage());
        }
    }

    /**
     * 收集待读文件。
     *
     * <p>用 {@link java.nio.file.Files#walkFileTree} 而不是 {@code Files.walk}：
     * 后者的跳过只能 {@code continue}，流本身照样会走进 {@code node_modules} 把几万个文件
     * 枚举一遍（我们不读，但磁盘要转）。{@code SKIP_SUBTREE} 才是真的不进那个目录。
     *
     * <p>{@code flags[0]} = 有过深目录被截断，{@code flags[1]} = 总字节触顶被截断。
     * 两者都**必须留 note**：扫描器悄悄少读一部分，事实 JSON 看起来就像「这个仓库就这么多」。
     * 每个文件还要过「真实路径在根内」这一关 —— 软链外跳在这里被拦下。
     */
    private List<Path> collect(Path root, boolean[] flags) {
        List<Path> out = new ArrayList<>();
        long[] bytes = {0};
        try {
            Files.walkFileTree(root, EnumSet.noneOf(FileVisitOption.class), ScanGuard.MAX_DEPTH + 1,
                    new SimpleFileVisitor<Path>() {
                        @Override
                        public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
                            if (dir.equals(root)) return FileVisitResult.CONTINUE;
                            String name = dir.getFileName() == null ? "" : dir.getFileName().toString();
                            if (ScanGuard.skipDir(name)) return FileVisitResult.SKIP_SUBTREE;
                            // 多走一层是为了「看得见过深」：不走就不知道有没有被截断
                            if (ScanGuard.depth(root, dir) > ScanGuard.MAX_DEPTH) {
                                flags[0] = true;
                                return FileVisitResult.SKIP_SUBTREE;
                            }
                            return FileVisitResult.CONTINUE;
                        }

                        @Override
                        public FileVisitResult visitFile(Path p, BasicFileAttributes attrs) {
                            // maxDepth 边界上的**目录**会被 walkFileTree 报到这里来
                            // （实测：22 层目录里 d21 走的是 visitFile，而它是个目录）。
                            // 不判这一下，超深的部分就静默消失 —— 正是这一层要防的事。
                            int d = ScanGuard.depth(root, p);
                            if (attrs.isDirectory() || d > ScanGuard.MAX_DEPTH) {
                                if (d > ScanGuard.MAX_DEPTH) flags[0] = true;
                                return FileVisitResult.CONTINUE;
                            }
                            String name = p.getFileName() == null ? "" : p.getFileName().toString();
                            if (!ScanGuard.isInside(root, p)) {
                                // 软链指向仓库外 —— 读了就等于把仓库外的东西塞进事实
                                return FileVisitResult.CONTINUE;
                            }
                            if (!ScanGuard.readable(name)) return FileVisitResult.CONTINUE;
                            long size = attrs.size();
                            if (bytes[0] + size > ScanGuard.MAX_TOTAL_BYTES) {
                                // 不是拒绝这一次扫描，是到此为止：已收集的部分照样出事实
                                flags[1] = true;
                                return FileVisitResult.TERMINATE;
                            }
                            bytes[0] += size;
                            out.add(p);
                            if (out.size() > ScanGuard.MAX_FILES) {
                                throw ScanException.tooLarge("文件数超过上限 " + ScanGuard.MAX_FILES);
                            }
                            return FileVisitResult.CONTINUE;
                        }

                        @Override
                        public FileVisitResult visitFileFailed(Path p, IOException e) {
                            // 单个文件读不了不该让整次扫描失败，跳过即可
                            return FileVisitResult.CONTINUE;
                        }
                    });
        } catch (ScanException e) {
            throw e;
        } catch (IOException e) {
            throw ScanException.badRequest("目录无法遍历：" + e.getMessage());
        }
        out.sort(Comparator.comparing(Path::toString));
        return out;
    }

    private long totalBytes(List<Path> files) {
        long total = 0;
        for (Path p : files) {
            try {
                total += Files.size(p);
            } catch (IOException ignored) {
                // 读不到大小就不计入，总数本来就是「读到的」
            }
        }
        return total;
    }

    /**
     * 前端事实：从 npm 依赖与目录结构读。
     * 认不出框架就写 unknown —— 一个 Next.js 项目和一个 React SPA 的部署形态完全不同，
     * 猜错了整张部署图都是错的。
     */
    private ObjectNode scanFrontend(ScanContext ctx, List<ScannedDep> deps) {
        ObjectNode fe = ctx.mapper().createObjectNode();
        boolean next = false, react = false, vue = false;
        List<String> feDeps = new ArrayList<>();
        for (ScannedDep d : deps) {
            if (!"npm".equals(d.kind())) continue;
            feDeps.add(d.artifact());
            switch (d.artifact()) {
                case "next" -> next = true;
                case "react", "react-dom" -> react = true;
                case "vue" -> vue = true;
                default -> {
                    // 其余前端依赖只登记
                }
            }
        }
        fe.put("kind", next ? "next" : vue ? "vue" : react ? "react" : feDeps.isEmpty() ? null : "unknown");
        ArrayNode depArr = fe.putArray("deps");
        feDeps.stream().distinct().sorted().forEach(depArr::add);

        ArrayNode routes = fe.putArray("routes");
        List<String> routePaths = new ArrayList<>();
        for (Path p : ctx.files()) {
            String rel = ctx.rel(p);
            String name = p.getFileName().toString();
            if (!name.equals("page.tsx") && !name.equals("page.jsx") && !name.equals("index.js")
                    && !name.equals("index.tsx")) {
                continue;
            }
            if (!rel.contains("/app/") && !rel.contains("/pages/")) continue;
            int marker = rel.contains("/app/") ? rel.indexOf("/app/") : rel.indexOf("/pages/");
            String sub = rel.substring(marker + (rel.contains("/app/") ? 5 : 7));
            int cut = sub.lastIndexOf('/');
            String dir = cut > 0 ? sub.substring(0, cut) : "/";
            String route = "/" + dir.replace("/page", "").replace("//", "/");
            route = route.replaceAll("/+", "/");
            if (!routePaths.contains(route)) routePaths.add(route);
        }
        routePaths.stream().sorted().forEach(routes::add);
        return fe;
    }
}
