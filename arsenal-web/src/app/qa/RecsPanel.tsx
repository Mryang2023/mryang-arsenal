'use client';

import { useState } from 'react';
import { type QaReport } from '@/lib/arsenal-api';
import SeverityBadge from '@/components/SeverityBadge';
import type { Severity } from '@/lib/types';

type RecItem = QaReport['recommendations'][number];

/** 面板 C 的条目也是「真方案 + 溢出说明行」的混合：静态档命中组数超上限（120）时，
 * 后端只追加一条 `{ note: "另有 N 组…" }`，它没有 id/severity。必须先用这个判别式
 * 分流，否则整块丢给 SeverityBadge → SEVERITY_THEME[undefined].color → 白屏。 */
function isRecNote(x: RecItem): x is { note: string } {
  return !('id' in x) && typeof (x as { note?: unknown }).note === 'string';
}

/** 「怎么改」面板（质检台 Q2 更名：优化方案是交付物，不是又一类问题） */
export default function RecsPanel({ items }: { items: QaReport['recommendations'] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = items.reduce((n, x) => n + (isRecNote(x) ? 0 : 1), 0);
  return (
    <div className="panel px-3 py-2.5">
      <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
        怎么改 · 逐点优化方案（{groups} 组，来源全部标注）
      </p>
      {groups === 0 && (
        <p className="mt-2 text-[10.5px] text-fgFaint">没有可给的方案 —— 静态档是空的（先看「问题」页的覆盖率是否如预期）。</p>
      )}
      <ul className="mt-2 space-y-2">
        {items.map((r, i) =>
          isRecNote(r) ? (
            <li key={`note-${i}`} className="text-[10.5px]" style={{ color: '#E5A33D' }}>
              {r.note}
            </li>
          ) : (
            <li key={r.id} className="rounded border border-line px-2.5 py-2">
              <button
                type="button"
                onClick={() => setOpen((s) => ({ ...s, [r.id]: !s[r.id] }))}
                className="flex w-full flex-wrap items-baseline gap-2 text-left"
              >
                <SeverityBadge severity={r.severity as Severity} size="sm" />
                <span className="flex-1 text-[11px] text-fg">{r.title}</span>
                <span className="mono text-[9.5px] text-fgFaint">{r.source}</span>
                <span className="mono text-[10px] text-fgMuted">{open[r.id] ? '收起' : '展开对照'}</span>
              </button>
              {open[r.id] && (
                <div className="mt-1.5 grid gap-1.5 md:grid-cols-2">
                  <div>
                    <p className="mono text-[9.5px] uppercase text-fgFaint">before（现状 {r.file}:{r.line}）</p>
                    <pre className="mono mt-0.5 max-h-40 overflow-auto rounded border px-1.5 py-1 text-[10px]" style={{ borderColor: 'rgba(229,72,77,0.35)' }}>
                      {r.before || '（无片段）'}
                    </pre>
                  </div>
                  <div>
                    <p className="mono text-[9.5px] uppercase text-fgFaint">after（规则自带正例）</p>
                    <pre className="mono mt-0.5 max-h-40 overflow-auto rounded border px-1.5 py-1 text-[10px]" style={{ borderColor: 'rgba(127,166,80,0.35)' }}>
                      {r.after || r.afterNote || '（无）'}
                    </pre>
                  </div>
                  <p className="text-[10.5px] leading-[16px] text-fgMuted md:col-span-2">{r.rationale}</p>
                </div>
              )}
            </li>
          )
        )}
      </ul>
    </div>
  );
}
