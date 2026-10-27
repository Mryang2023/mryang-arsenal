/**
 * 选型 → Archify IR 适配器的守门人 —— 「画出来的图能不能看」这件事，第一次有了断言。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要它：
 *
 * `archify-ir.ts` 把选型翻译成通用绘图器的中间表示。它自己只能检查结构
 * （id 撞车、端点悬空、枚举出界）—— **没有任何办法知道这张图画出来好不好看**。
 * 「好不好看」的定义权不在我们手里，在对方那套九项构图检查里：
 *
 *   single_svg / finite_svg / orthogonal_arrows / label_route_clearance /
 *   relationship_crossings / relationship_corridors / container_border_runs /
 *   route_rhythm / legend_clearance
 *
 * 这九项只有它的渲染器算得出来（要算标签遮罩宽度、折线净空、交叉数）。
 * 所以这一层做的事就是：把 IR 生成出来、交给它的校验器、逐项断言。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么不能只测四套预设：
 *
 * 预设是别人替用户选好的四套。真正的出问题现场是「某个维度没选」留下的空槽位、
 * 以及节点数量不同导致的高度差恰好撞上 —— 那两处只有扫组合才碰得到。
 * 实测就是这么发现的：一套含「数据库 + 缓存 + 消息队列 + 注册中心 + 调度器」
 * 的组合里，缓存那条线的标签离数据库的入线只差 1.5px（门槛 4px）。
 * 四套预设全过，只有扫组合才露出来。
 *
 * ─────────────────────────────────────────────────────────────
 * 依赖：对方的技能（wrench-ai / 扳手AI.Archify）。没装就**明说跳过**，
 * 不装作通过 —— 这一层没跑，`npm run verify` 的绿就不包含九项检查。
 * ─────────────────────────────────────────────────────────────
 *
 * 跑法：npm run verify:archify
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { buildTechArch, emptyEdits } from '@/lib/arch-canvas';
import { archifyIrIssues, buildArchifyIr } from '@/lib/archify-ir';
import { dimensionById, emptyPicks, presetPicks, presets } from '@/lib/stack';
import type { StackPicks } from '@/lib/content-types';
// 统一记账：pass / fail / **skip（独立状态，绝不计入 pass）**，退出码 0 / 2 / 1。
import { check, finish, note, skip, skipItems, skipLayer } from './lib/report';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const tmpDir = path.join(webRoot, '.verify', 'tmp', 'archify-check');

// ═══════════════════════════════════════════════════════════════
// 【0】找到对方的校验器。找不到就明说跳过
// ═══════════════════════════════════════════════════════════════
console.log('\n【0】依赖：通用绘图器校验器（扳手AI.Archify）');

function findCli(): string | null {
  const explicit = process.env.WRENCH_AI_CLI;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const candidates = [
    path.join(os.homedir(), '.workbuddy', 'skills', 'wrench-ai', 'bin', 'wrench-ai.mjs'),
  ];
  // 插件市场装的会落在 plugins/cache 下，版本号在路径里 —— 扫一层目录找
  const cacheRoot = path.join(os.homedir(), '.workbuddy', 'plugins', 'cache');
  const walk = (dir: string, depth: number) => {
    if (depth > 4) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.name === 'wrench-ai.mjs') candidates.push(full);
    }
  };
  walk(cacheRoot, 0);
  return candidates.find((c) => fs.existsSync(c)) ?? null;
}

const cli = findCli();
if (!cli) {
  // 环境缺件 → 本层整层**未执行**。以前这里是 `process.exit(0)`，
  // 于是「九层全绿」里藏着「这一层根本没跑」—— 这正是本次要关掉的那种绿。
  note('  \u26a0 未找到 wrench-ai —— 本层整体跳过（不是通过）');
  note('    期望位置：~/.workbuddy/skills/wrench-ai/bin/wrench-ai.mjs');
  note('    也可用环境变量 WRENCH_AI_CLI 指定入口。');
  note('');
  skipLayer('archify', '本机未安装通用绘图器 wrench-ai（候选路径与环境变量 WRENCH_AI_CLI 均未命中）');
  // finish() 用 fs.writeSync 打状态行与写 layer-archify.json，都是同步的，
  // 所以后面紧跟 process.exit 不会把关键输出截掉（Windows 下管道 stdout 是异步的）。
  process.exit(finish('archify'));
}
console.log(`  入口：${cli}`);

/**
 * 上面已经排除了 `null`。显式取一次而不是靠 `process.exit()` 的 never 返回值做类型收窄 ——
 * 收窄不会传进下面 `wrench()` 的函数体，`.verify/tsconfig.json` 一开就会报 TS2769。
 */
const cliPath: string = cli;

/** 调一次它的 CLI，拿 JSON 结果 */
function wrench(args: string[]): { ok: boolean; data?: unknown; raw: string } {
  const r = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: webRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const raw = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const start = raw.indexOf('{');
  if (start < 0) return { ok: false, raw };
  try {
    return { ok: true, data: JSON.parse(raw.slice(start)), raw };
  } catch {
    return { ok: false, raw };
  }
}

// 九项检查的名字写死在这里 —— 对方改了名字/数量，这一层要立刻知道，
// 而不是默默少验几项还算通过
const NINE_CHECKS = [
  'single_svg',
  'finite_svg',
  'orthogonal_arrows',
  'label_route_clearance',
  'relationship_crossings',
  'relationship_corridors',
  'container_border_runs',
  'route_rhythm',
  'legend_clearance',
];

interface ValidateResult {
  ok: boolean;
  names: string[];
  errors: number;
  warnings: number;
  metrics: Record<string, number | null>;
  raw: string;
}

function validate(irJsonPath: string): ValidateResult | null {
  const r = wrench(['validate', 'architecture', irJsonPath, '--quality', 'showcase', '--json']);
  if (!r.ok || !r.data) return null;
  const d = r.data as {
    ok?: boolean;
    checks?: { name?: string; ok?: boolean }[];
    composition?: { summary?: { errors?: number; warnings?: number }; metrics?: Record<string, number | null> };
  };
  return {
    ok: Boolean(d.ok) && (d.checks ?? []).every((c) => c.ok === true),
    names: (d.checks ?? []).map((c) => String(c.name)),
    errors: d.composition?.summary?.errors ?? -1,
    warnings: d.composition?.summary?.warnings ?? -1,
    metrics: d.composition?.metrics ?? {},
    raw: r.raw,
  };
}

// ═══════════════════════════════════════════════════════════════
// 【1】样例集：四套预设 + 边界组合
// ═══════════════════════════════════════════════════════════════
console.log('\n【1】样例集：IR 生成 + 结构自检');

/** 会产生方块的维度，以及「开 / 关」各自的选项 id */
const NODE_DIMS: [string, string, string][] = [
  ['database', 'mysql', ''],
  ['cache', 'redis', 'none'],
  ['mq', 'kafka', 'none'],
  ['registry', 'nacos', 'none'],
  ['scheduler', 'xxljob', 'spring'],
  ['migration', 'flyway', 'none'],
  ['observability', 'prometheus', 'none'],
];

interface Case {
  name: string;
  picks: StackPicks;
}

const cases: Case[] = [];
for (const p of presets) cases.push({ name: `预设·${p.id}`, picks: presetPicks(p.id) });

// 边界组合：用 cloud 当应用层基准，节点层按 mask 开合。
//
// 默认只跑 7 个挑出来的 mask —— 每一个代表一种版式压力，全套跑一遍约 10 秒，
// 适合挂在 verify 里。想跑穷举就加 `ARCHIFY_SWEEP=1`：七个维度 2^7 = 128 种
// 组合全走一遍，约 70 秒。扫组合的价值在于「某个维度没选」留下的空槽位 ——
// 实测就是这么发现问题的：一套含「库 + 缓存 + 消息队列 + 注册中心 + 调度器」
// 的组合里，缓存那条线的标签离数据库的入线只差 1.5px（门槛 4px），
// 而四套预设全过。
const MASKS: [number, string][] = [
  [0, '无部署节点'],
  [1, '只有数据库'],
  [4, '只有消息队列'],
  [32, '只有调度器'],
  [31, '五条出边（最挤）'],
  [64, '只有观测（唯一回边）'],
  [127, '全部打开'],
];

const sweep = Boolean(process.env.ARCHIFY_SWEEP);
if (sweep) console.log('  （ARCHIFY_SWEEP=1：改为穷举七个节点维度的全部组合）');

const basePicks = presetPicks('cloud');
const masks: [number, string][] = sweep
  ? Array.from({ length: 1 << NODE_DIMS.length }, (_, m): [number, string] => [m, `mask ${m}`])
  : MASKS;
for (const [mask, label] of masks) {
  const picks = { ...basePicks };
  NODE_DIMS.forEach(([dim, onId, offId], i) => {
    const wanted = (mask >> i) & 1 ? onId : offId;
    const dimDef = dimensionById.get(dim);
    if (!dimDef) return;
    if (dimDef.options.some((o) => o.id === wanted)) picks[dim] = wanted;
  });
  cases.push({ name: `边界·${label}(mask ${mask})`, picks });
}
cases.push({ name: '边界·空画布', picks: emptyPicks() });

// 只建目录、按固定下标覆写，**不做递归删除**。
// 宿主机给 Node 注入了一个删除守卫：单轮超过约 50 个文件就抛
// SAFE_DELETE_BULK_CONFIRM_REQUIRED 把进程打死（穷举档 133 个文件必然触发）。
// 这个目录里全是自己刚写下的临时文件，文件名又是按下标定的 —— 覆写就够，
// 上一轮多出来的那几个不会被读到。
fs.mkdirSync(tmpDir, { recursive: true });

const built = cases.map((c, i) => {
  const model = buildTechArch(c.picks, emptyEdits());
  const ir = buildArchifyIr(model, {
    title: c.name,
    qualityProfile: 'showcase',
  });
  const issues = archifyIrIssues(ir);
  const file = path.join(tmpDir, `${String(i).padStart(2, '0')}.json`);
  fs.writeFileSync(file, JSON.stringify(ir, null, 2), 'utf8');
  return { ...c, ir, issues, file };
});

const bad = built.filter((b) => b.issues.length);
check(
  `${built.length} 例 IR 结构自检全过（组件 id / 端点 / 枚举 / 焦点唯一）`,
  bad.length === 0,
  bad.map((b) => `${b.name}: ${b.issues.join(' / ')}`).join('\n')
);

// ── 商标：写错一个 id 会在渲染期直接失败，所以逐个对库 ──
const brands = wrench(['brands', '--json']);
const brandIds = new Set(
  ((brands.data as { marks?: { id?: string }[] } | undefined)?.marks ?? []).map((m) => String(m.id))
);
const usedBrands = new Set(
  built.flatMap((b) =>
    b.ir.components.map((c) => c.brand).filter((x): x is string => Boolean(x))
  )
);
check(
  `用到的 ${usedBrands.size} 个商标 id 都在库里（共 ${brandIds.size} 个可选）`,
  brandIds.size > 0 && [...usedBrands].every((b) => brandIds.has(b)),
  [...usedBrands].filter((b) => !brandIds.has(b)).join(', ')
);
check(
  '商标确实挂上了（不是全空 —— 挂不上就退回按类型上色，但一个都没有说明数据没生效）',
  usedBrands.size >= 4,
  `实际用到：${[...usedBrands].join(', ') || '（空）'}`
);

// ═══════════════════════════════════════════════════════════════
// 【2】九项构图检查 —— 逐例
// ═══════════════════════════════════════════════════════════════
console.log('\n【2】九项构图检查（quality_profile: showcase，最严档）');

let minClearance = Number.POSITIVE_INFINITY;
let minInterior = Number.POSITIVE_INFINITY;
let worstCase = '';
/** 每例的校验结果留一份给第 3 段用 —— 校验器要起进程，别跑两遍 */
const results: { name: string; v: ValidateResult }[] = [];
/** 不合格的例子攒起来一起报。穷举模式下一百多行逐例输出只会淹掉真正要看的东西 */
const caseErrors: string[] = [];

for (const b of built) {
  const v = validate(b.file);
  if (!v) {
    caseErrors.push(`${b.name} · 校验器拿不到 JSON 结果`);
    // 同下一条的判断：拿不到结果也是一次**执行过的判定**，不许从项数里蒸发
    if (!sweep) check(`${b.name} · 九项全过（错误 0 / 警告 0）`, false, '校验器拿不到 JSON 结果');
    continue;
  }
  results.push({ name: b.name, v });
  const nineOk = v.names.length === 9 && v.names.join(',') === NINE_CHECKS.join(',');
  const clean = v.ok && v.errors === 0 && v.warnings === 0;
  const caseName = `${b.name} · 九项全过（错误 0 / 警告 0）`;
  if (!clean || !nineOk) {
    const detail = v.raw.split('\n').filter((l) => l.includes('composition/') || l.includes('- [')).slice(0, 8).join('\n');
    const why =
      `${b.name}: 九项${nineOk ? '名字对' : `名字不符（${v.names.join(', ')}）`} / 错误 ${v.errors} / 警告 ${v.warnings}\n${detail || v.raw.slice(0, 900)}`;
    caseErrors.push(why);
    // 红的那例也要产出逐例断言 —— 只在绿时产出的写法会让「一例红」变成「少一条断言」：
    // 本层项数随之缩水（2026-10-27 实测全绿 31 / 残数 20），账目反过来骗过元核对，
    // 而失败信息只剩汇总那一行、点不出是哪例。穷举模式仍然只报例外（133 行逐例会淹掉它）。
    if (!sweep) check(caseName, false, why);
  } else if (!sweep) {
    // 穷举模式下 133 行逐例输出只会淹掉真正要看的东西 —— 那时只报例外与汇总
    check(caseName, true);
  }
  const c = v.metrics.minLabelRouteClearance;
  if (typeof c === 'number' && c < minClearance) {
    minClearance = c;
    worstCase = b.name;
  }
  const seg = v.metrics.minInteriorSegmentPx;
  if (typeof seg === 'number' && seg < minInterior) minInterior = seg;
}

check(
  sweep
    ? `穷举 ${built.length} 例 · 九项全过（错误 0 / 警告 0）`
    : `样例 ${built.length} 例全部通过（错误 0 / 警告 0，逐例见上）`,
  caseErrors.length === 0,
  caseErrors.join('\n')
);

// ═══════════════════════════════════════════════════════════════
// 【3】把「为什么过」也钉住 —— 光看 ok 不够，要看住那条底线
// ═══════════════════════════════════════════════════════════════
//
// 对方的 ok 是「没触发错误」。可如果哪天它把某条硬错误降级成指标，
// ok 依旧是 true，而图已经变难看了。所以几条关键指标单独断言一遍。
console.log('\n【3】关键指标（防对方把硬错误降级成指标后我们不吭声）');

const metricAgg: Record<string, number> = {};
for (const { v } of results) {
  for (const key of [
    'labelRouteClearanceIssues',
    'shortInteriorSegmentCount',
    'microSegmentCount',
    'containerBorderRuns',
    'ambiguousCorridors',
    'desktopReadabilityIssues',
  ]) {
    const n = v.metrics[key];
    if (typeof n === 'number') metricAgg[key] = (metricAgg[key] ?? 0) + n;
  }
}

check(
  '标签压线 0 处 · 短内部段 0 处 · 微段 0 处 · 压边框 0 处 · 共走廊 0 处 · 桌面可读性问题 0 处',
  Object.values(metricAgg).every((n) => n === 0),
  Object.entries(metricAgg).map(([k, n]) => `${k}=${n}`).join('  ')
);
check(
  `最小标签净空 ${minClearance === Number.POSITIVE_INFINITY ? 'n/a' : minClearance}px ≥ 4px（门槛），最紧的是 ${worstCase || 'n/a'}`,
  minClearance === Number.POSITIVE_INFINITY || minClearance >= 4,
  `minLabelRouteClearance = ${minClearance}`
);
check(
  `最小内部段 ${minInterior === Number.POSITIVE_INFINITY ? 'n/a' : minInterior}px ≥ 16px（门槛）`,
  minInterior === Number.POSITIVE_INFINITY || minInterior >= 16,
  `minInteriorSegmentPx = ${minInterior}`
);

// ═══════════════════════════════════════════════════════════════
// 【4】后端出图服务 —— 「页面里点一下就出图」那条路真的通吗
// ═══════════════════════════════════════════════════════════════
//
// 上面三节走的是对方的命令行。但页面上那颗「直接生成 HTML」按钮走的**不是命令行** ——
// 它 POST 给 arsenal-server，由那边起子进程。中间这一层上面一节都没覆盖：
// 找不到 node、临时文件写错、子进程的输出没被正确翻译回来，
// 上面全绿它照样能坏。所以这里实跑一遍后端服务。
//
// 为什么用 Java 探针而不是起 HTTP 服务：值得验的是服务层，接口层是薄薄一层转发。
// 起 Tomcat 要多花十几秒、还要占端口，换不来更多结论 ——
// 接口本身由浏览器实测覆盖（那需要前后端同时活着，不适合放进自检链）。
console.log('\n【4】后端出图服务（arsenal-server/.verify/ArchifyProbe.java）');

/** 与 ArchifyProbe.java 写出的 archify-probe.json 对应。字段名两侧必须一致。 */
interface BackendProbe {
  available: boolean;
  code: string | null;
  reason: string | null;
  nodeBinary: string | null;
  nodeVersion: string | null;
  cliPath: string;
  quality: string;
  environment: {
    missingCliAvailable?: boolean;
    missingCliCode?: string | null;
    missingCliSaysHowToFix?: boolean;
    missingCliDeliverThrows?: boolean;
    bogusNodeFallsBack?: boolean | string;
    bogusNodeResolvedTo?: string;
    badQualityRejected?: boolean;
  };
  cases: {
    name: string;
    delivered: boolean;
    error: string | null;
    checksPassed?: number;
    checkCount?: number;
    errors?: number;
    warnings?: number;
    artifactBytes?: number;
    htmlBytes: number;
    artifactShaMatches: boolean;
    htmlLooksLikeDocument: boolean;
    elapsedMs: number;
    diagnostics: number;
  }[];
  guards: {
    skipped?: boolean;
    nonObjectRejected?: boolean;
    objectBrandRejected?: boolean;
    badGeometryDelivered?: boolean;
    badGeometryDiagnostics?: number;
    badGeometryHasError?: boolean;
    badGeometryHtmlEmpty?: boolean;
    tempDirsLeft?: number;
  };
}

const serverRoot = path.resolve(webRoot, '..', 'arsenal-server');
const backendProbeScript = path.join(serverRoot, 'scripts', 'archify-probe.sh');

if (!fs.existsSync(backendProbeScript)) {
  check('后端探针脚本存在', false, backendProbeScript);
} else {
  // 只喂三份：服务层的问题与「样本多少」无关，多喂只是多花时间（一份约 1 秒）。
  // 取头、中、尾，顺带覆盖组件数最少与最多两种版式。
  const sample = [built[0], built[Math.floor(built.length / 2)], built[built.length - 1]];
  const backendOut = path.join(webRoot, '.verify', 'tmp', 'archify-backend');
  const r = spawnSync('bash', [backendProbeScript, backendOut, ...sample.map((b) => b.file)], {
    cwd: serverRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const raw = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const receiptPath = path.join(backendOut, 'archify-probe.json');

  if (r.status !== 0 || !fs.existsSync(receiptPath)) {
    check(
      '后端探针跑完（编译 + 实跑，需要 bash + JDK 17）',
      false,
      `退出码 ${r.status}\n${raw.split('\n').filter((l) => l.trim()).slice(-8).join('\n')}`
    );
  } else {
    check('后端探针跑完（编译 + 实跑，需要 bash + JDK 17）', true);
    const p = JSON.parse(fs.readFileSync(receiptPath, 'utf8')) as BackendProbe;

    if (!p.available) {
      // 服务不可达 = 下面那 9 条服务侧断言**一条都没执行**。
      // 以前这里是 `check(..., true)` —— 把「跳过」计进了 pass，于是「全绿」里含 9 条假绿。
      skipItems(
        '后端出图服务侧断言',
        `后端出图服务不可达（${p.code}）${p.reason ? `：${p.reason}` : ''}`,
        9
      );
    } else {
      check(
        `服务自己找得到 node 与技能入口（${p.nodeBinary} ${p.nodeVersion}）`,
        Boolean(p.nodeBinary && p.nodeVersion),
        `nodeBinary=${p.nodeBinary} nodeVersion=${p.nodeVersion}`
      );

      const caseProblems: string[] = [];
      for (const c of p.cases) {
        if (!c.delivered) caseProblems.push(`${c.name}: 没出图 —— ${c.error ?? ''}`);
        else if (c.checksPassed !== 9 || c.checkCount !== 9)
          caseProblems.push(`${c.name}: 只过了 ${c.checksPassed}/${c.checkCount} 项`);
        else if (c.errors !== 0 || c.warnings !== 0)
          caseProblems.push(`${c.name}: ${c.errors} 错 ${c.warnings} 警`);
        else if (!c.artifactShaMatches)
          caseProblems.push(
            `${c.name}: 产物 sha256 对不上 —— 说明读回来的字节和它写下的不是一回事（编码/换行被改过）`
          );
        else if (!c.htmlLooksLikeDocument) caseProblems.push(`${c.name}: 产物不像一份 HTML 文档`);
        else if (c.htmlBytes < 100_000)
          caseProblems.push(`${c.name}: 产物只有 ${c.htmlBytes} 字节，明显不对`);
      }
      check(
        `${p.cases.length} 例经后端实跑出图：九项全过 · 0 错 0 警 · 字节无损`,
        caseProblems.length === 0,
        caseProblems.join('\n')
      );
      for (const c of p.cases) {
        console.log(
          `      ${c.name} → ${c.htmlBytes} 字节 · ${c.elapsedMs} ms · 检查 ${c.checksPassed ?? '?'}/${
            c.checkCount ?? '?'
          }`
        );
      }

      const e = p.environment;
      check(
        '没装技能时如实报不可用，并说清怎么补（不乐观地报可用）',
        e.missingCliAvailable === false &&
          e.missingCliCode === 'ARCHIFY_NOT_INSTALLED' &&
          e.missingCliSaysHowToFix === true &&
          e.missingCliDeliverThrows === true,
        JSON.stringify(e)
      );
      check(
        'node 配置写错能回落到 PATH / 常见位置',
        e.bogusNodeFallsBack === true || e.bogusNodeFallsBack === 'skipped',
        `bogusNodeFallsBack=${e.bogusNodeFallsBack}（false 意味着功能会「有时能用有时不能用」）`
      );
      check(
        'quality 配置写错时当场拒（不把非法值原样传给对方）',
        e.badQualityRejected === true,
        JSON.stringify(e)
      );

      const g = p.guards;
      check('非对象请求体被拒', g.nonObjectRejected === true);
      check(
        '带 URL 的商标对象被拒收 —— 那是唯一能让服务器替陌生人发请求的形态',
        g.objectBrandRejected === true
      );
      check(
        `坏几何如实回诊断而不是抛异常（${g.badGeometryDiagnostics ?? 0} 条）`,
        g.badGeometryDelivered === false &&
          (g.badGeometryDiagnostics ?? 0) > 0 &&
          g.badGeometryHasError === true &&
          g.badGeometryHtmlEmpty === true
      );
      check(
        `每次出图后临时目录清干净（残留 ${g.tempDirsLeft ?? '?'} 个）`,
        g.tempDirsLeft === 0,
        '残留是要跑几天才被发现的漏水'
      );
    }
  }
}

console.log(`\n${'─'.repeat(56)}`);
finish('archify', `（样例 ${built.length} 例）`);
