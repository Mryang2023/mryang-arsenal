# 棒 3 · 分析快照 + 历史 + L1 增量

> 体量：**L**（从原 XL 降级 —— 今晚只做 L1，L2 需要先重构聚类，塞进来会拖垮整棒）
> 预算：单棒 150 min（开发 90 / 自检 30 / review 30）
> 前置：棒 1、2 已交棒

## 一、目标

每次分析自动留档；能看历史列表；同一份输入再分析时**秒回并显示「无变化」**。

## 二、明确不做（写清楚，避免有人以为漏了）

**L2 增量（只重扫变化的文件）今晚不做。** 原因：`CodeScanner` 现在是 `TreeMap`/`ArrayList` 一把聚合
（见 `arsenal-server/src/main/java/com/arsenal/scan/CodeScanner.java`），无法「只重算 3 个文件的贡献」。
这是独立的架构改造，要改的是聚合方式本身，塞进夜跑会拖垮整棒。

今晚做**L1 完整实现 + L2 的诚实占位**（页面上明写「L2 增量未实现」，而不是假装有）。

## 三、快照存哪

**不进军火库仓库。** 依据：`arsenal-web/src/app/arch/profile-store.ts` 顶部注释已经立过这条规矩
（「别的项目的架构资料不该因为我们想看一眼就被提交进军火库」）。

三档目录（照抄章程层已验证的三档模式，`arsenal-web/scripts/lib/charter-dir.mjs` 是同一份做法）：

```
默认  arsenal-web/.data/autopsy/
覆盖  arsenal.json#project.autopsyDir
覆盖  env ARSENAL_AUTOPSY_DIR
```

**必须加进 `.gitignore`**（本仓根）。这一步漏了，`git add` 会把别人的项目数据提交进军火库。

## 四、快照 schema

```json
{
  "schemaVersion": 1,
  "projectId": "<路径或git URL 的 sha256>",
  "projectRef": "https://…/x.git",
  "snapshotId": "2026-10-11T2315",
  "fingerprint": "sha256:…",
  "facts": { …ProjectFacts 全文… },
  "verdict": { "p0": 12, "p1": 31, "obs": 8 },
  "features": [],
  "coverage": { "covered": 42, "total": 69 },
  "toolVersion": "0.1.0"
}
```

## 五、指纹怎么算

| 输入类型 | 指纹 |
|---|---|
| git | HEAD commit + 未提交改动的 blob 哈希（`git status --porcelain` + `git diff HEAD` 的哈希） |
| 本地目录 | 递归文件树的 `mtime + size` 哈希（**不要读全量内容**，大仓库会卡死） |

**注意**：目录指纹用 mtime 会漏「内容改了但 mtime 没变」的情况。这是已知取舍，
页面上要写明「目录指纹基于 mtime+size，可能漏检」，**不许声称 100% 准确**。

## 六、分阶段实施

### 阶段 A · 读写层

`arsenal-web/scripts/lib/autopsy-store.mjs`：
`resolveAutopsyDir()` / `saveSnapshot()` / `listSnapshots()` / `loadLatest()`
—— 与 `charter-dir.mjs` 同构（三档 + 环境变量覆盖）。

### 阶段 B · 前端历史页

在 `AutopsyLab.tsx` 加第三个页签「历史」：
每个项目的快照列表，显示 `snapshotId` / 指纹前 8 位 / P0·P1·观察项计数 / 覆盖率。
点一条 → 看当时的完整结果（facts + verdict）。

### 阶段 C · L1 命中

分析前先算指纹 → 找该`projectId` 的最新快照 → 指纹相同则**直接返回不扫**，
页面上明确显示「输入未变化，复用 <snapshotId>」。

### 阶段 D · 对照（最小版）

新分析完成后与上一份比，给四段变化：

```
技术栈  +Redis(pom.xml:58)  -MyBatis(已删)
体检    P0 14 → 12
功能    （本棒不涉及）
覆盖率  42 → 44
```

**「P0 少了 2 个」必须有依据**：靠 violation 集合差集，能点开看
「上次命中在哪个文件第几行 → 这次那里没了」。
**否则「P0 少了 2 个」和「2 条规则今天没跑」在页面上长得一模一样**（10-04 踩过，见总纲决策 6）。

## 七、判据（写死）

1. 同一地址分析两次 → 第二次**不触发扫描**，页面显示「复用 <snapshotId>」
2. 改一个文件再分析 → 生成新快照 + 四段变化正确
3. `git status` 里**看不到** `.data/autopsy/`（.gitignore 生效）
4. 快照文件里**没有**绝对路径以外的敏感信息（不存令牌/口令）
5. 快照损坏（手动改坏 JSON）→ 读的时候不崩，提示「这份快照坏了」，**不是整页白屏**
   （`profile-store.ts` 里有同类处理，照它的形状：`archProfileShapeIssues`）
6. `npm run typecheck` 过 + `npm run verify` 全量绿

## 八、验收标准

- [ ] 三档目录真的生效（改 env能换目录）
- [ ] .gitignore 生效，**`git status` 亲自确认干净**
- [ ] L1 命中实测过（第二次分析的网络请求里**没有** `/api/scan/facts`）
- [ ]快照损坏不白屏
- [ ] 反着验 ≥2 处：① 手动改坏指纹 → 不再命中 L1 → 还原；
  ② 删掉一条 violation → 对照里真显示「修好了」→ 加回来

## 九、MVP 与可裁剪

**必须做**：阶段 A + C（L1）+ 历史列表
**优先砍**：阶段 D 对照的四段（先只给 P0/P1 计数差）
**其次砍**：git 输入的指纹（先只支持本地目录指纹）
**最后砍**：历史页的详情回看（只列清单）

## 十、参考引用（开工前核实真实存在）

- `arsenal-web/src/app/arch/profile-store.ts` —— localStorage 侧的形状参照（含损坏处理）
- `arsenal-web/scripts/lib/charter-dir.mjs` —— **三档目录的唯一实现在这里，照抄它，不要另写一份**
- `arsenal-web/src/lib/arsenal-api.ts` —— `scanFacts` 的签名
- 仓库根 `.gitignore` —— 确认现状再加，别覆盖别人的条目

## 十一、给终检棒的话

本棒引入的**持久化**是三个新检查里最容易被偷工减料的：
`.gitignore` 是否真生效、L1 是否真短路了请求、快照损坏是否真不白屏。
**这三条从未红过，终检请优先反着验。**