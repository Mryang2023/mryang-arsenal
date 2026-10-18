'use client';

import {
  type AutopsyFinding,
  type QaSemanticFinding,
  type QaRuleSnapshot,
} from '@/lib/arsenal-api';
import SeverityBadge from '@/components/SeverityBadge';
import CopyButton from '@/components/CopyButton';
import type { Severity } from '@/lib/types';

/**
 * 单条 finding 行 + 展开详情（质检台 Q2，2026-10-18）。
 *
 * 展开后六段固定顺序（质检台计划 §6，一条都不许空着——没数据就说「没数据」，不渲染占位空白）：
 *   ① 问题是什么（title + message 判据原话）
 *   ② 在哪（完整相对路径 mono + 复制按钮 + 代码 snippet）
 *   ③ 违反了哪条（ruleId + severity + version + category + 「查看规则完整页」链接）
 *   ④ 依据出处（sources 逐条：ref / type / quote）
 *   ⑤ 不修的后果（impact，标 impactSource——派生自 rationale 的要老实说，不许伪装真 impact）
 *   ⑥ 正例（rule.good 代码块）
 *
 * 数据来源纪律：rule 快照是**检查时点**后端 join 进报告的（v2 契约），前端不现查规则库——
 * 「当时的规则长什么样」以报告自带快照为准；旧 v1 报告缺快照时每段给 fallback 人话。
 */

/** file:// 打开的页面浏览器禁写剪贴板（Q2 验收⑤）：降级成文案，不给一个点了必失败的按钮 */
export function clipboardBlocked(): boolean {
  return typeof window !== 'undefined' && window.location.protocol === 'file:';
}

/** ② 在哪：完整相对路径 + 行号 mono，一键复制；file:// 下显示手动复制文案 */
export function PathCopy({ file, line }: { file: string; line: number }) {
  const loc = `${file}:${line}`;
  if (clipboardBlocked()) {
    return (
      <p className="mono break-all text-[10.5px] text-fg">
        {loc}
        <span className="ml-1.5 text-[9.5px] text-fgFaint">
          （file:// 页面浏览器禁写剪贴板 —— 请手动选中上面这行复制）
        </span>
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mono break-all text-[10.5px] text-fg">{loc}</span>
      <CopyButton text={loc} label="复制路径" compact />
    </div>
  );
}

/** ④ 依据出处：sources 逐条 ref/type/quote。type 是登记表代号，别假装它是人话 */
export function SourceList({ sources }: { sources: QaRuleSnapshot['sources'] }) {
  if (!sources || sources.length === 0) {
    return <p className="text-[10.5px] text-fgFaint">这条规则没有登记出处（按军火库铁律这不该发生——遇到就是规则库的 bug）。</p>;
  }
  return (
    <ul className="space-y-1">
      {sources.map((s, i) => (
        <li key={`src-${i}`} className="text-[10.5px] leading-[16px]">
          <span className="text-fg">{s.ref}</span>{' '}
          <span className="mono text-[9.5px] text-fgFaint">[{s.type}]</span>
          {s.quote && <p className="mt-0.5 border-l border-line pl-2 text-[10px] leading-[15px] text-fgMuted">{s.quote}</p>}
        </li>
      ))}
    </ul>
  );
}

const IMPACT_SOURCE_LABEL: Record<string, string> = {
  'rule-impact': '出自规则库 impact 字段',
  'rule-rationale': '出自规则制定理由（派生，非实测后果）',
  llm: 'LLM 判定原话',
};

/** ⑤ 不修的后果：impact + 来源标注。缺 impact 说缺，不渲染空白也不编一句 */
export function ImpactLine({ finding }: { finding: AutopsyFinding }) {
  if (finding.impact) {
    const label = IMPACT_SOURCE_LABEL[finding.impactSource ?? ''] ?? (finding.impactSource ? `来源：${finding.impactSource}` : '');
    return (
      <div>
        <p className="text-[10.5px] leading-[16px]" style={{ color: '#E5484D' }}>{finding.impact}</p>
        {label && <p className="mt-0.5 text-[9.5px] text-fgFaint">（{label}）</p>}
      </div>
    );
  }
  return (
    <p className="text-[10.5px] leading-[16px] text-fgFaint">
      这条 finding 没带「不修的后果」——它出在规则快照 join 之前，后果请到规则完整页看 rationale。
    </p>
  );
}

/** 六段详情主体。静态档专用（语义档有自己的展开：置信度/实锤/before-after，见下方 SemanticFindingRow） */
function Detail({ v }: { v: AutopsyFinding }) {
  const rule = v.rule;
  return (
    <div className="mt-2 space-y-2 rounded border border-line bg-surface/40 px-2.5 py-2">
      {/* ① 问题是什么 */}
      <section>
        <p className="mono text-[9.5px] uppercase tracking-wider text-fgFaint">① 问题是什么</p>
        <p className="mt-0.5 text-[11px] leading-[17px] text-fg">{v.title}</p>
        <p className="mt-0.5 text-[10.5px] leading-[16px] text-fgMuted">{v.message}</p>
      </section>

      {/* ② 在哪 */}
      <section>
        <p className="mono text-[9.5px] uppercase tracking-wider text-fgFaint">② 在哪</p>
        <div className="mt-0.5">
          <PathCopy file={v.file} line={v.line} />
        </div>
        {v.snippet ? (
          <pre className="mono mt-1 max-h-40 overflow-auto whitespace-pre rounded border border-line px-1.5 py-1 text-[10px] leading-[15px] text-fgMuted">
            {v.snippet}
          </pre>
        ) : (
          <p className="mt-1 text-[10px] text-fgFaint">（无代码片段）</p>
        )}
      </section>

      {/* ③ 违反了哪条 */}
      <section>
        <p className="mono text-[9.5px] uppercase tracking-wider text-fgFaint">③ 违反了哪条</p>
        <p className="mono mt-0.5 text-[10.5px] text-fg">
          {v.ruleId}
          {rule?.version != null && <span className="text-fgFaint"> · 规则版本 v{rule.version}</span>}
          {rule?.subcategory && <span className="text-fgFaint"> · {rule.category}/{rule.subcategory}</span>}
          {!rule && v.category && <span className="text-fgFaint"> · {v.category}</span>}
        </p>
        <a
          href={`/rules/${encodeURIComponent(v.ruleId)}`}
          target="_blank"
          rel="noreferrer"
          className="mono mt-0.5 inline-block text-[10.5px] text-brass underline decoration-dotted"
        >
          查看规则完整页 →
        </a>
      </section>

      {/* ④ 依据出处 */}
      <section>
        <p className="mono text-[9.5px] uppercase tracking-wider text-fgFaint">④ 依据出处</p>
        <div className="mt-0.5">
          {rule ? (
            <SourceList sources={rule.sources} />
          ) : (
            <p className="text-[10.5px] leading-[16px] text-fgFaint">
              这份报告没带规则快照（出在 v2 契约之前）—— 出处请到上方「查看规则完整页」看现行版本。
            </p>
          )}
        </div>
      </section>

      {/* ⑤ 不修的后果 */}
      <section>
        <p className="mono text-[9.5px] uppercase tracking-wider text-fgFaint">⑤ 不修的后果</p>
        <div className="mt-0.5">
          <ImpactLine finding={v} />
        </div>
      </section>

      {/* ⑥ 正例 */}
      <section>
        <p className="mono text-[9.5px] uppercase tracking-wider text-fgFaint">⑥ 正例（规则库自带）</p>
        {rule?.good ? (
          <pre className="mono mt-0.5 max-h-48 overflow-auto whitespace-pre rounded border px-1.5 py-1 text-[10px] leading-[15px]" style={{ borderColor: 'rgba(127,166,80,0.35)' }}>
            {rule.good}
          </pre>
        ) : (
          <p className="mt-0.5 text-[10.5px] text-fgFaint">
            {rule ? '这条规则没附正例（军火库铁律：写不出 good 的不收录——遇到就是规则库漏网）。' : '（无规则快照，正例看规则完整页）'}
          </p>
        )}
      </section>
    </div>
  );
}

export default function FindingRow({ v, open, toggle }: { v: AutopsyFinding; open: boolean; toggle: () => void }) {
  return (
    <li className="rounded border border-line px-2.5 py-2">
      <button type="button" onClick={toggle} className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 text-left">
        <SeverityBadge severity={v.severity as Severity} size="sm" />
        <span className="text-[11px] text-fg">{v.title}</span>
        <span className="mono ml-auto text-[9.5px] text-fgMuted">{open ? '收起详情' : '展开详情（六段）'}</span>
      </button>
      <p className="mono mt-0.5 break-all text-[10px] text-fgFaint">
        {v.ruleId} · {v.evidence}
      </p>
      {open && <Detail v={v} />}
    </li>
  );
}

/**
 * 语义 finding 行（从 QaLab 原样迁入 + impactSource=llm 徽标）。
 * 展开区是语义档自己的三件套（实锤证据 / before-after 对照），
 * 不套静态六段 —— 语义档的 impact 就是 LLM 原话，出处=模型，两套详情不硬并成一套。
 */
export function SemanticFindingRow({
  f,
  proven,
  open,
  toggle,
}: {
  f: QaSemanticFinding;
  proven: boolean;
  open: boolean;
  toggle: () => void;
}) {
  const conf = f.confidence;
  const confColor = conf >= 0.8 ? '#E5484D' : conf >= 0.6 ? '#E5A33D' : '#93A39C';
  const r = f.repro;
  return (
    <li className="rounded border border-line px-2.5 py-2">
      <button type="button" onClick={toggle} className="flex w-full flex-wrap items-baseline gap-2 text-left">
        <SeverityBadge severity={f.severity as Severity} size="sm" />
        <span className="flex-1 text-[11px] text-fg">{f.ruleTitle}</span>
        {proven ? (
          <span className="mono text-[9.5px]" style={{ color: '#D9A441' }}>
            实锤{r?.redCount != null && r.attempts ? ` ${r.redCount}/${r.attempts}` : ''}
          </span>
        ) : (
          <span className="mono text-[9.5px] text-fgFaint">待确认</span>
        )}
        <span className="mono text-[9.5px]" style={{ color: confColor }}>
          置信 {Math.round(conf * 100)}%
        </span>
        <span className="mono text-[9.5px] text-fgFaint">LLM</span>
        <span className="mono text-[10px] text-fgMuted">{open ? '收起对照' : '展开对照'}</span>
      </button>
      <p className="mono mt-0.5 break-all text-[10px] text-fgFaint">
        <a
          href={`/rules/${encodeURIComponent(f.ruleId)}`}
          target="_blank"
          rel="noreferrer"
          className="text-brass underline decoration-dotted"
        >
          {f.ruleId}
        </a>
        {' · '}
        {f.file}:{f.line} — {f.evidence}
      </p>
      {f.impact && (
        <p className="mt-0.5 text-[10.5px] leading-[16px]" style={{ color: '#E5484D' }}>
          {f.impact}
          <span className="ml-1 text-[9.5px] text-fgFaint">（LLM 判定原话）</span>
        </p>
      )}

      {/* ── C1 实锤证据：不折叠，因为它就是这条 finding 的可信度本身 ── */}
      {r && (
        <div className="mt-1.5 rounded border border-line px-2 py-1.5">
          <p className="text-[10.5px] leading-[15px] text-fgMuted">
            <span style={{ color: r.verdict === 'reproduced' ? '#D9A441' : '#888780' }}>
              [{r.tierText}]
            </span>
            {r.rate != null && r.attempts ? `　复现率 ${r.rate.toFixed(2)}（${r.redCount ?? 0}/${r.attempts}）` : ''}
          </p>
          <p className="mt-0.5 text-[10px] leading-[15px] text-fgFaint">{r.reason}</p>
          {r.stability && r.verdict === 'reproduced' && (
            <p className="mt-0.5 text-[10px] leading-[15px] text-fgFaint">
              稳定性：
              <span
                style={{
                  color:
                    r.stability === 'stable'
                      ? '#D9A441'
                      : r.stability === 'flaky'
                        ? '#E5A33D'
                        : '#888780',
                }}
              >
                {r.stabilityText}
              </span>
              {r.stability === 'flaky' && (
                <span className="text-fgFaint">（仍算实锤，只是你没法靠它天天拦）</span>
              )}
            </p>
          )}
          {r.failureExcerpt && (
            <pre className="mono mt-1 max-h-32 overflow-auto rounded border border-line px-1.5 py-1 text-[9.5px] leading-[14px] text-fgMuted">
              {r.failureExcerpt}
            </pre>
          )}
          {r.compileError && (
            <p className="mono mt-1 text-[9.5px] leading-[14px]" style={{ color: '#E5A33D' }}>
              编译未过：{r.compileError}
            </p>
          )}
          {r.verdict === 'reproduced' && r.testSource && open && (
            <>
              <p className="mono mt-1 text-[9.5px] uppercase text-fgFaint">
                实锤用的复现测试（{r.testClass}）
              </p>
              <pre className="mono mt-0.5 max-h-48 overflow-auto rounded border border-line px-1.5 py-1 text-[9.5px] leading-[14px] text-fgMuted">
                {r.testSource}
              </pre>
            </>
          )}
        </div>
      )}

      {open && (
        <div className="mt-1.5 grid gap-1.5 md:grid-cols-2">
          <div>
            <p className="mono text-[9.5px] uppercase text-fgFaint">before（现状）</p>
            <pre className="mono mt-0.5 max-h-40 overflow-auto rounded border px-1.5 py-1 text-[10px]" style={{ borderColor: 'rgba(229,72,77,0.35)' }}>
              {f.recommendation?.before || '（无）'}
            </pre>
          </div>
          <div>
            <p className="mono text-[9.5px] uppercase text-fgFaint">after（建议改法）</p>
            <pre className="mono mt-0.5 max-h-40 overflow-auto rounded border px-1.5 py-1 text-[10px]" style={{ borderColor: 'rgba(127,166,80,0.35)' }}>
              {f.recommendation?.after || '（无）'}
            </pre>
          </div>
          {f.recommendation?.rationale && (
            <p className="text-[10.5px] leading-[16px] text-fgMuted md:col-span-2">{f.recommendation.rationale}</p>
          )}
        </div>
      )}
    </li>
  );
}

/** 从平铺静态 findings 建 `ruleId|file|line → finding` 查找表：聚合视图单条回退平铺详情用（同源，不算第二套真相） */
export function findingKey(ruleId: string, file: string, line: number): string {
  return `${ruleId}|${file}|${line}`;
}

export function buildFindingIndex(flat: AutopsyFinding[]): Map<string, AutopsyFinding> {
  const m = new Map<string, AutopsyFinding>();
  for (const v of flat) m.set(findingKey(v.ruleId, v.file, v.line), v);
  return m;
}
