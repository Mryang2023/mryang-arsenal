# V-1 截图矩阵 · 人读报告

- 生成时间：2026-10-05T08:11:51.008Z
- 站点：`http://127.0.0.1:3033`（静态导出 `out/`，深色单主题）
- 矩阵：33 个 URL × 3 个视口 = **99 张**
- 截图范围：`viewport`（视口尺寸 —— 整页图在长页上完全不可判读，见脚本里 FULL_PAGE 的注释）
- 折叠线以下：由 `metrics.scrollHeight` 与越界元素清单量化；像素级逐段判读归 V-6/V-3，**本棒未做**

## 闸门

两档：**意外**失败让退出码变 1；**已申报基线**只计数、只打印，`--strict` 可让它们照常算失败。

| 判据 | 期望 | 实测（意外 / 已申报） | 结果 |
|---|---|---|---|
| 截图数 | 96 | 99 | ❌ |
| 每张字节数 | > 8192 | 最小 47701（stack-step-delivery__mobile.png） | ✅ |
| URL 发现数 | 32 | 33 | ❌ |
| pageerror | 0 | 0 / 0 | ✅ |
| console.error | 0 | 0 / 6 | ✅ |
| requestfailed | 0 | 389 / 3 | ❌ |
| HTTP ≥400 | 0 | 0 / 0 | ✅ |

**退出码：1（有意外失败）**

### 未过的闸门（原文）

- URL 发现不符预期：URL 总数 33 ≠ 预期 32
- 截图数 99 ≠ 期望 96
- 未申报的 requestfailed 共 389 条（期望 0）

### 已申报基线问题（不计入闸门，但必须被人看见）

| id | 条数 | 原因 | 归属 |
|---|---|---|---|
| `archify-backend-down` | 9 | src/lib/arsenal-api.ts:16 硬编码 DEFAULT_BASE = http://localhost:3011；静态导出站（output:export）挂载即请求 /api/archify，后端未起则必然失败。真实缺陷，见 findings.md F-06。 | findings.md |

- `archify-backend-down`：
  - `archify__desktop.png` · console ·  http://127.0.0.1:3033/archify/
  - `archify__desktop.png` · console ·  http://localhost:3011/api/archify
  - `archify__tablet.png` · console ·  http://127.0.0.1:3033/archify/
  - `archify__tablet.png` · console ·  http://localhost:3011/api/archify
  - `archify__mobile.png` · console ·  http://127.0.0.1:3033/archify/
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
| 6 | `/charter/` | 固定页 | `out/charter/index.html` |
| 7 | `/check/` | 固定页 | `out/check/index.html` |
| 8 | `/export/` | 固定页 | `out/export/index.html` |
| 9 | `/icons/` | 固定页 | `out/icons/index.html` |
| 10 | `/rules/` | 固定页 | `out/rules/index.html` |
| 11 | `/stack/` | 固定页 | `out/stack/index.html` |
| 12 | `/stack/delivery/` | 固定页 | `out/stack/delivery/index.html` |
| 13 | `/stack/env/` | 固定页 | `out/stack/env/index.html` |
| 14 | `/stack/run/` | 固定页 | `out/stack/run/index.html` |
| 15 | `/stack/step/base/` | 固定页 | `out/stack/step/base/index.html` |
| 16 | `/stack/step/deliverRun/` | 固定页 | `out/stack/step/deliverRun/index.html` |
| 17 | `/stack/step/delivery/` | 固定页 | `out/stack/step/delivery/index.html` |
| 18 | `/stack/step/env/` | 固定页 | `out/stack/step/env/index.html` |
| 19 | `/stack/step/frontend/` | 固定页 | `out/stack/step/frontend/index.html` |
| 20 | `/stack/step/layers/` | 固定页 | `out/stack/step/layers/index.html` |
| 21 | `/stack/step/modules/` | 固定页 | `out/stack/step/modules/index.html` |
| 22 | `/stack/step/project/` | 固定页 | `out/stack/step/project/index.html` |
| 23 | `/stack/step/theme/` | 固定页 | `out/stack/step/theme/index.html` |
| 24 | `/stack/step/topology/` | 固定页 | `out/stack/step/topology/index.html` |
| 25 | `/standards/` | 固定页 | `out/standards/index.html` |
| 26 | `/rules/COL-CODE-001/` | 规则详情（池 69，取第 1） | `out/rules/COL-CODE-001/index.html` |
| 27 | `/rules/REL-LOG-002/` | 规则详情（池 69，取第 35） | `out/rules/REL-LOG-002/index.html` |
| 28 | `/rules/WEB-DTO-001/` | 规则详情（池 69，取第 69） | `out/rules/WEB-DTO-001/index.html` |
| 29 | `/blueprints/connection-pool/` | 蓝图详情（池 6，取第 1） | `out/blueprints/connection-pool/index.html` |
| 30 | `/blueprints/web-layer/` | 蓝图详情（池 6，取第 6） | `out/blueprints/web-layer/index.html` |
| 31 | `/cases/async-pipeline/` | 场景操作台（池 9，取第 1） | `out/cases/async-pipeline/index.html` |
| 32 | `/cases/huge-rowcount-rdb/` | 场景操作台（池 9，取第 5） | `out/cases/huge-rowcount-rdb/index.html` |
| 33 | `/cases/wide-table-search/` | 场景操作台（池 9，取第 9） | `out/cases/wide-table-search/index.html` |

## 截图明细

| 文件 | 路由 | 视口 | 字节 | 尺寸(视口) | scrollW/clientW | 横向溢出 | scrollH | img 失败 | pageerror | console.err | reqfail | 4xx |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `home__desktop.png` | `/` | desktop | 210.5 KB | 1440×900 | 1440/1440 | 0px | 4287 | 0 | 0 | 0 | 3 | 0 |
| `home__tablet.png` | `/` | tablet | 164.7 KB | 1024×768 | 1024/1024 | 0px | 4801 | 0 | 0 | 0 | 2 | 0 |
| `home__mobile.png` | `/` | mobile | 107.0 KB | 390×844 | 390/390 | 0px | 8591 | 0 | 0 | 0 | 1 | 0 |
| `arch__desktop.png` | `/arch/` | desktop | 152.9 KB | 1440×900 | 1440/1440 | 0px | 1352 | 0 | 0 | 0 | 8 | 0 |
| `arch__tablet.png` | `/arch/` | tablet | 109.5 KB | 1024×768 | 1024/1024 | 0px | 1352 | 0 | 0 | 0 | 4 | 0 |
| `arch__mobile.png` | `/arch/` | mobile | 47.8 KB | 390×844 | 390/390 | 0px | 1112 | 0 | 0 | 0 | 4 | 0 |
| `archify__desktop.png` | `/archify/` | desktop | 139.3 KB | 1440×900 | 1440/1440 | 0px | 1352 | 0 | 0 | 2 | 1 | 0 |
| `archify__tablet.png` | `/archify/` | tablet | 121.5 KB | 1024×768 | 1024/1024 | 0px | 1352 | 0 | 0 | 2 | 5 | 0 |
| `archify__mobile.png` | `/archify/` | mobile | 56.0 KB | 390×844 | 390/390 | 0px | 1588 | 0 | 0 | 2 | 5 | 0 |
| `blueprints__desktop.png` | `/blueprints/` | desktop | 176.4 KB | 1440×900 | 1440/1440 | 0px | 1352 | 0 | 0 | 0 | 5 | 0 |
| `blueprints__tablet.png` | `/blueprints/` | tablet | 127.9 KB | 1024×768 | 1024/1024 | 0px | 1619 | 0 | 0 | 0 | 1 | 0 |
| `blueprints__mobile.png` | `/blueprints/` | mobile | 58.5 KB | 390×844 | 390/390 | 0px | 3085 | 0 | 0 | 0 | 0 | 0 |
| `cases__desktop.png` | `/cases/` | desktop | 214.5 KB | 1440×900 | 1440/1440 | 0px | 1753 | 0 | 0 | 0 | 4 | 0 |
| `cases__tablet.png` | `/cases/` | tablet | 163.2 KB | 1024×768 | 1024/1024 | 0px | 2147 | 0 | 0 | 0 | 1 | 0 |
| `cases__mobile.png` | `/cases/` | mobile | 95.6 KB | 390×844 | 390/390 | 0px | 3211 | 0 | 0 | 0 | 4 | 0 |
| `charter__desktop.png` | `/charter/` | desktop | 147.9 KB | 1440×900 | 1440/1440 | 0px | 2848 | 0 | 0 | 0 | 4 | 0 |
| `charter__tablet.png` | `/charter/` | tablet | 112.4 KB | 1024×768 | 1024/1024 | 0px | 3212 | 0 | 0 | 0 | 6 | 0 |
| `charter__mobile.png` | `/charter/` | mobile | 54.6 KB | 390×844 | 390/390 | 0px | 5085 | 0 | 0 | 0 | 1 | 0 |
| `check__desktop.png` | `/check/` | desktop | 116.5 KB | 1440×900 | 1440/1440 | 0px | 2869 | 0 | 0 | 0 | 10 | 0 |
| `check__tablet.png` | `/check/` | tablet | 95.2 KB | 1024×768 | 1024/1024 | 0px | 2967 | 0 | 0 | 0 | 2 | 0 |
| `check__mobile.png` | `/check/` | mobile | 60.3 KB | 390×844 | 390/390 | 0px | 4353 | 0 | 0 | 0 | 1 | 0 |
| `export__desktop.png` | `/export/` | desktop | 182.6 KB | 1440×900 | 1440/1440 | 0px | 1352 | 0 | 0 | 0 | 1 | 0 |
| `export__tablet.png` | `/export/` | tablet | 118.6 KB | 1024×768 | 1024/1024 | 0px | 1352 | 0 | 0 | 0 | 3 | 0 |
| `export__mobile.png` | `/export/` | mobile | 47.0 KB | 390×844 | 390/390 | 0px | 2240 | 0 | 0 | 0 | 4 | 0 |
| `icons__desktop.png` | `/icons/` | desktop | 188.7 KB | 1440×900 | 1440/1440 | 0px | 3425 | 0 | 0 | 0 | 3 | 0 |
| `icons__tablet.png` | `/icons/` | tablet | 140.3 KB | 1024×768 | 1024/1024 | 0px | 4137 | 0 | 0 | 0 | 2 | 0 |
| `icons__mobile.png` | `/icons/` | mobile | 89.6 KB | 390×844 | 390/390 | 0px | 8298 | 0 | 0 | 0 | 3 | 0 |
| `rules__desktop.png` | `/rules/` | desktop | 145.4 KB | 1440×900 | 1440/1440 | 0px | 7042 | 0 | 0 | 0 | 9 | 0 |
| `rules__tablet.png` | `/rules/` | tablet | 109.5 KB | 1024×768 | 1024/1024 | 0px | 8009 | 0 | 0 | 0 | 6 | 0 |
| `rules__mobile.png` | `/rules/` | mobile | 52.2 KB | 390×844 | 390/390 | 0px | 15375 | 0 | 0 | 0 | 2 | 0 |
| `stack__desktop.png` | `/stack/` | desktop | 144.0 KB | 1440×900 | 1440/1440 | 0px | 1352 | 0 | 0 | 0 | 2 | 0 |
| `stack__tablet.png` | `/stack/` | tablet | 105.4 KB | 1024×768 | 1024/1024 | 0px | 1352 | 0 | 0 | 0 | 7 | 0 |
| `stack__mobile.png` | `/stack/` | mobile | 52.2 KB | 390×844 | 390/390 | 0px | 1951 | 0 | 0 | 0 | 1 | 0 |
| `stack-delivery__desktop.png` | `/stack/delivery/` | desktop | 129.3 KB | 1440×900 | 1440/1440 | 0px | 1756 | 0 | 0 | 0 | 1 | 0 |
| `stack-delivery__tablet.png` | `/stack/delivery/` | tablet | 86.2 KB | 1024×768 | 1024/1024 | 0px | 2088 | 0 | 0 | 0 | 3 | 0 |
| `stack-delivery__mobile.png` | `/stack/delivery/` | mobile | 46.9 KB | 390×844 | 390/390 | 0px | 3051 | 0 | 0 | 0 | 1 | 0 |
| `stack-env__desktop.png` | `/stack/env/` | desktop | 121.0 KB | 1440×900 | 1440/1440 | 0px | 1352 | 0 | 0 | 0 | 2 | 0 |
| `stack-env__tablet.png` | `/stack/env/` | tablet | 103.2 KB | 1024×768 | 1024/1024 | 0px | 1352 | 0 | 0 | 0 | 1 | 0 |
| `stack-env__mobile.png` | `/stack/env/` | mobile | 50.8 KB | 390×844 | 390/390 | 0px | 1528 | 0 | 0 | 0 | 0 | 0 |
| `stack-run__desktop.png` | `/stack/run/` | desktop | 163.2 KB | 1440×900 | 1440/1440 | 0px | 3847 | 0 | 0 | 0 | 2 | 0 |
| `stack-run__tablet.png` | `/stack/run/` | tablet | 112.8 KB | 1024×768 | 1024/1024 | 0px | 4140 | 0 | 0 | 0 | 1 | 0 |
| `stack-run__mobile.png` | `/stack/run/` | mobile | 57.1 KB | 390×844 | 390/390 | 0px | 8441 | 0 | 0 | 0 | 2 | 0 |
| `stack-step-base__desktop.png` | `/stack/step/base/` | desktop | 140.7 KB | 1440×900 | 1440/1440 | 0px | 1381 | 0 | 0 | 0 | 8 | 0 |
| `stack-step-base__tablet.png` | `/stack/step/base/` | tablet | 104.7 KB | 1024×768 | 1024/1024 | 0px | 1437 | 0 | 0 | 0 | 4 | 0 |
| `stack-step-base__mobile.png` | `/stack/step/base/` | mobile | 52.0 KB | 390×844 | 390/390 | 0px | 2693 | 0 | 0 | 0 | 2 | 0 |
| `stack-step-deliverRun__desktop.png` | `/stack/step/deliverRun/` | desktop | 162.9 KB | 1440×900 | 1440/1440 | 0px | 3847 | 0 | 0 | 0 | 1 | 0 |
| `stack-step-deliverRun__tablet.png` | `/stack/step/deliverRun/` | tablet | 112.5 KB | 1024×768 | 1024/1024 | 0px | 4140 | 0 | 0 | 0 | 4 | 0 |
| `stack-step-deliverRun__mobile.png` | `/stack/step/deliverRun/` | mobile | 56.7 KB | 390×844 | 390/390 | 0px | 8441 | 0 | 0 | 0 | 5 | 0 |
| `stack-step-delivery__desktop.png` | `/stack/step/delivery/` | desktop | 129.0 KB | 1440×900 | 1440/1440 | 0px | 1756 | 0 | 0 | 0 | 1 | 0 |
| `stack-step-delivery__tablet.png` | `/stack/step/delivery/` | tablet | 86.0 KB | 1024×768 | 1024/1024 | 0px | 2088 | 0 | 0 | 0 | 7 | 0 |
| `stack-step-delivery__mobile.png` | `/stack/step/delivery/` | mobile | 46.6 KB | 390×844 | 390/390 | 0px | 3051 | 0 | 0 | 0 | 1 | 0 |
| `stack-step-env__desktop.png` | `/stack/step/env/` | desktop | 109.8 KB | 1440×900 | 1440/1440 | 0px | 1352 | 0 | 0 | 0 | 1 | 0 |
| `stack-step-env__tablet.png` | `/stack/step/env/` | tablet | 96.7 KB | 1024×768 | 1024/1024 | 0px | 1352 | 0 | 0 | 0 | 5 | 0 |
| `stack-step-env__mobile.png` | `/stack/step/env/` | mobile | 51.4 KB | 390×844 | 390/390 | 0px | 1914 | 0 | 0 | 0 | 1 | 0 |
| `stack-step-frontend__desktop.png` | `/stack/step/frontend/` | desktop | 120.6 KB | 1440×900 | 1440/1440 | 0px | 1352 | 0 | 0 | 0 | 4 | 0 |
| `stack-step-frontend__tablet.png` | `/stack/step/frontend/` | tablet | 102.9 KB | 1024×768 | 1024/1024 | 0px | 1352 | 0 | 0 | 0 | 2 | 0 |
| `stack-step-frontend__mobile.png` | `/stack/step/frontend/` | mobile | 50.3 KB | 390×844 | 390/390 | 0px | 1528 | 0 | 0 | 0 | 0 | 0 |
| `stack-step-layers__desktop.png` | `/stack/step/layers/` | desktop | 119.8 KB | 1440×900 | 1440/1440 | 0px | 2818 | 0 | 0 | 0 | 9 | 0 |
| `stack-step-layers__tablet.png` | `/stack/step/layers/` | tablet | 91.6 KB | 1024×768 | 1024/1024 | 0px | 3577 | 0 | 0 | 0 | 5 | 0 |
| `stack-step-layers__mobile.png` | `/stack/step/layers/` | mobile | 54.6 KB | 390×844 | 390/390 | 0px | 6387 | 0 | 0 | 0 | 3 | 0 |
| `stack-step-modules__desktop.png` | `/stack/step/modules/` | desktop | 96.3 KB | 1440×900 | 1440/1440 | 0px | 1352 | 0 | 0 | 0 | 5 | 0 |
| `stack-step-modules__tablet.png` | `/stack/step/modules/` | tablet | 86.8 KB | 1024×768 | 1024/1024 | 0px | 1352 | 0 | 0 | 0 | 10 | 0 |
| `stack-step-modules__mobile.png` | `/stack/step/modules/` | mobile | 54.4 KB | 390×844 | 390/390 | 0px | 1236 | 0 | 0 | 0 | 9 | 0 |
| `stack-step-project__desktop.png` | `/stack/step/project/` | desktop | 143.6 KB | 1440×900 | 1440/1440 | 0px | 1352 | 0 | 0 | 0 | 9 | 0 |
| `stack-step-project__tablet.png` | `/stack/step/project/` | tablet | 105.1 KB | 1024×768 | 1024/1024 | 0px | 1352 | 0 | 0 | 0 | 6 | 0 |
| `stack-step-project__mobile.png` | `/stack/step/project/` | mobile | 51.9 KB | 390×844 | 390/390 | 0px | 1951 | 0 | 0 | 0 | 7 | 0 |
| `stack-step-theme__desktop.png` | `/stack/step/theme/` | desktop | 153.3 KB | 1440×900 | 1440/1440 | 0px | 1354 | 0 | 0 | 0 | 4 | 0 |
| `stack-step-theme__tablet.png` | `/stack/step/theme/` | tablet | 108.8 KB | 1024×768 | 1024/1024 | 0px | 1647 | 0 | 0 | 0 | 2 | 0 |
| `stack-step-theme__mobile.png` | `/stack/step/theme/` | mobile | 50.3 KB | 390×844 | 390/390 | 0px | 2802 | 0 | 0 | 0 | 3 | 0 |
| `stack-step-topology__desktop.png` | `/stack/step/topology/` | desktop | 179.4 KB | 1440×900 | 1440/1440 | 0px | 1949 | 0 | 0 | 0 | 7 | 0 |
| `stack-step-topology__tablet.png` | `/stack/step/topology/` | tablet | 106.1 KB | 1024×768 | 1024/1024 | 0px | 3778 | 0 | 0 | 0 | 2 | 0 |
| `stack-step-topology__mobile.png` | `/stack/step/topology/` | mobile | 51.4 KB | 390×844 | 390/390 | 0px | 4437 | 0 | 0 | 0 | 5 | 0 |
| `standards__desktop.png` | `/standards/` | desktop | 147.9 KB | 1440×900 | 1440/1440 | 0px | 2848 | 0 | 0 | 0 | 3 | 0 |
| `standards__tablet.png` | `/standards/` | tablet | 112.4 KB | 1024×768 | 1024/1024 | 0px | 3212 | 0 | 0 | 0 | 6 | 0 |
| `standards__mobile.png` | `/standards/` | mobile | 54.6 KB | 390×844 | 390/390 | 0px | 5085 | 0 | 0 | 0 | 2 | 0 |
| `rules-COL-CODE-001__desktop.png` | `/rules/COL-CODE-001/` | desktop | 143.5 KB | 1440×900 | 1440/1440 | 0px | 1682 | 0 | 0 | 0 | 11 | 0 |
| `rules-COL-CODE-001__tablet.png` | `/rules/COL-CODE-001/` | tablet | 117.9 KB | 1024×768 | 1024/1024 | 0px | 1875 | 0 | 0 | 0 | 3 | 0 |
| `rules-COL-CODE-001__mobile.png` | `/rules/COL-CODE-001/` | mobile | 62.6 KB | 390×844 | 390/390 | 0px | 2891 | 0 | 0 | 0 | 2 | 0 |
| `rules-REL-LOG-002__desktop.png` | `/rules/REL-LOG-002/` | desktop | 144.7 KB | 1440×900 | 1440/1440 | 0px | 1568 | 0 | 0 | 0 | 5 | 0 |
| `rules-REL-LOG-002__tablet.png` | `/rules/REL-LOG-002/` | tablet | 123.0 KB | 1024×768 | 1024/1024 | 0px | 1699 | 0 | 0 | 0 | 6 | 0 |
| `rules-REL-LOG-002__mobile.png` | `/rules/REL-LOG-002/` | mobile | 64.4 KB | 390×844 | 390/390 | 0px | 2703 | 0 | 0 | 0 | 0 | 0 |
| `rules-WEB-DTO-001__desktop.png` | `/rules/WEB-DTO-001/` | desktop | 164.4 KB | 1440×900 | 1440/1440 | 0px | 1551 | 0 | 0 | 0 | 5 | 0 |
| `rules-WEB-DTO-001__tablet.png` | `/rules/WEB-DTO-001/` | tablet | 135.2 KB | 1024×768 | 1024/1024 | 0px | 1683 | 0 | 0 | 0 | 3 | 0 |
| `rules-WEB-DTO-001__mobile.png` | `/rules/WEB-DTO-001/` | mobile | 71.0 KB | 390×844 | 390/390 | 0px | 2728 | 0 | 0 | 0 | 2 | 0 |
| `blueprints-connection-pool__desktop.png` | `/blueprints/connection-pool/` | desktop | 119.3 KB | 1440×900 | 1440/1440 | 0px | 1362 | 0 | 0 | 0 | 5 | 0 |
| `blueprints-connection-pool__tablet.png` | `/blueprints/connection-pool/` | tablet | 88.2 KB | 1024×768 | 1024/1024 | 0px | 1424 | 0 | 0 | 0 | 2 | 0 |
| `blueprints-connection-pool__mobile.png` | `/blueprints/connection-pool/` | mobile | 55.0 KB | 390×844 | 390/390 | 0px | 2119 | 0 | 0 | 0 | 2 | 0 |
| `blueprints-web-layer__desktop.png` | `/blueprints/web-layer/` | desktop | 121.4 KB | 1440×900 | 1440/1440 | 0px | 1385 | 0 | 0 | 0 | 6 | 0 |
| `blueprints-web-layer__tablet.png` | `/blueprints/web-layer/` | tablet | 91.7 KB | 1024×768 | 1024/1024 | 0px | 1424 | 0 | 0 | 0 | 7 | 0 |
| `blueprints-web-layer__mobile.png` | `/blueprints/web-layer/` | mobile | 57.6 KB | 390×844 | 390/390 | 0px | 2108 | 0 | 0 | 0 | 0 | 0 |
| `cases-async-pipeline__desktop.png` | `/cases/async-pipeline/` | desktop | 189.0 KB | 1440×900 | 1440/1440 | 0px | 15411 | 0 | 0 | 0 | 9 | 0 |
| `cases-async-pipeline__tablet.png` | `/cases/async-pipeline/` | tablet | 114.1 KB | 1024×768 | 1024/1024 | 0px | 17518 | 0 | 0 | 0 | 5 | 0 |
| `cases-async-pipeline__mobile.png` | `/cases/async-pipeline/` | mobile | 60.7 KB | 390×844 | 390/390 | 0px | 20487 | 0 | 0 | 0 | 3 | 0 |
| `cases-huge-rowcount-rdb__desktop.png` | `/cases/huge-rowcount-rdb/` | desktop | 172.3 KB | 1440×900 | 1440/1440 | 0px | 18313 | 0 | 0 | 0 | 10 | 0 |
| `cases-huge-rowcount-rdb__tablet.png` | `/cases/huge-rowcount-rdb/` | tablet | 107.6 KB | 1024×768 | 1024/1024 | 0px | 21027 | 0 | 0 | 0 | 8 | 0 |
| `cases-huge-rowcount-rdb__mobile.png` | `/cases/huge-rowcount-rdb/` | mobile | 51.8 KB | 390×844 | 390/390 | 0px | 24253 | 0 | 0 | 0 | 3 | 0 |
| `cases-wide-table-search__desktop.png` | `/cases/wide-table-search/` | desktop | 183.1 KB | 1440×900 | 1440/1440 | 0px | 15775 | 0 | 0 | 0 | 9 | 0 |
| `cases-wide-table-search__tablet.png` | `/cases/wide-table-search/` | tablet | 112.7 KB | 1024×768 | 1024/1024 | 0px | 17783 | 0 | 0 | 0 | 8 | 0 |
| `cases-wide-table-search__mobile.png` | `/cases/wide-table-search/` | mobile | 60.1 KB | 390×844 | 390/390 | 0px | 20448 | 0 | 0 | 0 | 7 | 0 |

## 横向溢出的元凶（0 张有溢出）

（无 —— 全部 99 张 scrollWidth === clientWidth）

## pageerror 全文（0 条）

（无）

## console.error 全文（6 条）

- `archify__desktop.png`：Access to fetch at 'http://localhost:3011/api/archify' from origin 'http://127.0.0.1:3033' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  - at: http://127.0.0.1:3033/archify/:0
- `archify__desktop.png`：Failed to load resource: net::ERR_FAILED
  - at: http://localhost:3011/api/archify:0
- `archify__tablet.png`：Access to fetch at 'http://localhost:3011/api/archify' from origin 'http://127.0.0.1:3033' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  - at: http://127.0.0.1:3033/archify/:0
- `archify__tablet.png`：Failed to load resource: net::ERR_FAILED
  - at: http://localhost:3011/api/archify:0
- `archify__mobile.png`：Access to fetch at 'http://localhost:3011/api/archify' from origin 'http://127.0.0.1:3033' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.
  - at: http://127.0.0.1:3033/archify/:0
- `archify__mobile.png`：Failed to load resource: net::ERR_FAILED
  - at: http://localhost:3011/api/archify:0

## requestfailed 全文（392 条）

- `home__desktop.png`：GET http://127.0.0.1:3033/stack/step/project/index.txt?_rsc=19zvn
  - errorText: net::ERR_ABORTED
- `home__desktop.png`：GET http://127.0.0.1:3033/stack/run/index.txt?_rsc=19zvn
  - errorText: net::ERR_ABORTED
- `home__desktop.png`：GET http://127.0.0.1:3033/standards/index.txt?_rsc=19zvn
  - errorText: net::ERR_ABORTED
- `home__tablet.png`：GET http://127.0.0.1:3033/stack/step/theme/index.txt?_rsc=19zvn
  - errorText: net::ERR_ABORTED
- `home__tablet.png`：GET http://127.0.0.1:3033/stack/delivery/index.txt?_rsc=19zvn
  - errorText: net::ERR_ABORTED
- `home__mobile.png`：GET http://127.0.0.1:3033/icons/index.txt?_rsc=19zvn
  - errorText: net::ERR_ABORTED
- `arch__desktop.png`：GET http://127.0.0.1:3033/stack/step/theme/index.txt?_rsc=1bg04
  - errorText: net::ERR_ABORTED
- `arch__desktop.png`：GET http://127.0.0.1:3033/stack/step/layers/index.txt?_rsc=1bg04
  - errorText: net::ERR_ABORTED
- `arch__desktop.png`：GET http://127.0.0.1:3033/stack/step/topology/index.txt?_rsc=1bg04
  - errorText: net::ERR_ABORTED
- `arch__desktop.png`：GET http://127.0.0.1:3033/stack/delivery/index.txt?_rsc=1bg04
  - errorText: net::ERR_ABORTED
- `arch__desktop.png`：GET http://127.0.0.1:3033/icons/index.txt?_rsc=1bg04
  - errorText: net::ERR_ABORTED
- `arch__desktop.png`：GET http://127.0.0.1:3033/archify/index.txt?_rsc=1bg04
  - errorText: net::ERR_ABORTED
- `arch__desktop.png`：GET http://127.0.0.1:3033/check/index.txt?_rsc=1bg04
  - errorText: net::ERR_ABORTED
- `arch__desktop.png`：GET http://127.0.0.1:3033/standards/index.txt?_rsc=1bg04
  - errorText: net::ERR_ABORTED
- `arch__tablet.png`：GET http://127.0.0.1:3033/index.txt?_rsc=1bg04
  - errorText: net::ERR_ABORTED
- `arch__tablet.png`：GET http://127.0.0.1:3033/rules/index.txt?_rsc=1bg04
  - errorText: net::ERR_ABORTED
- `arch__tablet.png`：GET http://127.0.0.1:3033/stack/delivery/index.txt?_rsc=1bg04
  - errorText: net::ERR_ABORTED
- `arch__tablet.png`：GET http://127.0.0.1:3033/check/index.txt?_rsc=1bg04
  - errorText: net::ERR_ABORTED
- `arch__mobile.png`：GET http://127.0.0.1:3033/index.txt?_rsc=1bg04
  - errorText: net::ERR_ABORTED
- `arch__mobile.png`：GET http://127.0.0.1:3033/rules/index.txt?_rsc=1bg04
  - errorText: net::ERR_ABORTED
- `arch__mobile.png`：GET http://127.0.0.1:3033/blueprints/index.txt?_rsc=1bg04
  - errorText: net::ERR_ABORTED
- `arch__mobile.png`：GET http://127.0.0.1:3033/cases/index.txt?_rsc=1bg04
  - errorText: net::ERR_ABORTED
- `archify__desktop.png`：GET http://localhost:3011/api/archify
  - errorText: net::ERR_FAILED
- `archify__tablet.png`：GET http://localhost:3011/api/archify
  - errorText: net::ERR_FAILED
- `archify__tablet.png`：GET http://127.0.0.1:3033/stack/step/theme/index.txt?_rsc=uu39s
  - errorText: net::ERR_ABORTED
- `archify__tablet.png`：GET http://127.0.0.1:3033/stack/step/layers/index.txt?_rsc=uu39s
  - errorText: net::ERR_ABORTED
- `archify__tablet.png`：GET http://127.0.0.1:3033/stack/env/index.txt?_rsc=uu39s
  - errorText: net::ERR_ABORTED
- `archify__tablet.png`：GET http://127.0.0.1:3033/stack/step/frontend/index.txt?_rsc=uu39s
  - errorText: net::ERR_ABORTED
- `archify__mobile.png`：GET http://localhost:3011/api/archify
  - errorText: net::ERR_FAILED
- `archify__mobile.png`：GET http://127.0.0.1:3033/stack/delivery/index.txt?_rsc=uu39s
  - errorText: net::ERR_ABORTED
- `archify__mobile.png`：GET http://127.0.0.1:3033/arch/index.txt?_rsc=uu39s
  - errorText: net::ERR_ABORTED
- `archify__mobile.png`：GET http://127.0.0.1:3033/icons/index.txt?_rsc=uu39s
  - errorText: net::ERR_ABORTED
- `archify__mobile.png`：GET http://127.0.0.1:3033/check/index.txt?_rsc=uu39s
  - errorText: net::ERR_ABORTED
- `blueprints__desktop.png`：GET http://127.0.0.1:3033/stack/step/layers/index.txt?_rsc=1f4e0
  - errorText: net::ERR_ABORTED
- `blueprints__desktop.png`：GET http://127.0.0.1:3033/stack/env/index.txt?_rsc=1f4e0
  - errorText: net::ERR_ABORTED
- `blueprints__desktop.png`：GET http://127.0.0.1:3033/stack/step/frontend/index.txt?_rsc=1f4e0
  - errorText: net::ERR_ABORTED
- `blueprints__desktop.png`：GET http://127.0.0.1:3033/check/index.txt?_rsc=1f4e0
  - errorText: net::ERR_ABORTED
- `blueprints__desktop.png`：GET http://127.0.0.1:3033/blueprints/local-cache/index.txt?_rsc=1f4e0
  - errorText: net::ERR_ABORTED
- `blueprints__tablet.png`：GET http://127.0.0.1:3033/stack/step/delivery/index.txt?_rsc=1f4e0
  - errorText: net::ERR_ABORTED
- `cases__desktop.png`：GET http://127.0.0.1:3033/index.txt?_rsc=10qeb
  - errorText: net::ERR_ABORTED
- `cases__desktop.png`：GET http://127.0.0.1:3033/stack/delivery/index.txt?_rsc=10qeb
  - errorText: net::ERR_ABORTED
- `cases__desktop.png`：GET http://127.0.0.1:3033/icons/index.txt?_rsc=10qeb
  - errorText: net::ERR_ABORTED
- `cases__desktop.png`：GET http://127.0.0.1:3033/cases/hotspot-cache/index.txt?_rsc=10qeb
  - errorText: net::ERR_ABORTED
- `cases__tablet.png`：GET http://127.0.0.1:3033/stack/step/env/index.txt?_rsc=10qeb
  - errorText: net::ERR_ABORTED
- `cases__mobile.png`：GET http://127.0.0.1:3033/blueprints/index.txt?_rsc=10qeb
  - errorText: net::ERR_ABORTED
- `cases__mobile.png`：GET http://127.0.0.1:3033/arch/index.txt?_rsc=10qeb
  - errorText: net::ERR_ABORTED
- `cases__mobile.png`：GET http://127.0.0.1:3033/export/index.txt?_rsc=10qeb
  - errorText: net::ERR_ABORTED
- `cases__mobile.png`：GET http://127.0.0.1:3033/cases/huge-rowcount-rdb/index.txt?_rsc=10qeb
  - errorText: net::ERR_ABORTED
- …另有 344 条（见 manifest.json）

## HTTP 4xx/5xx 全文（0 条）

（无）

## img 加载失败（naturalWidth===0 且 src 非空）（0 条）

（无）

## 采集口径

- 监听器（`pageerror` / `console` / `requestfailed` / `response`）**在 `page.goto` 之前注册**，按 URL×视口分别累积，不共用数组。
- 每张图附带：截图字节数、`documentElement.scrollWidth/clientWidth`、`scrollHeight`、`img` 失败清单、`h1` 数量、**越界元素清单（最深 5 个）**。
- 退出码 1 的条件：截图数 ≠ 96、任一张 ≤ 8KB、**未申报的** pageerror/console.error/requestfailed/HTTP≥400 任一非 0、URL 发现数 ≠ 32。

## 相关文件

- `visual/findings.md` —— V-2 逐张看图的人工判读结论（21 条，含 P0）
- `visual/reverse-validation.md` —— **反向验证四段**（注入 / 变红 / 还原 / 复绿）逐字原文
- `visual/evidence/` —— findings 引用的那几张位图（`visual/shots/**` 不入库）
