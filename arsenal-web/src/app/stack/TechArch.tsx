'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CopyButton from '@/components/CopyButton';
import { downloadText } from '@/lib/zip';
import { projectDoc } from '@/lib/project';
import type { StackPicks } from '@/lib/content-types';
import { TECH_ICONS, iconName, type TechIcon } from '@/lib/tech-icons';
import {
  buildTechArch,
  buildTechArchSvg,
  emptyEdits,
  techArchMarkdown,
  type CanvasEdits,
  type CanvasNode,
  type CanvasTheme,
} from '@/lib/arch-canvas';
import { archifyIrFilename, archifyIrIssues, buildArchifyIr } from '@/lib/archify-ir';
import { presetPicks } from '@/lib/stack';
import { loadPicksSnapshot } from '@/lib/picks-store';
import {
  arsenalApiBase,
  deliverArchify,
  probeArchify,
  type ArchifyDiagnostic,
  type ArchifyReceipt,
  type ArchifyStatus,
} from '@/lib/arsenal-api';

/**
 * 技术架构图 —— 交付用，可编辑。
 *
 * 与「架构图」页签的分工：那张图回答「谁依赖谁」，选型时用；
 * 这张图回答「部署出来长什么样」，是贴进技术说明书、发给同事与客户的。
 *
 * 编辑原则：**改的是「画在图上的说法」，不是「系统是什么」**。
 * 拖动、改名、选集群形态、加自定义节点，都不会碰选型数据 ——
 * 改选型去装配台，图会自己跟着变；这里改的只是交付物的呈现。
 */

const STORAGE_KEY = 'arsenal-tech-arch-edits-v1';

function loadEdits(): CanvasEdits {
  if (typeof window === 'undefined') return emptyEdits();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyEdits();
    const parsed = JSON.parse(raw) as CanvasEdits;
    return { ...emptyEdits(), ...parsed };
  } catch {
    return emptyEdits();
  }
}

const ZONE_OPTIONS = [
  { id: 'app', name: '应用服务' },
  { id: 'mw', name: '中间件' },
  { id: 'data', name: '数据存储' },
  { id: 'ops', name: '观测与运维' },
];

/** 一张已经渲染出来的成品图。 */
interface Artifact {
  html: string;
  receipt: ArchifyReceipt;
  elapsedMs: number;
  /**
   * 生成它时那份 IR 的快照。与当前的 IR 不一致就说明这张图过期了 ——
   * 页面上要能指出来，而不是让人对着一张旧图去讲新方案。
   */
  irJson: string;
  filename: string;
}

/** 出图没成。两种原因要给两句不同的话：图不合格 vs 根本没跑成。 */
interface ArtifactError {
  kind: 'rejected' | 'error';
  text: string;
  diagnostics: ArchifyDiagnostic[];
}

/**
 * 出图通道那一行字。
 *
 * 四态各自给一句话，不做合并 —— 因为它们要用户做的事完全不同：
 * 没起服务 → 去起服务；没装技能 → 去装技能；跑不了这张图 → 去改图。
 * 「不可用」三个字把这三件事糊在一起，等于没告诉人任何事。
 */
function channelLine(status: ArchifyStatus): { text: string; tone: string } {
  switch (status.kind) {
    case 'checking':
      return { text: '出图通道：正在问后端 …', tone: 'text-fgFaint' };
    case 'ready':
      return {
        text:
          `出图通道 ✓ 后端 ${arsenalApiBase()} · node ${status.probe.nodeVersion} · ` +
          `${status.probe.quality} 档（九项构图检查全开）`,
        tone: 'text-brass',
      };
    case 'unavailable':
      return { text: `出图通道 ✗ ${status.message}`, tone: 'text-rose-400' };
    case 'offline':
      return { text: `出图通道 — ${status.message}`, tone: 'text-fgFaint' };
  }
}

export default function TechArch({ picks: picksProp }: { picks?: StackPicks }) {
  // 装配台传选型进来；架构图谱页不传 —— 读 localStorage 里的最新快照，
  // 在装配台改选型，这里挂载时自动跟上。没有快照（首次访问）回落 standard 预设。
  const [storedPicks, setStoredPicks] = useState<StackPicks | null>(null);
  useEffect(() => {
    if (!picksProp) setStoredPicks(loadPicksSnapshot());
  }, [picksProp]);
  const picks = picksProp ?? storedPicks ?? presetPicks('standard');
  const followsAssembly = !picksProp;

  const [edits, setEdits] = useState<CanvasEdits>(() => loadEdits());
  const [theme, setTheme] = useState<CanvasTheme>('dark');
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState<{ from: string; to: string; label: string }>({
    from: 'app',
    to: 'database',
    label: '',
  });
  const dragRef = useRef<{ id: string; startX: number; startY: number; ox: number; oy: number } | null>(
    null
  );
  const canvasRef = useRef<HTMLDivElement | null>(null);

  // ── 出图通道（后端 3011）──
  // 与上面那套编辑态刻意分开：那套改的是「画在图上的说法」，
  // 这套只关心「有没有一个能跑 Node 的地方把 IR 变成 HTML」。
  const [archifyStatus, setArchifyStatus] = useState<ArchifyStatus>({ kind: 'checking' });
  const [generating, setGenerating] = useState(false);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [archifyError, setArchifyError] = useState<ArtifactError | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(edits));
    } catch {
      /* 存不下就不存，编辑态丢了对交付没有致命影响 */
    }
  }, [edits]);

  const arch = useMemo(() => buildTechArch(picks, edits), [picks, edits]);

  const svg = useMemo(
    () =>
      buildTechArchSvg(arch, theme, {
        title: `${projectDoc.artifactId} 技术架构图`,
        subtitle: `由装配台按当前选型生成 · ${arch.nodes.length} 个节点 / ${arch.edges.length} 条连线 · 可直接拖拽调整`,
        hooks: true,
      }),
    [arch, theme]
  );

  /** 规范产物：导出用，不带编辑钩子 */
  const cleanSvg = useMemo(
    () =>
      buildTechArchSvg(arch, theme, {
        title: `${projectDoc.artifactId} 技术架构图`,
        subtitle: `由装配台按当前选型生成 · ${arch.nodes.length} 个节点 / ${arch.edges.length} 条连线`,
      }),
    [arch, theme]
  );

  const selectedNode = arch.nodes.find((n) => n.id === selected) ?? null;

  // ── 拖拽 ──
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const hit = (e.target as Element).closest('[data-node]');
      const id = hit?.getAttribute('data-node');
      if (!id || !hit) return;
      const node = arch.nodes.find((n) => n.id === id);
      if (!node) return;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      dragRef.current = {
        id,
        startX: e.clientX,
        startY: e.clientY,
        ox: edits.offsets[id]?.x ?? 0,
        oy: edits.offsets[id]?.y ?? 0,
      };
      setSelected(id);
    },
    [arch.nodes, edits.offsets]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d) return;
      const scale = canvasRef.current ? canvasRef.current.clientWidth / arch.width : 1;
      const nx = d.ox + (e.clientX - d.startX) / scale;
      const ny = d.oy + (e.clientY - d.startY) / scale;
      setEdits((prev) => ({
        ...prev,
        offsets: { ...prev.offsets, [d.id]: { x: Math.round(nx), y: Math.round(ny) } },
      }));
    },
    [arch.width]
  );

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // ── 编辑动作 ──
  const patch = useCallback((id: string, fields: Partial<CanvasNode>) => {
    setEdits((prev) => {
      if (prev.added.some((n) => n.id === id)) {
        return { ...prev, added: prev.added.map((n) => (n.id === id ? { ...n, ...fields } : n)) };
      }
      // 内置节点只放行「说法」层面的修改：标题 / 副标题 / 集群形态
      const titles = fields.title !== undefined ? { ...prev.titles, [id]: fields.title } : prev.titles;
      const subs = fields.subtitle !== undefined ? { ...prev.subtitles, [id]: fields.subtitle } : prev.subtitles;
      const clusters =
        fields.mode !== undefined ? { ...prev.clusters, [id]: fields.mode } : prev.clusters;
      return { ...prev, titles, subtitles: subs, clusters };
    });
  }, []);

  const addCustomNode = useCallback((iconKey: string) => {
    const id = `u${Date.now().toString(36)}`;
    setEdits((prev) => ({
      ...prev,
      added: [
        ...prev.added,
        {
          id,
          title: iconName(iconKey),
          subtitle: '自定义节点',
          icon: iconKey,
          zone: 'mw',
          kind: 'custom',
          tags: [],
          x: 0,
          y: 0,
          w: 214,
          h: 78,
        },
      ],
    }));
    setSelected(id);
    setPaletteOpen(false);
    setNote(`已加入「${iconName(iconKey)}」，拖到合适位置，选中后可改名`);
  }, []);

  const removeNode = useCallback((id: string) => {
    setEdits((prev) => ({
      ...prev,
      added: prev.added.filter((n) => n.id !== id),
      hidden: prev.hidden.includes(id) ? prev.hidden : [...prev.hidden, id],
      links: prev.links.filter((l) => l.from !== id && l.to !== id),
    }));
    setSelected(null);
  }, []);

  const toggleHidden = useCallback((id: string) => {
    setEdits((prev) => ({
      ...prev,
      hidden: prev.hidden.includes(id) ? prev.hidden.filter((x) => x !== id) : [...prev.hidden, id],
    }));
    setSelected(null);
  }, []);

  const reset = useCallback(() => {
    setEdits(emptyEdits());
    setSelected(null);
    setNote('已还原为自动布局');
  }, []);

  // ── 交付 ──
  async function copyPng() {
    setNote(null);
    try {
      const blob = new Blob([cleanSvg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error('SVG 无法解码'));
        img.src = url;
      });
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = arch.width * scale;
      canvas.height = arch.height * scale;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('拿不到 canvas 上下文');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const png: Blob = await new Promise((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG 编码失败'))), 'image/png')
      );
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
        setNote('已复制 PNG 到剪贴板，可直接粘贴进文档');
      } catch {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(png);
        a.download = `${projectDoc.artifactId}-tech-arch.png`;
        a.click();
        setNote('当前环境不允许写剪贴板，已改为下载 PNG');
      }
    } catch (err) {
      setNote(`PNG 生成失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const md = useMemo(() => techArchMarkdown(arch, picks, { title: '技术架构说明' }), [arch, picks]);

  /**
   * 交给通用绘图器（Archify）的中间表示。
   *
   * 它和上面那张图**共用同一个模型**（都是 `buildTechArch` 的产物），
   * 但版式是各自算的：这张画布是我们自己的产线（知道什么该收进应用卡、
   * 什么要画成节点），那份 IR 走对方的通用版式 —— 换来的是它的九项构图自检
   * 与可交互 HTML 交付。内容一致，画法不同，这是刻意的。
   *
   * 手工拖出来的坐标**不带过去**：那份图有自己的版式引擎，而正是那个引擎
   * 在管「标签会不会压线」。把扰动过的坐标喂进去，只会让它报到我们头上。
   */
  const ir = useMemo(() => buildArchifyIr(arch, { title: `${projectDoc.artifactId} 技术架构` }), [arch]);
  const irJson = useMemo(() => JSON.stringify(ir, null, 2), [ir]);
  const irIssues = useMemo(() => archifyIrIssues(ir), [ir]);
  const irName = useMemo(() => archifyIrFilename(projectDoc.artifactId), []);

  // 进页面问一次后端能不能出图 —— 按钮该亮还是该灰，取决于这个答案。
  // 探测失败不算错误：军火库本来就允许没有后端。
  useEffect(() => {
    let alive = true;
    probeArchify().then((status) => {
      if (alive) setArchifyStatus(status);
    });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * 让后端把当前 IR 渲染成 HTML。
   *
   * 三种结果分开处理，因为对用户是三句不同的话：
   * 成了 → 预览；图不合格 → 把对方的诊断原样列出来（那是这次调用最值钱的部分）；
   * 没跑成 → 说清缺什么，并把出图通道降级。
   */
  const generateArtifact = useCallback(async () => {
    setGenerating(true);
    setArchifyError(null);
    setNote(null);
    const snapshot = irJson;
    const outcome = await deliverArchify(ir);
    setGenerating(false);

    if (outcome.kind === 'delivered') {
      setArtifact({
        html: outcome.html,
        receipt: outcome.receipt,
        elapsedMs: outcome.elapsedMs,
        irJson: snapshot,
        filename: irName.replace(/\.json$/, '.html'),
      });
      setNote(
        `已出图：${outcome.receipt.checksPassed}/${outcome.receipt.checkCount} 项构图检查 · ` +
          `${Math.round(outcome.receipt.artifactBytes / 1024)} KB · ${outcome.elapsedMs} ms`
      );
      return;
    }

    setArtifact(null);
    if (outcome.kind === 'rejected') {
      // 图不合格是内容问题，不是环境问题 —— 按钮不该因此变灰，改一下就能重试
      setArchifyError({ kind: 'rejected', text: outcome.error, diagnostics: outcome.diagnostics });
      return;
    }
    setArchifyError({ kind: 'error', text: outcome.message, diagnostics: [] });
    // 只有环境类失败才降级。UNREACHABLE / BAD_RESPONSE 是通信问题，
    // 把按钮灰掉会让人以为要去装东西，其实只是后端没起。
    if (outcome.code.startsWith('ARCHIFY_')) {
      setArchifyStatus({ kind: 'unavailable', code: outcome.code, message: outcome.message });
    }
  }, [ir, irJson, irName]);

  const openArtifact = useCallback(() => {
    if (!artifact) return;
    const blob = new Blob([artifact.html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    // 新标签页要读完这份 blob 才算拿到内容，撤销早了会白屏
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, [artifact]);

  const paletteGroups = useMemo(() => {
    const groups = new Map<TechIcon['kind'], TechIcon[]>();
    for (const icon of Object.values(TECH_ICONS)) {
      const list = groups.get(icon.kind) ?? [];
      list.push(icon);
      groups.set(icon.kind, list);
    }
    return [...groups.entries()];
  }, []);

  const nodeLabel = (id: string) => arch.nodes.find((n) => n.id === id)?.title ?? id;

  return (
    <div className="space-y-4">
      {followsAssembly && (
        <p
          className="flex flex-wrap items-center gap-x-2 rounded-md border px-3 py-2 text-[11px]"
          style={{ borderColor: 'rgba(217,164,65,0.35)', background: 'rgba(217,164,65,0.07)' }}
        >
          <span className="mono" style={{ color: '#D9A441' }}>
            ⇄
          </span>
          <span className="text-fgMuted">
            此视图跟随<span className="text-fg">装配台</span>的当前选型 —— 改选型去装配台，这里自动跟上；
            首次访问未选过时按「standard」预设出图。
          </span>
        </p>
      )}
      <p className="text-xs leading-relaxed text-fgMuted">
        这张图回答「<span className="text-fg">部署出来是什么样</span>」：选型里的构建期零件
        （Maven / Lombok / 测试框架）收进应用卡的工程属性，不占部署节点位；
        Redis、Nacos 这类要单独起进程的才画成节点。集群形态由选型数据声明，
        图上写几节点就是几节点 —— <span className="text-fg">图上的一切都能追溯到数据</span>。
        拖动方块调整版式，点选方块改名换形态，改动只影响交付呈现，不碰选型判定。
      </p>

      {/* 工具条 */}
      <div className="panel flex flex-wrap items-center gap-x-4 gap-y-2 p-2.5">
        <div className="flex items-center gap-1 rounded border border-line p-0.5">
          {(
            [
              ['dark', '深色'],
              ['light', '文档浅色'],
            ] as [CanvasTheme, string][]
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
        <button
          type="button"
          onClick={() => setPaletteOpen((v) => !v)}
          className="rounded border border-line px-2 py-1 text-2xs text-fg transition-colors hover:border-brass hover:text-brass"
        >
          {paletteOpen ? '收起图标库' : '+ 加节点'}
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded border border-line px-2 py-1 text-2xs text-fgMuted transition-colors hover:border-brass hover:text-brass"
        >
          还原自动布局
        </button>
        <span className="text-2xs text-fgFaint">
          拖动移动 · 点选方块编辑 · 改动自动保存在本机
        </span>
      </div>

      {/* 图标库抽屉 */}
      {paletteOpen && (
        <div className="panel max-h-64 space-y-2 overflow-y-auto p-3">
          {paletteGroups.map(([kind, icons]) => (
            <div key={kind}>
              <div className="mb-1 text-2xs text-fgFaint">{kind}</div>
              <div className="flex flex-wrap gap-1">
                {icons.map((ic) => (
                  <button
                    key={Object.keys(TECH_ICONS).find((k) => TECH_ICONS[k] === ic)}
                    type="button"
                    onClick={() => addCustomNode(
                      Object.keys(TECH_ICONS).find((k) => TECH_ICONS[k] === ic) ?? 'generic'
                    )}
                    className="flex items-center gap-1 rounded border border-line px-1.5 py-1 text-2xs text-fgMuted transition-colors hover:border-brass hover:text-fg"
                  >
                    <span style={{ color: ic.color }}>{ic.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 选中节点的编辑面板 */}
      {selectedNode && (
        <div className="panel animate-fade-up space-y-3 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-fg">编辑 · {selectedNode.title}</span>
            <span className="text-2xs text-fgFaint">{selectedNode.kind}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="block text-2xs text-fgFaint">节点名</span>
              <input
                value={selectedNode.title}
                onChange={(e) => patch(selectedNode.id, { title: e.target.value })}
                className="w-full rounded border border-line bg-surfaceHi px-2 py-1 text-xs text-fg"
              />
            </label>
            <label className="space-y-1">
              <span className="block text-2xs text-fgFaint">副标题（角色 / 类别）</span>
              <input
                value={selectedNode.subtitle}
                onChange={(e) => patch(selectedNode.id, { subtitle: e.target.value })}
                className="w-full rounded border border-line bg-surfaceHi px-2 py-1 text-xs text-fg"
              />
            </label>
            {selectedNode.modes && (
              <label className="space-y-1">
                <span className="block text-2xs text-fgFaint">部署形态（决定图上画几个节点）</span>
                <select
                  value={selectedNode.mode ?? 0}
                  onChange={(e) => patch(selectedNode.id, { mode: Number(e.target.value) })}
                  className="w-full rounded border border-line bg-surfaceHi px-2 py-1 text-xs text-fg"
                >
                  {selectedNode.modes.map((m, i) => (
                    <option key={m.name} value={i}>
                      {m.name}（{m.replicas} 节点）
                    </option>
                  ))}
                </select>
              </label>
            )}
            {selectedNode.kind === 'custom' && (
              <label className="space-y-1">
                <span className="block text-2xs text-fgFaint">所在分区</span>
                <select
                  value={selectedNode.zone}
                  onChange={(e) => patch(selectedNode.id, { zone: e.target.value })}
                  className="w-full rounded border border-line bg-surfaceHi px-2 py-1 text-xs text-fg"
                >
                  {ZONE_OPTIONS.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2">
            {selectedNode.kind === 'custom' && (
              <button
                type="button"
                onClick={() => removeNode(selectedNode.id)}
                className="rounded border border-line px-2 py-1 text-2xs text-fgMuted transition-colors hover:border-brass hover:text-brass"
              >
                删除这个节点
              </button>
            )}
            {selectedNode.kind !== 'custom' && selectedNode.kind !== 'app' && (
              <button
                type="button"
                onClick={() => toggleHidden(selectedNode.id)}
                className="rounded border border-line px-2 py-1 text-2xs text-fgMuted transition-colors hover:border-brass hover:text-brass"
              >
                从图上隐藏（选型不变）
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="rounded border border-line px-2 py-1 text-2xs text-fgMuted transition-colors hover:border-brass hover:text-brass"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {/* 加连线 */}
      <div className="panel flex flex-wrap items-end gap-2 p-2.5">
        <span className="text-2xs text-fgFaint">加连线</span>
        <select
          value={linkDraft.from}
          onChange={(e) => setLinkDraft((d) => ({ ...d, from: e.target.value }))}
          className="rounded border border-line bg-surfaceHi px-1.5 py-1 text-2xs text-fg"
        >
          {arch.nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {nodeLabel(n.id)}
            </option>
          ))}
        </select>
        <span className="text-2xs text-fgFaint">→</span>
        <select
          value={linkDraft.to}
          onChange={(e) => setLinkDraft((d) => ({ ...d, to: e.target.value }))}
          className="rounded border border-line bg-surfaceHi px-1.5 py-1 text-2xs text-fg"
        >
          {arch.nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {nodeLabel(n.id)}
            </option>
          ))}
        </select>
        <input
          placeholder="协议 / 动作，如 gRPC"
          value={linkDraft.label}
          onChange={(e) => setLinkDraft((d) => ({ ...d, label: e.target.value }))}
          className="w-36 rounded border border-line bg-surfaceHi px-2 py-1 text-2xs text-fg"
        />
        <button
          type="button"
          onClick={() => {
            if (!linkDraft.label.trim() || linkDraft.from === linkDraft.to) {
              setNote('连线上要写清协议或动作，且两端不能是同一个节点');
              return;
            }
            setEdits((prev) => ({ ...prev, links: [...prev.links, { ...linkDraft, kind: 'solid' }] }));
            setLinkDraft((d) => ({ ...d, label: '' }));
            setNote('已加连线');
          }}
          className="rounded border border-line px-2 py-1 text-2xs text-fg transition-colors hover:border-brass hover:text-brass"
        >
          加上
        </button>
        {edits.links.length > 0 && (
          <button
            type="button"
            onClick={() => setEdits((prev) => ({ ...prev, links: [] }))}
            className="rounded border border-line px-2 py-1 text-2xs text-fgMuted transition-colors hover:border-brass hover:text-brass"
          >
            清掉手加的 {edits.links.length} 条
          </button>
        )}
      </div>

      {/* 交付 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={copyPng}
            className="rounded border border-line px-3 py-1.5 text-2xs text-fg transition-colors hover:border-brass hover:text-brass"
          >
            复制 PNG（粘进文档）
          </button>
          <button
            type="button"
            onClick={() =>
              setNote(
                `已下载 SVG（${arch.width}×${arch.height}，${
                  downloadText(cleanSvg, `${projectDoc.artifactId}-tech-arch.svg`, 'image/svg+xml')
                } 字节）`
              )
            }
            className="rounded border border-line px-3 py-1.5 text-2xs text-fg transition-colors hover:border-brass hover:text-brass"
          >
            下载 SVG
          </button>
          <CopyButton text={cleanSvg} label="复制 SVG 源码" />
          <CopyButton text={md} label="复制技术说明书（Markdown）" />
        </div>
        {note && <span className="text-2xs text-brass">{note}</span>}
      </div>

      {/* 交给通用绘图器 */}
      <div className="panel space-y-2 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-2xs text-fgFaint">交给通用绘图器（Archify）</span>
          <button
            type="button"
            onClick={generateArtifact}
            disabled={archifyStatus.kind !== 'ready' || irIssues.length > 0 || generating}
            className="rounded border border-brassDim px-2 py-1 text-2xs text-brass transition-colors hover:border-brass hover:bg-surfaceHi disabled:opacity-40"
          >
            {generating ? '渲染中…' : '直接生成 HTML'}
          </button>
          <button
            type="button"
            onClick={() =>
              setNote(
                `已下载 ${irName}（${ir.components.length} 个组件 / ${
                  (ir.connections ?? []).length
                } 条连线，${downloadText(irJson, irName, 'application/json')} 字节）`
              )
            }
            disabled={irIssues.length > 0}
            className="rounded border border-line px-2 py-1 text-2xs text-fg transition-colors hover:border-brass hover:text-brass disabled:opacity-40"
          >
            下载 IR JSON
          </button>
          <CopyButton text={irJson} label="复制 IR JSON" />
          <span className={'text-2xs ' + (irIssues.length ? 'text-rose-400' : 'text-brass')}>
            {irIssues.length ? `结构自检 ✗ ${irIssues.length} 处：${irIssues[0]}` : '结构自检 ✓'}
          </span>
          <span className="ml-auto text-2xs text-fgFaint">
            {ir.components.length} 组件 · {(ir.boundaries ?? []).length} 分区边框 ·{' '}
            {(ir.connections ?? []).length} 连线 · {ir.meta.views?.length ?? 0} 阅读路径 ·{' '}
            {ir.cards?.length ?? 0} 卡片
          </span>
        </div>

        {/* 出图通道。四态分开说 —— 「没起服务」和「没装技能」是两件事，
            要用户做的事完全不同，糊成一句「不可用」等于没说。 */}
        <p className={'text-2xs leading-relaxed ' + channelLine(archifyStatus).tone}>
          {channelLine(archifyStatus).text}
        </p>

        {archifyError && (
          <div className="space-y-1 rounded border border-line bg-surfaceHi/60 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-2xs text-rose-400">
                {archifyError.kind === 'rejected' ? '这张图没通过对方的构图检查' : '出图没跑成'}
              </span>
              {archifyError.kind === 'rejected' && (
                <span className="text-2xs text-fgFaint">{archifyError.diagnostics.length} 条诊断</span>
              )}
            </div>
            <p className="whitespace-pre-wrap text-2xs leading-relaxed text-fgMuted">
              {archifyError.text.length > 400 ? `${archifyError.text.slice(0, 400)}…` : archifyError.text}
            </p>
            {archifyError.diagnostics.length > 0 && (
              <ul className="space-y-0.5">
                {archifyError.diagnostics.slice(0, 6).map((d, i) => (
                  <li key={`${d.code}-${i}`} className="text-2xs leading-relaxed text-fgFaint">
                    <code className="text-fgMuted">{d.code}</code> {d.message.split('\n')[0].slice(0, 160)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <p className="text-2xs leading-relaxed text-fgFaint">
          两个渲染器共用同一份模型，版式各自负责。这份 IR 用的是它自己的版式引擎，
          换来的是{' '}
          <span className="text-fgMuted">
            正交折线 / 标签避让 / 交叉数 / 折线节奏 / 边框穿越 / 图例净空
          </span>{' '}
          这一整套构图自检 —— 我们自己的画布没有这一层。手工拖出来的坐标不带过去，
          其余改动（改名、集群形态、手加的连线）都会跟着走。
          「直接生成 HTML」由后端（3011）起它自己的渲染器完成；后端不在时，
          仍可下载 JSON 拿到有 Node 的机器上跑：
          <code className="ml-1 rounded bg-surfaceHi px-1 py-0.5 text-fgMuted">
            wrench-ai validate architecture {irName} --quality showcase
          </code>
          <br />
          用的是市场版渲染器：字体走 Google Fonts 外链，离线打开会回落到系统等宽字体。
          （<code className="rounded bg-surfaceHi px-1 py-0.5 text-fgMuted">docs/</code>{' '}
          里那两张是内嵌字体的旧版产物，文件大 ~96 KB，两者图的画法一样。）
        </p>
      </div>

      {/* 成品预览：就在页面里看，不必先落盘再找编辑器打开 */}
      {artifact && (
        <div className="panel space-y-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-2xs text-brass">成品预览</span>
            <span className="text-2xs text-fgFaint">
              {artifact.receipt.checksPassed}/{artifact.receipt.checkCount} 项构图检查 ·{' '}
              {artifact.receipt.errors} 错 {artifact.receipt.warnings} 警 ·{' '}
              {Math.round(artifact.receipt.artifactBytes / 1024)} KB · {artifact.elapsedMs} ms · 指纹{' '}
              {artifact.receipt.artifactSha256.slice(0, 8)}
            </span>
            <button
              type="button"
              onClick={openArtifact}
              className="rounded border border-line px-2 py-1 text-2xs text-fg transition-colors hover:border-brass hover:text-brass"
            >
              在新标签打开
            </button>
            <button
              type="button"
              onClick={() =>
                setNote(
                  `已下载 ${artifact.filename}（${downloadText(
                    artifact.html,
                    artifact.filename,
                    'text/html'
                  )} 字节）`
                )
              }
              className="rounded border border-line px-2 py-1 text-2xs text-fg transition-colors hover:border-brass hover:text-brass"
            >
              下载 HTML
            </button>
            <button
              type="button"
              onClick={() => setArtifact(null)}
              className="ml-auto rounded border border-line px-2 py-1 text-2xs text-fgFaint transition-colors hover:border-lineHi hover:text-fgMuted"
            >
              收起预览
            </button>
          </div>
          {artifact.irJson !== irJson && (
            <p className="text-2xs leading-relaxed text-rose-400">
              选型或编辑已经变过，下面这张是旧图 —— 重新点一次「直接生成 HTML」。
            </p>
          )}
          {/* sandbox 只给 allow-scripts：那份 HTML 有自己的交互（导览、聚焦），
              但不该拿到我们这页的同源权限。srcDoc + allow-scripts 是最省事的隔离组合。 */}
          <iframe
            title="Archify 成品"
            srcDoc={artifact.html}
            sandbox="allow-scripts"
            className="h-[560px] w-full rounded-lg border border-line"
          />
        </div>
      )}

      {/* 画布 */}
      <div
        ref={canvasRef}
        className="overflow-x-auto rounded-lg border border-line"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        style={{ cursor: 'default', touchAction: 'none' }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />

      <div className="flex flex-wrap items-center justify-between gap-2 text-2xs text-fgFaint">
        <span>
          {arch.nodes.length} 个节点 · {arch.edges.length} 条连线 · 图尺寸 {arch.width}×{arch.height}
        </span>
        <span>
          复制出来的 Markdown 含「部署视图 / 组件清单 / 组件间通信」三张表，直接可进技术说明书。
        </span>
      </div>
    </div>
  );
}
