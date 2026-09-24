'use client';

import { topologyChoices, topologyModeSvg, topologyPalette, paramValue } from '@/lib/topology';
import type { StackOption, StackPicks } from '@/lib/content-types';

/**
 * 集群形态选择器 —— **图形化，不是下拉框**。
 *
 * 形态这件事的文字描述（「三节点组复制」）读起来都差不多，一眼看不出区别；
 * 画成图就一眼分得清：「一个框」和「三个框 + 一条环」是两种东西。
 *
 * 迷你图与「集群形态图」预览里的画法**共用同一个函数**（`topologyModeSvg`），
 * 所以不会出现「选的时候画三个框、预览里画成两个」这种两处各画一套的经典事故。
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
}: {
  dimId: string;
  option: StackOption | null | undefined;
  picks: StackPicks;
  meta: { topology: Record<string, string>; params: Record<string, Record<string, number>> };
  onPick: (dimId: string, modeId: string) => void;
}) {
  const choices = topologyChoices(dimId, option, meta);
  if (!choices.length || !option || option.id === 'none') return null;

  const p = topologyPalette('dark');
  const shardHint = paramValue(meta, 'shardCount');

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
              borderColor: active ? 'rgba(217,164,65,0.65)' : '#243029',
              background: active ? 'rgba(217,164,65,0.09)' : 'transparent',
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
              style={{ color: active ? '#D9A441' : '#93A39C' }}
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

      {choices.length > 0 && (
        <p className="mt-2 text-[10px] leading-[15px] text-fgFaint">
          当前选择里，<span className="mono">{picks[dimId]}</span> 这一档的可选形态就是上面这些 ——
          换一档零件，可选形态跟着换（本地缓存没有「主从」这个概念）。
        </p>
      )}
    </div>
  );
}
