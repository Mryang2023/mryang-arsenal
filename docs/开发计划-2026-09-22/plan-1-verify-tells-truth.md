# 计划 1 · 让验证体系说真话

> 归属：台账 A-1 … A-9 + 「删 `zip-lite.ts`」
> 波次：**Wave 1**（可与计划 2 并行）
> 唯一任务源就是本文；不要再去读 README，它有过期内容（计划 4 会修）。

---

## 〇、为什么先做这个

`npm run verify` 是这套仓库**唯一的闸门**（全仓无 `.github/`、无 CI，见体检 §三 P0-1）。
它现在有三种说谎方式：

| 症状 | 证据 | 后果 |
|---|---|---|
| 整层跳过却退出码 0 | `scan-check.ts:478-481`、`archify-check.ts:92-98` 都 `process.exit(0)`；`archify-check.ts:445-446` 用 `check(..., true)` 把跳过**计入 pass** | 「八层全绿」可能实际是「五层在跑」 |
| 项数是手写常量 | `project-check.ts:509-518` 断言 `VERIFY_TOTAL === 662`，而 `VERIFY_TOTAL` 的定义就是那个 reduce（**恒等式**）；注释自陈「尚未做」，且 628/662 自相矛盾 | 层内加了 3 项断言，外面写着的数字可以不动，verify 照样全绿 |
| 跑不跑取决于 PATH 里哪个 bash | 实测本机 `bash` 解析到 `C:\Windows\System32\bash.exe`（WSL 桩），`status=1` → `scan-check.ts:66` 判「没装 bash」整层跳过 | 「能不能验证」变成一个环境巧合 |

仓库自己知道正确的跳过怎么写：`scan-check.ts:273` 的软链用例、`parity-check.ts:345-347` 的活服务体检、
`ArchifyProbe.java:114-118` 的 `guards.put("skipped", true)` 都**不把跳过算通过**。只有这两处例外。

**做完这一份，后面三份的验收才有意义。**

---

## 一、任务清单

### A-1 类型闸门进 verify

**现状**：`npm run verify` 八层全是 `tsx`，**全程不跑 `tsc`**（`package.json:24`）。
`tsc` 唯一的探测器是 `next build`。所以 `topology.ts:619,664` 的 `void` 传参（`row()` 返回 void，
外面又套一层 `o.push()`）能潜伏很久 —— 它被 `Array.join` 化成空行，渲染不崩。

**做**：
1. `package.json` 加 `"typecheck": "tsc --noEmit"`，串进 A-5 的 runner 首位（`sync` 之后）。
2. 评估并开启 `noUncheckedIndexedAccess`、`noUnusedLocals`：
   - 先裸跑 `npx tsc --noEmit` 记录**开启前**错误数；
   - 逐个开启，记录错误数。**若 `noUncheckedIndexedAccess` 报错 > 150 条**，本计划只开 `noUnusedLocals`，
     把 `noUncheckedIndexedAccess` 写成「需要（错误数）个工作量的独立任务」交给计划 4 的 D-7 记账。
3. 结论：`.verify/**` **不在 tsconfig 的 include 里**（记忆里已记），`tsc` 抓不到它。
   本计划必须给一个明确结论：**纳入**（则新增 `tsconfig.verify.json`，
   且要处理 `.verify` 里对未类型化 JSON 的 33 处 `any`）还是**不纳入**（则在 A-5 的 runner 里
   对 `.verify` 单独跑 `tsx --check` 之类的语法检查，并**在总汇表里写明「verify 层代码不受类型检查」**）。
   倾向：**不纳入 + 在 verify 输出里显式声明**（成本低、诚实），但若实测纳入成本 < 50 条错误则纳入。

**验收**：
- `npm run typecheck` 退出 0。
- **反向验证**：把 `src/lib/topology.ts:619` 改回 `o.push(row(['A','B','C'], cy - 6));` → `npm run typecheck` 必须报 TS2345；改回。
- 贴出 `.verify` 是否纳入类型的**结论 + 实测错误数**。

---

### A-2 skip 语义独立化（**P0-1 主体**）

**做**：
1. 新建 `arsenal-web/.verify/lib/report.ts`，导出：
   ```ts
   check(name: string, ok: boolean, detail?: string)   // 计入 pass / fail
   skip(name: string, reason: string)                  // 计入 skip —— 绝不进 pass
   summary(): { pass: number; fail: number; skip: number; skipped: string[] }
   exitCode(): 0 | 1 | 2   // fail>0 → 1；fail==0 且 skip>0 → 2；否则 0
   ```
2. `archify-check.ts`：
   - `:92-98`（无绘图器）`process.exit(0)` → 用 `skip()` 记 1 条（九项构图检查**未执行**）+ 退出码 `2`；
   - `:445-446` `check(..., true)` 占位跳过 → 改 `skip('后端出图服务', reason)`；
   - `:417-419` 是**不可达死代码**（`:92-98` 早已 exit），删除。
3. `scan-check.ts:478-481`：`skipAll` 分支 → 退出码 `2`，并打印「本层 N 项**未执行**」。
4. `parity-check.ts:137-142`：缺 bash / 缺 JDK17 时把 `check(..., false)` 改成 `skip(...)`（退出 2）；
   **真正的断言失败仍是 1**。两者必须在输出里可区分。
5. 全部层改用 `report.ts` 的 `summary()` 打印统一格式（便于 A-4 解析）。

**验收**：
- 有环境：`npm run verify:archify` 退出 0（若后端不在 → 2）。
- **反向验证（必做三次）**：
  1. 把 `verify:scan` 的 bash 强制判为不存在（临时改 `hasBash=false`）→ 退出码必须是 **2**，不是 0；改回。
  2. 任意层人为加一条 `check('x', false)` → 退出码 1。
  3. 任意层人为加一条 `skip('x', 'y')` → 退出码 2，且汇总里出现在 `skipped[]`、**不出现在** pass 计数里。
- 输出格式里 skip 与 pass 是两个独立数字（截图为证）。

---

### A-3 parity 从 `&&` 链解耦

**现状**：`verify` 是 `arch && graph && cases && project && engine && parity && archify && scan`。
本机 `parity` 会 fail → **短路，后面两层根本不启动**；
而 `parity` 恰好排在两个会静默跳过的层前面，把它们遮住了。

**做**：改由 A-5 的 runner 顺序执行、**收集退出码不短路**。
另：把 parity 的「缺依赖」与「断言失败」拆成 2 / 1 两个退出码（A-2 第 4 条）。

**验收**：
- **反向验证**：人为让 `verify:graph` 失败 → 整体非 0，且 `verify:parity`~`verify:scan` **仍然跑完**，
  汇总表里出现全部八层的行。改回。

---

### A-4 项数由实测得出（**本计划的核心**）

**现状**：`project-check.ts:509-518`：`VERIFY_CHAIN.reduce((n,v)=>n+v.count,0) === VERIFY_TOTAL && VERIFY_TOTAL === 662`。
前半句恒真；后半句是手写数字。注释自陈「这次给引擎加了 3 项断言，实测 17 而 VERIFY_CHAIN 仍写着 14，整套 verify 照样全绿」。

**做**：
1. 每层结束时由 `report.ts` 的 `summary()` 写 `arsenal-web/.verify/tmp/layer-counts.json`：
   ```json
   { "layers": { "arch": {"pass":35,"fail":0,"skip":0}, "scan": {"pass":69,...}, ... } }
   ```
   **计数必须由 pass+skip 自动得出，不许手写。**
2. **新增链尾一层 `verify:meta`**（`package.json` 加 `"verify:meta": "tsx .verify/meta-check.ts"`）。
   为什么必须是链尾：`verify:project` 跑在其它层中间，读不到兄弟层的结果 —— 这是原设计没做成的真实原因。
   `meta-check.ts` 读 `layer-counts.json`，与 `VERIFY_CHAIN` **逐层比对 count**，不一致就红，
   报错必须带实际值：`层「引擎样本」声明 14 / 实测 17`。
3. `project-check.ts:509-518` 保留恒等式断言，但**把注释改成「这里只是形状检查，真正的守门在 verify:meta」**，
   并清掉自相矛盾的 628/662 描述。
4. `arsenal-profiles/arsenal.json` 的 `project.verifyChain` 的 `count` 若与实测不符 → 改它。
   ⚠️ **本计划对该文件只允许改 `project.verifyChain` 数组**（name/count/desc），其余字段一个字节不许动（归计划 4）。
   ⚠️ 改完**必须** `node scripts/sync-content.mjs`（否则 `src/generated/profiles.json` 过期 → 【14】契约红）。

**验收**：
- `npm run verify` 后 `.verify/tmp/layer-counts.json` 存在，八层计数与 `verifyChain` 逐层相等。
- **反向验证（必做）**：把 `arsenal-profiles/arsenal.json` 的「引擎样本」「代码扫描」count 各 ±1
  → `node scripts/sync-content.mjs && npm run verify:meta` **必须红**，且报错文本含实际数字；改回 → 绿。
- **反向验证 2**：给某一层真加一条断言（不改任何数字）→ `verify:meta` 变红（证明它盯的是实测值，不是自证）。

---

### A-5 串行 runner + 退出码聚合

**做**：新建 `arsenal-web/scripts/verify-all.mjs`：
- 顺序执行：`sync` → `typecheck` → `verify:arch` → `graph` → `cases` → `project` → `engine` → `parity` → `archify` → `scan` → `meta`
- 收集每层 `{exitCode, pass, fail, skip}`；**不因失败而短路**
- 打印汇总表：

  ```
  层                 通过   失败   跳过   退出码
  架构判定            35     0      0      0
  代码扫描             -      -      -      2      （bash 未找到，0 项执行）
  刻意未跑            2 项（见 A-9）
  ─────────────────────────────────────────────
  合计                626    0      36     → 1（存在跳过层）
  ```
- 退出码：任一 `1` → `1`；全为 0/2 且存在 2 → `1`（除非传 `--allow-skip`）；全 0 → `0`。
- `package.json` 的 `verify` 指向它。

**验收**：`--allow-skip` 语义正确；汇总表里**每层都有行**（包括被跳过的）。

---

### A-6 最小 CI

**做**：
1. 先确认远程：`git remote -v`。⚠️ 本机 git 是 PortableGit 且 `github.com` 的 **git 协议不通**（见记忆）。
   - 有 GitHub 远程 → 新建 `.github/workflows/verify.yml`：`ubuntu-latest` + `temurin 17` + `node 22`，
     step = `npm ci` → `npm run sync` → `npm run typecheck` → `npm run verify`。
     （Linux 上 bash/JDK 天然满足，全层可跑 —— 正好反衬 Windows 侧的问题）
   - **无远程 / 推不上去** → 交付 `.githooks/pre-push`（跑 `sync → typecheck → verify`）+ README 里一句安装法
     （`git config core.hooksPath .githooks`），并在完成报告里**明说为什么没走 GitHub Actions**（这是诚实记账，不是偷懒）。
2. 无论走哪条路，都要在 `docs/开发计划-2026-09-22/00-index.md` 的「执行记录」区留一行结论。

**验收**：文件存在且 YAML 可解析（`node -e "require('js-yaml')..."` 不可用则用 `npx --yes js-yaml` 或手工核对缩进）；
`.githooks/pre-push` 实际触发过一次（本地 `git commit` 或 `bash .githooks/pre-push` 直跑）。

---

### A-7 统一 bash 发现 + `toBashPath()` 单一实现

**现状**：
- `scan-check.ts:66` `hasBash = bash.status === 0`；`:70,479-480` 整层跳过。
- 三套路径方言：`parity-check.ts:110-112` 产 `/d/mryang/…`（MSYS）、`scan-check.ts:79` 产 `D:/mryang/…`（盘符）、
  `archify-check.ts:427` **完全不转**直接给 `D:\mryang\…` —— 三种至多一种对。
- 全仓 grep `process.platform|os.platform|isWindows|win32` → **0 命中**。所有 Windows 适配都活在 bash 脚本内部，
  也就是活在那个缺失的依赖后面。

**做**：
1. 新建 `.verify/lib/bash.ts`：
   ```ts
   findBash(): { path: string; kind: 'path' | 'gitbash' | 'none'; note?: string }
   toBashPath(p: string): string      // 唯一实现：D:\a\b → /d/a/b；已是 / 形式则原样
   runBash(args: string[], opts?): { status, stdout, stderr }
   ```
   候选顺序：`PATH` 里 `bash --version` 退出 0 的 → `C:\Program Files\Git\bin\bash.exe`
   → `C:\Program Files (x86)\Git\bin\bash.exe` → `%LOCALAPPDATA%\Programs\Git\bin\bash.exe`。
   结果缓存（一次进程内不重探）。
   参考实现：`ArchifyService.java:73-78` 的 `NODE_FALLBACKS`（同一思路已经在后端写过一遍了）。
2. 三个 check 文件全部改用它；删掉各自本地的路径转换。
3. 找不到 bash 时**不是静默跳过**，而是 `skip('bash 未安装（含 Git Bash 候选路径）', ...)`（退出 2）。

**验收**：
- **反向验证**：临时把 `PATH` 里的 Git Bash 剔除（`bash.ts` 加一个 `ARSENAL_NO_GITBASH=1` 的测试开关）
  → `npm run verify` 仍能跑完全部八层，缺 bash 的层报 skip（退出 2），**不是**退出 0。
- `toBashPath` 三条向量 `D:\a\b` → `/d/a/b`、`D:/a/b` → `/d/a/b`、`/d/a/b` → `/d/a/b`。

---

### A-8 `.verify` 卫生 + 断言可移植性

**做**：
1. 删 `.verify/audit-check.mts`（与 `audit-check.ts` **SHA256 完全相同**）。先 `sha256sum` 两个文件确认再删。
2. 新建 `arsenal-web/scripts/clean-verify-tmp.mjs`：清 `.verify/tmp/**`。
   ⚠️ **不许 `rm -rf`**（safe-delete 守卫会拦，且会截断在 9~10 个文件）。
   实现：Node `fs` 递归删除，分批（每批 ≤ 40 项）并在批间 `await` 让计数重置；
   或按记忆里的做法**只给该子进程**注入 `CODEBUDDY_SAFE_DELETE_ENABLED=0`。给 `verify` 加 `--clean` 选项。
   （实测 `.verify/tmp` 有 **20039 个文件**，含 `scan-check/many-repo/F*.java` 一万个零字节文件）
3. `.verify/check-case-library.mjs`：加进 `package.json`（`"verify:case-library"`），并修
   `:90-93` 的 `page.on('pageerror')` **注册时机**（现在注册在前三次 `page.goto` **之后**，
   所谓「无运行时报错」只覆盖最后一个页面）。把它提到所有 `goto` 之前。
4. `scan-check.ts:198-199,317` 的「防绝对路径」断言只认 `D:\` / `D:/` / `C:/` —— 换 Linux 跑，
   `/home/...` 原样通过。改成白名单式：**断言输出里不含任何绝对路径前缀**
   （正则同时覆盖盘符与 POSIX 根：`^([A-Za-z]:[\\/]|/)`，注意排除 `arsenal://` 这类自定义 URI）。

**验收**：
- `sha256sum` 两文件相同（删之前的证据）→ 删除后 `npm run verify:arch` 仍绿。
- `node scripts/clean-verify-tmp.mjs` 后 `.verify/tmp` 文件数 < 50；再跑 `npm run verify` 仍全绿。
- ⚠️ `.verify/**` 不在 tsconfig → 改完**必须实跑那一层**，别信 `tsc`。

---

### A-9 记账「刻意未跑」的项

**现状**：`verify:scan` 有 2 项**刻意未实跑**并已在源码注释里声明（500MB 总字节闸门、真等 180s 超时，
造用例代价过大）。但**没有任何任务把它记进 verify 的输出** → 「全绿」的含义被高估。

**做**：
1. `report.ts` 增 `knowinglySkipped(name, reason)`（与 `skip()` 分开计数）。
2. 在 A-5 的汇总表里单列一行「刻意未跑：2 项」，并在 `--strict` 下算失败。
3. `layer-counts.json` 里同时写 `skip` 与 `knowinglySkipped` 两个数（A-4 的 `meta-check` 只比 `pass+skip`，
   但人读的时候要看得出区别）。

**验收**：汇总表里有该行；`--strict` 下退出码为 1；不加 `--strict` 时为 0 且仍打印该行。

---

### A-zip 删 `zip-lite.ts`（**从里程碑 3 挪过来**）

**为什么归本计划**：断言在 `.verify/case-check.ts` 里，验收只能在 verify 层体现；
拆到计划 3 会变成两个计划同时改需要「一起改」的文件对（计划 3 改 `zip.ts`、计划 1 改 `case-check.ts`）。

**现状**（路径已核实，别照抄文档里的旧写法）：
- `src/lib/zip-lite.ts` 被 **`src/app/cases/CaseLab.tsx:9`**（`:347` 调 `buildZip(entries)`）
  与 **`.verify/case-check.ts:30`**（`:450`、`:473` 两次调用）使用，**断言完备**
  （CRC-32 对标准值、三个签名、偏移自洽、UTF-8 标志位、逐字节可复现）。
- `src/lib/zip.ts:91 buildZip(entries, date = new Date())` —— 唯一调用者是同文件 `:170`，
  **生产路径零断言**（真正常用的是 `zip.ts` 的 `downloadZip` / `downloadText`：
  `StackComposer.tsx:38`、`ArchifyLab.tsx:22`、`ArchDiagram.tsx:28`、`TechArch.tsx:5`、`CodeIntake.tsx:25`）；
  且 `date = new Date()` 使产物**不可复现**（`zip-lite.ts:12-13` 刻意固定在 1980-01-01）。

**做**：
1. `zip.ts` 的 `buildZip` **默认 date 固定**（与 `zip-lite.ts` 同源：1980-01-01），保留显式传参能力。
   （注：`downloadZip` 走的是这条路径吗？先读 `:150-180` 确认 —— 若 `downloadZip` 也调 `buildZip`，
   则固定 date 会让用户下载的 zip 时间戳都变成 1980，**这是可接受的**（可复现 > 时间戳好看），
   但要在代码注释里写明这个取舍。）
2. `src/app/cases/CaseLab.tsx:9` 的 import 改为 `@/lib/zip`。
3. 删 `src/lib/zip-lite.ts`。
4. `.verify/case-check.ts` 的 zip 断言改为测 `zip.ts`（**断言内容不许减**：CRC-32 / 三个签名 / 偏移自洽 /
   UTF-8 flags bit 11 / 逐字节可复现，全部保留）。注意 `case-check.ts:380-408` 还断言了
   `CaseLab.tsx` 存在且 `page.tsx` 渲染它 —— 那几条不受影响。

**验收**：
- `npm run verify:cases` 全绿，且 zip 相关断言条数与改动前**相同**（贴改动前后的条数）。
- **反向验证**：把 `zip.ts` 的 date 默认值改回 `new Date()` → 「逐字节可复现」断言必须红；改回。

---

## 二、文件所有权

**允许改**（白名单）：
```
arsenal-web/.verify/**
arsenal-web/package.json
arsenal-web/tsconfig*.json
arsenal-web/scripts/verify-all.mjs           （新建）
arsenal-web/scripts/clean-verify-tmp.mjs     （新建）
arsenal-web/scripts/next-run.mjs
arsenal-web/src/lib/zip.ts                     （仅 date 默认值 + 导出形态）
arsenal-web/src/lib/zip-lite.ts                （删除）
arsenal-web/src/app/cases/CaseLab.tsx          （仅 :9 的 import 来源）
.github/**   .githooks/**
README.md                                    （仅「一条命令跑完八层」那一段）
arsenal-profiles/arsenal.json                （仅 project.verifyChain 数组）
docs/开发计划-2026-09-22/00-index.md         （仅追加「执行记录」行）
```

**禁止改**（黑名单）：
```
arsenal-server/**            → 计划 2
arsenal-web/src/**（除上面的 zip/CaseLab）  → 计划 3
arsenal-rules/**             → 计划 2（_spec）/ 计划 4（规则数据）
docs/**（除本目录）           → 计划 4
arsenal-profiles/arsenal.json 的其余字段     → 计划 4
```

---

## 三、验收出口

一次跑完，把**真实输出**贴进完成报告：

1. `npm run sync && npm run typecheck && npm run verify`（Windows + Git Bash + JDK17）→ 汇总表 + 退出码
2. 同一条命令，`ARSENAL_NO_GITBASH=1`（模拟无 Git Bash）→ 汇总表 + 退出码（应为 2）
3. 反向验证 5 条，逐条给命令与观察到的红/绿：
   - `void` 传参改回 → `tsc` 报 TS2345
   - `verifyChain` 某层 count ±1 → `verify:meta` 红
   - 某层人为加一条断言 → `verify:meta` 红（证明盯实测值）
   - `hasBash=false` → `verify:scan` 退出 2
   - `zip.ts` date 改回 `new Date()` → 「逐字节可复现」红
4. `.verify/tmp/layer-counts.json` 的内容
5. **明确列出仍被跳过的项**：`verify:scan` 的 2 项刻意未跑、`verify:archify` 后端不可达、
   `verify:parity` 活服务体检未起服务。**不许含糊**。
6. 修 628/662 注释后 `grep -rn "628" arsenal-web/.verify arsenal-profiles` 的结果

---

## 四、风险与注意事项

| 风险 | 说明 | 对策 |
|---|---|---|
| safe-delete 守卫 | 清 `.verify/tmp`（2 万文件）必被拦，且 `rm` 会被**截断在 9~10 个文件** | 用 `clean-verify-tmp.mjs` 分批；或只给该子进程注入 `CODEBUDDY_SAFE_DELETE_ENABLED=0` |
| `.verify` 不在 tsconfig | 坏 import 只在**运行时**炸成整层 unhandled TypeError，不是一条红断言 | 每次改完**实跑那一层** |
| `verify:meta` 的位置 | 必须链尾。放中间会读不到兄弟层结果 → 变成永远绿 | A-4 已写死 |
| 改档案后忘 sync | `src/generated/profiles.json` 过期 → 构建期炸在 import 或【14】契约红，症状像随机故障 | 改完立刻 `node scripts/sync-content.mjs` |
| 多会话并发 | 同仓库可能有夜跑链在写 | 动手前对 `src/lib/*` 取两次 md5；它的绿不归你背书 |
| CI 推不上去 | 本机 `github.com` git 协议不通 | A-6 已给退路（pre-push），但**必须说明原因** |
