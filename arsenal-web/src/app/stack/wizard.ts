import { dimensions, groups, presets } from '@/lib/stack';
import { lanes, nodeArch } from '@/lib/arch';
import type { StackDimension, StackGroup } from '@/lib/content-types';

/**
 * 装配台向导的步骤模型。
 *
 * 为什么拆成六步：装配台原来把「项目叫什么 / 技术栈是什么 / 数据库缓存选什么 /
 * 每层各装什么 / 每个零件几个副本 / 最后拿走什么」全压在一屏里 —— 33 个槽位、
 * 7 条泳道、五根滑杆、九块预览同时出现在视野里，用户根本不知道从哪儿下手。
 * 拆开之后每一步只回答**一个问题**，并且**上一步的答案决定下一步的候选**：
 *
 *   ① 项目定义  → 项目名 + 形态（形态给出后面每一步的推荐起点）
 *   ② 技术栈基底 → 跑在什么栈上（决定 pom parent / gradle 插件的版本）
 *   ③ 主题框架  → 数据库、缓存、鉴权这些**主题件**各选什么
 *   ④ 分层装配  → 逐层校核，把每层剩下的可选件补齐
 *   ⑤ 部署形态  → 只对**已装上的零件**问「几个实例、怎么摆」
 *   ⑥ 交付      → 产物、图、一键导出
 *
 * 「上层定下层」的落点是三条硬规则，不是文案：
 *   · 形态只在 ① 表态，它把 picks 预填成一套可改的起点；
 *   · ⑤ 只列出已选且不是「不用」的零件 —— 没装的零件没有形态可言；
 *   · 每一步都能回退修改，改了之后下游步骤的候选立刻跟着变（不是一次性问卷）。
 */

export type StepId = 'project' | 'base' | 'theme' | 'layers' | 'topology' | 'delivery';

export interface StepSpec {
  id: StepId;
  glyph: string;
  /** 步骤条上的短名 */
  name: string;
  /** 本步要回答的唯一问题 —— 显示在面板顶部 */
  question: string;
  /** 这一步的答案会怎么影响下一步 —— 写清了「为什么现在要选它」 */
  feeds: string;
}

export const STEPS: StepSpec[] = [
  {
    id: 'project',
    glyph: '◈',
    name: '项目定义',
    question: '这个项目叫什么，长成什么形态？',
    feeds: '形态给出后面每一步的推荐起点，全部可改 —— 它不替你做决定，只是让你不用从 33 个空格开始。',
  },
  {
    id: 'base',
    glyph: '◇',
    name: '技术栈基底',
    question: '整个项目跑在哪条技术栈上？',
    feeds: '基底决定 pom parent / gradle 插件里写的版本号，也决定 JDK 与构建工具的候选。',
  },
  {
    id: 'theme',
    glyph: '▦',
    name: '主题框架',
    question: '数据库、缓存、鉴权这些主题件各选什么？',
    feeds: '主题件一定，④ 分层装配台上对应的槽位就固定下来，剩下的都是可选件。',
  },
  {
    id: 'layers',
    glyph: '⊞',
    name: '分层装配',
    question: '逐层校核 —— 这条流水线还缺什么？',
    feeds: '顶部按「流水线」切换：一次只看一条处理流（接入→应用→数据……），不把 7 泳道一次铺开。装上的零件进入 ⑤，逐个定副本；缺的必选件会被直接点名。',
  },
  {
    id: 'topology',
    glyph: '⋮',
    name: '部署形态',
    question: '每个零件几个实例、怎么摆？',
    feeds: '副本数直接写进 K8s / Compose 清单与形态图，不是一句展示文字。',
  },
  {
    id: 'delivery',
    glyph: '⇩',
    name: '交付',
    question: '这套组合最后长什么样、怎么拿走？',
    feeds: '九块预览全部按当前选型实时算出来，可直接导出成能跑的工程。',
  },
];

export const STEP_BY_ID = new Map(STEPS.map((s) => [s.id, s]));

/** 步骤序号（1 起）。越界返回 0 —— 调用方必须自己处理，不在这里兜底成第一步。 */
export function stepIndex(id: StepId): number {
  return STEPS.findIndex((s) => s.id === id);
}

// ─────────────────────────────────────────────────────────────
// ① 项目形态 —— 出处是事实源的 presets，不在这里另立一套形态表
//
// 用户说的「单体 / 微服务 / 高并发集群」正好是预设在表达的取舍
// （单体最小集 / 云原生微服务 / 高可用集群 / 数据密集……）。
// 另立一张形态表就会出现两处各说一套的「形态」，这是必须避开的。
// ─────────────────────────────────────────────────────────────

export interface ShapeSpec {
  id: string;
  name: string;
  badge: string;
  summary: string;
  /** 该形态会填多少个槽位 —— 让用户一眼看出「起点有多重」 */
  filled: number;
}

export const SHAPES: ShapeSpec[] = presets.map((p) => ({
  id: p.id,
  name: p.name,
  badge: p.badge,
  summary: p.summary,
  filled: Object.values(p.picks ?? {}).filter((v) => typeof v === 'string' && v !== '').length,
}));

// ─────────────────────────────────────────────────────────────
// ③ 主题件判定
//
// 33 个槽位不可能都叫「主题框架」。判定规则全部来自事实源：
//   · 事实源标了 required / recommended 的，就是这个组的主题件
//     （数据库、连接池、鉴权、监控 —— 不装项目就不完整）；
//   · 一个组一个 R/REC 都没有时（中间件组、数据生态组），取该组第一个
//     defaultOption 不是「不用」的维度当主题件（缓存、搜索）——
//     否则这些组在主题框架这一步会整组消失，而用户正是冲着「缓存选什么」来的。
//
// base 组（JDK / 构建工具 / Web 运行时）归 ② 技术栈基底，
// topology 组（全局部署形态）归 ⑤ —— 各归各位，一个维度只出现一次。
// ─────────────────────────────────────────────────────────────

const STEP2_GROUP = 'base';
const STEP5_GROUP = 'topology';

function isKept(dim: StackDimension): boolean {
  const n = nodeArch[dim.id];
  return !!(n?.required || n?.recommended);
}

/** 该维度是否在 ③ 主题框架这一步决定 */
export function isThemeDim(dimId: string): boolean {
  return themeDimIds().has(dimId);
}

let themeCache: Set<string> | null = null;

function themeDimIds(): Set<string> {
  if (themeCache) return themeCache;
  const set = new Set<string>();
  for (const g of groups) {
    if (g.id === STEP2_GROUP || g.id === STEP5_GROUP) continue;
    const members = dimensions.filter((d) => d.groupId === g.id);
    const kept = members.filter(isKept);
    if (kept.length) {
      for (const d of kept) set.add(d.id);
      continue;
    }
    // 整组都没有 R/REC：取第一个「默认装得上」的维度当主题件
    const fallback = members.find((d) => d.defaultOption !== 'none') ?? members[0];
    if (fallback) set.add(fallback.id);
  }
  themeCache = set;
  return set;
}

/** ③ 的分区：组 → 该组要定的主题件。空组不出现（不渲染空分区） */
export interface ThemeSection {
  group: StackGroup;
  dims: StackDimension[];
}

export const THEME_SECTIONS: ThemeSection[] = groups
  .filter((g) => g.id !== STEP2_GROUP && g.id !== STEP5_GROUP)
  .map((g) => ({
    group: g,
    dims: dimensions.filter((d) => d.groupId === g.id && themeDimIds().has(d.id)),
  }))
  .filter((s) => s.dims.length > 0);

// ─────────────────────────────────────────────────────────────
// ④ 分层装配的「流水线」分组
//
// 7 条泳道一次铺开仍然太多。这里把泳道按**处理流**归并成几条流水线，
// ④ 里一次只看一条流水线（含它下面的几层），把「全部 33 块」拆成几屏可消化的。
//
// 分组**只引用事实源的 lane id**（不另立一套泳道表 —— 与形态不另立形态表同理）：
// 一旦 architecture.json 改了泳道，这里要么多一条流水线、要么某条流水线的层数变，
// 不会出现「页面说 A 流、事实源说 B 流」两处各说一套。
// 注意：它跟 `arch.pipelines`（层内请求链路，如 data 泳道的 3 环）是两回事 ——
// 那是「一条泳道里块与块怎么串」，这是「几条泳道怎么归并成流」，互不替代。
// ─────────────────────────────────────────────────────────────

export interface FlowSpec {
  id: string;
  name: string;
  glyph: string;
  desc: string;
  /** 该流包含的泳道（按事实源泳道顺序，保证台面上「请求向下穿过」的连线不串位） */
  laneIds: string[];
}

/** 主请求流：接入 → 应用 → 数据，一次请求真正穿过的链路 */
const FLOW_REQUEST: FlowSpec = {
  id: 'request',
  name: '主请求流',
  glyph: '⇥',
  desc: '接入 → 应用 → 数据：一次请求真正穿过的链路',
  laneIds: ['entry', 'app', 'data'],
};

const FLOW_INFRA: FlowSpec = {
  id: 'infra',
  name: '中间件调度流',
  glyph: '⇉',
  desc: '缓存、消息、注册、调度、搜索、分析、对象存储',
  laneIds: ['infra'],
};

const FLOW_QUALITY: FlowSpec = {
  id: 'quality',
  name: '保障观测流',
  glyph: '⛨',
  desc: '可观测、测试、质量门禁、密钥、日志',
  laneIds: ['quality'],
};

const FLOW_DELIVER: FlowSpec = {
  id: 'deliver',
  name: '交付运行流',
  glyph: '⬢',
  desc: '部署、编排、镜像、CI/CD 与运行时基座',
  laneIds: ['delivery', 'base'],
};

/** 「全部流水线」：保留原来的七层一屏纵览（含层间连线） */
export const FLOW_ALL: FlowSpec = {
  id: 'all',
  name: '全部流水线',
  glyph: '⊞',
  desc: '七条泳道一屏纵览',
  laneIds: lanes.map((l) => l.id),
};

export const FLOWS: FlowSpec[] = [FLOW_REQUEST, FLOW_INFRA, FLOW_QUALITY, FLOW_DELIVER, FLOW_ALL];

export const FLOW_BY_ID = new Map(FLOWS.map((f) => [f.id, f]));

/** 某条流水线当前装了几个 / 总共几个槽位 */
export function flowFilled(flow: FlowSpec, picks: Record<string, string>): { filled: number; total: number } {
  let filled = 0;
  let total = 0;
  for (const laneId of flow.laneIds) {
    for (const d of dimensions) {
      if (nodeArch[d.id]?.lane !== laneId) continue;
      total += 1;
      if (picks[d.id]) filled += 1;
    }
  }
  return { filled, total };
}

/**
 * 维度 → 它在六步向导的哪一步表态。
 *
 * 「补法说去哪个槽位」必须连步骤一起说 —— 只说「运行环境」，
 * 用户在 ④ 的主请求流台面上找不到它（它按组配在 ③，泳道在交付运行流），
 * 就会得出「步骤里没有这个东西」的结论（09-28 真实反馈）。
 * 归属规则与 ③/⑤ 的分区判定同源，不另立一套。
 */
export function stepOfDim(dimId: string): StepId | null {
  const dim = dimensions.find((d) => d.id === dimId);
  if (!dim) return null;
  if (dim.groupId === 'base') return 'base';
  if (dim.groupId === 'topology') return 'topology';
  if (isThemeDim(dimId)) return 'theme';
  return 'layers';
}

/**
 * 维度 → 它挂在哪个分组下（③ 的导航单位是**组**，不是维度）。
 *
 * 「运行环境」在「运行基石」组里 —— 补法只说维度名，用户在 ③ 的导航上
 * 找不到对应入口（导航列的是组名），必须把「组 / 维度」两级一起给
 * （09-28 三次反馈：「只有运行基石，没看到运行环境」）。
 */
export function groupOfDim(dimId: string): StackGroup | null {
  const dim = dimensions.find((d) => d.id === dimId);
  if (!dim) return null;
  return groups.find((g) => g.id === dim.groupId) ?? null;
}

/**
 * 泳道 → 归哪条流水线视图（不含「全部流水线」兜底 —— 拿不到具体流就是拿不到）。
 * 「定位到某槽位」前先切对流水线，否则格子根本不在台面上。
 */
export function flowOfLane(laneId: string): FlowSpec | null {
  return FLOWS.find((f) => f.id !== 'all' && f.laneIds.includes(laneId)) ?? null;
}

// ─────────────────────────────────────────────────────────────
// 项目名与形态的持久化
//
// 与 picks / meta / baseId 分键：它们是「选型」通道，项目名与形态是
// 「这个项目是谁」通道 —— 换一套选型不该把项目名冲掉。
// 读写成对（loadProjectMeta / saveProjectMeta），不留只写的死键。
// ─────────────────────────────────────────────────────────────

const PROJECT_KEY = 'arsenal-stack-project-v1';

export interface ProjectMeta {
  name: string;
  /** 停在哪个步骤。刷新不该把人扔回第一步 —— 六步走到一半被重置是最烦人的一种丢状态 */
  step: StepId;
}

export const DEFAULT_PROJECT: ProjectMeta = { name: 'arsenal-demo', step: 'project' };

const VALID_STEPS = new Set(STEPS.map((s) => s.id));

/**
 * 项目名的合法形态：小写字母开头，段间用点或连字符分隔。
 *
 * 允许连字符是**必须的** —— 它要当 Maven artifactId 用（`order-service` 是常态写法），
 * 而 Java 包名来自事实源的 `basePackage`，不拿这个名字拼包名，所以两者不冲突。
 * 反过来，大写、下划线、以数字开头在 Maven 坐标 / K8s 资源名里都会出事，
 * 所以在这里就拦掉，而不是等解压后 `mvn` 报一个看不懂的错。
 */
const NAME_RE = /^[a-z][a-z0-9]*([.-][a-z0-9]+)*$/;

export function isValidProjectName(name: string): boolean {
  if (!name) return false;
  return NAME_RE.test(name);
}

export function loadProjectMeta(): ProjectMeta {
  if (typeof window === 'undefined') return { ...DEFAULT_PROJECT };
  try {
    const raw = window.localStorage.getItem(PROJECT_KEY);
    if (!raw) return { ...DEFAULT_PROJECT };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_PROJECT };
    const p = parsed as Record<string, unknown>;
    const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : DEFAULT_PROJECT.name;
    const step =
      typeof p.step === 'string' && VALID_STEPS.has(p.step as StepId)
        ? (p.step as StepId)
        : DEFAULT_PROJECT.step;
    return { name, step };
  } catch {
    // 存储坏了 / 手改过：回落默认值，不阻塞装配
    return { ...DEFAULT_PROJECT };
  }
}

export function saveProjectMeta(meta: ProjectMeta): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PROJECT_KEY, JSON.stringify(meta));
  } catch {
    // 存储满 / 隐私模式：项目名本轮不落盘，不阻塞装配
  }
}
