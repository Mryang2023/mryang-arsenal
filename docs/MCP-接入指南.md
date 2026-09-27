# 杨先生的军火库 · MCP 接入指南

> 让 AI 编码客户端（Claude Desktop / Cursor / 任何支持 MCP stdio 的客户端）在写代码的当下
> 主动来查约束、验合规，而不是靠人事先粘贴提示词。
>
> 实测口径：2026-09-27，node v24.21.0，Windows + Git Bash。本文所有示例输出都是
> 实跑抓取（注明「节选」的只截了头），没有一行是想当然的话。

---

## 一、这是什么

`arsenal-server/scripts/mcp-stdio.mjs` 是一个**单文件、零依赖**的 MCP stdio 服务器：

- 直接 `node` 运行，不装任何 npm 包（只用 `fs` / `path` / `url` 内置模块）；
- 启动时读 `arsenal-rules/**/*.json`（与前端、后端导出器同一份数据源），规则集实测 **69 条**
  （MUST 37 / NEVER 13 / SHOULD 18 / MAY 1），其中 **35 条**正则可本地执行；
- 对 AI 客户端暴露 **4 个工具 + 2 个资源方法 + 1 组 prompt**（见 §三）；
- 协议：JSON-RPC 2.0 over stdio（每行一条消息），支持 MCP `2024-11-05` /
  `2025-03-26` / `2025-06-18` 三个协议版本的协商（见 §四）。

## 二、怎么起

### 2.1 最小启动

MCP stdio 服务器不是「起一个端口」，而是**客户端把它当子进程拉起**。你要配给客户端的就一句启动命令：

```
node <仓库绝对路径>/arsenal-server/scripts/mcp-stdio.mjs
```

脚本从自身位置向上三级定位仓库根，**与客户端的工作目录无关**；规则目录默认
`<仓库根>/arsenal-rules`，需要另指时设环境变量 `ARSENAL_RULES_DIR`（绝对路径）。

### 2.2 一键生成客户端配置

```
$ node arsenal-server/scripts/mcp-install.mjs
杨先生的军火库 · MCP 配置片段生成器
仓库根（从脚本位置推导，未写死盘符）：D:/workspace/2026/mryang-arsenal

■ Claude Desktop　—— 配置文件通常是 %APPDATA%\Claude\claude_desktop_config.json（Windows）或 ~/Library/Application Support/Claude/claude_desktop_config.json（macOS）
{
  "mcpServers": {
    "arsenal": {
      "command": "node",
      "args": [
        "D:/workspace/2026/mryang-arsenal/arsenal-server/scripts/mcp-stdio.mjs"
      ],
      "env": {
        "ARSENAL_RULES_DIR": "D:/workspace/2026/mryang-arsenal/arsenal-rules"
      }
    }
  }
}
……（Cursor / 通用 JSON 两段形状相同，略）

下一步：
  1. 把选中片段合入客户端配置（是合入 mcpServers，不是整文件覆盖）；
  2. 接入步骤、能力清单、常见问题：docs/MCP-接入指南.md；
  3. 装好后验证：node arsenal-server/scripts/mcp-probe.mjs（27 项断言，exit 0 即通）。
```

片段是标准 `mcpServers` 形状（Claude Desktop 与 Cursor 的配置都用这一形状）；
客户端侧是否加载成功以各家客户端自己的日志为准，**服务端这一侧**的验证见 §六。

更多用法（`--write` 落盘 / `--client` 选择 / 覆盖保护）见 §五。

## 三、能力清单（全部实跑）

### 3.0 先看握手：initialize

客户端先发 initialize，服务器回能力声明。实测往返（客户端带 `2024-11-05`）：

```jsonc
// → 请求
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","clientInfo":{"name":"doc-demo","version":"0"}}}
// ← 响应（实跑原样）
{
  "protocolVersion": "2024-11-05",
  "capabilities": { "tools": {}, "resources": {}, "prompts": {} },
  "serverInfo": { "name": "arsenal", "version": "0.1.0" }
}
```

随后按协议发一条通知 `notifications/initialized`（服务器静默，不回包）。

### 3.1 工具（tools，4 个）

工具定义读自 `arsenal-rules/mcp-tools.json`，与前端/后端导出器同一份，`tools/list` 与导出产物天然不漂移。

| 工具 | 一句用途 | 参数 |
|---|---|---|
| `search_rules` | 按关键词检索规范条目，写代码**前**拿约束 | `query`（必填）、`severity`、`category` |
| `get_rule` | 按 ID 取单条规则完整定义（含来源、反例、正例、检查方式） | `id`（必填） |
| `lint_code` | 提交代码**后**自检：违规清单（带行号）+ 合规分 | `filename`、`content`（必填） |
| `get_prompt` | 取整份约束提示词注入会话 | `severity`（可选，如 `"MUST,NEVER"`） |

**search_rules 实测**（query=`线程池`，命中 6 条，节选前 2 条）：

```
匹配到 6 条：
• [NEVER] CONC-POOL-001（concurrency·正则+AST）禁止在应用中显式创建线程，线程资源必须由线程池提供
  每 new 一个 Thread 就新建一份栈空间（默认 1MB）和调度成本，且没有任何上限。……
• [NEVER] CONC-POOL-002（concurrency·正则）禁止使用 Executors 工厂方法创建线程池，必须显式使用 ThreadPoolExecutor
  Executors 的四个工厂方法全部埋了无界队列或无界线程数。……
```

**get_rule 实测**（id=`WEB-CTRL-002`，节选）：

```jsonc
{
  "id": "WEB-CTRL-002",
  "title": "@RequestBody 入参必须加 @Valid，且 DTO 字段必须带约束注解",
  "severity": "MUST",
  "sources": [ { "ref": "阿里巴巴Java开发手册 安全规约 §4【强制】", "type": "industry-standard", … } ],
  "rationale": "缺 @Valid 时，DTO 上写的所有约束注解会静默失效——不报错、不告警，非法数据直达业务层。……"
}
```

**lint_code 实测**（一段同时踩 `new Thread` / `Executors` / `System.out` 的 Java，完整输出）：

```
合规分 81/100（及格）｜违规 4 条｜正则可执行 35 条，另有 34 条需 AST/语义/人工（未纳入本次评分）。

违规清单：
✗ [NEVER] CONC-POOL-001 L3 禁止在应用中显式创建线程，线程资源必须由线程池提供
    Thread t = new Thread(() -> System.out.println("hi"));
✗ [NEVER] REL-LOG-001 L3 禁止使用 System.out / System.err / e.printStackTrace() 输出
    Thread t = new Thread(() -> System.out.println("hi"));
✗ [NEVER] CONC-POOL-002 L5 禁止使用 Executors 工厂方法创建线程池，必须显式使用 ThreadPoolExecutor
    Executors.newFixedThreadPool(4);
✗ [NEVER] REL-LOG-001 L6 禁止使用 System.out / System.err / e.printStackTrace() 输出
    try { risky(); } catch (Exception e) { e.printStackTrace(); }

本次未判定（需后端深度）：
• COL-GIT-002（人工）单次提交只做一件事，禁止混合无关改动
• COL-GIT-003（人工）禁止提交密钥、凭据与构建产物
……（实跑共列 12 条，此处截前 2；未纳入评分的共 34 条）
```

注意口径：`lint_code` 本地只跑 **Level-1 正则（35/69）**，与前端 engine.ts 同源同评分；
AST 层在后端 AstEngine（后端合计 42/69），这里如实列「未判定」，不假装能判。

**get_prompt 实测**（severity=`NEVER`，13 条，节选首行 + 首条）：

```
以下是杨先生的军火库的编码约束（共 13 条，级别过滤：NEVER）：

- [NEVER] COL-GIT-003 禁止提交密钥、凭据与构建产物：严禁提交任何密钥、凭据、证书文件（.env、*-local.yml、*.jks、*.p12）和构建产物（target/、build/、node_modules/、*.class）。……
```

### 3.2 资源（resources，69 条只读规则）

把整份规则集暴露为只读资源，URI 模式 `arsenal://rules/<规则ID>`。

| 方法 | 用途 | 实测 |
|---|---|---|
| `resources/list` | 列出全部规则资源 | 返回 **69** 条；每条含 `uri` / `name`(=规则ID) / `description`(=`[级别·分类] 标题`) / `mimeType` |
| `resources/read` | 读一条规则的完整 JSON | 内容与 `get_rule` 逐字节同一份（探针有断言） |

`resources/list` 首条实测：

```jsonc
{
  "uri": "arsenal://rules/COL-GIT-001",
  "name": "COL-GIT-001",
  "description": "[MUST·collab] Git 提交信息必须遵循约定式提交格式",
  "mimeType": "application/json"
}
```

读不存在的 id 是协议错误，实测：

```jsonc
// → {"jsonrpc":"2.0","id":5,"method":"resources/read","params":{"uri":"arsenal://rules/NOPE-000"}}
// ← （实跑原样）
{"code":-32602,"message":"资源不存在：arsenal://rules/NOPE-000（用 resources/list 查看全部 69 条）"}
```

### 3.3 Prompts（1 个定义，按 severity 取片段）

| 方法 | 用途 | 实测 |
|---|---|---|
| `prompts/list` | 列出可用 prompt 定义 | 1 个：`arsenal-constraints`，带 `severity` 参数说明（缺省 `MUST,NEVER`，50 条硬约束） |
| `prompts/get` | 取对应级别的约束片段列表 | `severity=NEVER` → messages 里一段「共 13 条」的 user 消息；`severity=WHENEVER`（不合法）→ `-32602` |

`prompts/get` 返回的是标准 MCP 消息结构，客户端可直接把它变成会话提示词：

```jsonc
{
  "description": "把「杨先生的军火库」的编码约束注入当前会话：按 severity 过滤规则集，取各规则的 promptFragment。",
  "messages": [ { "role": "user", "content": { "type": "text", "text": "以下是杨先生的军火库的编码约束（共 13 条，级别过滤：NEVER）：\n\n- [NEVER] COL-GIT-003 …" } } ]
}
```

## 四、协议细节

### 4.1 版本协商

initialize 时客户端带来的 `protocolVersion`：**认识就原样回它，不认识回服务器默认**。
服务器默认值读自 `arsenal-rules/mcp-tools.json` 的 `server.protocolVersion`（当前 `2024-11-05`），
与后端 `McpToolCatalog.protocolVersion()` 同一份、同一口径。实测两个方向：

| 客户端带 | 服务器回 | 说明 |
|---|---|---|
| `2025-06-18` | `2025-06-18` | 认识，原样回 |
| `2099-01-01` | `2024-11-05` | 不认识，回默认 |
| （不带） | `2024-11-05` | 同上 |

### 4.2 方法与错误码

| 方法 | 行为 |
|---|---|
| `initialize` / `ping` | 握手 / 探活（ping 回 `{}`） |
| `tools/list` / `tools/call` | 4 个工具 |
| `resources/list` / `resources/read` | 69 条规则资源 |
| `prompts/list` / `prompts/get` | 1 个 prompt 定义 |
| `notifications/*` | 一律静默（不回包、不崩）；`notifications/initialized` 走这条通道 |

错误码区分（均有探针断言，见 §六）：

| 错误码 | 场景 | 实测样例 |
|---|---|---|
| `-32602` | 参数缺失/不合法 | `tools/call` 缺 `name`；未知工具；`resources/read` 的 id 不存在；`prompts/get` 的 severity 不合法 |
| `-32603` | 内部错误 | handler 意外抛异常时回 `内部错误：…` |
| `-32601` | 未知方法 | `no/such/method` → `方法不支持：no/such/method` |

## 五、一键安装用法

`arsenal-server/scripts/mcp-install.mjs`，纯 node 零依赖。仓库根从脚本自身位置推导（不写死盘符），
launcher 数据读自 `arsenal-rules/mcp-tools.json`（唯一事实源），写出的文件一律 LF。

| 命令 | 行为（均实测） |
|---|---|
| `node arsenal-server/scripts/mcp-install.mjs` | 打印 Claude Desktop / Cursor / 通用 JSON 三段片段，`__ARSENAL_HOME__` 已替换为本仓绝对路径 |
| `--write <路径>` | 把**通用 JSON** 片段写入指定文件；父目录不存在会自动创建；实测写出内容无 `\r`（LF） |
| `--write <路径> --client claude` | 写入选中的其它片段（`claude` / `cursor` / `generic`） |
| 目标文件已存在 | **拒绝覆盖**（exit 1）——已有配置里可能住着别的 MCP 服务器，合并请手工做；确要覆盖加 `--force` |
| `--client vscode` | 不认识的客户端名（exit 2）；`--write` 缺路径（exit 2） |

## 六、常见问题

**Q1：需要先启动后端（3011）吗？**
不需要。MCP 是独立的 stdio 子进程，启动时直接读 `arsenal-rules/**/*.json`，
与 3011 上的 Spring 服务没有任何调用关系（`mcp-stdio.mjs` 里 0 处 http/fetch 引用，可 grep 验证；
回归探针 27 项断言全程不发生网络请求）。stdio 模式下客户端拉起的就是这个 node 进程本身。

**Q2：`ARSENAL_RULES_DIR` 指错会怎样？**
进程直接起不来，不会带病上线。实测：

```
$ ARSENAL_RULES_DIR=D:/nonexistent-rules-xyz node arsenal-server/scripts/mcp-stdio.mjs
[arsenal-mcp] 启动失败：规则目录不存在：D:\nonexistent-rules-xyz（可用 ARSENAL_RULES_DIR 覆盖）   # exit 1
```

**Q3：怎么验证装好了？**

- **服务端侧**（不依赖任何客户端）：`node arsenal-server/scripts/mcp-probe.mjs`。
  它 spawn 一个真实的 mcp-stdio.mjs 子进程、逐条喂 JSON-RPC 并断言**内容**（不是「有响应就算过」）。
  实测 27 项断言全绿、exit 0：

  ```
  PASS  initialize 版本协商：客户端 2025-06-18 → 回 2025-06-18
  PASS  tools/list 返回 4 个工具，名称与 mcp-tools.json 一致
  PASS  search_rules「线程池」命中 > 0（实测 6 条）
  PASS  get_prompt severity=NEVER 返回 13 条
  PASS  违规样例被真实扣分（score=81 < 100，违规 4 条 > 0）
  PASS  resources/list 返回 69 条资源
  PASS  prompts/get severity=NEVER 返回 13 条片段（messages[0].content.text）
  PASS  未知方法 no/such/method → -32601
  PASS  tools/call 缺 params.name → -32602
  ……（共 27 项）
  ═══ MCP 探针：27 过 / 0 败（共 27 项断言）═══
  ```

  它还替你守着两条回归：`get_rule` 与 `resources/read` 取同一条规则必须同一份 JSON；
  通知必须静默（服务器多吐任何一条没被登记的响应都算红）。

- **客户端侧**：重启客户端后，让它自己调一次 `search_rules`（query 填你正在写的东西），
  能吐出 `[SEVERITY] 规则ID` 格式的条目即接通。

**Q4：改了规则 JSON 要重启吗？**
要。规则在启动时加载一次，进程内没有热更新 —— 服务器回的每条数据都来自启动那一刻的
规则目录快照。改完 `arsenal-rules/**.json` 后让客户端把 stdio 子进程重新拉起
（最稳的做法是重启客户端），再跑一次探针确认口径没漂。

**Q5：Windows 路径要转义吗？**
片段生成器输出正斜杠（`D:/workspace/...`），Windows 上的 node 原生认，JSON 里也不用转义反斜杠。
