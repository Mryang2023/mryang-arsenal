'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ARCHIFY_SHAPE_FIELDS,
  archifyIrFilename,
  archifyIrIssues,
  archifyIrShapeIssues,
  buildArchifyIr,
  type ArchifyIr,
} from '@/lib/archify-ir';
import { buildTechArch } from '@/lib/arch-canvas';
import { buildSelfArchIr, SELF_ARCH_LABEL } from '@/lib/self-arch';
import { adoptPicks, loadPicksSnapshot, type PicksProvenance } from '@/lib/picks-store';
import type { StackPicks } from '@/lib/content-types';
import { useRouter } from 'next/navigation';
import {
  arsenalApiBase,
  deliverArchify,
  probeArchify,
  type ArchifyDiagnostic,
  type ArchifyReceipt,
  type ArchifyStatus,
} from '@/lib/arsenal-api';
import { downloadText } from '@/lib/zip';
import CopyButton from '@/components/CopyButton';
import CodeIntake from '@/components/CodeIntake';

/**
 * Archify 出图台 —— 一个**与军火库选型无关**的出图入口。
 *
 * 契约就一句话：**IR 进，HTML 出**。
 * 在此之前这条链路被钉死在装配台里（`buildArchifyIr(buildTechArch(picks))`），
 * 于是「通用绘图器」看起来只服务军火库自己。本页把输入口解耦：
 * 粘贴 / 上传任意一份 IR 都行，本页唯一负责的是
 * 「先把形状问题在本地说清楚，再送去出图，然后如实转述对方的诊断」。
 *
 * 三件事刻意分开显示，因为处置方式完全不同：
 *   ① 形状不对   —— 文件本身不是 IR，改文件；
 *   ② 构图没过   —— 是图的问题，诊断逐条列出来；
 *   ③ 后端不可达 —— 不是错误是常态，给离线出路。
 */

type Precheck =
  | { kind: 'empty' }
  | { kind: 'bad-json'; message: string }
  | { kind: 'shape'; issues: string[] }
  | { kind: 'structure'; issues: string[] }
  | { kind: 'ok'; ir: ArchifyIr; filename: string };

type Artifact =
  | { kind: 'delivered'; html: string; receipt: ArchifyReceipt; elapsedMs: number }
  | { kind: 'rejected'; error: string; diagnostics: ArchifyDiagnostic[] }
  | { kind: 'error'; code: string; message: string };

/** 输入框里现在装的是哪来的东西。只驱动按钮高亮，不参与出图 */
type Origin = 'self' | 'picks' | 'scan' | 'manual';

export default function ArchifyLab() {
  /**
   * 首屏直接装「军火库平台自身」那份内置模型 —— 打开就有一张能出图的图，
   * 而不是一个空输入框加一句「请粘贴 IR」。
   *
   * 用惰性初始化而不是挂载后再填：静态导出时这一步在构建期就跑了，
   * 首屏 HTML 里已经带着这份 JSON，不会出现「先空白再跳出内容」的跳动。
   * `buildSelfArchIr()` 是纯函数，服务端与客户端算出来的逐字节相同，
   * 也就不会踩 hydration 不匹配。
   */
  const [text, setText] = useState(() => JSON.stringify(buildSelfArchIr(), null, 2));
  const [status, setStatus] = useState<ArchifyStatus>({ kind: 'checking' });
  const [busy, setBusy] = useState(false);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [copiedBytes, setCopiedBytes] = useState<number | null>(null);
  /** 这份 IR 是从哪来的（手粘 / 选型 / 代码扫描）。出图后要能说清它的出处 */
  const [sourceLabel, setSourceLabel] = useState<string | null>(SELF_ARCH_LABEL);
  /** 当前展示的是哪个内置来源 —— 手粘或上传之后回到 manual */
  const [origin, setOrigin] = useState<Origin>('self');
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    probeArchify().then((s) => {
      if (alive) setStatus(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  /** 本地预检：先验形状，再挑结构毛病。任一步不过都**不发出请求**。 */
  const precheck = useMemo<Precheck>(() => {
    const raw = text.trim();
    if (!raw) return { kind: 'empty' };

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      return { kind: 'bad-json', message: e instanceof Error ? e.message : String(e) };
    }

    const shape = archifyIrShapeIssues(parsed);
    if (shape.length) return { kind: 'shape', issues: shape };

    const ir = parsed as ArchifyIr;
    const issues = archifyIrIssues(ir);
    if (issues.length) return { kind: 'structure', issues };

    const title = typeof ir.meta?.title === 'string' ? ir.meta.title : '';
    return { kind: 'ok', ir, filename: archifyIrFilename(title || 'ir') };
  }, [text]);

  const onPickFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    const body = await file.text();
    setText(body);
    setArtifact(null);
    setCopiedBytes(null);
    // 上传的文件不属于任何一份内置模型 —— 把按钮高亮收掉，别让页签骗人
    setSourceLabel(`上传的文件：${file.name}`);
    setOrigin('manual');
  }, []);

  /** 从别处拿来的 IR（选型快照 / 代码扫描）：填进输入框，并记住它的出处 */
  const adoptIr = useCallback((ir: unknown, label: string, from: Origin = 'manual') => {
    setText(JSON.stringify(ir, null, 2));
    setArtifact(null);
    setCopiedBytes(null);
    setSourceLabel(label);
    setOrigin(from);
  }, []);

  /** 内置模型①：军火库平台自身。手写拓扑，不经过选型 */
  const loadSelf = useCallback(() => {
    adoptIr(buildSelfArchIr(), SELF_ARCH_LABEL, 'self');
  }, [adoptIr]);

  /** 内置模型②：装配台当前的选型现场 */
  const loadPicks = useCallback(() => {
    const picks = loadPicksSnapshot();
    adoptIr(
      buildArchifyIr(buildTechArch(picks), { title: '军火库当前选型' }),
      '装配台当前选型快照',
      'picks'
    );
  }, [adoptIr]);

  /** 两个内置模型 —— 按钮渲染与「当前哪个」高亮共用这一份声明，不会各写一份而漂移 */
  const sources = [
    {
      id: 'self' as const,
      label: '军火库平台自身',
      title: '手写在 self-arch.ts 的拓扑，与装配台选型无关',
      load: loadSelf,
    },
    {
      id: 'picks' as const,
      label: '装配台当前选型',
      title: '读浏览器里最近一次装配台快照',
      load: loadPicks,
    },
  ];

  /**
   * 把扫描出来的选型交给装配台。
   *
   * **先写盘、再跳页**，顺序不能反：装配台挂载时读的就是这份快照，
   * 反了就会载入上一套选型，而且两边都不报错。
   */
  const adoptToStack = useCallback(
    (picks: StackPicks, provenance: PicksProvenance) => {
      adoptPicks(picks, provenance);
      router.push('/stack');
    },
    [router]
  );

  const deliver = useCallback(async () => {
    if (precheck.kind !== 'ok') return;
    setBusy(true);
    setArtifact(null);
    const outcome = await deliverArchify(precheck.ir);
    setBusy(false);
    setArtifact(outcome);
  }, [precheck]);

  const downloadHtml = useCallback(() => {
    if (!artifact || artifact.kind !== 'delivered') return;
    const base = (precheck.kind === 'ok' ? precheck.filename : 'architecture.json').replace(/\.json$/, '');
    const bytes = downloadText(artifact.html, `${base}.html`, 'text/html');
    setCopiedBytes(bytes);
  }, [artifact, precheck]);

  const shapeOk = precheck.kind === 'ok';

  return (
    <div className="space-y-4">
      {/* 页头：说清这一页与军火库选型无关 */}
      <div className="panel px-4 py-3" style={{ borderColor: 'rgba(217,164,65,0.32)' }}>
        <h1 className="text-[14px] font-bold text-fg">
          Archify 出图台
          <span className="mono ml-2 text-[10px] font-normal uppercase tracking-[0.14em] text-fgFaint">
            ir in · html out
          </span>
        </h1>
        <p className="mt-1 max-w-[860px] text-[11px] leading-[18px] text-fgMuted">
          默认展示的是<strong className="font-semibold text-fg">军火库平台自身</strong>的架构 ——
          一份手写的内置拓扑，与装配台选型无关。切到另一个页签可以看<strong className="font-semibold text-fg">装配台当前的选型</strong>；
          也可以粘贴 / 上传<strong className="font-semibold text-fg">任意项目</strong>的架构 IR，
          或直接从<strong className="font-semibold text-fg">代码仓库</strong>扫一份事实出来（本地目录 / https git / zip）。
          本页先做本地预检，再交给后端渲染成一张通过九项构图检查的 HTML 交付图 ——
          契约只有一条：给一份 IR，还一张图。
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ── 左：输入 + 预检 + 产物 ───────────────────────── */}
        <div className="space-y-4">
          <div className="panel">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
              <span className="mono text-[10px] uppercase tracking-wider text-fgFaint">① IR 输入</span>
              {/* 数据源：两个内置模型并排，当前那个高亮。切换只把内容换掉 */}
              <div className="flex items-center gap-1 rounded border border-line p-0.5">
                {sources.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    title={s.title}
                    onClick={s.load}
                    className={
                      'rounded px-2.5 py-1 text-[11px] transition-colors ' +
                      (origin === s.id ? 'bg-surfaceHi text-brass' : 'text-fgMuted hover:text-fg')
                    }
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="rounded border border-line px-2.5 py-1 text-xs text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
                >
                  上传 .json
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => {
                    void onPickFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setText('');
                    setArtifact(null);
                    setCopiedBytes(null);
                    setSourceLabel(null);
                    setOrigin('manual');
                  }}
                  disabled={!text}
                  className="rounded border border-line px-2.5 py-1 text-xs text-fgMuted transition-colors hover:border-lineHi hover:text-fg disabled:opacity-40"
                >
                  清空
                </button>
              </div>
            </div>
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setArtifact(null);
                setOrigin('manual');
              }}
              spellCheck={false}
              placeholder='在这里粘贴一份 IR JSON，例如 {"meta":{"title":"…","locale":"zh-CN","views":[…]},"components":[…]}'
              className="mono h-[300px] w-full resize-y bg-transparent px-3 py-2.5 text-[11px] leading-[17px] text-fg outline-none placeholder:text-fgFaint"
            />
            {text && (
              <div className="flex items-center gap-2 border-t border-line px-3 py-2">
                <span className="mono text-[10px] text-fgFaint">{text.length} 字符</span>
                <CopyButton text={text} label="复制 IR" compact className="ml-auto" />
              </div>
            )}
          </div>

          <CodeIntake onIr={(ir, label) => adoptIr(ir, label, 'scan')} onPicks={adoptToStack} />

          {sourceLabel && (
            <p className="text-[10.5px] text-fgFaint">
              IR 出处：<span className="text-fgMuted">{sourceLabel}</span>
            </p>
          )}

          <PrecheckCard state={precheck} />

          {artifact && (
            <ArtifactCard
              artifact={artifact}
              filename={precheck.kind === 'ok' ? precheck.filename : 'architecture.json'}
              onDownload={downloadHtml}
              downloadedBytes={copiedBytes}
            />
          )}
        </div>

        {/* ── 右：后端状态 + 出图 + IR 长什么样 ─────────────── */}
        <div className="space-y-4">
          <div className="panel px-3 py-2.5">
            <StatusRow status={status} />
            <button
              type="button"
              onClick={() => {
                void deliver();
              }}
              disabled={!shapeOk || busy || status.kind !== 'ready'}
              className="mt-2.5 w-full rounded-md border px-3 py-2 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45"
              style={{
                borderColor: 'rgba(217,164,65,0.5)',
                background: 'rgba(217,164,65,0.12)',
                color: '#D9A441',
              }}
            >
              {busy ? '正在出图…' : '② 送去出图'}
            </button>
            <p className="mt-1.5 text-[10px] leading-[15px] text-fgFaint">
              {shapeOk
                ? '预检已通过，点击后由后端渲染（最多 75 秒）'
                : '先让左栏的预检变成绿色，再出图 —— 形状不对的东西送过去只会拿到一句看不懂的报错'}
            </p>
          </div>

          <div className="panel px-3 py-2.5">
            <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">IR 长什么样</p>
            <ul className="mt-2 space-y-2">
              {ARCHIFY_SHAPE_FIELDS.map((f) => (
                <li key={f.key}>
                  <div className="flex items-baseline gap-2">
                    <code className="mono text-[11px] text-fg">{f.key}</code>
                    <span className="mono text-[9.5px] text-fgFaint">{f.type}</span>
                  </div>
                  <p className="text-[10.5px] leading-[16px] text-fgMuted">{f.desc}</p>
                </li>
              ))}
            </ul>
            <p className="mt-2.5 border-t border-line pt-2 text-[10px] leading-[15px] text-fgFaint">
              九项构图检查（跨集合一致性、阅读路径不重复、标签不压线…）在前端算不出来，
              只有对方的渲染器算得出 —— 所以本地只拦「形状」与「我们已知会踩的结构坑」，
              其余一律交给后端如实回报。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 状态行 ────────────────────────────────────────────────

function StatusRow({ status }: { status: ArchifyStatus }) {
  const map = {
    checking: { dot: '#93A39C', label: '正在探测后端…', tone: 'text-fgMuted' },
    ready: { dot: '#56C596', label: '后端就绪', tone: 'text-fg' },
    unavailable: { dot: '#E5A33D', label: '后端在，但这台机器出不了图', tone: 'text-fg' },
    offline: { dot: '#E5484D', label: '后端连不上', tone: 'text-fg' },
  } as const;
  const m = map[status.kind];

  return (
    <div>
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: m.dot }}
        />
        <span className={`text-[12px] font-semibold ${m.tone}`}>{m.label}</span>
        <span className="mono ml-auto text-[10px] text-fgFaint">{arsenalApiBase()}</span>
      </div>
      {status.kind === 'ready' && (
        <p className="mt-1 text-[10px] leading-[15px] text-fgMuted">
          质量档 <code className="mono">{status.probe.quality}</code> · 超时{' '}
          <code className="mono">{status.probe.timeoutSeconds}s</code> · 上限{' '}
          <code className="mono">{status.probe.maxSpecBytes}</code> 字节 · node{' '}
          <code className="mono">{status.probe.nodeVersion ?? '未报告'}</code>
        </p>
      )}
      {status.kind === 'unavailable' && (
        <p className="mt-1 text-[10px] leading-[15px] text-fgMuted">
          <code className="mono text-[9.5px]">{status.code}</code> {status.message}
        </p>
      )}
      {status.kind === 'offline' && (
        <p className="mt-1 text-[10px] leading-[15px] text-fgMuted">
          {status.message}
          <br />
          离线也能用：把左栏的 IR 复制走，用 CLI 直接出图。
        </p>
      )}
    </div>
  );
}

// ── 预检卡 ────────────────────────────────────────────────

function PrecheckCard({ state }: { state: Precheck }) {
  const shell = 'panel px-3 py-2.5';

  if (state.kind === 'empty') {
    return (
      <div className={shell}>
        <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">② 本地预检</p>
        <p className="mt-1.5 text-[11px] leading-[17px] text-fgMuted">
          还没有输入。点上面的「军火库平台自身」或「装配台当前选型」各拿一份内置模型，
          也可以粘贴 IR、上传 .json，或从代码仓库扫一份出来。
        </p>
      </div>
    );
  }

  if (state.kind === 'bad-json') {
    return (
      <div className={shell} style={{ borderColor: 'rgba(229,72,77,0.4)' }}>
        <p className="mono text-[10px] uppercase tracking-wider" style={{ color: '#E5484D' }}>
          ② 本地预检 · JSON 解析失败
        </p>
        <p className="mono mt-1.5 text-[11px] leading-[17px] text-fgMuted">{state.message}</p>
      </div>
    );
  }

  if (state.kind === 'shape' || state.kind === 'structure') {
    const isShape = state.kind === 'shape';
    return (
      <div className={shell} style={{ borderColor: 'rgba(229,72,77,0.4)' }}>
        <p className="mono text-[10px] uppercase tracking-wider" style={{ color: '#E5484D' }}>
          ② 本地预检 · {isShape ? '不是一份 IR' : '结构有毛病'}（{state.issues.length} 条）
        </p>
        <p className="mt-1 text-[10.5px] leading-[16px] text-fgMuted">
          {isShape
            ? '形状不对 —— 这一关拦下的东西送去后端只会拿到一个指向我们代码行的 TypeError。'
            : '形状是对的，但有已知会卡住渲染的地方。这些错了会把一张本来能过的图挡在门外。'}
        </p>
        <ul className="mt-2 space-y-1">
          {state.issues.map((it, i) => (
            <li key={`${i}-${it}`} className="flex gap-2 text-[11px] leading-[17px] text-fgMuted">
              <span className="mono shrink-0" style={{ color: '#E5484D' }}>
                ✗
              </span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className={shell} style={{ borderColor: 'rgba(86,197,150,0.42)' }}>
      <p className="mono text-[10px] uppercase tracking-wider" style={{ color: '#56C596' }}>
        ② 本地预检 · 通过
      </p>
      <p className="mt-1 text-[11px] leading-[17px] text-fgMuted">
        形状与结构两层都没问题：{state.ir.components.length} 个组件 ·{' '}
        {state.ir.connections?.length ?? 0} 条连线 · {state.ir.boundaries?.length ?? 0} 个分区 ·{' '}
        {state.ir.meta.views?.length ?? 0} 条阅读路径。导出文件名会是{' '}
        <code className="mono text-[10.5px]">{state.filename}</code>。
      </p>
      <p className="mt-1 text-[10px] leading-[15px] text-fgFaint">
        通过预检 ≠ 图能过。九项构图检查在后端，点右边「送去出图」才知道结果。
      </p>
    </div>
  );
}

// ── 产物卡 ────────────────────────────────────────────────

/**
 * 出图结果怎么「看清楚」，这件事有三种成本不同的办法，页面上都给出来：
 *
 *   ① 页内放大预览 —— 覆盖层铺满视口。图是按容器宽度等比缩放的（`svg{width:100%}`），
 *      所以「看得清」等于「容器够宽」：左栏只有 ~800px，图被压到设计尺寸的 78%；
 *      覆盖层能拿到整个视口宽度，`.container` 直接顶到它自己的 1440px 上限。
 *   ② 新标签页打开 —— blob URL 起一个**不带沙箱**的窗口，是这一页能做的最彻底的一招：
 *      图里自带的右上角工具栏（缩放 + / - / 0、「演示」铺满整屏、主题、风格、导出 SVG/PNG）
 *      在那边的浏览器原生环境里全部可用，预览沙箱里则只能用到一部分。
 *   ③ 下载 HTML —— 存成文件，双击就是同一张图。
 *
 * 之所以不能直接把预览 iframe 换成「演示模式」链接（图里认 `?present=1`）：
 * iframe 用的是 `srcDoc`，文档没有 URL，给不了查询串。
 */
function ArtifactCard({
  artifact,
  filename,
  onDownload,
  downloadedBytes,
}: {
  artifact: Artifact;
  filename: string;
  onDownload: () => void;
  downloadedBytes: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  /** 浏览器拦下了 window.open —— 如实说出来，别让按钮点了没动静 */
  const [tabBlocked, setTabBlocked] = useState(false);
  const htmlName = filename.replace(/\.json$/, '.html');

  /**
   * 用 blob URL 开一个新标签页。
   *
   * 不用 `window.open(url,'_blank','noopener')`：带 `noopener` 时 Chrome 一律返回 null，
   * 就分辨不出「开成功了」和「被弹窗拦截了」。改为开完把 `opener` 摘掉，效果一样。
   */
  const openTab = useCallback((html: string) => {
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const win = window.open(url, '_blank');
    if (!win) {
      URL.revokeObjectURL(url);
      setTabBlocked(true);
      return;
    }
    try {
      win.opener = null;
    } catch {
      /* 跨源时设置不了，不影响打开 */
    }
    setTabBlocked(false);
    // 5 分钟后回收。产物是自包含的单文件（字体/样式全内联），标签页不再回取这个 URL；
    // 留长一点只为容忍用户手动刷新。
    window.setTimeout(() => URL.revokeObjectURL(url), 300_000);
  }, []);

  // 覆盖层开着时才挂 Esc 与滚动锁，不是常驻监听
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [expanded]);

  if (artifact.kind === 'rejected') {
    return (
      <div className="panel px-3 py-2.5" style={{ borderColor: 'rgba(229,163,61,0.42)' }}>
        <p className="mono text-[10px] uppercase tracking-wider" style={{ color: '#E5A33D' }}>
          ③ 出图结果 · 这张图没过对方的构图检查
        </p>
        <p className="mt-1 text-[11px] leading-[17px] text-fgMuted">{artifact.error}</p>
        {artifact.diagnostics.length > 0 && (
          <ul className="mt-2 space-y-2">
            {artifact.diagnostics.map((d, i) => (
              <li key={`${i}-${d.code}`} className="text-[11px] leading-[17px] text-fgMuted">
                <div className="flex gap-2">
                  <span className="mono shrink-0 text-[10px]" style={{ color: '#E5A33D' }}>
                    {d.code}
                  </span>
                  <span>{d.message}</span>
                </div>
                {(d.supportedFixes ?? []).length > 0 && (
                  <ul
                    className="mt-1 space-y-0.5 border-l pl-2.5"
                    style={{ borderColor: 'rgba(229,163,61,0.35)' }}
                  >
                    {(d.supportedFixes ?? []).map((f) => (
                      <li key={f} className="text-[10.5px] leading-[16px] text-fgMuted">
                        → {f}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 border-t border-line pt-2 text-[10px] leading-[15px] text-fgFaint">
          诊断是这次调用最有价值的东西 —— 它说的就是「这张图哪里构不成一张图」；
          带箭头的那几行是对方给的改法（英文原文，它不本地化诊断正文），照做再试。
        </p>
      </div>
    );
  }

  if (artifact.kind === 'error') {
    return (
      <div className="panel px-3 py-2.5" style={{ borderColor: 'rgba(229,72,77,0.4)' }}>
        <p className="mono text-[10px] uppercase tracking-wider" style={{ color: '#E5484D' }}>
          ③ 出图结果 · 请求没跑成
        </p>
        <p className="mt-1 text-[11px] leading-[17px] text-fgMuted">
          <code className="mono text-[10px]">{artifact.code}</code> {artifact.message}
        </p>
      </div>
    );
  }

  const r = artifact.receipt;
  return (
    <>
      <div className="panel overflow-hidden" style={{ borderColor: 'rgba(86,197,150,0.42)' }}>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
          <p className="mono text-[10px] uppercase tracking-wider" style={{ color: '#56C596' }}>
            ③ 出图结果 · 已交付
          </p>
          <span className="mono text-[10px] text-fgFaint">
            {r.checksPassed}/{r.checkCount} 项检查 · {artifact.elapsedMs} ms ·{' '}
            {(r.artifactBytes / 1024).toFixed(1)} KB
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="rounded border px-2.5 py-1 text-xs transition-colors hover:bg-surfaceHi"
              style={{ borderColor: 'rgba(217,164,65,0.55)', color: '#D9A441' }}
            >
              放大预览
            </button>
            <button
              type="button"
              onClick={() => openTab(artifact.html)}
              className="rounded border px-2.5 py-1 text-xs text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
              style={{ borderColor: 'rgba(86,197,150,0.5)' }}
            >
              新标签页打开
            </button>
            <button
              type="button"
              onClick={onDownload}
              className="rounded border px-2.5 py-1 text-xs transition-colors hover:bg-surfaceHi"
              style={{ borderColor: 'rgba(86,197,150,0.5)', color: '#56C596' }}
            >
              下载 HTML
            </button>
          </div>
        </div>
        {tabBlocked && (
          <p
            className="mono border-b border-line px-3 py-1.5 text-[10px] leading-[16px]"
            style={{ color: '#E5A33D' }}
          >
            浏览器拦下了新标签页 —— 允许本站弹窗后重试，或先「下载 HTML」再打开本地文件。
          </p>
        )}
        {downloadedBytes !== null && (
          <p className="mono border-b border-line px-3 py-1.5 text-[10px] text-fgFaint">
            已写出 {htmlName}（{downloadedBytes} 字节）
          </p>
        )}
        <iframe
          title="Archify 产物预览"
          srcDoc={artifact.html}
          sandbox="allow-scripts allow-downloads"
          allow="clipboard-write"
          className="h-[70vh] max-h-[680px] w-full bg-white"
        />
        <p className="mono border-t border-line px-3 py-1.5 text-[10px] leading-[16px] text-fgFaint">
          图偏小就点上面的<strong className="font-semibold text-fgMuted">放大预览</strong>（页内铺满，
          Esc 关闭）或<strong className="font-semibold text-fgMuted">新标签页打开</strong>。
          图是按容器宽度等比缩放的，所以「放大」= 给它更多宽度；新标签页不受预览沙箱限制，
          图里右上角工具栏的缩放{' '}
          <code className="mono">{'+ / - / 0'}</code>、铺满整屏的「演示」、导出 SVG/PNG
          都在那边才完整可用。
        </p>
        <p className="mono border-t border-line px-3 py-1.5 text-[10px] leading-[15px] text-fgFaint">
          spec {r.specSha256.slice(0, 12)} · artifact {r.artifactSha256.slice(0, 12)} · 画像{' '}
          {r.profile} · 状态 {r.status}
          {r.warnings > 0 ? ` · ${r.warnings} 条警告` : ''}
        </p>
      </div>

      {/* 放大预览：portal 到 body，免得被面板的 overflow-hidden / 外边距掺进来 */}
      {expanded &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Archify 产物放大预览"
            onClick={(e) => {
              if (e.target === e.currentTarget) setExpanded(false);
            }}
            className="fixed inset-0 z-[90] flex flex-col gap-2 p-3"
            style={{ background: 'rgba(6,10,14,0.86)' }}
          >
            <div className="panel flex flex-wrap items-center gap-2 px-3 py-2">
              <p className="mono text-[10px] uppercase tracking-wider" style={{ color: '#56C596' }}>
                ③ 出图结果 · 放大预览
              </p>
              <span className="mono text-[10px] text-fgFaint">
                {htmlName} · {r.checksPassed}/{r.checkCount} 项检查 ·{' '}
                {(r.artifactBytes / 1024).toFixed(1)} KB
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => openTab(artifact.html)}
                  className="rounded border px-2.5 py-1 text-xs text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
                  style={{ borderColor: 'rgba(86,197,150,0.5)' }}
                >
                  新标签页打开
                </button>
                <button
                  type="button"
                  onClick={onDownload}
                  className="rounded border px-2.5 py-1 text-xs transition-colors hover:bg-surfaceHi"
                  style={{ borderColor: 'rgba(86,197,150,0.5)', color: '#56C596' }}
                >
                  下载 HTML
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={() => setExpanded(false)}
                  className="rounded border border-line px-2.5 py-1 text-xs text-fg transition-colors hover:border-lineHi hover:bg-surfaceHi"
                >
                  关闭（Esc）
                </button>
              </div>
            </div>
            <div className="panel min-h-0 flex-1 overflow-hidden">
              <iframe
                title="Archify 产物放大预览"
                srcDoc={artifact.html}
                sandbox="allow-scripts allow-downloads"
                allow="clipboard-write"
                className="h-full w-full bg-white"
              />
            </div>
            <p className="mono shrink-0 px-1 text-[10px] leading-[15px] text-fgFaint">
              点空白处或按 Esc 关闭。要铺满整屏的「演示」模式与导出，请用「新标签页打开」。
            </p>
          </div>,
          document.body
        )}
    </>
  );
}
