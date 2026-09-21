'use client';

import { useState, type ReactNode } from 'react';
import { ARCH_VIEWS, archViewMeta, VERIFY_TOTAL, type ArchViewId } from '@/lib/arch-views';
import {
  AppDiagram,
  BusinessDiagram,
  DataDiagram,
  ProductDiagram,
  ProjectDiagram,
} from './diagrams';
import TechArch from '../stack/TechArch';
import { CountUp, Glyph, GraphSkeleton, Reveal, useStageLoad } from './motion';

/**
 * 架构图谱 —— 六大架构一图讲清。
 *
 * 业务 / 数据 / 应用 / 产品 / 项目五张是「讲清楚」的静态视图，
 * 数据全部从真实数据算出；技术架构是唯一可编辑的交付图，沿用装配台
 * 的选型（localStorage 快照），在装配台改选型，这里自动跟上。
 *
 * 动效约定：切换页签先给骨架屏（技术架构图真的要读 localStorage + 重算
 * 画布，那段时间不是装的），图就位后淡入；封面插画缓浮，头卡逐格浮现。
 * 全部动效在 prefers-reduced-motion 下自动停。
 */

/** 每个视图的手绘图标（arch-glyphs） */
const VIEW_ICONS: Record<ArchViewId, string> = {
  business: 'layers',
  data: 'stackDb',
  app: 'browser',
  tech: 'server',
  product: 'spark',
  project: 'flag',
};

/** 每个视图的封面插画（public/arch/*.webp，AI 生成后压缩到 512px） */
const VIEW_IMG: Record<ArchViewId, string> = {
  business: '/arch/business.webp',
  data: '/arch/data.webp',
  app: '/arch/app.webp',
  tech: '/arch/tech.webp',
  product: '/arch/product.webp',
  project: '/arch/project.webp',
};

export default function ArchGallery() {
  const [tab, setTab] = useState<ArchViewId>('business');
  const view = archViewMeta(tab);

  return (
    <div className="space-y-4">
      {/* 页签 */}
      <div className="panel flex flex-wrap items-center gap-1.5 px-3 py-2.5">
        <span className="mono mr-1 text-[10px] uppercase tracking-wider text-fgFaint">六大架构</span>
        {ARCH_VIEWS.map((v, i) => {
          const on = tab === v.id;
          return (
            <Reveal key={v.id} i={i} as="span">
              <button
                type="button"
                onClick={() => setTab(v.id)}
                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] transition-all duration-150 hover:border-lineHi"
                style={{
                  borderColor: on ? `${v.accent}66` : 'transparent',
                  background: on ? `${v.accent}1A` : 'transparent',
                  color: on ? v.accent : '#93A39C',
                  fontWeight: on ? 650 : 400,
                }}
              >
                <Glyph name={VIEW_ICONS[v.id]} size={13} color={on ? v.accent : '#6A7F80'} />
                {v.name}
              </button>
            </Reveal>
          );
        })}
        <span className="ml-auto flex items-center gap-1.5 text-[10px] text-fgFaint">
          <Glyph name="scale" size={12} color="#D9A441" />
          自检 <CountUp text={String(VERIFY_TOTAL)} className="text-[10.5px] text-[#D9A441]" /> 项 · 从战略到落地
        </span>
      </div>

      {/* 视图头卡：定义 / 核心关注 / 回答问题 / 常见产出（沿用「一图讲清」的口径） */}
      <div className="panel overflow-hidden" key={tab} style={{ borderColor: `${view.accent}44` }}>
        <div className="relative flex items-center gap-3 border-b border-line px-4 py-3" style={{ background: `${view.accent}0D` }}>
          <span
            className="mono ui-rise flex h-8 w-8 items-center justify-center rounded-md"
            style={{ background: `${view.accent}1A`, color: view.accent }}
          >
            <Glyph name={VIEW_ICONS[tab]} size={17} color={view.accent} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[14px] font-bold text-fg">
              {view.name}
              <span className="mono ml-2 text-[10px] font-normal uppercase tracking-[0.14em] text-fgFaint">
                {view.english}
              </span>
            </h2>
            <p className="mt-0.5 max-w-[820px] text-[10.5px] leading-[16px] text-fgMuted">{view.definition}</p>
          </div>
          {/* 封面插画：AI 生成，裁掉水印后压到 512px webp；装饰位，读图不靠它 */}
          <img
            src={VIEW_IMG[tab]}
            alt=""
            aria-hidden
            width={96}
            height={96}
            className="ui-drift pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-lg opacity-55 lg:block"
            style={{ maskImage: 'linear-gradient(to left, black 50%, transparent)', WebkitMaskImage: 'linear-gradient(to left, black 50%, transparent)' }}
          />
        </div>
        <div className="grid gap-0 sm:grid-cols-3">
          <HeadCell label="核心关注" items={view.focus} accent={view.accent} i={0} />
          <HeadCell label="回答问题" items={[view.question]} accent={view.accent} i={1} />
          <HeadCell label="常见产出" items={view.outputs} accent={view.accent} i={2} />
        </div>
      </div>

      {/* 视图主体：切换时先骨架后淡入 */}
      <ViewPane tab={tab} accent={view.accent}>
        {tab === 'business' && <BusinessDiagram />}
        {tab === 'data' && <DataDiagram />}
        {tab === 'app' && <AppDiagram />}
        {tab === 'product' && <ProductDiagram />}
        {tab === 'project' && <ProjectDiagram />}
        {tab === 'tech' && <TechArch />}
      </ViewPane>
    </div>
  );
}

/** 视图容器：骨架屏 → 内容淡入。骨架不是装饰，技术架构图确实要现场算 */
function ViewPane({ tab, accent, children }: { tab: ArchViewId; accent: string; children: ReactNode }) {
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
