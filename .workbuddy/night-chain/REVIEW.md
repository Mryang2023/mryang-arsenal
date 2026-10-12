# 夜跑终检 · 2026-10-11（实跑于 2026-10-12 上午）

| 项 | 值 |
|---|---|
| 模型 | **hy4-preview**（会话声明；运行时未暴露更细的型号） |
| 实际起止 | **2026-10-12 10:40 → 11:05**（规程窗口 07:00–07:55，**本次触发晚了约 2h45m**；开跑时 `03-done.json` 已于 10:36 写好，无需等待） |
| 工作目录 | `D:\mryang\workspace\2026\arsenal` |
| 状态目录 | `.workbuddy\night-chain\` |

> 先说结论：**三棒的自述大体属实，但「视觉层跳过」这件事三棒全错 —— 它今晚能跑，而且跑起来就是红的。**
> 全链 **13 层 / 2145 项 / 通过 2143 / 跳过 0 / 失败 2 / 退出码 1**。两项红都在视觉层，
> 一项是解剖台上线的连带（截图台没同步），一项是被三棒的「跳过」掩盖至今的既有真红。

---

## 〇、先给结论

| 棒 | 自述 | 独立验证 | 判定 |
|---|---|---|---|
| 1 解剖台骨架 + 架构面板 | 阶段 A/B/C/D 全做，未砍范围 | 文件全在、导航在位、数据层/页面真存在 | **属实** |
| 2 体检报告 | 阶段 A/B/C 全做，新增第 13 层 79 项 | 79 = 实测 79；六处派生数字全同步；四处登记齐 | **属实** |
| 3 快照 + 历史 + L1 | A/B/C/D 最小版全做，L2 刻意未做 | 文件全在、L1 真短路、gitignore 真生效 | **属实**（L2 页面明写，不算欠账） |
| **全链** | 棒 3 称「失败 4 项全部 EBUSY，与本棒无关」 | 本次 archify 31/31 全绿、scan 93/93 零跳过 → 那 4 项是**当时**波动不是恒定；但视觉层 2 红是真的 | **自述有误导** |

---

## 一、独立验证：实测数字

### 1.1 全量验证（我自己跑的，10:44 → 10:52，486.5s）

```
命令：cd arsenal-web && node scripts/verify-all.mjs   （后端 3011 已预先 SKIP_COMPILE=1 起活）

层                通过    跳过    失败    退出码  耗时      声明
──────────────────────────────────────────────────────────────
类型闸门（tsc ×2）  —       —       —       0       14.2s     闸门层，不计项数
架构判定            35      0       0       0       1.8s      35
图与交互            68      0       0       0       1.9s      68
场景案例            48      0       0       0       3.4s      48
结构与导出          1506    0       0       0       3.2s      1506
引擎样本            17      0       0       0       1.7s      17
前后端一致性        16      0       0       0       28.4s     16
Archify 链路        31      0       0       0       32.1s     31
代码扫描            93      0       0       0       240.1s    93
脚手架生成链路      21      0       0       0       8.3s      21
项目章程            197     0       0       0       3.6s      197
体检报告            79      0       0       0       7.6s      79
部署形态动画        21      0       0       0       2.4s      21
视觉断言            11      0       2       1       130.1s    13
──────────────────────────────────────────────────────────────
合计                2143    0       2                         2145
```

- **实测 2145 项 / 通过 2143 / 跳过 0 / 失败 2 / 退出码 1**。
- 刻意未跑 2 项（既有，不进项数）：代码扫描 5-4（造 500MB 用例）、8-6（真等 180s 超时）。
- 类型闸门：根配置 521 文件 0 错、`.verify` 10 个断言脚本 0 错。
- **跳过是 0** —— 与棒 3 自述的「跳过 95」完全不同，见差异④。

### 1.2 声称新建的文件，逐个确认存在

| 声称 | 实测 |
|---|---|
| `src/app/autopsy/` 六文件 | ✅ page.tsx / AutopsyLab.tsx(30KB) / ArchPanel.tsx / UnmatchedPanel.tsx / CheckupPanel.tsx(13.6KB) / HistoryPanel.tsx(15.8KB) |
| `src/lib/autopsy-*.ts` | ✅ autopsy-data.ts / autopsy-snapshot.ts |
| `scripts/lib/autopsy-*.mjs` | ✅ autopsy-store.mjs / autopsy-snapshot-shape.mjs / autopsy-fingerprint.mjs |
| `arsenal-checkups/` | ✅ checkups.json（4378 B） |
| Java 四个 | ✅ `web/AutopsyController.java` + `autopsy/AutopsyService.java` / `CheckupLoader.java` / `CheckupEvaluator.java` |

### 1.3 派生数字六处（漏一处就永远假绿）

| 处 | 实测 |
|---|---|
| `package.json` scripts | ✅ 13 个 `verify:*`，含 `verify:checkup` |
| `verify-all.mjs` LAYERS | ✅ 13 项，`checkup` 是**独立 key**（注释写明共用 key 会被 `finish()` 静默吞掉） |
| `report.ts` LAYER_NAMES | ✅ 13 项含 `checkup: '体检报告'` |
| `meta-check.ts` CHAIN_ORDER | ✅ 13 项含 `checkup` |
| `arsenal.json#project.verifyChain` | ✅ **13 条**，合计 **2145**；`project.dirs` 10 项含 `arsenal-checkups/` |
| README 两处 | ✅ 分项表 13 行逐行对上（含 `verify:checkup = 79`）；正文「十三层、共 2145 项」 |

`verify:meta` 亲自复核：13 层逐层「声明 == 实测」全绿，README 总数句 2145 == 档案 2145。

### 1.4 新事实源四处登记（`arsenal-checkups/`）

| 处 | 实测 |
|---|---|
| `sync-content.mjs` 构建期硬失败 | ✅ L1028–1078，读 `arsenal-checkups/checkups.json` → `validate-checkups.mjs` → `src/generated/checkups.json` |
| resolver（Java 侧） | ✅ `AutopsyService.java:85` `@Value("${arsenal.checkups.file:../arsenal-checkups/checkups.json}")` |
| 断言层守着 | ✅ `checkup-check.ts` L139–143：README 目录树 / `project.dirs` / sync 接上 / 同步产物 |
| README 目录树 | ✅ 第 127 行 |

⚠️ 与章程层同一形态：**`verify:project` 自己没有这条登记断言**（它验的是导出包 README），
是 `checkup-check.ts` 在守。这是既有设计不是漏 —— 但下次再加事实源，仍要手动 grep 一遍。

### 1.5 页面与导航

- `Shell.tsx:62` —— `{ href: '/autopsy', label: '项目解剖台', glyph: '▧', count: 0 }` ✅
- 三个页签：`AutopsyLab.tsx:359–361` = 架构面板 / 体检报告 / 历史（N）✅
- 构建产物 `out/autopsy/index.html` 24.5 KB ✅；路由表含 `/autopsy`（14.8 kB / 229 kB）

### 1.6 git

```
0e00643 fix(visual): 截图台期望值补 /autopsy（终检棒）
adb0808 chore(night-run): 归档棒 2 状态文件
5bf2206 feat(autopsy): 快照层 16 条断言 + 派生数字同步（75→93 / 2127→2145）
2f6a85e feat(autopsy): 历史页签 + L1 复用 + 对照差集（L2 增量未实现，页面明写）
d96d4c9 feat(autopsy): 快照读写层
63e6ddc docs(memory): 夜跑棒 2 体检报告
5ad8602 feat(autopsy): 体检报告页签 + 第 13 层 verify:checkup（六处六件套）
9aae1c1 feat(autopsy): POST /api/autopsy/inspect
1daaea6 feat(autopsy): 观察项事实源（第 9 个）
93f4736 feat(autopsy): 项目解剖台骨架 + 架构面板
```

**三棒都形成了提交**（棒 2 三次、棒 3 三次、棒 1 一次），`git status --porcelain` 干净，
`--untracked-files=all` 里没有 `_*` 调试产物。

### 1.7 memory

`.workbuddy/memory/2026-10-11.md`（16 KB，10-12 10:29）—— 棒 1（L108）/ 棒 2（L142）/ 棒 3（L169）三段记录齐全 ✅

---

## 二、反着验：闸门与断言真的工作（本棒核心动作）

规程点名优先验「从未红过」的三组，**全部自己注入过一遍，全部真红，全部 `cp` 还原**。

### ① 体检报告的覆盖率分母

| 步骤 | 结果 |
|---|---|
| 注入 | `CheckupPanel.tsx:75` 的 `覆盖 {cov.executed}/{cov.total} 条规则` → 改成写死的 `/69` |
| 跑 `verify:checkup` | **✗ 页面显示「覆盖 X/Y」带分母 / ✗ 页面不许写死 69** —— 77 项 / 失败 **2** / 退出码 **1** |
| 还原 | `cp` 回备份；`git status --porcelain` 空；`grep 'cov.executed}/{cov.total}'` 命中 |

覆盖率条在 `cov.total === 0` 时**仍然渲染**（`CheckupPanel.tsx:90` 专门分支写「规则池是 0 …… 一条都没查」），不是条件消失。

### ② 观察项真的数据化

| 步骤 | 结果 |
|---|---|
| 注入 | `arsenal-checkups/checkups.json` 的 `rules` 改成 `[]` |
| 跑 `verify:checkup` | **✗ rules 非空 / ✗ count == rules.length / ✗ 干净的 checkups.json 通过校验** —— 失败 **3** / 退出码 **1** |
| 关键点 | **校验器没有「规则空 → 全过」报绿** —— 这正是规程担心的高发点，实测没发生 |
| 还原 | `cp` 回备份；`git status --porcelain` 空 |

### ③ 快照的三个持久化点

| 点 | 验法 | 结果 |
|---|---|---|
| `.gitignore` 真生效 | `git check-ignore -v arsenal-web/.data/autopsy/xyz.json` | **退出码 0，命中 `.gitignore:37:**/.data/autopsy/`**（不是只验文件里有这行字） |
| L1 真短路 | 源码：`AutopsyLab.tsx:186` 复用分支在 `autopsyInspect(src)` **之前** `return`；注入 `reusableSnapshot` 改成 `return list[0]` | 跑 `verify:scan` → **✗ 10-10 L1 复用按指纹命中**（92 通过 / 1 失败）→ `cp` 还原 → 干净 |
| 坏快照不白屏 | 源码：`autopsy-snapshot.ts:287–306` 坏份进 `damaged[]` 不抛异常 | **本棒未再独立注入一次**（预算），沿用棒 3 的 10-8 反着验 |

---

## 三、差异清单（逐条点名 —— 自述 vs 实测）

**差异 ①（最重）：三棒都把视觉层记成「跳过 / EBUSY」，实测它能跑，而且跑起来是红的。**

- 棒 1：「视觉层本棒整体跳过，out/ 旧产物未重建」。
- 棒 3：「失败 4 项全部同源 spawnSync EBUSY —— Archify 3 项 + 视觉 1 项 + 元核对 2 项连带，无一与本棒改动相关」。
- **实测**：`verify:visual` 完整跑了 130.1s、102 张矩阵、浏览器起得来（msedge）。`verify:archify` 31/31 全绿、`verify:scan` 93/93 零跳过。
  → 棒 3 那 4 项**不是「环境恒定不可跑」，是当时那一次的环境波动**。写成「与本棒无关」没错，
  但**把视觉层归档为「跳过」，使两个真红被掩盖了整整一夜**。

**差异 ②：视觉红 ① —— 矩阵 102 张 vs 截图台 99 张（`/autopsy` 上线没同步截图台）。**

- 这是棒 1 自己记下的 P2：「`/autopsy` 未进 `visual/shoot.mjs` 截图矩阵」—— **三棒都没有补**。
- 我补了 `shoot.mjs` 的期望值（固定页 25→26、URL 33→34、张数 99→102），提交 `0e00643`。
- **但没能闭环**：重跑 `shoot.mjs` 需要一个活着的静态站 `:3021`，本环境全部 `ERR_CONNECTION_REFUSED`。
  试跑一次的结果是把 manifest 写成了 102 条但**每张都是空白** —— manifest 与 `report.md` 我都还原了。
  → **红还在**（manifest 仍是 99），如实记录，没有假装修好。

**差异 ③：视觉红 ② —— A8 粘性列不可达，61/102 张。**

```
A8 粘性列不超出视口（菜单能滚到底）：通过 0 / 失败 61 / 未适用 41
  home__desktop     · div.md:sticky.md:top-0 底部超出视口 3387px，
                      overflow-y=visible、scrollHeight 900 / clientHeight 900 → 溢出不可达
  home__tablet / arch__tablet / archify__tablet / blueprints__desktop / blueprints__tablet … 另有 55 张
```

- 归属：`Shell.tsx:111` `<div className="md:sticky md:top-0 md:h-screen md:flex-col">`（A8 是 2026-10-05 加的断言）。
- 命中的是 **home / arch / archify / blueprints 等既有页**，不是解剖台引入的。
- 但它**一直红着没人知道**，就是因为视觉层从没真正跑过。**未修** —— 要动侧栏布局 + 重拍 102 张矩阵，超 30 分钟，按规程不开必然做不完的头。

**差异 ④：棒 3 自述「代码扫描 16 通过 / 95 跳过」→ 我这次 93 通过 / 0 跳过。**

同样是环境波动（`spawnSync` 那批探针这次跑通了），**不是回归，也不是棒 3 造假** —— 但说明「跳过 95」这种结论下一次跑就可能完全不同。

**差异 ⑤（核销，不是差异）**：棒 2 的「12 条 → 13 条」「79 项」、棒 1 的「2048 项」→ 现 2145，链条累加自洽 ✅。

---

## 四、安全专项（本仓此前没有「用户给路径让服务器读」这个形态）

起后端实跑探针：

| 用例 | 结果 |
|---|---|
| `kind` 不认识（ftp） | **400** `source.kind 只支持 path / git，收到的是「ftp」` ✅ |
| `value` 空 | **400** `source.value 是空的` ✅ |
| 缺 `source` | **400** `请求体缺少 source：{...}` ✅ |
| 路径含 `..`（指向 command-center） | 200，`root` = 目录名 `command-center` —— 本机工具按设计接受用户自己的路径，不算逃逸 |
| **0 文件的目录**（`C:/Windows/System32/drivers/etc`） | 200，但 `coverage.decidable = false`，`undecidability` 明说「本次没有提交任何 .java 文件…… 本次不给出合规结论」✅ **没有把「什么都没扫到」说成「没问题」** |
| 报告里有没有绝对路径 | 对真跑出来的 JSON 判：`[A-Za-z]:/` **false**、`/home` **false**、`/Users` **false** ✅ |

`SourceResolver.fromPath`（L66）走 `toRealPath()`，事实里只留 `rootName()`（目录名）。
`obs.source` 经 `Path.of(...).getFileName()` 收敛（棒 2 修的 P1），实测端到端也干净。

⚠️ 一个**如实记录、未修**的判断：`..` 与任意本地路径是被接受的。这是本地单人工具的合理形态
（用户指哪读哪），但如果哪天这个服务要放到多人/远程，**这里是必须加白名单根的地方**。

---

## 五、本棒补了什么

| 补的 | 状态 |
|---|---|
| `visual/shoot.mjs` 期望值三处 + 注释（26 固定页 / 34 URL / 102 张） | ✅ 提交 `0e00643` |
| 旧 `REVIEW.md`（2026-09-23）归档为 `REVIEW-2026-09-23.md` | ✅ |
| 清理 `01/02/03-running.json`（一次性状态文件） | ✅ 已删，只留 `0N-done.json` + `REVIEW.md` |
| `LATEST` 更新为 `2026-10-11` | ✅ |
| 本页 `REVIEW.md` | ✅ |
| A8 粘性列 / 截图台重跑 | ❌ **未修**，见差异②③ |

---

## 六、剩余工作量（按「离闭环的距离」排）

### P0 —— 离「能说全绿」最近的三个

1. **截图台重跑 + 矩阵对齐**（差异②）。
   卡点只有一件事：需要一个活着的静态站 `:3021`。步骤：起静态站（serving `out/`，注意 `trailingSlash: true`）
   → `ARSENAL_CHROME="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" node visual/shoot.mjs`
   → 应产出 102 张 → `visual-check`【3】转绿。
   **期望值我已经改好了，这一棒只差一次重跑。**
2. **A8 粘性列不可达，61/102 张**（差异③）。
   起点：`Shell.tsx:111` 的 `md:sticky md:top-0 md:h-screen`。断言说它在文档末尾时底部超出视口 3387px
   且 `overflow-y: visible` → 溢出部分滚不到。**先判是「sticky 被某个祖先的 overflow 打断」还是「量法问题」**，
   再决定改布局还是改断言。**这是全链唯一的真红，不修就不能说「全绿」。**
3. **`/autopsy` 从未被浏览器真的点过**。
   三棒都只验到「构建产物存在 + 源码断言」。dev 站 :3000 调 :3011 被 CORS 拦
   （`arsenal.cors.allowed-origins` 默认空）。解剖台三个页签（架构 / 体检 / 历史）的
   **空态、坏快照提示、L1 复用提示，全都没有一张真截图**。
   → 与 P0-1 合流做：同一个静态站里把 CORS 放开或直接指向同源后端，一次拍完。

### P1 —— 离「功能完整」最近

4. **L2 增量（按文件粒度重算）** —— 刻意未做，页面 `HistoryPanel.tsx:17/282` 原文明写。
   前置：重构 `CodeScanner`（现为 `TreeMap`/`ArrayList` 一把聚合，无法只重算 3 个文件）。
5. **阶段 D 的「技术栈 +/-」段** —— 依赖棒 4 功能分析的能力集合，本夜只给了体检差集 + 覆盖率 + 观察项三段。
6. **快照仍存绝对路径（`source.value`）** —— 棒 3 判 P2 未修：要在「能认出同一个项目」与「不存路径」之间二选一，
   取了前者。快照在 localStorage / `.data`（已 gitignore），不进仓库。
7. **三个空态没有真数据验证**：`coverage.total = 0`、`skipped` 为空列表、快照全坏 —— 目前只有源码断言守着。

### P2 —— 已知、可延后

8. 棒 4 功能分析 / 棒 5 功能剥离 / 棒 6 MCP·CLI —— 今晚明确砍，不算欠账。
9. `scan-check`【4】自己内联了一份 facts→图的组装（抽层前既有），建议改成 `import buildAutopsy`。
10. zip 走原生 file input，不是真拖放。
11. `shoot.mjs` 的 `EXPECTED` 是手写期望值 —— 与「层数不许写死」同类的漂移源，
    建议改成从 `out/` 现数（这样加路由时它自己会红，而不是等人记得改）。

---

## 七、给下一晚的一句话

**别再把「跑不动」和「没跑」写成同一句话。** 今晚三棒都写了「视觉层跳过」，
实际它跑了 130 秒、102 张，一跑就抓出两个真红 —— 一个是本夜新引入的（截图台没同步），
一个是被掩盖了 7 天的（A8）。`knowinglySkipped` 那个机制是对的，
但**先探活再判断**这一步，三棒都省了。
