'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-java';

/**
 * 带语法高亮的代码编辑器。
 *
 * 做法：一个透明的 <textarea> 浮在一个被 Prism 高亮的 <pre> 之上，
 * 两者字体 / 字号 / 行高 / padding / 空白处理完全一致，滚动同步，
 * 用户看到的是底层的高亮文字，实际输入落在上层 textarea。
 * 这样既能像普通 textarea 一样编辑，又有彩色高亮，且不引入 CodeMirror 这类重依赖。
 */

// 两层必须逐像素对齐的样式。集中在这里，避免两处漂移导致光标错位。
const SHARED_STYLE: React.CSSProperties = {
  margin: 0,
  padding: '12px',
  border: 'none',
  boxSizing: 'border-box',
  fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, ui-monospace, monospace",
  fontSize: '12.5px',
  lineHeight: 1.6,
  whiteSpace: 'pre',
  tabSize: 4,
  MozTabSize: 4,
  overflow: 'auto',
  letterSpacing: 'normal',
  wordBreak: 'normal',
};

export default function CodeEditor({
  value,
  onChange,
  className = '',
  readOnly = false,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  readOnly?: boolean;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  // 高亮只在客户端做：SSR 与首帧客户端都先用纯文本渲染，挂载后再切换成高亮版，
  // 避免服务端（无 Prism 产物）与客户端 hydration 时 className / 内容对不上而报警告。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const html = useMemo(() => {
    if (!mounted) return escapeHtml(value);
    const grammar = Prism.languages.java;
    if (!grammar) return escapeHtml(value);
    // Prism.highlight 把代码切成带 <span class="token-*"> 的 HTML，安全可注入。
    const out = Prism.highlight(value, grammar, 'java');
    // 末尾换行：让最后一行保持高度，和 textarea 对齐。
    return value.endsWith('\n') ? out + '\n' : out;
  }, [value, mounted]);

  function syncScroll() {
    const ta = taRef.current;
    const pre = preRef.current;
    if (ta && pre) {
      pre.scrollTop = ta.scrollTop;
      pre.scrollLeft = ta.scrollLeft;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (readOnly) return;
    // Tab 插入两个空格，而不是把焦点跳走——写代码时的直觉行为。
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = value.slice(0, start) + '  ' + value.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  }

  return (
    <div className={`code-editor relative ${className}`}>
      <pre
        ref={preRef}
        aria-hidden
        suppressHydrationWarning
        className="mono pointer-events-none absolute inset-0"
        style={SHARED_STYLE}
      >
        {mounted ? (
          <code className="language-java" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          // SSR / 首帧：用普通文本子节点，避免 dangerouslySetInnerHTML 触发 hydration 比对
          <code className="language-java">{value}</code>
        )}
      </pre>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        readOnly={readOnly}
        className="mono absolute inset-0 resize-none bg-transparent outline-hidden"
        style={{
          ...SHARED_STYLE,
          color: 'transparent',
          caretColor: '#E8F0EC',
          ...(readOnly ? {} : { cursor: 'text' }),
        }}
      />
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
