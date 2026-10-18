'use client';

import { useState } from 'react';
import { type QaReport, type RulesReloadResult, rulesReload } from '@/lib/arsenal-api';

/**
 * 审查边界卡 + 规则库账（质检台 Q2，回答十条意见之 2「到底是不是全面检查」与 9「明天用新规则」）。
 *
 * 上半：查了什么（范围/覆盖/截断）与没查什么（review 圈外 / focus 折叠 / 不可判定）——0 也说，不渲染空白。
 * 下半：ruleset stamp（检查时点的规则库账）。filesNewestMtime > loadedAt ⇒ 黄条「已变更未重载」
 * + 一键 reload（回包前后计数直接展示——「重载了但其实没重读」靠这组数字现形）。
 * 旧 v1 报告没有 ruleset → 一句 fallback，不渲染成 0 或空白（fallback 纪律）。
 */
export default function BoundaryCard({ report }: { report: QaReport }) {
  const f = report.staticFindings;
  const cov = report.coverage;
  const tr = report.targetRange;
  const ruleset = report.ruleset;

  // reload 是页面动作不是状态机：结果 / 失败都就地展示，不弹窗不跳页
  const [reload, setReload] = useState<{ state: 'idle' | 'busy' | 'ok' | 'fail'; msg?: string; data?: RulesReloadResult }>({ state: 'idle' });

  const stale =
    !!ruleset &&
    !!ruleset.filesNewestMtime &&
    !!ruleset.loadedAt &&
    ruleset.filesNewestMtime > ruleset.loadedAt;

  const doReload = async () => {
    setReload({ state: 'busy' });
    const out = await rulesReload();
    if (out.kind === 'ok') setReload({ state: 'ok', data: out.data });
    else setReload({ state: 'fail', msg: out.message });
  };

  return (
    <div className="panel px-3 py-2.5">
      {/* ── 范围横幅：本次到底看了多大一块，写死在报告头部 ── */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px]">
        <span className="mono text-fg">{report.projectRef.rootName}</span>
        <span className="text-fgMuted">
          本次范围：
          {tr.mode === 'full'
            ? `整仓 ${tr.filesTotal} 个文件`
            : `${tr.filesMatched}/${tr.filesTotal} 个文件（占全仓 ${tr.pctOfRepo}%）· ${tr.mode === 'review' ? '严格局部' : '全量聚焦'}`}
        </span>
        <span className="text-fgFaint">{report.elapsedMs} ms · {report.scannedAt}</span>
        {report.scope.truncated && (
          <span style={{ color: '#E5A33D' }}>已达上限被截断，结论不完整</span>
        )}
      </div>
      {tr.mode === 'review' && (
        <p className="mt-1 text-[10.5px] leading-[16px]" style={{ color: '#E5A33D' }}>
          review 模式：圈外 {(cov.scopeFilteredOut ?? (tr.filesTotal - tr.filesMatched))} 个文件未读未检 ——
          这份报告对它们没有任何结论，「没报」不等于「没问题」。
        </p>
      )}
      {tr.mode === 'focus' && f.outOfScopeSummary && (
        <p className="mt-1 text-[10.5px] leading-[16px] text-fgMuted">
          focus 模式：整仓都扫过了，圈外另有{' '}
          <span className="mono" style={{ color: '#E5484D' }}>P0 {f.outOfScopeSummary.p0}</span> ·{' '}
          <span className="mono" style={{ color: '#E5A33D' }}>P1 {f.outOfScopeSummary.p1}</span> ·{' '}
          <span className="mono">MAY {f.outOfScopeSummary.other}</span>（折叠只给计数，明细见留档 JSON）。
        </p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-fgFaint">
        <span>
          覆盖 {cov.executed}/{cov.total} 条规则，{cov.notRun} 条本次没结论（未覆盖 ≠ 通过）
        </span>
        {cov.scopeFilteredOut > 0 && <span>引擎侧按范围过滤 {cov.scopeFilteredOut} 文件</span>}
        {!cov.decidable && <span style={{ color: '#E5484D' }}>本次判定为「不可判定」，条数只作参考</span>}
      </div>

      {/* ── 规则库账：检查时点的 stamp + 已变更未重载黄条（意见 9 落地处） ── */}
      <div className="mt-2 border-t border-line pt-2">
        {ruleset ? (
          <>
            <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">规则库账（检查时点）</p>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] leading-[16px] text-fgMuted">
              <span className="mono">v{ruleset.version}</span>
              <span>{ruleset.ruleCount} 条（生效 {ruleset.activeCount}）</span>
              <span>语义层候选 {ruleset.llmLayerRules} 条</span>
              <span className="mono text-[10px] text-fgFaint">加载于 {ruleset.loadedAt}</span>
            </p>
            {stale && (
              <div className="mt-1.5 rounded border px-2.5 py-2" style={{ borderColor: 'rgba(229,163,61,0.5)', background: 'rgba(229,163,61,0.08)' }}>
                <p className="text-[10.5px] font-semibold" style={{ color: '#E5A33D' }}>
                  规则库文件已变更但未重载 —— 这份报告用的是旧规则（改于 {ruleset.filesNewestMtime}，晚于加载时间）
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void doReload()}
                    disabled={reload.state === 'busy'}
                    className="rounded border px-2.5 py-1 text-[10.5px] font-semibold transition-colors disabled:opacity-45"
                    style={{ borderColor: 'rgba(217,164,65,0.5)', background: 'rgba(217,164,65,0.12)', color: '#D9A441' }}
                  >
                    {reload.state === 'busy' ? '重载中…' : '重载规则库（POST /api/rules/reload）'}
                  </button>
                  <span className="text-[10px] text-fgFaint">重载只影响之后的审查；本报告保持出报告那一刻的快照，不被改写。</span>
                </div>
                {reload.state === 'ok' && reload.data && (
                  <p className="mono mt-1 text-[10px]" style={{ color: '#7FA650' }}>
                    已重载：{reload.data.before} → {reload.data.after} 条 · 版本 {reload.data.versionBefore} → {reload.data.versionAfter}
                    {reload.data.before === reload.data.after && reload.data.versionBefore === reload.data.versionAfter && '（计数与版本都没变——规则库文件内容可能只是触了 mtime）'}
                  </p>
                )}
                {reload.state === 'fail' && (
                  <p className="mono mt-1 text-[10px]" style={{ color: '#E5484D' }}>
                    重载失败（旧规则集已保留）：{reload.msg}
                  </p>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="text-[10.5px] leading-[16px] text-fgFaint">
            这份报告没带规则库账（ruleset stamp）—— 它出在 v2 契约之前，看不出当时用的哪一版规则。
            重跑一轮即可带上。
          </p>
        )}
      </div>
    </div>
  );
}
