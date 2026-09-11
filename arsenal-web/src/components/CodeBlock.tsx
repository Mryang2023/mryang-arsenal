'use client';

import { highlight, normalizeLang, type HighlightLang } from '@/lib/highlight';
import CopyButton from './CopyButton';

interface Props {
  code: string;
  lang?: string;
  tone?: 'bad' | 'good' | 'neutral';
  label?: string;
  showCopy?: boolean;
}

const TONE = {
  bad: { color: '#E5484D', glyph: '✕', fallback: '错误写法' },
  good: { color: '#46A758', glyph: '✓', fallback: '正确写法' },
  neutral: { color: '#5E6E67', glyph: '›', fallback: '示例' },
} as const;

export default function CodeBlock({ code, lang, tone = 'neutral', label, showCopy = true }: Props) {
  const t = TONE[tone];
  const hl: HighlightLang = normalizeLang(lang);
  const html = highlight(code ?? '', hl);

  return (
    <div
      className="overflow-hidden rounded-md border bg-[#0E1312]"
      style={{ borderColor: tone === 'neutral' ? '#243029' : t.color + '3D' }}
    >
      <div
        className="flex items-center justify-between gap-3 border-b px-3 py-1.5"
        style={{ borderColor: '#1E2624', background: 'rgba(255,255,255,0.015)' }}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="mono text-[11px] leading-none" style={{ color: t.color }}>
            {t.glyph}
          </span>
          <span
            className="truncate text-2xs font-medium"
            style={{ color: tone === 'neutral' ? '#93A39C' : t.color }}
          >
            {label ?? t.fallback}
          </span>
          {lang && lang !== 'text' && (
            <span className="mono shrink-0 rounded border border-line px-1 text-[10px] uppercase text-fgFaint">
              {lang}
            </span>
          )}
        </span>
        {showCopy && <CopyButton text={code ?? ''} compact />}
      </div>
      <pre className="mono overflow-x-auto px-3 py-2.5 text-[12.5px] leading-[1.62] text-fg">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}
