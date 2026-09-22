# 项目附录

每个项目一节。**编排时把对应节的内容原样复制进 `NIGHT-RUN.md` 与每一棒 prompt。**
漏一条，那一棒就废了 —— 不要嫌啰嗦。

新增项目时，按下面的骨架补一节：工作目录 / 技术栈 / 事实源链路 / 环境备忘 / 项目铁律 /
验证分层与同步点 / 收尾命令。

---

## arsenal（`D:\workspace\2026\mryang-arsenal`）

杨先生的军火库：个人代码规范字典 + AI 合规校验平台。
计划文件夹惯例：`docs\hy4-night-plans\`；状态目录：`.workbuddy\night-chain\`。

### 技术栈与数据流

- 前端 `arsenal-web\`：Next.js 静态导出，**运行时依赖只有 `next / react / react-dom`**
- 后端 `arsenal-server\`：Spring Boot（JDK 17）
- 内容生成器 `tools\`

数据流（**这是全项目的骨架**）：

```
tools\content\*.py            ← 唯一事实源，只改这里
  → python tools\build-content.py        ← 生成器 + 硬闸门（供需闭合 / 画布登记 / 图标命中）
    → arsenal-*/<事实源>.json            ← 落盘的事实
      → node arsenal-web\scripts\sync-content.mjs   ← 形状闸门 + 锚点校验（失败即 exit 1）
        → arsenal-web\src\generated\*.json          ← 前端消费
```

**闸门中断是在救你，别绕过去。**

### 环境备忘（每棒 prompt 必带）

- **bash 的 PATH 是坏的**，每条命令前必须：
  `export PATH="/usr/bin:/bin:/c/Windows/System32:/c/Windows:$PATH"`
  不加则 `ls` / `dirname` / `head` 全部 command not found（shell shim 自己先报错）。已实测有效。
- node：`C:\Users\Administrator\.workbuddy\binaries\node\versions\22.22.2-3\node.exe`
- python：`C:\Users\Administrator\.workbuddy\binaries\python\versions\3.13.12\python.exe`
- JDK17：`C:/Users/Administrator/.jdks/corretto-17.0.12`

### 项目铁律（每棒 prompt 必带）

1. **事实源只能是 `tools\content\*.py`。** 改完必跑
   `python tools\build-content.py` → `node arsenal-web\scripts\sync-content.mjs`。
2. **写 JSON 一律 `newline='\n'`**（生成器里已有 `write_json`，照抄），
   否则整份文件变「CRLF 假变更」。
3. **verify 数字要同步四处**：
   - `arsenal-profiles\arsenal.json` → `project.verifyChain`
   - `arsenal-web\.verify\project-check.ts` 手写总数常数
   - `README.md` 总数句
   - `README.md` 分项表
   改完 `arsenal.json` **必须重跑 `sync-content.mjs` 才生效**（第一次夜跑第 2 棒踩过）。
4. **零外部依赖是硬约束。** 不许引入图标库 / 动画库 / 图表库 / 滑杆库 / 绘图库。
5. **调试产物写 `.workbuddy\_*` 或 `arsenal-web\.workbuddy\_*`，用完即删。**
6. **新模块必须登记进生成器**（如 `tools\build-content.py` 的 `STACK_MODULES`）——
   漏了等于没写。
7. **方案里引用的规则 id 必须去 `arsenal-rules\` 查**，不许照抄方案示例
   （第一次夜跑第 3 棒发现方案示例里的 id 是编的）。

### 验证分层与收尾命令

```bash
export PATH="/usr/bin:/bin:/c/Windows/System32:/c/Windows:$PATH"
cd /d/workspace/2026/mryang-arsenal/arsenal-web
npm run build        # 静态导出
npm run verify       # 八层全量（preverify 会自动跑 sync）
bash ../arsenal-server/scripts/compile-check.sh   # 后端编译检查（改动后端时）
```

八层基线（2026-09-22 实测 **620 项全绿**）：

| 层 | 项数 | 说明 |
|---|---|---|
| `verify:arch` | 35 | 架构判定 |
| `verify:graph` | 59 | 图与交互 |
| `verify:cases` | 25 | 场景案例 |
| `verify:project` | 406 | 结构与导出（含导航契约【13】、图标【11】、扫描映射【15】） |
| `verify:engine` | 17 | 引擎样本 |
| `verify:parity` | 12 | 前后端一致性（需起后端） |
| `verify:archify` | 31 | Archify 出图链路（需起后端） |
| `verify:scan` | 35 | 代码扫描（需 JDK17） |

> 已知现象：单次会话内累计删除操作达阈值后，`build` 与 `parity` 的清理步骤会被沙箱守卫拦截。
> 那是环境问题不是代码问题，换个新会话即恢复正常。报告里要写清"哪一层被拦"。

### 当前遗留（2026-09-22 夜跑后）

详见 `.workbuddy\night-chain\REVIEW.md` §六。P0 两条：
1. `facts → 图` 的三张链路全为零（阻塞点：`CanvasTheme` 只有 `dark/light`，缺 `doc/slide/blueprint` 三态）
2. 装配台 UI 零改动（`topology.ts` 引擎已能算副本数，但没有页面消费）
