import { arsenalApiBase } from './arsenal-api';

/**
 * 案例执行服务的调用层（后端 com.arsenal.cases）。
 *
 * 复用了 arsenal-api 的 base 地址与「后端不在是常态」的语义：
 * runCase 把「连不上」和「跑不了」分开表示，页面才能给两句不同的人话。
 * 这里刻意只依赖 arsenalApiBase()，不碰 archify/scan 的既有逻辑，避免改动面扩散。
 */

export interface CaseSourceFile {
  path: string;
  code: string;
}

export interface CaseRunRequest {
  files: CaseSourceFile[];
  mainClass: string;
  args?: string[];
  timeoutMs?: number;
}

export interface CaseRunResult {
  compiled: boolean;
  jdkVersion: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
}

/** 三种结果分开：跑完了 / 业务层报错（含缺 JDK21、参数非法）/ 后端根本连不上 */
export type CaseRunOutcome =
  | { kind: 'ran'; result: CaseRunResult }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'offline'; message: string };

export type CaseJdkOutcome =
  | { kind: 'ready'; info: Record<string, string> }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'offline'; message: string };

function offlineMessage(e: unknown): string {
  const base = arsenalApiBase();
  const detail = e instanceof Error ? e.message : String(e);
  return `连不上后端 ${base}（${detail}）。静态站不依赖它也能看，但运行案例需要它 —— 起服务：bash arsenal-server/scripts/run.sh。`;
}

/** 用 AbortController 而不是 AbortSignal.timeout：后者要较新的运行时，这里不值得挑版本。 */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface ApiEnvelope<T> {
  success: boolean;
  code: string;
  message: string | null;
  data: T | null;
}

/**
 * 提交案例代码运行。
 *
 * 超时给到用户设定上限 +5 秒：让**后端**先超时（自己那句「先手工跑一遍看看」更有上下文），
 * 我们这边抢先掐断的话，用户只会看到一个没有上下文的 abort。
 */
export async function runCase(req: CaseRunRequest, timeoutMs = 35000): Promise<CaseRunOutcome> {
  const base = arsenalApiBase();
  let res: Response;
  try {
    res = await fetchWithTimeout(
      `${base}/api/cases/run`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      },
      timeoutMs
    );
  } catch (e) {
    return { kind: 'offline', message: offlineMessage(e) };
  }

  let body: ApiEnvelope<CaseRunResult>;
  try {
    body = (await res.json()) as ApiEnvelope<CaseRunResult>;
  } catch {
    return { kind: 'error', code: `HTTP_${res.status}`, message: `后端返回的不是 JSON（HTTP ${res.status}）` };
  }

  // 注意：编译失败（compiled:false）是「跑完了」的正常返回（HTTP 200 + success:true），
  // 页面要从 result.compiled 判断；只有 success:false 才算业务层错误。
  if (!body.success || !body.data) {
    return {
      kind: 'error',
      code: body.code ?? `HTTP_${res.status}`,
      message: body.message ?? `请求失败（HTTP ${res.status}）`,
    };
  }
  return { kind: 'ran', result: body.data };
}

/** 后端实际使用的 JDK（确认是 21+，虚拟线程等才跑得起来）。探测用短超时。 */
export async function caseJdk(): Promise<CaseJdkOutcome> {
  const base = arsenalApiBase();
  let res: Response;
  try {
    res = await fetchWithTimeout(`${base}/api/cases/jdk`, { method: 'GET' }, 3000);
  } catch (e) {
    return { kind: 'offline', message: offlineMessage(e) };
  }

  let body: ApiEnvelope<Record<string, string>>;
  try {
    body = (await res.json()) as ApiEnvelope<Record<string, string>>;
  } catch {
    return { kind: 'error', code: `HTTP_${res.status}`, message: `后端返回的不是 JSON（HTTP ${res.status}）` };
  }
  if (!body.success || !body.data) {
    return { kind: 'error', code: body.code ?? `HTTP_${res.status}`, message: body.message ?? '无法获取 JDK 信息' };
  }
  return { kind: 'ready', info: body.data };
}
