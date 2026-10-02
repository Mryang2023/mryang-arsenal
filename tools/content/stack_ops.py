# -*- coding: utf-8 -*-
"""运维安全组维度：交付流水线 / 监控告警 / 密钥安全 / 日志审计。"""

DIMENSIONS = [
    {
        "id": "cicd",
        "groupId": "ops",
        "name": "交付流水线",
        "why": "代码怎么变成线上服务、能否灰度回滚，交付方式决定发布频率和出错恢复速度，选手工还是流水线天差地别。",
        "defaultOption": "manual",
        "options": [
            {
                "id": "manual",
                "yamlNote": True,
                "name": "手工",
                "badge": "轻量",
                "summary": "手工打 jar、scp 到服务器、java -jar 启停，零工具成本，但发布靠人、易出错、无法回滚，规模一大就失控。",
                "yaml": "mvn -q package\nscp target/app.jar srv:/opt/app/\nssh srv 'systemctl restart app'",
                "notes": [
                    "用 systemctl restart 拉起，先停旧进程再起新进程。",
                    "保留上一个 jar 包，出问题直接换回。",
                ],
                "pitfalls": [
                    "发布需停机或手动替换，无灰度、无回滚，出错只能连上去救火。",
                ],
            },
            {
                "id": "jenkins",
                "yamlNote": True,
                "name": "Jenkins",
                "badge": "通用",
                "summary": "Jenkins 用自由风格或 Pipeline 串起构建到部署，插件极多、可控性强，但 Master 要自己维护，配置易腐化。",
                "yaml": "pipeline {\n  agent any\n  stages {\n    stage('build') { steps { sh 'mvn -q package' } }\n    stage('deploy') { steps { sh 'kubectl apply -f k8s/' } }\n  }\n}",
                "notes": [
                    "用 Jenkinsfile 把流水线存进仓库，配置即代码。",
                    "凭据走 Credentials Binding，别写进脚本明文。",
                ],
                "pitfalls": [
                    "Master 单点且插件版本混乱，升级常导致 job 集体失效。",
                    "默认不隔离构建环境，多任务会互相污染工作区。",
                ],
            },
            {
                "id": "gitlabci",
                "yamlNote": True,
                "name": "GitLab CI",
                "badge": "推荐",
                "summary": "GitLab CI 用仓库内 .gitlab-ci.yml 定义流水线，与代码同仓、体验顺滑，但需要 Runner 资源且强绑定 GitLab。",
                "yaml": "stages: [build, deploy]\nbuild:\n  stage: build\n  script: [\"mvn -q package\"]\ndeploy:\n  stage: deploy\n  script: [\"kubectl apply -f k8s/\"]",
                "notes": [
                    "用 cache 缓存 ~/.m2 加速构建，artifacts 传包给下一阶段。",
                    "Runner 用 docker executor 保证环境干净。",
                ],
                "pitfalls": [
                    "Runner 资源不足时流水线排队，发布被卡。",
                    "强绑定 GitLab，换代码平台要重写整套流水线。",
                ],
            },
            {
                "id": "argocd",
                "yamlNote": True,
                "name": "ArgoCD GitOps",
                "badge": "高阶",
                "summary": "ArgoCD 以 Git 仓库为唯一事实源，自动同步 K8s 期望态、可视化差异，是 GitOps 标准做法，但前提是已经上 K8s。",
                "yaml": "apiVersion: argoproj.io/v1alpha1\nkind: Application\nspec:\n  source: {repoURL: <git>, path: k8s}\n  destination: {server: https://k8s, namespace: app}",
                "notes": [
                    "改 Git 即触发同步，集群状态永远追平仓库。",
                    "用 syncPolicy 开自动同步与健康检查。",
                ],
                "pitfalls": [
                    "没上 K8s 根本用不了，强行引入要先搭集群。",
                    "Git 里写错 yaml 会被 ArgoCD 忠实同步成错误态。",
                ],
            },
            {
                "id": "githubactions",
                "yamlNote": True,
                "name": "GitHub Actions",
                "badge": "通用",
                "summary": "GitHub Actions 用 YAML 在工作流里构建发布，与 GitHub 深度集成、生态丰富，但私有仓库分钟数受限、数据在境外。",
                "yaml": "jobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n    - uses: actions/checkout@v4\n    - run: mvn -q package",
                "notes": [
                    "用 secrets 注入云凭证，oidc 免长期 token。",
                    "matrix 并行测多 JDK 版本。",
                ],
                "pitfalls": [
                    "私有仓库免费额度有限，CI 频繁会超额。",
                    "构建日志与产物出境，敏感项目有合规顾虑。",
                ],
            },
        ],
    },
    {
        "id": "monitoring",
        "groupId": "ops",
        "name": "监控与告警",
        "why": "实例挂没挂、接口慢没慢、JVM 撑不撑，没有监控就只能等用户投诉，告警体系直接决定故障发现时间。",
        "defaultOption": "actuator",
        "options": [
            {
                "id": "actuator",
                "name": "Actuator",
                "badge": "轻量",
                "summary": "Spring Boot Actuator 暴露 /actuator/health 与 /actuator/prometheus，零侵入看健康与 JVM 指标，但只有单机视图、无历史无告警。",
                "yaml": "management:\n  endpoints.web.exposure.include: health,info,prometheus\n  endpoint.health.probes.enabled: true",
                "dependencies": [
                    {"groupId": "org.springframework.boot", "artifactId": "spring-boot-starter-actuator"},
                ],
                "notes": [
                    "开 livenessState 与 readinessState 供 K8s 探针调用。",
                    "prometheus 端点供后续接 Prometheus 拉取。",
                ],
                "pitfalls": [
                    "只有当前瞬时值，没有时间序列，无法看趋势也配不了告警。",
                ],
            },
            {
                "id": "promgrafana",
                "yamlNote": True,
                "name": "Prometheus+Grafana",
                "badge": "推荐",
                "summary": "Prometheus 拉取指标、Grafana 画图告警，云原生监控事实标准，开源免费、生态全，但需自建存储与保留策略。",
                "yaml": "scrape_configs:\n- job_name: app\n  metrics_path: /actuator/prometheus\n  static_configs:\n  - targets: ['app:8080']",
                "notes": [
                    "用 relabel 把实例标签打全，Grafana 按服务分组。",
                    "配 alertmanager 做告警收敛与路由。",
                ],
                "pitfalls": [
                    "默认本地 TSDB 不长期存，保留策略要自己定，磁盘会爆。",
                    "拉取间隔太密或 target 太多会拖垮 Prometheus。",
                ],
            },
            {
                "id": "zabbix",
                "yamlNote": True,
                "name": "Zabbix",
                "badge": "稳妥",
                "summary": "Zabbix 监控主机、网络与数据库等基础设施，Agent 成熟、告警灵活，但界面老旧、对容器动态实例发现较弱。",
                "yaml": "zabbix_agentd -c /etc/zabbix/zabbix_agentd.conf\n# 前端配 host + template 'Template App Java JMX'",
                "notes": [
                    "用 JMX 模板采 JVM，配合 jstatd 暴露端口。",
                    "trigger 配阈值与依赖，避免告警风暴。",
                ],
                "pitfalls": [
                    "容器 IP 漂移，自动发现要配主动注册否则漏采。",
                ],
            },
            {
                "id": "skywalking",
                "yamlNote": True,
                "name": "SkyWalking APM",
                "badge": "高阶",
                "summary": "SkyWalking 无侵入采集链路、拓扑与 JVM 指标，国产 APM 标杆，适合定位跨服务慢调用，但 OAP 集群运维不轻。",
                "yaml": "-javaagent:/skywalking/agent/skywalking-agent.jar\n-DSW_AGENT_NAME=app\n-DSW_AGENT_COLLECTOR_BACKEND_SERVICES=oap:11800",
                "notes": [
                    "用 agent 注入，业务代码零改动即可拿到链路。",
                    "拓扑图直接看服务依赖与慢调用热点。",
                ],
                "pitfalls": [
                    "OAP 用 ES 存储，数据量大时 ES 集群运维成本高。",
                    "采样率设太高会吃满后端存储。",
                ],
            },
            {
                "id": "cloudapm",
                "name": "云 APM",
                "badge": "高阶",
                "summary": "直接用云厂商 APM（如 ARMS/Cloud Monitor），免运维、自动埋点，但指标与告警绑定该云、导出困难、按量计费。",
                "yaml": "# 云控制台开启 APM，agent 由云探针自动挂载无需改代码",
                "notes": [
                    "探针随实例自动注入，免部署采集端。",
                    "告警直接进云消息与值班群。",
                ],
                "pitfalls": [
                    "指标与大盘绑定该云，迁出时历史数据难带走。",
                    "按探针数与数据量计费，流量大时账单可观。",
                ],
            },
        ],
    },
    {
        "id": "secret",
        "groupId": "ops",
        "name": "密钥与配置安全",
        "why": "数据库密码、API Key 放哪，决定了一旦泄露能不能快速吊销、合规能不能过，明文配置是最高频的安全事故来源。",
        "defaultOption": "file",
        "options": [
            {
                "id": "file",
                "name": "配置文件",
                "badge": "轻量",
                "summary": "把数据库密码等写进 application.yml 或环境变量，最简单，但密钥进版本库或镜像层，泄露无感知、轮换要重启。",
                # 这里绝不能写 spring.datasource.password 占位符：它是 secret 维度的默认项，
                # 一旦发出就会覆盖 database 选项给的连接配置，且裸占位符没有默认值会直接挡启动。
                # 这个选项的价值在「讲清楚安全底线」，不在「发配置键」。
                "yaml": "# 密钥进配置文件的三条底线：\n"
                        "#   1. 敏感值一律用 ${ENV_VAR:默认值} 占位 —— 带默认值本地可跑，生产由部署系统注入真实值\n"
                        "#   2. 明文绝不进 Git，也不进镜像层（构建时不要把 .env 一起 COPY 进去）\n"
                        "#   3. 默认值只给「本地开发方便」的空串或 guest 级账号，真实密钥永远来自环境",
                "notes": [
                    "用 ${DB_PWD} 占位从环境变量注入，别把明文提交进 Git。",
                    "镜像构建时不要把 .env 一起 COPY 进去。",
                ],
                "pitfalls": [
                    "密钥随镜像或仓库扩散，一旦泄露无法快速吊销，合规过不了。",
                ],
            },
            {
                "id": "configcenter",
                "name": "配置中心加密（Nacos）",
                "badge": "推荐",
                "summary": (
                    "把配置与密钥放进 Nacos 并加密存储，支持热更新与权限，"
                    "但多一套中间件、密钥仍可能落本地缓存。"
                    "⚠️ 勾它会拖进 spring-cloud-alibaba 依赖，启动时连 Nacos —— "
                    "单体项目没有 Nacos 就选「配置文件」。"
                ),
                "yaml": (
                    "# optional: 前缀 —— Nacos 没部署/连不上时跳过，不阻断本地启动；\n"
                    "# 没有它，nacos-config 在 classpath 时启动即因 import 检查失败退出\n"
                    "spring:\n"
                    "  config:\n"
                    "    import: optional:nacos:secret.yml\n"
                    "  cloud:\n"
                    "    nacos:\n"
                    "      config:\n"
                    "        server-addr: ${NACOS_ADDR:127.0.0.1:8848}\n"
                    "        username: ${NACOS_USER:nacos}\n"
                    "        password: ${NACOS_PASSWORD:nacos}\n"
                    "        extension-configs[0]:\n"
                    "          data-id: secret.yml\n"
                    "          refresh: true"
                ),
                "dependencies": [
                    {"groupId": "com.alibaba.cloud", "artifactId": "spring-cloud-starter-alibaba-nacos-config",
                     "version": "2023.0.1.3",
                     "note": "com.alibaba.cloud 不在 Boot BOM 管辖内，必须显式给版本；2023.0.1.x 配 Boot 3.2/3.3"},
                ],
                "notes": [
                    "敏感值用 AES 加密后存配置中心，应用侧自动解密。",
                    "按命名空间隔离环境，按权限控制谁能看密钥。",
                ],
                "pitfalls": [
                    "配置中心本身要是被攻破，等于密钥库失守，要加访问控制。",
                    "本地缓存明文若落盘，机器被拖库仍会泄露。",
                ],
            },
            {
                "id": "k8ssecret",
                "yamlNote": True,
                "name": "Kubernetes Secret",
                "badge": "通用",
                "summary": "用 Kubernetes Secret 以 Base64 存密钥并挂进 Pod，和集群原生融合，但默认不加密落盘、需开 KMS 加密才安全。",
                "yaml": "apiVersion: v1\nkind: Secret\nmetadata: {name: app}\ntype: Opaque\nstringData:\n  DB_PWD: s3cret",
                "notes": [
                    "用 secretKeyRef 注入环境变量或挂载文件，别打进镜像。",
                    "开 EncryptionConfiguration 用 KMS 加密 etcd 里的 Secret。",
                ],
                "pitfalls": [
                    "Base64 只是编码不是加密，etcd 明文可读等于裸奔。",
                    "没开 RBAC 限制，任意能读 Secret 的账号都能拿密钥。",
                ],
            },
            {
                "id": "vault",
                "yamlNote": True,
                "name": "HashiCorp Vault",
                "badge": "高阶",
                "summary": "HashiCorp Vault 提供动态密钥、自动轮换与短时令牌，安全等级最高，但部署复杂、需管理密封/解封与备份。",
                "yaml": "vault kv put secret/app DB_PWD=s3cret\nvault read secret/app\n# 注入用 vault-agent 或 sidecar",
                "notes": [
                    "用 AppRole 或 Kubernetes auth 让 Pod 动态领短时令牌。",
                    "数据库密钥可设 lease 自动过期与轮换。",
                ],
                "pitfalls": [
                    "Vault seal 后全集群取不到密钥，要有自动解封与 HA。",
                    "备份的 unseal key 丢了就永远开不了，保管要分片。",
                ],
                "dependencies": [],
            },
            {
                "id": "cloudkms",
                "yamlNote": True,
                "name": "云 KMS",
                "badge": "高阶",
                "summary": "用云 KMS 托管主密钥、应用运行时解密，密钥不落本地、合规省心，但解密调用依赖该云、离线环境不可用。",
                "yaml": "# 主密钥存 KMS，应用用 SDK 解密 envelope\naws kms decrypt --ciphertext-blob fileb://enc",
                "notes": [
                    "用信封加密，数据密钥本地用、主密钥只在 KMS。",
                    "密钥权限按 RAM 策略细粒度收敛。",
                ],
                "pitfalls": [
                    "解密依赖云网络，内网隔离或断网时应用起不来。",
                    "KMS 调用按次计费，高频解密要加本地缓存。",
                ],
            },
        ],
    },
    {
        "id": "logging",
        "groupId": "ops",
        "name": "日志与审计",
        "why": "出问题时能不能快速翻到对应日志、跨服务串联一次请求，日志方案决定了排障速度和审计能力，落盘就完事远远不够。",
        "defaultOption": "logback",
        "options": [
            {
                "id": "logback",
                "yamlNote": True,
                "name": "Logback 落盘",
                "badge": "轻量",
                "summary": "Spring Boot 默认 Logback 把日志落本地文件，零配置可用，但分散在各实例磁盘，查问题要登录多台机器翻文件。",
                "yaml": "<appender name=\"FILE\" class=\"ch.qos.logback.core.rolling.RollingFileAppender\">\n  <file>app.log</file>\n</appender>",
                "dependencies": [
                    {"groupId": "ch.qos.logback", "artifactId": "logback-classic"},
                ],
                "notes": [
                    "用 RollingFileAppender 按大小/天滚动，防止单文件撑爆磁盘。",
                    "打 MDC 把 traceId 带进每行，便于后续串联。",
                ],
                "pitfalls": [
                    "实例重启或容器销毁，本地日志随之消失，事后无法回溯。",
                ],
            },
            {
                "id": "elk",
                "yamlNote": True,
                "name": "ELK",
                "badge": "推荐",
                "summary": "Filebeat 把日志送 Elasticsearch、Kibana 检索，集中查询与可视化强，但 ES 吃内存、集群运维成本不低。",
                "yaml": "filebeat.inputs:\n- type: log\n  paths: ['/var/log/app/*.log']\noutput.elasticsearch:\n  hosts: ['es:9200']",
                "notes": [
                    "用 filebeat 轻量采集，ES 只存索引。",
                    "Kibana 建索引模式按 service 与 traceId 检索。",
                ],
                "pitfalls": [
                    "ES 默认吃一半内存，日志量大要单独扩容否则写入拒收。",
                    "索引不设置 lifecycle 策略，磁盘会被旧日志填满。",
                ],
            },
            {
                "id": "loki",
                "yamlNote": True,
                "name": "Loki+Promtail",
                "badge": "高阶",
                "summary": "Loki+Promtail 以标签索引日志、和 Grafana 一体，资源比 ELK 轻、查询便宜，但全文检索能力弱于 ES。",
                "yaml": "scrape_configs:\n- job_name: app\n  static_configs:\n  - targets: [localhost]\n    labels: {job: app, service: user}",
                "notes": [
                    "用标签（service/app）检索，不用全文倒排，省钱。",
                    "和 Prometheus/Grafana 同一栈，告警日志一体看。",
                ],
                "pitfalls": [
                    "标签基数爆炸（如把 traceId 当标签）会让 Loki 内存暴涨。",
                    "复杂全文检索不如 ES，搜模糊词体验差。",
                ],
            },
            {
                "id": "clickhouse",
                "yamlNote": True,
                "name": "ClickHouse 日志",
                "badge": "高阶",
                "summary": "用 ClickHouse 存日志，列存压缩高、亿级日志聚合秒回，适合做审计与离线分析，但需单独维护数据库与写入管道。",
                "yaml": "CREATE TABLE logs (ts DateTime, service String, msg String)\n  ENGINE = MergeTree ORDER BY (service, ts)",
                "notes": [
                    "用 Vector/Filebeat 转写，按服务分区便于审计查询。",
                    "列存压缩高，留一年日志成本也低。",
                ],
                "pitfalls": [
                    "要自己维护写入管道与表结构，运维比托管方案重。",
                    "高频小批量写入不攒批会拖垮写入性能。",
                ],
            },
            {
                "id": "cloudlog",
                "name": "云日志服务",
                "badge": "高阶",
                "summary": "用云日志服务（如 CLS/CloudWatch）自动采集、检索与告警，免运维、弹性好，但日志出域有合规顾虑、按量计费。",
                "yaml": "# 安装云 agent，配置 logpath 即可自动上报，无需自建管道",
                "notes": [
                    "agent 自动采集容器.stdout 与文件，零管道。",
                    "直接配关键词告警进值班群。",
                ],
                "pitfalls": [
                    "日志出境有合规顾虑，敏感行业先评估。",
                    "按写入与存储量计费，大流量成本不低。",
                ],
            },
        ],
    },
]

CAP_EXTRA = {
    "cap.ops.pipeline": "持续交付流水线",
    "cap.ops.pipeline.ci": "持续集成",
    "cap.ops.pipeline.gitops": "GitOps 交付",
    "cap.ops.metrics": "指标采集与告警",
    "cap.ops.metrics.jvm": "JVM 指标暴露",
    "cap.ops.metrics.scrape": "指标拉取",
    "cap.ops.apm": "应用性能监控",
    "cap.ops.trace": "分布式链路追踪",
    "cap.ops.hostmon": "主机与基础设施监控",
    "cap.ops.secret.cfg": "配置密钥管理",
    "cap.ops.secret.kms": "密钥管理服务",
    "cap.ops.secret.vault": "动态密钥保管库",
    "cap.ops.log": "日志收集与检索",
    "cap.ops.log.agg": "集中式日志聚合",
    "cap.ops.log.audit": "审计日志",
    "cap.ops.observ": "统一观测能力",
}

NODE_ARCH_EXTRA = {
    "cicd": {"lane": "delivery", "icon": "⇄", "role": "持续交付", "required": False,
             "recommended": False,
             "missing": "没有流水线，发布靠手工 scp 和 java -jar，出错难回滚、无法保证各环境产物一致。"},
    "monitoring": {"lane": "quality", "icon": "◉", "role": "监控告警", "required": False,
                   "recommended": True,
                   "missing": "没有监控，接口变慢或实例挂掉只能等用户投诉，无从得知 JVM 与依赖的健康趋势。"},
    "secret": {"lane": "quality", "icon": "⬢", "role": "密钥安全", "required": False,
               "recommended": True,
               "missing": "没有密钥管理，密码写进配置或镜像，泄露无感知、轮换要重启，合规审计直接不通过。"},
    "logging": {"lane": "quality", "icon": "⊟", "role": "日志审计", "required": False,
                "recommended": True,
                "missing": "没有集中日志，出问题要挨个登录实例翻文件，跨服务串联与审计溯源几乎不可能。"},
}

OPTION_ARCH_EXTRA = {
    "cicd": {
        "manual": {"provides": [], "requires": []},
        "jenkins": {"provides": ["cap.ops.pipeline.ci", "cap.ops.pipeline"], "requires": ["cap.rt.process"]},
        "gitlabci": {"provides": ["cap.ops.pipeline.ci", "cap.ops.pipeline"], "requires": ["cap.rt.process"]},
        "argocd": {"provides": ["cap.ops.pipeline.gitops", "cap.ops.pipeline"], "requires": ["cap.rt.k8s"]},
        "githubactions": {"provides": ["cap.ops.pipeline.ci", "cap.ops.pipeline"], "requires": []},
    },
    "monitoring": {
        "actuator": {"provides": ["cap.ops.metrics.jvm", "cap.ops.metrics.scrape"], "requires": ["cap.jvm"]},
        "promgrafana": {"provides": ["cap.ops.metrics", "cap.ops.metrics.scrape"], "requires": ["cap.rt.process"]},
        "zabbix": {"provides": ["cap.ops.hostmon", "cap.ops.metrics"], "requires": ["cap.rt.process"]},
        "skywalking": {"provides": ["cap.ops.apm", "cap.ops.trace"], "requires": ["cap.rt.process"]},
        "cloudapm": {"provides": ["cap.ops.apm", "cap.ops.trace"], "requires": []},
    },
    "secret": {
        "file": {"provides": [], "requires": []},
        "configcenter": {"provides": ["cap.ops.secret.cfg", "cap.config.center"], "requires": ["cap.rt.process"]},
        "k8ssecret": {"provides": ["cap.ops.secret.cfg"], "requires": ["cap.rt.k8s"]},
        "vault": {"provides": ["cap.ops.secret.vault", "cap.ops.secret.kms"], "requires": ["cap.rt.k8s"]},
        "cloudkms": {"provides": ["cap.ops.secret.kms"], "requires": []},
    },
    "logging": {
        "logback": {"provides": ["cap.ops.log"], "requires": ["cap.jvm"]},
        "elk": {"provides": ["cap.ops.log.agg", "cap.ops.log"], "requires": ["cap.rt.process"]},
        "loki": {"provides": ["cap.ops.log.agg", "cap.ops.log"], "requires": ["cap.rt.process"]},
        "clickhouse": {"provides": ["cap.ops.log.agg", "cap.ops.log.audit"], "requires": ["cap.rt.process"]},
        "cloudlog": {"provides": ["cap.ops.log.agg", "cap.ops.log"], "requires": []},
    },
}
