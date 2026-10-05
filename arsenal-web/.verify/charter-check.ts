/**
 * charter-check.ts —— 章程层断言（第 11 层的一部分，2026-10-03 新增）。
 *
 * 为什么要单独一个文件而不是塞进 scaffold-check.ts：
 *   两者性质不同。scaffold 验的是「导出的工程骨架能不能跑」，
 *   章程验的是「协作规范的治理机制是否真的生效」。混在一起会让层名
 *   与它的实际职责对不上 —— 而本仓为「名字与内容不符」付过学费
 *   （verifyChain 层名与实际跑的东西多次漂移）。所以独立。
 *
 * ★ 本层的**核心不是正例通过，是反着验**。
 *   一个只跑正例的校验器和一个不存在的校验器，在报告上长得一模一样。
 *   下面每一条「注入」都真的改坏一次数据、真的看校验器报出对应诊断码、
 *   真的还原 —— 照本仓第 3 条硬约定。只跑正例等于没验。
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { validateCharter, CHARTER_DIAGNOSTIC_CODE } from '../scripts/lib/validate-charter.mjs';
import { resolveCharterDir, readProfileCharterDir } from '../scripts/lib/charter-dir.mjs';
import * as ciLint from '../../arsenal-server/scripts/charter-ci.mjs';
import * as charterLib from '@/lib/charter';
import * as stdLib from '@/lib/standards';
import { rules as l0Rules } from '@/lib/rules';
import { lint, globToRegExp } from '@/lib/engine';
import type { CharterDoc, CharterException } from '@/lib/charter';
import { check, finish } from './lib/report';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
// 章程目录**不再写死**：与 sync-content.mjs 共用同一份解析（scripts/lib/charter-dir.mjs），
// 否则业务仓用环境变量指章程时，构建期读的是 env 指的目录、断言层读的是默认目录 ——
// 两边结论不一致，而报告全绿。见【14】。
const { dir: charterDir, source: charterDirSource, tier: charterDirTier } = resolveCharterDir({
  repoRoot,
  profileCharterDir: readProfileCharterDir(path.join(repoRoot, 'arsenal-profiles', 'arsenal.json')),
});
const rulesDir = path.resolve(repoRoot, 'arsenal-rules');

/** 全部 L0 规则 ID —— 「override 指向不存在的规则」这条判据需要它。 */
function loadRuleIds(): Set<string> {
  const ids = new Set<string>();
  for (const cat of fs.readdirSync(rulesDir)) {
    const dir = path.join(rulesDir, cat);
    if (!fs.statSync(dir).isDirectory() || cat.startsWith('_')) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      for (const r of doc.rules ?? []) ids.add(r.id);
    }
  }
  return ids;
}

const RULE_IDS = loadRuleIds();

/** L0 的 MUST+NEVER **实测**条数与硬上限（从 meta.json 与规则文件现算，不写死）。 */
const L0_MUST = (() => {
  let n = 0;
  for (const cat of fs.readdirSync(rulesDir)) {
    const dir = path.join(rulesDir, cat);
    if (!fs.statSync(dir).isDirectory() || cat.startsWith('_')) continue;
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      for (const r of doc.rules ?? []) if (r.severity === 'MUST' || r.severity === 'NEVER') n += 1;
    }
  }
  return n;
})();
const L0_LIMIT = Number(
  JSON.parse(fs.readFileSync(path.join(rulesDir, 'meta.json'), 'utf8')).budget?.mustHardLimit,
);

/** 一份可用的最小章程。注入测试都在它上面做，避免每条重写 12 个必填字段。 */
/**
 * 一份可用的最小章程。返回 `Record<string, unknown>` 而不是推断出的具体形状 ——
 * 因为反着验要 `delete d.clauses[0].rationale`，而 TS 对**非可选** 属性的 delete
 * 报 TS2790。把它放宽成索引签名是这里最省事的做法（断言脚本不需要精确类型）。
 */
function baseCharter(): Record<string, any> {
  return {
    id: 'fixture',
    name: '夹具章程',
    version: '0.1.0',
    owner: 'mryang',
    ratifiedAt: '2026-10-03',
    team: ['mryang', 'zhang'],
    extends: 'arsenal-rules@0.1.0',
    budget: { mustLimit: 15 },
    policy: {
      overdueException: 'error',
      orphanBlocks: 'warn',
      requireTicket: 'required',
      budgetScope: 'separate',
    },
    overrides: [],
    clauses: [
      {
        id: 'PJX-TEST-001',
        category: 'service',
        title: '测试条款',
        severity: 'MUST',
        sources: [{ ref: 'ADR-001', type: 'project-decision' }],
        rationale: '这是一条用于反着验的夹具条款，理由长度足够通过契约校验。',
        bad: 'bad',
        good: 'good',
        check: { regex: { pattern: 'restTemplate\\.', targetGlob: '**/*.java', expect: 'absent' } },
        promptFragment: '测试用提示词片段。',
        status: 'active',
        version: 1,
        clauseOwner: 'mryang',
        decidedBy: 'ADR-001',
        effectiveFrom: '2026-10-03',
        pathGlob: 'src/main/java/**',
      },
    ],
    exceptions: [],
    consistency: [],
  };
}

/** 校验器的返回形状。与 `validate-charter.mjs` 里那个 JSDoc typedef 同源。 */
interface CharterRun {
  errors: { code: string; path: string; message: string }[];
  warnings: { code: string; path: string; message: string }[];
  // stats 是现算的，且**混着两类值**：计数（number）与分组（object，如 bySeverity）。
  // 所以用联合的索引签名，而不是写死五个字段 —— 写死会让「统计口径新增一项」
  // 变成类型错误，而那是正常演进，不是错误。
  stats: Record<string, number | Record<string, number>>;
}

function run(doc: unknown, today = '2026-10-03'): CharterRun {
  return validateCharter({
    relPath: 'arsenal-charter/fixture.json',
    doc,
    knownRuleIds: RULE_IDS,
    today,
    l0MustCount: L0_MUST,
    l0MustLimit: L0_LIMIT,
  });
}

function codesOf(r: { errors: { code: string }[] }): string[] {
  return [...new Set(r.errors.map((e) => e.code))];
}

/* ══════════════════════════════════════════════════════════════
   一、真实章程文件：正例必须过
   ══════════════════════════════════════════════════════════════ */

const charterFiles = fs.existsSync(charterDir)
  ? fs.readdirSync(charterDir).filter((f) => f.endsWith('.json'))
  : [];

check('章程目录存在且至少有一份文件（不写「就当没有」—— 那是静默失效）', charterFiles.length > 0,
  `arsenal-charter/ 实有 ${charterFiles.length} 份`);

for (const f of charterFiles) {
  const relPath = `arsenal-charter/${f}`;
  const doc = JSON.parse(fs.readFileSync(path.join(charterDir, f), 'utf8'));
  const r = run(doc);
  check(`真实章程 ${f} 通过校验（0 error）`, r.errors.length === 0,
    r.errors.length === 0 ? `条款 ${r.stats.clauses} / 例外 ${r.stats.exceptions}` : r.errors.map((e) => `${e.path}: ${e.message}`).join(' | '));

  // id 与文件名同 id —— 与 profiles 同一套规矩，不一致时页面上会出现两套标识
  check(`章程 ${f} 的 id 与文件名一致`, doc?.id === path.basename(f, '.json'),
    `id="${doc?.id}" 文件名="${path.basename(f, '.json')}"`);
}

/* ══════════════════════════════════════════════════════════════
   二、正例：契约层与预算层
   ══════════════════════════════════════════════════════════════ */

{
  const r = run(baseCharter());
  check('夹具正例通过（基线：证明下面的注入红不是因为夹具本身就坏）', r.errors.length === 0,
    r.errors.length === 0 ? '0 error' : codesOf(r).join(','));
}

{
  // 契约与 Schema 双通道一致：章程外壳 12 项必填，两条通道必须说同一件事
  const d = baseCharter();
  delete d.extends;
  const r = run(d);
  check('外壳缺 extends → 报必填（且 extends 另有「必须钉版本」的第二道判据）',
    codesOf(r).includes(CHARTER_DIAGNOSTIC_CODE.unknownField) === false
      && r.errors.some((e) => e.path.endsWith('extends') && /必填/.test(e.message)),
    codesOf(r).join(',') || '（无诊断）');
}

{
  // 必填但可为空的四件套：overrides/clauses/exceptions/consistency
  // 缺键 = 「不知道有没有」；[] = 「确实没有」。两者不可混。
  const d = baseCharter();
  delete d.exceptions;
  const r = run(d);
  check('例外登记簿缺键（而非写成 []）→ 报必填',
    r.errors.some((e) => e.path.endsWith('exceptions')),
    codesOf(r).join(',') || '（无诊断）');
}

/* ══════════════════════════════════════════════════════════════
   三、反着验：条款四字段（逐条注入真红）
   ══════════════════════════════════════════════════════════════ */

const CLAUSE_FIELDS: Array<[string, string]> = [
  ['clauseOwner', '这条归谁管'],
  ['decidedBy', '依据哪次决策'],
  ['effectiveFrom', '生效日（冻结线靠它算）'],
  ['pathGlob', '作用域（L2 微约定载体）'],
];

for (const [field, why] of CLAUSE_FIELDS) {
  const d = baseCharter();
  delete d.clauses[0][field];
  const r = run(d);
  check(`条款缺 ${field} → 构建失败（${why}）`,
    r.errors.some((e) => e.path === `arsenal-charter/fixture.json#clauses[0].${field}`),
    codesOf(r).join(',') || '（无诊断）');
}

{
  // ★ 反向断言：只删一个字段时，**其余三个必须仍然报出来** ——
  // 否则「四个字段都必填」这句话可能只由一个字段在支撑，是假绿。
  const d = baseCharter();
  delete d.clauses[0].clauseOwner;
  const r = run(d);
  const missingPaths = r.errors.map((e) => e.path);
  check('只缺 clauseOwner 时不牵连其它字段的诊断（各字段独立判重）',
    !missingPaths.some((p) => p.includes('decidedBy') || p.includes('pathGlob')),
    missingPaths.join(' '));
}

{
  const d = baseCharter();
  d.clauses[0].id = 'WEB-CTRL-002';   // 合法 ID，但不在 PJX- 命名空间
  const r = run(d);
  check('条款用了 L0 命名空间的 id → 报命名空间（生命周期不同，ID 必须能一眼看出层次）',
    codesOf(r).includes(CHARTER_DIAGNOSTIC_CODE.clauseIdNamespace),
    codesOf(r).join(','));
}

{
  const d = baseCharter();
  d.clauses[1] = { ...d.clauses[0] };
  const r = run(d);
  check('条款 id 重复 → 报判重（检索/索引/溯源三条路径会一起指错）',
    codesOf(r).includes(CHARTER_DIAGNOSTIC_CODE.clauseDuplicateId),
    codesOf(r).join(','));
}

{
  const d = baseCharter();
  d.clauses[0].check.regex.pattern = 'restTemplate\\.(';   // 坏正则
  const r = run(d);
  check('条款正则编不过 → 报出（编不过的正则在构建期只是一句无害的字符串）',
    codesOf(r).includes(CHARTER_DIAGNOSTIC_CODE.clauseRegexUncompilable),
    codesOf(r).join(','));
}

/* ══════════════════════════════════════════════════════════════
   四、反着验：MUST 上限
   ══════════════════════════════════════════════════════════════ */

{
  const d = baseCharter();
  d.budget.mustLimit = 15;
  for (let i = 2; i <= 16; i += 1) {
    d.clauses.push({ ...d.clauses[0], id: `PJX-TEST-${String(i).padStart(3, '0')}` });
  }
  const r = run(d);
  check('MUST 条款第 16 条 → 失败（超的是 budget.mustLimit 声明值）',
    codesOf(r).includes(CHARTER_DIAGNOSTIC_CODE.clauseBudgetOverflow),
    `实测 MUST ${r.stats.mustClauses} / 上限 ${r.stats.mustLimit}；诊断 ${codesOf(r).join(',')}`);
}

{
  // 上限来自数据不是硬编码：改 JSON 里的数就改判定
  const d = baseCharter();
  d.budget.mustLimit = 20;
  for (let i = 2; i <= 16; i += 1) {
    d.clauses.push({ ...d.clauses[0], id: `PJX-TEST-${String(i).padStart(3, '0')}` });
  }
  const r = run(d);
  check('上限改为 20 后同样 16 条不再报（上限读数据，不写死）',
    !codesOf(r).includes(CHARTER_DIAGNOSTIC_CODE.clauseBudgetOverflow),
    `实测 MUST ${r.stats.mustClauses} / 上限 ${r.stats.mustLimit}`);
}

/* ══════════════════════════════════════════════════════════════
   五、反着验：override 三动作
   ══════════════════════════════════════════════════════════════ */

{
  const d = baseCharter();
  d.overrides = [{ ruleId: 'WEB-CTRL-002', action: 'relax' }];
  const r = run(d);
  const r2 = run({ ...d, overrides: [{ ruleId: 'WEB-CTRL-002', action: 'relax', reason: '本项目用统一网关封装，基线的直连写法确实不适用。', approver: 'mryang', expiresAt: '2026-12-31' }] });
  check('relax 缺 reason/approver/expiresAt → 失败', codesOf(r).includes(CHARTER_DIAGNOSTIC_CODE.overrideActionContract));
  check('relax 三字段补齐后 → 通过（这条验的是「不该红的时候没红」）',
    !codesOf(r2).includes(CHARTER_DIAGNOSTIC_CODE.overrideActionContract),
    codesOf(r2).join(',') || '0 error');
}

{
  const d = baseCharter();
  d.overrides = [{ ruleId: 'NOT-A-RULE-999', action: 'tighten' }];
  const r = run(d);
  check('override 指向不存在的规则 → 失败（否则这条 override 永不生效且无人报错）',
    codesOf(r).includes(CHARTER_DIAGNOSTIC_CODE.overrideRuleNotFound),
    codesOf(r).join(','));
}

{
  const d = baseCharter();
  d.overrides = [
    { ruleId: 'WEB-CTRL-002', action: 'tighten' },
    { ruleId: 'WEB-CTRL-002', action: 'relax', reason: '第二条覆盖同一条规则，理由写够长度以便通过长度校验。', approver: 'mryang', expiresAt: '2026-12-31' },
  ];
  const r = run(d);
  check('同一规则被覆盖两次 → 报判重（两条 override 打架时无法判定谁赢）',
    codesOf(r).includes(CHARTER_DIAGNOSTIC_CODE.overrideDuplicate),
    codesOf(r).join(','));
}

{
  const d = baseCharter();
  d.overrides = [{ ruleId: 'WEB-CTRL-002', action: 'delete' }];
  const r = run(d);
  check('第四种动作 delete → 失败（刻意不给它名字：删基线比放宽更重）',
    r.errors.some((e) => e.path.includes('action')),
    codesOf(r).join(','));
}

/* ══════════════════════════════════════════════════════════════
   六、反着验：例外登记簿五道闸门
   ══════════════════════════════════════════════════════════════ */

function charterWithException(ex: Record<string, unknown>) {
  const d = baseCharter();
  d.exceptions = [
    {
      id: 'EXC-0001',
      clauseId: 'PJX-TEST-001',
      pathGlob: 'src/main/java/legacy/**',
      reason: '历史模块尚未重构，排期在下一个迭代内完成收口，现阶段改造成本高于收益。',
      approver: 'mryang',
      owner: 'mryang',
      grantedAt: '2026-08-15',
      expiresAt: '2026-12-31',
      ticket: 'TASK-1',
      status: 'active',
      ...ex,
    },
  ];
  return d;
}

{
  const r = run(charterWithException({}));
  check('例外正例通过', r.errors.length === 0, r.errors.map((e) => e.message).join(' | ') || '0 error');
}

{
  // 闸门 1：expiresAt 必填 —— 「永久豁免」不接受
  const d = charterWithException({});
  delete d.exceptions[0].expiresAt;
  const r = run(d);
  check('闸门1 例外无到期日 → 失败（永久豁免会让一次性例外变成十年传统）',
    r.errors.some((e) => e.path.endsWith('exceptions[0].expiresAt')),
    codesOf(r).join(','));
}

{
  // 闸门 2：owner 必须在 team 里
  const r = run(charterWithException({ owner: '离职的同事' }));
  check('闸门2 还债人不在 team → 失败（债务挂在不存在的人身上，到期无人能销账）',
    codesOf(r).includes(CHARTER_DIAGNOSTIC_CODE.exceptionOwnerNotInTeam),
    codesOf(r).join(','));
}

{
  // 闸门 3：到期未销账 → 失败（债主还在，是「欠了一个决定」）
  const r = run(charterWithException({ expiresAt: '2026-09-01', status: 'active' }), '2026-10-03');
  check('闸门3 到期未销账且债主在队 → 失败', codesOf(r).includes(CHARTER_DIAGNOSTIC_CODE.exceptionExpiredUnpaid),
    codesOf(r).join(','));
}

{
  // ★ 闸门 5：债主离队 → 必须 orphaned，且**不红**
  // 这是「不该红的时候没红」的关键一条：第 3 道在债主离队时会永久红下去。
  const d = charterWithException({ expiresAt: '2026-09-01', status: 'active', owner: '已离职' });
  const r = run(d, '2026-10-03');
  check('闸门5 债主离队且未标 orphaned → 要求标 orphaned（此时仍报错，是提示）',
    codesOf(r).includes(CHARTER_DIAGNOSTIC_CODE.exceptionOrphanRequired),
    codesOf(r).join(','));

  const d2 = charterWithException({ expiresAt: '2026-09-01', status: 'orphaned', owner: '已离职' });
  const r2 = run(d2, '2026-10-03');
  check('闸门5 标成 orphaned 后 → 不再失败（只进债务账高亮）',
    !codesOf(r2).includes(CHARTER_DIAGNOSTIC_CODE.exceptionExpiredUnpaid)
      && !codesOf(r2).includes(CHARTER_DIAGNOSTIC_CODE.exceptionOrphanRequired),
    codesOf(r2).join(',') || '0 error');
}

{
  // orphaned 的反向闸：没到期就标 orphaned 是逃逸门
  const r = run(charterWithException({ status: 'orphaned' }), '2026-10-03');
  check('未到期却标 orphaned → 失败（否则 orphaned 成了绕过第 3 道的逃逸门）',
    codesOf(r).includes(CHARTER_DIAGNOSTIC_CODE.exceptionOrphanNotOverdue),
    codesOf(r).join(','));
}

{
  const r = run(charterWithException({ clauseId: 'PJX-NOPE-999' }));
  check('豁免不存在的条款 → 失败（豁免一张空纸，等于给检查让了一个不存在的路）',
    codesOf(r).includes(CHARTER_DIAGNOSTIC_CODE.exceptionClauseNotFound),
    codesOf(r).join(','));
}

{
  const d = charterWithException({ reason: '历史原因' });
  const r = run(d);
  check('例外理由短于下限 → 失败（「历史原因」不算理由）',
    r.errors.some((e) => e.path.endsWith('exceptions[0].reason')),
    codesOf(r).join(','));
}

{
  const d = charterWithException({ status: 'repaid', expiresAt: '2026-09-01' });
  const r = run(d, '2026-10-03');
  check('已销账（repaid）的过期例外 → 不再失败（销账是真出口，不是逃逸）',
    !codesOf(r).includes(CHARTER_DIAGNOSTIC_CODE.exceptionExpiredUnpaid),
    codesOf(r).join(',') || '0 error');
}

/* ══════════════════════════════════════════════════════════════
   七、反着验：一致性检查项与章程本体
   ══════════════════════════════════════════════════════════════ */

{
  const d = baseCharter();
  d.consistency = [
    {
      id: 'CONS-NAME-001',
      concept: '架构',
      canonical: ['Arch'],
      forbidden: ['Arch', 'Structure'],
      scope: 'src/main/java/**',
      check: { type: 'identifier', minVariants: 1, report: 'drift' },
    },
  ];
  const r = run(d);
  check('同一写法同时在 canonical 与 forbidden → 失败（检查器只能二选一，且两种都是静默的）',
    codesOf(r).includes(CHARTER_DIAGNOSTIC_CODE.consistencyForbiddenNotDisjoint),
    codesOf(r).join(','));
}

{
  const d = baseCharter();
  d.consistency = [
    { id: 'CONS-NAME-001', concept: '架构', canonical: ['Arch'], forbidden: [], scope: 'x/**', check: { type: 'identifier', minVariants: 0, report: 'drift' } },
  ];
  const r = run(d);
  check('minVariants 写 0 → 失败（等于关掉这项检查，而那没有任何东西会报错）',
    r.errors.some((e) => e.path.includes('minVariants')),
    codesOf(r).join(','));
}

{
  const d = baseCharter();
  d.extends = 'arsenal-rules';   // 不钉版本
  const r = run(d);
  check('基线不钉版本 → 失败（升基线会静默改变每一条判定，diff 里看不出）',
    codesOf(r).includes(CHARTER_DIAGNOSTIC_CODE.extendsUnpinned),
    codesOf(r).join(','));
}

{
  const d = baseCharter();
  d.team = ['mryang', 'mryang'];
  const r = run(d);
  check('team 重名 → 失败（重名让「还债人是谁」无法判定）',
    codesOf(r).includes(CHARTER_DIAGNOSTIC_CODE.teamDuplicate),
    codesOf(r).join(','));
}

{
  // 章程批准日早于某条款生效日 → 有一段「规矩存在但没人认」的时窗
  const d = baseCharter();
  d.ratifiedAt = '2026-09-01';
  d.clauses[0].effectiveFrom = '2026-10-03';
  const r = run(d);
  check('条款生效日晚于章程批准日 → 失败（这段时间没人认这条规矩）',
    codesOf(r).includes(CHARTER_DIAGNOSTIC_CODE.ratifiedAfterEffective),
    codesOf(r).join(','));
}

{
  // today 必须可注入：若校验器内部读 new Date()，「到期」这条判据会随运行时刻变，
  // 测试无法稳定复现。用两个不同的 today 跑同一条数据验它真的听注入的。
  const d = charterWithException({ expiresAt: '2026-10-01', status: 'active' });
  const before = run(d, '2026-09-30');
  const after = run(d, '2026-10-02');
  check('到期判据听注入的 today（不读系统时钟）—— 同一份数据两个日期两个结论',
    !codesOf(before).includes(CHARTER_DIAGNOSTIC_CODE.exceptionExpiredUnpaid)
      && codesOf(after).includes(CHARTER_DIAGNOSTIC_CODE.exceptionExpiredUnpaid),
    `09-30: ${codesOf(before).includes(CHARTER_DIAGNOSTIC_CODE.exceptionExpiredUnpaid) ? '红' : '绿'} / 10-02: ${codesOf(after).includes(CHARTER_DIAGNOSTIC_CODE.exceptionExpiredUnpaid) ? '红' : '绿'}`);
}

/* ══════════════════════════════════════════════════════════════
   八、结构自检：四类子结构各自都跑了自己的字段校验
   ══════════════════════════════════════════════════════════════ */

/**
 * 这一节守的是一类**不会被任何业务断言发现**的洞。
 *
 * 背景：外壳的 `validateSpec(CHARTER_SPEC, …)` 是**递归**的，会一路钻到每个子元素
 * 的每个字段。为了避免「同一个问题报两次」（外壳报一次 + 专用判据报一次），
 * P0 把四类子结构从外壳校验里摘掉，改由各自的专用判据负责。
 *
 * 代价是：**如果某个专用判据忘了跑自己那份 `validateSpec`，那一类子结构就彻底
 * 没人校验了**，而报告上一切正常 —— 漏掉的字段可以写任意错值。
 * 实测真发生过：`checkConsistency` 最初只做了 forbidden 交集判据，漏了字段校验，
 * 于是 `minVariants: 0`（等于关掉整项检查）不再报红。
 *
 * 所以下面不靠「记得写」，而是**逐类注入一个必填字段缺失，看有没有报出来** ——
 * 新增子结构类型时若忘了配套判据，这一项立刻红。
 */
const SUB_STRUCTURES: Array<[string, (d: ReturnType<typeof baseCharter>) => void, string]> = [
  [
    'overrides',
    (d) => {
      d.overrides = [{ ruleId: 'WEB-CTRL-002', action: 'tighten', __drop: 'action' } as never];
      delete (d.overrides[0] as Record<string, unknown>).action;
    },
    'overrides[0]',
  ],
  [
    'clauses',
    (d) => {
      delete (d.clauses[0] as Record<string, unknown>).rationale;
    },
    'clauses[0]',
  ],
  [
    'exceptions',
    (d) => {
      d.exceptions = [
        {
          id: 'EXC-0001',
          clauseId: 'PJX-TEST-001',
          pathGlob: 'x/**',
          reason: '理由长度足够通过契约校验的最小下限要求，不会因长度被拦。',
          approver: 'mryang',
          owner: 'mryang',
          grantedAt: '2026-08-15',
          expiresAt: '2026-12-31',
          status: 'active',
        },
      ];
      delete (d.exceptions[0] as Record<string, unknown>).approver;
    },
    'exceptions[0]',
  ],
  [
    'consistency',
    (d) => {
      d.consistency = [
        {
          id: 'CONS-NAME-001',
          concept: '架构',
          canonical: ['Arch'],
          forbidden: ['Structure'],
          scope: 'x/**',
          check: { type: 'identifier', minVariants: 1, report: 'drift' },
        },
      ];
      delete (d.consistency[0] as Record<string, unknown>).concept;
    },
    'consistency[0]',
  ],
];

for (const [name, mutate, pathPrefix] of SUB_STRUCTURES) {
  const d = baseCharter();
  mutate(d);
  const r = run(d);
  check(
    `结构自检：${name} 内部字段缺失能被报出（该子结构的专用判据确实跑了自己的 validateSpec）`,
    r.errors.some((e) => e.path.includes(pathPrefix)),
    `实际诊断 ${r.errors.length} 条：${codesOf(r).join(',') || '（无）'}`,
  );
}

/* ══════════════════════════════════════════════════════════════
   九、政策生效断言 —— 「配置化」这件事本身的验收
   ══════════════════════════════════════════════════════════════ */

/**
 * 上面 41 项验的是「判据在默认政策下工作」。这一节验的是**改 policy 真能改判定**。
 *
 * 为什么必须单独一节：配置化的失败方式很隐蔽 —— 字段写进契约了、文档也写了，
 * 但校验器里**忘了读它**。那样默认值下一切正常，报告全绿，而「拍板改一行 JSON」
 * 这个承诺是假的。这正是本仓那句「永远不会触发的断言和一直为绿的断言长得一模一样」。
 *
 * 所以每条政策都做成**一对**：一个注入 → 期望不红；一个反向 → 期望红。
 */
{
  // policy 必填：缺它判失败，不静默回落成默认值。
  const d = baseCharter();
  delete (d as Record<string, unknown>).policy;
  const r = run(d);
  check('policy 缺键 → 失败（缺键不静默回落：回落等于拍板结果被悄悄忽略）',
    r.errors.some((e) => e.path.endsWith('#policy')),
    codesOf(r).join(',') || '（无诊断）');
}

{
  // overdueException: error → 判负
  const d = charterWithException({ expiresAt: '2026-09-01', status: 'active' });
  const strict = run(d, '2026-10-03');
  // 改成 warn → 同一个数据不该再判负
  const dWarn = charterWithException({ expiresAt: '2026-09-01', status: 'active' });
  dWarn.policy.overdueException = 'warn';
  const warn = run(dWarn, '2026-10-03');

  check('policy.overdueException=error → 到期未销账判负（默认）',
    codesOf(strict).includes(CHARTER_DIAGNOSTIC_CODE.exceptionExpiredUnpaid));
  check('policy.overdueException=warn → 同一份数据不再判负（只警告并记债务账）',
    !codesOf(warn).includes(CHARTER_DIAGNOSTIC_CODE.exceptionExpiredUnpaid),
    `实际诊断 ${warn.errors.length} 条 / 警告 ${warn.warnings.length} 条`);
  check('policy.overdueException=warn 时警告必须真打出来（不打出来的警告等于没有）',
    warn.warnings.some((w) => w.code === CHARTER_DIAGNOSTIC_CODE.exceptionExpiredUnpaid),
    `警告码：${[...new Set(warn.warnings.map((w) => w.code))].join(',') || '（无）'}`);
}

{
  // orphanBlocks: error → 孤儿例外仍判负（默认 warn 不判负）
  const mk = (action: string) => {
    const d = charterWithException({ expiresAt: '2026-09-01', status: 'orphaned', owner: '已离职' });
    d.policy.orphanBlocks = action;
    return run(d, '2026-10-03');
  };
  const asWarn = mk('warn');
  const asError = mk('error');
  check('policy.orphanBlocks=warn → 孤儿例外不判负（默认，只进债务账）',
    !codesOf(asWarn).includes(CHARTER_DIAGNOSTIC_CODE.exceptionExpiredUnpaid));
  check('policy.orphanBlocks=error → 孤儿例外判负（先补人再销账的口径）',
    codesOf(asError).includes(CHARTER_DIAGNOSTIC_CODE.exceptionExpiredUnpaid),
    codesOf(asError).join(',') || '（无诊断）');
}

{
  // requireTicket: required → 无 ticket 判负；optional → 放过
  const noTicket = charterWithException({});
  delete (noTicket.exceptions[0] as Record<string, unknown>).ticket;
  const strict = run(noTicket);
  const opt = charterWithException({});
  delete (opt.exceptions[0] as Record<string, unknown>).ticket;
  opt.policy.requireTicket = 'optional';
  const loose = run(opt);
  check('policy.requireTicket=required → 无 ticket 判负（这笔债追不到任务）',
    codesOf(strict).includes(CHARTER_DIAGNOSTIC_CODE.exceptionTicketMissing),
    codesOf(strict).join(',') || '（无诊断）');
  check('policy.requireTicket=optional → 无 ticket 放过',
    !codesOf(loose).includes(CHARTER_DIAGNOSTIC_CODE.exceptionTicketMissing),
    codesOf(loose).join(',') || '0 error');
}

{
  // budgetScope: shared → 与 L0 相加比对；separate → 各算各的
  const d = baseCharter();
  d.policy.budgetScope = 'shared';
  // 章程 1 条 MUST + L0 实测 50（断言层现读）> 共享上限 50 → 应报
  const shared = run(d);
  check('policy.budgetScope=shared → 章程 MUST 计入 50 条共享池（1+50 > 50 应报）',
    codesOf(shared).includes(CHARTER_DIAGNOSTIC_CODE.clauseBudgetOverflow),
    `L0 实测 MUST ${L0_MUST} / 共享上限 ${L0_LIMIT}；诊断 ${codesOf(shared).join(',') || '（无）'}`);

  // shared 但没给 L0 两个数 → 报「无法判定」，不静默跳过
  const noL0 = validateCharter({
    relPath: 'arsenal-charter/fixture.json',
    doc: d,
    knownRuleIds: RULE_IDS,
    today: '2026-10-03',
  });
  check('policy.budgetScope=shared 但未提供 L0 侧数据 → 报出（跳过等于假装没超）',
    noL0.errors.some((e) => e.message.includes('L0')),
    codesOf(noL0).join(',') || '（无诊断）');
}

{
  // 反向：把上限从 15 改成 1000，同一份数据不该再红。
  // 这条与上面那条成对 —— 它守的是「数据真的驱动判定」，而不只是「代码里有这段 if」。
  const d = baseCharter();
  d.budget.mustLimit = 1000;
  for (let i = 2; i <= 40; i += 1) d.clauses.push({ ...d.clauses[0], id: `PJX-TEST-${String(i).padStart(3, '0')}` });
  const r = run(d);
  check('budget.mustLimit 改成 1000 后 40 条 MUST 不再报（上限真读数据）',
    !codesOf(r).includes(CHARTER_DIAGNOSTIC_CODE.clauseBudgetOverflow),
    `实测 MUST ${r.stats.mustClauses} / 上限 ${r.stats.mustLimit}`);
}


/* ══════════════════════════════════════════════════════════════
   十、P1 页面契约（2026-10-03）—— 页面存在、派生逻辑对、导航挂上
   ══════════════════════════════════════════════════════════════ */

/**
 * 纯函数层用**静态 import** 而非 `await import`：
 * 顶层 await 在本仓的 tsx 配置下（cjs 输出）直接编译失败。
 * 静态 import 的代价是它必须在文件顶部 —— 而它 import 的 `@/lib/charter` 读的是
 * `src/generated/charter.json`，那个文件由 prebuild 的 sync 链保证存在。
 * 缺文件时是**加载期报错**而不是「静默 undefined」，这比 await 的写法更早暴露问题。
 */

/**
 * 取「真实章程的 doc」。取不到就抛 —— 因为下面每一条页面断言都建立在它之上，
 * 而「静默返回一个空壳」会让这些断言全部变成对空对象求值（恒真）。
 */
function primaryCharterDoc() {
  const d = charterLib.primaryCharter?.doc;
  if (!d) throw new Error('arsenal-charter/ 下没有可用章程 —— 页面契约断言无从验证，先修数据源');
  return d;
}

/** 从真实条款上借一条，改成「已到期」夹具。借而不造是为了不引入第二份条款数据。 */
interface CharterDocLike {
  clauses: { id: string; clauseOwner: string; severity: string; title: string }[];
  exceptions: { id: string; clauseId: string; status: string; owner: string }[];
  team: string[];
  policy: { overdueException: string };
  [k: string]: unknown;
}

interface CharterExceptionLike {
  id: string;
  clauseId: string;
  pathGlob: string;
  reason: string;
  approver: string;
  owner: string;
  grantedAt: string;
  expiresAt: string;
  status: string;
}

{
  // ① 纯函数层必须存在且导全了 —— 页面靠它们算，缺一个页面就崩。
  // 断言的导出清单**故意不全** —— 全列出来会变成第二份要维护的表。
  // 这里只钉住「页面真正 import 的那些」，数量变化不靠手写。
  const need = [
    'charters', 'primaryCharter', 'charterTotals', 'l0View', 'todayOf',
    'isClauseInForce', 'isClauseMachineCheckable', 'clauseCheckLayer',
    'sortedClauses', 'sortedExceptions', 'debtLedger', 'exceptionCountFor',
    'exceptionDisposition', 'budgetView', 'overrideView', 'consistencyMode',
    'severityBadgeClass', 'dispositionToneClass', 'layerBadgeClass', 'actionToneClass',
  ];
  const missing = need.filter((k) => (charterLib as Record<string, unknown>)[k] === undefined);
  check('charter.ts 导出齐全（页面依赖的每个派生函数都在）', missing.length === 0,
    missing.length ? `缺：${missing.join(' / ')}` : `${need.length} 个导出齐`);
}

{
  // ② today 必须是**构建期注入**的值，不能是渲染时刻。
  // 判据形状：todayOf() 返回一个能在快照里查到的日期字符串。
  // 拿不到时它返回 ''（保守侧）—— '' 也能过这一条，所以再加一条反向：
  const t = charterLib.todayOf();
  check('todayOf() 读到构建期注入的日期（非 new Date()）',
    typeof t === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t),
    `todayOf() = ${JSON.stringify(t)}`);
  const raw = JSON.parse(fs.readFileSync(path.join(repoRoot, 'arsenal-web', 'src', 'generated', 'charter.json'), 'utf8'));
  check('快照里的 today 与 todayOf() 同源（构建期判的与页面显示的是同一天）',
    raw?.today === t,
    `快照 ${raw?.today} vs todayOf() ${t}`);
}

{
  // ③ L0 侧两个数必须来自快照且**等于实测**。
  // 页面是静态导出，拿不到文件系统 —— 页面上算就是假数字。所以这里断言
  // 「快照里的数 == 现在现扫规则集算出的数」，防止它悄悄过期。
  const raw = JSON.parse(fs.readFileSync(path.join(repoRoot, 'arsenal-web', 'src', 'generated', 'charter.json'), 'utf8'));
  check('快照 l0.must 等于规则集实测（MUST+NEVER），没有过期',
    raw?.l0?.must === L0_MUST,
    `快照 ${raw?.l0?.must} vs 实测 ${L0_MUST}`);
  check('快照 l0.limit 等于 meta.json 的 mustHardLimit',
    raw?.l0?.limit === L0_LIMIT,
    `快照 ${raw?.l0?.limit} vs 档案 ${L0_LIMIT}`);
  check('l0 声明值与实测值无漂移（漂移时页面会显式提示，这里守住它没漂）',
    charterLib.l0DeclarationDrift === false,
    `声明 ${raw?.l0?.hardLimitDeclared} / 实测 ${L0_MUST}`);
}

{
  // ④ 派生逻辑：排序与聚合
  const doc = primaryCharterDoc();
  const today = charterLib.todayOf();

  const cs = charterLib.sortedClauses(doc.clauses, today);
  check('sortedClauses 返回条数不丢（排序不是过滤）', cs.length === doc.clauses.length,
    `${cs.length}/${doc.clauses.length}`);
  // 排序稳定性：同参数两次调用逐项 id 相同（纯函数不掺随机）
  const cs2 = charterLib.sortedClauses(doc.clauses, today);
  check('sortedClauses 同参数两次调用逐项相同（纯函数）',
    cs.every((c, i) => c.id === cs2[i]?.id),
    cs.map((c) => c.id).join(','));

  const ex = charterLib.sortedExceptions(doc.exceptions, doc, today);
  check('sortedExceptions 返回条数不丢', ex.length === doc.exceptions.length,
    `${ex.length}/${doc.exceptions.length}`);

  const debt = charterLib.debtLedger(doc, today);
  check('debtLedger 每个条款一行（不按例外聚合 —— 那会看出「哪条规矩在持续吃豁免」）',
    debt.length === doc.clauses.length,
    `债务账 ${debt.length} 行 / 条款 ${doc.clauses.length} 条`);
  // 债务账按 openDebt 降序
  const debtOk = debt.every((r, i) => i === 0 || (debt[i - 1]?.openDebt ?? 0) >= r.openDebt);
  check('debtLedger 按未销账数降序（最吃豁免的规矩排在最前）', debtOk,
    debt.map((r) => `${r.clauseId}:${r.openDebt}`).join(' '));
  // 守恒：各行 openDebt 之和 == 未销账例外总数
  const sumOpen = debt.reduce((n, r) => n + r.openDebt, 0);
  const expectOpen = doc.exceptions.filter((e) => e.status !== 'repaid').length;
  check('债务账守恒：各行 openDebt 之和 == 未销账例外总数', sumOpen === expectOpen,
    `行和 ${sumOpen} vs 未销账 ${expectOpen}`);
}

{
  // ⑤ 例外处置随 policy 变（前端这一侧也要验，页面徽标颜色就是读它）
  const doc = primaryCharterDoc();
  const today = charterLib.todayOf();
  const overdue: CharterException = {
    id: 'EXC-9001', clauseId: String(doc.clauses[0]?.id ?? 'PJX-UNKNOWN'), pathGlob: 'x/**',
    reason: '探针夹具，理由长度足够通过契约下限要求，不触发长度判据。',
    approver: 'mryang', owner: doc.team[0] ?? 'mryang',
    grantedAt: '2026-01-01', expiresAt: '2026-01-02', status: 'active',
  };
  const strict = charterLib.exceptionDisposition(overdue, doc, today);
  const warnDoc = { ...doc, policy: { ...doc.policy, overdueException: 'warn' as const } };
  const warn = charterLib.exceptionDisposition(overdue, warnDoc, today);
  check('例外处置读 policy：error → error 级、warn → warn 级（前端徽标跟着变）',
    strict.level === 'error' && warn.level === 'warn',
    `error 档 ${strict.level} / warn 档 ${warn.level}`);
}

{
  // ⑥ shared 口径：L0 数据拿不到时**如实说无法计算**，不显示 0%
  const doc = primaryCharterDoc();
  const sharedDoc = { ...doc, policy: { ...doc.policy, budgetScope: 'shared' as const } };
  const withData = charterLib.budgetView(sharedDoc, 50, 50);
  const noData = charterLib.budgetView(sharedDoc, null, null);
  check('shared 口径有数据时算出总量（50+1=51 / 上限 50）', withData.must === 51 && withData.usedPct === 100,
    JSON.stringify({ must: withData.must, pct: withData.usedPct }));
  check('shared 口径缺 L0 数据时如实说「无法计算」而不是显示 0%',
    typeof noData.sharedNote === 'string' && noData.sharedNote.includes('无法计算'),
    noData.sharedNote ?? '（无说明 → 会渲染成 0% 假数字）');
}

{
  // ⑦ 页面与导航：文件真存在 + 侧栏挂上 + 静态产物里真有这一页
  const appDir = path.join(repoRoot, 'arsenal-web', 'src', 'app', 'charter');
  check('页面文件真存在（page.tsx / CharterConsole.tsx / CharterPanels.tsx）',
    ['page.tsx', 'CharterConsole.tsx', 'CharterPanels.tsx'].every((f) => fs.existsSync(path.join(appDir, f))),
    ['page.tsx', 'CharterConsole.tsx', 'CharterPanels.tsx'].filter((f) => !fs.existsSync(path.join(appDir, f))).join(',') || '三件齐');

  const shell = fs.readFileSync(path.join(repoRoot, 'arsenal-web', 'src', 'components', 'Shell.tsx'), 'utf8');
  // 2026-10-05：侧栏入口从 /charter 迁到 /standards（工程规范台）。判据跟着改路由 ——
  // 页面不在导航里就等于不存在，而「存在」指的是**读者能点到的那一个**。
  check('侧栏 NAV 挂上 /standards（页面不在导航里就等于不存在）',
    /href:\s*'\/standards'/.test(shell),
    "NAV 里没有 href: '/standards'");
  check('侧栏图标有（glyph 不缺 —— 缺了导航行会空一格）',
    shell.includes("glyph: '§'") || /label:\s*'项目章程'/.test(shell),
    '未找到项目章程的 glyph');
}

/* ══════════════════════════════════════════════════════════════
   十一、/check 项目模式（章程并入规则池）
   ══════════════════════════════════════════════════════════════ */

{
  // 静态 import（不用 await import）—— 本仓 tsx 是 cjs 输出，顶层 await 编译失败。
  const { charterLintPreview } = charterLib;

  const merged = charterLib.appendCharterToRuleSet(l0Rules);
  const pj = merged.filter((r) => r.id.startsWith('PJX-'));
  const expectPj = charterLib.charters.reduce((n, e) => n + e.doc.clauses.length, 0);

  check('项目模式把章程条款并进规则池（增量 == 章程条款数）',
    merged.length === l0Rules.length + expectPj && pj.length === expectPj,
    `L0 ${l0Rules.length} + 章程 ${expectPj} = ${merged.length}（PJX 实有 ${pj.length}）`);

  check('**不改** L0 原数组（`rules` 被导航徽标与统计页读，原地改会污染「69 条」）',
    l0Rules.every((r) => !r.id.startsWith('PJX-')),
    `L0 池里出现了 ${l0Rules.filter((r) => r.id.startsWith('PJX-')).length} 条 PJX`);

  // 反向：只有夹具成立。先看真数据里有没有正则条款。
  const regexClauses = pj.filter((r) => r._checkLayer === 'regex');
  if (regexClauses.length === 0) {
    check('（跳过）本章程无正则层条款，无法做端到端反验', true, '数据条件不满足');
  } else {
    // 造一个必然命中的文件：内容就是这条条款的 bad 示例。
    // 不用 `!` 非空断言（那是 TSX 语法，`.ts` 里非法）；找不到就跳过而不是崩。
    const target = regexClauses[0];
    const doc0 = primaryCharterDoc();
    const cl0 = doc0.clauses.find((c) => c.id === target?.id);
    if (!target || !cl0) {
      check('（跳过）正则条款在 doc 里找不到对应条款，无法端到端反验', true, '数据不一致');
      throw new Error('SKIP_REST');
    }
    const hit = lint([{ name: 'com/example/Sample.java', content: cl0.bad }], merged);
    const chHit = charterLintPreview(hit);
    const l0Only = charterLintPreview(lint([{ name: 'com/example/Sample.java', content: cl0.bad }], l0Rules));
    check('端到端：把条款的 bad 示例喂进去，章程层真检出',
      chHit.some((x) => x.ruleId === target.id),
      `命中 ${chHit.map((x) => `${x.ruleId}@L${x.line}`).join(',') || '无'}`);
    check('反证：仅 L0 时不产生该命中（证明命中来自章程而非基线巧合）',
      l0Only.length === 0,
      `仅 L0 命中 ${l0Only.length} 条`);
    check('章程命中带上 owner 与依据（报告里只说「违规了」等于没说）',
      chHit.every((x) => x.clauseOwner !== '（条款未在快照中）' && x.decidedBy !== '—'),
      chHit[0] ? `owner=${chHit[0].clauseOwner} decidedBy=${chHit[0].decidedBy}` : '（无命中）');
  }

  const nNotExec = charterLib.charterNotExecutableCount();
  const nCharterTotal = charterLib.charters.reduce((n, e) => n + e.doc.clauses.length, 0);
  check('本机跑不了的**章程条款**数被算出来（页面要显示它，否则「0 违规」等于「没查」）',
    typeof nNotExec === 'number',
    `本机不可执行 ${nNotExec} 条（章程共 ${nCharterTotal} 条）`);
  check('**不把 L0 的非正则规则算成「章程条款没跑」**（第一版漏了 PJX- 前缀，页面显示 34 而章程只有 2 条）',
    nNotExec <= nCharterTotal,
    `不可执行 ${nNotExec} ≤ 章程总数 ${nCharterTotal}`);
}

/* ══════════════════════════════════════════════════════════════
   十二、P2 导出（MCP 三工具在 parity 层验；这里验三个导出函数）
   ══════════════════════════════════════════════════════════════ */

{
  const doc = primaryCharterDoc();
  const today = charterLib.todayOf();

  const md = charterLib.buildCharterMarkdown(doc, today);
  check('buildCharterMarkdown 出内容且不算空', md.trim().length > 200, `${md.length} 字符`);

  // 六个章节一个都不能少 —— 少一个读者就少一块信息，而 Markdown 不会报错
  const needSections = ['## 治理政策', '## 条款', '## 对行业基线的偏离', '## 例外登记簿', '## 命名一致性', '## 这份章程怎么被检查'];
  const missingSec = needSections.filter((k) => !md.includes(k));
  check('规范书六个章节齐备', missingSec.length === 0, missingSec.join(',') || needSections.length + ' 章齐');

  check('规范书含全部条款 id（一条都不少）', doc.clauses.every((c) => md.includes(c.id)),
    doc.clauses.filter((c) => !md.includes(c.id)).map((c) => c.id).join(',') || `${doc.clauses.length} 条齐`);
  check('规范书含全部例外 id', doc.exceptions.every((e) => md.includes(e.id)),
    doc.exceptions.filter((e) => !md.includes(e.id)).map((e) => e.id).join(',') || `${doc.exceptions.length} 笔齐`);
  // 判据用**中文标签**（规范书里渲染出来的样子），不是 policy 的字段名。
  // 写成字段名会得到「一定红」—— 读者看到的从来是中文，断言该验读者能看到的东西。
  check('规范书带 policy 四项口径（读者需要先知道例外到期会不会红）',
    ['例外到期未销账', '孤儿例外', '例外工单号', 'MUST 配额'].every((k) => md.includes(k)),
    '缺：' + ['例外到期未销账', '孤儿例外', '例外工单号', 'MUST 配额'].filter((k) => !md.includes(k)).join(','));
  check('规范书把 policy 的**取值**也写出来（只写字段名等于没说清口径）',
    md.includes(doc.policy.overdueException),
    `overdueException=${doc.policy.overdueException}`);
  check('规范书带判定日（写明「按哪天算」而不是让人以为永远有效）', md.includes(today) || today === '',
    `today = ${today}`);

  // 标题重复：doc.name 常已含「工程章程」，渲染时再拼一次就成了「… · 工程章程 · 工程章程」。
  // 这类问题**数据没错、断言全绿**，只有成品里看得见。
  const titleLine = md.split('\n')[0] ?? '';
  const dup = (titleLine.match(/工程章程/g) ?? []).length > 1;
  check('规范书标题不重复拼接（name 常已含「工程章程」）', !dup, titleLine);

  const ci = charterLib.buildCharterCI({ projectName: doc.name });
  check('CI 片段含两个 job（PR 门 + 存量账）', ci.includes('pr-gate') && ci.includes('debt-audit'), '');
  check('CI 片段 PR 门只查 diff 触及的文件（存量不合规不该阻断）', ci.includes('--mode pr') && ci.includes('git diff --name-only'), '');
  check('CI 片段存量任务只出报告不阻断（--mode audit）', ci.includes('--mode audit'), '');
  check('CI 片段**不写死判负口径**（判负读用户章程的 policy，改 policy 不用改 yml）',
    !ci.includes('overdueException') && !ci.includes('orphanBlocks'),
    '片段里出现了 policy 字段名 = 越权写死了口径');
  check('CI 片段定时任务刻意避开整点', /cron: '\d+ [1-9]/.test(ci) || ci.includes('17 3'), '');

  const files = charterLib.charterDeliverableFiles(doc);
  check('交付文件三份（规范书 / CI / 归档 JSON）', files.length === 3, files.map((f) => f.path).join(', '));
  check('交付文件里的 CI 片段与单独调用一致（同一份数据两个出口不许分叉）',
    files.find((f) => f.path.endsWith('.yml'))?.content === ci, '');

  // 空章程 / 无例外 都不许崩，且要说出「没有」而不是留空
  const empty = { ...doc, clauses: [], exceptions: [], overrides: [], consistency: [] };
  const mdEmpty = charterLib.buildCharterMarkdown(empty, today);
  check('空章程的规范书不崩且明说「无例外 / 未配置」',
    mdEmpty.includes('无例外') && mdEmpty.includes('未配置'),
    `${mdEmpty.length} 字符`);

  // 【13】事实源登记 —— 硬约定第 4 条「加事实源改四处」里，本层能守的两处
  // arsenal-charter/ 是本仓第 7 个事实源目录（手写 JSON，随项目走）。
  // 它进了 sync（构建期闸门）就够了，但 README 目录树与项目档案 project.dirs
  // 若漏登记，**没有任何东西会报错** —— 而它们正是「换项目只加这里」这句承诺的载体。
  console.log('\n【13】事实源登记（硬约定第 4 条）');
  const rootReadme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  check('README 目录树登记了 arsenal-charter/',
    rootReadme.includes('arsenal-charter'),
    '整份 README 0 命中 —— 新事实源目录没进目录树，换项目时没人知道要建它');
  const profileRaw = JSON.parse(fs.readFileSync(path.join(repoRoot, 'arsenal-profiles', 'arsenal.json'), 'utf8'));
  const profileDirs: string[] = Array.isArray(profileRaw?.project?.dirs)
    ? profileRaw.project.dirs.map((d: any) => String(d?.path ?? ''))
    : [];
  check('项目档案 project.dirs 登记了 arsenal-charter/',
    profileDirs.some((p) => p.replace(/\/+$/, '') === 'arsenal-charter'),
    `现有 ${profileDirs.length} 项: ${profileDirs.join(' / ')}`);
}

// 【14】章程目录三档优先级 —— 2026-10-05 补。
//
// 这三档此前**零断言**：解析逻辑内联在 sync 里，断言层对着源码文本只能「看起来对」。
// 把 `??` 顺序写反、把 env 拼成 profile，报告照样全绿 —— 而失败形态是
// 「构建期校验了 A 目录的章程、断言层校验了 B 目录的」，两边都绿、结论相反。
// 现在解析只有一份（scripts/lib/charter-dir.mjs），下面既验它本身，也验 sync 确实在用它。
{
console.log('\n【14】章程目录三档优先级（默认 / 档案 / 环境变量）');

const R = (env: Record<string, string | undefined>, profile: string | null = null) =>
  resolveCharterDir({ repoRoot, env, profileCharterDir: profile });

const dEnv = R({ ARSENAL_CHARTER_DIR: 'biz-charter' }, 'profile-charter');
const dProfile = R({}, 'profile-charter');
const dDefault = R({}, null);

check('三档：环境变量压过档案声明', dEnv.tier === 3 && dEnv.dir === path.resolve(repoRoot, 'biz-charter'),
  `tier=${dEnv.tier} dir=${dEnv.dir}`);
check('三档：档案声明压过内置默认', dProfile.tier === 2 && dProfile.dir === path.resolve(repoRoot, 'profile-charter'),
  `tier=${dProfile.tier} dir=${dProfile.dir}`);
check('三档：都没配时用内置默认 <repo>/arsenal-charter',
  dDefault.tier === 1 && dDefault.dir === path.resolve(repoRoot, 'arsenal-charter'),
  `tier=${dDefault.tier} dir=${dDefault.dir}`);

check('三档：来源标签各说各的话（sync 打印给人看的就是它）',
  dEnv.source === '环境变量 ARSENAL_CHARTER_DIR'
  && dProfile.source === 'arsenal.json#project.charterDir'
  && dDefault.source === '内置默认',
  `${dEnv.source} / ${dProfile.source} / ${dDefault.source}`);

check('三档：相对路径按 repoRoot 解析（不是按 cwd —— 否则换个目录跑就换一份章程）',
  dProfile.dir === path.resolve(repoRoot, 'profile-charter')
  && path.isAbsolute(dProfile.dir),
  dProfile.dir);

const absWin = 'D:\\somewhere\\charter';
const absPosix = '/srv/charter';
check('三档：绝对路径原样使用（业务仓放机器任意位置都能指）',
  R({ ARSENAL_CHARTER_DIR: absWin }, null).dir === path.resolve(absWin)
  && R({ ARSENAL_CHARTER_DIR: absPosix }, null).dir === path.resolve(absPosix),
  `${R({ ARSENAL_CHARTER_DIR: absWin }, null).dir} / ${R({ ARSENAL_CHARTER_DIR: absPosix }, null).dir}`);

// ★ 反证档：`??` 只挡 undefined 不挡 ''。CI 里 `ARSENAL_CHARTER_DIR:` 写空值极常见，
// 而空串会让 path.resolve(repoRoot, '') = repoRoot → 章程目录变成仓库根 →
// 读不到任何 .json → 打印「暂无文件」→ **构建期一道闸都不跑且全绿**。
// 这三条守的就是那个静默失效。
check('空串环境变量视作未设置（否则整条构建静默失效）',
  R({ ARSENAL_CHARTER_DIR: '' }, 'profile-charter').tier === 2,
  `tier=${R({ ARSENAL_CHARTER_DIR: '' }, 'profile-charter').tier}（1=退回默认，说明空串被当成了有效值）`);
check('纯空白环境变量同样视作未设置',
  R({ ARSENAL_CHARTER_DIR: '   ' }, 'profile-charter').tier === 2,
  `tier=${R({ ARSENAL_CHARTER_DIR: '   ' }, 'profile-charter').tier}`);
check('档案里 charterDir 为空串 / 空白时退回内置默认',
  R({}, '').tier === 1 && R({}, '  ').tier === 1,
  `空串→${R({}, '').tier} 空白→${R({}, '  ').tier}`);

check('读档案：文件不存在 / 不是合法 JSON 时返回 null 而不是抛异常',
  readProfileCharterDir(path.join(repoRoot, 'arsenal-charter', 'arsenal-self.json')) === null
  && readProfileCharterDir(path.join(repoRoot, '不存在.json')) === null,
  '档案读不到就当没配 —— sync 会把实际用的路径打印出来，不靠抛错表达');

// 防分叉：sync 与断言层必须用同一份解析。写成源码文本断言是因为「两处各调一个函数」
// 这种错没有任何运行时症状 —— 两边都返回合法路径，只是从此再也不会同时更新。
const syncSrc = fs.readFileSync(path.join(here, '..', 'scripts', 'sync-content.mjs'), 'utf8');
check('sync-content.mjs 确实调用共享解析（不内联第二份三档逻辑）',
  syncSrc.includes("from './lib/charter-dir.mjs'")
  && syncSrc.includes('resolveCharterDir({')
  && !/ARSENAL_CHARTER_DIR\s*\?\?/.test(syncSrc),
  'sync 里不该再出现 `env ?? profile ?? 默认` 的内联版本');

check('断言层读的目录 == 按当前 env/档案解析出的目录（不许再写死 arsenal-charter）',
  charterDir === resolveCharterDir({
    repoRoot,
    profileCharterDir: readProfileCharterDir(path.join(repoRoot, 'arsenal-profiles', 'arsenal.json')),
  }).dir,
  `断言层用的：${charterDir.replace(/\\/g, '/')}`);
check('本层实际生效的章程目录来源已打印在案（换机器跑时一眼能看出读的是哪份）',
  typeof charterDirSource === 'string' && charterDirSource.length > 0 && charterDirTier >= 1,
  `${charterDirSource}（tier ${charterDirTier}）→ ${charterDir.replace(/\\/g, '/')}`);
}

// 【15】CI 执行器 —— 2026-10-05 补。CI 片段原本引用 `npx arsenal-lint`，
// 那是个**并不存在的包**（连同它旁边的 export-charter-ci.mjs 一起缺）。
// 现在执行器是 `arsenal-server/scripts/charter-ci.mjs`：export 模式跑在军火库里，
// 产出自包含的 .arsenal/ci/{config.json, charter-ci.mjs}；lint 模式在业务仓 CI 里
// 零 import 跑判定。下面全部用**纯函数**断言（不起子进程 —— 本环境 spawnSync
// 嵌套 spawn 会被沙箱拦成 EBUSY，端到端另在 shell 手测并记进记忆）。
{
const today = charterLib.todayOf();
const doc = primaryCharterDoc();
console.log('\n【15】CI 执行器：跨实现一致 / 例外双条件 / 判负口径');

const executorPath = path.join(repoRoot, 'arsenal-server', 'scripts', 'charter-ci.mjs');
check('CI 执行器文件在（片段引用的是它，不是不存在的 npm 包）',
  fs.existsSync(executorPath),
  executorPath.replace(/\\/g, '/'));

// ① ★ 跨实现一致性 —— 本仓最忌讳「同一规矩两份实现」。执行器是 .mjs、引擎是 .ts，
//    这里不 import 引擎（跨语言边界更脆），改成**同一批规则、同一批样本，两边跑出来的
//    (规则, 文件, 行) 三元组必须逐条相同**。改了一边而另一边没改 → 这里立刻红。
const rxRules = l0Rules.filter((r) => (r.check as any)?.regex?.pattern);
const sampleOf = (r: any): string => {
  const b = r?.bad;
  if (typeof b === 'string') return b;
  return String((b && (b.code ?? b.content)) || '');
};
const goodOf = (r: any): string => {
  const g = r?.good;
  if (typeof g === 'string') return g;
  return String((g && (g.code ?? g.content)) || '');
};
const samples = [
  { name: 'Probe.java', content: rxRules.slice(0, 12).map(sampleOf).join('\n\n') },
  { name: 'Svc.java', content: rxRules.slice(12, 30).map(sampleOf).join('\n\n') },
  { name: 'application.yml', content: rxRules.slice(0, 6).map(sampleOf).join('\n') },
  { name: 'Clean.java', content: rxRules.slice(0, 8).map(goodOf).join('\n\n') },
];
const key3 = (v: { ruleId: string; file: string; line: number }) => `${v.ruleId}|${v.file}|${v.line}`;
const engineKeys = lint(samples as any, l0Rules).violations.map(key3).sort();
const ciKeys = ciLint
  .lintFiles(samples as any, l0Rules as any[], { today })
  .violations.map(key3).sort();

check('样本确实触发了命中（否则上面那条一致性断言是恒真的 —— 恒真断言和没断言长得一样）',
  engineKeys.length > 0 && ciKeys.length > 0,
  `engine ${engineKeys.length} 条 / 执行器 ${ciKeys.length} 条`);
check('★ 跨实现一致：engine.ts 与 charter-ci.mjs 判出的 (规则,文件,行) 逐条相同',
  engineKeys.length === ciKeys.length && engineKeys.every((k, i) => k === ciKeys[i]),
  `engine ${engineKeys.length} 条 vs 执行器 ${ciKeys.length} 条`
  + (engineKeys.length === ciKeys.length
    ? `；首处不同：${engineKeys.find((k, i) => k !== ciKeys[i]) || '（无）'}`
    : ''));
check('反证：喂 good 示例的那份文件不产生命中（否则一致性可能只是「都在报同一堆假阳性」）',
  engineKeys.filter((k) => k.startsWith('Clean.java|')).length === 0
  && ciKeys.filter((k) => k.startsWith('Clean.java|')).length === 0,
  `Clean.java 上 engine ${engineKeys.filter((k) => k.startsWith('Clean.java|')).length} 条 / 执行器 ${ciKeys.filter((k) => k.startsWith('Clean.java|')).length} 条`);

// ② glob → RegExp 与引擎同义（`**` 零层目录、`{a,b}`、大小写不敏感）
const globProbes = ['**/*.java', 'src/**/domain/**', 'a/{b,c}/d.txt', '*.yml', '**/target/**'];
const globPaths = ['A.java', 'src/main/java/x/domain/Y.java', 'a/b/d.txt', 'a/e/d.txt', 'README.md', 'src/target/z.class'];
const globSame = globProbes.every((g) => {
  const a = globToRegExp(g);
  const b = ciLint.globToRegExp(g);
  return globPaths.every((p) => a.test(p) === b.test(p));
});
check('glob→RegExp 与引擎逐例一致（改一边就红）', globSame,
  globProbes.map((g) => `${g}:${globPaths.map((p) => (globToRegExp(g).test(p) ? '1' : '0')).join('')}`).join(' '));

// ③ 例外**双条件**豁免（拍板项 ③ 的落点）：clauseId 对 + 路径也在 glob 内才放行
const excSample = [{
  id: 'EXC-TEST-1', clauseId: 'PJX-SVC-001', pathGlob: 'src/main/java/com/x/**',
  reason: '测试用例外', approver: 'tester', owner: 'tester',
  grantedAt: '2026-01-01', expiresAt: '2099-12-31', ticket: 'T-1', status: 'active',
}];
check('例外放行：条款对 + 路径在 glob 内 → 豁免',
  ciLint.exceptionCovered(excSample, 'PJX-SVC-001', 'src/main/java/com/x/A.java').ok === true);
check('例外不放行：条款对但路径不在 glob 内（只按 clauseId 豁免 = 一行 JSON 让 MUST 全仓失效）',
  ciLint.exceptionCovered(excSample, 'PJX-SVC-001', 'src/main/java/com/y/A.java').ok === false);
check('例外不放行：非 active 状态的例外不生效（已销账 / 已过期 / 孤儿都不算数）',
  ciLint.exceptionCovered([{ ...excSample[0], status: 'repaid' }], 'PJX-SVC-001', 'src/main/java/com/x/A.java').ok === false);

// ④ override：relax 在该路径忽略该规则；replace 不自动执行（如实进 skipped）
const relaxed = ciLint.overrideGateFor(
  { id: 'COL-GIT-002', overrides: [{ ruleId: 'COL-GIT-002', action: 'relax', approver: 'mryang', expiresAt: '2026-12-31', pathGlob: 'legacy/**' }] },
  'legacy/A.java');
check('override relax：该路径下忽略该规则（放宽 = 不必遵守，但仍要有人批准 + 有到期日）',
  relaxed.ignored === true && String(relaxed.note).includes('relax'), relaxed.note || '');
check('override relax：路径不匹配时不生效（放宽也是限定范围的）',
  ciLint.overrideGateFor(
    { id: 'COL-GIT-002', overrides: [{ ruleId: 'COL-GIT-002', action: 'relax', approver: 'mryang', expiresAt: '2026-12-31', pathGlob: 'legacy/**' }] },
    'src/A.java').ignored === false);
const replaced = ciLint.overrideGateFor(
  { id: 'X-1', overrides: [{ ruleId: 'X-1', action: 'replace', replacement: '改用 MapStruct' }] }, 'src/A.java');
check('override replace：不自动替换、明说检不了（契约里 replacement 是文字描述不是可执行正则）',
  replaced.ignored === false && String(replaced.note).includes('不自动替换'), replaced.note || '');

// ⑤ 冻结线：未生效条款不进 PR 门，且如实说明为什么没判
const futureRule = {
  id: 'PJX-FUTURE-1', title: '未来条款', severity: 'MUST', status: 'active', source: 'charter',
  effectiveFrom: '2099-01-01', pathGlob: '**/*.java',
  check: { regex: { pattern: 'System\\.out\\.print', expect: 'absent' } },
};
const futureRun = ciLint.lintFiles([{ name: 'A.java', content: 'System.out.println("x");' }], [futureRule], { today });
check('冻结线：effectiveFrom 晚于判定日的条款不判（存量与未来都不该被这次 PR 拦住）',
  futureRun.violations.length === 0
  && futureRun.skipped.some((s) => s.ruleId === 'PJX-FUTURE-1' && String(s.reason).includes('冻结线')),
  futureRun.skipped.map((s) => s.reason).join(' / ') || '（既没判也没说明 —— 那才是问题）');

// ⑥ 例外台账处置三档：口径读 policy，执行器不写死
const overdueEx = [{ id: 'EXC-OLD', clauseId: 'PJX-SVC-001', status: 'active', expiresAt: '2020-01-01', owner: 'mryang' }];
const lvl = (p: any) => ciLint.auditExceptions(overdueEx, p, today)[0].level;
check('例外到期按 policy 判负：error → error / warn → warn / ignore → ignore',
  lvl({ overdueException: 'error' }) === 'error'
  && lvl({ overdueException: 'warn' }) === 'warn'
  && lvl({ overdueException: 'ignore' }) === 'ignore',
  `error→${lvl({ overdueException: 'error' })} warn→${lvl({ overdueException: 'warn' })} ignore→${lvl({ overdueException: 'ignore' })}`);
check('ignore 档仍留痕（不静默：静默 = 三个月后没人知道曾经有这条豁免）',
  ciLint.auditExceptions(overdueEx, { overdueException: 'ignore' }, today)[0].policyTag === 'policy.ignore');
const orphanEx = [{ id: 'EXC-ORPH', clauseId: 'PJX-SVC-001', status: 'orphaned', expiresAt: '2099-01-01', owner: '离职者' }];
const orphanLevel = (p: any) => ciLint.auditExceptions(orphanEx, p, today)[0].level;
check('孤儿例外按 policy.orphanBlocks 判负（独立于到期口径 —— 欠决定 vs 欠一个人是两回事）',
  orphanLevel({ orphanBlocks: 'error' }) === 'error' && orphanLevel({ orphanBlocks: 'warn' }) === 'warn',
  `error→${orphanLevel({ orphanBlocks: 'error' })} warn→${orphanLevel({ orphanBlocks: 'warn' })}`);

// ⑦ CI 片段引用的路径必须真的存在（片段曾引用两个不存在的命令）
const ciYaml = charterLib.buildCharterCI({ projectName: doc.name });
// 片段里两类路径要分开看：
//   · `.arsenal/arsenal/...`  前半段是**CI 现场 clone 出来的军火库**，本仓没有，
//     该验的是后半段那个脚本路径在军火库里真实存在；
//   · `.arsenal/ci/...`        是 export 阶段**生成**的执行器副本，运行时才有 ——
//     它的来源就是军火库里那个脚本，所以映射回同一路径去验。
// 片段曾引用 `npx arsenal-lint` 与 `arsenal-server/scripts/export-charter-ci.mjs`，
// 两个都不存在 —— 这条判据就是为了钉住「片段引用的东西必须真存在」。
const scriptOfRun = (raw: string) => {
  const p = raw.replace(/\\\$\{\{[^}]+\}\}/g, 'x').trim();
  if (p.startsWith('.arsenal/arsenal/')) return p.replace(/^\.arsenal\/arsenal\//, '');
  if (p.startsWith('.arsenal/ci/')) return 'arsenal-server/scripts/charter-ci.mjs';
  return p;
};
const runPaths = [...ciYaml.matchAll(/run:\s*node\s+(\S+)/g)]
  .map((m) => scriptOfRun(m[1]))
  .filter((p) => !p.startsWith('<'));
const missingPaths = runPaths.filter((p) => !fs.existsSync(path.resolve(repoRoot, p)));
check('CI 片段里 node 后面跟的脚本都真实存在（曾引用 npx arsenal-lint 与 export-charter-ci.mjs，两个都不存在）',
  missingPaths.length === 0,
  `片段引用 ${runPaths.length} 条：${runPaths.join(' / ')}${missingPaths.length ? ` —— 缺：${missingPaths.join('、')}` : ''}`);
check('CI 片段不再出现 npx arsenal-lint（那是编出来的包名）',
  !ciYaml.includes('npx arsenal-lint') && !ciYaml.includes('export-charter-ci.mjs'));
const stepNames = [...ciYaml.matchAll(/- name: (.+)/g)].map((m) => m[1].trim());
const runSteps = [...ciYaml.matchAll(/^\s*run:/gm)].length;
check('CI 片段每一步都有可读的名字（使用说明要能照着跑，一句没解释的 run 等于没有）',
  stepNames.length >= runSteps && runSteps > 0,
  `${stepNames.length} 个 name / ${runSteps} 个 run`);
}


// 【16】工程规范台（/standards）—— 2026-10-05 重定位后新增。
//
// 重定位的缘由：原来那页的三个页签都以**条款**为中心，是「审章程」的视角；
// 用户要的是「多人开发同一个项目时的规范管理」，主轴是人 / 现状 / 时间 / 执行。
// 数据一个字没加（章程 JSON 仍是同一份），新增的全是**聚合**——
// 而聚合必须能被当数据跑，否则页面上那些数字只是「看起来对」。
console.log('\n【16】工程规范台：聚合守恒 / 口径一致 / 迁移页与入口');
{
const today = charterLib.todayOf();
const doc = primaryCharterDoc();
const webAppDir = path.join(here, '..', 'src', 'app');
const fourFiles = [
  'app/standards/page.tsx',
  'app/standards/StandardsConsole.tsx',
  'app/standards/StandardsPanels.tsx',
  'lib/standards.ts',
];
const missingFiles = fourFiles.filter((f) => !fs.existsSync(path.join(here, '..', 'src', ...f.split('/'))));
check('治理台三件页面 + 纯函数层 standards.ts 都在', missingFiles.length === 0,
  missingFiles.join(', ') || '四件齐');

// 迁移页：静态导出下 next.config 的 redirects 不生成任何东西，
// 所以必须是一张**真的会跳**的页子，而不是「声称已重定向」。
const movedSrc = fs.readFileSync(path.join(webAppDir, 'charter', 'page.tsx'), 'utf8');
check('/charter 是迁移页：带 meta refresh 且指向 /standards/',
  /httpEquiv="refresh"/.test(movedSrc) && movedSrc.includes('/standards/'),
  '静态导出模式没有真重定向，这页必须自己跳');
check('迁移页不再渲染旧的整页（章程抬头已移入治理台，避免两处 h1）',
  !movedSrc.includes('CharterConsole'), '旧 page 若还渲染 CharterConsole，/charter 与 /standards 会各有一个 h1');

const shellSrc = fs.readFileSync(path.join(here, '..', 'src', 'components', 'Shell.tsx'), 'utf8');
check('侧栏入口指向 /standards 且标签是「工程规范」',
  /href: '\/standards'/.test(shellSrc) && /label: '工程规范'/.test(shellSrc),
  shellSrc.includes("href: '/charter'") ? '侧栏还指着旧路由 /charter' : '');
check('侧栏不再有指向 /charter 的入口（否则两个入口、两个心智模型）',
  !/href: '\/charter'/.test(shellSrc), '');

// ── 聚合守恒：byKind 各档之和必须等于总数，否则「漏算」在页面上看不出来 ──
const items = stdLib.actionItems(doc, today);
const sum = stdLib.actionSummary(items);
const kindSum = Object.values(sum.byKind).reduce((a, b) => a + b, 0);
check('待办汇总守恒：五类之和 == 总数', kindSum === sum.total && sum.total === items.length,
  `total=${sum.total} kindSum=${kindSum}`);
check('待办分级之和 == 总数', sum.p0 + sum.p1 + sum.p2 === sum.total,
  `p0=${sum.p0} p1=${sum.p1} p2=${sum.p2} total=${sum.total}`);

// 两次调用逐项相同（id 稳定）—— 页面每次渲染都会重算，抖动会让「待办在变」变成噪音
const again = stdLib.actionItems(doc, today);
check('待办清单两次调用逐项相同（id 稳定，不许随渲染抖动）',
  items.length === again.length && items.every((it, i) => it.id === again[i].id && it.level === again[i].level),
  `${items.length} vs ${again.length}`);

// 不重不漏：每条「到期未销账」的例外恰好一条 overdue 待办；已销账的一条都不产生
const overdueExIds = doc.exceptions.filter((e) => stdLib.exState(e, doc, today) === 'expired').map((e) => e.id);
const repaidExIds = doc.exceptions.filter((e) => stdLib.exState(e, doc, today) === 'repaid').map((e) => e.id);
const overdueItems = items.filter((i) => i.kind === 'overdue-exception').map((i) => String(i.target));
const repaidItems = items.filter((i) => repaidExIds.includes(String(i.target))).map((i) => i.id);
check('不重不漏：每条到期未销账的例外恰好一条待办',
  overdueItems.length === overdueExIds.length && overdueExIds.every((id) => overdueItems.includes(id)),
  `到期 ${overdueExIds.join('、') || '（无）'} vs 待办 ${overdueItems.join('、') || '（无）'}`);
check('已销账的例外不产生任何待办（销账就该真的销掉）',
  repaidItems.length === 0, `已销账 ${repaidExIds.join('、') || '（无）'} 却仍出现在待办里`);

// 级别由 policy 决定：同一份数据，policy 一改，级别必须跟着改
const p0n = items.filter((i) => i.level === 'P0').length;
const expectP0 = doc.policy.overdueException === 'error' ? overdueExIds.length : 0;
check('待办级别读 policy（overdue=error 才把到期算 P0）', p0n === expectP0,
  `P0=${p0n}，按 policy.${doc.policy.overdueException} 应为 ${expectP0}`);

// ★ exState 与 exceptionDisposition 必须逐条一致 —— 两个出口各算各的，
//   分叉的后果是页面上「到期」与「孤儿」两栏数字对不上而没人说得清为什么。
const labelToState = (l: string): string =>
  l === '已销账' ? 'repaid'
    : l === '孤儿例外' ? 'orphaned'
      : l.startsWith('已到期') ? 'expired'
        : 'active';
const stateMismatches = doc.exceptions
  .map((e) => {
    const mine = stdLib.exState(e, doc, today);
    const theirs = labelToState(charterLib.exceptionDisposition(e, doc, today).label);
    return mine === theirs ? null : `${e.id}: 我的=${mine} 处置=${theirs}`;
  })
  .filter(Boolean) as string[];
check('★ exState 与 exceptionDisposition 逐条一致（两个出口不许各算各的）',
  stateMismatches.length === 0, stateMismatches.join('; ') || `${doc.exceptions.length} 笔例外全部一致`);

// 反证：把一条生效条款改成**语义层** → 人工待办 +1、就绪度报出阻塞项。
// （第一版这里注入的是 AST 层，结果 0 → 0 假红 —— 顺着它查出了真问题：
//  `isClauseMachineCheckable` 认为 AST「机器可判」是对的（校验台有后端深检），
//  而 CI 执行器只跑正则层。两套口径必须分开数，否则会得出「门禁已覆盖全部条款」的结论。）
const firstClause = doc.clauses[0];
const gReal = stdLib.gateReadiness(doc, today);
const asManual = {
  ...doc,
  clauses: doc.clauses.map((c) => (c.id === firstClause.id ? { ...c, check: { llm: { prompt: 'x' } } } : c)),
};
const gManual = stdLib.gateReadiness(asManual as CharterDoc, today);
const itemsManual = stdLib.actionItems(asManual as CharterDoc, today);
const realManualItems = items.filter((i) => i.kind === 'not-machine-checkable').length;
check('反证：把条款改成语义层 → 「只能人 review」+1 且就绪度报出阻塞项',
  gManual.manualOnly === gReal.manualOnly + 1
  && gManual.blockers.some((b) => b.includes('人 review'))
  && itemsManual.filter((i) => i.kind === 'not-machine-checkable').length === realManualItems + 1,
  `manualOnly ${gReal.manualOnly} → ${gManual.manualOnly}；人工待办 ${realManualItems} → ${itemsManual.filter((i) => i.kind === 'not-machine-checkable').length}`);

const asAst = {
  ...doc,
  clauses: doc.clauses.map((c) => (c.id === firstClause.id ? { ...c, check: { ast: { query: 'x' } } } : c)),
};
const gAst = stdLib.gateReadiness(asAst as CharterDoc, today);
check('AST 层：不混进「人 review」待办（校验台能深检），但**必须**在就绪度里被点名',
  gAst.ciRunnable === gReal.ciRunnable - 1
  && gAst.astOnly === gReal.astOnly + 1
  && gAst.blockers.some((b) => b.includes('AST')),
  `ciRunnable ${gReal.ciRunnable} → ${gAst.ciRunnable}；astOnly ${gReal.astOnly} → ${gAst.astOnly}`);
check('两套口径不许混：机器能判（校验台）== CI 能判 + AST 层',
  gReal.machineCheckable === gReal.ciRunnable + gReal.astOnly
  && gReal.machineCheckable === doc.clauses.filter((c) => charterLib.isClauseInForce(c, today) && charterLib.isClauseMachineCheckable(c)).length,
  `machineCheckable=${gReal.machineCheckable} ciRunnable=${gReal.ciRunnable} astOnly=${gReal.astOnly}`);
check('就绪度自洽：ready 恒等于 blockers 为空',
  gReal.ready === (gReal.blockers.length === 0), `${gReal.blockers.length} 条 blocker`);

// 人维度：守恒 + 离队的人必须被单独列出来（那是最该被看见的信号）
const pv = stdLib.peopleView(doc, today);
const owedCount = pv.rows.reduce((n, r) => n + r.owesExceptions.length, 0)
  + pv.outsiders.reduce((n, r) => n + r.owesExceptions.length, 0)
  + pv.unassigned.clauseExceptions.length;
check('责任人矩阵守恒：每笔豁免恰好落在一个人名下（或「无还债人」）',
  owedCount === doc.exceptions.length, `${owedCount} vs ${doc.exceptions.length}`);
check('离队的人单列在 outsiders，且不在在册 rows 里',
  pv.outsiders.every((o) => !o.active && !pv.rows.some((r) => r.name === o.name)),
  `outsiders ${pv.outsiders.map((o) => o.name).join('、') || '（无）'}`);

// 现状：前两级聚合不许把不同路径吞成同一格（不同前缀必须分开）
const areas = stdLib.areaRiskView(doc, today);
const areaOf = (g: string | undefined) => {
  if (!g) return '（全项目）';
  const parts = g.replace(/\*\*.*$/, '').split('/').filter(Boolean);
  return parts.slice(0, 2).join('/') || '（根目录）';
};
const expectAreas = new Set([...doc.clauses.map((c) => areaOf(c.pathGlob)), ...doc.exceptions.map((e) => areaOf(e.pathGlob))]);
check('模块风险：路径前两级的每个取值都单独成格（不同模块不许被合并）',
  expectAreas.size === areas.length && [...expectAreas].every((a) => areas.some((x) => x.area === a)),
  `期望 ${[...expectAreas].join(' / ')}；实得 ${areas.map((a) => a.area).join(' / ')}`);
}

process.exit(finish('charter'));
