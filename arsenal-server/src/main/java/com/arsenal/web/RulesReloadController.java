package com.arsenal.web;

import com.arsenal.loader.RuleIndex;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 规则库热重载端点（2026-10-18 质检台 Q1，B2）。
 *
 * <p>「今天规则库是这些，明天更新了，明天检查就要用新的」—— 在这之前唯一姿势是重启进程。
 * 现在改完 {@code arsenal-rules/**} 的 JSON，POST 一下这里即可，不必重启。
 *
 * <p>失败语义（与 {@link RuleIndex#refresh()} 对齐）：重载失败时服务<b>保留旧规则集</b>，
 * 本端点把失败原因原样带回去 —— 「重载没成」必须看得见，不许静默继续用旧的装作成功。
 * 响应里的 before/after 规则数与版本是「真的重读了」的自证：一个数都不变也要如实返回。
 *
 * <p>防重入：AtomicBoolean 串行化并发 POST（refresh 本身还有 synchronized 兜底）。
 */
@RestController
@RequestMapping("/api/rules")
public class RulesReloadController {

    private final RuleIndex index;
    private final AtomicBoolean reloading = new AtomicBoolean(false);

    public RulesReloadController(RuleIndex index) {
        this.index = index;
    }

    @PostMapping("/reload")
    public ApiResponse<Object> reload() {
        if (!reloading.compareAndSet(false, true)) {
            throw new IllegalStateException("上一次重载还在进行中，请稍后再试");
        }
        try {
            return ApiResponse.ok(index.refresh());
        } finally {
            reloading.set(false);
        }
    }
}
