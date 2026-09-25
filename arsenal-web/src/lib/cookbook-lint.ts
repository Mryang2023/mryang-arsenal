import { lint, type SkippedRule, type SourceFile, type Violation } from './engine';
import { rules } from './rules';
import type { CheckLayer } from './types';

/**
 * 案例代码自证 —— 把我们自己的范例代码喂进我们自己的规则引擎。
 *
 * 「我的范例符合我的规范」以前是一句没被验证过的话：案例库的代码有三种出口
 * （人查 / 给 AI 用 / 能跑），唯独没有人拿规则扫过它。这里补上第三种验证姿势：
 * **拿代码验**。
 *
 * ─────────────────────────────────────────────────────────────
 * ⚠ 硬约定：`files[].code` **只放 good 版**
 *
 * bad 示例一律写进 `pitfalls` 或规则本身的 bad/good 对照里。
 * 理由：引擎是**文本层**判定（check.regex），它分不出「这是在演示错写法」和
 * 「这就是错写法」—— 一旦 files 里混入 bad 示例，自证会把自己的教具当成违规误报，
 * 闸门就从「保护」变成「噪音」，最后被人随手关掉。
 *
 * 这条约定同时写在三处，改任一处都要同步：
 *   1. 本文件（消费方）
 *   2. `tools/build-content.py` 的 `build_cookbook()`（生成方）
 *   3. `.workbuddy/memory/MEMORY.md`（长期约定）
 *
 * ─────────────────────────────────────────────────────────────
 * 三档产出，不伪造判定（沿用 `engine.lint` 的口径）：
 *   · 违规      —— 正则层真跑出来的命中，按 severity 分 MUST/NEVER/SHOULD/MAY
 *   · 可执行    —— 有 `check.regex` 的规则，本次真的判了（executableRules）
 *   · 跳过      —— 需 AST / LLM / 人工的规则，如实记进 skipped，**绝不给假阳性**
 *
 * 一个刻意的设计：`skippedRules` 与 `brokenRules` 分开记。
 * 「这条规则检不了」（AST/LLM）与「这条规则自己的正则编译不过」（规则缺陷）
 * 是两种完全不同的事，合并成一个数就把缺陷藏进了「能力边界」里。
 */

/** 挡住交付的严重度 —— MUST 与 NEVER 违规不允许出现在案例代码里 */
export function isBlocking(v: Violation): boolean {
  return v.severity === 'MUST' || v.severity === 'NEVER';
}

export interface LintableFile {
  path: string;
  code: string;
}

export interface SelfCheckResult {
  /** 参与自证的文件数（0 = 空跑，任何「零违规」结论都不可信） */
  fileCount: number;
  totalLines: number;
  /** 规则池（active 规则总数） */
  rulePool: number;
  /** 本次真的判了的规则数（有 check.regex 且能编译） */
  executableRules: number;
  /** 需 AST / LLM / 人工，本次未判的规则数 —— 如实披露，不伪装成「通过」 */
  skippedRules: number;
  skippedByLayer: { layer: CheckLayer; count: number }[];
  /** 规则自身的正则编译失败（规则缺陷，需要修规则而不是修案例） */
  brokenRules: number;
  violations: Violation[];
  /** MUST / NEVER 违规 —— 非空即闸门红 */
  blocking: Violation[];
  skipped: SkippedRule[];
  /**
   * 引擎耗时（毫秒）。**只给程序读，不许渲染进 DOM** ——
   * 服务端渲染与水合两次跑出来的值不一样，会触发 React #425 水合文本不一致。
   */
  durationMs: number;
}

/**
 * 对一组案例文件跑自证 —— **唯一入口**，徽标与 `.verify`【19】断言走的是同一个函数。
 *
 * 文件名用 `path` 而不是 id —— 引擎的 `targetGlob` 是按路径匹配的，
 * 喂 id 会让所有带 glob 的规则静默不适用（判了等于没判）。
 */
export function lintFeatureFiles(files: LintableFile[]): SelfCheckResult {
  const source: SourceFile[] = files.map((f) => ({ name: f.path, content: f.code ?? '' }));
  const report = lint(source, rules);

  const skipped = report.skipped;
  const byLayer = new Map<CheckLayer, number>();
  for (const s of skipped) byLayer.set(s.layer, (byLayer.get(s.layer) ?? 0) + 1);

  const broken = skipped.filter((s) => s.layer === 'regex');

  return {
    fileCount: report.fileCount,
    totalLines: report.totalLines,
    rulePool: report.rulePool,
    executableRules: report.executableRules,
    skippedRules: skipped.length - broken.length,
    skippedByLayer: [...byLayer.entries()]
      .map(([layer, count]) => ({ layer, count }))
      .sort((a, b) => b.count - a.count || a.layer.localeCompare(b.layer)),
    brokenRules: broken.length,
    violations: report.violations,
    blocking: report.violations.filter(isBlocking),
    skipped,
    durationMs: report.durationMs,
  };
}

/** 徽标用的一句话结论 —— 数字全部来自 result，本文件不存任何写死的计数 */
export function selfCheckSummary(r: SelfCheckResult): string {
  if (r.fileCount === 0) return '没有可自证的代码文件';
  if (r.blocking.length > 0) {
    return `本方案代码 ${r.blocking.length} 条 MUST/NEVER 违规（规则引擎实测）`;
  }
  return (
    `本方案代码 0 违规 · ${r.executableRules} 条可自动判定规则全过 · ` +
    `${r.skippedRules} 条需 AST/LLM 未判（如实披露）`
  );
}
