# -*- coding: utf-8 -*-
"""运行基石组维度：运行环境 / 入口 / 网关 / 编排 / 制品库。"""

GROUPS_EXTRA = [
    {"id": "runtime", "name": "运行基石", "glyph": "▤",
     "desc": "决定进程跑在哪里、请求怎么进来。这一组反向约束业务代码：无状态、能水平扩容、配置外置。"},
    {"id": "ops", "name": "运维安全", "glyph": "⛨",
     "desc": "代码怎么变成线上服务、出问题怎么知道、密钥放哪里。选得越轻，出事时越被动。"},
]

DIMENSIONS = [
    {
        "id": "os",
        "groupId": "runtime",
        "name": "运行环境",
        "why": "进程到底跑在裸机、虚拟机还是容器里，直接决定扩容方式、配置下发和环境一致性，选错后面全要返工。",
        "defaultOption": "container",
        "options": [
            {
                "id": "bare",
                "yamlNote": True,
                "name": "裸机进程",
                "badge": "通用",
                "summary": "直接在宿主操作系统上以进程方式跑 jar，最省资源、零额外依赖，但扩容和配置下发全靠手工，环境一致性无法保证。",
                "yaml": "[Unit]\nDescription=mryang-app\n[Service]\nExecStart=/opt/app/bin/start.sh\nUser=app\nRestart=on-failure",
                "notes": [
                    "用 systemd 托管进程，配置 Restart=on-failure 让崩溃自动拉起。",
                    "JDK 版本、时区、字体等依赖都靠宿主环境，换机器要重装一遍。",
                ],
                "pitfalls": [
                    "多实例扩容需逐台机器部署，没有统一调度，滚动发布得自己写脚本。",
                ],
            },
            {
                "id": "vm",
                "yamlNote": True,
                "name": "虚拟机",
                "badge": "通用",
                "summary": "在虚拟机里跑进程，环境隔离比裸机好、可克隆镜像，但每个 VM 带完整操作系统，资源开销大、启动慢。",
                "yaml": "vagrant init ubuntu/jammy64\nvagrant up\nvagrant ssh -c 'java -jar /srv/app.jar'",
                "notes": [
                    "用 Packer 把装好 JDK 的虚拟机打成黄金镜像，克隆即上线。",
                    "虚机之间网络靠内网 IP，注意安全组与防火墙规则。",
                ],
                "pitfalls": [
                    "虚机常驻占用固定内存，低峰期利用率低，成本不如容器弹性。",
                ],
            },
            {
                "id": "container",
                "yamlNote": True,
                "name": "容器",
                "badge": "推荐",
                "summary": "用 Docker 把应用与依赖打包成镜像，环境一致、秒级启停，是绝大多数微服务的默认落点，但需维护构建与仓库。",
                "yaml": "FROM eclipse-temurin:21-jre\nCOPY app.jar /app.jar\nENTRYPOINT [\"java\",\"-jar\",\"/app.jar\"]",
                "notes": [
                    "多阶段构建，编译在 maven 镜像、运行用 jre 镜像，最终镜像控制在 200MB 内。",
                    "用 -XX:MaxRAMPercentage=75 让 JVM 跟着容器内存上限走，避免 OOMKilled。",
                ],
                "pitfalls": [
                    "容器里用默认 JVM 内存参数会撑满宿主，必须显式限制堆与容器内存。",
                ],
            },
            {
                "id": "k8s",
                "yamlNote": True,
                "name": "Kubernetes",
                "badge": "高阶",
                "summary": "Kubernetes 提供声明式编排、自愈与水平扩容，适合多服务多环境，但控制面与运维心智成本明显更高。",
                "yaml": "apiVersion: apps/v1\nkind: Deployment\nspec:\n  replicas: 3\n  template:\n    spec:\n      containers:\n      - name: app\n        image: registry/app:1.0",
                "notes": [
                    "用 HPA 按 CPU 或 QPS 自动扩缩，配合 readinessProbe 做无损发布。",
                    "配置走 ConfigMap、密钥走 Secret，绝不写进镜像。",
                ],
                "pitfalls": [
                    "Deployment 没配 livenessProbe，进程假死时 K8s 不会重启，流量持续打挂。",
                    "镜像 tag 用 latest 会导致滚动更新拉到旧缓存，必须固定版本号。",
                ],
            },
            {
                "id": "serverless",
                "yamlNote": True,
                "name": "Serverless 函数",
                "badge": "灵活",
                "summary": "以 Spring Cloud Function 打包成函数，按请求计费、免运维，但冷启动、超时与有状态限制让大部分业务跑不进去。",
                "yaml": "@Bean\npublic Function<String,String> uppercase(){\n  return s -> s.toUpperCase();\n}",
                "notes": [
                    "函数必须无状态，依赖注入在部署时绑定，运行期不保留内存。",
                    "注意平台 15 分钟执行上限与并发实例冷启动延迟。",
                ],
                "pitfalls": [
                    "长事务或长连接（如 WebSocket）在 Serverless 上会直接超时失败。",
                ],
            },
            {
                "id": "hybrid",
                "yamlNote": True,
                "name": "混合异构",
                "badge": "灵活",
                "summary": "核心服务跑 K8s、边缘推理跑裸机 GPU、批处理跑虚拟机，按负载选最合适的基座，但跨环境网络与运维规范要自己打通。",
                "yaml": "# core -> k8s | inference -> bare GPU | batch -> vm\nkubectl apply -f core.yaml\nbash gpu/run.sh\nssh vm 'java -jar batch.jar'",
                "notes": [
                    "用统一服务网格或 VPN 打通各基座网络，避免地址孤岛。",
                    "监控和密钥方案要能跨基座复用，否则运维翻倍。",
                ],
                "pitfalls": [
                    "异构环境各自一套发布与密钥流程，人员流动时极易出现盲区。",
                ],
            },
        ],
    },
    {
        "id": "ingress",
        "groupId": "runtime",
        "name": "入口与负载均衡",
        "why": "请求从哪进来、怎么做负载均衡，决定了 TLS、限流、灰度的统一程度，选直连还是代理直接左右扩容体验。",
        "defaultOption": "nginx",
        "options": [
            {
                "id": "direct",
                "name": "直连",
                "badge": "轻量",
                "summary": "客户端直连应用实例 IP:端口，零中间层、延迟最低，但实例地址写死在客户端，扩容和摘流量都要改配置重启。",
                "yaml": "server:\n  port: 8080\n  address: 0.0.0.0",
                "notes": [
                    "用 server.port 固定端口，多实例需手动分配不同端口避免冲突。",
                    "TLS 在每个实例各自配置，证书轮换要挨个改。",
                ],
                "pitfalls": [
                    "没有统一入口，扩一个新实例就得改所有客户端配置并重启。",
                ],
            },
            {
                "id": "nginx",
                "yamlNote": True,
                "name": "Nginx 反向代理",
                "badge": "推荐",
                "summary": "用 Nginx 做七层反向代理与负载均衡，配置成熟、性能稳，单机可扛万级并发，是绝大多数项目的默认入口。",
                "yaml": "upstream app { server 10.0.0.1:8080; server 10.0.0.2:8080; }\nserver {\n  listen 80;\n  location /api/ { proxy_pass http://app; }\n}",
                "notes": [
                    "用 proxy_set_header Host $host 透传域名，开 proxy_next_upstream 做故障转移。",
                    "TLS  termination 放在 Nginx，后端走内网 HTTP 省算力。",
                ],
                "pitfalls": [
                    "默认轮询不感知后端负载，慢实例会拖垮整组，需加 least_conn。",
                ],
            },
            {
                "id": "haproxy",
                "yamlNote": True,
                "name": "HAProxy",
                "badge": "稳妥",
                "summary": "HAProxy 专注四/七层负载均衡，连接数与健康检查能力比 Nginx 更强，适合长连接和极高性能入口场景。",
                "yaml": "frontend http\n  bind :80\n  default_backend app\nbackend app\n  server a1 10.0.0.1:8080 check\n  server a2 10.0.0.2:8080 check",
                "notes": [
                    "用 option httpchk 做应用级健康检查，比 TCP 探活更准。",
                    "支持 stick-table 做会话保持与限流计数。",
                ],
                "pitfalls": [
                    "默认配置不做 TLS 终结，需额外配 cert 与 ssl 前端。",
                ],
            },
            {
                "id": "slb",
                "yamlNote": True,
                "name": "云负载均衡",
                "badge": "通用",
                "summary": "直接用云厂商负载均衡（如 ALB/CLB），免运维、自带证书与可用区容灾，但流量与规则被绑定在单一云，跨云迁移成本高。",
                "yaml": "aws elbv2 create-load-balancer --name app --subnets s1 s2\naliyun slb CreateLoadBalancer --LoadBalancerName app",
                "notes": [
                    "把后端实例挂到目标组/后端服务器组，探活走 HTTP 状态码。",
                    "证书在云控制台托管，自动续签免运维。",
                ],
                "pitfalls": [
                    "规则与配额绑定该云，搬到其他云要重写整套入口配置。",
                ],
            },
            {
                "id": "lvs",
                "yamlNote": True,
                "name": "LVS+Keepalived",
                "badge": "高阶",
                "summary": "LVS+Keepalived 做四层 DR 模式转发，性能接近线速、支撑百万并发，但需要内核参数调优与双机 VIP 漂移，运维门槛高。",
                "yaml": "vrrp_instance VI { virtual_router_id 51; virtual_ipaddress { 10.0.0.100 } }\nvirtual_server 10.0.0.100 80 { lb_algo rr; real_server 10.0.0.1 80 { } }",
                "notes": [
                    "DR 模式下 Real Server 需把 VIP 配在 lo 回环并抑制 ARP。",
                    "Keepalived 双机心跳走独立网卡，避免脑裂。",
                ],
                "pitfalls": [
                    "ARP 抑制漏配会导致 VIP 抢答混乱，整组入口抖动。",
                    "纯四层不解析 HTTP，无法按路径或域名分流。",
                ],
            },
            {
                "id": "envoy",
                "yamlNote": True,
                "name": "Envoy+Istio",
                "badge": "高阶",
                "summary": "Envoy 作为边车代理配合 Istio 提供精细流量治理、mTLS 与可观测，是 Service Mesh 标配，但引入控制面后复杂度陡增。",
                "yaml": "apiVersion: networking.istio.io/v1beta1\nkind: Gateway\nmetadata: {name: app-gw}\nspec:\n  servers:\n  - port: {number: 443, name: https}\n    hosts: [\"*\"]",
                "notes": [
                    "边车自动注入，应用无感知即可获得重试、熔断与指标。",
                    "用 VirtualService 做金丝雀，按权重切 5% 流量。",
                ],
                "pitfalls": [
                    "控制面 Istiod 挂掉会导致新连接规则下发停滞。",
                    "边车吃内存，每个 Pod 多 100MB+，密度高时要算账。",
                ],
            },
            {
                "id": "f5",
                "yamlNote": True,
                "name": "F5 硬件",
                "badge": "高阶",
                "summary": "F5 硬件负载均衡提供金融级吞吐、SSL 卸载与策略引擎，稳定性极强，但设备昂贵、配置依赖专有控制台、弹性差。",
                "yaml": "tmsh create ltm pool app members add { 10.0.0.1:8080 }\ntmsh create ltm virtual vip destination 10.0.0.100:443 pool app",
                "notes": [
                    "SSL 卸载在 F5 上做，后端只收明文内网流量。",
                    "iRules 可做复杂七层改写与限速策略。",
                ],
                "pitfalls": [
                    "硬件扩容靠采购，突发流量顶不住时无法秒级弹性。",
                ],
            },
        ],
    },
    {
        "id": "gateway",
        "groupId": "runtime",
        "name": "API 网关",
        "why": "鉴权、限流、灰度这些横切逻辑放不放网关，决定了每个服务要不要重复造轮子，是架构复杂度的分水岭。",
        "defaultOption": "none",
        "options": [
            {
                "id": "none",
                "name": "无",
                "badge": "轻量",
                "summary": "不引入独立网关，由 Nginx/SLB 直接路由到服务，架构最轻、运维最少，但限流、鉴权、灰度等能力要分散到每个服务自己实现。",
                "yaml": "# 直接由 ingress 层路由，无独立网关进程",
                "notes": [
                    "鉴权和限流需要各服务用 Spring Security / Resilience4j 各自实现。",
                    "服务数少于 3 个时，引入网关反而是负担。",
                ],
                "pitfalls": [
                    "服务数量变多后，统一熔断、路径重写和灰度发布会难以收敛。",
                ],
            },
            {
                "id": "scg",
                "name": "Spring Cloud Gateway",
                "badge": "推荐",
                "summary": "Spring Cloud Gateway 用 Java 写路由与过滤器，和 Spring 生态无缝集成，适合做鉴权、限流、灰度等统一入口逻辑。",
                "yaml": "spring:\n  cloud:\n    gateway:\n      routes:\n      - id: user\n        uri: lb://user-svc\n        predicates:\n        - Path=/api/user/**",
                "dependencies": [
                    {"groupId": "org.springframework.cloud", "artifactId": "spring-cloud-starter-gateway"},
                ],
                "notes": [
                    "用 GatewayFilter 统一加鉴权头、限流用 RequestRateLimiter 过滤器。",
                    "基于 WebFlux，依赖里不能混用阻塞式 spring-webmvc。",
                ],
                "pitfalls": [
                    "引入了 spring-boot-starter-web 会和 WebFlux 冲突导致启动失败。",
                    "默认路由全在内存，多实例需接配置中心才能一致。",
                ],
            },
            {
                "id": "apisix",
                "yamlNote": True,
                "name": "Apache APISIX",
                "badge": "高阶",
                "summary": "Apache APISIX 基于 Nginx+Lua/etcd，动态路由热更新、插件丰富，性能高于 Java 网关，适合高并发与多云统一网关。",
                "yaml": "curl -X PUT apisix/admin/routes/1 -d '\n  {\"uri\":\"/api/*\",\"upstream\":{\"nodes\":{\"10.0.0.1:8080\":1}}}'",
                "notes": [
                    "路由改完秒级生效，不用 reload 进程。",
                    "限流、JWT、灰度插件开箱即用，配置在 etcd。",
                ],
                "pitfalls": [
                    "Lua 插件出 bug 难以用 Java 栈排查，团队要补 Lua 能力。",
                    "依赖 etcd 集群，etcd 抖动会让路由下发卡住。",
                ],
            },
            {
                "id": "kong",
                "yamlNote": True,
                "name": "Kong",
                "badge": "高阶",
                "summary": "Kong 以 OpenResty 为底座、插件生态庞大，企业集成成熟，但 Lua 插件开发与调试门槛高于配置式网关。",
                "yaml": "curl -X POST :8001/services --data name=app --data url=http://10.0.0.1:8080\ncurl -X POST :8001/services/app/routes --data paths=/api",
                "notes": [
                    "插件（key-auth、rate-limiting）挂在 service 或 route 上。",
                    "企业版带 Kong Manager 图形化，开源版靠 admin API。",
                ],
                "pitfalls": [
                    "自定义插件要写 Lua，调试靠日志，Java 团队上手慢。",
                ],
            },
            {
                "id": "envoygw",
                "yamlNote": True,
                "name": "Envoy Gateway",
                "badge": "高阶",
                "summary": "Envoy Gateway 用 Kubernetes Gateway API 标准驱动 Envoy，声明式、和 K8s 原生融合，是 mesh 与网关统一的方向，但落地资料仍少。",
                "yaml": "apiVersion: gateway.networking.k8s.io/v1\nkind: Gateway\nmetadata: {name: eg}\nspec:\n  gatewayClassName: envoy\n  listeners:\n  - name: https port: 443",
                "notes": [
                    "用标准 Gateway API，未来换实现不用改业务配置。",
                    "策略走 EnvoyPatchPolicy 做细调。",
                ],
                "pitfalls": [
                    "部分高级路由特性尚不支持，踩坑要读 issue。",
                    "强绑定 K8s，裸机环境用不了。",
                ],
            },
        ],
    },
    {
        "id": "orchestration",
        "groupId": "runtime",
        "name": "编排与调度",
        "why": "多实例怎么启停、挂了谁来拉起、发布怎么滚动，编排方式决定了运维自动化上限，也反向约束应用是否无状态。",
        "defaultOption": "single",
        "options": [
            {
                "id": "single",
                "yamlNote": True,
                "name": "单进程",
                "badge": "轻量",
                "summary": "单进程 jar 自己跑，最简单、零编排，但只能纵向扩容，挂了靠外部守护进程拉起，不适合多实例协同。",
                "yaml": "nohup java -jar app.jar > app.log 2>&1 &",
                "notes": [
                    "配合 systemd 或 nohup 保证进程存活。",
                    "升级就是停进程换 jar 再起，有短暂中断。",
                ],
                "pitfalls": [
                    "多个实例需人工在不同机器启动并分配端口，无统一服务发现。",
                ],
            },
            {
                "id": "compose",
                "yamlNote": True,
                "name": "Docker Compose",
                "badge": "通用",
                "summary": "Docker Compose 用一份 yaml 拉起多容器，本地与单机部署极方便，但缺乏跨主机调度与生产级自愈，不适合真正集群。",
                "yaml": "services:\n  app:\n    image: registry/app:1.0\n    ports: [\"8080:8080\"]\n  redis:\n    image: redis:7",
                "notes": [
                    "docker compose up -d 一条命令拉起整套依赖。",
                    "用 depends_on 控制启动顺序。",
                ],
                "pitfalls": [
                    "Compose 不跨主机，单机挂掉整套服务跟着挂。",
                    "无健康检查驱动的自动重启，需配 restart: unless-stopped。",
                ],
            },
            {
                "id": "swarm",
                "yamlNote": True,
                "name": "Docker Swarm",
                "badge": "稳妥",
                "summary": "Docker Swarm 在 Compose 基础上加集群调度与多副本，学习成本低，但生态与功能已被 Kubernetes 全面压制，新项目少选。",
                "yaml": "docker swarm init\ndocker stack deploy -c docker-compose.yml app",
                "notes": [
                    "docker service scale 即可横向扩副本。",
                    "内置 overlay 网络打通跨主机容器。",
                ],
                "pitfalls": [
                    "社区活跃度低，新特性与第三方集成远少于 K8s。",
                ],
            },
            {
                "id": "k8s",
                "yamlNote": True,
                "name": "Kubernetes",
                "badge": "高阶",
                "summary": "Kubernetes 声明式管理多副本、滚动发布与自愈，是生产集群事实标准，但 yaml 多、概念重，小项目会觉得杀鸡用牛刀。",
                "yaml": "kubectl apply -f deployment.yaml\nkubectl set image deploy/app app=registry/app:1.1",
                "notes": [
                    "rollout status 可看发布进度，rollout undo 一键回滚。",
                    "用 namespace 隔离环境，ResourceQuota 限资源。",
                ],
                "pitfalls": [
                    "yaml 字段拼错只给模糊报错，排错需要熟读 API。",
                    "节点资源规划不足会触发驱逐风暴。",
                ],
            },
            {
                "id": "k3s",
                "yamlNote": True,
                "name": "K3s 轻量",
                "badge": "高阶",
                "summary": "K3s 是砍掉非核心组件的轻量 K8s，单二进制、512M 即可跑，适合边缘和小型集群，但少数上游特性被精简。",
                "yaml": "curl -sfL https://get.k3s.io | sh -\nkubectl apply -f deployment.yaml",
                "notes": [
                    "默认用 containerd，自带 Traefik 做入口。",
                    "边缘节点用 agent 模式只跑工作负载。",
                ],
                "pitfalls": [
                    "部分 K8s .alpha 特性被精简，用到要先确认支持。",
                ],
            },
            {
                "id": "nomad",
                "yamlNote": True,
                "name": "Nomad",
                "badge": "高阶",
                "summary": "HashiCorp Nomad 调度容器/二进制/Java 任务，比 K8s 轻、跨数据中心简单，但生态与社区规模远小于 Kubernetes。",
                "yaml": "job \"app\" {\n  group \"g\" {\n    task \"web\" { driver = \"docker\" config { image = \"registry/app:1.0\" } }\n  }\n}",
                "notes": [
                    "job 文件可调度 Docker、raw_exec、Java 多种任务。",
                    "常和 Consul 配合做服务发现。",
                ],
                "pitfalls": [
                    "插件与上层生态（CI、监控）不如 K8s 丰富。",
                ],
            },
        ],
    },
    {
        "id": "imageregistry",
        "groupId": "runtime",
        "name": "镜像与制品库",
        "why": "构建出的镜像放哪、怎么溯源和复用，决定了 CI 与各环境部署是否用同一份产物，也关系密钥与合规。",
        "defaultOption": "public",
        "options": [
            {
                "id": "public",
                "yamlNote": True,
                "name": "公有云仓库",
                "badge": "轻量",
                "summary": "直接用 Docker Hub 或云厂商镜像仓库，零搭建、拉取即用，但镜像公开或受速率限制，私有关键镜像有泄露与合规风险。",
                "yaml": "docker tag app:1.0 registry.cn/app:1.0\ndocker push registry.cn/app:1.0",
                "notes": [
                    "push 前先 docker tag 成完整仓库地址。",
                    "用访问凭证登录，别把 token 写进 CI 明文。",
                ],
                "pitfalls": [
                    "Docker Hub 匿名拉取限 100 次/6h，CI 高峰期会被限流。",
                    "公开仓库误推带密钥的镜像会直接泄露。",
                ],
            },
            {
                "id": "harbor",
                "yamlNote": True,
                "name": "Harbor",
                "badge": "推荐",
                "summary": "Harbor 是带权限、漏洞扫描和镜像签名的私有仓库，满足企业合规，但需要单独部署维护一套存储与证书。",
                "yaml": "helm repo add harbor https://helm.goharbor.io\nhelm install harbor harbor/harbor --set persistence.enabled=true",
                "notes": [
                    "开 trivy 扫描，高危漏洞镜像禁止拉取。",
                    "用项目级成员权限隔离不同团队镜像。",
                ],
                "pitfalls": [
                    "默认用的 Postgres 与 Redis 也要备份，否则仓库元数据丢失。",
                    "证书过期会导致所有节点 docker pull 失败。",
                ],
            },
            {
                "id": "nexus",
                "yamlNote": True,
                "name": "Nexus",
                "badge": "通用",
                "summary": "Sonatype Nexus 同时托管镜像与 Maven/npm 制品，一套管理多类依赖，但对纯镜像场景配置偏重。",
                "yaml": "docker run -d -p 8081:8081 sonatype/nexus3\n# 建 docker hosted 仓库后 push",
                "notes": [
                    "一个 Nexus 管 jar 包和镜像，依赖收敛到一处。",
                    "用 blob store 分磁盘，避免镜像撑爆系统盘。",
                ],
                "pitfalls": [
                    "默认内存偏小，大镜像并发推送容易 OOM 退出。",
                ],
            },
            {
                "id": "artifactory",
                "yamlNote": True,
                "name": "JFrog Artifactory",
                "badge": "高阶",
                "summary": "JFrog Artifactory 统一管理镜像、包与构建元数据，企业级合规与溯源强，但授权费用高、资源占用大。",
                "yaml": "curl -u admin:pass -X PUT https://artifactory/api/docker/app/v2/app/manifests/1.0",
                "notes": [
                    "构建元数据（build info）可追溯每次发布的来源。",
                    "Xray 做深度依赖与 licence 扫描。",
                ],
                "pitfalls": [
                    "商业授权按节点计费，小团队成本不划算。",
                ],
            },
        ],
    },
]

CAP_EXTRA = {
    "cap.rt.process": "进程运行环境",
    "cap.rt.vm": "虚拟机运行环境",
    "cap.rt.container": "容器运行环境",
    "cap.rt.k8s": "Kubernetes 运行环境",
    "cap.rt.serverless": "Serverless 运行环境",
    "cap.rt.hybrid": "混合异构运行环境",
    "cap.rt.entry.direct": "直连入口",
    "cap.rt.entry.proxy": "反向代理入口",
    "cap.rt.lb.l7": "七层负载均衡",
    "cap.rt.lb.l4": "四层负载均衡",
    "cap.rt.lb.cloud": "云负载均衡",
    "cap.rt.ha.vip": "高可用虚拟IP",
    "cap.rt.gateway": "API 网关路由",
    "cap.rt.gateway.scg": "Spring Cloud 网关",
    "cap.rt.orchestrate": "容器编排调度",
    "cap.rt.orchestrate.light": "轻量编排",
    "cap.rt.artifact": "镜像制品库",
    "cap.rt.artifact.private": "私有制品库",
}

NODE_ARCH_EXTRA = {
    "os": {"lane": "base", "icon": "⌘", "role": "运行时基座", "required": False,
           "recommended": True,
           "missing": "没有明确运行基座，进程跑在哪、怎么重启都说不清，环境差异会让‘我机器上能跑’反复出现。"},
    "ingress": {"lane": "entry", "icon": "⇥", "role": "流量入口", "required": False,
                "recommended": True,
                "missing": "没有统一入口，每个实例各自对外暴露端口，扩容和摘流量都要手工改客户端配置。"},
    "gateway": {"lane": "entry", "icon": "⇉", "role": "网关路由", "required": False,
                "recommended": False,
                "missing": "没有网关，鉴权限流灰度逻辑散落在各服务，接口治理随服务数增多而失控。"},
    "orchestration": {"lane": "delivery", "icon": "⊞", "role": "编排调度", "required": False,
                      "recommended": False,
                      "missing": "缺少编排，多实例启停靠手工，挂掉不会自愈，发布只能停机或写临时脚本。"},
    "imageregistry": {"lane": "delivery", "icon": "❐", "role": "制品仓库", "required": False,
                      "recommended": False,
                      "missing": "没有制品库，镜像在本地散落、无版本溯源，CI 与多环境部署无法复用同一份产物。"},
}

OPTION_ARCH_EXTRA = {
    "os": {
        "bare": {"provides": ["cap.rt.process"]},
        "vm": {"provides": ["cap.rt.process", "cap.rt.vm"]},
        "container": {"provides": ["cap.rt.process", "cap.rt.container"]},
        "k8s": {"provides": ["cap.rt.process", "cap.rt.container", "cap.rt.k8s", "cap.rt.orchestrate"]},
        "serverless": {"provides": ["cap.rt.process", "cap.rt.serverless"]},
        "hybrid": {"provides": ["cap.rt.process", "cap.rt.container", "cap.rt.k8s", "cap.rt.hybrid"]},
    },
    "ingress": {
        "direct": {"provides": ["cap.rt.entry.direct"]},
        "nginx": {"provides": ["cap.rt.lb.l7", "cap.rt.entry.proxy"]},
        "haproxy": {"provides": ["cap.rt.lb.l7", "cap.rt.lb.l4", "cap.rt.entry.proxy"]},
        "slb": {"provides": ["cap.rt.lb.cloud", "cap.rt.lb.l7"]},
        "lvs": {"provides": ["cap.rt.lb.l4", "cap.rt.ha.vip"], "requires": ["cap.rt.process"]},
        "envoy": {"provides": ["cap.rt.lb.l7", "cap.rt.entry.proxy"], "requires": ["cap.rt.k8s"]},
        "f5": {"provides": ["cap.rt.lb.l4", "cap.rt.lb.l7"], "requires": ["cap.rt.process"]},
    },
    "gateway": {
        "none": {"provides": [], "requires": []},
        "scg": {"provides": ["cap.rt.gateway", "cap.rt.gateway.scg"]},
        "apisix": {"provides": ["cap.rt.gateway"], "requires": ["cap.rt.container"]},
        "kong": {"provides": ["cap.rt.gateway"], "requires": ["cap.rt.container"]},
        "envoygw": {"provides": ["cap.rt.gateway"], "requires": ["cap.rt.k8s"]},
    },
    "orchestration": {
        "single": {"provides": ["cap.rt.process"]},
        "compose": {"provides": ["cap.rt.orchestrate.light"], "requires": ["cap.rt.container"]},
        "swarm": {"provides": ["cap.rt.orchestrate"], "requires": ["cap.rt.container"]},
        "k8s": {"provides": ["cap.rt.orchestrate", "cap.rt.k8s"]},
        "k3s": {"provides": ["cap.rt.orchestrate", "cap.rt.k8s"]},
        "nomad": {"provides": ["cap.rt.orchestrate"], "requires": ["cap.rt.container"]},
    },
    "imageregistry": {
        "public": {"provides": ["cap.rt.artifact"]},
        "harbor": {"provides": ["cap.rt.artifact", "cap.rt.artifact.private"], "requires": ["cap.rt.container"]},
        "nexus": {"provides": ["cap.rt.artifact", "cap.rt.artifact.private"], "requires": ["cap.rt.container"]},
        "artifactory": {"provides": ["cap.rt.artifact", "cap.rt.artifact.private"], "requires": ["cap.rt.container"]},
    },
}
