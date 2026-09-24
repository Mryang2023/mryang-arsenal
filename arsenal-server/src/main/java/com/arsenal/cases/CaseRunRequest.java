package com.arsenal.cases;

import java.util.List;

/**
 * 运行一次案例代码的请求体。
 *
 * <p>示例：
 * <pre>{@code
 * {
 *   "files": [
 *     {"path": "demo/Main.java",
 *      "code": "package demo;\npublic class Main{public static void main(String[]a){System.out.println(\"hi\");}}"}
 *   ],
 *   "mainClass": "demo.Main",
 *   "args": [],
 *   "timeoutMs": 30000
 * }
 * }</pre>
 */
public class CaseRunRequest {

    /** 源文件列表（至少一个）。 */
    private List<SourceFile> files;

    /** 入口类的完全限定名，例如 demo.Main。 */
    private String mainClass;

    /** 传给 main 的参数，可空。 */
    private List<String> args;

    /** 单此运行超时（毫秒），可空，服务端会夹在 [1000, 300000] 之间。 */
    private Integer timeoutMs;

    public List<SourceFile> getFiles() {
        return files;
    }

    public void setFiles(List<SourceFile> files) {
        this.files = files;
    }

    public String getMainClass() {
        return mainClass;
    }

    public void setMainClass(String mainClass) {
        this.mainClass = mainClass;
    }

    public List<String> getArgs() {
        return args;
    }

    public void setArgs(List<String> args) {
        this.args = args;
    }

    public Integer getTimeoutMs() {
        return timeoutMs;
    }

    public void setTimeoutMs(Integer timeoutMs) {
        this.timeoutMs = timeoutMs;
    }
}
