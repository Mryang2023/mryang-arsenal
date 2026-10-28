import com.arsenal.scan.ProjectScanner;
import com.arsenal.scan.ScanException;
import com.arsenal.scan.ScanRulesLoader;
import com.arsenal.scan.ScanContext;
import com.arsenal.scan.ScanGuard;
import com.arsenal.scan.SourceResolver;
import com.arsenal.projects.ProjectCache;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 扫描引擎的端到端探针（校验工具，不进 src/main/java）。
 *
 * 存在的理由与 ArchifyProbe 同一条：**编译通过不等于真的能扫**。
 * 前端那层断言要的是「照着 fixture 目录扫出来的真实事实」，
 * 在 TS 里自己造一份 facts 等于验自己造的输入 —— 那是恒真的。
 *
 * 用法（由 arsenal-web/.verify/scan-check.ts 编排）：
 *   ScanProbe <out.json> <动作> [动作...]
 *
 * 动作：
 *   facts:<目录>      扫描本地目录，回带完整 ProjectFacts
 *   zip:<zip 文件>    上传式扫描（复用 SourceResolver.fromZip 的闸门）
 *   git:<url>         git 输入（闸门应当拒绝非 https）
 *   mkbigfile-repo:<目录>  造 3MB 单文件（单文件闸门）
 *   mkdeep-repo:<目录>     造 22 层深目录（深度闸门）
 *   mkfiles-repo:<目录>    造 20001 个文件（文件数闸门）
 *   mkbigfile-repo:<目录>  造 3MB 单文件（单文件闸门）
 *   mkdeep-repo:<目录>     造 22 层深目录（深度闸门）
 *   mkfiles-repo:<目录>    造 20001 个文件（文件数闸门）
 *   rules:            回带映射表条数
 *
 * 每个动作独立成一条收据：失败也写进结果里（带 code），
 * 因为「这个输入应该被拒」本身就是要断言的东西。
 */
public class ScanProbe {

    /** 造一个恶意 zip：条目名 ../escape.txt（或绝对路径），以及可选的 3MB 大文件 */
    private static void makeZip(String out, boolean escape, boolean large) throws Exception {
        Path p = Paths.get(out);
        Files.createDirectories(p.getParent());
        try (var zos = new java.util.zip.ZipOutputStream(Files.newOutputStream(p))) {
            zos.putNextEntry(new java.util.zip.ZipEntry("src/Ok.java"));
            zos.write("class Ok {}\n".getBytes(StandardCharsets.UTF_8));
            zos.closeEntry();
            if (escape) {
                zos.putNextEntry(new java.util.zip.ZipEntry("../escape.txt"));
                zos.write("pwned".getBytes(StandardCharsets.UTF_8));
                zos.closeEntry();
                zos.putNextEntry(new java.util.zip.ZipEntry("/abs-escape.txt"));
                zos.write("pwned".getBytes(StandardCharsets.UTF_8));
                zos.closeEntry();
            }
            if (large) {
                zos.putNextEntry(new java.util.zip.ZipEntry("big.bin"));
                byte[] chunk = new byte[64 * 1024];
                for (int i = 0; i < 3 * 1024 * 1024 / chunk.length; i += 1) {
                    zos.write(chunk);
                }
                zos.closeEntry();
            }
        }
    }

    /**
     * 造一个指向仓库外的软链接。Windows 上没权限时会失败 —— 那不是「闸门没生效」，
     * 是造不出用例，收据里如实写 created=false，由调用方决定怎么算。
     */
    private static boolean makeSymlink(String dir) {
        try {
            Path d = Paths.get(dir);
            Path link = d.resolve("outside-link.txt");
            Files.deleteIfExists(link);
            Files.createSymbolicLink(link, d.getParent().resolve("outside-target.txt").toAbsolutePath());
            Files.writeString(d.getParent().resolve("outside-target.txt"), "top secret\n", StandardCharsets.UTF_8);
            return Files.isSymbolicLink(link);
        } catch (Exception e) {
            return false;
        }
    }


    /**
     * 造一个含 3MB 单文件的目录。
     *
     * 验的是「单文件闸门」：它不该让整次扫描失败 —— 该文件的**内容**不读、
     * 留一条 FILE_TOO_LARGE，其余事实照常产出。这跟 zip 那条路不同
     * （zip 在解包时就抛 TOO_LARGE，因为解包本身才是风险）。
     */
    private static void makeBigFileRepo(String dir) throws Exception {
        Path d = Paths.get(dir);
        Files.createDirectories(d);
        byte[] chunk = new byte[64 * 1024];
        java.util.Arrays.fill(chunk, (byte) 'a');
        Path f = d.resolve("Big.java");
        try (var out = Files.newOutputStream(f)) {
            out.write("class Big { String pad = \"".getBytes(StandardCharsets.UTF_8));
            for (int i = 0; i < 3 * 1024 * 1024 / chunk.length; i += 1) {
                out.write(chunk);
            }
            out.write("\"; }".getBytes(StandardCharsets.UTF_8));
        }
        Files.writeString(d.resolve("pom.xml"),
                "<project><modelVersion>4.0.0</modelVersion><artifactId>big</artifactId></project>\n",
                StandardCharsets.UTF_8);
    }

    /** 造一个 22 层深的目录（上限是 20）。深度闸门应当截断并留 note，而不是静默少读 */
    private static void makeDeepRepo(String dir) throws Exception {
        Path p = Paths.get(dir);
        Files.createDirectories(p);
        for (int i = 1; i <= 22; i += 1) {
            p = p.resolve("d" + i);
        }
        Files.createDirectories(p);
        Files.writeString(p.resolve("Deep.java"), "class Deep {}\n", StandardCharsets.UTF_8);
        Files.writeString(Paths.get(dir).resolve("Top.java"), "class Top {}\n", StandardCharsets.UTF_8);
    }

    /** 造 20001 个文件：文件数闸门应当直接拒绝整次扫描（SCAN_TOO_LARGE） */
    private static void makeManyFilesRepo(String dir) throws Exception {
        Path p = Paths.get(dir);
        Files.createDirectories(p);
        for (int i = 0; i < 20_001; i += 1) {
            Path f = p.resolve("F" + i + ".java");
            // 幂等：已存在就跳过。createFile 对已存在文件会抛，重跑 verify 就炸在这里
            if (Files.notExists(f)) {
                Files.write(f, new byte[0]);
            }
        }
    }

    /** 纯拼路径用的 N 层子路径（不落盘）：ScanGuard.depth 只做 relativize，不碰磁盘 */
    private static Path descend(Path root, int levels) {
        Path p = root;
        for (int i = 1; i <= levels; i += 1) {
            p = p.resolve("l" + i);
        }
        return p.resolve("Leaf.java");
    }

    /**
     * 超限二进制「跳过并记账」的摄取侧夹具 + 采集（r16 / P1-1c）。
     *
     * <p>为什么在 ScanProbe 而不是 ProjectsProbe：断言要搭 verify:scan 的门禁 ——
     * checkup 那层常态 9 项未执行，跑一趟比 scan 贵一个量级。
     *
     * <p>探针只回吐事实（stat / manifest 逐条 / 缓存里到底有没有落盘），不判对错；
     * 期望表在前端。withOversize=false 是给「反向对照」用的：同一条链、少放那个 3MB 文件，
     * 记账必须是 0 —— 否则「skippedFiles 恒等于 1」也算过。
     */
    private static void runOversizeIngest(ObjectNode receipt, ObjectMapper mapper, String work, boolean withOversize)
            throws Exception {
        Path w = Paths.get(work);
        Path src = w.resolve("src");
        Path cacheRoot = w.resolve("cache");
        deleteTree(src);
        deleteTree(cacheRoot);
        Files.createDirectories(src.resolve("src"));
        Files.createDirectories(src.resolve("assets"));
        Files.writeString(src.resolve("pom.xml"),
                "<project><modelVersion>4.0.0</modelVersion><artifactId>oversize</artifactId></project>\n",
                StandardCharsets.UTF_8);
        Files.writeString(src.resolve("src").resolve("App.java"), "class App {}\n", StandardCharsets.UTF_8);
        if (withOversize) {
            // 3MB 且不在 TEXT_EXT 白名单：不参与任何静态分析的资源，该跳过并记账而不是整份拒绝
            Files.write(src.resolve("assets").resolve("ip2region.xdb"), new byte[3 * 1024 * 1024]);
        }

        ObjectNode stat;
        try {
            stat = new ProjectCache(cacheRoot, mapper).ingestPath("probe-oversize", src);
        } catch (Exception e) {
            receipt.put("ok", false);
            receipt.put("code", "INGEST_THREW");
            receipt.put("message", e.getClass().getName() + ": " + e.getMessage());
            receipt.put("targetLeft", Files.isDirectory(cacheRoot.resolve("probe-oversize")));
            return;
        }

        Path target = cacheRoot.resolve("probe-oversize");
        ObjectNode out = mapper.createObjectNode();
        out.put("files", stat.path("files").asInt());
        out.put("bytes", stat.path("bytes").asLong());
        out.put("skippedFiles", stat.path("skippedFiles").asInt());
        ObjectNode manifest = (ObjectNode) mapper.readTree(target.resolve("manifest.json").toFile());
        ArrayNode rows = out.putArray("manifest");
        for (var n : manifest.withArray("files")) {
            rows.addObject()
                    .put("rel", n.path("rel").asText())
                    .put("skipped", n.path("skipped").asBoolean(false));
        }
        Path repo = target.resolve("repo");
        out.put("pomCopied", Files.isRegularFile(repo.resolve("pom.xml")));
        out.put("appCopied", Files.isRegularFile(repo.resolve("src").resolve("App.java")));
        out.put("xdbCopied", Files.isRegularFile(repo.resolve("assets").resolve("ip2region.xdb")));
        receipt.put("ok", true);
        receipt.set("ingest", out);
    }

    /** 重跑前先拆干净：夹具必须每次从同一个形状长出来，否则第二次跑读的是第一轮的缓存 */
    private static void deleteTree(Path dir) throws Exception {
        if (dir == null || Files.notExists(dir)) return;
        List<Path> all = new ArrayList<>();
        try (var walk = Files.walk(dir)) {
            walk.forEach(all::add);
        }
        all.sort(Comparator.reverseOrder());
        for (Path p : all) {
            Files.deleteIfExists(p);
        }
    }


    /**
     * 造一个含 3MB 单文件的目录。
     *
     * 验的是「单文件闸门」：它不该让整次扫描失败 —— 该文件的**内容**不读、
     * 留一条 FILE_TOO_LARGE，其余事实照常产出。这跟 zip 那条路不同
     * （zip 在解包时就抛 TOO_LARGE，因为解包本身才是风险）。
     */
    public static void main(String[] args) throws Exception {
        if (args.length < 2) {
            System.out.println("用法: ScanProbe <out.json> <动作...>");
            System.exit(2);
        }
        Path out = Paths.get(args[0]);
        ObjectMapper mapper = new ObjectMapper();
        ScanRulesLoader loader = new ScanRulesLoader("../arsenal-scan/scan_rules.json", mapper);
        ProjectScanner scanner = new ProjectScanner(loader, mapper);
        ArrayNode receipts = mapper.createArrayNode();

        for (int i = 1; i < args.length; i += 1) {
            String action = args[i];
            int colon = action.indexOf(':');
            String kind = colon < 0 ? action : action.substring(0, colon);
            String value = colon < 0 ? "" : action.substring(colon + 1);
            ObjectNode receipt = receipts.addObject();
            receipt.put("action", action);
            receipt.put("kind", kind);
            long t0 = System.currentTimeMillis();
            try {
                switch (kind) {
                    case "facts" -> {
                        receipt.put("ok", true);
                        receipt.set("facts", scanner.scan(SourceResolver.fromPath(value)));
                    }
                    case "zip" -> {
                        try (InputStream in = Files.newInputStream(Paths.get(value))) {
                            receipt.put("ok", true);
                            receipt.set("facts", scanner.scan(SourceResolver.fromZip(in)));
                        }
                    }
                    case "git" -> {
                        receipt.put("ok", true);
                        receipt.set("facts", scanner.scan(SourceResolver.fromGit(value)));
                    }
                    case "mkzip-escape" -> makeZip(value, true, false);
                    case "mkzip-large" -> makeZip(value, false, true);
                    case "mkbigfile-repo" -> {
                        makeBigFileRepo(value);
                        receipt.put("ok", true);
                    }
                    case "mkdeep-repo" -> {
                        makeDeepRepo(value);
                        receipt.put("ok", true);
                    }
                    case "mkfiles-repo" -> {
                        makeManyFilesRepo(value);
                        receipt.put("ok", true);
                    }
                    case "oversize-skip" -> runOversizeIngest(receipt, mapper, value, true);
                    case "oversize-clean" -> runOversizeIngest(receipt, mapper, value, false);
                    case "mksymlink" -> {
                        ObjectNode n = mapper.createObjectNode();
                        n.put("created", makeSymlink(value));
                        receipt.put("ok", true);
                        receipt.set("symlink", n);
                    }
                    case "rules" -> {
                        ObjectNode n = mapper.createObjectNode();
                        n.put("count", scanner.ruleCount());
                        n.put("file", scanner.rulesFile().toString().replace('\\', '/'));
                        receipt.put("ok", true);
                        receipt.set("rules", n);
                    }
                    case "guard-info" -> {
                        // 把 ScanGuard 的四个常量（规模 / 时间闸门）原样回吐，让前端的断言能核对
                        // 「配置项存在且被读取」—— 改小常量就能让对应的断言变红
                        ObjectNode n = mapper.createObjectNode();
                        n.put("maxFiles", ScanGuard.MAX_FILES);
                        n.put("maxTotalBytes", ScanGuard.MAX_TOTAL_BYTES);
                        n.put("maxDepth", ScanGuard.MAX_DEPTH);
                        n.put("timeoutMs", ScanGuard.TIMEOUT_MS);
                        n.put("maxFileBytes", ScanGuard.MAX_FILE_BYTES);
                        receipt.put("ok", true);
                        receipt.set("guard", n);
                    }
                    case "guard-pure" -> {
                        // 纯判定函数的逐分支判定。为什么没有黑盒路径：zip 条目名只要出圈，
                        // 观测到的永远是同一个整包 SCAN_BAD_REQUEST（见 3-1），五个分支之间
                        // 区分不开 —— 喂十种坏条目名，得到的回执一模一样。
                        // 沿用 guard-timeout 的先例（「不真等 180s」）：直接调函数、原样回吐，
                        // **期望值留在前端** —— 探针不判对错，否则失败信息又是自己编的。
                        ArrayNode entries = mapper.createArrayNode();
                        // NUL 用 (char) 0 拼，不写反斜杠-u 转义：一来落盘是 UTF-8，转义被编辑器吞成
                        // U+00A0 是本轮实测发生过的，吞掉之后这条用例会静默地测错东西（NUL 分支根本
                        // 没被喂到）；二来 javac 的词法预处理对**注释里**的反斜杠-u 同样生效，实测
                        // 当场报「非法的 Unicode 逃逸」—— 注释都编译不过，比测试写错更糟。
                        String nulName = "a" + (char) 0 + "b.txt";
                        for (String nm : new String[]{
                                "src/Ok.java",                          // 正常条目，必须放行
                                "../escape.txt", "/abs.txt",            // POSIX 两种出圈
                                "..\\..\\win.txt",                      // 反斜杠：只查 / 会漏的那条
                                "C:/Windows/win.ini", "c:/x.txt",       // Windows 盘符（大小写都过）
                                "//unc/share.txt",                      // UNC
                                "./x.txt", nulName, ""          // 点分段 / NUL / 空名
                        }) {
                            ObjectNode e = entries.addObject();
                            e.put("name", nm);
                            e.put("safe", ScanGuard.zipEntrySafe(nm));
                        }
                        ArrayNode redacts = mapper.createArrayNode();
                        String pem = "head\n-----BEGIN RSA PRIVATE KEY-----\nMIISECRETBODY\n-----END RSA PRIVATE KEY-----\ntail";
                        for (String[] kv : new String[][]{
                                {"spring.datasource.password", "RealSecret"},
                                {"banner", pem},   // 键名不敏感，靠值级 PEM 兜底
                                {"note", "plain text"}
                        }) {
                            ObjectNode r = redacts.addObject();
                            r.put("key", kv[0]);
                            r.put("out", ScanGuard.redact(kv[0], kv[1]));
                        }

                        // ── r15：其余几处「黑盒看不出是哪条分支」的纯判定 ──────────────
                        // 逐条的为什么（判定过程见 RUNLOG r15）：
                        //   readable 的具名文件分支 —— fixture 只有 Dockerfile 一个具名名，
                        //     Jenkinsfile / Makefile / Dockerfile.<后缀> / 大写扩展名 四条各删一行链都不红；
                        //   skippableOversize 的分岔 —— 超限「源码拒绝」那半条有 ProjectsProbe.quota
                        //     钉住，超限「二进制跳过」这半条全仓库 0 条断言（含 skippedFiles 记账）；
                        //   gitUrlAllowed 的正向 —— 3-3/3-4/3-5 断言的全是拒绝，函数改成恒 false
                        //     那三条一条不变，而用户再也加不进任何 git 项目；
                        //   fileTooLarge / isInside 的 catch —— 读不到大小、真实路径解析失败都按
                        //     「拦下」处理；改成 fail-open 得用超限文件或断链软链才撞得出来。
                        // 判定用 ASCII id 做键（值里带空格与制表符的 URL 靠 id 对，不靠字符串对）。
                        ArrayNode readables = mapper.createArrayNode();
                        for (String nm : new String[]{
                                "App.java", "Script.PY",           // 白名单 / 大写扩展名先归一化
                                "Dockerfile", "Dockerfile.prod",   // 具名文件 / 前缀分支
                                "Jenkinsfile", "Makefile",
                                ".env",                            // 点开头：扩展名取最后一个点之后
                                "LICENSE", "notes.", "archive.tar.gz", "photo.png"
                        }) {
                            ObjectNode e = readables.addObject();
                            e.put("name", nm);
                            e.put("read", ScanGuard.readable(nm));
                        }

                        ArrayNode skippables = mapper.createArrayNode();
                        for (String nm : new String[]{"Big.java", "Dockerfile", "ip2region.xdb", "app.jar", "logo.png"}) {
                            ObjectNode e = skippables.addObject();
                            e.put("name", nm);
                            e.put("skippable", ScanGuard.skippableOversize(nm));
                        }

                        ArrayNode gitUrls = mapper.createArrayNode();
                        // 同时回吐 value：前端按 id 对判定、按 value 对输入本身。
                        // 只在 id 上会对不出一件事 —— 喂进去的字符串被悄悄改了（首尾空格、大小写），
                        // verdict 却照旧，那种绿是假的（2026-10-28 r14 实测过字符被吞成别的码位）。
                        gitUrls.addObject().put("id", "absent").put("value", "<null>")
                                .put("allowed", ScanGuard.gitUrlAllowed(null));
                        for (String[] pair : new String[][]{
                                {"https_ok", "https://github.com/foo/bar.git"},
                                {"https_padded", "  https://github.com/foo/bar.git  "},
                                {"https_upper", "HTTPS://GitHub.com/Foo/Bar.git"},
                                {"http_plain", "http://github.com/foo/bar.git"},
                                {"scp_style", "git@github.com:foo/bar.git"},
                                {"empty", ""}
                        }) {
                            gitUrls.addObject().put("id", pair[0]).put("value", pair[1])
                                    .put("allowed", ScanGuard.gitUrlAllowed(pair[1]));
                        }

                        Path pureRoot = Files.createTempDirectory("guard-pure");
                        Path pureSmall = pureRoot.resolve("small.txt");
                        try {
                            Files.writeString(pureSmall, "x", StandardCharsets.UTF_8);
                            Path pureGone = pureRoot.resolve("gone.bin");   // 故意不创建

                            ArrayNode sizes = mapper.createArrayNode();
                            sizes.addObject().put("id", "small_real").put("tooLarge", ScanGuard.fileTooLarge(pureSmall));
                            sizes.addObject().put("id", "nonexistent").put("tooLarge", ScanGuard.fileTooLarge(pureGone));

                            ArrayNode inside = mapper.createArrayNode();
                            inside.addObject().put("id", "file_in_root")
                                    .put("inside", ScanGuard.isInside(pureRoot, pureSmall));
                            inside.addObject().put("id", "parent_of_root")
                                    .put("inside", ScanGuard.isInside(pureRoot, pureRoot.getParent()));
                            inside.addObject().put("id", "missing_in_root")
                                    .put("inside", ScanGuard.isInside(pureRoot, pureGone));
                            inside.addObject().put("id", "missing_root")
                                    .put("inside", ScanGuard.isInside(pureGone, pureSmall));

                            // depth 只做 relativize，不碰磁盘 —— 22 层目录 + 1 个文件 = 23 段
                            ArrayNode depths = mapper.createArrayNode();
                            String[] depthId = {"self", "one", "three", "deep23"};
                            Path[] depthPath = {pureRoot, pureSmall, pureRoot.resolve("a/b/c.txt"),
                                    descend(pureRoot, 22)};
                            for (int k = 0; k < depthId.length; k += 1) {
                                depths.addObject()
                                        .put("id", depthId[k])
                                        .put("n", ScanGuard.depth(pureRoot, depthPath[k]));
                            }

                            receipt.put("ok", true);
                            receipt.set("zipEntry", entries);
                            receipt.set("redact", redacts);
                            receipt.set("readable", readables);
                            receipt.set("skippable", skippables);
                            receipt.set("gitUrl", gitUrls);
                            receipt.set("size", sizes);
                            receipt.set("inside", inside);
                            receipt.set("depth", depths);
                        } finally {
                            Files.deleteIfExists(pureSmall);
                            Files.deleteIfExists(pureRoot);
                        }
                    }
                    case "guard-timeout" -> {
                        // 超时闸门：不真等 180s，直接造一个已经过期的 ScanContext，
                        // 验 tick() 真的抛 SCAN_TIMEOUT（超时后 code 正确）
                        try {
                            ScanContext ctx = new ScanContext(Paths.get("."), List.of(), mapper, -1000L);
                            ctx.tick();
                            receipt.put("ok", false);
                            receipt.put("code", "NO_TIMEOUT_THROWN");
                            receipt.put("message", "超期后 tick() 没抛异常（闸门没拦住）");
                        } catch (ScanException e) {
                            receipt.put("ok", false);
                            receipt.put("code", e.code());
                            receipt.put("message", e.getMessage());
                        }
                    }
                    default -> {
                        receipt.put("ok", false);
                        receipt.put("code", "UNKNOWN_ACTION");
                        receipt.put("message", "不认识的动作：" + kind);
                    }
                }
            } catch (ScanException e) {
                receipt.put("ok", false);
                receipt.put("code", e.code());
                receipt.put("message", e.getMessage());
            } catch (Exception e) {
                receipt.put("ok", false);
                receipt.put("code", "PROBE_ERROR");
                receipt.put("message", String.valueOf(e));
            }
            receipt.put("elapsedMs", System.currentTimeMillis() - t0);
        }

        ObjectNode root = mapper.createObjectNode();
        root.put("probe", "scan");
        root.set("receipts", receipts);
        Files.createDirectories(out.getParent());
        Files.writeString(out, mapper.writerWithDefaultPrettyPrinter().writeValueAsString(root), StandardCharsets.UTF_8);
        for (var r : receipts) {
            System.out.println((r.path("ok").asBoolean() ? "  ok   " : "  FAIL ")
                    + r.path("action").asText() + "  " + r.path("code").asText("")
                    + "  " + r.path("elapsedMs").asInt() + "ms");
        }
    }
}
