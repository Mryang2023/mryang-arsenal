# HY4 夜跑 · 第 5 棒（巡检与补漏）执行记忆

## 2026-09-22 07:15–07:52 · 已执行

- 前四棒全部交棒（`04-done.json` 05:31 已存在），**无需等待**，直接开工。
- 产出：`.workbuddy/night-chain/REVIEW.md`（14KB），已 present_files 交付。

### 结果摘要（完整内容见 REVIEW.md，此处不复制正文）
- `npm run build` 过（86/86 静态页）；`npm run verify` 八层 **620/0 全绿，退出码 0，61 秒，无跳过层**。
- verify 数字四处同步 620，无需修改。
- 声称新建的文件逐个核对，全部存在。
- 反着验只做成 2 组：闸门 ⑧（扫描映射表 dim，实测 exit 1）、断言【13】（摘 NAV `/cases` → 405/1 红）。均已还原。
- 四棒自述的「未做完」抽查 6 条，**条条属实，零虚报**。
- 补漏：清理 3 个 running 文件 + 4 个调试备份 + 2 个 verify 日志；memory 日志已追加。
- **未改动任何产品代码**。

### 可复用经验（下次夜跑直接抄）
1. 第 5 棒起手先 `ls night-chain/`，有 `04-done.json` 就不用等。
2. `npm run verify` 全量约 60 秒，够跑两遍（先取数、后复验），不要只跑一次就信。
   落盘要用 `> file` 再 grep —— 用 `| tail -N` 会把前面几层的数字截掉，白跑。
3. 反着验最省时的组合：**改数据 JSON 验闸门**（`sync:content` 2 秒出结果）+ **摘一行 NAV 验断言【13】**（`verify:project` 约 40 秒）。
   这两组性价比最高，其他断言太贵。
4. 改仓库文件做反例前**必须 `cp` 备份**，改完 `diff` 验证再复跑 —— 沙箱可能重跑命令导致二次修改。
5. bash 取退出码用 `cmd; echo $?`，**不要用 `${PIPESTATUS[0]}`**（会拿到错值，害我误判闸门失效）。

### 给下一晚的 P0（详见 REVIEW.md §六）
1. facts → 图三张链路全为零，阻塞点是 `CanvasTheme` 只有 dark/light（第 2 棒欠的 doc/slide/blueprint）。
2. 装配台 UI 零改动，`topology.ts` 引擎无人消费。
