# -*- coding: utf-8 -*-
"""技术架构图的画图元信息 · 全栈扩展层。

stack_arch.py 里的 CANVAS_DIMS / CANVAS_OPTIONS 是「Java 侧那 18 个维度」的画图元信息。
本文件承担同样一件事，但只管**运行基石 / 数据生态 / 质量工程 / 运维安全 / 部署形态**
这五组新维度。

为什么单独成文件而不是改 stack_arch.py：
    stack_arch.py 已经有 1200 行且正在被别的工作线改动。画图元信息是纯增量数据，
    拆出来合并之后，两边谁都不会因为对方的一次改动而冲突。生成器在 build-content.py
    里把它们并进同一份 CANVAS_DIMS / CANVAS_OPTIONS，对下游渲染器完全透明。

两个硬约束（与 stack_arch.py 里的写法一致，违反会在构建期炸掉）：
    ① icon 必须是 arsenal-web/src/lib/tech-icons.ts 里真实存在的 key；
    ② place=node 时必须给 zone，且 zone 必须在 CANVAS_ZONES 里。

tech 字段（选项级）：
    同一 tech 字符串的「跨维度选项」在图上合并成同一个部署节点 —— 例如 deploy=k8s、
    os=k8s、orchestration=k8s 都是 Kubernetes，只画一个盒子而不是三个一模一样的 K8s。
    渲染器不猜「哪些维度是同一种技术」，这层事实由数据声明。选项没写 tech 时按
    （维度 id + 选项 id）生成唯一键，永不合并（避免把 Solr / Doris 这类同图标但不同
    系统的东西误并）。
"""

# ── 每个新维度在图上怎么出现 ──────────────────────────────
#   place  node    画成一个独立部署节点（真的会被部署、真的占一个进程）
#          appTag  收进应用卡的「工程属性」（构建期 / 编码期的东西）
#          side    挂在主线上的旁路件（发布期才起作用）
CANVAS_DIMS_EXTRA = {
    # 运行基石：都是「会被部署 / 会被配置」的东西，不是应用卡里的一行属性
    'os':             {'place': 'node', 'zone': 'platform'},
    'ingress':        {'place': 'node', 'zone': 'platform'},
    'gateway':        {'place': 'node', 'zone': 'platform'},
    'orchestration':  {'place': 'node', 'zone': 'platform'},
    'imageregistry':  {'place': 'node', 'zone': 'platform'},
    # 数据生态：各自一个独立进程，每加一个多一条同步链路
    'search':         {'place': 'node', 'zone': 'mw'},
    'analytics':      {'place': 'node', 'zone': 'mw'},
    'objectstore':    {'place': 'node', 'zone': 'mw'},
    # 质量工程：不部署，只影响应用怎么被构建与校验
    'testing':        {'place': 'appTag', 'tagLabel': '测试'},
    'qualitygate':    {'place': 'appTag', 'tagLabel': '门禁'},
    # 运维安全
    'monitoring':     {'place': 'node', 'zone': 'ops'},
    'secret':         {'place': 'node', 'zone': 'ops'},
    'logging':        {'place': 'node', 'zone': 'ops'},
    'cicd':           {'place': 'node', 'zone': 'platform'},
    # 部署形态：它不是一个组件，是横贯全局的一个决定 —— 画成旁路件
    'clustertopology': {'place': 'side', 'zone': 'platform', 'tagLabel': '集群形态'},
}

# ── 每个新选项的图标 ──────────────────────────────────────
#   icon   图标库 key（arsenal-web/src/lib/tech-icons.ts）
#   port   默认端口，写进连线标签供技术说明书引用
#   tech   技术身份（选项级）：同一 tech 的跨维度选项在图上合并成同一节点，
#          渲染器不猜「哪些维度是同一种技术」。详见文件头注释。
CANVAS_OPTIONS_EXTRA = {
    'os': {
        'bare':       {'icon': 'baremetal'},
        'vm':         {'icon': 'vm'},
        'container':  {'icon': 'docker', 'tech': 'docker'},
        'k8s':        {'icon': 'k8s', 'tech': 'kubernetes'},
        'serverless': {'icon': 'serverless'},
        'hybrid':     {'icon': 'rack'},
    },
    'ingress': {
        'direct':  {'icon': 'reverseproxy'},
        'nginx':   {'icon': 'nginx', 'port': '80/443'},
        'haproxy': {'icon': 'slb', 'port': '80/443'},
        'slb':     {'icon': 'slb', 'port': '443'},
        'lvs':     {'icon': 'anycast', 'port': '80'},
        'envoy':   {'icon': 'envoy', 'port': '80/443'},
        'f5':      {'icon': 'firewall', 'port': '443'},
    },
    'gateway': {
        'none':    {'icon': 'none'},
        'scg':     {'icon': 'gateway', 'port': '8080'},
        'apisix':  {'icon': 'apisix', 'port': '9080'},
        'kong':    {'icon': 'gateway', 'port': '8000'},
        'envoygw': {'icon': 'envoy', 'port': '8080'},
    },
    'orchestration': {
        'single':  {'icon': 'single'},
        'compose': {'icon': 'docker', 'tech': 'docker'},
        'swarm':   {'icon': 'docker', 'tech': 'docker'},
        'k8s':     {'icon': 'k8s', 'tech': 'kubernetes'},
        'k3s':     {'icon': 'k8s', 'tech': 'kubernetes'},
        'nomad':   {'icon': 'rack'},
    },
    'imageregistry': {
        'public':      {'icon': 'cloud'},
        'harbor':      {'icon': 'harbor', 'port': '443'},
        'nexus':       {'icon': 'nexus', 'port': '8081'},
        'artifactory': {'icon': 'artifactrepo', 'port': '8082'},
    },
    'search': {
        'none':       {'icon': 'none'},
        'es':         {'icon': 'elasticsearch', 'port': '9200'},
        'opensearch': {'icon': 'opensearch', 'port': '9200'},
        'solr':       {'icon': 'columnar', 'port': '8983'},
        'meili':      {'icon': 'timeseries', 'port': '7700'},
        'vector':     {'icon': 'graphdb', 'port': '19530'},
    },
    'analytics': {
        'none':       {'icon': 'none'},
        'clickhouse': {'icon': 'clickhouse', 'port': '8123'},
        'doris':      {'icon': 'columnar', 'port': '9030'},
        'starrocks':  {'icon': 'columnar', 'port': '9030'},
        'kylin':      {'icon': 'warehouse', 'port': '7070'},
        'lakehouse':  {'icon': 'datalake'},
    },
    'objectstore': {
        'none':  {'icon': 'none'},
        'minio': {'icon': 'minio', 'port': '9000'},
        's3':    {'icon': 'objectstore', 'port': '443'},
        'oss':   {'icon': 'objectstore', 'port': '443'},
        'ceph':  {'icon': 'fileshare', 'port': '7480'},
    },
    'testing': {
        'junit5':         {'icon': 'junit'},
        'testcontainers': {'icon': 'testcontainers'},
        'mockito':        {'icon': 'junit'},
        'wiremock':       {'icon': 'reverseproxy'},
        'jmeter':         {'icon': 'profiling'},
        'pact':           {'icon': 'thirdparty'},
        'pitest':         {'icon': 'profiling'},
    },
    'qualitygate': {
        'none':     {'icon': 'none'},
        'jacoco':   {'icon': 'profiling'},
        'sonar':    {'icon': 'sonarqube', 'port': '9000'},
        'mutation': {'icon': 'profiling'},
    },
    'monitoring': {
        'actuator':    {'icon': 'actuator'},
        'promgrafana': {'icon': 'prometheus', 'port': '9090', 'tech': 'prometheus'},
        'zabbix':      {'icon': 'apmproxy', 'port': '10051'},
        'skywalking':  {'icon': 'skywalking', 'port': '11800'},
        'cloudapm':    {'icon': 'apmproxy'},
    },
    'secret': {
        'file':         {'icon': 'configmgmt'},
        'configcenter': {'icon': 'configsync'},
        'k8ssecret':    {'icon': 'secret'},
        'vault':        {'icon': 'secret', 'port': '8200'},
        'cloudkms':     {'icon': 'kms'},
    },
    'logging': {
        'logback':    {'icon': 'logback'},
        'elk':        {'icon': 'elasticsearch', 'port': '9200'},
        'loki':       {'icon': 'loki', 'port': '3100'},
        'clickhouse': {'icon': 'clickhouse', 'port': '8123'},
        'cloudlog':   {'icon': 'logcollector'},
    },
    'cicd': {
        'manual':        {'icon': 'operator'},
        'jenkins':       {'icon': 'jenkins', 'port': '8080'},
        'gitlabci':      {'icon': 'gitlab'},
        'argocd':        {'icon': 'argocd', 'port': '443'},
        'githubactions': {'icon': 'cicd'},
    },
    'clustertopology': {
        'single':      {'icon': 'single'},
        'masterslave': {'icon': 'master-slave'},
        'cluster':     {'icon': 'replica'},
        'sharded':     {'icon': 'sharding'},
        'multiactive': {'icon': 'multiaz'},
    },
}
