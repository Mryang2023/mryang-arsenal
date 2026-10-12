# arsenal-server · 杨先生的军火库（后端）

规则供给与代码合规校验服务。Spring Boot 4.1.1 + Java 21 + Jackson 3 + jakarta 命名空间，端口 **3011**。

```bash
mvn spring-boot:run          # 启动（需 Maven）
mvn -q clean package         # 打 jar
```

本机没有 Maven，所以有两个脚本可以替代：

```bash
bash scripts/run.sh          # 编译并启动（无需 Maven，用本地 .m2 的依赖）
bash scripts/compile-check.sh  # 只做静态编译校验，不启动
```

`run.sh` 支持 `RUN_CWD=<dir>` 指定工作目录 —— 用于复现「工作目录不同导致行为不同」这类问题。

## 它做什么

| 能力 | 接口 |
|---|---|
| 规则检索 | `GET /api/rules?q=&severity=&category=&autoOnly=` |
| 分类树 | `GET /api/rules/grouped` |
| 单条规则 | `GET /api/rules/{id}` |
| 溯源出处排行 | `GET /api/rules/sources` |
| **代码校验** | `POST /api/lint` |
| 导出（JSON 包装） | `GET /api/export/{format}` |
| 导出（裸文本） | `GET /api/export/{format}/raw` |
| 元信息 / 健康检查 | `GET /api/meta`、`/api/stats`、`/api/health` |

导出格式：`prompt` / `markdown` / `cursorrules` / `claude` / `mcp` / `json`

```bash
# 直接把约束提示词写进文件
curl -s "http://localhost:3011/api/export/prompt/raw?severity=MUST&severity=NEVER" > rules.md

# 校验一段代码
curl -s -X POST http://localhost:3011/api/lint \
  -H "Content-Type: application/json" \
  -d '{"files":[{"name":"src/main/java/com/x/controller/A.java","content":"..."}]}'
```

## 规则从哪来

`arsenal.rules-dir`（默认 `../arsenal-rules`，可用环境变量 `ARSENAL_RULES_DIR` 覆盖）
指向与前端、导出器完全相同的那份 JSON。

**服务端不持有规则副本，也不在数据库里存第二份。** 它只是那堆 JSON 的一层可执行外壳。

### 相对路径不绑工作目录

`../arsenal-rules` 是相对路径，而「相对谁」这件事曾经让服务起不来：
在 `arsenal-server/` 下启动时它指向正确位置，在仓库根下启动时指向上一层并不存在的目录，
报错只说「目录不存在」，看不出其实是工作目录不对。已踩过一次。

现在的解析顺序是「绝对路径 → 工作目录 → 逐级向上（含裸目录名）」，并且
**只接受带 `meta.json` 的目录** —— 判断依据是内容不是名字，
所以不存在「同名空目录被误认」的情况。启动日志第一行就会打出解析结果：

```
INFO  c.a.l.RuleLoader - 规则目录：D:\...\arsenal\arsenal-rules
```

若解析结果不是按工作目录直奔的那一个，日志会额外说明「工作目录 X 下没有，已自动换基准找到」。
真找不到时，报错会把试过的每条路径和当前工作目录一起列出来。

## 启动时会发生什么

`RuleLoader` 读完所有规则后会做完整性体检，**发现问题直接拒绝启动**：

- ID 缺失或重复
- 缺 category / title / severity / rationale / bad / good / promptFragment
- `sources` 为空（军火库的收录底线：无出处不收录）
- `check` 四层全空（这条规则根本无法被任何方式验证）
- 强制级数目超出配额上限时会 **WARN**（不阻断，但会提示该降级了）

静默少加载几条规则，比启动失败危险得多 —— 你会以为自己在被 62 条规则保护，实际只有 59 条。

## 校验引擎的边界

只执行 `check.regex` 层。其余三层（ast / llm / manual）**不伪造判定**，
一律进报告的 `skipped` 字段并说明原因。

这是刻意的：`violations` 是结论，`skipped` 是能力边界，把两者混起来是最容易骗人的做法。

下一步要补的是：

- **AST 层** —— 引入 JavaParser，跑 `check.ast.query`（如「方法参数有 @RequestBody 但缺 @Valid」）
- **LLM 层** —— 仅用于 MUST / SHOULD，**强制要求返回行号定位**，给不出行号的判定视为无效

## 目录

```
src/main/java/com/arsenal/
├── ArsenalApplication.java
├── domain/        Rule / RuleFile / RulesetMeta / Severity / RuleStatus
├── loader/        RuleLoader（加载+校验） / RuleIndex（内存索引+检索）
├── engine/        LintEngine（正则层） / GlobMatcher / 报告模型
├── exporter/      ExporterService（6 种载体）
└── web/           4 个 Controller + 全局异常出口 + 统一响应体
```

## 这个服务自己遵守军火库规则

不是嘴上说说：

- 全部构造器注入 + `private final`，零 `@Autowired` 字段注入（`SVC-LAYR-001`）
- Controller 内零 try-catch，异常统一走 `@RestControllerAdvice`（`WEB-CTRL-004`）
- 所有接口返回 `ApiResponse<T>`（`WEB-CTRL-003`）
- 零 `System.out` / `printStackTrace`，全部 SLF4J 占位符（`REL-LOG-001`、`REL-LOG-002`）
- 依赖只有 3 个 starter，版本全部交给 parent BOM（`SKEL-DEP-002`）
- `jakarta.*` 命名空间，不是 `javax.*`（`SKEL-DEP-001`）

## 关于 MCP

`/api/export/mcp` 会输出一份 MCP Server 配置。设计意图是让 AI 在写代码的当下**主动来查约束**，
而不是靠人事先粘贴提示词 —— 这是「一份数据三种出口」里唯一能形成闭环的一环，
其余两处（人查、拿代码验）都是被动消费。

MCP 工具规划：`search_rules` / `get_rule` / `lint_code` / `get_prompt`。
接口层已经全部就绪，缺的只是一个 MCP 协议适配层。
