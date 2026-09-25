import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { recipeLocations, getScenario, toFeature } from '@/lib/cookbook';
import BlueprintView from '@/components/BlueprintView';

/** 构建期把「技术 × 场景」全部预渲染成静态页 */
export function generateStaticParams() {
  return recipeLocations.map(({ topic, scenario }) => ({
    topic: topic.id,
    scenario: scenario.id,
  }));
}

function find(topicId: string, scenarioId: string) {
  return recipeLocations.find((l) => l.topic.id === topicId && l.scenario.id === scenarioId);
}

export function generateMetadata({ params }: { params: { topic: string; scenario: string } }): Metadata {
  const loc = find(params.topic, params.scenario);
  if (!loc) return { title: '场景不存在' };
  return {
    title: `${loc.scenario.name} · ${loc.topic.name} · 最佳实践案例库`,
    description: `${loc.scenario.when}｜${loc.scenario.recipes.length} 套实现方案，含模拟接口实测。`,
  };
}

export default function ScenarioPage({
  params,
}: {
  params: { topic: string; scenario: string };
}) {
  const loc = find(params.topic, params.scenario);
  if (!loc) notFound();
  const { topic, scenario } = loc;
  const sc = getScenario(topic.id, scenario.id)!;

  return (
    <div className="space-y-6">
      <nav className="text-2xs text-fgFaint">
        <Link href="/blueprints" className="hover:text-fg">
          最佳实践案例库
        </Link>
        <span className="px-1">/</span>
        <Link href={`/blueprints/${topic.id}`} className="hover:text-fg">
          {topic.name}
        </Link>
        <span className="px-1">/</span>
        <span className="text-fgMuted">{sc.name}</span>
      </nav>

      <header className="panel p-5">
        <h1 className="text-xl text-fg">{sc.name}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-fgMuted">{sc.when}</p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <div className="text-2xs uppercase tracking-[0.18em] text-fgFaint">可核对信号</div>
            <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-fgMuted">
              {sc.signals.map((x) => (
                <li key={x}>· {x}</li>
              ))}
            </ul>
          </div>
          <div>
            <div className="text-2xs uppercase tracking-[0.18em] text-fgFaint">什么时候不要用</div>
            <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-fgMuted">
              {sc.notSuitable.map((x) => (
                <li key={x}>· {x}</li>
              ))}
            </ul>
          </div>
        </div>

        <p className="mt-4 border-l-2 pl-3 text-xs leading-relaxed text-fgMuted" style={{ borderColor: '#33413A' }}>
          <span className="text-brass">为什么用 {topic.name}：</span>
          {sc.decision}
        </p>
      </header>

      {sc.recipes.map((recipe, i) => (
        <section key={recipe.id} className="space-y-4">
          {sc.recipes.length > 1 && (
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm text-fg">
                方案 {i + 1} · {recipe.name}
              </h2>
            </div>
          )}
          {sc.recipes.length === 1 && (
            <div className="text-2xs uppercase tracking-[0.18em] text-fgFaint">
              实现方案 · {recipe.name}
            </div>
          )}
          <p className="max-w-3xl text-sm leading-relaxed text-fgMuted">{recipe.approach}</p>

          {recipe.lab && (
            <div className="panel p-4">
              <div className="text-2xs uppercase tracking-[0.18em] text-fgFaint">
                模拟接口测试 · 这组实验在测什么
              </div>
              <p className="mt-2 text-xs leading-relaxed text-fgMuted">{recipe.lab.intro}</p>
              <div className="mt-3 text-2xs uppercase tracking-[0.18em] text-fgFaint">
                跑完应该看到
              </div>
              <ul className="mt-1.5 space-y-1 text-xs leading-relaxed text-fgMuted">
                {recipe.lab.observe.map((x) => (
                  <li key={x}>· {x}</li>
                ))}
              </ul>
            </div>
          )}

          <BlueprintView feature={toFeature({ topic, scenario: sc, recipe })} />
        </section>
      ))}
    </div>
  );
}
