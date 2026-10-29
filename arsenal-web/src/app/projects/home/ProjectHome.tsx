'use client';

/**
 * 项目主页（重建设计计划 §3.3「项目」页签，夜班 N7/N8 · 2026-10-30）。
 *
 * 六页签：总览 / 问题 / 修复 / 测试 / 交付物 / 设置。
 *   总览   —— run 历史 + 健康分 + 产物清单 + 「下载报告」（真调 v2 端点）
 *   问题   —— findings 筛选列表（后端解析 JSONL，前端不算第二遍）
 *   修复   —— 阶段 1 提供：现在只有一句照实的空态，不假装功能在
 *   测试   —— 阶段 2 提供：同上
 *   交付物 —— artifacts 全量清单（带 sha256，可复现）
 *   设置   —— 阶段 1 接入（忽略规则 / 引擎开关）：同上
 *
 * 状态四态纪律（重建计划 §3.4）：空 / 载入 / 离线 / 未验证 各有各的话，
 * 绝不把「没跑」说成「没问题」。
 *
 * 路由形态说明：重建计划原文是 `/projects/[id]`，但本站是 `output: 'export'`
 * 纯静态导出 —— 动态段无法枚举进构建，`[id]` 路由会当场编译失败。
 * 所以落在静态路由 `/projects/home?id=<projectId>`（与 rules/[id] 的
 * generateStaticParams 枚举形态不同：项目是运行时数据）。这是记录在案的
 * 有依据偏离，不是随手改名。
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import SeverityBadge from '@/components/SeverityBadge';
import type { Severity } from '@/lib/types';
import { getProject, listProjects, type ProjectDetail, type ProjectEntry } from '@/lib/projects-api';
import {
  createRun,
  listRuns,
  reportDownloadUrl,
  runArtifacts,
  runFindings,
  type FindingsPage,
  type RunArtifact,
  type RunFinding,
  type RunSummary,
} from '@/lib/runs-api';

const TABS = [
  ['overview', '总览'],
  ['findings', '问题'],
  ['fix', '修复'],
  ['tests', '测试'],
  ['artifacts', '交付物'],
  ['settings', '设置'],
] as const;

type Tab = (typeof TABS)[number][0];

/** 健康分口径与后端 ReportService.healthScore 同式：100 − P0×0.3 − P1×0.1 − 其他×0.05。 */
function healthScore(p0: number, p1: number, other: number): number {
  return Math.max(0, Math.round(100 - p0 * 0.3 - p1 * 0.1 - other * 0.05));
}

function fmtIso(iso?: string | null): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').slice(0, 19);
}

export default function ProjectHome({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<Tab>('overview');

  // ── 项目详情 ──
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [detailNote, setDetailNote] = useState<string | null>(null);

  // ── runs ──
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [runsNote, setRunsNote] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitNote, setSubmitNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const loadRuns = useCallback(async (pid: string) => {
    setRuns(null);
    setRunsNote(null);
    const out = await listRuns(pid);
    if (out.kind === 'ok') {
      setRuns(out.data);
      setSelected((cur) => cur ?? out.data.find((r) => r.status === 'DONE')?.runId ?? null);
    } else if (out.kind === 'offline') {
      setRuns([]);
      setRunsNote(out.message);
    } else {
      setRuns([]);
      setRunsNote(`${out.code}：${out.message}`);
    }
  }, []);

  useEffect(() => {
    if (!projectId) return;
    setDetail(null);
    setSelected(null);
    void getProject(projectId).then((out) => {
      if (out.kind === 'ok') setDetail(out.data);
      else setDetailNote(out.kind === 'offline' ? out.message : `${out.kind === 'rejected' ? out.code + '：' : ''}${out.message}`);
    });
    void loadRuns(projectId);
  }, [projectId, loadRuns]);

  const submit = useCallback(async () => {
    setSubmitting(true);
    setSubmitNote(null);
    const out = await createRun(projectId);
    setSubmitting(false);
    if (out.kind === 'ok') {
      setSubmitNote({
        tone: 'ok',
        text: `run ${out.data.runId} 完成：P0 ${out.data.counts.p0} · P1 ${out.data.counts.p1} · 其他 ${out.data.counts.other}（${Math.round(out.data.elapsedMs / 100) / 10}s）`,
      });
      setSelected(out.data.runId);
      void loadRuns(projectId);
    } else if (out.kind === 'offline') {
      setSubmitNote({ tone: 'err', text: out.message });
    } else {
      setSubmitNote({ tone: 'err', text: `${out.code}：${out.message}` });
    }
  }, [projectId, loadRuns]);

  return (
    <div className="mx-auto max-w-[980px]">
      <header className="mb-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-xl font-semibold text-fg">{detail?.name ?? '项目主页'}</h1>
          <span className="mono text-2xs text-fgFaint">{projectId}</span>
          {detail?.cache?.fingerprint && (
            <span className="mono text-2xs text-fgFaint">快照 {detail.cache.fingerprint}</span>
          )}
        </div>
        <p className="mt-1 text-sm text-fgMuted">
          每次体检都是一次 run：报告、问题、产物全部挂在 run 上，可下载、可复现。
        </p>
      </header>

      {detailNote && (
        <p className="mb-4 rounded-lg border border-dashed border-line bg-surface px-4 py-3 text-xs leading-relaxed text-fgMuted">
          {detailNote}　<Link href="/projects" className="text-brass underline decoration-dotted">回项目管理 →</Link>
        </p>
      )}

      {/* 页签 */}
      <nav className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className="rounded-t px-3 py-2 text-[13px] transition-colors"
            style={{
              color: tab === id ? '#E8F0EC' : '#93A39C',
              background: tab === id ? 'rgba(217,164,65,0.09)' : 'transparent',
              borderBottom: tab === id ? '2px solid #D9A441' : '2px solid transparent',
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <OverviewTab
          detail={detail}
          runs={runs}
          runsNote={runsNote}
          selected={selected}
          onPick={setSelected}
          onSubmit={submit}
          submitting={submitting}
          submitNote={submitNote}
        />
      )}
      {tab === 'findings' && <FindingsTab runId={selected} />}
      {tab === 'fix' && <PlaceholderTab title="修复闭环" when="阶段 1（第 2–3 周）" what="选中问题 → 生成补丁 → 沙箱验证（编译 / 复跑 / 测试）→ 下载 diff" />}
      {tab === 'tests' && <PlaceholderTab title="测试闭环" when="阶段 2（第 4–5 周）" what="现有测试执行 + 覆盖缺口清单 + 生成 JUnit（红→绿证据）" />}
      {tab === 'artifacts' && <ArtifactsTab runId={selected} />}
      {tab === 'settings' && <PlaceholderTab title="项目设置" when="阶段 1" what="忽略规则（arsenal.lint.ignore-globs）/ 引擎开关 / 范围圈定" />}
    </div>
  );
}
// ── 总览 ──────────────────────────────────────────────────────

function OverviewTab({
  detail, runs, runsNote, selected, onPick, onSubmit, submitting, submitNote,
}: {
  detail: ProjectDetail | null;
  runs: RunSummary[] | null;
  runsNote: string | null;
  selected: string | null;
  onPick: (id: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  submitNote: { tone: 'ok' | 'err'; text: string } | null;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting}
          className="rounded border border-brass bg-brass/10 px-4 py-2 text-sm font-medium text-brass disabled:opacity-50"
        >
          {submitting ? '体检运行中…（静态引擎，最长 3 分钟）' : '运行体检'}
        </button>
        {submitNote && (
          <span className="text-xs" style={{ color: submitNote.tone === 'ok' ? '#56C596' : '#E5484D' }}>
            {submitNote.text}
          </span>
        )}
      </div>

      {runsNote && (
        <p className="rounded-lg border border-dashed border-line bg-surface px-4 py-3 text-xs text-fgMuted">{runsNote}</p>
      )}

      {!runsNote && runs && runs.length === 0 && (
        <p className="rounded-lg border border-dashed border-line bg-surface px-4 py-6 text-center text-sm text-fgMuted">
          这个项目还没有 run。点上面「运行体检」跑第一次 —— 报告、问题、产物都会落在这里。
        </p>
      )}

      {runs && runs.length > 0 && (
        <section className="panel overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-line text-fgFaint">
                <th className="px-3 py-2 font-medium">run</th>
                <th className="px-3 py-2 font-medium">状态</th>
                <th className="px-3 py-2 font-medium">开始时间</th>
                <th className="px-3 py-2 font-medium">P0</th>
                <th className="px-3 py-2 font-medium">快照</th>
                <th className="px-3 py-2 font-medium">规则集</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const counts = (r as RunSummary & { counts?: { p0?: number } }).counts;
                return (
                  <tr
                    key={r.runId}
                    onClick={() => onPick(r.runId)}
                    className="cursor-pointer border-b border-line/50 transition-colors hover:bg-surfaceHi"
                    style={{ background: selected === r.runId ? 'rgba(217,164,65,0.07)' : undefined }}
                  >
                    <td className="mono px-3 py-2 text-fg">{r.runId.slice(0, 8)}{selected === r.runId ? ' ←' : ''}</td>
                    <td className="px-3 py-2">
                      <StatusChip status={r.status} />
                    </td>
                    <td className="mono px-3 py-2 text-fgMuted">{fmtIso(r.startedAt)}</td>
                    <td className="mono px-3 py-2 text-fgMuted">{counts?.p0 ?? '—'}</td>
                    <td className="mono px-3 py-2 text-fgFaint">{r.manifest?.snapshot ?? '—'}</td>
                    <td className="mono px-3 py-2 text-fgFaint">{r.manifest?.rulesetVersion ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {selected && <SelectedRun runId={selected} />}
    </div>
  );
}

function StatusChip({ status }: { status: RunSummary['status'] }) {
  const map: Record<RunSummary['status'], [string, string]> = {
    DONE: ['#56C596', '完成'],
    RUNNING: ['#D9A441', '运行中'],
    FAILED: ['#E5484D', '失败'],
    UNKNOWN: ['#888780', '账目残缺'],
  };
  const [color, label] = map[status];
  return (
    <span className="mono rounded px-1.5 py-0.5 text-[10px]" style={{ color, background: color + '14' }}>
      {label}
    </span>
  );
}

function SelectedRun({ runId }: { runId: string }) {
  const [arts, setArts] = useState<RunArtifact[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    setArts(null);
    setNote(null);
    void runArtifacts(runId).then((out) => {
      if (out.kind === 'ok') setArts(out.data);
      else setNote(`${out.kind === 'rejected' ? out.code + '：' : ''}${out.message}`);
    });
  }, [runId]);

  return (
    <section className="panel p-4">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-fg">选中 run <span className="mono">{runId}</span></h3>
        <a
          href={reportDownloadUrl(runId)}
          className="text-xs text-brass underline decoration-dotted underline-offset-2"
          // report.md 端点带 Content-Disposition 附件头，浏览器点开即下载
        >
          下载体检报告 ↓
        </a>
      </div>
      {note && <p className="text-xs text-fgMuted">{note}</p>}
      {!note && arts && (
        <ul className="space-y-1">
          {arts.map((a) => (
            <li key={a.name} className="flex flex-wrap items-baseline gap-x-3 text-xs">
              <span className="mono w-40 text-fg">{a.name}</span>
              <span className="mono text-fgFaint">{(a.bytes / 1024).toFixed(1)} KB</span>
              <span className="mono truncate text-fgFaint" title={a.sha256}>sha256 {a.sha256.slice(0, 16)}…</span>
            </li>
          ))}
        </ul>
      )}
      {!arts && !note && <p className="text-xs text-fgFaint">读取产物清单…</p>}
    </section>
  );
}

// ── 问题 ──────────────────────────────────────────────────────

function FindingsTab({ runId }: { runId: string | null }) {
  const [severity, setSeverity] = useState('');
  const [ruleId, setRuleId] = useState('');
  const [file, setFile] = useState('');
  const [page, setPage] = useState<FindingsPage | null>(null);
  const [load, setLoad] = useState<'loading' | 'ok' | 'empty' | 'offline' | 'rejected'>('loading');
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      setLoad('empty');
      setNote('先在「总览」选中一个 DONE 的 run。');
      return;
    }
    let alive = true;
    setLoad('loading');
    setNote(null);
    void runFindings(runId, { severity: severity || undefined, ruleId: ruleId || undefined, file: file || undefined, limit: 200 }).then((out) => {
      if (!alive) return;
      if (out.kind === 'ok') {
        setPage(out.data);
        setLoad(out.data.total === 0 ? 'empty' : 'ok');
      } else if (out.kind === 'offline') {
        setLoad('offline');
        setNote(out.message);
      } else {
        setLoad('rejected');
        setNote(`${out.code}：${out.message}`);
      }
    });
    return () => {
      alive = false;
    };
  }, [runId, severity, ruleId, file]);

  if (load === 'empty' || load === 'offline' || load === 'rejected') {
    return (
      <p className="rounded-lg border border-dashed border-line bg-surface px-4 py-6 text-sm text-fgMuted">
        {note}
        {load === 'empty' && !note && '这个筛选下没有问题。'}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {/* 筛选行 */}
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="mb-1 block text-2xs text-fgMuted">严重度</span>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="rounded border border-line bg-canvas px-2 py-1.5 text-xs text-fg"
          >
            <option value="">全部</option>
            <option value="NEVER">NEVER</option>
            <option value="MUST">MUST</option>
            <option value="SHOULD">SHOULD</option>
            <option value="MAY">MAY</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-2xs text-fgMuted">规则 ID</span>
          <input
            value={ruleId}
            onChange={(e) => setRuleId(e.target.value)}
            placeholder="REL-LOG-001"
            className="mono w-40 rounded border border-line bg-canvas px-2 py-1.5 text-xs text-fg"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-2xs text-fgMuted">文件包含</span>
          <input
            value={file}
            onChange={(e) => setFile(e.target.value)}
            placeholder="controller/"
            className="mono w-48 rounded border border-line bg-canvas px-2 py-1.5 text-xs text-fg"
          />
        </label>
        {page && (
          <span className="mono pb-1.5 text-2xs text-fgFaint">
            {page.returned}/{page.total} 条
            {page.badLines > 0 && ` · ${page.badLines} 行无法解析（已跳过）`}
          </span>
        )}
      </div>

      {load === 'loading' && <p className="text-xs text-fgFaint">读取 findings…</p>}

      {load === 'ok' && page && (
        <ul className="space-y-1.5">
          {page.items.map((f, i) => (
            <FindingRow key={`${f.ruleId}-${f.file}-${f.line}-${i}`} f={f} />
          ))}
          {page.returned < page.total && (
            <li className="pt-1 text-2xs text-fgFaint">
              只展示前 {page.returned} 条，共 {page.total} 条 —— 全量在交付物的 findings.jsonl 里（带 sha256）。
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function FindingRow({ f }: { f: RunFinding }) {
  const [open, setOpen] = useState(false);
  const sourceRef = f.rule?.sources?.[0]?.ref;
  return (
    <li className="rounded border border-line bg-surface px-3 py-2">
      <button type="button" onClick={() => setOpen((s) => !s)} className="flex w-full flex-wrap items-baseline gap-2 text-left">
        <SeverityBadge severity={f.severity as Severity} size="sm" />
        <span className="mono text-[11px] text-brass">{f.ruleId}</span>
        <span className="flex-1 text-[12px] text-fg">{f.title}</span>
        <span className="mono text-[10px] text-fgMuted">{f.file}:{f.line}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5 border-t border-line pt-2 text-[11px] leading-relaxed">
          {f.snippet && (
            <pre className="mono max-h-40 overflow-auto rounded border border-line px-2 py-1 text-[10px] text-fgMuted">{f.snippet}</pre>
          )}
          {sourceRef && <p className="text-fgMuted">出处：{sourceRef}</p>}
          <p className="text-fgMuted">
            为什么：<Link href={`/rules/${f.ruleId}`} className="text-brass underline decoration-dotted">看规则详情（反例 / 正例 / 校验方式）</Link>
          </p>
        </div>
      )}
    </li>
  );
}

// ── 交付物 ────────────────────────────────────────────────────

function ArtifactsTab({ runId }: { runId: string | null }) {
  const [arts, setArts] = useState<RunArtifact[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      setNote('先在「总览」选中一个 run。');
      return;
    }
    setNote(null);
    void runArtifacts(runId).then((out) => {
      if (out.kind === 'ok') setArts(out.data);
      else setNote(`${out.kind === 'rejected' ? out.code + '：' : ''}${out.message}`);
    });
  }, [runId]);

  if (note) {
    return <p className="rounded-lg border border-dashed border-line bg-surface px-4 py-6 text-sm text-fgMuted">{note}</p>;
  }
  if (!arts) {
    return <p className="text-xs text-fgFaint">读取产物清单…</p>;
  }
  return (
    <div className="panel p-4">
      <p className="mb-3 text-xs text-fgMuted">
        每件产物带 sha256 —— 报告要能被引用、被比对、被复现，没有哈希的产物无法自证「还是当初那份」。
      </p>
      <ul className="space-y-1.5">
        {arts.map((a) => (
          <li key={a.name} className="flex flex-wrap items-baseline gap-x-3 text-xs">
            <span className="mono w-44 text-fg">{a.name}</span>
            <span className="mono text-fgFaint">{(a.bytes / 1024).toFixed(1)} KB</span>
            <span className="mono truncate text-fgFaint" title={a.sha256}>{a.sha256}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── 诚实占位 ──────────────────────────────────────────────────

function PlaceholderTab({ title, when, what }: { title: string; when: string; what: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-surface px-4 py-6 text-sm text-fgMuted">
      <p className="font-medium text-fg">{title} —— {when}提供</p>
      <p className="mt-1.5">{what}</p>
      <p className="mt-1.5 text-xs text-fgFaint">
        这是重建计划（docs/重建设计与实施计划-2026-10-29.md §8）排定的次序，本页签先留照实的空态，不假装功能在。
      </p>
    </div>
  );
}
