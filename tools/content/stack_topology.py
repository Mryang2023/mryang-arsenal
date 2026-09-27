# -*- coding: utf-8 -*-
"""部署形态维度：集群形态成为一等公民，驱动 K8s replicas / PDB / 反亲和。"""

GROUPS_EXTRA = [
    {"id": "topology", "name": "部署形态", "glyph": "⋮",
     "desc": "全局部署形态：单实例 / 主备 / 集群 / 分片 / 多活。该选择直接决定 K8s 副本数、PDB 与反亲和策略。"},
]

DIMENSIONS = [
    {
        "id": "clustertopology",
        "groupId": "topology",
        "name": "全局部署形态",
        "why": "实例数量与容灾形态直接决定 K8s replicas、PDB 与反亲和，是可用性 SLO 的物理落地，必须显式选择。",
        "defaultOption": "single",
        "options": [
            {
                "id": "single",
                "name": "单机单实例",
                "badge": "默认",
                "summary": "单进程单副本，最低资源与运维成本，无高可用，适合开发、Demo 与可容忍停机的内管系统。",
                "yaml": "# k8s: replicas: 1，无 PDB",
                "notes": ["无副本，进程挂即不可用"],
                "pitfalls": ["节点宕机即服务中断，无 SLA", "无法滚动升级，发布必中断"],
                "dependencies": [],
            },
            {
                "id": "masterslave",
                "name": "主备",
                "badge": "",
                "summary": "一主一备热冗余，故障切换由中间件或看护脚本触发，读可分流，资源占用约两倍。",
                "yaml": "# k8s: replicas: 2，readinessProbe 区分主备",
                "notes": ["failover 由 VIP/中间件切换",
                          "备库承接只读流量"],
                "pitfalls": ["切换有秒级抖动，脑裂需 fencing 防双写", "异步复制丢切换瞬间未同步数据", "备节点长期空闲，资源利用率低"],
                "dependencies": [],
            },
            {
                "id": "cluster",
                "name": "多副本集群",
                "badge": "推荐",
                "summary": "N 副本对等/分片集群，自愈与滚动升级，配 PDB 与反亲和，云原生常态的高可用形态。",
                "yaml": "spec:\n  replicas: 3\n  strategy: RollingUpdate\n  podDisruptionBudget: minAvailable: 2",
                "notes": ["topologyKey: kubernetes.io/hostname 反亲和",
                          "PDB 保最少可用副本数"],
                "pitfalls": ["副本数设 2 时 PDB minAvailable 2 会阻塞节点维护", "无反亲和会两副本同节点，宕机全挂", "滚动升级期间双倍资源峰值需预留"],
                "dependencies": [],
            },
            {
                "id": "sharded",
                "name": "分片集群",
                "badge": "高阶",
                "summary": "按分片键水平拆分到多组节点，突破单实例容量与连接上限，单表破亿行后的常态。",
                "yaml": "# sharding-proxy 路由 + 分片键配置",
                "notes": ["分片代理做 SQL 路由",
                          "分片键选高基数字段"],
                "pitfalls": ["分片键选错无法变更，跨片查询全广播", "热点分片把单节点打满，需再平衡", "分布式事务跨片一致性靠 TCC/Saga 补"],
                "dependencies": [],
            },
            {
                "id": "multiactive",
                "name": "异地多活",
                "badge": "高阶",
                "summary": "多地域独立可读写，单元化路由就近接入，RTO 近零，容单地域整体故障，架构与运维最重。",
                "yaml": "# 多集群 federation + 全局流量调度",
                "notes": ["单元化按 user_id 取模路由",
                          "需全局时钟与冲突消解"],
                "pitfalls": ["跨地域写入冲突需业务层消解，复杂度陡增", "数据同步延迟致读己写不一致", "成本数倍，小业务 ROI 为负"],
                "dependencies": [],
            },
        ],
    },
]

CAP_EXTRA = {
    "cap.topo.ha.failover": "故障自动切换",
    "cap.topo.replication": "数据复制",
    "cap.topo.replicaset": "副本集",
    "cap.topo.antiaffinity": "反亲和调度",
    "cap.topo.pdb": "Pod 中断预算",
    "cap.topo.multiaz": "多可用区",
    "cap.topo.shard.proxy": "分片代理",
    "cap.topo.shard.key": "分片键",
    "cap.topo.distributed.db": "分布式数据库",
    "cap.topo.multiactive": "异地多活",
    "cap.topo.federation": "跨地域联邦",
}

NODE_ARCH_EXTRA = {
    "clustertopology": {"lane": "delivery", "icon": "⋮", "role": "形态", "required": False,
                        "missing": "不选部署形态，交付产物一律单副本，宕机即中断且无 PDB 保护。"},
}

OPTION_ARCH_EXTRA = {
    "clustertopology": {
        "single": {"provides": [], "requires": []},
        "masterslave": {"provides": ["cap.topo.ha.failover", "cap.topo.replication"]},
        "cluster": {"provides": ["cap.topo.ha.failover", "cap.topo.replicaset",
                                 "cap.topo.antiaffinity", "cap.topo.pdb", "cap.topo.multiaz",
                                 "cap.topo.replication"]},
        "sharded": {"provides": ["cap.topo.shard.proxy", "cap.topo.shard.key",
                                 "cap.topo.distributed.db"]},
        "multiactive": {"provides": ["cap.topo.multiactive", "cap.topo.multiaz",
                                     "cap.topo.antiaffinity", "cap.topo.distributed.db",
                                     "cap.topo.federation"], "requires": ["cap.orchestration"]},
    },
}

TOPOLOGY = {
    "database": {
        "*": {
            "default": "single",
            "modes": [
                {"id": "single", "label": "单实例", "replicas": 1,
                 "note": "开发与小型生产"},
                {"id": "masterslave", "label": "主从", "replicas": 2,
                 "requires": ["cap.topo.replication"],
                 "note": "读扩展故障切换"},
                {"id": "mgr", "label": "组复制", "replicas": 3,
                 "requires": ["cap.topo.ha.failover"],
                 "note": "自动选主强一致"},
                {"id": "sharded", "label": "分库分表", "replicas": 4,
                 "requires": ["cap.topo.shard.proxy", "cap.topo.shard.key"],
                 "note": "单表破亿常态"},
                {"id": "cloudnative", "label": "云原生", "replicas": 3,
                 "requires": ["cap.topo.distributed.db"],
                 "note": "TiDB/OceanBase"},
            ],
        },
    },
    "cache": {
        # cache 维度已按选项拆分（2026-09-27，修「本地缓存列出主从/集群」的真 bug）：
        #   *  caffeine 只给 single / multilevel —— 本地缓存没有「主从 / 集群」这个概念；
        #   *  redis 给 single / masterslave / sentinel / cluster / multilevel；
        #   *  none 本来就不出现（所有消费点显式排除 opt.id == 'none'）。
        # 选项自己的形态表优先生效（build-content.py 挂到 opt['topology']，
        # 前端 topologySpecOf() 先查 option 再查维度）；这条 '*' 是**维度级兜底**：
        # topologyDims() / 容量行 / 画布形态覆盖仍要靠它认得 cache 这个维度，
        # 摘掉它缓存就会从形态图与容量摘要里整个消失 —— 那是比多列两个形态更重的事故。
        "*": {
            "default": "single",
            "modes": [
                {"id": "single", "label": "单实例", "replicas": 1,
                 "note": "单机缓存"},
                {"id": "masterslave", "label": "主从", "replicas": 2,
                 "requires": ["cap.topo.replication"],
                 "note": "读写分离"},
                {"id": "sentinel", "label": "哨兵", "replicas": 3,
                 "requires": ["cap.topo.replication", "cap.topo.ha.failover"],
                 "note": "主从加哨兵仲裁"},
                {"id": "cluster", "label": "集群", "replicas": 3,
                 "requires": ["cap.topo.replicaset"],
                 "note": "数据分片集群"},
                {"id": "multilevel", "label": "多级", "replicas": 2,
                 "requires": ["cap.topo.replication"],
                 "note": "多级缓存"},
            ],
        },
        "caffeine": {
            "default": "single",
            "modes": [
                {"id": "single", "label": "单实例", "replicas": 1,
                 "note": "进程内本地缓存"},
                {"id": "multilevel", "label": "多级", "replicas": 2,
                 "requires": ["cap.topo.replication"],
                 "note": "本地加分布式两级"},
            ],
        },
        "redis": {
            "default": "single",
            "modes": [
                {"id": "single", "label": "单实例", "replicas": 1,
                 "note": "单机缓存"},
                {"id": "masterslave", "label": "主从", "replicas": 2,
                 "requires": ["cap.topo.replication"],
                 "note": "读写分离"},
                {"id": "sentinel", "label": "哨兵", "replicas": 3,
                 "requires": ["cap.topo.replication", "cap.topo.ha.failover"],
                 "note": "主从加哨兵仲裁"},
                {"id": "cluster", "label": "集群", "replicas": 3,
                 "requires": ["cap.topo.replicaset"],
                 "note": "数据分片集群"},
                {"id": "multilevel", "label": "多级", "replicas": 2,
                 "requires": ["cap.topo.replication"],
                 "note": "多级缓存"},
            ],
        },
    },
    "search": {
        "*": {
            "default": "single",
            "modes": [
                {"id": "single", "label": "单实例", "replicas": 1,
                 "note": "单机检索"},
                {"id": "cluster", "label": "集群", "replicas": 3,
                 "requires": ["cap.topo.replicaset", "cap.topo.antiaffinity"],
                 "note": "分片副本集群"},
                {"id": "tiered", "label": "分层", "replicas": 2,
                 "requires": ["cap.topo.replication"],
                 "note": "冷热分层"},
            ],
        },
    },
    "mq": {
        "*": {
            "default": "single",
            "modes": [
                {"id": "single", "label": "单实例", "replicas": 1,
                 "note": "单机消息"},
                {"id": "cluster", "label": "集群", "replicas": 3,
                 "requires": ["cap.topo.replicaset"],
                 "note": "多节点集群"},
                {"id": "multiaz", "label": "多可用区", "replicas": 3,
                 "requires": ["cap.topo.multiaz"],
                 "note": "跨可用区"},
            ],
        },
    },
    "web": {
        "*": {
            "default": "single",
            "modes": [
                {"id": "single", "label": "单副本", "replicas": 1,
                 "note": "单副本"},
                {"id": "multi", "label": "多副本", "replicas": 3,
                 "requires": ["cap.topo.antiaffinity"],
                 "note": "多副本负载"},
                {"id": "canary", "label": "灰度", "replicas": 2,
                 "requires": ["cap.topo.multiaz"],
                 "note": "灰度发布"},
            ],
        },
    },
}
