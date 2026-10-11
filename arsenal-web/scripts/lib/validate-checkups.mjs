/**
 * validate-checkups.mjs —— 观察项校验器（纯函数，不读盘）。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么又一个校验器，不并进 validate-charter.mjs：
 *
 * 章程是「项目要守的规矩」，观察项是「从扫描事实推出的提醒」——
 * 两者的判据形状完全不同（章程是条款+例外+政策，观察项是三元条件），
 * 塞进同一个校验器只会让两边都为对方放宽。一层一个契约，是这一仓的既有做法。
 *
 * ─────────────────────────────────────────────────────────────
 * 本校验器专门盯的三件事（其余都是形态检查）：
 *
 *   ① **count 必须等于 rules.length**。这是最容易被写死的地方 ——
 *      加一条规则忘了改 count，页面上的「共 N 条」就撒谎，而 JSON 依然合法。
 *   ② **rules 为空必须报错，不许「全过」**。空数组会让观察项这一档整档消失，
 *      而「没有要提示的」与「一条都没配」在页面上长得一模一样 ——
 *      这是本仓 2026-10-04 在 charterNotExecutableCount 上踩过的同一类坑。
 *   ③ **算子与 value 的类型必须配对**。>= 配字符串会把比较变成 NaN 比较，
 *      结果是这条观察项永远不触发 —— 一条永不触发的断言，和摆设没有区别。
 *
 * ─────────────────────────────────────────────────────────────
 * `today` 必须注入：不读 `new Date()`。判据里有一条「updatedAt 不得晚于今天」，
 * 读系统时钟会让这条判据随运行时刻变，反着验就没法稳定复现。
 */

/** 诊断码。与 spec-validate / validate-charter 同形（level / code / path / message），未另造一套。 */
export const CHECKUP_DIAGNOSTIC_CODE = {
  unknownField: 'CHECKUP_UNKNOWN_FIELD',
  requiredMissing: 'CHECKUP_REQUIRED_MISSING',
  typeMismatch: 'CHECKUP_TYPE_MISMATCH',
  countMismatch: 'CHECKUP_COUNT_MISMATCH',
  emptyRules: 'CHECKUP_EMPTY_RULES',
  idNamespace: 'CHECKUP_ID_NAMESPACE',
  idDuplicate: 'CHECKUP_ID_DUPLICATE',
  levelUnknown: 'CHECKUP_LEVEL_UNKNOWN',
  factBlank: 'CHECKUP_FACT_BLANK',
  operatorUnknown: 'CHECKUP_OPERATOR_UNKNOWN',
  valueTypeMismatch: 'CHECKUP_VALUE_TYPE_MISMATCH',
  textTooShort: 'CHECKUP_TEXT_TOO_SHORT',
  evidenceBad: 'CHECKUP_EVIDENCE_BAD',
  updatedAtInFuture: 'CHECKUP_UPDATED_AT_IN_FUTURE',
  placeholderMissing: 'CHECKUP_PLACEHOLDER_MISSING',
};

/** 六种算子 → 允许的 value 类型。刻意不做表达式引擎（见 checkups.json 的 operatorNote）。 */
export const OPERATOR_VALUE_TYPES = {
  '>=': ['number'],
  '<=': ['number'],
  '==': ['number', 'string', 'boolean'],
  '!=': ['number', 'string', 'boolean'],
  contains: ['string'],
  exists: ['boolean'],
};

/** 观察项的档位枚举。目前只有 obs —— 观察项不判负，这是它与 P0/P1 的分界线。 */
export const CHECKUP_LEVELS = ['obs'];

/** text 里允许出现的占位符。`{n}` 实测值、`{value}` 阈值。 */
const PLACEHOLDERS = ['{n}', '{value}'];

const SHELL_FIELDS = ['collection', 'version', 'updatedAt', 'count', 'operators', 'rules'];
const RULE_FIELDS = ['id', 'level', 'when', 'text', 'advice', 'evidence'];

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 校验一份观察项事实源。
 *
 * @param {object} input
 * @param {string} input.relPath 相对仓库根的路径，进诊断路径前缀
 * @param {unknown} input.doc     已解析的 JSON
 * @param {string} [input.today]  今天（YYYY-MM-DD）。**必须注入** —— 不读 new Date()
 * @returns {{ errors: Array<{level:string,code:string,path:string,message:string}>,
 *             warnings: Array<object>, stats: Record<string, unknown> }}
 */
export function validateCheckups({ relPath, doc, today }) {
  const errors = [];
  const warnings = [];
  const push = (level, code, p, message) => {
    (level === 'error' ? errors : warnings).push({ level, code, path: p, message });
  };
  const err = (code, p, message) => push('error', code, p, message);
  const warn = (code, p, message) => push('warn', code, p, message);

  if (!isPlainObject(doc)) {
    err(CHECKUP_DIAGNOSTIC_CODE.typeMismatch, relPath, `观察项事实源的顶层必须是对象，实际为 ${Array.isArray(doc) ? '数组' : typeof doc}`);
    return { errors, warnings, stats: emptyStats() };
  }

  // ── 外壳字段 ──────────────────────────────────────────────
  for (const key of SHELL_FIELDS) {
    if (!(key in doc)) {
      err(CHECKUP_DIAGNOSTIC_CODE.requiredMissing, `${relPath}#${key}`, `外壳缺字段 "${key}"（合法字段：${SHELL_FIELDS.join(' / ')}）`);
    }
  }
  for (const key of Object.keys(doc)) {
    if (!SHELL_FIELDS.includes(key) && !['note', 'operatorNote'].includes(key)) {
      err(CHECKUP_DIAGNOSTIC_CODE.unknownField, `${relPath}#${key}`, `外壳出现未登记的字段 "${key}" —— 字段名改了就等于改了契约`);
    }
  }
  if (typeof doc.collection === 'string' && doc.collection !== 'arsenal-checkups') {
    err(CHECKUP_DIAGNOSTIC_CODE.typeMismatch, `${relPath}#collection`, `collection 应为 "arsenal-checkups"，实际为 "${doc.collection}"`);
  }
  if (typeof doc.version === 'string' && !/^\d+\.\d+\.\d+$/.test(doc.version)) {
    err(CHECKUP_DIAGNOSTIC_CODE.typeMismatch, `${relPath}#version`, `version 应为 x.y.z 形式，实际为 "${doc.version}"`);
  }

  // ── updatedAt 不得晚于今天（这条判据就是 today 必须注入的原因）──
  if (typeof doc.updatedAt === 'string' && typeof today === 'string' && doc.updatedAt > today) {
    err(
      CHECKUP_DIAGNOSTIC_CODE.updatedAtInFuture,
      `${relPath}#updatedAt`,
      `updatedAt ${doc.updatedAt} 晚于今天 ${today} —— 事实源不会来自未来，写错日期会让「最近更新」这类展示静默失真`,
    );
  }
  if (typeof today !== 'string') {
    // 不静默跳过：调用方没给 today 时这条判据等于不存在，而「不存在」与「通过」长一样
    err(CHECKUP_DIAGNOSTIC_CODE.updatedAtInFuture, `${relPath}#updatedAt`, '调用方没有注入 today —— 校验器不读 new Date()，缺它就无法判「日期是否来自未来」，不静默跳过');
  }

  // ── 算子表 ────────────────────────────────────────────────
  const operators = Array.isArray(doc.operators) ? doc.operators.filter((x) => typeof x === 'string') : [];
  if (Array.isArray(doc.operators) && operators.length !== doc.operators.length) {
    err(CHECKUP_DIAGNOSTIC_CODE.typeMismatch, `${relPath}#operators`, 'operators 里出现了非字符串项');
  }
  for (const op of Object.keys(OPERATOR_VALUE_TYPES)) {
    if (!operators.includes(op)) {
      err(CHECKUP_DIAGNOSTIC_CODE.operatorUnknown, `${relPath}#operators`, `算子表缺 "${op}" —— 解释器只认这六个，表里少一个，用到它的观察项会被判成未知算子`);
    }
  }
  for (const op of operators) {
    if (!(op in OPERATOR_VALUE_TYPES)) {
      err(CHECKUP_DIAGNOSTIC_CODE.operatorUnknown, `${relPath}#operators`, `算子 "${op}" 不在解释器的六个之内：${Object.keys(OPERATOR_VALUE_TYPES).join(' / ')}`);
    }
  }

  // ── rules ─────────────────────────────────────────────────
  const rules = Array.isArray(doc.rules) ? doc.rules : [];
  if (!Array.isArray(doc.rules)) {
    err(CHECKUP_DIAGNOSTIC_CODE.typeMismatch, `${relPath}#rules`, `rules 应为数组，实际为 ${typeof doc.rules}`);
  }

  // ★ 空数组必须红。理由写在文件头 ②：整档消失是最难发现的静默失败，
  //   因为页面上的「0 条观察项」看起来完全正常。
  if (Array.isArray(doc.rules) && rules.length === 0) {
    err(
      CHECKUP_DIAGNOSTIC_CODE.emptyRules,
      `${relPath}#rules`,
      'rules 是空数组 —— 观察项这一档会整档消失，而「没有要提示的」与「一条都没配」在页面上长得一模一样。' +
        '确实不需要观察项就别放这个文件，而不是留一个空的',
    );
  }

  // ★ count 必须等于实测条数（写死是最容易过期的数字）
  if (typeof doc.count === 'number') {
    if (doc.count !== rules.length) {
      err(CHECKUP_DIAGNOSTIC_CODE.countMismatch, `${relPath}#count`, `count 写的是 ${doc.count}，rules 实有 ${rules.length} 条 —— 页面上的「共 N 条」照 count 显示，写死就撒谎`);
    }
  } else if ('count' in doc) {
    err(CHECKUP_DIAGNOSTIC_CODE.typeMismatch, `${relPath}#count`, `count 应为整数，实际为 ${typeof doc.count}`);
  }

  const seenId = new Map();
  rules.forEach((r, i) => {
    const at = `${relPath}#rules[${i}]`;
    if (!isPlainObject(r)) {
      err(CHECKUP_DIAGNOSTIC_CODE.typeMismatch, at, `rules[${i}] 应为对象，实际为 ${Array.isArray(r) ? '数组' : typeof r}`);
      return;
    }
    for (const key of Object.keys(r)) {
      if (!RULE_FIELDS.includes(key)) {
        err(CHECKUP_DIAGNOSTIC_CODE.unknownField, `${at}.${key}`, `观察项出现未登记的字段 "${key}"（合法字段：${RULE_FIELDS.join(' / ')}）`);
      }
    }
    for (const key of ['id', 'level', 'when', 'text', 'advice']) {
      if (typeof r[key] === 'undefined') {
        err(CHECKUP_DIAGNOSTIC_CODE.requiredMissing, `${at}.${key}`, `观察项缺必填字段 "${key}"`);
      }
    }

    // id：命名空间 + 不重复
    if (typeof r.id === 'string') {
      if (!r.id.startsWith('CK-')) {
        err(CHECKUP_DIAGNOSTIC_CODE.idNamespace, `${at}.id`, `观察项 id "${r.id}" 必须以 "CK-" 开头 —— 它与 69 条规则（PJ-/其它前缀）生命周期不同，ID 不混才看得出这条属于哪一层`);
      }
      if (seenId.has(r.id)) {
        err(CHECKUP_DIAGNOSTIC_CODE.idDuplicate, `${at}.id`, `观察项 id 重复（首次在 ${seenId.get(r.id)}）`);
      } else {
        seenId.set(r.id, `${at}.id`);
      }
    }

    if (typeof r.level === 'string' && !CHECKUP_LEVELS.includes(r.level)) {
      err(CHECKUP_DIAGNOSTIC_CODE.levelUnknown, `${at}.level`, `level "${r.level}" 不在已登记的档位内：${CHECKUP_LEVELS.join(' / ')} —— 观察项不判负，没有第二档`);
    }

    // when：三元条件
    const when = r.when;
    if (isPlainObject(when)) {
      for (const key of Object.keys(when)) {
        if (!['fact', 'op', 'value'].includes(key)) {
          err(CHECKUP_DIAGNOSTIC_CODE.unknownField, `${at}.when.${key}`, `when 出现未登记的字段 "${key}"（只认 fact / op / value）`);
        }
      }
      if (typeof when.fact !== 'string' || when.fact.trim() === '') {
        err(CHECKUP_DIAGNOSTIC_CODE.factBlank, `${at}.when.fact`, 'fact 必须是非空点分路径（如 deploy.ci.length）');
      }
      const op = when.op;
      if (typeof op !== 'string' || !(op in OPERATOR_VALUE_TYPES)) {
        err(CHECKUP_DIAGNOSTIC_CODE.operatorUnknown, `${at}.when.op`, `op "${String(op)}" 不在六个算子之内：${Object.keys(OPERATOR_VALUE_TYPES).join(' / ')}`);
        return;
      }
      // ★ 算子与 value 类型必须配对 —— 配错的后果是这条观察项永远不触发，
      //   而「永不触发」与「这次没命中」在报告上完全一样。
      const allowed = OPERATOR_VALUE_TYPES[op];
      const actual = valueType(when.value);
      if (!allowed.includes(actual)) {
        err(
          CHECKUP_DIAGNOSTIC_CODE.valueTypeMismatch,
          `${at}.when.value`,
          `算子 "${op}" 的 value 只允许 ${allowed.join(' / ')}，实际为 ${actual}（${JSON.stringify(when.value)}）—— 类型配错会让比较退化成 NaN 比较，这条观察项将永远不触发`,
        );
      }
    } else if (typeof when !== 'undefined') {
      err(CHECKUP_DIAGNOSTIC_CODE.typeMismatch, `${at}.when`, `when 应为对象 { fact, op, value }，实际为 ${Array.isArray(when) ? '数组' : typeof when}`);
    }

    // 文案：长度下限 + 占位符
    if (typeof r.text === 'string' && r.text.trim().length < 8) {
      err(CHECKUP_DIAGNOSTIC_CODE.textTooShort, `${at}.text`, `text 只有 ${r.text.trim().length} 个字 —— 一句话说不清的观察项，列在报告里也是噪音`);
    }
    if (typeof r.text === 'string' && !PLACEHOLDERS.some((p) => r.text.includes(p))) {
      // 不是每条都必须带数字，但完全不带实测值的文案无法自证「这是算出来的」
      warn(CHECKUP_DIAGNOSTIC_CODE.placeholderMissing, `${at}.text`, `text 里没有 ${PLACEHOLDERS.join(' / ')} —— 不带实测值的文案无法自证「这条是从事实算出来的」，建议带上 {n}`);
    }
    if (typeof r.advice === 'string' && r.advice.trim().length < 8) {
      err(CHECKUP_DIAGNOSTIC_CODE.textTooShort, `${at}.advice`, `advice 只有 ${r.advice.trim().length} 个字 —— 只说「有问题」不说「那怎么办」等于把活推给下一个人`);
    }

    // evidence：可空（「没有 CI」这种结论天然没有文件证据），但给了就必须能用
    if (typeof r.evidence !== 'undefined' && r.evidence !== null) {
      if (!isPlainObject(r.evidence)) {
        err(CHECKUP_DIAGNOSTIC_CODE.evidenceBad, `${at}.evidence`, `evidence 应为 { from, limit } 或 null，实际为 ${Array.isArray(r.evidence) ? '数组' : typeof r.evidence}`);
      } else {
        if (typeof r.evidence.from !== 'string' || r.evidence.from.trim() === '') {
          err(CHECKUP_DIAGNOSTIC_CODE.evidenceBad, `${at}.evidence.from`, 'evidence.from 必须是点分路径（指向带 path/line 的数组）');
        }
        const limit = r.evidence.limit;
        if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 10) {
          err(CHECKUP_DIAGNOSTIC_CODE.evidenceBad, `${at}.evidence.limit`, `evidence.limit 应为 1..10 的整数，实际为 ${JSON.stringify(limit)}`);
        }
      }
    }
  });

  return { errors, warnings, stats: statsOf(doc, rules, operators) };
}

function valueType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function emptyStats() {
  return { rules: 0, byLevel: {}, byOperator: {}, operators: 0, withEvidence: 0 };
}

function statsOf(doc, rules, operators) {
  const byLevel = {};
  const byOperator = {};
  let withEvidence = 0;
  for (const r of rules) {
    if (!isPlainObject(r)) continue;
    if (typeof r.level === 'string') byLevel[r.level] = (byLevel[r.level] ?? 0) + 1;
    const op = r?.when?.op;
    if (typeof op === 'string') byOperator[op] = (byOperator[op] ?? 0) + 1;
    if (isPlainObject(r.evidence)) withEvidence += 1;
  }
  return {
    rules: rules.length,
    countDeclared: typeof doc?.count === 'number' ? doc.count : null,
    byLevel,
    byOperator,
    operators: operators.length,
    withEvidence,
  };
}

/** 把诊断排成可直接进构建日志的文本（错误在前，路径升序）。与 validate-charter 同形。 */
export function formatCheckupDiagnostics(list) {
  const rank = (d) => (d.level === 'error' ? 0 : 1);
  return [...list]
    .sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path))
    .map((d) => `${d.level === 'error' ? '✗' : '!'} ${d.path}\n      ${d.message}`)
    .join('\n  - ');
}
