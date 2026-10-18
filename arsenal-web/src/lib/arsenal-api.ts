import type { ProjectFacts } from './facts-arch';
import type { RuntimeProbeFact } from './runtime-recon';
import type { CategoryKey, CheckLayer, Severity } from './types';

/**
 * 军火库后端（arsenal-server）的调用层。
 *
 * 这是前端第一处网络请求 —— 在此之前整个站是纯静态的（`output: 'export'`），
 * 所以这份文件刻意写得很克制：只有一个 base 地址、两个动作，
 * 并且**所有失败都必须能被页面上的按钮变成一句人话**。
 *
 * 为什么需要后端：通用绘图器的版式引擎是一套 Node 渲染器（别人技能里的），
 * 浏览器跑不了。后端负责起那个子进程，这里负责调用它。
 * 后端不在时**不是错误，是常态** —— 军火库的原则之一就是能脱离服务器活着，
 * 所以下面把「连不上」和「跑不了」分开表示，页面才能给出不同的处置指引。
 */

const DEFAULT_BASE = 'http://localhost:3011';

/**
 * 后端地址。默认本机 3011；
 * 换地址在构建时设 `NEXT_PUBLIC_ARSENAL_API`（静态导出站点，环境变量在构建期固化）。
 */
export function arsenalApiBase(): string {
  const raw = process.env.NEXT_PUBLIC_ARSENAL_API;
  const trimmed = raw?.trim();
  return trimmed ? trimmed.replace(/\/+$/, '') : DEFAULT_BASE;
}

export interface ArchifyProbe {
  available: boolean;
  /** 不可用时的原因码：ARCHIFY_NOT_INSTALLED / ARCHIFY_NODE_MISSING 等 */
  code: string | null;
  /** 人话解释 + 怎么办。不可用时必须看这个 */
  reason: string | null;
  nodeBinary: string | null;
  nodeVersion: string | null;
  cliPath: string;
  cliExists: boolean;
  quality: string;
  timeoutSeconds: number;
  maxSpecBytes: number;
}

export interface ArchifyReceipt {
  checksPassed: number;
  checkCount: number;
  profile: string;
  status: string;
  errors: number;
  warnings: number;
  specSha256: string;
  reportedSpecBytes: number;
  artifactSha256: string;
  artifactBytes: number;
}

export interface ArchifyDiagnostic {
  code: string;
  severity: string;
  message: string;
  /**
   * 对方给的「这件事怎么改」—— 一组**能直接照做**的短句。
   *
   * 上游不本地化诊断正文，所以这几句是英文（`meta.locale` 只管它的 Viewer UI）。
   *
   * 可选：老版本后端不返回这个字段时按「没有建议」处理，别让类型撒谎。
   * 空数组同样是常态 —— 不是每个构图问题它都知道怎么修。
   */
  supportedFixes?: string[];
}

/** 后端可用性。四种状态对应页面上四种不同的显示，别合并。 */
export type ArchifyStatus =
  | { kind: 'checking' }
  | { kind: 'ready'; probe: ArchifyProbe }
  /** 后端在，但这台机器出不了图（没装技能 / 没有 node）—— 带原因码，可指明怎么办 */
  | { kind: 'unavailable'; code: string; message: string }
  /** 后端连不上 —— 多半没起服务。这不是故障，是静态站的正常形态 */
  | { kind: 'offline'; message: string };

/** 一次出图的结果。三种情形分开表示，因为页面要对它们说三句不同的话。 */
export type DeliverOutcome =
  | { kind: 'delivered'; html: string; receipt: ArchifyReceipt; elapsedMs: number }
  /** 后端跑通了，是这张图没过对方的九项检查 —— 诊断就是这次调用最有价值的东西 */
  | { kind: 'rejected'; error: string; diagnostics: ArchifyDiagnostic[] }
  /** 请求根本没跑成（没装技能、超时、请求不合法） */
  | { kind: 'error'; code: string; message: string };

interface ApiEnvelope<T> {
  success: boolean;
  code: string;
  message: string | null;
  data: T | null;
}

/** 用 AbortController 而不是 AbortSignal.timeout：后者要较新的运行时，而这里不值得挑版本。 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function offlineMessage(e: unknown): string {
  const base = arsenalApiBase();
  const detail = e instanceof Error ? e.message : String(e);
  return `连不上后端 ${base}（${detail}）。静态站不依赖它也能用 —— 起服务的命令是 bash arsenal-server/scripts/run.sh。`;
}

/**
 * 问后端：这台机器能不能出图。
 *
 * 探测用短超时（3 秒）：后端没起的时候，用户不该为一句「连不上」等 60 秒。
 */
export async function probeArchify(): Promise<ArchifyStatus> {
  const base = arsenalApiBase();
  let res: Response;
  try {
    res = await fetchWithTimeout(`${base}/api/archify`, { method: 'GET' }, 3000);
  } catch (e) {
    return { kind: 'offline', message: offlineMessage(e) };
  }

  let body: ApiEnvelope<ArchifyProbe>;
  try {
    body = (await res.json()) as ApiEnvelope<ArchifyProbe>;
  } catch {
    return { kind: 'offline', message: `${base} 有响应但不是军火库后端（返回的不是 JSON）。` };
  }

  // GET /api/archify 本身在环境不可用时也返回 200 + available:false（它是「状态」不是「动作」），
  // 所以这里只需要分辨 success，不用看 HTTP 状态码。
  if (!body.success || !body.data) {
    return {
      kind: 'unavailable',
      code: body.code ?? 'UNKNOWN',
      message: body.message ?? '后端没有说明原因',
    };
  }
  if (!body.data.available) {
    return {
      kind: 'unavailable',
      code: body.data.code ?? 'UNKNOWN',
      message: body.data.reason ?? '这台机器出不了图，但后端没说原因',
    };
  }
  return { kind: 'ready', probe: body.data };
}

/**
 * 把 IR 交给后端出图。
 *
 * 超时给到后端自己超时的 1.25 倍：让**后端**先超时并给出它那句「先手工跑一遍命令看看」，
 * 我们这边抢先掐断的话，用户只会看到一个没有上下文的 abort。
 */
export async function deliverArchify(ir: unknown): Promise<DeliverOutcome> {
  const base = arsenalApiBase();
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${base}/api/archify/deliver`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ir),
      },
      75_000
    );
  } catch (e) {
    return { kind: 'error', code: 'UNREACHABLE', message: offlineMessage(e) };
  }

  let body: ApiEnvelope<{
    delivered: boolean;
    error: string | null;
    html: string | null;
    receipt: ArchifyReceipt | null;
    diagnostics: ArchifyDiagnostic[];
    specSha256: string;
    specBytes: number;
    elapsedMs: number;
  }>;
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return {
      kind: 'error',
      code: 'BAD_RESPONSE',
      message: `后端返回的不是 JSON（HTTP ${res.status}）`,
    };
  }

  if (!body.success || !body.data) {
    return {
      kind: 'error',
      code: body.code ?? `HTTP_${res.status}`,
      message: body.message ?? `请求失败（HTTP ${res.status}）`,
    };
  }

  const d = body.data;
  if (!d.delivered || !d.html) {
    return {
      kind: 'rejected',
      error: d.error ?? '这张图没通过对方的构图检查',
      diagnostics: d.diagnostics ?? [],
    };
  }
  return {
    kind: 'delivered',
    html: d.html,
    receipt: d.receipt as ArchifyReceipt,
    elapsedMs: d.elapsedMs,
  };
}

// ─────────────────────────────────────────────────────────────
// 代码扫描（后端 com.arsenal.scan）
//
// 扫描是一次**只读**动作：给一个目录 / zip / https git 地址，拿回一份事实 JSON。
// 三类结果必须分开表示 ——「后端不在」「输入被拒」「扫出来了」在页面上要说三句不同的话。
// ─────────────────────────────────────────────────────────────

export type ScanSource = { kind: 'path'; value: string } | { kind: 'git'; value: string };

export type ScanOutcome =
  | { kind: 'facts'; facts: ProjectFacts }
  /** 闸门拒了这次输入（路径逃逸 / 超限 / 协议不允许 / 路径不存在）。code 是后端给的错误码 */
  | { kind: 'rejected'; code: string; message: string }
  | { kind: 'offline'; message: string };

/**
 * 扫描超时给到后端自身上限（180s）之上：让**后端**先超时并说清是哪一步超的，
 * 我们这边抢先掐断的话，用户只会看到一个没有上下文的 abort。
 */
const SCAN_TIMEOUT_MS = 200_000;

async function readScanResponse(res: Response): Promise<ScanOutcome> {
  let body: ApiEnvelope<ProjectFacts>;
  try {
    body = (await res.json()) as ApiEnvelope<ProjectFacts>;
  } catch {
    return {
      kind: 'rejected',
      code: `HTTP_${res.status}`,
      message: `后端返回的不是 JSON（HTTP ${res.status}）`,
    };
  }
  if (!body.success || !body.data) {
    return {
      kind: 'rejected',
      code: body.code ?? `HTTP_${res.status}`,
      message: body.message ?? `扫描失败（HTTP ${res.status}）`,
    };
  }
  return { kind: 'facts', facts: body.data };
}

/** 扫本地目录或 https git 地址。两者走同一个接口，由请求体里的 kind 区分 */
export async function scanFacts(source: ScanSource): Promise<ScanOutcome> {
  const base = arsenalApiBase();
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${base}/api/scan/facts`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
      },
      SCAN_TIMEOUT_MS
    );
  } catch (e) {
    return { kind: 'offline', message: offlineMessage(e) };
  }
  return readScanResponse(res);
}

/**
 * 上传一个 zip 扫。
 *
 * 这里**不设 Content-Type**：multipart 的 boundary 由浏览器生成，
 * 手工写一个不带 boundary 的头，后端会以 415 拒掉。
 */
export async function scanUpload(file: File): Promise<ScanOutcome> {
  const base = arsenalApiBase();
  const form = new FormData();
  form.append('file', file);
  let res: Response;
  try {
    res = await fetchWithTimeout(`${base}/api/scan/upload`, { method: 'POST', body: form }, SCAN_TIMEOUT_MS);
  } catch (e) {
    return { kind: 'offline', message: offlineMessage(e) };
  }
  return readScanResponse(res);
}

// ─────────────────────────────────────────────────────────────
// 项目体检（后端 POST /api/autopsy/inspect）
//
// 与扫描同形（{source:{kind,value}}），因为面对的是同一个问题。
// 差别在回包：这里回的是三档结论 + 覆盖率，不是架构事实。
//
// 类型与后端 com.arsenal.autopsy.AutopsyService 的输出逐字段对齐 ——
// 前端不自己重算任何一条结论（重算就会有两份实现，早晚各说各的）。
// ─────────────────────────────────────────────────────────────

export interface AutopsyFinding {
  ruleId: string;
  title: string;
  severity: string;
  category: string;
  file: string;
  line: number;
  column: number;
  snippet: string;
  message: string;
  collapsed: number;
  /** 拼好的 `path:line`。铁律：每条结论必带证据 */
  evidence: string;
  // ── v2（2026-10-18 质检台 Q1）——检查时点的规则快照 join。旧报告/规则查不到时缺键，前端 fallback。
  /** 检查时点的规则快照（RuleIndex join，形状与 /api/rules 的 Rule 一致） */
  rule?: QaRuleSnapshot;
  /** 不修的后果。来源见 impactSource，不许把派生内容伪装成真 impact */
  impact?: string;
  /** rule-impact（规则库自带）| rule-rationale（从 rationale 派生，页面标注「出自规则制定理由」） */
  impactSource?: string;
}

export interface AutopsyCoverage {
  /** 规则池总数（69）。分母从后端来 —— 写死的那天就是它开始撒谎的那天 */
  total: number;
  executed: number;
  notRun: number;
  batches: number;
  decidable: boolean;
  severityPool: Record<string, number>;
  tierPool: { p0: number; p1: number; other: number };
  skipped: {
    ruleId: string;
    title: string;
    severity: string;
    category: string;
    layer: string;
    reason: string;
  }[];
  skippedCount: number;
  parseFailures: { file: string; line: number; status: string; message: string }[];
  undecidability: string[];
}

export interface AutopsyObservation {
  id: string;
  level: string;
  text: string;
  advice: string;
  actual: string;
  evidence: string[];
}

export interface AutopsyReport {
  schemaVersion: number;
  root: string;
  sourceKind: string;
  elapsedMs: number;
  scope: {
    files: number;
    bytes: number;
    truncated: boolean;
    rootName: string;
    maxFiles: number;
    maxTotalBytes: number;
  };
  coverage: AutopsyCoverage;
  p0: AutopsyFinding[];
  p1: AutopsyFinding[];
  other: AutopsyFinding[];
  obs: {
    available: boolean;
    source: string;
    ruleCount: number;
    reason?: string;
    items: AutopsyObservation[];
    unevaluated: { id: string; fact: string; op: string; reason: string }[];
    firedCount: number;
    unevaluatedCount: number;
  };
}

export type AutopsyOutcome =
  | { kind: 'report'; report: AutopsyReport }
  | { kind: 'rejected'; code: string; message: string }
  | { kind: 'offline'; message: string };

/** 体检一次（本地目录 / https git）。三态与扫描同一口径 */
export async function autopsyInspect(source: ScanSource): Promise<AutopsyOutcome> {
  const base = arsenalApiBase();
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${base}/api/autopsy/inspect`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
      },
      SCAN_TIMEOUT_MS
    );
  } catch (e) {
    return { kind: 'offline', message: offlineMessage(e) };
  }
  let body: ApiEnvelope<AutopsyReport>;
  try {
    body = (await res.json()) as ApiEnvelope<AutopsyReport>;
  } catch {
    return { kind: 'rejected', code: `HTTP_${res.status}`, message: `后端返回的不是 JSON（HTTP ${res.status}）` };
  }
  if (!body.success || !body.data) {
    return {
      kind: 'rejected',
      code: body.code ?? `HTTP_${res.status}`,
      message: body.message ?? `体检失败（HTTP ${res.status}）`,
    };
  }
  return { kind: 'report', report: body.data };
}

// ─────────────────────────────────────────────────────────────
// 活体采集（后端 POST /api/autopsy/run）
//
// 与体检是**两件不同的事**，所以不是一个请求：
//   · /inspect —— 只读扫一遍出三档结论，一个字节都不执行
//   · /run     —— 把项目复制到工作副本里**真跑起来**，采端口 / health / 日志
//
// ⚠️ 超时口径**刻意不复用** SCAN_TIMEOUT_MS（200s）。那个是给只读扫描的；
// 这里必须比后端墙钟（默认 90s）更宽 —— 否则前端先超时、后端还在跑，
// 页面会说「没采到」，而进程其实起来了。那又是一句假话，
// 而且是最难查的那种（要等到下一次扫同一个项目才可能发现）。
const RUNTIME_RUN_TIMEOUT_MS = 150_000;

/** 后端认得的运行时。**只有 spring-boot 是真跑通的**，另两个是显式降级，不是「还没接」 */
export type RuntimeKind = 'spring-boot' | 'node-start' | 'plain-main';

export type AutopsyRunOutcome =
  | { kind: 'probe'; probe: RuntimeProbeFact }
  | { kind: 'rejected'; code: string; message: string }
  | { kind: 'offline'; message: string };

/**
 * 真跑一次，采运行时事实。
 *
 * `mainClass` 由调用方（页面从 facts.code.entryPoints[] 里挑）传进来 ——
 * **后端不猜「该跑哪个类」**：猜错的表现是「起不来」，
 * 而项目真的起不来时也是「起不来」，两者在结果上无从区分。
 */
export async function autopsyRun(
  source: ScanSource,
  mainClass: string,
  runtime: RuntimeKind = 'spring-boot',
  wallClockMs = 90_000,
): Promise<AutopsyRunOutcome> {
  const base = arsenalApiBase();
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${base}/api/autopsy/run`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, mainClass, runtime, wallClockMs }),
      },
      RUNTIME_RUN_TIMEOUT_MS
    );
  } catch (e) {
    return { kind: 'offline', message: offlineMessage(e) };
  }
  let body: ApiEnvelope<RuntimeProbeFact>;
  try {
    body = (await res.json()) as ApiEnvelope<RuntimeProbeFact>;
  } catch {
    return { kind: 'rejected', code: `HTTP_${res.status}`, message: `后端返回的不是 JSON（HTTP ${res.status}）` };
  }
  if (!body.success || !body.data) {
    return {
      kind: 'rejected',
      code: body.code ?? `HTTP_${res.status}`,
      message: body.message ?? `活体采集失败（HTTP ${res.status}）`,
    };
  }
  return { kind: 'probe', probe: body.data };
}

// ─────────────────────────────────────────────────────────────
// 代码校验（后端 POST /api/lint）
//
// 校验台的「后端深检」：把用户粘贴的源码交给后端，跑正则层之外的
// AST 层（JDK 自带 jdk.compiler，零新增依赖）。与扫描一样是三态 ——
// 「后端不在」「输入被拒」「跑出来了」在页面上要说三句不同的话，
// 后端不在时本地正则层结论原样保留，静态站照常活着。
// ─────────────────────────────────────────────────────────────

/** 与 engine.ts 的 SourceFile 同构，这里不 import 它，保持本文件零内部依赖 */
export interface LintSourceFile {
  /**
   * 用于匹配规则的 targetGlob，路径要尽量真实（带包路径）。
   * 填 `UserController.java` 和填完整包路径，匹配到的规则数量会差很多。
   */
  name: string;
  content: string;
}

/** 一处违规（后端 Violation record 的镜像，必须带文件 / 行 / 列定位） */
export interface RemoteViolation {
  ruleId: string;
  title: string;
  severity: Severity;
  category: CategoryKey;
  file: string;
  line: number;
  column: number;
  snippet: string;
  message: string;
  fix: string;
  /** 同文件同规则被折叠掉的额外命中数 */
  collapsed: number;
}

/** 后端检不了的规则（能力边界），与前端正则层的 skipped 同构 */
export interface RemoteSkippedRule {
  ruleId: string;
  title: string;
  severity: Severity;
  category: CategoryKey;
  layer: CheckLayer;
  reason: string;
}

/** 显式的「本次没跑成」记录（解析失败 / 无编译器 / 没有 Java 文件） */
export interface RemoteParseFailure {
  file: string;
  line: number;
  column: number;
  /** SYNTAX_ERROR | COMPILER_MISSING | NO_JAVA_FILE */
  status: string;
  message: string;
  detail: string;
  /** 因此未被评估的规则 id */
  unevaluatedRules: string[];
}

/** AST 层本次的执行情况 */
export interface RemoteAstLayer {
  /** executed | partial | failed | no_java_file | compiler_missing | not_applicable */
  status: string;
  declaredRules: number;
  javaFiles: number;
  parsedFiles: number;
  failedFiles: number;
  unevaluatedRules: string[];
  note: string;
}

/** 后端 LintReport record 的镜像。score 可空：存在解析失败时后端拒绝给分 */
export interface RemoteLintReport {
  fileCount: number;
  totalLines: number;
  rulePool: number;
  executableRules: number;
  matchedFiles: number;
  notApplicable: number;
  violations: RemoteViolation[];
  skipped: RemoteSkippedRule[];
  unparsed: RemoteParseFailure[];
  /** 不可判定时为 null —— 不得把「没结论」读成满分 */
  score: number | null;
  grade: string;
  counts: Record<Severity, number>;
  byRule: {
    ruleId: string;
    title: string;
    severity: Severity;
    category: CategoryKey;
    count: number;
    files: number;
  }[];
  durationMs: number;
  ast: RemoteAstLayer;
  /** false 时不得把报告呈现成「合规」 */
  decidable: boolean;
  /** 不可判定的人可读原因 */
  undecidability: string[];
}

/** 一次深检的结果。三态分开表示，与 scanFacts 同一范式 */
export type LintRemoteOutcome =
  | { kind: 'report'; report: RemoteLintReport }
  /** 闸门拒了这次输入（空文件列表 / 超 200 个文件等）。code 是后端给的错误码 */
  | { kind: 'rejected'; code: string; message: string }
  /** 后端连不上 —— 不是故障，是静态站的正常形态 */
  | { kind: 'offline'; message: string };

/**
 * AST 解析是毫秒级的（观测 ~30ms），但给足余量到 30 秒：
 * 大批量文件 + 冷 JIT 也不至于被前端先掐断。
 */
const LINT_TIMEOUT_MS = 30_000;

/** 把源码交给后端做深检（正则层之外的 AST 层在这一步出结论） */
export async function lintRemote(files: LintSourceFile[]): Promise<LintRemoteOutcome> {
  const base = arsenalApiBase();
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${base}/api/lint`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
      },
      LINT_TIMEOUT_MS
    );
  } catch (e) {
    return { kind: 'offline', message: offlineMessage(e) };
  }

  let body: ApiEnvelope<RemoteLintReport>;
  try {
    body = (await res.json()) as ApiEnvelope<RemoteLintReport>;
  } catch {
    return {
      kind: 'rejected',
      code: `HTTP_${res.status}`,
      message: `后端返回的不是 JSON（HTTP ${res.status}）`,
    };
  }
  if (!body.success || !body.data) {
    return {
      kind: 'rejected',
      code: body.code ?? `HTTP_${res.status}`,
      message: body.message ?? `深检失败（HTTP ${res.status}）`,
    };
  }
  return { kind: 'report', report: body.data };
}

// ─────────────────────────────────────────────────────────────
// 测试工程师（后端 /api/qa/*，异步 Job）
//
// 与体检（/api/autopsy/inspect，同步）的分工：这条链路把 git clone 与
// 后续 LLM 段都收进后台线程，前端只认「提交 → 轮询 → 取报告」三步。
// 类型与后端 com.arsenal.qa.QaService 的输出逐字段对齐 —— 前端不重算
// 任何一条结论，也不自己算 projectId（规范化口径在后端一处，算两份早晚各说各的）。
// ─────────────────────────────────────────────────────────────

export type QaRangeMode = 'full' | 'review' | 'focus';

export interface QaRange {
  mode: QaRangeMode;
  include: string[];
  exclude: string[];
}

export interface QaSubmitResult {
  jobId: string;
  projectId: string;
  status: string;
}

export type QaJobStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
export type QaPhaseState = 'pending' | 'running' | 'done' | 'failed';

/** GET /api/qa/jobs/{id} —— 轮询用。phases 是 4 段后台流水线的状态 */
export interface QaJobNode {
  jobId: string;
  projectId: string;
  status: QaJobStatus;
  phase: string;
  error: string;
  deepCheck: boolean;
  createdAt: string;
  source: { kind: string; value: string };
  range: QaRange;
  phases: Record<string, QaPhaseState>;
  phaseAt: Record<string, string>;
}

/** qaReport v1 的静态档：复用 autopsy 的 violationNode 口径 */
export interface QaStaticFindings {
  p0: AutopsyFinding[];
  p1: AutopsyFinding[];
  other: AutopsyFinding[];
  /** focus 模式：圈外只计数不给明细 */
  outOfScopeSummary?: { p0: number; p1: number; other: number; note: string };
  /** review 模式：圈外根本没跑 —— 两者语义不同，字段也不同，不许混 */
  outOfScopeNote?: string;
}

export interface QaRecommendation {
  id: string;
  title: string;
  file: string;
  line: number;
  severity: string;
  category: string;
  source: string;
  before: string;
  after: string;
  /** 规则没附正例时给的是这句话，不是编造的代码 */
  afterNote?: string;
  rationale: string;
}

export interface QaTestSuggestion {
  target: string;
  reason: string;
  findings?: number;
  /**
   * 可运行的复现用例（C1）。
   *
   * ★ 2026-10-14：这一段以前恒为 `null`（后端 `putNull` 占位），页面上显示成
   * 「有建议、没有用例」—— 读起来像「用例已经有了只是没展示」。
   * 现在它是 `{status, reason, cases[]}`：
   *   · `proven`   —— 这个目标上已经有**跑红过**的复现测试，cases 里有可直接用的源码
   *   · `no-repro` —— 跑过但没能实锤（写不出来 / 全绿 / 测试本身无效，三者 reason 分开写）
   *   · `not-run`  —— 根本没跑（LLM 未配置 / 语义深检未开启 / 本 job 关掉了实锤）
   */
  draftCases?: {
    status: 'proven' | 'no-repro' | 'not-run';
    reason: string;
    cases: {
      ruleId: string;
      line: number;
      testClass: string;
      source: string;
      verdict: string;
      rate?: number;
      failureExcerpt?: string;
    }[];
  } | null;
}

/**
 * 一次复现的结果（C1）。**四档，不是两档** ——
 * 「没复现」与「没跑」在页面上必须长得不一样，否则下一步会去改规则而不是改环境。
 */
export interface QaRepro {
  /** reproduced | not-reproduced | invalid | not-run */
  verdict: string;
  /** 判据那一句话的原话，页面要原样显示，不许改写 */
  reason: string;
  /** 报告层给这一档的中文说法 */
  tierText: string;
  /** 模型有没有把测试写出来（false = 说写不出来或格式不对，已放弃） */
  authored?: boolean;
  testClass?: string;
  testSource?: string;
  /** 编译 + 启动器 + N 次跑的墙钟合计（毫秒） */
  compileMs?: number;
  redCount?: number;
  attempts?: number;
  /** 复现率：redCount / attempts。1/3 就是 0.333，不四舍五入成「稳定复现」 */
  rate?: number;
  /**
   * 稳定性分档（判据在 `ReproVerdict`，纯函数）。
   *
   * ⚠ 它**只是标注，不影响两档分流** —— 偶发复现仍然是实锤。
   * 并发 / 时序类缺陷天生低复现率，若因为「不稳定」降级，它们就永远进不了实锤档。
   */
  stability?: 'stable' | 'flaky' | 'absent' | 'insufficient';
  /** 稳定性的一句话说法，后端原话 */
  stabilityText?: string;
  /** 给到稳定性结论至少要几次样本 */
  stableSamples?: number;
  /** 跑红时的断言异常栈 —— 这是实锤的证据本身 */
  failureExcerpt?: string;
  /** 编译没过时的第一处错误 */
  compileError?: string;
  testClasspath?: string[];
}

export interface QaSemanticFinding {
  ruleId: string;
  ruleTitle: string;
  severity: string;
  category: string;
  file: string;
  line: number;
  evidence: string;
  impact: string;
  confidence: number;
  source: string;
  recommendation: { before: string; after: string; rationale: string };
  /** C1：这条 finding 的复现实锤。没有这一段说明本 job 压根没跑复现。 */
  repro?: QaRepro;
}

export interface QaSemanticVerdict {
  ruleId: string;
  title: string;
  severity: string;
  /** 违规 | 合规 | 不适用 | 未跑-预算 | 失败-格式 */
  verdict: string;
  filesJudged: number;
  violations: number;
  note?: string;
}

export interface QaLlmUsage {
  model: string;
  candidateFiles: number;
  batches: number;
  maxBatches: number;
  charsSent: number;
  promptTokens: number;
  completionTokens: number;
  droppedFindings: number;
  budgetCut: boolean;
}

export interface QaLlmStatus {
  configured: boolean;
  model: string;
  reason: string;
}

/**
 * v2 契约（2026-10-18 质检台 Q1）：检查时点的规则快照。
 * 形状 = 后端 Rule record 的 JSON（Jackson NON_NULL：没设置的字段不出现），
 * 与 types.ts 的 Rule（静态规则库 + 前端注入字段）刻意不同名不同形 —— 别混用。
 */
export interface QaRuleSnapshot {
  id: string;
  category: string;
  subcategory?: string;
  title: string;
  severity: string;
  sources: { ref: string; type: string; quote?: string }[];
  rationale: string;
  /** 规则库自带 impact（Q4 起有）；draft/历史规则可能没有 */
  impact?: string;
  appliesTo?: { stack?: string[]; scope?: string; pathGlob?: string };
  bad: string;
  good: string;
  check: { regex?: unknown; ast?: unknown; llm?: string; manual?: string };
  promptFragment: string;
  tags?: string[];
  status?: string;
  version: number;
  supersedes?: string;
  updatedAt?: string;
}

/** 报告级 ruleset stamp：检查时点的规则库账。loadedAt vs filesNewestMtime 支撑「已变更未重载」黄条。 */
export interface QaRulesetStamp {
  version: string;
  releasedAt: string;
  ruleCount: number;
  activeCount: number;
  llmLayerRules: number;
  /** 本次规则库加载时间 */
  loadedAt: string;
  /** 规则库文件最新 mtime —— 晚于 loadedAt ⇒ 有文件改了没重载 */
  filesNewestMtime: string;
}

/** 「按规则」聚合组。铁律：count === items.length === 平铺视图该规则该档条数（同源不同算法不许打架） */
export interface QaRuleGroup {
  ruleId: string;
  title: string;
  severity: string;
  /** static（规则引擎）| semantic（LLM 语义深检）—— 两个判据来源不混组 */
  tier: 'static' | 'semantic';
  count: number;
  /** 引擎折叠的重复命中总数 —— 只做披露，不混进 count */
  collapsedTotal?: number;
  /** static 组带 tier（p0/p1/other = 平铺档位）；semantic 组不带 */
  items: { file: string; line: number; tier?: 'p0' | 'p1' | 'other' }[];
}

export interface QaReport {
  schemaVersion: number;
  jobId: string;
  projectId: string;
  scannedAt: string;
  elapsedMs: number;
  projectRef: { kind: string; rootName: string };
  targetRange: QaRange & {
    filesTotal: number;
    filesMatched: number;
    pctOfRepo: number;
    fileIndexTruncated?: boolean;
  };
  scope: AutopsyReport['scope'] & { filteredOut?: number };
  coverage: AutopsyCoverage & { scopeFilteredOut: number };
  staticFindings: QaStaticFindings;
  semanticFindings: QaSemanticFinding[];
  semanticVerdicts: QaSemanticVerdict[];
  semanticNotes: string[];
  /** not-run | ok | partial | failed —— 「没跑」「跑不完」「跑完没问题」是三回事 */
  semanticStatus: string;
  semanticReason: string;
  recommendations: (QaRecommendation | { note: string })[];
  testSuggestions: (QaTestSuggestion | { note: string })[];
  skipped: AutopsyCoverage['skipped'];
  undecidability: string[];
  llmUsage: QaLlmUsage | null;
  // ── C1 · 复现实锤 ──
  /** 实锤档：真的跑红过的语义 finding（后端 2026-10-14 起才有；旧报告里没有这个键） */
  provenSemanticFindings?: QaSemanticFinding[];
  /** 待确认档：其余全部语义 finding —— 没复现、测试无效、没跑起来都归这里 */
  unconfirmedSemanticFindings?: QaSemanticFinding[];
  /** 四档计数。`notRun` 与 `notReproduced` 分开，因为它们导向的下一步完全不同 */
  reproTiers?: {
    proven: number;
    notReproduced: number;
    invalidTest: number;
    notRun: number;
    /** 稳定性只做标注，不参与两档分流 */
    stability?: { stable: number; flaky: number; insufficientSamples: number; minSamples: number };
  };
  /** not-run | ok | partial */
  reproStatus?: string;
  reproReason?: string;
  reproNotes?: string[];
  reproUsage?: Record<string, unknown> | null;

  // ── C4 · 审查员委员会 ──
  /** 三路并行审出来的问题，带「共识 / 孤证」标注 */
  committeeFindings?: QaCommitteeFinding[];
  committeeNotes?: string[];
  committeeSummary?: {
    consensus: number;
    solo: number;
    budgetCut: boolean;
    note?: string;
  };
  /** 三个审查员**各一份**的账 —— 成本 ×3 这件事必须看得见 */
  committeeUsage?: {
    model: string;
    members: number;
    batches: number;
    promptTokens: number;
    completionTokens: number;
    budgetCut: boolean;
    costNote?: string;
    perJudgeer: Record<
      string,
      { ran: boolean; reason?: string; batches: number; issues: number; promptTokens: number; completionTokens: number }
    >;
  } | null;
  // ── v2 契约（2026-10-18 质检台 Q1）—— 旧 v1 报告没有这些键，前端必须 fallback（Q2 落地文案）：
  //    「这份报告出在规则快照 / 聚合视图之前」，不许把缺键渲染成 0 或空白。
  ruleset?: QaRulesetStamp;
  groupedByRule?: QaRuleGroup[];
  scannedFiles: string[];
}

/**
 * 一条委员会结论。
 *
 * ⚠ {@code signal} 只有两档且**都不是判负**：`consensus`（2+ 人报）与 `solo`（1 人报）。
 * 孤证不等于误报 —— 它是置信标注，与「语义 finding 必带 confidence、不进 P0」同一条纪律。
 */
export interface QaCommitteeFinding {
  file: string;
  line: number;
  title: string;
  impact: string;
  evidence: string;
  /** consensus | solo */
  signal: string;
  /** 几个审查员报了它（1 = 孤证） */
  voters: number;
  /** 具体是谁：security | performance | concurrency */
  reportedBy: string[];
  /** 报告层给这一档的中文说法 */
  signalText: string;
}

/** 数字孪生 · 对话问诊的返回。`dossier` 与 `numberAudit` 是这个接口真正的价值。 */
export interface QaTwinAnswer {
  schemaVersion: number;
  projectId: string;
  question: string;
  /** ok | not-run | failed */
  status: string;
  reason?: string;
  answer?: string;
  citations?: string[];
  /** 模型自己说「答不了」的清单 */
  cannotSay?: string[];
  /** 四层档案里**哪层有数据**。缺哪层就明写，不用别的层顶替 */
  dossier?: {
    static: { present: boolean; note: string };
    semantic: { present: boolean; proven: number; notReproduced: number; notRun: number };
    runtime: { present: boolean; started: number; declared: number };
    time: { present: boolean; points: number; latest?: unknown };
    empty: boolean;
  };
  /** 这份档案答不了什么 */
  blindSpots?: string[];
  /**
   * 答案里每个数字是否都能在档案里找到出处。
   * `suspect` = 有数字找不到出处 —— **那些数字可能是在编**，看结论前先核。
   */
  numberAudit?: 'pass' | 'suspect';
  numberAuditNote?: string;
  usage?: { promptTokens: number; completionTokens: number; dossierChars: number };
}

/** POST /api/qa/ask —— 对着活档案问一句。三态与 qa 其余接口同一口径。 */
export async function qaAsk(
  question: string,
  source?: ScanSource
): Promise<QaOutcome<QaTwinAnswer>> {
  const base = arsenalApiBase();
  try {
    const res = await fetchWithTimeout(
      `${base}/api/qa/ask`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 不传 source 时后端默认看军火库自己（dogfooding）
        body: JSON.stringify({ question, ...(source ? { source } : {}) }),
      },
      180_000
    );
    const body = (await res.json()) as ApiEnvelope<QaTwinAnswer>;
    if (!body.success || !body.data) {
      return { kind: 'rejected', code: body.code ?? `HTTP_${res.status}`, message: body.message ?? `问诊失败（HTTP ${res.status}）` };
    }
    return { kind: 'ok', data: body.data };
  } catch (e) {
    return { kind: 'offline', message: offlineMessage(e) };
  }
}

export interface QaTree {
  projectId: string;
  fromJobId: string;
  from: string;
  files: string[];
}

export interface QaSnapshotSummary {
  jobId: string;
  scannedAt: string;
  mode: string;
  files: number;
  filesMatched: number;
  p0: number;
  p1: number;
  truncated: boolean;
}

/** 轮询 / 查询类接口的三态。offline 不是故障：静态站本来就允许后端不在 */
export type QaOutcome<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'rejected'; code: string; message: string }
  | { kind: 'offline'; message: string };

async function readQa<T>(res: Response): Promise<QaOutcome<T>> {
  let body: ApiEnvelope<T>;
  try {
    body = (await res.json()) as ApiEnvelope<T>;
  } catch {
    return {
      kind: 'rejected',
      code: `HTTP_${res.status}`,
      message: `后端返回的不是 JSON（HTTP ${res.status}）`,
    };
  }
  if (!body.success || !body.data) {
    return {
      kind: 'rejected',
      code: body.code ?? `HTTP_${res.status}`,
      message: body.message ?? `请求失败（HTTP ${res.status}）`,
    };
  }
  return { kind: 'ok', data: body.data };
}

const QA_TIMEOUT_MS = 15_000;

/** 受理一次深检（秒回 jobId，clone 在后台跑）。三态与 autopsyInspect 同一口径 */
export async function qaSubmit(
  source: ScanSource,
  range: QaRange,
  deepCheck: boolean
): Promise<QaOutcome<QaSubmitResult>> {
  const base = arsenalApiBase();
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${base}/api/qa/submit`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, range, deepCheck }),
      },
      QA_TIMEOUT_MS
    );
  } catch (e) {
    return { kind: 'offline', message: offlineMessage(e) };
  }
  return readQa<QaSubmitResult>(res);
}

/** 轮询 job 状态。单次失败不掐断轮询 —— 返回 rejected 由调用方决定停不停 */
export async function qaJob(jobId: string): Promise<QaOutcome<QaJobNode>> {
  const base = arsenalApiBase();
  let res: Response;
  try {
    res = await fetchWithTimeout(`${base}/api/qa/jobs/${encodeURIComponent(jobId)}`, {}, 8_000);
  } catch (e) {
    return { kind: 'offline', message: offlineMessage(e) };
  }
  return readQa<QaJobNode>(res);
}

/** DONE 之后的 qaReport。job 未完成时后端回 400 + 「继续轮询」提示 */
export async function qaReport(jobId: string): Promise<QaOutcome<QaReport>> {
  const base = arsenalApiBase();
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${base}/api/qa/reports/${encodeURIComponent(jobId)}`,
      {},
      SCAN_TIMEOUT_MS
    );
  } catch (e) {
    return { kind: 'offline', message: offlineMessage(e) };
  }
  return readQa<QaReport>(res);
}

/** 范围勾选的数据源：该项目最近一次深检的文件索引（不重新 clone） */
export async function qaTree(projectId: string): Promise<QaOutcome<QaTree>> {
  const base = arsenalApiBase();
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${base}/api/qa/tree?projectId=${encodeURIComponent(projectId)}`,
      {},
      8_000
    );
  } catch (e) {
    return { kind: 'offline', message: offlineMessage(e) };
  }
  return readQa<QaTree>(res);
}

export async function qaSnapshots(projectId: string): Promise<QaOutcome<QaSnapshotSummary[]>> {
  const base = arsenalApiBase();
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${base}/api/qa/snapshots?projectId=${encodeURIComponent(projectId)}`,
      {},
      8_000
    );
  } catch (e) {
    return { kind: 'offline', message: offlineMessage(e) };
  }
  return readQa<QaSnapshotSummary[]>(res);
}

/** LLM 语义层配置状态。只回 configured/model/reason，后端绝不回 key —— 前端据此放行「深度检测」勾选。 */
export async function qaLlmStatus(): Promise<QaOutcome<QaLlmStatus>> {
  const base = arsenalApiBase();
  let res: Response;
  try {
    res = await fetchWithTimeout(`${base}/api/qa/llm-status`, {}, 8_000);
  } catch (e) {
    return { kind: 'offline', message: offlineMessage(e) };
  }
  return readQa<QaLlmStatus>(res);
}
