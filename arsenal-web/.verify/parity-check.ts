/**
 * 两端导出一致性校验 —— 「同一种载体，两端必须给出同样的东西」的守门人。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要它：
 *
 * 「一份数据，三种出口」是本项目的第一原则，而在这之前**没有任何东西**
 * 能发现两端对同一个载体给出了不同答案。真实发生过：
 *
 *   · json  ：前端吐完整 Rule 数组，后端吐 {count, ids}
 *   · json  ：后端按分类字母序排、前端按分类声明顺序排
 *   · json  ：后端多吐一堆 "supersedes": null / "flags": null
 *   · markdown：前端有目录、后端没有；分类标题一个中文一个原始 key；
 *               空行 122 处不一样、来源标签一个中文一个 key
 *
 * 这些都不是「功能缺失」，是同一份数据被编译了两次、编译规则有两份。
 * 人眼永远看不出来（不影响阅读），所以必须由脚本断言。
 *
 * 比对方式按载体的性质定，不是一刀切：
 *   · markdown —— 逐字节。空白就是内容，差一个空行就是两份不同的文件。
 *   · json     —— 逐结构。对象键无序、数组有序、未设置的字段不出现；
 *                 JSON 的空白不是内容，比字节会得到一堆无意义的红。
 *                 exportedAt 是唯一被容忍的易变字段，单独断言格式。
 * ─────────────────────────────────────────────────────────────
 *
 * 跑法：npm run verify:parity
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { DEFAULT_EXPORT_OPTIONS, EXPORT_FORMATS, buildExport } from '@/lib/exporters';
import { meta, rules } from '@/lib/rules';
import { CATEGORY_ORDER, CATEGORY_THEME } from '@/lib/theme';
import type { ExportFormat } from '@/lib/exporters';
// 统一记账：pass / fail / **skip（独立状态，绝不计入 pass）**，退出码 0 / 2 / 1。
import { check, finish, skip } from './lib/report';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '..');
const rulesDir = path.join(repoRoot, 'arsenal-rules');
const probeScript = path.join(repoRoot, 'arsenal-server', 'scripts', 'parity-probe.sh');
const beDir = path.join(repoRoot, 'arsenal-server', 'target', 'parity-be');
const feDir = path.join(repoRoot, 'arsenal-server', 'target', 'parity-fe');

/**
 * 环境缺件（bash / JDK17）时为真 —— 此时【4】【5】依赖后端产物的断言**未执行**，
 * 记 skip 而不是 fail。真正的断言失败（两端产物不一致）仍然是 fail。
 * 先置 null，【2】拿到探针结果后填。
 */
let envUnavailable: string | null = null;

// ═══════════════════════════════════════════════════════════════
// 【1】先断言「代码里的副本」与「数据」一致 —— 不依赖 JDK，先跑
// ═══════════════════════════════════════════════════════════════
console.log('\n【1】代码副本 vs 数据（ts 常量表是否还跟得上 meta.json）');
console.log(`  规则集：${meta.name} v${meta.version}　来源类型 ${Object.keys(meta.sourceTypes ?? {}).length} 个`);

const dataOrder = meta.categories.map((c) => c.key);
check(
  'CATEGORY_ORDER 与 meta.categories 的声明顺序一致',
  JSON.stringify(CATEGORY_ORDER) === JSON.stringify(dataOrder),
  `theme.ts : ${CATEGORY_ORDER.join(', ')}\nmeta.json: ${dataOrder.join(', ')}`
);

const copyDrift: string[] = [];
for (const c of meta.categories) {
  const t = CATEGORY_THEME[c.key as keyof typeof CATEGORY_THEME];
  if (!t) {
    copyDrift.push(`${c.key}：theme.ts 里没有这个分类`);
    continue;
  }
  for (const field of ['name', 'english', 'blurb'] as const) {
    if ((t[field] ?? '') !== ((c[field] ?? '') as string)) {
      copyDrift.push(`${c.key}.${field}：theme.ts=「${t[field]}」 meta.json=「${c[field]}」`);
    }
  }
}
check(
  'CATEGORY_THEME 的文案与 meta.categories 逐字段一致',
  copyDrift.length === 0,
  `${copyDrift.join('\n')}\n      （主题表只该管颜色和字形，文案属于数据）`
);

const usedTypes = [...new Set(rules.flatMap((r) => r.sources.map((s) => s.type).filter(Boolean)))] as string[];
const missingTypes = usedTypes.filter((t) => !(t in (meta.sourceTypes ?? {})));
check(
  `规则里用到的 ${usedTypes.length} 种来源类型都在 meta.sourceTypes 里有标签`,
  missingTypes.length === 0,
  `缺标签：${missingTypes.join('、')}　（缺了会原样露出英文 key，且后端也一样）`
);

check(
  'DEFAULT_EXPORT_OPTIONS 的分类就是数据的全部分类',
  JSON.stringify([...DEFAULT_EXPORT_OPTIONS.categories].sort()) ===
    JSON.stringify([...dataOrder].sort()),
  `选项里 ${DEFAULT_EXPORT_OPTIONS.categories.length} 个 / 数据里 ${dataOrder.length} 个`
);

// ═══════════════════════════════════════════════════════════════
// 【2】跑后端探针（需要 JDK）
// ═══════════════════════════════════════════════════════════════
console.log('\n【2】后端探针');

/** Git Bash 的 cd 认 POSIX 路径，JVM 认 Windows 路径 —— 交给 _cp.sh 的 to_win 转回去。 */
function toPosix(p: string): string {
  return p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`);
}

if (!fs.existsSync(probeScript)) {
  check('后端探针脚本存在', false, `找不到 ${probeScript}`);
}

const sevCsv = DEFAULT_EXPORT_OPTIONS.severities.join(',');
const catCsv = DEFAULT_EXPORT_OPTIONS.categories.join(',');

fs.rmSync(beDir, { recursive: true, force: true });
fs.rmSync(feDir, { recursive: true, force: true });

const probe = spawnSync(
  'bash',
  [toPosix(probeScript), toPosix(rulesDir), toPosix(beDir), sevCsv, catCsv],
  { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
);

if (probe.error) {
  // spawn 本身就失败 = 连 bash 都没找到。这是环境缺件，**不是**「两端不一致」，所以记 skip。
  envUnavailable = `后端探针无法启动：${(probe.error as Error).message}`;
  skip('后端探针能启动（需要 bash + JDK 17）', envUnavailable);
} else if (probe.status !== 0) {
  const out = `${probe.stdout || ''}\n${probe.stderr || ''}`;
  // 「环境缺件」与「探针真的编不过」必须分开报：
  //   前者 = 未执行（skip → 退出码 2），后者 = 真红（fail → 退出码 1）。
  // 判据是探针输出里有没有环境缺件的特征串 —— 不精确，但两条路的输出都会原样打出来，
  // 判错也能被人一眼看出（这是刻意的取舍：宁可让人复核，不要静默）。
  const envLike = /command not found|No such file|no such file|JAVA_HOME|javac|not recognized|Permission denied/i.test(out);
  if (envLike) {
    envUnavailable = `后端探针退出码 ${probe.status}，输出像环境缺件（bash / JDK 17）：`
      + out.trim().split('\n').slice(-4).join(' / ');
    skip('后端探针成功导出', envUnavailable);
  } else {
    check('后端探针成功导出', false, `退出码 ${probe.status}\n${out.trim()}`);
  }
} else {
  check('后端探针成功导出', true);
  for (const line of (probe.stdout || '').split('\n').filter((l) => l.trim())) {
    console.log(`      ${line.trim()}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// 【3】跑前端导出（同一批过滤条件）
// ═══════════════════════════════════════════════════════════════
console.log('\n【3】前端导出');
fs.mkdirSync(feDir, { recursive: true });

const PAIRED: ExportFormat[] = ['json', 'markdown', 'mcp'];
for (const format of PAIRED) {
  const content = buildExport(format, rules, DEFAULT_EXPORT_OPTIONS);
  fs.writeFileSync(path.join(feDir, `${format}.txt`), content, 'utf8');
  console.log(`      ${format} → ${content.length} 字符`);
}
const unpaired = EXPORT_FORMATS.map((f) => f.key).filter((k) => !PAIRED.includes(k));
console.log(`      未参与比对（刻意）：${unpaired.join(', ')}`);
console.log('        · prompt / cursorrules / claude：自由度高的自然语言，逐字对齐没有意义');
console.log('        · mcp：已纳入逐字节比对（工具定义统一为 arsenal-rules/mcp-tools.json 后，两端可一致）');

// ═══════════════════════════════════════════════════════════════
// 【4】比对
// ═══════════════════════════════════════════════════════════════
console.log('\n【4】比对产物');

/** 键序无关、数组有序的规范形式。语义相同 ↔ 规范形式相同。 */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'undefined';
}

/** 收集两棵树的前 N 处差异路径，用于报错定位（只报路径，不打印规则正文）。 */
function diffPaths(a: unknown, b: unknown, at = '', out: string[] = []): string[] {
  if (out.length >= 12) return out;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${at || '<root>'}.length: ${a.length} vs ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) diffPaths(a[i], b[i], `${at}[${i}]`, out);
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    const onlyA = ka.filter((k) => !kb.includes(k));
    const onlyB = kb.filter((k) => !ka.includes(k));
    if (onlyA.length) out.push(`${at}.{仅后端有}: ${onlyA.join(', ')}`);
    if (onlyB.length) out.push(`${at}.{仅前端有}: ${onlyB.join(', ')}`);
    for (const k of ka.filter((k) => kb.includes(k))) {
      diffPaths((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${at}.${k}`, out);
    }
    return out;
  }
  if (canonical(a) !== canonical(b)) out.push(`${at}: 值不同`);
  return out;
}

function readBoth(format: string): { be: string; fe: string } | null {
  const be = path.join(beDir, `${format}.txt`);
  const fe = path.join(feDir, `${format}.txt`);
  if (!fs.existsSync(be)) {
    if (envUnavailable) {
      // 探针根本没跑成 → 这一条是「未执行」，不是「两端不一致」。两者在报告里必须可区分。
      skip(`${format}：两端产物比对（需要后端探针）`, envUnavailable);
      return null;
    }
    check(`${format}：后端产物存在`, false, `缺 ${be} —— 探针没跑成，先看上一条红`);
    return null;
  }
  return { be: fs.readFileSync(be, 'utf8'), fe: fs.readFileSync(fe, 'utf8') };
}

// ── markdown：逐字节 ──
{
  const pair = readBoth('markdown');
  if (pair) {
    const be = pair.be.replace(/\r\n/g, '\n');
    const fe = pair.fe.replace(/\r\n/g, '\n');
    const bl = be.split('\n');
    const fl = fe.split('\n');
    const diffs: string[] = [];
    for (let i = 0; i < Math.max(bl.length, fl.length) && diffs.length < 6; i += 1) {
      if (bl[i] !== fl[i]) {
        const kind = (s: string | undefined) =>
          s === undefined ? '(无此行)'
            : s === '' ? '(空行)'
              : s.startsWith('### ') ? 'H3'
                : s.startsWith('## ') ? 'H2'
                  : s.startsWith('# ') ? 'H1'
                    : s.startsWith('```') ? '围栏'
                      : s.startsWith('- ') ? '列表'
                        : s === '---' ? '分隔线'
                          : `正文(${s.length} 字符)`;
        diffs.push(`L${i + 1}: 后端 ${kind(bl[i])} / 前端 ${kind(fl[i])}`);
      }
    }
    check(
      `markdown 逐字节一致（${bl.length} 行 / ${Buffer.byteLength(be, 'utf8')} 字节）`,
      be === fe,
      diffs.join('\n')
    );
  }
}

// ── json：逐结构 ──
{
  const pair = readBoth('json');
  if (pair) {
    const beObj = JSON.parse(pair.be) as Record<string, unknown>;
    const feObj = JSON.parse(pair.fe) as Record<string, unknown>;

    check(
      'json：exportedAt 两端都是 ISO-8601（毫秒 + Z）',
      typeof beObj.exportedAt === 'string' &&
        typeof feObj.exportedAt === 'string' &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(beObj.exportedAt) &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(feObj.exportedAt),
      `后端 ${beObj.exportedAt} / 前端 ${feObj.exportedAt}`
    );

    delete beObj.exportedAt;
    delete feObj.exportedAt;

    const same = canonical(beObj) === canonical(feObj);
    const paths = same ? [] : diffPaths(beObj, feObj);
    check(
      `json 结构一致（${(beObj.rules as unknown[]).length} 条规则，忽略键序与空白，${(beObj.rules as unknown[]).length === 62 ? '' : ''}唯一的易变字段 exportedAt 已单独断言）`,
      same,
      paths.join('\n')
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// ── mcp：逐字节 ──
{
  const pair = readBoth('mcp');
  if (pair) {
    const be = pair.be.replace(/\r\n/g, '\n');
    const fe = pair.fe.replace(/\r\n/g, '\n');
    const bl = be.split('\n');
    const fl = fe.split('\n');
    const diffs: string[] = [];
    for (let i = 0; i < Math.max(bl.length, fl.length) && diffs.length < 6; i += 1) {
      if (bl[i] !== fl[i]) {
        diffs.push(`L${i + 1}: 后端(${bl[i] === undefined ? '无' : bl[i].length} 字符) / 前端(${fl[i] === undefined ? '无' : fl[i].length} 字符)`);
      }
    }
    check(
      `mcp 逐字节一致（${bl.length} 行 / ${Buffer.byteLength(be, 'utf8')} 字节）`,
      be === fe,
      diffs.join('\n')
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// 【5】活服务体检（可选）—— 上面全是「同一份数据被两套代码编译」，
//       这一节管的是那个正在跑、可能已经过期的进程
// ═══════════════════════════════════════════════════════════════
//
// 为什么必须有这一节：【2】编的是独立 ParityProbe，它**直读规则目录**，
// 完全不碰 HTTP 层。于是「改了规则忘了重启后端」会让 3011 上的进程
// 长期拿着一份启动时的内存索引，而 /api/stats 会一脸正常地报旧条数。
// 实测过一次 62 条 vs 事实源 69 条 —— 六层校验全绿，没有任何东西发现。
//
// 没起服务时明说跳过并讲清怎么补，**不计入通过** —— 不乐观地报一切正常。
console.log('\n【5】活服务体检（可选）');

const API_BASE = process.env.ARSENAL_API ?? 'http://127.0.0.1:3011';

const tally = <T extends string>(get: (r: (typeof rules)[number]) => T) => {
  const out: Record<string, number> = {};
  for (const r of rules) out[get(r)] = (out[get(r)] ?? 0) + 1;
  return out;
};

async function probeLive(): Promise<void> {
  type Stats = {
    total?: number;
    bySeverity?: Record<string, number>;
    byCategory?: Record<string, number>;
  };
  let stats: Stats | null = null;
  try {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 3000);
    const res = await fetch(`${API_BASE}/api/stats`, { signal: ac.signal });
    clearTimeout(timer);
    if (res.ok) {
      const body = (await res.json()) as { data?: unknown };
      stats = (body.data ?? null) as Stats | null;
    }
  } catch {
    stats = null;
  }

  if (!stats || typeof stats.total !== 'number') {
    // 以前这里只 console.log 一句就 return —— 「没起服务」在总账里等于 0 项，
    // 三节体检被**静默略过**，「全绿」的含义被高估。现在如实记 3 项未执行。
    const why = `${API_BASE} 上没有活服务（起服务后复跑：bash arsenal-server/scripts/run.sh && npm run verify:parity）`;
    console.log(`  · ${API_BASE} 上没检测到服务`);
    skip('活服务：规则数 == 事实源', why);
    skip('活服务：按严重度的分布 == 事实源', why);
    skip('活服务：按分类的分布 == 事实源', why);
    return;
  }

  check(
    `活服务规则数 == 事实源（服务 ${stats.total} / 本地 ${rules.length}）`,
    stats.total === rules.length,
    '服务用的是启动那一刻的内存索引。改完 arsenal-rules/ 没重启，它会一直报旧条数 —— 重启再复跑'
  );

  const localSev = tally((r) => r.severity);
  const localCat = tally((r) => r.category);
  const mapEqual = (a?: Record<string, number>, b?: Record<string, number>) =>
    JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());

  check('活服务按严重度的分布 == 事实源', mapEqual(stats.bySeverity, localSev),
    `服务 ${JSON.stringify(stats.bySeverity)} / 本地 ${JSON.stringify(localSev)}`);
  check('活服务按分类的分布 == 事实源', mapEqual(stats.byCategory, localCat),
    `服务 ${JSON.stringify(stats.byCategory)} / 本地 ${JSON.stringify(localCat)}`);
}

probeLive().then(() => {
  finish('parity');
});
