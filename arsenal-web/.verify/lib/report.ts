/**
 * verify 各层的统一记账与汇总 —— 「跳过是一个独立状态」的唯一实现处。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么需要它（这一层解决的是「说谎的绿」）：
 *
 * 改动之前，九层的收尾都是 `process.exitCode = fail === 0 ? 0 : 1`，
 * 「跑不了」和「跑过了」都落进同一个 0。于是 `npm run verify` 打出的「全绿」
 * 可能实际只有五层在跑 —— 绿的含义被高估了。
 *
 * 现在把状态拆成三个互斥的计数：
 *   · pass  —— 真的断言过，且过了
 *   · fail  —— 真的断言过，且没过
 *   · skip  —— **没有执行**（依赖缺失 / 依赖不可达）。既不算过，也不算失败。
 * 外加一个**不进上面三个**的第四类：
 *   · knowinglySkipped —— **刻意未跑**（造用例代价过大，不跑是决定不是意外）。
 *     它不计进 `total`，所以项的账不变；`--strict` 下由 runner 判为失败。
 *     不把它混进 skip：混了之后「跳过 34 项」这句话就不再说得出
 *     「其中几项是环境问题、几项是我们决定不跑」。
 *
 * 退出码约定（与 README、`scripts/verify-all.mjs` 同源，改口径三处一起改）：
 *   0 = 全绿且无任何跳过
 *   2 = 绿，但存在跳过（可交付，但报告里必须点名哪层跳了）
 *   1 = 有失败 —— **或本层项数与档案声明值对不上**（记账坏了与断言失败同罪）
 *
 * 两条会让人踩坑的边界：
 *   · `finish()` 会拿本层实测项数（`pass + fail + skip`）去比档案声明值，
 *     不等就把本层判负并打印「声明 X / 实测 Y」。这就是那句
 *     `VERIFY_CHAIN.reduce(...) === VERIFY_TOTAL` 恒等式**消失后**的替代品。
 *   · 整层跳过（`countSource === 'declared'`）**不进这个比对** ——
 *     它的项数取自声明值，自己比自己永远相等，比了等于没比。这种层会被
 *     链尾的 `verify:meta` 记成「未核对」。
 *
 * ─────────────────────────────────────────────────────────────
 * 机器可读输出（两条通道，互为兜底）：
 *   1. stdout 一行 `ARSENAL-LAYER-STATUS {json}`
 *   2. 文件 `.verify/tmp/layer-<key>.json`
 * `scripts/verify-all.mjs` 优先读文件；文件写不进去时才回落到 stdout。
 * 文件是首选通道，因为 Windows 下管道 stdout 是异步的，
 * 硬 `process.exit()` 有可能截断还没 flush 的 console.log —— 文件是同步写的，不会被截。
 *
 * ─────────────────────────────────────────────────────────────
 * 项数由**实测**得出（这是 `verify:meta` 存在的前提）：
 *
 *   measured = pass + fail        ← 真断言过的条数
 *   total    = measured + skip    ← 加上「未执行」的项数，与本层声明值同比
 *   countSource = 'measured' | 'declared'
 *
 * `countSource === 'declared'` 是一个**警告标记**：本层整层没跑（`skipLayer()`），
 * 那个「N 项未执行」里的 N 取自档案的声明值，不是测量结果 —— 自己给自己出题。
 * 链尾的 `.verify/meta-check.ts` 看到这个标记就记「未核对」，不会当通过。
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
  scaffold: '脚手架生成链路',
  // 章程层（2026-10-03 新增）：项目章程的治理机制是否真的生效。
  //
  // ⚠️ 为什么它**必须独立成层**，不能挂在 scaffold 里（设计稿初稿写的是「并入第十一层」，
  //    实测发现那条判断是错的）：
  //    `finish(layer)` 用 layer 字符串决定两件事 —— 状态文件名 `layer-<key>.json`
  //    与档案查表用的层名。两个脚本都 `finish('scaffold')` 时**后写的覆盖先写的**，
  //    于是先跑的那 17 项被静默吞掉，报告上只看得见后跑的那层。
  //    这正是本仓反复治的「静默丢失」，不能在自己新加的层上重犯一次。
  charter: '项目章程',
  // 体检报告（2026-10-12 新增，第 13 层）。独立 key 的理由同 verify-all.mjs 的注释。
  checkup: '体检报告',
  topology: '部署形态动画',
  visual: '视觉断言',
  // ⚠️ `meta` **不是 `verifyChain` 的成员** —— 它是链尾的元核对层：
  // 专门读其它各层写出的 `layer-<key>.json` 去比对声明值，所以自己既没有声明项数
  // （`declaredCount('meta')` 会返回 null）、也不参与层数合计。
  meta: '元核对',
};

let pass = 0;
let fail = 0;
let skipCount = 0;
const skippedNames: string[] = [];
const failedNames: string[] = [];
/**
 * `skipLayer()` 记下的项数 —— 它**不是测量结果**。
 *
 * 整层一行都没跑，本层无从知道「自己有多少项」，那个数字只能来自档案里的声明值。
 * 用声明值去填「跳过」的坑，等于让这一层自己给自己出题、自己判卷 ——
 * 所以这里单独计数：一旦 > 0，`layer-<key>.json` 的 `countSource` 就是 `declared`，
 * 链尾的 `verify:meta` 会据此把该层的项数标成**未核对**，而不是记一次通过。
 */
let declaredOnlySkip = 0;
/**
 * 「刻意未跑」的项（`knowinglySkipped()`）—— 与 `skipCount` **分开**计数。
 *
 * 混在一起会让「跳过 34 项」这句话失去信息：其中有多少是「环境不满足，环境好了就能跑」，
 * 有多少是「我们决定不跑，别等了」？分开之后 `--strict` 才有东西可判。
 * 它不进 `pass` / `fail` / `skip`，所以**不影响项数比对**（`verify:meta` 只看前三个）。
 */
let knowinglySkipCount = 0;
const knowinglyNames: string[] = [];
/**
 * 本层实测项数与档案声明值对不上时的记录（`finish()` 里检测）。
 *
 * 为什么它判负、却**不**计进 `fail`：`fail` 是「断言没过」的意思，
 * 而这个数字是**记账**问题 —— 把它塞进 `fail` 会让 `total = pass + fail + skip`
 * 多出 1 项，反而把要报的那个数字本身搞乱（35 会变成 36）。
 * 所以它单独一条通道：项数照原样报，退出码判 1。
 */
let declaredMismatch: { declared: number; total: number } | null = null;

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

/**
 * 本层声明的项数（默认取 `arsenal-profiles/arsenal.json` 的 `project.verifyChain`）。
 *
 * 读不到就返回 `null` —— **不再兜底成 1**。以前那个 `return 1` 会把「查不到这个层」
 * 伪装成「这层有 1 项」，而链尾的 `verify:meta` 拿它当真值去比对，就会得出
 * 「声明 1 / 实测 1」的假通过。宁可报「不知道」，不要报一个假数字。
 */
export function declaredCount(layer: string): number | null {
  const fromEnv = Number(process.env.ARSENAL_LAYER_DECLARED ?? '');
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  try {
    const raw = fs.readFileSync(path.join(repoRoot, 'arsenal-profiles', 'arsenal.json'), 'utf8');
    const doc = JSON.parse(raw) as { project?: { verifyChain?: { name: string; count: number }[] } };
    const chain = doc.project?.verifyChain ?? [];
    const hit = chain.find((v) => v.name === (LAYER_NAMES[layer] ?? layer));
    if (hit && typeof hit.count === 'number' && hit.count > 0) return hit.count;
  } catch {
    // 读不到档案就返回 null —— 宁可少报，不可假装跑了
  }
  return null;
}

/**
 * 整层跑不了：记 **n 项未执行**（n = `ARSENAL_LAYER_DECLARED` > 本层声明项数 > 1）。
 * 这不是失败，也**不是通过** —— 退出码会是 2。
 *
 * ⚠️ 走这条路记下的数字**来自声明值而不是测量值**（本层一行都没跑），
 * 会在 `layer-<key>.json` 里被标成 `countSource: 'declared'`，
 * 链尾 `verify:meta` 会把它记成**未核对**。
 */
export function skipLayer(layer: string, reason: string, declared?: number): number {
  const n = declared && declared > 0 ? declared : (declaredCount(layer) ?? 1);
  skipCount += n;
  declaredOnlySkip += n;
  skippedNames.push(`【整层】${LAYER_NAMES[layer] ?? layer}（${n} 项未执行）`);
  note(`  ! 本层整体跳过：${reason}`);
  note(`    本层声明 ${n} 项 —— 全部记为「未执行」，既不计通过也不计失败。`);
  note('    注意：这个数字取自档案的声明值（本层没跑，无从测量）—— 它不算证据。');
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

/**
 * 「刻意未跑」：**声明在案、且这次本来就不打算跑**的断言（造用例代价过大）。
 *
 * 与 `skip()` 的区别就是「想跑跑不了」和「不打算跑」：
 *   · `skip()` / `skipItems()` / `skipLayer()` —— 依赖缺失或不可达，**环境好了就能跑**
 *     → 进 skip 计数 → 退出码 2
 *   · 本函数 —— 代价过大，**不跑是决定而不是意外** → 单独一个计数，
 *     不进 pass / fail / skip（所以项的账不变），`--strict` 下由 runner 判为失败。
 *
 * 为什么必须分开：混进「跳过」里，人会以为「把环境配好就全绿了」——
 * 而这两项**配好环境也不会跑**。`verify:scan` 的 500MB 总字节闸门、
 * 真等 180s 超时就是这两项（造 500MB 用例要磁盘和时间）。
 */
export function knowinglySkipped(name: string, reason: string): void {
  knowinglySkipCount += 1;
  knowinglyNames.push(name);
  note(`  ~ 刻意未跑：${name}`);
  note(`      ${reason}`);
}

export function summary(): {
  pass: number;
  fail: number;
  skip: number;
  measured: number;
  total: number;
  countSource: 'measured' | 'declared';
  knowinglySkipped: number;
  knowinglyNames: string[];
  skipped: string[];
  failed: string[];
} {
  return {
    pass,
    fail,
    skip: skipCount,
    // 实测 = 真断言过的条数（通过 + 失败）；跳过**不是**实测。
    measured: pass + fail,
    // 总项数 = 实测 + 未执行 —— 链尾 `verify:meta` 用它与档案声明值比对。
    total: pass + fail + skipCount,
    countSource: declaredOnlySkip > 0 ? 'declared' : 'measured',
    // 「刻意未跑」**不进 total**（不跑是决定，不是意外）—— 它只被单独记账。
    knowinglySkipped: knowinglySkipCount,
    knowinglyNames: [...knowinglyNames],
    skipped: [...skippedNames],
    failed: [...failedNames],
  };
}

/**
 * fail>0 → 1；**记账对不上也 → 1**；否则 skip>0 → 2；否则 0。
 *
 * 「记账对不上」指本层实测项数 ≠ 档案声明值（见 `declaredMismatch`）：
 * 层内加了/删了断言却没同步档案，与断言失败同量级的坏 —— 都让「绿」失去意义。
 */
export function exitCode(): 0 | 1 | 2 {
  if (fail > 0) return 1;
  if (declaredMismatch) return 1;
  if (skipCount > 0) return 2;
  return 0;
}

/**
 * 收尾：打印统一格式的「实测 / 跳过 / 失败」+ 一行机器可读状态，写 `layer-<key>.json`，
 * 并设置 `process.exitCode`。返回退出码，便于 `process.exit(finish(...))`。
 */
export function finish(layer: string, noteText?: string): 0 | 1 | 2 {
  const s = summary();
  const declared = declaredCount(layer);
  // 先检测记账，再算退出码 —— exitCode() 会读 declaredMismatch
  if (declared !== null && s.countSource === 'measured' && s.total !== declared) {
    declaredMismatch = { declared, total: s.total };
  }
  const code = exitCode();
  console.log(`\n${'\u2500'.repeat(56)}`);
  console.log(`实测 ${s.pass} 项 / 跳过 ${s.skip} 项 / 失败 ${s.fail} 项${noteText ? `  ${noteText}` : ''}`);
  if (s.skip > 0) {
    for (const n of s.skipped) console.log(`  ~ 未执行：${n}`);
  }
  if (s.knowinglySkipped > 0) {
    console.log(`  ~ 刻意未跑 ${s.knowinglySkipped} 项（不打算跑，不是环境问题）：`);
    for (const n of s.knowinglyNames) console.log(`      · ${n}`);
  }
  if (declaredMismatch) {
    // 本层自己的账都对不上档案 —— 当场判负（与断言失败同为退出码 1）。
    // 链尾 verify:meta 会再报一次同样的两个数字（那里能一次看到各层全貌）。
    console.log(
      `  \u2717 本层项数对不上档案：声明 ${declaredMismatch.declared} / 实测 ${declaredMismatch.total}`
        + `${s.skip > 0 ? `（其中 ${s.skip} 项未执行）` : ''}`
        + '\n      处置：改 arsenal-profiles/arsenal.json 的 project.verifyChain，或改本层断言数'
    );
  }
  const payload = {
    layer,
    name: LAYER_NAMES[layer] ?? layer,
    pass: s.pass,
    fail: s.fail,
    skip: s.skip,
    measured: s.measured,
    total: s.total,
    declared,
    declaredMismatch,
    countSource: s.countSource,
    knowinglySkipped: s.knowinglySkipped,
    knowinglyNames: s.knowinglyNames,
    exitCode: code,
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
