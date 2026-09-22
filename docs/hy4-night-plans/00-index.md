# HY4 夜间任务 · 四份升级方案总览

> 生成时间：2026-09-21
> 用途：夜间免费时段（23:00 后）由 HY4 执行的四条独立任务线。
> 每份方案都是**自包含**的：执行者从零开始读它就能干活，不依赖本对话上下文。

> ⚠️ **如果本次是「一夜跑完四条线」的压缩跑法**（2026-09-21 夜），
> 请先读 **`NIGHT-RUN.md`** —— 那是本次的接力总规程（棒次时刻表、交棒协议、状态目录、时间预算）。
> 本文件 §一 表格里的「建议时段：第 N 晚」在压缩跑法下**不适用**，以 `NIGHT-RUN.md` 为准。

---

## 一、四份方案一览

| # | 文件 | 主题 | 建议时段 | 依赖 | 主要产物 |
|---|---|---|---|---|---|
| 1 | `plan-1-icon-library.md` | 图标资产库：生图 + 矢量补齐 + 可检索图库页 + 接入架构图 | 第 1 晚 | 无 | `public/icons/**`、`arsenal-icons/icons.json`、`/icons` 页面 |
| 2 | `plan-2-scenario-cookbook.md` | 场景案例库：按目的 + 参数合成生产级代码案例 | 第 2 晚 | 无（与 3 可并行） | `arsenal-cases/*.json`、`/cases` 页面、`case-synth.ts` |
| 3 | `plan-3-stack-composer.md` | 装配台升级：全栈维度 + 集群形态 + 动态交付 | 第 3 晚 | 建议在 1 之后（图标） | 维度 18→32、`/stack` 动态交付台、交付级架构图 |
| 4 | `plan-4-code-to-diagram.md` | 代码入库：给仓库出架构图 + 出图服务 | 第 4 晚 | 建议在 1、3 之后（图样式与图标） | `com.arsenal.scan`、扫码接口、`/archify` 第三输入源 |

**执行顺序建议**：1 → 3 → 2 → 4。
理由：方案 1 是全链路的素材底座；方案 3 的图形交互直接消费方案 1 的图标；方案 2 与 3 无耦合可互换；方案 4 最重，且它的出图样式要复用方案 3 定下来的「交付级架构图」版式。

如果你只想先见效，**方案 1 和方案 2 的可见收益最快**（前者做完立刻在装配台和架构图上看得到，后者做完直接回答「亿级数据怎么建表」这类真问题）。

---

## 二、所有方案共享的开局动作

每个夜间任务开工前，执行者**必须**按顺序读：

1. `README.md`（仓库根）—— 三条设计原则、目录结构、数据流、verify 分层
2. `.workbuddy/memory/MEMORY.md`（**仓库根**，不是 arsenal-web 下）—— 项目长期约定
3. `.workbuddy/memory/YYYY-MM-DD.md`（**仓库根**，最近三天的日志）—— 最近踩的坑
4. 本文件所在目录下的对应方案

---

## 三、四条铁律（每份方案都适用，重复是因为它太容易忘）

### 铁律 1 · 事实源只能是 `tools/content/*.py`

**不要直接改 `arsenal-*.json`。** 正确链路：

```
tools/content/*.py  →  python tools/build-content.py  →  arsenal-{cookbook,stacks,cases,icons}/*.json
                                                            │
                                                            ▼
                                        node scripts/sync-content.mjs  →  src/generated/*.json
```

改完必须跑 `cd arsenal-web && node scripts/sync-content.mjs`，锚点/交叉校验失败会中断 —— 那是好事，别绕。
`arsenal-rules/*.json` 是例外（规则是手写数据，不经生成器）。

**写 JSON 一律 `newline='\n'`**（生成器里已有 `write_json`，照抄即可），否则整份文件会变成「CRLF 假变更」。

### 铁律 2 · 新增一类文件型事实源，要同时改四处

漏一处的症状是：`src/generated/*.json` 缺文件 → 构建期炸在 import 上，或者更糟 —— 静默不生效。

1. `arsenal-web/scripts/sync-content.mjs` —— 加形状闸门（字段齐不齐、引用对不对）
2. 前端 resolver（`src/lib/<新类型>.ts`）—— 读 `src/generated/<新类型>.json`
3. `arsenal-web/.verify/project-check.ts` —— 加契约断言
4. `README.md` —— 目录树 + 进度表

### 铁律 3 · verify 总数要同步四处

当前总数以 `NIGHT-RUN.md` §六 为准（2026-09-22 实测 **620**，八层：
`arch 35 / graph 59 / cases 25 / project 406 / engine 17 / parity 12 / archify 31 / scan 35`）。
本节早先写的 473 是首轮夜跑前的基线，已作废。

改了任何一层，这四处都要一起改：

1. `arsenal-profiles/arsenal.json` 的 `verifyChain`
2. `arsenal-web/.verify/project-check.ts` 里手写的总数
3. `README.md` 的 verify 总数
4. `README.md` 的 verify 分项表

收尾必跑：

```bash
cd arsenal-web && npm run verify
```

> `verify:parity` / `verify:archify` 需要 bash + JDK 17。跑不了时它们会**明说跳过并退出 0** —— 别把「跳过」当「通过」。

### 铁律 4 · 零外部依赖是硬约束

`arsenal-web/package.json` 的运行时依赖**只有 `next / react / react-dom`**。这是刻意的：

- 图标 = 手写 inline SVG（`src/lib/tech-icons.ts`、`src/lib/arch-glyphs.ts`）
- 动画 = 自研内嵌 CSS 关键帧（`src/lib/arch-motion.ts`）
- 绘图 = 纯函数拼 SVG（`src/lib/arch-diagram.ts`、`src/lib/arch-canvas.ts`）

**不许**引入 `simple-icons` / `lucide` / `framer-motion` / `lottie` / `chart.js` 任何一个。
需要新图标就手绘；需要新动效就加 `arch-motion.ts` 的 class 并遵守 `prefers-reduced-motion`。

---

## 四、环境备忘（Windows / Git Bash）

| 坑 | 处置 |
|---|---|
| bash 的 PATH 是坏的 | 每条命令前 `export PATH="/usr/bin:/bin:/c/Windows/System32:/c/Windows:$PATH"` |
| node 用哪个 | 托管版：`C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe` |
| `curl` 读不了也写不了 `/tmp` | 输入路径用 `cygpath -m`，输出用 shell 重定向 |
| 给 node 的路径必须 Windows 形式 | `D:\...` 而不是 `/d/...` |
| 无头浏览器 | `playwright-core` 在 `arsenal-web/node_modules`；`chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'})`；`getByRole` 在本站多处歧义 → 用 `page.evaluate` 按 `textContent` 找元素再 click |
| 调试产物 | 写 `.workbuddy/_*`，用完即删 |
| 后端 | `bash arsenal-server/scripts/run.sh`；JDK 17 在 `C:/Users/Administrator/.jdks/corretto-17.0.12` |

---

## 五、每个夜间任务的收尾动作（固定套路）

1. 跑 `cd arsenal-web && npm run verify`，全绿才算完成。跑不了的层要**如实报告哪几项跳过了**
2. 更新 `README.md`：目录树、进度表、verify 数字（该改的四处）
3. 追加日志 `D:\workspace\2026\mryang-arsenal\.workbuddy\memory\YYYY-MM-DD.md`（append，不覆盖），记：做了什么、踩了什么坑、留下什么未完成
4. 若引入了长期生效的新约定 → 同时更新 `D:\workspace\2026\mryang-arsenal\.workbuddy\memory\MEMORY.md`
5. 报告格式：**先结论（做完/做到哪一步）→ 再证据（命令与输出）→ 再剩余工作量清单**
6. 未完成的项**不许说成完成了**，也不许用假数据填充。做不完就写「MVP 完成，以下 N 项留待下一次」

---

## 六、给每个定时任务用的 prompt 模板

把下面这段贴进定时任务，`<N>` 换成方案编号：

```
执行 D:\workspace\2026\mryang-arsenal\docs\hy4-night-plans\plan-<N>-*.md 的全部内容。

开工前先读这四份，不许跳过：
- D:\workspace\2026\mryang-arsenal\docs\hy4-night-plans\00-index.md（四条铁律与环境备忘）
- D:\workspace\2026\mryang-arsenal\README.md
- D:\workspace\2026\mryang-arsenal\.workbuddy\memory\MEMORY.md
- D:\workspace\2026\mryang-arsenal\.workbuddy\memory\（最近三天的日志）

按方案里的「分阶段实施」顺序做，每个阶段做完立刻验收，失败就停下来说清楚。
收尾按 00-index.md 第五节执行（verify + README + memory）。
时间不够时优先完成方案里标注为 MVP 的部分，剩余项如实列入「剩余工作量」。
```

---

## 七、四条线各自要回答的问题

| 方案 | 一句话目标 | 做完之后能干什么 |
|---|---|---|
| 1 | 让架构图「认得出来是什么东西」 | 装配台和 /arch 上一眼看出这是 Nacos、那是 Redis；交付文档里能插图 |
| 2 | 让案例库从「4 条范文」变成「按你的问题出答案」 | 「我有 5 亿行数据、3000 QPS，怎么建表怎么写代码」→ 直接给生产级 Java |
| 3 | 让装配台从「选 Java 组件」变成「装配一整个项目」 | 能选负载均衡、集群形态、测试栈；交付方式是活的图而不是一页文字 |
| 4 | 让别人的项目也能进来出图 | 给一个 Java 仓库，自动出分层图 / 部署图 / 可交付 HTML |
