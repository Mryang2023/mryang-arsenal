# 棒 2 · 活体解剖最小第一步（跃迁 A）

**日期**：2026-10-13
**代号**：runtime-probe
**体量**：L（开发净 145 min）
**一句话**：把项目真跑起来，把「代码声明」与「运行时现实」逐条对账 —— 每条结论必带两侧证据。

---

## 0. 你在做什么（先读这段）

解剖台现在扫的是**躺着的代码**。本棒让它**站起来跑一次**：

```
facts.code.entryPoints[]（静态声明）        ←──── 对账 ────▶    运行时采集（进程/端口/health）
        每条结论两侧都要有证据：静态 file:line + 运行日志行号
```

对账三问（本棒只做这三问，其余不做）：

| 静态说 | 运行时看 | 对不上 = 什么 |
|---|---|---|
| N 个可运行入口 | 实际起了 M 个进程 | **幽灵进程** / 起了没声明的 |
| 配置 `server.port` | 实际监听端口 | 端口冲突 / 配置没生效 |
| 有 actuator 依赖 | `GET /actuator/health` 的返回 | 声明了健康检查，现实是 DOWN |

**最重要的一条纪律**：采不到就是「未执行 + 原因」，**不许写成「没问题」**。这是本仓 10-04 立起来的铁律（「没检查」和「检查通过」不许长得一样）的运行时版本。

---

## 1. 开工前置：三个探活（10 分钟内做完，决定本棒能走到哪）

| # | 探活 | 命令 | 探不到怎么办 |
|---|---|---|---|
| 1 | `mvn` 在不在 | `export PATH=…; mvn -v; echo "EXIT=$?"` | 降级为「`javac` 编译 + `java -cp` 直跑」，见 §2-B |
| 2 | java 能不能在这台机器上起进程 | **必须单条命令内完成**：`启动 + sleep 13 + curl 探活 + kill` 放同一条 bash（Boot 启动约 5.5s，窗口约 6s） | 起不来 → **本棒核心能力降级**，见 §5 |
| 3 | 3011 后端在不在 | `node -e "fetch('http://localhost:3011/api/stats').then(r=>console.log(r.status))"` | 用 `SKIP_COMPILE=1 bash arsenal-server/scripts/run.sh` 起；**改 Java 必重启** |

> 本环境已知：java 常驻不了（`run.sh` 后台约 35s 静默死，`start-server.mjs` 也没救活）。
> **能用的姿势只有一种**：启动 + sleep + 探活 + kill 写在**同一条** bash 命令里。
> 别试图让它常驻，别改代码去「修」它 —— 那是环境问题不是代码问题。

---

## 2. 分阶段实施

### 阶段 A · 沙箱安全模型（约 45 min，**P0 前置，先于一切**）

新增 `arsenal-server/src/main/java/com/arsenal/autopsy/RunSandbox.java`：

| 约束 | 实现 | 硬要求 |
|---|---|---|
| 墙钟上限 | 默认 90s，可配；超时 kill 进程树 | 超时返回 `TIMEOUT` + 已采到的部分输出，标 `partial` |
| 输出上限 | stdout/stderr 各 1MB，超出截断并记 `TRUNCATED` | 不许 OOM |
| 参数注入 | `ProcessBuilder` **数组参数**，绝不拼 shell 字符串 | 用户路径含空格 / 分号 / 反引号都不许被执行 |
| 工作目录 | 锁在扫描工作副本内，规范化后必须仍在根内（复用既有路径逃逸防护思路） | 路径逃逸 `../../etc` 直接拒绝并报错 |
| 环境变量 | 白名单传递，不传宿主敏感 env | 不许把宿主环境变量整包继承 |
| 网络 | Spring Boot 用 `--server.port=0`（随机端口，不与宿主冲突），从日志解析真实端口 | 不许绑固定端口 |
| 清理 | **采完即杀**：kill 进程树（含子进程） | 跑完必须无残留 java 进程、端口释放 —— 这条有断言 |

**这是执行用户提交的源码** —— 安全模型不是可选项。没建好不许往下做。

### 阶段 B · 运行时采集器（约 40 min）

新增 `RuntimeProbe.java`（或并入 `RunSandbox` 同包），**只对 `runtime: spring-boot` 入口**：

1. 起进程：
   - 有 mvn → `mvn -q spring-boot:run -Dspring-boot.run.arguments=--server.port=0`
   - 无 mvn → `javac` 编到 `target/classes` + `java -cp "<classes>:<deps>" <MainClass> --server.port=0`（依赖从 `.m2` 平铺或从既有 pom 解析）
   - 起不来 → 返回 `not-run` + 真实原因（编译错误 / 缺依赖 / 超时），**不许兜底说「成功」**
2. 采三样（每样都带证据行号）：
   - **启动日志**：抓 `ERROR` / `Exception` / `Caused by` 行（前 20 条）+ 末尾 50 行；解析 `Tomcat started on port(s): 37345 (http)` 得端口
   - **监听端口**：日志解析优先；失败则尝试一次本地 connect 探活（同一条命令内）
   - **health**：`GET http://127.0.0.1:<port>/actuator/health`（classpath 有 actuator 才探；没有 → 标「无 health 端点」，不是「健康」）
3. 采完即杀。

### 阶段 C · 对账层（约 25 min）

新增 `arsenal-web/src/lib/runtime-recon.ts`（**纯函数，与 `service-topo.ts` 同款性质**：零依赖、可单测、渲染器只读它的输出）：

- 输入：`facts.code.entryPoints[]` + 运行时采集结果 → 输出对账结论数组
- 每条结论：`{ kind: 'entry'|'port'|'health', staticEvidence: {file, line}, runtimeEvidence: {logLine|status}, verdict: 'match'|'mismatch'|'not-run', reason }`
- **Java 侧不做判断**（本仓硬约定：判定逻辑只有一份实现，在 TS）。Java 只摊平事实。
- `not-run` 必须带 reason 字符串，前端原样显示。

### 阶段 D · 端点 + 面板（约 25 min）

- 端点 `POST /api/autopsy/run`（同步，硬上限 90s；超时返回 `partial` + 原因）。入参校验在 Controller 里做 —— 本仓 `GlobalExceptionHandler` 会把 404/405/415 吃成 500。
- `/autopsy` **第六页签**「运行时」：对账表（三区：入口 / 端口 / health）→ 采集证据（日志片段折叠）→ 未执行原因清单。
- `stats.truncated` 或采集 `partial` 时顶部亮条（复用服务拓扑面板已有的截断亮条写法，数字用**真实闸门值**不抄旧口径）。

### 阶段 E · 断言（约 10 min）

并入 `verify:scan` 新增组「活体对账」（接在棒 1 之后的最大编号 +1，**先 grep 现编号**）：

1. fixture spring-boot 工程（本棒新建，见下）真跑一次 → 三条对账结论都有两侧证据；
2. **跑完必须死干净**：断言无残留进程 / 端口释放（这是安全红线，不是可选项）；
3. 注入「起不来的工程」（故意编译错）→ 返回 `not-run` + 原因，**面板/JSON 不许出现「健康」「正常」**；
4. 端口被占用 → 报冲突，不许静默成功；
5. 输出上限调到极小 → 输出截断并记 `TRUNCATED`（确认真截断，不是写了没生效）；
6. 路径逃逸入参（`../../etc`）→ 拒绝且报错可读；
7. 同输入两次采集 → 结论逐字段相等（日志时间戳字段除外，若保留时间戳必须显式排除）。

**fixture 工程**（约 15 min，本棒新建）：`.verify/fixtures/runtime-demo/` —— 最小 Spring Boot：`@SpringBootApplication` + 一个 `@RestController` + actuator 依赖。不要引数据库、不要引 Redis（本环境没有，且它们会让启动不可控）。

---

## 3. 验收标准

1. 对 fixture 跑一次 → 入口数对上、端口解析到真实端口、health 返回 UP（或有 actuator 但 DOWN 也如实报）。
2. 对**军火库自身**跑一次（自证）：预期「1 个可运行入口（spring-boot）」，看能不能真起来 —— **起不来也是合法结论**，只要如实写原因。
3. 进程清理断言通过（无残留）。
4. 反着验 ≥2 处（§2-E 的第 3、4 条各算一处），注入 → 红 → 还原 → 绿。
5. `npm run verify:scan` 全绿 + 数字同步四处（见棒 1 §5 的四处，同一套）。
6. 页面（若做了）逐句读「N 个…」措辞。

---

## 4. 降级路径（**本棒最大的风险，写死在这里**）

| 情况 | 处置 |
|---|---|
| `mvn` 不在 | 走 `javac` + `java -cp` 路线；若依赖解析不出来 → **降级为「只对无需外部依赖的 fixture 生效」**，如实记入 `02-done.json` 的「降级处理的」 |
| java 起不来（探活 2 失败） | **不许硬造**。采集器保留完整实现（可编译、可单测），但验收降级为「单元级：对账纯函数 + 沙箱参数校验有断言覆盖，真跑部分环境不支持」；面板显示「运行时采集未执行 —— 原因：本环境无法起进程」。**把原因写进报告，不要写「功能已完成」** |
| 采不到 health（无 actuator） | 标「无 health 端点」，不是「健康」 |
| 时间不够 | 保 A（沙箱）+ B（采集）+ E 的断言 1/2/3/6；**页面与端点可以砍**（CLI/JSON 可核对即可），如实记账 |

---

## 5. 本棒专属雷区

- **不许把「没采到」写成「没问题」** —— 本仓 10-04 铁律。`not-run` 要有 reason，前端原样展示。
- **判定逻辑只有一份实现（TS）** —— Java 只摊平事实，不许在对账上写第二份判断（10-04 硬约定 18）。
- **改 Java 必须重启 3011** 才生效；全量验证前先探活。
- **棒 1 已经改过 `/autopsy` 的 `AutopsyLab.tsx`（加了第五页签「生命体征」）** —— 你开工先读它的 `01-done.json` 的「给下一棒的话」，你的页签是**第六**，别覆盖它的改动；同一文件多处改动必须串行（并行 Edit 静默丢改）。
- **`spawnSync(process.execPath, …)` 在本环境可能返回 EBUSY** —— 看到先探活再判断，**别急着改代码**（10-13 实测它是瞬时态）。
- **本仓没有 Chrome**，视觉验收要用 `ARSENAL_CHROME="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"`。
- 新增页签**不新增路由** → `visual/shoot.mjs` 的 EXPECTED（按路由计数）不受影响；若你意外新增了路由，必须同步三处并重跑。
- **不许 push**，只 commit。
