/**
 * 场景参数 ↔ URL 的编解码（纯函数，`.verify/case-check.ts` 直接当数据跑）。
 *
 * 为什么参数必须进 URL：参数组合是 9072 组，静态导出（output:'export'）**不可能**
 * 按路径穷举 —— 所以 `caseId` 走路径，参数走 query。顺带解决「结果无法分享」：
 * 刷新不丢、链接可发人。
 *
 * 编码：按 `kase.drivers` 的**声明顺序**，每个驱动取其选中档位的下标，
 * 转 36 进制拼成一串（如 `031201`，一字符 = 一个驱动）。
 * 顺序来自 `cases.json`，构建产物确定 ✓（`sensitivity` / `inert` 也是按同一顺序算的）。
 *
 * 解码的两条纪律（都是踩过的坑的形状）：
 *   1. **缺位 / 越界一律回退，绝不抛异常** —— 手改 URL、旧链接、少一位多一位都是常态，
 *      抛异常在静态导出下会变成整页白屏，而白屏比「参数回到推荐档」糟得多。
 *   2. **回退到 `recommended` 而不是第一档** —— 第一档在多数场景命中 0 个切片
 *      （见 `defaultParams` 的注释），那等于把入口变成空屏。
 */

import type { CaseParams, Driver } from '@/lib/case-types';

/** 36 进制：0-9a-z。一个驱动的档位数实测是 3~4，一位字符绰绰有余 */
const BASE = 36;

/** 驱动顺序 = `kase.drivers` 的顺序。encode 与 decode 必须用同一顺序，否则串就换了含义 */
export function encodeParams(drivers: Driver[], params: CaseParams): string {
  return drivers
    .map((d) => {
      const idx = d.levels.findIndex((l) => l.id === params[d.id]);
      // 缺这个键时写 0：宁可落到一个合法的档，也不产出长度不对的串
      return (idx < 0 ? 0 : idx).toString(BASE);
    })
    .join('');
}

/** 回退值：优先用调用方给的（一般是 `defaultParams(kase)`），它不合法才退第一档 */
function fallbackOf(d: Driver, fallback: CaseParams): string {
  const fb = fallback[d.id];
  if (fb && d.levels.some((l) => l.id === fb)) return fb;
  return d.levels[0]?.id ?? '';
}

/**
 * 解码。**不抛**：任何非法输入都退化成回退值。
 *
 * @param fallback 通常是 `defaultParams(kase)`（= `recommended` 补齐）
 */
export function decodeParams(
  drivers: Driver[],
  code: string | null | undefined,
  fallback: CaseParams
): CaseParams {
  // 大写也认：链接在聊天软件里被「智能」改大小写是常事
  const s = String(code ?? '').trim().toLowerCase();
  const out: CaseParams = {};
  drivers.forEach((d, i) => {
    const ch = s[i];
    const idx = ch === undefined ? Number.NaN : Number.parseInt(ch, BASE);
    const ok = Number.isInteger(idx) && idx >= 0 && idx < d.levels.length;
    out[d.id] = ok ? d.levels[idx].id : fallbackOf(d, fallback);
  });
  return out;
}

/** 这个串里有没有任何一位是「非法、被回退掉」的 —— 用于在页面上如实说明，而不是假装认了 */
export function isFullyValid(drivers: Driver[], code: string | null | undefined): boolean {
  const s = String(code ?? '').trim().toLowerCase();
  return drivers.every((_, i) => {
    const ch = s[i];
    const idx = ch === undefined ? Number.NaN : Number.parseInt(ch, BASE);
    return Number.isInteger(idx) && idx >= 0 && idx < drivers[i].levels.length;
  });
}

/**
 * L2 深链。`p` 缺省就不写（推荐档是默认，写 `p=000000` 只会让链接变丑且难以手改）。
 * 尾斜杠是必须的：`next.config.mjs` 开了 `trailingSlash: true`。
 */
export function caseUrl(caseId: string, code?: string | null, symptomId?: string | null): string {
  const q: string[] = [];
  if (code) q.push(`p=${encodeURIComponent(code)}`);
  if (symptomId) q.push(`s=${encodeURIComponent(symptomId)}`);
  return `/cases/${caseId}/${q.length > 0 ? `?${q.join('&')}` : ''}`;
}
