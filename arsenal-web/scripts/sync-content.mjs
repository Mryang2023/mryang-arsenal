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

// ── ① 最佳实践案例库（技术 → 场景 → 实现方案） ──────────────
const cbDir = path.join(root, 'arsenal-cookbook');
const cbMeta = readJson(path.join(cbDir, 'meta.json'));

// ── 判据阈值只从契约读一处（W-0）────────────────────────────────────────
// 曾经这批「少于 N 条」的门槛在本脚本与 `tools/build-content.py` 里各内联一份，
// 是同一套规矩的两个副本，却没有任何东西保证它们相等 —— 改了 Python 那边忘了这边，
// 结果是「构建期放行、同步期拦截」，报错还指向一份读者根本没看过的代码。
// 案例库要扩到 9 条主线（A-1），判据一定会被反复调整，双写的代价不是多改一处，
// 而是「将来每一次调整都可能只改一处」。
//
// 所以这里**不许再写任何阈值字面量**：契约缺键就直接失败，绝不静默回落到默认值
// （回落到默认值 = 又造了一份内联副本，只是藏得更深）。
const CONTRACT_KEYS = [
  'pickWhen', 'limits', 'references',
  'when', 'signals', 'notSuitable', 'recipes',
  'files', 'checklist', 'pitfalls', 'observe',
];
const C = cbMeta.contract ?? {};
const missingKeys = CONTRACT_KEYS.filter((k) => typeof C[k] !== 'number');
if (missingKeys.length) {
  fail(
    `arsenal-cookbook/meta.json 的 contract 缺键或不是数字：${missingKeys.join(' / ')}\n` +
    `  - 判据的唯一来源是 tools/content/cookbook_contract.py，请重跑 ` +
    `python tools/build-content.py 再同步`
  );
}

const topics = [];
const cbProblems = [];
let totalFiles = 0;
let totalLines = 0;
let totalHighlights = 0;
let totalScenarios = 0;
let totalRecipes = 0;
let totalDemos = 0;

for (const id of cbMeta.order ?? []) {
  const doc = readJson(path.join(cbDir, `${id}.json`));
  const t = doc.topic;
  if (!t) cbProblems.push(`${id}.json 缺少 topic 字段`);

  // L1：技术必须说清「什么时候该选它」与自身边界 —— 否则会被当成银弹
  if ((t.pickWhen ?? []).length < C.pickWhen) {
    cbProblems.push(`${id} 的 pickWhen 少于 ${C.pickWhen} 条 —— 说不出什么时候该选它`);
  }
  if ((t.limits ?? []).length < C.limits) {
    cbProblems.push(`${id} 的 limits 少于 ${C.limits} 条 —— 不写自身边界的技术会被当成银弹`);
  }
  if ((t.references ?? []).length < C.references) {
    cbProblems.push(`${id} 的 references 少于 ${C.references} 条 —— 无出处不收录`);
  }
  for (const r of t.references ?? []) {
    if (!r.title) cbProblems.push(`${id} 有参考资料缺少 title`);
    else if (!r.url && !r.note) {
      cbProblems.push(`${id} 的参考资料「${r.title}」既没有链接也没有说明`);
    }
  }
  if (!(t.scenarios ?? []).length) cbProblems.push(`${id} 一个场景都没有`);

  let tFiles = 0;
  let tLines = 0;
  let tHighlights = 0;
  let tRecipes = 0;
  let tDemos = 0;
  const tRules = new Set();

  for (const sc of t.scenarios ?? []) {
    const sw = `${id}/${sc.id}`;
    if ((sc.when ?? '').length < C.when) {
      cbProblems.push(`${sw} 的 when 少于 ${C.when} 字，说明不了什么情况下用`);
    }
    if ((sc.signals ?? []).length < C.signals) {
      cbProblems.push(`${sw} 的 signals 少于 ${C.signals} 条 —— 没有可核对信号，「适用」只是形容词`);
    }
    if ((sc.notSuitable ?? []).length < C.notSuitable) {
      cbProblems.push(`${sw} 的 notSuitable 少于 ${C.notSuitable} 条`);
    }
    if ((sc.recipes ?? []).length < C.recipes) {
      cbProblems.push(`${sw} 没有任何实现方案 —— 场景不能悬空`);
    }
    totalScenarios += 1;

    for (const rp of sc.recipes ?? []) {
      const at = `${sw}/${rp.id}`;
      const fileIds = new Set();
      let highlights = 0;
      let lines = 0;

      for (const file of rp.files ?? []) {
        if (fileIds.has(file.id)) cbProblems.push(`${at} 内文件 id 重复：${file.id}`);
        fileIds.add(file.id);
        lines += (file.code ?? '').split('\n').length;

        // 关键校验：highlights 用「片段锚点」定位，锚点必须真的存在于代码里。
        // 用锚点而不是行号，是为了让代码改动后备注不会错位到别的行上 ——
        // 错位的备注比没有备注更危险，它会给出一个自信的错误结论。
        for (const h of file.highlights ?? []) {
          if (!h.mark) {
            cbProblems.push(`${at}/${file.id} 有 highlight 缺少 mark 锚点`);
            continue;
          }
          if (!(file.code ?? '').includes(h.mark)) {
            cbProblems.push(
              `${at}/${file.id} 锚点找不到目标：${JSON.stringify(h.mark.slice(0, 60))}`
            );
          }
        }
        highlights += (file.highlights ?? []).length;
      }

      if ((rp.files ?? []).length < C.files) {
        cbProblems.push(`${at} 没有代码文件 —— 方案必须给得出代码`);
      }
      if ((rp.checklist ?? []).length < C.checklist) {
        cbProblems.push(`${at} 的 checklist 少于 ${C.checklist} 条`);
      }
      if ((rp.pitfalls ?? []).length < C.pitfalls) {
        cbProblems.push(`${at} 的 pitfalls 少于 ${C.pitfalls} 条`);
      }
      if (rp.lab?.kind === 'mock-endpoint' && (rp.lab.observe ?? []).length < C.observe) {
        cbProblems.push(`${at} 的 lab.observe 少于 ${C.observe} 条 —— 不给预期现象，读者看不懂输出`);
      }

      // 可运行示例：入口文件必须真的在 files 里，否则后端拿不到东西编译
      for (const d of rp.playground ?? []) {
        const mainFile = (d.files ?? []).find((x) => x.path === `${d.mainClass}.java`);
        if (!mainFile) {
          cbProblems.push(`${at}/${d.id} 找不到入口文件 ${d.mainClass}.java`);
          continue;
        }
        if (!mainFile.code.includes('public static void main')) {
          cbProblems.push(`${at}/${d.id} 的入口类没有 main 方法`);
        }
        if (rp.lab?.kind === 'mock-endpoint' && !mainFile.code.includes('HttpServer')) {
          cbProblems.push(`${at}/${d.id} 声明了模拟接口测试却没有 HttpServer`);
        }
        tDemos += 1;
        totalDemos += 1;
      }

      // 四项统计不是手写内容，由本脚本从 files[] 算出后注入 —— 与旧版同一套路
      rp.fileCount = (rp.files ?? []).length;
      rp.highlightCount = highlights;
      rp.ruleCount = new Set(rp.relatedRules ?? []).size;
      rp.lines = lines;

      tFiles += rp.fileCount;
      tLines += lines;
      tHighlights += highlights;
      tRecipes += 1;
      totalRecipes += 1;
      for (const r of rp.relatedRules ?? []) tRules.add(r);
    }
  }

  t.scenarioCount = (t.scenarios ?? []).length;
  t.recipeCount = tRecipes;
  t.fileCount = tFiles;
  t.highlightCount = tHighlights;
  t.lines = tLines;
  t.ruleCount = tRules.size;
  t.demoCount = tDemos;

  totalFiles += tFiles;
  totalLines += tLines;
  totalHighlights += tHighlights;

  topics.push(t);
}

if (cbProblems.length) fail(cbProblems.join('\n  - '));

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'cookbook.json'),
  JSON.stringify({ meta: cbMeta, topics }, null, 2),
  'utf8'
);

console.log(
  `[arsenal] 已同步 ${topics.length} 项技术 / ${totalScenarios} 个场景 / ${totalRecipes} 套方案` +
  ` → src/generated/cookbook.json\n` +
  `         ${totalFiles} 个文件 / ${totalLines} 行代码 / ${totalHighlights} 条要点备注（锚点全部命中）\n` +
  `         ${totalDemos} 个模拟接口实验（入口文件与 main 方法均已核对）`
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
    ['__SELECTION_TABLE__', '__ARCH_SUMMARY__', '__TREE__', '__START__', '__RISKS__', '__DANGLING__', '__FILES__']],
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

// ── ⑤ 项目档案（六视图） ────────────────────────────────────
// 六张架构图讲的是「哪个项目」。档案一旦抽出去，换项目就只是加一份 JSON，
// 代码零改动 —— 所以这里守的是「档案能读、六视图齐、id 不撞车」。
// 深层校验（token 能否解析、数字与真实数据对不对得上）在 TS 侧的
// arch-profile.ts + project-check.ts，因为注册表在那里。
const profilesDir = path.join(root, 'arsenal-profiles');
if (!fs.existsSync(profilesDir)) {
  fail('找不到 arsenal-profiles/ —— 六视图的档案源，缺了它 /arch 只能讲一份故事');
}

const profileFiles = fs
  .readdirSync(profilesDir)
  .filter((f) => f.endsWith('.json'))
  .sort();
if (!profileFiles.length) fail('arsenal-profiles/ 里一份 JSON 都没有');

const VIEW_IDS = ['business', 'data', 'app', 'tech', 'product', 'project'];
const profileOrder = [];
const profiles = {};
const profileProblems = [];

for (const file of profileFiles) {
  const doc = readJson(path.join(profilesDir, file));
  const at = `arsenal-profiles/${file}`;

  if (typeof doc.id !== 'string' || !doc.id.trim()) profileProblems.push(`${at} 缺少 id`);
  if (typeof doc.name !== 'string' || !doc.name.trim()) profileProblems.push(`${at} 缺少 name`);
  if (doc.id && profiles[doc.id]) profileProblems.push(`${at} 的 id「${doc.id}」与前面某份重复`);
  // 文件名即 id：两者不一致时，`?profile=` 之类的引用会指向一个没人认识的名字
  if (doc.id && doc.id !== file.replace(/\.json$/, '')) {
    profileProblems.push(`${at} 的 id「${doc.id}」与文件名不一致 —— 按文件名找它的人会找不到`);
  }

  for (const vid of VIEW_IDS) {
    const v = doc.views?.[vid];
    if (!v) {
      profileProblems.push(`${at} 缺少 views.${vid}`);
      continue;
    }
    if (!v.definition) profileProblems.push(`${at} views.${vid}.definition 为空`);
    if (!v.question) profileProblems.push(`${at} views.${vid}.question 为空`);
    if (!Array.isArray(v.focus) || !v.focus.length) profileProblems.push(`${at} views.${vid}.focus 为空`);
    if (!Array.isArray(v.outputs) || !v.outputs.length) profileProblems.push(`${at} views.${vid}.outputs 为空`);
  }

  // token 语法闸门：写错成 `{rules.total}` 或 `{{Rules.Total}}` 时，
  // 解析器会原样留着，界面上就出现一串花括号字面量 —— 在这里先拦一道。
  const badTokens = [...JSON.stringify(doc).matchAll(/\{\{([^}]*)\}\}/g)]
    .map((m) => m[1])
    .filter((k) => !/^[A-Za-z][A-Za-z0-9.]*$/.test(k));
  if (badTokens.length) {
    profileProblems.push(`${at} token 写法不合法：${[...new Set(badTokens)].join('、')}`);
  }

  profileOrder.push(doc.id);
  profiles[doc.id] = doc;
}

if (profileProblems.length) fail(profileProblems.join('\n  - '));

fs.writeFileSync(
  path.join(outDir, 'profiles.json'),
  JSON.stringify({ order: profileOrder, profiles }, null, 2),
  'utf8'
);

console.log(
  `[arsenal] 已同步 ${profileOrder.length} 份项目档案 → src/generated/profiles.json\n` +
  `         ${profileOrder.join(' / ')}（六视图齐备，id 与文件名一致，token 写法合法）`
);

// ── ⑥ 图标资产库 ────────────────────────────────────────────
// 这里守的是「清单 ↔ 磁盘」两个方向：
//   · 清单里登记了位图，磁盘上却没有 → 页面上是一张破图（生成器已查一遍，这里再查）
//   · 磁盘上有图，清单里没登记     → 图永远不会被用上，且下次同步也发现不了
// 第二个方向只有在这里能查：生成器眼里只有清单，看不到目录里多出的文件。
const iconsDoc = readJson(path.join(root, 'arsenal-icons', 'icons.json'));
const iconProblems = [];

const ICON_CATS = new Set((iconsDoc.categories ?? []).map((c) => c.id));
const iconsPublicDir = path.join(webRoot, 'public', 'icons');
const iconKeys = new Set();

// 矢量事实源在 TS 里，这里按文本扫顶层条目 —— 与生成器同一套正则，
// 免得「生成器说有、同步说没有」这类只在某一侧成立的判定。
const tsIconsSrc = fs.readFileSync(
  path.join(webRoot, 'src', 'lib', 'tech-icons.ts'),
  'utf8'
);
const vectorKeys = new Set(
  [...tsIconsSrc.matchAll(/^ {2}('([a-z0-9-]+)'|([a-z0-9]+)): \{$/gm)].map(
    (m) => m[2] ?? m[3]
  )
);

for (const ic of iconsDoc.icons ?? []) {
  const at = `图标 ${ic.key}`;
  if (!/^[a-z][a-z0-9-]*$/.test(ic.key ?? '')) iconProblems.push(`${at} 的 key 不合法`);
  if (iconKeys.has(ic.key)) iconProblems.push(`${at} 的 key 重复`);
  iconKeys.add(ic.key);
  if (!ICON_CATS.has(ic.category)) iconProblems.push(`${at} 的 category「${ic.category}」不在九大类内`);
  if (!ic.en || !ic.name) iconProblems.push(`${at} 缺少中文名或英文名`);
  if (ic.vector && !vectorKeys.has(ic.vector)) {
    iconProblems.push(`${at} 指向的矢量 key「${ic.vector}」在 tech-icons.ts 里不存在 —— 页面上会静默变灰方块`);
  }
  if (!ic.vector) iconProblems.push(`${at} 没有矢量 key`);
  if (ic.bitmap) {
    if (ic.bitmap.startsWith('/') || ic.bitmap.includes('..') || /^[A-Za-z]:/.test(ic.bitmap)) {
      iconProblems.push(`${at} 的 bitmap 路径不合法（不许绝对路径或 ..）：${ic.bitmap}`);
    } else if (!ic.bitmap.endsWith('.png') && !ic.bitmap.endsWith('.webp')) {
      iconProblems.push(`${at} 的 bitmap 必须是 .png/.webp：${ic.bitmap}`);
    } else if (!fs.existsSync(path.join(iconsPublicDir, ic.bitmap))) {
      iconProblems.push(`${at} 登记了位图但磁盘上没有：public/icons/${ic.bitmap}`);
    }
  }
}

// 孤儿位图：生成出来却没登记，等于白生成（生成器和页面都看不到它）
const bitmapRegistered = new Set((iconsDoc.icons ?? []).map((i) => i.bitmap).filter(Boolean));
const walkIcons = (dir, prefix) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    return e.isDirectory() ? walkIcons(path.join(dir, e.name), rel) : [rel];
  });
};
const orphanBitmaps = walkIcons(iconsPublicDir, '').filter((rel) => !bitmapRegistered.has(rel));
if (orphanBitmaps.length) {
  iconProblems.push(`这些位图落在盘上却没登记进 icons.json：${orphanBitmaps.join('、')}`);
}

// 体积闸门：位图是二进制，一张不压就几百 KB，攒够一批就能把仓库顶大
const totalBytes = walkIcons(iconsPublicDir, '').reduce(
  (n, rel) => n + fs.statSync(path.join(iconsPublicDir, rel)).size, 0
);
if (totalBytes > 6 * 1024 * 1024) {
  iconProblems.push(`位图总 ${(totalBytes / 1024 / 1024).toFixed(1)}MB 超过 6MB 上限 —— 该转 WebP 了`);
}

if (iconProblems.length) fail(iconProblems.join('\n  - '));

fs.writeFileSync(
  path.join(outDir, 'icons.json'),
  JSON.stringify(iconsDoc, null, 2),
  'utf8'
);

console.log(
  `[arsenal] 已同步图标资产库 → src/generated/icons.json\n` +
  `         ${iconKeys.size} 个图标 / ${ICON_CATS.size} 类（矢量 key 全部命中 tech-icons.ts）\n` +
  `         ${bitmapRegistered.size} 张位图已落盘（${(totalBytes / 1024).toFixed(0)}KB），无孤儿文件`
);

// ── ⑦ 场景案例库 ────────────────────────────────────────────
// 生成器已经校验过一遍；这里再独立校验一次，因为它守的是本库唯一的核心承诺：
// **参数变了，命中的切片必须变，而且没命中的必须说得出原因。**
// 静默省略一个切片，读者就会以为「这个参数下不需要做这件事」。
const casesDir = path.join(root, 'arsenal-cases');
const casesMeta = readJson(path.join(casesDir, 'meta.json'));

const cases = [];
const caseProblems = [];
const caseIds = new Set();

// 规则 id 的真实集合：猜一个 id 不会报错，只会让「案例 ↔ 规则」的反向链接
// 在页面上永远空着 —— 那种错是看不见的，所以必须在这里拦。
const KNOWN_RULES = new Set();
{
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === 'object') {
      if (typeof o.id === 'string' && o.severity) KNOWN_RULES.add(o.id);
      Object.values(o).forEach(walk);
    }
  };
  const rulesDir = path.join(root, 'arsenal-rules');
  const stack = [rulesDir];
  while (stack.length) {
    const dir = stack.pop();
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.endsWith('.json')) walk(readJson(p));
    }
  }
}

for (const id of casesMeta.order ?? []) {
  const doc = readJson(path.join(casesDir, id + '.json'));
  const kase = doc.case;
  if (!kase) {
    caseProblems.push(id + '.json 缺少 case 字段');
    continue;
  }
  if (caseIds.has(kase.id)) caseProblems.push('场景 id 重复：' + kase.id);
  caseIds.add(kase.id);

  const driverLevels = new Map();
  const driverIds = new Set();
  for (const d of kase.drivers ?? []) {
    if (driverIds.has(d.id)) caseProblems.push(kase.id + ' 的 driver id 重复：' + d.id);
    driverIds.add(d.id);
    const lids = new Set((d.levels ?? []).map((l) => l.id));
    if (lids.size !== (d.levels ?? []).length) {
      caseProblems.push(kase.id + '/' + d.id + ' 的档位 id 有重复');
    }
    driverLevels.set(d.id, lids);
  }
  if (driverIds.size < 4) {
    caseProblems.push(kase.id + ' 只有 ' + driverIds.size + ' 个驱动参数 —— 少于 4 个就退化成静态文案');
  }

  const checkWhen = (when, where) => {
    for (const [did, levels] of Object.entries(when ?? {})) {
      if (!driverLevels.has(did)) {
        caseProblems.push(where + ' 的 when 引用了未声明的 driver：' + did);
        continue;
      }
      for (const lv of levels) {
        if (!driverLevels.get(did).has(lv)) {
          caseProblems.push(where + ' 的 when 引用了 driver ' + did + ' 未声明的档位：' + lv);
        }
      }
    }
  };

  const sliceIds = new Set();
  (kase.slices ?? []).forEach((s, i) => {
    const where = kase.id + '/' + (s.id ?? i);
    if (sliceIds.has(s.id)) caseProblems.push(where + ' 的切片 id 重复');
    sliceIds.add(s.id);
    if (s.order !== i + 1) {
      caseProblems.push(where + ' 的 order 是 ' + s.order + '，应为 ' + (i + 1));
    }
    checkWhen(s.when, where);

    const marks = new Set();
    for (const h of s.highlights ?? []) {
      if (!h.mark) {
        caseProblems.push(where + ' 有 highlight 缺少 mark 锚点');
        continue;
      }
      if (marks.has(h.mark)) caseProblems.push(where + ' 的锚点重复：' + h.mark.slice(0, 40));
      marks.add(h.mark);
      // 锚点是片段不是行号：找不到就必须当场失败，错位的备注比没有备注更危险。
      if (!(s.code ?? '').includes(h.mark)) {
        caseProblems.push(where + ' 锚点找不到目标：' + JSON.stringify(h.mark.slice(0, 60)));
      }
      if (h.rule && !KNOWN_RULES.has(h.rule)) {
        caseProblems.push(where + ' 的 highlight 引用了不存在的规则 ' + h.rule);
      }
    }
    if ((s.highlights ?? []).length < 2) {
      caseProblems.push(where + ' 只有 ' + (s.highlights ?? []).length + ' 条 highlights');
    }
    for (const r of s.relatedRules ?? []) {
      if (!KNOWN_RULES.has(r)) {
        caseProblems.push(where + ' 引用了不存在的规则 id：' + r);
      }
    }
    if ((s.relatedRules ?? []).length === 0) {
      caseProblems.push(where + ' 没有关联任何规则 —— 案例与规则库脱节');
    }
    if (!(s.sql ?? '').trim()) caseProblems.push(where + ' 没有建表 DDL');
    if (!(s.code ?? '').trim()) caseProblems.push(where + ' 没有代码');
    if (!s.why || s.why.length < 20) {
      caseProblems.push(where + ' 的 why 太短 —— 说不清「为什么在这个参数下要这么做」');
    }
  });

  // 矛盾与不适用的 when 同样要合法，否则告警永远不触发，页面上的黄条等于摆设
  (kase.conflicts ?? []).forEach((c, i) => {
    checkWhen(c.when, kase.id + '/conflict[' + i + ']');
    if (!c.text) caseProblems.push(kase.id + '/conflict[' + i + '] 没有说明矛盾在哪');
  });
  (kase.notSuitableFor ?? []).forEach((n, i) => {
    checkWhen(n.when, kase.id + '/notSuitableFor[' + i + ']');
    if (!n.reason) caseProblems.push(kase.id + '/notSuitableFor[' + i + '] 没说该看什么');
  });

  // 架构建议：节点只能来自场景数据，连线两端必须都存在
  const nodeIds = new Set((kase.architecture?.nodes ?? []).map((n) => n.id));
  for (const n of kase.architecture?.nodes ?? []) {
    checkWhen(n.whenAny, kase.id + '/arch/' + n.id);
  }
  for (const l of kase.architecture?.links ?? []) {
    if (!nodeIds.has(l.from) || !nodeIds.has(l.to)) {
      caseProblems.push(kase.id + ' 的架构连线指向不存在的节点：' + l.from + ' -> ' + l.to);
    }
  }

  cases.push(kase);
}

if (caseProblems.length) fail(caseProblems.join('\n  - '));

fs.writeFileSync(
  path.join(outDir, 'cases.json'),
  JSON.stringify({ meta: casesMeta, cases }, null, 2),
  'utf8'
);

const totalSlices = cases.reduce((n, c) => n + (c.slices ?? []).length, 0);
const totalMarks = cases.reduce(
  (n, c) => n + (c.slices ?? []).reduce((m, s) => m + (s.highlights ?? []).length, 0), 0
);
console.log(
  '[arsenal] 已同步场景案例库 → src/generated/cases.json\n' +
  '         ' + cases.length + ' 个场景 / ' + totalSlices + ' 个条件切片 / ' + totalMarks +
  ' 条锚点备注（全部命中代码）\n' +
  '         驱动参数、矛盾告警、架构节点均已交叉校验'
);

// ── ⑧ 代码扫描映射表 ────────────────────────────────────────
// 这一层守的是「坐标映射到架构图的哪一位」。失效方式很隐蔽：
// dim/opt 写错了不报错，扫描照样成功，只是那个依赖**永远不出现在部署图上** ——
// 页面一片正常，图少了个中间件。所以这里拿 architecture.json 的画布选项逐条对。
const scanDoc = readJson(path.join(root, 'arsenal-scan', 'scan_rules.json'));
const scanProblems = [];
const archCanvas = readJson(path.join(root, 'arsenal-stacks', 'architecture.json')).canvas ?? {};
const canvasDims = new Set(Object.keys(archCanvas.dims ?? {}));
const canvasOpts = archCanvas.options ?? {};
const scanTechs = new Set();

for (const r of scanDoc.rules ?? []) {
  const at = `${r.group}:${r.artifact}`;
  if (!r.tech) scanProblems.push(`${at} 没有 tech`);
  if (r.dim) {
    if (!canvasDims.has(r.dim)) scanProblems.push(`${at} 的 dim「${r.dim}」不在架构画布里`);
    else if (!(r.opt in (canvasOpts[r.dim] ?? {}))) {
      scanProblems.push(`${at} 的 opt「${r.opt}」不在维度「${r.dim}」的选项里`);
    }
  } else if (r.opt) {
    scanProblems.push(`${at} 只有 opt 没有 dim —— 落不到图上`);
  }
  if (r.icon && !vectorKeys.has(r.icon)) scanProblems.push(`${at} 的 icon「${r.icon}」在 tech-icons.ts 里不存在`);
  scanTechs.add(r.tech);
}
if ((scanDoc.rules ?? []).length === 0) scanProblems.push('扫描映射表是空的');

if (scanProblems.length) fail(scanProblems.join('\n  - '));

fs.writeFileSync(
  path.join(outDir, 'scan_rules.json'),
  JSON.stringify({ meta: { collection: scanDoc.collection, count: scanDoc.count, onCanvas: scanDoc.onCanvas }, rules: scanDoc.rules }, null, 2),
  'utf8'
);
console.log(
  '[arsenal] 已同步代码扫描映射表 → src/generated/scan_rules.json\n' +
  '         ' + scanDoc.count + ' 条映射 / ' + scanDoc.onCanvas + ' 条落架构图 / ' +
  scanTechs.size + ' 个技术 key（dim、opt、icon 已对画布交叉校验）'
);

// ── ⑨ 部署形态机理剧本 ──────────────────────────────────────
// 生成器（tools/build-content.py）已校验过剧本自身；这里再独立验一次，守的是
// 「同步产物真的能被前端播出来」：三问齐备、步数够、引用不悬空 ——
// 少一问或悬空一条引用，机理台就会在某一帧静默卡死，页面上一片正常。
const flowsDoc = readJson(path.join(root, 'arsenal-stacks', 'topology_flows.json'));
const flowsProblems = [];
const flowsRoot = flowsDoc.flows ?? {};
let flowCount = 0;
let sceneCount = 0;

const SCENE_IDS_REQUIRED = new Set(['read', 'write', 'failover']);
for (const [dimId, opts] of Object.entries(flowsRoot)) {
  for (const [optId, modes] of Object.entries(opts)) {
    for (const [modeId, flow] of Object.entries(modes)) {
      const at = `${dimId}/${optId}/${modeId}`;
      flowCount += 1;
      const nodeIds = new Set((flow.nodes ?? []).map((n) => n.id));
      const edgeIds = new Set((flow.edges ?? []).map((e) => e.id));
      if (!nodeIds.size) flowsProblems.push(`${at} 没有节点`);
      if (!edgeIds.size) flowsProblems.push(`${at} 没有边`);
      for (const e of flow.edges ?? []) {
        if (!nodeIds.has(e.from) || !nodeIds.has(e.to)) {
          flowsProblems.push(`${at} 的边 ${e.id} 端点悬空：${e.from} -> ${e.to}`);
        }
      }
      const gotScenes = new Set((flow.scenes ?? []).map((s) => s.id));
      for (const need of SCENE_IDS_REQUIRED) {
        if (!gotScenes.has(need)) flowsProblems.push(`${at} 缺少 ${need} 场景 —— 三问必须齐备`);
      }
      for (const sc of flow.scenes ?? []) {
        sceneCount += 1;
        if ((sc.steps ?? []).length < 3) flowsProblems.push(`${at}/${sc.id} 不足 3 步`);
        for (const [i, st] of (sc.steps ?? []).entries()) {
          for (const h of st.highlight ?? []) {
            if (!nodeIds.has(h)) flowsProblems.push(`${at}/${sc.id} 第${i + 1}步 highlight 悬空：${h}`);
          }
          for (const a of st.active ?? []) {
            if (!edgeIds.has(a)) flowsProblems.push(`${at}/${sc.id} 第${i + 1}步 active 悬空：${a}`);
          }
          if (st.token && !edgeIds.has(st.token.edge)) {
            flowsProblems.push(`${at}/${sc.id} 第${i + 1}步 token 悬空：${st.token.edge}`);
          }
        }
      }
    }
  }
}
if (flowCount === 0) flowsProblems.push('机理剧本为空 —— 形态动画化没挂上事实源');
if (flowsProblems.length) fail(flowsProblems.join('\n  - '));

// 这一份与其它产物差一条规矩：**逐字节等于事实源**（含行尾换行符）——
// 【22】层拿 arsenal-stacks/topology_flows.json 与它做逐字节比对守「忘了 sync」，
// 而 build-content.py 的 write_json 统一带行尾换行，所以这里必须原样跟写。
fs.writeFileSync(
  path.join(outDir, 'topology-flows.json'),
  JSON.stringify(flowsDoc, null, 2) + '\n',
  'utf8'
);
console.log(
  `[arsenal] 已同步部署形态机理剧本 → src/generated/topology-flows.json\n` +
  `         ${flowCount} 个形态剧本 / ${sceneCount} 个场景（三问齐备、引用与端点全部命中）`
);
