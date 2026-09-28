'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  buildTechArch,
  buildTechArchSvg,
  emptyEdits,
  CANVAS_THEME_OPTIONS,
  CANVAS_VIEWS,
  type CanvasTheme,
  type TechArch,
} from '@/lib/arch-canvas';
import { arch, capLabel, STATUS_META } from '@/lib/arch';
import type { ArchAudit, ArchGap } from '@/lib/arch';
import { buildArchDiagram, archDiagramMermaid, toResponsiveSvg } from '@/lib/arch-diagram';
import { dimensions } from '@/lib/stack';
import {
  buildExportPlan,
  filterTree,
  formatBytes,
  projectDoc,
  treeStats,
  type TreeNode,
} from '@/lib/project';
import { buildDeployPlan } from '@/lib/deploy';
import {
  buildTopologySvg,
  estimateCapacity,
  nodeTopologyMap,
  PARAM_SPECS,
  paramIsSet,
  paramValue,
  type StackPicksMeta,
} from '@/lib/topology';
import { buildArchifyIr } from '@/lib/archify-ir';
import { deliverArchify } from '@/lib/arsenal-api';
import type { ComposedStack, StackPicks } from '@/lib/content-types';
import { TONE } from './palette';
import ProgressRing from './ProgressRing';
import { STEP_BY_ID, groupOfDim, stepOfDim } from './wizard';

/**
 * 动态交付台 —— 装配台的右半边。
 *
 * 与左边（选零件）的分工：**左边回答「装了什么」，这里回答「装完长什么样」**。
 * 九块预览全部是算出来的，不是抄来的：改一个选项、换一个形态、拉一根滑杆，
 * 右侧立刻换一张图。九块共用同一份 `picks + meta`，所以不存在
 * 「清单里 5 副本、图上画 2 个」这种两处各算一遍才会出现的分歧。
 *
 * 每张图右上角四个动作 —— 复制 SVG / 下载 PNG / 复制 Mermaid / 送 Archify 出 HTML。
 * 「用户方便地选中了哪一块内容，就能拿到对应的图」是这四颗按钮的全部意义。
 */

type DeckTab =
  | 'overview' | 'deps' | 'arch' | 'topology' | 'flow'
  | 'tree' | 'manifest' | 'risk' | 'capacity';

const DECK_TABS: { id: DeckTab; glyph: string; label: string }[] = [
  { id: 'overview', glyph: '◍', label: '总览' },
  { id: 'deps', glyph: '⇄', label: '依赖图' },
  { id: 'arch', glyph: '⬢', label: '架构图' },
  { id: 'topology', glyph: '⋮', label: '形态图' },
  { id: 'flow', glyph: '↦', label: '链路' },
  { id: 'tree', glyph: '▦', label: '目录树' },
  { id: 'manifest', glyph: '▤', label: '清单' },
  { id: 'risk', glyph: '⚠', label: '隐患' },
  { id: 'capacity', glyph: '▥', label: '容量' },
];

/** 交付图三态（`dark` / `light` 是屏幕态，交付物的默认是 `doc`） */
const DELIVERY_THEMES = CANVAS_THEME_OPTIONS;

export default function DeliveryDeck({
  picks,
  meta,
  audit,
  composed,
  baseId,
  onParam,
  focusTab,
  onFocusConsumed,
}: {
  picks: StackPicks;
  meta: StackPicksMeta;
  audit: ArchAudit;
  composed: ComposedStack;
  /** 技术栈基底 id —— 决定这里导出的 pom parent / gradle 插件版本 */
  baseId: string;
  onParam: (key: string, value: number) => void;
  /**
   * 外部请求切到的页签（S2-7：产物区的架构图/隐患页签砍掉后，
   * 「看架构图」这类入口改走右栏）。null = 没有待处理请求。
   */
  focusTab?: DeckTab | null;
  onFocusConsumed?: () => void;
}) {
  const [tab, setTab] = useState<DeckTab>('overview');
  const [theme, setTheme] = useState<CanvasTheme>('doc');
  const [controlPlane, setControlPlane] = useState(false);
  const [lean, setLean] = useState(false);
  const [hd, setHd] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // 外部入口（「看架构图」按钮）请求切页签：切完立刻回报「已消费」，
  // 否则同一个值来两次（连点两下按钮）第二次就不生效了。
  useEffect(() => {
    if (!focusTab) return;
    setTab(focusTab);
    onFocusConsumed?.();
  }, [focusTab, onFocusConsumed]);

  const topo = useMemo(() => nodeTopologyMap(picks, meta), [picks, meta]);
  const techArch = useMemo(
    () => buildTechArch(picks, emptyEdits(), { controlPlane, topology: topo }),
    [picks, controlPlane, topo]
  );
  const exportPlan = useMemo(() => buildExportPlan(picks, audit, baseId), [picks, audit, baseId]);
  const deployFiles = useMemo(
    () => buildDeployPlan(picks, composed, { appName: projectDoc.artifactId, meta }),
    [picks, composed, meta]
  );
  const capacity = useMemo(() => estimateCapacity(picks, meta), [picks, meta]);
  const topoBuilt = useMemo(
    () =>
      buildTopologySvg(picks, meta, {
        theme,
        title: `${projectDoc.artifactId} · 集群形态`,
      }),
    [picks, meta, theme]
  );
  const archSvg = useMemo(
    () =>
      buildTechArchSvg(techArch, theme, {
        title: `${projectDoc.artifactId} · 技术架构`,
        subtitle: `${dimensions.length} 个选型维度 / ${techArch.nodes.length} 个节点 / ${
          audit.status === 'runnable' ? '能力闭环' : '尚有缺口'
        }${controlPlane ? ' · 已按控制面/数据面分离' : ''}`,
        bands: theme !== 'doc',
        controlPlane,
        scale: hd ? 1.5 : 1,
        lean,
      }),
    [techArch, theme, controlPlane, hd, lean, audit.status]
  );
  const depsBuilt = useMemo(
    () =>
      buildArchDiagram({
        picks,
        audit,
        title: projectDoc.artifactId,
        subtitle: STATUS_META[audit.status].summary,
        theme: theme === 'doc' ? 'light' : 'dark',
      }),
    [picks, audit, theme]
  );

  const irFor = (title: string) =>
    buildArchifyIr(techArch, {
      title,
      subtitle: `${projectDoc.artifactId} · 由装配台当场算出`,
      locale: 'zh-CN',
      visualPreset: theme === 'blueprint' ? 'blueprint' : 'classic',
    });

  const hazards = audit.blockers.length + audit.gaps.length + audit.risks.length + audit.notes.length;
  const svgSize = readSvgSize(tab === 'deps' ? depsBuilt.svg : archSvg);

  return (
    <section className="panel overflow-hidden">
      {/* ── 页签条 ───────────────────────────────────────── */}
      <header className="hairline-b px-3 py-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <span className="mono text-[10px] uppercase tracking-wider text-fgFaint">交付预览</span>
          <span className="mono text-[10px] text-fgFaint">· 实时</span>
          <span className="ml-auto flex items-center gap-2">
            <span className="mono text-[10px] text-fgFaint">
              {capacity.appReplicas} 副本
              {capacity.replicasSource === 'topology' && '（按形态推导）'} ·{' '}
              {deployFiles.length} 个交付文件
            </span>
            {note && (
              <button
                type="button"
                onClick={() => setNote(null)}
                className="mono max-w-[280px] truncate text-[10px]"
                style={{ color: '#7FA650' }}
                title={note}
              >
                {note}
              </button>
            )}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {DECK_TABS.map((t) => {
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setTab(t.id);
                  setNote(null);
                }}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors"
                style={{
                  background: on ? 'rgba(217,164,65,0.10)' : 'transparent',
                  color: on ? '#D9A441' : '#93A39C',
                }}
              >
                <span className="mono text-[11px] leading-none">{t.glyph}</span>
                {t.label}
                {t.id === 'risk' && hazards > 0 && (
                  <span className="mono text-[10px] text-fgFaint">{hazards}</span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      {/* ── 图区的公共工具条 ─────────────────────────────── */}
      {(tab === 'arch' || tab === 'topology' || tab === 'deps') && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-3 py-2">
          <div className="flex items-center gap-1">
            <span className="mono mr-0.5 text-[10px] uppercase tracking-wider text-fgFaint">主题</span>
            {DELIVERY_THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTheme(t.id)}
                title={t.hint}
                className="mono rounded-sm border px-1.5 py-0.5 text-[10px] transition-colors"
                style={{
                  borderColor: theme === t.id ? 'rgba(217,164,65,0.6)' : '#243029',
                  background: theme === t.id ? 'rgba(217,164,65,0.10)' : 'transparent',
                  color: theme === t.id ? '#D9A441' : '#93A39C',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'arch' && (
            <>
              <Toggle on={controlPlane} onClick={() => setControlPlane((v) => !v)} label="控制面分离" />
              <Toggle on={lean} onClick={() => setLean((v) => !v)} label="文字最少化" />
              <button
                type="button"
                onClick={() => setHd((v) => !v)}
                title="输出像素倍率。viewBox 不变，几何一像素不差"
                className="mono rounded-sm border px-1.5 py-0.5 text-[10px]"
                style={{
                  borderColor: hd ? 'rgba(217,164,65,0.6)' : '#243029',
                  background: hd ? 'rgba(217,164,65,0.10)' : 'transparent',
                  color: hd ? '#D9A441' : '#93A39C',
                }}
              >
                {hd ? '高清 ×1.5' : '原尺寸'}
              </button>
              <span className="mono text-[10px] text-fgFaint">
                {svgSize ? `${svgSize.w}×${svgSize.h}px` : ''}
              </span>
            </>
          )}
        </div>
      )}

      {/* ── 图区 ─────────────────────────────────────────── */}
      <div className="p-3">
        {tab === 'overview' && (
          <Overview audit={audit} capacity={capacity} meta={meta} />
        )}

        {tab === 'deps' && (
          <Diagram
            svg={depsBuilt.svg}
            mermaid={archDiagramMermaid(depsBuilt.model)}
            filename="deps"
            title="依赖关系图"
            ir={() => irFor(`${projectDoc.artifactId} · 依赖关系`)}
            onNote={setNote}
          />
        )}

        {tab === 'arch' && (
          <Diagram
            svg={archSvg}
            mermaid={techArchMermaid(techArch)}
            filename="tech-arch"
            title="技术架构图"
            ir={() => irFor(`${projectDoc.artifactId} · 技术架构`)}
            onNote={setNote}
            caption="① 应用实例看应用卡右上角的 ×N　② 请求从最左侧客户端进　③ 数据落在最右侧数据分区　④ 虚线是异步链路　⑤ 带 ×N 的都是多副本"
          />
        )}

        {tab === 'topology' && (
          <Diagram
            svg={topoBuilt.svg}
            mermaid={topologyMermaid(picks, meta)}
            filename="topology"
            title="集群形态图"
            ir={() => irFor(`${projectDoc.artifactId} · 集群形态`)}
            onNote={setNote}
          />
        )}

        {tab === 'flow' && <FlowBlock picks={picks} audit={audit} />}
        {tab === 'tree' && <TreeBlock picks={picks} />}

        {tab === 'manifest' && (
          <ManifestBlock files={deployFiles} onNote={setNote} />
        )}

        {tab === 'risk' && <RiskBlock audit={audit} />}
        {tab === 'capacity' && <CapacityBlock capacity={capacity} />}
      </div>

      {/* ── 滑杆调参 ─────────────────────────────────────── */}
      <div className="border-t border-line px-3 py-2.5">
        <div className="mb-1.5 flex items-baseline gap-2">
          <span className="mono text-[10px] uppercase tracking-wider text-fgFaint">调参</span>
          <span className="text-[10px] text-fgFaint">
            数值直接落进 yaml 与清单 —— 拉一下，左边清单和右边图同时变
          </span>
        </div>
        <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
          {PARAM_SPECS.map((spec) => {
            const isSet = paramIsSet(meta, spec.key);
            // V2-12：app.replicas 未设时 paramValue 返回哨兵 0，不能当输入值显示。
            // 滑块位置落在按形态推导的当前生效值上，数值显示「—」；拖动即变显式设定
            const unsetReplicas = spec.key === 'replicas' && !isSet;
            const v = unsetReplicas ? capacity.appReplicas : paramValue(meta, spec.key);
            return (
              <label
                key={spec.key}
                className="flex items-center gap-2"
                title={
                  unsetReplicas
                    ? `${spec.impact}\n\n未手动设置：滑块位置是按所选形态推导的当前值，拖动即变为手动设定。`
                    : spec.impact
                }
              >
                <span className="w-[92px] shrink-0 text-[10px] text-fgMuted">{spec.label}</span>
                <input
                  type="range"
                  min={spec.min}
                  max={spec.max}
                  step={spec.step}
                  value={v}
                  onChange={(e) => onParam(spec.key, Number(e.target.value))}
                  className="h-[3px] min-w-0 flex-1 cursor-pointer appearance-none rounded-full"
                  style={{ background: '#243029', accentColor: '#D9A441' }}
                />
                <span className="mono w-[62px] shrink-0 text-right text-[10px]" style={{ color: '#D9A441' }}>
                  {unsetReplicas ? (
                    <span className="text-fgFaint">—</span>
                  ) : (
                    <>
                      {v}
                      <span className="ml-0.5 text-[10px] text-fgFaint">{spec.unit}</span>
                    </>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// 图 + 四动作
// ─────────────────────────────────────────────────────────────

function Diagram({
  svg,
  mermaid,
  filename,
  title,
  ir,
  onNote,
  caption,
}: {
  svg: string;
  mermaid: string;
  filename: string;
  /** 放大查看里显示的中文图名 */
  title: string;
  ir: () => unknown;
  onNote: (s: string | null) => void;
  caption?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Action label="放大查看" onClick={() => setZoomOpen(true)} />
        <Action label="复制 SVG" onClick={() => copy(svg, onNote, 'SVG 已复制')} />
        <Action label="下载 PNG" onClick={() => downPng(svg, filename, onNote)} />
        <Action label="复制 Mermaid" onClick={() => copy(mermaid, onNote, 'Mermaid 已复制')} />
        <Action
          label={busy ? '出图中…' : '送 Archify 出 HTML'}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            onNote(null);
            try {
              const outcome = await deliverArchify(ir());
              if (outcome.kind === 'delivered') {
                downloadText(
                  `${filename}.html`,
                  outcome.html,
                  'text/html;charset=utf-8'
                );
                onNote(
                  `已出图并下载 ${filename}.html —— ${outcome.receipt.checksPassed}/${outcome.receipt.checkCount} 项检查通过，${Math.round(outcome.elapsedMs)}ms`
                );
              } else if (outcome.kind === 'rejected') {
                onNote(
                  `图没过对方构图检查（${outcome.diagnostics.length} 条诊断）：${
                    outcome.diagnostics[0]?.message ?? outcome.error
                  }`
                );
              } else {
                onNote(`出图失败：${outcome.message}`);
              }
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
      <div
        role="button"
        tabIndex={0}
        title="点击放大查看"
        onClick={() => setZoomOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setZoomOpen(true);
          }
        }}
        className="cursor-zoom-in overflow-hidden rounded-md border border-line bg-canvas [&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
        dangerouslySetInnerHTML={{ __html: toResponsiveSvg(svg) }}
      />
      {caption && <p className="mt-2 text-[10px] leading-[15px] text-fgFaint">{caption}</p>}
      {zoomOpen && <Lightbox svg={svg} title={title} onClose={() => setZoomOpen(false)} />}
    </div>
  );
}

/** 倍率的硬边界：小于 25% 看不见字，大于 600% 除了像素没有多出信息 */
function clampZoom(z: number): number {
  return Math.min(6, Math.max(0.25, z));
}

/**
 * 放大查看 —— 全屏滚动区 + 倍率控制。
 *
 * 图是矢量，所以「放大」只是改外层容器的宽度：文字与线条随 viewBox 等比铺开，
 * 不会像位图那样糊，也不会有「按了放大还是那么小」的假放大。
 * 挂到 document.body 上用 portal：免得被外层面板的 overflow / 层叠上下文裁掉。
 *
 * 滚轮只有按住 Ctrl/⌘ 才缩放 —— 否则它老老实实滚页面，不抢用户的手感。
 */
function Lightbox({ svg, title, onClose }: { svg: string; title: string; onClose: () => void }) {
  const size = useMemo(() => readSvgSize(svg), [svg]);
  const [zoom, setZoom] = useState(1);
  const boxRef = useRef<HTMLDivElement>(null);

  /** 适应窗口：一上来就把整张图塞进可视宽度，长图不必先横向拖 */
  const fit = useCallback(() => {
    if (!size) return;
    const w = boxRef.current?.clientWidth ?? 0;
    if (w > 0) setZoom(clampZoom((w - 32) / size.w));
  }, [size]);

  useEffect(() => {
    fit();
  }, [fit]);

  // 打开时接管页面滚动：背景不该跟着滚
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === '+' || e.key === '=') {
        setZoom((z) => clampZoom(z + 0.25));
      } else if (e.key === '-' || e.key === '_') {
        setZoom((z) => clampZoom(z - 0.25));
      } else if (e.key === '0') {
        setZoom(1);
      }
    };
    // 捕获阶段：页面别处挂了一堆单键快捷键，Esc 不能被它们先抢走
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z - e.deltaY * 0.0015));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${title} · 放大查看`}
      className="fixed inset-0 z-[60] flex flex-col bg-black/85 backdrop-blur-sm"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <span className="mono text-[10px] uppercase tracking-wider text-fgFaint">放大查看</span>
        <span className="text-[11px] text-fg">{title}</span>
        {size && (
          <span className="mono text-[10px] text-fgFaint">
            {size.w}×{size.h}px
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Action label="−" onClick={() => setZoom((z) => clampZoom(z - 0.25))} />
          <span className="mono w-[52px] text-center text-[11px] text-fgMuted">
            {Math.round(zoom * 100)}%
          </span>
          <Action label="+" onClick={() => setZoom((z) => clampZoom(z + 0.25))} />
          <Action label="适应窗口" onClick={fit} />
          <Action label="1:1" onClick={() => setZoom(1)} />
          <Action label="关闭 Esc" onClick={onClose} />
        </div>
      </div>
      <div ref={boxRef} className="flex-1 overflow-auto p-4">
        {/* 容器宽 = 原始宽 × 倍率；svg 内部的 max-width:100% 正好落在它上面 */}
        <div style={{ width: size ? size.w * zoom : '100%', margin: '0 auto' }}>
          <div
            className="[&>svg]:block [&>svg]:h-auto [&>svg]:w-full"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      </div>
      <p className="border-t border-line bg-surface px-3 py-1.5 text-[10px] text-fgFaint">
        Ctrl/⌘ + 滚轮缩放 · <span className="mono">+</span> / <span className="mono">−</span> 调倍率 ·{' '}
        <span className="mono">0</span> 回到 1:1 · <span className="mono">Esc</span> 关闭 ——
        图是矢量的，放到 600% 文字与线条依然清晰；想截图存档可以先用工具条切到「文档浅色」主题。
      </p>
    </div>,
    document.body
  );
}

function Action({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-line px-2 py-1 text-[10px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg disabled:opacity-50"
    >
      {label}
    </button>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className="mono rounded-sm border px-1.5 py-0.5 text-[10px]"
      style={{
        borderColor: on ? 'rgba(217,164,65,0.6)' : '#243029',
        background: on ? 'rgba(217,164,65,0.10)' : 'transparent',
        color: on ? '#D9A441' : '#93A39C',
      }}
    >
      {on ? '✓ ' : ''}
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// 九块里的非图六块
// ─────────────────────────────────────────────────────────────

function Overview({
  audit,
  capacity,
  meta,
}: {
  audit: ArchAudit;
  capacity: ReturnType<typeof estimateCapacity>;
  meta: StackPicksMeta;
}) {
  const meta0 = STATUS_META[audit.status];
  const tone = TONE[meta0.tone === 'bad' ? 'bad' : meta0.tone === 'warn' ? 'warn' : 'ok'];
  const filled = audit.stats.requiredTotal
    ? audit.stats.requiredFilled / audit.stats.requiredTotal
    : 1;
  const missing = [...audit.blockers, ...audit.gaps];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3">
          <ProgressRing ratio={filled} tone={tone.color} />
          <div>
            <p className="text-[13px] font-semibold" style={{ color: tone.color }}>
              {meta0.label}
            </p>
            <p className="mt-1 max-w-[320px] text-[10px] leading-[15px] text-fgMuted">
              {meta0.summary}
            </p>
          </div>
        </div>
        <div className="ml-auto grid grid-cols-3 gap-2">
          <Num label="已装配" value={`${audit.stats.filled}/${audit.stats.total}`} />
          <Num label="必选项" value={`${audit.stats.requiredFilled}/${audit.stats.requiredTotal}`} />
          <Num label="应用副本" value={`${capacity.appReplicas}`} accent />
        </div>
      </div>

      <div>
        <p className="mono mb-1.5 text-[10px] uppercase tracking-wider text-fgFaint">
          缺零件 / 跑不起来（{missing.length}）
        </p>
        {missing.length === 0 ? (
          <p className="rounded-md border border-line bg-surface px-3 py-2 text-[10px] text-fgFaint">
            能力闭环，没有缺件。
          </p>
        ) : (
          <ul className="space-y-1">
            {missing.slice(0, 6).map((g, i) => (
              <li
                key={i}
                className="flex flex-wrap items-baseline gap-x-2 rounded-md border px-2.5 py-1.5"
                style={{ borderColor: TONE.bad.border, background: TONE.bad.soft }}
              >
                <span className="text-[10px] font-medium" style={{ color: TONE.bad.color }}>
                  {g.title}
                </span>
                <span className="text-[10px] text-fgMuted">{g.detail ?? ''}</span>
                {g.remedies && g.remedies.length > 0 && (
                  <span className="text-[10px]" style={{ color: '#7FA650' }}>
                    怎么补：{remedyText(g)}
                  </span>
                )}
              </li>
            ))}
            {missing.length > 6 && (
              <li className="text-[10px] text-fgFaint">另有 {missing.length - 6} 条，见「隐患」页签</li>
            )}
          </ul>
        )}
      </div>

      <p className="text-[10px] leading-[15px] text-fgFaint">
        形态表态：{Object.keys(meta.topology).length} 个组件选了形态，
        {Object.keys(meta.params).length} 处参数被手动调过 —— 没调过的走默认值，不是「没生效」。
      </p>
    </div>
  );
}

function FlowBlock({ picks, audit }: { picks: StackPicks; audit: ArchAudit }) {
  const nameOf = (dimId: string) => {
    if (!picks[dimId]) return '—';
    const dim = dimensions.find((d) => d.id === dimId);
    return dim?.options.find((o) => o.id === picks[dimId])?.name ?? picks[dimId];
  };

  /** 链路上哪个环在「要一块没人提供的能力」。环上标红就是它 ——
      光说「跑不起来」不点名到环，用户就得拿结论自己对台面（09-28 反馈的痛点）。 */
  const unmetBy = (() => {
    const m = new Map<string, string>();
    for (const b of audit.blockers) {
      if (!b.unmetCap) continue;
      for (const n of b.nodes) if (!m.has(n)) m.set(n, capLabel(b.unmetCap));
    }
    return m;
  })();

  return (
    <div className="space-y-3">
      {CANVAS_VIEWS.map((v) => {
        const steps = v.dims.filter((d) => picks[d]);
        return (
          <div key={v.id}>
            <div className="mb-1 flex items-baseline gap-2">
              <span className="text-[11px] font-medium text-fg">{v.label}</span>
              <span className="mono text-[10px] text-fgFaint">{steps.length} 环</span>
            </div>
            {steps.length === 0 ? (
              <p className="text-[10px] text-fgFaint">这条链路上没有任何已装配的零件。</p>
            ) : (
              <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
                {steps.map((d, i) => {
                  const miss = unmetBy.get(d);
                  return (
                    <span key={d} className="flex items-center gap-1">
                      {i > 0 && <span className="mono text-[11px] text-fgFaint">→</span>}
                      <span
                        className="rounded-sm border bg-surfaceHi px-1.5 py-0.5 text-[10px]"
                        style={
                          miss
                            ? { borderColor: TONE.bad.border, color: TONE.bad.color }
                            : { borderColor: '#243029', color: '#93A39C' }
                        }
                        title={
                          miss
                            ? `这一环需要「${miss}」，当前无人提供 —— 在配它的步骤里换零件即可（点槽位卡可见补法）`
                            : undefined
                        }
                      >
                        {nameOf(d)}
                      </span>
                      {miss && (
                        <span className="text-[10px]" style={{ color: TONE.bad.color }}>
                          缺「{miss}」
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            )}
            <p className="mt-1 text-[10px] leading-[15px] text-fgFaint">{v.note}</p>
          </div>
        );
      })}

      <div>
        <p className="mono mb-1.5 text-[10px] uppercase tracking-wider text-fgFaint">
          各镜像内部的请求顺序
        </p>
        <ul className="space-y-1">
          {arch.lanes.map((lane) => {
            const order = (arch.pipelines[lane.id] ?? []).filter((d) => picks[d]);
            if (order.length < 2) return null;
            return (
              <li key={lane.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="w-[86px] shrink-0 text-[10px] text-fgFaint">{lane.name}</span>
                <span className="text-[10px] text-fgMuted">
                  {order.map(nameOf).join(' → ')}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function TreeBlock({ picks }: { picks: StackPicks }) {
  // `projectDoc.tree` 是**一个**根节点；`filterTree()` 收的是节点数组。
  // 写 `filterTree(projectDoc.tree as TreeNode[], picks)` 编译期能过，
  // 运行期会按字符串遍历对象的属性 —— 那是一条只在页面上表现为「目录树空着」的错。
  const tree = useMemo(() => filterTree(projectDoc.tree.children ?? [], picks), [picks]);
  const stats = useMemo(() => treeStats(tree, projectDoc.tree.name), [tree]);

  return (
    <div>
      <p className="mb-1.5 text-[10px] leading-[15px] text-fgFaint">
        这套组合会落地 {stats.files} 个文件（Java {stats.java} / 资源 {stats.resources} / 测试{' '}
        {stats.test}），分布在 {stats.dirs} 个目录里。带条件的目录只在你真的装了对应零件时才出现 ——
        它不是一份固定模板。
      </p>
      <p className="mono mb-1 text-[10px] text-fg">
        {projectDoc.tree.name}
        <span className="ml-2 text-fgFaint">{projectDoc.tree.desc}</span>
      </p>
      <ul className="space-y-0.5">{renderTree(tree, 0)}</ul>
    </div>
  );
}

function renderTree(nodes: TreeNode[], depth: number) {
  return nodes.map((n, i) => (
    <li key={`${n.name}-${i}`}>
      <span
        className="mono flex items-baseline gap-2 text-[10px] leading-[17px] text-fgMuted"
        style={{ paddingLeft: depth * 12 }}
      >
        <span className="text-fgFaint">{n.children?.length ? '▸' : '·'}</span>
        <span className={n.children?.length ? 'text-fg' : ''}>{n.name}</span>
        {n.desc && <span className="truncate text-fgFaint">{n.desc}</span>}
      </span>
      {n.children?.length ? <ul>{renderTree(n.children, depth + 1)}</ul> : null}
    </li>
  ));
}

function ManifestBlock({
  files,
  onNote,
}: {
  files: { path: string; content: string; from?: string }[];
  onNote: (s: string | null) => void;
}) {
  const groups = new Map<string, typeof files>();
  for (const f of files) {
    const k = f.from ?? '其他';
    const list = groups.get(k) ?? [];
    list.push(f);
    groups.set(k, list);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] text-fgFaint">
          {files.length} 个文件 · {formatBytes(files.reduce((n, f) => n + f.content.length, 0))}
        </span>
        <button
          type="button"
          onClick={() =>
            copy(
              files.map((f) => `# ${f.path}\n${f.content}`).join('\n\n'),
              onNote,
              '整份清单已复制'
            )
          }
          className="ml-auto rounded-md border border-line px-2 py-1 text-[10px] text-fgMuted hover:border-lineHi hover:text-fg"
        >
          复制全部
        </button>
      </div>

      {[...groups.entries()].map(([from, list]) => (
        <div key={from}>
          <p className="mono mb-1 text-[10px] uppercase tracking-wider text-fgFaint">{from}</p>
          <ul className="divide-y divide-line rounded-md border border-line">
            {list.map((f) => (
              <li key={f.path} className="flex items-center gap-2 px-2.5 py-1.5">
                <span className="mono min-w-0 flex-1 truncate text-[10px] text-fgMuted">
                  {f.path}
                </span>
                <span className="mono shrink-0 text-[10px] text-fgFaint">
                  {formatBytes(f.content.length)}
                </span>
                <button
                  type="button"
                  onClick={() => downloadText(f.path.split('/').pop() ?? 'file.txt', f.content, 'text/plain;charset=utf-8')}
                  className="mono shrink-0 text-[10px] text-fgFaint hover:text-fg"
                >
                  下载
                </button>
                <button
                  type="button"
                  onClick={() => copy(f.content, onNote, `${f.path} 已复制`)}
                  className="mono shrink-0 text-[10px] text-fgFaint hover:text-fg"
                >
                  复制
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function RiskBlock({ audit }: { audit: ArchAudit }) {
  const groups: { title: string; tone: keyof typeof TONE; items: ArchGap[]; hint: string }[] = [
    { title: '跑不起来', tone: 'bad', items: audit.blockers, hint: '启动就会失败' },
    { title: '缺件', tone: 'warn', items: audit.gaps, hint: '能启动，但少能力' },
    { title: '组合隐患', tone: 'warn', items: audit.risks, hint: '单独看都对，拼起来出事' },
    { title: '提示', tone: 'info', items: audit.notes, hint: '知道就行' },
  ];
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  if (!total) {
    return <p className="py-8 text-center text-[10px] text-fgFaint">没有发现问题。</p>;
  }
  return (
    <div className="space-y-3">
      {groups.map((g) =>
        g.items.length === 0 ? null : (
          <div key={g.title}>
            <div className="mb-1 flex items-baseline gap-2">
              <span className="mono text-[10px] uppercase tracking-wider" style={{ color: TONE[g.tone].color }}>
                {g.title}
              </span>
              <span className="mono text-[10px] text-fgFaint">{g.items.length}</span>
              <span className="ml-auto text-[10px] text-fgFaint">{g.hint}</span>
            </div>
            <ul className="space-y-1">
              {g.items.map((gap, i) => (
                <li
                  key={i}
                  className="rounded-md border px-2.5 py-1.5"
                  style={{ borderColor: TONE[g.tone].border, background: TONE[g.tone].soft }}
                >
                  <p className="text-[10px] font-medium" style={{ color: TONE[g.tone].color }}>
                    {gap.title}
                  </p>
                  {gap.detail && (
                    <p className="mt-0.5 text-[10px] leading-[15px] text-fgMuted">{gap.detail}</p>
                  )}
                  {gap.remedies && gap.remedies.length > 0 && (
                    <p className="mt-0.5 text-[10px] leading-[15px]" style={{ color: '#7FA650' }}>
                      <span className="mono mr-1 text-fgFaint">怎么补</span>
                      {remedyText(gap)}
                    </p>
                  )}
                  {gap.symptoms && gap.symptoms.length > 0 && (
                    <ul className="mt-0.5">
                      {gap.symptoms.slice(0, 2).map((sym, j) => (
                        <li key={j} className="text-[10px] leading-[15px] text-fgFaint">
                          · {sym}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )
      )}
    </div>
  );
}

function CapacityBlock({ capacity }: { capacity: ReturnType<typeof estimateCapacity> }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Num label="应用副本" value={`${capacity.appReplicas}`} accent />
        <Num label="全站 DB 连接" value={`${capacity.dbConnections}`} />
        <Num label="应用侧内存" value={`${(capacity.appMemoryMb / 1024).toFixed(1)} GB`} />
        <Num label="入口 QPS 上限" value={`${capacity.totalQps}`} />
      </div>

      <p className="text-[10px] leading-[15px] text-fgMuted">
        全站连接数 = 副本 {capacity.appReplicas} × 池上限 {capacity.poolSize} ={' '}
        <span className="mono" style={{ color: '#D9A441' }}>{capacity.dbConnections}</span>。
        这个数字超过数据库的 <span className="mono">max_connections</span> 时，
        扩容应用只会让更多连接卡在等待上 —— 先看这一项，再动副本数。
      </p>

      <div>
        <p className="mono mb-1.5 text-[10px] uppercase tracking-wider text-fgFaint">
          各组件实例数（来自形态，不是抄的）
        </p>
        {capacity.rows.length === 0 ? (
          <p className="text-[10px] text-fgFaint">
            当前组合里没有带形态表态的组件（数据库 / 缓存 / 检索 / 队列 / 应用）。
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {capacity.rows.map((r) => (
              <li key={r.dimId} className="flex items-baseline gap-2 px-2.5 py-1.5">
                <span className="text-[10px] text-fgMuted">{r.dimName}</span>
                <span className="text-[10px] text-fgFaint">{r.optionName}</span>
                <span className="ml-auto text-[10px]" style={{ color: '#D9A441' }}>
                  {r.modeLabel}
                </span>
                <span className="mono w-[42px] text-right text-[10px] text-fg">×{r.replicas}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ul className="space-y-0.5 text-[10px] leading-[15px] text-fgFaint">
        <li>
          · 应用副本 {capacity.appReplicas} 来自
          {capacity.replicasSource === 'override'
            ? '滑杆的手动设定。'
            : '所选形态的推导（滑杆未动过，它不是输入值）。'}
        </li>
        <li>· JVM 堆 {capacity.heapMb} MB，另计约 512MB 堆外（元空间 / 直接内存 / 线程栈）。</li>
        <li>· 单实例限流 {capacity.qpsLimit} QPS × {capacity.appReplicas} 副本 = {capacity.totalQps} QPS 入口上限。</li>
        <li>· 分片数 {capacity.shardCount}：只在数据库形态为「分库分表」时影响真实路由，其余形态只影响形态图的格子数。</li>
      </ul>
    </div>
  );
}

function Num({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-surfaceHi px-2 py-1.5">
      <div className="mono text-[15px] leading-tight" style={{ color: accent ? '#D9A441' : '#E8F0EC' }}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] text-fgFaint">{label}</div>
    </div>
  );
}

// ProgressRing 已提取为共享组件（./ProgressRing）—— 装配台结论条（S1-5）与
// 这里共用同一份定义，改动半径只需要一处。

// ─────────────────────────────────────────────────────────────
// 小工具
// ─────────────────────────────────────────────────────────────

/**
 * 补法一行文案：「▦ 主题框架 · 运行基石 / 运行环境 → 容器运行时 · …」。
 * 槽位名前必须带步骤 + 组：步骤是去哪一步，组名是那一步分组导航里**看得见的字** ——
 * 只说「运行环境」，用户在 ⑤ 的分组列表里看到的是「运行基石」，对不上号（09-28 三反馈）。
 * 没有补法返回空串。
 */
function remedyText(gap: ArchGap): string {
  if (!gap.remedies?.length) return '';
  return gap.remedies
    .map((r) => {
      const spec = STEP_BY_ID.get(stepOfDim(r.dim) ?? 'layers');
      const dim = dimensions.find((d) => d.id === r.dim);
      const group = groupOfDim(r.dim);
      const dimName = dim?.name ?? r.dim;
      const head = spec
        ? `${spec.name} · ${group ? `${group.name} / ` : ''}${dimName}`
        : dimName;
      const opt = dim?.options.find((o) => o.id === r.option);
      return opt ? `${head} → ${opt.name}` : head;
    })
    .join(' · ');
}

function readSvgSize(svg: string): { w: number; h: number } | null {
  const m = /<svg[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"/.exec(svg);
  return m ? { w: Math.round(Number(m[1])), h: Math.round(Number(m[2])) } : null;
}

async function copy(text: string, onNote: (s: string | null) => void, ok: string) {
  try {
    await navigator.clipboard.writeText(text);
    onNote(ok);
  } catch {
    onNote('剪贴板不可用（非 https 或未授权），请改用「下载」');
  }
}

function downloadText(name: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * SVG → PNG。图里没有外部资源，不会污染画布，所以这条路是通的。
 * 用 2 倍图：1 倍图贴进 Word / PPT 会糊。
 */
function downPng(svg: string, name: string, onNote: (s: string | null) => void) {
  const size = readSvgSize(svg);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((size?.w ?? img.width) * scale));
    canvas.height = Math.max(1, Math.round((size?.h ?? img.height) * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      onNote('PNG 生成失败，请改用下载 SVG');
      URL.revokeObjectURL(url);
      return;
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((png) => {
      if (!png) {
        onNote('PNG 生成失败，请改用下载 SVG');
        return;
      }
      const pngUrl = URL.createObjectURL(png);
      const a = document.createElement('a');
      a.href = pngUrl;
      a.download = `${name}.png`;
      a.click();
      URL.revokeObjectURL(pngUrl);
      onNote(`已下载 PNG（${canvas.width}×${canvas.height}，2 倍图）`);
    });
    URL.revokeObjectURL(url);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    onNote('PNG 生成失败，请改用下载 SVG');
  };
  img.src = url;
}

/** 技术架构 → Mermaid。连线方向与 `kind` 都对上，粘出去就是同一张图 */
function techArchMermaid(a: TechArch): string {
  const id = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_');
  const lines = ['flowchart LR'];
  for (const n of a.nodes) {
    const replicas = n.modes && n.mode !== undefined ? n.modes[n.mode]?.replicas ?? 1 : 1;
    lines.push(`  ${id(n.id)}["${n.title}${replicas > 1 ? ` ×${replicas}` : ''}"]`);
  }
  for (const e of a.edges) {
    if (!a.nodes.some((n) => n.id === e.from) || !a.nodes.some((n) => n.id === e.to)) continue;
    lines.push(`  ${id(e.from)} ${e.kind === 'dashed' ? '-.->' : '-->'}|${e.label}| ${id(e.to)}`);
  }
  return lines.join('\n');
}

/** 形态 → Mermaid。形态是「几个实例」，所以画成子图 + 副本标签 */
function topologyMermaid(picks: StackPicks, meta: StackPicksMeta): string {
  const id = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_');
  const lines = ['flowchart TB'];
  for (const f of buildTopologySvg(picks, meta).figures) {
    lines.push(`  subgraph ${id(f.dimId)}["${f.dimName} · ${f.optionName} · ${f.modeLabel}"]`);
    for (let i = 1; i <= f.replicas; i += 1) lines.push(`    ${id(f.dimId)}_${i}["实例 ${i}"]`);
    lines.push('  end');
  }
  return lines.join('\n');
}
