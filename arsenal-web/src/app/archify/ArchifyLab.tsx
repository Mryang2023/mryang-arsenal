'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ARCHIFY_SHAPE_FIELDS,
  archifyIrFilename,
  archifyIrIssues,
  archifyIrShapeIssues,
  buildArchifyIr,
  type ArchifyIr,
} from '@/lib/archify-ir';
import { buildTechArch } from '@/lib/arch-canvas';
import { loadPicksSnapshot } from '@/lib/picks-store';
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

export default function ArchifyLab() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<ArchifyStatus>({ kind: 'checking' });
  const [busy, setBusy] = useState(false);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [copiedBytes, setCopiedBytes] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
  }, []);

  /** 用装配台当前的选型现场生成一份 IR —— 让本页开箱就有东西可出图。 */
  const loadSample = useCallback(() => {
    const picks = loadPicksSnapshot();
    const ir = buildArchifyIr(buildTechArch(picks), { title: '军火库当前选型' });
    setText(JSON.stringify(ir, null, 2));
    setArtifact(null);
    setCopiedBytes(null);
  }, []);

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
        <h2 className="text-[14px] font-bold text-fg">
          Archify 出图台
          <span className="mono ml-2 text-[10px] font-normal uppercase tracking-[0.14em] text-fgFaint">
            ir in · html out
          </span>
        </h2>
        <p className="mt-1 max-w-[860px] text-[11px] leading-[18px] text-fgMuted">
          粘贴或上传<strong className="font-semibold text-fg">任意项目</strong>的架构 IR，本页先做本地预检，再交给后端渲染成一张通过九项构图检查的
          HTML 交付图。输入不限于军火库自己的选型 —— 契约只有一条：给一份 IR，还一张图。
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ── 左：输入 + 预检 + 产物 ───────────────────────── */}
        <div className="space-y-4">
          <div className="panel">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
              <span className="mono text-[10px] uppercase tracking-wider text-fgFaint">① IR 输入</span>
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
                  onClick={loadSample}
                  className="rounded border px-2.5 py-1 text-xs transition-colors hover:bg-surfaceHi"
                  style={{ borderColor: 'rgba(217,164,65,0.45)', color: '#D9A441' }}
                >
                  用当前选型生成一份
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setText('');
                    setArtifact(null);
                    setCopiedBytes(null);
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
          还没有输入。粘贴 IR、上传文件，或点「用当前选型生成一份」看看合格输入长什么样。
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
  if (artifact.kind === 'rejected') {
    return (
      <div className="panel px-3 py-2.5" style={{ borderColor: 'rgba(229,163,61,0.42)' }}>
        <p className="mono text-[10px] uppercase tracking-wider" style={{ color: '#E5A33D' }}>
          ③ 出图结果 · 这张图没过对方的构图检查
        </p>
        <p className="mt-1 text-[11px] leading-[17px] text-fgMuted">{artifact.error}</p>
        {artifact.diagnostics.length > 0 && (
          <ul className="mt-2 space-y-1">
            {artifact.diagnostics.map((d, i) => (
              <li key={`${i}-${d.code}`} className="flex gap-2 text-[11px] leading-[17px] text-fgMuted">
                <span className="mono shrink-0 text-[10px]" style={{ color: '#E5A33D' }}>
                  {d.code}
                </span>
                <span>{d.message}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 border-t border-line pt-2 text-[10px] leading-[15px] text-fgFaint">
          诊断是这次调用最有价值的东西 —— 它说的就是「这张图哪里构不成一张图」，改 IR 再来。
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
    <div className="panel overflow-hidden" style={{ borderColor: 'rgba(86,197,150,0.42)' }}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <p className="mono text-[10px] uppercase tracking-wider" style={{ color: '#56C596' }}>
          ③ 出图结果 · 已交付
        </p>
        <span className="mono text-[10px] text-fgFaint">
          {r.checksPassed}/{r.checkCount} 项检查 · {artifact.elapsedMs} ms ·{' '}
          {(r.artifactBytes / 1024).toFixed(1)} KB
        </span>
        <div className="ml-auto flex items-center gap-2">
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
      {downloadedBytes !== null && (
        <p className="mono border-b border-line px-3 py-1.5 text-[10px] text-fgFaint">
          已写出 {filename.replace(/\.json$/, '.html')}（{downloadedBytes} 字节）
        </p>
      )}
      <iframe
        title="Archify 产物预览"
        srcDoc={artifact.html}
        sandbox="allow-scripts"
        className="h-[520px] w-full bg-white"
      />
      <p className="mono border-t border-line px-3 py-1.5 text-[10px] leading-[15px] text-fgFaint">
        spec {r.specSha256.slice(0, 12)} · artifact {r.artifactSha256.slice(0, 12)} · 画像{' '}
        {r.profile} · 状态 {r.status}
        {r.warnings > 0 ? ` · ${r.warnings} 条警告` : ''}
      </p>
    </div>
  );
}
