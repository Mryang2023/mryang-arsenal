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

function offlineMessage(e: unknown): string {
  const base = arsenalApiBase();
  const detail = e instanceof Error ? e.message : String(e);
  return `连不上后端 ${base}（${detail}）。项目工坊整组功能需要后端 :3011 —— 起服务的命令是 bash arsenal-server/scripts/run.sh。`;
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

async function call<T>(path: string, init?: RequestInit): Promise<ProjectsOutcome<T>> {
  const base = arsenalApiBase();
  try {
    return await readEnvelope<T>(
      await fetchWithTimeout(`${base}${path}`, init ?? {}, PROJECTS_TIMEOUT_MS)
    );
  } catch (e) {
    return { kind: 'offline', message: offlineMessage(e) };
  }
}

/** 列表（摘要，不 walk 源头）。后端不可达时离线，列表为空。 */
export function listProjects(): Promise<ProjectsOutcome<ProjectEntry[]>> {
  return call<ProjectEntry[]>('/api/projects');
}

/** 加项目 + 摄取缓存。重复 id → CONFLICT（不建第二份）；限额超限 → QUOTA_EXCEEDED（不留半份）。 */
export function addProject(input: { name: string; source: ProjectSource }): Promise<ProjectsOutcome<ProjectEntry>> {
  return call<ProjectEntry>('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

/** 详情 + 新鲜度。项目不在了 → rejected(NOT_FOUND)。 */
export function getProject(id: string): Promise<ProjectsOutcome<ProjectDetail>> {
  return call<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}`);
}

/** 刷新缓存。源头不可达 → rejected(SOURCE_UNREACHABLE)，旧缓存原样保留。 */
export function refreshProject(id: string): Promise<ProjectsOutcome<ProjectDetail>> {
  return call<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}/refresh`, { method: 'POST' });
}

/** 删除：摘注册项 + 删缓存 / facts / 体检留档；QA 历史保留。 */
export function deleteProject(id: string): Promise<ProjectsOutcome<DeleteResult>> {
  return call<DeleteResult>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
