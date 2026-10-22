'use client';

/**
 * 项目档案 · 「四件套校验」页签。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 这一页回答三个不同的问题，故意放在一起，因为它们是同一条链：
 *
 *   ① 现在缺什么        —— verify（只读审计，口径与档案页同源）
 *   ② 计划改哪张表      —— plans（军火库自己的留档，记录 ≠ 操作）
 *   ③ 计划稿长什么样    —— plan 详情，四份正文可复制
 *
 * 页面里没有任何「执行」「应用」「写入」按钮，这是刻意的：
 * 军火库只记录我们开发 IEMS 时做过/计划过什么，不主动操作它管理的项目。
 * 真正把四件套写进仓库的是编辑器里的人和 AI；写完刷新缓存，审计才会变绿。
 * ═══════════════════════════════════════════════════════════════════════
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import CopyButton from '@/components/CopyButton';
import {
  getDdlPlan,
  getProjectDdlVerify,
  listDdlPlans,
  type DdlIssue,
  type DdlPlan,
  type DdlPlanSummary,
  type DdlTableAudit,
  type DdlVerify,
} from '@/lib/projects-api';

type AuditLoad =
  | { kind: 'loading' }
  | { kind: 'ok'; data: DdlVerify }
  | { kind: 'failed'; message: string; offline?: boolean };

export default function AuditTab({ pid }: { pid: string }) {
  const [load, setLoad] = useState<AuditLoad>({ kind: 'loading' });
  const [plans, setPlans] = useState<DdlPlanSummary[]>([]);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [selected, setSelected] = useState('');
  const [openPlanId, setOpenPlanId] = useState('');
  const [planDetail, setPlanDetail] = useState<DdlPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoad({ kind: 'loading' });
    getProjectDdlVerify(pid).then((o) => {
      if (!alive) return;
      if (o.kind === 'ok') setLoad({ kind: 'ok', data: o.data });
      else if (o.kind === 'offline') setLoad({ kind: 'failed', message: o.message, offline: true });
      else setLoad({ kind: 'failed', message: `${o.code}：${o.message}` });
    });
    listDdlPlans(pid).then((o) => {
      if (!alive) return;
      if (o.kind === 'ok') {
        setPlans(o.data);
        setPlansError(null);
      } else {
        setPlansError(o.kind === 'offline' ? o.message : `${o.code}：${o.message}`);
      }
    });
    return () => {
      alive = false;
    };
  }, [pid, nonce]);

  const data = load.kind === 'ok' ? load.data : null;

  const current = useMemo(() => {
    if (!data?.tables.length) return null;
    return data.tables.find((t) => t.table === selected) ?? data.tables[0];
  }, [data, selected]);

  const openPlan = useCallback(
    (planId: string) => {
      setOpenPlanId(planId);
      setPlanDetail(null);
      setPlanError(null);
      getDdlPlan(pid, planId).then((o) => {
        if (o.kind === 'ok') setPlanDetail(o.data);
        else setPlanError(o.kind === 'offline' ? o.message : `${o.code}：${o.message}`);
      });
    },
    [pid],
  );

  if (load.kind === 'loading') {
    return <p className="mt-5 text-sm text-fgMuted">正在审计四件套…</p>;
  }

  if (load.kind === 'failed') {
    return (
      <div className="mt-5 panel px-4 py-4">
        <p className="text-sm text-fg">{load.message}</p>
        {load.offline && (
          <p className="mt-2 text-xs text-fgMuted">
            审计要连后端 :3011，起服务的命令：<code className="mono">bash arsenal-server/scripts/run.sh</code>
          </p>
        )}
      </div>
    );
  }

  if (!data) return null;

  if (!data.available) {
    return (
      <p className="mt-4 rounded border border-dashed border-line px-3 py-4 text-sm text-fgMuted">
        项目缓存不存在 —— 没有可审计的东西。去「项目管理」刷新一次缓存。
      </p>
    );
  }

  const s = data.summary;

  return (
    <div className="mt-4 space-y-6">
      {/* ── 总览：分数 + 四件各自的覆盖率 ── */}
      <section className="panel px-4 py-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="text-3xl font-medium text-fg">{data.score}</span>
          <span className="text-xs text-fgMuted">/ 100 · 四件齐全的表占比</span>
          <span className="text-xs text-fgMuted">
            {s.complete} 完整 · {s.partial} 部分 · {s.missing} 缺失
          </span>
          <button
            type="button"
            onClick={() => setNonce((n) => n + 1)}
            className="ml-auto rounded border border-line px-2.5 py-1 text-2xs text-fgMuted transition-colors hover:bg-surfaceHi hover:text-fg"
          >
            重新审计
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.checks.map((c) => (
            <div key={c.key}>
              <div className="flex items-baseline justify-between text-2xs">
                <span className="text-fgMuted">{c.label}</span>
                <span className={c.ok ? 'text-olive' : 'text-fg'}>
                  {c.covered}/{c.total}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded bg-surfaceHi">
                <div
                  className={c.ok ? 'h-full bg-olive' : c.percent > 0 ? 'h-full bg-brass' : 'h-full bg-rust'}
                  style={{ width: `${c.percent}%` }}
                />
              </div>
            </div>
          ))}
        </div>

        <p className="mt-4 text-2xs text-fgMuted">
          脚本 {s.scripts} 份（模板 {s.templateScripts}）· 变更日志 {s.changelogEntries} 条 · 表说明{' '}
          {s.documented} 份 · 实体 {s.entities} 个
        </p>

        {data.findings.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-line pt-3">
            {data.findings.map((f, i) => (
              <li key={i} className="text-xs">
                <span className={`mr-2 ${issueTone(f.level)}`}>{levelLabel(f.level)}</span>
                <span className="text-fgMuted">{f.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 逐表矩阵：四件各一列，缺哪件一眼看见 ── */}
      <section>
        <h2 className="text-sm font-medium text-fg">逐表检查</h2>
        <p className="mt-1 text-2xs text-fgMuted">
          点一行看明细。✓ 有 · — 缺 · 「字段数不一致」表示表说明和实体写的不是同一张表。
        </p>
        <div className="mt-2 max-h-[420px] overflow-auto rounded border border-line">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-surfaceHi text-2xs text-fgMuted">
              <tr>
                <th className="px-3 py-2 font-normal">表</th>
                <th className="px-2 py-2 font-normal">脚本</th>
                <th className="px-2 py-2 font-normal">日志</th>
                <th className="px-2 py-2 font-normal">说明</th>
                <th className="px-2 py-2 font-normal">实体</th>
                <th className="px-2 py-2 font-normal">结论</th>
              </tr>
            </thead>
            <tbody>
              {data.tables.map((t) => (
                <tr
                  key={t.table}
                  onClick={() => setSelected(t.table)}
                  className={
                    'cursor-pointer border-t border-line/60 align-top transition-colors hover:bg-surfaceHi ' +
                    (current?.table === t.table ? 'bg-surfaceHi/60' : '')
                  }
                >
                  <td className="px-3 py-2">
                    <div className="font-mono text-2xs text-fg">{t.table}</div>
                    <div className="text-2xs text-fgFaint">{t.title || '（无中文名）'}</div>
                  </td>
                  <td className="px-2 py-2">
                    <Piece ok={t.pieces.sql.ok} />
                  </td>
                  <td className="px-2 py-2">
                    <Piece ok={t.pieces.changelog.ok} />
                  </td>
                  <td className="px-2 py-2">
                    <Piece ok={t.pieces.tableDoc.ok} />
                  </td>
                  <td className="px-2 py-2">
                    <Piece ok={t.pieces.entity.ok} />
                  </td>
                  <td className="px-2 py-2">
                    <StatusPill status={t.status} />
                    {t.reconcile.comparable && !t.reconcile.match && (
                      <span className="ml-2 text-2xs text-brass">字段数不一致</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 单表明细 ── */}
      {current && <TableAuditPanel t={current} />}

      {/* ── 计划留档 ── */}
      <section>
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-sm font-medium text-fg">变更计划留档（{plans.length}）</h2>
          <span className="text-2xs text-fgMuted">
            这里只记「计划过什么」。军火库不写被管理项目的文件，也不执行 SQL。
          </span>
        </div>

        {plansError && <p className="mt-2 text-xs text-rust">{plansError}</p>}

        {plans.length === 0 ? (
          <p className="mt-2 rounded border border-dashed border-line px-3 py-4 text-xs text-fgMuted">
            还没有计划。改表前调 <code className="mono">POST /ddl/plan</code> 生成四件套草稿，
            那份草稿会记在这里 —— 包括它「打算写到哪个路径」。
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-line/60 rounded border border-line">
            {plans.map((p) => (
              <li key={p.planId}>
                <button
                  type="button"
                  onClick={() => openPlan(p.planId)}
                  className={
                    'flex w-full flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-left transition-colors hover:bg-surfaceHi ' +
                    (openPlanId === p.planId ? 'bg-surfaceHi/60' : '')
                  }
                >
                  <span className="font-mono text-2xs text-fgFaint">
                    {fmtStamp(p.recordedAt || p.generatedAt)}
                  </span>
                  <span className="text-xs text-fg">{p.title || p.table}</span>
                  <span className="font-mono text-2xs text-fgMuted">{p.table}</span>
                  <span className="rounded border border-line px-1.5 py-0.5 text-2xs text-fgMuted">
                    {p.operation}
                  </span>
                  {p.problems.length > 0 ? (
                    <span className="text-2xs text-brass">{p.problems.length} 条提示</span>
                  ) : (
                    <span className="text-2xs text-olive">校验通过</span>
                  )}
                  <span className="ml-auto text-2xs text-fgFaint">
                    {p.stats.businessColumns} 业务字段 · {p.stats.indexes} 索引
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {openPlanId && (
          <div className="mt-3">
            {planError && <p className="text-xs text-rust">{planError}</p>}
            {!planDetail && !planError && <p className="text-xs text-fgMuted">正在取计划全文…</p>}
            {planDetail && <PlanDetail plan={planDetail} />}
          </div>
        )}
      </section>
    </div>
  );
}

function Piece({ ok }: { ok: boolean }) {
  return <span className={ok ? 'text-olive' : 'text-fgFaint'}>{ok ? '✓' : '—'}</span>;
}

function StatusPill({ status }: { status: DdlTableAudit['status'] }) {
  const map = {
    complete: ['完整', 'border-olive/40 text-olive'],
    partial: ['部分', 'border-brass/40 text-brass'],
    missing: ['缺失', 'border-rust/40 text-rust'],
  } as const;
  const [label, tone] = map[status];
  return <span className={`rounded border px-1.5 py-0.5 text-2xs ${tone}`}>{label}</span>;
}

function TableAuditPanel({ t }: { t: DdlTableAudit }) {
  const p = t.pieces;
  return (
    <section className="panel px-4 py-4">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 className="text-sm font-medium text-fg">{t.title || t.table}</h2>
        <span className="font-mono text-2xs text-fgMuted">{t.table}</span>
        <StatusPill status={t.status} />
        <span className="text-2xs text-fgFaint">
          {t.okPieces}/{t.totalPieces} 件
        </span>
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
        <PieceLine
          label="可执行脚本"
          ok={p.sql.ok}
          detail={
            p.sql.ok ? `${p.sql.count} 份 · ${p.sql.statements} 条语句` : 'docs/db 下没有包含这张表的脚本'
          }
        />
        <PieceLine
          label="变更日志"
          ok={p.changelog.ok}
          detail={
            p.changelog.ok
              ? `${p.changelog.count} 条 · 最近 ${p.changelog.lastDate || '未标注日期'}`
              : 'CHANGELOG.md 里没有这张表的记录'
          }
        />
        <PieceLine
          label="表结构说明"
          ok={p.tableDoc.ok}
          detail={
            p.tableDoc.ok
              ? `${p.tableDoc.file} · ${p.tableDoc.sectionsFound ?? 0}/10 节` +
                (p.tableDoc.placeholders ? ` · ${p.tableDoc.placeholders} 处待补充` : '')
              : '没有 docs/db/tables/ 下的说明'
          }
        />
        <PieceLine
          label="实体类"
          ok={p.entity.ok}
          detail={
            p.entity.ok
              ? `${p.entity.class} · ${p.entity.fields} 字段` +
                (p.entity.extendsBaseEntity ? ' · 继承 BaseEntity' : ' · 不继承 BaseEntity')
              : '找不到 @TableName 映射'
          }
        />
      </dl>

      {p.sql.files.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {p.sql.files.map((f) => (
            <li key={f} className="font-mono text-2xs text-fgFaint">
              {f}
            </li>
          ))}
        </ul>
      )}

      {t.reconcile.comparable && !t.reconcile.match && (
        <p className="mt-3 rounded border border-brass/40 px-3 py-2 text-xs text-brass">
          表说明列了 {t.reconcile.docBusinessFields} 个业务字段，实体声明了{' '}
          {t.reconcile.entityBusinessFields} 个 —— 四件套里有两件写的不是同一张表。
        </p>
      )}

      {t.issues.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-line pt-3">
          {t.issues.map((it, i) => (
            <li key={i} className="text-xs">
              <span className={`mr-2 ${issueTone(it.level)}`}>{levelLabel(it.level)}</span>
              <span className="text-fgMuted">{it.message}</span>
              {it.field && <code className="ml-2 mono text-2xs text-fgFaint">{it.field}</code>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-olive">四件都在，且能对上。</p>
      )}
    </section>
  );
}

function PieceLine({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex gap-2">
      <span className={ok ? 'text-olive' : 'text-rust'}>{ok ? '✓' : '✕'}</span>
      <div className="min-w-0">
        <div className="text-fg">{label}</div>
        <div className="break-all text-2xs text-fgMuted">{detail}</div>
      </div>
    </div>
  );
}

function PlanDetail({ plan }: { plan: DdlPlan }) {
  const artifacts: [keyof DdlPlan['artifacts'], string][] = [
    ['sql', '可执行脚本'],
    ['changelog', '变更日志行'],
    ['tableDoc', '表结构说明'],
    ['entity', '实体类'],
  ];
  return (
    <div className="panel px-4 py-4">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-sm text-fg">{plan.title}</span>
        <span className="font-mono text-2xs text-fgMuted">{plan.table}</span>
        <span className="rounded border border-line px-1.5 py-0.5 text-2xs text-fgMuted">
          {plan.operation}
        </span>
        <span className="font-mono text-2xs text-fgFaint">{plan.planId}</span>
      </div>

      <p className="mt-2 rounded border border-brass/40 px-3 py-2 text-xs text-brass">
        军火库只生成、不落盘、不执行 SQL。下面四份正文要写进被管理项目；写入并刷新缓存后，审计才会变绿。
      </p>

      <dl className="mt-3 space-y-1 text-2xs">
        {artifacts.map(([key]) => (
          <div key={key} className="flex gap-2">
            <dt className="w-16 shrink-0 text-fgFaint">{key}</dt>
            <dd className="break-all font-mono text-fgMuted">{plan.paths[key]}</dd>
          </div>
        ))}
      </dl>

      {plan.warnings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {plan.warnings.map((w, i) => (
            <li key={i} className="text-xs">
              <span className={`mr-2 ${issueTone(w.level)}`}>{levelLabel(w.level)}</span>
              <span className="text-fgMuted">{w.message}</span>
              {w.field && <code className="ml-2 mono text-2xs text-fgFaint">{w.field}</code>}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 space-y-3">
        {artifacts.map(([key, label]) => {
          const a = plan.artifacts[key];
          return (
            <details key={key} className="rounded border border-line" open={key === 'sql'}>
              <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 px-3 py-2 text-xs">
                <span className="text-fg">{label}</span>
                <span className="rounded border border-line px-1.5 py-0.5 text-2xs text-fgMuted">
                  {actionLabel(a.action)}
                </span>
                <span className="break-all font-mono text-2xs text-fgFaint">{a.path}</span>
                <span className="ml-auto">
                  <CopyButton text={a.content} label="复制" compact />
                </span>
              </summary>
              <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all border-t border-line px-3 py-2 text-2xs leading-relaxed text-fgMuted">
                {a.content}
              </pre>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function actionLabel(action: DdlPlan['artifacts']['sql']['action']): string {
  switch (action) {
    case 'create':
      return '新建';
    case 'update':
      return '并入已有';
    case 'append':
      return '追加一行';
    case 'fragment':
      return '片段（勿当全文）';
    default:
      return '无需改动';
  }
}

function issueTone(level: DdlIssue['level']): string {
  return level === 'error' ? 'text-rust' : level === 'warn' ? 'text-brass' : 'text-fgFaint';
}

function levelLabel(level: DdlIssue['level']): string {
  return level === 'error' ? '必改' : level === 'warn' ? '注意' : '说明';
}

/** 与 DossierConsole 里的同名函数同款：ISO → 本地「MM-DD HH:mm」。 */
function fmtStamp(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
