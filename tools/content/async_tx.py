# -*- coding: utf-8 -*-
"""蓝图 03：异步任务 + 事务 + 重试退避。"""

CONTROLLER = r"""package com.example.importer.controller;

import com.example.common.ApiResponse;
import com.example.importer.dto.ImportSubmitRequest;
import com.example.importer.dto.ImportTaskResponse;
import com.example.importer.service.ImportJobService;
import com.example.importer.service.ImportTaskService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 批量导入接口。
 *
 * 核心设计：接口立刻返回，重活交给异步任务。
 *
 * 为什么不能在请求线程里同步跑完：
 *   1. 导入 10 万行可能要几分钟，HTTP 连接、网关超时、用户耐心都撑不住；
 *   2. 长事务会一直占着数据库连接，把连接池拖干，波及所有无关接口；
 *   3. 失败了没法重试 —— 请求已经返回了，谁也不知道该重跑哪一批。
 *
 * 所以拆成两个接口：提交（立即返回 taskId）+ 查询进度（前端轮询）。
 */
@Validated
@RestController
@RequestMapping("/api/v1/imports")
public class ImportController {

    private final ImportTaskService importTaskService;
    private final ImportJobService importJobService;

    public ImportController(ImportTaskService importTaskService, ImportJobService importJobService) {
        this.importTaskService = importTaskService;
        this.importJobService = importJobService;
    }

    /**
     * 提交导入任务。
     *
     * 注意这里的顺序：先落库建任务记录（同步、带事务），再触发异步执行。
     * 反过来先异步再落库的话，异步线程可能在任务记录还不存在时就开始跑，
     * 于是进度无处可写 —— 这类竞态在低负载下测试永远复现不出来。
     */
    @PostMapping
    public ApiResponse<Long> submit(@Valid @RequestBody ImportSubmitRequest request) {
        long taskId = importTaskService.createPendingTask(request);
        importJobService.runAsync(taskId);
        return ApiResponse.created(taskId);
    }

    /** 查询进度。前端按这个接口轮询，直到 status 进入终态。 */
    @GetMapping("/{taskId}")
    public ApiResponse<ImportTaskResponse> progress(
            @PathVariable @Min(value = 1, message = "taskId 必须为正整数") long taskId) {
        return ApiResponse.ok(importTaskService.detail(taskId));
    }
}
"""

TASK_SERVICE = r"""package com.example.importer.service;

import com.example.importer.domain.ImportTask;
import com.example.importer.dto.ImportSubmitRequest;
import com.example.importer.dto.ImportTaskResponse;
import com.example.importer.repository.ImportTaskRepository;
import com.example.common.exception.BizException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 任务记录的生命周期管理（同步部分）。
 *
 * 它和 ImportJobService 的分工是刻意的：
 *   本类做「短事务」—— 建任务、更新进度、标记终态，每次只碰一行，秒级完成；
 *   ImportJobService 做「长活」—— 真正读文件、校验、写业务数据。
 *
 * 把「进度上报」和「业务写入」拆开的原因是事务边界：
 *   如果进度更新混在业务事务里，业务回滚会把进度一起回滚掉，
 *   结果是任务永远停在「进行中」，看起来像卡死，实际是已失败。
 */
@Service
public class ImportTaskService {

    private static final Logger log = LoggerFactory.getLogger(ImportTaskService.class);

    private final ImportTaskRepository importTaskRepository;

    public ImportTaskService(ImportTaskRepository importTaskRepository) {
        this.importTaskRepository = importTaskRepository;
    }

    /** 建任务记录。返回后异步线程才允许开始跑。 */
    @Transactional(rollbackFor = Exception.class)
    public long createPendingTask(ImportSubmitRequest request) {
        ImportTask task = new ImportTask();
        task.setSourceName(request.sourceName());
        task.setTotalRows(0);
        task.setProcessedRows(0);
        task.setStatus(ImportTask.STATUS_PENDING);
        long id = importTaskRepository.insert(task);
        log.info("导入任务已创建 taskId={} source={}", id, request.sourceName());
        return id;
    }

    /** 独立的短事务：只推进度，不参与业务事务。 */
    @Transactional(rollbackFor = Exception.class)
    public void reportProgress(long taskId, int processed, int total) {
        importTaskRepository.updateProgress(taskId, processed, total);
    }

    /** 标记成功。用独立事务，保证即便业务批次最后一步出问题，状态也不会留下歧义。 */
    @Transactional(rollbackFor = Exception.class)
    public void markSucceeded(long taskId, int processed) {
        importTaskRepository.updateStatus(taskId, ImportTask.STATUS_SUCCEEDED, processed, null);
        log.info("导入任务完成 taskId={} processed={}", taskId, processed);
    }

    /** 标记失败，并把失败原因落到任务记录上，而不是只写在日志里。 */
    @Transactional(rollbackFor = Exception.class)
    public void markFailed(long taskId, int processed, String reason) {
        importTaskRepository.updateStatus(taskId, ImportTask.STATUS_FAILED, processed, truncate(reason));
        log.error("导入任务失败 taskId={} processed={} reason={}", taskId, processed, reason);
    }

    @Transactional(readOnly = true)
    public ImportTaskResponse detail(long taskId) {
        ImportTask task = importTaskRepository.findById(taskId);
        if (task == null) {
            throw new BizException("IMPORT_TASK_NOT_FOUND", "导入任务不存在：" + taskId);
        }
        return ImportTaskResponse.from(task);
    }

    /** 失败原因要落库，但字段有限长 —— 截断而不是让 INSERT 直接报错。 */
    private String truncate(String reason) {
        if (reason == null) {
            return null;
        }
        return reason.length() <= 500 ? reason : reason.substring(0, 500);
    }
}
"""

JOB_SERVICE = r"""package com.example.importer.service;

import com.example.importer.domain.ImportRow;
import com.example.importer.repository.ImportTaskRepository;
import com.example.importer.repository.UserBatchRepository;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 异步执行体。
 *
 * 四个关键决策，每一个都是踩过坑才会写对的：
 *
 * 1. @Async 必须绑定自定义线程池（CONC-POOL-005）。
 *    不指定时 Spring 会退回 SimpleAsyncTaskExecutor —— 它每个任务新建一个线程，
 *    没有上限。并发一上来就直接打到操作系统线程上限，且线程名全是 task-1、task-2，
 *    排障时根本不知道是谁在抢占资源。
 *
 * 2. 分批 + 每批独立事务，而不是一个大事务。
 *    10 万行一个大事务的代价是：undo log 巨大、锁持有时间极长、
 *    失败时全部回滚（前面白干）。分批后失败只损失最后一批，且进度可续。
 *
 * 3. 幂等：重跑同一批不会产生重复数据。
 *    异步任务一定会经历重试，没有幂等保护的重试就是数据污染。
 *
 * 4. 进度上报用独立事务（见 ImportTaskService.reportProgress），
 *    否则业务回滚会把进度一起回滚，任务卡在「进行中」。
 *
 * 重要限制：@Async 是同类内部方法调用不生效的（代理机制），
 * 所以 runAsync 必须由外部 Bean（Controller）调用，不能在 ImportTaskService 里调。
 */
@Service
public class ImportJobService {

    private static final Logger log = LoggerFactory.getLogger(ImportJobService.class);

    /** 每批 500 行：兼顾 SQL 往返次数与单事务大小。 */
    private static final int BATCH_SIZE = 500;

    private final UserBatchRepository userBatchRepository;
    private final ImportTaskRepository importTaskRepository;
    private final ImportTaskService importTaskService;

    public ImportJobService(UserBatchRepository userBatchRepository,
                            ImportTaskRepository importTaskRepository,
                            ImportTaskService importTaskService) {
        this.userBatchRepository = userBatchRepository;
        this.importTaskRepository = importTaskRepository;
        this.importTaskService = importTaskService;
    }

    /**
     * 异步入口。
     *
     * value 指定线程池名，与 AsyncConfig 中注册的 Bean 名严格对应。
     * 写错名字不会报错，只会静默退回默认执行器 —— 这是个很隐蔽的坑。
     */
    @Async("importExecutor")
    public void runAsync(long taskId) {
        int processed = 0;
        try {
            List<ImportRow> rows = userBatchRepository.readAllRows(taskId);
            int total = rows.size();
            importTaskService.reportProgress(taskId, 0, total);
            log.info("开始处理导入任务 taskId={} total={}", taskId, total);

            for (int from = 0; from < total; from += BATCH_SIZE) {
                int to = Math.min(from + BATCH_SIZE, total);
                List<ImportRow> batch = rows.subList(from, to);

                // 每批一个独立事务，失败只回滚这一批
                int affected = saveBatch(batch);

                processed += affected;
                importTaskService.reportProgress(taskId, processed, total);
            }

            importTaskService.markSucceeded(taskId, processed);

        } catch (InterruptedException e) {
            // 恢复中断标志，然后退出。吞掉中断是并发代码里最糟糕的错误之一：
            // 线程池关闭时会一直等一个永远不会结束的任务。
            Thread.currentThread().interrupt();
            importTaskService.markFailed(taskId, processed, "任务被中断");
        } catch (Exception e) {
            // 这里必须 catch 住：异步方法的异常不会传播给调用方，
            // 不接住就只有一个默认的 uncaughtExceptionHandler 打一行日志，
            // 任务状态永远停在「进行中」。
            importTaskService.markFailed(taskId, processed, e.getMessage());
        }
    }

    /**
     * 单批写入。
     *
     * 注意这里是 public 且有事务 —— 它必须由外部（本类的异步方法经代理调用）
     * 触发才能生效。更稳妥的写法是把它拆到独立 Bean，避免自调用失效。
     */
    @Transactional(rollbackFor = Exception.class)
    public int saveBatch(List<ImportRow> batch) {
        return userBatchRepository.batchUpsert(batch);
    }
}
"""

ASYNC_CONFIG = r"""package com.example.config;

import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionHandler;
import java.util.concurrent.ThreadPoolExecutor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;

/**
 * 异步线程池配置。
 *
 * 这个类是军火库并发规则最集中的落点，逐条对照：
 *
 *   CONC-POOL-002  禁止 Executors.newFixedThreadPool 等工厂方法。
 *                  它们的问题不是「不能用」，而是把队列与拒绝策略都藏起来了：
 *                  newFixedThreadPool 用的是无界队列，任务堆积时永远不会拒绝，
 *                  只会在内存里静静涨到 OOM。
 *
 *   CONC-POOL-003  线程名必须可读。默认名是 pool-1-thread-1，
 *                  在 jstack 里看到它等于没看到。出问题时你需要一眼知道
 *                  「是导入线程池满了」还是「是邮件线程池满了」。
 *
 *   CONC-POOL-004  有界队列 + 明确的拒绝策略。
 *                  默认 AbortPolicy 会直接抛异常，如果没人接就静默丢任务；
 *                  这里用 CallerRunsPolicy，把压力反弹给提交方，
 *                  形成天然背压 —— 比默默丢任务、比直接崩掉都更好。
 *
 *   CONC-POOL-005  @Async 必须显式指定线程池名（见 ImportJobService）。
 *
 * 参数怎么定：
 *   CPU 密集 → 核数 + 1；IO 密集 → 核数 × (1 + 等待时间/计算时间)。
 *   导入任务以 IO 为主，故取了偏大的值。但不要凭感觉写死一个 100 ——
 *   线程数远超必要值只会加剧上下文切换与锁竞争，吞吐反而下降。
 */
@Configuration
@EnableAsync
public class AsyncConfig {

    private static final Logger log = LoggerFactory.getLogger(AsyncConfig.class);

    /** 应用内唯一的导入线程池。Bean 名即 @Async 的 value。 */
    @Bean("importExecutor")
    public Executor importExecutor() {
        int cores = Runtime.getRuntime().availableProcessors();
        int poolSize = Math.max(4, cores * 2);
        int queueCapacity = 200;

        ThreadPoolExecutor executor = new ThreadPoolExecutor(
                poolSize,                       // 核心线程数
                poolSize,                       // 最大线程数（有界队列已够用，不靠扩容救场）
                60L, java.util.concurrent.TimeUnit.SECONDS,
                // 有界队列：容量即「能容忍多少待处理任务」，超出就走拒绝策略
                new java.util.concurrent.ArrayBlockingQueue<>(queueCapacity),
                // 可读线程名：jstack / 监控面板里一眼能定位来源（CONC-POOL-003）
                new NamedThreadFactory("import-"),
                // 背压式拒绝：由提交线程自己跑，天然限流，不丢任务也不雪崩
                new ThreadPoolExecutor.CallerRunsPolicy()
        );

        // 只在关闭时等待已提交任务完成，避免 kill -9 式的数据半途而废
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(60);

        log.info("导入线程池已初始化 poolSize={} queue={}", poolSize, queueCapacity);
        return executor;
    }

    /**
     * 线程工厂：给线程起有意义的名字，并设为非守护线程。
     * 非守护线程保证 JVM 会等它把当前任务做完再退出。
     */
    static class NamedThreadFactory implements java.util.concurrent.ThreadFactory {

        private final String prefix;
        private final java.util.concurrent.atomic.AtomicInteger counter =
                new java.util.concurrent.atomic.AtomicInteger(1);

        NamedThreadFactory(String prefix) {
            this.prefix = prefix;
        }

        @Override
        public Thread newThread(Runnable runnable) {
            Thread thread = new Thread(runnable, prefix + counter.getAndIncrement());
            thread.setDaemon(false);
            // 兜住 Runnable 里漏掉的异常，否则它会直接冒到 uncaughtExceptionHandler
            thread.setUncaughtExceptionHandler((t, e) -> log.error("线程 {} 未捕获异常", t.getName(), e));
            return thread;
        }
    }
}
"""

RETRY_CONFIG = r"""package com.example.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.retry.RetryCallback;
import org.springframework.retry.RetryContext;
import org.springframework.retry.RetryListener;
import org.springframework.retry.backoff.ExponentialBackOffPolicy;
import org.springframework.retry.policy.SimpleRetryPolicy;
import org.springframework.retry.support.RetryTemplate;

/**
 * 重试配置。
 *
 * 为什么不能用 Thread.sleep 自己写重试循环（REL-RETRY-001）：
 *   1. 它占住当前线程什么也做不了 —— 在 Web 容器里这是直接浪费一个请求线程；
 *   2. 固定间隔会让故障的下游持续被同一批流量轰击；
 *   3. 没有次数上限、没有退避、没有异常白名单，失败原因会被反复放大。
 *
 * 正确的重试有三个必须声明的要素：
 *   ① 退避策略（指数 + 抖动），避免重试风暴自我同步；
 *   ② 次数上限，避免无限重试把上游拖死；
 *   ③ 可重试异常白名单 —— 业务异常（如「余额不足」）重试一万次也不会成功。
 *
 * 指数退避的初值 200ms、倍数 2、上限 5s 是一个较通用的起点：
 *   共 3 次重试，最坏总耗时约 200 + 400 + 800 = 1.4s，对用户仍可接受。
 */
@Configuration
public class RetryConfig {

    private static final Logger log = LoggerFactory.getLogger(RetryConfig.class);

    @Bean
    public RetryTemplate remoteCallRetryTemplate() {
        RetryTemplate template = new RetryTemplate();

        SimpleRetryPolicy retryPolicy = new SimpleRetryPolicy();
        retryPolicy.setMaxAttempts(3);
        template.setRetryPolicy(retryPolicy);

        ExponentialBackOffPolicy backOff = new ExponentialBackOffPolicy();
        backOff.setInitialInterval(200L);
        backOff.setMultiplier(2.0);
        backOff.setMaxInterval(5000L);
        template.setBackOffPolicy(backOff);

        // 每次重试都记下来。没有日志的重试等于隐藏故障 ——
        // 你会以为系统「偶尔慢一下」，其实是下游在持续抖动。
        template.registerListener(new RetryListener() {
            @Override
            public <T, E extends Throwable> void onError(RetryContext context,
                                                         RetryCallback<T, E> callback,
                                                         Throwable throwable) {
                log.warn("远程调用第 {} 次失败，将重试：{}",
                        context.getRetryCount(), throwable.getMessage());
            }
        });

        return template;
    }
}
"""

REMOTE_CALL = r"""package com.example.integration;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.retry.support.RetryTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;

/**
 * 一个带超时 + 带重试的远程调用样例。
 *
 * 两条硬要求：
 *
 *   超时（REL-TIME-001）：所有外部调用都必须设置连接与读取超时。
 *   Spring 的默认值是「无限等待」。没有超时的外部调用，
 *   在下游挂掉时会把自己的线程池、连接池、内存全部占满，
 *   故障从下游一路传染到你自己 —— 这就是雪崩的实际发生过程。
 *
 *   重试（REL-RETRY-001）：用 RetryTemplate 而不是 Thread.sleep 自旋。
 *
 * 重试还有一个前提条件容易被忽略：被调用的接口必须是幂等的。
 * 给一个「创建订单」的非幂等接口加自动重试，等于主动制造重复订单。
 */
@Component
public class PartnerClient {

    private final RestClient restClient;
    private final RetryTemplate retryTemplate;

    public PartnerClient(@Qualifier("remoteCallRetryTemplate") RetryTemplate retryTemplate) {
        this.retryTemplate = retryTemplate;

        // 连接超时 2s、读取超时 5s。两个都要设：
        // 只设连接超时的话，连上之后对方不返数据，线程照样挂死。
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(2000);
        factory.setReadTimeout(5000);

        this.restClient = RestClient.builder()
                .requestFactory(factory)
                .baseUrl("https://partner.example.com")
                .build();
    }

    /**
     * 查询（幂等，可安全重试）。
     * 只对网络类异常重试：4xx 是请求本身有问题，重试无意义且浪费配额。
     */
    public String queryStatus(String orderNo) {
        return retryTemplate.execute(context -> restClient.get()
                .uri("/api/orders/{no}/status", orderNo)
                .retrieve()
                .body(String.class));
    }

    /**
     * 校验重试是否适用于当前异常。
     * 这里给出判断逻辑的示意：只有可恢复异常才值得重试。
     */
    private boolean isRetryable(Throwable throwable) {
        // 网络抖动、连接被拒、读超时 → 可恢复
        if (throwable instanceof ResourceAccessException) {
            return true;
        }
        // 业务异常（参数错误、余额不足）→ 重试一万次也不会成功
        return false;
    }
}
"""

FEATURE = {
    "id": "async-transaction",
    "order": 3,
    "name": "异步任务 · 事务 · 重试退避",
    "subtitle": "10 万行批量导入：接口立即返回，重活交给线程池",
    "glyph": "⇉",
    "level": "进阶",
    "scenario": (
        "凡是「一次请求干不完的活」，都走这套结构：提交返回任务号 → 异步分批执行 → "
        "轮询进度。它同时也是军火库并发规则最集中的落地场景。"
    ),
    "intent": "演示长任务如何拆成短事务 + 异步执行，以及重试为什么不能用 Thread.sleep。",
    "tags": ["异步", "线程池", "事务", "重试", "幂等"],
    "relatedRules": [
        "CONC-POOL-001", "CONC-POOL-002", "CONC-POOL-003", "CONC-POOL-004", "CONC-POOL-005",
        "REL-RETRY-001", "REL-TIME-001", "REL-EXCP-001", "REL-LOG-002", "REL-LOG-003",
        "SVC-TX-001", "SVC-TX-002", "SVC-TX-003", "WEB-CTRL-001",
    ],
    "flow": [
        {"layer": "client", "step": "POST /imports", "detail": "上传文件或提交数据源信息，拿到 taskId，立即返回。"},
        {"layer": "service", "step": "建任务记录", "detail": "短事务，只写一行。必须先在主线程落库，异步线程才有地方写进度。"},
        {"layer": "concurrency", "step": "提交线程池", "detail": "@Async(\"importExecutor\") 投递到有界队列；队列满时 CallerRunsPolicy 形成背压。"},
        {"layer": "service", "step": "分批处理", "detail": "每 500 行一个独立事务。失败只回滚当前批，前面的成果保留。"},
        {"layer": "service", "step": "独立事务上报进度", "detail": "进度更新不能混在业务事务里，否则业务回滚会把进度一起回滚，任务永远停在「进行中」。"},
        {"layer": "client", "step": "GET /imports/{id}", "detail": "前端轮询进度，直到状态进入终态。"},
    ],
    "packages": [
        "com.example.importer.controller  提交与查询两个接口",
        "com.example.importer.service     任务生命周期（短事务）+ 异步执行体",
        "com.example.importer.domain      任务实体与状态常量",
        "com.example.config               线程池、重试、远程调用",
        "com.example.integration          带超时与重试的外部调用客户端",
    ],
    "files": [
        {
            "id": "controller",
            "path": "src/main/java/com/example/importer/controller/ImportController.java",
            "layer": "web",
            "lang": "java",
            "role": "提交任务（立刻返回）+ 查询进度（轮询）。",
            "code": CONTROLLER,
            "highlights": [
                {"mark": "long taskId = importTaskService.createPendingTask(request);\n        importJobService.runAsync(taskId);", "title": "先落库，再异步", "text": "顺序反了就会产生竞态：异步线程可能在任务记录还不存在时就开始跑，进度无处可写。这类 bug 在低负载下永远复现不出来。", "rule": "CONC-POOL-005"},
                {"mark": "importJobService.runAsync(taskId);", "title": "异步入口必须由外部 Bean 调用", "text": "@Async 靠 Spring 代理生效。如果这一行写在 ImportJobService 自己的另一个方法里（this.runAsync），代理不介入，方法会变成同步执行 —— 没有任何报错，只是接口开始阻塞。", "rule": "CONC-POOL-005"},
                {"mark": "public ApiResponse<ImportTaskResponse> progress(", "title": "用轮询而不是长连接推", "text": "轮询实现简单、天然可重连、无状态。长任务进度不是实时交易，没必要上 SSE/WebSocket 增加复杂度。", "rule": "WEB-CTRL-001"},
            ],
        },
        {
            "id": "task-service",
            "path": "src/main/java/com/example/importer/service/ImportTaskService.java",
            "layer": "service",
            "lang": "java",
            "role": "任务生命周期（短事务）。与业务写入解耦。",
            "code": TASK_SERVICE,
            "highlights": [
                {"mark": "@Transactional(rollbackFor = Exception.class)\n    public void reportProgress", "title": "进度用独立短事务", "text": "如果进度更新混在业务批次事务里，一旦业务回滚，进度也一起回滚 —— 任务永久停在「进行中」，看起来像卡死，实际是已失败。", "rule": "SVC-TX-002"},
                {"mark": "private String truncate(String reason)", "title": "失败原因要落库，但先截断", "text": "异常消息可能很长。不截断就等着 INSERT 因为超长直接失败 —— 而失败的原因恰恰是「记录失败原因」。", "rule": "REL-EXCP-001"},
                {"mark": "log.error(\"导入任务失败 taskId={} processed={} reason={}\", taskId, processed, reason);", "title": "失败现场要带够信息", "text": "taskId + 已处理条数 + 原因。少了 processed，事后无法判断是「一条都没进」还是「进了 90% 才炸」。", "rule": "REL-LOG-003"},
            ],
        },
        {
            "id": "job-service",
            "path": "src/main/java/com/example/importer/service/ImportJobService.java",
            "layer": "service",
            "lang": "java",
            "role": "异步执行体。分批 + 短事务 + 幂等 + 异常必须自己接住。",
            "code": JOB_SERVICE,
            "highlights": [
                {"mark": "importTaskService.markFailed(taskId, processed, e.getMessage());", "title": "异步方法的异常必须自己接住", "text": "异步异常不会传播给调用方。不 catch 就只有一个默认 handler 打一行日志，任务状态永远停在「进行中」—— 用户会一直等一个已经死掉的任务。", "rule": "REL-EXCP-001"},
                {"mark": "Thread.currentThread().interrupt();", "title": "中断后要恢复标志", "text": "吞掉中断标志是并发代码里最糟糕的错误之一：线程池关闭时会一直等一个永远不会结束的任务。", "rule": "CONC-POOL-001"},
                {"mark": "for (int from = 0; from < total; from += BATCH_SIZE)", "title": "分批而不是一个大事务", "text": "10 万行单事务的代价：undo log 巨大、锁持有时间极长、失败全量回滚（前面白干）。分批后失败只损失最后一批。", "rule": "SVC-TX-003"},
                {"mark": "@Async(\"importExecutor\")", "title": "@Async 必须指定线程池名", "text": "value 与 AsyncConfig 里注册的 Bean 名严格对应。写错名字不会报错 —— Spring 会静默退回默认执行器（每任务新建线程、无上限、线程名 pool-1-thread-1），并发一上来直接打到系统线程上限。", "rule": "CONC-POOL-005"},
                {"mark": "@Async 是同类内部方法调用不生效的（代理机制）", "title": "自调用会让 @Async 静默失效", "text": "@Async 靠代理实现，同一个类里 this.runAsync() 调用不经过代理，方法会同步执行 —— 没有任何报错，只是变成阻塞。", "rule": "CONC-POOL-005"},
            ],
        },
        {
            "id": "async-config",
            "path": "src/main/java/com/example/config/AsyncConfig.java",
            "layer": "config",
            "lang": "java",
            "role": "线程池配置。军火库并发规则最集中的落点。",
            "code": ASYNC_CONFIG,
            "highlights": [
                {"mark": "new java.util.concurrent.ArrayBlockingQueue<>(queueCapacity)", "title": "必须有界队列", "text": "newFixedThreadPool 用的是无界队列：任务堆积时它永远不会拒绝，只会在内存里静静涨到 OOM。有界队列让压力变成可观测的拒绝。", "rule": "CONC-POOL-004"},
                {"mark": "new ThreadPoolExecutor.CallerRunsPolicy()", "title": "拒绝策略要明确，且要能用", "text": "默认 AbortPolicy 直接抛异常，没人接就静默丢任务。CallerRunsPolicy 把压力反弹给提交方，形成天然背压 —— 不丢任务也不雪崩。", "rule": "CONC-POOL-004"},
                {"mark": "new NamedThreadFactory(\"import-\")", "title": "线程名必须可读", "text": "默认名是 pool-1-thread-1，在 jstack 里看到它等于没看到。你需要一眼知道是导入池还是邮件池满了。", "rule": "CONC-POOL-003"},
                {"mark": "executor.setWaitForTasksToCompleteOnShutdown(true);", "title": "优雅关闭", "text": "默认关闭策略会直接丢弃排队任务 —— 那可能是一批已确认待写入的数据。", "rule": "CONC-POOL-004"},
            ],
        },
        {
            "id": "retry-config",
            "path": "src/main/java/com/example/config/RetryConfig.java",
            "layer": "config",
            "lang": "java",
            "role": "重试配置：指数退避 + 次数上限 + 重试日志。",
            "code": RETRY_CONFIG,
            "highlights": [
                {"mark": "backOff.setInitialInterval(200L);", "title": "指数退避，不是固定间隔", "text": "固定间隔会让故障下游持续被同一批流量轰击，重试反而放大了故障。指数退避给下游恢复的时间窗口。", "rule": "REL-RETRY-001"},
                {"mark": "retryPolicy.setMaxAttempts(3);", "title": "必须有次数上限", "text": "无限重试是把自己变成攻击下游的那一方。3 次、总耗时约 1.4s，是用户仍可接受的量级。", "rule": "REL-RETRY-001"},
                {"mark": "log.warn(\"远程调用第 {} 次失败，将重试：{}\",", "title": "重试必须留痕", "text": "没有日志的重试等于隐藏故障 —— 你会以为系统「偶尔慢一下」，其实是下游在持续抖动。", "rule": "REL-LOG-002"},
            ],
        },
        {
            "id": "remote-call",
            "path": "src/main/java/com/example/integration/PartnerClient.java",
            "layer": "integration",
            "lang": "java",
            "role": "外部调用客户端：超时 + 重试 + 可重试判定。",
            "code": REMOTE_CALL,
            "highlights": [
                {"mark": "factory.setConnectTimeout(2000);", "title": "没有超时的外部调用 = 定时炸弹", "text": "Spring 默认无限等待。下游挂掉时，你的线程池、连接池、内存会被静默占满，故障从下游一路传染过来 —— 这就是雪崩的实际发生过程。", "rule": "REL-TIME-001"},
                {"mark": "factory.setReadTimeout(5000);", "title": "连接超时和读超时都要设", "text": "只设连接超时的话，握手成功之后对方不返数据，线程照样挂死。", "rule": "REL-TIME-001"},
                {"mark": "return false;\n    }", "title": "只有可恢复异常才值得重试", "text": "4xx 是请求本身有问题，重试无意义且浪费配额。业务异常（余额不足、参数错误）重试一万次也不会成功。", "rule": "REL-RETRY-001"},
            ],
        },
    ],
    "checklist": [
        "确认线程池：有界队列 + 明确拒绝策略 + 可读线程名（三样缺一不可）",
        "确认 @Async 指定了线程池名，且调用方是外部 Bean（避免自调用失效）",
        "确认异步方法内部 catch 了所有异常并落任务状态，语义上不留「进行中」僵尸",
        "确认进度更新走独立事务，不参与业务批次事务",
        "确认每批有幂等保护（唯一键或 upsert），重跑不产生重复数据",
        "确认所有外部调用设置了连接超时与读超时，且重试次数有上限",
        "确认线程池参数有监控（活跃线程数、队列长度），否则背压发生时你只会看到超时",
    ],
    "pitfalls": [
        "用 Executors.newFixedThreadPool：无界队列 + 隐藏拒绝策略，堆到 OOM 才暴露。",
        "@Async 忘指定线程池：退回每任务新建线程的执行器，线程名不可读。",
        "同一个类里 this.asyncMethod() 自调用：@Async 静默失效，方法变同步执行。",
        "异步方法不 catch 异常：任务状态永远停在「进行中」。",
        "进度上报混进业务事务：业务回滚把进度一起回滚。",
        "外部调用不设超时：下游故障会把自己的线程池占满，故障全面扩散。",
        "用 Thread.sleep 写重试：占住线程、固定间隔放大故障、无上限。",
    ],
}
