package com.arsenal.projects;

import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * 服务端项目注册表 —— 缓存的属主。
 *
 * <p>落盘在 {@code <projectsRoot>/registry.json}，<b>原子写</b>：先写同目录临时文件，
 * 再 {@code Files.move} 过去（{@code ATOMIC_MOVE}，不支持就退化为 {@code REPLACE_EXISTING}）。
 * 半写中途崩溃不会留下一个写坏的 registry —— 最坏是「这次没写进去」，下一次读仍是旧的好文件。
 *
 * <p>单用户工具：内存里持有一份快照，所有改动走 {@code synchronized} 后整体重写。
 * 读失败（文件损坏 / 缺字段）一律回退成空列表并照常起服务，绝不让注册表拖垮后端启动。
 *
 * <p>本类不碰缓存内容，只管「有哪些项目、各自的源与缓存统计」这一层账。
 */
public final class ProjectRegistry {

    private static final int SCHEMA_VERSION = 1;

    private final Path file;
    private final ObjectMapper mapper;
    /** 内存快照。所有写操作先改它再落盘。 */
    private volatile List<ObjectNode> entries;

    public ProjectRegistry(Path projectsRoot, ObjectMapper mapper) {
        this.file = projectsRoot.resolve("registry.json");
        this.mapper = mapper;
        this.entries = loadFromDisk();
    }

    /** 只读副本，调用方随便遍历不担心并发。 */
    public synchronized List<ObjectNode> list() {
        return new ArrayList<>(entries);
    }

    public synchronized Optional<ObjectNode> find(String id) {
        for (ObjectNode e : entries) {
            if (id.equals(e.path("id").asText(""))) {
                return Optional.of(e.deepCopy());
            }
        }
        return Optional.empty();
    }

    public synchronized boolean exists(String id) {
        return entries.stream().anyMatch(e -> id.equals(e.path("id").asText("")));
    }

    /** 加入一个项目（调用方先 {@link #exists} 判重，这里不重复校验）。 */
    public synchronized void add(ObjectNode entry) {
        entries.add(entry);
        saveAtomic();
    }

    /** 删掉一个项目（保留其缓存目录由调用方决定，这里只动账）。 */
    public synchronized void remove(String id) {
        entries.removeIf(e -> id.equals(e.path("id").asText("")));
        saveAtomic();
    }

    /** 整体替换某个条目（用于刷新缓存统计 / lastFactsAt / lastJobId）。 */
    public synchronized void replace(ObjectNode entry) {
        String id = entry.path("id").asText("");
        for (int i = 0; i < entries.size(); i++) {
            if (id.equals(entries.get(i).path("id").asText(""))) {
                entries.set(i, entry);
                saveAtomic();
                return;
            }
        }
        // 没找到就当新增
        add(entry);
    }

    // ─────────────────────────────────────────────────────────────
    // 落盘
    // ─────────────────────────────────────────────────────────────

    private List<ObjectNode> loadFromDisk() {
        if (!Files.isRegularFile(file)) {
            return new ArrayList<>();
        }
        try {
            ObjectNode root = (ObjectNode) mapper.readTree(file.toFile());
            ArrayNode arr = root.withArray("projects");
            List<ObjectNode> out = new ArrayList<>();
            for (var n : arr) {
                if (n instanceof ObjectNode o) out.add(o);
            }
            return out;
        } catch (Exception e) {
            // 损坏不致命：空账起服务，下次写会覆盖。
            return new ArrayList<>();
        }
    }

    private void saveAtomic() {
        try {
            Files.createDirectories(file.getParent());
            ObjectNode root = mapper.createObjectNode();
            root.put("schemaVersion", SCHEMA_VERSION);
            ArrayNode arr = root.putArray("projects");
            for (ObjectNode e : entries) {
                arr.add(e);
            }
            Path tmp = Files.createTempFile(file.getParent(), ".registry-", ".tmp");
            try {
                mapper.writerWithDefaultPrettyPrinter().writeValue(tmp.toFile(), root);
                try {
                    Files.move(tmp, file, java.nio.file.StandardCopyOption.ATOMIC_MOVE);
                } catch (AtomicMoveNotSupportedException ex) {
                    Files.move(tmp, file, java.nio.file.StandardCopyOption.REPLACE_EXISTING);
                }
            } finally {
                Files.deleteIfExists(tmp);
            }
        } catch (IOException e) {
            throw new IllegalStateException("注册表落盘失败：" + e.getMessage(), e);
        }
    }
}
