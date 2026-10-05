/**
 * consistency.ts —— 命名一致性（第五层）的纯函数层。
 *
 * 为什么单独一个文件而不是并进 `charter.ts`：那一层算的是**章程文档本身的派生结论**
 * （条款 / 例外 / 债务账），而这一层消费的是**全仓扫描的产物**。
 * 数据来源不同、刷新时机不同（文档随章程 JSON 走，扫描随代码走），
 * 混在一个文件里，将来「扫描没跑」和「章程没配」就会混成同一个空态 ——
 * 而这两件事的处置完全不同。
 *
 * 产物由 `scripts/calc-consistency.mjs` 在 `npm run sync` 时生成（引擎只有一份，
 * 在 `scripts/lib/consistency-engine.mjs`，CI 与构建期共用）。
 */

import raw from '@/generated/consistency.json';

/* ══════════════════════════════════════════════════════════════
   一、类型
   ══════════════════════════════════════════════════════════════ */

export type ConsistencyVariantKind = 'canonical' | 'forbidden' | 'variant';

export interface ConsistencyVariant {
  /** 原始写法的文本（保留大小写，展示用） */
  variant: string;
  kind: ConsistencyVariantKind;
  /** 出现次数 */
  count: number;
  /** 落在几个文件里 */
  files: number;
  samples: { file: string; line: number }[];
}

/**
 * 四种结论，**`no-files` 必须单独存在**：
 * 它是「这条检查当前没在检查任何东西」，不是「检查通过了」。
 * 并进 clean 的话，一个写错 scope 的检查项会永远显示绿 —— 那是摆设最常见的样子。
 */
export type ConsistencyStatus = 'clean' | 'drift' | 'forbidden-hit' | 'no-files';

export interface ConsistencyItemReport {
  id: string;
  concept: string;
  type: string;
  report: 'drift' | 'block';
  scope: string;
  minVariants: number;
  matchedFiles: number;
  scannedFiles: number;
  variantCount: number;
  variants: ConsistencyVariant[];
  forbiddenCount: number;
  status: ConsistencyStatus;
  blocking: boolean;
}

export interface ConsistencyScan {
  schema: string;
  generatedAt: string;
  repo: string;
  charterIds: string[];
  scan: {
    candidateFiles: number;
    skippedLargeOrUnreadable: number;
    includeExts: string[];
    skipDirs: string[];
    elapsedMs: number;
  };
  totals: {
    items: number;
    scanned: number;
    drift: number;
    forbiddenHit: number;
    noFiles: number;
    clean: number;
    blocking: number;
  };
  items: ConsistencyItemReport[];
  notes: string[];
}

export const consistencyScan = raw as unknown as ConsistencyScan;

/* ══════════════════════════════════════════════════════════════
   二、查询
   ══════════════════════════════════════════════════════════════ */

/**
 * 按检查项 id 取扫描结论。
 *
 * 返回 null 表示**这次没有它的结论**（章程里配了但扫描没跑到它）。
 * 与「扫了但 clean」是两件事，调用方必须分开渲染 —— 混成「一致」就是假绿。
 */
export function consistencyFor(id: string): ConsistencyItemReport | null {
  return consistencyScan?.items?.find((r) => r.id === id) ?? null;
}

/**
 * 产物到底有没有（schema 对得上才算）。
 *
 * 为什么不直接判 `items.length > 0`：章程可能一条都没配，那时 items 是空的，
 * 但扫描**确实跑过了** —— 「没配」和「没跑」要分开说。
 */
export function consistencyAvailable(): boolean {
  return consistencyScan?.schema === 'arsenal-consistency/1';
}

/* ══════════════════════════════════════════════════════════════
   三、呈现（色值集中在这里，页面不散写类名）
   ══════════════════════════════════════════════════════════════ */

export function consistencyStatusLabel(status: ConsistencyStatus): string {
  switch (status) {
    case 'no-files':
      return '没在检查任何东西';
    case 'forbidden-hit':
      return '出现禁用写法';
    case 'drift':
      return '漂移';
    case 'clean':
      return '一致';
    default:
      return String(status);
  }
}

/** 状态 → 徽标类名。与 `charter.ts` 的 dispositionToneClass 同约定：色值只在纯函数层。 */
export function consistencyStatusClass(status: ConsistencyStatus): string {
  switch (status) {
    case 'no-files':
      return 'bg-brass/15 text-brass';
    case 'forbidden-hit':
      return 'bg-rust/15 text-rust';
    case 'drift':
      return 'bg-rust/15 text-rust';
    case 'clean':
      return 'bg-olive/15 text-olive';
    default:
      return 'bg-surfaceHi text-fgMuted';
  }
}

/** 写法归类 → 类名（认可 / 禁用 / 变体三色）。 */
export function consistencyVariantClass(kind: ConsistencyVariantKind): string {
  switch (kind) {
    case 'forbidden':
      return 'bg-rust/10 text-rust';
    case 'variant':
      return 'bg-brass/10 text-brass';
    default:
      return 'bg-olive/15 text-olive';
  }
}

export function consistencyKindLabel(kind: ConsistencyVariantKind): string {
  switch (kind) {
    case 'forbidden':
      return '禁用';
    case 'variant':
      return '变体';
    default:
      return '认可';
  }
}

/**
 * 一条人类可读的结论句。
 *
 * 为什么要专门写这个函数：结论句里全是数字（扫了多少文件、几种写法、上限多少），
 * 这类句子最容易在页面里写死或漏项。放在纯函数里，断言能直接读它。
 */
export function consistencyConclusion(r: ConsistencyItemReport): string {
  if (r.status === 'no-files') {
    return `范围 ${r.scope} 没匹配到任何文件 —— 这条检查当前没有在检查任何东西。`;
  }
  const head = `${r.matchedFiles} 个文件里出现 ${r.variantCount} 种写法（认可上限 ${r.minVariants}）`;
  if (r.status === 'forbidden-hit') {
    const names = r.variants.filter((v) => v.kind === 'forbidden').map((v) => v.variant);
    return `${head}；其中 ${names.join('、')} 是明令不许的写法。`;
  }
  if (r.status === 'drift') {
    return `${head}，超过上限 —— 同一个概念正在分裂。`;
  }
  return `${head}，在认可范围内。`;
}
