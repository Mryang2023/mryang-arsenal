import type { Metadata } from 'next';
import Link from 'next/link';
import { topics, cookbookMeta, cookbookStats } from '@/lib/cookbook';

export const metadata: Metadata = {
  title: '最佳实践案例库 · 军火库',
  description: cookbookMeta.description,
};

export default function BlueprintsPage() {
  const families = cookbookMeta.families ?? {};
  // 「外场」已经比较过的其它技术：从各项技术的 pickWhen 里读出来，不手写清单 ——
  // 加一项技术，这里自动多一行，不会出现「页面上列着一条不存在的主线」。
  const compared = [...new Set(topics.flatMap((t) => t.pickWhen.map((p) => p.vs)))];

  return (
    <div className="space-y-6">
      <header className="panel p-5">
        <div className="text-2xs uppercase tracking-[0.18em] text-fgFaint">最佳实践案例库</div>
        <h1 className="mt-1 text-xl text-fg">先选技术，再看场景，最后拿方案</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fgMuted">
          {cookbookMeta.description}
        </p>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-fgMuted">
          <span>
            <b className="mono text-fg">{cookbookStats.features}</b> 项技术
          </span>
          <span>
            <b className="mono text-fg">{cookbookStats.scenarios}</b> 个场景
          </span>
          <span>
            <b className="mono text-fg">{cookbookStats.recipes}</b> 套实现方案
          </span>
          <span>
            <b className="mono text-fg">{cookbookStats.files}</b> 个文件 /{' '}
            <b className="mono text-fg">{cookbookStats.lines}</b> 行
          </span>
          <span>
            <b className="mono text-fg">{cookbookStats.demos}</b> 个模拟接口实验
          </span>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        {topics.map((t) => (
          <Link
            key={t.id}
            href={`/blueprints/${t.id}`}
            className="panel block p-5 transition-colors hover:border-brass"
          >
            <div className="flex items-start gap-3">
              <span className="mono text-2xl leading-none text-brass">{t.glyph}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base text-fg">{t.name}</h2>
                  <span className="mono rounded border border-line px-1.5 py-0.5 text-2xs text-fgMuted">
                    {families[t.family] ?? t.family}
                  </span>
                  <span className="mono rounded border border-line px-1.5 py-0.5 text-2xs text-fgMuted">
                    {t.runtime}
                  </span>
                </div>
                <p className="mt-1 text-sm text-fgMuted">{t.subtitle}</p>
              </div>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-fgFaint">{t.intent}</p>

            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-fgMuted">
              <span>{t.scenarioCount} 个场景</span>
              <span>{t.recipeCount} 套方案</span>
              <span className="mono">
                {t.fileCount} 文件 / {t.lines} 行
              </span>
              <span className="text-olive">{t.demoCount} 个可跑实验</span>
            </div>

            <ul className="mt-3 space-y-1 text-2xs text-fgFaint">
              {t.scenarios.map((s) => (
                <li key={s.id} className="truncate">
                  · {s.name}
                </li>
              ))}
            </ul>
          </Link>
        ))}
      </div>

      {compared.length > 0 && (
        <div className="panel p-4">
          <div className="text-2xs uppercase tracking-[0.18em] text-fgFaint">
            已比较过的其它技术（尚未单独立项）
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {compared.map((vs) => (
              <span
                key={vs}
                className="mono rounded border border-dashed border-line px-2 py-1 text-2xs text-fgFaint"
              >
                {vs}
              </span>
            ))}
          </div>
          <p className="mt-2 text-2xs leading-relaxed text-fgFaint">
            它们现在只作为「什么时候该选 / 不该选」的对照出现在各项技术里；
            要独立成一条主线，得先补齐它自己的场景与可运行实验 —— 写不出这两样的，不立项。
          </p>
        </div>
      )}
    </div>
  );
}
