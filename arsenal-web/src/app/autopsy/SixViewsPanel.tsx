'use client';

import { useMemo, useState, type ReactNode } from 'react';
import {
  ARCH_VIEW_ICONS,
  ARCH_VIEW_IMG,
  composeArchViews,
  getProfile,
  type ArchViewData,
  type ArchViewId,
} from '@/lib/arch-views';
import { buildMetrics, resolveProfile, type ArchProfile } from '@/lib/arch-profile';
import {
  AppDiagram,
  BusinessDiagram,
  DataDiagram,
  ProductDiagram,
  ProjectDiagram,
} from './diagrams';
import { CountUp, Glyph, GraphSkeleton, Reveal, useStageLoad } from './motion';
import type { ProfileDraft } from '@/lib/profile-draft';

/**
 * 六视图子页签（架构图谱合并 · 棒2，2026-10-17 超级夜）。
 *
 * 分工（计划 D4：渲染器零改动）：
 *   · 五张静态图 = `diagrams.tsx` 的成品渲染器，本组件只喂 `ArchViewData`；
 *   · 数据来源 = `composeArchViews(resolveProfile(当前档案, buildMetrics()))`，
 *     当前档案由父组件（AutopsyLab）裁定 —— 草稿 / 内置 / 导入三选一；
 *   · **技术架构图不在这里**：它是可拖拽画布（『技术架构』子页签），
 *     跟着扫描选型走。同一张图上两遍 = 两个真相，这是合并要避开的坑。
 *
 * 草稿不当成品卖：成熟度条把「N 条来自扫描 · M 条待你补」说在最前面，
 * `TODO ` 前缀原文上图（渲染器本来就那么画，不搞第二套标记体系），
 * 待补清单可展开到档案内位置（`views.business.outlets[0]` 这种）。
 */

/** 档案 id 的保留值：本次扫描草稿。它不存在于任何档案库里，只在扫描后出现 */
export const DRAFT_PROFILE_ID = '__draft__';

/** 六张静态图里不含技术架构 —— 那张是可拖拽画布，在『技术架构』子页签 */
const STATIC_VIEWS: Exclude<ArchViewId, 'tech'>[] = ['business', 'data', 'app', 'product', 'project'];

const DIAGRAM: Record<Exclude<ArchViewId, 'tech'>, (p: { data: ArchViewData }) => ReactNode> = {
  business: BusinessDiagram,
  data: DataDiagram,
  app: AppDiagram,
  product: ProductDiagram,
  project: ProjectDiagram,
};

export default function SixViewsPanel({
  draft,
  profileId,
  custom,
}: {
  draft: ProfileDraft | null;
  profileId: string;
  custom: Record<string, ArchProfile>;
}) {
  const [view, setView] = useState<Exclude<ArchViewId, 'tech'>>('business');
  const [todosOpen, setTodosOpen] = useState(false);

  const data: ArchViewData = useMemo(() => {
    if (profileId === DRAFT_PROFILE_ID && draft) {
      return composeArchViews(resolveProfile(draft.profile, buildMetrics()));
    }
    const doc = custom[profileId];
    // 导入档案当场解析（档案不大，切换重建一遍比缓存省心）
    if (doc) return composeArchViews(resolveProfile(doc, buildMetrics()));
    return composeArchViews(getProfile(profileId));
  }, [profileId, draft, custom]);

  const isDraft = profileId === DRAFT_PROFILE_ID && draft !== null;

  // ── 草稿形状坏了：明确报错，不渲染半张图 ──
  // 半张图比没有图更误导 —— 读的人会以为「平台只查得出这些」。
  if (isDraft && draft && draft.issues.length > 0) {
    return (
      <div
        className="rounded border px-3 py-2.5"
        style={{ borderColor: 'rgba(229,72,77,0.4)', background: 'rgba(229,72,77,0.08)' }}
      >
        <p className="text-[11px] font-semibold" style={{ color: '#E5484D' }}>
          这份扫描草稿的形状校验未过，六视图不渲染
        </p>
        <ul className="mt-1 space-y-0.5">
          {draft.issues.map((it, i) => (
            <li key={`${i}-${it}`} className="text-[10.5px] leading-[16px] text-fgMuted">
              <span className="mono mr-1" style={{ color: '#E5484D' }}>
                ✗
              </span>
              {it}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-[10.5px] leading-[15px] text-fgFaint">
          草稿连形状都不过，说明这次扫描读到的信息异常残缺 —— 修好上面的问题，或切到别的档案再看。
        </p>
      </div>
    );
  }

  const meta = data.views.find((v) => v.id === view) ?? data.views[0];
  const Diagram = DIAGRAM[view];

  return (
    <div className="space-y-3">
      {/* ── 成熟度条：只对草稿说。内置/导入档案是完整的，没有「待补」这个概念 ── */}
      {isDraft && draft && (
        <div
          className="rounded border px-3 py-2"
          style={{ borderColor: 'rgba(229,162,61,0.35)', background: 'rgba(229,162,61,0.07)' }}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[11px]">
              <span className="font-semibold" style={{ color: '#E5A33D' }}>
                {draft.filled} 条来自扫描
              </span>
              <span className="text-fgMuted"> · </span>
              <span className="font-semibold" style={{ color: '#E5A33D' }}>
                {draft.todos.length} 条待你补
              </span>
            </span>
            {draft.todos.length > 0 ? (
              <button
                type="button"
                onClick={() => setTodosOpen((v) => !v)}
                className="rounded border border-line px-2 py-0.5 text-[10.5px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
              >
                {todosOpen ? '收起待补清单' : `展开 ${draft.todos.length} 条待补清单`}
              </button>
            ) : (
              // 0 条也是结论：一条待补都没有，就说「没有」，不让按钮消失得像没测过
              <span className="text-[10.5px] text-fgMuted">没有待补条目</span>
            )}
          </div>
          <p className="mt-1 text-[10.5px] leading-[15px] text-fgMuted">
            这是扫描草稿，不是成品档案：带「TODO 」前缀的条目是代码里读不到的东西（业务定位、消费方、非目标、路线图）。
            数字全部来自扫描事实，没有一个是估的。
            草稿替代不了手写档案 —— 完整度取决于你补不补这些 TODO；这里只保证补的地方亮出来，没补的不装成补了。
          </p>
          {todosOpen && draft.todos.length > 0 && (
            <ul className="mt-1.5 max-h-[180px] space-y-0.5 overflow-y-auto border-t border-line pt-1.5">
              {draft.todos.map((t) => (
                <li key={t} className="mono text-[10.5px] leading-[16px] text-fgMuted">
                  <span className="mr-1 text-fgFaint">·</span>
                  {t}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── 视图页签 ── */}
      <div className="panel flex flex-wrap items-center gap-1.5 px-3 py-2.5">
        <span className="mono mr-1 text-[10px] uppercase tracking-wider text-fgFaint">六视图</span>
        {STATIC_VIEWS.map((id, i) => {
          const v = data.views.find((x) => x.id === id)!;
          const on = view === id;
          return (
            <Reveal key={id} i={i} as="span">
              <button
                type="button"
                onClick={() => setView(id)}
                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] transition-all duration-150 hover:border-lineHi"
                style={{
                  borderColor: on ? `${v.accent}66` : 'transparent',
                  background: on ? `${v.accent}1A` : 'transparent',
                  color: on ? v.accent : '#93A39C',
                  fontWeight: on ? 650 : 400,
                }}
              >
                <Glyph name={ARCH_VIEW_ICONS[id]} size={13} color={on ? v.accent : '#6A7F80'} />
                {v.name}
              </button>
            </Reveal>
          );
        })}
        <span className="ml-auto flex items-center gap-1.5 text-[10px] text-fgFaint">
          <Glyph name="scale" size={12} color="#D9A441" />
          {data.profileName} · 自检{' '}
          <CountUp text={String(data.verifyTotal)} className="text-[10.5px] text-[#D9A441]" /> 项
        </span>
      </div>

      <p className="text-[10px] leading-[15px] text-fgFaint">
        技术架构图不在这五张里 —— 它是可拖拽画布，在左侧『技术架构』子页签（跟着本次扫描的选型走，拖动与改名只影响交付图）。
      </p>

      {/* ── 视图头卡：定义 / 核心关注 / 回答问题 / 常见产出 ── */}
      <div className="panel overflow-hidden" key={`${profileId}-${view}`} style={{ borderColor: `${meta.accent}44` }}>
        <div className="relative flex items-center gap-3 border-b border-line px-4 py-3" style={{ background: `${meta.accent}0D` }}>
          <span
            className="mono ui-rise flex h-8 w-8 items-center justify-center rounded-md"
            style={{ background: `${meta.accent}1A`, color: meta.accent }}
          >
            <Glyph name={ARCH_VIEW_ICONS[view]} size={17} color={meta.accent} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[14px] font-bold text-fg">
              {meta.name}
              <span className="mono ml-2 text-[10px] font-normal uppercase tracking-[0.14em] text-fgFaint">
                {meta.english}
              </span>
              <span
                className="ml-2 rounded px-1.5 py-0.5 text-[9.5px] font-normal"
                style={{ background: 'rgba(217,164,65,0.12)', color: '#D9A441' }}
              >
                {data.profileName}
              </span>
            </h2>
            <p className="mt-0.5 max-w-[820px] text-[10.5px] leading-[16px] text-fgMuted">{meta.definition}</p>
          </div>
          {/* 封面插画：AI 生成，裁掉水印后压到 512px webp；装饰位，读图不靠它 */}
          <img
            src={ARCH_VIEW_IMG[view]}
            alt=""
            aria-hidden
            width={96}
            height={96}
            className="ui-drift pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-lg opacity-55 lg:block"
            style={{ maskImage: 'linear-gradient(to left, black 50%, transparent)', WebkitMaskImage: 'linear-gradient(to left, black 50%, transparent)' }}
          />
        </div>
        <div className="grid gap-0 sm:grid-cols-3">
          <HeadCell label="核心关注" items={meta.focus} accent={meta.accent} i={0} />
          <HeadCell label="回答问题" items={[meta.question]} accent={meta.accent} i={1} />
          <HeadCell label="常见产出" items={meta.outputs} accent={meta.accent} i={2} />
        </div>
      </div>

      {/* ── 视图主体：切换时先骨架后淡入 ── */}
      <ViewPane tab={`${profileId}-${view}`} accent={meta.accent}>
        <Diagram data={data} />
      </ViewPane>
    </div>
  );
}

/** 视图容器：骨架屏 → 内容淡入。骨架不是装饰，切档案真的要重算一遍 */
function ViewPane({ tab, accent, children }: { tab: string; accent: string; children: ReactNode }) {
  const loading = useStageLoad(tab);
  if (loading) {
    return (
      <div className="panel p-4">
        <GraphSkeleton accent={accent} />
      </div>
    );
  }
  return (
    <div className="panel ui-fade p-4" key={tab}>
      {children}
    </div>
  );
}

function HeadCell({ label, items, accent, i = 0 }: { label: string; items: readonly string[]; accent: string; i?: number }) {
  return (
    <Reveal i={i} className="border-line px-4 py-3 sm:border-r sm:last:border-r-0">
      <p className="mono text-[9px] uppercase tracking-[0.16em]" style={{ color: accent }}>
        {label}
      </p>
      <ul className="mt-1.5 space-y-1">
        {items.map((it) => (
          <li key={it} className="text-[11px] leading-[17px] text-fgMuted">
            {items.length > 1 && (
              <span className="mono mr-1.5" style={{ color: accent }}>
                ·
              </span>
            )}
            {it}
          </li>
        ))}
      </ul>
    </Reveal>
  );
}
