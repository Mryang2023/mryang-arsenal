/**
 * standards.ts —— **工程规范台**的纯函数层。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 为什么要有这一层（2026-10-05 重定位）
 *
 * 原来的 `/charter` 是「一份章程文档的三个视图」：有什么规矩 / 谁在破例 /
 * 哪条规矩在持续吃豁免。三个问题都以**条款**为中心，页面本质上是个
 * 合规台账 —— 适合「审章程」，不适合「多人一起管代码规范」。
 *
 * 多人协作真正要回答的是四个问题，而原来的数据模型缺了其中三个维度：
 *
 *   人    每条规矩谁负责、谁批的例外、谁欠着没销、谁离队留了孤儿债
 *   现状  哪个模块在持续破规、这次改动会不会被门禁拦
 *   时间  规矩什么时候生效、什么时候到期、什么时候该续
 *   执行  门禁真的在跑吗、判了多少、放过多少
 *
 * 「人 / 现状 / 时间」这三块**现有章程 JSON 已经够了**（clauseOwner、
 * owner、approver、expiresAt、pathGlob、effectiveFrom 全都有字段），
 * 缺的只是**聚合**—— 而聚合必须放在纯函数里，理由与本仓其他 lib 一致：
 * 页面是静态导出，渲染时没有文件系统；更重要的是，**能被 `.verify` 当数据
 * 直接跑**，否则这些数字只是「看起来对」。
 *
 * 「执行」这一块要 CI 的真实判罚历史（`ci-history.jsonl`），P1 接。
 * 现阶段页面上那块显示的是**门禁就绪度**（能不能接、还缺什么），
 * 而不是「上次判了多少」—— 后者没有数据来源时**不能画成 0**。
 * ═══════════════════════════════════════════════════════════════════════
 */

import {
  isClauseInForce,
  clauseCheckLayer,
  isExceptionOverdue,
  daysUntil,
  todayOf,
} from './charter';
import type { CharterDoc, CharterClause, CharterException, CharterOverride } from './charter';

/* ═══════════════════════════════════════════════════════════════════════
   一、待办清单 —— 页面顶部的「今天该处理 N 件事」
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * 待办项的种类。**刻意不用字符串自由组合**：这一列是要被断言数出来的
 * （`kind` 各档条数之和 == 清单长度），自由组合会让「漏了一条」看不出来。
 */
export type ActionKind =
  | 'overdue-exception'   // 例外到期未销账
  | 'orphan-debt'         // 债主离队留下的孤儿债
  | 'override-expired'    // relax 放宽到期 → 失去依据，必须续期或收回
  | 'expiring-soon'       // 30 天内到期（还来得及从容处理）
  | 'not-machine-checkable'; // 条款检不了 → 「0 违规」可能等于「没查」

export type ExState = 'active' | 'expired' | 'repaid' | 'orphaned';

/**
 * 例外的**状态**（与 `charter.ts` 的 `exceptionDisposition` 同一口径）。
 *
 * 为什么不直接复用那个函数：它返回的是「给人看的处置建议」（level/label/note），
 * 而这里要做的是**按状态分流**（到期走一组待办、离队走另一组）——
 * 拿 label 字符串去 switch 是一种很快会腐烂的写法（改个文案就静默失效）。
 * 所以这里按**数据字段**重算一遍，并由 charter-check 断言两者逐条一致
 * （口径分叉的后果：页面上「到期」与「孤儿」两栏数字对不上，而没人说得清为什么）。
 *
 * 判定与 exceptionDisposition 完全对齐：
 *   status=repaid → 已销账（不欠了）
 *   已逾期 且 owner 不在 team → 孤儿债（责任回到章程负责人）
 *   已逾期 → 到期未销账
 *   其余 → 生效中
 */
export function exState(
  ex: CharterException,
  doc: CharterDoc,
  today: string = todayOf(),
): ExState {
  if (ex.status === 'repaid') return 'repaid';
  const overdue = isExceptionOverdue(ex, today);
  const inTeam = (doc.team ?? []).includes(ex.owner ?? '');
  if (overdue && !inTeam) return 'orphaned';
  if (overdue) return 'expired';
  return 'active';
}

export type ActionLevel = 'P0' | 'P1' | 'P2';

export interface ActionItem {
  /** 稳定 id：同一份章程两次调用必须逐项相同（断言守这条） */
  id: string;
  kind: ActionKind;
  level: ActionLevel;
  title: string;
  /** 该谁处理。null = 没有明确的人（不是「随便谁」） */
  who: string | null;
  due: string | null;
  detail: string;
  target: string | null;
}

/** 多少天内算「即将到期」。写死一个数而不是配置：它是提醒阈值不是治理口径。 */
export const EXPIRING_SOON_DAYS = 30;

/**
 * 待办清单。**级别由 policy 决定而不是固定**：
 * `overdueException: error` 时逾期是 P0（会真的拦人），`warn` 时只是 P1（记一笔）。
 * 同一个问题在不同项目里严重程度不同，因为它们的 policy 不同。
 */
export function actionItems(doc: CharterDoc, today: string = todayOf()): ActionItem[] {
  const out: ActionItem[] = [];
  const overdueIsBlocking = (doc.policy?.overdueException ?? 'error') === 'error';

  for (const ex of doc.exceptions ?? []) {
    const st = exState(ex, doc, today);
    if (st === 'orphaned') {
      out.push({
        id: `orphan-debt:${ex.id}`,
        kind: 'orphan-debt',
        // 孤儿债永远不是这个人的问题了 —— 责任回到章程负责人身上。
        level: 'P1',
        title: `${ex.id} 的债主 ${ex.owner ?? '未知'} 已不在团队`,
        who: doc.owner,
        due: ex.expiresAt ?? null,
        detail: `条款 ${ex.clauseId} 的这笔豁免没人还了。要么找人接手，要么销账 —— 挂着只会让「有台账」变成「有遗留」。`,
        target: ex.id,
      });
      continue;
    }
    if (st === 'expired') {
      out.push({
        id: `overdue-exception:${ex.id}`,
        kind: 'overdue-exception',
        level: overdueIsBlocking ? 'P0' : 'P1',
        title: `${ex.id} 已到期 ${Math.abs(daysUntil(ex.expiresAt!, today))} 天还没销账`,
        who: ex.owner,
        due: ex.expiresAt ?? null,
        detail:
          overdueIsBlocking
            ? `policy.overdueException = error —— 这条现在就会拦住 PR。要么改代码补上，要么改台账续期。`
            : `policy.overdueException = ${doc.policy?.overdueException} —— 只记一笔不拦人，但数字会一直挂在这儿。`,
        target: ex.id,
      });
      continue;
    }
    const left = daysUntil(ex.expiresAt!, today);
    if (ex.status === 'active' && left <= EXPIRING_SOON_DAYS) {
      out.push({
        id: `expiring-soon:${ex.id}`,
        kind: 'expiring-soon',
        level: 'P2',
        title: `${ex.id} 还有 ${left} 天到期`,
        who: ex.owner,
        due: ex.expiresAt ?? null,
        detail: `提前处理比到期当天处理省事：现在决定是「收口」还是「续期」，到期后才发现往往只能续。`,
        target: ex.id,
      });
    }
  }

  for (const ov of doc.overrides ?? []) {
    if (ov.action !== 'relax' || !ov.expiresAt) continue;
    const left = daysUntil(ov.expiresAt, today);
    if (left < 0) {
      out.push({
        id: `override-expired:${ov.ruleId}`,
        kind: 'override-expired',
        level: 'P1',
        title: `对 ${ov.ruleId} 的放宽已到期 ${Math.abs(left)} 天`,
        who: doc.owner,
        due: ov.expiresAt,
        detail: `放宽到期后自动失去依据 —— 基线那条会重新开始管用。当时批的是「临时」，那就让它真的临时。`,
        target: ov.ruleId,
      });
    } else if (left <= EXPIRING_SOON_DAYS) {
      out.push({
        id: `override-expiring:${ov.ruleId}`,
        kind: 'expiring-soon',
        level: 'P2',
        title: `对 ${ov.ruleId} 的放宽还有 ${left} 天到期`,
        who: doc.owner,
        due: ov.expiresAt,
        detail: `续期要重新给理由与批准人，不是自动延长。`,
        target: ov.ruleId,
      });
    }
  }

  for (const c of doc.clauses ?? []) {
    if (!isClauseInForce(c, today)) continue;
    // 只把**人工层**（llm / manual）算进待办。AST 层不算 ——
    // `isClauseMachineCheckable` 认为它「机器可判」是对的（校验台有后端深检），
    // 但 **CI 门禁只跑正则层**，那一类归到「门禁就绪度」里点名，不混进「人必须 review」。
    if (clauseCheckLayer(c) !== 'manual' && clauseCheckLayer(c) !== 'llm') continue;
    out.push({
      id: `not-machine-checkable:${c.id}`,
      kind: 'not-machine-checkable',
      level: 'P1',
      title: `${c.id} 是 ${clauseCheckLayer(c)} 层 —— 门禁检不了它`,
      who: c.clauseOwner ?? doc.owner,
      due: null,
      detail: `正则层跑不到这条。**「本次 0 违规」对它是假的** —— 这条要进人工 review，否则它既没被机器查，也没被人查。`,
      target: c.id,
    });
  }

  return out;
}

export interface ActionSummary {
  total: number;
  p0: number;
  p1: number;
  p2: number;
  byKind: Record<ActionKind, number>;
}

/** 汇总带。**byKind 各档之和恒等于 total** —— 断言守这条，否则「漏算」看不出来。 */
export function actionSummary(items: ActionItem[]): ActionSummary {
  const byKind = {
    'overdue-exception': 0,
    'orphan-debt': 0,
    'override-expired': 0,
    'expiring-soon': 0,
    'not-machine-checkable': 0,
  } as Record<ActionKind, number>;
  for (const it of items) byKind[it.kind] += 1;
  return {
    total: items.length,
    p0: items.filter((i) => i.level === 'P0').length,
    p1: items.filter((i) => i.level === 'P1').length,
    p2: items.filter((i) => i.level === 'P2').length,
    byKind,
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   二、人 —— 责任人矩阵
   ═══════════════════════════════════════════════════════════════════════ */

export interface PersonRow {
  name: string;
  /** 是否还在 team 里。false = 已离队但名字还挂在台账上 */
  active: boolean;
  ownsClauses: string[];
  owesExceptions: string[];   // 他是还债人
  approvedExceptions: string[]; // 他是批准人
  overdue: number;
  orphan: number;
}

/**
 * 按人聚合。**团队成员与「只在台账里出现过的名字」要分开列** ——
 * 后者往往就是离队遗留，它在原页面上完全看不见，而它恰恰是最该被看见的。
 */
export function peopleView(doc: CharterDoc, today: string = todayOf()): {
  rows: PersonRow[];
  outsiders: PersonRow[];
  unassigned: { clauseExceptions: string[] };
} {
  const team = new Set(doc.team ?? []);
  const map = new Map<string, PersonRow>();
  const row = (name: string): PersonRow => {
    let r = map.get(name);
    if (!r) {
      r = {
        name,
        active: team.has(name),
        ownsClauses: [],
        owesExceptions: [],
        approvedExceptions: [],
        overdue: 0,
        orphan: 0,
      };
      map.set(name, r);
    }
    return r;
  };

  for (const c of doc.clauses ?? []) {
    if (c.clauseOwner) row(c.clauseOwner).ownsClauses.push(c.id);
  }

  const unassigned: string[] = [];
  for (const ex of doc.exceptions ?? []) {
    if (ex.owner) {
      const r = row(ex.owner);
      r.owesExceptions.push(ex.id);
      if (ex.approver && ex.approver !== ex.owner) row(ex.approver).approvedExceptions.push(ex.id);
      const st = exState(ex, doc, today);
      if (st === 'expired') r.overdue += 1;
      if (st === 'orphaned') r.orphan += 1;
    } else {
      unassigned.push(ex.id);
    }
  }

  const all = [...map.values()];
  all.sort((a, b) => b.overdue - a.overdue || b.owesExceptions.length - a.owesExceptions.length || a.name.localeCompare(b.name));
  return {
    rows: all.filter((r) => r.active),
    outsiders: all.filter((r) => !r.active),
    unassigned: { clauseExceptions: unassigned },
  };
}

/* ═══════════════════════════════════════════════════════════════════════
   三、时间 —— 什么时候生效、什么时候到期
   ═══════════════════════════════════════════════════════════════════════ */

export interface TimelineItem {
  date: string;
  kind: 'clause-in-force' | 'clause-future' | 'exception-granted' | 'exception-expire' | 'override-expire';
  title: string;
  detail: string;
}

/**
 * 时间线。**为什么要显式列出来而不是让人自己看日期字段**：
 * 章程里的日期散在五个字段（effectiveFrom / grantedAt / expiresAt），
 * 没人会把它们排成一条线看，而「三个月后同时到期三条」这种巧合只有排出来才看得见。
 */
export function timelineView(doc: CharterDoc, today: string = todayOf(), limit = 12): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const c of doc.clauses ?? []) {
    if (!c.effectiveFrom) continue;
    out.push({
      date: c.effectiveFrom,
      kind: c.effectiveFrom > today ? 'clause-future' : 'clause-in-force',
      title: `${c.id} ${c.effectiveFrom > today ? '将生效' : '开始管用'}`,
      detail: `${c.title} · 归 ${c.clauseOwner ?? '未署名'}`,
    });
  }
  for (const ex of doc.exceptions ?? []) {
    if (ex.grantedAt) {
      out.push({
        date: ex.grantedAt,
        kind: 'exception-granted',
        title: `${ex.id} 登记豁免`,
        detail: `${ex.clauseId} · 批准 ${ex.approver ?? '未署名'} · 到期 ${ex.expiresAt ?? '未设'}`,
      });
    }
    if (ex.expiresAt) {
      out.push({
        date: ex.expiresAt,
        kind: 'exception-expire',
        title: `${ex.id} ${ex.status === 'repaid' ? '已销账' : '豁免到期'}`,
        detail: `${ex.clauseId} · 还债人 ${ex.owner ?? '未署名'}`,
      });
    }
  }
  for (const ov of doc.overrides ?? []) {
    if (ov.expiresAt && ov.action === 'relax') {
      out.push({
        date: ov.expiresAt,
        kind: 'override-expire',
        title: `${ov.ruleId} 的放宽到期`,
        detail: `批准 ${ov.approver ?? '未署名'} · 到期后基线重新开始管用`,
      });
    }
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.title.localeCompare(b.title)));
  return out.slice(0, limit);
}

/* ═══════════════════════════════════════════════════════════════════════
   四、现状 —— 哪个模块在持续破规 / 门禁就绪度
   ═══════════════════════════════════════════════════════════════════════ */

export interface AreaRisk {
  area: string;
  openExceptions: number;
  clauses: number;
  exceptions: number;
}

/**
 * 按「路径前两级」聚合的风险分布。
 *
 * 只取前两级是刻意的：`src/main/java/com/arsenal/archify/**` 聚合到
 * `src/main/java` —— 再细就变成逐文件列表（那不是「哪个模块在破规」），
 * 再粗就全仓一片（那等于没分）。
 */
export function areaRiskView(doc: CharterDoc, today: string = todayOf()): AreaRisk[] {
  const areaOf = (glob: string | undefined): string => {
    if (!glob) return '（全项目）';
    const parts = glob.replace(/\*\*.*$/, '').split('/').filter(Boolean);
    return parts.slice(0, 2).join('/') || '（根目录）';
  };
  const map = new Map<string, AreaRisk>();
  const get = (area: string): AreaRisk => {
    let r = map.get(area);
    if (!r) {
      r = { area, openExceptions: 0, clauses: 0, exceptions: 0 };
      map.set(area, r);
    }
    return r;
  };
  for (const c of doc.clauses ?? []) get(areaOf(c.pathGlob)).clauses += 1;
  for (const ex of doc.exceptions ?? []) {
    const r = get(areaOf(ex.pathGlob));
    r.exceptions += 1;
    const st = exState(ex, doc, today);
    if (st !== 'repaid') r.openExceptions += 1;
  }
  return [...map.values()].sort((a, b) => b.openExceptions - a.openExceptions || b.clauses - a.clauses);
}

export interface GateReadiness {
  /** 校验台能判的（regex + ast） */
  machineCheckable: number;
  /** **CI 门禁**能判的（只有 regex —— 执行器不跑 AST） */
  ciRunnable: number;
  /** CI 跑不到、只能人工 review 的（llm / manual） */
  manualOnly: number;
  /** CI 跑不到、但校验台能跑的（ast）—— 换个入口能查，不算「没人管」 */
  astOnly: number;
  ready: boolean;
  blockers: string[];
}

/**
 * 门禁就绪度。
 *
 * 为什么不显示「上次判了多少」：那个数据还不存在（CI 历史是下一批）。
 * **没有数据来源时不能画成 0** —— 那是「看起来正常的假数字」，
 * 本仓为这件事专门红过好几次（章程不可执行数 34 那条、共享配额 0% 那条）。
 *
 * ⚠ 这里刻意分成「校验台能判」与「CI 能判」两套口径：
 * `isClauseMachineCheckable` 把 AST 也算机器可判（校验台有后端深检，确实能判），
 * 而 **CI 执行器只跑正则层**。两套口径混用会得出「门禁已经覆盖全部条款」的结论，
 * 而实际上那些 AST 条款在 CI 里一次都没被跑过。
 */
export function gateReadiness(doc: CharterDoc, today: string = todayOf()): GateReadiness {
  const inForce = (doc.clauses ?? []).filter((c) => isClauseInForce(c, today));
  const ciRunnable = inForce.filter((c) => clauseCheckLayer(c) === 'regex').length;
  const astOnly = inForce.filter((c) => clauseCheckLayer(c) === 'ast').length;
  const manualOnly = inForce.filter((c) => {
    const l = clauseCheckLayer(c);
    return l === 'llm' || l === 'manual';
  }).length;
  const machineCheckable = ciRunnable + astOnly;
  const blockers: string[] = [];
  if (!doc.policy || !doc.policy.overdueException) blockers.push('policy 段缺失：判负口径没有来源');
  if (inForce.length === 0) blockers.push('当前没有已生效条款：门禁只能跑 L0 基线，等于没有项目自己的规矩');
  if (manualOnly > 0) {
    blockers.push(`${manualOnly} 条条款是语义 / 人工层，CI 门禁跑不到 —— 它们只能靠人 review，页面上不会算进「0 违规」`);
  }
  if (astOnly > 0) {
    blockers.push(`${astOnly} 条条款是 AST 层：CI 门禁跑不到（执行器只跑正则），需在校验台点「后端深检」或人工 review`);
  }
  return { machineCheckable, ciRunnable, manualOnly, astOnly, ready: blockers.length === 0, blockers };
}

/* ═══════════════════════════════════════════════════════════════════════
   五、给人看的措辞（页面上那些字）
   ═══════════════════════════════════════════════════════════════════════ */

export const ACTION_KIND_LABEL: Record<ActionKind, string> = {
  'overdue-exception': '例外到期未销账',
  'orphan-debt': '孤儿债（债主离队）',
  'override-expired': '放宽到期失去依据',
  'expiring-soon': '即将到期',
  'not-machine-checkable': '机器判不了的条款',
};

export function actionLevelTone(level: ActionLevel): 'error' | 'warn' | 'ok' {
  return level === 'P0' ? 'error' : level === 'P1' ? 'warn' : 'ok';
}

/** 待办为空时也要说清「不是没有事，而是事都做完了」—— 两者的页面长得一样。 */
export function actionEmptyNote(s: ActionSummary): string {
  if (s.total === 0) {
    return '当前没有待办：没有到期未销账的例外、没有孤儿债、条款都在机器能判的层上。';
  }
  return '';
}
