'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { highlight, normalizeLang, splitHighlightedLines } from '@/lib/highlight';
import { locateAnchor } from '@/lib/cookbook';
import { layerTheme } from '@/lib/theme';
import CopyButton from './CopyButton';

export interface NoteItem {
  mark: string;
  title: string;
  text: string;
  rule?: string;
}

interface Props {
  code: string;
  lang?: string;
  layer?: string;
  path?: string;
  role?: string;
  notes?: NoteItem[];
  showLineNumbers?: boolean;
}

/**
 * 带备注的代码块。
 *
 * 这是「把 Spring Boot 项目剖析并打上备注」这句话的落地：
 *   左侧是带行号的完整代码，有备注的行会在行号旁挂一个编号角标；
 *   右侧（窄屏下移到下方）是编号对应的解读。
 *
 * 备注用「片段锚点」而非行号定位 —— 见 lib/cookbook.ts 的 locateAnchor。
 * 锚点找不到目标时（理论上同步阶段已被拦下）这里会静默降级为不标记，
 * 而不是猜一个位置把角标挂错行上：错位的备注比没有备注更危险。
 */
export default function CodeWithNotes({
  code,
  lang,
  layer,
  path,
  role,
  notes = [],
  showLineNumbers = true,
}: Props) {
  const [active, setActive] = useState<number | null>(null);

  const { lines, notesByLine, anchorMissed } = useMemo(() => {
    const html = highlight(code ?? '', normalizeLang(lang));
    const ls = splitHighlightedLines(html);

    const byLine = new Map<number, number[]>();
    let missed = 0;
    notes.forEach((n, idx) => {
      const a = locateAnchor(code, n.mark);
      if (!a) {
        missed += 1;
        return;
      }
      const list = byLine.get(a.line) ?? [];
      list.push(idx);
      byLine.set(a.line, list);
    });

    return { lines: ls, notesByLine: byLine, anchorMissed: missed };
  }, [code, lang, notes]);

  const lt = layerTheme(layer ?? 'config');

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_310px]">
      {/* ── 代码 ─────────────────────────────────────── */}
      <div className="min-w-0 overflow-hidden rounded-lg border border-line bg-[#0E1312]">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <span className="mono text-[11px]" style={{ color: lt.color }}>
            {lt.glyph}
          </span>
          {layer && (
            <span
              className="shrink-0 rounded px-1.5 py-0.5 text-2xs font-medium"
              style={{ color: lt.color, background: lt.color + '1A' }}
            >
              {lt.label}
            </span>
          )}
          <span className="mono min-w-0 flex-1 truncate text-2xs text-fgMuted">
            {path ?? 'code'}
          </span>
          <span className="mono shrink-0 text-[10px] uppercase text-fgFaint">{lang}</span>
          <CopyButton text={code ?? ''} compact />
        </div>

        {role && (
          <p className="border-b border-line bg-[rgba(255,255,255,0.014)] px-3 py-2 text-2xs leading-relaxed text-fgMuted">
            {role}
          </p>
        )}

        <div className="max-h-[620px] overflow-auto">
          <table className="w-full border-collapse">
            <tbody>
              {lines.map((lineHtml, i) => {
                const lineNo = i + 1;
                const marks = notesByLine.get(lineNo);
                const isActive =
                  active !== null && marks !== undefined && marks.includes(active);
                return (
                  <tr
                    key={lineNo}
                    style={{
                      background: isActive ? 'rgba(217,164,65,0.10)' : 'transparent',
                      boxShadow: isActive ? 'inset 2px 0 0 #D9A441' : 'none',
                    }}
                  >
                    {showLineNumbers && (
                      <td className="mono w-[46px] shrink-0 select-none border-r border-line px-2 text-right align-top text-[11px] leading-[1.72] text-fgFaint">
                        {lineNo}
                      </td>
                    )}
                    <td className="w-[34px] shrink-0 align-top">
                      <div className="flex flex-col items-center gap-0.5 pt-[3px]">
                        {marks?.map((idx) => (
                          <button
                            key={idx}
                            type="button"
                            onMouseEnter={() => setActive(idx)}
                            onMouseLeave={() => setActive(null)}
                            onClick={() => setActive(idx)}
                            title={notes[idx].title}
                            className="mono flex h-[15px] w-[15px] items-center justify-center rounded-full text-[9px] leading-none transition-colors"
                            style={{
                              background:
                                active === idx ? '#D9A441' : 'rgba(217,164,65,0.16)',
                              color: active === idx ? '#0B0F0E' : '#D9A441',
                            }}
                          >
                            {idx + 1}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="w-full">
                      <pre className="mono whitespace-pre px-1 py-[1px] text-[12.5px] leading-[1.72] text-fg">
                        <code
                          dangerouslySetInnerHTML={{ __html: lineHtml || ' ' }}
                        />
                      </pre>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── 备注 ─────────────────────────────────────── */}
      <aside className="min-w-0">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-2xs font-medium text-fgMuted">要点解读</span>
          <span className="mono text-2xs text-fgFaint">{notes.length} 条</span>
        </div>

        {notes.length === 0 ? (
          <p className="rounded-md border border-line bg-surface px-3 py-3 text-2xs leading-relaxed text-fgFaint">
            这个文件没有额外要点 —— 代码本身已经说明了全部。
          </p>
        ) : (
          <ol className="space-y-2">
            {notes.map((n, idx) => (
              <li
                key={idx}
                onMouseEnter={() => setActive(idx)}
                onMouseLeave={() => setActive(null)}
                className="rounded-md border px-3 py-2.5 transition-colors"
                style={{
                  borderColor: active === idx ? 'rgba(217,164,65,0.45)' : '#243029',
                  background: active === idx ? 'rgba(217,164,65,0.06)' : '#131917',
                }}
              >
                <div className="flex items-start gap-2">
                  <span
                    className="mono mt-[1px] flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full text-[9px] leading-none"
                    style={{
                      background: active === idx ? '#D9A441' : 'rgba(217,164,65,0.16)',
                      color: active === idx ? '#0B0F0E' : '#D9A441',
                    }}
                  >
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-medium leading-snug text-fg">{n.title}</p>
                    <p className="mt-1 text-2xs leading-relaxed text-fgMuted">{n.text}</p>
                    {n.rule && (
                      <Link
                        href={`/rules/${n.rule}`}
                        className="mono mt-1.5 inline-flex items-center gap-1 text-[10px] transition-colors hover:opacity-80"
                        style={{ color: '#D9A441' }}
                      >
                        <span>◈</span>
                        {n.rule}
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}

        {anchorMissed > 0 && (
          <p className="mt-3 rounded-md border border-[#E5484D] px-3 py-2 text-2xs leading-relaxed" style={{ borderColor: 'rgba(229,72,77,0.4)', color: '#E5484D' }}>
            ⚠ 有 {anchorMissed} 条要点的锚点在代码里找不到目标，已跳过行内标记。
            这是数据问题，不是渲染问题 —— 应修正 arsenal-cookbook 里对应的 mark。
          </p>
        )}
      </aside>
    </div>
  );
}
