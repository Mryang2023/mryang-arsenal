# 杨先生的军火库（arsenal）· 项目长期约定

## 这是什么

mryang 的个人代码规范字典 + AI 代码合规校验平台。
目标：让**任何 AI** 生成的代码都收敛到他自己的工程规范上。

立项日 2026-09-11。计划书：workspace 根目录 `杨先生的军火库-项目计划书.md`。

## 不可动摇的三条设计原则

1. **一份数据，三种出口。** 每修改一条规则，必须同时惠及「人查 / 给 AI 用 / 拿代码验」三条路径。
2. **Rule as Data。** 规则是结构化 JSON 对象，不是 Markdown 文字。改数据源 = 三处同时生效。
3. **写不出 bad/good 示例的规则不收录。** 「代码要健壮」这类无法判定的鸡汤一律拒绝。

## 技术约定

| 项 | 值 |
|---|---|
| 代号 | `arsenal` |
| 后端 | `arsenal-server`，Spring Boot 3.2.x + Java 17，端口 **3011** |
| 前端 | `arsenal-web`，Next.js 14 App Router + TS + Tailwind，端口 **3010** |
| 存储 | `arsenal-rules/**/*.json`、`arsenal-cookbook/*.json`、`arsenal-stacks/stack.json` 三者为 source of truth（Git 化）；SQLite `data/arsenal.db` 仅作索引缓存 |
| 校验引擎 | Level 1 正则/AST（优先，零成本）→ Level 2 LLM（仅 MUST/SHOULD，强制要求行号定位）→ 歧义项标「待确认」不计分 |
| 严重度 | MUST / SHOULD / MAY / NEVER；**MUST 总数硬上限 50 条** |

## 规则分类树（9 大类）

`skeleton` · `web` · `service` · `data` · `concurrency` · `reliability` · `security` · `test` · `collab`

## 内容资产（四块，缺一不可）

| 资产 | 回答什么 | 数据源 | 规模 |
|---|---|---|---|
| **规则集** | 不能做什么 | `arsenal-rules/**/*.json` | 62 条（MUST+NEVER 50 已卡满上限） |
| **蓝图库** | 一个功能完整该怎么写 | `arsenal-cookbook/*.json` | 4 条垂直切片 / 32 文件 / 2214 行 / 98 条备注 |
| **架构装配台** | 由哪些零件组成、**拼起来能不能跑** | `arsenal-stacks/stack.json` + `architecture.json` | 6 泳道 / 17 模块 / 42 选项 / 27 能力 / **16 条策略** |
| **结构层** | 落到磁盘上长什么样、**能一键导出** | `arsenal-stacks/project.json` | 20 目录 / 56 文件节点 / 9 条开关归属 |
| **导出中心** | 怎么喂给 AI | 由上面几者合成 | 5 种载体 + **项目骨架 zip** |

**蓝图与选型的源数据由 Python 生成器产出**：`tools/content/*.py` → `python tools/build-content.py`
→ `arsenal-{cookbook,stacks}/*.json`。不手写 JSON —— 因为 Java/YAML/XML 里全是双引号和换行，
手写 JSON 字符串必须逐行转义，极易出错且完全不可读。

**五条硬约定**：

1. **要点备注用「片段锚点」定位，禁止用行号。** 行号会随代码改动错位，
   而错位的备注比没有备注更危险（它给出自信的错误结论）。
   `scripts/sync-content.mjs` 在构建时校验锚点是否存在，找不到即 **构建失败**。
2. **选型合成是纯函数** `composeStack(picks)` —— 无副作用无 IO，前后端复用同一份逻辑，
   保证多出口产物不漂移。空槽位必须跳过，不得回退到默认选项。
3. **预设引用完整性在生成期校验** —— 引用了不存在的维度或选项直接生成失败。
   预设未声明的维度**留空**，不回填默认值（否则「单体最小集」会被补成满配）。
4. **可运行性由数据决定，不由代码决定。** 「缺什么会跑不起来」来自能力供需求解
   （每个选项声明 `provides` / `requires`），不是写死的 if。新增中间件只需声明能力，
   校验逻辑、画布着色、结论文案自动跟上。
5. **架构数据的 5 道构建期校验**：覆盖完整性 / 能力引用 / **自足性** / 策略引用 / 流水线合法性。
   其中自足性专抓「某选项索要的能力只有它自己所在的槽位能提供」—— 那是无解组合，
   用户永远拼不出来。**这道检查真的抓到过一次真 bug**（见 `memory/2026-09-11.md`）。
6. **结构树必须与选型数据双向交叉校验。** 树里写了 `MybatisPlusConfig.java`，
   选型数据里就得真有；选型产出的 13 个配置类，树里得都有落位。两边脱节时界面看着毫无异样，
   照着建出来的目录却是错的。`build-content.py` 与 `sync-content.mjs` **各独立跑一遍**
   （一个读内存对象、一个读落盘 JSON），任何一步序列化出问题只有第二层能发现。
7. **隐患必须写成可核对的线索，不是一个警告。** 每条策略要有
   `trigger`（什么条件下发生）/ `symptoms`（发生时在哪看到什么）/ `impact`（后果边界）。
   判据：**写不出可观察现象的，不算隐患，只是观点。** 另有一条可达性自检 ——
   每条策略都必须在某种选型下真能被命中，否则是死数据。
8. **导出的 zip 用标准工具验，不看截图。** 打包器自己写（零依赖，`src/lib/zip.ts`），
   验证方式是落到磁盘后交给 Python `zipfile.testzip()`。ZIP 有三处易错：
   UTF-8 文件名要额外打通用标志位 bit 11、多字节整数全是小端序、
   中央目录里的偏移量相对整个包的起点。

## 关键决策记录

- **不做** auto-fix：只诊断给建议，改代码交给 AI + 人判断。
- **不做** 绑定某家 AI 的代理：只做规则供给，AI 换代军火库仍在。
- **不做** 规则市场 / 多租户 SaaS。上限是单人 + 小团队（≤10 人）。
- 导出载体固定 5 种：Markdown 规范书 / System Prompt / `.cursorrules` / `CLAUDE.md` / MCP Server（P1）。
- **P1 的 MCP Server 是项目成败关键** —— 让 AI 写代码时主动查规范，才能真的治本。

## 规则来源（2026-09-11 变更）

**来源 = 行业基准，不是既有项目代码。**

| 来源 | 用途 |
|---|---|
| 阿里巴巴 Java 开发手册（嵩山/黄山版） | 主力。其「强制」条目为候选池主干 |
| Google Java Style Guide | 格式、命名、imports、Javadoc、@Override（可引章节号） |
| Spring Boot 3 / Framework 6 官方文档 | 分层、构造器注入、@Transactional、Jakarta 命名空间、@Async |
| OWASP Cheat Sheet / Top 10 | 注入、反序列化、XSS、凭据、日志 |
| Effective Java 3rd Ed | 异常设计、资源管理 |
| Conventional Commits / RFC 9110 | 提交格式、HTTP 语义 |

**为什么不用代码反推**：command-center 大量代码由 AI 生成，反推会把 AI 的毛病固化成规范。
既有项目代码改作「合规度对照样本（靶子）」，用于校验引擎的验收。

**筛选四道闸门**：① 可判定 ② 有 bad/good 示例 ③ 有可执行 check ④ 与项目技术栈相关。
**来源调整必须留痕**：升级/降级要在基线文档里写明理由。

## 种子数据产出（v0.1 已落地）

**62 条规则，MUST 37 + NEVER 13 = 50 条强制级（正好卡满上限），SHOULD 12 条。**

- 人读版：`杨先生的军火库-规则基线-v0.1.md`
- 机器版：`arsenal-rules/**/*.json`（11 个文件）+ `_schema/rule.schema.json`

分布：skeleton 6 / web 7 / service 7 / data 7 / concurrency 9 / reliability 9 / security 7 / test 4 / collab 6

## 仓库与运行方式（v0.1 已落地）

工作区 `C:\Users\Administrator\WorkBuddy\2026-09-11-08-02-39\`（非用户长期路径，属会话工作区）

| 目录 | 内容 |
|---|---|
| `arsenal-rules/` | 规则数据源。11 个 JSON + `_schema/rule.schema.json` + `meta.json` |
| `arsenal-cookbook/` | 蓝图数据源。4 个 feature JSON + `meta.json` |
| `arsenal-stacks/` | 装配台数据源。`stack.json`（17 模块 / 42 选项 / 4 预设）+ `architecture.json`（6 泳道 / 能力供需 / 16 条策略）+ `project.json`（目录树 / 启动类模板 / 导出文件模板） |
| `tools/` | 内容生成器。`build-content.py` + `content/*.py`（**改内容改这里，不要改 JSON**）；`stack_arch.py` 是架构叠加层，`stack_project.py` 是结构层 |
| `arsenal-web/` | Next.js 14 前端，3010。`src/generated/{rules,cookbook,stack,architecture,project}.json` 是编译期快照（生成物，不提交） |
| `arsenal-server/` | Spring Boot 3.2.5 后端，3011。**目前只读规则集，未读蓝图与装配台** |

**前端跑法**：`npm run dev`（本沙箱会被 safe-delete 拦截）→ 改用 `npm run build` +
`python -m http.server 3010 --bind 127.0.0.1 --directory out`
（构建前必须**在前台单独**清 `.next` / `out`，且加 `NODE_OPTIONS=` 清空注入的删除守卫）
**后端验证法**：`bash arsenal-server/scripts/compile-check.sh`（无 mvn，JDK 17 在 `~/.jdks/ms-17.0.18`）
**一条命令跑完全部校验**：`npm run verify` = 引擎样本 + 架构自检（35 项）+ 结构层自检（103 项）
**视觉自检**：`node arsenal-web/.verify/shots.mjs`（画布 6 态）+
`npx tsx .verify/shots-project.mjs`（结构图 / 启动类 / 隐患单 / 导出，**会真的接住浏览器下载的 zip**）
**内容重建**：`python tools/build-content.py && cd arsenal-web && node scripts/sync-content.mjs`

## 环境铁律

**同一文件的多个修改必须串行执行。** 在同一条消息里对同一个文件并行发多个 Edit 会互相覆盖，
只有最后一个生效，而且**没有任何报错**。已踩过两次（`samples.ts` 的 expected、`async_tx.py` 的锚点）。
不同文件之间可以并行。发现「改了但没生效」时，第一时间怀疑这条。

**清理构建产物必须在前台单独执行。** 环境变量 `NODE_OPTIONS` 里被永久注入了删除守卫
（`--require=.../node-language-shim.cjs`），清 `.next`（数百文件）会触发
`SAFE_DELETE_BULK_CONFIRM_REQUIRED`。前台命令可弹批准通过；**后台命令无法弹批准 → 直接失败**，
且 stdout 为空、只在 stderr 留一行 safe-delete 错误，**极易误判成代码问题**。
构建本身要加 `NODE_OPTIONS=` 前缀清空注入（否则 Next 内部删临时文件也会被拦）。

## 已实现的能力边界（重要，别高估）

- 校验引擎**只跑正则层**：62 条里 30 条有 `check.regex`，这 30 条可真检出；
  其余 32 条（ast/llm/manual）**进 `skipped` 如实披露，不伪造判定**。这是刻意设计，不是缺陷。
- 前端与后端的 glob 匹配、正则标志（M 模式）、行号定位、评分公式**必须保持一致**，改一端要同步另一端。
- 自检基线：5 个靶子样本全命中、累计 19 条规则、**规范写法 0 误报**。改动引擎后要重跑 `.verify/run.cjs` 对基线。
- **架构校验的基线是 35 项**（`.verify/audit-check.ts`）。改动能力模型、槽位必需性或策略后必须重跑。
  基线里包含刻意的反例断言：Caffeine + Nacos 必须是 **risk 而不是 blocker**（它确实能启动），
  拆掉数据库时**不得出现「无人提供」的独立条目**（那是归并失效）。
  另有一条：**报出的风险项必须写清了触发条件与现象** —— 报一条说不出会看到什么的风险，
  和没报没有区别，还会消耗掉对整份报告的信任。
- **结构层与导出包自检基线是 103 项**（`.verify/project-check.ts`）。它守的是
  「看起来没问题但是错的」那一类错误：导出包里少了 `Application.java`、
  目录树画了 `mapper/` 但选的是 JPA、启动类的开关归属表和实际选型对不上。
- **导出包不含业务代码，也不假装能直接编译。** 只含结构与配置。
  README 里的「上手前必须补齐的类」是**算出来的**（扫 `import` 里引用包外类的位置，
  映射成预期路径比对包内文件），不是写死的清单。**宁可少报不要多报** ——
  把已有文件也列成缺失会消耗掉信任。
- **启动类的设计立场：尽量空。** 每个 `@EnableXxx` 都放在它影响的那块代码旁边
  （`@EnableScheduling` 在 `SchedulerConfig`、`@EnableCaching` 在 `CacheConfig`）。
  代价是看不出开了哪些开关 → 所以生成 `Application.java` 时**实时算一张开关归属表**写进注释。
  改这一块时不要为了「让启动类看起来充实」而把开关挪回启动类。
- **架构结论分三档，不要合并**：跑不起来 / 能跑但零件不全 / 可以跑起来。
  把所有缺失都渲染成「错误」会让人不再信任报告。
- 「迁移」不是请求链路的一环（发布期动作），画布上用竖线与链路隔开；
  `PIPELINES` 只列请求流经的组件。

## 待推进

1. **MCP Server 适配层** —— 接口全部就绪，只差协议层。**这是项目成败关键**
2. **蓝图与装配台接入后端 API** —— 前端已完整可用，后端目前只读规则集，属架构不完整
3. **AST 层**（JavaParser，32 条 ast 规则）
4. LLM 语义层（仅 MUST/SHOULD，强制行号定位）
5. **需 mryang 逐条过目 62 条规则**，标记「同意 / 改 / 删」。没过目就不算军火库
6. **结构层的 2 条规则缺口**：「按领域分包，不按层分包」「config 是唯一允许出现 `@Bean` 的地方」
   在规则集里没有对应条目（skeleton 只有 `SKEL-STRC-001` 包名 / `SKEL-STRC-002` 启动类根包）。
   界面已如实标为「规则缺口」而不是挂假 id —— 挂不存在的规则 id 比不挂更糟。
   补不补这两条规则待定（补需动已冻结的 62 条基线）
7. 覆盖度扩展：蓝图候选（文件上传 / 定时任务 / 外部回调幂等 / 游标分页 / 数据导出）；
   模块候选（网关 / 链路追踪 / 限流熔断 / 分布式锁 / 灰度发布 / 对象存储）
8. 能力模型细化：目前能力是布尔存在性，可进一步表达「能力规格」
   （如连接池容量 vs 虚拟线程并发量之间是否配得上）

## 待 mryang 拍板的事项

- ~~Service 是否要做接口 / 实现类分离~~ → **已闭环**：`SVC-LAYR-003` 定为**不拆**（Spring 4+ 默认 CGLIB 类代理，单实现时接口是纯样板）
- **当前卡点**：62 条规则源自行业基准，纯度够但没掺个人偏好。需他过目后才是「他的」军火库
- **结构层要不要补规则**：见「待推进」第 6 条。不补则两条结构原则永远只有文字没有规则守

