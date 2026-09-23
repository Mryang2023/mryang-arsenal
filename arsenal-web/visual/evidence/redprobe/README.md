# 反向验证的原始输出（红证据留档）

> 这些 `.txt` 是 **原样落盘的终端输出**，不是整理过的摘要。
> 引用它们的文档是 `visual/reverse-validation.md`（人读的结论）与 `visual/findings.md`（修复台账）。
> 留档的理由：那份文档里写着「下面每个数字都是从终端里原样贴出来的」——
> 这句话要能被核对，就不能只留转述。

## 两组文件

### `red-*.txt` —— A1–A7 七项断言逐条变红

| 文件 | 注入 | 结果 |
|---|---|---|
| `red-a1-spec.txt` | `main { width: 3000px !important }`（plan-5 §V-3 指定的那一条） | A1 红 15 张（只有 mobile 档）：`scrollWidth 3000 - clientWidth 390 = 2610px`；A2 连带 15 张 |
| `red-a1b-flexbasis.txt` | `main { flex-basis: 3000px !important }` | **全绿** —— 一次被推翻的直觉（`flex-shrink:1` + `max-w-[1500px]` 把它压回容器） |
| `red-a1c-allafter.txt` | `body::after { width: 3000px }`（绕开 flex 收缩） | A1 红 **45/45**（1560 / 1976 / 2610px），A2 保持绿 |
| `red-rest-combined.txt` | A2 隔离 + 图片 404 + sticky 重叠 + 低对比度 + 重复 h1 + 底部假高度 六项合并 | A2–A7 全红且各带实际值；**A1 保持绿** —— 与 `red-a1c` 合起来构成 A1↔A2 的双向隔离证明 |

注入手法见 `visual/reverse-validation.md`：**改的是 `out/`（构建产物），不是 `src/`** ——
断言测的是 DOM，改产物与改页面等价，而且不存在「忘了还原、把探针提交进仓库」这个事故面。

### `chain-*.txt` —— 视觉层挂链后，四处新守门逐条验红

| 文件 | 改坏什么 | 结果 |
|---|---|---|
| `chain-R1-page-broken.txt` | 往页面注入 A1 坏样式 | 本层红：`实测 11 项 / 失败 1 项`，退出码 1，明细带 45 张的实际溢出量 |
| `chain-R2-declared-off.txt` | 档案里视觉层声明值 12 → 11 | 层内自判负：`✗ 本层项数对不上档案：声明 11 / 实测 12`，退出码 1 |
| `chain-R2-meta.txt` | 同上（同一注入下跑元核对） | 元核对红：`✗ 元核对：视觉断言 自带的声明值 = 元核对读到的档案值`（陈旧状态文件撞上已还原档案，正是那一类真实事故面） |
| `chain-R3-readme-total.txt` | README 总数句 674 → 673 | 元核对红：`✗ README 总数句 = 各层声明之和（README 673 / 档案 674）` |
| `chain-R4-not-registered.txt` | 把视觉层从 `meta-check.ts` 的 `CHAIN_ORDER` 摘掉 | 元核对两条红：`比对范围：档案里没有元核对不认识的层` + `.verify/tmp 里没有链接外的 layer-*.json 残留` |
| `chain-R5-no-out.txt` | 把 `out/` 移走 | 整层跳过：退出码 **2**、`countSource: declared`、`pass 0`（**这一例还抓出了本层自己的一个记账 bug** —— 前置 `check` 放在守卫之前时打出「实测 1 项 / 跳过 12 项」= 13 ≠ 声明 12，已修） |

## 两点如实说明

1. **驱动器是一次性的**（`redprobe.py` / `chain-redprobe.py`，落在 `.workbuddy/_p01/`，
   按仓库约定用完即删）。它写死了本机的 node / python 路径，**不宜当工具长期留**；
   这里留的是它的**输出**。要复现，照 `reverse-validation.md` 里那几段 CSS 注入做即可。
2. 每一例都打印了 `还原 HTML=✓ CSS=✓`（真的比 md5，不是看着像还原了），
   且跑之前先探 3021 端口 —— **已有站点在跑就拒跑**，免得测到别人的站点却当成自己的证据。
