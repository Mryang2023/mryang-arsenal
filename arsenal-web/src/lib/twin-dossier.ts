/**
 * 数字孪生 · 对话问诊 —— 「对着这个项目的活档案问一句话」的**档案装配与提问策略**。
 *
 * ─────────────────────────────────────────────────────────────
 * 它只装三样东西，**不碰 LLM**：
 *   ① `buildTwinDossier`：把四层（静态 / 语义 / 运行时 / 时间）压成一份可送检的档案
 *   ② `planQuestion`：把一句自然语言变成「该看档案的哪几段 + 该带哪些证据」
 *   ③ 回答的**自检**：答案里引用的每个数字，都必须能在档案里找到出处
 *
 * 为什么判据（③）在客户端而不是后端：
 *   问诊最大的失败模式不是答不出来，而是**答得很流畅但数字是编的**。
 *   把「每个数字都要有出处」做成纯函数，就能在不调 LLM 的前提下验它 ——
 *   这与本仓「判定逻辑只有一份实现」「判据不藏在副作用里」是同一条纪律。
 */

/** 档案的四层。缺哪层就说缺哪层，不许用别的层顶替。 */
export interface TwinDossier {
  projectId: string;
  builtAt: string;
  layers: {
    static: { present: boolean; note: string; facts: Record<string, unknown> | null };
    semantic: { present: boolean; note: string; proven: number; unconfirmed: number; notReproduced: number; notRun: number };
    runtime: { present: boolean; note: string; started: number; declared: number; health: string };
    time: { present: boolean; note: string; points: number; latest: { p0: number | null; p1: number | null; coverage: string } | null };
  };
  /** 全部缺席时也要出一份档案 —— 「什么都没扫到」本身就是一条结论 */
  empty: boolean;
  /** 这份档案**不能回答什么**。页面上要原样显示，否则用户会把「没数据」读成「没问题」 */
  blindSpots: string[];
}

/** 档案的字符上限 —— 送检体积有闸门，超了不是截断假装看过，是直接拒 */
export const MAX_DOSSIER_CHARS = 18_000;

/**
 * 装配档案。四层各自独立 —— **某层缺席不许让别的层也变成 0**，
 * 也不许把缺席的那层用相邻层的数字顶替（10-03 教训：0 的情况也要说，它本身是一条结论）。
 */
export function buildTwinDossier(input: {
  projectId: string;
  builtAt?: string;
  facts?: Record<string, any> | null;
  report?: Record<string, any> | null;
  runtime?: Record<string, any> | null;
  vitals?: { count: number; latest: Record<string, any> | null } | null;
}): TwinDossier {
  const blindSpots: string[] = [];

  const facts = input.facts ?? null;
  const report = input.report ?? null;
  const runtime = input.runtime ?? null;
  const vitals = input.vitals ?? null;

  const staticOk = !!facts || !!report;
  if (!staticOk) blindSpots.push('静态层缺席：还没对这个项目跑过一次扫描。');

  const rt = report?.reproTiers ?? null;
  const semanticOk = !!rt;
  if (!semanticOk) {
    blindSpots.push('语义层缺席：没跑过 LLM 深检，或深检报告出在实锤功能之前。');
  }

  const runtimeOk = !!runtime && typeof runtime.counts?.match === 'number';
  if (!runtimeOk) {
    blindSpots.push('运行时层缺席：没跑过活体采集，所以「声明的和实际的对不对得上」没人答过。');
  }

  const timeOk = !!vitals && vitals.count > 0;
  if (!timeOk) {
    blindSpots.push('时间层缺席：生命体征序列是空的，所以「和上次比」这类问题答不了。');
  }

  const latest = timeOk ? vitals!.latest : null;

  return {
    projectId: input.projectId,
    builtAt: input.builtAt ?? new Date().toISOString(),
    layers: {
      static: {
        present: staticOk,
        note: staticOk
          ? `${facts?.code?.entryPoints?.length ?? 0} 个可运行入口 / ${facts?.code?.routes?.length ?? 0} 条路由 / ${facts?.code?.directCalls?.length ?? 0} 条直接调用边`
          : '没数据',
        facts,
      },
      semantic: {
        present: semanticOk,
        note: semanticOk
          ? `实锤 ${rt.proven} / 待确认 ${(report?.reproTiers?.notReproduced ?? 0) + (report?.reproTiers?.invalidTest ?? 0) + (report?.reproTiers?.notRun ?? 0)}`
          : '没数据',
        proven: rt?.proven ?? 0,
        unconfirmed:
          (rt?.notReproduced ?? 0) + (rt?.invalidTest ?? 0) + (rt?.notRun ?? 0),
        notReproduced: rt?.notReproduced ?? 0,
        notRun: rt?.notRun ?? 0,
      },
      runtime: {
        present: runtimeOk,
        note: runtimeOk
          ? `声明 ${runtime!.declared} 个入口，真起来 ${runtime!.started} 个；health：${runtime!.health || '没探到'}`
          : '没数据',
        started: runtime?.started ?? 0,
        declared: runtime?.declared ?? 0,
        health: runtime?.health ?? '没探到',
      },
      time: {
        present: timeOk,
        note: timeOk ? `${vitals!.count} 枚序列点` : '没数据',
        points: vitals?.count ?? 0,
        latest: latest
          ? {
              p0: typeof latest.verdict?.p0 === 'number' ? latest.verdict.p0 : null,
              p1: typeof latest.verdict?.p1 === 'number' ? latest.verdict.p1 : null,
              coverage:
                latest.coverage?.total != null
                  ? `${latest.coverage?.executed ?? '未采到'}/${latest.coverage.total}`
                  : '未采到',
            }
          : null,
      },
    },
    empty: !staticOk && !semanticOk && !runtimeOk && !timeOk,
    blindSpots,
  };
}

/**
 * 把档案压成可送检的文本。<b>超上限就拒</b>，不截断 ——
 * 截断后模型会以为自己看完了，然后对着没看见的部分编答案。
 */
export function dossierToPrompt(d: TwinDossier): { ok: boolean; text: string; reason: string } {
  const parts: string[] = [`项目：${d.projectId}　装配时间：${d.builtAt}`, ''];
  for (const [name, l] of [
    ['静态层', d.layers.static],
    ['语义层', d.layers.semantic],
    ['运行时层', d.layers.runtime],
    ['时间层', d.layers.time],
  ] as [string, { present: boolean; note: string }][]) {
    parts.push(`【${name}】${l.present ? '' : '（这一层没有数据）'}`);
    parts.push(l.present ? l.note : '这一层没扫过 —— 关于它的任何说法都是猜测，不许编。');
    parts.push('');
  }
  const staticFacts = d.layers.static.facts;
  if (staticFacts) {
    const f = staticFacts as Record<string, any>;
    const routes = (f.code?.routes ?? []) as any[];
    const decls = (f.services?.declarations ?? []) as any[];
    const cfg = (f.config ?? []) as any[];
    const slim = {
      entryPoints: (f.code?.entryPoints ?? []).length,
      routes: routes.slice(0, 40),
      services: decls.slice(0, 40),
      configPaths: cfg.map((c: any) => c?.path).slice(0, 30),
    };
    parts.push('【静态明细（截取）】', JSON.stringify(slim, null, 1));
  }
  if (d.blindSpots.length > 0) {
    parts.push('', '【这份档案答不了什么】', ...d.blindSpots.map((b) => `- ${b}`));
  }
  const text = parts.join('\n');
  if (text.length > MAX_DOSSIER_CHARS) {
    return {
      ok: false,
      text: '',
      reason:
        `档案 ${text.length} 字，超过送检上限 ${MAX_DOSSIER_CHARS} —— ` +
        '直接拒，不截断。截断后模型会以为自己看完了，然后对着没看见的部分编答案。',
    };
  }
  return { ok: true, text, reason: '' };
}

/**
 * 提问策略：这句话该看档案的哪几层，以及**哪几层它答不了**。
 *
 * 返回值里 `cannot` 那一栏才是这一层真正的产出 ——
 * 问诊最大的失败模式不是答不出来，而是答得很流畅、数字也像真的，
 * 而那些数字来自一层**根本没数据**的地方。
 */
export function planQuestion(q: string, d?: TwinDossier): { layers: string[]; cannot: string[] } {
  const t = (q ?? '').toLowerCase();
  const layers: string[] = [];
  const cannot: string[] = [];

  const wants = (...kw: string[]) => kw.some((k) => t.includes(k));

  if (wants('依赖', '版本', '漏洞', 'cve', '升级', '技术栈', 'spring', 'jdk')) layers.push('静态层');
  if (wants('服务', '几个服务', '微服务', '部署', 'compose', 'k8s', '副本')) layers.push('静态层');
  if (wants('剥', '拆', '去掉', '移除', '影响面', '多少类')) layers.push('静态层');
  if (wants('bug', '违规', 'p0', '债务', '债', '坏味道', '风险', '实锤')) layers.push('语义层');
  if (wants('跑', '起来', '端口', 'health', '启动', '运行', '对不对得上')) layers.push('运行时层');
  if (wants('比', '上次', '趋势', '变', '最近', '历史', '恶化', '好了')) layers.push('时间层');

  if (layers.length === 0) {
    // 没命中任何一类 —— 不猜。
    layers.push('静态层');
    cannot.push('这句话没命中任何一类已知视角 —— 我按静态层查了，答不到的地方会明说');
  }

  if (d) {
    const available: Record<string, boolean> = {
      静态层: d.layers.static.present,
      语义层: d.layers.semantic.present,
      运行时层: d.layers.runtime.present,
      时间层: d.layers.time.present,
    };
    for (const l of layers) {
      if (available[l] === false) {
        cannot.push(`「${l}」这一层没有数据 —— 关于它的任何说法都是猜测，不许编`);
      }
    }
    if (d.empty) {
      cannot.push('这份档案四层全空 —— 它答不了任何问题，只能告诉你「还没扫过」');
    }
  }

  cannot.push(
    '档案里没有的数字不许出现在答案里 —— 答不了就说答不了',
    '「没数据」的层不许被说成「没问题」',
    '闭包大小是下界（反射 / SPI 扫不到），不许说成「剥掉它只动这些」'
  );
  return { layers, cannot };
}

/**
 * 答案自检：**每个数字都要能在档案里找到出处**。
 *
 * <p>纯函数，不调 LLM —— 所以它能被直接验证，也能在没有 key 的环境里当守门用。
 * 找出的是「原文里出现过这个数字」，不是「数字对不对」——
 * 后者需要判断语义，不是判据层该做的事。
 */
export function auditAnswer(answer: string, dossierText: string): { ok: boolean; orphans: string[] } {
  const hay = dossierText.replace(/\s+/g, '');
  const nums = (answer ?? '').match(/\d+(?:\.\d+)?/g) ?? [];
  const seen = new Set<string>();
  const orphans: string[] = [];
  for (const n of nums) {
    if (seen.has(n)) continue;
    seen.add(n);
    if (!hay.includes(n)) orphans.push(n);
  }
  return { ok: orphans.length === 0, orphans };
}
