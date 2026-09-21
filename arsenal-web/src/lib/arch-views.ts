import { cookbookStats } from '@/lib/cookbook';
import { liveStats, meta, orderedCategories } from '@/lib/rules';
import { dimensions, presets } from '@/lib/stack';

/**
 * 六大架构视图的数据层。
 *
 * 对应「一图讲清 6 大架构」的口径：业务 / 数据 / 应用 / 技术 / 产品 / 项目。
 * 硬约定与整个军火库一致 —— **每个数字都从真实数据算出来**，不写死
 * 「62 条」这种会过期的常量；只有「验证链分项」这类工程事实（与 README
 * 同源）才允许落在唯一一处常量里，改口径时两处一起改。
 */

// ── 视图元数据（页签 + 六宫格头卡共用） ─────────────────────────

export type ArchViewId = 'business' | 'data' | 'app' | 'tech' | 'product' | 'project';

/**
 * 验证链分项。工程事实，与 README「自检」表同源 —— 改口径时两处一起改。
 * 定义在文件最前面：视图定义文案里要引用 VERIFY_TOTAL，const 有暂时性死区，
 * 放后面会让 ARCH_VIEWS 在模块初始化时直接 ReferenceError。
 */
export const VERIFY_CHAIN: { name: string; count: number; desc: string }[] = [
  { name: '架构判定', count: 35, desc: '能力并集 / 缺口 / 组合策略' },
  { name: '图与交互', count: 59, desc: '依赖边 / 版式边 / 交互钩子' },
  { name: '结构与导出', count: 312, desc: '目录树 / 部署产物 / 导出包 / zip 解压复验 / 导航与页签契约' },
  { name: '引擎样本', count: 17, desc: '正则层真检出与 skipped 披露' },
  { name: '前后端一致性', count: 12, desc: '探针实跑导出比对 + 活服务体检' },
  { name: 'Archify 链路', count: 29, desc: 'IR 适配 / 出图 / 护栏' },
];

export const VERIFY_TOTAL = VERIFY_CHAIN.reduce((n, v) => n + v.count, 0);

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

export const ARCH_VIEWS: ArchViewMeta[] = [
  {
    id: 'business',
    name: '业务架构',
    english: 'Business',
    glyph: '⬢',
    accent: '#3E9B4F',
    definition: '定义军火库为谁创造什么价值：把个人工程规范收敛成机器可校验的数据，服务「人查、给 AI 用、拿代码验」三种消费方式。',
    focus: ['规范字典', '能力域', '三种出口', '单人 + 小团队'],
    question: '军火库提供什么能力？为谁服务、经什么渠道消费？',
    outputs: ['能力地图', '三种出口链路', '服务边界（不做什么）'],
  },
  {
    id: 'data',
    name: '数据架构',
    english: 'Data',
    glyph: '▤',
    accent: '#2F6FBA',
    definition: '规划规范数据如何被定义、构建、分发与治理：arsenal-{rules,cookbook,stacks} 是唯一事实源，JSON 是载体，管道是脚本。',
    focus: ['Rule as Data', '事实源唯一', '构建管道', '锚点治理'],
    question: '数据从哪里来、经谁加工、被谁消费、怎么防漂移？',
    outputs: ['数据资产清单', '构建链路图', '治理规则（锚点 / 换行 / 交叉校验）'],
  },
  {
    id: 'app',
    name: '应用架构',
    english: 'Application',
    glyph: '⬡',
    accent: '#D97B29',
    definition: '定义系统如何分层、集成与协作：Next.js 静态站 + Spring Boot 只读服务的双层单体，前端渲染、后端出图与校验。',
    focus: ['系统分层', '路由 × 接口', '前后端契约', '降级策略'],
    question: '有哪些系统、怎么连接、功能如何承载？',
    outputs: ['分层地图', '接口清单', '一致性与降级约定'],
  },
  {
    id: 'tech',
    name: '技术架构',
    english: 'Technology',
    glyph: '▣',
    accent: '#7C5CBF',
    definition: '定义应用运行所依赖的技术底座：按选型装配出会被部署的东西 —— 客户端、应用进程、中间件、数据存储与观测运维。',
    focus: ['云平台', '中间件', '数据库', '开发与运维技术'],
    question: '系统在什么技术底座上、如何稳定高效扩展？',
    outputs: ['技术栈图', '部署架构图', '技术说明书（三张表）'],
  },
  {
    id: 'product',
    name: '产品架构',
    english: 'Product',
    glyph: '◈',
    accent: '#0F9B8E',
    definition: '从用户需求出发规划产品功能与演进路线：六个功能面覆盖「写规则 → 装配 → 校验 → 交付」全流程，引擎三层按台阶演进。',
    focus: ['功能结构', '校验引擎三层', '严重度配额', '演进路线'],
    question: '产品提供什么能力、如何满足「让 AI 守规矩」、如何迭代？',
    outputs: ['功能地图', '引擎分层视图', '不做清单'],
  },
  {
    id: 'project',
    name: '项目架构',
    english: 'Project',
    glyph: '▦',
    accent: '#C4453C',
    definition: `围绕目标交付组织项目实施方式：仓库分区、构建链、${VERIFY_TOTAL} 项验证链与里程碑，保证单人也能持续安全地改。`,
    focus: ['仓库分区', '构建链', '验证链', '里程碑'],
    question: '怎么推进、谁验证、何时交付、风险在哪？',
    outputs: ['仓库结构树', '验证链分解', '待推进清单'],
  },
];

export function archViewMeta(id: ArchViewId): ArchViewMeta {
  return ARCH_VIEWS.find((v) => v.id === id) ?? ARCH_VIEWS[0];
}

// ── 业务架构：能力域 × 三种出口 ─────────────────────────────────

export interface CapabilityDomain {
  name: string;
  desc: string;
  /** 从真实数据算出的度量（展示用） */
  metric: string;
}

export const BUSINESS_DOMAINS: CapabilityDomain[] = [
  {
    name: '规范字典',
    desc: `${orderedCategories.length} 大类工程规范，每条必须带 bad/good 示例，写不出的不收录`,
    metric: `${liveStats.total} 条 · ${orderedCategories.length} 类`,
  },
  {
    name: '最佳实践蓝图',
    desc: '按功能切片的真实代码案例，备注用片段锚点钉在代码上',
    metric: `${cookbookStats.features} 切片 · ${cookbookStats.lines} 行`,
  },
  {
    name: '选型装配',
    desc: '选项声明 provides/requires，能力并集求解缺口 —— 可运行性由数据决定',
    metric: `${dimensions.length} 个维度 · ${presets.length} 套预设`,
  },
  {
    name: '合规校验',
    desc: 'Level 1 正则可真检出；正则之外的层一律如实报 skipped，绝不伪造判定',
    metric: `${liveStats.regexCapable} 条可真检出`,
  },
  {
    name: '交付出口',
    desc: '同一份选型导出可运行工程、约束 prompt、架构图与技术说明书',
    metric: '工程 zip · prompt · 图谱',
  },
];

export const BUSINESS_OUTLETS = [
  { name: '人查', desc: '规则库 / 蓝图库 / 装配台页面，人直接翻', glyph: '☼' },
  { name: '给 AI 用', desc: '约束 prompt 片段、导出数据，贴给任何 AI', glyph: '✦' },
  { name: '拿代码验', desc: 'POST /api/lint，上传代码按规范逐条判', glyph: '⛨' },
] as const;

export const BUSINESS_CONSUMERS = ['mryang 本人', 'AI 编码助手', 'CI / 校验台'] as const;

export const PRODUCT_NON_GOALS = [
  '不做 auto-fix —— 判定与修复分离，越权修复比报错更危险',
  '不绑定某家 AI 的代理 —— 规范属于人，不属于某个模型',
  '不做规则市场 / 多租户 SaaS —— 上限单人 + 小团队（≤10 人）',
] as const;

// ── 数据架构：资产 → 构建 → 分发 ───────────────────────────────

export interface DataAsset {
  path: string;
  name: string;
  metric: string;
  desc: string;
}

export const DATA_ASSETS: DataAsset[] = [
  {
    path: 'arsenal-rules/**/*.json',
    name: '规则集',
    metric: `${liveStats.total} 条 · ${liveStats.mustClass}/${liveStats.mustHardLimit} 强制配额`,
    desc: `${orderedCategories.length} 大类，MUST+NEVER 硬上限 ${liveStats.mustHardLimit}，schema 约束字段`,
  },
  {
    path: 'arsenal-cookbook/*.json',
    name: '蓝图库',
    metric: `${cookbookStats.features} 切片 · ${cookbookStats.files} 文件 · ${cookbookStats.lines} 行`,
    desc: `${cookbookStats.highlights} 处高亮备注，全部用片段锚点定位，不用行号`,
  },
  {
    path: 'arsenal-stacks/*.json',
    name: '选型数据',
    metric: `${dimensions.length} 维 · ${presets.length} 预设 · 画布 / 依赖图声明`,
    desc: '选项声明 provides/requires，装配判定全部由数据驱动',
  },
];

export const DATA_PIPELINE = [
  { name: 'tools/content/*.py', desc: '内容源：改内容改这里，不改 JSON', glyph: '✎' },
  { name: 'build-content.py', desc: '构建：写 JSON 必须 newline=\\n，防 CRLF 假变更', glyph: '⚙' },
  { name: '*.json（事实源）', desc: 'Git 化的唯一事实源，三种出口都读它', glyph: '▤' },
  { name: 'sync-content.mjs', desc: '同步：构建期校验锚点存在性，找不到即失败', glyph: '⇄' },
] as const;

export const DATA_CONSUMERS = [
  '前端静态导入（构建期读取，缺失即构建失败）',
  'arsenal-server 启动只读（规则 / 导出 / lint）',
  '导出 zip（README 只报「算出来的」缺失类）',
] as const;

export const DATA_GOVERNANCE = [
  '片段锚点替代行号 —— 代码一动行号就废，锚点找不到直接构建失败',
  '双向交叉校验 —— 结构树与选型数据互相核对，两个脚本各跑一遍',
  '非正则层如实 skipped —— 宁可少判，不伪造判定结果',
] as const;

// ── 应用架构：路由 × 接口 × 分层 ───────────────────────────────

export const APP_ROUTES: { path: string; name: string; desc: string }[] = [
  { path: '/', name: '概览', desc: '军火库全景与统计' },
  { path: '/rules', name: '规则库', desc: `${liveStats.total} 条规范，按类检索` },
  { path: '/blueprints', name: '最佳实践案例库', desc: `${cookbookStats.features} 切片 · ${cookbookStats.lines} 行真实代码` },
  { path: '/stack', name: '装配台', desc: `${dimensions.length} 维选型 + 产物生成` },
  { path: '/arch', name: '架构图谱', desc: '六大架构视图' },
  { path: '/check', name: '校验台', desc: '上传代码按规范判定' },
  { path: '/export', name: '导出中心', desc: '规则集多格式导出' },
];

export const APP_ENDPOINTS: { group: string; items: string[] }[] = [
  { group: '系统', items: ['GET /api/health', 'GET /api/stats'] },
  {
    group: '规则',
    items: ['GET /api/rules', 'GET /api/rules/grouped', 'GET /api/rules/sources', 'GET /api/rules/{id}'],
  },
  { group: '导出', items: ['GET /api/export/formats', 'GET /api/export/{format}', 'GET /api/export/{format}/raw'] },
  { group: '校验 / 出图', items: ['POST /api/lint', 'GET /api/archify', 'POST /api/archify/deliver'] },
];

export const APP_LAYERS = [
  { name: '页面层', desc: 'Next.js 14 静态导出（output: export），无服务端运行时', items: APP_ROUTES.map((r) => r.name) },
  { name: '领域库层', desc: 'src/lib —— 检索 / 装配 / 画布 / 引擎 / 导出，全部构建期可用', items: ['rules', 'cookbook', 'stack', 'arch-canvas', 'archify-ir', 'engine', 'exporters'] },
  { name: 'API 客户端', desc: 'arsenal-api.ts —— 全站唯一的 fetch 收口，后端不可达时逐功能降级', items: ['probeArchify', 'deliverArchify'] },
  { name: '服务层', desc: 'Spring Boot 3.2 只读服务（3011），控制器零 try-catch，全局异常收口', items: ['RulesController', 'ExportController', 'LintController', 'ArchifyController'] },
  { name: '数据源', desc: '启动期只读仓库 JSON，不持久化、无数据库', items: ['arsenal-rules', 'arsenal-cookbook', 'arsenal-stacks'] },
] as const;

export const APP_CONTRACTS = [
  '导航双登记：前端 NAV 与侧栏共用一份 NAV 数组，新增路由只改一处',
  'ApiResponse 统一信封：错误码收口在 GlobalExceptionHandler，控制器不写 try-catch',
  '后端不可达不白屏：出图按钮置灰、说明替代，下载 IR 仍可离线走 CLI',
] as const;

// ── 产品架构：功能面 × 引擎三层 ─────────────────────────────────

export const PRODUCT_SURFACES: { name: string; desc: string }[] = [
  { name: '规则库', desc: '规范的查与审：严重度 / 分类 / 来源过滤' },
  { name: '最佳实践案例库', desc: '规范的代码化呈现：bad/good 可对照' },
  { name: '装配台', desc: '选型 → 可运行性判定 → 工程产物' },
  { name: '架构图谱', desc: '六大架构一图讲清：业务到项目' },
  { name: '校验台', desc: '拿代码验：上传即判，如实披露 skipped' },
  { name: '导出中心', desc: '三种出口的批量出口：MD / JSON / zip' },
];

export const ENGINE_LAYERS = [
  {
    name: 'L1 正则',
    status: 'done' as const,
    metric: `${liveStats.regexCapable} 条可真检出`,
    desc: '能真判定的都在这层：模式精确、误报可控',
  },
  {
    name: 'L2 AST',
    status: 'todo' as const,
    metric: `${liveStats.astCapable} 条待接入`,
    desc: 'JavaParser 查询已写进规则数据，引擎未做 —— 全部如实 skipped',
  },
  {
    name: 'L3 LLM 语义',
    status: 'todo' as const,
    metric: '未启动',
    desc: '语义层只做辅助判定，结论必须可核对，不替人拍板',
  },
];

export const SEVERITY_ROWS = [
  { name: 'MUST', count: liveStats.sev.MUST, tone: 'bad' as const },
  { name: 'NEVER', count: liveStats.sev.NEVER, tone: 'bad' as const },
  { name: 'SHOULD', count: liveStats.sev.SHOULD, tone: 'warn' as const },
  { name: 'MAY', count: liveStats.sev.MAY, tone: 'info' as const },
];

export const MUST_LIMIT = liveStats.mustHardLimit;

// ── 项目架构：仓库分区 × 构建链 × 验证链 × 里程碑 ────────────────

export const PROJECT_DIRS: { path: string; role: string }[] = [
  { path: 'arsenal-rules/', role: '规则事实源（11 文件）' },
  { path: 'arsenal-cookbook/', role: '蓝图事实源（4 切片）' },
  { path: 'arsenal-stacks/', role: '选型与画布声明' },
  { path: 'arsenal-web/', role: 'Next.js 前端 + 全部自检脚本' },
  { path: 'arsenal-server/', role: 'Spring Boot 只读服务（3011）' },
  { path: 'tools/', role: '内容构建脚本（改内容改这里）' },
  { path: 'docs/', role: '交付样例与说明' },
];

export const PROJECT_PIPELINE = [
  'tools/content/*.py（改内容）',
  'python tools/build-content.py（生成 JSON）',
  'node scripts/sync-content.mjs（锚点校验 + 同步）',
  `npm run verify（${VERIFY_TOTAL} 项自检）`,
] as const;

export const PROJECT_ROADMAP = [
  { name: 'MCP Server 适配层', desc: '接口全就绪，只差协议层 —— 项目成败关键', tone: 'key' as const },
  { name: '装配台 / 蓝图接后端 API', desc: '前端已完整可用，后端目前只读规则集', tone: 'next' as const },
  {
    name: 'AST 引擎层',
    desc: `JavaParser，${liveStats.astCapable} 条 ast 规则已备好数据`,
    tone: 'next' as const,
  },
  {
    name: 'LLM 语义层',
    desc: `辅助判定，结论可核对；${liveStats.llmCapable} 条规则已声明 llm check`,
    tone: 'later' as const,
  },
  {
    name: `${liveStats.total} 条规则逐条过目`,
    desc: '没过目就不算军火库',
    tone: 'key' as const,
  },
  { name: '结构层 2 条规则缺口', desc: '界面如实标注，不挂假 id，补不补待定', tone: 'later' as const },
] as const;
