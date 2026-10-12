package com.arsenal.scan;

import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 一次扫描的共享上下文：根目录、待读文件、note 收集器、超时闸门。
 *
 * 五个子 Scanner 都只靠它工作 —— 它们之间不互相引用，加一个 Scanner
 * 不会影响其它四个。
 */
public final class ScanContext {

    private final Path root;
    private final List<Path> files;
    private final ObjectMapper mapper;
    private final List<ScanNote> notes = new ArrayList<>();
    private final long deadline;
    private boolean truncated = false;

    public ScanContext(Path root, List<Path> files, ObjectMapper mapper, long timeoutMs) {
        this.root = root;
        this.files = files;
        this.mapper = mapper;
        this.deadline = System.currentTimeMillis() + timeoutMs;
    }

    public Path root() {
        return root;
    }

    public List<Path> files() {
        return files;
    }

    public ObjectMapper mapper() {
        return mapper;
    }

    public boolean truncated() {
        return truncated;
    }

    public void markTruncated() {
        truncated = true;
    }

    public void note(String level, String code, String message) {
        notes.add(new ScanNote(level, code, message));
    }

    public void warn(String code, String message) {
        note(ScanNote.WARN, code, message);
    }

    /** 超时检查。到点就抛 —— 宁可返回半份带 truncated 的事实，也不让请求挂死 */
    public void tick() {
        if (System.currentTimeMillis() > deadline) {
            markTruncated();
            throw ScanException.timeout("扫描超过 " + ScanGuard.TIMEOUT_MS / 1000 + " 秒，已中断");
        }
    }

    /** 相对路径（统一用 / 分隔，与事实 JSON 里的其它路径同一形状） */
    public String rel(Path p) {
        String r = root.relativize(p).toString().replace('\\', '/');
        return r;
    }

    /**
     * 读文本。读不了（过大 / 权限 / 编码）返回 null **并记一条 note** ——
     * 返回空列表会让调用方以为「文件里什么都没有」。
     */
    public List<String> readLines(Path p) {
        if (ScanGuard.fileTooLarge(p)) {
            warn(ScanNote.FILE_TOO_LARGE, rel(p) + " 超过 " + ScanGuard.MAX_FILE_BYTES / 1024 / 1024 + "MB，未读取内容");
            return null;
        }
        try {
            return Files.readAllLines(p, StandardCharsets.UTF_8);
        } catch (IOException | OutOfMemoryError e) {
            warn(ScanNote.FILE_UNREADABLE, rel(p) + " 无法按 UTF-8 读取：" + e.getMessage());
            return null;
        }
    }

    /** 相对路径匹配：后缀或文件名相等。路径统一转小写、分隔符统一为 / */
    public static boolean pathEndsWith(String relPath, String suffix) {
        String p = relPath.toLowerCase();
        String s = suffix.toLowerCase();
        return p.equals(s) || p.endsWith("/" + s);
    }

    public static boolean pathContains(String relPath, String fragment) {
        return relPath.toLowerCase().contains(fragment.toLowerCase());
    }

    /** note 排序输出：同一次扫描的 note 顺序必须稳定，否则「扫两次结果一致」这条断言守不住 */
    public List<ScanNote> sortedNotes() {
        List<ScanNote> copy = new ArrayList<>(notes);
        copy.sort(Comparator.comparing((ScanNote n) -> n.code()).thenComparing(ScanNote::message));
        return copy;
    }
}
