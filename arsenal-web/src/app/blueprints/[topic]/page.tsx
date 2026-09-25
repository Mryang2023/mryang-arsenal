import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { topics, getTopic, cookbookMeta } from '@/lib/cookbook';

/** 构建期把每个技术预渲染成静态页 */
export function generateStaticParams() {
  return topics.map((t) => ({ topic: t.id }));
}

export function generateMetadata({ params }: { params: { topic: string } }): Metadata {
  const topic = getTopic(params.topic);
  if (!topic) return { title: '技术不存在' };
  return {
    title: `${topic.name} · 最佳实践案例库`,
    description: `${topic.subtitle}｜${topic.scenarioCount} 个场景 / ${topic.recipeCount} 套实现方案 / ${topic.lines} 行代码。`,
  };
}

export default function TopicPage({ params }: { params: { topic: string } }) {
  const topic = getTopic(params.topic);
  if (!topic) notFound();
  const families = cookbookMeta.families ?? {};

  return (
    <div className="space-y-6">
      <nav className="text-2xs text-fgFaint">
        <Link href="/blueprints" className="hover:text-fg">
          最佳实践案例库
        </Link>
        <span className="px-1">/</span>
        <span className="text-fgMuted">{topic.name}</span>
      </nav>

      <header className="panel p-5">
        <div className="flex items-start gap-3">
          <span className="mono text-3xl leading-none text-brass">{topic.glyph}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl text-fg">{topic.name}</h1>
              <span className="mono rounded border border-line px-1.5 py-0.5 text-2xs text-fgMuted">
                {families[topic.family] ?? topic.family}
              </span>
              <span className="mono rounded border border-line px-1.5 py-0.5 text-2xs text-fgMuted">
                {topic.runtime}
              </span>
              <span className="mono rounded border border-line px-1.5 py-0.5 text-2xs text-fgMuted">
                {topic.level}
              </span>
            </div>
            <p className="mt-1 text-sm text-fgMuted">{topic.subtitle}</p>
          </div>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-fgMuted">{topic.intent}</p>
      </header>

      {/* 外场选择：这一层存在的意义就是「什么时候该选它」 */}
      <section className="panel p-5">
        <h2 className="text-sm text-fg">什么时候该选它</h2>
        <ul className="mt-3 space-y-3">
          {topic.pickWhen.map((p) => (
            <li key={p.vs} className="border-l-2 pl-3" style={{ borderColor: '#33413A' }}>
              <div className="text-xs text-brass">vs {p.vs}</div>
              <p className="mt-1 text-xs leading-relaxed text-fgMuted">{p.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel p-5">
        <h2 className="text-sm text-fg">它自身的边界</h2>
        <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-fgMuted">
          {topic.limits.map((x) => (
            <li key={x}>· {x}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-3 text-sm text-fg">场景：在什么情况下用</h2>
        <div className="space-y-4">
          {topic.scenarios.map((s) => (
            <Link
              key={s.id}
              href={`/blueprints/${topic.id}/${s.id}`}
              className="panel block p-5 transition-colors hover:border-brass"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="text-base text-fg">{s.name}</h3>
                <span className="text-2xs text-fgFaint">
                  {s.recipes.length} 套方案 · {s.recipes[0]?.fileCount ?? 0} 文件
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-fgMuted">{s.when}</p>

              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <div className="text-2xs uppercase tracking-[0.18em] text-fgFaint">
                    可核对信号
                  </div>
                  <ul className="mt-1.5 space-y-1 text-2xs leading-relaxed text-fgMuted">
                    {s.signals.map((x) => (
                      <li key={x}>· {x}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="text-2xs uppercase tracking-[0.18em] text-fgFaint">
                    为什么用它
                  </div>
                  <p className="mt-1.5 text-2xs leading-relaxed text-fgMuted">{s.decision}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="panel p-4">
        <div className="text-2xs uppercase tracking-[0.18em] text-fgFaint">参考出处</div>
        <ul className="mt-2 space-y-1.5 text-2xs leading-relaxed text-fgMuted">
          {topic.references.map((r) => (
            <li key={r.title}>
              {r.url ? (
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brass hover:underline"
                >
                  {r.title}
                </a>
              ) : (
                <span className="text-fg">{r.title}</span>
              )}
              {r.note ? <span className="text-fgFaint"> —— {r.note}</span> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
