package com.arsenal.qa;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 一次深检作业的状态。
 *
 * <p>状态机：{@code PENDING → (CLONING → SCANNING → ANALYZING → AGGREGATING 逐段打点) → DONE / FAILED}。
 * 进度条靠「当前 phase + 各 phase 完成时刻」就能画 —— 不做心跳、不做租约，
 * 单机内存队列 + 落盘已覆盖「提交→轮询→重启后可查」的全部需求（00-计划书 1.2-①）。
 *
 * <p>重启恢复：内存里没有、磁盘上 status 仍是 PENDING/RUNNING 的 job，由 {@link QaService}
 * 启动时改写成 {@code FAILED: 服务重启，作业中断} —— 假装它还在跑是最坏的写法。
 */
public final class QaJob {

    public static final java.util.List<String> PHASES = java.util.List.of(
            "CLONING", "SCANNING", "ANALYZING", "AGGREGATING");
    public static final String PENDING = "PENDING";
    public static final String RUNNING = "RUNNING";
    public static final String DONE = "DONE";
    public static final String FAILED = "FAILED";

    private final String id;
    private final String projectId;
    private final String kind;
    private final String ref;
    private final QaRange range;
    private final boolean deepCheck;
    private final long createdAt = System.currentTimeMillis();

    private volatile String status = PENDING;
    private volatile String phase = null;
    private volatile String error = null;
    /** phase → 完成时刻（ISO）。只增不改，序列化即所得。 */
    private final Map<String, String> phaseAt = new LinkedHashMap<>();

    public QaJob(String id, String projectId, String kind, String ref, QaRange range, boolean deepCheck) {
        this.id = id;
        this.projectId = projectId;
        this.kind = kind;
        this.ref = ref;
        this.range = range;
        this.deepCheck = deepCheck;
    }

    /** 历史恢复用：保留原 status/phase/时间，由 {@link #abandonIfStale()} 处理卡死的。 */
    QaJob(JsonNode n) {
        this.id = n.path("jobId").asText("");
        this.projectId = n.path("projectId").asText("");
        this.kind = n.path("source").path("kind").asText("");
        this.ref = n.path("source").path("value").asText("");
        this.range = QaRange.fromJson(n.get("range"));
        this.deepCheck = n.path("deepCheck").asBoolean(false);
        this.status = n.path("status").asText(PENDING);
        this.phase = n.path("phase").asText("");
        if (this.phase.isEmpty()) {
            this.phase = null;
        }
        this.error = n.path("error").asText("");
    }

    // ── 状态迁移（worker 线程专用） ──

    void enterPhase(String p) {
        this.status = RUNNING;
        this.phase = p;
    }

    void markPhaseDone(String p) {
        phaseAt.put(p, Instant.now().toString());
    }

    void succeed() {
        this.phase = null;
        this.status = DONE;
    }

    void fail(String message) {
        this.error = message == null || message.isBlank() ? "未知错误" : message;
        this.status = FAILED;
    }

    /** 重启时还挂着 PENDING/RUNNING 的旧 job：判死，别装活。 */
    boolean abandonIfStale() {
        if (PENDING.equals(status) || RUNNING.equals(status)) {
            fail("服务重启，作业中断");
            return true;
        }
        return false;
    }

    // ── 读 ──

    public String id() {
        return id;
    }

    public String projectId() {
        return projectId;
    }

    public String status() {
        return status;
    }

    public QaRange range() {
        return range;
    }

    public String kind() {
        return kind;
    }

    public String ref() {
        return ref;
    }

    public boolean deepCheck() {
        return deepCheck;
    }

    public boolean finished() {
        return DONE.equals(status) || FAILED.equals(status);
    }

    // ── 序列化 ──

    public ObjectNode toNode(ObjectNode n) {
        n.put("jobId", id);
        n.put("projectId", projectId);
        n.put("status", status);
        n.put("phase", phase == null ? "" : phase);
        n.put("error", error == null ? "" : error);
        n.put("deepCheck", deepCheck);
        n.put("createdAt", Instant.ofEpochMilli(createdAt).toString());
        ObjectNode source = n.putObject("source");
        source.put("kind", kind);
        source.put("value", ref);
        range.writeInto(n.putObject("range"));
        ObjectNode phases = n.putObject("phases");
        for (String p : PHASES) {
            String state;
            if (phaseAt.containsKey(p)) {
                state = "done";
            } else if (p.equals(phase)) {
                state = FAILED.equals(status) ? "failed" : "running";
            } else {
                state = "pending";
            }
            phases.put(p, state);
        }
        ObjectNode at = n.putObject("phaseAt");
        phaseAt.forEach(at::put);
        return n;
    }
}
