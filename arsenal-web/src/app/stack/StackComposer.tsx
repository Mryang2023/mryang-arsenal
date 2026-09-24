'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import CodeBlock from '@/components/CodeBlock';
import CopyButton from '@/components/CopyButton';
import {
  arch,
  auditArchitecture,
  nodeArch,
  skeletonPicks,
  slotsOfLane,
  STATUS_META,
  lanes,
} from '@/lib/arch';
import type { SlotState } from '@/lib/arch';
import {
  baseById,
  bases,
  composeStack,
  defaultBase,
  dimensionById,
  dimensions,
  emptyPicks,
  presetPicks,
  presets,
  renderConfigClassesMarkdown,
  renderOps,
  renderPrompt,
  renderYaml,
  stackScale,
} from '@/lib/stack';
import {
  buildExportPlan,
  formatBytes,
  projectDoc,
  renderAppClass,
} from '@/lib/project';
import { downloadZip } from '@/lib/zip';
import type { StackPicks } from '@/lib/content-types';
import Inspector from './Inspector';
import SlotBlock from './SlotBlock';
import type { SlotWeight } from './SlotBlock';
import DeliveryDeck from './DeliveryDeck';
import DeployGuides from './DeployGuides';
import { SlotWire, WireLayer } from './WireLayer';
import ProgressRing from './ProgressRing';
import { useStackHistory, type StackSnapshot } from './history';
import {
  clearProvenance,
  loadBaseSnapshot,
  loadProvenance,
  loadSnapshot,
  saveBaseSnapshot,
  savePicksSnapshot,
  type PicksProvenance,
} from '@/lib/picks-store';
import { emptyMeta, withParam, withTopology, type StackPicksMeta } from '@/lib/topology';
import { TONE } from './palette';

/**
 * 技术架构装配台。
 *
 * 与「勾选清单 + 出文本」的区别在于：这里先要回答一个问题 —— 拼起来能跑吗。
 * 画布上每个方块声明它提供什么能力、需要什么能力；校验求一次能力并集，
 * 缺的零件会以红色虚线块的形式留在原位，并写清缺它的后果；
 * 参与组合隐患的方块会直接把隐患标题写在脸上，而不是只标一个「有隐患」。
 *
 * 产物区按「你拿到手要干什么」分组，而不是按文件类型堆在一起：
 *   构建 / 源码 / 结构 / 交付
 * 最后一组是这次新增的重点 —— 结构图与一键导出。
 */

/**
 * 页签 id。**加了这里就必须在下面渲染区补一个 `tab === 'x'` 分支** ——
 * 只加 id 不加分支的后果是页签按钮在、点进去一片空白，而且没有任何东西会报错
 * （「技术架构图」就这么空了一段时间）。结构层断言守这条。
 *
 * S2-7（2026-09-24）：`tree` / `arch` / `risk` 三个页签已砍 —— 与右栏交付预览
 * 的「目录树 / 架构图 / 隐患」功能重叠，两处各养一份渲染是双倍维护。
 * 只留文件类页签；想看那三样走右侧交付预览（产物区页签条尾部有入口）。
 */
type TabId =
  | 'build' | 'yaml' | 'env'
  | 'app' | 'config' | 'code'
  | 'ops' | 'prompt' | 'deploy';

interface TabSpec {
  id: TabId;
  glyph: string;
  /** 动态标签（构建文件随选型变名字） */
  label: string;
  count?: number;
}

/** 技术栈基底的支持状态徽标（三档：支持中 / 已 EOL / 本平台未覆盖） */
const BASE_STATUS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  supported: { label: '支持中', color: '#3FB950', bg: 'rgba(63,185,80,0.12)', border: 'rgba(63,185,80,0.40)' },
  eol: { label: '已 EOL', color: '#D9A441', bg: 'rgba(217,164,65,0.12)', border: 'rgba(217,164,65,0.45)' },
  uncovered: { label: '未覆盖', color: '#93A39C', bg: 'transparent', border: '#243029' },
};

export default function StackComposer() {
  const [picks, setPicks] = useState<StackPicks>(() => presetPicks('standard'));
  /**
   * 技术栈基底（全局声明，**不是**选型维度）。
   *
   * 它只驱动「与基底绑定」的产物 —— pom 的 parent 版本、gradle 插件的
   * Spring Boot 版本。它不参与能力校验、不上架构图：基底是整个工程的前提，
   * 不是系统里的某个可勾选组件（做成维度会与「每维必有槽位」的图模型打架）。
   *
   * 初值与 picks 一样不读 localStorage（避免 SSR 首帧与客户端不一致），
   * 挂载后由 effect 写回。
   */
  const [baseId, setBaseId] = useState<string>(defaultBase);
  /**
   * 挂载标志 —— 存在的唯一理由是**首帧不能写盘**。
   *
   * `picks` 的初值是 standard 预设（刻意不读 localStorage，避免 SSR 首帧与
   * 客户端不一致），而写快照的 effect 在挂载后会立刻跑一次。没有这道闸门，
   * 打开页面的瞬间就会拿 standard 覆盖掉用户上次的选型，而且不报任何错。
   * 实测（2026-09-23）：塞 `{database:'postgres'}` 进 localStorage，打开 /stack
   * 再刷新，读到的是 `mysql` —— 刷新即丢失，且顺手把 /arch 正要读的快照也改了。
   */
  const [hydrated, setHydrated] = useState(false);
  /**
   * 选型出处：这套选型是从哪来的。只有「代码扫描」一种来源需要落盘，
   * 手工拼装没有出处可言。装配台是**唯一**消费它的地方 ——
   * 只写不读的键（例如 `arsenal-stack-detail-v1`）等于白写，别再加一个。
   */
  const [provenance, setProvenance] = useState<PicksProvenance | null>(null);
  /**
   * 集群形态与参数。与 `picks` **平行**的一条通道 ——
   * 选型回答「装哪块零件」，形态回答「装几个、怎么摆」。
   * 两者一起被持久化、一起进产物：清单里的副本数、架构图上的叠层、
   * 形态图的框数全部来自这里，没有第二处写死的数字。
   */
  const [meta, setMeta] = useState<StackPicksMeta>(() => emptyMeta());
  const [presetId, setPresetId] = useState<string | null>('standard');
  const [activeDim, setActiveDim] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('build');
  /**
   * 「点亮请求链路」开关（S1-4）。默认关 —— 动效是给「想看请求怎么穿」的人
   * 的放大镜，不是常驻装饰；关闭时连线退回 treeLine 静态实线，零动效。
   */
  const [flowOn, setFlowOn] = useState(false);
  /** 外部请求右栏切到的页签（S2-7：「看架构图」入口改走交付预览）；消费后回 null */
  const [deckFocus, setDeckFocus] = useState<'arch' | null>(null);
  const [showArtifacts, setShowArtifacts] = useState(true);
  const [exported, setExported] = useState<{ name: string; bytes: number; files: number } | null>(
    null
  );

  // ── 撤销 / 重做（S2-3）────────────────────────────────────
  // 快照在「写入前」记录；snapRef 每次提交后同步，保证事件回调里拿到的是最新状态
  const hist = useStackHistory();
  const snapRef = useRef<StackSnapshot>({ picks, meta, baseId });
  useEffect(() => {
    snapRef.current = { picks, meta, baseId };
  });

  /** 把历史快照放回三个 state。presetId 高亮与导出产物随之作废 */
  function restore(s: StackSnapshot) {
    setPicks(s.picks);
    setMeta(s.meta);
    setBaseId(s.baseId);
    setPresetId(null);
    setExported(null);
  }

  function undo() {
    const s = hist.undo(snapRef.current);
    if (s) restore(s);
  }

  function redo() {
    const s = hist.redo(snapRef.current);
    if (s) restore(s);
  }

  // Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z（及 Ctrl+Y）重做。
  // 文本输入框里不拦 —— 那是浏览器原生编辑语义，归输入框自己；下拉框没有文本编辑，不豁免。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key !== 'z' && e.key !== 'Z' && e.key !== 'y' && e.key !== 'Y') return;
      const t = e.target as HTMLElement | null;
      const typing =
        t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable === true;
      if (typing) return;
      e.preventDefault();
      if (e.shiftKey || e.key.toLowerCase() === 'y') redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * 挂载时恢复上次的选型 / 形态 / 基底 / 出处。
   *
   * **声明顺序是这个 effect 的全部要害**：它必须排在下面两个写入 effect 之前。
   * 挂载时 effect 按声明顺序执行，那一刻 `hydrated` 还是 false，写入 effect 直接
   * 返回；等这次 setState 引发重渲染、`hydrated` 翻成 true，写入 effect 才带着
   * 恢复出来的值跑一遍。顺序摆反（写入在前），恢复出来的值会被首帧的 standard
   * 盖掉 —— 现象与「压根没做恢复」一模一样，而那正是修之前的样子。
   *
   * 恢复出来若正好等于某个预设，就把该预设按钮点亮；是自定义组合则不高亮任何预设。
   */
  useEffect(() => {
    const snap = loadSnapshot();
    setPicks(snap.picks);
    setMeta(snap.meta);
    setBaseId(loadBaseSnapshot());
    setProvenance(loadProvenance());
    const matched = presets.find((p) =>
      dimensions.every((d) => (snap.picks[d.id] ?? '') === (p.picks[d.id] ?? ''))
    );
    setPresetId(matched ? matched.id : null);
    setHydrated(true);
  }, []);

  /**
   * 选型快照写回 localStorage —— 「架构图谱」页的技术架构视图从这里取数。
   *
   * 少了这一句，那边 loadPicksSnapshot() 永远读不到东西、静默回落到 standard
   * 预设：装配台换一套选型，架构图谱那张图纹丝不动，而且两边都不报错。
   * 这是一条跨页契约：装配台写，TechArch 与 ArchifyLab 读。
   */
  useEffect(() => {
    if (!hydrated) return;
    savePicksSnapshot(picks, meta);
  }, [picks, meta, hydrated]);

  // 基底单独持久化（与选型/形态分键，理由同 picks-store 顶部的说明）
  useEffect(() => {
    if (!hydrated) return;
    saveBaseSnapshot(baseId);
  }, [baseId, hydrated]);

  const currentBase = baseById.get(baseId);
  const audit = useMemo(() => auditArchitecture(picks), [picks]);
  const composed = useMemo(() => composeStack(picks), [picks]);
  const scale = useMemo(() => stackScale(composed), [composed]);
  const plan = useMemo(() => buildExportPlan(picks, audit, baseId), [picks, audit, baseId]);

  const yamlText = useMemo(() => renderYaml(composed), [composed]);
  const promptText = useMemo(() => renderPrompt(composed), [composed]);
  const configMd = useMemo(() => renderConfigClassesMarkdown(composed), [composed]);
  const appCode = useMemo(() => renderAppClass(picks), [picks]);
  // treeText / riskMd 随 S2-7 砍页签一并撤下：目录树与隐患单的唯一消费方
  // 是右栏交付预览，底部不再各养一份复制按钮。
  const ops = useMemo(() => renderOps(composed), [composed]);

  /** 槽位 → 它参与的组合隐患标题。「有隐患」三个字没有用，得说清是什么。 */
  const hazardsByDim = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const g of [...audit.blockers, ...audit.risks, ...audit.notes]) {
      for (const n of g.nodes) {
        if (!map[n]) map[n] = [];
        if (!map[n].includes(g.title)) map[n].push(g.title);
      }
    }
    return map;
  }, [audit]);

  // 同上：`meta` 已是形态/参数的 useState，状态文案改名 `statusMeta`，
  // 否则 138 行与 90 行同名重复声明，编译不过。
  const statusMeta = STATUS_META[audit.status];
  const tone = TONE[
    statusMeta.tone === 'bad' ? 'bad' : statusMeta.tone === 'warn' ? 'warn' : 'ok'
  ];

  const hazardCount = audit.blockers.length + audit.risks.length + audit.notes.length;
  const buildLabel = picks.build === 'gradle' ? 'build.gradle' : 'pom.xml';

  // S2-7：底部产物区只留文件类页签。目录树 / 架构图 / 隐患单在右栏交付预览
  // 有完整得多的版本（九块实时预览 vs 这里的一份静态渲染），两处各养一份
  // 渲染分支是双倍维护 + 「两边数据对不上」的隐患源。
  const TAB_GROUPS: { group: string; tabs: TabSpec[] }[] = [
    {
      group: '构建与配置',
      tabs: [
        { id: 'build', glyph: '◇', label: buildLabel },
        { id: 'yaml', glyph: '▤', label: 'application.yml' },
        { id: 'env', glyph: '⊘', label: '.gitignore' },
      ],
    },
    {
      group: 'Java 源码',
      tabs: [
        { id: 'app', glyph: '⬡', label: 'Application.java' },
        { id: 'config', glyph: '⚒', label: '配置类', count: composed.configClasses.length },
        { id: 'code', glyph: '⇄', label: '联动代码', count: composed.samples.length },
      ],
    },
    {
      group: '交付',
      tabs: [
        { id: 'ops', glyph: '▥', label: '运维清单' },
        { id: 'prompt', glyph: '⎘', label: '给 AI 的约束' },
      ],
    },
    {
      group: '部署',
      tabs: [{ id: 'deploy', glyph: '⚙', label: '部署指引' }],
    },
  ];

  function applyPicks(next: StackPicks, preset: string | null) {
    hist.record(snapRef.current);
    setPicks(next);
    // 换预设 = 换一整套发言。形态与参数是上一套留下的发言，必须一起清掉 ——
    // 否则「切到最小骨架」之后，K8s 清单里还写着上一套的 5 副本。
    setMeta(emptyMeta());
    setPresetId(preset);
    setExported(null);
    // 出处同理：换了一整套选型，上一套的出处就不代表现在这套了。
    // 留着它会在界面上写出「来自代码扫描」而实际选型已经全换的错话。
    clearProvenance();
    setProvenance(null);
  }

  function pick(dimId: string, optId: string) {
    hist.record(snapRef.current);
    setPicks((p) => ({ ...p, [dimId]: optId }));
    setPresetId(null);
    setExported(null);
  }

  function clear(dimId: string) {
    hist.record(snapRef.current);
    setPicks((p) => ({ ...p, [dimId]: '' }));
    setPresetId(null);
    setActiveDim(dimId);
    setExported(null);
  }

  /** 换集群形态。只写 meta，不碰 picks —— 形态不是「选项」的一部分 */
  function pickTopology(dimId: string, modeId: string) {
    hist.record(snapRef.current);
    setMeta((m) => withTopology(m, dimId, modeId));
    setPresetId(null);
    setExported(null);
  }

  /** 滑杆。五条参数写进 meta.params，产物侧一律从 `paramValue()` 读。
   *  同一条滑杆的连续拖动用 tag 合并成一步 —— 20 步栈不 serve 拖动噪音 */
  function setParam(key: string, value: number) {
    hist.record(snapRef.current, `param:${key}`);
    setMeta((m) => withParam(m, key, value));
    setPresetId(null);
    setExported(null);
  }

  /**
   * 跳到架构图。
   *
   * 架构图藏在产物区的「架构图」页签里（首屏看不到）。只把页签做出来不够 ——
   * 得让「看架构图」按钮真的把图亮出来，否则它和死按钮没两样，用户会说
   * 「装配台没有展示出软件架构图」。所以这里直接切到该页签（默认显示版式图），
   * 再滚到那一屏。
   */
  const productsRef = useRef<HTMLElement | null>(null);
  const deckRef = useRef<HTMLDivElement | null>(null);
  const benchRef = useRef<HTMLDivElement | null>(null);

  /**
   * 「看架构图」：点亮右栏交付预览的架构图页签 + 滚到那一屏。
   *
   * S2-7 之前它切的是底部产物区的 arch 页签；页签去重后架构图的唯一完整版
   * 在右栏（九块实时预览），入口改走 deckFocus 信号 —— DeliveryDeck 收到后
   * 自己切页签并回报「已消费」，这里只负责滚过去。注意必须**先给信号再滚**，
   * 顺序反了会滚到一个还没长出图来的位置。
   */
  function focusArch() {
    setDeckFocus('arch');
    requestAnimationFrame(() => {
      deckRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function handleExport() {
    const name = `${projectDoc.artifactId}-${plan.kind}.zip`;
    const bytes = downloadZip(
      plan.files.map((f) => ({ path: f.path, content: f.content })),
      name
    );
    setExported({ name, bytes, files: plan.files.length });
  }

  const missingRequired = audit.stats.requiredTotal - audit.stats.requiredFilled;

  return (
    <div className="space-y-4">
      {/* 页面级主标题：装配台是画布式界面，视觉上没有传统页头，
          所以用 sr-only 给屏幕阅读器与文档大纲留一个唯一的 h1（视觉零变化）。 */}
      <h1 className="sr-only">架构装配台</h1>
      {/* ── 顶部：这套组合能不能跑（S1-5 闭环仪表） ────────────── */}
      <div
        className="panel flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3.5"
        style={{ borderColor: tone.border, background: tone.soft }}
      >
        {/* 必选覆盖率环：三档结论（✓ 能跑 / ! 零件不全 / × 跑不起来）的量化面。
            tone 与三档同源 —— ring 的颜色就是结论的颜色，不另设一套。 */}
        <ProgressRing
          ratio={audit.stats.requiredTotal > 0 ? audit.stats.requiredFilled / audit.stats.requiredTotal : 0}
          tone={tone.color}
          size={44}
        />
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="mono flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[14px] leading-none"
            style={{ background: tone.soft, color: tone.color, border: `1px solid ${tone.border}` }}
          >
            {audit.status === 'runnable' ? '✓' : audit.status === 'incomplete' ? '!' : '×'}
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold leading-tight" style={{ color: tone.color }}>
              {statusMeta.label}
            </p>
            <p className="mt-1 text-2xs leading-relaxed text-fgMuted">
              {audit.status === 'broken' ? (
                <>
                  缺 <span style={{ color: '#E5484D' }}>{missingRequired}</span> 个必需模块
                  {audit.blockers.length - missingRequired > 0 && (
                    <>
                      ，另有{' '}
                      <span style={{ color: '#E5484D' }}>
                        {audit.blockers.length - missingRequired}
                      </span>{' '}
                      处能力没人提供
                    </>
                  )}
                  —— 这样的组合启动就会失败。
                </>
              ) : (
                <>
                  {statusMeta.summary}
                  {hazardCount > 0 && (
                    <>
                      　其中{' '}
                      <span style={{ color: '#D9A441' }}>{hazardCount}</span> 条隐患已写明触发条件与现象。
                    </>
                  )}
                </>
              )}
            </p>
          </div>
        </div>

        {/* 33 格点阵（S1-5）：每个格子 = 一个槽位 = dimensions 里的一维，
            颜色与卡片同规则（filled 绿 / conflict 黄 / missing-required 红虚线 /
            其余灰）。格子太小说明不了问题，所以带 title 与点击直达 ——
            它是结论的「哪儿不对」索引，不是装饰条。 */}
        <SlotDotMatrix
          slotStates={audit.slotStates}
          activeDim={activeDim}
          onSelect={(dimId) => {
            setActiveDim(dimId);
            requestAnimationFrame(() => {
              benchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
          }}
        />

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {/* 撤销 / 重做（S2-3）：数字是栈深；滑杆连续拖动合并为一步。
              回退到底后按钮禁用，不提供假按钮 */}
          <button
            type="button"
            onClick={undo}
            disabled={hist.undoSteps === 0}
            title="撤销 (Ctrl+Z)"
            className="mono flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={{ borderColor: '#243029', color: hist.undoSteps > 0 ? '#93A39C' : '#5E6E67' }}
          >
            ↶ {hist.undoSteps}
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={hist.redoSteps === 0}
            title="重做 (Ctrl+Shift+Z)"
            className="mono flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={{ borderColor: '#243029', color: hist.redoSteps > 0 ? '#93A39C' : '#5E6E67' }}
          >
            ↷ {hist.redoSteps}
          </button>
          {/* 技术栈基底：全局声明，不进选型维度。它决定导出骨架里的 Spring Boot 版本 */}
          <span className="mono mr-0.5 text-[10px] uppercase tracking-wider text-fgFaint">基底</span>
          <select
            value={baseId}
            onChange={(e) => {
              hist.record(snapRef.current);
              setBaseId(e.target.value);
            }}
            className="rounded-md border px-2 py-1 text-[11px] outline-none"
            style={{ borderColor: '#243029', background: 'transparent', color: '#CFDCD6' }}
            title={
              currentBase
                ? `${currentBase.summary}${currentBase.note ? '\n\n' + currentBase.note : ''}`
                : '技术栈基底'
            }
          >
            {bases.map((b) => (
              <option key={b.id} value={b.id} style={{ background: '#16211F', color: '#CFDCD6' }}>
                {b.name}
                {b.covered ? ` ${b.version}` : '（未覆盖）'}
              </option>
            ))}
          </select>
          {currentBase && (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] leading-[14px]"
              style={{
                color: (BASE_STATUS[currentBase.status] ?? BASE_STATUS.uncovered).color,
                background: (BASE_STATUS[currentBase.status] ?? BASE_STATUS.uncovered).bg,
                border: `1px solid ${(BASE_STATUS[currentBase.status] ?? BASE_STATUS.uncovered).border}`,
              }}
              title={currentBase.summary}
            >
              {(BASE_STATUS[currentBase.status] ?? BASE_STATUS.uncovered).label}
            </span>
          )}
          {currentBase && currentBase.status === 'eol' && currentBase.supportedUntil && (
            <span className="text-[10px] text-fgFaint">支持止于 {currentBase.supportedUntil}</span>
          )}
          {currentBase && !currentBase.covered && (
            <span className="text-[10px] text-fgFaint" title={currentBase.note}>
              产物仍按 Spring Boot 骨架导出
            </span>
          )}
          <span className="mx-1 h-[16px] w-px bg-line" />
          <span className="mono mr-0.5 text-[10px] uppercase tracking-wider text-fgFaint">预设</span>
          {presets.map((p) => {
            const on = presetId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPicks(presetPicks(p.id), p.id)}
                title={p.summary}
                className="rounded-md border px-2 py-1 text-[11px] transition-colors"
                style={{
                  borderColor: on ? 'rgba(217,164,65,0.6)' : '#243029',
                  background: on ? 'rgba(217,164,65,0.10)' : 'transparent',
                  color: on ? '#D9A441' : '#93A39C',
                }}
              >
                {p.name}
              </button>
            );
          })}
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
          <span className="mx-1 h-[16px] w-px bg-line" />
          <button
            type="button"
            onClick={focusArch}
            className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors"
            style={{
              borderColor: 'rgba(217,164,65,0.6)',
              background: 'rgba(217,164,65,0.12)',
              color: '#D9A441',
            }}
            title="把这套组合画成架构图：缺什么、请求怎么穿过、哪块有隐患，一眼看到；可下载 SVG / PNG 或复制 D2 / Mermaid 源码"
          >
            <span className="mono text-[12px] leading-none">⊞</span>
            看架构图
          </button>
          <Link
            href="/arch"
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
            title="六大架构图谱：业务 / 数据 / 应用 / 技术 / 产品 / 项目"
          >
            <span className="mono text-[12px] leading-none">▣</span>
            六大架构
          </Link>
        </div>
      </div>

      {/* ── 选型出处：这套选型是扫描读出来的，还是人点出来的 ───────
          一个槽位填着 redis，用户必须能问出「这是谁填的、凭什么」。
          扫描填的（有一行 pom.xml:47 做证据）和人手点的，可信度不是一回事。 */}
      {provenance && (
        <ProvenanceBanner
          provenance={provenance}
          picks={picks}
          onDismiss={() => {
            clearProvenance();
            setProvenance(null);
          }}
        />
      )}

      {/* ── 左：装配 ───────────── 右：交付预览（常驻，实时） ───── */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-surface px-4 py-2 text-[10px] leading-[15px] text-fgMuted">
            <p className="min-w-0 flex-1">
              点任意方块 → 在右侧选零件、换<span className="text-fg">集群形态</span>（单实例 /
              主从 / 组复制 / 分片 / 云原生，图形化切换）；右侧的交付预览会立刻跟着变。
              下方五根滑杆直接写进 yaml 与交付清单。
            </p>
            <button
              type="button"
              onClick={() => setFlowOn((v) => !v)}
              aria-pressed={flowOn}
              className="flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] transition-colors"
              style={
                flowOn
                  ? { borderColor: 'rgba(217,164,65,0.6)', background: 'rgba(217,164,65,0.12)', color: '#D9A441' }
                  : { borderColor: '#243029', background: 'transparent', color: '#93A39C' }
              }
              title="把请求真正流经的连线点亮成流动虚线（泳道间的竖线 + 链路上的箭头）；旁路件不亮。再点一次熄灭"
            >
              <span className="mono text-[11px] leading-none">{flowOn ? '⚡' : '⌀'}</span>
              {flowOn ? '链路已点亮' : '点亮请求链路'}
            </button>
          </div>
          {/* 台面（L0）：34px 网格底 + 比 surface 暗一档的底色。
              泳道面板（L1）浮在台面上、零件卡（L2）浮在面板上 ——
              三层深度全部靠底色差与边框表达，不引进第二种配色。 */}
          <div ref={benchRef} className="stack-bench scroll-mt-4 space-y-1.5 rounded-lg border border-line p-1.5 sm:p-2">
          {lanes.map((lane, laneIdx) => {
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
                <section className="panel flex overflow-hidden">
                  {/* 泳道标签列（竖轴）：固定 30/34px，不随卡片换行移动。
                      原来表头横排在顶部，七根泳道看不出「上下穿过」的先后。 */}
                  <div className="flex w-[30px] shrink-0 flex-col items-center gap-2 border-r border-line bg-[rgba(255,255,255,0.015)] py-2.5 sm:w-[34px]">
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
                              onClick={() => setActiveDim(dimId)}
                              onClear={() => clear(dimId)}
                              picks={picks}
                              meta={meta}
                              onTopology={pickTopology}
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

        <div ref={deckRef} className="scroll-mt-4 space-y-4 xl:sticky xl:top-4 xl:self-start">
          {/* 零件库只在选中某个方块时出现；没选中时右栏整块留给交付预览 ——
              预览是常驻的，不能被一个空面板挤到屏幕外面去。
              「这套组合能不能跑」的结论没有丢：它就是预览里「总览」那一块。 */}
          {activeDim && (
            <Inspector
              audit={audit}
              activeDim={activeDim}
              picks={picks}
              meta={meta}
              onPick={pick}
              onClear={clear}
              onTopology={pickTopology}
              onClose={() => setActiveDim(null)}
              onFocusDim={(d) => setActiveDim(d)}
            />
          )}

          <DeliveryDeck
            picks={picks}
            meta={meta}
            audit={audit}
            composed={composed}
            baseId={baseId}
            onParam={setParam}
            focusTab={deckFocus}
            onFocusConsumed={() => setDeckFocus(null)}
          />
        </div>
      </div>

      {/* ── 产物 ──────────────────────────────────────────── */}
      <section ref={productsRef} className="panel scroll-mt-4 overflow-hidden">
        <header className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-line px-4 py-2.5">
          <span className="mono text-[13px] leading-none text-brass">⎗</span>
          <h3 className="text-2xs font-semibold text-fg">这套组合的产物</h3>
          <span className="mono text-[10px] text-fgFaint">
            {scale.deps} 个依赖 · {scale.configClasses} 个配置类 · {plan.files.length} 个可导出文件 ·{' '}
            {formatBytes(plan.bytes)}
          </span>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={handleExport}
              className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors"
              style={{
                borderColor: 'rgba(217,164,65,0.6)',
                background: 'rgba(217,164,65,0.12)',
                color: '#D9A441',
              }}
              title={`打包 ${plan.files.length} 个文件为 zip：构建文件、启动类、配置类、迁移脚本、README、隐患单、架构图与技术说明`}
            >
              <span className="mono text-[12px] leading-none">⇩</span>
              一键导出项目
            </button>
            <button
              type="button"
              onClick={() => setShowArtifacts((v) => !v)}
              className="mono text-[10px] text-fgFaint hover:text-fg"
            >
              {showArtifacts ? '收起' : '展开'}
            </button>
          </div>
        </header>

        {/* 导出反馈：告诉用户包里到底装了什么，以及下一步怎么跑 */}
        {exported && (
          <div
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-4 py-2.5"
            style={{ background: 'rgba(127,166,80,0.07)' }}
          >
            <span className="mono text-[11px] leading-none" style={{ color: '#7FA650' }}>
              ✓
            </span>
            <p className="text-2xs text-fgMuted">
              已导出 <span className="mono text-fg">{exported.name}</span>
              <span className="mx-2 text-fgFaint">·</span>
              {exported.files} 个文件 · {formatBytes(exported.bytes)}
              {exported.bytes > 0 && (
                <>
                  <span className="mx-2 text-fgFaint">·</span>
                  解压后 {plan.kind === 'maven' ? 'mvn spring-boot:run' : './gradlew bootRun'} 即可启动
                </>
              )}
            </p>
            <button
              type="button"
              onClick={() => setExported(null)}
              className="mono ml-auto text-[10px] text-fgFaint hover:text-fg"
            >
              知道了
            </button>
          </div>
        )}

        {audit.status === 'broken' && (
          <div
            className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-4 py-2"
            style={{ background: 'rgba(229,72,77,0.07)' }}
          >
            <span className="mono text-[11px] leading-none" style={{ color: '#E5484D' }}>
              !
            </span>
            <p className="text-[10px] leading-[15px] text-fgMuted">
              当前组合还缺必需模块，导出的骨架同样不完整 —— 先把红色的块补上再导。
            </p>
          </div>
        )}

        {showArtifacts && (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2">
              {TAB_GROUPS.map((g, gi) => (
                <Fragment key={g.group}>
                  {gi > 0 && <span className="h-[16px] w-px bg-line" />}
                  <div className="flex items-center gap-1">
                    <span className="mono mr-0.5 text-[10px] uppercase tracking-wider text-fgFaint">
                      {g.group}
                    </span>
                    {g.tabs.map((t) => {
                      const on = tab === t.id;
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setTab(t.id)}
                          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors"
                          style={{
                            background: on ? 'rgba(217,164,65,0.10)' : 'transparent',
                            color: on ? '#D9A441' : '#93A39C',
                          }}
                        >
                          <span className="mono text-[11px] leading-none">{t.glyph}</span>
                          {t.label}
                          {t.count !== undefined && t.count > 0 && (
                            <span className="mono text-[10px] text-fgFaint">{t.count}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </Fragment>
              ))}

              {/* S2-7：目录树 / 架构图 / 隐患单三个页签已收编进右栏交付预览
                  （那边是九块实时预览，比这里的一份静态渲染完整）。砍页签不砍入口。 */}
              <span className="h-[16px] w-px bg-line" />
              <button
                type="button"
                onClick={() => {
                  setDeckFocus('arch');
                  requestAnimationFrame(() => {
                    deckRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  });
                }}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-fgMuted transition-colors hover:text-fg"
                title="目录树、架构图、隐患单在右侧交付预览里 —— 图都是实时算出来的"
              >
                <span className="mono text-[11px] leading-none">⬢</span>
                目录树 / 架构图 / 隐患单 → 右侧交付预览
              </button>
            </div>

            <div className="p-4">
              {tab === 'build' && (
                <div className="space-y-3">
                  <Hint
                    text={
                      plan.kind === 'maven'
                        ? '依赖按模块分组并去重。业务依赖一律不写 version —— 版本交给 parent BOM 统一管理。只包含你实际装上的零件。'
                        : 'Gradle 的 scope 与 Maven 不是一一对应：注解处理器（Lombok、MapStruct）必须同时进 compileOnly 与 annotationProcessor，少写后者时编译能过、生成的 getter 却是红的。'
                    }
                  />
                  {plan.files
                    .filter((f) => f.group === '构建' && f.path !== '.gitignore')
                    .map((f) => (
                      <CodeBlock
                        key={f.path}
                        code={f.content}
                        lang={f.path.endsWith('.xml') ? 'xml' : 'text'}
                        label={f.path}
                      />
                    ))}
                </div>
              )}

              {tab === 'yaml' && (
                <div className="space-y-3">
                  <Hint text="每段都标注了它来自哪一块。键名可直接使用，不要自行发明配置键。导出的 zip 里还带 application-dev / application-prod 两份 profile。" />
                  <CodeBlock code={yamlText} lang="yaml" label="application.yml" />
                </div>
              )}

              {tab === 'env' && (
                <div className="space-y-3">
                  <Hint text="这一份看着不起眼，但它是防密钥泄漏的最后一道机械防线 —— 把 .env 与 application-local.yml 排除掉，靠的是版本控制而不是人的记性。" />
                  <CodeBlock code={projectDoc.files.gitignore} lang="text" label=".gitignore" />
                </div>
              )}

              {tab === 'app' && (
                <div className="space-y-4">
                  <Hint text="启动类只有两个职责：包扫描锚点、以及必须在此生效的扫描注解。所有 @EnableXxx 都放在各自的配置类里 —— 这就是下面那张「开关归属表」存在的意义：让你一眼看出为什么这个类这么空。" />
                  <CodeBlock code={appCode} lang="java" label="Application.java" />

                  <section className="panel overflow-hidden">
                    <header className="border-b border-line px-4 py-2.5">
                      <h4 className="text-2xs font-semibold text-fg">全局开关归属表</h4>
                      <p className="mt-1 text-[10px] leading-[15px] text-fgMuted">
                        当前组合里每一个全局开关由谁负责。删掉哪个配置类，等于关掉对应的开关 ——
                        这是把开关分散出去换来的好处：归属关系是可验证的。
                      </p>
                    </header>
                    <ul className="divide-y divide-line">
                      {projectDoc.switchOwners
                        .filter((s) => {
                          if (!s.when) return true;
                          return Object.entries(s.when).every(([dim, opts]) =>
                            picks[dim] ? opts.includes(picks[dim]) : false
                          );
                        })
                        .map((s) => (
                          <li
                            key={`${s.switch}-${s.owner}`}
                            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5"
                          >
                            <code className="mono w-[210px] shrink-0 text-2xs text-brass">
                              {s.switch}
                            </code>
                            <code className="mono w-[180px] shrink-0 text-[10px] text-fgMuted">
                              {s.owner}
                            </code>
                            <span className="min-w-0 flex-1 text-[10px] leading-[15px] text-fgMuted">
                              {s.why}
                            </span>
                          </li>
                        ))}
                    </ul>
                  </section>
                </div>
              )}

              {tab === 'config' && (
                <div className="space-y-4">
                  <Hint text="当前组合下必须存在的 Java 配置类。漏掉的后果通常不是报错，而是某个功能静默失效（例如忘记注册分页插件）。" />
                  {composed.configClasses.length === 0 ? (
                    <Empty text="当前组合不需要额外的 Java 配置类 —— 自动配置已经覆盖。" />
                  ) : (
                    composed.configClasses.map((c, i) => (
                      <CodeBlock
                        key={i}
                        code={c.code}
                        lang="java"
                        label={`${c.className} — ${c.path}`}
                      />
                    ))
                  )}
                  {composed.configClasses.length > 1 && (
                    <div className="flex justify-end">
                      <CopyButton text={configMd} label="复制全部配置类（Markdown）" />
                    </div>
                  )}
                </div>
              )}

              {tab === 'code' && (
                <div className="space-y-4">
                  <Hint text="选型不是「装个依赖」就完事 —— 它会改变你怎么写代码。这里是持久层、鉴权、缓存等零件对业务代码的实际影响。" />
                  {composed.samples.length === 0 ? (
                    <Empty text="当前组合没有额外的联动代码示例。" />
                  ) : (
                    composed.samples.map((s, i) => (
                      <CodeBlock
                        key={i}
                        code={s.code}
                        lang={s.lang}
                        label={`${s.dimName} · ${s.optName} — ${s.title}`}
                      />
                    ))
                  )}
                </div>
              )}

              {tab === 'ops' && (
                <div className="space-y-4">
                  {ops.length === 0 && composed.env.length === 0 ? (
                    <Empty text="当前组合没有额外的运维动作 —— 起一个数据库就能跑。" />
                  ) : (
                    <>
                      {ops.length > 0 && (
                        <section className="panel overflow-hidden">
                          <div className="border-b border-line px-4 py-3">
                            <h4 className="text-[13px] font-semibold text-fg">上线前要做的事</h4>
                          </div>
                          <ol className="divide-y divide-line">
                            {ops.map((o, i) => (
                              <li key={i} className="flex gap-3 px-4 py-2.5">
                                <span
                                  className="mono mt-[1px] flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded border text-[10px]"
                                  style={{ borderColor: 'rgba(217,164,65,0.4)', color: '#D9A441' }}
                                >
                                  {i + 1}
                                </span>
                                <span className="text-2xs leading-relaxed text-fgMuted">{o}</span>
                              </li>
                            ))}
                          </ol>
                        </section>
                      )}

                      {composed.env.length > 0 && (
                        <section className="panel overflow-hidden">
                          <div className="border-b border-line px-4 py-3">
                            <h4 className="text-[13px] font-semibold text-fg">
                              需要配置的环境变量
                            </h4>
                            <p className="mt-1 text-2xs text-fgFaint">
                              密钥一律走环境变量，不要写进 application.yml。
                            </p>
                          </div>
                          <ul className="divide-y divide-line">
                            {composed.env.map((e, i) => (
                              <li
                                key={i}
                                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5"
                              >
                                <code className="mono text-2xs" style={{ color: '#D9A441' }}>
                                  {e.key}
                                </code>
                                <span className="text-2xs text-fgMuted">{e.desc}</span>
                                <span className="mono ml-auto text-[10px] text-fgFaint">
                                  {e.dimName}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}
                    </>
                  )}
                </div>
              )}

              {tab === 'deploy' && <DeployGuides picks={picks} meta={meta} />}

              {tab === 'prompt' && (
                <div className="space-y-3">
                  <Hint text="把这段贴给任何 AI，它就不会再给你换成别的技术栈 —— 这是「一份数据三种出口」里「给 AI 用」那条路。" />
                  <CodeBlock
                    code={promptText}
                    lang="text"
                    label="技术选型约束 · System Prompt 片段"
                  />
                </div>
              )}
            </div>
          </>
        )}
      </section>

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
}

/**
 * 33 格槽位点阵（S1-5）。
 *
 * 一格 = 一个槽位 = dimensions 里的一维；颜色规则与零件卡**同一份映射**
 * （filled → ok / conflict → warn / missing-required → bad，其余 idle）——
 * 在这里另写一套颜色语义就违反「语义色只许 TONE 五色、含义不许复用」。
 *
 * 它回答的是「三档结论说不对，那到底哪儿不对」：一格一个槽位扫一眼，
 * 点击直达该槽位（选中 + 滚到台面）。格数必须等于 dimensions.length ——
 * 点阵不是装饰，少一格就有一个槽位没被索引到（【18】断言守着）。
 */
function SlotDotMatrix({
  slotStates,
  activeDim,
  onSelect,
}: {
  slotStates: Record<string, SlotState>;
  activeDim: string | null;
  onSelect: (dimId: string) => void;
}) {
  const STATE_LABEL: Record<SlotState, string> = {
    filled: '已装配',
    conflict: '参与组合隐患',
    'missing-required': '必选未装 —— 跑不起来',
    'missing-recommended': '建议件未装',
    empty: '可选未装',
  };
  return (
    <div className="flex items-center gap-2">
      <span className="mono shrink-0 text-[10px] uppercase leading-[15px] tracking-wider text-fgFaint">
        {dimensions.length} 格
      </span>
      <div className="flex max-w-[272px] flex-wrap items-center gap-[3px]">
        {dimensions.map((d) => {
          const st = slotStates[d.id] ?? 'empty';
          const t =
            st === 'missing-required' ? TONE.bad
              : st === 'conflict' ? TONE.warn
                : st === 'filled' ? TONE.ok
                  : TONE.idle;
          const dashed = st !== 'filled' && st !== 'conflict';
          return (
            <button
              key={d.id}
              type="button"
              data-dim={d.id}
              data-state={st}
              onClick={() => onSelect(d.id)}
              title={`${d.name} · ${STATE_LABEL[st]}（点击直达该槽位）`}
              aria-label={`${d.name}：${STATE_LABEL[st]}`}
              className={
                'h-[10px] w-[10px] rounded-sm border transition-transform hover:scale-125 ' +
                (activeDim === d.id ? 'ring-1 ring-brass ring-offset-1 ring-offset-transparent' : '')
              }
              style={{
                borderColor: t.border,
                borderStyle: dashed ? 'dashed' : 'solid',
                background: t.soft,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function findOption(dimId: string, optId: string) {
  return dimensionById.get(dimId)?.options.find((o) => o.id === optId);
}

/**
 * 空态引导（S1-7，顺带治 V2-13「网关路由卡只有放大一个『无』」）。
 *
 * 「未使用」有两种形态，都得给引导：没选（`picks[dimId]` 为空），以及选了事实源里的
 * `none` 那一档（「不用消息队列」「无」）。只处理前一种的话，默认态 33 格全是
 * `filled`，引导一行都不会出现。
 *
 * 给的两行：
 *   ① 装什么 —— 维度 `defaultOption`；它若本身就是「不用」，取第一个真正的零件；
 *   ② 装了有什么用 —— 该选项的 summary，没有就退回维度 why。
 * 两者都来自事实源，不在这里编文案。
 */
function slotHint(dimId: string, picked: string | undefined) {
  const dim = dimensionById.get(dimId);
  if (!dim) return undefined;
  const unused = !picked || picked === 'none';
  if (!unused) return undefined;
  const opt =
    (dim.defaultOption !== 'none' && dim.options.find((o) => o.id === dim.defaultOption)) ||
    dim.options.find((o) => o.id !== 'none');
  if (!opt) return undefined;
  return { name: opt.name, use: opt.summary || dim.why };
}

function Hint({ text }: { text: string }) {
  return (
    <p className="rounded-md border border-line bg-surface px-4 py-2.5 text-2xs leading-relaxed text-fgMuted">
      {text}
    </p>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="panel px-5 py-8 text-center">
      <p className="text-2xs text-fgFaint">{text}</p>
    </div>
  );
}

/**
 * 选型出处横幅。
 *
 * 三件事必须同时说清，缺一件这条横幅就退化成一块装饰：
 *   ① **从哪来** —— 仓库根路径与扫描时间；
 *   ② **凭什么** —— 每个槽位的出处（依赖坐标的文件:行号 / 部署清单文件名）；
 *   ③ **哪些不是它填的** —— 扫描之后被人改过的格子单独数出来。
 *
 * 少了 ③，用户会以为整张画布 33 格都是扫描读出来的；
 * 少了 ①②，就只剩一句「来自代码扫描」的空话。
 * 这三条的写法与「隐患必须带 trigger/symptoms/impact」是同一条规矩：
 * 给结论就得给出能核对它的东西。
 */
function ProvenanceBanner({
  provenance,
  picks,
  onDismiss,
}: {
  provenance: PicksProvenance;
  picks: StackPicks;
  onDismiss: () => void;
}) {
  const [open, setOpen] = useState(false);
  const edited = dimensions.filter(
    (d) => (provenance.atScan[d.id] ?? '') !== (picks[d.id] ?? '')
  );
  const editedDims = new Set(edited.map((d) => d.id));

  return (
    <section
      className="panel overflow-hidden"
      style={{ borderColor: 'rgba(217,164,65,0.35)', background: 'rgba(217,164,65,0.05)' }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
        <span className="mono text-[12px] leading-none" style={{ color: '#D9A441' }}>
          ⌕
        </span>
        <p className="text-2xs text-fg">
          本次选型来自<span className="text-brass">代码扫描</span>
          <span className="mono ml-1.5 text-[10px] text-fgMuted">{provenance.root}</span>
        </p>
        <span className="mono text-[10px] text-fgFaint">
          {provenance.fromDeps.length} 格来自依赖声明
          {provenance.fromDeploy.length > 0 && ` · ${provenance.fromDeploy.length} 格来自部署清单`}
          {provenance.conflicts.length > 0 && ` · ${provenance.conflicts.length} 处同维冲突`}
          {provenance.unmatchedCount > 0 && ` · ${provenance.unmatchedCount} 项未识别`}
        </span>
        {edited.length > 0 && (
          <span className="mono text-[10px]" style={{ color: '#D9A441' }}>
            其中 {edited.length} 格已被你改过
          </span>
        )}
        <div className="ml-auto flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mono text-[10px] text-fgFaint transition-colors hover:text-fg"
          >
            {open ? '收起出处' : '看出处'}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="mono text-[10px] text-fgFaint transition-colors hover:text-fg"
            title="清掉这条出处 —— 之后这套选型按手工拼装看待"
          >
            知道了
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-line px-4 py-2.5">
          <ul className="space-y-1 text-[10px] leading-[15px] text-fgMuted">
            {provenance.fromDeps.map((d) => (
              <li key={`pv-dep-${d.dim}`} className="mono">
                <span className="text-fg">
                  {d.dim}={d.opt}
                </span>
                <span className="text-fgFaint">
                  {' '}
                  ← {d.tech} · {d.path}:{d.line}
                </span>
                {editedDims.has(d.dim) && <span style={{ color: '#D9A441' }}> · 已改动</span>}
              </li>
            ))}
            {provenance.fromDeploy.map((d) => (
              <li key={`pv-dp-${d.dim}`} className="mono">
                <span className="text-fg">
                  {d.dim}={d.opt}
                </span>
                <span className="text-fgFaint"> ← 部署清单 {d.because}</span>
              </li>
            ))}
            {provenance.conflicts.map((c) => (
              <li key={`pv-cf-${c.dim}`} className="mono" style={{ color: '#E5A33D' }}>
                · {c.dim} 命中多个候选，取了 {c.kept}；另有 {c.dropped.join('、')} 未采用
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-fgFaint">
            未识别的依赖不会静默丢弃 —— 明细在
            <Link href="/arch" className="text-fgMuted underline underline-offset-2">
              「六大架构」页的代码扫描入口
            </Link>
            里逐条列出。
            {provenance.scannedAt && <>　扫描时间 {provenance.scannedAt}</>}
          </p>
        </div>
      )}
    </section>
  );
}
