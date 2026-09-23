# 夜跑 09-23 · 第 1 棒（案例库 B0）执行记忆

## 2026-09-23 23:20 → 23:55 · 状态：完成（提前交棒）

**做了什么**：修 `/cases` 白屏 Bug（`CaseDef.benchmark` 类型撒谎 → `CaseLab` 无守卫直读），
`benchmark` 改可选 + UI 空态守卫；新增【16】字段契约一致性断言 224 条（进 `project-check.ts`，结构与导出 413→637，九层 690→914）。
**没做**：B0-3 补 4 个场景的 benchmark 数据（卡 Q1，方案既定砍掉）。

**关键结果**（供下次核对，不重复正文）：
- 提交 `e3d6afe`，恰好 6 个文件；`git log --stat -1` 验过没夹带白天的 36 个未提交文件
  （但 README / arsenal.json / project-check.ts 三处的**白天已暂存 hunk** 因按文件提交无法拆分，一并进去了，已在 message 写明）。
- 全量 verify：**914 实测 / 0 跳过 / 0 失败 / 退出码 0**；后端 3011 起了所以 parity 12/12、archify 31 项也过了。
- 反着验 4 处（删字段 / 改回必选 / 删默认场景的 benchmark 后重建 / 行尾注释）全部真红并已还原。

**下次这个任务再跑时要注意**：
1. 九层已不是 690，是 **914**；结构与导出 637。方案/prompt 里写的 690 已过期。
2. 派生数字「四处」实际是**三处**（`project-check.ts` 的手写总数常数已被 09-22 第 4 棒删除）。
3. `node scripts/next-run.mjs build` **不跑 sync**（prebuild 只在 npm run 时触发）—— 改事实源后必须显式 sync 再 build，否则反着验会假通过。
4. 无头浏览器要访问静态站时，在脚本里用 node `createServer` 自起，别指望外部 python 站（msedge 会 ERR_CONNECTION_REFUSED）。
5. 提交时 `git commit -F msg.txt -- <具体路径>`，绝不用 `-A`；白天会话的暂存文件常年有 30+ 个。

**给终检棒的锚点**：`01-done.json` 的「验证 / 数字同步 / 提交」三段是独立凭证，
可逐条复核（hash、git log --stat、914 分项、README 两处数字）。
