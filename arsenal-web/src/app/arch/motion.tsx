'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ARCH_GLYPHS } from '@/lib/arch-glyphs';

/**
 * 页面层动效原语。
 *
 * 与 arch-motion.ts 的分工：那边产的是**嵌进 SVG 内部**的 CSS（导出的 .svg
 * 单独打开也要动）；这里是 React 组件层的动效，用 globals.css 里的 ui-* 关键帧。
 *
 * 三条规矩：
 *   ① 动画不承载信息 —— 关掉全部动画，页面上的每个数字和每条连线都还在；
 *   ② 数字滚动只滚"从真实数据算出来的数"，绝不为了好看编一个数；
 *   ③ 骨架屏不是装饰：技术架构图真要读 localStorage + 重算画布，那 200ms 是真的在干活。
 */

// ── 入场 ──────────────────────────────────────────────────

/** 依次浮现。`i` 是档位，同排元素递增即可形成左→右的节奏 */
export function Reveal({
  i = 0,
  children,
  className = '',
  as: Tag = 'div',
}: {
  i?: number;
  children: ReactNode;
  className?: string;
  as?: 'div' | 'li' | 'span' | 'section';
}) {
  return (
    <Tag className={`ui-rise ${className}`} style={{ '--i': i } as CSSProperties}>
      {children}
    </Tag>
  );
}

// ── 数字滚动 ──────────────────────────────────────────────

type Part = { num: boolean; text: string; value?: number; decimals?: number };

/** 把 "62 条 · 9 类" 拆成 [数][字][数][字]，非数字部分原样保留（含空格与中文） */
function splitNums(s: string): Part[] {
  const out: Part[] = [];
  const re = /(\d+(?:\.\d+)?)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ num: false, text: s.slice(last, m.index) });
    const raw = m[1];
    const dot = raw.indexOf('.');
    out.push({
      num: true,
      text: raw,
      value: Number(raw),
      decimals: dot < 0 ? 0 : raw.length - dot - 1,
    });
    last = m.index + raw.length;
  }
  if (last < s.length) out.push({ num: false, text: s.slice(last) });
  return out;
}

function prefersReduced(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * 数字从 0 滚到目标值。字符串里的非数字部分（"条 · "）保持不动，
 * 所以 "62 条 · 9 类" 会整体滚起来，而不是只滚一个数字。
 */
export function CountUp({ text, duration = 680, className = '' }: { text: string; duration?: number; className?: string }) {
  const parts = useMemo(() => splitNums(text), [text]);
  const [p, setP] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    if (prefersReduced()) {
      setP(1);
      return;
    }
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / duration);
      // easeOutCubic：开头快、结尾稳，读数在最后 200ms 就基本定住，不晃眼
      setP(1 - (1 - k) ** 3);
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [text, duration]);

  return (
    <span className={`mono tabular-nums ${className}`}>
      {parts.map((pa, i) =>
        pa.num ? (
          <span key={i}>{(pa.value! * p).toFixed(pa.decimals ?? 0)}</span>
        ) : (
          <span key={i}>{pa.text}</span>
        )
      )}
    </span>
  );
}

// ── 骨架屏 ────────────────────────────────────────────────

/**
 * 图还没算出来时的占位。形状刻意做成「架构图的样子」——
 * 一排标题条 + 三排卡片 + 底部横条，这样加载完的位移最小，不跳版。
 */
export function GraphSkeleton({ accent = '#D9A441', bars = 3 }: { accent?: string; bars?: number }) {
  return (
    <div className="ui-fade" aria-hidden>
      <div className="mb-3 flex items-center gap-2">
        <div className="ui-shimmer h-3 w-24 rounded" />
        <div className="ui-shimmer h-3 w-16 rounded" />
      </div>
      <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${bars}, minmax(0,1fr))` }}>
        {Array.from({ length: bars }, (_, i) => (
          <div key={i} className="rounded-lg border border-line p-3">
            <div className="mb-2 flex items-center gap-2">
              <div className="ui-shimmer h-6 w-6 rounded-md" style={{ background: `${accent}22` }} />
              <div className="ui-shimmer h-2.5 w-16 rounded" />
            </div>
            <div className="ui-shimmer mb-1.5 h-2 w-full rounded" />
            <div className="ui-shimmer h-2 w-3/5 rounded" />
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <div className="ui-shimmer h-8 flex-1 rounded-md" />
        <div className="ui-shimmer h-8 flex-1 rounded-md" />
        <div className="ui-shimmer h-8 flex-1 rounded-md" />
      </div>
      <p className="mt-3 text-center text-[10px] text-fgFaint">正在按真实数据排布…</p>
    </div>
  );
}

/** 切换阶段时的短暂加载态。key 一变就重新走一次 */
export function useStageLoad(key: string, ms = 190): boolean {
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    const t = setTimeout(() => setLoading(false), ms);
    return () => clearTimeout(t);
  }, [key, ms]);
  return loading;
}

// ── 图标徽章 ──────────────────────────────────────────────

/**
 * 把 arch-glyphs 的手绘 SVG 渲染成 React 元素。
 * 内容是本仓库的常量字符串，不是用户输入，所以用 dangerouslySetInnerHTML 是安全的；
 * 这也是唯一能让「一套 SVG 字符串同时喂给 React 和导出文件」的做法。
 */
export function Glyph({
  name,
  size = 15,
  color = 'currentColor',
  className = '',
  style,
}: {
  name: string;
  size?: number;
  color?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const body = ARCH_GLYPHS[name] ?? ARCH_GLYPHS.spark;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={{ color, flexShrink: 0, ...style }}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: body }}
    />
  );
}
