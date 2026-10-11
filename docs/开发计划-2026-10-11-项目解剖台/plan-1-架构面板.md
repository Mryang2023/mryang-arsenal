# 棒 1 · 解剖台骨架 + 架构面板

> 体量：**XL**（新页面 + 后端接口打通）
> 预算：单棒 155 min（开发 95 / 自检 30 / review 30）

## 一、目标（做完什么算完）

新建 `/autopsy` 页面：填一个项目地址 → 点「一键分析」→ 出技术栈部署图 + 应用分层图 + 未识别依赖清单。
**这是一个闭环**，不是地基 —— 页面必须真能渲染出图，不能只是路由通。

## 二、已存在的资产（**不要重写，先确认再动手**）

| 资产 | 路径 | 现状 |
|---|---|---|
| 扫描编排 | `arsenal-server/src/main/java/com/arsenal/scan/ProjectScanner.java` | 成品，5 个 Scanner |
| 三输入收敛 | 同目录 `SourceResolver.java` | 成品：path / git / zip 一个接口 |
| 依赖映射表 | `arsenal-scan/scan_rules.json` | 108 条，47 条上画布 |
| 出图数据 | `POST /api/scan/diagram` | 成品，返回 picks + bands + crossCalls |
| 出图渲染 | `arsenal-web/src/lib/arch-diagram.ts`(796) / `arch-canvas.ts`(1101) / `archify-ir.ts`(1111) | 成品 |
| facts→IR 链路 | `arsenal-web/src/app/archify/ArchifyLab.tsx`(765 行) | **完整实现，要拆出来复用，不要重写** |
| 前端 API 客户端 | `arsenal-web/src/lib/arsenal-api.ts` | 已有 `scanFacts()`(L267) / `scanUpload()`(L292) |
| 导航数据 | `arsenal-web/src/components/Shell.tsx` 的 `NAV` 数组 + `NAV_ROWS`(L70 派生) | 加一项进去 |
| 导航高亮 | `arsenal-web/src/lib/nav-active.ts` | 有 `LEAF_PARENTS` 之类的机制，新增路由要确认是否要登记 |

## 三、分阶段实施

### 阶段 A · 抽数据层（**先做这个，不许跳过**）

`ArchifyLab.tsx` 765 行里，facts→IR→SVG 那部分要能被别人复用。
做法：把纯数据部分（facts 归一化、IR 构造、picks 推导）抽到
`arsenal-web/src/lib/autopsy-data.ts`，`ArchifyLab.tsx` 改为消费它。
**约束**：`ArchifyLab.tsx` 改完后必须与改前行为一致（`/archify` 页面仍能正常出图，见 §五验收 1）。

### 阶段 B · 后端接口体检

- `GET /api/scan/rules` 已有（返回 count 与文件路径）—— 直接用
- 新增 `POST /api/scan/local`：接收本地目录路径（如果 `/api/scan/facts` 的 `kind:"path"` 已够用，**不要新增接口**，
  直接用现成的）。开工前先读 `SourceResolver.java` 确认 `fromPath` 的实现与安全约束
- **安全红线**：`SourceResolver.fromPath` 接受任意路径。页面上的「本地目录」输入必须显示
  扫的是哪个绝对路径，**不许静默解析到别处**。这条要写进 `NIGHT-RUN.md` 的自查项

### 阶段 C · 页面

```
arsenal-web/src/app/autopsy/
├── page.tsx        （壳，仿 /archify/page.tsx 的 15 行写法）
├── AutopsyLab.tsx  （容器）
└── (子组件若干)
```

三块UI：
1. **输入区**：git URL / 本地目录 / 拖 zip（三种 tab）
2. **架构面板**：技术栈部署图 + 应用分层图（复用 `arch-diagram.ts` / `arch-canvas.ts`）
3. **未识别依赖清单**：`facts.techStack.unmatched` 直接列，每条带 evidence（文件:行）

### 阶段 D · 导航

`Shell.tsx` 的 `NAV` 数组加一项 `{ href: '/autopsy', label: '项目解剖台', glyph: '◈' }`。
**开工前先 grep `nav-active.ts` 与 `Shell.tsx` 里所有对该数组长度的断言** —— 项目铁律里有
「源码当数据断言」，新增数组项可能让某条断言的数字对不上。

## 四、判据（写死，自检时逐条核对）

1. `cd D:/mryang/workspace/2026/arsenal/arsenal-web && node scripts/next-run.mjs dev` 起得来，
   `/autopsy` 不白屏
2. 用**本仓路径**当输入 → 出一张技术栈图（Next.js / Spring Boot / Postgres 等要认得出来）
3. 用**一个陌生的 git 地址** → 不崩，未识别依赖列出来
4. `/archify` 页面**仍然正常**（阶段 A 重构没改坏它）
5. 每条未识别依赖都带 `evidence`（文件路径 + 行号），没有的必须说明原因
6. `npm run typecheck` 过；`npm run verify` 全量跑（**不是只跑自己那层**）

## 五、验收标准

- [ ] 阶段 A/B/C/D 全部完成或有明确降级记录
- [ ] §四 六条判据全部实测过，输出写进 `01-done.json`
- [ ] `/archify` 回归通过
- [ ] 侧边栏能进 `/autopsy`，高亮正确（`nav-active.ts` 若需要登记则已登记）
- [ ] 反着验≥ 2 处（见 `NIGHT-RUN.md` §3.2 第 3 条）

## 六、MVP 与可裁剪（预算不够时按这个顺序砍）

**必须做**（闭环）：阶段 A 数据层 + 阶段 C 输入区与架构图 + 本仓自测
**优先砍**：阶段 D 导航（→ 记入剩余工作量，手敲URL 也能用）
**其次砍**：zip 上传（→ 只留 git + 本地目录，页面提示「暂不支持 zip」）
**最后砍**：未识别依赖清单的 evidence 展开（→ 只列技术名，evidence 折叠）

## 七、参考引用（开工前核实真实存在）

- `arsenal-server/src/main/java/com/arsenal/scan/SourceResolver.java` —— 确认 `fromPath` / `fromGit` / `fromZip` 三个工厂方法都在
- `arsenal-web/src/lib/arsenal-api.ts` 的 `scanFacts` / `scanUpload` —— 确认签名与 `ScanOutcome` 类型
- `arsenal-web/src/app/archify/ArchifyLab.tsx` —— 确认 facts→IR 的入口函数名再抽
- `arsenal-scan/scan_rules.json` 的 `count: 108` / `onCanvas: 47` —— 报告里要用这两个数字，**从文件读，不要写死**

## 八、给下一棒的话（预告）

棒 2 会在本棒的基础上加「体检报告」面板，它需要本棒的输入组件（能拿到一份 `ProjectFacts`）。
若本棒超时或降级，棒 2 需知道 `ProjectFacts` 是怎么拿到的（走哪个函数）。