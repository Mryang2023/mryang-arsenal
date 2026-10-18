'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CANVAS_THEME_OPTIONS, type CanvasTheme } from '@/lib/arch-canvas';
import {
  buildAutopsy,
  traceSource,
  type AutopsyArtifacts,
  type AutopsySourceTrace,
} from '@/lib/autopsy-data';
import type { ProjectFacts } from '@/lib/facts-arch';
import { replicaFact } from '@/lib/facts-arch';
import { emptyMeta, withParam } from '@/lib/topology';
import { archifyIrFilename } from '@/lib/archify-ir';
import {
  autopsyInspect,
  autopsyRun,
  scanFacts,
  scanUpload,
  type AutopsyReport,
  type AutopsyRunOutcome,
  type RuntimeKind,
  type ScanOutcome,
} from '@/lib/arsenal-api';
import { scanTechName } from '@/lib/scan-rules';
import {
  buildSnapshot,
  deleteLocalSnapshot,
  diffSnapshots,
  fingerprintTrust,
  loadLocalSnapshots,
  projectIdOfSource,
  saveLocalSnapshot,
  type AutopsySnapshot,
  type SnapshotDiff,
} from '@/lib/autopsy-snapshot';
import { downloadText } from '@/lib/zip';
import { DEFAULT_PROFILE_ID } from '@/lib/arch-views';
import type { ArchProfile } from '@/lib/arch-profile';
import { buildProfileDraftFromFacts, type ProfileDraft } from '@/lib/profile-draft';
import { loadCustomProfiles, saveCustomProfiles } from './profile-store';
import TechArch from '../stack/TechArch';
import ArchPanel from './ArchPanel';
import ProfileBar from './ProfileBar';
import SixViewsPanel, { DRAFT_PROFILE_ID } from './SixViewsPanel';
import CheckupPanel from './CheckupPanel';
import HistoryPanel, { type DamagedEntry } from './HistoryPanel';
import FunctionPanel from './FunctionPanel';
import RuntimePanel, { type RuntimeStage } from './RuntimePanel';
import ServicePanel from './ServicePanel';
import StructurePanel from './StructurePanel';
import UnmatchedPanel from './UnmatchedPanel';
import VitalsPanel from './VitalsPanel';
import type { RuntimeProbeFact } from '@/lib/runtime-recon';
import {
  appendLocalPoint,
  clearLocalVitals,
  loadLocalVitals,
  pointFromReport,
  type VitalsPointShape,
} from '@/lib/vitals-store';

/**
 * 项目侦察。
 *
 * 一句话：给一个地址 → 出「技术栈部署图 + 应用分层图 + 未识别依赖清单 + 服务拓扑」。
 *
 * 三条刻意的分工（别在页面里重写任何一条）：
 *   ① **怎么拿 facts** —— `scanFacts` / `scanUpload`（`lib/arsenal-api.ts`），
 *      与 `/archify`「从代码生成」用的是同一对函数，本页不自己拼请求。
 *   ② **facts → 结论** —— `buildAutopsy()`（`lib/autopsy-data.ts`），
 *      与 CodeIntake 共用一份；本页只负责画。
 *   ③ **图怎么画** —— `arch-canvas.ts` / `arch-layered.ts`，成品渲染器，不动。
 *
 * 安全：本地目录这条路是「用户给一个路径让服务器去读」，本仓此前没有这个形态。
 * 后端 `SourceResolver.fromPath` 会 `toRealPath()`（相对路径 / `..` / 符号链接都会
 * 被解析到别处），而事实 JSON 里只带目录名 —— 所以本页把「填进去的」与
 * 「实际扫的」并排显示，末段不一致就亮出来，不许静默。
 */

type Mode = 'path' | 'git' | 'zip';

type Stage =
  | { kind: 'idle' }
  | { kind: 'scanning'; what: string }
  | { kind: 'done'; facts: ProjectFacts; requested: string }
  | { kind: 'failed'; code: string; message: string; offline: boolean };

/**
 * 体检是**独立的一次请求**（/api/autopsy/inspect），与架构面板的 facts 不是同一条路。
 *
 * 为什么不合进一次扫描：两者要的东西不同（架构事实 vs 三档结论），后端也分两个接口；
 * 前端若把两者合成一次「大请求」，任何一半失败都会让另一半也拿不到。
 * 但**输入是同一个**（同一个 mode / source）—— 用户填一次地址，两个面板都能跑。
 */
type CheckupStage =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; report: AutopsyReport }
  | { kind: 'failed'; code: string; message: string; offline: boolean };

/**
 * 留档有两条**不同**的路，页面上必须分清楚 —— 混在一起就是撒谎：
 *
 *   ① **`reusedFrom`（扫之前就复用）** —— 用户勾选「输入没变」，于是这一趟
 *      **根本没发请求**，直接把上次那份搬出来。它成立的前提是**用户自己说没变**：
 *      浏览器读不到目录的 mtime，我们无从校验。这条不许说成「已校验未变化」。
 *   ② **指纹一致 → 不新增留档（扫之后才发现）** —— 真跑完了，发现新指纹与上一份
 *      相同，于是归入已有快照、只更新 `savedAt`。这才是**校验过的**没变，
 *      代价是这一趟已经扫过了。
 *
 * L2（只重扫变化的文件）：**CLI 那一路做了，浏览器这一路没有。**
 *   · CLI `autopsy-watch once` 会算文件级差分（mtime + size），把差异与上一份 facts
 *     一起送给 `/api/scan/facts`；后端判「变更文件里有没有描述文件」，
 *     没有就沿用 build/config/deploy/frontend/techStack，只重算代码侧。
 *   · 页面这一趟**仍然全量**：浏览器读不到目录 mtime，算不出差分，
 *     所以它没有 L2 也不假装有。想看差分就跑 CLI。
 */

const MODES: [Mode, string, string][] = [
  ['path', '本地目录', 'D:/mryang/workspace/2026/arsenal/arsenal-server'],
  ['git', 'https git', 'https://github.com/owner/repo.git'],
  ['zip', '上传 zip', ''],
];

export default function AutopsyLab() {
  const [mode, setMode] = useState<Mode>('path');
  const [source, setSource] = useState('');
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [theme, setTheme] = useState<CanvasTheme>('doc');
  const [tab, setTab] = useState<'arch' | 'services' | 'checkup' | 'history' | 'vitals' | 'runtime' | 'functions'>('arch');
  /** 架构面板内的子页签：技术架构画布（2026-10-17 合并进台）/ 应用分层图 / 项目结构 / 六视图 */
  const [archSub, setArchSub] = useState<'canvas' | 'layered' | 'structure' | 'six'>('canvas');
  /**
   * 六视图的当前档案。null = 没手动选过：有扫描讲草稿，没扫描讲内置默认档案。
   * 提升到这一层（而不是 SixViewsPanel 内部）是为了**切子页签不丢** ——
   * 放进面板里的话，切到画布看一眼再回来，选中的档案就静默回默认了。
   */
  const [archProfileId, setArchProfileId] = useState<string | null>(null);
  /**
   * 六视图导入的档案（只存在本机浏览器，照 profile-store 的老规矩，不进仓库）。
   * 初始空 + effect 加载（照本页 snapshots / vitals 同款模式）：SSR 读不到
   * localStorage，初始值直接读会让服务端 HTML 与客户端水合不一致 ——
   * hydration failed 与「reload 后 chip 闪没」就是这么来的（E2E 实测抓到）。
   */
  const [customProfiles, setCustomProfiles] = useState<Record<string, ArchProfile>>({});
  useEffect(() => {
    setCustomProfiles(loadCustomProfiles());
  }, []);
  const [checkup, setCheckup] = useState<CheckupStage>({ kind: 'idle' });
  const fileRef = useRef<HTMLInputElement>(null);

  // ── 活体采集（第六页签）──
  // 独立于 checkup / vitals 的第三份状态：**不与它们合并**。
  // 合并会把「快照好了、序列没好、活体没跑」三种差异藏成一片空白，
  // 而这三件事各自都会独立失败（10-13 棒 1 交接时定的规矩）。
  const [runtimeStage, setRuntimeStage] = useState<RuntimeStage>({ kind: 'idle' });
  const [runtimeRun, setRuntimeRun] = useState<{ entryIndex: number; probe: RuntimeProbeFact | null } | null>(null);

  // ── 快照（浏览器侧 localStorage，不进军火库仓库）──
  const [snapshots, setSnapshots] = useState<AutopsySnapshot[]>([]);
  const [damaged, setDamaged] = useState<DamagedEntry[]>([]);
  const [diff, setDiff] = useState<SnapshotDiff | null>(null);
  /** 扫之前复用了哪一份（空 = 这一趟是真扫的） */
  const [reusedFrom, setReusedFrom] = useState<string | null>(null);
  /** 真扫完了才发现与上一份指纹一致 —— 于是没新增留档 */
  const [foldedInto, setFoldedInto] = useState<string | null>(null);
  const [storeNote, setStoreNote] = useState<string | null>(null);
  /** 「输入没变就复用」默认开 —— 这是 L1 的唯一入口；关掉即强制重扫 */
  const [reuseInput, setReuseInput] = useState(true);

  // ── 生命体征序列（浏览器侧 localStorage，与快照同一条「不进军火库仓库」的规矩）──
  const [vitalsPoints, setVitalsPoints] = useState<VitalsPointShape[]>([]);
  const [vitalsDamaged, setVitalsDamaged] = useState<{ projectId: string; issues: string[] }[]>([]);
  const [vitalsNote, setVitalsNote] = useState<string | null>(null);

  const currentSource: { kind: 'path' | 'git'; value: string } | null = useMemo(() => {
    if (mode === 'zip') return null;
    const v = source.trim();
    return v ? { kind: mode === 'git' ? 'git' : 'path', value: v } : null;
  }, [mode, source]);

  const reloadSnapshots = useCallback(() => {
    const loaded = loadLocalSnapshots();
    setDamaged(loaded.damaged);
    const pid = currentSource ? projectIdOfSource(currentSource) : null;
    setSnapshots(pid ? loaded.snapshots[pid] ?? [] : []);
  }, [currentSource]);

  useEffect(() => {
    reloadSnapshots();
  }, [reloadSnapshots]);

  /** 序列与快照同源同 pid —— 两边靠同一个 `projectIdOfSource` 对上号。 */
  const reloadVitals = useCallback(() => {
    const loaded = loadLocalVitals();
    setVitalsDamaged(loaded.damaged);
    const pid = currentSource ? projectIdOfSource(currentSource) : null;
    setVitalsPoints(pid ? loaded.points[pid] ?? [] : []);
  }, [currentSource]);

  useEffect(() => {
    reloadVitals();
  }, [reloadVitals]);

  const run = useCallback(async (what: string, requested: string, fn: () => Promise<ScanOutcome>) => {
    setStage({ kind: 'scanning', what });
    const outcome = await fn();
    if (outcome.kind === 'facts') {
      setStage({ kind: 'done', facts: outcome.facts, requested });
    } else if (outcome.kind === 'offline') {
      setStage({ kind: 'failed', code: 'OFFLINE', message: outcome.message, offline: true });
    } else {
      setStage({ kind: 'failed', code: outcome.code, message: outcome.message, offline: false });
    }
  }, []);

  const onAnalyze = useCallback(() => {
    if (mode === 'zip') {
      const file = fileRef.current?.files?.[0];
      if (!file) return;
      void run(`上传 ${file.name}`, file.name, () => scanUpload(file));
      return;
    }
    const value = source.trim();
    if (!value) return;
    // git 那条路后端一直支持（SourceResolver.fromGit），只是前端没发过 —— 这里补上
    void run(`扫描 ${value}`, value, () => scanFacts({ kind: mode === 'git' ? 'git' : 'path', value }));
  }, [mode, run, source]);

  // 换输入就作废上一次体检结果 —— 留着一份「对别的目录跑出来的结论」是最危险的那种旧数据
  const onAnalyzeCheckup = useCallback(
    (force = false) => {
      if (mode === 'zip') {
        setCheckup({
          kind: 'failed',
          code: 'ZIP_NOT_SUPPORTED',
          message: '体检暂不支持 zip：/api/autopsy/inspect 只吃 path / git（上传链路是 multipart，不是同一条路）。请先解压到本地目录再体检。',
          offline: false,
        });
        return;
      }
      const value = source.trim();
      if (!value) return;
      const src: { kind: 'path' | 'git'; value: string } = {
        kind: mode === 'git' ? 'git' : 'path',
        value,
      };
      setReusedFrom(null);
      setFoldedInto(null);
      setStoreNote(null);

      // ① L1：扫之前就复用。注意这一趟**没有发任何请求** —— 判定依据是「上次留档还在 +
      //    用户说没变」，不是「校验过内容没变」（浏览器读不到目录 mtime，做不到）。
      //    ⚠️ 上一份的指纹若本身不可信（0 文件 / 被截断），**不许复用**：
      //      那会把「上次什么也没扫到」说成「输入没变」。
      if (!force && reuseInput && snapshots.length > 0) {
        const trust = fingerprintTrust(snapshots[0].report);
        if (!trust.trustworthy) {
          setStoreNote(`上一份（${snapshots[0].snapshotId}）的指纹不可信，这次不复用：${trust.reason}`);
        } else {
          setCheckup({ kind: 'done', report: snapshots[0].report });
          setReusedFrom(snapshots[0].snapshotId);
          setDiff(null);
          setTab('checkup');
          return;
        }
      }

      setCheckup({ kind: 'running' });
      void autopsyInspect(src).then((outcome) => {
        if (outcome.kind === 'report') {
          setCheckup({ kind: 'done', report: outcome.report });
          const snap = buildSnapshot({
            source: src,
            report: outcome.report,
            facts: stage.kind === 'done' ? stage.facts : null,
          });
          const prev = snapshots[0] ?? null;
          const trust = fingerprintTrust(outcome.report);

          // ── 生命体征：这次体检落一枚序列点（与快照同一次采集，不另发请求）──
          //    L1 复用那一趟（上面 early return）不落点 —— 那一次没有新事实。
          const pid = projectIdOfSource(src);
          const vPoint = pointFromReport({
            report: outcome.report,
            facts: stage.kind === 'done' ? stage.facts : null,
            fingerprint: snap.fingerprint,
            fingerprintKind: snap.fingerprintKind,
            snapshotId: snap.snapshotId,
            savedAt: snap.savedAt,
          });
          const vr = appendLocalPoint(pid, vPoint);
          setVitalsNote(
            vr.ok
              ? null
              : `这一枚没进生命体征序列：${vr.issues.join('；')}`
          );
          reloadVitals();
          // 指纹本身不可信（0 文件 / 被截断）时不许归入 —— 否则「两次都没扫到」
          // 会被记成「没变化」，历史里就只剩一条永远不变的记录。
          if (prev && trust.trustworthy && prev.fingerprint === snap.fingerprint) {
            // ② 真扫完才发现指纹一致 → 归入已有快照，不新增一条「长得一样的历史」
            setFoldedInto(prev.snapshotId);
            setDiff(diffSnapshots(prev, snap));
          } else {
            const res = saveLocalSnapshot(snap);
            setDiff(prev ? diffSnapshots(prev, snap) : null);
            if (res.ok) {
              setStoreNote(
                res.factsOmitted ? '已留档（架构事实为省配额没存，结论完整）' : null
              );
              reloadSnapshots();
            } else {
              // 存不下来也要说 —— 「留档失败」与「没留档」在页面上长得一模一样
              setStoreNote(`这份没存下来：${res.issues.join('；')}`);
            }
          }
        } else if (outcome.kind === 'offline') {
          setCheckup({ kind: 'failed', code: 'OFFLINE', message: outcome.message, offline: true });
        } else {
          setCheckup({ kind: 'failed', code: outcome.code, message: outcome.message, offline: false });
        }
      });
    },
    [mode, source, reuseInput, snapshots, stage, reloadSnapshots]
  );

  /**
   * 活体采集一次。
   *
   * 与 `onAnalyze` / `onAnalyzeCheckup` 是**三条独立的路**，不共用状态：
   * 体检是只读扫，活体是真跑。前者绿了不代表后者会跑起来。
   *
   * zip 模式**这一条走不了**：后端 /run 只接 path|git（它要复制目录到工作副本，
   * 上传件的临时文件活不过这一次请求）。这里明说，不给一个点了才知道坏的按钮。
   */
  const onRunRuntime = useCallback(
    (entryIndex: number, runtime: RuntimeKind, wallClockMs: number) => {
      const src = currentSource;
      const entries = stage.kind === 'done' ? (stage.facts.code?.entryPoints ?? []) : [];
      const ep = entries[entryIndex];
      if (!src) {
        setRuntimeStage({ kind: 'failed', code: 'NO_SOURCE', message: '先在上面填一个项目地址（或先做一次分析，让解剖台认出入口）', offline: false });
        return;
      }
      if (!ep) {
        setRuntimeStage({ kind: 'failed', code: 'NO_ENTRY', message: '这次分析没认出任何可运行入口 —— 活体解剖无从下手', offline: false });
        return;
      }
      const mainClass = ep.package ? `${ep.package}.${ep.className ?? ''}` : ep.className ?? '';
      if (!mainClass) {
        setRuntimeStage({ kind: 'failed', code: 'NO_MAIN_CLASS', message: '这个入口没解析出主类名 —— 后端不猜，猜错与真起不来在结果上分不开', offline: false });
        return;
      }
      setRuntimeStage({ kind: 'running' });
      setRuntimeRun({ entryIndex, probe: null });
      void autopsyRun(src, mainClass, runtime, wallClockMs).then((outcome: AutopsyRunOutcome) => {
        if (outcome.kind === 'probe') {
          setRuntimeRun({ entryIndex, probe: outcome.probe });
          setRuntimeStage({ kind: 'done' });
        } else if (outcome.kind === 'offline') {
          setRuntimeStage({ kind: 'failed', code: 'OFFLINE', message: outcome.message, offline: true });
        } else {
          setRuntimeStage({ kind: 'failed', code: outcome.code, message: outcome.message, offline: false });
        }
      });
    },
    [currentSource, stage]
  );

  const runtimeEntries = useMemo(
    () => (stage.kind === 'done' ? (stage.facts.code?.entryPoints ?? []) : []),
    [stage]
  );

  const artifacts: AutopsyArtifacts | null = useMemo(
    () => (stage.kind === 'done' ? buildAutopsy(stage.facts, theme) : null),
    [stage, theme]
  );

  /**
   * 画布的形态参数（计划 D2）：副本数只从部署清单读
   * （K8s Deployment / Helm replicaCount，判据在 `replicaFact`），
   * 读不到就不设 —— `paramIsSet` 的「未设」哨兵保证**不兜底 1**，
   * 「只覆盖应用卡」的规矩由 `nodeTopologyMap` 继承。
   */
  const scanMeta = useMemo(() => {
    if (!artifacts) return emptyMeta();
    const fact = replicaFact(artifacts.facts);
    return fact ? withParam(emptyMeta(), 'replicas', fact.replicas) : emptyMeta();
  }, [artifacts]);

  const trace: AutopsySourceTrace | null =
    stage.kind === 'done' ? traceSource(stage.requested, stage.facts) : null;

  /**
   * 扫描 → 六视图档案草稿（`buildProfileDraftFromFacts`；/arch 退役后这里是
   * 唯一的「扫描 → 档案草稿」入口，不自己拼第二份）。草稿不当成品卖：
   * todos 由成熟度条逐条列出，`TODO ` 前缀原文上图。
   */
  const profileDraft: ProfileDraft | null = useMemo(
    () => (stage.kind === 'done' ? buildProfileDraftFromFacts(stage.facts) : null),
    [stage]
  );

  /**
   * 当前档案（六视图子页签的数据源）：有扫描且没手动选过 → 草稿；
   * 手动选过（内置 / 导入 / 切回草稿）→ 听用户的。
   * 重新扫描不重置选择 —— 档案选择是独立意图，扫新项目不该把人正在看的那份抢走。
   */
  const effectiveArchProfileId =
    archProfileId ?? (profileDraft ? DRAFT_PROFILE_ID : DEFAULT_PROFILE_ID);

  const onArchProfilePick = useCallback((id: string, doc?: ArchProfile) => {
    if (doc) {
      setCustomProfiles((prev) => {
        const next = { ...prev, [doc.id]: doc };
        saveCustomProfiles(next);
        return next;
      });
    }
    setArchProfileId(id);
  }, []);

  const safeName = artifacts ? artifacts.facts.root.replace(/[^\w.-]+/g, '-') : 'project';

  return (
    <div className="space-y-3">
      <header>
        <h1 className="text-[14px] font-bold text-fg">项目侦察</h1>
        <p className="mt-1 text-[11px] leading-[17px] text-fgMuted">
          给一个项目地址，侦察出技术栈部署图、应用分层图、未识别依赖清单与服务拓扑（有几个服务、各带什么出处）。
          只读扫描、不执行仓库里的任何脚本；每条结论都带文件与行号，没认出来的一律列出来而不猜。
        </p>
      </header>

      {/* ── 输入区 ── */}
      <div className="panel px-3 py-3">
        <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">一、填一个项目地址</p>
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

          {mode === 'zip' ? (
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
              placeholder={MODES.find((m) => m[0] === mode)?.[2] ?? ''}
              className="mono min-w-[280px] flex-1 rounded border border-line bg-transparent px-2 py-1 text-[11px] text-fg outline-none placeholder:text-fgFaint focus:border-lineHi"
            />
          )}

          <button
            type="button"
            onClick={onAnalyze}
            disabled={stage.kind === 'scanning' || (mode !== 'zip' && !source.trim())}
            className="rounded border px-3 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45"
            style={{ borderColor: 'rgba(217,164,65,0.5)', background: 'rgba(217,164,65,0.12)', color: '#D9A441' }}
          >
            {stage.kind === 'scanning' ? '分析中…' : '一键分析'}
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

        <p className="mt-2 text-[10px] leading-[16px] text-fgFaint">
          扫描是只读的：不执行仓库里的任何脚本 / 构建 / 测试，单文件 2MB / 总 500MB / 2 万文件 / 深度 20 / 180s 超时。
          配置文件里的 password、token 一类值在事实里一律是 <span className="mono">***</span>，结果不外发任何地方。
          本地目录会被解析成真实路径（符号链接 / <span className="mono">..</span> 都会跟着走）—— 下面会告诉你实际扫的是哪个目录。
        </p>

        {stage.kind === 'scanning' && (
          <p className="mt-2.5 mono text-[11px] text-fgMuted">{stage.what} …</p>
        )}

        {stage.kind === 'failed' && (
          <div
            className="mt-2.5 rounded border px-2.5 py-2"
            style={{ borderColor: 'rgba(229,72,77,0.4)', background: 'rgba(229,72,77,0.08)' }}
          >
            <p className="text-[11px] font-semibold" style={{ color: '#E5484D' }}>
              {stage.offline ? '后端连不上（:3011 没起）' : `分析被拒：${stage.code}`}
            </p>
            <p className="mt-1 text-[10.5px] leading-[16px] text-fgMuted">{stage.message}</p>
            {stage.offline && (
              <p className="mt-1 text-[10px] leading-[15px] text-fgFaint">
                起后端：<span className="mono">SKIP_COMPILE=1 bash arsenal-server/scripts/run.sh</span>
                。本页三条输入都要走后端扫描，没有离线兜底 —— 只有「粘贴 facts JSON」那条路
                （在 /archify 的「从代码生成」里）能纯前端算。
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── 页签：架构 / 服务拓扑 / 体检 / 历史 / 生命体征 / 活体 / 功能 ── */}
      <div className="flex flex-wrap items-center gap-1 self-start rounded border border-line p-0.5">
        {(
          [
            ['arch', '架构面板'],
            ['services', '服务拓扑'],
            ['checkup', '体检报告'],
            ['history', `历史（${snapshots.length}）`],
            ['vitals', `生命体征（${vitalsPoints.length}）`],
            ['runtime', '活体对账'],
            ['functions', '功能视图'],
          ] as ['arch' | 'services' | 'checkup' | 'history' | 'vitals' | 'runtime' | 'functions', string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={
              'rounded px-2.5 py-1 text-[11px] transition-colors ' +
              (tab === id ? 'bg-surfaceHi text-brass' : 'text-fgMuted hover:text-fg')
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'checkup' && (
        <div className="space-y-3">
          <div className="panel px-3 py-3">
            <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
              体检：三档结论 + 覆盖率
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onAnalyzeCheckup(false)}
                disabled={checkup.kind === 'running' || (mode !== 'zip' && !source.trim())}
                className="rounded border px-3 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                style={{ borderColor: 'rgba(217,164,65,0.5)', background: 'rgba(217,164,65,0.12)', color: '#D9A441' }}
              >
                {checkup.kind === 'running' ? '体检中…' : '一键体检'}
              </button>
              <button
                type="button"
                onClick={() => onAnalyzeCheckup(true)}
                disabled={checkup.kind === 'running' || (mode !== 'zip' && !source.trim())}
                className="rounded border border-line px-2.5 py-1 text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg disabled:cursor-not-allowed disabled:opacity-45"
              >
                强制重扫（不用缓存）
              </button>
              <label className="flex cursor-pointer items-center gap-1.5 text-[10.5px] text-fgMuted">
                <input
                  type="checkbox"
                  checked={reuseInput}
                  onChange={(e) => setReuseInput(e.target.checked)}
                  className="accent-brass"
                />
                输入没变就直接复用上次结果（<span className="mono">L1</span>，不重扫）
              </label>
              <span className="text-[10px] leading-[15px] text-fgFaint">
                用上面同一个地址跑。P0/P1 复用同一套规则集（MUST+NEVER 判 P0、SHOULD 判 P1，
                与 /check 同一台引擎）；观察项由 <span className="mono">arsenal-checkups/checkups.json</span> 驱动 —— 判据是数据不是代码。
              </span>
            </div>

            {reuseInput && snapshots.length === 0 && currentSource && (
              <p className="mt-2 text-[10.5px] leading-[16px] text-fgFaint">
                这个地址还没有留档，所以这次会真扫 —— 跑完就有一份，
                下次点「一键体检」才会走到复用（那一趟<span className="text-fgMuted">不发任何请求</span>）。
              </p>
            )}

            {reusedFrom && (
              <div
                className="mt-2.5 rounded border px-2.5 py-2"
                style={{ borderColor: 'rgba(127,166,80,0.45)', background: 'rgba(127,166,80,0.08)' }}
              >
                <p className="text-[11px] font-semibold" style={{ color: '#7FA650' }}>
                  输入未变化，复用 {reusedFrom} —— 这一趟没有重新扫描
                </p>
                <p className="mt-1 text-[10px] leading-[15px] text-fgMuted">
                  依据是「<span className="mono">同一个地址 + 你勾选了输入没变</span>」，
                  <span className="text-fg">不是校验过内容</span>：浏览器读不到目录的 mtime，
                  做不出内容级指纹（Node 侧 <span className="mono">autopsy-fingerprint.mjs</span>
                  有真的树指纹，本站静态导出、跑不了）。改过代码就用「强制重扫」。
                </p>
              </div>
            )}

            {foldedInto && (
              <p className="mt-2 text-[10.5px] leading-[16px] text-fgMuted">
                这次真扫了，结果与 <span className="mono text-fg">{foldedInto}</span>{' '}
                的输入规模指纹一致 —— <span className="text-fg">归入那份快照，没有新增历史</span>
                （省一条长得一模一样的留档）。
              </p>
            )}

            {storeNote && (
              <p
                className="mt-2 text-[10.5px] leading-[16px]"
                style={{ color: storeNote.startsWith('这份没存下来') ? '#E5484D' : '#93A39C' }}
              >
                {storeNote}
              </p>
            )}
            {checkup.kind === 'idle' && (
              <p className="mt-2 text-[10.5px] text-fgMuted">
                还没跑过体检。点上面的按钮 —— 报告会明确写出「覆盖了多少条、多少条没结论」，
                不会只报一个命中数。
              </p>
            )}
            {checkup.kind === 'failed' && (
              <div
                className="mt-2.5 rounded border px-2.5 py-2"
                style={{ borderColor: 'rgba(229,72,77,0.4)', background: 'rgba(229,72,77,0.08)' }}
              >
                <p className="text-[11px] font-semibold" style={{ color: '#E5484D' }}>
                  {checkup.offline ? '后端连不上（:3011 没起）' : `体检被拒：${checkup.code}`}
                </p>
                <p className="mt-1 text-[10.5px] leading-[16px] text-fgMuted">{checkup.message}</p>
              </div>
            )}
          </div>

          {checkup.kind === 'done' && (
            <>
              <CheckupPanel report={checkup.report} />
              <div className="panel flex flex-wrap items-center gap-2 px-3 py-2.5">
                <button
                  type="button"
                  onClick={() =>
                    downloadText(
                      JSON.stringify(checkup.report, null, 2),
                      `${checkup.report.root || 'project'}-checkup.json`,
                      'application/json'
                    )
                  }
                  className="rounded border border-line px-2.5 py-1 text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
                >
                  下载体检 JSON
                </button>
                <span className="text-[10px] text-fgFaint">
                  这份 JSON 带覆盖率与未覆盖明细 —— 留档时它才是「这次到底查了什么」的凭据
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'arch' && (
        <div className="space-y-3">
          {stage.kind === 'done' && artifacts && trace && (
            <>
          {/* ── 扫的到底是哪儿 ── */}
          <div className="panel px-3 py-2.5">
            <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
              二、这次扫的是哪儿
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              <span className="mono text-fgMuted">
                输入 <span className="text-fg">{trace.requested}</span>
              </span>
              <span className="text-fgFaint">→</span>
              <span className="mono text-fgMuted">
                实际扫描 <span className="text-fg">{trace.scannedRoot || '（未给出）'}</span>
                <span className="ml-1 text-fgFaint">{trace.kind}</span>
              </span>
            </div>
            {trace.diverged && (
              <p className="mt-1 text-[10.5px] leading-[16px]" style={{ color: '#E5A33D' }}>
                填进去的末段与实际扫到的目录名不一致 —— 路径被解析到了别处（相对路径、
                <span className="mono">..</span> 或符号链接都会这样）。确认上面这行是你想扫的目录。
              </p>
            )}
          </div>

          {/* ── 事实摘要 ── */}
          <div className="panel px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fgMuted">
              <span className="mono text-fg">{artifacts.summary.root}</span>
              <span>{artifacts.summary.files} 文件</span>
              <span>{(artifacts.summary.bytes / 1024).toFixed(0)} KB</span>
              <span>{artifacts.summary.elapsedMs} ms</span>
              {artifacts.summary.buildKind && <span>构建 {artifacts.summary.buildKind}</span>}
              {artifacts.summary.javaVersion && <span>Java {artifacts.summary.javaVersion}</span>}
              <span>
                技术命中 {artifacts.summary.techs.length} 项（上画布 {artifacts.summary.onCanvasCount} 项）
              </span>
              {artifacts.summary.truncated && (
                <span style={{ color: '#E5A33D' }}>已被闸门截断，事实不完整</span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {artifacts.summary.techs.map((t) => (
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
              {artifacts.summary.techs.length === 0 && (
                <span className="text-[10.5px]" style={{ color: '#E5A33D' }}>
                  一项技术都没命中 —— 多半是没读到构建文件，下面的图会是空的（空是事实，不补节点）
                </span>
              )}
            </div>
          </div>
            </>
          )}

          {/* ── 架构面板：技术架构画布 / 应用分层图 / 项目结构 / 六视图 ── */}
          <div className="panel px-3 py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">三、架构面板</p>
              <div className="flex items-center gap-1 rounded border border-line p-0.5">
                {(
                  [
                    ['canvas', '技术架构'],
                    ['layered', '应用分层'],
                    ['structure', '项目结构'],
                    ['six', '六视图'],
                  ] as ['canvas' | 'layered' | 'structure' | 'six', string][]
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setArchSub(id)}
                    className={
                      'rounded px-2 py-0.5 text-[10.5px] transition-colors ' +
                      (archSub === id ? 'bg-surfaceHi text-brass' : 'text-fgMuted hover:text-fg')
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {/* 档案条：切档案与看图同一视野（拍板项 2 推荐位）。没扫描默认落内置档案，六视图离线可看 */}
            <div className="mt-2">
              <ProfileBar
                draft={profileDraft}
                profileId={effectiveArchProfileId}
                custom={customProfiles}
                onPick={onArchProfilePick}
              />
            </div>
            <div className="mt-2">
              {stage.kind !== 'done' || !artifacts ? (
                // 画布 / 分层 / 结构三个子页签都要读扫描事实；六视图不用（可离线讲内置档案）。
                // 没扫描时默认子页签仍是 canvas —— 这里给一句人话，别让用户对着一块空白猜。
                archSub === 'six' ? (
                  <SixViewsPanel
                    draft={profileDraft}
                    profileId={effectiveArchProfileId}
                    custom={customProfiles}
                  />
                ) : (
                  <p className="text-[10.5px] leading-[16px] text-fgMuted">
                    这个子页签要读扫描事实 —— 先在上面「一键分析」一个项目。
                    没扫描也能看六视图：切到「六视图」子页签，它讲内置档案（构建期快照，不依赖后端）。
                  </p>
                )
              ) : archSub === 'canvas' ? (
                <TechArch
                  key={`canvas:${artifacts.facts.root}`}
                  picks={artifacts.picksRes.picks}
                  meta={scanMeta}
                  titleRoot={artifacts.facts.root}
                  banner={
                    <p
                      className="flex flex-wrap items-center gap-x-2 rounded-md border px-3 py-2 text-[11px]"
                      style={{ borderColor: 'rgba(229,162,61,0.35)', background: 'rgba(229,162,61,0.07)' }}
                    >
                      <span className="mono" style={{ color: '#E5A33D' }}>
                        ◎
                      </span>
                      <span className="text-fgMuted">
                        这张图来自<span className="text-fg">本次扫描</span>（{artifacts.facts.root}）——
                        不是装配台选型快照。副本数读自部署清单，读不到就不画徽章、不兜底 1；
                        拖动与改名只影响这张交付图，不改扫描结论。
                      </span>
                    </p>
                  }
                  irOverride={{
                    ir: artifacts.ir,
                    issues: artifacts.issues,
                    name: archifyIrFilename(artifacts.facts.root),
                  }}
                />
              ) : archSub === 'layered' ? (
                <ArchPanel artifacts={artifacts} safeName={safeName} />
              ) : archSub === 'structure' ? (
                // key 按项目分：扫新项目必须重算「默认展开两层」的折叠态，
                // 否则旧 collapsed 集合全不命中新树 → 深层默认全展开（万类仓库会卡）
                <StructurePanel
                  key={`structure:${artifacts.facts.root}`}
                  artifacts={artifacts}
                  safeName={safeName}
                />
              ) : (
                <SixViewsPanel
                  draft={profileDraft}
                  profileId={effectiveArchProfileId}
                  custom={customProfiles}
                />
              )}
            </div>
          </div>

          {stage.kind === 'done' && artifacts && (
            <>
          {/* ── 未识别依赖 ── */}
          <div className="panel px-3 py-2.5">
            <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
              四、未识别依赖
            </p>
            <div className="mt-2">
              <UnmatchedPanel facts={artifacts.facts} />
            </div>
          </div>

          {/* ── 这次怎么选的 ── */}
          <div className="panel px-3 py-2.5">
            <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
              五、这次怎么选的（每条都带文件:行）
            </p>
            <ul className="mt-1.5 space-y-1 text-[10.5px] leading-[16px] text-fgMuted">
              {artifacts.built.detail.fromDeps.map((d) => (
                <li key={`dep-${d.dim}`} className="mono">
                  <span className="text-fg">
                    {d.dim}={d.opt}
                  </span>{' '}
                  ← {d.evidence.path}:{d.evidence.line}
                </li>
              ))}
              {artifacts.built.detail.fromDeploy.map((d) => (
                <li key={`dp-${d.dim}`} className="mono">
                  <span className="text-fg">
                    {d.dim}={d.opt}
                  </span>{' '}
                  ← 部署清单 {d.because}
                </li>
              ))}
              {artifacts.built.detail.conflicts.map((c) => (
                <li key={`cf-${c.dim}`} style={{ color: '#E5A33D' }}>
                  · {c.dim} 命中多个候选，图上只画了 {c.kept}；另有 {c.dropped.join('、')} 未采用
                </li>
              ))}
              {artifacts.built.detail.fromDeps.length === 0 &&
                artifacts.built.detail.fromDeploy.length === 0 && (
                  <li style={{ color: '#E5A33D' }}>
                    · 一个槽位都没选出来 —— 没有依赖命中映射表里的任何 dim，图上是空的
                  </li>
                )}
            </ul>
            <div className="mt-2 flex flex-wrap items-center gap-2">
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
              <span className="text-[10px] text-fgFaint">
                这份 JSON 可以留档 —— 下次不必重新扫仓库（棒 3 的快照就存它）
              </span>
            </div>
          </div>
            </>
          )}
        </div>
      )}

      {tab === 'services' && artifacts && stage.kind === 'done' && (
        <ServicePanel artifacts={artifacts} safeName={safeName} />
      )}

      {tab === 'history' && (
        <HistoryPanel
          source={currentSource}
          snapshots={snapshots}
          damaged={damaged}
          diff={diff}
          onDelete={(id) => {
            if (currentSource) deleteLocalSnapshot(projectIdOfSource(currentSource), id);
            setDiff(null);
            reloadSnapshots();
          }}
        />
      )}

      {tab === 'vitals' && (
        <VitalsPanel
          points={vitalsPoints}
          damaged={vitalsDamaged}
          onClear={() => {
            if (currentSource) clearLocalVitals(projectIdOfSource(currentSource));
            setVitalsNote(null);
            reloadVitals();
          }}
        />
      )}
      {vitalsNote && tab === 'vitals' && (
        <p className="text-[10.5px] leading-[15px] text-fgFaint">⚠ {vitalsNote}</p>
      )}

      {tab === 'runtime' && (
        <>
          {mode === 'zip' && (
            <p className="text-[10.5px] leading-[15px] text-fgFaint">
              ⚠ 上传 zip 这一条<span className="text-fgMuted">走不了活体采集</span>：后端要把目录复制成工作副本再跑，
              上传件的临时文件活不过这一次请求。要真跑请用「本地目录」或「https git」。
            </p>
          )}
          <RuntimePanel
            entries={runtimeEntries}
            stage={runtimeStage}
            run={runtimeRun}
            onRun={onRunRuntime}
          />
        </>
      )}

      {tab === 'functions' && <FunctionPanel facts={stage.kind === 'done' ? stage.facts : null} />}
    </div>
  );
}
