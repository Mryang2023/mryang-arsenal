/**
 * 解剖台快照的形状 —— **浏览器与 Node 共用这一份**。
 *
 * ★ 为什么不放在 `autopsy-store.mjs` 里：那个文件 `import node:fs`，
 *   一旦被 `src/**` 里的客户端组件 import，webpack 打包浏览器 bundle 时
 *   `node:fs` 没有 polyfill，整页构建会挂。所以「纯粹的形状校验」单独站一个文件，
 *   **这个文件不许出现任何 `node:` 前缀的 import** —— 一旦出现，
 *   /autopsy 页面会以一种看起来完全不相干的方式红掉。
 *
 * ★ 为什么不写成 TypeScript interface：interface 只在编译期存在，管不住
 *   「用户手改过 localStorage」和「落盘 JSON 被人编辑过」这两条路。
 *   本仓上一晚刚吃过「两种运行时各写一份判定」的亏（章程层 CI 执行器 vs 校验台），
 *   这里直接断根：只有一份能跑的形状校验。
 */

/** 当前快照格式版本。形状变了就 +1，旧版本读的时候会被判「格式不认识」而不是「坏了」。 */
export const SNAPSHOT_SCHEMA_VERSION = 1;

/** 允许的来源类型 —— 写死在这里，让「kind 写错」在存的时候就被挡住。 */
export const SOURCE_KINDS = ['path', 'git'];

/** 文件名安全化：projectId / snapshotId 会进文件名，Windows 与 Linux 的禁字符都得剔。 */
export function safeFileId(s) {
  const t = String(s ?? '').replace(/[^\w.-]+/g, '_').slice(0, 64);
  return t === '' ? 'unknown' : t;
}

/**
 * 项目身份：**两个运行时共用的唯一一份算法**。
 *
 * ★ 为什么不各算各的（这是 2026-10-12 棒 3 实测抓出来的真缺陷）：
 *   原先 Node 侧 `autopsy-fingerprint.mjs` 用 sha256(`${kind}\0${value}`)，
 *   浏览器侧用 FNV-1a —— 于是**同一份输入有两个 id**。后果不是「名字不好看」，是
 *   `autopsy-store.mjs` 按 Node 侧 id 去过滤落盘文件，而文件是按快照自带的浏览器侧
 *   id 命名的 → `listSnapshots({projectId})` **永远查不到任何东西**（实测 10-5/10-6 红：
 *   `listed=0`）。而它红之前，页面上是「这个地址还没有任何快照」——
 *   一句完全正确、也完全误导的话。
 *
 * 用 FNV-1a 64（BigInt）而不是 sha256：浏览器没有同步的 node:crypto，
 * 而 64 位对「一台机器上扫过的项目数」足够 —— 它不是安全用途，
 * 碰撞代价只是两个项目共用一份历史。
 *
 * @param {string} sourceKind 'path' | 'git'
 * @param {string} value 原始输入（会 trim）
 * @returns {string}
 */
export function projectIdOf(sourceKind, value) {
  const s = `${String(sourceKind)}:${String(value ?? '').trim()}`;
  let h = 0xcbf29ce484222325n; // FNV-1a 64 offset basis
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < s.length; i += 1) {
    h = ((h ^ BigInt(s.charCodeAt(i))) * prime) & mask;
  }
  return `pj-${h.toString(16).padStart(16, '0')}`;
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function nonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

function isInt(v) {
  return typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0;
}

/**
 * 校验一份快照。**返回空数组才算能用。**
 *
 * 每一条 Issue 都是人读的中文 —— 它们会直接显示在页面上
 * （「这份快照坏了：`缺少 verdict.p0`」比一句笼统的「读取失败」有用得多）。
 *
 * 一致性也是形状的一部分：`verdict.p0` 写着 12，而 `report.p0` 只有 11 条，
 * 那这份快照就是被改过的 —— 这种不一致必须报出来，不能放任它进历史列表。
 *
 * @param {unknown} doc
 * @returns {string[]} 空数组 = 形状没问题
 */
export function snapshotShapeIssues(doc) {
  const out = [];
  if (!isPlainObject(doc)) return ['快照不是一个对象'];

  if (doc.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    out.push(
      `schemaVersion 是 ${JSON.stringify(doc.schemaVersion)}，本版只认 ${SNAPSHOT_SCHEMA_VERSION}` +
        `（这份快照是别的版本写的，不是坏了 —— 升级工具或重扫一次）`
    );
  }
  if (!nonEmptyString(doc.snapshotId)) out.push('缺少 snapshotId');
  if (!nonEmptyString(doc.projectId)) out.push('缺少 projectId');

  // source 单独成对象：只有 value 的话无法区分「本地目录叫 a」和「git 地址含 a」
  const src = doc.source;
  if (!isPlainObject(src) || !nonEmptyString(src.kind) || !nonEmptyString(src.value)) {
    out.push('缺少 source（需要 { kind: path|git, value }）');
  } else if (!SOURCE_KINDS.includes(src.kind)) {
    out.push(`source.kind 是 ${JSON.stringify(src.kind)}，只能是 ${SOURCE_KINDS.join(' / ')}`);
  }

  if (!nonEmptyString(doc.fingerprint)) out.push('缺少 fingerprint');
  if (!nonEmptyString(doc.root)) out.push('缺少 root（扫描根目录名）');
  if (!nonEmptyString(doc.savedAt)) out.push('缺少 savedAt');

  const v = doc.verdict;
  if (!isPlainObject(v)) {
    out.push('缺少 verdict');
  } else {
    for (const k of ['p0', 'p1', 'other', 'obs']) {
      if (!isInt(v[k])) out.push(`verdict.${k} 不是非负整数（实际 ${JSON.stringify(v[k])}）`);
    }
  }

  // verdict 与 report 互证：两者对不上说明这份快照被人动过，或者写它的那一版有 bug
  const rep = doc.report;
  if (!isPlainObject(rep)) {
    out.push('缺少 report（体检报告原文 —— 没有它就无从对照，快照只是一串数字）');
  } else if (isPlainObject(v)) {
    for (const k of ['p0', 'p1', 'other']) {
      if (Array.isArray(rep[k]) && isInt(v[k]) && rep[k].length !== v[k]) {
        out.push(`verdict.${k}=${v[k]} 与 report.${k} 实际 ${rep[k].length} 条对不上`);
      }
    }
  }

  return out;
}
