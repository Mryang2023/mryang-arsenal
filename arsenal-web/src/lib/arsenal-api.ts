import type { ProjectFacts } from './facts-arch';

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
