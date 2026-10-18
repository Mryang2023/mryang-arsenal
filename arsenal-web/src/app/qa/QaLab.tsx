'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  qaJob,
  qaLlmStatus,
  qaReport,
  qaSubmitProject,
  qaSnapshots,
  qaTree,
  type QaJobNode,
  type QaLlmStatus,
  type QaRange,
  type QaRangeMode,
  type QaReport as QaReportData,
  type QaSnapshotSummary,
  type QaTree,
} from '@/lib/arsenal-api';
import { getProject, type ProjectDetail } from '@/lib/projects-api';
import { useActiveProject } from '@/lib/active-project';
import BoundaryCard from './BoundaryCard';
import FindingsView from './FindingsView';
import SourceNote from './SourceNote';
import RecsPanel from './RecsPanel';
import TestsPanel from './TestsPanel';

/**
 * 质检台 `/qa`（工坊棒4 改造）。
 *
 * 一句话：依托**当前项目**（项目管理页选定的）→ 异步 Job 深度审查 → 报告区
 * （边界卡 + 问题两视图 + 可信度 + 怎么改/怎么验），全程可圈定范围。
 *
 * 三条刻意的分工（别在页面里重写任何一条）：
 *   ① **怎么拿结论** —— `qaSubmitProject / qaJob / qaReport`（`lib/arsenal-api.ts`）。
 *      提交秒回 jobId，读缓存/扫描/聚合全在后台线程，前端只做轮询。
 *      深检读的是服务器缓存根（`.data/projects/<id>/repo`），不碰源头 —— 与侦察同一份码。
 *   ② **结论怎么算** —— 后端 `QaService`：静态档复用 /api/autopsy 同一台引擎，
 *      聚合（groupedByRule）也是后端算的，前端一条都不重算（两视图对账只做比对，不做第二套聚合）。
 *   ③ **projectId 怎么来** —— 当前项目总线（`useActiveProject`），与注册表/侦察三方一致。
 *      source 临时地址老路已退场（/archify 与 CLI 不受影响，走后端 source 老路）。
 *
 * 断点续跑（工坊棒4 的核心修复）：QA 跑一半切走菜单，组件卸载 = 前台丢失轮询。
 * job 还在后台跑 —— 挂载时从注册表 `lastJobId` 找回线索：RUNNING/PENDING 恢复轮询、
 * DONE 直接取报告、FAILED 照实报。线索读不到就照实说「续跑线索失效」，不说健康。
 *
 * 组件分工（质检台 Q2 拆分，2026-10-18；工坊棒4 只动本文件的状态机与输入区）：
 *   BoundaryCard（边界卡+规则库账+黄条） / FindingsView（按严重度·按规则两视图+对账） /
 *   FindingRow（六段详情） / RuleGroupCard（聚合卡） / SourceNote（可信度） /
 *   RecsPanel（怎么改） / TestsPanel（怎么验）。本文件只管状态机与编排，不管一块具体内容。
 */

type Stage =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'running'; job: QaJobNode }
  | { kind: 'failed'; code: string; message: string; offline: boolean }
  | { kind: 'done'; report: QaReportData; job: QaJobNode };

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

type QaTab = 'findings' | 'trust' | 'recs' | 'tests';

export default function QaLab() {
  const active = useActiveProject();
  const [rangeMode, setRangeMode] = useState<QaRangeMode>('full');
  const [includeRaw, setIncludeRaw] = useState('');
  const [excludeRaw, setExcludeRaw] = useState('');
  const [deepCheck, setDeepCheck] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [tab, setTab] = useState<QaTab>('findings');

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

  // 当前项目的注册表详情（缓存统计 / 脱敏地址 / lastJobId 续跑线索）。
  // detailNote = 项目读不到时的照实话术（离线 / 项目被删），与 detail=null 同步。
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [detailNote, setDetailNote] = useState<string | null>(null);
  // 续跑线索失效（job 状态读不到）时的照实话术 —— 不是错误也不是健康，单独说。
  const [resumeNote, setResumeNote] = useState<string | null>(null);
  const [tree, setTree] = useState<QaTree | null>(null);
  const [treeNote, setTreeNote] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<QaSnapshotSummary[]>([]);

  // 轮询归 cancel 令牌管：换项目 / 重新提交，旧的循环必须立刻停下，
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

  // 轮询循环（提交与续跑共用）：1.5s 一跳。网络单次失败不掐循环（后端在，请求迟早回来）；
  // 业务拒绝（jobId 不认识等）立即停 —— 那多等一万次也好不了。
  const poll = useCallback(
    async (jobId: string, pid: string) => {
      const token = tokenRef.current;
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500));
        if (tokenRef.current !== token) return;
        const out = await qaJob(jobId);
        if (tokenRef.current !== token) return;
        if (out.kind === 'offline') {
          setStage({ kind: 'failed', code: 'OFFLINE', message: out.message, offline: true });
          return;
        }
        if (out.kind === 'rejected') {
          setStage({ kind: 'failed', code: out.code, message: out.message, offline: false });
          return;
        }
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
            void loadTree(pid);
            void loadSnapshots(pid);
          } else if (rep.kind === 'rejected') {
            setStage({ kind: 'failed', code: rep.code, message: rep.message, offline: false });
          } else {
            setStage({ kind: 'failed', code: 'OFFLINE', message: rep.message, offline: true });
          }
          return;
        }
        setStage({ kind: 'running', job });
      }
    },
    [loadSnapshots, loadTree]
  );

  // 挂载 / 切项目：拉注册表详情 + 断点续跑。job 还在后台跑的话，界面回来能看到进度。
  useEffect(() => {
    if (!active) {
      setDetail(null);
      setDetailNote(null);
      setResumeNote(null);
      setStage({ kind: 'idle' });
      setSnapshots([]);
      return;
    }
    const token = ++tokenRef.current; // 立刻掐掉旧项目的轮询循环
    let alive = true;
    setDetail(null);
    setDetailNote(null);
    setResumeNote(null);
    setTree(null);
    setTreeNote(null);
    setSnapshots([]);
    setStage({ kind: 'idle' });
    void (async () => {
      const out = await getProject(active.id);
      if (!alive || tokenRef.current !== token) return;
      if (out.kind === 'offline') {
        // 项目卡照本地记录显示（active 有名字），内容区报离线（棒3 口径：不是错误，是静态站正常形态）
        setDetailNote(out.message);
        return;
      }
      if (out.kind === 'rejected') {
        setDetail(null);
        setDetailNote(
          out.code === 'NOT_FOUND'
            ? '当前项目已不在注册表里（可能在别处被删除）—— 去项目管理页重新选一个。'
            : out.message
        );
        return;
      }
      setDetail(out.data);
      setDetailNote(null);

      // ── 断点续跑：lastJobId 是「切走再回来」的唯一线索 ──
      const lastJobId = out.data.lastJobId;
      if (!lastJobId) return;
      const j = await qaJob(lastJobId);
      if (!alive || tokenRef.current !== token) return;
      if (j.kind === 'ok') {
        const job = j.data;
        if (job.status === 'PENDING' || job.status === 'RUNNING') {
          setStage({ kind: 'running', job });
          void poll(lastJobId, out.data.id);
          return;
        }
        if (job.status === 'DONE') {
          const rep = await qaReport(lastJobId);
          if (!alive || tokenRef.current !== token) return;
          if (rep.kind === 'ok') {
            setStage({ kind: 'done', report: rep.data, job });
            void loadTree(out.data.id);
            void loadSnapshots(out.data.id);
          } else if (rep.kind === 'rejected') {
            setStage({ kind: 'failed', code: rep.code, message: rep.message, offline: false });
          } else {
            setStage({ kind: 'failed', code: 'OFFLINE', message: rep.message, offline: true });
          }
          return;
        }
        // FAILED：照实报，不许说「健康」也不许静默吞掉
        setStage({
          kind: 'failed',
          code: 'JOB_FAILED',
          message: job.error || '上次审查在后台失败（详见 phase 状态）—— 可以重新开始',
          offline: false,
        });
        return;
      }
      // job 状态读不到：线索失效。照实说，不说健康，也不假装没这回事。
      setResumeNote(`续跑线索失效 —— 上次审查（job ${lastJobId}）的状态读不回（${j.message}）。可以重新开始审查。`);
    })();
    return () => {
      alive = false;
    };
    // active 的对象引用是稳定的（active-project.ts 按原始串缓存），依赖 id 即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  const run = useCallback(async () => {
    if (!active || !detail) return;
    const token = ++tokenRef.current;
    setStage({ kind: 'submitting' });
    setTree(null);
    setTreeNote(null);
    setResumeNote(null);

    const submitted = await qaSubmitProject(active.id, range, deepCheck);
    if (tokenRef.current !== token) return;
    if (submitted.kind === 'offline') {
      setStage({ kind: 'failed', code: 'OFFLINE', message: submitted.message, offline: true });
      return;
    }
    if (submitted.kind === 'rejected') {
      setStage({ kind: 'failed', code: submitted.code, message: submitted.message, offline: false });
      return;
    }
    void loadSnapshots(submitted.data.projectId);
    void poll(submitted.data.jobId, submitted.data.projectId);
  }, [active, detail, range, deepCheck, loadSnapshots, poll]);

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
        <h1 className="text-[14px] font-bold text-fg">质检台</h1>
        <p className="mt-1 text-[11px] leading-[17px] text-fgMuted">
          依托当前项目跑一轮异步深度审查：先跑规则找硬伤，再逐点给出带 before/after 的优化方案与该补的测试。
          可以整仓检，也可以只圈一部分代码检。提交秒回、后台执行，页面不卡死 —— 跑一半切走再回来，进度还在。
        </p>
      </header>

      {!active && (
        <div className="panel px-3 py-3">
          <p className="text-[11.5px] font-semibold text-brass">这两个功能依托于固定项目</p>
          <p className="mt-1 text-[10.5px] leading-[16px] text-fgMuted">
            先到「项目管理」添加并选择一个项目，再回来审查。临时地址输入已退场 —— 项目代码先进服务器缓存，
            审查读缓存，切菜单不丢现场。
          </p>
          <Link
            href="/projects"
            className="mt-2 inline-block rounded border px-3 py-1 text-[11px] font-semibold transition-colors"
            style={{ borderColor: 'rgba(217,164,65,0.5)', background: 'rgba(217,164,65,0.12)', color: '#D9A441' }}
          >
            去项目管理选一个 →
          </Link>
        </div>
      )}

      {active && (
        <div className="panel px-3 py-3">
          <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">一、当前项目、圈范围</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold text-fg">◈ {active.name ?? detail?.name ?? active.id}</span>
            {detail && (
              <span className="mono text-[10.5px] text-fgMuted">
                {detail.source.kind === 'git' ? 'https git' : '本地目录'} · {detail.source.value}
              </span>
            )}
            {detail?.cache && (
              <span className="mono text-[10px] text-fgFaint">
                缓存 {detail.cache.files} 文件 · {(detail.cache.bytes / 1024 / 1024).toFixed(1)} MB · 摄取于{' '}
                {detail.cache.ingestedAt}
              </span>
            )}
            <Link href="/projects" className="ml-auto text-[10.5px] text-brass underline-offset-2 hover:underline">
              切换项目
            </Link>
          </div>
          <p className="mt-1 text-[10px] leading-[15px] text-fgFaint">
            审查读服务器缓存（.data/projects/&lt;id&gt;/repo），不改源头也不重新 clone；
            源头变了先去项目管理页「刷新缓存」，否则审的还是上次摄取的那份码。
          </p>

          {detailNote && (
            <div
              className="mt-2 rounded border px-2.5 py-2"
              style={{ borderColor: 'rgba(229,163,61,0.4)', background: 'rgba(229,163,61,0.08)' }}
            >
              <p className="text-[10.5px] leading-[16px]" style={{ color: '#E5A33D' }}>
                {detailNote}
              </p>
            </div>
          )}
          {resumeNote && (
            <div className="mt-2 rounded border border-line px-2.5 py-2">
              <p className="text-[10.5px] leading-[16px] text-fgMuted">{resumeNote}</p>
            </div>
          )}

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
              disabled={busy || !detail || (rangeMode !== 'full' && range.include.length === 0)}
              className="ml-auto rounded border px-3 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45"
              style={{ borderColor: 'rgba(217,164,65,0.5)', background: 'rgba(217,164,65,0.12)', color: '#D9A441' }}
            >
              {busy ? '审查中…' : '开始审查'}
            </button>
          </div>
          {!detail && !detailNote && (
            <p className="mt-1.5 text-[10px] text-fgFaint">正在读取项目详情…</p>
          )}

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

          {rangeMode !== 'full' && detail && (
            <div className="mt-2">
              {tree ? (
                <div className="max-h-44 overflow-y-auto rounded border border-line px-2 py-1.5">
                  <p className="mono text-[10px] text-fgFaint">
                    目录树来自上次深检（job {tree.fromJobId}，{tree.from}）—— 点节点加进 include，不重新摄取
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
      )}

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
            {stage.job.status} · 当前 {stage.job.phase || '—'} · 切走也不怕，回来进度自动接上（1.5s 一 poll）
          </p>
        </div>
      )}

      {stage.kind === 'done' && <ReportView report={stage.report} onTab={tab} setTab={setTab} snapshots={snapshots} />}

      {stage.kind === 'idle' && active && (
        <div className="panel px-3 py-2.5 text-[10.5px] leading-[16px] text-fgMuted">
          {detailNote
            ? '当前项目读不到详情，暂时不能开始审查 —— 见上方说明。'
            : '还没跑过审查（或这个项目还没有审查留档）。报告区四块：边界卡（这次查了什么 / 没查什么，含规则库账）、问题两视图（按严重度 = 先改谁；按规则 = 怎么改省事，每条可展开六段详情）、可信度（语义三态 / 实锤四档 / 委员会共识）、怎么改与怎么验（before/after 方案 + 该补的测试）。每次审查自动留档在服务器侧 .data/qa/<projectId>/，不进 git。'}
        </div>
      )}
      {stage.kind === 'idle' && !active && (
        <div className="panel px-3 py-2.5 text-[10.5px] leading-[16px] text-fgMuted">
          选好项目后，这里会出现报告区四块：边界卡 / 问题两视图 / 可信度 / 怎么改与怎么验。
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

/** 报告区：边界卡常驻（这次查了什么/没查什么），下面才是四页签 */
function ReportView({
  report,
  onTab,
  setTab,
  snapshots,
}: {
  report: QaReportData;
  onTab: QaTab;
  setTab: (t: QaTab) => void;
  snapshots: QaSnapshotSummary[];
}) {
  const f = report.staticFindings;
  const findingsTotal =
    (f.p0?.length ?? 0) + (f.p1?.length ?? 0) + (f.other?.length ?? 0) + report.semanticFindings.length;

  return (
    <>
      <BoundaryCard report={report} />

      {/* ── 四页签：问题 / 可信度 / 怎么改 / 怎么验（问题区含两视图，见 FindingsView） ── */}
      <div className="flex items-center gap-1 self-start rounded border border-line p-0.5">
        {(
          [
            ['findings', `问题（${findingsTotal}）`],
            ['trust', '可信度'],
            ['recs', `怎么改（${report.recommendations.filter((x) => 'id' in x).length}）`],
            ['tests', `怎么验（${report.testSuggestions.filter((x) => 'target' in x).length}）`],
          ] as [QaTab, string][]
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

      {onTab === 'findings' && <FindingsView report={report} />}
      {onTab === 'trust' && <SourceNote report={report} />}
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
