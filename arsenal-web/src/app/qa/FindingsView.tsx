'use client';

import { useMemo, useState } from 'react';
import {
  type AutopsyFinding,
  type QaReport,
  type QaRuleGroup,
  type QaRuleSnapshot,
} from '@/lib/arsenal-api';
import FindingRow, { SemanticFindingRow, buildFindingIndex } from './FindingRow';
import RuleGroupCard from './RuleGroupCard';

/**
 * 问题区 · 两个正交视图（质检台 Q2，质检台计划 §3.2）：
 *   按严重度 —— 回答「先改谁」（P0 必修 / P1 该改 / MAY 可选 + 语义档单列）
 *   按规则   —— 回答「怎么改省事」（同规则违反 N 处一次列全，数据 = 后端 groupedByRule）
 *
 * P0 验收②（写死）：两视图数字必须一致 —— crossCheck() 逐规则逐档比对平铺与聚合，
 * 结果上墙：一致亮绿一行，不一致亮红并列明细。这个函数不是调试工具，是页面的一部分：
 * 「数字打架」如果只是测试里的事，用户看到的还是打架的页面。
 */

export type ViewMode = 'severity' | 'rule';

export interface CrossCheckResult {
  flatStatic: number;
  flatSemantic: number;
  groupStatic: number | null;
  groupSemantic: number | null;
  mismatches: string[];
  noData: boolean; // groupedByRule 缺失 = v1 报告，对账无数据（这不是「一致」，也不是「不一致」）
}

const TIERS: ['p0' | 'p1' | 'other', string, string][] = [
  ['p0', 'P0 必修', '#E5484D'],
  ['p1', 'P1 该改', '#E5A33D'],
  ['other', 'MAY 可选', '#93A39C'],
];

export function crossCheck(report: QaReport): CrossCheckResult {
  const f = report.staticFindings;
  const flatStatic = TIERS.reduce((n, [t]) => n + (f[t]?.length ?? 0), 0);
  const flatSemantic = report.semanticFindings.length;
  const groups = report.groupedByRule;
  if (!groups) {
    return { flatStatic, flatSemantic, groupStatic: null, groupSemantic: null, mismatches: [], noData: true };
  }
  const flatCount = new Map<string, number>();
  for (const [t] of TIERS) {
    for (const v of f[t] ?? []) {
      const k = `${v.ruleId}|${t}`;
      flatCount.set(k, (flatCount.get(k) ?? 0) + 1);
    }
  }
  const semCount = new Map<string, number>();
  for (const s of report.semanticFindings) {
    semCount.set(s.ruleId, (semCount.get(s.ruleId) ?? 0) + 1);
  }
  let groupStatic = 0;
  let groupSemantic = 0;
  const mismatches: string[] = [];
  for (const g of groups) {
    if (g.tier === 'static') {
      groupStatic += g.count;
      const byTier: Record<'p0' | 'p1' | 'other', number> = { p0: 0, p1: 0, other: 0 };
      for (const it of g.items) if (it.tier) byTier[it.tier]++;
      for (const [t] of TIERS) {
        const flatN = flatCount.get(`${g.ruleId}|${t}`) ?? 0;
        if (byTier[t] !== flatN) mismatches.push(`${g.ruleId} · ${t} 档：聚合 ${byTier[t]} ≠ 平铺 ${flatN}`);
      }
    } else {
      groupSemantic += g.count;
      const flatN = semCount.get(g.ruleId) ?? 0;
      if (g.count !== flatN) mismatches.push(`${g.ruleId} · 语义：聚合 ${g.count} ≠ 平铺 ${flatN}`);
    }
  }
  if (groupStatic !== flatStatic) mismatches.push(`静态总数：聚合 ${groupStatic} ≠ 平铺 ${flatStatic}`);
  if (groupSemantic !== flatSemantic) mismatches.push(`语义总数：聚合 ${groupSemantic} ≠ 平铺 ${flatSemantic}`);
  return { flatStatic, flatSemantic, groupStatic, groupSemantic, mismatches, noData: false };
}

function ViewSwitch({ mode, setMode, check }: { mode: ViewMode; setMode: (m: ViewMode) => void; check: CrossCheckResult }) {
  const reconcile =
    check.noData
      ? { ok: null, text: '两视图对账：这份报告没带聚合数据（出在 v2 契约之前），无账可对' }
      : check.mismatches.length === 0
        ? {
            ok: true,
            text: `两视图对账一致：平铺 静态 ${check.flatStatic} + 语义 ${check.flatSemantic} = 聚合 静态 ${check.groupStatic} + 语义 ${check.groupSemantic}`,
          }
        : { ok: false, text: `两视图对账不一致（${check.mismatches.length} 处）—— 这是 bug，请把本报告留档 JSON 交回` };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 self-start rounded border border-line p-0.5">
        {(
          [
            ['severity', '按严重度（先改谁）'],
            ['rule', '按规则（怎么改省事）'],
          ] as [ViewMode, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMode(id)}
            className={
              'rounded px-2.5 py-1 text-[11px] transition-colors ' +
              (mode === id ? 'bg-surfaceHi text-brass' : 'text-fgMuted hover:text-fg')
            }
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-[10px] leading-[15px]" style={{ color: reconcile.ok === false ? '#E5484D' : reconcile.ok === true ? '#7FA650' : '#888780' }}>
        {reconcile.text}
      </p>
      {reconcile.ok === false && (
        <ul className="w-full space-y-0.5">
          {check.mismatches.map((m, i) => (
            <li key={`mm-${i}`} className="mono text-[10px]" style={{ color: '#E5484D' }}>
              {m}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SeverityView({ report }: { report: QaReport }) {
  const f = report.staticFindings;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const sems = report.semanticFindings;
  const provenSet = useMemo(() => new Set((report.provenSemanticFindings ?? []).map((x) => `${x.ruleId}|${x.file}|${x.line}`)), [report]);
  return (
    <div className="space-y-3">
      {TIERS.map(([key, label, color]) => {
        const items = f[key] ?? [];
        return (
          <div key={key} className="panel px-3 py-2.5">
            <p className="text-[11px] font-semibold" style={{ color }}>
              {label} · {items.length} 条
            </p>
            {items.length === 0 ? (
              <p className="mt-1 text-[10.5px] text-fgFaint">
                0 条 —— 这是「跑过的规则里没有命中」，不是「合规」（覆盖 {report.coverage.executed}/{report.coverage.total}）。
              </p>
            ) : (
              <ul className="mt-1.5 space-y-1.5">
                {items.slice(0, 60).map((v, i) => (
                  <FindingRow
                    key={`${key}-${v.ruleId}-${v.file}-${v.line}-${i}`}
                    v={v}
                    open={!!open[`${key}-${i}`]}
                    toggle={() => setOpen((s) => ({ ...s, [`${key}-${i}`]: !s[`${key}-${i}`] }))}
                  />
                ))}
                {items.length > 60 && (
                  <li className="text-[10px] text-fgFaint">
                    另有 {items.length - 60} 条未展开，明细在报告 JSON（单档上限 200）
                  </li>
                )}
              </ul>
            )}
          </div>
        );
      })}

      {/* 语义档单列：永不进 P0（既定纪律），severity 徽标照带、「语义」徽标区分判据来源 */}
      <div className="panel px-3 py-2.5">
        <p className="text-[11px] font-semibold" style={{ color: '#B085D6' }}>
          语义档（LLM 判定）· {sems.length} 条
        </p>
        {sems.length === 0 ? (
          <p className="mt-1 text-[10.5px] text-fgFaint">
            {report.semanticStatus === 'ok' || report.semanticStatus === 'partial'
              ? '语义层跑过了，没有给出带行号的发现 —— 「跑过且没报」不等于「合规」。'
              : '语义层没有跑（未配 key / 未勾选 / 执行失败）—— 见「可信度」页签的三态披露。'}
          </p>
        ) : (
          <ul className="mt-1.5 space-y-1.5">
            {sems.map((x, i) => (
              <SemanticFindingRow
                key={`${x.ruleId}-${x.file}-${x.line}-${i}`}
                f={x}
                proven={provenSet.has(`${x.ruleId}|${x.file}|${x.line}`)}
                open={!!open[`sem-${i}`]}
                toggle={() => setOpen((s) => ({ ...s, [`sem-${i}`]: !s[`sem-${i}`] }))}
              />
            ))}
          </ul>
        )}
        <p className="mt-1.5 text-[10px] leading-[15px] text-fgFaint">
          实锤标注与置信度明细在「可信度」页签 —— 这页只管「先改谁」，可信度是另一件事。
        </p>
      </div>
    </div>
  );
}

function RuleView({ report }: { report: QaReport }) {
  const groups = report.groupedByRule;
  const flat = useMemo(
    () => [...(report.staticFindings.p0 ?? []), ...(report.staticFindings.p1 ?? []), ...(report.staticFindings.other ?? [])],
    [report]
  );
  const ruleLookup = useMemo(() => {
    const m = new Map<string, QaRuleSnapshot>();
    for (const v of flat) if (v.rule && !m.has(v.ruleId)) m.set(v.ruleId, v.rule);
    return m;
  }, [flat]);
  const flatIndex = useMemo(() => buildFindingIndex(flat), [flat]);

  if (!groups) {
    return (
      <div className="panel px-3 py-2.5 text-[10.5px] leading-[16px] text-fgFaint">
        这份报告没带「按规则」聚合数据 —— 它出在 v2 契约之前（聚合是后端算的，v1 只存了平铺清单）。
        平铺清单看「按严重度」视图；要看聚合，重跑一轮审查即可。
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <div className="panel px-3 py-2.5 text-[10.5px] leading-[16px] text-fgFaint">
        0 组 —— 跑过的规则里没有命中（覆盖 {report.coverage.executed}/{report.coverage.total}）。
        聚合视图为空 ≠ 合规：没跑的规则在上方覆盖率里，不在这一页。
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {groups.map((g: QaRuleGroup) => (
        <RuleGroupCard key={`${g.tier}-${g.ruleId}`} group={g} ruleLookup={ruleLookup} flatIndex={flatIndex} />
      ))}
    </ul>
  );
}

export default function FindingsView({ report }: { report: QaReport }) {
  const [mode, setMode] = useState<ViewMode>('severity');
  const check = useMemo(() => crossCheck(report), [report]);
  return (
    <div className="space-y-2.5">
      <ViewSwitch mode={mode} setMode={setMode} check={check} />
      {mode === 'severity' ? <SeverityView report={report} /> : <RuleView report={report} />}
    </div>
  );
}
