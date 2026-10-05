'use client';

/**
 * StandardsPanels.tsx —— 工程规范台的**四块屏** + 顶部汇总带。
 *
 * 为什么是「四块并列」而不是一个主轴（2026-10-05 拍板）：
 * 多人协作时这四个问题会同时冒出来，而**先看哪个**取决于你今天要干什么 ——
 * 所以做成并列的四屏 + 顶部一条「今天该处理 N 件事」，而不是替用户选主轴。
 *
 * 四个问题与它们的差别（这一段是判断依据，不是装饰）：
 *   人    谁负责、谁欠着、谁离队了 —— 治理责任
 *   现状  哪个模块在持续吃豁免、门禁能不能接 —— 风险位置
 *   时间  什么时候生效、什么时候到期 —— 节奏
 *   执行  门禁在不在跑、判了多少 —— 事实
 *
 * ⚠ 有一块**故意不显示数字**：执行屏现在显示的是「门禁就绪度」而不是
 * 「上次判了多少」。CI 判罚历史是下一批（要执行器写 jsonl）。
 * **没有数据来源时画成 0 就是「看起来正常的假数字」** —— 本仓为这件事红过好几次
 * （章程不可执行数 34、共享配额 0%），所以这里明说「尚无历史记录」并给出接法。
 */

import {
  actionItems,
  actionSummary,
  actionEmptyNote,
  actionLevelTone,
  peopleView,
  timelineView,
  areaRiskView,
  gateReadiness,
  ACTION_KIND_LABEL,
  EXPIRING_SOON_DAYS,
} from '@/lib/standards';
import type { ActionItem, ActionKind } from '@/lib/standards';
import type { CharterDoc } from '@/lib/charter';
import rosterRaw from '@/generated/roster.json';
import ciHistoryRaw from '@/generated/ci-history.json';
import { rosterDiff, activeTeam } from '@/lib/roster';
import type { RosterFile } from '@/lib/roster';

const TONE_CLASS = {
  error: 'bg-rust/15 text-rust',
  warn: 'bg-brass/15 text-brass',
  ok: 'bg-olive/15 text-olive',
} as const;

function LevelChip({ level }: { level: ActionItem['level'] }) {
  const tone = actionLevelTone(level);
  return (
    <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${TONE_CLASS[tone]}`}>{level}</span>
  );
}

/* ══ 汇总带 ══════════════════════════════════════════════════════════ */

export function ActionBand({ doc, today, team }: { doc: CharterDoc; today: string; team?: readonly string[] }) {
  const items = actionItems(doc, today, team);
  const s = actionSummary(items);
  const kinds = Object.entries(s.byKind).filter(([, n]) => n > 0) as [ActionKind, number][];

  return (
    <section className="mt-5 rounded-lg border border-line bg-surface px-4 py-3.5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
        <h2 className="text-sm text-fg">今天该处理的事</h2>
        {s.total === 0 ? (
          <span className="text-xs text-olive">0 件 —— 例外都销了账、没人离队、条款都在机器能判的层上</span>
        ) : (
          <span className="font-mono text-xs text-fgMuted">
            共 <b className="text-fg">{s.total}</b> 件 · P0 <b className={s.p0 ? 'text-rust' : 'text-fgFaint'}>{s.p0}</b>
            {' · '}P1 <b className={s.p1 ? 'text-brass' : 'text-fgFaint'}>{s.p1}</b>
            {' · '}P2 <b className={s.p2 ? 'text-fg' : 'text-fgFaint'}>{s.p2}</b>
          </span>
        )}
      </div>

      {kinds.length > 0 && (
        <ul className="mt-2.5 flex flex-wrap gap-1.5">
          {kinds.map(([k, n]) => (
            <li key={k} className="rounded border border-line px-2 py-0.5 text-[11px] text-fgMuted">
              {ACTION_KIND_LABEL[k]} <span className="font-mono text-fg">{n}</span>
            </li>
          ))}
        </ul>
      )}

      {s.total > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {items.map((it) => (
            <li key={it.id} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-t border-line pt-1.5">
              <LevelChip level={it.level} />
              <span className="text-xs text-fg">{it.title}</span>
              <span className="text-[11px] text-fgFaint">
                该谁处理：<b className="text-fgMuted">{it.who ?? '无（不是「随便谁」）'}</b>
                {it.due ? ` · 到期 ${it.due}` : ''}
              </span>
              <p className="w-full text-[11px] text-fgMuted">{it.detail}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[11px] text-fgFaint">{actionEmptyNote(s)}</p>
      )}
    </section>
  );
}

/* ══ 一、人 ══════════════════════════════════════════════════════════ */

export function PeoplePanel({ doc, today, team }: { doc: CharterDoc; today: string; team?: readonly string[] }) {
  const { rows, outsiders, unassigned } = peopleView(doc, today, team);
  const cell = 'px-2 py-1 align-top';

  return (
    <section className="mt-6 border-t border-line pt-5">
      <h2 className="text-sm text-fg">责任人矩阵</h2>
      <p className="mt-1 text-xs text-fgMuted">
        多人开发最容易烂掉的地方不是「没有规矩」，而是<b>没人认领</b>。这一屏把「谁负责哪条规矩、
        谁欠着哪笔豁免、谁批的」摆成表。名字只在台账里、不在团队里的人单列出来 ——
        那通常意味着有人离队了，而他的债还挂着。
      </p>

      {rows.length === 0 && outsiders.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line bg-surface px-3 py-4 text-center text-xs text-fgFaint">
          还没有人认领任何条款或豁免。
        </p>
      ) : (
        <>
        {/* 窄屏：一人一卡。表格在 375px 里会把「他要还的豁免」这类列头挤成竖排单字 ——
            横向溢出是 0（断言 A1 抓不到），但可读性已经没了。 */}
        <ul className="mt-3 space-y-2 md:hidden">
          {rows.map((r) => (
            <li key={`m-${r.name}`} className="rounded-lg border border-line bg-surface px-3 py-2.5 text-xs">
              <div className="flex flex-wrap items-baseline gap-x-2.5">
                <b className="text-sm text-fg">{r.name}</b>
                {r.overdue > 0 && <span className="text-rust">逾期 {r.overdue}</span>}
                {r.orphan > 0 && <span className="text-brass">孤儿 {r.orphan}</span>}
              </div>
              <dl className="mt-1.5 space-y-1">
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-fgFaint">负责条款</dt>
                  <dd className="font-mono text-fgMuted">{r.ownsClauses.join('、') || '—'}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-fgFaint">要还的豁免</dt>
                  <dd className="font-mono text-fgMuted">{r.owesExceptions.join('、') || '—'}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-fgFaint">他批的</dt>
                  <dd className="font-mono text-fgFaint">{r.approvedExceptions.join('、') || '—'}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
        <div className="mt-3 hidden overflow-x-auto md:block">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-line text-left text-fgFaint">
                <th className={cell}>人</th>
                <th className={cell}>负责条款</th>
                <th className={cell}>他要还的豁免</th>
                <th className={cell}>他批的</th>
                <th className={cell}>逾期 / 孤儿</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name} className="border-b border-line/50">
                  <td className={`${cell} font-medium text-fg`}>{r.name}</td>
                  <td className={cell}>
                    {r.ownsClauses.length ? (
                      <span className="font-mono text-fgMuted">{r.ownsClauses.join('、')}</span>
                    ) : (
                      <span className="text-fgFaint">—</span>
                    )}
                  </td>
                  <td className={cell}>
                    {r.owesExceptions.length ? (
                      <span className="font-mono text-fgMuted">{r.owesExceptions.join('、')}</span>
                    ) : (
                      <span className="text-fgFaint">—</span>
                    )}
                  </td>
                  <td className={`${cell} font-mono text-fgFaint`}>{r.approvedExceptions.join('、') || '—'}</td>
                  <td className={cell}>
                    {r.overdue > 0 && <span className="text-rust">逾期 {r.overdue}</span>}
                    {r.overdue > 0 && r.orphan > 0 && ' / '}
                    {r.orphan > 0 && <span className="text-brass">孤儿 {r.orphan}</span>}
                    {r.overdue === 0 && r.orphan === 0 && <span className="text-fgFaint">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </>
      )}

      {outsiders.length > 0 && (
        <p className="mt-2.5 rounded-lg border border-brass/50 bg-brass/5 px-3 py-2 text-[11px] text-brass">
          不在团队里的名字还挂在台账上：{outsiders.map((o) => `${o.name}（${o.owesExceptions.length} 笔豁免${o.orphan ? `，${o.orphan} 笔成孤儿` : ''}）`).join('；')}。
          债主离队后责任回到章程负责人身上 —— 挂着的孤儿债只会让「有台账」变成「有遗留」。
        </p>
      )}
      {unassigned.clauseExceptions.length > 0 && (
        <p className="mt-2 text-[11px] text-rust">
          {unassigned.clauseExceptions.length} 笔豁免没有还债人 —— 构建期就会失败，这里只是让它在页面上也看得见。
        </p>
      )}
    </section>
  );
}

/* ══ 二、现状 ════════════════════════════════════════════════════════ */

export function AreaRiskPanel({ doc, today }: { doc: CharterDoc; today: string }) {
  const areas = areaRiskView(doc, today);
  const max = Math.max(1, ...areas.map((a) => a.openExceptions));

  return (
    <section className="mt-6 border-t border-line pt-5">
      <h2 className="text-sm text-fg">哪个模块在持续吃豁免</h2>
      <p className="mt-1 text-xs text-fgMuted">
        按路径前两级聚合。<b>这里只数「未销账的豁免」</b>，因为一条规矩反复被豁免，
        那是制度问题（规矩定得不现实），不是执行问题。
      </p>

      {areas.length === 1 ? (
        // ★ 只有一个模块时**不画条**：满格会被读成「很严重」，而实际上
        // 「全仓只有一个模块」这件事跟「这里破例很多」毫无关系。
        // 比例只在**有得比**的时候才有意义 —— 这与「组件风险用前两级聚合」同源：
        // 聚合是为了可比，样本只有一条时可比性为零。
        <div className="mt-3 rounded-lg border border-line bg-surface px-3 py-3 text-xs">
          <p className="text-fg">
            当前只有 <b className="font-mono">{areas[0].area}</b> 一个范围：
            未销账豁免 <b className="font-mono">{areas[0].openExceptions}</b> · 条款{' '}
            <b className="font-mono">{areas[0].clauses}</b> · 豁免{' '}
            <b className="font-mono">{areas[0].exceptions}</b>
          </p>
          <p className="mt-1 text-[11px] text-fgFaint">
            只有一个范围时条形图没有对比意义（永远是满格），所以这里不画。
            等范围多起来（接入中枢名册、或者章程覆盖多个模块）它才会长出来。
          </p>
        </div>
      ) : areas.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line bg-surface px-3 py-4 text-center text-xs text-fgFaint">
          还没有条款与豁免 —— 无从分布。
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {areas.map((a) => (
            <li key={a.area} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="w-44 shrink-0 font-mono text-xs text-fg">{a.area}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-sm bg-line/40">
                <span
                  className="block h-2 rounded-sm bg-brass/70"
                  style={{ width: `${Math.round((a.openExceptions / max) * 100)}%` }}
                />
              </span>
              <span className="font-mono text-[11px] text-fgMuted">
                未销账 {a.openExceptions} · 条款 {a.clauses} · 豁免 {a.exceptions}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-fgFaint">
        条形图只表示相对高低，不表示严重程度 —— 「有豁免」本身是合法的，这台账存在的意义是<b>到期有人还</b>。
      </p>
    </section>
  );
}

/* ══ 三、时间 ════════════════════════════════════════════════════════ */

export function TimelinePanel({ doc, today }: { doc: CharterDoc; today: string }) {
  const items = timelineView(doc, today, 12);
  return (
    <section className="mt-6 border-t border-line pt-5">
      <h2 className="text-sm text-fg">时间线</h2>
      <p className="mt-1 text-xs text-fgMuted">
        章程里的日期散在五个字段里（条款生效日、豁免授予日 / 到期日、放宽到期日）。
        排成一条线是为了看见<b>巧合</b> —— 比如三条规矩同一天到期，那种事只有排出来才看得见。
      </p>

      {items.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line bg-surface px-3 py-4 text-center text-xs text-fgFaint">
          没有带日期的记录。
        </p>
      ) : (
        <ol className="mt-3 space-y-1 border-l border-line pl-3">
          {items.map((it, i) => (
            <li key={`${it.date}-${i}`} className="flex flex-wrap items-baseline gap-x-2.5 text-xs">
              <span className="font-mono text-[11px] text-fgFaint">{it.date}</span>
              <span className="text-fg">{it.title}</span>
              <span className="text-[11px] text-fgMuted">{it.detail}</span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-2 text-[11px] text-fgFaint">
        「即将到期」的完整清单在上面的待办里（阈值 {EXPIRING_SOON_DAYS} 天）—— 这里只按时间排，不重复判断。
      </p>
    </section>
  );
}

/* ══ 四、执行 ════════════════════════════════════════════════════════ */

export function GatePanel({ doc, today }: { doc: CharterDoc; today: string }) {
  const g = gateReadiness(doc, today);
  return (
    <section className="mt-6 border-t border-line pt-5">
      <h2 className="text-sm text-fg">门禁就绪度</h2>
      <p className="mt-1 text-xs text-fgMuted">
        这一屏回答「能不能把规范真正卡到代码上」。当前只显示<b>就绪度</b>，
        不显示「上次判了多少条」—— CI 判罚历史要执行器每次写入才算数，
        <b>没有记录时画 0 就是假数字</b>，所以这里不画。
      </p>

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <span className="text-fgMuted">
          CI 能判（正则层） <b className="font-mono text-fg">{g.ciRunnable}</b>
        </span>
        <span className="text-fgMuted">
          AST 层（CI 跑不到，校验台可深检）{' '}
          <b className={`font-mono ${g.astOnly ? 'text-brass' : 'text-fg'}`}>{g.astOnly}</b>
        </span>
        <span className="text-fgMuted">
          语义 / 人工层（只能人 review）{' '}
          <b className={`font-mono ${g.manualOnly ? 'text-brass' : 'text-fg'}`}>{g.manualOnly}</b>
        </span>
        <span className="text-fgMuted">
          状态{' '}
          {g.ready ? (
            <b className="text-olive">可接 CI</b>
          ) : (
            <b className="text-brass">接之前先处理下面的事</b>
          )}
        </span>
      </div>

      {g.blockers.length > 0 && (
        <ul className="mt-2.5 space-y-1">
          {g.blockers.map((b) => (
            <li key={b} className="text-[11px] text-brass">· {b}</li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[11px] text-fgFaint">
        接法与每一步的说明见 <code>docs/项目章程-CI落地指南.md</code>；片段在下方「导出」区，
        两个 job：PR 门（只判本次改动）与每周的存量债务账（不阻断）。
      </p>
    </section>
  );
}


/* ══ 名册一致性（A 方向：中枢团队名册 vs 章程手写名单）══════════════════ */

export function RosterPanel({ doc }: { doc: CharterDoc }) {
  const diff = rosterDiff(rosterRaw as unknown as RosterFile, doc);
  const toneCls = diff.available ? (diff.agree ? 'text-olive' : 'text-brass') : 'text-fgFaint';
  return (
    <section className="mt-6 border-t border-line pt-5">
      <h2 className="text-sm text-fg">团队名册一致性</h2>
      <p className="mt-1 text-xs text-fgMuted">
        「谁离队了」这条判据只能来自中枢 —— 章程里那份 <b>手写 team 名单必然过期</b>，
        忘了更新就永远发现不了孤儿债。这里把两侧摆在一起对照，并标明当前判定用的是哪一份。
      </p>

      {/* 本章程属于哪支团队（teamRef，2026-10-05 加）。不配也合法 ——
          不接中枢的项目不该被逼着编一个团队 id。 */}
      <p className="mt-1.5 text-[11px] text-fgFaint">
        本章程归属：{' '}
        {doc.teamRef ? (
          <b className="font-mono text-fgMuted">
            {doc.teamRef.system} team#{doc.teamRef.teamId}
            {doc.teamRef.teamName ? `（${doc.teamRef.teamName}）` : ''}
          </b>
        ) : (
          <>未指定中枢团队（<code>teamRef</code> 没写）—— 名册同步会用环境变量{' '}
            <code>ARSENAL_CC_TEAM_ID</code> 指定的团队</>
        )}
      </p>

      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <span className="text-fgMuted">
          当前判定口径{' '}
          <b className={diff.usedSource === 'command-center' ? 'text-olive' : 'text-brass'}>
            {diff.usedSource === 'command-center' ? '中枢名册' : '章程手写名单'}
          </b>
        </span>
        {diff.teamName && (
          <span className="text-fgMuted">团队 <b className="font-mono text-fg">{diff.teamName}</b></span>
        )}
        {diff.available && (
          <span className="text-fgMuted">中枢 {diff.rosterNames.length} 人 · 章程 {diff.charterNames.length} 人</span>
        )}
        {diff.fetchedAt && (
          <span className="text-fgFaint">拉取于 {diff.fetchedAt.slice(0, 19).replace('T', ' ')}</span>
        )}
      </div>

      <p className={`mt-2 text-[11px] ${toneCls}`}>{diff.note}</p>

      {diff.available && (diff.onlyInRoster.length > 0 || diff.onlyInCharter.length > 0) && (
        <ul className="mt-2 space-y-1">
          {diff.onlyInCharter.map((n) => (
            <li key={`out-${n}`} className="text-[11px] text-rust">
              · {n}：在中枢已不在这个团队 —— 若他名下有豁免，那些豁免已转孤儿债
            </li>
          ))}
          {diff.onlyInRoster.map((n) => (
            <li key={`in-${n}`} className="text-[11px] text-brass">
              · {n}：中枢有、章程 team 没登记 —— 想让他认领条款就把名字补进章程
            </li>
          ))}
        </ul>
      )}

      {!diff.available && (
        <p className="mt-2 text-[11px] text-fgFaint">
          接入方式：给军火库的构建环境配三个环境变量
          （<code>ARSENAL_CC_BASE_URL</code> / <code>ARSENAL_CC_API_KEY</code> /
          <code>ARSENAL_CC_TEAM_ID</code>），sync 会自动拉一次。
          契约与实测步骤见 <code>docs/开发计划-2026-10-05-中枢联动/</code>。
        </p>
      )}
    </section>
  );
}


/* ══ 判罚历史（门禁真的在跑吗）══════════════════════════════════════ */

interface CiRow {
  at: string; mode: string; files: number; blocking: number;
  advisory: number; waived: number; exitCode: number;
}
interface CiHistory {
  status: 'ok' | 'empty';
  reason?: string;
  generatedAt?: string;
  total?: number;
  badLines?: number;
  firstAt?: string;
  latest?: CiRow | null;
  byMode?: Record<string, { runs: number; blocking: number; blockedRuns: number; waived: number }>;
  series?: CiRow[];
}

export function GateHistoryPanel() {
  const h = ciHistoryRaw as unknown as CiHistory;
  if (!h || h.status !== 'ok' || !h.latest) {
    return (
      <section className="mt-6 border-t border-line pt-5">
        <h2 className="text-sm text-fg">门禁判罚记录</h2>
        <p className="mt-2 rounded-lg border border-dashed border-line bg-surface px-3 py-4 text-xs text-fgMuted">
          <b>尚无判罚记录</b> —— 上面那块显示的是「能不能接」，这一块回答的是「到底跑了没有」。
          <br />
          跑一次就会有了：<code>charter-ci.mjs lint … --history arsenal-standards/ci-history.jsonl</code>
          （导出的 CI 片段里加这一句即可）。<b>这里不会画成 0</b> —— 没有记录与跑了 0 条是两件事。
        </p>
      </section>
    );
  }

  const pr = h.byMode?.pr;
  const au = h.byMode?.audit;
  const series = (h.series ?? []).slice(-12);
  const max = Math.max(1, ...series.map((r) => r.blocking));

  return (
    <section className="mt-6 border-t border-line pt-5">
      <h2 className="text-sm text-fg">门禁判罚记录</h2>
      <p className="mt-1 text-xs text-fgMuted">
        「就绪度」回答能不能接，这一块回答<b>到底跑了没、判了多少</b>。
        每次判定由执行器追加一行 jsonl（<code>--history</code>），构建期汇总成这一屏。
        <b>不是实时的</b> —— 它随仓库里的 jsonl 走，跑一次门禁就要提交一次历史。
      </p>

      <div className="mt-3 rounded-lg border border-line bg-surface px-3 py-2.5 text-xs">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-fgMuted">
            最近一次 <b className="font-mono text-fg">{h.latest.at.slice(0, 19).replace('T', ' ')}</b>
          </span>
          <span className="rounded bg-line/40 px-1.5 py-0.5 text-[11px] text-fg">
            {h.latest.mode === 'pr' ? 'PR 门' : '存量账'}
          </span>
          <span className="text-fgMuted">
            判 <b className={h.latest.blocking ? 'text-rust' : 'text-olive'}>{h.latest.blocking}</b> 条阻断
            {h.latest.advisory > 0 && <span className="text-fgFaint"> · {h.latest.advisory} 条提示</span>}
            {h.latest.waived > 0 && <span className="text-fgFaint"> · 放行 {h.latest.waived} 处</span>}
          </span>
          <span className="text-fgMuted">
            判了 <b className="font-mono text-fg">{h.latest.files}</b> 个文件
          </span>
          <span className={h.latest.exitCode !== 0 ? 'text-rust' : 'text-olive'}>
            {h.latest.exitCode !== 0 ? '⛔ 拦下了' : '✓ 放行'}
          </span>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1 text-xs text-fgMuted">
        <span>
          PR 门：跑 <b className="font-mono text-fg">{pr?.runs ?? 0}</b> 次 · 拦下{' '}
          <b className="font-mono text-fg">{pr?.blockedRuns ?? 0}</b> 次 · 累计判负{' '}
          <b className="font-mono text-fg">{pr?.blocking ?? 0}</b>
        </span>
        <span>
          存量账：跑 <b className="font-mono text-fg">{au?.runs ?? 0}</b> 次（<b>从不阻断</b>，只记账）
        </span>
        <span className="text-fgFaint">
          共 {h.total} 次记录{h.badLines ? ` · ⚠ ${h.badLines} 行读不出来` : ''}
          {h.firstAt ? ` · 最早 ${h.firstAt.slice(0, 10)}` : ''}
        </span>
      </div>

      {series.length > 0 && (
        <ul className="mt-3 space-y-1">
          {series.map((r) => (
            <li key={r.at + r.mode} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              <span className="w-32 shrink-0 font-mono text-[11px] text-fgFaint">
                {r.at.slice(5, 16).replace('T', ' ')}
              </span>
              <span className="w-12 shrink-0 text-[11px] text-fgFaint">{r.mode === 'pr' ? 'PR 门' : '存量'}</span>
              <span className="h-2 w-40 overflow-hidden rounded-sm bg-line/40">
                <span
                  className={`block h-2 rounded-sm ${r.blocking ? 'bg-rust/70' : 'bg-olive/50'}`}
                  style={{ width: `${Math.round((r.blocking / max) * 100)}%` }}
                />
              </span>
              <span className="font-mono text-[11px] text-fgMuted">
                判负 {r.blocking} · {r.files} 文件
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-fgFaint">
        条形长度表示判负条数的相对高低。存量账那条通常最长 —— 它扫全仓，而 PR 门只看本次改动。
        <b>这是正常的</b>：存量账的价值是让数字下降，不是恒为零。
      </p>
    </section>
  );
}

export default function StandardsPanels({ doc, today }: { doc: CharterDoc; today: string }) {
  const team = activeTeam(rosterDiff(rosterRaw as unknown as RosterFile, doc));
  return (
    <>
      <ActionBand doc={doc} today={today} team={team} />
      <PeoplePanel doc={doc} today={today} team={team} />
      <RosterPanel doc={doc} />
      <AreaRiskPanel doc={doc} today={today} />
      <TimelinePanel doc={doc} today={today} />
      <GatePanel doc={doc} today={today} />
      <GateHistoryPanel />
    </>
  );
}
