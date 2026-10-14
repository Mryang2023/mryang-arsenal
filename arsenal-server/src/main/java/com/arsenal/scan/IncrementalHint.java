package com.arsenal.scan;

import java.util.Locale;
import java.util.Set;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * L2「按文件增量」的**判据唯一出处** —— 「这次能不能只重算一部分」的判断在这里，不在调用方。
 *
 * <p><b>为什么这个类存在，而它只有一个方法。</b>
 * 五个子 Scanner 里，{@code BuildScanner} / {@code ConfigScanner} / {@code DeployScanner}
 * （含 CI）/ {@code frontend} / {@code techStack} 五个块**只读描述文件**
 * （pom、gradle、package.json、yml/yaml/properties/env、Dockerfile、nginx conf）。
 * 只要这次变更的文件里**一个描述文件都没有**，这五个块的输出就与上次**逐字段相等** ——
 * 这不是「大概不变」，是输入集合为空导致的恒等。
 *
 * <p>于是 L2 不是「少扫点文件」的近似，而是：
 * <ul>
 *   <li>描述文件<b>没动</b> → 这五块沿用上一份 facts，{@code code} 与 {@code services} 重算；</li>
 *   <li>描述文件<b>动了</b> → 全量重算（老路）。</li>
 * </ul>
 *
 * <p><b>三条不许破的规矩：</b>
 * <ol>
 *   <li><b>判据在这边，不在客户端。</b>客户端只负责报「哪些文件变了」，
 *       「这些变��里有没有描述文件」由本类回答 —— 描述文件清单有第二份实现，
 *       早晚会有一处漏一个扩展名，然后静默给出过期结论。</li>
 *   <li><b>客户端可能少报。</b>它报的是「我看到的差异」，我们信它与信指纹是同一个口径
 *       （mtime+size 的盲区照旧）。所以复用出去的 facts 必须带一条 note，
 *       说清这一份的 build/config/deploy 来自哪一次 —— 过期要能被发现，不能只是「看起来对」。</li>
 *   <li><b>增删文件也算变更。</b>新增一个 {@code application.yml} 是描述文件变更；
 *       删除一个 {@code pom.xml} 同样是。<b>删除尤其危险</b>：沿用旧块等于宣称
 *       「这个模块还在」—— 所以 removed 集合里只要出现描述文件，一律全量重算。</li>
 * </ol>
 */
public final class IncrementalHint {

    private IncrementalHint() {
    }

    /**
     * 描述文件的判定。<b>逐条对应五个块的真实读盘逻辑</b>，新增 Scanner 读新文件时必须在这里加一行。
     */
    private static boolean isDescriptor(String name, String lower) {
        return name.equals("pom.xml")
                || name.equals("package.json")
                || name.equals("Dockerfile") || lower.startsWith("dockerfile.")
                || name.equals(".env") || lower.endsWith(".env")
                || lower.endsWith(".yml") || lower.endsWith(".yaml")
                || lower.endsWith(".properties")
                || lower.endsWith(".gradle") || lower.endsWith(".gradle.kts")
                || lower.equals("jenkinsfile")
                || lower.endsWith(".conf"); // nginx 站点配置（DeployScanner 只在路径含 nginx 时才读）
    }

    /**
     * 这批变更文件里有没有描述文件。
     *
     * @param changedRel 变更文件的仓库相对路径（增删改都在内）
     * @return true = 有一个描述文件被碰了 → 必须全量重算
     */
    public static boolean descriptorsTouched(Set<String> changedRel) {
        if (changedRel == null || changedRel.isEmpty()) {
            // 没报差异 = 「客户端说没变」。这与「客户端失联」是两件事，
            // 调用方必须先判过非空才可能问出这个问题；空集走到这里就按「有描述文件动过」处理，
            // 宁可多扫一次，也不要在「说不清为什么没变」的情况下沿用旧结论。
            return true;
        }
        for (String rel : changedRel) {
            if (rel == null || rel.isBlank()) continue;
            String name = rel.substring(rel.lastIndexOf('/') + 1);
            if (isDescriptor(name, name.toLowerCase(Locale.ROOT))) {
                return true;
            }
        }
        return false;
    }

    /**
     * 能沿用的块。<b>只有这五个</b>；{@code code} 与 {@code services} 永远重算
     * —— 后者由 deploy + code 摊平而来，前者读的是全仓 .java。
     */
    public static final String[] REUSABLE_BLOCKS = {"build", "config", "deploy", "frontend", "techStack"};

    /**
     * 这次能不能增量。三个条件缺一不可，缺任何一条都老实全量。
     *
     * @param prevFacts  上一份 facts（null / 结构不对 = 没有可沿用的）
     * @param changedRel 变更文件相对路径，增删改都在内
     * @param sameRoot   两份 facts 的 root 是否一致（不一致说明不是同一个项目）
     */
    public static boolean usable(JsonNode prevFacts, Set<String> changedRel, boolean sameRoot) {
        if (prevFacts == null || !prevFacts.isObject() || !sameRoot) return false;
        for (String block : REUSABLE_BLOCKS) {
            if (!prevFacts.has(block)) return false; // 少一块就整份不用 —— 半份沿用比全量更难查
        }
        return !descriptorsTouched(changedRel);
    }

    /**
     * 把可沿用的五个块从上��份搬进新 facts。**深拷贝交给 Jackson**
     * （{@code set} 的是同一个节点时，两份 facts 会共享子树；下一次谁改了它，另一份跟着变 ——
     * 那种 bug 只在「复用之后再跑一次」时显形，极难定位）。
     *
     * @return 实际沿用了几个块
     */
    public static int reuseBlocks(JsonNode prevFacts, ObjectNode into,
            tools.jackson.databind.ObjectMapper mapper) {
        if (prevFacts == null || into == null) return 0;
        int n = 0;
        for (String block : REUSABLE_BLOCKS) {
            JsonNode src = prevFacts.get(block);
            if (src == null) continue;
            into.set(block, src.deepCopy());
            n++;
        }
        return n;
    }
}
