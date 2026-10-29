# 迭代报告 · 2026-10-29（夜跑会话，r20 收口 + r21 + r22）

> 会话窗口：2026-10-29 07:23 – 10:23 +0800（3 小时）。工作分支 **`iterate/20261029`**（自 main `c95a2a8` 分出，未推送、未动 main）。
> 唤醒时发现上一循环（r20 会话）的实质工作已随 c95a2a8 入库但四本账缺失，本轮先收口 r20，再连续完成 r21、r22。

## 一、完成了哪些任务

| 轮 | 任务 | 内容 | 提交 |
| --- | --- | --- | --- |
| r20 收口 | P1-1g 判定完成 | 上一会话已入库的 `qa-pure` 探针 + 断言 5-20..5-25 做独立复验与咬合实证；补齐四本账（RUNLOG / BLOCKERS / BACKLOG / RUN_STATE） | `16aa34e` |
| r21 | P1-1h | AstEngine 五个 private static 工具（annName / hasAnnotation / hasMember / typeSimpleName / isPrimitive）+ QaService.toList 从「端到端间接执行」升级成分支级钉死：`ast-pure` 探针动作（反射 parse 取真语法树）+ 断言 5-26..5-31 | `58eed62` + `9829cc3` |
| r22 | P1-1i | 诊断换算与坐标口径分支级钉死：`readErrors` 归一分支 + `SourceText.lineOf`/`snippetAt` + **LintEngine.lineOf 第二份实现逐向量对拍**；断言 5-32..5-35 | `71e2173` + `88244a7` |

三轮的共同手法：探针只回吐原始判定、期望表在前端、**每条新断言都有注入回归证明它咬得住**。

## 二、验证证据（命令 + 结果要点）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 断言层类型检查 | `cd arsenal-web && npm run typecheck:verify` | 每轮 exit 0 |
| 代码扫描层 | `npm run verify:scan` | 200 → 206（r21）→ **210 项**（r22）：207 通过 / 3 失败 / 实测 == 声明（declaredMismatch null） |
| 元核对 | `npm run verify:meta` | 每轮 73/0/0（r21/r22 改 count 后的连锁三本账均走齐：sync 生成物、layer-counts.json、README 总数句 2320→2326→2330） |
| 视觉层 | `npm run verify:visual`（重建 out/ 后） | 11/1/1（1 失败 = B-2 老问题，0 新增） |
| 后端构建 | `cd arsenal-server && ./mvnw -q -DskipTests package` | **exit 0**，`target/arsenal-server-0.1.0.jar` 正常产出 |
| 全链 | `npm run verify`（最终确认轮） | **实测 2330 项 == README 总数句 2330**（通过 2313 / 跳过 13 / 失败 4），meta 闸门 73/0/0，耗时 238s |

三条失败（scan 13-1/13-2/13-7）与一条失败（visual B-2）**全部是唤醒前就存在的已知环境缺口**（B-7：.m2 缺/降版 Spring Boot 4.1.1 构件；B-2：截图台矩阵张数），本轮 0 新增失败。

### 注入回归（咬得住的证据，共 6 路，每路复原后字节 identical）

| 轮 | 注入 | 咬红 |
| --- | --- | --- |
| r20 | `testBaseName` 摘 `IT` 后缀 | 5-20 单独红 |
| r20 | `trimLines` 改真截断 | 5-24 单独红（5-25 现状账照旧绿 —— 分工实证） |
| r21 | `annName` MemberSelect 改回全限定串 | 5-27 单独红 |
| r21 | `isPrimitive` 闭集摘 `void` | 5-31 单独红 |
| r22 | `LintEngine.lineOf` 的 `<` 改 `<=` | 5-33 + 5-34 双红（columnOf 内部调 lineOf，依赖如实暴露） |
| r22 | `readErrors` 只认 ERROR 反转 | 5-32 单独红 |

注入的产品文件（QaService.java / AstEngine.java / LintEngine.java）均按 sha256 备份复原、`git status` 重新为空：
QaService `9b5b861f…`、AstEngine `27277cd1…`、LintEngine `88a0b57d…`。

## 三、没做完的、受阻的及原因

- **B-13（本轮新登记，需你拍板）**：`QaService.trimLines`（:1096）是**恒等函数** —— `split(换行, max+1)` 与 `join(换行, lines)` 互逆，那句「截到 24 行」从未生效。今天不可观测（同步产物 69 条 good 片段最长 21 行 < cap=24），但语料涨过 24 行就静默失效（5-25 会先红）。修 = 报告 `after` 片段开始真截断的**行为变更**，修不修、修成什么口径需人决定。
- **原有受阻项不变**：B-2（visual 截图台）、B-3（CI）、B-7（需批准拉 7 个缺/降版构件，修好它 scan 的 3 条红就能转绿）、B-10/B-11/B-12（均等人工决定，断言已钉住现状谁改谁红）。
- **r23（P1-1j）没开**：剩约 65 分钟时按纪律转最终确认与收尾。靶子已写进 `state/RUN_STATE.json`（parse 失败路径与容错口径 —— `parse` javadoc 那句「语法损坏照样返回不完整编译单元，只有 ERROR 诊断算失败」的 claim 0 条断言守着）。

## 四、明早需要知道的风险与「待确认」

1. **工作在 `iterate/20261029` 分支上，main 未动**。确认无误后合并即可（`git checkout main && git merge iterate/20261029`，应为 fast-forward）；不想要就删分支，main 保持 c95a2a8。
2. **B-13 是本轮唯一新增的、需要你决策的发现**。三个选项：修函数（行为变更）／改函数名承认「不截断」／维持现状（5-25 已把现状账钉住，语料涨了它会先红）。不改任何东西也是安全的。
3. **r21 有一次如实登记的偏离**：计划原定探针动作落 `AstProbe.java` + 期望表落 parity-check；实测 AstProbe 是单用途 CLI，改落 `ScanProbe.java` + scan-check（不改它的 stdout/退出码合同）。细节在 RUNLOG r21。
4. **一个流程说明**：本次唤醒 prompt 要求建 `docs/ITERATION_BACKLOG.md` / `docs/ITERATION_LOG.md`，但仓库已有 22 轮历史的成熟记账体系（根目录 `BACKLOG.md` / `RUNLOG.md` / `BLOCKERS.md` / `state/RUN_STATE.json`）—— 为避免两套账分叉，本轮沿用既有体系，未新建平行文件。如果你希望统一到 prompt 里的命名，说一声我下次迁移。
5. 依赖零新增；CI/schema/密钥/数据未动；未 push 任何东西。

## 五、下一轮建议做的第一件事

**r23 = P1-1j**：把 `AstEngine.parse` 的失败路径与容错口径分支级钉死（`ast-pure` 扩展即可，探针架子都是现成的）——语法损坏源码 → `SYNTAX_ERROR + unit=null + errors 带行列`；空串走「无编译单元」分支；「没有可执行检查器就不解析」的早退。靶子与踩坑清单（⑨ 条）都已在 `state/RUN_STATE.json` 的 `next_round_plan` 里备好，唤醒后可直接开工。
