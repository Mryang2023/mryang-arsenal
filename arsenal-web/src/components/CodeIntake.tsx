'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  CANVAS_THEME_OPTIONS,
  buildTechArchSvg,
  type CanvasTheme,
} from '@/lib/arch-canvas';
import {
  buildArchifyIrFromFacts,
  buildLayeredArch,
  buildLayeredSvg,
  buildTechArchFromFacts,
  factsToPicks,
  summarizeFacts,
  type FactsSummary,
  type FactsUnmatched,
  type ProjectFacts,
} from '@/lib/facts-arch';
import { archifyIrIssues, archifyIrShapeIssues } from '@/lib/archify-ir';
import { buildProfileDraftFromFacts, type ProfileDraft } from '@/lib/profile-draft';
import type { ArchProfile } from '@/lib/arch-profile';
import type { StackPicks } from '@/lib/content-types';
import type { PicksProvenance } from '@/lib/picks-store';
import { scanTechName } from '@/lib/scan-rules';
import { scanFacts, scanUpload } from '@/lib/arsenal-api';
import { downloadText } from '@/lib/zip';

/**
 * 「从代码生成」输入源（/archify 与 /arch 共用，靠 variant 切换）。
 *
 * 三条入口：本地目录（POST /api/scan/facts）、上传 zip（POST /api/scan/upload）、
 * 粘贴 facts JSON（**完全离线**，不依赖后端）。前两条需要后端在线；
 * 粘贴那条路在前端本地就把 facts → IR 算出来，后端不在也能验证 IR 能过两道预检。
 *
 * 拿到 facts 后展示：技术栈 chips（scanTechName）、unmatched 清单（技术名 + 出处）、
 * 「这次怎么选的」（dim=opt 与冲突/未收录说明），以及一个「用这份 facts 出图」按钮，
 * 走 buildArchifyIrFromFacts + 现有交付流程（填进出图台，由出图台负责送后端）。
 */

type Stage =
  | { kind: 'idle' }
  | { kind: 'scanning'; what: string }
  | { kind: 'done'; facts: ProjectFacts; offline: boolean }
  | { kind: 'failed'; code: string; message: string; offline: boolean };

type Mode = 'path' | 'git' | 'zip' | 'paste';

export default function CodeIntake({
  variant = 'archify',
  onIr,
  onProfile,
  onPicks,
}: {
  /** archify：出三张图并把 IR 填进出图台；profile：生成六视图档案草稿并导入 */
  variant?: 'archify' | 'profile';
  onIr?: (ir: unknown, label: string) => void;
  onProfile?: (profile: ArchProfile) => void;
  /**
   * 「把这套选型交给装配台」。不传就不出现那颗按钮。
   *
   * 组件只负责把 picks 与出处**交出去**，跳不跳页、跳哪里由调用方决定 ——
   * 两个调用方（/arch 的档案导入、/archify 的出图台）各自的下一步不一样，
   * 组件不该替它们选路由。出处一起交出去是刻意的：光有 picks 的话，
   * 装配台上那 33 格和手点出来的长得一模一样，用户看不出哪些是扫描读的。
   */
  onPicks?: (picks: StackPicks, provenance: PicksProvenance) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('path');
  const [source, setSource] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [theme, setTheme] = useState<CanvasTheme>('doc');
  const [showSvg, setShowSvg] = useState<'none' | 'tech' | 'layered'>('none');
  const fileRef = useRef<HTMLInputElement>(null);

  const run = useCallback(
    async (what: string, fn: () => Promise<{ kind: string; [k: string]: unknown }>) => {
      setStage({ kind: 'scanning', what });
      const outcome = await fn();
      if (outcome.kind === 'facts') {
        setStage({ kind: 'done', facts: outcome.facts as ProjectFacts, offline: false });
      } else if (outcome.kind === 'offline') {
        setStage({ kind: 'failed', code: 'OFFLINE', message: outcome.message as string, offline: true });
      } else {
        setStage({ kind: 'failed', code: outcome.code as string, message: outcome.message as string, offline: false });
      }
    },
    []
  );

  const onScan = useCallback(() => {
    const value = source.trim();
    if (mode === 'zip') {
      const file = fileRef.current?.files?.[0];
      if (!file) return;
      void run(`上传 ${file.name}`, () => scanUpload(file));
      return;
    }
    if (!value) return;
    // 后端 `/api/scan/facts` 一直支持 `kind: "git"`（走 SourceResolver.fromGit），
    // 只是前端从来没发过 —— 于是「导入别人的项目」最顺手的那个入口一直是缺的。
    const kind = mode === 'git' ? 'git' : 'path';
    void run(`扫描 ${value}`, () => scanFacts({ kind, value }));
  }, [mode, run, source]);

  const onPaste = useCallback(() => {
    const raw = pasteText.trim();
    if (!raw) return;
    setStage({ kind: 'scanning', what: '解析事实 JSON' });
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      setStage({ kind: 'failed', code: 'BAD_JSON', message: `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`, offline: true });
      return;
    }
    const facts = parsed as ProjectFacts;
    if (!facts || typeof facts !== 'object' || !('techStack' in facts)) {
      setStage({ kind: 'failed', code: 'NOT_FACTS', message: '这段 JSON 不是 ProjectFacts（缺少 techStack 字段）', offline: true });
      return;
    }
    setStage({ kind: 'done', facts, offline: true });
  }, [pasteText]);

  const artifacts = useMemo(() => {
    if (stage.kind !== 'done') return null;
    const facts = stage.facts;
    const picksRes = factsToPicks(facts);
    const built = buildTechArchFromFacts(facts);
    // 分层图与部署图共用同一个模型入口：数据存储那一带取的就是部署图上的节点，
    // 两张图因此不会一个说 MySQL 一个说 Postgres
    const layered = buildLayeredArch(facts, built.arch);
    const summary = summarizeFacts(facts);
    const title = `${facts.root} 技术架构图`;
    const techSvg = buildTechArchSvg(built.arch, theme, {
      title,
      subtitle:
        `由代码扫描生成 · ${summary.files} 个文件 / ${built.arch.nodes.length} 个节点 / ` +
        `${built.arch.edges.length} 条连线 · ${summary.techs.length} 项技术命中`,
    });
    const layeredSvg = buildLayeredSvg(layered, theme);
    // IR 与主题绑定：主题不只是本地配色，它同时决定后端出图用哪套版式，
    // 否则会出现「这里看是文档风、导出的 HTML 还是蓝图」
    const irRes = buildArchifyIrFromFacts(facts, { theme, title });
    const ir = irRes.ir;
    const shape = archifyIrShapeIssues(ir);
    const issues = shape.length ? [] : archifyIrIssues(ir);
    const draft = buildProfileDraftFromFacts(facts);
    /**
     * 选型出处：装配台靠它区分「扫描读出来的格子」与「人点出来的格子」。
     *
     * `atScan` 存的是**此刻这一份** picks —— 装配台拿它跟用户后来的改动比对，
     * 于是「哪几格是我自己改的」是当场算出来的，不靠谁记性好。
     */
    const provenance: PicksProvenance = {
      kind: 'scan',
      root: facts.root,
      scannedAt: facts.scannedAt ?? '',
      fromDeps: built.detail.fromDeps.map((d) => ({
        dim: d.dim,
        opt: d.opt,
        tech: d.tech,
        path: d.evidence.path,
        line: d.evidence.line,
      })),
      fromDeploy: built.detail.fromDeploy.map((d) => ({
        dim: d.dim,
        opt: d.opt,
        because: d.because,
      })),
      conflicts: built.detail.conflicts.map((c) => ({
        dim: c.dim,
        kept: c.kept,
        dropped: c.dropped,
      })),
      // 后端没认出来的依赖坐标条数 —— 明细留在本页，装配台只报个数
      unmatchedCount: (facts.techStack?.unmatched ?? []).length,
      atScan: { ...picksRes.picks },
    };
    return {
      facts,
      picksRes,
      built,
      layered,
      layeredSvg,
      summary,
      techSvg,
      ir,
      shape,
      issues,
      title,
      draft,
      provenance,
    };
  }, [stage, theme]);

  const safeName = artifacts ? artifacts.facts.root.replace(/[^\w.-]+/g, '-') : 'project';

  return (
    <div className="panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        <span className="mono text-[10px] uppercase tracking-wider text-fgFaint">从代码生成</span>
        <span className="text-[11px] text-fgMuted">
          本地目录 / 上传 zip / 粘贴 facts JSON → {variant === 'profile' ? '六视图档案草稿' : '三张图'}
        </span>
        <span className="mono ml-auto text-[10px] text-fgFaint">{open ? '收起' : '展开'}</span>
      </button>

      {open && (
        <div className="border-t border-line px-3 py-3">
          {/* ── 三条入口 ── */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded border border-line p-0.5">
              {(
                [
                  ['path', '本地目录'],
                  ['git', 'https git'],
                  ['zip', '上传 zip'],
                  ['paste', '粘贴 facts JSON'],
                ] as [Mode, string][]
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  className={
                    'rounded px-2.5 py-1 text-[11px] transition-colors ' +
                    (mode === id ? 'bg-surfaceHi text-brass' : 'text-fgMuted hover:text-fg')
                  }
                >
                  {label}
                </button>
              ))}
            </div>

            {mode === 'paste' ? (
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                spellCheck={false}
                placeholder='把后端返回的 facts JSON 粘进来（离线也能算 IR）'
                className="mono min-h-[64px] w-full flex-1 rounded border border-line bg-transparent px-2 py-1 text-[11px] leading-[16px] text-fg outline-none placeholder:text-fgFaint focus:border-lineHi"
              />
            ) : mode === 'zip' ? (
              <input
                ref={fileRef}
                type="file"
                accept=".zip,application/zip"
                className="text-[11px] text-fgMuted file:mr-2 file:rounded file:border file:border-line file:bg-transparent file:px-2 file:py-1 file:text-[11px] file:text-fgMuted"
              />
            ) : (
              <input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                spellCheck={false}
                placeholder={
                  mode === 'git'
                    ? 'https://github.com/owner/repo.git'
                    : 'D:/mryang/workspace/2026/arsenal/arsenal-server'
                }
                className="mono min-w-[280px] flex-1 rounded border border-line bg-transparent px-2 py-1 text-[11px] text-fg outline-none placeholder:text-fgFaint focus:border-lineHi"
              />
            )}

            <button
              type="button"
              onClick={mode === 'paste' ? onPaste : onScan}
              disabled={
                stage.kind === 'scanning' ||
                (mode === 'path' && !source.trim()) ||
                (mode === 'paste' && !pasteText.trim())
              }
              className="rounded border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45"
              style={{ borderColor: 'rgba(217,164,65,0.5)', background: 'rgba(217,164,65,0.12)', color: '#D9A441' }}
            >
              {mode === 'paste' ? '解析' : stage.kind === 'scanning' ? '扫描中…' : '扫描'}
            </button>

            <div className="ml-auto flex items-center gap-1 rounded border border-line p-0.5">
              {CANVAS_THEME_OPTIONS.filter((t) => ['doc', 'slide', 'blueprint'].includes(t.id)).map(
                (t) => (
                  <button
                    key={t.id}
                    type="button"
                    title={t.hint}
                    onClick={() => setTheme(t.id)}
                    className={
                      'rounded px-2 py-1 text-[11px] transition-colors ' +
                      (theme === t.id ? 'bg-surfaceHi text-brass' : 'text-fgMuted hover:text-fg')
                    }
                  >
                    {t.label}
                  </button>
                )
              )}
            </div>
          </div>

          {mode === 'paste' ? (
            <p className="mt-2 text-[10px] leading-[16px] text-fgFaint">
              粘贴这一条路完全离线：前端本地把 facts → IR 算出来，后端不在也能验证 IR 通过两道预检。
              后端在的时候，下面「填入出图台」后由出图台负责送后端渲染 HTML。
            </p>
          ) : (
            <p className="mt-2 text-[10px] leading-[16px] text-fgFaint">
              扫描是只读的：不执行仓库里的任何脚本 / 构建 / 测试，单文件 2MB / 总 500MB / 2 万文件 / 深度 20 / 180s 超时。
              配置文件里的 password、token 一类值在事实里一律是 <span className="mono">***</span>，结果不外发任何地方。
            </p>
          )}

          {stage.kind === 'scanning' && (
            <p className="mt-2.5 mono text-[11px] text-fgMuted">{stage.what} …</p>
          )}

          {stage.kind === 'failed' && (
            <div
              className="mt-2.5 rounded border px-2.5 py-2"
              style={{ borderColor: 'rgba(229,72,77,0.4)', background: 'rgba(229,72,77,0.08)' }}
            >
              <p className="text-[11px] font-semibold" style={{ color: '#E5484D' }}>
                {stage.offline ? '后端连不上，这条路需要后端' : `扫描被拒：${stage.code}`}
              </p>
              <p className="mt-1 text-[10.5px] leading-[16px] text-fgMuted">{stage.message}</p>
            </div>
          )}

          {artifacts && (
            <div className="mt-3 space-y-3">
              <FactSummaryCard
                summary={artifacts.summary}
                picks={artifacts.picksRes.picks}
                unmatched={artifacts.picksRes.unmatched}
                offline={stage.kind === 'done' ? stage.offline : false}
              />

              {/* ── 这次怎么选的 ── */}
              <div className="rounded border border-line px-2.5 py-2">
                <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
                  这次怎么选的（每条都带出处）
                </p>
                <ul className="mt-1.5 space-y-1 text-[10.5px] leading-[16px] text-fgMuted">
                  {artifacts.built.detail.fromDeps.map((d) => (
                    <li key={`dep-${d.dim}`} className="mono">
                      <span className="text-fg">{d.dim}={d.opt}</span> ←{' '}
                      {d.evidence.path}:{d.evidence.line}
                    </li>
                  ))}
                  {artifacts.built.detail.fromDeploy.map((d) => (
                    <li key={`dp-${d.dim}`} className="mono">
                      <span className="text-fg">{d.dim}={d.opt}</span> ← 部署清单 {d.because}
                    </li>
                  ))}
                  {artifacts.built.notes.map((n) => (
                    <li key={n} className="mono">
                      · {n}
                    </li>
                  ))}
                  {artifacts.picksRes.unmatched.map((u, i) => (
                    <li key={`${u.tech}-${i}`} style={{ color: '#E5A33D' }}>
                      · {u.tech}：{u.evidence}
                    </li>
                  ))}
                  {artifacts.built.detail.conflicts.map((c) => (
                    <li key={`cf-${c.dim}`} style={{ color: '#E5A33D' }}>
                      · {c.dim} 命中多个候选，图上只画了 {c.kept}；另有 {c.dropped.join('、')} 未采用
                    </li>
                  ))}
                </ul>
              </div>

              {/* ── 选型的出口：交给装配台 ──
                  扫描出来的 picks 以前只在本页显示，没有任何去处 ——
                  用户想「按现状继续加件」只能对着屏幕手工重挑 33 格。 */}
              {onPicks && (
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded border border-line px-2.5 py-2">
                  <button
                    type="button"
                    onClick={() => onPicks(artifacts.picksRes.picks, artifacts.provenance)}
                    className="rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors"
                    style={{
                      borderColor: 'rgba(217,164,65,0.6)',
                      background: 'rgba(217,164,65,0.12)',
                      color: '#D9A441',
                    }}
                    title="把这次识别出的槽位载入装配台继续装配，每一格都会标出它的出处"
                  >
                    用这套选型打开装配台
                  </button>
                  <span className="min-w-0 flex-1 text-[10px] leading-[15px] text-fgMuted">
                    载入 {Object.keys(artifacts.picksRes.picks).length} 个槽位，逐格标明出处；
                    未识别的 {artifacts.picksRes.unmatched.length} 项留空，不猜。
                  </span>
                </div>
              )}

              {variant === 'archify' ? (
                <>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <ProductRow
                      title="部署架构图"
                      desc={`${artifacts.built.arch.nodes.length} 节点 / ${artifacts.built.arch.edges.length} 连线 · 本地生成`}
                      previewing={showSvg === 'tech'}
                      onPreview={() => setShowSvg(showSvg === 'tech' ? 'none' : 'tech')}
                      onDownload={() =>
                        downloadText(artifacts.techSvg, `${safeName}-deploy.svg`, 'image/svg+xml')
                      }
                    />
                    <ProductRow
                      title="应用分层图"
                      desc={
                        `${artifacts.layered.bands.length} 带 / ` +
                        `${artifacts.layered.crossCalls.length} 处跨带直连 · 本地生成`
                      }
                      previewing={showSvg === 'layered'}
                      onPreview={() => setShowSvg(showSvg === 'layered' ? 'none' : 'layered')}
                      onDownload={() =>
                        downloadText(artifacts.layeredSvg, `${safeName}-layered.svg`, 'image/svg+xml')
                      }
                    />
                    <ProductRow
                      title="交付级 HTML"
                      desc={
                        artifacts.shape.length
                          ? `形状不对：${artifacts.shape[0]}`
                          : artifacts.issues.length
                            ? `构图预检 ${artifacts.issues.length} 条待解`
                            : '本地预检通过 · 需后端出图'
                      }
                      warn={Boolean(artifacts.shape.length || artifacts.issues.length)}
                      onDownload={() => onIr?.(artifacts.ir, `${artifacts.title} · 来自代码扫描`)}
                      actionLabel="填入出图台"
                    />
                  </div>

                  {artifacts.issues.length > 0 && (
                    <ul
                      className="rounded border px-2.5 py-2 text-[10.5px] leading-[16px]"
                      style={{ borderColor: 'rgba(229,163,61,0.4)' }}
                    >
                      {artifacts.issues.map((s) => (
                        <li key={s} style={{ color: '#E5A33D' }}>
                          · {s}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <ProfileDraftCard
                  draft={artifacts.draft}
                  onImport={() => onProfile?.(artifacts.draft.profile)}
                  onDownload={() =>
                    downloadText(
                      JSON.stringify(artifacts.draft.profile, null, 2),
                      `${artifacts.draft.profile.id}.json`,
                      'application/json'
                    )
                  }
                />
              )}

              {showSvg !== 'none' && (
                <div
                  className="overflow-auto rounded border border-line bg-surface"
                  dangerouslySetInnerHTML={{
                    __html: showSvg === 'tech' ? artifacts.techSvg : artifacts.layeredSvg,
                  }}
                />
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    downloadText(
                      JSON.stringify(artifacts.facts, null, 2),
                      `${safeName}-facts.json`,
                      'application/json'
                    )
                  }
                  className="rounded border border-line px-2.5 py-1 text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
                >
                  下载事实 JSON
                </button>
                <button
                  type="button"
                  onClick={() =>
                    downloadText(
                      JSON.stringify(artifacts.ir, null, 2),
                      `${safeName}-architecture.json`,
                      'application/json'
                    )
                  }
                  className="rounded border border-line px-2.5 py-1 text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
                >
                  下载 IR
                </button>
                <span className="text-[10px] text-fgFaint">
                  事实 JSON 与 IR 都可以留档 —— 下次不用重新扫仓库
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ProductRow({
  title,
  desc,
  onPreview,
  onDownload,
  previewing,
  warn,
  actionLabel,
}: {
  title: string;
  desc: string;
  onPreview?: () => void;
  onDownload: () => void;
  previewing?: boolean;
  warn?: boolean;
  actionLabel?: string;
}) {
  return (
    <div className="rounded border border-line px-2.5 py-2">
      <p className="text-[11.5px] font-semibold text-fg">{title}</p>
      <p className="mt-0.5 text-[10px] leading-[15px]" style={warn ? { color: '#E5A33D' } : undefined}>
        <span className={warn ? '' : 'text-fgFaint'}>{desc}</span>
      </p>
      <div className="mt-1.5 flex items-center gap-2">
        {onPreview && (
          <button
            type="button"
            onClick={onPreview}
            className="rounded border border-line px-2 py-0.5 text-[10.5px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
          >
            {previewing ? '收起' : '预览'}
          </button>
        )}
        <button
          type="button"
          onClick={onDownload}
          className="rounded border px-2 py-0.5 text-[10.5px] transition-colors"
          style={{ borderColor: 'rgba(217,164,65,0.45)', color: '#D9A441' }}
        >
          {actionLabel ?? '下载'}
        </button>
      </div>
    </div>
  );
}

function FactSummaryCard({
  summary,
  picks,
  unmatched,
  offline,
}: {
  summary: FactsSummary;
  picks: Record<string, string>;
  unmatched: FactsUnmatched[];
  offline: boolean;
}) {
  const kb = summary.bytes / 1024;
  return (
    <div className="rounded border border-line px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fgMuted">
        <span className="mono text-fg">{summary.root}</span>
        <span className="mono text-[10px] text-fgFaint">{summary.sourceKind}</span>
        <span>{summary.files} 文件</span>
        <span>{kb < 1024 ? `${kb.toFixed(0)} KB` : `${(kb / 1024).toFixed(1)} MB`}</span>
        <span>{summary.elapsedMs} ms</span>
        {summary.buildKind && <span>{summary.buildKind}</span>}
        {summary.javaVersion && <span>Java {summary.javaVersion}</span>}
        <span>
          技术命中 {summary.techs.length} 项（{summary.onCanvasCount} 项上部署图）
        </span>
        <span>依赖覆盖率 {(summary.coverage * 100).toFixed(0)}%</span>
        {summary.truncated && (
          <span style={{ color: '#E5A33D' }}>已被闸门截断，事实不完整</span>
        )}
        {offline && <span style={{ color: '#56C596' }}>离线模式（粘贴 JSON）</span>}
      </div>

      {/* 技术 chip 云 */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {summary.techs.map((t) => (
          <span
            key={t.tech}
            title={t.onCanvas ? '会出现在部署图上' : '已识别，但不占部署节点'}
            className="mono rounded px-1.5 py-0.5 text-[10px]"
            style={{
              background: t.onCanvas ? 'rgba(217,164,65,0.14)' : 'rgba(255,255,255,0.05)',
              color: t.onCanvas ? '#D9A441' : '#93A39C',
            }}
          >
            {scanTechName(t.tech)}
          </span>
        ))}
      </div>

      {/* 未识别 / 未采用清单 */}
      {unmatched.length > 0 && (
        <div className="mt-2">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            未识别 / 未采用（{unmatched.length}）
          </p>
          <ul className="mt-1 space-y-0.5">
            {unmatched.map((u, i) => (
              <li key={`${u.tech}-${i}`} className="mono text-[10.5px] text-fgMuted">
                {u.tech} <span className="text-fgFaint">· {u.evidence}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] leading-[15px] text-fgFaint">
            没有 dim 的技术（Maven / Lombok / JUnit 这类）与坐标不在映射表里的依赖都不会上图，
            但都列在这里 —— 补映射表在 <span className="mono">tools/content/scan_rules.py</span>。
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * 档案草稿卡。
 *
 * 「N 条来自扫描 / M 条待补」这两个数字必须一起显示 ——
 * 只说「已生成档案」会让人以为这就是成品，进而把 TODO 当事实读。
 */
function ProfileDraftCard({
  draft,
  onImport,
  onDownload,
}: {
  draft: ProfileDraft;
  onImport: () => void;
  onDownload: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? draft.todos : draft.todos.slice(0, 6);
  return (
    <div className="rounded border border-line px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span className="text-fg">
          档案草稿 <span className="mono text-fgMuted">{draft.profile.id}</span>
        </span>
        <span className="text-fgMuted">{draft.filled} 条来自扫描</span>
        <span style={{ color: draft.todos.length ? '#E5A33D' : '#56C596' }}>
          {draft.todos.length} 条待补（TODO）
        </span>
        {draft.issues.length > 0 && (
          <span style={{ color: '#E5484D' }}>形状校验未过 {draft.issues.length} 条</span>
        )}
      </div>

      <p className="mt-1 text-[10.5px] leading-[16px] text-fgMuted">
        六视图档案里大部分是「人写的话」—— 代码里没有「这件事为谁解决什么问题」这种句子。
        所以这份草稿只把扫描真的读到的填进去，其余留 TODO：导入后接着写，不用从空文件开始。
      </p>

      {draft.todos.length > 0 && (
        <div className="mt-1.5">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            需要人补的（{draft.todos.length}）
          </p>
          <ul className="mt-1 space-y-0.5">
            {shown.map((t) => (
              <li key={t} className="text-[10.5px] leading-[16px] text-fgMuted">
                · {t}
              </li>
            ))}
          </ul>
          {draft.todos.length > 6 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-1 text-[10px] text-fgFaint underline"
            >
              {showAll ? '收起' : `还有 ${draft.todos.length - 6} 条`}
            </button>
          )}
        </div>
      )}

      {draft.issues.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {draft.issues.slice(0, 5).map((s) => (
            <li key={s} className="text-[10.5px]" style={{ color: '#E5484D' }}>
              ✗ {s}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onImport}
          disabled={draft.issues.length > 0}
          className="rounded border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-45"
          style={{
            borderColor: 'rgba(217,164,65,0.5)',
            background: 'rgba(217,164,65,0.12)',
            color: '#D9A441',
          }}
        >
          导入到本机（六张图切过去）
        </button>
        <button
          type="button"
          onClick={onDownload}
          className="rounded border border-line px-2.5 py-1 text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
        >
          下载档案 JSON
        </button>
        <span className="text-[10px] text-fgFaint">
          下载的那份放进 arsenal-profiles/ 再跑 sync:content，才算正式档案
        </span>
      </div>
    </div>
  );
}
