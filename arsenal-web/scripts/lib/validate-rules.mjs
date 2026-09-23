/**
 * validate-rules.mjs —— 规则集校验器（纯函数，不读盘）。
 *
 * ─────────────────────────────────────────────────────────────
 * 它修的是什么：
 *
 * 改这一棒之前，`sync-rules.mjs` 对规则只做了一件事：
 *
 *     for (const k of required) if (r[k] === undefined || r[k] === '' ) problems.push(`${r.id} 缺少字段 ${k}`)
 *
 * 也就是说 —— 只数「字段在不在」，**不看值**。于是下面这些全都静默通过：
 *   · `severity: "MUSTT"`          （枚举没人查，_weight 兜底成 1，这条规则悄悄降级）
 *   · `id: "web-ctrl-2"`           （形态没人查，ID 从此不可检索）
 *   · `check: {}`                  （四层全空，这条规则无法被任何方式验证）
 *   · `check.regex: { pattern: "(" }`（正则是坏的，引擎跑起来才炸）
 *   · 规则写在 web/ 目录里、`category` 却填 `security`（统计按 category 算，
 *                                  文件按目录聚合 —— 同一份数据两个归属，无人报错）
 *
 * 而且报错只说「缺少字段 sources」，不说**哪一份文件的第几条**。
 *
 * 现在：吃对象、返回带**精确字段路径**的诊断（`web/controller.json#rules[3].sources[1].ref`），
 * 判定方式全部来自 `rule-contract.mjs` 这一份契约（不另写一套）。
 * 纯函数、不读盘 —— 所以它能被单测直接驱动，也能被任何调用方喂数据。
 *
 * 抄自 ServerLab 的 `src/validate/`（判定口径：对故意写错的样例能报出精确字段路径）。
 */

import { join, idx, ROOT, createCollector, validateSpec } from './spec-validate.mjs';
import {
  CATEGORY_VALUES,
  CHECK_LAYERS,
  RULE_FILE_SPEC,
  SEVERITY_VALUES,
  SOURCE_TYPE_VALUES,
  assertContractIntegrity,
} from '../../../arsenal-rules/_schema/rule-contract.mjs';

/** 本校验器自己的诊断码（跨条/跨文件那一类，逐字段的码在 spec-validate.mjs）。 */
export const RULE_DIAGNOSTIC_CODE = {
  duplicateId: 'RULE_DUPLICATE_ID',
  categoryDirMismatch: 'RULE_CATEGORY_DIR_MISMATCH',
  metaSeverityPolicyDrift: 'RULE_META_SEVERITY_POLICY_DRIFT',
  metaCategoryDrift: 'RULE_META_CATEGORY_DRIFT',
  metaSourceTypeDrift: 'RULE_META_SOURCE_TYPE_DRIFT',
  metaFileCountDrift: 'RULE_META_FILE_COUNT_DRIFT',
  budgetOverflow: 'RULE_BUDGET_OVERFLOW',
  budgetStaleNumber: 'RULE_BUDGET_STALE_NUMBER',
  regexUncompilable: 'RULE_REGEX_UNCOMPILABLE',
  severityPolicyEmpty: 'RULE_SEVERITY_POLICY_EMPTY',
};

/**
 * 校验一整个规则集。
 *
 * @param {object} input
 * @param {{ relPath: string, doc: unknown }[]} input.files 各规则文件（相对仓库根的路径 + 已解析 JSON）
 * @param {object} input.meta                                已解析的 meta.json
 * @returns {{ errors: object[], warnings: object[], stats: object }}
 */
export function validateRuleSet({ files, meta }) {
  // 契约自检先行：契约自己坏了的话，下面判出来的每一句都不可信
  assertContractIntegrity();
  const c = createCollector();

  for (const { relPath, doc } of files) {
    const prefix = `${relPath}#`;
    const fileCollector = createCollector();
    validateSpec(RULE_FILE_SPEC, doc, ROOT, fileCollector, 'ruleFile');
    // 把文件名前缀进路径：诊断必须能直接指向「哪份文件的哪一条」，只说字段名等于没说
    for (const d of fileCollector.items) {
      c.push({ ...d, path: d.path === ROOT ? relPath : `${prefix}${d.path}` });
    }
  }

  checkMetaAgainstContract(c, meta);
  checkCategoryMatchesDir(c, files, meta);
  checkFileShellMatchesMeta(c, files, meta);
  checkMetaFileCount(c, files, meta);
  checkDuplicateIds(c, files);
  checkRegexCompiles(c, files);
  checkBudget(c, files, meta);

  return { errors: c.errors(), warnings: c.warnings(), stats: statsOf(files) };
}

/**
 * 文件外壳的 `category` / `name` 必须与 `meta.json.categories[]` 对齐。
 *
 * 为什么值得单列一条：这三个字段是**同义的第三份**。后端按目录发现规则文件、
 * 按 meta 渲染分类页，两边读的是不同来源 —— 所以不能删任何一边，只能断言一致。
 * 不一致的症状极其「只在人眼里」：页面标题写「可靠性」，文件里写「容器运行时」，
 * 没有任何断言会红，只有人觉得别扭。
 */
function checkFileShellMatchesMeta(c, files, meta) {
  const byDir = new Map();
  const byKey = new Map();
  for (const cat of meta?.categories ?? []) {
    if (typeof cat?.dir === 'string') byDir.set(cat.dir, cat);
    if (typeof cat?.key === 'string') byKey.set(cat.key, cat);
  }

  for (const { relPath, doc } of files) {
    if (!doc || typeof doc !== 'object') continue;
    const dir = relPath.split('/').slice(-2, -1)[0];
    const cat = byDir.get(dir);
    if (cat === undefined) continue; // 目录本身不合法已由 checkCategoryMatchesDir 报过

    if (doc.category !== cat.key) {
      c.error(
        RULE_DIAGNOSTIC_CODE.categoryDirMismatch,
        `${relPath}#category`,
        `外壳 category 为 "${doc.category}"，目录 "${dir}" 在 meta.json 里对应 "${cat.key}"`,
      );
    }
    if (typeof doc.name === 'string' && doc.name !== cat.name) {
      c.error(
        RULE_DIAGNOSTIC_CODE.categoryDirMismatch,
        `${relPath}#name`,
        `外壳 name 为 "${doc.name}"，meta.json 里 "${cat.key}" 的 name 是 "${cat.name}" —— 页面上会出现两套分类名`,
      );
    }
  }
}

/**
 * `meta.json.categories[].fileCount` 必须等于该目录下实际的规则文件数。
 *
 * 写这一棒时它**就是错的**：`reliability` 声明 1 个文件、实际有 2 个
 * （`container-runtime.json` + `exception-logging.json`）。字段同时被前端
 * `CategoryMeta.fileCount` 与后端 `RulesetMeta.Category.fileCount` 声明，
 * 也就是说这个错数字是**对外暴露**的 —— 只是当前没有一个页面恰好渲染它，
 * 所以它安静地错了很久。数字类的元信息就该由机器守住。
 */
function checkMetaFileCount(c, files, meta) {
  const actual = new Map();
  for (const { relPath } of files) {
    const dir = relPath.split('/').slice(-2, -1)[0];
    actual.set(dir, (actual.get(dir) ?? 0) + 1);
  }
  for (const cat of meta?.categories ?? []) {
    if (typeof cat?.dir !== 'string') continue;
    const n = actual.get(cat.dir) ?? 0;
    if (cat.fileCount !== n) {
      c.error(
        RULE_DIAGNOSTIC_CODE.metaFileCountDrift,
        `meta.json#categories[${CATEGORY_VALUES.indexOf(cat.key)}].fileCount`,
        `声明 ${cat.fileCount} 个文件，实际 ${n} 个 —— 这个数字同时对前端与后端暴露，不能是手抄的`,
      );
    }
  }
}

/* ══════════════════════════════════════════════════════════════
   跨条 / 跨文件检查
   ══════════════════════════════════════════════════════════════ */

/** 把每份文件里的规则连同它在文件里的下标摊平 —— 跨条检查都靠它拿到精确路径。 */
function flatten(files) {
  const out = [];
  for (const { relPath, doc } of files) {
    const list = doc && typeof doc === 'object' && Array.isArray(doc.rules) ? doc.rules : [];
    for (let i = 0; i < list.length; i += 1) {
      out.push({ file: relPath, index: i, rule: list[i], at: `${relPath}#${idx('rules', i)}` });
    }
  }
  return out;
}

/**
 * ID 唯一且形态可检索。
 *
 * 形态本身由契约的正则管（`RULE_ID_PATTERN`）；这里只查重。
 * 重复的严重性被低估过：前端按 id 检索、后端按 id 索引、导出的提示词按 id 溯源 ——
 * 两条同 id 的规则会让这三条路径全部指错，而且**谁都不报错**。
 */
function checkDuplicateIds(c, files) {
  const seen = new Map();
  for (const { rule, at } of flatten(files)) {
    const id = rule?.id;
    if (typeof id !== 'string' || id === '') continue; // 形态问题已由契约报过，不重复报
    if (seen.has(id)) {
      c.error(
        RULE_DIAGNOSTIC_CODE.duplicateId,
        join(at, 'id'),
        `规则 id "${id}" 重复（首次出现在 ${seen.get(id)}）—— id 一旦重复，检索/索引/溯源三条路径会一起指错`,
      );
    } else {
      seen.set(id, at);
    }
  }
}

/**
 * 规则落在哪个目录，`category` 就必须是哪一个。
 *
 * `sync-rules.mjs` 按**目录**聚合文件、按 `rule.category` 累计统计 ——
 * 两者一旦不一致，「web 类共 N 条」与「web/ 目录下共 M 条」就是两个数，
 * 页面上分不出哪个是真的。实测 69 条全部一致，所以这条断言是**此刻就成立的**，
 * 加它不是为了修 bug，是为了让它以后不会悄悄坏掉。
 */
function checkCategoryMatchesDir(c, files, meta) {
  const dirToKey = new Map();
  for (const cat of meta?.categories ?? []) {
    if (typeof cat?.dir === 'string' && typeof cat?.key === 'string') dirToKey.set(cat.dir, cat.key);
  }
  for (const { file, rule, at } of flatten(files)) {
    const dir = file.split('/').slice(-2, -1)[0];
    const expected = dirToKey.get(dir);
    if (expected === undefined) {
      c.error(
        RULE_DIAGNOSTIC_CODE.categoryDirMismatch,
        at,
        `规则文件所在目录 "${dir}" 不在 meta.json 的 categories（合法目录：${[...dirToKey.keys()].join(' / ')}）`,
      );
      continue;
    }
    if (rule?.category !== expected) {
      c.error(
        RULE_DIAGNOSTIC_CODE.categoryDirMismatch,
        join(at, 'category'),
        `category 为 "${rule?.category}"，但它所在的目录 "${dir}" 对应分类 "${expected}" —— 目录聚合与分类统计会各说各话`,
      );
    }
  }
}

/**
 * 正则必须真的能编译。
 *
 * 一条编不过的正则，在构建期是一句无害的字符串，到引擎里就是**整层扫描崩掉**
 * （或者被 try/catch 吞掉、这条规则从此静默失效）。构建期不查它没有任何理由。
 *
 * ⚠️ 已知边界：JS 与 Java 的正则方言不同。这里用 JS 编译**只能抓语法错**，
 * 抓不到「JS 能编、Java 不能编」（如 `\p{...}` 的少数写法）。这条断言的定位是
 * 「拦住明显的坏值」，不是「保证引擎一定跑得动」。
 */
function checkRegexCompiles(c, files) {
  for (const { rule, at } of flatten(files)) {
    const pattern = rule?.check?.regex?.pattern;
    if (typeof pattern !== 'string' || pattern === '') continue;
    try {
      // eslint-disable-next-line no-new
      new RegExp(pattern);
    } catch (e) {
      c.error(
        RULE_DIAGNOSTIC_CODE.regexUncompilable,
        `${at}.check.regex.pattern`,
        `正则无法编译：${(e && e.message) || String(e)}`,
      );
    }
  }
}

/**
 * 手抄的数字必须由机器守住 —— `budget.mustCurrent` / `budget.totalCurrent`。
 *
 * 与 `categories[].fileCount` 同一类病：它们都是**统计结果被写成了字面量**，
 * 而统计结果每天都在变。后端日志打「强制级 {mustClass}/{mustHardLimit}」时
 * 用的是现算值，meta 里那两个是给人看的 —— 两者不一致时没有东西会红。
 * （实测这两个**当前是对的**，所以这条断言此刻不是修 bug，是防它以后变错。）
 *
 * 强制级超硬上限本身只警告不判负 —— 这是「人记不住」的阈值，不是正确性问题。
 */
function checkBudget(c, files, meta) {
  const all = flatten(files).map((x) => x.rule);
  const mustClass = all.filter((r) => r?.severity === 'MUST' || r?.severity === 'NEVER').length;
  const total = all.length;

  const limit = Number(meta?.budget?.mustHardLimit);
  if (!Number.isFinite(limit) || limit <= 0) {
    c.error(RULE_DIAGNOSTIC_CODE.budgetOverflow, 'meta.json#budget.mustHardLimit', '硬上限缺失或不是正整数');
    return;
  }

  if (meta?.budget?.mustCurrent !== mustClass) {
    c.error(
      RULE_DIAGNOSTIC_CODE.budgetStaleNumber,
      'meta.json#budget.mustCurrent',
      `写着 ${meta?.budget?.mustCurrent}，实测 ${mustClass}（MUST + NEVER）`,
    );
  }
  if (meta?.budget?.totalCurrent !== total) {
    c.error(
      RULE_DIAGNOSTIC_CODE.budgetStaleNumber,
      'meta.json#budget.totalCurrent',
      `写着 ${meta?.budget?.totalCurrent}，实测 ${total}`,
    );
  }

  if (mustClass > limit) {
    c.warn(
      RULE_DIAGNOSTIC_CODE.budgetOverflow,
      ROOT,
      `强制级 ${mustClass} 条已超出硬上限 ${limit} 条 —— 规范超出人能记住的量就会变成摆设，请先降级几条`,
    );
  }
}

/**
 * `meta.json` 与契约的枚举必须**逐值同集合同顺序**。
 *
 * meta.json 不是「第二套真相」而是运行时数据（后端读它做校验、前端读它做展示），
 * 所以它不能删；但它里的 severityPolicy / sourceTypes / categories 三份键
 * 与契约里的三个枚举是同一件事。不一致的症状极其隐蔽：
 * 契约加了第 5 个严重度取值、meta.json 没加 → 校验放行，而**前端渲染时找不到它的
 * 中文说明，页面上出现一片空白**。
 */
function checkMetaAgainstContract(c, meta) {
  if (!meta || typeof meta !== 'object') {
    c.error(RULE_DIAGNOSTIC_CODE.metaSeverityPolicyDrift, 'meta.json', 'meta.json 不是对象');
    return;
  }

  const cmp = (code, path, label, actual, expected) => {
    if (!Array.isArray(actual)) {
      c.error(code, path, `${label} 缺失或不是数组`);
      return;
    }
    const same = actual.length === expected.length && actual.every((v, i) => v === expected[i]);
    if (!same) {
      c.error(
        code,
        path,
        `${label}与契约不一致：\n        文件里：${actual.join(' | ')}\n        契约里：${expected.join(' | ')}`,
      );
    }
  };

  cmp(
    RULE_DIAGNOSTIC_CODE.metaSeverityPolicyDrift,
    'meta.json#severityPolicy',
    'severityPolicy 的键',
    Object.keys(meta.severityPolicy ?? {}),
    SEVERITY_VALUES,
  );

  // 每条严重度都必须有说明 —— 空说明会让前端出现空白标签
  for (const s of SEVERITY_VALUES) {
    const text = meta.severityPolicy?.[s];
    if (typeof text !== 'string' || text.trim() === '') {
      c.error(
        RULE_DIAGNOSTIC_CODE.severityPolicyEmpty,
        join('meta.json#severityPolicy', s),
        `严重度 ${s} 的说明为空 —— 页面上会渲染出一片空白`,
      );
    }
  }

  cmp(
    RULE_DIAGNOSTIC_CODE.metaSourceTypeDrift,
    'meta.json#sourceTypes',
    'sourceTypes 的键',
    Object.keys(meta.sourceTypes ?? {}),
    SOURCE_TYPE_VALUES,
  );

  cmp(
    RULE_DIAGNOSTIC_CODE.metaCategoryDrift,
    'meta.json#categories[].key',
    'categories 的 key',
    (meta.categories ?? []).map((x) => x?.key),
    CATEGORY_VALUES,
  );
}

/* ══════════════════════════════════════════════════════════════
   统计与输出
   ══════════════════════════════════════════════════════════════ */

function statsOf(files) {
  const all = flatten(files).map((x) => x.rule).filter(Boolean);
  const bySeverity = {};
  const byCategory = {};
  let promptChars = 0;
  for (const r of all) {
    if (typeof r.severity === 'string') bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
    if (typeof r.category === 'string') byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
    promptChars += typeof r.promptFragment === 'string' ? [...r.promptFragment].length : 0;
  }
  const mustClass = (bySeverity.MUST ?? 0) + (bySeverity.NEVER ?? 0);
  const checkLayerCount = { regex: 0, ast: 0, llm: 0, manual: 0 };
  for (const r of all) {
    for (const layer of CHECK_LAYERS) {
      if (r?.check?.[layer] !== undefined) checkLayerCount[layer] += 1;
    }
  }
  return { total: all.length, bySeverity, byCategory, mustClass, promptChars, checkLayerCount };
}

/** 把诊断排成可直接进构建日志的文本（错误在前，路径升序）。 */
export function formatDiagnostics(list) {
  const rank = (d) => (d.level === 'error' ? 0 : 1);
  return [...list]
    .sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path))
    .map((d) => `${d.level === 'error' ? '✗' : '!'} ${d.path}\n      ${d.message}`)
    .join('\n  - ');
}
