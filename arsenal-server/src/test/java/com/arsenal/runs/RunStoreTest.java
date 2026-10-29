package com.arsenal.runs;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;

/**
 * RunStore 的分支级护栏（ROADMAP N1）。
 *
 * 守的是「体检即产物」这条链的地基：run 目录建得对、状态账写得对、
 * 原子写不留半截、不安全的 id/文件名进不来、列表与全局查找的口径稳定。
 * 全部用 @TempDir，不碰 .data。
 */
class RunStoreTest {

    private static final Pattern RUN_ID = Pattern.compile("[0-9a-f]{16}");

    @TempDir
    Path temp;

    private final ObjectMapper mapper = new ObjectMapper();

    private RunStore store() {
        return new RunStore(temp, mapper);
    }

    private ObjectNode manifest(String fingerprint) {
        ObjectNode m = mapper.createObjectNode();
        m.put("snapshot", fingerprint);
        m.put("rulesetVersion", "0.1.0");
        m.put("engine", "static");
        return m;
    }

    @Test
    void startCreatesDirectoryAndRunJson() throws IOException {
        RunStore store = store();
        RunStore.RunRef ref = store.start("proj01", manifest("dir:371:5938261"));

        assertTrue(RUN_ID.matcher(ref.runId()).matches(), "runId 必须是 16 位小写 hex");
        assertTrue(Files.isDirectory(ref.dir()), "run 目录已创建");
        assertTrue(ref.dir().toString().replace('\\', '/').contains("proj01/runs/" + ref.runId()),
                "布局必须是 <projectId>/runs/<runId>");

        ObjectNode run = mapper.readValue(ref.dir().resolve("run.json").toFile(), ObjectNode.class);
        assertEquals("RUNNING", run.path("status").asString());
        assertEquals("proj01", run.path("projectId").asString());
        assertFalse(run.path("startedAt").asString().isEmpty(), "startedAt 必须落账");
        assertEquals("dir:371:5938261", run.path("manifest").path("snapshot").asString(),
                "manifest 必须原样收进账，本类不替调用方编事实");
    }

    @Test
    void completeStampsStatusAndEndedAt() {
        RunStore store = store();
        RunStore.RunRef ref = store.start("proj01", manifest("f1"));

        store.complete(ref.projectId(), ref.runId(), "DONE");
        ObjectNode run = store.read("proj01", ref.runId()).orElseThrow();
        assertEquals("DONE", run.path("status").asString());
        assertFalse(run.path("endedAt").asString().isEmpty(), "收口必须盖 endedAt");

        RunStore.RunRef ref2 = store.start("proj01", manifest("f1"));
        store.complete("proj01", ref2.runId(), "FAILED");
        assertEquals("FAILED", store.read("proj01", ref2.runId()).orElseThrow().path("status").asString());

        assertThrows(IllegalArgumentException.class, () -> store.complete("proj01", ref.runId(), "OK"),
                "状态只认 DONE / FAILED，别的必须当场拒绝");
    }

    @Test
    void writeFileRoundTripAndAtomicOverwrite() throws IOException {
        RunStore store = store();
        RunStore.RunRef ref = store.start("proj01", manifest("f1"));

        store.writeFile(ref, "findings.jsonl", "a\nb\n");
        assertEquals("a\nb\n", Files.readString(ref.dir().resolve("findings.jsonl"), StandardCharsets.UTF_8));

        store.writeFile(ref, "findings.jsonl", "c\n");
        assertEquals("c\n", Files.readString(ref.dir().resolve("findings.jsonl"), StandardCharsets.UTF_8),
                "覆盖后读到的必须是新内容");

        try (var stream = Files.list(ref.dir())) {
            long leftovers = stream.filter(p -> p.getFileName().toString().contains(".tmp-")).count();
            assertEquals(0, leftovers, "原子写不允许在 run 目录里留临时文件");
        }
    }

    @Test
    void rejectsUnsafeIdsAndFileNames() {
        RunStore store = store();

        assertThrows(IllegalArgumentException.class, () -> store.start("../etc", manifest("f")));
        assertThrows(IllegalArgumentException.class, () -> store.start("a/b", manifest("f")));
        assertThrows(IllegalArgumentException.class, () -> store.start("", manifest("f")));
        assertThrows(IllegalArgumentException.class, () -> store.start(null, manifest("f")));

        RunStore.RunRef ref = store.start("proj01", manifest("f"));
        assertThrows(IllegalArgumentException.class, () -> store.writeFile(ref, "../evil", "x"),
                "文件名带路径必须拒绝");
        assertThrows(IllegalArgumentException.class, () -> store.writeFile(ref, ".hidden", "x"),
                "点开头的文件名必须拒绝（临时文件与穿越的另一半）");
        assertThrows(IllegalArgumentException.class, () -> store.writeFile(ref, "a/b.txt", "x"));

        assertTrue(store.dirOf("proj01", "..").isEmpty(), "runId 目录穿越必须返回 empty 而不是抛到调用方");
        assertThrows(IllegalArgumentException.class, () -> store.complete("proj01", "../x", "DONE"),
                "坏 runId 不许读到半路");
    }

    @Test
    void listsRunsNewestFirstAndKeepsUnknownEntries() throws InterruptedException {
        RunStore store = store();
        RunStore.RunRef older = store.start("proj01", manifest("f1"));
        Thread.sleep(20); // startedAt 是 ISO 时间戳，排序按它 —— 隔开两笔，避免同刻生成
        RunStore.RunRef newer = store.start("proj01", manifest("f2"));

        List<ObjectNode> runs = store.list("proj01");
        assertEquals(2, runs.size());
        assertEquals(newer.runId(), runs.get(0).path("runId").asString(), "新的在前");
        assertEquals(older.runId(), runs.get(1).path("runId").asString());

        assertEquals(0, store.list("nosuch").size(), "没有 run 的项目返回空表，不是错误");

        // 坏账不静默消失：删掉 run.json 后条目仍在，status=UNKNOWN 沉底
        try {
            Files.delete(older.dir().resolve("run.json"));
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
        List<ObjectNode> after = store.list("proj01");
        assertEquals(2, after.size(), "坏账条目必须保留");
        assertEquals("UNKNOWN", after.get(after.size() - 1).path("status").asString());
    }

    @Test
    void readUnknownReturnsEmptyAndFindRunSearchesAcrossProjects() {
        RunStore store = store();
        RunStore.RunRef a = store.start("projA", manifest("f"));
        RunStore.RunRef b = store.start("projB", manifest("f"));

        assertTrue(store.read("projA", "0123456789abcdef").isEmpty(), "未知 run → empty");
        assertTrue(store.dirOf("projA", "0123456789abcdef").isEmpty(), "未知 run 目录 → empty");

        assertEquals("projB", store.findRun(b.runId()).orElseThrow().projectId(),
                "全局查找能定位 run 属于哪个项目");
        assertEquals(a.dir(), store.findRun(a.runId()).orElseThrow().dir());
        assertTrue(store.findRun("ffffffffffffffff").isEmpty());
        assertTrue(store.findRun("../x").isEmpty(), "不安全的 runId 直接判空，不进文件系统");
    }
}
