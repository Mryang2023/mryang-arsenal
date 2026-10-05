'use client';

import { useMemo, useState } from 'react';

import {
  primaryCharter,
  charters,
  charterSnapshotAt,
  budgetView,
  clauseCheckLayer,
  consistencyMode,
  debtLedger,
  exceptionCountFor,
  exceptionDisposition,
  isClauseInForce,
  isClauseMachineCheckable,
  overrideView,
  sortedClauses,
  sortedExceptions,
  clauseSeverityTone,
  dispositionToneClass,
  l0View,
  severityBadgeClass,
  layerBadgeClass,
  actionToneClass,
  todayOf,
} from '@/lib/charter';
import type { CharterClause, CharterException, DebtRow } from '@/lib/charter';
import CharterPanels from './CharterPanels';
import CharterExport from './CharterExport';

type Tab = 'clauses' | 'exceptions' | 'debt';

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'clauses', label: '条款列表', hint: '本项目在 69 条行业基线之上额外定下的规矩。每条有 owner、有决策依据、有生效日。' },
  { id: 'exceptions', label: '例外登记簿', hint: '合法破例的台账。每笔有还债人、有到期日 —— 不接受「永久豁免」。' },
  { id: 'debt', label: '债务账', hint: '按条款聚合的未销账豁免。这页的 KPI 是数字下降，不是零。' },
];

/**
 * 项目章程页。
 *
 * 三个页签不是「同一份数据的三种排版」，而是**三个不同的问题**：
 *   条款列表 —— 有什么规矩、为什么这么定
 *   例外登记簿 —— 谁在破例、什么时候还
 *   债务账 —— 哪条规矩在持续吃豁免（那是制度问题，不是执行问题）
 *
 * 全部派生结论都在 `lib/charter.ts` 算完再传进来，本组件只渲染 ——
 * 这样那些计算能被 `.verify/charter-check.ts` 当数据直接跑。
 */
/**
 * 章程明细区。
 *
 * ★ 2026-10-05 起它不再独自成页：`/standards`（工程规范台）把它当「明细」内嵌。
 * 原页面回答的是「章程里有什么」，而用户要的是「多人开发时该管什么」——
 * 后者需要按人 / 现状 / 时间 / 执行重排，那一层在 `lib/standards.ts` + `app/standards/`。
 * 这里的**内容一处没删**，只是从「整页」降级为「明细区」。
 */
export default function CharterConsole({ embedded = false }: { embedded?: boolean } = {}) {
  const [tab, setTab] = useState<Tab>('clauses');
  const [owner, setOwner] = useState('');
  const today = todayOf();

  // 选中的章程：本仓通常只有一份，但按「可有多份」渲染（多份时才有下拉）
  const [charterId, setCharterId] = useState(primaryCharter?.id ?? '');
  const entry = useMemo(
    () => charters.find((c) => c.id === charterId) ?? primaryCharter,
    [charterId],
  );
  const doc = entry?.doc ?? null;

  const clauses = useMemo(() => (doc ? sortedClauses(doc.clauses, today) : []), [doc, today]);
  const exceptions = useMemo(() => (doc ? sortedExceptions(doc.exceptions, doc, today) : []), [doc, today]);
  const debt = useMemo(() => (doc ? debtLedger(doc, today) : []), [doc, today]);

  // L0 侧两个数来自**构建期注入的快照**（sync 链现算）——
  // 静态导出页面渲染时没有文件系统，页面上算就是假数字。
  const budget = useMemo(() => (doc ? budgetView(doc, l0View.must, l0View.limit) : null), [doc]);

  const owners = useMemo(() => (doc ? [...new Set(doc.clauses.map((c) => c.clauseOwner))] : []), [doc]);
  const shownClauses = useMemo(
    () => (owner ? clauses.filter((c) => c.clauseOwner === owner) : clauses),
    [clauses, owner],
  );

  if (!doc || !entry) {
    return (
      <main className="flex-1 px-5 py-8 md:px-8">
        <h1 className="text-xl font-medium text-fg">项目章程</h1>
        <div className="mt-6 rounded-xl border border-line bg-surface p-6 text-sm text-fgMuted">
          <p className="text-fg">还没有任何项目章程。</p>
          <p className="mt-2">
            这是合法起点 —— 章程由各项目自己带，军火库只提供 schema、校验器与这一页。
          </p>
          <p className="mt-3">
            在 <code className="text-brass">arsenal-charter/</code> 下放一份{' '}
            <code className="text-brass">&lt;projectId&gt;.json</code>，构建期会当场校验；
            目录可用 <code className="text-brass">arsenal.json#project.charterDir</code> 或环境变量{' '}
            <code className="text-brass">ARSENAL_CHARTER_DIR</code> 指到别处。
          </p>
          <p className="mt-3 text-fgFaint">
            字段与五道闸门见 <code>arsenal-rules/_schema/charter-contract.mjs</code>。
          </p>
        </div>
      </main>
    );
  }

  return (
    // embedded：被 /standards（工程规范台）当作「明细区」内嵌。
    // 那种情况下抬头与外层 <main> 由治理台提供，这里只出内容 —— 嵌一个 <main>
    // 进去是 HTML 违规，而 h1 重复两遍会破视觉层的「每页 h1 唯一」判据。
    <div className={embedded ? '' : 'flex-1 px-5 py-8 md:px-8'}>
      {!embedded && (
        <>
          {/* ── 抬头：章程身份 ───────────────────────────────── */}
          <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <h1 className="text-xl font-medium text-fg">{doc.name}</h1>
            <span className="font-mono text-xs text-fgFaint">
              {doc.id} · v{doc.version} · 批准于 {doc.ratifiedAt}
            </span>
          </header>

          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-fgMuted">
            <MetaBit label="章程负责人" value={doc.owner} />
            <MetaBit label="基线" value={doc.extends} mono />
            <MetaBit label="团队" value={`${doc.team.length} 人`} />
            <MetaBit label="快照" value={formatStamp(charterSnapshotAt)} mono />
            {charters.length > 1 && (
              <label className="flex items-center gap-1.5">
                <span className="text-fgFaint">切换</span>
                <select
                  value={charterId}
                  onChange={(ev) => setCharterId(ev.target.value)}
                  className="rounded border border-line bg-surface px-1.5 py-0.5 text-fg"
                >
                  {charters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.doc.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </dl>
        </>
      )}

      {/* ── 政策条：四条拍板口径在这一行里，全部来自 policy ── */}
      <PolicyStrip />

      {budget && <BudgetBar budget={budget} />}

      {/* ── 页签 ─────────────────────────────────────────── */}
      <div className="mt-6 flex gap-1 border-b border-line" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={[
              'px-3 py-1.5 text-sm transition-colors',
              tab === t.id
                ? 'border-b-2 border-brass text-fg'
                : 'border-b-2 border-transparent text-fgMuted hover:text-fg',
            ].join(' ')}
          >
            {t.label}
            <span className="ml-1.5 font-mono text-xs text-fgFaint">
              {t.id === 'clauses' ? clauses.length : t.id === 'exceptions' ? exceptions.length : debt.length}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-fgMuted">{TABS.find((t) => t.id === tab)?.hint}</p>

      {tab === 'clauses' && (
        <>
          {owners.length > 1 && (
            <div className="mt-3 flex items-center gap-1.5 text-xs">
              <span className="text-fgFaint">按 owner 筛</span>
              <button
                onClick={() => setOwner('')}
                className={[
                  'rounded px-2 py-0.5',
                  owner === '' ? 'bg-surfaceHi text-fg' : 'text-fgMuted hover:text-fg',
                ].join(' ')}
              >
                全部
              </button>
              {owners.map((o) => (
                <button
                  key={o}
                  onClick={() => setOwner(o === owner ? '' : o)}
                  className={[
                    'rounded px-2 py-0.5',
                    owner === o ? 'bg-surfaceHi text-fg' : 'text-fgMuted hover:text-fg',
                  ].join(' ')}
                >
                  {o}
                </button>
              ))}
            </div>
          )}
          <div className="mt-3 space-y-3">
            {shownClauses.length === 0 && <EmptyNote why="没有条款" />}
            {shownClauses.map((c) => (
              <ClauseCard key={c.id} cl={c} today={today} exceptionCount={exceptionCountFor(doc, c.id)} />
            ))}
          </div>
          {owner && shownClauses.length < clauses.length && (
            <p className="mt-3 text-xs text-fgFaint">
              已按 owner「{owner}」过滤，{shownClauses.length}/{clauses.length} 条。
            </p>
          )}
        </>
      )}

      {tab === 'exceptions' && <ExceptionPanel rows={exceptions} />}

      {tab === 'debt' && <DebtPanel rows={debt} />}

      <CharterPanels doc={doc} today={today} />
      <CharterExport doc={doc} />

      <footer className="mt-8 border-t border-line pt-3 text-xs text-fgFaint">
        章程是手写的 JSON（不经生成器），改它跟改代码一样走 PR。
        <span className="ml-1.5">
          校验在构建期跑：<code>node scripts/sync-content.mjs</code>（五道闸门任一不过即中断）。
        </span>
      </footer>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   分件
   ══════════════════════════════════════════════════════════════ */

function MetaBit({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="inline text-fgFaint">{label}：</dt>
      <dd className={mono ? 'inline font-mono' : 'inline'}>{value}</dd>
    </div>
  );
}

/**
 * 政策条 —— 把 `policy` 四个字段摊开成人读的一句话一条。
 *
 * 为什么放首屏而不是折进设置：这四条是「这套章程怎么管事」的口径，
 * 读条款的人必须先知道「例外到期会不会让构建红」才能理解那些徽标为什么是红的。
 */
function PolicyStrip() {
  const d = primaryCharter?.doc;
  if (!d) return null;
  const p = d.policy;
  const items: { k: string; v: string; hint: string; tone: string }[] = [
    {
      k: '例外到期未销账',
      v: p.overdueException,
      hint:
        p.overdueException === 'error'
          ? '判负，全队构建红'
          : p.overdueException === 'warn'
            ? '只记债务账，不判负'
            : '不检查（不建议）',
      tone: p.overdueException === 'error' ? 'text-rust' : 'text-brass',
    },
    {
      k: '孤儿例外',
      v: p.orphanBlocks === 'warn' ? '不判负' : '仍判负',
      hint: p.orphanBlocks === 'warn' ? '债主离队只进账' : '先补人再销账',
      tone: p.orphanBlocks === 'warn' ? 'text-olive' : 'text-rust',
    },
    {
      k: '例外工单号',
      v: p.requireTicket === 'required' ? '必填' : '可省',
      hint: p.requireTicket === 'required' ? '没有工单号不予受理' : '',
      tone: 'text-fgMuted',
    },
    {
      k: 'MUST 配额',
      v: p.budgetScope === 'separate' ? '与基线各算各的' : '与基线共享',
      hint: p.budgetScope === 'separate' ? '章程有独立上限' : 'L0 50 条与章程相加',
      tone: 'text-fgMuted',
    },
  ];
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((it) => (
        <div key={it.k} className="rounded-lg border border-line bg-surface px-3 py-2">
          <div className="text-[11px] text-fgFaint">{it.k}</div>
          <div className={`text-sm ${it.tone}`}>{it.v}</div>
          {it.hint && <div className="mt-0.5 text-[11px] text-fgFaint">{it.hint}</div>}
        </div>
      ))}
    </div>
  );
}

/** 预算条。`shared` 时显示共享口径说明，不显示时只报本章程的账。 */
function BudgetBar({ budget }: { budget: NonNullable<ReturnType<typeof budgetView>> }) {
  const over = budget.must > budget.limit;
  return (
    <div className="mt-3 rounded-lg border border-line bg-surface px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <span className="text-fgMuted">
          MUST 条款 <span className="font-mono text-fg">{budget.must}</span> / 上限{' '}
          <span className="font-mono">{budget.limit}</span>
          {budget.scope === 'separate' && <span className="ml-1 text-fgFaint">（章程独立口径）</span>}
        </span>
        <span className={over ? 'text-rust' : 'text-fgMuted'}>
          {over ? '已超上限' : `还剩 ${budget.remaining} 条`}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded bg-surfaceMax">
        <div
          className={over ? 'h-full bg-rust' : 'h-full bg-olive'}
          style={{ width: `${Math.max(2, budget.usedPct)}%` }}
        />
      </div>
      {budget.sharedNote && <p className="mt-1.5 text-[11px] text-brass">{budget.sharedNote}</p>}
    </div>
  );
}

function ClauseCard({
  cl,
  today,
  exceptionCount,
}: {
  cl: CharterClause;
  today: string;
  exceptionCount: number;
}) {
  const inForce = isClauseInForce(cl, today);
  const layer = clauseCheckLayer(cl);
  const tone = clauseSeverityTone(cl.severity);

  return (
    <article
      className={[
        'rounded-xl border bg-surface p-4',
        inForce ? 'border-line' : 'border-dashed border-line',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="font-mono text-xs text-fgFaint">{cl.id}</span>
        <span className={`text-[11px] px-1.5 py-0.5 rounded ${severityBadgeClass(cl.severity)}`}>{cl.severity}</span>
        <h3 className="text-sm text-fg">{cl.title}</h3>
        {!inForce && (
          <span className="text-[11px] text-brass">
            未生效（{cl.effectiveFrom} 起）
          </span>
        )}
        {exceptionCount > 0 && (
          <span className="text-[11px] text-brass">
            {exceptionCount} 笔豁免在身
          </span>
        )}
      </div>

      <p className="mt-2 text-xs leading-relaxed text-fgMuted">{cl.rationale}</p>

      <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
        <CodePair kind="bad" code={cl.bad} />
        <CodePair kind="good" code={cl.good} />
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-fgFaint">
        <MetaBit label="归谁管" value={cl.clauseOwner} />
        <MetaBit label="依据" value={cl.decidedBy} mono />
        <MetaBit label="生效日" value={cl.effectiveFrom} mono />
        <MetaBit label="作用域" value={cl.pathGlob} mono />
        <MetaBit label="出处" value={cl.sources.map((s) => s.ref).join('、')} />
        <div>
          <dt className="inline text-fgFaint">检测方式：</dt>
          <dd className="inline">
            <span className={layerBadgeClass(layer)}>{layer}</span>
            {!isClauseMachineCheckable(cl) && (
              <span className="ml-1.5 text-brass">不能机器判定 — 进不了 PR 门</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-2 rounded border border-line bg-surfaceHi px-2.5 py-1.5">
        <span className="text-[11px] text-fgFaint">注入 AI 的约束句：</span>
        <span className="ml-1.5 text-xs text-fgMuted">{cl.promptFragment}</span>
      </div>

      <p className="sr-only">{tone}</p>
    </article>
  );
}

function CodePair({ kind, code }: { kind: 'bad' | 'good'; code: string }) {
  return (
    <div
      className={[
        'rounded border px-2.5 py-1.5',
        kind === 'bad' ? 'border-rust/40 bg-rust/5' : 'border-olive/40 bg-olive/5',
      ].join(' ')}
    >
      <div className={kind === 'bad' ? 'text-[11px] text-rust' : 'text-[11px] text-olive'}>
        {kind === 'bad' ? '反例' : '正例'}
      </div>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-fgMuted">
        {code}
      </pre>
    </div>
  );
}

/* ── 例外登记簿 ─────────────────────────────────────────── */

function ExceptionPanel({ rows }: { rows: CharterException[] }) {
  if (rows.length === 0) {
    return (
      <EmptyNote
        why="例外登记簿是空的"
        extra="这是好状态 —— 没有人在破例。真的需要破例时在这里登记：谁批的、谁还债、什么时候到期。"
      />
    );
  }
  return (
    <div className="mt-3 space-y-2">
      {rows.map((ex) => (
        <ExceptionRow key={ex.id} ex={ex} />
      ))}
    </div>
  );
}

function ExceptionRow({ ex }: { ex: CharterException }) {
  const d = primaryCharter?.doc;
  if (!d) return null;
  const disp = exceptionDisposition(ex, d, todayOf());
  return (
    <article
      className={[
        'rounded-lg border px-3 py-2.5',
        disp.level === 'error' ? 'border-rust/50 bg-rust/5' : disp.level === 'warn' ? 'border-brass/50 bg-brass/5' : 'border-line bg-surface',
      ].join(' ')}
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="font-mono text-xs text-fgFaint">{ex.id}</span>
        <span className="font-mono text-xs text-fgMuted">{ex.clauseId}</span>
        <span className={`text-[11px] rounded px-1.5 py-0.5 ${dispositionToneClass(disp.level)}`}>
          {disp.label}
        </span>
        {ex.status === 'orphaned' && (
          <span className="text-[11px] text-fgFaint">债主已离队</span>
        )}
      </div>
      <p className="mt-1.5 text-xs text-fgMuted">{ex.reason}</p>
      <p className="mt-1 text-[11px] text-fgFaint">{disp.note}</p>
      <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-fgFaint">
        <MetaBit label="批准" value={ex.approver} />
        <MetaBit label="还债人" value={ex.owner} />
        <MetaBit label="批准于" value={ex.grantedAt} mono />
        <MetaBit label="到期" value={ex.expiresAt} mono />
        {ex.ticket ? <MetaBit label="工单" value={ex.ticket} mono /> : <span className="text-brass">无工单号</span>}
        <MetaBit label="范围" value={ex.pathGlob} mono />
      </dl>
    </article>
  );
}

/* ── 债务账 ─────────────────────────────────────────────── */

function DebtPanel({ rows }: { rows: DebtRow[] }) {
  const withDebt = rows.filter((r) => r.openDebt > 0);
  const clean = rows.filter((r) => r.openDebt === 0);
  const totalOpen = withDebt.reduce((n, r) => n + r.openDebt, 0);
  const totalOverdue = withDebt.reduce((n, r) => n + r.overdue, 0);
  const totalOrphan = withDebt.reduce((n, r) => n + r.orphaned, 0);

  if (rows.length === 0) {
    return <EmptyNote why="还没有条款" extra="债务账按条款聚合豁免 —— 没有条款时这张表是空的。" />;
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-4 text-xs text-fgMuted">
        <span>
          未销账豁免 <span className="font-mono text-fg">{totalOpen}</span> 笔
        </span>
        <span className={totalOverdue > 0 ? 'text-rust' : ''}>
          已到期 <span className="font-mono">{totalOverdue}</span> 笔
        </span>
        <span className={totalOrphan > 0 ? 'text-brass' : ''}>
          孤儿（债主离队）<span className="font-mono">{totalOrphan}</span> 笔
        </span>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line text-left text-fgFaint">
              <th className="py-1.5 pr-3 font-normal">条款</th>
              <th className="py-1.5 pr-3 font-normal">归谁管</th>
              <th className="py-1.5 pr-3 font-normal text-right">生效中</th>
              <th className="py-1.5 pr-3 font-normal text-right">已到期</th>
              <th className="py-1.5 pr-3 font-normal text-right">孤儿</th>
              <th className="py-1.5 font-normal text-right">未销账合计</th>
            </tr>
          </thead>
          <tbody>
            {withDebt.map((r) => (
              <tr key={r.clauseId} className="border-b border-line/60">
                <td className="py-1.5 pr-3">
                  <span className="font-mono text-fgFaint">{r.clauseId}</span>
                  <span className="ml-2 text-fgMuted">{r.clauseTitle}</span>
                </td>
                <td className="py-1.5 pr-3 text-fgMuted">{r.clauseOwner}</td>
                <td className="py-1.5 pr-3 text-right font-mono text-fgMuted">{r.active}</td>
                <td className="py-1.5 pr-3 text-right font-mono">
                  <span className={r.overdue > 0 ? 'text-rust' : 'text-fgFaint'}>{r.overdue}</span>
                </td>
                <td className="py-1.5 pr-3 text-right font-mono">
                  <span className={r.orphaned > 0 ? 'text-brass' : 'text-fgFaint'}>{r.orphaned}</span>
                </td>
                <td className="py-1.5 text-right font-mono text-fg">{r.openDebt}</td>
              </tr>
            ))}
            {withDebt.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-fgMuted">
                  没有任何未销账的豁免 —— 制度是干净的。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {clean.length > 0 && (
        <p className="mt-3 text-[11px] text-fgFaint">
          另有 {clean.length} 条条款名下零豁免（{clean.map((r) => r.clauseId).join('、')}）。
        </p>
      )}

      <p className="mt-4 rounded border border-line bg-surfaceHi px-3 py-2 text-[11px] leading-relaxed text-fgMuted">
        <span className="text-fg">这张表的读法：</span>
        一条条款吃 5 个豁免是**制度问题**（那条规矩定得不对，人不得不绕），
        5 条条款各吃 1 个是**执行问题**（人没守住）。两种问题的处置完全不同，
        所以这里按条款聚合而不是罗列例外。存量门不阻断，这张表每周降一点就算好。
      </p>
    </div>
  );
}

function EmptyNote({ why, extra }: { why: string; extra?: string }) {
  return (
    <div className="mt-3 rounded-xl border border-dashed border-line bg-surface px-4 py-6 text-center">
      <p className="text-sm text-fgMuted">{why}</p>
      {extra && <p className="mt-1.5 text-xs text-fgFaint">{extra}</p>}
    </div>
  );
}

/* ── 小工具 ─────────────────────────────────────────────── */

function formatStamp(iso: string): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').slice(0, 19);
}

