# 项目章程 · CI 落地指南

> 面向：想在自己项目里把「代码规范」从口头约定变成**可执行门禁**的开发者。
> 全篇每一步都分「说明」和「建议」两栏。建议不是客套话，是这套机制最容易踩的地方。

---

## 0. 三十秒版

| 你要做的事 | 用哪个命令 |
|---|---|
| 给自己的项目定规矩（条款 / 例外 / 放宽） | 在业务仓建 `arsenal-charter/<项目>.json`，或去军火库 `/charter` 页导一份 |
| 本地先看看仓库存量和多少违规 | `node <军火库>/arsenal-server/scripts/charter-ci.mjs export --mode audit --out .arsenal/ci` 然后 `... lint --mode audit` |
| 每次 PR 自动拦新增违规 | 把军火库导出的 CI 片段存成 `.github/workflows/charter-gate.yml` |
| 例外到期了怎么办 | 销账（`status: repaid`）或续期（改 `expiresAt`），改完走 PR —— 章程跟代码一样走评审 |

**一句话原理**：`export` 阶段把「判定要用的一切」冻结成一个文件，判定阶段只读那个文件。
这样同一个 PR 跑十次结论一样，`git` 出问题也不会让门禁变成「静默全绿」。

---

## 1. 前置条件（三件事，缺一件都跑不起来）

| # | 需要什么 | 怎么检查 |
|---|---|---|
| 1 | 军火库能被你 CI 拿到（git URL） | `git ls-remote <军火库地址>` 能出 ref 就行 |
| 2 | 业务仓里有一份章程 | `ls arsenal-charter/*.json` 或 `ARSENAL_CHARTER_DIR=/path/to/dir` |
| 3 | CI 拉全历史（`fetch-depth: 0`） | 片段里已经写好；手动跑要 `git fetch --unshallow` |

> **建议**：第 1 条如果军火库是私有库，别用裸 `git clone`（CI 里没有凭据），
> 改用 `actions/checkout` 的第二个 `repository:` 字段 + `token: ${{ secrets.ARSENAL_TOKEN }}`，
> 或者给 clone 加 `-c http.extraheader="AUTHORIZATION: basic $(echo x:$TOKEN | base64)"`。

**没有章程会怎样**：export 会直接报错退出（不生成空配置）。这是故意的 ——
「没有章程」和「章程说全部放行」在报告上长得一样，不能让前者伪装成后者。
如果你的项目暂时只想用 L0 基线（69 条公共规范），把 `arsenal-charter/` 放一个
只含 `policy` 的空壳文件（`clauses: []`）是**不行**的 —— 请明确接受「本项目暂无自定义条款」
并把这件事写进 README，而不是绕过 export。

---

## 2. 第 1 步：把军火库推到远端

**说明**：CI 片段里的第一步是 `git clone <军火库地址> .arsenal/arsenal`。你当前这台机器上军火库的远端是 **Gitee**：

```bash
git clone --depth 1 https://gitee.com/yang_huai_qiang1/mryang-arsenal.git .arsenal/arsenal
```

片段里印的是 `https://github.com/<你的账号>/arsenal.git`（占位符），要用上面这行替换。
片段里那个 `https://github.com/<你的账号>/arsenal.git` 是**占位符**，要换成你的真实地址。

**建议**：
- 军火库推到 Gitee / GitHub 都行，但**必须推到远端**，只在本机存在的话 CI 拿不到。
- 建议在片段里用 `git clone --depth 1`：军火库只是被执行器用（读规则 JSON），不需要它的历史。
- `.arsenal/` 建议加进业务仓的 `.gitignore` —— 它是 CI 现场生成物。

---

## 3. 第 2 步：给项目写一份章程

**说明**：章程是**手写 JSON**，字段与判据见 `arsenal-rules/_schema/charter-contract.mjs`。
最小可用的一份：

```jsonc
{
  "id": "my-proj", "name": "我的项目 · 工程章程", "version": "0.1.0",
  "owner": "mryang", "ratifiedAt": "2026-10-05",
  "team": ["mryang", "someone"],
  "extends": "arsenal-rules@0.1.0",
  "budget": { "mustLimit": 15 },
  "policy": {
    "overdueException": "error",   // 例外到期未销账：error 判负 / warn 只记账 / ignore 留痕不判负
    "orphanBlocks": "warn",        // 债主离队转 orphaned 后是否仍判负
    "requireTicket": "required",   // 例外是否必须带工单号
    "budgetScope": "separate"      // 章程 MUST 是否与 L0 的 50 条共享一个池子
  },
  "clauses": [
    {
      "id": "PJX-SVC-001", "title": "服务层必须走声明式 HTTP 客户端", "severity": "MUST",
      "category": "service",
      "clauseOwner": "mryang",           // 这条归谁管
      "decidedBy": "ADR-001",            // 依据哪次决策
      "effectiveFrom": "2026-10-05",     // 冻结线：这条从哪天开始算
      "pathGlob": "src/main/java/com/x/**", // 作用域
      "rationale": "手写客户端每次升级都要改三处",
      "bad": "...", "good": "...",
      "check": { "regex": { "pattern": "new RestTemplate\\(", "targetGlob": "**/*.java", "expect": "absent" } },
      "status": "active", "version": "0.1.0", "updatedAt": "2026-10-05"
    }
  ],
  "exceptions": [], "overrides": [], "consistency": []
}
```

**章程放哪（拍板项 ②，三档优先级后者覆盖前者）**：

| 档 | 放哪 | 适合 |
|---|---|---|
| 1 | `<仓库根>/arsenal-charter/` | 绝大多数项目（默认） |
| 2 | 军火库档案 `arsenal.json#project.charterDir` | 多项目共用一份军火库 |
| 3 | 环境变量 `ARSENAL_CHARTER_DIR` | CI runner / 业务仓把章程放别处 |

**建议**：
- **一项目一章程，别把全公司的规矩塞进一份文件**。章程的价值在于「近、具体、有人管」；
  写不下六十条的团队，多半是没在讨论哪些是公共的、哪些是自己的。
- `effectiveFrom` **不要写昨天**。写昨天意味着所有存量代码立刻变成「新增」，
  第一次 PR 就报几百条红，然后所有人都会关掉这个门禁。
- `MUST` 条款数控制在 `budget.mustLimit`（默认 15）以内。超了会在构建期直接失败 —— 这是设计。

---

## 4. 第 3 步：本地先跑一遍（别直接接 CI）

**说明**：两条命令，在业务仓根目录跑。

```bash
# ① 先看存量：全仓扫一遍，只出账不阻断（第一次跑请务必先跑这个）
node /path/to/arsenal/arsenal-server/scripts/charter-ci.mjs export --mode audit --out .arsenal/ci
node .arsenal/ci/charter-ci.mjs lint --config .arsenal/ci --mode audit --report debt.md

# ② 再看增量：只判「相对某个基线改了哪些文件」，命中 MUST/NEVER 就退出码 1
node /path/to/arsenal/arsenal-server/scripts/charter-ci.mjs export --mode pr --out .arsenal/ci --base origin/main
node .arsenal/ci/charter-ci.mjs lint --config .arsenal/ci --mode pr
```

参数说明：

| 参数 | 何时用 | 说明 |
|---|---|---|
| `--mode audit` | 定时任务 / 摸底 | 扫全仓，**永远退出码 0**，出债务账 |
| `--mode pr` | 每次 PR | 只判 export 阶段算出的文件清单 |
| `--base <ref>` | pr 模式必填 | 基线 ref。给 `origin/main` 或 `main` 都行，两种都试 |
| `--files-from <清单>` | 拿不到 diff 时 | 传一个每行一个文件名的清单文件 |
| `--today YYYY-MM-DD` | 复现历史结论 | 固定判定日，例外到期口径才可复现 |
| `--fail-on MUST,NEVER` | 想让 SHOULD 也拦 | 默认只拦 MUST/NEVER |
| `--report debt.md` | audit 模式 | 写债务账 markdown |

**建议**：
- 第一次接入**先跑 audit**。它会告诉你「如果全仓开这个门禁，现在是多少条」——
  这个数字决定你要不要花时间登记例外，而不是要不要开这个门禁。
- `--base` 拿不到 diff 时工具会**直接报错退出**（不会当成「本次没改文件」）。
  遇到这个错误就加 `fetch-depth: 0`，别去改判定逻辑。

---

## 5. 第 4 步：接进 CI

**说明**：在军火库 `/charter` 页点「导出 CI 片段」，或调
`buildCharterCI()` 拿内容，存成 `.github/workflows/charter-gate.yml`。

片段里每一步在做什么、为什么这么写：

| 步骤 | 在做什么 | 为什么 |
|---|---|---|
| `actions/checkout` + `fetch-depth: 0` | 检业务仓**全历史** | PR 门靠 `git diff` 算本次改了哪些文件；浅克隆拿到空 diff = 门禁静默失效 |
| `setup-node@v4` + node 22 | 装 Node | 执行器零依赖，只要 Node |
| ① `git clone` 军火库 | 取执行器 + 规则池 + 章程 | 门禁的口径来源在军火库，不在业务仓 |
| ② `git diff --name-only` | 打印本次改动文件 | 让日志里能看见「这次判的是哪些文件」；目视复核用 |
| ③ `charter-ci.mjs export --mode pr` | 冻结判定配置 | 清单在此刻算定，判定阶段不再碰 git |
| ④ `charter-ci.mjs lint --mode pr` | 判定 | 判负口径读章程 policy，片段不写死 |
| `debt-audit` job（每周一 03:17） | 全仓出账 | 不阻断。这页的 KPI 是数字下降，不是零 |

**建议**：
- 第一次接上后**盯着第一次 PR 的日志看一遍**，重点确认三件事：
  ① ② 步打印的文件清单是你以为的那些；② 规则池条数与预期一致（69 + 你的条款数）；
  ③ ④ 步的「检不了的 N 项」里没有你本来以为能查的规则。
- 定时任务刻意安排在 **03:17**（不是整点）。整点是全网定时任务的高峰，GitHub 会在那时候排队。
- 债务账 artifact 建议 `retention-days: 30`，四周后能对比「降了多少」。

---

## 6. 第 5 步：第一次看到输出，怎么读

```
项目章程门禁 · PR 门（只查本次 diff）
项目 my-proj · 章程 我的项目 · 工程章程 · 判定日 2026-10-05 · 判负 severity MUST/NEVER
规则池 71（L0 69 + 生效条款 2） · 判定文件 12（diff 清单里 1 个文件在盘上不存在，已跳过并计入统计）

✗ 阻断项 3 条（severity ∈ MUST/NEVER）：
  src/main/java/com/x/Svc.java:42:17  [MUST] PJX-SVC-001 服务层必须走声明式 HTTP 客户端
      条款归 mryang · 生效 2026-10-05 · new RestTemplate();
放行 1 处（各有台账，不是「查不到」）：
  PJX-SVC-001  src/main/java/com/x/Legacy.java  ← 例外 EXC-0001 放行（src/legacy/**，到期 2026-12-31）
例外台账 2 条：未销账且到期 1 条 · 孤儿 0 条
  ✗ [error] EXC-0002 → PJX-CFG-001（expired，到期 2026-09-30，债主 someone）
⚠ 本工具检不了的 34 项（**不假装通过**）：
  COL-CODE-002  需 Java AST 解析 —— CI 门禁只跑正则层（跑不了就说跑不了）
```

| 段落 | 含义 | 你该做什么 |
|---|---|---|
| 阻断项 | 这次改的文件里命中了 MUST/NEVER | 改代码，或去申请例外（见下节） |
| 提示项 | 命中 SHOULD/MAY，**不拦** | 看情况；想让 SHOULD 也拦就 `--fail-on` |
| 放行 | 靠例外 / override 放过了 | **看一眼**。台账不是免检记录，是「谁批的、批到什么时候」 |
| 例外台账 | 到期未销账 / 孤儿例外 | 见第 7 节 |
| 检不了的 | 非正则层（AST / 语义 / 人工） | 别把这当成「通过」。想覆盖就自己在 review 里补 |

---

## 7. 常见情况怎么处理

### 我确实要违反某条条款

**说明**：不要在代码里加注释绕过，也不要放宽正则。走例外登记簿：

```jsonc
{
  "id": "EXC-0007", "clauseId": "PJX-SVC-001",
  "pathGlob": "src/legacy/**",            // ★ 双条件：条款 + 路径，缺一不可
  "reason": "历史模块待重写，已建 TASK-1234，Q4 前收口",  // 必填，且不少于 20 字
  "approver": "techlead", "owner": "mryang",
  "grantedAt": "2026-10-05", "expiresAt": "2026-12-31",  // ★ 到期日必填，不接受永久
  "ticket": "TASK-1234", "status": "active"
}
```

**建议**：
- 例外是**双条件**豁免：条款对 **且** 文件路径落在 `pathGlob` 内。
  这一点是刻意的 —— 只按条款豁免的话，一行 JSON 就能让一条 MUST 在全仓失效，
  治理会从「有台账」退化成「有开关」。
- 一次授权尽量短（两三个月）。到期后要么销账（`status: repaid`）要么续期，
  走同一个 PR。`policy.overdueException = error` 时，到期没处理会**直接判负**。

### 例外到期了

| `policy.overdueException` | 行为 | 建议 |
|---|---|---|
| `error`（默认） | PR 门判负，逼你处理 | 新项目建议先用这个；它才是让台账保持干净的原因 |
| `warn` | 只记账不拦 | 团队还小、例外多的时候用，但**必须有人定期看 debt.md** |
| `ignore` | 留痕但完全不拦 | 不建议。三个月后没人知道曾经有这条豁免 |

### 我想让某条基线规则在这个项目放宽

用 `override`（它作用于 **L0 基线规则**，例外作用于**章程条款**，两者分工不同）：

```jsonc
{ "ruleId": "COL-GIT-002", "action": "relax",
  "reason": "本项目用 squash merge，线性历史由平台保证",
  "approver": "techlead", "expiresAt": "2027-01-31",   // ★ relax 必填到期日
  "pathGlob": "**" }
```

- `tighten` 收紧、`relax` 放宽、`replace` 换检查方式 —— **没有第四种 `delete`**。
  删掉一条基线等于宣布「所有人都不必遵守」，那和「不必遵守但建议遵守」不是一回事。
- `replace` 在契约里是**文字描述**而不是可执行正则，所以执行器**不会自动替换**，
  只会在输出里告诉你「这条被人改过检查方式，请人工确认」。这是刻意的：它宁可说检不了。

### 存量太多红

**说明**：存量**不应该**进 PR 门。你需要做的是：
① 先跑 audit 拿到数字；② 对着数字决定哪些是真债务、哪些本来就该用例外登记；
③ 债务账每期看数字下降，而不是要求清零。

**建议**：不要为了「让 CI 变绿」去给整批文件登记例外 —— 例外是**具体豁免**，
不是「批量静音」。整目录静音的正确做法是写一条 `relax` override（带到期日、带批准人），
让它在 debt.md 上留名。

### 本地 Windows 上跑

- 用 Windows 路径（`D:\...`）或相对路径都可以；路径统一按 `repoRoot` 解析，不按 cwd。
- 行尾不影响判定（正则按行切，内容匹配）。
- 执行器不需要装任何依赖，Node 22 即可。

---

## 8. 判负口径一览（改口径改哪里）

| 口径 | 改哪儿 | 生效范围 | 建议 |
|---|---|---|---|
| 哪些严重度判负 | `--fail-on MUST,NEVER` | 一次 CI 运行 | SHOULD 一般别拦，拦了会让人开始用例外绕过 |
| 例外到期判不判负 | 章程 `policy.overdueException` | 全项目 | 默认 `error` 是对的 |
| 孤儿例外判不判负 | 章程 `policy.orphanBlocks` | 全项目 | 债主离职是**组织问题**，建议先 `warn` + 交接清单 |
| 例外要不要工单号 | 章程 `policy.requireTicket` | 全项目 | 团队 ≥3 人时设 `required` |
| 章程 MUST 是否占 L0 的 50 条 | 章程 `policy.budgetScope` | 全项目 | `separate`（各算各的）更清楚 |
| 条款数上限 | 章程 `budget.mustLimit` | 构建期 | 想更严就调小，但先确认不是「写不下」造成的 |

**建议**：这六个口径**全部在章程 JSON 里**，执行器与 CI 片段都不写死。
「拍板」在这套机制里就是改一行 JSON + 走一个 PR，不需要改任何代码，也不需要找我。

---

## 8.5 命名一致性（第五层 · 全仓聚合）

前四层都是**单文件**判定：每个文件单独看都合规，合起来却可能是「同一个概念五种写法」。
第五层补的就是这个洞 —— 它在 CI 里**默认跟着跑**（不需要额外开关）。

```jsonc
{
  "id": "CONS-NAME-001",
  "concept": "校验",                       // 人读的那一层
  "canonical": ["Verify", "Check"],        // 认可的写法（至少一个）
  "forbidden": ["Validate"],               // 明令不许的
  "scope": "src/main/java/**",             // 检查范围（pathGlob）
  "check": { "type": "identifier", "minVariants": 2, "report": "drift" }
}
```

| 字段 | 取值 | 说明 |
|---|---|---|
| `type` | `identifier` / `package` / `table` / `interface` | 比对对象：类名与字段名 / 包名 / SQL 表名 / 方法名 |
| `minVariants` | ≥ 1 | 出现**超过**这个数量的写法就报。**写 0 等于关掉这项检查** |
| `report` | `drift`（默认）/ `block` | `drift` 只报不改（漂移是团队级现象，不该由一个人扛）；`block` 计入判负、会让 exit 1 |

输出长这样（`lint` 中段）：

```
命名一致性（第五层）2 项：漂移 0 · 命中禁用写法 2 · 一致 0 · 范围没扫到文件 0
  ✗ CONS-NAME-001 校验 → forbidden-hit（163 文件 / 3 种写法，上限 2）：validate×8（禁用）、Check×267、verify×91
```

四种结论里**只有一种是「通过」**，别把另外三种读岔了：

| 结论 | 含义 | 该做什么 |
|---|---|---|
| `clean` | 写法数在上限内，且没有禁用写法 | 不用管 |
| `drift` | 同一个概念正在分裂 | 团队层面统一，`report: block` 时可让它拦住新代码 |
| `forbidden-hit` | 明令不许的写法出现了 | 逐个改掉；**命中即报，不看有没有超过 `minVariants`** |
| ⚠ `no-files` | `scope` 没匹配到任何文件 | **这条检查当前没在检查任何东西** —— 修 `scope`，它不是通过 |

**两条边界**（别高估它）：

1. 只认得**配置里列出**的写法及其近义变体（`Arch` → `Archi`）。写了 `Framework` 而配置里只有 `Arch`，它发现不了 ——
   「哪些词算同一个概念」是人的判断，机器替代不了。
2. 复数与过去式不算新写法（`rules` 归到 `rule`），但 `checkout` / `checksum` 这类**派生词**也不算 ——
   它们只是恰好以同一个词开头，不是同一概念的另一种叫法。想让某个派生词参与比对，就把它显式写进 `canonical` / `forbidden`。

> 引擎源码在军火库里只有**一份**（`arsenal-web/scripts/lib/consistency-engine.mjs`）。
> `export` 会把它连 glob 实现一起复制成自包含的 `.arsenal/ci/consistency-engine.mjs`，
> 所以业务仓跑 `lint` 时仍然零依赖 —— 不会出现「CI 里判的和页面上显示的不一样」。

---

## 9. 这套门禁**检不了**什么（重要）

| 内容 | 为什么检不了 | 怎么办 |
|---|---|---|
| AST 层规则（如「必须用 try-with-resources」） | CI 门禁只跑正则层 | 在校验台点「后端深检」，或写进 code review 检查项 |
| 语义层规则（如「命名是否表达业务含义」） | 需要 LLM 判定 | 人看。章程里照样可以写，它会出现在「检不了的清单」里提醒你 |
| `override.replace` 的替换物 | 契约里是文字描述，不是可执行正则 | 人工确认后直接改 `check.regex.pattern` |
| 配置里**没列过**的同义词（如只配了 `Arch`，代码里却写 `Framework`） | 「哪些词算同一个概念」只有人知道 | 把真实存在的写法补进 `canonical` / `forbidden`；引擎只盯着**已列出**的写法有没有同时扩散 |
| 跨包引用的等价命名（不同包里同一个类的两个名字） | 需要类型解析，不是文本比对 | 人工过目 |

**建议**：把「检不了的清单」当成**待办队列**贴在 review 模板里。
一个团队如果长期不看这张清单，说明它已经变成装饰了。

---

## 10. 命令速查

```bash
# 军火库侧：生成判定配置
node arsenal-server/scripts/charter-ci.mjs export --mode pr    --out .arsenal/ci --base origin/main
node arsenal-server/scripts/charter-ci.mjs export --mode audit --out .arsenal/ci
node arsenal-server/scripts/charter-ci.mjs export --mode pr --files-from changed.txt   # 拿不到 diff 时

# 业务仓侧：零依赖判定
node .arsenal/ci/charter-ci.mjs lint --config .arsenal/ci --mode pr
node .arsenal/ci/charter-ci.mjs lint --config .arsenal/ci --mode audit --report debt.md
node .arsenal/ci/charter-ci.mjs lint --config .arsenal/ci --mode pr --fail-on MUST,NEVER,SHOULD

# 固定判定日复现历史结论（例外到期口径才可复现）
node .arsenal/ci/charter-ci.mjs lint --config .arsenal/ci --mode pr --today 2026-10-01
```

## 相关文件

| 文件 | 是什么 |
|---|---|
| `arsenal-rules/_schema/charter-contract.mjs` | 章程字段契约（唯一来源，勿手改） |
| `arsenal-web/scripts/lib/validate-charter.mjs` | 构建期校验器（五道闸门 + 政策驱动） |
| `arsenal-web/scripts/lib/charter-dir.mjs` | 章程目录三档解析（sync 与断言层共用一份） |
| `arsenal-server/scripts/charter-ci.mjs` | 本指南的主角：一个文件两种模式 |
| `arsenal-charter/arsenal-self.json` | 军火库自己的章程（可当模板抄） |
| `arsenal-web/.verify/charter-check.ts` | 章程层断言（含跨实现一致性） |
| `docs/开发计划-2026-10-03-项目章程/P0-项目章程.md` | 设计稿与落地记录 |
