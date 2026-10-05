'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { liveStats, meta } from '@/lib/rules';
import { cookbookStats } from '@/lib/cookbook';
import { casesStats } from '@/lib/case-cases';
import { dimensions } from '@/lib/stack';
import { iconStats } from '@/lib/icon-assets';
import { isNavActive } from '@/lib/nav-active';
import { charterTotals } from '@/lib/charter';
import { STACK_NAV, STEP_ROUTES } from '@/app/stack/wizard';
import { currentStep, subscribeStep } from '@/app/stack/step-bus';

/**
 * 侧边栏。
 *
 * P0（2026-09-29）：装配台从 `/stack` 单页拆成四页，导航里对应变成一个
 * 「装配台」分组 —— 四项各自的 href 就是四条真实路由，没有 href 的那一项
 * 是纯分组标题（不渲染成链接）。父路由的高亮判定改按精确匹配，
 * 判据仍在 `lib/nav-active.ts` 一处。
 *
 * 拆细（2026-10-05）：四项之下再挂**步骤级**子项 —— 十步是装配台真实的工作
 * 单元，每步一条真实静态路由 `/stack/step/<id>`（菜单数据与路由表都出自
 * `app/stack/wizard.ts` 的 STACK_NAV，这里只消费）。桌面端整棵显示
 * （分组 → 页 → 步，两层缩进）；移动端只到页一级（步骤条 StepRail 本来就
 * 常驻页内，再塞十个 chip 只会把导航折成竖条）。
 */
interface NavChild {
  href: string;
  label: string;
  glyph: string;
  count: number;
  /** 步骤级子项（只有「装配台」的四个页项有） */
  children?: NavChild[];
}

interface NavItem {
  /** 缺 href = 纯分组标题，下面才有子项 */
  href?: string;
  label: string;
  glyph: string;
  count: number;
  children?: NavChild[];
}

const NAV: NavItem[] = [
  { href: '/', label: '概览', glyph: '◈', count: 0 },
  { href: '/rules', label: '规则库', glyph: '▦', count: liveStats.total },
  { href: '/blueprints', label: '最佳实践案例库', glyph: '▤', count: cookbookStats.features },
  { href: '/cases', label: '场景案例库', glyph: '◫', count: casesStats.cases },
  {
    label: '装配台',
    glyph: '⬡',
    count: dimensions.length,
    // 菜单数据出自 wizard 的 STACK_NAV（页 → 步两级），不在这里另排一张表 ——
    // 步骤的路由 / 名字 / 序号都以 STEPS 为唯一出处。
    children: STACK_NAV,
  },
  { href: '/arch', label: '架构图谱', glyph: '▣', count: 6 },
  { href: '/icons', label: '图标库', glyph: '❖', count: iconStats.total },
  { href: '/archify', label: '出图服务', glyph: '⚒', count: 0 },
  { href: '/check', label: '校验台', glyph: '⛨', count: 0 },
  { href: '/standards', label: '工程规范', glyph: '§', count: charterTotals.clauses },
  { href: '/export', label: '导出中心', glyph: '⎘', count: 0 },
];

/** 渲染行：depth -1 = 分组标题（不可点），0 = 一级，1 = 装配台的页项，2 = 页下的步骤项 */
const NAV_ROWS: { href: string; label: string; glyph: string; depth: number }[] = NAV.flatMap((n) =>
  n.href
    ? [{ href: n.href, label: n.label, glyph: n.glyph, depth: 0 }]
    : [
        { href: '', label: n.label, glyph: n.glyph, depth: -1 },
        ...(n.children ?? []).flatMap((c) => [
          { href: c.href, label: c.label, glyph: c.glyph, depth: 1 },
          ...(c.children ?? []).map((g) => ({ href: g.href, label: g.label, glyph: g.glyph, depth: 2 })),
        ]),
      ]
);

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  // 装配台的当前步骤（页内换步不导航，pathname 不动 —— 见 step-bus.ts 顶部说明）。
  // 总线为 null（不在装配台，或还没哪个装配台页面挂载）时整体退回 pathname 判定。
  const busStep = useSyncExternalStore(subscribeStep, currentStep, () => null);
  // 判定按路径边界，不是裸前缀 —— 判据本体在 lib/nav-active.ts，
  // 那里也被校验层当数据跑（`/archify` 曾经把 `/arch` 一起点亮）。
  const isActive = (href: string) => {
    if (busStep && STEP_ROUTES[busStep] === href) return true;
    return isNavActive(pathname, href);
  };

  const used = Math.min(100, liveStats.budgetUsedPct);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col md:flex-row">
      {/* ── 侧边栏 ───────────────────────────────────────── */}
      <aside data-bus-step={busStep ?? ''} className="shrink-0 border-line md:w-[212px] md:border-r">
        <div className="flex flex-wrap items-center justify-between gap-y-2 px-5 py-4 md:sticky md:top-0 md:block md:py-6">
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

          {/* 移动端导航。加 flex-wrap + min-w-0：10 个标签在 390px 下会折行，
              而不是把最后一个标签推出视口（V2-01：整站 mobile 溢出 53px）。 */}
          <nav className="flex min-w-0 flex-wrap items-center gap-1 md:hidden">
            {NAV_ROWS.map((n) =>
              n.depth === 2 ? null : n.depth < 0 ? (
                <span
                  key={`g-${n.label}`}
                  className="mono px-1 text-2xs uppercase tracking-wider text-fgFaint"
                >
                  {n.label}
                </span>
              ) : (
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
              )
            )}
          </nav>
        </div>

        {/* 桌面导航 */}
        <nav className="hidden px-3 md:sticky md:top-[88px] md:block">
          {NAV_ROWS.map((n) => {
            if (n.depth < 0) {
              return (
                <div
                  key={`g-${n.label}`}
                  className="mb-0.5 mt-2 flex items-center gap-3 px-3 py-1 text-2xs uppercase tracking-wider text-fgFaint"
                >
                  <span className="w-4 text-center text-sm">{n.glyph}</span>
                  {n.label}
                </div>
              );
            }
            const active = isActive(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={
                  'mb-0.5 flex items-center gap-3 rounded-md text-[13px] transition-colors ' +
                  (n.depth === 1
                    ? 'ml-3 py-2.5 pl-3 pr-3 text-[12px]'
                    : n.depth === 2
                      ? 'ml-7 py-2 pl-2.5 pr-3 text-[11px]'
                      : 'px-3 py-2.5')
                }
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
