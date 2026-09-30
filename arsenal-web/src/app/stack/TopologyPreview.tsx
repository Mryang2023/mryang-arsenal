'use client';

import { useMemo } from 'react';
import { toResponsiveSvg } from '@/lib/arch-diagram';
import type { StackPicks } from '@/lib/content-types';
import { buildTopologySvg, type StackPicksMeta } from '@/lib/topology';

/**
 * ⑨ 部署形态的**右栏实时预览**（plan-2 §2）。
 *
 * 为什么把它从交付预览里再引一份到这一步：形态是在这一步定的，但图原本只在
 * 交付中心的九块预览里 —— 调副本数要滚到别的页面才看得到结果，等于让用户
 * 「盲调」。现在左边改、右边这张图同帧变。
 *
 * 图的画法**不在这里重写**：`buildTopologySvg()` 是形态图唯一的实现处
 * （交付预览的「集群形态图」卡片与本卡片共用它，所以两处永远长得一样）。
 * 副本数同理 —— `effectiveAppReplicas()` 一个出处，`replicas` 的语义未动，
 * 这里只是把它念出来。
 */
export default function TopologyPreview({
  picks,
  meta,
}: {
  picks: StackPicks;
  meta: StackPicksMeta;
}) {
  const built = useMemo(
    () => buildTopologySvg(picks, meta, { columns: 1 }),
    [picks, meta]
  );

  const instances = built.figures.reduce((n, f) => n + f.replicas, 0) + built.appReplicas;

  return (
    <section className="panel overflow-hidden" data-topology-preview="">
      <header className="border-b border-line px-4 py-2.5">
        <div className="flex items-baseline gap-x-2.5">
          <span className="mono text-[12px] leading-none text-brass">⋮</span>
          <h3 className="text-[12px] font-semibold leading-[18px] text-fg">形态图 · 实时</h3>
        </div>
        <p className="mt-1 text-[10px] leading-[15px] text-fgFaint">
          左边点一下副本数，这张图的框数同时变 —— 与 K8s 的 replicas、Helm 的
          replicaCount 是同一个数字，不是另画一张示意图。
        </p>
      </header>

      <div
        className="border-b border-line"
        data-topology-preview-svg=""
        dangerouslySetInnerHTML={{ __html: toResponsiveSvg(built.svg) }}
      />

      <div className="px-4 py-2.5">
        <p className="mono text-[10px] leading-[15px] text-fgFaint">
          应用 ×{built.appReplicas} · 带形态组件 {built.figures.length} 个 · 图上实例合计{' '}
          {instances}
        </p>
        {built.figures.length === 0 ? (
          <p className="mt-1.5 text-[10px] leading-[15px] text-fgMuted">
            还没有零件声明形态 —— 装上数据库 / 缓存 / 消息队列这类组件，它们才会进这张图。
          </p>
        ) : (
          <ul className="mt-1.5 space-y-0.5">
            {built.figures.map((f) => (
              <li
                key={f.dimId}
                className="text-[10px] leading-[15px] text-fgMuted"
                data-topology-preview-figure={f.dimId}
              >
                {f.dimName} · {f.optionName}
                <span className="mono ml-1.5 text-fgFaint">
                  {f.modeLabel} ×{f.replicas}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
