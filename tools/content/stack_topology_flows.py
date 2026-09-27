# -*- coding: utf-8 -*-
"""部署形态机理剧本：每个形态回答「怎么查 / 怎么存 / 挂了怎么办」三问。

事实源口径（与《部署形态动画化计划-2026-09-26》§3.1 一致，后端 / 前端 / 校验三处共用）：
    nodes[].id            图元 id，剧本引用它；同形态内唯一
    nodes[].kind          client / primary / replica / proxy / store / cache（决定配色与自动布局）
    nodes[].x / .y        显式坐标，可选；不给则由前端 topology-figure.ts 按 kind 自动排
    edges[].kind          data / repl / heartbeat / route（实线 / 虚线 / 点线）
    scenes[].id           必须是 read / write / failover 三者齐全，缺一 build 失败
    steps[].caption       旁白 ≤ 40 字；**含数字必须能在 scenes[].refs 里找到出处**
    steps[].highlight     本步高亮的节点 id，必须存在于 nodes
    steps[].active        本点点亮的边 id，必须存在于 edges
    steps[].token         沿边跑的数据包 {edge, label}，edge 必须存在于 edges
    scenes[].refs         数字 / 事实的出处

硬红线：动画里画的实例数（client 节点不计）== 该形态在 TOPOLOGY 表里的 replicas
== 产物 K8s 的副本数。build-content.py 与【22】层双向守这条线，数不上就红。

P0-1 只写 Redis 的 single / masterslave 两个形态；sentinel / cluster / multilevel
的剧本 P0-2 再写 —— 没写剧本的形态前端不出现「看机理」按钮，如实空态。
"""

TOPOLOGY_FLOWS = {
    "cache": {
        "redis": {
            "single": {
                "nodes": [
                    {"id": "client", "label": "应用", "kind": "client"},
                    {"id": "r1", "label": "Redis 实例", "kind": "cache"},
                ],
                "edges": [
                    {"id": "c-r1", "from": "client", "to": "r1", "kind": "data"},
                ],
                "scenes": [
                    {
                        "id": "read",
                        "title": "读：一个 key 怎么被找到",
                        "steps": [
                            {"caption": "应用把 GET key 发给唯一的 Redis 实例",
                             "highlight": ["client"], "active": ["c-r1"],
                             "token": {"edge": "c-r1", "label": "GET"}},
                            {"caption": "单实例没有路由与转发，命令直接在本机内存哈希表上执行",
                             "highlight": ["r1"]},
                            {"caption": "命中即返回；未命中返回 nil，是否回源数据库由应用自己决定",
                             "highlight": ["r1"]},
                        ],
                        "refs": [
                            "Redis 官方文档：GET/SET 命令在单实例内存中直接执行",
                            "装配台选项说明：单机单实例，无副本",
                        ],
                    },
                    {
                        "id": "write",
                        "title": "写：数据怎么落下去",
                        "steps": [
                            {"caption": "应用把 SET key 发给唯一实例",
                             "highlight": ["client"], "active": ["c-r1"],
                             "token": {"edge": "c-r1", "label": "SET"}},
                            {"caption": "命令在内存执行完就返回，持久化按 AOF / RDB 配置落盘",
                             "highlight": ["r1"]},
                            {"caption": "持久化只为重启恢复 —— 实例挂掉的窗口里，写入整体不可用",
                             "highlight": ["r1"]},
                        ],
                        "refs": [
                            "Redis 官方文档：Persistence（AOF / RDB 两种持久化）",
                        ],
                    },
                    {
                        "id": "failover",
                        "title": "灾：实例挂了会怎样",
                        "steps": [
                            {"caption": "单实例没有从节点，进程或宿主机挂掉即缓存整体不可用",
                             "highlight": ["r1"]},
                            {"caption": "应用侧表现为连接失败或超时，是否降级回源数据库由应用决定",
                             "highlight": ["client"]},
                            {"caption": "恢复 = 重新拉起实例，数据按持久化配置回放",
                             "highlight": ["r1"]},
                            {"caption": "要自动容灾就得升级主从或哨兵 —— 这是单实例的能力边界",
                             "highlight": ["client"]},
                        ],
                        "refs": [
                            "Redis 官方文档：Replication —— 单机无副本，可用性上限就是一个进程",
                            "装配台选项说明：无副本，进程挂即不可用",
                        ],
                    },
                ],
            },
            "masterslave": {
                "nodes": [
                    {"id": "client", "label": "应用", "kind": "client"},
                    {"id": "m1", "label": "主库", "kind": "primary"},
                    {"id": "s1", "label": "从库", "kind": "replica"},
                ],
                "edges": [
                    {"id": "c-m", "from": "client", "to": "m1", "kind": "data"},
                    {"id": "c-s", "from": "client", "to": "s1", "kind": "data"},
                    {"id": "m-s", "from": "m1", "to": "s1", "kind": "repl"},
                ],
                "scenes": [
                    {
                        "id": "read",
                        "title": "读：一个 key 怎么被找到",
                        "steps": [
                            {"caption": "读请求可以发往主库也可以发往从库 —— 写走主库，读可分流",
                             "highlight": ["client"], "active": ["c-s"],
                             "token": {"edge": "c-s", "label": "GET"}},
                            {"caption": "从库的数据来自主库的异步复制，主库把写命令流持续推给从库",
                             "highlight": ["s1"], "active": ["m-s"],
                             "token": {"edge": "m-s", "label": "repl"}},
                            {"caption": "异步复制有窗口：主库挂掉时还没推到从库的写会丢，关键读要读主库",
                             "highlight": ["m1"]},
                        ],
                        "refs": [
                            "Redis 官方文档：Replication —— 异步复制与数据安全（WAIT 命令）",
                        ],
                    },
                    {
                        "id": "write",
                        "title": "写：数据怎么落下去",
                        "steps": [
                            {"caption": "写命令只发往主库；从库只读（replica-read-only），写会被拒绝",
                             "highlight": ["m1"], "active": ["c-m"],
                             "token": {"edge": "c-m", "label": "SET"}},
                            {"caption": "主库执行后把写命令流异步推给从库，从库回放保持一致",
                             "highlight": ["s1"], "active": ["m-s"],
                             "token": {"edge": "m-s", "label": "repl"}},
                            {"caption": "复制链路靠 PING 保活，默认每 10 秒一次",
                             "highlight": ["m1"], "active": ["m-s"]},
                            {"caption": "主从各自落 AOF / RDB；断线重连用 PSYNC 增量同步，不必全量",
                             "highlight": ["m1"]},
                        ],
                        "refs": [
                            "redis.conf：replica-read-only 默认 yes，从库拒绝写入",
                            "redis.conf：repl-ping-replica-period 默认 10 秒",
                            "Redis 官方文档：Replication（PSYNC / 复制积压缓冲区）",
                        ],
                    },
                    {
                        "id": "failover",
                        "title": "灾：主库挂了会怎样",
                        "steps": [
                            {"caption": "主库失联：主从形态没有自动选主，从库只会发现复制中断",
                             "highlight": ["s1"]},
                            {"caption": "切换由外部触发 —— 哨兵、VIP 漂移或看护脚本把从库提升为新主",
                             "highlight": ["s1"]},
                            {"caption": "应用把写指向新主；旧主回来必须以从库身份加入，否则脑裂双写",
                             "highlight": ["client"]},
                            {"caption": "主从形态的边界：要自动故障切换，升级到哨兵形态",
                             "highlight": ["client"]},
                        ],
                        "refs": [
                            "Redis 官方文档：Replication —— SAFETY（旧主重回须以从库身份重新加入）",
                            "装配台选项说明：failover 由 VIP / 中间件切换",
                        ],
                    },
                ],
            },
        },
    },
}
