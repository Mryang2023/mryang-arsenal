#!/usr/bin/env node
/**
 * verify 串行 runner —— 八层**顺序执行、不短路**，逐层记账，最后给一个总账与一个退出码。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么必须有它（它修的是两种「说谎的绿」）：
 *
 * ① **短路吞层**。以前 `verify` 是一条 `&&` 链：
 *    `verify:arch && verify:graph && … && verify:scan`。
 *    任何一层失败，后面的层**根本不启动**，而「没启动」在退出码上留不下任何痕迹 ——
 *    报告里看到的是「第三层红了」，看不到「第五到第八层没跑」。
 *    本脚本顺序执行、**收集每一层的退出码**，所以后面几层永远有行。
 *
 * ② **跳过算通过**。跑不起来的层（缺 bash / 缺 JDK17 / 后端没起 / 绘图器没装）
 *    以前各自 `process.exit(0)`，于是「八层全绿」可能实际是「五层在跑」。
 *    现在跳过是独立状态（见 `.verify/lib/report.ts`），会进总账、会被点名、
 *    并且整体退出码是 **2** 而不是 0。
 *
 * ─────────────────────────────────────────────────────────────
 * 退出码约定（与 README、`.verify/lib/report.ts` 同源；改口径三处一起改）：
 *   0 = 全绿，且**无任何跳过**
 *   2 = 绿（无失败），但存在跳过 —— 可交付，但报告里必须点名哪层跳了
 *   1 = 有失败（含：某层崩溃 / 没写出状态文件 / 空跑却报通过）
 *
 * 用法：`npm run verify`（`preverify` 会先跑 sync；本脚本也会自己跑一次 sync，
 * 因为直接 `node scripts/verify-all.mjs` 时没有 preverify 兜底）。
 * ─────────────────────────────────────────────────────────────
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '..');
const tmpDir = path.join(webRoot, '.verify', 'tmp');

/** 执行顺序 = 以前那条 `&&` 链的顺序（顺序变了会影响人读日志的肌肉记忆）。 */
const LAYERS = [
  { key: 'arch', name: '架构判定', script: 'verify:arch' },
  { key: 'graph', name: '图与交互', script: 'verify:graph' },
  { key: 'cases', name: '场景案例', script: 'verify:cases' },
  { key: 'project', name: '结构与导出', script: 'verify:project' },
  { key: 'engine', name: '引擎样本', script: 'verify:engine' },
  { key: 'parity', name: '前后端一致性', script: 'verify:parity' },
  { key: 'archify', name: 'Archify 链路', script: 'verify:archify' },
  { key: 'scan', name: '代码扫描', script: 'verify:scan' },
];

/** 声明项数只从档案读一处 —— 这里不许再写一份手写数字。 */
function declaredCounts() {
  try {
    const doc = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'arsenal-profiles', 'arsenal.json'), 'utf8')
    );
    const chain = doc?.project?.verifyChain ?? [];
    return new Map(chain.map((v) => [v.name, v.count]));
  } catch {
    return new Map();
  }
}

const DECLARED = declaredCounts();

/**
 * 用 shell 跑 `npm`：Windows 上 npm 是 `.cmd`，Node 22 起 spawn 批处理必须走 shell。
 * `shell: true` 时 Node **不会**为数组参数做转义（直接以空格拼进命令行），
 * 所以这里自己拼：含空白或引号的片段加双引号 —— 否则 `process.execPath` 一旦落在
 * 带空格的目录（例如 `C:\Program Files\...`）就会静默拼出一条跑不起来的命令。
 * 返回值就是子进程的退出码，原样透传，中间**没有任何管道**（管道会把退出码换成最后一个命令的）。
 */
function run(command, args, extraEnv = {}) {
  const q = (s) => (/[\s"]/.test(String(s)) ? `"${s}"` : String(s));
  const line = [command, ...args].map(q).join(' ');
  const r = spawnSync(line, {
    cwd: webRoot,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...extraEnv },
  });
  if (r.error) {
    console.error(`  ! 起不了子进程：${line}\n    ${r.error.message}`);
    return 1;
  }
  // status === null 意味着被信号杀掉（没有退出码）—— 当失败处理，不许当 0
  return r.status === null ? 1 : r.status;
}

function readLayerStatus(key) {
  const p = path.join(tmpDir, `layer-${key}.json`);
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const s = JSON.parse(raw);
    if (typeof s?.pass === 'number' && typeof s?.fail === 'number' && typeof s?.skip === 'number') return s;
    return { corrupt: true };
  } catch {
    return null;
  }
}

function cleanOldStatus() {
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    for (const f of fs.readdirSync(tmpDir)) {
      if (/^layer-[a-z]+\.json$/.test(f)) fs.rmSync(path.join(tmpDir, f), { force: true });
    }
  } catch {
    // 清不掉不算失败：后面的 readLayerStatus 会因为读到上一轮的陈旧文件而露馅
  }
}

function pad(s, n) {
  // 中文按 2 个显示宽度算，否则表格会歪
  const w = [...String(s)].reduce((a, c) => a + (/[\u4e00-\u9fff\uff00-\uffef]/.test(c) ? 2 : 1), 0);
  return String(s) + ' '.repeat(Math.max(0, n - w));
}

const t0 = Date.now();
console.log('═'.repeat(64));
console.log('verify · 串行 runner（八层顺序执行，不短路；跳过是独立状态）');
console.log('═'.repeat(64));

cleanOldStatus();

// ── 步骤 0：sync（生成物过期的话，后面每一层的红都是假红）────────────
// 注：`npm run verify` 会先跑 `preverify` 的 sync，这里等于跑第二次。
// 刻意保留而不是删掉 `preverify`：直接 `node scripts/verify-all.mjs` 时没有它兜底，
// 而「忘了 sync 就跑验证」得到的是**假红**，代价远大于这 2~3 秒。
console.log('\n▸ sync（事实源 → 生成物）');
const syncCode = run('npm', ['run', 'sync']);

// ── 步骤 1：类型闸门（闸门层，不计项数）──────────────────────────
// 两次 tsc：根配置守 src/，`.verify/tsconfig.json` 守断言脚本自己。
// 为什么要第二次：`.verify/**` **不在根 tsconfig 的 include 里**
// （TS 的 `**/*.ts` 不匹配以点开头的目录，实测 521 个文件里 .verify 下 0 个），
// 所以只跑根配置时，「断言脚本自己有没有类型错」没人管 —— 坏 import 只在运行时炸成整层崩。
console.log('\n▸ typecheck（tsc --noEmit；根配置 + .verify 独立配置）');
const tcRootCode = run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit']);
const tcVerifyCode = run(process.execPath, [
  'node_modules/typescript/bin/tsc',
  '--noEmit',
  '--project',
  '.verify/tsconfig.json',
]);
const tcCode = tcRootCode !== 0 ? tcRootCode : tcVerifyCode;
const tc = { code: tcCode, root: tcRootCode, verify: tcVerifyCode };

// ── 步骤 2：八层 ────────────────────────────────────────────────
const rows = [];
for (const layer of LAYERS) {
  const declared = DECLARED.get(layer.name) ?? null;
  console.log(`\n${'═'.repeat(64)}`);
  console.log(`▸ ${layer.script}（${layer.name}${declared === null ? '' : ` · 声明 ${declared} 项`}）`);
  console.log('═'.repeat(64));
  const code = run('npm', ['run', layer.script], {
    ARSENAL_LAYER_DECLARED: declared === null ? '' : String(declared),
  });
  const st = readLayerStatus(layer.key);
  rows.push({ ...layer, declared, code, st });
}

// ── 汇总 ───────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(64)}`);
console.log('汇总（数字全部来自各层写出的 layer-<key>.json，没有一个是手写的）');
console.log('═'.repeat(64));
console.log(`${pad('层', 18)}${pad('实测', 8)}${pad('跳过', 8)}${pad('失败', 8)}${pad('退出码', 8)}声明`);
console.log('─'.repeat(64));

let totalPass = 0;
let totalSkip = 0;
let totalFail = 0;
const problems = [];
const skippedLayers = [];

console.log(`${pad('类型闸门', 18)}${pad('—', 8)}${pad('—', 8)}${pad('—', 8)}${pad(tcCode, 8)}闸门层（tsc --noEmit ×2，不计项数）`);
console.log(`${pad('  └ 根配置 src/', 18)}${pad('—', 8)}${pad('—', 8)}${pad('—', 8)}${pad(tc.root, 8)}521 个文件`);
console.log(`${pad('  └ .verify 断言', 18)}${pad('—', 8)}${pad('—', 8)}${pad('—', 8)}${pad(tc.verify, 8)}9 个断言脚本`);
if (tcCode !== 0) problems.push(`[失败] 类型闸门 typecheck 退出码 ${tcCode}（根 ${tc.root} / .verify ${tc.verify}）`);

for (const r of rows) {
  const s = r.st;
  const passN = s?.pass ?? null;
  const skipN = s?.skip ?? null;
  const failN = s?.fail ?? null;
  console.log(
    `${pad(r.name, 18)}${pad(passN === null ? '?' : passN, 8)}${pad(skipN === null ? '?' : skipN, 8)}`
    + `${pad(failN === null ? '?' : failN, 8)}${pad(r.code, 8)}${r.declared ?? '—'}`
  );
  if (s?.pass !== undefined) {
    totalPass += s.pass;
    totalSkip += s.skip;
    totalFail += s.fail;
  }
  // 层自己报的状态与进程退出码不一致 → 记账不可信，必须点名
  if (s && typeof s.exitCode === 'number' && s.exitCode !== r.code) {
    problems.push(`[失败] ${r.name}：层自报退出码 ${s.exitCode} / 进程实际 ${r.code} —— 记账不可信`);
  }
  if (s?.corrupt) problems.push(`[失败] ${r.name}：layer-${r.key}.json 结构不对`);
  if (!s) problems.push(`[失败] ${r.name}：没写出 layer-${r.key}.json（崩溃或未走到收尾）`);
  if (r.code === 1) problems.push(`[失败] ${r.name}：有失败项（退出码 1）`);
  else if (r.code !== 0 && r.code !== 2) problems.push(`[失败] ${r.name}：异常退出码 ${r.code}`);
  if (s && s.fail > 0) problems.push(`[失败] ${r.name}：${s.fail} 项失败`);
  if (s && s.pass + s.fail + s.skip === 0 && r.code === 0) {
    // 「0 项却报通过」是最隐蔽的一种假绿：检查器空了，但没人知道
    problems.push(`[失败] ${r.name}：空跑 —— 0 项实测 / 0 项失败 / 0 项跳过，却退出 0`);
  }
  if (s && s.skip > 0) skippedLayers.push(`${r.name}（${s.skip} 项未执行）`);
}

console.log('─'.repeat(64));
console.log(`${pad('合计', 18)}${pad(totalPass, 8)}${pad(totalSkip, 8)}${pad(totalFail, 8)}`);

if (syncCode !== 0) problems.push(`[失败] sync 退出码 ${syncCode}`);
if (skippedLayers.length) {
  console.log('\n跳过的层（可交付，但报告里必须点名）');
  for (const s of skippedLayers) console.log(`  ~ ${s}`);
}

// 总账必须能从各层真实输出推出来，所以只在这里拼一次
const code = problems.some((p) => p.startsWith('[失败]')) ? 1 : totalSkip > 0 ? 2 : 0;
console.log('');
console.log(
  `verify: ${totalPass} 项实测 / ${totalSkip} 项跳过 / ${totalFail} 项失败`
  + `  → 退出码 ${code}（${code === 0 ? '全绿且无跳过' : code === 2 ? '绿但存在跳过' : '有失败'}）`
);
if (problems.length) {
  console.log('\n问题清单');
  for (const p of problems) console.log(`  ${p}`);
}
console.log(`耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);

process.exitCode = code;
