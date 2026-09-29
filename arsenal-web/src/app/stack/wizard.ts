import { dimensions, groups, presets } from '@/lib/stack';
import { lanes, nodeArch } from '@/lib/arch';
import type { StackDimension, StackGroup } from '@/lib/content-types';

/**
 * 装配台向导的步骤模型。
 *
 * 为什么拆成七步、分成两段：装配台原来把「项目叫什么 / 技术栈是什么 / 数据库缓存选什么 /
 * 每层各装什么 / 每个零件几个副本 / 最后拿走什么」全压在一屏里 —— 33 个槽位、
 * 7 条泳道、五根滑杆、九块预览同时出现在视野里，用户根本不知道从哪儿下手。
 * 拆开之后每一步只回答**一个问题**，并且**上一步的答案决定下一步的候选**。
 * 09-28 反馈再进一层：**代码软件架构**与**交付运行**是两类决定，混在一起选太乱 ——
 * 于是向导分成两段，前四步只谈代码架构，后三步专门谈怎么跑起来：
 *
 *   软件架构段 ——
 *   ① 项目定义  → 项目名 + 形态（形态给出后面每一步的推荐起点）
 *   ② 技术栈基底 → 跑在什么栈上（决定 pom parent / gradle 插件的版本）
 *   ③ 主题框架  → 数据库、缓存、消息队列、鉴权这些**代码技术框架**各选什么
 *   ④ 分层装配  → 全量 33 格逐层校核，把可选件补齐（部署形态只在 ⑥ 定）
 *
 *   交付运行段 ——
 *   ⑤ 交付与运行 → 运行环境 / 入口 / 编排 / 制品库 / CI/CD / 监控 / 密钥 / 日志
 *   ⑥ 部署形态  → 只对**已装上的零件**问「几个实例、怎么摆」
 *   ⑦ 交付      → 产物、图、一键导出
 *
 * 「上层定下层」的落点是三条硬规则，不是文案：
 *   · 形态只在 ① 表态，它把 picks 预填成一套可改的起点；
 *   · ⑥ 只列出已选且不是「不用」的零件 —— 没装的零件没有形态可言；
 *   · 每一步都能回退修改，改了之后下游步骤的候选立刻跟着变（不是一次性问卷）。
 */

export type StepId =
  | 'project' | 'base' | 'theme' | 'layers'
  | 'frontend' | 'env' | 'modules'
  | 'deliverRun' | 'topology' | 'delivery';

/** 三段十步的段落归属 —— StepRail 按它插分段标签 */
export type StepSection = 'software' | 'frontend-env' | 'delivery-run';

export interface StepSpec {
  id: StepId;
  glyph: string;
  /** 步骤条上的短名 */
  name: string;
  section: StepSection;
  /** 本步要回答的唯一问题 —— 显示在面板顶部 */
  question: string;
  /** 这一步的答案会怎么影响下一步 —— 写清了「为什么现在要选它」 */
  feeds: string;
}

export const STEPS: StepSpec[] = [
  {
    id: 'project',
    section: 'software',
    glyph: '◈',
    name: '项目定义',
    question: '这个项目叫什么，长成什么形态？',
    feeds: '形态给出后面每一步的推荐起点，全部可改 —— 它不替你做决定，只是让你不用从 33 个空格开始。',
  },
  {
    id: 'base',
    section: 'software',
    glyph: '◇',
    name: '技术栈基底',
    question: '整个项目跑在哪条技术栈上？',
    feeds: '基底决定 pom parent / gradle 插件里写的版本号，也决定 JDK 与构建工具的候选。',
  },
  {
    id: 'theme',
    section: 'software',
    glyph: '▦',
    name: '主题框架',
    question: '数据库、缓存、鉴权这些主题件各选什么？',
    feeds: '主题件一定，④ 分层装配台上对应的槽位就固定下来，剩下的都是可选件。',
  },
  {
    id: 'layers',
    section: 'software',
    glyph: '⊞',
    name: '分层装配',
    question: '逐层校核 —— 这条流水线还缺什么？',
    feeds: '顶部按「流水线」切换：一次只看一条处理流（接入→应用→数据……），把架构侧的可选件补齐。交付类零件不在这里 —— 它们集中在下一步「交付与运行」。装上的零件进入 ⑥，逐个定副本；缺的必选件会被直接点名。',
  },
  {
    id: 'frontend',
    section: 'frontend-env',
    glyph: '❖',
    name: '前端技术栈',
    question: '前端要吗？要的话用什么搭？',
    feeds: '决定 frontend.zip 产不产出、长什么样。Vue3 + Element Plus 是当前唯一完备基底；选「无前端」只导出后端包。勾选功能模块但没有前端时，模块卡会提示管理页没有落点。',
  },
  {
    id: 'env',
    section: 'frontend-env',
    glyph: '⌁',
    name: '环境与连接',
    question: '数据库 / Redis / Nacos 连哪里？连接信息烘进导出包，环境变量仍可覆盖。',
    feeds: '填了 → 导出包零配置直连你给的库；什么都不填 → 占位符保持本机默认；勾「演示模式」用 H2 内存库零依赖启动。密码默认不写入本机存储。',
  },
  {
    id: 'modules',
    section: 'frontend-env',
    glyph: '⛁',
    name: '功能模块',
    question: '要把哪些现成功能模块搭进去？',
    feeds: '每个模块 = 后端接口 + 前端管理页 + 建表种子 SQL（admin/admin123）。勾「角色权限 / 菜单管理」自动带上「用户管理」；与选型冲突的组合会标黄并给修复建议。',
  },
  {
    id: 'deliverRun',
    section: 'delivery-run',
    glyph: '⬢',
    name: '交付与运行',
    question: '这套架构怎么跑起来、怎么交付？（运行环境 / 入口 / 编排 / CI/CD / 监控 / 密钥 / 日志）',
    feeds: '代码架构在 ②③④ 已经定了，这里专门定它的运行与交付面：跑在什么环境上、请求从哪进来、谁负责编排、镜像放哪、怎么构建发布与运维。定完进入 ⑥ 逐个定副本。',
  },
  {
    id: 'topology',
    section: 'delivery-run',
    glyph: '⋮',
    name: '部署形态',
    question: '每个零件几个实例、怎么摆？',
    feeds: '副本数直接写进 K8s / Compose 清单与形态图，不是一句展示文字。',
  },
  {
    id: 'delivery',
    section: 'delivery-run',
    glyph: '⇩',
    name: '交付',
    question: '这套组合最后长什么样、怎么拿走？',
    feeds: '九块预览全部按当前选型实时算出来，可直接导出成能跑的工程。',
  },
];

export const STEP_BY_ID = new Map(STEPS.map((s) => [s.id, s]));

/**
 * 步骤在 `STEPS` 里的下标（**0 起**，就是 `findIndex` 的返回值；找不到返回 -1）。
 *
 * 这里的注释曾写成「1 起」，2026-09-29 P0 拆页时调用方照着它写成
 * `STEPS[stepIndex(id) - 1]` —— 首页第一步落成 `STEPS[-1]`，
 * `/stack` 预渲染当场 Cannot read properties of undefined。
 * 按数组下标用即可；只想「按 id 取步骤对象」的话直接用 `STEP_BY_ID`，
 * 绕开这个 off-by-one 的可能。
 */
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
// 09-28 八反馈定案：③ 主题框架是**全部代码架构维度**的唯一选型处 ——
// 一个决定只有一个入口。凡不是 ② 基底（base 组）、不是 ⑥ 部署形态
// （topology 组）、不是 ⑤ 交付运行段（RUN_GROUP_IDS 三组）的维度，
// 一律进 ③（共 19 维）。七步结构因此定型：
//   代码技术框架 → ③ 一次表态完；部署运维 → ⑤ 整组表态；部署形态 → 只在 ⑥。
//
// ④ 分层装配不再是选型处（原先「④ 也能改缓存」与 ③ 重复，两处入口
// 必然改一处忘一处）：它变成只读校核台 —— 看结构、链路、隐患、缺件，
// 点卡片直达归属步骤。判定就是上面三行排除，不再需要事实源 R/REC
// 标记或 fallback 兜底。
// ─────────────────────────────────────────────────────────────

const STEP2_GROUP = 'base';
const STEP6_GROUP = 'topology';

/**
 * 交付运行段（⑤ 交付与运行）吸收的事实源组 —— 09-28 反馈：架构选择就选代码
 * 软件架构，交付相关的单独一个流程。这三个组（运行基石 / 交付与运行 / 运维安全）
 * 回答的都是「怎么跑起来、怎么运维」，与代码架构是两类决定。
 * 口径与组一一对应：整组进 ⑤，不拆组 —— 拆组会出现「运行基石一半在 ③ 一半在 ⑤」。
 */
export const RUN_GROUP_IDS = new Set(['runtime', 'delivery', 'ops']);

let themeCache: Set<string> | null = null;

/** 进 ③ 表态的维度全集：排除 ②/⑥/⑤ 的组，剩下的组整组全收（19 维） */
function themeDimIds(): Set<string> {
  if (themeCache) return themeCache;
  const set = new Set<string>();
  for (const g of groups) {
    if (g.id === STEP2_GROUP || g.id === STEP6_GROUP || RUN_GROUP_IDS.has(g.id)) continue;
    for (const d of dimensions) {
      if (d.groupId === g.id) set.add(d.id);
    }
  }
  themeCache = set;
  return set;
}

/** ③ 的分区：组 → 该组要表态的维度（②/⑥/⑤ 之外的组**全量**进 ③，共 19 维）。空组不出现 */
export interface ThemeSection {
  group: StackGroup;
  dims: StackDimension[];
}

export const THEME_SECTIONS: ThemeSection[] = groups
  .filter((g) => g.id !== STEP2_GROUP && g.id !== STEP6_GROUP && !RUN_GROUP_IDS.has(g.id))
  .map((g) => ({
    group: g,
    dims: dimensions.filter((d) => d.groupId === g.id && themeDimIds().has(d.id)),
  }))
  .filter((s) => s.dims.length > 0);

/** ⑤ 交付与运行的分区：交付运行段的三组，组内**全量**维度（不分主题件与否） */
export const RUN_SECTIONS: ThemeSection[] = groups
  .filter((g) => RUN_GROUP_IDS.has(g.id))
  .map((g) => ({
    group: g,
    dims: dimensions.filter((d) => d.groupId === g.id),
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

/**
 * ④ 分层装配只管**架构侧**泳道 —— delivery / base 两条泳道（交付形态、编排、
 * 制品库、运行环境）整体归 ⑤ 交付与运行（09-28 反馈：架构选择就选代码架构，
 * 交付单独一个流程，两处都混着选就乱了）。泳道图少两条但每条仍有内容，
 * 「请求向下穿过」的连线在架构段内部保持完整。
 */
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
  desc: '可观测、测试、质量门禁（监控 / 密钥 / 日志在 ⑤ 交付与运行）',
  laneIds: ['quality'],
};

/** 「全部架构流水线」：架构侧五条泳道一屏纵览（含层间连线） */
export const FLOW_ALL: FlowSpec = {
  id: 'all',
  name: '全部流水线',
  glyph: '⊞',
  desc: '架构侧五条泳道一屏纵览（交付运行两条泳道在 ⑤）',
  laneIds: lanes.filter((l) => l.id !== 'delivery' && l.id !== 'base').map((l) => l.id),
};

export const FLOWS: FlowSpec[] = [FLOW_REQUEST, FLOW_INFRA, FLOW_QUALITY, FLOW_ALL];

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
 * 维度 → 它在七步向导的哪一步表态。
 *
 * 「补法说去哪个槽位」必须连步骤一起说 —— 只说「运行环境」，
 * 用户在台面上找不到它，就会得出「步骤里没有这个东西」的结论（09-28 真实反馈）。
 * 归属规则与 ③/⑤ 的分区判定同源，不另立一套。交付运行组（runtime/delivery/ops）
 * 一律归 ⑤ 交付与运行；②/⑥/⑤ 之外的**全部**归 ③ —— 09-28 八反馈起 ④ 分层装配
 * 是只读校核台，不再拥有任何维度的选型权。
 */
export function stepOfDim(dimId: string): StepId | null {
  const dim = dimensions.find((d) => d.id === dimId);
  if (!dim) return null;
  if (dim.groupId === 'base') return 'base';
  if (dim.groupId === 'topology') return 'topology';
  if (RUN_GROUP_IDS.has(dim.groupId)) return 'deliverRun';
  return 'theme';
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
 * 交付运行泳道（delivery / base）归 ⑤ 后不在 ④ 的任何流里 —— 返回 null，
 * 调用方按「不需要切流」处理即可（⑤ 整屏只有交付件，不存在对不准的问题）。
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
  /** 停在哪个步骤。刷新不该把人扔回第一步 —— 七步走到一半被重置是最烦人的一种丢状态 */
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

// ─────────────────────────────────────────────────────────────
// P0 四页（2026-09-29 拍板）：十步在四页上的分布
//
// 装配台原先是 `/stack` 单路由塞三段十步 —— 选型 / 环境 / 运行 / 交付
// 四种心智挤在一屏，所以按**心智**拆成四页（拆法 A）；三段十步的 StepId
// 顺序**一个都没动**，变的只是它们落在哪一页。
//
// 「哪一步在哪一页」只许在这里说一次。四个页面容器、JourneyBar、StepRail
// 的跨页跳转、以及刷新时「step → 路由」的恢复映射，全是这张表的消费方。
// 另立一张就会出现「页面说第 ⑧ 步在这页、步骤条说它在那页」的对不上。
// ─────────────────────────────────────────────────────────────

export type StackPageId = 'software' | 'env' | 'run' | 'delivery';

export interface StackPageSpec {
  id: StackPageId;
  route: string;
  name: string;
  glyph: string;
  /** 本页承载的步骤（顺序即页内步骤条顺序） */
  steps: StepId[];
}

export const STACK_PAGES: StackPageSpec[] = [
  {
    id: 'software',
    route: '/stack',
    name: '选型台',
    glyph: '◈',
    steps: ['project', 'base', 'theme', 'layers'],
  },
  {
    id: 'env',
    route: '/stack/env',
    name: '环境与模块',
    glyph: '❖',
    steps: ['frontend', 'env', 'modules'],
  },
  {
    id: 'run',
    route: '/stack/run',
    name: '运行与部署',
    glyph: '⬢',
    steps: ['deliverRun', 'topology'],
  },
  {
    id: 'delivery',
    route: '/stack/delivery',
    name: '交付中心',
    glyph: '⇩',
    steps: ['delivery'],
  },
];

/** 步骤 → 它所属的页（刷新恢复用） */
export const PAGE_ID_OF_STEP: Record<StepId, StackPageId> = Object.fromEntries(
  STACK_PAGES.flatMap((p) => p.steps.map((s) => [s, p.id] as const))
) as Record<StepId, StackPageId>;

export const PAGE_OF_STEP: Record<StepId, string> = Object.fromEntries(
  STACK_PAGES.flatMap((p) => p.steps.map((s) => [s, p.route] as const))
) as Record<StepId, string>;

export function pageOfStep(step: StepId): StackPageSpec | null {
  return STACK_PAGES.find((p) => p.id === PAGE_ID_OF_STEP[step]) ?? null;
}

/**
 * 段 → 该段**首页**的路由。
 *
 * 注意 delivery-run 段跨了两页（⑧⑨ 在「运行与部署」、⑩ 在「交付中心」）——
 * 所以这里是「段的首页」而不是「段唯一页」；精确的归属一律用 `PAGE_OF_STEP`。
 */
export const SECTION_ROUTE: Record<StepSection, string> = Object.fromEntries(
  (['software', 'frontend-env', 'delivery-run'] as StepSection[]).map((s) => [
    s,
    (STACK_PAGES.find((p) => (STEPS.find((x) => x.id === p.steps[0])?.section ?? '') === s) ??
      STACK_PAGES[0]).route,
  ])
) as Record<StepSection, string>;
