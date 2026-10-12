/**
 * 解剖台快照存放 —— 与 `charter-dir.mjs` 同构的三档目录 + 落盘读写。
 *
 * ★ 为什么必须抽成单独一份目录裁决函数（照抄 charter-dir.mjs 的理由，一字不改也适用）：
 *   三档优先级一旦内联在调用方里，断言层就只能对着源码文本猜它怎么选 ——
 *   「改了 env 却没换目录」这种错会在全链全绿的情况下一直活着。本仓已经为
 *   「同一规矩各内联一份」付过三次学费（sync 的 cookbook 段、project-check【13】、
 *   charter-dir 本身），这是第四次。
 *
 * 三档优先级（后者覆盖前者）：
 *   1. 默认 `<webRoot>/.data/autopsy/`
 *   2. `arsenal.json` 的 `project.autopsyDir`（相对仓库根解析）
 *   3. 环境变量 `ARSENAL_AUTOPSY_DIR`
 *
 * ★ 它和浏览器的关系要说清楚（这是本棒最大的结构性取舍，别让人以为漏了做前端）：
 *   本站是 `output:'export'` 的**静态导出站**，没有 Node 服务端，所以页面
 *   **看不到也写不到这块磁盘目录**。浏览器那份快照走 localStorage
 *   （与 `src/app/arch/profile-store.ts` 同一条规矩：别的项目的资料不进军火库仓库）。
 *   两条路共用**同一份形状校验**（`autopsy-snapshot-shape.mjs`，零 node 依赖），
 *   于是「什么样算坏快照」这个口径只有一处 —— 这是刻意的：宁可两个运行时各存一份，
 *   也不许校验口径出现第二份。
 *
 * @module autopsy-store
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  SNAPSHOT_SCHEMA_VERSION,
  snapshotShapeIssues,
  safeFileId,
} from './autopsy-snapshot-shape.mjs';

/** @typedef {1|2|3} AutopsyDirTier 1=内置默认 2=档案声明 3=环境变量 */

/**
 * @typedef {Object} AutopsyDirResolution
 * @property {string} dir    解析后的绝对路径
 * @property {string} raw    生效的原始值（未经 path.resolve）
 * @property {string} source 人读的来源标签
 * @property {AutopsyDirTier} tier 实际命中的档位
 */

/** 空串与纯空白一律视作「没配」—— 与 charter-dir.mjs 同一条 ★ 规矩，别改口径。 */
function usable(v) {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * 三档目录裁决。**入参是 `webRoot`（不是 repoRoot）**：
 * 默认值长在 `arsenal-web/.data/autopsy/` 下，而这一层是前端自己的事。
 *
 * @param {Object} args
 * @param {string} args.webRoot `arsenal-web/` 的绝对路径
 * @param {Record<string, string|undefined>} [args.env] 默认 `process.env`
 * @param {string|null} [args.profileAutopsyDir] 档案里 `project.autopsyDir` 的值
 * @param {string} [args.repoRoot] 仓库根，档案里写相对路径时按它解析（默认 webRoot 的上级）
 * @returns {AutopsyDirResolution}
 */
export function resolveAutopsyDir({
  webRoot,
  env,
  profileAutopsyDir = null,
  repoRoot = path.resolve(webRoot, '..'),
}) {
  const e = env ?? process.env;
  const fromEnv = usable(e.ARSENAL_AUTOPSY_DIR);
  const fromProfile = usable(profileAutopsyDir);
  // 判据必须写 `!== null` 而不是真值 —— 同 charter-dir.mjs 的注释：
  // 守「空串退档」的只能有一个地方，让 usable 独占，别让 `if (fromEnv)` 顺手代劳。
  if (fromEnv !== null) {
    return {
      dir: path.resolve(repoRoot, fromEnv),
      raw: fromEnv,
      source: '环境变量 ARSENAL_AUTOPSY_DIR',
      tier: 3,
    };
  }
  if (fromProfile !== null) {
    return {
      dir: path.resolve(repoRoot, fromProfile),
      raw: fromProfile,
      source: 'arsenal.json#project.autopsyDir',
      tier: 2,
    };
  }
  return {
    dir: path.join(webRoot, '.data', 'autopsy'),
    raw: '.data/autopsy',
    source: '内置默认',
    tier: 1,
  };
}

/**
 * 读档案里的 `project.autopsyDir`（读不到就当没配）。
 *
 * @param {string} profilePath
 * @returns {string|null}
 */
export function readProfileAutopsyDir(profilePath) {
  try {
    return JSON.parse(fs.readFileSync(profilePath, 'utf8'))?.project?.autopsyDir ?? null;
  } catch {
    return null;
  }
}

/** 快照文件名 —— 扁平存放，用 projectId 前缀区分项目，避免目录嵌套带来的 listing 分支逻辑。 */
function fileNameOf(snapshot) {
  return `${safeFileId(snapshot.projectId)}__${safeFileId(snapshot.snapshotId)}.json`;
}

/**
 * 存一份快照。**写之前挡一次形状** —— 存的时候不挡，读的每一处都要各挡一次，
 * 而漏掉一处就是一个白屏（`profile-store.ts` 顶部注释就是为同一件事写的：
 * 一份坏掉的档案不该让整个页面消失）。
 *
 * @param {Object} args
 * @param {string} args.dir 已裁决好的目录
 * @param {Record<string, any>} args.snapshot
 * @param {string} [args.toolVersion] 缺失时由本函数补上，不静默留空
 * @returns {{ok: boolean, file?: string, issues: string[]}}
 */
export function saveSnapshot({ dir, snapshot, toolVersion = '0.1.0' }) {
  const doc = {
    ...snapshot,
    schemaVersion: snapshot.schemaVersion ?? SNAPSHOT_SCHEMA_VERSION,
    snapshotId: snapshot.snapshotId ?? newId(),
    toolVersion: snapshot.toolVersion ?? toolVersion,
  };
  const issues = snapshotShapeIssues(doc);
  if (issues.length > 0) return { ok: false, issues };
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, fileNameOf(doc));
  // newline 由 JSON.stringify 决定（无 \n），落盘统一 LF —— 本仓所有 JSON 一条口径
  fs.writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  return { ok: true, file, issues: [] };
}

/**
 * 列快照。**损坏的不混进正常列表，也不整层报错** ——
 * 「这份快照坏了」与「没有快照」在页面上必须说两句不同的话。
 *
 * @param {Object} args
 * @param {string} args.dir
 * @param {string} [args.projectId] 只列某个项目
 * @returns {{snapshots: Array<Record<string, any>>, damaged: Array<{file: string, issues: string[]}>, total: number}}
 */
export function listSnapshots({ dir, projectId = null }) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    // 目录还不存在 = 还没存过，这不是错误
    return { snapshots: [], damaged: [], total: 0 };
  }
  if (projectId) names = names.filter((n) => n.startsWith(`${safeFileId(projectId)}__`));

  const snapshots = [];
  const damaged = [];
  for (const n of names) {
    const file = path.join(dir, n);
    let doc = null;
    try {
      doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      damaged.push({ file: n, issues: [`不是合法 JSON：${/** @type {Error} */ (err).message}`] });
      continue;
    }
    const issues = snapshotShapeIssues(doc);
    if (issues.length > 0) damaged.push({ file: n, issues });
    else snapshots.push(doc);
  }
  snapshots.sort((a, b) => String(b.snapshotId).localeCompare(String(a.snapshotId)));
  return { snapshots, damaged, total: snapshots.length + damaged.length };
}

/**
 * 取某个项目最新的那一份（「最新」按 snapshotId 排序 —— 它本身就是时间串）。
 * 损坏的那份**不当最新返回**：那会让 L1 拿着一个坏快照说「没变化」。
 *
 * @param {Object} args
 * @param {string} args.dir
 * @param {string} args.projectId
 * @returns {Record<string, any>|null}
 */
export function loadLatest({ dir, projectId }) {
  const { snapshots } = listSnapshots({ dir, projectId });
  return snapshots.length > 0 ? snapshots[0] : null;
}

/** 生成一个新的快照 id：`20261012T032500Z`。
 *  毫秒特意去掉 —— 与浏览器侧 `newSnapshotId()` 同形，两个运行时不要长出两种 id 形态。 */
export function newId(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

// ── CLI ─────────────────────────────────────────────────────
// 只在被当命令跑时进 —— 断言层会 import 上面的纯函数，
// 若这里无条件执行，import 一下就连带跑一遍并 process.exit（本仓为这个形状付过学费）。
const invokedDirectly =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href;

function main(argv) {
  const cmd = argv[2] ?? 'list';
  const webRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
  const repoRoot = path.resolve(webRoot, '..');
  const r = resolveAutopsyDir({
    webRoot,
    repoRoot,
    profileAutopsyDir: readProfileAutopsyDir(path.join(repoRoot, 'arsenal-profiles', 'arsenal.json')),
  });
  if (cmd === 'dir') {
    console.log(`${r.dir}\t[${r.source} / tier ${r.tier}]`);
    return 0;
  }
  if (cmd === 'list') {
    const pidFlag = argv.indexOf('--project');
    const projectId = pidFlag >= 0 ? argv[pidFlag + 1] : null;
    const { snapshots, damaged, total } = listSnapshots({ dir: r.dir, projectId });
    console.log(`目录: ${r.dir}  (${r.source})`);
    console.log(`快照 ${snapshots.length} 份 / 损坏 ${damaged.length} 份 / 合计 ${total}`);
    for (const s of snapshots) {
      const v = s.verdict ?? {};
      console.log(
        `  ${s.snapshotId}  ${String(s.fingerprint ?? '').slice(0, 8)}  ` +
          `P0 ${v.p0 ?? 0} / P1 ${v.p1 ?? 0} / other ${v.other ?? 0} / 观察 ${v.obs ?? 0}  ` +
          `覆盖 ${s.coverage?.executed ?? 0}/${s.coverage?.total ?? 0}  ${s.root ?? ''}`
      );
    }
    for (const d of damaged) console.log(`  [损坏] ${d.file} —— ${d.issues.join('；')}`);
    return 0;
  }
  console.error(`未知子命令: ${cmd}（可用: dir / list [--project <projectId>]）`);
  return 1;
}

if (invokedDirectly) process.exit(main(process.argv));
