import type { Metadata } from 'next';
import IconGallery from './IconGallery';
import { ICON_CATEGORIES, iconStats } from '@/lib/icon-assets';
import { iconLibrary } from '@/lib/icon-assets';

export const metadata: Metadata = {
  title: '图标资产库',
  description:
    '画架构图会用到的图标：九大类，矢量供架构图节点与导出使用，位图供卡片配图与文档插图使用。支持分类筛选、四路搜索、复制 key 与导出 SVG。',
};

export default function IconsPage() {
  return (
    <div className="animate-fade-up space-y-8">
      {/* ── Hero ─────────────────────────────────────── */}
      <header className="grid-bg relative overflow-hidden rounded-xl border border-line bg-surface">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(110% 100% at 0% 0%, rgba(124,92,191,0.12) 0%, transparent 58%), radial-gradient(80% 90% at 100% 100%, rgba(217,164,65,0.08) 0%, transparent 60%)',
          }}
        />
        <div className="relative px-6 py-7 md:px-9 md:py-9">
          <div className="mono mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs uppercase tracking-[0.2em] text-fgFaint">
            <span style={{ color: '#7C5CBF' }}>❖</span>
            <span>icon library</span>
            <span className="text-lineHi">/</span>
            <span>v{iconLibrary.version}</span>
            <span className="text-lineHi">/</span>
            <span>{ICON_CATEGORIES.length} 类</span>
          </div>

          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-fg md:text-[32px]">
            图标资产库
          </h1>
          <p className="mt-3 max-w-3xl text-[14.5px] leading-relaxed text-fgMuted">
            第一批 89 个图标全是具体技术件（MySQL / Redis / Nacos）。真正画交付级架构图时缺的
            恰恰是那些<span className="text-fg">不是某个产品</span>的东西：谁在用系统、跑在哪、
            怎么进来、一个还是多个。这一批补的就是它们 ——
            <span className="text-fg">全部手绘 SVG</span>，随 currentColor 变色、能进 SVG 导出，
            不引任何图标库。
          </p>

          <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-4">
            {[
              { k: '登记图标', v: iconStats.total, s: '条清单' },
              { k: '分类', v: iconStats.categories, s: '大类' },
              { k: '矢量可用', v: iconStats.total - iconStats.missingVector, s: '架构图直接能用的' },
              { k: '位图', v: iconStats.bitmaps, s: '张已落盘（分批补）' },
            ].map((x) => (
              <div key={x.k} className="bg-surface px-4 py-3.5">
                <div className="text-2xs text-fgFaint">{x.k}</div>
                <div className="stat-num mt-1 text-[22px] font-semibold leading-none text-fg">
                  {x.v}
                </div>
                <div className="mt-1 text-2xs text-fgFaint">{x.s}</div>
              </div>
            ))}
          </div>
        </div>
      </header>

      <IconGallery />
    </div>
  );
}
