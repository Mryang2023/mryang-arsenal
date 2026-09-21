'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import CopyButton from '@/components/CopyButton';
import { STATUS_META, type ArchAudit } from '@/lib/arch';
import {
  archDiagramD2,
  archDiagramMermaid,
  buildArchDiagram,
  buildArchDiagramSvgInteractive,
  toResponsiveSvg,
  type DiagramTheme,
  type DiagramView,
} from '@/lib/arch-diagram';
import {
  buildArchGraph,
  capLabel,
  compareLanes,
  edgeLabel,
  graphStories,
  reachFrom,
  routesBetween,
  type ArchGraph,
  type GraphEdge,
  type ReachMode,
} from '@/lib/arch-graph';
import { projectDoc } from '@/lib/project';
import { downloadText } from '@/lib/zip';
import type { StackPicks } from '@/lib/content-types';
import { TONE } from './palette';

/**
 * 架构图页签。
 *
 * 这张图与导出包里的 `architecture.svg` 是同一个纯函数的两份产物：
 *   · 下载 / 导出走的 `built.svg` —— 规范产物，不带任何交互状态
 *   · 屏幕上显示的 —— 同一个渲染器 + 一个 view（谁被点亮、谁被压暗）
 * 两者几何与文字完全一致，差别只在"能不能点"和"当前高亮谁"。
 *
 * 交互全部建立在**作者声明的数据**上：
 *   · 可达性只走 provides / requires 推导出的依赖边 —— 那是事实
 *   · 路由会走层内流水线箭头，但那种边是**版式主张**，界面上单独标注，绝不混着说
 * 没有运行时探测、没有推测影响，屏幕上不会出现任何数据里没有的关系。
 *
 * 没有引任何绘图库：泳道与槽位数都由数据决定（现在 7 条 / 18 个），坐标能直接算出来。
 * 引擎解决的是拓扑，而这里要的是版式。
 */

type Mode = 'focus' | 'reach' | 'route' | 'lens' | 'story';

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'focus', label: '查看', hint: '点方块看它的角色与代价' },
  { id: 'reach', label: '可达追溯', hint: '拆掉这一块会连带影响谁 / 它依赖谁' },
  { id: 'route', label: '通路探测', hint: '两个槽位之间的最短有向通路' },
  { id: 'lens', label: '角色透镜', hint: '对比两条泳道各自提供与索要什么' },
  { id: 'story', label: '导览', hint: '按预设或当前缺口逐章看' },
];

function Chip({
  children,
  tone = 'idle',
  title,
}: {
  children: React.ReactNode;
  tone?: 'bad' | 'warn' | 'ok' | 'idle' | 'info';
  title?: string;
}) {
  const t = TONE[tone];
  return (
    <span
      title={title}
      className="mono rounded px-1.5 py-0.5 text-2xs leading-none"
      style={{ color: t.color, background: t.soft, border: `1px solid ${t.border}` }}
    >
      {children}
    </span>
  );
}

function CapRow({ caps, label }: { caps: string[]; label: string }) {
  if (!caps.length) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-1.5">
      <span className="text-2xs text-fgFaint">{label}</span>
      {caps.map((c) => (
        <span key={c} className="text-2xs text-fgMuted">
          {capLabel(c)}
        </span>
      ))}
    </div>
  );
}

export default function ArchDiagram({ picks, audit }: { picks: StackPicks; audit: ArchAudit }) {
  const [theme, setTheme] = useState<DiagramTheme>('dark');
  const [note, setNote] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('focus');
  const [focus, setFocus] = useState<string | null>(null);
  const [reachMode, setReachMode] = useState<ReachMode>('downstream');
  const [routeFrom, setRouteFrom] = useState<string | null>(null);
  const [routeTo, setRouteTo] = useState<string | null>(null);
  const [lensA, setLensA] = useState<string | null>(null);
  const [lensB, setLensB] = useState<string | null>(null);
  const [storyId, setStoryId] = useState<string | null>(null);

  /** 规范产物：下载与导出包都用它，永远不带交互状态 */
  const built = useMemo(
    () =>
      buildArchDiagram({
        picks,
        audit,
        title: projectDoc.artifactId,
        subtitle: STATUS_META[audit.status].summary,
        theme,
      }),
    [picks, audit, theme]
  );
  const model = built.model;
  const lanes = model.lanes;

  const graph: ArchGraph = useMemo(() => buildArchGraph(picks, audit), [picks, audit]);
  const stories = useMemo(() => graphStories(graph, picks, audit), [graph, picks, audit]);

  // 透镜默认取前两条泳道，省掉"先点两条"的仪式感
  useEffect(() => {
    if (lanes.length < 2) return;
    setLensA((v) => v ?? lanes[0].id);
    setLensB((v) => v ?? lanes[1].id);
  }, [lanes]);

  // ── 各类查询结果 ──
  const reach = useMemo(
    () => (mode === 'reach' && focus ? reachFrom(graph, focus, reachMode) : null),
    [mode, focus, reachMode, graph]
  );
  const routeList = useMemo(
    () =>
      mode === 'route' && routeFrom && routeTo ? routesBetween(graph, routeFrom, routeTo) : [],
    [mode, routeFrom, routeTo, graph]
  );
  const route = routeList[0] ?? null;
  const lens = useMemo(
    () => (mode === 'lens' && lensA && lensB ? compareLanes(graph, lensA, lensB) : null),
    [mode, lensA, lensB, graph]
  );
  const story = stories.find((s) => s.id === storyId) ?? null;

  const nodesOfLane = useCallback(
    (laneId: string) => graph.lanes.find((l) => l.id === laneId)?.slots ?? [],
    [graph]
  );
  const pipeKeysOfLanes = useCallback(
    (ids: string[]) =>
      graph.edges
        .filter((e) => e.kind === 'pipeline' && e.laneId !== undefined && ids.includes(e.laneId))
        .map((e) => `${e.laneId}:${e.pipeIndex}`),
    [graph]
  );

  // ── 视图态：图上点亮谁、压暗谁 ──
  const view: DiagramView = useMemo(() => {
    if (mode === 'reach' && reach) {
      return {
        focus: reach.origin,
        lit: [reach.origin, ...reach.nodes],
        // 可达性只走依赖边，所以层内流水线一律压暗 —— 免得读者把版式顺序当成依赖
        litPipes: [],
        tone: reachMode,
      };
    }
    if (mode === 'route' && route) {
      return {
        focus: route.nodes[0],
        lit: route.nodes,
        litPipes: route.hops
          .filter((h) => h.kind === 'pipeline')
          .map((h) => `${h.laneId}:${h.pipeIndex}`),
        tone: 'route',
      };
    }
    if (mode === 'lens' && lens) {
      const ids = [lens.a.laneId, lens.b.laneId];
      return {
        lit: ids.flatMap(nodesOfLane),
        litLanes: ids,
        litPipes: pipeKeysOfLanes(ids),
        tone: 'lens',
      };
    }
    if (mode === 'story' && story && story.focus.length) {
      return { focus: story.focus[0], lit: story.focus, tone: 'story' };
    }
    return focus ? { focus } : {};
  }, [mode, reach, reachMode, route, lens, story, focus, nodesOfLane, pipeKeysOfLanes]);

  const displaySvg = useMemo(
    () => buildArchDiagramSvgInteractive(model, theme, view),
    [model, theme, view]
  );

  // ── 交互 ──
  const pickSlot = useCallback(
    (dimId: string) => {
      setNote(null);
      if (mode === 'route') {
        // 两步选点：先起后终；点第三次重新开始，避免"选了不生效"的困惑
        if (!routeFrom || (routeFrom && routeTo)) {
          setRouteFrom(dimId);
          setRouteTo(null);
        } else if (routeFrom === dimId) {
          setRouteTo(null);
        } else {
          setRouteTo(dimId);
        }
        return;
      }
      if (mode === 'lens') {
        const laneId = graph.byDim.get(dimId)?.laneId;
        if (!laneId) return;
        // 点方块 = 把 B 换成它所在的泳道（A 是锚，要改 A 用左边的下拉）。
        // 绝不把两边设成同一条：同一条比同一条，三个差异面必然全空，
        // 面板会退化成两列一模一样的标题 —— 那是"看起来在比，其实没在比"。
        if (laneId === lensA || laneId === lensB) return;
        setLensB(laneId);
        return;
      }
      setFocus(dimId);
    },
    [mode, routeFrom, routeTo, graph, lensA, lensB]
  );

  const clear = useCallback(() => {
    setFocus(null);
    setRouteFrom(null);
    setRouteTo(null);
    setStoryId(null);
    setNote(null);
  }, []);

  const cycleStory = useCallback(
    (dir: number) => {
      if (!stories.length) return;
      const i = stories.findIndex((s) => s.id === storyId);
      const next = stories[(i + dir + stories.length) % stories.length];
      setStoryId(next.id);
      setFocus(next.focus[0] ?? null);
    },
    [stories, storyId]
  );

  // 键盘快捷键：与 archify / 常见图表工具的习惯保持一致
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case 'Escape':
          clear();
          break;
        case 'u':
          setMode('reach');
          setReachMode('upstream');
          break;
        case 'd':
          setMode('reach');
          setReachMode('downstream');
          break;
        case 'r':
          setMode('route');
          break;
        case 'l':
          setMode('lens');
          break;
        case 'p':
          setMode('story');
          cycleStory(1);
          break;
        case '[':
          setMode('story');
          cycleStory(-1);
          break;
        case ']':
          setMode('story');
          cycleStory(1);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clear, cycleStory]);

  const onCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const hit = (e.target as Element).closest('[data-slot]');
      if (hit) pickSlot(hit.getAttribute('data-slot') ?? '');
    },
    [pickSlot]
  );

  const onCanvasKey = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const hit = (e.target as Element).closest('[data-slot]');
      if (hit) {
        e.preventDefault();
        pickSlot(hit.getAttribute('data-slot') ?? '');
      }
    },
    [pickSlot]
  );

  /** SVG → PNG：借浏览器的 canvas。图里没有外部资源，不会污染画布，所以这条路是通的。 */
  async function downloadPng() {
    setNote(null);
    try {
      // 用规范产物，不用屏幕上那份 —— 导出的图不该带上临时高亮
      const blob = new Blob([built.svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('SVG 无法解码'));
        img.src = url;
      });
      const scale = 2; // 2 倍图，贴进 Word / PPT 不至于糊
      const canvas = document.createElement('canvas');
      canvas.width = built.width * scale;
      canvas.height = built.height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('拿不到 canvas 上下文');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((png) => {
        if (!png) {
          setNote('PNG 生成失败，请改用 SVG');
          return;
        }
        const pngUrl = URL.createObjectURL(png);
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = `${projectDoc.artifactId}-architecture.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(pngUrl), 4000);
        setNote(`已下载 PNG（${canvas.width}×${canvas.height}，2 倍图）`);
      }, 'image/png');
    } catch (e) {
      setNote(`PNG 生成失败：${e instanceof Error ? e.message : String(e)}，请改用 SVG`);
    }
  }

  const slotCount = model.lanes.reduce((n, l) => n + l.slots.length, 0);
  const missingRequired = model.lanes
    .flatMap((l) => l.slots)
    .filter((s) => s.state === 'missing-required').length;

  const titleOf = (dimId: string) => graph.byDim.get(dimId)?.title ?? dimId;

  return (
    <div className="space-y-4">
      <p className="text-xs leading-relaxed text-fgMuted">
        横向色带是 {model.lanes.length} 层，方块是 {slotCount} 个槽位；左侧竖直箭头表示请求自上而下穿过各层，
        层内的 <span className="mono">→</span> 是请求真正流经的顺序，竖虚线右侧是旁路件
        （只在发布期起作用，请求不经过它）。方块右上角的「必需 / 建议」是该槽位
        <span className="text-fg">留空时的性质</span>，不是当前状态。
      </p>

      <div className="panel p-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-1 rounded border border-line p-0.5">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                title={m.hint}
                onClick={() => {
                  setMode(m.id);
                  setNote(null);
                  if (m.id === 'story' && !storyId) cycleStory(1);
                }}
                className={
                  'rounded px-2.5 py-1 text-2xs transition-colors ' +
                  (mode === m.id ? 'bg-surfaceHi text-brass' : 'text-fgMuted hover:text-fg')
                }
              >
                {m.label}
              </button>
            ))}
          </div>

          {mode === 'reach' && (
            <div className="flex items-center gap-1 rounded border border-line p-0.5">
              {(
                [
                  ['upstream', '它依赖谁'],
                  ['downstream', '谁依赖它'],
                ] as [ReachMode, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setReachMode(id)}
                  className={
                    'rounded px-2 py-1 text-2xs transition-colors ' +
                    (reachMode === id ? 'bg-surfaceHi text-brass' : 'text-fgMuted hover:text-fg')
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          {(focus || routeFrom || storyId) && (
            <button
              type="button"
              onClick={clear}
              className="rounded border border-line px-2 py-1 text-2xs text-fgMuted transition-colors hover:border-brass hover:text-brass"
            >
              清除（Esc）
            </button>
          )}

          <span className="text-2xs text-fgFaint">
            点击方块操作 · 快捷键 <span className="mono">U</span> 上游{' '}
            <span className="mono">D</span> 下游 <span className="mono">R</span> 路由{' '}
            <span className="mono">L</span> 透镜 <span className="mono">P</span> 导览{' '}
            <span className="mono">Esc</span> 清除
          </span>
        </div>
      </div>

      {/* ── 查询结果面板：把"凭什么这么说"摆出来，而不是只把图点亮 ── */}
      {mode === 'focus' && focus && (
        <div className="panel animate-fade-up p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xs text-fg">
              {titleOf(focus)}
              <span className="ml-2 text-2xs text-fgFaint">
                {graph.byDim.get(focus)?.role}
              </span>
            </span>
            <Chip tone={graph.byDim.get(focus)?.state === 'conflict' ? 'warn' : 'idle'}>
              {graph.byDim.get(focus)?.state}
            </Chip>
          </div>
          <div className="mt-2 space-y-1">
            <CapRow caps={graph.byDim.get(focus)?.provides ?? []} label="提供" />
            <CapRow caps={graph.byDim.get(focus)?.requires ?? []} label="索要" />
            {(graph.byDim.get(focus)?.unmet.length ?? 0) > 0 && (
              <div className="flex flex-wrap items-baseline gap-1.5">
                <span className="text-2xs" style={{ color: TONE.bad.color }}>
                  无人提供
                </span>
                {graph.byDim.get(focus)?.unmet.map((c) => (
                  <span key={c} className="text-2xs" style={{ color: TONE.bad.color }}>
                    {capLabel(c)}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {mode === 'reach' && (
        <div className="panel animate-fade-up p-3">
          {!focus ? (
            <p className="text-2xs text-fgMuted">先点一个方块，再看向上或向下能追到谁。</p>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-xs text-fg">
                  {reachMode === 'downstream' ? '谁依赖它' : '它依赖谁'}：
                  <span className="ml-1 text-brass">{titleOf(focus)}</span>
                </span>
                <Chip tone={reach?.nodes.length ? 'info' : 'idle'}>
                  {reach?.nodes.length ?? 0} 个槽位
                </Chip>
                <span className="text-2xs text-fgFaint">
                  只走 provides / requires 推导的依赖边 —— 这是「拆了它会连带谁」的答案
                </span>
              </div>
              {reach && reach.nodes.length > 0 ? (
                <>
                  <ul className="mt-2 space-y-1">
                    {reach.nodes.map((id) => (
                      <li key={id} className="flex flex-wrap items-baseline gap-2 text-2xs">
                        <span className="text-fg">{titleOf(id)}</span>
                        <span className="text-fgFaint">
                          {graph.byDim.get(id)?.laneId}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 border-t border-line pt-2">
                    <CapRow caps={reach.caps.map(capLabel)} label="沿途能力" />
                  </div>
                </>
              ) : (
                <p className="mt-2 text-2xs text-fgFaint">
                  没有别的槽位与它构成依赖 —— 它是这一层的叶子。
                </p>
              )}
            </>
          )}
        </div>
      )}

      {mode === 'route' && (
        <div className="panel animate-fade-up p-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-xs text-fg">通路探测</span>
            <Chip tone={routeFrom ? 'ok' : 'idle'}>起点 {routeFrom ? titleOf(routeFrom) : '待选'}</Chip>
            <Chip tone={routeTo ? 'ok' : 'idle'}>终点 {routeTo ? titleOf(routeTo) : '待选'}</Chip>
            {routeList.length > 1 && (
              <span className="text-2xs text-fgFaint">另有 {routeList.length - 1} 条等长路径</span>
            )}
          </div>

          {!routeFrom || !routeTo ? (
            <p className="mt-2 text-2xs text-fgMuted">
              点两个方块：先点起点，再点终点。层内流水线箭头也会被算作可走的路。
            </p>
          ) : !route ? (
            <p className="mt-2 text-2xs" style={{ color: TONE.warn.color }}>
              这两点之间没有有向通路。可能是只差一层却没有依赖关系，也可能确实走不通 ——
              图不会替你补一条不存在的边。
            </p>
          ) : (
            <>
              <ol className="mt-2 space-y-1.5">
                {route.hops.map((h: GraphEdge, i) => (
                  <li key={`${h.from}-${h.to}-${i}`} className="flex flex-wrap items-baseline gap-2 text-2xs">
                    <span className="mono text-fgFaint">{i + 1}</span>
                    <span className="text-fg">{titleOf(h.from)}</span>
                    <span className="text-fgFaint">→</span>
                    <span className="text-fg">{titleOf(h.to)}</span>
                    <Chip tone={h.kind === 'pipeline' ? 'warn' : 'ok'}>{edgeLabel(h)}</Chip>
                  </li>
                ))}
              </ol>
              {route.usesLayout && (
                <p className="mt-2 border-t border-line pt-2 text-2xs" style={{ color: TONE.warn.color }}>
                  这条路径用到了层内流水线箭头。那是<span className="text-fg">版式声明的请求顺序</span>，
                  不是提供 / 索要的依赖事实 —— 别拿它当"谁缺了谁跑不起来"的依据。
                </p>
              )}
            </>
          )}
        </div>
      )}

      {mode === 'lens' && (
        <div className="panel animate-fade-up p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-fg">角色透镜</span>
            {(
              [
                ['A', lensA, setLensA, lensB],
                ['B', lensB, setLensB, lensA],
              ] as const
            ).map(([slot, value, set, other]) => (
              <select
                key={slot}
                value={value ?? ''}
                onChange={(e) => set(e.target.value)}
                className="mono rounded border border-line bg-surfaceHi px-1.5 py-1 text-2xs text-fg"
              >
                {lanes.map((l) => (
                  // 对面那侧已经占着的泳道在这里禁掉：同一条跟同一条比没有差异面
                  <option key={l.id} value={l.id} disabled={l.id === other}>
                    {slot} · {l.glyph} {l.name}
                  </option>
                ))}
              </select>
            ))}
            <span className="text-2xs text-fgFaint">也可以直接点方块，把 B 换成它所在的泳道</span>
          </div>

          {lens && (
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {(
                [
                  // key 用固定槽位名，不用列标题 —— 列标题里嵌着泳道名，
                  // 两条泳道同名时（A 与 B 被设成同一条）标题会撞成同一个 key，
                  // React 会把其中一列丢掉或画重，面板看起来"少了一块"却没有任何报错。
                  ['both', '两边都提供', lens.providesShared, 'ok'],
                  ['a', `只有 ${lens.a.laneName} 提供`, lens.providesOnlyA, 'info'],
                  ['b', `只有 ${lens.b.laneName} 提供`, lens.providesOnlyB, 'info'],
                ] as [string, string, string[], 'ok' | 'info'][]
              ).map(([key, label, caps, tone]) => (
                <div key={key}>
                  <div className="mb-1 text-2xs text-fgFaint">{label}</div>
                  <div className="flex flex-wrap gap-1">
                    {caps.length ? (
                      caps.map((c, i) => (
                        <Chip key={`${key}-${i}-${c}`} tone={tone}>
                          {capLabel(c)}
                        </Chip>
                      ))
                    ) : (
                      <span className="text-2xs text-fgFaint">—</span>
                    )}
                  </div>
                </div>
              ))}
              <div className="md:col-span-3 border-t border-line pt-2">
                <div className="mb-1 text-2xs text-fgFaint">
                  索求面：{lens.a.laneName} 独有 {lens.requiresOnlyA.length} 项 ·{' '}
                  {lens.b.laneName} 独有 {lens.requiresOnlyB.length} 项 · 共同{' '}
                  {lens.requiresShared.length} 项
                </div>
                <div className="flex flex-wrap gap-1">
                  {lens.requiresOnlyA.map((c, i) => (
                    <Chip key={`a-${i}-${c}`} tone="idle">
                      {lens.a.laneName} ← {capLabel(c)}
                    </Chip>
                  ))}
                  {lens.requiresOnlyB.map((c, i) => (
                    <Chip key={`b-${i}-${c}`} tone="idle">
                      {lens.b.laneName} ← {capLabel(c)}
                    </Chip>
                  ))}
                </div>
                {(lens.a.unmet.length > 0 || lens.b.unmet.length > 0) && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {lens.a.unmet.map((c, i) => (
                      <Chip key={`ua-${i}-${c}`} tone="bad">
                        {lens.a.laneName} 缺 {capLabel(c)}
                      </Chip>
                    ))}
                    {lens.b.unmet.map((c, i) => (
                      <Chip key={`ub-${i}-${c}`} tone="bad">
                        {lens.b.laneName} 缺 {capLabel(c)}
                      </Chip>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {mode === 'story' && (
        <div className="panel animate-fade-up p-3">
          <div className="flex flex-wrap items-center gap-1">
            {stories.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setStoryId(s.id);
                  setFocus(s.focus[0] ?? null);
                }}
                className={
                  'rounded border px-2 py-1 text-2xs transition-colors ' +
                  (storyId === s.id
                    ? 'border-brass text-brass'
                    : 'border-line text-fgMuted hover:border-lineHi hover:text-fg')
                }
              >
                {s.label}
              </button>
            ))}
          </div>
          {story && (
            <div className="mt-2 space-y-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-xs text-fg">{story.label}</span>
                <Chip tone={story.source === 'preset' ? 'ok' : 'warn'}>
                  {story.source === 'preset' ? '手写预设' : '按当前选择算出'}
                </Chip>
                <Chip tone={story.focus.length ? 'idle' : 'ok'}>
                  {story.focus.length ? `${story.focus.length} 个槽位` : '无需更换'}
                </Chip>
              </div>
              <p className="text-2xs text-fgMuted">{story.note}</p>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded border border-line p-0.5">
          {(
            [
              ['dark', '跟随界面'],
              ['light', '文档浅色'],
            ] as [DiagramTheme, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTheme(id)}
              className={
                'rounded px-2.5 py-1 text-2xs transition-colors ' +
                (theme === id ? 'bg-surfaceHi text-brass' : 'text-fgMuted hover:text-fg')
              }
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setNote(
                `已下载 SVG（${built.width}×${built.height}，规范产物 · 不含当前高亮，${
                  downloadText(built.svg, `${projectDoc.artifactId}-architecture.svg`, 'image/svg+xml')
                } 字节）`
              )
            }
            className="rounded border border-line px-3 py-1.5 text-2xs text-fg transition-colors hover:border-brass hover:text-brass"
          >
            下载 SVG
          </button>
          <button
            type="button"
            onClick={downloadPng}
            className="rounded border border-line px-3 py-1.5 text-2xs text-fg transition-colors hover:border-brass hover:text-brass"
          >
            下载 PNG
          </button>
          <CopyButton text={archDiagramD2(model)} label="复制 D2 源码" />
          <CopyButton text={archDiagramMermaid(model)} label="复制 Mermaid 源码" />
        </div>
      </div>

      {note && <p className="text-2xs text-brass">{note}</p>}

      {/*
        图是文本拼出来的 SVG，内容全部由本仓库数据生成并按 XML 转义，没有外部输入。
        只在最外层容器上挂一个 click，靠 data-slot 事件委托定位方块 ——
        不给每个方块各挂一个 handler，也不必把 SVG 拆成 React 元素。
      */}
      <div
        className="grid-bg overflow-x-auto rounded-lg border border-line p-3"
        onClick={onCanvasClick}
        onKeyDown={onCanvasKey}
        style={{ cursor: 'pointer' }}
        dangerouslySetInnerHTML={{ __html: toResponsiveSvg(displaySvg) }}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-2xs text-fgFaint">
        <span>
          {model.lanes.length} 层 · {slotCount} 槽位 · 图尺寸 {built.width}×{built.height}
          {missingRequired > 0 && (
            <span style={{ color: TONE.bad.color }}> · {missingRequired} 个必需槽位空缺</span>
          )}
        </span>
        <span>
          导出包里的 <span className="mono">architecture.svg</span> 固定用浅色、且
          <span className="text-fgMuted">不含屏幕上的临时高亮</span> —— 它在文档里被看；
          同目录还带 <span className="mono">ARCHITECTURE.md</span> 与{' '}
          <span className="mono">.d2 / .mermaid</span> 源码。
        </span>
      </div>
    </div>
  );
}
