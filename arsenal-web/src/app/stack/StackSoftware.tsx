'use client';

import { Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { arch, lanes, nodeArch, skeletonPicks, slotsOfLane } from '@/lib/arch';
import { dimensions, emptyPicks } from '@/lib/stack';
import SlotBlock from './SlotBlock';
import type { SlotWeight } from './SlotBlock';
import { SlotWire, WireLayer } from './WireLayer';
import StepShell from './steps/StepShell';
import ProjectStep from './steps/ProjectStep';
import BaseStep from './steps/BaseStep';
import ThemeStep from './steps/ThemeStep';
import StackDeck from './StackDeck';
import JourneyBar from './JourneyBar';
import StepRail from './StepRail';
import useStackChannel, { findOption, slotHint } from './useStackChannel';
import {
  FLOW_BY_ID,
  FLOWS,
  PAGE_OF_STEP,
  STEP_BY_ID,
  STEP_ROUTES,
  flowFilled,
  flowOfLane,
  stepOfDim,
  type StepId,
} from './wizard';
import { TONE, INK, toneAt, gloss } from './palette';

/**
 * ① 选型台 —— `/stack`。
 *
 * 装配台四页的第一页，承载软件架构段四步（① 项目定义 ② 技术栈基底
 * ③ 主题框架 ④ 分层装配）。④ 的台面（33 槽位泳道图）与「点阵点击直达」
 * 共用同一个 benchRef，所以留在这一页内不往外搬。
 *
 * `/stack` 就是选型台本体，**不重定向** —— 恢复出来的步骤若不在本页，
 * 由 `useStackChannel` 把那一步拉回本页首步。
 */
export default function StackSoftware({ pinnedStep }: { pinnedStep?: StepId }) {
  const ch = useStackChannel('software', pinnedStep);
  const router = useRouter();
  const {
    picks, baseId, setBaseId, activeDim, setActiveDim, audit, hazardsByDim, dimFlags,
    benchFlow, setBenchFlow, flowOn, setFlowOn, query, setQuery, dimFilter, setDimFilter,
    visibleDims, presetId, projectName, setProjectName, step, setStep, stepSummary,
    stepIssues, nameOk, benchRef, hist, snapRef, applyPicks, applyShape, pick, clear,
  } = ch;

  /**
   * 点阵点击直达。**先切到槽位所在的步骤再聚焦** ——
   * 结论条上的点阵是常驻的，交付件配在 ⑧ 交付与运行（台面上没有交付泳道的
   * 格子，硬切 ④ 就是「点了没反应」—— 09-28 反馈的最初形态），其余在 ④ 台面。
   * P0 四页之后：目标步骤不在本页时顺手把页也换了。
   */
  function focusDim(dimId: string) {
    const target = stepOfDim(dimId) ?? 'layers';
    setStep(target);
    setActiveDim(dimId);
    // 单流才切流对准（09-28 反馈）
    const flow = benchFlow === 'all' ? null : flowOfLane(nodeArch[dimId]?.lane ?? '');
    if (flow) setBenchFlow(flow.id);
    requestAnimationFrame(() => {
      benchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    const home = PAGE_OF_STEP[target];
    // 跨页直达落到**步骤路由**（/stack/step/<id>）而不是页路由：新页把这一步钉死，
    // 侧边栏细分子项也正好点亮那一步。目标在本页时不 push —— push 会重挂载，
    // 台面聚焦 / 搜索词 / 撤销栈这些瞬时态全丢（所以同页一律就地 setStep）。
    if (home !== '/stack') router.push(STEP_ROUTES[target]);
  }

  /** 本页四步的渲染内容 */
  function renderStep() {
    switch (step) {
      case 'project':
        return (
          <ProjectStep
            name={projectName}
            onName={setProjectName}
            shapeId={presetId ?? ''}
            onShape={applyShape}
            dimTotal={dimensions.length}
          />
        );
      case 'base':
        return (
          <BaseStep
            baseId={baseId}
            onBase={(id) => {
              hist.record(snapRef.current);
              setBaseId(id);
            }}
            picks={picks}
            dimFlags={dimFlags}
            onPick={pick}
            onClear={clear}
            activeDim={activeDim}
          />
        );
      case 'theme':
        return (
          <ThemeStep
            picks={picks}
            dimFlags={dimFlags}
            onPick={pick}
            onClear={clear}
            activeDim={activeDim}
          />
        );
      case 'layers':
        return renderBench();
      default:
        return null;
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="sr-only">架构装配台 · 选型台</h1>
      {/* ── 顶部：这套组合能不能跑（S1-5 闭环仪表）—— 四页常驻 ── */}
      <StackDeck ch={ch} focusDim={focusDim} />
      <JourneyBar current="software" picks={picks} />
      <StepRail
        page="software"
        step={step}
        onStep={ch.setStep}
        summary={stepSummary}
        issues={stepIssues}
        canAdvance={nameOk}
        blockedHint={nameOk ? undefined : '先给项目起个名字（小写字母 + 点分段）—— 它要写进 pom 的 artifactId、application.yml 与 K8s 应用名。'}
      />
      {renderStep()}
      {/* ── 说明：这张图怎么读 ─────────────────────────────── */}
      <section className="panel px-4 py-3.5">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
          <h3 className="text-2xs font-semibold text-fg">这张图怎么读</h3>
          <p className="text-[10px] leading-[15px] text-fgMuted">
            每个方块声明它<strong className="font-medium text-fg">提供</strong>什么能力、需要什么能力。
            校验就是把所有已装配方块提供的能力取并集，看谁的需求没被满足 ——
            没被满足就是缺零件。
            <span className="text-fgFaint">
              　层内用 <span className="mono">→</span> 串起来的是请求真正流经的链路；
              竖线隔开的模块是旁路件，只在发布或构建期起作用，请求不会经过它。
            </span>
          </p>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5">
          {[
            { tone: 'ok', text: '已装配：能力供应正常' },
            { tone: 'bad', text: '红色虚线：必选未装，跑不起来' },
            { tone: 'warn', text: '黄色：参与组合隐患（方块上直接写出是哪条）' },
            { tone: 'idle', text: '灰色虚线：可选项留空，不是错误' },
          ].map((l) => (
            <span key={l.text} className="flex items-center gap-1.5 text-[10px] text-fgFaint">
              <span
                className="inline-block h-[9px] w-[9px] rounded-sm border"
                style={{
                  borderStyle: l.tone === 'ok' || l.tone === 'warn' ? 'solid' : 'dashed',
                  borderColor: TONE[l.tone as keyof typeof TONE].border,
                  background: TONE[l.tone as keyof typeof TONE].soft,
                }}
              />
              {l.text}
            </span>
          ))}
          <span className="ml-auto text-[10px] text-fgFaint">
            {dimensions.length} 块零件 / {lanes.length} 条泳道 / {Object.keys(nodeArch).length}{' '}
            个槽位 / {arch.policies.length} 条组合策略
          </span>
        </div>
      </section>
    </div>
  );

  /**
   * ④ 分层装配 —— 台面（泳道图，全宽），只读校核台。
   *
   * 这是装配台的老资产：33 个槽位按 7 条泳道摆开，点一块直达归属步骤改零件
   * （09-28 八反馈：选件抽屉已退场，④ 不再是选型处）。它留在这一文件里而不是
   * 抽出去，是因为「台面」与「结论条 / 点阵 / 产物区」共用同一批 ref 与回调 ——
   * 拆开要靠 props 传五个 ref，换来的只是一点行数。
   */
  function renderBench() {
    const benchSpec = STEP_BY_ID.get('layers')!;
    const flowSpec = FLOW_BY_ID.get(benchFlow);
    const flowLanes =
      benchFlow === 'all' || !flowSpec
        ? lanes
        : lanes.filter((l) => flowSpec.laneIds.includes(l.id));
    return (
      <StepShell spec={benchSpec}>
        {/* 09-28 八反馈：④ 是只读校核台 —— 看结构、链路、隐患、缺件；
            点卡片直达该槽位归属的步骤去改（一个决定只有一个入口）。
            台面全宽铺开（09-28 四反馈），不再有右侧选件抽屉。 */}
        <div className="space-y-2 p-4">
          {/* ── ④ 流水线选择：一次只看一条流，不把 7 泳道一次铺开 ── */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-surface px-4 py-2">
            <span className="mono mr-1 text-[10px] uppercase leading-[15px] tracking-wider text-fgFaint">
              流水线
            </span>
            {FLOWS.map((f) => {
              const on = benchFlow === f.id;
              const ff = flowFilled(f, picks);
              return (
                <button
                  key={f.id}
                  type="button"
                  data-flow={f.id}
                  aria-pressed={on}
                  onClick={() => setBenchFlow(f.id)}
                  title={f.desc}
                  className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors"
                  style={{
                    borderColor: on ? toneAt('warn', 0.6) : INK.line,
                    background: on ? toneAt('warn', 0.10) : 'transparent',
                    color: on ? TONE.warn.color : INK.muted,
                  }}
                >
                  <span className="mono text-[11px] leading-none">{f.glyph}</span>
                  {f.name}
                  <span className="mono text-[10px] text-fgFaint">{ff.filled}/{ff.total}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-col gap-2 rounded-md border border-line bg-surface px-4 py-2.5 text-[11px] leading-[16px] text-fgMuted">
            {/* 操作提示独占一行：用内联 chip 把五种集群形态摊开，
                避免原句（箭头 + 括号 + 五种形态挤一句）折行后难读。交互不变。 */}
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="mono text-[12px] leading-none text-brass">⊙</span>
              <span className="text-fg">点任意方块</span>
              <span>→ 直达它归属的步骤改零件。这一步是</span>
              <span className="text-fg">只读校核台</span>
              <span>—— 看结构、链路、隐患、缺件；几处实例怎么摆（单实例 / 主从 / 组复制 / 分片 / 云原生）</span>
              <span className="text-fgFaint">在 ⑥ 部署形态一处定，副本数写进清单</span>
            </div>
            {/* S2-4：搜索 + 三档筛选。互斥单选（aria-pressed），再点一次取消；
                与搜索词取交集。命中的卡片正常显示、未命中降噪到 0.28 ——
                聚光灯而不是搬家，泳道空间记忆不丢（顺带守 V2-02：
                输入框 min-w-0 + 外层 flex-wrap，移动端不横向溢出）。 */}
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              <input
                data-dim-search=""
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜维度 / 零件名"
                aria-label="搜索选型维度或零件名"
                className="w-[150px] min-w-0 rounded-md border px-2 py-1 text-[11px] outline-none transition-colors placeholder:text-fgFaint focus:border-brass"
                style={{ borderColor: INK.line, background: 'transparent', color: INK.pale }}
              />
              {(
                [
                  ['unpicked', '未选'],
                  ['hazard', '有隐患'],
                  ['required', '必选'],
                ] as const
              ).map(([key, label]) => {
                const on = dimFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    data-filter-chip={key}
                    aria-pressed={on}
                    onClick={() => setDimFilter(on ? null : key)}
                    className="rounded-md border px-2 py-1 text-[10px] transition-colors"
                    style={{
                      borderColor: on ? toneAt('warn', 0.6) : INK.line,
                      background: on ? toneAt('warn', 0.10) : 'transparent',
                      color: on ? TONE.warn.color : INK.muted,
                    }}
                    title={`只看${label}的槽位；再点一次取消`}
                  >
                    {label}
                  </button>
                );
              })}
              {visibleDims !== null && (
                <span className="mono text-[10px] text-fgFaint">
                  命中 {visibleDims.size}/{dimensions.length}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setFlowOn((v) => !v)}
              aria-pressed={flowOn}
              className="flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] transition-colors"
              style={
                flowOn
                  ? { borderColor: toneAt('warn', 0.6), background: toneAt('warn', 0.12), color: TONE.warn.color }
                  : { borderColor: INK.line, background: 'transparent', color: INK.muted }
              }
              title="把请求真正流经的连线点亮成流动虚线（泳道间的竖线 + 链路上的箭头）；旁路件不亮。再点一次熄灭"
            >
              <span className="mono text-[11px] leading-none">{flowOn ? '⚡' : '⌀'}</span>
              {flowOn ? '链路已点亮' : '点亮请求链路'}
            </button>
            <span className="mx-1 h-[16px] w-px bg-line" />
            <button
              type="button"
              onClick={() => applyPicks(skeletonPicks(), null)}
              className="rounded-md border border-line px-2 py-1 text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
              title="只保留必选模块，其余全部留空 —— 从最小可运行骨架开始搭"
            >
              只留必选
            </button>
            <button
              type="button"
              onClick={() => applyPicks(emptyPicks(), null)}
              className="rounded-md border border-line px-2 py-1 text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
              title="拆到一块不剩，从零开始拼"
            >
              清空重搭
            </button>
          </div>
          {/* 台面（L0）：34px 网格底 + 比 surface 暗一档的底色。
              泳道面板（L1）浮在台面上、零件卡（L2）浮在面板上 ——
              三层深度全部靠底色差与边框表达，不引进第二种配色。 */}
          <div ref={benchRef} className="stack-bench scroll-mt-4 space-y-1.5 rounded-lg border border-line p-1.5 sm:p-2">
            {flowLanes.map((lane, laneIdx) => {
              const slotIds = slotsOfLane(lane.id);
              /** 参与请求链路的槽位顺序；其余槽位是旁路件（如迁移工具） */
              const pipelineOrder = arch.pipelines[lane.id] ?? [];
              const filledCount = slotIds.filter((id) => picks[id]).length;
              return (
                <Fragment key={lane.id}>
                  {laneIdx > 0 && (
                    <div className="flex items-center gap-2 py-0.5 pl-[15px] sm:pl-[17px]">
                      <WireLayer flowOn={flowOn} />
                      <span className="mono text-[10px] uppercase leading-[15px] tracking-wider text-fgFaint">
                        请求向下穿过
                      </span>
                    </div>
                  )}
                  <section data-lane={lane.id} className="panel flex overflow-hidden">
                    {/* 泳道标签列（竖轴）：固定 30/34px，不随卡片换行移动。
                        原来表头横排在顶部，七根泳道看不出「上下穿过」的先后。 */}
                    <div
                      className="flex w-[30px] shrink-0 flex-col items-center gap-2 border-r border-line py-2.5 sm:w-[34px]"
                      style={{ background: gloss(0.015) }}
                    >
                      <span className="mono text-[13px] leading-none text-brass">{lane.glyph}</span>
                      <span
                        className="text-[11px] font-semibold leading-[16px] tracking-[0.18em] text-fgMuted"
                        style={{ writingMode: 'vertical-rl' }}
                      >
                        {lane.name}
                      </span>
                      <span className="mono mt-auto text-[10px] leading-[15px] text-fgFaint">
                        {filledCount}/{slotIds.length}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2">
                        {/* 泳道名已经画在左侧竖轴上了，这里只留语义化的标题（sr-only），
                            免得同一行出现两遍「接入层」—— 视觉读一遍、竖轴读一遍。 */}
                        <h3 className="sr-only">{lane.name}</h3>
                        {pipelineOrder.length > 0 && (
                          <span className="mono rounded-sm border border-line px-1 text-[10px] leading-[15px] text-fgFaint">
                            请求链路 {pipelineOrder.length} 环
                          </span>
                        )}
                        <p className="ml-auto hidden max-w-[62%] text-right text-[10px] leading-[15px] text-fgFaint lg:block">
                          {lane.desc}
                        </p>
                      </header>
                      <div className="flex min-w-0 flex-wrap items-stretch gap-x-1.5 gap-y-2 px-3 py-3">
                        {slotIds.map((dimId) => {
                          const pipedIdx = pipelineOrder.indexOf(dimId);
                          const inPipeline = pipedIdx >= 0;
                          /** 权重三档（方案 §2.4）：链路上的核心件最宽，
                              同泳道有链路却不在链路上的是旁路件，最窄。 */
                          const weight: SlotWeight =
                            inPipeline ? 'core'
                              : pipelineOrder.length > 0 ? 'bypass'
                                : 'regular';
                          return (
                            <span key={dimId} className="flex shrink-0 items-stretch">
                              {/* 箭头与方块绑在同一个 flex item 里 —— 否则窄屏换行时
                                  箭头会被留在上一行末尾，指向一个不存在的东西。
                                  S1-4：字符箭头换 SVG（SlotWire），点亮时随链路流动。 */}
                              {inPipeline && pipedIdx > 0 && <SlotWire flowOn={flowOn} />}
                              {/* 旁路件：不在请求链路上，用一条竖线隔开 */}
                              {!inPipeline && pipelineOrder.length > 0 && (
                                <span
                                  className="mx-1.5 w-px self-stretch bg-lineHi"
                                  title="旁路件：不参与请求处理，在发布/构建期起作用"
                                />
                              )}
                              <SlotBlock
                                dimId={dimId}
                                state={audit.slotStates[dimId] ?? 'empty'}
                                option={picks[dimId] ? findOption(dimId, picks[dimId]) : undefined}
                                hazards={hazardsByDim[dimId]}
                                active={activeDim === dimId}
                                weight={weight}
                                dimmed={activeDim !== null && activeDim !== dimId}
                                hint={slotHint(dimId, picks[dimId])}
                                onClick={() => focusDim(dimId)}
                                muted={visibleDims !== null && !visibleDims.has(dimId)}
                              />
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </section>
                </Fragment>
              );
            })}
          </div>
        </div>
      </StepShell>
    );
  }
}
