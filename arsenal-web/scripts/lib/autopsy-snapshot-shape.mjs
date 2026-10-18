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
 * 用**同步的纯 JS SHA-256**（**不 import node:crypto** —— 本文件会被浏览器 bundle 引用，
 * node: 前缀 import 会让打包挂掉，见文件头注释）。输出取前 12 位十六进制，
 * 与后端 {@code ProjectIds.projectIdOf}（com.arsenal.projects）**逐字节一致**
 * （固定向量见 arsenal-web/.verify/project-check.ts 的【31】断言，对拍用 node:crypto 反算）。
 *
 * 为什么不用 FNV-1a：两个运行时各算一份曾经产出两个 id（计划 D6 暗伤），
 * 现在统一到后端那一份 sha256-12。浏览器没有同步的 crypto.subtle，所以手写一份纯 JS 实现。
 *
 * @param {string} sourceKind 'path' | 'git'
 * @param {string} value 原始输入（会 trim，反斜杠转正斜杠，去尾斜杠 —— 与后端规范化同形）
 * @returns {string} 12 位十六进制，如 a1b2c3d4e5f6
 */
export function projectIdOf(sourceKind, value) {
  const s = `${String(sourceKind)}:${String(value ?? '').trim().replace(/\\/g, '/').replace(/\/+$/, '')}`;
  const bytes = new TextEncoder().encode(s);
  return sha256hex(bytes).slice(0, 12);
}

/**
 * 纯 JS SHA-256（无 node: 依赖，浏览器/Node 通用）。输入 UTF-8 字节，返回小写 32 位十六进制。
 * 标准实现，与 Java {@code MessageDigest.getInstance("SHA-256")} 输出一致。
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function sha256hex(bytes) {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const l = bytes.length;
  const withOne = l + 1;
  const k = (56 - (withOne % 64) + 64) % 64;
  const total = withOne + k + 8;
  const m = new Uint8Array(total);
  m.set(bytes);
  m[l] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 4, l * 8 >>> 0, false);
  dv.setUint32(total - 8, Math.floor((l * 8) / 0x100000000), false);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    const w = new Uint32Array(64);
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, hh = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + hh) | 0;
  }
  const out = new DataView(new ArrayBuffer(32));
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((hv, i) => out.setUint32(i * 4, hv >>> 0, false));
  let hex = '';
  for (let i = 0; i < 32; i++) hex += out.getUint8(i).toString(16).padStart(2, '0');
  return hex;
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
