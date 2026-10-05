/**
 * validate-charter.mjs —— 章程校验器（纯函数，不读盘）。
 *
 * ─────────────────────────────────────────────────────────────
 * 为什么单独一个文件，不加进 `validate-rules.mjs`：
 *
 * 那个文件是「L0 规则集」的校验器，它的输入是 `{ categoryFiles, meta }`，
 * 它的诊断码前缀是 `RULE_*`。把「例外登记簿」这种它不认识的形状塞进去，
 * 结果是它要么报错说「未知字段」，要么为了迁就而放宽 additionalProperties ——
 * 两种都是把一个干净的校验器弄脏。章程是**另一层**，有自己的契约、自己的诊断码。
 *
 * ─────────────────────────────────────────────────────────────
 * 判定分两路，边界刻意画在「能不能用单字段规格表达」上：
 *
 *   路由一（spec-validate）  逐字段的形态 / 类型 / 枚举 / 必填 / 正则。
 *                             复用现成引擎，诊断精确到 `charter.json#clauses[3].severity`。
 *   路由二（本文件）        **跨字段 / 跨条目**的条件。五道闸门全在���一路。
 *
 * 为什么闸门不能交给 spec-validate：它只会「声明某字段是必填」，
 * 而五道闸门里有三道是「A 成立时 B 必须如何」——
 *   · relax 时 expiresAt 必填     （条件必填）
 *   · owner 必须在 team 里          （跨条目引用完整性）
 *   · 到期未销账要红、债主离队转孤儿  （跨条目 + 状态机）
 * 给 spec-validate 加条件必填语法是**为一个校验器的一处需求改一台共享引擎** ——
 * 收益不抵风险。所以条件写在用它的这一层，一层一个判据，不互相渗透。
 *
 * ─────────────────────────────────────────────────────────────
 * 纯函数的意义：它能被单测直接驱动，也能被 P0 的反着验清单逐条注入真红。
 * 本文件最后一段 `selftest()` 就是给「反着验」准备的入口。
 */

import { join, idx, ROOT, createCollector, validateSpec } from './spec-validate.mjs';
import {
  CHARTER_SPEC,
  CLAUSE_SPEC,
  EXCEPTION_SPEC,
  OVERRIDE_SPEC,
  CONSISTENCY_SPEC,
  CLAUSE_REQUIRED,
  CHARTER_REQUIRED,
  OVERRIDE_ACTIONS,
  EXCEPTION_STATUSES,
  EXCEPTION_OVERDUE_POLICIES,
  CHARTER_BUDGET,
  assertCharterContractIntegrity,
} from '../../../arsenal-rules/_schema/charter-contract.mjs';

/** 一条诊断。与 `spec-validate.mjs` 的 `{ level, code, path, message }` 同形（未另造一套）。 */
export const CHARTER_DIAGNOSTIC_CODE = {
  // 契约层
  unknownField: 'CHARTER_UNKNOWN_FIELD',
  // override
  overrideRuleNotFound: 'CHARTER_OVERRIDE_RULE_NOT_FOUND',
  overrideActionContract: 'CHARTER_OVERRIDE_ACTION_CONTRACT',
  overrideDuplicate: 'CHARTER_OVERRIDE_DUPLICATE',
  // 条款
  clauseIdNamespace: 'CHARTER_CLAUSE_ID_NAMESPACE',
  clauseDuplicateId: 'CHARTER_CLAUSE_DUPLICATE_ID',
  clauseDecidedByNotFound: 'CHARTER_CLAUSE_DECIDED_BY_NOT_FOUND',
  clauseRegexUncompilable: 'CHARTER_CLAUSE_REGEX_UNCOMPILABLE',
  clauseBudgetOverflow: 'CHARTER_CLAUSE_BUDGET_OVERFLOW',
  // 例外（五道闸门逐条一码，便于测试逐码断言「这码真的会出」）
  exceptionClauseNotFound: 'CHARTER_EXCEPTION_CLAUSE_NOT_FOUND',
  exceptionOwnerNotInTeam: 'CHARTER_EXCEPTION_OWNER_NOT_IN_TEAM',
  exceptionExpiredUnpaid: 'CHARTER_EXCEPTION_EXPIRED_UNPAID',
  exceptionOrphanRequired: 'CHARTER_EXCEPTION_ORPHAN_REQUIRED',
  exceptionDuplicateId: 'CHARTER_EXCEPTION_DUPLICATE_ID',
  exceptionOrphanNotOverdue: 'CHARTER_EXCEPTION_ORPHAN_NOT_OVERDUE',
  exceptionTicketMissing: 'CHARTER_EXCEPTION_TICKET_MISSING',
  // 一致性
  consistencyForbiddenNotDisjoint: 'CHARTER_CONSISTENCY_FORBIDDEN_NOT_DISJOINT',
  consistencyDuplicateId: 'CHARTER_CONSISTENCY_DUPLICATE_ID',
  // 章程本体
  teamDuplicate: 'CHARTER_TEAM_DUPLICATE',
  extendsUnpinned: 'CHARTER_EXTENDS_UNPINNED',
  ratifiedAfterEffective: 'CHARTER_RATIFIED_AFTER_EFFECTIVE',
};

/** 日期比较（`YYYY-MM-DD` 字典序即时间序，本仓日期格式由契约 format:'date' 保证）。 */
function isBeforeOrEqual(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a <= b;
}

/**
 * 外壳规格：只含「外壳自己的」字段。
 *
 * 四类子数组**从 fields 里摘掉**，改由 `checkSubArrays` 手查。摘掉后
 * `validateObject` 的 additionalProperties:false 会把四个键报成「未知字段」——
 * 所以 `outerFieldsOnly` 的用法是**不跑 validateSpec 的 object 分支**，
 * 而是自己遍历 fields 逐个调。理由与代价写在这里：
 *
 *   试过两条路，都死了：
 *     ① 把子结构换成 `object`（fields 填占位键）→ 实测 57 条 UNKNOWN_FIELD。
 *        spec-validate 的 `validateObject` 无条件遍历数据键查未知字段，
 *        「fields 里没登记就是违规」是硬语义，没有留白机制。
 *     ② 保留子结构但让 `of` 不递归 → `validateArray` 无条件对元素调 validateSpec，
 *        同样躲不掉。
 *
 *   结论：**不要在共享引擎上打补丁**。自己遍历 fields 调 validateSpec，
 *   换来的是「每个字段一条诊断、路径统一、子结构不重复报」——
 *   这正是拆这一层的全部收益。
 */
function outerShellSpec() {
  const fields = {};
  for (const [k, v] of Object.entries(CHARTER_SPEC.fields)) {
    if (['overrides', 'clauses', 'exceptions', 'consistency'].includes(k)) continue;
    fields[k] = v;
  }
  return { ...CHARTER_SPEC, fields };
}

/**
 * 四类子数组的「在不在、对不对」判据。
 *
 * 元素内部的字段**不在这里查**（各专用判据会查，且查得更深）—— 这里只保证
 * 「键存在且是数组、每项是对象」，这样下面的专用判据可以放心遍历。
 *
 * 必填但可为空数组：项目刚起步时 exceptions 必然是空的，但「空」必须是显式的 ——
 * 缺键与「确实没有」不可分辨，正是这里要堵的。
 */
function checkSubArrays(c, relPath, doc) {
  for (const key of ['overrides', 'clauses', 'exceptions', 'consistency']) {
    const at = `${relPath}#${key}`;
    const v = doc?.[key];
    if (v === undefined || v === null) {
      c.error(
        CHARTER_DIAGNOSTIC_CODE.unknownField,
        at,
        `${key} 缺失（写成 [] 表示确实没有 —— 缺键与「没有」是两件事，混起来看不出状态）`,
      );
      continue;
    }
    if (!Array.isArray(v)) {
      c.error(CHARTER_DIAGNOSTIC_CODE.unknownField, at, `${key} 应为数组，实际为 ${typeof v}`);
      continue;
    }
    for (let i = 0; i < v.length; i += 1) {
      if (typeof v[i] !== 'object' || v[i] === null || Array.isArray(v[i])) {
        c.error(CHARTER_DIAGNOSTIC_CODE.unknownField, `${at}[${i}]`, `${key}[${i}] 应为对象`);
      }
    }
  }
}



/* ══════════════════════════════════════════════════════════════
   主入口
   ══════════════════════════════════════════════════════════════ */

/**
 * 一条诊断。与 `spec-validate.mjs` 的 `{ level, code, path, message }` 同形（未另造一套）。
 *
 * @typedef {{ level: 'error'|'warn', code: string, path: string, message: string }} CharterDiagnostic
 */

/**
 * 校验一份章程。
 *
 * @param {object} input
 * @param {string} input.relPath 相对仓库根的路径，进诊断路径前缀
 * @param {unknown} input.doc    已解析的 JSON
 * @param {Set<string>|null} [input.knownRuleIds] L0 规则 ID 集合。给 null 时跳过
 *        「指向不存在的规则」这一类检查（仅在单独跑章程校验、无规则集上下文时）
 * @param {string} [input.today] 今天（YYYY-MM-DD），用于到期判定。**必须注入** ——
 *        读 `new Date()` 会让「到期」这条判据随运行时刻变，测试就没法稳定复现。
 * @param {string[]} [input.knownAdrs] 已登记的 ADR 编号。给了才查 decidedBy
 * @param {number|null} [input.l0MustCount] L0 规则集的 MUST+NEVER 实际条数。
 *        **仅当 `policy.budgetScope === 'shared'` 时需要** —— 校验器不读盘，
 *        所以这个数只能由调用方给（调用方有 `arsenal-rules/` 的读权限）。
 * @param {number|null} [input.l0MustLimit] L0 的硬上限（来自 meta.json#budget.mustHardLimit）。
 *        同样只在 `budgetScope === 'shared'` 时需要。
 *        缺任一个而政策是 shared → 报出，不静默跳过（跳过等于假装没超）
 * @returns {{ errors: CharterDiagnostic[], warnings: CharterDiagnostic[], stats: Record<string, number|Record<string, number>> }}
 */
export function validateCharter({
  relPath, doc, knownRuleIds = null, today, knownAdrs = null,
  l0MustCount = null, l0MustLimit = null,
}) {
  // 契约自检先行：契约自己坏了，下面每一句诊断都不可信
  assertCharterContractIntegrity();
  const c = createCollector();

  // ★ 外壳**不跑 validateSpec**，只手查四类「外壳自己的」判据；子结构全部交给各自的专用函数。
  //
  //   为什么不跑：`validateSpec` 是递归的，而 `CHARTER_SPEC` 里
  //   `clauses: arr(CLAUSE_SPEC, …)` 会一路钻到每个条款的每个字段。于是条款的
  //   缺失字段先被外壳报一次、再被 checkClauses 报一次 —— 同一问题两条诊断。
  //   试过把子结构换成宽松 object 绕开，但 spec-validate 对 object 会查
  //   `additionalProperties`（fields 为空 = **不许有任何字段**），
  //   57 条 UNKNOWN_FIELD 立刻冒出来 —— 那条路是死的。
  //   所以这里改为手查：四个数组键「在不在、是不是数组、每项是不是对象」，
  //   其余外壳字段（id/name/version/owner/ratifiedAt/team/extends/budget）走 spec-validate。
  const outerSpec = outerShellSpec();
  // 逐字段调，而不是把整份外壳交给 validateSpec 的 object 分支 ——
  // 理由见 outerShellSpec 的注释（additionalProperties:false 与「摘掉子结构键」
  // 互斥，而四条绕过方案实测全是死路）。base 传 `${relPath}#`，
  // 于是 join 出来是 `xxx.json#id`，与各专用判据手工拼的路径逐字符相同。
  for (const [key, field] of Object.entries(outerSpec.fields)) {
    validateSpec(field, doc?.[key], `${relPath}#${key}`, c, 'charter');
  }
  // 「未登记的键」由本层自己判 —— 摘掉子结构键后就没人管这件事了。
  const known = new Set(Object.keys(CHARTER_SPEC.fields));
  for (const key of Object.keys(doc ?? {})) {
    if (!known.has(key)) {
      c.error(
        CHARTER_DIAGNOSTIC_CODE.unknownField,
        `${relPath}#${key}`,
        `外壳出现未登记的字段 "${key}"（合法字段：${[...known].join(' / ')}）—— 字段名改了就等于改了契约`,
      );
    }
  }
  checkSubArrays(c, relPath, doc);

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { errors: c.errors(), warnings: c.warnings(), stats: emptyStats() };
  }

  const team = Array.isArray(doc.team) ? doc.team.filter((x) => typeof x === 'string') : [];
  const clauses = Array.isArray(doc.clauses) ? doc.clauses : [];
  const exceptions = Array.isArray(doc.exceptions) ? doc.exceptions : [];
  // ★ 用 Map 不是 Set：条款判重需要报出「首次出现在哪」，那是 Map 的 get 语义。
  // 第一版声明成 Set 再调 .get，直接 TypeError —— 但这种错只会在真跑第一条
  // 有 id 的条款时暴露，静态读代码看不出来。所以这里写注释钉住。
  const clauseIdToPath = new Map();

  // ★ 政策读一次，缺键由契约层先报出（policy 是必填）。这里不给兜底 ——
  //   静默回落正是本仓反复治的病：政策回落成默认值 = 拍板结果被悄悄忽略。
  const policy = doc.policy;
  const overdueAction = policy?.overdueException;
  const orphanAction = policy?.orphanBlocks;
  const requireTicket = policy?.requireTicket;
  const budgetScope = policy?.budgetScope;

  checkTeam(c, relPath, team);
  checkExtendsPinned(c, relPath, doc.extends);
  checkOverrides(c, relPath, doc.overrides, knownRuleIds);
  checkClauses(c, relPath, clauses, clauseIdToPath, knownAdrs);
  checkClauseBudget(c, relPath, doc, clauses, budgetScope, l0MustCount, l0MustLimit);
  checkExceptions(c, relPath, doc, exceptions, clauseIdToPath, team, today, {
    overdueAction, orphanAction, requireTicket,
  });
  checkConsistency(c, relPath, doc.consistency);
  checkRatifiedNotAfterEffective(c, relPath, doc, clauses);

  return { errors: c.errors(), warnings: c.warnings(), stats: statsOf(doc, clauses, exceptions) };
}

function emptyStats() {
  return { clauses: 0, mustClauses: 0, mustLimit: 0, exceptions: 0, overrides: 0, consistency: 0, orphaned: 0 };
}

/* ══════════════════════════════════════════════════════════════
   闸门 A：团队名册
   ══════════════════════════════════════════════════════════════ */

/**
 * `team` 不得有重复名。
 *
 * 看着是小事，实际后果是例外登记簿失去意义：owner 校验只验「在不在 team 里」，
 * 名单里有两个 `zhang` 时，**还债人到底是谁无法判定** —— 校验会放行，
 * 然后到期那天谁都以为自己不是债主。
 */
function checkTeam(c, relPath, team) {
  const seen = new Set();
  for (let i = 0; i < team.length; i += 1) {
    const name = team[i];
    if (seen.has(name)) {
      c.error(
        CHARTER_DIAGNOSTIC_CODE.teamDuplicate,
        `${relPath}#${idx('team', i)}`,
        `团队成员 "${name}" 重复登记 —— 例外的 owner 只验「在不在 team 里」，重名会让还债人无法判定`,
      );
    }
    seen.add(name);
  }
}

/**
 * `extends` 必须钉死基线版本。
 *
 * 不钉的后果不是「版本号忘了改」这么轻：升基线会**静默改变本项目每一条条款的判定**，
 * 而 diff 里看不出任何东西 —— 因为变的是被继承的规则，不是章程文件本身。
 */
function checkExtendsPinned(c, relPath, extendsVal) {
  if (typeof extendsVal !== 'string' || !extendsVal.includes('@')) {
    c.error(
      CHARTER_DIAGNOSTIC_CODE.extendsUnpinned,
      `${relPath}#extends`,
      `基线引用写作 "${extendsVal}"，缺版本号。应为 arsenal-rules@0.1.0 这样的形式 —— 不钉版本的话，升级基线会静默改变本项目每一条条款的判定，而 diff 里看不出任何东西`,
    );
  }
}

/* ══════════════════════════════════════════════════════════════
   闸门 B：override 三动作
   ══════════════════════════════════════════════════════════════ */

/**
 * override 的判据全在这里 —— 因为它们**全是条件必填**：
 *
 *   relax   必须有 reason + approver + expiresAt（「永久放宽」不接受）
 *   replace 必须有 replacement（只说「不用它了」不说明「那用什么」，等于甩锅）
 *   tighten 不需要理由（收窄是安全方向）
 *
 * 另两条：
 *   · ruleId 必须真实存在 —— 指向不存在的规则 = 这条 override 永不生效，且无人报错
 *   · 同一 ruleId 只能有一条 override —— 两条打架时无法判定谁赢
 */
function checkOverrides(c, relPath, overrides, knownRuleIds) {
  if (!Array.isArray(overrides)) return;
  const seen = new Map();

  for (let i = 0; i < overrides.length; i += 1) {
    const at = `${relPath}#${idx('overrides', i)}`;
    const ov = overrides[i];
    if (!ov || typeof ov !== 'object') continue;

    // base 传 `at` 而不是 ROOT —— 理由同 checkClauses：传 ROOT 会让同一问题报两次
    const sub = createCollector();
    validateSpec(OVERRIDE_SPEC, ov, at, sub, 'override');
    for (const d of sub.items) c.push(d);

    const action = ov.action;

    if (knownRuleIds && typeof ov.ruleId === 'string' && !knownRuleIds.has(ov.ruleId)) {
      c.error(
        CHARTER_DIAGNOSTIC_CODE.overrideRuleNotFound,
        `${at}.ruleId`,
        `指向规则 "${ov.ruleId}"，但规则集里没有这一条 —— 这条 override 永远不会生效，且没有任何东西会报错`,
      );
    }

    if (typeof ov.ruleId === 'string') {
      if (seen.has(ov.ruleId)) {
        c.error(
          CHARTER_DIAGNOSTIC_CODE.overrideDuplicate,
          `${at}.ruleId`,
          `规则 "${ov.ruleId}" 被覆盖了两次（首次在 ${seen.get(ov.ruleId)}）—— 两条 override 打架时无法判定谁赢`,
        );
      } else {
        seen.set(ov.ruleId, `${at}.ruleId`);
      }
    }

    if (action === 'relax') {
      for (const field of ['reason', 'approver', 'expiresAt']) {
        if (typeof ov[field] !== 'string' || ov[field].trim() === '') {
          c.error(
            CHARTER_DIAGNOSTIC_CODE.overrideActionContract,
            `${at}.${field}`,
            `放宽基线必须给出 ${field}。理由：放宽是唯一「让原本必须的事变成可以不」的���作 —— ` +
              (field === 'expiresAt'
                ? '没有到期日，一次性的例外就会变成十年传统'
                : '没有责任人，放宽就等于没人负责'),
          );
        }
      }
    }

    if (action === 'replace' && (typeof ov.replacement !== 'string' || ov.replacement.trim() === '')) {
      c.error(
        CHARTER_DIAGNOSTIC_CODE.overrideActionContract,
        `${at}.replacement`,
        '替换必须说明「那用什么」。只写「不用这条了」等于把检查交给下一个人 —— 而下一个人不会知道有检查',
      );
    }

    if (typeof action === 'string' && !OVERRIDE_ACTIONS.includes(action)) {
      c.error(
        CHARTER_DIAGNOSTIC_CODE.overrideActionContract,
        `${at}.action`,
        `动作 "${action}" 不在已登记的三种内：${OVERRIDE_ACTIONS.join(' / ')}。刻意不给第四种「删除」—— ` +
          '删掉一条基线等于宣称所有人都不必遵守，与 relax 语义不同、后果更重',
      );
    }
  }
}

/* ══════════════════════════════════════════════════════════════
   闸门 C：条款
   ══════════════════════════════════════════════════════════════ */

/**
 * 条款的判据。
 *
 * 逐字段（含四个协作字段的必填）走 spec-validate；这里只管三件它管不了的：
 *   1. ID 必须落在 `PJX-` 命名空间 —— 章程条款与 L0 规则**生命周期不同**，
 *      ID 不混是「一眼看出这条属于哪一层」的最省事判据。
 *   2. ID 不重复（同 L0 的理由：检索/索引/溯源三条路径会一起指错）。
 *   3. `decidedBy` 指向的 ADR 必须存在（给了 knownAdrs 才查）——
 *      「拍脑袋的规矩」与「有据可查的规矩」在半年后的区别只有这一个字段。
 */
function checkClauses(c, relPath, clauses, clauseIdToPath, knownAdrs) {
  for (let i = 0; i < clauses.length; i += 1) {
    const at = `${relPath}#${idx('clauses', i)}`;
    const cl = clauses[i];
    if (!cl || typeof cl !== 'object') continue;

    // ★ base 传 `at`（`arsenal-charter/x.json#clauses[0]`）而不是 ROOT。
    //   传 ROOT 时子字段路径也以 ROOT 起算，`d.path === ROOT` 只对根节点成立，
    //   嵌套字段走的是另一条分支 —— 结果同��个缺失字段被报两次（一次无前缀、
    //   一次有前缀）。实测症状：注入删掉 clauseOwner 后日志里出现两条
    //   SPEC_REQUIRED_MISSING。诊断重复会让真问题被淹没在噪声里。
    const sub = createCollector();
    validateSpec(CLAUSE_SPEC, cl, at, sub, 'clause');
    for (const d of sub.items) c.push(d);

    if (typeof cl.id === 'string') {
      if (!cl.id.startsWith('PJX-')) {
        c.error(
          CHARTER_DIAGNOSTIC_CODE.clauseIdNamespace,
          `${at}.id`,
          `条款 id "${cl.id}" 不在章程命名空间内。章程条款必须以 "PJX-" 开头 —— ` +
            'L0 规则跨项目复用、章程条款随项目走，ID 不混的话没人能一眼看出这条属于哪一层',
        );
      }
      if (clauseIdToPath.has(cl.id)) {
        c.error(
          CHARTER_DIAGNOSTIC_CODE.clauseDuplicateId,
          join(at, 'id'),
          `条款 id 重复（首次在 ${clauseIdToPath.get(cl.id)}）`,
        );
      } else {
        clauseIdToPath.set(cl.id, join(at, 'id'));
      }
    }

    if (knownAdrs && typeof cl.decidedBy === 'string' && !knownAdrs.has(cl.decidedBy)) {
      c.error(
        CHARTER_DIAGNOSTIC_CODE.clauseDecidedByNotFound,
        `${at}.decidedBy`,
        `依据 "${cl.decidedBy}"，但没有登记过这份决策 —— 拍脑袋的规矩与有据可查的规矩，半年后的区别只有这一个字段`,
      );
    }

    // 正则必须能编译（L0 同款判据，抄它的理由：编不过的正则在构建期是一句无害的字符串，
    // 到引擎里就是整层扫描崩掉）
    const pattern = cl?.check?.regex?.pattern;
    if (typeof pattern === 'string' && pattern !== '') {
      try {
        // eslint-disable-next-line no-new
        new RegExp(pattern);
      } catch (e) {
        c.error(
          CHARTER_DIAGNOSTIC_CODE.clauseRegexUncompilable,
          join(at, 'check.regex.pattern'),
          `正则无法编译：${(e && e.message) || String(e)}`,
        );
      }
    }
  }
}

/**
 * 条款的 MUST 数量上限。
 *
 * ⚠️ 与 L0 的 `checkBudget` 有一处**刻意的不同**：L0 超上限只 `warn`，
 * 这里超上限 `error`。理由：L0 那 50 条是跨项目的通用规范，超了降级几条影响有限；
 * 章程条款是**本项目团队要记住的**，超了意味着这套章程已经没人记得住 ——
 * 而「没人记得住的章程」比「没有章程」更糟，因为它给人「已经管住了」的错觉。
 *
 * 上限来自章程 JSON 的 `budget.mustLimit`，**不是硬编码**；口径（是否与 L0 共享）
 * 来自 `policy.budgetScope`。两条都是数据，改数据即改判定。
 */
function checkClauseBudget(c, relPath, doc, clauses, budgetScope, l0MustCount, l0MustLimit) {
  const limit = Number(doc?.budget?.mustLimit);
  if (!Number.isFinite(limit) || limit <= 0) {
    c.error(
      CHARTER_DIAGNOSTIC_CODE.clauseBudgetOverflow,
      `${relPath}#budget.mustLimit`,
      `MUST 条款上限缺失或不是正整数（缺它等于不设限，而"不设限"与"上限 9999"是同一件事）`,
    );
    return;
  }
  const must = clauses.filter((x) => x?.severity === 'MUST' || x?.severity === 'NEVER').length;

  // separate：章程各算各的（默认）。理由见 POLICY_SPEC.budgetScope 的注释。
  if (budgetScope !== 'shared') {
    if (must > limit) {
      c.error(
        CHARTER_DIAGNOSTIC_CODE.clauseBudgetOverflow,
        ROOT,
        `章程 MUST 条款 ${must} 条已超出上限 ${limit} 条 —— 没人记得住的章程比没有章程更糟，因为它给人「已经管住了」的错觉。请合并或降级几条`,
      );
    }
    return;
  }

  // shared：与 L0 的 50 条共享一个池子。此时需要一个「L0 实际条数」来比 ——
  // 而校验器不读盘，所以它只能由调用方给。**没给就报出**，不静默跳过：
  // 跳过等于「假装没超」，而这条政策正是为了「不假装」才设的。
  if (typeof l0MustCount !== 'number' || !Number.isFinite(l0MustCount)) {
    c.error(
      CHARTER_DIAGNOSTIC_CODE.clauseBudgetOverflow,
      `${relPath}#policy.budgetScope`,
      '政策声明章程与 L0 共享 50 条上限，但调用方没有提供 L0 的实际 MUST 条数（l0MustCount）—— ' +
        '不静默跳过：跳过等于假装没超。校验器不读盘，请让调用方把 arsenal-rules 的实测值传进来',
    );
    return;
  }
  // L0 的上限同样由调用方给（它来自 meta.json#budget.mustHardLimit）。
  // 不给就报 —— 与 l0MustCount 同一条理由：shared 政策下缺任何一边都无法判定。
  if (typeof l0MustLimit !== 'number' || !Number.isFinite(l0MustLimit)) {
    c.error(
      CHARTER_DIAGNOSTIC_CODE.clauseBudgetOverflow,
      `${relPath}#policy.budgetScope`,
      '政策声明共享上限，但调用方没有提供 L0 的 mustHardLimit（来自 meta.json#budget）—— 同样不静默跳过',
    );
    return;
  }
  const total = must + l0MustCount;
  if (total > l0MustLimit) {
    c.error(
      CHARTER_DIAGNOSTIC_CODE.clauseBudgetOverflow,
      ROOT,
      `policy.budgetScope = shared：L0 实测 ${l0MustCount} + 章程 ${must} = ${total} 条，`
        + `已超出共享上限 ${l0MustLimit} 条 —— 共享池子的含义就是「总数也是人一次能记住的量」`,
    );
  }
}

/* ══════════════════════════════════════════════════════════════
   闸门 D：例外登记簿（五道）
   ══════════════════════════════════════════════════════════════ */

/**
 * 五道闸门。逐条对应设计稿 §3.3。
 *
 * ⚠️ 第 3 道与第 5 道看着矛盾（「到期未销账要红」vs「债主离队不红」），
 *    分层理由是**这���件事该由谁承担**：
 *      第 3 道：债主还在团队里，是「欠了一个决定」   → 逼他干活，红
 *      第 5 道：债主已离职，是「欠的是一个人」       → 逼团队补人，只报账
 *    混在一道闸里，两个后果都出不来 —— 而且第 3 道会永久红下去。
 */
function checkExceptions(c, relPath, doc, exceptions, clauseIdToPath, team, today, policyOpts) {
  // 政策三值显式取名（不设默认）：policy 是必填字段，缺键已由契约层报出，
  // 这里若再给兜底就等于「政策被悄悄忽略」—— 那正是配置化最要防的事。
  const { overdueAction, orphanAction, requireTicket } = policyOpts;
  if (!Array.isArray(exceptions)) return;
  const teamSet = new Set(Array.isArray(doc?.team) ? doc.team : []);
  const seen = new Set();

  for (let i = 0; i < exceptions.length; i += 1) {
    const at = `${relPath}#${idx('exceptions', i)}`;
    const ex = exceptions[i];
    if (!ex || typeof ex !== 'object') continue;

    const sub = createCollector();
    validateSpec(EXCEPTION_SPEC, ex, at, sub, 'exception');
    for (const d of sub.items) c.push(d);

    if (typeof ex.id === 'string') {
      if (seen.has(ex.id)) {
        c.error(CHARTER_DIAGNOSTIC_CODE.exceptionDuplicateId, join(at, 'id'), `例外编号重复（首次在 ${seen.get(ex.id)}）`);
      }
      seen.add(ex.id);
    }

    // 闸门 0（前置）：豁免的条款必须真实存在，否则这份例外是一张空纸
    if (typeof ex.clauseId === 'string' && clauseIdToPath.size > 0 && !clauseIdToPath.has(ex.clauseId)) {
      c.error(
        CHARTER_DIAGNOSTIC_CODE.exceptionClauseNotFound,
        `${at}.clauseId`,
        `豁免条款 "${ex.clauseId}"，但章程里没有这一条 —— 豁免一张空纸，等于给检查让了一个不存在的路`,
      );
    }

    // 闸门 2：owner 必须在 team 里
    if (typeof ex.owner === 'string' && !teamSet.has(ex.owner)) {
      c.error(
        CHARTER_DIAGNOSTIC_CODE.exceptionOwnerNotInTeam,
        `${at}.owner`,
        `还债人 "${ex.owner}" 不在 team（${[...teamSet].join(' / ')}）里 —— 债务挂在一个不存在的人身上，到期时无人能销账`,
      );
    }

    const overdue = isBeforeOrEqual(ex.expiresAt, today) && ex.status !== 'repaid';

    // 闸门 5：债主已离队 → 必须标 orphaned，且此时**不红**
    if (overdue && typeof ex.owner === 'string' && !teamSet.has(ex.owner)) {
      if (ex.status !== 'orphaned') {
        c.error(
          CHARTER_DIAGNOSTIC_CODE.exceptionOrphanRequired,
          `${at}.status`,
          `到期未销账，且还债人 "${ex.owner}" 已不在 team 里 —— 此时 status 必须是 orphaned。` +
            '这一条是给「债主离职」留的出口：只进债务账高亮，不让全队构建永久红（没人能销账）',
        );
      } else if (orphanAction === 'error') {
        // policy.orphanBlocks = error：仍判负（先补人再销账）。
        // 与默认的 warn 相比，这是「把补人这件事也变成硬要求」的口径。
        c.error(
          CHARTER_DIAGNOSTIC_CODE.exceptionExpiredUnpaid,
          `${at}.status`,
          `【policy.orphanBlocks=error】孤儿例外（债主 "${ex.owner}" 已离队，到期 ${ex.expiresAt}）仍判负 —— ` +
            '这条政策的意思是「先补人再销账」，确认是你们要的口径才保留它',
        );
      } else {
        c.warn(
          CHARTER_DIAGNOSTIC_CODE.exceptionExpiredUnpaid,
          `${at}.status`,
          `孤儿例外（债主 "${ex.owner}" 已离队，到期 ${ex.expiresAt}）—— 只进债务账，不判负。请补人后销账`,
        );
      }
      continue; // 孤儿不再走第 3 道
    }

    // 闸门 3：到期未销账。**处置读 policy.overdueException** ——
    //   error（默认）逼债主干活 / warn 适合收缩期团队 / ignore 刻意提供但不建议。
    if (overdue && ex.status !== 'orphaned') {
      const msg =
        `例外已于 ${ex.expiresAt} 到期，状态仍是 "${ex.status}" —— 到期必须销账（repaid）或续期（改 expiresAt）。` +
        '这是唯一能让「例外到期」不退化成口头承诺的机制';
      if (overdueAction === 'ignore') {
        c.warn(CHARTER_DIAGNOSTIC_CODE.exceptionExpiredUnpaid, `${at}.status`, `【policy.ignore】${msg}`);
      } else if (overdueAction === 'warn') {
        c.warn(CHARTER_DIAGNOSTIC_CODE.exceptionExpiredUnpaid, `${at}.status`, `【policy.warn】${msg}`);
      } else {
        c.error(CHARTER_DIAGNOSTIC_CODE.exceptionExpiredUnpaid, `${at}.status`, msg);
      }
    }

    // 反向：还没到期就标 orphaned 是不对的（或者根本不该有这状态）
    if (ex.status === 'orphaned' && !overdue) {
      c.error(
        CHARTER_DIAGNOSTIC_CODE.exceptionOrphanNotOverdue,
        `${at}.status`,
        `状态是 orphaned 但 ${ex.expiresAt ?? '（无到期日）'} 尚未到期 —— orphaned 只用于「已到期且债主已离队」，否则它成了逃逸门`,
      );
    }

    // 闸门 6（按政策）：ticket 是否必填。
    // 为什么它独立于前五道：前五道是「例外本身合不合法」，这条是「登记的完备性」——
    // 缺工单号的例外完全可能条款正当，但没人能追到具体还债任务。
    if (requireTicket === 'required' && (typeof ex.ticket !== 'string' || ex.ticket.trim() === '')) {
      c.error(
        CHARTER_DIAGNOSTIC_CODE.exceptionTicketMissing,
        `${at}.ticket`,
        '【policy.requireTicket=required】例外必须带 ticket 工单号 —— 没有它，这笔债在债务账里追不到具体任务，' +
          '「谁还债」就只是一句话',
      );
    }

    if (typeof ex.status === 'string' && !EXCEPTION_STATUSES.includes(ex.status)) {
      c.error(
        CHARTER_DIAGNOSTIC_CODE.exceptionOrphanRequired,
        `${at}.status`,
        `状态 "${ex.status}" 不在已登记的枚举内：${EXCEPTION_STATUSES.join(' / ')}`,
      );
    }
  }
}

/* ══════════════════════════════════════════════════════════════
   闸门 E：一致性检查项
   ══════════════════════════════════════════════════════════════ */

/**
 * `forbidden` 与 `canonical` 必须不相交。
 *
 * 一条写法同时被要求「是唯一认可的」和「明令不许」，检查器面对它只能二选一，
 * 而两种选法都是静默的：选前者则 forbidden 永远不报，选后者则 canonical 名不副实。
 */
function checkConsistency(c, relPath, consistency) {
  if (!Array.isArray(consistency)) return;
  const seen = new Set();

  for (let i = 0; i < consistency.length; i += 1) {
    const at = `${relPath}#${idx('consistency', i)}`;
    const it = consistency[i];
    if (!it || typeof it !== 'object') continue;

    // ★ 逐字段形态必须在这里跑（外壳把 consistency 摘掉了，不跑就没有任何人跑）。
    //   漏掉的后果实测过：`check.minVariants: 0`（等于关掉这项检查）不再报红 ——
    //   而「静默失效」正是这一层存在的理由。四个专用判据里只有这个最初漏了，
    //   留着这行注释提醒：摘掉外壳递归 = 各自负责自己那份，包括字段级。
    const sub = createCollector();
    validateSpec(CONSISTENCY_SPEC, it, at, sub, 'consistency');
    for (const d of sub.items) c.push(d);

    if (typeof it.id === 'string') {
      if (seen.has(it.id)) {
        c.error(CHARTER_DIAGNOSTIC_CODE.consistencyDuplicateId, join(at, 'id'), `一致性检查项 id 重复（首次在 ${seen.get(it.id)}）`);
      }
      seen.add(it.id);
    }

    const canonical = new Set(Array.isArray(it.canonical) ? it.canonical : []);
    const forbidden = Array.isArray(it.forbidden) ? it.forbidden : [];
    for (let k = 0; k < forbidden.length; k += 1) {
      if (canonical.has(forbidden[k])) {
        c.error(
          CHARTER_DIAGNOSTIC_CODE.consistencyForbiddenNotDisjoint,
          `${at}.${idx('forbidden', k)}`,
          `"${forbidden[k]}" 同时出现在 canonical 与 forbidden —— 检查器面对它只能二选一，而两种选法都是静默的`,
        );
      }
    }
  }
}

/**
 * 章程的 ratifiedAt 不得**早于**任何条款的 effectiveFrom。
 *
 * 反过来才怪 —— 「8 月 15 日批准」却有一条「9 月 1 日生效」的条款，
 * 意味着有一段���里这条规矩存在但没人认它。这不是死条款，是**有一段没人负责的时窗**。
 *
 * ⚠️ 第一版把这个判据的方向写反了（`if (ratifiedAt <= effectiveFrom) continue`），
 *    后果是**正常章程全部被免检、真正该报的那条永远不报** —— 一条永不触发的断言
 *    看起来和一条一直为绿的断言毫无区别。这条是反着验清单里「唯一红的那一项」抓出来的，
 *    留着这句注释：判据的方向错了，红的次数是零而不是一。
 */
function checkRatifiedNotAfterEffective(c, relPath, doc, clauses) {
  if (typeof doc?.ratifiedAt !== 'string') return;
  for (let i = 0; i < clauses.length; i += 1) {
    const cl = clauses[i];
    if (typeof cl?.effectiveFrom !== 'string') continue;
    // 批准日 == 生效日是正常的（同一天批准并生效），所以「不早于」都要放过。
    if (doc.ratifiedAt >= cl.effectiveFrom) continue;
    c.error(
      CHARTER_DIAGNOSTIC_CODE.ratifiedAfterEffective,
      `${relPath}#${idx('clauses', i)}.effectiveFrom`,
      `条款 ${cl.id ?? '(无 id)'} 生效于 ${cl.effectiveFrom}，晚于章程批准日 ${doc.ratifiedAt} —— ` +
        '这段时间里这条规矩存在但没人认它',
    );
  }
}

/* ══════════════════════════════════════════════════════════════
   统计
   ══════════════════════════════════════════════════════════════ */

function statsOf(doc, clauses, exceptions) {
  const bySeverity = {};
  for (const cl of clauses) {
    if (typeof cl?.severity === 'string') bySeverity[cl.severity] = (bySeverity[cl.severity] ?? 0) + 1;
  }
  const byStatus = {};
  for (const ex of exceptions) {
    if (typeof ex?.status === 'string') byStatus[ex.status] = (byStatus[ex.status] ?? 0) + 1;
  }
  return {
    clauses: clauses.length,
    mustClauses: (bySeverity.MUST ?? 0) + (bySeverity.NEVER ?? 0),
    mustLimit: Number(doc?.budget?.mustLimit) || CHARTER_BUDGET.mustLimit,
    exceptions: exceptions.length,
    overrides: Array.isArray(doc?.overrides) ? doc.overrides.length : 0,
    consistency: Array.isArray(doc?.consistency) ? doc.consistency.length : 0,
    orphaned: byStatus.orphaned ?? 0,
    bySeverity,
    byStatus,
    team: Array.isArray(doc?.team) ? doc.team.length : 0,
  };
}

/** 把诊断排成可直接进构建日志的文本（错误在前，路径升序）。与 validate-rules 同形。 */
export function formatCharterDiagnostics(list) {
  const rank = (d) => (d.level === 'error' ? 0 : 1);
  return [...list]
    .sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path))
    .map((d) => `${d.level === 'error' ? '✗' : '!'} ${d.path}\n      ${d.message}`)
    .join('\n  - ');
}

export { CLAUSE_REQUIRED, CHARTER_REQUIRED };
