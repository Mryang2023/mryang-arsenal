# 方案 2 · 场景案例库（按目的 + 按参数出生产级代码）

> **一句话**：把案例库从「4 条静态范文」升级为「**说出你的问题 + 调参数 → 直接给出生产级建库方案与 Java 代码**」。
> **建议时段**：第 2 晚（23:00 后）
> **依赖**：无（与方案 3 可互换顺序）
> **预计产出**：新事实源 `arsenal-cases/`、合成引擎 `case-synth.ts`、`/cases` 页面、6 个场景 × 每场景 6–10 个代码切片

---

## 0. 开工必读

| 顺序 | 文件 | 看什么 |
|---|---|---|
| 1 | `docs/hy4-night-plans/00-index.md` | 四条铁律、环境备忘、收尾套路 |
| 2 | `arsenal-cookbook/crud-basic.json` | **现有案例的真实 schema**，新库要长得像它 |
| 3 | `arsenal-web/src/lib/content-types.ts` 的 `Feature` / `FeatureFile` / `Highlight` | 字段定义 |
| 4 | `arsenal-web/scripts/sync-content.mjs` 的第 1 段（cookbook） | 锚点校验规则 —— 新库要复用同一套 |
| 5 | `arsenal-web/src/lib/stack.ts` 的 `composeStack()` | **合成引擎的范式**，`case-synth.ts` 要照它写 |
| 6 | `arsenal-web/src/app/blueprints/page.tsx` 与 `[id]/page.tsx` | 案例库前端现状 |
| 7 | `arsenal-web/src/lib/cookbook.ts` | resolver 范式 |

---

## 1. 现状（已核实）

### 1.1 现有案例库：4 条静态切片，加起来 2214 行

| 文件 | 主题 |
|---|---|
| `arsenal-cookbook/crud-basic.json` | 标准 CRUD 垂直切片 |
| `arsenal-cookbook/http-semantics.json` | HTTP 语义与状态码 |
| `arsenal-cookbook/async-transaction.json` | 异步与事务 |
| `arsenal-cookbook/skeleton-config.json` | 骨架与配置 |

`meta.json`：`{collection, name, version:'0.2.0', releasedAt, description, order:[...], count:4}`

单条 `Feature` 的 schema（`src/lib/content-types.ts`）：

```ts
id / order / name / subtitle / glyph / level / scenario / intent / tags[] / relatedRules[]
/ flow[]{layer,step,detail} / packages[] / files[]{id,path,layer,lang,role,code,highlights[]}
/ matrix? / checklist[] / pitfalls[] / notSuitable[] / performance?{title,columns[],rows[][],conclusion}
/ references[]{title,url?,note?}
```

`Highlight { mark, title, text, rule? }` —— **`mark` 是代码片段锚点，不是行号**。`sync-content.mjs` 会断言每个 `mark` 必须真的出现在 `code` 里。

### 1.2 三个关键结论

1. **案例库没有检索能力**。`scenario` / `intent` / `tags` 只是展示字段。`featuresByRule` 是给规则详情页做反向链接用的，不是搜索。README 里「按场景查」是一句使用建议，不是功能。
2. **案例库没有参数化生成能力**。真正的参数化合成只存在于装配台（`composeStack` → `renderPom/renderYaml`）。
3. **装配台那套「能力供需 + 三态结论」的范式非常成功**，本方案要把它复制到案例库上 —— 这是让新库「可运行性由数据决定」而不是靠文案承诺的唯一办法。

### 1.3 案例库的预期用途（来自用户的真实提问）

原话给出的三个具体问题：

- 「我有一个 Java 项目，**仓库的数据是以亿为单位**，数据量很大 → 教我怎么搭数据库、Java 代码怎么写、怎么处理这么高并发的数据」
- 「用户可以去选择**并发多少、数据库的规模、哪些接口**，然后生成对应的代码示例」
- 「在做**医院的项目，有关于基因的部分，DNA 序列很多**，患者会去查 DNA 序列，数据量非常庞大 → 告诉我如何建表建库、如何写 Java 代码才能快速查询」

**这三个问题现在的案例库一个都答不了。** 这就是本方案要解决的。

---

## 2. 目标与非目标

### 目标

- **G1 新事实源**：`tools/content/cases/*.py` → `arsenal-cases/*.json`，走标准链路
- **G2 参数化模型**：每个场景声明 4–6 个**驱动参数**（并发 / 数据规模 / 读写比 / 一致性 / 延迟目标 / 部署形态），每个参数有离散档位
- **G3 条件化切片**：每个代码切片带 `when` 条件，只有参数满足时才激活；**不满足时必须显式标注「该参数下不适用」，不许静默省略**
- **G4 合成引擎**：`src/lib/case-synth.ts` 的 `synthCase(caseId, params) → CasePlan`，**纯函数**，同参数两次调用结果必须逐字节一致
- **G5 生产级 Java**：首批场景必须覆盖虚拟线程、结构化并发、分片、keyset 分页、批量提交、连接池调参、幂等与限流
- **G6 页面**：`/cases` —— 左侧场景，中间参数面板，右侧代码流 + 架构建议图
- **G7 验证**：新增 `.verify/case-check.ts`，独立 `verify:cases`

### 非目标

- ❌ 不做「AI 现场生成代码」（不绑某家 AI，是项目原则）
- ❌ 不替代 `arsenal-cookbook`（4 条切片讲「一个功能完整怎么写」，`arsenal-cases` 讲「在这样的约束下该怎么设计」）
- ❌ 不生成可直接运行的项目骨架（那是装配台的职责）
- ❌ 不做压测执行（`benchmark` 只是**引用公开数据 + 说明**，不跑真压测）
- ❌ 不做代码的在线编辑 / 运行

---

## 3. 设计

### 3.1 与现有案例库的分工（写进 README，否则会有人问「为什么有两套」）

| | `arsenal-cookbook` | `arsenal-cases`（本次） |
|---|---|---|
| 回答 | 一个功能**标准**该怎么写 | 在**这些约束**下该怎么设计 |
| 输入 | 无参数，直接看 | 选场景 + 调参数 |
| 形态 | 4 条垂直切片，每条约 550 行 | 6 个场景 × 6–10 个切片 |
| 比喻 | 教科书范文 | 会诊 |

### 3.2 数据模型

```jsonc
{
  "collection": "arsenal-cases",
  "version": "0.1.0",
  "cases": [
    {
      "id": "huge-rowcount-rdb",
      "order": 1,
      "name": "亿级行关系库读写",
      "subtitle": "单表行数破亿之后，索引救不了你",
      "glyph": "db",
      "domain": ["电商", "金融", "物联网", "医疗"],
      "problem": "单表 3 亿行、QPS 3000、P99 目标 200ms，深分页与聚合查询超时",
      "symptoms": ["深分页越来越慢", "统计查询拖垮主库", "加索引没效果", "DDL 锁表数小时"],

      "drivers": [
        { "id": "qps",      "name": "并发量",   "unit": "QPS",
          "levels": [ {"id":"q1k","label":"1k","value":1000}, {"id":"q10k","label":"1万","value":10000},
                      {"id":"q100k","label":"10万","value":100000}, {"id":"q1m","label":"100万","value":1000000} ] },
        { "id": "rows",     "name": "数据规模", "unit": "行",
          "levels": [ {"id":"r10m","label":"1000万","value":10000000}, {"id":"r100m","label":"1亿","value":100000000},
                      {"id":"r1b","label":"10亿","value":1000000000}, {"id":"r10b","label":"100亿","value":10000000000} ] },
        { "id": "rw",       "name": "读写比",
          "levels": [ {"id":"rw91","label":"9:1 读多"}, {"id":"rw11","label":"1:1"}, {"id":"rw19","label":"1:9 写多"} ] },
        { "id": "consist",  "name": "一致性",
          "levels": [ {"id":"strong","label":"强一致","note":"不允许读到旧值"},
                      {"id":"bounded","label":"有界延迟一致","note":"秒级"},
                      {"id":"eventual","label":"最终一致"} ] },
        { "id": "latency",  "name": "P99 目标",
          "levels": [ {"id":"l50","label":"<50ms"}, {"id":"l200","label":"<200ms"}, {"id":"l1s","label":"<1s"} ] },
        { "id": "growth",   "name": "增长预期",
          "levels": [ {"id":"g1x","label":"年增 <1 倍"}, {"id":"g5x","label":"年增 5 倍"}, {"id":"g20x","label":"年增 20 倍"} ] }
      ],

      "slices": [
        {
          "id": "shard-key",
          "order": 1,
          "goal": "选出经得起时间考验的分片键",
          "layer": "设计",
          "when": { "rows": ["r100m","r1b","r10b"], "qps": ["q10k","q100k","q1m"] },
          "why": "行数破亿 + 高并发是分片的直接触发器",
          "decision": { "question": "按什么分片？", "options": [...], "chosen": "...", "tradeoff": "..." },
          "sql": "…建表 DDL（含分片键、索引、注释）…",
          "code": "…生产级 Java（见 3.4 要求）…",
          "highlights": [ { "mark": "…唯一片段…", "title": "…", "text": "…", "rule": "DATA-IDX-002" } ],
          "pitfalls": ["…", "…"],
          "notSuitable": ["…", "…"],
          "relatedRules": ["DATA-IDX-002", "DATA-PG-004"],
          "refs": [ {"title":"…","url":"…"} ]
        }
      ],

      "notSuitableFor": [ { "when": {...}, "reason": "…（说明这个场景不适合本方案，建议看哪个场景）" } ],

      "benchmark": {
        "title": "分片前后对比（公开数据引用，非本机实测）",
        "columns": ["方案", "P99", "吞吐", "来源"],
        "rows": [ ... ],
        "conclusion": "…"
      },

      "architecture": { "nodes": [...], "links": [...] }   // 供页面右侧画建议图，形状对齐 arch-canvas 的模型
    }
  ]
}
```

### 3.3 首批 6 个场景（覆盖用户给的两个真实例子）

| # | id | 名称 | 直接回答的问题 |
|---|---|---|---|
| 1 | `huge-rowcount-rdb` | 亿级行关系库读写 | 「仓库数据以亿为单位，怎么建库怎么写 Java」 |
| 2 | `genomic-sequence-store` | 基因 / DNA 序列海量存取 | 「医院项目，DNA 序列多，患者要查，怎么建表建库快速查」 |
| 3 | `high-throughput-io` | 高吞吐 IO 与虚拟线程 | 「多线程、虚拟线程怎么写」 |
| 4 | `hotspot-cache` | 热点数据与多级缓存 | 「热点查得太多，缓存怎么设计」 |
| 5 | `async-pipeline` | 异步流水线与最终一致 | 「跨服务的数据怎么保证最终对上」 |
| 6 | `wide-table-search` | 宽表、检索与分析 | 「既要模糊搜又要聚合统计，关系库撑不住」 |

**场景 2 的具体设计**（用户的真实案例，要做得特别扎实）：

```
问题：患者基因数据，单个样本的序列可达 GB 级；查询模式有三种 ——
  ① 按样本 ID 取全序列（低频、大流量）
  ② 按基因位点区间查变异（高频、小结果集）
  ③ 按人群做聚合统计（极低频、全表扫描）

切片规划：
  1. 存储分层决策：序列文件 vs 元数据表分开放
     - 序列本体 → 对象存储（MinIO / S3），DB 只存 pointer + 校验和
     - 变异位点 → 关系库 / 列存（按查询模式选）
     - 理由：BLOB 进关系库会让备份、主从复制、DDL 全部失控
  2. 建表 DDL：
     - `genome_sample`（样本元数据，按 patient_id 分片）
     - `genome_variant`（变异位点，按 chromosome + position 分区，复合索引）
     - `genome_sequence_object`（对象存储指针表）
     含：分区策略、索引、字符集、字段类型选择（不要用 TEXT 存序列）
  3. 区间查询怎么写：半开区间 [start, end) 的索引利用、复合索引列序
  4. 大对象读写：流式读取（不许 `byte[]` 全量进堆）、分块、断点续传
  5. 批量导入：COPY / `LOAD DATA` / JDBC batch 的取舍，导入期间不停服
  6. 冷热分层：3 个月前自动转对象存储冷层 + 查询路由
  7. 缓存：位点热查询的二级缓存 + 布隆过滤器
  8. 权限与合规：患者数据脱敏、审计日志（医疗场景必须写）
```

### 3.4 代码要求（这是本方案的核心质量线）

每个 `code` 字段必须满足：

| 要求 | 说明 |
|---|---|
| 语言 | Java 17/21；用到虚拟线程的切片必须在文件头注释写明 **需要 JDK 21** |
| 完整可读 | 不是片段堆砌 —— 至少包含 import、类声明、方法签名、异常处理 |
| 生产级要素 | 连接池配置、超时、重试退避、限流、批量大小、日志埋点（`log.info` 带关键参数） |
| 并发手段必须真的用上 | `ExecutorService` + 虚拟线程 / `StructuredTaskScope` / `CompletableFuture` + 自定义线程池（不用 `ForkJoinPool.commonPool`）/ `Semaphore` 限流 / `ReentrantLock` 边界 |
| 不许示范反模式 | 不许出现 `Executors.newCachedThreadPool()` 裸用、不许 `synchronized` 包大块、不许无界队列 |
| 注释解释「为什么」 | 不解释「这行是赋值」，只解释「为什么选这个分片键」「为什么这里不用 DISTINCT」 |
| 锚点 | 每个 `code` 必须配 ≥2 个 `highlights`，`mark` 是要在代码里真实存在的唯一片段 |
| 与规则联动 | `relatedRules` 必须引用真实存在的规则 id（`sync-content.mjs` 的校验会查） |

**推荐的代码骨架**（每个切片都按这个结构，读者一眼就知道在看什么）：

```java
/**
 * 场景：{场景名} / 切片：{切片名}
 * 适用参数：QPS {x} · 行数 {y} · {约束}
 * 依赖规则：DATA-IDX-002, CONC-POOL-001
 * JDK：21（虚拟线程）
 */
public class XxxQueryService {
    // 1) 依赖与配置（构造注入，不要字段注入）
    // 2) 主流程（一个公共方法，读起来像伪代码）
    // 3) 并发编排（虚拟线程 / 结构化并发 / 限流）
    // 4) 数据访问（SQL 或 Mapper 调用，SQL 用文本块写清）
    // 5) 异常与降级
}
```

### 3.5 合成引擎 `src/lib/case-synth.ts`

**只做一件事**：`(caseId, params) → CasePlan`。纯函数，无副作用，不读时间不读随机。

```ts
export interface CaseParams { [driverId: string]: string }   // driver id → level id

export interface CasePlan {
  kase: CaseDef;
  params: CaseParams;
  warnings: string[];              // 参数组合本身的矛盾，例如「<50ms 但要强一致跨 3 个库」
  activeSlices: SlicePlan[];       // 命中的切片
  inactiveSlices: { slice: SliceDef; reason: string }[];   // 未命中 —— 必须显式列出，不许静默丢
  decisions: DecisionSummary[];    // 汇总所有 decision，形成「设计决策清单」
  rules: string[];                 // 去重后的相关规则 id
  architecture: ArchSuggestion;    // 参数化后的建议架构（节点/连线）
}
```

**硬性规则**（照抄 `composeStack` 的精神）：

1. **缺省不是静默跳过**：切片没命中 → 进 `inactiveSlices` 并给出 `reason`（「该切片要求行数 ≥1 亿，当前 1000 万」）。页面上折叠显示，可展开
2. **矛盾要报**：参数组合本身不成立（如「QPS 100 万 + 强一致 + P99<50ms + 单库」）→ 进 `warnings`，并在页面顶部标黄
3. **确定性**：同样入参两次调用，`JSON.stringify` 结果必须相等（`.verify/case-check.ts` 会断言）
4. **不猜**：`architecture` 里的节点只能来自场景数据，不许引擎里硬编码

### 3.6 页面 `/cases`

布局（三栏，窄屏折叠为纵向）：

```
┌─ 场景列表 ─┬───────── 参数面板 ─────────┬──── 结果区 ────┐
│ ● 亿级关系库│ 并发量    [1k 1万 10万 100万]│ ⚠ 矛盾提示       │
│ ● 基因序列  │ 数据规模  [千万 1亿 10亿…]  │ ┌ 建议架构图 ┐  │
│ ● 高吞吐IO  │ 读写比    [9:1 1:1 1:9]     │ └───────────┘  │
│ ● 热点缓存  │ 一致性    [强 有界 最终]    │ 设计决策清单     │
│ ● 异步流水线│ P99       [50ms 200ms 1s]   │ ── 切片 1 ──     │
│ ● 宽表检索  │ 增长预期  [1x 5x 20x]       │ 目标/为什么/取舍 │
│             │ [重置] [复制为 prompt]      │ DDL + Java 代码  │
│             │                            │ 锚点/坑/规则     │
└─────────────┴────────────────────────────┴────────────────┘
```

**必须有交互，不能是静态页**：
- 参数按钮点一下立刻重算（纯函数，无请求）
- 切片卡片可折叠，代码块带语法高亮（**手写轻量高亮，不许引依赖**）
- 每个代码块三个动作：复制 / 下载 `.java` / 展开全部
- 「复制为 prompt」—— 把当前场景 + 参数 + 设计决策拼成一段可直接喂给 AI 的需求描述
- 结果区顶部一行摘要：`命中 6/9 个切片 · 涉及 14 条规则 · 建议架构 7 个节点`
- 建议架构图：用 `arch-diagram.ts` 的现成渲染能力，**不要新写绘图器**

### 3.7 验证 `.verify/case-check.ts`

| # | 断言 |
|---|---|
| 1 | 每个场景 `id` 唯一；`order` 连续 |
| 2 | 每个 `driver.id` 在场景内唯一；`level.id` 在驱动内唯一 |
| 3 | 每个切片的 `when` 只引用已声明的 driver / level |
| 4 | 每个切片至少 2 个 `highlights`，且每个 `mark` 真的出现在 `code` 里 |
| 5 | 每个 `relatedRules` 引用的规则 id 真实存在 |
| 6 | **穷举每个场景的所有参数组合**，断言 `synthCase` 不抛异常、且 `activeSlices + inactiveSlices == slices.length`（一个切片都不许丢） |
| 7 | 确定性：随机取 20 组参数，两次调用结果 `JSON.stringify` 相等 |
| 8 | 每个场景至少有一个参数组合能让**全部切片激活** |
| 9 | 每个场景至少有一个参数组合触发 `warnings`（矛盾检测真的在工作） |
| 10 | `/cases` 路由存在、`NAV` 有项、【13】契约通过 |

> 断言 6 是核心。**穷举组合数 = 各 driver 档位数之积**（6 个驱动各 3–4 档 ≈ 2000+ 组合/场景），要在合理时间内跑完 —— 如果超时，改成「每个 driver 取 min/max 的笛卡尔积 + 20 组随机」。

---

## 4. 分阶段实施

### 阶段 A · 数据链路 + 一个场景打通

1. 建 `tools/content/cases/__init__.py` 与 `cases/huge_rowcount.py`（只放场景 1，2–3 个切片即可）
2. `tools/build-content.py` 加 `build_cases()`，输出 `arsenal-cases/<id>.json` + `meta.json`
3. `sync-content.mjs` 加第七段闸门：形状（字段齐不齐）+ 断言 1–5
4. 建 `src/lib/case-types.ts`（类型）+ `src/lib/case-cases.ts`（resolver，照抄 `cookbook.ts` 写法）
5. 建 `src/lib/case-synth.ts`：先实现骨架，切片全激活
6. 建 `src/app/cases/page.tsx` + `CaseLab.tsx`（先粗糙，能用即可）

**验收**：命令跑通，`/cases` 能看到场景 1，改参数切片数量会变。

### 阶段 B · 补全场景 1 + 场景 2（用户的真实案例）

场景 1 扩到 8 个切片，场景 2（基因序列）按 3.3 的规划做 8 个切片。

**每个切片都要真的写代码**，不许占位。这是本方案最耗时的部分，也是唯一不可裁的部分。

**验收**：`/cases` 切到场景 2，把参数调成「10 万 QPS / 10 亿行 / 强一致 / P99 200ms」，能看到 8 个切片全激活、每个都有完整 Java 代码 + 建表 DDL。

### 阶段 C · 补足剩余 4 个场景

场景 3–6 各 6 个切片。优先度按用户原始需求排序：3（虚拟线程）> 4（缓存）> 5（异步）> 6（宽表）。

### 阶段 D · 断言与页面打磨

1. `.verify/case-check.ts` 写全 10 条
2. `package.json` 加 `verify:cases`，并入 `verify` 链（**放在 `verify:graph` 之后**）
3. 页面打磨：参数面板改为可视化控件（滑杆 / 段选器）、建议架构图接上、矛盾提示条、代码高亮
4. 摘要行、复制 prompt、下载 `.java`

### 阶段 E · 收尾

verify 数字同步四处（新增 `verify:cases` 一档，总数 473 → 473+N）；README 加目录树、进度表加「场景案例库」一行、并在「当前进度」里写清与 `arsenal-cookbook` 的分工；memory 追加。

---

## 5. 验收清单

```bash
cd D:/workspace/2026/mryang-arsenal
export PATH="/usr/bin:/bin:/c/Windows/System32:/c/Windows:$PATH"
python tools/build-content.py
cd arsenal-web && node scripts/sync-content.mjs
npm run verify          # 含新的 verify:cases
npm run build
```

手工验收（必须真点一遍）：
- [ ] `/cases` 六个场景都能切
- [ ] 每个场景的每个参数档位点下去，切片数与代码都跟着变
- [ ] 存在至少一组参数会弹出矛盾警告
- [ ] 「复制为 prompt」出来的文本是通顺的一段需求描述
- [ ] 场景 2 在「10 万 QPS / 10 亿行」下给出的建表 DDL 里，序列本体确实没进关系库

---

## 6. 红线

1. 不做「调用 AI 现场生成代码」（项目原则：不绑某家 AI）
2. 代码必须是**生产级**，不许写 `// TODO` 占位、不许写不能编译的伪代码
3. 切片没命中必须显式进 `inactiveSlices`，**不许静默省略**
4. 不许引入依赖（语法高亮手写，图表用现成的 `arch-diagram.ts`）
5. 不许把 `arsenal-cookbook` 的 4 条切片搬过来改名充数
6. 规则 id 引用必须真实存在，猜的 id 会在 sync 阶段炸 —— 别猜，去 `arsenal-rules/**/*.json` 查
7. 调试产物写 `.workbuddy/_*`，用完即删

---

## 7. MVP 与可裁剪

| 优先级 | 内容 |
|---|---|
| P0 | 阶段 A 全链路 + 场景 1 完整 + 页面可交互 |
| P0 | `verify:cases` 的断言 1–7 |
| P1 | 场景 2（基因序列，用户的真实案例）完整 |
| P1 | 断言 8–10 |
| P2 | 场景 3（虚拟线程） |
| P3 | 场景 4–6 |

**时间不够时的原则**：宁可 2 个场景做透，不要 6 个场景都是空壳。

---

## 8. 收尾清单

- [ ] 生成器 / 同步 / verify / build 全绿
- [ ] verify 数字同步四处
- [ ] README 更新（目录树、进度表、与 cookbook 的分工说明）
- [ ] memory 日志追加
- [ ] `/cases` 页面呈现给用户（`present_files`）

---

## 9. 定时任务 prompt（可直接粘贴）

```
执行 D:\workspace\2026\mryang-arsenal\docs\hy4-night-plans\plan-2-scenario-cookbook.md 的全部内容。

先读：00-index.md（四条铁律与环境备忘）、README.md、arsenal-cookbook/crud-basic.json
（看现有案例的 schema）、arsenal-web/src/lib/stack.ts 的 composeStack（看合成引擎范式）、
.workbuddy/memory/MEMORY.md 与最近三天的日志。

核心要求：
1. 新建事实源 arsenal-cases/（由 tools/content/cases/*.py 生成），并改齐四处：
   sync-content.mjs 形状闸门 / src/lib/case-*.ts resolver / project-check.ts 或独立 case-check.ts / README 目录树；
2. 每个场景声明 4-6 个驱动参数（并发量/数据规模/读写比/一致性/P99/增长预期），每个参数有离散档位；
3. 每个代码切片带 when 条件；未命中必须显式进 inactiveSlices 并给出原因，不许静默省略；
4. src/lib/case-synth.ts 是纯函数，同参数两次调用结果必须逐字节一致；
5. 首批 6 个场景，其中「亿级行关系库读写」和「基因/DNA 序列海量存取」必须做透
   （每个 8 个切片，含建表 DDL + 生产级 Java）；
6. Java 代码要求：JDK 21 虚拟线程 / 结构化并发 / 自建线程池（禁 commonPool）/
   Hikari 调参 / 批量提交 / keyset 分页 / 限流 / 幂等；不许 TODO 占位、不许反模式示范；
7. 新建 /cases 页面（三栏：场景 / 参数 / 结果），参数改动实时重算，并挂进 Shell.tsx 的 NAV；
8. 新增 verify:cases 独立一层，含「穷举参数组合断言 activeSlices+inactiveSlices == 切片总数」
   与「确定性断言」两条核心检查。

时间不够时按「7. MVP 与可裁剪」取舍 —— 宁可 2 个场景做透，不要 6 个空壳。
剩余项如实列入剩余工作量清单。收尾按 00-index.md 第五节。
```
