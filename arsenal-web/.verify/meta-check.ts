/**
 * 元核对层（链尾闸门）—— **让「八层各自实际跑了多少项」由机器守门，而不是靠人手写同步。**
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要它（它修的是「手写数字」这种说谎方式）：
 *
 * `project-check.ts` 里原来有一句
 *   `VERIFY_CHAIN.reduce((n, v) => n + v.count, 0) === VERIFY_TOTAL && VERIFY_TOTAL === 662`
 * 前半句是**恒等式**（`VERIFY_TOTAL` 的定义就是那个 reduce，永远相等），
 * 真正起作用的只有后半句那个手写的 662。于是「层内加了 3 项断言而外面的数字没动」
 * 这件事，整套 verify 完全看不见 —— 它照样全绿。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么必须是**链尾**（这是原设计没做成的真实原因）：
 *
 * `verify:project` 跑在其它层**中间**，它执行时 `engine / parity / archify / scan`
 * 还没开始跑，`layer-<key>.json` 根本不存在 —— 放在那里读兄弟层的结果，
 * 只能读到半份，或者读到上一轮的陈旧文件，然后变成一条永远绿的假断言。
 * 所以这一层单列，挂在八层**全部跑完之后**。
 *
 * ─────────────────────────────────────────────────────────────
 * 比什么（每一项都能红）：
 *
 *   ① 档案 vs 生成物    `arsenal-profiles/arsenal.json` 与
 *                       `src/generated/profiles.json` 的 verifyChain 必须逐层相同
 *                       （抓「改了档案忘了跑 sync-content」）
 *   ② 逐层项数          每层写出的 `layer-<key>.json` 里
 *                       `total(= pass + fail + skip)` 必须等于档案声明值，
 *                       不等就红，并把两个数字都打出来：「声明 34 / 实测 35」
 *   ③ 层自报 vs 档案    状态文件里的 `declared` 与元核对**自己读到的**档案值必须一致
 *                       （层读错了档案 / 有人用 `ARSENAL_LAYER_DECLARED` 临时覆盖过）
 *   ④ README 两处       「共 **662 项**」总数句、以及分项表里每一层的项数
 *
 * ⚠️ **不把「整层跳过」当核对通过**：`skipLayer()` 记的那个「N 项未执行」
 * 里的 N 取自档案声明值（本层一行都没跑，无从测量），拿它去比声明值就是
 * 自己给自己出题。这种层在状态文件里带 `countSource: 'declared'`，
 * 元核对把它记成「未核对」（进 skip 计数 → 退出码 2），**不计 pass**。
 *
 * 退出码沿用 `.verify/lib/report.ts` 的约定：0 全绿 / 2 有跳过 / 1 有失败。
 * ─────────────────────────────────────────────────────────────
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { check, finish, LAYER_NAMES, skip } from './lib/report';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '..');
const tmpDir = path.join(webRoot, '.verify', 'tmp');

/**
 * 比对顺序 = `arsenal-profiles/arsenal.json` 里 `verifyChain` 的顺序
 * （顺序只影响打印，不影响结论；写死是为了让人读日志时行行对得上）。
 */
const CHAIN_ORDER = ['arch', 'graph', 'project', 'cases', 'engine', 'parity', 'archify', 'scan'];

/** 汇总产物的文件名。`.verify/tmp/layer-counts.json` —— A-4 要求的那一份。 */
const AGGREGATE_FILE = 'layer-counts.json';

interface ChainEntry {
  name: string;
  count: number;
}

interface LayerStatus {
  layer: string;
  name: string;
  pass: number;
  fail: number;
  skip: number;
  measured?: number;
  total?: number;
  declared?: number | null;
  countSource?: string;
  exitCode?: number;
  skipped?: string[];
}

/** 汇总表/落盘用的一行。`missing` 为真表示这层根本没写出状态文件。 */
interface LayerRow {
  name: string;
  pass: number;
  fail: number;
  skip: number;
  measured: number;
  total: number;
  declared: number | null;
  countSource: string;
  exitCode: number | null;
  /** `null` = 未核对（整层未执行，项数无从独立核对）。 */
  ok: boolean | null;
  missing?: boolean;
}

function readJson<T>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
  } catch {
    return null;
  }
}

const profilePath = path.join(repoRoot, 'arsenal-profiles', 'arsenal.json');
const genPath = path.join(webRoot, 'src', 'generated', 'profiles.json');
const readmePath = path.join(repoRoot, 'README.md');

console.log('元核对（verify:meta）—— 让「各层跑了多少项」由机器守门');
console.log('读 `.verify/tmp/layer-<key>.json`（由 `.verify/lib/report.ts` 的 finish() 写出）');

// ═══════════════════════════════════════════════════════════════
// ① 档案 vs 生成物
// ═══════════════════════════════════════════════════════════════
console.log('\n【1】事实源（arsenal-profiles/arsenal.json）');
const profile = readJson<{ project?: { verifyChain?: ChainEntry[] } }>(profilePath);
const chainDeclared: ChainEntry[] = profile?.project?.verifyChain ?? [];
check(
  '档案：能读到 project.verifyChain',
  chainDeclared.length > 0,
  `${profilePath} 里 project.verifyChain 缺失或为空 —— 读不到声明值就没法逐层比对`
);
const declaredByName = new Map(chainDeclared.map((v) => [v.name, v.count]));
const sumDeclared = chainDeclared.reduce((n, v) => n + v.count, 0);

console.log('\n【2】生成物 vs 事实源（忘了 sync-content 就会红）');
const gen = readJson<{ profiles?: Record<string, { project?: { verifyChain?: ChainEntry[] } }> }>(genPath);
const genChain: ChainEntry[] =
  Object.values(gen?.profiles ?? {})
    .map((p) => p?.project?.verifyChain)
    .find((c): c is ChainEntry[] => Array.isArray(c) && c.length > 0) ?? [];
check(
  '生成物：能读到 profiles.*.project.verifyChain',
  genChain.length > 0,
  `${genPath} 里找不到 project.verifyChain —— 跑一次 node scripts/sync-content.mjs`
);
check(
  '生成物与事实源逐层相同',
  genChain.length === chainDeclared.length &&
    genChain.every((v, i) => v.name === chainDeclared[i].name && v.count === chainDeclared[i].count),
  `生成物 ${JSON.stringify(genChain.map((v) => `${v.name}:${v.count}`))}\n`
    + `      档案   ${JSON.stringify(chainDeclared.map((v) => `${v.name}:${v.count}`))}\n`
    + '      两侧不一致 → 改了档案却忘了 `node scripts/sync-content.mjs`'
);

// ═══════════════════════════════════════════════════════════════
// ③ 八层逐层比对（本层的核心）
// ═══════════════════════════════════════════════════════════════
console.log('\n【3】逐层：层写出的实测项数 vs 档案声明值');
const layers: Record<string, LayerRow> = {};
const unverified: string[] = [];
let sumMeasured = 0;
let sumSkipped = 0;
let sumFail = 0;

for (const key of CHAIN_ORDER) {
  const name = LAYER_NAMES[key] ?? key;
  const declared = declaredByName.get(name) ?? null;
  const file = path.join(tmpDir, `layer-${key}.json`);
  const st = readJson<LayerStatus>(file);

  if (!st) {
    check(
      `元核对：${name} 写出了状态文件 layer-${key}.json`,
      false,
      `没找到 ${file} —— 该层没跑、或跑完没走到收尾（report.ts 的 finish()）`
    );
    layers[key] = {
      name,
      pass: 0,
      fail: 0,
      skip: 0,
      measured: 0,
      total: 0,
      declared,
      countSource: 'missing',
      exitCode: null,
      ok: false,
      missing: true,
    };
    continue;
  }

  // 缺字段时退而求其次自己算 —— 但更希望状态文件是 report.ts 写的
  const measured = typeof st.measured === 'number' ? st.measured : st.pass + st.fail;
  const total = typeof st.total === 'number' ? st.total : measured + st.skip;
  const handed = typeof st.declared === 'number' ? st.declared : null;
  const countSource = st.countSource ?? 'unknown';

  sumMeasured += st.pass;
  sumSkipped += st.skip;
  sumFail += st.fail;

  check(
    `元核对：${name} 的字段齐全（pass/fail/skip）`,
    typeof st.pass === 'number' && typeof st.fail === 'number' && typeof st.skip === 'number',
    `layer-${key}.json 缺字段：${JSON.stringify(st).slice(0, 200)}`
  );
  check(
    `元核对：${name} 状态文件的层名一致`,
    st.name === name,
    `状态文件写「${st.name}」，层映射表说「${name}」`
  );
  check(
    `元核对：${name} 自带的声明值 = 元核对读到的档案值`,
    handed === declared,
    `状态文件里 ${handed} / 档案当前 ${declared}`
      + '（层读的档案与元核对读的不是同一份？或有 ARSENAL_LAYER_DECLARED 覆盖）'
  );

  // ⚠️ 只有 `measured` 才配拿去比声明值。另外两种都**不能**算核对通过：
  //   · `declared` —— 整层没跑，「N 项未执行」的 N 取自档案声明值（自己给自己出题）
  //   · 缺失/未知 —— 旧版 report.ts 写的状态文件，无从判断那个 skip 是测的还是填的。
  //     宁可报「未核对」，也不要按 `measured` 默认放过去 —— 那正是「老的假绿」的复现方式。
  if (countSource !== 'measured') {
    const why =
      countSource === 'declared'
        ? `本层整层未执行（countSource=declared）—— 那个「${st.skip} 项未执行」取自档案声明值，`
          + '不是测量结果，拿它比声明值等于自己给自己出题'
        : `状态文件里没有 countSource（旧版 report.ts 写的？）—— 无从判断那个「${st.skip} 项未执行」`
          + '是测出来的还是拿声明值填的，不按「实测」认账';
    unverified.push(
      countSource === 'declared' ? `${name}（整层未执行，${st.skip} 项）` : `${name}（来源不明）`
    );
    skip(`元核对：${name} 的项数独立核对`, why);
  } else {
    check(
      `元核对：${name} 声明 ${declared} / 实测 ${total}`,
      total === declared,
      `层「${name}」声明 ${declared} / 实测 ${total}`
        + `（实测 = 通过 ${st.pass} + 失败 ${st.fail} + 未执行 ${st.skip}）`
        + '\n      处置：要么改 arsenal-profiles/arsenal.json 的 project.verifyChain，'
        + '要么改这层的断言数 —— 两个数字必须有一个动'
    );
  }

  layers[key] = {
    name,
    pass: st.pass,
    fail: st.fail,
    skip: st.skip,
    measured,
    total,
    declared,
    countSource,
    exitCode: st.exitCode ?? null,
    ok: countSource === 'measured' ? total === declared : null,
  };
}

// ═══════════════════════════════════════════════════════════════
// ④ 链的完整性：不多不少
// ═══════════════════════════════════════════════════════════════
console.log('\n【4】比对范围本身也要对得上');
const missingKeys = CHAIN_ORDER.filter((k) => !declaredByName.has(LAYER_NAMES[k] ?? k));
check(
  '比对范围：八个层 key 都能在档案 verifyChain 里找到同名条目',
  missingKeys.length === 0,
  `档案里找不到这些层：${missingKeys.join(', ')}`
);
const chainNameKeys = chainDeclared.map((v) => v.name);
const extraChain = chainNameKeys.filter((n) => !CHAIN_ORDER.some((k) => (LAYER_NAMES[k] ?? k) === n));
check(
  '比对范围：档案里没有元核对不认识的层',
  extraChain.length === 0,
  `档案里有元核对没纳入比对的层：${extraChain.join(', ')} —— 新加了一层却没加进元核对`
);
check(
  '比对范围：verifyChain 里每层项数都是正数',
  chainDeclared.every((v) => Number.isFinite(v.count) && v.count > 0),
  `这些层的 count 不是正数：${chainDeclared.filter((v) => !(Number.isFinite(v.count) && v.count > 0)).map((v) => v.name).join(', ')}`
);

let strayFiles: string[] = [];
try {
  strayFiles = fs
    .readdirSync(tmpDir)
    .filter((f) => /^layer-[a-z-]+\.json$/.test(f) && f !== AGGREGATE_FILE)
    .map((f) => f.replace(/^layer-/, '').replace(/\.json$/, ''))
    .filter((k) => !CHAIN_ORDER.includes(k) && k !== 'meta');
} catch {
  // 目录读不到 → 后面每层都会报「没找到状态文件」，这里不重复喊
}
check(
  '比对范围：.verify/tmp 里没有链接外的 layer-*.json 残留',
  strayFiles.length === 0,
  `这些状态文件不属于任何已知层：${strayFiles.join(', ')}（残留文件会让下一轮读到陈旧结果）`
);

// ═══════════════════════════════════════════════════════════════
// ⑤ README 的两处派生数字
// ═══════════════════════════════════════════════════════════════
console.log('\n【5】README 的两处派生数字（手抄件也归机器管）');
let readme = '';
try {
  readme = fs.readFileSync(readmePath, 'utf8');
} catch {
  // 读不到就在下面报红
}
const totalHit = /共\s*\*\*(\d+)\s*项\*\*/.exec(readme);
check(
  `README 总数句 = 各层声明之和（README ${totalHit ? totalHit[1] : '—'} / 档案 ${sumDeclared}）`,
  !!totalHit && Number(totalHit[1]) === sumDeclared,
  totalHit
    ? `README 写「共 **${totalHit[1]} 项**」，而档案 verifyChain 之和是 ${sumDeclared}`
    : 'README 里找不到「共 **N 项**」这句话 —— 别把总数句删了'
);

const readmeRows = new Map<string, number>();
for (const m of readme.matchAll(/^\|\s*`verify:([a-z-]+)`\s*\|\s*(\d+)\s*\|/gm)) {
  readmeRows.set(m[1], Number(m[2]));
}
for (const key of CHAIN_ORDER) {
  const name = LAYER_NAMES[key] ?? key;
  const declared = declaredByName.get(name) ?? null;
  const got = readmeRows.get(key);
  check(
    `README 分项表：verify:${key} = ${declared}（README ${got ?? '—'}）`,
    got !== undefined && got === declared,
    got === undefined
      ? `README 分项表里没有 \`verify:${key}\` 这一行`
      : `README 写 ${got} / 档案 ${declared}`
  );
}

// ═══════════════════════════════════════════════════════════════
// ⑥ 汇总表 + 落盘 layer-counts.json
// ═══════════════════════════════════════════════════════════════
const pad = (s: unknown, n: number): string => {
  const w = [...String(s)].reduce((a, c) => a + (/[\u4e00-\u9fff\uff00-\uffef]/.test(c) ? 2 : 1), 0);
  return String(s) + ' '.repeat(Math.max(0, n - w));
};

console.log('\n【6】逐层清单');
console.log(`${pad('层', 18)}${pad('声明', 8)}${pad('实测', 8)}${pad('跳过', 8)}${pad('失败', 8)}${pad('来源', 12)}结论`);
console.log('─'.repeat(78));
for (const key of CHAIN_ORDER) {
  const l = layers[key];
  if (!l) continue;
  if (l.missing) {
    console.log(`${pad(l.name, 18)}${pad(l.declared ?? '—', 8)}${pad('?', 8)}${pad('?', 8)}${pad('?', 8)}${pad('—', 12)}状态文件缺失`);
    continue;
  }
  const src =
    l.countSource === 'measured' ? '实测' : l.countSource === 'declared' ? '声明值填充' : l.countSource;
  const verdict =
    l.ok === null
      ? l.countSource === 'declared'
        ? '未核对（整层未执行）'
        : '未核对（来源不明）'
      : l.ok
        ? '对得上'
        : `对不上（差 ${Number(l.total) - Number(l.declared)}）`;
  console.log(
    `${pad(l.name, 18)}${pad(l.declared ?? '—', 8)}${pad(l.total, 8)}${pad(l.skip, 8)}`
    + `${pad(l.fail, 8)}${pad(src, 12)}${verdict}`
  );
}
console.log('─'.repeat(78));
console.log(`${pad('八层合计', 18)}${pad(sumDeclared, 8)}${pad(sumMeasured + sumFail + sumSkipped, 8)}${pad(sumSkipped, 8)}${pad(sumFail, 8)}`);
console.log('（「实测」列 = 通过 + 失败 + 未执行，与「声明」同量纲；元核对自身不计入八层项数）');

if (unverified.length) {
  console.log('\n未核对（项数无从独立核对 —— 不计通过，也不计失败）');
  for (const u of unverified) console.log(`  ~ ${u}`);
}

const aggregate = {
  generatedAt: new Date().toISOString(),
  source: '各层 .verify/lib/report.ts 的 finish() 写出的 layer-<key>.json',
  declaredFrom: 'arsenal-profiles/arsenal.json → project.verifyChain',
  layers,
  total: {
    declared: sumDeclared,
    measured: sumMeasured,
    fail: sumFail,
    skip: sumSkipped,
    total: sumMeasured + sumFail + sumSkipped,
  },
  unverified,
};
try {
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(
    path.join(tmpDir, AGGREGATE_FILE),
    `${JSON.stringify(aggregate, null, 2)}\n`,
    'utf8'
  );
  console.log(`\n汇总产物：.verify/tmp/${AGGREGATE_FILE}`);
} catch (e) {
  check(`元核对：写出 .verify/tmp/${AGGREGATE_FILE}`, false, `写文件失败：${(e as Error).message}`);
}

process.exit(finish('meta'));
