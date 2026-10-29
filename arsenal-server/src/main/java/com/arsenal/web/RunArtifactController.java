package com.arsenal.web;

import com.arsenal.runs.RunStore;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;

/**
 * Run 产物端点（重建设计计划 §7.3）—— 「体检即产物」的取货口。
 *
 * <p>runId 全局唯一（16 位 hex），所以这里不带 projectId：先经 {@link RunStore#findRun}
 * 定位它属于哪个项目，再从 run 目录取文件。产物不存在时回 404 + 人话 ——
 * 「报告还没生成」与「run 不存在」是两种不同的没拿到，必须分开说。
 *
 * <p>产物清单每项带 sha256：报告要能被引用、被比对、被复现（G3），没有哈希的产物
 * 无法自证「还是当初那份」。下载走 Content-Disposition 附件 —— 浏览器点了就落文件，
 * 不在页面里展示（报告是人要拿走的东西，不是站内又一块展示）。
 */
@RestController
@RequestMapping("/api/v2/runs/{runId}")
public class RunArtifactController {

    private final RunStore runs;
    private final ObjectMapper mapper;

    public RunArtifactController(RunStore runs, ObjectMapper mapper) {
        this.runs = runs;
        this.mapper = mapper;
    }

    /** 下载 report.md（附件）。run 不存在 / 报告未生成 → 404 JSON 信封。 */
    @GetMapping("/report.md")
    public ResponseEntity<?> report(@PathVariable("runId") String runId) {
        Path dir = runs.findRun(runId).map(RunStore.RunRef::dir).orElse(null);
        if (dir == null) {
            return notFound("没有这个 run：" + runId);
        }
        Path file = dir.resolve("report.md");
        if (!Files.isRegularFile(file)) {
            return notFound("该 run 还没有 report.md —— run 未完成（DONE 才有报告），或生成于 N3 之前");
        }
        try {
            byte[] body = Files.readAllBytes(file);
            return ResponseEntity.ok()
                    .contentType(new MediaType("text", "markdown", StandardCharsets.UTF_8))
                    .header(HttpHeaders.CONTENT_DISPOSITION,
                            "attachment; filename=\"report-" + runId + ".md\"")
                    .body(body);
        } catch (IOException e) {
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(ApiResponse.fail("READ_ERROR", "报告读不出来：" + e.getMessage()));
        }
    }

    /** 产物清单（带 sha256）。临时文件（*.tmp-*）不进清单 —— 那是原子写的脚手架，不是产物。 */
    @GetMapping("/artifacts")
    public ApiResponse<List<ObjectNode>> artifacts(@PathVariable("runId") String runId) {
        Path dir = runs.findRun(runId).map(RunStore.RunRef::dir).orElse(null);
        if (dir == null) {
            return ApiResponse.fail("NOT_FOUND", "没有这个 run：" + runId);
        }
        List<ObjectNode> out = new ArrayList<>();
        try (var stream = Files.list(dir)) {
            stream.filter(Files::isRegularFile)
                    .filter(p -> !p.getFileName().toString().contains(".tmp-"))
                    .sorted((a, b) -> a.getFileName().toString().compareTo(b.getFileName().toString()))
                    .forEach(p -> {
                        try {
                            byte[] bytes = Files.readAllBytes(p);
                            ObjectNode item = mapper.createObjectNode();
                            item.put("name", p.getFileName().toString());
                            item.put("bytes", bytes.length);
                            item.put("sha256", sha256(bytes));
                            out.add(item);
                        } catch (IOException e) {
                            throw new UncheckedIOException(e);
                        }
                    });
        } catch (IOException | UncheckedIOException e) {
            return ApiResponse.fail("READ_ERROR", "列产物失败：" + e.getMessage());
        }
        return ApiResponse.ok(out);
    }

    private ResponseEntity<ApiResponse<Void>> notFound(String message) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .contentType(MediaType.APPLICATION_JSON)
                .body(ApiResponse.fail("NOT_FOUND", message));
    }

    static String sha256(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (Exception e) {
            throw new IllegalStateException("JDK 必有 SHA-256", e);
        }
    }
}
