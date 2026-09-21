import generated from '@/generated/profiles.json';
import { liveStats } from '@/lib/rules';
import {
  ARCH_VIEW_IDENTITY,
  ARCH_VIEW_IDS,
  archProfileShapeIssues,
  buildMetrics,
  resolveProfile,
  unknownTokens,
  type ArchProfile,
  type ArchViewId,
  type ProfileSummary,
  type ResolvedProfile,
} from './arch-profile';

/**
 * 六大架构视图的数据层 —— 现在是**档案的解析结果**，不是写死的文案。
 *
 * 口径：业务 / 数据 / 应用 / 技术 / 产品 / 项目。
 * 三件事分得很清楚：
 *   · 视图身份（中文名 / 英文名 / 图标 / 主题色）—— 代码里的契约，六个 id 固定；
 *   · 每个视图写什么话 —— `arsenal-profiles/<id>.json`，换项目只换这一份；
 *   · 数字 —— 一律 `{{token}}`，由 `arch-profile.ts` 从真实数据算出。
 *
 * 页面切档案走 `composeArchViews(profile)`，模块级那几个常量是「默认档案」
 * 的解析结果，给不需要切换的消费方（自检脚本）用。
 */

export type { ArchViewId } from './arch-profile';
export { ARCH_VIEW_IDS } from './arch-profile';

// ── 档案装载 ────────────────────────────────────────────────

interface ProfilesDoc {
  order: string[];
  profiles: Record<string, ArchProfile>;
}

const DOC = generated as unknown as ProfilesDoc;

/** 全部内置档案，解析完毕。键为档案 id，顺序同 `PROFILE_ORDER`。 */
export const PROFILE_ORDER: string[] = DOC.order ?? [];

const RESOLVED: Record<string, ResolvedProfile> = Object.fromEntries(
  PROFILE_ORDER.map((id) => [id, resolveProfile(DOC.profiles[id], buildMetrics())])
);

export const DEFAULT_PROFILE_ID = PROFILE_ORDER[0];

if (!DEFAULT_PROFILE_ID) {
  // 构建期就炸，别等到页面上出现六张空图 —— 空图不会报错，只会显得项目没做完
  throw new Error('arsenal-profiles/ 里一份档案都没有，/arch 无从渲染');
}

export function getProfile(id: string): ResolvedProfile {
  return RESOLVED[id] ?? RESOLVED[DEFAULT_PROFILE_ID];
}

export const PROFILE_SUMMARIES: ProfileSummary[] = PROFILE_ORDER.map((id) => {
  const p = RESOLVED[id];
  return { id, name: p.name, subtitle: p.subtitle, note: p.note, builtin: true };
});

/** 一份档案的自检问题（形状 + token 能否解析）。自检脚本与页面导入口都用它。 */
export function profileIssues(raw: unknown): string[] {
  const shape = archProfileShapeIssues(raw);
  if (shape.length) return shape;
  const p = raw as ArchProfile;
  const verifyTotal = (p.project?.verifyChain ?? []).reduce((n, v) => n + (v.count ?? 0), 0);
  const metrics = buildMetrics(verifyTotal);
  const unknown = unknownTokens(p, metrics);
  return unknown.length
    ? [`档案里有解不开的 token：${unknown.map((t) => `{{${t}}}`).join('、')}（注册表见 arch-profile.ts 的 buildMetrics）`]
    : [];
}

// ── 一份档案 → 渲染器要的全部数组 ───────────────────────────

export interface ArchViewMeta {
  id: ArchViewId;
  name: string;
  english: string;
  glyph: string;
  /** 主题色（沿用「一图讲清」的六色：绿/蓝/橙/紫/青/红） */
  accent: string;
  definition: string;
  /** 核心关注（短词条） */
  focus: string[];
  /** 回答的问题 */
  question: string;
  /** 常见产出 */
  outputs: string[];
}

export interface CapabilityDomain {
  name: string;
  desc: string;
  /** 从真实数据算出的度量（展示用）。档案没写就是空 */
  metric: string;
}

export interface DataAsset {
  path: string;
  name: string;
  metric: string;
  desc: string;
}

export interface ArchViewData {
  profileId: string;
  profileName: string;
  profileSubtitle?: string;
  profileNote?: string;

  views: ArchViewMeta[];
  verifyChain: { name: string; count: number; desc: string }[];
  verifyTotal: number;

  businessDomains: CapabilityDomain[];
  businessOutlets: { name: string; desc: string; glyph: string }[];
  businessConsumers: string[];
  productNonGoals: string[];

  dataAssets: DataAsset[];
  dataPipeline: { name: string; desc: string; glyph: string }[];
  dataConsumers: string[];
  dataGovernance: string[];

  appRoutes: { path: string; name: string; desc: string }[];
  appEndpoints: { group: string; items: string[] }[];
  appLayers: { name: string; desc: string; items: string[] }[];
  appContracts: string[];

  productSurfaces: { name: string; desc: string }[];
  engineLayers: { name: string; status: 'done' | 'todo'; metric: string; desc: string }[];
  severityRows: { name: string; count: number; tone: 'bad' | 'warn' | 'info' }[];
  mustLimit: number;

  projectDirs: { path: string; role: string }[];
  projectPipeline: string[];
  projectRoadmap: { name: string; desc: string; tone: string }[];
}

/** 图标回落的兜底 glyph 名。档案少写一个 glyph 时用它，不静默给空字符串。 */
const DEFAULT_GLYPH = 'spark';

export function composeArchViews(p: ResolvedProfile): ArchViewData {
  const views: ArchViewMeta[] = ARCH_VIEW_IDS.map((id) => {
    const identity = ARCH_VIEW_IDENTITY[id];
    const text = p.views[id];
    return {
      id,
      ...identity,
      definition: text.definition,
      focus: text.focus,
      question: text.question,
      outputs: text.outputs,
    };
  });

  const appRoutes = p.app.routes.map((r) => ({ path: r.path, name: r.name, desc: r.desc }));
  const routeNames = appRoutes.map((r) => r.name);

  return {
    profileId: p.id,
    profileName: p.name,
    profileSubtitle: p.subtitle,
    profileNote: p.note,

    views,
    verifyChain: p.project.verifyChain,
    verifyTotal: p.verifyTotal,

    businessDomains: p.business.domains.map((d) => ({ name: d.name, desc: d.desc, metric: d.metric ?? '' })),
    businessOutlets: p.business.outlets.map((o) => ({ name: o.name, desc: o.desc, glyph: o.glyph ?? DEFAULT_GLYPH })),
    businessConsumers: p.business.consumers,
    productNonGoals: p.business.nonGoals,

    dataAssets: p.data.assets,
    dataPipeline: p.data.pipeline.map((s) => ({ name: s.name, desc: s.desc, glyph: s.glyph ?? DEFAULT_GLYPH })),
    dataConsumers: p.data.consumers,
    dataGovernance: p.data.governance,

    appRoutes,
    appEndpoints: p.app.endpoints,
    // `@routes` 是保留值：写它等于「这一层的 items 就是上面那些页面的名字」。
    // 手抄一遍迟早会漏掉新加的路由，而这个漏不会报错。
    appLayers: p.app.layers.map((l) => ({
      name: l.name,
      desc: l.desc,
      items: l.items === '@routes' ? routeNames : (l.items as string[]),
    })),
    appContracts: p.app.contracts,

    productSurfaces: p.product.surfaces,
    engineLayers: p.product.engineLayers,
    severityRows: [
      { name: 'MUST', count: liveStats.sev.MUST, tone: 'bad' as const },
      { name: 'NEVER', count: liveStats.sev.NEVER, tone: 'bad' as const },
      { name: 'SHOULD', count: liveStats.sev.SHOULD, tone: 'warn' as const },
      { name: 'MAY', count: liveStats.sev.MAY, tone: 'info' as const },
    ],
    mustLimit: liveStats.mustHardLimit,

    projectDirs: p.project.dirs,
    projectPipeline: p.project.pipeline,
    projectRoadmap: p.project.roadmap,
  };
}

// ── 默认档案的展开（消费方不改也能用） ──────────────────────

const DEFAULT_DATA = composeArchViews(getProfile(DEFAULT_PROFILE_ID));

export const VERIFY_CHAIN = DEFAULT_DATA.verifyChain;
export const VERIFY_TOTAL = DEFAULT_DATA.verifyTotal;
export const ARCH_VIEWS = DEFAULT_DATA.views;

export function archViewMeta(id: ArchViewId): ArchViewMeta {
  return ARCH_VIEWS.find((v) => v.id === id) ?? ARCH_VIEWS[0];
}

export const BUSINESS_DOMAINS = DEFAULT_DATA.businessDomains;
export const BUSINESS_OUTLETS = DEFAULT_DATA.businessOutlets;
export const BUSINESS_CONSUMERS = DEFAULT_DATA.businessConsumers;
export const PRODUCT_NON_GOALS = DEFAULT_DATA.productNonGoals;

export const DATA_ASSETS = DEFAULT_DATA.dataAssets;
export const DATA_PIPELINE = DEFAULT_DATA.dataPipeline;
export const DATA_CONSUMERS = DEFAULT_DATA.dataConsumers;
export const DATA_GOVERNANCE = DEFAULT_DATA.dataGovernance;

export const APP_ROUTES = DEFAULT_DATA.appRoutes;
export const APP_ENDPOINTS = DEFAULT_DATA.appEndpoints;
export const APP_LAYERS = DEFAULT_DATA.appLayers;
export const APP_CONTRACTS = DEFAULT_DATA.appContracts;

export const PRODUCT_SURFACES = DEFAULT_DATA.productSurfaces;
export const ENGINE_LAYERS = DEFAULT_DATA.engineLayers;
export const SEVERITY_ROWS = DEFAULT_DATA.severityRows;
export const MUST_LIMIT = DEFAULT_DATA.mustLimit;

export const PROJECT_DIRS = DEFAULT_DATA.projectDirs;
export const PROJECT_PIPELINE = DEFAULT_DATA.projectPipeline;
export const PROJECT_ROADMAP = DEFAULT_DATA.projectRoadmap;
