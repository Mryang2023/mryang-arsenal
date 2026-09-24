package com.arsenal.cases;

/**
 * 一个待编译的源文件。
 *
 * <p>{@code path} 是相对 src 根的路径，例如 {@code com/arsenal/cases/vt/Service.java}，
 * 服务会据此创建嵌套目录。必须是 .java 后缀，且不得包含 {@code ..} 或绝对路径。
 */
public class SourceFile {

    /** 相对路径，含包目录。 */
    private String path;

    /** 完整源码文本（UTF-8）。 */
    private String code;

    public SourceFile() {
    }

    public SourceFile(String path, String code) {
        this.path = path;
        this.code = code;
    }

    public String getPath() {
        return path;
    }

    public void setPath(String path) {
        this.path = path;
    }

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }
}
