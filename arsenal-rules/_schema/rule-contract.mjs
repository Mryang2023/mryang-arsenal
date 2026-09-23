/**
 * 规则对象契约 —— **唯一来源**。
 *
 * ─────────────────────────────────────────────────────────────
 * 这个文件为什么存在（它修的是「同一份契约写三遍」）：
 *
 * 规则对象的形状原先同时存在于三处，彼此没有任何东西保证一致：
 *   · `rule.schema.json`   —— 手写，且**全仓没有任何代码读它、没有任何东西校验它**
 *   · `src/lib/types.ts`   —— TS 类型（编译期就擦掉了，运行时管不到）
 *   · `RuleLoader.inspect` —— 后端启动时的「四道闸门」，规则与这里的判断又各写一套
 *
 * 症状很隐蔽：`rule.schema.json` 里 `severity` 少写一个取值，**什么都不会发生** ——
 * 没有人解析它，所以它永远不会报错；而「字段定义的唯一真相」这句话会一直是句空话。
 * 本仓库的 `arsenal-rules/README.md` 与项目计划书都已经把它写成「唯一真相」，
 * 但真相只有一个的前提是：**它由一个来源生成，且校验器读的是同一份**。
 *
 * 所以：本文件是唯一来源，另外三处都是它的出口。
 *
 *   本文件 ──┬─→ `scripts/gen-rule-schema.mjs` ─→ `_schema/rule.schema.json`（生成，勿手改）
 *            └─→ `scripts/lib/validate-rules.mjs` ─→ `npm run sync` 的构建期硬失败
 *
 * `rule.schema.json` 上挂着防漂移闸门：`npm run sync` 会拿磁盘上的文件与
 * 本文件现算出来的结果逐字节比对，手改过的 Schema 会让构建当场失败（见 sync-rules.mjs）。
 *
 * ─────────────────────────────────────────────────────────────
 * 一份契约，两种表达，同一份数据：
 *
 *   SPEC 里的每个字段同时携带两样东西 ——
 *     · `description` / `required` / `pattern` / `values`：**人读的契约**（进 JSON Schema）
 *     · `kind`：**机器读的判定方式**（校验器按它挑原语）
 *   于是「Schema 说的」与「校验器判的」不可能是两套 —— 它们是同一张表的两面，
 *   不靠测试去兜（这正是 ServerLab 那套 `block-spec.ts` 的做法，抄的就是这条）。
 *
 * ─────────────────────────────────────────────────────────────
 * 有意的差异（写在这里，不藏着）：
 *
 *   · `check` 允许 `regex` / `ast` / `llm` / `manual` 四层叠加，但**至少要有一层**
 *     （`requireSomeField`）。后端 `RuleLoader.inspect` 用的是同一条判据。
 *   · `promptFragment` 上限 300 字符、`title` 上限 80、`rationale` 下限 20 ——
 *     与手写 Schema 逐值一致，未收紧也未放宽。
 *   · `supersedes` / `tags` / `subcategory` / `appliesTo` / `updatedAt` 在契约里是**可选**，
 *     但实测 69 条规则**全部**写了这四个（见 README 的「契约待拍板」一节）。
 *     要不要收紧成必填是产品决定，本文件不替它决定 —— 保持旧口径不动。
 */

/** JSON Schema 方言。与手写版一致，不顺手升级 —— 换方言是另一件事。 */
export const SCHEMA_DIALECT = 'http://json-schema.org/draft-07/schema#';
export const SCHEMA_ID = 'https://arsenal.local/schema/rule.schema.json';

/* ══════════════════════════════════════════════════════════════
   一、枚举：取值与说明的唯一来源
   ══════════════════════════════════════════════════════════════ */

/**
 * 全部闭合枚举。**顺序即写出顺序**，也是「合法取值为：…」提示里的顺序。
 *
 * `meta.json` 里另有三份枚举的副本（`severityPolicy` 的键、`sourceTypes` 的键、
 * `categories[].key`）。它们不是「第二套真相」而是**运行时数据** ——
 * 所以校验器会断言两者**键集合完全相同**，不一致就报错（`META_CONTRACT_DRIFT`）。
 */
export const ENUM = {
  severity: {
    values: ['MUST', 'SHOULD', 'MAY', 'NEVER'],
    description:
      'MUST=硬约束，违反必修，计入合规分；SHOULD=强烈建议；MAY=可选风格，不参与校验；NEVER=明令禁止，与 MUST 同级阻断',
  },
  category: {
    values: [
      'skeleton',
      'web',
      'service',
      'data',
      'concurrency',
      'reliability',
      'security',
      'test',
      'collab',
    ],
    description: '九大分类之一',
  },
  sourceType: {
    values: [
      'industry-standard',
      'framework-doc',
      'spec',
      'book',
      'security-baseline',
      'project-decision',
    ],
    description:
      'industry-standard=行业规范手册；framework-doc=框架官方文档；spec=语言/标准规范；book=经典著作；security-baseline=安全基线；project-decision=本项目自主决策',
  },
  status: {
    values: ['active', 'draft', 'deprecated'],
    description: 'active=参与校验与导出；draft=仅浏览不校验；deprecated=保留供追溯，不再生效',
  },
  scope: {
    values: ['server', 'client', 'both', 'any'],
    description: '作用域',
  },
  regexExpect: {
    values: ['absent', 'present'],
    description: 'absent=命中即违规（默认）；present=必须命中',
  },
  astEngine: {
    values: ['javaparser', 'pmd', 'custom'],
    description: 'AST 查询引擎',
  },
};

/** 检测层，按 static → ast → llm → manual 顺序降级。 */
export const CHECK_LAYERS = ['regex', 'ast', 'llm', 'manual'];

/** 便捷导出（校验器与生成器都从这里读，不各自复制数组）。 */
export const SEVERITY_VALUES = ENUM.severity.values;
export const CATEGORY_VALUES = ENUM.category.values;
export const SOURCE_TYPE_VALUES = ENUM.sourceType.values;
export const STATUS_VALUES = ENUM.status.values;

/** 强制级（占硬上限的那两类）。`meta.json.budget.mustHardLimit` 数的是它们。 */
export const BLOCKING_SEVERITIES = ['MUST', 'NEVER'];

/* ══════════════════════════════════════════════════════════════
   二、字段规格：契约的唯一表达
   ══════════════════════════════════════════════════════════════ */

/** 稳定 ID 形态：`<DOMAIN>-<SUBJECT>-<NNN>`，如 WEB-CTRL-002 / CONC-POOL-001。 */
export const RULE_ID_PATTERN = '^[A-Z][A-Z0-9]{2,7}-[A-Z0-9]{2,8}-[0-9]{3}$';

export const TITLE_MAX = 80;
export const RATIONALE_MIN = 20;
export const PROMPT_FRAGMENT_MAX = 300;

/** 字段 kind → 判定原语 + Schema 形态的唯一映射（引擎在 scripts/lib/spec-validate.mjs）。 */
const str = (o = {}) => ({ kind: 'string', ...o });
const int = (o = {}) => ({ kind: 'int', ...o });
const enumOf = (key, o = {}) => ({ kind: 'enum', values: ENUM[key].values, description: ENUM[key].description, ...o });
const arr = (of, o = {}) => ({ kind: 'array', of, ...o });
const obj = (fields, o = {}) => ({ kind: 'object', fields, ...o });

/** 规则的行业出处。禁止收录无出处的规则 —— 出处即权威背书。 */
export const SOURCE_SPEC = obj(
  {
    ref: str({
      required: true,
      description:
        '来源标识，含章节号，例如「阿里巴巴Java开发手册(嵩山版) 编程规约·并发处理 §6.4」',
    }),
    type: enumOf('sourceType'),
    quote: str({ description: '来源原文关键句（用于溯源核对，可省略）' }),
  },
  { label: 'source' },
);

/** 检测方式：四层可叠加，至少一层。 */
export const CHECK_SPEC = obj(
  {
    regex: obj(
      {
        pattern: str({ required: true, description: '正则表达式' }),
        flags: str({ description: 'gimsuy 子集' }),
        targetGlob: str({ description: '文件筛选，如 **/*.java' }),
        expect: enumOf('regexExpect'),
      },
      { label: 'check.regex', required: ['pattern'] },
    ),
    ast: obj(
      {
        engine: enumOf('astEngine', { default: 'javaparser' }),
        query: str({
          required: true,
          description: '结构化查询描述，如 methodParam has @RequestBody && !has @Valid',
        }),
      },
      { label: 'check.ast', required: ['query'] },
    ),
    llm: str({
      description:
        '语义判定提示。必须要求返回 {verdict: 是|否|不适用, lines: [行号], reason}；给不出行号定位的判定视为无效。',
    }),
    manual: str({ description: '无法自动判定时的人工检查清单' }),
  },
  {
    label: 'check',
    description:
      '可执行的检测方式。四层引擎按 regex → ast → llm → manual 顺序降级。**至少要有一层**，全空的话这条规则无法被任何方式验证，等于没写。',
    // 引擎的「至少一层」判据与后端 RuleLoader.inspect 同源（那条报的是 check 四层全空）。
    requireSomeField: CHECK_LAYERS,
  },
);

/** 适用范围。 */
export const APPLIES_TO_SPEC = obj(
  {
    stack: arr(str(), { description: '适用技术栈，如 spring-boot-3 / java-17 / mysql' }),
    scope: enumOf('scope', { default: 'server' }),
    pathGlob: str({ description: '适用路径，如 src/main/java/<任意目录>/controller/<任意文件>' }),
  },
  { label: 'appliesTo' },
);

/** 规则对象本体。 */
export const RULE_SPEC = obj(
  {
    id: str({
      required: true,
      pattern: RULE_ID_PATTERN,
      description:
        '稳定 ID，格式 <DOMAIN>-<SUBJECT>-<NNN>，如 WEB-CTRL-002 / CONC-POOL-001。永不复用，规则废弃后 ID 作废不回收。',
    }),
    category: enumOf('category', { required: true }),
    subcategory: str({ description: '二级分类，如 controller / exception / logging / thread-pool' }),
    title: str({
      required: true,
      maxLength: TITLE_MAX,
      description: '一句话规则陈述，必须包含「必须/禁止/应当」，不得是名词短语',
    }),
    severity: enumOf('severity', { required: true }),
    sources: arr(SOURCE_SPEC, {
      required: true,
      minItems: 1,
      description: '至少一个出处。无出处的规则不予收录。',
    }),
    rationale: str({
      required: true,
      minLength: RATIONALE_MIN,
      description:
        '为什么要有这条规则。写给 AI 看（有理由的约束遵守率更高），也写给未来的自己看。禁止写「为了代码质量」这类空话。',
    }),
    appliesTo: APPLIES_TO_SPEC,
    bad: str({
      required: true,
      description: '反例代码或反模式描述。必填 —— 写不出反例的规则说明你还没想清楚。',
    }),
    good: str({ required: true, description: '正例代码。必填。' }),
    check: { ...CHECK_SPEC, required: true },
    promptFragment: str({
      required: true,
      maxLength: PROMPT_FRAGMENT_MAX,
      description:
        '可直接注入 AI 的原子约束句子。要求：祈使句、无歧义、不依赖上下文。导出提示词时逐条拼接。',
    }),
    tags: arr(str(), { description: '检索标签，如 api / p0 / 高频踩坑' }),
    status: enumOf('status', { required: true }),
    version: int({ required: true, minimum: 1, description: '规则自身版本号，内容变更时 +1' }),
    supersedes: str({ pattern: RULE_ID_PATTERN, description: '被本条替代的旧规则 ID' }),
    updatedAt: str({ format: 'date', description: '最后修改日期（YYYY-MM-DD）' }),
  },
  {
    label: 'Rule',
    title: 'Arsenal Rule',
    description:
      '军火库规则对象。一条规范 = 一个 Rule。是「人查 / 给 AI 用 / 拿代码验」三种出口的唯一数据源。',
  },
);

/* ══════════════════════════════════════════════════════════════
   三、规则文件（分类目录下的 *.json）外壳
   ══════════════════════════════════════════════════════════════ */

/**
 * 规则文件外壳：`{ category, name, description, rules }`。
 *
 * 这是**实测出来的形状**，不是推的 —— 第一版只写了 `{ rules }`，一跑就报了 30 条
 * 「出现未登记的字段 category/name/description」。10 个文件无一例外。
 * （这恰好是这套东西的第一个正面战果：契约是被数据校正的，不是被信念规定的。）
 *
 * 三个外壳字段都与 `meta.json.categories[]` 重复，**且都是必须重复的**：
 * 后端按目录发现文件、按 meta 渲染分类，两边读的是不同来源。所以这里
 * 不删它们，而是断言它们与 meta 一致 —— 见 validate-rules.mjs 的
 * `checkFileShellMatchesMeta`。不一致的症状是「页面标题写『可靠性』、
 * 文件里写别的」这种只出现在人眼里的错。
 */
export const RULE_FILE_SPEC = obj(
  {
    category: enumOf('category', { required: true, description: '文件所属分类，必须与本文件所在目录、meta.json 的 key 三方一致' }),
    name: str({ required: true, description: '分类中文名，必须与 meta.json 的 name 一致' }),
    description: str({ required: true, description: '这一层管什么。比 meta.json 的 blurb 长，是给读者看的正文' }),
    rules: arr(RULE_SPEC, { required: true, minItems: 1 }),
  },
  { label: 'ruleFile' },
);

/* ══════════════════════════════════════════════════════════════
   四、契约自检：防止「忘了标 required」这种静默降级
   ══════════════════════════════════════════════════════════════ */

/**
 * 必填字段清单 —— **人为声明一遍，不从 fields 的 required 标记里推**。
 *
 * 为什么要重复一次（这不是啰嗦）：
 *
 *   写这一棒时就真踩过 —— `check` 忘了标 `required: true`。生成的 Schema 与校验器
 *   会**一致地**认为 `check` 可选，两边都对，于是「规则必须声明检测方式」这条铁律
 *   就这样静默消失了，而没有任何东西会报错。**从 fields 推出来的清单，
 *   永远验不出 fields 少了一项。**
 *
 *   所以这里独立声明一次意图，再由 assertContractIntegrity() 与 fields 对账。
 *   口径与手写 Schema 完全一致（12 项），未收紧也未放宽。
 */
export const RULE_REQUIRED = [
  'id',
  'category',
  'title',
  'severity',
  'sources',
  'rationale',
  'bad',
  'good',
  'check',
  'promptFragment',
  'status',
  'version',
];

/**
 * 契约自检：声明清单与字段标记必须逐项一致。不一致就抛 —— 契约自己坏了，
 * 后面生成的 Schema 与跑的校验都是错的，没有「带病继续」的理由。
 */
export function assertContractIntegrity() {
  const marked = Object.entries(RULE_SPEC.fields)
    .filter(([, f]) => f.required === true)
    .map(([k]) => k);
  const declared = [...RULE_REQUIRED];

  const missingMark = declared.filter((k) => !marked.includes(k));
  const extraMark = marked.filter((k) => !declared.includes(k));

  if (missingMark.length > 0 || extraMark.length > 0) {
    throw new Error(
      '规则契约自检失败：RULE_REQUIRED 与 RULE_SPEC.fields 的 required 标记不一致。\n' +
        (missingMark.length > 0
          ? `  · 清单里声明必填、字段却漏标 required：${missingMark.join(' / ')}\n`
          : '') +
        (extraMark.length > 0
          ? `  · 字段标了 required、清单里没有：${extraMark.join(' / ')}\n`
          : '') +
        '  处置：改 rule-contract.mjs，让两处一致 —— 两边都改对才算契约成立。',
    );
  }
}
