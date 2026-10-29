import com.arsenal.scan.ProjectScanner;
import com.arsenal.scan.ScanException;
import com.arsenal.scan.ScanRulesLoader;
import com.arsenal.scan.ScanContext;
import com.arsenal.scan.ScanGuard;
import com.arsenal.scan.SourceResolver;
import com.arsenal.projects.ProjectCache;
import com.arsenal.projects.ProjectIds;
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
 *   qa-pure:          QaService 四个 private static 纯判定逐向量直问（r20）+ toList（r21）
 *   ast-pure:         AstEngine 五个 private static 工具逐向量直问（r21，反射 parse 拿真语法树）
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

    /**
     * 「拼路径的 id 先消毒」这条口径的三份实现，逐向量回吐各自的原始判定。
     *
     * <p>为什么需要这一层：ProjectCache.java:73 的注释写着三份「同一口径」，
     * 但全仓库对这三份函数 **0 条断言**（grep 过 .verify/*.java 与 arsenal-web/.verify/*.ts，
     * 敌意 projectId 从未喂进摄取/存储侧，只在 zip 条目名那条链上出现过）。
     * 注释说的话没人验过，就不能当事实用。
     *
     * <p>三份都是 private static，探针用反射按名字取（改名会让探针当场红，而不是静默少测）。
     * 抛异常的走「THROWS」而不是让整次探针挂掉：拒 vs 剥 本身就是要观测的区别。
     * 另外回吐 ProjectCache.cacheDir(原值) 落盘的**目录位置**（越界 / 塌到根 / 正常子目录），
     * 因为「消毒后仍在 root 里面」才是这条口径要守的不变量，函数返回值本身不是。
     *
     * <p>探针不判对错，期望表在前端。
     */
    private static void runIdSanitize(ObjectNode receipt, ObjectMapper mapper, String work) throws Exception {
        Path root = Paths.get(work).resolve("id-cache-root");
        deleteTree(root);
        Files.createDirectories(root);

        String len65 = "a".repeat(65);
        String[][] vectors = {
                {"traversal", "../../etc/passwd"},
                {"backslash", "..\\..\\Windows\\win.ini"},
                {"dotsOnly", ".."},
                {"encoded", "%2e%2e%2fetc"},
                {"empty", ""},
                // NUL 用 (char) 拼：Java 源码里写反斜杠-u 零会被词法前置展开（r14 的坑）
                {"nul", "a" + (char) 0 + "b"},
                {"len65", len65},
                {"valid", "demo-1_A"},
                // 三份函数都有 `s == null ? ...` 这一分支，黑盒从来传不出 null，只能显式喂
                {"null", "@@NULL@@"},
        };

        var cacheFn = ProjectCache.class.getDeclaredMethod("safeSegment", String.class);
        cacheFn.setAccessible(true);
        var storeFn = com.arsenal.projects.ProjectStore.class.getDeclaredMethod("safeId", String.class);
        storeFn.setAccessible(true);
        var qaFn = com.arsenal.qa.QaService.class.getDeclaredMethod("safeSegment", String.class);
        qaFn.setAccessible(true);

        ProjectCache cache = new ProjectCache(root, mapper);
        ArrayNode rows = mapper.createArrayNode();
        for (String[] v : vectors) {
            ObjectNode row = rows.addObject();
            row.put("id", v[0]);
            row.put("input", v[1]);
            String input = "@@NULL@@".equals(v[1]) ? null : v[1];
            row.put("cache", invokeSanitizer(cacheFn, input));
            row.put("store", invokeSanitizer(storeFn, input));
            row.put("qa", invokeSanitizer(qaFn, input));
            // 消毒之后目录到底落在哪：这是可观测的不变量（越界=红，塌到根=如实记账，正常=子目录）
            Path dir = cache.cacheDir(input);
            Path normRoot = root.toAbsolutePath().normalize();
            Path normDir = dir.toAbsolutePath().normalize();
            row.put("dirIsRoot", normDir.equals(normRoot));
            row.put("dirInsideRoot", normDir.startsWith(normRoot));
            row.put("dirRelativized", normRoot.equals(normDir) ? "." : normRoot.relativize(normDir).toString());
        }
        receipt.put("ok", true);
        receipt.set("sanitize", rows);
    }

    /** 反射调用消毒函数：正常返回消毒后的串；抛异常回吐 THROWS，让「拒 vs 剥」这一区别本身可断言。 */
    private static String invokeSanitizer(java.lang.reflect.Method fn, String input) {
        try {
            Object out = fn.invoke(null, input);
            return out == null ? "NULL" : String.valueOf(out);
        } catch (java.lang.reflect.InvocationTargetException e) {
            return "THROWS:" + e.getCause().getClass().getSimpleName();
        } catch (ReflectiveOperationException e) {
            return "PROBE_BROKEN:" + e.getMessage();
        }
    }

    /**
     * 跨语言 projectId 对拍用的事实回吐：Java 这份 `ProjectIds` 的 normalize 与 12 位 id，逐向量摊开。
     *
     * <p>为什么需要：`project-check.ts` 的 31-3 是拿正则匹配 `ProjectIds.java` 的**源码文本**
     * （`MessageDigest.getInstance("SHA-256")` / `formatHex(d).substring(0, 12)` 这些字样），
     * 而 Java 这份 `ProjectIds` 在五个探针里**一次都没被执行过** —— 对拍向量 31-1 跑的是 Node 那份。
     * 于是「同一地址在两套系统里算出同一个身份」（ProjectIds javadoc 自述的 棒1 暗伤）实际由长相守着：
     * 等价重构会让 31-3 因长相变红，真正的漂移反而无人报。这里把它换成行为断言的原料。
     *
     * <p>kind 传 null 用哨兵字符串表示（JSON 里存 null 会丢掉「到底是 null 还是缺字段」这一层）。
     * NBSP 用 (char) 0xA0 拼 —— Java 源码里写字面反斜杠-u 会被词法前置展开（r14 的坑）。
     */
    private static void runIdProject(ObjectNode receipt, ObjectMapper mapper) {
        String nbsp = String.valueOf((char) 0xA0);
        String[][] cases = {
                {"trailSlash1", "path", "D:/work/order-service/"},
                {"trailSlash3", "path", "D:/work/order-service///"},
                {"backslash", "path", "D:\\work\\order-service"},
                {"padSpaces", "path", "  D:/work/order-service  "},
                {"padNbsp", "path", nbsp + "D:/work/order-service" + nbsp},
                {"padTab", "path", "\tD:/work/order-service\n"},
                {"onlySlash", "path", "/"},
                {"emptyValue", "path", ""},
                {"nullValue", "path", "@@NULL@@"},
                {"nullKind", "@@NULL@@", "D:/work/order-service"},
                {"kindCase", "PATH", "D:/work/order-service"},
                {"unicode", "path", "D:/工作/订单服务"},
                {"gitUrl", "git", "https://example.com/a/b.git"},
                {"gitTrail", "git", "https://example.com/a/b.git/"},
                {"baseline", "path", "D:/work/order-service"},
        };
        ArrayNode rows = mapper.createArrayNode();
        for (String[] c : cases) {
            String kind = "@@NULL@@".equals(c[1]) ? null : c[1];
            String value = "@@NULL@@".equals(c[2]) ? null : c[2];
            ObjectNode row = rows.addObject();
            row.put("id", c[0]);
            row.put("kind", c[1]);
            row.put("value", c[2]);
            row.put("normalized", ProjectIds.normalize(kind, value));
            row.put("javaId", ProjectIds.projectIdOf(kind, value));
        }
        receipt.put("ok", true);
        receipt.set("projectIds", rows);
    }

    /**
     * 「待检扩展名」两份硬编码集合的契约回吐（r19，P1-1f）。
     *
     * <p>为什么需要：`QaService.java:69` 紧邻的注释明写着「与 AutopsyService 同一套待检扩展名
     * —— 两处不一致，pctOfRepo 的分母就是假的」，而两份 `EXTS` 在五个探针里**一次都没被执行过**，
     * 也没有任何断言比较过这两套。也就是说这句警告本身是 0 条断言守着的：从任一份里删掉
     * `"yaml"`，链照绿，而报告里的占比会静默掺水。
     *
     * <p>探针只回吐事实，不判对错：① 两份集合的元素（反射 private static field）；
     * ② 同一个混扩展名夹具下，`QaService#listCandidateFiles`（walk 级，pctOfRepo 的分母出处）
     * 到底收了哪些文件；③ `AutopsyService#readable`（文件名级判定）逐名怎么说；
     * ④ `ScanGuard.readable` 逐名怎么说 —— 期望表在前端。
     *
     * <p>`QaService` 有 11 个 bean 依赖，正常构造不出来；但 `listCandidateFiles` 只用静态量
     * （EXTS / MAX_FILE_INDEX / ScanGuard），不碰任何实例字段，因此用全 null 的实例直接调它，
     * 拿到的是**产品代码那条真路径**。dataDir 只被 `Path.of` 消费，给一个不存在的路径即可。
     */
    private static void runExtsContract(ObjectNode receipt, ObjectMapper mapper, String work) throws Exception {
        Path root = Paths.get(work).resolve("exts-fixture");
        deleteTree(root);
        String[] rels = {
                "src/App.java",                 // 两份都在、可读 → 进分母
                "src/App.Test.java",            // 多点名，扩展名仍取最后一段
                "src/UPPER.JAVA",               // 大写扩展名： pins 住 toLowerCase 那一支
                "config/app.yml",
                "config/docker-compose.yaml",
                "config/db.properties",
                "docs/arch.xml",
                "docs/README.md",               // 可读但不在待检集 → 不进分母
                "docs/nginx.conf",              // 同上（TEXT_EXT 有 conf，EXTS 没有）
                "data/rows.json",               // 同上
                "assets/logo.png",              // 不可读也不在待检集
                "Makefile",                     // ScanGuard 认特殊名、扩展名取不到 → 两份都不收
                "Dockerfile",                   // 同上
                "target/Generated.java",        // 在待检集但在 skipDir 下 → walk 级不收、文件名级收
                ".git/config.yml",              // 同上
        };
        for (String rel : rels) {
            Path p = root.resolve(rel);
            Files.createDirectories(p.getParent());
            Files.writeString(p, "x\n", StandardCharsets.UTF_8);
        }
        int filesWalked;
        try (var w = Files.walk(root)) {
            filesWalked = (int) w.filter(Files::isRegularFile).count();
        }

        var qaCtor = com.arsenal.qa.QaService.class.getDeclaredConstructors()[0];
        qaCtor.setAccessible(true);
        Object qa = qaCtor.newInstance(null, null, mapper, null, null, null, null, null, null, null, null,
                root.resolve("qa-base").toString(), 2, "");
        var listFn = com.arsenal.qa.QaService.class.getDeclaredMethod("listCandidateFiles", Path.class);
        listFn.setAccessible(true);
        List<String> index = (List<String>) listFn.invoke(qa, root);

        var autReadable = com.arsenal.autopsy.AutopsyService.class.getDeclaredMethod("readable", String.class);
        autReadable.setAccessible(true);

        ObjectNode out = mapper.createObjectNode();
        // putArray 每次都会**新建并替换**同名字段，放在循环里等于只留最后一个元素 ——
        // 先建数组、再逐条 add（r19 踩过：集合只剩 ["yml"]，「两份相同」那条差点空过）
        ArrayNode qaExtNode = out.putArray("qaExt");
        for (String e : staticExtSet(com.arsenal.qa.QaService.class)) {
            qaExtNode.add(e);
        }
        ArrayNode autopsyExtNode = out.putArray("autopsyExt");
        for (String e : staticExtSet(com.arsenal.autopsy.AutopsyService.class)) {
            autopsyExtNode.add(e);
        }
        out.put("filesWalked", filesWalked);
        out.put("indexSize", index.size());
        ArrayNode rows = out.putArray("rows");
        for (String rel : rels) {
            String name = rel.substring(rel.lastIndexOf('/') + 1);
            ObjectNode row = rows.addObject();
            row.put("rel", rel);
            row.put("name", name);
            row.put("inIndex", index.contains(rel));
            row.put("autopsyReadable", Boolean.TRUE.equals(autReadable.invoke(null, name)));
            row.put("scanGuardReadable", ScanGuard.readable(name));
            row.put("underSkippedDir", isUnderSkippedDir(rel));
        }
        receipt.put("ok", true);
        receipt.set("exts", out);
    }

    /** rel 的**目录段**里有没有 skipDir 命中的目录名（文件名段自己不算目录）。 */
    private static boolean isUnderSkippedDir(String rel) {
        String dirPart = rel.substring(0, rel.lastIndexOf('/') + 1);
        for (String seg : dirPart.split("/")) {
            if (!seg.isEmpty() && ScanGuard.skipDir(seg)) {
                return true;
            }
        }
        return false;
    }

    /** 反射取 private static final Set<String> EXTS，按字典序回吐（顺序本身不是事实，元素才是）。 */
    private static java.util.List<String> staticExtSet(Class<?> cls) throws Exception {
        var f = cls.getDeclaredField("EXTS");
        f.setAccessible(true);
        java.util.Set<String> raw = (java.util.Set<String>) f.get(null);
        java.util.List<String> sorted = new ArrayList<>(raw);
        java.util.Collections.sort(sorted);
        return sorted;
    }

    /**
     * `QaService` 四个 private static 纯判定的逐分支回吐（r20，P1-1g）。
     *
     * <p>为什么需要：`testBaseName`（测试名识别，喂 testedBases 与「全仓找不到测试文件」那条建议）、
     * `statusReason`（语义层措辞的唯一出处）、`firstNonBlank` / `trimLines`（推荐卡片 rationale 与 after 的
     * 截断口径）在 `.verify/*.java` 与 `arsenal-web/.verify/*.ts` 里**一次都没出现过** —— 四个函数 0 条断言。
     *
     * <p>探针只回吐原始返回值，不判对错：null 回成字面量 NULL（「返回 null / 返回空串 / 返回有值」
     * 是三件不同的事，必须可断言）；换行在 JSON 里是转义字符，前端按字符串逐字节比。
     * `statusReason` 的 `SemanticJudge.Outcome` 是 public record，直接构造四个空容器 + 一个布尔就行
     * —— 该函数只读 `budgetCut()`，其余字段不参与判定。
     */
    private static void runQaPure(ObjectNode receipt, ObjectMapper mapper) throws Exception {
        Class<?> qa = com.arsenal.qa.QaService.class;
        var baseFn = qa.getDeclaredMethod("testBaseName", String.class);
        baseFn.setAccessible(true);
        var reasonFn = qa.getDeclaredMethod("statusReason", String.class, com.arsenal.qa.SemanticJudge.Outcome.class);
        reasonFn.setAccessible(true);
        var blankFn = qa.getDeclaredMethod("firstNonBlank", String.class, String.class);
        blankFn.setAccessible(true);
        var trimFn = qa.getDeclaredMethod("trimLines", String.class, int.class);
        trimFn.setAccessible(true);

        ObjectNode out = mapper.createObjectNode();

        ArrayNode baseRows = out.putArray("testBase");
        String[][] bases = {
                {"plainTest", "src/FooTest.java"},
                {"testsSuffix", "src/FooTests.java"},
                {"itSuffix", "src/order-service/src/OrderServiceIT.java"},
                {"prefixTest", "src/TestFooBar.java"},
                // 裸 Test.java / IT.java：endsWith 先命中，整名被剥光 → 空基名（不是 null）
                {"bareTest", "src/Test.java"},
                {"bareIT", "IT.java"},
                {"notJava", "src/FooTest.kt"},
                {"normalSource", "src/Foo.java"},
                {"lookalikeLower", "src/Footest.java"},
                {"protestCase", "src/Protest.java"},
                {"testsPrefixed", "src/TestsFoo.java"},
                {"doubleJava", "src/Foo.java.java"},
                {"lowercaseJava", "src/foo.java"},
                {"noDir", "BarTest.java"},
                {"nul", "@@NULL@@"},
        };
        for (String[] v : bases) {
            String input = "@@NULL@@".equals(v[1]) ? null : v[1];
            ObjectNode row = baseRows.addObject();
            row.put("id", v[0]);
            row.put("input", v[1]);
            row.put("out", echoOrNull(baseFn, input));
        }

        ArrayNode reasonRows = out.putArray("statusReason");
        String[][] reasons = {
                {"failed-noCut", "failed", "false"},
                {"failed-withCut", "failed", "true"},
                {"partial-noCut", "partial", "false"},
                {"partial-withCut", "partial", "true"},
                {"ok-noCut", "ok", "false"},
                // status=ok 却 budgetCut=true：调用点在 :598 就把这种组合算成 partial 了，
                // 但函数自己的分支顺序是「先看 budgetCut、再看 status」—— 这里把顺序本身摊开
                {"ok-withCut", "ok", "true"},
                {"notRun", "not-run", "false"},
                {"emptyStatus", "", "false"},
        };
        for (String[] v : reasons) {
            com.arsenal.qa.SemanticJudge.Outcome o = new com.arsenal.qa.SemanticJudge.Outcome(
                    mapper.createArrayNode(), mapper.createArrayNode(), mapper.createObjectNode(),
                    new ArrayList<String>(), Boolean.parseBoolean(v[2]));
            ObjectNode row = reasonRows.addObject();
            row.put("id", v[0]);
            row.put("status", v[1]);
            row.put("budgetCut", Boolean.parseBoolean(v[2]));
            row.put("out", String.valueOf(reasonFn.invoke(null, v[1], o)));
        }

        ArrayNode blankRows = out.putArray("firstNonBlank");
        String[][] blanks = {
                {"aWins", "x", "y"},
                {"emptyA", "", "y"},
                {"spaceA", "   ", "y"},
                {"nullA", "@@NULL@@", "y"},
                {"bothNull", "@@NULL@@", "@@NULL@@"},
                {"bNull", "a", "@@NULL@@"},
                {"bothBlank", "", "  "},
                {"tabA", "\t", "y"},
        };
        for (String[] v : blanks) {
            String a = "@@NULL@@".equals(v[1]) ? null : v[1];
            String b = "@@NULL@@".equals(v[2]) ? null : v[2];
            ObjectNode row = blankRows.addObject();
            row.put("id", v[0]);
            row.put("a", v[1]);
            row.put("b", v[2]);
            row.put("out", echoOrNull(blankFn, a, b));
        }

        ArrayNode trimRows = out.putArray("trimLines");
        String l3 = "l1\nl2\nl3";
        String l4 = "l1\nl2\nl3\nl4";
        String l30 = String.join("\n", java.util.Collections.nCopies(30, "x"));
        String[][] trims = {
                {"underCap", l3, "24"},
                {"overCap3", l3, "2"},
                {"overCap4", l4, "2"},
                {"capOne", l4, "1"},
                {"empty", "", "24"},
                {"trailingNewline", "l1\nl2\n", "5"},
                {"blankLineInside", "l1\n\nl2", "2"},
                {"corpusMaxPlus1", l30, "24"},
        };
        for (String[] v : trims) {
            int max = Integer.parseInt(v[2]);
            String trimmed = String.valueOf(trimFn.invoke(null, v[1], max));
            ObjectNode row = trimRows.addObject();
            row.put("id", v[0]);
            row.put("input", v[1]);
            row.put("max", max);
            row.put("out", trimmed);
            row.put("unchanged", trimmed.equals(v[1]));
            row.put("inputLines", v[1].isEmpty() ? 0 : v[1].split("\n", -1).length);
            row.put("outLines", trimmed.isEmpty() ? 0 : trimmed.split("\n", -1).length);
        }

        // ── toList（r21 P1-1h）：产品侧只喂 findings.path("p0") 这类结果 ——
        // MissingNode（字段缺席）与 NullNode（字段存在但为 JSON null）都可达，Java null 是防御分支
        var toListFn = qa.getDeclaredMethod("toList", tools.jackson.databind.JsonNode.class);
        toListFn.setAccessible(true);
        ArrayNode listRows = out.putArray("toList");
        Object[][] lists = {
                {"twoItems", mapper.createArrayNode().add("a").add("b")},
                {"emptyArray", mapper.createArrayNode()},
                {"nullNode", mapper.nullNode()},
                {"textField", mapper.createObjectNode().put("k", "v").get("k")},
                {"absentField", mapper.createObjectNode().path("nope")},
        };
        for (Object[] v : lists) {
            tools.jackson.databind.JsonNode arg = (tools.jackson.databind.JsonNode) v[1];
            ObjectNode row = listRows.addObject();
            row.put("id", String.valueOf(v[0]));
            try {
                @SuppressWarnings("unchecked")
                List<tools.jackson.databind.JsonNode> got =
                        (List<tools.jackson.databind.JsonNode>) toListFn.invoke(null, arg);
                row.put("size", got.size());
                row.put("first", got.isEmpty() ? "" : String.valueOf(got.get(0)));
                row.put("isArray", arg.isArray());
            } catch (java.lang.reflect.InvocationTargetException e) {
                row.put("size", -1);
                row.put("out", "THROWS:" + e.getCause().getClass().getSimpleName());
                row.put("isArray", arg == null ? false : arg.isArray());
            }
        }
        {
            ObjectNode row = listRows.addObject();
            row.put("id", "javaNull");
            try {
                toListFn.invoke(null, new Object[]{null});
                row.put("size", -2);
                row.put("out", "NO-THROW");
            } catch (java.lang.reflect.InvocationTargetException e) {
                row.put("size", -1);
                row.put("out", "THROWS:" + e.getCause().getClass().getSimpleName());
            }
        }

        receipt.put("ok", true);
        receipt.set("qaPure", out);
    }

    /**
     * 合成一条 Diagnostic 喂 DiagnosticCollector.report —— readErrors 的归一分支（≤0 归 0、
     * null 归空串、只认 ERROR）不必真编译就能问。position 系列与换算无关，随手钳 0。
     */
    private static javax.tools.Diagnostic<javax.tools.JavaFileObject> fakeDiag(
            javax.tools.Diagnostic.Kind kind, final String code, final String message,
            final long line, final long col) {
        return new javax.tools.Diagnostic<>() {
            @Override public javax.tools.Diagnostic.Kind getKind() { return kind; }
            @Override public javax.tools.JavaFileObject getSource() { return null; }
            @Override public String getCode() { return code; }
            @Override public long getPosition() { return Math.max(0, col - 1); }
            @Override public long getStartPosition() { return getPosition(); }
            @Override public long getEndPosition() { return getPosition(); }
            @Override public long getLineNumber() { return line; }
            @Override public long getColumnNumber() { return col; }
            @Override public String getMessage(java.util.Locale locale) { return message; }
        };
    }

    /** 反射调用单参纯函数：返回 null 时回吐字面量 NULL（空串与 null 是两种结果，必须能分开断言）。 */
    private static String echoOrNull(java.lang.reflect.Method fn, String... args) {
        try {
            Object o = fn.invoke(null, (Object[]) args);
            return o == null ? "NULL" : String.valueOf(o);
        } catch (java.lang.reflect.InvocationTargetException e) {
            return "THROWS:" + e.getCause().getClass().getSimpleName();
        } catch (ReflectiveOperationException e) {
            return "PROBE_BROKEN:" + e.getMessage();
        }
    }

    /**
     * r21 P1-1h：AstEngine 五个 private static 小工具的分支级直问。
     *
     * 这五个名字（annName / hasAnnotation / hasMember / typeSimpleName / isPrimitive）在
     * .verify 里此前 0 直接引用 —— AstProbe 端到端真跑 AstEngine，但断言只对检查器产出的
     * Finding，工具函数的分支没人单独数过。这里反射 parse（真 javac parse-only，未解析符号
     * 照样产树）拿真语法树，从 ClassTree/VariableTree 里取真 AnnotationTree / ModifiersTree /
     * TypeTree 喂给五个函数，逐向量回吐原始判定 —— 对错判定全在前端期望表。
     */
    private static void runAstPure(ObjectNode receipt, ObjectMapper mapper) throws Exception {
        Class<?> ast = com.arsenal.engine.AstEngine.class;
        var parseFn = ast.getDeclaredMethod("parse", String.class, String.class);
        parseFn.setAccessible(true);
        var annNameFn = ast.getDeclaredMethod("annName", com.sun.source.tree.AnnotationTree.class);
        annNameFn.setAccessible(true);
        // hasAnnotation(ModifiersTree, String...) 的编译签名是 (ModifiersTree, String[]) —— varargs
        var hasAnnFn = ast.getDeclaredMethod("hasAnnotation",
                com.sun.source.tree.ModifiersTree.class, String[].class);
        hasAnnFn.setAccessible(true);
        var hasMemberFn = ast.getDeclaredMethod("hasMember",
                com.sun.source.tree.AnnotationTree.class, String.class);
        hasMemberFn.setAccessible(true);
        var typeSimpleFn = ast.getDeclaredMethod("typeSimpleName", com.sun.source.tree.Tree.class);
        typeSimpleFn.setAccessible(true);
        var isPrimitiveFn = ast.getDeclaredMethod("isPrimitive", String.class);
        isPrimitiveFn.setAccessible(true);

        String annSnippet = """
                package p;
                @Service
                class AnnService { }
                @java.lang.Deprecated
                class AnnQualified { }
                @SuppressWarnings(value = "x")
                class AnnWithMember { }
                @SuppressWarnings("x")
                class AnnShorthand { }
                @override
                class AnnLowercase { }
                class AnnPlain { }
                """;
        String typeSnippet = """
                package p;
                class Types {
                    String s;
                    java.util.List raw;
                    java.util.List<String> ls;
                    Map.Entry e;
                    int[] arr;
                    int n;
                }
                """;

        ObjectNode out = mapper.createObjectNode();

        var parsedAnn = (com.arsenal.engine.AstEngine.ParseResult)
                parseFn.invoke(null, "Ann.java", annSnippet);
        var parsedType = (com.arsenal.engine.AstEngine.ParseResult)
                parseFn.invoke(null, "Types.java", typeSnippet);
        out.put("annParseStatus", String.valueOf(parsedAnn.status()));
        out.put("typeParseStatus", String.valueOf(parsedType.status()));

        // ── 类级向量：annName 三分支 / hasAnnotation 四分支 / hasMember 的「简写不算成员」 ──
        ArrayNode classRows = out.putArray("classes");
        for (com.sun.source.tree.Tree decl : parsedAnn.unit().getTypeDecls()) {
            if (!(decl instanceof com.sun.source.tree.ClassTree ct)) {
                continue;
            }
            com.sun.source.tree.ModifiersTree mods = ct.getModifiers();
            List<? extends com.sun.source.tree.AnnotationTree> anns = mods.getAnnotations();
            ObjectNode row = classRows.addObject();
            row.put("className", ct.getSimpleName().toString());
            row.put("annCount", anns.size());
            ArrayNode annRows = row.putArray("anns");
            String first = null;
            for (com.sun.source.tree.AnnotationTree a : anns) {
                ObjectNode ar = annRows.addObject();
                ar.put("decl", a.toString());
                String name = String.valueOf(annNameFn.invoke(null, a));
                ar.put("annName", name);
                if (first == null) {
                    first = name;
                }
                ar.put("memberValue", Boolean.valueOf(
                        String.valueOf(hasMemberFn.invoke(null, a, "value"))));
                ar.put("memberOther", Boolean.valueOf(
                        String.valueOf(hasMemberFn.invoke(null, a, "other"))));
            }
            if (first != null) {
                // 第一名命中（varargs 第一位）/ 第二名命中（varargs 第二位才轮到它）/ 未命中 / 小写问（大小写敏感）
                row.put("hasAnn_exact", Boolean.valueOf(String.valueOf(
                        hasAnnFn.invoke(null, mods, (Object) new String[]{first}))));
                row.put("hasAnn_second", Boolean.valueOf(String.valueOf(
                        hasAnnFn.invoke(null, mods, (Object) new String[]{"NoSuchAnn", first}))));
                row.put("hasAnn_miss", Boolean.valueOf(String.valueOf(
                        hasAnnFn.invoke(null, mods, (Object) new String[]{"NoSuchAnn"}))));
                row.put("hasAnn_lowerAsk", String.valueOf(first.toLowerCase(java.util.Locale.ROOT)));
                row.put("hasAnn_lower", Boolean.valueOf(String.valueOf(
                        hasAnnFn.invoke(null, mods, (Object) new String[]{first.toLowerCase(java.util.Locale.ROOT)}))));
            } else {
                // 无注解的类：三种问法都必须是 false（恒真类断言没有意义，这里是反方向基线）
                row.put("hasAnn_exact", Boolean.valueOf(String.valueOf(
                        hasAnnFn.invoke(null, mods, (Object) new String[]{"Service"}))));
                row.put("hasAnn_second", Boolean.valueOf(String.valueOf(
                        hasAnnFn.invoke(null, mods, (Object) new String[]{"NoSuchAnn", "Service"}))));
                row.put("hasAnn_miss", Boolean.valueOf(String.valueOf(
                        hasAnnFn.invoke(null, mods, (Object) new String[]{"NoSuchAnn"}))));
            }
        }

        // ── 类型向量：typeSimpleName 的 Identifier / MemberSelect / ParameterizedType / 兜底 toString ──
        ArrayNode typeRows = out.putArray("types");
        for (com.sun.source.tree.Tree decl : parsedType.unit().getTypeDecls()) {
            if (!(decl instanceof com.sun.source.tree.ClassTree ct)) {
                continue;
            }
            for (com.sun.source.tree.Tree member : ct.getMembers()) {
                if (!(member instanceof com.sun.source.tree.VariableTree vt)) {
                    continue;
                }
                ObjectNode row = typeRows.addObject();
                row.put("field", vt.getName().toString());
                row.put("decl", vt.getType().toString());
                row.put("simple", String.valueOf(typeSimpleFn.invoke(null, vt.getType())));
            }
        }

        // ── isPrimitive：九个闭集的直接问答（含大小写与 null → NPE） ──
        ArrayNode primRows = out.putArray("isPrimitive");
        String[][] prims = {
                {"intIs", "int"},
                {"voidIs", "void"},
                {"stringNo", "String"},
                {"capitalNo", "Int"},
                {"emptyNo", ""},
        };
        for (String[] v : prims) {
            ObjectNode row = primRows.addObject();
            row.put("id", v[0]);
            row.put("in", v[1]);
            row.put("out", echoOrNull(isPrimitiveFn, v[1]));
        }
        {
            ObjectNode row = primRows.addObject();
            row.put("id", "javaNull");
            row.put("in", "@@NULL@@");
            try {
                isPrimitiveFn.invoke(null, new Object[]{null});
                row.put("out", "NO-THROW");
            } catch (java.lang.reflect.InvocationTargetException e) {
                row.put("out", "THROWS:" + e.getCause().getClass().getSimpleName());
            }
        }

        // ── 防御分支：null ModifiersTree / null AnnotationTree / null Tree ──
        ObjectNode extras = out.putObject("extras");
        try {
            Object r = hasAnnFn.invoke(null, new Object[]{null, new String[]{"Service"}});
            extras.put("hasAnn_nullMods", String.valueOf(r));
        } catch (java.lang.reflect.InvocationTargetException e) {
            extras.put("hasAnn_nullMods", "THROWS:" + e.getCause().getClass().getSimpleName());
        }
        try {
            Object r = annNameFn.invoke(null, new Object[]{null});
            extras.put("annName_null", String.valueOf(r));
        } catch (java.lang.reflect.InvocationTargetException e) {
            extras.put("annName_null", "THROWS:" + e.getCause().getClass().getSimpleName());
        }
        try {
            Object r = typeSimpleFn.invoke(null, new Object[]{null});
            extras.put("typeSimple_null", String.valueOf(r));
        } catch (java.lang.reflect.InvocationTargetException e) {
            extras.put("typeSimple_null", "THROWS:" + e.getCause().getClass().getSimpleName());
        }

        // ── readErrors（r22 P1-1i）：javac 诊断 → ParseError 的四个归一分支 + 只认 ERROR ──
        // AstProbe 只断言过「编译错 fixture → not-executed」，换算本身（line/col ≤0 归 0、
        // code/message null 归空串、WARNING/NOTE 不进 errors）没人单独问过。
        // DiagnosticCollector.addDiagnostic 可以直接喂合成诊断，不必真编译。
        var readErrFn = ast.getDeclaredMethod("readErrors",
                javax.tools.DiagnosticCollector.class);
        readErrFn.setAccessible(true);
        ArrayNode errRows = out.putArray("readErrors");
        Object[][] diagCases = {
                {"errNormal", javax.tools.Diagnostic.Kind.ERROR, "compiler.err.expected", "'; expected", 3L, 7L},
                {"errZeroPos", javax.tools.Diagnostic.Kind.ERROR, "c.zero", "m", 0L, 0L},
                {"errNegPos", javax.tools.Diagnostic.Kind.ERROR, "c.neg", "m", -5L, -2L},
                {"errNullCode", javax.tools.Diagnostic.Kind.ERROR, null, "m", 1L, 1L},
                {"errNullMessage", javax.tools.Diagnostic.Kind.ERROR, "c.code", null, 1L, 1L},
        };
        for (Object[] v : diagCases) {
            javax.tools.DiagnosticCollector<javax.tools.JavaFileObject> dc = new javax.tools.DiagnosticCollector<>();
            dc.report(fakeDiag((javax.tools.Diagnostic.Kind) v[1], (String) v[2], (String) v[3],
                    (Long) v[4], (Long) v[5]));
            ObjectNode row = errRows.addObject();
            row.put("id", String.valueOf(v[0]));
            List<com.arsenal.engine.AstEngine.ParseError> errs =
                    (List<com.arsenal.engine.AstEngine.ParseError>) readErrFn.invoke(null, dc);
            row.put("n", errs.size());
            if (!errs.isEmpty()) {
                var e0 = errs.get(0);
                row.put("line", e0.line());
                row.put("column", e0.column());
                row.put("code", String.valueOf(e0.code()));
                row.put("message", String.valueOf(e0.message()));
            }
        }
        {
            // 只认 ERROR：WARNING 与 NOTE 加进去也不进 errors；混一批时只留 ERROR、顺序保持
            javax.tools.DiagnosticCollector<javax.tools.JavaFileObject> dc = new javax.tools.DiagnosticCollector<>();
            dc.report(fakeDiag(javax.tools.Diagnostic.Kind.WARNING, "w.code", "w", 2L, 2L));
            dc.report(fakeDiag(javax.tools.Diagnostic.Kind.ERROR, "e1", "first", 3L, 1L));
            dc.report(fakeDiag(javax.tools.Diagnostic.Kind.NOTE, "n.code", "n", 4L, 1L));
            dc.report(fakeDiag(javax.tools.Diagnostic.Kind.ERROR, "e2", "second", 5L, 1L));
            ObjectNode row = errRows.addObject();
            row.put("id", "warnNoteNotErrors");
            List<com.arsenal.engine.AstEngine.ParseError> errs =
                    (List<com.arsenal.engine.AstEngine.ParseError>) readErrFn.invoke(null, dc);
            row.put("n", errs.size());
            ArrayNode codes = row.putArray("codes");
            for (var e : errs) {
                codes.add(String.valueOf(e.code()));
            }
        }

        // ── SourceText（r22 P1-1i）：lineOf / snippetAt 坐标口径 + 与 LintEngine.lineOf 对拍 ──
        // 两份 lineOf 是同一个二分（SourceText 版多一个 pos<0 早退）—— 同一批向量逐条对拍，
        // 分歧本身就是发现。LintEngine 构造只存字段，null 依赖可安全 new。
        Class<?> stCls = Class.forName("com.arsenal.engine.AstEngine$SourceText");
        var stCtor = stCls.getDeclaredConstructor(String.class);
        stCtor.setAccessible(true);
        var stLineOf = stCls.getDeclaredMethod("lineOf", long.class);
        stLineOf.setAccessible(true);
        var stSnippet = stCls.getDeclaredMethod("snippetAt", long.class, int.class);
        stSnippet.setAccessible(true);
        Class<?> leCls = com.arsenal.engine.LintEngine.class;
        var leLineOf = leCls.getDeclaredMethod("lineOf", int[].class, int.class);
        leLineOf.setAccessible(true);
        var leColumnOf = leCls.getDeclaredMethod("columnOf", int[].class, int.class);
        leColumnOf.setAccessible(true);
        Object le = leCls.getConstructor(com.arsenal.loader.RuleIndex.class, com.arsenal.engine.AstEngine.class,
                int.class, long.class).newInstance(null, null, 5, 100L);

        String sample = "aa\nbbbb\n\ncc";
        Object st = stCtor.newInstance(sample);   // 换行表 = [2, 7, 8]
        int[] newlines = {2, 7, 8};
        ObjectNode stOut = out.putObject("sourceText");
        stOut.put("text", sample);
        ArrayNode loRows = stOut.putArray("lineOf");
        Object[][] loCases = {
                {"neg", -1L}, {"start", 0L}, {"onNewline", 2L}, {"secondLine", 3L},
                {"lastChar", (long) sample.length() - 1}, {"beyond", (long) sample.length() + 50},
        };
        for (Object[] v : loCases) {
            ObjectNode row = loRows.addObject();
            row.put("id", String.valueOf(v[0]));
            long p = (Long) v[1];
            row.put("pos", p);
            Object a = stLineOf.invoke(st, p);
            Object b = leLineOf.invoke(le, newlines, (int) p);
            row.put("st", String.valueOf(a));
            row.put("le", String.valueOf(b));
            row.put("same", a.equals(b));
        }
        ArrayNode colRows = stOut.putArray("columnOf");
        Object[][] colCases = {
                {"firstChar", 0L}, {"onNewline", 2L}, {"neg", -1L}, {"secondLineFirst", 3L},
        };
        for (Object[] v : colCases) {
            ObjectNode row = colRows.addObject();
            row.put("id", String.valueOf(v[0]));
            long p = (Long) v[1];
            row.put("pos", p);
            row.put("out", String.valueOf(leColumnOf.invoke(le, newlines, (int) p)));
        }
        ArrayNode snRows = stOut.putArray("snippetAt");
        Object[][] snCases = {
                {"midLine", 0L, 140}, {"onNewline", 2L, 140}, {"emptyLine", 8L, 140},
                {"lastLine", 9L, 140}, {"beforeStart", -3L, 140},
        };
        for (Object[] v : snCases) {
            ObjectNode row = snRows.addObject();
            row.put("id", String.valueOf(v[0]));
            row.put("pos", String.valueOf(v[1]));
            row.put("out", String.valueOf(stSnippet.invoke(st, (Long) v[1], (Integer) v[2])));
        }
        {
            // 截断边界：141 字符的单行喂 max=140 → 截成 140 + 「…」；恰好 140 → 原样不加尾巴
            StringBuilder longLine = new StringBuilder();
            for (int i = 0; i < 141; i++) {
                longLine.append('x');
            }
            Object stLong = stCtor.newInstance(longLine.toString());
            ObjectNode row = snRows.addObject();
            row.put("id", "overMax141");
            row.put("pos", 0);
            String s140 = String.valueOf(stSnippet.invoke(stLong, 0L, 140));
            row.put("out", s140);
            row.put("len", s140.length());
            row.put("ellipsized", s140.endsWith("…"));
            ObjectNode row2 = snRows.addObject();
            row2.put("id", "exactMax140");
            row2.put("pos", 0);
            Object stExact = stCtor.newInstance(longLine.substring(0, 140));
            String sExact = String.valueOf(stSnippet.invoke(stExact, 0L, 140));
            row2.put("out", sExact);
            row2.put("len", sExact.length());
            row2.put("ellipsized", sExact.endsWith("…"));
        }

        receipt.put("ok", true);
        receipt.set("astPure", out);
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
                    case "id-sanitize" -> runIdSanitize(receipt, mapper, value);
                    case "id-project" -> runIdProject(receipt, mapper);
                    case "exts-contract" -> runExtsContract(receipt, mapper, value);
                    case "qa-pure" -> runQaPure(receipt, mapper);
                    case "ast-pure" -> runAstPure(receipt, mapper);
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
