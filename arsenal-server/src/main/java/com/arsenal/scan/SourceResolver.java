package com.arsenal.scan;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.nio.file.StandardOpenOption;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 三种输入源 → 一个本地目录。扫描器只认「一个目录」，这是它不需要知道输入从哪来的原因。
 *
 * 安全约束（与 {@link ScanGuard} 配套，这里负责执行）：
 *   <ul>
 *     <li>zip：条目名逐条过 {@link ScanGuard#zipEntrySafe}，落盘后再校验真实路径在根目录内；
 *         规模在解压过程中累加，超了立刻停 —— 不等到解完再判（zip 炸弹的原理就是等你解完）。</li>
 *     <li>git：只许 https，{@code --depth 1 --single-branch --no-tags}，
 *         {@code core.hooksPath=/dev/null} 禁掉一切 hook，{@code GIT_TERMINAL_PROMPT=0}
 *         防止它停下来要密码把线程挂死。</li>
 *     <li>临时目录统一在 finally 清理（{@link #close}），且**永远不在被扫描的仓库里**。</li>
 *   </ul>
 */
public final class SourceResolver implements AutoCloseable {

    private static final Logger log = LoggerFactory.getLogger(SourceResolver.class);

    private final Path root;
    /** 需要清理的临时目录。本地目录输入时为 null —— 用户的目录我们不碰 */
    private final Path temp;
    private final String kind;

    private SourceResolver(Path root, Path temp, String kind) {
        this.root = root;
        this.temp = temp;
        this.kind = kind;
    }

    public Path root() {
        return root;
    }

    public String kind() {
        return kind;
    }

    /** 目录名。事实里只留这个 —— 绝对路径既泄隐私又不可复现 */
    public String rootName() {
        return root.getFileName() == null ? root.toString() : root.getFileName().toString();
    }

    // ─────────────────────────────────────────────────────────────
    // 输入一：本地目录
    // ─────────────────────────────────────────────────────────────

    public static SourceResolver fromPath(String raw) {
        if (raw == null || raw.isBlank()) {
            throw ScanException.badRequest("本地路径为空");
        }
        Path p;
        try {
            p = Path.of(raw.trim());
        } catch (Exception e) {
            throw ScanException.badRequest("本地路径不合法：" + raw);
        }
        if (!Files.exists(p)) {
            throw ScanException.badRequest("路径不存在：" + p);
        }
        if (!Files.isDirectory(p)) {
            throw ScanException.badRequest("不是目录：" + p);
        }
        Path real;
        try {
            real = p.toRealPath();
        } catch (IOException e) {
            throw ScanException.badRequest("路径无法解析（可能是断链或权限不足）：" + p);
        }
        return new SourceResolver(real, null, "path");
    }

    // ─────────────────────────────────────────────────────────────
    // 输入二：zip
    // ─────────────────────────────────────────────────────────────

    public static SourceResolver fromZip(InputStream in) {
        Path dir = createTempDir("arsenal-scan-zip-");
        long[] total = {0};
        int[] count = {0};
        List<String> rejected = new ArrayList<>();
        try (ZipInputStream zis = new ZipInputStream(in)) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                String name = entry.getName();
                if (!ScanGuard.zipEntrySafe(name)) {
                    rejected.add(name);
                    continue;
                }
                if (entry.isDirectory()) {
                    Files.createDirectories(dir.resolve(name).normalize());
                    continue;
                }
                count[0] += 1;
                if (count[0] > ScanGuard.MAX_FILES) {
                    throw ScanException.tooLarge("zip 内文件数超过上限 " + ScanGuard.MAX_FILES);
                }
                Path out = dir.resolve(name).normalize();
                if (!out.startsWith(dir)) {
                    rejected.add(name);
                    continue;
                }
                Files.createDirectories(out.getParent());
                long written = copyCapped(zis, out);
                total[0] += written;
                if (total[0] > ScanGuard.MAX_TOTAL_BYTES) {
                    throw ScanException.tooLarge("zip 解压后总大小超过上限 " + ScanGuard.MAX_TOTAL_BYTES / 1024 / 1024 + "MB");
                }
            }
        } catch (ScanException e) {
            deleteQuietly(dir);
            throw e;
        } catch (IOException e) {
            deleteQuietly(dir);
            throw ScanException.badRequest("zip 无法解析：" + e.getMessage());
        }
        if (!rejected.isEmpty()) {
            // 整体拒绝而不是「跳过那几条」：正常的 zip 里不会有 ../ 或绝对路径，
            // 出现就说明这个包是冲着路径遍历来的，剩下的内容也不值得信任。
            String sample = String.join("、", rejected.subList(0, Math.min(3, rejected.size())));
            deleteQuietly(dir);
            throw ScanException.badRequest(
                    "zip 里有 " + rejected.size() + " 个不安全条目名（../ 或绝对路径），已整体拒绝：" + sample);
        }
        Path realRoot = unwrapSingleTopDir(dir);
        return new SourceResolver(realRoot, dir, "zip");
    }

    /** 复制并对单文件大小设闸。返回实际写入字节数 */
    private static long copyCapped(InputStream in, Path out) throws IOException {
        long written = 0;
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) {
            written += n;
            if (written > ScanGuard.MAX_FILE_BYTES) {
                Files.deleteIfExists(out);
                throw ScanException.tooLarge("zip 内单文件超过上限 " + ScanGuard.MAX_FILE_BYTES / 1024 / 1024 + "MB：" + out.getFileName());
            }
            if (Files.notExists(out)) {
                Files.createFile(out);
            }
            Files.write(out, Arrays.copyOf(buf, n), StandardOpenOption.APPEND);
        }
        if (Files.notExists(out)) {
            Files.createFile(out);
        }
        return written;
    }

    /** zip 常见形状是「一个顶层目录装着整个仓库」，剥掉它，事实里的相对路径才干净 */
    private static Path unwrapSingleTopDir(Path dir) {
        try (var list = Files.list(dir)) {
            List<Path> entries = list.toList();
            if (entries.size() == 1 && Files.isDirectory(entries.get(0))) {
                return entries.get(0);
            }
        } catch (IOException ignored) {
            // 列不出来就用原目录，不影响正确性
        }
        return dir;
    }

    // ─────────────────────────────────────────────────────────────
    // 输入三：git（只 https）
    // ─────────────────────────────────────────────────────────────

    public static SourceResolver fromGit(String url) {
        if (!ScanGuard.gitUrlAllowed(url)) {
            throw ScanException.badRequest(
                    "只支持 https 的公开仓库地址（禁止 file:// / ssh:// / git://）；私有仓库请自行 clone 后扫本地目录");
        }
        Path dir = createTempDir("arsenal-scan-git-");
        Path target = dir.resolve("repo");
        List<String> cmd = List.of(
                "git", "clone",
                "--depth", "1",
                "--single-branch",
                "--no-tags",
                "--config", "core.hooksPath=/dev/null",
                "--config", "advice.detachedHead=false",
                url.trim(), target.toString());
        try {
            ProcessBuilder pb = new ProcessBuilder(cmd);
            // 不许它停下来问密码 —— 那会让这个请求永远挂着
            pb.environment().put("GIT_TERMINAL_PROMPT", "0");
            pb.environment().put("GIT_ASKPASS", "");
            pb.redirectErrorStream(true);
            Process proc = pb.start();
            StringBuilder out = new StringBuilder();
            Thread reader = new Thread(() -> {
                try (var r = new BufferedReader(new InputStreamReader(proc.getInputStream()))) {
                    String line;
                    while ((line = r.readLine()) != null && out.length() < 4000) {
                        out.append(line).append('\n');
                    }
                } catch (IOException ignored) {
                    // 输出读不到不影响判定：退出码才是依据
                }
            });
            reader.setDaemon(true);
            reader.start();
            if (!proc.waitFor(60, TimeUnit.SECONDS)) {
                proc.destroyForcibly();
                deleteQuietly(dir);
                throw ScanException.timeout("git clone 超时（60s）");
            }
            if (proc.exitValue() != 0) {
                deleteQuietly(dir);
                String tail = out.length() > 300 ? out.substring(out.length() - 300) : out.toString();
                throw new ScanException(ScanException.GIT_FAILED, "git clone 失败：" + tail.trim());
            }
        } catch (ScanException e) {
            throw e;
        } catch (IOException e) {
            deleteQuietly(dir);
            throw new ScanException(ScanException.GIT_FAILED, "本机没有可用的 git：" + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            deleteQuietly(dir);
            throw ScanException.timeout("git clone 被中断");
        }
        // .git 目录里可能有 hook 与配置，扫描阶段不读它（skipDir 已含 .git）
        return new SourceResolver(target, dir, "git");
    }

    /**
     * 克隆进指定目录（供项目工坊「摄取即缓存」用，治每请求现 clone 的慢）。
     *
     * <p>与 {@link #fromGit} 同一套安全约定（只 https / depth 1 / 禁 hook / 禁交互），
     * 但落点是调用方给的目录（缓存 {@code <id>/repo/}），而不是一次性临时目录。
     * {@code target} 必须存在且为空（调用方已建好）；clone 失败抛 {@link ScanException}。
     */
    public static void fromGitInto(Path target, String url) {
        if (!ScanGuard.gitUrlAllowed(url)) {
            throw ScanException.badRequest(
                    "只支持 https 的公开仓库地址（禁止 file:// / ssh:// / git://）；私有仓库请自行 clone 后扫本地目录");
        }
        List<String> cmd = List.of(
                "git", "clone",
                "--depth", "1",
                "--single-branch",
                "--no-tags",
                "--config", "core.hooksPath=/dev/null",
                "--config", "advice.detachedHead=false",
                url.trim(), target.toString());
        try {
            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.environment().put("GIT_TERMINAL_PROMPT", "0");
            pb.environment().put("GIT_ASKPASS", "");
            pb.redirectErrorStream(true);
            Process proc = pb.start();
            StringBuilder out = new StringBuilder();
            Thread reader = new Thread(() -> {
                try (var r = new BufferedReader(new InputStreamReader(proc.getInputStream()))) {
                    String line;
                    while ((line = r.readLine()) != null && out.length() < 4000) {
                        out.append(line).append('\n');
                    }
                } catch (IOException ignored) {
                }
            });
            reader.setDaemon(true);
            reader.start();
            if (!proc.waitFor(60, TimeUnit.SECONDS)) {
                proc.destroyForcibly();
                throw ScanException.timeout("git clone 超时（60s）");
            }
            if (proc.exitValue() != 0) {
                String tail = out.length() > 300 ? out.substring(out.length() - 300) : out.toString();
                throw new ScanException(ScanException.GIT_FAILED, "git clone 失败：" + tail.trim());
            }
        } catch (ScanException e) {
            throw e;
        } catch (IOException e) {
            throw new ScanException(ScanException.GIT_FAILED, "本机没有可用的 git：" + e.getMessage());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw ScanException.timeout("git clone 被中断");
        }
    }

    // ─────────────────────────────────────────────────────────────

    private static Path createTempDir(String prefix) {
        try {
            return Files.createTempDirectory(prefix);
        } catch (IOException e) {
            throw new ScanException(ScanException.BAD_REQUEST, "无法创建临时目录：" + e.getMessage());
        }
    }

    /** 深删。临时目录里是别人的代码，用完必须消失 */
    private static void deleteQuietly(Path dir) {
        if (dir == null) return;
        try (var walk = Files.walk(dir)) {
            walk.sorted(Comparator.reverseOrder()).forEach(p -> {
                try {
                    Files.deleteIfExists(p);
                } catch (IOException ignored) {
                    // Windows 上偶发删不掉（句柄未释放）。残留的是临时目录，不影响结果
                }
            });
        } catch (IOException ignored) {
            // 同上
        }
    }

    @Override
    public void close() {
        if (temp != null) {
            deleteQuietly(temp);
        }
    }
}
