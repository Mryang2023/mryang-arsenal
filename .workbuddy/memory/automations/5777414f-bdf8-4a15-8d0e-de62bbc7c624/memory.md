# 夜跑第 4 棒 · 执行记忆（automation 5777414f）

> 只记「下次开工前需要知道的事」，不复述报告全文。完整交付见
> `.workbuddy/night-chain/04-done.json`。

## 2026-09-23 01:08 → 01:46（首次执行 · 完成）

**任务**：plan-1 的 A-4（各层 verify 项数由实测得出 + 逐层比对）。**提前完成，按备选池第 1 件取了 A-9。**

### 结果

- 状态 **完成**。两次提交：`9cd079c`（A-4 主体）+ `1e91651`（A-9）。
- 全量 verify：`628 实测 / 34 跳过 / 0 失败 / 刻意未跑 2 项 → 退出码 2`，与开工前基线一致（零回归）。
- 新增链尾闸门 `.verify/meta-check.ts`（`npm run verify:meta`）+ 汇总产物 `.verify/tmp/layer-counts.json`。
- 删掉 `project-check.ts` 里手写的 `662`（恒等式后半句）与过期的 628 注释。
- 反着验 5 处，全部真红：改 verifyChain ±1 / 加一条断言 / 层文件 0 项却报通过 / 旧格式层文件 /
  `--strict` 判负「刻意未跑」。

### 下次接手必须知道的三件事

1. **prompt 说「由 project-check.ts 逐层比对」是错的，方案 A-4.2 才对**：`verify:project` 跑在八层
   **中间**，读不到 engine/parity/archify/scan 的状态文件。守门必须挂**链尾** `verify:meta`。
   （本棒已按方案做；prompt 与方案的这处冲突下次可以直接照方案走，不必再论证一遍。）
2. **`countSource` 是这套记账的关键概念**：整层跳过时 `skipLayer()` 填的「N 项未执行」取自档案
   声明值（自己给自己出题）→ 必须标 `countSource: 'declared'` 并在 meta 记「未核对」，不许当通过；
   旧格式文件缺该字段时要按 `unknown` 处理，**默认取 `measured` 就是复现假绿**。
3. **本棒建立了「取一件备选池就收工」的纪律**：A-4 在预算内（用了 38 / 119 分钟）收口后，
   只取了 A-9 一件，**没有自己找活干**（prompt 明令）。下次同样不必为了用满窗口而加班。

### 环境备忘（这次踩到的）

- 本棒 5 次全量 verify **全部在前台跑**（110s / 次），**没有**触发沙箱删除守卫 ——
  与第 3 棒「守卫打死 parity 层」的情形不同。前台 + escalation-approved 是安全的。
- `fs.writeSync(1, ...)` 同步 stdout 是棒 1 留下的正确做法（Windows 管道 stdout 异步，
  `process.exit()` 会截断 console.log）—— 沿用，别再改回 console.log。
- heredoc / `python -c "…{…}…"` 在本环境里的引号陷阱会报 `unexpected EOF`：
  要写较长脚本就**落盘成 .py 文件**再跑（`newline='\n'` 写 JSON）。
