'use client';

import { useMemo } from 'react';
import { formatBytes } from '@/lib/project';
import { INK, TONE, toneAt } from './palette';

/**
 * ⑩ 交付的**右栏概览**：这一趟到底要拿走什么。
 *
 * 双包面板回答「点哪个按钮」，这份概览回答「点下去会拿到什么」——
 * 文件数、体积、按类别分布、顶层长什么样。**全部从 plan.files 现算**，
 * 不写一句「包含后端与前端」这种会过期的话。
 *
 * 为什么按「类别」而不是按目录排：类别（构建 / 配置 / 代码 / 运维 / 文档）是
 * 用户心里的分类 —— 「我要的配置类在哪」能直接找到；目录是给构建工具看的，
 * 用它回答人的问题会多绕一层。
 */
export default function ProductOutline({
  files,
  bytes,
}: {
  files: { path: string; group?: string; content: string }[];
  bytes: number;
}) {
  const byGroup = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of files) {
      const g = f.group ?? '其它';
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [files]);

  const topDirs = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of files) {
      if (!f.path.includes('/')) continue;
      const top = `${f.path.split('/')[0]}/`;
      m.set(top, (m.get(top) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [files]);

  const max = byGroup.reduce((n, r) => Math.max(n, r[1]), 1);

  return (
    <section className="panel overflow-hidden" data-product-outline="">
      <header className="border-b border-line px-4 py-2.5">
        <div className="flex items-baseline gap-x-2.5">
          <span className="mono text-[12px] leading-none text-brass">⎗</span>
          <h3 className="text-[12px] font-semibold leading-[18px] text-fg">这一趟拿走什么</h3>
          <span className="mono ml-auto text-[10px] leading-[15px] text-fgFaint">
            {files.length} 文件 · {formatBytes(bytes)}
          </span>
        </div>
        <p className="mt-1 text-[10px] leading-[15px] text-fgFaint">
          数字跟着选型实时变 —— 换一个选项，这里立刻重算。
        </p>
      </header>

      <div className="border-b border-line px-4 py-2.5">
        <p className="text-[10px] leading-[15px] text-fgFaint">按类别</p>
        <ul className="mt-1.5 space-y-1" data-product-outline-groups="">
          {byGroup.map(([g, n]) => (
            <li key={g} className="flex items-center gap-2">
              <span className="w-[62px] shrink-0 text-[10px] leading-[15px] text-fgMuted">{g}</span>
              <span className="min-w-0 flex-1">
                <span
                  className="block h-[6px] rounded-sm"
                  style={{
                    width: `${Math.round((n / max) * 100)}%`,
                    background: toneAt('warn', 0.45),
                  }}
                />
              </span>
              <span className="mono w-[24px] shrink-0 text-right text-[10px] text-fgFaint">{n}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="px-4 py-2.5">
        <p className="text-[10px] leading-[15px] text-fgFaint">顶层长这样</p>
        <ul className="mono mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] leading-[15px]">
          {topDirs.map(([d, n]) => (
            <li key={d} style={{ color: TONE.warn.color }}>
              {d}
              <span style={{ color: INK.muted }}> {n}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
