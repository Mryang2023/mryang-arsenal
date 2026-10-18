'use client';

import { type QaLlmUsage, type QaReport, type QaSemanticVerdict } from '@/lib/arsenal-api';

/**
 * 审查能力与可信度区（质检台 Q2，回答十条意见之 3/4「这话可不可信」）。
 *
 * 语义三态披露 / C1 实锤四档 / 委员会共识·孤证 / LLM 记账 —— 全部从原「面板 B」迁出，
 * 与「问题清单」分离：问题页回答先改谁，这页回答「凭什么信」。0 也说（没跑 ≠ 没问题）。
 */

function VerdictRow({ v }: { v: QaSemanticVerdict }) {
  const tone: Record<string, string> = {
    违规: '#E5484D',
    合规: '#7FA650',
    不适用: '#93A39C',
    '未跑-预算': '#E5A33D',
    '失败-格式': '#E5A33D',
  };
  const c = tone[v.verdict] ?? '#93A39C';
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 text-[10.5px] leading-[16px]">
      <span className="mono text-fg">{v.ruleId}</span>
      <span className="text-fgMuted">{v.title}</span>
      <span className="mono" style={{ color: c }}>
        {v.verdict}
      </span>
      <span className="mono text-fgFaint">
        {v.filesJudged} 文件 · {v.violations} 违规
      </span>
      {v.note && <span className="text-fgFaint">— {v.note}</span>}
    </li>
  );
}

export default function SourceNote({ report }: { report: QaReport }) {
  const status = report.semanticStatus;
  const ran = status === 'ok' || status === 'partial';
  const banner =
    status === 'ok'
      ? { c: '#7FA650', label: '语义深检已执行' }
      : status === 'partial'
        ? { c: '#E5A33D', label: '语义深检部分完成（有规则未判定）' }
        : status === 'failed'
          ? { c: '#E5484D', label: '语义深检执行失败' }
          : { c: '#E5A33D', label: '语义深检未执行' };

  const usage = report.llmUsage as QaLlmUsage | null;
  const verdicts = report.semanticVerdicts;
  const notes = report.semanticNotes ?? [];

  // ── C1：实锤两档（旧报告没有这两个键 → 当「没有实锤数据」，并说清是「这份报告出在实锤功能之前」）──
  const tiers = report.reproTiers;
  const proven = report.provenSemanticFindings ?? [];
  const unconfirmed = report.unconfirmedSemanticFindings ?? [];
  const hasReproData = !!report.reproStatus;

  // ── C4 委员会 ──
  const committee = report.committeeFindings ?? [];
  const sum = report.committeeSummary;
  const cUsage = report.committeeUsage ?? null;
  const names: Record<string, string> = {
    security: '安全',
    performance: '性能',
    concurrency: '并发',
  };

  return (
    <div className="space-y-3">
      <div className="panel px-3 py-2.5">
        <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">语义深检 · 三态披露</p>
        <div
          className="mt-2 rounded border px-2.5 py-2"
          style={{ borderColor: banner.c + '66', background: banner.c + '14' }}
        >
          <p className="text-[11px] font-semibold" style={{ color: banner.c }}>
            {banner.label}（{status}）
          </p>
          <p className="mt-1 text-[10.5px] leading-[16px] text-fgMuted">{report.semanticReason}</p>
        </div>

        {/* ── C1 实锤条 ── */}
        {hasReproData ? (
          <div className="mt-2 rounded border border-line px-2.5 py-2">
            <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
              C1 · 复现实锤（{report.reproStatus}）
            </p>
            <p className="mt-1 text-[10.5px] leading-[16px] text-fgMuted">{report.reproReason}</p>
            {tiers && (
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] leading-[15px]">
                <span style={{ color: tiers.proven > 0 ? '#D9A441' : '#888780' }}>
                  有复现（实锤）{tiers.proven}
                </span>
                <span style={{ color: tiers.notReproduced > 0 ? '#E5484D' : '#888780' }}>
                  复现失败（这条 finding 站不住）{tiers.notReproduced}
                </span>
                <span style={{ color: tiers.invalidTest > 0 ? '#E5A33D' : '#888780' }}>
                  测试无效 {tiers.invalidTest}
                </span>
                <span style={{ color: tiers.notRun > 0 ? '#E5A33D' : '#888780' }}>
                  没跑起来 {tiers.notRun}
                </span>
              </div>
            )}
            <p className="mt-1 text-[10px] leading-[15px] text-fgFaint">
              四档分开是因为下一步不同：「复现失败」该去改规则或撤案，「没跑起来」该去修环境 ——
              合成一句「未实锤」会让人分不清该动哪一个。
            </p>
            {tiers?.stability && (
              <p className="mt-1 text-[10px] leading-[15px] text-fgFaint">
                稳定性（只是标注，<b>不参与分流</b>）：稳定 {tiers.stability.stable} ·
                偶发 {tiers.stability.flaky} · 样本不足 {tiers.stability.insufficientSamples}
                （少于 {tiers.stability.minSamples} 次不给稳定性结论）。
                <b>偶发复现仍然是实锤</b> —— 并发 / 时序类缺陷天生低复现率，
                若因为「不稳定」降级，它们就永远进不了实锤档，也就永远没人修。
              </p>
            )}
            {(report.reproNotes ?? []).length > 0 && (
              <ul className="mt-1 space-y-0.5 text-[10px] leading-[15px] text-fgFaint">
                {report.reproNotes!.map((n, i) => (
                  <li key={`rn-${i}`}>· {n}</li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-[10px] leading-[15px] text-fgFaint">
              实锤分流：{proven.length} 条已实锤 · {unconfirmed.length} 条待确认（明细与实锤证据在「问题」页签语义档）。
            </p>
          </div>
        ) : (
          <p className="mt-2 text-[10px] leading-[15px] text-fgFaint">
            这份报告里没有复现实锤数据 —— 它出在 C1 上线之前。<b>没有实锤不等于没有 bug</b>，
            每条语义 finding 都是「模型说的」，不是「跑出来的」。
          </p>
        )}

        {usage && (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] leading-[15px] text-fgFaint">
            <span className="mono">model {usage.model}</span>
            <span>候选 {usage.candidateFiles} 文件</span>
            <span>批次 {usage.batches}/{usage.maxBatches}</span>
            <span>送出 ~{usage.charsSent} 字</span>
            <span>tokens 入 {usage.promptTokens} / 出 {usage.completionTokens}</span>
            {usage.droppedFindings > 0 && (
              <span style={{ color: '#E5A33D' }}>丢弃 {usage.droppedFindings} 条无行号/对不上的判定</span>
            )}
            {usage.budgetCut && <span style={{ color: '#E5484D' }}>预算熔断：余下规则未判定</span>}
          </div>
        )}

        {notes.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-[10px] leading-[15px] text-fgFaint">
            {notes.map((n, i) => (
              <li key={`note-${i}`}>· {n}</li>
            ))}
          </ul>
        )}
      </div>

      {ran && verdicts.length > 0 && (
        <div className="panel px-3 py-2.5">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            逐规则判定（{verdicts.length} 条）
          </p>
          <ul className="mt-1.5 space-y-1">
            {verdicts.map((v, i) => (
              <VerdictRow key={`${v.ruleId}-${i}`} v={v} />
            ))}
          </ul>
        </div>
      )}

      {/* ── C4 审查员委员会 ── */}
      <div className="panel px-3 py-2.5">
        <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
          C4 · 审查员委员会（共识 {sum?.consensus ?? 0} · 孤证 {sum?.solo ?? 0}）
        </p>

        {sum?.note && <p className="mt-1 text-[10px] leading-[15px] text-fgFaint">{sum.note}</p>}

        {cUsage && (
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] leading-[15px] text-fgFaint">
            <span className="mono">model {cUsage.model}</span>
            <span>批数 {cUsage.batches}/{cUsage.members} 位审查员</span>
            <span>
              tokens 入 {cUsage.promptTokens} / 出 {cUsage.completionTokens}
            </span>
            {cUsage.costNote && (
              <span style={{ color: '#E5A33D' }}>{cUsage.costNote}</span>
            )}
          </div>
        )}

        {cUsage &&
          Object.entries(cUsage.perJudgeer ?? {}).map(([who, v]) => (
            <p key={who} className="text-[10px] leading-[15px] text-fgFaint">
              {names[who] ?? who}审查员：
              {v.ran ? (
                <span style={{ color: '#7FA650' }}>跑过了，报 {v.issues} 条</span>
              ) : (
                <span style={{ color: '#E5A33D' }}>{v.reason ?? '这一路没跑起来'}</span>
              )}
            </p>
          ))}

        {committee.length === 0 ? (
          <p className="mt-2 text-[10.5px] leading-[16px] text-fgFaint">
            本次没有委员会结论。
            {cUsage
              ? '三位审查员跑完了，一个问题都没报 —— 这不等于「代码没问题」，它们只看得到送进来的那几个文件与这一批视角。'
              : '委员会没跑（LLM 未配置 / 语义深检未开启）。'}
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {committee.map((fm, i) => {
              const consensus = fm.signal === 'consensus';
              return (
                <li key={`${fm.file}-${fm.line}-${i}`} className="rounded border border-line px-2 py-1.5">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span
                      className="mono text-[9.5px]"
                      style={{ color: consensus ? '#D9A441' : '#E5A33D' }}
                    >
                      [{consensus ? `共识 ×${fm.voters}` : '孤证'}]
                    </span>
                    <span className="flex-1 text-[11px] text-fg">{fm.title}</span>
                    <span className="mono text-[9.5px] text-fgFaint">
                      {fm.reportedBy.map((r) => names[r] ?? r).join('、')}
                    </span>
                  </div>
                  <p className="mono mt-0.5 text-[10px] text-fgFaint">
                    {fm.file}:{fm.line} — {fm.evidence}
                  </p>
                  {fm.impact && (
                    <p className="mt-0.5 text-[10.5px] leading-[16px] text-fgMuted">{fm.impact}</p>
                  )}
                  <p className="mt-0.5 text-[10px] leading-[15px] text-fgFaint">{fm.signalText}</p>
                </li>
              );
            })}
          </ul>
        )}

        {(report.committeeNotes ?? []).length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-[10px] leading-[15px] text-fgFaint">
            {report.committeeNotes!.map((n, i) => (
              <li key={`cn-${i}`}>· {n}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
