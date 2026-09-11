/**
 * 内容资产同步：arsenal-cookbook/**\/*.json + arsenal-stacks/*.json
 *                →  src/generated/{cookbook,stack}.json
 *
 * 与 sync-rules.mjs 同一套思路：JSON 是唯一数据源，前端只做一次编译期快照，
 * 不做任何二次加工。这样「人查 / 给 AI 用 / 拿代码验」三条出口读到的
 * 一定还是同一份内容。
 *
 * 差别在于本脚本承担更强的完整性校验 —— 蓝图的 highlights 用的是
 * 「片段锚点」而不是行号（见下方说明），锚点找不到目标就必须当场失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const root = path.resolve(webRoot, '..');
const outDir = path.resolve(webRoot, 'src', 'generated');

function fail(msg) {
  console.error(`\n[arsenal] 内容同步失败：${msg}\n`);
  process.exit(1);
}

function readJson(p) {
  if (!fs.existsSync(p)) fail(`找不到文件 ${p}`);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    fail(`${p} JSON 解析失败：${e.message}`);
  }
}

// ── ① 蓝图库 ────────────────────────────────────────────────
const cbDir = path.join(root, 'arsenal-cookbook');
const cbMeta = readJson(path.join(cbDir, 'meta.json'));

const features = [];
const cbProblems = [];

for (const id of cbMeta.order ?? []) {
  const doc = readJson(path.join(cbDir, `${id}.json`));
  const f = doc.feature;
  if (!f) cbProblems.push(`${id}.json 缺少 feature 字段`);

  const fileIds = new Set();
  const highlights = f.files.flatMap((file) => file.highlights ?? []);

  for (const file of f.files) {
    if (fileIds.has(file.id)) cbProblems.push(`${f.id} 内文件 id 重复：${file.id}`);
    fileIds.add(file.id);

    // 关键校验：highlights 用「片段锚点」定位，锚点必须真的存在于代码里。
    // 用锚点而不是行号，是为了让代码改动后备注不会错位到别的行上 ——
    // 错位的备注比没有备注更危险，它会给出一个自信的错误结论。
    for (const h of file.highlights ?? []) {
      if (!h.mark) {
        cbProblems.push(`${f.id}/${file.id} 有 highlight 缺少 mark 锚点`);
        continue;
      }
      if (!file.code.includes(h.mark)) {
        cbProblems.push(
          `${f.id}/${file.id} 锚点找不到目标：${JSON.stringify(h.mark.slice(0, 60))}`
        );
      }
    }
  }

  features.push({
    ...f,
    fileCount: f.files.length,
    highlightCount: highlights.length,
    ruleCount: new Set(f.relatedRules ?? []).size,
    lines: f.files.reduce((n, x) => n + x.code.split('\n').length, 0),
  });
}

if (cbProblems.length) fail(cbProblems.join('\n  - '));

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'cookbook.json'),
  JSON.stringify({ meta: cbMeta, features }, null, 2),
  'utf8'
);

const totalFiles = features.reduce((n, f) => n + f.fileCount, 0);
const totalHighlights = features.reduce((n, f) => n + f.highlightCount, 0);
const totalLines = features.reduce((n, f) => n + f.lines, 0);
console.log(
  `[arsenal] 已同步 ${features.length} 个蓝图 → src/generated/cookbook.json\n` +
  `         ${totalFiles} 个文件 / ${totalLines} 行代码 / ${totalHighlights} 条要点备注（锚点全部命中）`
);

// ── ② 技术选型 ──────────────────────────────────────────────
const stackDoc = readJson(path.join(root, 'arsenal-stacks', 'stack.json'));
fs.writeFileSync(
  path.join(outDir, 'stack.json'),
  JSON.stringify(stackDoc, null, 2),
  'utf8'
);

const dims = stackDoc.dimensions ?? [];
const optCount = dims.reduce((n, d) => n + d.options.length, 0);
const withDeps = dims.reduce(
  (n, d) => n + d.options.filter((o) => (o.dependencies ?? []).length > 0).length,
  0
);
const withConfig = dims.reduce(
  (n, d) => n + d.options.filter((o) => (o.configClasses ?? []).length > 0).length,
  0
);
console.log(
  `[arsenal] 已同步 ${dims.length} 个选型维度 → src/generated/stack.json\n` +
  `         ${optCount} 个选项（${withDeps} 个带依赖声明 / ${withConfig} 个带配置类）` +
  `｜${(stackDoc.presets ?? []).length} 套预设`
);

// ── ③ 架构装配图 ────────────────────────────────────────────
// 生成器（tools/build-content.py）已经校验过一遍；这里再独立校验一次，
// 因为它守的是一条硬底线：**用户随手拼出来的组合，必须存在可运行解**。
// 只要有一条 requires 无人能提供，界面就会永远显示「跑不起来」。
const archDoc = readJson(path.join(root, 'arsenal-stacks', 'architecture.json'));
const archProblems = [];

const optIndex = new Map(
  dims.map((d) => [d.id, new Set(d.options.map((o) => o.id))])
);
const capIds = new Set(Object.keys(archDoc.capNames ?? {}));
const provided = new Set();

for (const [dim, opts] of Object.entries(archDoc.options ?? {})) {
  if (!optIndex.has(dim)) archProblems.push(`架构图引用了不存在的维度 ${dim}`);
  for (const [oid, spec] of Object.entries(opts)) {
    if (optIndex.has(dim) && !optIndex.get(dim).has(oid)) {
      archProblems.push(`架构图引用了不存在的选项 ${dim}/${oid}`);
    }
    for (const c of [...(spec.provides ?? []), ...(spec.requires ?? [])]) {
      if (!capIds.has(c)) archProblems.push(`${dim}/${oid} 引用了未登记的能力 ${c}`);
    }
    for (const c of spec.provides ?? []) provided.add(c);
  }
}
for (const [dim, opts] of Object.entries(archDoc.options ?? {})) {
  for (const [oid, spec] of Object.entries(opts)) {
    for (const c of spec.requires ?? []) {
      if (!provided.has(c)) {
        archProblems.push(`${dim}/${oid} 索要能力 ${c}，但无人能提供`);
      }
    }
  }
}
for (const dim of Object.keys(archDoc.nodes ?? {})) {
  if (!optIndex.has(dim)) archProblems.push(`架构图节点 ${dim} 无对应维度`);
}

if (archProblems.length) fail(archProblems.join('\n  - '));

fs.writeFileSync(
  path.join(outDir, 'architecture.json'),
  JSON.stringify(archDoc, null, 2),
  'utf8'
);

const laneCount = (archDoc.lanes ?? []).length;
const nodeCount = Object.keys(archDoc.nodes ?? {}).length;
const policyByLevel = (archDoc.policies ?? []).reduce((acc, p) => {
  acc[p.level] = (acc[p.level] ?? 0) + 1;
  return acc;
}, {});
const requiredCount = Object.values(archDoc.nodes ?? {}).filter((n) => n.required).length;
console.log(
  `[arsenal] 已同步架构装配图 → src/generated/architecture.json\n` +
  `         ${laneCount} 条泳道 / ${nodeCount} 个槽位（${requiredCount} 个必选）` +
  ` / ${capIds.size} 项能力 / ${(archDoc.policies ?? []).length} 条组合策略` +
    `（跑不起来 ${policyByLevel.blocker ?? 0} / 风险 ${policyByLevel.risk ?? 0} / 提示 ${policyByLevel.note ?? 0}）`
);

// ── ④ 项目结构层 ────────────────────────────────────────────
// 这里守的是一条很容易被忽略的底线：**结构树和选型数据必须是同一套事实**。
// 目录树里画了 MybatisPlusConfig，选型数据里就得真有它；
// 选型产出了 RedisConfig，树里就得有它的位置。
// 两边一旦脱节，界面上看起来毫无异样，照着建出来的目录却是错的。
const projDoc = readJson(path.join(root, 'arsenal-stacks', 'project.json'));
const projProblems = [];

const checkCond = (cond, where) => {
  for (const [dim, opts] of Object.entries(cond ?? {})) {
    if (!optIndex.has(dim)) {
      projProblems.push(`${where} 引用了不存在的维度 ${dim}`);
      continue;
    }
    for (const o of opts) {
      if (!optIndex.get(dim).has(o)) {
        projProblems.push(`${where} 引用了不存在的选项 ${dim}/${o}`);
      }
    }
  }
};

// 只认带真实路径的配置类：有些 configClasses 的 path 写的是「用法示例」说明文字，
// 它们不落在磁盘上，不该被要求出现在目录树里，也不该被导出。
const realConfigClasses = new Set();
for (const d of dims) {
  for (const o of d.options) {
    for (const c of o.configClasses ?? []) {
      if ((c.path ?? '').endsWith('.java')) realConfigClasses.add(c.className);
    }
  }
}

const EXEMPT_BADGES = new Set(['所有项目', '可选', '导出附带']);
let projDirs = 0;
let projFiles = 0;

const walkTree = (nodes, prefix) => {
  for (const n of nodes ?? []) {
    const here = prefix ? `${prefix}/${n.name}` : n.name;
    checkCond(n.when, `结构树节点 ${here}`);
    if (n.kind === 'dir') {
      projDirs += 1;
      if (!n.name.endsWith('/')) projProblems.push(`目录节点 ${here} 名字缺少结尾斜杠`);
      if (!(n.children ?? []).length) projProblems.push(`目录节点 ${here} 没有任何子节点`);
      walkTree(n.children, here.replace(/\/$/, ''));
    } else {
      projFiles += 1;
      if (!n.desc) projProblems.push(`结构树文件 ${here} 没有职责说明`);
      if (
        n.badge && !EXEMPT_BADGES.has(n.badge) &&
        n.name.endsWith('.java') && here.includes('/config/')
      ) {
        const cls = n.name.slice(0, -5);
        if (!realConfigClasses.has(cls)) {
          projProblems.push(
            `结构树 ${here} 标了来源「${n.badge}」，但没有任何选型产出这个配置类`
          );
        }
      }
    }
  }
};
walkTree(projDoc.tree?.children ?? [], '');

const treeText = JSON.stringify(projDoc.tree ?? {});
for (const cls of realConfigClasses) {
  if (!treeText.includes(`${cls}.java`)) {
    projProblems.push(`选型数据产出了配置类 ${cls}，但结构树里没有它的位置`);
  }
}

for (const a of projDoc.appAnnotations ?? []) {
  checkCond(a.when, `启动类注解 ${a.code}`);
  if (!a.import) projProblems.push(`启动类注解 ${a.code} 没有声明 import`);
}
for (const s of projDoc.switchOwners ?? []) {
  checkCond(s.when, `开关归属 ${s.switch}`);
  if (!s.owner || !s.why) projProblems.push(`开关归属 ${s.switch} 缺少归属方或作用说明`);
}

const templateChecks = [
  ['README 模板', projDoc.files?.readmeTemplate ?? '',
    ['__SELECTION_TABLE__', '__TREE__', '__START__', '__RISKS__', '__DANGLING__', '__FILES__']],
  ['启动类模板', projDoc.appTemplate ?? '',
    ['__IMPORTS__', '__SWITCHES__', '__ANNOTATIONS__']],
];
for (const [label, tpl, known] of templateChecks) {
  const found = [...new Set(tpl.match(/__[A-Z_]+__/g) ?? [])];
  const unknown = found.filter((x) => !known.includes(x));
  const missing = known.filter((x) => !found.includes(x));
  if (unknown.length) projProblems.push(`${label} 里有前端不会替换的占位符：${unknown.join('、')}`);
  if (missing.length) projProblems.push(`${label} 缺少占位符：${missing.join('、')}`);
}

if (projProblems.length) fail(projProblems.join('\n  - '));

fs.writeFileSync(
  path.join(outDir, 'project.json'),
  JSON.stringify(projDoc, null, 2),
  'utf8'
);

const switchCount = (projDoc.switchOwners ?? []).length;
console.log(
  `[arsenal] 已同步项目结构层 → src/generated/project.json\n` +
  `         ${projDirs} 个目录 / ${projFiles} 个文件节点 / ${switchCount} 条开关归属` +
  `｜结构树与选型数据交叉校验通过（${realConfigClasses.size} 个配置类全部有落位）`
);
