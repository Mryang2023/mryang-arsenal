package com.arsenal.scan;

import com.arsenal.engine.GlobMatcher;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * 扫描忽略规则的分支级护栏（ROADMAP N5）。
 *
 * 实测来源：真实项目 command-center-backend 的 QA 报告里，.wb-tmp/ 贡献了 22 条
 * 假 finding、根目录 SmokeCcgp.java 贡献 6 条 —— 这些文件位置本身就说明是噪音，
 * 不该进报告消耗人的注意力。本测试把它们的位置口径钉死，谁改谁红。
 */
class ScanGuardIgnoreTest {

    @Test
    void wbTmpDirectoryIsSkippedEntirely() {
        assertTrue(ScanGuard.skipDir(".wb-tmp"), ".wb-tmp 整棵跳过");
        assertTrue(ScanGuard.skipDir(".Wb-TMP"), "目录名判定不分大小写（与既有 SKIP_DIRS 口径一致）");
        assertFalse(ScanGuard.skipDir("wb-tmp"), "没有点的同名目录不受影响");
    }

    @Test
    void rootSmokeScriptsIgnoredButNotNestedOnes() {
        assertTrue(ScanGuard.ignoreFile("SmokeCcgp.java"), "仓库根的 Smoke*.java 是手工冒烟脚本");
        assertTrue(ScanGuard.ignoreFile("SmokeTest.java"));
        assertFalse(ScanGuard.ignoreFile("src/SmokeFoo.java"),
                "src 下的 Smoke 开头可能是受测类 —— 只拦根目录，不许误伤");
        assertFalse(ScanGuard.ignoreFile("src/main/java/com/demo/Smoke.java"));
        assertFalse(ScanGuard.ignoreFile("Main.java"), "普通根目录源码不受影响");
    }

    @Test
    void minifiedArtifactsIgnored() {
        assertTrue(ScanGuard.ignoreFile("static/app.min.js"));
        assertTrue(ScanGuard.ignoreFile("style.min.css"));
        assertFalse(ScanGuard.ignoreFile("app.js"));
        assertFalse(ScanGuard.ignoreFile("src/app.minjs"), "后缀必须整段匹配，不是 contains");
    }

    @Test
    void nullAndEmptyRelPathsAreJustNotIgnored() {
        assertFalse(ScanGuard.ignoreFile(null));
        assertFalse(ScanGuard.ignoreFile(""));
    }

    @Test
    void configuredGlobsExtendTheBuiltinIgnore() {
        List<GlobMatcher> globs = GlobMatcher.listOf(" **/generated/** , **/vendor-*.js ,");
        assertEquals(2, globs.size(), "空段与首尾空白都要剔掉（串里就两个 glob）");
        assertTrue(globs.get(0).matches("src/main/generated/X.java"), "**/ 允许任意层（含零层）");
        assertTrue(globs.get(1).matches("lib/vendor-jquery.js"));
        assertFalse(globs.get(1).matches("lib/jquery.js"));
        // 口径钉死：ignore-globs 与规则 targetGlob 同一 glob 方言 —— 裸 `*` 只匹配单层，
        // 跨目录要写 `**/` 前缀。改这条语义会连带改规则匹配，必须三思。
        GlobMatcher bare = GlobMatcher.compile("vendor-*.js");
        assertTrue(bare.matches("vendor-jquery.js"), "裸 glob 只匹配仓库根的同名单层文件");
        assertFalse(bare.matches("lib/vendor-jquery.js"), "裸 glob 不跨目录 —— 跨目录必须写 **/");

        assertTrue(GlobMatcher.listOf(null).isEmpty(), "null 配置 = 无追加规则");
        assertTrue(GlobMatcher.listOf("").isEmpty());
        assertTrue(GlobMatcher.listOf(" , , ").isEmpty(), "全空段 = 无追加规则，不能塞进空 glob 误伤全仓");
    }
}
