# -*- coding: utf-8 -*-
"""选型维度 · 中间件组：缓存 / 消息队列 / 注册中心 / 调度。"""

DIMENSIONS = [
    {
        "id": "cache",
        "groupId": "middleware",
        "name": "缓存",
        "why": "本地缓存快但有一致性代价，分布式缓存一致但多一次网络往返。",
        "defaultOption": "caffeine",
        "options": [
            {
                "id": "none",
                "name": "不用缓存",
                "badge": "最小",
                "summary": "先优化 SQL 与索引。没有实测证明是瓶颈之前，缓存只会带来一致性问题。",
                "dependencies": [],
                "notes": ["「加个缓存」是很多性能问题的错误答案：缓存带来的是数据一致性的复杂度，而不是免费的加速。"],
                "pitfalls": ["在没有监控数据的情况下直接上缓存：问题被掩盖而不是被解决。"],
            },
            {
                "id": "caffeine",
                "name": "Caffeine（本地缓存）",
                "badge": "单机首选",
                "summary": "进程内缓存，纳秒级读取，无网络开销。适合字典、配置、低频变更的热点数据。",
                "dependencies": [
                    {"groupId": "com.github.ben-manes.caffeine", "artifactId": "caffeine"},
                    {"groupId": "org.springframework.boot", "artifactId": "spring-boot-starter-cache"},
                ],
                "configClasses": [
                    {
                        "className": "CacheConfig",
                        "path": "src/main/java/com/example/config/CacheConfig.java",
                        "code": (
                            "package com.example.config;\n"
                            "\n"
                            "import com.github.benmanes.caffeine.cache.Caffeine;\n"
                            "import java.time.Duration;\n"
                            "import org.springframework.cache.CacheManager;\n"
                            "import org.springframework.cache.annotation.EnableCaching;\n"
                            "import org.springframework.cache.caffeine.CaffeineCacheManager;\n"
                            "import org.springframework.context.annotation.Bean;\n"
                            "import org.springframework.context.annotation.Configuration;\n"
                            "\n"
                            "/**\n"
                            " * 本地缓存配置。\n"
                            " *\n"
                            " * 两个必须设置的参数：\n"
                            " *   maximumSize  没有上限的缓存等于内存泄漏。\n"
                            " *   expireAfterWrite  没有过期的缓存等于永久脏数据。\n"
                            " */\n"
                            "@Configuration\n"
                            "@EnableCaching\n"
                            "public class CacheConfig {\n"
                            "\n"
                            "    @Bean\n"
                            "    public CacheManager cacheManager() {\n"
                            "        CaffeineCacheManager manager = new CaffeineCacheManager();\n"
                            "        manager.setCaffeine(Caffeine.newBuilder()\n"
                            "                // 条目数上限，超出后按 W-TinyLFU 淘汰\n"
                            "                .maximumSize(10_000)\n"
                            "                // 写入后过期，防止长期持有脏数据\n"
                            "                .expireAfterWrite(Duration.ofMinutes(10))\n"
                            "                // 打开统计，用于判断命中率是否值得\n"
                            "                .recordStats());\n"
                            "        return manager;\n"
                            "    }\n"
                            "}"
                        ),
                    }
                ],
                "sample": {
                    "title": "使用方式与必须注意的失效问题",
                    "lang": "java",
                    "code": (
                        "@Service\n"
                        "public class DictService {\n"
                        "\n"
                        "    @Cacheable(cacheNames = \"dict\", key = \"#type\")\n"
                        "    public List<DictItem> listByType(String type) {\n"
                        "        return dictRepository.listByType(type);\n"
                        "    }\n"
                        "\n"
                        "    // 更新时必须清缓存，否则读到的是旧值\n"
                        "    @CacheEvict(cacheNames = \"dict\", key = \"#item.type\")\n"
                        "    public void update(DictItem item) {\n"
                        "        dictRepository.update(item);\n"
                        "    }\n"
                        "}\n"
                        "\n"
                        "// 注意：本地缓存是「每个实例一份」。\n"
                        "// 多实例部署时，A 实例清了自己的缓存，B 实例仍然是旧值。\n"
                        "// 所以本地缓存只用于「变更极少 + 容许短暂不一致」的数据。"
                    ),
                },
                "notes": [
                    "多实例下各存一份：更新后其他实例仍是旧值，直到过期。只适合容忍短暂不一致的数据。",
                    "必须设 maximumSize 与 expireAfterWrite，两个都不设等于埋了一个内存泄漏。",
                ],
                "pitfalls": [
                    "@Cacheable 加在同类内部调用的方法上：代理不生效，缓存静默失效。",
                    "缓存 null 值导致「查不到」被永久记住：要配 unless 或明确的空值策略。",
                ],
            },
            {
                "id": "redis",
                "name": "Redis（分布式缓存）",
                "badge": "主流",
                "summary": "多实例共享一份缓存，同时可兼做分布式锁、限流、会话存储、简单队列。",
                "dependencies": [
                    {"groupId": "org.springframework.boot", "artifactId": "spring-boot-starter-data-redis"},
                    {"groupId": "org.apache.commons", "artifactId": "commons-pool2",
                     "note": "使用连接池必须引入，漏了会退回无连接池模式"},
                ],
                "yaml": (
                    "spring:\n"
                    "  data:\n"
                    "    redis:\n"
                    "      host: ${REDIS_HOST:127.0.0.1}\n"
                    "      port: ${REDIS_PORT:6379}\n"
                    "      password: ${REDIS_PASSWORD}\n"
                    "      database: 0\n"
                    "      # 两处超时都必须设 —— 见下方说明\n"
                    "      connect-timeout: 2000ms\n"
                    "      timeout: 3000ms\n"
                    "      lettuce:\n"
                    "        pool:\n"
                    "          max-active: 16\n"
                    "          max-idle: 8\n"
                    "          min-idle: 2\n"
                    "          max-wait: 2000ms"
                ),
                "configClasses": [
                    {
                        "className": "RedisConfig",
                        "path": "src/main/java/com/example/config/RedisConfig.java",
                        "code": (
                            "package com.example.config;\n"
                            "\n"
                            "import com.fasterxml.jackson.annotation.JsonAutoDetect;\n"
                            "import com.fasterxml.jackson.annotation.PropertyAccessor;\n"
                            "import com.fasterxml.jackson.databind.ObjectMapper;\n"
                            "import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;\n"
                            "import org.springframework.context.annotation.Bean;\n"
                            "import org.springframework.context.annotation.Configuration;\n"
                            "import org.springframework.data.redis.connection.RedisConnectionFactory;\n"
                            "import org.springframework.data.redis.core.RedisTemplate;\n"
                            "import org.springframework.data.redis.serializer.Jackson2JsonRedisSerializer;\n"
                            "import org.springframework.data.redis.serializer.StringRedisSerializer;\n"
                            "\n"
                            "/**\n"
                            " * Redis 序列化配置。\n"
                            " *\n"
                            " * 默认的 JdkSerializationRedisSerializer 有两个致命问题：\n"
                            " *   1. 用 redis-cli 看到的是一堆二进制乱码，排障基本不可能；\n"
                            " *   2. 每个实体类都要实现 Serializable，改字段会反序列化失败。\n"
                            " * 换成 JSON 序列化后，值是可读的，也能跨语言消费。\n"
                            " */\n"
                            "@Configuration\n"
                            "public class RedisConfig {\n"
                            "\n"
                            "    @Bean\n"
                            "    public RedisTemplate<String, Object> redisTemplate(RedisConnectionFactory factory) {\n"
                            "        RedisTemplate<String, Object> template = new RedisTemplate<>();\n"
                            "        template.setConnectionFactory(factory);\n"
                            "\n"
                            "        ObjectMapper mapper = new ObjectMapper();\n"
                            "        mapper.registerModule(new JavaTimeModule());\n"
                            "        mapper.setVisibility(PropertyAccessor.ALL, JsonAutoDetect.Visibility.ANY);\n"
                            "        Jackson2JsonRedisSerializer<Object> json =\n"
                            "                new Jackson2JsonRedisSerializer<>(mapper, Object.class);\n"
                            "        StringRedisSerializer stringSerializer = new StringRedisSerializer();\n"
                            "\n"
                            "        template.setKeySerializer(stringSerializer);\n"
                            "        template.setHashKeySerializer(stringSerializer);\n"
                            "        template.setValueSerializer(json);\n"
                            "        template.setHashValueSerializer(json);\n"
                            "        template.afterPropertiesSet();\n"
                            "        return template;\n"
                            "    }\n"
                            "}"
                        ),
                    }
                ],
                "sample": {
                    "title": "Redis 不可当数据库用：超时与降级必须写",
                    "lang": "java",
                    "code": (
                        "// 正确姿态：缓存失败要能降级到查库，而不是让整个接口失败\n"
                        "public UserResponse detail(long id) {\n"
                        "    String key = \"user:\" + id;\n"
                        "    try {\n"
                        "        Object cached = redisTemplate.opsForValue().get(key);\n"
                        "        if (cached != null) {\n"
                        "            return (UserResponse) cached;\n"
                        "        }\n"
                        "    } catch (Exception e) {\n"
                        "        // 缓存不可用时只记录，不阻断主流程（但必须有日志，不能静默）\n"
                        "        log.warn(\"Redis 读取失败，降级查库 key={}\", key, e);\n"
                        "    }\n"
                        "\n"
                        "    UserResponse response = UserResponse.from(loadOrThrow(id));\n"
                        "    try {\n"
                        "        redisTemplate.opsForValue().set(key, response, Duration.ofMinutes(30));\n"
                        "    } catch (Exception e) {\n"
                        "        log.warn(\"Redis 写入失败，本次不缓存 key={}\", key, e);\n"
                        "    }\n"
                        "    return response;\n"
                        "}"
                    ),
                },
                "notes": [
                    "必须把 Redis 当「可失效的加速层」而不是数据源。Redis 挂掉时接口应当降级查库，而不是整体不可用。",
                    "超时必须设：connect-timeout 与 timeout 都要设，否则 Redis 抖动会把你的线程全部挂住。",
                    "键必须带业务前缀与冒号分隔（user:1001），否则 redis-cli 里根本分不清谁是谁。",
                    "分布式锁用 SET key value NX PX，不要用 setnx + expire 两步（非原子）。",
                ],
                "pitfalls": [
                    "把 Redis 当唯一数据源：一次宕机数据全丢。",
                    "只设 timeout 不设 connect-timeout：连不上时线程会卡在连接阶段。",
                    "缓存与数据库双写不一致：先更新库再删缓存，不要「更新库也更新缓存」。",
                    "大 key（几十万成员的 Set/Hash）：单次操作阻塞整个 Redis 实例。",
                ],
            },
        ],
    },
    {
        "id": "mq",
        "groupId": "middleware",
        "name": "消息队列",
        "why": "解耦与削峰。引入它意味着必须处理重复消费、顺序、积压三件事。",
        "defaultOption": "none",
        "options": [
            {
                "id": "none",
                "name": "不用消息队列",
                "badge": "最小",
                "summary": "单体应用内部用 Spring 事件或直接调用即可。别为了「架构看起来先进」而引入 MQ。",
                "dependencies": [],
                "notes": [
                    "真正需要 MQ 的信号是：需要跨进程异步、需要削峰、需要多个消费者独立处理同一事件。",
                    "如果一个事务内的两个操作，用本地事务就够了 —— 引入 MQ 反而带来一致性问题。",
                ],
                "pitfalls": ["把「异步」等同于「消息队列」：Spring 的 @Async 已经能解决单机异步。"],
            },
            {
                "id": "rocketmq",
                "name": "RocketMQ",
                "badge": "阿里系",
                "summary": "事务消息、顺序消息、延迟消息支持完善，适合电商与金融场景。国内文档与运维经验多。",
                "dependencies": [
                    {"groupId": "org.apache.rocketmq", "artifactId": "rocketmq-spring-boot-starter",
                     "version": "2.3.0"},
                ],
                "yaml": (
                    "rocketmq:\n"
                    "  name-server: ${ROCKETMQ_NAMESRV:127.0.0.1:9876}\n"
                    "  producer:\n"
                    "    group: arsenal-demo-producer\n"
                    "    # 发送超时必须设，否则 broker 异常时生产者会被长期挂住\n"
                    "    send-message-timeout: 3000\n"
                    "    retry-times-when-send-failed: 2\n"
                    "  consumer:\n"
                    "    group: arsenal-demo-consumer\n"
                    "    # 并发消费线程数，与业务处理耗时匹配\n"
                    "    consume-thread-max: 20"
                ),
                "sample": {
                    "title": "生产者与消费者的标准写法",
                    "lang": "java",
                    "code": (
                        "// ── 生产者：业务事务提交后再发消息 ──────────────────\n"
                        "@Service\n"
                        "public class OrderService {\n"
                        "\n"
                        "    private final RocketMQTemplate rocketMQTemplate;\n"
                        "\n"
                        "    @Transactional(rollbackFor = Exception.class)\n"
                        "    public void createOrder(OrderCreateRequest request) {\n"
                        "        long orderId = orderRepository.insert(buildOrder(request));\n"
                        "        // 发消息失败不能让下单失败，记录待补偿即可\n"
                        "        try {\n"
                        "            rocketMQTemplate.syncSend(\"topic-order-created\",\n"
                        "                    MessageBuilder.withPayload(new OrderCreatedEvent(orderId)).build());\n"
                        "        } catch (Exception e) {\n"
                        "            log.error(\"订单创建事件发送失败，转本地消息表补偿 orderId={}\", orderId, e);\n"
                        "        }\n"
                        "    }\n"
                        "}\n"
                        "\n"
                        "// ── 消费者：必须幂等，因为 MQ 一定至少投递一次 ──────────\n"
                        "@Component\n"
                        "@RocketMQMessageListener(topic = \"topic-order-created\",\n"
                        "        consumerGroup = \"arsenal-demo-consumer\")\n"
                        "public class OrderCreatedConsumer implements RocketMQListener<OrderCreatedEvent> {\n"
                        "\n"
                        "    @Override\n"
                        "    public void onMessage(OrderCreatedEvent event) {\n"
                        "        // 幂等：同一个 eventId 处理过就跳过\n"
                        "        if (!idempotentGuard.tryMark(event.getEventId())) {\n"
                        "            log.info(\"重复消息已跳过 eventId={}\", event.getEventId());\n"
                        "            return;\n"
                        "        }\n"
                        "        // 注意：抛异常才会触发重投，吞掉异常等于丢消息\n"
                        "        inventoryService.deduct(event.getOrderId());\n"
                        "    }\n"
                        "}"
                    ),
                },
                "notes": [
                    "消费端必须幂等。MQ 的投递语义是「至少一次」，重复消息是常态而不是异常。",
                    "顺序消息只对同一队列有效，全局顺序不存在（也不该要）。",
                    "本地事务与发消息的一致性：用事务消息，或本地消息表 + 定时补偿。不要在事务里同步等 MQ 返回。",
                ],
                "pitfalls": [
                    "消费端吞掉异常：消息被标记为成功、实际处理失败，且不会重投。",
                    "把重业务逻辑放消费者里同步执行：消费变慢后积压成山。",
                    "生产者 send 放在事务里且等待结果：MQ 抖动会拖长事务，把数据库连接耗尽。",
                ],
            },
            {
                "id": "rabbitmq",
                "name": "RabbitMQ",
                "badge": "易用",
                "summary": "路由模型灵活，管理界面成熟，延迟队列靠插件。适合业务系统里做任务分发。",
                "dependencies": [
                    {"groupId": "org.springframework.boot", "artifactId": "spring-boot-starter-amqp"},
                ],
                "yaml": (
                    "spring:\n"
                    "  rabbitmq:\n"
                    "    host: ${RABBITMQ_HOST:127.0.0.1}\n"
                    "    port: 5672\n"
                    "    username: ${RABBITMQ_USER}\n"
                    "    password: ${RABBITMQ_PASSWORD}\n"
                    "    # 开启生产者确认，否则「发送成功」只是写进了本地缓冲区\n"
                    "    publisher-confirm-type: correlated\n"
                    "    publisher-returns: true\n"
                    "    listener:\n"
                    "      simple:\n"
                    "        acknowledge-mode: manual    # 手工 ack，处理成功后才确认\n"
                    "        prefetch: 10                # 每次预取条数，防止一个消费者囤积全部消息\n"
                    "        retry:\n"
                    "          enabled: true             # 本地重试（注意与死信队列配合）\n"
                    "          max-attempts: 3"
                ),
                "notes": [
                    "手工 ack + 死信队列是标配：处理失败的消费必须进死信，否则只能靠人肉重发。",
                    "prefetch 要设。不设时一个消费者可能把队列全部消息预取走，其他消费者闲着。",
                ],
                "pitfalls": [
                    "自动 ack：消费者一拿到消息就确认，处理失败即丢消息。",
                    "不开 publisher-confirm：消息实际没到 broker，但代码以为发送成功。",
                ],
            },
            {
                "id": "kafka",
                "name": "Kafka",
                "badge": "高吞吐",
                "summary": "日志、事件流、大数据管道场景的首选。吞吐量比其他两者高一到两个数量级。",
                "dependencies": [
                    {"groupId": "org.springframework.kafka", "artifactId": "spring-kafka"},
                ],
                "yaml": (
                    "spring:\n"
                    "  kafka:\n"
                    "    bootstrap-servers: ${KAFKA_BOOTSTRAP:127.0.0.1:9092}\n"
                    "    producer:\n"
                    "      acks: all                     # 等所有副本确认，数据不丢但吞吐略降\n"
                    "      retries: 3\n"
                    "      # 开启幂等生产者，避免重试导致消息重复\n"
                    "      properties:\n"
                    "        enable.idempotence: true\n"
                    "        max.in.flight.requests.per.connection: 1\n"
                    "    consumer:\n"
                    "      group-id: arsenal-demo\n"
                    "      auto-offset-reset: earliest\n"
                    "      enable-auto-commit: false     # 手工提交 offset，处理完成后再提交\n"
                    "      max-poll-records: 100"
                ),
                "notes": [
                    "分区数决定并行度上限，且只能增不能减 —— 一开始就要按目标吞吐定好。",
                    "手工提交 offset（enable-auto-commit: false）。自动提交下，处理失败会丢消息。",
                ],
                "pitfalls": [
                    "分区数设成 1：后面想并行也扩不了（分区只能增，重分区会打乱键的分配）。",
                    "消费者处理耗时超过 max.poll.interval.ms：触发 rebalance，消费组反复重组。",
                ],
            },
        ],
    },
    {
        "id": "registry",
        "groupId": "middleware",
        "name": "注册中心 / 配置中心",
        "why": "单体应用完全不需要。拆成多服务之后才必须回答「服务地址从哪来」。",
        "defaultOption": "none",
        "options": [
            {
                "id": "none",
                "name": "不需要（单体）",
                "badge": "推荐",
                "summary": "单体应用内部就是方法调用，没有服务发现的需求。配置文件放本地加环境变量已经够用。",
                "dependencies": [],
                "notes": [
                    "引入注册中心的前提是「有多个可独立部署的服务」。单体应用引入它，只增加启动依赖与运维成本。",
                    "配置中心的价值在多环境、多实例统一变更配置；单体应用用 application-{profile}.yml 就足够。",
                ],
                "pitfalls": ["为了让项目「看起来是微服务」而引入注册中心：多了一个必须高可用的组件，收益为零。"],
            },
            {
                "id": "nacos",
                "name": "Nacos",
                "badge": "主流",
                "summary": "同时做注册中心与配置中心，支持配置热更新与分组隔离。国内微服务的事实标准之一。",
                "dependencies": [
                    {"groupId": "com.alibaba.cloud", "artifactId": "spring-cloud-starter-alibaba-nacos-discovery"},
                    {"groupId": "com.alibaba.cloud", "artifactId": "spring-cloud-starter-alibaba-nacos-config"},
                    {"groupId": "org.springframework.cloud", "artifactId": "spring-cloud-starter-bootstrap",
                     "note": "Spring Cloud 2021+ 默认关闭 bootstrap，需要它才能在启动早期读配置"},
                ],
                "yaml": (
                    "# ── bootstrap.yml（注意：配置中心的连接信息必须写在这里）──\n"
                    "# 为什么不能写在 application.yml：\n"
                    "# application.yml 的加载时机晚于 Spring Cloud 上下文初始化，\n"
                    "# 导致「配置中心地址」本身要从配置中心读 —— 循环依赖。\n"
                    "spring:\n"
                    "  application:\n"
                    "    name: arsenal-demo\n"
                    "  profiles:\n"
                    "    active: dev\n"
                    "  cloud:\n"
                    "    nacos:\n"
                    "      server-addr: ${NACOS_ADDR:127.0.0.1:8848}\n"
                    "      username: ${NACOS_USER}\n"
                    "      password: ${NACOS_PASSWORD}\n"
                    "      discovery:\n"
                    "        namespace: ${NACOS_NS:}\n"
                    "        group: DEFAULT_GROUP\n"
                    "      config:\n"
                    "        # 配置坐标：dataId = 应用名 + profile + 后缀\n"
                    "        file-extension: yaml\n"
                    "        namespace: ${NACOS_NS:}\n"
                    "        group: DEFAULT_GROUP\n"
                    "        refresh-enabled: true   # 开启热更新"
                ),
                "configClasses": [
                    {
                        "className": "NacosRefreshConfig",
                        "path": "src/main/java/com/example/config/NacosRefreshConfig.java",
                        "code": (
                            "package com.example.config;\n"
                            "\n"
                            "import org.springframework.cloud.context.config.annotation.RefreshScope;\n"
                            "import org.springframework.context.annotation.Configuration;\n"
                            "\n"
                            "/**\n"
                            " * Nacos 配置热更新的两个前提，缺一不可：\n"
                            " *\n"
                            " *   1. 配置类加 @RefreshScope（或 @ConfigurationProperties + @RefreshScope），\n"
                            " *      否则 Nacos 里改了值，应用侧仍然是旧值；\n"
                            " *   2. 该配置必须放在 Nacos 的 dataId 里，而不是本地 application.yml\n"
                            " *      （本地文件优先级更高，会覆盖掉远端配置，改了没反应）。\n"
                            " *\n"
                            " * 排查「热更新不生效」的第一步永远是：确认这个 key 到底是从哪读到的。\n"
                            " */\n"
                            "@Configuration\n"
                            "@RefreshScope\n"
                            "public class NacosRefreshConfig {\n"
                            "    // 具体配置项见 @ConfigurationProperties 类\n"
                            "}"
                        ),
                    }
                ],
                "notes": [
                    "@RefreshScope 不加，配置改了不生效 —— 这是 Nacos 最高频的问题。",
                    "本地 application.yml 的优先级高于 Nacos 远端配置，会覆盖它。要热更新的项不要写在本地。",
                    "Nacos 集群至少要 3 个节点，且必须用外部数据库存储（默认内嵌 derby 无法集群）。",
                ],
                "pitfalls": [
                    "namespace / group / dataId 三者有一个对不上，配置就读不到，且默认不报错。",
                    "把数据库密码放 Nacos 却不做鉴权：配置中心变成了凭据泄漏点。",
                    "服务下线时没注销：Nacos 里残留实例，流量仍会被路由过去。",
                ],
            },
        ],
    },
    {
        "id": "scheduler",
        "groupId": "middleware",
        "name": "定时任务",
        "why": "单机任务用 @Scheduled 就够；多实例部署时必须解决「只有一个实例该执行」。",
        "defaultOption": "spring",
        "options": [
            {
                "id": "spring",
                "name": "Spring @Scheduled",
                "badge": "单机",
                "summary": "零依赖，注解即任务。配合 ShedLock 可解决多实例重复执行问题。",
                "dependencies": [
                    {"groupId": "net.javacrumbs.shedlock", "artifactId": "shedlock-spring",
                     "version": "5.13.0", "note": "多实例部署时必加，否则任务会被每个实例各执行一次"},
                    {"groupId": "net.javacrumbs.shedlock", "artifactId": "shedlock-provider-jdbc-template",
                     "version": "5.13.0"},
                ],
                "configClasses": [
                    {
                        "className": "SchedulerConfig",
                        "path": "src/main/java/com/example/config/SchedulerConfig.java",
                        "code": (
                            "package com.example.config;\n"
                            "\n"
                            "import javax.sql.DataSource;\n"
                            "import net.javacrumbs.shedlock.core.LockProvider;\n"
                            "import net.javacrumbs.shedlock.provider.jdbctemplate.JdbcTemplateLockProvider;\n"
                            "import net.javacrumbs.shedlock.spring.annotation.EnableSchedulerLock;\n"
                            "import org.springframework.context.annotation.Bean;\n"
                            "import org.springframework.context.annotation.Configuration;\n"
                            "import org.springframework.scheduling.annotation.EnableScheduling;\n"
                            "\n"
                            "/**\n"
                            " * 定时任务配置。\n"
                            " *\n"
                            " * 两个关键点：\n"
                            " *   1. 必须自己定义 TaskScheduler 线程池。默认是单线程的，\n"
                            " *      一个任务跑久了，其他任务全部延后 —— 而且不会有任何告警。\n"
                            " *   2. 多实例部署必须用 ShedLock 加分布式锁，否则每个实例都会执行一次。\n"
                            " *      表现是「数据莫名其妙被重复处理了 N 次」（N = 实例数）。\n"
                            " */\n"
                            "@Configuration\n"
                            "@EnableScheduling\n"
                            "@EnableSchedulerLock(defaultLockAtMostFor = \"PT10M\")\n"
                            "public class SchedulerConfig {\n"
                            "\n"
                            "    @Bean\n"
                            "    public LockProvider lockProvider(DataSource dataSource) {\n"
                            "        return new JdbcTemplateLockProvider(\n"
                            "                JdbcTemplateLockProvider.Configuration.builder()\n"
                            "                        .withJdbcTemplate(new org.springframework.jdbc.core.JdbcTemplate(dataSource))\n"
                            "                        .usingDbTime()   // 用数据库时间，避免各实例时钟不一致导致锁失效\n"
                            "                        .build());\n"
                            "    }\n"
                            "}"
                        ),
                    }
                ],
                "sample": {
                    "title": "任务写法",
                    "lang": "java",
                    "code": (
                        "@Component\n"
                        "public class ReportJob {\n"
                        "\n"
                        "    /** lockAtMostFor：任务最长持锁时间，必须大于任务最坏耗时。\n"
                        "     *  设小了，任务还没跑完锁就释放，另一个实例会重复执行。 */\n"
                        "    @Scheduled(cron = \"0 0 2 * * ?\")\n"
                        "    @SchedulerLock(name = \"dailyReport\", lockAtMostFor = \"PT30M\", lockAtLeastFor = \"PT1M\")\n"
                        "    public void generateDailyReport() {\n"
                        "        // 任务必须幂等：即使重复执行也不产生重复数据\n"
                        "        reportService.generateForYesterday();\n"
                        "    }\n"
                        "}"
                    ),
                },
                "notes": [
                    "Cron 表达式从左到右是「秒 分 时 日 月 周」，和 Linux crontab 差一位，写错很常见。",
                    "任务必须幂等：分布式锁只是降低概率，不能替代幂等设计。",
                ],
                "pitfalls": [
                    "多实例不加锁：任务被执行 N 次，产生 N 倍数据。",
                    "任务方法抛异常未捕获：该任务后续调度会被取消（Spring 的行为）。",
                    "在任务里做长事务：整点任务与业务高峰撞在一起，互相拖累。",
                ],
            },
            {
                "id": "xxljob",
                "name": "XXL-Job",
                "badge": "分布式",
                "summary": "独立调度中心，统一管理任务、支持分片、失败重试、执行日志查询、动态改 cron。",
                "dependencies": [
                    {"groupId": "com.xuxueli", "artifactId": "xxl-job-core", "version": "2.4.1"},
                ],
                "yaml": (
                    "xxl:\n"
                    "  job:\n"
                    "    admin:\n"
                    "      # 调度中心地址（多个用逗号分隔）\n"
                    "      addresses: ${XXLJOB_ADMIN:http://127.0.0.1:8080/xxl-job-admin}\n"
                    "      access-token: ${XXLJOB_TOKEN}\n"
                    "    executor:\n"
                    "      appname: arsenal-demo-executor\n"
                    "      # 执行器注册方式：自动注册（推荐，避免手工配 IP）\n"
                    "      address: ''\n"
                    "      ip: ''\n"
                    "      port: 9999\n"
                    "      logpath: ./logs/xxl-job\n"
                    "      logretentiondays: 30"
                ),
                "configClasses": [
                    {
                        "className": "XxlJobConfig",
                        "path": "src/main/java/com/example/config/XxlJobConfig.java",
                        "code": (
                            "package com.example.config;\n"
                            "\n"
                            "import com.xxl.job.core.executor.impl.XxlJobSpringExecutor;\n"
                            "import org.slf4j.Logger;\n"
                            "import org.slf4j.LoggerFactory;\n"
                            "import org.springframework.beans.factory.annotation.Value;\n"
                            "import org.springframework.context.annotation.Bean;\n"
                            "import org.springframework.context.annotation.Configuration;\n"
                            "\n"
                            "/**\n"
                            " * XXL-Job 执行器配置。\n"
                            " *\n"
                            " * 一个容易忽略的点：executor 的 ip 留空时由框架自动探测，\n"
                            " * 在容器/多网卡环境下可能探测到错误的网卡地址，\n"
                            " * 表现为「调度中心显示执行器在线，但任务一直不执行」。\n"
                            " * 明确指定 ip 或配置网络策略可以避免。\n"
                            " */\n"
                            "@Configuration\n"
                            "public class XxlJobConfig {\n"
                            "\n"
                            "    private static final Logger log = LoggerFactory.getLogger(XxlJobConfig.class);\n"
                            "\n"
                            "    @Value(\"${xxl.job.admin.addresses}\")\n"
                            "    private String adminAddresses;\n"
                            "\n"
                            "    @Value(\"${xxl.job.executor.appname}\")\n"
                            "    private String appName;\n"
                            "\n"
                            "    @Value(\"${xxl.job.executor.port}\")\n"
                            "    private int port;\n"
                            "\n"
                            "    @Bean\n"
                            "    public XxlJobSpringExecutor xxlJobExecutor() {\n"
                            "        XxlJobSpringExecutor executor = new XxlJobSpringExecutor();\n"
                            "        executor.setAdminAddresses(adminAddresses);\n"
                            "        executor.setAppname(appName);\n"
                            "        executor.setPort(port);\n"
                            "        log.info(\"XXL-Job 执行器已初始化 appName={} port={}\", appName, port);\n"
                            "        return executor;\n"
                            "    }\n"
                            "}"
                        ),
                    }
                ],
                "notes": [
                    "@XxlJob 注解的方法返回值要 void，且内部必须自己 try-catch —— 抛异常会被记为执行失败并重试。",
                    "分片广播适合「大量数据分片并行处理」，每个执行器只处理自己分片的数据。",
                ],
                "pitfalls": [
                    "调度中心与执行器时钟不同步：任务触发时间看起来会漂移。",
                    "执行日志保留天数不设：磁盘被几十 GB 日志占满。",
                ],
            },
        ],
    },
]
