import com.arsenal.scan.ProjectScanner;
import com.arsenal.scan.ScanException;
import com.arsenal.scan.ScanRulesLoader;
import com.arsenal.scan.SourceResolver;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

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
