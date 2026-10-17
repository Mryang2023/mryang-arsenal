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

import { detectSchemaDrift } from './lib/rule-schema.mjs';
import { formatDiagnostics, validateRuleSet } from './lib/validate-rules.mjs';

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
const ruleDocs = []; // 交给契约校验器：{ relPath, doc }（relPath 相对仓库根，进诊断路径）
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
    const relPath = `arsenal-rules/${cat.dir}/${f}`;
    const doc = JSON.parse(fs.readFileSync(full, 'utf8'));
    ruleDocs.push({ relPath, doc });
    for (const rule of doc.rules ?? []) {
      rules.push({ ...rule, _sourceFile: `${cat.dir}/${f}` });
    }
  }
}

// ---- 契约校验：判定方式全部来自 arsenal-rules/_schema/rule-contract.mjs 这一份唯一来源 ----
//
// 改这一棒之前这里只做了一件事：数「必填字段在不在」。不看值、不报路径，
// 于是 severity 拼错、id 形态坏掉、check 四层全空、正则编不过 —— 全部静默通过。
// 现在吃对象、报精确字段路径（`arsenal-rules/web/controller.json#rules[3].severity`），
// 并且与生成的 rule.schema.json 读的是同一张字段规格表。
{
  const { errors, warnings, stats } = validateRuleSet({ files: ruleDocs, meta });

  if (warnings.length > 0) {
    // 警告不拦构建，但**必须打印** —— 不打出来的警告等于没有
    console.warn(`\n[arsenal] 规则契约警告 ${warnings.length} 条：\n  - ${formatDiagnostics(warnings)}\n`);
  }
  if (errors.length > 0) {
    fail(
      `规则契约校验未通过，共 ${errors.length} 个问题（路径精确到字段）：\n  - ` +
      formatDiagnostics(errors) +
      `\n\n  契约的唯一来源是 arsenal-rules/_schema/rule-contract.mjs —— 改契约改那里，不要改生成的 rule.schema.json。`
    );
  }
  console.log(
    `[arsenal] 契约校验通过：${stats.total} 条规则 · ` +
    `检测层 regex ${stats.checkLayerCount.regex} / ast ${stats.checkLayerCount.ast} / ` +
    `llm ${stats.checkLayerCount.llm} / manual ${stats.checkLayerCount.manual} · ` +
    `impact ${stats.withImpact}/${stats.total}`
  );
}

// ---- 生成物防漂移：rule.schema.json 必须与唯一来源现算的结果逐字节相同 ----
//
// 这是**闸门**而不是警告：Schema 是「字段定义的唯一真相」这句话的载体，
// 手改它就会让它与校验器说的是两件事 —— 而两者不一致时没有任何东西会报错
// （这正是改这一棒要修的病）。所以让它当场构建失败。
{
  const drift = detectSchemaDrift();
  if (drift !== null) {
    fail(
      `生成的 Schema 已漂移：${drift}\n` +
      `  rule.schema.json 由 arsenal-rules/_schema/rule-contract.mjs 生成，**不要手改**。\n` +
      `  改了契约 → 跑 \`npm run gen:rule-schema\` 重新生成后一起提交。`
    );
  }
}

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
