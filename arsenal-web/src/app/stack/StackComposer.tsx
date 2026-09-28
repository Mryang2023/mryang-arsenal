'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import CodeBlock from '@/components/CodeBlock';
import CopyButton from '@/components/CopyButton';
import {
  arch,
  auditArchitecture,
  capLabel,
  nodeArch,
  skeletonPicks,
  slotsOfLane,
  STATUS_META,
  lanes,
} from '@/lib/arch';
import type { SlotState } from '@/lib/arch';
import {
  composeStack,
  defaultBase,
  dimensionById,
  dimensions,
  emptyPicks,
  presetPicks,
  presets,
  renderConfigClassesMarkdown,
  renderOps,
  renderPrompt,
  renderYaml,
  stackScale,
} from '@/lib/stack';
import {
  buildExportPlan,
  formatBytes,
  projectDoc,
  renderAppClass,
} from '@/lib/project';
import { downloadZip } from '@/lib/zip';
import type { StackPicks } from '@/lib/content-types';
import DimDrawer from './DimDrawer';
import { Picker } from './Inspector';
import SlotBlock from './SlotBlock';
import type { SlotWeight } from './SlotBlock';
import DeliveryStep from './steps/DeliveryStep';
import BaseStep from './steps/BaseStep';
import DeliverRunStep from './steps/DeliverRunStep';
import ProjectStep from './steps/ProjectStep';
import ThemeStep from './steps/ThemeStep';
import TopologyStep from './steps/TopologyStep';
import StepShell from './steps/StepShell';
import DeployGuides from './DeployGuides';
import { SlotWire, WireLayer } from './WireLayer';
import ProgressRing from './ProgressRing';
import { useStackHistory, type StackSnapshot } from './history';
import { DRAFTS_LIMIT, loadDrafts, saveDrafts, type StackDraft } from './drafts';
import {
  clearProvenance,
  encodeSharePayload,
  loadBaseSnapshot,
  loadProvenance,
  loadSnapshot,
  parseShareHash,
  saveBaseSnapshot,
  savePicksSnapshot,
  type PicksProvenance,
} from '@/lib/picks-store';
import {
  emptyMeta,
  topologyFigures,
  withParam,
  withTopology,
  type StackPicksMeta,
} from '@/lib/topology';
import { TONE } from './palette';
import StepRail from './StepRail';
import {
  DEFAULT_PROJECT,
  STEPS,
  STEP_BY_ID,
  THEME_SECTIONS,
  RUN_SECTIONS,
  FLOWS,
  FLOW_BY_ID,
  flowFilled,
  flowOfLane,
  groupOfDim,
  isValidProjectName,
  loadProjectMeta,
  saveProjectMeta,
  stepOfDim,
  type StepId,
} from './wizard';

/**
 * 技术架构装配台 —— **七步向导、分成两段**。
 *
 * 为什么不再是一屏：原先 33 个槽位 / 7 条泳道 / 五根滑杆 / 九块预览 / 九组产物页签
 * 全部堆在同一屏上，用户进来看不到「从哪儿开始」。现在每一步只回答一个问题：
 *
 *   软件架构段：① 项目定义 → ② 技术栈基底 → ③ 主题框架 → ④ 分层装配
 *   交付运行段：⑤ 交付与运行 → ⑥ 部署形态 → ⑦ 交付
 *
 * 09-28 反馈：代码软件架构与交付运行是两类决定，混着选太乱 ——
 * 前四步只谈代码架构，运行环境 / 入口 / 编排 / CI/CD / 监控 / 密钥 / 日志
 * 集中到 ⑤ 一处表态。归属规则全部在 `wizard.ts`（RUN_GROUP_IDS / stepOfDim），
 * 本文件不另立一份。
 *
 * 仍然不变的两条老规矩：
 *   · 合成是纯函数。`composeStack(picks)` 无副作用无 IO，后端能产出同样的产物。
 *   · 「拼起来能跑吗」是这台机器的第一问题，所以三档结论条**常驻在顶部** ——
 *     它不属于任何一步，拆成向导也不能把它藏进某一屏。
 *
 * 步骤内容分别在 `steps/` 下；本文件只管三件事：状态与历史、结论条、
 * 以及 ④ 的台面与 ⑦ 的产物区（这两块是装配台的老资产，留在原处不动）。
 */

/**
 * 页签 id。**加了这里就必须在下面渲染区补一个 `tab === 'x'` 分支** ——
 * 只加 id 不加分支的后果是页签按钮在、点进去一片空白，而且没有任何东西会报错
 * （「技术架构图」就这么空了一段时间）。结构层断言守这条。
 *
 * S2-7（2026-09-24）：`tree` / `arch` / `risk` 三个页签已砍 —— 与交付预览
 * 的「目录树 / 架构图 / 隐患」功能重叠，两处各养一份渲染是双倍维护。
 * 只留文件类页签；想看那三样走 ⑥ 的交付预览。
 */
type TabId =
  | 'build' | 'yaml' | 'env'
  | 'app' | 'config' | 'code'
  | 'ops' | 'prompt' | 'deploy';

interface TabSpec {
  id: TabId;
  glyph: string;
  /** 动态标签（构建文件随选型变名字） */
  label: string;
  count?: number;
}

export default function StackComposer() {
  const [picks, setPicks] = useState<StackPicks>(() => presetPicks('standard'));
  /**
   * 技术栈基底（全局声明，**不是**选型维度）。
   *
   * 它只驱动「与基底绑定」的产物 —— pom 的 parent 版本、gradle 插件的
   * Spring Boot 版本。它不参与能力校验、不上架构图：基底是整个工程的前提，
   * 不是系统里的某个可勾选组件（做成维度会与「每维必有槽位」的图模型打架）。
   *
   * 初值与 picks 一样不读 localStorage（避免 SSR 首帧与客户端不一致），
   * 挂载后由 effect 写回。
   */
  const [baseId, setBaseId] = useState<string>(defaultBase);
  /**
   * 挂载标志 —— 存在的唯一理由是**首帧不能写盘**。
   *
   * `picks` 的初值是 standard 预设（刻意不读 localStorage，避免 SSR 首帧与
   * 客户端不一致），而写快照的 effect 在挂载后会立刻跑一次。没有这道闸门，
   * 打开页面的瞬间就会拿 standard 覆盖掉用户上次的选型，而且不报任何错。
   * 实测（2026-09-23）：塞 `{database:'postgres'}` 进 localStorage，打开 /stack
   * 再刷新，读到的是 `mysql` —— 刷新即丢失，且顺手把 /arch 正要读的快照也改了。
   */
  const [hydrated, setHydrated] = useState(false);
  /**
   * 选型出处：这套选型是从哪来的。只有「代码扫描」一种来源需要落盘，
   * 手工拼装没有出处可言。装配台是**唯一**消费它的地方 ——
   * 只写不读的键（例如 `arsenal-stack-detail-v1`）等于白写，别再加一个。
   */
  const [provenance, setProvenance] = useState<PicksProvenance | null>(null);
  /**
   * 集群形态与参数。与 `picks` **平行**的一条通道 ——
   * 选型回答「装哪块零件」，形态回答「装几个、怎么摆」。
   * 两者一起被持久化、一起进产物：清单里的副本数、架构图上的叠层、
   * 形态图的框数全部来自这里，没有第二处写死的数字。
   */
  const [meta, setMeta] = useState<StackPicksMeta>(() => emptyMeta());
  /** 形态（= 事实源 preset id）。null = 自定义组合，不高亮任何形态卡 */
  const [presetId, setPresetId] = useState<string | null>('standard');
  const [activeDim, setActiveDim] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('build');
  /**
   * 「点亮请求链路」开关（S1-4）。默认关 —— 动效是给「想看请求怎么穿」的人
   * 的放大镜，不是常驻装饰；关闭时连线退回 treeLine 静态实线，零动效。
   */
  const [flowOn, setFlowOn] = useState(false);
  /** 外部请求交付预览切到的页签（S2-7：「看架构图」入口）；消费后回 null */
  const [deckFocus, setDeckFocus] = useState<'arch' | null>(null);
  const [showArtifacts, setShowArtifacts] = useState(true);
  const [exported, setExported] = useState<{ name: string; bytes: number; files: number } | null>(
    null
  );
  // ── ① 的项目定义 ──
  const [step, setStep] = useState<StepId>(DEFAULT_PROJECT.step);
  const [projectName, setProjectName] = useState<string>(DEFAULT_PROJECT.name);
  // ── ④ 流水线选择：默认「全部流水线」七泳道一屏纵览（09-28 四反馈：全部都展示，
  //    不先选流再看）；要聚焦某条流时随时切回单流视图 ──
  const [benchFlow, setBenchFlow] = useState<string>('all');
  // ── ⑥ 交付双版面：交付预览（九块实时预览）与组合产物（文件页签 + 导出）分屏 ──
  const [deliveryView, setDeliveryView] = useState<'preview' | 'products'>('preview');
  // ── S2-4：搜索 + 三档筛选（互斥单选，再点一次取消；与搜索词取交集） ──
  const [query, setQuery] = useState('');
  const [dimFilter, setDimFilter] = useState<'unpicked' | 'hazard' | 'required' | null>(null);
  // ── S2-2：按推荐补齐的回执 —— 补了哪几块，可一步撤销 ──
  const [fillNote, setFillNote] = useState<{ dimName: string; optName: string }[] | null>(null);
  // ── S2-6：方案草稿（localStorage arsenal-stack-drafts-v1，读写在 drafts.ts）──
  const [drafts, setDrafts] = useState<StackDraft[]>([]);
  const [showDraftSave, setShowDraftSave] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [showDraftList, setShowDraftList] = useState(false);
  const [diffDraftId, setDiffDraftId] = useState<string | null>(null);
  // ── S3-3：分享链接（复制反馈 + 剪贴板不可用时的降级展示行）──
  const [copied, setCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  // ── 撤销 / 重做（S2-3）────────────────────────────────────
  // 快照在「写入前」记录；snapRef 每次提交后同步，保证事件回调里拿到的是最新状态
  const hist = useStackHistory();
  const snapRef = useRef<StackSnapshot>({ picks, meta, baseId });
  useEffect(() => {
    snapRef.current = { picks, meta, baseId };
  });

  /** 把历史快照放回三个 state。形态高亮与导出产物随之作废 */
  function restore(s: StackSnapshot) {
    setPicks(s.picks);
    setMeta(s.meta);
    setBaseId(s.baseId);
    setPresetId(null);
    setExported(null);
  }

  function undo() {
    const s = hist.undo(snapRef.current);
    if (s) restore(s);
  }

  function redo() {
    const s = hist.redo(snapRef.current);
    if (s) restore(s);
  }

  // Ctrl/Cmd+Z 撤销、Ctrl/Cmd+Shift+Z（及 Ctrl+Y）重做。
  // 文本输入框里不拦 —— 那是浏览器原生编辑语义，归输入框自己；下拉框没有文本编辑，不豁免。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key !== 'z' && e.key !== 'Z' && e.key !== 'y' && e.key !== 'Y') return;
      const t = e.target as HTMLElement | null;
      const typing =
        t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable === true;
      if (typing) return;
      e.preventDefault();
      if (e.shiftKey || e.key.toLowerCase() === 'y') redo();
      else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // S2-5：Esc 关闭当前打开的层。优先级：换件菜单 > 草稿面板 > 选件面板。
  // 换件菜单自己挂了 window keydown —— 两处监听都会跑，这里用 DOM 探测让位：
  // 菜单还在 DOM 里（data-swap-menu）就什么都不做，只让菜单自己的 handler 关它。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[data-swap-menu]')) return;
      if (showDraftSave || showDraftList) {
        setShowDraftSave(false);
        setShowDraftList(false);
        return;
      }
      if (activeDim) setActiveDim(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showDraftSave, showDraftList, activeDim]);

  // ── S2-6：草稿存取 ──
  /** 打开保存行。默认名 = 现有草稿数 + 1，可改 */
  function openDraftSave() {
    const list = loadDrafts();
    setDrafts(list);
    setDraftName(`方案 ${list.length + 1}`);
    setShowDraftList(false);
    setShowDraftSave(true);
  }

  function doSaveDraft() {
    const name = draftName.trim() || `方案 ${drafts.length + 1}`;
    const draft: StackDraft = {
      id: `d${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      savedAt: new Date().toISOString(),
      picks,
      meta,
      baseId,
    };
    setDrafts(saveDrafts([draft, ...drafts]));
    setShowDraftSave(false);
  }

  function openDraftList() {
    setDrafts(loadDrafts());
    setShowDraftSave(false);
    setShowDraftList((v) => !v);
  }

  function doDeleteDraft(id: string) {
    const next = drafts.filter((d) => d.id !== id);
    setDrafts(saveDrafts(next));
    if (diffDraftId === id) setDiffDraftId(null);
  }

  /**
   * S3-3 分享：三通道快照编码进 #s=，复制到剪贴板。剪贴板不可用
   * （file:// / 隐私模式 / 权限被拒）不静默 —— 降级成可全选复制的输入行，
   * 链接还是能手工拿走。
   */
  function doShare() {
    const url = `${window.location.origin}${window.location.pathname}${
      window.location.search
    }#s=${encodeSharePayload({ picks, meta, baseId })}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(url)
        .then(() => {
          setShareUrl(null);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        })
        .catch(() => setShareUrl(url));
    } else {
      setShareUrl(url);
    }
  }

  /** 当前选用的对比草稿 */
  const diffDraft = useMemo(
    () => (diffDraftId ? drafts.find((d) => d.id === diffDraftId) ?? null : null),
    [drafts, diffDraftId]
  );

  /**
   * 选型差异集（S2-6）：只比「维度 → 选项」这一层；基底不同在标题里提示一句。
   * 形态/参数的差异不进 chip —— 对比回答的是「搭的是不是同一套房子」，
   * 不是「同一栋房子里家具摆得一样不一样」。
   */
  const diffDims = useMemo(() => {
    if (!diffDraft) return [];
    return dimensions.filter((d) => (picks[d.id] ?? '') !== (diffDraft.picks[d.id] ?? ''));
  }, [diffDraft, picks]);

  /**
   * 点阵点击直达。**先切到槽位所在的步骤再聚焦** ——
   * 结论条上的点阵是常驻的，交付件配在 ⑤ 交付与运行（台面上没有交付泳道的
   * 格子，硬切 ④ 就是「点了没反应」—— 09-28 反馈的最初形态），其余在 ④ 台面。
   */
  function focusDim(dimId: string) {
    const target = stepOfDim(dimId) ?? 'layers';
    setStep(target);
    setActiveDim(dimId);
    // 单流才切流对准（09-28 反馈）
    const flow = benchFlow === 'all' ? null : flowOfLane(nodeArch[dimId]?.lane ?? '');
    if (flow) setBenchFlow(flow.id);
    requestAnimationFrame(() => {
      benchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  /**
   * 挂载时恢复上次的选型 / 形态 / 基底 / 出处 / 项目名与步骤。
   *
   * **声明顺序是这个 effect 的全部要害**：它必须排在下面几个写入 effect 之前。
   * 挂载时 effect 按声明顺序执行，那一刻 `hydrated` 还是 false，写入 effect 直接
   * 返回；等这次 setState 引发重渲染、`hydrated` 翻成 true，写入 effect 才带着
   * 恢复出来的值跑一遍。顺序摆反（写入在前），恢复出来的值会被首帧的 standard
   * 盖掉 —— 现象与「压根没做恢复」一模一样，而那正是修之前的样子。
   *
   * 恢复出来若正好等于某个预设，就把该形态卡点亮；是自定义组合则不高亮任何形态。
   */
  useEffect(() => {
    const pm = loadProjectMeta();
    setProjectName(pm.name);
    setStep(pm.step);
    // S3-3：分享链接**优先于 localStorage** —— 带 #s= 的 URL 以链接里的组合为准。
    // hash 是一次性引子：恢复后立刻从地址栏抹掉，之后用户改选型、刷新，回到的
    // 是新的当前态（写入 effect 会把它落进 localStorage），而不是过期的分享态。
    const shared = parseShareHash(window.location.hash);
    if (shared) {
      setPicks(shared.picks);
      setMeta(shared.meta);
      setBaseId(shared.baseId);
      setProvenance(null);
      const sharedMatched = presets.find((p) =>
        dimensions.every((d) => (shared.picks[d.id] ?? '') === (p.picks[d.id] ?? ''))
      );
      setPresetId(sharedMatched ? sharedMatched.id : null);
      // 别人发来的链接，打开就该看到结果 —— 落在 ⑦ 交付，而不是让他从 ① 重走一遍
      setStep('delivery');
      setHydrated(true);
      history.replaceState(null, '', window.location.pathname + window.location.search);
      return;
    }
    const snap = loadSnapshot();
    setPicks(snap.picks);
    setMeta(snap.meta);
    setBaseId(loadBaseSnapshot());
    setProvenance(loadProvenance());
    const matched = presets.find((p) =>
      dimensions.every((d) => (snap.picks[d.id] ?? '') === (p.picks[d.id] ?? ''))
    );
    setPresetId(matched ? matched.id : null);
    setHydrated(true);
  }, []);

  /**
   * 选型快照写回 localStorage —— 「架构图谱」页的技术架构视图从这里取数。
   *
   * 少了这一句，那边 loadPicksSnapshot() 永远读不到东西、静默回落到 standard
   * 预设：装配台换一套选型，架构图谱那张图纹丝不动，而且两边都不报错。
   * 这是一条跨页契约：装配台写，TechArch 与 ArchifyLab 读。
   */
  useEffect(() => {
    if (!hydrated) return;
    savePicksSnapshot(picks, meta);
  }, [picks, meta, hydrated]);

  // 基底单独持久化（与选型/形态分键，理由同 picks-store 顶部的说明）
  useEffect(() => {
    if (!hydrated) return;
    saveBaseSnapshot(baseId);
  }, [baseId, hydrated]);

  // 项目名与所处步骤单独持久化：它们是「这个项目是谁 / 走到哪了」通道，
  // 换一套选型不该把它们冲掉（读写成对，不留只写的死键）。
  useEffect(() => {
    if (!hydrated) return;
    saveProjectMeta({ name: projectName, step });
  }, [projectName, step, hydrated]);

  const audit = useMemo(() => auditArchitecture(picks), [picks]);
  const composed = useMemo(() => composeStack(picks), [picks]);
  const scale = useMemo(() => stackScale(composed), [composed]);
  const plan = useMemo(
    () => buildExportPlan(picks, audit, baseId, projectName),
    [picks, audit, baseId, projectName]
  );

  const yamlText = useMemo(() => renderYaml(composed, projectName), [composed, projectName]);
  const promptText = useMemo(() => renderPrompt(composed), [composed]);
  const configMd = useMemo(() => renderConfigClassesMarkdown(composed), [composed]);
  const appCode = useMemo(() => renderAppClass(picks), [picks]);
  // treeText / riskMd 随 S2-7 砍页签一并撤下：目录树与隐患单的唯一消费方
  // 是交付预览，底部不再各养一份复制按钮。
  const ops = useMemo(() => renderOps(composed), [composed]);

  /** 槽位 → 它参与的组合隐患标题。「有隐患」三个字没有用，得说清是什么。 */
  const hazardsByDim = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const g of [...audit.blockers, ...audit.risks, ...audit.notes]) {
      for (const n of g.nodes) {
        if (!map[n]) map[n] = [];
        if (!map[n].includes(g.title)) map[n].push(g.title);
      }
    }
    return map;
  }, [audit]);

  /**
   * 点阵的问题标记 + 问题格索引（09-28 反馈：33 格里看不出哪格坏了、坏在哪步）。
   * need = 这一格在要一块没人给的能力（或必选未装）；remedy = 这一格能补上缺口。
   * optionId = 补法推荐直接选的零件 —— 步骤页面上给那个选项描绿框，不用二次查找。
   */
  const issueDots = useMemo(() => {
    const list: { dim: string; label: string; detail?: string; kind: 'need' | 'remedy'; optionId?: string }[] = [];
    const has = (dim: string, kind: string) =>
      list.some((x) => x.dim === dim && x.kind === kind);
    for (const b of audit.blockers) {
      if (b.unmetCap) {
        const cap = capLabel(b.unmetCap);
        for (const n of b.nodes) {
          if (!has(n, 'need')) list.push({ dim: n, label: `要「${cap}」`, kind: 'need' });
        }
        for (const r of b.remedies ?? []) {
          if (!has(r.dim, 'remedy')) {
            // 关联要说破（09-28 五反馈）：绿框推荐不是凭空来的 —— 是谁在要这块能力
            const needers = b.nodes.map((n) => dimensionById.get(n)?.name ?? n).join('、');
            list.push({
              dim: r.dim,
              label: `可补「${cap}」`,
              detail: `${needers} 在要「${cap}」，这里选对零件即可补上`,
              kind: 'remedy',
              optionId: r.option,
            });
          }
        }
      } else if (!has(b.dim, 'need')) {
        const recommended = recommendedOptionFor(b.dim);
        list.push({
          dim: b.dim,
          label: '必选未装 —— 跑不起来',
          kind: 'need',
          optionId: recommended?.id,
        });
      }
    }
    return list;
  }, [audit]);

  /**
   * 槽位级问题标记（②③⑤⑥ 的模块卡红/绿框 + ③ 导航红点共用这一份）。
   * 同一格 both need 与 remedy 时 need 优先 —— 先说哪儿坏了，再说去哪补。
   */
  const dimFlags = useMemo(() => {
    const map: Record<string, { kind: 'need' | 'remedy'; label: string; detail?: string; optionId?: string }> = {};
    for (const x of issueDots) {
      const prev = map[x.dim];
      if (!prev || (prev.kind === 'remedy' && x.kind === 'need')) {
        map[x.dim] = { kind: x.kind, label: x.label, detail: x.detail, optionId: x.optionId };
      }
    }
    return map;
  }, [issueDots]);

  /** 点阵格描边（need 红 / remedy 橄榄绿）—— 从同一份 issueDots 派生 */
  const dotFlags = useMemo(() => {
    const map: Record<string, 'need' | 'remedy'> = {};
    for (const x of issueDots) if (!map[x.dim] || map[x.dim] === 'remedy') map[x.dim] = x.kind;
    return map;
  }, [issueDots]);

  /** 步骤条的问题角标：这一步要表态的槽位里，有几个卷进了「跑不起来」 */
  const stepIssues = useMemo(() => {
    const map: Partial<Record<StepId, string[]>> = {};
    const push = (s: StepId, t: string) => {
      const list = map[s] ?? (map[s] = []);
      if (!list.includes(t)) list.push(t);
    };
    for (const b of audit.blockers) {
      for (const n of b.nodes) {
        const s = stepOfDim(n);
        if (s) push(s, b.title);
      }
      // 补法所在步骤也标 —— 「去 ⑤ 补」本身就是那一步的待办
      if (b.unmetCap) {
        for (const r of b.remedies ?? []) {
          const s = stepOfDim(r.dim);
          if (s) {
            const dimName = dimensions.find((d) => d.id === r.dim)?.name ?? r.dim;
            push(s, `补「${capLabel(b.unmetCap)}」→ ${dimName}`);
          }
        }
      }
    }
    return map;
  }, [audit]);

  // 同上：`meta` 已是形态/参数的 useState，状态文案改名 `statusMeta`，
  // 否则同名重复声明，编译不过。
  const statusMeta = STATUS_META[audit.status];
  const tone = TONE[
    statusMeta.tone === 'bad' ? 'bad' : statusMeta.tone === 'warn' ? 'warn' : 'ok'
  ];

  /**
   * S2-4：搜索 / 筛选的命中集合。null = 未启用（全部卡片正常显示）。
   *
   * 非空时**不在集合里的卡片降透明度（muted 0.28），不从台面上移除** ——
   * 聚光灯而不是搬家：搬家会让泳道里只剩几张卡、失去「哪类零件在哪条泳道」
   * 的空间记忆；聚光灯既看清命中，又保留方位。搜索词与筛选档取交集。
   */
  const visibleDims = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q && dimFilter === null) return null;
    const hits = new Set<string>();
    for (const d of dimensions) {
      if (q) {
        const cur = picks[d.id] ? (findOption(d.id, picks[d.id])?.name ?? '') : '';
        const hay = `${d.name} ${nodeArch[d.id]?.role ?? ''} ${cur}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      if (dimFilter === 'unpicked' && (picks[d.id] ?? '') !== '') continue;
      if (dimFilter === 'hazard' && !(hazardsByDim[d.id]?.length)) continue;
      if (dimFilter === 'required' && !nodeArch[d.id]?.required) continue;
      hits.add(d.id);
    }
    return hits;
    // findOption 是模块级函数声明（提升），不进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, dimFilter, picks, hazardsByDim]);

  const hazardCount = audit.blockers.length + audit.risks.length + audit.notes.length;
  const buildLabel = picks.build === 'gradle' ? 'build.gradle' : 'pom.xml';

  // S2-7：产物区只留文件类页签。目录树 / 架构图 / 隐患单在 ⑦ 交付预览
  // 有完整得多的版本（九块实时预览 vs 一份静态渲染），两处各养一份
  // 渲染分支是双倍维护 + 「两边数据对不上」的隐患源。
  const TAB_GROUPS: { group: string; tabs: TabSpec[] }[] = [
    {
      group: '构建与配置',
      tabs: [
        { id: 'build', glyph: '◇', label: buildLabel },
        { id: 'yaml', glyph: '▤', label: 'application.yml' },
        { id: 'env', glyph: '⊘', label: '.gitignore' },
      ],
    },
    {
      group: 'Java 源码',
      tabs: [
        { id: 'app', glyph: '⬡', label: 'Application.java' },
        { id: 'config', glyph: '⚒', label: '配置类', count: composed.configClasses.length },
        { id: 'code', glyph: '⇄', label: '联动代码', count: composed.samples.length },
      ],
    },
    {
      group: '交付',
      tabs: [
        { id: 'ops', glyph: '▥', label: '运维清单' },
        { id: 'prompt', glyph: '⎘', label: '给 AI 的约束' },
      ],
    },
    {
      group: '部署',
      tabs: [{ id: 'deploy', glyph: '⚙', label: '部署指引' }],
    },
  ];

  function applyPicks(next: StackPicks, preset: string | null) {
    hist.record(snapRef.current);
    setPicks(next);
    // 换形态 = 换一整套发言。形态与参数是上一套留下的发言，必须一起清掉 ——
    // 否则「切到最小骨架」之后，K8s 清单里还写着上一套的 5 副本。
    setMeta(emptyMeta());
    setPresetId(preset);
    setExported(null);
    // 选型变了，补齐回执就是过期信息（里面列的块可能已被换掉）
    setFillNote(null);
    // 出处同理：换了一整套选型，上一套的出处就不代表现在这套了。
    // 留着它会在界面上写出「来自代码扫描」而实际选型已经全换的错话。
    clearProvenance();
    setProvenance(null);
  }

  function pick(dimId: string, optId: string) {
    hist.record(snapRef.current);
    setPicks((p) => ({ ...p, [dimId]: optId }));
    setPresetId(null);
    setExported(null);
    setFillNote(null);
  }

  function clear(dimId: string) {
    hist.record(snapRef.current);
    setPicks((p) => ({ ...p, [dimId]: '' }));
    setPresetId(null);
    setActiveDim(dimId);
    setExported(null);
    setFillNote(null);
  }

  /** 换集群形态。只写 meta，不碰 picks —— 形态不是「选项」的一部分 */
  function pickTopology(dimId: string, modeId: string) {
    hist.record(snapRef.current);
    setMeta((m) => withTopology(m, dimId, modeId));
    setPresetId(null);
    setExported(null);
  }

  /** 滑杆。五条参数写进 meta.params，产物侧一律从 `paramValue()` 读。
   *  同一条滑杆的连续拖动用 tag 合并成一步 —— 20 步栈不 serve 拖动噪音 */
  function setParam(key: string, value: number) {
    hist.record(snapRef.current, `param:${key}`);
    setMeta((m) => withParam(m, key, value));
    setPresetId(null);
    setExported(null);
  }

  /** ① 里选形态：形态只给起点，之后每一格都能改 */
  function applyShape(preset: string | null) {
    if (!preset) {
      applyPicks(emptyPicks(), null);
      return;
    }
    applyPicks(presetPicks(preset), preset);
  }

  /**
   * S2-2：一键补齐 —— 只补「必选未装」（slotStates 的 missing-required），
   * 建议件与可选件不动（那是用户的设计决策，不是缺陷）。
   * 推荐档出处是事实源的 defaultOption；整次补齐**一个写入口、一步历史** ——
   * 「撤销」一下就回到补齐前，而不是逐块撤 N 次。
   */
  function fillRecommended() {
    const next = { ...picks };
    const filled: { dimName: string; optName: string }[] = [];
    for (const d of dimensions) {
      if (audit.slotStates[d.id] === 'missing-required') {
        const opt = recommendedOptionFor(d.id);
        if (opt) {
          next[d.id] = opt.id;
          filled.push({ dimName: d.name, optName: opt.name });
        }
      }
    }
    if (filled.length === 0) return;
    hist.record(snapRef.current);
    setPicks(next);
    setPresetId(null);
    setExported(null);
    setFillNote(filled);
  }

  const productsRef = useRef<HTMLElement | null>(null);
  const deckRef = useRef<HTMLDivElement | null>(null);
  const benchRef = useRef<HTMLDivElement | null>(null);

  /**
   * 「看架构图」：跳到 ⑦ 交付并点亮交付预览的架构图页签。
   *
   * 必须**先给信号再滚**，顺序反了会滚到一个还没长出图来的位置；
   * 同理必须先切步骤 —— 否则滚的是当前这一屏，图在下一屏。
   */
  function focusArch() {
    setStep('delivery');
    setDeliveryView('preview');
    setDeckFocus('arch');
    requestAnimationFrame(() => {
      deckRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function handleExport() {
    const name = `${projectName || projectDoc.artifactId}-${plan.kind}.zip`;
    const bytes = downloadZip(
      plan.files.map((f) => ({ path: f.path, content: f.content })),
      name
    );
    setExported({ name, bytes, files: plan.files.length });
  }

  const missingRequired = audit.stats.requiredTotal - audit.stats.requiredFilled;

  // ── 步骤条的进度短标签 ──────────────────────────────────────
  const themeTotal = THEME_SECTIONS.reduce((n, s) => n + s.dims.length, 0);
  const themeFilled = THEME_SECTIONS.reduce(
    (n, s) => n + s.dims.filter((d) => picks[d.id]).length,
    0
  );
  const runTotal = RUN_SECTIONS.reduce((n, s) => n + s.dims.length, 0);
  const runFilled = RUN_SECTIONS.reduce(
    (n, s) => n + s.dims.filter((d) => picks[d.id]).length,
    0
  );
  const topologyCount = topologyFigures(picks, meta).length;

  const stepSummary: Record<StepId, string> = {
    project: projectName || '未命名',
    base: picks.build === 'gradle' ? 'Gradle' : 'Maven',
    theme: `${themeFilled}/${themeTotal}`,
    layers: `${audit.stats.filled}/${dimensions.length}`,
    deliverRun: `${runFilled}/${runTotal}`,
    topology: topologyCount > 0 ? `${topologyCount} 项` : '未表态',
    delivery: `${plan.files.length} 文件`,
  };

  const nameOk = isValidProjectName(projectName.trim());

  /** 各步骤的渲染内容 */
  function renderStep() {
    switch (step) {
      case 'project':
        return (
          <ProjectStep
            name={projectName}
            onName={setProjectName}
            shapeId={presetId ?? ''}
            onShape={applyShape}
            dimTotal={dimensions.length}
          />
        );
      case 'base':
        return (
          <BaseStep
            baseId={baseId}
            onBase={(id) => {
              hist.record(snapRef.current);
              setBaseId(id);
            }}
            picks={picks}
            dimFlags={dimFlags}
            onPick={pick}
            onClear={clear}
          />
        );
      case 'theme':
        return <ThemeStep picks={picks} dimFlags={dimFlags} onPick={pick} onClear={clear} />;
      case 'layers':
        return renderBench();
      case 'deliverRun':
        return <DeliverRunStep picks={picks} dimFlags={dimFlags} onPick={pick} onClear={clear} />;
      case 'topology':
        return (
          <TopologyStep
            picks={picks}
            meta={meta}
            dimFlags={dimFlags}
            onTopology={pickTopology}
            onParam={setParam}
            onPick={pick}
            onClear={clear}
          />
        );
      case 'delivery':
        return deliveryView === 'preview' ? (
          <div ref={deckRef} className="space-y-4">
            <DeliveryStep
              picks={picks}
              meta={meta}
              audit={audit}
              composed={composed}
              baseId={baseId}
              onParam={setParam}
              focusTab={deckFocus}
              onFocusConsumed={() => setDeckFocus(null)}
            />
          </div>
        ) : null;
      default:
        return null;
    }
  }

  return (
    <div className="space-y-4">
      {/* 页面级主标题：装配台是画布式界面，视觉上没有传统页头，
          所以用 sr-only 给屏幕阅读器与文档大纲留一个唯一的 h1（视觉零变化）。 */}
      <h1 className="sr-only">架构装配台</h1>
      {/* ── 顶部：这套组合能不能跑（S1-5 闭环仪表） ──────────────
          三档结论不属于任何一步 —— 拆成向导后它必须仍然常驻，
          否则「拼起来能跑吗」这个第一问题就被藏进了某一屏。 */}
      <div
        className="panel flex flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3.5"
        style={{ borderColor: tone.border, background: tone.soft }}
      >
        {/* 必选覆盖率环：三档结论（✓ 能跑 / ! 零件不全 / × 跑不起来）的量化面。
            tone 与三档同源 —— ring 的颜色就是结论的颜色，不另设一套。 */}
        <ProgressRing
          ratio={audit.stats.requiredTotal > 0 ? audit.stats.requiredFilled / audit.stats.requiredTotal : 0}
          tone={tone.color}
          size={44}
        />
        <div className="flex min-w-0 items-center gap-3">
          <span
            className="mono flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[14px] leading-none"
            style={{ background: tone.soft, color: tone.color, border: `1px solid ${tone.border}` }}
          >
            {audit.status === 'runnable' ? '✓' : audit.status === 'incomplete' ? '!' : '×'}
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold leading-tight" style={{ color: tone.color }}>
              {statusMeta.label}
            </p>
            <p className="mt-1 text-2xs leading-relaxed text-fgMuted">
              {audit.status === 'broken' ? (
                <>
                  缺 <span style={{ color: '#E5484D' }}>{missingRequired}</span> 个必需模块
                  {audit.blockers.length - missingRequired > 0 && (
                    <>
                      ，另有{' '}
                      <span style={{ color: '#E5484D' }}>
                        {audit.blockers.length - missingRequired}
                      </span>{' '}
                      处能力没人提供
                    </>
                  )}
                  —— 这样的组合启动就会失败。
                </>
              ) : (
                <>
                  {statusMeta.summary}
                  {hazardCount > 0 && (
                    <>
                      　其中{' '}
                      <span style={{ color: '#D9A441' }}>{hazardCount}</span> 条隐患已写明触发条件与现象。
                    </>
                  )}
                </>
              )}
            </p>
          </div>
          {/* S2-2：一键补齐入口 —— 只在缺必需模块时出现。放结论条里是因为
              「哪里坏了」和「怎么修」必须出现在同一个视线里，跳走就断了。 */}
          {missingRequired > 0 && (
            <button
              type="button"
              onClick={fillRecommended}
              data-fill-cta=""
              className="shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors"
              style={{
                borderColor: 'rgba(217,164,65,0.6)',
                background: 'rgba(217,164,65,0.12)',
                color: '#D9A441',
              }}
              title="把缺的必需模块按事实源推荐档补上；补了哪几块会列出来，一步可撤销"
            >
              按推荐补齐
            </button>
          )}
        </div>

        {/* 33 格点阵（S1-5）：每个格子 = 一个槽位 = dimensions 里的一维，
            颜色与卡片同规则（filled 绿 / conflict 黄 / missing-required 红虚线 /
            其余灰）。格子太小说明不了问题，所以带 title 与点击直达 ——
            它是结论的「哪儿不对」索引，不是装饰条。 */}
        <SlotDotMatrix
          slotStates={audit.slotStates}
          activeDim={activeDim}
          flags={dotFlags}
          issueItems={issueDots}
          onSelect={focusDim}
        />

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {/* 撤销 / 重做（S2-3）：数字是栈深；滑杆连续拖动合并为一步。
              回退到底后按钮禁用，不提供假按钮 */}
          <button
            type="button"
            onClick={undo}
            disabled={hist.undoSteps === 0}
            title="撤销 (Ctrl+Z)"
            className="mono flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={{ borderColor: '#243029', color: hist.undoSteps > 0 ? '#93A39C' : '#5E6E67' }}
          >
            ↶ {hist.undoSteps}
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={hist.redoSteps === 0}
            title="重做 (Ctrl+Shift+Z)"
            className="mono flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            style={{ borderColor: '#243029', color: hist.redoSteps > 0 ? '#93A39C' : '#5E6E67' }}
          >
            ↷ {hist.redoSteps}
          </button>
          {/* 方案草稿（S2-6）：存当前组合 → 跟任意一份草稿比差异。
              键 arsenal-stack-drafts-v1 读写都在 drafts.ts，读方就在这里 ——
              只写不读的键不许存在（硬约定）。 */}
          <button
            type="button"
            onClick={openDraftSave}
            data-draft-cta=""
            title="把当前这套选型 + 形态 + 基底存成命名草稿"
            className="rounded-md border px-2 py-1 text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
          >
            存草稿
          </button>
          <button
            type="button"
            onClick={openDraftList}
            data-draft-list-cta=""
            aria-expanded={showDraftList}
            title="选一份已存的草稿，逐维度比差异"
            className="rounded-md border px-2 py-1 text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
          >
            对比
          </button>
          <button
            type="button"
            onClick={doShare}
            data-share-cta=""
            title="把当前选型 + 形态 + 基底编码进链接（#s=…），发给谁都能一键还原"
            className="rounded-md border px-2 py-1 text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
          >
            {copied ? '已复制' : '分享'}
          </button>
          <span className="mx-1 h-[16px] w-px bg-line" />
          <button
            type="button"
            onClick={focusArch}
            className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors"
            style={{
              borderColor: 'rgba(217,164,65,0.6)',
              background: 'rgba(217,164,65,0.12)',
              color: '#D9A441',
            }}
            title="把这套组合画成架构图：缺什么、请求怎么穿过、哪块有隐患，一眼看到；可下载 SVG / PNG 或复制 D2 / Mermaid 源码"
          >
            <span className="mono text-[12px] leading-none">⊞</span>
            看架构图
          </button>
          <Link
            href="/arch"
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
            title="六大架构图谱：业务 / 数据 / 应用 / 技术 / 产品 / 项目"
          >
            <span className="mono text-[12px] leading-none">▣</span>
            六大架构
          </Link>
        </div>

        {/* S2-2 补齐回执：补了哪几块逐个列出（可核对），撤销一步回到补齐前。
            面板是 flex-wrap，w-full 让它独占第二行。任何后续选型改动都会清掉它。 */}
        {fillNote && fillNote.length > 0 && (
          <div
            data-fill-note=""
            className="flex w-full flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line pt-2.5"
          >
            <span className="mono text-[11px] leading-none" style={{ color: '#7FA650' }}>
              ✓
            </span>
            <p className="min-w-0 flex-1 text-2xs text-fgMuted">
              已按推荐补齐 <span className="mono text-fg">{fillNote.length}</span> 块：
              {fillNote.map((f) => `${f.dimName}=${f.optName}`).join(' · ')}
            </p>
            <button
              type="button"
              onClick={undo}
              className="mono shrink-0 text-[10px] text-fgFaint transition-colors hover:text-fg"
              title="撤销本次补齐（等价 Ctrl+Z，一步回退）"
            >
              撤销补齐
            </button>
            <button
              type="button"
              onClick={() => setFillNote(null)}
              className="mono shrink-0 text-[10px] text-fgFaint transition-colors hover:text-fg"
            >
              知道了
            </button>
          </div>
        )}

        {/* S2-6 保存行：命名 + 确认。inline 展开而不是弹窗 —— 草稿是顺手动作，
            弹窗会把「存一下」变成一个任务。 */}
        {showDraftSave && (
          <div
            data-draft-save=""
            className="flex w-full flex-wrap items-center gap-2 border-t border-line pt-2.5"
          >
            <span className="mono text-[10px] uppercase tracking-wider text-fgFaint">存草稿</span>
            <input
              data-draft-name=""
              type="text"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') doSaveDraft();
              }}
              maxLength={24}
              placeholder="给这套方案起个名"
              aria-label="草稿名称"
              autoFocus
              className="w-[180px] min-w-0 rounded-md border px-2 py-1 text-[11px] outline-none transition-colors placeholder:text-fgFaint focus:border-brass"
              style={{ borderColor: '#243029', background: 'transparent', color: '#CFDCD6' }}
            />
            <button
              type="button"
              onClick={doSaveDraft}
              className="rounded-md border px-2 py-1 text-[11px] font-medium transition-colors"
              style={{
                borderColor: 'rgba(127,166,80,0.6)',
                background: 'rgba(127,166,80,0.12)',
                color: '#7FA650',
              }}
            >
              保存
            </button>
            <button
              type="button"
              onClick={() => setShowDraftSave(false)}
              className="mono text-[10px] text-fgFaint transition-colors hover:text-fg"
            >
              取消
            </button>
            <span className="mono text-[10px] text-fgFaint">
              已存 {drafts.length}/{DRAFTS_LIMIT} 份，超出挤掉最旧
            </span>
          </div>
        )}

        {/* S2-6 草稿列表：选一份来比，或删掉不要的。 */}
        {showDraftList && (
          <div
            data-draft-list=""
            className="w-full border-t border-line pt-2.5"
          >
            <div className="flex items-baseline gap-2">
              <span className="mono text-[10px] uppercase tracking-wider text-fgFaint">对比</span>
              <span className="text-[10px] text-fgFaint">选一份草稿，逐维度比差异</span>
            </div>
            {drafts.length === 0 ? (
              <p className="mt-1.5 text-2xs text-fgFaint">
                还没有草稿 —— 点「存草稿」把当前这套存下来。
              </p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {drafts.map((d) => (
                  <li key={d.id} className="flex items-center gap-2">
                    <button
                      type="button"
                      data-draft-item=""
                      onClick={() => {
                        setDiffDraftId(d.id);
                        setShowDraftList(false);
                      }}
                      className="min-w-0 flex-1 truncate rounded-md border border-line px-2 py-1 text-left text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
                      title={`与当前组合比差异（存于 ${d.savedAt.slice(0, 10)}）`}
                    >
                      {d.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => doDeleteDraft(d.id)}
                      aria-label={`删除草稿 ${d.name}`}
                      className="mono shrink-0 rounded-md border border-line px-1.5 py-1 text-[10px] text-fgFaint transition-colors hover:border-lineHi hover:text-fg"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* S2-6 差异条：与草稿逐维度比。chip = 差异维度，点了直达那个槽位；
            title 里写「当前 → 草稿」两边各是什么，chip 本身保持一行短词。
            选型完全一致时明说「一致」，不渲染空 chip 列表。 */}
        {diffDraft && (
          <div
            data-diff-bar=""
            className="flex w-full flex-wrap items-center gap-1.5 border-t border-line pt-2.5"
          >
            <span className="mono text-[10px] uppercase tracking-wider text-fgFaint">对比</span>
            <p className="min-w-0 shrink-0 text-2xs text-fgMuted">
              与「{diffDraft.name}」差{' '}
              <span className="mono text-fg">{diffDims.length}</span> 处
              {diffDraft.baseId !== baseId ? '（基底也不同）' : ''}：
            </p>
            {diffDims.length === 0 ? (
              <span className="text-2xs text-fgMuted">选型完全一致</span>
            ) : (
              diffDims.map((d) => {
                const curName = picks[d.id] ? (findOption(d.id, picks[d.id])?.name ?? '未选') : '未选';
                const draftName2 = diffDraft.picks[d.id]
                  ? (findOption(d.id, diffDraft.picks[d.id])?.name ?? '未选')
                  : '未选';
                return (
                  <button
                    key={d.id}
                    type="button"
                    data-diff-chip=""
                    onClick={() => focusDim(d.id)}
                    title={`当前：${curName} / 草稿：${draftName2} —— 点击直达该槽位`}
                    className="rounded-sm border border-line px-1.5 py-0.5 text-[10px] leading-[15px] text-fgMuted transition-colors hover:border-brass hover:text-fg"
                  >
                    {d.name}
                  </button>
                );
              })
            )}
            <button
              type="button"
              onClick={() => setDiffDraftId(null)}
              className="mono shrink-0 text-[10px] text-fgFaint transition-colors hover:text-fg"
            >
              收起
            </button>
          </div>
        )}

        {/* S3-3 剪贴板降级：clipboard API 不可用时给出可全选复制的输入行，
            链接照样能手工拿走 —— 静默失败等于「分享按钮是坏的」。 */}
        {shareUrl && (
          <div
            data-share-fallback=""
            className="flex w-full flex-wrap items-center gap-2 border-t border-line pt-2.5"
          >
            <span className="mono text-[10px] uppercase tracking-wider text-fgFaint">
              分享链接
            </span>
            <input
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="分享链接（点击全选复制）"
              className="min-w-0 flex-1 rounded-md border px-2 py-1 text-[10px] outline-none focus:border-brass"
              style={{ borderColor: '#243029', background: 'transparent', color: '#CFDCD6' }}
            />
            <button
              type="button"
              onClick={() => setShareUrl(null)}
              className="mono shrink-0 text-[10px] text-fgFaint transition-colors hover:text-fg"
            >
              关闭
            </button>
          </div>
        )}
      </div>

      {/* ── 选型出处：这套选型是扫描读出来的，还是人点出来的 ───────
          一个槽位填着 redis，用户必须能问出「这是谁填的、凭什么」。
          扫描填的（有一行 pom.xml:47 做证据）和人手点的，可信度不是一回事。 */}
      {provenance && (
        <ProvenanceBanner
          provenance={provenance}
          picks={picks}
          onDismiss={() => {
            clearProvenance();
            setProvenance(null);
          }}
        />
      )}

      {/* ── 步骤条 + 上一步 / 下一步 ── */}
      <StepRail
        step={step}
        onStep={setStep}
        summary={stepSummary}
        issues={stepIssues}
        canAdvance={nameOk}
        blockedHint={
          nameOk
            ? undefined
            : '先给项目起个名字（小写字母 + 点分段）—— 它要写进 pom 的 artifactId、application.yml 与 K8s 应用名。'
        }
      />

      {/* ── ⑦ 交付双版面：交付预览 / 组合产物 同一屏内分两个版面 ── */}
      {step === 'delivery' && (
        <div className="panel flex flex-wrap items-center gap-1.5 px-3 py-2">
          <span className="mono mr-1 text-[10px] uppercase leading-[15px] tracking-wider text-fgFaint">
            交付版面
          </span>
          <button
            type="button"
            data-delivery-view="preview"
            aria-pressed={deliveryView === 'preview'}
            onClick={() => setDeliveryView('preview')}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] transition-colors"
            style={{
              background: deliveryView === 'preview' ? 'rgba(217,164,65,0.12)' : 'transparent',
              color: deliveryView === 'preview' ? '#D9A441' : '#93A39C',
              border: `1px solid ${deliveryView === 'preview' ? 'rgba(217,164,65,0.6)' : '#243029'}`,
            }}
          >
            <span className="mono text-[11px] leading-none">⬡</span>
            交付预览
          </button>
          <button
            type="button"
            data-delivery-view="products"
            aria-pressed={deliveryView === 'products'}
            onClick={() => setDeliveryView('products')}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] transition-colors"
            style={{
              background: deliveryView === 'products' ? 'rgba(217,164,65,0.12)' : 'transparent',
              color: deliveryView === 'products' ? '#D9A441' : '#93A39C',
              border: `1px solid ${deliveryView === 'products' ? 'rgba(217,164,65,0.6)' : '#243029'}`,
            }}
          >
            <span className="mono text-[11px] leading-none">⎗</span>
            组合产物
            <span className="mono text-[10px] text-fgFaint">{plan.files.length}</span>
          </button>
        </div>
      )}

      {/* ── 当前这一步 ── */}
      {renderStep()}

      {/* ── 产物（⑦ 交付「组合产物」版面）────────────────────── */}
      {step === 'delivery' && deliveryView === 'products' && (
        <section ref={productsRef} className="panel scroll-mt-4 overflow-hidden">
          <header className="flex flex-wrap items-center gap-x-2 gap-y-2 border-b border-line px-4 py-2.5">
            <span className="mono text-[13px] leading-none text-brass">⎗</span>
            <h3 className="text-2xs font-semibold text-fg">
              {projectName || projectDoc.artifactId} 这套组合的产物
            </h3>
            <span className="mono text-[10px] text-fgFaint">
              {scale.deps} 个依赖 · {scale.configClasses} 个配置类 · {plan.files.length} 个可导出文件 ·{' '}
              {formatBytes(plan.bytes)}
            </span>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={handleExport}
                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors"
                style={{
                  borderColor: 'rgba(217,164,65,0.6)',
                  background: 'rgba(217,164,65,0.12)',
                  color: '#D9A441',
                }}
                title={`打包 ${plan.files.length} 个文件为 zip：构建文件、启动类、配置类、迁移脚本、README、隐患单、架构图与技术说明`}
              >
                <span className="mono text-[12px] leading-none">⇩</span>
                一键导出项目
              </button>
              <button
                type="button"
                onClick={() => setShowArtifacts((v) => !v)}
                className="mono text-[10px] text-fgFaint hover:text-fg"
              >
                {showArtifacts ? '收起' : '展开'}
              </button>
            </div>
          </header>

          {/* 导出反馈：告诉用户包里到底装了什么，以及下一步怎么跑 */}
          {exported && (
            <div
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line px-4 py-2.5"
              style={{ background: 'rgba(127,166,80,0.07)' }}
            >
              <span className="mono text-[11px] leading-none" style={{ color: '#7FA650' }}>
                ✓
              </span>
              <p className="text-2xs text-fgMuted">
                已导出 <span className="mono text-fg">{exported.name}</span>
                <span className="mx-2 text-fgFaint">·</span>
                {exported.files} 个文件 · {formatBytes(exported.bytes)}
                {exported.bytes > 0 && (
                  <>
                    <span className="mx-2 text-fgFaint">·</span>
                    解压后 {plan.kind === 'maven' ? 'mvn spring-boot:run' : './gradlew bootRun'} 即可启动
                  </>
                )}
              </p>
              <button
                type="button"
                onClick={() => setExported(null)}
                className="mono ml-auto text-[10px] text-fgFaint hover:text-fg"
              >
                知道了
              </button>
            </div>
          )}

          {audit.status === 'broken' && (
            <div
              className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-4 py-2"
              style={{ background: 'rgba(229,72,77,0.07)' }}
            >
              <span className="mono text-[11px] leading-none" style={{ color: '#E5484D' }}>
                !
              </span>
              <p className="text-[10px] leading-[15px] text-fgMuted">
                当前组合还缺必需模块，导出的骨架同样不完整 —— 先把红色的块补上再导。
              </p>
            </div>
          )}

          {showArtifacts && (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-3 py-2">
                {TAB_GROUPS.map((g, gi) => (
                  <Fragment key={g.group}>
                    {gi > 0 && <span className="h-[16px] w-px bg-line" />}
                    <div className="flex items-center gap-1">
                      <span className="mono mr-0.5 text-[10px] uppercase tracking-wider text-fgFaint">
                        {g.group}
                      </span>
                      {g.tabs.map((t) => {
                        const on = tab === t.id;
                        return (
                          <button
                            key={t.id}
                            type="button"
                            onClick={() => setTab(t.id)}
                            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors"
                            style={{
                              background: on ? 'rgba(217,164,65,0.10)' : 'transparent',
                              color: on ? '#D9A441' : '#93A39C',
                            }}
                          >
                            <span className="mono text-[11px] leading-none">{t.glyph}</span>
                            {t.label}
                            {t.count !== undefined && t.count > 0 && (
                              <span className="mono text-[10px] text-fgFaint">{t.count}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </Fragment>
                ))}

                {/* S2-7：目录树 / 架构图 / 隐患单三个页签已收编进交付预览
                    （那边是九块实时预览，比这里的一份静态渲染完整）。砍页签不砍入口。 */}
                <span className="h-[16px] w-px bg-line" />
                <button
                  type="button"
                  onClick={() => {
                    setDeliveryView('preview');
                    setDeckFocus('arch');
                    requestAnimationFrame(() => {
                      deckRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    });
                  }}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-fgMuted transition-colors hover:text-fg"
                  title="目录树、架构图、隐患单在「交付预览」版面里 —— 图都是实时算出来的"
                >
                  <span className="mono text-[11px] leading-none">⬢</span>
                  目录树 / 架构图 / 隐患单 → 右侧交付预览
                </button>
              </div>

              <div className="p-4">
                {tab === 'build' && (
                  <div className="space-y-3">
                    <Hint
                      text={
                        plan.kind === 'maven'
                          ? '依赖按模块分组并去重。业务依赖一律不写 version —— 版本交给 parent BOM 统一管理。只包含你实际装上的零件。'
                          : 'Gradle 的 scope 与 Maven 不是一一对应：注解处理器（Lombok、MapStruct）必须同时进 compileOnly 与 annotationProcessor，少写后者时编译能过、生成的 getter 却是红的。'
                      }
                    />
                    {plan.files
                      .filter((f) => f.group === '构建' && f.path !== '.gitignore')
                      .map((f) => (
                        <CodeBlock
                          key={f.path}
                          code={f.content}
                          lang={f.path.endsWith('.xml') ? 'xml' : 'text'}
                          label={f.path}
                        />
                      ))}
                  </div>
                )}

                {tab === 'yaml' && (
                  <div className="space-y-3">
                    <Hint text="每段都标注了它来自哪一块。键名可直接使用，不要自行发明配置键。导出的 zip 里还带 application-dev / application-prod 两份 profile。" />
                    <CodeBlock code={yamlText} lang="yaml" label="application.yml" />
                  </div>
                )}

                {tab === 'env' && (
                  <div className="space-y-3">
                    <Hint text="这一份看着不起眼，但它是防密钥泄漏的最后一道机械防线 —— 把 .env 与 application-local.yml 排除掉，靠的是版本控制而不是人的记性。" />
                    <CodeBlock code={projectDoc.files.gitignore} lang="text" label=".gitignore" />
                  </div>
                )}

                {tab === 'app' && (
                  <div className="space-y-4">
                    <Hint text="启动类只有两个职责：包扫描锚点、以及必须在此生效的扫描注解。所有 @EnableXxx 都放在各自的配置类里 —— 这就是下面那张「开关归属表」存在的意义：让你一眼看出为什么这个类这么空。" />
                    <CodeBlock code={appCode} lang="java" label="Application.java" />

                    <section className="panel overflow-hidden">
                      <header className="border-b border-line px-4 py-2.5">
                        <h4 className="text-2xs font-semibold text-fg">全局开关归属表</h4>
                        <p className="mt-1 text-[10px] leading-[15px] text-fgMuted">
                          当前组合里每一个全局开关由谁负责。删掉哪个配置类，等于关掉对应的开关 ——
                          这是把开关分散出去换来的好处：归属关系是可验证的。
                        </p>
                      </header>
                      <ul className="divide-y divide-line">
                        {projectDoc.switchOwners
                          .filter((s) => {
                            if (!s.when) return true;
                            return Object.entries(s.when).every(([dim, opts]) =>
                              picks[dim] ? opts.includes(picks[dim]) : false
                            );
                          })
                          .map((s) => (
                            <li
                              key={`${s.switch}-${s.owner}`}
                              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5"
                            >
                              <code className="mono w-[210px] shrink-0 text-2xs text-brass">
                                {s.switch}
                              </code>
                              <code className="mono w-[180px] shrink-0 text-[10px] text-fgMuted">
                                {s.owner}
                              </code>
                              <span className="min-w-0 flex-1 text-[10px] leading-[15px] text-fgMuted">
                                {s.why}
                              </span>
                            </li>
                          ))}
                      </ul>
                    </section>
                  </div>
                )}

                {tab === 'config' && (
                  <div className="space-y-4">
                    <Hint text="当前组合下必须存在的 Java 配置类。漏掉的后果通常不是报错，而是某个功能静默失效（例如忘记注册分页插件）。" />
                    {composed.configClasses.length === 0 ? (
                      <Empty text="当前组合不需要额外的 Java 配置类 —— 自动配置已经覆盖。" />
                    ) : (
                      composed.configClasses.map((c, i) => (
                        <CodeBlock
                          key={i}
                          code={c.code}
                          lang="java"
                          label={`${c.className} — ${c.path}`}
                        />
                      ))
                    )}
                    {composed.configClasses.length > 1 && (
                      <div className="flex justify-end">
                        <CopyButton text={configMd} label="复制全部配置类（Markdown）" />
                      </div>
                    )}
                  </div>
                )}

                {tab === 'code' && (
                  <div className="space-y-4">
                    <Hint text="选型不是「装个依赖」就完事 —— 它会改变你怎么写代码。这里是持久层、鉴权、缓存等零件对业务代码的实际影响。" />
                    {composed.samples.length === 0 ? (
                      <Empty text="当前组合没有额外的联动代码示例。" />
                    ) : (
                      composed.samples.map((s, i) => (
                        <CodeBlock
                          key={i}
                          code={s.code}
                          lang={s.lang}
                          label={`${s.dimName} · ${s.optName} — ${s.title}`}
                        />
                      ))
                    )}
                  </div>
                )}

                {tab === 'ops' && (
                  <div className="space-y-4">
                    {ops.length === 0 && composed.env.length === 0 ? (
                      <Empty text="当前组合没有额外的运维动作 —— 起一个数据库就能跑。" />
                    ) : (
                      <>
                        {ops.length > 0 && (
                          <section className="panel overflow-hidden">
                            <div className="border-b border-line px-4 py-3">
                              <h4 className="text-[13px] font-semibold text-fg">上线前要做的事</h4>
                            </div>
                            <ol className="divide-y divide-line">
                              {ops.map((o, i) => (
                                <li key={i} className="flex gap-3 px-4 py-2.5">
                                  <span
                                    className="mono mt-[1px] flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded border text-[10px]"
                                    style={{ borderColor: 'rgba(217,164,65,0.4)', color: '#D9A441' }}
                                  >
                                    {i + 1}
                                  </span>
                                  <span className="text-2xs leading-relaxed text-fgMuted">{o}</span>
                                </li>
                              ))}
                            </ol>
                          </section>
                        )}

                        {composed.env.length > 0 && (
                          <section className="panel overflow-hidden">
                            <div className="border-b border-line px-4 py-3">
                              <h4 className="text-[13px] font-semibold text-fg">
                                需要配置的环境变量
                              </h4>
                              <p className="mt-1 text-2xs text-fgFaint">
                                密钥一律走环境变量，不要写进 application.yml。
                              </p>
                            </div>
                            <ul className="divide-y divide-line">
                              {composed.env.map((e, i) => (
                                <li
                                  key={i}
                                  className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5"
                                >
                                  <code className="mono text-2xs" style={{ color: '#D9A441' }}>
                                    {e.key}
                                  </code>
                                  <span className="text-2xs text-fgMuted">{e.desc}</span>
                                  <span className="mono ml-auto text-[10px] text-fgFaint">
                                    {e.dimName}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </section>
                        )}
                      </>
                    )}
                  </div>
                )}

                {tab === 'deploy' && <DeployGuides picks={picks} meta={meta} />}

                {tab === 'prompt' && (
                  <div className="space-y-3">
                    <Hint text="把这段贴给任何 AI，它就不会再给你换成别的技术栈 —— 这是「一份数据三种出口」里「给 AI 用」那条路。" />
                    <CodeBlock
                      code={promptText}
                      lang="text"
                      label="技术选型约束 · System Prompt 片段"
                    />
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      )}

      {/* ── 说明：这张图怎么读 ─────────────────────────────── */}
      <section className="panel px-4 py-3.5">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5">
          <h3 className="text-2xs font-semibold text-fg">这张图怎么读</h3>
          <p className="text-[10px] leading-[15px] text-fgMuted">
            每个方块声明它<strong className="font-medium text-fg">提供</strong>什么能力、需要什么能力。
            校验就是把所有已装配方块提供的能力取并集，看谁的需求没被满足 ——
            没被满足就是缺零件。
            <span className="text-fgFaint">
              　层内用 <span className="mono">→</span> 串起来的是请求真正流经的链路；
              竖线隔开的模块是旁路件，只在发布或构建期起作用，请求不会经过它。
            </span>
          </p>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5">
          {[
            { tone: 'ok', text: '已装配：能力供应正常' },
            { tone: 'bad', text: '红色虚线：必选未装，跑不起来' },
            { tone: 'warn', text: '黄色：参与组合隐患（方块上直接写出是哪条）' },
            { tone: 'idle', text: '灰色虚线：可选项留空，不是错误' },
          ].map((l) => (
            <span key={l.text} className="flex items-center gap-1.5 text-[10px] text-fgFaint">
              <span
                className="inline-block h-[9px] w-[9px] rounded-sm border"
                style={{
                  borderStyle: l.tone === 'ok' || l.tone === 'warn' ? 'solid' : 'dashed',
                  borderColor: TONE[l.tone as keyof typeof TONE].border,
                  background: TONE[l.tone as keyof typeof TONE].soft,
                }}
              />
              {l.text}
            </span>
          ))}
          <span className="ml-auto text-[10px] text-fgFaint">
            {dimensions.length} 块零件 / {lanes.length} 条泳道 / {Object.keys(nodeArch).length}{' '}
            个槽位 / {arch.policies.length} 条组合策略
          </span>
        </div>
      </section>
    </div>
  );

  /**
   * ④ 分层装配 —— 台面（泳道图，全宽）+ 右缘选件抽屉。
   *
   * 这是装配台的老资产：33 个槽位按 7 条泳道摆开，点一块弹出抽屉换件、换形态。
   * 它留在这一文件里而不是抽出去，是因为「台面」与「结论条 / 点阵 / 产物区」
   * 共用同一批 ref 与回调 —— 拆开要靠 props 传五个 ref，换来的只是一点行数。
   */
  function renderBench() {
    const benchSpec = STEP_BY_ID.get('layers')!;
    const flowSpec = FLOW_BY_ID.get(benchFlow);
    const flowLanes =
      benchFlow === 'all' || !flowSpec
        ? lanes
        : lanes.filter((l) => flowSpec.laneIds.includes(l.id));
    return (
      <StepShell spec={benchSpec}>
        {/* 09-28 四反馈：不再左右两栏（左选槽位右选零件占版面）——
            台面全宽铺开，选件面板移入右侧抽屉（DimDrawer，浮层不占流）。 */}
        <div className="space-y-2 p-4">
          {/* ── ④ 流水线选择：一次只看一条流，不把 7 泳道一次铺开 ── */}
          <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-line bg-surface px-4 py-2">
            <span className="mono mr-1 text-[10px] uppercase leading-[15px] tracking-wider text-fgFaint">
              流水线
            </span>
            {FLOWS.map((f) => {
              const on = benchFlow === f.id;
              const ff = flowFilled(f, picks);
              return (
                <button
                  key={f.id}
                  type="button"
                  data-flow={f.id}
                  aria-pressed={on}
                  onClick={() => setBenchFlow(f.id)}
                  title={f.desc}
                  className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors"
                  style={{
                    borderColor: on ? 'rgba(217,164,65,0.6)' : '#243029',
                    background: on ? 'rgba(217,164,65,0.10)' : 'transparent',
                    color: on ? '#D9A441' : '#93A39C',
                  }}
                >
                  <span className="mono text-[11px] leading-none">{f.glyph}</span>
                  {f.name}
                  <span className="mono text-[10px] text-fgFaint">{ff.filled}/{ff.total}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-col gap-2 rounded-md border border-line bg-surface px-4 py-2.5 text-[11px] leading-[16px] text-fgMuted">
            {/* 操作提示独占一行：用内联 chip 把五种集群形态摊开，
                避免原句（箭头 + 括号 + 五种形态挤一句）折行后难读。交互不变。 */}
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="mono text-[12px] leading-none text-brass">⊙</span>
              <span className="text-fg">点任意方块</span>
              <span>→ 右缘弹出抽屉选零件、切<span className="text-fg">集群形态</span>：</span>
              <span className="flex flex-wrap items-center gap-1">
                {(['单实例', '主从', '组复制', '分片', '云原生'] as const).map((m) => (
                  <span
                    key={m}
                    className="rounded border border-line bg-surfaceHi px-1.5 py-0.5 text-[10px] leading-none text-fgMuted"
                  >
                    {m}
                  </span>
                ))}
              </span>
              <span className="text-fgFaint">图形化切换，副本数写进 ⑥ 部署形态清单</span>
            </div>
            {/* S2-4：搜索 + 三档筛选。互斥单选（aria-pressed），再点一次取消；
                与搜索词取交集。命中的卡片正常显示、未命中降噪到 0.28 ——
                聚光灯而不是搬家，泳道空间记忆不丢（顺带守 V2-02：
                输入框 min-w-0 + 外层 flex-wrap，移动端不横向溢出）。 */}
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              <input
                data-dim-search=""
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜维度 / 零件名"
                aria-label="搜索选型维度或零件名"
                className="w-[150px] min-w-0 rounded-md border px-2 py-1 text-[11px] outline-none transition-colors placeholder:text-fgFaint focus:border-brass"
                style={{ borderColor: '#243029', background: 'transparent', color: '#CFDCD6' }}
              />
              {(
                [
                  ['unpicked', '未选'],
                  ['hazard', '有隐患'],
                  ['required', '必选'],
                ] as const
              ).map(([key, label]) => {
                const on = dimFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    data-filter-chip={key}
                    aria-pressed={on}
                    onClick={() => setDimFilter(on ? null : key)}
                    className="rounded-md border px-2 py-1 text-[10px] transition-colors"
                    style={{
                      borderColor: on ? 'rgba(217,164,65,0.6)' : '#243029',
                      background: on ? 'rgba(217,164,65,0.10)' : 'transparent',
                      color: on ? '#D9A441' : '#93A39C',
                    }}
                    title={`只看${label}的槽位；再点一次取消`}
                  >
                    {label}
                  </button>
                );
              })}
              {visibleDims !== null && (
                <span className="mono text-[10px] text-fgFaint">
                  命中 {visibleDims.size}/{dimensions.length}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setFlowOn((v) => !v)}
              aria-pressed={flowOn}
              className="flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] transition-colors"
              style={
                flowOn
                  ? { borderColor: 'rgba(217,164,65,0.6)', background: 'rgba(217,164,65,0.12)', color: '#D9A441' }
                  : { borderColor: '#243029', background: 'transparent', color: '#93A39C' }
              }
              title="把请求真正流经的连线点亮成流动虚线（泳道间的竖线 + 链路上的箭头）；旁路件不亮。再点一次熄灭"
            >
              <span className="mono text-[11px] leading-none">{flowOn ? '⚡' : '⌀'}</span>
              {flowOn ? '链路已点亮' : '点亮请求链路'}
            </button>
            <span className="mx-1 h-[16px] w-px bg-line" />
            <button
              type="button"
              onClick={() => applyPicks(skeletonPicks(), null)}
              className="rounded-md border border-line px-2 py-1 text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
              title="只保留必选模块，其余全部留空 —— 从最小可运行骨架开始搭"
            >
              只留必选
            </button>
            <button
              type="button"
              onClick={() => applyPicks(emptyPicks(), null)}
              className="rounded-md border border-line px-2 py-1 text-[11px] text-fgMuted transition-colors hover:border-lineHi hover:text-fg"
              title="拆到一块不剩，从零开始拼"
            >
              清空重搭
            </button>
          </div>
          {/* 台面（L0）：34px 网格底 + 比 surface 暗一档的底色。
              泳道面板（L1）浮在台面上、零件卡（L2）浮在面板上 ——
              三层深度全部靠底色差与边框表达，不引进第二种配色。 */}
          <div ref={benchRef} className="stack-bench scroll-mt-4 space-y-1.5 rounded-lg border border-line p-1.5 sm:p-2">
            {flowLanes.map((lane, laneIdx) => {
              const slotIds = slotsOfLane(lane.id);
              /** 参与请求链路的槽位顺序；其余槽位是旁路件（如迁移工具） */
              const pipelineOrder = arch.pipelines[lane.id] ?? [];
              const filledCount = slotIds.filter((id) => picks[id]).length;
              return (
                <Fragment key={lane.id}>
                  {laneIdx > 0 && (
                    <div className="flex items-center gap-2 py-0.5 pl-[15px] sm:pl-[17px]">
                      <WireLayer flowOn={flowOn} />
                      <span className="mono text-[10px] uppercase leading-[15px] tracking-wider text-fgFaint">
                        请求向下穿过
                      </span>
                    </div>
                  )}
                  <section data-lane={lane.id} className="panel flex overflow-hidden">
                    {/* 泳道标签列（竖轴）：固定 30/34px，不随卡片换行移动。
                        原来表头横排在顶部，七根泳道看不出「上下穿过」的先后。 */}
                    <div className="flex w-[30px] shrink-0 flex-col items-center gap-2 border-r border-line bg-[rgba(255,255,255,0.015)] py-2.5 sm:w-[34px]">
                      <span className="mono text-[13px] leading-none text-brass">{lane.glyph}</span>
                      <span
                        className="text-[11px] font-semibold leading-[16px] tracking-[0.18em] text-fgMuted"
                        style={{ writingMode: 'vertical-rl' }}
                      >
                        {lane.name}
                      </span>
                      <span className="mono mt-auto text-[10px] leading-[15px] text-fgFaint">
                        {filledCount}/{slotIds.length}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2">
                        {/* 泳道名已经画在左侧竖轴上了，这里只留语义化的标题（sr-only），
                            免得同一行出现两遍「接入层」—— 视觉读一遍、竖轴读一遍。 */}
                        <h3 className="sr-only">{lane.name}</h3>
                        {pipelineOrder.length > 0 && (
                          <span className="mono rounded-sm border border-line px-1 text-[10px] leading-[15px] text-fgFaint">
                            请求链路 {pipelineOrder.length} 环
                          </span>
                        )}
                        <p className="ml-auto hidden max-w-[62%] text-right text-[10px] leading-[15px] text-fgFaint lg:block">
                          {lane.desc}
                        </p>
                      </header>
                      <div className="flex min-w-0 flex-wrap items-stretch gap-x-1.5 gap-y-2 px-3 py-3">
                        {slotIds.map((dimId) => {
                          const pipedIdx = pipelineOrder.indexOf(dimId);
                          const inPipeline = pipedIdx >= 0;
                          /** 权重三档（方案 §2.4）：链路上的核心件最宽，
                              同泳道有链路却不在链路上的是旁路件，最窄。 */
                          const weight: SlotWeight =
                            inPipeline ? 'core'
                              : pipelineOrder.length > 0 ? 'bypass'
                                : 'regular';
                          return (
                            <span key={dimId} className="flex shrink-0 items-stretch">
                              {/* 箭头与方块绑在同一个 flex item 里 —— 否则窄屏换行时
                                  箭头会被留在上一行末尾，指向一个不存在的东西。
                                  S1-4：字符箭头换 SVG（SlotWire），点亮时随链路流动。 */}
                              {inPipeline && pipedIdx > 0 && <SlotWire flowOn={flowOn} />}
                              {/* 旁路件：不在请求链路上，用一条竖线隔开 */}
                              {!inPipeline && pipelineOrder.length > 0 && (
                                <span
                                  className="mx-1.5 w-px self-stretch bg-lineHi"
                                  title="旁路件：不参与请求处理，在发布/构建期起作用"
                                />
                              )}
                              <SlotBlock
                                dimId={dimId}
                                state={audit.slotStates[dimId] ?? 'empty'}
                                option={picks[dimId] ? findOption(dimId, picks[dimId]) : undefined}
                                hazards={hazardsByDim[dimId]}
                                active={activeDim === dimId}
                                weight={weight}
                                dimmed={activeDim !== null && activeDim !== dimId}
                                hint={slotHint(dimId, picks[dimId])}
                                onClick={() => setActiveDim(dimId)}
                                onClear={() => clear(dimId)}
                                picks={picks}
                                meta={meta}
                                onTopology={pickTopology}
                                onSwap={pick}
                                muted={visibleDims !== null && !visibleDims.has(dimId)}
                              />
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  </section>
                </Fragment>
              );
            })}
          </div>
        </div>

        {/* 选件抽屉：点中的槽位 → 右缘浮出零件库（Inspector 的 Picker 体检结论态
            不进抽屉 —— 「这套组合能不能跑」的结论由顶部结论条常驻，不重复）。 */}
        {activeDim && (
          <DimDrawer>
            <Picker
              dimId={activeDim}
              picks={picks}
              meta={meta}
              onPick={pick}
              onClear={clear}
              onTopology={pickTopology}
              onClose={() => setActiveDim(null)}
            />
          </DimDrawer>
        )}
      </StepShell>
    );
  }
}

/**
 * 33 格槽位点阵（S1-5）。
 *
 * 一格 = 一个槽位 = dimensions 里的一维；颜色规则与零件卡**同一份映射**
 * （filled → ok / conflict → warn / missing-required → bad，其余 idle）——
 * 在这里另写一套颜色语义就违反「语义色只许 TONE 五色、含义不许复用」。
 *
 * 它回答的是「三档结论说不对，那到底哪儿不对」：一格一个槽位扫一眼，
 * 点击直达该槽位所在的步骤（交付件 ⑤、其余 ④ + 台面聚焦）。格数必须等于
 * dimensions.length —— 点阵不是装饰，少一格就有一个槽位没被索引到（【18】断言守着）。
 */
function SlotDotMatrix({
  slotStates,
  activeDim,
  flags,
  issueItems,
  onSelect,
}: {
  slotStates: Record<string, SlotState>;
  activeDim: string | null;
  /** 问题格：need = 在要没人给的能力 / 必选未装；remedy = 能补上缺口 */
  flags: Record<string, 'need' | 'remedy'>;
  /** 问题格的点名清单（与 flags 同源）：谁、什么问题 */
  issueItems: { dim: string; label: string; kind: 'need' | 'remedy' }[];
  onSelect: (dimId: string) => void;
}) {
  const STATE_LABEL: Record<SlotState, string> = {
    filled: '已装配',
    conflict: '参与组合隐患',
    'missing-required': '必选未装 —— 跑不起来',
    'missing-recommended': '建议件未装',
    empty: '可选未装',
  };
  const FLAG_META = {
    need: { color: TONE.bad.color, label: '有问题' },
    remedy: { color: '#7FA650', label: '可补' },
  } as const;
  const flagged = (Object.keys(flags) as string[]).filter((d) => flags[d]);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="mono shrink-0 text-[10px] uppercase leading-[15px] tracking-wider text-fgFaint">
          {dimensions.length} 格
        </span>
        <div className="flex max-w-[272px] flex-wrap items-center gap-[3px]">
          {dimensions.map((d) => {
            const st = slotStates[d.id] ?? 'empty';
            const t =
              st === 'missing-required' ? TONE.bad
                : st === 'conflict' ? TONE.warn
                  : st === 'filled' ? TONE.ok
                    : TONE.idle;
            const dashed = st !== 'filled' && st !== 'conflict';
            const flag = flags[d.id];
            return (
              <button
                key={d.id}
                type="button"
                data-dim={d.id}
                data-state={st}
                onClick={() => onSelect(d.id)}
                title={
                  flag
                    ? `${d.name} · ${FLAG_META[flag].label}（点击直达该槽位）`
                    : `${d.name} · ${STATE_LABEL[st]}（点击直达该槽位）`
                }
                aria-label={`${d.name}：${flag ? FLAG_META[flag].label : STATE_LABEL[st]}`}
                className={
                  'h-[10px] w-[10px] rounded-sm border transition-transform hover:scale-125 ' +
                  (activeDim === d.id ? 'ring-1 ring-brass ring-offset-1 ring-offset-transparent' : '')
                }
                style={{
                  borderColor: flag ? FLAG_META[flag].color : t.border,
                  borderStyle: flag || !dashed ? 'solid' : 'dashed',
                  borderWidth: flag ? 2 : 1,
                  background: t.soft,
                  boxShadow: flag ? `0 0 0 1px ${FLAG_META[flag].color}55` : undefined,
                }}
              />
            );
          })}
        </div>
        {flagged.length > 0 && (
          <span className="mono shrink-0 text-[10px] leading-[15px] text-fgFaint">
            描边 = 有问题
          </span>
        )}
      </div>

      {/* 问题格文字索引：10px 色块说不清「这是哪格、坏在哪一步」，列出来直接点名。
          点击 = 定位到该槽位所在的步骤（交付件在 ⑤，其余在 ④ 台面并自动切流）。 */}
      {flagged.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {issueFlagOrder(flags).map((dimId) => {
            const kind = flags[dimId];
            const dim = dimensions.find((d) => d.id === dimId);
            const step = stepOfDim(dimId);
            const stepSpec = step ? STEP_BY_ID.get(step) : null;
            // 导航单位是「组」，维度挂在组下 —— 组名/维度名两级都给，
            // 否则「运行环境」在 ③ 导航上对不上号（导航列的是「运行基石」）
            const group = groupOfDim(dimId);
            const items = issueItems.filter((x: { dim: string }) => x.dim === dimId);
            const label = items.map((x) => x.label).join('、') || FLAG_META[kind].label;
            return (
              <button
                key={dimId}
                type="button"
                onClick={() => onSelect(dimId)}
                className="flex items-baseline gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] leading-[15px] transition-colors hover:brightness-125"
                style={{
                  borderColor: kind === 'need' ? TONE.bad.border : 'rgba(127,166,80,0.5)',
                  background: kind === 'need' ? TONE.bad.soft : 'rgba(127,166,80,0.10)',
                  color: kind === 'need' ? TONE.bad.color : '#7FA650',
                }}
                title={`${group ? `${group.name} / ` : ''}${dim?.name ?? dimId}（${
                  stepSpec ? `第 ${STEPS_ORDINAL(step!)} 步 · ${stepSpec.name} 配` : '④ 台面'
                }）→ 点击直达`}
              >
                <span className="font-medium">
                  {group ? `${group.name} / ` : ''}
                  {dim?.name ?? dimId}
                </span>
                <span className="text-fgMuted">{label}</span>
                {stepSpec && (
                  <span className="mono text-fgFaint">
                    {stepSpec.glyph} {stepSpec.name}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** 问题格在索引里的展示顺序：need（红）在前，remedy（绿）在后；同色按维度序 */
function issueFlagOrder(flags: Record<string, 'need' | 'remedy'>): string[] {
  return Object.keys(flags).sort((a, b) => {
    if (flags[a] !== flags[b]) return flags[a] === 'need' ? -1 : 1;
    return a.localeCompare(b);
  });
}

function STEPS_ORDINAL(stepId: StepId): number {
  // 序号出处是 wizard.STEPS，不在这里另抄一份顺序
  return STEPS.findIndex((s) => s.id === stepId) + 1;
}

function findOption(dimId: string, optId: string) {
  return dimensionById.get(dimId)?.options.find((o) => o.id === optId);
}

/**
 * 「推荐件」判定（S2-1 换件排序 / S2-2 一键补齐共用）：出处是事实源的
 * `defaultOption` 且不是「不用」档 —— 这里不打分、不写死名字。
 * 维度连真零件都没有（选项只有 none）就返回 undefined，调用方跳过。
 */
function recommendedOptionFor(dimId: string) {
  const dim = dimensionById.get(dimId);
  if (!dim) return undefined;
  return (
    dim.options.find((o) => o.id === dim.defaultOption && o.id !== 'none') ??
    dim.options.find((o) => o.id !== 'none')
  );
}

/**
 * 空态引导（S1-7，顺带治 V2-13「网关路由卡只有放大一个『无』」）。
 *
 * 「未使用」有两种形态，都得给引导：没选（`picks[dimId]` 为空），以及选了事实源里的
 * `none` 那一档（「不用消息队列」「无」）。只处理前一种的话，默认态 33 格全是
 * `filled`，引导一行都不会出现。
 *
 * 给的两行：
 *   ① 装什么 —— 维度 `defaultOption`；它若本身就是「不用」，取第一个真正的零件；
 *   ② 装了有什么用 —— 该选项的 summary，没有就退回维度 why。
 * 两者都来自事实源，不在这里编文案。
 */
function slotHint(dimId: string, picked: string | undefined) {
  const dim = dimensionById.get(dimId);
  if (!dim) return undefined;
  const unused = !picked || picked === 'none';
  if (!unused) return undefined;
  const opt =
    (dim.defaultOption !== 'none' && dim.options.find((o) => o.id === dim.defaultOption)) ||
    dim.options.find((o) => o.id !== 'none');
  if (!opt) return undefined;
  return { name: opt.name, use: opt.summary || dim.why };
}

function Hint({ text }: { text: string }) {
  return (
    <p className="rounded-md border border-line bg-surface px-4 py-2.5 text-2xs leading-relaxed text-fgMuted">
      {text}
    </p>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="panel px-5 py-8 text-center">
      <p className="text-2xs text-fgFaint">{text}</p>
    </div>
  );
}

/**
 * 选型出处横幅。
 *
 * 三件事必须同时说清，缺一件这条横幅就退化成一块装饰：
 *   ① **从哪来** —— 仓库根路径与扫描时间；
 *   ② **凭什么** —— 每个槽位的出处（依赖坐标的文件:行号 / 部署清单文件名）；
 *   ③ **哪些不是它填的** —— 扫描之后被人改过的格子单独数出来。
 *
 * 少了 ③，用户会以为整张画布 33 格都是扫描读出来的；
 * 少了 ①②，就只剩一句「来自代码扫描」的空话。
 * 这三条的写法与「隐患必须带 trigger/symptoms/impact」是同一条规矩：
 * 给结论就得给出能核对它的东西。
 */
function ProvenanceBanner({
  provenance,
  picks,
  onDismiss,
}: {
  provenance: PicksProvenance;
  picks: StackPicks;
  onDismiss: () => void;
}) {
  const [open, setOpen] = useState(false);
  const edited = dimensions.filter(
    (d) => (provenance.atScan[d.id] ?? '') !== (picks[d.id] ?? '')
  );
  const editedDims = new Set(edited.map((d) => d.id));

  return (
    <section
      className="panel overflow-hidden"
      style={{ borderColor: 'rgba(217,164,65,0.35)', background: 'rgba(217,164,65,0.05)' }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5">
        <span className="mono text-[12px] leading-none" style={{ color: '#D9A441' }}>
          ⌕
        </span>
        <p className="text-2xs text-fg">
          本次选型来自<span className="text-brass">代码扫描</span>
          <span className="mono ml-1.5 text-[10px] text-fgMuted">{provenance.root}</span>
        </p>
        <span className="mono text-[10px] text-fgFaint">
          {provenance.fromDeps.length} 格来自依赖声明
          {provenance.fromDeploy.length > 0 && ` · ${provenance.fromDeploy.length} 格来自部署清单`}
          {provenance.conflicts.length > 0 && ` · ${provenance.conflicts.length} 处同维冲突`}
          {provenance.unmatchedCount > 0 && ` · ${provenance.unmatchedCount} 项未识别`}
        </span>
        {edited.length > 0 && (
          <span className="mono text-[10px]" style={{ color: '#D9A441' }}>
            其中 {edited.length} 格已被你改过
          </span>
        )}
        <div className="ml-auto flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mono text-[10px] text-fgFaint transition-colors hover:text-fg"
          >
            {open ? '收起出处' : '看出处'}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="mono text-[10px] text-fgFaint transition-colors hover:text-fg"
            title="清掉这条出处 —— 之后这套选型按手工拼装看待"
          >
            知道了
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-line px-4 py-2.5">
          <ul className="space-y-1 text-[10px] leading-[15px] text-fgMuted">
            {provenance.fromDeps.map((d) => (
              <li key={`pv-dep-${d.dim}`} className="mono">
                <span className="text-fg">
                  {d.dim}={d.opt}
                </span>
                <span className="text-fgFaint">
                  {' '}
                  ← {d.tech} · {d.path}:{d.line}
                </span>
                {editedDims.has(d.dim) && <span style={{ color: '#D9A441' }}> · 已改动</span>}
              </li>
            ))}
            {provenance.fromDeploy.map((d) => (
              <li key={`pv-dp-${d.dim}`} className="mono">
                <span className="text-fg">
                  {d.dim}={d.opt}
                </span>
                <span className="text-fgFaint"> ← 部署清单 {d.because}</span>
              </li>
            ))}
            {provenance.conflicts.map((c) => (
              <li key={`pv-cf-${c.dim}`} className="mono" style={{ color: '#E5A33D' }}>
                · {c.dim} 命中多个候选，取了 {c.kept}；另有 {c.dropped.join('、')} 未采用
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-fgFaint">
            未识别的依赖不会静默丢弃 —— 明细在
            <Link href="/arch" className="text-fgMuted underline underline-offset-2">
              「六大架构」页的代码扫描入口
            </Link>
            里逐条列出。
            {provenance.scannedAt && <>　扫描时间 {provenance.scannedAt}</>}
          </p>
        </div>
      )}
    </section>
  );
}
