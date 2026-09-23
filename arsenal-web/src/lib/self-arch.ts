/**
 * 军火库平台自身的架构 —— 出图台的默认图。
 *
 * ## 它为什么是手写的
 *
 * 出图台另外两个输入源都是**算出来的**：装配台选型走 `buildTechArch(picks)`，
 * 代码扫描走 facts → picks。两者都吃 `stack.json` 的 33 个维度 ——
 * 而那 33 维**全是 Java 后端选型**，没有前端维度、没有构建工具链、
 * 也没有「文件系统就是数据库」这个概念。
 *
 * 军火库自己恰好长在这些维度的缝里：前端是 Next.js 静态导出站、后端不接数据库、
 * 事实源是一堆 Git 里的 JSON、出图靠一个 Node 子进程。硬塞进 picks 只会得到
 * 一张严重失真的图（前端整个消失）。所以这份模型按仓库事实手写。
 *
 * ## 与适配器的关系
 *
 * 手写的只是**模型**（有哪些东西、谁连谁、各自什么角色）；版式仍然完全交给
 * `buildArchifyIr()` —— 「车道分配 / 回边绕行 / 标签落点」那套算法是适配器里
 * 最花力气的部分，这里一行都不重写。所以这张图和选型图走同一条产线、
 * 同一套九项构图检查。
 *
 * ## 改这个模型前必读的版式约束
 *
 * `columnOf()` 把分区映射成三列：`client` 独占第一列、`app` 独占第二列，
 * **其余分区（mw / data / ops / platform）全挤在第三列**，每个分区外面套一个
 * region 边框。于是有三条硬约束：
 *
 *   1. **第三列内部不许有连线**。同列跨分区的线必然穿过 region 边框，
 *      而 `container_border_runs`（压边框）是硬失败。第三列的每个节点
 *      都只能是第二列的下游。
 *   2. 跨列连线只能「左列 → 右列」前进。回边（右连左）会被送去绕行导轨，
 *      语义上也不该出现在这张图里。
 *   3. 同一个源分出去的多条线由适配器排车道（各自独立的竖段 x），
 *      这里不必也不该手工错开。
 *
 * 所以「构建期 / 校验期」那些真实存在的关系（内容管道写事实源、verify 扫全仓）
 * **不画成线** —— 它们两端都在第三列，画出来必然违反第 1 条。它们进卡片。
 */

import type { CanvasEdge, CanvasNode, TechArch } from './arch-canvas';
import { buildArchifyIr, type ArchifyCard, type ArchifyIr, type ArchifyView } from './archify-ir';

// ─────────────────────────────────────────────────────────────
// 节点
//
// x / y / w / h 一律给 0：位置由 `layoutColumns()` 算，尺寸由 `sizeOf(kind)` 定。
// 这两个字段在模型里带着值，只会让人误以为改它有用。
//
// `icon` 的取值**必须**是 `tech-icons.ts` 里注册过的 key。它只服务于自研画布那条
// 产线（`buildArchifyIr()` 根本不读它），但 `.verify/project-check.ts` 会扫源码里
// 每一个 `icon: '…'` 字面量并要求可解析 —— 那条断言红得有道理：画布上查不到 key
// 会**静默回落成灰方块**，页面照样渲染、控制台一片安静。
// 所以这里一律从现有库里挑语义最近的，不另起一套命名。
// 「浏览器」→ client、「Next.js」→ nextjs、「Spring」→ spring、
// 「文件事实源」→ fileshare、「Node 渲染器」→ nodejs、「无数据库」→ none。
// ─────────────────────────────────────────────────────────────

const NODES: CanvasNode[] = [
  {
    id: 'browser',
    title: '浏览器',
    subtitle: '打开 3010 静态站',
    icon: 'client',
    zone: 'client',
    kind: 'client',
    tags: [],
    archifyType: 'external',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
  },
  {
    id: 'web',
    title: 'arsenal-web',
    subtitle: 'Next.js 14 · 静态导出',
    icon: 'nextjs',
    zone: 'app',
    kind: 'app',
    tags: [
      { label: '产物', value: 'out/ 纯静态', icon: 'nextjs' },
      { label: '样式', value: 'Tailwind', icon: 'generic' },
    ],
    archifyType: 'frontend',
    brand: 'next-js',
    port: '3010',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
  },
  {
    id: 'server',
    title: 'arsenal-server',
    subtitle: 'Spring Boot 3.2.5 · Java 17',
    icon: 'spring',
    zone: 'app',
    kind: 'app',
    tags: [
      { label: '构建', value: 'Maven', icon: 'maven' },
      { label: '运行时', value: 'JDK 17', icon: 'jdk' },
      { label: '状态', value: '无数据库', icon: 'none' },
    ],
    archifyType: 'backend',
    brand: 'spring',
    port: '3011',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
  },
  {
    id: 'facts',
    title: '事实源 JSON',
    subtitle: '规则 69 · 蓝图 · 选型 · 档案',
    icon: 'fileshare',
    zone: 'data',
    kind: 'component',
    tags: [],
    archifyType: 'database',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
  },
  {
    id: 'renderer',
    title: 'wrench-ai',
    subtitle: '通用出图渲染器 · 子进程',
    icon: 'nodejs',
    zone: 'platform',
    kind: 'side',
    tags: [],
    archifyType: 'cloud',
    brand: 'node-js',
    x: 0,
    y: 0,
    w: 0,
    h: 0,
  },
];

// ─────────────────────────────────────────────────────────────
// 连线
//
// 四跳，全是从左往右：浏览器分两路进第二列，后端分两路进第三列。
// 「浏览器 → 静态站」与「浏览器 → 接口」是两条独立的边而不是串成一条：
// 静态站是纯静态导出，页面加载完之后接口调用跟它没关系 ——
// 串起来会读成「请求先过前端再由前端转发」，那是错的。
// ─────────────────────────────────────────────────────────────

const EDGES: CanvasEdge[] = [
  { from: 'browser', to: 'web', label: '取静态站', kind: 'solid' },
  { from: 'browser', to: 'server', label: '直连接口', kind: 'solid', port: '3011' },
  { from: 'server', to: 'facts', label: '读规则 / 蓝图 / 档案', kind: 'solid' },
  { from: 'server', to: 'renderer', label: '起子进程出图', kind: 'solid' },
];

// ─────────────────────────────────────────────────────────────
// 阅读路径
//
// 三条焦点互不相同（`archifyIrIssues()` 里这是硬错：两条路径焦点一样，
// 点哪条图都没变化，导览等于没生效）。
// 每条的焦点**不含**第三方节点，所以点开有明确的收窄感。
// ─────────────────────────────────────────────────────────────

const VIEWS: ArchifyView[] = [
  {
    id: 'v_request',
    label: '请求进站',
    focus: ['browser', 'web', 'server'],
    note: '浏览器两条路：先取静态站，再直连 3011 的接口',
  },
  {
    id: 'v_facts',
    label: '事实源落点',
    focus: ['server', 'facts'],
    note: '后端自己不存状态 —— 规则与蓝图都从事实源现读',
  },
  {
    id: 'v_render',
    label: '出图链路',
    focus: ['server', 'renderer'],
    note: '版式引擎是别人的 Node 渲染器，后端只起子进程并转述诊断',
  },
];

// ─────────────────────────────────────────────────────────────
// 卡片
//
// 这里是「不画成线的那些事实」的落点，也是这张图的信息密度所在：
// 一张五节点的图如果只有方块和箭头，读不出军火库到底特别在哪。
// ─────────────────────────────────────────────────────────────

const CARDS: ArchifyCard[] = [
  {
    dot: 'cyan',
    title: '这份模型为什么是手写的',
    items: [
      '装配台那 33 个维度全是 Java 后端选型 —— 没有前端、没有构建工具链',
      '军火库自己长在缝里：静态导出站 + 无数据库后端 + Git 里的 JSON 事实源',
      '所以这份拓扑按仓库事实手写，不经过 picks；版式仍交给同一套适配器',
    ],
  },
  {
    dot: 'emerald',
    title: '三个运行时的分工',
    items: [
      'arsenal-web —— next build 导出 out/，任何静态服务器都能托管，不带服务端',
      'arsenal-server —— 69 条规则在启动时一次性载入，改规则必须重启',
      'wrench-ai —— 出图是子进程：后端不参与画图，只喂 IR、转述诊断',
    ],
  },
  {
    dot: 'violet',
    title: '事实源全 Git 化（没有数据库）',
    items: [
      'arsenal-rules/ —— 69 条规则 / 10 个规则文件，手写源，不进内容管道',
      'arsenal-cookbook · stacks · profiles · icons —— 由内容管道生成',
      '一份数据三种出口：人查 / 给 AI 用 / 拿代码验',
    ],
  },
  {
    dot: 'amber',
    title: '刻意不在图上画的两件事',
    items: [
      '内容管道（tools/content → build-content.py → sync-content.mjs）属于构建期',
      '校验链（verify 九层 / 674 项）是离线的，扫的是仓库而不是活着的服务',
      '两者两端都落在第三列，画成线必然穿过 region 边框 —— 那是硬失败',
    ],
  },
];

/** 出图台上「这份 IR 从哪来」的标签 */
export const SELF_ARCH_LABEL = '军火库平台自身（内置）';

/** 默认标题。出图台上可以直接看到它，改这里就等于改默认图的名字 */
export const SELF_ARCH_TITLE = '杨先生的军火库 · 平台架构';

/**
 * 生成默认图的 IR。
 *
 * 纯函数，无副作用 —— 出图台首屏、页签切换、单测都从这一个入口拿，
 * 免得三处各算一遍算出三份不一样的东西。
 */
export function buildSelfArchIr(title: string = SELF_ARCH_TITLE): ArchifyIr {
  const model: TechArch = {
    nodes: NODES,
    edges: EDGES,
    // `zones` / `width` / `height` 是画布那条产线要的，通用绘图器的适配器不读它们
    zones: [],
    width: 0,
    height: 0,
    // 「刻意没引入的东西」由卡片承担 —— 军火库不是选型产物，没有空槽位可列
    absent: [],
  };

  return buildArchifyIr(model, {
    title,
    subtitle: '三个运行时：静态站 3010 · 接口 3011 · 出图子进程',
    qualityProfile: 'showcase',
    // 蓝图预设：这是给交付看的图，不是选型预览
    visualPreset: 'blueprint',
    views: VIEWS,
    cards: CARDS,
  });
}
