package com.arsenal.scan;

/**
 * 一条坐标映射。{@code dim/opt} 指向架构画布的真实槽位：有它们，这个依赖才会
 * 出现在部署图上；只有 {@code tech} 的表示「认得出来但不单独部署」（工具库、编码期依赖）。
 */
public record ScanRule(
        String kind,
        String group,
        String artifact,
        String tech,
        String icon,
        String dim,
        String opt,
        String name
) {
}
