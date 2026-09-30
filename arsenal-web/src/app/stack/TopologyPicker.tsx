'use client';

import { topologyChoices, topologyModeSvg, topologyPalette, paramValue } from '@/lib/topology';
import { hasTopologyFlow } from '@/lib/topology-flows';
import type { StackOption, StackPicks } from '@/lib/content-types';
import { TONE, INK, toneAt } from './palette';

/**
 * 集群形态选择器 —— **图形化，不是下拉框**。
 *
 * 形态这件事的文字描述（「三节点组复制」）读起来都差不多，一眼看不出区别；
 * 画成图就一眼分得清：「一个框」和「三个框 + 一条环」是两种东西。
 *
 * 迷你图与「集群形态图」预览里的画法**共用同一个函数**（`topologyModeSvg`），
 * 所以不会出现「选的时候画三个框、预览里画成两个」这种两处各画一套的经典事故。
 *
 * 「▷ 看机理」按钮（2026-09-27）：只为**有机理剧本**的形态出现
 * （`hasTopologyFlow()` 判据只有一份）—— 剧本没写的形态不出现按钮，如实空态，
 * 不放一个点了会显示空白面板的假入口。按钮本身不带形态选择行为：
 * 它回调 `onExplain(modeId)`，面板归属在 TopologyStep 的底部折叠区（默认收起）。
 *
 * 这里的选中态只写 `meta.topology[dimId]`，产物侧一律从 `resolveTopology()` 读 ——
 * 页面上点一下，K8s 的 replicas、Helm 的 replicaCount、形态图的框数同时跟着变。
 */
export default function TopologyPicker({
  dimId,
  option,
  picks,
  meta,
  onPick,
  onExplain,
}: {
  dimId: string;
  option: StackOption | null | undefined;
  picks: StackPicks;
  meta: { topology: Record<string, string>; params: Record<string, Record<string, number>> };
  onPick: (dimId: string, modeId: string) => void;
  /** 形态卡下方「▷ 看机理」的回调；不传 = 这一处选择器不提供机理台入口 */
  onExplain?: (dimId: string, modeId: string) => void;
}) {
  const choices = topologyChoices(dimId, option, meta);
  if (!choices.length || !option || option.id === 'none') return null;

  const p = topologyPalette('dark');
  const shardHint = paramValue(meta, 'shardCount');
  const explainable = onExplain
    ? choices.filter(({ mode }) => hasTopologyFlow(dimId, option.id, mode.id))
    : [];

  return (
    <div className="border-t border-line px-4 py-3">
      <div className="mb-2 flex items-baseline gap-2">
        <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">部署形态</p>
        <span className="text-[10px] text-fgFaint">
          点图示切换 —— 形态会写进副本数与交付清单
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {choices.map(({ mode, active }) => (
          <button
            key={mode.id}
            type="button"
            onClick={() => onPick(dimId, mode.id)}
            title={mode.note ?? mode.label}
            className="w-[120px] rounded-md border px-1.5 pb-1.5 pt-1 text-left transition-colors"
            style={{
              borderColor: active ? toneAt('warn', 0.65) : INK.line,
              background: active ? toneAt('warn', 0.09) : 'transparent',
            }}
          >
            <svg
              viewBox="0 0 304 94"
              width="100%"
              height={34}
              preserveAspectRatio="xMidYMid meet"
              aria-label={mode.label}
              dangerouslySetInnerHTML={{
                __html: topologyModeSvg(mode.id, mode.replicas, 0, 0, 304, 94, p, shardHint),
              }}
            />
            <span
              className="mt-0.5 flex items-baseline gap-1 text-[10px] font-medium leading-none"
              style={{ color: active ? TONE.warn.color : INK.muted }}
            >
              {mode.label}
              <span className="mono text-[10px] opacity-70">×{mode.replicas}</span>
            </span>
            {mode.note && (
              <span className="mt-1 block text-[10px] leading-[15px] text-fgFaint">{mode.note}</span>
            )}
          </button>
        ))}
      </div>

      {explainable.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {explainable.map(({ mode }) => (
            <button
              key={mode.id}
              type="button"
              data-topology-explain={mode.id}
              onClick={() => onExplain?.(dimId, mode.id)}
              className="rounded border border-line px-1.5 py-0.5 text-[10px] leading-[15px] text-fgMuted transition-colors hover:border-brass hover:text-brass"
            >
              ▷ 看机理 · {mode.label}
            </button>
          ))}
        </div>
      )}

      {choices.length > 0 && (
        <p className="mt-2 text-[10px] leading-[15px] text-fgFaint">
          当前选择里，<span className="mono">{picks[dimId]}</span> 这一档的可选形态就是上面这些 ——
          换一档零件，可选形态跟着换（本地缓存没有「主从」这个概念）。
        </p>
      )}
    </div>
  );
}
