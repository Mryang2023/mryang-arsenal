---
name: night-run
display_name: 夜跑编排
display_name_en: Night Run Orchestration
description: Orchestrate a folder of task plans into a chain of one-time scheduled automations for the overnight window (typically 23:00-08:00), where each run is a fixed three-stage unit (develop, self-check, then code review) plus a final independent inspection pass. Use when the user hands over a plans folder and asks to schedule it for tonight, or says things like "把这些任务安排在今晚跑", "帮你排夜跑", "给你一个文件夹你自己安排定时任务", "晚上11点到明早8点要执行的任务", "overnight run", "night shift scheduling".
description_zh: 把「一个装着任务方案的文件夹」编排成「一串跑得完、且每棒固定自带三段质量门禁的定时任务」，用于夜间免费时段（如 23:00–08:00）的无人值守开发。每棒固定为：开发 → 自检补漏 → Code Review，多棒走串行接力，最后一棒做独立终检。当用户给出计划文件夹并要求「安排在今晚跑」「排夜跑」「你自己安排定时任务」时使用。
agent_created: true
---

# 夜跑编排

把「一个装着任务方案的文件夹」变成「一串跑得完的定时任务」。

这不是"把方案分发给 N 个 agent"，而是**一次排期作业**：先算窗口装得下多少，再决定放几棒。
首次夜跑（2026-09-21）的教训就是反面教材 —— 4 个按"一整晚"设计的方案被塞进一个窗口，
每棒只分到约 2 小时，结果四棒全部只做到地基，没有一条闭环。

## 输入

用户会给一个文件夹，通常包含：

- 一份索引 / 总纲（`00-index.md`、`README.md` 之类）—— 任务清单、铁律、环境备忘
- 若干任务方案（`plan-*.md`）—— 理想情况下每个方案自包含，执行者从零读它就能干活

缺索引不阻塞（直接从方案里抽任务清单），但**方案必须自包含** ——
若发现某方案依赖对话上下文，先说清并要求补全，再排期。

## 流程（六步）

### 1. 勘察

读索引 + 每个方案的三节：**「分阶段实施」「验收标准」「MVP 与可裁剪」**。
同时确认：工作目录的绝对路径、运行时路径、项目铁律、上次夜跑的状态目录与遗留清单。

### 2. 体量评估

给每个方案定档：`S / M / L / XL / XXL`（判定表见 `references/charter.md` §3.1）。
**不要乐观。** 方案作者写的"一整晚"通常就是 XL 起步。

### 3. 排期

按 `references/charter.md` §3.2 的公式算窗口能装下几棒。
**装不下就砍，绝不硬塞** —— 硬塞的产物是"每条线各一半的半成品 + 一堆欠账"。
砍法四策见 §3.3（降级 / 分夜 / 合并 / 明确不做）。

### 4. 落规程

用 `templates/night-run-template.md` 实例化出项目内的 `<计划文件夹>/NIGHT-RUN.md`：
填棒次表、硬线时刻、工作目录、项目铁律附录。
这是每个夜间 agent 开工必读的第一份文件 —— **它必须自包含**，
不能让夜间 agent 去翻技能目录（那时它的工作目录是项目，不一定知道技能存在）。

若项目已有常驻规程（如 `NIGHT-RUN.md` 已存在且是常驻版），只更新变化的排期部分。

### 5. 建任务

按 `references/briefing-templates.md` 生成每棒 prompt。每棒 prompt 必须写进：

- **三段式**（开发 → 自检补漏 → Code Review）与各段分钟预算
- **开门第一件事**：等前棒交棒（第一棒除外）
- **收尾清单**：全量验证 → 派生数字同步 → git commit → 清理调试产物 → README/memory → 回滚判断 → 状态文件
- **交棒动作**：把下一棒的执行时间改成「现在 + 3 分钟」
- **环境备忘**：见 `references/project-profiles.md`（漏一条那一棒就废了，不要嫌啰嗦）
- **报告格式**：模型名与起止时间 → 先结论 → 再证据 → 再剩余工作量

第一棒时间设在 **23:05 之后**，给用户留出在客户端选模型的时间。
多棒时用"接棒（兜底 HH:MM）"——兜底时间是保险丝，不是计划开工时间。

### 6. 交付

建完给用户三样东西：

1. **一张棒次表**：棒次 / 任务 / 开工 / 交棒硬线 / 预算
2. **三个必做动作**：手动选模型、电脑不关机 + 客户端保持登录、「允许锁屏运行」设"熄屏后继续运行"
3. **排期取舍说明**：哪几条进了今晚、哪几条排到后面、为什么这么砍

## 铁律

1. **绝不并行改同一个仓库。** 每棒开工先等前棒状态文件；等不到就写 blocked 跳过，不许抢跑。
   两棒同时改同步脚本 / README / 验证数字，事后无法归因是谁改坏的。
2. **时间窗是硬约束。** 单棒预算 < 体量 × 1.5 + 20 → 不许排。
3. **没有收尾的棒不算交付。** 收尾含全量验证 + 数字同步 + git commit。
4. **不许把没做完的说成做完了。** 自检段与终检棒专门核这条。
5. **调试产物用完即删**（`_*` 前缀）。

## 参考文件

- `references/charter.md` —— 章程全文（第一原则、三段式细则、排期算法、接力协议、收尾清单、终检职责、已知环境坑）
- `references/briefing-templates.md` —— 各棒 prompt 模板 + `0N-done.json` schema
- `references/project-profiles.md` —— 项目附录（环境备忘与铁律，编排时复制进 prompt）
- `templates/night-run-template.md` —— 项目内 `NIGHT-RUN.md` 的实例化模板
