package com.arsenal.runs;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Run/Artifact 落盘的唯一写入口（重建设计计划 §7.2）。
 *
 * <p>重建的核心主张是「Run 是唯一执行单元，Artifact 是唯一交付单元」：体检、报告、
 * 补丁、测试都必须挂在一次 run 上落盘，而不是散落在页面状态或内存里。本类只负责
 * 「把一次 run 的文件安全地写到磁盘」这一件事 —— 不跑引擎、不出结论，那些是
 * RunsController / ReportService 的职责。
 *
 * <p>存储布局：
 * <pre>
 *   &lt;projectsRoot&gt;/&lt;projectId&gt;/runs/&lt;runId&gt;/
 *     run.json          —— 状态账（status / startedAt / endedAt / manifest）
 *     findings.jsonl    —— 一行一条 finding（N2 起写入）
 *     coverage.json     —— 覆盖率披露（N2 起写入）
 *     report.md         —— 人读报告（N3 起写入）
 * </pre>
 *
 * <p>三条硬约定：
 * <ul>
 *   <li><b>路径段一律过白名单。</b>projectId / runId / 文件名都只允许 {@code [A-Za-z0-9._-]}
 *       的安全字符 —— 用户可控的 id 拼进路径前必须先过这道闸，本仓在 SourceResolver 上
 *       已经补过一次目录穿越，这里不做第二次事故。</li>
 *   <li><b>写文件必原子。</b>先写同目录临时文件再 move —— 半份 run.json 比没有 run.json
 *       更糟，读的人会把半截 JSON 当成完整结论。</li>
 *   <li><b>状态只有三态。</b>RUNNING / DONE / FAILED，与前端「空/载入/离线/未验证/已验证」
 *       的诚实口径同源 —— 不存在第四种「看起来跑完了」的状态。</li>
 * </ul>
 *
 * <p>runId 生成与 {@code QaService} 的 jobId 同款（16 位 hex，UUID 去杠截取），
 * 两套账的 id 形态一致，人看到不会有「这是两套系统」的错觉。
 */
public final class RunStore {

    /** projectId / runId 的白名单：字母数字下划线连字，1–64 位。拒掉一切路径字符。 */
    private static final Pattern SEGMENT = Pattern.compile("[A-Za-z0-9_-]{1,64}");

    /**
     * run 目录内的文件名白名单：不许以点开头（堵住临时文件与「..」穿越的另一半），
     * 只允许一层文件名，不许带路径分隔符。
     */
    private static final Pattern FILE_NAME = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,127}");

    private final Path projectsRoot;
    private final ObjectMapper mapper;
    private final SecureRandom random = new SecureRandom();

    public RunStore(Path projectsRoot, ObjectMapper mapper) {
        this.projectsRoot = projectsRoot.toAbsolutePath().normalize();
        this.mapper = mapper;
    }

    /** 一次 run 的定位：项目 id + run id + 目录。 */
    public record RunRef(String projectId, String runId, Path dir) {
    }

    /**
     * 开一次 run：建目录、写 run.json（status=RUNNING）。manifest 原样收进账里
     * （快照指纹、规则集版本、引擎版本、触发方式由调用方组装 —— 本类不替调用方编事实）。
     */
    public RunRef start(String projectId, ObjectNode manifest) {
        String pid = segment(projectId, "projectId");
        String runId = newRunId();
        Path dir = projectsRoot.resolve(pid).resolve("runs").resolve(runId);
        try {
            Files.createDirectories(dir);
        } catch (IOException e) {
            throw new UncheckedIOException("创建 run 目录失败：" + dir, e);
        }
        ObjectNode run = mapper.createObjectNode();
        run.put("schemaVersion", 1);
        run.put("runId", runId);
        run.put("projectId", pid);
        run.put("status", "RUNNING");
        run.put("startedAt", nowIso());
        run.set("manifest", manifest == null ? mapper.createObjectNode() : manifest);
        writeAtomic(dir.resolve("run.json"), run.toPrettyString());
        return new RunRef(pid, runId, dir);
    }

    /** 收口一次 run。status 只认 DONE / FAILED；重复收口以最后一次为准（endedAt 随之刷新）。 */
    public void complete(String projectId, String runId, String status) {
        if (!"DONE".equals(status) && !"FAILED".equals(status)) {
            throw new IllegalArgumentException("run 收口状态只认 DONE / FAILED，收到「" + status + "」");
        }
        ObjectNode run = read(projectId, runId)
                .orElseThrow(() -> new IllegalArgumentException("没有这个 run：" + segment(projectId, "projectId") + "/" + runId));
        run.put("status", status);
        run.put("endedAt", nowIso());
        writeAtomic(dirOf(projectId, runId).orElseThrow().resolve("run.json"), run.toPrettyString());
    }

    /** 往 run 目录原子写一个产物文件（findings.jsonl / coverage.json / report.md …）。 */
    public void writeFile(RunRef ref, String name, String content) {
        if (ref == null || !Files.isDirectory(ref.dir())) {
            throw new IllegalArgumentException("run 目录不存在或已删除");
        }
        writeFile(ref.dir(), name, content);
    }

    private void writeFile(Path dir, String name, String content) {
        if (name == null || !FILE_NAME.matcher(name).matches()) {
            throw new IllegalArgumentException("产物文件名不安全（只许一层安全字符、不许以点开头）：" + name);
        }
        writeAtomic(dir.resolve(name), content);
    }

    /** 读一份 run.json。不存在 / 坏 JSON → empty（读侧宽容，写侧严格）。 */
    public Optional<ObjectNode> read(String projectId, String runId) {
        return dirOf(projectId, runId).flatMap(this::readAt);
    }

    /** 项目下全部 run，startedAt 新的在前；坏账条目标 UNKNOWN 沉底，不静默消失。 */
    public List<ObjectNode> list(String projectId) {
        String pid = segment(projectId, "projectId");
        Path runsDir = projectsRoot.resolve(pid).resolve("runs");
        List<ObjectNode> out = new ArrayList<>();
        if (!Files.isDirectory(runsDir)) {
            return out;
        }
        List<Path> dirs;
        try (var stream = Files.list(runsDir)) {
            dirs = stream.filter(Files::isDirectory).sorted().toList();
        } catch (IOException e) {
            throw new UncheckedIOException("列 run 目录失败：" + runsDir, e);
        }
        for (Path d : dirs) {
            Optional<ObjectNode> node = readAt(d);
            if (node.isPresent()) {
                out.add(node.get());
            } else {
                ObjectNode unknown = mapper.createObjectNode();
                unknown.put("runId", d.getFileName().toString());
                unknown.put("projectId", pid);
                unknown.put("status", "UNKNOWN");
                out.add(unknown);
            }
        }
        out.sort(Comparator.comparing((ObjectNode n) -> n.path("startedAt").asString("")).reversed());
        return out;
    }

    /** run 目录。id 不合法或目录不存在 → empty（不抛异常的查询口径，给 Controller 判 404 用）。 */
    public Optional<Path> dirOf(String projectId, String runId) {
        if (projectId == null || runId == null
                || !SEGMENT.matcher(projectId).matches() || !SEGMENT.matcher(runId).matches()) {
            return Optional.empty();
        }
        Path dir = projectsRoot.resolve(projectId).resolve("runs").resolve(runId);
        return Files.isDirectory(dir) ? Optional.of(dir) : Optional.empty();
    }

    /** 只有 runId 的查找（全局唯一）：扫各项目目录定位它属于谁。找不到 → empty。 */
    public Optional<RunRef> findRun(String runId) {
        if (runId == null || !SEGMENT.matcher(runId).matches()) {
            return Optional.empty();
        }
        List<Path> projects;
        try (var stream = Files.list(projectsRoot)) {
            projects = stream.filter(Files::isDirectory).sorted().toList();
        } catch (IOException e) {
            throw new UncheckedIOException("列项目目录失败：" + projectsRoot, e);
        }
        for (Path p : projects) {
            Path dir = p.resolve("runs").resolve(runId);
            if (Files.isDirectory(dir)) {
                return Optional.of(new RunRef(p.getFileName().toString(), runId, dir));
            }
        }
        return Optional.empty();
    }

    // ── 内部 ──────────────────────────────────────────────────

    private Optional<ObjectNode> readAt(Path dir) {
        Path file = dir.resolve("run.json");
        if (!Files.isRegularFile(file)) {
            return Optional.empty();
        }
        try {
            JsonNode node = mapper.readTree(Files.readString(file, StandardCharsets.UTF_8));
            return node instanceof ObjectNode obj ? Optional.of(obj) : Optional.empty();
        } catch (IOException | RuntimeException e) {
            return Optional.empty();
        }
    }

    /** 临时文件 + move 的原子写。move 失败的兜底是显式替换，绝不留半截正文。 */
    private void writeAtomic(Path target, String content) {
        Path tmp = target.resolveSibling("." + target.getFileName() + ".tmp-" + Long.toHexString(random.nextLong()));
        try {
            Files.writeString(tmp, content, StandardCharsets.UTF_8);
            try {
                Files.move(tmp, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException e) {
                Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            throw new UncheckedIOException("原子写失败：" + target, e);
        }
    }

    private String newRunId() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 16);
    }

    private String segment(String value, String what) {
        if (value == null || !SEGMENT.matcher(value).matches()) {
            throw new IllegalArgumentException(what + " 不安全（只许字母数字下划线连字，1–64 位）："
                    + (value == null ? "null" : "「" + value + "」"));
        }
        return value;
    }

    private static String nowIso() {
        return OffsetDateTime.now(java.time.ZoneOffset.ofHours(8)).toString();
    }
}
