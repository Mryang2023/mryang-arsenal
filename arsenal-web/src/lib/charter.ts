/**
 * charter.ts —— 项目章程的纯函数层（不引 React、不引绘图库）。
 *
 * 与本仓其它 `src/lib/*.ts` 同一约定：**所有派生结论都在这里算，页面只渲染**。
 * 理由不是洁癖：本仓的断言层（`.verify/charter-check.ts`）能直接 import 纯函数当数据跑 ——
 * 页面里的算法没法被单测驱动，而「冻结线」「债务账」这类计算正是最容易算错的地方。
 *
 * 三个出口对应设计稿 §4.2 的三个页签：
 *   条款列表  — 人查：谁定的、为什么这么定、写成什么样
 *   例外登记簿 — 债务：谁破的例、谁还债、什么时候到期
 *   债务账    — 存量欠账：不是「谁违规了」，是「这套机制在往哪个方向走」
 */

import charterRaw from '@/generated/charter.json';
import type { CategoryKey, RegexCheck, AstCheck, Rule, RuleSource, Severity } from './types';

/* ══════════════════════════════════════════════════════════════
   一、类型
   ══════════════════════════════════════════════════════════════ */

/** 严重度。与 `types.ts` 的 Severity 同枚举，但**不 import 那个文件**：
 *  章程层与规则层是两层数据，各自的封闭枚举在自己的契约里（charter-contract.mjs）。
 *  强行共用一个类型就是「以为两层是一层」—— 而它们的 ID 命名空间、生命周期都不同。 */
export type CharterSeverity = 'MUST' | 'SHOULD' | 'MAY' | 'NEVER';

export type ExceptionStatus = 'active' | 'expired' | 'repaid' | 'orphaned';

export type OverrideAction = 'tighten' | 'relax' | 'replace';

/** 与 `charter-contract.mjs` 的 POLICY_SPEC 同一组取值，**由该文件导出并在此转出**。 */
export type OverduePolicy = 'error' | 'warn' | 'ignore';

export interface CharterClause {
  id: string;
  category: string;
  subcategory?: string;
  title: string;
  severity: CharterSeverity;
  sources: RuleSource[];
  rationale: string;
  appliesTo?: { stack?: string[]; scope?: string; pathGlob?: string };
  bad: string;
  good: string;
  // 复用 `types.ts` 的 RegexCheck / AstCheck 而不是重写形状 —— 写一遍宽类型
  // 会在赋值给 Rule 时报 TS2322（expect 是闭枚举，重写就丢了窄化）。
  check: { regex?: RegexCheck; ast?: AstCheck; llm?: string; manual?: string };
  promptFragment: string;
  tags?: string[];
  status: Rule['status'];
  version: number;
  clauseOwner: string;
  decidedBy: string;
  effectiveFrom: string;
  pathGlob: string;
}

export interface CharterException {
  id: string;
  clauseId: string;
  pathGlob: string;
  reason: string;
  approver: string;
  owner: string;
  grantedAt: string;
  expiresAt: string;
  ticket?: string;
  status: ExceptionStatus;
}

export interface CharterOverride {
  ruleId: string;
  action: OverrideAction;
  reason?: string;
  approver?: string;
  expiresAt?: string;
  replacement?: string;
  pathGlob?: string;
}

export interface CharterConsistency {
  id: string;
  concept: string;
  canonical: string[];
  forbidden?: string[];
  scope: string;
  check: { type: string; minVariants: number; report: 'drift' | 'block' };
}

export interface CharterPolicy {
  overdueException: OverduePolicy;
  orphanBlocks: 'error' | 'warn';
  requireTicket: 'required' | 'optional';
  budgetScope: 'separate' | 'shared';
}

export interface CharterDoc {
  id: string;
  name: string;
  version: string;
  owner: string;
  ratifiedAt: string;
  team: string[];
  extends: string;
  budget: { mustLimit: number };
  policy: CharterPolicy;
  overrides: CharterOverride[];
  clauses: CharterClause[];
  exceptions: CharterException[];
  consistency: CharterConsistency[];
}

export interface CharterEntry {
  id: string;
  clauses: number;
  mustClauses: number;
  mustLimit: number;
  exceptions: number;
  overrides: number;
  consistency: number;
  orphaned: number;
  bySeverity: Record<string, number>;
  byStatus: Record<string, number>;
  team: number;
  doc: CharterDoc;
}

/* ══════════════════════════════════════════════════════════════
   二、事实源接入
   ══════════════════════════════════════════════════════════════ */

/**
 * 快照形状**在此断言一次**，而不是全靠 `as` 强转。
 *
 * 强转的坏处实测过：`src/generated/*.json` 没了或改名时，`as CharterSnapshot`
 * 照样编译通过、页面照样渲染，只是每个字段都是 undefined —— 报错点在渲染深处，
 * 消息是「Cannot read properties of undefined」，与真正的原因隔着三层。
 */
interface CharterSnapshotRaw {
  generatedAt?: string;
  charters?: CharterEntry[];
  totals?: { clauses: number; must: number; exceptions: number; overrides: number; orphaned: number };
  /**
   * L0 侧的 MUST 实测条数与硬上限，由 sync 链写入。
   *
   * 为什么必须由构建期写、而不是页面上算：页面是**静态导出**，渲染时没有文件系统。
   * 而 `policy.budgetScope = 'shared'` 要显示「L0 实测 N + 章程 M / 上限」——
   * 拿不到就显示 0%，那是一个**看起来正常的假数字**。写成字面量更糟：
   * L0 加一条 MUST 时它会静默过期，且没有任何东西会报错。
   */
  l0?: { must?: number; limit?: number; hardLimitDeclared?: number | null };
  /** 构建期写入的当天日期（`ARSENAL_TODAY` 可覆盖）。理由见 charter.ts 的 `todayOf`。 */
  today?: string;
}

const snap = charterRaw as CharterSnapshotRaw;

export const charterSnapshotAt = snap.generatedAt ?? '';

export const charters: CharterEntry[] = Array.isArray(snap.charters) ? snap.charters : [];

/**
 * 当前章程。本仓暂只收录一份（`arsenal-self.json`），但**代码按「可有多份」写**。
 *
 * 为什么现在不按「一份」写：待拍板项 ② 的答案是「本仓与业务仓都要支持」，
 * 而业务仓场景下同一个页面可能要列出多份。按一份写，将来要么改页面，要么改数据。
 * 多花的这段代码在多份时才用得上 —— 但那时不用改的是**页面**。
 */
export const primaryCharter: CharterEntry | null = charters[0] ?? null;

export const charterTotals =
  snap.totals ?? { clauses: 0, must: 0, exceptions: 0, overrides: 0, orphaned: 0 };

/**
 * L0 侧数据。**读不到时如实给 null**，由 `budgetView` 显示「无法计算」——
 * 不给兜底 0：0 会渲染成「0% 已用」，那是一个没人会怀疑的假数字。
 */
export const l0View: { must: number | null; limit: number | null; declared: number | null } = {
  must: typeof snap.l0?.must === 'number' ? snap.l0.must : null,
  limit: typeof snap.l0?.limit === 'number' ? snap.l0.limit : null,
  declared: typeof snap.l0?.hardLimitDeclared === 'number' ? snap.l0.hardLimitDeclared : null,
};

/**
 * L0 声明值与实测值是否一致。**不一致就在页面上说出来** ——
 * 本仓铁律「手抄的数字必须由机器守住」的反面：不一致时不能悄悄用某一个。
 */
export const l0DeclarationDrift: boolean =
  l0View.must !== null && l0View.declared !== null && l0View.must !== l0View.declared;

/**
 * 今天的日期（YYYY-MM-DD）。
 *
 * **必须来自构建期注入，不能 `new Date()`** —— 与校验器的 `today` 同一理由：
 * 读系统时钟会让「这条条款生效了没」「这笔例外到期了没」随渲染时刻变，
 * 静态截图与断言都不可复现。注入值由 **sync 链写进快照**（与 L0 侧数同一机制，
 * 同一个值也喂给 `validateCharter(today)`，保证「构建期判的」与「页面显示的」是同一天）。
 *
 * 拿不到时回落成 `''`，而 `''` 会让所有比较为 false（全部按「未生效/未到期」渲染）——
 * 那是**保守的一侧**：宁可说「没生效」，也不说「已生效」而其实没算。
 */
export function todayOf(): string {
  return typeof snap.today === 'string' && snap.today !== '' ? snap.today : '';
}

/* ══════════════════════════════════════════════════════════════
   三、纯计算：派生结论一律在这里
   ══════════════════════════════════════════════════════════════ */

/** 严重度排序 —— 强的在前。顺序写在数据里，不在渲染里。 */
export const SEVERITY_RANK: Record<CharterSeverity, number> = {
  MUST: 0,
  NEVER: 1,
  SHOULD: 2,
  MAY: 3,
};

/**
 * 条款是否已生效（`effectiveFrom` <= 给定日期）。
 *
 * 这是**冻结线**的判据：PR 门只对已生效的条款生效，存量代码不进门。
 * `today` 必须由调用方传入 —— 与校验器同一条理由：读系统时钟会让
 * 「这条条款生效了没」随渲染时刻变，截图与断言都不可复现。
 */
export function isClauseInForce(cl: CharterClause, today: string): boolean {
  return typeof cl.effectiveFrom === 'string' && cl.effectiveFrom <= today;
}

/** 条款的检测层标签。抄 L0 的口径（regex → ast → llm → manual），不另立一套。 */
export function clauseCheckLayer(cl: CharterClause): 'regex' | 'ast' | 'llm' | 'manual' {
  if (cl.check?.regex) return 'regex';
  if (cl.check?.ast) return 'ast';
  if (cl.check?.llm) return 'llm';
  return 'manual';
}

/** 条款是否可机器判定（regex / ast）。只有 manual 的条款进不了 PR 门。 */
export function isClauseMachineCheckable(cl: CharterClause): boolean {
  const l = clauseCheckLayer(cl);
  return l === 'regex' || l === 'ast';
}

/**
 * 条款列表（排序后）。**已生效的在前**，同组内按严重度、ID。
 *
 * 为什么把生效状态参与排序而不做成筛选器：页面上「已生效 / 未生效」两类混排时，
 * 未生效的条款会被误读成「已经生效但没人遵守」—— 那与「还没开始要求」是两件事。
 */
export function sortedClauses(clauses: CharterClause[], today: string): CharterClause[] {
  return [...clauses].sort(
    (a, b) =>
      Number(isClauseInForce(b, today)) - Number(isClauseInForce(a, today)) ||
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.id.localeCompare(b.id),
  );
}

/** 例外是否到期（`expiresAt` <= 今天，且未销账）。 */
export function isExceptionOverdue(ex: CharterException, today: string): boolean {
  return ex.expiresAt <= today && ex.status !== 'repaid';
}

/** 例外剩余天数。已到期返回负数（用于「逾期 N 天」）。 */
export function daysUntil(dateStr: string, today: string): number {
  const a = Date.parse(`${dateStr}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.round((a - b) / 86_400_000);
}

/**
 * 例外的**实际处置** —— 读 policy，而不是无条件判负。
 *
 * 这是「拍板 = 改一行 JSON」在前端的落点：同一份数据在 `overdueException: error`
 * 下红，在 `warn` 下黄。**处置是数据算出来的，不是写死的类名。**
 */
export interface ExceptionDisposition {
  level: 'error' | 'warn' | 'ok';
  label: string;
  note: string;
}

export function exceptionDisposition(ex: CharterException, doc: CharterDoc, today: string): ExceptionDisposition {
  const policy = doc.policy;
  const overdue = isExceptionOverdue(ex, today);
  const inTeam = doc.team.includes(ex.owner);

  if (ex.status === 'repaid') {
    return { level: 'ok', label: '已销账', note: `还债完成，不再占用额度` };
  }

  if (overdue && !inTeam) {
    // 债主已离队 —— 责任归属是「欠的是一个人」，不是「欠一个决定」。
    const block = policy.orphanBlocks === 'error';
    return {
      level: block ? 'error' : 'warn',
      label: '孤儿例外',
      note: block
        ? `债主「${ex.owner}」已不在 team，按 policy.orphanBlocks=error 仍判负 —— 这条政策的意思是「先补人再销账」`
        : `债主「${ex.owner}」已不在 team，只进债务账、不判负。请补人后销账`,
    };
  }

  if (overdue) {
    const act = policy.overdueException;
    if (act === 'ignore') {
      return { level: 'ok', label: '已到期（policy.ignore）', note: '当前政策不检查这一条 —— 拆闸是它的后果' };
    }
    if (act === 'warn') {
      return {
        level: 'warn',
        label: '已到期',
        note: `已逾期 ${Math.abs(daysUntil(ex.expiresAt, today))} 天，按 policy.overdueException=warn 只记债务账`,
      };
    }
    return {
      level: 'error',
      label: '已到期未销账',
      note: `已逾期 ${Math.abs(daysUntil(ex.expiresAt, today))} 天 —— 销账（repaid）或续期（改 expiresAt）`,
    };
  }

  const left = daysUntil(ex.expiresAt, today);
  return { level: 'ok', label: '生效中', note: `还剩 ${left} 天到期（${ex.expiresAt}）` };
}

/** 例外登记簿（排序后）：先按「处置严重度」，再按到期日。 */
export function sortedExceptions(exceptions: CharterException[], doc: CharterDoc, today: string): CharterException[] {
  const rank = { error: 0, warn: 1, ok: 2 } as const;
  return [...exceptions].sort(
    (a, b) =>
      rank[exceptionDisposition(a, doc, today).level] - rank[exceptionDisposition(b, doc, today).level] ||
      a.expiresAt.localeCompare(b.expiresAt) ||
      a.id.localeCompare(b.id),
  );
}

/** 债务账的一行。**这是本页的核心表**，而它的 KPI 是「数字下降」不是「零」。 */
export interface DebtRow {
  clauseId: string;
  clauseTitle: string;
  clauseOwner: string;
  severity: CharterSeverity;
  /** 豁免中（未到期且生效）的例外数 */
  active: number;
  /** 已到期未销账的例外数 */
  overdue: number;
  /** 债主已离队的孤儿数 */
  orphaned: number;
  /** 本条款名下未销账的例外总数（active + overdue + orphaned） */
  openDebt: number;
}

/**
 * 债务账：**按条款**聚合它名下的例外。
 *
 * 为什么不按「按例外」列：例外有几十条，条款只有十几条 —— 按条款聚合才能看出
 * 「哪一条规矩在持续吃豁免」。一条款吃 5 个豁免是**制度问题**（那条规矩定得不对），
 * 而 5 个条款各吃 1 个是**执行问题**（人没守住）。这两种问题的处置完全不同。
 */
export function debtLedger(doc: CharterDoc, today: string): DebtRow[] {
  const rows: DebtRow[] = doc.clauses.map((cl) => {
    const mine = doc.exceptions.filter((ex) => ex.clauseId === cl.id);
    const active = mine.filter((ex) => ex.status === 'active' && !isExceptionOverdue(ex, today)).length;
    const overdue = mine.filter((ex) => isExceptionOverdue(ex, today) && doc.team.includes(ex.owner) && ex.status !== 'orphaned').length;
    const orphaned = mine.filter((ex) => isExceptionOverdue(ex, today) && !doc.team.includes(ex.owner) && ex.status !== 'repaid').length;
    return {
      clauseId: cl.id,
      clauseTitle: cl.title,
      clauseOwner: cl.clauseOwner,
      severity: cl.severity,
      active,
      overdue,
      orphaned,
      openDebt: mine.filter((ex) => ex.status !== 'repaid').length,
    };
  });
  return rows.sort((a, b) => b.openDebt - a.openDebt || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** 条款的例外数（页面上挂在条款卡右侧角标）。 */
export function exceptionCountFor(doc: CharterDoc, clauseId: string): number {
  return doc.exceptions.filter((ex) => ex.clauseId === clauseId).length;
}

/** 预算用量的现算值。页面上那个百分比由它算，不写成字面量。 */
export interface BudgetView {
  must: number;
  limit: number;
  usedPct: number;
  remaining: number;
  scope: 'separate' | 'shared';
  sharedNote: string | null;
}

export function budgetView(doc: CharterDoc, l0Must: number | null, l0Limit: number | null): BudgetView {
  const must = doc.clauses.filter((c) => c.severity === 'MUST' || c.severity === 'NEVER').length;
  const limit = doc.budget.mustLimit;
  const scope = doc.policy.budgetScope;
  if (scope === 'separate') {
    return {
      must,
      limit,
      usedPct: Math.min(100, Math.round((must / limit) * 100)),
      remaining: Math.max(0, limit - must),
      scope,
      sharedNote: null,
    };
  }
  // shared：改成「L0 + 章程」的总账口径。l0Must / l0Limit 拿不到时如实说「读不到」，
  // 不拿 must/limit 顶替 —— 那会显示一个看起来正常的假数字。
  if (typeof l0Must !== 'number' || typeof l0Limit !== 'number') {
    return { must, limit, usedPct: 0, remaining: 0, scope, sharedNote: 'L0 侧数据未传入，共享池用量无法计算' };
  }
  const total = l0Must + must;
  return {
    must: total,
    limit: l0Limit,
    usedPct: Math.min(100, Math.round((total / l0Limit) * 100)),
    remaining: Math.max(0, l0Limit - total),
    scope,
    sharedNote: `共享口径：L0 实测 ${l0Must} + 章程 ${must} = ${total} / ${l0Limit}`,
  };
}

/* ══════════════════════════════════════════════════════════════
   四、override 的语义说明（页面上要讲清「放宽」的后果）
   ══════════════════════════════════════════════════════════════ */

export interface OverrideView {
  ov: CharterOverride;
  label: string;
  tone: 'error' | 'warn' | 'ok';
  note: string;
}

/**
 * override 的人读说明。
 *
 * 为什么单列一个函数：页面上最容易犯的错是**把 relax 渲染成和 tighten 一样的绿标** ——
 * 「放宽」看起来像好事，但它的真实后果是「基线那条在这个项目不算数了」。
 * 所以 relax 必须显示**到期日**（这才是它有时间边界的原因）与批准人。
 */
export function overrideView(ov: CharterOverride, today: string): OverrideView {
  if (ov.action === 'tighten') {
    return { ov, label: '收紧', tone: 'ok', note: '本项目比基线更严 —— 收窄方向，无副作用' };
  }
  if (ov.action === 'replace') {
    return {
      ov,
      label: '替换',
      tone: 'warn',
      note: `换成：${ov.replacement ?? '（未写替换物）'}`,
    };
  }
  // relax
  const expired = typeof ov.expiresAt === 'string' && ov.expiresAt < today;
  return {
    ov,
    label: '放宽',
    tone: 'error',
    note: expired
      ? `基线在本项目不再强制${ov.expiresAt ? `（放宽已于 ${ov.expiresAt} 到期，应续期或收回）` : ''}`
      : `基线在本项目不再强制${ov.expiresAt ? `，${ov.expiresAt} 到期` : ''}${ov.approver ? ` · 批准人 ${ov.approver}` : ''}`,
  };
}

/** 一致性检查项的「这项检查会不会阻断」标签。 */
export function consistencyMode(c: CharterConsistency): { label: string; tone: 'error' | 'warn' } {
  return c.check.report === 'block'
    ? { label: '阻断', tone: 'error' }
    : { label: '只报漂移', tone: 'warn' };
}


/* ══════════════════════════════════════════════════════════════
   五、呈现辅助（色值映射集中在这里，页面不散写类名）
   ══════════════════════════════════════════════════════════════ */

/**
 * 严重度 → 徽标类名。
 *
 * 为什么集中在纯函数层而不写在组件里：本仓硬约定「装配台不许裸写已登记色」
 * （project-check 有断言）。把映射放在页面里就是散写；放这里则可以**被断言读**。
 */
export function severityBadgeClass(sev: CharterSeverity): string {
  switch (sev) {
    case 'MUST':
    case 'NEVER':
      return 'bg-rust/15 text-rust';
    case 'SHOULD':
      return 'bg-brass/15 text-brass';
    default:
      return 'bg-surfaceMax text-fgMuted';
  }
}

/** 处置级别 → 类名。孤儿例外走 brass（黄铜 = 需要人看但不该拦住全队）。 */
export function dispositionToneClass(level: 'error' | 'warn' | 'ok'): string {
  return level === 'error' ? 'bg-rust/15 text-rust' : level === 'warn' ? 'bg-brass/15 text-brass' : 'bg-olive/15 text-olive';
}

/** 检测层 → 类名。manual（不能机器判定）用 brass，因为它是「进不了门禁」而不是「错」。 */
export function layerBadgeClass(layer: 'regex' | 'ast' | 'llm' | 'manual'): string {
  return layer === 'manual' ? 'bg-brass/15 text-brass' : 'bg-surfaceMax text-fgMuted';
}

/** override 动作 → 类名。relax 用 rust：它让基线在本项目失效。 */
export function actionToneClass(tone: 'error' | 'warn' | 'ok'): string {
  return tone === 'error' ? 'text-rust' : tone === 'warn' ? 'text-brass' : 'text-olive';
}

/** 条款严重度的语义色（正文用，比徽标浅一档）。给屏幕阅读器与图形输出用。 */
export function clauseSeverityTone(sev: CharterSeverity): string {
  return sev === 'MUST' || sev === 'NEVER' ? '阻断级' : sev === 'SHOULD' ? '建议级' : '可选级';
}


/* ══════════════════════════════════════════════════════════════
   六、并入规则池（/check 项目模式用）
   ══════════════════════════════════════════════════════════════ */

/**
 * 章程条款 → `Rule` 形状。
 *
 * 为什么能直接转：章程条款在**契约层**就复用了 `RULE_SPEC` 的全部字段定义
 * （`CLAUSE_SPEC.fields = { ...RULE_SPEC.fields, …四个协作字段 }`），
 * 所以形状天然兼容。这不是巧合 —— `charter-contract.mjs` 的注释里写明了
 * 「字段对象引用而不是复制」，就是为了让这一步真的能走通。
 *
 * `_checkLayer` / `_hasStaticCheck` / `_weight` 这三个下划线字段是
 * `sync-rules.mjs` 注入的派生值，章程这边自己算（口径与 L0 一致：
 * regex → ast → llm → manual 依次降级）。
 */
export function charterClauseToRule(cl: CharterClause, sourceFile: string): Rule {
  const layer = clauseCheckLayer(cl);
  return {
    ...cl,
    category: cl.category as CategoryKey,
    severity: cl.severity as Severity,
    _weight: cl.severity === 'MUST' || cl.severity === 'NEVER' ? 3 : cl.severity === 'SHOULD' ? 2 : 1,
    _hasStaticCheck: layer === 'regex' || layer === 'ast',
    _checkLayer: layer,
    _sourceFile: sourceFile,
  };
}

/**
 * 把章程条款并进 L0 规则池。
 *
 * **不修改 `allRules`**，返回新数组：`allRules` 在导航徽标、导出统计、
 * 统计页多处被读，原地改会污染「全站 69 条」这个数字 —— 而那个数字是
 * 被断言守着的（README 项数口径、`liveStats.budgetUsedPct`）。
 *
 * @param base  L0 规则池
 * @param today 未生效的条款是否排除。默认排除 —— 冻结线的语义就是
 *              「未生效的条款不进 PR 门」。传 '' 时全部保留（查档时用）。
 */
export function appendCharterToRuleSet(base: Rule[], today: string = todayOf()): Rule[] {
  const out = base.slice();
  for (const entry of charters) {
    for (const cl of entry.doc.clauses) {
      if (today !== '' && !isClauseInForce(cl, today)) continue;
      out.push(charterClauseToRule(cl, `arsenal-charter/${entry.id}.json`));
    }
  }
  return out;
}

/** 一条章程命中。带上 owner / 依据 —— 报告里只说「违规了」等于没说。 */
export interface CharterViolation {
  ruleId: string;
  line: number;
  severity: string;
  message: string;
  clauseOwner: string;
  decidedBy: string;
  effectiveFrom: string;
}

/**
 * 从 lint 报告里**只挑出章程条款的命中**。
 *
 * 为什么不返回全部：校验台的报告已经列了 L0 全部违规；这里要回答的是
 * 「本项目章程额外判了什么」，混在一起会让人把基线违规与项目违规搞混。
 *
 * 判据是 ID 前缀（`PJX-`）而不是「是否在章程数组里」—— 前缀是契约保证的
 * 命名空间（`charter-contract.mjs` 里有专门的 namespace 判据），
 * 而「在数组里」是运行时事实；用前者可以在数据出错时也保持判据成立。
 */
export function charterLintPreview(report: { violations: { ruleId: string; line: number; severity: string; message: string }[] }): CharterViolation[] {
  const byId = new Map<string, CharterClause>();
  for (const entry of charters) for (const cl of entry.doc.clauses) byId.set(cl.id, cl);
  const out: CharterViolation[] = [];
  for (const v of report.violations ?? []) {
    if (!v.ruleId.startsWith('PJX-')) continue;
    const cl = byId.get(v.ruleId);
    out.push({
      ruleId: v.ruleId,
      line: v.line,
      severity: v.severity,
      message: v.message,
      clauseOwner: cl?.clauseOwner ?? '（条款未在快照中）',
      decidedBy: cl?.decidedBy ?? '—',
      effectiveFrom: cl?.effectiveFrom ?? '—',
    });
  }
  return out;
}

/**
 * 章程里声明了但**本机跑不了**的条款数（检测方式 = ast / llm / manual）。
 *
 * 页面必须显示这个数：只报「0 违规」而不说「有 N 条根本没跑」，
 * 等于把「没查」说成「查过了且没问题」—— 这正是本仓反复治的那类不诚实。
 */
export function charterNotExecutableCount(today: string = todayOf()): number {
  // ★ 只数**章程条款**（PJX- 前缀），不数整个合并池。
  //   第一版漏了前缀过滤，页面显示「本次有 34 条章程条款没跑」—— 而本仓只有 2 条章程条款，
  //   那 34 里混进了 32 条 L0 非正则规则。**文案在撒谎**：把基线规则的执行情况
  //   说成了本项目章程的执行情况。实测 2026-10-03 由浏览器探针抓到。
  let n = 0;
  for (const entry of charters) {
    for (const cl of entry.doc.clauses) {
      if (today !== '' && !isClauseInForce(cl, today)) continue;
      if (clauseCheckLayer(cl) !== 'regex') n += 1;
    }
  }
  return n;
}

/* ══════════════════════════════════════════════════════════════
   七、导出：规范书（Markdown）与 CI 片段
   ══════════════════════════════════════════════════════════════ */

/**
 * 章程规范书（Markdown）—— 给人读的那一份。
 *
 * 与规则集导出器（`exporters.ts`）的分工：那边是「**通用规范书**」，由用户在
 * `/export` 页勾选要哪几类；这边是「**本项目的章程**」，不勾选 —— 全量，因为
 * 章程本来就是一个小文件（条款十几条），挑着看反而会漏掉「这条正好管你那块」。
 */
export function buildCharterMarkdown(doc: CharterDoc, today: string = todayOf()): string {
  const L: string[] = [];

  // 标题**只取 doc.name，不再拼「· 工程章程」** ——
  // 章程的 name 字段本身通常已经带这四个字（`军火库自身 · 工程章程`），
  // 拼一次的结果是「军火库自身 · 工程章程 · 工程章程」。
  // 这类「看起来无害的重复」是**渲染时才发现**的：数据没错、断言全绿，只有成品不对。
  L.push(`# ${doc.name}`);
  L.push('');
  L.push(`> 版本 ${doc.version}｜批准于 ${doc.ratifiedAt}｜负责人 ${doc.owner}｜团队 ${doc.team.length} 人`);
  L.push(`> 基线 \`${doc.extends}\`｜章程目录 \`arsenal-charter/\`（改它跟改代码一样走 PR）`);
  L.push('');
  L.push(
    '本文件是**手写的 JSON**（`arsenal-charter/<id>.json`）的渲染结果，改内容请改那份 JSON，' +
      '不要直接改这份 Markdown —— 重新导出时会覆盖。',
  );
  L.push('');

  // 治理政策放最前：读者需要先知道「例外到期会不会让构建红」
  L.push('## 治理政策');
  L.push('');
  L.push('| 事项 | 口径 |');
  L.push('|---|---|');
  L.push(
    `| 例外到期未销账 | \`${doc.policy.overdueException}\`` +
      `${doc.policy.overdueException === 'error' ? '（判负，全队构建红）' : doc.policy.overdueException === 'warn' ? '（只记债务账，不判负）' : '（不检查 —— 不建议）'} |`,
  );
  L.push(
    `| 孤儿例外（债主已离队） | ${doc.policy.orphanBlocks === 'warn' ? '不判负，只进债务账' : '仍判负，先补人再销账'} |`,
  );
  L.push(`| 例外工单号 | ${doc.policy.requireTicket === 'required' ? '必填' : '可省'} |`);
  L.push(
    `| MUST 配额 | ${doc.policy.budgetScope === 'separate' ? '与基线各算各的' : '与基线共享 50 条上限'}` +
      `${doc.policy.budgetScope === 'separate' ? `（本章程独立上限 ${doc.budget.mustLimit}）` : ''} |`,
  );
  L.push('');

  const must = doc.clauses.filter((c) => c.severity === 'MUST' || c.severity === 'NEVER').length;
  const openDebt = doc.exceptions.filter((e) => e.status !== 'repaid').length;
  L.push(
    `**MUST 条款** ${must} / 上限 ${doc.budget.mustLimit}；**例外** ${doc.exceptions.length} 笔（未销账 ${openDebt} 笔）。` +
      `判定日 ${today || '（未注入，全部按「未生效/未到期」渲染）'}。`,
  );
  L.push('');

  // 条款
  L.push('## 条款');
  L.push('');
  for (const sev of ['MUST', 'NEVER', 'SHOULD', 'MAY'] as CharterSeverity[]) {
    const group = sortedClauses(
      doc.clauses.filter((c) => c.severity === sev),
      today,
    );
    if (group.length === 0) continue;
    L.push(`### ${sev}（${group.length} 条）`);
    L.push('');
    for (const c of group) {
      const layer = clauseCheckLayer(c);
      L.push(`#### \`${c.id}\`　${c.title}`);
      L.push('');
      L.push(
        `- 归谁管：**${c.clauseOwner}**　依据：\`${c.decidedBy}\`　生效日：\`${c.effectiveFrom}\`` +
          `${isClauseInForce(c, today) ? '' : '　**（尚未生效）**'}`,
      );
      L.push(`- 作用域：\`${c.pathGlob}\``);
      L.push(
        `- 检测方式：\`${layer}\`${isClauseMachineCheckable(c) ? '' : '　**进不了 PR 门（需人工评审）**'}`,
      );
      L.push('');
      L.push(`**为什么**：${c.rationale}`);
      L.push('');
      L.push('```text');
      L.push(`反例：${c.bad}`);
      L.push(`正解：${c.good}`);
      L.push('```');
      L.push('');
      L.push(`> 注入 AI：${c.promptFragment}`);
      L.push('');
    }
  }

  // 对基线的偏离
  L.push('## 对行业基线的偏离');
  L.push('');
  if (doc.overrides.length === 0) {
    L.push('无偏离 —— 本项目完全按基线执行。');
  } else {
    L.push('| 基线条款 | 动作 | 说明 | 批准人 | 到期 |');
    L.push('|---|---|---|---|---|');
    for (const ov of doc.overrides) {
      const v = overrideView(ov, today);
      L.push(
        `| \`${ov.ruleId}\` | ${v.label} | ${v.note} | ${ov.approver ?? '—'} | ${ov.expiresAt ?? '—'} |`,
      );
    }
  }
  L.push('');

  // 例外登记簿
  L.push('## 例外登记簿');
  L.push('');
  if (doc.exceptions.length === 0) {
    L.push('无例外 —— 没有人在破例。');
  } else {
    L.push('| 编号 | 豁免条款 | 覆盖范围 | 理由 | 批准 | 还债人 | 到期 | 工单 | 状态 |');
    L.push('|---|---|---|---|---|---|---|---|---|');
    for (const ex of sortedExceptions(doc.exceptions, doc, today)) {
      const disp = exceptionDisposition(ex, doc, today);
      L.push(
        `| \`${ex.id}\` | \`${ex.clauseId}\` | \`${ex.pathGlob}\` | ${ex.reason} | ${ex.approver} | ` +
          `${ex.owner} | ${ex.expiresAt} | ${ex.ticket ?? '**无**'} | ${disp.label} |`,
      );
    }
    L.push('');
    L.push('> 「无到期日」的豁免**不存在** —— 到期日是必填字段，且过期不销账会判负。');
  }
  L.push('');

  // 一致性
  L.push('## 命名一致性');
  L.push('');
  if (doc.consistency.length === 0) {
    L.push('未配置。');
  } else {
    for (const c of doc.consistency) {
      const m = consistencyMode(c);
      // forbidden 是可选字段（契约里 optional），取一次局部变量让 TS 收窄成立 ——
      // 在模板字符串里写 `c.forbidden.map` 会报 TS18048（可能 undefined）。
      const forbidden = c.forbidden ?? [];
      L.push(
        `- **${c.concept}**（\`${c.id}\`）：认可 ${c.canonical.map((x) => `\`${x}\``).join('、')}` +
          `${forbidden.length ? `；不许 ${forbidden.map((x) => `\`${x}\``).join('、')}` : ''}` +
          `。范围 \`${c.scope}\`，超过 ${c.check.minVariants} 种写法即${m.label}。`,
      );
    }
  }
  L.push('');

  L.push('---');
  L.push('');
  L.push('## 这份章程怎么被检查');
  L.push('');
  L.push('| 时机 | 谁跑 | 查什么 | 处置 |');
  L.push('|---|---|---|---|');
  L.push('| 构建 / 提交 | `node scripts/sync-content.mjs` | 契约 + 五道闸门 | **失败即中断** |');
  L.push('| 写代码前 | MCP `get_charter` / `list_exceptions` | 该查的条款与现成豁免 | AI 自己遵守 |');
  L.push('| PR | CI 片段 `--mode pr` | **仅 diff 触及的文件** × 已生效条款 | 阻断 |');
  L.push('| 定时 | CI 片段 `--mode audit` | 全仓存量 | 只出债务账，不阻断 |');
  L.push('');

  return L.join('\n');
}

/**
 * CI 片段（GitHub Actions）。
 *
 * 两处设计要说明：
 *
 * 1. **PR 门只查 diff、只查已生效条款。** 存量不合规是必然的 —— 第一次跑就报
 *    300 条红，第二次就没人愿意用了。口径由 `--mode pr` 表达，实际过滤在
 *    `appendCharterToRuleSet(base, today)`（它会跳过未生效条款）。
 *
 * 2. **判负口径不在这个文件里写死。** 例外到期判不判负由 `policy.overdueException`
 *    决定，而 policy 在**用户自己的章程文件**里 —— CI 片段把它写死等于越权。
 *    所以本片段只声明「配置从哪来」，判定逻辑在执行器里读 policy。
 */
export function buildCharterCI(opts?: { projectName?: string; charterDir?: string }): string {
  const dir = opts?.charterDir ?? 'arsenal-charter';
  return `# ═══════════════════════════════════════════════════════════════════════
# 章程门禁 · GitHub Actions（由军火库 /charter 页「导出 CI 片段」生成）
#
# 怎么用（三步；每一步的说明与建议见 docs/项目章程-CI落地指南.md）：
#   1) 本仓先有一份章程：arsenal-charter/<项目>.json
#      —— 没有就先去军火库 /charter 页导一份。没有章程，PR 门只能跑 L0 基线，
#         约等于「只查公共规范、不查本项目自己的规矩」。
#   2) 把本片段存成 .github/workflows/charter-gate.yml，直接提交。
#   3) 军火库要能被 CI 拿到：下面用 git clone 放到 .arsenal/arsenal
#      —— 建议把 .arsenal/ 加进 .gitignore（它是 CI 现场生成物，本地不必提交）。
#      私有库请换成带 token 的 clone，或改用 actions/checkout 的 repository 字段。
#
# 两个 job 为什么必须分开：
#   · pr-gate     每次 PR 跑，**只判本次 diff 触及的文件** × 已生效条款，命中
#                 MUST/NEVER 就红。存量违规不在这里拦 —— 第一次跑就报 300 条红，
#                 第二次就没人愿意用了。
#   · debt-audit  每周一 03:17 扫全仓出债务账，**永远不阻断**。
#                 这页的 KPI 是数字下降，不是零。
#
# 判负口径（例外到期要不要红、孤儿例外拦不拦）**不在本文件写死**：
# 它读 ${dir}/*.json 的 policy 段。改口径改那份 JSON，这个文件一个字都不用动。
name: 章程门禁

on:
  pull_request:
  schedule:
    # 每周一 03:17 —— 存量债扫描（时间刻意不整点，避开整点的调度高峰）
    - cron: '17 3 * * 1'

jobs:
  pr-gate:
    # 只查本次 PR 触及的文件。存量违规不在这里阻断。
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          # 建议：必须完整历史。PR 门靠 git diff 算「本次改了哪些文件」，
          # 浅克隆会拿到空 diff —— 那是**门禁静默失效**，不是「本次没违规」。
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: ① 取军火库（判定执行器 + 规则池 + 章程都在里面）
        run: |
          git clone --depth 1 https://github.com/<你的账号>/arsenal.git .arsenal/arsenal
      - name: ② 先看一眼本次改了哪些文件（门禁只判这些）
        run: git diff --name-only origin/\${{ github.base_ref }}...HEAD
      - name: ③ 导出判定配置（规则正则 + 已生效条款 + 例外台账 + 判负口径 + 上面那份文件清单）
        # 建议：清单在导出阶段就算定，判定阶段不再碰 git ——
        #         否则「diff 算空了」会伪装成「本次没有违规」。
        run: node .arsenal/arsenal/arsenal-server/scripts/charter-ci.mjs export --mode pr --out .arsenal/ci --base origin/\${{ github.base_ref }}
      - name: ④ 按配置判定（判负口径来自章程 policy，不来自本文件）
        run: node .arsenal/ci/charter-ci.mjs lint --config .arsenal/ci --mode pr

  debt-audit:
    # 全仓存量，只出债务账不阻断。KPI 是「数字下降」，不是零。
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: ① 取军火库（同上）
        run: |
          git clone --depth 1 https://github.com/<你的账号>/arsenal.git .arsenal/arsenal
      - name: ② 导出全量配置（不裁文件清单，判定范围由 scan 的 include/exclude 决定）
        run: node .arsenal/arsenal/arsenal-server/scripts/charter-ci.mjs export --mode audit --out .arsenal/ci
      - name: ③ 生成债务账（存量只记账不阻断）
        run: node .arsenal/ci/charter-ci.mjs lint --config .arsenal/ci --mode audit --report debt.md
      - name: ④ 把债务账留成产物（建议保留 30 天，方便对比「这周降了多少」）
        uses: actions/upload-artifact@v4
        with:
          name: charter-debt
          path: debt.md
          retention-days: 30
`;
}

/** 章程相关的可交付文件（装配台交付中心 / 项目初始化用）。 */
export function charterDeliverableFiles(doc: CharterDoc): { path: string; content: string }[] {
  return [
    { path: 'arsenal-charter.json', content: JSON.stringify(doc, null, 2) + '\n' },
    { path: 'CHARTER.md', content: buildCharterMarkdown(doc) },
    { path: '.github/workflows/charter-gate.yml', content: buildCharterCI({ projectName: doc.name }) },
  ];
}
