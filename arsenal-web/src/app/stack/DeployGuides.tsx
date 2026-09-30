'use client';

import { useMemo, useState } from 'react';
import CodeBlock from '@/components/CodeBlock';
import { dimensionById } from '@/lib/stack';
import {
  DEPLOY_GUIDES,
  getSelectedGuides,
  OS_LABEL,
  type DeployOs,
  type SelectedGuide,
} from '@/lib/deploy-guides';
import { TONE, toneAt } from './palette';

function OsTabs({
  steps,
}: {
  steps: Partial<Record<DeployOs, { title?: string; lang: string; code: string; note?: string }[]>>;
}) {
  const osList = (Object.keys(steps) as DeployOs[]).filter((o) => (steps[o]?.length ?? 0) > 0);
  const [os, setOs] = useState<DeployOs>(osList[0] ?? 'linux');
  const list = steps[os] ?? [];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 rounded border border-line p-0.5">
        {osList.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => setOs(o)}
            className={
              'rounded px-2.5 py-1 text-2xs transition-colors ' +
              (os === o ? 'bg-surfaceHi text-brass' : 'text-fgMuted hover:text-fg')
            }
          >
            {OS_LABEL[o]}
          </button>
        ))}
      </div>
      {list.map((s, i) => (
        <div key={i} className="space-y-1">
          {s.title && <p className="text-2xs text-fg">{s.title}</p>}
          <CodeBlock code={s.code} lang={s.lang} label={OS_LABEL[os]} />
          {s.note && (
            <p className="text-2xs leading-[16px]" style={{ color: TONE.warn.color }}>
              ⚠ {s.note}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function DeployGuideCard({ g }: { g: SelectedGuide }) {
  const dim = dimensionById.get(g.dimId);
  const opt = dim?.options.find((o) => o.id === g.optionId);
  const cluster = g.guide.cluster;

  return (
    <div className="panel space-y-4 p-4">
      <div>
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-fg">{g.guide.name}</span>
          <span className="mono text-2xs text-fgFaint">{g.optionName}</span>
          {g.clusterActive && (
            <span className="mono rounded bg-surfaceHi px-1.5 py-0.5 text-2xs" style={{ color: TONE.bad.color }}>
              集群形态
            </span>
          )}
        </div>
        <p className="mt-1 text-2xs leading-[16px] text-fgMuted">{g.guide.intro}</p>
      </div>

      <section className="space-y-2">
        <h4 className="text-2xs font-semibold uppercase tracking-wider text-fgFaint">服务器安装</h4>
        <OsTabs steps={g.guide.install} />
      </section>

      {g.clusterActive && cluster && (
        <section className="space-y-2 rounded-lg border border-line p-3" style={{ background: toneAt('bad', 0.04) }}>
          <h4 className="text-2xs font-semibold uppercase tracking-wider" style={{ color: TONE.bad.color }}>
            {cluster.title}
          </h4>
          <p className="text-2xs leading-[16px] text-fgMuted">{cluster.intro}</p>
          <OsTabs steps={cluster.install} />
          <ul className="space-y-1">
            {cluster.notes.map((n, i) => (
              <li key={i} className="flex gap-1.5 text-2xs leading-[16px] text-fgMuted">
                <span style={{ color: TONE.warn.color }}>•</span>
                <span>{n}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h4 className="text-2xs font-semibold uppercase tracking-wider text-fgFaint">代码里怎么接</h4>
        {opt?.yaml && <CodeBlock code={opt.yaml} lang="yaml" label="application.yml" />}
        {g.clusterActive && cluster && g.optionId === 'redis' && (
          <p className="text-2xs leading-[16px]" style={{ color: TONE.warn.color }}>
            ⚠ 集群形态下把 host/port 换成 cluster.nodes，例如
            <span className="mono"> spring.data.redis.cluster.nodes=10.0.0.1:7000,10.0.0.2:7001 </span>
            （填部分节点即可，Lettuce 自动发现其余）。
          </p>
        )}
        {(opt?.configClasses ?? []).map((c) => (
          <CodeBlock key={c.path} code={c.code} lang="java" label={c.path} />
        ))}
        {!opt?.yaml && !(opt?.configClasses?.length) && (
          <p className="text-2xs text-fgFaint">该组件的代码配置见选型台「Java 源码」页签。</p>
        )}
      </section>
    </div>
  );
}

export default function DeployGuides({
  picks,
  meta,
}: {
  picks: Record<string, string>;
  meta: { topology: Record<string, string> };
}) {
  const guides = useMemo(() => getSelectedGuides(picks, meta), [picks, meta]);

  if (!guides.length) {
    return (
      <div className="panel p-6 text-center">
        <p className="text-xs text-fgMuted">
          当前选型里没有带「服务器部署指引」的组件。
        </p>
        <p className="mt-1 text-2xs text-fgFaint">
          已种好指引：{Object.keys(DEPLOY_GUIDES).join(' / ')}。选中其中任意一个，这里就会出现安装、集群与代码配置。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-2xs leading-relaxed text-fgMuted">
        下面是当前选型里每个组件的<strong className="text-fg">服务器侧部署</strong>与
        <strong className="text-fg">代码接入</strong>。代码段直接从选型台的事实源取，和「Java 源码」页签一致；
        集群形态（如 Redis 集群、MySQL 主从/MGR）会额外展开部署步骤。
      </p>
      {guides.map((g) => (
        <DeployGuideCard key={`${g.dimId}:${g.optionId}`} g={g} />
      ))}
    </div>
  );
}
