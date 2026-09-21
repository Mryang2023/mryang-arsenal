'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { liveStats, meta } from '@/lib/rules';
import { cookbookStats } from '@/lib/cookbook';
import { dimensions } from '@/lib/stack';

const NAV = [
  { href: '/', label: '概览', glyph: '◈', count: 0 },
  { href: '/rules', label: '规则库', glyph: '▦', count: liveStats.total },
  { href: '/blueprints', label: '最佳实践案例库', glyph: '▤', count: cookbookStats.features },
  { href: '/stack', label: '装配台', glyph: '⬡', count: dimensions.length },
  { href: '/arch', label: '架构图谱', glyph: '▣', count: 6 },
  { href: '/archify', label: '出图服务', glyph: '⚒', count: 0 },
  { href: '/check', label: '校验台', glyph: '⛨', count: 0 },
  { href: '/export', label: '导出中心', glyph: '⎘', count: 0 },
];

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  const used = Math.min(100, liveStats.budgetUsedPct);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col md:flex-row">
      {/* ── 侧边栏 ───────────────────────────────────────── */}
      <aside className="shrink-0 border-line md:w-[212px] md:border-r">
        <div className="flex items-center justify-between px-5 py-4 md:sticky md:top-0 md:block md:py-6">
          <Link href="/" className="group flex items-center gap-3">
            <span
              className="flex h-9 w-9 items-center justify-center rounded border text-base"
              style={{
                borderColor: 'rgba(217,164,65,0.35)',
                background: 'rgba(217,164,65,0.08)',
                color: '#D9A441',
              }}
            >
              ◈
            </span>
            <span className="leading-tight">
              <span className="block text-[13px] font-semibold tracking-wide text-fg">
                杨先生的军火库
              </span>
              <span className="mono block text-2xs uppercase tracking-[0.18em] text-fgFaint">
                arsenal v{meta.version}
              </span>
            </span>
          </Link>

          <nav className="flex items-center gap-1 md:hidden">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="rounded px-2 py-1 text-xs transition-colors"
                style={{
                  color: isActive(n.href) ? '#D9A441' : '#93A39C',
                  background: isActive(n.href) ? 'rgba(217,164,65,0.1)' : 'transparent',
                }}
              >
                {n.label}
              </Link>
            ))}
          </nav>
        </div>

        {/* 桌面导航 */}
        <nav className="hidden px-3 md:sticky md:top-[88px] md:block">
          {NAV.map((n) => {
            const active = isActive(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className="mb-0.5 flex items-center gap-3 rounded-md px-3 py-2.5 text-[13px] transition-colors"
                style={{
                  background: active ? 'rgba(217,164,65,0.09)' : 'transparent',
                  color: active ? '#E8F0EC' : '#93A39C',
                  borderLeft: `2px solid ${active ? '#D9A441' : 'transparent'}`,
                }}
              >
                <span
                  className="w-4 text-center text-sm"
                  style={{ color: active ? '#D9A441' : '#5E6E67' }}
                >
                  {n.glyph}
                </span>
                <span className="flex-1 font-medium">{n.label}</span>
                <span className="mono text-2xs text-fgFaint">
                  {n.href === '/rules' ? liveStats.total : ''}
                </span>
              </Link>
            );
          })}

          {/* 配额 */}
          <div className="mt-6 rounded-md border border-line bg-surface px-3 py-3">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-2xs text-fgMuted">强制级配额</span>
              <span className="mono text-2xs text-fg">
                {liveStats.mustClass}
                <span className="text-fgFaint">/{liveStats.mustHardLimit}</span>
              </span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-surfaceMax">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${used}%`,
                  background: used >= 100 ? '#E5484D' : '#D9A441',
                }}
              />
            </div>
            <p className="mt-2 text-2xs leading-relaxed text-fgFaint">
              {used >= 100 ? '已满额，新增强制条目须先降级一条旧条目。' : `已用 ${used}%。`}
            </p>
          </div>

          <div className="mt-4 px-3 pb-6 text-2xs leading-relaxed text-fgFaint">
            <div className="flex justify-between py-1">
              <span>规则总数</span>
              <span className="mono text-fgMuted">{liveStats.total}</span>
            </div>
            <div className="flex justify-between py-1">
              <span>可自动检出</span>
              <span className="mono text-fgMuted">{liveStats.regexCapable}</span>
            </div>
            <div className="flex justify-between py-1">
              <span>案例 / 代码行</span>
              <span className="mono text-fgMuted">
                {cookbookStats.features} / {cookbookStats.lines}
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span>选型维度</span>
              <span className="mono text-fgMuted">{dimensions.length}</span>
            </div>
          </div>
        </nav>
      </aside>

      {/* ── 主内容 ───────────────────────────────────────── */}
      <main className="min-w-0 flex-1 border-line md:border-l">
        <div className="px-5 py-6 md:px-10 md:py-9">{children}</div>
        <footer className="border-t border-line px-5 py-6 text-2xs text-fgFaint md:px-10">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span>
              数据源 <span className="mono text-fgMuted">arsenal-rules/**/*.json</span>
            </span>
            <span className="text-lineHi">|</span>
            <span>
              适用 {meta.targetStack.language} · {meta.targetStack.framework} ·{' '}
              {meta.targetStack.database}
            </span>
            <span className="text-lineHi">|</span>
            <span className="mono">{meta.ruleset}</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
