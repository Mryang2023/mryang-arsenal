package com.arsenal.scan;

/** 一个扫到的依赖坐标。带来源位置 —— 图上的每个节点都要能追到哪一行写的。 */
public record ScannedDep(
        String kind,
        String group,
        String artifact,
        String version,
        String scope,
        /** 相对根目录的路径 */
        String path,
        int line
) {
}
