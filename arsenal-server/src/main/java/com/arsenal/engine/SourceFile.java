package com.arsenal.engine;

/**
 * 待校验的源文件。name 用于匹配规则的 targetGlob，所以路径要尽量真实 ——
 * 填 `UserController.java` 和填完整包路径，匹配到的规则数量会差很多。
 */
public record SourceFile(String name, String content) {

    public SourceFile {
        if (name == null || name.isBlank()) {
            name = "untitled.java";
        }
        if (content == null) {
            content = "";
        }
    }

    public int byteSize() {
        return content.getBytes(java.nio.charset.StandardCharsets.UTF_8).length;
    }

    public int lineCount() {
        return content.isEmpty() ? 0 : (int) content.chars().filter(ch -> ch == '\n').count() + 1;
    }
}
