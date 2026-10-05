/**
 * 章程契约 —— **章程层字段规格的唯一来源**。
 *
 * ─────────────────────────────────────────────────────────────
 * 它与 `rule-contract.mjs` 的关系（这一段是全文件最要紧的设计，不读会做错）：
 *
 * 章程条款（clause）**复用 `RULE_SPEC` 的字段定义对象**，一个字段都没复制。
 * 复制是这里最该避开的做法：本仓已经为「规则对象的形状」付过一次学费 ——
 * 契约写在 `rule.schema.json`（手写）、`types.ts`（编译期擦掉）、`RuleLoader.inspect`
 * （启动时另一套判断）三处，彼此无任何东西保证一致，于是「severity 少写一个取值」
 * 这类坏值**什么都不会发生**，而「字段定义的唯一真相」一直是句空话。
 * 章程层如果再复制一遍，就是同一个病第二次发作。
 *
 * 所以这里的做法是：
 *   RULE_SPEC.fields.status        ← 直接引用，不复制
 *   CLAUSE_SPEC.fields = {
 *     ...RULE_SPEC.fields,          ← 复用全部 L0 字段（12 项必填由 RULE_REQUIRED 守）
 *     clauseOwner / decidedBy / effectiveFrom / pathGlob,   ← 章程层新增四字段
 *   }
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么新增四字段**不进** `RULE_REQUIRED`：
 *
 * `RULE_REQUIRED` 那 12 项守的是「一条 L0 规则是完整可执行的」——
 * 有出处、有正反例、有检测方式，缺一条这条规则就无法被验证。
 * 章程层是「L0 之上的项目决策」，把协作字段塞进那 12 项等于让 L0 规则
 * 也背上「必须写 clauseOwner」这种它不该背的要求。所以章程有自己的
 * `CHARTER_REQUIRED`，**独立声明一次意图，再与 fields 逐项对账** ——
 * 抄 `rule-contract.mjs` 里 `RULE_REQUIRED` 那段注释里说的道理：
 * 从 fields 的 required 标记推出来的清单，永远验不出 fields 少了一项。
 *
 * ─────────────────────────────────────────────────────────────
 * 四个协作字段各自为什么必填（缺一个会坏在哪，写清楚免得以后被当成冗余删掉）：
 *
 *   clauseOwner    这条归谁管。没有它，三个月后没人知道为什么这么定，
 *                  新人问「这条能不能破」只能靠猜。
 *   decidedBy      依据哪次决策。指向 ADR 编号。没有它，下一个人会
 *                  「顺手优化掉」一条只对某个历史场景成立的规定。
 *   effectiveFrom  **冻结线靠它计算**。缺了它，PR 门无法区分「新代码」与
 *                  「存量代码」，闸门要么全放要么全拦 —— 整套门禁直接失效。
 *   pathGlob       作用域。它同时是 L2 目录级微约定的载体与 diff 门禁的
 *                  路径裁剪依据；没有它，一条「全仓通用」的条款无法被
 *                  限定到具体模块。
 *
 * 一条都不接受 optional。理由与本仓「不撒谎」一脉相承：
 * 章程层最大的失败模式不是「写得不严」，而是「看起来有字段、实际是空的」。
 */

import {
  ENUM,
  RULE_SPEC,
  SOURCE_SPEC,
  CHECK_SPEC,
  APPLIES_TO_SPEC,
  RULE_ID_PATTERN,
  RULE_REQUIRED,
  SEVERITY_VALUES,
} from '../../arsenal-rules/_schema/rule-contract.mjs';

/* ══════════════════════════════════════════════════════════════
   一、复用 L0 的枚举（不复制第二份取值表）
   ══════════════════════════════════════════════════════════════ */

/**
 * override 动作。这是 L0↔L1 的**唯一**接口，只有三种，不多不少。
 *
 * 为什么恰好是这三种：override 要回答的问题只有「基线这条在本项目还成不成立」。
 *   tighten  成立且更严      —— 收窄，不是放宽
 *   relax    成立但可以不遵守 —— 放宽，**必须给理由与到期日**（见 OVERRIDE_SPEC）
 *   replace  不成立         —— 换掉检查方式（如项目用 MapStruct 不用手写 BeanUtils 拷贝）
 * 第四种「delete」（本项目不适用这条）被刻意排除：删掉一条基线等于宣称
 * 「所有人都不必遵守」，这与 relax（不必遵守但建议遵守）语义不同、后果更重，
 * 不给它一个名字，就没法为它写检查。
 */
export const OVERRIDE_ACTIONS = ['tighten', 'relax', 'replace'];

/** 例外状态。`orphaned` 是自检时补的第五种 —— 见 EXCEPTION_SPEC 的说明。 */
export const EXCEPTION_STATUSES = ['active', 'expired', 'repaid', 'orphaned'];

/**
 * 章程的兜底值。**实际生效值一律从章程 JSON 读，缺键即失败。**
 *
 * 这一层为什么存在、为什么不能当「默认值」用：
 *   契约需要在字段缺省时仍能给出合理形状（生成 Schema 用），所以要有兜底值。
 *   但**校验器读的是 `doc.budget.mustLimit` / `doc.policy.*`，不是这里** ——
 *   两者相等只是「恰好一致」，不是「同一个来源」。章程里不写上限时校验器会报
 *   「上限缺失」，**不会偷偷用这个值**：「上限 9999」与「不设限」是同一件事，
 *   而静默回落正是本仓反复治的那类病（契约缺键必须失败，不许回落）。
 */
export const CHARTER_BUDGET = {
  /**
   * 章程 MUST 条款数上限的兜底值。
   *
   * 为什么是 15 而不是 50：L0 的 `mustHardLimit: 50` **实测已经打满**（50/50），
   * 靠的是「人记不住就会被架空」这个先验。章程条款的读者是**本项目团队**，
   * 人更少、上下文更具体，能记住的量必然更少 —— 用同一个 50 等于没设限。
   */
  mustLimit: 15,
  /** 例外 `reason` 最小长度的兜底值。「历史原因」不算理由。 */
  exceptionReasonMin: 20,
  /** 一致性检查项 `minVariants` 的下限：写 0 等于关掉这项检查，那是静默失效。 */
  consistencyMinVariants: 1,
};

/* ══════════════════════════════════════════════════════════════
   二、字段规格
   ══════════════════════════════════════════════════════════════ */

/** 构造原语 —— 与 rule-contract.mjs 同名同义，抄它的形状而不复制它的表。 */
const str = (o = {}) => ({ kind: 'string', ...o });
const int = (o = {}) => ({ kind: 'int', ...o });
const enumOf = (key, o = {}) => ({ kind: 'enum', values: ENUM[key].values, description: ENUM[key].description, ...o });
const arr = (of, o = {}) => ({ kind: 'array', of, ...o });
const obj = (fields, o = {}) => ({ kind: 'object', fields, ...o });

/* 治理政策规格。位置要紧：它用了上面的 `obj` 构造器，必须在它之后声明 ——
   第一版把它放在「二、字段规格」之前，import 时直接 TDZ 报错。
   **这是同一个坑第二次**（第一次是 CLAUSE_REQUIRED 用了下面才声明的别名），
   所以规矩是：契约文件里凡是「用构造器」的东西，一律放在构造器定义之后。 */

/**
 * 治理政策（policy）—— **待拍板项的落点**。
 *
 * 存在的理由：设计稿列了 5 条「待拍板」，其中四条是**行为口径**而非数据 ——
 * 「例外到期硬失败还是只警告」「orphaned 判不判负」「例外要不要工单号」
 * 「条款是否占用 L0 的 50 条红线」。它们若留在代码里，拍板一次就要改一次校验器，
 * 而校验器被 41 项断言守着。放进 `policy` 之后，**拍板 = 改一行 JSON**。
 *
 * 每个字段都是**闭枚举**而不是布尔：布尔会让「关掉这条闸」与「这条闸换个口径」
 * 无法区分，而后者可能才是真实需求。
 */
export const EXCEPTION_OVERDUE_POLICIES = ['error', 'warn', 'ignore'];

export const POLICY_SPEC = obj(
  {
    /**
     * 例外到期未销账时的处置。
     *
     * · error   判负 —— 全队构建红，逼债主干活
     * · warn    警告 + 记债务账，不判负 —— 适合「例外还很多、正在收缩期」的团队
     * · ignore  完全不检查 —— **刻意提供但不建议**：它等于把闸门拆了，而
     *            「例外到期不销账」一旦没人管，登记簿三个月后就变成全员豁免名册
     */
    overdueException: {
      kind: 'enum',
      values: EXCEPTION_OVERDUE_POLICIES,
      required: true,
      description: '例外到期未销账的处置：error=判负 / warn=只警告并记债务账 / ignore=不检查（不建议）',
    },
    /**
     * 债主已离队（`orphaned`）时是否仍判负。
     *
     * **独立于 `overdueException` 是刻意的**：这两个是不同的责任归属 ——
     * 前者是「决策者欠了一个决定」，该逼人干活；后者是「决策者已经不在」，
     * 该逼团队补人。合成一个开关就分不出这两种情况了。
     */
    orphanBlocks: {
      kind: 'enum',
      values: ['error', 'warn'],
      required: true,
      description: 'orphaned 例外的处置：error=仍判负（先补人再销账）/ warn=只进债务账不判负（推荐）',
    },
    /** 例外是否必须带 `ticket`。`required` = 没有工单号就不许豁免。 */
    requireTicket: {
      kind: 'enum',
      values: ['required', 'optional'],
      required: true,
      description: 'ticket 是否必填。required=没有工单号的豁免不予受理（便于在债务账里追任务）',
    },
    /**
     * 章程条款是否**占用** L0 的 `mustHardLimit` 配额。
     *
     * 默认 `separate`：章程 MUST 用自己的 `budget.mustLimit`，与 L0 的 50 各算各的。
     * 理由：两者读者不同（L0 跨项目复用、章程只对本项目），合成一个池子会让
     * 「本项目多定几条规矩」这个正常动作去挤占别人的额度。
     * 取 `shared` 时校验器把两者相加与 L0 上限比对 —— 那样总数会变成 65，
     * 而 50 这个数的意义正是「人一次能记住的量」（它现在**已经打满** 50/50）。
     */
    budgetScope: {
      kind: 'enum',
      values: ['separate', 'shared'],
      required: true,
      description: '章程 MUST 是否与 L0 共享 50 条上限：separate=各算各的（推荐）/ shared=相加后比对',
    },
  },
  { label: 'policy' },
);

/** 政策兜底值。**仅用于 Schema 的 default 标记**；实际生效值从章程 JSON 读，缺键即失败。 */
export const CHARTER_POLICY_DEFAULTS = {
  overdueException: 'error',
  orphanBlocks: 'warn',
  requireTicket: 'required',
  budgetScope: 'separate',
};


/**
 * override 记录。
 *
 * `relax` 的三个必填（reason / approver / expiresAt）用 `requireSomeField`
 * 表达不了 —— 那个原语是「四者至少一个」，而这里要的是「relax 时这三个必须有」。
 * 判据在 `validate-charter.mjs` 的 `checkOverrideByAction`，因为**跨字段条件依赖**
 * 正是 spec-validate 不该管的那一类（它只管单字段与「同层至少一个」）。
 */
export const OVERRIDE_SPEC = obj(
  {
    ruleId: str({
      required: true,
      pattern: RULE_ID_PATTERN,
      description: '被覆盖的 L0 规则 ID。必须真实存在 —— 指向一条不存在的规则等于这条 override 永远不会生效，而没有任何东西会报错',
    }),
    action: {
      kind: 'enum',
      values: OVERRIDE_ACTIONS,
      required: true,
      description: '收紧 / 放宽 / 替换。只有这三种',
    },
    reason: str({
      minLength: CHARTER_BUDGET.exceptionReasonMin,
      description: '为什么本项目要偏离基线。relax 与 replace 必填 —— 不给理由的放宽三个月后没人敢删',
    }),
    approver: str({ description: '批准放宽的人。relax 必填 —— 放宽必须有 accountable 的名字' }),
    expiresAt: str({
      format: 'date',
      description: '放宽的到期日。relax 必填且**不接受空值**：「永久放宽」会让一次性的例外变成十年传统',
    }),
    replacement: str({
      description: '替换成的检查方式描述。replace 必填 —— 只说「不用它了」不说明「那用什么」，等于把检查交给下一个人',
    }),
    pathGlob: str({ description: '仅在该路径下生效。不填 = 全项目生效' }),
  },
  { label: 'override' },
);

/**
 * 章程条款。
 *
 * fields 直接摊 `RULE_SPEC.fields`（**同一个对象引用**），再加四个协作字段。
 * 展开运算符复制的是引用 —— 以后改 `RULE_SPEC.fields` 里某个字段的定义，
 * 章程层自动跟着变，不存在「两份要同步」这件事。
 */
export const CLAUSE_SPEC = obj(
  {
    ...RULE_SPEC.fields,
    clauseOwner: str({
      required: true,
      description: '这条归谁管 —— 新人有问题找谁。没有它，三个月后没人知道为什么这么定',
    }),
    decidedBy: str({
      required: true,
      description: '依据哪次决策（ADR 编号，如 ADR-014）。不填 = 拍脑袋的规矩 = 下次有人来改',
    }),
    effectiveFrom: str({
      required: true,
      format: 'date',
      description: '生效日。**冻结线靠它计算**：PR 门只对这一天之后的条款生效，缺了它整套门禁失效',
    }),
    pathGlob: str({
      required: true,
      description: '作用域。同时是 L2 目录级微约定的载体与 diff 门禁的路径裁剪依据',
    }),
  },
  {
    label: 'clause',
    title: 'Charter Clause',
    description:
      '章程条款 = L0 规则的全部字段 + 四个协作字段。与 L0 的差别不在形状，在**归属**：ID 走 PJX- 前缀、有 owner、生效有日期、作用域有路径。',
  },
);

/**
 * 例外记录。
 *
 * 五道闸门里只有第 1、4 条能写成字段必填（`expiresAt` / `reason` 长度），
 * 其余三条是**跨条目条件**（owner 要在 team 里、到期未销账要红、债主离队转 orphaned），
 * 判据在 `validate-charter.mjs`。
 */
export const EXCEPTION_SPEC = obj(
  {
    id: str({
      required: true,
      pattern: '^EXC-[0-9]{4}$',
      description: '例外编号，EXC-NNNN。永不复用，销账后作废不回收',
    }),
    clauseId: str({
      required: true,
      pattern: RULE_ID_PATTERN,
      description: '豁免哪条条款。必须真实存在 —— 豁免一条不存在的条款等于这份例外是空纸',
    }),
    pathGlob: str({ required: true, description: '豁免范围。与条款的 pathGlob 取交集' }),
    reason: str({
      required: true,
      minLength: CHARTER_BUDGET.exceptionReasonMin,
      description: '为什么破例。「历史原因」「暂时需要」不是理由 —— 写不出具体场景的破例申请不该被批',
    }),
    approver: str({ required: true, description: '谁批的。破例必须有人签字，否则等于没人负责' }),
    owner: str({ required: true, description: '谁还债。必须在 team 里 —— 不能甩给不存在的人' }),
    grantedAt: str({ required: true, format: 'date', description: '批准日期' }),
    expiresAt: str({
      required: true,
      format: 'date',
      description: '到期日。**必填且不接受「永久」** —— 这是防止「当年的一次性例外变成十年传统」的唯一机械保障',
    }),
    ticket: str({ description: '还债的工单号。有它才能在债务账里追到具体任务' }),
    status: {
      kind: 'enum',
      values: EXCEPTION_STATUSES,
      required: true,
      description:
        'active=生效中；expired=已到期未销账（**构建失败**）；repaid=已还清；orphaned=已到期且债主已离队（**只进债务账，不让构建失败**）',
    },
  },
  { label: 'exception' },
);

/** 一致性检查项（P3 的数据形态，P0 先把契约与闸门立住）。 */
export const CONSISTENCY_SPEC = obj(
  {
    id: str({ required: true, pattern: '^CONS-[A-Z0-9]+-[0-9]{3}$', description: '一致性检查项编号，CONS-XXX-NNN' }),
    concept: str({ required: true, description: '概念名（如「订单」）。人读的那一层' }),
    canonical: arr(str(), {
      required: true,
      minItems: 1,
      description: '唯一认可的写法。**至少一个** —— 空数组等于这项检查不检查任何东西',
    }),
    forbidden: arr(str(), { description: '明令不许的同义写法。与 canonical 的差集构成检查面' }),
    scope: str({ required: true, description: '检查范围（pathGlob）' }),
    check: obj(
      {
        type: {
          kind: 'enum',
          values: ['identifier', 'package', 'table', 'interface'],
          required: true,
          description: '比对对象。identifier=类名与字段名；package=包名；table=表名；interface=接口方法名',
        },
        minVariants: int({
          required: true,
          minimum: CHARTER_BUDGET.consistencyMinVariants,
          description: '全仓出现超过这个数量的写法就报漂移。写 0 等于关掉这项检查 —— 那是静默失效',
        }),
        report: {
          kind: 'enum',
          values: ['drift', 'block'],
          required: true,
          description:
            'drift=只报不改（**默认**，因为漂移是团队级现象，不该由一个人扛）；block=阻断。默认 drift',
        },
      },
      { label: 'check', required: ['type', 'minVariants', 'report'] },
    ),
  },
  { label: 'consistency' },
);

/** 章程文件本体。 */
export const CHARTER_SPEC = obj(
  {
    id: str({
      required: true,
      pattern: '^[a-z][a-z0-9-]{2,63}$',
      description: '项目标识，kebab-case，与文件名同 id。**刻意不强制 PREFIX- 大写** —— 章程与规则集是两种东西，规则集不能是它的文件',
    }),
    name: str({ required: true, description: '项目全称，给人看的' }),
    version: str({ required: true, description: '章程版本（semver）。章程自己的版本，不与规则集版本混' }),
    owner: str({ required: true, description: '章程本身的最终责任人。与条款的 clauseOwner 不同：这条管的是「谁管这份文件」' }),
    ratifiedAt: str({ required: true, format: 'date', description: '生效日期' }),
    team: arr(str(), {
      required: true,
      minItems: 1,
      description: '团队成员。例外登记簿的 owner 要在这里面 —— 人名不在册就说明这个人已经不在这个项目了',
    }),
    extends: str({
      required: true,
      description: '钉死基线版本，如 arsenal-rules@0.1.0。**必须钉死**：不钉的话升级基线会静默改变本项目所有条款的判定',
    }),
    /**
     * 基线的 MUST 上限**快照**（仅当 `policy.budgetScope === 'shared'` 时必填）。
     *
     * 为什么章程里要存一份 L0 上限：shared 口径下要比「L0 实际 + 章程 ≤ 共享上限」，
     * 而那个上限来自 L0 的 `meta.json#budget.mustHardLimit`。章程是**随项目走的文件**，
     * 校验器不读盘，所以这个数必须由调用方（sync 链）从 L0 侧读出来传进来。
     *
     * 那为什么不干脆让 sync 传 `l0MustLimit` 参数、章程里不存？
     * → 因为「基线上限变了」与「章程要不要跟着重算」是两个决定。把快照写进章程，
     * 升级基线时 diff 里就能看到「这条章程记录的上限是旧值」，不会静默改判定。
     * 这与 `extends` 必须钉版本是同一条道理：**跨文件的数字要有副本，才能发现漂移。**
     */
    l0MustHardLimitSnapshot: int({
      minimum: 1,
      description: 'policy.budgetScope=shared 时必填：L0 的 mustHardLimit 快照（来自 meta.json#budget）。让基线上限变化在 diff 里显形，而不是静默改判定',
    }),
    budget: obj(
      {
        mustLimit: int({
          required: true,
          minimum: 1,
          description: `MUST 条款数上限。兜底 ${CHARTER_BUDGET.mustLimit}（仅供 Schema 展示），但**必须显式写** —— 缺键判失败，不静默回落`,
        }),
      },
      {
        label: 'budget',
        // ★ `required: true` 标在 **obj 节点自己的选项**上，不是标在 fields 里。
        // 标错位置的实测症状：assertCharterContractIntegrity 报
        //   「清单里声明必填、字段却漏标 required：budget」
        // —— 因为它读的正是 `fields[k].required`。这个错只有真跑一次才会暴露。
        required: true,
      },
    ),
    policy: {
      ...POLICY_SPEC,
      // 同 budget：必填标在节点自己的选项上。
      required: true,
      description:
        '治理政策。**待拍板项的落点** —— 四条行为口径（例外到期处置 / 孤儿例外是否判负 / 工单号是否必填 / 是否占 L0 的 50 条红线）都在这里，改这里等于拍板，不用改代码。',
    },
    overrides: arr(OVERRIDE_SPEC, {
      required: true,
      description: '对 L0 基线的偏离声明。**必填（可以是空数组）** —— 缺这个键与「没有偏离」是两件事，混起来就看不出有没有偏离过',
    }),
    clauses: arr(CLAUSE_SPEC, { required: true, description: '项目专属条款' }),
    exceptions: arr(EXCEPTION_SPEC, {
      required: true,
      description: '例外登记簿。**必填（可以是空数组）** —— 一个项目刚起步时它必然是空的，但"空"必须是显式的',
    }),
    consistency: arr(CONSISTENCY_SPEC, {
      required: true,
      description: '一致性检查项。**必填（可以是空数组）** —— 同上，没配就要写成 [] 而不是不写',
    }),
  },
  {
    label: 'charter',
    title: 'Project Charter',
    description:
      '项目章程。在 L0 行业基线之上声明「本项目怎么定」，并把例外与债务显式登记成数据。',
  },
);

/* ══════════════════════════════════════════════════════════════
   三、必填清单（独立声明，再与 fields 对账）
   ══════════════════════════════════════════════════════════════ */

/**
 * 章程外壳的必填清单。
 *
 * `overrides` / `clauses` / `exceptions` / `consistency` 四项**必填但可为空数组** ——
 * 这个组合看着别扭，实际是这里最要紧的一条：它们不写，「有没有偏离过基线」
 * 「有没有破例」这些状态就变成了「文件里没这个键」与「确实没有」不可分辨。
 */
export const CHARTER_REQUIRED = [
  'id',
  'name',
  'version',
  'owner',
  'ratifiedAt',
  'team',
  'extends',
  'budget',
  'policy',
  'overrides',
  'clauses',
  'exceptions',
  'consistency',
];

/**
 * 条款的必填清单 = L0 的 12 项 + 协作 4 项。
 *
 * 写成 `RULE_REQUIRED` 的派生而不是手抄 16 个字符串：手抄的那一份
 * 才是「第二套真相」，而本仓为「同一份契约写两遍」付过学费。
 * 派生保证了两层永远同步 —— L0 改必填清单，章程层自动跟着改。
 *
 * ⚠️ 这里**必须直接用 `RULE_REQUIRED`**，不能给它起一个本地别名再用别名。
 * 第一版写的是 `const RULE_REQUIRED_SAFE = RULE_REQUIRED` 放在本常量**下面** ——
 * 于是模块顶层初始化时序（TDZ）直接抛 `Cannot access before initialization`。
 * 契约文件「看起来对」与「真的能 import」之间隔着一个加载顺序，
 * 而这个错只有真跑一次才会暴露。所以：契约文件一改，立刻 import 一次。
 */
export const CLAUSE_REQUIRED = [...RULE_REQUIRED, 'clauseOwner', 'decidedBy', 'effectiveFrom', 'pathGlob'];


/**
 * 契约自检：声明清单与字段标记必须逐项一致。
 *
 * 抄 `rule-contract.mjs` 的 `assertContractIntegrity` —— 那个文件里有一段注释
 * 解释了为什么必须「独立声明一次」：因为从 fields 推出来的清单永远验不出
 * fields 少了一项。同一份道理在这里同样成立，不重新论证一遍。
 */
export function assertCharterContractIntegrity() {
  const marked = Object.entries(CHARTER_SPEC.fields)
    .filter(([, f]) => f.required === true)
    .map(([k]) => k);
  const declared = [...CHARTER_REQUIRED];

  const missingMark = declared.filter((k) => !marked.includes(k));
  const extraMark = marked.filter((k) => !declared.includes(k));
  if (missingMark.length > 0 || extraMark.length > 0) {
    throw new Error(
      '章程契约自检失败：CHARTER_REQUIRED 与 CHARTER_SPEC.fields 的 required 标记不一致。\n' +
        (missingMark.length > 0
          ? `  · 清单里声明必填、字段却漏标 required：${missingMark.join(' / ')}\n`
          : '') +
        (extraMark.length > 0 ? `  · 字段标了 required、清单里没有：${extraMark.join(' / ')}\n` : '') +
        '  处置：改 charter-contract.mjs，让两处一致 —— 两边都改对才算契约成立。',
    );
  }

  // 条款层：16 项声明必须与 CLAUSE_SPEC.fields 的 required 标记逐项相同
  const clauseMarked = Object.entries(CLAUSE_SPEC.fields)
    .filter(([, f]) => f.required === true)
    .map(([k]) => k);
  const clauseDeclared = [...CLAUSE_REQUIRED];
  const cMissing = clauseDeclared.filter((k) => !clauseMarked.includes(k));
  const cExtra = clauseMarked.filter((k) => !clauseDeclared.includes(k));
  if (cMissing.length > 0 || cExtra.length > 0) {
    throw new Error(
      '条款契约自检失败：CLAUSE_REQUIRED 与 CLAUSE_SPEC.fields 的 required 标记不一致。\n' +
        (cMissing.length > 0 ? `  · 漏标：${cMissing.join(' / ')}\n` : '') +
        (cExtra.length > 0 ? `  · 多标：${cExtra.join(' / ')}\n` : '') +
        `  期望 ${CLAUSE_REQUIRED.length} 项，实测标记 ${clauseMarked.length} 项。`,
    );
  }
}

/** 章程层复用的枚举导出，供校验器与前端共用（避免各处硬写取值数组）。 */
export { OVERRIDE_ACTIONS as OVERRIDE_ACTION_VALUES, EXCEPTION_STATUSES as EXCEPTION_STATUS_VALUES };

/** 阻断型严重度 —— 与 L0 的 BLOCKING_SEVERITIES 同义，抄它的取值而不复制。 */
export const CHARTER_BLOCKING_SEVERITIES = SEVERITY_VALUES.filter((s) => s === 'MUST' || s === 'NEVER');

/** 供 `check` 字段复用：章程条款的检测方式与 L0 同构（同一份 CHECK_SPEC）。 */
export { CHECK_SPEC as CLAUSE_CHECK_SPEC, SOURCE_SPEC as CLAUSE_SOURCE_SPEC, APPLIES_TO_SPEC as CLAUSE_APPLIES_TO_SPEC };
