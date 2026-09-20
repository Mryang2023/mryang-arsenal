/**
 * 数据同步：arsenal-rules  →  src/generated/
 *
 *   arsenal-rules/**\/*.json   →  src/generated/rules.json        （规则集）
 *   arsenal-rules/mcp-tools.json → src/generated/mcp-tools.json   （MCP 工具定义）
 *
 * 为什么要有这一步：
 * arsenal-rules 是唯一数据源（source of truth，Git 化、后端/前端/导出器共读）。
 * 前端不重新定义任何规则，只做一次「编译期快照」，从而保证「一份数据三种出口」
 * 里的任何一条路径都不可能漂移。
 *
 * 在 npm run dev / build 之前自动执行（见 package.json 的 pre* 钩子）。
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const rulesRoot = path.resolve(webRoot, '..', 'arsenal-rules');
const outDir = path.resolve(webRoot, 'src', 'generated');
const outFile = path.join(outDir, 'rules.json');

const severityWeight = { MUST: 3, NEVER: 3, SHOULD: 2, MAY: 1 };

function fail(msg) {
  console.error(`\n[arsenal] 规则同步失败：${msg}\n`);
  process.exit(1);
}

if (!fs.existsSync(rulesRoot)) {
  fail(`找不到规则目录 ${rulesRoot}`);
}

const metaPath = path.join(rulesRoot, 'meta.json');
if (!fs.existsSync(metaPath)) fail('缺少 meta.json');
const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

// ---- 遍历九大分类目录，聚合规则 ----
const rules = [];
const categoryFiles = new Map(); // category -> [文件名]

for (const cat of meta.categories ?? []) {
  const dir = path.join(rulesRoot, cat.dir);
  if (!fs.existsSync(dir)) continue;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();

  categoryFiles.set(cat.key, files.map((f) => `${cat.dir}/${f}`));

  for (const f of files) {
    const full = path.join(dir, f);
    const doc = JSON.parse(fs.readFileSync(full, 'utf8'));
    for (const rule of doc.rules ?? []) {
      rules.push({ ...rule, _sourceFile: `${cat.dir}/${f}` });
    }
  }
}

// ---- 完整性校验：宁可构建失败，也不要静默少几条规则 ----
const ids = new Set();
const required = [
  'id', 'category', 'title', 'severity', 'sources', 'rationale',
  'bad', 'good', 'check', 'promptFragment', 'status', 'version',
];
const problems = [];

for (const r of rules) {
  if (ids.has(r.id)) problems.push(`ID 重复：${r.id}`);
  ids.add(r.id);
  for (const k of required) {
    if (r[k] === undefined || r[k] === null || r[k] === '') {
      problems.push(`${r.id} 缺少字段 ${k}`);
    }
  }
  if (!Array.isArray(r.sources) || r.sources.length === 0) {
    problems.push(`${r.id} 无来源出处（军火库原则：无出处不收录）`);
  }
}
if (problems.length) fail(problems.join('\n  - '));

// ---- 统计 ----
const bySeverity = {};
const byCategory = {};
let promptChars = 0;

for (const r of rules) {
  bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
  byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
  promptChars += (r.promptFragment ?? '').length;
}

const mustClass = (bySeverity.MUST ?? 0) + (bySeverity.NEVER ?? 0);
const limit = meta.budget?.mustHardLimit ?? 50;

/**
 * meta.json → 前端可见的 meta。
 *
 * 刻意是白名单而不是 `{...meta}` 展开：后端能从磁盘读全文，前端只该拿到
 * 它真正会渲染的字段，别的别跟着一起进包。
 *
 * 但白名单有个致命坏处 —— **漏一个字段是静默的**。`sourceTypes` 就真的漏过：
 * meta.json 里加了它、后端 RulesetMeta 也映射了，唯独这里没透传，
 * 于是「同一份映射两端共读」只成立了一半，前端只能靠 theme.ts 里那份副本兜着。
 * 所以下面加了 `assertMetaAccounted`：meta.json 里出现白名单外的键就**构建失败**，
 * 逼人显式回答「这个字段前端要不要」。
 */
const META_PASSTHROUGH = [
  'ruleset', 'name', 'codename', 'version', 'releasedAt', 'description',
  'targetStack', 'severityPolicy', 'budget', 'sourceRegistry', 'sourceTypes',
  'categories', 'changelog',
];

/** 明确「前端不需要」的键。写在这里是为了让上面的断言能给出确定的答案。 */
const META_IGNORED = ['$schema', '$comment'];

function assertMetaAccounted(m) {
  const known = new Set([...META_PASSTHROUGH, ...META_IGNORED]);
  const unaccounted = Object.keys(m).filter((k) => !known.has(k));
  if (unaccounted.length) {
    fail(
      `meta.json 里有未处理的字段：${unaccounted.join('、')}\n` +
      `  要么加进 sync-rules.mjs 的 META_PASSTHROUGH（前端要用），\n` +
      `  要么加进 META_IGNORED（确认前端不需要）。\n` +
      `  不声明的字段会被静默丢掉 —— sourceTypes 就这么漏过一次。`
    );
  }
}
assertMetaAccounted(meta);

/**
 * MCP 工具定义同步：arsenal-rules/mcp-tools.json → src/generated/mcp-tools.json
 *
 * 为什么单独一个文件而不是塞进 rules.json：它是「协议适配层」的数据，不是规则数据。
 * 混进 rules.json 会让「规则集」这个出口多出与规则无关的字段，
 * 而 `json` 载体是要逐字段跟后端对齐的 —— 多一个键就要多解释一次。
 *
 * 校验放在这里而不是靠人眼：工具名重复、缺 inputSchema、launcher 少 command，
 * 这类问题在运行时表现为「AI 客户端连不上/调不通」，排查成本远高于构建期报错。
 */
const mcpPath = path.join(rulesRoot, 'mcp-tools.json');
if (!fs.existsSync(mcpPath)) fail('缺少 arsenal-rules/mcp-tools.json —— MCP 工具定义是导出与适配层共读的数据源');
const mcp = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));

const mcpProblems = [];
if (!mcp.server?.name) mcpProblems.push('server.name 缺失');
if (!mcp.launcher?.command) mcpProblems.push('launcher.command 缺失');
if (!Array.isArray(mcp.tools) || mcp.tools.length === 0) mcpProblems.push('tools 为空');
const toolNames = new Set();
for (const t of mcp.tools ?? []) {
  if (!t.name) mcpProblems.push('tools[] 存在缺少 name 的条目');
  else if (toolNames.has(t.name)) mcpProblems.push(`工具名重复：${t.name}`);
  toolNames.add(t.name);
  if (!t.description) mcpProblems.push(`工具 ${t.name} 缺少 description（AI 靠它决定调不调）`);
  if (!t.inputSchema) mcpProblems.push(`工具 ${t.name} 缺少 inputSchema`);
}
if (mcpProblems.length) fail(`mcp-tools.json 校验未通过：\n  - ${mcpProblems.join('\n  - ')}`);

fs.mkdirSync(outDir, { recursive: true });
const mcpOut = path.join(outDir, 'mcp-tools.json');
fs.writeFileSync(mcpOut, JSON.stringify(mcp, null, 2), 'utf8');

const payload = {
  generatedAt: new Date().toISOString(),
  meta: Object.fromEntries(META_PASSTHROUGH.map((k) => [k, meta[k]])),
  stats: {
    total: rules.length,
    bySeverity,
    byCategory,
    mustClass,
    mustHardLimit: limit,
    budgetUsedPct: Math.round((mustClass / limit) * 100),
    promptChars,
    promptTokensEstimate: Math.round(promptChars / 1.6), // 中文约 1.6 字符/token
    categoryFiles: Object.fromEntries(categoryFiles),
  },
  rules: rules.map((r) => ({
    ...r,
    _weight: severityWeight[r.severity] ?? 1,
    _hasStaticCheck: Boolean(r.check?.regex || r.check?.ast),
    _checkLayer: r.check?.regex ? 'regex' : r.check?.ast ? 'ast' : r.check?.llm ? 'llm' : 'manual',
  })),
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8');

const rel = path.relative(webRoot, outFile).replace(/\\/g, '/');
console.log(
  `[arsenal] 已同步 ${rules.length} 条规则 → ${rel}\n` +
  `         强制级 ${mustClass}/${limit}（预算用掉 ${payload.stats.budgetUsedPct}%）` +
  `｜提示词 ${payload.stats.promptChars} 字符 ≈ ${payload.stats.promptTokensEstimate} tokens\n` +
  `         MCP 工具 ${mcp.tools.length} 个 → ${path.relative(webRoot, mcpOut).replace(/\\/g, '/')}`
);
