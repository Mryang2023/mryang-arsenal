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

// ── 项目档案（只读索引 docs/ + @TableName）──
//
// 与 facts / checkup 是两条路：那两条回答「代码是什么样」，这条回答「项目自己记了什么」。
// 档案来自缓存里的文档，重扫不会变 —— 文档是人写的承诺，扫不出来。

/** 解析过程中的补充说明（缺目录 / 行数不足 / 有表没文档）。页面照实展示，不当错误。 */
export interface DossierNote {
  level: 'info' | 'warn' | string;
  code: string;
  message: string;
}

export interface DossierColumn {
  no: number;
  name: string;
  type: string;
  nullable: string;
  defaultValue: string;
  comment: string;
  enumOrUnit: string;
  index: string;
  javaField: string;
  javaType: string;
}

export interface DossierTable {
  table: string;
  title: string;
  /** true = 有 docs/db/tables/<表名>.md；false = 只有实体，列是从 Java 字段反推的 */
  documented: boolean;
  source?: 'entity' | string;
  file?: string;
  updatedAt?: string;
  entityClass?: string;
  entityFile?: string;
  entityExtends?: string;
  basic?: Record<string, string>;
  columns: DossierColumn[];
  indexes: { name: string; type: string; fields: string; purpose: string }[];
  relations: { field: string; targetTable: string; targetField: string; relation: string; onDelete: string }[];
  changes: { date: string; script: string; summary: string }[];
}

export interface DossierChangelogEntry {
  date: string;
  script: string;
  table: string;
  operation: string;
  before: string;
  after: string;
  reason: string;
  impact: string;
  rollback: string;
  envResult: string;
  tableDoc: string;
  entity: string;
}

export interface DossierScript {
  file: string;
  template: boolean;
  bytes: number;
  lines: number;
  statements: number;
  tables: string[];
  updatedAt: string;
}

export interface Dossier {
  schemaVersion: number;
  root: string;
  indexedAt: string;
  available: boolean;
  notes: DossierNote[];
  stats: {
    tables: number;
    tablesDocumented: number;
    tablesUndocumented: number;
    changelogEntries: number;
    scripts: number;
    entities: number;
    charterLines: number;
  };
  charter: {
    found: boolean;
    file?: string;
    title?: string;
    lines?: number;
    bytes?: number;
    readable?: boolean;
    updatedAt?: string;
    outline: { level: number; number?: string; title: string; line: number }[];
  };
  db: {
    present: boolean;
    changelog: {
      found: boolean;
      file?: string;
      count?: number;
      skippedRows?: number;
      entries?: DossierChangelogEntry[];
    };
    tables: DossierTable[];
    scripts: DossierScript[];
    entities: { table: string; class: string; file: string; extends: string }[];
  };
}

/** 档案索引。缓存不存在 → rejected(NOT_FOUND)（空态，不是故障）。 */
export function getProjectDossier(id: string): Promise<ProjectsOutcome<Dossier>> {
  return call<Dossier>(`/api/projects/${encodeURIComponent(id)}/dossier`);
}

/** 读一份文档原文（.md / .sql，512KB 上限，路径由后端做边界校验）。 */
export function getProjectDoc(id: string, path: string): Promise<ProjectsOutcome<{ path: string; bytes: number; content: string }>> {
  return call<{ path: string; bytes: number; content: string }>(
    `/api/projects/${encodeURIComponent(id)}/doc?path=${encodeURIComponent(path)}`,
  );
}

/** 删除：摘注册项 + 删缓存 / facts / 体检留档；QA 历史保留。 */
export function deleteProject(id: string): Promise<ProjectsOutcome<DeleteResult>> {
  return call<DeleteResult>(`/api/projects/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ── DDL 四件套：校验 / 变更计划（Phase 2）──
//
// 三件事刻意分开命名，因为语义不同：
//   verify 是「现在缺什么」的只读审计；
//   plan   是「这次改表要写哪四份文件」的生成器（writes:false，军火库不落盘）；
//   plans  是军火库自己的计划留档（记录 ≠ 操作）。
// 客户端不提供 apply —— 后端也没有这个端点，别在这里补。

export type DdlIssueLevel = 'error' | 'warn' | 'info';

export interface DdlIssue {
  level: DdlIssueLevel;
  code: string;
  field?: string;
  message: string;
}

export interface DdlArtifact {
  /** 建议落点（相对被管理项目根）。只是建议，军火库不写。 */
  path: string;
  action: 'create' | 'update' | 'append' | 'fragment' | 'none';
  content: string;
}

export interface DdlPlanChecklistItem {
  key: 'sql' | 'changelog' | 'tableDoc' | 'entity';
  label: string;
  ok: boolean;
  path: string;
  note: string;
}

export interface DdlPlan {
  schemaVersion: number;
  planId: string;
  generatedAt: string;
  recordedAt?: string;
  recorded?: boolean;
  /** 永远是 false：军火库只生成、不操作被管理项目。 */
  writes: false;
  note: string;
  table: string;
  title: string;
  operation: string;
  module: string;
  date: string;
  paths: { sql: string; changelog: string; tableDoc: string; entity: string };
  artifacts: { sql: DdlArtifact; changelog: DdlArtifact; tableDoc: DdlArtifact; entity: DdlArtifact };
  warnings: DdlIssue[];
  checklist: DdlPlanChecklistItem[];
  stats: { businessColumns: number; totalColumns: number; indexes: number; errors: number; warns: number };
}

/** 列表摘要不带 artifacts（正文太长），problems 只留 warn/error。 */
export interface DdlPlanSummary {
  planId: string;
  recordedAt: string;
  generatedAt: string;
  table: string;
  title: string;
  operation: string;
  module: string;
  date: string;
  paths: DdlPlan['paths'];
  stats: DdlPlan['stats'];
  problems: DdlIssue[];
}

export interface DdlTableAudit {
  table: string;
  title: string;
  module: string;
  status: 'complete' | 'partial' | 'missing';
  okPieces: number;
  totalPieces: number;
  pieces: {
    sql: { ok: boolean; count: number; statements: number; files: string[] };
    changelog: { ok: boolean; count: number; lastDate: string };
    tableDoc: {
      ok: boolean;
      file: string;
      columns: number;
      entityDerivedColumns: number;
      missingSections: number[];
      sectionsFound?: number;
      placeholders?: number;
      businessColumns: number;
      entityFields: number;
    };
    entity: { ok: boolean; class: string; file: string; fields: number; extendsBaseEntity: boolean };
  };
  reconcile: {
    docBusinessFields: number;
    entityBusinessFields: number;
    comparable: boolean;
    match: boolean;
  };
  issues: DdlIssue[];
}

export interface DdlVerify {
  schemaVersion: number;
  generatedAt: string;
  writes: false;
  note: string;
  available: boolean;
  score: number;
  summary: {
    tables: number;
    complete: number;
    partial: number;
    missing: number;
    scripts: number;
    templateScripts: number;
    changelogEntries: number;
    entities: number;
    documented: number;
    score: number;
  };
  checks: { key: string; label: string; covered: number; total: number; ok: boolean; percent: number }[];
  tables: DdlTableAudit[];
  findings: DdlIssue[];
}

/** 四件套完整性审计。只读，可反复调用。 */
export function getProjectDdlVerify(id: string): Promise<ProjectsOutcome<DdlVerify>> {
  return call<DdlVerify>(`/api/projects/${encodeURIComponent(id)}/ddl/verify`);
}

/** 生成变更计划。record:false 只看不留档。 */
export function planDdlChange(id: string, body: Record<string, unknown>): Promise<ProjectsOutcome<DdlPlan>> {
  return call<DdlPlan>(`/api/projects/${encodeURIComponent(id)}/ddl/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** 计划留档列表（摘要，按记录时间倒序）。 */
export function listDdlPlans(id: string): Promise<ProjectsOutcome<DdlPlanSummary[]>> {
  return call<DdlPlanSummary[]>(`/api/projects/${encodeURIComponent(id)}/ddl/plans`);
}

/** 单份计划全文（含四件套正文）。 */
export function getDdlPlan(id: string, planId: string): Promise<ProjectsOutcome<DdlPlan>> {
  return call<DdlPlan>(
    `/api/projects/${encodeURIComponent(id)}/ddl/plans/${encodeURIComponent(planId)}`,
  );
}

// ─────────────────────────────────────────────────────────────
// 模块开发看板（只读推断）
// ─────────────────────────────────────────────────────────────

export type ModuleStageStatus = 'done' | 'partial' | 'todo' | 'ready';
export type ModuleRoot = 'backend' | 'frontend';

export interface ModuleEvidence {
  path: string;
  root: ModuleRoot;
  note: string;
}

export interface ModuleMissing {
  path: string;
  root: ModuleRoot;
}

/** 一个阶段的格子。detail 是给人看的一句话，evidence/missing 是给「凭什么」看的路径。 */
export interface ModuleStage {
  no: number;
  key: string;
  name: string;
  status: ModuleStageStatus;
  detail: string;
  evidence: ModuleEvidence[];
  missing: ModuleMissing[];
  /** ④ 后端实现 */
  endpointCount?: number;
  controllerCount?: number;
  /** ⑤ 接口文档 */
  codeEndpoints?: number;
  docEndpoints?: number;
  missingCount?: number;
  extraCount?: number;
  /** ⑥ 前端实现 */
  detected?: boolean;
  apiFiles?: number;
  viewFiles?: number;
}

export interface ModuleEntry {
  module: string;
  label: string;
  stages: ModuleStage[];
  progress: { done: number; total: number; percent: number };
  acceptReady: boolean;
  nextAction: string;
}

export interface ModuleBoard {
  schemaVersion: number;
  generatedAt: string;
  writes: false;
  note: string;
  available: boolean;
  project: { id: string; name: string; path: string };
  frontend: {
    detected: boolean;
    id?: string;
    name?: string;
    path?: string;
    root?: string;
    fromCache?: boolean;
  };
  playbook: { file: string; found: boolean; apiReadme: boolean };
  notes: DdlIssue[];
  modules: ModuleEntry[];
  summary: {
    modules: number;
    acceptReady: number;
    inProgress: number;
    notStarted: number;
    stageDone: Record<string, number>;
  };
}

/** 模块开发看板。状态完全由仓库文件推断，不存第二份进度。 */
export function getModuleBoard(id: string): Promise<ProjectsOutcome<ModuleBoard>> {
  return call<ModuleBoard>(`/api/projects/${encodeURIComponent(id)}/modules`);
}

// ─────────────────────────────────────────────────────────────
// 接口文档（只对账 + 只出稿）
// ─────────────────────────────────────────────────────────────

export interface ApiDocEndpoint {
  method: string;
  path: string;
  backendPath?: string;
  summary?: string;
  permission?: string;
  line?: number;
}

export interface ApiDocFileStat {
  present: boolean;
  path: string;
  endpointCount: number;
  extra?: string[];
  readable?: boolean;
  error?: string;
}

export interface ApiDocVerify {
  schemaVersion: number;
  generatedAt: string;
  writes: false;
  note: string;
  module: string;
  status: 'ok' | 'incomplete' | 'missing';
  ok: boolean;
  code: {
    controllerCount: number;
    endpointCount: number;
    paths: string[];
    controllers: { file: string; class: string; tag: string; base: string }[];
  };
  doc: { markdown: ApiDocFileStat; openapi: ApiDocFileStat };
  matched: ApiDocEndpoint[];
  missing: ApiDocEndpoint[];
  extra: ApiDocEndpoint[];
  summary: {
    codeEndpoints: number;
    docEndpoints: number;
    matched: number;
    missing: number;
    extra: number;
  };
  notes: DdlIssue[];
}

export interface ApiDocArtifact {
  path: string;
  action: 'create' | 'update' | 'none' | string;
  content: string;
}

export interface ApiDocPlan {
  schemaVersion: number;
  planId: string;
  generatedAt: string;
  writes: false;
  note: string;
  module: string;
  date: string;
  code: { endpointCount: number; controllers: { file: string; class: string; base: string }[] };
  artifacts: { markdown: ApiDocArtifact; openapi: ApiDocArtifact };
  stats: {
    endpoints: number;
    controllers: number;
    resources: number;
    withPermission: number;
    withSummary: number;
  };
  recorded?: boolean;
  recordedAt?: string;
  recordError?: string;
}

export interface ApiDocPlanResponse {
  schemaVersion: number;
  kind: string;
  generatedAt: string;
  writes: false;
  note: string;
  module: string;
  notes: DdlIssue[];
  plan: ApiDocPlan;
}

export interface ApiDocPlanSummary {
  planId: string;
  recordedAt: string;
  generatedAt: string;
  module: string;
  stats: ApiDocPlan['stats'];
  files: { kind: string; path: string; action: string; chars: number }[];
}

/** 文档与代码对账。只读，可反复调用。 */
export function getApiDocVerify(id: string, module: string): Promise<ProjectsOutcome<ApiDocVerify>> {
  return call<ApiDocVerify>(
    `/api/projects/${encodeURIComponent(id)}/apidoc/verify?module=${encodeURIComponent(module)}`,
  );
}

/** 按代码生成 Markdown + OpenAPI 草稿。record:false 只看不留档。 */
export function planApiDoc(
  id: string,
  module: string,
  record = true,
): Promise<ProjectsOutcome<ApiDocPlanResponse>> {
  return call<ApiDocPlanResponse>(`/api/projects/${encodeURIComponent(id)}/apidoc/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ module, record }),
  });
}

/** 草稿留档列表（摘要，按记录时间倒序）。 */
export function listApiDocPlans(id: string): Promise<ProjectsOutcome<ApiDocPlanSummary[]>> {
  return call<ApiDocPlanSummary[]>(`/api/projects/${encodeURIComponent(id)}/apidoc/plans`);
}

/** 单份草稿全文（含两份文档正文）。 */
export function getApiDocPlan(id: string, planId: string): Promise<ProjectsOutcome<ApiDocPlan>> {
  return call<ApiDocPlan>(
    `/api/projects/${encodeURIComponent(id)}/apidoc/plans/${encodeURIComponent(planId)}`,
  );
}
