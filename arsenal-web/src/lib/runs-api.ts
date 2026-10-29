/**
 * Run 产物 API 客户端（夜班 N7/N8，2026-10-30）。
 *
 * 重建后的项目主页数据口：run 列表 / 提交体检 / 产物清单 / findings 筛选。
 * 三态口径与 projects-api 完全同源（直接复用它的 call / offline / timeout 文案）——
 * 后端不在不是错误，是静态站的正常形态，页面必须照实说。
 *
 * 后端契约见 arsenal-server 的 RunsController / RunArtifactController（单一信封
 * {success, code, message, data}）。
 */
import { arsenalApiBase } from './arsenal-api';
import { call, type ProjectsOutcome } from './projects-api';

/** run 状态账（run.json 的列表条目形态）。status 只有 RUNNING / DONE / FAILED / UNKNOWN。 */
export interface RunSummary {
  runId: string;
  projectId: string;
  status: 'RUNNING' | 'DONE' | 'FAILED' | 'UNKNOWN';
  startedAt: string;
  endedAt?: string;
  manifest?: { snapshot?: string; rulesetVersion?: string; engine?: string; triggeredBy?: string };
}

export interface RunCounts {
  p0: number;
  p1: number;
  other: number;
}

/** POST runs 的完成响应。 */
export interface RunDone {
  runId: string;
  projectId: string;
  status: 'DONE' | 'FAILED';
  elapsedMs: number;
  counts: RunCounts;
  files: string[];
}

export interface RunArtifact {
  name: string;
  bytes: number;
  sha256: string;
}

/** findings.jsonl 的一行（引擎产出的 finding，rule 内嵌了规则全量与出处）。 */
export interface RunFinding {
  ruleId: string;
  title: string;
  severity: string;
  category?: string;
  file: string;
  line: number;
  column?: number;
  snippet?: string;
  message?: string;
  evidence?: string;
  collapsed?: number;
  rule?: {
    id?: string;
    sources?: { ref?: string; type?: string; quote?: string }[];
    rationale?: string;
    good?: string;
  };
}

export interface FindingsPage {
  total: number;
  returned: number;
  badLines: number;
  filters: { severity: string; ruleId: string; file: string };
  items: RunFinding[];
}

const RUN_TIMEOUT_MS = 180_000; // 静态引擎秒级到分钟级，给足

/** run 列表（磁盘账，新的在前）。 */
export function listRuns(projectId: string): Promise<ProjectsOutcome<RunSummary[]>> {
  return call<RunSummary[]>(`/api/v2/projects/${encodeURIComponent(projectId)}/runs`);
}

/** 提交一次体检 run（同步执行；体检慢是常态，单独 180 秒，超时说「没响应完」）。 */
export function createRun(projectId: string): Promise<ProjectsOutcome<RunDone>> {
  return call<RunDone>(
    `/api/v2/projects/${encodeURIComponent(projectId)}/runs`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    RUN_TIMEOUT_MS,
  );
}

/** 产物清单（带 sha256 与字节数）。 */
export function runArtifacts(runId: string): Promise<ProjectsOutcome<RunArtifact[]>> {
  return call<RunArtifact[]>(`/api/v2/runs/${encodeURIComponent(runId)}/artifacts`);
}

/** findings 筛选读取（后端解析 JSONL，前端不算第二遍）。 */
export function runFindings(
  runId: string,
  f: { severity?: string; ruleId?: string; file?: string; limit?: number },
): Promise<ProjectsOutcome<FindingsPage>> {
  const q = new URLSearchParams();
  if (f.severity) q.set('severity', f.severity);
  if (f.ruleId) q.set('ruleId', f.ruleId);
  if (f.file) q.set('file', f.file);
  if (f.limit) q.set('limit', String(f.limit));
  const qs = q.toString();
  return call<FindingsPage>(`/api/v2/runs/${encodeURIComponent(runId)}/findings${qs ? `?${qs}` : ''}`);
}

/** report.md 的直链（浏览器下载用 —— 带附件头，点开即落文件）。 */
export function reportDownloadUrl(runId: string): string {
  return `${arsenalApiBase()}/api/v2/runs/${encodeURIComponent(runId)}/report.md`;
}
