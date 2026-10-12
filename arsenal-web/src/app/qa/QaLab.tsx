'use client';

import { useCallback, useRef, useState } from 'react';
import {
  qaJob,
  qaReport,
  qaSnapshots,
  qaSubmit,
  qaTree,
  type QaJobNode,
  type QaRange,
  type QaRangeMode,
  type QaRecommendation,
  type QaReport as QaReportData,
  type QaSnapshotSummary,
  type QaTree,
} from '@/lib/arsenal-api';
import SeverityBadge from '@/components/SeverityBadge';
import type { Severity } from '@/lib/types';

/**
 * 测试工程师 `/qa`。
 *
 * 一句话：给一个地址 → 异步 Job 深度审查 → 四面板（A 硬伤 / B 语义深检 /
 * C 逐点优化方案 / D 测试建议），全程可圈定范围。
 *
 * 三条刻意的分工（别在页面里重写任何一条）：
 *   ① **怎么拿结论** —— `qaSubmit / qaJob / qaReport`（`lib/arsenal-api.ts`）。
 *      提交秒回 jobId，clone/扫描/聚合全在后台线程，前端只做轮询。
 *   ② **结论怎么算** —— 后端 `QaService`：静态档复用 /api/autopsy 同一台引擎，
 *      覆盖率沿用 autopsy 的三态披露口径。前端一条都不重算。
 *   ③ **projectId 怎么来** —— 后端 submit 的回包。**前端不自己算哈希**：
 *      路径规范化口径只该有一处，算两份早晚各说各的。
 *
 * M1 边界（页面上必须如实写的两件事）：
 *   · 语义深检（面板 B）恒为「未执行」—— LLM 层是 M2/M3 的交付，占位不是结果；
 *   · 优化方案（面板 C）离线走规则自带正例模板，规则没附正例的只给说明，
 *     不编造示例代码（后端在 afterNote 里写死这一点）。
 */

type Mode = 'path' | 'git';

type Stage =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'running'; job: QaJobNode }
  | { kind: 'failed'; code: string; message: string; offline: boolean }
  | { kind: 'done'; report: QaReportData; job: QaJobNode };

const MODES: [Mode, string, string][] = [
  ['path', '本地目录', 'D:/mryang/workspace/2026/arsenal/arsenal-server'],
  ['git', 'https git', 'https://github.com/owner/repo.git'],
];

/** 后台流水线的 4 段。PENDING 是排队（第 0 段），页面上并排显示 */
const PHASES: [string, string][] = [
  ['CLONING', '摄取'],
  ['SCANNING', '静态审查'],
  ['ANALYZING', '语义深检'],
  ['AGGREGATING', '方案聚合'],
];

const RANGE_MODES: [QaRangeMode, string, string][] = [
  ['full', '整仓', '全仓库检测，不圈范围'],
  ['review', '严格局部', '只读圈内文件，圈外未检查'],
  ['focus', '全量聚焦', '整仓都扫，明细只列圈内，圈外折叠成计数'],
];

function splitGlobs(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

type QaNote = { target?: string; note?: string };

function isNote(x: QaNote | undefined): x is { note: string } {
  return !!x && typeof x.note === 'string';
}

export default function QaLab() {
  const [mode, setMode] = useState<Mode>('path');
  const [source, setSource] = useState('');
  const [rangeMode, setRangeMode] = useState<QaRangeMode>('full');
  const [includeRaw, setIncludeRaw] = useState('');
  const [excludeRaw, setExcludeRaw] = useState('');
  const [deepCheck, setDeepCheck] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [tab, setTab] = useState<'hard' | 'semantic' | 'recs' | 'tests'>('hard');

  // projectId 只从后端回包拿（见顶部分工 ③）
  const [projectId, setProjectId] = useState<string | null>(null);
  const [tree, setTree] = useState<QaTree | null>(null);
  const [treeNote, setTreeNote] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<QaSnapshotSummary[]>([]);

  // 轮询归 cancel 令牌管：换了输入 / 重新提交，旧的循环必须立刻停下，
  // 否则两个循环会往同一个 state 里写两份互相矛盾的进度。
  const tokenRef = useRef(0);

  const range: QaRange = {
    mode: rangeMode,
    include: rangeMode === 'full' ? [] : splitGlobs(includeRaw),
    exclude: rangeMode === 'full' ? [] : splitGlobs(excludeRaw),
  };

  const loadTree = useCallback(async (pid: string) => {
    const out = await qaTree(pid);
    if (out.kind === 'ok') {
      setTree(out.data);
      setTreeNote(null);
    } else {
      setTree(null);
      setTreeNote(out.message);
    }
  }, []);

  const loadSnapshots = useCallback(async (pid: string) => {
    const out = await qaSnapshots(pid);
    setSnapshots(out.kind === 'ok' ? out.data : []);
  }, []);

  const run = useCallback(async () => {
    const value = source.trim();
    if (!value) return;
    const token = ++tokenRef.current;
    setStage({ kind: 'submitting' });
    setTree(null);
    setTreeNote(null);

    const submitted = await qaSubmit(
      { kind: mode === 'git' ? 'git' : 'path', value },
      range,
      deepCheck
    );
    if (tokenRef.current !== token) return;
    if (submitted.kind === 'offline') {
      setStage({ kind: 'failed', code: 'OFFLINE', message: submitted.message, offline: true });
      return;
    }
    if (submitted.kind === 'rejected') {
      setStage({ kind: 'failed', code: submitted.code, message: submitted.message, offline: false });
      return;
    }
    const jobId = submitted.data.jobId;
    setProjectId(submitted.data.projectId);
    void loadSnapshots(submitted.data.projectId);

    // 轮询：1.5s 一跳。网络单次失败不掐循环（后端在，请求迟早回来）；
    // 业务拒绝（jobId 不认识等）立即停 —— 那多等一万次也好不了。
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500));
      if (tokenRef.current !== token) return;
      const out = await qaJob(jobId);
      if (tokenRef.current !== token) return;
      if (out.kind === 'rejected') {
        setStage({ kind: 'failed', code: out.code, message: out.message, offline: false });
        return;
      }
      if (out.kind === 'ok') {
        const job = out.data;
        if (job.status === 'FAILED') {
          setStage({
            kind: 'failed',
            code: 'JOB_FAILED',
            message: job.error || '后台任务失败（详见 phase 状态）',
            offline: false,
          });
          return;
        }
        if (job.status === 'DONE') {
          const rep = await qaReport(jobId);
          if (tokenRef.current !== token) return;
          if (rep.kind === 'ok') {
            setStage({ kind: 'done', report: rep.data, job });
            void loadTree(job.projectId);
            void loadSnapshots(job.projectId);
          } else if (rep.kind === 'rejected') {
            setStage({ kind: 'failed', code: rep.code, message: rep.message, offline: false });
          } else {
            setStage({ kind: 'failed', code: 'OFFLINE', message: rep.message, offline: true });
          }
          return;
        }
        setStage({ kind: 'running', job });
      }
    }
  }, [mode, source, range, deepCheck, loadSnapshots, loadTree]);

  const onPickPath = useCallback(
    (rel: string) => {
      const glob = rel ? `${rel}/**` : '';
      if (!glob) return;
      const list = splitGlobs(includeRaw);
      if (!list.includes(glob)) setIncludeRaw([...list, glob].join('\n'));
    },
    [includeRaw]
  );

  const busy = stage.kind === 'submitting' || stage.kind === 'running';

  return (
    <div className="space-y-3">
      <header>
        <h1 className="text-[14px] font-bold text-fg">测试工程师</h1>
        <p className="mt-1 text-[11px] leading-[17px] text-fgMuted">
          给一个项目地址，异步跑一轮深度审查：先跑规则找硬伤，再逐点给出带 before/after 的优化方案与该补的测试。
          可以整仓检，也可以只圈一部分代码检。提交秒回、后台执行，页面不卡死。
        </p>
      </header>

      {/* ── 输入卡 ── */}
      <div className="panel px-3 py-3">
        <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">一、填地址、圈范围</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded border border-line p-0.5">
            {MODES.map(([id, label]) => (
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
          <input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            spellCheck={false}
            placeholder={MODES.find((m) => m[0] === mode)?.[2] ?? ''}
            className="mono min-w-[280px] flex-1 rounded border border-line bg-transparent px-2 py-1 text-[11px] text-fg outline-none placeholder:text-fgFaint focus:border-lineHi"
          />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded border border-line p-0.5">
            {RANGE_MODES.map(([id, label, hint]) => (
              <button
                key={id}
                type="button"
                title={hint}
                onClick={() => setRangeMode(id)}
                className={
                  'rounded px-2.5 py-1 text-[11px] transition-colors ' +
                  (rangeMode === id ? 'bg-surfaceHi text-brass' : 'text-fgMuted hover:text-fg')
                }
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-[10.5px] text-fgMuted">
            <input
              type="checkbox"
              checked={deepCheck}
              disabled
              className="accent-brass"
            />
            <span className="opacity-45">语义深检（LLM）—— M2 上线，当前恒为未执行</span>
          </label>
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy || !source.trim() || (rangeMode !== 'full' && range.include.length === 0)}
            className="ml-auto rounded border px-3 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45"
            style={{ borderColor: 'rgba(217,164,65,0.5)', background: 'rgba(217,164,65,0.12)', color: '#D9A441' }}
          >
            {busy ? '审查中…' : '开始审查'}
          </button>
        </div>

        {rangeMode !== 'full' && (
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <div>
              <label className="mono text-[10px] uppercase text-fgFaint">include（每行一个 glob，必填）</label>
              <textarea
                value={includeRaw}
                onChange={(e) => setIncludeRaw(e.target.value)}
                spellCheck={false}
                rows={3}
                placeholder={'src/main/java/com/x/order/**\nsrc/main/resources/*.yml'}
                className="mono mt-1 w-full rounded border border-line bg-transparent px-2 py-1 text-[11px] text-fg outline-none placeholder:text-fgFaint focus:border-lineHi"
              />
            </div>
            <div>
              <label className="mono text-[10px] uppercase text-fgFaint">exclude（可空，后减）</label>
              <textarea
                value={excludeRaw}
                onChange={(e) => setExcludeRaw(e.target.value)}
                spellCheck={false}
                rows={3}
                placeholder={'**/*Test.java'}
                className="mono mt-1 w-full rounded border border-line bg-transparent px-2 py-1 text-[11px] text-fg outline-none placeholder:text-fgFaint focus:border-lineHi"
              />
            </div>
          </div>
        )}

        {rangeMode !== 'full' && (
          <p className="mt-1.5 text-[10px] leading-[15px] text-fgFaint">
            <span className="mono">review</span>：圈外文件内容都不读 —— 报告里没有圈外结论，也不假装扫过。{' '}
            <span className="mono">focus</span>：整仓照扫（分层、调用闭包是全局事实），明细只列圈内、圈外折叠成计数。
            glob 一律相对仓库根，越界路径（<span className="mono">..</span> / 绝对路径）直接拒绝。
          </p>
        )}

        {rangeMode !== 'full' && projectId && (
          <div className="mt-2">
            {tree ? (
              <div className="max-h-44 overflow-y-auto rounded border border-line px-2 py-1.5">
                <p className="mono text-[10px] text-fgFaint">
                  目录树来自上次深检（job {tree.fromJobId}，{tree.from}）—— 点节点加进 include，不重新 clone
                </p>
                <TreePicker files={tree.files} onPick={onPickPath} />
              </div>
            ) : (
              <p className="text-[10.5px] text-fgFaint">{treeNote ?? '目录树还没加载'}</p>
            )}
          </div>
        )}

        {stage.kind === 'submitting' && <p className="mt-2.5 mono text-[11px] text-fgMuted">提交中…</p>}

        {stage.kind === 'failed' && (
          <div
            className="mt-2.5 rounded border px-2.5 py-2"
            style={{ borderColor: 'rgba(229,72,77,0.4)', background: 'rgba(229,72,77,0.08)' }}
          >
            <p className="text-[11px] font-semibold" style={{ color: '#E5484D' }}>
              {stage.offline ? '后端连不上（:3011 没起）' : `审查失败：${stage.code}`}
            </p>
            <p className="mt-1 text-[10.5px] leading-[16px] text-fgMuted">{stage.message}</p>
            {stage.offline && (
              <p className="mt-1 text-[10px] leading-[15px] text-fgFaint">
                起后端：<span className="mono">SKIP_COMPILE=1 bash arsenal-server/scripts/run.sh</span>。
                本页整条链路都在后端 Job 里，没有离线兜底。
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── 进度条（5 段：排队 + 4 个 phase） ── */}
      {stage.kind === 'running' && (
        <div className="panel px-3 py-2.5">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            二、执行进度 · job <span className="text-fg">{stage.job.jobId}</span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <PhaseChip
              label="排队"
              state={
                stage.job.status === 'PENDING'
                  ? 'running'
                  : stage.job.phases.CLONING === 'pending'
                    ? 'running'
                    : 'done'
              }
            />
            {PHASES.map(([id, label]) => (
              <PhaseChip key={id} label={label} state={stage.job.phases[id] ?? 'pending'} />
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-fgFaint">
            {stage.job.status} · 当前 {stage.job.phase || '—'} · 页面照常可交互，随时回来刷新（1.5s 一 poll）
          </p>
        </div>
      )}

      {stage.kind === 'done' && <ReportView report={stage.report} onTab={tab} setTab={setTab} snapshots={snapshots} />}

      {stage.kind === 'idle' && (
        <div className="panel px-3 py-2.5 text-[10.5px] leading-[16px] text-fgMuted">
          还没跑过审查。报告出四个面板：A 硬伤清单（与 /autopsy 同一台引擎、同一口径）、B 语义深检（M1 恒未执行，如实标出）、
          C 逐点优化方案（before/after，规则没附正例的只给说明不编代码）、D 测试建议（缺测试的核心路径清单）。
          每次审查自动留档在服务器侧 <span className="mono">.data/qa/&lt;projectId&gt;/</span>，不进 git。
        </div>
      )}
    </div>
  );
}

function PhaseChip({ label, state }: { label: string; state: string }) {
  const map: Record<string, { c: string; bg: string; mark: string; text: string }> = {
    pending: { c: '#93A39C', bg: 'rgba(255,255,255,0.05)', mark: '·', text: '待执行' },
    running: { c: '#E5A33D', bg: 'rgba(229,163,61,0.1)', mark: '▶', text: '执行中' },
    done: { c: '#7FA650', bg: 'rgba(127,166,80,0.1)', mark: '✓', text: '完成' },
    failed: { c: '#E5484D', bg: 'rgba(229,72,77,0.1)', mark: '✕', text: '失败' },
  };
  const t = map[state] ?? map.pending;
  return (
    <span
      className="mono rounded border px-2 py-0.5 text-[10.5px]"
      style={{ borderColor: t.c + '55', background: t.bg, color: t.c }}
    >
      {t.mark} {label}·{t.text}
    </span>
  );
}

/** 目录树勾选：把扁平文件清单聚成目录节点，点目录 = 加一条 `目录/**` */
function TreePicker({ files, onPick }: { files: string[]; onPick: (rel: string) => void }) {
  const dirs = new Map<string, number>();
  for (const f of files) {
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) {
      const d = parts.slice(0, i).join('/');
      dirs.set(d, (dirs.get(d) ?? 0) + 1);
    }
  }
  const top = [...dirs.entries()]
    .filter(([d]) => d.split('/').length <= 3)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, 60);
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {top.map(([d, n]) => (
        <button
          key={d}
          type="button"
          onClick={() => onPick(d)}
          title={`加进 include：${d}/**（${n} 个文件）`}
          className="mono rounded border border-line px-1.5 py-0.5 text-[10px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
        >
          {d}/ <span className="text-fgFaint">{n}</span>
        </button>
      ))}
    </div>
  );
}

function ReportView({
  report,
  onTab,
  setTab,
  snapshots,
}: {
  report: QaReportData;
  onTab: 'hard' | 'semantic' | 'recs' | 'tests';
  setTab: (t: 'hard' | 'semantic' | 'recs' | 'tests') => void;
  snapshots: QaSnapshotSummary[];
}) {
  const f = report.staticFindings;
  const cov = report.coverage;
  const tr = report.targetRange;
  const total = (f.p0?.length ?? 0) + (f.p1?.length ?? 0) + (f.other?.length ?? 0);

  return (
    <>
      {/* ── 范围横幅：本次到底看了多大一块，写死在报告头部 ── */}
      <div className="panel px-3 py-2.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px]">
          <span className="mono text-fg">{report.projectRef.rootName}</span>
          <span className="text-fgMuted">
            本次范围：
            {tr.mode === 'full'
              ? `整仓 ${tr.filesTotal} 个文件`
              : `${tr.filesMatched}/${tr.filesTotal} 个文件（占全仓 ${tr.pctOfRepo}%）· ${tr.mode === 'review' ? '严格局部' : '全量聚焦'}`}
          </span>
          <span className="text-fgFaint">{report.elapsedMs} ms · {report.scannedAt}</span>
          {report.scope.truncated && (
            <span style={{ color: '#E5A33D' }}>已达上限被截断，结论不完整</span>
          )}
        </div>
        {tr.mode === 'review' && (
          <p className="mt-1 text-[10.5px] leading-[16px]" style={{ color: '#E5A33D' }}>
            review 模式：圈外 {(cov.scopeFilteredOut ?? (tr.filesTotal - tr.filesMatched))} 个文件未读未检 ——
            这份报告对它们没有任何结论，「没报」不等于「没问题」。
          </p>
        )}
        {tr.mode === 'focus' && f.outOfScopeSummary && (
          <p className="mt-1 text-[10.5px] leading-[16px] text-fgMuted">
            focus 模式：整仓都扫过了，圈外另有{' '}
            <span className="mono" style={{ color: '#E5484D' }}>P0 {f.outOfScopeSummary.p0}</span> ·{' '}
            <span className="mono" style={{ color: '#E5A33D' }}>P1 {f.outOfScopeSummary.p1}</span> ·{' '}
            <span className="mono">MAY {f.outOfScopeSummary.other}</span>（折叠只给计数，明细见留档 JSON）。
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-fgFaint">
          <span>
            覆盖 {cov.executed}/{cov.total} 条规则，{cov.notRun} 条本次没结论（未覆盖 ≠ 通过）
          </span>
          {cov.scopeFilteredOut > 0 && <span>引擎侧按范围过滤 {cov.scopeFilteredOut} 文件</span>}
          {!cov.decidable && <span style={{ color: '#E5484D' }}>本次判定为「不可判定」，条数只作参考</span>}
        </div>
      </div>

      {/* ── 四面板页签 ── */}
      <div className="flex items-center gap-1 self-start rounded border border-line p-0.5">
        {(
          [
            ['hard', `A 硬伤（${total}）`],
            ['semantic', 'B 语义深检'],
            ['recs', `C 优化方案（${report.recommendations.length}）`],
            ['tests', `D 测试建议（${report.testSuggestions.length}）`],
          ] as ['hard' | 'semantic' | 'recs' | 'tests', string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={
              'rounded px-2.5 py-1 text-[11px] transition-colors ' +
              (onTab === id ? 'bg-surfaceHi text-brass' : 'text-fgMuted hover:text-fg')
            }
          >
            {label}
          </button>
        ))}
      </div>

      {onTab === 'hard' && <HardPanel report={report} />}
      {onTab === 'semantic' && (
        <div className="panel px-3 py-3">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">面板 B · 语义深检</p>
          <div
            className="mt-2 rounded border px-2.5 py-2"
            style={{ borderColor: 'rgba(229,163,61,0.4)', background: 'rgba(229,163,61,0.08)' }}
          >
            <p className="text-[11px] font-semibold" style={{ color: '#E5A33D' }}>
              语义深检未执行（{report.semanticStatus}）
            </p>
            <p className="mt-1 text-[10.5px] leading-[16px] text-fgMuted">{report.semanticReason}</p>
          </div>
        </div>
      )}
      {onTab === 'recs' && <RecsPanel items={report.recommendations} />}
      {onTab === 'tests' && <TestsPanel items={report.testSuggestions} />}

      {snapshots.length > 0 && (
        <div className="panel px-3 py-2.5">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            本项目历史（{snapshots.length} 份，服务器侧 .data/qa/，不进 git）
          </p>
          <ul className="mt-1.5 space-y-1 text-[10.5px] leading-[16px]">
            {snapshots.slice(0, 8).map((s) => (
              <li key={s.jobId} className="mono text-fgMuted">
                <span className="text-fg">{s.scannedAt}</span> · {s.jobId} · {s.mode} ·{' '}
                {s.filesMatched || s.files} 文件 · P0 {s.p0} / P1 {s.p1}
                {s.truncated && <span style={{ color: '#E5A33D' }}> · 截断</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function HardPanel({ report }: { report: QaReportData }) {
  const f = report.staticFindings;
  const tiers: ['p0' | 'p1' | 'other', string, string][] = [
    ['p0', 'P0 必修', '#E5484D'],
    ['p1', 'P1 该改', '#E5A33D'],
    ['other', 'MAY 可选', '#93A39C'],
  ];
  return (
    <div className="space-y-3">
      {tiers.map(([key, label, color]) => {
        const items = f[key] ?? [];
        return (
          <div key={key} className="panel px-3 py-2.5">
            <p className="text-[11px] font-semibold" style={{ color }}>
              {label} · {items.length} 条
            </p>
            {items.length === 0 ? (
              <p className="mt-1 text-[10.5px] text-fgFaint">
                0 条 —— 这是「跑过的规则里没有命中」，不是「合规」（覆盖 {report.coverage.executed}/{report.coverage.total}）。
              </p>
            ) : (
              <ul className="mt-1.5 space-y-1.5">
                {items.slice(0, 60).map((v, i) => (
                  <li key={`${key}-${v.ruleId}-${v.file}-${v.line}-${i}`} className="text-[10.5px] leading-[16px]">
                    <SeverityBadge severity={v.severity as Severity} size="sm" />{' '}
                    <span className="text-fg">{v.title}</span>
                    <span className="mono text-fgFaint"> — {v.evidence}</span>
                    {v.snippet && (
                      <pre className="mono mt-0.5 overflow-x-auto whitespace-pre rounded border border-line bg-transparent px-1.5 py-1 text-[10px] text-fgMuted">
                        {v.snippet}
                      </pre>
                    )}
                  </li>
                ))}
                {items.length > 60 && (
                  <li className="text-[10px] text-fgFaint">
                    另有 {items.length - 60} 条未展开，明细在报告 JSON（单档上限 200）
                  </li>
                )}
              </ul>
            )}
          </div>
        );
      })}
      {report.skipped.length > 0 && (
        <div className="panel px-3 py-2.5">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            本次没结论的规则（{report.skipped.length} 条 —— 未覆盖 ≠ 通过）
          </p>
          <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto text-[10px] leading-[15px]">
            {report.skipped.map((s) => (
              <li key={s.ruleId} className="mono text-fgMuted">
                <span className="text-fg">{s.ruleId}</span> {s.title} — {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RecsPanel({ items }: { items: QaRecommendation[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div className="panel px-3 py-2.5">
      <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
        面板 C · 逐点优化方案（{items.length} 组，来源全部标注）
      </p>
      {items.length === 0 && (
        <p className="mt-2 text-[10.5px] text-fgFaint">没有可给的方案 —— 静态档是空的（先看面板 A 的覆盖率是否如预期）。</p>
      )}
      <ul className="mt-2 space-y-2">
        {items.map((r) => (
          <li key={r.id} className="rounded border border-line px-2.5 py-2">
            <button
              type="button"
              onClick={() => setOpen((s) => ({ ...s, [r.id]: !s[r.id] }))}
              className="flex w-full items-baseline gap-2 text-left"
            >
              <SeverityBadge severity={r.severity as Severity} size="sm" />
              <span className="flex-1 text-[11px] text-fg">{r.title}</span>
              <span className="mono text-[9.5px] text-fgFaint">{r.source}</span>
              <span className="mono text-[10px] text-fgMuted">{open[r.id] ? '收起' : '展开对照'}</span>
            </button>
            {open[r.id] && (
              <div className="mt-1.5 grid gap-1.5 md:grid-cols-2">
                <div>
                  <p className="mono text-[9.5px] uppercase text-fgFaint">before（现状 {r.file}:{r.line}）</p>
                  <pre className="mono mt-0.5 max-h-40 overflow-auto rounded border px-1.5 py-1 text-[10px]" style={{ borderColor: 'rgba(229,72,77,0.35)' }}>
                    {r.before || '（无片段）'}
                  </pre>
                </div>
                <div>
                  <p className="mono text-[9.5px] uppercase text-fgFaint">after（规则自带正例）</p>
                  <pre className="mono mt-0.5 max-h-40 overflow-auto rounded border px-1.5 py-1 text-[10px]" style={{ borderColor: 'rgba(127,166,80,0.35)' }}>
                    {r.after || r.afterNote || '（无）'}
                  </pre>
                </div>
                <p className="text-[10.5px] leading-[16px] text-fgMuted md:col-span-2">{r.rationale}</p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function TestsPanel({ items }: { items: QaReportData['testSuggestions'] }) {
  return (
    <div className="panel px-3 py-2.5">
      <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
        面板 D · 该补测试的核心路径（离线启发式清单，用例草案属 M4）
      </p>
      {items.length === 0 ? (
        <p className="mt-2 text-[10.5px] text-fgFaint">本次没有给出测试建议。</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((x, i) =>
            isNote(x) ? (
              <li key={`note-${i}`} className="text-[10.5px]" style={{ color: '#E5A33D' }}>
                {x.note}
              </li>
            ) : (
              <li key={x.target} className="text-[10.5px] leading-[16px]">
                <span className="mono text-fg">{x.target}</span>
                {typeof x.findings === 'number' && x.findings > 0 && (
                  <span className="mono ml-1.5 text-fgFaint">命中 {x.findings}</span>
                )}
                <p className="text-fgMuted">{x.reason}</p>
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}
