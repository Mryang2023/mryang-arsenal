/**
 * verify 各层的统一记账与汇总 —— 「跳过是一个独立状态」的唯一实现处。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要它（这一层解决的是「说谎的绿」）：
 *
 * 改动之前，八层的收尾都是 `process.exitCode = fail === 0 ? 0 : 1`，
 * 「跑不了」和「跑过了」都落进同一个 0。于是 `npm run verify` 打出的「全绿」
 * 可能实际只有五层在跑 —— 绿的含义被高估了。
 *
 * 现在把状态拆成三个互斥的计数：
 *   · pass  —— 真的断言过，且过了
 *   · fail  —— 真的断言过，且没过
 *   · skip  —— **没有执行**（依赖缺失 / 依赖不可达）。既不算过，也不算失败。
 *
 * 退出码约定（与 README 同源，改口径三处一起改）：
 *   0 = 全绿且无任何跳过
 *   2 = 绿，但存在跳过（可交付，但报告里必须点名哪层跳了）
 *   1 = 有失败
 *
 * ─────────────────────────────────────────────────────────────
 * 机器可读输出（两条通道，互为兜底）：
 *   1. stdout 一行 `ARSENAL-LAYER-STATUS {json}`
 *   2. 文件 `.verify/tmp/layer-<key>.json`
 * `scripts/verify-all.mjs` 优先读文件；文件写不进去时才回落到 stdout。
 * 文件是首选通道，因为 Windows 下管道 stdout 是异步的，
 * 硬 `process.exit()` 有可能截断还没 flush 的 console.log —— 文件是同步写的，不会被截。
 *
 * 记账口径：`skip()` 记 **1 项**；整层跑不了用 `skipLayer()`，
 * 记 **本层声明的项数**（默认读 `arsenal-profiles/arsenal.json` 的 `project.verifyChain`，
 * 可用环境变量 `ARSENAL_LAYER_DECLARED` 覆盖）。这样总账里的
 * 「跳过 M 项」是**项数**而不是「跳过了几次」，与「实测 N 项」同量纲、可以直接相加比对。
 * ─────────────────────────────────────────────────────────────
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..', '..');
const repoRoot = path.resolve(webRoot, '..');
const tmpDir = path.join(webRoot, '.verify', 'tmp');

/** 层 key → 验证链里的中文名（`verifyChain` 用它做分项）。只读，不改档案。 */
export const LAYER_NAMES: Record<string, string> = {
  arch: '架构判定',
  graph: '图与交互',
  project: '结构与导出',
  cases: '场景案例',
  engine: '引擎样本',
  parity: '前后端一致性',
  archify: 'Archify 链路',
  scan: '代码扫描',
};

let pass = 0;
let fail = 0;
let skipCount = 0;
const skippedNames: string[] = [];
const failedNames: string[] = [];

/**
 * 同步写 stdout —— 用于「写完就要 `process.exit()`」的路径。
 * Windows 下管道 stdout 是异步的，`console.log` 后面紧跟 `process.exit()`
 * 可能把最后几行截掉；`fs.writeSync(1, …)` 是同步的，不会。
 */
function writeSync(msg: string): void {
  try {
    fs.writeSync(1, msg);
  } catch {
    console.log(msg.replace(/\n$/, ''));
  }
}

/** 同步打印一行（不换行由调用方决定）。 */
export function note(msg: string): void {
  writeSync(`${msg}\n`);
}

/** 计入 pass / fail。真实断言只走这里。 */
export function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    fail += 1;
    failedNames.push(name);
    console.log(`  \u2717 ${name}${detail ? `\n      ${detail.split('\n').join('\n      ')}` : ''}`);
  }
}

/** 计入 skip（1 项）—— **绝不进 pass**。用于单个断言的依赖缺失。 */
export function skip(name: string, reason: string): void {
  skipCount += 1;
  skippedNames.push(name);
  console.log(`  ~ ${name}\n      未执行：${reason}`);
}

/** 本层声明的项数（默认取 `arsenal-profiles/arsenal.json` 的 `project.verifyChain`）。 */
export function declaredCount(layer: string): number {
  const fromEnv = Number(process.env.ARSENAL_LAYER_DECLARED ?? '');
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  try {
    const raw = fs.readFileSync(path.join(repoRoot, 'arsenal-profiles', 'arsenal.json'), 'utf8');
    const doc = JSON.parse(raw) as { project?: { verifyChain?: { name: string; count: number }[] } };
    const chain = doc.project?.verifyChain ?? [];
    const hit = chain.find((v) => v.name === (LAYER_NAMES[layer] ?? layer));
    if (hit && typeof hit.count === 'number' && hit.count > 0) return hit.count;
  } catch {
    // 读不到档案就退回 1 —— 宁可少报，不可假装跑了
  }
  return 1;
}

/**
 * 整层跑不了：记 **n 项未执行**（n = `ARSENAL_LAYER_DECLARED` > 本层声明项数 > 1）。
 * 这不是失败，也**不是通过** —— 退出码会是 2。
 */
export function skipLayer(layer: string, reason: string, declared?: number): number {
  const n = declared && declared > 0 ? declared : declaredCount(layer);
  skipCount += n;
  skippedNames.push(`【整层】${LAYER_NAMES[layer] ?? layer}（${n} 项未执行）`);
  note(`  ! 本层整体跳过：${reason}`);
  note(`    本层声明 ${n} 项 —— 全部记为「未执行」，既不计通过也不计失败。`);
  return n;
}

/**
 * 一批断言未执行（n 项）—— 用于「某个依赖不可达，导致 N 条断言一条都没跑」。
 * 与 `skipLayer()` 的区别只是措辞：那个说「整层」，这个说「这一批」。
 */
export function skipItems(label: string, reason: string, n: number): void {
  skipCount += n;
  skippedNames.push(`${label}（${n} 项未执行）`);
  note(`  ! ${label}：${reason}`);
  note(`    这 ${n} 项记为「未执行」—— 既不计通过也不计失败。`);
}

export function summary(): { pass: number; fail: number; skip: number; skipped: string[]; failed: string[] } {
  return { pass, fail, skip: skipCount, skipped: [...skippedNames], failed: [...failedNames] };
}

/** fail>0 → 1；否则 skip>0 → 2；否则 0。 */
export function exitCode(): 0 | 1 | 2 {
  if (fail > 0) return 1;
  if (skipCount > 0) return 2;
  return 0;
}

/**
 * 收尾：打印统一格式的「实测 / 跳过 / 失败」+ 一行机器可读状态，写 `layer-<key>.json`，
 * 并设置 `process.exitCode`。返回退出码，便于 `process.exit(finish(...))`。
 */
export function finish(layer: string, noteText?: string): 0 | 1 | 2 {
  const s = summary();
  const code = exitCode();
  console.log(`\n${'\u2500'.repeat(56)}`);
  console.log(`实测 ${s.pass} 项 / 跳过 ${s.skip} 项 / 失败 ${s.fail} 项${noteText ? `  ${noteText}` : ''}`);
  if (s.skip > 0) {
    for (const n of s.skipped) console.log(`  ~ 未执行：${n}`);
  }
  const payload = {
    layer,
    name: LAYER_NAMES[layer] ?? layer,
    pass: s.pass,
    fail: s.fail,
    skip: s.skip,
    exitCode: code,
    declared: declaredCount(layer),
    skipped: s.skipped,
  };
  // 首选通道：同步写文件。次选：stdout 一行。
  try {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, `layer-${layer}.json`),
      `${JSON.stringify(payload, null, 2)}\n`,
      'utf8'
    );
  } catch (e) {
    process.exitCode = code;
    writeSync(`  ! 写 layer-${layer}.json 失败（${(e as Error).message}）—— 汇总走 stdout 通道\n`);
  }
  writeSync(`ARSENAL-LAYER-STATUS ${JSON.stringify(payload)}\n`);
  process.exitCode = code;
  return code;
}
