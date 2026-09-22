# 夜跑链 · 第 2 棒 执行记录（automation id ddb6a1f4…）

## 2026-09-23 00:10 · 第 2 棒：B-4 AST 解析失败不再静默（P0-2）+ B-1 MCP 字段名 + 备选池 B-2/B-3

**结果**：完成（实际耗时 20 分钟 / 预算 118）。

**交棒前置**：`01-done.json` 已存在（棒 1 于 23:46 交棒，verify 基线 628/34/0）。开工时建 `02-running.json`，
收工写 `02-done.json`（七组字段齐，JSON 校验通过），并把棒 3（id 5546f84e…）改到 00:13。

**做了什么**
- B-4（后端 `AstEngine` / `LintEngine` / `LintReport` + 新建 `AstLayer` / `ParseFailure`）：
  parse 改为读 Diagnostic.Kind.ERROR 并返回三态 `ParseResult`；新增第三类 `unparsed`（每条失败文件一条）
  与 `ast` 层执行账本；`executableRules` 只算真跑过的；不可判定时 `score=null` + `grade="不可判定"`。
- B-1/B-2/B-3（`arsenal-server/scripts/mcp-stdio.mjs`）：五处字段名纠偏 + 复合层标签；
  评分基数改用 `SEVERITY_PENALTY`；补 `expect=present` 分支。
- 顺修一个现行 P0：`cEmptyCatch` 里 `PrintFinder.scan` 拆箱 NPE → 任何含 catch 的 Java 文件请求 500。

**证据强度**：5 组反向验证（每组注入 / 变红 / 还原 / 复绿四段），含坏 `.java` 从「假 100 分」变回
「不可判定」的直接对比；B-2/B-3 与前端 `engine.ts` 用同一份 4 个输入逐例对拍（改前 3 例不一致、改后全一致）。
总耗时 20 分钟，共 6 次后端重启（每次约 35 秒）。

**验证**：`npm run verify` 631 实测 / 31 跳过 / 0 失败（退出码 2）；parity 因后端在跑是 12/0/0 真跑；
`compile-check.sh` OK（51 源文件）。无派生数字变更（仍 662）。两次提交 `8cf4d7f` + `7ef6075`。

**遗留（写进 02-done.json，交终检棒）**
1. 文档口径错两处（未改，不归本棒）：可执行规则实为 **42/69 = 35 正则 + 7 AST**，不是 50/69；
   AstEngine 的 15 个检查器里有 8 个在 API 路径上永不执行。
2. `appliesTo.pathGlob` 对 AST 层完全无效（会出假阳性）—— 刻意不修，与「命中数不许变少」冲突。
3. 前端 `engine.ts` 与后端对「不可判定」的表达仍不一致（前端没有解析动作）。
4. README.md:246/263 把「628/34」当默认写死，只在没起后端时成立；起了后端是 631/31。

**给下一棒的环境状态**：后端已停（避免 Windows 文件锁挡住编译），3011 端口已释放；
`.workbuddy/_b4/` 与 `arsenal-web/.workbuddy/_b4/` 调试产物已用 python shutil.rmtree 删除；
工作区只剩别人的未提交改动（本棒未夹带）。
