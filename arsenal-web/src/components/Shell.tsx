'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useSyncExternalStore } from 'react';
import { liveStats, meta } from '@/lib/rules';
import { cookbookStats } from '@/lib/cookbook';
import { casesStats } from '@/lib/case-cases';
import { dimensions } from '@/lib/stack';
import { iconStats } from '@/lib/icon-assets';
import { isNavActive, groupShouldOpen } from '@/lib/nav-active';
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
 *
 * 折叠（2026-10-12）：分组标题从**死标题**改成可点的展开/收起按钮，默认不再全开。
 * 整棵展开时装配台一个分组占 15 行、侧栏实测 1268px —— 比视口高出一大截，
 * 别的页面的入口被顶到屏幕外。默认态由 `lib/nav-active.ts` 的 `groupShouldOpen`
 * 算：**人所在的那个组自动展开，其余收起**；点过标题之后该组归手动状态管，
 * 导航切页不重置（刚手工收起的组又被弹开，等于那颗按钮是摆设）。
 * 折叠只作用于桌面整列；移动端页一级常显，维持原样。
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
  // /arch（架构图谱）2026-10-17 架构图谱合并棒3 退役为重定向页 → /autopsy：
  // 六视图与可拖拽画布已并进「项目侦察」架构面板，入口只留一处。
  { href: '/autopsy', label: '项目侦察', glyph: '▧', count: 0 },
  { href: '/qa', label: '测试工程师', glyph: '⚗', count: 0 },
  { href: '/icons', label: '图标库', glyph: '❖', count: iconStats.total },
  { href: '/archify', label: '出图服务', glyph: '⚒', count: 0 },
  { href: '/check', label: '校验台', glyph: '⛨', count: 0 },
  { href: '/standards', label: '工程规范', glyph: '§', count: charterTotals.clauses },
  { href: '/export', label: '导出中心', glyph: '⎘', count: 0 },
];

/** 渲染行：depth -1 = 分组标题（可点，展开/收起本组），0 = 一级，1 = 装配台的页项，2 = 页下的步骤项
 *  group = 所属分组标题（一级项为空串）—— 折叠判定按组算，判据在 `lib/nav-active.ts`。 */
const NAV_ROWS: { href: string; label: string; glyph: string; depth: number; group: string }[] = NAV.flatMap((n) =>
  n.href
    ? [{ href: n.href, label: n.label, glyph: n.glyph, depth: 0, group: '' }]
    : [
        { href: '', label: n.label, glyph: n.glyph, depth: -1, group: n.label },
        ...(n.children ?? []).flatMap((c) => [
          { href: c.href, label: c.label, glyph: c.glyph, depth: 1, group: n.label },
          ...(c.children ?? []).map((g) => ({ href: g.href, label: g.label, glyph: g.glyph, depth: 2, group: n.label })),
        ]),
      ]
);

/** 分组标题 → 组内全部真实地址（页 + 步）。折叠后的默认展开判定读这一份。 */
const GROUP_HREFS: Record<string, string[]> = NAV_ROWS.reduce(
  (acc, r) => {
    if (r.depth >= 1 && r.group) (acc[r.group] ??= []).push(r.href);
    return acc;
  },
  {} as Record<string, string[]>
);

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '/';
  // 装配台的当前步骤（页内换步不导航，pathname 不动 —— 见 step-bus.ts 顶部说明）。
  // 总线为 null（不在装配台，或还没哪个装配台页面挂载）时整体退回 pathname 判定。
  const busStep = useSyncExternalStore(subscribeStep, currentStep, () => null);
  // 判定按路径边界，不是裸前缀 —— 判据本体在 lib/nav-active.ts，
  // 那里也被校验层当数据跑（`/archify` 曾经把 `/arch` 一起点亮）。
  const isActive = (href: string) => isNavActive(pathname, href);
  // 步骤级子项：总线有值时它才是当前步的**唯一权威** —— 页内换步不导航、
  // pathname 不动，旧 pathname 会把上一步继续点亮（2026-10-05 反馈的根源），
  // 必须让位。总线为空（不在装配台 / 钉死路由刚挂载还没换过步）退回 pathname。
  const isStepActive = (href: string) =>
    busStep ? STEP_ROUTES[busStep] === href : isNavActive(pathname, href);

  // 分组折叠。`undefined` = 没手动干预过 → 由当前路由决定（人所在的组自动展开，
  // 其余收起）；点过标题之后该组就归这个表管。点别的链接不重置：
  // 刚手工收起的组又被导航弹开，等于那颗按钮是摆设。
  const [groupOverrides, setGroupOverrides] = useState<Record<string, boolean>>({});
  const isGroupOpen = (label: string) => groupOverrides[label] ?? groupShouldOpen(pathname, GROUP_HREFS[label] ?? []);
  const toggleGroup = (label: string) =>
    setGroupOverrides((s) => ({ ...s, [label]: !isGroupOpen(label) }));
  // 移动端保持原样（页一级常显，步骤条本来就在页内），折叠只作用于桌面整列。
  const desktopRows = NAV_ROWS.filter((r) => !r.group || r.depth < 0 || isGroupOpen(r.group));

  const used = Math.min(100, liveStats.budgetUsedPct);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col md:flex-row">
      {/* ── 侧边栏 ───────────────────────────────────────── */}
      <aside className="shrink-0 border-line md:w-[212px] md:border-r">
       {/* 桌面端整列钉进视口：外层 sticky + h-screen，页头固定、**菜单自己滚**。
           2026-10-05 修「菜单滚动与正文滚动冲突」：此前菜单是 `md:sticky top-[88px]`
           但 `overflow: visible` —— 24 个链接（拆细后多了 10 条步骤项）实测高 1268px，
           比视口高 368px，底部 456px（配额卡 + 统计块）被钉在屏幕外永远看不到；
           而菜单不是滚动容器，鼠标停在它上面滚滚动的全是正文（实测 window.scrollY
           0→300）。两件事同源：菜单得自己成为滚动容器。
           顺带干掉 `top-[88px]`：那个魔数硬编码了页头高度（实测 84px），
           页头 padding 一改菜单就错位 —— 现在位置由 flex 布局算出来。      */}
       <div className="md:sticky md:top-0 md:flex md:h-screen md:flex-col">
        <div className="flex flex-wrap items-center justify-between gap-y-2 px-5 py-4 md:block md:shrink-0 md:py-6">
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

        {/* 桌面导航。`min-h-0 flex-1` 是让 flex 子项能缩到内容以下（默认 min-height:auto
            会顶着内容高度不缩），`overflow-y-auto` 才真的给出滚动条。
            `overscroll-contain`：菜单滚到头时**不再把滚动传给正文** —— 少了它，
            菜单只有 3 项的短页面也会「在菜单上滚滚的却是正文」。
            `scroll-thin`：全局滚动条 10px 在 212px 窄栏里太宽。          */}
        <nav className="scroll-thin hidden min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 md:block">
          {desktopRows.map((n) => {
            if (n.depth < 0) {
              const open = isGroupOpen(n.group);
              return (
                <button
                  key={`g-${n.label}`}
                  type="button"
                  onClick={() => toggleGroup(n.group)}
                  aria-expanded={open}
                  className="mb-0.5 mt-2 flex w-full items-center gap-3 rounded-md px-3 py-1 text-2xs uppercase tracking-wider transition-colors"
                  style={{ color: open ? '#93A39C' : '#5E6E67' }}
                >
                  <span className="w-4 text-center text-sm">{n.glyph}</span>
                  <span className="flex-1 text-left">{n.label}</span>
                  <span className="mono w-3 text-center">{open ? '▾' : '▸'}</span>
                </button>
              );
            }
            const active = n.depth === 2 ? isStepActive(n.href) : isActive(n.href);
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
       </div>
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
