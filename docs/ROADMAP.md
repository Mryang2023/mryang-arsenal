# ROADMAP · 夜班任务清单（2026-10-30 凌晨班）

> 协议见仓库根 `NIGHT_SHIFT.md`。勾选状态是唯一进度真相：完成一项改 `[x]` 并独立提交。
> 依据：`docs/重建设计与实施计划-2026-10-29.md` 阶段 0（第 1 周）。做不完的保持未勾，早报列明。
> 每项的验收标准同时就是该任务的**测试命令出处**——巡查会话按它执行，全绿才提交。

## A · 后端 Run/Artifact 闭环（核心，按序执行）

- [x] N1 runs 包与 RunStore：新建 `arsenal-server/src/main/java/com/arsenal/runs/`，RunStore 提供 startRun / complete / 原子写（临时文件+rename），Manifest 含快照指纹、规则集版本、引擎版本、起止时间；验收：JUnit `RunStoreTest` ≥5 用例（创建落盘/原子覆盖/读取/坏 id 拒绝/列目录），`cd arsenal-server && ./mvnw -q test` 全绿
- [x] N2 提交体检 run 端点：`POST /api/v2/projects/{id}/runs` 复用静态引擎跑一次体检，落盘 `runs/<runId>/run.json + findings.jsonl + coverage.json`（挂到既有项目注册表与缓存，不动 v1 端点）；验收：curl 对已导入项目创建 run 后三文件存在，findings.jsonl 行数 == coverage 口径；Controller 的 400/404 分支有 JUnit 覆盖，`./mvnw -q test` 全绿
- [x] N3 ReportService 与 report.md：生成健康分、覆盖率披露（执行/跳过分层及原因）、Top 问题表（文件:行 · 规则 · 出处）、下一步建议；验收：JUnit 断言 report.md 含「本次覆盖」「Top」字样、≥3 条带行号的 finding 行与规则出处；对真实 run 生成一份人工可读的样例
- [x] N4 下载端点与产物清单：`GET /api/v2/runs/{runId}/report.md`（Content-Disposition 附件下载）与 `GET /api/v2/runs/{runId}/artifacts`（清单+哈希）；验收：JUnit + 手工 curl 断言 200 / 附件头 / 404 语义正确，`./mvnw -q test` 全绿
- [x] N5 扫描忽略规则（实测：真机 run d6bd41128c9444fa 的 findings 中 .wb-tmp 命中 0、SmokeCcgp 0、scope 435→434；总数 221 持平的原因是每规则回报上限让 6 条 src 真实问题回填——非噪音残留）：默认排除 `.wb-tmp/**`、根目录 `Smoke*.java`、`*.min.js`，支持项目级配置追加（配置项挂 `arsenal.lint` 或 run 请求体）；验收：JUnit 用夹具目录断言这些路径不进 findings；对已导入项目重扫，`.wb-tmp` 命中归零且问题总数下降
- [x] N6 后端测试补齐 ≥15 个（实测 Surefire 28/28 绿）：RunStore / ReportService / RunsController 三处覆盖收口；验收：`./mvnw -q test` 全绿且 Surefire 统计 tests ≥ 15

## B · 前端项目主页（增量，不碰现有导航）

- [x] N7 `/projects/home?id=` 项目主页骨架（动态段无法静态导出，有依据偏离已记录）：：六页签（总览/问题/修复/测试/交付物/设置），总览页签真调 N2/N4 端点渲染 run 历史 + Top 问题 + 「下载报告」按钮；验收：`cd arsenal-web && npm run typecheck` 绿，`node scripts/next-run.mjs build` 成功
- [x] N8 问题页签 findings 列表：按严重度/规则/文件筛选，每条显示证据行号与规则出处链接；页面状态符合「空/载入/离线/未验证」四态规范，不把「没跑」说成「没问题」；验收：typecheck + build 绿，四种状态各有真实文案

## C · 规则溯源与产品 e2e

- [x] N9 verify:rules 溯源报告（实测 15/69 · 93 缺口 · strict=1）：：`arsenal-web/scripts/verify-rules.mjs` 输出 69 条规则的溯源完整率（基线实测 **15/69**：版次+章节+引文齐备）与缺引文清单，退出码 0；`--strict` 时缺失即 1；挂进 package.json 为 `verify:rules`（**不**接入 verify-all，不改链上项数）；验收：`npm run verify:rules` 输出的数字由数据实时计算、不写死常量
- [x] N10 e2e-delivery（实测 17/17 断言过 exit 0）：：`arsenal-web/scripts/e2e-delivery.mjs` 自动 `SKIP_COMPILE=1` 起后端 → 导入 `.verify/fixtures/demo-repo` → 创建 run → 轮询完成 → 断言 report.md 含文件行号与规则出处 → 清理临时项目与进程；验收：`node scripts/e2e-delivery.mjs` 退出码 0，全程 < 5 分钟
- [ ] N11 文档同步：README 进度段补「阶段0 夜班进展」小节 + 本清单勾选状态核对；验收：`npm run verify:meta` 与 `npm run verify:project` 不因文档改动变红（如触发声明值失配，按仓库惯例同步档案与 layer-counts，保持 0 新增失败）

## D · 导航收拢（风险高，放最后；受阻不算失败）

- [ ] N12 导航收成 5 项（工作台/项目/新建项目/规范库/AI 护栏）+ 旧路由重定向页：`/check` `/export` `/archify` `/icons` `/cases` `/blueprints` 各建重定向 page.tsx 指向新去处，主菜单按计划 §3.1 收拢；验收：typecheck + build 绿，`npm run verify:project` / `verify:meta` 导航与页面存在性契约全绿（同步更新 NAV 声明与三本账）；若 `verify:visual` 出现除 B-2 计数红之外的新内容级红且重跑截图台需人批准（B-2 同类），保持本项未勾、早报列明受阻原因，不算夜班失败

---

## 做完之后（不在今晚范围）

阶段 0 剩余与阶段 1（补丁闭环）按 `docs/重建设计与实施计划-2026-10-29.md` §8 推进；需要本人拍板的 6 项决策见该计划 §11。
