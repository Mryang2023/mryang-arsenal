# -*- coding: utf-8 -*-
"""选型维度 · 交付与运行：部署形态、容器化、编排与发布方式。

这一维回答的不是「代码怎么写」，而是**「代码怎么变成一个正在跑的进程」**。

为什么值得单独成一维：
    容器化与编排会反向约束业务代码 —— 进程必须是无状态的、必须能优雅停机、
    必须自己回答「我现在能不能接流量」。这些约束一旦写在部署脚本里而不是选型里，
    就会变成发布当天才发现的一堆返工。

四种形态之间不是「先进程度」的排序，而是**发布粒度与运维成本的取舍**：
    jar     一台机器一个进程，改动成本最低，代价是扩缩容与自愈全靠人
    docker  环境被冻结进镜像，本机与线上一致；编排仍在你手里
    k8s     调度、自愈、扩缩容交给平台；代价是你要先把它的数据结构学会
    helm    同一套模板喂不同的 values；多环境场景才值这个复杂度
"""

DIMENSIONS = [
    {
        "id": "deploy",
        "groupId": "delivery",
        "name": "交付形态",
        "why": (
            "决定镜像 / 进程如何被调度、被重启、被回滚。"
            "这一维的改动成本不在代码里，而在发布流水线上 —— 所以它一旦选定就很难中途换。"
        ),
        "defaultOption": "docker",
        "options": [
            {
                "id": "jar",
                "name": "Fat JAR + 进程守护",
                "badge": "最省事",
                "summary": (
                    "打成可执行 jar，由 systemd / supervisor 拉起。"
                    "中间件仍然装在宿主机或单独的机器上，一台机一个进程，心智负担最小。"
                ),
                "notes": [
                    "进程被杀是怎么 SIGNAL 的，比进程怎么启动更重要：systemd 的默认 KillSignal=SIGTERM "
                    "正好是 Spring Boot 优雅停机的触发信号，配好后才能做到「先摘流量、再关进程」。",
                    "滚动发布=手工：先起新的、探活、再切 Nginx upstream。两个端口来回切的做法要写进运维手册，"
                    "否则换个人发布就变成一次停机发布。",
                    "日志落文件，意味着必须同时配 logrotate —— 容器里不用操心的事，这里会被重新拿回来。"
                    "忘了配的话，磁盘会被自己的日志写满，而服务本身毫无异常。",
                    "宿主机 JDK 版本就是运行时版本。升级 JDK 要动机器，不像镜像那样换个 tag 就行。",
                ],
                "pitfalls": [
                    "把 jar 拷上服务器就算部署完了：没有守护进程时，OOM 或被误杀后服务不会自己回来。",
                    "kill -9 当成重启手段：优雅停机被跳过，正在处理的事务会被直接切断。",
                    "在多个应用之间共享同一台机器的 JDK 并随意升级：一次升级影响全部应用，回滚成本高。",
                ],
                "ops": [
                    "目标机安装与目标版本一致的 JDK（17 或 21），不要靠系统源里的默认版本。",
                    "写一个 systemd unit：Restart=always、KillSignal=SIGTERM、TimeoutStopSec 大于 "
                    "spring.lifecycle.timeout-per-shutdown-phase。",
                    "配 logrotate：按天轮转 + 保留 14 天 + copytruncate 或对应用开启日志滚动。",
                ],
                "env": [
                    {"key": "JAVA_OPTS", "desc": "JVM 参数。至少要写 -Xms/-Xmx 上限，避免占满整机内存。"},
                    {"key": "SPRING_PROFILES_ACTIVE", "desc": "指定生效 profile，用来区分 dev / prod。"},
                ],
                "sample": {
                    "title": "systemd unit：把「优雅停机」写明，而不是依赖默认值",
                    "lang": "text",
                    "code": (
                        "[Unit]\n"
                        "Description=arsenal-demo\n"
                        "After=network.target\n"
                        "\n"
                        "[Service]\n"
                        "Type=simple\n"
                        "User=appuser                      # 不要用 root 跑\n"
                        "WorkingDirectory=/opt/arsenal-demo\n"
                        "ExecStart=/usr/bin/java $JAVA_OPTS -jar /opt/arsenal-demo/app.jar\n"
                        "\n"
                        "# ── 下面三行才是这一维的重点 ──\n"
                        "KillSignal=SIGTERM                # Spring Boot 收到它才开始优雅停机\n"
                        "TimeoutStopSec=45s                # 必须大于 timeout-per-shutdown-phase（默认 30s）\n"
                        "Restart=always                    # OOM / 异常退出后自己起来\n"
                        "RestartSec=5\n"
                        "\n"
                        "[Install]\n"
                        "WantedBy=multi-user.target\n"
                        "\n"
                        "# 注意：TimeoutStopSec 写小了，systemd 会在应用还没处理完存量请求时\n"
                        "# 直接 SIGKILL —— 表现为「发布就有少量 502」，而且数量随机。"
                    ),
                },
            },
            {
                "id": "docker",
                "name": "Docker 镜像 + Compose",
                "badge": "推荐",
                "summary": (
                    "多阶段构建出只含 JRE 的运行镜像，Compose 负责编排应用与它依赖的中间件。"
                    "环境差异被冻结进镜像，「本机是好的」第一次变得可信。"
                ),
                "notes": [
                    "构建出来的胖 jar 要先用 layertools 拆层：依赖层几乎不变、业务层每次都变。"
                    "不拆层时每次推送都是整包，镜像仓库与拉取时间都会被放大。",
                    "运行镜像只装 JRE 不带 JDK：少一个包，就少一份攻击面与几十 MB 体积。",
                    "容器里的 JVM 看不到 cgroup 限制会按宿主机内存算堆上限 —— JDK 11 起默认 UseContainerSupport "
                    "已开启，但 MaxRAMPercentage 仍需显式给一个值，别让它默认吃掉整个 limit。",
                    "Compose 可以一键起全套依赖，但它是**编排工具不是生产调度器**："
                    "机器重启策略、跨机迁移、健康检查后的自动替换，都不是它的职责。",
                    "镜像 tag 必须打版本号或 commit sha。生产用 latest 意味着「回滚到哪一版」没有答案。",
                ],
                "pitfalls": [
                    "用 latest 跑生产：拉到的镜像内容不可确定，回滚等于重新发球。",
                    "COPY target/*.jar 一次搞定：任意一个依赖没变，镜像层也会整体重建，"
                    "推送与冷启动都会被拖慢。",
                    "容器内以 root 运行：一旦被突破，拿到的是容器里的 root。"
                    "镜像里建个普通用户，USER 切过去。",
                    "把 application.yml 里写生产密码打进镜像：镜像是可以被拉取下来反解的，"
                    "配置必须在运行时以环境变量注入。",
                    "Compose 里的 MySQL / Redis 当成生产实例用：没有备份、没有故障切换，"
                    "容器重建即数据清空，除非挂了具名卷并且你自己做过恢复演练。",
                ],
                "ops": [
                    "准备镜像仓库（Harbor / 云厂商 Registry），并约定 tag 规范：<version>-<shortSha>。",
                    "写 .dockerignore：target/、.git/、*.log 都不该进构建上下文。",
                    "CI 里跑 docker buildx build --push，本地不产出「最后一版」。",
                ],
                "env": [
                    {"key": "SPRING_PROFILES_ACTIVE", "desc": "由 compose 或容器环境变量注入，镜像本身与环境无关。"},
                    {"key": "SPRING_DATASOURCE_URL", "desc": "数据源地址。容器里通常写服务名而非 IP。"},
                    {"key": "SPRING_DATASOURCE_PASSWORD", "desc": "数据库密码，走环境变量注入，不进镜像、不进 Git。"},
                ],
                "sample": {
                    "title": "多阶段 Dockerfile：拆层 + 非 root + 容器感知内存",
                    "lang": "text",
                    "code": (
                        "# ── ① 构建阶段：只要 JDK 与 maven，产物不进运行镜像 ──\n"
                        "FROM eclipse-temurin:17-jdk-jammy AS builder\n"
                        "WORKDIR /build\n"
                        "COPY pom.xml .\n"
                        "# 先单独解析一次依赖：这一步的结果会被缓存，改业务代码时不用重下依赖\n"
                        "RUN ./mvnw -B -q dependency:go-offline || true\n"
                        "COPY src ./src\n"
                        "RUN ./mvnw -B -q clean package -DskipTests \\\n"
                        " && java -Djarmode=layertools -jar target/*.jar extract --destination target/extracted\n"
                        "\n"
                        "# ── ② 运行阶段：只装 JRE ──\n"
                        "FROM eclipse-temurin:17-jre-jammy\n"
                        "RUN groupadd -r app && useradd -r -g app app\n"
                        "WORKDIR /app\n"
                        "\n"
                        "# 按变更频率从低到高依次 COPY —— 依赖层几乎每次命中缓存\n"
                        "COPY --from=builder /build/target/extracted/dependencies/ ./\n"
                        "COPY --from=builder /build/target/extracted/spring-boot-loader/ ./\n"
                        "COPY --from=builder /build/target/extracted/snapshot-dependencies/ ./\n"
                        "COPY --from=builder /build/target/extracted/application/ ./\n"
                        "\n"
                        "USER app\n"
                        "EXPOSE 8080\n"
                        "# MaxRAMPercentage 必须显式写：不写就是「看默认值够不够巧」\n"
                        "ENV JAVA_TOOL_OPTIONS=\"-XX:MaxRAMPercentage=75.0 -XX:+UseG1GC\"\n"
                        "ENTRYPOINT [\"java\", \"org.springframework.boot.loader.launch.JarLauncher\"]\n"
                        "\n"
                        "# 注意：不要把 application-prod.yml 打进镜像。\n"
                        "# 镜像应当与部署环境无关 —— 换环境只换环境变量，不重新构建。"
                    ),
                },
            },
            {
                "id": "k8s",
                "name": "Kubernetes 原生清单",
                "badge": "生产",
                "summary": (
                    "Deployment + Service + Ingress + ConfigMap/Secret + HPA，kubectl apply 交付。"
                    "自愈、滚动更新、按需扩容由平台负责，代价是你要先把它的对象模型与失效模式搞清楚。"
                ),
                "notes": [
                    "三个探针各管一件事，缺一个就会有一类故障没人管：readiness 决定「能不能接流量」、"
                    "liveness 决定「要不要重启」、startupProbe 决定「慢启动的应用会不会被误杀」。",
                    "terminationGracePeriodSeconds 必须大于 spring.lifecycle.timeout-per-shutdown-phase，"
                    "否则优雅停机还没走完就被 SIGKILL —— 表现为每次滚动更新都掉一批请求。",
                    "resources.requests 是调度依据，limits 是天花板。只写 limits 不写 requests，"
                    "调度器会把 Pod 塞到其实装不下它的节点上。",
                    "一定要配 PodDisruptionBudget：没有它，节点排水（drain）时会一次性把所有副本都赶走，"
                    "「滚动」更新直接变成全停。",
                    "HPA 依赖Metrics Server，且 CPU 之外还得看自定义指标 —— 纯 CPU 驱动的扩容对 IO 密集服务基本无效。",
                    "镜像只在该Registry完全没有时才需要 imagePullSecrets； Secrets 是 base64 不是加密，"
                    "真正的加密要靠集群侧的静态加密。",
                    "所有编排决策都写进 Git。集群里的手改是一次性的 —— 下次 apply 它就会被覆盖，"
                    "而下一次 apply 的时刻不在你的控制之内。",
                ],
                "pitfalls": [
                    "只配 liveness 不配 readiness：Pod 启动中就被塞进 Service，"
                    "表现是「发布时随机 502」，且复现不了。",
                    "探针里查数据库：一次库抖动会让所有副本同时被判定不健康并重启，"
                    "把下游的一次抖动放大成全集群雪崩。探针只许反映自己进程的可用性。",
                    "把 Secret 提交进 Git：base64 不是加密。要么用 Sealed Secrets / External Secrets，"
                    "要么从集群外部的密钥管理系统注入。",
                    "给容器只设 limits 不设 requests：Pod 被调度到剩余容量不足的节点，"
                    "内存压力下会被 OOMKill 驱逐，且没有任何先兆。",
                    "多副本下继续用 @Scheduled：每个副本都会各自跑一遍，任务被重复执行 N 次，"
                    "而且通常不报错，只是数据悄悄翻倍。",
                ],
                "ops": [
                    "集群侧先装三样：Ingress Controller、Metrics Server（HPA 依赖它）、日志采集组件。",
                    "为每个 namespace 建 ServiceAccount + RoleBinding，不要用 default SA 跑业务。",
                    "镜像拉取凭据放进 imagePullSecrets，并在 Deployment 上显式引用。",
                    "配 coreDNS 与就绪前的优雅退出：容器终止时的 preStop sleep 是避免「5xx 尖刺」的最小手段。",
                ],
                "env": [
                    {"key": "SPRING_PROFILES_ACTIVE", "desc": "由 ConfigMap 注入，镜像与环境解耦。"},
                    {"key": "SPRING_DATASOURCE_URL", "desc": "数据源地址，通常指向集群内的 Service DNS 名。"},
                    {"key": "SPRING_DATASOURCE_PASSWORD", "desc": "走 Secret 注入（secretKeyRef），不进 ConfigMap。"},
                ],
                "sample": {
                    "title": "Deployment 关键片段：探针、资源、优雅停机三件套",
                    "lang": "yaml",
                    "code": (
                        "spec:\n"
                        "  replicas: 3\n"
                        "  template:\n"
                        "    spec:\n"
                        "      # 优雅停机的总时长必须大于应用侧 shutdown 超时，否则等于没配\n"
                        "      terminationGracePeriodSeconds: 45\n"
                        "      containers:\n"
                        "        - name: app\n"
                        "          image: registry.example.com/arsenal-demo:1.0.0-a1b2c3d\n"
                        "          ports:\n"
                        "            - containerPort: 8080\n"
                        "          resources:\n"
                        "            requests: { cpu: 500m, memory: 1Gi }\n"
                        "            limits:   { cpu: '2',  memory: 2Gi }\n"
                        "          # ① readiness：不就绪就不进 Service，发布期不再有随机 502\n"
                        "          readinessProbe:\n"
                        "            httpGet: { path: /actuator/health/readiness, port: 8080 }\n"
                        "            periodSeconds: 5\n"
                        "            failureThreshold: 3\n"
                        "          # ② liveness：只表示「进程活着」，不要在这里查下游\n"
                        "          livenessProbe:\n"
                        "            httpGet: { path: /actuator/health/liveness, port: 8080 }\n"
                        "            periodSeconds: 15\n"
                        "          # ③ startupProbe：慢启动的应用靠它躲过前期的 liveness 误杀\n"
                        "          startupProbe:\n"
                        "            httpGet: { path: /actuator/health/liveness, port: 8080 }\n"
                        "            failureThreshold: 30\n"
                        "            periodSeconds: 5\n"
                        "          lifecycle:\n"
                        "            preStop:\n"
                        "              exec:\n"
                        "                # 先退出 Service 再停进程，中间留出 endpoint 传播的时间\n"
                        "                command: ['sh', '-c', 'sleep 5']\n"
                        "\n"
                        "# 配套：PodDisruptionBudget\n"
                        "# 没有它，kubectl drain 一个节点会同时赶走全部副本 —— 「滚动」更新名存实亡\n"
                        "apiVersion: policy/v1\n"
                        "kind: PodDisruptionBudget\n"
                        "spec:\n"
                        "  minAvailable: 2\n"
                        "  selector: { matchLabels: { app: arsenal-demo } }"
                    ),
                },
            },
            {
                "id": "helm",
                "name": "Helm Chart（多环境）",
                "badge": "多套环境",
                "summary": (
                    "同一套模板配多份 values.yaml，dev / staging / prod 只差一份配置。"
                    "适合「同一份东西要部署到多个环境或多个客户」的场景。"
                ),
                "notes": [
                    "Chart 版本号与应用镜像版本号是两件事：Chart 变了 version 才 +1，镜像变了 appVersion 才动。"
                    "混在一起就没法回答「这次发布到底变了什么」。",
                    "values 要分层：基础 values.yaml + 每环境一个 values-<env>.yaml。"
                    "把所有环境塞进同一份文件，迟早有人改错环境。",
                    "helm upgrade 之前先 helm diff / template 看一眼渲染结果 —— "
                    "模板里的一个条件写反，人眼扫 YAML 基本发现不了。",
                    "密钥不放 values：要么在 CI 里 --set 注入（会被写进 shell 历史），"
                    "要么让 External Secrets 从专门的密钥系统同步，values 里只留一个引用名。",
                    "release 历史是有上限的（默认 10 条）。回滚依赖这段历史，别把它当成长期的变更留痕 —— "
                    "真正的留痕在 Git 里的 values。",
                    "回滚有边界：helm rollback 会把 Deployment 退回旧镜像，但**不会**回滚数据库。"
                    "一次涉及库变更的发布回滚前，必须先确认 Schema 是否向后兼容。",
                ],
                "pitfalls": [
                    "把 values-prod.yaml 连着密码一起提进 Git：Helm 没有帮你屏蔽任何东西。",
                    "在 CI 里堆一串 --set a=1 b=2 c=3：真正生效的值分散在命令行与文件里，"
                    "出问题时没人知道线上到底用的是哪一份。",
                    "模板里写死镜像版本号，chart 从此只能服务一个应用版本，复用性归零。",
                    "以为 helm rollback 能回滚一切：数据是它碰不到的地方。"
                    "「应用层回滚成功但数据结构已升级」是最难收拾的状态。",
                ],
                "ops": [
                    "约定 chart 目录结构：Chart.yaml / values.yaml / values-<env>.yaml / templates/。",
                    "CI 里跑 helm lint 与 helm template --validate，渲染失败不要等到 apply 时才发现。",
                    "私有 chart 仓库（Harbor / OCI registry）与版本发布流程要先于应用上线定好。",
                ],
                "env": [
                    {"key": "SPRING_PROFILES_ACTIVE", "desc": "由 values 里的环境配置决定，模板以 env 形式注入。"},
                    {"key": "SPRING_DATASOURCE_URL", "desc": "每份 values 各写一套，常见偏差来源，务必 diff 核对。"},
                ],
                "sample": {
                    "title": "Chart 结构：一份模板，多份 values",
                    "lang": "text",
                    "code": (
                        "chart/\n"
                        "├── Chart.yaml          # version 是 chart 版本，appVersion 是应用版本 —— 别混\n"
                        "├── values.yaml         # 默认值：所有环境共享的部分\n"
                        "├── values-dev.yaml     # 1 副本、小资源、latest-ish\n"
                        "├── values-prod.yaml    # 3 副本、有 PDB、有 HPA\n"
                        "└── templates/\n"
                        "    ├── deployment.yaml\n"
                        "    ├── service.yaml\n"
                        "    ├── ingress.yaml\n"
                        "    ├── configmap.yaml\n"
                        "    ├── hpa.yaml\n"
                        "    └── _helpers.tpl    # 命名 / 标签统一在这里定义\n"
                        "\n"
                        "# 部署：\n"
                        "#   helm upgrade --install arsenal ./chart \\\n"
                        "#        -f ./chart/values.yaml -f ./chart/values-prod.yaml \\\n"
                        "#        --set image.tag=1.0.0-a1b2c3d\n"
                        "#\n"
                        "# 发布前必看渲染结果 —— 模板写反时 diff 是唯一会说话的地方：\n"
                        "#   helm diff upgrade arsenal ./chart -f ... -f ...\n"
                        "#   helm template arsenal ./chart -f ... -f ... | kubectl diff -f -"
                    ),
                },
            },
        ],
    },
]
