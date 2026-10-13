/**
 * 活体对账（纯函数，零依赖，不碰 React，可在 Node 与浏览器两侧跑）。
 *
 * 回答的问题是「**静态声明的，运行时是不是真的**」—— 三问，只这三问：
 *
 *   ① 入口：静态说有 N 个可运行入口，运行时真起来了几个？（幽灵进程 / 起了没声明的）
 *   ② 端口：配置里写的 server.port，和实际监听的端口对不对得上？（配置没生效 / 端口冲突）
 *   ③ health：声明了 actuator，GET /actuator/health 到底答什么？（声明了健康检查，现实是 DOWN）
 *
 * **本文件是全仓唯一一份「运行时对账」实现。** Java 侧（RuntimeProbe）只摊平事实 ——
 * 它给的是「日志第几行说了什么、HTTP 回了几」，不给「对不对」。
 * 判定写两份就会漂移（本仓 10-04 硬约定 18：判定逻辑只有一份实现）。
 *
 * 三条不能破的规矩：
 *
 *   ① **没跑就是没跑。** verdict 是 `'not-run'` 时 reason 必非空，且原样送到 UI。
 *      绝不允许「采不到」被显示成「正常」—— 这是 10-04 那条铁律（「没检查」和
 *      「检查通过」不许长得一样）的运行时版本。
 *   ② **每条结论两侧都要有证据。** 静态侧给 file:line，运行时侧给日志行号或 HTTP 状态。
 *      只有一侧的不能叫「对账」，只能叫「声明」—— verdict 一律 not-run。
 *   ③ **0 也是结论。** 一个入口都没跑起来时，summary 必须说出来，不许出现空白面板
 *      或「N 个…」整条消失（10-03 教训：`{n > 0 && …}` 在 0 条时把结论本身也删了）。
 */

import type { ProjectFacts } from './facts-arch';

// ─────────────────────────────────────────────────────────────
// 一、类型（与 RuntimeProbe 输出的 JSON 一一对应，字段名不许各写一套）
// ─────────────────────────────────────────────────────────────

/** 后端 RuntimeProbe 摊平出来的运行时事实。字段缺失按「没采到」处理，不猜 */
export interface RuntimeProbeFact {
  runtime?: string;
  supported?: boolean;
  mainClass?: string;
  bootVersion?: string | null;
  /** 'executed' —— 真跑起来了；'not-executed' —— 没跑起来（reason 必非空）；'partial' —— 跑了但没采全 */
  status?: 'executed' | 'not-executed' | 'partial';
  reason?: string;
  steps?: { name: string; status: string; ms: number; detail?: string }[];
  process?: {
    status?: string;
    stoppedBy?: string;
    exitCode?: number;
    elapsedMs?: number;
    truncated?: boolean;
    reason?: string;
  };
  log?: {
    stdoutLines?: number;
    stderrLines?: number;
    tail?: { n: number; stream: string; text: string }[];
    errors?: { n: number; stream: string; text: string }[];
  };
  port?: {
    value?: number | null;
    source?: string;
    note?: string;
    evidence?: { stream?: string; line?: number; text?: string };
  } | null;
  health?: {
    endpoint?: string;
    probed?: boolean;
    httpStatus?: number;
    body?: string;
    note?: string;
  };
  missingDeps?: string[];
  wallClockMs?: number;
}

/** 静态侧证据：解剖台扫出来的声明在哪儿 */
export interface StaticEvidence {
  file: string;
  line: number;
  text: string;
}

/** 运行时侧证据：日志哪一行，或 HTTP 回了什么 */
export interface RuntimeEvidence {
  /** 'log' —— 来自被解剖进程的 stdout/stderr；'http' —— 来自我们对它发的那一次请求 */
  source: 'log' | 'http' | 'none';
  stream?: string;
  line?: number;
  text?: string;
  httpStatus?: number;
}

export type ReconKind = 'entry' | 'port' | 'health';
export type ReconVerdict = 'match' | 'mismatch' | 'not-run';

export interface ReconRow {
  kind: ReconKind;
  /** 这一问在问什么（原样显示在 UI 上） */
  question: string;
  verdict: ReconVerdict;
  /** verdict !== 'match' 时必非空。not-run 尤其必须说清「为什么没跑」 */
  reason: string;
  staticEvidence: StaticEvidence | null;
  runtimeEvidence: RuntimeEvidence | null;
}

export interface RuntimeRecon {
  rows: ReconRow[];
  /** 静态声明的入口数 */
  declared: number;
  /** 真跑起来的入口数（status === 'executed' 且解析到端口） */
  started: number;
  /** 跑过（不管成没成）的入口数 */
  attempted: number;
  counts: { match: number; mismatch: number; notRun: number };
  /** 顶部那句话。0 个入口、0 个跑起来时也要说 —— 那本身就是一条结论 */
  summary: string;
  /** 采集没执行的原因清单（UI 原样展示，不许吞） */
  notRunReasons: string[];
  /** 有没有被输出上限截断（对应 UI 顶部亮条） */
  truncated: boolean;
}

// ─────────────────────────────────────────────────────────────
// 二、对账
// ─────────────────────────────────────────────────────────────

/**
 * 从 facts.config 里找静态声明的 server.port。
 *
 * 读不到返回 null —— 返回 null 的意思是「这一问今晚无解」，
 * 不是「端口是默认的」。默认端口是猜，猜出来的不能进对账表。
 */
export function declaredPort(facts: ProjectFacts | null | undefined): { port: number; file: string } | null {
  const configs = facts?.config ?? [];
  for (const c of configs) {
    const raw = c?.values?.['server.port'];
    if (raw == null) continue;
    const n = Number(String(raw).trim());
    if (!Number.isFinite(n) || n <= 0) continue;
    return { port: n, file: c.path };
  }
  return null;
}

/** 运行时事实里那次 health 到底说了什么。返回人话，不返回 true/false */
export function healthWording(probe: RuntimeProbeFact | null | undefined): string {
  if (!probe) return '没有运行时采集结果 —— 没采，不是没病';
  const h = probe.health;
  if (!h) return '采集结果里没有 health 段 —— 没探，不是健康';
  if (h.probed === false) return h.note?.trim() || '没探到 health（原因未记录）';
  if (h.httpStatus == null || h.httpStatus < 0) return `health 请求没拿到响应（${h.note ?? '连接被拒或超时'}）`;
  const up = /"status"\s*:\s*"UP"/i.test(h.body ?? '');
  if (h.httpStatus === 200 && up) return `HTTP ${h.httpStatus}，body 里 status=UP —— 健康`;
  if (h.httpStatus === 200 && !up) return `HTTP ${h.httpStatus}，但 body 里没有 status=UP（${h.body ?? '空 body'}）`;
  return `HTTP ${h.httpStatus} —— 不是 200`;
}

/**
 * 对账主入口。
 *
 * @param facts   解剖台静态事实（入口 + 配置）
 * @param probes  每个入口一次运行时采集（下标与 entryPoints 对应；缺失的按「没跑」处理）
 */
export function reconcileRuntime(
  facts: ProjectFacts | null | undefined,
  probes: (RuntimeProbeFact | null | undefined)[],
): RuntimeRecon {
  const entries = facts?.code?.entryPoints ?? [];
  const rows: ReconRow[] = [];
  const notRunReasons: string[] = [];
  let truncated = false;
  let started = 0;
  let attempted = 0;

  const declared = entries.length;

  // ── ① 入口：静态声明 vs 真起来了几个 ──────────────────────
  entries.forEach((ep, i) => {
    const probe = probes[i] ?? null;
    const staticEvidence: StaticEvidence = {
      file: ep.file,
      line: ep.line,
      text: `${ep.className ?? '(类名缺失)'} · runtime=${ep.runtime}`,
    };
    if (!probe) {
      rows.push(row('entry', `入口「${ep.className ?? ep.file}」真的能起来吗`, 'not-run',
        '这一路没有运行时采集结果 —— 没跑，不等于没问题', staticEvidence, null));
      notRunReasons.push(`${ep.className ?? ep.file}：没有对应的运行时采集结果`);
      return;
    }
    attempted++;
    if (probe.process?.truncated) truncated = true;

    const executed = probe.status === 'executed';
    const portVal = probe.port?.value ?? null;
    if (executed && portVal != null) started++;

    const ev = probe.port?.evidence;
    const runtimeEvidence: RuntimeEvidence = ev
      ? { source: 'log', stream: ev.stream, line: ev.line, text: ev.text }
      : { source: 'none', text: probe.reason || '启动日志里没有端口行' };

    if (executed && portVal != null) {
      rows.push(row('entry', `入口「${ep.className ?? ep.file}」真的能起来吗`, 'match',
        `起来了，监听 ${portVal}`, staticEvidence, runtimeEvidence));
    } else if (executed) {
      rows.push(row('entry', `入口「${ep.className ?? ep.file}」真的能起来吗`, 'not-run',
        probe.reason?.trim() || '进程起来了但解析不到监听端口 —— 没解析到就是没解析到',
        staticEvidence, runtimeEvidence));
      notRunReasons.push(`${ep.className ?? ep.file}：${probe.reason ?? '解析不到端口'}`);
    } else {
      rows.push(row('entry', `入口「${ep.className ?? ep.file}」真的能起来吗`, 'mismatch',
        probe.reason?.trim() || '起不来（采集器没给原因 —— 这是采集器的缺陷，不是无事发生）',
        staticEvidence, runtimeEvidence));
      const r = probe.reason?.trim();
      if (r) notRunReasons.push(`${ep.className ?? ep.file}：${r}`);
    }
  });

  // 一个入口都没有 —— 这本身是一条结论，必须在 rows 里留痕
  if (declared === 0) {
    rows.push(row('entry', '这个项目有没有可运行入口', 'not-run',
      '静态事实里没有登记到任何可运行入口 —— 没有入口就无从跑起，这是结论不是空白',
      null, null));
    notRunReasons.push('静态事实里没有可运行入口');
  }

  // ── ② 端口：配置声明 vs 实际监听 ─────────────────────────
  const dp = declaredPort(facts);
  const firstUp = probes.find((p) => p && p.status === 'executed' && p.port?.value != null) ?? null;
  if (!dp) {
    rows.push(row('port', '配置里的 server.port 和实际监听的端口对得上吗', 'not-run',
      '静态事实里读不到 server.port 声明（解剖台目前不逐条采配置项）—— 这一问今晚无解，'
        + '不是「端口没问题」', null, firstUp?.port?.evidence
          ? { source: 'log', stream: firstUp.port.evidence.stream, line: firstUp.port.evidence.line, text: firstUp.port.evidence.text }
          : null));
    notRunReasons.push('静态事实里读不到 server.port —— 端口这一问无解');
  } else if (!firstUp) {
    rows.push(row('port', '配置里的 server.port 和实际监听的端口对得上吗', 'not-run',
      `静态声明 ${dp.port}，但没有任何入口真跑起来 —— 没有运行时一侧，这一问不成立`,
      { file: dp.file, line: 1, text: `server.port=${dp.port}` }, null));
    notRunReasons.push('没有入口真跑起来，端口无从比对');
  } else {
    const actual = firstUp.port!.value!;
    const ev = firstUp.port!.evidence;
    const runtimeEvidence: RuntimeEvidence = ev
      ? { source: 'log', stream: ev.stream, line: ev.line, text: ev.text }
      : { source: 'none', text: String(actual) };
    // --server.port=0 是采集器为了不抢宿主端口而强制覆盖的，此时「配置没生效」是预期行为，
    // 不是 mismatch。分不清这一点，这条断言就会永远红，也就没人再信它。
    if (actual === dp.port) {
      rows.push(row('port', '配置里的 server.port 和实际监听的端口对得上吗', 'match',
        `声明 ${dp.port}，实际 ${actual}`, { file: dp.file, line: 1, text: `server.port=${dp.port}` },
        runtimeEvidence));
    } else {
      rows.push(row('port', '配置里的 server.port 和实际监听的端口对得上吗', 'mismatch',
        `声明 ${dp.port}，实际监听 ${actual} —— 采集时用 --server.port=0 强制随机端口`
          + '（避免抢宿主端口），所以这个不一致是采集姿势造成的，不代表项目配置错了。'
          + '要验真实端口冲突，得改成固定端口再采一次',
        { file: dp.file, line: 1, text: `server.port=${dp.port}` }, runtimeEvidence));
    }
  }

  // ── ③ health：声明了 actuator 吗，它答了什么 ──────────────
  const probeForHealth = firstUp ?? probes.find((p) => p && p.health) ?? null;
  if (!probeForHealth) {
    rows.push(row('health', '声明了健康检查，它真的答了吗', 'not-run',
      '没有任何一次采集探到了 health —— 没探，不是健康（有 actuator 但 DOWN 会另说）',
      null, null));
    notRunReasons.push('没有探到 health');
  } else {
    const h = probeForHealth.health ?? {};
    const runtimeEvidence: RuntimeEvidence = h.probed
      ? { source: 'http', httpStatus: h.httpStatus, text: (h.body ?? '').slice(0, 200) }
      : { source: 'none', text: h.note ?? '' };
    if (h.probed && h.httpStatus === 200 && /"status"\s*:\s*"UP"/i.test(h.body ?? '')) {
      rows.push(row('health', '声明了健康检查，它真的答了吗', 'match',
        healthWording(probeForHealth), null, runtimeEvidence));
    } else if (h.probed) {
      rows.push(row('health', '声明了健康检查，它真的答了吗', 'mismatch',
        healthWording(probeForHealth), null, runtimeEvidence));
    } else {
      rows.push(row('health', '声明了健康检查，它真的答了吗', 'not-run',
        healthWording(probeForHealth), null, runtimeEvidence));
      const n = (h.note ?? '').trim();
      if (n) notRunReasons.push(`health：${n}`);
    }
  }

  const counts = {
    match: rows.filter((r) => r.verdict === 'match').length,
    mismatch: rows.filter((r) => r.verdict === 'mismatch').length,
    notRun: rows.filter((r) => r.verdict === 'not-run').length,
  };

  return {
    rows,
    declared,
    started,
    attempted,
    counts,
    summary: summaryOf(declared, started, attempted, counts, truncated),
    notRunReasons,
    truncated,
  };
}

function row(
  kind: ReconKind,
  question: string,
  verdict: ReconVerdict,
  reason: string,
  staticEvidence: StaticEvidence | null,
  runtimeEvidence: RuntimeEvidence | null,
): ReconRow {
  // 防御：match 之外的都必须有 reason。没有 reason 的 not-run 就是「静默失败」本人。
  const safeReason = reason?.trim()
    ? reason
    : verdict === 'match'
      ? ''
      : '（采集器没给出原因 —— 这是缺陷，不该发生；已按未执行记账）';
  return { kind, question, verdict, reason: safeReason, staticEvidence, runtimeEvidence };
}

/**
 * 顶部那句话。**0 的情况必须单独说** ——
 * 「0 个入口跑起来」和「一切正常」在 UI 上长得一样（都是一片空白）是最坏的结果。
 */
export function summaryOf(
  declared: number,
  started: number,
  attempted: number,
  counts: { match: number; mismatch: number; notRun: number },
  truncated: boolean,
): string {
  const parts: string[] = [];
  if (declared === 0) {
    parts.push('静态事实里没有可运行入口 —— 活体解剖无从下手');
  } else {
    parts.push(`静态声明 ${declared} 个入口，跑了 ${attempted} 个，真起来 ${started} 个`);
  }
  parts.push(`对账 ${counts.match + counts.mismatch + counts.notRun} 条：对上 ${counts.match}、`
    + `对不上 ${counts.mismatch}、未执行 ${counts.notRun}`);
  if (counts.notRun > 0) {
    parts.push(`未执行的 ${counts.notRun} 条是「没跑到」，不是「没问题」`);
  }
  if (truncated) parts.push('输出被上限截断过，证据不完整');
  return parts.join('；');
}

/** 三区分组，给 UI 用（顺序固定：入口 / 端口 / health） */
export function groupByKind(rows: ReconRow[]): { kind: ReconKind; label: string; rows: ReconRow[] }[] {
  const labels: Record<ReconKind, string> = {
    entry: '一、入口：声明了几个，真起来几个',
    port: '二、端口：配置说的 vs 实际听的',
    health: '三、健康检查：声明了，答了吗',
  };
  return (['entry', 'port', 'health'] as ReconKind[]).map((k) => ({
    kind: k,
    label: labels[k],
    rows: rows.filter((r) => r.kind === k),
  }));
}

/** 证据行号的人话形式。两侧都可能没有 —— 没有就说没有，不编一个 */
export function evidenceText(e: StaticEvidence | RuntimeEvidence | null): string {
  if (!e) return '（无）';
  if ('file' in e) return `${e.file}:${e.line} —— ${e.text}`;
  if (e.source === 'http') return `HTTP ${e.httpStatus ?? '?'} —— ${e.text || '(空 body)'}`;
  if (e.source === 'log') return `日志 ${e.stream ?? '?'}:${e.line ?? '?'} —— ${e.text ?? ''}`;
  return e.text?.trim() ? e.text : '（运行时没留下可引用的证据）';
}
