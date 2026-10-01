'use client';

import { useEffect, useMemo, useState } from 'react';
import { layoutFlowFigure } from '@/lib/topology-figure';
import { svgMotionStyle } from '@/lib/arch-motion';
import type { TopologyFlow, TopologyFlowSceneId } from '@/lib/content-types';
import { TOPOLOGY_FLOW_SCENE_IDS } from '@/lib/topology-flows';
import { TONE, INK, toneAt, gloss } from './palette';

/**
 * 机理台 —— 部署形态的剧本播放器（《部署形态动画化计划》D1/D4）。
 *
 * 剧本是数据（topology_flows.json），这里只负责按步演出：
 *   · 场景三选一：read（怎么查）/ write（怎么存）/ failover（挂了怎么办）；
 *   · 播放 / 暂停 / 上一步 / 下一步 / 重播 + 0.5× / 1× / 2× + 进度点；
 *   · 旁白逐字显示当前步的 caption，refs（数字出处）挂在场景末尾。
 *
 * 动画分两层，刻意不混：
 *   · 常态流光 —— 复用 arch-motion 的 `.am-flow`（stroke-dashoffset 虚线行进），
 *     点在「本步激活」的边上，这是所有浏览器都有的降级光带；
 *   · 分步 token —— CSS `offset-path` 沿边跑一个小圆点（不用 SMIL：
 *     Chrome 早就标记过考虑移除，arch-motion.ts 文件头有完整理由），
 *     不支持 offset-path 的浏览器由 `@supports` 整个藏掉 token，只留光带。
 *
 * `prefers-reduced-motion: reduce`：自动播放禁用（永远停在首帧），
 * token 停在起点不动 —— 只留上一步 / 下一步手动步进与全量文字，绝不强制播放。
 */

const STEP_MS = 2400;
const SCENE_TABS: { id: TopologyFlowSceneId; tab: string }[] = [
  { id: 'read', tab: '读' },
  { id: 'write', tab: '写' },
  { id: 'failover', tab: '灾' },
];

const EDGE_DASH: Record<string, string | undefined> = {
  data: undefined,
  repl: '5 4',
  heartbeat: '1.5 4',
  route: '1.5 4',
};

/** 播放器自带的增量样式：token 动画 + 降级隐藏（追加进 svgMotionStyle 的 extra 段） */
const LAB_CSS =
  '.tp-token{transform-box:view-box;animation:tp-token-run 2.4s linear infinite;animation-play-state:paused}' +
  '@keyframes tp-token-run{from{offset-distance:0%}to{offset-distance:100%}}' +
  '@supports not (offset-path:path("M0 0 L1 1")){.tp-token{display:none}}' +
  '@media (prefers-reduced-motion:reduce){.tp-token{animation:none}}';

export default function TopologyLab({
  flow,
  title,
}: {
  flow: TopologyFlow;
  /** 形态的显示名（「缓存 · Redis · 主从」），给标题与 aria 用 */
  title: string;
}) {
  const scenes = useMemo(
    () =>
      TOPOLOGY_FLOW_SCENE_IDS.map((id) => flow.scenes.find((s) => s.id === id)).filter(
        (s): s is NonNullable<typeof s> => !!s
      ),
    [flow]
  );
  const [sceneId, setSceneId] = useState<TopologyFlowSceneId>('read');
  const scene = scenes.find((s) => s.id === sceneId) ?? scenes[0];
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2>(1);

  // 系统开了「减弱动效」：自动播放整个停掉，只留手动步进（D4 的硬约定）
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      setReduce(mq.matches);
      if (mq.matches) setPlaying(false);
    };
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);

  const total = scene?.steps.length ?? 0;
  const current = scene?.steps[Math.min(step, Math.max(0, total - 1))];

  // 自动步进：到末步停住（不循环 —— 重播是显式动作，不是惊喜）
  useEffect(() => {
    if (!playing || reduce || !scene) return;
    const t = window.setTimeout(() => {
      if (step < scene.steps.length - 1) setStep((s) => s + 1);
      else setPlaying(false);
    }, STEP_MS / speed);
    return () => window.clearTimeout(t);
  }, [playing, step, speed, reduce, scene]);

  const layout = useMemo(() => layoutFlowFigure(flow.nodes, flow.edges), [flow]);
  const stepIndex = Math.min(step, Math.max(0, total - 1));

  const switchScene = (id: TopologyFlowSceneId) => {
    setSceneId(id);
    setStep(0);
    setPlaying(false);
  };
  const replay = () => {
    setStep(0);
    if (!reduce) setPlaying(true);
  };

  const highlight = new Set(current?.highlight ?? []);
  const active = new Set(current?.active ?? []);

  return (
    <div data-topology-lab-player className="space-y-2">
      {/* 场景页签：三问 */}
      <div className="flex flex-wrap items-baseline gap-1.5">
        <span className="mono text-[10px] uppercase tracking-wider text-fgFaint">{title}</span>
        <div className="ml-auto flex gap-1">
          {SCENE_TABS.map(({ id, tab }) => {
            const s = scenes.find((x) => x.id === id);
            if (!s) return null;
            return (
              <button
                key={id}
                type="button"
                data-topology-scene={id}
                aria-pressed={sceneId === id}
                onClick={() => switchScene(id)}
                title={s.title}
                className="rounded px-2 py-0.5 text-[10px] leading-[16px] transition-colors"
                style={{
                  border: '1px solid',
                  borderColor: sceneId === id ? toneAt('warn', 0.65) : INK.line,
                  color: sceneId === id ? TONE.warn.color : INK.muted,
                  background: sceneId === id ? toneAt('warn', 0.09) : 'transparent',
                }}
              >
                {tab}
              </button>
            );
          })}
        </div>
      </div>

      {/* 画布：静态布局 + 常态流光（arch-motion）+ 分步 token（offset-path） */}
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width="100%"
        role="img"
        aria-label={`${title} ${scene?.title ?? ''} 第 ${stepIndex + 1} 步：${current?.caption ?? ''}`}
        className="rounded-md"
        style={{ background: INK.deep, border: `1px solid ${gloss(0.1)}` }}
      >
        <defs dangerouslySetInnerHTML={{ __html: svgMotionStyle(LAB_CSS) }} />
        {/* 边（画在节点下层） */}
        {layout.edges.map((e) => {
          const flowEdge = flow.edges.find((x) => x.id === e.id);
          const lit = active.has(e.id);
          return (
            <g key={e.id}>
              <path
                d={`M${e.x1} ${e.y1} L${e.x2} ${e.y2}`}
                fill="none"
                stroke={lit ? TONE.warn.color : INK.edge}
                strokeWidth={lit ? 1.6 : 1.2}
                strokeDasharray={flowEdge ? EDGE_DASH[flowEdge.kind] || undefined : undefined}
              />
              {lit && (
                <path
                  className="am-flow"
                  d={`M${e.x1} ${e.y1} L${e.x2} ${e.y2}`}
                  fill="none"
                  stroke={TONE.warn.color}
                  strokeWidth="2.4"
                />
              )}
            </g>
          );
        })}
        {/* 节点 */}
        {layout.nodes.map((n) => {
          const lit = highlight.has(n.id);
          return (
            <g key={n.id}>
              <rect
                x={n.x}
                y={n.y}
                width={n.w}
                height={n.h}
                rx="8"
                fill={lit ? toneAt('warn', 0.14) : INK.node}
                stroke={lit ? TONE.warn.color : gloss(0.10)}
                stroke-width={lit ? 1.6 : 1}
              />
              <text
                x={n.x + n.w / 2}
                y={n.y + n.h / 2 + 4}
                text-anchor="middle"
                font-size="12"
                font-family="-apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif"
                fill={lit ? TONE.warn.color : INK.nodeText}
              >
                {n.label}
              </text>
            </g>
          );
        })}
        {/* 分步 token：沿当前步的边跑（offset-path；不支持时由 CSS 藏掉） */}
        {current?.token &&
          (() => {
            const e = layout.edges.find((x) => x.id === current.token!.edge);
            if (!e) return null;
            return (
              <g
                className="tp-token"
                style={
                  {
                    offsetPath: `path('M ${e.x1} ${e.y1} L ${e.x2} ${e.y2}')`,
                    animation: `tp-token-run ${(STEP_MS / 1000) / speed}s linear infinite`,
                    animationPlayState: playing && !reduce ? 'running' : 'paused',
                  } as React.CSSProperties
                }
              >
                <circle r="6" cx="0" cy="0" fill={TONE.warn.color} stroke={INK.deep} stroke-width="1.5" />
                <text
                  x="0"
                  y="-10"
                  text-anchor="middle"
                  font-size="9"
                  font-family="'Cascadia Code', Consolas, monospace"
                  fill={TONE.warn.color}
                >
                  {current.token.label}
                </text>
              </g>
            );
          })()}
      </svg>

      {/* 旁白 + 控制 */}
      <div className="rounded-md border border-line bg-surface px-3 py-2">
        <p data-topology-step-narration className="text-[11px] leading-[17px] text-fg">
          {scene?.title} · 第 {stepIndex + 1}/{total} 步 —— {current?.caption}
        </p>
        {current?.token && (
          <p className="mt-0.5 text-[10px] leading-[15px] text-fgFaint">
            数据包「{current.token.label}」正沿边 <span className="mono">{current.token.edge}</span> 行进
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <button
            type="button"
            data-topology-ctrl="replay"
            onClick={replay}
            className="rounded border border-line px-2 py-0.5 text-[10px] leading-[16px] text-fgMuted transition-colors hover:border-brass hover:text-brass"
          >
            ↻ 重播
          </button>
          <button
            type="button"
            data-topology-ctrl="prev"
            onClick={() => {
              setPlaying(false);
              setStep((s) => Math.max(0, s - 1));
            }}
            disabled={stepIndex === 0}
            className="rounded border border-line px-2 py-0.5 text-[10px] leading-[16px] text-fgMuted transition-colors disabled:opacity-40 hover:border-brass hover:text-brass"
          >
            ‹ 上一步
          </button>
          <button
            type="button"
            data-topology-ctrl="play"
            onClick={() => setPlaying((p) => !p)}
            disabled={reduce}
            title={reduce ? '系统已开启减弱动效，自动播放停用' : undefined}
            className="rounded border px-2 py-0.5 text-[10px] leading-[16px] transition-colors"
            style={{
              borderColor: playing ? toneAt('warn', 0.65) : INK.line,
              color: playing ? TONE.warn.color : INK.muted,
            }}
          >
            {playing ? '⏸ 暂停' : '▶ 播放'}
          </button>
          <button
            type="button"
            data-topology-ctrl="next"
            onClick={() => {
              setPlaying(false);
              setStep((s) => Math.min(total - 1, s + 1));
            }}
            disabled={stepIndex >= total - 1}
            className="rounded border border-line px-2 py-0.5 text-[10px] leading-[16px] text-fgMuted transition-colors disabled:opacity-40 hover:border-brass hover:text-brass"
          >
            下一步 ›
          </button>
          <span className="ml-1 flex items-center gap-0.5">
            {([0.5, 1, 2] as const).map((v) => (
              <button
                key={v}
                type="button"
                data-topology-speed={v}
                aria-pressed={speed === v}
                onClick={() => setSpeed(v)}
                className="mono rounded px-1.5 py-0.5 text-[10px] leading-[16px] transition-colors"
                style={{
                  border: '1px solid',
                  borderColor: speed === v ? toneAt('warn', 0.65) : INK.line,
                  color: speed === v ? TONE.warn.color : INK.controlIdle,
                }}
              >
                {v}×
              </button>
            ))}
          </span>
          {reduce && (
            <span className="text-[10px] leading-[16px] text-fgFaint">
              （减弱动效已开启：自动播放停用，用上一步 / 下一步手动看）
            </span>
          )}
        </div>
        {/* 进度条：可点的分步点 */}
        <div className="mt-1.5 flex items-center gap-1" data-topology-progress>
          {scene?.steps.map((s, i) => (
            <button
              key={i}
              type="button"
              aria-label={`第 ${i + 1} 步：${s.caption}`}
              onClick={() => {
                setPlaying(false);
                setStep(i);
              }}
              className="h-1.5 rounded-full transition-all"
              style={{
                width: i === stepIndex ? 22 : 12,
                background: i <= stepIndex ? TONE.warn.color : INK.line,
              }}
            />
          ))}
        </div>
        {/* 出处：数字不许编造（D5） */}
        {scene && scene.refs.length > 0 && (
          <p className="mt-1.5 border-t border-line pt-1.5 text-[10px] leading-[15px] text-fgFaint">
            出处：
            {scene.refs.map((r, i) => (
              <span key={i} className="mono">
                {i > 0 && ' · '}
                {r}
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}
