# V-1 截图矩阵 · 人读报告

- 生成时间：2026-09-26T16:16:57.660Z
- 站点：`http://127.0.0.1:3021`（静态导出 `out/`，深色单主题）
- 矩阵：17 个 URL × 3 个视口 = **51 张**
- 截图范围：`viewport`（视口尺寸 —— 整页图在长页上完全不可判读，见脚本里 FULL_PAGE 的注释）
- 折叠线以下：由 `metrics.scrollHeight` 与越界元素清单量化；像素级逐段判读归 V-6/V-3，**本棒未做**

## 闸门

两档：**意外**失败让退出码变 1；**已申报基线**只计数、只打印，`--strict` 可让它们照常算失败。

| 判据 | 期望 | 实测（意外 / 已申报） | 结果 |
|---|---|---|---|
| 截图数 | 51 | 51 | ✅ |
| 每张字节数 | > 8192 | 最小 52392（export__mobile.png） | ✅ |
| URL 发现数 | 17 | 17 | ✅ |
| pageerror | 0 | 0 / 0 | ✅ |
| console.error | 0 | 3 / 3 | ❌ |
| requestfailed | 0 | 0 / 3 | ✅ |
| HTTP ≥400 | 0 | 0 / 0 | ✅ |

**退出码：1（有意外失败）**

### 未过的闸门（原文）

- 未申报的 console.error 共 3 条（期望 0）

### 已申报基线问题（不计入闸门，但必须被人看见）

| id | 条数 | 原因 | 归属 |
|---|---|---|---|
| `archify-backend-down` | 6 | src/lib/arsenal-api.ts:16 硬编码 DEFAULT_BASE = http://localhost:3011；静态导出站（output:export）挂载即请求 /api/archify，后端未起则必然失败。真实缺陷，见 findings.md F-06。 | findings.md |

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
| 14 | `/blueprints/virtual-thread/` | 蓝图详情（池 1，取第 1） | `out/blueprints/virtual-thread/index.html` |
| 15 | `/cases/async-pipeline/` | 场景操作台（池 9，取第 1） | `out/cases/async-pipeline/index.html` |
| 16 | `/cases/huge-rowcount-rdb/` | 场景操作台（池 9，取第 5） | `out/cases/huge-rowcount-rdb/index.html` |
| 17 | `/cases/wide-table-search/` | 场景操作台（池 9，取第 9） | `out/cases/wide-table-search/index.html` |

## 截图明细

| 文件 | 路由 | 视口 | 字节 | 尺寸(视口) | scrollW/clientW | 横向溢出 | scrollH | img 失败 | pageerror | console.err | reqfail | 4xx |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `home__desktop.png` | `/` | desktop | 223.8 KB | 1440×900 | 1440/1440 | 0px | 4234 | 0 | 0 | 0 | 0 | 0 |
| `home__tablet.png` | `/` | tablet | 177.1 KB | 1024×768 | 1024/1024 | 0px | 4692 | 0 | 0 | 0 | 0 | 0 |
| `home__mobile.png` | `/` | mobile | 113.0 KB | 390×844 | 390/390 | 0px | 8430 | 0 | 0 | 0 | 0 | 0 |
| `arch__desktop.png` | `/arch/` | desktop | 168.8 KB | 1440×900 | 1440/1440 | 0px | 985 | 0 | 0 | 0 | 0 | 0 |
| `arch__tablet.png` | `/arch/` | tablet | 126.7 KB | 1024×768 | 1024/1024 | 0px | 830 | 0 | 0 | 0 | 0 | 0 |
| `arch__mobile.png` | `/arch/` | mobile | 56.4 KB | 390×844 | 390/390 | 0px | 1082 | 0 | 0 | 0 | 0 | 0 |
| `archify__desktop.png` | `/archify/` | desktop | 149.9 KB | 1440×900 | 1440/1440 | 0px | 900 | 0 | 0 | 2 | 1 | 0 |
| `archify__tablet.png` | `/archify/` | tablet | 138.1 KB | 1024×768 | 1024/1024 | 0px | 924 | 0 | 0 | 2 | 1 | 0 |
| `archify__mobile.png` | `/archify/` | mobile | 61.4 KB | 390×844 | 390/390 | 0px | 1555 | 0 | 0 | 2 | 1 | 0 |
| `blueprints__desktop.png` | `/blueprints/` | desktop | 105.0 KB | 1440×900 | 1440/1440 | 0px | 900 | 0 | 0 | 0 | 0 | 0 |
| `blueprints__tablet.png` | `/blueprints/` | tablet | 101.1 KB | 1024×768 | 1024/1024 | 0px | 803 | 0 | 0 | 0 | 0 | 0 |
| `blueprints__mobile.png` | `/blueprints/` | mobile | 66.5 KB | 390×844 | 390/390 | 0px | 1073 | 0 | 0 | 0 | 0 | 0 |
| `cases__desktop.png` | `/cases/` | desktop | 242.4 KB | 1440×900 | 1440/1440 | 0px | 1666 | 0 | 0 | 0 | 0 | 0 |
| `cases__tablet.png` | `/cases/` | tablet | 180.5 KB | 1024×768 | 1024/1024 | 0px | 2294 | 0 | 0 | 0 | 0 | 0 |
| `cases__mobile.png` | `/cases/` | mobile | 115.0 KB | 390×844 | 390/390 | 0px | 4139 | 0 | 0 | 0 | 0 | 0 |
| `check__desktop.png` | `/check/` | desktop | 118.0 KB | 1440×900 | 1440/1440 | 0px | 2642 | 0 | 0 | 0 | 0 | 0 |
| `check__tablet.png` | `/check/` | tablet | 98.3 KB | 1024×768 | 1024/1024 | 0px | 2690 | 0 | 0 | 0 | 0 | 0 |
| `check__mobile.png` | `/check/` | mobile | 61.8 KB | 390×844 | 390/390 | 0px | 3910 | 0 | 0 | 0 | 0 | 0 |
| `export__desktop.png` | `/export/` | desktop | 210.6 KB | 1440×900 | 1440/1440 | 0px | 1197 | 0 | 0 | 0 | 0 | 0 |
| `export__tablet.png` | `/export/` | tablet | 141.0 KB | 1024×768 | 1024/1024 | 0px | 1299 | 0 | 0 | 0 | 0 | 0 |
| `export__mobile.png` | `/export/` | mobile | 51.2 KB | 390×844 | 390/390 | 0px | 2199 | 0 | 0 | 0 | 0 | 0 |
| `icons__desktop.png` | `/icons/` | desktop | 204.9 KB | 1440×900 | 1440/1440 | 0px | 3410 | 0 | 0 | 0 | 0 | 0 |
| `icons__tablet.png` | `/icons/` | tablet | 158.9 KB | 1024×768 | 1024/1024 | 0px | 4118 | 0 | 0 | 0 | 0 | 0 |
| `icons__mobile.png` | `/icons/` | mobile | 98.4 KB | 390×844 | 390/390 | 0px | 8248 | 0 | 0 | 0 | 0 | 0 |
| `rules__desktop.png` | `/rules/` | desktop | 160.2 KB | 1440×900 | 1440/1440 | 0px | 6992 | 0 | 0 | 0 | 0 | 0 |
| `rules__tablet.png` | `/rules/` | tablet | 124.3 KB | 1024×768 | 1024/1024 | 0px | 7942 | 0 | 0 | 0 | 0 | 0 |
| `rules__mobile.png` | `/rules/` | mobile | 59.6 KB | 390×844 | 390/390 | 0px | 15219 | 0 | 0 | 0 | 0 | 0 |
| `stack__desktop.png` | `/stack/` | desktop | 153.4 KB | 1440×900 | 1440/1440 | 0px | 939 | 0 | 0 | 0 | 0 | 0 |
| `stack__tablet.png` | `/stack/` | tablet | 119.1 KB | 1024×768 | 1024/1024 | 0px | 1116 | 0 | 0 | 0 | 0 | 0 |
| `stack__mobile.png` | `/stack/` | mobile | 58.9 KB | 390×844 | 390/390 | 0px | 1891 | 0 | 0 | 0 | 0 | 0 |
| `rules-COL-CODE-001__desktop.png` | `/rules/COL-CODE-001/` | desktop | 164.5 KB | 1440×900 | 1440/1440 | 0px | 1667 | 0 | 0 | 0 | 0 | 0 |
| `rules-COL-CODE-001__tablet.png` | `/rules/COL-CODE-001/` | tablet | 139.0 KB | 1024×768 | 1024/1024 | 0px | 1854 | 0 | 0 | 0 | 0 | 0 |
| `rules-COL-CODE-001__mobile.png` | `/rules/COL-CODE-001/` | mobile | 65.8 KB | 390×844 | 390/390 | 0px | 2818 | 0 | 0 | 0 | 0 | 0 |
| `rules-REL-LOG-002__desktop.png` | `/rules/REL-LOG-002/` | desktop | 165.7 KB | 1440×900 | 1440/1440 | 0px | 1556 | 0 | 0 | 0 | 0 | 0 |
| `rules-REL-LOG-002__tablet.png` | `/rules/REL-LOG-002/` | tablet | 145.1 KB | 1024×768 | 1024/1024 | 0px | 1683 | 0 | 0 | 0 | 0 | 0 |
| `rules-REL-LOG-002__mobile.png` | `/rules/REL-LOG-002/` | mobile | 71.2 KB | 390×844 | 390/390 | 0px | 2636 | 0 | 0 | 0 | 0 | 0 |
| `rules-WEB-DTO-001__desktop.png` | `/rules/WEB-DTO-001/` | desktop | 188.3 KB | 1440×900 | 1440/1440 | 0px | 1540 | 0 | 0 | 0 | 0 | 0 |
| `rules-WEB-DTO-001__tablet.png` | `/rules/WEB-DTO-001/` | tablet | 159.8 KB | 1024×768 | 1024/1024 | 0px | 1667 | 0 | 0 | 0 | 0 | 0 |
| `rules-WEB-DTO-001__mobile.png` | `/rules/WEB-DTO-001/` | mobile | 75.3 KB | 390×844 | 390/390 | 0px | 2660 | 0 | 0 | 0 | 0 | 0 |
| `blueprints-virtual-thread__desktop.png` | `/blueprints/virtual-thread/` | desktop | 130.1 KB | 1440×900 | 1440/1440 | 0px | 1598 | 0 | 0 | 0 | 0 | 0 |
| `blueprints-virtual-thread__tablet.png` | `/blueprints/virtual-thread/` | tablet | 101.7 KB | 1024×768 | 1024/1024 | 0px | 1674 | 0 | 0 | 0 | 0 | 0 |
| `blueprints-virtual-thread__mobile.png` | `/blueprints/virtual-thread/` | mobile | 59.7 KB | 390×844 | 390/390 | 0px | 2465 | 0 | 0 | 0 | 0 | 0 |
| `cases-async-pipeline__desktop.png` | `/cases/async-pipeline/` | desktop | 223.7 KB | 1440×900 | 1440/1440 | 0px | 15066 | 0 | 0 | 0 | 0 | 0 |
| `cases-async-pipeline__tablet.png` | `/cases/async-pipeline/` | tablet | 134.6 KB | 1024×768 | 1024/1024 | 0px | 17049 | 0 | 0 | 0 | 0 | 0 |
| `cases-async-pipeline__mobile.png` | `/cases/async-pipeline/` | mobile | 63.8 KB | 390×844 | 390/390 | 0px | 19906 | 0 | 0 | 0 | 0 | 0 |
| `cases-huge-rowcount-rdb__desktop.png` | `/cases/huge-rowcount-rdb/` | desktop | 201.8 KB | 1440×900 | 1440/1440 | 0px | 17737 | 0 | 0 | 0 | 0 | 0 |
| `cases-huge-rowcount-rdb__tablet.png` | `/cases/huge-rowcount-rdb/` | tablet | 128.2 KB | 1024×768 | 1024/1024 | 0px | 20371 | 0 | 0 | 0 | 0 | 0 |
| `cases-huge-rowcount-rdb__mobile.png` | `/cases/huge-rowcount-rdb/` | mobile | 54.2 KB | 390×844 | 390/390 | 0px | 23510 | 0 | 0 | 0 | 0 | 0 |
| `cases-wide-table-search__desktop.png` | `/cases/wide-table-search/` | desktop | 213.9 KB | 1440×900 | 1440/1440 | 0px | 15426 | 0 | 0 | 0 | 0 | 0 |
| `cases-wide-table-search__tablet.png` | `/cases/wide-table-search/` | tablet | 132.6 KB | 1024×768 | 1024/1024 | 0px | 17339 | 0 | 0 | 0 | 0 | 0 |
| `cases-wide-table-search__mobile.png` | `/cases/wide-table-search/` | mobile | 62.5 KB | 390×844 | 390/390 | 0px | 19896 | 0 | 0 | 0 | 0 | 0 |

## 横向溢出的元凶（0 张有溢出）

（无 —— 全部 51 张 scrollWidth === clientWidth）

## pageerror 全文（0 条）

（无）

## console.error 全文（6 条）

- `archify__desktop.png`：Access to fetch at 'http://localhost:3011/api/archify' from origin 'http://127.0.0.1:3021' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource. If an opaque response serves your needs, set the request's mode to 'no-cors' to fetch the resource with CORS disabled.
  - at: http://127.0.0.1:3021/archify/:0
- `archify__desktop.png`：Failed to load resource: net::ERR_FAILED
  - at: http://localhost:3011/api/archify:0
- `archify__tablet.png`：Access to fetch at 'http://localhost:3011/api/archify' from origin 'http://127.0.0.1:3021' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource. If an opaque response serves your needs, set the request's mode to 'no-cors' to fetch the resource with CORS disabled.
  - at: http://127.0.0.1:3021/archify/:0
- `archify__tablet.png`：Failed to load resource: net::ERR_FAILED
  - at: http://localhost:3011/api/archify:0
- `archify__mobile.png`：Access to fetch at 'http://localhost:3011/api/archify' from origin 'http://127.0.0.1:3021' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource. If an opaque response serves your needs, set the request's mode to 'no-cors' to fetch the resource with CORS disabled.
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
- 退出码 1 的条件：截图数 ≠ 51、任一张 ≤ 8KB、**未申报的** pageerror/console.error/requestfailed/HTTP≥400 任一非 0、URL 发现数 ≠ 17。

## 相关文件

- `visual/findings.md` —— V-2 逐张看图的人工判读结论（21 条，含 P0）
- `visual/reverse-validation.md` —— **反向验证四段**（注入 / 变红 / 还原 / 复绿）逐字原文
- `visual/evidence/` —— findings 引用的那几张位图（`visual/shots/**` 不入库）
