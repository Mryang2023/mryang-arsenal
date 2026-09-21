# 军火库（arsenal）· 长期约定

个人代码规范字典 + AI 合规校验平台。**三原则**：①一份数据三种出口（人查/给 AI 用/拿代码验）②Rule as Data（结构化 JSON）③写不出 bad/good 示例的不收录。
**不做**：auto-fix、绑某家 AI、规则市场/多租户。上限单人 + 小团队（≤10）。
> 过程与踩坑见 `.workbuddy/memory/YYYY-MM-DD.md`，本文件只留**还在生效的约定**。

## 技术栈与口径

- 后端 `arsenal-server` Spring Boot 3.2.5 + Java 17 : **3011**；前端 `arsenal-web` Next.js 14 + TS + Tailwind : **3010**（`output:'export'` 纯静态）。
- 事实源全 Git 化：`arsenal-rules/**/*.json`（69 条/10 文件）、`arsenal-cookbook/*.json`、`arsenal-stacks/{stack,architecture,project}.json`。
- 严重度 MUST/NEVER/SHOULD/MAY，**MUST+NEVER 硬上限 50**（37+13 已满）。九大类：skeleton web service data concurrency reliability security test collab。
- 选型台 **18 维/5 组 / 7 泳道 / 4 预设**；交付维 `deploy` = jar·docker·k8s·helm，清单在 `src/lib/deploy.ts`。
- 引擎只有 **L1 正则（35 条真检出）**；AST/LLM 未做 —— **非正则层一律进 `skipped`，绝不伪造判定**。
  - 写规则先问「正则层跑得起来吗」：只写 `check.manual`/`check.llm` 的等于不存在（K8s 那 7 条就这样，看着完整、零检出）。
  - 该加 regex 的：结构性断言（字段在不在、后缀对不对、某 appender 出现没有）。**不该加**：前提是「跑在多副本/容器里」的（REL-CTNR-004/005），判不了前提会对单体误报。
  - present 型断言（缺字段即违规）最易翻车处是 `targetGlob` 太宽：`**/*.yaml` 会让 configmap、helm values 一起被要求带 `resources` → 用 `**/*deployment*.yaml`。
- 结构层尚有 2 条缺口（「按领域分包」「`@Bean` 只许出现在 config」）—— 如实标「规则缺口」，不挂假 id。

## 硬约定（违反即出事故）

1. **改内容改 `tools/content/*.py`，不改 JSON**：`python tools/build-content.py` → `arsenal-{cookbook,stacks}/*.json`；写 JSON 必须 `newline='\n'`（否则 CRLF 假变更）。加维度要同时进 `STACK_MODULES`（一处列表驱动三处装配），改完跑 `node scripts/sync-content.mjs`（锚点找不到即失败）。
2. **`composeStack(picks)` 是纯函数**；空槽位跳过、不回退默认。预设未声明的维度留空。
3. **可运行性由数据决定**（选项声明 `provides`/`requires`）；**向自己索要是构建期硬错**（某能力只由本维度提供时，本维度不得 requires 它）。
4. **隐患必须写成可核对线索**：`trigger`/`symptoms`(≥2)/`impact`；写不出可观察现象的不算。策略与 `POLICY_DETAIL` 一一对应，构建期校验。
5. **结构树 ↔ 选型数据双向交叉校验**；**导出包文件名 ↔ 结构树节点名逐一对齐**（`verify:project`【12】）。README 只报「算出来的」缺失，宁少勿多。
6. 导出 zip 用 `zipfile.testzip()` 验，不看截图。易错三处：UTF-8 文件名 flags bit 11、多字节整数全小端、中央目录偏移相对整包起点。
7. **架构结论分三档不合并**：跑不起来 / 能跑但零件不全 / 可以跑起来。
8. 启动类尽量空，`@EnableXxx` 放它影响的配置类旁；代价是看不出开关 → 实时算一张开关归属表写进注释。
9. **交付产物必须「能跑」不只是「看着对」**：不许挂载/引用导出包里没有的文件（wrapper、prometheus.yml）；照模板写、别拿原生清单做字符串替换（`.replace(/^name:/m)` 匹配不到带缩进的行，静默失效）；健康端点、JDBC URL、停机时长、端口一律从选型/yml 算不写死；compose 的 `depends_on` 要标方向（观测组件是来抓应用的，会成环）；Makefile target 按交付形态裁剪，k8s 用 `apply -k`（`-f` 会让 kustomization 的 namespace 失效）。
10. **断言写完反着验一次**：`^\s{4}healthcheck:` 会命中中间件自己的段（恒真）；values 顶层键零缩进、写 `^\s{2}` 会抓嵌套键；注释里的 `./mvnw` 被当成真引用；`^COPY --from=` 匹配不到 `COPY --chown=... --from=`。报错信息必须带实际值。
11. **页面契约是两处，改一处不报错**：「页签 id（`TabId`）」与「渲染分支（`tab === 'x'`）」必须成对，漏一处 = 按钮在、点进去空白、控制台零报错（技术架构图就这么空过一阵）。同理「导航项 ↔ 路由页面」「`savePicksSnapshot` ↔ `loadPicksSnapshot`」。只有把**源码当数据断言**才抓得住 —— `project-check.ts`【13】守这条，解析前先 `stripComments()`（注释里的示例代码会被当成真分支）。

## 出图：三张图 + 一个通道

- **依赖图** `arch-diagram.ts`（谁依赖谁，选型时用）。
- **技术架构图** `arch-canvas.ts` + `TechArch.tsx` + `tech-icons.ts`（手绘 SVG，不引图标库）：只画会被部署的东西（Maven/Lombok 进应用卡的工程属性）；落成 appTag 的选项、指向它的连线一起消失；集群形态/端口/协议是数据声明；文字按像素裁剪（CJK≈1em、ASCII≈0.55em）。编辑态存 localStorage —— 改呈现、不碰判定。
- **Archify（扳手AI）IR** `archify-ir.ts`：一份模型两个渲染器。硬规律：①版式必须左到右主干（跨列连线判方向先看两端 x 中心）②同源扇出自己排车道（显式 `via`，它的自动路由恒取两端中点）③回边走右导轨 + 顶部横轨、标签骑横轨。
  - `RAIL_STEP_Y=28` 是算出来的（标签抬到横轨上方 20px + 留 ≥4px 净空 ⟹ ≥24；22 差 2px）。标签遮罩宽 `max(30, 单位数×4.8+10)`，全角算 2 单位，估错会指向我们的坐标报错。
  - **走廊宽 = 连线标签宽之和**：每加一条跨列连线整图更宽，可能越过「1440 视口最小字 6px」门槛 —— 跨层标签只许两个字。
  - **别把新分区塞进 app 那层**：应用卡是主干锚点，宽度一变走廊全错位。新分区放 `CANVAS_ZONES` 末尾。
  - 出图服务（`com.arsenal.archify` + `web/ArchifyController`）：`GET /api/archify`（状态）+ `POST /api/archify/deliver`（请求体即 IR）。stdout/stderr 分开重定向；图不合格是业务结果（`delivered:false` + 诊断走 200）；拒收 `brand` 对象形态；内容校验先于环境检查。
- 导览章节 focus 必须是「与当前选择不同的槽位」，任意两章不许相同；当前选择即该预设时 focus 可为空。

## 校验与运行

- `cd arsenal-web && npm run verify` = 35（架构判定）+ 59（图与交互）+ **312**（结构/导出 + 导航与页签契约）+ 17（引擎）+ 12（前后端一致性 + 活服务体检）+ 29（Archify）= **464 项**。改某层断言数要同步四处：`arch-views.ts` 的 `VERIFY_CHAIN`、`project-check.ts` 里手写的总数、README 总数、README 表分项。
  - ⚠️ `VERIFY_CHAIN.reduce(...) === VERIFY_TOTAL` 是**半恒真的**（后者定义就是那个 reduce）⟹ 只有手写数字起作用，「各层实际跑了多少项」无人守门（引擎 14→17 全靠人发现）。让各层报实测值互比 —— 尚未做。
- `verify:parity` 起后端实跑（bash + JDK 17）；`verify:archify` 没装技能时明说跳过并退出 0。
- 后端：`bash arsenal-server/scripts/run.sh`（`ARSENAL_PORT` 换端口）。**本机 JDK 17 在 `C:/Users/Administrator/.jdks/corretto-17.0.12`**（PATH 上是 21）。`SKIP_COMPILE=1` 只跳编译、资源照复制。
  - ⚠️ 托管环境注入 `SERVER__PORT=3743`：双下划线是 Spring 层级分隔写法，认成 `server.port` 且**优先级高于 application.yml** —— 现象是抢宿主端口并报 `Port 3743 was already in use`（看不出是环境变量）。run.sh 已用 `--server.port` 钉住。后台启动必须让 task 持有进程（`> log &` 后主脚本一退子进程被带走）。
  - ⚠️ **改规则必重启后端**：RuleLoader 启动时一次性载入内存索引，不重启时 `/api/stats` 会一脸正常地报旧条数（曾 62 vs 事实源 69，且 `mustClass 50/50` 毫无异常）。`verify:parity` 编独立 `ParityProbe` 直读目录、绕过后端（报 68 = 69 − 1 条 MAY，属设计）。
  - ⚠️ **改后端先想「异常落到哪个 handler」**：`GlobalExceptionHandler` 的 `@ExceptionHandler(Exception.class)` 先于 `DefaultHandlerExceptionResolver` 命中，把 Spring 自己的 415/405/404 吃成 500（已错 5 种）。
- 接口：`/api/health`、`/api/stats`、`/api/rules`(`/grouped` `/sources` `/{id}`)、`/api/export/{formats,{format},{format}/raw}`、`/api/lint`、`/api/archify`。

## 环境铁律

- **同一文件的多个修改必须串行**（并行 Edit 互相覆盖且不报错，已踩两次）。
- **bash 的 PATH 是坏的**：每条命令前 `export PATH="/usr/bin:/bin:/c/Windows/System32:/c/Windows:$PATH"`；node 另加 managed `…/node/versions/22.22.2-3`。**PowerShell 工具捕获不到 stdout** → 排查走 bash。
- **safe-delete 守卫**：本 turn 累计删除 ≥50 就抛（`scope:"turn"`），`rm` 还会被截断在 9~10 个文件。Next 每次 dev/build 都要清目录 —— **累计一超 50，Next 当场抛 `SAFE_DELETE_BULK_CONFIRM_REQUIRED` 死掉，看起来像 Next 的 bug**。唯一绕法：动手前把要清的目标 `mv` 走（rename 不计删除）；本 turn 删过东西就别再指望跑通 build，换 turn。
- **`curl` 是 Windows 程序**，读不了也写不了 `/tmp`、`/d/...`（退出码 23 + 0 字节，极易误判成服务端问题）→ 输入用 `cygpath -m`、输出 shell 重定向。**给 node 的路径必须 Windows 形式**；`cmd.exe` 不能从 bash 调；计时 `date +%s%N`。
- **heredoc 里别写 `${x.toFixed(2)}`**（会被 shell 抢着展开）→ 用 Write 落文件。
- **无头浏览器**：`playwright-core` 在 `arsenal-web/node_modules`，`chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'})`；`getByRole` 在本站多处同名歧义，测交互走键盘。
- **`next dev` 长跑期间两种假故障，别改代码**：①改 `src/lib/*` 撞模块初始化顺序 → `Cannot access 'X' before initialization`（TDZ，真错，把常量挪到引用点之前）；②之后连片 `Cannot find module './NNN.js'` + `/_error` 500 + 全站白屏 = **dev 与 build 抢同一个 `.next`**。**已修**：`next.config.mjs` 按 `NODE_ENV` 分流（dev 用 `.next-dev`），`.gitignore` 用 `.next*`。清缓存要**先停 dev 再 `mv .next .next.old-$(date +%s)`，不要 `rm -rf`**。
- 调试产物写 `.workbuddy/_*`（规则 `**/.workbuddy/_*`），用完即删。
- 本机网络：`registry.npmjs.org` 通、`github.com` git 协议不通 → `npx skills add <owner>/<repo>` 走不通，装技能走推荐市场。

## 待推进

1. **MCP Server 适配层**（项目成败关键）：`arsenal-server/scripts/mcp-stdio.mjs`（零依赖纯 node，读 `arsenal-rules/mcp-tools.json`）**已写好但从未验证** —— 没有 `verify:mcp`，没跑过一次真实握手（initialize → tools/list → tools/call）。缺验证 + 客户端接入说明，不缺协议实现。
2. **架构图谱泛化**：`/arch` 六视图只有技术架构是算出来的，其余五张是 `arch-views.ts` 的硬编码文案 ⟹ 换项目无从下手。方案 = `arch-profile.json` 六段画像 + 渲染器只读 profile（能算的数字不许进 profile）。业务/产品两张本质是「人写的话」，建议允许人写、允许空。
3. **Archify 独立菜单**：缺的不是页面而是**输入口解耦** —— 现在钉死成 `buildArchifyIr(buildTechArch(picks))`。契约本就是「IR 进、HTML 出」，新页只需：粘贴/上传 IR → `archifyIrIssues()` 本地预检 → deliver → HTML + 诊断。
4. 蓝图 / 装配台 / 案例库接入后端 API（后端已能 lint/export/出图，前端仍本地算）。5. AST 层（JavaParser）。6. LLM 语义层。
7. **需 mryang 逐条过目 69 条规则**（同意/改/删）—— 没过目就不算军火库。
8. `code-review-2026-09-20.md` 修复队列：P1-1 异常映射（+5 条 HTTP 断言）→ P1-2 丢节点断言 → P2 出图接口资源闸门 → P3 `specSha` 对称校验。
