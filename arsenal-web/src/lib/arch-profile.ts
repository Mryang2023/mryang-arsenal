/**
 * 六视图的项目档案层。
 *
 * ── 为什么要有这一层 ─────────────────────────────────────────
 * /arch 的六张图原本把文案写死在 `arch-views.ts` 里，于是它只能讲军火库
 * 自己的故事：换一个项目，六张图无从下手。这一层把「人写的话」抽成
 * `arsenal-profiles/<id>.json`，渲染器变成纯读档案 —— 换项目 = 加一份
 * 档案，代码零改动。
 *
 * ── 一条硬规矩：能算的数字不许写进档案 ───────────────────────
 * 档案里任何平台自己算得出来的数字（规则条数、案例行数、维度数…）
 * 都必须写成 `{{token}}`，由这里在构建期解出来。写死一个「69 条」，
 * 改一次事实源它就变成一句自信的错话 —— 而错话不会报错，只会一直显示。
 * 所以校验分两层：
 *   ① 构建期（`scripts/sync-content.mjs`）：形状、六视图齐不齐、token 语法；
 *   ② 自检期（`project-check.ts`）：解析出来的数字必须与真实数据对得上。
 *
 * ── token 从哪来 ────────────────────────────────────────────
 * 全部由真实数据算出，注册表就在下面 `buildMetrics()` 一处。
 * 加一个 token 就必须在这里登记，否则档案里写了也解不开（会被校验拦下）。
 */
import { cookbookStats } from '@/lib/cookbook';
import { liveStats, orderedCategories } from '@/lib/rules';
import { dimensions, presets } from '@/lib/stack';

// ── 视图身份 ────────────────────────────────────────────────
//
// 六个 id 是**渲染器的契约**，不是档案的自由度：每个 id 对应一支手绘图的
// 图标与封面插画。所以 id / 中文名 / 英文名 / 主题色留在代码里，
// 档案只负责「这个项目在这六个面上写了什么话」。

export type ArchViewId = 'business' | 'data' | 'app' | 'tech' | 'product' | 'project';

export const ARCH_VIEW_IDS: ArchViewId[] = ['business', 'data', 'app', 'tech', 'product', 'project'];

/** 视图身份表。渲染器按 id 取图标与插画，档案按 id 提供文案。 */
export const ARCH_VIEW_IDENTITY: Record<ArchViewId, { name: string; english: string; glyph: string; accent: string }> = {
  business: { name: '业务架构', english: 'Business', glyph: '⬢', accent: '#3E9B4F' },
  data: { name: '数据架构', english: 'Data', glyph: '▤', accent: '#2F6FBA' },
  app: { name: '应用架构', english: 'Application', glyph: '⬡', accent: '#D97B29' },
  tech: { name: '技术架构', english: 'Technology', glyph: '▣', accent: '#7C5CBF' },
  product: { name: '产品架构', english: 'Product', glyph: '◈', accent: '#0F9B8E' },
  project: { name: '项目架构', english: 'Project', glyph: '▦', accent: '#C4453C' },
};

// ── 档案形状 ────────────────────────────────────────────────

export interface ProfileViewText {
  definition: string;
  focus: string[];
  question: string;
  outputs: string[];
}

export interface ArchProfile {
  id: string;
  name: string;
  subtitle?: string;
  /** 档案自己的使用说明。允许换行，页面会原样显示 */
  note?: string;
  views: Record<ArchViewId, ProfileViewText>;
  business: {
    domains: { name: string; desc: string; metric?: string }[];
    outlets: { name: string; desc: string; glyph?: string }[];
    consumers: string[];
    nonGoals: string[];
  };
  data: {
    assets: { path: string; name: string; metric: string; desc: string }[];
    pipeline: { name: string; desc: string; glyph?: string }[];
    consumers: string[];
    governance: string[];
  };
  app: {
    /** `@routes` 是保留值：等于上面 routes 的全部页面名，避免手抄一遍又抄错 */
    routes: { path: string; name: string; desc: string }[];
    endpoints: { group: string; items: string[] }[];
    layers: { name: string; desc: string; items: string | string[] }[];
    contracts: string[];
  };
  product: {
    surfaces: { name: string; desc: string }[];
    engineLayers: { name: string; status: 'done' | 'todo'; metric: string; desc: string }[];
  };
  project: {
    dirs: { path: string; role: string }[];
    pipeline: string[];
    verifyChain: { name: string; count: number; desc: string }[];
    roadmap: { name: string; desc: string; tone: 'key' | 'done' | 'next' | 'later' }[];
  };
}

// ── 度量注册表 ──────────────────────────────────────────────
//
// 只登记**真实数据算得出来的**东西。档案里写 `{{rules.total}}`，
// 这里解成 69；事实源一变，六张图跟着变，没有人需要记得去改文案。

export function buildMetrics(verifyTotal?: number): Record<string, number> {
  const m: Record<string, number> = {
    'rules.total': liveStats.total,
    'rules.categories': orderedCategories.length,
    'rules.mustClass': liveStats.mustClass,
    'rules.mustHardLimit': liveStats.mustHardLimit,
    'rules.regexCapable': liveStats.regexCapable,
    'rules.astCapable': liveStats.astCapable,
    'rules.llmCapable': liveStats.llmCapable,
    'cookbook.features': cookbookStats.features,
    'cookbook.scenarios': cookbookStats.scenarios,
    'cookbook.recipes': cookbookStats.recipes,
    'cookbook.demos': cookbookStats.demos,
    'cookbook.files': cookbookStats.files,
    'cookbook.lines': cookbookStats.lines,
    'cookbook.highlights': cookbookStats.highlights,
    'stack.dimensions': dimensions.length,
    'stack.presets': presets.length,
  };
  // verify.total 由档案自己的 verifyChain 求和得出 —— 所以只能在外面先算好再传进来
  if (typeof verifyTotal === 'number') m['verify.total'] = verifyTotal;
  return m;
}

export const METRIC_TOKENS: string[] = Object.keys(buildMetrics());

/** token 语法。故意只认 `{{a.b}}` 这一种，不做表达式，免得档案变成一门语言。 */
const TOKEN_RE = /\{\{([A-Za-z][A-Za-z0-9.]*)\}\}/g;

/**
 * 把一条字符串里的 token 全部解成数字。
 *
 * 解不开的 token **原样留着**，不静默换成空串 —— 界面上出现
 * `{{rules.total}}` 这种字面量一眼就知道档案写错了，比显示一片空白强。
 * 校验层会把它当失败拦下。
 */
export function resolveTokens(text: string, metrics: Record<string, number>): string {
  return text.replace(TOKEN_RE, (whole, key: string) =>
    key in metrics ? String(metrics[key]) : whole
  );
}

/** 递归解开一份结构里的所有字符串（含数组与对象）。`@routes` 由调用方处理。 */
function resolveDeep<T>(value: T, metrics: Record<string, number>): T {
  if (typeof value === 'string') return resolveTokens(value, metrics) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => resolveDeep(v, metrics)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveDeep(v, metrics);
    }
    return out as T;
  }
  return value;
}

/** 档案里出现过的、注册表里没有的 token。空数组即全部可解。 */
export function unknownTokens(raw: unknown, metrics: Record<string, number>): string[] {
  const found = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      for (const m of v.matchAll(TOKEN_RE)) if (!(m[1] in metrics)) found.add(m[1]);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        // `note` 是档案写给人的使用说明，允许它引述 token 语法本身
        // （「数字一律写成 {{rules.total}} 这样」）—— 那不是要解开的 token。
        if (k === 'note') continue;
        walk(val);
      }
    }
  };
  walk(raw);
  return [...found];
}

// ── 解析成渲染器要的形状 ────────────────────────────────────

export interface ResolvedProfile extends ArchProfile {
  /** 解完 token 的档案 + 派生的 verifyTotal */
  verifyTotal: number;
}

/**
 * 先把 verifyChain 求和得到 `verify.total`，再整体解 token。
 * 顺序不能反：`{{verify.total}}` 出现在 project 视图的正文里，
 * 而它的值恰恰由同一份档案的 verifyChain 决定。
 */
export function resolveProfile(raw: ArchProfile, base: Record<string, number>): ResolvedProfile {
  const verifyTotal = (raw.project?.verifyChain ?? []).reduce((n, v) => n + (v.count ?? 0), 0);
  const metrics = { ...base, 'verify.total': verifyTotal };
  return { ...resolveDeep(raw, metrics), verifyTotal };
}

// ── 档案自检 ────────────────────────────────────────────────

/**
 * 结构自检。构建期（sync）跑一次、自检期（project-check）再跑一次 ——
 * 手改 JSON 的人绕不过去。
 *
 * 这里只管**形状**（缺字段、id 不对、token 写错）；数字对不对是自检期的事。
 */
export function archProfileShapeIssues(raw: unknown): string[] {
  const issues: string[] = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return ['档案顶层必须是 JSON 对象'];
  }
  const p = raw as Record<string, unknown>;

  for (const key of ['id', 'name'] as const) {
    if (typeof p[key] !== 'string' || !(p[key] as string).trim()) issues.push(`缺少 ${key}`);
  }

  const views = p.views as Record<string, unknown> | undefined;
  if (views === null || typeof views !== 'object') {
    issues.push('缺少 views 段 —— 六个视图的文案都在这里');
  } else {
    for (const id of ARCH_VIEW_IDS) {
      const v = views[id] as Record<string, unknown> | undefined;
      if (v === null || typeof v !== 'object') {
        issues.push(`views.${id} 缺失`);
        continue;
      }
      for (const field of ['definition', 'question'] as const) {
        if (typeof v[field] !== 'string' || !(v[field] as string).trim()) {
          issues.push(`views.${id}.${field} 不能为空`);
        }
      }
      for (const field of ['focus', 'outputs'] as const) {
        const arr = v[field];
        if (!Array.isArray(arr) || arr.length === 0) issues.push(`views.${id}.${field} 必须是非空数组`);
      }
    }
    // 多余键也算错：写错 id 的那一份不会有人读，只会让人以为「怎么不生效」
    for (const key of Object.keys(views)) {
      if (!ARCH_VIEW_IDS.includes(key as ArchViewId)) issues.push(`views 里有不认识的视图 id「${key}」`);
    }
  }

  const requireArray = (path: string, val: unknown) => {
    if (!Array.isArray(val) || val.length === 0) issues.push(`${path} 必须是非空数组`);
  };
  const biz = p.business as Record<string, unknown> | undefined;
  requireArray('business.domains', biz?.domains);
  requireArray('business.outlets', biz?.outlets);
  const dat = p.data as Record<string, unknown> | undefined;
  requireArray('data.assets', dat?.assets);
  requireArray('data.pipeline', dat?.pipeline);
  const app = p.app as Record<string, unknown> | undefined;
  requireArray('app.routes', app?.routes);
  requireArray('app.layers', app?.layers);
  const prod = p.product as Record<string, unknown> | undefined;
  requireArray('product.surfaces', prod?.surfaces);
  requireArray('product.engineLayers', prod?.engineLayers);
  const proj = p.project as Record<string, unknown> | undefined;
  requireArray('project.dirs', proj?.dirs);
  requireArray('project.verifyChain', proj?.verifyChain);

  const chain = proj?.verifyChain as { count?: unknown }[] | undefined;
  if (Array.isArray(chain)) {
    chain.forEach((seg, i) => {
      if (typeof seg?.count !== 'number' || seg.count <= 0) {
        issues.push(`project.verifyChain[${i}].count 必须是正整数（自检项数不是估的）`);
      }
    });
  }

  return issues;
}

/** 页面上「档案选择器」要的那点元信息。 */
export interface ProfileSummary {
  id: string;
  name: string;
  subtitle?: string;
  note?: string;
  /** 内置档案（随仓库进版本）还是用户导入的（只在本地浏览器里） */
  builtin: boolean;
}
