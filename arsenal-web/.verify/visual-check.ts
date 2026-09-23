/**
 * 视觉层守门人 —— 「页面长得对不对」第一次有了机器判据（plan-5 §V-3 的挂链）。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要它：
 *
 * 本仓库此前有八层断言，**全部是「读数据 / 读代码 / 读进程」，没有一层看过页面**。
 * 于是出现了一整类没人管的坏法：横向溢出、图片挂掉、两个 sticky 元素叠在一起、
 * 正文对比度不足、一个页面出现两个 `<h1>`、页面底部拖出一屏空白 ——
 * 这些全都「测试全绿、数据全对」，只有人打开浏览器才看得见。
 * 2026-09-22 夜跑第 3 棒实测出的 P0（390px 视口下 15 个页面**一致溢出 +53px**）
 * 就是这么活过八层自检的。
 *
 * 本层不改写任何断言逻辑，只做**记账与守门**：真判据在
 * `arsenal-web/visual/assert.mjs`（A1–A7 × 45 张截图矩阵，现测几何，不读旧报告）。
 * 分工写在那边：**断言管几何与数值，看图管语义** —— 「这个图标认不认识」
 * 「这句结论说不说得通」不写成断言，那是给自己造一个必然误报的检查。
 *
 * ─────────────────────────────────────────────────────────────
 * 项数为什么是 9 而不是 315（45 张 × 7 项）：
 *
 * 45×7 会得到一个**误导性的数**：一次真实回归（比如整站溢出）会让 45 个「项」同时红，
 * 于是「失败 45 项」看起来像 45 个独立问题，其实是一个版式错误。而且 A4（sticky 遮挡）
 * 在移动端天然没有可判定目标（本站移动端没有 sticky 元素），按张计数的话那 15 张
 * 只能进 `skip` —— 而「未适用」根本不是「环境不满足」，塞进 skip 会把退出码
 * 永久钉在 2 上，把「跳过」这个词的含义稀释掉。
 * 所以项的粒度 = **断言**（7）+ 2 项结构核对（矩阵、素材），样本量（45 张）
 * 写在断言名里，看得见但不冒充项数。
 *
 * ─────────────────────────────────────────────────────────────
 * 前置：`out/` 必须已构建（`node scripts/next-run.mjs build`）。
 * 没有就 `skipLayer()` —— 明说本层没跑，**不**静默当绿。
 * 跑法：npm run verify:visual
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
// 统一记账：pass / fail / **skip（独立状态，绝不计入 pass）**，退出码 0 / 2 / 1。
import { check, finish, note, skip, skipLayer } from './lib/report';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const outDir = path.join(webRoot, 'out');
const visualDir = path.join(webRoot, 'visual');
const assertScript = path.join(visualDir, 'assert.mjs');
const manifestPath = path.join(visualDir, 'manifest.json');
const logPath = path.join(webRoot, '.verify', 'tmp', 'visual-assert.log');

const ASSERTION_NAMES = [
  'A1 无横向溢出',
  'A2 main 一级子元素不越界',
  'A3 图片全部加载成功',
  'A4 固定/粘性元素互不遮挡',
  'A5 正文对比度达标',
  'A6 <h1> 唯一',
  'A7 页面底部无假高度',
];

// ═══════════════════════════════════════════════════════════════
// 【0】前置：脚本与构建产物
// ═══════════════════════════════════════════════════════════════
console.log('\n【0】前置：视觉断言脚本 + 构建产物');

if (!fs.existsSync(assertScript)) {
  note('  \u26a0 找不到 arsenal-web/visual/assert.mjs —— 本层整体跳过（不是通过）');
  skipLayer('visual', `找不到断言脚本 ${assertScript}`);
  process.exit(finish('visual'));
}

if (!fs.existsSync(outDir)) {
  note('  \u26a0 out/ 不存在 —— 本层整体跳过（不是通过）');
  note('    先跑：node scripts/next-run.mjs build');
  skipLayer('visual', 'out/ 未构建：断言必须测真实页面，测不了就明说，不拿旧报告冒充');
  process.exit(finish('visual'));
}

// ⚠️ 这两条 `check` **必须放在两个守卫之后**。
// 放在前面的话，out/ 缺失时它们会先记下 pass —— 于是整层跳过的那一轮会打出
// 「实测 1 项 / 跳过 12 项」（合计 13，与声明值 12 不符）。本层反向验证时实测到了这个数：
// 「跳过 12 项」是声明值填的，再加一个真的 pass，两个数根本不是同一个量纲。
// 现在整个前置段只有两条出口：都齐 → 记 2 个 pass；缺任一个 → 一个 pass 都不记，整层跳过。
check('视觉断言脚本存在（visual/assert.mjs）', true);
check('构建产物存在（out/，断言测的是真实页面而不是旧报告）', true);

// ═══════════════════════════════════════════════════════════════
// 【1】实跑 assert.mjs（全量矩阵：15 URL × 3 视口）
// ═══════════════════════════════════════════════════════════════
console.log('\n【1】实跑 45 张矩阵（node visual/assert.mjs）');

const started = Date.now();
const run = spawnSync(process.execPath, [assertScript], {
  cwd: webRoot,
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  timeout: 15 * 60 * 1000,
  // 起 msedge 会写一堆临时文件；沙箱删除守卫与本层无关，显式关掉免得误伤
  env: { ...process.env, CODEBUDDY_SAFE_DELETE_ENABLED: '0' },
});
const raw = `${run.stdout ?? ''}${run.stderr ?? ''}`;
const secs = ((Date.now() - started) / 1000).toFixed(1);

try {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, raw, 'utf8');
} catch {
  // 日志写不出去不影响判定，`--check-findings` 与逐项汇总都在 stdout 里
}

if (run.error) {
  check(
    'assert.mjs 跑完（需要 out/ + 本机浏览器）',
    false,
    `起不了子进程：${run.error.message}`
  );
  console.log(`\n${'\u2500'.repeat(56)}`);
  process.exit(finish('visual'));
}

// ── 打印：人只需要看结论与失败明细，45 行逐张会淹掉它们 ──
{
  const lines = raw.split(/\r?\n/);
  const from = lines.findIndex((l) => l.includes('逐项汇总'));
  const head = lines.filter((l) => l.includes('\u2717') || l.includes('加载失败') || l.includes('\u26a0'));
  if (from >= 0) {
    for (const l of lines.slice(from)) console.log(`  ${l}`);
  } else {
    for (const l of lines.slice(-40)) console.log(`  ${l}`);
  }
  const extra = head.filter((l) => !lines.slice(from >= 0 ? from : 0).includes(l));
  for (const l of extra.slice(0, 10)) console.log(`  ${l}`);
}
console.log(`  实测耗时 ${secs}s（完整输出：.verify/tmp/visual-assert.log）`);

// ═══════════════════════════════════════════════════════════════
// 【2】逐项断言：从 assert.mjs 的输出里读回实测值
// ═══════════════════════════════════════════════════════════════
console.log('\n【2】逐项断言（每项一条：45 张里任一红即本项红）');

interface Row {
  id: string;
  pass: number;
  fails: number;
  nas: number;
  unjudged: number;
}

const rows = new Map<string, Row>();
const ROW_RE =
  /^\s{2}\S\s+(A\d)\s+.*?通过\s+(\d+)\s*\/\s*失败\s+(\d+)\s*\/\s*未适用\s+(\d+)\s*\/\s+无从判定\s+(\d+)/;
for (const line of raw.split(/\r?\n/)) {
  const m = ROW_RE.exec(line);
  if (!m) continue;
  rows.set(m[1], {
    id: m[1],
    pass: Number(m[2]),
    fails: Number(m[3]),
    nas: Number(m[4]),
    unjudged: Number(m[5]),
  });
}

/** assert.mjs 的失败明细：把「哪张图 + 实际值」作为 detail 带进来，别只说「红了」。 */
function detailFor(id: string): string {
  const lines = raw.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.includes('失败明细'));
  const out: string[] = [];
  if (idx >= 0) {
    let inBlock = false;
    for (const l of lines.slice(idx)) {
      if (/^\s{4}\S/.test(l) && l.includes('：')) inBlock = l.includes(ASSERTION_NAMES[Number(id.slice(1)) - 1]);
      else if (inBlock && /^\s{6}/.test(l)) out.push(l.trim());
      else if (inBlock && /^\s{4}\S/.test(l)) inBlock = false;
    }
  }
  return out.slice(0, 6).join('\n');
}

if (rows.size === 0) {
  check(
    'assert.mjs 输出了逐项汇总（输出格式变了的话，本层必须立刻知道）',
    false,
    `从 stdout 里读不到任何 A1–A7 的汇总行 —— 断言脚本被改了？看 .verify/tmp/visual-assert.log`
  );
} else {
  check(
    `assert.mjs 输出了 ${rows.size} 项汇总行（期望 ${ASSERTION_NAMES.length} 项）`,
    rows.size === ASSERTION_NAMES.length
  );
}

const shotsHit = /visual:\s*(\d+)\s*张\s*\/\s*(\d+)\s*项断言\s*\/\s*(\d+)\s*失败/.exec(raw);
const shots = shotsHit ? Number(shotsHit[1]) : 0;

for (const name of ASSERTION_NAMES) {
  const id = `A${ASSERTION_NAMES.indexOf(name) + 1}`;
  const r = rows.get(id);
  const label = `${name}（${shots} 张矩阵）`;
  if (!r) {
    check(label, false, `assert.mjs 的输出里没有 ${id} —— 断言被删了，或汇总格式变了`);
    continue;
  }
  if (r.pass === 0 && r.fails === 0) {
    // 一张都判不了 = 这条断言这次**没起作用**。不算通过（这就是「从没红过的断言等于摆设」）。
    skip(
      label,
      `本次 ${shots} 张里没有可判定的目标（未适用 ${r.nas} / 无从判定 ${r.unjudged}）—— 不是通过`
    );
    continue;
  }
  check(
    `${label}：通过 ${r.pass} / 失败 ${r.fails}`,
    r.fails === 0 && r.unjudged === 0,
    [
      r.fails > 0 ? `失败 ${r.fails} 张` : '',
      r.unjudged > 0 ? `无从判定 ${r.unjudged} 张（页面没加载起来，断言没跑成）` : '',
      detailFor(id),
    ]
      .filter(Boolean)
      .join('\n')
  );
}

// ═══════════════════════════════════════════════════════════════
// 【3】矩阵与截图台交叉核对 —— 「没被测到的页面」要被点名
// ═══════════════════════════════════════════════════════════════
console.log('\n【3】矩阵：断言测的张数与截图台记的张数');

let manifestShots: number | null = null;
try {
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { shots?: unknown[] };
  manifestShots = Array.isArray(m.shots) ? m.shots.length : null;
} catch {
  manifestShots = null;
}

if (manifestShots === null) {
  skip(
    '矩阵张数与截图台一致',
    `读不到 ${path.relative(webRoot, manifestPath)}.shots —— 截图台（node visual/shoot.mjs）没跑过`
  );
} else {
  check(
    `矩阵张数与截图台一致（断言 ${shots} 张 / 截图台 ${manifestShots} 张）`,
    shots > 0 && shots === manifestShots,
    shots === 0
      ? '断言侧一张都没跑成'
      : `两侧不一致 → 页面变过了（新增/删除路由）却没有重跑截图台：node visual/shoot.mjs`
  );
}

// ═══════════════════════════════════════════════════════════════
// 【4】findings 素材：人读的结论必须指得到真实文件
// ═══════════════════════════════════════════════════════════════
console.log('\n【4】findings.md 的素材核对（条目数与引用的 PNG 真实存在）');

const findings = spawnSync(process.execPath, [assertScript, '--check-findings'], {
  cwd: webRoot,
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
  timeout: 60 * 1000,
});
const fRaw = `${findings.stdout ?? ''}${findings.stderr ?? ''}`;
for (const l of fRaw.split(/\r?\n/)) {
  if (l.trim()) console.log(`  ${l}`);
}
const fHit = /findings:\s*条目\s*(\d+)\s*\/\s*引用 PNG\s*(\d+)\s*\/\s*(.+)$/m.exec(fRaw);
check(
  `findings.md：条目 ${fHit ? fHit[1] : '—'} 条 / 引用 PNG ${fHit ? fHit[2] : '—'} 个 / ${fHit ? fHit[3].trim() : '输出读不到'}`,
  findings.status === 0 && !!fHit,
  fHit ? '' : '读不到结论行 —— 素材核对自己坏了，别让它静默变绿'
);

console.log(`\n${'\u2500'.repeat(56)}`);
process.exit(finish('visual', `（${shots} 张截图 × ${ASSERTION_NAMES.length} 项断言）`));
