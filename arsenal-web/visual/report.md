# V-1 截图矩阵 · 人读报告

- 生成时间：2026-10-02T15:22:45.836Z
- 站点：`http://127.0.0.1:3021`（静态导出 `out/`，深色单主题）
- 矩阵：21 个 URL × 3 个视口 = **63 张**
- 截图范围：`viewport`（视口尺寸 —— 整页图在长页上完全不可判读，见脚本里 FULL_PAGE 的注释）
- 折叠线以下：由 `metrics.scrollHeight` 与越界元素清单量化；像素级逐段判读归 V-6/V-3，**本棒未做**

## 闸门

两档：**意外**失败让退出码变 1；**已申报基线**只计数、只打印，`--strict` 可让它们照常算失败。

| 判据 | 期望 | 实测（意外 / 已申报） | 结果 |
|---|---|---|---|
| 截图数 | 63 | 63 | ✅ |
| 每张字节数 | > 8192 | 最小 47604（stack-delivery__mobile.png） | ✅ |
| URL 发现数 | 21 | 21 | ✅ |
| pageerror | 0 | 0 / 0 | ✅ |
| console.error | 0 | 0 / 6 | ✅ |
| requestfailed | 0 | 0 / 3 | ✅ |
| HTTP ≥400 | 0 | 0 / 0 | ✅ |

**退出码：0（意外失败为 0）**

### 已申报基线问题（不计入闸门，但必须被人看见）

| id | 条数 | 原因 | 归属 |
|---|---|---|---|
| `archify-backend-down` | 9 | src/lib/arsenal-api.ts:16 硬编码 DEFAULT_BASE = http://localhost:3011；静态导出站（output:export）挂载即请求 /api/archify，后端未起则必然失败。真实缺陷，见 findings.md F-06。 | findings.md |

- `archify-backend-down`：
  - `archify__desktop.png` · console ·  http://127.0.0.1:3021/archify/
  - `archify__desktop.png` · console ·  http://localhost:3011/api/archify
  - `archify__tablet.png` · console ·  http://127.0.0.1:3021/archify/
  - `archify__tablet.png` · console ·  http://localhost:3011/api/archify
  - `archify__mobile.png` · console ·  http://127.0.0.1:3021/archify/
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
| 11 | `/stack/delivery/` | 固定页 | `out/stack/delivery/index.html` |
| 12 | `/stack/env/` | 固定页 | `out/stack/env/index.html` |
| 13 | `/stack/run/` | 固定页 | `out/stack/run/index.html` |
| 14 | `/rules/COL-CODE-001/` | 规则详情（池 69，取第 1） | `out/rules/COL-CODE-001/index.html` |
| 15 | `/rules/REL-LOG-002/` | 规则详情（池 69，取第 35） | `out/rules/REL-LOG-002/index.html` |
| 16 | `/rules/WEB-DTO-001/` | 规则详情（池 69，取第 69） | `out/rules/WEB-DTO-001/index.html` |
| 17 | `/blueprints/connection-pool/` | 蓝图详情（池 6，取第 1） | `out/blueprints/connection-pool/index.html` |
| 18 | `/blueprints/web-layer/` | 蓝图详情（池 6，取第 6） | `out/blueprints/web-layer/index.html` |
| 19 | `/cases/async-pipeline/` | 场景操作台（池 9，取第 1） | `out/cases/async-pipeline/index.html` |
| 20 | `/cases/huge-rowcount-rdb/` | 场景操作台（池 9，取第 5） | `out/cases/huge-rowcount-rdb/index.html` |
| 21 | `/cases/wide-table-search/` | 场景操作台（池 9，取第 9） | `out/cases/wide-table-search/index.html` |

## 截图明细

| 文件 | 路由 | 视口 | 字节 | 尺寸(视口) | scrollW/clientW | 横向溢出 | scrollH | img 失败 | pageerror | console.err | reqfail | 4xx |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `home__desktop.png` | `/` | desktop | 211.5 KB | 1440×900 | 1440/1440 | 0px | 4287 | 0 | 0 | 0 | 0 | 0 |
| `home__tablet.png` | `/` | tablet | 163.3 KB | 1024×768 | 1024/1024 | 0px | 4801 | 0 | 0 | 0 | 0 | 0 |
| `home__mobile.png` | `/` | mobile | 106.6 KB | 390×844 | 390/390 | 0px | 8591 | 0 | 0 | 0 | 0 | 0 |
| `arch__desktop.png` | `/arch/` | desktop | 152.9 KB | 1440×900 | 1440/1440 | 0px | 986 | 0 | 0 | 0 | 0 | 0 |
| `arch__tablet.png` | `/arch/` | tablet | 108.8 KB | 1024×768 | 1024/1024 | 0px | 930 | 0 | 0 | 0 | 0 | 0 |
| `arch__mobile.png` | `/arch/` | mobile | 47.3 KB | 390×844 | 390/390 | 0px | 1112 | 0 | 0 | 0 | 0 | 0 |
| `archify__desktop.png` | `/archify/` | desktop | 140.5 KB | 1440×900 | 1440/1440 | 0px | 930 | 0 | 0 | 2 | 1 | 0 |
| `archify__tablet.png` | `/archify/` | tablet | 120.7 KB | 1024×768 | 1024/1024 | 0px | 930 | 0 | 0 | 2 | 1 | 0 |
| `archify__mobile.png` | `/archify/` | mobile | 55.5 KB | 390×844 | 390/390 | 0px | 1588 | 0 | 0 | 2 | 1 | 0 |
| `blueprints__desktop.png` | `/blueprints/` | desktop | 176.4 KB | 1440×900 | 1440/1440 | 0px | 1325 | 0 | 0 | 0 | 0 | 0 |
| `blueprints__tablet.png` | `/blueprints/` | tablet | 127.1 KB | 1024×768 | 1024/1024 | 0px | 1619 | 0 | 0 | 0 | 0 | 0 |
| `blueprints__mobile.png` | `/blueprints/` | mobile | 58.1 KB | 390×844 | 390/390 | 0px | 3085 | 0 | 0 | 0 | 0 | 0 |
| `cases__desktop.png` | `/cases/` | desktop | 215.5 KB | 1440×900 | 1440/1440 | 0px | 1753 | 0 | 0 | 0 | 0 | 0 |
| `cases__tablet.png` | `/cases/` | tablet | 162.2 KB | 1024×768 | 1024/1024 | 0px | 2147 | 0 | 0 | 0 | 0 | 0 |
| `cases__mobile.png` | `/cases/` | mobile | 95.2 KB | 390×844 | 390/390 | 0px | 3211 | 0 | 0 | 0 | 0 | 0 |
| `check__desktop.png` | `/check/` | desktop | 110.9 KB | 1440×900 | 1440/1440 | 0px | 2648 | 0 | 0 | 0 | 0 | 0 |
| `check__tablet.png` | `/check/` | tablet | 88.3 KB | 1024×768 | 1024/1024 | 0px | 2727 | 0 | 0 | 0 | 0 | 0 |
| `check__mobile.png` | `/check/` | mobile | 57.3 KB | 390×844 | 390/390 | 0px | 4044 | 0 | 0 | 0 | 0 | 0 |
| `export__desktop.png` | `/export/` | desktop | 182.4 KB | 1440×900 | 1440/1440 | 0px | 1198 | 0 | 0 | 0 | 0 | 0 |
| `export__tablet.png` | `/export/` | tablet | 117.6 KB | 1024×768 | 1024/1024 | 0px | 1301 | 0 | 0 | 0 | 0 | 0 |
| `export__mobile.png` | `/export/` | mobile | 46.5 KB | 390×844 | 390/390 | 0px | 2240 | 0 | 0 | 0 | 0 | 0 |
| `icons__desktop.png` | `/icons/` | desktop | 191.7 KB | 1440×900 | 1440/1440 | 0px | 3425 | 0 | 0 | 0 | 0 | 0 |
| `icons__tablet.png` | `/icons/` | tablet | 141.5 KB | 1024×768 | 1024/1024 | 0px | 4137 | 0 | 0 | 0 | 0 | 0 |
| `icons__mobile.png` | `/icons/` | mobile | 89.1 KB | 390×844 | 390/390 | 0px | 8298 | 0 | 0 | 0 | 0 | 0 |
| `rules__desktop.png` | `/rules/` | desktop | 145.7 KB | 1440×900 | 1440/1440 | 0px | 7042 | 0 | 0 | 0 | 0 | 0 |
| `rules__tablet.png` | `/rules/` | tablet | 108.6 KB | 1024×768 | 1024/1024 | 0px | 8009 | 0 | 0 | 0 | 0 | 0 |
| `rules__mobile.png` | `/rules/` | mobile | 51.8 KB | 390×844 | 390/390 | 0px | 15375 | 0 | 0 | 0 | 0 | 0 |
| `stack__desktop.png` | `/stack/` | desktop | 143.4 KB | 1440×900 | 1440/1440 | 0px | 1000 | 0 | 0 | 0 | 0 | 0 |
| `stack__tablet.png` | `/stack/` | tablet | 103.7 KB | 1024×768 | 1024/1024 | 0px | 1145 | 0 | 0 | 0 | 0 | 0 |
| `stack__mobile.png` | `/stack/` | mobile | 51.4 KB | 390×844 | 390/390 | 0px | 1951 | 0 | 0 | 0 | 0 | 0 |
| `stack-delivery__desktop.png` | `/stack/delivery/` | desktop | 128.2 KB | 1440×900 | 1440/1440 | 0px | 1756 | 0 | 0 | 0 | 0 | 0 |
| `stack-delivery__tablet.png` | `/stack/delivery/` | tablet | 84.6 KB | 1024×768 | 1024/1024 | 0px | 2088 | 0 | 0 | 0 | 0 | 0 |
| `stack-delivery__mobile.png` | `/stack/delivery/` | mobile | 46.5 KB | 390×844 | 390/390 | 0px | 3051 | 0 | 0 | 0 | 0 | 0 |
| `stack-env__desktop.png` | `/stack/env/` | desktop | 98.0 KB | 1440×900 | 1440/1440 | 0px | 930 | 0 | 0 | 0 | 0 | 0 |
| `stack-env__tablet.png` | `/stack/env/` | tablet | 89.8 KB | 1024×768 | 1024/1024 | 0px | 930 | 0 | 0 | 0 | 0 | 0 |
| `stack-env__mobile.png` | `/stack/env/` | mobile | 48.9 KB | 390×844 | 390/390 | 0px | 1207 | 0 | 0 | 0 | 0 | 0 |
| `stack-run__desktop.png` | `/stack/run/` | desktop | 163.5 KB | 1440×900 | 1440/1440 | 0px | 3847 | 0 | 0 | 0 | 0 | 0 |
| `stack-run__tablet.png` | `/stack/run/` | tablet | 111.0 KB | 1024×768 | 1024/1024 | 0px | 4140 | 0 | 0 | 0 | 0 | 0 |
| `stack-run__mobile.png` | `/stack/run/` | mobile | 56.6 KB | 390×844 | 390/390 | 0px | 8441 | 0 | 0 | 0 | 0 | 0 |
| `rules-COL-CODE-001__desktop.png` | `/rules/COL-CODE-001/` | desktop | 143.8 KB | 1440×900 | 1440/1440 | 0px | 1682 | 0 | 0 | 0 | 0 | 0 |
| `rules-COL-CODE-001__tablet.png` | `/rules/COL-CODE-001/` | tablet | 116.2 KB | 1024×768 | 1024/1024 | 0px | 1875 | 0 | 0 | 0 | 0 | 0 |
| `rules-COL-CODE-001__mobile.png` | `/rules/COL-CODE-001/` | mobile | 62.1 KB | 390×844 | 390/390 | 0px | 2891 | 0 | 0 | 0 | 0 | 0 |
| `rules-REL-LOG-002__desktop.png` | `/rules/REL-LOG-002/` | desktop | 145.6 KB | 1440×900 | 1440/1440 | 0px | 1568 | 0 | 0 | 0 | 0 | 0 |
| `rules-REL-LOG-002__tablet.png` | `/rules/REL-LOG-002/` | tablet | 121.4 KB | 1024×768 | 1024/1024 | 0px | 1699 | 0 | 0 | 0 | 0 | 0 |
| `rules-REL-LOG-002__mobile.png` | `/rules/REL-LOG-002/` | mobile | 63.9 KB | 390×844 | 390/390 | 0px | 2703 | 0 | 0 | 0 | 0 | 0 |
| `rules-WEB-DTO-001__desktop.png` | `/rules/WEB-DTO-001/` | desktop | 165.2 KB | 1440×900 | 1440/1440 | 0px | 1551 | 0 | 0 | 0 | 0 | 0 |
| `rules-WEB-DTO-001__tablet.png` | `/rules/WEB-DTO-001/` | tablet | 134.3 KB | 1024×768 | 1024/1024 | 0px | 1683 | 0 | 0 | 0 | 0 | 0 |
| `rules-WEB-DTO-001__mobile.png` | `/rules/WEB-DTO-001/` | mobile | 70.6 KB | 390×844 | 390/390 | 0px | 2728 | 0 | 0 | 0 | 0 | 0 |
| `blueprints-connection-pool__desktop.png` | `/blueprints/connection-pool/` | desktop | 120.2 KB | 1440×900 | 1440/1440 | 0px | 1362 | 0 | 0 | 0 | 0 | 0 |
| `blueprints-connection-pool__tablet.png` | `/blueprints/connection-pool/` | tablet | 87.2 KB | 1024×768 | 1024/1024 | 0px | 1424 | 0 | 0 | 0 | 0 | 0 |
| `blueprints-connection-pool__mobile.png` | `/blueprints/connection-pool/` | mobile | 54.5 KB | 390×844 | 390/390 | 0px | 2119 | 0 | 0 | 0 | 0 | 0 |
| `blueprints-web-layer__desktop.png` | `/blueprints/web-layer/` | desktop | 122.0 KB | 1440×900 | 1440/1440 | 0px | 1385 | 0 | 0 | 0 | 0 | 0 |
| `blueprints-web-layer__tablet.png` | `/blueprints/web-layer/` | tablet | 90.7 KB | 1024×768 | 1024/1024 | 0px | 1424 | 0 | 0 | 0 | 0 | 0 |
| `blueprints-web-layer__mobile.png` | `/blueprints/web-layer/` | mobile | 57.2 KB | 390×844 | 390/390 | 0px | 2108 | 0 | 0 | 0 | 0 | 0 |
| `cases-async-pipeline__desktop.png` | `/cases/async-pipeline/` | desktop | 188.6 KB | 1440×900 | 1440/1440 | 0px | 15411 | 0 | 0 | 0 | 0 | 0 |
| `cases-async-pipeline__tablet.png` | `/cases/async-pipeline/` | tablet | 111.7 KB | 1024×768 | 1024/1024 | 0px | 17518 | 0 | 0 | 0 | 0 | 0 |
| `cases-async-pipeline__mobile.png` | `/cases/async-pipeline/` | mobile | 60.2 KB | 390×844 | 390/390 | 0px | 20487 | 0 | 0 | 0 | 0 | 0 |
| `cases-huge-rowcount-rdb__desktop.png` | `/cases/huge-rowcount-rdb/` | desktop | 172.1 KB | 1440×900 | 1440/1440 | 0px | 18313 | 0 | 0 | 0 | 0 | 0 |
| `cases-huge-rowcount-rdb__tablet.png` | `/cases/huge-rowcount-rdb/` | tablet | 106.1 KB | 1024×768 | 1024/1024 | 0px | 21027 | 0 | 0 | 0 | 0 | 0 |
| `cases-huge-rowcount-rdb__mobile.png` | `/cases/huge-rowcount-rdb/` | mobile | 51.4 KB | 390×844 | 390/390 | 0px | 24253 | 0 | 0 | 0 | 0 | 0 |
| `cases-wide-table-search__desktop.png` | `/cases/wide-table-search/` | desktop | 183.0 KB | 1440×900 | 1440/1440 | 0px | 15775 | 0 | 0 | 0 | 0 | 0 |
| `cases-wide-table-search__tablet.png` | `/cases/wide-table-search/` | tablet | 110.3 KB | 1024×768 | 1024/1024 | 0px | 17783 | 0 | 0 | 0 | 0 | 0 |
| `cases-wide-table-search__mobile.png` | `/cases/wide-table-search/` | mobile | 59.6 KB | 390×844 | 390/390 | 0px | 20448 | 0 | 0 | 0 | 0 | 0 |

## 横向溢出的元凶（0 张有溢出）

（无 —— 全部 63 张 scrollWidth === clientWidth）

## pageerror 全文（0 条）

（无）

## console.error 全文（6 条）

- `archify__desktop.png`：Access to fetch at 'http://localhost:3011/api/archify' from origin 'http://127.0.0.1:3021' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  - at: http://127.0.0.1:3021/archify/:0
- `archify__desktop.png`：Failed to load resource: net::ERR_FAILED
  - at: http://localhost:3011/api/archify:0
- `archify__tablet.png`：Access to fetch at 'http://localhost:3011/api/archify' from origin 'http://127.0.0.1:3021' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  - at: http://127.0.0.1:3021/archify/:0
- `archify__tablet.png`：Failed to load resource: net::ERR_FAILED
  - at: http://localhost:3011/api/archify:0
- `archify__mobile.png`：Access to fetch at 'http://localhost:3011/api/archify' from origin 'http://127.0.0.1:3021' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  - at: http://127.0.0.1:3021/archify/:0
- `archify__mobile.png`：Failed to load resource: net::ERR_FAILED
  - at: http://localhost:3011/api/archify:0

## requestfailed 全文（3 条）

- `archify__desktop.png`：GET http://localhost:3011/api/archify
  - errorText: net::ERR_FAILED
- `archify__tablet.png`：GET http://localhost:3011/api/archify
  - errorText: net::ERR_FAILED
- `archify__mobile.png`：GET http://localhost:3011/api/archify
  - errorText: net::ERR_FAILED

## HTTP 4xx/5xx 全文（0 条）

（无）

## img 加载失败（naturalWidth===0 且 src 非空）（0 条）

（无）

## 采集口径

- 监听器（`pageerror` / `console` / `requestfailed` / `response`）**在 `page.goto` 之前注册**，按 URL×视口分别累积，不共用数组。
- 每张图附带：截图字节数、`documentElement.scrollWidth/clientWidth`、`scrollHeight`、`img` 失败清单、`h1` 数量、**越界元素清单（最深 5 个）**。
- 退出码 1 的条件：截图数 ≠ 63、任一张 ≤ 8KB、**未申报的** pageerror/console.error/requestfailed/HTTP≥400 任一非 0、URL 发现数 ≠ 21。

## 相关文件

- `visual/findings.md` —— V-2 逐张看图的人工判读结论（21 条，含 P0）
- `visual/reverse-validation.md` —— **反向验证四段**（注入 / 变红 / 还原 / 复绿）逐字原文
- `visual/evidence/` —— findings 引用的那几张位图（`visual/shots/**` 不入库）
