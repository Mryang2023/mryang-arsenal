# V-1 截图矩阵 · 人读报告

- 生成时间：2026-09-23T14:36:16.819Z
- 站点：`http://127.0.0.1:3021`（静态导出 `out/`，深色单主题）
- 矩阵：15 个 URL × 3 个视口 = **45 张**
- 截图范围：`viewport`（视口尺寸 —— 整页图在长页上完全不可判读，见脚本里 FULL_PAGE 的注释）
- 折叠线以下：由 `metrics.scrollHeight` 与越界元素清单量化；像素级逐段判读归 V-6/V-3，**本棒未做**

## 闸门

两档：**意外**失败让退出码变 1；**已申报基线**只计数、只打印，`--strict` 可让它们照常算失败。

| 判据 | 期望 | 实测（意外 / 已申报） | 结果 |
|---|---|---|---|
| 截图数 | 45 | 45 | ✅ |
| 每张字节数 | > 8192 | 最小 52392（export__mobile.png） | ✅ |
| URL 发现数 | 15 | 15 | ✅ |
| pageerror | 0 | 0 / 0 | ✅ |
| console.error | 0 | 0 / 0 | ✅ |
| requestfailed | 0 | 0 / 3 | ✅ |
| HTTP ≥400 | 0 | 0 / 0 | ✅ |

**退出码：0（意外失败为 0）**

### 已申报基线问题（不计入闸门，但必须被人看见）

| id | 条数 | 原因 | 归属 |
|---|---|---|---|
| `archify-backend-down` | 3 | src/lib/arsenal-api.ts:16 硬编码 DEFAULT_BASE = http://localhost:3011；静态导出站（output:export）挂载即请求 /api/archify，后端未起则必然失败。真实缺陷，见 findings.md F-06。 | findings.md |

- `archify-backend-down`：
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
| `home__desktop.png` | `/` | desktop | 223.7 KB | 1440×900 | 1440/1440 | 0px | 4234 | 0 | 0 | 0 | 0 | 0 |
| `home__tablet.png` | `/` | tablet | 177.0 KB | 1024×768 | 1024/1024 | 0px | 4692 | 0 | 0 | 0 | 0 | 0 |
| `home__mobile.png` | `/` | mobile | 113.0 KB | 390×844 | 390/390 | 0px | 8430 | 0 | 0 | 0 | 0 | 0 |
| `arch__desktop.png` | `/arch/` | desktop | 168.3 KB | 1440×900 | 1440/1440 | 0px | 985 | 0 | 0 | 0 | 0 | 0 |
| `arch__tablet.png` | `/arch/` | tablet | 126.4 KB | 1024×768 | 1024/1024 | 0px | 830 | 0 | 0 | 0 | 0 | 0 |
| `arch__mobile.png` | `/arch/` | mobile | 57.5 KB | 390×844 | 390/390 | 0px | 1061 | 0 | 0 | 0 | 0 | 0 |
| `archify__desktop.png` | `/archify/` | desktop | 150.0 KB | 1440×900 | 1440/1440 | 0px | 900 | 0 | 0 | 0 | 1 | 0 |
| `archify__tablet.png` | `/archify/` | tablet | 138.2 KB | 1024×768 | 1024/1024 | 0px | 924 | 0 | 0 | 0 | 1 | 0 |
| `archify__mobile.png` | `/archify/` | mobile | 61.4 KB | 390×844 | 390/390 | 0px | 1570 | 0 | 0 | 0 | 1 | 0 |
| `blueprints__desktop.png` | `/blueprints/` | desktop | 215.3 KB | 1440×900 | 1440/1440 | 0px | 1397 | 0 | 0 | 0 | 0 | 0 |
| `blueprints__tablet.png` | `/blueprints/` | tablet | 173.1 KB | 1024×768 | 1024/1024 | 0px | 1521 | 0 | 0 | 0 | 0 | 0 |
| `blueprints__mobile.png` | `/blueprints/` | mobile | 105.9 KB | 390×844 | 390/390 | 0px | 2864 | 0 | 0 | 0 | 0 | 0 |
| `cases__desktop.png` | `/cases/` | desktop | 253.9 KB | 1440×900 | 1440/1440 | 0px | 1315 | 0 | 0 | 0 | 0 | 0 |
| `cases__tablet.png` | `/cases/` | tablet | 210.3 KB | 1024×768 | 1024/1024 | 0px | 1355 | 0 | 0 | 0 | 0 | 0 |
| `cases__mobile.png` | `/cases/` | mobile | 110.2 KB | 390×844 | 390/390 | 0px | 3134 | 0 | 0 | 0 | 0 | 0 |
| `check__desktop.png` | `/check/` | desktop | 118.0 KB | 1440×900 | 1440/1440 | 0px | 2642 | 0 | 0 | 0 | 0 | 0 |
| `check__tablet.png` | `/check/` | tablet | 98.3 KB | 1024×768 | 1024/1024 | 0px | 2690 | 0 | 0 | 0 | 0 | 0 |
| `check__mobile.png` | `/check/` | mobile | 61.8 KB | 390×844 | 390/390 | 0px | 3910 | 0 | 0 | 0 | 0 | 0 |
| `export__desktop.png` | `/export/` | desktop | 210.6 KB | 1440×900 | 1440/1440 | 0px | 1197 | 0 | 0 | 0 | 0 | 0 |
| `export__tablet.png` | `/export/` | tablet | 140.9 KB | 1024×768 | 1024/1024 | 0px | 1299 | 0 | 0 | 0 | 0 | 0 |
| `export__mobile.png` | `/export/` | mobile | 51.2 KB | 390×844 | 390/390 | 0px | 2199 | 0 | 0 | 0 | 0 | 0 |
| `icons__desktop.png` | `/icons/` | desktop | 204.8 KB | 1440×900 | 1440/1440 | 0px | 3410 | 0 | 0 | 0 | 0 | 0 |
| `icons__tablet.png` | `/icons/` | tablet | 158.9 KB | 1024×768 | 1024/1024 | 0px | 4118 | 0 | 0 | 0 | 0 | 0 |
| `icons__mobile.png` | `/icons/` | mobile | 98.4 KB | 390×844 | 390/390 | 0px | 8248 | 0 | 0 | 0 | 0 | 0 |
| `rules__desktop.png` | `/rules/` | desktop | 160.1 KB | 1440×900 | 1440/1440 | 0px | 6992 | 0 | 0 | 0 | 0 | 0 |
| `rules__tablet.png` | `/rules/` | tablet | 124.3 KB | 1024×768 | 1024/1024 | 0px | 7942 | 0 | 0 | 0 | 0 | 0 |
| `rules__mobile.png` | `/rules/` | mobile | 59.6 KB | 390×844 | 390/390 | 0px | 15219 | 0 | 0 | 0 | 0 | 0 |
| `stack__desktop.png` | `/stack/` | desktop | 160.0 KB | 1440×900 | 1440/1440 | 0px | 8118 | 0 | 0 | 0 | 0 | 0 |
| `stack__tablet.png` | `/stack/` | tablet | 104.0 KB | 1024×768 | 1024/1024 | 0px | 7977 | 0 | 0 | 0 | 0 | 0 |
| `stack__mobile.png` | `/stack/` | mobile | 60.8 KB | 390×844 | 390/390 | 0px | 10550 | 0 | 0 | 0 | 0 | 0 |
| `rules-COL-CODE-001__desktop.png` | `/rules/COL-CODE-001/` | desktop | 164.4 KB | 1440×900 | 1440/1440 | 0px | 1667 | 0 | 0 | 0 | 0 | 0 |
| `rules-COL-CODE-001__tablet.png` | `/rules/COL-CODE-001/` | tablet | 139.0 KB | 1024×768 | 1024/1024 | 0px | 1854 | 0 | 0 | 0 | 0 | 0 |
| `rules-COL-CODE-001__mobile.png` | `/rules/COL-CODE-001/` | mobile | 65.8 KB | 390×844 | 390/390 | 0px | 2818 | 0 | 0 | 0 | 0 | 0 |
| `rules-REL-LOG-002__desktop.png` | `/rules/REL-LOG-002/` | desktop | 165.7 KB | 1440×900 | 1440/1440 | 0px | 1556 | 0 | 0 | 0 | 0 | 0 |
| `rules-REL-LOG-002__tablet.png` | `/rules/REL-LOG-002/` | tablet | 145.1 KB | 1024×768 | 1024/1024 | 0px | 1683 | 0 | 0 | 0 | 0 | 0 |
| `rules-REL-LOG-002__mobile.png` | `/rules/REL-LOG-002/` | mobile | 71.2 KB | 390×844 | 390/390 | 0px | 2636 | 0 | 0 | 0 | 0 | 0 |
| `rules-WEB-DTO-001__desktop.png` | `/rules/WEB-DTO-001/` | desktop | 188.3 KB | 1440×900 | 1440/1440 | 0px | 1540 | 0 | 0 | 0 | 0 | 0 |
| `rules-WEB-DTO-001__tablet.png` | `/rules/WEB-DTO-001/` | tablet | 159.7 KB | 1024×768 | 1024/1024 | 0px | 1667 | 0 | 0 | 0 | 0 | 0 |
| `rules-WEB-DTO-001__mobile.png` | `/rules/WEB-DTO-001/` | mobile | 75.3 KB | 390×844 | 390/390 | 0px | 2660 | 0 | 0 | 0 | 0 | 0 |
| `blueprints-async-transaction__desktop.png` | `/blueprints/async-transaction/` | desktop | 179.5 KB | 1440×900 | 1440/1440 | 0px | 3091 | 0 | 0 | 0 | 0 | 0 |
| `blueprints-async-transaction__tablet.png` | `/blueprints/async-transaction/` | tablet | 138.0 KB | 1024×768 | 1024/1024 | 0px | 3318 | 0 | 0 | 0 | 0 | 0 |
| `blueprints-async-transaction__mobile.png` | `/blueprints/async-transaction/` | mobile | 90.6 KB | 390×844 | 390/390 | 0px | 5263 | 0 | 0 | 0 | 0 | 0 |
| `blueprints-skeleton-config__desktop.png` | `/blueprints/skeleton-config/` | desktop | 178.3 KB | 1440×900 | 1440/1440 | 0px | 3138 | 0 | 0 | 0 | 0 | 0 |
| `blueprints-skeleton-config__tablet.png` | `/blueprints/skeleton-config/` | tablet | 138.1 KB | 1024×768 | 1024/1024 | 0px | 3413 | 0 | 0 | 0 | 0 | 0 |
| `blueprints-skeleton-config__mobile.png` | `/blueprints/skeleton-config/` | mobile | 87.5 KB | 390×844 | 390/390 | 0px | 5142 | 0 | 0 | 0 | 0 | 0 |

## 横向溢出的元凶（0 张有溢出）

（无 —— 全部 45 张 scrollWidth === clientWidth）

## pageerror 全文（0 条）

（无）

## console.error 全文（0 条）

（无）

## requestfailed 全文（3 条）

- `archify__desktop.png`：GET http://localhost:3011/api/archify
  - errorText: net::ERR_ABORTED
- `archify__tablet.png`：GET http://localhost:3011/api/archify
  - errorText: net::ERR_ABORTED
- `archify__mobile.png`：GET http://localhost:3011/api/archify
  - errorText: net::ERR_ABORTED

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
