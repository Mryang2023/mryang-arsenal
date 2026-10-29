# NIGHT_SHIFT · 通宵无人值守接管协议

> 生效夜：2026-10-29 深夜 → 2026-10-30 早晨
> 分支：`nightshift/20261030`（自 main 创建）
> 总控巡查：定时任务「夜间总控巡查」，2026-10-30 00:00 起每 20 分钟触发（00:00–07:40，共 24 次）
> 本文件是接管会话的**唯一协议出处**；任务清单与勾选状态在 `docs/ROADMAP.md`。

---

## 一、任务总目标

把军火库从「报告只能看」推进到「体检即产物」：今晚完成重建设计计划（`docs/重建设计与实施计划-2026-10-29.md`）**阶段 0 的后端闭环**——

1. Run/Artifact 落盘（run.json + findings.jsonl + coverage.json）；
2. report.md 报告生成与 HTTP 下载；
3. 扫描忽略规则（`.wb-tmp`、根目录临时脚本不再进 findings）；
4. 后端 JUnit 测试从 0 补到 ≥ 15 个；
5. `verify:rules` 规则溯源报告（基线如实报 15/69，不撒谎绿）；
6. `node scripts/e2e-delivery.mjs` 一条命令跑通「起后端 → 导入 fixture → run → 断言报告」。

全部改动落在 `nightshift/20261030` 分支，每任务独立提交；收尾写早报 + 打 tag。**不动 main。**

## 二、接管步骤（每次巡查唤醒后照此执行）

1. 运行 `date`。若已过 **08:05**（冻结时间），夜班结束，不做任何事直接退出。
2. 锁检查：仓库根 `.run-lock` 存在且距现在不足 **45 分钟** → 有其他会话在工作，安静退出、不要动它的锁。另外 `arsenal-server/src`、`arsenal-web/src`、`docs/ROADMAP.md` 任一 mtime 距现在不足 **3 分钟** → 视为活跃工作，退出。
3. 否则接管：写 `.run-lock`（当前时间戳）。当前分支不是 `nightshift/20261030` → 已存在就 `git checkout nightshift/20261030`，不存在就 `git checkout -b nightshift/20261030`。然后读本文档、`docs/ROADMAP.md`（勾选状态）、`git log --oneline -10` 确认进度。
4. 执行 ROADMAP 中**第一个未勾选任务**：小步实现 → 跑该任务验收标准里的测试命令，必须全绿（全局门见第五节）→ `git add -A && git commit -m "night-<任务号>: <一句话>"` → 尝试 `git push`（两个 remote：github / gitee；失败不阻塞，记录即可）→ 把 ROADMAP 对应项改为 `[x]` 并提交 → 刷新 `.run-lock`。一个巡查周期尽量多做几项，**但每项必须独立提交**。
5. **收尾窗口 06:30–08:05**：不开新任务，只收尾进行到一半的任务并提交；**07:30 起**只验证不改动；全部完成（或到 07:30）且仓库根尚无 `REPORT-2026-10-30-早报.md` 时写早报并打 tag 推送（见第六节）。
6. 上下文将耗尽时：**先落盘**（提交 + 更新 ROADMAP 勾选 + 刷新 .run-lock）再继续。

### 脏树接管（前一会话死在中途）

`git status` 脏且 `.run-lock` 已过期（>45 分钟）：先跑现场对应任务的验收命令——通过 → 提交并注明「接管收尾」；不通过 → `git stash`（保留现场不销毁），把现场写进早报「遗留问题」。

## 三、运行锁规则

- 锁文件：仓库根 `.run-lock`（内容 = ISO 时间戳）。**已进 .gitignore，不许提交。**
- 45 分钟内的锁 = 别人持有，绝不覆盖、绝不删除。
- 自己接管后每次完成任务都要刷新锁；收尾写完早报后可删除锁。

## 四、时间窗

| 时间（2026-10-30） | 状态 |
|---|---|
| 00:00 – 06:29 | 正常实现，按 ROADMAP 顺序做 |
| 06:30 – 07:29 | 收尾窗口：不开新任务，只完成进行中的任务 |
| 07:30 – 08:05 | 冻结：只验证、写早报、打 tag，不改代码 |
| 08:05 之后 | 一律直接退出，不做任何事 |

## 五、铁律（每一条都是硬约束）

1. **测试全绿才提交。** 全局门：`cd arsenal-server && ./mvnw -q test` 与 `cd arsenal-web && npm run typecheck` 必须通过；涉及 `arsenal-web/src` 的改动提交前先 `node scripts/next-run.mjs build` 成功。
2. **全链门槛 = 0 新增失败。** `npm run verify`（收尾跑一次，约 4 分钟）基线有 4 条已知环境失败（scan 13-1/13-2/13-7 = B-7，visual = B-2），允许继续红；出现任何**新**红必须修复或回退引发它的任务，不许放宽断言、不许把没跑说成跑过。
3. **不动的清单**：`arsenal-rules/` 语料内容与 `mcp-tools.json`（B-8 等需本人拍板）；不批量重写截图（B-2）；不联网拉 maven 构件（B-7）；不新增 npm/maven 依赖；不动 `.data/` 里的历史 QA 报告；不动用户 `.gitignore` 里既有条目。
4. **不破坏现有功能**：旧路由全部保持可达（新增允许，删除/改名不允许——导航收拢是后面的任务，今晚只做增量）。
5. **危险命令克制**：不 `push --force`、不 `reset --hard` 他人提交、不删除 tag、不 amend 已推送提交。
6. **诚实口径**：`verify:rules` 的溯源基线是 15/69（2026-10-29 实测），报告里如实写这个数字，不写死成 100%。
7. 提交信息一律 `night-<任务号>: <一句话>`；ROADMAP 勾选单独一个提交（`night-<任务号>: 勾选 ROADMAP`）。

## 六、收尾流程

1. 06:30 起只收尾；07:30 起只验证。
2. 收尾跑一次 `npm run verify`（确认 0 新增失败）与 `./mvnw -q test`。
3. 早报 `REPORT-2026-10-30-早报.md`（仓库根）必含：
   - 今晚提交清单（hash + 一句话）；
   - 完成的功能（对应 ROADMAP 勾选项）与对应验收证据（命令 + 结果要点）；
   - 测试结果（后端 Surefire 统计 / typecheck / verify 项数与新增失败数）；
   - 遗留问题（未勾选任务 + 脏树/受阻原因）；
   - 下一步怎么做（含合并回 main 的命令：`git checkout main && git merge nightshift/20261030`）。
4. `git tag nightshift-20261030 && git push github nightshift-20261030 --tags`（失败记录即可）。
5. 提交早报，删除 `.run-lock`。

## 七、环境备忘（本机实测过的事实）

- 后端**不需要 maven 就能起**：`SKIP_COMPILE=1 bash arsenal-server/scripts/run.sh`（约 3.6s，端口 3011）；前端 3010。
- 后端测试：`cd arsenal-server && ./mvnw -q test`（本机 .m2 已够跑测试；缺 Spring Boot 4.1.1 部分构件只影响 scan 层 fixture，与后端单测无关）。
- 前端：`cd arsenal-web && npm run typecheck`；改 src 后构建：`node scripts/next-run.mjs build`。
- 已导入的真实项目：`e45db8ec4039`（command-center-backend），QA/体检接口可作验收素材；`.verify/fixtures/demo-repo` 是干净夹具。
- JDK 21 / Node 24。`.tmp/` 已被清理过，不留垃圾；临时产物一律放 `.verify/tmp/`（已 ignore）或系统临时目录。
- 仓库四本账（RUNLOG / BACKLOG / BLOCKERS / state/RUN_STATE.json）属于另一套迭代体系，**今晚不写它们**，进度只记 ROADMAP + 早报，避免两套账分叉。
