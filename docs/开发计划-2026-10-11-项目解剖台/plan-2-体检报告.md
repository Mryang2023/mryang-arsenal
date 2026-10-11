# 棒 2 · 体检报告

> 体量：**XL**（新事实源 + 后端接口 + 页面）
> 预算：单棒 155 min（开发 95 / 自检 30 / review 30）
> 前置：棒 1 已交棒（`01-done.json` 存在）

## 一、目标（做完什么算完）

在解剖台上加「体检报告」页：一份项目代码进来 → 出**三档结论**（P0 必修 / P1 该改 / 观察项），
每条**必带 file:line证据**。

## 二、两类判据，性质不同，不要混

| 档 | 判据来源 | 现状 |
|---|---|---|
| P0 必修 / P1 该改 | **复用 69 条规则**（`arsenal-rules/`），severity=MUST(37)+NEVER(13)=50 条判 P0，SHOULD(18) 判 P1 | 引擎已有，见下 |
| 观察项 | **facts 推导**（不是规则）：依赖数过多、无 CI、Dockerfile 无 healthcheck 等 | **全新，必须数据化** |

### P0/P1 走引擎（已有）

- `arsenal-server/.../engine/LintEngine.java` / `AstEngine.java` / `LintLayer.java`
- `POST /api/lint`（`LintController.java`）—— **但它只吃上传的源码，不吃本地目录/git**
- `arsenal-web/src/lib/arsenal-api.ts` 的 `lintRemote(files)`(L421) 是前端那条路

**本棒要做的**：`POST /api/autopsy/inspect`，把 `SourceResolver` 读到的源码喂给 `LintEngine`，
绕过「必须先上传」的限制。请求体 `{ "source": {"kind":"path|git","value":"…"} }`，与 `/api/scan/facts` 同形。

**关键诚实点**：AST 层覆盖率是 **42/69**（memory 有记录：前端 35/69、后端 42/69、LLM 0/43）。
剩下 27 条在本次体检里**跑不了**。报告**必须显式写出来**：

```
本次体检覆盖 42/69 条规则；27 条未覆盖（LLM 层 0/43、正则层 skipped）——
未覆盖 ≠ 通过
```

**不许**只报「P0: 12 条」而不说分母。**「没检查」和「检查通过」在页面上长得一模一样**
（这是 2026-10-04 在 `charterNotExecutableCount` 上踩过的坑，漏了 `PJX-` 前缀导致显示 34 而章程只有 2 条）。

### 观察项必须数据化（本棒新建第 9 个事实源）

**不许写死在 Java 里。** 理由：换语言就得改代码重编译。

新建 `arsenal-checkups/checkups.json`：

```json
{
  "collection": "arsenal-checkups",
  "version": "0.1.0",
  "count": <算出来>,
  "rules": [
    {
      "id": "CK-OBS-001",
      "level": "obs",
      "when": { "fact": "techStack.matched.length", "op": ">=", "value": 8 },
      "text": "依赖外部技术 ≥ 8 个，耦合面偏大",
      "advice": "核对是否每条依赖都在运行时必需"
    }
  ]
}
```

`when` 支持的算子开工时定最小集：`>=` `<=` `==` `!=` `contains` `exists`。**别一上来做表达式引擎。**

Java 侧只写解释器：`CheckupEvaluator.java`。

## 三、分阶段实施

### 阶段 A · 观察项事实源（先做，因为它有登记义务）

1. 建 `arsenal-checkups/checkups.json` + 校验器 `arsenal-web/scripts/lib/validate-checkups.mjs`
   （照抄 `validate-charter.mjs` 的形状，`today` **必须注入**，不读 `new Date()`）
2. **加第 9 个事实源必须登记的地方（漏一处就永远不会红）**：
   - `arsenal-web/scripts/sync-content.mjs` 的事实源清单
   - `arsenal-profiles/arsenal.json` 的 `project.dirs`
   - `verify:project` 的事实源登记断言（**注意：这条断言验的是导出包 README，不验本仓 README**，
     所以本仓 README 与 `project.dirs` 漏登记**永远不红** —— memory 硬约定第 4 条记的章程目录就是这样漏过的）
   - `arsenal-profiles/arsenal.json` 的 `project.pipeline` 若有枚举类字段也要更新
3. 起 `verify:checkup` 层 → **六处六件套**（见 §六）

### 阶段 B · 后端 inspect 接口

`arsenal-server/src/main/java/com/arsenal/web/AutopsyController.java`：
`POST /api/autopsy/inspect` → `{p0:[…], p1:[…], obs:[…], coverage:{covered, total, skipped:[…]}}`

**注意 GlobalExceptionHandler 把 404/405/415 吃成 500**（memory 有记录）——
新接口的入参校验要在 Controller 里做，别依赖框架异常。

### 阶段 C · 前端报告页

在棒 1 的 `AutopsyLab.tsx` 里加第二个页签。三档分组展示，每条：
- 结论一句话
- 证据 `file:line`（可点/可复制）
- coverage 条（**即使 0 条也要显示**，「没有要提示的」与「一条都没有」在页面上长得一样）
- skipped 明细（可折叠）

## 四、判据（写死）

1. 用**军火库自己**当被检对象（本仓路径）跑一遍，出真报告
2. 报告页**显式写覆盖率** `42/69`，列出未覆盖的 27 条
3. 每条 P0/P1 **都有 file:line**
4. **反着验**：往被检项目注入一条明确违规（比如某个 MUST 规则能命中的写法）→ 报告真的多一条 →
   还原 → 真的少一条
5. **反着验 2**：把 `checkups.json` 里一条规则删掉 → 该观察项消失 → 加回来 → 出现
6. `npm run typecheck` 过 + `npm run verify` 全量绿（含新增的 `verify:checkup`）

## 五、验收标准

- [ ] 观察项是**数据**不是代码（把 JSON 清空 → 观察项真的全没，Java 不重编译）
- [ ] 覆盖率显式展示，0 条时也展示
- [ ] 两条反着验都做过并记录
- [ ] `verify:checkup` 已进六处六件套，`verify:meta` 认它
- [ ] `arsenal-profiles/arsenal.json` 的 `verifyChain` 从 12 条变成 13 条（**数字要算，不要写死**）

## 六、加 verify 层的六处六件套（memory 铁律 7，漏一处必事故）

1. `arsenal-web/package.json` 的 `scripts` 加 `"verify:checkup"`
2. `arsenal-web/scripts/verify-all.mjs` 的 `LAYERS` 数组加一项
   （**用独立 key `checkup`** —— memory 铁律 18：两个脚本共用一个 key 时后写的会覆盖先写的）
3. `.verify/report.ts` 的 `LAYER_NAMES` 加层名
4. `.verify/meta.ts` 的 `CHAIN_ORDER` 加 key
5. `arsenal-profiles/arsenal.json` 的 `project.verifyChain` 加一项（**项数从档案读，不要写死「十二层」**）
6. `README.md` 两处（分项表 + 正文）

## 七、MVP 与可裁剪

**必须做**：阶段 A + B（数据源 + 接口）+ C 的 P0/P1 档
**优先砍**：观察项的规则条数（先只写 3 条能验的，别写 10 条）
**其次砍**：覆盖率里的 skipped 明细（只给数字不给列表）
**最后砍**：页签独立化（三档挤在一页往下滚）

## 八、参考引用（开工前核实真实存在）

- `arsenal-server/src/main/java/com/arsenal/engine/LintEngine.java` —— 确认入口签名与 `LintRequest` 结构
- `arsenal-server/src/main/java/com/arsenal/web/LintController.java` —— 照它的形状写新Controller
- `arsenal-web/scripts/lib/validate-charter.mjs` —— 校验器形状的参照
- `arsenal-rules/meta.json` —— **69 条规则的权威数在这里，报告里的分母从它读，不要写死**
- `.verify/report.ts` / `.verify/meta.ts` —— 确认路径与 `LAYER_NAMES` / `CHAIN_ORDER` 变量名

## 九、给下一棒的话（预告）

棒 3 要存快照。快照里会存本棒产出的体检结论（`verdict: {p0, p1, obs}`）。
若本棒改了结论的数据形状，棒 3 的快照 schema 要跟着改——**交棒时把最终的数据形状写进 `02-done.json`**。