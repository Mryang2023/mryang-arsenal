'use client';

/**
 * StandardsConsole —— **工程规范台**（原「项目章程」页重定位后的形态）。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 重定位记录（2026-10-05，用户一句话引发的改版）
 *
 * 原来那一版的三个页签回答的是「有什么规矩 / 谁在破例 / 哪条规矩在持续吃豁免」，
 * 三个问题都以**条款**为中心 —— 那是「审章程」的视角。而用户要的是
 * 「多人开发同一个项目，对代码规范进行管理」，主轴应该是**人和待办**。
 *
 * 所以这一版是两层：
 *   上层「治理台」：今天该处理 N 件事 · 责任人矩阵 · 哪个模块在持续吃豁免 ·
 *                   时间线 · 门禁就绪度   —— 回答「该管什么、该谁管」
 *   下层「明细」：原三页签（条款 / 例外 / 债务账）+ 对基线的偏离 + 命名一致性 + 导出
 *                   —— 回答「具体是什么、怎么改」
 *
 * 上层全部派生自下层那份数据，**不新增事实源**（`arsenal-charter/*.json` 一个字没动）。
 * 差别只在「按什么维度聚合」，而聚合逻辑放在 `lib/standards.ts` 纯函数里 ——
 * 这样它能被 `.verify/charter-check.ts` 当数据直接跑，页面只是渲染。
 * ═══════════════════════════════════════════════════════════════════════
 */

import { useMemo, useState } from 'react';

import { charters, primaryCharter, charterSnapshotAt, todayOf, budgetView, l0View } from '@/lib/charter';
import type { CharterDoc } from '@/lib/charter';
import StandardsPanels from './StandardsPanels';
import CharterConsole from '../charter/CharterConsole';

function fmtStamp(iso: string): string {
  if (!iso) return '（未记录）';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function StandardsConsole() {
  const today = todayOf();
  const [charterId, setCharterId] = useState(primaryCharter?.id ?? '');
  const entry = useMemo(
    () => charters.find((c) => c.id === charterId) ?? primaryCharter,
    [charterId],
  );
  const doc: CharterDoc | null = entry?.doc ?? null;

  if (!doc) {
    return (
      <main className="flex-1 px-5 py-8 md:px-8">
        <h1 className="text-xl font-medium text-fg">工程规范台</h1>
        <p className="mt-3 rounded-lg border border-dashed border-line bg-surface px-4 py-6 text-center text-sm text-fgMuted">
          还没有项目章程。<b>没有章程，规范就只是基线那 69 条</b> —— 项目自己的规矩一条都没有。
          <br />
          新建 <code>arsenal-charter/&lt;项目&gt;.json</code>（手写，不进构建生成器），重跑一次 sync 即可。
        </p>
      </main>
    );
  }

  const budget = budgetView(doc, l0View.must, l0View.limit);

  return (
    <main className="flex-1 px-5 py-8 md:px-8">
      {/* ── 抬头 ─────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-xl font-medium text-fg">工程规范台</h1>
        <span className="text-xs text-fgMuted">
          多人开发同一个项目时的规范治理：谁认领、谁欠着、哪里在破、什么时候到期、门禁接没接上。
        </span>
      </header>

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-fgMuted">
        <div>
          <dt className="inline text-fgFaint">项目 </dt>
          <dd className="inline font-mono">{doc.id}</dd>
        </div>
        <div>
          <dt className="inline text-fgFaint">章程负责人 </dt>
          <dd className="inline">{doc.owner}</dd>
        </div>
        <div>
          <dt className="inline text-fgFaint">团队 </dt>
          <dd className="inline">{doc.team.length} 人{doc.team.length ? `（${doc.team.join('、')}）` : ''}</dd>
        </div>
        <div>
          <dt className="inline text-fgFaint">基线 </dt>
          <dd className="inline font-mono">{doc.extends}</dd>
        </div>
        <div>
          <dt className="inline text-fgFaint">MUST 配额 </dt>
          <dd className="inline font-mono">
            {doc.policy?.budgetScope === 'shared' && l0View.must !== null
              ? `${l0View.must} + ${entry?.mustClauses ?? 0} / ${doc.budget?.mustLimit ?? '—'}`
              : `${entry?.mustClauses ?? 0} / ${doc.budget?.mustLimit ?? '—'}`}
          </dd>
        </div>
        <div>
          <dt className="inline text-fgFaint">快照 </dt>
          <dd className="inline font-mono">{fmtStamp(charterSnapshotAt)}</dd>
        </div>
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

      {budget && budget.sharedNote && <p className="mt-2 text-[11px] text-fgFaint">{budget.sharedNote}</p>}

      {/* ── 第一层：治理台（回答「该管什么、该谁管」）────────── */}
      <StandardsPanels doc={doc} today={today} />

      {/* ── 第二层：明细（回答「具体是什么」）───────────────── */}
      <section className="mt-8 border-t border-line pt-5">
        <h2 className="text-sm text-fg">明细</h2>
        <p className="mt-1 text-xs text-fgMuted">
          下面是这一页原来的全部内容（条款 / 例外 / 债务账 / 对基线的偏离 / 命名一致性 / 导出），
          一处没删。上面那层不产生新数据，只是把同一份数据按「人 / 现状 / 时间 / 执行」重排了一次。
        </p>
        <CharterConsole embedded />
      </section>
    </main>
  );
}
