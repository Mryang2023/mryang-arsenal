# 方案 3 · 装配台升级（全栈维度 + 集群形态 + 动态交付）

> **一句话**：把装配台从「选 Java 组件」升级为「装配一整个项目」，把交付方式从「下载一个 zip」升级为「**一屏会动的图**」。
> **建议时段**：第 3 晚（23:00 后）
> **依赖**：**建议在方案 1 之后**（图形交互要消费图标资产）
> **预计产出**：维度 18→32、能力 31→60+、集群形态模型、`/stack` 动态交付台、交付级架构图三态输出

---

## 0. 开工必读

| 顺序 | 文件 | 看什么 |
|---|---|---|
| 1 | `docs/hy4-night-plans/00-index.md` | 四条铁律、环境备忘 |
| 2 | `arsenal-stacks/stack.json` | 18 维度 / 46 选项 / 4 预设的**完整 schema** |
| 3 | `arsenal-stacks/architecture.json` | 7 泳道 / 31 能力 / 21 策略 / canvas 段（**本次改动最集中的地方**） |
| 4 | `arsenal-web/src/lib/stack.ts` | `composeStack()` —— 纯函数，**不许破坏它的纯度** |
| 5 | `arsenal-web/.verify/audit-check.ts` | verify:arch 的 35 项，本次要扩 |
| 6 | `arsenal-web/.verify/graph-check.ts` | verify:graph 的 59 项（渲染器加法契约） |
| 7 | `arsenal-web/src/app/stack/StackComposer.tsx` | 11 个页签、4 个分组 —— 页面骨架 |
| 8 | `arsenal-web/src/lib/arch-canvas.ts` | `buildTechArch()` / `CANVAS_ZONES` / `CANVAS_VIEWS` |
| 9 | `arsenal-web/src/lib/deploy.ts` | 交付产物生成（Dockerfile / Compose / K8s / Helm） |
| 10 | `tools/content/stack_*.py` | 内容源模块 |
| 11 | `arsenal-server/.../exporter/` | 后端导出（本次要同步） |

---

## 1. 现状（已核实）

### 1.1 当前装配台的完整家底

| 项 | 现状 |
|---|---|
| 维度 | **18 个**，分 **5 组**：`base` / `data` / `middleware` / `crosscut` / `delivery` |
| 维度清单 | `jdk build web persistence database pool migration cache mq registry scheduler auth apidoc observability mapping boilerplate test deploy` |
| 选项 | **46 个** |
| 预设 | **4 个**：`minimal` / `standard` / `cloud` / `enterprise` |
| 泳道 | **7 条**：`entry app data infra quality delivery base` |
| 能力 | **31 个**（`capNames`，如 `cap.jvm` / `cap.http.reactive` / `cap.cache.distributed`） |
| 策略 | **21 条**（`blocker` / `risk` / `note` 三级） |
| 页签 | **11 个**，分 4 组：`build yaml env app config code tree arch risk ops prompt` |
| 内容源 | `tools/content/stack_{base,data,mw,cross,deploy}.py`（各自导出 `DIMENSIONS`）+ `stack_presets.py` + `stack_arch.py` + `stack_project.py` |
| 合成 | `composeStack(picks) → ComposedStack`（纯函数） |
| 交付 | `deploy.ts` 的 `buildDeployPlan()` → Dockerfile / .dockerignore / Makefile / docker-compose.yml / prometheus.yml / systemd unit / K8s 清单（00-namespace…08-pdb + kustomization）/ Helm Chart |

### 1.2 用户指出的四个问题（逐条对应本方案的改动）

| 用户原话 | 现状 | 对应改造 |
|---|---|---|
| 「更偏向 Java 代码的开发，希望从**完整项目角度**出发，包括**服务器、负载均衡**」 | 18 个维度里 14 个是 Java 侧；运行环境、入口负载、编排都只有零散体现 | **§3.1 维度扩展 18→32** |
| 「当前**交付方式**我并不喜欢，希望多一些**动态的方式**，交互更友好、更有科技感艺术感，而不是全是文字的死板样子」 | 交付 = 右上角导出 zip；图只有「架构图」和「技术架构」两个页签 | **§3.4 动态交付台** |
| 「**图很多文字很少**，通过看图就能看到整体设计框架，能写在交付的技术文档上」 | `TechArch` 已经不错，但没有「交付三态」与「集群版式」 | **§3.5 交付级架构图** |
| 「**可以选择集群** —— 数据库单实例还是集群、缓存集群、ES 技术栈；**高深的技术我们也可以选**」 | `architecture.json` 的 `canvas.options[dim][opt].cluster` 只是**展示用的名字数组**，不是真模型；没有 ES 维度 | **§3.2 集群形态、§3.3 高深技术** |

### 1.3 三条不能碰的实现细节

1. **`composeStack` 是纯函数**，空槽位跳过、不回退默认、预设未声明的维度留空 —— 加维度不许破坏这三条
2. **可运行性由数据决定**（选项声明 `provides`/`requires`）；**向自己索要是构建期硬错**（`sync-content.mjs` 会拦）
3. **加维度要同时进 `STACK_MODULES`**，然后 `python tools/build-content.py` + `node scripts/sync-content.mjs`。漏了 `STACK_MODULES` 的模块等于没写

---

## 2. 目标与非目标

### 目标

- **G1** 维度 **18 → 32**，覆盖从服务器到 CI/CD 的全流程
- **G2** 能力字典 **31 → 60+**（`capNames`），每新增选项都必须声明 `provides`/`requires`
- **G3** **集群形态成为一等公民**：新增 `topology` 组，DB / 缓存 / ES / MQ / 应用本身都能选形态（单实例 / 主从 / 集群 / 分片 / 多活）
- **G4** 集群形态**真的影响产物**：技术架构图画多副本、K8s 清单 `replicas` 跟着变、Compose 生成多实例、新增对应隐患策略
- **G5** **动态交付台**：一屏内的实时预览（图 / 树 / 清单 / 隐患），滑杆与图形选择器调参，图可复制可下载可送 Archify
- **G6** **交付级架构图**三态输出（浅色文档 / 深色演示 / 蓝图风）
- **G7** 高深技术可选：分库分表、分布式事务、服务网格、多活容灾、向量检索等

### 非目标

- ❌ 不引入依赖（地图、图表库、canvas 库都不许）
- ❌ 不改 `deploy.ts` 的产物**文件清单**（只加内容与条件分支）
- ❌ 不做在线运行 / 真实部署
- ❌ 不做「一键生成整个项目代码」（结构树已经覆盖，不做代码生成器）
- ❌ 不改规则集（`arsenal-rules/` 本次不动）

---

## 3. 设计

### 3.1 维度扩展：18 → 32

保持现有 5 组不动，新增 4 组：

| 新组 | id | 中文 | glyph |
|---|---|---|---|
| 运行与基础设施 | `runtime` | 运行基石 | `▤` |
| 数据生态 | `datax` | 数据生态 | `◫` |
| 质量与测试 | `quality` | 质量工程 | `✓` |
| 运维与安全 | `ops` | 运维安全 | `⛨` |
| 形态 | `topology` | 部署形态 | `⋮⋮` |

**新增 14 个维度**（编号接现有）：

| # | 维度 id | 名称 | 组 | 选项（含「高深」档） |
|---|---|---|---|---|
| 19 | `os` | 运行环境 | `runtime` | 裸机进程 / 虚拟机 / 容器 / Kubernetes / Serverless / 混合异构 |
| 20 | `ingress` | 入口与负载均衡 | `runtime` | 直连 / Nginx / HAProxy / 云 SLB / **LVS+Keepalived / Envoy+Istio** / F5 硬件 |
| 21 | `gateway` | API 网关 | `runtime` | 无 / Spring Cloud Gateway / **Apache APISIX** / Kong / Envoy |
| 22 | `orchestration` | 编排与调度 | `runtime` | 单进程 / Docker Compose / Docker Swarm / **Kubernetes** / **K3s** / Nomad |
| 23 | `imageregistry` | 镜像与制品库 | `runtime` | 公有云 / Harbor / Nexus / **JFrog Artifactory** |
| 24 | `search` | 搜索与检索引擎 | `datax` | 无 / Elasticsearch / OpenSearch / **Solr** / Meilisearch / **向量库（Milvus / pgvector）** |
| 25 | `analytics` | 分析型存储 | `datax` | 无 / ClickHouse / **Apache Doris** / **StarRocks** / Kylin / 湖仓（Hudi / Iceberg） |
| 26 | `objectstore` | 对象存储 | `datax` | 无 / MinIO / S3 / 阿里 OSS / **Ceph** |
| 27 | `testing` | 测试技术栈（多选） | `quality` | JUnit5 / Testcontainers / Mockito / WireMock / **JMeter / Gatling / k6** / **Pact 契约测试** / **PITest 变异测试** |
| 28 | `qualitygate` | 质量门禁 | `quality` | 无 / JaCoCo 覆盖率 / SonarQube Quality Gate / **变异测试门禁** |
| 29 | `cicd` | 交付流水线 | `ops` | 手工 / Jenkins / GitLab CI / **ArgoCD（GitOps）** / GitHub Actions |
| 30 | `monitoring` | 监控与告警 | `ops` | Actuator / Prometheus+Grafana / Zabbix / **SkyWalking / 云 APM** |
| 31 | `secret` | 密钥与配置安全 | `ops` | 配置文件 / 配置中心加密 / K8s Secret / **HashiCorp Vault** / 云 KMS |
| 32 | `logging` | 日志与审计 | `ops` | Logback 落盘 / ELK / **Loki + Promtail** / ClickHouse 日志 / 云日志 |

**加粗 = 之前选不到的「高深技术」**，这是用户明确要的。

**每个新选项必须写全这些字段**（缺一个 `sync-content.mjs` 就炸）：

```jsonc
{
  "id": "apisix",
  "name": "Apache APISIX",
  "badge": "高阶",
  "summary": "云原生 API 网关，插件生态强，支持动态路由与熔断",
  "dependencies": [ { "groupId": "org.apache.apisix", "artifactId": "apisix-java-plugin-runner", "version": "3.x" } ],
  "yaml": "…（给 spring cloud gateway 之外的形态也给出配置片段，或注明「网关侧配置见 ops 页签」）…",
  "ops": [ "…" ],
  "notes": [ "…" ],
  "pitfalls": [ "…" ]
}
```

并在 `stack_arch.py` 里为它登记：`NODE_ARCH`（泳道 + 图标 + role）、`CAP_OPTIONS`（provides / requires）。

### 3.2 集群形态模型（本次最核心的设计）

#### 现状的问题

`architecture.json` 里已有 `canvas.options[dim][opt].cluster`，形状是 `[{name, replicas, note}]` —— 但它**只是给图用的展示数据**，不参与任何判定，也不影响交付产物。用户要的是「真的能选」。

#### 新模型

在 `stack.json` 的每个选项上新增 `topology` 字段（可选，没有就表示该组件不区分形态）：

```jsonc
{
  "id": "mysql",
  "name": "MySQL 8.x",
  "topology": {
    "default": "single",
    "modes": [
      { "id": "single",     "label": "单实例",       "replicas": 1,  "note": "开发与小型生产" },
      { "id": "masterslave", "label": "主从",        "replicas": 2,  "requires": ["cap.lb.db"],   "note": "读扩展，故障切换需中间件" },
      { "id": "mgr",        "label": "MGR 三节点",   "replicas": 3,  "requires": ["cap.ha.quorum"], "note": "自动选主，强一致多数派" },
      { "id": "sharded",    "label": "分库分表",     "replicas": "proxy + N×M",
        "requires": ["cap.proxy.db", "cap.shard.key"], "note": "单表破亿后的常态" },
      { "id": "cloudnative","label": "云原生分布式", "replicas": 3,
        "requires": ["cap.distributed.db"], "note": "OceanBase / TiDB 形态" }
    ]
  }
}
```

**同法适用于**：`cache`（单机 / 主从 / Cluster / 多级本地+远端）、`search`（单节点 / 三节点集群 / 冷热分层）、`mq`（单机 / 集群 / 多机房）、`web`（单实例 / 多实例+LB / 灰度）。

#### `picks` 的形状变化

现在 `picks` 是 `{dimId: optId}`。**扩展为**：

```ts
type Picks = Record<string, string | { option: string; topology?: string; params?: Record<string, number> }>
```

**关键约束：必须向后兼容。** `loadPicksSnapshot()` 读到的旧快照（纯字符串值）要照常工作。在 `composeStack` 入口做一次归一化（`normalizePicks()`），把字符串值转成 `{option: str}`，并把已有的 `topology` 默认填上。

#### 集群形态要「落到产物」，否则就是假功能

| 产物 | 形态改了要发生什么 |
|---|---|
| 技术架构图 | 从 1 个框变成 N 个框（叠层视觉）+ 前面加 LB / Proxy 节点 + 画复制的连线 |
| K8s 清单 | `replicas` 跟着变；多副本时自动补 `topologySpreadConstraints` / `podAntiAffinity` / `PodDisruptionBudget` |
| docker-compose | 生成 `deploy.replicas` 或 N 个服务实例 |
| Helm values | `replicaCount` 跟着变；`values-dev` / `values-prod` 分别给不同值 |
| Capacities 摘要 | 「ops」页签顶部给出算出来的容量概览：N 个实例 × M 副本、预计连接数、估算内存 |
| 隐患策略 | 新增策略：① 选主从但没选 DB 层 LB → `risk` ② 选分片但没选分片键 → `blocker` ③ 选 Cluster 缓存但应用直接连单节点地址 → `blocker` ④ 多副本但没配 PDB → `risk` |

**红线**：`replicas` 不许在代码里写死，必须从 `topology` 数据算出来（`deploy.ts` 里所有 `replicas: 1` 的硬编码都要改成读形态）。

### 3.3 高深技术的接入方式

用户要「那些高深的技术我们也可以选」。落地规则：

1. **不新建独立入口** —— 高深技术就是同一维度的「更靠后的选项」，用 `badge: "高阶"` 标注
2. 每个高阶选项必须：
   - 有 `pitfalls`（≥2 条，写「什么情况下会翻车」）
   - 有 `requires`（它需要的前置能力，比如「分库分表」需要「分库分表中间件」+「分片键」）
   - 有对应的策略条目（至少 1 条 `risk`）
3. 页面用视觉区分（描边色 / 角标），让「高阶」一眼可辨，但**不隐藏**

首批要补齐的高阶选项：

| 维度 | 高阶选项 |
|---|---|
| `persistence` | ShardingSphere-JDBC / ShardingSphere-Proxy / MyBatis-Plus 多数据源 |
| `database` | TiDB / OceanBase / PolarDB / PostgreSQL 分区表 |
| `cache` | Redis Cluster / Redis + 本地多级（Caffeine 二级）/ Redisson 分布式锁 |
| `mq` | RocketMQ 事务消息 / Kafka 多机房镜像 / Pulsar 分层存储 |
| `registry` | Nacos 集群 + 持久化 MySQL / Consul 多数据中心 |
| `crosscut` 类 | Seata（AT / TCC / Saga）/ 服务网格 Istio 灰度 / 链路加密 mTLS |
| `search` | Elasticsearch 冷热分层 + 倒排 + 向量混合检索 |

### 3.4 动态交付台（用户最不满的一点）

#### 现状

交付 = 右上角一个「导出 zip」。11 个页签里 9 个是**文字为主**（yaml / code / tree / risk / ops / prompt…）。

#### 目标形态

**右侧常驻「交付预览」面板**，选中任何东西立刻变化；左侧仍是选择区。窄屏时预览折叠为顶部横条。

```
┌─ 左侧：装配区 ────────────┬─ 右侧：交付预览（常驻，实时） ─────┐
│ 组：运行基石              │ [总览] [依赖图] [架构图] [形态图]   │
│  ▸ 运行环境  [裸机 虚机…] │ [链路] [目录树] [清单] [隐患] [容量]│
│  ▸ 入口负载  [Nginx SLB…] │ ┌──────────────────────────────┐ │
│ 组：数据                  │ │                              │ │
│  ▸ 数据库    [MySQL …]    │ │        实时渲染的图            │ │
│    形态： (1) (2) (N×M)   │ │                              │ │
│  ▸ 缓存      [Redis …]    │ └──────────────────────────────┘ │
│    形态： (1) (2) (3ᶜ)    │ 摘要：7 层 · 14 个节点 · 3 处风险 │ │
│ 组：形态                  │ [复制 SVG][下载 PNG][Mermaid][出图]│ │
│  ▸ 部署形态  [单机 主从…] │ ─── 滑杆调参 ───                  │
│                           │ 副本数 ●──── 3     连接池 ●─ 20  │
└───────────────────────────┴───────────────────────────────────┘
```

**九块预览，全部实时算、全部可导出**：

| 预览 | 数据来源 | 交互 |
|---|---|---|
| 总览卡 | `composeStack` | 能力覆盖进度环、缺零件清单 |
| 依赖图 | `arch-diagram.ts` 的 `buildArchDiagramSvgInteractive` | 已有，直接用 |
| 技术架构图 | `arch-canvas.ts` 的 `buildTechArchSvg` | 已有，接上形态 |
| **集群形态图** | 新：`buildTopologySvg(picks, composed)` | 单实例 1 个框 / 主从 2 个框 / 分片 proxy+N×M |
| 请求链路图 | `CANVAS_VIEWS` 的五条视图 | 已有的 `v_ingress` / `v_state` / `v_async` / `v_ops` / `v_delivery` |
| 目录树 | `stack_project.py` 的条件树 | 已有 |
| 部署清单 | `deploy.ts` | 已有，改成树形预览 + 单文件下载 |
| 隐患单 | `policyDetail` | 已有，改成红/黄/蓝分组卡 |
| **容量摘要** | 新：`estimateCapacity(composed)` | 副本数 / 连接数 / 估算内存 / 估算磁盘 |

**形态选择器的交互要求**（不许用下拉框）：

- 数据库形态：**画 1 个框 / 2 个框 / 1+2 个框** 的迷你图示，点图示切换
- 缓存形态：同上，Cluster 用环形小点
- 部署形态：单机 = 1 个方块；主从 = 1 大 1 小；集群 = 一串方块；多活 = 两个大区 + 中间连线
- 每个图示下方一行小字说明「适合什么场景」，**不超过 12 个字**

**滑杆**（直接调数值，实时反映到 yaml 与图上）：

| 滑杆 | 影响 |
|---|---|
| 应用副本数 | K8s `replicas` / Compose `deploy.replicas` / 架构图框数 |
| 数据库连接池大小 | `hikari.maximum-pool-size` / 容量摘要 |
| JVM 堆 | `-Xmx` / 容量摘要 |
| 限流阈值 | `sentinel` / `resilience4j` 配置片段 |
| 分片数 | 分库分表配置 / 形态图格子数 |

**导出的统一约定**：每张图右上角四个动作 —— `复制 SVG` / `下载 PNG` / `复制 Mermaid` / `送 Archify 出 HTML`（最后一个走 `buildArchifyIr` + 后端）。这是「用户方便地选择了哪一块内容，就能拿到对应的图」的落地。

**视觉要求**（用户要「科技感、艺术感」）：

- 色板沿用 `ARCH_VIEW_IDENTITY` 的六色 + 中性灰，**不许引入新色相**
- 卡片圆角统一、描边 1px、选中态用 2px 主题色描边 + 轻微位移（`arch-motion` 的 `am-rise`）
- 图区背景用极浅网格（`<pattern>` 手绘，不用图片）
- 数字全部等宽字体，大小对比拉开（大数字 + 小标签）
- 遵守 `prefers-reduced-motion`

### 3.5 交付级架构图（三态输出）

用户要「能写在交付的技术文档上的软件架构图，图多文字很少」。

现有 `buildTechArchSvg(arch, theme, opts)` 是基础，本次补：

| 项 | 内容 |
|---|---|
| **三态主题** | `doc`（白底黑字，文档用）/ `slide`（深底浅字，演示用）/ `blueprint`（蓝图风，对应 Archify 的 `visual_preset: 'blueprint'`） |
| **集群版式** | 多副本画成叠层卡片（后面两层错位 4px），不并排铺开（铺开会让图变宽） |
| **分区色带** | 按 `CANVAS_ZONES` 的左到右主干分区，加极浅色带 + 分区名小字 |
| **控制面 / 数据面分离** | 可选开关：把注册中心、配置中心、监控归为「控制面」，画在下方一条带里 |
| **文字最少化** | 节点上只留「图标 + 名称」，版本号 / 端口收进 hover 或脚注 |
| **图例** | 右下角一行：实线=同步调用，虚线=异步，双框=多副本 |
| **尺寸** | 输出宽 1600px（文档 A4 横排够用），另出 2400px 高清版 |
| **署名** | 右下角一行小字（现有 `TechArch` 已有署名机制，沿用） |

**验收标准（很具体）**：把生成的图贴进一份假的技术说明书里，**不看代码只看图**能答出这五个问题：① 有几个应用实例 ② 请求从哪进来 ③ 数据落在哪 ④ 有没有异步链路 ⑤ 哪些组件是多副本。答不出来就是图没做好。

### 3.6 verify 同步

| 层 | 现状 | 本次 |
|---|---|---|
| `verify:arch` | 35 | 扩到 ~60（每个新维度的槽位必需性、每个新能力的供需闭合、每条新策略的触发条件） |
| `verify:graph` | 59 | 扩到 ~75（新增集群形态图、容量摘要的加法契约） |
| `verify:project` | 321 | 扩到 ~340（形态影响产物：K8s replicas、PDB、Compose 实例数） |
| 其他 | engine 17 / parity 12 / archify 29 | 不变（但要确认没被破坏） |

**总数四处同步**：`arsenal-profiles/arsenal.json` 的 `verifyChain` / `project-check.ts` 手写总数 / `README.md` 总数 / `README.md` 分项表。

---

## 4. 分阶段实施

> **顺序很重要**：数据先行 → 引擎次之 → 产物再次 → 页面最后。反过来做会返工。

### 阶段 A · 维度扩展（只动数据，不动 UI）

1. 新建 `tools/content/stack_runtime.py`、`stack_datax.py`、`stack_quality.py`、`stack_ops.py`、`stack_topology.py`，各导出 `DIMENSIONS`
2. **把 5 个新模块名加进 `tools/build-content.py` 的 `STACK_MODULES`**（漏了等于没写）
3. 在 `stack_arch.py` 里为每个新选项登记 `NODE_ARCH` + `CAP_OPTIONS`（`provides`/`requires`）
4. `CAP_NAME` 从 31 扩到 60+，**每个新能力至少有一个选项能提供**（`sync-content.mjs` 会断言）
5. 新增策略：至少 8 条新 `policies`（覆盖集群形态的错误组合）
6. 新增 2 个预设：`ha`（高可用集群版）、`data-intensive`（数据密集版）
7. 跑 `python tools/build-content.py` + `node scripts/sync-content.mjs`

**验收**：`npm run verify:arch` 通过（项数已增加）；`stack.json` 里 `dimensions.length === 32`；`capNames` 数量 ≥60。

### 阶段 B · 集群形态模型

1. 在 `tools/content/stack_*.py` 里给 `database` / `cache` / `search` / `mq` / `web` 的选项加 `topology` 字段
2. 扩展 `Picks` 类型 → `normalizePicks()` → 改 `composeStack()`（**保持纯函数**）
3. `normalizePicks()` 必须能读旧的字符串快照（加载旧 localStorage 不许崩）
4. 修改 `deploy.ts`：所有硬编码的 `replicas: 1` 改为读形态算出来

**验收**：
- 旧快照（纯字符串）加载后行为不变
- 把数据库切成「分片」，导出的 K8s 清单里 `replicas` 与 PDB 跟着变
- `verify:project` 通过

### 阶段 C · 动态交付台（页面重构）

1. `StackComposer.tsx` 布局改为左右分栏（左侧装配 / 右侧预览）
2. 实现九块预览，先接现成的（依赖图 / 技术架构 / 目录树 / 清单 / 隐患），再补新的（形态图 / 容量摘要）
3. 形态选择器（图形化）、五条滑杆
4. 每块预览的四个导出动作
5. 视觉打磨：网格背景、选中态动效、等宽数字、`prefers-reduced-motion`

**验收**：改任意一个选项或形态，右侧预览**立刻**变；`present_files` 时能看到真实页面。

### 阶段 D · 交付级架构图三态

1. `buildTechArchSvg` 支持 `theme: 'doc' | 'slide' | 'blueprint'`
2. 集群叠层版式、分区色带、控制面分离开关
3. 三态各导一张，**目视检查 §3.5 的五个问题**

### 阶段 E · 验证与收尾

1. 扩 `audit-check.ts` / `graph-check.ts` / `project-check.ts`
2. 四处同步 verify 数字
3. README：进度表装配台一行（18→32 维度、46→80+ 选项、31→60+ 能力、21→29+ 策略）、目录树、verify 数字
4. 后端同步：`arsenal-server/.../exporter/` 若依赖维度数量或预设，一并改；跑 `verify:parity`（12 项）确认前后端仍逐字节一致
5. memory 追加

---

## 5. 验收清单

```bash
cd D:/workspace/2026/mryang-arsenal
export PATH="/usr/bin:/bin:/c/Windows/System32:/c/Windows:$PATH"
python tools/build-content.py
cd arsenal-web && node scripts/sync-content.mjs
npm run verify
npm run build
# 后端（改了 exporter 才需要）
cd ../arsenal-server && bash scripts/run.sh
```

手工验收（必须真点一遍）：

- [ ] 32 个维度全部出现在装配台上，分组正确
- [ ] 每个新选项点开有 yaml / 依赖 / 说明，不是空壳
- [ ] 数据库形态切到「分片」，技术架构图上真的多出 Proxy 与 N×M 个格子
- [ ] 把「应用副本数」滑到 5，K8s 清单的 `replicas: 5` 且出现 `podAntiAffinity`
- [ ] 选「主从」但没选 DB 层 LB，隐患单出现红/黄条目
- [ ] 交付级架构图三态都能导出，贴进文档能答出五个问题
- [ ] 高阶选项（APISIX / TiDB / Istio / Vault…）都能选到，且带「高阶」角标

---

## 6. 红线

1. **`composeStack` 保持纯函数**：空槽位跳过、不回退默认 —— 不许为了「体验好一点」加默认值
2. **能力供需必须闭合**：新增选项的 `requires` 必须有别的选项能提供；只声明不实现 = 永远缺零件
3. **加模块必须进 `STACK_MODULES`**，否则内容源白写
4. **不引入依赖**（图表库、滑杆库、动画库一律不许，滑杆用原生 `<input type="range">` + CSS）
5. **旧快照必须兼容**：`loadPicksSnapshot()` 读到旧格式不许崩、不许静默清空
6. **产物必须「能跑」**：不许挂载导出包里没有的文件；新加的 K8s 字段要合法（`kubectl --dry-run` 级别的正确性）；`replicas` 一律算出来
7. **改完必跑 `sync-content.mjs`**，锚点/交叉校验失败即中断 —— 那是它在救你
8. **verify 数字四处同步**，漏一处下一晚就有人被红吓到

---

## 7. MVP 与可裁剪

| 优先级 | 内容 |
|---|---|
| P0 | 阶段 A 维度扩展（至少 `runtime` + `ops` + `quality` 三组共 10 个新维度） |
| P0 | 阶段 B 集群形态：`database` / `cache` / `search` / `web` 四个组件的形态可选，且影响 K8s replicas |
| P0 | 交付级架构图三态输出（用户最想要的交付物） |
| P1 | 阶段 C 动态交付台的九块预览 —— **至少完成：架构图 / 形态图 / 隐患单 / 容量摘要 四块** |
| P1 | 形态选择器图形化 + 副本数滑杆 |
| P2 | 剩余预览块（目录树 / 清单树）与另外四条滑杆 |
| P3 | `analytics` / `objectstore` / `imageregistry` 三个数据生态维度 |

**时间不够时的底线**：维度扩展 + 集群形态 + 交付级架构图这三件必须做完 —— 它们直接对应「装配台只懂 Java」「不能选集群」「交付全是文字」三个原始诉求。

---

## 8. 收尾清单

- [ ] `python tools/build-content.py` / `sync-content.mjs` / `npm run verify` / `npm run build` 全绿
- [ ] `verify:parity` 通过（改了后端 exporter 则必须）
- [ ] verify 数字四处同步
- [ ] README：目录树、进度表装配台一行、verify 数字
- [ ] memory 日志追加
- [ ] `/stack` 页面与三态架构图呈现给用户

---

## 9. 定时任务 prompt（可直接粘贴）

```
执行 D:\workspace\2026\mryang-arsenal\docs\hy4-night-plans\plan-3-stack-composer.md 的全部内容。

先读：00-index.md（四条铁律与环境备忘）、README.md、arsenal-stacks/stack.json 与
architecture.json（完整 schema）、arsenal-web/src/lib/stack.ts 的 composeStack、
arsenal-web/src/lib/deploy.ts、tools/content/stack_*.py、.verify/audit-check.ts、
.workbuddy/memory/MEMORY.md 与最近三天的日志。

核心要求（按 A→E 顺序，数据先行、页面最后）：
1. 维度 18→32：新增 runtime / datax / quality / ops / topology 五组共 14 个维度，
   新模块必须加进 tools/build-content.py 的 STACK_MODULES，每个新选项在 stack_arch.py
   登记 NODE_ARCH 与 CAP_OPTIONS（provides/requires），capNames 31→60+；
2. 集群形态成为一等公民：选项级 topology 字段（single/masterslave/mgr/sharded/cloudnative），
   Picks 扩展为支持 {option, topology, params}，必须向后兼容旧的纯字符串快照
   （normalizePicks() 归一化，加载旧快照不许崩）；
3. 形态必须影响产物：K8s replicas/PDB/podAntiAffinity、Compose 实例数、Helm values、
   技术架构图的副本叠层 —— deploy.ts 里所有硬编码 replicas:1 改为算出来；
4. 动态交付台：左侧装配 / 右侧常驻实时预览，九块预览（总览/依赖图/架构图/形态图/链路/
   目录树/清单/隐患/容量），形态用图形选择器（不许下拉框），加副本数等五条滑杆；
5. 交付级架构图三态输出（doc 白底 / slide 深底 / blueprint 蓝图风），
   集群叠层版式 + 分区色带 + 控制面分离开关；验收标准是「只看图能答出五个问题」；
6. 高阶技术可选项（APISIX / TiDB / OceanBase / Seata / Istio / Vault / Redis Cluster…
   带 badge:「高阶」+ ≥2 条 pitfalls + requires），不许只加名字不给配置；
7. 不引入任何依赖（滑杆用原生 input[type=range]）；composeStack 必须保持纯函数。

时间不够时按「7. MVP 与可裁剪」取舍，底线是「维度扩展 + 集群形态 + 交付级架构图」三件。
收尾按 00-index.md 第五节（verify + 四处同步数字 + README + memory + present_files）。
```
