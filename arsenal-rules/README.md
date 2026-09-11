# arsenal-rules

杨先生的军火库的**规则源文件**。这是整个项目真正的资产——前后端代码可以重写，这里的东西三年后还值钱。

## 这是什么

- **source of truth**：规则以结构化 JSON 存储，Git 版本化。数据库只是索引缓存，可随时重建。
- **一份数据，三种出口**：这里的每一条规则，同时供给「人查界面 / 一键导出的 AI 提示词 / 代码合规校验引擎」。
- **不是文档**。写不出 bad/good 示例、给不出可执行检查方式的条目，一律不收录。

## 目录结构

```
arsenal-rules/
├── README.md                      本文件
├── meta.json                      规则集元信息、来源登记、严重度策略、变更日志
├── _schema/
│   └── rule.schema.json           Rule 对象的 JSON Schema（字段定义的唯一真相）
├── skeleton/project-structure.json   工程骨架：包结构、依赖、配置
├── web/controller.json               Web 层：Controller、DTO 契约、校验、异常出口
├── service/layering.json             业务层：DI、事务、异常设计、分层
├── data/sql.json                     数据层：SQL 安全、表结构、并发更新
├── concurrency/thread-pool.json      并发：线程池、线程安全对象、锁
├── reliability/exception-logging.json 可靠性：异常处理、日志、超时、重试
├── security/baseline.json            安全：越权、脱敏、注入、反序列化、XSS
├── test/unit.json                    测试：AIR 原则、断言、隔离
└── collab/git-commit.json            协作：提交规范、Javadoc、常量命名
```

## 一条规则长什么样

```jsonc
{
  "id": "WEB-CTRL-002",                  // 稳定 ID，永不复用
  "category": "web",
  "subcategory": "validation",
  "title": "@RequestBody 入参必须加 @Valid，且 DTO 字段必须带约束注解",
  "severity": "MUST",                    // MUST | SHOULD | MAY | NEVER
  "sources": [                           // 至少一个出处，无出处不收录
    { "ref": "阿里巴巴Java开发手册(嵩山版) 安全规约 §4【强制】", "type": "industry-standard" }
  ],
  "rationale": "缺 @Valid 时，DTO 上写的所有约束注解会静默失效……",
  "appliesTo": { "stack": ["spring-boot-3"], "scope": "server" },
  "bad":  "public ApiResponse<Void> create(@RequestBody CreateUserRequest req) { ... }",
  "good": "public ApiResponse<Void> create(@Valid @RequestBody CreateUserRequest req) { ... }",
  "check": {                             // 可执行检查方式，至少一种
    "ast": { "engine": "javaparser", "query": "methodParam has @RequestBody && !has @Valid" },
    "llm": "该方法是否存在 @RequestBody 参数且未加 @Valid？只回答 是/否/不适用，必须给出行号。"
  },
  "promptFragment": "所有 @RequestBody 入参必须加 @Valid。入参 DTO 的每个字段必须带对应的约束注解（@NotBlank/@NotNull/@Size 等），并提供中文 message。",
  "tags": ["api", "validation", "p0"],
  "status": "active",
  "version": 1,
  "updatedAt": "2026-09-11"
}
```

字段的完整定义与校验规则见 `_schema/rule.schema.json`。

## 怎么加一条规则

1. 找到 `meta.json` 里 `sourceRegistry` 中匹配的来源 key。
2. 在对应分类的 JSON 文件里，往 `rules` 数组追加一个对象，填齐 schema 的 **12 个必填字段**。
3. 自问四道闸门（全部通过才算合格）：
   - 能判定吗？（有明确的通过/违规判据）
   - 有示例吗？（写得出具体的 bad / good）
   - 能检查吗？（能落到 regex / AST / LLM 之一）
   - 相关吗？（影响本项目实际代码）
4. **检查预算**：`MUST + NEVER` 级总数硬上限 **50 条**。当前已满。新增强制级前，必须先降级或删除一条旧的。
5. 跑一遍校验（后端未搭建前可用临时脚本）：

```bash
python -c "
import json,glob
for f in glob.glob('arsenal-rules/**/*.json', recursive=True):
    json.load(open(f, encoding='utf-8'))
print('all json valid')
"
```

## 三条铁律

1. **规则是数据，不是文档。** 任何只存在于 Markdown 里的「规范」都是死文档。
2. **无出处不收录。** 每条规则必须能追到行业基准或明确的项目决策——凭感觉写的规则三个月后你会想删掉它。
3. **写不出反例的规则不配进来。** bad 字段是照妖镜：写不出来，说明你还没想清楚这条规则要阻止什么。

## 当前状态

| 项 | 值 |
|---|---|
| 版本 | 0.1.0（2026-09-11） |
| 规则总数 | 62 |
| 强制级（MUST + NEVER） | 50 / 50（**已满**） |
| 建议级（SHOULD） | 12 |
| 数据来源 | 全部来自行业基准提炼，**未使用既有项目代码反推** |
| 待办 | 需 mryang 逐条过目后定稿为「个人规范」 |
