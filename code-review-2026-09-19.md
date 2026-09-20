# 军火库 · 代码审查报告

审查对象：`D:\workspace\2026\mryang-arsenal`（提交 `e1f0eee`，工作区干净）
审查日期：2026-09-19
审查范围：`arsenal-web`（TS/TSX 约 5.3k 行）、`arsenal-server`（Java 26 文件）、`tools/`（Python 7.4k 行）、`.verify/` 自检脚本、构建脚本与文档

审查方式：全量读关键源码 + 对数据源跑实证脚本（规则数据审计、产物一致性核对、自检快照与源码差分）+ 静态点算基线项数。
**未能实跑**：本工作区 `arsenal-web/node_modules` 为空（目录不存在），`tsx` / `next` / `playwright-core` 不可用，`npm run verify` 与 `tsc` 均无法执行 —— 见「§5 未能验证」。

---

## §0 结论摘要

架构立意是扎实的，几处自我约束（锚点校验、无出处不收录、隐患三段式、zip 读字节验证）落得比多数项目都实。但**"验证本身可信"这一层有两个洞**，恰好击穿项目的立身之本：

1. 引擎自检 `run.cjs` **永远不会失败**，且从不校验 `expected`（P0-1）；
2. 自检读的是 `.verify/samples.js` 这份**手维护的重复副本**，它已经和 `src/lib/samples.ts` 漂移（5/5 条 expected 不一致），且没有脚本能重新生成它（P0-2）。

另有一条实质性的产品承诺破口：**同一份"载体"在前端和后端导出的是不同内容**（P1-2）。

| 级别 | 编号 | 一句话 |
|---|---|---|
| P0 | 1 | `run.cjs` 无退出码、不校验 expected → 引擎这一环恒为绿灯 |
| P0 | 2 | `.verify/samples.js` 是手维护副本且已漂移，`run.cjs` 读的正是它 |
| P1 | 1 | 前后端 glob / 路径归一化 4 处不严格等价（今天不触发，是定时炸弹） |
| P1 | 2 | `json` / `mcp` / `markdown` 三种载体两端内容不同 → "多出口不漂移"的破口 |
| P1 | 3 | `buildMarkdown` 的分类条目数取全量计数，与筛选后的列表不符 |
| P1 | 4 | `sync-content.mjs` 的第二层校验是真子集，含"自足性"在内的 5 道校验没复刻 |
| P1 | 5 | `findDanglingRefs` 用 `groupId` 拼路径、文件落在 `basePackage` → 改包名即误报 |
| P1 | 6 | `project-check.ts` 用例名写「无鉴权」，代码是 `auth: 'securityjwt'` |
| P2 | 1–12 | 见 §3 |

---

## §1 P0：验证链条上两个洞

### P0-1 `run.cjs` 的引擎自检永远不会失败

`arsenal-web/.verify/run.cjs` 全文**没有 `process.exit`**，也**没有**把实际命中数与该样本的 `expected` 比较：

```js
// .verify/run.cjs
const ok = report.violations.length > 0;   // ← 只要 >=1 处就算通过
if (ok) pass++;
...
console.log(`预期  : ${s.expected} 处  实际 : ${report.violations.length} 处  ...`);  // 只打印，不断言
```

后果：`npm run verify` = `verify:arch && verify:project && verify:engine`，其中 `verify:engine` 的退出码**恒为 0**。哪怕 30 条可执行正则全部失效、5 个靶子样本一个都不命中，管线依旧报"全绿"。README 里「一条命令跑完三层」的第三层没有守门能力。

同时，`expected` 是 `samples.ts` 里明确标注为"实测值（由 `.verify/run.cjs` 自检脚本核对）"的字段 —— 而**这个核对从来没发生过**。

**修**（约 10 行）：
```js
if (report.violations.length !== s.expected) { fail++; }
// 文末
console.log(`通过 ${pass}/${total}，失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
```
建议顺带断言"累计命中规则条数 ≥ 19"与"规范写法样本 0 条 MUST/NEVER 误报"这两个基线数字（后者目前也只是打印，没有断言）。

### P0-2 `.verify/*.js` 是手维护的重复副本，且已经漂移

`.verify/` 下同时存在两套东西：

| 文件 | 行数 | 性质 |
|---|---|---|
| `audit-check.ts` / `project-check.ts` / `run.cjs` / `shots*.mjs` | [737 行合计] | 自检脚本本体 |
| `engine.js` / `samples.js` / `theme.js` / `types.js` | 511 行 | **`src/lib/*.ts` 的手工转译副本** |

这 4 个 `.js` 全部被 Git 跟踪（`git ls-files` 确认），但 `package.json` 里**没有任何脚本能重新生成它们** —— 只有 `tsx .verify/*.ts` 两个入口。它们是"编辑期产物"，却按"资产"提交了。

实证差分结果：

```
src/lib/samples.ts   expected: 9  5  3  4  2
.verify/samples.js   expected: 11 6  2  4  1     ← 5/5 条全部不一致
```

而 5 个样本的**代码内容字符串完全一致**（逐条 `includes` 校验通过）。也就是说：内容没改，只有 `expected` 两个文件不一样 —— 正是记忆里记下的那次"把凭印象填的 expected 改成实测值"只改了 `.ts`，`.js` 快照忘了重新生成。

`engine.js`(288 行) 与 `engine.ts`(346 行) 我逐行核对过，**逻辑目前一致**；`theme.js` 也一致。但它们靠的是"碰巧没人动过"，不是机制 —— 任何人改一次 `src/lib/engine.ts`，`verify:engine` 就会悄悄地继续测旧版本，输出一份看起来很认真的报告。

**修**（二选一）：
- 首选：删掉 `.verify/*.js`，把 `run.cjs` 换成 `run.ts` 用 `tsx` 直接测 `src/lib/engine.ts`；
- 次选：加 `"verify:compile": "tsc .verify/entry --outDir .verify"` 并挂进 `preverify`，让它成为生成物。

这个问题的形态（"测的是产物不是源码，且没有机制保证产物跟着源码走"）恰恰是本项目专门为之设计了一堆校验的那类问题 —— 它出现在校验自己身上，性质比后果更值得注意。

---

## §2 P1：会给出错结论的地方

### P1-1 前后端引擎的 glob / 归一化 4 处不等价

`GlobMatcher.java` 的注释写着「与前端 `engine.ts` 的 `globToRegExp` 保持完全相同的行为 —— 两端结论不一致比没有校验更糟」，`MEMORY.md` 也把这条列为铁律。但没有任何自动化守门，实际已存在 4 处分叉：

| # | 点 | 前端 `engine.ts` | 后端 `GlobMatcher` / `LintEngine` |
|---|---|---|---|
| 1 | 剥离前导 `./` | `replace(/^\.\//,'')` 只剥**一层** | `while (startsWith("./"))` 剥**到底** |
| 2 | `{a,b}` 选项 | `split(',').map(escapeLiteral)`，**不 trim** | `Pattern.quote(alts[k].trim())`，**trim** |
| 3 | `{...}` 内的 `*` `?` | `escapeLiteral` 的字符类**不含** `*?`，会当正则量词 | `Pattern.quote` 全字面 |
| 4 | regex flags | `'gm' + (flags 去掉 g/m)`，其余原样交给 JS（`y`/`d`/`v` 会生效） | 只映射 i/s/u，其余静默忽略 |

佐证 #1 的具体分叉：文件名 `././A.java` → 前端算 `./A.java`，后端算 `A.java`。

**今天不触发** —— 我把全部 11 种 `targetGlob` 与全部 flags 取值跑了一遍：`**/*.java`×17、`**/pom.xml`×2、`**/application*.{yml,yaml,properties}`、`**/controller/**/*.java`×2、`**/service/**/*.java`、`**/*.{java,xml,sql}`、`**/*.sql`×2、`**/*.{java,sql,xml}`、`**/src/test/**/*.java`、`**/src/main/java/**/*.java`、`**/*.commit-msg`；flags 只有 `None`(22) / `'i'`(6) / `'im'`(1) / `'s'`(1)。花括号内无空格、无通配符，`./` 也不会重复。30 条正则我用 JS 语义全部编译过，**零失败**。

所以这是**一组沉默的定时炸弹**：加一条 `**/{*.yml, *.properties}` 或一条带 `y` 标志的规则，两端结论立刻分家，而且不会有任何提示。

**修**：做一次双向差分测试 —— 同一批 glob，两端各生成正则、各跑同一组路径（含 `./x`、`././x`、`a/{b, c}`、大小写混排），比对结果集；把这个测试挂进 `npm run verify`。成本很低，收益是这条铁律第一次有了守门人。

### P1-2 同一种"载体"，前后端导出内容不同

`EXPORT_FORMATS` 里 `json` 的说明是「未经加工的 Rule 对象数组」。实际：

| 载体 | 前端 `exporters.ts` | 后端 `ExporterService` |
|---|---|---|
| `json` | 完整 Rule 数组 + ruleset/name/version/exportedAt | **只有 `{count, ids:[...]}`** |
| `mcp` | `$comment` + `mcpServers` + `$toolDefinitions`（4 个工具的完整 inputSchema） | `$comment` + `mcpServers` + `_availableRules` + `_tools`（字符串数组） |
| `markdown` | 有「目录」章节；分类标题用中文名（`## 工程骨架 · Skeleton`）；表头带 MUST/NEVER 明细 | 无目录；分类标题是**原始 key**（`## skeleton`）；表头不同 |

后果：任何自动化（CI / MCP 适配层 / 脚本）走 `/api/export/*` 拿到的东西，和人在界面上点出来的是**两份不同的东西**。这正是「一份数据三种出口」要防的漂移 —— 数据源确实只有一份，但**编译规则有两份**。

后端 `buildJson` 尤其值得注意：它实现为逐行字符串拼接，`rules.get(i).id()` 直接插进 `"` 里，没有任何 JSON 转义；当前 ID 干净所以没问题，但一个手写的 JSON emitter 本身就是不该出现在"讲规范"的项目里的东西。

**修**：短期至少让两端的 `json` 语义对齐（后端也吐完整 Rule 数组）；中期考虑 `ExporterService` 的产物直接从前端同源逻辑产出（或反之），否则就是两份实现长期并行。

### P1-3 `buildMarkdown` 的分类条目数是错的

```java
// ExporterService.java:149
b.append("_").append(index.byCategory(currentCategory).size()).append(" 条_ \n\n");
```

`index.byCategory(...)` 是**全量分类计数**（`RuleIndex` 里按 category 建的全量索引），而循环遍历的 `rules` 是**已按 severity 过滤过**的列表。所以 `?severity=MUST` 导出时会出现「某分类下写 9 条、实际只列 3 条」。前端同名位置（`exporters.ts:207`）用的是 `list.length`，是对的 —— 又一处两端不一致。

**修**：对 `rules` 做同分类计数。

### P1-4 `sync-content.mjs` 的第二层校验是真子集

`sync-content.mjs` 的注释写：「生成器已经校验过一遍；这里再独立校验一次，因为它守的是一条硬底线」。但 grep 确认它复刻的只有 4 项：维度/选项引用、能力引用、配置类双向交叉、模板占位符。

**没有**复刻（sync-content.mjs 内命中数为 0）：
- 自足性检查（`cap_owner == {dim}`，"向自己索要"）
- 泳道流水线合法性
- `POLICY_DETAIL ↔ POLICIES` 一一对应、`symptoms ≥ 2`
- 策略可达性（不能是死数据）
- `structureNotes` 引用的规则 id 必须存在

问题在于**那个真实发生过一次的 bug 恰好落在没复刻的那一类**：`observability/prometheus` 曾写成 `requires: [cap.metrics]`，而 `cap.metrics` 的唯一提供者就是它自己所在的槽位。这个错误只被 Python 侧拦住。如果直接手改 `arsenal-stacks/architecture.json`（而不是改 `.py` 再生成），手改可以顺利通过 sync-content 并被前端完整吃进去 —— 界面上会**永久显示"跑不起来"，且没有任何错误提示**。

**修**：把 5 道校验抽成一份共享的数据校验模块（Python 侧导出 JSON、Node 侧读同一份规则），或至少在 `sync-content.mjs` 里补齐"自足性 + 策略可达性"这两道最贵的。

### P1-5 `findDanglingRefs` 的路径基准与写文件的基准不是同一个

```ts
// project.ts
const JAVA_MAIN = `src/main/java/${projectDoc.basePackage.replace(/\./g,'/')}`;   // :82  写文件用这个
...
const base = `${projectDoc.groupId}.`;                                            // :696 扫引用用这个
const path = `src/main/java/${classFqn.replace(/\./g,'/')}.java`;                 // :710 比较用这个（硬编码）
```

现在 `groupId = basePackage = com.example`，所以没暴露。但 `findDanglingRefs` 的作用是生成 README 里「上手前必须补齐的类」清单，而这个项目对它的自我约束是**「宁可少报不要多报 —— 把已有文件也列成缺失会消耗掉信任」**。只要 `basePackage` 改成 `com.example.arsenal` 而 `groupId` 没跟着改，`present.has(path)` 会永远为假 —— 包内每一个被 import 的配置类都会被列进"缺失"。

更麻烦的是守门缺失：`project-check.ts:275-278` 的断言是
```ts
check('算出的类确实不在包里', stdPlan.dangling.every(d => !stdPlan.files.some(f => f.path === d.path)));
```
只验证"报出来的确实不在包里"，**没有反向断言"包里的没被报成缺失"**。所以上面这个失效模式当前完全没有守门。

**修**：两处统一用 `basePackage` 派生；补一条断言：`dangling` 中不得出现任何 `files` 里已有的 `.java`（按文件名比对也算，因为路径前缀可能不同）。

### P1-6 自检用例名与代码不符

```ts
// .verify/project-check.ts:279-283
check(
  'jdbc 且无鉴权时，悬空引用显著更少',
  planOf({ ...defaultPicks, persistence: 'jdbc', auth: 'securityjwt' }).dangling.length <
    stdPlan.dangling.length + 6
);
```

名字说「**无鉴权**」，代码传的是 `auth: 'securityjwt'` —— 恰恰是**有鉴权**。另外阈值 `+6` 是拍出来的松弛量，名字说"显著更少"，断言却允许比基准更多 5 个。这条自检目前证明不了它宣称的事情。

**修**：名字改成实情，或代码改成 `auth: 'none'`（若 `none` 是合法选项 id），并把阈值收到有意义的范围。

---

## §3 P2：健壮性、一致性、可维护性

| # | 位置 | 问题 |
|---|---|---|
| 1 | `rules.ts:85` / `engine.ts:171` / `exporters.ts:76` / `Rule.java:118` | **"active 规则"有四套判定**：`status !== 'deprecated'` / `status === 'active'` / `status === 'active'` / `status == null \|\| ACTIVE`。今天 62 条全是 `active` 无影响；加一条 `draft` 就会出现"规则库看得到、校验台不检、后端检"的三方打架。建议收敛成一个 `isActive()` |
| 2 | `sync-rules.mjs:125` | `_checkLayer` 用**对象存在性**（`r.check?.regex`），而引擎用 `pattern` 非空。我跑脚本核对过规则数据：**不存在**"regex 对象在但 pattern 为空"的条目，所以仅是隐患 |
| 3 | `RuleIndex.java:212` | `manualOnly = rules.size() - regex`，实际等于"非正则层可检"，把 ast/llm 也算进去了，名字误导 |
| 4 | `CheckConsole.tsx:47-51, 56-61` | **在 state updater 里调 setState**（`setFiles(prev => { ...; setActive(...); return next; })`）。`next.config.mjs` 开了 `reactStrictMode: true`，开发态 updater 会被调用两次。React 要求 updater 是纯函数。应改为先算 `next` 再分别 set |
| 5 | `CheckConsole.tsx:160` | `key={i}` 用在**可增删**的文件 tab 列表上。当前 tab 内无本地 state 所以不是现 bug，但这是全仓唯一一处"可增删 + 下标 key"，建议改成文件路径 |
| 6 | `stack.ts:124` | `Object.assign(properties, option.pomProperties ?? {})` 走 `[[Set]]`，源对象的 `__proto__` 键会触发 setter，属理论性原型污染。数据源是仓库内可信 JSON，风险极低 —— 但一个讲安全规范的项目在这里用 `Object.entries` 逐键赋值更自洽 |
| 7 | `project.ts` | **"纯函数"这条自我约束只对 `composeStack` 成立**。`renderAppClass` / `renderGradle` / `renderProdYaml` / `findDanglingRefs` / `buildExportPlan` 都闭包引用了模块级 `projectDoc` —— 有隐式 IO 依赖，不可单独测试 |
| 8 | `zip.ts:91` | 对重复 `path` 无防护。`buildExportPlan` 做了去重，但打包器自身不设防；重复条目在解压时后者覆盖前者且不报错 |
| 9 | `zip.ts` | 无 ZIP64、无 65535 条目数防护。当前规模不可能触发，仅记录 |
| 10 | `engine.ts:168` / `CheckConsole.tsx` | **前端 `lint()` 无输入规模上限**。后端有 `max-scan-bytes = 2MB`（超限抛 400），前端没有。粘一大段代码 + 一条回溯灾难性的正则 = 浏览器卡死。规则正则已全部核对可编译，但"可编译"≠"无灾难性回溯"，建议加同口径上限 + 对每条正则做回溯压力测试 |
| 11 | `build-content.py:36` | `open(full, 'w', encoding='utf-8')` 未指定 `newline='\n'` → Windows 落盘 CRLF，而 `sync-content.mjs` 写的是 LF。`.gitattributes` 的 `* text=auto eol=lf` 兜住了 Git 侧，但工作区两种换行并存。加一个参数即可 |
| 12 | `run.sh:104` | `SOURCES=$(find src/main/java -name "*.java")` 未加引号展开，路径含空格会断 |

### 文档与磁盘（本项目最在意的事）

`README.md` 我逐条核对了数字：

| README 声称 | 核对结果 |
|---|---|
| 62 条 / MUST 37 + NEVER 13 = 50 强制级 / SHOULD 12 | ✅ 实测完全一致 |
| 32 条需 AST、前端只跑正则 30 条 | ✅ 实测 30 条 pattern 非空，32 条非正则 |
| 4 切片 / 32 文件 / 2214 行 / 98 备注 | ✅（沿用项目内既有统计口径） |
| `audit-check.ts` 35 项 | ✅ 顶层 `check(` 恰好 35 个 |
| `project-check.ts` 103 项 | ✅ 按通过路径点算（4 预设 ×9 + 结构 24 + 启动类 10 + 隐患 5 + README 15 + zip 12）≈ 103，与声明一致 |

两处过时：
- `README.md:12` 仓库位置仍写 `D:\mryang\workspace\2026\arsenal`，实际是 `D:\workspace\2026\mryang-arsenal`。
- `README.md:62` 写「`.verify/ 自检脚本（649 行）`」，实际 `.ts/.mjs` 合计 **737 行**；若把 511 行 `.js` 快照也算进去则更多（而那部分本来就该删）。

---

## §4 做得好的地方

不是客套，这几处是这次审查里质量明显高于平均线的地方：

1. **前端注入面是干净的。** `highlight.ts` 先 `escapeHtml`（顺序正确：先 `&` 再 `<` `>`）再拼 span，`dangerouslySetInnerHTML` 全仓只出现 2 处、且都吃这份已转义结果；`splitHighlightedLines` 用栈补跨行 span 的闭标签，注释里还写明了"因为已转义，所以可以安全按 `<span` 做状态机解析"。整仓**零 `any`、零 `@ts-ignore`、零 `eslint-disable`**。

2. **`RuleLoader.resolve` 是踩坑之后的正确解法。** 绝对路径 → 工作目录 → 逐级上溯（同时试裸目录名），且**只接受带 `meta.json` 的目录** —— 判断依据是内容不是名字。报错文案把"试过哪些候选 + 当前工作目录 + 怎么指定"全列出来。这是真正的可诊断性，不是"友好提示"。

3. **两条口头原则被落成了机器门禁。** `RuleLoader.inspect` 把"无出处不收录"变成启动期硬拦截（宁可崩，不要静默少几条规则）；锚点校验把"编辑静默丢失"变成显式构建错误 —— 记忆里记着锚点校验真抓到过 2 处错位。把原则变成 CI 能执行的东西，比原则本身值钱。

4. **隐患数据模型 `trigger / symptoms / impact` + 可达性自检。** "写不出可观察现象的，不算隐患，只是观点"——这句话被做成了数据校验（`symptoms ≥ 2` + 每条策略必须能被某种选型命中）。这是我在这场 review 里见到的最扎实的一处设计：它防的不是写错，而是**写空**。

5. **zip 的验证方式。** 手写 ZIP 且注释写清三处易错（bit 11、小端、中央目录偏移相对整包起点），验证不看截图而是 `readUInt16LE(6) === 0x0800` 真读字节，并且在注释里**记下了自己一开始写错成 `buf[6] & 0x08`**。这个态度比代码本身更值得保留。

6. **后端零 `try-catch`、全构造器注入、record 建模、统一 `@RestControllerAdvice`。** 服务自己遵守军火库规则，而且遵守得没有例外 —— 一个讲规范的项目最容易犯的错就是自己破例，这里没有。

---

## §5 未能验证（诚实记录）

1. **没能实跑 `npm run verify`。** 本工作区 `arsenal-web/node_modules` **不存在**（不是空的，是目录都没有），`tsx` / `next` / `playwright-core` / `typescript` 全部不可用。所以"35 + 103 + 引擎样本全绿"这个基线我只做到了**静态点算**（见 §3 表格），**没有实跑复现**。严格说这条基线目前只能算"看起来对" —— 这本身就是 P0-2 想说的那件事的另一个侧面：**声称的验证结果，和可复现的验证结果，不是一回事。**
2. **后端未能编译验证。** `compile-check.sh` 未执行（需先确认 `~/.jdks/ms-17.0.18` 与 `.m2` 依赖齐备）。Java 侧结论全部来自源码阅读，未经过编译器检验。
3. **性能未测。** `LintEngine` 的二分定位、`RuleIndex` 的加权检索、前端 `locateAnchor` 的 O(notes×code) 都只做了复杂度评估，没有实测数据。
4. **未审的外围文件**：`StackComposer.tsx`(807 行，全仓最大的 UI 文件)、`Inspector.tsx`(359)、`ProjectTree.tsx`(347)、`BlueprintView.tsx`(378) 只做了针对性扫描（key / any / 副作用），没有逐行审。`tools/content/*.py` 的**内容正确性**（Java/YAML/SQL 写得对不对）不在本次范围 —— 那是规则与蓝图的内容审查，不是代码审查。

---

## §6 建议的修复顺序

| 顺序 | 项 | 理由 | 量级 |
|---|---|---|---|
| 1 | P0-1 + P0-2 | 让"验证"先变得可信。修完之后再重跑一次 verify，才能确认后面所有结论的基线 | 半小时 |
| 2 | P1-3 + P1-6 | 纯 bug，改动局部、无设计权衡 | 15 分钟 |
| 3 | P1-2 | 三处载体对齐；短期至少把 `json` 语义对齐 | 半天（若要彻底同源则更多） |
| 4 | P1-5 | 统一路径基准 + 补反向断言 | 1 小时 |
| 5 | P1-1 | 做成双向差分测试，让这条铁律第一次有守门人 | 半天 |
| 6 | P1-4 | 抽共享校验模块，或至少补"自足性 + 可达性" | 半天 |
| 7 | P2-1 / P2-2 / P2-4 / P2-10 | 口径收敛与低风险清理 | 1 小时 |
| 8 | P2-7 / P2-8 / P2-10 / P2-11 | 留着也行，记录在案 | — |
