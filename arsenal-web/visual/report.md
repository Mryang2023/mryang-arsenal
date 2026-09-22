# V-1 截图矩阵 · 人读报告

- 生成时间：2026-09-22T16:41:33.762Z
- 站点：`http://127.0.0.1:3021`（静态导出 `out/`，深色单主题）
- 矩阵：15 个 URL × 3 个视口 = **45 张**
- 截图范围：`viewport`（视口尺寸 —— 整页图在长页上完全不可判读，见脚本里 FULL_PAGE 的注释）
- 折叠线以下：由 `metrics.scrollHeight` 与越界元素清单量化；像素级逐段判读归 V-6/V-3，**本棒未做**

## 闸门

两档：**意外**失败让退出码变 1；**已申报基线**只计数、只打印，`--strict` 可让它们照常算失败。

| 判据 | 期望 | 实测（意外 / 已申报） | 结果 |
|---|---|---|---|
| 截图数 | 45 | 45 | ✅ |
| 每张字节数 | > 8192 | 最小 42535（archify__mobile.png） | ✅ |
| URL 发现数 | 15 | 15 | ✅ |
| pageerror | 0 | 0 / 0 | ✅ |
| console.error | 0 | 0 / 4 | ✅ |
| requestfailed | 0 | 0 / 3 | ✅ |
| HTTP ≥400 | 0 | 0 / 0 | ✅ |

**退出码：0（意外失败为 0）**

### 已申报基线问题（不计入闸门，但必须被人看见）

| id | 条数 | 原因 | 归属 |
|---|---|---|---|
| `favicon-404` | 1 | public/ 下无 favicon.*、src/app/layout.tsx 的 metadata 无 icons 字段 → 浏览器回退请求 /favicon.ico 得 404。真实缺陷，见 findings.md F-07，归 V-4 图形资产。 | findings.md |
| `archify-backend-down` | 6 | src/lib/arsenal-api.ts:16 硬编码 DEFAULT_BASE = http://localhost:3011；静态导出站（output:export）挂载即请求 /api/archify，后端未起则必然失败。真实缺陷，见 findings.md F-06。 | findings.md |

- `favicon-404`：
  - `home__desktop.png` · console ·  http://127.0.0.1:3021/favicon.ico
- `archify-backend-down`：
  - `archify__desktop.png` · console ·  http://localhost:3011/api/archify
  - `archify__tablet.png` · console ·  http://localhost:3011/api/archify
  - `archify__mobile.png` · console ·  http://localhost:3011/api/archify
  - `archify__desktop.png` · requestfailed ·  http://localhost:3011/api/archify
  - `archify__tablet.png` · requestfailed ·  http://localhost:3011/api/archify
  - `archify__mobile.png` · requestfailed ·  http://localhost:3011/api/archify

## URL 清单（从产物实测生成）

| # | 路由 | 类型 | 来源文件 |
|---|---|---|---|
| 1 | `/` | 固定页 | `out/index.html` |
| 2 | `/arch/` | 固定页 | `out/arch/index.html` |
| 3 | `/archify/` | 固定页 | `out/archify/index.html` |
| 4 | `/blueprints/` | 固定页 | `out/blueprints/index.html` |
| 5 | `/cases/` | 固定页 | `out/cases/index.html` |
| 6 | `/check/` | 固定页 | `out/check/index.html` |
| 7 | `/export/` | 固定页 | `out/export/index.html` |
| 8 | `/icons/` | 固定页 | `out/icons/index.html` |
| 9 | `/rules/` | 固定页 | `out/rules/index.html` |
| 10 | `/stack/` | 固定页 | `out/stack/index.html` |
| 11 | `/rules/COL-CODE-001/` | 规则详情（池 69，取第 1） | `out/rules/COL-CODE-001/index.html` |
| 12 | `/rules/REL-LOG-002/` | 规则详情（池 69，取第 35） | `out/rules/REL-LOG-002/index.html` |
| 13 | `/rules/WEB-DTO-001/` | 规则详情（池 69，取第 69） | `out/rules/WEB-DTO-001/index.html` |
| 14 | `/blueprints/async-transaction/` | 蓝图详情（池 4，取第 1） | `out/blueprints/async-transaction/index.html` |
| 15 | `/blueprints/skeleton-config/` | 蓝图详情（池 4，取第 4） | `out/blueprints/skeleton-config/index.html` |

## 截图明细

| 文件 | 路由 | 视口 | 字节 | 尺寸(视口) | scrollW/clientW | 横向溢出 | scrollH | img 失败 | pageerror | console.err | reqfail | 4xx |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `home__desktop.png` | `/` | desktop | 207.0 KB | 1440×900 | 1440/1440 | 0px | 4268 | 0 | 0 | 1 | 0 | 0 |
| `home__tablet.png` | `/` | tablet | 161.9 KB | 1024×768 | 1024/1024 | 0px | 4746 | 0 | 0 | 0 | 0 | 0 |
| `home__mobile.png` | `/` | mobile | 103.0 KB | 390×844 | 443/390 | 53px | 8552 | 0 | 0 | 0 | 0 | 0 |
| `arch__desktop.png` | `/arch/` | desktop | 148.2 KB | 1440×900 | 1440/1440 | 0px | 986 | 0 | 0 | 0 | 0 | 0 |
| `arch__tablet.png` | `/arch/` | tablet | 108.8 KB | 1024×768 | 1024/1024 | 0px | 831 | 0 | 0 | 0 | 0 | 0 |
| `arch__mobile.png` | `/arch/` | mobile | 48.6 KB | 390×844 | 443/390 | 53px | 1087 | 0 | 0 | 0 | 0 | 0 |
| `archify__desktop.png` | `/archify/` | desktop | 106.7 KB | 1440×900 | 1440/1440 | 0px | 900 | 0 | 0 | 1 | 1 | 0 |
| `archify__tablet.png` | `/archify/` | tablet | 103.4 KB | 1024×768 | 1024/1024 | 0px | 768 | 0 | 0 | 1 | 1 | 0 |
| `archify__mobile.png` | `/archify/` | mobile | 41.5 KB | 390×844 | 443/390 | 53px | 1421 | 0 | 0 | 1 | 1 | 0 |
| `blueprints__desktop.png` | `/blueprints/` | desktop | 199.0 KB | 1440×900 | 1440/1440 | 0px | 1403 | 0 | 0 | 0 | 0 | 0 |
| `blueprints__tablet.png` | `/blueprints/` | tablet | 160.3 KB | 1024×768 | 1024/1024 | 0px | 1528 | 0 | 0 | 0 | 0 | 0 |
| `blueprints__mobile.png` | `/blueprints/` | mobile | 93.9 KB | 390×844 | 443/390 | 53px | 2905 | 0 | 0 | 0 | 0 | 0 |
| `cases__desktop.png` | `/cases/` | desktop | 221.8 KB | 1440×900 | 1440/1440 | 0px | 1335 | 0 | 0 | 0 | 0 | 0 |
| `cases__tablet.png` | `/cases/` | tablet | 181.6 KB | 1024×768 | 1024/1024 | 0px | 1376 | 0 | 0 | 0 | 0 | 0 |
| `cases__mobile.png` | `/cases/` | mobile | 100.5 KB | 390×844 | 443/390 | 53px | 3201 | 0 | 0 | 0 | 0 | 0 |
| `check__desktop.png` | `/check/` | desktop | 101.8 KB | 1440×900 | 1440/1440 | 0px | 2648 | 0 | 0 | 0 | 0 | 0 |
| `check__tablet.png` | `/check/` | tablet | 85.0 KB | 1024×768 | 1024/1024 | 0px | 2706 | 0 | 0 | 0 | 0 | 0 |
| `check__mobile.png` | `/check/` | mobile | 52.9 KB | 390×844 | 443/390 | 53px | 3985 | 0 | 0 | 0 | 0 | 0 |
| `export__desktop.png` | `/export/` | desktop | 177.4 KB | 1440×900 | 1440/1440 | 0px | 1198 | 0 | 0 | 0 | 0 | 0 |
| `export__tablet.png` | `/export/` | tablet | 117.7 KB | 1024×768 | 1024/1024 | 0px | 1301 | 0 | 0 | 0 | 0 | 0 |
| `export__mobile.png` | `/export/` | mobile | 43.6 KB | 390×844 | 443/390 | 53px | 2236 | 0 | 0 | 0 | 0 | 0 |
| `icons__desktop.png` | `/icons/` | desktop | 188.2 KB | 1440×900 | 1440/1440 | 0px | 3425 | 0 | 0 | 0 | 0 | 0 |
| `icons__tablet.png` | `/icons/` | tablet | 142.4 KB | 1024×768 | 1024/1024 | 0px | 4137 | 0 | 0 | 0 | 0 | 0 |
| `icons__mobile.png` | `/icons/` | mobile | 90.3 KB | 390×844 | 443/390 | 53px | 8317 | 0 | 0 | 0 | 0 | 0 |
| `rules__desktop.png` | `/rules/` | desktop | 141.8 KB | 1440×900 | 1440/1440 | 0px | 7042 | 0 | 0 | 0 | 0 | 0 |
| `rules__tablet.png` | `/rules/` | tablet | 109.1 KB | 1024×768 | 1024/1024 | 0px | 8009 | 0 | 0 | 0 | 0 | 0 |
| `rules__mobile.png` | `/rules/` | mobile | 50.6 KB | 390×844 | 443/390 | 53px | 14809 | 0 | 0 | 0 | 0 | 0 |
| `stack__desktop.png` | `/stack/` | desktop | 138.9 KB | 1440×900 | 1440/1440 | 0px | 8170 | 0 | 0 | 0 | 0 | 0 |
| `stack__tablet.png` | `/stack/` | tablet | 89.4 KB | 1024×768 | 1024/1024 | 0px | 8062 | 0 | 0 | 0 | 0 | 0 |
| `stack__mobile.png` | `/stack/` | mobile | 53.2 KB | 390×844 | 443/390 | 53px | 10576 | 0 | 0 | 0 | 0 | 0 |
| `rules-COL-CODE-001__desktop.png` | `/rules/COL-CODE-001/` | desktop | 138.6 KB | 1440×900 | 1440/1440 | 0px | 1682 | 0 | 0 | 0 | 0 | 0 |
| `rules-COL-CODE-001__tablet.png` | `/rules/COL-CODE-001/` | tablet | 116.7 KB | 1024×768 | 1024/1024 | 0px | 1875 | 0 | 0 | 0 | 0 | 0 |
| `rules-COL-CODE-001__mobile.png` | `/rules/COL-CODE-001/` | mobile | 61.3 KB | 390×844 | 443/390 | 53px | 2847 | 0 | 0 | 0 | 0 | 0 |
| `rules-REL-LOG-002__desktop.png` | `/rules/REL-LOG-002/` | desktop | 141.3 KB | 1440×900 | 1440/1440 | 0px | 1568 | 0 | 0 | 0 | 0 | 0 |
| `rules-REL-LOG-002__tablet.png` | `/rules/REL-LOG-002/` | tablet | 122.5 KB | 1024×768 | 1024/1024 | 0px | 1699 | 0 | 0 | 0 | 0 | 0 |
| `rules-REL-LOG-002__mobile.png` | `/rules/REL-LOG-002/` | mobile | 63.8 KB | 390×844 | 443/390 | 53px | 2660 | 0 | 0 | 0 | 0 | 0 |
| `rules-WEB-DTO-001__desktop.png` | `/rules/WEB-DTO-001/` | desktop | 160.5 KB | 1440×900 | 1440/1440 | 0px | 1551 | 0 | 0 | 0 | 0 | 0 |
| `rules-WEB-DTO-001__tablet.png` | `/rules/WEB-DTO-001/` | tablet | 134.7 KB | 1024×768 | 1024/1024 | 0px | 1683 | 0 | 0 | 0 | 0 | 0 |
| `rules-WEB-DTO-001__mobile.png` | `/rules/WEB-DTO-001/` | mobile | 68.7 KB | 390×844 | 443/390 | 53px | 2684 | 0 | 0 | 0 | 0 | 0 |
| `blueprints-async-transaction__desktop.png` | `/blueprints/async-transaction/` | desktop | 160.5 KB | 1440×900 | 1440/1440 | 0px | 3108 | 0 | 0 | 0 | 0 | 0 |
| `blueprints-async-transaction__tablet.png` | `/blueprints/async-transaction/` | tablet | 122.2 KB | 1024×768 | 1024/1024 | 0px | 3343 | 0 | 0 | 0 | 0 | 0 |
| `blueprints-async-transaction__mobile.png` | `/blueprints/async-transaction/` | mobile | 77.3 KB | 390×844 | 443/390 | 53px | 5351 | 0 | 0 | 0 | 0 | 0 |
| `blueprints-skeleton-config__desktop.png` | `/blueprints/skeleton-config/` | desktop | 159.3 KB | 1440×900 | 1440/1440 | 0px | 3156 | 0 | 0 | 0 | 0 | 0 |
| `blueprints-skeleton-config__tablet.png` | `/blueprints/skeleton-config/` | tablet | 122.0 KB | 1024×768 | 1024/1024 | 0px | 3439 | 0 | 0 | 0 | 0 | 0 |
| `blueprints-skeleton-config__mobile.png` | `/blueprints/skeleton-config/` | mobile | 76.7 KB | 390×844 | 443/390 | 53px | 5230 | 0 | 0 | 0 | 0 | 0 |

## 横向溢出的元凶（15 张有溢出）

「最深」的那个元素才是元凶（父容器会连带越界）。

### `home__mobile.png` —— 越界 53px，共 3 个元素越界

| 元素 | right | width | 越界 | position | overflow-x | 文案 |
|---|---|---|---|---|---|---|
| `a.rounded.px-2.py-1` | 443 | 28 | 53 | static | visible | 导出中心 |
| `a.rounded.px-2.py-1` | 411 | 28 | 21 | static | visible | 校验台 |
| `nav.flex.items-center.gap-1` | 443 | 316 | 53 | static | visible | 概览规则库最佳实践案例库场景案例库装配台架构图谱图标库出图服务校验台导出中心 |

### `arch__mobile.png` —— 越界 53px，共 3 个元素越界

| 元素 | right | width | 越界 | position | overflow-x | 文案 |
|---|---|---|---|---|---|---|
| `a.rounded.px-2.py-1` | 443 | 28 | 53 | static | visible | 导出中心 |
| `a.rounded.px-2.py-1` | 411 | 28 | 21 | static | visible | 校验台 |
| `nav.flex.items-center.gap-1` | 443 | 316 | 53 | static | visible | 概览规则库最佳实践案例库场景案例库装配台架构图谱图标库出图服务校验台导出中心 |

### `archify__mobile.png` —— 越界 53px，共 3 个元素越界

| 元素 | right | width | 越界 | position | overflow-x | 文案 |
|---|---|---|---|---|---|---|
| `a.rounded.px-2.py-1` | 443 | 28 | 53 | static | visible | 导出中心 |
| `a.rounded.px-2.py-1` | 411 | 28 | 21 | static | visible | 校验台 |
| `nav.flex.items-center.gap-1` | 443 | 316 | 53 | static | visible | 概览规则库最佳实践案例库场景案例库装配台架构图谱图标库出图服务校验台导出中心 |

### `blueprints__mobile.png` —— 越界 53px，共 3 个元素越界

| 元素 | right | width | 越界 | position | overflow-x | 文案 |
|---|---|---|---|---|---|---|
| `a.rounded.px-2.py-1` | 443 | 28 | 53 | static | visible | 导出中心 |
| `a.rounded.px-2.py-1` | 411 | 28 | 21 | static | visible | 校验台 |
| `nav.flex.items-center.gap-1` | 443 | 316 | 53 | static | visible | 概览规则库最佳实践案例库场景案例库装配台架构图谱图标库出图服务校验台导出中心 |

### `cases__mobile.png` —— 越界 53px，共 3 个元素越界

| 元素 | right | width | 越界 | position | overflow-x | 文案 |
|---|---|---|---|---|---|---|
| `a.rounded.px-2.py-1` | 443 | 28 | 53 | static | visible | 导出中心 |
| `a.rounded.px-2.py-1` | 411 | 28 | 21 | static | visible | 校验台 |
| `nav.flex.items-center.gap-1` | 443 | 316 | 53 | static | visible | 概览规则库最佳实践案例库场景案例库装配台架构图谱图标库出图服务校验台导出中心 |

### `check__mobile.png` —— 越界 53px，共 3 个元素越界

| 元素 | right | width | 越界 | position | overflow-x | 文案 |
|---|---|---|---|---|---|---|
| `a.rounded.px-2.py-1` | 443 | 28 | 53 | static | visible | 导出中心 |
| `a.rounded.px-2.py-1` | 411 | 28 | 21 | static | visible | 校验台 |
| `nav.flex.items-center.gap-1` | 443 | 316 | 53 | static | visible | 概览规则库最佳实践案例库场景案例库装配台架构图谱图标库出图服务校验台导出中心 |

### `export__mobile.png` —— 越界 53px，共 3 个元素越界

| 元素 | right | width | 越界 | position | overflow-x | 文案 |
|---|---|---|---|---|---|---|
| `a.rounded.px-2.py-1` | 443 | 28 | 53 | static | visible | 导出中心 |
| `a.rounded.px-2.py-1` | 411 | 28 | 21 | static | visible | 校验台 |
| `nav.flex.items-center.gap-1` | 443 | 316 | 53 | static | visible | 概览规则库最佳实践案例库场景案例库装配台架构图谱图标库出图服务校验台导出中心 |

### `icons__mobile.png` —— 越界 53px，共 3 个元素越界

| 元素 | right | width | 越界 | position | overflow-x | 文案 |
|---|---|---|---|---|---|---|
| `a.rounded.px-2.py-1` | 443 | 28 | 53 | static | visible | 导出中心 |
| `a.rounded.px-2.py-1` | 411 | 28 | 21 | static | visible | 校验台 |
| `nav.flex.items-center.gap-1` | 443 | 316 | 53 | static | visible | 概览规则库最佳实践案例库场景案例库装配台架构图谱图标库出图服务校验台导出中心 |

### `rules__mobile.png` —— 越界 53px，共 555 个元素越界

| 元素 | right | width | 越界 | position | overflow-x | 文案 |
|---|---|---|---|---|---|---|
| `span` | 402 | 44 | 12 | static | visible | 工程骨架 |
| `span` | 402 | 44 | 12 | static | visible | 工程骨架 |
| `span` | 402 | 44 | 12 | static | visible | 工程骨架 |
| `span` | 402 | 44 | 12 | static | visible | 工程骨架 |
| `span` | 402 | 44 | 12 | static | visible | 工程骨架 |

### `stack__mobile.png` —— 越界 53px，共 195 个元素越界

| 元素 | right | width | 越界 | position | overflow-x | 文案 |
|---|---|---|---|---|---|---|
| `rect` | 632 | 216 | 242 | static | visible | — |
| `rect` | 631 | 62 | 241 | static | visible | — |
| `text` | 603 | 7 | 213 | static | visible | T |
| `text` | 574 | 101 | 184 | static | visible | 共享存储 / 分布式事务 |
| `rect` | 555 | 62 | 165 | static | visible | — |

### `rules-COL-CODE-001__mobile.png` —— 越界 53px，共 8 个元素越界

| 元素 | right | width | 越界 | position | overflow-x | 文案 |
|---|---|---|---|---|---|---|
| `span` | 489 | 184 | 99 | static | visible | // 块标签后无描述，等同于没写 |
| `span` | 413 | 380 | 23 | static | visible | /** * 按主键查询用户，查不到时返回 null。 * * @param id |
| `code` | 489 | 456 | 99 | static | visible | /** * 获取用户 * @param id * @return */ publ |
| `code` | 413 | 380 | 23 | static | visible | /** * 按主键查询用户，查不到时返回 null。 * * @param id |
| `button.inline-flex.shrink-0.items-center` | 393 | 77 | 3 | static | visible | ⎘复制整条 |

### `rules-REL-LOG-002__mobile.png` —— 越界 53px，共 8 个元素越界

| 元素 | right | width | 越界 | position | overflow-x | 文案 |
|---|---|---|---|---|---|---|
| `code` | 490 | 410 | 100 | static | visible | log(g?er)?\.(trace|debug|info|warn|error |
| `span` | 580 | 166 | 190 | static | visible | // debug 关闭时仍会序列化 |
| `code` | 580 | 547 | 190 | static | visible | log.info("查询用户: " + userId + ", 结果: " +  |
| `code` | 414 | 381 | 24 | static | visible | log.info("查询用户: {}, 结果: {}", userId, use |
| `button.inline-flex.shrink-0.items-center` | 393 | 77 | 3 | static | visible | ⎘复制整条 |

### `rules-WEB-DTO-001__mobile.png` —— 越界 53px，共 14 个元素越界

| 元素 | right | width | 越界 | position | overflow-x | 文案 |
|---|---|---|---|---|---|---|
| `code` | 585 | 505 | 195 | static | visible | (public|private|protected)\s+[A-Za-z0-9_ |
| `span` | 638 | 275 | 248 | static | visible | // 直接返回实体，password 字段被序列化出去 |
| `span` | 626 | 117 | 236 | static | visible | UserQueryRequest |
| `span` | 502 | 88 | 112 | static | visible | @RequestBody |
| `span` | 487 | 44 | 97 | static | visible | Object |

### `blueprints-async-transaction__mobile.png` —— 越界 53px，共 251 个元素越界

| 元素 | right | width | 越界 | position | overflow-x | 文案 |
|---|---|---|---|---|---|---|
| `span` | 666 | 117 | 276 | static | visible | ImportJobService |
| `span` | 639 | 29 | 249 | static | visible | long |
| `span` | 622 | 139 | 232 | static | visible | ImportSubmitRequest |
| `span` | 595 | 141 | 205 | static | visible | "taskId 必须为正整数" |
| `span` | 547 | 475 | 157 | static | visible | * 1. 导入 10 万行可能要几分钟，HTTP 连接、网关超时、用户耐心都撑不 |

### `blueprints-skeleton-config__mobile.png` —— 越界 53px，共 133 个元素越界

| 元素 | right | width | 越界 | position | overflow-x | 文案 |
|---|---|---|---|---|---|---|
| `span` | 670 | 597 | 280 | static | visible | * @SpringBootApplication 隐式带上 @Component |
| `span` | 644 | 198 | 254 | static | visible | ConfigurationPropertiesScan |
| `span` | 626 | 553 | 236 | static | visible | * 1. 必须放在根包（这里是 com.example），不能放在 com.ex |
| `span` | 586 | 513 | 196 | static | visible | * 放错位置的结果是：部分 Bean 扫不到，然后报一个和「包位置」毫无关系的错 |
| `span` | 567 | 494 | 177 | static | visible | * 好处是包名与坐标天然一致，多人协作时不会出现「这个类该放哪个包」的争论。 |


## pageerror 全文（0 条）

（无）

## console.error 全文（4 条）

- `home__desktop.png`：Failed to load resource: the server responded with a status of 404 (File not found)
  - at: http://127.0.0.1:3021/favicon.ico:0
- `archify__desktop.png`：Failed to load resource: net::ERR_CONNECTION_REFUSED
  - at: http://localhost:3011/api/archify:0
- `archify__tablet.png`：Failed to load resource: net::ERR_CONNECTION_REFUSED
  - at: http://localhost:3011/api/archify:0
- `archify__mobile.png`：Failed to load resource: net::ERR_CONNECTION_REFUSED
  - at: http://localhost:3011/api/archify:0

## requestfailed 全文（3 条）

- `archify__desktop.png`：GET http://localhost:3011/api/archify
  - errorText: net::ERR_CONNECTION_REFUSED
- `archify__tablet.png`：GET http://localhost:3011/api/archify
  - errorText: net::ERR_CONNECTION_REFUSED
- `archify__mobile.png`：GET http://localhost:3011/api/archify
  - errorText: net::ERR_CONNECTION_REFUSED

## HTTP 4xx/5xx 全文（0 条）

（无）

## img 加载失败（naturalWidth===0 且 src 非空）（0 条）

（无）

## 采集口径

- 监听器（`pageerror` / `console` / `requestfailed` / `response`）**在 `page.goto` 之前注册**，按 URL×视口分别累积，不共用数组。
- 每张图附带：截图字节数、`documentElement.scrollWidth/clientWidth`、`scrollHeight`、`img` 失败清单、`h1` 数量、**越界元素清单（最深 5 个）**。
- 退出码 1 的条件：截图数 ≠ 45、任一张 ≤ 8KB、**未申报的** pageerror/console.error/requestfailed/HTTP≥400 任一非 0、URL 发现数 ≠ 15。

## 相关文件

- `visual/findings.md` —— V-2 逐张看图的人工判读结论（21 条，含 P0）
- `visual/reverse-validation.md` —— **反向验证四段**（注入 / 变红 / 还原 / 复绿）逐字原文
- `visual/evidence/` —— findings 引用的那几张位图（`visual/shots/**` 不入库）
