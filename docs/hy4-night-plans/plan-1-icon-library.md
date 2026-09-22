# 方案 1 · 图标资产库

> **一句话**：用手绘矢量的方式补全「软件开发 + 架构图」常用图标，用生图能力产出配套的展示级位图资产，建一个可检索、可复制、可复用的图标库页，并把它接入装配台与 `/arch`。
> **建议时段**：第 1 晚（23:00 后）
> **依赖**：无。它是方案 3、4 的素材底座，优先做。
> **预计产出**：新增 ≥90 个矢量图标 + ≥120 张位图资产 + `/icons` 页面 + 一条新事实源链路

---

## 0. 开工必读

| 顺序 | 文件 | 看什么 |
|---|---|---|
| 1 | `docs/hy4-night-plans/00-index.md` | 四条铁律、环境备忘、收尾套路 |
| 2 | `README.md` | 目录结构、数据流、verify 分层 |
| 3 | `arsenal-web/src/lib/tech-icons.ts` | **已有的 89 个矢量图标，全在这里**（不许重复造，不许改已有 key） |
| 4 | `arsenal-web/src/lib/arch-glyphs.ts` | 48 个结构概念图标（服务五张静态视图） |
| 5 | `arsenal-web/src/lib/arch-motion.ts` | 动画 class 清单与 `prefers-reduced-motion` 处理 |
| 6 | `arsenal-web/.verify/project-check.ts` 的【11】图标库与动效 | 现有图标断言长什么样，本次要在这里扩展 |
| 7 | `arsenal-web/src/components/Shell.tsx` 的 `NAV` | 加页面前先看菜单结构，【13】会守导航契约 |

---

## 1. 现状（已核实，别重复调查）

### 1.1 已有两套矢量图标，都是手写 inline SVG

| 文件 | 内容 | 规模 | 用途 |
|---|---|---|---|
| `arsenal-web/src/lib/tech-icons.ts` | `TECH_ICONS: Record<string, TechIcon>`，`TechIcon { name, color, svg, kind }`，`svg` 是 24×24 手绘字符串（用 `P/C/R/S` 四个小助手拼），上色走 `currentColor` | **89 个** | 技术组件（Nacos/Redis/MySQL/K8s…） |
| `arsenal-web/src/lib/arch-glyphs.ts` | `ARCH_GLYPHS`，中性符号 + 视图主题色 | **48 个** | 抽象概念（字典/蓝图/装配/校验/交付…） |

`TECH_ICONS` 的 89 个 key 按类：

- 运行时：`jdk spring tomcat netty webflux`
- 数据库：`mysql postgres mongodb oracle clickhouse sqlite hbase tidb influxdb`
- 持久层：`jdbc mybatis jpa flyway liquibase hikari druid`
- 缓存：`redis caffeine memcached`
- 消息：`kafka rocketmq rabbitmq pulsar`
- 注册/配置：`nacos consul zookeeper sentinel etcd apollo`
- 文档：`springdoc knife4j logback`
- 安全：`security satoken jwt keycloak`
- 观测：`actuator prometheus grafana elasticsearch jaeger skywalking loki tempo alertmanager opentelemetry opensearch`
- 基础设施：`nginx gateway docker k8s helm jar minio slb terraform harbor istio envoy apisix`
- 工具/工程：`maven gradle mapstruct lombok junit testcontainers scheduler xxljob jenkins gitlab argocd nexus sonarqube quarkus undertow vertx nodejs vite nextjs python git`
- 占位：`client none generic`

**回落机制**：`iconSvg(key)` 找不到时回落 `TECH_ICONS.generic`，**绝不崩、也不报错**（这正是隐患：写错 key 只会看到一个灰方块）。

### 1.2 位图资产现状

`arsenal-web/public/` 下**只有一个 `arch/` 目录**，6 张 AI 生成封面插画：`business.webp data.webp app.webp tech.webp product.webp project.webp`（512px，共 79KB）。

**先例已经存在** —— 用生图能力产出静态资源、离线落盘、运行时不生成图。本方案沿用这个先例，只是把规模做大、并给它建索引。

### 1.3 图标 key → 图的映射链

```
architecture.json（数据）
  └─ canvas.options[dim][opt].icon = "tomcat"          ← 事实源在这里
       └─ arch-canvas.ts: canvasOpt() → 节点 icon: opt?.icon ?? 'generic'
            └─ tech-icons.ts: iconSvg(key, x, y, size) / iconColor(key) / iconName(key)
                 └─ 找不到 → TECH_ICONS.generic（静默）
```

**关键结论**：加图标 = 改两处 —— `tech-icons.ts` 加矢量定义，`architecture.json` 的数据里引用它。只加前者没人用，只引用后者会静默变灰方块。

### 1.4 六张图现在缺什么图标（本方案的实际出发点）

| 视图 | 渲染器 | 现状 |
|---|---|---|
| 业务架构 | `app/arch/diagrams.tsx` → `BusinessDiagram` | 用 `ARCH_GLYPHS`，`DOMAIN_ICONS` 硬编码数组 |
| 数据架构 | `DataDiagram` | `ASSET_ICONS=['rulesDb','cookDb','stackDb']` |
| 应用架构 | `AppDiagram` | `APP_LAYER_ICONS=['browser','lib','plug','server','datasource']` |
| 技术架构 | `app/stack/TechArch.tsx` + `lib/arch-canvas.ts` | 用 `TECH_ICONS`，89 个够用但**缺云/网络/安全类** |
| 产品架构 | `ProductDiagram` | `PRODUCT_SURFACE_ICONS` |
| 项目架构 | `ProjectDiagram` | `PROJECT_DIR_ICONS` |

**真正的缺口**：
1. **交付级架构图最常用的「非技术组件」全缺** —— 用户、运维、第三方系统、手机、大屏、浏览器（有）、防火墙、专线、CDN、WAF、堡垒机、机房、机架
2. **云与部署形态缺** —— 云平台、VPC、子网、安全组、Serverless、边缘节点、GPU 节点、批处理
3. **集群形态缺** —— 多副本组、主从、分片、读写分离、多活
4. **位图资产几乎为零** —— 只有 6 张封面，做不了「文档插图 / 卡片配图 / 演示封面」

---

## 2. 目标与非目标

### 目标

- **G1 矢量图标补齐**：`TECH_ICONS` 从 89 个扩到 **≥170 个**，新增的全是「画架构图会用到、但现在没有」的
- **G2 位图资产入库**：用生图能力产出 **≥120 张** 512×512 位图，按分类落盘 `public/icons/<category>/<key>.png`
- **G3 建索引与事实源**：新增 `arsenal-icons/icons.json`（由 `tools/content/icons.py` 生成），走标准同步链路
- **G4 建页面**：新增 `/icons` 图标库页 —— 分类、搜索、复制 key、下载、预览两种形态
- **G5 接入**：装配台的槽位卡片、`/arch` 的分区图、导出文档模板都能用上
- **G6 补验证**：扩展【11】，让「key 写错 → 静默变灰方块」这类问题变成红色断言

### 非目标（明确不做，避免跑偏）

- ❌ 不引入任何图标库依赖（`simple-icons` / `devicon` / `lucide` 一律不许）
- ❌ 不改已有 89 个 key 的名字与形状（改了会连锁影响 `architecture.json` 和 verify）
- ❌ 不用生图替代矢量 —— 架构图里的节点仍是 SVG，位图只用于展示层
- ❌ 不做图标上传 / 用户自定义（超出「单人 + 小团队」规模）
- ❌ 不做图标编辑（旋转、着色、变体组合）

---

## 3. 设计

### 3.1 两类资产，职责分明

| | 矢量（inline SVG） | 位图（PNG/WebP） |
|---|---|---|
| 存放 | `src/lib/tech-icons.ts` / `arch-glyphs.ts` | `public/icons/<category>/<key>.png` |
| 来源 | **手绘**（生图稿只作视觉参考，不直接描） | 生图能力产出 |
| 用在哪 | 架构图节点、装配台槽位、IR 组件、SVG 导出 | 卡片配图、文档插图、页面 hero、演示封面、README |
| 为什么 | 缩放不糊、可 `currentColor` 上色、能进 SVG 导出 | 有质感、有光影、适合当插画 |

**这条分工必须写进代码注释**，否则下一个人会问「为什么有两套」。

### 3.2 分类体系（9 类）

新事实源 `arsenal-icons/icons.json` 的分类，和位图目录一一对应：

| category | 中文 | 覆盖 | 举例 |
|---|---|---|---|
| `actor` | 角色与外部 | 谁在用系统 | user admin operator auditor mobile browser bigscreen thirdparty legacy ai scheduler-bot |
| `compute` | 计算与运行 | 东西跑在哪 | server vm baremetal container pod serverless edge gpu batch jvm node |
| `network` | 网络与入口 | 请求怎么进来 | lb slb nginx gateway cdn waf dns reverseproxy firewall vpc subnet securitygroup private-line |
| `storage` | 存储 | 东西放哪 | rdb nosql timeseries graph columnar object fileshare warehouse datalake cache archive |
| `middleware` | 中间件 | 组件之间怎么说话 | mq registry config scheduler disttxn rpc service-mesh |
| `observe` | 观测与运维 | 出事怎么知道 | log metric trace alert dashboard apm audit healthcheck backup |
| `security` | 安全 | 怎么证明你是谁 | authn authz secret kms cert iam encrypt bastion siem audit-log |
| `delivery` | 交付与工程 | 怎么发出去 | cicd imagerepo artifactrepo iac configmgmt canary bluegreen rollback env-dev env-test env-prod |
| `topology` | 形态 | 一个还是多个 | single replica master-slave sharding readonly-replica multi-active ha-zone active-active |

**注意**：`topology` 这一类是给方案 3 的集群形态选择器准备的，本方案先把图画出来。

### 3.3 位图生成规范（写死，避免每批风格漂移）

| 项 | 规定 |
|---|---|
| 尺寸 | 512×512，导出 PNG（需要更小体积时再压成 WebP） |
| 底色 | **纯白 `#FFFFFF` 或极浅灰 `#F7F8FA`**，不透明（透明背景生图不可控，宁可统一底色，用 CSS 叠在浅色卡上） |
| 风格 | 扁平线性 + 单色描边 + 一处强调色填充；等距投影（isometric）**只在 `compute` / `network` / `topology` 三类使用**，其余用正投影 |
| 线条 | 视觉上 ≈2px（在 512 画布上）、端点圆角、无重描边堆叠 |
| 强调色 | 按分类取 —— 对齐 `ARCH_VIEW_IDENTITY` 的主题色系：`actor #4A5568` / `compute #3E9B4F` / `network #2F6FBA` / `storage #0F9B8E` / `middleware #7C5CBF` / `observe #D97B29` / `security #C4453C` / `delivery #55606E` / `topology #2F6FBA` |
| 文字 | **图内一律无文字**（生图写中文必乱码）；需要标签就在页面用 HTML 叠 |
| 阴影 | 允许一层柔和投影，不许长投影 / 倒影 |
| 禁止 | 写实照片风、3D 渲染金属质感、渐变彩虹、水印、logo 细节复刻 |
| 体积 | 单张 ≤60KB；全库 ≤6MB（超出就必须转 WebP 并记录） |

**一致性做法**：每个生图 prompt 都带上同一段「风格前缀」，只改主体描述。例如：

```
风格前缀（每张都带）：
flat vector icon, software architecture diagram symbol, thin uniform stroke,
single accent color {ACCENT}, plain white background, centered, no text,
no letters, no numbers, minimal, technical, 512x512

主体（逐张替换）：
{SUBJECT}
```

### 3.4 新事实源链路（按铁律 2，四处都要改）

```
tools/content/icons.py                      ← 唯一手写处（图标清单 + 分类 + 位图 prompt 摘要）
        │  python tools/build-content.py
        ▼
arsenal-icons/icons.json                    ← 事实源，进 Git
        │  node scripts/sync-content.mjs
        ▼
arsenal-web/src/generated/icons.json        ← 编译期快照（gitignore）
        │
        ▼
src/lib/icon-assets.ts                      ← resolver：iconAsset(key) / iconsByCategory() / searchIcons()
        │
        ▼
src/app/icons/page.tsx  +  IconGallery.tsx  ← 页面
```

`icons.py` 的单条定义字段：

```python
ICONS = [
  dict(key="nacos-dashboard", name="Nacos 控制台", en="Nacos Console",
       category="middleware", tags=["配置","注册"],
       vector="nacos",                    # 复用已有矢量 key（可空）
       bitmap="middleware/nacos-dashboard.png",
       accent="#7C5CBF", note="含配置列表视角"),
  ...
]
```

### 3.5 `/icons` 页面设计（必须是像样的可视化，不是列表）

用户明确拒绝纯列表 UI。要求：

- **左侧分类侧栏**：9 类，带计数，可多选
- **主区网格**：每卡 = 位图（`<img>`）+ 悬停显示三行信息（中文名 / 英文名 / key）+ 右上角两个动作（复制 key / 下载）
- **搜索框**：key / 中文名 / 英文名 / tags 四路匹配，输入即过滤
- **两种视图切换**：`位图卡` / `矢量卡`（矢量卡渲染 `iconSvg()`，24px→96px 缩放演示）
- **对比条**：选中若干图标后底部浮出一条，显示「已选 N 个」+「复制 Markdown 引用」+「复制 JSON 清单」
- **主题**：跟随站点浅色主题；卡片用现有 Tailwind tokens
- **空态**：搜不到时给「没有？用这个 prompt 生成一张」并展示拼好的生图 prompt

**接入 Shell.tsx 的 `NAV`**（在「架构图谱」之后插入「图标库」），并**必须**同时确认 `src/app/icons/page.tsx` 存在 —— 【13】会断言「导航项必须有真实页面、页面不许成孤儿」。

---

## 4. 分阶段实施

> 每阶段做完立刻验收，不通过不要进下一阶段。

### 阶段 A · 打通数据链路（先不画图）

1. 建 `tools/content/icons.py`，先只放 12 条（每类 1–2 条）作为骨架
2. 在 `tools/build-content.py` 里加 `build_icons()`，照抄 `build_cookbook()` 的写法，输出到 `arsenal-icons/icons.json`，用 `write_json`（`newline='\n'`）
3. `arsenal-web/scripts/sync-content.mjs` 加第六段：形状闸门 —— ① `key` 唯一且小写横线式 ② `category` 必须在 9 类内 ③ `bitmap` 路径不许绝对路径 / 不许 `..` ④ `bitmap` 对应文件必须存在（**这是本次最重要的断言**）⑤ `vector` 若非空必须存在于 `TECH_ICONS` ⑥ `accent` 必须是 `#RRGGBB`
4. 建 `src/lib/icon-assets.ts`：`iconAssets` / `iconAsset(key)` / `iconsByCategory()` / `searchIcons(q)` / `ICON_CATEGORIES`
5. 建 `src/app/icons/page.tsx` + `IconGallery.tsx`（先只显示骨架数据，位图用占位）

**验收**：`npm run build` 通过；`/icons` 能打开；`node scripts/sync-content.mjs` 在故意写一个不存在的 bitmap 路径时**报错中断**（反着验一次）。

### 阶段 B · 矢量图标补齐（手绘，± 全部新增）

新增 **≥81 个** `TECH_ICONS` 条目，按缺口清单：

| 组 | 新增 key（建议） |
|---|---|
| `actor` | `user admin operator auditor mobile bigscreen thirdparty legacy ai devops`（10） |
| `compute` | `vm baremetal pod serverless edge gpu batch cloud rack zone`（10） |
| `network` | `cdn waf dns reverseproxy firewall vpc subnet secgroup privateline apm-proxy`（10） |
| `storage` | `timeseries graphdb columnar objectstore fileshare warehouse datalake glaciers3`（9） |
| `middleware` | `disttxn rpc servicemesh configcenter-sync streamplatform`（6） |
| `observe` | `logcollector traceui alerting dashboard audit backup healthcheck slo`（8） |
| `security` | `secret kms cert iam encrypt bastion siem auditlog oauth`（9） |
| `delivery` | `cicd imagerepo artifactrepo iac configmgmt canary bluegreen rollback`（8） |
| `topology` | `single replica master-slave sharding readonly-replica multiaz active-active`（8） |

**要求**：
- 沿用 `P/C/R/S` 助手与 24×24 画布，风格与已有 89 个一致
- `kind` 字段取值限定在现有集合：`runtime | db | cache | mq | registry | doc | security | observe | infra | tool | none`；不够用时**新增** `actor | topology` 并在 `TechIcon` 类型与页面图例里同步
- 每个新 key 配 `name`（中文）与 `color`

**验收**：写一个临时脚本渲染全部 key 到一张 24px 网格对比图（`.workbuddy/_icon-contact-sheet.svg`），目视检查风格统一；用完删除。

### 阶段 C · 位图批量生成

**分批：每批 15–20 张**，每批流程：

1. 从当前批的每个图标拼 prompt（风格前缀 + 主体 + 分类强调色）
2. 用生图能力生成
3. 存到 `arsenal-web/public/icons/<category>/<key>.png`
4. 在 `tools/content/icons.py` 补登记
5. 跑 `python tools/build-content.py && node scripts/sync-content.mjs`
6. 目视抽检 3 张，风格飘了就调风格前缀重跑该批

**批内顺序**（先画最常用的，保证时间不够时也拿到了最有用的）：

| 批 | 内容 | 数量 |
|---|---|---|
| B1 | `actor` 全部 + `compute` 全部 | 20 |
| B2 | `network` 全部 + `topology` 全部 | 18 |
| B3 | `storage` 全部 + `middleware` 全部 | 15 |
| B4 | `observe` + `security` | 17 |
| B5 | `delivery` + 六视图概念图（对齐 `ARCH_GLYPHS`，仅供文档用） | 20 |
| B6 | 「组合场景」插画：微服务全貌、单体分层、数据流水线、多活容灾、可观测闭环… | 15 |

**验收（每批）**：
- `public/icons/**` 文件数与 `icons.json` 条目数一致
- 全库体积 ≤6MB
- `/icons` 页面该批全部渲染出来、加载时间正常

### 阶段 D · 接入使用

1. **装配台槽位卡片**：`src/app/stack/SlotBlock.tsx` —— 选中的选项在卡片上显示对应图标（位图或矢量，二选一按 `place` 决定）
2. **`/arch` 分区图**：`src/lib/arch-canvas.ts` 的分区标题用新增的 `topology` / `network` 类图标
3. **导出文档模板**：`arsenal-stacks/project.json` 的 `files.readmeTemplate` 里可引用的图标清单（只引用，不改模板结构）
4. **`/icons` 页自用**：页面顶部 hero 用 B6 的组合插画

> 接入 1、2 时**只读 `TECH_ICONS` / `ARCH_GLYPHS`，不改数据**。若发现某个 `architecture.json` 里的 icon key 是错的（指向 generic），记下来交给方案 3 处理，**本次不顺手改数据** —— 改了会牵动 verify。

### 阶段 E · 验证与收尾

1. 扩展 `.verify/project-check.ts` 【11】，新增断言（见下）
2. 同步四处 verify 数字（见 00-index 铁律 3）
3. 更新 `README.md`：目录树加 `arsenal-icons/`、进度表加一行「图标库」
4. 追加 memory 日志

---

## 5. 验收清单

```bash
# 1. 生成器 + 同步（必须都过）
cd D:/workspace/2026/mryang-arsenal
export PATH="/usr/bin:/bin:/c/Windows/System32:/c/Windows:$PATH"
python tools/build-content.py
cd arsenal-web && node scripts/sync-content.mjs

# 2. 全量自检
npm run verify

# 3. 构建（导出态资源路径在这一步才会暴露）
npm run build
```

**【11】要新增的断言（逐条写清楚，这是本方案的质量核心）**：

| # | 断言 | 反例（必须被抓到） |
|---|---|---|
| 1 | `icons.json` 每个 `key` 唯一 | 复制粘贴忘改 key |
| 2 | 每条 `bitmap` 指向的文件**真实存在** | 生成了图但忘落盘 / 路径打错 |
| 3 | `public/icons/**` 下每个文件都能在 `icons.json` 里找到 | 孤儿文件（生成了却没登记） |
| 4 | 每条 `vector` 非空时，key 必须在 `TECH_ICONS` 里 | 指向一个不存在的矢量 key |
| 5 | `category` 必须在 9 类内 | 拼错分类名 |
| 6 | 渲染器里出现的图标 key **必须**能在 `TECH_ICONS` 找到（不许静默回落 generic） | 把 `nginx` 写成 `ngnix` |
| 7 | 全库体积 ≤6MB | 位图没压缩 |
| 8 | `/icons` 路由存在且 `NAV` 有对应项 | 加了页面忘挂菜单（【13】也会抓） |

> 断言 6 是本次最值钱的一条。它把「写错 key → 灰方块、零报错」变成红色。写这条时要**先反着验一次**：故意把某个 key 改成错的，确认断言真的红。

---

## 6. 红线

1. 不引入任何图标 / 动画 / 绘图库依赖
2. 不改已有 89 个 `TECH_ICONS` key 的名字或形状
3. 不改 `arsenal-stacks/*.json` 里的 icon 引用（发现问题只记录）
4. 位图路径不许出现 `..` 或绝对路径
5. 生图**不写字**（中文必乱码，英文也容易拼错）
6. 每批生成后必须跑同步脚本，不许攒到最后
7. 调试产物写 `.workbuddy/_*`，用完即删
8. 时间不够时**优先保住矢量补齐（阶段 B）**，位图可以少画 —— 矢量是架构图真正用得上的那个

---

## 7. MVP 与可裁剪

| 优先级 | 内容 | 时间不够时的处置 |
|---|---|---|
| P0 | 阶段 A 全链路 + 阶段 B 矢量补齐 | 必须完成，这是骨架 |
| P0 | `/icons` 页面可搜索可复制 | 必须完成 |
| P1 | 阶段 C 中 B1–B3（actor/compute/network/topology/storage/middleware，约 53 张） | 至少完成 B1、B2 |
| P1 | 【11】断言 1–6 | 必须完成 |
| P2 | 阶段 D 接入装配台卡片 | 可留待方案 3 |
| P3 | 阶段 C 的 B4–B6（剩余约 52 张） | 可留待后续夜间任务 |

---

## 8. 收尾清单

- [ ] `python tools/build-content.py` 通过
- [ ] `node scripts/sync-content.mjs` 通过
- [ ] `npm run verify` 全绿（跳过的层要报告）
- [ ] `npm run build` 通过
- [ ] README 更新：目录树、进度表、verify 数字四处
- [ ] memory 日志追加（做了什么 / 踩了什么坑 / 剩余什么）
- [ ] `/icons` 页面截图或 HTML 预览呈现给用户

---

## 9. 定时任务 prompt（可直接粘贴）

```
执行 D:\workspace\2026\mryang-arsenal\docs\hy4-night-plans\plan-1-icon-library.md 的全部内容。

先读：00-index.md（四条铁律与环境备忘）、README.md、.workbuddy/memory/MEMORY.md、
最近三天的 .workbuddy/memory/*.md。

按「4. 分阶段实施」的 A→E 顺序做，每阶段做完立刻验收，失败就停下来说清楚。
核心要求：
1. 矢量图标（手绘 SVG，写进 src/lib/tech-icons.ts）必须补齐 ≥81 个，覆盖
   actor / compute / network / storage / middleware / observe / security / delivery / topology 九类；
2. 位图资产用生图能力批量生成，落 public/icons/<category>/<key>.png，分批 15-20 张，每批跑同步脚本；
3. 新建 arsenal-icons/icons.json 事实源（由 tools/content/icons.py 生成），
   并改齐四处：sync-content.mjs / icon-assets.ts / project-check.ts / README；
4. 新建 /icons 页面（分类 + 搜索 + 复制 key + 矢/位图双视图），同时在 Shell.tsx 的 NAV 挂上菜单；
5. 扩展 project-check.ts【11】的 8 条断言，其中「渲染器里的图标 key 必须能查到、
   不许静默回落 generic」这条必须先反着验一次；
6. 不许引入任何图标库/动画库依赖；不许改已有 89 个 key。

时间不够时按「7. MVP 与可裁剪」取舍，剩余项如实列入剩余工作量清单。
收尾按 00-index.md 第五节（verify + README + memory + present_files）。
```
