'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  text: string;
  label?: string;
  compact?: boolean;
  className?: string;
}

/**
 * 复制按钮。优先用 clipboard API；非安全上下文（内网 http）自动降级到
 * execCommand，保证「一键复制」在任何部署环境下都真的能用。
 */
export default function CopyButton({ text, label = '复制', compact = false, className = '' }: Props) {
  const [state, setState] = useState<'idle' | 'done' | 'fail'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = useCallback(async () => {
    let ok = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }

    if (!ok) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-9999px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        ok = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }

    setState(ok ? 'done' : 'fail');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1800);
  }, [text]);

  const color = state === 'done' ? '#56C596' : state === 'fail' ? '#E5484D' : '#93A39C';
  const border = state === 'done' ? 'rgba(86,197,150,0.5)' : state === 'fail' ? 'rgba(229,72,77,0.5)' : '#243029';

  return (
    <button
      type="button"
      onClick={copy}
      title={state === 'fail' ? '复制失败，请手动选中' : `复制${label}`}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded border transition-colors hover:bg-surfaceHi ${compact ? 'px-2 py-1 text-2xs' : 'px-2.5 py-1.5 text-xs'} ${className}`}
      style={{ color, borderColor: border, background: 'rgba(255,255,255,0.02)' }}
    >
      <span aria-hidden className="text-[1.05em] leading-none">
        {state === 'done' ? '✓' : state === 'fail' ? '!' : '⎘'}
      </span>
      <span>{state === 'done' ? '已复制' : state === 'fail' ? '失败' : label}</span>
    </button>
  );
}
