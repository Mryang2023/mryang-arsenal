'use client';

import { useMemo } from 'react';
import { toResponsiveSvg } from '@/lib/arch-diagram';
import type { ReplicaLine } from '@/lib/deploy';
import type { StackPicks } from '@/lib/content-types';
import { buildTopologySvg, type StackPicksMeta } from '@/lib/topology';
import { TONE, INK, toneAt } from './palette';

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
 *
 * ⚠️ 传参只给 `columns: 1`（窄栏单列排版），**与图的内容无关**：节点、副本数、
 * 连边全由 (picks, meta) 决定，所以它和交付预览那张（传 theme / title）必然同形。
 * 哪天有人在这里给图「补两笔」，两处立刻分叉，而且没有任何东西会报错 ——
 * 本文件里出现任何自绘 SVG 的痕迹（'<svg' / 'rect' / 'stroke='）都是错的。
 *
 * **`focusDim`（Helm 联动的那一半）**：台上正在调哪一项，就把它的 id 传进来，
 * 图上那个框亮起来（`buildTopologySvg` 的 `highlight`）。反过来，点下面那排
 * 按钮也能把焦点推回台面 —— 联动是双向的，不是只在图里画一眼。
 */
export default function TopologyPreview({
  picks,
  meta,
  focusDim,
  onFocus,
  replicaLines = [],
}: {
  picks: StackPicks;
  meta: StackPicksMeta;
  /** 当前焦点：'app' 或维度 id；不给就谁都不亮 */
  focusDim?: string;
  /** 点下面那排焦点按钮 / 点图上的项 —— 把焦点推回台面（可选） */
  onFocus?: (target: string) => void;
  /**
   * 副本数落在产物的哪几行（由调用方从 `buildDeployPlan()` 生成的文件里抽出）。
   * 为什么传进来而不是这里自己算：这份面板**只做展示**，产物归交付中心那一路。
   */
  replicaLines?: ReplicaLine[];
}) {
  const built = useMemo(
    () => buildTopologySvg(picks, meta, { columns: 1, highlight: focusDim }),
    [picks, meta, focusDim]
  );

  const instances = built.figures.reduce((n, f) => n + f.replicas, 0) + built.appReplicas;

  /** 焦点排：应用 + 每个带形态的零件，点一下 → 图上对应框亮 */
  const focusRows = [
    { id: 'app', name: '应用服务', reps: built.appReplicas },
    ...built.figures.map((f) => ({ id: f.dimId, name: f.dimName, reps: f.replicas })),
  ];

  return (
    <section
      className="panel overflow-hidden"
      data-topology-preview=""
      data-topology-preview-source="buildTopologySvg"
    >
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
        <p
          className="mono text-[10px] leading-[15px] text-fgFaint"
          data-topology-preview-instances={instances}
        >
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

      {/* ── 焦点排：点谁、图上谁的框亮（反过来台上调谁，这里也跟着亮） ── */}
      <div className="border-t border-line px-4 py-2.5" data-topology-focus-list="">
        <p className="text-[10px] leading-[15px] text-fgFaint">
          点一项，图上对应那个框亮起来 —— 台上调哪一项，这里也自动亮哪一项。
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {focusRows.map((r) => {
            const on = focusDim === r.id;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onFocus?.(r.id)}
                data-topology-focus={r.id}
                aria-pressed={on}
                className="mono rounded-md border px-2 py-1 text-[10px] leading-[14px] transition-colors"
                style={{
                  borderColor: on ? toneAt('warn', 0.6) : INK.line,
                  background: on ? toneAt('warn', 0.12) : 'transparent',
                  color: on ? TONE.warn.color : INK.muted,
                }}
              >
                {r.name} ×{r.reps}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Helm 联动：图上的数字落在产物的哪一行 ──
          这些行是**从生成的部署文件里抽出来的**，不是照着格式背一遍 ——
          产物换了模板，这里跟着变；抽不到就是这套选型没有副本数的落点。 */}
      <div className="border-t border-line px-4 py-2.5" data-topology-replica-lines="">
        <p className="text-[10px] leading-[15px] text-fgFaint">
          上面这些副本数写进了产物的这几行（从导出包里抽出来的原文）：
        </p>
        {replicaLines.length === 0 ? (
          <p className="mt-1.5 text-[10px] leading-[15px] text-fgMuted">
            当前选型没有 K8s / Helm / compose 产物 —— 副本数还没有落点，先去 ⑧ 交付与运行
            里表态「部署形态 / 编排方式」。
          </p>
        ) : (
          <ul className="mt-1.5 space-y-0.5">
            {replicaLines.map((l, i) => (
              <li
                key={`${l.file}-${i}`}
                className="flex flex-wrap items-baseline gap-x-2 text-[10px] leading-[15px]"
                data-replica-line=""
              >
                <code className="mono text-fgFaint">{l.file}</code>
                <code className="mono" style={{ color: TONE.warn.color }}>
                  {l.line}
                </code>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
