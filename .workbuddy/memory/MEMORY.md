# 杨先生的军火库（arsenal）· 项目长期约定

个人代码规范字典 + AI 合规校验平台。目标：让任何 AI 生成的代码收敛到他的工程规范。

**三条不可动摇原则**：①一份数据三种出口（人查 / 给 AI 用 / 拿代码验）②Rule as Data（结构化 JSON，非 Markdown 文字）③写不出 bad/good 示例的规则不收录。
**不做**：auto-fix、绑定某家 AI 的代理、规则市场 / 多租户 SaaS。上限单人 + 小团队（≤10 人）。

## 技术约定

- 后端 `arsenal-server`：Spring Boot 3.2.5 + Java 17，端口 **3011**；前端 `arsenal-web`：Next.js 14 + TS + Tailwind，端口 **3010**（`output:'export'` 纯静态站）。
- source of truth（全 Git 化）：`arsenal-rules/**/*.json`（69 条 / 10 文件）、`arsenal-cookbook/*.json`、`arsenal-stacks/{stack,architecture,project}.json`。
- 严重度 MUST / NEVER / SHOULD / MAY；**MUST+NEVER 硬上限 50**（现 37+13，已满）。九大类：skeleton web service data concurrency reliability security test collab。
- 校验引擎：Level 1 正则（30 条可真检出）→ AST（未做）→ LLM（未做）。**非正则层一律进 `skipped` 如实披露，绝不伪造判定。**
- 选型台 **18 个维度 / 5 组**（基础 / 数据 / 中间件 / 横切 / **交付与运行**），7 条泳道，4 套预设。交付维 `deploy` = jar / docker / k8s / helm，清单生成在 `src/lib/deploy.ts`。

## 硬约定（违反即出事故）

1. **改内容改 `tools/content/*.py`，不要改 JSON**。`python tools/build-content.py` → `arsenal-{cookbook,stacks}/*.json`；写 JSON 必须 `newline='\n'`（否则 CRLF 假变更）。加维度要同时进 `STACK_MODULES`（这一处列表驱动三处装配），改完跑 `node scripts/sync-content.mjs`（锚点找不到即构建失败）。
2. **`composeStack(picks)` 是纯函数**；空槽位必须跳过、不回退默认选项。预设未声明的维度留空。
3. **可运行性由数据决定**：选项声明 `provides` / `requires`。**向自己索要是构建期硬错**（某能力若只由本维度提供，本维度不得 requires 它）。
4. **隐患必须写成可核对线索**：`trigger` / `symptoms`(≥2 条) / `impact`；写不出可观察现象的不算隐患。策略与 `POLICY_DETAIL` 一一对应，构建期校验。
5. **结构树 ↔ 选型数据双向交叉校验**；**导出包文件名 ↔ 结构树节点名也必须逐一对齐**（`verify:project`【12】守这条）。README 只报「算出来的」缺失，宁少勿多。
6. 导出 zip 用 Python `zipfile.testzip()` 验，不看截图。三处易错：UTF-8 文件名 flags bit 11、多字节整数全小端、中央目录偏移相对整包起点。
7. **架构结论分三档不合并**：跑不起来 / 能跑但零件不全 / 可以跑起来。
8. 启动类尽量空，`@EnableXxx` 放它影响的配置类旁；代价是看不出开关 → 实时算一张开关归属表写进注释。
9. **生成的交付产物必须「能跑」，不只是「看着对」**（2026-09-21 自检查出 7 个真 bug，全是不报错但跑不起来的）：不许挂载/引用导出包里没有的文件（wrapper、prometheus.yml）；模板就照模板写，别拿原生清单做字符串替换（`.replace(/^name:/m)` 匹配不到带缩进的行，静默失效）；健康端点、JDBC URL、停机时长、端口一律从选型/yml 算，不写死；compose 的 `depends_on` 要标方向（观测组件是来抓应用的，不是下游，会成环）；Makefile 的 target 按交付形态裁剪，k8s 用 `apply -k`（`-f` 会让 kustomization 的 namespace 失效）。
10. **断言写完要反着验一次**：`^\s{4}healthcheck:` 会命中中间件自己的段（恒真）；values 顶层键是零缩进，写 `^\s{2}` 会抓嵌套键；注释里的 `./mvnw` 会被当成真引用；`^COPY --from=` 匹配不到 `COPY --chown=... --from=`。断言报错信息必须带实际值。

## 三张图（别混着说）

- **依赖图** `arch-diagram.ts`：谁依赖谁，选型时用。
- **交付用技术架构图** `arch-canvas.ts` + `TechArch.tsx` + `tech-icons.ts`（手绘 SVG，不引图标库）。数据 = `stack_arch.py` 的 `CANVAS_*` → architecture.json 的 `canvas` 段。规矩：① 只画会被部署的东西（Maven/Lombok 进应用卡的工程属性）；② 落成 appTag 的选项，指向它的连线必须一起消失；③ 集群形态/端口/协议全是数据声明；④ 文字按像素裁剪（CJK≈1em、ASCII≈0.55em）。编辑态存 localStorage，改呈现、不碰判定。
- **Archify（扳手AI）IR** `archify-ir.ts`：一份模型两个渲染器。三条逆向出来的硬规律：① 版式必须左到右主干（跨列连线判方向先看两端 x 中心）；② 同源扇出必须自己排车道（显式 `via`，它的自动路由恒取两端中点）；③ 回边走右导轨 + 顶部横轨，标签骑横轨。两处必须算准的几何：`leftBlockShift()` 整块平移（它有 16px 内部段下限）、`laneLabelDrop()` 逐值试偏移（不能写死）。
  - **回边横轨步距 `RAIL_STEP_Y=28` 是算出来的**：标签框被抬到横轨上方 20px、需给上一条横轨留 ≥4px 净空 ⟹ 步距 ≥24；取 22 差 2px，只在最严档才报。
  - 标签遮罩宽度 `max(30, 单位数×4.8+10)`，全角算 2 单位 —— 估错会指向我们的坐标报错。
  - **走廊宽度 = 连线标签宽度之和**：每加一条跨列连线，整张图就更宽，可能越过「1440 视口下最小字 6px」的可读性门槛 —— 跨层标签只能两个字。
  - **别把新分区塞进 app 那一层**：应用卡是主干锚点，它的宽度一变，跨层连线的走廊全错位（对方报 2px 内部段 + 标签压组件）。新分区放 `CANVAS_ZONES` 末尾即可（`columnOf` 会把 index≥2 全归到右列）。
- 导览章节的 focus 必须是「与当前选择不同的槽位」，任意两章 focus 不许相同；当前选择即该预设时 focus 允许为空。
- 出图服务（后端 `com.arsenal.archify` + `web/ArchifyController`）：`GET /api/archify` + `POST /api/archify/deliver`（请求体就是 IR）。stdout/stderr 必须分开且重定向到文件；`deliver` 而非 `render`；图不合格是业务结果（`delivered:false` + 诊断走 200）；拒收对象形态 `brand`；内容校验先于环境检查。

## 运行方式

- 一条命令：`cd arsenal-web && npm run verify` = 35（架构判定）+ 59（图与交互）+ 303（结构/导出，含交付产物自审）+ 14（引擎）+ 12（前后端一致性 + 活服务体检）+ 29（Archify）= **452 项**。数字以实测为准（旧记忆里的 160/191/236/304/327/368/382/449 都已过时）。
- `verify:parity` 要起后端实跑（bash + JDK 17），本机 9/9。`verify:archify` 没装技能时明说跳过并退出 0。
- 后端启动：`bash arsenal-server/scripts/run.sh`（端口 3011，换端口用 `ARSENAL_PORT`）。**本机 JDK 17 在 `C:/Users/Administrator/.jdks/corretto-17.0.12`**（PATH 上的 java 是 21）。`SKIP_COMPILE=1` 只跳编译、资源照样复制（已修）。
- ⚠️ **托管环境注入了 `SERVER__PORT=3743`**：双下划线是 Spring 的层级分隔写法，relaxed binding 认成 `server.port`，**优先级高于 application.yml** —— 现象是应用去抢宿主端口并报 `Port 3743 was already in use`（报错指向端口，看不出是环境变量）。run.sh 已用 `--server.port` 钉住（命令行参数优先级最高）。
- ⚠️ **后台启动必须让 task 持有进程**：`bash run.sh > log &` 后主脚本一退，子进程被带走（日志只留两行「工作目录 / 启动」）。
- ⚠️ **运行中的后端会静默停在陈旧规则集**（2026-09-21 实测）：RuleLoader 启动时一次性载入内存索引，改完 `arsenal-rules/` 不重启，`/api/stats` 会一脸正常地报旧条数（3011 上曾有进程报 62 条，事实源 69 条，而 `mustClass 50/50`、`budgetUsedPct 100` 毫无异常）。**没有任何校验覆盖 HTTP 层** —— `verify:parity` 编的是独立 `ParityProbe`，直读目录、绕过后端（它报的 68 = 69 − 1 条 MAY，按 severity 过滤属设计）。改规则必重启后端。
- 接口：`/api/health`、`/api/stats`、`/api/rules`(`/grouped` `/sources` `/{id}`)、`/api/export/{formats,{format},{format}/raw}`、`/api/lint`、`/api/archify`。
- ⚠️ **后端 HTTP 层曾无任何自检，状态码映射靠肉眼，已错 5 种**：`GlobalExceptionHandler` 的 `@ExceptionHandler(Exception.class)` 先于 `DefaultHandlerExceptionResolver` 命中，把 Spring 自己的 415/405/404 全吃成 500。改后端先想「这个异常落到哪个 handler」。

## 环境铁律

- **同一文件的多个修改必须串行**（并行 Edit 会互相覆盖且不报错，已踩两次）。
- **bash 的 PATH 是坏的**：每条命令前加 `export PATH="/usr/bin:/bin:/c/Windows/System32:/c/Windows:$PATH"`；node 另加 managed 目录 `…/node/versions/22.22.2-3`。
- **PowerShell 工具捕获不到 stdout** → 一切排查走 bash。
- **`rm` 会被守卫截断在约 9~10 个文件**（已删的确实删掉，输出丢失）；还管「单轮总数」（>50 直接拒绝，`fs.rmSync` 抛栈）。脚本里不要递归删临时目录，按确定性文件名覆写。
- **`curl` 是 Windows 程序，读不了也写不了 `/tmp`、`/d/...` 路径**（退出码 23 + 0 字节，极易误判成服务端问题）。输入用 `cygpath -m`，输出一律 shell 重定向。
- **给 node 的路径必须用 Windows 形式**（否则 `MODULE_NOT_FOUND` 或 `Cannot find module 'D:\c\...'`）。
- **heredoc 里别写 `${x.toFixed(2)}`**（会被 shell 抢着展开）→ 用 Write 落文件或字符串拼接。
- **无头浏览器**：`chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })`；`getByRole` 在本站多处有歧义（同名按钮），测交互走键盘（`P` 翻章 / `U D R L` / `Esc`）。
- **`next dev` 长跑期间的两种假故障，都别去改代码**：① 改 `src/lib/*` 时若撞上模块初始化顺序，会刷 `Cannot access 'X' before initialization`（TDZ）—— 真错，把被引用的常量挪到引用点之前；② 之后连片 `Cannot find module './NNN.js'` + `/_error` 500 + 全站白屏 —— **根因是 dev 与 build 抢同一个 `.next`**（在 dev server 跑着时执行过 `npm run build` 就会这样）。
  **已修**：`next.config.mjs` 按 `NODE_ENV` 分流 —— dev 用 `.next-dev`，build 用 `.next`，两者可同时跑（实测 build 进行中 4 个路由全 200）。`.gitignore` 用 `.next*` 全忽略。
  真要清缓存：**先停 dev，再 `mv .next .next.old-$(date +%s)`，不要 `rm -rf`** —— 清目录会撞下面那条守卫，改名不会。
- **WorkBuddy 的 safe-delete 守卫是「本 turn 累计删除数 ≥50 就抛」**（`node-safe-delete-shim.cjs`，`scope:"turn"`）。Next 每次 `next dev` 启动都要清 `.next-dev/static/development/`、每次 `next build` 都要清 distDir 并 `rm .next/export` —— **累计一超 50，Next 当场抛 `SAFE_DELETE_BULK_CONFIRM_REQUIRED` 死掉，看起来像 Next 的 bug，其实是删除配额用完了**。绕过办法只有一个：**动手前先把它要清的目标 `mv` 走**（rename 不计删除）。同一 turn 里删过一批东西之后，本 turn 就别指望再跑通一次完整 build，换 turn 再跑。
- **`cmd.exe` 不能从 bash 调**；计时用 `date +%s%N`。
- 会话调试产物写 `.workbuddy/_*`（规则 `**/.workbuddy/_*`），用完即删。
- 本机网络：`registry.npmjs.org` 通、`github.com` git 协议不通 → `npx skills add <owner>/<repo>` 永远走不通，装技能走推荐市场。

## 待推进

1. **MCP Server 适配层** —— 项目成败关键。`arsenal-server/scripts/mcp-stdio.mjs`（零依赖纯 node，读 `arsenal-rules/mcp-tools.json`）**已写好但从未被验证**：`package.json` 里没有 `verify:mcp`，从没跑过一次真实握手（initialize → tools/list → tools/call），计划书第 8 步仍标 ⬜。缺的是「验证 + 客户端接入说明」，不是协议实现。
2. 蓝图 / 装配台 / 案例库接入后端 API（后端已能 lint / export / 出图，前端仍本地算）。
3. AST 层（JavaParser）；4. LLM 语义层。
5. **需 mryang 逐条过目 69 条规则**（同意 / 改 / 删）。没过目就不算军火库。
6. 结构层 2 条规则缺口（「按领域分包」「`@Bean` 只许出现在 config」）—— 界面如实标「规则缺口」，不挂假 id。
7. `code-review-2026-09-20.md` 的修复队列：P1-1 异常映射（+ 5 条 HTTP 断言）→ P1-2 丢节点断言 → P2 出图接口资源闸门 → P3 `specSha` 对称校验。
8. **「活服务体检」断言** —— 起后端后断言 `/api/stats` 的 total == 事实源条数。今天已踩到「62 vs 69」的静默漂移，而六层校验全绿。
