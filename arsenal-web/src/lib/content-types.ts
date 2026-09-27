/**
 * 最佳实践案例库（arsenal-cookbook）与技术选型台（arsenal-stacks）的类型定义。
 *
 * 与 types.ts 分开的原因是两者的生命周期不同：
 * 规则集是长期稳定的资产，案例与选型会随技术栈演进而频繁增补。
 */

// ─────────────────────────────────────────────────────────────
// 最佳实践案例库
// ─────────────────────────────────────────────────────────────

/** 代码在系统中的位置。决定展示配色与分组。 */
export type CodeLayer =
  | 'client' | 'web' | 'dto-in' | 'dto-out' | 'service' | 'repo' | 'domain'
  | 'exception' | 'common' | 'config' | 'structure' | 'sql' | 'test'
  | 'concurrency' | 'integration';

/**
 * 一条要点备注。
 *
 * mark 是「片段锚点」——一段必然出现在代码里的原文。
 * 刻意不用行号：代码一改行号就错位，而错位的备注会给出自信的错误结论。
 * 锚点找不到目标时同步脚本直接构建失败，不会静默降级。
 */
export interface Highlight {
  mark: string;
  title: string;
  text: string;
  /** 关联的规则 ID，可跳转到规则详情 */
  rule?: string;
}

export interface FeatureFile {
  id: string;
  path: string;
  layer: CodeLayer;
  lang: string;
  /** 这个文件在整体中承担什么职责 */
  role: string;
  code: string;
  highlights: Highlight[];
}

export interface FlowStep {
  layer: CodeLayer;
  step: string;
  detail: string;
}

export interface FeatureMatrix {
  title: string;
  columns: string[];
  rows: string[][];
  notes: string[];
}

/**
 * 性能 / 量级对照表。
 *
 * 刻意用「列 + 行」而不是一个自由字符串：案例库里的性能说明必须是可核对的，
 * 只给结论不给口径的段落，读者无法判断它是否适用于自己的场景。
 */
export interface FeaturePerformance {
  title: string;
  columns: string[];
  rows: string[][];
  /** 这张表说明了什么。只给表格不给判断，读者没法决策。 */
  conclusion: string;
}

/**
 * 参考出处。
 *
 * 与规则集的 sources 同一套立场：无出处不收录。
 * url 与 note 至少要有一个 —— 标题后面什么都不挂，等于没有出处。
 */
export interface FeatureReference {
  title: string;
  url?: string;
  note?: string;
}

/**
 * 蓝图详情页「模拟测试」（原独立 /playground 案例实验室，已并入案例库）可直接运行的示例。
 *
 * 这是「最佳实践案例库」的第三种出口：人查 / 给 AI 用 / 拿代码验之外，再加「能直接跑」。
 * 每条都是自包含、可在 JDK 21 子进程里独立编译运行的 main 类。
 * files 为数组，单文件 Demo 也走它，以便将来支持多文件示例而无需改数据结构。
 */
export interface PlaygroundFile {
  path: string;
  code: string;
}

export interface PlaygroundDemo {
  id: string;
  label: string;
  mainClass: string;
  /** 自包含的可运行文件清单，随示例一起提交给后端案例执行服务 */
  files: PlaygroundFile[];
  /** 这个示例在演示什么，展示在示例下拉项副标题 */
  note?: string;
}

export interface Feature {
  id: string;
  order: number;
  name: string;
  subtitle: string;
  glyph: string;
  level: string;
  scenario: string;
  intent: string;
  tags: string[];
  relatedRules: string[];
  flow: FlowStep[];
  packages: string[];
  files: FeatureFile[];
  matrix?: FeatureMatrix;
  checklist: string[];
  pitfalls: string[];
  /** 什么时候**不要**用这套写法。案例只有划清边界才敢被当成蓝本复制。 */
  notSuitable: string[];
  /** 性能 / 量级对照，非必填 */
  performance?: FeaturePerformance;
  /** 权威出处，至少两条 */
  references: FeatureReference[];
  /**
   * 详情页「模拟测试」可运行示例，由 tools/content/*.py 的 PLAYGROUND 注入。
   * 事实源（arsenal-cookbook/*.json）里没有这个键，只有同步后的 src/generated/cookbook.json 才有 ——
   * 与 fileCount/highlightCount 等同理，属于「注入字段」。
   */
  playground?: PlaygroundDemo[];
  /**
   * 以下四项**不是**手写内容，由 `scripts/sync-content.mjs` 从 `files[]` 算出后注入 ——
   * 所以 `arsenal-cookbook/*.json`（事实源）里**没有**这四个键，`src/generated/cookbook.json` 里才有。
   *
   * 这里声明成必选，是因为本类型描述的是**同步后的**记录；
   * 「事实源缺字段」与「注入失败」是两件事，后者由 `.verify/project-check.ts`【16】组
   * 对着 generated 快照单独断言（不对事实源假装它有）。
   */
  fileCount: number;
  highlightCount: number;
  ruleCount: number;
  lines: number;
}

/**
 * L3「模拟接口测试」的说明层。
 *
 * demo 本体仍是 PlaygroundDemo（给后端跑的），这里只补三件它说不出来的事：
 * 这一组实验在测什么（intro）、跑完该看到什么（observe）、以及它是不是**真接口**。
 * kind=mock-endpoint 意味着示例自己会起一个 HttpServer 假下游并用 HttpClient 真去打 ——
 * 用 sleep 假装 IO 时，pinning 与背压这类差异一个都暴露不出来。
 */
export interface RecipeLab {
  /** mock-endpoint：起 HttpServer 假下游真打；thread-local：测 per-thread 存储放大 */
  kind: 'mock-endpoint' | 'thread-local';
  /** 这组实验在测什么 */
  intro: string;
  /** 预期现象，至少两条 —— 不给预期，读者看不懂那一屏输出 */
  observe: string[];
}

/**
 * L3 实现方案：这个场景下具体怎么搭。
 *
 * 沿用旧 Feature 的字段（flow / packages / files / checklist / pitfalls / performance），
 * 因为详情页那套渲染器本来就是照着它们写的；新增的是 approach（实现方式）与 lab（实测）。
 */
export interface Recipe {
  id: string;
  order: number;
  name: string;
  /** 实现方式：一句话说清这套方案怎么搭 */
  approach: string;
  flow: FlowStep[];
  packages: string[];
  files: FeatureFile[];
  checklist: string[];
  pitfalls: string[];
  performance?: FeaturePerformance;
  relatedRules: string[];
  lab?: RecipeLab;
  /** 详情页「模拟测试」可运行示例，由 tools/content/*.py 注入 */
  playground?: PlaygroundDemo[];
  /** 以下四项由 scripts/sync-content.mjs 从 files[] 算出后注入 */
  fileCount: number;
  highlightCount: number;
  ruleCount: number;
  lines: number;
}

/** L2 场景：在**什么情况**下该用这个技术。 */
export interface Scenario {
  id: string;
  order: number;
  name: string;
  /** 适用条件，≥30 字，不写「需要的时候」 */
  when: string;
  /** 可核对信号（≥2 条）—— 没有信号，「适用」就只是形容词 */
  signals: string[];
  /** 为什么在这个场景下用它 */
  decision: string;
  /** 什么时候**不要**用（≥2 条） */
  notSuitable: string[];
  recipes: Recipe[];
}

/** L1 技术：解决什么、什么时候该选它、自身边界在哪。 */
export interface Topic {
  id: string;
  order: number;
  name: string;
  subtitle: string;
  glyph: string;
  /** 技术族，仅用于列表页筛选，不单独占一级页面 */
  family: string;
  runtime: string;
  level: string;
  intent: string;
  /** 与其它技术的取舍（≥2 条）—— 外场选择这一层的存在意义就是比较 */
  pickWhen: { vs: string; text: string }[];
  /** 这个技术自身的硬边界（≥2 条） */
  limits: string[];
  references: FeatureReference[];
  scenarios: Scenario[];
  /** 以下由 scripts/sync-content.mjs 注入 */
  scenarioCount: number;
  recipeCount: number;
  fileCount: number;
  highlightCount: number;
  ruleCount: number;
  lines: number;
  demoCount: number;
}

/**
 * 案例库三层判据的共享阈值（W-0）。
 *
 * 唯一的事实源是 `tools/content/cookbook_contract.py` 的 `COOKBOOK_CONTRACT`，
 * 由 `build-content.py` 写进 `arsenal-cookbook/meta.json` 的 `contract`，
 * `sync-content.mjs` 再读同一份做同步期校验 —— 本类型只是它在前端的投影。
 *
 * 把它写成**具名接口**而不是 `Record<string, number>`，是为了让【16】字段契约
 * 能双向守住它：键漏了、值不是数字，都会在结构与导出层当场变红，
 * 而不是等到某条主线「莫名其妙过不了校验」才发现契约少了一个键。
 */
export interface CookbookContract {
  /** intent 最少字数 */
  intent: number;
  /** pickWhen 最少条数 */
  pickWhen: number;
  /** limits 最少条数 */
  limits: number;
  /** references 最少条数 */
  references: number;
  /** when 最少字数 */
  when: number;
  /** signals 最少条数 */
  signals: number;
  /** notSuitable 最少条数 */
  notSuitable: number;
  /** 场景下方案最少条数 */
  recipes: number;
  /** approach 最少字数 */
  approach: number;
  /** 代码文件最少个数 */
  files: number;
  /** 每个文件的要点备注最少数 */
  highlights: number;
  /** checklist 最少条数 */
  checklist: number;
  /** pitfalls 最少条数 */
  pitfalls: number;
  /** lab.observe 最少条数（仅 mock-endpoint） */
  observe: number;
}

/** 案例库的元信息 —— 事实源 `arsenal-cookbook/meta.json`。 */
export interface CookbookMeta {
  collection: string;
  name: string;
  version: string;
  releasedAt: string;
  description: string;
  order: string[];
  count: number;
  scenarioCount: number;
  recipeCount: number;
  demoCount: number;
  families: Record<string, string>;
  /** 三层判据的共享阈值（W-0），键与 tools/content/cookbook_contract.py 一一对应 */
  contract: CookbookContract;
}

export interface Cookbook {
  meta: CookbookMeta;
  topics: Topic[];
}

// ─────────────────────────────────────────────────────────────
// 技术选型台
// ─────────────────────────────────────────────────────────────

export interface Dependency {
  groupId: string;
  artifactId: string;
  version?: string;
  scope?: string;
  /** 非 Maven 依赖（如 Gradle 插件）用这个标记 */
  kind?: string;
  note?: string;
}

export interface ConfigClass {
  className: string;
  path: string;
  code: string;
}

export interface Sample {
  title: string;
  lang: string;
  code: string;
}

export interface StackOption {
  id: string;
  name: string;
  badge?: string;
  summary: string;
  dependencies?: Dependency[];
  pomProperties?: Record<string, string>;
  yaml?: string;
  configClasses?: ConfigClass[];
  sample?: Sample;
  /** 运维动作：要装什么、要建什么 */
  ops?: string[];
  /** 需要的环境变量 */
  env?: { key: string; desc: string }[];
  notes?: string[];
  pitfalls?: string[];
  /**
   * 集群形态表（数据来自 arsenal-stacks/stack.json）。
   * 类型定义在 topology.ts —— 那边要用它算副本数，放这里是循环依赖。
   */
  topology?: unknown;
  /** 该选项的默认形态 id。不选时用它，而不是形态表的第一项 */
  topologyDefault?: string;
}

export interface StackDimension {
  id: string;
  groupId: string;
  name: string;
  why: string;
  defaultOption: string;
  options: StackOption[];
  /** 维度级形态表：这个组件不区分具体产品时（MySQL 与 PostgreSQL 都能做主从）挂在这里 */
  topology?: unknown;
}

export interface StackGroup {
  id: string;
  name: string;
  glyph: string;
  desc: string;
}

export interface Preset {
  id: string;
  name: string;
  badge: string;
  summary: string;
  picks: Record<string, string>;
}

/**
 * 技术栈基底（全局声明，**不是**选型维度）。
 *
 * 为什么不做成维度：架构图把「每个维度 = 图上一个槽位」当硬约束，
 * 而基底是全局属性、不对应任何组件。定义源见 tools/content/stack_base.py 的 BASES。
 */
export interface StackBase {
  id: string;
  name: string;
  vendor: string;
  /** 该基底的版本号；非 Spring 基底可能只是一条线（如 "3.x"） */
  version: string;
  line: string;
  java: string;
  /** supported = 仍在 OSS 支持窗口；eol = 已停止；uncovered = 本平台未覆盖 */
  status: 'supported' | 'eol' | 'uncovered';
  supportedUntil?: string;
  /** 本平台是否已有该基底的骨架 / 规则 / 部署内容（False 时前端只能提示「未覆盖」） */
  covered: boolean;
  recommended?: boolean;
  summary: string;
  note?: string;
}

export interface Stack {
  collection: string;
  name: string;
  version: string;
  releasedAt: string;
  description: string;
  groups: StackGroup[];
  dimensions: StackDimension[];
  bases: StackBase[];
  defaultBase: string;
  presets: Preset[];
}

/** 当前选择：维度 id → 选项 id */
export type StackPicks = Record<string, string>;

// ─────────────────────────────────────────────────────────────
// 部署形态机理剧本（arsenal-stacks/topology_flows.json）
//
// 与《部署形态动画化计划-2026-09-26》§3.1 的字段口径一致，事实源是
// tools/content/stack_topology_flows.py。剧本是数据不是代码：
// 页面机理台按步播放，导出与「给 AI」两种出口共用同一份。
// 字段契约由 .verify/project-check.ts【16】双向比对，别只改一头。
// ─────────────────────────────────────────────────────────────

/** 节点角色：决定配色与自动布局（主在上、从在下、proxy 在左、应用在最左） */
export type TopologyFlowNodeKind =
  | 'client' | 'primary' | 'replica' | 'proxy' | 'store' | 'cache';

export interface TopologyFlowNode {
  id: string;
  label: string;
  kind: TopologyFlowNodeKind;
  /** 显式坐标（左上角）。不给则由 topology-figure.ts 按 kind 自动排 */
  x?: number;
  y?: number;
}

/** 边的类型：实线 = data，虚线 = repl，点线 = heartbeat / route */
export type TopologyFlowEdgeKind = 'data' | 'repl' | 'heartbeat' | 'route';

export interface TopologyFlowEdge {
  id: string;
  from: string;
  to: string;
  kind: TopologyFlowEdgeKind;
}

/** 沿边跑的数据包（分步动画的「主角」） */
export interface TopologyFlowToken {
  edge: string;
  label: string;
}

export interface TopologyFlowStep {
  /** 旁白，≤ 40 字；含数字时必须在所在场景的 refs 里给出出处 */
  caption: string;
  /** 本步高亮的节点 id，必须存在于 nodes */
  highlight?: string[];
  /** 本点点亮的边 id，必须存在于 edges */
  active?: string[];
  /** 沿边跑的数据包 */
  token?: TopologyFlowToken;
}

/** 场景 id 三问：怎么查 / 怎么存 / 挂了怎么办 —— 缺一 build 失败 */
export type TopologyFlowSceneId = 'read' | 'write' | 'failover';

export interface TopologyFlowScene {
  id: TopologyFlowSceneId;
  title: string;
  steps: TopologyFlowStep[];
  /** 数字 / 事实的出处 —— 旁白含数字时必填 */
  refs: string[];
}

export interface TopologyFlow {
  nodes: TopologyFlowNode[];
  edges: TopologyFlowEdge[];
  scenes: TopologyFlowScene[];
}

/** src/generated/topology-flows.json 的顶层形状 */
export interface TopologyFlowDoc {
  collection: string;
  name: string;
  version: string;
  releasedAt: string;
  description: string;
  flowCount: number;
  sceneCount: number;
  stepCount: number;
  /** flows[维度id][选项id][形态id] → 剧本 */
  flows: Record<string, Record<string, Record<string, TopologyFlow>>>;
}

/** 合成产物 */
export interface ComposedStack {
  dependencies: Dependency[];
  properties: Record<string, string>;
  yamlBlocks: { dimName: string; optName: string; body: string }[];
  configClasses: (ConfigClass & { dimName: string; optName: string })[];
  samples: (Sample & { dimName: string; optName: string; layer: CodeLayer })[];
  ops: { dimName: string; optName: string; items: string[] }[];
  env: { key: string; desc: string; dimName: string; optName: string }[];
  notes: { dimName: string; optName: string; items: string[] }[];
  pitfalls: { dimName: string; optName: string; items: string[] }[];
  selected: { dimension: StackDimension; option: StackOption }[];
}

// ── 图标资产库 ──────────────────────────────────────────────
export interface IconCategory {
  id: string;
  name: string;
  accent: string;
  desc: string;
}

/**
 * 一条图标登记。
 *
 * `vector` 指向 tech-icons.ts 的 key（架构图用）；`bitmap` 是 public/icons 下
 * 的相对路径（展示用）。**bitmap 允许为空** —— 位图是分批补的，登记先于产出，
 * 空值表示「这张还没画」，不是「这条数据坏了」。
 */
export interface IconAsset {
  key: string;
  name: string;
  en: string;
  category: string;
  tags: string[];
  vector: string;
  bitmap: string;
  subject: string;
}

export interface IconLibrary {
  collection: string;
  name: string;
  version: string;
  description: string;
  stylePrefix: string;
  categories: IconCategory[];
  count: number;
  bitmapCount: number;
  icons: IconAsset[];
}
