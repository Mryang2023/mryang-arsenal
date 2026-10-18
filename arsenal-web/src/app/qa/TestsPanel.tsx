'use client';

import { type QaReport, type QaTestSuggestion } from '@/lib/arsenal-api';

type TestItem = QaReport['testSuggestions'][number];

function isNote(x: TestItem): x is { note: string } {
  return !('target' in x) && typeof (x as { note?: unknown }).note === 'string';
}

function DraftCases({ cases }: { cases?: QaTestSuggestion['draftCases'] }) {
  if (!cases) {
    return (
      <p className="mt-0.5 text-[10px] text-fgFaint">
        复现用例：这份报告没有这一段（出在 C1 之前）。
      </p>
    );
  }
  const color =
    cases.status === 'proven' ? '#D9A441' : cases.status === 'not-run' ? '#888780' : '#E5A33D';
  return (
    <div className="mt-1 rounded border border-line px-2 py-1.5">
      <p className="text-[10px] leading-[15px]" style={{ color }}>
        [{cases.status}] {cases.reason}
      </p>
      {cases.cases.map((c, i) => (
        <div key={`${c.testClass}-${i}`} className="mt-1">
          <p className="mono text-[9.5px] text-fgFaint">
            {c.testClass}
            {c.rate != null ? `　复现率 ${c.rate.toFixed(2)}` : ''}
          </p>
          <pre className="mono mt-0.5 max-h-40 overflow-auto rounded border border-line px-1.5 py-1 text-[9.5px] leading-[14px] text-fgMuted">
            {c.source}
          </pre>
        </div>
      ))}
    </div>
  );
}

/** 「怎么验」面板（质检台 Q2 更名：测试建议是交付物，不是又一类问题） */
export default function TestsPanel({ items }: { items: QaReport['testSuggestions'] }) {
  return (
    <div className="panel px-3 py-2.5">
      <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
        怎么验 · 该补测试的核心路径（清单来自离线启发式；C1 起附可运行的复现用例）
      </p>
      {items.length === 0 ? (
        <p className="mt-2 text-[10.5px] text-fgFaint">本次没有给出测试建议。</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((x, i) =>
            isNote(x) ? (
              <li key={`note-${i}`} className="text-[10.5px]" style={{ color: '#E5A33D' }}>
                {x.note}
              </li>
            ) : (
              <li key={x.target} className="text-[10.5px] leading-[16px]">
                <span className="mono break-all text-fg">{x.target}</span>
                {typeof x.findings === 'number' && x.findings > 0 && (
                  <span className="mono ml-1.5 text-fgFaint">命中 {x.findings}</span>
                )}
                <p className="text-fgMuted">{x.reason}</p>
                {/* C1：draftCases 以前恒为 null（后端 putNull 占位），页面什么都不显示，
                    读起来像「用例已经有了只是没展示」。现在三档各有一句人话。 */}
                <DraftCases cases={x.draftCases} />
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}
