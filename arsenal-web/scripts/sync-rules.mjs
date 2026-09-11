/**
 * 规则数据同步：arsenal-rules/**\/*.json  →  src/generated/rules.json
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

const payload = {
  generatedAt: new Date().toISOString(),
  meta: {
    ruleset: meta.ruleset,
    name: meta.name,
    version: meta.version,
    releasedAt: meta.releasedAt,
    description: meta.description,
    targetStack: meta.targetStack,
    severityPolicy: meta.severityPolicy,
    budget: meta.budget,
    sourceRegistry: meta.sourceRegistry,
    categories: meta.categories,
    changelog: meta.changelog,
  },
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
  `｜提示词 ${payload.stats.promptChars} 字符 ≈ ${payload.stats.promptTokensEstimate} tokens`
);
