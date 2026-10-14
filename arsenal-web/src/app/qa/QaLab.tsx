'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  qaJob,
  qaLlmStatus,
  qaReport,
  qaSnapshots,
  qaSubmit,
  qaTree,
  type QaJobNode,
  type QaLlmStatus,
  type QaLlmUsage,
  type QaRange,
  type QaRangeMode,
  type QaReport as QaReportData,
  type QaSemanticFinding,
  type QaSemanticVerdict,
  type QaSnapshotSummary,
  type QaTestSuggestion,
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
 * M2 边界（页面上必须如实写的两件事）：
 *   · 语义深检（面板 B）按 LLM 配置三态披露 —— 未配 key 时「未执行」、跑了但预算撞顶/有批失败时
 *     「部分完成」、全跑完才「已执行」；「没跑」「跑不完」「跑完没报」是三回事，绝不含混；
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

/**
 * 面板 C 的条目也是「真方案 + 溢出说明行」的混合：静态档命中组数超上限（120）时，
 * 后端只追加一条 `{ note: "另有 N 组…" }`，它没有 id/severity。必须先用这个判别式
 * 分流，否则整块丢给 SeverityBadge → SEVERITY_THEME[undefined].color → 白屏。
 */
type RecItem = QaReportData['recommendations'][number];

function isRecNote(x: RecItem): x is { note: string } {
  return !('id' in x) && typeof (x as { note?: unknown }).note === 'string';
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

  // LLM 配置状态：进页面探一次。configured=false 时「深度检测」勾选框锁死并说明原因，
  // 而不是让用户勾了才发现没配 key（后端会优雅降级，但前端该提前告知）。
  const [llm, setLlm] = useState<QaLlmStatus | null>(null);
  useEffect(() => {
    let alive = true;
    void qaLlmStatus().then((out) => {
      if (alive && out.kind === 'ok') setLlm(out.data);
    });
    return () => {
      alive = false;
    };
  }, []);

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
          <label
            className={
              'flex items-center gap-1.5 text-[10.5px] ' +
              (llm?.configured ? 'cursor-pointer text-fgMuted' : 'text-fgFaint')
            }
          >
            <input
              type="checkbox"
              checked={deepCheck && !!llm?.configured}
              disabled={!llm?.configured}
              onChange={(e) => setDeepCheck(e.target.checked)}
              className="accent-brass disabled:cursor-not-allowed"
            />
            <span>
              {llm?.configured
                ? `语义深检（LLM · ${llm.model}）—— 静态之后再花几分钟过一遍需理解语义的规则`
                : '语义深检（LLM）—— 未配置，勾选不可用（设 ARSENAL_LLM_KEY 后开启）'}
            </span>
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
          还没跑过审查。报告出四个面板：A 硬伤清单（与 /autopsy 同一台引擎、同一口径）、B 语义深检（配了 LLM key 才跑，未配 / 预算截断都如实标出三态）、
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
            ['semantic', `B 语义深检（${report.semanticFindings.length}）`],
            ['recs', `C 优化方案（${report.recommendations.filter((x) => !isRecNote(x)).length}）`],
            ['tests', `D 测试建议（${report.testSuggestions.filter((x) => !isNote(x)).length}）`],
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
      {onTab === 'semantic' && <SemanticPanel report={report} />}
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

function SemanticPanel({ report }: { report: QaReportData }) {
  const status = report.semanticStatus;
  const ran = status === 'ok' || status === 'partial';
  const banner =
    status === 'ok'
      ? { c: '#7FA650', label: '语义深检已执行' }
      : status === 'partial'
        ? { c: '#E5A33D', label: '语义深检部分完成（有规则未判定）' }
        : status === 'failed'
          ? { c: '#E5484D', label: '语义深检执行失败' }
          : { c: '#E5A33D', label: '语义深检未执行' };

  const usage = report.llmUsage as QaLlmUsage | null;
  const findings = report.semanticFindings;
  const verdicts = report.semanticVerdicts;
  const notes = report.semanticNotes ?? [];
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // ── C1：实锤两档 ──
  // 后端把实锤结果已经分流好了（provenSemanticFindings / unconfirmedSemanticFindings）；
  // 旧报告里没有这两个键 → 一律当「没有实锤数据」，并说清是「这份报告出在实锤功能之前」。
  const tiers = report.reproTiers;
  const proven = report.provenSemanticFindings ?? [];
  const unconfirmed = report.unconfirmedSemanticFindings ?? [];
  const hasReproData = !!report.reproStatus;
  const provenSet = new Set(proven.map((f) => `${f.ruleId}|${f.file}|${f.line}`));

  return (
    <div className="space-y-3">
      <div className="panel px-3 py-2.5">
        <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">面板 B · 语义深检</p>
        <div
          className="mt-2 rounded border px-2.5 py-2"
          style={{ borderColor: banner.c + '66', background: banner.c + '14' }}
        >
          <p className="text-[11px] font-semibold" style={{ color: banner.c }}>
            {banner.label}（{status}）
          </p>
          <p className="mt-1 text-[10.5px] leading-[16px] text-fgMuted">{report.semanticReason}</p>
        </div>

        {/* ── C1 实锤条 ── */}
        {hasReproData ? (
          <div className="mt-2 rounded border border-line px-2.5 py-2">
            <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
              C1 · 复现实锤（{report.reproStatus}）
            </p>
            <p className="mt-1 text-[10.5px] leading-[16px] text-fgMuted">{report.reproReason}</p>
            {tiers && (
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] leading-[15px]">
                <span style={{ color: tiers.proven > 0 ? '#D9A441' : '#888780' }}>
                  有复现（实锤）{tiers.proven}
                </span>
                <span style={{ color: tiers.notReproduced > 0 ? '#E5484D' : '#888780' }}>
                  复现失败（这条 finding 站不住）{tiers.notReproduced}
                </span>
                <span style={{ color: tiers.invalidTest > 0 ? '#E5A33D' : '#888780' }}>
                  测试无效 {tiers.invalidTest}
                </span>
                <span style={{ color: tiers.notRun > 0 ? '#E5A33D' : '#888780' }}>
                  没跑起来 {tiers.notRun}
                </span>
              </div>
            )}
            <p className="mt-1 text-[10px] leading-[15px] text-fgFaint">
              四档分开是因为下一步不同：「复现失败」该去改规则或撤案，「没跑起来」该去修环境 ——
              合成一句「未实锤」会让人分不清该动哪一个。
            </p>
            {tiers?.stability && (
              <p className="mt-1 text-[10px] leading-[15px] text-fgFaint">
                稳定性（只是标注，<b>不参与分流</b>）：稳定 {tiers.stability.stable} ·
                偶发 {tiers.stability.flaky} · 样本不足 {tiers.stability.insufficientSamples}
                （少于 {tiers.stability.minSamples} 次不给稳定性结论）。
                <b>偶发复现仍然是实锤</b> —— 并发 / 时序类缺陷天生低复现率，
                若因为「不稳定」降级，它们就永远进不了实锤档，也就永远没人修。
              </p>
            )}
            {(report.reproNotes ?? []).length > 0 && (
              <ul className="mt-1 space-y-0.5 text-[10px] leading-[15px] text-fgFaint">
                {report.reproNotes!.map((n, i) => (
                  <li key={`rn-${i}`}>· {n}</li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="mt-2 text-[10px] leading-[15px] text-fgFaint">
            这份报告里没有复现实锤数据 —— 它出在 C1 上线之前。<b>没有实锤不等于没有 bug</b>，
            下面每条都还是「模型说的」，不是「跑出来的」。
          </p>
        )}

        {usage && (
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] leading-[15px] text-fgFaint">
            <span className="mono">model {usage.model}</span>
            <span>候选 {usage.candidateFiles} 文件</span>
            <span>批次 {usage.batches}/{usage.maxBatches}</span>
            <span>送出 ~{usage.charsSent} 字</span>
            <span>tokens 入 {usage.promptTokens} / 出 {usage.completionTokens}</span>
            {usage.droppedFindings > 0 && (
              <span style={{ color: '#E5A33D' }}>丢弃 {usage.droppedFindings} 条无行号/对不上的判定</span>
            )}
            {usage.budgetCut && <span style={{ color: '#E5484D' }}>预算熔断：余下规则未判定</span>}
          </div>
        )}

        {notes.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-[10px] leading-[15px] text-fgFaint">
            {notes.map((n, i) => (
              <li key={`note-${i}`}>· {n}</li>
            ))}
          </ul>
        )}
      </div>

      {ran && verdicts.length > 0 && (
        <div className="panel px-3 py-2.5">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            逐规则判定（{verdicts.length} 条）
          </p>
          <ul className="mt-1.5 space-y-1">
            {verdicts.map((v, i) => (
              <VerdictRow key={`${v.ruleId}-${i}`} v={v} />
            ))}
          </ul>
        </div>
      )}

      <CommitteePanel report={report} />

      {findings.length > 0 ? (
        <div className="panel px-3 py-2.5">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
            语义层发现（{findings.length} 条 ·{' '}
            {hasReproData
              ? `其中 ${proven.length} 条已实锤、${unconfirmed.length} 条待确认`
              : '判定来源 = LLM，全部未实锤'}
            ）
          </p>
          <ul className="mt-2 space-y-2">
            {findings.map((x, i) => (
              <SemanticFindingRow
                key={`${x.ruleId}-${x.file}-${x.line}-${i}`}
                f={x}
                proven={provenSet.has(`${x.ruleId}|${x.file}|${x.line}`)}
                open={!!open[`${i}`]}
                toggle={() => setOpen((s) => ({ ...s, [`${i}`]: !s[`${i}`] }))}
              />
            ))}
          </ul>
        </div>
      ) : (
        ran && (
          <div className="panel px-3 py-2.5 text-[10.5px] text-fgFaint">
            语义层跑过了，没有给出带行号的发现 —— 「跑过且没报」不等于「合规」，见上方判定明细与覆盖率。
          </div>
        )
      )}
    </div>
  );
}

function CommitteePanel({ report }: { report: QaReportData }) {
  const items = report.committeeFindings ?? [];
  const sum = report.committeeSummary;
  const usage = report.committeeUsage ?? null;
  const names: Record<string, string> = {
    security: '安全',
    performance: '性能',
    concurrency: '并发',
  };
  return (
    <div className="panel px-3 py-2.5">
      <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
        C4 · 审查员委员会（共识 {sum?.consensus ?? 0} · 孤证 {sum?.solo ?? 0}）
      </p>

      {sum?.note && <p className="mt-1 text-[10px] leading-[15px] text-fgFaint">{sum.note}</p>}

      {usage && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] leading-[15px] text-fgFaint">
          <span className="mono">model {usage.model}</span>
          <span>批数 {usage.batches}/{usage.members} 位审查员</span>
          <span>
            tokens 入 {usage.promptTokens} / 出 {usage.completionTokens}
          </span>
          {usage.costNote && (
            <span style={{ color: '#E5A33D' }}>{usage.costNote}</span>
          )}
        </div>
      )}

      {usage &&
        Object.entries(usage.perJudgeer ?? {}).map(([who, v]) => (
          <p key={who} className="text-[10px] leading-[15px] text-fgFaint">
            {names[who] ?? who}审查员：
            {v.ran ? (
              <span style={{ color: '#7FA650' }}>跑过了，报 {v.issues} 条</span>
            ) : (
              <span style={{ color: '#E5A33D' }}>{v.reason ?? '这一路没跑起来'}</span>
            )}
          </p>
        ))}

      {items.length === 0 ? (
        <p className="mt-2 text-[10.5px] leading-[16px] text-fgFaint">
          本次没有委员会结论。
          {usage
            ? '三位审查员跑完了，一个问题都没报 —— 这不等于「代码没问题」，它们只看得到送进来的那几个文件与这一批视角。'
            : '委员会没跑（LLM 未配置 / 语义深检未开启）。'}
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {items.map((f, i) => {
            const consensus = f.signal === 'consensus';
            return (
              <li key={`${f.file}-${f.line}-${i}`} className="rounded border border-line px-2 py-1.5">
                <div className="flex items-baseline gap-2">
                  <span
                    className="mono text-[9.5px]"
                    style={{ color: consensus ? '#D9A441' : '#E5A33D' }}
                  >
                    [{consensus ? `共识 ×${f.voters}` : '孤证'}]
                  </span>
                  <span className="flex-1 text-[11px] text-fg">{f.title}</span>
                  <span className="mono text-[9.5px] text-fgFaint">
                    {f.reportedBy.map((r) => names[r] ?? r).join('、')}
                  </span>
                </div>
                <p className="mono mt-0.5 text-[10px] text-fgFaint">
                  {f.file}:{f.line} — {f.evidence}
                </p>
                {f.impact && (
                  <p className="mt-0.5 text-[10.5px] leading-[16px] text-fgMuted">{f.impact}</p>
                )}
                <p className="mt-0.5 text-[10px] leading-[15px] text-fgFaint">{f.signalText}</p>
              </li>
            );
          })}
        </ul>
      )}

      {(report.committeeNotes ?? []).length > 0 && (
        <ul className="mt-1.5 space-y-0.5 text-[10px] leading-[15px] text-fgFaint">
          {report.committeeNotes!.map((n, i) => (
            <li key={`cn-${i}`}>· {n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VerdictRow({ v }: { v: QaSemanticVerdict }) {
  const tone: Record<string, string> = {
    违规: '#E5484D',
    合规: '#7FA650',
    不适用: '#93A39C',
    '未跑-预算': '#E5A33D',
    '失败-格式': '#E5A33D',
  };
  const c = tone[v.verdict] ?? '#93A39C';
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 text-[10.5px] leading-[16px]">
      <span className="mono text-fg">{v.ruleId}</span>
      <span className="text-fgMuted">{v.title}</span>
      <span className="mono" style={{ color: c }}>
        {v.verdict}
      </span>
      <span className="mono text-fgFaint">
        {v.filesJudged} 文件 · {v.violations} 违规
      </span>
      {v.note && <span className="text-fgFaint">— {v.note}</span>}
    </li>
  );
}

function SemanticFindingRow({
  f,
  proven,
  open,
  toggle,
}: {
  f: QaSemanticFinding;
  proven: boolean;
  open: boolean;
  toggle: () => void;
}) {
  const conf = f.confidence;
  const confColor = conf >= 0.8 ? '#E5484D' : conf >= 0.6 ? '#E5A33D' : '#93A39C';
  const r = f.repro;
  return (
    <li className="rounded border border-line px-2.5 py-2">
      <button type="button" onClick={toggle} className="flex w-full items-baseline gap-2 text-left">
        <SeverityBadge severity={f.severity as Severity} size="sm" />
        <span className="flex-1 text-[11px] text-fg">{f.ruleTitle}</span>
        {proven ? (
          <span className="mono text-[9.5px]" style={{ color: '#D9A441' }}>
            实锤{r?.redCount != null && r.attempts ? ` ${r.redCount}/${r.attempts}` : ''}
          </span>
        ) : (
          <span className="mono text-[9.5px] text-fgFaint">待确认</span>
        )}
        <span className="mono text-[9.5px]" style={{ color: confColor }}>
          置信 {Math.round(conf * 100)}%
        </span>
        <span className="mono text-[9.5px] text-fgFaint">LLM</span>
        <span className="mono text-[10px] text-fgMuted">{open ? '收起' : '展开对照'}</span>
      </button>
      <p className="mono mt-0.5 text-[10px] text-fgFaint">
        {f.file}:{f.line} — {f.evidence}
      </p>
      {f.impact && <p className="mt-0.5 text-[10.5px] leading-[16px]" style={{ color: '#E5484D' }}>{f.impact}</p>}

      {/* ── C1 实锤证据：不折叠，因为它就是这条 finding 的可信度本身 ── */}
      {r && (
        <div className="mt-1.5 rounded border border-line px-2 py-1.5">
          <p className="text-[10.5px] leading-[15px] text-fgMuted">
            <span style={{ color: r.verdict === 'reproduced' ? '#D9A441' : '#888780' }}>
              [{r.tierText}]
            </span>
            {r.rate != null && r.attempts ? `　复现率 ${r.rate.toFixed(2)}（${r.redCount ?? 0}/${r.attempts}）` : ''}
          </p>
          <p className="mt-0.5 text-[10px] leading-[15px] text-fgFaint">{r.reason}</p>
          {r.stability && r.verdict === 'reproduced' && (
            <p className="mt-0.5 text-[10px] leading-[15px] text-fgFaint">
              稳定性：
              <span
                style={{
                  color:
                    r.stability === 'stable'
                      ? '#D9A441'
                      : r.stability === 'flaky'
                        ? '#E5A33D'
                        : '#888780',
                }}
              >
                {r.stabilityText}
              </span>
              {r.stability === 'flaky' && (
                <span className="text-fgFaint">（仍算实锤，只是你没法靠它天天拦）</span>
              )}
            </p>
          )}
          {r.failureExcerpt && (
            <pre className="mono mt-1 max-h-32 overflow-auto rounded border border-line px-1.5 py-1 text-[9.5px] leading-[14px] text-fgMuted">
              {r.failureExcerpt}
            </pre>
          )}
          {r.compileError && (
            <p className="mono mt-1 text-[9.5px] leading-[14px]" style={{ color: '#E5A33D' }}>
              编译未过：{r.compileError}
            </p>
          )}
          {r.verdict === 'reproduced' && r.testSource && open && (
            <>
              <p className="mono mt-1 text-[9.5px] uppercase text-fgFaint">
                实锤用的复现测试（{r.testClass}）
              </p>
              <pre className="mono mt-0.5 max-h-48 overflow-auto rounded border border-line px-1.5 py-1 text-[9.5px] leading-[14px] text-fgMuted">
                {r.testSource}
              </pre>
            </>
          )}
        </div>
      )}

      {open && (
        <div className="mt-1.5 grid gap-1.5 md:grid-cols-2">
          <div>
            <p className="mono text-[9.5px] uppercase text-fgFaint">before（现状）</p>
            <pre className="mono mt-0.5 max-h-40 overflow-auto rounded border px-1.5 py-1 text-[10px]" style={{ borderColor: 'rgba(229,72,77,0.35)' }}>
              {f.recommendation?.before || '（无）'}
            </pre>
          </div>
          <div>
            <p className="mono text-[9.5px] uppercase text-fgFaint">after（建议改法）</p>
            <pre className="mono mt-0.5 max-h-40 overflow-auto rounded border px-1.5 py-1 text-[10px]" style={{ borderColor: 'rgba(127,166,80,0.35)' }}>
              {f.recommendation?.after || '（无）'}
            </pre>
          </div>
          {f.recommendation?.rationale && (
            <p className="text-[10.5px] leading-[16px] text-fgMuted md:col-span-2">{f.recommendation.rationale}</p>
          )}
        </div>
      )}
    </li>
  );
}

function RecsPanel({ items }: { items: QaReportData['recommendations'] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const groups = items.reduce((n, x) => n + (isRecNote(x) ? 0 : 1), 0);
  return (
    <div className="panel px-3 py-2.5">
      <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
        面板 C · 逐点优化方案（{groups} 组，来源全部标注）
      </p>
      {groups === 0 && (
        <p className="mt-2 text-[10.5px] text-fgFaint">没有可给的方案 —— 静态档是空的（先看面板 A 的覆盖率是否如预期）。</p>
      )}
      <ul className="mt-2 space-y-2">
        {items.map((r, i) =>
          isRecNote(r) ? (
            <li key={`note-${i}`} className="text-[10.5px]" style={{ color: '#E5A33D' }}>
              {r.note}
            </li>
          ) : (
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
          )
        )}
      </ul>
    </div>
  );
}

function TestsPanel({ items }: { items: QaReportData['testSuggestions'] }) {
  return (
    <div className="panel px-3 py-2.5">
      <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
        面板 D · 该补测试的核心路径（清单来自离线启发式；C1 起附可运行的复现用例）
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
                {/* C1：draftCases 以前恒为 null（后端 putNull 占位），页面什么都不显示，
                    读起来像「用例已经有了只是没展示」。现在三档各有一句人话。 */}
                <DraftCases cases={x.draftCases} />
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}

function DraftCases({ cases }: { cases?: QaTestSuggestion['draftCases'] }) {
  if (!cases) {
    return (
      <p className="mt-0.5 text-[10px] text-fgFaint">
        复现用例：这份报告没有这一段（出在 C1 之前）。
      </p>
    );
  }
  const color =
    cases.status === 'proven' ? '#D9A441' : cases.status === 'not-run' ? '#888780' : '#E5A33D';
  return (
    <div className="mt-1 rounded border border-line px-2 py-1.5">
      <p className="text-[10px] leading-[15px]" style={{ color }}>
        [{cases.status}] {cases.reason}
      </p>
      {cases.cases.map((c, i) => (
        <div key={`${c.testClass}-${i}`} className="mt-1">
          <p className="mono text-[9.5px] text-fgFaint">
            {c.testClass}
            {c.rate != null ? `　复现率 ${c.rate.toFixed(2)}` : ''}
          </p>
          <pre className="mono mt-0.5 max-h-40 overflow-auto rounded border border-line px-1.5 py-1 text-[9.5px] leading-[14px] text-fgMuted">
            {c.source}
          </pre>
        </div>
      ))}
    </div>
  );
}
