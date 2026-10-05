/**
 * P3 · 一致性引擎（第五层检查器）
 *
 * 前四层（正则 / 语法树 / 语义 / 人工）全是**单文件**判定：每个文件单独看都合规，
 * 合起来可能是一套「同一个概念五种写法」的代码。第五层补的就是这个洞 ——
 * 它是**全仓聚合**判定，这是它必须单独存在、不能塞进前四层的唯一理由。
 *
 * ── 本引擎能发现什么（诚实边界，别高估）───────────────────────────
 *
 *   能：配置里列出的写法（canonical / forbidden），在同一个检查范围内**同时出现**时，
 *       报出漂移，并给出每种写法各在哪些文件出现。这正是「五套命名」场景。
 *   也能：发现与已列写法**只差一个词缀**的变体（Arch → Archs / ArchDTO），
 *       由 `nearMatch` 归一到同一概念下。
 *   **不能**：发现配置里没列过的全新同义词（写了 `Framework` 而配置只有 `Arch`）。
 *       同义词的「意思相同」这件事只有人知道，机器替代不了 —— 所以这一项
 *       仍然需要人把团队里真实存在的写法写进章程，引擎负责盯着它们别同时扩散。
 *
 * ── 为什么只有一份实现 ─────────────────────────────────────────────
 *
 *   `.mjs` 而不是 `.ts`：CI 执行器 `charter-ci.mjs` 是 .mjs，引擎要能被它直接
 *   import（否则 CI 里就得重写一遍 = 本仓已经栽过三次的「同一规矩两份实现」）。
 *   构建期脚本与断言层（.ts）反过来 import 本文件 —— 方向与 CI 一致，逻辑仍只有一份。
 *
 * ── 判负口径不在这里 ───────────────────────────────────────────────
 *
 *   跟 `policy` 那条纪律一样：本文件只产出「漂移了 / 没漂」，**不决定会不会阻断**。
 *   是否阻断由 `check.report`（drift / block）表达，最终判负由调用方读它。
 *   引擎写死「漂了就 exit 1」会让业务仓没法选择「只报不改」。
 *
 * @module
 */

import { globToRegExp } from '../../../arsenal-server/scripts/charter-ci.mjs';

/** 四种比对对象。契约 `CONSISTENCY_SPEC.check.type` 的取值，别处不要另写一份。 */
export const CONSISTENCY_TYPES = ['identifier', 'package', 'table', 'interface'];

/**
 * 近义词缀容差：与已列写法长度差在这个范围内、且互为前缀，算同一个概念的变体。
 *
 * 为什么是 2 不是 3：容差 3 时 `check` 会把 `checkbox` / `checkout` / `checksum`
 * 全收成变体 —— 这三个是**另一个词**，不是「校验」的又一种写法。
 * 实测三个例子全是噪声，所以收紧到 2（`checker` 收得进来，`checkout` 收不进来）。
 * 想让某个派生词参与比对，就把它显式写进 canonical / forbidden —— 那是人的判断。
 */
const NEAR_LEN_TOLERANCE = 2;

/** 变体样本最多记几个出现位置（一个人要看得过来）。 */
const MAX_SAMPLES_PER_VARIANT = 3;

/** 单文件单变体最多计多少次（防长文件把计数刷爆）。 */
const MAX_COUNT_PER_FILE_PER_VARIANT = 50;

/**
 * 把标识符切成「词段」。
 *
 * `ArchClient` → `['Arch','Client']`；`arch_service` → `['arch','service']`；
 * `com.example.arch` → `['com','example','arch']`；`HTTPClient` → `['HTTP','Client']`。
 *
 * 为什么要切：概念「架构」的写法是**词**而不是**标识符** —— 不切就没法把
 * `ArchClient` 里的 `Arch` 认出来，也没法把 `arch_dto` 里的 `arch` 认出来。
 *
 * @param {string} token
 * @returns {string[]} 原始大小写保留（展示要用）；比对侧自己 lower。
 */
export function splitSegments(token) {
  if (!token) return [];
  const out = [];
  for (const part of String(token).split(/[_\-.$\s]+/)) {
    if (!part) continue;
    // camel / Pascal 边界：小写或数字后接大写 → 断；连续大写后接「大写+小写」→ 断
    const pieces = part
      .replace(/([a-z0-9])([A-Z])/g, '$1\u0000$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1\u0000$2')
      .split('\u0000');
    for (const p of pieces) {
      // 单字符段（如 `x`）没有概念信息，留着只会制造噪声
      if (p.length >= 2) out.push(p);
    }
  }
  return out;
}

/**
 * 预建换行索引（与 charter-ci.mjs makeLocator 同算法，这里只要行号）。
 * @param {string} text
 * @returns {(index:number)=>number}
 */
function lineLocator(text) {
  const nl = [];
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) nl.push(i);
  return (index) => {
    let lo = 0;
    let hi = nl.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (nl[mid] <= index) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
}

/**
 * 按 type 抽出候选词段及其出现位置。
 *
 * 四种 type 的抽取规则差异写在这里（每条都注明局限，不许假装全能）：
 *
 * | type | 抽什么 | 局限 |
 * |---|---|---|
 * | identifier | 全文所有标识符（再切词段） | 字符串字面量里的词也会被算进去 |
 * | package | 仅 `package` / `import` 语句里的点分段 | 只认行首关键字，动态类加载认不出 |
 * | table | 仅 `from/join/into/update/table` 后的首个标识符 | 复杂 CTE / 子查询会漏 |
 * | interface | 仅 `name(` 形式的方法名（声明或调用） | 字段访问 `a.b()` 会连 `b` 一起取到（切段后仍可比） |
 *
 * @param {string} text
 * @param {string} type
 * @returns {{seg:string,line:number}[]}
 */
export function extractCandidates(text, type) {
  const at = lineLocator(text);
  /** @type {{seg:string,line:number}[]} */
  const out = [];
  const push = (token, index) => {
    const line = at(index);
    for (const seg of splitSegments(token)) out.push({ seg, line });
  };

  if (type === 'identifier') {
    const re = /[A-Za-z_$][A-Za-z0-9_$]*/g;
    let m;
    while ((m = re.exec(text)) !== null) push(m[0], m.index);
    return out;
  }

  if (type === 'package') {
    const re = /^[ \t]*(?:package|import)[ \t]+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/gm;
    let m;
    while ((m = re.exec(text)) !== null) {
      for (const seg of splitSegments(m[1])) out.push({ seg, line: at(m.index) });
    }
    return out;
  }

  if (type === 'table') {
    const re = /\b(?:from|join|into|update|table)[ \t]+["'`[]?([A-Za-z_][\w]*)/gi;
    let m;
    while ((m = re.exec(text)) !== null) push(m[1], m.index);
    return out;
  }

  if (type === 'interface') {
    // 关键字不是方法名，排掉：`if (` / `for (` / `while (` / `switch (` / `catch (`
    const re = /([A-Za-z_$][\w$]*)\s*\(/g;
    const reserved = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'function', 'synchronized']);
    let m;
    while ((m = re.exec(text)) !== null) {
      if (reserved.has(m[1].toLowerCase())) continue;
      push(m[1], m.index);
    }
    return out;
  }

  // 未知 type 不该静默通过 —— 契约层会拦，这里再兜一次（返回空 = 0 变体 = 假绿）
  throw new Error(`未知的 consistency check.type：${type}（契约允许 ${CONSISTENCY_TYPES.join(' / ')}）`);
}

/**
 * 最保守的屈折还原（复数 / 进行时 / 过去式）。
 *
 * 为什么必须有：`rules` 和 `rule` 是**同一个写法的两种词形**，不是两种命名。
 * 不做还原的话「规则」这一项会凭空多出 `rules` / `standards` / `checked` 一串变体，
 * 变体数被词形刷高 → 漂移永远为真 → 引擎变成「只要配了就报」，那就是摆设的另一种形态。
 *
 * 为什么不用 Porter 词干算法：那是为英文检索设计的，会把 `archives` 砍成 `archiv`、
 * 把 `business` 砍成 `busi`，反而制造噪声。这里只需要还原**屈折**，不碰派生。
 *
 * @param {string} key 已小写
 * @returns {string}
 */
export function stem(key) {
  const k = String(key);
  if (k.length <= 3) return k;
  if (k.endsWith('ies') && k.length > 4) return `${k.slice(0, -3)}y`;
  // ss / us / is 结尾不是复数（class / status / basis），去掉就变成另一个词了
  if (/(ss|us|is)$/.test(k)) return k;
  // ⚠️ 只去 `s`，**不去 `es`**：`rules` 走 es 会得到 `rul`、走 s 才得到 `rule`。
  // 复数还原要的是后者，而 `-ches/-shes` 这类在概念命名里几乎不出现，不值得为了它们引入错误。
  for (const suf of ['ing', 'ed', 's']) {
    if (k.endsWith(suf) && k.length - suf.length >= 3) return k.slice(0, -suf.length);
  }
  return k;
}

/**
 * 判定某个词段属于这个概念的哪一种写法。
 *
 * @param {string} key 已小写的词段
 * @param {Set<string>} canonicalSet
 * @param {Set<string>} forbiddenSet
 * @returns {null | {kind:'canonical'|'forbidden'|'variant', root:string}}
 */
export function classifySegment(key, canonicalSet, forbiddenSet) {
  // 屈折还原后比对：`rules` 与 `rule` 必须落到同一格，否则变体数被词形刷高。
  // `ruled` 单独看单词分不出是 `rule+d` 还是 `rul+ed`，所以**两个候选都试**，
  // 命中集合的那个才算 —— 判断依据来自配置，不来自词形猜测。
  const base = stem(key);
  const candidates = key.endsWith('ed') ? [base, `${base}e`] : [base];
  for (const k of candidates) {
    if (forbiddenSet.has(k)) return { kind: 'forbidden', root: k, key: k };
    if (canonicalSet.has(k)) return { kind: 'canonical', root: k, key: k };
  }
  const k = base;
  // 近义变体：与某个已列写法互为前缀，且长度差 ≤ 3（较短者至少 3 字符，否则 arch↔ar 这种会误连）
  for (const root of [...canonicalSet, ...forbiddenSet]) {
    if (root.length < 3 || k.length < 3) continue;
    if (Math.abs(k.length - root.length) > NEAR_LEN_TOLERANCE) continue;
    // ⚠️ 每个分支都必须带回 key：漏了它，调用方拿到的 key 是 undefined，
    // **所有近义变体会被挤进同一格**（Map 里只有一个 undefined）—— 那种错没有任何报错，
    // 表现为「明明有多种写法，变体数却总是 2」。修过一次，别再删。
    if (k.startsWith(root) || root.startsWith(k)) return { kind: 'variant', root, key: k };
  }
  return null;
}

/**
 * 单个写法的统计。
 * @typedef {{ variant:string, kind:'canonical'|'forbidden'|'variant', count:number, files:number, samples:{file:string,line:number}[] }} VariantOut
 */

/**
 * 一条检查项的结论。
 * @typedef {{ id:string|null, concept:string, type:string|null, report:'drift'|'block', scope:string,
 *   minVariants:number, matchedFiles:number, scannedFiles:number, variantCount:number,
 *   variants:VariantOut[], forbiddenCount:number,
 *   status:'clean'|'drift'|'forbidden-hit'|'no-files', blocking:boolean }} ItemOut
 */

/**
 * 扫描结果。
 * @typedef {{ items:ItemOut[], totals:{ items:number, scanned:number, drift:number,
 *   forbiddenHit:number, noFiles:number, clean:number, blocking:number } }} ConsistencyResult
 */

/**
 * 扫一批文件，对每个一致性检查项给出结论。
 *
 * @param {Object[]} items 章程的 `consistency[]`
 * @param {{path:string, content:string}[]} files 候选文件（path 用 POSIX 相对路径）
 * @param {{maxSamplesPerVariant?:number}} [opt]
 * @returns {ConsistencyResult}
 */
export function scanConsistency(items, files, opt = {}) {
  const maxSamples = opt.maxSamplesPerVariant ?? MAX_SAMPLES_PER_VARIANT;
  /** @type {Object[]} */
  const reports = [];

  for (const item of items || []) {
    const canonical = Array.isArray(item?.canonical) ? item.canonical : [];
    const forbidden = Array.isArray(item?.forbidden) ? item.forbidden : [];
    // 集合按屈折还原后的形态存（canonical 写 `Rules` 也能匹配到代码里的 `rule`）
    const canonicalSet = new Set(canonical.map((w) => stem(String(w).toLowerCase())));
    const forbiddenSet = new Set(forbidden.map((w) => stem(String(w).toLowerCase())));
    const roots = [...canonicalSet, ...forbiddenSet];
    // 预筛用**词根前缀**（前 3 字符）而不是整词：正式匹配认得近义变体（`Order` 的 `Ord`），
    // 预筛若比正式匹配还严格，就会把变体所在的文件整份漏掉 —— 那种漏法没有任何报错。
    const preRoots = [...new Set(roots.map((r) => (r.length > 3 ? r.slice(0, 3) : r)))];
    const minVariants = Number(item?.check?.minVariants ?? 0);
    const type = item?.check?.type;
    // 未知 type 必须炸，不能「跳过扫描」：跳过会得到 0 变体 = clean = 假绿。
    // 契约层已经保证过一次，这里再兜一次守的是「将来有人加了 type 却忘了写抽取规则」。
    if (!CONSISTENCY_TYPES.includes(type)) {
      throw new Error(
        `未知的 consistency check.type：${type}（${item?.id ?? '?'}）—— 契约允许 ${CONSISTENCY_TYPES.join(' / ')}`,
      );
    }
    const scopeRe = globToRegExp(String(item?.scope ?? '**'));

    const matched = (files || []).filter((f) => scopeRe.test(f.path));

    /** @type {Map<string, {variant:string, kind:string, count:number, files:Set<string>, samples:Object[]}>} */
    const variants = new Map();
    let scanned = 0;

    if (type && roots.length) {
      for (const f of matched) {
        const low = f.content.toLowerCase();
        // 预筛：整个文件一次 indexOf，比逐 token 切段快一个量级（全仓上千文件时的实际差别）
        if (!preRoots.some((r) => low.includes(r))) continue;
        scanned += 1;
        /** @type {Map<string, number>} */
        const perFile = new Map();
        for (const cand of extractCandidates(f.content, type)) {
          const cls = classifySegment(cand.seg.toLowerCase(), canonicalSet, forbiddenSet);
          if (!cls) continue;
          // 同一写法的多种词形归到一格（用归类时定下的 key），展示用首次出现的原文
          const key = cls.key;
          const seen = perFile.get(key) ?? 0;
          if (seen >= MAX_COUNT_PER_FILE_PER_VARIANT) continue;
          perFile.set(key, seen + 1);
          let v = variants.get(key);
          if (!v) {
            v = { variant: cand.seg, kind: cls.kind, count: 0, files: new Set(), samples: [] };
            variants.set(key, v);
          }
          v.count += 1;
          v.files.add(f.path);
          // kind 以「最严重」的归类为准（同一写法既在 canonical 又在 forbidden 时按 forbidden）
          if (cls.kind === 'forbidden' || (cls.kind === 'variant' && v.kind === 'canonical')) v.kind = cls.kind;
          if (v.samples.length < maxSamples) v.samples.push({ file: f.path, line: cand.line });
        }
      }
    }

    const list = [...variants.values()]
      .map((v) => ({
        variant: v.variant,
        kind: v.kind,
        count: v.count,
        files: v.files.size,
        samples: v.samples,
      }))
      .sort((a, b) => (a.kind === b.kind ? b.count - a.count : a.kind === 'forbidden' ? -1 : 1));

    const forbiddenHits = list.filter((v) => v.kind === 'forbidden');
    const drifted = list.length > minVariants;

    /** no-files 单独一种状态：**范围没扫到任何文件 = 这条检查是摆设**，必须说出来 */
    const status = matched.length === 0
      ? 'no-files'
      : forbiddenHits.length > 0
        ? 'forbidden-hit'
        : drifted
          ? 'drift'
          : 'clean';

    reports.push({
      id: item?.id ?? null,
      concept: item?.concept ?? '',
      type: type ?? null,
      report: item?.check?.report ?? 'drift',
      scope: item?.scope ?? '',
      minVariants,
      matchedFiles: matched.length,
      scannedFiles: scanned,
      variantCount: list.length,
      variants: list,
      forbiddenCount: forbiddenHits.length,
      status,
      blocking: status !== 'clean' && status !== 'no-files' && item?.check?.report === 'block',
    });
  }

  const totals = {
    items: reports.length,
    scanned: reports.reduce((n, r) => n + r.scannedFiles, 0),
    drift: reports.filter((r) => r.status === 'drift').length,
    forbiddenHit: reports.filter((r) => r.status === 'forbidden-hit').length,
    noFiles: reports.filter((r) => r.status === 'no-files').length,
    clean: reports.filter((r) => r.status === 'clean').length,
    blocking: reports.filter((r) => r.blocking).length,
  };

  return { items: reports, totals };
}

/**
 * 把结论渲染成 Markdown（债务账 / CI 输出用）。
 *
 * @param {{items:Object[], totals:Object}} result
 * @returns {string[]}
 */
export function renderConsistencyMarkdown(result) {
  const L = [];
  if (!result.items.length) return L;
  L.push('## 命名一致性（第五层 · 全仓聚合）');
  L.push('');
  L.push('| 检查项 | 概念 | 范围文件 | 写法数 | 结论 |');
  L.push('|---|---|---|---|---|');
  const label = {
    'no-files': '⚠ 范围没扫到文件（这条检查是摆设）',
    'forbidden-hit': '✗ 出现明令不许的写法',
    drift: '✗ 漂移',
    clean: '✓ 一致',
  };
  for (const r of result.items) {
    L.push(
      `| \`${r.id}\` | ${r.concept} | ${r.matchedFiles} | ${r.variantCount} / 上限 ${r.minVariants} | ${label[r.status] ?? r.status} |`,
    );
  }
  L.push('');
  for (const r of result.items) {
    if (r.status === 'clean') continue;
    L.push(`### \`${r.id}\` · ${r.concept}`);
    L.push('');
    if (r.status === 'no-files') {
      L.push(`- 范围 \`${r.scope}\` **没有匹配到任何文件** —— 这条检查当前没有在检查任何东西。`);
      continue;
    }
    for (const v of r.variants.slice(0, 20)) {
      const where = v.samples.map((s) => `${s.file}:${s.line}`).join('、');
      const tag = v.kind === 'forbidden' ? '**（明令不许）**' : v.kind === 'variant' ? '（变体）' : '';
      L.push(`- \`${v.variant}\`${tag} —— ${v.count} 处 / ${v.files} 个文件${where ? ` · 例如 ${where}` : ''}`);
    }
    L.push('');
  }
  return L;
}
