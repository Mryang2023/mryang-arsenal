'use client';

import { useMemo, useState } from 'react';
import type { AutopsyFinding, AutopsyReport } from '@/lib/arsenal-api';

/**
 * 体检报告面板。
 *
 * 三档 + 覆盖率。两条刻意的分工（别在页面里重写任何一条）：
 *   ① **结论怎么来的** —— 后端 `POST /api/autopsy/inspect`，P0/P1 复用同一套规则集
 *      （与 /api/lint 同一台引擎），观察项由 `arsenal-checkups/checkups.json` 驱动；
 *      前端一条都不重算（重算就有两份实现，早晚各说各的）。
 *   ② **覆盖率是结论的一部分，不是脚注** —— 只报「P0: 12 条」的页面，
 *      读者分不清「这条没命中」与「这条压根没检查」。
 *
 * ⚠️ 本页每一处「N 条」都必须带分母（2026-10-04 的教训：漏了前缀导致
 *    页面显示「34 条章程条款没跑」而章程只有 2 条）。**0 的情况也要说**，
 *    而且「0 条」本身是一句结论，不是「没有要说的」。
 */

const TIER_STYLE: Record<string, { color: string; bg: string; border: string; label: string; hint: string }> = {
  p0: {
    color: '#E5484D',
    bg: 'rgba(229,72,77,0.08)',
    border: 'rgba(229,72,77,0.4)',
    label: 'P0 必修',
    hint: 'MUST + NEVER：阻断级，违反必修',
  },
  p1: {
    color: '#E5A33D',
    bg: 'rgba(229,163,61,0.08)',
    border: 'rgba(229,163,61,0.4)',
    label: 'P1 该改',
    hint: 'SHOULD：不计分但列出来',
  },
  other: {
    color: '#93A39C',
    bg: 'rgba(255,255,255,0.04)',
    border: 'rgba(255,255,255,0.12)',
    label: 'MAY 可选',
    hint: '不判负，但不许静默丢弃 —— 丢了的违规没人知道它存在过',
  },
  obs: {
    color: '#7FA650',
    bg: 'rgba(127,166,80,0.08)',
    border: 'rgba(127,166,80,0.4)',
    label: '观察项',
    hint: '不是规则命中，是从扫描事实推出来的提醒 —— 不评分、不判负',
  },
};

export default function CheckupPanel({ report }: { report: AutopsyReport }) {
  const [openSkipped, setOpenSkipped] = useState(false);
  const [openTier, setOpenTier] = useState<Record<string, boolean>>({ p0: true, p1: true, obs: true, other: false });

  const cov = report.coverage;
  const notRun = cov.notRun;
  const obs = report.obs;

  const byFile = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of [...report.p0, ...report.p1, ...report.other]) {
      m.set(v.file, (m.get(v.file) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [report]);

  return (
    <div className="space-y-3">
      {/* ── 覆盖率：永远显示，0 也显示 ── */}
      <div className="rounded border px-3 py-2.5" style={{ borderColor: 'var(--line)', background: 'rgba(255,255,255,0.03)' }}>
        <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">这次体检覆盖到哪</p>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-[15px] font-bold text-fg">
            覆盖 {cov.executed}/{cov.total} 条规则
          </span>
          <span className="text-[11px]" style={{ color: notRun > 0 ? '#E5A33D' : '#7FA650' }}>
            {notRun > 0 ? `${notRun} 条本次没结论` : '全部有结论'}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded" style={{ background: 'rgba(255,255,255,0.08)' }}>
          <div
            className="h-full rounded"
            style={{
              width: `${cov.total > 0 ? Math.round((cov.executed / cov.total) * 100) : 0}%`,
              background: '#D9A441',
            }}
          />
        </div>
        {cov.total === 0 && (
          <p className="mt-1.5 text-[10.5px] leading-[16px]" style={{ color: '#E5484D' }}>
            规则池是 0 —— 后端没加载起规则集。这时下面的「0 条」是「一条都没查」，不是「一条都没违规」。
          </p>
        )}
        <p className="mt-1.5 text-[10.5px] leading-[16px] text-fgMuted">
          未覆盖 ≠ 通过。没跑的 {notRun} 条既不是通过也不是违规 —— 它们没有结论。
          {!cov.decidable && (
            <span style={{ color: '#E5484D' }}>
              {' '}
              本次判定为「不可判定」（有文件解析失败），下面的条数只作参考，不作合规结论。
            </span>
          )}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-fgFaint">
          <span>
            规则池 {cov.tierPool.p0}（P0）/ {cov.tierPool.p1}（P1）/ {cov.tierPool.other}（MAY）
          </span>
          <span>
            严重度 MUST {cov.severityPool.MUST ?? 0} · NEVER {cov.severityPool.NEVER ?? 0} · SHOULD{' '}
            {cov.severityPool.SHOULD ?? 0} · MAY {cov.severityPool.MAY ?? 0}
          </span>
          <span>
            扫了 {report.scope.files} 个文件 / {(report.scope.bytes / 1024).toFixed(0)} KB，
            {cov.batches} 批 · {report.elapsedMs} ms
          </span>
          {report.scope.truncated && (
            <span style={{ color: '#E5A33D' }}>
              已达文件上限 {report.scope.maxFiles}，更后面的文件没扫 —— 结论不完整
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setOpenSkipped((v) => !v)}
          className="mt-2 rounded border border-line px-2 py-0.5 text-[10.5px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
        >
          {openSkipped ? '收起' : '展开'}未覆盖明细（{cov.skippedCount} 条）
        </button>
        {openSkipped && (
          <div className="mt-1.5 max-h-52 overflow-y-auto">
            {cov.skippedCount === 0 ? (
              <p className="text-[10.5px] text-fgFaint">
                没有未覆盖项 —— 规则池里的每一条都跑过了
              </p>
            ) : (
              <ul className="space-y-1 text-[10px] leading-[15px]">
                {cov.skipped.map((s) => (
                  <li key={s.ruleId} className="mono">
                    <span className="text-fg">{s.ruleId}</span>{' '}
                    <span className="text-fgMuted">{s.title}</span>{' '}
                    <span className="text-fgFaint">[{s.layer}] {s.reason}</span>
                  </li>
                ))}
              </ul>
            )}
            {cov.parseFailures.length > 0 && (
              <p className="mt-1.5 text-[10.5px]" style={{ color: '#E5A33D' }}>
                另有 {cov.parseFailures.length} 条「没跑成」记录（解析失败 / 无编译器），
                首条：{cov.parseFailures[0].file || '（报告级）'} — {cov.parseFailures[0].message}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── 三档 ── */}
      <Tier
        id="p0"
        items={report.p0}
        open={openTier.p0}
        onToggle={() => setOpenTier((s) => ({ ...s, p0: !s.p0 }))}
        pool={cov.tierPool.p0}
      />
      <Tier
        id="p1"
        items={report.p1}
        open={openTier.p1}
        onToggle={() => setOpenTier((s) => ({ ...s, p1: !s.p1 }))}
        pool={cov.tierPool.p1}
      />
      <Tier
        id="other"
        items={report.other}
        open={openTier.other}
        onToggle={() => setOpenTier((s) => ({ ...s, other: !s.other }))}
        pool={cov.tierPool.other}
      />

      {/* ── 观察项 ── */}
      <div className="rounded border px-3 py-2.5" style={{ borderColor: TIER_STYLE.obs.border, background: TIER_STYLE.obs.bg }}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[11px] font-semibold" style={{ color: TIER_STYLE.obs.color }}>
            观察项 {obs.firedCount}/{obs.ruleCount} 条
          </p>
          <span className="text-[10px] text-fgFaint">{TIER_STYLE.obs.hint}</span>
        </div>

        {!obs.available ? (
          <p className="mt-1.5 text-[10.5px] leading-[16px]" style={{ color: '#E5A33D' }}>
            观察项事实源不可用 —— {obs.reason ?? '（后端没给出原因）'}。
            <span className="text-fgMuted">
              {' '}
              这一档是空的，原因是「没配 / 读不到」，不是「这个项目一条观察项都没有」。
            </span>
          </p>
        ) : obs.ruleCount === 0 ? (
          <p className="mt-1.5 text-[10.5px] leading-[16px]" style={{ color: '#E5A33D' }}>
            观察项事实源里一条规则都没有 —— 空的规则表会让这一档整档消失，
            而「没有要提示的」与「一条都没配」在这页面上长得一模一样。
          </p>
        ) : obs.firedCount === 0 ? (
          <p className="mt-1.5 text-[10.5px] leading-[16px] text-fgMuted">
            配了 {obs.ruleCount} 条观察项，本次一条都没触发。
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {obs.items.map((o) => (
              <li key={o.id} className="text-[10.5px] leading-[16px]">
                <span className="mono text-fg">{o.id}</span>{' '}
                <span className="text-fg">{o.text}</span>
                <div className="mt-0.5 text-[10px] text-fgMuted">→ {o.advice}</div>
                <div className="mono mt-0.5 text-[10px] text-fgFaint">
                  证据 {o.evidence.length > 0 ? o.evidence.join(' · ') : '（无文件证据 —— 这是「没找到」不是「没查」）'}
                </div>
              </li>
            ))}
          </ul>
        )}

        {obs.unevaluatedCount > 0 && (
          <div className="mt-2 rounded border px-2 py-1.5" style={{ borderColor: 'rgba(229,163,61,0.4)', background: 'rgba(229,163,61,0.06)' }}>
            <p className="text-[10.5px]" style={{ color: '#E5A33D' }}>
              另有 {obs.unevaluatedCount} 条观察项算不出来（事实里取不到可比的值）——
              它们没有结论，不等于没问题：
            </p>
            <ul className="mt-1 space-y-0.5 text-[10px] text-fgMuted">
              {obs.unevaluated.map((u) => (
                <li key={u.id} className="mono">
                  {u.id}（{u.fact} {u.op}）— {u.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ── 命中集中在哪几个文件 ── */}
      {byFile.length > 0 && (
        <div className="rounded border px-3 py-2.5" style={{ borderColor: 'var(--line)' }}>
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">命中集中在哪</p>
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px]">
            {byFile.map(([file, n]) => (
              <span key={file} className="mono text-fgMuted">
                <span className="text-fg">{file}</span> × {n}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Tier({
  id,
  items,
  open,
  onToggle,
  pool,
}: {
  id: 'p0' | 'p1' | 'other';
  items: AutopsyFinding[];
  open: boolean;
  onToggle: () => void;
  pool: number;
}) {
  const s = TIER_STYLE[id];
  return (
    <div className="rounded border px-3 py-2.5" style={{ borderColor: s.border, background: s.bg }}>
      <button type="button" onClick={onToggle} className="flex w-full flex-wrap items-baseline justify-between gap-2 text-left">
        <span className="text-[11px] font-semibold" style={{ color: s.color }}>
          {s.label} {items.length} 条
          <span className="ml-1.5 text-[10px] font-normal text-fgFaint">（这一档共 {pool} 条规则）</span>
        </span>
        <span className="text-[10px] text-fgFaint">
          {s.hint} · {open ? '收起' : '展开'}
        </span>
      </button>

      {open && (
        <div className="mt-1.5">
          {items.length === 0 ? (
            <p className="text-[10.5px] leading-[16px]" style={{ color: '#7FA650' }}>
              这一档 0 条 —— 在已覆盖的规则里没有命中。
              <span className="text-fgMuted">
                {' '}
                但仍有未覆盖的规则没有结论（见上面的覆盖率），所以这不是「合规」的结论。
              </span>
            </p>
          ) : (
            <ul className="max-h-80 space-y-1.5 overflow-y-auto">
              {items.map((v, i) => (
                <li key={`${v.ruleId}-${v.file}-${v.line}-${i}`} className="text-[10.5px] leading-[16px]">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="mono text-fg">{v.ruleId}</span>
                    <span className="text-fgMuted">{v.title}</span>
                    <span className="mono text-[10px] text-fgFaint">{v.severity}</span>
                  </div>
                  <div className="mono mt-0.5 text-[10px]" style={{ color: s.color }}>
                    {v.evidence}
                  </div>
                  {v.snippet && (
                    <div className="mono mt-0.5 truncate text-[10px] text-fgFaint" title={v.snippet}>
                      {v.snippet}
                    </div>
                  )}
                  {v.collapsed > 0 && (
                    <div className="text-[10px] text-fgFaint">同文件同规则另有 {v.collapsed} 处被折叠</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
