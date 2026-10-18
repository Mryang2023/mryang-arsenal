'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CANVAS_THEME_OPTIONS, type CanvasTheme } from '@/lib/arch-canvas';
import { buildAutopsy, type AutopsyArtifacts } from '@/lib/autopsy-data';
import type { ProjectFacts } from '@/lib/facts-arch';
import { replicaFact } from '@/lib/facts-arch';
import { emptyMeta, withParam } from '@/lib/topology';
import { archifyIrFilename } from '@/lib/archify-ir';
import {
  autopsyRun,
  type AutopsyReport,
  type AutopsyRunOutcome,
  type RuntimeKind,
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
import { useActiveProject } from '@/lib/active-project';
import {
  getCheckupHistory,
  getCheckupLatest,
  getProject,
  getProjectFacts,
  runProjectCheckup,
  scanProject,
  type ProjectDetail,
} from '@/lib/projects-api';
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
 * 项目侦察（工坊棒3 改造后）。
 *
 * 一句话：选一个固定项目 → 出「技术栈部署图 + 应用分层图 + 未识别依赖清单 + 服务拓扑」。
 *
 * 输入面与旧版（填临时地址）**刻意断开**：本页只认「当前项目」（localStorage 总线，
 * 在 /projects 设定），一切扫描 / 体检都读**服务器侧项目缓存** —— 不再有临时地址、
 * 不再有 zip 上传。填地址的旧路归 /archify 的「从代码生成」（计划 D8：那边不动）。
 *
 * 三条刻意的分工（别在页面里重写任何一条）：
 *   ① **怎么拿 facts** —— 服务端留档 `GET /api/projects/{id}/facts`（挂载即恢复），
 *      重扫走 `POST /api/projects/{id}/scan`（读缓存，不碰源头）。
 *      前端不自己拼请求，统一走 `lib/projects-api.ts`。
 *   ② **facts → 结论** —— `buildAutopsy()`（`lib/autopsy-data.ts`），
 *      与 CodeIntake 共用一份；本页只负责画。
 *   ③ **图怎么画** —— `arch-canvas.ts` / `arch-layered.ts`，成品渲染器，不动。
 *
 * 「切菜单不丢内容」的实现口径（计划 D7）：内容不是组件 state 撑着的 ——
 * 挂载时从服务端留档读回（facts 缓存 + 体检 latest + history）。组件 state 只存
 * 「这一次会话的临时态」（扫描中 / 失败），卸载就没了也不该有。
 */

type Stage =
  | { kind: 'idle' }
  | { kind: 'scanning'; what: string }
  | { kind: 'done'; facts: ProjectFacts; requested: string }
  | { kind: 'failed'; code: string; message: string; offline: boolean };

/**
 * 体检是**独立的一条路**（POST /api/projects/{id}/checkup），与架构面板的 facts
 * 不是同一条路。为什么不合进一次扫描：两者要的东西不同（架构事实 vs 三档结论），
 * 后端也分两个接口；前端若把两者合成一次「大请求」，任何一半失败都会让另一半也拿不到。
 */
type CheckupStage =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; report: StampedReport }
  | { kind: 'failed'; code: string; message: string; offline: boolean };

/**
 * L1 复用的**内容级**判据（工坊棒3 把旧版「浏览器侧口头声明」升级掉）：
 *
 * 服务端 POST /{id}/checkup 会在报告里盖章 `cacheFingerprint`（写留档那一刻的
 * 注册表缓存指纹）。前端拿它与注册表**当前**指纹比对：
 *   - match    → 留档对应的就是现在这份缓存内容，可以复用（这一趟不发请求）；
 *   - mismatch → 缓存内容变过（刷新过缓存），留档是旧结论，必须真扫；
 *   - unstamped→ 旧格式留档没有戳 / 没有缓存指纹可比 —— 无法内容级校验，照实说，真扫；
 *   - untrusted→ 留档指纹本身不可信（0 文件 / 被截断）—— 不许拿「上次什么也没扫到」
 *                当「没变」（fingerprintTrust 判据沿用）。
 * 旧版「你勾选了输入没变所以复用」那条路**整个退场**：浏览器读不到目录 mtime，
 * 声明式的「没变」与校验过的「没变」在页面上长得一模一样，就是撒谎的形状。
 */
type L1Verdict = 'match' | 'mismatch' | 'unstamped' | 'untrusted' | 'none';

/** 服务端带戳的报告形状（AutopsyReport + 棒3 新增的两枚戳，additive）。 */
type StampedReport = AutopsyReport & {
  cacheFingerprint?: string | null;
  checkedAt?: string;
};

type L1State = { verdict: L1Verdict; detail: string };

function computeL1(report: StampedReport, cacheFingerprint: string | null): L1State {
  const trust = fingerprintTrust(report);
  if (!trust.trustworthy) return { verdict: 'untrusted', detail: trust.reason };
  const stamped = report.cacheFingerprint ?? null;
  if (stamped === null) {
    return { verdict: 'unstamped', detail: '体检留档没有指纹戳（旧格式留档，盖章前生成的）' };
  }
  if (cacheFingerprint === null) {
    return { verdict: 'unstamped', detail: '注册表没有缓存指纹可比（项目还没有缓存统计）' };
  }
  return stamped === cacheFingerprint
    ? { verdict: 'match', detail: `留档指纹与当前缓存指纹一致（${cacheFingerprint}）` }
    : { verdict: 'mismatch', detail: `留档指纹 ${stamped} ≠ 当前缓存指纹 ${cacheFingerprint}` };
}

/** 服务端体检历史条目：checkupHistory 存的是整份报告，列表只挑时间与扫描根展示。 */
type ServerHistoryEntry = StampedReport & { savedAt?: string };

export default function AutopsyLab() {
  const active = useActiveProject();
  const pid = active?.id ?? null;
  const [proj, setProj] = useState<ProjectDetail | null>(null);
  const [projNote, setProjNote] = useState<{ kind: 'missing' | 'offline'; message: string } | null>(null);
  const [mounting, setMounting] = useState(false);
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
  /** 当前显示的体检报告是否来自服务端留档（挂载恢复 / 真扫落盘后都是） */
  const [checkupOrigin, setCheckupOrigin] = useState<'server' | null>(null);
  /** L1 内容级校验结论（挂载时对服务端 latest 算，真扫后对新戳算） */
  const [l1, setL1] = useState<L1State | null>(null);
  /** 服务端体检历史（GET /{id}/checkups） */
  const [serverHistory, setServerHistory] = useState<ServerHistoryEntry[] | null>(null);

  // ── 活体采集（第六页签）──
  // 独立于 checkup / vitals 的第三份状态：**不与它们合并**。
  // 合并会把「快照好了、序列没好、活体没跑」三种差异藏成一片空白，
  // 而这三件事各自都会独立失败（10-13 棒 1 交接时定的规矩）。
  const [runtimeStage, setRuntimeStage] = useState<RuntimeStage>({ kind: 'idle' });
  const [runtimeRun, setRuntimeRun] = useState<{ entryIndex: number; probe: RuntimeProbeFact | null } | null>(null);

  // ── 快照（浏览器侧 localStorage，旧本地留档，只读 —— 服务端留档是正主）──
  const [snapshots, setSnapshots] = useState<AutopsySnapshot[]>([]);
  const [damaged, setDamaged] = useState<DamagedEntry[]>([]);
  const [diff, setDiff] = useState<SnapshotDiff | null>(null);
  /** 这一趟体检是复用（没发请求）时，复用对象的人话描述 */
  const [reusedFrom, setReusedFrom] = useState<string | null>(null);
  /** 真扫完了才发现与上一份本地快照指纹一致 —— 本地留档不新增一条（既有口径保留） */
  const [foldedInto, setFoldedInto] = useState<string | null>(null);
  const [storeNote, setStoreNote] = useState<string | null>(null);
  /** 「内容级校验通过就复用」默认开 —— L1 唯一入口；关掉即每次都真扫 */
  const [reuseInput, setReuseInput] = useState(true);

  // ── 生命体征序列（浏览器侧 localStorage，与快照同一条「不进军火库仓库」的规矩）──
  const [vitalsPoints, setVitalsPoints] = useState<VitalsPointShape[]>([]);
  const [vitalsDamaged, setVitalsDamaged] = useState<{ projectId: string; issues: string[] }[]>([]);
  const [vitalsNote, setVitalsNote] = useState<string | null>(null);

  /** 当前项目在浏览器侧的快照 / 生命体征键：统一 projectId 算法（与后端注册表同源）。 */
  const localPid: string | null = useMemo(() => {
    if (!proj) return null;
    return projectIdOfSource({ kind: proj.source.kind, value: proj.source.value });
  }, [proj]);

  const reloadLocal = useCallback(() => {
    const loaded = loadLocalSnapshots();
    setDamaged(loaded.damaged);
    setSnapshots(localPid ? loaded.snapshots[localPid] ?? [] : []);
    const vl = loadLocalVitals();
    setVitalsDamaged(vl.damaged);
    setVitalsPoints(localPid ? vl.points[localPid] ?? [] : []);
  }, [localPid]);

  useEffect(() => {
    reloadLocal();
  }, [reloadLocal]);

  // ── 挂载即恢复（计划 D7 的正面实现）：内容从服务端读回，不是组件 state ──
  // 切菜单 = 组件卸载重挂 = 全部 state 没了；回来时这里把服务端留档读回。
  // 服务端没有的（还没扫 / 还没体检）就照实给空态 —— 不拿别的项目的数据凑。
  useEffect(() => {
    let alive = true;
    if (!pid) {
      setProj(null);
      setProjNote(null);
      setStage({ kind: 'idle' });
      setCheckup({ kind: 'idle' });
      setCheckupOrigin(null);
      setL1(null);
      setServerHistory(null);
      return;
    }
    setMounting(true);
    setProjNote(null);
    setProj(null);
    void (async () => {
      const [d, f, l, h] = await Promise.all([
        getProject(pid),
        getProjectFacts(pid),
        getCheckupLatest(pid),
        getCheckupHistory(pid),
      ]);
      if (!alive) return;
      if (d.kind === 'ok') {
        setProj(d.data);
      } else if (d.kind === 'rejected') {
        setProjNote({ kind: 'missing', message: d.message });
      } else {
        // 后端不可达：项目卡照本地记录显示（active.name），内容区各面板各自报离线
        setProjNote({ kind: 'offline', message: d.message });
      }
      const cacheFp = d.kind === 'ok' ? d.data.cache?.fingerprint ?? null : null;
      if (f.kind === 'ok') {
        setStage({ kind: 'done', facts: f.data as ProjectFacts, requested: active?.name ?? pid });
      } else {
        // NOT_FOUND = 还没扫过：正常空态，给引导不报错
        setStage({ kind: 'idle' });
      }
      if (l.kind === 'ok') {
        const report = l.data as StampedReport;
        setCheckup({ kind: 'done', report });
        setCheckupOrigin('server');
        setL1(computeL1(report, cacheFp));
      } else {
        setCheckup({ kind: 'idle' });
        setCheckupOrigin(null);
        setL1(null);
      }
      if (h.kind === 'ok') setServerHistory(h.data as ServerHistoryEntry[]);
      else setServerHistory(null);
      setMounting(false);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pid]);

  /** 重新扫描缓存（POST /{id}/scan）：读缓存，不碰源头 —— 源头变了先去项目管理刷新缓存。 */
  const onRescan = useCallback(() => {
    if (!pid) return;
    setStage({ kind: 'scanning', what: '重扫项目缓存' });
    void scanProject(pid).then((o) => {
      if (o.kind === 'ok') {
        setStage({ kind: 'done', facts: o.data as ProjectFacts, requested: active?.name ?? pid });
      } else if (o.kind === 'offline') {
        setStage({ kind: 'failed', code: 'OFFLINE', message: o.message, offline: true });
      } else {
        setStage({ kind: 'failed', code: o.code, message: o.message, offline: false });
      }
    });
  }, [pid, active]);

  const onAnalyzeCheckup = useCallback(() => {
    if (!pid || !proj) return;
    setReusedFrom(null);
    setFoldedInto(null);
    setStoreNote(null);

    // ① L1：内容级校验通过 → 复用服务端留档，这一趟**没有发任何请求**。
    //    判定不是「用户说没变」，是「留档盖章指纹 === 当前缓存指纹」（computeL1）。
    if (reuseInput && checkup.kind === 'done' && l1?.verdict === 'match') {
      setReusedFrom(checkup.report.checkedAt ? `服务端留档（${checkup.report.checkedAt}）` : '服务端留档');
      setDiff(null);
      setTab('checkup');
      return;
    }

    setCheckup({ kind: 'running' });
    void runProjectCheckup(pid).then((o) => {
      if (o.kind === 'ok') {
        const report = o.data as StampedReport;
        setCheckup({ kind: 'done', report });
        setCheckupOrigin('server');
        setL1(computeL1(report, proj.cache?.fingerprint ?? null));
        // ── 生命体征：这次体检落一枚序列点（本地序列一期保留，计划 §4.2 口径）──
        const src = { kind: proj.source.kind, value: proj.source.value };
        const snap = buildSnapshot({
          source: src,
          report,
          facts: stage.kind === 'done' ? stage.facts : null,
        });
        const vPoint = pointFromReport({
          report,
          facts: stage.kind === 'done' ? stage.facts : null,
          fingerprint: snap.fingerprint,
          fingerprintKind: snap.fingerprintKind,
          snapshotId: snap.snapshotId,
          savedAt: snap.savedAt,
        });
        const vr = appendLocalPoint(projectIdOfSource(src), vPoint);
        setVitalsNote(vr.ok ? null : `这一枚没进生命体征序列：${vr.issues.join('；')}`);
        // 本地快照照旧留一份（旧本地留档只读展示）；指纹不可信的不许进 ——
        // 否则「两次都没扫到」会被记成「没变化」。
        const trust = fingerprintTrust(report);
        if (trust.trustworthy) {
          saveLocalSnapshot(snap);
          const prev = snapshots[0] ?? null;
          if (prev && prev.fingerprint === snap.fingerprint) {
            setFoldedInto(prev.snapshotId);
          }
          setDiff(prev ? diffSnapshots(prev, snap) : null);
          reloadLocal();
        } else {
          setStoreNote(`这份没进本地留档：${trust.reason}`);
        }
        // 服务端历史刚落了一份新档 —— 读回，历史页签不靠猜
        void getCheckupHistory(pid).then((h) => {
          if (h.kind === 'ok') setServerHistory(h.data as ServerHistoryEntry[]);
        });
      } else if (o.kind === 'offline') {
        setCheckup({ kind: 'failed', code: 'OFFLINE', message: o.message, offline: true });
      } else {
        setCheckup({ kind: 'failed', code: o.code, message: o.message, offline: false });
      }
    });
  }, [pid, proj, reuseInput, checkup, l1, stage, snapshots, reloadLocal]);

  /**
   * 活体采集一次。
   *
   * 与 `onRescan` / `onAnalyzeCheckup` 是**三条独立的路**，不共用状态：
   * 体检是只读扫，活体是真跑。前者绿了不代表后者会跑起来。
   *
   * 活体走的是项目的**源头地址**（path 项目的真实目录 / git 地址）—— 后端 /run
   * 要复制目录成工作副本，缓存只读的活体改造（工作副本从缓存复制）记为遗留。
   */
  const onRunRuntime = useCallback(
    (entryIndex: number, runtime: RuntimeKind, wallClockMs: number) => {
      const src = proj ? { kind: proj.source.kind, value: proj.source.value } : null;
      const entries = stage.kind === 'done' ? (stage.facts.code?.entryPoints ?? []) : [];
      const ep = entries[entryIndex];
      if (!src) {
        setRuntimeStage({ kind: 'failed', code: 'NO_SOURCE', message: '还没有当前项目 —— 先到「项目管理」注册并选一个', offline: false });
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
    [proj, stage]
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

  /**
   * 扫描 → 六视图档案草稿（`buildProfileDraftFromFacts`）。草稿不当成品卖：
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
          对当前项目做只读侦察：技术栈部署图、应用分层图、未识别依赖清单与服务拓扑（有几个服务、各带什么出处）。
          扫描与体检都读服务器侧的项目缓存，不碰源头现场；每条结论都带文件与行号，没认出来的一律列出来而不猜。
        </p>
      </header>

      {/* ── 当前项目卡（旧「填地址」输入退场：临时地址是用完即弃的根源，计划 D3）── */}
      <div className="panel px-3 py-3">
        <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">一、当前项目</p>
        {!active && (
          <div className="mt-2 rounded border px-2.5 py-2" style={{ borderColor: 'rgba(217,164,65,0.4)', background: 'rgba(217,164,65,0.07)' }}>
            <p className="text-[11px] font-semibold" style={{ color: '#D9A441' }}>
              还没有当前项目
            </p>
            <p className="mt-1 text-[10.5px] leading-[16px] text-fgMuted">
              这两个功能依托于固定项目 —— 侦察与体检都读项目缓存。先到「项目管理」注册一个项目并设为当前。
            </p>
            <Link
              href="/projects"
              className="mt-2 inline-block rounded border px-2.5 py-1 text-[11px] font-semibold transition-colors"
              style={{ borderColor: 'rgba(217,164,65,0.5)', background: 'rgba(217,164,65,0.12)', color: '#D9A441' }}
            >
              去项目管理选项目 →
            </Link>
          </div>
        )}
        {active && mounting && (
          <p className="mt-2 text-[10.5px] text-fgMuted">读取当前项目与服务端留档…</p>
        )}
        {active && !mounting && projNote?.kind === 'missing' && (
          <div className="mt-2 rounded border px-2.5 py-2" style={{ borderColor: 'rgba(229,72,77,0.4)', background: 'rgba(229,72,77,0.08)' }}>
            <p className="text-[11px] font-semibold" style={{ color: '#E5484D' }}>项目不在了</p>
            <p className="mt-1 text-[10.5px] leading-[16px] text-fgMuted">
              {projNote.message} —— 可能已被删除。去「项目管理」重新选一个。
            </p>
            <Link
              href="/projects"
              className="mt-2 inline-block rounded border border-line px-2.5 py-1 text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
            >
              去项目管理 →
            </Link>
          </div>
        )}
        {active && !mounting && projNote?.kind === 'offline' && (
          <div className="mt-2 rounded border px-2.5 py-2" style={{ borderColor: 'rgba(229,162,61,0.4)', background: 'rgba(229,162,61,0.07)' }}>
            <p className="text-[11px] font-semibold" style={{ color: '#E5A33D' }}>
              后端连不上（:3011 没起）
            </p>
            <p className="mt-1 text-[10.5px] leading-[16px] text-fgMuted">
              当前项目先照本地记录显示（{active.name ?? active.id}）；下面的内容区需要后端，拿不到会照实说。
            </p>
          </div>
        )}
        {proj && (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              <span className="font-semibold text-fg">◈ {proj.name}</span>
              <span className="mono text-fgMuted">
                {proj.source.kind === 'path' ? '本地目录' : 'https git'} · {proj.source.value}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-fgMuted">
              {proj.cache ? (
                <>
                  <span>缓存 {proj.cache.files} 文件 · {(proj.cache.bytes / 1024).toFixed(0)} KB</span>
                  <span>摄取于 {proj.cache.ingestedAt}</span>
                  <span className="mono">指纹 {proj.cache.fingerprint}</span>
                  {proj.cache.lastRefresh && <span>最近刷新 {proj.cache.lastRefresh}</span>}
                </>
              ) : (
                <span style={{ color: '#E5A33D' }}>缓存统计未记录 —— 项目可能摄取失败，回「项目管理」看详情</span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onRescan}
                disabled={stage.kind === 'scanning'}
                className="rounded border px-3 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                style={{ borderColor: 'rgba(217,164,65,0.5)', background: 'rgba(217,164,65,0.12)', color: '#D9A441' }}
              >
                {stage.kind === 'scanning' ? '扫描中…' : '重新扫描缓存'}
              </button>
              <Link
                href="/projects"
                className="rounded border border-line px-2.5 py-1 text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
              >
                切换项目 →
              </Link>
            </div>
          </>
        )}

        <p className="mt-2 text-[10px] leading-[16px] text-fgFaint">
          扫描是只读的：不执行仓库里的任何脚本 / 构建 / 测试，单文件 2MB / 总 500MB / 2 万文件 / 深度 20 / 180s 超时。
          配置文件里的 password、token 一类值在事实里一律是 <span className="mono">***</span>，结果不外发任何地方。
          侦察读的是缓存快照，不是源头现场 —— 源头变了先回「项目管理」刷新缓存，再回来重扫。
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
              {stage.offline ? '后端连不上（:3011 没起）' : `扫描被拒：${stage.code}`}
            </p>
            <p className="mt-1 text-[10.5px] leading-[16px] text-fgMuted">{stage.message}</p>
            {stage.offline && (
              <p className="mt-1 text-[10px] leading-[15px] text-fgFaint">
                起后端：<span className="mono">SKIP_COMPILE=1 bash arsenal-server/scripts/run.sh</span>
                。本页扫描与体检都要走后端读缓存，没有离线兜底。
              </p>
            )}
          </div>
        )}
        {stage.kind === 'idle' && !mounting && active && !projNote && (
          <p className="mt-2.5 text-[10.5px] leading-[16px] text-fgMuted">
            这个项目在服务端还没有扫描留档 —— 点上面「重新扫描缓存」跑第一次，之后每次进来都从服务端读回，不用重扫。
          </p>
        )}
      </div>

      {/* ── 页签：架构 / 服务拓扑 / 体检 / 历史 / 生命体征 / 活体 / 功能 ── */}
      <div className="flex flex-wrap items-center gap-1 self-start rounded border border-line p-0.5">
        {(
          [
            ['arch', '架构面板'],
            ['services', '服务拓扑'],
            ['checkup', '体检报告'],
            ['history', `历史（${serverHistory ? serverHistory.length : snapshots.length}）`],
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
                onClick={onAnalyzeCheckup}
                disabled={checkup.kind === 'running' || !proj}
                className="rounded border px-3 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45"
                style={{ borderColor: 'rgba(217,164,65,0.5)', background: 'rgba(217,164,65,0.12)', color: '#D9A441' }}
              >
                {checkup.kind === 'running' ? '体检中…' : '一键体检'}
              </button>
              <label className="flex cursor-pointer items-center gap-1.5 text-[10.5px] text-fgMuted">
                <input
                  type="checkbox"
                  checked={reuseInput}
                  onChange={(e) => setReuseInput(e.target.checked)}
                  className="accent-brass"
                />
                内容级校验通过就复用留档（<span className="mono">L1</span>，不重扫）
              </label>
              <span className="text-[10px] leading-[15px] text-fgFaint">
                对当前项目跑。P0/P1 复用同一套规则集（MUST+NEVER 判 P0、SHOULD 判 P1，
                与 /check 同一台引擎）；观察项由 <span className="mono">arsenal-checkups/checkups.json</span> 驱动 —— 判据是数据不是代码。
              </span>
            </div>

            {reusedFrom && l1?.verdict === 'match' && (
              <div
                className="mt-2.5 rounded border px-2.5 py-2"
                style={{ borderColor: 'rgba(127,166,80,0.45)', background: 'rgba(127,166,80,0.08)' }}
              >
                <p className="text-[11px] font-semibold" style={{ color: '#7FA650' }}>
                  内容级校验通过，复用 {reusedFrom} —— 这一趟没有重新扫描
                </p>
                <p className="mt-1 text-[10px] leading-[15px] text-fgMuted">
                  依据是「<span className="text-fg">{l1.detail}</span>」：体检留档盖章时的缓存指纹与
                  注册表当前指纹逐字节一致。缓存刷新过内容就不满足，会真扫。
                </p>
              </div>
            )}

            {checkup.kind === 'done' && l1 && l1.verdict !== 'match' && !reusedFrom && (
              <div
                className="mt-2.5 rounded border px-2.5 py-2"
                style={{ borderColor: 'rgba(229,162,61,0.4)', background: 'rgba(229,162,61,0.07)' }}
              >
                <p className="text-[11px] font-semibold" style={{ color: '#E5A33D' }}>
                  {l1.verdict === 'mismatch' && '缓存内容已变 —— 下面这份体检是旧结论'}
                  {l1.verdict === 'unstamped' && '留档无法做内容级校验 —— 不确定它对应哪份缓存内容'}
                  {l1.verdict === 'untrusted' && '留档指纹不可信 —— 不许拿「上次什么也没扫到」当「没变」'}
                </p>
                <p className="mt-1 text-[10.5px] leading-[16px] text-fgMuted">
                  {l1.detail}。点「一键体检」真扫一次：服务端会写新留档并盖新指纹戳，之后复用判据就有依据了。
                </p>
              </div>
            )}

            {foldedInto && (
              <p className="mt-2 text-[10.5px] leading-[16px] text-fgMuted">
                这次真扫了，结果与本地快照 <span className="mono text-fg">{foldedInto}</span>{' '}
                的输入规模指纹一致 —— <span className="text-fg">本地留档不新增一条</span>
                （服务端留档照常写，那是正主）。
              </p>
            )}

            {storeNote && (
              <p
                className="mt-2 text-[10.5px] leading-[16px]"
                style={{ color: storeNote.startsWith('这份没') ? '#E5484D' : '#93A39C' }}
              >
                {storeNote}
              </p>
            )}
            {checkup.kind === 'idle' && !mounting && (
              <p className="mt-2 text-[10.5px] text-fgMuted">
                这个项目在服务端还没有体检留档。点上面的按钮 —— 报告会明确写出「覆盖了多少条、多少条没结论」，
                不会只报一个命中数；跑完服务端落档，切菜单再回来直接读回。
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
            {checkup.kind === 'done' && checkupOrigin === 'server' && !reusedFrom && (
              <p className="mt-2 text-[10px] leading-[15px] text-fgFaint">
                本报告来自服务端留档{checkup.report.checkedAt ? `（${checkup.report.checkedAt}）` : ''} ——
                切菜单再回来会从这里读回，不靠浏览器记着。
              </p>
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
          {stage.kind === 'done' && artifacts && proj && (
            <>
          {/* ── 源头 → 缓存 → 本次结论（旧「输入 vs 实际扫描」的替代：没有输入了，
                 三段链把「报告对应哪份码」说死）── */}
          <div className="panel px-3 py-2.5">
            <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
              二、这次扫的是哪儿（源头 → 缓存 → 结论）
            </p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
              <span className="mono text-fgMuted">
                源头 <span className="text-fg">{proj.source.value}</span>
                <span className="ml-1 text-fgFaint">{proj.source.kind === 'path' ? '本地目录' : 'https git'}</span>
              </span>
              <span className="text-fgFaint">→</span>
              <span className="mono text-fgMuted">
                缓存 <span className="text-fg">摄取于 {proj.cache?.ingestedAt ?? '未记录'}</span>
                <span className="ml-1 text-fgFaint">指纹 {proj.cache?.fingerprint ?? '未记录'}</span>
              </span>
              <span className="text-fgFaint">→</span>
              <span className="mono text-fgMuted">
                本次结论 <span className="text-fg">{artifacts.facts.root}</span>
              </span>
            </div>
            <p className="mt-1 text-[10px] leading-[15px] text-fgFaint">
              侦察读的是服务器侧缓存快照，不是源头现场 —— 源头变了先回「项目管理」刷新缓存，再回来重扫。
            </p>
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
                    {mounting
                      ? '正在从服务端读这个项目的扫描留档…'
                      : active
                        ? '这个子页签要读扫描事实 —— 这个项目还没有扫描留档，点上面「重新扫描缓存」跑第一次。没扫描也能看六视图：切到「六视图」子页签，它讲内置档案。'
                        : '这个子页签要读扫描事实 —— 先到「项目管理」选一个当前项目。'}
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
                        这张图来自<span className="text-fg">项目缓存扫描</span>（{artifacts.facts.root}）——
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
                这份 JSON 可以留档 —— 服务端已按项目留了一份，这里供你带走
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
        <div className="space-y-3">
          <div className="panel px-3 py-2.5">
            <p className="mono text-[10px] uppercase tracking-wider text-fgFaint">
              服务端体检留档（正主）
            </p>
            {serverHistory === null ? (
              <p className="mt-2 text-[10.5px] leading-[16px] text-fgMuted">
                {active ? '读不到服务端体检历史 —— 后端离线或项目不存在；下面那份浏览器旧留档不受影响。' : '还没有当前项目。'}
              </p>
            ) : serverHistory.length === 0 ? (
              <p className="mt-2 text-[10.5px] leading-[16px] text-fgMuted">
                服务端还没有体检留档（0 份也是结论）—— 点「体检报告」页签的一键体检跑第一次。
              </p>
            ) : (
              <ul className="mt-2 space-y-1 text-[10.5px] leading-[16px] text-fgMuted">
                {serverHistory.map((h, i) => (
                  <li key={i} className="mono">
                    <span className="text-fg">{h.checkedAt ?? h.savedAt ?? '（无时间戳）'}</span>
                    {' · '}
                    {h.root ?? '（无扫描根）'}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-1.5 text-[10px] leading-[15px] text-fgFaint">
              ↓ 旧本地留档（浏览器侧，只读；服务端留档是正主，两份不混算）
            </p>
            <HistoryPanel
              source={proj ? { kind: proj.source.kind, value: proj.source.value } : null}
              snapshots={snapshots}
              damaged={damaged}
              diff={diff}
              onDelete={(id) => {
                if (localPid) deleteLocalSnapshot(localPid, id);
                setDiff(null);
                reloadLocal();
              }}
            />
          </div>
        </div>
      )}

      {tab === 'vitals' && (
        <VitalsPanel
          points={vitalsPoints}
          damaged={vitalsDamaged}
          onClear={() => {
            if (localPid) clearLocalVitals(localPid);
            setVitalsNote(null);
            reloadLocal();
          }}
        />
      )}
      {vitalsNote && tab === 'vitals' && (
        <p className="text-[10.5px] leading-[15px] text-fgFaint">⚠ {vitalsNote}</p>
      )}

      {tab === 'runtime' && (
        <RuntimePanel
          entries={runtimeEntries}
          stage={runtimeStage}
          run={runtimeRun}
          onRun={onRunRuntime}
        />
      )}

      {tab === 'functions' && <FunctionPanel facts={stage.kind === 'done' ? stage.facts : null} />}
    </div>
  );
}
