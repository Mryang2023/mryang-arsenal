/**
 * 项目工坊 · 后端调用层（工坊棒2）。
 *
 * 三态口径与 `arsenal-api.ts` 逐字对齐 —— 后端不在 / 输入被拒 / 拿到了，
 * 在页面上要说三句不同的话，后端不在时**不是错误，是静态站的正常形态**。
 *
 * 后端契约见 `arsenal-server/.../projects/ProjectController`：单一信封
 * `{success, code, message, data}`，业务冲突走 `code`（CONFLICT /
 * QUOTA_EXCEEDED / SOURCE_UNREACHABLE / NOT_FOUND …），入参形态错由
 * `GlobalExceptionHandler` 落成 400。
 */
import { arsenalApiBase } from './arsenal-api';

export type ProjectKind = 'path' | 'git';

export interface ProjectSource {
  kind: ProjectKind;
  /** path 项目是真实目录；git 项目是 https 地址（后端只存脱敏值，真值不落盘） */
  value: string;
}

/** 缓存统计（path 项目摄取时写 manifest）。git 项目一期 fingerprint 取自 HEAD。 */
export interface ProjectCacheStat {
  files: number;
  bytes: number;
  /** 摄取时刻（ISO，后端原样给，不自己造时间） */
  ingestedAt: string;
  fingerprint: string;
  lastRefresh: string | null;
  lastDiff: string | null;
}

/** 列表 / 详情里的项目条目。 */
export interface ProjectEntry {
  id: string;
  name: string;
  source: ProjectSource;
  note: string;
  addedAt: string;
  cache: ProjectCacheStat | null;
  lastFactsAt: string | null;
  lastJobId: string | null;
}

/** 详情接口额外带回的新鲜度（path：walk 源头比对；git：一期「未检测」）。 */
export interface ProjectFreshness {
  mode: string;
  reason?: string;
  added?: number;
  updated?: number;
  removed?: number;
}

export interface ProjectDetail extends ProjectEntry {
  freshness?: ProjectFreshness;
}

export interface DeleteResult {
  deleted: string;
  /** 删除时后端**保留** QA 历史报告（.data/qa/<id>/ 是审计痕迹），前端据此写清确认框 */
  qaHistoryKept: boolean;
  note: string;
}

/** 一次项目工坊请求的结果。三态分开，因为页面要对它们说三句不同的话。 */
export type ProjectsOutcome<T> =
  | { kind: 'ok'; data: T }
  /** 后端拒了（CONFLICT / QUOTA_EXCEEDED / SOURCE_UNREACHABLE / NOT_FOUND / 400 入参错） */
  | { kind: 'rejected'; code: string; message: string }
  /** 后端连不上 —— 不是故障，是静态站的正常形态 */
  | { kind: 'offline'; message: string };

/**
 * 真连不上（连接被拒 / 网络层错误）。不是故障，是静态站的正常形态。
 * 与「等超时」是两件事，见 {@link timeoutMessage}。
 */
export function offlineMessage(e: unknown): string {
  const base = arsenalApiBase();
  const detail = e instanceof Error ? e.message : String(e);
  return `连不上后端 ${base}（${detail}）。项目工坊整组功能需要后端 :3011 —— 起服务的命令是 bash arsenal-server/scripts/run.sh。`;
}

/**
 * 等超时（abort）。**与服务还起着、只是这一步没在 N 秒内跑完**是同一件事，
 * 与「连不上」完全是两件事。
 *
 * 2026-10-18：这一句曾经把两种情况说成同一句话（15 秒 abort 一律报「连不上后端」），
 * 用户据此判断「后端没起」并反复重启，而实际后端在埋头给「添加项目」做摄取 ——
 * 措辞层是独立出口，两种状态必须说两句不同的话。
 */
export function timeoutMessage(timeoutMs: number): string {
  const base = arsenalApiBase();
  const sec = Math.round(timeoutMs / 1000);
  return `后端 ${base} 超过 ${sec} 秒没有响应完 —— 服务可能还在摄取（添加项目会整树复制源码），也可能请求被拦在了半路。这一步没有结论，稍后重试或看服务端日志。起服务的命令是 bash arsenal-server/scripts/run.sh。`;
}

/** 是「等超时」还是「真连不上」。浏览器 abort → DOMException(AbortError)；node → TimeoutError。 */
export function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError' || /abort/i.test(e.message));
}

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
 * 读后端信封。任何坏形（非 JSON / success=false / 无 data）都落成 rejected，
 * 让页面统一走「后端拒了」这条人话分支，而不是把 400 伪装成网络错误。
 */
async function readEnvelope<T>(res: Response): Promise<ProjectsOutcome<T>> {
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

const PROJECTS_TIMEOUT_MS = 15_000;
/**
 * 摄取要整树复制源码，慢是常态：单独给 120 秒。
 * 与 autopsy 层同款思路（前端等待必须比后端墙钟宽）—— 但超时了说
 * 「没响应完」，不许说「连不上」，见 {@link timeoutMessage}。
 */
const INGEST_TIMEOUT_MS = 120_000;

async function call<T>(path: string, init?: RequestInit, timeoutMs: number = PROJECTS_TIMEOUT_MS): Promise<ProjectsOutcome<T>> {
  const base = arsenalApiBase();
  try {
    return await readEnvelope<T>(
      await fetchWithTimeout(`${base}${path}`, init ?? {}, timeoutMs)
    );
  } catch (e) {
    // 等超时与真连不上说两句不同的话（2026-10-18：合成一句的代价是用户反复重启后端）
    return { kind: 'offline', message: isAbortError(e) ? timeoutMessage(timeoutMs) : offlineMessage(e) };
  }
}

/** 列表（摘要，不 walk 源头）。后端不可达时离线，列表为空。 */
export function listProjects(): Promise<ProjectsOutcome<ProjectEntry[]>> {
  return call<ProjectEntry[]>('/api/projects');
}

/** 加项目 + 摄取缓存。重复 id → CONFLICT（不建第二份）；限额超限 → QUOTA_EXCEEDED（不留半份）。
 *  摄取慢是常态：单独 120 秒超时（{@link INGEST_TIMEOUT_MS}），超时了说「没响应完」不说「连不上」。 */
export function addProject(input: { name: string; source: ProjectSource }): Promise<ProjectsOutcome<ProjectEntry>> {
  return call<ProjectEntry>('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }, INGEST_TIMEOUT_MS);
}

/** 详情 + 新鲜度。项目不在了 → rejected(NOT_FOUND)。 */
export function getProject(id: string): Promise<ProjectsOutcome<ProjectDetail>> {
  return call<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}`);
}

/** 刷新缓存。源头不可达 → rejected(SOURCE_UNREACHABLE)，旧缓存原样保留。 */
export function refreshProject(id: string): Promise<ProjectsOutcome<ProjectDetail>> {
  return call<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}/refresh`, { method: 'POST' });
}

// ── 侦察 / 体检的服务端留档端点（工坊棒3）──
//
// 这五个函数是 /autopsy 页读「按项目留档」的唯一出口：facts 缓存、体检 latest +
// history、重扫缓存、跑体检。404（NOT_FOUND）不是故障 —— 是「还没扫过 / 还没体检过」
// 的正常空态，页面据 rejected.code === 'NOT_FOUND' 分辨它，与真失败分开说。

/** 缓存事实。还没扫过 → rejected(NOT_FOUND)（空态，不是故障）。 */
export function getProjectFacts(id: string): Promise<ProjectsOutcome<unknown>> {
  return call<unknown>(`/api/projects/${encodeURIComponent(id)}/facts`);
}

/** 重扫缓存 → 更新 facts 留档，返回 facts。缓存不存在 → rejected(NOT_FOUND)。 */
export function scanProject(id: string): Promise<ProjectsOutcome<unknown>> {
  return call<unknown>(`/api/projects/${encodeURIComponent(id)}/scan`, { method: 'POST' });
}

/** 体检历史摘要列表（无内嵌整报告）。 */
export function getCheckupHistory(id: string): Promise<ProjectsOutcome<unknown[]>> {
  return call<unknown[]>(`/api/projects/${encodeURIComponent(id)}/checkups`);
}

/** 最近一次体检。还没体检过 → rejected(NOT_FOUND)。 */
export function getCheckupLatest(id: string): Promise<ProjectsOutcome<unknown>> {
  return call<unknown>(`/api/projects/${encodeURIComponent(id)}/checkups/latest`);
}

/** 跑一次体检（读缓存）→ 服务端写 latest + history，返回报告。 */
export function runProjectCheckup(id: string): Promise<ProjectsOutcome<unknown>> {
  return call<unknown>(`/api/projects/${encodeURIComponent(id)}/checkup`, { method: 'POST' });
}

/** 删除：摘注册项 + 删缓存 / facts / 体检留档；QA 历史保留。 */
export function deleteProject(id: string): Promise<ProjectsOutcome<DeleteResult>> {
  return call<DeleteResult>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
