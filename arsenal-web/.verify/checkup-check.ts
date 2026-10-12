/**
 * 体检报告层的守门人 —— 第 13 层（key: `checkup`）。
 *
 * ─────────────────────────────────────────────────────────────
 * 这一层要盯的不是「功能跑不跑得通」，是**三件最容易静默失效的事**：
 *
 *   ① **观察项是不是真的数据**。写在 Java 里的观察项换语言就得重编译 ——
 *      所以这里直接查 `CheckupEvaluator.java` 的源码里不许出现任何具体事实路径。
 *      这是「判据是数据」这条设计唯一能被机器验的那面。
 *   ② **覆盖率有没有带分母**。只报「P0: 12 条」的页面，读者分不清
 *      「没命中」与「没检查」。这里既查后端真算出了 notRun，也查前端页面
 *      真的把分母渲染出来（且 0 时也说）。
 *   ③ **新事实源有没有登记齐**。`verify:project` 验的是导出包 README，
 *      本仓 README 与 `project.dirs` 漏登记**永远不会红** —— 章程目录就是这样漏过的。
 *
 * ─────────────────────────────────────────────────────────────
 * 结构自检（第 8 节）：摘掉外壳递归的代价就是「某个专用判据可能忘跑」。
 * 这里逐类注入必填缺失，确认真会红 —— 与章程层第 8 节同一条理由。
 *
 * 跑法：npm run verify:checkup（后端在时多跑端到端，不在时明说跳过，不装作通过）
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { check, finish, knowinglySkipped } from './lib/report';
// 静态 import（不用 await import）—— 本仓 tsx 是 cjs 输出，顶层 await 编译失败。
// 缺文件时是**加载期报错**而不是「静默 undefined」，这比 await 的写法更早暴露问题。
import { validateCheckups, OPERATOR_VALUE_TYPES, CHECKUP_LEVELS } from '../scripts/lib/validate-checkups.mjs';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..');
const repoRoot = path.resolve(webRoot, '..');
const serverRoot = path.resolve(repoRoot, 'arsenal-server');

const CHECKUPS_FILE = path.join(repoRoot, 'arsenal-checkups', 'checkups.json');
const VALIDATOR = path.join(webRoot, 'scripts', 'lib', 'validate-checkups.mjs');
const SYNC = path.join(webRoot, 'scripts', 'sync-content.mjs');
const EVALUATOR = path.join(serverRoot, 'src/main/java/com/arsenal/autopsy/CheckupEvaluator.java');
const LOADER = path.join(serverRoot, 'src/main/java/com/arsenal/autopsy/CheckupLoader.java');
const SERVICE = path.join(serverRoot, 'src/main/java/com/arsenal/autopsy/AutopsyService.java');
const CONTROLLER = path.join(serverRoot, 'src/main/java/com/arsenal/web/AutopsyController.java');
const PANEL = path.join(webRoot, 'src/app/autopsy/CheckupPanel.tsx');
const LAB = path.join(webRoot, 'src/app/autopsy/AutopsyLab.tsx');
const PROFILE = path.join(repoRoot, 'arsenal-profiles', 'arsenal.json');
const README = path.join(repoRoot, 'README.md');

const read = (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');

function section(title: string) {
  console.log(`\n${title}`);
}

/** 校验器的返回形状。与 `validate-checkups.mjs` 里的 JSDoc 同源。 */
type Diag = { level: string; code: string; path: string; message: string };
type ValidateResult = { errors: Diag[]; warnings: Diag[]; stats: Record<string, unknown> };

/** .mjs 无类型声明，这里收口成一处断言，下面全部按这个形状用 */
const validate = validateCheckups as unknown as (input: {
  relPath: string;
  doc: unknown;
  today?: string;
}) => ValidateResult;
const OPS = OPERATOR_VALUE_TYPES as unknown as Record<string, string[]>;
const LEVELS = CHECKUP_LEVELS as unknown as string[];

const TODAY = process.env.ARSENAL_TODAY ?? new Date().toISOString().slice(0, 10);
const checkupsRaw = JSON.parse(read(CHECKUPS_FILE)) as Record<string, any>;

/** 深拷贝一份当夹具，改它不动磁盘 */
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ═══════════════════════════════════════════════════════════════
// 【1】事实源齐备 —— 声称新建的文件逐个确认真的在
section('【1】事实源齐备');
{
  check('arsenal-checkups/checkups.json 存在', fs.existsSync(CHECKUPS_FILE), '观察项事实源是这一层的输入，缺了整层无意义');
  check('validate-checkups.mjs 存在', fs.existsSync(VALIDATOR), '校验器是构建期闸门，缺了等于不设闸');
  check('CheckupEvaluator.java 存在', fs.existsSync(EVALUATOR), '六算子解释器，观察项的执行方');
  check('CheckupLoader.java 存在', fs.existsSync(LOADER), '事实源加载器');
  check('AutopsyService.java 存在', fs.existsSync(SERVICE), '体检编排');
  check('AutopsyController.java 存在', fs.existsSync(CONTROLLER), 'POST /api/autopsy/inspect');
  check('CheckupPanel.tsx 存在', fs.existsSync(PANEL), '体检报告页面');
  check(
    'checkups.json 的 rules 非空',
    Array.isArray(checkupsRaw.rules) && checkupsRaw.rules.length > 0,
    '空规则表会让观察项整档消失，而「没有要提示的」与「一条都没配」在页面上长得一模一样',
  );
  check(
    'checkups.json 的 count == rules.length',
    checkupsRaw.count === (checkupsRaw.rules ?? []).length,
    `count=${checkupsRaw.count} / 实测 ${(checkupsRaw.rules ?? []).length}`,
  );
}

// ═══════════════════════════════════════════════════════════════
// 【2】观察项是数据，不是代码（换语言不用重编译）
section('【2】观察项是数据，不是代码');
{
  // 去注释后再判：本仓的注释里会写「code.directCalls 的 {from,to,file}」这种话，
  // 不去注释的话**任何**提到事实形状的注释都会让判据把代码放过 —— 判据就成了摆设
  // （2026-10-11 棒 1 的 9-6 就是这么被打穿的，见 scan-check.ts:604）。
  const stripComments = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const ev = stripComments(read(EVALUATOR));
  const sv = read(SERVICE);
  // 这些字符串只应出现在 arsenal-checkups/checkups.json 里。
  // 出现在 Java 里 = 有人把判据写回了代码，改一条观察项要重编译。
  const forbidden = ['techStack', 'deploy.ci', 'directCalls', 'deploy.nginx', 'build.kind', 'unmatched'];
  for (const token of forbidden) {
    check(
      `CheckupEvaluator.java 不含事实路径 "${token}"`,
      !ev.includes(token),
      'Java 里出现具体事实路径 = 判据被写回了代码；观察项必须只在 checkups.json 里',
    );
  }
  check(
    'CheckupEvaluator.java 不含「依赖过多」这类业务语义词',
    !ev.includes('依赖过多') && !ev.includes('没有 CI') && !ev.includes('跨层直连'),
    '解释器只认六个算子，业务语义只能来自数据',
  );
  check('CheckupLoader 从 JSON 的 rules 数组读', read(LOADER).includes('get("rules")'), '加载器的输入必须是 JSON 的 rules');
  check('CheckupLoader 认六个算子', ['">="', '"<="', '"=="', '"!="', '"contains"', '"exists"'].every((o) => read(LOADER).includes(o)), '算子表与校验器 CHECKUP_* 六算子不一致会让某些观察项永不加载');
  check(
    'AutopsyService 用 CheckupEvaluator 而不是内联判定',
    sv.includes('CheckupEvaluator') && sv.includes('evaluator.evaluate('),
    'service 里内联 if 就等于第二份实现（memory 铁律 23）',
  );
  check(
    '六算子在校验器与解释器两处一致',
    Object.keys(OPS).length === 6 && LEVELS.length === 1,
    `算子 ${Object.keys(OPS).length} 个 / 档位 ${LEVELS.length} 个`,
  );
  // 棒 4 设计裁决（2026-10-12 计划书证伪记录）：CK-OBS-007/008 判据走**入口数**，
  // 不是声明数。demo-repo 实测 8 条声明（compose 3 + k8s 4 + 入口 1）却只有 1 个
  // 入口 —— 用 services.declarations.length >= 2 会把这个单体误触成「多服务结构
  // 信号」。声明数是部署视角，入口数才是「跑起来几个进程」的硬信号。
  // 真求值证据（同进程探针跑 CheckupLoader + CheckupEvaluator + 真 facts 回执）：
  // services-demo 4 入口 → 007 触发、008 不触发；demo-repo 1 入口 → 008 触发、
  // 007 不触发；两边 unevaluated 都是 0（每条规则都有结论）。
  const svcObs = (checkupsRaw.rules ?? []).filter((r: any) => r?.id === 'CK-OBS-007' || r?.id === 'CK-OBS-008');
  check(
    'CK-OBS-007/008 判据走 code.entryPoints.length（入口数），不是 services.declarations.length（声明数是部署视角）',
    svcObs.length === 2 && svcObs.every((r: any) => r.when?.fact === 'code.entryPoints.length'),
    `实测 ${svcObs.length} 条: ${svcObs.map((r: any) => `${r.id}=${r.when?.fact}`).join(' / ')} —— 判据改成声明数会把单体误判成多服务（demo-repo：8 声明 / 1 入口）`,
  );
}

// ═══════════════════════════════════════════════════════════════
// 【3】事实源登记（硬约定第 4 条：漏登记永远不会红）
section('【3】事实源登记（漏登记不报错的那四处）');
{
  const readme = read(README);
  check('README 目录树登记了 arsenal-checkups/', readme.includes('arsenal-checkups'), '整份 README 0 命中 —— 换项目时没人知道要建这个目录');
  const dirs: string[] = (JSON.parse(read(PROFILE))?.project?.dirs ?? []).map((d: any) => String(d?.path ?? ''));
  check('项目档案 project.dirs 登记了 arsenal-checkups/', dirs.some((p) => p.replace(/\/+$/, '') === 'arsenal-checkups'), `现有 ${dirs.length} 项: ${dirs.join(' / ')}`);
  check('sync-content.mjs 同步观察项事实源', read(SYNC).includes('validate-checkups.mjs') && read(SYNC).includes('arsenal-checkups'), '同步脚本没接上 = 构建期闸门不存在，只有 verify 能发现');
  check('sync 在构建期硬失败（fail 而不是 warn）', /validateCheckups[\s\S]{0,900}?fail\(/.test(read(SYNC)), '同步段只打印不 fail 的话，next build 会一路绿灯');
  check(
    '同步产物 src/generated/checkups.json 存在',
    fs.existsSync(path.join(webRoot, 'src/generated/checkups.json')),
    'sync 没跑过或没产出；前端要读它（若前端暂不读也要先在构建期证明数据合法）',
  );
}

// ═══════════════════════════════════════════════════════════════
// 【4】校验器契约 —— 真会红（反着验）
section('【4】校验器契约：注入 → 真红');
{
  const clean = validate({ relPath: 'x.json', doc: checkupsRaw, today: TODAY });
  check('干净的 checkups.json 通过校验', clean.errors.length === 0, clean.errors.map((e) => e.path).join(' / '));

  // ① count 写死
  {
    const doc = clone(checkupsRaw);
    doc.count = (doc.rules?.length ?? 0) + 3;
    const r = validate({ relPath: 'x.json', doc, today: TODAY });
    check('count 与实测不符 → 红', r.errors.some((e) => e.code === 'CHECKUP_COUNT_MISMATCH'), 'count 写死是最容易过期的数字');
  }
  // ② rules 清空 —— 最重要的一条：不许因此「全过」
  {
    const doc = clone(checkupsRaw);
    doc.rules = [];
    doc.count = 0;
    const r = validate({ relPath: 'x.json', doc, today: TODAY });
    check('rules 清空 → 红（不许全过）', r.errors.some((e) => e.code === 'CHECKUP_EMPTY_RULES'), '空规则表会让整档消失而页面看起来正常');
  }
  // ③ 算子与 value 类型不配
  {
    const doc = clone(checkupsRaw);
    doc.rules[0].when.op = '>=';
    doc.rules[0].when.value = '二十';
    const r = validate({ relPath: 'x.json', doc, today: TODAY });
    check('>= 配字符串 → 红', r.errors.some((e) => e.code === 'CHECKUP_VALUE_TYPE_MISMATCH'), '类型配错会让比较退化成 NaN 比较，这条观察项永远不触发');
  }
  // ④ 未知算子
  {
    const doc = clone(checkupsRaw);
    doc.rules[0].when.op = 'matches';
    const r = validate({ relPath: 'x.json', doc, today: TODAY });
    check('未知算子 → 红', r.errors.some((e) => e.code === 'CHECKUP_OPERATOR_UNKNOWN'), '解释器不认识的算子会被静默跳过');
  }
  // ⑤ id 命名空间与重复
  {
    const doc = clone(checkupsRaw);
    doc.rules[0].id = 'OBS-001';
    const r = validate({ relPath: 'x.json', doc, today: TODAY });
    check('id 不以 CK- 开头 → 红', r.errors.some((e) => e.code === 'CHECKUP_ID_NAMESPACE'), '观察项与 69 条规则生命周期不同，ID 混了看不出归属');
  }
  {
    const doc = clone(checkupsRaw);
    doc.rules[1].id = doc.rules[0].id;
    const r = validate({ relPath: 'x.json', doc, today: TODAY });
    check('id 重复 → 红', r.errors.some((e) => e.code === 'CHECKUP_ID_DUPLICATE'), '重复 id 会让「删掉一条」变得无法判定删的是哪条');
  }
  // ⑥ today 未注入
  {
    const r = validate({ relPath: 'x.json', doc: checkupsRaw });
    check('today 未注入 → 红（不静默跳过）', r.errors.some((e) => e.code === 'CHECKUP_UPDATED_AT_IN_FUTURE'), 'today 缺失时「日期是否来自未来」这条判据等于不存在');
  }
  // ⑦ updatedAt 来自未来
  {
    const doc = clone(checkupsRaw);
    doc.updatedAt = '2099-01-01';
    const r = validate({ relPath: 'x.json', doc, today: TODAY });
    check('updatedAt 晚于今天 → 红', r.errors.some((e) => e.code === 'CHECKUP_UPDATED_AT_IN_FUTURE'), '事实源不会来自未来');
  }
  // ⑧ 未知字段
  {
    const doc = clone(checkupsRaw);
    doc.rules[0].whatever = 1;
    const r = validate({ relPath: 'x.json', doc, today: TODAY });
    check('观察项出现未登记字段 → 红', r.errors.some((e) => e.code === 'CHECKUP_UNKNOWN_FIELD'), '字段名改了就等于改了契约');
  }
  // ⑨ evidence.limit 越界
  {
    const doc = clone(checkupsRaw);
    doc.rules[0].evidence = { from: 'build.dependencies', limit: 99 };
    const r = validate({ relPath: 'x.json', doc, today: TODAY });
    check('evidence.limit 越界 → 红', r.errors.some((e) => e.code === 'CHECKUP_EVIDENCE_BAD'), 'limit 失去约束会把整份清单塞进报告');
  }
  // ⑩ 文案过短
  {
    const doc = clone(checkupsRaw);
    doc.rules[0].text = '太多';
    const r = validate({ relPath: 'x.json', doc, today: TODAY });
    check('text 过短 → 红', r.errors.some((e) => e.code === 'CHECKUP_TEXT_TOO_SHORT'), '一句话说不清的观察项列在报告里是噪音');
  }
}

// ═══════════════════════════════════════════════════════════════
// 【5】反向：不该红的时候不许红
section('【5】反向：合法形态放过');
{
  // evidence 为 null 是合法的（「没有 CI」这种结论天然没有文件证据）
  const doc = clone(checkupsRaw);
  doc.rules[0].evidence = null;
  const r = validate({ relPath: 'x.json', doc, today: TODAY });
  check('evidence: null 合法（没有文件证据是正��结论）', r.errors.length === 0, r.errors.map((e) => e.code).join(' / '));

  // 六算子各配一个合法 value 都不许只因算子而红
  const samples: Array<[string, unknown]> = [
    ['>=', 1], ['<=', 1], ['==', 0], ['!=', 'maven'], ['contains', 'x'], ['exists', true],
  ];
  for (const [op, value] of samples) {
    const d = clone(checkupsRaw);
    d.rules[0].when.op = op;
    d.rules[0].when.value = value;
    const rr = validate({ relPath: 'x.json', doc: d, today: TODAY });
    check(`算子 ${op} 配合法 value 不红`, !rr.errors.some((e) => e.code === 'CHECKUP_VALUE_TYPE_MISMATCH' || e.code === 'CHECKUP_OPERATOR_UNKNOWN'), rr.errors.map((e) => e.code).join(' / '));
  }
}

// ═══════════════════════════════════════════════════════════════
// 【6】覆盖率口径（本棒的诚实核心）
section('【6】覆盖率口径：分母不许写死');
{
  const sv = read(SERVICE);
  check('后端算 notRun（total - executed）', sv.includes('notRun') && sv.includes('pool - executed'), '只报命中数不报未覆盖，读者会把「没查」读成「没问题」');
  check('后端从 rulePool 取分母', sv.includes('first.rulePool()'), '分母必须来自规则池实测，写死 69 会在加规则那天开始撒谎');
  check('后端 tierPool 从 index.active() 现数', sv.includes('index.active()') && sv.includes('p0Pool++'), 'P0/P1 档的规模不许写死 50 / 18');
  check('后端分级用 Severity.blocking()', sv.includes('sev.blocking()'), 'MUST+NEVER 判 P0 走枚举，不在 Java 里抄一遍严重度表');

  const panel = read(PANEL);
  check('页面显示「覆盖 X/Y」带分母', /覆盖 \{cov\.executed\}\/\{cov\.total\}/.test(panel), '只报「N 条」的页面无法区分「没命中」与「没检查」');
  check('页面显示未覆盖条数', panel.includes('{notRun} 条本次没结论') || panel.includes('全部有结论'), '未覆盖数必须出现，且 0 时也要说（「没有要提示的」与「一条都没有」长得一样）');
  check('页面不许写死 69', !/\b69\b/.test(panel), '页面出现 69 这个字面量 = 分母被写死了');
  check('coverage.total 为 0 时页面有专门提示', panel.includes('规则池是 0'), '分母为 0 时必须说「一条都没查」，否则 0/0 会被读成 100%');
  check('某档 0 条时仍显示档标题与解释', panel.includes('这一档 0 条'), '0 条时整块消失 = 「没有要提示的」与「一条都没有」不可分辨');
  check('观察项 0 条 / 事实源不可用时都有话说', panel.includes('一条规则都没有') && panel.includes('观察项事实源不可用'), '三种空态要三句不同的话');
  check('skipped 明细可折叠且 0 条时有文案', panel.includes('没有未覆盖项'), '空列表什么都不渲染 = 静默');
}

// ═══════════════════════════════════════════════════════════════
// 【7】接口与页面契约
section('【7】接口与页面契约');
{
  const ctl = read(CONTROLLER);
  check('路由是 POST /api/autopsy/inspect', ctl.includes('@PostMapping("/inspect")') && ctl.includes('@RequestMapping("/api/autopsy")'), '棒 3 的快照要照这个地址存');
  check('入参校验在 Controller 里做（不依赖框架异常）', ctl.includes('请求体缺少 source') && ctl.includes('source.kind 只支持'), 'GlobalExceptionHandler 把 404/405/415 吃成 500，不能指望框架给出可读错误');
  check('只吃 path / git（zip 明说走另一条路）', ctl.includes('/api/scan/upload'), 'zip 是 multipart，混进 JSON 分支迟早要加第三个');
  check('报告里不存绝对路径', read(SERVICE).includes('source.rootName()') && !read(SERVICE).includes('root.toAbsolutePath()'), '事实会被留档，绝对路径既泄隐私又不可复现');
  // 2026-10-12 自检补：上面那条只看了 scope.rootName，而 obs.source 当时把
  // 「服务器上的绝对路径」原样塞进了报告 —— 源码断言绿着，报告里却在泄路径。
  // 所以再钉一条「观察项出处只给文件名」，并由【9】对**真跑出来的 JSON** 兜底。
  // ⚠️ 别写成「不含 checkups.file()」—— 正则没有锚，会把
  //    `Path.of(checkups.file()).getFileName()` 里的 `checkups.file()` 也当成命中
  //    （2026-10-12 实测：这么写的断言恒真，源码泄着路径而断言全绿）。
  //    直接钉住「经过 getFileName 收敛」这一整串。
  check('观察项出处只给文件名（不泄服务器目录）', read(SERVICE).includes('Path.of(checkups.file()).getFileName()'), '报告会进快照与导出，服务器目录布局不属于它要说的东西');
  // 2026-10-12 review 抓到：snippet 是**原始源码行**，而体检专扫 yml / properties，
  // 配置里写着真密码的那一行完全可能成为某条违规的证据行。扫描层 ScanGuard.redact
  // 管的是配置项取值，管不到整行源码 —— 这里必须有第二道。
  check(
    '违规片段里的凭据被脱敏',
    read(SERVICE).includes('safeSnippet(v.snippet())') && /private static final .*Pattern CREDENTIAL/.test(read(SERVICE)),
    '报告要留档要导出，密码一旦进去就收不回来',
  );

  const lab = read(LAB);
  check('解剖台挂上了体检页签', lab.includes("'checkup'") && lab.includes('体检报告'), '页签没挂 = 功能不可达');
  check('体检走 autopsyInspect（不另拼 fetch）', lab.includes('autopsyInspect(') && !/fetch\(\s*[^)]*autopsy\/inspect/.test(lab), '页面里再拼一次请求 = 第二份实现通道');
  check('前端 API 层有 autopsyInspect', read(path.join(webRoot, 'src/lib/arsenal-api.ts')).includes('export async function autopsyInspect'), '接口封装只在 arsenal-api.ts 一处');
}

// ═══════════════════════════════════════════════════════════════
// 【8】结构自检 —— 专用判据有没有忘跑自己的那份
//
// 摘掉外壳递归后，「某个专用判据漏跑 validateSpec」这一类失效不会有任何东西报错。
// 章程层吃过这个亏（checkConsistency 漏跑 → minVariants:0 不报红）。
// 这里逐类注入必填缺失，确认真会红。
section('【8】结构自检：每条判据都真的会红');
{
  const missing = (mutate: (d: any) => void, code: string, label: string) => {
    const d = clone(checkupsRaw);
    mutate(d);
    const r = validate({ relPath: 'x.json', doc: d, today: TODAY });
    check(`结构自检 · ${label} → 红`, r.errors.some((e) => e.code === code), `实际码：${r.errors.map((e) => e.code).join(' / ') || '(无)'}`);
  };
  missing((d) => { delete d.count; }, 'CHECKUP_REQUIRED_MISSING', '外壳缺 count');
  missing((d) => { delete d.operators; }, 'CHECKUP_REQUIRED_MISSING', '外壳缺 operators');
  missing((d) => { delete d.rules[0].advice; }, 'CHECKUP_REQUIRED_MISSING', '观察项缺 advice');
  missing((d) => { delete d.rules[0].when; }, 'CHECKUP_REQUIRED_MISSING', '观察项缺 when');
  missing((d) => { d.rules[0].level = 'p0'; }, 'CHECKUP_LEVEL_UNKNOWN', '档位非法');
  missing((d) => { d.rules[0].when.fact = '  '; }, 'CHECKUP_FACT_BLANK', 'fact 空白');
}

// ═══════════════════════════════════════════════════════════════
// 【9】端到端（后端在才跑，不在明说跳过）
section('【9】端到端：真跑一次 /api/autopsy/inspect');
// 异步包一层：本仓 tsx 是 cjs 输出，顶层 await 编译失败（与静态 import 同一条限制）
void (async () => {
  const base = process.env.ARSENAL_API_BASE ?? 'http://localhost:3011';
  type Report = {
    root: string;
    coverage: { total: number; executed: number; notRun: number; skippedCount: number; tierPool: any; decidable: boolean };
    p0: Array<{ ruleId: string; file: string; line: number; evidence: string }>;
    p1: Array<{ ruleId: string; file: string; line: number; evidence: string }>;
    other: Array<{ ruleId: string; evidence: string }>;
    obs: { available: boolean; ruleCount: number; firedCount: number; unevaluatedCount: number; items: Array<{ id: string; evidence: string[] }> };
  };
  let data: Report | null = null;
  try {
    const res = await fetch(`${base}/api/autopsy/inspect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: { kind: 'path', value: serverRoot.replace(/\\/g, '/') } }),
      signal: AbortSignal.timeout(200_000),
    });
    const body = (await res.json()) as { success: boolean; data?: Report };
    data = body.data ?? null;
  } catch {
    data = null;
  }

  if (data === null) {
    // 不能用 skipLayer：本层前 8 节是真跑过的（纯数据与源码断言，不需要后端），
    // 整层记成「跳过」会把它们一起抹掉。这里只把端到端那几条记成刻意未跑。
    knowinglySkipped(
      '【9】端到端 9 条：后端未启动（起法 SKIP_COMPILE=1 bash arsenal-server/scripts/run.sh）',
      '后端不在就没法真跑 inspect；这 9 条不是「跑了但失败」，是压根没跑 —— 不装作通过',
    );
  } else {
    const cov = data.coverage;
    check('端到端：分母来自后端规则池', cov.total > 0, `total=${cov.total}`);
    check('端到端：executed ≤ total 且 notRun 自洽', cov.executed <= cov.total && cov.notRun === cov.total - cov.executed, `executed=${cov.executed} notRun=${cov.notRun} total=${cov.total}`);
    check('端到端：确实有未覆盖项被列出来（本层跑不了的规则）', cov.notRun > 0 && cov.skippedCount > 0, `notRun=${cov.notRun} skipped=${cov.skippedCount} —— 0 意味着 skipped 披露失效`);
    check('端到端：档位规模与严重度口径一致', cov.tierPool.p0 + cov.tierPool.p1 + cov.tierPool.other === cov.total, JSON.stringify(cov.tierPool));
    const all = [...data.p0, ...data.p1, ...data.other];
    check('端到端：每条结论都带 file:line', all.length === 0 || all.every((v) => typeof v.evidence === 'string' && /^.+:\d+$/.test(v.evidence)), '命中必带证据（本仓铁律）');
    check('端到端：观察项事实源被读到', data.obs.available === true && data.obs.ruleCount > 0, JSON.stringify(data.obs).slice(0, 160));
    check('端到端：观察项带证据或明说无证据', data.obs.items.every((i) => i.evidence.length > 0), '证据为空数组会让「没找到」与「没查」不可分辨');
    check('端到端：算不出来的观察项单独记账', typeof data.obs.unevaluatedCount === 'number', 'unevaluated 与「没触发」必须分开');
    // 真跑出来的 JSON 里不许出现盘符路径与 /home、/Users —— 源码断言看得见写法，
    // 看不见「某条分支把绝对路径原样 put 了」；只有对产物判才堵得住。
    const dumped = JSON.stringify(data);
    const leaked = /[A-Za-z]:[\\/]|\/home\/|\/Users\//.exec(dumped);
    check(
      '端到端：报告 JSON 里没有绝对路径',
      leaked === null,
      leaked ? `泄了：${dumped.slice(Math.max(0, leaked.index - 60), leaked.index + 60)}` : '已核对',
    );
  }

  // finish 必须在异步块内 —— 放在外面会先执行，端到端那几条就永远进不了合计
  finish('checkup');
})();
