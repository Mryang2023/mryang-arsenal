package com.arsenal.scan;

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;

import tools.jackson.databind.JsonNode;

/**
 * 一次增量扫描的**入参**：上一份事实 + 这次变更了哪些文件。
 *
 * <p><b>为什么客户端要把上一份事实原样送回来</b>，而不在服务端留缓存：
 * 服务端留缓存就得有过期、有淘汰、有「这次拿到的是哪一份」——
 * 而那些状态在<b>客户端</b>本来就有一份现成的（上一枚序列点旁边的文件清单 + 上一份 facts）。
 * 让客户端持有缓存、后端保持无状态，是这里唯一不会说谎的形状：
 * 后端要么拿到一份可核对的旧事实并原样沿用，要么拿不到就全量重算。
 *
 * <p><b>信任边界写在这里，不藏着：</b>{@code changedFiles} 是客户端<b>说的</b>，
 * 不是我们核对过的。它与目录指纹共用同一个盲区（mtime + size）。
 * 所以复用出去的事实必定带一条 {@code INCREMENTAL_REUSED} note，
 * 且 {@code incremental.reason} 会写明为什么没复用 —— 过期要能被发现。
 */
public record IncrementalRequest(JsonNode prevFacts, Set<String> changedFiles) {

    public IncrementalRequest {
        changedFiles = changedFiles == null
                ? Set.of()
                : Collections.unmodifiableSet(new LinkedHashSet<>(changedFiles));
    }

    /** 空提示（= 全量重算）。调用方拿不到上一份时用它，不要传 null 让下游到处判空。 */
    public static IncrementalRequest none() {
        return new IncrementalRequest(null, Set.of());
    }
}
