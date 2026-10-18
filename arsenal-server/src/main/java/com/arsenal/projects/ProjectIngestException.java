package com.arsenal.projects;

/** 摄取失败（限额超限 / 源头不可达 / clone 失败）。属于「调用方改一下就好的问题」，上层转 400。 */
public class ProjectIngestException extends RuntimeException {
    public ProjectIngestException(String message) {
        super(message);
    }
}
