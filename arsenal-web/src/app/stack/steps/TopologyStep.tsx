'use client';

import { useRef, useState } from 'react';
import { dimensionById } from '@/lib/stack';
import { nodeArch } from '@/lib/arch';
import {
  PARAM_SPECS,
  estimateCapacity,
  paramIsSet,
  paramValue,
  topologyChoices,
  topologySpecOf,
} from '@/lib/topology';
import { topologyFlowOf } from '@/lib/topology-flows';
import type { StackPicksMeta } from '@/lib/topology';
import type { StackPicks } from '@/lib/content-types';
import { STEP_BY_ID } from '../wizard';
import TopologyPicker from '../TopologyPicker';
import TopologyLab from '../TopologyLab';
import DimPicker, { type DimFlag } from '../DimPicker';
import StepShell from './StepShell';

/**
 * ⑥ 部署形态 —— 只对**已经装上的零件**问「几个实例、怎么摆」。
 *
 * 这一步的收敛关系最硬：没装的零件没有形态可言，所以这里不列它。
 * 33 个槽位里常见只有六七个有形态表（数据库、缓存、MQ、应用本身……），
 * 于是这一步比「在一屏里同时管 33 格 + 五根滑杆」短得多。
 *
 * 五根滑杆全部写进 `meta.params`，产物侧一律从 `paramValue()` 读 ——
 * 页面上滑到 5，K8s 清单里就是 5，中间没有第二条路径。
 * 「应用副本数」的哨兵值（未设 = fallback 0）用 `paramIsSet()` 判，
 * 直接拿 0 当输入值会算出「0 副本」（V2-12 事故）。
 *
 * 机理台（2026-09-27）：形态卡上的「▷ 看机理」把 (维度, 选项, 形态) 记进
 * `labTarget` 并展开底部折叠区。**默认收起** —— ⑥ 已有形态卡 + 五根滑杆 +
 * 容量摘要，动画面板常开会把表单挤没；收起时只有一行入口提示。
 */
export default function TopologyStep({
  picks,
  meta,
  dimFlags,
  onTopology,
  onParam,
  onPick,
  onClear,
  onFocus,
  activeDim,
}: {
  picks: StackPicks;
  meta: StackPicksMeta;
  /** 问题槽位标记（与 ②③ 同一形状、同一份数据） */
  dimFlags?: Record<string, DimFlag>;
  onTopology: (dimId: string, modeId: string) => void;
  onParam: (key: string, value: number) => void;
  onPick: (dimId: string, optId: string) => void;
  onClear: (dimId: string) => void;
  /**
   * 把「当前在调哪一项」报给右栏形态图（'app' 或维度 id）。
   * 可选是故意的：这一步在别处被复用时不传也一样能跑，只是图上没有高亮。
   */
  onFocus?: (target: string) => void;
  /** focusDim 链路：点阵/台面点进来的槽位（本页短，只高亮不滚动） */
  activeDim?: string | null;
}) {
  const spec = STEP_BY_ID.get('topology')!;
  const capacity = estimateCapacity(picks, meta);

  const clusterDim = dimensionById.get('clustertopology');
  const webDim = dimensionById.get('web');

  /** 已装、且该零件/维度声明了形态表的槽位 —— 没装的不问形态。
   *  `web`（应用运行时）单独在上面那块定，不混进零件列表。 */
  const shapeable = Object.keys(picks)
    .filter((dimId) => {
      const optId = picks[dimId];
      if (!optId || optId === 'none') return false;
      const opt = dimensionById.get(dimId)?.options.find((o) => o.id === optId);
      return !!topologySpecOf(dimId, opt ?? null);
    })
    .filter((dimId) => dimId !== 'clustertopology' && dimId !== 'web');

  // ── 机理台：默认收起（labOpen 初始 false），点了「▷ 看机理」才展开 ──
  const [labTarget, setLabTarget] = useState<{ dimId: string; optId: string; modeId: string } | null>(
    null
  );
  const [labOpen, setLabOpen] = useState(false);
  const labRef = useRef<HTMLElement | null>(null);
  const openLab = (dimId: string, modeId: string) => {
    const dim = dimensionById.get(dimId);
    const opt = dim?.options.find((o) => o.id === picks[dimId]) ?? null;
    if (!dim || !opt) return;
    setLabTarget({ dimId, optId: opt.id, modeId });
    setLabOpen(true);
    requestAnimationFrame(() => labRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };
  const labFlow = labTarget ? topologyFlowOf(labTarget.dimId, labTarget.optId, labTarget.modeId) : null;
  const labTitle = (() => {
    if (!labTarget) return '';
    const dim = dimensionById.get(labTarget.dimId);
    const opt = dim?.options.find((o) => o.id === labTarget.optId) ?? null;
    const modeLabel = topologyChoices(labTarget.dimId, opt, meta).find(
      (c) => c.mode.id === labTarget.modeId
    )?.mode.label;
    return [dim?.name, opt?.name, modeLabel].filter(Boolean).join(' · ');
  })();

  return (
    <StepShell spec={spec}>
      <div className="space-y-3 p-4">
        {/*
          应用整体形态 —— 两层，缺一层都会「选了多副本集群，清单里还是 1 副本」：
            ① `clustertopology` 维度：全局可用性立场（单机 / 主备 / 多副本集群 /
               分片集群 / 异地多活）。它本身**没有形态表**，形态就是它的选项。
            ② `web` 维度的形态表（单实例 1 / 多副本 3 / 灰度 2）：**应用副本数**
               真正的数字来源 —— `appReplicas()` 先读它，读不到才退回 1。
          只放 ① 的话副本数不会变；只放 ② 的话「高可用集群」这个立场没有落点。
        */}
        <section className="rounded-md border border-line">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-4 pt-3">
            <span className="mono text-[12px] leading-none text-brass">⋮</span>
            <h3 className="text-[12px] font-semibold leading-[18px] text-fg">应用整体形态</h3>
            <p className="min-w-0 flex-1 text-[10px] leading-[15px] text-fgFaint">
              先定可用性立场，再定应用跑几个副本 —— 下面每一项的副本数都在此基础上算。
            </p>
          </div>
          {clusterDim && (
            <DimPicker
              dim={clusterDim}
              picks={picks}
              flag={dimFlags?.[clusterDim.id]}
              highlight={activeDim === clusterDim.id}
              // 全局可用性立场改的是**应用**那张卡 —— 焦点推给 app
              onPick={(dimId, optId) => {
                onFocus?.('app');
                onPick(dimId, optId);
              }}
              onClear={onClear}
            />
          )}
          {webDim && (
            <div className="border-t border-line px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                <h4 className="text-[12px] font-semibold leading-[18px] text-fg">
                  {webDim.name} · 副本画法
                </h4>
                <span className="text-[10px] leading-[15px] text-fgFaint">
                  这里点几副本，K8s 的 replicas / PDB 与形态图的叠层就是几个 —— 同一个数字
                </span>
              </div>
              <TopologyPicker
                dimId="web"
                option={webDim.options.find((o) => o.id === picks.web) ?? null}
                picks={picks}
                meta={meta}
                onPick={(dimId, modeId) => {
                  onFocus?.('app');
                  onTopology(dimId, modeId);
                }}
                onExplain={openLab}
              />
            </div>
          )}
        </section>

        {/* ── 逐个零件定形态 ── */}
        {shapeable.length === 0 ? (
          <p className="rounded-md border border-line bg-surface px-4 py-3 text-[10px] leading-[15px] text-fgFaint">
            当前还没有任何零件声明了部署形态 —— 回到 ③ 主题框架 / ④ 分层装配装上数据库、
            缓存、消息队列这类组件，它们才会出现在这里。
          </p>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {shapeable.map((dimId) => {
              const dim = dimensionById.get(dimId);
              const opt = dim?.options.find((o) => o.id === picks[dimId]);
              if (!dim || !opt) return null;
              return (
                <section key={dimId} data-topo-dim={dimId} className="rounded-md border border-line">
                  <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-4 pt-3">
                    <h3 className="text-[12px] font-semibold leading-[18px] text-fg">{dim.name}</h3>
                    <span className="text-[11px] leading-[16px] text-fgMuted">{opt.name}</span>
                    {nodeArch[dimId]?.role && (
                      <span className="mono text-[10px] leading-[15px] text-fgFaint">
                        {nodeArch[dimId]?.role}
                      </span>
                    )}
                  </div>
                  <TopologyPicker
                    dimId={dimId}
                    option={opt}
                    picks={picks}
                    meta={meta}
                    onPick={(dimId, modeId) => {
                      onFocus?.(dimId);
                      onTopology(dimId, modeId);
                    }}
                    onExplain={openLab}
                  />
                </section>
              );
            })}
          </div>
        )}

        {/* ── 五根滑杆 ── */}
        <section className="rounded-md border border-line px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <h3 className="text-[12px] font-semibold leading-[18px] text-fg">容量参数</h3>
            <p className="min-w-0 flex-1 text-[10px] leading-[15px] text-fgFaint">
              每一根都写清了它会落到产物的哪个位置 —— 不写清去处的滑杆等于在滑空气。
            </p>
          </div>
          <div className="mt-2.5 grid gap-x-6 gap-y-3 lg:grid-cols-2">
            {PARAM_SPECS.map((s) => {
              const set = paramIsSet(meta, s.key);
              const v = paramValue(meta, s.key);
              return (
                <div key={s.key} data-param={s.key}>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[11px] font-medium leading-[16px] text-fg">
                      {s.label}
                    </span>
                    <span className="mono text-[10px] leading-[15px] text-fgFaint">
                      {s.min}–{s.max}
                      {s.unit}
                    </span>
                    <span className="mono ml-auto text-[11px] leading-[16px] text-brass">
                      {set ? v : '—'}
                      {set && s.unit}
                    </span>
                    {set && (
                      <span className="mono text-[10px] leading-[15px] text-fgFaint">已设</span>
                    )}
                  </div>
                  <input
                    type="range"
                    min={s.min}
                    max={s.max}
                    step={s.step}
                    value={v}
                    onChange={(e) => {
                      // 容量滑杆改的是应用侧的副本与资源 —— 焦点推回 app 那张卡
                      onFocus?.('app');
                      onParam(s.key, Number(e.target.value));
                    }}
                    aria-label={s.label}
                    className="mt-1 w-full accent-brass"
                  />
                  <p className="text-[10px] leading-[15px] text-fgFaint">{s.impact}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── 容量摘要 ── */}
        <section className="rounded-md border border-line px-4 py-3">
          <h3 className="text-[12px] font-semibold leading-[18px] text-fg">这样摆之后的账</h3>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
            {[
              { k: '应用副本', v: `${capacity.appReplicas} 个`, n: capacity.replicasSource === 'override' ? '滑杆设定' : '按形态推导' },
              { k: '每实例堆', v: `${capacity.heapMb} MB`, n: '堆外按 512MB 计' },
              { k: '应用内存合计', v: `${capacity.appMemoryMb} MB`, n: '副本 × (堆 + 堆外)' },
              { k: '连接池上限', v: `${capacity.poolSize}`, n: '每实例' },
              { k: '压到库上的连接', v: `${capacity.dbConnections}`, n: '副本 × 池上限' },
              { k: '入口可承受 QPS', v: `${capacity.totalQps}`, n: '限流阈值 × 副本' },
            ].map((r) => (
              <div key={r.k}>
                <p className="text-[10px] leading-[15px] text-fgFaint">{r.k}</p>
                <p className="mono text-[12px] font-semibold leading-[18px] text-fg">{r.v}</p>
                <p className="text-[10px] leading-[15px] text-fgFaint">{r.n}</p>
              </div>
            ))}
          </div>
        </section>
        {/* ── 机理台：默认收起，「▷ 看机理」点了才展开 ── */}
        <section ref={labRef} data-topology-lab className="rounded-md border border-line">
          <button
            type="button"
            data-topology-lab-toggle
            aria-expanded={labOpen}
            onClick={() => setLabOpen((o) => !o)}
            className="flex w-full flex-wrap items-baseline gap-x-2.5 gap-y-1 px-4 py-3 text-left"
          >
            <span className="mono text-[12px] leading-none text-brass">▷</span>
            <h3 className="text-[12px] font-semibold leading-[18px] text-fg">机理台</h3>
            <span className="min-w-0 flex-1 text-[10px] leading-[15px] text-fgFaint">
              {labOpen
                ? '按步播放所选形态的机理：数据怎么查 / 怎么存 / 挂了怎么办'
                : '在上方形态卡上点「▷ 看机理」，这里按步播放该形态的机理动画（默认收起，不占表单空间）'}
            </span>
            <span className="mono text-[10px] leading-[15px] text-fgFaint">{labOpen ? '收起' : '展开'}</span>
          </button>
          {labOpen && (
            <div className="border-t border-line p-4">
              {labFlow && labTarget ? (
                <TopologyLab flow={labFlow} title={labTitle} />
              ) : (
                <p className="text-[10px] leading-[15px] text-fgFaint">
                  这个形态还没有机理剧本。「▷ 看机理」按钮只会出现在已写剧本的形态上
                  （当前已覆盖：缓存 · Redis 的单实例与主从）—— 没写的就是没有，不放空壳面板。
                </p>
              )}
            </div>
          )}
        </section>
      </div>
    </StepShell>
  );
}
