import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { auditArchitecture, capLabel, nodeArch, STATUS_META } from '@/lib/arch';
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
import { buildExportPlan, projectDoc, renderAppClass } from '@/lib/project';
import { downloadZip } from '@/lib/zip';
import type { LintViolation } from '@/lib/export-lint';
import type { StackPicks } from '@/lib/content-types';
import { useStackHistory, type StackSnapshot } from './history';
import { DRAFTS_LIMIT, loadDrafts, saveDrafts, type StackDraft } from './drafts';
import { clearScaffoldDraft, loadScaffoldDraft, saveScaffoldDraft } from '@/lib/picks-store';
import { buildExportArtifacts } from '@/lib/scaffold/artifacts';
import type { EnvValues, TemplateVars } from '@/lib/scaffold/contracts';
import { dbImageOf, defaultValues, formsFor, validateEnv } from '@/lib/scaffold/env-form';
import { resolveModules } from '@/lib/scaffold/module-registry';
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
import { emptyMeta, topologyFigures, withParam, withTopology, type StackPicksMeta } from '@/lib/topology';
import { TONE } from './palette';
import {
  DEFAULT_PROJECT,
  PAGE_ID_OF_STEP,
  PAGE_OF_STEP,
  STACK_PAGES,
  THEME_SECTIONS,
  RUN_SECTIONS,
  isValidProjectName,
  loadProjectMeta,
  saveProjectMeta,
  stepOfDim,
  type StackPageId,
  type StepId,
} from './wizard';

/**
 * 装配台的**状态通道** —— 四页共用的那一份状态。
 *
 * 2026-09-29 P0：装配台从 `/stack` 单页拆成四页（选型台 / 环境与模块 /
 * 运行与部署 / 交付中心）。拆的是信息架构，**不是引擎**：picks / meta / baseId /
 * drafts / envValues / 项目名与步骤这些通道，键名与语义一个字没改，只把
 * 「谁持有它们」从组件搬到了 hook —— 四页各自 `useStackChannel(page)`，
 * 靠 localStorage 在页间续上（写盘是变更即写，所以跨页不丢）。
 *
 * 换页 = 重挂载 = 重新水合。因此**瞬时态**（撤销栈、台面聚焦、搜索词、
 * 产物页签）跨页不保留 —— 它们不是「这套架构是什么」的一部分。
 */

/**
 * 「看架构图」跨页时要把焦点带过去：deckFocus 是瞬时态、重挂载即丢，
 * 所以用一张模块级一次性便条在两个页面实例之间传一次（取走即清）。
 */
let pendingDeckFocus: 'arch' | null = null;

export default function useStackChannel(page: StackPageId = 'software') {
  const router = useRouter();
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
  const [tab, setTab] = useState<string>('build');
  /**
   * 「点亮请求链路」开关（S1-4）。默认关 —— 动效是给「想看请求怎么穿」的人
   * 的放大镜，不是常驻装饰；关闭时连线退回 treeLine 静态实线，零动效。
   */
  const [flowOn, setFlowOn] = useState(false);
  /** 外部请求交付预览切到的页签（S2-7：「看架构图」入口）；消费后回 null */
  const [deckFocus, setDeckFocus] = useState<'arch' | null>(pendingDeckFocus);
  const [showArtifacts, setShowArtifacts] = useState(true);
  const [exported, setExported] = useState<{
    name: string;
    bytes: number;
    files: number;
    /** 导出预检闸的拦截清单：非空 = 本次导出被拒绝，包没有落地 */
    blocked?: LintViolation[];
  } | null>(
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

  // S2-5：Esc 关闭当前打开的层。优先级：草稿面板 > 台面聚焦。
  // （09-28 八反馈起换件菜单已退场 —— ④ 只读，没有浮层要让它先关。）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
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

  // ── 脚手架装配台通道（⑤⑥⑦ + 双包交付）─────────────────────
  // envValues 存非敏感字段；密码类字段单独放 secrets —— 是否落盘由 rememberSecrets 决定，
  // 默认不落盘（刷新即忘），见 picks-store 顶部的扩散面说明。
  const [scaffoldEnv, setScaffoldEnv] = useState<EnvValues>({});
  const [scaffoldSecrets, setScaffoldSecrets] = useState<EnvValues>({});
  const [rememberSecrets, setRememberSecrets] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [feBase, setFeBase] = useState('vue3-vite');
  const [moduleIds, setModuleIds] = useState<string[]>([]);

  // 脚手架草稿水合：一次，读第四通道（环境值/模块/前端基底/演示模式 + 可选的密码）
  useEffect(() => {
    const saved = loadScaffoldDraft();
    if (saved) {
      setScaffoldEnv(saved.draft.envValues);
      setScaffoldSecrets(saved.secrets);
      setDemoMode(saved.draft.demoMode);
      setFeBase(saved.draft.feBase);
      setModuleIds(saved.draft.moduleIds);
      setRememberSecrets(Object.keys(saved.secrets).length > 0);
    }
  }, []);

  // 脚手架草稿写回：与选型快照同一节奏（变更即写，写失败静默）
  useEffect(() => {
    if (!hydrated) return;
    saveScaffoldDraft(
      { envValues: scaffoldEnv, demoMode, feBase, moduleIds },
      scaffoldSecrets,
      rememberSecrets
    );
  }, [scaffoldEnv, scaffoldSecrets, rememberSecrets, demoMode, feBase, moduleIds, hydrated]);

  const audit = useMemo(() => auditArchitecture(picks), [picks]);
  const composed = useMemo(() => composeStack(picks), [picks]);
  const scale = useMemo(() => stackScale(composed), [composed]);
  const plan = useMemo(
    () => buildExportPlan(picks, audit, baseId, projectName),
    [picks, audit, baseId, projectName]
  );

  // ── 脚手架派生量 ─────────────────────────────────────────────
  const scaffoldForms = useMemo(() => formsFor(picks), [picks]);
  const appName = projectName.trim() || projectDoc.artifactId;
  const allEnvValues = useMemo(
    () => ({ ...defaultValues(scaffoldForms, picks, appName), ...scaffoldEnv, ...scaffoldSecrets }),
    [scaffoldForms, picks, scaffoldEnv, scaffoldSecrets, appName]
  );
  const envMissing = useMemo(
    () => validateEnv(scaffoldForms, allEnvValues),
    [scaffoldForms, allEnvValues]
  );
  const moduleResolution = useMemo(
    () => resolveModules(moduleIds, picks, feBase),
    [moduleIds, picks, feBase]
  );
  const scaffoldVars = useMemo<TemplateVars>(
    () => ({
      basePackage: 'com.example',
      basePackagePath: 'com/example',
      artifactId: appName,
      appName,
      backendBaseUrl: 'http://127.0.0.1:8080',
      dbImage: dbImageOf(picks.database),
    }),
    [appName, picks.database]
  );
  const artifacts = useMemo(
    () =>
      buildExportArtifacts(picks, {
        projectName: appName,
        baseId,
        env: { values: allEnvValues, demoMode },
        modules: moduleResolution.selected,
        feBase,
        vars: scaffoldVars,
      }),
    [picks, appName, baseId, allEnvValues, demoMode, moduleResolution.selected, feBase, scaffoldVars]
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
    // P0 四页：交付自成一页，焦点是瞬时态换页即丢 —— 写一次性便条让新实例取走
    pendingDeckFocus = 'arch';
    if (STACK_PAGES.find((p) => p.id === page)?.route !== '/stack/delivery') {
      router.push('/stack/delivery');
    }
    requestAnimationFrame(() => {
      deckRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function handleExport() {
    // 导出预检闸：包自洽性检查不过就不出货 —— 与其让用户解包后对着
    // 启动日志猜（09-29 三轮事故），不如当场把问题清单亮在台面上。
    if (plan.violations.length > 0) {
      setExported({ name: '', bytes: 0, files: 0, blocked: plan.violations });
      return;
    }
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

  const feLabel = feBase === 'none' ? '无前端' : feBase === 'vue3-vite' ? 'Vue3' : feBase;
  const stepSummary: Record<StepId, string> = {
    project: projectName || '未命名',
    base: picks.build === 'gradle' ? 'Gradle' : 'Maven',
    theme: `${themeFilled}/${themeTotal}`,
    layers: `${audit.stats.filled}/${dimensions.length}`,
    frontend: feLabel,
    env: envMissing.length === 0 ? (demoMode ? '演示' : `${allEnvValues['db.host'] ?? ''}` || '默认') : `${envMissing.length} 项缺`,
    modules: moduleResolution.selected.length > 0 ? `${moduleResolution.selected.length} 模块` : '未选',
    deliverRun: `${runFilled}/${runTotal}`,
    topology: topologyCount > 0 ? `${topologyCount} 项` : '未表态',
    delivery: `后${artifacts.backend.files.length}${artifacts.frontend ? ` / 前${artifacts.frontend.files.length}` : ''}`,
  };

  const nameOk = isValidProjectName(projectName.trim());
  // ── P0 四页（2026-09-29）：页面归属在这里定，**恢复出来的 step 不再原样用** ──
  //
  // `arsenal-stack-project-v1` 里存的 step 是**全局**的（十步共用一条顺序），
  // 而四页各自只承载其中几步。于是有两个必须同时成立的约束：
  //
  //   ① 打开 `/stack/env` 必须看到**环境与模块**这一步，而不是 localStorage 里那个
  //      「上次停在哪」——用户点进哪页，就该看到哪页的面孔。
  //   ② 页内换步（StackEnv 里点第 ⑥ 步）**不许**被恢复逻辑顶回去。
  //
  // 两者靠「只在挂载时裁决一次」同时满足：`step` 故意**不进依赖数组**，
  // 所以页面内随便 setStep 都不会再触发重算。这一条是实打实踩出来的 ——
  // 依赖里带上 `step` 时，URL 会被一路 `router.replace` 拽回 `/stack/`，
  // 四张装配台截图字节完全相同，正是这个 bug 的指纹。
  const pageSpec = STACK_PAGES.find((p) => p.id === page) ?? STACK_PAGES[0];
  useEffect(() => {
    if (!hydrated) return;
    if (PAGE_ID_OF_STEP[step] === pageSpec.id) return;
    setStep(pageSpec.steps[0]);
  }, [hydrated, pageSpec.id, pageSpec.steps]);

  // 焦点便条是一次性的：新实例挂载取走后就地清掉
  useEffect(() => {
    pendingDeckFocus = null;
  }, []);

  return {
    // 三通道 + 项目通道
    picks, setPicks, baseId, setBaseId, meta, setMeta, hydrated,
    provenance, setProvenance, presetId, setPresetId,
    projectName, setProjectName, step, setStep,
    // 形态与参数
    pickTopology, setParam,
    // 操作
    hist, snapRef, restore, undo, redo, applyPicks, applyShape, pick, clear, fillRecommended,
    // 草稿 / 分享
    drafts, setDrafts, showDraftSave, setShowDraftSave, draftName, setDraftName,
    showDraftList, setShowDraftList, diffDraftId, setDiffDraftId, diffDraft, diffDims,
    openDraftSave, doSaveDraft, openDraftList, doDeleteDraft,
    copied, shareUrl, setShareUrl, doShare,
    // 交付预览 / 产物
    tab, setTab, showArtifacts, setShowArtifacts, exported, setExported,
    deliveryView, setDeliveryView, deckFocus, setDeckFocus,
    productsRef, deckRef, benchRef, focusArch, handleExport,
    // 台面
    activeDim, setActiveDim, benchFlow, setBenchFlow, flowOn, setFlowOn,
    query, setQuery, dimFilter, setDimFilter, visibleDims, fillNote, setFillNote,
    // 脚手架通道
    scaffoldEnv, setScaffoldEnv, scaffoldSecrets, setScaffoldSecrets,
    rememberSecrets, setRememberSecrets, demoMode, setDemoMode,
    feBase, setFeBase, moduleIds, setModuleIds,
    // 派生
    audit, composed, scale, plan, scaffoldForms, appName, allEnvValues, envMissing,
    moduleResolution, scaffoldVars, artifacts, yamlText, promptText, configMd, appCode, ops,
    hazardsByDim, issueDots, dimFlags, dotFlags, stepIssues, statusMeta, tone,
    hazardCount, buildLabel, missingRequired, stepSummary, nameOk,
  };
}

export type StackChannel = ReturnType<typeof useStackChannel>;

/** 维度 → 当前选中的选项对象（台面卡片与点阵共用这一份查找） */
export function findOption(dimId: string, optId: string) {
  return dimensionById.get(dimId)?.options.find((o) => o.id === optId);
}

/**
 * 「推荐件」判定（S2-1 换件排序 / S2-2 一键补齐共用）：出处是事实源的
 * `defaultOption` 且不是「不用」档 —— 这里不打分、不写死名字。
 * 维度连真零件都没有（选项只有 none）就返回 undefined，调用方跳过。
 */
export function recommendedOptionFor(dimId: string) {
  const dim = dimensionById.get(dimId);
  if (!dim) return undefined;
  return (
    dim.options.find((o) => o.id === dim.defaultOption && o.id !== 'none') ??
    dim.options.find((o) => o.id !== 'none')
  );
}

/**
 * 空态引导（S1-7）：未使用的槽位给「装什么 / 装了有什么用」两行，
 * 两者都来自事实源，不在这里编文案。
 */
export function slotHint(dimId: string, picked: string | undefined) {
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
