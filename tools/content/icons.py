# -*- coding: utf-8 -*-
"""图标资产库的事实源。

这里只登记「有这个图标、它叫什么、归哪一类、矢量 key 是哪个」，
不画图形 —— 图形在 `arsenal-web/src/lib/tech-icons.ts`（矢量）与
`arsenal-web/public/icons/**`（位图）两处，各管一段：

    矢量（tech-icons.ts）  手绘 SVG，架构图节点、装配台、IR 组件用得上
    位图（public/icons/**） 生图产出，卡片配图 / 文档插图 / 页面 hero 用

两套并存不是重复劳动：架构图要的是能随 currentColor 变色、能进 SVG 导出的
矢量；位图要的是质感和光影。把位图塞进架构图，导出就成了一堆外链，
换个环境全变白块。

`bitmap` 为空串是**合法状态**，意思是「这张还没生成」—— 生成器与同步脚本
都不许把它当成缺字段。位图是分批补的，登记先于产出是常态。
"""

# 九大类。分类名在位图目录名、icons.json 的 category、侧栏分组三处共用，
# 写错一处就变成「图有、页面上找不到」。
CATEGORIES = [
    dict(id='actor', name='角色与外部', accent='#4A5568',
         desc='谁在用系统：人、终端、外部系统、AI'),
    dict(id='compute', name='计算与运行', accent='#3E9B4F',
         desc='东西跑在哪：物理机、虚机、容器、函数、边缘、GPU'),
    dict(id='network', name='网络与入口', accent='#2F6FBA',
         desc='请求怎么进来：DNS、CDN、网关、防火墙、专线、专网'),
    dict(id='storage', name='存储', accent='#0F9B8E',
         desc='东西放哪：库、仓、湖、对象、归档、目录'),
    dict(id='middleware', name='中间件', accent='#7C5CBF',
         desc='组件之间怎么说话：RPC、事务、网格、配置同步、流'),
    dict(id='observe', name='观测与运维', accent='#D97B29',
         desc='出事怎么知道：日志、链路、告警、看板、备份、体检'),
    dict(id='security', name='安全', accent='#C4453C',
         desc='怎么证明你是谁：认证、授权、密钥、证书、审计'),
    dict(id='delivery', name='交付与工程', accent='#55606E',
         desc='怎么发出去：流水线、仓库、IaC、灰度、回滚'),
    dict(id='topology', name='形态', accent='#2F6FBA',
         desc='一个还是多个：单实例、副本、主从、分片、双活'),
]

CATEGORY_IDS = [c['id'] for c in CATEGORIES]

# 生图风格前缀。每张位图都带这一段，只改主体描述 ——
# 目的是让 80 张图看起来像同一套，而不是 80 次独立发挥。
STYLE_PREFIX = (
    'flat vector icon, software architecture diagram symbol, thin uniform 2px stroke, '
    'single accent color {accent}, plain white background, centered, no text, no letters, '
    'no numbers, no watermark, minimal, technical, 512x512'
)


def _i(key, name, en, category, tags, subject):
    return dict(
        key=key,
        name=name,
        en=en,
        category=category,
        tags=tags,
        # 矢量 key 与资产 key 同名：改 tech-icons.ts 的 key 会在这里立刻炸，
        # 而不是等页面上出现一排灰方块
        vector=key,
        bitmap='',
        subject=subject,
    )


ICONS = [
    # ── actor ────────────────────────────────────────────────
    _i('user', '用户', 'End User', 'actor', ['人', '使用者', '终端用户'], 'a single person bust silhouette'),
    _i('admin', '管理员', 'Administrator', 'actor', ['人', '权限', '后台'], 'a person bust with a small shield badge'),
    _i('operator', '运维人员', 'Operator', 'actor', ['人', '运维', '值班'], 'a person bust beside a small gear'),
    _i('auditor', '审计 / 审核方', 'Auditor', 'actor', ['人', '审计', '合规'], 'a clipboard with a check mark'),
    _i('mobile', '移动端', 'Mobile Client', 'actor', ['终端', '手机', 'APP'], 'a smartphone in portrait'),
    _i('bigscreen', '大屏 / 看板', 'Wall Dashboard', 'actor', ['终端', '大屏', '看板'], 'a large wall-mounted screen with a chart'),
    _i('thirdparty', '第三方系统', 'Third-party System', 'actor', ['外部', '对接', '接口'], 'a server box with an outgoing arrow'),
    _i('legacy', '遗留系统', 'Legacy System', 'actor', ['外部', '遗留', '老系统'], 'an old tower computer case'),
    _i('ai', 'AI / 模型服务', 'AI Service', 'actor', ['外部', 'AI', '模型'], 'a microchip with radiating pins'),
    _i('devops', 'DevOps / 平台工程', 'DevOps', 'actor', ['人', '平台', '协作'], 'a ring with two opposite arrows'),

    # ── compute ──────────────────────────────────────────────
    _i('vm', '虚拟机', 'Virtual Machine', 'compute', ['运行', '虚机', '宿主'], 'two stacked server trays'),
    _i('baremetal', '物理机', 'Bare Metal', 'compute', ['运行', '物理机', '宿主机'], 'a tall tower server with slots'),
    _i('pod', 'Pod / 容器组', 'Container Pod', 'compute', ['运行', '容器', 'K8s'], 'a hexagon containing a small square'),
    _i('serverless', 'Serverless / 函数', 'Serverless Function', 'compute', ['运行', '函数', 'FaaS'], 'a lambda symbol over a dashed line'),
    _i('edge', '边缘节点', 'Edge Node', 'compute', ['运行', '边缘', '就近'], 'a globe with a horizontal band'),
    _i('gpu', 'GPU 节点', 'GPU Node', 'compute', ['运行', 'GPU', '算力'], 'a card with cooling fins'),
    _i('batch', '批处理 / 离线任务', 'Batch Job', 'compute', ['运行', '批处理', '离线'], 'queued blocks moving right through a gate'),
    _i('cloud', '云平台', 'Cloud Platform', 'compute', ['运行', '云', '托管'], 'a simple cloud outline'),
    _i('rack', '机柜', 'Server Rack', 'compute', ['运行', '机柜', '机房'], 'a tall rack cabinet with shelves'),
    _i('zone', '可用区', 'Availability Zone', 'compute', ['运行', '可用区', 'AZ'], 'two dashed circles side by side'),
    _i('autoscale', '弹性伸缩', 'Auto Scaling', 'compute', ['运行', '伸缩', '扩容'], 'a block with up and down arrows'),

    # ── network ──────────────────────────────────────────────
    _i('cdn', 'CDN 加速', 'CDN', 'network', ['入口', '加速', '边缘'], 'a center node with four edge nodes around it'),
    _i('waf', 'WAF 防火墙', 'WAF', 'network', ['入口', '防护', '安全'], 'a shield with horizontal grid lines'),
    _i('dns', 'DNS 解析', 'DNS', 'network', ['入口', '域名', '解析'], 'a name box linked to an address box'),
    _i('reverseproxy', '反向代理', 'Reverse Proxy', 'network', ['入口', '代理', '转发'], 'two bars with opposite arrows between them'),
    _i('firewall', '防火墙', 'Firewall', 'network', ['入口', '防护', '边界'], 'a brick wall with staggered joints'),
    _i('vpc', 'VPC 私有网络', 'VPC', 'network', ['网络', '私网', '隔离'], 'a big rounded box with two small boxes inside'),
    _i('subnet', '子网', 'Subnet', 'network', ['网络', '子网', '网段'], 'a dashed box with three connected dots'),
    _i('secgroup', '安全组', 'Security Group', 'network', ['网络', '安全组', '策略'], 'a shield containing three small dots'),
    _i('privateline', '专线 / 内网直连', 'Private Line', 'network', ['网络', '专线', '直连'], 'two endpoints joined by a thick straight line'),
    _i('anycast', 'Anycast 任播', 'Anycast', 'network', ['网络', '任播', '就近'], 'one source dot splitting to three targets'),
    _i('apmproxy', 'APM 探针', 'APM Agent', 'network', ['观测', '探针', '旁路'], 'a center dot with two concentric signal arcs'),

    # ── storage ──────────────────────────────────────────────
    _i('timeseries', '时序库', 'Time Series DB', 'storage', ['存储', '时序', '监控'], 'a rising zigzag line over a baseline'),
    _i('graphdb', '图数据库', 'Graph DB', 'storage', ['存储', '图', '关系'], 'three dots joined by three edges'),
    _i('columnar', '列式存储', 'Columnar Store', 'storage', ['存储', '列式', '分析'], 'three vertical bars of decreasing opacity'),
    _i('objectstore', '对象存储', 'Object Storage', 'storage', ['存储', '对象', 'OSS'], 'a bucket with a handle'),
    _i('fileshare', '文件共享', 'File Share', 'storage', ['存储', '文件', '共享'], 'two adjacent folders'),
    _i('warehouse', '数据仓库', 'Data Warehouse', 'storage', ['存储', '数仓', 'OLAP'], 'three stacked cylinder layers'),
    _i('datalake', '数据湖', 'Data Lake', 'storage', ['存储', '数据湖', '原始'], 'a droplet above two wave lines'),
    _i('archive', '归档存储', 'Archive Storage', 'storage', ['存储', '归档', '冷存'], 'a storage crate with a lid line'),
    _i('catalog', '元数据目录', 'Data Catalog', 'storage', ['存储', '元数据', '目录'], 'an open book with two pages'),

    # ── middleware ───────────────────────────────────────────
    _i('disttxn', '分布式事务', 'Distributed Transaction', 'middleware', ['中间件', '事务', '一致'], 'three nodes in a triangle with a bar'),
    _i('rpc', 'RPC 调用', 'RPC', 'middleware', ['中间件', 'RPC', '调用'], 'two boxes with arrows going both ways'),
    _i('servicemesh', '服务网格', 'Service Mesh', 'middleware', ['中间件', '网格', 'Sidecar'], 'two offset squares joined by crossing lines'),
    _i('configsync', '配置同步', 'Config Sync', 'middleware', ['中间件', '配置', '同步'], 'a circular arrow pair around a center'),
    _i('streampipeline', '流处理管道', 'Stream Pipeline', 'middleware', ['中间件', '流', '管道'], 'a funnel with a stream below'),
    _i('idgen', '分布式 ID', 'ID Generator', 'middleware', ['中间件', 'ID', '发号'], 'a snowflake shape'),

    # ── observe ──────────────────────────────────────────────
    _i('logcollector', '日志采集', 'Log Collector', 'observe', ['观测', '日志', '采集'], 'text lines funneling into a spout'),
    _i('traceui', '链路追踪视图', 'Trace View', 'observe', ['观测', '链路', 'Trace'], 'three staggered horizontal bars'),
    _i('alerting', '告警', 'Alerting', 'observe', ['观测', '告警', '通知'], 'a bell with a clapper'),
    _i('dashboard', '仪表盘', 'Dashboard', 'observe', ['观测', '看板', '大盘'], 'a half gauge with a needle'),
    _i('audit', '审计核查', 'Audit Review', 'observe', ['观测', '审计', '核查'], 'a magnifier over a check mark'),
    _i('backup', '备份', 'Backup', 'observe', ['观测', '备份', '恢复'], 'a dashed ring with an up arrow'),
    _i('healthcheck', '健康检查', 'Health Check', 'observe', ['观测', '探活', '心跳'], 'an electrocardiogram line'),
    _i('slo', 'SLO 目标', 'SLO Target', 'observe', ['观测', 'SLO', '指标'], 'a target with concentric rings'),
    _i('profiling', '性能剖析', 'Profiling', 'observe', ['观测', '剖析', '火焰图'], 'a flame graph of stacked bars'),

    # ── security ─────────────────────────────────────────────
    _i('secret', '密钥 / 凭据', 'Secret', 'security', ['安全', '密钥', '凭据'], 'a key with a round bow'),
    _i('kms', '密钥管理 KMS', 'KMS', 'security', ['安全', 'KMS', '密钥'], 'a padlock with a keyhole'),
    _i('cert', '证书', 'Certificate', 'security', ['安全', '证书', 'TLS'], 'a document with a seal circle'),
    _i('iam', '身份认证 IAM', 'IAM', 'security', ['安全', '认证', '身份'], 'an ID card with a person silhouette'),
    _i('encrypt', '加密', 'Encryption', 'security', ['安全', '加密', '密文'], 'a closed padlock'),
    _i('bastion', '堡垒机', 'Bastion Host', 'security', ['安全', '堡垒机', '跳板'], 'a monitor showing a terminal prompt'),
    _i('siem', 'SIEM 安全分析', 'SIEM', 'security', ['安全', 'SIEM', '分析'], 'a radar sweep over rings'),
    _i('auditlog', '审计日志', 'Audit Log', 'security', ['安全', '审计', '留痕'], 'a list with a small clock'),
    _i('oauth', 'OAuth 授权', 'OAuth', 'security', ['安全', '授权', 'OAuth'], 'two interlocking rings'),

    # ── delivery ─────────────────────────────────────────────
    _i('cicd', 'CI/CD 流水线', 'CI/CD Pipeline', 'delivery', ['交付', '流水线', '构建'], 'two circles joined by crossing arrows'),
    _i('imagerepo', '镜像仓库', 'Image Registry', 'delivery', ['交付', '镜像', '仓库'], 'three stacked container layers'),
    _i('artifactrepo', '制品库', 'Artifact Repository', 'delivery', ['交付', '制品', '仓库'], 'a crate with a label tab'),
    _i('iac', '基础设施即代码', 'IaC', 'delivery', ['交付', 'IaC', '编排'], 'braces around cloud lines'),
    _i('configmgmt', '配置管理', 'Config Management', 'delivery', ['交付', '配置', '管理'], 'two sliders on parallel tracks'),
    _i('canary', '金丝雀发布', 'Canary Release', 'delivery', ['交付', '灰度', '发布'], 'a main road with a small branch'),
    _i('bluegreen', '蓝绿部署', 'Blue-Green Deploy', 'delivery', ['交付', '蓝绿', '切换'], 'a circle half filled'),
    _i('rollback', '回滚', 'Rollback', 'delivery', ['交付', '回滚', '回退'], 'a circular arrow pointing back'),

    # ── topology ─────────────────────────────────────────────
    _i('single', '单实例', 'Single Instance', 'topology', ['形态', '单点', '单实例'], 'one square with a center dot'),
    _i('replica', '多副本', 'Replicas', 'topology', ['形态', '副本', '多份'], 'three squares side by side'),
    _i('master-slave', '主从', 'Master-Slave', 'topology', ['形态', '主从', '主备'], 'a big block linked to a small block'),
    _i('sharding', '分片', 'Sharding', 'topology', ['形态', '分片', '分库'], 'a square divided into four'),
    _i('readonly-replica', '读写分离', 'Read/Write Split', 'topology', ['形态', '读写分离', '从库'], 'a filled node fanning to two hollow nodes'),
    _i('multiaz', '多可用区', 'Multi-AZ', 'topology', ['形态', '多可用区', '容灾'], 'two boxes linked diagonally'),
    _i('active-active', '双活', 'Active-Active', 'topology', ['形态', '双活', '互备'], 'two rings with arrows both ways'),
    _i('cold-standby', '冷备', 'Cold Standby', 'topology', ['形态', '冷备', '待机'], 'a solid block beside a dashed block'),
]
