/**
 * spec-validate.mjs —— 「字段规格 → JSON Schema」与「字段规格 → 精确路径诊断」的**同一台引擎**。
 *
 * ─────────────────────────────────────────────────────────────
 * 它解决的是什么：
 *
 * 一份契约有两种表达：给人看的 JSON Schema，和给机器判的校验代码。
 * 手写两遍必然漂移 —— 而且漂移方式最恶心：**Schema 说 severity 只有 4 个取值，
 * 校验器漏了一个判断，于是第 5 个取值进来了，谁都不报错**。
 *
 * 所以这里只认一张字段规格表（`kind` 决定判定方式，`description` 决定文档），
 * 两种表达都由它算出来：
 *
 *   toJsonSchema(spec)          → 写进 _schema/rule.schema.json（生成物，有防漂移闸门）
 *   validateSpec(spec, value)   → 构建期硬失败，报精确字段路径
 *
 * 于是「Schema 与校验器不一致」在**结构上**不可能发生，不靠测试去兜。
 * （做法抄自 ServerLab 的 `block-spec.ts` + `gen-schema.mjs`；那边把这条叫
 * 「Constitution over Convention」。）
 *
 * ─────────────────────────────────────────────────────────────
 * 精确字段路径（这是抄过来的第二样东西）：
 *
 * 报错必须能直接定位，形如 `web/controller.json#rules[3].sources[1].ref`，不能只说
 * 「有个 source 缺 ref」。全仓路径只有两种形态，集中在这里生成，禁止各处拼字符串：
 *   下标：`rules[3]`    键：`check.regex`
 *
 * ─────────────────────────────────────────────────────────────
 * 诊断形态与 ServerLab 的 `{ level, code, path, message }` 一致（未另造一套）。
 */

/* ══════════════════════════════════════════════════════════════
   一、字段路径构造
   ══════════════════════════════════════════════════════════════ */

/** 根路径。 */
export const ROOT = '';

/** 拼子键：`join('check', 'regex')` → `check.regex`。 */
export function join(base, name) {
  return base === ROOT ? name : `${base}.${name}`;
}

/** 拼数组下标：`idx('rules', 3)` → `rules[3]`。 */
export function idx(base, i) {
  return `${base}[${i}]`;
}

/** 一次走到底：`at('rules', 3, 'sources', 1, 'ref')` → `rules[3].sources[1].ref`。 */
export function at(base, ...segments) {
  let out = base;
  for (const seg of segments) out = typeof seg === 'number' ? idx(out, seg) : join(out, seg);
  return out;
}

/* ══════════════════════════════════════════════════════════════
   二、规格 → JSON Schema
   ══════════════════════════════════════════════════════════════ */

/**
 * 把字段规格编译成 JSON Schema。
 *
 * **刻意内联全部子结构，不产 `#/definitions`**：原手写 Schema 里有
 * `#/definitions/severity | source | check` 三个 `$ref`，全仓无人引用（实测 grep 为 0）。
 * 保留它们就得让生成器支持「命名提升」，为一份没人读的引用增加一处会漂的机制 ——
 * 不划算。这是**有意的差异**，不是漏做。
 */
export function toJsonSchema(node) {
  switch (node.kind) {
    case 'string': {
      const s = { type: 'string' };
      if (node.pattern !== undefined) s.pattern = node.pattern;
      if (node.format !== undefined) s.format = node.format;
      if (node.minLength !== undefined) s.minLength = node.minLength;
      if (node.maxLength !== undefined) s.maxLength = node.maxLength;
      if (node.description !== undefined) s.description = node.description;
      return s;
    }

    case 'int': {
      const s = { type: 'integer' };
      if (node.minimum !== undefined) s.minimum = node.minimum;
      if (node.maximum !== undefined) s.maximum = node.maximum;
      if (node.default !== undefined) s.default = node.default;
      if (node.description !== undefined) s.description = node.description;
      return s;
    }

    case 'enum': {
      const s = { type: 'string', enum: [...node.values] };
      if (node.default !== undefined) s.default = node.default;
      if (node.description !== undefined) s.description = node.description;
      return s;
    }

    case 'array': {
      const s = { type: 'array', items: toJsonSchema(node.of) };
      if (node.minItems !== undefined) s.minItems = node.minItems;
      if (node.description !== undefined) s.description = node.description;
      return s;
    }

    case 'object': {
      const properties = {};
      const required = [];
      for (const [key, field] of Object.entries(node.fields)) {
        properties[key] = toJsonSchema(field);
        if (field.required === true) required.push(key);
      }
      const s = { type: 'object' };
      if (node.description !== undefined) s.description = node.description;
      s.additionalProperties = false;
      if (required.length > 0) s.required = required;
      if (node.minProperties !== undefined) s.minProperties = node.minProperties;
      s.properties = properties;
      // `check` 的「四层至少一层」：Schema 里用 anyOf 表达，与引擎的 requireSomeField 同一份数据
      if (node.requireSomeField !== undefined) {
        s.anyOf = node.requireSomeField.map((k) => ({ required: [k] }));
      }
      return s;
    }

    default:
      throw new Error(`spec-validate：未知的 kind "${node.kind}"（规格表写错了）`);
  }
}

/* ══════════════════════════════════════════════════════════════
   三、规格 → 校验（精确路径）
   ══════════════════════════════════════════════════════════════ */

/** 诊断码登记 —— 一处集中，便于在测试里逐条断言「这些码真的会出」。 */
export const SPEC_DIAGNOSTIC_CODE = {
  requiredMissing: 'SPEC_REQUIRED_MISSING',
  typeMismatch: 'SPEC_TYPE_MISMATCH',
  emptyString: 'SPEC_EMPTY_STRING',
  unknownField: 'SPEC_UNKNOWN_FIELD',
  enumInvalid: 'SPEC_ENUM_INVALID',
  patternMismatch: 'SPEC_PATTERN_MISMATCH',
  lengthOutOfRange: 'SPEC_LENGTH_OUT_OF_RANGE',
  numberOutOfRange: 'SPEC_NUMBER_OUT_OF_RANGE',
  notInteger: 'SPEC_NOT_INTEGER',
  emptyArray: 'SPEC_EMPTY_ARRAY',
  allEmpty: 'SPEC_ALL_EMPTY',
  badFormat: 'SPEC_BAD_FORMAT',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function describe(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value === undefined) return 'undefined';
  return typeof value;
}

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 收集器：一层薄封装，保证每条诊断都带 path。 */
export function createCollector() {
  const items = [];
  return {
    items,
    push(d) {
      items.push(d);
    },
    error(code, path, message) {
      items.push({ level: 'error', code, path, message });
    },
    warn(code, path, message) {
      items.push({ level: 'warn', code, path, message });
    },
    errors() {
      return items.filter((d) => d.level === 'error');
    },
    warnings() {
      return items.filter((d) => d.level === 'warn');
    },
  };
}

/**
 * 按规格校验一个值；不合规就往收集器里塞一条带**精确路径**的诊断。
 *
 * @param {object} node  字段规格（RULE_SPEC / SOURCE_SPEC / …）
 * @param {unknown} value
 * @param {string} base  当前路径（'' 表示根）
 * @param {ReturnType<typeof createCollector>} c
 * @param {string} label 人读的名字，进报错文案（如「必填项」）
 */
export function validateSpec(node, value, base, c, label = '值') {
  switch (node.kind) {
    case 'string':
      validateString(node, value, base, c, label);
      return;

    case 'int':
      validateInt(node, value, base, c, label);
      return;

    case 'enum':
      validateEnum(node, value, base, c, label);
      return;

    case 'array':
      validateArray(node, value, base, c, label);
      return;

    case 'object':
      validateObject(node, value, base, c, label);
      return;

    default:
      throw new Error(`spec-validate：未知的 kind "${node.kind}"`);
  }
}

function isAbsent(value) {
  return value === undefined || value === null;
}

function validateString(node, value, base, c, label) {
  if (isAbsent(value)) {
    if (node.required === true) c.error(SPEC_DIAGNOSTIC_CODE.requiredMissing, base, `${label}是必填项，当前缺失`);
    return;
  }
  if (typeof value !== 'string') {
    c.error(SPEC_DIAGNOSTIC_CODE.typeMismatch, base, `${label}应为 string，实际为 ${describe(value)}`);
    return;
  }
  if (value.trim().length === 0) {
    // 空串在可选字段上不比 undefined 更有信息量，一律不报 —— 免得为「写了但为空」打架
    if (node.required === true) c.error(SPEC_DIAGNOSTIC_CODE.emptyString, base, `${label}不能为空字符串`);
    return;
  }
  if (node.pattern !== undefined && !new RegExp(node.pattern).test(value)) {
    c.error(
      SPEC_DIAGNOSTIC_CODE.patternMismatch,
      base,
      `${label}取值 "${value}" 不匹配形态 ${node.pattern}`,
    );
  }
  const len = [...value].length;
  if (node.minLength !== undefined && len < node.minLength) {
    c.error(SPEC_DIAGNOSTIC_CODE.lengthOutOfRange, base, `${label}长度 ${len} 少于下限 ${node.minLength}`);
  }
  if (node.maxLength !== undefined && len > node.maxLength) {
    c.error(SPEC_DIAGNOSTIC_CODE.lengthOutOfRange, base, `${label}长度 ${len} 超出上限 ${node.maxLength}`);
  }
  if (node.format === 'date' && !DATE_RE.test(value)) {
    c.error(SPEC_DIAGNOSTIC_CODE.badFormat, base, `${label}应为 YYYY-MM-DD，实际为 "${value}"`);
  }
}

function validateInt(node, value, base, c, label) {
  if (isAbsent(value)) {
    if (node.required === true) c.error(SPEC_DIAGNOSTIC_CODE.requiredMissing, base, `${label}是必填项，当前缺失`);
    return;
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    c.error(SPEC_DIAGNOSTIC_CODE.typeMismatch, base, `${label}应为 number，实际为 ${describe(value)}`);
    return;
  }
  if (!Number.isInteger(value)) {
    c.error(SPEC_DIAGNOSTIC_CODE.notInteger, base, `${label}应为整数，实际为 ${value}`);
    return;
  }
  if (node.minimum !== undefined && value < node.minimum) {
    c.error(SPEC_DIAGNOSTIC_CODE.numberOutOfRange, base, `${label}不得小于 ${node.minimum}，实际为 ${value}`);
  }
  if (node.maximum !== undefined && value > node.maximum) {
    c.error(SPEC_DIAGNOSTIC_CODE.numberOutOfRange, base, `${label}不得大于 ${node.maximum}，实际为 ${value}`);
  }
}

function validateEnum(node, value, base, c, label) {
  if (isAbsent(value)) {
    if (node.required === true) c.error(SPEC_DIAGNOSTIC_CODE.requiredMissing, base, `${label}是必填项，当前缺失`);
    return;
  }
  if (typeof value !== 'string') {
    c.error(SPEC_DIAGNOSTIC_CODE.typeMismatch, base, `${label}应为 string，实际为 ${describe(value)}`);
    return;
  }
  if (!node.values.includes(value)) {
    c.error(
      SPEC_DIAGNOSTIC_CODE.enumInvalid,
      base,
      `${label}取值 "${value}" 不在已登记的枚举内，合法取值为：${node.values.join(' | ')}`,
    );
  }
}

function validateArray(node, value, base, c, label) {
  if (isAbsent(value)) {
    if (node.required === true) c.error(SPEC_DIAGNOSTIC_CODE.requiredMissing, base, `${label}是必填项，当前缺失`);
    return;
  }
  if (!Array.isArray(value)) {
    c.error(SPEC_DIAGNOSTIC_CODE.typeMismatch, base, `${label}应为数组，实际为 ${describe(value)}`);
    return;
  }
  if (node.minItems !== undefined && value.length < node.minItems) {
    c.error(
      SPEC_DIAGNOSTIC_CODE.emptyArray,
      base,
      `${label}至少 ${node.minItems} 项，实际 ${value.length} 项`,
    );
  }
  for (let i = 0; i < value.length; i += 1) {
    validateSpec(node.of, value[i], idx(base, i), c, `${label}[${i}]`);
  }
}

function validateObject(node, value, base, c, label) {
  if (isAbsent(value)) {
    if (node.required === true) c.error(SPEC_DIAGNOSTIC_CODE.requiredMissing, base, `${label}是必填项，当前缺失`);
    return;
  }
  if (!isPlainObject(value)) {
    c.error(SPEC_DIAGNOSTIC_CODE.typeMismatch, base, `${label}应为对象，实际为 ${describe(value)}`);
    return;
  }

  // 未知字段：契约是 additionalProperties:false，所以这里是**错误**而不是警告。
  // 依据是本仓库那句「字段名、类型、必填性不得随意更改」—— 多一个字段就是改了契约。
  for (const key of Object.keys(value)) {
    if (!(key in node.fields)) {
      c.error(
        SPEC_DIAGNOSTIC_CODE.unknownField,
        join(base, key),
        `${label}出现未登记的字段 "${key}"（合法字段：${Object.keys(node.fields).join(' / ')}）`,
      );
    }
  }

  for (const [key, field] of Object.entries(node.fields)) {
    validateSpec(field, value[key], join(base, key), c, `${label ? `${label} ` : ''}${key}`);
  }

  // 「四层至少一层」这类跨字段约束
  if (node.requireSomeField !== undefined) {
    const present = node.requireSomeField.filter((k) => !isAbsent(value[k]));
    if (present.length === 0) {
      c.error(
        SPEC_DIAGNOSTIC_CODE.allEmpty,
        base,
        `${label}的 ${node.requireSomeField.join(' / ')} 全空 —— 这条规则无法被任何方式验证，等于没写`,
      );
    }
  }
}
